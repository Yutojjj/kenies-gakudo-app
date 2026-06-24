/**
 * sendPushNotification
 * Firebase Cloud Functions (asia-northeast1) 経由でFCM通知を送る。
 * 旧: /api/send-notification（Vercel静的ビルドでは動かない）
 * 新: Cloud Functions URL
 */

const SEND_NOTIFICATION_URL =
  'https://asia-northeast1-kanyes-8bfcb.cloudfunctions.net/sendNotification';

export async function sendPushNotification({
  tokens,
  title,
  body,
  url = '/menu',
}: {
  tokens: string[];
  title: string;
  body: string;
  url?: string;
}): Promise<void> {
  if (!tokens.length) return;
  try {
    await fetch(SEND_NOTIFICATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens, title, body, url }),
    });
  } catch (e) {
    console.warn('通知送信エラー:', e);
  }
}
