import { Ionicons } from '@expo/vector-icons';
import { useRequireRole } from '../hooks/useRequireRole';
import { useRouter } from 'expo-router';
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Modal, Platform, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
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
}

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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedDayOfWeek, setSelectedDayOfWeek] = useState('月');
  const [selectedTime, setSelectedTime] = useState('15:00');
  const [selectedKidIds, setSelectedKidIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSchool, setFilterSchool] = useState('');
  const [filterGrade, setFilterGrade] = useState('');

  const [viewMode, setViewMode] = useState<'list' | 'edit'>('list');
  const [activeDayTab, setActiveDayTab] = useState('全て');

  // 編集モーダル用
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editModalLesson, setEditModalLesson] = useState<Lesson | null>(null);
  const [editModalName, setEditModalName] = useState('');
  const [editModalDay, setEditModalDay] = useState('月');
  const [editModalTime, setEditModalTime] = useState('15:00');
  const [editModalIsPaid, setEditModalIsPaid] = useState(false);
  const [editModalTimePickerVisible, setEditModalTimePickerVisible] = useState(false);
  const [editTempHour, setEditTempHour] = useState(15);
  const [editTempMinute, setEditTempMinute] = useState(0);

  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [tempHour, setTempHour] = useState(15);
  const [tempMinute, setTempMinute] = useState(0);

  // ピッカーScrollViewのref（選択値を中央にスクロールするため）
  const ITEM_HEIGHT = 44;
  const editHourScrollRef = React.useRef<any>(null);
  const editMinScrollRef  = React.useRef<any>(null);
  const hourScrollRef     = React.useRef<any>(null);
  const minScrollRef      = React.useRef<any>(null);

  // 編集モーダルピッカーが開いたら選択値を中央に
  React.useEffect(() => {
    if (!editModalTimePickerVisible) return;
    const timer = setTimeout(() => {
      const hi = HOURS.indexOf(editTempHour);
      const mi = MINUTES.indexOf(editTempMinute);
      if (hi >= 0) editHourScrollRef.current?.scrollTo({ y: 53 + hi * ITEM_HEIGHT, animated: false });
      if (mi >= 0) editMinScrollRef.current?.scrollTo({ y: 53 + mi * ITEM_HEIGHT, animated: false });
    }, 50);
    return () => clearTimeout(timer);
  }, [editModalTimePickerVisible]);

  // 新規追加ピッカーが開いたら選択値を中央に
  React.useEffect(() => {
    if (!timePickerVisible) return;
    const timer = setTimeout(() => {
      const hi = HOURS.indexOf(tempHour);
      const mi = MINUTES.indexOf(tempMinute);
      if (hi >= 0) hourScrollRef.current?.scrollTo({ y: 53 + hi * ITEM_HEIGHT, animated: false });
      if (mi >= 0) minScrollRef.current?.scrollTo({ y: 53 + mi * ITEM_HEIGHT, animated: false });
    }, 50);
    return () => clearTimeout(timer);
  }, [timePickerVisible]);

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

  // 一覧はデフォルト閉じた状態
  // （expandedGroupsの初期値が空のSetのため何もしない）

  // lessonsロード後、習い事名グループ（nameKey）のみを展開。
  // 時間サブグループ（subKey）は閉じたまま → 画像の状態がデフォルト
  useEffect(() => {
    if (lessons.length === 0) return;
    const keys = new Set<string>();
    lessons.forEach(l => {
      keys.add(`name_${l.lessonName}`);
    });
    setExpandedGroups(keys);
  }, [lessons]);

  const allSchools = useMemo(() => [...new Set(kids.map(k => k.school).filter(Boolean))].sort(), [kids]);
  const allGrades = useMemo(() => {
    const g = [...new Set(kids.map(k => k.grade).filter(Boolean))];
    return g.sort((a, b) => {
      const na = parseInt(a.match(/\d/)?.[0] || '99');
      const nb = parseInt(b.match(/\d/)?.[0] || '99');
      return na - nb;
    });
  }, [kids]);

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
    const [h, m] = selectedTime.split(':').map(Number);
    setTempHour(isNaN(h) ? 15 : h);
    setTempMinute(isNaN(m) ? 0 : m);
    setTimePickerVisible(true);
  };

  const confirmTime = () => {
    setSelectedTime(`${String(tempHour).padStart(2, '0')}:${String(tempMinute).padStart(2, '0')}`);
    setTimePickerVisible(false);
  };

  const toggleKid = (kidId: string) => {
    setSelectedKidIds(prev =>
      prev.includes(kidId) ? prev.filter(id => id !== kidId) : [...prev, kidId]
    );
  };

  const handleRegister = async () => {
    if (!lessonName.trim()) { customAlert('エラー', '習い事の名前を入力してください'); return; }
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
    const [h, m] = lesson.lessonTime.split(':').map(Number);
    setEditTempHour(isNaN(h) ? 15 : h);
    setEditTempMinute(isNaN(m) ? 0 : m);
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
    setTempHour(15);
    setTempMinute(0);
    setSelectedKidIds([]);
    setSearchQuery('');
    setFilterSchool('');
    setFilterGrade('');
  };

  if (checking || !verified) return null;
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigateHome(router)}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>習い事一覧管理</Text>
      </View>

      <View style={styles.tabSection}>
        <TouchableOpacity style={[styles.tabBtn, viewMode === 'list' && styles.tabBtnActive]} onPress={() => setViewMode('list')}>
          <Text style={[styles.tabText, viewMode === 'list' && styles.tabTextActive]}>一覧</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, viewMode === 'edit' && styles.tabBtnActive]} onPress={() => { resetForm(); setViewMode('edit'); }}>
          <Text style={[styles.tabText, viewMode === 'edit' && styles.tabTextActive]}>新規追加</Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'list' ? (
        <>
          {/* 曜日タブ */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayTabScroll} contentContainerStyle={styles.dayTabContent}>
            {(['全て', '月', '火', '水', '木', '金'] as const).map((day) => {
              const count = day === '全て' ? lessons.length : lessons.filter(l => l.dayOfWeek === day).length;
              return (
                <TouchableOpacity
                  key={day}
                  style={[styles.dayTab, activeDayTab === day && styles.dayTabActive]}
                  onPress={() => setActiveDayTab(day)}
                >
                  <Text style={[styles.dayTabText, activeDayTab === day && styles.dayTabTextActive]}>
                    {day === '全て' ? '全て' : `${day}曜`}
                  </Text>
                  {count > 0 && (
                    <View style={[styles.dayTabBadge, activeDayTab === day && styles.dayTabBadgeActive]}>
                      <Text style={[styles.dayTabBadgeText, activeDayTab === day && styles.dayTabBadgeTextActive]}>{count}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <ScrollView style={styles.mainScroll} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            {(() => {
              const filtered = activeDayTab === '全て'
                ? lessons
                : lessons.filter(l => l.dayOfWeek === (activeDayTab as string));
              if (filtered.length === 0) return (
                <View style={styles.emptyBox}>
                  <Ionicons name="book-outline" size={48} color={COLORS.textLight} />
                  <Text style={styles.emptyText}>
                    {activeDayTab === '全て' ? '登録されている習い事はありません' : `${activeDayTab}曜日の習い事はありません`}
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

              return nameEntries.map(([lessonName, nameGroup]) => {
                const nameKey = `name_${lessonName}`;
                const isNameOpen = expandedGroups.has(nameKey);
                const isPaid = nameGroup.some(l => l.isPaid);
                const totalCount = nameGroup.length;

                // 時間でサブグループ化
                const timeGroups = new Map<string, typeof filtered>();
                nameGroup.forEach(l => {
                  const tkey = `${l.lessonTime}||${l.dayOfWeek||''}`;
                  if (!timeGroups.has(tkey)) timeGroups.set(tkey, []);
                  timeGroups.get(tkey)!.push(l);
                });
                const timeEntries = [...timeGroups.entries()].sort(([a],[b]) => a.localeCompare(b));

                return (
                  <View key={nameKey} style={[styles.groupCard, { backgroundColor: getLessonColor(lessonName) }]}>
                    {/* 習い事名ヘッダー */}
                    <TouchableOpacity
                      style={styles.groupHeader}
                      onPress={() => {
                        const next = new Set(expandedGroups);
                        isNameOpen ? next.delete(nameKey) : next.add(nameKey);
                        setExpandedGroups(next);
                      }}
                      activeOpacity={0.75}
                    >
                      <View style={{ flex:1 }}>
                        <View style={{ flexDirection:'row', alignItems:'center', gap:6, marginBottom:4 }}>
                          <Text style={styles.groupName}>{lessonName}</Text>
                          {isPaid && <View style={styles.paidBadge}><Text style={styles.paidBadgeText}>有料</Text></View>}
                        </View>
                        <View style={{ flexDirection:'row', gap:6 }}>
                          <View style={[styles.lessonBadge, { backgroundColor: '#E8F5E9' }]}>
                            <Text style={[styles.lessonBadgeText, { color:'#388E3C' }]}>計{totalCount}名</Text>
                          </View>
                          <View style={styles.lessonBadge}>
                            <Text style={styles.lessonBadgeText}>{timeGroups.size}クラス</Text>
                          </View>
                        </View>
                      </View>
                      <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                        <TouchableOpacity
                          style={styles.groupAddBtn}
                          onPress={() => {
                            setLessonName(lessonName);
                            setIsPaid(!!isPaid);
                            setViewMode('edit');
                          }}
                        >
                          <Ionicons name="person-add-outline" size={16} color={COLORS.primary} />
                        </TouchableOpacity>
                        <Ionicons name={isNameOpen ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textLight} />
                      </View>
                    </TouchableOpacity>

                    {/* 時間別サブグループ（展開時） */}
                    {isNameOpen && (
                      <View style={{ paddingHorizontal:8, paddingBottom:8 }}>
                        {timeEntries.map(([tkey, timeGroup]) => {
                          const [lessonTime, dayOfWeek] = tkey.split('||');
                          const subKey = `${nameKey}_${tkey}`;
                          const isSubOpen = expandedGroups.has(subKey);
                          return (
                            <View key={subKey} style={styles.subGroupCard}>
                              {/* 時間ヘッダー */}
                              <TouchableOpacity
                                style={styles.subGroupHeader}
                                onPress={() => {
                                  const next = new Set(expandedGroups);
                                  isSubOpen ? next.delete(subKey) : next.add(subKey);
                                  setExpandedGroups(next);
                                }}
                                activeOpacity={0.75}
                              >
                                <View style={{ flexDirection:'row', alignItems:'center', gap:6, flex:1 }}>
                                  {dayOfWeek && (
                                    <View style={[styles.lessonBadge, { backgroundColor:'#EDE7F6' }]}>
                                      <Text style={[styles.lessonBadgeText, { color:'#7B1FA2' }]}>{dayOfWeek}曜</Text>
                                    </View>
                                  )}
                                  <View style={styles.lessonBadge}>
                                    <Ionicons name="time-outline" size={11} color={COLORS.primary} />
                                    <Text style={styles.lessonBadgeText}>{lessonTime}</Text>
                                  </View>
                                  <Text style={{ fontSize:12, color:COLORS.textLight }}>{timeGroup.length}名</Text>
                                </View>
                                <TouchableOpacity
                                  style={styles.groupAddBtn}
                                  onPress={() => {
                                    setLessonName(lessonName);
                                    setSelectedTime(lessonTime);
                                    setSelectedDayOfWeek(dayOfWeek || '月');
                                    setIsPaid(!!isPaid);
                                    setViewMode('edit');
                                  }}
                                >
                                  <Ionicons name="person-add-outline" size={15} color={COLORS.primary} />
                                </TouchableOpacity>
                                <Ionicons name={isSubOpen ? 'chevron-up' : 'chevron-down'} size={15} color={COLORS.textLight} style={{ marginLeft:4 }} />
                              </TouchableOpacity>

                              {/* 利用者カード（2列グリッド） */}
                              {isSubOpen && (
                                <View style={styles.groupChildList}>
                                  <View style={styles.childGrid}>
                                  {timeGroup.map(lesson => (
                                    <View key={lesson.id} style={styles.groupChildRow}>
                                      <View style={{ flex:1 }}>
                                        <Text style={styles.groupChildName}>{lesson.childName || (() => { const k = kids.find(k => k.id === lesson.childId); return k ? `${k.name}${k.isStaffChild ? ` [${k.parentName}]` : ''}` : '(名前不明)'; })()}</Text>
                                        <View style={{ flexDirection:'row', gap:4, marginTop:2 }}>
                                          {lesson.dayOfWeek && (
                                            <View style={[styles.lessonBadge, { backgroundColor:'#EDE7F6', paddingHorizontal:5, paddingVertical:1 }]}>
                                              <Text style={[styles.lessonBadgeText, { color:'#7B1FA2', fontSize:9 }]}>{lesson.dayOfWeek}曜</Text>
                                            </View>
                                          )}
                                          {lesson.isPaid && (
                                            <View style={[styles.lessonBadge, { backgroundColor:'#FBE9E7', paddingHorizontal:5, paddingVertical:1 }]}>
                                              <Text style={[styles.lessonBadgeText, { color:'#FF7043', fontSize:9 }]}>有料</Text>
                                            </View>
                                          )}
                                        </View>
                                      </View>
                                      <TouchableOpacity
                                        style={[styles.groupAddBtn, { marginRight:4 }]}
                                        onPress={() => openEditModal(lesson)}
                                      >
                                        <Ionicons name="pencil-outline" size={15} color={COLORS.primary} />
                                      </TouchableOpacity>
                                      <TouchableOpacity
                                        style={styles.groupChildDeleteBtn}
                                        onPress={() => handleDelete(lesson.id || '')}
                                      >
                                        <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                                      </TouchableOpacity>
                                    </View>
                                  ))}
                                  </View>
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              });
            })()}
          </ScrollView>
        </>
      ) : (
        <ScrollView style={styles.mainScroll} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>

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
              <Text style={styles.stepTitle}>児童を選択（複数可）</Text>
              {selectedKidIds.length > 0 && (
                <View style={styles.selectedCountBadge}>
                  <Text style={styles.selectedCountText}>{selectedKidIds.length}名</Text>
                </View>
              )}
            </View>

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
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, (!lessonName || selectedKidIds.length === 0) && styles.submitBtnDisabled]}
            onPress={handleRegister}
            disabled={!lessonName || selectedKidIds.length === 0}
          >
            <Ionicons name="checkmark-circle" size={22} color={COLORS.white} />
            <Text style={styles.submitBtnText}>
              {selectedKidIds.length > 0 ? `${selectedKidIds.length}名に登録する` : '登録する'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── 個別編集モーダル ── */}
      <Modal visible={editModalVisible} transparent animationType="slide">
        <View style={styles.pickerOverlay}>
          <View style={[styles.pickerContent, { padding: 24 }]}>
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
              setEditTempHour(parseInt(editModalTime.split(':')[0]));
              setEditTempMinute(parseInt(editModalTime.split(':')[1]));
              setEditModalTimePickerVisible(true);
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

      {/* 編集モーダル内の時間ピッカー */}
      <Modal visible={editModalTimePickerVisible} transparent animationType="slide">
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>時間を選択</Text>
            <View style={styles.pickerColumns}>
              <ScrollView ref={editHourScrollRef} style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                <View style={{ height: 53 }} />
                {HOURS.map(h => (
                  <TouchableOpacity key={`eh-${h}`} style={[styles.pickerItem, editTempHour === h && styles.pickerItemActive]} onPress={() => setEditTempHour(h)}>
                    <Text style={[styles.pickerItemText, editTempHour === h && styles.pickerItemTextActive]}>{h}</Text>
                  </TouchableOpacity>
                ))}
                <View style={{ height: 53 }} />
              </ScrollView>
              <Text style={styles.pickerColon}>:</Text>
              <ScrollView ref={editMinScrollRef} style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                <View style={{ height: 53 }} />
                {MINUTES.map(m => (
                  <TouchableOpacity key={`em-${m}`} style={[styles.pickerItem, editTempMinute === m && styles.pickerItemActive]} onPress={() => setEditTempMinute(m)}>
                    <Text style={[styles.pickerItemText, editTempMinute === m && styles.pickerItemTextActive]}>{String(m).padStart(2, '0')}</Text>
                  </TouchableOpacity>
                ))}
                <View style={{ height: 53 }} />
              </ScrollView>
            </View>
            <View style={styles.pickerFooter}>
              <TouchableOpacity style={styles.pickerCancelBtn} onPress={() => setEditModalTimePickerVisible(false)}>
                <Text style={styles.pickerCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pickerConfirmBtn} onPress={() => {
                setEditModalTime(`${String(editTempHour).padStart(2,'0')}:${String(editTempMinute).padStart(2,'0')}`);
                setEditModalTimePickerVisible(false);
              }}>
                <Text style={styles.pickerConfirmText}>決定</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ④ 新規追加用 時刻ピッカー */}
      <Modal visible={timePickerVisible} transparent animationType="slide">
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>開始時間を選択</Text>
            <View style={styles.pickerColumns}>
              <ScrollView ref={hourScrollRef} style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                <View style={{ height: 53 }} />
                {HOURS.map(h => (
                  <TouchableOpacity key={`h-${h}`} style={[styles.pickerItem, tempHour === h && styles.pickerItemActive]} onPress={() => setTempHour(h)}>
                    <Text style={[styles.pickerItemText, tempHour === h && styles.pickerItemTextActive]}>{h}</Text>
                  </TouchableOpacity>
                ))}
                <View style={{ height: 53 }} />
              </ScrollView>
              <Text style={styles.pickerColon}>:</Text>
              <ScrollView ref={minScrollRef} style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                <View style={{ height: 53 }} />
                {MINUTES.map(m => (
                  <TouchableOpacity key={`m-${m}`} style={[styles.pickerItem, tempMinute === m && styles.pickerItemActive]} onPress={() => setTempMinute(m)}>
                    <Text style={[styles.pickerItemText, tempMinute === m && styles.pickerItemTextActive]}>{String(m).padStart(2, '0')}</Text>
                  </TouchableOpacity>
                ))}
                <View style={{ height: 53 }} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 12 },
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
  groupCard: { backgroundColor: COLORS.white, borderRadius: 16, marginBottom: 10, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  groupName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  paidBadge: { backgroundColor: '#FF7043', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  paidBadgeText: { fontSize: 10, color: '#fff', fontWeight: 'bold' },
  groupAddBtn: { padding: 6, backgroundColor: '#EEF5FF', borderRadius: 10 },
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
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
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
});