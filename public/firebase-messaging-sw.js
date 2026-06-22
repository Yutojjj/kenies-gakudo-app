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

// バックグラウンド受信
// バックエンド側で notification ペイロードを送るようにしたため、OS（ブラウザ）が自動で通知を表示します。
// 二重表示やiOSでの衝突を防ぐため、ここでの手動 showNotification は削除します。
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
});

// 通知バナーをタップしたときの処理（該当の画面を開く）
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  // OSが自動生成した通知のデータは FCM_MSG の中に入ることが多いため、両方からURLを探します
  const url = event.notification.data?.url 
           || event.notification.data?.FCM_MSG?.data?.url 
           || '/menu';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 既にアプリのタブが開いていればそこにフォーカスする
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // 開いていなければ新しいウィンドウ（PWA）で開く
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});