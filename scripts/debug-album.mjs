import fs from 'node:fs';
import { initializeApp } from 'firebase/app';
import { collection, getDocs, getFirestore, limit, query } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref } from 'firebase/storage';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(Boolean).filter(line => !line.startsWith('#')).map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1).replace(/^['"]|['"]$/g, '')];
  }),
);
const app = initializeApp({
  apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
});
const db = getFirestore(app);
const storage = getStorage(app);
const snap = await getDocs(query(collection(db, 'albums2'), limit(3)));
for (const entry of snap.docs) {
  const data = entry.data();
  const match = String(data.uri || '').match(/\/o\/([^?]+)/);
  const path = data.storagePath || (match?.[1] ? decodeURIComponent(match[1]) : '');
  const result = { id: entry.id, category: data.category, path, storedHost: data.uri ? new URL(data.uri).host : '' };
  try {
    const url = await getDownloadURL(ref(storage, path));
    const response = await fetch(url);
    Object.assign(result, {
      storageUrl: 'ok',
      status: response.status,
      contentType: response.headers.get('content-type'),
      size: Number(response.headers.get('content-length') || 0),
    });
  } catch (error) {
    result.error = `${error?.code || ''} ${error?.message || error}`;
  }
  console.log(JSON.stringify(result));
}
