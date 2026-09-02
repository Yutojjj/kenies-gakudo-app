import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import { useRequireRole } from '../hooks/useRequireRole';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { addDoc, collection, deleteDoc, doc, enableNetwork, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import AdminBottomNav from '../components/AdminBottomNav';
import SwipeMonthPager from '../components/SwipeMonthPager';
import { COLORS } from '../constants/theme';
import { db, storage } from '../firebase';
import { playUiSound } from '../utils/uiSounds';
import { handleWebWheelStep } from '../utils/webWheel';
import { navigateHome } from '../utils/navigationHome';
import { promptMonth } from '../utils/promptMonth';
import MonthPickerModal from '../components/MonthPickerModal';
import { downloadCalendarImage, downloadHtmlAsPng } from '../utils/downloadCalendarImage';

const WebScrollView = ScrollView as any;

type Staff = { id: string, name: string };
type AssignedStaff = { name: string, start: string, end: string };
type ShiftPrintPhoto = { id: string; url: string; storagePath: string };

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
const ILLUSTRATION_COUNT = 114;

const getMonthTitleColor = (month: number) => {
  const progress = ((month - 3 + 12) % 12) / 11;
  const stops = [
    { at: 0, color: [232, 104, 154] }, // 3月: ピンク
    { at: 0.28, color: [241, 199, 68] }, // 黄色
    { at: 0.52, color: [151, 204, 78] }, // 黄緑
    { at: 0.76, color: [79, 193, 179] }, // 緑がかった水色
    { at: 1, color: [137, 205, 232] }, // 2月: 淡い水色
  ];
  const upperIndex = stops.findIndex(stop => progress <= stop.at);
  const upper = stops[upperIndex < 0 ? stops.length - 1 : upperIndex];
  const lower = stops[Math.max(0, (upperIndex < 0 ? stops.length - 1 : upperIndex) - 1)];
  const localProgress = upper.at === lower.at ? 0 : (progress - lower.at) / (upper.at - lower.at);
  const rgb = lower.color.map((value, index) => Math.round(value + (upper.color[index] - value) * localProgress));
  return `rgb(${rgb.join(',')})`;
};

const getStaffShiftColor = (name: string, index: number, palette: string[]) =>
  name === '北条' ? '#B45AA7' : palette[index % palette.length];

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
  autoImageOnOpen?: boolean;
};

export default function ShiftCreateScreen({ embedded = false, initialDate, onClose, autoPdfOnOpen = false, autoImageOnOpen = false }: ShiftCreateScreenProps = {}) {
  const { verified, checking } = useRequireRole('admin');
  const { width: viewportWidth } = useWindowDimensions();
  const isCompact = viewportWidth < 520;

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
  const autoImageHandledRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [monthActionConfirm, setMonthActionConfirm] = useState<'autoFill' | 'delete' | null>(null);
  const [autoReviewTab, setAutoReviewTab] = useState<'dow' | 'staff'>('staff');
  const [printMenuVisible, setPrintMenuVisible] = useState(false);
  const [printMenuSection, setPrintMenuSection] = useState<'shift' | 'event' | null>(null);
  const [printMenuAction, setPrintMenuAction] = useState<string | null>(null);
  const [imageSavingType, setImageSavingType] = useState<'shift' | 'event' | null>(null);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [photoManagerVisible, setPhotoManagerVisible] = useState(false);
  const [shiftPrintPhotos, setShiftPrintPhotos] = useState<ShiftPrintPhoto[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState('');

  useEffect(() => {
    if (!printMenuVisible || Platform.OS !== 'web') return;
    const closeMenuOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('#shift-print-menu')) return;
      setPrintMenuVisible(false);
    };
    document.addEventListener('pointerdown', closeMenuOutside);
    return () => document.removeEventListener('pointerdown', closeMenuOutside);
  }, [printMenuVisible]);
  
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
  const [subscriptionKey, setSubscriptionKey] = useState(0);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'shift_print_photos'), snapshot => {
      setShiftPrintPhotos(snapshot.docs.map(photo => ({
        id: photo.id,
        url: String(photo.data().url || ''),
        storagePath: String(photo.data().storagePath || ''),
      })).filter(photo => photo.url));
    }, error => console.warn('印刷写真の取得に失敗しました', error));
    return unsubscribe;
  }, []);

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
  }, [subscriptionKey]);

  // iPhone のPWA復帰時はFirestoreの購読だけが止まることがあるため、表示復帰時に張り直す。
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    let scheduled = false;
    const refreshSubscriptions = async () => {
      if (document.visibilityState !== 'visible' || scheduled) return;
      scheduled = true;
      setSubscriptionKey(key => key + 1);
      setTimeout(() => { scheduled = false; }, 250);
    };
    document.addEventListener('visibilitychange', refreshSubscriptions);
    window.addEventListener('pageshow', refreshSubscriptions);
    window.addEventListener('online', refreshSubscriptions);
    return () => {
      document.removeEventListener('visibilitychange', refreshSubscriptions);
      window.removeEventListener('pageshow', refreshSubscriptions);
      window.removeEventListener('online', refreshSubscriptions);
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

  const pickShiftPrintPhotos = async (): Promise<ImagePicker.ImagePickerAsset[] | null> => {
    if (Platform.OS === 'web') {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.onchange = () => {
          const assets = Array.from(input.files || []).map((file) => ({
            uri: URL.createObjectURL(file),
            width: 0,
            height: 0,
            file,
            fileName: file.name,
            mimeType: file.type,
          })) as unknown as ImagePicker.ImagePickerAsset[];
          resolve(assets.length ? assets : null);
        };
        input.click();
      });
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('権限エラー', '写真へのアクセスを許可してください');
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsMultipleSelection: true,
      quality: 0.85,
    });
    return result.canceled || !result.assets?.length ? null : result.assets;
  };

  const uploadShiftPrintPhotos = async () => {
    if (photoUploading) return;
    setPhotoUploadError('');
    const assets = await pickShiftPrintPhotos();
    if (!assets?.length) return;
    setPhotoUploading(true);
    try {
      for (const asset of assets) {
        const file = (asset as ImagePicker.ImagePickerAsset & { file?: Blob }).file;
        const blob: Blob = file instanceof Blob
          ? file
          : await fetch(asset.uri).then((response) => response.blob());
        const extension = (asset.fileName?.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
        const storagePath = `shift_print_photos/${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`;
        const target = storageRef(storage, storagePath);
        await uploadBytes(target, blob, { contentType: asset.mimeType || blob.type || 'image/jpeg' });
        await addDoc(collection(db, 'shift_print_photos'), {
          url: await getDownloadURL(target),
          storagePath,
          createdAt: new Date(),
        });
        if (Platform.OS === 'web' && asset.uri.startsWith('blob:')) URL.revokeObjectURL(asset.uri);
      }
    } catch (error: any) {
      console.warn('印刷写真のアップロードに失敗しました', error);
      const message = error?.code === 'storage/unauthorized'
        ? '写真の保存が許可されていません。Storageのルールを確認してください。'
        : error?.message || '写真のアップロードに失敗しました';
      setPhotoUploadError(message);
    } finally {
      setPhotoUploading(false);
    }
  };

  const removeShiftPrintPhoto = async (photo: ShiftPrintPhoto) => {
    try {
      if (photo.storagePath) await deleteObject(storageRef(storage, photo.storagePath)).catch(() => {});
      await deleteDoc(doc(db, 'shift_print_photos', photo.id));
    } catch (error) {
      console.warn('印刷写真の削除に失敗しました', error);
      Alert.alert('エラー', '写真を削除できませんでした');
    }
  };

  const savePrintImage = async (printType: 'shift' | 'event') => {
    setImageSavingType(printType);
    try {
      await exportPDF(printType, true);
    } catch (error: any) {
      console.warn('画像保存に失敗しました', error);
      if (Platform.OS === 'web') window.alert(error?.message || '画像を保存できませんでした');
      else Alert.alert('エラー', error?.message || '画像を保存できませんでした');
    } finally {
      setImageSavingType(null);
      setPrintMenuVisible(false);
      setPrintMenuSection(null);
    }
    return;
    /* Legacy fallback layout kept below for native builds. */
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    const daysInMonth = getDaysInMonth(year, currentDate.getMonth());
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const date = new Date(year, currentDate.getMonth(), day);
      const assigned = (assignedShifts[dateStr] || []).filter(shift => allStaff.some(staff => staff.name === shift.name));
      return {
        label: `${month}/${day} (${['日', '月', '火', '水', '木', '金', '土'][date.getDay()]})`,
        dateColor: date.getDay() === 0 || publicHolidays[dateStr] ? '#D94747' : date.getDay() === 6 ? '#2874C6' : '#28343B',
        shifts: printType === 'shift' ? assigned.map(shift => ({
          ...shift,
          color: getStaffShiftColor(shift.name, Math.max(0, allStaff.findIndex(staff => staff.name === shift.name)), PRINT_SHIFT_COLORS),
        })) : [],
        note: printType === 'event' ? [...(eventsData[dateStr] || []), ...(publicHolidays[dateStr] ? [publicHolidays[dateStr]] : [])].join('・') : undefined,
      };
    });
    await downloadCalendarImage(
      `${year}年${month}月 ${printType === 'event' ? 'カレンダー' : 'シフト表'}`,
      days,
      `${printType === 'event' ? 'イベント' : 'シフト'}_${year}年${month}月`,
    );
  };

  const exportPDF = async (printType: 'shift' | 'event' = 'shift', asImage = false) => {
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
      const illustrationPool = Array.from({ length: ILLUSTRATION_COUNT }, (_, index) => index + 1)
        .sort(() => Math.random() - 0.5);
      const nextIllustration = () => `/illustrations/${illustrationPool.shift() || Math.floor(Math.random() * ILLUSTRATION_COUNT) + 1}.png`;
      // イベント印刷では、月初・月末の「日付がないセル」にだけ写真を配置する。
      const emptyCellImages = (printType === 'event' || printType === 'shift')
        ? weeks.flat()
            .filter(cell => !cell)
            .map(() => printType === 'event' && shiftPrintPhotos.length > 0
              ? shiftPrintPhotos[Math.floor(Math.random() * shiftPrintPhotos.length)].url
              : nextIllustration())
        : [];
      const illustrationByDate = new Map(
        (printType === 'event' || printType === 'shift')
          ? weeks.flat()
              .filter((cell): cell is { day: number; dow: number; dateStr: string } => !!cell)
              .filter(cell => printType === 'event' || (assignedShifts[cell.dateStr] || []).length === 0)
              .map(cell => [cell.dateStr, nextIllustration()])
          : [],
      );
      const fifthWeekdayAnchor = printType === 'event'
        ? weeks.flat()
            .filter((cell): cell is { day: number; dow: number; dateStr: string } => !!cell && cell.dow >= 1 && cell.dow <= 5 && cell.day > 28)
            .sort((a, b) => a.day - b.day)[0]
        : null;
      const fifthWeekdayEnd = fifthWeekdayAnchor
        ? weeks.find(wk => wk.some(cell => cell?.dateStr === fifthWeekdayAnchor.dateStr))
            ?.filter((cell): cell is { day: number; dow: number; dateStr: string } => !!cell && cell.dow >= 1 && cell.dow <= 5 && cell.day > 28)
            .sort((a, b) => a.dow - b.dow)
            .slice(-1)[0]
        : null;
      const fifthWeekdayBandWidth = fifthWeekdayAnchor && fifthWeekdayEnd
        ? Math.max(1, fifthWeekdayEnd.dow - fifthWeekdayAnchor.dow + 1)
        : 1;

      let emptyCellImageIndex = 0;
      weeks.forEach(wk => {
        const maxDayEntries = Math.max(0, ...wk.map(cell => {
          if (!cell) return 0;
          const eventRows = (eventsData[cell.dateStr] || []).reduce(
            (total, title) => total + Math.max(1, Math.ceil(Array.from(String(title)).length / 16)),
            0,
          );
          const fifthWeekdayNoteRows = fifthWeekdayAnchor?.dateStr === cell.dateStr ? 1 : 0;
          return eventRows + fifthWeekdayNoteRows + (printType === 'shift' ? (assignedShifts[cell.dateStr] || []).length : 0);
        }));
        // 内容が少ない週は詰め、行内の最大件数に応じて必要な分だけ高さを増やす。
        const weekHeightMm = printType === 'event'
          ? (weeks.length >= 6 ? 29 : 34)
          : Math.min(38, Math.max(16, 9 + maxDayEntries * 4.6));
        const cells = wk.map(cell => {
          if (!cell) {
            const image = emptyCellImages[emptyCellImageIndex++];
            const decoration = image ? `<img class="calendar-empty-photo" src="${image}" alt="" />` : '';
            return `<td class="calendar-day calendar-day-empty" style="height:${weekHeightMm}mm"><div class="calendar-cell-shell">${decoration}</div></td>`;
          }
          const isSun = cell.dow === 0;
          const isSat = cell.dow === 6;
          const isPH = !!publicHolidays[cell.dateStr];
          const dayClass = isPH || isSun ? 'calendar-day calendar-day-sun' : isSat ? 'calendar-day calendar-day-sat' : 'calendar-day';
          const fifthWeekdayNote = fifthWeekdayAnchor?.dateStr === cell.dateStr
            ? `<div class="calendar-closure-band" style="width:${fifthWeekdayBandWidth}00%">スイミングお休み</div>`
            : '';
          const eventEntries = (eventsData[cell.dateStr] || []).map(title => (
            `<div class="calendar-event">${title}</div>`
          )).join('');
          const isClosureRangeCell = !!fifthWeekdayAnchor && !!fifthWeekdayEnd
            && cell.dow >= fifthWeekdayAnchor.dow
            && cell.dow <= fifthWeekdayEnd.dow
            && cell.day >= fifthWeekdayAnchor.day
            && cell.day <= fifthWeekdayEnd.day;
          const eventContainerClass = isClosureRangeCell ? 'calendar-events calendar-events-with-closure' : 'calendar-events';
          const entries = printType === 'shift' ? orderedStaff.map((staff, staffIndex) => {
            const assigned = assignedShifts[cell.dateStr]?.find((s: any) => s.name === staff.name);
            if (!assigned) return '';
            const color = getStaffShiftColor(staff.name, staffIndex, PRINT_SHIFT_COLORS);
            return `<div class="calendar-shift" style="background-color:${color} !important;">
              <span class="calendar-shift-name">${staff.name}</span><span class="calendar-shift-time">${assigned.start}〜${assigned.end}</span>
            </div>`;
          }).filter(Boolean).join('') : '';
          const illustration = illustrationByDate.get(cell.dateStr);
          const decoration = illustration
            ? `<img class="calendar-illustration" src="${illustration}" alt="" />`
            : '';
          const holidayLabel = printType === 'event' && publicHolidays[cell.dateStr]
            ? `<span class="calendar-holiday-label">${publicHolidays[cell.dateStr]}</span>`
            : '';
          return `<td class="${dayClass}" style="height:${weekHeightMm}mm"><div class="calendar-cell-shell">${decoration}<div class="calendar-cell-content"><div class="calendar-date-row"><span class="calendar-date">${cell.day}</span>${holidayLabel}</div>${fifthWeekdayNote}<div class="${eventContainerClass}">${eventEntries}</div><div class="calendar-shifts">${entries}</div></div></div></td>`;
        }).join('');
        bodyHtml += `<tr>${cells}</tr>`;
      });

      const titleIllustrationLeft = nextIllustration();
      const titleIllustrationRight = nextIllustration();
      const monthTitleColor = getMonthTitleColor(month);
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        @page { size: A4 ${printType === 'event' ? 'landscape' : 'portrait'}; margin: 4mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Hiragino Kaku Gothic ProN', 'Meiryo', Arial, sans-serif;
          font-size: 8px;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          color-adjust: exact;
        }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; page-break-inside: avoid; }
        tr { break-inside: avoid; page-break-inside: avoid; }
        td { border: 0.5px solid #AAAAAA; vertical-align: middle; text-align: center; }

        .c-dow { font-weight: 900; font-size: 11px; line-height: 1.1; padding: 1.5mm 1px; }
        .c-dow-week { background-color: #E8E8E8 !important; color: #333; }
        .c-dow-sun  { background-color: #FFD9D9 !important; color: #CC0000; }
        .c-dow-sat  { background-color: #CCE4FF !important; color: #0055CC; }

        caption { caption-side: top; height: 15mm; text-align: center; font-size: 19px; line-height: 15mm; font-weight: 900; padding: 0; margin-bottom: 1.5mm; color: #216E77; background: #C8E9EB; border: 1px solid #8FCED2; clip-path: polygon(0 0, 100% 0, 97% 50%, 100% 100%, 0 100%, 3% 50%); }
        caption img { width: 12mm; height: 12mm; object-fit: contain; vertical-align: middle; margin: 0 4mm; }
        .caption-month { display: inline-block; margin: 0 1.5mm; color: #155B64; font-size: 40px; line-height: 1; font-weight: 1000; vertical-align: middle; }
        .calendar-day { height: 16mm; vertical-align: top; text-align: left; padding: 0; background: #FFFFFF !important; }
        .calendar-cell-shell { position: relative; width: 100%; height: 100%; min-height: 16mm; overflow: visible; }
        .calendar-cell-content { position: relative; z-index: 1; }
        .calendar-illustration { position: absolute; z-index: 0; right: 1.5mm; bottom: 1mm; width: 14mm; height: 14mm; object-fit: contain; opacity: 0.38; pointer-events: none; }
        .calendar-empty-photo { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; object-fit: contain; opacity: 0.38; pointer-events: none; }
        .calendar-day-empty { background: #FFFFFF !important; }
        .calendar-day-short { height: 16mm; }
        .calendar-day-sun { background: #FFF1F1 !important; }
        .calendar-day-sat { background: #F0F7FF !important; }
        .calendar-date { font-weight: 900; font-size: 16px; line-height: 1; padding: 1.5mm 1.5mm 0; margin-bottom: 1.5mm; }
        .calendar-day-sun .calendar-date { color: #D94747; }
        .calendar-day-sat .calendar-date { color: #2874C6; }
        .calendar-events { display: flex; flex-direction: column; gap: 0.5mm; margin-bottom: 0; width: 100%; }
        .calendar-events-with-closure { margin-top: 5mm; }
        .calendar-event { width: 100%; border-radius: 0; padding: 1.2mm 1.5mm; background: #E9B92F !important; color: #2D2100; font-size: 10px; line-height: 1.15; font-weight: 900; text-align: center; white-space: normal; overflow-wrap: anywhere; }
        .calendar-date-row { display: flex; align-items: baseline; gap: 1.5mm; padding: 1.5mm 1.5mm 0; min-height: 5mm; }
        .calendar-date-row .calendar-date { padding: 0; margin: 0; }
        .calendar-holiday-label { color: #D94747; font-size: 9px; line-height: 1.1; font-weight: 900; white-space: normal; overflow-wrap: anywhere; }
        .calendar-closure-band { position: absolute; z-index: 2; top: 6mm; left: 0; width: 100%; border-radius: 0; padding: 1.2mm 1.5mm; background: #DCE9F7 !important; color: #244C73; font-size: 10px; line-height: 1.15; font-weight: 900; text-align: center; white-space: nowrap; overflow: hidden; }
        .calendar-shifts { width: 100%; display: flex; flex-direction: column; gap: 0; }
        .calendar-shift { width: 100%; border-radius: 0; padding: 1.1mm 1.5mm; font-size: 10px; line-height: 1.12; color: #111; white-space: normal; overflow-wrap: normal; font-weight: 900; }
        .calendar-shift-name { font-weight: 900; font-size: 11px; margin-right: 1mm; }
        .calendar-shift-time { display: inline-block; white-space: nowrap; font-weight: 900; font-size: 10px; }

        .legend { display: none; }
        .lb { display: inline-block; width: 10px; height: 10px; border: 0.5px solid #aaa; vertical-align: middle; margin-right: 2px; }
      </style></head><body>
        <table>
          <caption><img src="${titleIllustrationLeft}" alt="" /><span>${year}年</span><span class="caption-month" style="color:${monthTitleColor};">${month}月</span><span>${printType === 'event' ? 'カレンダー' : 'シフト表'}</span><img src="${titleIllustrationRight}" alt="" /></caption>
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

      if (asImage && Platform.OS === 'web') {
        await downloadHtmlAsPng(html, `${printType === 'event' ? 'イベント' : 'シフト'}_${year}年${month}月`);
        return;
      }

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
    if (!autoImageOnOpen) autoImageHandledRef.current = false;
  }, [autoImageOnOpen]);

  useEffect(() => {
    if (autoImageOnOpen) {
      if (autoImageHandledRef.current || !staffListLoaded || !assignedShiftsLoaded) return;
      autoImageHandledRef.current = true;
      const timer = setTimeout(() => {
        exportPDF('shift', true).catch((error: any) => {
          console.warn('画像保存に失敗しました', error);
          if (Platform.OS === 'web') window.alert(error?.message || '画像を保存できませんでした');
          else Alert.alert('エラー', error?.message || '画像を保存できませんでした');
        });
      }, 350);
      return () => clearTimeout(timer);
    }
    if ((!autoPdfOnOpen && autoPdf !== '1') || autoPdfHandledRef.current || !staffListLoaded || !assignedShiftsLoaded) return;
    autoPdfHandledRef.current = true;
    const timer = setTimeout(() => exportPDF(), 350);
    return () => clearTimeout(timer);
  }, [autoPdf, autoPdfOnOpen, autoImageOnOpen, staffListLoaded, assignedShiftsLoaded, allStaff, assignedShifts, requests]);



















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
                          { backgroundColor: getStaffShiftColor(st.name, staffIndex, SHIFT_CARD_COLORS) },
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

  if (checking || !verified) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingScreen}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>シフトを読み込んでいます</Text>
        </View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => embedded ? onClose?.() : navigateHome(router)}>
          <Ionicons name={embedded ? 'close' : 'chevron-back'} size={embedded ? 26 : 24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>シフト作成</Text>
        <View style={styles.headerActions}>
          <View style={styles.pdfMenuAnchor}>
            <TouchableOpacity
              style={[styles.pdfBtn, styles.headerPdfBtn]}
              onPress={() => { setPrintMenuSection(null); setPrintMenuVisible(current => !current); }}
              disabled={loading}
              accessibilityLabel="印刷メニュー"
            >
              <Ionicons name="print-outline" size={20} color={COLORS.white} />
            </TouchableOpacity>
            {printMenuVisible && (
              <View nativeID="shift-print-menu" style={styles.pdfMenu}>
                <Pressable
                  style={styles.pdfMenuSectionWrap}
                  onHoverIn={() => setPrintMenuSection('shift')}
                >
                  <TouchableOpacity style={[styles.pdfMenuItem, styles.pdfMenuParentItem, printMenuSection === 'shift' && styles.pdfMenuItemActive]} onPress={() => setPrintMenuSection(current => current === 'shift' ? null : 'shift')}>
                    <Text style={styles.pdfMenuItemText}>シフト表</Text>
                    <Ionicons name="chevron-forward" size={17} color="#2C6F77" />
                  </TouchableOpacity>
                  {printMenuSection === 'shift' && (
                    <View style={styles.pdfSubMenu}>
                      <Pressable style={[styles.pdfMenuItem, styles.pdfMenuActionItem, printMenuAction === 'shift-pdf' && styles.pdfMenuItemHover]} onHoverIn={() => setPrintMenuAction('shift-pdf')} onHoverOut={() => setPrintMenuAction(null)} onPress={() => { setPrintMenuVisible(false); setPrintMenuSection(null); exportPDF('shift'); }}>
                        <Ionicons name="print-outline" size={17} color="#2C6F77" />
                        <Text style={styles.pdfMenuItemText}>印刷</Text>
                      </Pressable>
                      <Pressable style={[styles.pdfMenuItem, styles.pdfMenuActionItem, styles.pdfMenuItemSeparated, printMenuAction === 'shift-image' && styles.pdfMenuItemHover]} onHoverIn={() => setPrintMenuAction('shift-image')} onHoverOut={() => setPrintMenuAction(null)} onPress={() => savePrintImage('shift')}>
                        {imageSavingType === 'shift' ? <ActivityIndicator size="small" color="#2C6F77" /> : <Ionicons name="download-outline" size={17} color="#2C6F77" />}
                        <Text style={styles.pdfMenuItemText}>{imageSavingType === 'shift' ? '保存中' : '画像として保存'}</Text>
                      </Pressable>
                    </View>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.pdfMenuSectionWrap, styles.pdfMenuItemSeparated]}
                  onHoverIn={() => setPrintMenuSection('event')}
                >
                  <TouchableOpacity style={[styles.pdfMenuItem, styles.pdfMenuParentItem, printMenuSection === 'event' && styles.pdfMenuItemActive]} onPress={() => setPrintMenuSection(current => current === 'event' ? null : 'event')}>
                    <Text style={styles.pdfMenuItemText}>イベント表</Text>
                    <Ionicons name="chevron-forward" size={17} color="#2C6F77" />
                  </TouchableOpacity>
                  {printMenuSection === 'event' && (
                    <View style={styles.pdfSubMenu}>
                      <Pressable style={[styles.pdfMenuItem, styles.pdfMenuActionItem, printMenuAction === 'event-pdf' && styles.pdfMenuItemHover]} onHoverIn={() => setPrintMenuAction('event-pdf')} onHoverOut={() => setPrintMenuAction(null)} onPress={() => { setPrintMenuVisible(false); setPrintMenuSection(null); exportPDF('event'); }}>
                        <Ionicons name="print-outline" size={17} color="#2C6F77" />
                        <Text style={styles.pdfMenuItemText}>印刷</Text>
                      </Pressable>
                      <Pressable style={[styles.pdfMenuItem, styles.pdfMenuActionItem, styles.pdfMenuItemSeparated, printMenuAction === 'event-image' && styles.pdfMenuItemHover]} onHoverIn={() => setPrintMenuAction('event-image')} onHoverOut={() => setPrintMenuAction(null)} onPress={() => savePrintImage('event')}>
                        {imageSavingType === 'event' ? <ActivityIndicator size="small" color="#2C6F77" /> : <Ionicons name="download-outline" size={17} color="#2C6F77" />}
                        <Text style={styles.pdfMenuItemText}>{imageSavingType === 'event' ? '保存中' : '画像として保存'}</Text>
                      </Pressable>
                      <Pressable style={[styles.pdfMenuItem, styles.pdfMenuActionItem, styles.pdfMenuItemSeparated, printMenuAction === 'event-upload' && styles.pdfMenuItemHover]} onHoverIn={() => setPrintMenuAction('event-upload')} onHoverOut={() => setPrintMenuAction(null)} onPress={() => { setPrintMenuVisible(false); setPrintMenuSection(null); setPhotoUploadError(''); setPhotoManagerVisible(true); }}>
                        <Ionicons name="cloud-upload-outline" size={17} color="#2C6F77" />
                        <Text style={styles.pdfMenuItemText}>画像アップロード</Text>
                      </Pressable>
                    </View>
                  )}
                </Pressable>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={[styles.pdfBtn, styles.submissionStatusBtn]}
            onPress={() => setSubmissionStatusVisible(true)}
            disabled={loading}
          >
            <Text style={styles.pdfBtnText}>シフト提出状況</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pdfBtn, styles.headerAutoFillBtn]}
            onPress={() => {
              setAutoReviewTab('staff');
              setMonthActionConfirm('autoFill');
            }}
            disabled={loading}
          >
            {loading ? <ActivityIndicator size="small" color={COLORS.white} /> : null}
            <Text style={styles.pdfBtnText}>自動入力</Text>
          </TouchableOpacity>
        </View>
      </View>

      <MonthPickerModal visible={monthPickerVisible} value={currentDate} onChange={setCurrentDate} onClose={() => setMonthPickerVisible(false)} />

      <Modal visible={photoManagerVisible} transparent animationType="fade" onRequestClose={() => setPhotoManagerVisible(false)}>
        <TouchableOpacity style={styles.photoManagerOverlay} activeOpacity={1} onPress={() => setPhotoManagerVisible(false)}>
          <TouchableOpacity style={styles.photoManagerPanel} activeOpacity={1} onPress={event => event.stopPropagation()}>
            <View style={styles.photoManagerHeader}>
              <Text style={styles.photoManagerTitle}>印刷写真</Text>
              <TouchableOpacity onPress={() => setPhotoManagerVisible(false)} accessibilityLabel="閉じる">
                <Ionicons name="close" size={24} color="#475569" />
              </TouchableOpacity>
            </View>
            <Text style={styles.photoManagerDescription}>
              ここで登録した写真は、イベントカレンダーを印刷するときに、日付のない日にランダムに表示されます。
            </Text>
            <ScrollView contentContainerStyle={styles.photoManagerList}>
              {shiftPrintPhotos.length === 0 && <Text style={styles.photoManagerEmpty}>登録された写真はありません</Text>}
              {shiftPrintPhotos.map(photo => (
                <View key={photo.id} style={styles.photoManagerItem}>
                  <Image source={{ uri: photo.url }} style={styles.photoManagerImage} resizeMode="cover" />
                  <TouchableOpacity style={styles.photoManagerDelete} onPress={() => removeShiftPrintPhoto(photo)} accessibilityLabel="写真を削除">
                    <Ionicons name="close" size={15} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={styles.photoManagerAddTile} onPress={uploadShiftPrintPhotos} disabled={photoUploading} accessibilityLabel="写真アップロード">
                {photoUploading ? <ActivityIndicator color="#00AEB8" /> : <Text style={styles.photoManagerAddPlus}>＋</Text>}
                <Text style={styles.photoManagerAddText}>写真アップロード</Text>
              </TouchableOpacity>
            </ScrollView>
            {!!photoUploadError && <Text style={styles.photoManagerError}>{photoUploadError}</Text>}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

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
          <TouchableOpacity style={styles.monthNavButton} accessibilityRole="button" onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))}><Ionicons name="chevron-back" size={24} color={COLORS.text} /></TouchableOpacity>
          <TouchableOpacity style={styles.monthPartButton} accessibilityRole="button" onPress={() => setMonthPickerVisible(true)}><Text style={styles.monthTextLabel}>{currentDate.getFullYear()}年</Text></TouchableOpacity>
          <TouchableOpacity style={styles.monthPartButton} accessibilityRole="button" onPress={() => setMonthPickerVisible(true)}><Text style={styles.monthTextLabel}>{currentDate.getMonth() + 1}月</Text></TouchableOpacity>
          <TouchableOpacity style={styles.monthNavButton} accessibilityRole="button" onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))}><Ionicons name="chevron-forward" size={24} color={COLORS.text} /></TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.monthDeleteBtn} accessibilityRole="button" accessibilityLabel="月を削除" onPress={() => setMonthActionConfirm('delete')} disabled={loading}>
          <Ionicons name="trash-outline" size={15} color="#B93E48" />
        </TouchableOpacity>
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
              <View style={styles.pdfMenuAnchor}>
                <TouchableOpacity onPress={() => { setPrintMenuSection(null); setPrintMenuVisible(current => !current); }} style={styles.pdfBtn} accessibilityLabel="印刷メニュー">
                  <Ionicons name="print-outline" size={20} color={COLORS.white} />
                </TouchableOpacity>
                {printMenuVisible && (
                  <View nativeID="shift-print-menu" style={styles.pdfMenu}>
                    <Pressable style={styles.pdfMenuSectionWrap} onHoverIn={() => setPrintMenuSection('shift')}>
                      <TouchableOpacity style={[styles.pdfMenuItem, styles.pdfMenuParentItem, printMenuSection === 'shift' && styles.pdfMenuItemActive]} onPress={() => setPrintMenuSection(current => current === 'shift' ? null : 'shift')}>
                        <Text style={styles.pdfMenuItemText}>シフト表</Text>
                        <Ionicons name="chevron-forward" size={17} color="#2C6F77" />
                      </TouchableOpacity>
                      {printMenuSection === 'shift' && (
                        <View style={styles.pdfSubMenu}>
                          <Pressable style={[styles.pdfMenuItem, styles.pdfMenuActionItem, printMenuAction === 'shift-pdf' && styles.pdfMenuItemHover]} onHoverIn={() => setPrintMenuAction('shift-pdf')} onHoverOut={() => setPrintMenuAction(null)} onPress={() => { setPrintMenuVisible(false); setPrintMenuSection(null); exportPDF('shift'); }}><Ionicons name="print-outline" size={17} color="#2C6F77" /><Text style={styles.pdfMenuItemText}>印刷</Text></Pressable>
                          <Pressable style={[styles.pdfMenuItem, styles.pdfMenuActionItem, styles.pdfMenuItemSeparated, printMenuAction === 'shift-image' && styles.pdfMenuItemHover]} onHoverIn={() => setPrintMenuAction('shift-image')} onHoverOut={() => setPrintMenuAction(null)} onPress={() => savePrintImage('shift')}>{imageSavingType === 'shift' ? <ActivityIndicator size="small" color="#2C6F77" /> : <Ionicons name="download-outline" size={17} color="#2C6F77" />}<Text style={styles.pdfMenuItemText}>{imageSavingType === 'shift' ? '保存中' : '画像として保存'}</Text></Pressable>
                        </View>
                      )}
                    </Pressable>
                    <Pressable style={[styles.pdfMenuSectionWrap, styles.pdfMenuItemSeparated]} onHoverIn={() => setPrintMenuSection('event')}>
                      <TouchableOpacity style={[styles.pdfMenuItem, styles.pdfMenuParentItem, printMenuSection === 'event' && styles.pdfMenuItemActive]} onPress={() => setPrintMenuSection(current => current === 'event' ? null : 'event')}>
                        <Text style={styles.pdfMenuItemText}>イベント表</Text>
                        <Ionicons name="chevron-forward" size={17} color="#2C6F77" />
                      </TouchableOpacity>
                      {printMenuSection === 'event' && (
                        <View style={styles.pdfSubMenu}>
                          <Pressable style={[styles.pdfMenuItem, styles.pdfMenuActionItem, printMenuAction === 'event-pdf' && styles.pdfMenuItemHover]} onHoverIn={() => setPrintMenuAction('event-pdf')} onHoverOut={() => setPrintMenuAction(null)} onPress={() => { setPrintMenuVisible(false); setPrintMenuSection(null); exportPDF('event'); }}><Ionicons name="print-outline" size={17} color="#2C6F77" /><Text style={styles.pdfMenuItemText}>印刷</Text></Pressable>
                          <Pressable style={[styles.pdfMenuItem, styles.pdfMenuActionItem, styles.pdfMenuItemSeparated, printMenuAction === 'event-image' && styles.pdfMenuItemHover]} onHoverIn={() => setPrintMenuAction('event-image')} onHoverOut={() => setPrintMenuAction(null)} onPress={() => savePrintImage('event')}>{imageSavingType === 'event' ? <ActivityIndicator size="small" color="#2C6F77" /> : <Ionicons name="download-outline" size={17} color="#2C6F77" />}<Text style={styles.pdfMenuItemText}>{imageSavingType === 'event' ? '保存中' : '画像として保存'}</Text></Pressable>
                          <Pressable style={[styles.pdfMenuItem, styles.pdfMenuActionItem, styles.pdfMenuItemSeparated, printMenuAction === 'event-upload' && styles.pdfMenuItemHover]} onHoverIn={() => setPrintMenuAction('event-upload')} onHoverOut={() => setPrintMenuAction(null)} onPress={() => { setPrintMenuVisible(false); setPrintMenuSection(null); setPhotoUploadError(''); setPhotoManagerVisible(true); }}><Ionicons name="cloud-upload-outline" size={17} color="#2C6F77" /><Text style={styles.pdfMenuItemText}>画像アップロード</Text></Pressable>
                        </View>
                      )}
                    </Pressable>
                  </View>
                )}
              </View>
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
          <View
            style={styles.modalContent}
            onTouchStart={() => {
              if (timePickerVisible) setTimePickerVisible(false);
            }}
          >
            <View style={[styles.modalHeader, isCompact && styles.modalHeaderCompact]}>
              <TouchableOpacity style={styles.modalDateNavBtn} onPress={() => moveModalDate(-1)}>
                <Ionicons name="chevron-back" size={24} color={COLORS.text} />
                <Text style={styles.modalDateNavText}>{formatModalAdjacentDate(-1)}</Text>
              </TouchableOpacity>
              <Text style={[styles.modalTitle, isCompact && styles.modalTitleCompact]} numberOfLines={1}>
                {formatModalDate()}
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

            <ScrollView style={{ flex: 1, padding: isCompact ? 8 : 20 }}>

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

              <View style={[styles.shiftEditorColumns, isCompact && styles.shiftEditorColumnsCompact]}>
                <View style={styles.shiftAssignedPane}>
                  {/* 決定済みを左側にまとめ、横幅を広く使う */}
                  <Text style={[styles.sectionTitle, styles.assignedSectionTitle]}>決定したシフト</Text>
                  {currentDayAssigned.length === 0 && <Text style={styles.shiftEmptyText}>追加されていません</Text>}
                  {currentDayAssigned.map((s, i) => (
                    <View key={i} style={[styles.assignedCard, isCompact && styles.assignedCardCompact]}>
                      <View style={[styles.assignedCardContent, isCompact && styles.assignedCardContentCompact]}>
                        <Text style={styles.assignedName}>{s.name}</Text>
                        <View style={[styles.assignedTimeRow, isCompact && styles.assignedTimeRowCompact]}>
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
                          <View style={styles.inlineTimeEditor} onTouchStart={(event) => event.stopPropagation()}>
                            <View style={styles.drumPickerRow}>
                                <View style={[styles.shiftTimeGroup, isCompact && styles.shiftTimeGroupCompact]}>
                                <Text style={styles.shiftTimeGroupTitle}>開始</Text>
                                  <View style={[styles.shiftTimePair, isCompact && styles.shiftTimePairCompact]}>
                                  <ShiftTimeWheel values={HOURS} value={newStartHour} visible={timePickerVisible} onChange={(hour) => { setNewStartHour(hour); setTempStart(`${String(hour).padStart(2, '0')}:${String(newStartMinute).padStart(2, '0')}`); }} />
                                  <Text style={styles.drumColon}>:</Text>
                                  <ShiftTimeWheel values={MINUTES} value={newStartMinute} visible={timePickerVisible} onChange={(minute) => { setNewStartMinute(minute); setTempStart(`${String(newStartHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`); }} />
                                </View>
                              </View>
                              <Text style={styles.drumTilde}>〜</Text>
                                <View style={[styles.shiftTimeGroup, isCompact && styles.shiftTimeGroupCompact]}>
                                <Text style={styles.shiftTimeGroupTitle}>終了</Text>
                                  <View style={[styles.shiftTimePair, isCompact && styles.shiftTimePairCompact]}>
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
                      <TouchableOpacity style={[styles.assignedDeleteBtn, isCompact && styles.assignedDeleteBtnCompact]} onPress={() => removeStaffFromShift(s.name)}>
                        <Ionicons name="trash" size={16} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>

                <View style={[styles.shiftStaffPane, isCompact && styles.shiftStaffPaneCompact]}>
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
                <Text style={styles.monthAutoReviewTitle}>自動入力</Text>
              </View>
            </View>

            <ScrollView style={styles.monthAutoReviewScroll} contentContainerStyle={styles.monthAutoReviewScrollContent}>
              <View style={styles.monthAutoReviewTabs}>
                <TouchableOpacity style={[styles.monthAutoReviewTab, autoReviewTab === 'dow' && styles.monthAutoReviewTabActive]} onPress={() => setAutoReviewTab('dow')}>
                  <Text style={[styles.monthAutoReviewTabText, autoReviewTab === 'dow' && styles.monthAutoReviewTabTextActive]}>曜日別人数設定</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.monthAutoReviewTab, autoReviewTab === 'staff' && styles.monthAutoReviewTabActive]} onPress={() => setAutoReviewTab('staff')}>
                  <Text style={[styles.monthAutoReviewTabText, autoReviewTab === 'staff' && styles.monthAutoReviewTabTextActive]}>スタッフ別時間設定</Text>
                </TouchableOpacity>
              </View>

              {autoReviewTab === 'dow' && <>
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
                            onPress={() => saveAutoFillSettings({ ...autoFillSettings, dayMaxCount: { ...autoFillSettings.dayMaxCount, [dow]: n } })}
                          >
                            <Text style={[styles.settingNumText, autoFillSettings.dayMaxCount[dow] === n && { color:'#fff' }]}>{n}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              </>}

              {autoReviewTab === 'staff' && <>
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
              </>}
            </ScrollView>
            <View style={styles.monthAutoReviewFooter}>
              <TouchableOpacity style={styles.monthAutoReviewFooterClose} onPress={() => setMonthActionConfirm(null)}>
                <Text style={styles.monthAutoReviewCloseText}>閉じる</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.monthAutoReviewExecuteBtn}
                onPress={async () => {
                  setMonthActionConfirm(null);
                  await autoFillCurrentMonth();
                }}
              >
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                <Text style={styles.monthAutoReviewYesText}>{currentDate.getMonth() + 1}月分を自動入力</Text>
              </TouchableOpacity>
            </View>
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
  header: { position: 'relative', zIndex: 1000, elevation: 20, overflow: 'visible', minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#FFF8F0', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  headerActions: { position: 'relative', zIndex: 1001, flexDirection: 'row', alignItems: 'center', gap: 3, padding: 3, borderRadius: 10, backgroundColor: '#EAF7F7', flexShrink: 1 },
  pdfMenuAnchor: { position: 'relative', zIndex: 1002 },
  pdfMenu: { position: 'absolute', top: '100%', right: 0, marginTop: 5, minWidth: 168, padding: 4, borderRadius: 8, backgroundColor: '#FFFFFF', opacity: 1, borderWidth: 1, borderColor: '#D7E1E2', shadowColor: '#000000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 7, elevation: 100, zIndex: 1003, overflow: 'visible' },
  pdfMenuSectionWrap: { position: 'relative', zIndex: 1005 },
  pdfSubMenu: { position: 'absolute', left: '100%', top: -5, minWidth: 150, padding: 4, borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D7E1E2', shadowColor: '#000000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 7, elevation: 100, zIndex: 1006 },
  pdfMenuItem: { minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: '#FFFFFF', zIndex: 1004 },
  pdfMenuActionItem: { flexDirection: 'row', gap: 5 },
  pdfMenuParentItem: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12 },
  pdfMenuItemActive: { backgroundColor: '#D9EEF0' },
  pdfMenuItemHover: { backgroundColor: '#D9EEF0' },
  pdfMenuItemSeparated: { borderTopWidth: 1, borderTopColor: '#E5ECEE' },
  pdfMenuItemText: { fontSize: 12, fontWeight: '900', color: '#2C6F77' },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 6, paddingVertical: 5, borderRadius: 7 },
  pdfBtnText: { color: COLORS.white, fontWeight: 'bold', marginLeft: 0, fontSize: 10 },
  headerPdfBtn: { minHeight: 34, paddingHorizontal: 8, backgroundColor: '#00AEB8' },
  submissionStatusBtn: { minHeight: 34, paddingHorizontal: 6, backgroundColor: '#00AEB8' },
  headerAutoFillBtn: { minHeight: 34, paddingHorizontal: 8, backgroundColor: '#00AEB8' },
  headerPhotoBtn: { minHeight: 34, width: 34, paddingHorizontal: 0, backgroundColor: '#00AEB8' },
  imageDownloadOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18, backgroundColor: 'rgba(35, 30, 27, 0.55)' },
  imageDownloadPanel: { width: '100%', maxWidth: 400, borderRadius: 18, padding: 22, backgroundColor: '#FFFDFC' },
  imageDownloadTitle: { color: '#3D2A24', fontSize: 19, fontWeight: '900', textAlign: 'center' },
  imageDownloadText: { marginTop: 10, color: '#657174', fontSize: 13, lineHeight: 20, fontWeight: '700', textAlign: 'center' },
  imageDownloadActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  imageDownloadCancel: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#F1F3F4' },
  imageDownloadCancelText: { color: '#555555', fontSize: 13, fontWeight: '900' },
  imageDownloadConfirm: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 10, backgroundColor: '#08AEB8' },
  imageDownloadConfirmText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  photoManagerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'flex-end', justifyContent: 'flex-start', paddingTop: 72, paddingRight: 16 },
  photoManagerPanel: { width: '92%', maxWidth: 420, maxHeight: '78%', borderRadius: 14, padding: 14, backgroundColor: '#FFFFFF', shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 12 },
  photoManagerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  photoManagerTitle: { fontSize: 17, fontWeight: '900', color: '#243B53' },
  photoManagerDescription: { marginBottom: 12, color: '#526779', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  photoManagerList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 10 },
  photoManagerEmpty: { width: '100%', paddingVertical: 22, textAlign: 'center', color: '#829AB1', fontSize: 13, fontWeight: '700' },
  photoManagerError: { marginBottom: 9, color: '#C53030', fontSize: 12, fontWeight: '700', lineHeight: 18 },
  photoManagerItem: { position: 'relative', width: 88, height: 70, borderRadius: 8, overflow: 'hidden', backgroundColor: '#F1F5F9' },
  photoManagerImage: { width: '100%', height: '100%' },
  photoManagerDelete: { position: 'absolute', top: 3, right: 3, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.65)' },
  photoManagerAddTile: { width: 88, height: 70, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#8BCFD3', backgroundColor: '#F7FCFC' },
  photoManagerAddPlus: { color: '#00AEB8', fontSize: 27, fontWeight: '400', lineHeight: 29 },
  photoManagerAddText: { marginTop: 3, color: '#16878E', fontSize: 10, fontWeight: '900' },
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
  
  monthSelector: { position: 'relative', width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  monthNavButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF8F0', borderWidth: 1, borderColor: '#F2C98F' },
  monthNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  monthText: { minWidth: 170, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  monthPartButton: { minHeight: 44, minWidth: 78, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#F2C98F', backgroundColor: '#FFF8F0', alignItems: 'center', justifyContent: 'center' },
  monthTextLabel: { fontSize: 18, fontWeight: 'bold', marginHorizontal: 0, textAlign: 'center', color: '#5D4037' },

  monthActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  toggleTimeBtn: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#E0FFFF', paddingHorizontal: 9, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: '#AFEEEE' },
  toggleTimeText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 12 },
  monthAutoFillBtn: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 10, borderRadius: 18, backgroundColor: '#36A9B5', borderWidth: 1, borderColor: '#258C96' },
  monthDeleteBtn: { position: 'absolute', right: 0, width: 40, height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#FFF3F3', borderWidth: 1, borderColor: '#E7A6AC' },
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
  monthAutoReviewTabs: { flexDirection: 'row', gap: 8, marginBottom: 15 },
  monthAutoReviewTab: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#C9D8DA', backgroundColor: '#F4F7F7' },
  monthAutoReviewTabActive: { borderColor: '#36A9B5', backgroundColor: '#E1F5F6' },
  monthAutoReviewTabText: { fontSize: 13, fontWeight: '900', color: '#687477' },
  monthAutoReviewTabTextActive: { color: '#16818C' },
  monthAutoReviewFooter: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: '#E6ECEC', backgroundColor: '#FFFFFF' },
  monthAutoReviewFooterClose: { minHeight: 46, minWidth: 110, paddingHorizontal: 16, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F3F4', borderWidth: 1, borderColor: '#D9DEDF' },
  monthAutoReviewExecuteBtn: { flex: 1, minHeight: 46, paddingHorizontal: 18, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#29A6B2' },
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

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 4 },
  modalContent: { backgroundColor: COLORS.white, height: '96%', width: '100%', maxWidth: 1200, borderRadius: 16, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: COLORS.border, gap: 5 },
  modalHeaderCompact: { paddingHorizontal: 5, gap: 2 },
  modalTitle: { flex: 1, minWidth: 0, textAlign: 'center', fontSize: 18, fontWeight: 'bold' },
  modalTitleCompact: { fontSize: 15 },
  modalHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 0 },
  modalDateNavBtn: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderRadius: 10, backgroundColor: '#FFF8EB', flexShrink: 1 },
  modalDateNavText: { fontSize: 12, fontWeight: '800', color: COLORS.text },
  modalCloseBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', borderBottomWidth: 2, borderColor: COLORS.border, paddingBottom: 4, marginBottom: 12 },
  shiftEditorColumns: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minWidth: 0 },
  shiftEditorColumnsCompact: { gap: 6 },
  shiftAssignedPane: { flex: 2.35, minWidth: 0 },
  shiftStaffPane: { flex: 0.75, minWidth: 150, paddingLeft: 10, borderLeftWidth: 1, borderColor: '#E5E7EB' },
  shiftStaffPaneCompact: { flex: 0.65, minWidth: 106, paddingLeft: 5 },
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
  
  assignedCard: { position: 'relative', backgroundColor: '#F0F8FF', padding: 16, borderRadius: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', minWidth: 0, width: '100%' },
  assignedCardCompact: { padding: 10 },
  assignedCardContent: { flex: 1, minWidth: 0, marginRight: 10 },
  assignedCardContentCompact: { marginRight: 0, paddingRight: 34 },
  assignedName: { fontSize: 16, fontWeight: 'bold', color: COLORS.primary, marginBottom: 4 },
  assignedTimeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, minWidth: 0 },
  assignedTimeRowCompact: { gap: 4 },
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
  assignedDeleteBtn: { position: 'absolute', top: 8, right: 8, width: 34, height: 34, backgroundColor: '#FFF0F0', borderWidth: 1, borderColor: '#FFE0E0', borderRadius: 8, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  assignedDeleteBtnCompact: { top: 6, right: 6, width: 30, height: 30, borderRadius: 7 },
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
  shiftTimeGroupCompact: { maxWidth: 102 },
  shiftTimeGroupTitle: { marginBottom: 5, fontSize: 12, fontWeight: '900', color: '#37474F' },
  shiftTimePair: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 0 },
  shiftTimePairCompact: { gap: 1 },
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
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: COLORS.background },
  loadingText: { fontSize: 15, fontWeight: '700', color: COLORS.textLight },
})
