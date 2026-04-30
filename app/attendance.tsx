import { Ionicons } from '@expo/vector-icons';
import { collection, doc, getDocs, onSnapshot, query } from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

// --- 型定義 ---
interface Kid {
  id: string;
  name: string;
  school: string;
  grade: string;
  usageType: string;
  days: Record<string, boolean>;
  isStaffChild?: boolean;
  parentName?: string;
}

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const PASTEL_COLORS = ['#FFE4E1', '#E6F2FF', '#F0FFF0', '#F8F0FF', '#FFFFE0', '#FFF5EE'];

export default function AttendanceScreen() {
  const [kids, setKids] = useState<Kid[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [pastWeeks, setPastWeeks] = useState(0);   
  const [futureWeeks, setFutureWeeks] = useState(1); 
  
  const scrollViewRef = useRef<ScrollView>(null);
  const [layouts, setLayouts] = useState<Record<string, number>>({});

  const [schoolModalData, setSchoolModalData] = useState<{ date: string, title: string, kids: Kid[] } | null>(null);
  const [timeModalData, setTimeModalData] = useState<{ date: string, title: string, subtitle: string, kids: Kid[] } | null>(null);

  const [scheduleOverrides, setScheduleOverrides] = useState<Record<string, any>>({});
  const [schoolTimesData, setSchoolTimesData] = useState<Record<string, any>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, any[]>>({});
  const [holidays, setHolidays] = useState<any[]>([]); 
  const [eventsData, setEventsData] = useState<Record<string, string>>({});
  
  // ★ 追加：祝日データの管理
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 祝日データの自動取得
        try {
          const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
          const data = await res.json();
          setPublicHolidays(data);
        } catch (e) {
          console.warn('祝日APIの取得に失敗しました', e);
        }

        const q = query(collection(db, 'accounts')); 
        const snapshot = await getDocs(q);
        
        let allKids: Kid[] = [];
        snapshot.docs.forEach(docSnap => {
          const data = docSnap.data();
          const parentId = docSnap.id;

          if (data.role === 'staff' && data.hasChild) {
            allKids.push({
              id: parentId,
              name: data.childName || 'スタッフの子',
              school: data.childSchool || '',
              grade: data.childGrade || '',
              usageType: '定期利用', 
              days: { 月:true, 火:true, 水:true, 木:true, 金:true }, 
              isStaffChild: true,
              parentName: data.name
            });
          } else if (data.role === 'user') {
            if (data.school) {
              allKids.push({
                id: parentId,
                name: data.name,
                school: data.school,
                grade: data.grade,
                usageType: data.usageType || '定期利用',
                days: data.days || {}
              });
            }
            if (data.siblings && Array.isArray(data.siblings)) {
              data.siblings.forEach((sib: any, idx: number) => {
                if (sib.school) {
                  allKids.push({
                    id: `${parentId}_sib_${idx}`,
                    name: sib.name,
                    school: sib.school,
                    grade: sib.grade,
                    usageType: sib.usageType || '定期利用',
                    days: sib.days || {}
                  });
                }
              });
            }
          }
        });
        setKids(allKids);

        onSnapshot(collection(db, 'schedules'), (snap) => {
          const sData: Record<string, any> = {};
          snap.forEach(d => {
            const item = d.data();
            sData[`${item.childId}_${item.dateStr}`] = { pickupTime: item.pickupTime, lesson: item.lesson };
          });
          setScheduleOverrides(sData);
        });

        onSnapshot(collection(db, 'school_times'), (snap) => {
          const times: Record<string, any> = {};
          snap.forEach(d => { times[d.id] = d.data(); });
          setSchoolTimesData(times);
        });

        onSnapshot(collection(db, 'assigned_shifts'), (snap) => {
          const shifts: Record<string, any[]> = {};
          snap.forEach(d => { shifts[d.id] = d.data().staff || []; });
          setAssignedShifts(shifts);
        });

        onSnapshot(doc(db, 'settings', 'holidays_data'), (docSnap) => {
          if (docSnap.exists() && docSnap.data().periods) {
            setHolidays(docSnap.data().periods);
          } else {
            setHolidays([]);
          }
        });

        onSnapshot(collection(db, 'events'), (snap) => {
          const eData: Record<string, string> = {};
          snap.forEach(d => { eData[d.id] = d.data().title; });
          setEventsData(eData);
        });

      } catch (error) {
        console.error("データ取得エラー:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const datesToDisplay = useMemo(() => {
    const arr = [];
    const today = new Date();
    const startOffset = -7 * pastWeeks;
    const endOffset = 7 * futureWeeks;

    for (let i = startOffset; i < endOffset; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [pastWeeks, futureWeeks]);

  const getCalculatedTime = (dateStr: string, kid: Kid) => {
    const d = new Date(dateStr);
    const dayOfWeekStr = DAY_NAMES[d.getDay()];
    
    const override = scheduleOverrides[`${kid.id}_${dateStr}`];
    if (override && override.pickupTime !== undefined) {
      return { pickupTime: override.pickupTime, lesson: override.lesson };
    }

    let autoPickup = null;
    
    if (dayOfWeekStr !== '日' && dayOfWeekStr !== '土' && !publicHolidays[dateStr]) {
      const isHoliday = holidays.some(h => dateStr >= h.start && dateStr <= h.end);
      
      if (!isHoliday) {
        if (kid.isStaffChild) {
          const todaysShift = assignedShifts[dateStr] || [];
          const parentHasShift = todaysShift.some((staff: any) => staff.name === kid.parentName);
          if (parentHasShift) {
            autoPickup = schoolTimesData[kid.school]?.[kid.grade]?.[dayOfWeekStr] || null;
          }
        } else if (kid.usageType === '定期利用' && kid.days && kid.days[dayOfWeekStr]) {
          autoPickup = schoolTimesData[kid.school]?.[kid.grade]?.[dayOfWeekStr] || null;
        }
      }
    }

    return { pickupTime: autoPickup, lesson: override?.lesson || null };
  };

  const getAttendanceForDay = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const schools: Record<string, Record<string, Kid[]>> = {};
    const lessons: Record<string, Kid[]> = {}; 
    let totalCount = 0;

    kids.forEach((kid) => {
      const { pickupTime, lesson } = getCalculatedTime(dateStr, kid);

      if (pickupTime) {
        totalCount++;
        if (!schools[kid.school]) schools[kid.school] = {};
        if (!schools[kid.school][pickupTime]) schools[kid.school][pickupTime] = [];
        schools[kid.school][pickupTime].push(kid);
      }

      if (lesson) {
        const key = `${lesson.time} ${lesson.name}`;
        if (!lessons[key]) lessons[key] = [];
        lessons[key].push(kid);
      }
    });

    return { schools, lessons, totalCount };
  };

  const getCardColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return PASTEL_COLORS[Math.abs(hash) % PASTEL_COLORS.length];
  };

  const scrollToDate = (dateKey: string) => {
    const y = layouts[dateKey];
    if (y !== undefined && scrollViewRef.current) {
      scrollViewRef.current.scrollTo({ y: y - 10, animated: true });
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topNav}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topNavScroll}>
          {datesToDisplay.map((d, index) => {
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            const day = d.getDate();
            const dateStrForHoliday = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayOfWeek = d.getDay();
            const dayStr = DAY_NAMES[dayOfWeek];
            const dateKey = `${m}/${day}`;
            const isToday = d.toDateString() === new Date().toDateString();
            
            // ★ 土日祝の色判定
            const isSaturday = dayOfWeek === 6;
            const isSunday = dayOfWeek === 0;
            const isPublicHoliday = !!publicHolidays[dateStrForHoliday];
            
            let textColorStyle = {};
            if (!isToday) {
              if (isSaturday) textColorStyle = { color: 'blue' };
              if (isSunday || isPublicHoliday) textColorStyle = { color: 'red' };
            }

            return (
              <TouchableOpacity key={index} style={[styles.navDateBtn, isToday && styles.navDateBtnToday]} onPress={() => scrollToDate(dateKey)}>
                <Text style={[styles.navDateText, isToday && styles.navDateTextToday, textColorStyle]}>
                  {m}/{day}({dayStr})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView ref={scrollViewRef} style={styles.mainScroll} contentContainerStyle={{ paddingBottom: 100 }}>
        <TouchableOpacity style={styles.loadMoreBtn} onPress={() => setPastWeeks(prev => prev + 1)}>
          <Ionicons name="arrow-up-circle-outline" size={20} color={COLORS.primary} />
          <Text style={styles.loadMoreText}>さらに過去の1週間分を表示</Text>
        </TouchableOpacity>

        {datesToDisplay.map((date, index) => {
          const m = date.getMonth() + 1;
          const day = date.getDate();
          const dayOfWeek = date.getDay();
          const dayStr = DAY_NAMES[dayOfWeek];
          const dateKey = `${m}/${day}`;
          
          const year = date.getFullYear();
          const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          
          const isPublicHoliday = !!publicHolidays[dateStr];
          const eventTitle = eventsData[dateStr];
          
          // ★ 土日祝の色判定
          const isSaturday = dayOfWeek === 6;
          const isSunday = dayOfWeek === 0;
          let headerColorStyle = {};
          if (isSaturday) headerColorStyle = { color: 'blue' };
          if (isSunday || isPublicHoliday) headerColorStyle = { color: 'red' };

          const attendanceData = getAttendanceForDay(date);
          const hasLessons = Object.keys(attendanceData.lessons).length > 0;

          return (
            <View 
              key={index} 
              style={styles.daySection}
              onLayout={(e) => {
                const y = e.nativeEvent.layout.y;
                setLayouts(prev => ({ ...prev, [dateKey]: y }));
              }}
            >
              <View style={styles.dayHeaderContainer}>
                <Text style={[styles.dayHeaderText, headerColorStyle]}>
                  {m}月{day}日 ({dayStr})
                </Text>
                {isPublicHoliday && <Text style={{ color: 'red', marginLeft: 8, fontSize: 12, fontWeight: 'bold' }}>{publicHolidays[dateStr]}</Text>}
                
                {eventTitle && (
                  <View style={styles.eventBadgeLarge}>
                    <Text style={styles.eventBadgeTextLarge}>{eventTitle}</Text>
                  </View>
                )}

                <View style={styles.totalBadge}>
                  <Text style={styles.totalBadgeText}>合計: {attendanceData.totalCount}名</Text>
                </View>
              </View>

              {attendanceData.totalCount > 0 || hasLessons ? (
                <View style={styles.schoolsGrid}>
                  {Object.entries(attendanceData.schools).map(([schoolName, timesMap]) => {
                    const allKidsInSchool = Object.values(timesMap).flat();
                    return (
                      <View key={schoolName} style={[styles.schoolCard, { backgroundColor: getCardColor(schoolName) }]}>
                        <TouchableOpacity style={styles.schoolNameBtn} onPress={() => setSchoolModalData({ date: dateKey, title: schoolName, kids: allKidsInSchool })}>
                          <Text style={styles.schoolNameText} numberOfLines={2} adjustsFontSizeToFit>{schoolName}</Text>
                        </TouchableOpacity>
                        <View style={styles.timeGroupContainer}>
                          {Object.entries(timesMap).sort(([a], [b]) => a.localeCompare(b)).map(([time, kids]) => (
                            <TouchableOpacity key={time} style={styles.timeButton} onPress={() => setTimeModalData({ date: dateKey, title: schoolName, subtitle: `${time} 下校`, kids })}>
                              <Text style={styles.timeButtonText}>{time}</Text>
                              <Text style={styles.timeCountText}>{kids.length}名</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    );
                  })}
                  {hasLessons && (
                    <View style={[styles.schoolCard, { backgroundColor: '#F0F8FF' }]}>
                      <TouchableOpacity style={styles.schoolNameBtn} onPress={() => setSchoolModalData({ date: dateKey, title: '習い事', kids: Object.values(attendanceData.lessons).flat() })}>
                        <Text style={[styles.schoolNameText, { color: '#4682B4' }]}><Ionicons name="color-wand" size={12} /> 習い事</Text>
                      </TouchableOpacity>
                      <View style={styles.timeGroupContainer}>
                        {Object.entries(attendanceData.lessons).map(([lessonKey, kids]) => (
                          <TouchableOpacity key={lessonKey} style={styles.timeButton} onPress={() => setTimeModalData({ date: dateKey, title: '習い事', subtitle: lessonKey, kids })}>
                            <Text style={[styles.timeButtonText, { color: '#4682B4', fontSize: 10 }]} numberOfLines={1}>{lessonKey}</Text>
                            <Text style={styles.timeCountText}>{kids.length}名</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.noDataBox}><Text style={styles.noDataText}>利用予定の児童はいません</Text></View>
              )}
            </View>
          );
        })}

        <TouchableOpacity style={styles.loadMoreBtn} onPress={() => setFutureWeeks(prev => prev + 1)}>
          <Ionicons name="arrow-down-circle-outline" size={20} color={COLORS.primary} />
          <Text style={styles.loadMoreText}>さらに次の1週間分を表示</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* --- モーダル群 (省略なし) --- */}
      <Modal visible={!!schoolModalData} transparent animationType="fade">
        <View style={styles.modalOverlay}><View style={styles.modalContent}>{schoolModalData && (
          <><View style={styles.modalHeader}><Text style={styles.modalSubTitle}>{schoolModalData.date} の予定</Text><TouchableOpacity onPress={() => setSchoolModalData(null)}><Ionicons name="close-circle" size={28} color={COLORS.textLight} /></TouchableOpacity></View>
          <Text style={styles.modalMainTitle}>{schoolModalData.title}</Text><ScrollView style={styles.modalList}>{schoolModalData.kids.map(kid => (
            <View key={kid.id} style={styles.modalListItem}><Ionicons name="person" size={16} color={COLORS.primary} /><Text style={styles.modalItemName}>{kid.name}</Text><Text style={styles.modalItemSub}>{kid.grade}</Text></View>
          ))}</ScrollView></>
        )}</View></View>
      </Modal>
      <Modal visible={!!timeModalData} transparent animationType="fade">
        <View style={styles.modalOverlay}><View style={styles.modalContent}>{timeModalData && (
          <><View style={styles.modalHeader}><Text style={styles.modalSubTitle}>{timeModalData.title}</Text><TouchableOpacity onPress={() => setTimeModalData(null)}><Ionicons name="close-circle" size={28} color={COLORS.textLight} /></TouchableOpacity></View>
          <Text style={styles.modalMainTitle}>{timeModalData.subtitle}</Text><ScrollView style={styles.modalList}>{timeModalData.kids.map(kid => (
            <View key={kid.id} style={styles.modalListItem}><Ionicons name="time" size={16} color={COLORS.info} /><Text style={styles.modalItemName}>{kid.name}</Text><Text style={styles.modalItemSub}>{kid.grade}</Text></View>
          ))}</ScrollView></>
        )}</View></View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  topNav: { backgroundColor: COLORS.surface, borderBottomWidth: 1, borderColor: COLORS.border, paddingVertical: 10 },
  topNavScroll: { paddingHorizontal: 12, alignItems: 'center' },
  navDateBtn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 8, backgroundColor: '#F0F0F0', marginHorizontal: 4 },
  navDateBtnToday: { backgroundColor: COLORS.primary },
  navDateText: { fontSize: 16, fontWeight: 'bold', color: COLORS.textLight },
  navDateTextToday: { color: COLORS.white },
  mainScroll: { flex: 1, backgroundColor: '#F8F9FA' },
  loadMoreBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.white, margin: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: COLORS.primary, borderStyle: 'dashed' },
  loadMoreText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 14, marginLeft: 8 },
  daySection: { marginBottom: 32 },
  dayHeaderContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 16, marginTop: 8, flexWrap: 'wrap' },
  dayHeaderText: { fontSize: 22, fontWeight: 'bold', color: COLORS.text },
  
  eventBadgeLarge: { backgroundColor: '#20B2AA', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginLeft: 12 },
  eventBadgeTextLarge: { color: COLORS.white, fontSize: 12, fontWeight: 'bold' },

  totalBadge: { marginLeft: 12, backgroundColor: COLORS.primary + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: COLORS.primary },
  totalBadgeText: { fontSize: 13, fontWeight: 'bold', color: COLORS.secondary },
  schoolsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10 },
  schoolCard: { width: '31.3%', borderRadius: 12, marginHorizontal: '1%', marginBottom: 12, padding: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  schoolNameBtn: { alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  schoolNameText: { fontSize: 13, fontWeight: 'bold', color: COLORS.text, textAlign: 'center' },
  timeGroupContainer: { gap: 8 },
  timeButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 6, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, elevation: 3, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  timeButtonText: { fontSize: 12, fontWeight: 'bold', color: COLORS.text },
  timeCountText: { fontSize: 12, fontWeight: 'bold', color: COLORS.primary },
  noDataBox: { marginHorizontal: 16, padding: 16, backgroundColor: COLORS.white, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed' },
  noDataText: { color: COLORS.textLight, fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxHeight: '70%', backgroundColor: COLORS.white, borderRadius: 16, padding: 24, elevation: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalSubTitle: { fontSize: 14, color: COLORS.textLight, fontWeight: 'bold' },
  modalMainTitle: { fontSize: 22, fontWeight: 'bold', color: COLORS.primary, marginBottom: 16 },
  modalList: { flexGrow: 0 },
  modalListItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: COLORS.border },
  modalItemName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, flex: 1, marginLeft: 12 },
  modalItemSub: { fontSize: 14, color: COLORS.textLight },
});