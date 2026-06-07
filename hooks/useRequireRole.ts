import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

/**
 * 指定ロールでのログインを検証するフック
 * - ログイン情報がない → ログイン画面にリダイレクト
 * - ロールが一致しない → ログイン画面にリダイレクト
 */
export function useRequireRole(requiredRole: string | string[]) {
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const [userInfo, setUserInfo] = useState<{ role: string; name: string } | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const raw = await AsyncStorage.getItem('loggedInUser');
        if (!raw) { router.replace('/'); return; }
        const user = JSON.parse(raw);
        const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
        if (!roles.includes(user.role)) {
          router.replace('/');
          return;
        }
        setUserInfo({ role: user.role, name: user.name || '' });
        setVerified(true);
      } catch {
        router.replace('/');
      }
    };
    check();
  }, []);

  return { verified, userInfo };
}