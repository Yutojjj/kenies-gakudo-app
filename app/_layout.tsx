import { Stack } from 'expo-router';
import { COLORS } from '../constants/theme';

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.primary },
        headerTintColor: COLORS.white,
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      {/* ログイン画面（ヘッダー非表示） */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      
      {/* メインメニュー（ログイン後なので戻るボタンを隠す） */}
      <Stack.Screen name="menu" options={{ title: 'メニュー', headerBackVisible: false }} />
      
      {/* アカウント管理機能 */}
      <Stack.Screen name="account/list" options={{ title: 'アカウント管理', headerBackTitle: '戻る' }} />
      <Stack.Screen name="account/form" options={{ title: 'アカウント詳細', headerBackTitle: '戻る' }} />
    </Stack>
  );
}