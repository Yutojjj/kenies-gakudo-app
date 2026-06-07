// fixed: 2026-06-03 23:55:50 - picker modal separated
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

const DAYS = ['月', '火', '水', '木', '金'];

// 時間文字列ごとに一意の色を返す（同じ時間は常に同じ色）
const TIME_COLORS = [
  '#1565C0', // 濃紺
  '#C62828', // 深赤
  '#2E7D32', // 深緑
  '#6A1B9A', // 深紫
  '#E65100', // 深オレンジ
  '#00695C', // 深ティール
  '#4527A0', // インディゴ
  '#AD1457', // 深ピンク
];

function getTimeColor(time: string): string {
  if (!time) return '#1A237E';
  let hash = 0;
  for (let i = 0; i < time.length; i++) hash = time.charCodeAt(i) + ((hash << 5) - hash);
  return TIME_COLORS[Math.abs(hash) % TIME_COLORS.length];
}
const HOURS = Array.from({ length: 11 }, (_, i) => i + 10); // 10時〜20時
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0, 5, 10...55分

export default function SchoolTimesScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  
  const [masterSchools, setMasterSchools] = useState<string[]>([]);
  const [masterGrades, setMasterGrades] = useState<string[]>([]);
  const [masterTimes, setMasterTimes] = useState<string[]>([]);

  const [schoolTimes, setSchoolTimes] = useState<Record<string, any>>({});
  const [activeSchool, setActiveSchool] = useState<string>('');

  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState<'single' | 'stamping'>('single');
  const [activeCell, setActiveCell] = useState<{ grade: string, day: string } | null>(null);

  // 新規時刻追加専用モーダル（既存候補選択と完全分離）
  const [addTimeVisible, setAddTimeVisible] = useState(false);
  const [tempHour, setTempHour] = useState(15);
  const [tempMinute, setTempMinute] = useState(0);

  const ST_ITEM_HEIGHT = 44;
  const stHourScrollRef = React.useRef<any>(null);
  const stMinScrollRef  = React.useRef<any>(null);

  React.useEffect(() => {
    if (!pickerVisible) return;
    const timer = setTimeout(() => {
      const hi = HOURS.indexOf(tempHour);
      const mi = MINUTES.indexOf(tempMinute);
      if (hi >= 0) stHourScrollRef.current?.scrollTo({ y: 53 + hi * ST_ITEM_HEIGHT, animated: false });
      if (mi >= 0) stMinScrollRef.current?.scrollTo({ y: 53 + mi * ST_ITEM_HEIGHT, animated: false });
    }, 50);
    return () => clearTimeout(timer);
  }, [pickerVisible]);

  // 保存完了トースト
  const [saveToast, setSaveToast] = useState(false);
  const showSaveToast = () => {
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2000);
  };

  const [isStampingMode, setIsStampingMode] = useState(false);
  const [stampingTime, setStampingTime] = useState('');

  useEffect(() => {
    // ▼ 修正: getDoc → onSnapshot でリアルタイム取得（接続不安定でも確実に反映）▼
    const masterRef = doc(db, 'settings', 'master_data');
    const unsubMaster = onSnapshot(masterRef, async (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const schools = data.schools || [];
        setMasterSchools(schools);
        setMasterGrades(data.grades || []);
        setMasterTimes(data.times || ['14:30', '15:00', '15:30']);
        setActiveSchool(prev => prev || schools[0] || '');
      } else {
        // ドキュメントが存在しない場合はデフォルトを書き込み
        const defaultTimes = ['14:30', '15:00', '15:30'];
        setMasterTimes(defaultTimes);
        try {
          await setDoc(masterRef, { times: defaultTimes }, { merge: true });
        } catch (e) { console.warn('master_data 初期化失敗', e); }
      }
    }, (error) => console.warn('master_data リスナーエラー', error));

    const unsubTimes = onSnapshot(collection(db, 'school_times'), (snapshot) => {
      const data: Record<string, any> = {};
      snapshot.forEach(doc => {
        data[doc.id] = doc.data();
      });
      setSchoolTimes(data);
    }, (error) => console.warn('school_times リスナーエラー', error));

    return () => { unsubMaster(); unsubTimes(); };
  }, []);

  const handleTimeChange = (grade: string, day: string, value: string) => {
    if (!activeSchool) return;
    setSchoolTimes(prev => ({
      ...prev,
      [activeSchool]: {
        ...(prev[activeSchool] || {}),
        [grade]: {
          ...((prev[activeSchool] || {})[grade] || {}),
          [day]: value
        }
      }
    }));
  };

  const saveSchoolTimes = async () => {
    if (!activeSchool) return;
    try {
      await setDoc(doc(db, 'school_times', activeSchool), schoolTimes[activeSchool] || {}, { merge: true });
      showSaveToast();
    } catch (e) {
      Alert.alert('エラー', '保存に失敗しました。');
    }
  };

  const openTimePickerForSingle = (grade: string, day: string) => {
    setPickerMode('single');
    setActiveCell({ grade, day });
    setPickerVisible(true);
  };

  const openTimePickerForStamping = () => {
    setPickerMode('stamping');
    setPickerVisible(true);
  };

  const openAddTimePicker = () => {
    setAddTimeVisible(true);
  };

  const selectTime = (timeValue: string) => {
    if (pickerMode === 'stamping') {
      setStampingTime(timeValue);
      setIsStampingMode(true);
    } else {
      if (activeCell) {
        handleTimeChange(activeCell.grade, activeCell.day, timeValue);
      }
    }
    setPickerVisible(false);
  };

  const handleAddTime = async () => {
    const newTimeStr = `${String(tempHour).padStart(2, '0')}:${String(tempMinute).padStart(2, '0')}`;
    if (masterTimes.includes(newTimeStr)) {
      Alert.alert('エラー', 'すでに登録されています');
      return;
    }
    const newTimes = [...masterTimes, newTimeStr].sort();
    setMasterTimes(newTimes);
    await setDoc(doc(db, 'settings', 'master_data'), { times: newTimes }, { merge: true });
    setAddTimeVisible(false);
  };

  const handleDeleteTime = (timeValue: string) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`${timeValue} を候補から削除しますか？`)) {
          const newTimes = masterTimes.filter(t => t !== timeValue);
          setMasterTimes(newTimes);
          setDoc(doc(db, 'settings', 'master_data'), { times: newTimes }, { merge: true });
      }
      return;
    }
    Alert.alert('削除確認', `${timeValue} を候補から削除しますか？`, [
      { text: 'キャンセル' },
      { 
        text: '削除', 
        style: 'destructive', 
        onPress: async () => {
          const newTimes = masterTimes.filter(t => t !== timeValue);
          setMasterTimes(newTimes);
          await setDoc(doc(db, 'settings', 'master_data'), { times: newTimes }, { merge: true });
        }
      }
    ]);
  };


  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>学校別下校時刻設定</Text>
      </View>

      <View style={styles.schoolSelector}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          {masterSchools.map(s => (
            <TouchableOpacity key={s} style={[styles.schoolTab, activeSchool === s && styles.schoolTabActive]} onPress={() => setActiveSchool(s)}>
              <Text style={[styles.schoolTabText, activeSchool === s && styles.schoolTabTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
          {masterSchools.length === 0 && (
            <Text style={{ padding: 16, color: COLORS.textLight }}>※アカウント管理画面で学校の候補を追加してください</Text>
          )}
        </ScrollView>
      </View>

      {isStampingMode && (
        <View style={styles.stampingBanner}>
          <Text style={styles.stampingText}>
            一括入力中: {stampingTime === '' ? '「未設定(クリア)」' : `「${stampingTime}」`}
          </Text>
          <TouchableOpacity style={styles.stampingEndBtn} onPress={() => setIsStampingMode(false)}>
            <Text style={styles.stampingEndText}>連投終了</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.scrollArea}>
        {!activeSchool ? (
          <Text style={styles.noDataText}>設定できる学校がありません</Text>
        ) : (
          <View style={styles.tableContainer}>
            <View style={styles.tableRow}>
              <View style={styles.tableCellHeader}><Text style={styles.cellHeaderText}>学年 \ 曜日</Text></View>
              {DAYS.map(d => <View key={d} style={styles.tableCellHeader}><Text style={styles.cellHeaderText}>{d}</Text></View>)}
            </View>

            {masterGrades.map(grade => (
              <View key={grade} style={styles.tableRow}>
                <View style={styles.tableCellHeaderGrade}><Text style={styles.cellGradeText}>{grade}</Text></View>
                {DAYS.map(day => {
                  const val = schoolTimes[activeSchool]?.[grade]?.[day] || '';
                  return (
                    <View key={day} style={styles.tableCell}>
                      <TouchableOpacity 
                        style={[
                          styles.timeCellBtn, 
                          val ? [styles.timeCellBtnActive, { backgroundColor: getTimeColor(val) + '18', borderColor: getTimeColor(val) + '60' }] : null,
                          isStampingMode && styles.timeCellBtnStamping
                        ]} 
                        onPress={() => {
                          if (isStampingMode) {
                            if (val === stampingTime) {
                              handleTimeChange(grade, day, '');
                            } else {
                              handleTimeChange(grade, day, stampingTime);
                            }
                          } else {
                            openTimePickerForSingle(grade, day);
                          }
                        }}
                      >
                        <Text style={val ? [styles.timeText, { color: getTimeColor(val) }] : styles.timeTextEmpty}>
                          {val || '設定'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ))}
            
            <TouchableOpacity style={styles.saveBtn} onPress={saveSchoolTimes}>
              <Ionicons name="save-outline" size={20} color={COLORS.white} style={{ marginRight: 8 }} />
              <Text style={styles.saveBtnText}>{activeSchool}の設定を保存</Text>
            </TouchableOpacity>
            <View style={{ height: 80 }} />
          </View>
        )}
      </ScrollView>

      {!isStampingMode && activeSchool !== '' && (
        <TouchableOpacity style={styles.fab} onPress={openTimePickerForStamping}>
          <Ionicons name="pencil" size={18} color={COLORS.white} />
          <Text style={{ color: COLORS.white, fontWeight: 'bold', fontSize: 13, marginTop: 2 }}>一括入力</Text>
        </TouchableOpacity>
      )}

      {/* 保存完了トースト */}
      {saveToast && (
        <View style={styles.toast}>
          <Ionicons name="checkmark-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.toastText}>{activeSchool} の設定を保存しました</Text>
        </View>
      )}

      <Modal visible={pickerVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {pickerMode === 'stamping' ? '連投する時刻を選択' : '時刻を選択'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity
                  style={styles.addTimeTriggerBtn}
                  onPress={() => { setPickerVisible(false); setAddTimeVisible(true); }}
                >
                  <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
                  <Text style={styles.addTimeTriggerText}>候補を追加</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPickerVisible(false)}>
                  <Ionicons name="close" size={28} color={COLORS.textLight} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView style={styles.existingTimesList} showsVerticalScrollIndicator={false}>
              <TouchableOpacity style={styles.clearBtn} onPress={() => selectTime('')}>
                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                <Text style={styles.clearBtnText}>{pickerMode === 'stamping' ? '「未設定に戻す」を連投' : '未設定に戻す'}</Text>
              </TouchableOpacity>

              {masterTimes.map(timeVal => (
                <View key={timeVal} style={styles.optionRow}>
                  <TouchableOpacity style={styles.optionBtn} onPress={() => selectTime(timeVal)}>
                    <Text style={styles.optionText}>{timeVal}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDeleteTime(timeVal)} style={{ padding: 12 }}>
                    <Ionicons name="trash-outline" size={24} color={COLORS.danger} />
                  </TouchableOpacity>
                </View>
              ))}
              {masterTimes.length === 0 && (
                <Text style={{ textAlign: 'center', color: COLORS.textLight, marginVertical: 20 }}>候補がありません</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 新規時刻追加モーダル（完全独立） */}
      <Modal visible={addTimeVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: 360 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>新しい時刻を追加</Text>
              <TouchableOpacity onPress={() => setAddTimeVisible(false)}>
                <Ionicons name="close" size={28} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>

            <Text style={{ textAlign: 'center', fontSize: 28, fontWeight: 'bold', color: COLORS.primary, marginBottom: 16 }}>
              {String(tempHour).padStart(2, '0')}:{String(tempMinute).padStart(2, '0')}
            </Text>

            <View style={styles.addTimeContainer}>
              <View style={styles.pickerColumns}>
                <View style={styles.pickerColumnWrapper}>
                  <ScrollView ref={stHourScrollRef} style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                    <View style={{ height: 53 }} />
                    {HOURS.map(h => (
                      <TouchableOpacity key={`h-${h}`} style={[styles.pickerItem, tempHour === h && styles.pickerItemActive]} onPress={() => setTempHour(h)}>
                        <Text style={[styles.pickerItemText, tempHour === h && styles.pickerItemTextActive]}>{h}</Text>
                      </TouchableOpacity>
                    ))}
                    <View style={{ height: 53 }} />
                  </ScrollView>
                </View>
                <Text style={styles.pickerColon}>:</Text>
                <View style={styles.pickerColumnWrapper}>
                  <ScrollView ref={stMinScrollRef} style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                    <View style={{ height: 53 }} />
                    {MINUTES.map(m => (
                      <TouchableOpacity key={`m-${m}`} style={[styles.pickerItem, tempMinute === m && styles.pickerItemActive]} onPress={() => setTempMinute(m)}>
                        <Text style={[styles.pickerItemText, tempMinute === m && styles.pickerItemTextActive]}>{String(m).padStart(2, '0')}</Text>
                      </TouchableOpacity>
                    ))}
                    <View style={{ height: 53 }} />
                  </ScrollView>
                </View>
              </View>
            </View>

            <TouchableOpacity style={[styles.addOptionSubmit, { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }]} onPress={handleAddTime}>
              <Ionicons name="add" size={20} color={COLORS.white} />
              <Text style={{ color: COLORS.white, fontWeight: 'bold', marginLeft: 4, fontSize: 16 }}>候補に追加</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  schoolSelector: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border },
  schoolTab: { paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  schoolTabActive: { borderBottomColor: COLORS.primary },
  schoolTabText: { fontSize: 16, fontWeight: 'bold', color: COLORS.textLight },
  schoolTabTextActive: { color: COLORS.primary },

  stampingBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFDF5', padding: 12, borderBottomWidth: 1, borderColor: COLORS.primary },
  stampingText: { fontSize: 14, fontWeight: 'bold', color: COLORS.primary },
  stampingEndBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  stampingEndText: { color: COLORS.white, fontSize: 12, fontWeight: 'bold' },
  
  fab: { 
    position: 'absolute', right: 20, bottom: 40, backgroundColor: COLORS.primary, 
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 28, 
    alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
    shadowColor: COLORS.primary, shadowOpacity: 0.4, shadowRadius: 8, elevation: 5,
    minWidth: 72,
  },

  scrollArea: { flex: 1, padding: 16 },
  noDataText: { textAlign: 'center', marginTop: 40, color: COLORS.textLight, fontSize: 16 },
  tableContainer: { backgroundColor: COLORS.white, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: COLORS.border },
  tableCellHeader: { flex: 1, paddingVertical: 12, alignItems: 'center', backgroundColor: '#F5F5F5', borderRightWidth: 1, borderColor: COLORS.border },
  tableCellHeaderGrade: { flex: 1, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F5F5', borderRightWidth: 1, borderColor: COLORS.border },
  cellHeaderText: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  cellGradeText: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  tableCell: { flex: 1, borderRightWidth: 1, borderColor: COLORS.border, padding: 4, justifyContent: 'center' },
  timeCellBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, backgroundColor: '#FAFAFA', borderRadius: 6, borderWidth: 1, borderColor: 'transparent' },
  timeCellBtnActive: { backgroundColor: COLORS.primary + '10', borderColor: COLORS.primary + '40' },
  timeCellBtnStamping: { backgroundColor: '#F0F8FF' },
  timeText: { fontSize: 13, fontWeight: 'bold', color: '#1A237E' },
  timeTextEmpty: { fontSize: 12, color: COLORS.textLight, fontStyle: 'italic' },
  saveBtn: { flexDirection: 'row', backgroundColor: COLORS.primary, padding: 16, alignItems: 'center', justifyContent: 'center', margin: 16, borderRadius: 8 },
  saveBtnText: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxHeight: '90%', backgroundColor: COLORS.white, borderRadius: 16, padding: 20, overflow: 'hidden' }, // overflow: hiddenを追加
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  
  existingTimesList: { flex: 1, marginBottom: 16 }, // リスト部分のスタイル調整
  
  clearBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, backgroundColor: '#FFF0F0', borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#FFE0E0' },
  clearBtnText: { color: COLORS.danger, fontWeight: 'bold', marginLeft: 8 },
  optionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderColor: COLORS.border, paddingVertical: 4 },
  optionBtn: { flex: 1, paddingVertical: 12 },
  optionText: { fontSize: 22, fontWeight: 'bold', color: COLORS.text, textAlign: 'center' },
  
  // ★ 新規時刻追加UI用のスタイル更新
  addTimeContainer: { 
    paddingTop: 16, 
    borderTopWidth: 1, 
    borderColor: COLORS.border,
    backgroundColor: '#FAFAFA', // 背景色をつけて区別
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderRadius: 12
  },
  addTimeTitle: { fontSize: 14, fontWeight: 'bold', color: COLORS.textLight, marginBottom: 8, textAlign: 'center' },
  pickerColumns: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 140 }, // 高さを固定
  pickerColumnWrapper: { flex: 1, height: '100%', maxWidth: 80, backgroundColor: COLORS.white, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border }, // 枠をつける
  pickerScroll: { flex: 1 },
  pickerItem: { paddingVertical: 12, alignItems: 'center' },
  pickerItemActive: { backgroundColor: COLORS.primary + '20' },
  pickerItemText: { fontSize: 18, color: COLORS.textLight },
  pickerItemTextActive: { color: COLORS.primary, fontWeight: 'bold', fontSize: 22 },
  pickerColon: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, marginHorizontal: 8 },
  addOptionSubmit: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 16, borderRadius: 8, marginLeft: 12, shadowColor: '#000', elevation: 2 },
  toast: { position: 'absolute', bottom: 100, alignSelf: 'center', backgroundColor: '#333', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, flexDirection: 'row', alignItems: 'center', zIndex: 999, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 10 },
  toastText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  addTimeTriggerBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary + '15', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, gap: 4 },
  addTimeTriggerText: { fontSize: 12, fontWeight: 'bold', color: COLORS.primary },
});