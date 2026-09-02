import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { db } from '../../firebase';
import { navigateHome } from '../../utils/navigationHome';

// メニュー画面のヘッダーと同じベースカラー
const THEME_COLOR = '#00C0C7';

// ランダムなQR用トークンを生成する関数
const generateToken = () => {
  return 'qr_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
};

export default function QrUpdaterScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const customAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleBatchUpdate = async () => {
    const confirmMsg = 'すべてのアカウントのQRコード(qrToken)を新しく再発行します。古いQRコードは無効になりますがよろしいですか？';
    
    if (Platform.OS === 'web') {
      if (!window.confirm(confirmMsg)) return;
    } else {
      Alert.alert('確認', confirmMsg, [
        { text: 'キャンセル', style: 'cancel' },
        { text: '一括更新する', style: 'destructive', onPress: executeUpdate }
      ]);
      return;
    }
    
    executeUpdate();
  };

  const executeUpdate = async () => {
    setLoading(true);
    setLog(['更新処理を開始します...']);
    
    try {
      const snapshot = await getDocs(collection(db, 'accounts'));
      const docs = snapshot.docs;
      setLog(prev => [...prev, `${docs.length}件のアカウントが見つかりました。`]);

      // Firestoreのバッチは1回につき500件までのため分割処理
      const CHUNK_SIZE = 400;
      let updatedCount = 0;

      for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
        const chunk = docs.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);

        chunk.forEach(d => {
          const newToken = generateToken();
          // qrTokenフィールドを新規追加（または上書き）
          batch.update(doc(db, 'accounts', d.id), { qrToken: newToken });
        });

        await batch.commit();
        updatedCount += chunk.length;
        setLog(prev => [...prev, `${updatedCount}件の更新が完了しました...`]);
      }

      setLog(prev => [...prev, '✅ 全てのQRコードの更新が完了しました！']);
      customAlert('成功', '全アカウントのQRコード用トークンを一括更新しました。');
    } catch (error: any) {
      console.error(error);
      setLog(prev => [...prev, `❌ エラーが発生しました: ${error.message}`]);
      customAlert('エラー', '更新中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBg}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigateHome(router)}>
          <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>QRコード一括更新</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.warningBox}>
          <Ionicons name="warning" size={24} color="#E65100" />
          <Text style={styles.warningText}>
            この処理を実行すると、全ユーザーに新しいQRコードのID（qrToken）が割り当てられます。
          </Text>
        </View>

        <TouchableOpacity 
          style={[styles.updateBtn, loading && { backgroundColor: '#ccc' }]} 
          onPress={handleBatchUpdate}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.updateBtnText}>全アカウントのQRを新しくする</Text>
          )}
        </TouchableOpacity>

        <View style={styles.logBox}>
          <Text style={styles.logTitle}>処理ログ:</Text>
          <ScrollView style={styles.logScroll}>
            {log.map((line, index) => (
              <Text key={index} style={styles.logLine}>{line}</Text>
            ))}
            {log.length === 0 && <Text style={styles.logEmpty}>待機中...</Text>}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  headerBg: {
    backgroundColor: '#FFF8F0',
    paddingTop: Platform.OS === 'android' ? 40 : 20,
    paddingBottom: 60,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#3F302B',
    letterSpacing: 1,
  },
  card: {
    width: '90%',
    maxWidth: 500,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
    alignSelf: 'center',
    marginTop: -30,
  },
  warningBox: {
    flexDirection: 'row',
    backgroundColor: '#FFF3E0',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: '#FFB300',
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: '#E65100',
    marginLeft: 12,
    lineHeight: 20,
    fontWeight: 'bold',
  },
  updateBtn: {
    backgroundColor: '#E53935',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  updateBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  logBox: {
    backgroundColor: '#263238',
    borderRadius: 12,
    padding: 16,
    height: 250,
  },
  logTitle: {
    color: '#B0BEC5',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  logScroll: {
    flex: 1,
  },
  logLine: {
    color: '#ECEFF1',
    fontSize: 13,
    marginBottom: 6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  logEmpty: {
    color: '#546E7A',
    fontSize: 13,
    fontStyle: 'italic',
  },
});
