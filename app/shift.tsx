import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type ShiftType = '✕' | '午前✕' | '午後✕';
type Staff = { id: string, name: string };
type AssignedStaff = { name: string, start: string, end: string };

export default function ShiftScreen() {
  const router = useRouter();
  const { name: nameParam } = useLocalSearchParams<{ name: string }>();
  const [staffName, setStaffNameRaw] = useState((nameParam || '').trim());
  // staffNameは必ずトリムして保持（保存・読込・キーの不一致を防ぐ）
  const setStaffName = (n: string) => setStaffNameRaw((n || '').trim());

  useEffect(() => {
    const loadName = async () => {
      try {
        const raw = await AsyncStorage.getItem('loggedInUser');
        if (raw) {
          const user = JSON.parse(raw);
          if (user.name) setStaffName(user.name);
        }
      } catch {}
    };
    if (!nameParam) loadName();
    else setStaffName(nameParam);
  }, [nameParam]);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(false);
  
  const [shiftData, setShiftData] = useState<Record<string, ShiftType>>({});
  const shiftDataRef = useRef<Record<string, ShiftType>>({});
  // サーバー（Firestore）の生データを常に保持。マージの土台にする
  const serverDataRef = useRef<Record<string, ShiftType>>({});
  const [pendingChanges, setPendingChanges] = useState<Record<string, ShiftType | null>>({});
  const pendingChangesRef = useRef<Record<string, ShiftType | null>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [activeStamp, setActiveStamp] = useState<ShiftType>('✕');
  const [stampModalVisible, setStampModalVisible] = useState(false);
  // ⑥ シフト入力期間設定
  const [inputPeriodModalVisible, setInputPeriodModalVisible] = useState(false);
  const [inputPeriod, setInputPeriod] = useState<{ targetMonth: string; startDate: string; endDate: string } | null>(null);
  const [periodTargetMonth, setPeriodTargetMonth] = useState('');
  const [periodStartDate, setPeriodStartDate] = useState('');
  const [periodEndDate, setPeriodEndDate] = useState('');
  const [periodCalTarget, setPeriodCalTarget] = useState<'start' | 'end'>('start');
  const [periodCalVisible, setPeriodCalVisible] = useState(false);
  const [periodCalViewDate, setPeriodCalViewDate] = useState(new Date());
  const [periodMonthCalVisible, setPeriodMonthCalVisible] = useState(false);
  const [periodMonthCalViewDate, setPeriodMonthCalViewDate] = useState(new Date());

  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [allRequests, setAllRequests] = useState<Record<string, string>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, AssignedStaff[]>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});
  const [spreadsheetVisible, setSpreadsheetVisible] = useState(false);

  useEffect(() => {
    if (!staffName) return; 

    let unsubscribes: (() => void)[] = [];

    const fetchAllData = async () => {
      try {
        // ★ 絶対に消えないための処理1：通信開始前に、スマホ本体から未保存データを「確実に読み込み終わる」まで待機する
        const localUnsaved = await AsyncStorage.getItem(`unsavedShifts_${staffName}`);
        if (localUnsaved) {
          const parsed = JSON.parse(localUnsaved);
          pendingChangesRef.current = parsed;
          setPendingChanges(parsed);
        }

        fetch('https://holidays-jp.github.io/api/v1/date.json')
          .then(res => res.json())
          .then(data => setPublicHolidays(data))
          .catch(e => console.warn('祝日API取得失敗', e));

        const resolvedName = staffName;
        const qMyShifts = query(collection(db, 'shifts'), where('staffName', '==', resolvedName));
        
        // ★ 復元が完了した後にデータベースの監視をスタートするため、上書き事故が起きない
        const unsubMy = onSnapshot(qMyShifts, { includeMetadataChanges: false }, (snapshot) => {
          // サーバーの最新状態を生データとして保持
          const data: Record<string, ShiftType> = {};
          snapshot.forEach((docSnap) => {
            const item = docSnap.data();
            if (item.dateStr && item.type) data[item.dateStr] = item.type;
          });
          serverDataRef.current = data;

          // 保存処理の最中はサーバーからの中間状態で上書きしない（保存完了後に再計算される）
          if (savingRef.current) return;

          // サーバー生データに、未保存の変更(pendingChanges)を重ねて表示用データを作る
          const merged = { ...data };
          Object.entries(pendingChangesRef.current).forEach(([dateStr, val]) => {
            if (val === null) delete merged[dateStr];
            else merged[dateStr] = val as ShiftType;
          });
          shiftDataRef.current = merged;
          setShiftData(merged);
        });
        unsubscribes.push(unsubMy);

        const qStaff = query(collection(db, 'accounts'), where('role', '==', 'staff'));
        const snap = await getDocs(qStaff);
        setAllStaff(snap.docs.map(d => ({ id: d.id, name: d.data().name })));

        const unsubAllReq = onSnapshot(collection(db, 'shifts'), (s) => {
          const reqData: Record<string, string> = {};
          s.forEach(d => {
            const data = d.data();
            reqData[`${data.staffName}_${data.dateStr}`] = data.type;
          });
          setAllRequests(reqData);
        });
        unsubscribes.push(unsubAllReq);

        const unsubAssigned = onSnapshot(collection(db, 'assigned_shifts'), (s) => {
          const asData: Record<string, AssignedStaff[]> = {};
          s.forEach(d => { asData[d.id] = d.data().staff || []; });
          setAssignedShifts(asData);
        });
        unsubscribes.push(unsubAssigned);

      } catch (error) {
        console.error("データ取得エラー", error);
      }
    };

    fetchAllData();

    // 入力期間設定をロード
    getDoc(doc(db, 'settings', 'shift_input_period')).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setInputPeriod({ targetMonth: d.targetMonth, startDate: d.startDate, endDate: d.endDate });
      }
    });

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [staffName]);

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
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ day: i, dateStr });
    }
    return days;
  };

  const generateWeeksForSpreadsheet = () => {
    const days = generateCalendarDays();
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    return weeks;
  };

  const changeMonth = (offset: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
  };

  const handleDayPress = (dateStr: string) => {
    const currentStamp = shiftDataRef.current[dateStr];
    const newValue = currentStamp === activeStamp ? null : activeStamp;

    // 表示用データを即時更新（楽観的更新）
    const newShiftData = { ...shiftDataRef.current };
    if (newValue === null) {
      delete newShiftData[dateStr];
    } else {
      newShiftData[dateStr] = newValue as ShiftType;
    }
    shiftDataRef.current = newShiftData;
    setShiftData({ ...newShiftData });

    // pendingChangesは「サーバー状態との差分」として記録する
    setPendingChanges((prev: Record<string, ShiftType | null>) => {
      const next = { ...prev };
      const serverVal = serverDataRef.current[dateStr]; // サーバーにある値（なければundefined）

      if (newValue === null && !serverVal) {
        // サーバーにも無く、消す操作 → 差分不要
        delete next[dateStr];
      } else if (newValue === serverVal) {
        // サーバーと同じ状態に戻った → 差分不要
        delete next[dateStr];
      } else {
        // サーバーと異なる → 差分として記録（newValueがnullなら削除指示）
        next[dateStr] = newValue;
      }

      pendingChangesRef.current = next;
      // タップした瞬間に物理ストレージへ記録（アプリが落ちても消えない）
      if (Object.keys(next).length === 0) {
        AsyncStorage.removeItem(`unsavedShifts_${staffName}`).catch(() => {});
      } else {
        AsyncStorage.setItem(`unsavedShifts_${staffName}`, JSON.stringify(next)).catch(() => {});
      }
      return next;
    });
  };

  const saveShifts = async () => {
    if (Object.keys(pendingChangesRef.current).length === 0) {
      Alert.alert('問題なし', '変更がありません');
      return;
    }
    setSaving(true);
    savingRef.current = true;
    // 名前は前後の空白を除去して常に一致させる（端末差・入力差対策）
    const resolvedName = (staffName || '不明なスタッフ').trim();
    // 保存対象のスナップショットを取る（保存中に変更されても固定）
    const changesToSave = { ...pendingChangesRef.current };

    try {
      for (const [dateStr, value] of Object.entries(changesToSave)) {
        const docId = `${resolvedName}_${dateStr}`;
        const docRef = doc(db, 'shifts', docId);
        if (value === null) {
          // 削除：存在しなくてもエラーにならない
          await deleteDoc(docRef).catch(() => {});
          delete serverDataRef.current[dateStr];
        } else {
          await setDoc(docRef, { staffName: resolvedName, dateStr, type: value, updatedAt: new Date() }, { merge: true });
          serverDataRef.current[dateStr] = value as ShiftType;
        }
      }

      // 保存できた分だけ pendingChanges から取り除く（保存中に追加された分は残す）
      const remaining: Record<string, ShiftType | null> = {};
      Object.entries(pendingChangesRef.current).forEach(([d, v]) => {
        if (!(d in changesToSave) || changesToSave[d] !== v) {
          remaining[d] = v; // 保存中に新たに変更された分
        }
      });
      pendingChangesRef.current = remaining;
      setPendingChanges(remaining);

      if (Object.keys(remaining).length === 0) {
        await AsyncStorage.removeItem(`unsavedShifts_${resolvedName}`);
      } else {
        await AsyncStorage.setItem(`unsavedShifts_${resolvedName}`, JSON.stringify(remaining)).catch(() => {});
      }

      // 表示データをサーバー生データ＋残りの未保存変更で再構築
      const rebuilt = { ...serverDataRef.current };
      Object.entries(remaining).forEach(([d, v]) => {
        if (v === null) delete rebuilt[d];
        else rebuilt[d] = v as ShiftType;
      });
      shiftDataRef.current = rebuilt;
      setShiftData(rebuilt);

      Alert.alert('保存完了', 'シフトを保存しました');
    } catch (e) {
      Alert.alert('エラー', '保存に失敗しました。電波の良い場所で再度お試しください。');
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const selectStamp = (stamp: ShiftType) => {
    setActiveStamp(stamp);
    setStampModalVisible(false);
  };

  // ⑥ 入力期間関連
  const toDateStr2 = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const toMonthStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;

  const openInputPeriodModal = () => {
    const now = new Date();
    setPeriodTargetMonth(inputPeriod?.targetMonth || toMonthStr(new Date(now.getFullYear(), now.getMonth()+1, 1)));
    setPeriodStartDate(inputPeriod?.startDate || toDateStr2(now));
    setPeriodEndDate(inputPeriod?.endDate || toDateStr2(new Date(now.getFullYear(), now.getMonth()+1, 0)));
    setPeriodMonthCalViewDate(now);
    setInputPeriodModalVisible(true);
  };

  const savePeriodSetting = async () => {
    const data = { targetMonth: periodTargetMonth, startDate: periodStartDate, endDate: periodEndDate };
    await setDoc(doc(db, 'settings', 'shift_input_period'), data);
    setInputPeriod(data);
    setInputPeriodModalVisible(false);
    Alert.alert('保存完了', `${periodTargetMonth}のシフト入力期間を設定しました`);
  };

  const genCalDays = (viewDate: Date) => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const days: (number|null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  };

  // 入力期間中かどうかチェック（スタッフ用：today が期間内なら通常通り入力可）
  const isWithinInputPeriod = (() => {
    if (!inputPeriod) return true;
    const today = toDateStr2(new Date());
    return today >= inputPeriod.startDate && today <= inputPeriod.endDate;
  })();

  const days = generateCalendarDays();
  const weeks = ['日', '月', '火', '水', '木', '金', '土'];
  const spreadsheetWeeks = generateWeeksForSpreadsheet();

  return (
    <SafeAreaView style={styles.container}>
      
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
            <Ionicons name="chevron-back" size={24} color="#5D4037" />
          </TouchableOpacity>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#5D4037' }}>シフト提出</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {Object.keys(pendingChanges).length > 0 && (
            <TouchableOpacity
              style={{ backgroundColor: '#4CAF50', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 }}
              onPress={saveShifts}
              disabled={saving}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>
                {saving ? '保存中...' : `保存(${Object.keys(pendingChanges).length}件)`}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setSpreadsheetVisible(true)} style={styles.viewBoardBtn}>
            <Ionicons name="grid-outline" size={18} color={COLORS.white} />
            <Text style={styles.viewBoardBtnText}>シフト表を見る</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ backgroundColor: '#78909C', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, flexDirection: 'row', alignItems: 'center' }}
            onPress={openInputPeriodModal}
          >
            <Ionicons name="calendar-outline" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 12, marginLeft: 4 }}>入力期間</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 入力期間バナー */}
      {inputPeriod && (
        <View style={{ backgroundColor: isWithinInputPeriod ? '#E8F5E9' : '#FFF3E0', paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: isWithinInputPeriod ? '#A5D6A7' : '#FFCC80' }}>
          <Ionicons name="time-outline" size={16} color={isWithinInputPeriod ? '#2E7D32' : '#E65100'} style={{ marginRight: 8 }} />
          <Text style={{ fontSize: 13, fontWeight: 'bold', color: isWithinInputPeriod ? '#2E7D32' : '#E65100', flex: 1 }}>
            {inputPeriod.targetMonth} 分のシフト入力期間: {inputPeriod.startDate} 〜 {inputPeriod.endDate}
            {isWithinInputPeriod ? '（入力受付中）' : '（期間外）'}
          </Text>
        </View>
      )}

      <View style={styles.stampBanner}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="create-outline" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
          <Text style={styles.bannerText}>現在選択中：</Text>
        </View>
        <View style={[
          styles.activeStampBadge,
          activeStamp === '✕' ? styles.stampBadgeAll : activeStamp === '午前✕' ? styles.stampBadgeAM : styles.stampBadgePM
        ]}>
          <Text style={styles.activeStampText}>{activeStamp}</Text>
        </View>
      </View>

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

        <View style={styles.calendarContainer}>
          <View style={styles.calHeaderRow}>
            {weeks.map((w, i) => (
              <Text key={i} style={[styles.calWeekText, i === 0 && {color: '#E74C3C'}, i === 6 && {color: '#3498DB'}]}>{w}</Text>
            ))}
          </View>
          
          <View style={styles.calGrid}>
            {days.map((item, index) => {
              if (!item) return <View key={`empty-${index}`} style={styles.calCellEmpty} />;
              
              const isWeekend = new Date(item.dateStr).getDay() === 0 || new Date(item.dateStr).getDay() === 6;
              const cellStamp = shiftData[item.dateStr];

              return (
                <TouchableOpacity 
                  key={item.dateStr} 
                  style={[styles.calCell, cellStamp && styles.calCellActive]}
                  onPress={() => handleDayPress(item.dateStr)}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.calDayText, isWeekend && { color: '#999' }]}>{item.day}</Text>
                  
                  <View style={styles.cellContent}>
                    {cellStamp && (
                      <View style={[
                        styles.stampBadge, 
                        cellStamp === '✕' ? styles.stampBadgeAll : 
                        cellStamp === '午前✕' ? styles.stampBadgeAM : styles.stampBadgePM
                      ]}>
                        <Text style={styles.stampText}>{cellStamp}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={() => setStampModalVisible(true)}>
        <Ionicons name="options-outline" size={24} color={COLORS.white} />
        <Text style={styles.fabText}>種類変更</Text>
      </TouchableOpacity>

      <Modal visible={spreadsheetVisible} animationType="slide" transparent={false}>
        <SafeAreaView style={styles.ssModalContainer}>
          <View style={styles.ssModalHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="grid" size={24} color={COLORS.primary} style={{ marginRight: 8 }} />
              <Text style={styles.ssModalTitle}>月別シフト表</Text>
            </View>
            <TouchableOpacity onPress={() => setSpreadsheetVisible(false)}>
              <Ionicons name="close-circle" size={32} color={COLORS.textLight} />
            </TouchableOpacity>
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
                  <View style={[styles.ssHeaderCell, { backgroundColor: '#FFE4B5', width: '16%' }]}><Text style={styles.ssHeaderText}>{currentDate.getMonth() + 1}月</Text></View>
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

                    {allStaff.map(staff => (
                      <View key={staff.id} style={styles.ssRow}>
                        <View style={[styles.ssNameCell, { width: '16%', backgroundColor: staff.name === staffName ? '#FFDAB9' : '#FFC0CB' }]}>
                          <Text style={[styles.ssNameText, staff.name === staffName && { color: COLORS.primary }]} adjustsFontSizeToFit numberOfLines={1}>{staff.name}</Text>
                        </View>
                        {week.map((day, dIdx) => {
                          let content = '';
                          let bgColor = '#FFFFFF';
                          let isBold = false;
                          const cellWidth = (dIdx === 0 || dIdx === 6) ? '6%' : '14.4%';
                          
                          if (day) {
                            const assigned = assignedShifts[day.dateStr]?.find(s => s.name === staff.name);
                            const req = allRequests[`${staff.name}_${day.dateStr}`];
                            
                            if (assigned) {
                              content = `開:${assigned.start}\n終:${assigned.end}`; 
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

      <Modal visible={stampModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>希望休の種類を選択</Text>
              <TouchableOpacity onPress={() => setStampModalVisible(false)}>
                <Ionicons name="close" size={28} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalDesc}>選択した状態でカレンダーをタップすると入力できます。</Text>

            <TouchableOpacity style={styles.stampSelectBtn} onPress={() => selectStamp('✕')}>
              <View style={[styles.stampIconDemo, styles.stampBadgeAll]}>
                <Text style={styles.stampTextDemo}>✕</Text>
              </View>
              <Text style={styles.stampSelectText}>1日お休み</Text>
              {activeStamp === '✕' && <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />}
            </TouchableOpacity>

            <TouchableOpacity style={styles.stampSelectBtn} onPress={() => selectStamp('午前✕')}>
              <View style={[styles.stampIconDemo, styles.stampBadgeAM]}>
                <Text style={styles.stampTextDemo}>午前✕</Text>
              </View>
              <Text style={styles.stampSelectText}>午前のみお休み</Text>
              {activeStamp === '午前✕' && <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />}
            </TouchableOpacity>

            <TouchableOpacity style={styles.stampSelectBtn} onPress={() => selectStamp('午後✕')}>
              <View style={[styles.stampIconDemo, styles.stampBadgePM]}>
                <Text style={styles.stampTextDemo}>午後✕</Text>
              </View>
              <Text style={styles.stampSelectText}>午後のみお休み</Text>
              {activeStamp === '午後✕' && <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />}
            </TouchableOpacity>

          </View>
        </View>
      </Modal>

      {/* ⑥ 入力期間設定モーダル */}
      <Modal visible={inputPeriodModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>シフト入力期間設定</Text>
              <TouchableOpacity onPress={() => setInputPeriodModalVisible(false)}>
                <Ionicons name="close" size={28} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>

            {/* 対象月 */}
            <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#555', marginBottom: 8 }}>対象月（入力してもらうシフトの月）</Text>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 14, marginBottom: 16, backgroundColor: '#F0F8FF' }}
              onPress={() => setPeriodMonthCalVisible(true)}
            >
              <Ionicons name="calendar-outline" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
              <Text style={{ flex: 1, fontSize: 20, fontWeight: 'bold', color: COLORS.primary }}>{periodTargetMonth}</Text>
              <Ionicons name="chevron-down" size={16} color={COLORS.textLight} />
            </TouchableOpacity>

            {/* 入力開始日 */}
            <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#555', marginBottom: 8 }}>入力開始日</Text>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 14, marginBottom: 16, backgroundColor: '#F0F8FF' }}
              onPress={() => { setPeriodCalTarget('start'); setPeriodCalViewDate(new Date(periodStartDate)); setPeriodCalVisible(true); }}
            >
              <Ionicons name="calendar-outline" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
              <Text style={{ flex: 1, fontSize: 18, fontWeight: 'bold', color: COLORS.primary }}>{periodStartDate}</Text>
              <Ionicons name="chevron-down" size={16} color={COLORS.textLight} />
            </TouchableOpacity>

            {/* 入力終了日 */}
            <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#555', marginBottom: 8 }}>入力終了日</Text>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 14, marginBottom: 24, backgroundColor: '#F0F8FF' }}
              onPress={() => { setPeriodCalTarget('end'); setPeriodCalViewDate(new Date(periodEndDate)); setPeriodCalVisible(true); }}
            >
              <Ionicons name="calendar-outline" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
              <Text style={{ flex: 1, fontSize: 18, fontWeight: 'bold', color: COLORS.primary }}>{periodEndDate}</Text>
              <Ionicons name="chevron-down" size={16} color={COLORS.textLight} />
            </TouchableOpacity>

            <TouchableOpacity
              style={{ backgroundColor: COLORS.primary, padding: 16, borderRadius: 12, alignItems: 'center' }}
              onPress={savePeriodSetting}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>保存する</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 入力期間 日付カレンダー */}
      <Modal visible={periodCalVisible} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ width: '100%', backgroundColor: '#fff', borderRadius: 16, padding: 24 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <TouchableOpacity onPress={() => setPeriodCalViewDate(new Date(periodCalViewDate.getFullYear(), periodCalViewDate.getMonth()-1, 1))}>
                <Ionicons name="chevron-back" size={24} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: 'bold' }}>{periodCalViewDate.getFullYear()}年 {periodCalViewDate.getMonth()+1}月</Text>
              <TouchableOpacity onPress={() => setPeriodCalViewDate(new Date(periodCalViewDate.getFullYear(), periodCalViewDate.getMonth()+1, 1))}>
                <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', marginBottom: 8 }}>
              {['日','月','火','水','木','金','土'].map((w,i) => (
                <Text key={i} style={{ width: '14.2%', textAlign: 'center', fontWeight: 'bold', color: i===0?'red':i===6?'blue':COLORS.textLight }}>{w}</Text>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {genCalDays(periodCalViewDate).map((day, idx) => {
                const dateStr = day ? `${periodCalViewDate.getFullYear()}-${String(periodCalViewDate.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}` : '';
                const isSelected = dateStr === (periodCalTarget === 'start' ? periodStartDate : periodEndDate);
                return (
                  <TouchableOpacity key={idx} style={{ width: '14.2%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center', borderWidth: 0.5, borderColor: COLORS.border, backgroundColor: isSelected ? COLORS.primary : '#fff' }} disabled={!day}
                    onPress={() => {
                      if (!day) return;
                      if (periodCalTarget === 'start') setPeriodStartDate(dateStr);
                      else setPeriodEndDate(dateStr);
                      setPeriodCalVisible(false);
                    }}
                  >
                    {day && <Text style={{ fontWeight: 'bold', color: isSelected ? '#fff' : COLORS.text }}>{day}</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      {/* 対象月選択カレンダー（年月のみ） */}
      <Modal visible={periodMonthCalVisible} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ width: '100%', backgroundColor: '#fff', borderRadius: 16, padding: 24 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <TouchableOpacity onPress={() => setPeriodMonthCalViewDate(new Date(periodMonthCalViewDate.getFullYear()-1, periodMonthCalViewDate.getMonth(), 1))}>
                <Ionicons name="chevron-back" size={24} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: 'bold' }}>{periodMonthCalViewDate.getFullYear()}年</Text>
              <TouchableOpacity onPress={() => setPeriodMonthCalViewDate(new Date(periodMonthCalViewDate.getFullYear()+1, periodMonthCalViewDate.getMonth(), 1))}>
                <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
              {Array.from({length: 12}, (_,i) => i+1).map(m => {
                const mStr = `${periodMonthCalViewDate.getFullYear()}-${String(m).padStart(2,'0')}`;
                const isSelected = mStr === periodTargetMonth;
                return (
                  <TouchableOpacity key={m} style={{ width: '22%', paddingVertical: 14, borderRadius: 10, backgroundColor: isSelected ? COLORS.primary : '#F5F5F5', alignItems: 'center' }}
                    onPress={() => { setPeriodTargetMonth(mStr); setPeriodMonthCalVisible(false); }}
                  >
                    <Text style={{ fontWeight: 'bold', color: isSelected ? '#fff' : COLORS.text }}>{m}月</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  saveBtn: { backgroundColor: '#4CAF50', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, marginLeft: 8 },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  container: { flex: 1, backgroundColor: COLORS.background },
  viewBoardBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  viewBoardBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 12, marginLeft: 4 },
  stampBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFDF5', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#F3E5AB', marginTop: 10 },
  bannerText: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  activeStampBadge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
  activeStampText: { color: COLORS.text, fontWeight: 'bold', fontSize: 14 },
  scrollArea: { flex: 1 },
  monthSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  monthBtn: { padding: 8, backgroundColor: COLORS.surface, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border },
  monthText: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  calendarContainer: { paddingHorizontal: 12, paddingBottom: 20 },
  calHeaderRow: { flexDirection: 'row', marginBottom: 12 },
  calWeekText: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 'bold', color: COLORS.textLight },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCellEmpty: { width: '14.28%', aspectRatio: 0.8 },
  calCell: { width: '14.28%', aspectRatio: 0.8, borderWidth: 0.5, borderColor: COLORS.border, padding: 4, backgroundColor: COLORS.white },
  calCellActive: { backgroundColor: '#FAFAFA' },
  calDayText: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 4, textAlign: 'center' },
  cellContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  stampBadge: { paddingHorizontal: 4, paddingVertical: 4, borderRadius: 6, width: '100%', alignItems: 'center', justifyContent: 'center' },
  stampBadgeAll: { backgroundColor: '#FFE4E1' }, 
  stampBadgeAM: { backgroundColor: '#E0FFFF' },  
  stampBadgePM: { backgroundColor: '#FFFACD' },  
  stampText: { fontSize: 11, fontWeight: 'bold', color: COLORS.text },
  submitContainer: { padding: 20, paddingBottom: 100 },
  submitBtn: { flexDirection: 'row', backgroundColor: COLORS.primary, padding: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  submitBtnText: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },
  fab: { position: 'absolute', right: 20, bottom: 40, backgroundColor: COLORS.secondary, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 30, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  fabText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16, marginLeft: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { width: '100%', backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 15, elevation: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  modalDesc: { fontSize: 13, color: COLORS.textLight, marginBottom: 24 },
  stampSelectBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: COLORS.border },
  stampIconDemo: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, marginRight: 16, width: 80, alignItems: 'center' },
  stampTextDemo: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  stampSelectText: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, flex: 1 },
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
});