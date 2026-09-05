import { Ionicons } from '@expo/vector-icons';
import { useRequireRole } from '../hooks/useRequireRole';
import { useRouter } from 'expo-router';
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Modal, Platform, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View
} from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { navigateHome } from '../utils/navigationHome';
import CenteredTimePickerModal from '../components/CenteredTimePickerModal';

const customAlert = (title: string, message?: string) => {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
};

const customConfirm = (title: string, message: string, onConfirm: () => void) => {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: onConfirm }
    ]);
  }
};

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const WEEKDAY_ORDER = ['月', '火', '水', '木', '金'];

interface Kid {
  id: string;
  name: string;
  school: string;
  grade: string;
  gradeNum: number;
  nicknameKana: string;
  isStaffChild?: boolean;
  parentName?: string;
}

const LESSON_COLORS = [
  '#FFE0B2','#F8BBD0','#DCEDC8','#B3E5FC','#E1BEE7',
  '#FFE082','#B2DFDB','#FFCCBC','#C5CAE9','#F0F4C3',
];
const getLessonColor = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return LESSON_COLORS[Math.abs(hash) % LESSON_COLORS.length];
};

interface Lesson {
  id?: string;
  childId: string;
  childName: string;
  school: string;
  lessonName: string;
  lessonTime: string;
  dayOfWeek?: string;
  isPaid?: boolean;
  isExternal?: boolean;
  validFrom?: string;
  validTo?: string;
}

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${year}年${month}月${day}日`;
};

const getGradeNum = (grade: string) => {
  const m = grade.match(/\d/);
  return m ? parseInt(m[0], 10) : 99;
};

export default function LessonManagementScreen() {
  const { verified, checking } = useRequireRole('admin');

  const router = useRouter();

  const [kids, setKids] = useState<Kid[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);

  const [lessonName, setLessonName] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [editingLesson, setEditingLesson] = useState<any>(null);
  const [selectedDayOfWeek, setSelectedDayOfWeek] = useState('月');
  const [selectedTime, setSelectedTime] = useState('15:00');
  const [selectedKidIds, setSelectedKidIds] = useState<string[]>([]);
  const [childSource, setChildSource] = useState<'account' | 'external'>('account');
  const [externalChildName, setExternalChildName] = useState('');
  const [externalStartDate, setExternalStartDate] = useState(() => toDateKey(new Date()));
  const [externalEndDate, setExternalEndDate] = useState(() => {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    return toDateKey(date);
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSchool, setFilterSchool] = useState('');
  const [filterGrade, setFilterGrade] = useState('');

  const [viewMode, setViewMode] = useState<'list' | 'edit'>('list');
  const [selectedDayFilters, setSelectedDayFilters] = useState<string[]>([]);
  const [memberModalLessonName, setMemberModalLessonName] = useState<string | null>(null);
  const [memberModalDays, setMemberModalDays] = useState<string[]>([]);

  // 編集モーダル用
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editModalLesson, setEditModalLesson] = useState<Lesson | null>(null);
  const [editModalName, setEditModalName] = useState('');
  const [editModalDay, setEditModalDay] = useState('月');
  const [editModalTime, setEditModalTime] = useState('15:00');
  const [editModalIsPaid, setEditModalIsPaid] = useState(false);
  const [editModalTimePickerVisible, setEditModalTimePickerVisible] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<'start' | 'end'>('start');
  const [datePickerMonth, setDatePickerMonth] = useState(() => new Date());

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const snap = await getDocs(collection(db, 'accounts'));
      const allKids: Kid[] = [];

      snap.docs.forEach(docSnap => {
        const d = docSnap.data();
        const parentId = docSnap.id;

        // スタッフの子供
        if (d.role === 'staff' && d.hasChild) {
          if (d.staffChildren && d.staffChildren.length > 0) {
            d.staffChildren.forEach((child: any, idx: number) => {
              if (!child.name) return; // 名前がない場合はスキップ
              allKids.push({
                id: `${parentId}_${child.id || `staffchild_${idx}`}`,
                name: child.name,
                school: child.school || '',
                grade: child.grade || '',
                gradeNum: getGradeNum(child.grade || ''),
                nicknameKana: '',
                isStaffChild: true,
                parentName: d.name,
              });
            });
          } else if (d.childName) {
            allKids.push({
              id: `${parentId}_staffchild_0`,
              name: d.childName,
              school: d.childSchool || '',
              grade: d.childGrade || '',
              gradeNum: getGradeNum(d.childGrade || ''),
              nicknameKana: '',
              isStaffChild: true,
              parentName: d.name,
            });
          }
        }

        // 一般利用者とその兄弟
        if (d.role === 'user') {
          if (d.school) {
            allKids.push({
              id: parentId,
              name: d.name,
              school: d.school,
              grade: d.grade || '',
              gradeNum: getGradeNum(d.grade || ''),
              nicknameKana: d.nicknameKana || '',
              isStaffChild: false,
              parentName: undefined,
            });
          }
          if (d.siblings && Array.isArray(d.siblings)) {
            d.siblings.forEach((sib: any, idx: number) => {
              if (sib.school) {
                allKids.push({
                  id: sib.id || `${parentId}_sib_${idx}`,
                  name: sib.name,
                  school: sib.school,
                  grade: sib.grade || '',
                  gradeNum: getGradeNum(sib.grade || ''),
                  nicknameKana: sib.nicknameKana || '',
                  isStaffChild: false,
                  parentName: undefined,
                });
              }
            });
          }
        }
      });

      allKids.sort((a, b) => a.gradeNum - b.gradeNum);
      // 重複ID除去
      const uniqueKids = allKids.filter((k, i, arr) => arr.findIndex(x => x.id === k.id) === i);
      setKids(uniqueKids);

      const lessonsSnap = await getDocs(collection(db, 'lessons'));
      setLessons(lessonsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Lesson)));
    } catch (e) {
      console.error(e);
    }
  };

  const allSchools = useMemo(() => [...new Set(kids.map(k => k.school).filter(Boolean))].sort(), [kids]);
  const allGrades = useMemo(() => {
    const g = [...new Set(kids.map(k => k.grade).filter(Boolean))];
    return g.sort((a, b) => {
      const na = parseInt(a.match(/\d/)?.[0] || '99');
      const nb = parseInt(b.match(/\d/)?.[0] || '99');
      return na - nb;
    });
  }, [kids]);

  const memberModalLessons = useMemo(() => {
    if (!memberModalLessonName) return [];
    return lessons
      .filter(lesson => lesson.lessonName === memberModalLessonName)
      .filter(lesson => memberModalDays.length === 0 || memberModalDays.includes(lesson.dayOfWeek || ''))
      .sort((a, b) => {
        const dayDifference = WEEKDAY_ORDER.indexOf(a.dayOfWeek || '') - WEEKDAY_ORDER.indexOf(b.dayOfWeek || '');
        if (dayDifference !== 0) return dayDifference;
        const timeDifference = (a.lessonTime || '').localeCompare(b.lessonTime || '');
        if (timeDifference !== 0) return timeDifference;
        const aGrade = kids.find(kid => kid.id === a.childId)?.gradeNum ?? 99;
        const bGrade = kids.find(kid => kid.id === b.childId)?.gradeNum ?? 99;
        if (aGrade !== bGrade) return aGrade - bGrade;
        return a.childName.localeCompare(b.childName, 'ja');
      });
  }, [kids, lessons, memberModalDays, memberModalLessonName]);

  const filteredKids = useMemo(() => {
    const seen = new Set<string>();
    return kids.filter(k => {
      if (seen.has(k.id)) return false;
      seen.add(k.id);
      if (filterSchool && k.school !== filterSchool) return false;
      if (filterGrade && k.grade !== filterGrade) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      return (k.name || '').toLowerCase().includes(q) || (k.nicknameKana || '').toLowerCase().includes(q);
    });
  }, [kids, searchQuery, filterSchool, filterGrade]);

  const openTimePicker = () => {
    setViewMode('list');
    setTimePickerVisible(true);
  };

  const openEditTimePicker = () => {
    setEditModalVisible(false);
    setEditModalTimePickerVisible(true);
  };

  const toggleKid = (kidId: string) => {
    setSelectedKidIds(prev =>
      prev.includes(kidId) ? prev.filter(id => id !== kidId) : [...prev, kidId]
    );
  };

  const handleRegister = async () => {
    if (!lessonName.trim()) { customAlert('エラー', '習い事の名前を入力してください'); return; }
    if (childSource === 'external') {
      if (!externalChildName.trim()) { customAlert('エラー', '外部児童の名前を入力してください'); return; }
      if (!externalStartDate || !externalEndDate || externalStartDate > externalEndDate) {
        customAlert('エラー', '表示期間を正しく入力してください');
        return;
      }
      try {
        await addDoc(collection(db, 'lessons'), {
          childId: `external_${Date.now()}`,
          childName: externalChildName.trim(),
          school: '外部',
          lessonName: lessonName.trim(),
          lessonTime: selectedTime,
          dayOfWeek: selectedDayOfWeek,
          isPaid,
          isExternal: true,
          validFrom: externalStartDate,
          validTo: externalEndDate,
        });
        customAlert('成功', `${externalChildName.trim()}さんの習い事を登録しました`);
        resetForm();
        await fetchData();
        setViewMode('list');
      } catch (e) {
        console.error('外部児童の登録失敗:', e);
        customAlert('エラー', '登録に失敗しました');
      }
      return;
    }
    if (selectedKidIds.length === 0) { customAlert('エラー', '児童を1人以上選択してください'); return; }

    let successCount = 0;
    const errors: string[] = [];

    for (const kidId of selectedKidIds) {
      const kid = kids.find(k => k.id === kidId);
      if (!kid) {
        errors.push(`ID:${kidId} が見つかりません`);
        continue;
      }
      try {
        await addDoc(collection(db, 'lessons'), {
          childId: kid.id,
          childName: kid.name,
          school: kid.school,
          lessonName: lessonName.trim(),
          lessonTime: selectedTime,
          dayOfWeek: selectedDayOfWeek,
          isPaid: isPaid,
        });
        successCount++;
      } catch (e: any) {
        console.error(`${kid.name} の登録失敗:`, e);
        errors.push(`${kid.name}: ${e?.message || String(e)}`);
      }
    }

    if (errors.length > 0) {
      customAlert('一部エラー', `${successCount}名登録成功\n失敗:\n${errors.join('\n')}`);
    } else {
      customAlert('成功', `${successCount}名に習い事を登録しました`);
    }
    if (successCount > 0) {
      resetForm();
      await fetchData();
      setViewMode('list');
    }
  };

  const handleUpdate = async () => {
    if (!editModalLesson?.id) return;
    if (!editModalName.trim()) { customAlert('エラー', '習い事名を入力してください'); return; }
    try {
      await updateDoc(doc(db, 'lessons', editModalLesson.id), {
        lessonName: editModalName.trim(),
        lessonTime: editModalTime,
        dayOfWeek: editModalDay,
        isPaid: editModalIsPaid,
      });
      customAlert('更新完了', '習い事を更新しました');
      setEditModalVisible(false);
      fetchData();
    } catch (e) {
      customAlert('エラー', '更新に失敗しました');
    }
  };

  const openEditModal = (lesson: Lesson) => {
    setEditModalLesson(lesson);
    setEditModalName(lesson.lessonName);
    setEditModalDay(lesson.dayOfWeek || '月');
    setEditModalTime(lesson.lessonTime);
    setEditModalIsPaid(!!lesson.isPaid);
    setEditModalVisible(true);
  };

  const handleDelete = (lessonId: string) => {
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) return;
    customConfirm('削除確認', `${lesson.childName}の「${lesson.lessonName}」を削除しますか?`, async () => {
      try {
        await deleteDoc(doc(db, 'lessons', lessonId));
        customAlert('削除完了', '削除しました');
        fetchData();
      } catch (e) {
        customAlert('エラー', '削除に失敗しました');
      }
    });
  };

  const resetForm = () => {
    setLessonName('');
    setSelectedDayOfWeek('月');
    setSelectedTime('15:00');
    setSelectedKidIds([]);
    setChildSource('account');
    setExternalChildName('');
    setExternalStartDate(toDateKey(new Date()));
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    setExternalEndDate(toDateKey(nextMonth));
    setSearchQuery('');
    setFilterSchool('');
    setFilterGrade('');
  };

  const closeCreateModal = () => {
    resetForm();
    setViewMode('list');
  };

  const openDatePicker = (target: 'start' | 'end') => {
    const current = target === 'start' ? externalStartDate : externalEndDate;
    const parsed = new Date(`${current}T00:00:00`);
    setDatePickerTarget(target);
    setDatePickerMonth(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
    setViewMode('list');
    setDatePickerVisible(true);
  };

  const selectExternalDate = (dateKey: string) => {
    if (datePickerTarget === 'start') {
      setExternalStartDate(dateKey);
      if (dateKey > externalEndDate) setExternalEndDate(dateKey);
    } else {
      setExternalEndDate(dateKey < externalStartDate ? externalStartDate : dateKey);
    }
    setDatePickerVisible(false);
    setViewMode('edit');
  };

  const calendarCells = useMemo(() => {
    const year = datePickerMonth.getFullYear();
    const month = datePickerMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    return [
      ...Array.from({ length: firstDay }, () => null),
      ...Array.from({ length: days }, (_, index) => {
        const date = new Date(year, month, index + 1);
        return { day: index + 1, key: toDateKey(date) };
      }),
    ];
  }, [datePickerMonth]);

  if (checking || !verified) return null;
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigateHome(router)}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>習い事一覧管理</Text>
      </View>

      {viewMode === 'list' ? (
        <>
          <ScrollView style={styles.mainScroll} contentContainerStyle={styles.listContent}>
            <View style={styles.weekdayFilterRow}>
              {WEEKDAY_ORDER.map(day => (
                <TouchableOpacity
                  key={day}
                  style={[styles.weekdayFilterButton, selectedDayFilters.includes(day) && styles.weekdayFilterButtonActive]}
                  onPress={() => setSelectedDayFilters(current => current.includes(day) ? current.filter(item => item !== day) : [...current, day])}
                >
                  <Text style={[styles.weekdayFilterText, selectedDayFilters.includes(day) && styles.weekdayFilterTextActive]}>{day}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {(() => {
              const dayFiltered = selectedDayFilters.length === 0
                ? lessons
                : lessons.filter(l => selectedDayFilters.includes(l.dayOfWeek || ''));
              const filtered = dayFiltered;
              if (filtered.length === 0) return (
                <View style={styles.emptyBox}>
                  <Ionicons name="book-outline" size={48} color={COLORS.textLight} />
                  <Text style={styles.emptyText}>
                    条件に合う習い事はありません
                  </Text>
                </View>
              );
              // 習い事名でグルーピング → その中を時間でサブグルーピング
              const nameGroups = new Map<string, typeof filtered>();
              filtered.forEach(l => {
                if (!nameGroups.has(l.lessonName)) nameGroups.set(l.lessonName, []);
                nameGroups.get(l.lessonName)!.push(l);
              });
              const nameEntries = [...nameGroups.entries()].sort(([a],[b]) => a.localeCompare(b, 'ja'));

              return (
                <View style={styles.lessonGrid}>
                  {nameEntries.map(([lessonName, nameGroup]) => {
                const nameKey = `name_${lessonName}`;
                const isPaid = nameGroup.some(l => l.isPaid);
                const totalCount = nameGroup.length;

                return (
                  <View
                    key={nameKey}
                    style={[
                      styles.groupCard,
                      styles.groupCardCompact,
                      { borderLeftColor: getLessonColor(lessonName) },
                    ]}
                  >
                    {/* 習い事名ヘッダー */}
                    <TouchableOpacity
                      style={styles.groupHeader}
                      onPress={() => { setMemberModalDays([]); setMemberModalLessonName(lessonName); }}
                      activeOpacity={0.75}
                    >
                      <View style={{ flex:1 }}>
                        <View style={{ flexDirection:'row', alignItems:'center', gap:6, marginBottom:4 }}>
                          <Text style={styles.groupName}>{lessonName}</Text>
                          {isPaid && <View style={styles.paidBadge}><Text style={styles.paidBadgeText}>有料</Text></View>}
                        </View>
                        <View style={{ flexDirection:'row', gap:6 }}>
                          <View style={[styles.lessonBadge, { backgroundColor: '#E8F5E9' }]}>
                            <Text style={[styles.lessonBadgeText, { color:'#388E3C' }]}>{totalCount}名</Text>
                          </View>
                        </View>
                      </View>
                      <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                        <TouchableOpacity
                          style={styles.groupAddBtn}
                          onPress={() => {
                            resetForm();
                            setLessonName(lessonName);
                            setIsPaid(!!isPaid);
                            setViewMode('edit');
                          }}
                        >
                          <Ionicons name="person-add-outline" size={16} color={COLORS.primary} />
                          <Text style={styles.groupAddText}>追加</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  </View>
                );
                  })}
                </View>
              );
            })()}
          </ScrollView>
        </>
      ) : (
        <Modal visible transparent animationType="fade" onRequestClose={closeCreateModal}>
          <View style={styles.formModalOverlay}>
            <TouchableWithoutFeedback onPress={closeCreateModal} accessible={false}>
              <View style={styles.modalBackdropClose} />
            </TouchableWithoutFeedback>
            <View style={styles.formModalSurface}>
              <View style={styles.formModalHeader}>
                <Text style={styles.formModalTitle}>習い事を新規追加</Text>
                <TouchableOpacity style={styles.formModalClose} onPress={closeCreateModal} accessibilityLabel="新規追加を閉じる">
                  <Ionicons name="close" size={24} color={COLORS.text} />
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={styles.formModalScrollContent}>

          {/* STEP 1: 習い事の名前 */}
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>1</Text></View>
              <Text style={styles.stepTitle}>習い事の名前</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="例: 習字、ピアノ、野球"
              placeholderTextColor="#BBBBBB"
              value={lessonName}
              onChangeText={setLessonName}
            />

            {/* 有料トグル */}
            <TouchableOpacity
              style={[styles.paidToggle, isPaid && styles.paidToggleActive]}
              onPress={() => setIsPaid(!isPaid)}
            >
              <Ionicons name={isPaid ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={isPaid ? '#fff' : COLORS.textLight} />
              <Text style={[styles.paidToggleText, isPaid && { color: '#fff' }]}>有料送迎（500円/回）</Text>
            </TouchableOpacity>
          </View>

          {/* STEP 2: 曜日 */}
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>2</Text></View>
              <Text style={styles.stepTitle}>曜日</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {['月', '火', '水', '木', '金'].map(day => (
                <TouchableOpacity
                  key={day}
                  style={[styles.dayBtn, selectedDayOfWeek === day && styles.dayBtnActive]}
                  onPress={() => setSelectedDayOfWeek(day)}
                >
                  <Text style={[styles.dayBtnText, selectedDayOfWeek === day && styles.dayBtnTextActive]}>{day}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* STEP 3: 開始時間 */}
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>3</Text></View>
              <Text style={styles.stepTitle}>開始時間</Text>
            </View>
            <TouchableOpacity style={styles.timeSelectBtn} onPress={openTimePicker}>
              <Ionicons name="time-outline" size={22} color={COLORS.primary} />
              <Text style={styles.timeSelectText}>{selectedTime}</Text>
              <Text style={styles.timeSelectHint}>タップして変更</Text>
            </TouchableOpacity>
          </View>

          {/* STEP 4: 児童を検索して選択 */}
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>4</Text></View>
              <Text style={styles.stepTitle}>児童を選択</Text>
              {childSource === 'account' && selectedKidIds.length > 0 && (
                <View style={styles.selectedCountBadge}>
                  <Text style={styles.selectedCountText}>{selectedKidIds.length}名</Text>
                </View>
              )}
            </View>

            <View style={styles.sourceTabs}>
              <TouchableOpacity
                style={[styles.sourceTab, childSource === 'account' && styles.sourceTabActive]}
                onPress={() => setChildSource('account')}
              >
                <Text style={[styles.sourceTabText, childSource === 'account' && styles.sourceTabTextActive]}>登録済み児童</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sourceTab, childSource === 'external' && styles.sourceTabActive]}
                onPress={() => setChildSource('external')}
              >
                <Text style={[styles.sourceTabText, childSource === 'external' && styles.sourceTabTextActive]}>外部</Text>
              </TouchableOpacity>
            </View>

            {childSource === 'external' ? (
              <View style={styles.externalForm}>
                <Text style={styles.fieldLabel}>名前</Text>
                <TextInput
                  style={styles.input}
                  value={externalChildName}
                  onChangeText={setExternalChildName}
                  placeholder="例: 山田 はな"
                  placeholderTextColor="#BBBBBB"
                />
                <Text style={[styles.fieldLabel, { marginTop: 14 }]}>表示する期間</Text>
                <View style={styles.dateRangeRow}>
                  <TouchableOpacity style={styles.dateField} onPress={() => openDatePicker('start')}>
                    <Text style={styles.dateFieldCaption}>開始日</Text>
                    <Text style={styles.dateFieldValue}>{formatDateLabel(externalStartDate)}</Text>
                  </TouchableOpacity>
                  <Text style={styles.dateRangeSeparator}>〜</Text>
                  <TouchableOpacity style={styles.dateField} onPress={() => openDatePicker('end')}>
                    <Text style={styles.dateFieldCaption}>終了日</Text>
                    <Text style={styles.dateFieldValue}>{formatDateLabel(externalEndDate)}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.externalHint}>この期間の該当曜日だけ、習い事・送迎一覧に表示されます。</Text>
              </View>
            ) : (
              <>

            {/* 検索バー */}
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={COLORS.textLight} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="名前またはニックネームで検索"
                placeholderTextColor="#BBBBBB"
                value={searchQuery}
                onChangeText={setSearchQuery}
                clearButtonMode="while-editing"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={COLORS.textLight} />
                </TouchableOpacity>
              )}
            </View>

            {/* 学校・学年フィルター */}
            <View style={{ marginBottom: 10 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
                <TouchableOpacity style={[styles.filterChip, !filterSchool && styles.filterChipActive]} onPress={() => setFilterSchool('')}>
                  <Text style={[styles.filterChipText, !filterSchool && styles.filterChipTextActive]}>全校</Text>
                </TouchableOpacity>
                {allSchools.map(s => (
                  <TouchableOpacity key={s} style={[styles.filterChip, filterSchool === s && styles.filterChipActive]} onPress={() => setFilterSchool(filterSchool === s ? '' : s)}>
                    <Text style={[styles.filterChipText, filterSchool === s && styles.filterChipTextActive]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 4 }}>
                <TouchableOpacity style={[styles.filterChip, !filterGrade && styles.filterChipActive]} onPress={() => setFilterGrade('')}>
                  <Text style={[styles.filterChipText, !filterGrade && styles.filterChipTextActive]}>全学年</Text>
                </TouchableOpacity>
                {allGrades.map(g => (
                  <TouchableOpacity key={g} style={[styles.filterChip, filterGrade === g && styles.filterChipActive]} onPress={() => setFilterGrade(filterGrade === g ? '' : g)}>
                    <Text style={[styles.filterChipText, filterGrade === g && styles.filterChipTextActive]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* 選択済みタグ */}
            {selectedKidIds.length > 0 && (
              <View style={styles.selectedTagsRow}>
                {selectedKidIds.map(id => {
                  const kid = kids.find(k => k.id === id);
                  if (!kid) return null;
                  return (
                    <TouchableOpacity key={id} style={styles.selectedTag} onPress={() => toggleKid(id)}>
                      <Text style={styles.selectedTagText}>{kid.name}</Text>
                      <Ionicons name="close" size={12} color={COLORS.white} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* 児童リスト */}
            <View style={styles.kidsListContainer}>
              {filteredKids.length === 0 ? (
                <Text style={styles.noResultText}>該当する児童が見つかりません</Text>
              ) : (
                filteredKids.map(kid => {
                  const isSelected = selectedKidIds.includes(kid.id);
                  return (
                    <TouchableOpacity
                      key={kid.id}
                      style={[styles.kidListItem, isSelected && styles.kidListItemActive]}
                      onPress={() => toggleKid(kid.id)}
                    >
                      <View style={[styles.kidListIcon, isSelected && styles.kidListIconActive]}>
                        {isSelected
                          ? <Ionicons name="checkmark" size={16} color={COLORS.white} />
                          : <Ionicons name="person" size={16} color={COLORS.textLight} />
                        }
                      </View>
                      <View style={styles.kidListInfo}>
                        <Text style={[styles.kidListName, isSelected && styles.kidListNameActive]}>{kid.name}</Text>
                        <Text style={styles.kidListSub}>
                          {kid.grade}　{kid.school}
                          {kid.isStaffChild ? `　[スタッフ: ${kid.parentName}]` : kid.nicknameKana ? `　(${kid.nicknameKana})` : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
              </>
            )}
          </View>

          <TouchableOpacity
            style={[
              styles.submitBtn,
              (!lessonName || (childSource === 'account' ? selectedKidIds.length === 0 : !externalChildName.trim())) && styles.submitBtnDisabled,
            ]}
            onPress={handleRegister}
            disabled={!lessonName || (childSource === 'account' ? selectedKidIds.length === 0 : !externalChildName.trim())}
          >
            <Ionicons name="checkmark-circle" size={22} color={COLORS.white} />
            <Text style={styles.submitBtnText}>
              {childSource === 'external'
                ? '外部児童を登録する'
                : selectedKidIds.length > 0 ? `${selectedKidIds.length}名に登録する` : '登録する'}
            </Text>
          </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {viewMode === 'list' && (
        <TouchableOpacity
          style={styles.floatingAddButton}
          onPress={() => { resetForm(); setViewMode('edit'); }}
          accessibilityLabel="習い事を新規追加"
        >
          <Ionicons name="add" size={30} color={COLORS.white} />
        </TouchableOpacity>
      )}

      <Modal visible={!!memberModalLessonName} transparent animationType="fade" onRequestClose={() => setMemberModalLessonName(null)}>
        <View style={styles.memberModalOverlay}>
          <TouchableWithoutFeedback onPress={() => setMemberModalLessonName(null)} accessible={false}>
            <View style={styles.modalBackdropClose} />
          </TouchableWithoutFeedback>
          <View style={styles.memberModalSurface}>
            <View style={styles.memberModalHeader}>
              <View>
                <Text style={styles.memberModalTitle}>{memberModalLessonName}</Text>
                <Text style={styles.memberModalSubtitle}>メンバー</Text>
              </View>
              <TouchableOpacity style={styles.formModalClose} onPress={() => setMemberModalLessonName(null)} accessibilityLabel="メンバー一覧を閉じる">
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.memberDayFilterRow}>
              {WEEKDAY_ORDER.map(day => (
                <TouchableOpacity
                  key={day}
                  style={[styles.memberDayFilterButton, memberModalDays.includes(day) && styles.memberDayFilterButtonActive]}
                  onPress={() => setMemberModalDays(current => current.includes(day) ? current.filter(item => item !== day) : [...current, day])}
                >
                  <Text style={[styles.memberDayFilterText, memberModalDays.includes(day) && styles.memberDayFilterTextActive]}>{day}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView contentContainerStyle={styles.memberModalList}>
              {memberModalLessons.map((lesson, index) => {
                const previousLesson = memberModalLessons[index - 1];
                const showDayHeading = !previousLesson || previousLesson.dayOfWeek !== lesson.dayOfWeek;
                const showTimeHeading = showDayHeading || previousLesson?.lessonTime !== lesson.lessonTime;
                const kid = kids.find(item => item.id === lesson.childId);
                return (
                  <React.Fragment key={lesson.id}>
                    {showDayHeading && <Text style={styles.memberDayHeading}>{lesson.dayOfWeek || '曜日未設定'}曜日</Text>}
                    {showTimeHeading && <Text style={styles.memberTimeHeading}>{lesson.lessonTime}</Text>}
                    <View style={styles.memberListRow}>
                      <TouchableOpacity
                        style={styles.memberListMain}
                        onPress={() => { setMemberModalLessonName(null); openEditModal(lesson); }}
                        accessibilityLabel={`${lesson.childName}を編集`}
                      >
                        <View style={styles.memberListIcon}>
                          <Ionicons name="person" size={17} color={COLORS.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.groupChildName}>{lesson.childName || '(名前不明)'}</Text>
                          <Text style={styles.groupChildSchool}>{kid ? `${kid.grade}　${kid.school}` : lesson.school || '外部'}</Text>
                        </View>
                        {lesson.isPaid && <Text style={styles.memberPaidText}>有料</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDelete(lesson.id || '')} accessibilityLabel={`${lesson.childName}を削除`}>
                        <Ionicons name="trash-outline" size={19} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  </React.Fragment>
                );
              })}
              {memberModalLessons.length === 0 && <Text style={styles.noResultText}>この曜日に登録されたメンバーはいません</Text>}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── 個別編集モーダル ── */}
      <Modal visible={editModalVisible} transparent animationType="fade" onRequestClose={() => setEditModalVisible(false)}>
        <View style={styles.editModalOverlay}>
          <TouchableWithoutFeedback onPress={() => setEditModalVisible(false)} accessible={false}>
            <View style={styles.modalBackdropClose} />
          </TouchableWithoutFeedback>
          <View style={styles.editModalSurface}>
            <Text style={[styles.pickerTitle, { marginBottom: 16 }]}>{editModalLesson?.childName} の習い事を編集</Text>

            <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#555', marginBottom: 6 }}>習い事名</Text>
            <TextInput
              style={[styles.input, { marginBottom: 14 }]}
              value={editModalName}
              onChangeText={setEditModalName}
              placeholder="習い事名"
              placeholderTextColor="#BBBBBB"
            />

            <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#555', marginBottom: 6 }}>曜日</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {['月', '火', '水', '木', '金'].map(day => (
                <TouchableOpacity
                  key={day}
                  style={[styles.dayBtn, editModalDay === day && styles.dayBtnActive]}
                  onPress={() => setEditModalDay(day)}
                >
                  <Text style={[styles.dayBtnText, editModalDay === day && styles.dayBtnTextActive]}>{day}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#555', marginBottom: 6 }}>開始時間</Text>
            <TouchableOpacity style={[styles.timeSelectBtn, { marginBottom: 14 }]} onPress={() => {
              openEditTimePicker();
            }}>
              <Ionicons name="time-outline" size={20} color={COLORS.primary} />
              <Text style={[styles.timeSelectText, { fontSize: 22 }]}>{editModalTime}</Text>
              <Text style={styles.timeSelectHint}>タップして変更</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.paidToggle, editModalIsPaid && styles.paidToggleActive, { marginBottom: 20 }]}
              onPress={() => setEditModalIsPaid(!editModalIsPaid)}
            >
              <Ionicons name={editModalIsPaid ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={editModalIsPaid ? '#fff' : COLORS.textLight} />
              <Text style={[styles.paidToggleText, editModalIsPaid && { color: '#fff' }]}>有料送迎（500円/回）</Text>
            </TouchableOpacity>

            <View style={styles.pickerFooter}>
              <TouchableOpacity style={styles.pickerCancelBtn} onPress={() => setEditModalVisible(false)}>
                <Text style={styles.pickerCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pickerConfirmBtn} onPress={handleUpdate}>
                <Text style={styles.pickerConfirmText}>更新する</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <CenteredTimePickerModal
        visible={editModalTimePickerVisible}
        value={editModalTime}
        title="開始時間を選択"
        hours={HOURS}
        minutes={MINUTES}
        onClose={() => { setEditModalTimePickerVisible(false); setEditModalVisible(true); }}
        onConfirm={value => {
          setEditModalTime(value);
          setEditModalTimePickerVisible(false);
          setEditModalVisible(true);
        }}
      />

      {/* 外部児童の表示期間 */}
      <Modal visible={datePickerVisible} transparent animationType="fade" onRequestClose={() => { setDatePickerVisible(false); setViewMode('edit'); }}>
        <View style={[styles.pickerOverlay, { justifyContent: 'center', padding: 18 }]}> 
          <View style={styles.calendarModal}>
            <View style={styles.calendarModalHeader}>
              <View>
                <Text style={styles.calendarModalTitle}>表示期間を選択</Text>
                <Text style={styles.calendarModalTarget}>{datePickerTarget === 'start' ? '開始日' : '終了日'}</Text>
              </View>
              <TouchableOpacity style={styles.calendarCloseBtn} onPress={() => { setDatePickerVisible(false); setViewMode('edit'); }}>
                <Ionicons name="close" size={26} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.calendarMonthRow}>
              <TouchableOpacity style={styles.calendarArrow} onPress={() => setDatePickerMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
                <Ionicons name="chevron-back" size={22} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.calendarMonthText}>{datePickerMonth.getFullYear()}年 {datePickerMonth.getMonth() + 1}月</Text>
              <TouchableOpacity style={styles.calendarArrow} onPress={() => setDatePickerMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
                <Ionicons name="chevron-forward" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.calendarWeekRow}>
              {['日','月','火','水','木','金','土'].map((day, index) => (
                <Text key={day} style={[styles.calendarWeekText, index === 0 && { color:'#E74C3C' }, index === 6 && { color:'#2F80ED' }]}>{day}</Text>
              ))}
            </View>
            <View style={styles.calendarGrid}>
              {calendarCells.map((cell, index) => {
                if (!cell) return <View key={`empty-${index}`} style={styles.calendarDay} />;
                const selected = cell.key === (datePickerTarget === 'start' ? externalStartDate : externalEndDate);
                const inRange = cell.key >= externalStartDate && cell.key <= externalEndDate;
                return (
                  <TouchableOpacity key={cell.key} style={[styles.calendarDay, inRange && styles.calendarDayInRange, selected && styles.calendarDaySelected]} onPress={() => selectExternalDate(cell.key)}>
                    <Text style={[styles.calendarDayText, selected && styles.calendarDayTextSelected]}>{cell.day}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      <CenteredTimePickerModal
        visible={timePickerVisible}
        value={selectedTime}
        title="開始時間を選択"
        hours={HOURS}
        minutes={MINUTES}
        onClose={() => { setTimePickerVisible(false); setViewMode('edit'); }}
        onConfirm={value => {
          setSelectedTime(value);
          setTimePickerVisible(false);
          setViewMode('edit');
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFF8F0', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  tabSection: { flexDirection: 'row', backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderColor: 'transparent' },
  tabBtnActive: { borderColor: COLORS.primary },
  tabText: { fontSize: 13, fontWeight: 'bold', color: COLORS.textLight },
  tabTextActive: { fontSize: 13, fontWeight: 'bold', color: COLORS.primary },
  mainScroll: { flex: 1 },
  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: COLORS.textLight, fontSize: 14, marginTop: 16 },
  subGroupCard: { backgroundColor: '#F8F8F8', borderRadius: 12, marginBottom: 6, overflow: 'hidden' },
  subGroupHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  listContent: { padding: 16, paddingBottom: 112 },
  filterHeading: { fontSize: 14, fontWeight: 'bold', color: COLORS.primary, marginTop: 18, marginBottom: 9 },
  weekdayFilterRow: { flexDirection: 'row', borderWidth: 1, borderColor: COLORS.primary, borderRadius: 11, overflow: 'hidden' },
  weekdayFilterButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: COLORS.primary + '55' },
  weekdayFilterButtonActive: { backgroundColor: COLORS.primary },
  weekdayFilterText: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  weekdayFilterTextActive: { color: COLORS.white },
  lessonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  groupCard: { backgroundColor: COLORS.white, borderRadius: 12, borderLeftWidth: 6, marginTop: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2 },
  groupCardCompact: { width: '48.5%' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  groupName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  paidBadge: { backgroundColor: '#FF7043', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  paidBadgeText: { fontSize: 10, color: '#fff', fontWeight: 'bold' },
  groupAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, padding: 6, backgroundColor: '#EEF5FF', borderRadius: 10 },
  groupAddText: { fontSize: 11, fontWeight: 'bold', color: COLORS.primary },
  groupChildList: { borderTopWidth: 1, borderColor: COLORS.border, padding: 10, gap: 6 },
  childGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  groupChildRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#FAFAFA', borderRadius: 12, width: '48%' },
  groupChildName: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  groupChildSchool: { fontSize: 11, color: COLORS.textLight, marginTop: 1 },
  groupChildDeleteBtn: { padding: 4 },
  lessonCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 },
  lessonCardLeft: { flex: 1 },
  lessonCardName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, marginBottom: 2 },
  lessonCardSchool: { fontSize: 11, color: COLORS.textLight, marginBottom: 8 },
  lessonBadgeRow: { flexDirection: 'row', gap: 8 },
  paidToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, marginTop: 10 },
  paidToggleActive: { backgroundColor: '#FF7043', borderColor: '#FF7043' },
  paidToggleText: { fontSize: 14, fontWeight: 'bold', color: COLORS.textLight },
  lessonBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary + '15', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, gap: 4 },
  lessonBadgeText: { fontSize: 12, fontWeight: '600', color: COLORS.primary },
  deleteBtn: { padding: 10 },
  stepCard: { backgroundColor: COLORS.white, borderRadius: 12, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  stepNumText: { color: COLORS.white, fontWeight: 'bold', fontSize: 13 },
  stepTitle: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, flex: 1 },
  sourceTabs: { flexDirection: 'row', backgroundColor: '#F1F4F5', borderRadius: 12, padding: 4, marginBottom: 14 },
  sourceTab: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  sourceTabActive: { backgroundColor: COLORS.white, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  sourceTabText: { fontSize: 14, fontWeight: 'bold', color: COLORS.textLight },
  sourceTabTextActive: { color: COLORS.primary },
  externalForm: { backgroundColor: '#FFF9F2', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#FFD6A5' },
  fieldLabel: { fontSize: 13, fontWeight: 'bold', color: COLORS.text, marginBottom: 6 },
  dateRangeRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dateField: { flex: 1, minHeight: 64, borderRadius: 10, borderWidth: 1, borderColor: COLORS.primary + '55', backgroundColor: '#F4FBFC', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  dateFieldCaption: { fontSize: 11, fontWeight: 'bold', color: COLORS.textLight, marginBottom: 4 },
  dateFieldValue: { fontSize: 13, fontWeight: 'bold', color: COLORS.text, textAlign: 'center' },
  dateRangeSeparator: { fontSize: 18, color: COLORS.textLight },
  externalHint: { fontSize: 11, color: COLORS.textLight, marginTop: 10, lineHeight: 17 },
  selectedCountBadge: { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  selectedCountText: { color: COLORS.white, fontSize: 11, fontWeight: 'bold' },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: '#FAFAFA' },
  timeSelectBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F8FF', borderRadius: 10, padding: 16, borderWidth: 1, borderColor: COLORS.primary + '50', gap: 12 },
  timeSelectText: { fontSize: 28, fontWeight: 'bold', color: COLORS.primary, flex: 1 },
  timeSelectHint: { fontSize: 12, color: COLORS.textLight },
  dayTabScroll: { backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border, maxHeight: 56, flexShrink: 0 },
  dayTabContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  dayTab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F0F0F0', borderWidth: 1.5, borderColor: 'transparent', gap: 6 },
  dayTabActive: { backgroundColor: COLORS.primary + '15', borderColor: COLORS.primary },
  dayTabText: { fontSize: 13, fontWeight: 'bold', color: COLORS.textLight },
  dayTabTextActive: { color: COLORS.primary },
  dayTabBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.textLight + '40', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  dayTabBadgeActive: { backgroundColor: COLORS.primary },
  dayTabBadgeText: { fontSize: 11, fontWeight: 'bold', color: COLORS.textLight },
  dayTabBadgeTextActive: { color: COLORS.white },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.text },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#F5F5F5' },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: { fontSize: 12, fontWeight: 'bold', color: COLORS.textLight },
  filterChipTextActive: { color: COLORS.white },
  selectedTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  selectedTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  selectedTagText: { color: COLORS.white, fontSize: 12, fontWeight: '600' },
  kidsListContainer: { gap: 6 },
  noResultText: { textAlign: 'center', color: COLORS.textLight, paddingVertical: 20, fontSize: 13 },
  kidListItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#FAFAFA' },
  kidListItemActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '08' },
  kidListIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EBEBEB', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  kidListIconActive: { backgroundColor: COLORS.primary },
  kidListInfo: { flex: 1 },
  kidListName: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  kidListNameActive: { color: COLORS.primary },
  kidListSub: { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  dayBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#FAFAFA' },
  dayBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dayBtnText: { fontSize: 16, fontWeight: 'bold', color: COLORS.textLight },
  dayBtnTextActive: { color: COLORS.white },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 16, gap: 8, marginTop: 8 },
  submitBtnDisabled: { backgroundColor: COLORS.textLight },
  submitBtnText: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },
  floatingAddButton: { position: 'absolute', right: 22, bottom: 26, width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 8, elevation: 7 },
  formModalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16, backgroundColor: 'rgba(17, 24, 39, 0.45)' },
  modalBackdropClose: { ...StyleSheet.absoluteFillObject },
  formModalSurface: { width: '100%', maxWidth: 660, maxHeight: '90%', backgroundColor: COLORS.white, borderRadius: 18, overflow: 'hidden', zIndex: 1 },
  formModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderColor: COLORS.border },
  formModalTitle: { fontSize: 19, fontWeight: 'bold', color: COLORS.text },
  formModalClose: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F6F7' },
  formModalScrollContent: { padding: 16, paddingBottom: 28 },
  memberModalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16, backgroundColor: 'rgba(17, 24, 39, 0.45)' },
  memberModalSurface: { width: '100%', maxWidth: 680, maxHeight: '80%', backgroundColor: COLORS.white, borderRadius: 18, overflow: 'hidden', zIndex: 1 },
  memberModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderColor: COLORS.border },
  memberModalTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  memberModalSubtitle: { fontSize: 13, fontWeight: 'bold', color: COLORS.primary, marginTop: 2 },
  memberDayFilterRow: { flexDirection: 'row', marginHorizontal: 16, marginTop: 14, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 10, overflow: 'hidden' },
  memberDayFilterButton: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: COLORS.primary + '55' },
  memberDayFilterButtonActive: { backgroundColor: COLORS.primary },
  memberDayFilterText: { fontSize: 13, fontWeight: 'bold', color: COLORS.text },
  memberDayFilterTextActive: { color: COLORS.white },
  memberModalList: { padding: 16, paddingBottom: 24 },
  memberDayHeading: { fontSize: 14, fontWeight: 'bold', color: '#7B1FA2', marginTop: 8, marginBottom: 7 },
  memberTimeHeading: { fontSize: 13, fontWeight: 'bold', color: COLORS.primary, marginTop: 4, marginBottom: 6 },
  memberListRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6, borderRadius: 10, backgroundColor: '#FAFAFA', borderWidth: 1, borderColor: '#EEF0F2', marginBottom: 7 },
  memberListMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 6 },
  memberListIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary + '14' },
  memberPaidText: { fontSize: 10, fontWeight: 'bold', color: '#FF7043' },
  editModalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16, backgroundColor: 'rgba(17, 24, 39, 0.45)' },
  editModalSurface: { width: '100%', maxWidth: 620, backgroundColor: COLORS.white, borderRadius: 18, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 20, elevation: 8, zIndex: 1 },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(17, 24, 39, 0.45)', justifyContent: 'flex-end' },
  pickerContent: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, height: 480 },
  pickerTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 20, color: COLORS.text },
  pickerColumns: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', height: 150 },
  pickerScroll: { width: 80, height: '100%' },
  pickerColon: { fontSize: 24, fontWeight: 'bold', color: COLORS.textLight, marginHorizontal: 16 },
  pickerItem: { paddingVertical: 12, alignItems: 'center', borderRadius: 12 },
  pickerItemActive: { backgroundColor: COLORS.primary + '20' },
  pickerItemText: { fontSize: 20, color: COLORS.textLight, fontWeight: '500' },
  pickerItemTextActive: { color: COLORS.primary, fontWeight: 'bold', fontSize: 24 },
  pickerFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20, gap: 16 },
  pickerCancelBtn: { flex: 1, paddingVertical: 16, backgroundColor: COLORS.surface, borderRadius: 12, alignItems: 'center' },
  pickerCancelText: { fontSize: 16, fontWeight: 'bold', color: COLORS.textLight },
  pickerConfirmBtn: { flex: 1, paddingVertical: 16, backgroundColor: COLORS.primary, borderRadius: 12, alignItems: 'center' },
  pickerConfirmText: { fontSize: 16, fontWeight: 'bold', color: COLORS.white },
  calendarModal: { width: '100%', maxWidth: 460, alignSelf: 'center', backgroundColor: COLORS.white, borderRadius: 18, padding: 18 },
  calendarModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  calendarModalTitle: { fontSize: 19, fontWeight: 'bold', color: COLORS.text },
  calendarModalTarget: { fontSize: 13, fontWeight: 'bold', color: COLORS.primary, marginTop: 3 },
  calendarCloseBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F5F5' },
  calendarMonthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  calendarArrow: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  calendarMonthText: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  calendarWeekRow: { flexDirection: 'row' },
  calendarWeekText: { width: '14.285%', textAlign: 'center', fontSize: 12, fontWeight: 'bold', color: COLORS.textLight, paddingVertical: 8 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarDay: { width: '14.285%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  calendarDayInRange: { backgroundColor: '#E8F8FA' },
  calendarDaySelected: { backgroundColor: COLORS.primary, borderRadius: 999 },
  calendarDayText: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  calendarDayTextSelected: { color: COLORS.white, fontWeight: 'bold' },
});
