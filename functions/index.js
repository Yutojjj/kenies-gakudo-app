const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const webpush = require("web-push");

initializeApp();

const DEFAULT_NOTIFICATION_API_ORIGIN = "https://kenies-gakudo-app.vercel.app";

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

async function sendAnnouncementPush(accountIds, title, body, url) {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    throw new Error("VAPID env vars not set");
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const db = getFirestore();
  const subscriptions = [];
  await Promise.all(accountIds.map(async accountId => {
    const devices = await db.collection("push_subscriptions_v2").doc(accountId).collection("devices").get();
    devices.forEach(device => {
      const data = device.data();
      if (data.enabled !== false && data.subscription?.endpoint) {
        subscriptions.push({ accountId, deviceId: device.id, subscription: data.subscription });
      }
    });
  }));
  const payload = JSON.stringify({
    title,
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url },
  });
  let sent = 0;
  const errors = [];
  await Promise.allSettled(subscriptions.map(async item => {
    try {
      await webpush.sendNotification(item.subscription, payload);
      sent++;
    } catch (error) {
      errors.push({
        accountId: item.accountId,
        deviceId: item.deviceId,
        statusCode: Number(error?.statusCode || 0),
        message: String(error?.message || "push failed").slice(0, 200),
      });
      if (error.statusCode === 404 || error.statusCode === 410) {
        await db.collection("push_subscriptions_v2").doc(item.accountId).collection("devices").doc(item.deviceId).delete().catch(() => {});
      }
    }
  }));
  return { sent, total: subscriptions.length, errors };
}

function trustedNotificationApiOrigin(value) {
  try {
    const parsed = new URL(String(value || ""));
    const host = parsed.hostname.toLowerCase();
    if (
      parsed.protocol === "https:" &&
      host.endsWith(".vercel.app") &&
      host.includes("kenies-gakudo-app")
    ) {
      return parsed.origin;
    }
  } catch {}
  return "";
}

async function sendStaffShiftPush(setting, accountId, title, body, url) {
  const apiOrigin = trustedNotificationApiOrigin(setting.notificationApiOrigin) || DEFAULT_NOTIFICATION_API_ORIGIN;
  if (apiOrigin) {
    const response = await fetch(`${apiOrigin}/api/send-notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountIds: [accountId], title, body, url }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`notification API failed: ${response.status} ${data.error || ""}`.trim());
    }
    return {
      sent: Number(data.sent || 0),
      total: Number(data.total || 0),
      errors: Array.isArray(data.failed)
        ? data.failed.map(message => ({ message: String(message) }))
        : [],
    };
  }
  return sendAnnouncementPush([accountId], title, body, url);
}

const WEEKDAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

function hasRegularUseOnWeekday(account, weekday) {
  const isRegularOnDay = child => {
    if (!child || (child.usageType || "定期利用") !== "定期利用") return false;
    const days = child.days;
    if (Array.isArray(days)) return days.includes(weekday);
    return !!days?.[weekday];
  };

  if (isRegularOnDay(account)) return true;
  return (Array.isArray(account.siblings) ? account.siblings : []).some(isRegularOnDay);
}

// 日常アルバムへの一括アップロード完了時、対象曜日の定期利用者へ1回だけ通知する。
exports.notifyDailyAlbumUpload = onDocumentCreated(
  {
    document: "album_notification_jobs/{jobId}",
    region: "asia-northeast1",
  },
  async event => {
    const snapshot = event.data;
    if (!snapshot) return;

    const db = getFirestore();
    const jobRef = snapshot.ref;
    const claimed = await db.runTransaction(async transaction => {
      const fresh = await transaction.get(jobRef);
      if (!fresh.exists || fresh.data().status !== "pending") return false;
      transaction.update(jobRef, { status: "processing", processingAt: new Date() });
      return true;
    });
    if (!claimed) return;

    const job = snapshot.data();
    const dateKey = String(job.dateKey || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      await jobRef.delete();
      return;
    }

    try {
      const [year, month, day] = dateKey.split("-").map(Number);
      // Cloud Functions is UTC-based, so the album's calendar date is evaluated
      // directly instead of converting Japanese midnight to the previous UTC day.
      const weekday = WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
      const users = await db.collection("accounts").where("role", "==", "user").get();
      const accountIds = users.docs
        .filter(item => hasRegularUseOnWeekday(item.data(), weekday))
        .map(item => item.id);

      if (accountIds.length > 0) {
        const result = await sendAnnouncementPush(
          accountIds,
          "アルバムが更新されました",
          `${month}月${day}日（${weekday}）の写真・動画が追加されました。`,
          `/album?role=user&date=${dateKey}`
        );
        await db.collection("notification_logs").add({
          type: "daily_album",
          dateKey,
          weekday,
          uploadedCount: Number(job.uploadedCount || 0),
          accountIds,
          sent: result.sent,
          total: result.total,
          sentAt: new Date(),
        }).catch(() => {});
      }

      await jobRef.delete();
    } catch (error) {
      console.error(`[album notification] failed: ${event.params.jobId}`, error);
      await jobRef.update({
        status: "failed",
        error: String(error?.message || error),
        failedAt: new Date(),
      }).catch(() => {});
    }
  }
);

function announcementStoragePathFromUrl(url) {
  if (typeof url !== "string") return "";
  const match = url.match(/\/o\/([^?]+)/);
  if (!match) return "";
  try {
    const path = decodeURIComponent(match[1]);
    return path.startsWith("announcements/") ? path : "";
  } catch {
    return "";
  }
}

async function deleteExpiredAnnouncement(item) {
  const data = item.data();
  const paths = new Set();
  const headerPath = data.headerImageStoragePath || announcementStoragePathFromUrl(data.headerImageUrl || data.imageUrl);
  if (typeof headerPath === "string" && headerPath.startsWith("announcements/")) paths.add(headerPath);
  (Array.isArray(data.referenceImages) ? data.referenceImages : []).forEach(image => {
    if (image?.sourceAlbumId) return;
    const path = image?.storagePath || announcementStoragePathFromUrl(image?.url);
    if (typeof path === "string" && path.startsWith("announcements/")) paths.add(path);
  });
  (Array.isArray(data.retiredImageStoragePaths) ? data.retiredImageStoragePaths : []).forEach(path => {
    if (typeof path === "string" && path.startsWith("announcements/")) paths.add(path);
  });
  const bucket = getStorage().bucket();
  await Promise.all([...paths].map(path => bucket.file(path).delete().catch(error => {
    if (error?.code !== 404) console.warn(`[announcement] image cleanup failed: ${path}`, error.message);
  })));
  await item.ref.delete();
}

// 予約されたお知らせを1分ごとに確認し、掲載開始時に通知、掲載終了後にデータと専用画像を削除する。
exports.publishScheduledAnnouncements = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
  },
  async () => {
    const db = getFirestore();
    const now = Date.now();
    const expiredSnap = await db.collection("announcements").where("expiresAt", "<", new Date(now)).get();
    await Promise.all(expiredSnap.docs.map(item => deleteExpiredAnnouncement(item)));
    const [announcementSnap, userSnap] = await Promise.all([
      db.collection("announcements").where("notificationSent", "==", false).get(),
      db.collection("accounts").where("role", "==", "user").get(),
    ]);
    const accountIds = userSnap.docs.map(item => item.id);
    const due = announcementSnap.docs.filter(item => {
      const data = item.data();
      const expiresAt = data.expiresAt?.toDate ? data.expiresAt.toDate().getTime() : Infinity;
      return data.isActive !== false && data.publishAt?.toDate && data.publishAt.toDate().getTime() <= now && expiresAt >= now;
    });
    await Promise.all(due.map(async item => {
      const data = item.data();
      try {
        // 重複起動したスケジューラーが同じ投稿を送らないよう、トランザクションで送信対象を確保する。
        const claimed = await db.runTransaction(async transaction => {
          const fresh = await transaction.get(item.ref);
          if (!fresh.exists || fresh.data().notificationSent !== false) return false;
          transaction.update(item.ref, { notificationSent: true, notificationProcessingAt: new Date() });
          return true;
        });
        if (!claimed) return;
        const result = await sendAnnouncementPush(
          accountIds,
          `お知らせ: ${String(data.subject || "お知らせ")}`.slice(0, 100),
          String(data.content || "").slice(0, 500),
          `/menu?announcementId=${item.id}`
        );
        await item.ref.update({
          notificationSent: true,
          notificationSentAt: new Date(),
          notificationSentCount: result.sent,
        });
      } catch (error) {
        console.error(`[announcement] failed: ${item.id}`, error);
        await item.ref.update({ notificationSent: false, notificationErrorAt: new Date() }).catch(() => {});
      }
    }));
  }
);

function tokyoDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function tokyoTimeKey(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(".", ":");
}

function timeToMinutes(time) {
  const match = String(time || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

// スタッフ本人が有効にした勤務通知を、指定時刻に各端末へ送る。
// lastSentDateKeyで同じ勤務日への重複通知を防ぐ。
exports.sendStaffShiftReminders = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
  },
  async () => {
    const db = getFirestore();
    const now = new Date();
    const todayKey = tokyoDateKey(now);
    const currentTime = tokyoTimeKey(now);
    const currentMinutes = timeToMinutes(currentTime);
    const settingsSnap = await db.collection("staff_shift_notification_settings")
      .where("enabled", "==", true)
      .get();

    const diagnostics = {
      enabledSettings: settingsSnap.size,
      invalidTime: 0,
      outsideWindow: 0,
      missingIdentity: 0,
      missingShiftDocument: 0,
      staffNameMismatch: 0,
      alreadySentOrProcessing: 0,
      noPushSubscription: 0,
      pushFailed: 0,
      sent: 0,
    };

    await Promise.all(settingsSnap.docs.map(async settingDoc => {
      const setting = settingDoc.data();
      const scheduledMinutes = timeToMinutes(setting.time);
      if (currentMinutes === null || scheduledMinutes === null) {
        diagnostics.invalidTime++;
        return;
      }
      // Schedulerは実行時刻が数分ずれることがあるため、設定時刻から10分以内を対象にする。
      // lastSentDateKeyで同じ勤務日の二重送信を防ぐ。
      const minutesSinceScheduled = currentMinutes - scheduledMinutes;
      if (minutesSinceScheduled < 0 || minutesSinceScheduled >= 10) {
        diagnostics.outsideWindow++;
        return;
      }

      const accountId = String(setting.accountId || settingDoc.id || "");
      const staffName = String(setting.staffName || "");
      if (!accountId || !staffName) {
        diagnostics.missingIdentity++;
        return;
      }

      const timing = setting.timing === "previousDay" ? "previousDay" : "sameDay";
      const targetDateKey = timing === "previousDay" ? addDaysToDateKey(todayKey, 1) : todayKey;
      const shiftDoc = await db.collection("assigned_shifts").doc(targetDateKey).get();
      if (!shiftDoc.exists) {
        diagnostics.missingShiftDocument++;
        return;
      }

      const shifts = (shiftDoc.data().staff || [])
        .filter(shift => String(shift.name || "") === staffName)
        .map(shift => `${String(shift.start || "")}〜${String(shift.end || "")}`)
        .filter(Boolean);
      if (!shifts.length) {
        diagnostics.staffNameMismatch++;
        return;
      }

      const claimed = await db.runTransaction(async transaction => {
        const fresh = await transaction.get(settingDoc.ref);
        const freshData = fresh.data() || {};
        const processingAt = freshData.notificationProcessingAt?.toDate?.();
        const processingIsFresh =
          freshData.notificationProcessingDateKey === targetDateKey &&
          processingAt instanceof Date &&
          now.getTime() - processingAt.getTime() < 2 * 60 * 1000;
        if (
          freshData.enabled !== true ||
          freshData.lastSentDateKey === targetDateKey ||
          processingIsFresh
        ) return false;
        transaction.update(settingDoc.ref, {
          notificationProcessingDateKey: targetDateKey,
          notificationProcessingAt: now,
        });
        return true;
      });
      if (!claimed) {
        diagnostics.alreadySentOrProcessing++;
        return;
      }

      let result;
      try {
        result = await sendStaffShiftPush(
          setting,
          accountId,
          "勤務通知",
          shifts.join("、"),
          "/shift-view"
        );
      } catch (error) {
        result = { sent: 0, total: 0, errors: [{ message: String(error?.message || error) }] };
      }

      if (result.sent > 0) {
        diagnostics.sent += result.sent;
        await settingDoc.ref.update({
          lastSentDateKey: targetDateKey,
          lastSentAt: new Date(),
          notificationProcessingDateKey: null,
          notificationProcessingAt: null,
          lastSendError: null,
        });
      } else {
        if (result.total === 0) diagnostics.noPushSubscription++;
        else diagnostics.pushFailed++;
        await settingDoc.ref.update({
          notificationProcessingDateKey: null,
          notificationProcessingAt: null,
          lastSendError: result.total === 0
            ? "push subscription not found"
            : String(result.errors?.[0]?.message || "push send failed").slice(0, 300),
          lastSendErrorAt: new Date(),
        });
      }
      await db.collection("notification_logs").add({
        type: "staff_shift_reminder",
        accountId,
        staffName,
        targetDateKey,
        timing,
        shifts,
        sent: result.sent,
        total: result.total,
        errors: result.errors || [],
        sentAt: new Date(),
      }).catch(() => {});
    }));

    console.log("[staff-shift-reminder]", JSON.stringify({
      todayKey,
      currentTime,
      ...diagnostics,
    }));
  }
);
