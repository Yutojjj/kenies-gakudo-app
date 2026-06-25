import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'crypto-js';
import { useRouter } from 'expo-router';
import { collection, getDocs, query, where } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { refreshPushSubscription } from '../utils/setupPushToken';

const customAlert = (title: string, message?: string) => {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
};

const hashPassword = (password: string) => Crypto.SHA256(password).toString();

// ── ログイン試行制限 ──────────────────────────────────────
const MAX_ATTEMPTS = 5;       // 最大試行回数
const LOCKOUT_SECONDS = 60;   // ロックアウト時間（秒）

export default function LoginScreen() {
  const router = useRouter();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);

  // ブルートフォース対策
  const [failCount, setFailCount] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockRemaining, setLockRemaining] = useState(0);
  const lockTimerRef = useRef<any>(null);

  // ロックアウトカウントダウン
  useEffect(() => {
    if (lockedUntil) {
      lockTimerRef.current = setInterval(() => {
        const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
        if (remaining <= 0) {
          setLockedUntil(null);
          setLockRemaining(0);
          setFailCount(0);
          clearInterval(lockTimerRef.current);
        } else {
          setLockRemaining(remaining);
        }
      }, 1000);
    }
    return () => clearInterval(lockTimerRef.current);
  }, [lockedUntil]);

  useEffect(() => {
    const checkLoginStatus = async () => {
      try {
        const savedUser = await AsyncStorage.getItem('loggedInUser');
        if (savedUser) {
          const user = JSON.parse(savedUser);
          router.replace({ pathname: '/menu', params: { role: user.role, name: user.name } });
          return;
        }
      } catch (e) {
        console.error('Auto login failed', e);
      }
      setLoading(false);
    };
    checkLoginStatus();
  }, []);

  const handleLogin = async () => {
    // ロックアウト中チェック
    if (lockedUntil && Date.now() < lockedUntil) {
      customAlert('ロック中', `ログイン試行が${MAX_ATTEMPTS}回失敗しました。${lockRemaining}秒後に再試行してください。`);
      return;
    }

    if (!id || !password) {
      customAlert('エラー', 'IDとパスワードを入力してください。');
      return;
    }

    setLoading(true);

    try {
      // 管理者ハードコードログイン
      if (id === 'admin' && password === 'admin') {
        await AsyncStorage.setItem('loggedInUser', JSON.stringify({
          role: 'admin',
          name: '管理者',
          accountId: 'admin',
        }));
        if (Platform.OS === 'web') {
          refreshPushSubscription('admin').catch(() => {});
        }
        setLoading(false);
        router.replace({ pathname: '/menu', params: { role: 'admin', name: '管理者' } });
        return;
      }

      const hashedPassword = hashPassword(password);
      const q = query(collection(db, 'accounts'), where('generatedId', '==', id));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const userData = querySnapshot.docs[0].data();
        if (userData.generatedPw === hashedPassword || userData.generatedPw === password) {
          // ✅ 認証成功 → 試行カウントリセット
          setFailCount(0);
          setLockedUntil(null);
          await AsyncStorage.setItem('loggedInUser', JSON.stringify({
            role: userData.role,
            name: userData.name,
            accountId: querySnapshot.docs[0].id,
          }));
          if (Platform.OS === 'web') {
            refreshPushSubscription(querySnapshot.docs[0].id).catch(() => {});
          }
          router.replace({ pathname: '/menu', params: { role: userData.role, name: userData.name } });
          return;
        }
      }

      // ❌ 認証失敗
      const newCount = failCount + 1;
      setFailCount(newCount);
      if (newCount >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_SECONDS * 1000;
        setLockedUntil(until);
        customAlert('ロック', `ログインに${MAX_ATTEMPTS}回失敗しました。${LOCKOUT_SECONDS}秒間ロックします。`);
      } else {
        customAlert('エラー', `IDまたはパスワードが間違っています。（${newCount}/${MAX_ATTEMPTS}回）`);
      }

    } catch (error) {
      customAlert('エラー', '通信に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={{ marginTop: 16, color: COLORS.textLight }}>ログイン状態を確認中...</Text>
      </View>
    );
  }

  const isLocked = !!lockedUntil && Date.now() < lockedUntil;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Image source={require('../assets/images/logo.png')} style={styles.logoImage} resizeMode="contain" />
          </View>
          <Text style={styles.appTitle}>ケーニーズ学童クラブ</Text>
        </View>

        <View style={styles.formContainer}>
          <Text style={styles.label}>ログインID</Text>
          <TextInput
            style={[styles.input, isLocked && { opacity: 0.5 }]}
            placeholder="IDを入力"
            placeholderTextColor="#BBBBBB"
            value={id}
            onChangeText={setId}
            autoCapitalize="none"
            editable={!isLocked}
          />
          <Text style={styles.label}>パスワード</Text>
          <TextInput
            style={[styles.input, isLocked && { opacity: 0.5 }]}
            placeholder="パスワードを入力"
            placeholderTextColor="#BBBBBB"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!isLocked}
          />

          {isLocked && (
            <View style={styles.lockBanner}>
              <Text style={styles.lockText}>🔒 {lockRemaining}秒後に再試行できます</Text>
            </View>
          )}

          {failCount > 0 && !isLocked && (
            <Text style={styles.failText}>失敗 {failCount}/{MAX_ATTEMPTS} 回</Text>
          )}

          <TouchableOpacity
            style={[styles.loginBtn, isLocked && { backgroundColor: '#ccc' }]}
            onPress={handleLogin}
            disabled={loading || isLocked}
          >
            <Text style={styles.loginBtnText}>ログイン</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContainer: { flexGrow: 1, padding: 24, justifyContent: 'flex-start', paddingTop: '20%' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  logoContainer: { alignItems: 'center', marginBottom: 40 },
  logoCircle: { width: 140, height: 140, borderRadius: 70, backgroundColor: COLORS.white, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5, overflow: 'hidden' },
  logoImage: { width: '90%', height: '90%' },
  appTitle: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, marginTop: 20 },
  formContainer: { backgroundColor: COLORS.white, padding: 24, borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 3 },
  label: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  input: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 16, fontSize: 16, marginBottom: 20 },
  loginBtn: { backgroundColor: COLORS.primary, padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  loginBtnText: { color: COLORS.white, fontSize: 18, fontWeight: 'bold' },
  lockBanner: { backgroundColor: '#FFEBEE', borderRadius: 8, padding: 12, marginBottom: 12, alignItems: 'center' },
  lockText: { color: '#C62828', fontWeight: 'bold', fontSize: 14 },
  failText: { color: '#E65100', fontSize: 12, textAlign: 'center', marginBottom: 8 },
});