import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AdminBottomNav, { ADMIN_BOTTOM_NAV_HEIGHT } from '../components/AdminBottomNav';
import AdminShiftTabs from '../components/AdminShiftTabs';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { navigateHome } from '../utils/navigationHome';

type Staff = { id: string; name: string };
type AssignedStaff = { name: string; start: string; end: string };

const SHIFT_CARD_COLORS = [
  { bg: '#EAF8F1', border: '#8DD7B7' },
  { bg: '#FFF0F4', border: '#F4A6BC' },
  { bg: '#F0EEFF', border: '#B9A8F5' },
  { bg: '#FFF3EA', border: '#F0B38B' },
  { bg: '#EDF6FF', border: '#90C8F2' },
  { bg: '#F2F8E8', border: '#B7D886' },
];

export default function ShiftViewScreen() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [myName, setMyName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [assignedShifts, setAssignedShifts] = useState<Record<string, AssignedStaff[]>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});
  const [holidayPeriods, setHolidayPeriods] = useState<any[]>([]);
  const [eventsData, setEventsData] = useState<Record<string, string>>({});
  const [showOnlyMine, setShowOnlyMine] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(raw => {
      if (raw) {
        let user: any = {}; try { user = JSON.parse(raw); } catch {}
        setMyName(user.name || '');
        setIsAdmin(user.role === 'admin');
      }
    });

    fetch('https://holidays-jp.github.io/api/v1/date.json')
      .then(r => r.json()).then(setPublicHolidays).catch(() => {});

    getDocs(query(collection(db, 'accounts'), where('role', '==', 'staff')))
      .then(snap => setAllStaff(snap.docs
        .filter(d => d.data().showInShiftTable !== false)
        .map(d => ({ id: d.id, name: d.data().name }))));

    const unsubShifts = onSnapshot(collection(db, 'assigned_shifts'), snap => {
      const data: Record<string, AssignedStaff[]> = {};
      snap.forEach(d => { data[d.id] = d.data().staff || []; });
      setAssignedShifts(data);
    });

    const unsubHolidays = onSnapshot(doc(db, 'settings', 'holidays_data'), snap => {
      if (snap.exists() && snap.data().periods) setHolidayPeriods(snap.data().periods);
    });

    const unsubEvents = onSnapshot(collection(db, 'events'), snap => {
      const eData: Record<string, string> = {};
      snap.forEach(d => { eData[d.id] = d.data().title; });
      setEventsData(eData);
    });

    return () => { unsubShifts(); unsubHolidays(); unsubEvents(); };
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
      </View>
      <AdminShiftTabs active="view" />

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
      <ScrollView style={{ paddingHorizontal: 8 }}>
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
                    <Text style={styles.eventBadgeText} numberOfLines={1}>{eventsData[item.dateStr]}</Text>
                  </View>
                )}

                <View style={{ flex: 1, marginTop: 3 }}>
                  {displayStaff.map((staff, staffIndex) => {
                    const assigned = assignedList.find(s => s.name === staff.name);
                    if (!assigned) return null;
                    const isMe = staff.name === myName;
                    const colorSet = SHIFT_CARD_COLORS[staffIndex % SHIFT_CARD_COLORS.length];
                    return (
                      <View
                        key={staff.id}
                        style={[
                          styles.cellStaffRow,
                          { backgroundColor: colorSet.bg, borderColor: colorSet.border },
                          isMe && styles.cellStaffRowMe,
                        ]}
                      >
                        <Text style={styles.cellStaffName} numberOfLines={1}>{staff.name}</Text>
                        <View style={styles.cellStaffTimeRow}>
                          <Text style={[styles.cellStaffTime, styles.cellStaffStartTime, isMe && styles.cellStaffTimeMe]}>開:{assigned.start}</Text>
                          <Text style={[styles.cellStaffTime, styles.cellStaffEndTime, isMe && styles.cellStaffTimeMe]}>終:{assigned.end}</Text>
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

      {/* 自分のみ表示ボタン（左下） */}
      <TouchableOpacity
        style={[styles.fab, showOnlyMine && styles.fabActive]}
        onPress={() => setShowOnlyMine(!showOnlyMine)}
        activeOpacity={0.85}
      >
        <Ionicons name={showOnlyMine ? 'people' : 'person'} size={20} color={COLORS.white} />
        <Text style={styles.fabText}>{showOnlyMine ? '全体表示' : '自分のみ'}</Text>
      </TouchableOpacity>
      <AdminBottomNav active="shift" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#FFF8F0', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  monthSelector: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', padding: 16 },
  monthText: { fontSize: 20, fontWeight: 'bold', marginHorizontal: 16 },
  calHeaderRow: { flexDirection: 'row', marginBottom: 4 },
  calWeekText: { width: '14.2%', textAlign: 'center', fontSize: 13, fontWeight: 'bold', color: COLORS.text },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCellEmpty: { width: '14.28%', minHeight: 90 },
  calCell: { width: '14.28%', minHeight: 100, borderWidth: 0.5, borderColor: COLORS.border, padding: 4 },
  cellTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  calDayText: { fontSize: 12, fontWeight: 'bold' },
  cellCountText: { fontSize: 10, color: '#007A82', fontWeight: '900' },
  eventBadge: { backgroundColor: '#20B2AA', borderRadius: 4, padding: 2, marginTop: 2 },
  eventBadgeText: { fontSize: 8, color: '#fff', fontWeight: 'bold', textAlign: 'center' },
  cellStaffRow: { marginBottom: 3, borderRadius: 5, paddingHorizontal: 3, paddingVertical: 2, minHeight: 36, borderWidth: 1 },
  cellStaffRowMe: { backgroundColor: '#E7F8F3', borderWidth: 1.5, borderColor: '#00A176', minHeight: 36 },
  cellStaffName: { fontSize: 9, fontWeight: '900', color: '#2E2A27', lineHeight: 12 },
  cellStaffTimeRow: { marginTop: 1 },
  cellStaffTime: { fontSize: 8, lineHeight: 11, fontWeight: '800' },
  cellStaffStartTime: { color: COLORS.text },
  cellStaffEndTime: { color: COLORS.text },
  cellStaffTimeMe: { fontWeight: '900' },
  fab: { position: 'absolute', bottom: ADMIN_BOTTOM_NAV_HEIGHT + 14, right: 20, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 30, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 8, zIndex: 100 },
  fabActive: { backgroundColor: COLORS.secondary },
  fabText: { color: COLORS.white, fontWeight: 'bold', fontSize: 13, marginLeft: 6 },
});
