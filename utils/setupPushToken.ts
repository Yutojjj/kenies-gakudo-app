import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const PUSH_SUBSCRIPTIONS_COLLECTION = 'push_subscriptions_v2';

/** VAPID公開鍵（Base64URL）→ ArrayBuffer */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output.buffer;
}

function arrayBufferEquals(a?: ArrayBuffer | null, b?: ArrayBuffer | null): boolean {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  return left.every((value, index) => value === right[index]);
}

/** 端末固有IDを生成（endpoint末尾を使用） */
function deviceIdFromEndpoint(endpoint: string): string {
  return endpoint.slice(-60).replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Web Push サブスクリプションを取得して Firestore に保存する。
 *
 * 保存先: push_subscriptions_v2/{accountId}/devices/{deviceId}
 * 複数端末（iPhoneとPC等）に対応するためサブコレクション構造を使用。
 *
 * iOS制約: ホーム画面に追加（standalone）していないと通知が届かない。
 * 許可ダイアログはユーザー操作後に呼ぶこと（自動では失敗しやすい）。
 */
export async function setupPushToken(accountId: string): Promise<void> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  // iOSでstandaloneでない場合はスキップ
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const isStandalone = (window.navigator as any).standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !isStandalone) return;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const vapidKey = process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) { console.warn('[push] VAPID key not set'); return; }
    const applicationServerKey = urlBase64ToUint8Array(vapidKey);

    const reg = await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    const currentKey = sub?.options?.applicationServerKey || null;
    if (sub && currentKey && !arrayBufferEquals(currentKey, applicationServerKey)) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    const json = sub.toJSON() as { endpoint: string; keys?: { p256dh: string; auth: string } };
    const deviceId = deviceIdFromEndpoint(json.endpoint);

    // 親ドキュメントを先に作る（これがないと一覧取得で出てこない）
    await setDoc(
      doc(db, PUSH_SUBSCRIPTIONS_COLLECTION, accountId),
      { enabled: true, updatedAt: serverTimestamp() },
      { merge: true }
    );

    // 端末ごとのサブスクリプションを保存
    // push_subscriptions_v2/{accountId}/devices/{deviceId}
    await setDoc(
      doc(db, PUSH_SUBSCRIPTIONS_COLLECTION, accountId, 'devices', deviceId),
      {
        subscription: json,
        userAgent: navigator.userAgent,
        enabled: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    console.info('[push] Web Push登録完了:', deviceId);
  } catch (e) {
    console.warn('[push] setupPushToken failed:', e);
  }
}
