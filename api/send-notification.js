import crypto from 'node:crypto';
import webpush from 'web-push';

const ALLOWED_URL_PREFIXES = [
  '/menu',
  '/messages',
  '/schedule',
  '/album',
  '/qr-scan',
  '/schedule-changes',
  '/survey',
];

let cachedToken = null;

function isAllowedUrl(url) {
  return typeof url === 'string' && ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not set');
  const serviceAccount = JSON.parse(raw);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is invalid');
  }
  return serviceAccount;
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const serviceAccount = parseServiceAccount();
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsigned)
    .sign(serviceAccount.private_key);
  const jwt = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google token request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: now + Number(data.expires_in || 3600),
  };
  return cachedToken.value;
}

function firestoreValueToJson(value) {
  if (!value) return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(firestoreValueToJson);
  }
  if ('mapValue' in value) {
    const result = {};
    const fields = value.mapValue.fields || {};
    Object.entries(fields).forEach(([key, child]) => {
      result[key] = firestoreValueToJson(child);
    });
    return result;
  }
  return undefined;
}

function firestoreDocToJson(doc) {
  const result = {};
  const fields = doc.fields || {};
  Object.entries(fields).forEach(([key, value]) => {
    result[key] = firestoreValueToJson(value);
  });
  return result;
}

async function firestoreListDocuments(path, token) {
  const serviceAccount = parseServiceAccount();
  const projectId = serviceAccount.project_id || process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
  const response = await fetch(`${url}?pageSize=500`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 404) return [];
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Firestore request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.documents || [];
}

async function resolveTargetAccountIds({ accountIds, sendToAll, excludeAccountId }, token) {
  if (!sendToAll) {
    return [...new Set(accountIds)]
      .filter((id) => typeof id === 'string' && id.trim())
      .slice(0, 100);
  }

  const docs = await firestoreListDocuments('push_subscriptions', token);
  return docs
    .map((doc) => decodeURIComponent(doc.name.split('/').pop()))
    .filter((id) => id && id !== excludeAccountId);
}

async function loadSubscriptions(accountIds, token) {
  const subscriptions = [];
  await Promise.all(
    accountIds.map(async (accountId) => {
      const docs = await firestoreListDocuments(
        `push_subscriptions/${encodeURIComponent(accountId)}/devices`,
        token
      );
      docs.forEach((doc) => {
        const deviceId = decodeURIComponent(doc.name.split('/').pop());
        const data = firestoreDocToJson(doc);
        if (data.enabled === false) return;
        if (data.subscription?.endpoint) {
          subscriptions.push({ accountId, deviceId, subscription: data.subscription });
        }
      });
    })
  );
  return subscriptions;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { accountIds, sendToAll, excludeAccountId, title, body, url } = req.body ?? {};

    if (!sendToAll && (!Array.isArray(accountIds) || !accountIds.length)) {
      return res.status(200).json({ sent: 0, total: 0 });
    }
    if (!title || typeof title !== 'string' || title.length > 100) {
      return res.status(400).json({ error: 'Invalid title' });
    }
    if (body != null && (typeof body !== 'string' || body.length > 500)) {
      return res.status(400).json({ error: 'Invalid body' });
    }
    if (!isAllowedUrl(url)) {
      return res.status(400).json({ error: 'URL not allowed' });
    }

    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const vapidSubject = process.env.VAPID_SUBJECT;
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      return res.status(500).json({ error: 'VAPID env vars not set' });
    }

    const token = await getAccessToken();
    const targetAccountIds = await resolveTargetAccountIds(
      { accountIds, sendToAll, excludeAccountId },
      token
    );

    if (!targetAccountIds.length) {
      return res.status(200).json({ sent: 0, total: 0 });
    }

    const subscriptions = await loadSubscriptions(targetAccountIds, token);
    if (!subscriptions.length) {
      return res.status(200).json({ sent: 0, total: 0 });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    const payload = JSON.stringify({
      title,
      body: body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url },
    });

    const results = await Promise.allSettled(
      subscriptions.map(({ subscription }) => webpush.sendNotification(subscription, payload))
    );

    const sent = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.statusCode || result.reason?.message || 'unknown');

    return res.status(200).json({
      sent,
      total: subscriptions.length,
      accountIds: targetAccountIds,
      failed,
    });
  } catch (error) {
    console.error('[push] send-notification failed:', error);
    return res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
}
