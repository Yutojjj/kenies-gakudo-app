import AsyncStorage from '@react-native-async-storage/async-storage';
import { playUiSound } from './uiSounds';

const NAVIGATION_RETURN_DESTINATION_KEY = 'navigationReturnDestination';

export async function setNavigationReturnDestination(destination: 'admin-more') {
  await AsyncStorage.setItem(NAVIGATION_RETURN_DESTINATION_KEY, JSON.stringify({ destination, createdAt: Date.now() }));
}

export async function clearNavigationReturnDestination() {
  await AsyncStorage.removeItem(NAVIGATION_RETURN_DESTINATION_KEY);
}

export async function navigateHome(router: any) {
  playUiSound('back');
  try {
    const raw = await AsyncStorage.getItem('loggedInUser');
    if (!raw) throw new Error('ログイン情報がありません');
    JSON.parse(raw);
    const returnRaw = await AsyncStorage.getItem(NAVIGATION_RETURN_DESTINATION_KEY);
    if (returnRaw) {
      await AsyncStorage.removeItem(NAVIGATION_RETURN_DESTINATION_KEY);
      try {
        const saved = JSON.parse(returnRaw);
        if (saved.destination === 'admin-more' && Date.now() - Number(saved.createdAt || 0) < 60 * 60 * 1000) {
          router.replace('/admin-more' as any);
          return;
        }
      } catch {}
    }
    router.replace('/menu' as any);
  } catch {
    await AsyncStorage.removeItem(NAVIGATION_RETURN_DESTINATION_KEY);
    router.replace('/' as any);
  }
}
