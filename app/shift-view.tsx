import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type Staff = { id: string; name: string };
type AssignedStaff = { name: string; start: string; end: string };

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
        const user = JSON.parse(raw);
        setMyName(user.name || '');
        setIsAdmin(user.role === 'admin');
      }
    });

    fetch('https://holidays-jp.github.io/api/v1/date.json')
      .then(r => r.json()).then(setPublicHolidays).catch(() => {});

    getDocs(query(collection(db, 'accounts'), where('role', '==', 'staff')))
      .then(snap => setAllStaff(snap.docs.map(d => ({ id: d.id, name: d.data().name }))));

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
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>シフト確認</Text>
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

            const assignedList = assignedShifts[item.dateStr] || [];
            const myShift = assignedList.find(s => s.name === myName);
            // 自分のシフトがある日は薄黄色背景
            const cellBg = myShift ? '#FFFDE7' : hPeriod?.color || COLORS.white;

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
                  {displayStaff.map(staff => {
                    const assigned = assignedList.find(s => s.name === staff.name);
                    if (!assigned) return null;
                    const isMe = staff.name === myName;
                    return (
                      <View key={staff.id} style={[styles.cellStaffRow, isMe && styles.cellStaffRowMe]}>
                        <Text style={[styles.cellStaffName, isMe && styles.cellStaffNameMe]} numberOfLines={1}>{staff.name}</Text>
                        <Text style={[styles.cellStaffTime, isMe && styles.cellStaffTimeMe]}>開始:{assigned.start}</Text>
                        <Text style={[styles.cellStaffTime, isMe && styles.cellStaffTimeMe]}>終了:{assigned.end}</Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 12 },
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
  cellCountText: { fontSize: 10, color: COLORS.primary, fontWeight: 'bold' },
  eventBadge: { backgroundColor: '#20B2AA', borderRadius: 4, padding: 2, marginTop: 2 },
  eventBadgeText: { fontSize: 8, color: '#fff', fontWeight: 'bold', textAlign: 'center' },
  cellStaffRow: { marginBottom: 3, backgroundColor: '#F0F8FF', borderRadius: 4, paddingHorizontal: 3, paddingVertical: 2, minHeight: 34 },
  cellStaffRowMe: { backgroundColor: '#FFF9C4', borderWidth: 1, borderColor: '#F9A825', minHeight: 34 },
  cellStaffName: { fontSize: 9, fontWeight: 'bold', color: '#333', lineHeight: 12 },
  cellStaffNameMe: { color: '#E65100' },
  cellStaffTime: { fontSize: 8, color: COLORS.primary, lineHeight: 11 },
  cellStaffTimeMe: { color: '#E65100', fontWeight: 'bold' },
  fab: { position: 'absolute', bottom: 28, left: 20, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 30, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 8, zIndex: 100 },
  fabActive: { backgroundColor: COLORS.secondary },
  fabText: { color: COLORS.white, fontWeight: 'bold', fontSize: 13, marginLeft: 6 },
});