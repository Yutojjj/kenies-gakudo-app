import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc } from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import TransportModal from '../components/TransportModal';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

const customAlert = (title: string, message?: string) => {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
};

interface Kid {
  id: string;
  name: string;
  school: string;
  grade: string;
  usageType: string;
  days: Record<string, boolean>;
  isStaffChild?: boolean;
  parentName?: string;
  isManualOverride?: boolean;
  nicknameKana?: string;
  parentDocId?: string;
  hasMemo?: boolean;
}

type ViewMode = 'attendance' | 'schoolUsers' | 'transport';

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const PASTEL_COLORS = ['#FFE4E1', '#E6F2FF', '#F0FFF0', '#F8F0FF', '#FFFFE0', '#FFF5EE'];
const BG_COLORS = ['#FFE4E1', '#E0FFFF', '#E6E6FA', '#FFFACD', '#F0FFF0', '#F5FFFA', '#FFE4B5', '#F0F8FF'];

// 固定の学校順序
const FIXED_SCHOOL_ORDER = [
  '蟹江小',
  '須西小',
  '学戸小',
  '新蟹江小',
  '豊治小',
  '南陽小',
  '千音寺小',
  '戸田小',
  '春田小',
  '福田小',
  '福春小'
];

const getGradeValue = (grade: string | undefined | null) => {
  if (!grade) return 99;
  const match = grade.match(/\d/);
  return match ? parseInt(match[0], 10) : 99;
};

const sortKidsByGrade = (kidsArray: any[]) => {
  return [...kidsArray].sort((a, b) => getGradeValue(a.grade) - getGradeValue(b.grade));
};

export default function AttendanceScreen() {
  const router = useRouter();
  
  const [currentView, setCurrentView] = useState<ViewMode>('attendance');
  const [userListSearch, setUserListSearch] = useState('');
  const [userListFilterDow, setUserListFilterDow] = useState('');
  const [pickupAssignments, setPickupAssignments] = useState<Record<string, any>>({});
  const [allStaffList, setAllStaffList] = useState<string[]>([]);
  const [transportWeekOffset, setTransportWeekOffset] = useState(0);
  const [selectedTransportDate, setSelectedTransportDate] = useState<string | null>(null);
  const [transportModalVisible, setTransportModalVisible] = useState(false);
  const [showKidNames, setShowKidNames] = useState(true);

  const [isAdmin, setIsAdmin] = useState(false);
  const [kids, setKids] = useState<Kid[]>([]);
  const [masterSchools, setMasterSchools] = useState<string[]>([]);
  
  const [pastWeeks, setPastWeeks] = useState(0);   
  const [futureWeeks, setFutureWeeks] = useState(1); 
  
  const scrollViewRef = useRef<ScrollView>(null);
  const [layouts, setLayouts] = useState<Record<string, number>>({});

  const [schoolModalData, setSchoolModalData] = useState<{ date: string, title: string, kids: Kid[] } | null>(null);
  const [timeModalData, setTimeModalData] = useState<{ date: string, title: string, subtitle: string, kids: Kid[] } | null>(null);

  const [scheduleOverrides, setScheduleOverrides] = useState<Record<string, any>>({});
  const [scheduleMemoData, setScheduleMemoData] = useState<Record<string, string>>({});
  const [schoolTimesData, setSchoolTimesData] = useState<Record<string, any>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, any[]>>({});
  const [lessonsData, setLessonsData] = useState<any[]>([]);
  const [holidays, setHolidays] = useState<any[]>([]); 
  const [eventsData, setEventsData] = useState<Record<string, string>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});

  const [activeSchool, setActiveSchool] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(raw => {
      if (raw) { try { setIsAdmin(JSON.parse(raw).role === 'admin'); } catch {} }
    });
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        try {
          const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
          const data = await res.json();
          setPublicHolidays(data);
        } catch (e) {
          console.warn('祝日APIの取得に失敗しました', e);
        }

        const masterRef = doc(db, 'settings', 'master_data');
        const masterSnap = await getDoc(masterRef);
        if (masterSnap.exists() && masterSnap.data().schools) {
            setMasterSchools(masterSnap.data().schools);
        }

        const q = query(collection(db, 'accounts')); 
        const snapshot = await getDocs(q);
        
        let allKids: Kid[] = [];
        snapshot.docs.forEach(docSnap => {
          const data = docSnap.data();
          const parentId = docSnap.id;

          if (data.role === 'staff' && data.hasChild) {
            if (data.staffChildren && data.staffChildren.length > 0) {
              data.staffChildren.forEach((child: any, idx: number) => {
                 allKids.push({
                   id: `${parentId}_${child.id || `staffchild_${idx}`}`,
                   name: child.name,
                   school: child.school || '',
                   grade: child.grade || '',
                   usageType: '定期利用', 
                   days: { 月:true, 火:true, 水:true, 木:true, 金:true }, 
                   isStaffChild: true,
                   parentName: data.name,
                   nicknameKana: ''
                 });
              });
            } else if (data.childName) {
              allKids.push({
                id: `${parentId}_staffchild_0`,
                name: data.childName,
                school: data.childSchool || '',
                grade: data.childGrade || '',
                usageType: '定期利用', 
                days: { 月:true, 火:true, 水:true, 木:true, 金:true }, 
                isStaffChild: true,
                parentName: data.name,
                nicknameKana: ''
              });
            }
          } else if (data.role === 'user') {
            if (data.school) {
              allKids.push({
                id: parentId,
                name: data.name,
                school: data.school,
                grade: data.grade,
                usageType: data.usageType || '定期利用',
                days: data.days || {},
                nicknameKana: data.nicknameKana || '',
                parentDocId: parentId,
              });
            }
            if (data.siblings && Array.isArray(data.siblings)) {
              data.siblings.forEach((sib: any, idx: number) => {
                if (sib.school) {
                  allKids.push({
                    id: sib.id || `${parentId}_sib_${idx}`,
                    name: sib.name,
                    school: sib.school,
                    grade: sib.grade,
                    usageType: sib.usageType || '定期利用',
                    days: sib.days || {},
                    nicknameKana: sib.nicknameKana || '',
                    parentDocId: parentId,
                  });
                }
              });
            }
          }
        });
        setKids(allKids);

        onSnapshot(collection(db, 'schedules2'), (snap) => {
          const sData: Record<string, any> = {};
          snap.forEach(d => {
            const item = d.data();
            sData[`${item.childId}_${item.dateStr}`] = { pickupTime: item.pickupTime, lesson: item.lesson, memo: item.memo };
          });
          setScheduleOverrides(sData);
        });

        onSnapshot(collection(db, 'schedule_memos'), (snap) => {
          const mData: Record<string, string> = {};
          snap.forEach(d => {
            const item = d.data();
            if (item.childId && item.dateStr && item.memo) {
              mData[`${item.childId}_${item.dateStr}`] = item.memo;
            }
          });
          setScheduleMemoData(mData);
        });

        onSnapshot(collection(db, 'school_times'), (snap) => {
          const times: Record<string, any> = {};
          snap.forEach(d => { times[d.id] = d.data(); });
          setSchoolTimesData(times);
        });

        onSnapshot(collection(db, 'lessons'), (snap) => {
          setLessonsData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        onSnapshot(collection(db, 'assigned_shifts'), (snap) => {
          const shifts: Record<string, any[]> = {};
          snap.forEach(d => { shifts[d.id] = d.data().staff || []; });
          setAssignedShifts(shifts);
        });

        onSnapshot(collection(db, 'pickup_assignments'), (snap) => {
          const data: Record<string, any> = {};
          snap.forEach(d => { data[d.id] = d.data(); });
          setPickupAssignments(data);
        });

        getDocs(query(collection(db, 'accounts'))).then(snap => {
          const names = snap.docs
            .filter(d => ['staff','admin'].includes(d.data().role))
            .map(d => d.data().name as string).filter(Boolean);
          setAllStaffList(names);
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
    const memo = scheduleMemoData[`${kid.id}_${dateStr}`] || override?.memo || null;
    if (override && override.pickupTime !== undefined) {
      return { pickupTime: override.pickupTime, lesson: override.lesson, isManual: true, memo };
    }
    // スポット利用でschedules2に登録がある場合は学校時刻を自動セット
    if (override && kid.usageType !== '定期利用' && !kid.isStaffChild) {
      const autoTime = schoolTimesData[kid.school]?.[kid.grade]?.[new Date(dateStr).getDay() === 0 ? '日' : ['日','月','火','水','木','金','土'][new Date(dateStr).getDay()]] || null;
      return { pickupTime: autoTime, lesson: override.lesson, isManual: true, memo };
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
        } else if (kid.usageType !== '定期利用') {
          // 定期利用以外（スポット等）はschedules2に登録があれば学校時刻を自動セット
          const overrideKey = `${kid.id}_${dateStr}`;
          const hasOverride = scheduleOverrides[overrideKey];
          if (hasOverride && !hasOverride.pickupTime) {
            autoPickup = schoolTimesData[kid.school]?.[kid.grade]?.[dayOfWeekStr] || null;
          }
        }
      }
    }

    // 習い事一覧管理の定期習い事（その曜日に一致するもの）
    const regularLesson = lessonsData.find(
      l => l.childId === kid.id && l.dayOfWeek === dayOfWeekStr
    );
    const finalLesson = override?.lesson || (regularLesson ? { name: regularLesson.lessonName, time: regularLesson.lessonTime } : null);

    return { pickupTime: autoPickup, lesson: finalLesson, isManual: false, memo };
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
      const { pickupTime, lesson, isManual, memo } = getCalculatedTime(dateStr, kid);
      const displayKid = { ...kid, isManualOverride: isManual, hasMemo: !!memo };

      if (pickupTime) {
        totalCount++;
        if (!schools[kid.school]) schools[kid.school] = {};
        if (!schools[kid.school][pickupTime]) schools[kid.school][pickupTime] = [];
        schools[kid.school][pickupTime].push(displayKid);
      }

      if (lesson) {
        const key = `${lesson.time} ${lesson.name}`;
        if (!lessons[key]) lessons[key] = [];
        lessons[key].push(displayKid);
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

  const groupedUsersBySchool = useMemo(() => {
    const grouped: Record<string, Kid[]> = {};
    kids.forEach(k => {
      if (k.isStaffChild) return;
      const s = k.school || '未設定の学校';
      if (!grouped[s]) grouped[s] = [];
      grouped[s].push(k);
    });
    // 学年順でソート
    Object.keys(grouped).forEach(s => {
      grouped[s] = sortKidsByGrade(grouped[s]);
    });
    return grouped;
  }, [kids]);
  
  const sortedSchoolNames = useMemo(() => {
    const allSchools = Object.keys(groupedUsersBySchool);
    return FIXED_SCHOOL_ORDER.filter(s => allSchools.includes(s)).concat(
      allSchools.filter(s => !FIXED_SCHOOL_ORDER.includes(s))
    );
  }, [groupedUsersBySchool]);

  const renderAttendanceView = () => (
    <>
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
          
          const isSaturday = dayOfWeek === 6;
          const isSunday = dayOfWeek === 0;
          let headerColorStyle = {};
          if (isSaturday) headerColorStyle = { color: 'blue' };
          if (isSunday || isPublicHoliday) headerColorStyle = { color: 'red' };

          const attendanceData = getAttendanceForDay(date);
          const hasLessons = Object.keys(attendanceData.lessons).length > 0;

          const sortedAttendanceSchools = Object.entries(attendanceData.schools).sort(([schoolA], [schoolB]) => {
              const idxA = sortedSchoolNames.indexOf(schoolA);
              const idxB = sortedSchoolNames.indexOf(schoolB);
              if (idxA !== -1 && idxB !== -1) return idxA - idxB;
              if (idxA !== -1) return -1;
              if (idxB !== -1) return 1;
              return schoolA.localeCompare(schoolB);
          });

          return (
            <View 
              key={index} 
              style={styles.daySection} 
              onLayout={(e) => { 
                const currentY = e.nativeEvent.layout.y;
                setLayouts(prev => ({ ...prev, [dateKey]: currentY })); 
              }}
            >
              <View style={[styles.dayHeaderContainer, Platform.OS === 'web' && ({ position: 'sticky', top: 0, zIndex: 10 } as any)]}>
                <Text style={[styles.dayHeaderText, headerColorStyle]}>{m}月{day}日 ({dayStr})</Text>
                {isPublicHoliday && <Text style={{ color: 'red', marginLeft: 8, fontSize: 12, fontWeight: 'bold' }}>{publicHolidays[dateStr]}</Text>}
                {eventTitle && <View style={styles.eventBadgeLarge}><Text style={styles.eventBadgeTextLarge}>{eventTitle}</Text></View>}
                <View style={styles.totalBadge}><Text style={styles.totalBadgeText}>合計: {attendanceData.totalCount}名</Text></View>
              </View>

              {attendanceData.totalCount > 0 || hasLessons ? (
                <View style={styles.schoolsGrid}>
                  {sortedAttendanceSchools.map(([schoolName, timesMap]) => {
                    const allKidsInSchool = Object.values(timesMap).flat();
                    return (
                      <View key={schoolName} style={[styles.schoolCard, { backgroundColor: getCardColor(schoolName) }]}>
                        <TouchableOpacity style={styles.schoolNameBtn} onPress={() => setSchoolModalData({ date: dateKey, title: schoolName, kids: sortKidsByGrade(allKidsInSchool) })}>
                          <Text style={styles.schoolNameText} numberOfLines={2} adjustsFontSizeToFit>{schoolName}</Text>
                        </TouchableOpacity>
                        <View style={styles.timeGroupContainer}>
                          {Object.entries(timesMap).sort(([a], [b]) => a.localeCompare(b)).map(([time, kids]) => {
                             const hasManualOverride = kids.some(k => k.isManualOverride);
                             const hasAnyMemo = kids.some(k => k.hasMemo);
                             return (
                              <TouchableOpacity key={time} style={[styles.timeButton, showKidNames && styles.timeButtonExpanded]} onPress={() => setTimeModalData({ date: dateKey, title: schoolName, subtitle: `${time} 下校`, kids: sortKidsByGrade(kids) })}>
                                {showKidNames ? (
                                  <>
                                    <View style={styles.timeHeaderRow}>
                                      <Text style={[styles.timeLabel, hasManualOverride && { color: COLORS.danger }]}>{time}{hasAnyMemo ? ' 📝' : ''}</Text>
                                      <Text style={styles.timeCountBadge}>{kids.length}名</Text>
                                    </View>
                                    <View style={styles.kidNamesContainer}>
                                      {sortKidsByGrade(kids).map(k => (
                                        <Text key={k.id} style={[styles.kidNameText, k.isManualOverride && { color: COLORS.danger }, k.hasMemo && { fontWeight: 'bold' }]} numberOfLines={1}>{k.hasMemo ? '📝' : ''}{k.name}{k.grade ? `（${k.grade}）` : ''}</Text>
                                      ))}
                                    </View>
                                  </>
                                ) : (
                                  <>
                                    <Text style={[styles.timeButtonText, hasManualOverride && { color: COLORS.danger }]}>{time}{hasAnyMemo ? ' 📝' : ''}</Text>
                                    <Text style={styles.timeCountText}>{kids.length}名</Text>
                                  </>
                                )}
                              </TouchableOpacity>
                             )
                          })}
                        </View>
                      </View>
                    );
                  })}
                  {hasLessons && (() => {
                    // 習い事1（通常）と習い事2（スイミング・プログラミング・ダンス）に分離
                    const LESSON2_NAMES = ['スイミング', 'プログラミング', 'ダンス'];
                    const lesson1Entries = Object.entries(attendanceData.lessons)
                      .filter(([key]) => !LESSON2_NAMES.some(n => key.includes(n)))
                      .sort(([a], [b]) => a.localeCompare(b));
                    const lesson2Entries = Object.entries(attendanceData.lessons)
                      .filter(([key]) => LESSON2_NAMES.some(n => key.includes(n)))
                      .sort(([a], [b]) => a.localeCompare(b));

                    return (
                      <>
                        {lesson1Entries.length > 0 && (
                          <View style={[styles.schoolCard, { backgroundColor: '#F0F8FF' }]}>
                            <TouchableOpacity style={styles.schoolNameBtn} onPress={() => setSchoolModalData({ date: dateKey, title: '習い事', kids: sortKidsByGrade(lesson1Entries.flatMap(([,kids]) => kids)) })}>
                              <Text style={[styles.schoolNameText, { color: '#4682B4' }]}>習い事</Text>
                            </TouchableOpacity>
                            <View style={styles.timeGroupContainer}>
                              {lesson1Entries.map(([lessonKey, kids]) => {
                                const spaceIdx = lessonKey.indexOf(' ');
                                const lessonTime = spaceIdx >= 0 ? lessonKey.substring(0, spaceIdx) : '';
                                const lessonName = spaceIdx >= 0 ? lessonKey.substring(spaceIdx + 1) : lessonKey;
                                return (
                                  <TouchableOpacity key={lessonKey} style={[styles.timeButton, showKidNames && styles.timeButtonExpanded]} onPress={() => setTimeModalData({ date: dateKey, title: '習い事', subtitle: lessonKey, kids: sortKidsByGrade(kids) })}>
                                    {showKidNames ? (
                                      <>
                                        <View style={styles.timeHeaderRow}>
                                          <View>
                                            <Text style={[styles.timeLabel, { color: '#4682B4', fontWeight: 'bold' }]}>{lessonTime}</Text>
                                            <Text style={[styles.timeLabel, { color: '#4682B4' }]} numberOfLines={1}>{lessonName}</Text>
                                          </View>
                                          <Text style={[styles.timeCountBadge, { color: '#4682B4' }]}>{kids.length}名</Text>
                                        </View>
                                        <View style={styles.kidNamesContainer}>
                                          {kids.map(k => (
                                            <Text key={k.id} style={[styles.kidNameText, { color: '#4682B4' }]} numberOfLines={1}>{k.name}{k.grade ? `（${k.grade}）` : ''}</Text>
                                          ))}
                                        </View>
                                      </>
                                    ) : (
                                      <>
                                        <Text style={[styles.timeButtonText, { color: '#4682B4', fontSize: 10 }]} numberOfLines={1}>{lessonTime}</Text>
                                        <Text style={[styles.timeButtonText, { color: '#4682B4', fontSize: 9 }]} numberOfLines={1}>{lessonName}</Text>
                                        <Text style={styles.timeCountText}>{kids.length}名</Text>
                                      </>
                                    )}
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>
                        )}
                        {lesson2Entries.length > 0 && (
                          <View style={[styles.schoolCard, { backgroundColor: '#F3E5F5' }]}>
                            <TouchableOpacity style={styles.schoolNameBtn} onPress={() => setSchoolModalData({ date: dateKey, title: '習い事2', kids: sortKidsByGrade(lesson2Entries.flatMap(([,kids]) => kids)) })}>
                              <Text style={[styles.schoolNameText, { color: '#7B1FA2' }]}>習い事2</Text>
                            </TouchableOpacity>
                            <View style={styles.timeGroupContainer}>
                              {lesson2Entries.map(([lessonKey, kids]) => {
                                const spaceIdx = lessonKey.indexOf(' ');
                                const lessonTime = spaceIdx >= 0 ? lessonKey.substring(0, spaceIdx) : '';
                                const lessonName = spaceIdx >= 0 ? lessonKey.substring(spaceIdx + 1) : lessonKey;
                                return (
                                  <TouchableOpacity key={lessonKey} style={[styles.timeButton, showKidNames && styles.timeButtonExpanded]} onPress={() => setTimeModalData({ date: dateKey, title: '習い事2', subtitle: lessonKey, kids: sortKidsByGrade(kids) })}>
                                    {showKidNames ? (
                                      <>
                                        <View style={styles.timeHeaderRow}>
                                          <View>
                                            <Text style={[styles.timeLabel, { color: '#7B1FA2', fontWeight: 'bold' }]}>{lessonTime}</Text>
                                            <Text style={[styles.timeLabel, { color: '#7B1FA2' }]} numberOfLines={1}>{lessonName}</Text>
                                          </View>
                                          <Text style={[styles.timeCountBadge, { color: '#7B1FA2' }]}>{kids.length}名</Text>
                                        </View>
                                        <View style={styles.kidNamesContainer}>
                                          {kids.map(k => (
                                            <Text key={k.id} style={[styles.kidNameText, { color: '#7B1FA2' }]} numberOfLines={1}>{k.name}{k.grade ? `（${k.grade}）` : ''}</Text>
                                          ))}
                                        </View>
                                      </>
                                    ) : (
                                      <>
                                        <Text style={[styles.timeButtonText, { color: '#7B1FA2', fontSize: 10 }]} numberOfLines={1}>{lessonTime}</Text>
                                        <Text style={[styles.timeButtonText, { color: '#7B1FA2', fontSize: 9 }]} numberOfLines={1}>{lessonName}</Text>
                                        <Text style={styles.timeCountText}>{kids.length}名</Text>
                                      </>
                                    )}
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>
                        )}
                      </>
                    );
                  })()}
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
    </>
  );

  const transportDates = (() => {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i + transportWeekOffset * 7);
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      dates.push({ date: d, dateStr: ds });
    }
    return dates;
  })();

  const savePickupAssignment = async (dateStr: string, blockKey: string, staffName: string) => {
    const docRef = doc(db, 'pickup_assignments', dateStr);
    const current = pickupAssignments[dateStr] || {};
    await setDoc(docRef, { ...current, [blockKey]: staffName }, { merge: true });
  };

  const renderSchoolUsersView = () => {
    const DOW = ['月','火','水','木','金'];
    const allUsers = Object.values(groupedUsersBySchool).flat();
    const hasFilter = !!(userListSearch || userListFilterDow || activeSchool);

    // 絞り込み結果を計算
    const filtered = allUsers.filter((u: any) => {
      if (userListSearch) {
        const q = userListSearch.toLowerCase();
        if (!u.name?.toLowerCase().includes(q) && !u.nicknameKana?.toLowerCase().includes(q)) return false;
      }
      if (userListFilterDow && !u.days?.[userListFilterDow]) return false;
      if (activeSchool && u.school !== activeSchool) return false;
      return true;
    });

    const filteredBySchool: Record<string, any[]> = {};
    filtered.forEach((u: any) => {
      const s = u.school || '未設定';
      if (!filteredBySchool[s]) filteredBySchool[s] = [];
      filteredBySchool[s].push(u);
    });

    return (
    <ScrollView style={styles.mainScroll}>
      {/* 検索バー */}
      <View style={{ flexDirection:'row', alignItems:'center', backgroundColor:'#F5F5F5', borderRadius:10, margin:12, marginBottom:8, paddingHorizontal:12, paddingVertical:8, borderWidth:1, borderColor:'#EEE' }}>
        <Ionicons name="search" size={18} color={COLORS.textLight} style={{ marginRight:8 }} />
        <TextInput style={{ flex:1, fontSize:14 }} placeholder="名前・ニックネームで検索" placeholderTextColor="#BBB"
          value={userListSearch} onChangeText={setUserListSearch} />
        {userListSearch.length > 0 && (
          <TouchableOpacity onPress={() => setUserListSearch('')}>
            <Ionicons name="close-circle" size={18} color="#aaa" />
          </TouchableOpacity>
        )}
      </View>
      {/* 曜日フィルター */}
      <View style={{ flexDirection:'row', gap:8, paddingHorizontal:12, marginBottom:10, flexWrap:'wrap' }}>
        {DOW.map(d => (
          <TouchableOpacity key={d} style={{ paddingHorizontal:14, paddingVertical:7, borderRadius:10, backgroundColor:userListFilterDow===d ? COLORS.primary : '#F5F5F5', borderWidth:1, borderColor:userListFilterDow===d ? COLORS.primary : '#DDD' }} onPress={() => setUserListFilterDow(userListFilterDow===d ? '' : d)}>
            <Text style={{ fontSize:13, fontWeight:'bold', color:userListFilterDow===d ? '#fff':'#555' }}>{d}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {/* 学校カード（アイコンなし・低め） */}
      <View style={styles.gridContainer}>
        {sortedSchoolNames.map((school, index) => {
          const isActive = activeSchool === school;
          const bgColor = BG_COLORS[index % BG_COLORS.length];
          return (
            <TouchableOpacity key={school} style={[styles.schoolCardList, { backgroundColor: bgColor }, isActive && styles.schoolCardActive]} onPress={() => setActiveSchool(isActive ? null : school)}>
              <Text style={[styles.schoolCardName, { textAlign:'center', fontSize:12 }]} numberOfLines={2}>{school}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* フィルター未設定時は何も表示しない */}
      {!hasFilter ? (
        <View style={{ alignItems:'center', marginTop:32 }}>
          <Ionicons name="search-outline" size={40} color="#DDD" />
          <Text style={{ color:'#BBB', marginTop:8, fontSize:13 }}>名前・曜日・学校で絞り込んでください</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ alignItems:'center', marginTop:32 }}>
          <Text style={{ color:'#BBB', fontSize:13 }}>該当する利用者はいません</Text>
        </View>
      ) : (
        <View style={styles.listSection}>
          {activeSchool && <Text style={styles.listSectionTitle}>【{activeSchool}】の利用者</Text>}
          {Object.entries(filteredBySchool).map(([school, users]) => (
            <View key={school}>
              {!activeSchool && <Text style={[styles.listSectionTitle, { fontSize:12 }]}>{school}</Text>}
              {sortKidsByGrade(users).map((user: any, idx: number) => (
                <View key={user.id} style={[styles.userListItem, idx === users.length - 1 && { borderBottomWidth: 0 }]}>
                  <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => router.push({ pathname: '/schedule', params: { name: user.name } } as any)}>
                    <View style={styles.userIconCircle}><Ionicons name="person" size={20} color={COLORS.primary} /></View>
                    <View style={styles.userInfo}>
                      <Text style={styles.userName}>{user.name} <Text style={styles.userGrade}>({user.grade || '学年未定'})</Text></Text>
                      {user.days && <Text style={{ fontSize:11, color:'#5B9BD5' }}>{DOW.filter(d => user.days[d]).join('・')}</Text>}
                    </View>
                    <View style={styles.editBadge}><Ionicons name="calendar-outline" size={14} color={COLORS.white} /><Text style={styles.editBadgeText}>編集</Text></View>
                  </TouchableOpacity>
                  {isAdmin && user.parentDocId && (
                    <TouchableOpacity style={styles.msgIconBtn} onPress={() => router.push({ pathname: '/messages', params: { conversationId: `direct_${user.parentDocId}`, conversationName: user.name } } as any)}>
                      <Ionicons name="chatbubble-ellipses-outline" size={20} color="#4682B4" />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
    );
  };

    const renderTransportView = () => {
    return (
      <View style={{ flex: 1 }}>
        <View style={styles.weekNav}>
          <TouchableOpacity style={styles.weekNavBtn} onPress={() => setTransportWeekOffset(w => w - 1)}>
            <Ionicons name="chevron-back" size={20} color={COLORS.primary} />
            <Text style={styles.weekNavText}>前の週</Text>
          </TouchableOpacity>
          <Text style={styles.weekNavTitle}>
            {transportWeekOffset === 0 ? '今週' : transportWeekOffset > 0 ? `${transportWeekOffset}週間後` : `${-transportWeekOffset}週間前`}
          </Text>
          <TouchableOpacity style={styles.weekNavBtn} onPress={() => setTransportWeekOffset(w => w + 1)}>
            <Text style={styles.weekNavText}>次の週</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
          {transportDates.map(({ date, dateStr }) => {
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
            const isToday = dateStr === todayStr;
            const shiftStaffList = assignedShifts[dateStr] || [];
            const att = getAttendanceForDay(date);
            const totalBlocks = Object.keys(att.schools).reduce((acc, s) => acc + Object.keys(att.schools[s]).length, 0)
              + Object.keys(att.lessons || {}).length;
            const savedData = pickupAssignments[dateStr];
            let assignedCount = 0;
            try {
              if (savedData?.entries) {
                const parsed = JSON.parse(savedData.entries);
                assignedCount = new Set((parsed.entries || []).flatMap((e: any) =>
                  (e.trips || []).flatMap((t: any) => (t.blockKeys || []).filter((k: string) => k !== 'other'))
                )).size;
              }
            } catch {}
            const isPH = !!publicHolidays[dateStr];
            const isSun = date.getDay() === 0, isSat = date.getDay() === 6;
            const bgColor = isToday ? '#FFF9E6' : (isPH||isSun) ? '#FFF0F0' : isSat ? '#F0F6FF' : COLORS.white;
            const dowColor = (isPH||isSun) ? '#CC0000' : isSat ? '#0055CC' : COLORS.text;

            return (
              <TouchableOpacity
                key={dateStr}
                style={[styles.transportDateCard, { backgroundColor: bgColor }, isToday && styles.transportDateCardToday]}
                onPress={() => { setSelectedTransportDate(dateStr); setTransportModalVisible(true); }}
                activeOpacity={0.8}
              >
                <View style={styles.transportDateCardLeft}>
                  <Text style={[styles.transportDateNum, { color: dowColor }]}>{date.getMonth()+1}/{date.getDate()}</Text>
                  <Text style={[styles.transportDow, { color: dowColor }]}>({DAY_NAMES[date.getDay()]})</Text>
                  {isToday && <View style={styles.todayBadge}><Text style={styles.todayBadgeText}>今日</Text></View>}
                </View>
                <View style={styles.transportDateCardRight}>
                  <Text style={styles.transportStaffCount}>出勤スタッフ: {shiftStaffList.length}名</Text>
                  {totalBlocks === 0 ? null : assignedCount >= totalBlocks
                    ? <Text style={styles.transportDoneText}>✅ 記入済み</Text>
                    : assignedCount > 0
                      ? <Text style={styles.transportProgressText}>{assignedCount}/{totalBlocks}件入力済み</Text>
                      : <Text style={styles.transportEmptyText}>未入力</Text>
                  }
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {selectedTransportDate && (
          <TransportModal
            dateStr={selectedTransportDate}
            visible={transportModalVisible}
            onClose={() => setTransportModalVisible(false)}
            attendance={getAttendanceForDay(new Date(selectedTransportDate + 'T00:00:00'))}
            shiftStaff={assignedShifts[selectedTransportDate] || []}
            allStaffList={allStaffList}
            assignments={pickupAssignments[selectedTransportDate] || {}}
            onAssign={savePickupAssignment}
            publicHolidays={publicHolidays}
          />
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {currentView === 'attendance' ? '出欠一覧' : currentView === 'schoolUsers' ? '利用者一覧' : '送迎一覧'}
        </Text>
      </View>

      <View style={styles.tabNavigation}>
        <TouchableOpacity style={[styles.tabNavBtn, currentView === 'attendance' && styles.tabNavBtnActive]} onPress={() => setCurrentView('attendance')}>
          <Text style={[styles.tabNavText, currentView === 'attendance' && styles.tabNavTextActive]}>出欠一覧</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabNavBtn, currentView === 'schoolUsers' && styles.tabNavBtnActive]} onPress={() => setCurrentView('schoolUsers')}>
          <Text style={[styles.tabNavText, currentView === 'schoolUsers' && styles.tabNavTextActive]}>利用者一覧</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabNavBtn, currentView === 'transport' && styles.tabNavBtnActive]} onPress={() => setCurrentView('transport')}>
          <Text style={[styles.tabNavText, currentView === 'transport' && styles.tabNavTextActive]}>送迎一覧</Text>
        </TouchableOpacity>
      </View>

      {currentView === 'attendance' && renderAttendanceView()}
      {currentView === 'schoolUsers' && renderSchoolUsersView()}
      {currentView === 'transport' && renderTransportView()}

      {currentView === 'attendance' && (
        <TouchableOpacity
          style={[styles.fab, showKidNames && styles.fabActive]}
          onPress={() => setShowKidNames(!showKidNames)}
          activeOpacity={0.85}
        >
          <Ionicons name={showKidNames ? "swap-vertical" : "swap-vertical"} size={22} color={COLORS.white} />
        </TouchableOpacity>
      )}

      <Modal visible={!!schoolModalData} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {schoolModalData && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalSubTitle}>{schoolModalData.date} の予定</Text>
                  <TouchableOpacity onPress={() => setSchoolModalData(null)}>
                    <Ionicons name="close-circle" size={28} color={COLORS.textLight} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.modalMainTitle}>{schoolModalData.title}</Text>
                <ScrollView style={styles.modalList}>
                  {schoolModalData.kids.map(kid => (
                    <View key={kid.id} style={styles.modalListItem}>
                      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => { setSchoolModalData(null); router.push({ pathname: '/schedule', params: { name: kid.name } } as any); }}>
                        <Ionicons name="person" size={16} color={COLORS.primary} />
                        <Text style={[styles.modalItemName, kid.isManualOverride && { color: COLORS.danger }, kid.hasMemo && { fontWeight: 'bold' }]}>{kid.hasMemo ? '📝' : ''}{kid.name}</Text>
                        <Text style={styles.modalItemSub}>{kid.grade}</Text>
                        <Ionicons name="chevron-forward" size={16} color={COLORS.textLight} style={{marginLeft: 8}} />
                      </TouchableOpacity>
                      {isAdmin && kid.parentDocId && (
                        <TouchableOpacity
                          style={styles.msgIconBtn}
                          onPress={() => { setSchoolModalData(null); router.push({ pathname: '/messages', params: { conversationId: `direct_${kid.parentDocId}`, conversationName: kid.name } } as any); }}
                        >
                          <Ionicons name="chatbubble-ellipses-outline" size={20} color="#4682B4" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!timeModalData} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {timeModalData && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalSubTitle}>{timeModalData.title}</Text>
                  <TouchableOpacity onPress={() => setTimeModalData(null)}>
                    <Ionicons name="close-circle" size={28} color={COLORS.textLight} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.modalMainTitle}>{timeModalData.subtitle}</Text>
                <ScrollView style={styles.modalList}>
                  {timeModalData.kids.map(kid => (
                    <View key={kid.id} style={styles.modalListItem}>
                      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => { setTimeModalData(null); router.push({ pathname: '/schedule', params: { name: kid.name } } as any); }}>
                        <Ionicons name="time" size={16} color={COLORS.info} />
                        <Text style={[styles.modalItemName, kid.isManualOverride && { color: COLORS.danger }, kid.hasMemo && { fontWeight: 'bold' }]}>{kid.hasMemo ? '📝' : ''}{kid.name}</Text>
                        <Text style={styles.modalItemSub}>{kid.grade}</Text>
                        <Ionicons name="chevron-forward" size={16} color={COLORS.textLight} style={{marginLeft: 8}} />
                      </TouchableOpacity>
                      {isAdmin && kid.parentDocId && (
                        <TouchableOpacity
                          style={styles.msgIconBtn}
                          onPress={() => { setTimeModalData(null); router.push({ pathname: '/messages', params: { conversationId: `direct_${kid.parentDocId}`, conversationName: kid.name } } as any); }}
                        >
                          <Ionicons name="chatbubble-ellipses-outline" size={20} color="#4682B4" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </ScrollView>
              </>
            )}
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
  
  tabNavigation: { flexDirection: 'row', backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border },
  tabNavBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderColor: 'transparent' },
  tabNavBtnActive: { borderColor: COLORS.primary },
  tabNavText: { fontSize: 13, fontWeight: 'bold', color: COLORS.textLight },
  tabNavTextActive: { fontSize: 13, fontWeight: 'bold', color: COLORS.primary },

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
  dayHeaderContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 16, marginTop: 8, flexWrap: 'wrap', backgroundColor: '#F8F9FA', paddingVertical: 6, paddingHorizontal: 8 },
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
  timeButtonExpanded: { flexDirection: 'column', alignItems: 'flex-start', paddingVertical: 10, paddingHorizontal: 8 },
  timeButtonText: { fontSize: 12, fontWeight: 'bold', color: COLORS.text },
  timeCountText: { fontSize: 12, fontWeight: 'bold', color: COLORS.primary },
  timeHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 6 },
  timeLabel: { fontSize: 11, fontWeight: 'bold', color: COLORS.textLight },
  timeCountBadge: { fontSize: 10, fontWeight: 'bold', color: COLORS.primary, backgroundColor: COLORS.primary + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  kidNamesContainer: { gap: 3, width: '100%' },
  kidNameText: { fontSize: 11, fontWeight: '600', color: COLORS.text, flex: 1 },
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

  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  instruction: { padding: 16, color: COLORS.textLight, fontWeight: 'bold', textAlign: 'center', marginTop: 8 },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, paddingBottom: 12 },
  schoolCardList: { width: '46%', margin: '2%', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, elevation: 2, borderWidth: 2, borderColor: 'transparent' },
  schoolCardActive: { borderColor: COLORS.primary },
  schoolCardName: { fontSize: 11, fontWeight: 'bold', color: COLORS.text, textAlign: 'center' },
  listSection: { backgroundColor: COLORS.white, borderTopWidth: 1, borderColor: COLORS.border, padding: 16, minHeight: 400 },
  listSectionTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.primary, marginBottom: 16, textAlign: 'center' },
  userListItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: COLORS.border },
  userIconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0F8FF', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  userGrade: { fontSize: 14, color: COLORS.textLight, fontWeight: 'normal' },
  userKana: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  editBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  msgIconBtn: { padding: 10, marginLeft: 4 },
  editBadgeText: { color: COLORS.white, fontSize: 12, fontWeight: 'bold', marginLeft: 4 },
  weekNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border },
  weekNavBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  weekNavText: { fontSize: 13, color: COLORS.primary, fontWeight: 'bold' },
  weekNavTitle: { fontSize: 15, fontWeight: 'bold', color: COLORS.text },
  transportDateCard: { borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  transportDateCardToday: { borderColor: COLORS.primary, borderWidth: 2 },
  transportDateCardLeft: { alignItems: 'center', marginRight: 16, minWidth: 56 },
  transportDateCardRight: { flex: 1 },
  transportDateNum: { fontSize: 22, fontWeight: 'bold' },
  transportDow: { fontSize: 13, fontWeight: 'bold' },
  transportStaffCount: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  transportDoneText: { fontSize: 12, color: '#4CAF50', fontWeight: 'bold', marginTop: 2 },
  transportProgressText: { fontSize: 12, color: '#FF9800', fontWeight: 'bold', marginTop: 2 },
  transportEmptyText: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  todayBadge: { marginTop: 4, backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  todayBadgeText: { fontSize: 10, color: COLORS.white, fontWeight: 'bold' },
  fab: { position: 'absolute', bottom: 28, right: 20, width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 8, zIndex: 100 },
  fabActive: { backgroundColor: COLORS.danger },
});