import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

/** VAPID公開鍵（Base64URL）→ Uint8Array */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

/**
 * Web Push サブスクリプションを取得してFirestoreに保存する。
 * iOS / Android / Chrome すべて同じWeb Push APIを使う（FCM不使用）。
 *
 * iOS制約: ホーム画面に追加（standalone）していないと通知が届かない。
 */
export async function setupPushToken(accountId: string): Promise<void> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  // iOSでstandaloneでない場合はスキップ（ブラウザで開いてるだけでは通知不可）
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const isStandalone = (window.navigator as any).standalone === true;
  if (isIOS && !isStandalone) return;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const vapidKey = process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) { console.warn('[push] VAPID key not set'); return; }

    const reg = await navigator.serviceWorker.ready;

    // 既存のサブスクリプションを取得、なければ新規作成
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
    }

    await setDoc(doc(db, 'fcm_tokens', accountId), {
      subscription: sub.toJSON(),
      updatedAt: new Date(),
    });
  } catch (e) {
    console.warn('[push] setupPushToken failed:', e);
  }
}
