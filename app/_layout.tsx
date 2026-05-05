import { Stack } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';

// ピンチズームを無効化（iOS/Androidのように操作しやすくする）
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

export default function RootLayout() {
  return (
    // SafeAreaProvider でアプリ全体を包みます
    <SafeAreaProvider>
      {/* 
        SafeAreaView で Stack を包むことで、
        すべての画面の最上部にステータスバー分の余白が自動で入ります。
        背景色を COLORS.background に合わせることで重なりが自然になります。
      */}
      <SafeAreaView style={styles.container}>
        <Stack
          screenOptions={{
            // すべての画面で「attendance」などのシステムヘッダーを非表示にする
            headerShown: false,
            // 画面遷移時のアニメーションを自然にする設定
            animation: 'fade',
          }}
        >
          {/* 各画面の定義（必要に応じて追加してください） */}
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
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // 背景色を指定することで、ステータスバー付近の色をアプリと統一します
    backgroundColor: COLORS.background,
  },
});