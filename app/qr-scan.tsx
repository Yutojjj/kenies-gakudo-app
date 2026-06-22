import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

// QRコードをスキャンした後に遷移するランディングページ
// URL: /qr-scan?id=<accountDocId>
// 処理：
//   1. アカウント情報を取得
//   2. homecoming_logs にログを書き込む
//   3. /api/send-notification で保護者に通知を送る

export default function QrScanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [childName, setChildName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [time, setTime] = useState('');

  useEffect(() => {
    if (!id) {
      setErrorMsg('QRコードが無効です。');
      setStatus('error');
      return;
    }
    processHomecoming(id);
  }, [id]);

  const processHomecoming = async (accountId: string) => {
    try {
      // 1. アカウント情報取得
      const accountSnap = await getDoc(doc(db, 'accounts', accountId));
      if (!accountSnap.exists()) {
        setErrorMsg('アカウントが見つかりません。');
        setStatus('error');
        return;
      }

      const account = accountSnap.data();
      const name = account.name || '不明';
      setChildName(name);

      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      setTime(timeStr);

      // 2. 帰宅ログをFirestoreに記録
      await addDoc(collection(db, 'homecoming_logs'), {
        accountId,
        name,
        school: account.school || '',
        grade: account.grade || '',
        scannedAt: serverTimestamp(),
        scannedAtISO: now.toISOString(),
      });

      // 3. 保護者（このアカウント）に通知を送る
      try {
        const tokenSnap = await getDoc(doc(db, 'fcm_tokens', accountId));
        if (tokenSnap.exists()) {
          const token = tokenSnap.data()?.token;
          if (token) {
            const appUrl = Platform.OS === 'web' ? window.location.origin : process.env.EXPO_PUBLIC_APP_URL || '';
            await fetch(`${appUrl}/api/send-notification`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tokens: [token],
                title: '🏠 帰宅のお知らせ',
                body: `${name}さんが ${timeStr} に学童を出発しました。`,
                url: '/menu',
              }),
            });
          }
        }
      } catch (notifError) {
        // 通知失敗はログに出すが処理は続行
        console.warn('通知送信エラー:', notifError);
      }

      setStatus('success');
    } catch (err) {
      console.error(err);
      setErrorMsg('処理中にエラーが発生しました。');
      setStatus('error');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        {/* ロゴ的なヘッダー */}
        <View style={styles.logoRow}>
          <Text style={styles.logoText}>ケーニーズ学童クラブ</Text>
        </View>

        {status === 'loading' && (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>処理中...</Text>
          </View>
        )}

        {status === 'success' && (
          <View style={styles.stateBox}>
            <View style={styles.iconCircle}>
              <Ionicons name="home" size={56} color={COLORS.primary} />
            </View>
            <Text style={styles.successTitle}>帰宅スキャン完了</Text>
            <View style={styles.nameBox}>
              <Text style={styles.nameLabel}>お子様のお名前</Text>
              <Text style={styles.nameText}>{childName}</Text>
              <Text style={styles.timeText}>{time} 出発</Text>
            </View>
            <Text style={styles.successMsg}>
              保護者の方に帰宅通知を送りました。{'\n'}気をつけて帰ってね！
            </Text>
            <View style={styles.divider} />
            <Text style={styles.footerNote}>このページは閉じて構いません。</Text>
          </View>
        )}

        {status === 'error' && (
          <View style={styles.stateBox}>
            <View style={[styles.iconCircle, styles.iconError]}>
              <Ionicons name="alert-circle" size={56} color={COLORS.danger} />
            </View>
            <Text style={styles.errorTitle}>エラーが発生しました</Text>
            <Text style={styles.errorMsg}>{errorMsg}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => router.push('/menu')}>
              <Text style={styles.retryBtnText}>トップへ戻る</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF8E7',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  logoRow: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    alignItems: 'center',
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  stateBox: {
    padding: 32,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textLight,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FFF8E7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 3,
    borderColor: COLORS.primary,
  },
  iconError: {
    backgroundColor: '#FFF0F0',
    borderColor: COLORS.danger,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 20,
  },
  nameBox: {
    width: '100%',
    backgroundColor: '#FFF8E7',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  nameLabel: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 6,
    fontWeight: 'bold',
  },
  nameText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 6,
  },
  timeText: {
    fontSize: 16,
    color: COLORS.secondary,
    fontWeight: 'bold',
  },
  successMsg: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 20,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: COLORS.border,
    marginBottom: 16,
  },
  footerNote: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.danger,
    marginBottom: 12,
  },
  errorMsg: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
