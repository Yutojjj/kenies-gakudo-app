import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type HolidayPeriod = { id: string, name: string, start: string, end: string };

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

const toDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function HolidaysSettingScreen() {
  const router = useRouter();
  const [periods, setPeriods] = useState<HolidayPeriod[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [periodName, setPeriodName] = useState('');
  const [startDateObj, setStartDateObj] = useState(new Date());
  const [endDateObj, setEndDateObj] = useState(new Date());

  // カレンダー用
  const [calTarget, setCalTarget] = useState<'start' | 'end'>('start');
  const [calVisible, setCalVisible] = useState(false);
  const [calViewDate, setCalViewDate] = useState(new Date());

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'holidays_data'), (docSnap) => {
      if (docSnap.exists() && docSnap.data().periods) {
        setPeriods(docSnap.data().periods);
      }
    });
    return () => unsubscribe();
  }, []);

  const openCalendar = (target: 'start' | 'end') => {
    setCalTarget(target);
    setCalViewDate(target === 'start' ? new Date(startDateObj) : new Date(endDateObj));
    setCalVisible(true);
  };

  const selectCalDay = (day: number) => {
    const selected = new Date(calViewDate.getFullYear(), calViewDate.getMonth(), day);
    if (calTarget === 'start') {
      setStartDateObj(selected);
      if (selected > endDateObj) setEndDateObj(selected);
    } else {
      setEndDateObj(selected);
      if (selected < startDateObj) setStartDateObj(selected);
    }
    setCalVisible(false);
  };

  const generateCalDays = () => {
    const year = calViewDate.getFullYear();
    const month = calViewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  };

  const handleSave = async () => {
    if (!periodName) {
      Alert.alert('エラー', '名称を入力してください。');
      return;
    }
    const newPeriod: HolidayPeriod = {
      id: Date.now().toString(),
      name: periodName,
      start: toDateStr(startDateObj),
      end: toDateStr(endDateObj),
    };
    const newPeriods = [...periods, newPeriod].sort((a, b) => a.start.localeCompare(b.start));
    try {
      await setDoc(doc(db, 'settings', 'holidays_data'), { periods: newPeriods }, { merge: true });
      setModalVisible(false);
      setPeriodName('');
    } catch (e) {
      Alert.alert('エラー', '保存に失敗しました');
    }
  };

  const handleDelete = async (id: string) => {
    const doDelete = async () => {
      const newPeriods = periods.filter(p => p.id !== id);
      await setDoc(doc(db, 'settings', 'holidays_data'), { periods: newPeriods }, { merge: true });
    };
    if (Platform.OS === 'web') {
      if (window.confirm('この期間を削除しますか？')) doDelete();
      return;
    }
    Alert.alert('削除確認', 'この期間を削除しますか？', [
      { text: 'キャンセル' },
      { text: '削除', style: 'destructive', onPress: doDelete },
    ]);
  };

  const openAddModal = () => {
    const today = new Date();
    setStartDateObj(today);
    setEndDateObj(today);
    setPeriodName('');
    setModalVisible(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
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

      {/* ── 追加モーダル ── */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>特別期間の追加</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={28} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>名称 (例: 夏休み, 祝日)</Text>
            <TextInput style={styles.input} value={periodName} onChangeText={setPeriodName} placeholder="期間の名称" />

            <Text style={styles.label}>開始日</Text>
            <TouchableOpacity style={styles.datePickerBtn} onPress={() => openCalendar('start')}>
              <Ionicons name="calendar-outline" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
              <Text style={styles.datePickerText}>{toDateStr(startDateObj)}</Text>
              <Ionicons name="chevron-down" size={16} color={COLORS.textLight} />
            </TouchableOpacity>

            <Text style={styles.label}>終了日</Text>
            <TouchableOpacity style={styles.datePickerBtn} onPress={() => openCalendar('end')}>
              <Ionicons name="calendar-outline" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
              <Text style={styles.datePickerText}>{toDateStr(endDateObj)}</Text>
              <Ionicons name="chevron-down" size={16} color={COLORS.textLight} />
            </TouchableOpacity>
            <Text style={{ fontSize: 12, color: COLORS.textLight, marginBottom: 20 }}>
              ※1日だけの場合は、開始と終了を同じ日付にしてください。
            </Text>

            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>登録する</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── カレンダーモーダル ── */}
      <Modal visible={calVisible} transparent animationType="fade">
        <View style={styles.calOverlay}>
          <View style={styles.calContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{calTarget === 'start' ? '開始日' : '終了日'}を選択</Text>
              <TouchableOpacity onPress={() => setCalVisible(false)}>
                <Ionicons name="close" size={28} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <TouchableOpacity onPress={() => setCalViewDate(new Date(calViewDate.getFullYear(), calViewDate.getMonth() - 1, 1))}>
                <Ionicons name="chevron-back" size={24} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: 'bold' }}>
                {calViewDate.getFullYear()}年 {calViewDate.getMonth() + 1}月
              </Text>
              <TouchableOpacity onPress={() => setCalViewDate(new Date(calViewDate.getFullYear(), calViewDate.getMonth() + 1, 1))}>
                <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.calHeaderRow}>
              {DAY_NAMES.map((w, i) => (
                <Text key={i} style={[styles.calWeekText, i === 0 && { color: '#E74C3C' }, i === 6 && { color: '#3498DB' }]}>{w}</Text>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {generateCalDays().map((day, idx) => {
                const isSelected = day !== null && (() => {
                  const d = new Date(calViewDate.getFullYear(), calViewDate.getMonth(), day!);
                  const target = calTarget === 'start' ? startDateObj : endDateObj;
                  return toDateStr(d) === toDateStr(target);
                })();
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.calCell, !day && { borderWidth: 0 }, isSelected && styles.calCellSelected]}
                    disabled={!day}
                    onPress={() => day && selectCalDay(day)}
                  >
                    {day && (
                      <Text style={[{ fontWeight: 'bold', color: COLORS.text }, isSelected && { color: COLORS.white }]}>
                        {day}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
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
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
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
  datePickerBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 14, marginBottom: 16, backgroundColor: '#F0F8FF' },
  datePickerText: { flex: 1, fontSize: 18, fontWeight: 'bold', color: COLORS.primary },
  saveBtn: { backgroundColor: COLORS.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },

  calOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  calContent: { width: '100%', backgroundColor: COLORS.white, borderRadius: 16, padding: 24 },
  calHeaderRow: { flexDirection: 'row', marginBottom: 8 },
  calWeekText: { width: '14.2%', textAlign: 'center', fontSize: 13, fontWeight: 'bold', color: COLORS.textLight },
  calCell: { width: '14.2%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center', borderWidth: 0.5, borderColor: COLORS.border },
  calCellSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
});
