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

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'ケーニーズ学童';
  const body = payload.notification?.body || '';
  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'kenies-message',
  });
});
