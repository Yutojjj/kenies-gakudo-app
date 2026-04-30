import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type Staff = { id: string, name: string };
type AssignedStaff = { name: string, start: string, end: string };

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7〜21時
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0, 5, 10...55分

export default function ShiftCreateScreen() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  
  // ★ 追加: カレンダー内の時間表示切り替え
  const [showTimeInCalendar, setShowTimeInCalendar] = useState(false);

  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [requests, setRequests] = useState<Record<string, string>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, AssignedStaff[]>>({});
  
  const [masterTimes, setMasterTimes] = useState<string[]>([]);
  const [eventsData, setEventsData] = useState<Record<string, string>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState('');
  const [availableStaff, setAvailableStaff] = useState<Staff[]>([]);
  const [unavailableStaff, setUnavailableStaff] = useState<{name: string, type: string}[]>([]);
  const [currentDayAssigned, setCurrentDayAssigned] = useState<AssignedStaff[]>([]);

  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [editingStaffName, setEditingStaffName] = useState('');
  
  const [tempStart, setTempStart] = useState('14:00');
  const [tempEnd, setTempEnd] = useState('18:30');
  const [timeSelectTarget, setTimeSelectTarget] = useState<'start' | 'end'>('start');

  // ★ 新規追加用のスクロールピッカーステート
  const [newStartHour, setNewStartHour] = useState(14);
  const [newStartMinute, setNewStartMinute] = useState(0);
  const [newEndHour, setNewEndHour] = useState(18);
  const [newEndMinute, setNewEndMinute] = useState(30);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
        const data = await res.json();
        setPublicHolidays(data);
      } catch (e) {
        console.warn('祝日APIの取得に失敗しました', e);
      }

      const masterRef = doc(db, 'settings', 'master_data');
      const masterSnap = await getDoc(masterRef);
      if (masterSnap.exists() && masterSnap.data().times) {
        setMasterTimes(masterSnap.data().times);
      } else {
        // デフォルトをセット形式に変更
        const defaultTimes = ['14:00-18:30', '11:00-18:30', '13:30-18:30'];
        setMasterTimes(defaultTimes);
        await setDoc(masterRef, { times: defaultTimes }, { merge: true });
      }

      const q = query(collection(db, 'accounts'), where('role', '==', 'staff'));
      const snap = await getDocs(q);
      const staffList = snap.docs.map(d => ({ id: d.id, name: d.data().name }));
      setAllStaff(staffList);

      const reqUnsub = onSnapshot(collection(db, 'shifts'), (s) => {
        const reqData: Record<string, string> = {};
        s.forEach(d => {
          const data = d.data();
          reqData[`${data.staffName}_${data.dateStr}`] = data.type;
        });
        setRequests(reqData);
      });

      const asUnsub = onSnapshot(collection(db, 'assigned_shifts'), (s) => {
        const asData: Record<string, AssignedStaff[]> = {};
        s.forEach(d => { asData[d.id] = d.data().staff || []; });
        setAssignedShifts(asData);
      });

      const evUnsub = onSnapshot(collection(db, 'events'), (snap) => {
        const eData: Record<string, string> = {};
        snap.forEach(d => { eData[d.id] = d.data().title; });
        setEventsData(eData);
        setLoading(false);
      });

      return () => { reqUnsub(); asUnsub(); evUnsub(); };
    };
    fetchData();
  }, []);

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
  const generateDays = () => {
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

  const openDayModal = (dateStr: string) => {
    setSelectedDateStr(dateStr);
    const avail: Staff[] = [];
    const unavail: {name: string, type: string}[] = [];
    
    allStaff.forEach(staff => {
      const type = requests[`${staff.name}_${dateStr}`];
      if (type === '✕' || type === '午前✕' || type === '午後✕') {
        unavail.push({ name: staff.name, type });
      } else {
        avail.push(staff);
      }
    });
    
    setAvailableStaff(avail);
    setUnavailableStaff(unavail);
    setCurrentDayAssigned(assignedShifts[dateStr] || []);
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

  const openTimeEditor = (staffName: string, start: string, end: string) => {
    setEditingStaffName(staffName);
    setTempStart(start);
    setTempEnd(end);
    setTimeSelectTarget('start');
    setTimePickerVisible(true);
  };

  const handleMasterTimeSelect = (t: string) => {
    if (t.includes('-')) {
      const [s, e] = t.split('-');
      setTempStart(s);
      setTempEnd(e);
    } else {
      // 過去の単一時間データが残っていた場合のフォールバック
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
    await setDoc(doc(db, 'settings', 'master_data'), { times: newTimes }, { merge: true });
  };

  const saveTimeEdit = () => {
    setCurrentDayAssigned(currentDayAssigned.map(s => 
      s.name === editingStaffName ? { ...s, start: tempStart, end: tempEnd } : s
    ));
    setTimePickerVisible(false);
  };

  const saveDayShift = async () => {
    try {
      await setDoc(doc(db, 'assigned_shifts', selectedDateStr), { staff: currentDayAssigned, updatedAt: new Date() });
      setModalVisible(false);
    } catch (e) {
      Alert.alert('エラー', '保存に失敗しました');
    }
  };

  const exportPDF = async () => {
    try {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const daysInMonth = getDaysInMonth(currentDate.getFullYear(), currentDate.getMonth());
      
      let thDates = '';
      for (let i = 1; i <= daysInMonth; i++) {
        const d = new Date(year, month - 1, i).getDay();
        const dateStrForHoliday = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const isPublicHoliday = !!publicHolidays[dateStrForHoliday];
        
        const color = (d === 0 || isPublicHoliday) ? 'red' : d === 6 ? 'blue' : '#000';
        const bg = (d === 0 || isPublicHoliday) ? '#FFE4E1' : d === 6 ? '#E0FFFF' : '#E8F5E9'; 
        thDates += `<th style="background:${bg}; color:${color}; border:1px solid #333; width: 60px;">${i}</th>`;
      }

      let staffRows = '';
      allStaff.forEach(staff => {
        let rowHtml = `<tr><th style="background:#FFC0CB; border:1px solid #333; text-align:center; padding: 4px; white-space: nowrap;">${staff.name}</th>`;
        for (let i = 1; i <= daysInMonth; i++) {
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
          const assigned = assignedShifts[dateStr]?.find(s => s.name === staff.name);
          const req = requests[`${staff.name}_${dateStr}`];

          if (assigned) {
            rowHtml += `<td style="background:#FFD700; border:1px solid #333; font-weight:bold; font-size:10px;">${assigned.start}<br>-${assigned.end}</td>`;
          } else if (req && req.includes('✕')) {
            rowHtml += `<td style="background:#D3D3D3; border:1px solid #333; color:#333; font-size:12px;">✕</td>`;
          } else {
            rowHtml += `<td style="border:1px solid #333; background: #FFF;"></td>`;
          }
        }
        rowHtml += `</tr>`;
        staffRows += rowHtml;
      });

      const html = `
        <html><head><style>
          @page { size: A4 landscape; margin: 10mm; }
          body { font-family: sans-serif; font-size: 11px; margin: 0; padding: 0; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; text-align: center; }
          th, td { height: 36px; word-wrap: break-word; }
          .top-header td { border: 1px solid #333; font-weight: bold; font-size: 18px; text-align: center; }
        </style></head><body>
          <table>
            <tr class="top-header" style="height: 40px;">
              <td style="background:#B0C4DE;">シフト表</td>
              <td colspan="2" style="background:#E6E6FA;">${year}年</td>
              <td colspan="3" style="background:#FFDAB9; font-size: 24px;">${month}月</td>
              <td colspan="${daysInMonth - 6}" style="background:#F0F0F0; text-align: right; padding-right: 10px; font-size:12px; font-weight:normal;">出力日: ${new Date().toLocaleDateString('ja-JP')}</td>
            </tr>
            <tr><th style="background:#FFF3E0; border:1px solid #333;">名前 \\ 日付</th>${thDates}</tr>
            ${staffRows}
          </table>
        </body></html>
      `;
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri);
    } catch (e) {
      Alert.alert('エラー', 'PDF作成に失敗しました');
    }
  };

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color={COLORS.primary}/></SafeAreaView>;

  const days = generateDays();
  const weeks = ['日', '月', '火', '水', '木', '金', '土'];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color={COLORS.text} /></TouchableOpacity>
        <Text style={styles.headerTitle}>シフト作成</Text>
        <TouchableOpacity onPress={exportPDF} style={styles.pdfBtn}><Ionicons name="document-text" size={20} color={COLORS.white} /><Text style={styles.pdfBtnText}>PDF出力</Text></TouchableOpacity>
      </View>

      <View style={styles.monthSelector}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))}><Ionicons name="chevron-back" size={24} color={COLORS.text} /></TouchableOpacity>
          <Text style={styles.monthText}>{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</Text>
          <TouchableOpacity onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))}><Ionicons name="chevron-forward" size={24} color={COLORS.text} /></TouchableOpacity>
        </View>
        
        {/* ★ 時間表示の切り替えボタン */}
        <TouchableOpacity style={styles.toggleTimeBtn} onPress={() => setShowTimeInCalendar(!showTimeInCalendar)}>
          <Ionicons name={showTimeInCalendar ? "eye-off" : "eye"} size={16} color={COLORS.primary} style={{marginRight: 4}} />
          <Text style={styles.toggleTimeText}>{showTimeInCalendar ? '時間を隠す' : '時間も表示'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ paddingHorizontal: 8 }}>
        <View style={styles.calHeaderRow}>
          {weeks.map((w, i) => <Text key={i} style={[styles.calWeekText, i === 0 && {color: 'red'}, i === 6 && {color: 'blue'}]}>{w}</Text>)}
        </View>
        
        <View style={styles.calGrid}>
          {days.map((item, index) => {
            if (!item) return <View key={`empty-${index}`} style={styles.calCellEmpty} />;
            
            const assignedCount = (assignedShifts[item.dateStr] || []).length;
            const isEventDay = !!eventsData[item.dateStr];
            
            // 出勤可能人数の計算
            let unavailableCount = 0;
            allStaff.forEach(staff => {
              const req = requests[`${staff.name}_${item.dateStr}`];
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

            return (
              <TouchableOpacity key={item.dateStr} style={styles.calCell} onPress={() => openDayModal(item.dateStr)}>
                <View style={styles.cellTopRow}>
                  <Text style={[styles.calDayText, { color: dateColor }]}>{item.day}</Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.availableCountText}>可:{availableCount}</Text>
                    {assignedCount > 0 && <Text style={styles.cellCountText}>{assignedCount}名</Text>}
                  </View>
                </View>
                
                {isEventDay && (
                  <View style={styles.eventBadge}>
                    <Text style={styles.eventBadgeText} numberOfLines={1}>{eventsData[item.dateStr]}</Text>
                  </View>
                )}

                <View style={{ flex: 1, marginTop: 4 }}>
                  {(assignedShifts[item.dateStr] || []).map((st, i) => (
                    <Text key={i} style={styles.cellStaffText}>
                      {st.name}{showTimeInCalendar ? `\n${st.start}-${st.end}` : ''}
                    </Text>
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* --- モーダル群 --- */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <SafeAreaView style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedDateStr} のシフト
                {publicHolidays[selectedDateStr] ? ` (${publicHolidays[selectedDateStr]})` : ''}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}><Ionicons name="close" size={28} color={COLORS.text} /></TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1, padding: 20 }}>
              
              <Text style={[styles.sectionTitle, { color: COLORS.primary }]}>出勤可能なスタッフ</Text>
              {availableStaff.map((s, i) => {
                const isAssigned = currentDayAssigned.some(a => a.name === s.name);
                return (
                  <View key={i} style={styles.staffRow}>
                    <Text style={styles.staffName}>{s.name}</Text>
                    {isAssigned ? (
                      <TouchableOpacity style={styles.removeBtn} onPress={() => removeStaffFromShift(s.name)}><Text style={styles.removeBtnText}>外す</Text></TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={styles.addBtn} onPress={() => addStaffToShift(s.name, false)}><Text style={styles.addBtnText}>追加</Text></TouchableOpacity>
                    )}
                  </View>
                );
              })}

              <Text style={[styles.sectionTitle, { marginTop: 20, color: COLORS.textLight }]}>出勤不可のスタッフ (追加時警告)</Text>
              {unavailableStaff.map((s, i) => {
                const isAssigned = currentDayAssigned.some(a => a.name === s.name);
                return (
                  <View key={i} style={[styles.staffRow, { opacity: 0.6 }]}>
                    <Text style={[styles.staffName, { color: COLORS.danger }]}>{s.name} ({s.type})</Text>
                    {isAssigned ? (
                      <TouchableOpacity style={styles.removeBtn} onPress={() => removeStaffFromShift(s.name)}><Text style={styles.removeBtnText}>外す</Text></TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={[styles.addBtn, {backgroundColor: '#999'}]} onPress={() => addStaffToShift(s.name, true)}><Text style={styles.addBtnText}>追加</Text></TouchableOpacity>
                    )}
                  </View>
                );
              })}

              <Text style={[styles.sectionTitle, { marginTop: 30, borderColor: COLORS.accent }]}>決定したシフト</Text>
              {currentDayAssigned.length === 0 && <Text style={{ color: COLORS.textLight, fontStyle: 'italic' }}>追加されていません</Text>}
              {currentDayAssigned.map((s, i) => (
                <View key={i} style={styles.assignedCard}>
                  <View>
                    <Text style={styles.assignedName}>{s.name}</Text>
                    <Text style={styles.assignedTime}>{s.start} 〜 {s.end}</Text>
                  </View>
                  <TouchableOpacity style={styles.editTimeBtn} onPress={() => openTimeEditor(s.name, s.start, s.end)}>
                    <Ionicons name="time" size={16} color={COLORS.primary} /><Text style={styles.editTimeBtnText}>時間変更</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <View style={{height: 40}} />
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.saveBtn} onPress={saveDayShift}><Text style={styles.saveBtnText}>保存して閉じる</Text></TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* --- 時間変更＆候補追加モーダル --- */}
      <Modal visible={timePickerVisible} transparent animationType="fade">
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>{editingStaffName} の勤務時間</Text>
            
            <View style={styles.timeTargetRow}>
              <TouchableOpacity style={[styles.timeTargetBtn, timeSelectTarget === 'start' && styles.timeTargetBtnActive]} onPress={() => setTimeSelectTarget('start')}>
                <Text style={styles.timeTargetLabel}>開始</Text>
                <Text style={[styles.timeTargetValue, timeSelectTarget === 'start' && styles.timeTargetValueActive]}>{tempStart}</Text>
              </TouchableOpacity>
              <Text style={{fontSize:24, fontWeight:'bold', color:COLORS.textLight}}>〜</Text>
              <TouchableOpacity style={[styles.timeTargetBtn, timeSelectTarget === 'end' && styles.timeTargetBtnActive]} onPress={() => setTimeSelectTarget('end')}>
                <Text style={styles.timeTargetLabel}>終了</Text>
                <Text style={[styles.timeTargetValue, timeSelectTarget === 'end' && styles.timeTargetValueActive]}>{tempEnd}</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{maxHeight: 180, marginVertical: 8}} showsVerticalScrollIndicator={false}>
              <View style={styles.masterTimesGrid}>
                {masterTimes.map(t => (
                  <TouchableOpacity key={t} style={styles.masterTimeBtn} onPress={() => handleMasterTimeSelect(t)}>
                    <Text style={styles.masterTimeText}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* ★ 新しい時刻セットの追加UI (スクロール式) */}
            <View style={styles.addTimeContainer}>
              <Text style={styles.addTimeTitle}>新しい候補 (開始〜終了) を作成</Text>
              <View style={styles.pickerColumns}>
                {/* 開始時間 */}
                <View style={styles.pickerColumnWrapper}>
                  <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} style={styles.pickerScroll}>
                    {HOURS.map(h => (
                      <TouchableOpacity key={`sh-${h}`} style={[styles.pickerItem, newStartHour === h && styles.pickerItemActive]} onPress={() => setNewStartHour(h)}>
                        <Text style={[styles.pickerItemText, newStartHour === h && styles.pickerItemTextActive]}>{h}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
                <Text style={styles.pickerColon}>:</Text>
                <View style={styles.pickerColumnWrapper}>
                  <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} style={styles.pickerScroll}>
                    {MINUTES.map(m => (
                      <TouchableOpacity key={`sm-${m}`} style={[styles.pickerItem, newStartMinute === m && styles.pickerItemActive]} onPress={() => setNewStartMinute(m)}>
                        <Text style={[styles.pickerItemText, newStartMinute === m && styles.pickerItemTextActive]}>{String(m).padStart(2, '0')}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
                
                <Text style={styles.pickerColon}>〜</Text>
                
                {/* 終了時間 */}
                <View style={styles.pickerColumnWrapper}>
                  <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} style={styles.pickerScroll}>
                    {HOURS.map(h => (
                      <TouchableOpacity key={`eh-${h}`} style={[styles.pickerItem, newEndHour === h && styles.pickerItemActive]} onPress={() => setNewEndHour(h)}>
                        <Text style={[styles.pickerItemText, newEndHour === h && styles.pickerItemTextActive]}>{h}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
                <Text style={styles.pickerColon}>:</Text>
                <View style={styles.pickerColumnWrapper}>
                  <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} style={styles.pickerScroll}>
                    {MINUTES.map(m => (
                      <TouchableOpacity key={`em-${m}`} style={[styles.pickerItem, newEndMinute === m && styles.pickerItemActive]} onPress={() => setNewEndMinute(m)}>
                        <Text style={[styles.pickerItemText, newEndMinute === m && styles.pickerItemTextActive]}>{String(m).padStart(2, '0')}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                {/* ★ はみ出ないように「追加」だけに修正 */}
                <TouchableOpacity style={styles.addOptionSubmit} onPress={handleAddMasterTime}>
                  <Text style={{color: COLORS.white, fontWeight: 'bold'}}>追加</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={{flexDirection:'row', gap: 12, marginTop: 16}}>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: '#CCC'}]} onPress={()=>setTimePickerVisible(false)}><Text>キャンセル</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: COLORS.primary}]} onPress={saveTimeEdit}><Text style={{color: COLORS.white, fontWeight:'bold'}}>変更を確定</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderColor: COLORS.border },
  backBtn: { marginRight: 16 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text, flex: 1 },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  pdfBtnText: { color: COLORS.white, fontWeight: 'bold', marginLeft: 4 },
  
  monthSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  monthText: { fontSize: 20, fontWeight: 'bold', marginHorizontal: 12 },
  
  toggleTimeBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E0FFFF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#AFEEEE' },
  toggleTimeText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 12 },

  calHeaderRow: { flexDirection: 'row', marginBottom: 4 },
  calWeekText: { width: '14.2%', textAlign: 'center', fontSize: 13, fontWeight: 'bold' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  
  // ★ minHeight に変更し、内容に合わせて伸びるようにする
  calCellEmpty: { width: '14.28%', minHeight: 80 },
  calCell: { width: '14.28%', minHeight: 80, borderWidth: 0.5, borderColor: COLORS.border, padding: 4, backgroundColor: COLORS.white },
  
  cellTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  calDayText: { fontSize: 12, fontWeight: 'bold' },
  availableCountText: { fontSize: 9, color: COLORS.textLight, marginBottom: 2 },
  cellCountText: { fontSize: 10, color: COLORS.primary, fontWeight: 'bold' },
  
  cellStaffText: { fontSize: 9, color: '#333', marginBottom: 4, lineHeight: 12 },
  
  eventBadge: { backgroundColor: '#20B2AA', borderRadius: 4, padding: 2, marginTop: 2 },
  eventBadgeText: { fontSize: 8, color: COLORS.white, fontWeight: 'bold', textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: COLORS.white, height: '85%', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderColor: COLORS.border },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', borderBottomWidth: 2, borderColor: COLORS.border, paddingBottom: 4, marginBottom: 12 },
  
  staffRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#F0F0F0' },
  staffName: { fontSize: 16, fontWeight: 'bold' },
  addBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6 },
  addBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 12 },
  removeBtn: { backgroundColor: '#FFF0F0', borderWidth: 1, borderColor: '#FFE0E0', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6 },
  removeBtnText: { color: COLORS.danger, fontWeight: 'bold', fontSize: 12 },
  
  assignedCard: { backgroundColor: '#F0F8FF', padding: 16, borderRadius: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  assignedName: { fontSize: 16, fontWeight: 'bold', color: COLORS.primary, marginBottom: 4 },
  assignedTime: { fontSize: 14, color: COLORS.text, fontWeight: 'bold' },
  editTimeBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border },
  editTimeBtnText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 12, marginLeft: 4 },
  
  modalFooter: { padding: 20, borderTopWidth: 1, borderColor: COLORS.border },
  saveBtn: { backgroundColor: COLORS.primary, padding: 16, borderRadius: 12, alignItems: 'center' },
  saveBtnText: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  pickerContent: { width: '100%', backgroundColor: COLORS.white, borderRadius: 16, padding: 20 },
  pickerTitle: { fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 16 },
  
  timeTargetRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: 12 },
  timeTargetBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderWidth: 2, borderColor: 'transparent', borderRadius: 12, backgroundColor: '#F5F5F5', marginHorizontal: 4 },
  timeTargetBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '10' },
  timeTargetLabel: { fontSize: 10, color: COLORS.textLight, fontWeight: 'bold', marginBottom: 2 },
  timeTargetValue: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  timeTargetValueActive: { color: COLORS.primary },
  
  masterTimesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  masterTimeBtn: { width: '48%', backgroundColor: '#FFFDF5', borderWidth: 1, borderColor: '#F3E5AB', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  masterTimeText: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  
  // 新しい時刻の追加UI用スタイル
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
  addOptionSubmit: { backgroundColor: COLORS.primary, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 14, borderRadius: 6, marginLeft: 8 },
  
  modalBtn: { flex: 1, padding: 14, alignItems: 'center', borderRadius: 8 },
});