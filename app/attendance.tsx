import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, useWindowDimensions, View } from 'react-native';
import AdminBottomNav, { ADMIN_BOTTOM_NAV_HEIGHT } from '../components/AdminBottomNav';
import SwipeTabPager from '../components/SwipeTabPager';
import TransportModal from '../components/TransportModal';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { navigateHome } from '../utils/navigationHome';

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

type ViewMode = 'attendance' | 'todayStatus' | 'schoolUsers' | 'transport';

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const PASTEL_COLORS = ['#EAF8F1', '#FCE4EC', '#F0EEFF', '#FFF3EA', '#EDF6FF', '#F2F8E8'];
const SCHOOL_GRADIENT_COLORS = [
  '#F7C8CC',
  '#F9DFC0',
  '#FFF1C6',
  '#D9EED1',
  '#D6E5E8',
  '#C7DCF7',
  '#CFE3F1',
  '#D8D1E8',
  '#E8C7D8',
];
const SCHOOL_ACCENT_COLORS = ['#E97884', '#E99B48', '#E1B62A', '#6DBA59', '#65AAB6', '#5D96DC', '#4DA5B9', '#7E69B8', '#C16293'];

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
  const { width: screenWidth } = useWindowDimensions();
  const { dateStr: initialTransportDate, view: initialView } = useLocalSearchParams<{ dateStr?: string; view?: string }>();
  
  const [currentView, setCurrentView] = useState<ViewMode>('attendance');
  const [userListSearch, setUserListSearch] = useState('');
  const [userListFilterDows, setUserListFilterDows] = useState<string[]>([]);
  const [pickupAssignments, setPickupAssignments] = useState<Record<string, any>>({});
  const [allStaffList, setAllStaffList] = useState<string[]>([]);
  const [transportCalendarMonth, setTransportCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedTransportDate, setSelectedTransportDate] = useState<string | null>(null);
  const [transportModalVisible, setTransportModalVisible] = useState(false);
  const initialTransportOpenedRef = useRef(false);
  const [showKidNames, setShowKidNames] = useState(true);

  const [isAdmin, setIsAdmin] = useState(false);
  const [kids, setKids] = useState<Kid[]>([]);
  const [masterSchools, setMasterSchools] = useState<string[]>([]);
  
  const [pastWeeks, setPastWeeks] = useState(2);
  const [futureWeeks, setFutureWeeks] = useState(1); 
  
  const scrollViewRef = useRef<ScrollView>(null);
  const attendanceTodayPositionedRef = useRef(false);
  const attendanceAutoPositioningRef = useRef(false);
  const [attendanceResetToken, setAttendanceResetToken] = useState(0);
  const [attendanceViewReady, setAttendanceViewReady] = useState(false);
  const attendanceScrollYRef = useRef(0);
  const attendanceContentHeightRef = useRef(0);
  const pendingHistoryPrependRef = useRef<{ height: number; scrollY: number } | null>(null);
  const pendingFutureAppendRef = useRef(false);
  const [attendanceTodayY, setAttendanceTodayY] = useState<number | null>(null);

  const [schoolModalData, setSchoolModalData] = useState<{ date: string, title: string, kids: Kid[] } | null>(null);
  const [timeModalData, setTimeModalData] = useState<{ date: string, title: string, subtitle: string, kids: Kid[] } | null>(null);

  useEffect(() => {
    if (
      initialView === 'attendance' ||
      initialView === 'todayStatus' ||
      initialView === 'schoolUsers' ||
      initialView === 'transport'
    ) {
      setCurrentView(initialView);
    }
  }, [initialView]);

  useEffect(() => {
    if (!initialTransportDate || initialTransportOpenedRef.current) return;
    const target = String(initialTransportDate);
    const parsed = new Date(`${target}T00:00:00`);
    if (isNaN(parsed.getTime())) return;
    initialTransportOpenedRef.current = true;
    const targetOnly = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    setTransportCalendarMonth(new Date(targetOnly.getFullYear(), targetOnly.getMonth(), 1));
    setCurrentView('transport');
    setSelectedTransportDate(target);
    setTimeout(() => setTransportModalVisible(true), 250);
  }, [initialTransportDate]);

  const [scheduleOverrides, setScheduleOverrides] = useState<Record<string, any>>({});
  const [scheduleMemoData, setScheduleMemoData] = useState<Record<string, string>>({});
  const [schoolTimesData, setSchoolTimesData] = useState<Record<string, any>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, any[]>>({});
  const [lessonsData, setLessonsData] = useState<any[]>([]);
  const [holidays, setHolidays] = useState<any[]>([]); 
  const [eventsData, setEventsData] = useState<Record<string, string>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});

  const [activeSchools, setActiveSchools] = useState<string[]>([]);
  const [todayEntries, setTodayEntries] = useState<Record<string, boolean>>({});
  const [statusDate, setStatusDate] = useState(() => new Date());
  const [statusDatePicker, setStatusDatePicker] = useState<'month' | 'day' | null>(null);

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

  useEffect(() => {
    // 選択日の入室ログを取得
    const dateStr = `${statusDate.getFullYear()}-${String(statusDate.getMonth()+1).padStart(2,'0')}-${String(statusDate.getDate()).padStart(2,'0')}`;
    const unsub = onSnapshot(
      query(collection(db, 'entry_logs'), where('dateStr', '==', dateStr)),
      (snap) => {
        const entries: Record<string, boolean> = {};
        snap.forEach(d => {
          entries[d.data().accountId] = true;
        });
        setTodayEntries(entries);
      }
    );
    return () => unsub();
  }, [statusDate]);

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

  const changeAttendanceView = useCallback((nextView: ViewMode) => {
    if (nextView === 'attendance' && currentView !== 'attendance') {
      attendanceTodayPositionedRef.current = false;
      setAttendanceViewReady(false);
      setPastWeeks(2);
      setFutureWeeks(1);
      pendingHistoryPrependRef.current = null;
      pendingFutureAppendRef.current = false;
      setAttendanceTodayY(null);
      setAttendanceResetToken(current => current + 1);
    }
    setCurrentView(nextView);
  }, [currentView]);

  useEffect(() => {
    if (currentView !== 'attendance') {
      attendanceAutoPositioningRef.current = false;
      setAttendanceViewReady(false);
      return;
    }
    if (attendanceTodayPositionedRef.current) return;
    if (Platform.OS !== 'web' && attendanceTodayY === null) return;
    attendanceAutoPositioningRef.current = true;

    const scrollToToday = () => {
      if (Platform.OS === 'web') {
        const todayElements = Array.from(document.querySelectorAll<HTMLElement>(
          `#attendance-day-${getDateLayoutKey(new Date())}`,
        ));
        const todayElement = todayElements.find(element => element.offsetHeight > 0);
        if (!todayElement) return;
        todayElement.scrollIntoView({ block: 'start', behavior: 'auto' });
        attendanceTodayPositionedRef.current = true;
        requestAnimationFrame(() => setAttendanceViewReady(true));
        return;
      }
      if (attendanceTodayY === null) return;
      scrollViewRef.current?.scrollTo({ y: Math.max(0, (attendanceTodayY ?? 0) - 8), animated: false });
      attendanceTodayPositionedRef.current = true;
      requestAnimationFrame(() => setAttendanceViewReady(true));
    };
    const firstFrame = requestAnimationFrame(scrollToToday);
    const afterPagerSettles = setTimeout(scrollToToday, 180);
    const revealFallback = setTimeout(() => setAttendanceViewReady(true), 500);
    const finishPositioning = setTimeout(() => {
      attendanceAutoPositioningRef.current = false;
    }, 420);
    return () => {
      cancelAnimationFrame(firstFrame);
      clearTimeout(afterPagerSettles);
      clearTimeout(revealFallback);
      clearTimeout(finishPositioning);
    };
  }, [attendanceResetToken, currentView, attendanceTodayY]);

  const handleAttendanceScroll = (event: any) => {
    const scrollY = event.nativeEvent.contentOffset.y;
    const viewportHeight = event.nativeEvent.layoutMeasurement.height;
    const contentHeight = event.nativeEvent.contentSize.height;
    attendanceScrollYRef.current = scrollY;
    if (
      scrollY <= 48 &&
      attendanceTodayPositionedRef.current &&
      !attendanceAutoPositioningRef.current &&
      !pendingHistoryPrependRef.current
    ) {
      pendingHistoryPrependRef.current = {
        height: attendanceContentHeightRef.current,
        scrollY,
      };
      setPastWeeks(current => current + 4);
    }
    if (
      contentHeight - (scrollY + viewportHeight) <= 120 &&
      attendanceTodayPositionedRef.current &&
      !pendingFutureAppendRef.current
    ) {
      pendingFutureAppendRef.current = true;
      setFutureWeeks(current => current + 4);
    }
  };

  const handleAttendanceContentSizeChange = (_width: number, height: number) => {
    const previousHeight = attendanceContentHeightRef.current;
    const pending = pendingHistoryPrependRef.current;
    attendanceContentHeightRef.current = height;
    if (pendingFutureAppendRef.current && height > previousHeight) {
      pendingFutureAppendRef.current = false;
    }
    if (!pending || height <= pending.height) return;
    pendingHistoryPrependRef.current = null;
    const nextY = pending.scrollY + (height - pending.height);
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({ y: nextY, animated: false });
    });
  };

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
    const orderedIndex = sortedSchoolNames.indexOf(str);
    if (orderedIndex >= 0) {
      const ratio = sortedSchoolNames.length <= 1 ? 0 : orderedIndex / (sortedSchoolNames.length - 1);
      const colorIndex = Math.round(ratio * (SCHOOL_GRADIENT_COLORS.length - 1));
      return SCHOOL_GRADIENT_COLORS[colorIndex];
    }
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return SCHOOL_GRADIENT_COLORS[Math.abs(hash) % SCHOOL_GRADIENT_COLORS.length];
  };

  const getCardAccentColor = (str: string) => {
    const orderedIndex = sortedSchoolNames.indexOf(str);
    if (orderedIndex >= 0) {
      const ratio = sortedSchoolNames.length <= 1 ? 0 : orderedIndex / (sortedSchoolNames.length - 1);
      const colorIndex = Math.round(ratio * (SCHOOL_ACCENT_COLORS.length - 1));
      return SCHOOL_ACCENT_COLORS[colorIndex];
    }
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return SCHOOL_ACCENT_COLORS[Math.abs(hash) % SCHOOL_ACCENT_COLORS.length];
  };

  const getDateLayoutKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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
      <ScrollView
        ref={scrollViewRef}
        style={[styles.mainScroll, !attendanceViewReady && styles.attendanceViewPositioning]}
        contentContainerStyle={{ paddingBottom: 100 }}
        onScroll={handleAttendanceScroll}
        onContentSizeChange={handleAttendanceContentSizeChange}
        scrollEventThrottle={32}
      >
        {datesToDisplay.map((date, index) => {
          const m = date.getMonth() + 1;
          const day = date.getDate();
          const dayOfWeek = date.getDay();
          const dayStr = DAY_NAMES[dayOfWeek];
          const dateKey = getDateLayoutKey(date);
          const dateLabel = `${m}/${day}`;
          
          const year = date.getFullYear();
          const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          
          const isPublicHoliday = !!publicHolidays[dateStr];
          const eventTitle = eventsData[dateStr];
          
          const isSaturday = dayOfWeek === 6;
          const isSunday = dayOfWeek === 0;
          const isToday = dateKey === getDateLayoutKey(new Date());
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

          const LESSON2_NAMES = ['スイミング', 'プログラミング', 'ダンス'];
          const lesson1Entries = Object.entries(attendanceData.lessons)
            .filter(([key]) => !LESSON2_NAMES.some(name => key.includes(name)))
            .sort(([a], [b]) => a.localeCompare(b));
          const lesson2Entries = Object.entries(attendanceData.lessons)
            .filter(([key]) => LESSON2_NAMES.some(name => key.includes(name)))
            .sort(([a], [b]) => a.localeCompare(b));
          const cardModels = sortedAttendanceSchools.map(([schoolName, timesMap]) => ({
            key: schoolName,
            title: schoolName,
            backgroundColor: getCardColor(schoolName),
            accentColor: getCardAccentColor(schoolName),
            type: 'school' as 'school' | 'lesson',
            entries: Object.entries(timesMap).sort(([a], [b]) => a.localeCompare(b)).map(([time, entryKids]) => ({
              key: time,
              time,
              name: '',
              kids: entryKids,
            })),
          }));
          if (lesson1Entries.length > 0) {
            cardModels.push({
              key: 'lesson-1',
              title: '習い事',
              backgroundColor: '#EAF8F1',
              accentColor: '#49B887',
              type: 'lesson',
              entries: lesson1Entries.map(([lessonKey, entryKids]) => {
                const spaceIndex = lessonKey.indexOf(' ');
                return {
                  key: lessonKey,
                  time: spaceIndex >= 0 ? lessonKey.substring(0, spaceIndex) : '',
                  name: spaceIndex >= 0 ? lessonKey.substring(spaceIndex + 1) : lessonKey,
                  kids: entryKids,
                };
              }),
            });
          }
          if (lesson2Entries.length > 0) {
            cardModels.push({
              key: 'lesson-2',
              title: '習い事2',
              backgroundColor: '#F3E5F5',
              accentColor: '#9A67B0',
              type: 'lesson',
              entries: lesson2Entries.map(([lessonKey, entryKids]) => {
                const spaceIndex = lessonKey.indexOf(' ');
                return {
                  key: lessonKey,
                  time: spaceIndex >= 0 ? lessonKey.substring(0, spaceIndex) : '',
                  name: spaceIndex >= 0 ? lessonKey.substring(spaceIndex + 1) : lessonKey,
                  kids: entryKids,
                };
              }),
            });
          }
          const attendanceColumnCount = screenWidth <= 600 ? 2 : screenWidth < 1000 ? 3 : 4;
          const attendanceColumns = Array.from({ length: attendanceColumnCount }, () => [] as typeof cardModels);
          cardModels.forEach((card, cardIndex) => attendanceColumns[cardIndex % attendanceColumnCount].push(card));

          return (
            <View 
              key={dateKey} 
              nativeID={`attendance-day-${dateKey}`}
              style={[styles.daySection, isToday && styles.daySectionToday]}
              onLayout={(e) => { 
                if (isToday) setAttendanceTodayY(e.nativeEvent.layout.y);
              }}
            >
              <View style={[styles.dayHeaderContainer, Platform.OS === 'web' && ({ position: 'sticky', top: 0, zIndex: 10 } as any)]}>
                {isToday && <View style={styles.attendanceTodayBadge}><Text style={styles.attendanceTodayBadgeText}>今日</Text></View>}
                <Text style={[styles.dayHeaderText, headerColorStyle]}>{m}月{day}日 ({dayStr})</Text>
                {isPublicHoliday && <Text style={{ color: 'red', marginLeft: 8, fontSize: 12, fontWeight: 'bold' }}>{publicHolidays[dateStr]}</Text>}
                {eventTitle && <View style={styles.eventBadgeLarge}><Text style={styles.eventBadgeTextLarge}>{eventTitle}</Text></View>}
                <View style={styles.totalBadge}><Text style={styles.totalBadgeText}>合計: {attendanceData.totalCount}名</Text></View>
              </View>

              {attendanceData.totalCount > 0 || hasLessons ? (
                <View style={styles.schoolsGrid}>
                  {attendanceColumns.map((column, columnIndex) => (
                    <View key={`attendance-column-${columnIndex}`} style={styles.attendanceSchoolColumn}>
                      {column.map(card => {
                        const allKids = card.entries.flatMap(entry => entry.kids);
                        return (
                          <View key={card.key} style={[styles.schoolCard, styles.schoolCardFluid]}>
                            <TouchableOpacity style={[styles.schoolNameBtn, { backgroundColor: card.backgroundColor }]} onPress={() => setSchoolModalData({ date: dateLabel, title: card.title, kids: sortKidsByGrade(allKids) })}>
                              <View style={[styles.schoolAccentLine, { backgroundColor: card.accentColor }]} />
                              <Text style={styles.schoolNameText} numberOfLines={2} adjustsFontSizeToFit>{card.title}</Text>
                            </TouchableOpacity>
                            <View style={styles.timeGroupContainer}>
                              {card.entries.map((entry, entryIndex) => {
                                const hasManualOverride = entry.kids.some(kid => kid.isManualOverride);
                                const hasAnyMemo = entry.kids.some(kid => kid.hasMemo);
                                const subtitle = card.type === 'school' ? `${entry.time} 下校` : entry.key;
                                return (
                                  <TouchableOpacity key={entry.key} style={[styles.timeButton, entryIndex === card.entries.length - 1 && styles.timeButtonLast, showKidNames && styles.timeButtonExpanded]} onPress={() => setTimeModalData({ date: dateLabel, title: card.title, subtitle, kids: sortKidsByGrade(entry.kids) })}>
                                    {showKidNames ? (
                                      <>
                                        <View style={styles.timeHeaderRow}>
                                          <View style={styles.timeTitleGroup}>
                                            <Text style={[styles.timeLabel, hasManualOverride && { color: COLORS.danger }]}>{entry.time}{hasAnyMemo ? ' 📝' : ''}</Text>
                                            {!!entry.name && <Text style={styles.lessonNameText} numberOfLines={1}>{entry.name}</Text>}
                                          </View>
                                          <Text style={styles.timeCountBadge}>{entry.kids.length}名</Text>
                                        </View>
                                        <View style={styles.kidNamesContainer}>
                                          {sortKidsByGrade(entry.kids).map(kid => (
                                            <Text key={kid.id} style={[styles.kidNameText, kid.isManualOverride && { color: COLORS.danger }, kid.hasMemo && { fontWeight: 'bold' }]} numberOfLines={1}>{kid.hasMemo ? '📝' : ''}{kid.name}{kid.grade ? `（${kid.grade}）` : ''}</Text>
                                          ))}
                                        </View>
                                      </>
                                    ) : (
                                      <>
                                        <View style={styles.compactTimeTextGroup}>
                                          <Text style={[styles.timeButtonText, hasManualOverride && { color: COLORS.danger }]} numberOfLines={1}>{entry.time}{hasAnyMemo ? ' 📝' : ''}</Text>
                                          {!!entry.name && <Text style={styles.compactLessonNameText} numberOfLines={1}>{entry.name}</Text>}
                                        </View>
                                        <Text style={styles.timeCountText}>{entry.kids.length}名</Text>
                                      </>
                                    )}
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.noDataBox}><Text style={styles.noDataText}>利用予定の児童はいません</Text></View>
              )}
            </View>
          );
        })}

      </ScrollView>
    </>
  );

  const renderTodayStatusView = () => {
    const selectedDate = statusDate;
    const attendanceData = getAttendanceForDay(selectedDate);
    const selectedMonthDays = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
    const schoolChildColumns = screenWidth >= 1400 ? 4 : screenWidth >= 800 ? 3 : 2;
    const statusCardWidth = `${(100 / schoolChildColumns) - 1.2}%` as any;
    
    const expectedKids: Kid[] = [];
    const addedIds = new Set<string>();
    
    // 選択日の利用予定の子を全員取得
    Object.values(attendanceData.schools).forEach(timeMap => {
      Object.values(timeMap).forEach(kids => {
        kids.forEach(k => {
          if (!addedIds.has(k.id)) {
            expectedKids.push(k);
            addedIds.add(k.id);
          }
        });
      });
    });
    Object.values(attendanceData.lessons).forEach(kids => {
      kids.forEach(k => {
        if (!addedIds.has(k.id)) {
          expectedKids.push(k);
          addedIds.add(k.id);
        }
      });
    });

    expectedKids.sort((a, b) => getGradeValue(a.grade) - getGradeValue(b.grade) || a.name.localeCompare(b.name, 'ja'));

    const arrivedKids = expectedKids.filter(k => todayEntries[k.parentDocId || k.id] || todayEntries[k.id]);
    const notArrivedKids = expectedKids.filter(k => !(todayEntries[k.parentDocId || k.id] || todayEntries[k.id]));

    const renderGroupedKids = (kidsList: Kid[]) => {
      if (kidsList.length === 0) {
        return <View style={styles.noDataBox}><Text style={styles.noDataText}>本日の利用予定はありません</Text></View>;
      }

      // 学校別にグループ化
      const grouped: Record<string, Kid[]> = {};
      kidsList.forEach(k => {
        const s = k.school || '未設定';
        if (!grouped[s]) grouped[s] = [];
        grouped[s].push(k);
      });

      // 学校をソート
      const sortedSchools = Object.keys(grouped).sort((a, b) => {
        const idxA = sortedSchoolNames.indexOf(a);
        const idxB = sortedSchoolNames.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
      });

      const renderSchoolGroup = (school: string) => {
        const schoolKids = grouped[school];
        const bgColor = getCardColor(school);
        return (
          <View key={school} style={{ backgroundColor: '#FAFBFB', borderRadius: 10, padding: 6, borderWidth: 1, borderColor: '#E4E8E8', borderTopWidth: 4, borderTopColor: bgColor }}>
            <Text style={{ fontSize: 11, fontWeight: '900', color: '#222222', marginBottom: 4 }}>{school}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', gap: 4 }}>
              {schoolKids.map(k => {
                const isArrived = !!(todayEntries[k.parentDocId || k.id] || todayEntries[k.id]);
                return (
                  <View key={k.id} style={{ 
                    backgroundColor: isArrived ? '#EAF8EF' : '#FFF0F0', 
                    paddingHorizontal: 7, 
                    paddingVertical: 5, 
                    borderRadius: 8, 
                    borderWidth: 1,
                    borderColor: isArrived ? '#9AD4AA' : '#F1AAAA',
                    width: statusCardWidth,
                    minHeight: 42,
                    justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: '#222222' }} numberOfLines={1}>{k.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2, gap: 4 }}>
                      <Text style={{ fontSize: 8, color: '#555555', fontWeight: '700' }} numberOfLines={1}>{k.grade || '学年未設定'}</Text>
                      <Text style={{ fontSize: 8, color: isArrived ? '#247A43' : '#C33E3E', fontWeight: '900' }} numberOfLines={1}>
                        {isArrived ? '登所済み' : '未登所'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        );
      };

      return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <View style={{ flex: 1, gap: 6 }}>
            {sortedSchools.filter((_, index) => index % 2 === 0).map(renderSchoolGroup)}
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            {sortedSchools.filter((_, index) => index % 2 === 1).map(renderSchoolGroup)}
          </View>
        </View>
      );
    };

    return (
      <View style={{ flex: 1 }}>
      <ScrollView style={styles.mainScroll}>
        <View style={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: ADMIN_BOTTOM_NAV_HEIGHT + 12 }}>
          <View style={styles.statusDateNavigator}>
            <TouchableOpacity style={styles.statusDateArrow} onPress={() => setStatusDate(current => {
              const next = new Date(current); next.setDate(current.getDate() - 1); return next;
            })}>
              <Ionicons name="chevron-back" size={22} color="#5D4037" />
            </TouchableOpacity>
            <View style={styles.statusDateSelectors}>
              <TouchableOpacity style={styles.statusDateSelectButton} onPress={() => setStatusDatePicker('month')}>
                <Text style={styles.statusDateSelectText}>{selectedDate.getFullYear()}年 {selectedDate.getMonth() + 1}月</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.statusDateSelectButton} onPress={() => setStatusDatePicker('day')}>
                <Text style={styles.statusDateSelectText}>{selectedDate.getDate()}日（{DAY_NAMES[selectedDate.getDay()]}）</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.statusDateArrow} onPress={() => setStatusDate(current => {
              const next = new Date(current); next.setDate(current.getDate() + 1); return next;
            })}>
              <Ionicons name="chevron-forward" size={22} color="#5D4037" />
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
            <Text style={{ fontSize: 17, fontWeight: '900', color: '#222222' }}>
              {selectedDate.getMonth()+1}月{selectedDate.getDate()}日の出席記録
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, backgroundColor: '#FFF0F0', borderWidth: 1, borderColor: '#F1AAAA' }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: '#C33E3E' }}>未登所 {notArrivedKids.length}名</Text>
              </View>
              <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, backgroundColor: '#EAF8EF', borderWidth: 1, borderColor: '#9AD4AA' }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: '#247A43' }}>登所済み {arrivedKids.length}名</Text>
              </View>
            </View>
          </View>
          
          <View style={{ marginBottom: 12 }}>
            {renderGroupedKids(expectedKids)}
          </View>

        </View>
      </ScrollView>
      <Modal visible={statusDatePicker !== null} transparent animationType="fade" onRequestClose={() => setStatusDatePicker(null)}>
        <TouchableWithoutFeedback onPress={() => setStatusDatePicker(null)}>
          <View style={styles.statusPickerOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.statusPickerCard}>
                <View style={styles.statusPickerHeader}>
                  <Text style={styles.statusPickerTitle}>
                    {statusDatePicker === 'month' ? `${selectedDate.getFullYear()}年の月を選択` : `${selectedDate.getMonth() + 1}月の日付を選択`}
                  </Text>
                  <TouchableOpacity style={styles.statusPickerClose} onPress={() => setStatusDatePicker(null)}>
                    <Ionicons name="close" size={25} color="#433B36" />
                  </TouchableOpacity>
                </View>
                <View style={styles.statusPickerGrid}>
                  {(statusDatePicker === 'month'
                    ? Array.from({ length: 12 }, (_, index) => index + 1)
                    : Array.from({ length: selectedMonthDays }, (_, index) => index + 1)
                  ).map(value => {
                    const selected = statusDatePicker === 'month'
                      ? value === selectedDate.getMonth() + 1
                      : value === selectedDate.getDate();
                    const candidateDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), value);
                    return (
                      <TouchableOpacity
                        key={value}
                        style={[styles.statusPickerOption, selected && styles.statusPickerOptionSelected]}
                        onPress={() => {
                          if (statusDatePicker === 'month') {
                            const monthIndex = value - 1;
                            const maxDay = new Date(selectedDate.getFullYear(), monthIndex + 1, 0).getDate();
                            setStatusDate(new Date(selectedDate.getFullYear(), monthIndex, Math.min(selectedDate.getDate(), maxDay)));
                          } else {
                            setStatusDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), value));
                          }
                          setStatusDatePicker(null);
                        }}
                      >
                        <Text style={[styles.statusPickerOptionText, selected && styles.statusPickerOptionTextSelected]}>
                          {statusDatePicker === 'month' ? `${value}月` : `${value}日（${DAY_NAMES[candidateDate.getDay()]}）`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
      </View>
    );
  };

  const renderSchoolUsersView = () => {
    const DOW = ['月','火','水','木','金'];
    const allUsers = Object.values(groupedUsersBySchool).flat();
    const hasFilter = !!(userListSearch || userListFilterDows.length > 0 || activeSchools.length > 0);

    const matchingUsers = allUsers.filter((u: any) => {
      if (userListSearch) {
        const q = userListSearch.toLowerCase();
        if (!u.name?.toLowerCase().includes(q) && !u.nicknameKana?.toLowerCase().includes(q)) return false;
      }
      if (userListFilterDows.length > 0 && !userListFilterDows.some(day => u.days?.[day])) return false;
      return true;
    });
    const filtered = matchingUsers.filter((u: any) => activeSchools.length === 0 || activeSchools.includes(u.school));

    const filteredBySchool: Record<string, any[]> = {};
    filtered.forEach((u: any) => {
      const s = u.school || '未設定';
      if (!filteredBySchool[s]) filteredBySchool[s] = [];
      filteredBySchool[s].push(u);
    });

    const renderSchoolUsers = (school: string, compact = false, splitIntoTwoColumns = false, startFromRight = false) => {
      const schoolUsers = sortKidsByGrade(filteredBySchool[school] || []);
      const renderUserRows = (users: any[]) => users.map((user: any, idx: number) => (
        <View key={user.id} style={[styles.userListItem, styles.schoolInlineUserItem, splitIntoTwoColumns && styles.schoolInlineUserItemSplit, idx === users.length - 1 && !splitIntoTwoColumns && { borderBottomWidth: 0 }]}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => router.push({ pathname: '/schedule', params: { name: user.name, backTo: 'previous' } } as any)}>
            <View style={styles.userInfo}>
              <Text style={styles.userName}>{user.name} <Text style={styles.userGrade}>({user.grade || '学年未定'})</Text></Text>
              {user.days && <Text style={{ fontSize:11, color:'#5B9BD5' }}>{DOW.filter(d => user.days[d]).join('・')}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={18} color="#8A9294" />
          </TouchableOpacity>
          {isAdmin && user.parentDocId && (
            <TouchableOpacity style={styles.msgIconBtn} onPress={() => router.push({ pathname: '/messages', params: { conversationId: `direct_${user.parentDocId}`, conversationName: user.name } } as any)}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color="#4682B4" />
            </TouchableOpacity>
          )}
        </View>
      ));
      return (
        <View style={[styles.schoolInlineResults, compact && styles.schoolInlineResultsCompact, splitIntoTwoColumns && styles.schoolInlineResultsSplit]}>
          {schoolUsers.length === 0 ? (
            <Text style={styles.schoolInlineEmpty}>該当する利用者はいません</Text>
          ) : splitIntoTwoColumns ? (
            <View style={styles.schoolUsersTwoColumns}>
              <View style={styles.schoolUsersColumn}>{renderUserRows(schoolUsers.filter((_, index) => index % 2 === (startFromRight ? 1 : 0)))}</View>
              <View style={styles.schoolUsersColumn}>{renderUserRows(schoolUsers.filter((_, index) => index % 2 === (startFromRight ? 0 : 1)))}</View>
            </View>
          ) : renderUserRows(schoolUsers)}
        </View>
      );
    };

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
      <View style={styles.userFilterSection}>
        <Text style={styles.userFilterLabel}>曜日で絞り込む</Text>
        <View style={styles.userDowSegment}>
          {DOW.map(d => {
            const isSelected = userListFilterDows.includes(d);
            return (
              <TouchableOpacity key={d} style={[styles.userDowOption, isSelected && styles.userDowOptionActive]} onPress={() => setUserListFilterDows(current => current.includes(d) ? current.filter(day => day !== d) : [...current, d])}>
                <Text style={[styles.userDowText, isSelected && styles.userDowTextActive]}>{d}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      <View style={styles.schoolSearchHeading}>
        <View style={styles.schoolSearchTitleGroup}>
          <Ionicons name="business-outline" size={20} color="#008E96" />
          <Text style={styles.schoolSearchTitle}>学校から探す</Text>
        </View>
        <Text style={styles.schoolSearchCount}>{sortedSchoolNames.length}校</Text>
      </View>
      {/* 学校カード */}
      <View style={styles.gridContainer}>
        {Array.from({ length: Math.ceil(sortedSchoolNames.length / 2) }, (_, rowIndex) => {
          const pair = sortedSchoolNames.slice(rowIndex * 2, rowIndex * 2 + 2);
          const activePair = pair.filter(school => activeSchools.includes(school));
          return (
            <View key={`school-row-${rowIndex}`} style={styles.schoolAccordionRow}>
              <View style={styles.schoolAccordionHeaderRow}>
                {pair.map((school, pairIndex) => {
                  const isActive = activeSchools.includes(school);
                  const schoolUsersCount = matchingUsers.filter((user: any) => user.school === school).length;
                  const schoolBackground = getCardColor(school);
                  const schoolAccent = getCardAccentColor(school);
                  return (
                    <TouchableOpacity
                      key={school}
                      style={[styles.schoolAccordionHeader, isActive && styles.schoolCardActive]}
                      onPress={() => setActiveSchools(current =>
                        isActive ? current.filter(item => item !== school) : [...current, school]
                      )}
                    >
                      <View style={[styles.schoolCardAccent, { backgroundColor: schoolAccent }]} />
                      <View style={[styles.schoolIconCircle, { backgroundColor: schoolBackground }]}>
                        <Ionicons name="business-outline" size={18} color={schoolAccent} />
                      </View>
                      <View style={styles.schoolCardTextGroup}>
                        <Text style={styles.schoolCardName} numberOfLines={2}>{school}</Text>
                        <Text style={styles.schoolCardUserCount}>利用者：{schoolUsersCount}名</Text>
                      </View>
                      <Ionicons name={isActive ? 'chevron-up' : 'chevron-down'} size={16} color="#6D7375" />
                    </TouchableOpacity>
                  );
                })}
                {pair.length === 1 && <View style={styles.schoolAccordionHeaderPlaceholder} />}
              </View>

              {activePair.length === 1 && renderSchoolUsers(activePair[0], false, true, pair.indexOf(activePair[0]) === 1)}
              {activePair.length === 2 && (
                <View style={styles.schoolAccordionResultsRow}>
                  {activePair.map(school => (
                    <View key={school} style={styles.schoolAccordionHalfResult}>
                      {renderSchoolUsers(school, true)}
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* 学校を選択した場合は、その学校カードの直下へ結果を表示する */}
      {activeSchools.length > 0 ? null : !hasFilter ? (
        <View style={styles.schoolListHint}>
          <Ionicons name="information-circle" size={18} color="#77BF48" />
          <Text style={styles.schoolListHintText}>学校名をタップすると、利用者一覧が表示されます</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ alignItems:'center', marginTop:32 }}>
          <Text style={{ color:'#BBB', fontSize:13 }}>該当する利用者はいません</Text>
        </View>
      ) : (
        <View style={styles.listSection}>
          {Object.entries(filteredBySchool).map(([school, users]) => (
            <View key={school}>
              <Text style={[styles.listSectionTitle, { fontSize:12 }]}>{school}</Text>
              {sortKidsByGrade(users).map((user: any, idx: number) => (
                <View key={user.id} style={[styles.userListItem, idx === users.length - 1 && { borderBottomWidth: 0 }]}>
                  <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => router.push({ pathname: '/schedule', params: { name: user.name, backTo: 'previous' } } as any)}>
                    <View style={styles.userIconCircle}><Ionicons name="person" size={20} color={COLORS.primary} /></View>
                    <View style={styles.userInfo}>
                      <Text style={styles.userName}>{user.name} <Text style={styles.userGrade}>({user.grade || '学年未定'})</Text></Text>
                      {user.days && <Text style={{ fontSize:11, color:'#5B9BD5' }}>{DOW.filter(d => user.days[d]).join('・')}</Text>}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#8A9294" />
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

  const transportCalendarDates = useMemo(() => {
    const year = transportCalendarMonth.getFullYear();
    const month = transportCalendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = Math.ceil((firstDay + daysInMonth) / 7) * 7;

    return Array.from({ length: cellCount }, (_, index) => {
      const day = index - firstDay + 1;
      if (day < 1 || day > daysInMonth) return null;
      const date = new Date(year, month, day);
      return { date, dateStr: getDateLayoutKey(date) };
    });
  }, [transportCalendarMonth]);

  const hasTransportEntry = (dateStr: string) => {
    const savedData = pickupAssignments[dateStr];
    if (!savedData) return false;
    try {
      const parsed = typeof savedData.entries === 'string'
        ? JSON.parse(savedData.entries)
        : savedData.entries;
      if (Array.isArray(parsed?.entries) && parsed.entries.length > 0) return true;
    } catch {}
    return Object.entries(savedData).some(([key, value]) =>
      key !== 'entries' && typeof value === 'string' && value.trim().length > 0
    );
  };

  const savePickupAssignment = async (dateStr: string, blockKey: string, staffName: string) => {
    const docRef = doc(db, 'pickup_assignments', dateStr);
    await setDoc(docRef, { [blockKey]: staffName }, { merge: true });
  };

  const renderTransportView = () => {
    const todayKey = getDateLayoutKey(new Date());
    return (
      <View style={{ flex: 1 }}>
        <View style={styles.transportMonthNav}>
          <TouchableOpacity
            style={styles.transportMonthNavButton}
            onPress={() => setTransportCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
          >
            <Ionicons name="chevron-back" size={23} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.transportMonthTitle}>
            {transportCalendarMonth.getFullYear()}年 {transportCalendarMonth.getMonth() + 1}月
          </Text>
          <TouchableOpacity
            style={styles.transportMonthNavButton}
            onPress={() => setTransportCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
          >
            <Ionicons name="chevron-forward" size={23} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.transportCalendarScroll}>
          <View style={styles.transportCalendar}>
            <View style={styles.transportWeekdayRow}>
              {DAY_NAMES.map((dayName, index) => (
                <Text
                  key={dayName}
                  style={[
                    styles.transportWeekdayText,
                    index === 0 && styles.transportSundayText,
                    index === 6 && styles.transportSaturdayText,
                  ]}
                >
                  {dayName}
                </Text>
              ))}
            </View>
            <View style={styles.transportCalendarGrid}>
              {transportCalendarDates.map((item, index) => {
                if (!item) return <View key={`empty-${index}`} style={styles.transportCalendarCell} />;
                const { date, dateStr } = item;
                const isToday = dateStr === todayKey;
                const isWritten = hasTransportEntry(dateStr);
                const isHoliday = !!publicHolidays[dateStr] || date.getDay() === 0;
                const isSaturday = date.getDay() === 6;
                const isNonWorkingDay = isHoliday || isSaturday;
                return (
                  <TouchableOpacity
                    key={dateStr}
                    style={[
                      styles.transportCalendarCell,
                      !isWritten && !isNonWorkingDay && styles.transportCalendarCellUnwritten,
                      isToday && styles.transportCalendarCellToday,
                    ]}
                    onPress={() => { setSelectedTransportDate(dateStr); setTransportModalVisible(true); }}
                    activeOpacity={0.78}
                  >
                    <View style={styles.transportCalendarDateRow}>
                      <Text style={[
                        styles.transportCalendarDate,
                        isHoliday && styles.transportSundayText,
                        isSaturday && styles.transportSaturdayText,
                      ]}>
                        {date.getDate()}
                      </Text>
                      {isToday && <Text style={styles.transportTodayLabel}>今日</Text>}
                    </View>
                    {!isNonWorkingDay && (
                      <View style={[styles.transportStatusBadge, isWritten ? styles.transportStatusWritten : styles.transportStatusEmpty]}>
                        <Text style={[styles.transportStatusText, isWritten ? styles.transportStatusWrittenText : styles.transportStatusEmptyText]}>
                          {isWritten ? '記入済み' : '未記入'}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
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

  const attendanceTabOrder: ViewMode[] = ['attendance', 'todayStatus', 'schoolUsers', 'transport'];
  const renderAttendanceTab = (tab: ViewMode) => {
    if (tab === 'attendance') return renderAttendanceView();
    if (tab === 'todayStatus') return renderTodayStatusView();
    if (tab === 'schoolUsers') return renderSchoolUsersView();
    return renderTransportView();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigateHome(router)}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {currentView === 'attendance' ? '出欠一覧' : currentView === 'schoolUsers' ? '利用者一覧' : currentView === 'todayStatus' ? '出席記録' : '送迎一覧'}
        </Text>
      </View>

      <View style={styles.tabNavigation}>
        <TouchableOpacity style={[styles.tabNavBtn, currentView === 'attendance' && styles.tabNavBtnActive]} onPress={() => changeAttendanceView('attendance')}>
          <Text style={[styles.tabNavText, currentView === 'attendance' && styles.tabNavTextActive]}>出欠一覧</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabNavBtn, currentView === 'todayStatus' && styles.tabNavBtnActive]} onPress={() => changeAttendanceView('todayStatus')}>
          <Text style={[styles.tabNavText, currentView === 'todayStatus' && styles.tabNavTextActive]}>出席記録</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabNavBtn, currentView === 'schoolUsers' && styles.tabNavBtnActive]} onPress={() => changeAttendanceView('schoolUsers')}>
          <Text style={[styles.tabNavText, currentView === 'schoolUsers' && styles.tabNavTextActive]}>利用者一覧</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabNavBtn, currentView === 'transport' && styles.tabNavBtnActive]} onPress={() => changeAttendanceView('transport')}>
          <Text style={[styles.tabNavText, currentView === 'transport' && styles.tabNavTextActive]}>送迎一覧</Text>
        </TouchableOpacity>
      </View>

      <SwipeTabPager
        tabs={attendanceTabOrder}
        active={currentView}
        onChange={changeAttendanceView}
        renderTab={renderAttendanceTab}
      />

      {currentView === 'attendance' && (
        <TouchableOpacity
          style={[styles.fab, showKidNames && styles.fabActive]}
          onPress={() => setShowKidNames(!showKidNames)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={showKidNames ? '人数表示に切り替える' : '名前表示に切り替える'}
        >
          <Ionicons name={showKidNames ? 'people-outline' : 'calculator-outline'} size={25} color={COLORS.white} />
        </TouchableOpacity>
      )}

      <Modal visible={!!schoolModalData} transparent animationType="fade">
        <TouchableWithoutFeedback onPress={() => setSchoolModalData(null)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
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
                      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => { setSchoolModalData(null); router.push({ pathname: '/schedule', params: { name: kid.name, backTo: 'previous' } } as any); }}>
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
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal visible={!!timeModalData} transparent animationType="fade">
        <TouchableWithoutFeedback onPress={() => setTimeModalData(null)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
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
                      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => { setTimeModalData(null); router.push({ pathname: '/schedule', params: { name: kid.name, backTo: 'previous' } } as any); }}>
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
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
      <AdminBottomNav active="attendance" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFF8F0', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  
  tabNavigation: { flexDirection: 'row', backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border },
  tabNavBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderColor: 'transparent' },
  tabNavBtnActive: { borderColor: '#007A82' },
  tabNavText: { fontSize: 13, fontWeight: '800', color: '#6F6A66' },
  tabNavTextActive: { fontSize: 13, fontWeight: '900', color: '#007A82' },
  tabSwipeArea: { flex: 1 },

  mainScroll: { flex: 1, backgroundColor: '#F8F9FA' },
  attendanceViewPositioning: { opacity: 0 },
  daySection: { marginBottom: 0, backgroundColor: '#F8F9FA' },
  daySectionToday: { backgroundColor: '#FFFBEA', borderTopWidth: 2, borderBottomWidth: 2, borderColor: '#E5C557' },
  dayHeaderContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', backgroundColor: '#F8F9FA', paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: '#E1E4E5', gap: 6 },
  dayHeaderText: { fontSize: 20, fontWeight: '800', color: COLORS.text },
  attendanceTodayBadge: { marginRight: 2, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: '#00AEB8' },
  attendanceTodayBadgeText: { color: COLORS.white, fontSize: 10, fontWeight: '900' },
  
  eventBadgeLarge: { backgroundColor: '#7B4E8E', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginLeft: 12 },
  eventBadgeTextLarge: { color: COLORS.white, fontSize: 12, fontWeight: 'bold' },

  totalBadge: { marginLeft: 12, paddingHorizontal: 10, paddingVertical: 4 },
  totalBadgeText: { fontSize: 13, fontWeight: '900', color: COLORS.text },
  schoolsGrid: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 10, paddingTop: 10, paddingBottom: 14, gap: 8, borderBottomWidth: 1, borderColor: '#E1E4E5' },
  attendanceSchoolColumn: { flex: 1, minWidth: 0, gap: 8 },
  schoolCard: { overflow: 'hidden', borderRadius: 8, backgroundColor: COLORS.white, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 3, elevation: 2, borderWidth: 1, borderColor: '#E2DEDA' },
  schoolCardFluid: { width: '100%', alignSelf: 'flex-start' },
  schoolNameBtn: { minHeight: 38, position: 'relative', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#E7E2DC' },
  schoolAccentLine: { position: 'absolute', left: 0, top: 2, bottom: 2, width: 4, borderRadius: 3 },
  schoolNameText: { fontSize: 14, fontWeight: '900', color: COLORS.text, textAlign: 'left' },
  timeGroupContainer: { overflow: 'hidden', backgroundColor: COLORS.white },
  timeButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.white, paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#E5E5E5' },
  timeButtonLast: { borderBottomWidth: 0 },
  timeButtonExpanded: { flexDirection: 'column', alignItems: 'flex-start', paddingVertical: 10, paddingHorizontal: 8 },
  timeButtonText: { fontSize: 12, fontWeight: 'bold', color: COLORS.text },
  timeCountText: { fontSize: 12, fontWeight: '900', color: COLORS.text },
  timeHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', marginBottom: 6, gap: 5 },
  timeTitleGroup: { flex: 1, minWidth: 0 },
  timeLabel: { fontSize: 11, fontWeight: '900', color: '#5D4037' },
  lessonNameText: { marginTop: 2, fontSize: 11, fontWeight: '800', color: COLORS.text },
  timeCountBadge: { fontSize: 10, fontWeight: '900', color: COLORS.text, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  kidNamesContainer: { gap: 3, width: '100%' },
  kidNameText: { fontSize: 13, fontWeight: '600', color: COLORS.text, flex: 1 },
  compactTimeTextGroup: { flex: 1, minWidth: 0 },
  compactLessonNameText: { marginTop: 2, fontSize: 10, fontWeight: '800', color: COLORS.text },
  noDataBox: { marginHorizontal: 16, padding: 16, backgroundColor: COLORS.white, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed' },
  noDataText: { color: COLORS.textLight, fontSize: 13 },
  statusDateNavigator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 },
  statusDateArrow: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF8F0', borderWidth: 1, borderColor: '#E6D8CA' },
  statusDateSelectors: { flexDirection: 'row', gap: 6, flexShrink: 1 },
  statusDateSelectButton: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 9, backgroundColor: '#EEF9FA', borderWidth: 1, borderColor: '#A8DEE1' },
  statusDateSelectText: { fontSize: 14, fontWeight: '900', color: '#2B2927', textAlign: 'center' },
  statusPickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.46)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  statusPickerCard: { width: '100%', maxWidth: 500, maxHeight: '78%', borderRadius: 16, backgroundColor: '#fff', padding: 16 },
  statusPickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  statusPickerTitle: { flex: 1, fontSize: 18, fontWeight: '900', color: '#2B2927', textAlign: 'center', marginLeft: 38 },
  statusPickerClose: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  statusPickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'center' },
  statusPickerOption: { width: '22%', minHeight: 42, borderRadius: 8, backgroundColor: '#F5F6F6', borderWidth: 1, borderColor: '#E1E4E4', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  statusPickerOptionSelected: { backgroundColor: '#00AEB8', borderColor: '#008C94' },
  statusPickerOptionText: { fontSize: 12, fontWeight: '800', color: '#34312F', textAlign: 'center' },
  statusPickerOptionTextSelected: { color: '#fff' },
  
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
  userFilterSection: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 12 },
  userFilterLabel: { marginBottom: 7, fontSize: 12, fontWeight: '900', color: '#008E96' },
  userDowSegment: { overflow: 'hidden', flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: '#00AEB8', backgroundColor: COLORS.white },
  userDowOption: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#9EDDE0' },
  userDowOptionActive: { backgroundColor: '#008E96' },
  userDowText: { fontSize: 13, fontWeight: '900', color: COLORS.text },
  userDowTextActive: { color: COLORS.white },
  schoolSearchHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  schoolSearchTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  schoolSearchTitle: { fontSize: 16, fontWeight: '900', color: COLORS.text },
  schoolSearchCount: { fontSize: 13, fontWeight: '800', color: COLORS.textLight },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, paddingBottom: 4 },
  schoolCardList: { width: '46%', margin: '2%', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, elevation: 2, borderWidth: 2, borderColor: 'transparent' },
  schoolAccordionRow: { width: '100%', paddingHorizontal: '2%', marginBottom: 8 },
  schoolAccordionHeaderRow: { flexDirection: 'row', gap: 10 },
  schoolAccordionHeader: { overflow: 'hidden', flex: 1, minHeight: 72, borderRadius: 8, paddingVertical: 9, paddingLeft: 15, paddingRight: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.white, borderWidth: 1, borderColor: '#E1E5E5', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
  schoolCardAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  schoolIconCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  schoolCardTextGroup: { flex: 1, minWidth: 0 },
  schoolCardUserCount: { marginTop: 3, fontSize: 11, fontWeight: '800', color: '#008E96' },
  schoolAccordionHeaderPlaceholder: { flex: 1 },
  schoolAccordionResultsRow: { flexDirection: 'row', gap: 10 },
  schoolAccordionHalfResult: { flex: 1, minWidth: 0 },
  schoolInlineResults: { marginTop: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  schoolInlineResultsCompact: { paddingHorizontal: 6 },
  schoolInlineResultsSplit: { paddingHorizontal: 0, paddingVertical: 0, backgroundColor: 'transparent', borderWidth: 0, shadowOpacity: 0, elevation: 0 },
  schoolUsersTwoColumns: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  schoolUsersColumn: { flex: 1, minWidth: 0 },
  schoolInlineUserItem: { minHeight: 52, paddingVertical: 8 },
  schoolInlineUserItemSplit: { marginBottom: 6, paddingHorizontal: 10, backgroundColor: COLORS.white, borderWidth: 1, borderColor: '#E1E5E5', borderRadius: 8, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  schoolInlineEmpty: { paddingVertical: 18, textAlign: 'center', fontSize: 12, fontWeight: '700', color: COLORS.textLight },
  schoolCardActive: { borderWidth: 2, borderColor: COLORS.primary },
  schoolCardName: { fontSize: 13, fontWeight: '900', color: COLORS.text, textAlign: 'left' },
  schoolListHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginHorizontal: 12, marginTop: 4, marginBottom: 18, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: '#F1F9FB' },
  schoolListHintText: { flexShrink: 1, fontSize: 11, fontWeight: '700', color: '#657173', textAlign: 'center' },
  listSection: { backgroundColor: COLORS.white, borderTopWidth: 1, borderColor: COLORS.border, padding: 16, minHeight: 400 },
  listSectionTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.primary, marginBottom: 16, textAlign: 'center' },
  userListItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: COLORS.border },
  userIconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0F8FF', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  userGrade: { fontSize: 14, color: COLORS.textLight, fontWeight: 'normal' },
  userKana: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  msgIconBtn: { padding: 10, marginLeft: 4 },
  transportMonthNav: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFF8F0', borderBottomWidth: 1, borderColor: COLORS.border },
  transportMonthNavButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white, borderWidth: 1, borderColor: '#D8D1CA' },
  transportMonthTitle: { minWidth: 150, textAlign: 'center', fontSize: 19, fontWeight: '900', color: COLORS.text },
  transportCalendarScroll: { padding: 10, paddingBottom: ADMIN_BOTTOM_NAV_HEIGHT + 18 },
  transportCalendar: { width: '100%', maxWidth: 820, alignSelf: 'center', backgroundColor: COLORS.white, borderRadius: 12, borderWidth: 1, borderColor: '#DDE3E3', overflow: 'hidden' },
  transportWeekdayRow: { flexDirection: 'row', backgroundColor: '#F4F7F7', borderBottomWidth: 1, borderColor: '#DDE3E3' },
  transportWeekdayText: { width: '14.2857%', paddingVertical: 9, textAlign: 'center', fontSize: 12, fontWeight: '900', color: COLORS.text },
  transportSundayText: { color: '#D34242' },
  transportSaturdayText: { color: '#2869B0' },
  transportCalendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  transportCalendarCell: { width: '14.2857%', minHeight: 82, padding: 5, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#E2E7E7', backgroundColor: COLORS.white },
  transportCalendarCellUnwritten: { backgroundColor: '#FFF0F3' },
  transportCalendarCellToday: { backgroundColor: '#FFF5C9', borderWidth: 2, borderColor: '#E7B83F' },
  transportCalendarDateRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 2 },
  transportCalendarDate: { fontSize: 14, fontWeight: '900', color: COLORS.text },
  transportTodayLabel: { fontSize: 8, fontWeight: '900', color: '#7A5510', backgroundColor: '#FFE59A', borderRadius: 6, paddingHorizontal: 4, paddingVertical: 2 },
  transportStatusBadge: { marginTop: 8, borderRadius: 7, paddingVertical: 5, paddingHorizontal: 2, alignItems: 'center' },
  transportStatusWritten: { backgroundColor: '#E2F5EA' },
  transportStatusEmpty: { backgroundColor: '#FFDCE4' },
  transportStatusText: { fontSize: 10, fontWeight: '900', textAlign: 'center' },
  transportStatusWrittenText: { color: '#247A43' },
  transportStatusEmptyText: { color: '#A63F58' },
  fab: {
    position: 'absolute',
    bottom: ADMIN_BOTTOM_NAV_HEIGHT + 16,
    right: 16,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#00AEB8',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#007A82',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.24,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 100,
  },
  fabActive: { backgroundColor: '#4A90E2', shadowColor: '#2D69A3' },
});
