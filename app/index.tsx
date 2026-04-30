import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { collection, getDocs, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
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

export default function LoginScreen() {
  const router = useRouter();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // アプリ起動時に前回保存されたログイン情報をチェック
    const checkLoginStatus = async () => {
      try {
        const savedUser = await AsyncStorage.getItem('loggedInUser');
        if (savedUser) {
          const user = JSON.parse(savedUser);
          router.replace({ pathname: '/menu', params: { role: user.role, name: user.name } });
          return;
        }
      } catch (e) {
        console.error("Auto login failed", e);
      }
      setLoading(false);
    };
    checkLoginStatus();
  }, []);

  const handleLogin = async () => {
    if (!id || !password) {
      Alert.alert('エラー', 'IDとパスワードを入力してください。');
      return;
    }
    
    setLoading(true);

    // 管理者用の固定ログイン処理（データベース検索をバイパス）
    if (id === 'admin' && password === 'admin') {
      await AsyncStorage.setItem('loggedInUser', JSON.stringify({
        role: 'admin',
        name: '管理者'
      }));
      router.replace({ pathname: '/menu', params: { role: 'admin', name: '管理者' } });
      return;
    }

    try {
      // 通常のFirebaseアカウント検索
      const q = query(collection(db, 'accounts'), where('generatedId', '==', id), where('generatedPw', '==', password));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const userData = querySnapshot.docs[0].data();
        
        // ログイン情報を端末に保存（永続化）
        await AsyncStorage.setItem('loggedInUser', JSON.stringify({
          role: userData.role,
          name: userData.name
        }));

        router.replace({ pathname: '/menu', params: { role: userData.role, name: userData.name } });
      } else {
        Alert.alert('エラー', 'IDまたはパスワードが間違っています。');
      }
    } catch (error) {
      Alert.alert('エラー', '通信に失敗しました。');
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

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView 
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            {/* ★ 指定されたロゴ画像を反映 */}
            <Image 
              source={require('../assets/images/logo.png')} 
              style={styles.logoImage} 
              resizeMode="contain"
            />
          </View>
          <Text style={styles.appTitle}>ケーニーズ学童クラブ</Text>
        </View>

        <View style={styles.formContainer}>
          <Text style={styles.label}>ログインID</Text>
          <TextInput
            style={styles.input}
            placeholder="IDを入力"
            value={id}
            onChangeText={setId}
            autoCapitalize="none"
          />

          <Text style={styles.label}>パスワード</Text>
          <TextInput
            style={styles.input}
            placeholder="パスワードを入力"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} disabled={loading}>
            <Text style={styles.loginBtnText}>ログイン</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: COLORS.background 
  },
  scrollContainer: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'flex-start',
    paddingTop: '20%'
  },
  center: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: COLORS.background 
  },
  logoContainer: { 
    alignItems: 'center', 
    marginBottom: 40 
  },
  logoCircle: { 
    width: 140, 
    height: 140, 
    borderRadius: 70, 
    backgroundColor: COLORS.white, 
    justifyContent: 'center', 
    alignItems: 'center', 
    shadowColor: "#000", 
    shadowOpacity: 0.1, 
    shadowRadius: 10, 
    elevation: 5,
    overflow: 'hidden'
  },
  logoImage: {
    width: '90%',
    height: '90%',
  },
  appTitle: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    color: COLORS.text, 
    marginTop: 20 
  },
  formContainer: { 
    backgroundColor: COLORS.white, 
    padding: 24, 
    borderRadius: 16, 
    shadowColor: '#000', 
    shadowOpacity: 0.05, 
    shadowRadius: 10, 
    elevation: 3 
  },
  label: { 
    fontSize: 14, 
    fontWeight: 'bold', 
    color: COLORS.text, 
    marginBottom: 8 
  },
  input: { 
    backgroundColor: COLORS.background, 
    borderWidth: 1, 
    borderColor: COLORS.border, 
    borderRadius: 8, 
    padding: 16, 
    fontSize: 16, 
    marginBottom: 20 
  },
  loginBtn: { 
    backgroundColor: COLORS.primary, 
    padding: 16, 
    borderRadius: 8, 
    alignItems: 'center', 
    marginTop: 8 
  },
  loginBtnText: { 
    color: COLORS.white, 
    fontSize: 18, 
    fontWeight: 'bold' 
  },
});