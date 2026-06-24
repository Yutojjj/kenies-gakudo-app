// ケーニーズ学童クラブ - Push通知 Service Worker
// FCMは使わず Web Push Protocol (RFC8030) を直接使用

// Web Pushで届いたメッセージを通知バナーとして表示
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
    console.warn('[SW] push parse error', e);
  }
});

// 通知バナーをタップしたときの処理
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/menu';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
