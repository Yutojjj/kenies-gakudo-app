import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router'; // useRouterを追加
import { collection, deleteDoc, doc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type ShiftType = '✕' | '午前✕' | '午後✕';
type Staff = { id: string, name: string };
type AssignedStaff = { name: string, start: string, end: string };

export default function ShiftScreen() {
  const router = useRouter(); // ★ 追加
  const { name } = useLocalSearchParams<{ name: string }>();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(false);
  
  const [shiftData, setShiftData] = useState<Record<string, ShiftType>>({});
  const [activeStamp, setActiveStamp] = useState<ShiftType>('✕');
  const [stampModalVisible, setStampModalVisible] = useState(false);

  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [allRequests, setAllRequests] = useState<Record<string, string>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, AssignedStaff[]>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});
  const [spreadsheetVisible, setSpreadsheetVisible] = useState(false);

  useEffect(() => {
    let unsubscribes: (() => void)[] = [];

    const fetchAllData = async () => {
      try {
        fetch('https://holidays-jp.github.io/api/v1/date.json')
          .then(res => res.json())
          .then(data => setPublicHolidays(data))
          .catch(e => console.warn('祝日API取得失敗', e));

        const staffName = name || '不明なスタッフ';
        const qMyShifts = query(collection(db, 'shifts'), where('staffName', '==', staffName));
        const unsubMy = onSnapshot(qMyShifts, (snapshot) => {
          const data: Record<string, ShiftType> = {};
          snapshot.forEach((doc) => {
            const item = doc.data();
            data[item.dateStr] = item.type;
          });
          setShiftData(data);
        });
        unsubscribes.push(unsubMy);

        const qStaff = query(collection(db, 'accounts'), where('role', '==', 'staff'));
        const snap = await getDocs(qStaff);
        setAllStaff(snap.docs.map(d => ({ id: d.id, name: d.data().name })));

        const unsubAllReq = onSnapshot(collection(db, 'shifts'), (s) => {
          const reqData: Record<string, string> = {};
          s.forEach(d => {
            const data = d.data();
            reqData[`${data.staffName}_${data.dateStr}`] = data.type;
          });
          setAllRequests(reqData);
        });
        unsubscribes.push(unsubAllReq);

        const unsubAssigned = onSnapshot(collection(db, 'assigned_shifts'), (s) => {
          const asData: Record<string, AssignedStaff[]> = {};
          s.forEach(d => { asData[d.id] = d.data().staff || []; });
          setAssignedShifts(asData);
        });
        unsubscribes.push(unsubAssigned);

      } catch (error) {
        console.error("データ取得エラー", error);
      }
    };

    fetchAllData();

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [name]);

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const generateCalendarDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ day: i, dateStr });
    }
    return days;
  };

  const generateWeeksForSpreadsheet = () => {
    const days = generateCalendarDays();
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    return weeks;
  };

  const changeMonth = (offset: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
  };

  const handleDayPress = async (dateStr: string) => {
    const staffName = name || '不明なスタッフ';
    const docId = `${staffName}_${dateStr}`;
    const docRef = doc(db, 'shifts', docId);

    const currentStamp = shiftData[dateStr];

    setShiftData(prev => {
      if (currentStamp === activeStamp) {
        const newData = { ...prev };
        delete newData[dateStr];
        return newData;
      }
      return { ...prev, [dateStr]: activeStamp };
    });

    try {
      if (currentStamp === activeStamp) {
        await deleteDoc(docRef);
      } else {
        await setDoc(docRef, {
          staffName,
          dateStr,
          type: activeStamp,
          updatedAt: new Date()
        });
      }
    } catch (error) {
      Alert.alert('エラー', '保存に失敗しました。');
    }
  };

  const selectStamp = (stamp: ShiftType) => {
    setActiveStamp(stamp);
    setStampModalVisible(false);
  };

  const handleSubmit = () => {
    Alert.alert('提出完了', 'シフトの希望を提出しました。');
  };

  const days = generateCalendarDays();
  const weeks = ['日', '月', '火', '水', '木', '金', '土'];
  const spreadsheetWeeks = generateWeeksForSpreadsheet();

  return (
    <SafeAreaView style={styles.container}>
      
      {/* ★ ヘッダー部分に戻るボタンを追加 */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
            <Ionicons name="chevron-back" size={24} color="#5D4037" />
          </TouchableOpacity>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#5D4037' }}>シフト提出</Text>
        </View>
        <TouchableOpacity onPress={() => setSpreadsheetVisible(true)} style={styles.viewBoardBtn}>
          <Ionicons name="grid-outline" size={18} color={COLORS.white} />
          <Text style={styles.viewBoardBtnText}>シフト表を見る</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.stampBanner}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="create-outline" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
          <Text style={styles.bannerText}>現在選択中：</Text>
        </View>
        <View style={[
          styles.activeStampBadge,
          activeStamp === '✕' ? styles.stampBadgeAll : activeStamp === '午前✕' ? styles.stampBadgeAM : styles.stampBadgePM
        ]}>
          <Text style={styles.activeStampText}>{activeStamp}</Text>
        </View>
      </View>

      <ScrollView style={styles.scrollArea}>
        <View style={styles.monthSelector}>
          <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.monthBtn}>
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.monthText}>{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</Text>
          <TouchableOpacity onPress={() => changeMonth(1)} style={styles.monthBtn}>
            <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.calendarContainer}>
          <View style={styles.calHeaderRow}>
            {weeks.map((w, i) => (
              <Text key={i} style={[styles.calWeekText, i === 0 && {color: '#E74C3C'}, i === 6 && {color: '#3498DB'}]}>{w}</Text>
            ))}
          </View>
          
          <View style={styles.calGrid}>
            {days.map((item, index) => {
              if (!item) return <View key={`empty-${index}`} style={styles.calCellEmpty} />;
              
              const isWeekend = new Date(item.dateStr).getDay() === 0 || new Date(item.dateStr).getDay() === 6;
              const cellStamp = shiftData[item.dateStr];

              return (
                <TouchableOpacity 
                  key={item.dateStr} 
                  style={[styles.calCell, cellStamp && styles.calCellActive]}
                  onPress={() => handleDayPress(item.dateStr)}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.calDayText, isWeekend && { color: '#999' }]}>{item.day}</Text>
                  
                  <View style={styles.cellContent}>
                    {cellStamp && (
                      <View style={[
                        styles.stampBadge, 
                        cellStamp === '✕' ? styles.stampBadgeAll : 
                        cellStamp === '午前✕' ? styles.stampBadgeAM : styles.stampBadgePM
                      ]}>
                        <Text style={styles.stampText}>{cellStamp}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.submitContainer}>
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            <Ionicons name="send" size={20} color={COLORS.white} style={{ marginRight: 8 }} />
            <Text style={styles.submitBtnText}>シフトを提出する</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={() => setStampModalVisible(true)}>
        <Ionicons name="options-outline" size={24} color={COLORS.white} />
        <Text style={styles.fabText}>種類変更</Text>
      </TouchableOpacity>

      <Modal visible={spreadsheetVisible} animationType="slide" transparent={false}>
        <SafeAreaView style={styles.ssModalContainer}>
          <View style={styles.ssModalHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="grid" size={24} color={COLORS.primary} style={{ marginRight: 8 }} />
              <Text style={styles.ssModalTitle}>月別シフト表</Text>
            </View>
            <TouchableOpacity onPress={() => setSpreadsheetVisible(false)}>
              <Ionicons name="close-circle" size={32} color={COLORS.textLight} />
            </TouchableOpacity>
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

                    {allStaff.map(staff => (
                      <View key={staff.id} style={styles.ssRow}>
                        <View style={[styles.ssNameCell, { width: '16%', backgroundColor: staff.name === name ? '#FFDAB9' : '#FFC0CB' }]}>
                          <Text style={[styles.ssNameText, staff.name === name && { color: COLORS.primary }]} adjustsFontSizeToFit numberOfLines={1}>{staff.name}</Text>
                        </View>
                        {week.map((day, dIdx) => {
                          let content = '';
                          let bgColor = '#FFFFFF';
                          let isBold = false;
                          const cellWidth = (dIdx === 0 || dIdx === 6) ? '6%' : '14.4%';
                          
                          if (day) {
                            const assigned = assignedShifts[day.dateStr]?.find(s => s.name === staff.name);
                            const req = allRequests[`${staff.name}_${day.dateStr}`];
                            
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
                <View style={{height: 40}} />
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal visible={stampModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>希望休の種類を選択</Text>
              <TouchableOpacity onPress={() => setStampModalVisible(false)}>
                <Ionicons name="close" size={28} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalDesc}>選択した状態でカレンダーをタップすると入力できます。</Text>

            <TouchableOpacity style={styles.stampSelectBtn} onPress={() => selectStamp('✕')}>
              <View style={[styles.stampIconDemo, styles.stampBadgeAll]}>
                <Text style={styles.stampTextDemo}>✕</Text>
              </View>
              <Text style={styles.stampSelectText}>1日お休み</Text>
              {activeStamp === '✕' && <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />}
            </TouchableOpacity>

            <TouchableOpacity style={styles.stampSelectBtn} onPress={() => selectStamp('午前✕')}>
              <View style={[styles.stampIconDemo, styles.stampBadgeAM]}>
                <Text style={styles.stampTextDemo}>午前✕</Text>
              </View>
              <Text style={styles.stampSelectText}>午前のみお休み</Text>
              {activeStamp === '午前✕' && <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />}
            </TouchableOpacity>

            <TouchableOpacity style={styles.stampSelectBtn} onPress={() => selectStamp('午後✕')}>
              <View style={[styles.stampIconDemo, styles.stampBadgePM]}>
                <Text style={styles.stampTextDemo}>午後✕</Text>
              </View>
              <Text style={styles.stampSelectText}>午後のみお休み</Text>
              {activeStamp === '午後✕' && <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />}
            </TouchableOpacity>

          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  viewBoardBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  viewBoardBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 12, marginLeft: 4 },
  stampBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFDF5', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#F3E5AB', marginTop: 10 },
  bannerText: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  activeStampBadge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
  activeStampText: { color: COLORS.text, fontWeight: 'bold', fontSize: 14 },
  scrollArea: { flex: 1 },
  monthSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  monthBtn: { padding: 8, backgroundColor: COLORS.surface, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border },
  monthText: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  calendarContainer: { paddingHorizontal: 12, paddingBottom: 20 },
  calHeaderRow: { flexDirection: 'row', marginBottom: 12 },
  calWeekText: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 'bold', color: COLORS.textLight },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCellEmpty: { width: '14.28%', aspectRatio: 0.8 },
  calCell: { width: '14.28%', aspectRatio: 0.8, borderWidth: 0.5, borderColor: COLORS.border, padding: 4, backgroundColor: COLORS.white },
  calCellActive: { backgroundColor: '#FAFAFA' },
  calDayText: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 4, textAlign: 'center' },
  cellContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  stampBadge: { paddingHorizontal: 4, paddingVertical: 4, borderRadius: 6, width: '100%', alignItems: 'center', justifyContent: 'center' },
  stampBadgeAll: { backgroundColor: '#FFE4E1' }, 
  stampBadgeAM: { backgroundColor: '#E0FFFF' },  
  stampBadgePM: { backgroundColor: '#FFFACD' },  
  stampText: { fontSize: 11, fontWeight: 'bold', color: COLORS.text },
  submitContainer: { padding: 20, paddingBottom: 100 },
  submitBtn: { flexDirection: 'row', backgroundColor: COLORS.primary, padding: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  submitBtnText: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },
  fab: { position: 'absolute', right: 20, bottom: 40, backgroundColor: COLORS.secondary, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 30, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  fabText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16, marginLeft: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { width: '100%', backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 15, elevation: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  modalDesc: { fontSize: 13, color: COLORS.textLight, marginBottom: 24 },
  stampSelectBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: COLORS.border },
  stampIconDemo: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, marginRight: 16, width: 80, alignItems: 'center' },
  stampTextDemo: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  stampSelectText: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, flex: 1 },
  ssModalContainer: { flex: 1, backgroundColor: COLORS.background },
  ssModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border },
  ssModalTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
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
  ssNameCell: { backgroundColor: '#FFC0CB', borderWidth: 1, borderColor: '#666', justifyContent: 'center', alignItems: 'center', paddingVertical: 6 },
  ssNameText: { fontSize: 10, fontWeight: 'bold', color: '#333', textAlign: 'center', paddingHorizontal: 2 },
  ssDataCell: { borderWidth: 1, borderColor: '#666', justifyContent: 'center', alignItems: 'center', paddingVertical: 4 },
  ssDataText: { fontSize: 9, color: '#333', textAlign: 'center', lineHeight: 11 },
});