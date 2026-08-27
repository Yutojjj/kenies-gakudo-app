import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Print from 'expo-print';
import { useRequireRole } from '../hooks/useRequireRole';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AdminBottomNav from '../components/AdminBottomNav';
import SwipeMonthPager from '../components/SwipeMonthPager';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { playUiSound } from '../utils/uiSounds';
import { handleWebWheelStep } from '../utils/webWheel';
import { navigateHome } from '../utils/navigationHome';

const WebScrollView = ScrollView as any;

type Staff = { id: string, name: string };
type AssignedStaff = { name: string, start: string, end: string };

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

const PRINT_SHIFT_COLORS = [
  '#A9DFD1', '#F3B1C3', '#C9BEF2', '#F2BE9B',
  '#A8D2F0', '#BCD99B', '#F2D783', '#9ED9DE',
  '#D8ADD0', '#D2C4A7', '#B3C7E5', '#EAB2A7',
];

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); 
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); 
const SHIFT_WHEEL_ITEM_HEIGHT = 40;
const SHIFT_WHEEL_VIEW_HEIGHT = 128;

function ShiftTimeWheel({
  values,
  value,
  visible,
  onChange,
}: {
  values: number[];
  value: number;
  visible: boolean;
  onChange: (value: number) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const wheelWrapRef = useRef<any>(null);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);
  const lastIndexRef = useRef(values.indexOf(value));
  const wheelLockRef = useRef(0);

  const getIndex = (y: number) => Math.max(
    0,
    Math.min(values.length - 1, Math.round(y / SHIFT_WHEEL_ITEM_HEIGHT)),
  );

  const selectIndex = (index: number, vibrate = true) => {
    if (index === lastIndexRef.current) return;
    lastIndexRef.current = index;
    onChange(values[index]);
    playUiSound('tick');
    if (vibrate && Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
  };

  const settle = (y: number) => {
    const index = getIndex(y);
    selectIndex(index);
    const targetY = index * SHIFT_WHEEL_ITEM_HEIGHT;
    if (Math.abs(y - targetY) > 0.5) {
      scrollRef.current?.scrollTo({ y: targetY, animated: true });
    }
    draggingRef.current = false;
  };

  useEffect(() => {
    if (!visible || draggingRef.current) return;
    const index = Math.max(0, values.indexOf(value));
    lastIndexRef.current = index;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: index * SHIFT_WHEEL_ITEM_HEIGHT, animated: false });
    }, 60);
    return () => clearTimeout(timer);
  }, [value, visible, values]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const element = wheelWrapRef.current as HTMLElement | null;
    if (!element?.addEventListener) return;

    const onWheel = (event: WheelEvent) => {
      handleWebWheelStep(event, {
        index: lastIndexRef.current,
        length: values.length,
        itemHeight: SHIFT_WHEEL_ITEM_HEIGHT,
        lockRef: wheelLockRef,
        onIndexChange: index => selectIndex(index, false),
        scrollTo: offset => scrollRef.current?.scrollTo({ y: offset, animated: true }),
      });
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [visible, values, selectIndex]);

  return (
    <View ref={wheelWrapRef} style={styles.shiftWheelWrap} nativeID="ui-time-wheel-shift">
      <View style={styles.shiftWheelSelection} pointerEvents="none" />
      <WebScrollView
        ref={scrollRef}
        style={styles.shiftWheelScroll}
        contentContainerStyle={styles.shiftWheelContent}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        snapToInterval={SHIFT_WHEEL_ITEM_HEIGHT}
        snapToOffsets={values.map((_, index) => index * SHIFT_WHEEL_ITEM_HEIGHT)}
        decelerationRate="fast"
        disableIntervalMomentum
        scrollEventThrottle={16}
        onScrollBeginDrag={() => { draggingRef.current = true; }}
        onScroll={(event: any) => {
          const y = event.nativeEvent.contentOffset.y;
          selectIndex(getIndex(y));
          if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
          snapTimerRef.current = setTimeout(() => settle(y), 110);
        }}
        onMomentumScrollEnd={(event: any) => settle(event.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(event: any) => {
          const y = event.nativeEvent.contentOffset.y;
          if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
          snapTimerRef.current = setTimeout(() => settle(y), 90);
        }}
      >
        {values.map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.shiftWheelItem, value === item && styles.shiftWheelItemActive]}
            onPress={() => {
              const index = values.indexOf(item);
              selectIndex(index);
              scrollRef.current?.scrollTo({ y: index * SHIFT_WHEEL_ITEM_HEIGHT, animated: true });
            }}
          >
            <Text style={[styles.shiftWheelText, value === item && styles.shiftWheelTextActive]}>
              {String(item).padStart(2, '0')}
            </Text>
          </TouchableOpacity>
        ))}
      </WebScrollView>
    </View>
  );
}

type ShiftCreateScreenProps = {
  embedded?: boolean;
  initialDate?: Date;
  onClose?: () => void;
  autoPdfOnOpen?: boolean;
};

export default function ShiftCreateScreen({ embedded = false, initialDate, onClose, autoPdfOnOpen = false }: ShiftCreateScreenProps = {}) {
  const { verified, checking } = useRequireRole('admin');

  const router = useRouter();
  const { openSettings, openWorkSummary, autoPdf, year: routeYear, month: routeMonth } = useLocalSearchParams<{
    openSettings?: string;
    openWorkSummary?: string;
    autoPdf?: string;
    year?: string;
    month?: string;
  }>();
  const [currentDate, setCurrentDate] = useState(() => {
    if (initialDate) return new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);
    const year = Number(routeYear);
    const month = Number(routeMonth);
    return Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12
      ? new Date(year, month - 1, 1)
      : new Date();
  });
  const autoPdfHandledRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [monthActionConfirm, setMonthActionConfirm] = useState<'autoFill' | 'delete' | null>(null);
  
  const showTimeInCalendar = true;

  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [staffListLoaded, setStaffListLoaded] = useState(false);
  const [assignedShiftsLoaded, setAssignedShiftsLoaded] = useState(false);
  const [requests, setRequests] = useState<Record<string, string>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, AssignedStaff[]>>({});
  
  const [masterTimes, setMasterTimes] = useState<string[]>([]);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'dow'|'staff'|'order'>('dow');
  const [pdfOrder, setPdfOrder] = useState<string[]>([]);
  const [settingTimeTarget, setSettingTimeTarget] = useState<{ staffIndex: number; field: 'start' | 'end' } | null>(null);
  const [settingTimeHour, setSettingTimeHour] = useState(14);
  const [settingTimeMinute, setSettingTimeMinute] = useState(0);
  // 自動入力設定（Firestoreに保存）
  const [autoFillSettings, setAutoFillSettings] = useState<{
    staffSettings: { name: string; start: string; end: string; priority: number; enabled: boolean }[];
    dayMaxCount: { '月':number; '火':number; '水':number; '木':number; '金':number };
    pdfOrder?: string[];
  }>({
    staffSettings: [],
    dayMaxCount: { '月':3, '火':3, '水':3, '木':3, '金':3 },
  });
  const [eventsData, setEventsData] = useState<Record<string, string[]>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});
  const [holidayPeriods, setHolidayPeriods] = useState<any[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState('');
  const [availableStaff, setAvailableStaff] = useState<Staff[]>([]);
  const [unavailableStaff, setUnavailableStaff] = useState<{name: string, type: string}[]>([]);
  const [workSummaryVisible, setWorkSummaryVisible] = useState(false);
  const [submissionStatusVisible, setSubmissionStatusVisible] = useState(false);
  const [workSummaryPeriod, setWorkSummaryPeriod] = useState<'month' | 'year'>('month');
  const [workSummaryDate, setWorkSummaryDate] = useState(currentDate);
  const [workHoursVisible, setWorkHoursVisible] = useState(false);
  const [currentDayAssigned, setCurrentDayAssigned] = useState<AssignedStaff[]>([]);

  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [editingStaffName, setEditingStaffName] = useState('');
  
  const [tempStart, setTempStart] = useState('14:00');
  const [tempEnd, setTempEnd] = useState('18:30');
  const [timeSelectTarget, setTimeSelectTarget] = useState<'start' | 'end'>('start');

  const [newStartHour, setNewStartHour] = useState(14);
  const [newStartMinute, setNewStartMinute] = useState(0);
  const [newEndHour, setNewEndHour] = useState(18);
  const [newEndMinute, setNewEndMinute] = useState(30);

  const [spreadsheetVisible, setSpreadsheetVisible] = useState(false);

  const submissionStatusRows = allStaff.map((staff) => {
    const monthPrefix = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-`;
    const submitted = Object.keys(requests).some((key) => {
      const prefix = `${staff.name}_`;
      return key.startsWith(prefix) && key.slice(prefix.length).startsWith(monthPrefix);
    });
    return { ...staff, submitted };
  });
  const submittedCount = submissionStatusRows.filter((staff) => staff.submitted).length;

  useEffect(() => {
    let staffList: Staff[] = [];
    let savedSettings: any = {};

    const applyStaffSettings = () => {
      if (!staffList.length) return;
      const savedStaff: any[] = Array.isArray(savedSettings.staffSettings) ? savedSettings.staffSettings : [];
      const merged = staffList
        .map((staff, index) => {
          const found = savedStaff.find((item: any) => item.name === staff.name);
          return found
            ? {
                name: staff.name,
                start: found.start || '14:00',
                end: found.end || '18:30',
                priority: Number(found.priority) || savedStaff.indexOf(found) + 1,
                enabled: found.enabled !== false,
              }
            : {
                name: staff.name,
                start: staff.name === '稲熊' ? '11:00' : '14:00',
                end: staff.name === '稲熊' ? '20:00' : '18:30',
                priority: savedStaff.length + index + 1,
                enabled: true,
              };
        })
        .sort((a, b) => a.priority - b.priority)
        .map((item, index) => ({ ...item, priority: index + 1 }));
      const staffNames = staffList.map(staff => staff.name);
      const savedPdfOrder = Array.isArray(savedSettings.pdfOrder)
        ? savedSettings.pdfOrder.filter((name: string) => staffNames.includes(name))
        : [];
      const normalizedPdfOrder = [...savedPdfOrder, ...staffNames.filter(name => !savedPdfOrder.includes(name))];
      setPdfOrder(normalizedPdfOrder);
      setAutoFillSettings({
        staffSettings: merged,
        dayMaxCount: savedSettings.dayMaxCount || { '月':3, '火':3, '水':3, '木':3, '金':3 },
        pdfOrder: normalizedPdfOrder,
      });
    };

    fetch('https://holidays-jp.github.io/api/v1/date.json')
      .then(res => res.json())
      .then(setPublicHolidays)
      .catch(e => console.warn('祝日APIの取得に失敗しました', e));

    const masterUnsub = onSnapshot(doc(db, 'settings', 'master_data'), (snap) => {
      const workTimes = snap.data()?.workTimes;
      if (Array.isArray(workTimes)) setMasterTimes(workTimes);
    }, () => setMasterTimes(['14:00-18:30', '11:00-18:30', '13:30-18:30']));

    const settingsUnsub = onSnapshot(doc(db, 'settings', 'autoFillSettings'), (snap) => {
      savedSettings = snap.exists() ? snap.data() : {};
      applyStaffSettings();
    });

    const staffUnsub = onSnapshot(query(collection(db, 'accounts'), where('role', '==', 'staff')), (snap) => {
      staffList = snap.docs
        .filter(d => d.data().showInShiftTable !== false)
        .map(d => ({ id: d.id, name: d.data().name }));
      setAllStaff(staffList);
      applyStaffSettings();
      setStaffListLoaded(true);
    }, (e) => {
      console.warn('スタッフ取得失敗', e);
      setStaffListLoaded(true);
    });

    const shiftsUnsub = onSnapshot(collection(db, 'shifts2'), (snap) => {
      const reqData: Record<string, string> = {};
      snap.forEach(d => {
        const data = d.data();
        if (!data.staffName || !data.dateStr || !data.type) return;
        reqData[`${String(data.staffName).trim()}_${data.dateStr}`] = data.type;
      });
      setRequests(reqData);
    });

    const asUnsub = onSnapshot(collection(db, 'assigned_shifts'), (s) => {
        const asData: Record<string, AssignedStaff[]> = {};
        s.forEach(d => { asData[d.id] = d.data().staff || []; });
        setAssignedShifts(asData);
        setAssignedShiftsLoaded(true);
      }, (e) => console.warn('assigned_shifts リスナーエラー', e));

    const evUnsub = onSnapshot(collection(db, 'events'), (snap) => {
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
      }, (e) => console.warn('events リスナーエラー', e));

    const holidaysUnsub = onSnapshot(doc(db, 'settings', 'holidays_data'), (snap) => {
      if (snap.exists() && snap.data().periods) setHolidayPeriods(snap.data().periods);
    });

    return () => {
      masterUnsub();
      settingsUnsub();
      staffUnsub();
      shiftsUnsub();
      asUnsub();
      evUnsub();
      holidaysUnsub();
    };
  }, []);

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
  
  const generateDays = (date = currentDate) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ day: i, dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
    }
    return days;
  };

  const generateWeeksForSpreadsheet = () => {
    const days = generateDays();
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    return weeks;
  };

  const openDayModal = (dateStr: string, assignedOverride?: AssignedStaff[]) => {
    setSelectedDateStr(dateStr);
    const avail: Staff[] = [];
    const unavail: {name: string, type: string}[] = [];
    
    allStaff.forEach(staff => {
      const type = requests[`${(staff.name||'').trim()}_${dateStr}`];
      if (type === '✕' || type === '午前✕' || type === '午後✕') {
        unavail.push({ name: staff.name, type });
      } else {
        avail.push(staff);
      }
    });
    
    setAvailableStaff(avail);
    setUnavailableStaff(unavail);
    setCurrentDayAssigned(assignedOverride ?? assignedShifts[dateStr] ?? []);
    setModalVisible(true);
  };

  const addStaffToShift = (staffName: string, isUnavailable: boolean = false) => {
    const proceedAdd = () => {
      setCurrentDayAssigned([...currentDayAssigned, { name: staffName, start: '14:00', end: '18:30' }]);
    };
    if (isUnavailable) {
      if (Platform.OS === 'web') {
        if (window.confirm(`${staffName}さんは「出勤不可(✕)」を提出していますが、シフトに追加しますか？`)) proceedAdd();
      } else {
        Alert.alert('確認', `${staffName}さんは「出勤不可(✕)」を提出していますが、シフトに追加しますか？`, [
          { text: 'キャンセル', style: 'cancel' },
          { text: '追加する', style: 'destructive', onPress: proceedAdd }
        ]);
      }
    } else {
      proceedAdd();
    }
  };

  const removeStaffFromShift = (staffName: string) => {
    setCurrentDayAssigned(currentDayAssigned.filter(s => s.name !== staffName));
  };


  // スタッフ別合計勤務時間を計算
  const calcWorkSummary = () => {
    const summary: {name:string; totalMin:number; days:number}[] = [];
    allStaff.forEach(staff => {
      let totalMin = 0;
      let days = 0;
      Object.entries(assignedShifts).forEach(([dateStr, entries]) => {
        const periodKey = workSummaryPeriod === 'month'
          ? `${workSummaryDate.getFullYear()}-${String(workSummaryDate.getMonth() + 1).padStart(2, '0')}`
          : String(workSummaryDate.getFullYear());
        if (!dateStr.startsWith(periodKey)) return;
        const entry = entries.find((e: any) => e.name === staff.name);
        if (!entry) return;
        const [sh, sm] = entry.start.split(':').map(Number);
        const [eh, em] = entry.end.split(':').map(Number);
        const mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins > 0) { totalMin += mins; days++; }
      });
      summary.push({ name: staff.name, totalMin, days });
    });
    return summary.filter(item => item.days > 0).sort((a,b) => b.totalMin - a.totalMin);
  };

  const toHM = (mins: number) => `${Math.floor(mins/60)}h${mins%60 > 0 ? String(mins%60).padStart(2,'0')+'m' : ''}`;

  const openWorkSummaryModal = () => {
    const today = new Date();
    setWorkSummaryDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setWorkSummaryPeriod('month');
    setWorkSummaryVisible(true);
  };

  const moveWorkSummaryPeriod = (amount: number) => {
    setWorkSummaryDate(previous => workSummaryPeriod === 'month'
      ? new Date(previous.getFullYear(), previous.getMonth() + amount, 1)
      : new Date(previous.getFullYear() + amount, 0, 1));
  };

  const openTimeEditor = (staffName: string, start: string, end: string) => {
    const [startHour, startMinute] = start.split(':').map(Number);
    const [endHour, endMinute] = end.split(':').map(Number);
    setEditingStaffName(staffName);
    setTempStart(start);
    setTempEnd(end);
    setNewStartHour(Number.isFinite(startHour) ? startHour : 14);
    setNewStartMinute(Number.isFinite(startMinute) ? startMinute : 0);
    setNewEndHour(Number.isFinite(endHour) ? endHour : 18);
    setNewEndMinute(Number.isFinite(endMinute) ? endMinute : 30);
    setTimeSelectTarget('start');
    setTimePickerVisible(true);
  };

  const handleMasterTimeSelect = (t: string) => {
    if (t.includes('-')) {
      const [s, e] = t.split('-');
      const [startHour, startMinute] = s.split(':').map(Number);
      const [endHour, endMinute] = e.split(':').map(Number);
      setTempStart(s);
      setTempEnd(e);
      setNewStartHour(startHour);
      setNewStartMinute(startMinute);
      setNewEndHour(endHour);
      setNewEndMinute(endMinute);
    } else {
      if (timeSelectTarget === 'start') setTempStart(t);
      else setTempEnd(t);
    }
  };

  const handleAddMasterTime = async () => {
    const newSet = `${String(newStartHour).padStart(2, '0')}:${String(newStartMinute).padStart(2, '0')}-${String(newEndHour).padStart(2, '0')}:${String(newEndMinute).padStart(2, '0')}`;
    if (masterTimes.includes(newSet)) {
      Alert.alert('エラー', 'すでに候補にあります');
      return;
    }
    const newTimes = [...masterTimes, newSet].sort();
    setMasterTimes(newTimes);
    await setDoc(doc(db, 'settings', 'master_data'), { workTimes: newTimes }, { merge: true });
  };

  const saveTimeEdit = () => {
    setCurrentDayAssigned(currentDayAssigned.map(s => 
      s.name === editingStaffName ? { ...s, start: tempStart, end: tempEnd } : s
    ));
    setTimePickerVisible(false);
  };

  const applyStaffTimeCandidate = (staffName: string, candidate: string) => {
    const [start, end] = candidate.split('-').map(value => value.trim());
    if (!start || !end) return;
    setCurrentDayAssigned(currentDayAssigned.map(staff => (
      staff.name === staffName ? { ...staff, start, end } : staff
    )));
  };

  const saveStaffTimeCandidate = async (candidate: string) => {
    if (masterTimes.includes(candidate)) return;
    const newTimes = [...masterTimes, candidate].sort();
    setMasterTimes(newTimes);
    await setDoc(doc(db, 'settings', 'master_data'), { workTimes: newTimes }, { merge: true });
  };

  const saveDayShift = async () => {
    try {
      await setDoc(doc(db, 'assigned_shifts', selectedDateStr), { staff: currentDayAssigned, updatedAt: new Date() }, { merge: true });
      setAssignedShifts(previous => ({ ...previous, [selectedDateStr]: currentDayAssigned }));
      setModalVisible(false);
    } catch (e) {
      Alert.alert('エラー', '保存に失敗しました');
    }
  };

  const moveModalDate = async (amount: number) => {
    if (!selectedDateStr) return;
    try {
      await setDoc(doc(db, 'assigned_shifts', selectedDateStr), { staff: currentDayAssigned, updatedAt: new Date() }, { merge: true });
      setAssignedShifts(previous => ({ ...previous, [selectedDateStr]: currentDayAssigned }));
      const nextDate = new Date(`${selectedDateStr}T00:00:00`);
      nextDate.setDate(nextDate.getDate() + amount);
      const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
      openDayModal(nextDateStr);
    } catch (e) {
      Alert.alert('エラー', '保存に失敗しました');
    }
  };

  const formatModalAdjacentDate = (amount: number) => {
    if (!selectedDateStr) return '';
    const date = new Date(`${selectedDateStr}T00:00:00`);
    date.setDate(date.getDate() + amount);
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} (${weekdays[date.getDay()]})`;
  };

  const formatModalDate = () => {
    if (!selectedDateStr) return '';
    const date = new Date(`${selectedDateStr}T00:00:00`);
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    return `${selectedDateStr} (${weekdays[date.getDay()]})`;
  };

  const exportPDF = async () => {
    try {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const daysInMonth = getDaysInMonth(currentDate.getFullYear(), currentDate.getMonth());
      const DOW = ['日','月','火','水','木','金','土'];

      const weeks: ({day:number, dow:number, dateStr:string} | null)[][] = [];
      let week: ({day:number, dow:number, dateStr:string} | null)[] = [];
      const firstDow = new Date(year, month - 1, 1).getDay();
      for (let p = 0; p < firstDow; p++) week.push(null);
      for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(year, month - 1, d).getDay();
        const ds = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        week.push({ day: d, dow, dateStr: ds });
        if (dow === 6 || d === daysInMonth) {
          while (week.length < 7) week.push(null);
          weeks.push(week);
          week = [];
        }
      }

      const dowHeader = `<tr>
        ${DOW.map((d,i) => {
          const cls = i===0 ? 'c-dow c-dow-sun' : i===6 ? 'c-dow c-dow-sat' : 'c-dow c-dow-week';
          return `<td class="${cls}">${d}</td>`;
        }).join('')}
      </tr>`;

      let bodyHtml = '';
      const orderedStaff: typeof allStaff = autoFillSettings.pdfOrder && autoFillSettings.pdfOrder.length > 0
        ? [...autoFillSettings.pdfOrder.map(n => allStaff.find(s => s.name === n)).filter((s): s is typeof allStaff[0] => !!s),
           ...allStaff.filter(s => !(autoFillSettings.pdfOrder as string[]).includes(s.name))]
        : allStaff;

      weeks.forEach(wk => {
        const weekHasContent = wk.some(cell => cell && (
          (eventsData[cell.dateStr] || []).length > 0 ||
          (assignedShifts[cell.dateStr] || []).length > 0
        ));
        const cells = wk.map(cell => {
          if (!cell) return `<td class="calendar-day calendar-day-empty${weekHasContent ? '' : ' calendar-day-short'}"></td>`;
          const isSun = cell.dow === 0;
          const isSat = cell.dow === 6;
          const isPH = !!publicHolidays[cell.dateStr];
          const shortClass = weekHasContent ? '' : ' calendar-day-short';
          const dayClass = `${isPH || isSun ? 'calendar-day calendar-day-sun' : isSat ? 'calendar-day calendar-day-sat' : 'calendar-day'}${shortClass}`;
          const eventEntries = (eventsData[cell.dateStr] || []).map(title => (
            `<div class="calendar-event">${title}</div>`
          )).join('');
          const entries = orderedStaff.map((staff, staffIndex) => {
            const assigned = assignedShifts[cell.dateStr]?.find((s: any) => s.name === staff.name);
            if (!assigned) return '';
            const color = PRINT_SHIFT_COLORS[staffIndex % PRINT_SHIFT_COLORS.length];
            return `<div class="calendar-shift" style="background-color:${color} !important;">
              <span class="calendar-shift-name">${staff.name}</span><span class="calendar-shift-time">${assigned.start}〜${assigned.end}</span>
            </div>`;
          }).filter(Boolean).join('');
          return `<td class="${dayClass}"><div class="calendar-date">${cell.day}</div><div class="calendar-events">${eventEntries}</div><div class="calendar-shifts">${entries}</div></td>`;
        }).join('');
        bodyHtml += `<tr>${cells}</tr>`;
      });

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        @page { size: A4 portrait; margin: 4mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Hiragino Kaku Gothic ProN', 'Meiryo', Arial, sans-serif;
          font-size: 8px;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          color-adjust: exact;
        }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        td { border: 0.5px solid #AAAAAA; vertical-align: middle; text-align: center; }

        .c-dow { font-weight: 900; font-size: 11px; line-height: 1.1; padding: 1.5mm 1px; }
        .c-dow-week { background-color: #E8E8E8 !important; color: #333; }
        .c-dow-sun  { background-color: #FFD9D9 !important; color: #CC0000; }
        .c-dow-sat  { background-color: #CCE4FF !important; color: #0055CC; }

        caption { caption-side: top; text-align: left; font-size: 14px; font-weight: 900; padding: 0 0 2mm; }
        .calendar-day { height: 38mm; vertical-align: top; text-align: left; padding: 0; background: #FFFFFF !important; }
        .calendar-day-empty { background: #F4F4F4 !important; }
        .calendar-day-short { height: 16mm; }
        .calendar-day-sun { background: #FFF1F1 !important; }
        .calendar-day-sat { background: #F0F7FF !important; }
        .calendar-date { font-weight: 900; font-size: 16px; line-height: 1; padding: 1.5mm 1.5mm 0; margin-bottom: 1.5mm; }
        .calendar-day-sun .calendar-date { color: #D94747; }
        .calendar-day-sat .calendar-date { color: #2874C6; }
        .calendar-events { display: flex; flex-direction: column; gap: 0.5mm; margin-bottom: 0; width: 100%; }
        .calendar-event { width: 100%; border-radius: 0; padding: 1.2mm 1.5mm; background: #E9B92F !important; color: #2D2100; font-size: 10px; line-height: 1.15; font-weight: 900; white-space: normal; overflow-wrap: anywhere; }
        .calendar-shifts { width: 100%; display: flex; flex-direction: column; gap: 0; }
        .calendar-shift { width: 100%; border-radius: 0; padding: 1.1mm 1.5mm; font-size: 10px; line-height: 1.12; color: #111; white-space: normal; overflow-wrap: normal; font-weight: 900; }
        .calendar-shift-name { font-weight: 900; font-size: 11px; margin-right: 1mm; }
        .calendar-shift-time { display: inline-block; white-space: nowrap; font-weight: 900; font-size: 10px; }

        .legend { display: none; }
        .lb { display: inline-block; width: 10px; height: 10px; border: 0.5px solid #aaa; vertical-align: middle; margin-right: 2px; }
      </style></head><body>
        <table>
          <caption>${year}年${month}月 シフト表</caption>
          <thead>${dowHeader}</thead>
          <tbody>${bodyHtml}</tbody>
        </table>
        <div class="legend">
          <span><span class="lb" style="background:#FFD700;"></span>出勤（時間）</span>
          <span><span class="lb" style="background:#D0D0D0;"></span>× 出勤不可 / 未回答</span>
          <span><span class="lb" style="background:#FFD9D9;"></span>日曜・祝日</span>
          <span><span class="lb" style="background:#CCE4FF;"></span>土曜</span>
        </div>
      </body></html>`;

      if (Platform.OS === 'web') {
        // srcdoc方式（Vercel HTTPS環境対応・ポップアップ不要）
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;visibility:hidden;';
        iframe.srcdoc = html;
        document.body.appendChild(iframe);
        iframe.onload = () => {
          setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            setTimeout(() => {
              document.body.removeChild(iframe);
            }, 1000);
          }, 300);
        };
      } else {
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      }
    } catch (e: any) {
      console.error('PDF error:', e);
      Alert.alert('エラー', `PDF作成に失敗しました: ${e?.message || String(e)}`);
    }
  };

  useEffect(() => {
    if (openSettings === '1') setSettingsVisible(true);
  }, [openSettings]);

  useEffect(() => {
    if (openWorkSummary !== '1') return;
    const today = new Date();
    setWorkSummaryDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setWorkSummaryPeriod('month');
    setWorkSummaryVisible(true);
  }, [openWorkSummary]);

  useEffect(() => {
    if ((autoPdf !== '1' && !autoPdfOnOpen) || autoPdfHandledRef.current || !staffListLoaded || !assignedShiftsLoaded) return;
    autoPdfHandledRef.current = true;
    const timer = setTimeout(() => exportPDF(), 350);
    return () => clearTimeout(timer);
  }, [autoPdf, staffListLoaded, assignedShiftsLoaded, allStaff, assignedShifts, requests]);



















  const weeks = ['日', '月', '火', '水', '木', '金', '土'];
  const spreadsheetWeeks = generateWeeksForSpreadsheet();
  const workSummary = calcWorkSummary();

  const saveAutoFillSettings = async (settings: typeof autoFillSettings) => {
    setAutoFillSettings(settings);
    if (settings.pdfOrder) setPdfOrder(settings.pdfOrder);
    await setDoc(doc(db, 'settings', 'autoFillSettings'), { ...settings, updatedAt: new Date() }, { merge: true });
  };

  const openSettingTimePicker = (staffIndex: number, field: 'start' | 'end') => {
    const value = autoFillSettings.staffSettings[staffIndex]?.[field] || (field === 'start' ? '14:00' : '18:30');
    const [hour, minute] = value.split(':').map(Number);
    setSettingTimeHour(Number.isFinite(hour) ? hour : 14);
    setSettingTimeMinute(Number.isFinite(minute) ? minute : 0);
    setSettingTimeTarget({ staffIndex, field });
  };

  const saveSettingTime = async () => {
    if (!settingTimeTarget) return;
    const value = `${String(settingTimeHour).padStart(2, '0')}:${String(settingTimeMinute).padStart(2, '0')}`;
    const nextStaffSettings = autoFillSettings.staffSettings.map((staff, index) =>
      index === settingTimeTarget.staffIndex ? { ...staff, [settingTimeTarget.field]: value } : staff
    );
    await saveAutoFillSettings({ ...autoFillSettings, staffSettings: nextStaffSettings });
    setSettingTimeTarget(null);
  };

  const deleteCurrentMonthShifts = async () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    setLoading(true);
    let count = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (assignedShifts[dateStr] && assignedShifts[dateStr].length > 0) {
        await deleteDoc(doc(db, 'assigned_shifts', dateStr));
        count++;
      }
    }
    setLoading(false);
    if (Platform.OS === 'web') window.alert(`${count}日分のシフトを削除しました`);
    else Alert.alert('完了', `${count}日分のシフトを削除しました`);
  };

  const autoFillCurrentMonth = async () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let updatedCount = 0;
    setLoading(true);
    try {
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month, d);
        const dow = date.getDay();
        if (dow === 0 || dow === 6) continue;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (publicHolidays[dateStr]) continue;
        const already = assignedShifts[dateStr] || [];
        const assignedNames = [...already.map((s: any) => s.name)];
        const newEntries: { name: string; start: string; end: string }[] = [...already];
        const dowName = ['日','月','火','水','木','金','土'][date.getDay()] as '月'|'火'|'水'|'木'|'金';
        const maxCount = (autoFillSettings.dayMaxCount as any)[dowName] ?? 3;
        const sortedSettings = [...autoFillSettings.staffSettings]
          .filter(s => s.enabled)
          .sort((a, b) => a.priority - b.priority);
        for (const setting of sortedSettings) {
          if (assignedNames.includes(setting.name)) continue;
          const req = requests[`${(setting.name || '').trim()}_${dateStr}`];
          if (req === '✕' || req === '午前✕' || req === '午後✕') continue;
          const isInaguma = setting.name === '稲熊';
          const othersCount = newEntries.filter(s => s.name !== '稲熊').length;
          if (!isInaguma && othersCount >= maxCount) continue;
          newEntries.push({ name: setting.name, start: setting.start, end: setting.end });
          assignedNames.push(setting.name);
        }
        if (newEntries.length === already.length) continue;
        await setDoc(doc(db, 'assigned_shifts', dateStr), { staff: newEntries, updatedAt: new Date() }, { merge: true });
        updatedCount++;
      }
      if (Platform.OS === 'web') window.alert(`完了: ${updatedCount}日分を自動入力しました`);
      else Alert.alert('完了', `${updatedCount}日分を自動入力しました`);
    } catch (e) {
      if (Platform.OS === 'web') window.alert('エラー: 一部保存に失敗しました');
      else Alert.alert('エラー', '一部保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const renderMonthCalendar = (date: Date) => {
    const days = generateDays(date);

    return (
      <ScrollView style={styles.calendarScroll} contentContainerStyle={styles.calendarContent}>
        <View style={styles.calHeaderRow}>
          {weeks.map((w, i) => <Text key={i} style={[styles.calWeekText, i === 0 && {color: 'red'}, i === 6 && {color: 'blue'}]}>{w}</Text>)}
        </View>

        <View style={styles.calGrid}>
          {days.map((item, index) => {
            if (!item) return <View key={`empty-${index}`} style={styles.calCellEmpty} />;

            const assignedCount = (assignedShifts[item.dateStr] || []).length;
            const isEventDay = !!eventsData[item.dateStr];

            let unavailableCount = 0;
            allStaff.forEach(staff => {
              const key = `${(staff.name || '').trim()}_${item.dateStr}`;
              const req = requests[key];
              if (req === '✕' || req === '午前✕' || req === '午後✕') unavailableCount++;
            });
            const availableCount = allStaff.length - unavailableCount;

            const d = new Date(item.dateStr);
            const isSunday = d.getDay() === 0;
            const isSaturday = d.getDay() === 6;
            const isPublicHoliday = !!publicHolidays[item.dateStr];

            let dateColor = COLORS.text;
            if (isSunday || isPublicHoliday) dateColor = 'red';
            else if (isSaturday) dateColor = 'blue';

            const hPeriod = holidayPeriods.find((h: any) => item.dateStr >= h.start && item.dateStr <= h.end);
            return (
              <TouchableOpacity key={item.dateStr} style={[styles.calCell, hPeriod?.color && { backgroundColor: hPeriod.color }]} onPress={() => openDayModal(item.dateStr)}>
                <View style={styles.cellTopRow}>
                  <Text style={[styles.calDayText, { color: dateColor }]}>{item.day}</Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.availableCountText}>可:{availableCount}</Text>
                    {assignedCount > 0 && <Text style={styles.cellCountText}>{assignedCount}名</Text>}
                  </View>
                </View>

                {isEventDay && (
                  <View style={styles.eventBadge}>
                    <Text style={styles.eventBadgeText} numberOfLines={2}>
                      {eventsData[item.dateStr].join('・')}
                    </Text>
                  </View>
                )}

                <View style={{ flex: 1, marginTop: 3 }}>
                  {(assignedShifts[item.dateStr] || []).map((st, i) => {
                    const staffIndex = Math.max(0, allStaff.findIndex(staff => staff.name === st.name));
                    return (
                      <View
                        key={`${st.name}-${i}`}
                        style={[
                          styles.cellStaffRow,
                          !showTimeInCalendar && styles.cellStaffRowCompact,
                          { backgroundColor: SHIFT_CARD_COLORS[staffIndex % SHIFT_CARD_COLORS.length] },
                        ]}
                      >
                        <Text style={styles.cellStaffName} numberOfLines={1}>{st.name}</Text>
                        {showTimeInCalendar && (
                          <View style={styles.cellStaffTimeRow}>
                            <Text style={styles.cellStaffTime}>{st.start}</Text>
                            <Text style={styles.cellStaffTime}>{st.end}</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );
  };

  if (checking || !verified) return null;
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => embedded ? onClose?.() : navigateHome(router)}>
          <Ionicons name={embedded ? 'close' : 'chevron-back'} size={embedded ? 26 : 24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>シフト作成</Text>
        <TouchableOpacity
          style={[styles.pdfBtn, styles.headerPdfBtn]}
          onPress={exportPDF}
          disabled={loading}
        >
          <Ionicons name="calendar-outline" size={18} color={COLORS.white} />
          <Text style={styles.pdfBtnText}>PDF出力</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pdfBtn, styles.submissionStatusBtn]}
          onPress={() => setSubmissionStatusVisible(true)}
          disabled={loading}
        >
          <Text style={styles.pdfBtnText}>シフト提出状況</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pdfBtn, styles.headerAutoFillBtn]}
          onPress={() => setMonthActionConfirm('autoFill')}
          disabled={loading}
        >
          {loading ? <ActivityIndicator size="small" color={COLORS.white} /> : <Ionicons name="pencil-outline" size={19} color={COLORS.white} />}
          <Text style={styles.pdfBtnText}>自動入力</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={submissionStatusVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.submissionStatusOverlay}
          activeOpacity={1}
          onPress={() => setSubmissionStatusVisible(false)}
        >
          <TouchableOpacity
            style={styles.submissionStatusPanel}
            activeOpacity={1}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.submissionStatusHeader}>
              <View>
                <Text style={styles.submissionStatusTitle}>シフト提出状況</Text>
                <Text style={styles.submissionStatusMonth}>
                  {currentDate.getFullYear()}年{currentDate.getMonth() + 1}月
                </Text>
              </View>
              <TouchableOpacity
                style={styles.submissionStatusClose}
                onPress={() => setSubmissionStatusVisible(false)}
              >
                <Ionicons name="close" size={24} color="#5D4037" />
              </TouchableOpacity>
            </View>

            <View style={styles.submissionStatusSummary}>
              <Text style={styles.submissionStatusSummaryText}>提出済み {submittedCount}名</Text>
              <Text style={styles.submissionStatusSummaryText}>未提出 {submissionStatusRows.length - submittedCount}名</Text>
            </View>

            <ScrollView
              style={styles.submissionStatusScroll}
              contentContainerStyle={styles.submissionStatusScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {submissionStatusRows.map((staff) => (
                <View key={staff.id} style={styles.submissionStatusRow}>
                  <Text style={styles.submissionStatusStaffName}>{staff.name}</Text>
                  <View style={[
                    styles.submissionStatusBadge,
                    staff.submitted ? styles.submissionStatusSubmitted : styles.submissionStatusMissing,
                  ]}>
                    <Ionicons
                      name={staff.submitted ? 'checkmark-circle' : 'ellipse-outline'}
                      size={18}
                      color={staff.submitted ? '#278A4A' : '#B06A33'}
                    />
                    <Text style={[
                      styles.submissionStatusBadgeText,
                      staff.submitted ? styles.submissionStatusSubmittedText : styles.submissionStatusMissingText,
                    ]}>
                      {staff.submitted ? '提出済み' : '未提出'}
                    </Text>
                  </View>
                </View>
              ))}
              {submissionStatusRows.length === 0 && (
                <Text style={styles.submissionStatusEmpty}>スタッフ情報を読み込み中です</Text>
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ⑥ 勤務時間サマリーポップアップ */}
      <Modal visible={workSummaryVisible} transparent animationType="fade">
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'center', alignItems:'center', padding:20 }}>
          <View style={{ width:'100%', maxHeight:'80%', backgroundColor:'#fff', borderRadius:16, overflow:'hidden' }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, backgroundColor:'#EFEBE9', borderBottomWidth:1, borderColor:'#D7CCC8' }}>
              <Text style={{ fontSize:16, fontWeight:'bold', color:'#5D4037' }}>スタッフ別 合計勤務時間</Text>
              <TouchableOpacity onPress={() => setWorkSummaryVisible(false)}>
                <Ionicons name="close-circle" size={28} color="#795548" />
              </TouchableOpacity>
            </View>
            <View style={styles.workSummaryControls}>
              <View style={styles.workSummaryTabs}>
                <TouchableOpacity
                  style={[styles.workSummaryTab, workSummaryPeriod === 'month' && styles.workSummaryTabActive]}
                  onPress={() => {
                    const today = new Date();
                    setWorkSummaryDate(new Date(today.getFullYear(), today.getMonth(), 1));
                    setWorkSummaryPeriod('month');
                  }}
                >
                  <Text style={[styles.workSummaryTabText, workSummaryPeriod === 'month' && styles.workSummaryTabTextActive]}>月別</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.workSummaryTab, workSummaryPeriod === 'year' && styles.workSummaryTabActive]}
                  onPress={() => setWorkSummaryPeriod('year')}
                >
                  <Text style={[styles.workSummaryTabText, workSummaryPeriod === 'year' && styles.workSummaryTabTextActive]}>年別</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.workSummaryPeriodNav}>
                <TouchableOpacity style={styles.workSummaryPeriodBtn} onPress={() => moveWorkSummaryPeriod(-1)}>
                  <Ionicons name="chevron-back" size={20} color="#5D4037" />
                </TouchableOpacity>
                <Text style={styles.workSummaryPeriodText}>
                  {workSummaryPeriod === 'month'
                    ? `${workSummaryDate.getFullYear()}年 ${workSummaryDate.getMonth() + 1}月`
                    : `${workSummaryDate.getFullYear()}年`}
                </Text>
                <TouchableOpacity style={styles.workSummaryPeriodBtn} onPress={() => moveWorkSummaryPeriod(1)}>
                  <Ionicons name="chevron-forward" size={20} color="#5D4037" />
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={{ padding:16 }}>
              {workSummary.map((s, i) => (
                <View key={s.name} style={{ flexDirection:'row', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderColor:'#EEE' }}>
                  <Text style={{ width:30, fontSize:13, color:'#aaa', fontWeight:'bold' }}>{i+1}</Text>
                  <Text style={{ flex:1, fontSize:15, fontWeight:'bold', color:'#333' }}>{s.name}</Text>
                  <Text style={{ fontSize:13, color:'#666' }}>{s.days}日</Text>
                  <Text style={{ fontSize:16, fontWeight:'bold', color:'#5D4037', marginLeft:12, minWidth:70, textAlign:'right' }}>{toHM(s.totalMin)}</Text>
                </View>
              ))}
              {workSummary.length === 0 && <Text style={{ textAlign:'center', color:'#aaa', padding:20 }}>この期間の確定シフトはありません</Text>}
              <View style={{ height:20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <View style={styles.monthSelector}>
        <View style={styles.monthNavRow}>
          <TouchableOpacity onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))}><Ionicons name="chevron-back" size={24} color={COLORS.text} /></TouchableOpacity>
          <Text style={styles.monthText}>{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</Text>
          <TouchableOpacity onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))}><Ionicons name="chevron-forward" size={24} color={COLORS.text} /></TouchableOpacity>
          <TouchableOpacity style={styles.monthDeleteBtn} onPress={() => setMonthActionConfirm('delete')} disabled={loading}>
            <Ionicons name="trash-outline" size={15} color="#B93E48" />
            <Text style={styles.monthDeleteText}>削除</Text>
          </TouchableOpacity>
        </View>
      </View>

      <SwipeMonthPager
        currentDate={currentDate}
        onChangeDate={setCurrentDate}
        renderMonth={renderMonthCalendar}
        enabled={!modalVisible && !settingsVisible && !monthActionConfirm}
      />

      {/* ==========================================
          ★ 1画面完全フィットシフト表 (土日幅縮小版)
          ========================================== */}
      <Modal visible={spreadsheetVisible} animationType="slide" transparent={false}>
        <SafeAreaView style={styles.ssModalContainer}>
          <View style={styles.ssModalHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="grid" size={24} color={COLORS.primary} style={{ marginRight: 8 }} />
              <Text style={styles.ssModalTitle}>月別シフト表</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity onPress={exportPDF} style={styles.pdfBtn}>
                <Ionicons name="calendar-outline" size={20} color={COLORS.white} />
                <Text style={styles.pdfBtnText}>PDF出力</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSpreadsheetVisible(false)}>
                <Ionicons name="close-circle" size={32} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
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
                  <View style={[styles.ssHeaderCell, { backgroundColor: '#FFF8F0', width: '16%' }]}><Text style={styles.ssHeaderText}>{currentDate.getMonth() + 1}月</Text></View>
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

                    {(autoFillSettings.pdfOrder && autoFillSettings.pdfOrder.length > 0
              ? [...autoFillSettings.pdfOrder.map((n: string) => allStaff.find(s => s.name === n)).filter((s): s is typeof allStaff[0] => !!s),
                 ...allStaff.filter(s => !(autoFillSettings.pdfOrder as string[]).includes(s.name))]
              : allStaff).map(staff => (
                      <View key={staff.id} style={styles.ssRow}>
                        <View style={[styles.ssNameCell, { width: '16%' }]}>
                          <Text style={styles.ssNameText} numberOfLines={1} adjustsFontSizeToFit>{staff.name}</Text>
                        </View>
                        {week.map((day, dIdx) => {
                          let content = '';
                          let bgColor = '#FFFFFF';
                          let isBold = false;
                          const cellWidth = (dIdx === 0 || dIdx === 6) ? '6%' : '14.4%';
                          
                          if (day) {
                            const assigned = assignedShifts[day.dateStr]?.find(s => s.name === staff.name);
                            const req = requests[`${(staff.name||'').trim()}_${day.dateStr}`];
                            
                            if (assigned) {
                              content = `${assigned.start}\n${assigned.end}`;
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
                              {/* ★ numberOfLines={2} で確実に2行で切る */}
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

      {/* --- モーダル群 --- */}
      <Modal visible={modalVisible} animationType="fade" transparent>
        <SafeAreaView style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity style={styles.modalDateNavBtn} onPress={() => moveModalDate(-1)}>
                <Ionicons name="chevron-back" size={24} color={COLORS.text} />
                <Text style={styles.modalDateNavText}>{formatModalAdjacentDate(-1)}</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {formatModalDate()} のシフト
                {publicHolidays[selectedDateStr] ? ` (${publicHolidays[selectedDateStr]})` : ''}
              </Text>
              <View style={styles.modalHeaderRight}>
                <TouchableOpacity style={styles.modalDateNavBtn} onPress={() => moveModalDate(1)}>
                  <Text style={styles.modalDateNavText}>{formatModalAdjacentDate(1)}</Text>
                  <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setModalVisible(false)}>
                  <Ionicons name="close" size={30} color={COLORS.text} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView style={{ flex: 1, padding: 20 }}>

              {eventsData[selectedDateStr]?.length > 0 && (
                <View style={styles.dayEventCard}>
                  <View style={styles.dayEventTitleRow}>
                    <Ionicons name="calendar" size={18} color="#A76500" />
                    <Text style={styles.dayEventLabel}>イベント予定</Text>
                  </View>
                  {eventsData[selectedDateStr].map((title, index) => (
                    <Text key={`${title}-${index}`} style={styles.dayEventTitle}>・{title}</Text>
                  ))}
                </View>
              )}

              <View style={styles.shiftEditorColumns}>
                <View style={styles.shiftAssignedPane}>
                  {/* 決定済みを左側にまとめ、横幅を広く使う */}
                  <Text style={[styles.sectionTitle, styles.assignedSectionTitle]}>決定したシフト</Text>
                  {currentDayAssigned.length === 0 && <Text style={styles.shiftEmptyText}>追加されていません</Text>}
                  {currentDayAssigned.map((s, i) => (
                    <View key={i} style={styles.assignedCard}>
                      <View style={styles.assignedCardContent}>
                        <Text style={styles.assignedName}>{s.name}</Text>
                        <View style={styles.assignedTimeRow}>
                          <TouchableOpacity onPress={() => openTimeEditor(s.name, s.start, s.end)} activeOpacity={0.7}>
                            <View style={styles.assignedTimePills}>
                              <Text style={[styles.assignedTime, styles.assignedStartTime]}>{s.start}</Text>
                              <Text style={styles.assignedTimeTilde}>〜</Text>
                              <Text style={[styles.assignedTime, styles.assignedEndTime]}>{s.end}</Text>
                            </View>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.saveCandidateBtn}
                            onPress={() => saveStaffTimeCandidate(`${s.start}-${s.end}`)}
                            activeOpacity={0.75}
                          >
                            <Text style={styles.saveCandidateText}>この時刻を保存</Text>
                          </TouchableOpacity>
                        </View>
                        {timePickerVisible && editingStaffName === s.name && (
                          <View style={styles.inlineTimeEditor}>
                            <View style={styles.drumPickerRow}>
                              <View style={styles.shiftTimeGroup}>
                                <Text style={styles.shiftTimeGroupTitle}>開始</Text>
                                <View style={styles.shiftTimePair}>
                                  <ShiftTimeWheel values={HOURS} value={newStartHour} visible={timePickerVisible} onChange={(hour) => { setNewStartHour(hour); setTempStart(`${String(hour).padStart(2, '0')}:${String(newStartMinute).padStart(2, '0')}`); }} />
                                  <Text style={styles.drumColon}>:</Text>
                                  <ShiftTimeWheel values={MINUTES} value={newStartMinute} visible={timePickerVisible} onChange={(minute) => { setNewStartMinute(minute); setTempStart(`${String(newStartHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`); }} />
                                </View>
                              </View>
                              <Text style={styles.drumTilde}>〜</Text>
                              <View style={styles.shiftTimeGroup}>
                                <Text style={styles.shiftTimeGroupTitle}>終了</Text>
                                <View style={styles.shiftTimePair}>
                                  <ShiftTimeWheel values={HOURS} value={newEndHour} visible={timePickerVisible} onChange={(hour) => { setNewEndHour(hour); setTempEnd(`${String(hour).padStart(2, '0')}:${String(newEndMinute).padStart(2, '0')}`); }} />
                                  <Text style={styles.drumColon}>:</Text>
                                  <ShiftTimeWheel values={MINUTES} value={newEndMinute} visible={timePickerVisible} onChange={(minute) => { setNewEndMinute(minute); setTempEnd(`${String(newEndHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`); }} />
                                </View>
                              </View>
                            </View>
                            <View style={styles.inlineTimeActions}>
                              <TouchableOpacity style={styles.inlineTimeCancel} onPress={() => setTimePickerVisible(false)}><Text style={styles.inlineTimeCancelText}>閉じる</Text></TouchableOpacity>
                              <TouchableOpacity style={styles.inlineTimeConfirm} onPress={saveTimeEdit}><Text style={styles.inlineTimeConfirmText}>変更を確定</Text></TouchableOpacity>
                            </View>
                          </View>
                        )}
                        <View style={styles.assignedCandidateRow}>
                          {masterTimes.map(candidate => (
                            <TouchableOpacity
                              key={`${s.name}-${candidate}`}
                              style={[
                                styles.assignedCandidateBtn,
                                `${s.start}-${s.end}` === candidate && styles.assignedCandidateBtnActive,
                              ]}
                              onPress={() => applyStaffTimeCandidate(s.name, candidate)}
                              activeOpacity={0.75}
                            >
                              <Text style={[
                                styles.assignedCandidateText,
                                `${s.start}-${s.end}` === candidate && styles.assignedCandidateTextActive,
                              ]}>{candidate}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                      <TouchableOpacity style={styles.assignedDeleteBtn} onPress={() => removeStaffFromShift(s.name)}>
                        <Ionicons name="trash" size={16} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>

                <View style={styles.shiftStaffPane}>
                  <View style={styles.staffPaneHeader}>
                    <Text style={[styles.sectionTitle, styles.staffPaneTitle]}>スタッフ</Text>
                  </View>

                  <Text style={styles.staffGroupLabel}>出勤可能</Text>
                  {availableStaff.map((s, i) => {
                    const isAssigned = currentDayAssigned.some(a => a.name === s.name);
                    return (
                      <TouchableOpacity key={`available-${i}`} style={styles.staffRow} onPress={() => !isAssigned && addStaffToShift(s.name, false)} activeOpacity={isAssigned ? 1 : 0.6}>
                        <Text style={styles.staffName}>{s.name}</Text>
                        {isAssigned ? (
                          <TouchableOpacity style={styles.removeBtn} onPress={() => removeStaffFromShift(s.name)}><Text style={styles.removeBtnText}>外す</Text></TouchableOpacity>
                        ) : (
                          <View style={styles.addBtn}><Text style={styles.addBtnText}>追加</Text></View>
                        )}
                      </TouchableOpacity>
                    );
                  })}

                  <Text style={[styles.staffGroupLabel, styles.unavailableGroupLabel]}>出勤不可</Text>
                  {unavailableStaff.map((s, i) => {
                    const isAssigned = currentDayAssigned.some(a => a.name === s.name);
                    return (
                      <TouchableOpacity key={`unavailable-${i}`} style={[styles.staffRow, styles.unavailableStaffRow]} onPress={() => !isAssigned && addStaffToShift(s.name, true)} activeOpacity={isAssigned ? 1 : 0.6}>
                        <Text style={[styles.staffName, styles.unavailableStaffName]}>{s.name} ({s.type})</Text>
                        {isAssigned ? (
                          <TouchableOpacity style={styles.removeBtn} onPress={() => removeStaffFromShift(s.name)}><Text style={styles.removeBtnText}>外す</Text></TouchableOpacity>
                        ) : (
                          <View style={[styles.addBtn, styles.unavailableAddBtn]}><Text style={styles.addBtnText}>追加</Text></View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={{height: 40}} />
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.saveBtn} onPress={saveDayShift}><Text style={styles.saveBtnText}>保存して閉じる</Text></TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* --- 時間変更＆候補追加モーダル --- */}
      <Modal visible={false} transparent animationType="slide">
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>{editingStaffName} の勤務時間</Text>

            {/* 開始/終了切り替えタブ */}
            <View style={styles.timeTargetRow}>
              <TouchableOpacity style={[styles.timeTargetBtn, timeSelectTarget === 'start' && styles.timeTargetBtnActive]} onPress={() => setTimeSelectTarget('start')}>
                <Text style={styles.timeTargetLabel}>開始時間</Text>
                <Text style={[styles.timeTargetValue, timeSelectTarget === 'start' && styles.timeTargetValueActive]}>{tempStart}</Text>
              </TouchableOpacity>
              <Text style={{fontSize:24, fontWeight:'bold', color:COLORS.textLight, marginHorizontal:8}}>〜</Text>
              <TouchableOpacity style={[styles.timeTargetBtn, timeSelectTarget === 'end' && styles.timeTargetBtnActive]} onPress={() => setTimeSelectTarget('end')}>
                <Text style={styles.timeTargetLabel}>終了時間</Text>
                <Text style={[styles.timeTargetValue, timeSelectTarget === 'end' && styles.timeTargetValueActive]}>{tempEnd}</Text>
              </TouchableOpacity>
            </View>

            {/* 候補ボタン（大きく、見やすく） */}
            {masterTimes.length > 0 && (
              <View style={{ marginBottom: 12 }}>
                <Text style={styles.addTimeTitle}>候補から選ぶ（長押しで削除）</Text>
                <View style={styles.masterTimesGrid}>
                  {masterTimes.map(t => (
                    <View key={t} style={{ position: 'relative' }}>
                      <TouchableOpacity
                        style={styles.masterTimeBtn}
                        onPress={() => handleMasterTimeSelect(t)}
                        onLongPress={() => {
                          const newTimes = masterTimes.filter(x => x !== t);
                          setMasterTimes(newTimes);
                          setDoc(doc(db, 'settings', 'master_data'), { workTimes: newTimes }, { merge: true });
                        }}
                        delayLongPress={500}
                      >
                        <Text style={styles.masterTimeText}>{t}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#fff', borderRadius: 8, zIndex: 1 }}
                        onPress={() => {
                          const newTimes = masterTimes.filter(x => x !== t);
                          setMasterTimes(newTimes);
                          setDoc(doc(db, 'settings', 'master_data'), { workTimes: newTimes }, { merge: true });
                        }}
                      >
                        <Ionicons name="close-circle" size={16} color="#E53935" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* スクロール式時間ピッカー */}
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.addTimeTitle}>時間を直接選ぶ</Text>
              <View style={styles.drumPickerRow}>
                <View style={styles.shiftTimeGroup}>
                  <Text style={styles.shiftTimeGroupTitle}>開始</Text>
                  <View style={styles.shiftTimePair}>
                    <ShiftTimeWheel
                      values={HOURS}
                      value={newStartHour}
                      visible={timePickerVisible}
                      onChange={(hour) => {
                        setNewStartHour(hour);
                        setTempStart(`${String(hour).padStart(2, '0')}:${String(newStartMinute).padStart(2, '0')}`);
                      }}
                    />
                    <Text style={styles.drumColon}>:</Text>
                    <ShiftTimeWheel
                      values={MINUTES}
                      value={newStartMinute}
                      visible={timePickerVisible}
                      onChange={(minute) => {
                        setNewStartMinute(minute);
                        setTempStart(`${String(newStartHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
                      }}
                    />
                  </View>
                </View>
                <Text style={styles.drumTilde}>〜</Text>
                <View style={styles.shiftTimeGroup}>
                  <Text style={styles.shiftTimeGroupTitle}>終了</Text>
                  <View style={styles.shiftTimePair}>
                    <ShiftTimeWheel
                      values={HOURS}
                      value={newEndHour}
                      visible={timePickerVisible}
                      onChange={(hour) => {
                        setNewEndHour(hour);
                        setTempEnd(`${String(hour).padStart(2, '0')}:${String(newEndMinute).padStart(2, '0')}`);
                      }}
                    />
                    <Text style={styles.drumColon}>:</Text>
                    <ShiftTimeWheel
                      values={MINUTES}
                      value={newEndMinute}
                      visible={timePickerVisible}
                      onChange={(minute) => {
                        setNewEndMinute(minute);
                        setTempEnd(`${String(newEndHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
                      }}
                    />
                  </View>
                </View>
              </View>
              <TouchableOpacity style={styles.addOptionSubmit} onPress={handleAddMasterTime}>
                <Ionicons name="bookmark-outline" size={16} color={COLORS.primary} />
                <Text style={styles.addOptionSubmitText}>この時間を候補に保存</Text>
              </TouchableOpacity>
            </View>

            <View style={{flexDirection:'row', gap: 12, marginTop: 8}}>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: '#CCC'}]} onPress={()=>setTimePickerVisible(false)}><Text style={{fontWeight:'bold'}}>キャンセル</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: COLORS.primary}]} onPress={saveTimeEdit}><Text style={{color: COLORS.white, fontWeight:'bold'}}>変更を確定</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={monthActionConfirm !== null} transparent animationType="fade">
        <TouchableOpacity
          style={styles.monthConfirmOverlay}
          activeOpacity={1}
          onPress={() => setMonthActionConfirm(null)}
        >
          {monthActionConfirm === 'autoFill' ? (
          <TouchableOpacity style={styles.monthAutoReviewPanel} activeOpacity={1} onPress={event => event.stopPropagation()}>
            <View style={styles.monthAutoReviewHeader}>
              <View style={styles.monthAutoReviewHeading}>
                <Text style={styles.monthAutoReviewTitle}>自動入力の設定確認</Text>
                <Text style={styles.monthAutoReviewMonth}>
                  {currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月
                </Text>
              </View>
              <View style={styles.monthAutoReviewTopActions}>
                <TouchableOpacity
                  style={styles.monthAutoReviewYesBtn}
                  onPress={async () => {
                    setMonthActionConfirm(null);
                    await autoFillCurrentMonth();
                  }}
                >
                  <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                  <Text style={styles.monthAutoReviewYesText}>はい</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.monthAutoReviewCloseBtn} onPress={() => setMonthActionConfirm(null)}>
                  <Text style={styles.monthAutoReviewCloseText}>閉じる</Text>
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView style={styles.monthAutoReviewScroll} contentContainerStyle={styles.monthAutoReviewScrollContent}>
              <Text style={styles.monthAutoReviewHelp}>
                内容を確認・編集してから「はい」を押してください。変更した設定は自動で保存されます。
              </Text>

              <Text style={styles.monthAutoReviewSectionTitle}>曜日別の入力人数</Text>
              <View style={styles.monthAutoReviewSection}>
                {(['月','火','水','木','金'] as const).map(dow => (
                  <View key={dow} style={styles.settingRow}>
                    <Text style={styles.settingLabel}>{dow}曜日</Text>
                    <View style={{ flexDirection:'row', gap:6 }}>
                      {[1,2,3,4,5].map(n => (
                        <TouchableOpacity
                          key={n}
                          style={[styles.settingNumBtn, autoFillSettings.dayMaxCount[dow] === n && styles.settingNumBtnActive]}
                          onPress={() => saveAutoFillSettings({
                            ...autoFillSettings,
                            dayMaxCount: { ...autoFillSettings.dayMaxCount, [dow]: n },
                          })}
                        >
                          <Text style={[styles.settingNumText, autoFillSettings.dayMaxCount[dow] === n && { color:'#fff' }]}>{n}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))}
              </View>

              <Text style={styles.monthAutoReviewSectionTitle}>スタッフ別の優先順位・時間</Text>
              <Text style={styles.monthAutoReviewSectionNote}>上下ボタンで優先順位、ON/OFFで自動入力の対象を変更できます。</Text>
              <View style={styles.monthAutoReviewSection}>
                {autoFillSettings.staffSettings.map((s, idx) => (
                  <View key={s.name} style={styles.settingStaffRow}>
                    <View style={{ flexDirection:'column', gap:2, marginRight:6 }}>
                      <TouchableOpacity
                        style={[styles.settingArrowBtn, idx === 0 && { opacity:0.3 }]}
                        disabled={idx === 0}
                        onPress={() => {
                          const arr = [...autoFillSettings.staffSettings];
                          [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
                          arr.forEach((item, itemIndex) => item.priority = itemIndex + 1);
                          saveAutoFillSettings({ ...autoFillSettings, staffSettings: arr });
                        }}
                      ><Ionicons name="chevron-up" size={14} color="#555" /></TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.settingArrowBtn, idx === autoFillSettings.staffSettings.length - 1 && { opacity:0.3 }]}
                        disabled={idx === autoFillSettings.staffSettings.length - 1}
                        onPress={() => {
                          const arr = [...autoFillSettings.staffSettings];
                          [arr[idx], arr[idx+1]] = [arr[idx+1], arr[idx]];
                          arr.forEach((item, itemIndex) => item.priority = itemIndex + 1);
                          saveAutoFillSettings({ ...autoFillSettings, staffSettings: arr });
                        }}
                      ><Ionicons name="chevron-down" size={14} color="#555" /></TouchableOpacity>
                    </View>
                    <Text style={styles.settingPriority}>{idx + 1}</Text>
                    <TouchableOpacity
                      style={[styles.settingEnabledBtn, s.enabled && styles.settingEnabledBtnOn]}
                      onPress={() => {
                        const arr = autoFillSettings.staffSettings.map((item, itemIndex) =>
                          itemIndex === idx ? { ...item, enabled: !item.enabled } : item
                        );
                        saveAutoFillSettings({ ...autoFillSettings, staffSettings: arr });
                      }}
                    >
                      <Text style={{ fontSize:10, color: s.enabled ? '#fff' : '#777', fontWeight:'bold' }}>{s.enabled ? 'ON' : 'OFF'}</Text>
                    </TouchableOpacity>
                    <Text style={styles.settingStaffName}>{s.name}</Text>
                    <View style={styles.monthAutoReviewTimes}>
                      <Text style={styles.settingTimeLabel}>開始</Text>
                      <TouchableOpacity style={styles.settingTimeInput} onPress={() => openSettingTimePicker(idx, 'start')}>
                        <Text style={styles.settingTimeValue}>{s.start}</Text>
                      </TouchableOpacity>
                      <Text style={styles.settingTimeLabel}>終了</Text>
                      <TouchableOpacity style={styles.settingTimeInput} onPress={() => openSettingTimePicker(idx, 'end')}>
                        <Text style={styles.settingTimeValue}>{s.end}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
          </TouchableOpacity>
          ) : (
          <TouchableOpacity
            style={styles.monthConfirmPanel}
            activeOpacity={1}
            onPress={event => event.stopPropagation()}
          >
            <View style={[
              styles.monthConfirmIcon,
              monthActionConfirm === 'delete' ? styles.monthConfirmDeleteIcon : styles.monthConfirmAutoIcon,
            ]}>
              <Ionicons
                name={monthActionConfirm === 'delete' ? 'trash-outline' : 'pencil-outline'}
                size={25}
                color={monthActionConfirm === 'delete' ? '#B93E48' : '#247A82'}
              />
            </View>
            <Text style={styles.monthConfirmTitle}>
              シフトを削除しますか？
            </Text>
            <Text style={styles.monthConfirmMonth}>
              {currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月
            </Text>
            <Text style={styles.monthConfirmDescription}>
              この月に作成されているシフトをすべて削除します。削除後は元に戻せません。
            </Text>
            <View style={styles.monthConfirmActions}>
              <TouchableOpacity style={styles.monthConfirmCancelBtn} onPress={() => setMonthActionConfirm(null)}>
                <Text style={styles.monthConfirmCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={monthActionConfirm === 'delete' ? styles.monthConfirmDeleteBtn : styles.monthConfirmExecuteBtn}
                onPress={async () => {
                  const action = monthActionConfirm;
                  setMonthActionConfirm(null);
                  if (action === 'delete') await deleteCurrentMonthShifts();
                }}
              >
                <Text style={styles.monthConfirmExecuteText}>
                  削除する
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
          )}
        </TouchableOpacity>
      </Modal>

      {/* ── 設定モーダル ── */}
      <Modal visible={settingsVisible} animationType="slide" transparent>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' }}>
          <View style={{ backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, maxHeight:'90%' }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, borderBottomWidth:1, borderColor:'#eee' }}>
              <Text style={{ fontSize:17, fontWeight:'bold', color:'#333' }}>⚙ 自動入力設定</Text>
              <TouchableOpacity onPress={() => setSettingsVisible(false)}>
                <Ionicons name="close" size={26} color="#333" />
              </TouchableOpacity>
            </View>
            {/* タブ */}
            <View style={{ flexDirection:'row', borderBottomWidth:1, borderColor:'#eee' }}>
              <TouchableOpacity
                style={{ flex:1, paddingVertical:12, alignItems:'center', borderBottomWidth:2, borderBottomColor: settingsTab==='dow' ? '#5B9BD5' : 'transparent' }}
                onPress={() => setSettingsTab('dow')}
              >
                <Text style={{ fontWeight:'bold', color: settingsTab==='dow' ? '#5B9BD5' : '#888' }}>曜日別設定</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex:1, paddingVertical:12, alignItems:'center', borderBottomWidth:2, borderBottomColor: settingsTab==='staff' ? '#5B9BD5' : 'transparent' }}
                onPress={() => setSettingsTab('staff')}
              >
                <Text style={{ fontWeight:'bold', color: settingsTab==='staff' ? '#5B9BD5' : '#888' }}>スタッフ別設定</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex:1, paddingVertical:12, alignItems:'center', borderBottomWidth:2, borderBottomColor: settingsTab==='order' ? '#5B9BD5' : 'transparent' }}
                onPress={() => {
                  if (pdfOrder.length === 0) setPdfOrder(allStaff.map(s => s.name));
                  setSettingsTab('order');
                }}
              >
                <Text style={{ fontWeight:'bold', color: settingsTab==='order' ? '#5B9BD5' : '#888' }}>表示順設定</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ padding:16 }}>

              {settingsTab === 'dow' && <>
              {/* 曜日別最大人数 */}
              <Text style={styles.settingSectionTitle}>曜日別 最大入力人数（稲熊除く）</Text>
              {(['月','火','水','木','金'] as const).map(dow => (
                <View key={dow} style={styles.settingRow}>
                  <Text style={styles.settingLabel}>{dow}曜日</Text>
                  <View style={{ flexDirection:'row', gap:6 }}>
                    {[1,2,3,4,5].map(n => (
                      <TouchableOpacity
                        key={n}
                        style={[styles.settingNumBtn, autoFillSettings.dayMaxCount[dow] === n && styles.settingNumBtnActive]}
                        onPress={() => saveAutoFillSettings({ ...autoFillSettings, dayMaxCount: { ...autoFillSettings.dayMaxCount, [dow]: n } })}
                      >
                        <Text style={[styles.settingNumText, autoFillSettings.dayMaxCount[dow] === n && { color:'#fff' }]}>{n}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}

              </>}

              {settingsTab === 'staff' && <>
              {/* スタッフ別設定 */}
              <Text style={styles.settingSectionTitle}>スタッフ別設定（優先順位・時間）</Text>
              <Text style={{ fontSize:11, color:'#888', marginBottom:8 }}>↑↓で優先順位を変更、ON/OFFで対象外に</Text>
              {autoFillSettings.staffSettings.map((s, idx) => (
                <View key={s.name} style={styles.settingStaffRow}>
                  <View style={{ flexDirection:'column', gap:2, marginRight:6 }}>
                    <TouchableOpacity
                      style={[styles.settingArrowBtn, idx === 0 && { opacity:0.3 }]}
                      disabled={idx === 0}
                      onPress={() => {
                        const arr = [...autoFillSettings.staffSettings];
                        [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
                        arr.forEach((x,i) => x.priority = i+1);
                        saveAutoFillSettings({ ...autoFillSettings, staffSettings: arr });
                      }}
                    ><Ionicons name="chevron-up" size={14} color="#555" /></TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.settingArrowBtn, idx === autoFillSettings.staffSettings.length-1 && { opacity:0.3 }]}
                      disabled={idx === autoFillSettings.staffSettings.length-1}
                      onPress={() => {
                        const arr = [...autoFillSettings.staffSettings];
                        [arr[idx], arr[idx+1]] = [arr[idx+1], arr[idx]];
                        arr.forEach((x,i) => x.priority = i+1);
                        saveAutoFillSettings({ ...autoFillSettings, staffSettings: arr });
                      }}
                    ><Ionicons name="chevron-down" size={14} color="#555" /></TouchableOpacity>
                  </View>
                  <Text style={styles.settingPriority}>{idx+1}</Text>
                  <TouchableOpacity
                    style={[styles.settingEnabledBtn, s.enabled && styles.settingEnabledBtnOn]}
                    onPress={() => {
                      const arr = autoFillSettings.staffSettings.map((x,i) => i===idx ? {...x, enabled:!x.enabled} : x);
                      saveAutoFillSettings({ ...autoFillSettings, staffSettings: arr });
                    }}
                  >
                    <Text style={{ fontSize:10, color: s.enabled ? '#fff' : '#999', fontWeight:'bold' }}>{s.enabled ? 'ON' : 'OFF'}</Text>
                  </TouchableOpacity>
                  <Text style={styles.settingStaffName}>{s.name}</Text>
                  <View style={{ flex:1 }}>
                    <View style={{ flexDirection:'row', gap:4, alignItems:'center' }}>
                      <Text style={styles.settingTimeLabel}>開始</Text>
                      <TouchableOpacity
                        style={styles.settingTimeInput}
                        onPress={() => openSettingTimePicker(idx, 'start')}
                      >
                        <Text style={styles.settingTimeValue}>{s.start}</Text>
                      </TouchableOpacity>
                      <Text style={styles.settingTimeLabel}>終了</Text>
                      <TouchableOpacity
                        style={styles.settingTimeInput}
                        onPress={() => openSettingTimePicker(idx, 'end')}
                      >
                        <Text style={styles.settingTimeValue}>{s.end}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))}
              {/* 保存ボタン */}
              <TouchableOpacity
                style={{ backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8, marginBottom: 4 }}
                onPress={() => {
                  saveAutoFillSettings(autoFillSettings);
                  Alert.alert('保存完了', 'スタッフ設定を保存しました');
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 15 }}>設定を保存する</Text>
              </TouchableOpacity>
              </>}

              {settingsTab === 'order' && <>
              <Text style={styles.settingSectionTitle}>PDF・シフト表 表示順</Text>
              <Text style={{ fontSize:11, color:'#888', marginBottom:12 }}>↑↓でPDF出力時のスタッフ行の並び順を変更</Text>
              {pdfOrder.map((name, idx) => (
                <View key={name} style={{ flexDirection:'row', alignItems:'center', backgroundColor:'#F8F8F8', borderRadius:10, padding:12, marginBottom:6, borderWidth:1, borderColor:'#EEE' }}>
                  <View style={{ flexDirection:'column', gap:2, marginRight:10 }}>
                    <TouchableOpacity
                      style={[styles.settingArrowBtn, idx === 0 && { opacity:0.3 }]}
                      disabled={idx === 0}
                      onPress={() => {
                        const arr = [...pdfOrder];
                        [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
                        setPdfOrder(arr);
                        saveAutoFillSettings({ ...autoFillSettings, pdfOrder: arr });
                      }}
                    ><Ionicons name="chevron-up" size={14} color="#555" /></TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.settingArrowBtn, idx === pdfOrder.length-1 && { opacity:0.3 }]}
                      disabled={idx === pdfOrder.length-1}
                      onPress={() => {
                        const arr = [...pdfOrder];
                        [arr[idx], arr[idx+1]] = [arr[idx+1], arr[idx]];
                        setPdfOrder(arr);
                        saveAutoFillSettings({ ...autoFillSettings, pdfOrder: arr });
                      }}
                    ><Ionicons name="chevron-down" size={14} color="#555" /></TouchableOpacity>
                  </View>
                  <Text style={{ fontSize:14, fontWeight:'bold', color:'#333', flex:1 }}>{idx+1}. {name}</Text>
                </View>
              ))}
              <TouchableOpacity
                style={{ backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 }}
                onPress={() => {
                  saveAutoFillSettings({ ...autoFillSettings, pdfOrder });
                  Alert.alert('保存完了', '表示順を保存しました');
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 15 }}>表示順を保存する</Text>
              </TouchableOpacity>
              </>}
              <View style={{ height:40 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={!!settingTimeTarget} transparent animationType="fade">
        <View style={styles.pickerOverlay}>
          <View style={[styles.pickerContent, styles.settingTimePickerPanel]}>
            <View style={styles.settingTimePickerHeader}>
              <View>
                <Text style={styles.settingTimePickerTitle}>
                  {settingTimeTarget ? autoFillSettings.staffSettings[settingTimeTarget.staffIndex]?.name : ''}
                </Text>
                <Text style={styles.settingTimePickerSub}>
                  {settingTimeTarget?.field === 'start' ? '開始時間を選択' : '終了時間を選択'}
                </Text>
              </View>
              <TouchableOpacity style={styles.settingTimePickerClose} onPress={() => setSettingTimeTarget(null)}>
                <Ionicons name="close" size={24} color="#333333" />
              </TouchableOpacity>
            </View>

            <View style={styles.settingTimeWheelRow} nativeID="ui-time-wheel-auto-fill-setting">
              <ShiftTimeWheel
                values={HOURS}
                value={settingTimeHour}
                visible={!!settingTimeTarget}
                onChange={setSettingTimeHour}
              />
              <Text style={styles.drumColon}>:</Text>
              <ShiftTimeWheel
                values={MINUTES}
                value={settingTimeMinute}
                visible={!!settingTimeTarget}
                onChange={setSettingTimeMinute}
              />
            </View>

            <View style={styles.settingTimePickerActions}>
              <TouchableOpacity style={styles.settingTimeCancelBtn} onPress={() => setSettingTimeTarget(null)}>
                <Text style={styles.settingTimeCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.settingTimeSaveBtn} onPress={saveSettingTime}>
                <Text style={styles.settingTimeSaveText}>この時刻に設定</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {!embedded && <AdminBottomNav active="shift" />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#FFF8F0', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 8 },
  pdfBtnText: { color: COLORS.white, fontWeight: 'bold', marginLeft: 3, fontSize: 11 },
  headerPdfBtn: { minHeight: 40, paddingHorizontal: 10, backgroundColor: '#00AEB8' },
  submissionStatusBtn: { minHeight: 40, paddingHorizontal: 8, backgroundColor: '#6C8795' },
  headerAutoFillBtn: { minHeight: 40, paddingHorizontal: 13, backgroundColor: '#36A9B5' },
  submissionStatusOverlay: { flex: 1, backgroundColor: 'rgba(35, 28, 24, 0.48)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  submissionStatusPanel: { width: '100%', maxWidth: 430, maxHeight: '82%', borderRadius: 18, overflow: 'hidden', backgroundColor: '#FFFFFF', shadowColor: '#000000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 12 },
  submissionStatusHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 15, backgroundColor: '#FFF8F0', borderBottomWidth: 1, borderBottomColor: '#E9DDD5' },
  submissionStatusTitle: { fontSize: 18, fontWeight: '900', color: '#3B302B' },
  submissionStatusMonth: { marginTop: 3, fontSize: 13, fontWeight: '800', color: '#76665E' },
  submissionStatusClose: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF0E2' },
  submissionStatusSummary: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, backgroundColor: '#FAFCFC', borderBottomWidth: 1, borderBottomColor: '#E8EEEE' },
  submissionStatusSummaryText: { fontSize: 13, fontWeight: '900', color: '#4B5A5D' },
  submissionStatusScroll: { flexGrow: 0 },
  submissionStatusScrollContent: { paddingHorizontal: 14, paddingVertical: 8 },
  submissionStatusRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: '#EEF1F1' },
  submissionStatusStaffName: { flex: 1, fontSize: 16, fontWeight: '800', color: '#252525' },
  submissionStatusBadge: { minWidth: 94, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16 },
  submissionStatusSubmitted: { backgroundColor: '#E7F6EA' },
  submissionStatusMissing: { backgroundColor: '#FFF1E7' },
  submissionStatusBadgeText: { fontSize: 13, fontWeight: '900' },
  submissionStatusSubmittedText: { color: '#278A4A' },
  submissionStatusMissingText: { color: '#B06A33' },
  submissionStatusEmpty: { padding: 24, textAlign: 'center', color: '#8A9698', fontWeight: '700' },
  workSummaryControls: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, backgroundColor: '#FFFDFB', borderBottomWidth: 1, borderColor: '#EEE7E3' },
  workSummaryTabs: { flexDirection: 'row', alignSelf: 'center', width: '100%', maxWidth: 320, padding: 4, borderRadius: 12, backgroundColor: '#F0ECE9' },
  workSummaryTab: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  workSummaryTabActive: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#C7B6AC', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  workSummaryTabText: { fontSize: 14, fontWeight: '800', color: '#8A7A72' },
  workSummaryTabTextActive: { color: '#5D4037', fontWeight: '900' },
  workSummaryPeriodNav: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  workSummaryPeriodBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF8F0', borderWidth: 1, borderColor: '#E1CDBD' },
  workSummaryPeriodText: { minWidth: 130, textAlign: 'center', fontSize: 16, fontWeight: '900', color: '#3F302B' },
  
  monthSelector: { paddingHorizontal: 16, paddingVertical: 16, gap: 10 },
  monthNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  monthText: { fontSize: 20, fontWeight: 'bold', marginHorizontal: 16 },

  monthActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  toggleTimeBtn: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#E0FFFF', paddingHorizontal: 9, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: '#AFEEEE' },
  toggleTimeText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 12 },
  monthAutoFillBtn: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 10, borderRadius: 18, backgroundColor: '#36A9B5', borderWidth: 1, borderColor: '#258C96' },
  monthDeleteBtn: { minHeight: 36, marginLeft: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 10, borderRadius: 18, backgroundColor: '#FFF3F3', borderWidth: 1, borderColor: '#E7A6AC' },
  monthActionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  monthDeleteText: { color: '#B93E48', fontSize: 12, fontWeight: '900' },
  monthConfirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.48)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  monthConfirmPanel: { width: '100%', maxWidth: 390, borderRadius: 18, padding: 20, alignItems: 'center', backgroundColor: '#FFFFFF', shadowColor: '#000000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 12 },
  monthConfirmIcon: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginBottom: 11, borderWidth: 1 },
  monthConfirmAutoIcon: { backgroundColor: '#EAF8F8', borderColor: '#A7D8DC' },
  monthConfirmDeleteIcon: { backgroundColor: '#FFF0F1', borderColor: '#EDB5BA' },
  monthConfirmTitle: { fontSize: 18, fontWeight: '900', color: '#222222', textAlign: 'center' },
  monthConfirmMonth: { marginTop: 5, fontSize: 14, fontWeight: '900', color: '#444444' },
  monthConfirmDescription: { marginTop: 10, fontSize: 12, lineHeight: 19, fontWeight: '700', color: '#657174', textAlign: 'center' },
  monthConfirmActions: { width: '100%', flexDirection: 'row', gap: 9, marginTop: 18 },
  monthConfirmCancelBtn: { flex: 1, minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F3F4', borderWidth: 1, borderColor: '#D9DEDF' },
  monthConfirmCancelText: { fontSize: 13, fontWeight: '900', color: '#555555' },
  monthConfirmExecuteBtn: { flex: 1.35, minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#36A9B5' },
  monthConfirmDeleteBtn: { flex: 1.35, minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#D9535F' },
  monthConfirmExecuteText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
  monthAutoReviewPanel: { width: '100%', maxWidth: 720, maxHeight: '90%', borderRadius: 18, overflow: 'hidden', backgroundColor: '#FFFFFF', shadowColor: '#000000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 12 },
  monthAutoReviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E6ECEC', backgroundColor: '#FAFCFC' },
  monthAutoReviewHeading: { flex: 1 },
  monthAutoReviewTitle: { fontSize: 18, fontWeight: '900', color: '#222222' },
  monthAutoReviewMonth: { marginTop: 3, fontSize: 12, fontWeight: '800', color: '#657174' },
  monthAutoReviewTopActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  monthAutoReviewYesBtn: { minWidth: 82, minHeight: 42, paddingHorizontal: 16, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#29A6B2' },
  monthAutoReviewYesText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  monthAutoReviewCloseBtn: { minWidth: 82, minHeight: 42, paddingHorizontal: 15, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F3F4', borderWidth: 1, borderColor: '#D9DEDF' },
  monthAutoReviewCloseText: { fontSize: 14, fontWeight: '900', color: '#444444' },
  monthAutoReviewScroll: { flexGrow: 0 },
  monthAutoReviewScrollContent: { padding: 16, paddingBottom: 24 },
  monthAutoReviewHelp: { marginBottom: 15, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9, fontSize: 12, lineHeight: 18, fontWeight: '700', color: '#42575A', backgroundColor: '#EAF7F7' },
  monthAutoReviewSectionTitle: { marginTop: 2, marginBottom: 8, fontSize: 15, fontWeight: '900', color: '#272727' },
  monthAutoReviewSectionNote: { marginTop: -3, marginBottom: 8, fontSize: 11, lineHeight: 17, fontWeight: '700', color: '#717A7C' },
  monthAutoReviewSection: { marginBottom: 16 },
  monthAutoReviewTimes: { flex: 1, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'flex-end' },

  calendarScroll: { flex: 1 },
  calendarContent: { width: '100%', paddingHorizontal: 0, paddingBottom: 100 },
  calHeaderRow: { flexDirection: 'row', marginBottom: 4, paddingHorizontal: 2 },
  calWeekText: { width: '14.2%', textAlign: 'center', fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  
  calCellEmpty: { width: '14.28%', minHeight: 112 },
  calCell: { width: '14.28%', minHeight: 126, borderWidth: 0.5, borderColor: COLORS.border, paddingHorizontal: 2, paddingVertical: 5, backgroundColor: COLORS.white },
  
  cellTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  calDayText: { fontSize: 17, fontWeight: 'bold' },
  availableCountText: { fontSize: 11, color: COLORS.textLight, marginBottom: 1, fontWeight: '700' },
  cellCountText: { fontSize: 13, color: '#007A82', fontWeight: '900' },
  
  cellStaffRow: { marginBottom: 1, paddingHorizontal: 4, paddingVertical: 4, minHeight: 43 },
  cellStaffRowCompact: { minHeight: 25, paddingVertical: 4 },
  cellStaffName: { fontSize: 13, fontWeight: '900', color: '#171717', lineHeight: 16 },
  cellStaffTimeRow: { marginTop: 1 },
  cellStaffTime: { fontSize: 11, lineHeight: 14, fontWeight: '700', color: '#171717' },
  
  eventBadge: { alignSelf: 'stretch', marginTop: 3, marginHorizontal: -2, paddingHorizontal: 4, paddingVertical: 2, backgroundColor: '#FFF1C9' },
  eventBadgeText: { fontSize: 11, lineHeight: 14, color: '#6A4500', fontWeight: '900' },
  dayEventCard: { marginBottom: 18, padding: 14, borderRadius: 10, backgroundColor: '#FFF8DF', borderWidth: 1, borderColor: '#EBCB73' },
  dayEventTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 },
  dayEventLabel: { fontSize: 14, fontWeight: '900', color: '#6A4500' },
  dayEventTitle: { fontSize: 15, lineHeight: 22, fontWeight: '800', color: '#27211B' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 12 },
  modalContent: { backgroundColor: COLORS.white, height: '92%', width: '100%', maxWidth: 1200, borderRadius: 20, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderColor: COLORS.border, gap: 8 },
  modalTitle: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: 18, fontWeight: 'bold' },
  modalHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalDateNavBtn: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, borderRadius: 10, backgroundColor: '#FFF8EB' },
  modalDateNavText: { fontSize: 13, fontWeight: '800', color: COLORS.text },
  modalCloseBtn: { minWidth: 42, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', borderBottomWidth: 2, borderColor: COLORS.border, paddingBottom: 4, marginBottom: 12 },
  shiftEditorColumns: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, minWidth: 0 },
  shiftAssignedPane: { flex: 2.35, minWidth: 0 },
  shiftStaffPane: { flex: 0.75, minWidth: 150, paddingLeft: 10, borderLeftWidth: 1, borderColor: '#E5E7EB' },
  assignedSectionTitle: { borderColor: COLORS.accent, marginBottom: 8 },
  shiftEmptyText: { color: COLORS.textLight, fontStyle: 'italic', marginBottom: 16 },
  assignedHint: { fontSize: 10, color: COLORS.textLight, marginTop: 2 },
  staffPaneHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 },
  staffPaneTitle: { color: COLORS.primary, marginBottom: 0, borderBottomWidth: 0 },
  staffGroupLabel: { fontSize: 12, fontWeight: '900', color: '#287C86', marginTop: 4, marginBottom: 2 },
  unavailableGroupLabel: { color: COLORS.danger, marginTop: 16 },
  unavailableStaffRow: { opacity: 0.62 },
  unavailableStaffName: { color: COLORS.danger },
  unavailableAddBtn: { backgroundColor: '#999999' },
  
  staffRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 5, paddingVertical: 7, borderBottomWidth: 1, borderColor: '#F0F0F0' },
  staffName: { fontSize: 14, fontWeight: 'bold', flex: 1, minWidth: 0 },
  addBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6, flexShrink: 0 },
  addBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 12 },
  removeBtn: { backgroundColor: '#FFF0F0', borderWidth: 1, borderColor: '#FFE0E0', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6, flexShrink: 0 },
  removeBtnText: { color: COLORS.danger, fontWeight: 'bold', fontSize: 12 },
  
  assignedCard: { backgroundColor: '#F0F8FF', padding: 16, borderRadius: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', minWidth: 0, width: '100%' },
  assignedCardContent: { flex: 1, minWidth: 0, marginRight: 10 },
  assignedName: { fontSize: 16, fontWeight: 'bold', color: COLORS.primary, marginBottom: 4 },
  assignedTimeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, minWidth: 0 },
  assignedTimePills: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 2 },
  assignedTime: { fontSize: 16, color: '#173E43', fontWeight: '900', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: '#BFE8E8' },
  assignedStartTime: { color: '#173E43' },
  assignedEndTime: { color: '#173E43' },
  assignedTimeTilde: { fontSize: 15, color: '#53666A', fontWeight: '900', marginHorizontal: 1 },
  saveCandidateBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: '#E6F7F7', borderWidth: 1, borderColor: COLORS.primary, flexShrink: 1 },
  saveCandidateText: { fontSize: 10, fontWeight: '800', color: COLORS.primary },
  assignedCandidateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7, width: '100%', maxWidth: '100%', minWidth: 0 },
  assignedCandidateBtn: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: COLORS.white, borderWidth: 1, borderColor: '#B8D9E8', flexShrink: 1 },
  assignedCandidateBtnActive: { backgroundColor: '#D9F1FB', borderColor: COLORS.primary },
  assignedCandidateText: { fontSize: 11, fontWeight: '800', color: '#46707F', flexShrink: 1 },
  assignedCandidateTextActive: { color: COLORS.primary },
  editTimeBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border },
  editTimeBtnText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 12, marginLeft: 4 },
  assignedDeleteBtn: { backgroundColor: '#FFF0F0', borderWidth: 1, borderColor: '#FFE0E0', padding: 8, borderRadius: 8, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  inlineTimeEditor: { marginTop: 10, padding: 6, borderRadius: 10, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#9ED6DC', width: '100%', maxWidth: '100%', minWidth: 0, alignSelf: 'stretch', overflow: 'hidden' },
  inlineTimeTilde: { fontSize: 18, fontWeight: '900', color: COLORS.textLight, marginHorizontal: 3 },
  inlineTimeActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  inlineTimeCancel: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#F1F2F2', alignItems: 'center' },
  inlineTimeCancelText: { color: COLORS.text, fontWeight: 'bold', fontSize: 12 },
  inlineTimeConfirm: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.primary, alignItems: 'center' },
  inlineTimeConfirmText: { color: COLORS.white, fontWeight: 'bold', fontSize: 12 },
  
  modalFooter: { padding: 20, borderTopWidth: 1, borderColor: COLORS.border },
  saveBtn: { backgroundColor: COLORS.primary, padding: 16, borderRadius: 12, alignItems: 'center' },
  saveBtnText: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  pickerContent: { width: '100%', maxWidth: 560, backgroundColor: COLORS.white, borderRadius: 16, padding: 18, maxHeight: '92%' },
  pickerTitle: { fontSize: 17, fontWeight: 'bold', textAlign: 'center', marginBottom: 14, color: COLORS.text },
  
  timeTargetRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: 14 },
  timeTargetBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderWidth: 2, borderColor: 'transparent', borderRadius: 12, backgroundColor: '#F5F5F5', marginHorizontal: 4 },
  timeTargetBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '10' },
  timeTargetLabel: { fontSize: 11, color: COLORS.textLight, fontWeight: 'bold', marginBottom: 2 },
  timeTargetValue: { fontSize: 22, fontWeight: 'bold', color: COLORS.text },
  timeTargetValueActive: { color: COLORS.primary },
  
  masterTimesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start', marginTop: 6 },
  masterTimeBtnWrap: { position: 'relative', flexDirection: 'row', alignItems: 'center' },
  masterTimeDeleteBtn: { marginLeft: -8, marginTop: -16, zIndex: 1 },
  masterTimeBtn: { backgroundColor: '#F0F8FF', borderWidth: 1.5, borderColor: COLORS.primary + '40', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center' },
  masterTimeText: { fontSize: 15, fontWeight: 'bold', color: COLORS.primary },
  drumPickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 0, width: '100%' },
  shiftTimeGroup: { flex: 1, maxWidth: 150, minWidth: 0, alignItems: 'center' },
  shiftTimeGroupTitle: { marginBottom: 5, fontSize: 12, fontWeight: '900', color: '#37474F' },
  shiftTimePair: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 0 },
  shiftWheelWrap: { position: 'relative', flex: 1, minWidth: 40, maxWidth: 58, height: SHIFT_WHEEL_VIEW_HEIGHT, overflow: 'hidden', borderRadius: 10, backgroundColor: '#FAFCFC', borderWidth: 1, borderColor: '#D6E1E2' },
  shiftWheelSelection: { position: 'absolute', left: 2, right: 2, top: (SHIFT_WHEEL_VIEW_HEIGHT - SHIFT_WHEEL_ITEM_HEIGHT) / 2, height: SHIFT_WHEEL_ITEM_HEIGHT, borderRadius: 8, backgroundColor: '#DFF5F4', borderWidth: 1.5, borderColor: '#65BEC2', zIndex: 0 },
  shiftWheelScroll: { height: SHIFT_WHEEL_VIEW_HEIGHT, zIndex: 1 },
  shiftWheelContent: { paddingVertical: (SHIFT_WHEEL_VIEW_HEIGHT - SHIFT_WHEEL_ITEM_HEIGHT) / 2 },
  shiftWheelItem: { height: SHIFT_WHEEL_ITEM_HEIGHT, marginHorizontal: 3, borderRadius: 8, backgroundColor: '#F1FAFA', alignItems: 'center', justifyContent: 'center' },
  shiftWheelItemActive: { backgroundColor: '#DFF5F4', borderWidth: 1.5, borderColor: '#65BEC2' },
  shiftWheelText: { fontSize: 16, fontWeight: '700', color: '#919A9C' },
  shiftWheelTextActive: { fontSize: 20, fontWeight: '900', color: '#172629' },
  drumColon: { width: 9, textAlign: 'center', fontSize: 21, fontWeight: '900', color: '#333333' },
  drumTilde: { width: 20, textAlign: 'center', fontSize: 17, fontWeight: '900', color: '#748083' },
  addTimeContainer: { marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderColor: COLORS.border, backgroundColor: '#FAFAFA', borderRadius: 8, paddingHorizontal: 8, paddingBottom: 8 },
  addTimeTitle: { fontSize: 12, fontWeight: 'bold', color: COLORS.textLight, marginBottom: 8, textAlign: 'center' },
  pickerColumns: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 100 },
  pickerColumnWrapper: { flex: 1, height: '100%', maxWidth: 45, backgroundColor: COLORS.white, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border },
  pickerScroll: { flex: 1 },
  pickerItem: { paddingVertical: 8, alignItems: 'center' },
  pickerItemActive: { backgroundColor: COLORS.primary + '20' },
  pickerItemText: { fontSize: 14, color: COLORS.textLight },
  pickerItemTextActive: { color: COLORS.primary, fontWeight: 'bold', fontSize: 16 },
  pickerColon: { fontSize: 14, fontWeight: 'bold', color: COLORS.textLight, marginHorizontal: 2 },
  addOptionSubmit: { minHeight: 40, marginTop: 10, alignSelf: 'center', paddingHorizontal: 16, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F2FBFB', borderWidth: 1.5, borderColor: '#8DCDD0' },
  addOptionSubmitText: { fontSize: 12, fontWeight: '900', color: '#277A80' },
  settingSectionTitle: { fontSize: 13, fontWeight: 'bold', color: '#444', marginBottom: 10 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#F5F5F5', borderRadius: 10 },
  settingLabel: { fontSize: 14, fontWeight: 'bold', color: '#333', width: 44 },
  settingNumBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: '#CCC', alignItems: 'center', justifyContent: 'center' },
  settingNumBtnActive: { backgroundColor: '#5B9BD5', borderColor: '#5B9BD5' },
  settingNumText: { fontSize: 13, fontWeight: 'bold', color: '#555' },
  settingStaffRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, padding: 8, backgroundColor: '#F8F8F8', borderRadius: 12 },
  settingArrowBtn: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEE', borderRadius: 4 },
  settingPriority: { fontSize: 13, fontWeight: 'bold', color: '#888', width: 18, textAlign: 'center' },
  settingEnabledBtn: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, backgroundColor: '#DDD' },
  settingEnabledBtnOn: { backgroundColor: '#4CAF50' },
  settingStaffName: { fontSize: 13, fontWeight: 'bold', color: '#333', width: 50 },
  settingTimeLabel: { fontSize: 10, color: '#888' },
  settingTimeInput: { width: 62, minHeight: 34, borderWidth: 1, borderColor: '#BCC9CC', borderRadius: 8, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  settingTimeValue: { fontSize: 13, fontWeight: '800', textAlign: 'center', color: '#263238' },
  settingTimePickerPanel: { maxWidth: 340, padding: 16 },
  settingTimePickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  settingTimePickerTitle: { fontSize: 17, fontWeight: '900', color: '#222222' },
  settingTimePickerSub: { marginTop: 3, fontSize: 12, fontWeight: '700', color: '#697578' },
  settingTimePickerClose: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F5F5', borderWidth: 1, borderColor: '#DCE3E3' },
  settingTimeWheelRow: { width: 170, height: SHIFT_WHEEL_VIEW_HEIGHT, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  settingTimePickerActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  settingTimeCancelBtn: { flex: 1, minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F3F4', borderWidth: 1, borderColor: '#D9DEDF' },
  settingTimeCancelText: { fontSize: 13, fontWeight: '900', color: '#555555' },
  settingTimeSaveBtn: { flex: 1.4, minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#36A9B5' },
  settingTimeSaveText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
  modalBtn: { flex: 1, padding: 14, alignItems: 'center', borderRadius: 8 },

  // ★ 1画面完全フィット(土日細い版・時間表示改行対応)のスタイル
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
  autoFillBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  autoFillBtnText: { color: COLORS.white, fontSize: 12, fontWeight: 'bold', marginLeft: 4 },
})
