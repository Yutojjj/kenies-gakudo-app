import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AdminBottomNav from '../components/AdminBottomNav';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { navigateHome } from '../utils/navigationHome';
import ShiftScreen from './shift';
import ShiftCreateScreen from './shift-create';

type Staff = { id: string; name: string };
type AssignedStaff = { name: string; start: string; end: string };

const SHIFT_CARD_COLORS = [
  '#A9DFD1',
  '#F3B1C3',
  '#C9BEF2',
  '#F2BE9B',
  '#A8D2F0',
  '#BCD99B',
  '#F2D783',
  '#9ED9DE',
  '#D8ADD0',
  '#D2C4A7',
  '#B3C7E5',
  '#EAB2A7',
];

export default function ShiftViewScreen() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [myName, setMyName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [assignedShifts, setAssignedShifts] = useState<Record<string, AssignedStaff[]>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});
  const [holidayPeriods, setHolidayPeriods] = useState<any[]>([]);
  const [eventsData, setEventsData] = useState<Record<string, string[]>>({});
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [submissionVisible, setSubmissionVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(raw => {
      if (raw) {
        let user: any = {}; try { user = JSON.parse(raw); } catch {}
        setMyName(user.name || '');
        setIsAdmin(user.role === 'admin');
      }
    }).finally(() => setIdentityLoaded(true));

    fetch('https://holidays-jp.github.io/api/v1/date.json')
      .then(r => r.json())
      .then(setPublicHolidays)
      .catch(() => {});

    const unsubAccounts = onSnapshot(query(collection(db, 'accounts'), where('role', '==', 'staff')), snap => {
      setAllStaff(snap.docs
        .filter(d => d.data().showInShiftTable !== false)
        .map(d => ({ id: d.id, name: d.data().name })));
    });

    const unsubShifts = onSnapshot(collection(db, 'assigned_shifts'), snap => {
      const data: Record<string, AssignedStaff[]> = {};
      snap.forEach(d => { data[d.id] = d.data().staff || []; });
      setAssignedShifts(data);
    });

    const unsubHolidays = onSnapshot(doc(db, 'settings', 'holidays_data'), snap => {
      if (snap.exists() && snap.data().periods) setHolidayPeriods(snap.data().periods);
    });

    const unsubEvents = onSnapshot(collection(db, 'events'), snap => {
      const eData: Record<string, string[]> = {};
      snap.forEach(d => {
        const data = d.data();
        const dateKey = String(data.dateStr || data.dateKey || d.id);
        const title = String(data.title || '').trim();
        if (!dateKey || !title) return;
        if (!eData[dateKey]) eData[dateKey] = [];
        if (!eData[dateKey].includes(title)) eData[dateKey].push(title);
      });
      setEventsData(eData);
    });

    return () => { unsubAccounts(); unsubShifts(); unsubHolidays(); unsubEvents(); };
  }, []);

  const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

  const generateDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = new Date(year, month, 1).getDay();
    const days: ({ day: number; dateStr: string } | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ day: i, dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
    }
    return days;
  };

  const days = generateDays();
  const weeks = ['日', '月', '火', '水', '木', '金', '土'];

  const displayStaff = showOnlyMine
    ? allStaff.filter(s => s.name === myName)
    : allStaff;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigateHome(router)}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>シフト確認</Text>
        {isAdmin ? (
          <View style={styles.adminHeaderActions}>
            <TouchableOpacity
              style={[styles.adminHeaderBtn, styles.pdfBtn]}
              onPress={() => router.push({
                pathname: '/shift-create',
                params: {
                  autoPdf: '1',
                  year: String(currentDate.getFullYear()),
                  month: String(currentDate.getMonth() + 1),
                },
              } as any)}
            >
              <Ionicons name="document-text" size={18} color="#FFFFFF" />
              <Text style={styles.adminHeaderBtnText}>PDF出力</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.adminHeaderBtn, styles.createBtn]}
              onPress={() => setCreateVisible(true)}
            >
              <Ionicons name="create-outline" size={18} color="#FFFFFF" />
              <Text style={styles.adminHeaderBtnText}>作成する</Text>
            </TouchableOpacity>
          </View>
        ) : identityLoaded ? (
          <View style={styles.staffHeaderActions}>
            <TouchableOpacity
              style={[styles.mineHeaderBtn, showOnlyMine && styles.mineHeaderBtnActive]}
              onPress={() => setShowOnlyMine(!showOnlyMine)}
            >
              <Ionicons name={showOnlyMine ? 'people-outline' : 'person-outline'} size={17} color="#176E72" />
              <Text style={styles.mineHeaderBtnText}>{showOnlyMine ? '全体表示' : '自分のみ'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitHeaderBtn} onPress={() => setSubmissionVisible(true)}>
              <Ionicons name="create-outline" size={18} color="#FFFFFF" />
              <Text style={styles.submitHeaderBtnText}>シフト提出</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {/* 月ナビゲーション */}
      <View style={styles.monthSelector}>
        <TouchableOpacity onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.monthText}>{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</Text>
        <TouchableOpacity onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))}>
          <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* カレンダー */}
      <ScrollView style={styles.calendarScroll} contentContainerStyle={styles.calendarContent}>
        {/* 曜日ヘッダー */}
        <View style={styles.calHeaderRow}>
          {weeks.map((w, i) => (
            <Text key={i} style={[styles.calWeekText, i === 0 && { color: 'red' }, i === 6 && { color: 'blue' }]}>{w}</Text>
          ))}
        </View>

        {/* カレンダーグリッド */}
        <View style={styles.calGrid}>
          {days.map((item, index) => {
            if (!item) return <View key={`empty-${index}`} style={styles.calCellEmpty} />;

            const d = new Date(item.dateStr);
            const isSunday = d.getDay() === 0;
            const isSaturday = d.getDay() === 6;
            const isPublicHoliday = !!publicHolidays[item.dateStr];
            const isEventDay = !!eventsData[item.dateStr];
            const hPeriod = holidayPeriods.find((h: any) => item.dateStr >= h.start && item.dateStr <= h.end);

            let dateColor = COLORS.text;
            if (isSunday || isPublicHoliday) dateColor = 'red';
            else if (isSaturday) dateColor = 'blue';

            const visibleStaffNames = new Set(allStaff.map(staff => staff.name));
            const assignedList = (assignedShifts[item.dateStr] || []).filter(shift => visibleStaffNames.has(shift.name));
            const myShift = assignedList.find(s => s.name === myName);
            const cellBg = myShift ? '#F3FBF6' : hPeriod?.color || COLORS.white;

            return (
              <View key={item.dateStr} style={[styles.calCell, { backgroundColor: cellBg }]}>
                <View style={styles.cellTopRow}>
                  <Text style={[styles.calDayText, { color: dateColor }]}>{item.day}</Text>
                  {assignedList.length > 0 && (
                    <Text style={styles.cellCountText}>{assignedList.length}名</Text>
                  )}
                </View>

                {isEventDay && (
                  <View style={styles.eventBadge}>
                    <Text style={styles.eventBadgeText} numberOfLines={2}>
                      {eventsData[item.dateStr].join('・')}
                    </Text>
                  </View>
                )}

                <View style={{ flex: 1, marginTop: 3 }}>
                  {displayStaff.map((staff) => {
                    const assigned = assignedList.find(s => s.name === staff.name);
                    if (!assigned) return null;
                    const isMe = staff.name === myName;
                    const staffIndex = Math.max(0, allStaff.findIndex(item => item.id === staff.id));
                    const staffBackground = SHIFT_CARD_COLORS[staffIndex % SHIFT_CARD_COLORS.length];
                    return (
                      <View
                        key={staff.id}
                        style={[
                          styles.cellStaffRow,
                          { backgroundColor: staffBackground },
                        ]}
                      >
                        <Text style={styles.cellStaffName} numberOfLines={1}>{staff.name}</Text>
                        <View style={styles.cellStaffTimeRow}>
                          <Text style={[styles.cellStaffTime, styles.cellStaffStartTime, isMe && styles.cellStaffTimeMe]}>{assigned.start}</Text>
                          <Text style={[styles.cellStaffTime, styles.cellStaffEndTime, isMe && styles.cellStaffTimeMe]}>{assigned.end}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>

      <AdminBottomNav active="shift" />

      <Modal visible={submissionVisible} transparent animationType="fade" onRequestClose={() => setSubmissionVisible(false)}>
        <View style={styles.submissionOverlay}>
          <View style={styles.submissionModal}>
            <ShiftScreen embedded onClose={() => setSubmissionVisible(false)} />
          </View>
        </View>
      </Modal>

      <Modal visible={createVisible} transparent animationType="fade" onRequestClose={() => setCreateVisible(false)}>
        <View style={styles.createOverlay}>
          <View style={styles.createModal}>
            <ShiftCreateScreen
              embedded
              initialDate={currentDate}
              onClose={() => setCreateVisible(false)}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#FFF8F0', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  adminHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  adminHeaderBtn: { minHeight: 38, paddingHorizontal: 9, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  pdfBtn: { backgroundColor: '#08AEB8' },
  createBtn: { backgroundColor: '#2D8BE8' },
  adminHeaderBtnText: { fontSize: 11, fontWeight: '900', color: '#FFFFFF' },
  staffHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  mineHeaderBtn: { minHeight: 40, paddingHorizontal: 11, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#EAF8F8', borderWidth: 1, borderColor: '#A7DCDD' },
  mineHeaderBtnActive: { backgroundColor: '#D8F2F0', borderColor: '#62C5C8' },
  mineHeaderBtnText: { fontSize: 12, fontWeight: '900', color: '#176E72' },
  submitHeaderBtn: { minHeight: 40, paddingHorizontal: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#08AEB8' },
  submitHeaderBtnText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
  monthSelector: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', padding: 16 },
  monthText: { fontSize: 20, fontWeight: 'bold', marginHorizontal: 16 },
  calendarScroll: { flex: 1 },
  calendarContent: { width: '100%', paddingHorizontal: 0, paddingBottom: 100 },
  calHeaderRow: { flexDirection: 'row', marginBottom: 4, paddingHorizontal: 2 },
  calWeekText: { width: '14.2%', textAlign: 'center', fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCellEmpty: { width: '14.28%', minHeight: 112 },
  calCell: { width: '14.28%', minHeight: 126, borderWidth: 0.5, borderColor: COLORS.border, paddingHorizontal: 2, paddingVertical: 5 },
  cellTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  calDayText: { fontSize: 17, fontWeight: 'bold' },
  cellCountText: { fontSize: 13, color: '#007A82', fontWeight: '900' },
  eventBadge: { alignSelf: 'stretch', marginTop: 3, marginHorizontal: -2, paddingHorizontal: 4, paddingVertical: 2, backgroundColor: '#FFF1C9' },
  eventBadgeText: { fontSize: 11, lineHeight: 14, color: '#6A4500', fontWeight: '900' },
  cellStaffRow: { marginBottom: 1, paddingHorizontal: 4, paddingVertical: 4, minHeight: 43 },
  cellStaffName: { fontSize: 13, fontWeight: '900', color: '#171717', lineHeight: 16 },
  cellStaffTimeRow: { marginTop: 1 },
  cellStaffTime: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  cellStaffStartTime: { color: '#171717' },
  cellStaffEndTime: { color: '#171717' },
  cellStaffTimeMe: { fontWeight: '700' },
  submissionOverlay: { flex: 1, backgroundColor: 'rgba(35, 30, 27, 0.55)', alignItems: 'center', justifyContent: 'center', padding: 12 },
  submissionModal: { width: '100%', maxWidth: 920, height: '92%', overflow: 'hidden', borderRadius: 18, backgroundColor: COLORS.background, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 18, elevation: 12 },
  createOverlay: { flex: 1, backgroundColor: 'rgba(35, 30, 27, 0.55)', alignItems: 'center', justifyContent: 'center', padding: 10 },
  createModal: { width: '100%', maxWidth: 1180, height: '96%', overflow: 'hidden', borderRadius: 18, backgroundColor: COLORS.background, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 18, elevation: 12 },
});
