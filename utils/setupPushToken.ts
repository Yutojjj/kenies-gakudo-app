import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
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
 * 現在の通知許可状態を返す。
 * - 'granted'  : 許可済み・購読可能
 * - 'denied'   : ブロック済み・設定から手動解除が必要
 * - 'default'  : 未決定・ダイアログを出せる
 * - 'unsupported' : ブラウザ非対応
 * - 'ios-not-standalone' : iOS でホーム画面未追加
 */
export function getNotificationState(): 'granted' | 'denied' | 'default' | 'unsupported' | 'ios-not-standalone' {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';

  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const isStandalone =
    (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !isStandalone) return 'ios-not-standalone';

  return Notification.permission as 'granted' | 'denied' | 'default';
}

/**
 * Web Push サブスクリプションを取得して Firestore に保存する。
 *
 * ⚠️ この関数は必ずボタンタップ等のユーザー操作から呼ぶこと。
 *    useEffect から自動で呼ぶと Chrome/Safari でブロックされる。
 *
 * 保存先: push_subscriptions_v2/{accountId}/devices/{deviceId}
 */
export async function setupPushToken(accountId: string): Promise<'granted' | 'denied' | 'error'> {
  const state = getNotificationState();
  if (state === 'unsupported' || state === 'ios-not-standalone') return 'error';
  if (state === 'denied') return 'denied';

  try {
    // ユーザー操作から呼ばれた場合のみダイアログが表示される
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';

    const vapidKey = process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) { console.warn('[push] VAPID key not set'); return 'error'; }
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
    return 'granted';
  } catch (e) {
    console.warn('[push] setupPushToken failed:', e);
    return 'error';
  }
}

/**
 * 既存のサブスクリプションがあれば再登録のみ（許可ダイアログなし）。
 * 起動時の自動呼び出し専用。許可済みの端末を再接続するために使う。
 */
export async function refreshPushSubscription(accountId: string): Promise<void> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;

  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const isStandalone =
    (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !isStandalone) return;

  try {
    const vapidKey = process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) return;
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

    await setDoc(
      doc(db, PUSH_SUBSCRIPTIONS_COLLECTION, accountId),
      { enabled: true, updatedAt: serverTimestamp() },
      { merge: true }
    );
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
    console.info('[push] Push subscription refreshed:', deviceId);
  } catch (e) {
    console.warn('[push] refreshPushSubscription failed:', e);
  }
}

/**
 * ログアウト時に、このブラウザのPush購読とFirestore上の端末登録を無効化する。
 * 同じアカウントの別端末までは無効化しない。
 */
export async function disablePushSubscription(accountId: string): Promise<void> {
  if (!accountId || typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;

    const json = sub.toJSON() as { endpoint?: string };
    if (json.endpoint) {
      const deviceId = deviceIdFromEndpoint(json.endpoint);
      await setDoc(
        doc(db, PUSH_SUBSCRIPTIONS_COLLECTION, accountId, 'devices', deviceId),
        { enabled: false, updatedAt: serverTimestamp() },
        { merge: true }
      );
    }

    await sub.unsubscribe();
    console.info('[push] Web Push登録を解除しました:', accountId);
  } catch (e) {
    // ログアウト自体は通知解除の失敗で止めない。
    console.warn('[push] disablePushSubscription failed:', e);
  }
}
