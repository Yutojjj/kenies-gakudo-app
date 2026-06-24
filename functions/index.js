const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

/**
 * sendNotification
 * POST { tokens: string[], title: string, body: string, url?: string }
 *
 * フロントから /api/send-notification の代わりに呼ぶ Cloud Function。
 * Firebase Admin SDK を使うので サービスアカウントJSONの手動管理が不要。
 */
exports.sendNotification = onRequest(
  {
    region: "asia-northeast1", // 東京リージョン（レイテンシ低減）
    cors: true,                // フロントからの直接呼び出しを許可
  },
  async (req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { tokens, title, body, url } = req.body ?? {};
    if (!tokens?.length) {
      res.status(200).json({ sent: 0 });
      return;
    }

    try {
      const messaging = getMessaging();

      // 複数トークンへ一括送信（最大500件/回）
      const results = await Promise.allSettled(
        tokens.map((token) =>
          messaging.send({
            token,
            notification: {
              title: title || "お知らせ",
              body: body || "",
            },
            data: {
              url: url || "/menu",
            },
            // iOS（PWA on Safari）向け
            apns: {
              payload: {
                aps: {
                  sound: "default",
                  badge: 1,
                },
              },
            },
            // Android向け
            android: {
              priority: "high",
              notification: {
                sound: "default",
              },
            },
            // Web Push向け
            webpush: {
              notification: {
                icon: "/icon-192.png",
              },
              fcmOptions: {
                link: url || "/menu",
              },
            },
          })
        )
      );

      const sent = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      console.log(`通知送信: 成功=${sent} 失敗=${failed}`);
      res.status(200).json({ sent, failed });
    } catch (err) {
      console.error("sendNotification error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);
