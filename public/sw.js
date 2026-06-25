// ケーニーズ学童クラブ Service Worker
// キャッシュ + Web Push を1ファイルに統合

const CACHE_NAME = 'kenies-gakudo-v3';

const PRECACHE = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
];

// ── インストール ──────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(PRECACHE.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

// ── アクティベート（古いキャッシュ削除） ─────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── フェッチ（ネットワーク優先、失敗時キャッシュ） ───────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (url.includes('firebase') || url.includes('firestore') || url.includes('googleapis')) return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.status === 200) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then(cached => cached || caches.match('/'))
      )
  );
});

// ── Web Push 受信 ─────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const title = data.title || 'お知らせ';
    const body  = data.body  || '';
    const url   = data.data?.url || '/menu';

    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon:  '/icon-192.png',
        badge: '/icon-192.png',
        data:  { url },
      })
    );
  } catch (e) {
    console.warn('[SW] push parse error:', e);
  }
});

// ── 通知タップ ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/menu';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NAVIGATE', url });
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// ── メッセージ受信（SKIP_WAITING等） ─────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
