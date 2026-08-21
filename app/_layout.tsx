import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, usePathname, useRouter } from 'expo-router';
import { disableNetwork, enableNetwork } from 'firebase/firestore';
import React, { useMemo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, PanResponder, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { CallProvider } from '../contexts/CallContext';
import { db } from '../firebase';
import { refreshPushSubscription } from '../utils/setupPushToken';
import { navigateHome } from '../utils/navigationHome';
import { installGlobalUiSounds } from '../utils/uiSounds';


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
  const router = useRouter();
  const pathname = usePathname();
  const swipeTranslateX = useRef(new Animated.Value(0)).current;

  useEffect(() => installGlobalUiSounds(), []);

  const edgeHomePanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gestureState) => {
      const startX = evt.nativeEvent.pageX - gestureState.dx;
      return (
        startX <= 28 &&
        gestureState.dx > 34 &&
        Math.abs(gestureState.dy) < 24 &&
        !PUBLIC_PATHS.includes(pathname)
      );
    },
    onPanResponderMove: (_evt, gestureState) => {
      if (gestureState.dx <= 0) return;
      swipeTranslateX.setValue(Math.min(gestureState.dx, 190));
    },
    onPanResponderRelease: (_evt, gestureState) => {
      if (gestureState.dx > 90 && Math.abs(gestureState.dy) < 60 && pathname !== '/menu') {
        Animated.timing(swipeTranslateX, {
          toValue: 260,
          duration: 120,
          useNativeDriver: true,
        }).start(() => {
          swipeTranslateX.setValue(0);
          navigateHome(router);
        });
        return;
      }
      Animated.spring(swipeTranslateX, {
        toValue: 0,
        useNativeDriver: true,
        speed: 18,
        bounciness: 3,
      }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(swipeTranslateX, {
        toValue: 0,
        useNativeDriver: true,
        speed: 18,
        bounciness: 3,
      }).start();
    },
  }), [pathname, router, swipeTranslateX]);

  useEffect(() => {
    const setupLoggedInPush = async () => {
      if (Platform.OS !== 'web') return;
      try {
        const raw = await AsyncStorage.getItem('loggedInUser');
        if (!raw) return;
        const user = JSON.parse(raw);
        const accountId = user.accountId || (user.role === 'admin' ? 'admin' : '');
        if (accountId) await refreshPushSubscription(accountId);
      } catch (e) {
        console.warn('Push setup failed', e);
      }
    };

    setupLoggedInPush();

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
          <SafeAreaView style={styles.container} {...edgeHomePanResponder.panHandlers}>
            {!PUBLIC_PATHS.includes(pathname) && pathname !== '/menu' && (
              <View style={styles.homePreview}>
                <View style={styles.homePreviewIcon}>
                  <Text style={styles.homePreviewIconText}>⌂</Text>
                </View>
                <Text style={styles.homePreviewTitle}>ホーム</Text>
                <Text style={styles.homePreviewSub}>右へスワイプで戻る</Text>
              </View>
            )}
            <Animated.View style={[styles.screenLayer, { transform: [{ translateX: swipeTranslateX }] }]}>
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
            </Animated.View>
          </SafeAreaView>
        </AuthGuard>
      </CallProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF8F0',
  },
  screenLayer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  homePreview: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFF8F0',
    justifyContent: 'center',
    paddingLeft: 28,
  },
  homePreviewIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F0E1D4',
    marginBottom: 12,
  },
  homePreviewIconText: {
    fontSize: 30,
    color: '#00AEB8',
    fontWeight: '900',
  },
  homePreviewTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#3F302B',
  },
  homePreviewSub: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#8A7A70',
  },
});
