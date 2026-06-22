import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

// メニュー画面のヘッダーと同じベースカラー
const THEME_COLOR = '#00C0C7';

// 入室用QRコード読み取り画面 および 記録後のランディングページ
export default function QrScanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [status, setStatus] = useState<'scanning' | 'loading' | 'success' | 'error'>('loading');
  const [childName, setChildName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [time, setTime] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (id) {
      processEntry(id);
    } else {
      setStatus('scanning');
    }
  }, [id]);

  const processEntry = async (scannedData: string) => {
    setStatus('loading');
    try {
      let accountData = null;
      let finalAccountId = scannedData;

      // 1. まず「qrToken」として検索（一括更新で発行された新しいQRコード用）
      const q = query(collection(db, 'accounts'), where('qrToken', '==', scannedData));
      const tokenSnap = await getDocs(q);

      if (!tokenSnap.empty) {
        accountData = tokenSnap.docs[0].data();
        finalAccountId = tokenSnap.docs[0].id; // 実際のドキュメントIDを取得
      } else {
        // 2. 見つからなければ従来のドキュメントIDとして検索（移行前の古いQRコードも読めるようにする措置）
        const accountSnap = await getDoc(doc(db, 'accounts', scannedData));
        if (accountSnap.exists()) {
          accountData = accountSnap.data();
          finalAccountId = accountSnap.id;
        }
      }

      // どちらでも見つからなかった場合
      if (!accountData) {
        setErrorMsg('アカウントが見つかりません。無効なQRコードです。');
        setStatus('error');
        return;
      }

      const name = accountData.name || '不明';
      setChildName(name);

      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      setTime(timeStr);
      const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

      // 2. 登所ログをFirestoreに記録 (参照キーには実際のドキュメントIDを使用)
      await addDoc(collection(db, 'entry_logs'), {
        accountId: finalAccountId,
        name,
        school: accountData.school || '',
        grade: accountData.grade || '',
        scannedAt: serverTimestamp(),
        scannedAtISO: now.toISOString(),
        dateStr,
      });

      // 3. 保護者（このアカウント）に通知を送る
      try {
        const fcmSnap = await getDoc(doc(db, 'fcm_tokens', finalAccountId));
        if (fcmSnap.exists()) {
          const token = fcmSnap.data()?.token;
          if (token) {
            const appUrl = Platform.OS === 'web' ? window.location.origin : process.env.EXPO_PUBLIC_APP_URL || '';
            await fetch(`${appUrl}/api/send-notification`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tokens: [token],
                title: '🏫 入室のお知らせ',
                body: `${name}さんが ${timeStr} に学童に入室しました。`,
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

  const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    if (scanned) return;
    setScanned(true);
    let extractedId = data;
    try {
      // URL形式が含まれている場合（例: https://xxx.com/qr-scan?id=トークン）
      if (data.includes('?id=')) {
        const url = new URL(data.startsWith('http') ? data : `https://dummy.com${data}`);
        extractedId = url.searchParams.get('id') || data;
      }
    } catch(e) {
      // URLパースエラーの場合は文字列そのままで続行
    }
    processEntry(extractedId);
  };

  if (status === 'scanning') {
    if (!permission) {
      return <View style={styles.centerContainer}><ActivityIndicator size="large" color={THEME_COLOR} /></View>;
    }
    if (!permission.granted) {
      return (
        <SafeAreaView style={styles.centerContainer}>
          <Text style={{textAlign: 'center', marginBottom: 20}}>カメラの許可が必要です</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={requestPermission}>
            <Text style={styles.retryBtnText}>許可する</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={{flex: 1, backgroundColor: '#000'}}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        />
        <View style={styles.scannerOverlay}>
          <View style={styles.scannerBox} />
          <Text style={styles.scannerText}>入室用QRコードを枠内に合わせてください</Text>
          <TouchableOpacity style={[styles.retryBtn, {marginTop: 40}]} onPress={() => router.push('/menu')}>
            <Text style={styles.retryBtnText}>戻る</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBg}>
        <Text style={styles.headerTitle}>ケーニーズ学童クラブ</Text>
      </View>

      <View style={styles.card}>
        {status === 'loading' && (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={THEME_COLOR} />
            <Text style={styles.loadingText}>読み取り中...</Text>
          </View>
        )}

        {status === 'success' && (
          <View style={styles.stateBox}>
            <View style={styles.iconCircle}>
              <Ionicons name="checkmark-done" size={56} color={THEME_COLOR} />
            </View>
            <Text style={styles.successTitle}>入室の記録 完了</Text>
            <View style={styles.nameBox}>
              <Text style={styles.nameLabel}>お子様のお名前</Text>
              <Text style={styles.nameText}>{childName}</Text>
              <Text style={styles.timeText}>{time} 入室</Text>
            </View>
            <Text style={styles.successMsg}>
              保護者の方に入室通知を送りました。{'\n'}今日も1日よろしくね！
            </Text>
            <View style={styles.divider} />
            <Text style={styles.footerNote}>このページは閉じて構いません。</Text>
            {!id && (
              <TouchableOpacity style={[styles.retryBtn, {marginTop: 20}]} onPress={() => { setScanned(false); setStatus('scanning'); }}>
                <Text style={styles.retryBtnText}>次の人を記録する</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {status === 'error' && (
          <View style={styles.stateBox}>
            <View style={[styles.iconCircle, styles.iconError]}>
              <Ionicons name="alert-circle" size={56} color={COLORS.danger} />
            </View>
            <Text style={styles.errorTitle}>エラーが発生しました</Text>
            <Text style={styles.errorMsg}>{errorMsg}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => { setScanned(false); setStatus('scanning'); }}>
              <Text style={styles.retryBtnText}>もう一度やり直す</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.retryBtn, {marginTop: 10, backgroundColor: '#ccc'}]} onPress={() => router.push('/menu')}>
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
    backgroundColor: '#F8F9FA',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  headerBg: {
    backgroundColor: THEME_COLOR,
    paddingTop: Platform.OS === 'android' ? 40 : 20,
    paddingBottom: 60,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  card: {
    width: '90%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
    alignSelf: 'center',
    marginTop: -30,
    marginBottom: 20,
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
    backgroundColor: '#FAFAFA',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 3,
    borderColor: THEME_COLOR,
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
    backgroundColor: '#FAFAFA',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: THEME_COLOR,
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
    color: THEME_COLOR,
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
    backgroundColor: THEME_COLOR,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  scannerOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  scannerBox: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: THEME_COLOR,
    backgroundColor: 'transparent',
    marginBottom: 20,
  },
  scannerText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});