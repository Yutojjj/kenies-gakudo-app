import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AdminBottomNav from '../components/AdminBottomNav';
import AdminShiftTabs from '../components/AdminShiftTabs';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type ShiftType = '✕' | '午前✕' | '午後✕' | '○';
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
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

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


  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [allRequests, setAllRequests] = useState<Record<string, string>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, AssignedStaff[]>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});
  const [eventsData, setEventsData] = useState<Record<string, string>>({}); // ⑨ イベント
  const [spreadsheetVisible, setSpreadsheetVisible] = useState(false);

  useEffect(() => {
    if (!staffName) return;

    let unsubscribes: (() => void)[] = [];

    const fetchAllData = async () => {
      setLoading(true);
      setFetchError(false);
      try {
        // 未保存の「付与(✕)」のみ復元する。
        // ★削除指示(null)は復元しない★ — 過去に取り残されたnullが後日の保存で
        //   保存済みの×を巻き添え削除する事故を構造的に防ぐため。
        const localUnsaved = await AsyncStorage.getItem(`unsavedShifts_${staffName}`);
        if (localUnsaved) {
          try {
            const parsed = JSON.parse(localUnsaved);
            const onlyAdds: Record<string, ShiftType | null> = {};
            Object.entries(parsed).forEach(([d, v]) => {
              if (v !== null && v !== undefined && v !== '○') onlyAdds[d] = v as ShiftType;
            });
            pendingChangesRef.current = onlyAdds;
            setPendingChanges(onlyAdds);
          } catch { /* 破損データは無視 */ }
        }

        fetch('https://holidays-jp.github.io/api/v1/date.json')
          .then(res => res.json())
          .then(data => setPublicHolidays(data))
          .catch(e => console.warn('祝日API取得失敗', e));

        const resolvedName = staffName;
        const qMyShifts = query(collection(db, 'shifts2'), where('staffName', '==', resolvedName));
        
        // ★ shiftsはgetDocs（1回読み込み）に変更
        //   onSnapshotのリアルタイム同期がキャッシュの古い状態で上書きするバグを防ぐ
        const snapshot = await getDocs(qMyShifts);
        const data: Record<string, ShiftType> = {};
        snapshot.forEach((docSnap) => {
          const item = docSnap.data();
          if (item.dateStr && item.type && item.type !== '○') data[item.dateStr] = item.type;
        });
        serverDataRef.current = data;

        // 復元したpendingChangesをサーバー状態と照合して矛盾を除去
        const cleaned: Record<string, ShiftType | null> = {};
        let changed = false;
        Object.entries(pendingChangesRef.current).forEach(([dateStr, val]) => {
          const serverVal = data[dateStr];
          if (val === null) {
            if (serverVal === undefined) { changed = true; return; }
            cleaned[dateStr] = null;
          } else {
            if (serverVal === val) { changed = true; return; }
            cleaned[dateStr] = val;
          }
        });
        if (changed) {
          pendingChangesRef.current = cleaned;
          setPendingChanges(cleaned);
          persistPending(cleaned);
        }

        // サーバー生データに未保存変更を重ねて表示
        const merged = { ...data };
        Object.entries(pendingChangesRef.current).forEach(([dateStr, val]) => {
          if (val === null) delete merged[dateStr];
          else merged[dateStr] = val as ShiftType;
        });
        shiftDataRef.current = merged;
        setShiftData(merged);
        setLoading(false);

        const qStaff = query(collection(db, 'accounts'), where('role', '==', 'staff'));
        const snap = await getDocs(qStaff);
        setAllStaff(snap.docs.map(d => ({ id: d.id, name: d.data().name })));

        // shiftsの全件読み込み（onSnapshot→getDocs）
        const allShiftsSnap = await getDocs(collection(db, 'shifts2'));
        const reqData: Record<string, string> = {};
        allShiftsSnap.forEach(d => {
          const data = d.data();
          if (data.staffName && data.dateStr && data.type) {
            reqData[`${(data.staffName||'').trim()}_${data.dateStr}`] = data.type;
          }
        });
        setAllRequests(reqData);

        const unsubAssigned = onSnapshot(collection(db, 'assigned_shifts'), (s) => {
          const asData: Record<string, AssignedStaff[]> = {};
          s.forEach(d => { asData[d.id] = d.data().staff || []; });
          setAssignedShifts(asData);
        });
        unsubscribes.push(unsubAssigned);

        // ⑨ イベントデータをロード（正常処理内）
        try {
          const eventsSnap = await getDocs(collection(db, 'events'));
          const eventsMap: Record<string, string> = {};
          eventsSnap.forEach(d => {
            const data = d.data();
            if (data.title) eventsMap[d.id] = data.title;
          });
          setEventsData(eventsMap);
        } catch(e) { console.warn('eventsロード失敗', e); }

      } catch (error) {
        console.error("データ取得エラー", error);
        setFetchError(true);
        setLoading(false);
      }
    };

    fetchAllData();

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [staffName, retryCount]);

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

  // 未保存変更を物理ストレージへ保存（★付与(✕)のみ。削除指示(null)は永続化しない）
  const persistPending = (changes: Record<string, ShiftType | null>) => {
    const onlyAdds: Record<string, ShiftType> = {};
    Object.entries(changes).forEach(([d, v]) => {
      if (v !== null && v !== undefined && v !== '○') onlyAdds[d] = v as ShiftType;
    });
    if (Object.keys(onlyAdds).length === 0) {
      AsyncStorage.removeItem(`unsavedShifts_${staffName}`).catch(() => {});
    } else {
      AsyncStorage.setItem(`unsavedShifts_${staffName}`, JSON.stringify(onlyAdds)).catch(() => {});
    }
  };

  const changeMonth = (offset: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
  };

  const handleDayPress = (dateStr: string) => {
    const currentStamp = shiftDataRef.current[dateStr];
    const newValue = currentStamp === activeStamp ? '○' as ShiftType : activeStamp as ShiftType;

    // 表示用データを即時更新（楽観的更新）
    const newShiftData = { ...shiftDataRef.current };
    if (newValue === null || newValue === '○') {
      delete newShiftData[dateStr];
    } else {
      newShiftData[dateStr] = newValue as ShiftType;
    }
    shiftDataRef.current = newShiftData;
    setShiftData({ ...newShiftData });

    // pendingChangesは「サーバー状態との差分」として記録する
    setPendingChanges((prev: Record<string, ShiftType | null>) => {
      const next = { ...prev };
      const serverVal = serverDataRef.current[dateStr];

      const effNew = (newValue === '○') ? null : newValue;
      const effServer = (serverVal === '○') ? null : serverVal;
      if (effNew === null && !effServer) {
        delete next[dateStr];
      } else if (effNew === effServer) {
        delete next[dateStr];
      } else {
        next[dateStr] = newValue;
      }

      pendingChangesRef.current = next;
      // 付与(✕)のみ永続化（削除指示nullは残さない）
      persistPending(next);
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
    const resolvedName = (staffName || '不明なスタッフ').trim();
    // 保存対象のスナップショットを取る（保存中に変更されても固定）
    const changesToSave = { ...pendingChangesRef.current };

    try {
      for (const [dateStr, value] of Object.entries(changesToSave)) {
        const docId = `${resolvedName}_${dateStr}`;
        const docRef = doc(db, 'shifts2', docId);
        if (value === null) {
          await setDoc(docRef, { staffName: resolvedName, dateStr, type: '○', updatedAt: new Date() }, { merge: true });
          serverDataRef.current[dateStr] = '○' as ShiftType;
        } else {
          await setDoc(docRef, { staffName: resolvedName, dateStr, type: value, updatedAt: new Date() }, { merge: true });
          serverDataRef.current[dateStr] = value as ShiftType;
        }
      }

      // 保存できた分だけ pendingChanges から取り除く（保存中に追加された分は残す）
      const remaining: Record<string, ShiftType | null> = {};
      Object.entries(pendingChangesRef.current).forEach(([d, v]) => {
        if (!(d in changesToSave) || changesToSave[d] !== v) {
          remaining[d] = v;
        }
      });
      pendingChangesRef.current = remaining;
      setPendingChanges(remaining);
      persistPending(remaining);

      // 表示データをサーバー生データ＋残りの未保存変更で再構築
      const rebuilt = { ...serverDataRef.current };
      Object.entries(remaining).forEach(([d, v]) => {
        if (v === null || v === '○') delete rebuilt[d];
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
        {Object.keys(pendingChanges).length > 0 && (
          <TouchableOpacity
            style={{ backgroundColor: '#4CAF50', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, marginLeft: 8 }}
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
      </View>
      <AdminShiftTabs active="create" />

      {/* 種類選択ボタン（インライン3つ） */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#F8F8F8', borderBottomWidth: 1, borderColor: '#E0E0E0' }}>
        <Text style={{ fontSize: 12, color: '#888', alignSelf: 'center', marginRight: 4 }}>希望休の種類：</Text>
        {(['✕', '午前✕', '午後✕'] as ShiftType[]).map(type => (
          <TouchableOpacity
            key={type}
            style={{
              flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center',
              backgroundColor: activeStamp === type ? (type === '✕' ? '#EF5350' : type === '午前✕' ? '#29B6F6' : '#FFA726') : '#fff',
              borderWidth: 1.5,
              borderColor: activeStamp === type ? 'transparent' : (type === '✕' ? '#EF5350' : type === '午前✕' ? '#29B6F6' : '#FFA726'),
            }}
            onPress={() => setActiveStamp(type)}
          >
            <Text style={{ fontWeight: 'bold', fontSize: 13, color: activeStamp === type ? '#fff' : '#555' }}>{type}</Text>
          </TouchableOpacity>
        ))}
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

        {loading && (
          <View style={{ alignItems: 'center', paddingVertical: 60 }}>
            <Ionicons name="sync-outline" size={40} color={COLORS.textLight} />
            <Text style={{ color: COLORS.textLight, marginTop: 12, fontSize: 15 }}>シフトを読み込み中...</Text>
          </View>
        )}

        {fetchError && !loading && (
          <View style={{ alignItems: 'center', paddingVertical: 60 }}>
            <Ionicons name="cloud-offline-outline" size={48} color="#E57373" />
            <Text style={{ color: '#E57373', fontWeight: 'bold', fontSize: 16, marginTop: 12 }}>読み込みに失敗しました</Text>
            <Text style={{ color: COLORS.textLight, fontSize: 13, marginTop: 6, textAlign: 'center', paddingHorizontal: 32 }}>
              電波の良い場所で再度お試しください{'\n'}（シフトデータは消えていません）
            </Text>
            <TouchableOpacity
              onPress={() => setRetryCount(c => c + 1)}
              style={{ marginTop: 20, backgroundColor: COLORS.primary, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 10 }}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 15 }}>再読み込み</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !fetchError && <View style={styles.calendarContainer}>
          <View style={styles.calHeaderRow}>
            {weeks.map((w, i) => (
              <Text key={i} style={[styles.calWeekText, i === 0 && {color: '#E74C3C'}, i === 6 && {color: '#3498DB'}]}>{w}</Text>
            ))}
          </View>
          
          <View style={styles.calGrid}>
            {days.map((item, index) => {
              if (!item) return <View key={`empty-${index}`} style={styles.calCellEmpty} />;
              
              const dayOfWeek = new Date(item.dateStr).getDay();
              const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
              const isPublicHoliday = !!publicHolidays[item.dateStr];
              const holidayName = publicHolidays[item.dateStr];
              const cellStamp = shiftData[item.dateStr];

              return (
                <TouchableOpacity 
                  key={item.dateStr} 
                  style={[
                    styles.calCell,
                    (dayOfWeek === 0 || isPublicHoliday) && styles.calCellHoliday,
                    dayOfWeek === 6 && styles.calCellSaturday,
                    cellStamp && styles.calCellActive,
                  ]}
                  onPress={() => handleDayPress(item.dateStr)}
                  activeOpacity={0.6}
                >
                  <Text style={[
                    styles.calDayText,
                    dayOfWeek === 0 && styles.calDaySundayText,
                    dayOfWeek === 6 && styles.calDaySaturdayText,
                    isPublicHoliday && styles.calDayHolidayText,
                  ]}>{item.day}</Text>
                  {holidayName && (
                    <Text style={styles.holidayNameText} numberOfLines={2} adjustsFontSizeToFit>
                      {holidayName}
                    </Text>
                  )}
                  
                  <View style={styles.cellContent}>
                    {!cellStamp && !isWeekend && !publicHolidays[item.dateStr] && item.dateStr && (
                      <View style={[styles.stampBadge, styles.stampBadgeCircle]}>
                        <Text style={[styles.stampText, { color: '#2E7D32' }]}>○</Text>
                      </View>
                    )}
                    {cellStamp && (
                      <View style={[
                        styles.stampBadge, 
                        cellStamp === '✕' ? styles.stampBadgeAll : 
                        cellStamp === '午前✕' ? styles.stampBadgeAM : styles.stampBadgePM
                      ]}>
                        <Text style={styles.stampText}>{cellStamp}</Text>
                      </View>
                    )}
                    {eventsData[item.dateStr] && (
                      <Text style={{ fontSize: 7, color: '#7B1FA2', fontWeight: 'bold', textAlign: 'center', marginTop: 2 }} numberOfLines={1}>
                        {eventsData[item.dateStr]}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>}

      </ScrollView>

      {/* 大きい保存ボタン */}
      {Object.keys(pendingChanges).length > 0 && (
        <TouchableOpacity
          style={{ backgroundColor: '#4CAF50', margin: 14, borderRadius: 14, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, shadowColor: '#4CAF50', shadowOpacity: 0.4, shadowRadius: 8, elevation: 5 }}
          onPress={saveShifts}
          disabled={saving}
        >
          <Ionicons name="cloud-upload-outline" size={22} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 17 }}>
            {saving ? '保存中...' : `保存する（${Object.keys(pendingChanges).length}件の変更）`}
          </Text>
        </TouchableOpacity>
      )}

      <AdminBottomNav active="shift" />

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
                            {day && publicHolidays[day.dateStr] && (
                              <Text style={styles.ssHolidayText} numberOfLines={1} adjustsFontSizeToFit>
                                {publicHolidays[day.dateStr]}
                              </Text>
                            )}
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
  calCellHoliday: { backgroundColor: '#FFF1F1' },
  calCellSaturday: { backgroundColor: '#F0F8FF' },
  calCellActive: { backgroundColor: '#FAFAFA' },
  calDayText: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 4, textAlign: 'center' },
  calDaySundayText: { color: '#E74C3C' },
  calDaySaturdayText: { color: '#3498DB' },
  calDayHolidayText: { color: '#E74C3C' },
  holidayNameText: { color: '#D64545', fontSize: 8, fontWeight: 'bold', textAlign: 'center', lineHeight: 10, minHeight: 11, marginTop: -2, marginBottom: 1 },
  cellContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  stampBadge: { paddingHorizontal: 4, paddingVertical: 4, borderRadius: 6, width: '100%', alignItems: 'center', justifyContent: 'center' },
  stampBadgeCircle: { backgroundColor: '#E8F5E9' },
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
  ssHolidayText: { fontSize: 6, fontWeight: 'bold', color: '#D64545', textAlign: 'center', lineHeight: 7, paddingHorizontal: 1 },
  ssNameCell: { backgroundColor: '#FFC0CB', borderWidth: 1, borderColor: '#666', justifyContent: 'center', alignItems: 'center', paddingVertical: 6 },
  ssNameText: { fontSize: 10, fontWeight: 'bold', color: '#333', textAlign: 'center', paddingHorizontal: 2 },
  ssDataCell: { borderWidth: 1, borderColor: '#666', justifyContent: 'center', alignItems: 'center', paddingVertical: 4 },
  ssDataText: { fontSize: 9, color: '#333', textAlign: 'center', lineHeight: 11 },
});
