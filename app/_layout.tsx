import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';

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