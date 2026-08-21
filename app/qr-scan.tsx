import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { sendPushNotification } from '../utils/sendPushNotification';

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
  
  // カメラの向きを管理するステート（初期値は外カメラ）
  const [facing, setFacing] = useState<'back' | 'front'>('back');

  const goHome = async () => {
    try {
      const raw = await AsyncStorage.getItem('loggedInUser');
      const user = raw ? JSON.parse(raw) : {};
      router.replace({
        pathname: '/menu',
        params: {
          role: user.role || 'admin',
          name: user.name || '',
        },
      } as any);
    } catch {
      router.replace('/' as any);
    }
  };

  useEffect(() => {
    if (id) {
      // パラメータにスラッシュ等が含まれているとクラッシュするためサニタイズ（安全化）
      const cleanId = typeof id === 'string' ? id.replace(/[^a-zA-Z0-9_-]/g, '') : '';
      processEntry(cleanId);
    } else {
      setStatus('scanning');
    }
  }, [id]);

  const processEntry = async (scannedData: string) => {
    if (!scannedData) {
      setErrorMsg('QRコードからデータを読み取れませんでした。');
      setStatus('error');
      return;
    }

    setStatus('loading');
    try {
      let accountData = null;
      let finalAccountId = scannedData;

      // 1. まず「qrToken」として検索（一括更新で発行された新しいQRコード用）
      try {
        const q = query(collection(db, 'accounts'), where('qrToken', '==', scannedData));
        const tokenSnap = await getDocs(q);
        if (!tokenSnap.empty) {
          accountData = tokenSnap.docs[0].data();
          finalAccountId = tokenSnap.docs[0].id;
        }
      } catch (tokenErr) {
        console.warn("qrToken検索エラー:", tokenErr);
      }

      // 2. 見つからなければ従来のドキュメントIDとして検索（移行前の古いQRコードを読んだ場合の措置）
      // ※ここで不正な文字列が渡されるとエラーで落ちるため、独立したtry-catchで保護します
      if (!accountData) {
        try {
          const accountSnap = await getDoc(doc(db, 'accounts', scannedData));
          if (accountSnap.exists()) {
            accountData = accountSnap.data();
            finalAccountId = accountSnap.id;
          }
        } catch (docErr) {
          console.warn("docID検索エラー:", docErr);
        }
      }

      // どちらでも見つからなかった場合
      if (!accountData) {
        setErrorMsg(`アカウントが見つかりません。無効なQRコードです。\n\n【読み取ったデータ】\n${scannedData}`);
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
        await sendPushNotification({
          accountIds: [finalAccountId],
          title: '🏫 入室のお知らせ',
          body: `${name}さんが ${timeStr} に学童に入室しました。`,
          url: '/menu',
        });
      } catch (notifError) {
        console.warn('通知送信エラー:', notifError);
      }

      setStatus('success');
    } catch (err: any) {
      console.error(err);
      // 万が一別のエラーが出ても、原因が画面に表示されるように修正
      setErrorMsg(`処理中に予期せぬエラーが発生しました。\n\n【読み取ったデータ】\n${scannedData}\n\n【エラー内容】\n${err?.message || ''}`);
      setStatus('error');
    }
  };

  const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    if (scanned) return;
    setScanned(true);
    
    let extractedId = data;
    
    // URL形式が含まれている場合、確実に「?id=」の後ろを文字列カットして抽出
    if (data.includes('?id=')) {
      extractedId = data.split('?id=')[1].split('&')[0];
    }
    
    // URLエンコードされている場合に戻す (例: %20 など)
    try {
      extractedId = decodeURIComponent(extractedId);
    } catch (e) {}
    
    // データベースがクラッシュするのを完全に防ぐため、英数字とハイフン、アンダースコア以外を除去
    extractedId = extractedId.replace(/[^a-zA-Z0-9_-]/g, '');

    processEntry(extractedId);
  };

  // 内カメラ・外カメラの切り替え処理
  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  if (status === 'scanning') {
    if (!permission) {
      return <View style={styles.centerContainer}><ActivityIndicator size="large" color={THEME_COLOR} /></View>;
    }
    if (!permission.granted) {
      return (
        <SafeAreaView style={styles.centerContainer}>
          <View style={styles.simpleHeader}>
            <TouchableOpacity style={styles.headerBackBtn} onPress={goHome} activeOpacity={0.78}>
              <Ionicons name="chevron-back" size={24} color="#5D4037" />
            </TouchableOpacity>
            <Text style={styles.simpleHeaderTitle}>入室QRリーダー</Text>
          </View>
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
          facing={facing}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        />
        <View style={styles.scanHeader}>
          <TouchableOpacity style={styles.scanHeaderBackBtn} onPress={goHome} activeOpacity={0.78}>
            <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.scanHeaderTitle}>入室QRリーダー</Text>
        </View>
        <TouchableOpacity style={styles.flipBtn} onPress={toggleCameraFacing} activeOpacity={0.78}>
          <Ionicons name="camera-reverse" size={32} color="#FFFFFF" />
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBg}>
        <TouchableOpacity style={styles.resultHeaderBackBtn} onPress={goHome} activeOpacity={0.78}>
          <Ionicons name="chevron-back" size={24} color="#3F302B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>ケーニーズクラブ学童保育</Text>
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
  simpleHeader: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 24 : 8,
    left: 0,
    right: 0,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    backgroundColor: '#FFF8F0',
  },
  headerBackBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  simpleHeaderTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#5D4037',
  },
  scanHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Platform.OS === 'android' ? 28 : 10,
    minHeight: Platform.OS === 'android' ? 82 : 64,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.48)',
    zIndex: 20,
  },
  scanHeaderBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  scanHeaderTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerBg: {
    backgroundColor: '#FFF8F0',
    paddingTop: Platform.OS === 'android' ? 40 : 20,
    paddingBottom: 60,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  resultHeaderBackBtn: {
    position: 'absolute',
    left: 14,
    top: Platform.OS === 'android' ? 34 : 14,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#3F302B',
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
    fontSize: 13,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
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
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
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
  backBtn: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  backBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  flipBtn: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
});
