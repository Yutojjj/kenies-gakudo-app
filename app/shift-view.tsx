import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type Staff = { id: string, name: string };
type AssignedStaff = { name: string, start: string, end: string };

export default function ShiftViewScreen() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name: string }>();
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [requests, setRequests] = useState<Record<string, string>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, AssignedStaff[]>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});

  // ★ ① 修正: 初期の表示を「全体」にするため false に変更
  const [showOnlyMine, setShowOnlyMine] = useState(false);

  useEffect(() => {
    const fetchHolidays = async () => {
      try {
        const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
        const data = await res.json();
        setPublicHolidays(data);
      } catch (e) {
        console.warn('祝日API取得失敗', e);
      }
    };
    fetchHolidays();

    const fetchStaff = async () => {
      const q = query(collection(db, 'accounts'), where('role', '==', 'staff'));
      const snap = await getDocs(q);
      const staffList = snap.docs.map(d => ({ id: d.id, name: d.data().name }));
      setAllStaff(staffList);
    };
    fetchStaff();

    const reqUnsub = onSnapshot(collection(db, 'shifts'), (s) => {
      const reqData: Record<string, string> = {};
      s.forEach(d => {
        const data = d.data();
        reqData[`${data.staffName}_${data.dateStr}`] = data.type;
      });
      setRequests(reqData);
    });

    const asUnsub = onSnapshot(collection(db, 'assigned_shifts'), (s) => {
      const asData: Record<string, AssignedStaff[]> = {};
      s.forEach(d => { asData[d.id] = d.data().staff || []; });
      setAssignedShifts(asData);
    });

    return () => { reqUnsub(); asUnsub(); };
  }, []);

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
  
  const generateWeeksForSpreadsheet = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ day: i, dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
    }
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    return weeks;
  };

  const weeks = ['日', '月', '火', '水', '木', '金', '土'];
  const spreadsheetWeeks = generateWeeksForSpreadsheet();

  const displayStaff = showOnlyMine ? allStaff.filter(s => s.name === name) : allStaff;

  return (
    <SafeAreaView style={styles.ssModalContainer}>
      <View style={styles.ssModalHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.ssModalTitle}>シフト表</Text>
      </View>
      
      <View style={styles.ssMonthNav}>
        <TouchableOpacity style={styles.ssMonthBtn} onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))}>
          <Text style={styles.ssMonthBtnText}>前の月</Text>
        </TouchableOpacity>
        <Text style={styles.ssMonthTitle}>{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</Text>
        <TouchableOpacity style={styles.ssMonthBtn} onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))}>
          <Text style={styles.ssMonthBtnText}>次の月</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.ssTableContainer}>
        <ScrollView style={styles.ssVerticalScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.spreadsheet}>
            
            <View style={styles.ssRow}>
              <View style={[styles.ssHeaderCell, { backgroundColor: '#FFE4B5', width: '16%' }]}><Text style={styles.ssHeaderText}>{currentDate.getMonth() + 1}月</Text></View>
              {weeks.map((w, i) => {
                const cellWidth = (i === 0 || i === 6) ? '6%' : '14.4%';
                return (
                  <View key={i} style={[styles.ssHeaderCell, { width: cellWidth }]}>
                    <Text style={[styles.ssHeaderText, i === 0 ? {color: 'red'} : i === 6 ? {color: 'blue'} : {}]}>{w}</Text>
                  </View>
                );
              })}
            </View>

            {spreadsheetWeeks.map((week, wIdx) => (
              <React.Fragment key={wIdx}>
                <View style={styles.ssRow}>
                  <View style={[styles.ssDateCell, { width: '16%', backgroundColor: '#FFF0F5' }]}></View>
                  {week.map((day, dIdx) => {
                    let isSun = false, isSat = false, isPubHoliday = false;
                    if (day) {
                      const d = new Date(day.dateStr);
                      isSun = d.getDay() === 0;
                      isSat = d.getDay() === 6;
                      isPubHoliday = !!publicHolidays[day.dateStr];
                    }
                    const cellWidth = (dIdx === 0 || dIdx === 6) ? '6%' : '14.4%';
                    const textColor = (isSun || isPubHoliday) ? 'red' : isSat ? 'blue' : COLORS.text;
                    const bgColor = (isSun || isPubHoliday) ? '#FFE4E1' : isSat ? '#E0FFFF' : '#E8F5E9';
                    return (
                      <View key={dIdx} style={[styles.ssDateCell, { width: cellWidth, backgroundColor: bgColor }]}>
                        <Text style={[styles.ssDateText, { color: textColor }]}>{day ? day.day : ''}</Text>
                      </View>
                    );
                  })}
                </View>

                {displayStaff.map(staff => (
                  <View key={staff.id} style={styles.ssRow}>
                    <View style={[styles.ssNameCell, { width: '16%', backgroundColor: staff.name === name ? '#FFDAB9' : '#FFC0CB' }]}>
                      <Text style={[styles.ssNameText, staff.name === name && { color: COLORS.primary }]} numberOfLines={1} adjustsFontSizeToFit>{staff.name}</Text>
                    </View>
                    {week.map((day, dIdx) => {
                      let content = '';
                      let bgColor = '#FFFFFF';
                      let isBold = false;
                      const cellWidth = (dIdx === 0 || dIdx === 6) ? '6%' : '14.4%';
                      
                      if (day) {
                        const assigned = assignedShifts[day.dateStr]?.find(s => s.name === staff.name);
                        const req = requests[`${staff.name}_${day.dateStr}`];
                        
                        if (assigned) {
                          content = `開:${assigned.start}\n終:${assigned.end}`; 
                          bgColor = '#FFD700'; 
                          isBold = true;
                        } else if (req) {
                          content = (dIdx === 0 || dIdx === 6) ? '✕' : req; 
                          bgColor = req === '✕' ? '#E0E0E0' : req === '午前✕' ? '#E0FFFF' : '#FFFACD';
                        }
                      } else {
                        bgColor = '#F5F5F5'; 
                      }

                      return (
                        <View key={dIdx} style={[styles.ssDataCell, { width: cellWidth, backgroundColor: bgColor }]}>
                          <Text style={[styles.ssDataText, isBold && { fontWeight: 'bold' }]} adjustsFontSizeToFit numberOfLines={2}>{content}</Text>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </React.Fragment>
            ))}
            <View style={{height: 100}} />
          </View>
        </ScrollView>
      </View>

      <TouchableOpacity style={styles.fab} onPress={() => setShowOnlyMine(!showOnlyMine)}>
        <Ionicons name={showOnlyMine ? "people" : "person"} size={24} color={COLORS.white} />
        <Text style={styles.fabText}>{showOnlyMine ? '全体を見る' : '自分のみ'}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  ssModalContainer: { flex: 1, backgroundColor: COLORS.background },
  ssModalHeader: { flexDirection: 'row', alignItems: 'center', padding: 20, backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border },
  backBtn: { marginRight: 16 },
  ssModalTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text, flex: 1 },
  ssMonthNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#E6E6FA', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#9370DB' },
  ssMonthBtn: { backgroundColor: COLORS.white, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#9370DB' },
  ssMonthBtnText: { fontSize: 12, fontWeight: 'bold', color: '#9370DB' },
  ssMonthTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  
  ssTableContainer: { flex: 1, backgroundColor: '#F0F0F0' },
  ssVerticalScroll: { flex: 1 },
  spreadsheet: { padding: 2 }, 
  
  ssRow: { flexDirection: 'row', width: '100%' },
  ssHeaderCell: { backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: '#666', justifyContent: 'center', alignItems: 'center', paddingVertical: 4 },
  ssHeaderText: { fontSize: 12, fontWeight: 'bold', color: COLORS.text },
  
  ssDateCell: { borderWidth: 1, borderColor: '#666', justifyContent: 'center', alignItems: 'center', paddingVertical: 4 },
  ssDateText: { fontSize: 14, fontWeight: 'bold' },
  
  ssNameCell: { borderWidth: 1, borderColor: '#666', justifyContent: 'center', alignItems: 'center', paddingVertical: 6 },
  ssNameText: { fontSize: 10, fontWeight: 'bold', color: '#333', textAlign: 'center', paddingHorizontal: 2 },
  
  ssDataCell: { borderWidth: 1, borderColor: '#666', justifyContent: 'center', alignItems: 'center', paddingVertical: 4 },
  ssDataText: { fontSize: 9, color: '#333', textAlign: 'center', lineHeight: 11 },

  fab: { position: 'absolute', right: 20, bottom: 40, backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 30, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  fabText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16, marginLeft: 8 },
});