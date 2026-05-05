import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

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
};
type LessonTemplate = { id: string; name: string; time: string; };
type DailyData = { pickupTime?: string | null; lessons?: LessonTemplate[]; };

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

export default function ScheduleScreen() {
  const router = useRouter();
  // リストなどから飛んできたときに対象となる児童の名前（同じ名前の兄弟などは一意のIDで判定します）
  const { name } = useLocalSearchParams<{ name: string }>();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [children, setChildren] = useState<ChildInfo[]>([]);
  const [activeChildIdx, setActiveChildIdx] = useState(0);
  const [initialLoading, setInitialLoading] = useState(false);
  
  const [parentDocId, setParentDocId] = useState('');

  const [scheduleData, setScheduleData] = useState<Record<string, DailyData>>({});
  const [schoolTimesData, setSchoolTimesData] = useState<Record<string, any>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, any[]>>({});
  
  const [holidays, setHolidays] = useState<any[]>([]); 
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});
  
  const [eventsData, setEventsData] = useState<Record<string, any>>({});
  const [participantData, setParticipantData] = useState<Record<string, any>>({});

  const [lessonTemplates, setLessonTemplates] = useState<LessonTemplate[]>([]);
  const [isStampingMode, setIsStampingMode] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<LessonTemplate | null>(null);

  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [templateSelectMode, setTemplateSelectMode] = useState<'stamping' | 'singleDay' | 'edit'>('stamping');
  const [editModalVisible, setEditModalVisible] = useState(false);
  
  const [eventModalVisible, setEventModalVisible] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState('');
  
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [timePickerTarget, setTimePickerTarget] = useState<'pickup' | 'lesson'>('pickup');
  const [editingLessonIndex, setEditingLessonIndex] = useState<number>(-1);
  const [tempHour, setTempHour] = useState(15);
  const [tempMinute, setTempMinute] = useState(0);

  const [lessonAddVisible, setLessonAddVisible] = useState(false);
  const [newLessonName, setNewLessonName] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [returnToEdit, setReturnToEdit] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState<{ name: string; accountId?: string; role: string } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(raw => {
      if (raw) setLoggedInUser(JSON.parse(raw));
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

        const targetName = name || '';
        
        // ★ ④ 兄弟も含めて名前が一致する親ドキュメントを探す
        const qAccounts = query(collection(db, 'accounts'));
        const snapshot = await getDocs(qAccounts);
        
        let foundParentId = '';
        let foundData: any = null;
        
        snapshot.docs.forEach(docSnap => {
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
              days: foundData.days || {} 
            });
            if (foundData.siblings && Array.isArray(foundData.siblings)) {
              foundData.siblings.forEach((sib: any, idx: number) => {
                loadedChildren.push({ 
                  id: sib.id || `${foundParentId}_sib_${idx}`, 
                  name: sib.name, 
                  grade: sib.grade || '', 
                  school: sib.school || '', 
                  isStaffChild: false,
                  days: sib.days || {}
                });
              });
            }
          }
          setChildren(loadedChildren);
          
          // 開いた時に、渡された名前の子のタブをアクティブにする
          const targetIndex = loadedChildren.findIndex(c => c.name === targetName);
          if (targetIndex !== -1) setActiveChildIdx(targetIndex);

          onSnapshot(query(collection(db, 'schedules'), where('parentId', '==', foundParentId)), (sSnap) => {
            const sData: Record<string, DailyData> = {};
            sSnap.forEach(d => {
              const item = d.data();
              let lessons: LessonTemplate[] = [];
              if (item.lessons) {
                  lessons = item.lessons;
              } else if (item.lesson) {
                  lessons = [item.lesson];
              }
              sData[`${item.childId}_${item.dateStr}`] = { pickupTime: item.pickupTime, lessons: lessons };
            });
            setScheduleData(sData);
          });
          
          onSnapshot(doc(db, 'accounts', foundParentId), (accSnap) => {
             if(accSnap.exists()) {
                 const accData = accSnap.data();
                 if(accData.lessonTemplates) setLessonTemplates(accData.lessonTemplates);
             }
          });
        }

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
          const eData: Record<string, any> = {};
          snap.forEach(d => { eData[d.id] = d.data(); });
          setEventsData(eData);
        });
        
        onSnapshot(collection(db, 'event_participants'), (snap) => {
           const pData: Record<string, any> = {};
           snap.forEach(d => {
               const item = d.data();
               if (!pData[item.eventId]) pData[item.eventId] = {};
               pData[item.eventId][item.childId] = item.status;
           });
           setParticipantData(pData);
        });

      } catch (error) {
        console.error("データ取得エラー:", error);
      }
    };
    fetchData();
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
      return data.pickupTime === null ? 'お迎え時間を削除' : `お迎え時間を${data.pickupTime}に設定`;
    }
    if (data.lessons !== undefined) {
      const oldL = current.lessons || [];
      const newL = data.lessons || [];
      if (newL.length > oldL.length) {
        const added = newL.find(n => !oldL.find(o => o.id === n.id));
        return added ? `習い事「${added.name}」を追加(${added.time})` : '習い事を追加';
      }
      if (newL.length < oldL.length) {
        const removed = oldL.find(o => !newL.find(n => n.id === o.id));
        return removed ? `習い事「${removed.name}」を削除` : '習い事を削除';
      }
      return '習い事を変更';
    }
    return null;
  };

  const saveToFirestore = async (dateStr: string, data: Partial<DailyData>) => {
    const child = children[activeChildIdx];
    if (!child) return;
    const docId = `${child.id}_${dateStr}`;
    const current = scheduleData[docId] || {};

    setScheduleData(prev => ({ ...prev, [docId]: { ...(prev[docId] || {}), ...data } }));

    try {
      const saveData: any = { parentId: parentDocId, childId: child.id, dateStr, updatedAt: new Date() };
      if (data.pickupTime !== undefined) saveData.pickupTime = data.pickupTime;
      if (data.lessons !== undefined) saveData.lessons = data.lessons;
      await setDoc(doc(db, 'schedules', docId), saveData, { merge: true });

      // 管理者以外の操作のみログ記録
      if (loggedInUser && loggedInUser.role !== 'admin') {
        const desc = buildChangeDesc(data, current);
        if (desc) {
          await addDoc(collection(db, 'scheduleChanges'), {
            date: dateStr,
            userId: parentDocId,
            userName: loggedInUser.name,
            childName: child.name,
            description: desc,
            changedAt: serverTimestamp(),
          });

          // 変更日が今日を含む3日以内なら管理者へ通知
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const changeDay = new Date(dateStr); changeDay.setHours(0, 0, 0, 0);
          const diffDays = Math.round((changeDay.getTime() - today.getTime()) / 86400000);
          if (diffDays >= 0 && diffDays <= 2) {
            const adminTokenDoc = await getDoc(doc(db, 'fcm_tokens', 'admin'));
            if (adminTokenDoc.exists()) {
              const token = adminTokenDoc.data().token;
              if (token) {
                const d = new Date(dateStr);
                const label = `${d.getMonth() + 1}月${d.getDate()}日`;
                fetch('/api/send-notification', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tokens: [token],
                    title: `${loggedInUser.name}さんがスケジュールを変更`,
                    body: `${label} ${child.name}: ${desc}`,
                    url: '/schedule-changes',
                  }),
                }).catch(() => {});
              }
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
         setEventModalVisible(false);
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
    const userOverride = scheduleData[key] || {};
    const child = children[activeChildIdx];
    
    const autoPickup = child ? getAutoPickupTime(dateStr, child) : null;
    const finalPickup = userOverride.pickupTime !== undefined ? userOverride.pickupTime : autoPickup;
    
    return { pickupTime: finalPickup === null ? undefined : finalPickup, lessons: userOverride.lessons || [] };
  };

  const changeMonth = (offset: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
  };

  const handleDayPress = (dateStr: string) => {
    if (isStampingMode && activeTemplate) {
      const key = getScheduleKey(dateStr);
      const currentLessons = scheduleData[key]?.lessons || [];
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
      if (eventsData[dateStr]) {
          setEventModalVisible(true);
      } else {
          setEditModalVisible(true);
      }
    }
  };

  const openTimePicker = (target: 'pickup' | 'lesson', defaultTime: string, lessonIndex: number = -1) => {
    setEditModalVisible(false); // モーダル重複によるフリーズを防ぐ
    setTimePickerTarget(target);
    setEditingLessonIndex(lessonIndex);
    if (defaultTime) {
      const [h, m] = defaultTime.split(':').map(Number);
      setTempHour(h); setTempMinute(m);
    } else {
      setTempHour(15); setTempMinute(0);
    }
    // 少し遅延してからピッカーを開く（前のモーダルが閉じるのを待つ）
    setTimeout(() => setTimePickerVisible(true), 300);
  };

  const confirmTime = () => {
    const timeStr = `${String(tempHour).padStart(2, '0')}:${String(tempMinute).padStart(2, '0')}`;
    const key = getScheduleKey(selectedDateStr);
    const current = scheduleData[key] || {};

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
    const current = scheduleData[key] || {};

    if (target === 'pickup') {
       saveToFirestore(selectedDateStr, { pickupTime: null });
    } else if (target === 'lesson' && lessonIndex >= 0) {
       const updatedLessons = [...(current.lessons || [])];
       updatedLessons.splice(lessonIndex, 1);
       saveToFirestore(selectedDateStr, { lessons: updatedLessons });
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
      setActiveTemplate(template);
      setIsStampingMode(true);
      setTemplateModalVisible(false);
    } else {
      const key = getScheduleKey(selectedDateStr);
      const currentLessons = scheduleData[key]?.lessons || [];
      if (!currentLessons.find(l => l.id === template.id)) {
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
        <TouchableOpacity style={{ marginTop: 20, padding: 12, backgroundColor: COLORS.primary, borderRadius: 8 }} onPress={() => router.back()}>
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

            return (
              <TouchableOpacity key={item.dateStr} style={[styles.calCell, isStampingMode && styles.calCellStamping]} onPress={() => handleDayPress(item.dateStr)}>
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
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>スケジュール</Text>
      </View>

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

      {isStampingMode && activeTemplate && (
        <View style={styles.stampingBanner}>
          <Text style={styles.stampingText}>選択中: {activeTemplate.name} ({activeTemplate.time})</Text>
          <TouchableOpacity style={styles.stampingEndBtn} onPress={() => setIsStampingMode(false)}>
            <Text style={styles.stampingEndText}>終了</Text>
          </TouchableOpacity>
        </View>
      )}

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
        {renderCalendar()}
      </ScrollView>

      {!isStampingMode && (
        <TouchableOpacity style={styles.fab} onPress={() => { setTemplateSelectMode('stamping'); setTemplateModalVisible(true); }}>
          <Ionicons name="color-wand" size={24} color={COLORS.white} />
          <Text style={styles.fabText}>習い事</Text>
        </TouchableOpacity>
      )}

      <Modal visible={editModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.editModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedDateStr} の予定 
                {publicHolidays[selectedDateStr] ? ` (${publicHolidays[selectedDateStr]})` : ''}
              </Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                <Ionicons name="close" size={28} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.editSection}>
                  <View style={styles.editSectionHeader}>
                    <Ionicons name="home-outline" size={20} color={COLORS.primary} />
                    <Text style={styles.editSectionTitle}>利用(お迎え)時間</Text>
                  </View>
                  <View style={styles.editCard}>
                    {getCellData(selectedDateStr).pickupTime ? (
                      <>
                        <Text style={styles.editTimeText}>{getCellData(selectedDateStr).pickupTime}</Text>
                        <View style={styles.editActions}>
                          <TouchableOpacity style={styles.editActionBtn} onPress={() => openTimePicker('pickup', getCellData(selectedDateStr).pickupTime!)}>
                            <Text style={styles.btnTextPrimary}>変更</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.editActionBtn} onPress={() => deleteItem('pickup')}>
                            <Text style={styles.btnTextDanger}>削除</Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    ) : (
                      <>
                        <Text style={styles.noDataText}>利用予定はありません</Text>
                        <TouchableOpacity style={styles.addSmallBtn} onPress={() => openTimePicker('pickup', '15:00')}>
                          <Ionicons name="add" size={16} color={COLORS.white} />
                          <Text style={styles.addSmallBtnText}>手動で追加</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>

                <View style={styles.editSection}>
                  <View style={styles.editSectionHeader}>
                    <Ionicons name="bus-outline" size={20} color={COLORS.info} />
                    <Text style={styles.editSectionTitle}>習い事</Text>
                  </View>
                  
                  {getCellData(selectedDateStr).lessons && getCellData(selectedDateStr).lessons!.length > 0 ? (
                      getCellData(selectedDateStr).lessons!.map((lesson, idx) => (
                          <View key={`edit-les-${idx}`} style={[styles.editCard, {marginBottom: 8}]}>
                            <View>
                              <Text style={styles.editLessonName}>{lesson.name}</Text>
                              <Text style={styles.editTimeText}>送り: {lesson.time}</Text>
                            </View>
                            <View style={styles.editActions}>
                              <TouchableOpacity style={styles.editActionBtn} onPress={() => openTimePicker('lesson', lesson.time, idx)}>
                                <Text style={styles.btnTextPrimary}>変更</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={styles.editActionBtn} onPress={() => deleteItem('lesson', idx)}>
                                <Text style={styles.btnTextDanger}>削除</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                      ))
                  ) : (
                      <View style={styles.editCard}>
                        <Text style={styles.noDataText}>習い事はありません</Text>
                      </View>
                  )}
                  
                  <TouchableOpacity style={[styles.saveBtn, {marginTop: 8, backgroundColor: '#F0F8FF', borderColor: COLORS.primary, borderWidth: 1}]} onPress={() => {
                      setEditModalVisible(false);
                      setReturnToEdit(true);
                      setTemplateSelectMode('singleDay');
                      setTimeout(() => setTemplateModalVisible(true), 300);
                  }}>
                      <Ionicons name="add" size={20} color={COLORS.primary} style={{marginRight: 8}}/>
                      <Text style={{color: COLORS.primary, fontWeight: 'bold'}}>この日に習い事を追加</Text>
                  </TouchableOpacity>
                </View>
                <View style={{height: 20}} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={eventModalVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
              <View style={styles.editModalContent}>
                  <View style={styles.modalHeader}>
                      <View style={{flexDirection: 'row', alignItems: 'center'}}>
                          <Ionicons name="star" size={24} color="#DAA520" style={{marginRight: 8}} />
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
                      
                      <TouchableOpacity style={{marginTop: 20, alignItems: 'center', padding: 12}} onPress={() => {setEventModalVisible(false); setTimeout(()=>setEditModalVisible(true), 300);}}>
                          <Text style={{color: COLORS.primary, textDecorationLine: 'underline'}}>お迎え・習い事の時間を設定する</Text>
                      </TouchableOpacity>
                  </View>
              </View>
          </View>
      </Modal>

      <Modal visible={timePickerVisible} transparent animationType="slide">
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>時間を選択</Text>
            <View style={styles.pickerColumns}>
              <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                {HOURS.map(h => (
                  <TouchableOpacity key={`h-${h}`} style={[styles.pickerItem, tempHour === h && styles.pickerItemActive]} onPress={() => setTempHour(h)}>
                    <Text style={[styles.pickerItemText, tempHour === h && styles.pickerItemTextActive]}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={styles.pickerColon}>:</Text>
              <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                {MINUTES.map(m => (
                  <TouchableOpacity key={`m-${m}`} style={[styles.pickerItem, tempMinute === m && styles.pickerItemActive]} onPress={() => setTempMinute(m)}>
                    <Text style={[styles.pickerItemText, tempMinute === m && styles.pickerItemTextActive]}>{String(m).padStart(2, '0')}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
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

      <Modal visible={templateModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.templateContent}>
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
                                onPress={() => { setTemplateModalVisible(false); setEditingTemplateId(null); setNewLessonName(''); setTempHour(16); setTempMinute(0); setTimeout(() => setLessonAddVisible(true), 300); }}>
                  <Ionicons name="add" size={20} color={COLORS.primary} style={{marginRight: 8}}/>
                  <Text style={{color: COLORS.primary, fontWeight: 'bold'}}>新しい習い事を追加</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
      
      <Modal visible={lessonAddVisible} transparent animationType="slide">
          <View style={styles.pickerOverlay}>
              <View style={styles.pickerContent}>
                  <Text style={styles.pickerTitle}>{editingTemplateId ? '習い事を編集' : '習い事を追加'}</Text>
                  
                  <Text style={{fontWeight: 'bold', marginBottom: 8}}>習い事の名前</Text>
                  <TextInput 
                      style={{borderWidth: 1, borderColor: COLORS.border, padding: 12, borderRadius: 8, fontSize: 16, marginBottom: 20}}
                      placeholder="例: スイミング"
                      value={newLessonName}
                      onChangeText={setNewLessonName}
                  />

                  <Text style={{fontWeight: 'bold', marginBottom: 8}}>送迎時間</Text>
                  <View style={styles.pickerColumns}>
                    <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                      {HOURS.map(h => (
                        <TouchableOpacity key={`h-${h}`} style={[styles.pickerItem, tempHour === h && styles.pickerItemActive]} onPress={() => setTempHour(h)}>
                          <Text style={[styles.pickerItemText, tempHour === h && styles.pickerItemTextActive]}>{h}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <Text style={styles.pickerColon}>:</Text>
                    <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                      {MINUTES.map(m => (
                        <TouchableOpacity key={`m-${m}`} style={[styles.pickerItem, tempMinute === m && styles.pickerItemActive]} onPress={() => setTempMinute(m)}>
                          <Text style={[styles.pickerItemText, tempMinute === m && styles.pickerItemTextActive]}>{String(m).padStart(2, '0')}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
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
    backgroundColor: '#AEE4F5',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  backBtn: {
    marginRight: 16
  },
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
    paddingBottom: 40 
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
    borderColor: '#DAA520',
    borderWidth: 1,
    borderRadius: 4, 
    padding: 2, 
    marginBottom: 2 
  },
  eventBadgeText: { 
    fontSize: 8, 
    color: '#DAA520', 
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
    backgroundColor: 'rgba(0,0,0,0.5)', 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 20 
  },
  modalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 16 
  },
  modalTitle: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    color: COLORS.text 
  },
  editModalContent: { 
    width: '100%', 
    maxHeight: '90%',
    backgroundColor: COLORS.white, 
    borderRadius: 16, 
    padding: 20 
  },
  editSection: { 
    marginBottom: 20 
  },
  editSectionHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 8 
  },
  editSectionTitle: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: COLORS.text, 
    marginLeft: 8 
  },
  editCard: { 
    backgroundColor: COLORS.surface, 
    padding: 16, 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: COLORS.border, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  editTimeText: { 
    fontSize: 20, 
    fontWeight: 'bold', 
    color: COLORS.text 
  },
  editLessonName: { 
    fontSize: 14, 
    color: COLORS.textLight, 
    fontWeight: 'bold', 
    marginBottom: 4 
  },
  editActions: { 
    flexDirection: 'row', 
    gap: 12 
  },
  editActionBtn: { 
    padding: 8 
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
    color: COLORS.textLight, 
    fontStyle: 'italic', 
    flex: 1 
  },
  addSmallBtn: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: COLORS.primary, 
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    borderRadius: 6 
  },
  addSmallBtnText: { 
    color: COLORS.white, 
    fontWeight: 'bold', 
    fontSize: 12, 
    marginLeft: 4 
  },
  templateContent: { 
    width: '100%', 
    backgroundColor: COLORS.white, 
    borderRadius: 16, 
    padding: 20, 
    maxHeight: '80%' 
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
    justifyContent: 'flex-end' 
  },
  pickerContent: { 
    backgroundColor: COLORS.white, 
    borderTopLeftRadius: 24, 
    borderTopRightRadius: 24, 
    padding: 24, 
    height: 480 
  },
  pickerTitle: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    textAlign: 'center', 
    marginBottom: 20, 
    color: COLORS.text 
  },
  pickerColumns: { 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center', 
    height: 150
  },
  pickerScroll: { 
    width: 80, 
    height: '100%' 
  },
  pickerColon: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    color: COLORS.textLight, 
    marginHorizontal: 16 
  },
  pickerItem: { 
    paddingVertical: 12, 
    alignItems: 'center', 
    borderRadius: 12 
  },
  pickerItemActive: { 
    backgroundColor: COLORS.primary + '20' 
  },
  pickerItemText: { 
    fontSize: 20, 
    color: COLORS.textLight, 
    fontWeight: '500' 
  },
  pickerItemTextActive: { 
    color: COLORS.primary, 
    fontWeight: 'bold', 
    fontSize: 24 
  },
  pickerFooter: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginTop: 20, 
    gap: 16 
  },
  pickerCancelBtn: { 
    flex: 1, 
    paddingVertical: 16, 
    backgroundColor: COLORS.surface, 
    borderRadius: 12, 
    alignItems: 'center' 
  },
  pickerCancelText: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: COLORS.textLight 
  },
  pickerConfirmBtn: { 
    flex: 1, 
    paddingVertical: 16, 
    backgroundColor: COLORS.primary, 
    borderRadius: 12, 
    alignItems: 'center' 
  },
  pickerConfirmText: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: COLORS.white 
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
  }
});