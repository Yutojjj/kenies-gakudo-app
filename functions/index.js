const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const webpush = require("web-push");

initializeApp();

// 許可するアプリ内URLのプレフィックス
const ALLOWED_URL_PREFIXES = [
  "/menu", "/messages", "/schedule", "/album",
  "/qr-scan", "/schedule-changes", "/survey",
];

function isAllowedUrl(url) {
  if (!url) return false;
  return ALLOWED_URL_PREFIXES.some(p => url.startsWith(p));
}

/**
 * sendNotification
 * POST {
 *   accountIds?: string[], // 送信先アカウントID
 *   sendToAll?: boolean,   // trueなら登録済み全員へ送信
 *   excludeAccountId?: string,
 *   title: string,
 *   body: string,
 *   url: string,           // アプリ内パスのみ許可
 * }
 *
 * サーバー側でFirestoreからsubscriptionを取得して送信する。
 * クライアントからsubscriptionを直接受け取らない。
 */
exports.sendNotification = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
  },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const { accountIds, sendToAll, excludeAccountId, title, body, url } = req.body ?? {};

    // 入力バリデーション
    if (!sendToAll && (!Array.isArray(accountIds) || !accountIds.length)) {
      res.status(200).json({ sent: 0 });
      return;
    }
    if (!title || typeof title !== "string" || title.length > 100) {
      res.status(400).json({ error: "Invalid title" }); return;
    }
    if (body != null && (typeof body !== "string" || body.length > 500)) {
      res.status(400).json({ error: "Invalid body" }); return;
    }
    if (!isAllowedUrl(url)) {
      res.status(400).json({ error: "URL not allowed" }); return;
    }

    const vapidPublicKey  = process.env.VAPID_PUBLIC_KEY || process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const vapidSubject    = process.env.VAPID_SUBJECT;
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      console.error("VAPID env vars not set");
      res.status(500).json({ error: "Server config error" }); return;
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const db = getFirestore();
    let targetAccountIds = [];

    if (sendToAll) {
      const accountSnap = await db
        .collection("push_subscriptions")
        .where("enabled", "==", true)
        .get();
      targetAccountIds = accountSnap.docs
        .map((d) => d.id)
        .filter((id) => id !== excludeAccountId);
    } else {
      targetAccountIds = [...new Set(accountIds)]
        .filter((id) => typeof id === "string" && id.trim())
        .slice(0, 100);
    }

    if (!targetAccountIds.length) {
      res.status(200).json({ sent: 0 });
      return;
    }
    if (targetAccountIds.length > 500) {
      res.status(400).json({ error: "Too many recipients" });
      return;
    }

    const payload = JSON.stringify({
      title: title || "お知らせ",
      body:  body  || "",
      icon:  "/icon-192.png",
      badge: "/icon-192.png",
      data:  { url: url || "/menu" },
    });

    // Firestoreから全accountIdのサブスクリプションを取得
    // 複数端末対応: push_subscriptions/{accountId}/devices/{deviceId}
    const subscriptions = [];
    await Promise.all(
      targetAccountIds.map(async (accountId) => {
        try {
          const devicesSnap = await db
            .collection("push_subscriptions")
            .doc(accountId)
            .collection("devices")
            .where("enabled", "==", true)
            .get();
          devicesSnap.forEach(d => {
            const sub = d.data().subscription;
            if (sub?.endpoint) subscriptions.push({ accountId, deviceId: d.id, sub });
          });
        } catch (e) {
          console.warn(`[push] Failed to get subscription for ${accountId}:`, e.message);
        }
      })
    );

    if (!subscriptions.length) {
      console.log("[push] No subscriptions found");
      res.status(200).json({ sent: 0 }); return;
    }

    // 送信＋無効subscriptionの削除
    let sent = 0;
    await Promise.allSettled(
      subscriptions.map(async ({ accountId, deviceId, sub }) => {
        try {
          await webpush.sendNotification(sub, payload);
          sent++;
        } catch (e) {
          console.warn(`[push] Failed to send to ${accountId}/${deviceId}:`, e.statusCode, e.message);
          // 410 Gone or 404 → 無効なsubscription → 削除
          if (e.statusCode === 410 || e.statusCode === 404) {
            await db
              .collection("push_subscriptions")
              .doc(accountId)
              .collection("devices")
              .doc(deviceId)
              .delete()
              .catch(() => {});
            console.log(`[push] Removed stale subscription: ${accountId}/${deviceId}`);
          }
        }
      })
    );

    // 送信ログをFirestoreに保存
    await db.collection("notification_logs").add({
      accountIds: targetAccountIds,
      sendToAll: !!sendToAll,
      excludeAccountId: excludeAccountId || "",
      title,
      body: body || "",
      url,
      sent,
      total: subscriptions.length,
      sentAt: new Date(),
    }).catch(() => {});

    console.log(`[push] 送信完了: ${sent}/${subscriptions.length}`);
    res.status(200).json({ sent, total: subscriptions.length });
  }
);
