const NOTIFY_API = '/api/send-notification';

async function postNotification(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(NOTIFY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const message = await res.text().catch(() => '');
    throw new Error(`Notification API failed: ${res.status} ${message}`);
  }
}

/** 指定したaccountIdリストに通知を送る */
export async function sendPushNotification({
  accountIds,
  title,
  body,
  url = '/menu',
}: {
  accountIds: string[];
  title: string;
  body: string;
  url?: string;
}): Promise<void> {
  if (!accountIds.length) return;
  try {
    await postNotification({ accountIds, title, body, url });
  } catch (e) {
    console.warn('[push] sendPushNotification failed:', e);
  }
}

/** 全ユーザーに通知（グループメッセージ等）*/
export async function sendPushNotificationToAll({
  excludeAccountId,
  title,
  body,
  url = '/menu',
}: {
  excludeAccountId?: string;
  title: string;
  body: string;
  url?: string;
}): Promise<void> {
  try {
    await postNotification({ sendToAll: true, excludeAccountId, title, body, url });
  } catch (e) {
    console.warn('[push] sendPushNotificationToAll failed:', e);
  }
}
