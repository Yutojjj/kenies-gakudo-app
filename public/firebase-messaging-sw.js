importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCKA8x8pTUt3gNbwMagJmshZ1ivg7X3Yr4',
  authDomain: 'kanyes-8bfcb.firebaseapp.com',
  projectId: 'kanyes-8bfcb',
  storageBucket: 'kanyes-8bfcb.firebasestorage.app',
  messagingSenderId: '492000443756',
  appId: '1:492000443756:web:89a53682e54d2534158749',
});

const messaging = firebase.messaging();

// バックグラウンド受信（data-onlyメッセージのため自動表示されない→手動でshowNotification）
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || 'ケーニーズ学童';
  const body  = data.body  || '';
  const url   = data.url   || '/messages';

  self.registration.showNotification(title, {
    body,
    icon:  '/icon-192.png',
    badge: '/icon-192.png',
    tag:   `kenies-${Date.now()}`,
    data:  { url },
  });
});

// 通知タップ → 該当画面へ遷移
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/messages';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(url);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
