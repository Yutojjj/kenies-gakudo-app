import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
    Alert, Image, Modal, Platform, SafeAreaView,
    ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import SignaturePad from '../components/SignaturePad';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type Record_ = {
  id: string;
  userName: string;
  month: string;
  count: number;
  amount: number;
  signatureData?: string;
  signedAt?: any;
};

const MONTHS = (() => {
  const result = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  return result;
})();

export default function PaidTransportScreen() {
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[0]);
  const [records, setRecords] = useState<Record_[]>([]);
  const [editTarget, setEditTarget] = useState<Record_ | null>(null);
  const [editCount, setEditCount] = useState('');
  const [signTarget, setSignTarget] = useState<Record_ | null>(null);
  const [previewSign, setPreviewSign] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'paid_transport_records'), where('month', '==', selectedMonth)),
      snap => setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as Record_)))
    );
    return () => unsub();
  }, [selectedMonth]);

  const saveEdit = async () => {
    if (!editTarget) return;
    const count = parseInt(editCount);
    if (isNaN(count) || count < 0) { Alert.alert('エラー', '有効な回数を入力してください'); return; }
    await setDoc(doc(db, 'paid_transport_records', editTarget.id), {
      ...editTarget, count, amount: count * 500,
    }, { merge: true });
    setEditTarget(null);
  };

  const downloadSign = (dataUrl: string, userName: string) => {
    if (Platform.OS !== 'web') return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `signature_${userName}_${selectedMonth}.png`;
    a.click();
  };

  const totalAmount = records.reduce((sum, r) => sum + (r.amount || 0), 0);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>有料送迎 管理</Text>
      </View>

      {/* 月選択 */}
      <View style={styles.monthRow}>
        {MONTHS.map(m => (
          <TouchableOpacity
            key={m}
            style={[styles.monthBtn, selectedMonth === m && styles.monthBtnActive]}
            onPress={() => setSelectedMonth(m)}
          >
            <Text style={[styles.monthBtnText, selectedMonth === m && { color: '#fff' }]}>
              {m.replace('-', '年')}月
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 合計 */}
      <View style={styles.totalBar}>
        <Text style={styles.totalLabel}>{selectedMonth.replace('-','年')}月 合計</Text>
        <Text style={styles.totalAmount}>{totalAmount.toLocaleString()}円</Text>
        <Text style={styles.totalCount}>({records.length}名)</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
        {records.length === 0 ? (
          <Text style={{ textAlign: 'center', color: COLORS.textLight, marginTop: 40 }}>
            この月の記録はありません
          </Text>
        ) : (
          records.map(r => (
            <View key={r.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardName}>{r.userName}</Text>
                <View style={styles.cardBadges}>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{r.count}回</Text>
                  </View>
                  <View style={styles.amountBadge}>
                    <Text style={styles.amountBadgeText}>{(r.amount||0).toLocaleString()}円</Text>
                  </View>
                </View>
              </View>

              {/* サイン状況 */}
              <View style={styles.signRow}>
                {r.signatureData ? (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#4CAF50" />
                    <Text style={styles.signedText}>サイン済み</Text>
                    {r.signedAt && (
                      <Text style={styles.signedDate}>
                        {r.signedAt?.toDate?.()?.toLocaleDateString('ja-JP') || ''}
                      </Text>
                    )}
                  </>
                ) : (
                  <>
                    <Ionicons name="ellipse-outline" size={18} color="#aaa" />
                    <Text style={styles.unsignedText}>未サイン</Text>
                  </>
                )}
              </View>

              {/* アクションボタン */}
              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => { setEditTarget(r); setEditCount(String(r.count)); }}
                >
                  <Ionicons name="pencil-outline" size={15} color={COLORS.primary} />
                  <Text style={styles.actionBtnText}>回数編集</Text>
                </TouchableOpacity>

                {r.signatureData && (
                  <>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => setPreviewSign(r.signatureData!)}
                    >
                      <Ionicons name="eye-outline" size={15} color="#9C27B0" />
                      <Text style={[styles.actionBtnText, { color: '#9C27B0' }]}>サイン確認</Text>
                    </TouchableOpacity>
                    {Platform.OS === 'web' && (
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => downloadSign(r.signatureData!, r.userName)}
                      >
                        <Ionicons name="download-outline" size={15} color="#FF7043" />
                        <Text style={[styles.actionBtnText, { color: '#FF7043' }]}>DL</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}

                {!r.signatureData && (
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => setSignTarget(r)}
                  >
                    <Ionicons name="create-outline" size={15} color="#FF7043" />
                    <Text style={[styles.actionBtnText, { color: '#FF7043' }]}>代理サイン</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => {
                    Alert.alert('削除確認', `${r.userName}の記録を削除しますか？`, [
                      { text: 'キャンセル' },
                      { text: '削除', style: 'destructive', onPress: () => deleteDoc(doc(db, 'paid_transport_records', r.id)) }
                    ]);
                  }}
                >
                  <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                  <Text style={[styles.actionBtnText, { color: COLORS.danger }]}>削除</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* 回数編集モーダル */}
      <Modal visible={!!editTarget} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editTarget?.userName} の回数編集</Text>
            <TextInput
              style={styles.editInput}
              value={editCount}
              onChangeText={setEditCount}
              keyboardType="number-pad"
              placeholder="回数"
              placeholderTextColor="#bbb"
            />
            <Text style={{ textAlign: 'center', color: '#888', marginBottom: 16 }}>
              {parseInt(editCount) || 0}回 × 500円 = {((parseInt(editCount) || 0) * 500).toLocaleString()}円
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#eee' }]} onPress={() => setEditTarget(null)}>
                <Text style={{ color: '#666', fontWeight: 'bold' }}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: COLORS.primary }]} onPress={saveEdit}>
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 代理サインモーダル */}
      <Modal visible={!!signTarget} transparent animationType="slide">
        <View style={styles.signOverlay}>
          <View style={styles.signContent}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={styles.modalTitle}>{signTarget?.userName} の代理サイン</Text>
              <TouchableOpacity onPress={() => setSignTarget(null)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            <SignaturePad
              onSave={async (dataUrl) => {
                if (!signTarget) return;
                await setDoc(doc(db, 'paid_transport_records', signTarget.id), {
                  signatureData: dataUrl, signedAt: new Date(),
                }, { merge: true });
                setSignTarget(null);
                Alert.alert('完了', 'サインを保存しました');
              }}
            />
          </View>
        </View>
      </Modal>

      {/* サインプレビューモーダル */}
      <Modal visible={!!previewSign} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { padding: 0, overflow: 'hidden' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16 }}>
              <Text style={styles.modalTitle}>サイン確認</Text>
              <TouchableOpacity onPress={() => setPreviewSign(null)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            {previewSign && (
              <Image source={{ uri: previewSign }} style={{ width: '100%', height: 200 }} resizeMode="contain" />
            )}
            <View style={{ padding: 16 }}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: COLORS.primary, width: '100%' }]}
                onPress={() => setPreviewSign(null)}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>閉じる</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037' },
  monthRow: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 8, paddingHorizontal: 12, gap: 6 },
  monthBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border },
  monthBtnActive: { backgroundColor: '#FF7043', borderColor: '#FF7043' },
  monthBtnText: { fontSize: 13, fontWeight: 'bold', color: COLORS.text },
  totalBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#FFF3E0', gap: 8 },
  totalLabel: { fontSize: 13, color: '#FF7043', fontWeight: 'bold', flex: 1 },
  totalAmount: { fontSize: 20, fontWeight: 'bold', color: '#FF7043' },
  totalCount: { fontSize: 12, color: '#aaa' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  cardBadges: { flexDirection: 'row', gap: 6 },
  countBadge: { backgroundColor: '#5B9BD5', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  countBadgeText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  amountBadge: { backgroundColor: '#FF7043', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  amountBadgeText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  signRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  signedText: { fontSize: 12, color: '#4CAF50', fontWeight: 'bold' },
  signedDate: { fontSize: 11, color: '#aaa' },
  unsignedText: { fontSize: 12, color: '#aaa' },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#f9f9f9' },
  actionBtnText: { fontSize: 12, color: COLORS.primary, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#fff', borderRadius: 20, padding: 20, width: '85%' },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 16 },
  editInput: { borderWidth: 1.5, borderColor: '#ddd', borderRadius: 12, padding: 14, fontSize: 24, textAlign: 'center', color: '#333', marginBottom: 8 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  signOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  signContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
});