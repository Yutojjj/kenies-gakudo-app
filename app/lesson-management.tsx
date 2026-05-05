import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { addDoc, collection, deleteDoc, doc, getDocs } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert, Modal, Platform, SafeAreaView, ScrollView,
    StyleSheet, Text, TextInput, TouchableOpacity, View
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

interface Lesson {
  id?: string;
  childId: string;
  childName: string;
  school: string;
  lessonName: string;
  lessonTime: string;
  dayOfWeek?: string;
}

const getGradeNum = (grade: string) => {
  const m = grade.match(/\d/);
  return m ? parseInt(m[0], 10) : 99;
};

export default function LessonManagementScreen() {
  const router = useRouter();

  const [kids, setKids] = useState<Kid[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);

  const [lessonName, setLessonName] = useState('');
  const [selectedDayOfWeek, setSelectedDayOfWeek] = useState('月');
  const [selectedTime, setSelectedTime] = useState('15:00');
  const [selectedKidIds, setSelectedKidIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [viewMode, setViewMode] = useState<'list' | 'edit'>('list');

  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [tempHour, setTempHour] = useState(15);
  const [tempMinute, setTempMinute] = useState(0);

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
              allKids.push({
                id: child.id || `${parentId}_staffchild_${idx}`,
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
      setKids(allKids);

      const lessonsSnap = await getDocs(collection(db, 'lessons'));
      setLessons(lessonsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Lesson)));
    } catch (e) {
      console.error(e);
    }
  };

  const filteredKids = useMemo(() => {
    if (!searchQuery.trim()) return kids;
    const q = searchQuery.trim().toLowerCase();
    return kids.filter(k =>
      k.name.toLowerCase().includes(q) ||
      k.nicknameKana.toLowerCase().includes(q)
    );
  }, [kids, searchQuery]);

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

    try {
      for (const kidId of selectedKidIds) {
        const kid = kids.find(k => k.id === kidId);
        if (!kid) continue;
        await addDoc(collection(db, 'lessons'), {
          childId: kid.id, childName: kid.name, school: kid.school,
          lessonName: lessonName.trim(), lessonTime: selectedTime,
          dayOfWeek: selectedDayOfWeek,
        });
      }
      customAlert('成功', `${selectedKidIds.length}名に習い事を登録しました`);
      resetForm();
      fetchData();
      setViewMode('list');
    } catch (e) {
      customAlert('エラー', '登録に失敗しました');
    }
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
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
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
        <ScrollView style={styles.mainScroll} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {lessons.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="book-outline" size={48} color={COLORS.textLight} />
              <Text style={styles.emptyText}>登録されている習い事はありません</Text>
            </View>
          ) : (
            lessons.map(lesson => (
              <View key={lesson.id} style={styles.lessonCard}>
                <View style={styles.lessonCardLeft}>
                  <Text style={styles.lessonCardName}>{lesson.childName}</Text>
                  <Text style={styles.lessonCardSchool}>{lesson.school}</Text>
                  <View style={styles.lessonBadgeRow}>
                    <View style={styles.lessonBadge}>
                      <Ionicons name="book-outline" size={12} color={COLORS.primary} />
                      <Text style={styles.lessonBadgeText}>{lesson.lessonName}</Text>
                    </View>
                    {lesson.dayOfWeek && (
                      <View style={styles.lessonBadge}>
                        <Ionicons name="calendar-outline" size={12} color={COLORS.primary} />
                        <Text style={styles.lessonBadgeText}>{lesson.dayOfWeek}曜日</Text>
                      </View>
                    )}
                    <View style={styles.lessonBadge}>
                      <Ionicons name="time-outline" size={12} color={COLORS.primary} />
                      <Text style={styles.lessonBadgeText}>{lesson.lessonTime}</Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(lesson.id || '')}>
                  <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
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
              value={lessonName}
              onChangeText={setLessonName}
            />
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

      {/* schedule.tsx と同じ時間ピッカーモーダル */}
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
  lessonCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 },
  lessonCardLeft: { flex: 1 },
  lessonCardName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, marginBottom: 2 },
  lessonCardSchool: { fontSize: 11, color: COLORS.textLight, marginBottom: 8 },
  lessonBadgeRow: { flexDirection: 'row', gap: 8 },
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
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.text },
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