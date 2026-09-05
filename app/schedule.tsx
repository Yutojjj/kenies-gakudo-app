import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import AdminBottomNav, { ADMIN_BOTTOM_NAV_HEIGHT } from '../components/AdminBottomNav';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { sendPushNotification } from '../utils/sendPushNotification';
import { playUiSound } from '../utils/uiSounds';
import { handleWebWheelStep } from '../utils/webWheel';

const customAlert = (title: string, message?: string) => {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
};

type ChildInfo = { 
  id: string; 
  name: string; 
  grade: string; 
  school: string; 
  isStaffChild?: boolean; 
  parentName?: string; 
  days?: Record<string, boolean>;
  pickupTimes?: string[];
};
type LessonTemplate = { id: string; name: string; time: string; };
type DailyData = { pickupTime?: string | null; lessons?: LessonTemplate[]; memo?: string; }; // memoはschedule_memosコレクションで管理

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const PICKER_ITEM_HEIGHT = 41;
const PICKER_VIEW_HEIGHT = 132;
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const SCHEDULE_NOTIFY_DELAY_MS = 5 * 60 * 1000;

type ScheduleNotifyBatch = {
  timer: ReturnType<typeof setTimeout>;
  descriptions: string[];
};

const adminScheduleNotifyBatches: Record<string, ScheduleNotifyBatch> = {};

const LESSON_ACTION_IMG = require('../assets/menu/lesson_action.png');

export default function ScheduleScreen() {
  const router = useRouter();
  // リストなどから飛んできたときに対象となる児童の名前（同じ名前の兄弟などは一意のIDで判定します）
  const { name, dateStr: initialDateStr, openEdit, backTo } = useLocalSearchParams<{ name: string; dateStr?: string; openEdit?: string; backTo?: string }>();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [children, setChildren] = useState<ChildInfo[]>([]);
  const [activeChildIdx, setActiveChildIdx] = useState(0);
  const [initialLoading, setInitialLoading] = useState(false);
  
  const [parentDocId, setParentDocId] = useState('');

  const [scheduleData, setScheduleData] = useState<Record<string, DailyData>>({});
  const scheduleDataRef = useRef<Record<string, DailyData>>({});
  // 直近にローカルで保存した内容を一時保持。onSnapshotがサーバーの古い値で
  // 上書きして「入力したのに消える」のを防ぐ（保存がサーバーに反映されるまでの保護）
  const recentWritesRef = useRef<Record<string, { data: DailyData; at: number }>>({});
  const [schoolTimesData, setSchoolTimesData] = useState<Record<string, any>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, any[]>>({});
  
  const [holidays, setHolidays] = useState<any[]>([]); 
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});
  
  const [eventsData, setEventsData] = useState<Record<string, any>>({});
  const [participantData, setParticipantData] = useState<Record<string, any>>({});

  const [lessonTemplates, setLessonTemplates] = useState<LessonTemplate[]>([]);
  const [scheduleLessons, setScheduleLessons] = useState<any[]>([]);
  const [isStampingMode, setIsStampingMode] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<LessonTemplate | null>(null);
  const [isPickupStampingMode, setIsPickupStampingMode] = useState(false);
  const [activePickupTime, setActivePickupTime] = useState('');

  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [newPickupTimeInput, setNewPickupTimeInput] = useState('');
  const [pickupTimeSaving, setPickupTimeSaving] = useState(false);
  const [addPickupHour, setAddPickupHour] = useState(HOURS[0]);
  const [addPickupMinute, setAddPickupMinute] = useState(0);
  const [addPickupPickerVisible, setAddPickupPickerVisible] = useState(false);
  const [deletePickupTimeTarget, setDeletePickupTimeTarget] = useState<string | null>(null);
  const [templateSelectMode, setTemplateSelectMode] = useState<'stamping' | 'singleDay' | 'edit'>('stamping');
  const [editModalVisible, setEditModalVisible] = useState(false);
  
  const [eventModalVisible, setEventModalVisible] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState('');
  
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [timePickerTarget, setTimePickerTarget] = useState<'pickup' | 'lesson'>('pickup');
  const [editingLessonIndex, setEditingLessonIndex] = useState<number>(-1);
  const [tempHour, setTempHour] = useState(HOURS[0]);
  const [tempMinute, setTempMinute] = useState(0);

  const [lessonAddVisible, setLessonAddVisible] = useState(false);
  const [newLessonName, setNewLessonName] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [returnToEdit, setReturnToEdit] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState<{ name: string; accountId?: string; role: string } | null>(null);
  const [editingMemo, setEditingMemo] = useState('');
  const [memoData, setMemoData] = useState<Record<string, string>>({}); // key: childId_dateStr
  const memoDataRef = React.useRef<Record<string, string>>({});
  const [memoSaved, setMemoSaved] = useState(false);
  const pickerHapticAtRef = useRef(0);
  const addPickupHourScrollRef = useRef<any>(null);
  const addPickupMinuteScrollRef = useRef<any>(null);
  const timePickerHourScrollRef = useRef<any>(null);
  const timePickerMinuteScrollRef = useRef<any>(null);
  const lessonPickerHourScrollRef = useRef<any>(null);
  const lessonPickerMinuteScrollRef = useRef<any>(null);
  const addPickupHourWheelWrapRef = useRef<any>(null);
  const addPickupMinuteWheelWrapRef = useRef<any>(null);
  const timePickerHourWheelWrapRef = useRef<any>(null);
  const timePickerMinuteWheelWrapRef = useRef<any>(null);
  const lessonPickerHourWheelWrapRef = useRef<any>(null);
  const lessonPickerMinuteWheelWrapRef = useRef<any>(null);
  const addPickupHourWheelLockRef = useRef(0);
  const addPickupMinuteWheelLockRef = useRef(0);
  const timePickerHourWheelLockRef = useRef(0);
  const timePickerMinuteWheelLockRef = useRef(0);
  const lessonPickerHourWheelLockRef = useRef(0);
  const lessonPickerMinuteWheelLockRef = useRef(0);
  const pickerSettleTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [eventSectionCollapsed, setEventSectionCollapsed] = useState(false);
  const initialEditOpenedRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const listeners: Array<{ element: HTMLElement; onWheel: (event: WheelEvent) => void }> = [];
    const attach = (
      element: HTMLElement | null,
      values: number[],
      currentValue: number,
      setter: (value: number) => void,
      scrollRef: React.MutableRefObject<any>,
      lockRef: React.MutableRefObject<number>,
    ) => {
      if (!element) return;
      const onWheel = (event: WheelEvent) => handleWebWheelStep(event, {
        index: Math.max(0, values.indexOf(currentValue)),
        length: values.length,
        itemHeight: PICKER_ITEM_HEIGHT,
        lockRef,
        onIndexChange: nextIndex => {
          setter(values[nextIndex]);
          triggerPickerHaptic();
        },
        scrollTo: offset => scrollRef.current?.scrollTo?.({ y: offset, animated: true }),
      });
      element.addEventListener('wheel', onWheel, { passive: false });
      listeners.push({ element, onWheel });
    };

    if (addPickupPickerVisible) {
      attach(addPickupHourWheelWrapRef.current, HOURS, addPickupHour, setAddPickupHour, addPickupHourScrollRef, addPickupHourWheelLockRef);
      attach(addPickupMinuteWheelWrapRef.current, MINUTES, addPickupMinute, setAddPickupMinute, addPickupMinuteScrollRef, addPickupMinuteWheelLockRef);
    }
    if (timePickerVisible) {
      attach(timePickerHourWheelWrapRef.current, HOURS, tempHour, setTempHour, timePickerHourScrollRef, timePickerHourWheelLockRef);
      attach(timePickerMinuteWheelWrapRef.current, MINUTES, tempMinute, setTempMinute, timePickerMinuteScrollRef, timePickerMinuteWheelLockRef);
    }
    if (lessonAddVisible) {
      attach(lessonPickerHourWheelWrapRef.current, HOURS, tempHour, setTempHour, lessonPickerHourScrollRef, lessonPickerHourWheelLockRef);
      attach(lessonPickerMinuteWheelWrapRef.current, MINUTES, tempMinute, setTempMinute, lessonPickerMinuteScrollRef, lessonPickerMinuteWheelLockRef);
    }
    return () => listeners.forEach(({ element, onWheel }) => element.removeEventListener('wheel', onWheel));
  }, [addPickupPickerVisible, addPickupHour, addPickupMinute, timePickerVisible, tempHour, tempMinute, lessonAddVisible]);

  useEffect(() => {
    return () => {
      Object.values(pickerSettleTimersRef.current).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (!addPickupPickerVisible) return;
    const id = setTimeout(() => {
      addPickupHourScrollRef.current?.scrollTo?.({ y: getPickerOffset(HOURS, addPickupHour), animated: false });
      addPickupMinuteScrollRef.current?.scrollTo?.({ y: getPickerOffset(MINUTES, addPickupMinute), animated: false });
    }, 40);
    return () => clearTimeout(id);
  }, [addPickupPickerVisible]);

  useEffect(() => {
    if (!timePickerVisible) return;
    const id = setTimeout(() => {
      timePickerHourScrollRef.current?.scrollTo?.({ y: getPickerOffset(HOURS, tempHour), animated: false });
      timePickerMinuteScrollRef.current?.scrollTo?.({ y: getPickerOffset(MINUTES, tempMinute), animated: false });
    }, 40);
    return () => clearTimeout(id);
  }, [timePickerVisible]);

  useEffect(() => {
    if (!lessonAddVisible) return;
    const id = setTimeout(() => {
      lessonPickerHourScrollRef.current?.scrollTo?.({ y: getPickerOffset(HOURS, tempHour), animated: false });
      lessonPickerMinuteScrollRef.current?.scrollTo?.({ y: getPickerOffset(MINUTES, tempMinute), animated: false });
    }, 40);
    return () => clearTimeout(id);
  }, [lessonAddVisible]);

  const goHome = () => {
    if (backTo === 'previous') {
      if (router.canGoBack()) router.back();
      else router.replace('/user-list' as any);
      return;
    }
    router.replace('/menu' as any);
  };

  const formatScheduleModalDate = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getMonth() + 1}月${d.getDate()}日（${DAY_NAMES[d.getDay()]}）`;
  };

  const makeLocalDateString = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const queueAdminScheduleNotification = ({
    accountId,
    dateStr,
    childName,
    description,
    actorName,
  }: {
    accountId: string;
    dateStr: string;
    childName: string;
    description: string;
    actorName: string;
  }) => {
    if (!accountId || !description) return;
    const existingBatch = adminScheduleNotifyBatches[accountId];
    if (existingBatch) {
      existingBatch.descriptions.push(`${actorName}さん: ${dateStr} ${childName} ${description}`);
      return;
    }

    // 1件目は即時通知し、その後5分間の追加分だけを別通知にまとめる。
    sendPushNotification({
      accountIds: ['admin'],
      title: 'スケジュールが変更されました',
      body: `${actorName}さん: ${dateStr} ${childName} ${description}`,
      url: '/schedule-changes',
    }).catch(() => {});

    adminScheduleNotifyBatches[accountId] = {
      descriptions: [],
      timer: setTimeout(() => {
        const currentBatch = adminScheduleNotifyBatches[accountId];
        if (!currentBatch) return;
        delete adminScheduleNotifyBatches[accountId];
        const count = currentBatch.descriptions.length;
        if (count === 0) return;

        sendPushNotification({
          accountIds: ['admin'],
          title: 'スケジュール変更のお知らせ',
          body: `最初の通知以降、5分以内に${count}件の追加変更がありました。`,
          url: '/schedule-changes',
        }).catch(() => {});
      }, SCHEDULE_NOTIFY_DELAY_MS),
    };
  };

  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(raw => {
      if (raw) { try { setLoggedInUser(JSON.parse(raw)); } catch {} }
    });
  }, []);

  useEffect(() => {
    let isMounted = true;
    const unsubscribers: Array<() => void> = [];
    const addSubscription = (unsubscribe: () => void) => {
      if (isMounted) unsubscribers.push(unsubscribe);
      else unsubscribe();
    };

    setInitialLoading(true);
    AsyncStorage.removeItem(`scheduleScreenCache_${name || 'self'}`).catch(() => {});

    const fetchData = async () => {
      try {
        fetch('https://holidays-jp.github.io/api/v1/date.json')
          .then(res => res.json())
          .then(data => {
            if (!isMounted) return;
            setPublicHolidays(data);
          })
          .catch(e => console.warn('祝日APIの取得に失敗しました', e));

        const targetName = name || '';
        const storedUserRaw = await AsyncStorage.getItem('loggedInUser');
        let storedUser: any = null;
        try { storedUser = storedUserRaw ? JSON.parse(storedUserRaw) : null; } catch {}

        // 利用者本人は自分のアカウントを直接取得し、全アカウント検索を避ける。
        let accountDocs: any[] = [];
        if (storedUser?.role === 'user' && storedUser?.accountId) {
          const accountDoc = await getDoc(doc(db, 'accounts', storedUser.accountId));
          if (accountDoc.exists()) accountDocs = [accountDoc];
        } else {
          const snapshot = await getDocs(query(collection(db, 'accounts')));
          accountDocs = snapshot.docs;
        }
        
        let foundParentId = '';
        let foundData: any = null;
        let loadedChildIds: string[] = [];
        
        accountDocs.forEach(docSnap => {
           const d = docSnap.data();
           if (d.name === targetName || 
               (d.childName && d.childName === targetName) || 
               (d.siblings && d.siblings.some((s:any) => s.name === targetName)) ||
               (d.staffChildren && d.staffChildren.some((c:any) => c.name === targetName))) {
               foundParentId = docSnap.id;
               foundData = d;
           }
        });

        if (foundData) {
          if (!isMounted) return;
          setParentDocId(foundParentId);
          if (foundData.lessonTemplates) setLessonTemplates(foundData.lessonTemplates);
          
          const loadedChildren: ChildInfo[] = [];
          
          if (foundData.role === 'staff' && foundData.hasChild) {
             if (foundData.staffChildren && foundData.staffChildren.length > 0) {
                 foundData.staffChildren.forEach((child: any, idx: number) => {
                     loadedChildren.push({
                         id: child.id || `${foundParentId}_staffchild_${idx}`,
                         name: child.name,
                         school: child.school || '',
                         grade: child.grade || '',
                         isStaffChild: true,
                         parentName: foundData.name
                     });
                 });
             } else if (foundData.childName) {
                 loadedChildren.push({
                     id: `${foundParentId}_staffchild_0`,
                     name: foundData.childName,
                     school: foundData.childSchool || '',
                     grade: foundData.childGrade || '',
                     isStaffChild: true,
                     parentName: foundData.name
                 });
             }
          } else if (foundData.role === 'user') {
            loadedChildren.push({ 
              id: foundParentId, 
              name: foundData.name, 
              grade: foundData.grade || '', 
              school: foundData.school || '', 
              isStaffChild: false,
              days: foundData.days || {},
              pickupTimes: foundData.pickupTimes || []
            });
            if (foundData.siblings && Array.isArray(foundData.siblings)) {
              foundData.siblings.forEach((sib: any, idx: number) => {
                loadedChildren.push({ 
                  id: sib.id || `${foundParentId}_sib_${idx}`, 
                  name: sib.name, 
                  grade: sib.grade || '', 
                  school: sib.school || '', 
                  isStaffChild: false,
                  days: sib.days || {},
                  pickupTimes: sib.pickupTimes || []
                });
              });
            }
          }
          setChildren(loadedChildren);
          loadedChildIds = loadedChildren.map(child => child.id);
          
          // 開いた時に、渡された名前の子のタブをアクティブにする
          const targetIndex = loadedChildren.findIndex(c => c.name === targetName);
          if (targetIndex !== -1) setActiveChildIdx(targetIndex);

          addSubscription(onSnapshot(query(collection(db, 'schedules2'), where('parentId', '==', foundParentId)), (sSnap) => {
            const sData: Record<string, DailyData> = {};
            sSnap.forEach(d => {
              const item = d.data();
              let lessons: LessonTemplate[] = [];
              if (item.lessons) {
                  lessons = item.lessons;
              } else if (item.lesson) {
                  lessons = [item.lesson];
              }
              sData[`${item.childId}_${item.dateStr}`] = { pickupTime: item.pickupTime, lessons: lessons, memo: item.memo };
            });

            // 直近5秒以内にローカル保存した内容を保護
            const now = Date.now();
            Object.entries(recentWritesRef.current).forEach(([key, rec]) => {
              if (now - rec.at < 5000) {
                sData[key] = { ...sData[key], ...rec.data };
              } else {
                delete recentWritesRef.current[key];
              }
            });

            // schedule_memosのデータもマージ（memoDataRefが優先）
            Object.entries(memoDataRef.current).forEach(([key, memo]) => {
              if (sData[key]) sData[key] = { ...sData[key], memo };
              else sData[key] = { memo };
            });

            scheduleDataRef.current = sData;
            setScheduleData(sData);
            setInitialLoading(false);
          }, error => {
            console.warn('スケジュール読み込み失敗', error);
            if (isMounted) setInitialLoading(false);
          }));

          // schedule_memosを読み込む（メモはschedule_memosコレクションで管理されており、schedulesには保存されない）
          try {
            const memosSnap = await getDocs(query(collection(db, 'schedule_memos'), where('parentId', '==', foundParentId)));
            const loadedMemos: Record<string, string> = {};
            memosSnap.forEach(d => {
              const item = d.data();
              if (item.childId && item.dateStr && item.memo !== undefined) {
                loadedMemos[`${item.childId}_${item.dateStr}`] = item.memo;
              }
            });
            memoDataRef.current = loadedMemos;
            setMemoData(loadedMemos);
          } catch (e) {
            console.warn('schedule_memos 読み込み失敗', e);
          }
          
          addSubscription(onSnapshot(doc(db, 'accounts', foundParentId), (accSnap) => {
             if(accSnap.exists()) {
                 const accData = accSnap.data();
                 if(accData.lessonTemplates) setLessonTemplates(accData.lessonTemplates);
             }
          }));
        }

        addSubscription(onSnapshot(collection(db, 'school_times'), (snap) => {
          const times: Record<string, any> = {};
          snap.forEach(d => { times[d.id] = d.data(); });
          setSchoolTimesData(times);
        }));

        if (foundData?.role === 'staff') {
          addSubscription(onSnapshot(collection(db, 'assigned_shifts'), (snap) => {
            const shifts: Record<string, any[]> = {};
            snap.forEach(d => { shifts[d.id] = d.data().staff || []; });
            setAssignedShifts(shifts);
          }));
        }

        addSubscription(onSnapshot(doc(db, 'settings', 'holidays_data'), (docSnap) => {
          if (docSnap.exists() && docSnap.data().periods) {
            const periods = docSnap.data().periods;
            setHolidays(periods);
          } else {
            setHolidays([]);
          }
        }));

        const childScopedLessons = loadedChildIds.length > 0 && loadedChildIds.length <= 30
          ? query(collection(db, 'lessons'), where('childId', 'in', loadedChildIds))
          : query(collection(db, 'lessons'));
        addSubscription(onSnapshot(childScopedLessons, (snap) => {
          const nextLessons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          setScheduleLessons(nextLessons);
        }));

        addSubscription(onSnapshot(collection(db, 'events'), (snap) => {
          const eData: Record<string, any> = {};
          snap.forEach(d => { eData[d.id] = d.data(); });
          setEventsData(eData);
        }));
        
        const childScopedParticipants = loadedChildIds.length > 0 && loadedChildIds.length <= 30
          ? query(collection(db, 'event_participants'), where('childId', 'in', loadedChildIds))
          : query(collection(db, 'event_participants'));
        addSubscription(onSnapshot(childScopedParticipants, (snap) => {
           const pData: Record<string, any> = {};
           snap.forEach(d => {
               const item = d.data();
               if (!pData[item.eventId]) pData[item.eventId] = {};
               pData[item.eventId][item.childId] = item.status;
           });
           setParticipantData(pData);
        }));

      } catch (error) {
        console.error("データ取得エラー:", error);
        if (isMounted) setInitialLoading(false);
      }
    };
    fetchData();
    return () => {
      isMounted = false;
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [name]);

  const saveLessonTemplate = async () => {
    if (!newLessonName.trim()) {
      customAlert('エラー', '習い事の名前を入力してください。');
      return;
    }
    const timeStr = `${String(tempHour).padStart(2, '0')}:${String(tempMinute).padStart(2, '0')}`;
    let newTemplates = [...lessonTemplates];

    if (editingTemplateId) {
      newTemplates = newTemplates.map(t => t.id === editingTemplateId ? { ...t, name: newLessonName, time: timeStr } : t);
    } else {
      newTemplates.push({ id: Date.now().toString(), name: newLessonName, time: timeStr });
    }

    try {
      await setDoc(doc(db, 'accounts', parentDocId), { lessonTemplates: newTemplates }, { merge: true });
      setLessonAddVisible(false);
      setNewLessonName('');
      setEditingTemplateId(null);
      setTimeout(() => setTemplateModalVisible(true), 300);
    } catch(e) {
      customAlert('エラー', '習い事の保存に失敗しました。');
    }
  };

  const deleteLessonTemplate = (id: string) => {
    if (Platform.OS === 'web') {
      if (window.confirm('この習い事の項目を削除しますか？\n(※すでに登録済みのスケジュールは消えません)')) {
         const newTemplates = lessonTemplates.filter(t => t.id !== id);
         setDoc(doc(db, 'accounts', parentDocId), { lessonTemplates: newTemplates }, { merge: true });
      }
      return;
    }
    Alert.alert('削除確認', 'この習い事の項目を削除しますか？\n(※すでに登録済みのスケジュールは消えません)', [
      { text: 'キャンセル' },
      { text: '削除', style: 'destructive', onPress: async () => {
         const newTemplates = lessonTemplates.filter(t => t.id !== id);
         await setDoc(doc(db, 'accounts', parentDocId), { lessonTemplates: newTemplates }, { merge: true });
      }}
    ]);
  };

  const buildChangeDesc = (data: Partial<DailyData>, current: Partial<DailyData>): string | null => {
    if (data.pickupTime !== undefined) {
      return data.pickupTime === null ? 'お迎え: お休み' : `お迎え: ${data.pickupTime}`;
    }
    if (data.lessons !== undefined) {
      const oldL = current.lessons || [];
      const newL = data.lessons || [];
      if (newL.length > oldL.length) {
        const added = newL.find(n => !oldL.find(o => o.id === n.id));
        return added ? `${added.name}: ${added.time || '追加'}` : '習い事を追加';
      }
      if (newL.length < oldL.length) {
        const removed = oldL.find(o => !newL.find(n => n.id === o.id));
        return removed ? `${removed.name}: お休み` : '習い事: お休み';
      }
      const changed = newL.find(n => {
        const old = oldL.find(o => o.id === n.id);
        return old && (old.name !== n.name || old.time !== n.time);
      });
      if (changed) return `${changed.name}: ${changed.time || '変更'}`;
      return '習い事を変更';
    }
    return null;
  };

  const buildChangeKey = (data: Partial<DailyData>, current: Partial<DailyData>): string => {
    if (data.pickupTime !== undefined) return 'pickup';
    if (data.lessons !== undefined) {
      const oldL = current.lessons || [];
      const newL = data.lessons || [];
      const added = newL.find(n => !oldL.find(o => o.id === n.id));
      if (added) return `lesson:${added.name || added.id}`;
      const removed = oldL.find(o => !newL.find(n => n.id === o.id));
      if (removed) return `lesson:${removed.name || removed.id}`;
      const changed = newL.find(n => {
        const old = oldL.find(o => o.id === n.id);
        return old && (old.name !== n.name || old.time !== n.time);
      });
      if (changed) return `lesson:${changed.name || changed.id}`;
    }
    return 'schedule';
  };

  const saveToFirestore = async (dateStr: string, data: Partial<DailyData>) => {
    const child = children[activeChildIdx];
    if (!child) return;
    const docId = `${child.id}_${dateStr}`;
    const current = scheduleDataRef.current[docId] || {};

    // refとstateを同時更新（onSnapshotとの競合防止）
    const mergedForDoc = { ...(scheduleDataRef.current[docId] || {}), ...data };
    const updated = { ...scheduleDataRef.current, [docId]: mergedForDoc };
    scheduleDataRef.current = updated;
    setScheduleData({ ...updated });
    // 直近保存として記録（onSnapshotの巻き戻り防止）
    recentWritesRef.current[docId] = { data: mergedForDoc as DailyData, at: Date.now() };

    try {
      // ★ 保存前にサーバーの現在値を確認して既存フィールドを保護
      // キャッシュが古い状態でも、サーバーに既に値があれば上書きしない
      const serverDoc = await getDoc(doc(db, 'schedules2', docId));
      const serverData = serverDoc.exists() ? serverDoc.data() : {};

      const saveData: any = { parentId: parentDocId, childId: child.id, childName: child.name, kidName: child.name, dateStr, updatedAt: new Date() };
      if (data.pickupTime !== undefined) saveData.pickupTime = data.pickupTime;
      if (data.lessons !== undefined) saveData.lessons = data.lessons;
      // memoはschedule_memosコレクションに別途保存
      if (data.memo !== undefined) {
        const memoDocId = `${child.id}_${dateStr}`;
        const memoRef = doc(db, 'schedule_memos', memoDocId);
        await setDoc(memoRef, {
          parentId: parentDocId,
          childId: child.id,
          childName: child.name,
          dateStr,
          memo: data.memo || '',
          updatedAt: new Date(),
        }, { merge: true });
        // ローカルのmemoDataも更新
        const newMemos = { ...memoDataRef.current, [memoDocId]: data.memo || '' };
        memoDataRef.current = newMemos;
        setMemoData(newMemos);
      }
      await setDoc(doc(db, 'schedules2', docId), saveData, { merge: true });

      const desc = buildChangeDesc(data, current);
      if (loggedInUser && desc) {
        const changeKey = buildChangeKey(data, current);
        await addDoc(collection(db, 'scheduleChanges'), {
          date: dateStr,
          userId: parentDocId,
          userName: loggedInUser.name,
          actorRole: loggedInUser.role,
          childName: child.name,
          changeKey,
          description: desc,
          changedAt: serverTimestamp(),
        });

        // 変更対象日が今月で、管理者以外の操作であれば管理者へ通知
        if (loggedInUser.role !== 'admin') {
          const today = new Date();
          const changeDay = new Date(dateStr);
          const isSameMonth =
            changeDay.getFullYear() === today.getFullYear() &&
            changeDay.getMonth() === today.getMonth();
          if (isSameMonth) {
            let changeNotificationsEnabled = true;
            try {
              const setting = await getDoc(doc(db, 'settings', 'schedule_change_notifications'));
              changeNotificationsEnabled = setting.exists() ? setting.data().enabled !== false : true;
            } catch {
              // 設定が読めない場合は、従来どおり通知を止めない
            }
            if (changeNotificationsEnabled) {
              // 管理者への変更通知は、直近5分以内の変更を1通にまとめる。
              queueAdminScheduleNotification({
                accountId: parentDocId,
                dateStr,
                childName: child.name,
                description: desc,
                actorName: loggedInUser.name,
              });
            }
          }
        }
      }
    } catch (e) {
      customAlert('エラー', 'データの保存に失敗しました');
    }
  };
  
  const toggleEventParticipation = async (eventId: string, isAttending: boolean) => {
     const child = children[activeChildIdx];
     if (!child) return;
     
     const docId = `${eventId}_${child.id}`;
     try {
         if (isAttending) {
            await setDoc(doc(db, 'event_participants', docId), {
                eventId,
                childId: child.id,
                childName: child.name,
                status: '参加',
                updatedAt: new Date()
            });
         } else {
             const { deleteDoc } = require('firebase/firestore');
             await deleteDoc(doc(db, 'event_participants', docId));
         }
         setEventSectionCollapsed(true);
         customAlert('完了', isAttending ? '参加を申し込みました' : '参加をキャンセルしました');
     } catch(e) {
         customAlert('エラー', '操作に失敗しました');
     }
  };

  const getAutoPickupTime = (dateStr: string, child: ChildInfo) => {
    const d = new Date(dateStr);
    const dayOfWeekStr = DAY_NAMES[d.getDay()];
    
    if (dayOfWeekStr === '日' || dayOfWeekStr === '土') return null;
    if (publicHolidays[dateStr]) return null;
    if (!child.isStaffChild && child.days && !child.days[dayOfWeekStr]) return null;

    const isHoliday = holidays.some(h => dateStr >= h.start && dateStr <= h.end);
    if (isHoliday) return null;

    if (child.isStaffChild) {
      const todaysShift = assignedShifts[dateStr] || [];
      const parentHasShift = todaysShift.some((staff: any) => staff.name === child.parentName);
      if (!parentHasShift) return null;
    }

    return schoolTimesData[child.school]?.[child.grade]?.[dayOfWeekStr] || null;
  };

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
      days.push({ day: i, dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
    }
    return days;
  };

  const getScheduleKey = (dateStr: string) => {
    const child = children[activeChildIdx];
    return child ? `${child.id}_${dateStr}` : dateStr;
  };

  const getCellData = (dateStr: string) => {
    const key = getScheduleKey(dateStr);
    const userOverride = scheduleDataRef.current[key] || {};
    const child = children[activeChildIdx];
    
    const autoPickup = child ? getAutoPickupTime(dateStr, child) : null;
    const finalPickup = userOverride.pickupTime !== undefined ? userOverride.pickupTime : autoPickup;
    
    // 定期習い事を追加（習い事一覧管理から取得）
    const d = new Date(dateStr);
    const dow = ['日','月','火','水','木','金','土'][d.getDay()];
    const childId = child?.id;

    // ▼ 修正: その日に登園しない（pickupTime が null かつ手動override もない）場合は
    //   定期習い事も表示しない。手動overrideで pickup を明示設定した日は表示する。
    const willAttend = finalPickup !== null && finalPickup !== undefined;
    const regularLessons = (childId && willAttend)
      ? scheduleLessons
          .filter(l => l.childId === childId && l.dayOfWeek === dow)
          .map(l => ({ id: l.id, name: l.lessonName, time: l.lessonTime }))
      : [];
    const overrideLessons = userOverride.lessons || [];
    // overrideとregularをマージ（override優先、重複除外）
    const allLessons = [
      ...overrideLessons,
      ...regularLessons.filter(r => !overrideLessons.find((o: any) => o.name === r.name)),
    ];

    return { pickupTime: finalPickup === null ? undefined : finalPickup, lessons: allLessons, memo: memoDataRef.current[key] || userOverride.memo };
  };

  const changeMonth = (offset: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
  };

  const handleDayPress = (dateStr: string) => {
    if (isPickupStampingMode && activePickupTime) {
      saveToFirestore(dateStr, { pickupTime: activePickupTime });
    } else if (isStampingMode && activeTemplate) {
      const key = getScheduleKey(dateStr);
      const currentLessons = scheduleDataRef.current[key]?.lessons || [];
      const existingIdx = currentLessons.findIndex(l => l.id === activeTemplate.id);
      
      let newLessons = [...currentLessons];
      if (existingIdx >= 0) {
          newLessons.splice(existingIdx, 1);
      } else {
          newLessons.push(activeTemplate);
      }
      saveToFirestore(dateStr, { lessons: newLessons });
    } else {
      setSelectedDateStr(dateStr);
      const key = getScheduleKey(dateStr);
      setEditingMemo(memoDataRef.current[key] || scheduleDataRef.current[key]?.memo || '');
      setMemoSaved(false);
      setEventSectionCollapsed(false);
      setEditModalVisible(true);
    }
  };

  useEffect(() => {
    if (openEdit !== '1' || !initialDateStr || initialEditOpenedRef.current || children.length === 0) return;
    initialEditOpenedRef.current = true;
    const target = String(initialDateStr);
    const parsed = new Date(target);
    if (!isNaN(parsed.getTime())) setCurrentDate(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    setTimeout(() => handleDayPress(target), 250);
  }, [openEdit, initialDateStr, children.length]);

  const openTimePicker = (target: 'pickup' | 'lesson', defaultTime: string, lessonIndex: number = -1) => {
    setEditModalVisible(false); // モーダル重複によるフリーズを防ぐ
    setTimePickerTarget(target);
    setEditingLessonIndex(lessonIndex);
    if (defaultTime) {
      const [h, m] = defaultTime.split(':').map(Number);
      setTempHour(h); setTempMinute(m);
    } else {
      setTempHour(HOURS[0]); setTempMinute(MINUTES[0]);
    }
    // 中央の時刻パネルを軽く表示する
    setTimeout(() => setTimePickerVisible(true), 120);
  };

  const getPickerOffset = (values: number[], value: number) => {
    const index = Math.max(0, values.indexOf(value));
    return index * PICKER_ITEM_HEIGHT;
  };

  const getPickerValueFromOffset = (values: number[], y: number) => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(y / PICKER_ITEM_HEIGHT)));
    return values[index];
  };

  const triggerPickerHaptic = () => {
    const now = Date.now();
    if (now - pickerHapticAtRef.current < 45) return;
    pickerHapticAtRef.current = now;
    playUiSound('tick');
    if (Platform.OS === 'web') {
      try {
        (globalThis as any).navigator?.vibrate?.(8);
      } catch {}
      return;
    }
    Haptics.selectionAsync().catch(() => {});
  };

  const applyPickerValue = (currentValue: number, nextValue: number, setter: (value: number) => void) => {
    if (currentValue === nextValue) return;
    setter(nextValue);
    triggerPickerHaptic();
  };

  const scrollPickerToValue = (scrollRef: React.MutableRefObject<any>, values: number[], value: number, animated = true) => {
    scrollRef.current?.scrollTo?.({
      y: getPickerOffset(values, value),
      animated,
    });
  };

  const forceSettlePickerValue = (
    values: number[],
    y: number,
    setter: (value: number) => void,
    scrollRef: React.MutableRefObject<any>,
    animated = true,
  ) => {
    const nextValue = getPickerValueFromOffset(values, y);
    const targetY = getPickerOffset(values, nextValue);
    setter(nextValue);
    if (Math.abs(y - targetY) > 0.5) {
      scrollRef.current?.scrollTo?.({ y: targetY, animated });
    }
  };

  const settlePickerValue = (
    values: number[],
    y: number,
    currentValue: number,
    setter: (value: number) => void,
    scrollRef: React.MutableRefObject<any>,
  ) => {
    const nextValue = getPickerValueFromOffset(values, y);
    applyPickerValue(currentValue, nextValue, setter);
    const targetY = getPickerOffset(values, nextValue);
    requestAnimationFrame(() => forceSettlePickerValue(values, targetY, setter, scrollRef, true));
    setTimeout(() => forceSettlePickerValue(values, targetY, setter, scrollRef, true), 80);
  };

  const handlePickerScroll = (
    key: string,
    values: number[],
    y: number,
    currentValue: number,
    setter: (value: number) => void,
    scrollRef: React.MutableRefObject<any>,
  ) => {
    applyPickerValue(currentValue, getPickerValueFromOffset(values, y), setter);
    if (pickerSettleTimersRef.current[key]) {
      clearTimeout(pickerSettleTimersRef.current[key]);
    }
    pickerSettleTimersRef.current[key] = setTimeout(() => {
      forceSettlePickerValue(values, y, setter, scrollRef, true);
    }, 120);
  };

  const selectPickerValue = (
    values: number[],
    value: number,
    setter: (value: number) => void,
    scrollRef: React.MutableRefObject<any>,
  ) => {
    setter(value);
    triggerPickerHaptic();
    scrollPickerToValue(scrollRef, values, value, true);
  };

  const removeSavedPickupTime = (timeToRemove: string) => {
    setDeletePickupTimeTarget(timeToRemove);
  };

  const confirmTime = () => {
    const timeStr = `${String(tempHour).padStart(2, '0')}:${String(tempMinute).padStart(2, '0')}`;
    const key = getScheduleKey(selectedDateStr);
    const current = scheduleDataRef.current[key] || {};

    if (timePickerTarget === 'pickup') {
      saveToFirestore(selectedDateStr, { pickupTime: timeStr });
    } else if (timePickerTarget === 'lesson' && editingLessonIndex >= 0) {
      const updatedLessons = [...(current.lessons || [])];
      updatedLessons[editingLessonIndex] = { ...updatedLessons[editingLessonIndex], time: timeStr };
      saveToFirestore(selectedDateStr, { lessons: updatedLessons });
    }
    setTimePickerVisible(false);
    setTimeout(() => setEditModalVisible(true), 300);
  };

  const deleteItem = async (target: 'pickup' | 'lesson', lessonIndex: number = -1) => {
    const child = children[activeChildIdx];
    if (!child) return;
    const key = getScheduleKey(selectedDateStr);
    const current = scheduleDataRef.current[key] || {};

    if (target === 'pickup') {
       saveToFirestore(selectedDateStr, { pickupTime: null });
    } else if (target === 'lesson' && lessonIndex >= 0) {
       const updatedLessons = [...(current.lessons || [])];
       updatedLessons.splice(lessonIndex, 1);
       saveToFirestore(selectedDateStr, { lessons: updatedLessons });
    }
  };

  // 候補時間をaccountsドキュメントに保存
  const savePickupTimeToAccount = async (newTime: string) => {
    const child = children[activeChildIdx];
    if (!child || !parentDocId) return;
    const current = child.pickupTimes || [];
    if (current.includes(newTime)) return;
    const updated = [...current, newTime].sort();
    // childrenのstateを更新
    setChildren(prev => prev.map((c, i) =>
      i === activeChildIdx ? { ...c, pickupTimes: updated } : c
    ));
    // Firestoreに保存
    const accountSnap = await import('firebase/firestore').then(m =>
      m.getDoc(m.doc(import('../firebase').then(f => f.db) as any, 'accounts', parentDocId))
    ).catch(() => null);
    // getDocは既にインポート済みなので直接使う
    const accDoc = await getDoc(doc(db, 'accounts', parentDocId));
    if (!accDoc.exists()) return;
    const data = accDoc.data();
    if (child.id === parentDocId) {
      // 本人
      await setDoc(doc(db, 'accounts', parentDocId), { pickupTimes: updated }, { merge: true });
    } else {
      // 兄弟 or staffchild
      const siblings = data.siblings || [];
      const updatedSiblings = siblings.map((s: any) =>
        s.id === child.id ? { ...s, pickupTimes: updated } : s
      );
      await setDoc(doc(db, 'accounts', parentDocId), { siblings: updatedSiblings }, { merge: true });
    }
  };

  const removePickupTimeFromAccount = async (timeToRemove: string) => {
    const child = children[activeChildIdx];
    if (!child || !parentDocId) return;
    const updated = (child.pickupTimes || []).filter(t => t !== timeToRemove);
    setChildren(prev => prev.map((c, i) =>
      i === activeChildIdx ? { ...c, pickupTimes: updated } : c
    ));
    const accDoc = await getDoc(doc(db, 'accounts', parentDocId));
    if (!accDoc.exists()) return;
    const data = accDoc.data();
    if (child.id === parentDocId) {
      await setDoc(doc(db, 'accounts', parentDocId), { pickupTimes: updated }, { merge: true });
    } else {
      const siblings = data.siblings || [];
      const updatedSiblings = siblings.map((s: any) =>
        s.id === child.id ? { ...s, pickupTimes: updated } : s
      );
      await setDoc(doc(db, 'accounts', parentDocId), { siblings: updatedSiblings }, { merge: true });
    }
  };

  const closeTemplateAndMaybeReturnToEdit = () => {
    setTemplateModalVisible(false);
    if (returnToEdit) {
      setReturnToEdit(false);
      setTimeout(() => setEditModalVisible(true), 300);
    }
  };

  const handleSelectTemplate = (template: LessonTemplate) => {
    if (templateSelectMode === 'edit') {
        setTemplateModalVisible(false);
        setEditingTemplateId(template.id);
        setNewLessonName(template.name);
        const [h, m] = template.time.split(':').map(Number);
        setTempHour(h); setTempMinute(m);
        setTimeout(() => setLessonAddVisible(true), 300);
    } else if (templateSelectMode === 'stamping') {
      setIsPickupStampingMode(false);
      setActivePickupTime('');
      setActiveTemplate(template);
      setIsStampingMode(true);
      setTemplateModalVisible(false);
    } else {
      const key = getScheduleKey(selectedDateStr);
      const currentLessons = scheduleDataRef.current[key]?.lessons || [];
      if (!currentLessons.find((l: any) => l.id === template.id)) {
          const newLessons = [...currentLessons, template];
          saveToFirestore(selectedDateStr, { lessons: newLessons });
      }
      closeTemplateAndMaybeReturnToEdit();
    }
  };

  if (children.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ fontSize: 16, color: COLORS.textLight }}>スケジュールを管理する児童データがありません。</Text>
        <TouchableOpacity style={{ marginTop: 20, padding: 12, backgroundColor: COLORS.primary, borderRadius: 8 }} onPress={goHome}>
          <Text style={{ color: COLORS.white, fontWeight: 'bold' }}>戻る</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const renderCalendar = () => {
    const days = generateCalendarDays();
    return (
      <View style={styles.calendarContainer}>
        <View style={styles.calHeaderRow}>
          {DAY_NAMES.map((w, i) => <Text key={i} style={[styles.calWeekText, i === 0 && {color: 'red'}, i === 6 && {color: 'blue'}]}>{w}</Text>)}
        </View>
        <View style={styles.calGrid}>
          {days.map((item, index) => {
            if (!item) return <View key={`empty-${index}`} style={styles.calCellEmpty} />;
            
            const cellData = getCellData(item.dateStr);
            const d = new Date(item.dateStr);
            const isSunday = d.getDay() === 0;
            const isSaturday = d.getDay() === 6;
            const isPublicHoliday = !!publicHolidays[item.dateStr]; 
            const isEventDay = !!eventsData[item.dateStr]; 

            let dateColor = COLORS.text;
            if (isSunday || isPublicHoliday) {
              dateColor = 'red';
            } else if (isSaturday) {
              dateColor = 'blue';
            }

            const holidayPeriod = holidays.find((h: any) => item.dateStr >= h.start && item.dateStr <= h.end);
            const holidayBg = holidayPeriod?.color || null;

            return (
              <TouchableOpacity key={item.dateStr} style={[styles.calCell, isStampingMode && styles.calCellStamping, holidayBg && { backgroundColor: holidayBg }]} onPress={() => handleDayPress(item.dateStr)}>
                <Text style={[styles.calDayText, { color: dateColor }]}>
                  {item.day}
                </Text>
                
                <View style={styles.cellContent}>
                  {isEventDay && (
                    <View style={styles.eventBadge}>
                      <Text style={styles.eventBadgeText} numberOfLines={1}>{eventsData[item.dateStr].title}</Text>
                    </View>
                  )}
                  {cellData.pickupTime && <View style={styles.pickupBadge}><Text style={styles.pickupText}>迎 {cellData.pickupTime}</Text></View>}
                  {(cellData.memo || memoData[getScheduleKey(item.dateStr)]) && (
                    <View style={styles.memoBadge}>
                      <Text style={styles.memoIndicatorText} numberOfLines={2}>📝 {cellData.memo || memoData[getScheduleKey(item.dateStr)]}</Text>
                    </View>
                  )}
                  
                  {cellData.lessons && cellData.lessons.length > 0 && cellData.lessons.map((lesson, idx) => (
                      <View key={`les-${idx}`} style={styles.lessonBadge}>
                        <Text style={styles.lessonText}>{lesson.name}</Text>
                        <Text style={styles.lessonTimeText}>{lesson.time}</Text>
                      </View>
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* ── 背景装飾 ── */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {([
          { emoji: '⭐', top: 80,  left: 12,  size: 20, rotate: '15deg',  opacity: 0.13 },
          { emoji: '✏️', top: 75,  right: 14, size: 22, rotate: '-18deg', opacity: 0.12 },
          { emoji: '🌸', top: 200, left: 8,   size: 20, rotate: '-8deg',  opacity: 0.12 },
          { emoji: '📅', top: 210, right: 10, size: 20, rotate: '10deg',  opacity: 0.11 },
          { emoji: '🎵', top: 370, left: 8,   size: 18, rotate: '12deg',  opacity: 0.12 },
          { emoji: '🌟', top: 380, right: 10, size: 18, rotate: '-10deg', opacity: 0.11 },
          { emoji: '🎈', top: 540, left: 8,   size: 20, rotate: '-15deg', opacity: 0.11 },
          { emoji: '✏️', top: 550, right: 12, size: 20, rotate: '20deg',  opacity: 0.12 },
          { emoji: '🌸', top: 700, left: 10,  size: 18, rotate: '6deg',   opacity: 0.11 },
          { emoji: '⭐', top: 710, right: 12, size: 18, rotate: '-12deg', opacity: 0.12 },
        ] as const).map((d, i) => (
          <Text key={i} style={{ position: 'absolute', top: d.top, ...(('left' in d) ? { left: d.left } : { right: d.right }), fontSize: d.size, opacity: d.opacity, transform: [{ rotate: d.rotate }] }}>
            {d.emoji}
          </Text>
        ))}
      </View>

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goHome}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>スケジュール</Text>
      </View>

      {initialLoading && children.length === 0 && (
        <View style={styles.initialLoadingBar}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.initialLoadingText}>予定を読み込んでいます</Text>
        </View>
      )}

      {children.length > 0 && (
        <View style={styles.childTabs}>
          {children.map((child, idx) => (
            <TouchableOpacity key={child.id} style={[styles.childTabBtn, activeChildIdx === idx && styles.childTabBtnActive]} onPress={() => setActiveChildIdx(idx)}>
              <Ionicons name="person" size={16} color={activeChildIdx === idx ? COLORS.primary : COLORS.textLight} />
              <Text style={[styles.childTabText, activeChildIdx === idx && styles.childTabTextActive]}>{child.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {((isStampingMode && activeTemplate) || (isPickupStampingMode && activePickupTime)) && (
        <View style={styles.stampingBanner}>
          <Text style={styles.stampingText}>
            {isPickupStampingMode && activePickupTime
              ? `選択中: お迎え ${activePickupTime}`
              : `選択中: ${activeTemplate?.name} (${activeTemplate?.time})`}
          </Text>
          <TouchableOpacity style={styles.stampingEndBtn} onPress={() => { setIsStampingMode(false); setIsPickupStampingMode(false); setActivePickupTime(''); }}>
            <Text style={styles.stampingEndText}>終了</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollAreaContent}>
        <View style={styles.monthSelector}>
          <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.monthBtn}>
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.monthText}>{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</Text>
          <TouchableOpacity onPress={() => changeMonth(1)} style={styles.monthBtn}>
            <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
          </TouchableOpacity>
        </View>
        {renderCalendar()}
      </ScrollView>

      <View style={styles.bulkInputBar}>
        <TouchableOpacity
          style={[styles.bulkInputButton, styles.bulkPickupButton, isPickupStampingMode && styles.bulkInputButtonActive]}
          onPress={() => {
            setAddPickupPickerVisible(true);
          }}
          activeOpacity={0.84}
        >
          <Ionicons name="car-outline" size={18} color="#A05B00" />
          <View style={{ flex: 1 }}>
            <Text style={styles.bulkInputTitle}>お迎え</Text>
            <Text style={styles.bulkInputSubText}>{isPickupStampingMode && activePickupTime ? `${activePickupTime} を入力中` : 'かんたん入力'}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.bulkInputButton, styles.bulkLessonButton, isStampingMode && styles.bulkInputButtonActive]}
          onPress={() => {
            setIsPickupStampingMode(false);
            setActivePickupTime('');
            setTemplateSelectMode('stamping');
            setTemplateModalVisible(true);
          }}
          activeOpacity={0.84}
        >
          <Ionicons name="musical-notes-outline" size={18} color="#2C70B8" />
          <View style={{ flex: 1 }}>
            <Text style={styles.bulkInputTitle}>習い事</Text>
            <Text style={styles.bulkInputSubText}>{isStampingMode && activeTemplate ? `${activeTemplate.name} を入力中` : 'かんたん入力'}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Modal visible={editModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={() => setEditModalVisible(false)} accessible={false}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={[styles.editModalContent, styles.modalSurface]}>
            <View style={styles.scheduleSheetHeader}>
              <View style={styles.scheduleDateStepper}>
                <TouchableOpacity
                  style={styles.scheduleDateArrow}
                  onPress={() => {
                    const d = new Date(selectedDateStr);
                    d.setDate(d.getDate() - 1);
                    handleDayPress(makeLocalDateString(d));
                  }}
                >
                  <Ionicons name="chevron-back" size={19} color="#64748B" />
                </TouchableOpacity>
                <Text style={styles.scheduleSheetTitle}>
                  {formatScheduleModalDate(selectedDateStr)}
                  {publicHolidays[selectedDateStr] ? ` (${publicHolidays[selectedDateStr]})` : ''}
                </Text>
                <TouchableOpacity
                  style={styles.scheduleDateArrow}
                  onPress={() => {
                    const d = new Date(selectedDateStr);
                    d.setDate(d.getDate() + 1);
                    handleDayPress(makeLocalDateString(d));
                  }}
                >
                  <Ionicons name="chevron-forward" size={19} color="#64748B" />
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.scheduleSheetIconBtn} onPress={() => setEditModalVisible(false)}>
                <Ionicons name="close" size={28} color="#475569" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.pickupHeroCard}>
                <View style={styles.pickupHeroTop}>
                  <View style={styles.pickupHeroLabel}>
                    <Ionicons name="car-outline" size={18} color="#F59E0B" />
                    <Text style={styles.pickupHeroLabelText}>学校へのお迎え・利用開始時刻</Text>
                  </View>
                  <TouchableOpacity style={styles.scheduleEditPill} onPress={() => openTimePicker('pickup', getCellData(selectedDateStr).pickupTime || '15:00')}>
                    <Text style={styles.scheduleEditPillText}>編集</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.pickupHeroTimeRow}>
                  <Ionicons name="time-outline" size={18} color="#F59E0B" />
                  <Text style={styles.pickupHeroTime}>{getCellData(selectedDateStr).pickupTime || '利用なし'}</Text>
                  <Text style={styles.pickupHeroPlace}>{children[activeChildIdx]?.school || '学校'} へお迎え</Text>
                  <View style={{ flex: 1 }} />
                  {!!getCellData(selectedDateStr).pickupTime && (
                    <TouchableOpacity onPress={() => deleteItem('pickup')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={18} color="#CBD5E1" />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.pickupSavedTimes}>
                  {(children[activeChildIdx]?.pickupTimes || []).map((t: string) => {
                    const isActive = getCellData(selectedDateStr).pickupTime === t;
                    return (
                      <View
                        key={t}
                        style={[styles.pickupSavedTimeChip, isActive && styles.pickupSavedTimeChipActive]}
                      >
                        <TouchableOpacity onPress={() => saveToFirestore(selectedDateStr, { pickupTime: t })} activeOpacity={0.82}>
                          <Text style={[styles.pickupSavedTimeText, isActive && styles.pickupSavedTimeTextActive]}>{t}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.pickupSavedTimeDeleteBtn, isActive && styles.pickupSavedTimeDeleteBtnActive]}
                          onPress={() => removeSavedPickupTime(t)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="close" size={11} color={isActive ? '#FFFFFF' : '#9A5B05'} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                  <TouchableOpacity
                    style={styles.pickupSavedTimeAddChip}
                    onPress={() => {
                      const current = getCellData(selectedDateStr).pickupTime || '15:00';
                      const [h, m] = current.split(':').map((v: string) => Number(v));
                      setAddPickupHour(Number.isFinite(h) ? h : HOURS[0]);
                      setAddPickupMinute(Number.isFinite(m) ? m : 0);
                      setAddPickupPickerVisible(true);
                    }}
                    activeOpacity={0.82}
                  >
                    <Ionicons name="add-circle-outline" size={14} color="#9A5B05" />
                    <Text style={styles.pickupSavedTimeText}>候補追加</Text>
                  </TouchableOpacity>
                  {!!getCellData(selectedDateStr).pickupTime && !(children[activeChildIdx]?.pickupTimes || []).includes(getCellData(selectedDateStr).pickupTime) && (
                    <TouchableOpacity
                      style={styles.pickupSavedTimeAddChip}
                      onPress={() => savePickupTimeToAccount(getCellData(selectedDateStr).pickupTime)}
                      activeOpacity={0.82}
                    >
                      <Ionicons name="add" size={13} color="#9A5B05" />
                      <Text style={styles.pickupSavedTimeText}>この時刻を保存</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={styles.dayPlanSection}>
                <View style={styles.dayPlanHeader}>
                  <Text style={styles.dayPlanTitle}>習い事</Text>
                  <TouchableOpacity style={styles.dayAddBtn} onPress={() => {
                    setEditModalVisible(false);
                    setReturnToEdit(true);
                    setTemplateSelectMode('singleDay');
                    setTimeout(() => setTemplateModalVisible(true), 300);
                  }}>
                    <Ionicons name="add" size={15} color="#2F80ED" />
                    <Text style={styles.dayAddBtnText}>習い事を追加</Text>
                  </TouchableOpacity>
                </View>

                {eventsData[selectedDateStr] && (
                  <View style={styles.timelineRow}>
                    <View style={[styles.timelineDot, { backgroundColor: '#F59E0B' }]} />
                    <View style={styles.timelineLine} />
                    <View style={[styles.timelineCard, styles.eventTimelineCard]}>
                      <View style={styles.timelineBadge}><Text style={styles.timelineBadgeText}>イベント</Text></View>
                      <View style={styles.eventTimelineTitleRow}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.timelineTitle} numberOfLines={1}>{eventsData[selectedDateStr].title}</Text>
                        </View>
                        <TouchableOpacity
                          style={participantData[selectedDateStr]?.[children[activeChildIdx]?.id] === '参加' ? styles.timelineCancelBtn : styles.timelineJoinBtn}
                          onPress={() => toggleEventParticipation(selectedDateStr, participantData[selectedDateStr]?.[children[activeChildIdx]?.id] !== '参加')}
                        >
                          <Text style={participantData[selectedDateStr]?.[children[activeChildIdx]?.id] === '参加' ? styles.timelineCancelText : styles.timelineJoinText}>
                            {participantData[selectedDateStr]?.[children[activeChildIdx]?.id] === '参加' ? '取消' : '参加する'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {!!eventsData[selectedDateStr].description && <Text style={styles.timelineSubText} numberOfLines={1}>{eventsData[selectedDateStr].description}</Text>}
                    </View>
                  </View>
                )}

                {getCellData(selectedDateStr).lessons && getCellData(selectedDateStr).lessons!.length > 0 ? (
                  getCellData(selectedDateStr).lessons!.map((lesson, idx) => (
                    <View key={`edit-les-${idx}`} style={styles.timelineRow}>
                      <View style={[styles.timelineDot, { backgroundColor: '#C084FC' }]} />
                      <View style={styles.timelineLine} />
                      <View style={styles.timelineCard}>
                        <View style={styles.timelineBadgePurple}><Text style={styles.timelineBadgePurpleText}>習い事</Text></View>
                          <View style={styles.timelineContentRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.timelineTime}>{lesson.time}</Text>
                            <Text style={styles.timelineTitle}>{lesson.name}</Text>
                          </View>
                          <TouchableOpacity style={styles.timelineIconBtn} onPress={() => openTimePicker('lesson', lesson.time, idx)}>
                            <Ionicons name="chevron-forward" size={20} color="#64748B" />
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.timelineIconBtn} onPress={() => deleteItem('lesson', idx)}>
                            <Ionicons name="trash-outline" size={18} color="#EF4444" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ))
                ) : (
                  <View style={styles.emptyTimelineCard}>
                    <Text style={styles.emptyTimelineText}>習い事はありません</Text>
                  </View>
                )}
              </View>

              <View style={styles.memoSheetSection}>
                <View style={styles.dayPlanHeader}>
                  <Text style={styles.dayPlanTitle}>メモ</Text>
                  <TouchableOpacity
                    style={styles.dayAddBtn}
                    onPress={() => {
                      saveToFirestore(selectedDateStr, { memo: editingMemo });
                      setMemoSaved(true);
                    }}
                  >
                    <Ionicons name={memoSaved ? "checkmark" : "add"} size={15} color="#2F80ED" />
                    <Text style={styles.dayAddBtnText}>{memoSaved ? '保存済み' : '保存'}</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.memoSheetInput}
                  placeholder="この日のメモを入力..."
                  placeholderTextColor="#94A3B8"
                  value={editingMemo}
                  onChangeText={(t) => { setEditingMemo(t); setMemoSaved(false); }}
                  multiline
                />
              </View>
              <TouchableOpacity
                style={styles.sheetContinueButton}
                onPress={() => {
                  saveToFirestore(selectedDateStr, { memo: editingMemo });
                  setMemoSaved(true);
                }}
              >
                <Ionicons name="checkmark-done-outline" size={18} color="#2F80ED" />
                <Text style={styles.sheetContinueButtonText}>保存して続ける</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.sheetSaveButton}
                onPress={() => {
                  saveToFirestore(selectedDateStr, { memo: editingMemo });
                  setMemoSaved(true);
                  setEditModalVisible(false);
                }}
              >
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={styles.sheetSaveButtonText}>保存して閉じる</Text>
              </TouchableOpacity>
              <View style={{height: 14}} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={eventModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={() => setEventModalVisible(false)} accessible={false}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={[styles.editModalContent, styles.modalSurface]}>
                  <View style={styles.modalHeader}>
                      <View style={{flexDirection: 'row', alignItems: 'center'}}>
                  <Ionicons name="star" size={24} color="#00AEB8" style={{marginRight: 8}} />
                          <Text style={styles.modalTitle}>{selectedDateStr} のイベント</Text>
                      </View>
                      <TouchableOpacity onPress={() => setEventModalVisible(false)}>
                          <Ionicons name="close" size={28} color={COLORS.textLight} />
                      </TouchableOpacity>
                  </View>
                  
                  {eventsData[selectedDateStr] && (
                      <View style={{marginBottom: 24}}>
                          <Text style={{fontSize: 22, fontWeight: 'bold', color: COLORS.text, marginBottom: 12}}>
                              {eventsData[selectedDateStr].title}
                          </Text>
                          <Text style={{fontSize: 16, color: COLORS.text, lineHeight: 24, backgroundColor: '#F9F9F9', padding: 12, borderRadius: 8}}>
                              {eventsData[selectedDateStr].description || '詳細情報はありません'}
                          </Text>
                      </View>
                  )}

                  <View style={{borderTopWidth: 1, borderColor: COLORS.border, paddingTop: 20}}>
                      <Text style={{fontWeight: 'bold', marginBottom: 12, color: COLORS.textLight, textAlign: 'center'}}>
                          {children[activeChildIdx]?.name} さんの参加状況
                      </Text>
                      
                      {participantData[selectedDateStr]?.[children[activeChildIdx]?.id] === '参加' ? (
                          <View style={{alignItems: 'center'}}>
                              <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: '#E8F5E9', padding: 12, borderRadius: 8, marginBottom: 16}}>
                                  <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
                                  <Text style={{fontSize: 16, fontWeight: 'bold', color: '#4CAF50', marginLeft: 8}}>参加申し込み済み</Text>
                              </View>
                              <TouchableOpacity style={[styles.saveBtn, {backgroundColor: '#FFEBEE', width: '100%'}]} onPress={() => toggleEventParticipation(selectedDateStr, false)}>
                                  <Text style={{color: COLORS.danger, fontWeight: 'bold'}}>参加をキャンセルする</Text>
                              </TouchableOpacity>
                          </View>
                      ) : (
                          <TouchableOpacity style={[styles.saveBtn, {width: '100%'}]} onPress={() => toggleEventParticipation(selectedDateStr, true)}>
                              <Text style={styles.saveBtnText}>このイベントに参加する</Text>
                          </TouchableOpacity>
                      )}
                      
                      <TouchableOpacity style={{marginTop: 20, alignItems: 'center', padding: 12}} onPress={() => {
                          setEditingMemo(scheduleData[getScheduleKey(selectedDateStr)]?.memo || '');
                          setEventModalVisible(false);
                          setTimeout(()=>setEditModalVisible(true), 300);
                      }}>
                          <Text style={{color: COLORS.primary, textDecorationLine: 'underline'}}>お迎え・習い事の時間を設定する</Text>
                      </TouchableOpacity>
                  </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!deletePickupTimeTarget} transparent animationType="fade">
        <View style={styles.deleteConfirmOverlay}>
          <TouchableWithoutFeedback onPress={() => setDeletePickupTimeTarget(null)} accessible={false}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={[styles.deleteConfirmBox, styles.modalSurface]}>
                <View style={styles.deleteConfirmIcon}>
                  <Ionicons name="trash-outline" size={24} color="#EF4444" />
                </View>
                <Text style={styles.deleteConfirmTitle}>候補を削除しますか？</Text>
                <Text style={styles.deleteConfirmMessage}>
                  {deletePickupTimeTarget} を候補から削除します。
                </Text>
                <View style={styles.deleteConfirmActions}>
                  <TouchableOpacity
                    style={styles.deleteConfirmCancelBtn}
                    activeOpacity={0.85}
                    onPress={() => setDeletePickupTimeTarget(null)}
                  >
                    <Text style={styles.deleteConfirmCancelText}>キャンセル</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteConfirmSubmitBtn}
                    activeOpacity={0.88}
                    onPress={async () => {
                      const target = deletePickupTimeTarget;
                      setDeletePickupTimeTarget(null);
                      if (target) await removePickupTimeFromAccount(target);
                    }}
                  >
                    <Text style={styles.deleteConfirmSubmitText}>削除</Text>
                  </TouchableOpacity>
                </View>
          </View>
        </View>
      </Modal>

      {/* 候補時間追加ピッカー */}
      <Modal visible={addPickupPickerVisible} transparent animationType="fade">
        <View style={styles.pickerOverlay}>
          <TouchableWithoutFeedback onPress={() => setAddPickupPickerVisible(false)} accessible={false}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={[styles.pickerContent, styles.modalSurface]}>
            <Text style={styles.pickerTitle}>候補時間を追加</Text>
            <View style={styles.pickerColumns} nativeID="ui-time-wheel-pickup-option">
              <View pointerEvents="none" style={styles.pickerSelectionFrame} />
              <View ref={addPickupHourWheelWrapRef} style={styles.pickerWheelWrap}>
              <ScrollView
                ref={addPickupHourScrollRef}
                style={styles.pickerScroll}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.pickerScrollInner}
                contentOffset={{ x: 0, y: getPickerOffset(HOURS, addPickupHour) }}
                snapToInterval={PICKER_ITEM_HEIGHT}
                snapToOffsets={HOURS.map((_, index) => index * PICKER_ITEM_HEIGHT)}
                snapToAlignment="center"
                disableIntervalMomentum
                decelerationRate="fast"
                scrollEventThrottle={16}
                onScroll={(event: any) => handlePickerScroll('addPickupHour', HOURS, event.nativeEvent.contentOffset.y, addPickupHour, setAddPickupHour, addPickupHourScrollRef)}
                onMomentumScrollEnd={(event: any) => settlePickerValue(HOURS, event.nativeEvent.contentOffset.y, addPickupHour, setAddPickupHour, addPickupHourScrollRef)}
                onScrollEndDrag={(event: any) => settlePickerValue(HOURS, event.nativeEvent.contentOffset.y, addPickupHour, setAddPickupHour, addPickupHourScrollRef)}
              >
                {HOURS.map(h => (
                  <TouchableOpacity key={`ah-${h}`} style={[styles.pickerItem, addPickupHour === h && styles.pickerItemActive]} onPress={() => selectPickerValue(HOURS, h, setAddPickupHour, addPickupHourScrollRef)}>
                    <Text style={[styles.pickerItemText, addPickupHour === h && styles.pickerItemTextActive]}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              </View>
              <Text style={styles.pickerColon}>:</Text>
              <View ref={addPickupMinuteWheelWrapRef} style={styles.pickerWheelWrap}>
              <ScrollView
                ref={addPickupMinuteScrollRef}
                style={styles.pickerScroll}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.pickerScrollInner}
                contentOffset={{ x: 0, y: getPickerOffset(MINUTES, addPickupMinute) }}
                snapToInterval={PICKER_ITEM_HEIGHT}
                snapToOffsets={MINUTES.map((_, index) => index * PICKER_ITEM_HEIGHT)}
                snapToAlignment="center"
                disableIntervalMomentum
                decelerationRate="fast"
                scrollEventThrottle={16}
                onScroll={(event: any) => handlePickerScroll('addPickupMinute', MINUTES, event.nativeEvent.contentOffset.y, addPickupMinute, setAddPickupMinute, addPickupMinuteScrollRef)}
                onMomentumScrollEnd={(event: any) => settlePickerValue(MINUTES, event.nativeEvent.contentOffset.y, addPickupMinute, setAddPickupMinute, addPickupMinuteScrollRef)}
                onScrollEndDrag={(event: any) => settlePickerValue(MINUTES, event.nativeEvent.contentOffset.y, addPickupMinute, setAddPickupMinute, addPickupMinuteScrollRef)}
              >
                {MINUTES.map(m => (
                  <TouchableOpacity key={`am-${m}`} style={[styles.pickerItem, addPickupMinute === m && styles.pickerItemActive]} onPress={() => selectPickerValue(MINUTES, m, setAddPickupMinute, addPickupMinuteScrollRef)}>
                    <Text style={[styles.pickerItemText, addPickupMinute === m && styles.pickerItemTextActive]}>{String(m).padStart(2, '0')}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              </View>
            </View>
            <View style={styles.pickerFooter}>
              <TouchableOpacity style={styles.pickerCancelBtn} onPress={() => setAddPickupPickerVisible(false)}>
                <Text style={styles.pickerCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pickerConfirmBtn, { opacity: pickupTimeSaving ? 0.5 : 1 }]}
                disabled={pickupTimeSaving}
                onPress={async () => {
                  const t = `${String(addPickupHour).padStart(2, '0')}:${String(addPickupMinute).padStart(2, '0')}`;
                  setPickupTimeSaving(true);
                  await savePickupTimeToAccount(t);
                  setActivePickupTime(t);
                  setIsPickupStampingMode(true);
                  setIsStampingMode(false);
                  setActiveTemplate(null);
                  setPickupTimeSaving(false);
                  setAddPickupPickerVisible(false);
                }}
              >
                <Text style={styles.pickerConfirmText}>{pickupTimeSaving ? '保存中...' : '保存して入力開始'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={timePickerVisible} transparent animationType="fade">
        <View style={styles.pickerOverlay}>
          <TouchableWithoutFeedback onPress={() => {
            setTimePickerVisible(false);
            setTimeout(() => setEditModalVisible(true), 300);
          }} accessible={false}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={[styles.pickerContent, styles.modalSurface]}>
            <Text style={styles.pickerTitle}>時間を選択</Text>
            <View style={styles.pickerColumns} nativeID="ui-time-wheel-schedule">
              <View pointerEvents="none" style={styles.pickerSelectionFrame} />
              <View ref={timePickerHourWheelWrapRef} style={styles.pickerWheelWrap}>
              <ScrollView
                ref={timePickerHourScrollRef}
                style={styles.pickerScroll}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.pickerScrollInner}
                contentOffset={{ x: 0, y: getPickerOffset(HOURS, tempHour) }}
                snapToInterval={PICKER_ITEM_HEIGHT}
                snapToOffsets={HOURS.map((_, index) => index * PICKER_ITEM_HEIGHT)}
                snapToAlignment="center"
                disableIntervalMomentum
                decelerationRate="fast"
                scrollEventThrottle={16}
                onScroll={(event: any) => handlePickerScroll('timePickerHour', HOURS, event.nativeEvent.contentOffset.y, tempHour, setTempHour, timePickerHourScrollRef)}
                onMomentumScrollEnd={(event: any) => settlePickerValue(HOURS, event.nativeEvent.contentOffset.y, tempHour, setTempHour, timePickerHourScrollRef)}
                onScrollEndDrag={(event: any) => settlePickerValue(HOURS, event.nativeEvent.contentOffset.y, tempHour, setTempHour, timePickerHourScrollRef)}
              >
                {HOURS.map(h => (
                  <TouchableOpacity key={`h-${h}`} style={[styles.pickerItem, tempHour === h && styles.pickerItemActive]} onPress={() => selectPickerValue(HOURS, h, setTempHour, timePickerHourScrollRef)}>
                    <Text style={[styles.pickerItemText, tempHour === h && styles.pickerItemTextActive]}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              </View>
              <Text style={styles.pickerColon}>:</Text>
              <View ref={timePickerMinuteWheelWrapRef} style={styles.pickerWheelWrap}>
              <ScrollView
                ref={timePickerMinuteScrollRef}
                style={styles.pickerScroll}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.pickerScrollInner}
                contentOffset={{ x: 0, y: getPickerOffset(MINUTES, tempMinute) }}
                snapToInterval={PICKER_ITEM_HEIGHT}
                snapToOffsets={MINUTES.map((_, index) => index * PICKER_ITEM_HEIGHT)}
                snapToAlignment="center"
                disableIntervalMomentum
                decelerationRate="fast"
                scrollEventThrottle={16}
                onScroll={(event: any) => handlePickerScroll('timePickerMinute', MINUTES, event.nativeEvent.contentOffset.y, tempMinute, setTempMinute, timePickerMinuteScrollRef)}
                onMomentumScrollEnd={(event: any) => settlePickerValue(MINUTES, event.nativeEvent.contentOffset.y, tempMinute, setTempMinute, timePickerMinuteScrollRef)}
                onScrollEndDrag={(event: any) => settlePickerValue(MINUTES, event.nativeEvent.contentOffset.y, tempMinute, setTempMinute, timePickerMinuteScrollRef)}
              >
                {MINUTES.map(m => (
                  <TouchableOpacity key={`m-${m}`} style={[styles.pickerItem, tempMinute === m && styles.pickerItemActive]} onPress={() => selectPickerValue(MINUTES, m, setTempMinute, timePickerMinuteScrollRef)}>
                    <Text style={[styles.pickerItemText, tempMinute === m && styles.pickerItemTextActive]}>{String(m).padStart(2, '0')}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              </View>
            </View>
            <View style={styles.pickerFooter}>
              <TouchableOpacity style={styles.pickerCancelBtn} onPress={() => {
                setTimePickerVisible(false);
                setTimeout(() => setEditModalVisible(true), 300);
              }}>
                <Text style={styles.pickerCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pickerConfirmBtn} onPress={confirmTime}>
                <Text style={styles.pickerConfirmText}>決定</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={templateModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={closeTemplateAndMaybeReturnToEdit} accessible={false}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={[styles.templateContent, styles.modalSurface]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                  {templateSelectMode === 'edit' ? '習い事を編集・削除' : '習い事を選択'}
              </Text>
              <View style={{flexDirection: 'row', gap: 16}}>
                  <TouchableOpacity onPress={() => setTemplateSelectMode(prev => prev === 'edit' ? 'stamping' : 'edit')}>
                      <Ionicons name={templateSelectMode === 'edit' ? "checkmark" : "settings-outline"} size={24} color={COLORS.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={closeTemplateAndMaybeReturnToEdit}>
                    <Ionicons name="close" size={28} color={COLORS.textLight} />
                  </TouchableOpacity>
              </View>
            </View>
            
            <ScrollView style={styles.templateList} showsVerticalScrollIndicator={false}>
              {lessonTemplates.length === 0 && (
                  <Text style={{textAlign: 'center', color: COLORS.textLight, marginVertical: 20}}>登録された習い事はありません</Text>
              )}
              {lessonTemplates.map(t => (
                <View key={t.id} style={styles.templateCardWrapper}>
                  <TouchableOpacity style={styles.templateCard} onPress={() => handleSelectTemplate(t)}>
                    <View>
                      <Text style={styles.templateName}>{t.name}</Text>
                      <Text style={styles.templateTime}>送り: {t.time}</Text>
                    </View>
                    {templateSelectMode === 'edit' ? (
                        <View style={{flexDirection: 'row', gap: 16}}>
                            <Ionicons name="pencil" size={20} color={COLORS.primary} />
                            <TouchableOpacity onPress={() => deleteLessonTemplate(t.id)}>
                                <Ionicons name="trash" size={20} color={COLORS.danger} />
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <Ionicons name={templateSelectMode === 'stamping' ? "color-wand-outline" : "checkmark-circle-outline"} size={24} color={COLORS.primary} />
                    )}
                  </TouchableOpacity>
                </View>
              ))}
              
              <TouchableOpacity style={[styles.saveBtn, {marginTop: 16, backgroundColor: '#F0F8FF', borderColor: COLORS.primary, borderWidth: 1}]}
                                onPress={() => { setTemplateModalVisible(false); setEditingTemplateId(null); setNewLessonName(''); setTempHour(HOURS[0]); setTempMinute(MINUTES[0]); setTimeout(() => setLessonAddVisible(true), 300); }}>
                  <Ionicons name="add" size={20} color={COLORS.primary} style={{marginRight: 8}}/>
                  <Text style={{color: COLORS.primary, fontWeight: 'bold'}}>新しい習い事を追加</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
      
      <Modal visible={lessonAddVisible} transparent animationType="fade">
        <View style={styles.pickerOverlay}>
          <TouchableWithoutFeedback onPress={() => { setLessonAddVisible(false); setTimeout(() => setTemplateModalVisible(true), 300); }} accessible={false}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={[styles.pickerContent, styles.modalSurface]}>
                  <Text style={styles.pickerTitle}>{editingTemplateId ? '習い事を編集' : '習い事を追加'}</Text>
                  
                  <Text style={{fontWeight: 'bold', marginBottom: 8}}>習い事の名前</Text>
                  <TextInput 
                      style={{borderWidth: 1, borderColor: COLORS.border, padding: 12, borderRadius: 8, fontSize: 16, marginBottom: 20}}
                      placeholder="例: スイミング" placeholderTextColor="#BBBBBB"
                      value={newLessonName}
                      onChangeText={setNewLessonName}
                  />

                  <Text style={{fontWeight: 'bold', marginBottom: 8}}>送迎時間</Text>
                  <View style={styles.pickerColumns} nativeID="ui-time-wheel-bulk">
                    <View pointerEvents="none" style={styles.pickerSelectionFrame} />
                    <View ref={lessonPickerHourWheelWrapRef} style={styles.pickerWheelWrap}>
                    <ScrollView
                      ref={lessonPickerHourScrollRef}
                      style={styles.pickerScroll}
                      showsVerticalScrollIndicator={false}
                      contentContainerStyle={styles.pickerScrollInner}
                      contentOffset={{ x: 0, y: getPickerOffset(HOURS, tempHour) }}
                      snapToInterval={PICKER_ITEM_HEIGHT}
                      snapToOffsets={HOURS.map((_, index) => index * PICKER_ITEM_HEIGHT)}
                      snapToAlignment="center"
                      disableIntervalMomentum
                      decelerationRate="fast"
                      scrollEventThrottle={16}
                      onScroll={(event: any) => handlePickerScroll('lessonPickerHour', HOURS, event.nativeEvent.contentOffset.y, tempHour, setTempHour, lessonPickerHourScrollRef)}
                      onMomentumScrollEnd={(event: any) => settlePickerValue(HOURS, event.nativeEvent.contentOffset.y, tempHour, setTempHour, lessonPickerHourScrollRef)}
                      onScrollEndDrag={(event: any) => settlePickerValue(HOURS, event.nativeEvent.contentOffset.y, tempHour, setTempHour, lessonPickerHourScrollRef)}
                    >
                      {HOURS.map(h => (
                        <TouchableOpacity key={`h-${h}`} style={[styles.pickerItem, tempHour === h && styles.pickerItemActive]} onPress={() => selectPickerValue(HOURS, h, setTempHour, lessonPickerHourScrollRef)}>
                          <Text style={[styles.pickerItemText, tempHour === h && styles.pickerItemTextActive]}>{h}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    </View>
                    <Text style={styles.pickerColon}>:</Text>
                    <View ref={lessonPickerMinuteWheelWrapRef} style={styles.pickerWheelWrap}>
                    <ScrollView
                      ref={lessonPickerMinuteScrollRef}
                      style={styles.pickerScroll}
                      showsVerticalScrollIndicator={false}
                      contentContainerStyle={styles.pickerScrollInner}
                      contentOffset={{ x: 0, y: getPickerOffset(MINUTES, tempMinute) }}
                      snapToInterval={PICKER_ITEM_HEIGHT}
                      snapToOffsets={MINUTES.map((_, index) => index * PICKER_ITEM_HEIGHT)}
                      snapToAlignment="center"
                      disableIntervalMomentum
                      decelerationRate="fast"
                      scrollEventThrottle={16}
                      onScroll={(event: any) => handlePickerScroll('lessonPickerMinute', MINUTES, event.nativeEvent.contentOffset.y, tempMinute, setTempMinute, lessonPickerMinuteScrollRef)}
                      onMomentumScrollEnd={(event: any) => settlePickerValue(MINUTES, event.nativeEvent.contentOffset.y, tempMinute, setTempMinute, lessonPickerMinuteScrollRef)}
                      onScrollEndDrag={(event: any) => settlePickerValue(MINUTES, event.nativeEvent.contentOffset.y, tempMinute, setTempMinute, lessonPickerMinuteScrollRef)}
                    >
                      {MINUTES.map(m => (
                        <TouchableOpacity key={`m-${m}`} style={[styles.pickerItem, tempMinute === m && styles.pickerItemActive]} onPress={() => selectPickerValue(MINUTES, m, setTempMinute, lessonPickerMinuteScrollRef)}>
                          <Text style={[styles.pickerItemText, tempMinute === m && styles.pickerItemTextActive]}>{String(m).padStart(2, '0')}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    </View>
                  </View>

                  <View style={styles.pickerFooter}>
                    <TouchableOpacity style={styles.pickerCancelBtn} onPress={() => { setLessonAddVisible(false); setTimeout(() => setTemplateModalVisible(true), 300); }}>
                      <Text style={styles.pickerCancelText}>キャンセル</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.pickerConfirmBtn} onPress={saveLessonTemplate}>
                      <Text style={styles.pickerConfirmText}>保存する</Text>
                    </TouchableOpacity>
                  </View>
          </View>
        </View>
      </Modal>

      <AdminBottomNav active="schedule" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF8F0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFF8F0',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  initialLoadingBar: {
    minHeight: 44,
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: '#F3FAFA',
    borderWidth: 1,
    borderColor: '#CBE9E8',
  },
  initialLoadingText: {
    color: '#455A5A',
    fontSize: 13,
    fontWeight: 'bold',
  },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#5D4037',
    flex: 1
  },
  childTabs: {
    flexDirection: 'row',
    backgroundColor: '#FFF8F0',
    paddingHorizontal: 12,
    paddingTop: 12,
    borderBottomWidth: 1,
    borderColor: '#F0E4D0',
  },
  childTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: '#F0E8DC',
    marginHorizontal: 4
  },
  childTabBtnActive: {
    backgroundColor: '#FFF8F0',
    borderBottomWidth: 3,
    borderBottomColor: COLORS.primary
  },
  childTabText: { 
    fontSize: 14, 
    fontWeight: 'bold', 
    color: COLORS.textLight, 
    marginLeft: 6 
  },
  childTabTextActive: { 
    color: COLORS.primary 
  },
  stampingBanner: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    backgroundColor: '#FFFDF5', 
    padding: 12, 
    borderBottomWidth: 1, 
    borderColor: COLORS.primary 
  },
  stampingText: { 
    fontSize: 14, 
    fontWeight: 'bold', 
    color: COLORS.primary 
  },
  stampingEndBtn: { 
    backgroundColor: COLORS.primary, 
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    borderRadius: 16 
  },
  stampingEndText: { 
    color: COLORS.white, 
    fontSize: 12, 
    fontWeight: 'bold' 
  },
  scrollArea: { 
    flex: 1 
  },
  monthSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFF0DC',
    marginHorizontal: 8,
    marginTop: 12,
    borderRadius: 16,
    marginBottom: 4,
  },
  monthBtn: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F0D8B0',
  },
  monthText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#5D4037',
  },
  calendarContainer: { 
    paddingHorizontal: 8, 
    paddingBottom: 112 
  },
  calHeaderRow: {
    flexDirection: 'row',
    marginBottom: 8,
    backgroundColor: '#FFE8CC',
    borderRadius: 8,
    paddingVertical: 6,
  },
  calWeekText: { 
    flex: 1, 
    textAlign: 'center', 
    fontSize: 12, 
    fontWeight: 'bold', 
    color: COLORS.textLight 
  },
  calGrid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap' 
  },
  calCellEmpty: { 
    width: '14.28%', 
    minHeight: 60 
  },
  calCell: {
    width: '14.28%',
    minHeight: 70,
    borderWidth: 0.5,
    borderColor: '#F0E4D0',
    padding: 2,
    backgroundColor: '#FFFDF8',
    justifyContent: 'flex-start'
  },
  calCellStamping: {
    backgroundColor: '#FFF5E8'
  },
  calDayText: { 
    fontSize: 12, 
    fontWeight: 'bold', 
    marginBottom: 2 
  },
  cellContent: { 
    flex: 1 
  },
  eventBadge: { 
    backgroundColor: '#FFFACD', 
    borderColor: '#00AEB8',
    borderWidth: 1,
    borderRadius: 4, 
    padding: 2, 
    marginBottom: 2 
  },
  eventBadgeText: { 
    fontSize: 8, 
    color: '#00AEB8', 
    fontWeight: 'bold', 
    textAlign: 'center' 
  },
  pickupBadge: { 
    backgroundColor: '#FFE4E1', 
    borderRadius: 4, 
    padding: 2, 
    marginBottom: 2 
  },
  pickupText: { 
    fontSize: 9, 
    color: '#D87093', 
    fontWeight: 'bold', 
    textAlign: 'center' 
  },
  lessonBadge: { 
    backgroundColor: '#E0FFFF', 
    borderRadius: 4, 
    padding: 2,
    marginBottom: 2
  },
  lessonText: { 
    fontSize: 9, 
    color: '#4682B4', 
    fontWeight: 'bold', 
    textAlign: 'center' 
  },
  lessonTimeText: { 
    fontSize: 8, 
    color: '#4682B4', 
    textAlign: 'center' 
  },
  scrollAreaContent: {
    paddingBottom: ADMIN_BOTTOM_NAV_HEIGHT + 96,
  },
  fabLesson: { position: 'absolute', bottom: 24, right: 20, width: 80, height: 80, borderRadius: 40, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 8, zIndex: 100 },
  fabLessonImg: { width: '100%', height: '100%' },
  bulkInputBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: ADMIN_BOTTOM_NAV_HEIGHT + 8,
    flexDirection: 'row',
    gap: 10,
    padding: 8,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 252, 246, 0.96)',
    borderWidth: 1,
    borderColor: '#F3DFC0',
    shadowColor: '#8B7340',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 8,
  },
  bulkInputButton: {
    flex: 1,
    minHeight: 58,
    borderRadius: 17,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
  },
  bulkPickupButton: {
    backgroundColor: '#FFF5DE',
    borderColor: '#F8C66A',
  },
  bulkLessonButton: {
    backgroundColor: '#EDF8FF',
    borderColor: '#9BD7FF',
  },
  bulkInputButtonActive: {
    borderWidth: 2,
    shadowColor: '#00AEB8',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  bulkInputTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#3F302B',
  },
  bulkInputSubText: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '800',
    color: '#75665F',
  },
  fab: { 
    position: 'absolute', 
    right: 20, 
    bottom: 40, 
    backgroundColor: COLORS.primary, 
    paddingHorizontal: 20, 
    paddingVertical: 14, 
    borderRadius: 30, 
    flexDirection: 'row', 
    alignItems: 'center', 
    shadowColor: COLORS.primary, 
    shadowOpacity: 0.4, 
    shadowRadius: 8, 
    elevation: 5 
  },
  fabText: { 
    color: COLORS.white, 
    fontWeight: 'bold', 
    fontSize: 16, 
    marginLeft: 8 
  },
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(25,32,45,0.42)', 
    justifyContent: 'center', 
    alignItems: 'center', 
    paddingHorizontal: 10,
    paddingVertical: 18,
  },
  modalSurface: {
    zIndex: 1,
  },
  modalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F7',
  },
  modalTitle: { 
    fontSize: 19, 
    fontWeight: '900', 
    color: '#1F2937',
    letterSpacing: 0,
  },
  editModalContent: { 
    width: '100%', 
    maxWidth: 392,
    maxHeight: '86%',
    backgroundColor: '#F8FBFF', 
    borderRadius: 22, 
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 10,
  },
  editSection: { 
    marginBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E7EEF8',
  },
  editSectionHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 10,
  },
  editSectionTitle: { 
    fontSize: 16, 
    fontWeight: '900', 
    color: COLORS.text, 
    marginLeft: 8 
  },
  editCard: { 
    backgroundColor: COLORS.white, 
    padding: 14, 
    borderRadius: 14, 
    borderWidth: 1, 
    borderColor: '#E5EEF9', 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  editTimeText: { 
    fontSize: 19, 
    fontWeight: '900', 
    color: '#1F2937',
  },
  editLessonName: { 
    fontSize: 15, 
    color: '#1F2937', 
    fontWeight: '900', 
    marginBottom: 4 
  },
  editActions: { 
    flexDirection: 'row', 
    gap: 12 
  },
  editActionBtn: { 
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#EEF6FF',
  },
  btnTextPrimary: { 
    color: COLORS.primary, 
    fontWeight: 'bold' 
  },
  btnTextDanger: { 
    color: COLORS.danger, 
    fontWeight: 'bold' 
  },
  noDataText: { 
    color: '#94A3B8', 
    fontStyle: 'normal', 
    fontWeight: '700',
    flex: 1 
  },
  addSmallBtn: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#2F80ED', 
    paddingHorizontal: 12, 
    paddingVertical: 8, 
    borderRadius: 12,
    shadowColor: '#2F80ED',
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 2,
  },
  addSmallBtnText: { 
    color: COLORS.white, 
    fontWeight: 'bold', 
    fontSize: 12, 
    marginLeft: 4 
  },
  scheduleSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  scheduleSheetIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  scheduleDateStepper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingLeft: 42,
  },
  scheduleDateArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D7E8FF',
  },
  scheduleSheetTitle: {
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '900',
    color: '#111827',
    minWidth: 112,
  },
  pickupHeroCard: {
    backgroundColor: '#FFF7E6',
    borderRadius: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: '#FFE0A3',
    marginBottom: 10,
  },
  pickupHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  pickupHeroLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pickupHeroLabelText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#7C4A03',
  },
  scheduleEditPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#FDBA4B',
  },
  scheduleEditPillText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#F59E0B',
  },
  pickupHeroTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  pickupHeroTime: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
  },
  pickupHeroPlace: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    flexShrink: 1,
  },
  pickupSavedTimes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  pickupSavedTimeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1,
    borderColor: '#FFE0A3',
  },
  pickupSavedTimeChipActive: {
    backgroundColor: '#F59E0B',
    borderColor: '#F59E0B',
  },
  pickupSavedTimeDeleteBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(154,91,5,0.10)',
  },
  pickupSavedTimeDeleteBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  pickupSavedTimeAddChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FFF9E8',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#F8C66A',
  },
  pickupSavedTimeText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#9A5B05',
  },
  pickupSavedTimeTextActive: {
    color: '#fff',
  },
  dayPlanSection: {
    marginBottom: 12,
  },
  dayPlanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  dayPlanTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#111827',
  },
  dayAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 13,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  dayAddBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#2F80ED',
  },
  timelineRow: {
    position: 'relative',
    paddingLeft: 20,
    marginBottom: 10,
  },
  timelineDot: {
    position: 'absolute',
    left: 2,
    top: 14,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#fff',
    zIndex: 2,
  },
  timelineLine: {
    position: 'absolute',
    left: 6,
    top: 18,
    bottom: -14,
    width: 2,
    backgroundColor: '#BFDBFE',
  },
  timelineCard: {
    backgroundColor: '#F5F9FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    borderRadius: 14,
    padding: 10,
  },
  eventTimelineCard: {
    backgroundColor: '#FFFBEA',
    borderColor: '#FDE68A',
  },
  timelineBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginBottom: 6,
  },
  timelineBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#B45309',
  },
  timelineBadgePurple: {
    alignSelf: 'flex-start',
    backgroundColor: '#F3E8FF',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginBottom: 7,
  },
  timelineBadgePurpleText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#7E22CE',
  },
  timelineContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timelineIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  timelineTime: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 2,
  },
  timelineTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#111827',
  },
  eventTimelineTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timelineSubText: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
    marginTop: 3,
  },
  timelineIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  timelineJoinBtn: {
    alignSelf: 'center',
    backgroundColor: '#2F80ED',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  timelineJoinText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 12,
  },
  timelineCancelBtn: {
    alignSelf: 'center',
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  timelineCancelText: {
    color: '#DC2626',
    fontWeight: '900',
    fontSize: 12,
  },
  emptyTimelineCard: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#BFDBFE',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(239,246,255,0.7)',
  },
  emptyTimelineText: {
    color: '#64748B',
    fontWeight: '800',
    fontSize: 13,
  },
  memoSheetSection: {
    marginBottom: 12,
  },
  memoSheetInput: {
    minHeight: 58,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    borderRadius: 14,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#fff',
    textAlignVertical: 'top',
    color: '#111827',
  },
  sheetSaveButton: {
    minHeight: 44,
    borderRadius: 16,
    backgroundColor: '#2F80ED',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    shadowColor: '#2F80ED',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 4,
    marginTop: 8,
  },
  sheetSaveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  sheetContinueButton: {
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: '#EAF4FF',
    borderWidth: 1,
    borderColor: '#B9DCFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  sheetContinueButtonText: {
    color: '#2F80ED',
    fontSize: 14,
    fontWeight: '900',
  },
  templateContent: { 
    width: '100%', 
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: COLORS.white, 
    borderRadius: 16, 
    padding: 20, 
    maxHeight: '80%',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 12,
  },
  templateList: { 
    flexGrow: 0 
  },
  templateCardWrapper: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 12 
  },
  templateCard: { 
    flex: 1, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    backgroundColor: COLORS.surface, 
    padding: 16, 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: COLORS.border 
  },
  templateName: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: COLORS.text, 
    marginBottom: 4 
  },
  templateTime: { 
    fontSize: 14, 
    color: COLORS.textLight 
  },
  pickerOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.5)', 
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  pickerContent: { 
    backgroundColor: COLORS.white, 
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    width: '100%',
    maxWidth: 340,
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 12,
  },
  pickerTitle: { 
    fontSize: 17, 
    fontWeight: '900', 
    textAlign: 'center', 
    marginBottom: 12, 
    color: COLORS.text 
  },
  pickerColumns: { 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center', 
    height: PICKER_VIEW_HEIGHT,
    position: 'relative',
  },
  pickerSelectionFrame: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: (PICKER_VIEW_HEIGHT - PICKER_ITEM_HEIGHT) / 2,
    height: PICKER_ITEM_HEIGHT,
    borderRadius: 14,
    backgroundColor: '#FFF5D6',
    borderWidth: 1,
    borderColor: '#F4D778',
  },
  pickerWheelWrap: {
    width: 88,
    height: '100%',
    flexGrow: 0,
    flexShrink: 0,
  },
  pickerScroll: { 
    width: 88, 
    height: '100%' 
  },
  pickerScrollInner: {
    paddingVertical: (PICKER_VIEW_HEIGHT - PICKER_ITEM_HEIGHT) / 2,
  },
  pickerColon: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    color: COLORS.textLight, 
    marginHorizontal: 8 
  },
  pickerItem: { 
    height: PICKER_ITEM_HEIGHT,
    alignItems: 'center', 
    justifyContent: 'center',
    borderRadius: 12 
  },
  pickerItemActive: { 
    backgroundColor: 'transparent' 
  },
  pickerItemText: { 
    fontSize: 19, 
    color: COLORS.textLight, 
    fontWeight: '700' 
  },
  pickerItemTextActive: { 
    color: '#D6A91E', 
    fontWeight: 'bold', 
    fontSize: 22 
  },
  pickerFooter: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginTop: 16, 
    gap: 10 
  },
  pickerCancelBtn: { 
    flex: 1, 
    paddingVertical: 13, 
    backgroundColor: COLORS.surface, 
    borderRadius: 12, 
    alignItems: 'center' 
  },
  pickerCancelText: { 
    fontSize: 14, 
    fontWeight: 'bold', 
    color: COLORS.textLight 
  },
  pickerConfirmBtn: { 
    flex: 1, 
    paddingVertical: 13, 
    backgroundColor: '#D6B336', 
    borderRadius: 12, 
    alignItems: 'center' 
  },
  pickerConfirmText: { 
    fontSize: 14, 
    fontWeight: 'bold', 
    color: COLORS.white 
  },
  deleteConfirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.42)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  deleteConfirmBox: {
    width: '100%',
    maxWidth: 330,
    borderRadius: 24,
    backgroundColor: '#FFFDF8',
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FDE2E2',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
  },
  deleteConfirmIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  deleteConfirmTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 8,
  },
  deleteConfirmMessage: {
    fontSize: 14,
    lineHeight: 20,
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 18,
  },
  deleteConfirmActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  deleteConfirmCancelBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteConfirmCancelText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#4B5563',
  },
  deleteConfirmSubmitBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteConfirmSubmitText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  saveBtn: { 
    flexDirection: 'row', 
    backgroundColor: COLORS.primary, 
    padding: 16, 
    alignItems: 'center', 
    justifyContent: 'center', 
    borderRadius: 8 
  },
  saveBtnText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold'
  },
  memoBadge: {
    backgroundColor: '#FFF3CD',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginBottom: 2,
    borderLeftWidth: 2,
    borderLeftColor: '#CC7700',
  },
  memoIndicatorText: {
    fontSize: 8,
    color: '#8B5E00',
    fontWeight: 'bold',
    lineHeight: 11,
  },
});
