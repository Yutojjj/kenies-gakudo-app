import crypto from 'crypto';

// サービスアカウントJWTでOAuth2アクセストークンを取得（google-auth-library不要）
async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.write(`${header}.${claim}`);
  sign.end();
  const sig = sign.sign(serviceAccount.private_key, 'base64url');
  const jwt = `${header}.${claim}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tokens, title, body, url } = req.body ?? {};
  if (!tokens?.length) return res.status(200).json({ sent: 0 });

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!rawJson) return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT_JSON not set' });

  try {
    const serviceAccount = JSON.parse(rawJson);
    const accessToken = await getAccessToken(serviceAccount);
    const projectId = serviceAccount.project_id;
    const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    const results = await Promise.allSettled(
      tokens.map(token =>
        fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            // notification フィールドを使うとブラウザが自動表示 + SW が手動表示 → 二重になる
            // data-only にすることで SW の onBackgroundMessage のみが通知を表示する
            message: { token, data: { title, body, url: req.body.url || '/messages' } },
          }),
        })
      )
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    return res.status(200).json({ sent });
  } catch (err) {
    console.error('Notification error:', err);
    return res.status(500).json({ error: err.message });
  }
}
