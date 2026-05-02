import { getApps, initializeApp } from "firebase/app";
import { Firestore, getFirestore, initializeFirestore, memoryLocalCache, persistentLocalCache } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { Platform } from "react-native";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// ▼ 原因特定のため、.envが正しく読み込めているか確認するログを追加 ▼
console.log("🔥 Project ID:", process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);

// Hot Reload 時の二重初期化を防ぐ
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// initializeFirestore は同じアプリで2回呼ぶとエラーになるため try/catch で吸収する
let db: Firestore;
try {
  if (Platform.OS === "web") {
    // Web: 永続キャッシュのみ（long polling 不要）
    db = initializeFirestore(app, {
      localCache: persistentLocalCache(),
    });
  } else {
    // iOS/Android: React Native は WebSocket が不安定なため
    // experimentalForceLongPolling が必須。persistentLocalCache との併用は不可。
    db = initializeFirestore(app, {
      localCache: memoryLocalCache(),
      experimentalForceLongPolling: true,
    });
  }
} catch {
  // すでに初期化済みの場合は既存インスタンスを取得
  db = getFirestore(app);
}

const storage = getStorage(app);

export { app, db, storage };
