import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type HolidayPeriod = { id: string, name: string, start: string, end: string };

export default function HolidaysSettingScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [periods, setPeriods] = useState<HolidayPeriod[]>([]);
  
  const [modalVisible, setModalVisible] = useState(false);
  const [periodName, setPeriodName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'holidays_data'), (docSnap) => {
      if (docSnap.exists() && docSnap.data().periods) {
        setPeriods(docSnap.data().periods);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSave = async () => {
    if (!periodName || !startDate || !endDate) {
      Alert.alert('エラー', 'すべての項目を入力してください。');
      return;
    }

    const newPeriod: HolidayPeriod = {
      id: Date.now().toString(),
      name: periodName,
      start: startDate,
      end: endDate
    };

    const newPeriods = [...periods, newPeriod].sort((a, b) => a.start.localeCompare(b.start));
    
    try {
      await setDoc(doc(db, 'settings', 'holidays_data'), { periods: newPeriods }, { merge: true });
      setModalVisible(false);
      setPeriodName(''); setStartDate(''); setEndDate('');
    } catch (e) {
      Alert.alert('エラー', '保存に失敗しました');
    }
  };

  const handleDelete = async (id: string) => {
    if (Platform.OS === 'web') {
      if (window.confirm('この期間を削除しますか？')) {
        const newPeriods = periods.filter(p => p.id !== id);
          await setDoc(doc(db, 'settings', 'holidays_data'), { periods: newPeriods }, { merge: true });
      }
      return;
    }
    Alert.alert('削除確認', 'この期間を削除しますか？', [
      { text: 'キャンセル' },
      { text: '削除', style: 'destructive', onPress: async () => {
          const newPeriods = periods.filter(p => p.id !== id);
          await setDoc(doc(db, 'settings', 'holidays_data'), { periods: newPeriods }, { merge: true });
      }}
    ]);
  };

  const openAddModal = () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    setStartDate(todayStr);
    setEndDate(todayStr);
    setModalVisible(true);
  };

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color={COLORS.primary}/></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color={COLORS.text} /></TouchableOpacity>
        <Text style={styles.headerTitle}>長期休み・祝日設定</Text>
      </View>

      <ScrollView style={styles.scrollArea}>
        <Text style={styles.instructionText}>
          ここに登録された期間中は、スケジュール画面で学校別下校時刻が「自動入力」されなくなります。
        </Text>

        {periods.map(p => (
          <View key={p.id} style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{p.name}</Text>
              <Text style={styles.cardDate}>{p.start} 〜 {p.end}</Text>
            </View>
            <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(p.id)}>
              <Ionicons name="trash" size={20} color={COLORS.danger} />
            </TouchableOpacity>
          </View>
        ))}

        {periods.length === 0 && (
          <Text style={styles.noDataText}>設定された期間はありません。</Text>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={openAddModal}>
        <Ionicons name="add" size={32} color={COLORS.white} />
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>特別期間の追加</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}><Ionicons name="close" size={28} color={COLORS.textLight} /></TouchableOpacity>
            </View>

            <Text style={styles.label}>名称 (例: 夏休み, 祝日)</Text>
            <TextInput style={styles.input} value={periodName} onChangeText={setPeriodName} placeholder="期間の名称" />

            <Text style={styles.label}>開始日 (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} keyboardType="numeric" placeholder="2026-07-20" />

            <Text style={styles.label}>終了日 (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} value={endDate} onChangeText={setEndDate} keyboardType="numeric" placeholder="2026-08-31" />
            <Text style={{ fontSize: 12, color: COLORS.textLight, marginBottom: 20 }}>※1日だけの場合は、開始と終了を同じ日付にしてください。</Text>

            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>登録する</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border },
  backBtn: { marginRight: 16 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  scrollArea: { padding: 16 },
  instructionText: { fontSize: 14, color: COLORS.textLight, marginBottom: 16, lineHeight: 20 },
  card: { flexDirection: 'row', backgroundColor: COLORS.white, padding: 16, borderRadius: 12, marginBottom: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text, marginBottom: 4 },
  cardDate: { fontSize: 14, color: COLORS.primary, fontWeight: 'bold' },
  deleteBtn: { padding: 8, backgroundColor: '#FFF0F0', borderRadius: 8, borderWidth: 1, borderColor: '#FFE0E0' },
  noDataText: { textAlign: 'center', color: COLORS.textLight, marginTop: 40 },
  fab: { position: 'absolute', right: 20, bottom: 40, backgroundColor: COLORS.primary, width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.primary, shadowOpacity: 0.4, shadowRadius: 8, elevation: 5 },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: COLORS.white, padding: 24, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  label: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 14, fontSize: 16, marginBottom: 16, backgroundColor: '#FAFAFA' },
  saveBtn: { backgroundColor: COLORS.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' }
});