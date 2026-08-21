import AsyncStorage from '@react-native-async-storage/async-storage';
import { playUiSound } from './uiSounds';

export async function navigateHome(router: any) {
  playUiSound('back');
  try {
    const raw = await AsyncStorage.getItem('loggedInUser');
    if (!raw) throw new Error('ログイン情報がありません');
    JSON.parse(raw);
    router.replace('/menu' as any);
  } catch {
    router.replace('/' as any);
  }
}
