import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, deleteField, doc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

// --- 型定義 ---
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
type DailyData = { pickupTime?: string | null; lesson?: LessonTemplate; };

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

export default function ScheduleScreen() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name: string }>();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [children, setChildren] = useState<ChildInfo[]>([]);
  const [activeChildIdx, setActiveChildIdx] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  
  const [scheduleData, setScheduleData] = useState<Record<string, DailyData>>({});
  const [schoolTimesData, setSchoolTimesData] = useState<Record<string, any>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, any[]>>({});
  
  const [holidays, setHolidays] = useState<any[]>([]); 
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});
  
  // ★ 追加：イベントデータの管理
  const [eventsData, setEventsData] = useState<Record<string, string>>({});

  const [lessonTemplates, setLessonTemplates] = useState<LessonTemplate[]>([
    { id: '1', name: 'ピアノ', time: '16:00' },
    { id: '2', name: 'スイミング', time: '17:30' }
  ]);
  const [isStampingMode, setIsStampingMode] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<LessonTemplate | null>(null);

  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [templateSelectMode, setTemplateSelectMode] = useState<'stamping' | 'singleDay'>('stamping');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState('');
  
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [timePickerTarget, setTimePickerTarget] = useState<'pickup' | 'lesson'>('pickup');
  const [tempHour, setTempHour] = useState(15);
  const [tempMinute, setTempMinute] = useState(0);

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
        const q = query(collection(db, 'accounts'), where('name', '==', targetName));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
          const docSnap = snapshot.docs[0];
          const data = docSnap.data();
          const parentId = docSnap.id;
          
          const loadedChildren: ChildInfo[] = [];
          
          if (data.role === 'staff' && data.hasChild) {
            loadedChildren.push({
              id: parentId, 
              name: data.childName || 'スタッフの子', 
              grade: data.childGrade || '', 
              school: data.childSchool || '', 
              isStaffChild: true, 
              parentName: data.name
            });
          } else if (data.role === 'user') {
            loadedChildren.push({ 
              id: parentId, 
              name: data.name, 
              grade: data.grade || '', 
              school: data.school || '', 
              isStaffChild: false,
              days: data.days || {} 
            });
            if (data.siblings && Array.isArray(data.siblings)) {
              data.siblings.forEach((sib: any, idx: number) => {
                loadedChildren.push({ 
                  id: `${parentId}_sib_${idx}`, 
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

          onSnapshot(query(collection(db, 'schedules'), where('parentId', '==', parentId)), (sSnap) => {
            const sData: Record<string, DailyData> = {};
            sSnap.forEach(d => {
              const item = d.data();
              sData[`${item.childId}_${item.dateStr}`] = { pickupTime: item.pickupTime, lesson: item.lesson };
            });
            setScheduleData(sData);
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

        // ★ 追加：イベントデータの取得
        onSnapshot(collection(db, 'events'), (snap) => {
          const eData: Record<string, string> = {};
          snap.forEach(d => { eData[d.id] = d.data().title; });
          setEventsData(eData);
        });

      } catch (error) {
        console.error("データ取得エラー:", error);
      } finally {
        setInitialLoading(false);
      }
    };
    fetchData();
  }, [name]);

  const saveToFirestore = async (dateStr: string, data: Partial<DailyData>) => {
    const child = children[activeChildIdx];
    if (!child) return;
    const parentId = children[0].id; 
    const docId = `${child.id}_${dateStr}`;
    
    setScheduleData(prev => {
      const current = prev[docId] || {};
      return { ...prev, [docId]: { ...current, ...data } };
    });

    try {
      await setDoc(doc(db, 'schedules', docId), {
        parentId, childId: child.id, dateStr, ...data, updatedAt: new Date()
      }, { merge: true });
    } catch (e) {
      Alert.alert('エラー', 'データの保存に失敗しました');
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
    
    return { pickupTime: finalPickup, lesson: userOverride.lesson };
  };

  const changeMonth = (offset: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
  };

  const handleDayPress = (dateStr: string) => {
    if (isStampingMode && activeTemplate) {
      const key = getScheduleKey(dateStr);
      const currentLesson = scheduleData[key]?.lesson;
      const newLesson = currentLesson?.id === activeTemplate.id ? undefined : activeTemplate;
      saveToFirestore(dateStr, { lesson: newLesson });
    } else {
      setSelectedDateStr(dateStr);
      setEditModalVisible(true);
    }
  };

  const openTimePicker = (target: 'pickup' | 'lesson', defaultTime: string) => {
    setTimePickerTarget(target);
    if (defaultTime) {
      const [h, m] = defaultTime.split(':').map(Number);
      setTempHour(h); setTempMinute(m);
    } else {
      setTempHour(15); setTempMinute(0);
    }
    setTimePickerVisible(true);
  };

  const confirmTime = () => {
    const timeStr = `${String(tempHour).padStart(2, '0')}:${String(tempMinute).padStart(2, '0')}`;
    const key = getScheduleKey(selectedDateStr);
    const current = scheduleData[key] || {};
    if (timePickerTarget === 'pickup') {
      saveToFirestore(selectedDateStr, { pickupTime: timeStr });
    } else {
      saveToFirestore(selectedDateStr, { lesson: current.lesson ? { ...current.lesson, time: timeStr } : undefined });
    }
    setTimePickerVisible(false);
  };

  const deleteItem = async (target: 'pickup' | 'lesson') => {
    const child = children[activeChildIdx];
    if (!child) return;
    const docId = `${child.id}_${selectedDateStr}`;

    setScheduleData(prev => {
      const current = { ...prev[docId] };
      if (target === 'pickup') {
        delete current.pickupTime;
      } else {
        delete current.lesson;
      }
      return { ...prev, [docId]: current };
    });

    try {
      await setDoc(doc(db, 'schedules', docId), {
        [target === 'pickup' ? 'pickupTime' : 'lesson']: deleteField(),
        updatedAt: new Date()
      }, { merge: true });
    } catch (e) {
      console.log('削除エラー', e);
    }
  };

  const handleSelectTemplate = (template: LessonTemplate) => {
    if (templateSelectMode === 'stamping') {
      setActiveTemplate(template);
      setIsStampingMode(true);
      setTemplateModalVisible(false);
    } else {
      saveToFirestore(selectedDateStr, { lesson: template });
      setTemplateModalVisible(false);
    }
  };

  if (initialLoading) {
    return <SafeAreaView style={[styles.container, { justifyContent: 'center' }]}><ActivityIndicator size="large" color={COLORS.primary}/></SafeAreaView>;
  }

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
            const isEventDay = !!eventsData[item.dateStr]; // ★ イベントがあるか判定

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
                  {/* ★ イベント表示バッジを追加 */}
                  {isEventDay && (
                    <View style={styles.eventBadge}>
                      <Text style={styles.eventBadgeText} numberOfLines={1}>{eventsData[item.dateStr]}</Text>
                    </View>
                  )}
                  {cellData.pickupTime && <View style={styles.pickupBadge}><Text style={styles.pickupText}>迎 {cellData.pickupTime}</Text></View>}
                  {cellData.lesson && (
                    <View style={styles.lessonBadge}>
                      <Text style={styles.lessonText}>{cellData.lesson.name}</Text>
                      <Text style={styles.lessonTimeText}>{cellData.lesson.time}</Text>
                    </View>
                  )}
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
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
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

      {/* --- モーダル群 --- */}
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
                        <Text style={styles.btnTextDanger}>削除(自動に戻す)</Text>
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
              <View style={styles.editCard}>
                {getCellData(selectedDateStr).lesson ? (
                  <>
                    <View>
                      <Text style={styles.editLessonName}>{getCellData(selectedDateStr).lesson?.name}</Text>
                      <Text style={styles.editTimeText}>送り: {getCellData(selectedDateStr).lesson?.time}</Text>
                    </View>
                    <View style={styles.editActions}>
                      <TouchableOpacity style={styles.editActionBtn} onPress={() => openTimePicker('lesson', getCellData(selectedDateStr).lesson!.time)}>
                        <Text style={styles.btnTextPrimary}>時間変更</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.editActionBtn} onPress={() => deleteItem('lesson')}>
                        <Text style={styles.btnTextDanger}>削除</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.noDataText}>習い事はありません</Text>
                    <TouchableOpacity style={styles.addSmallBtn} onPress={() => { setTemplateSelectMode('singleDay'); setTemplateModalVisible(true); }}>
                      <Ionicons name="add" size={16} color={COLORS.white} />
                      <Text style={styles.addSmallBtnText}>追加</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
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
              <TouchableOpacity style={styles.pickerCancelBtn} onPress={() => setTimePickerVisible(false)}>
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
              <Text style={styles.modalTitle}>習い事を選択</Text>
              <TouchableOpacity onPress={() => { setTemplateModalVisible(false); }}>
                <Ionicons name="close" size={28} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.templateList} showsVerticalScrollIndicator={false}>
              {lessonTemplates.map(t => (
                <View key={t.id} style={styles.templateCardWrapper}>
                  <TouchableOpacity style={styles.templateCard} onPress={() => handleSelectTemplate(t)}>
                    <View>
                      <Text style={styles.templateName}>{t.name}</Text>
                      <Text style={styles.templateTime}>送り: {t.time}</Text>
                    </View>
                    <Ionicons name={templateSelectMode === 'stamping' ? "color-wand-outline" : "checkmark-circle-outline"} size={24} color={COLORS.primary} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: COLORS.background 
  },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 20, 
    backgroundColor: COLORS.surface, 
    borderBottomWidth: 1, 
    borderColor: COLORS.border 
  },
  backBtn: { 
    marginRight: 16 
  },
  headerTitle: { 
    fontSize: 20, 
    fontWeight: 'bold', 
    color: COLORS.text, 
    flex: 1 
  },
  childTabs: { 
    flexDirection: 'row', 
    backgroundColor: COLORS.surface, 
    paddingHorizontal: 12, 
    paddingTop: 12, 
    borderBottomWidth: 1, 
    borderColor: COLORS.border 
  },
  childTabBtn: { 
    flex: 1, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    paddingVertical: 12, 
    borderTopLeftRadius: 12, 
    borderTopRightRadius: 12, 
    backgroundColor: '#F5F5F5', 
    marginHorizontal: 4 
  },
  childTabBtnActive: { 
    backgroundColor: COLORS.white, 
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
    padding: 16 
  },
  monthBtn: { 
    padding: 8, 
    backgroundColor: COLORS.surface, 
    borderRadius: 20, 
    borderWidth: 1, 
    borderColor: COLORS.border 
  },
  monthText: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    color: COLORS.text 
  },
  calendarContainer: { 
    paddingHorizontal: 8, 
    paddingBottom: 40 
  },
  calHeaderRow: { 
    flexDirection: 'row', 
    marginBottom: 8 
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
    aspectRatio: 0.7 
  },
  calCell: { 
    width: '14.28%', 
    aspectRatio: 0.65, 
    borderWidth: 0.5, 
    borderColor: COLORS.border, 
    padding: 2, 
    backgroundColor: COLORS.white 
  },
  calCellStamping: { 
    backgroundColor: '#FAFAFA' 
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
    backgroundColor: COLORS.primary, 
    borderRadius: 4, 
    padding: 2, 
    marginBottom: 2 
  },
  eventBadgeText: { 
    fontSize: 8, 
    color: COLORS.white, 
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
    padding: 2 
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
    height: 400 
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
    flex: 1 
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
  }
});