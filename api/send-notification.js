import webpush from 'web-push';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tokenDocs, title, body, url } = req.body ?? {};
  if (!tokenDocs?.length) return res.status(200).json({ sent: 0 });

  const vapidPublicKey  = process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject    = process.env.VAPID_SUBJECT;

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return res.status(500).json({ error: 'VAPID env vars not set' });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const payload = JSON.stringify({
    title: title || 'お知らせ',
    body:  body  || '',
    icon:  '/icon-192.png',
    badge: '/icon-192.png',
    data:  { url: url || '/menu' },
  });

  const results = await Promise.allSettled(
    tokenDocs
      .filter(d => d.subscription)
      .map(d => webpush.sendNotification(d.subscription, payload))
  );

  const sent   = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) {
    console.error('送信失敗:', failed.map(r => r.reason?.message));
  }

  return res.status(200).json({ sent });
}
