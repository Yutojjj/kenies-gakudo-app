import AsyncStorage from '@react-native-async-storage/async-storage';
import { playUiSound } from './uiSounds';

export async function navigateHome(router: any) {
  playUiSound('back');
  try {
    const raw = await AsyncStorage.getItem('loggedInUser');
    const user = raw ? JSON.parse(raw) : {};
    router.replace({
      pathname: '/menu',
      params: {
        role: user.role || 'user',
        name: user.name || '',
      },
    } as any);
  } catch {
    router.replace('/' as any);
  }
}
