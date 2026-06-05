import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, usePathname, useRouter } from 'expo-router';
import { disableNetwork, enableNetwork } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { CallProvider } from '../contexts/CallContext';
import { db } from '../firebase';

// ピンチズームを無効化
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const meta = document.querySelector('meta[name="viewport"]');
  const content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
  if (meta) {
    meta.setAttribute('content', content);
  } else {
    const m = document.createElement('meta');
    m.name = 'viewport';
    m.content = content;
    document.head.appendChild(m);
  }
}

const PUBLIC_PATHS = ['/', '/index'];

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const check = async () => {
      if (PUBLIC_PATHS.includes(pathname)) {
        setChecked(true);
        return;
      }
      const raw = await AsyncStorage.getItem('loggedInUser');
      if (!raw) {
        router.replace('/');
        return;
      }
      setChecked(true);
    };
    check();
  }, [pathname]);

  if (!checked) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF8F0' }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // オンライン状態の監視
    const checkOnline = async () => {
      try {
        await enableNetwork(db);
        setIsOnline(true);
      } catch {
        setIsOnline(false);
      }
    };

    // アプリがフォアグラウンドに戻ったとき、Firestoreを再接続して最新データを取得
    const handleAppStateChange = async (nextState: string) => {
      if (nextState === 'active') {
        try {
          await disableNetwork(db);
          await enableNetwork(db);
          setIsOnline(true);
        } catch {
          setIsOnline(false);
        }
      } else if (nextState === 'background') {
        // バックグラウンド時はネットワークを切断（古いキャッシュの書き戻しを防ぐ）
        try {
          await disableNetwork(db);
        } catch {}
      }
    };

    // Web環境でのオンライン/オフライン監視
    if (Platform.OS === 'web') {
      const handleOnline = async () => {
        try {
          await disableNetwork(db);
          await enableNetwork(db);
          setIsOnline(true);
        } catch {}
      };
      const handleOffline = async () => {
        setIsOnline(false);
      };
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    } else {
      const sub = AppState.addEventListener('change', handleAppStateChange);
      return () => sub.remove();
    }
  }, []);

  return (
    <SafeAreaProvider>
      <CallProvider>
        <AuthGuard>
          <SafeAreaView style={styles.container}>
            {/* オフライン時のバナー */}
            {!isOnline && (
              <View style={{ backgroundColor: '#FF5722', paddingVertical: 6, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>
                  オフライン中 - 接続を確認してください
                </Text>
              </View>
            )}
            <Stack
              screenOptions={{
                headerShown: false,
                animation: 'fade',
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="menu" />
              <Stack.Screen name="attendance" />
              <Stack.Screen name="album" />
              <Stack.Screen name="schedule" />
              <Stack.Screen name="shift" />
              <Stack.Screen name="event-management" />
              <Stack.Screen name="messages" />
              <Stack.Screen name="schedule-changes" />
            </Stack>
          </SafeAreaView>
        </AuthGuard>
      </CallProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
});