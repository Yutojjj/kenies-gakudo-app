import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type EventData = { id: string; dateStr: string; title: string; description: string; externalParticipants: any[]; };
type Participant = { id: string; childName: string; status: string; };

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

export default function EventManagementScreen() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  
  const [events, setEvents] = useState<Record<string, EventData>>({});
  const [participantsMap, setParticipantsMap] = useState<Record<string, Participant[]>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});

  const [selectedDateStr, setSelectedDateStr] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  
  const [eventTitle, setEventTitle] = useState('');
  const [eventDesc, setEventDesc] = useState('');

  const [extName, setExtName] = useState('');
  const [extSchool, setExtSchool] = useState('');
  const [extGrade, setExtGrade] = useState('');

  useEffect(() => {
    // 祝日データの取得
    fetch('https://holidays-jp.github.io/api/v1/date.json')
      .then(res => res.json())
      .then(data => setPublicHolidays(data))
      .catch(e => console.warn('祝日API取得失敗', e));

    const unsubEvents = onSnapshot(collection(db, 'events'), (snap) => {
      const eData: Record<string, EventData> = {};
      snap.forEach(d => { eData[d.id] = d.data() as EventData; });
      setEvents(eData);
    });

    const unsubParts = onSnapshot(collection(db, 'event_participants'), (snap) => {
      const pData: Record<string, Participant[]> = {};
      snap.forEach(d => {
        const item = d.data();
        if (!pData[item.eventId]) pData[item.eventId] = [];
        pData[item.eventId].push({ id: d.id, childName: item.childName, status: item.status });
      });
      setParticipantsMap(pData);
      setLoading(false);
    });

    return () => { unsubEvents(); unsubParts(); };
  }, []);

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
  
  const generateDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ day: i, dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
    }
    return days;
  };

  const changeMonth = (offset: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
  };

  const openDayModal = (dateStr: string) => {
    setSelectedDateStr(dateStr);
    const ev = events[dateStr];
    if (ev) {
      setEventTitle(ev.title);
      setEventDesc(ev.description || '');
    } else {
      setEventTitle(''); setEventDesc('');
    }
    setExtName(''); setExtSchool(''); setExtGrade('');
    setModalVisible(true);
  };

  const saveEvent = async () => {
    if (!eventTitle) return Alert.alert('エラー', 'イベント名を入力してください');
    try {
      const ev = events[selectedDateStr] || { id: selectedDateStr, dateStr: selectedDateStr, externalParticipants: [] };
      await setDoc(doc(db, 'events', selectedDateStr), { ...ev, title: eventTitle, description: eventDesc }, { merge: true });
      Alert.alert('保存完了', 'イベント情報を保存しました');
      setModalVisible(false);
    } catch (e) {
      Alert.alert('エラー', '保存に失敗しました');
    }
  };

  const deleteEvent = () => {
    Alert.alert('削除確認', 'このイベントを削除しますか？', [
      { text: 'キャンセル' },
      { text: '削除', style: 'destructive', onPress: async () => {
          await deleteDoc(doc(db, 'events', selectedDateStr));
          setModalVisible(false);
      }}
    ]);
  };

  const addExternalParticipant = async () => {
    if (!extName) return Alert.alert('エラー', '氏名を入力してください');
    try {
      const ev = events[selectedDateStr] || { id: selectedDateStr, dateStr: selectedDateStr, title: eventTitle, description: eventDesc, externalParticipants: [] };
      const newExt = { id: Date.now().toString(), name: extName, school: extSchool, grade: extGrade };
      const updatedExtList = [...(ev.externalParticipants || []), newExt];
      await setDoc(doc(db, 'events', selectedDateStr), { ...ev, externalParticipants: updatedExtList }, { merge: true });
      setExtName(''); setExtSchool(''); setExtGrade('');
    } catch (e) {
      Alert.alert('エラー', '追加に失敗しました');
    }
  };

  const removeExternalParticipant = async (extId: string) => {
    const ev = events[selectedDateStr];
    const updatedExtList = ev.externalParticipants.filter(p => p.id !== extId);
    await setDoc(doc(db, 'events', selectedDateStr), { externalParticipants: updatedExtList }, { merge: true });
  };

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color={COLORS.primary}/></SafeAreaView>;

  const days = generateDays();
  const currentEvent = events[selectedDateStr];
  const internalParticipants = participantsMap[selectedDateStr] || [];
  const attendingInternals = internalParticipants.filter(p => p.status === '参加');
  const externalParts = currentEvent?.externalParticipants || [];
  const totalCount = attendingInternals.length + externalParts.length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>イベント管理</Text>
      </View>

      <View style={styles.monthSelector}>
        <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.monthBtn}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.monthText}>{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</Text>
        <TouchableOpacity onPress={() => changeMonth(1)} style={styles.monthBtn}>
          <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollArea}>
        <View style={styles.calendarContainer}>
          <View style={styles.calHeaderRow}>
            {DAY_NAMES.map((w, i) => (
              <Text key={i} style={[styles.calWeekText, i === 0 && {color: 'red'}, i === 6 && {color: 'blue'}]}>{w}</Text>
            ))}
          </View>
          <View style={styles.calGrid}>
            {days.map((item, index) => {
              if (!item) return <View key={`empty-${index}`} style={styles.calCellEmpty} />;
              
              const ev = events[item.dateStr];
              const d = new Date(item.dateStr);
              const isSunday = d.getDay() === 0;
              const isSaturday = d.getDay() === 6;
              const isPublicHoliday = !!publicHolidays[item.dateStr];

              let dateColor = COLORS.text;
              if (isSunday || isPublicHoliday) dateColor = 'red';
              else if (isSaturday) dateColor = 'blue';

              return (
                <TouchableOpacity 
                  key={item.dateStr} 
                  style={[styles.calCell, ev && styles.calCellActive]} 
                  onPress={() => openDayModal(item.dateStr)}
                >
                  <Text style={[styles.calDayText, { color: dateColor }]}>{item.day}</Text>
                  <View style={styles.cellContent}>
                    {ev && (
                      <View style={styles.eventBadge}>
                        <Text style={styles.eventBadgeText} numberOfLines={2}>{ev.title}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" transparent>
        <SafeAreaView style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedDateStr} のイベント
                {publicHolidays[selectedDateStr] ? ` (${publicHolidays[selectedDateStr]})` : ''}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={28} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1, padding: 20 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>イベント名</Text>
              <TextInput style={styles.input} value={eventTitle} onChangeText={setEventTitle} placeholder="例: 春の遠足" />
              
              <Text style={styles.label}>説明・詳細</Text>
              <TextInput 
                style={[styles.input, { height: 80 }]} 
                value={eventDesc} 
                onChangeText={setEventDesc} 
                placeholder="持ち物や集合時間など" 
                multiline 
              />
              
              <View style={styles.actionRow}>
                {currentEvent && (
                  <TouchableOpacity style={styles.deleteBtn} onPress={deleteEvent}>
                    <Text style={styles.deleteBtnText}>イベント削除</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.saveBtn} onPress={saveEvent}>
                  <Text style={styles.saveBtnText}>保存する</Text>
                </TouchableOpacity>
              </View>

              {currentEvent && (
                <View style={styles.participantsSection}>
                  <Text style={styles.sectionTitle}>参加者名簿 (合計: {totalCount}名)</Text>
                  
                  <Text style={styles.subTitle}>■ 学童メンバー ({attendingInternals.length}名)</Text>
                  {attendingInternals.length === 0 ? (
                    <Text style={styles.emptyText}>参加登録はありません</Text>
                  ) : (
                    attendingInternals.map(p => <Text key={p.id} style={styles.participantName}>・{p.childName}</Text>)
                  )}
                  
                  <Text style={[styles.subTitle, { marginTop: 16 }]}>■ 外部参加者 ({externalParts.length}名)</Text>
                  {externalParts.length === 0 ? (
                    <Text style={styles.emptyText}>登録されていません</Text>
                  ) : (
                    externalParts.map((p: any) => (
                      <View key={p.id} style={styles.extRow}>
                        <Text style={styles.participantName}>・{p.name} ({p.school}/{p.grade})</Text>
                        <TouchableOpacity onPress={() => removeExternalParticipant(p.id)}>
                          <Ionicons name="trash" size={18} color={COLORS.danger}/>
                        </TouchableOpacity>
                      </View>
                    ))
                  )}

                  <View style={styles.addExtBox}>
                    <Text style={{fontWeight: 'bold', marginBottom: 8}}>外部参加者の追加</Text>
                    <TextInput style={styles.smallInput} placeholder="氏名" value={extName} onChangeText={setExtName} />
                    <View style={{flexDirection: 'row', gap: 8, marginVertical: 8}}>
                      <TextInput style={[styles.smallInput, {flex: 1}]} placeholder="学校名" value={extSchool} onChangeText={setExtSchool} />
                      <TextInput style={[styles.smallInput, {flex: 1}]} placeholder="学年" value={extGrade} onChangeText={setExtGrade} />
                    </View>
                    <TouchableOpacity style={styles.addExtBtn} onPress={addExternalParticipant}>
                      <Text style={{color: COLORS.white, fontWeight:'bold'}}>追加</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              <View style={{ height: 40 }}/>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 20, 
    backgroundColor: COLORS.surface, 
    borderBottomWidth: 1, 
    borderColor: COLORS.border 
  },
  backBtn: { marginRight: 16 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text, flex: 1 },
  monthSelector: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: 16 
  },
  monthBtn: { 
    padding: 8, 
    backgroundColor: COLORS.surface, 
    borderRadius: 20, 
    borderWidth: 1, 
    borderColor: COLORS.border 
  },
  monthText: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  scrollArea: { flex: 1 },
  calendarContainer: { paddingHorizontal: 8, paddingBottom: 40 },
  calHeaderRow: { flexDirection: 'row', marginBottom: 8 },
  calWeekText: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 'bold', color: COLORS.textLight },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCellEmpty: { width: '14.28%', aspectRatio: 0.65 },
  // ★ 利用者カレンダーと同じ縦長比率に統一
  calCell: { 
    width: '14.28%', 
    aspectRatio: 0.65, 
    borderWidth: 0.5, 
    borderColor: COLORS.border, 
    padding: 2, 
    backgroundColor: COLORS.white,
    justifyContent: 'flex-start'
  },
  calCellActive: { backgroundColor: '#F0F8FF' },
  calDayText: { fontSize: 12, fontWeight: 'bold', marginBottom: 2 },
  cellContent: { flex: 1 },
  eventBadge: { 
    backgroundColor: COLORS.primary, 
    borderRadius: 4, 
    padding: 2, 
    marginBottom: 2 
  },
  eventBadgeText: { 
    fontSize: 8, 
    color: COLORS.white, 
    fontWeight: 'bold', 
    textAlign: 'center' 
  },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: COLORS.white, height: '90%', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderColor: COLORS.border },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  label: { fontSize: 14, fontWeight: 'bold', marginBottom: 8, marginTop: 16 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#FAFAFA' },
  
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 24, paddingBottom: 24, borderBottomWidth: 1, borderColor: COLORS.border },
  saveBtn: { flex: 1, backgroundColor: COLORS.primary, padding: 14, borderRadius: 8, alignItems: 'center' },
  saveBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  deleteBtn: { backgroundColor: '#FFF0F0', padding: 14, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#FFE0E0' },
  deleteBtnText: { color: COLORS.danger, fontWeight: 'bold' },

  participantsSection: { marginTop: 24 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.primary, marginBottom: 16 },
  subTitle: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  emptyText: { color: COLORS.textLight, fontStyle: 'italic', marginBottom: 8 },
  participantName: { fontSize: 16, marginBottom: 6, color: COLORS.text },
  extRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderColor: '#F0F0F0', paddingVertical: 4 },

  addExtBox: { backgroundColor: '#F9F9F9', padding: 16, borderRadius: 8, marginTop: 20, borderWidth: 1, borderColor: COLORS.border },
  smallInput: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, padding: 10, borderRadius: 6 },
  addExtBtn: { backgroundColor: COLORS.secondary, padding: 12, alignItems: 'center', borderRadius: 6, marginTop: 8 }
});