import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useRequireRole } from '../hooks/useRequireRole';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AdminBottomNav, { ADMIN_BOTTOM_NAV_HEIGHT } from '../components/AdminBottomNav';
import AdminShiftTabs from '../components/AdminShiftTabs';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { navigateHome } from '../utils/navigationHome';

const SHIFT_IMAGES = {
  autoFill: require('../assets/menu/shift_auto.png'),
  delete:   require('../assets/menu/shift_delete.png'),
};

type Staff = { id: string, name: string };
type AssignedStaff = { name: string, start: string, end: string };

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); 
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); 

export default function ShiftCreateScreen() {
  const { verified, checking } = useRequireRole('admin');

  const router = useRouter();
  const { openSettings, autoPdf, year: routeYear, month: routeMonth } = useLocalSearchParams<{
    openSettings?: string;
    autoPdf?: string;
    year?: string;
    month?: string;
  }>();
  const [currentDate, setCurrentDate] = useState(() => {
    const year = Number(routeYear);
    const month = Number(routeMonth);
    return Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12
      ? new Date(year, month - 1, 1)
      : new Date();
  });
  const autoPdfHandledRef = useRef(false);
  const [loading, setLoading] = useState(false);
  
  const [showTimeInCalendar, setShowTimeInCalendar] = useState(true);

  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [staffListLoaded, setStaffListLoaded] = useState(false);
  const [assignedShiftsLoaded, setAssignedShiftsLoaded] = useState(false);
  const [requests, setRequests] = useState<Record<string, string>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, AssignedStaff[]>>({});
  
  const [masterTimes, setMasterTimes] = useState<string[]>([]);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'dow'|'staff'|'order'>('dow');
  const [pdfOrder, setPdfOrder] = useState<string[]>([]);
  // 自動入力設定（Firestoreに保存）
  const [autoFillSettings, setAutoFillSettings] = useState<{
    staffSettings: { name: string; start: string; end: string; priority: number; enabled: boolean }[];
    dayMaxCount: { '月':number; '火':number; '水':number; '木':number; '金':number };
    pdfOrder?: string[];
  }>({
    staffSettings: [],
    dayMaxCount: { '月':3, '火':3, '水':3, '木':3, '金':3 },
  });
  const [eventsData, setEventsData] = useState<Record<string, string>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});
  const [holidayPeriods, setHolidayPeriods] = useState<any[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState('');
  const [availableStaff, setAvailableStaff] = useState<Staff[]>([]);
  const [unavailableStaff, setUnavailableStaff] = useState<{name: string, type: string}[]>([]);
  const [workSummaryVisible, setWorkSummaryVisible] = useState(false);
  const [workHoursVisible, setWorkHoursVisible] = useState(false);
  const [currentDayAssigned, setCurrentDayAssigned] = useState<AssignedStaff[]>([]);

  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [editingStaffName, setEditingStaffName] = useState('');
  
  const [tempStart, setTempStart] = useState('14:00');
  const [tempEnd, setTempEnd] = useState('18:30');
  const [timeSelectTarget, setTimeSelectTarget] = useState<'start' | 'end'>('start');

  const [newStartHour, setNewStartHour] = useState(14);
  const [newStartMinute, setNewStartMinute] = useState(0);
  const [newEndHour, setNewEndHour] = useState(18);
  const [newEndMinute, setNewEndMinute] = useState(30);

  const [spreadsheetVisible, setSpreadsheetVisible] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      // ▼ 修正: 各処理を個別に try/catch し、失敗しても次の処理へ進む ▼

      // 祝日 API（失敗しても続行）
      try {
        const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
        const data = await res.json();
        setPublicHolidays(data);
      } catch (e) {
        console.warn('祝日APIの取得に失敗しました', e);
      }

      // master_data（失敗してもデフォルト値で続行）
      try {
        const masterRef = doc(db, 'settings', 'master_data');
        const masterSnap = await getDoc(masterRef);
        if (masterSnap.exists() && masterSnap.data().workTimes) {
          setMasterTimes(masterSnap.data().workTimes);
        } else {
          const defaultTimes = ['14:00-18:30', '11:00-18:30', '13:30-18:30'];
          setMasterTimes(defaultTimes);
          await setDoc(masterRef, { workTimes: defaultTimes }, { merge: true });
        }
      } catch (e) {
        console.warn('master_data 取得失敗。デフォルト値を使用します', e);
        setMasterTimes(['14:00-18:30', '11:00-18:30', '13:30-18:30']);
      }

      // スタッフ一覧（失敗しても続行）
      try {
        const q = query(collection(db, 'accounts'), where('role', '==', 'staff'));
        const snap = await getDocs(q);
        const staffList = snap.docs
          .filter(d => d.data().showInShiftTable !== false)
          .map(d => ({ id: d.id, name: d.data().name }));
        setAllStaff(staffList);
        setStaffListLoaded(true);

        // autoFillSettings初期化（Firestoreの保存データをマージ）
        getDoc(doc(db, 'settings', 'autoFillSettings')).then(settingSnap => {
          const saved = settingSnap.exists() ? settingSnap.data() : {};
          const savedStaff: any[] = saved.staffSettings || [];
          const merged = staffList.map((s, i) => {
            const found = savedStaff.find((x: any) => x.name === s.name);
            if (found) return found;
            return {
              name: s.name,
              start: s.name === '稲熊' ? '11:00' : '14:00',
              end:   s.name === '稲熊' ? '20:00' : '18:30',
              priority: i + 1,
              enabled: true,
            };
          });
          const savedPdfOrder = saved.pdfOrder || [];
          if (savedPdfOrder.length > 0) setPdfOrder(savedPdfOrder);
          setAutoFillSettings({
            staffSettings: merged,
            dayMaxCount: saved.dayMaxCount || { '月':3, '火':3, '水':3, '木':3, '金':3 },
            pdfOrder: savedPdfOrder,
          });
        });
      } catch (e) {
        console.warn('スタッフ取得失敗', e);
        setStaffListLoaded(true);
      }

      // ▼ リアルタイムリスナーをまとめて設定 ▼
      // shifts はgetDocs（1回読み込み）に変更
      const shiftsSnap = await getDocs(collection(db, 'shifts2'));
      const reqData: Record<string, string> = {};
      shiftsSnap.forEach(d => {
        const data = d.data();
        if (!data.staffName || !data.dateStr || !data.type) return;
        reqData[`${String(data.staffName).trim()}_${data.dateStr}`] = data.type;
      });
      setRequests(reqData);

      // シフト画面を再読み込みするボタン用の関数を定義
      const reloadShifts = async () => {
        const snap = await getDocs(collection(db, 'shifts2'));
        const rd: Record<string, string> = {};
        snap.forEach(d => {
          const data = d.data();
          if (!data.staffName || !data.dateStr || !data.type) return;
          rd[`${String(data.staffName).trim()}_${data.dateStr}`] = data.type;
        });
        setRequests(rd);
      };

      const asUnsub = onSnapshot(collection(db, 'assigned_shifts'), (s) => {
        const asData: Record<string, AssignedStaff[]> = {};
        s.forEach(d => { asData[d.id] = d.data().staff || []; });
        setAssignedShifts(asData);
        setAssignedShiftsLoaded(true);
      }, (e) => console.warn('assigned_shifts リスナーエラー', e));

      const evUnsub = onSnapshot(collection(db, 'events'), (snap) => {
        const eData: Record<string, string> = {};
        snap.forEach(d => { eData[d.id] = d.data().title; });
        setEventsData(eData);
      }, (e) => console.warn('events リスナーエラー', e));

      onSnapshot(doc(db, 'settings', 'holidays_data'), (docSnap) => {
        if (docSnap.exists() && docSnap.data().periods) setHolidayPeriods(docSnap.data().periods);
      });

      // ▼ 修正: リスナー設定完了時点でローディング解除（コールバック待ち不要）▼

      return () => { asUnsub(); evUnsub(); };
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

  const generateWeeksForSpreadsheet = () => {
    const days = generateDays();
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    return weeks;
  };

  const openDayModal = (dateStr: string) => {
    setSelectedDateStr(dateStr);
    const avail: Staff[] = [];
    const unavail: {name: string, type: string}[] = [];
    
    allStaff.forEach(staff => {
      const type = requests[`${(staff.name||'').trim()}_${dateStr}`];
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


  // スタッフ別合計勤務時間を計算
  const calcWorkSummary = () => {
    const summary: {name:string; totalMin:number; days:number}[] = [];
    allStaff.forEach(staff => {
      let totalMin = 0;
      let days = 0;
      Object.entries(assignedShifts).forEach(([dateStr, entries]) => {
        const entry = entries.find((e: any) => e.name === staff.name);
        if (!entry) return;
        const [sh, sm] = entry.start.split(':').map(Number);
        const [eh, em] = entry.end.split(':').map(Number);
        const mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins > 0) { totalMin += mins; days++; }
      });
      summary.push({ name: staff.name, totalMin, days });
    });
    return summary.sort((a,b) => b.totalMin - a.totalMin);
  };

  const toHM = (mins: number) => `${Math.floor(mins/60)}h${mins%60 > 0 ? String(mins%60).padStart(2,'0')+'m' : ''}`;

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
    await setDoc(doc(db, 'settings', 'master_data'), { workTimes: newTimes }, { merge: true });
  };

  const saveTimeEdit = () => {
    setCurrentDayAssigned(currentDayAssigned.map(s => 
      s.name === editingStaffName ? { ...s, start: tempStart, end: tempEnd } : s
    ));
    setTimePickerVisible(false);
  };

  const saveDayShift = async () => {
    try {
      await setDoc(doc(db, 'assigned_shifts', selectedDateStr), { staff: currentDayAssigned, updatedAt: new Date() }, { merge: true });
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
      const DOW = ['日','月','火','水','木','金','土'];

      const weeks: ({day:number, dow:number, dateStr:string} | null)[][] = [];
      let week: ({day:number, dow:number, dateStr:string} | null)[] = [];
      const firstDow = new Date(year, month - 1, 1).getDay();
      for (let p = 0; p < firstDow; p++) week.push(null);
      for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(year, month - 1, d).getDay();
        const ds = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        week.push({ day: d, dow, dateStr: ds });
        if (dow === 6 || d === daysInMonth) {
          while (week.length < 7) week.push(null);
          weeks.push(week);
          week = [];
        }
      }

      const dowHeader = `<tr>
        <td class="c-month">${month}月</td>
        ${DOW.map((d,i) => {
          const cls = i===0 ? 'c-dow c-dow-sun' : i===6 ? 'c-dow c-dow-sat' : 'c-dow c-dow-week';
          return `<td class="${cls}">${d}</td>`;
        }).join('')}
      </tr>`;

      let bodyHtml = '';
      weeks.forEach(wk => {
        // 日付行
        const dateRow = `<tr>
          <td class="c-date-label"></td>
          ${wk.map(cell => {
            if (!cell) return `<td class="c-date-empty"></td>`;
            const isSun = cell.dow===0, isSat = cell.dow===6;
            const isPH = !!publicHolidays[cell.dateStr];
            const cls = (isPH||isSun) ? 'c-date c-date-sun' : isSat ? 'c-date c-date-sat' : 'c-date c-date-week';
            return `<td class="${cls}">${cell.day}</td>`;
          }).join('')}
        </tr>`;

        // スタッフ行
        const orderedStaff: typeof allStaff = autoFillSettings.pdfOrder && autoFillSettings.pdfOrder.length > 0
          ? [...autoFillSettings.pdfOrder.map(n => allStaff.find(s => s.name === n)).filter((s): s is typeof allStaff[0] => !!s),
             ...allStaff.filter(s => !(autoFillSettings.pdfOrder as string[]).includes(s.name))]
          : allStaff;
        const staffHtml = orderedStaff.map(staff => {
          const cells = wk.map(cell => {
            if (!cell) return `<td class="c-shift c-shift-empty"></td>`;
            const isSun = cell.dow===0, isSat = cell.dow===6;
            const isPH = !!publicHolidays[cell.dateStr];
            // 土日・祝日は色だけ（×なし）
            if (isSun || isPH) return `<td class="c-shift c-col-sun"></td>`;
            if (isSat) return `<td class="c-shift c-col-sat"></td>`;
            const assigned = assignedShifts[cell.dateStr]?.find((s:any) => s.name === staff.name);
            const req = requests[`${(staff.name||'').trim()}_${cell.dateStr}`];
            if (assigned) {
              return `<td class="c-shift c-assigned">${assigned.start}-${assigned.end}</td>`;
            } else {
              // 平日の未回答・出勤不可は × グレー
              return `<td class="c-shift c-off">×</td>`;
            }
          }).join('');
          return `<tr><td class="c-name">${staff.name}</td>${cells}</tr>`;
        }).join('');

        bodyHtml += dateRow + staffHtml;
      });

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        @page { size: A4 portrait; margin: 5mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Hiragino Kaku Gothic ProN', 'Meiryo', Arial, sans-serif;
          font-size: 7px;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          color-adjust: exact;
        }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        td { border: 0.5px solid #AAAAAA; vertical-align: middle; text-align: center; }

        .c-month { background-color: #E8F5E9 !important; font-weight: bold; font-size: 8px; padding: 2px; }

        .c-dow { font-weight: bold; font-size: 7.5px; padding: 2px; }
        .c-dow-week { background-color: #E8E8E8 !important; color: #333; }
        .c-dow-sun  { background-color: #FFD9D9 !important; color: #CC0000; }
        .c-dow-sat  { background-color: #CCE4FF !important; color: #0055CC; }

        .c-date-label { background-color: #FFFFFF !important; height: 14px; }
        .c-date-empty { background-color: #F0F0F0 !important; height: 14px; }
        .c-date       { font-weight: bold; font-size: 8px; height: 14px; padding: 1px; }
        .c-date-week  { background-color: #E8F5E9 !important; color: #333; }
        .c-date-sun   { background-color: #FFD9D9 !important; color: #CC0000; }
        .c-date-sat   { background-color: #CCE4FF !important; color: #0055CC; }

        .c-name { background-color: #FFB6C1 !important; font-weight: 900; font-size: 8.5px;
          padding: 1px 2px; height: 20px; white-space: nowrap; overflow: hidden; }

        .c-shift       { height: 20px; font-size: 9.5px; padding: 1px;
                         background-color: #FFFFFF !important;
                         white-space: nowrap; overflow: hidden; }
        .c-shift-empty { background-color: #F0F0F0 !important; }
        .c-assigned    { background-color: #FFD700 !important; font-weight: 900; color: #111; font-size: 10px; }
        .c-off         { background-color: #D0D0D0 !important; color: #111; font-size: 13px; font-weight: 900; line-height: 1; }
        .c-col-sun     { background-color: #FFD9D9 !important; }
        .c-col-sat     { background-color: #CCE4FF !important; }

        .legend { margin-top: 5px; font-size: 6.5px; color: #444; display: flex; gap: 10px; align-items: center; }
        .lb { display: inline-block; width: 10px; height: 10px; border: 0.5px solid #aaa; vertical-align: middle; margin-right: 2px; }
      </style></head><body>
        <table>
          <colgroup>
            <col style="width:18px"/>
            <col style="width:3%"/>
            <col style="width:16.4%"/>
            <col style="width:16.4%"/>
            <col style="width:16.4%"/>
            <col style="width:16.4%"/>
            <col style="width:16.4%"/>
            <col style="width:3%"/>
          </colgroup>
          <thead>${dowHeader}</thead>
          <tbody>${bodyHtml}</tbody>
        </table>
        <div class="legend">
          <span><span class="lb" style="background:#FFD700;"></span>出勤（時間）</span>
          <span><span class="lb" style="background:#D0D0D0;"></span>× 出勤不可 / 未回答</span>
          <span><span class="lb" style="background:#FFD9D9;"></span>日曜・祝日</span>
          <span><span class="lb" style="background:#CCE4FF;"></span>土曜</span>
        </div>
      </body></html>`;

      if (Platform.OS === 'web') {
        // srcdoc方式（Vercel HTTPS環境対応・ポップアップ不要）
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;visibility:hidden;';
        iframe.srcdoc = html;
        document.body.appendChild(iframe);
        iframe.onload = () => {
          setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            setTimeout(() => {
              document.body.removeChild(iframe);
            }, 1000);
          }, 300);
        };
      } else {
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      }
    } catch (e: any) {
      console.error('PDF error:', e);
      Alert.alert('エラー', `PDF作成に失敗しました: ${e?.message || String(e)}`);
    }
  };

  useEffect(() => {
    if (openSettings === '1') setSettingsVisible(true);
  }, [openSettings]);

  useEffect(() => {
    if (autoPdf !== '1' || autoPdfHandledRef.current || !staffListLoaded || !assignedShiftsLoaded) return;
    autoPdfHandledRef.current = true;
    const timer = setTimeout(() => exportPDF(), 350);
    return () => clearTimeout(timer);
  }, [autoPdf, staffListLoaded, assignedShiftsLoaded, allStaff, assignedShifts, requests]);



















  const days = generateDays();
  const weeks = ['日', '月', '火', '水', '木', '金', '土'];
  const spreadsheetWeeks = generateWeeksForSpreadsheet();

  const saveAutoFillSettings = async (settings: typeof autoFillSettings) => {
    setAutoFillSettings(settings);
    await setDoc(doc(db, 'settings', 'autoFillSettings'), settings);
  };

  if (checking || !verified) return null;
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigateHome(router)}><Ionicons name="chevron-back" size={24} color="#5D4037" /></TouchableOpacity>
        <Text style={styles.headerTitle}>シフト作成</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={() => setSettingsVisible(true)} style={[styles.pdfBtn, { backgroundColor: '#78909C' }]}>
            <Ionicons name="settings-outline" size={20} color={COLORS.white} />
            <Text style={styles.pdfBtnText}>設定</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={exportPDF} style={styles.pdfBtn}>
            <Ionicons name="document-text" size={20} color={COLORS.white} />
            <Text style={styles.pdfBtnText}>PDF出力</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.pdfBtn, { backgroundColor: '#5D4037' }]} onPress={() => setWorkSummaryVisible(true)}>
            <Ionicons name="time-outline" size={20} color={COLORS.white} />
            <Text style={styles.pdfBtnText}>勤務時間</Text>
          </TouchableOpacity>
        </View>
      </View>
      <AdminShiftTabs active="create" />

      {/* ⑥ 勤務時間サマリーポップアップ */}
      <Modal visible={workSummaryVisible} transparent animationType="fade">
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'center', alignItems:'center', padding:20 }}>
          <View style={{ width:'100%', maxHeight:'80%', backgroundColor:'#fff', borderRadius:16, overflow:'hidden' }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, backgroundColor:'#EFEBE9', borderBottomWidth:1, borderColor:'#D7CCC8' }}>
              <Text style={{ fontSize:16, fontWeight:'bold', color:'#5D4037' }}>スタッフ別 合計勤務時間</Text>
              <TouchableOpacity onPress={() => setWorkSummaryVisible(false)}>
                <Ionicons name="close-circle" size={28} color="#795548" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding:16 }}>
              {calcWorkSummary().map((s, i) => (
                <View key={s.name} style={{ flexDirection:'row', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderColor:'#EEE' }}>
                  <Text style={{ width:30, fontSize:13, color:'#aaa', fontWeight:'bold' }}>{i+1}</Text>
                  <Text style={{ flex:1, fontSize:15, fontWeight:'bold', color:'#333' }}>{s.name}</Text>
                  <Text style={{ fontSize:13, color:'#666' }}>{s.days}日</Text>
                  <Text style={{ fontSize:16, fontWeight:'bold', color:'#5D4037', marginLeft:12, minWidth:70, textAlign:'right' }}>{toHM(s.totalMin)}</Text>
                </View>
              ))}
              {calcWorkSummary().length === 0 && <Text style={{ textAlign:'center', color:'#aaa', padding:20 }}>まだシフトが確定していません</Text>}
              <View style={{ height:20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <View style={styles.monthSelector}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))}><Ionicons name="chevron-back" size={24} color={COLORS.text} /></TouchableOpacity>
          <Text style={styles.monthText}>{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</Text>
          <TouchableOpacity onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))}><Ionicons name="chevron-forward" size={24} color={COLORS.text} /></TouchableOpacity>
        </View>
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
            
            let unavailableCount = 0;
            allStaff.forEach(staff => {
              const key = `${(staff.name || '').trim()}_${item.dateStr}`;
              const req = requests[key];
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

            const hPeriod = holidayPeriods.find((h: any) => item.dateStr >= h.start && item.dateStr <= h.end);
            return (
              <TouchableOpacity key={item.dateStr} style={[styles.calCell, hPeriod?.color && { backgroundColor: hPeriod.color }]} onPress={() => openDayModal(item.dateStr)}>
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

      {/* 一括削除FAB（右下）*/}
      <TouchableOpacity
        style={styles.fabDelete}
        onPress={async () => {
          const year = currentDate.getFullYear();
          const month = currentDate.getMonth();
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          const confirmed = Platform.OS === 'web'
            ? window.confirm(`${year}年${month + 1}月のシフトを全て削除しますか？`)
            : await new Promise<boolean>(resolve => Alert.alert('確認', `${year}年${month + 1}月のシフトを全て削除しますか？`, [
                { text: 'キャンセル', onPress: () => resolve(false) },
                { text: '削除', style: 'destructive', onPress: () => resolve(true) }
              ]));
          if (!confirmed) return;
          setLoading(true);
          let count = 0;
          for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (assignedShifts[dateStr] && assignedShifts[dateStr].length > 0) {
              await deleteDoc(doc(db, 'assigned_shifts', dateStr));
              count++;
            }
          }
          setLoading(false);
          if (Platform.OS === 'web') window.alert(`${count}日分のシフトを削除しました`);
          else Alert.alert('完了', `${count}日分のシフトを削除しました`);
        }}
        activeOpacity={0.85}
      >
        <Image source={SHIFT_IMAGES.delete} style={styles.fabImg} resizeMode="cover" />
      </TouchableOpacity>

      {/* 自動入力FAB（左下）- 当月全日一括 */}
      <TouchableOpacity
        style={styles.fabAutoFill}
        onPress={async () => {
          const year = currentDate.getFullYear();
          const month = currentDate.getMonth();
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          let updatedCount = 0;
          const ok = Platform.OS === 'web'
            ? window.confirm(`${year}年${month + 1}月の全平日に出勤可能スタッフを最大3名ずつ自動入力します。`)
            : await new Promise<boolean>(resolve => Alert.alert('一括自動入力', `${year}年${month + 1}月の全平日に出勤可能スタッフを最大3名ずつ自動入力します。`, [
                { text: 'キャンセル', onPress: () => resolve(false) },
                { text: '実行', onPress: () => resolve(true) }
              ]));
          if (!ok) return;
          setLoading(true);
          try {
            for (let d = 1; d <= daysInMonth; d++) {
              const date = new Date(year, month, d);
              const dow = date.getDay();
              if (dow === 0 || dow === 6) continue;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              if (publicHolidays[dateStr]) continue;
              const already = assignedShifts[dateStr] || [];
              const assignedNames = [...already.map((s: any) => s.name)];
              const newEntries: { name: string; start: string; end: string }[] = [...already];
              const dowName = ['日','月','火','水','木','金','土'][new Date(year, month, d).getDay()] as '月'|'火'|'水'|'木'|'金';
              const maxCount = (autoFillSettings.dayMaxCount as any)[dowName] ?? 3;
              const sortedSettings = [...autoFillSettings.staffSettings]
                .filter(s => s.enabled)
                .sort((a, b) => a.priority - b.priority);
              for (const setting of sortedSettings) {
                if (assignedNames.includes(setting.name)) continue;
                const req = requests[`${(setting.name||'').trim()}_${dateStr}`];
                if (req === '✕' || req === '午前✕' || req === '午後✕') continue;
                const isInaguma = setting.name === '稲熊';
                const othersCount = newEntries.filter(s => s.name !== '稲熊').length;
                if (!isInaguma && othersCount >= maxCount) continue;
                newEntries.push({ name: setting.name, start: setting.start, end: setting.end });
                assignedNames.push(setting.name);
              }
              if (newEntries.length === already.length) continue;
              await setDoc(doc(db, 'assigned_shifts', dateStr), { staff: newEntries, updatedAt: new Date() }, { merge: true });
              updatedCount++;
            }
            if (Platform.OS === 'web') window.alert(`完了: ${updatedCount}日分を自動入力しました`);
            else Alert.alert('完了', `${updatedCount}日分を自動入力しました`);
          } catch (e) {
            if (Platform.OS === 'web') window.alert('エラー: 一部保存に失敗しました');
            else Alert.alert('エラー', '一部保存に失敗しました');
          } finally { setLoading(false); }
        }}
        activeOpacity={0.85}
      >
        {loading
          ? <ActivityIndicator size="small" color={COLORS.white} style={{ position: 'absolute', zIndex: 10 }} />
          : null}
        <Image source={SHIFT_IMAGES.autoFill} style={[styles.fabImg, loading && { opacity: 0.5 }]} resizeMode="cover" />
      </TouchableOpacity>

      {/* ==========================================
          ★ 1画面完全フィットシフト表 (土日幅縮小版)
          ========================================== */}
      <Modal visible={spreadsheetVisible} animationType="slide" transparent={false}>
        <SafeAreaView style={styles.ssModalContainer}>
          <View style={styles.ssModalHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="grid" size={24} color={COLORS.primary} style={{ marginRight: 8 }} />
              <Text style={styles.ssModalTitle}>月別シフト表</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity onPress={exportPDF} style={styles.pdfBtn}>
                <Ionicons name="document-text" size={20} color={COLORS.white} />
                <Text style={styles.pdfBtnText}>PDF出力</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSpreadsheetVisible(false)}>
                <Ionicons name="close-circle" size={32} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
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
                  <View style={[styles.ssHeaderCell, { backgroundColor: '#FFF8F0', width: '16%' }]}><Text style={styles.ssHeaderText}>{currentDate.getMonth() + 1}月</Text></View>
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

                    {(autoFillSettings.pdfOrder && autoFillSettings.pdfOrder.length > 0
              ? [...autoFillSettings.pdfOrder.map((n: string) => allStaff.find(s => s.name === n)).filter((s): s is typeof allStaff[0] => !!s),
                 ...allStaff.filter(s => !(autoFillSettings.pdfOrder as string[]).includes(s.name))]
              : allStaff).map(staff => (
                      <View key={staff.id} style={styles.ssRow}>
                        <View style={[styles.ssNameCell, { width: '16%' }]}>
                          <Text style={styles.ssNameText} numberOfLines={1} adjustsFontSizeToFit>{staff.name}</Text>
                        </View>
                        {week.map((day, dIdx) => {
                          let content = '';
                          let bgColor = '#FFFFFF';
                          let isBold = false;
                          const cellWidth = (dIdx === 0 || dIdx === 6) ? '6%' : '14.4%';
                          
                          if (day) {
                            const assigned = assignedShifts[day.dateStr]?.find(s => s.name === staff.name);
                            const req = requests[`${(staff.name||'').trim()}_${day.dateStr}`];
                            
                            if (assigned) {
                              // ★ 縦に伸びすぎないように「開:〇〇 \n 終:〇〇」の2行にまとめる
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
                              {/* ★ numberOfLines={2} で確実に2行で切る */}
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

              {/* ⑬ 決定したシフト（最上位に表示） */}
              <Text style={[styles.sectionTitle, { borderColor: COLORS.accent, marginBottom: 8 }]}>決定したシフト</Text>
              {currentDayAssigned.length === 0 && <Text style={{ color: COLORS.textLight, fontStyle: 'italic', marginBottom: 16 }}>追加されていません</Text>}
              {currentDayAssigned.map((s, i) => (
                <TouchableOpacity key={i} style={styles.assignedCard} onPress={() => openTimeEditor(s.name, s.start, s.end)} activeOpacity={0.75}>
                  <View>
                    <Text style={styles.assignedName}>{s.name}</Text>
                    <Text style={styles.assignedTime}>{s.start} 〜 {s.end}</Text>
                    <Text style={{ fontSize: 10, color: COLORS.textLight, marginTop: 2 }}>タップで時間変更</Text>
                  </View>
                  <TouchableOpacity style={styles.assignedDeleteBtn} onPress={() => removeStaffFromShift(s.name)}>
                    <Ionicons name="trash" size={16} color={COLORS.danger} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 20 }}>
                <Text style={[styles.sectionTitle, { color: COLORS.primary, marginBottom: 0, borderBottomWidth: 0 }]}>出勤可能なスタッフ</Text>
                <TouchableOpacity
                  style={styles.autoFillBtn}
                  onPress={() => {
                    const alreadyAssigned = currentDayAssigned.map(a => a.name);
                    const candidates = availableStaff.filter(s => !alreadyAssigned.includes(s.name));
                    const toAdd = candidates.slice(0, Math.max(0, 3 - currentDayAssigned.length));
                    if (toAdd.length === 0) return;
                    setCurrentDayAssigned([...currentDayAssigned, ...toAdd.map(s => ({ name: s.name, start: '14:00', end: '18:30' }))]);
                  }}
                >
                  <Ionicons name="flash" size={14} color={COLORS.white} />
                  <Text style={styles.autoFillBtnText}>3名まで自動追加</Text>
                </TouchableOpacity>
              </View>
              {availableStaff.map((s, i) => {
                const isAssigned = currentDayAssigned.some(a => a.name === s.name);
                return (
                  <TouchableOpacity key={i} style={styles.staffRow} onPress={() => !isAssigned && addStaffToShift(s.name, false)} activeOpacity={isAssigned ? 1 : 0.6}>
                    <Text style={styles.staffName}>{s.name}</Text>
                    {isAssigned ? (
                      <TouchableOpacity style={styles.removeBtn} onPress={() => removeStaffFromShift(s.name)}><Text style={styles.removeBtnText}>外す</Text></TouchableOpacity>
                    ) : (
                      <View style={styles.addBtn}><Text style={styles.addBtnText}>追加</Text></View>
                    )}
                  </TouchableOpacity>
                );
              })}

              <Text style={[styles.sectionTitle, { marginTop: 20, color: COLORS.textLight }]}>出勤不可のスタッフ (追加時警告)</Text>
              {unavailableStaff.map((s, i) => {
                const isAssigned = currentDayAssigned.some(a => a.name === s.name);
                return (
                  <TouchableOpacity key={i} style={[styles.staffRow, { opacity: 0.6 }]} onPress={() => !isAssigned && addStaffToShift(s.name, true)} activeOpacity={isAssigned ? 1 : 0.6}>
                    <Text style={[styles.staffName, { color: COLORS.danger }]}>{s.name} ({s.type})</Text>
                    {isAssigned ? (
                      <TouchableOpacity style={styles.removeBtn} onPress={() => removeStaffFromShift(s.name)}><Text style={styles.removeBtnText}>外す</Text></TouchableOpacity>
                    ) : (
                      <View style={[styles.addBtn, {backgroundColor: '#999'}]}><Text style={styles.addBtnText}>追加</Text></View>
                    )}
                  </TouchableOpacity>
                );
              })}

              <View style={{height: 40}} />
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.saveBtn} onPress={saveDayShift}><Text style={styles.saveBtnText}>保存して閉じる</Text></TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* --- 時間変更＆候補追加モーダル --- */}
      <Modal visible={timePickerVisible} transparent animationType="slide">
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>{editingStaffName} の勤務時間</Text>

            {/* 開始/終了切り替えタブ */}
            <View style={styles.timeTargetRow}>
              <TouchableOpacity style={[styles.timeTargetBtn, timeSelectTarget === 'start' && styles.timeTargetBtnActive]} onPress={() => setTimeSelectTarget('start')}>
                <Text style={styles.timeTargetLabel}>開始時間</Text>
                <Text style={[styles.timeTargetValue, timeSelectTarget === 'start' && styles.timeTargetValueActive]}>{tempStart}</Text>
              </TouchableOpacity>
              <Text style={{fontSize:24, fontWeight:'bold', color:COLORS.textLight, marginHorizontal:8}}>〜</Text>
              <TouchableOpacity style={[styles.timeTargetBtn, timeSelectTarget === 'end' && styles.timeTargetBtnActive]} onPress={() => setTimeSelectTarget('end')}>
                <Text style={styles.timeTargetLabel}>終了時間</Text>
                <Text style={[styles.timeTargetValue, timeSelectTarget === 'end' && styles.timeTargetValueActive]}>{tempEnd}</Text>
              </TouchableOpacity>
            </View>

            {/* 候補ボタン（大きく、見やすく） */}
            {masterTimes.length > 0 && (
              <View style={{ marginBottom: 12 }}>
                <Text style={styles.addTimeTitle}>候補から選ぶ（長押しで削除）</Text>
                <View style={styles.masterTimesGrid}>
                  {masterTimes.map(t => (
                    <View key={t} style={{ position: 'relative' }}>
                      <TouchableOpacity
                        style={styles.masterTimeBtn}
                        onPress={() => handleMasterTimeSelect(t)}
                        onLongPress={() => {
                          const newTimes = masterTimes.filter(x => x !== t);
                          setMasterTimes(newTimes);
                          setDoc(doc(db, 'settings', 'master_data'), { workTimes: newTimes }, { merge: true });
                        }}
                        delayLongPress={500}
                      >
                        <Text style={styles.masterTimeText}>{t}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#fff', borderRadius: 8, zIndex: 1 }}
                        onPress={() => {
                          const newTimes = masterTimes.filter(x => x !== t);
                          setMasterTimes(newTimes);
                          setDoc(doc(db, 'settings', 'master_data'), { workTimes: newTimes }, { merge: true });
                        }}
                      >
                        <Ionicons name="close-circle" size={16} color="#E53935" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ドラムロール時間ピッカー（大きい・タップしやすい） */}
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.addTimeTitle}>時間を直接選ぶ</Text>
              <View style={styles.drumPickerRow}>
                {/* 開始 時 */}
                <View style={styles.drumCol}>
                  <Text style={styles.drumLabel}>開始 時</Text>
                  <ScrollView style={styles.drumScroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                    {HOURS.map(h => (
                      <TouchableOpacity key={`sh-${h}`} style={[styles.drumItem, newStartHour === h && styles.drumItemActive]} onPress={() => { setNewStartHour(h); setTempStart(`${String(h).padStart(2,'0')}:${String(newStartMinute).padStart(2,'0')}`); }}>
                        <Text style={[styles.drumItemText, newStartHour === h && styles.drumItemTextActive]}>{String(h).padStart(2,'0')}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
                <Text style={styles.drumColon}>:</Text>
                {/* 開始 分 */}
                <View style={styles.drumCol}>
                  <Text style={styles.drumLabel}>開始 分</Text>
                  <ScrollView style={styles.drumScroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                    {MINUTES.map(m => (
                      <TouchableOpacity key={`sm-${m}`} style={[styles.drumItem, newStartMinute === m && styles.drumItemActive]} onPress={() => { setNewStartMinute(m); setTempStart(`${String(newStartHour).padStart(2,'0')}:${String(m).padStart(2,'0')}`); }}>
                        <Text style={[styles.drumItemText, newStartMinute === m && styles.drumItemTextActive]}>{String(m).padStart(2,'0')}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                <Text style={styles.drumTilde}>〜</Text>

                {/* 終了 時 */}
                <View style={styles.drumCol}>
                  <Text style={styles.drumLabel}>終了 時</Text>
                  <ScrollView style={styles.drumScroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                    {HOURS.map(h => (
                      <TouchableOpacity key={`eh-${h}`} style={[styles.drumItem, newEndHour === h && styles.drumItemActive]} onPress={() => { setNewEndHour(h); setTempEnd(`${String(h).padStart(2,'0')}:${String(newEndMinute).padStart(2,'0')}`); }}>
                        <Text style={[styles.drumItemText, newEndHour === h && styles.drumItemTextActive]}>{String(h).padStart(2,'0')}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
                <Text style={styles.drumColon}>:</Text>
                {/* 終了 分 */}
                <View style={styles.drumCol}>
                  <Text style={styles.drumLabel}>終了 分</Text>
                  <ScrollView style={styles.drumScroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                    {MINUTES.map(m => (
                      <TouchableOpacity key={`em-${m}`} style={[styles.drumItem, newEndMinute === m && styles.drumItemActive]} onPress={() => { setNewEndMinute(m); setTempEnd(`${String(newEndHour).padStart(2,'0')}:${String(m).padStart(2,'0')}`); }}>
                        <Text style={[styles.drumItemText, newEndMinute === m && styles.drumItemTextActive]}>{String(m).padStart(2,'0')}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                {/* 候補として保存ボタン */}
                <TouchableOpacity style={styles.addOptionSubmit} onPress={handleAddMasterTime}>
                  <Ionicons name="bookmark" size={14} color={COLORS.white} />
                  <Text style={{color: COLORS.white, fontWeight: 'bold', fontSize: 11, marginTop: 2}}>保存</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={{flexDirection:'row', gap: 12, marginTop: 8}}>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: '#CCC'}]} onPress={()=>setTimePickerVisible(false)}><Text style={{fontWeight:'bold'}}>キャンセル</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: COLORS.primary}]} onPress={saveTimeEdit}><Text style={{color: COLORS.white, fontWeight:'bold'}}>変更を確定</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── 設定モーダル ── */}
      <Modal visible={settingsVisible} animationType="slide" transparent>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' }}>
          <View style={{ backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, maxHeight:'90%' }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, borderBottomWidth:1, borderColor:'#eee' }}>
              <Text style={{ fontSize:17, fontWeight:'bold', color:'#333' }}>⚙ 自動入力設定</Text>
              <TouchableOpacity onPress={() => setSettingsVisible(false)}>
                <Ionicons name="close" size={26} color="#333" />
              </TouchableOpacity>
            </View>
            {/* タブ */}
            <View style={{ flexDirection:'row', borderBottomWidth:1, borderColor:'#eee' }}>
              <TouchableOpacity
                style={{ flex:1, paddingVertical:12, alignItems:'center', borderBottomWidth:2, borderBottomColor: settingsTab==='dow' ? '#5B9BD5' : 'transparent' }}
                onPress={() => setSettingsTab('dow')}
              >
                <Text style={{ fontWeight:'bold', color: settingsTab==='dow' ? '#5B9BD5' : '#888' }}>曜日別設定</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex:1, paddingVertical:12, alignItems:'center', borderBottomWidth:2, borderBottomColor: settingsTab==='staff' ? '#5B9BD5' : 'transparent' }}
                onPress={() => setSettingsTab('staff')}
              >
                <Text style={{ fontWeight:'bold', color: settingsTab==='staff' ? '#5B9BD5' : '#888' }}>スタッフ別設定</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex:1, paddingVertical:12, alignItems:'center', borderBottomWidth:2, borderBottomColor: settingsTab==='order' ? '#5B9BD5' : 'transparent' }}
                onPress={() => {
                  if (pdfOrder.length === 0) setPdfOrder(allStaff.map(s => s.name));
                  setSettingsTab('order');
                }}
              >
                <Text style={{ fontWeight:'bold', color: settingsTab==='order' ? '#5B9BD5' : '#888' }}>表示順設定</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ padding:16 }}>

              {settingsTab === 'dow' && <>
              {/* 曜日別最大人数 */}
              <Text style={styles.settingSectionTitle}>曜日別 最大入力人数（稲熊除く）</Text>
              {(['月','火','水','木','金'] as const).map(dow => (
                <View key={dow} style={styles.settingRow}>
                  <Text style={styles.settingLabel}>{dow}曜日</Text>
                  <View style={{ flexDirection:'row', gap:6 }}>
                    {[1,2,3,4,5].map(n => (
                      <TouchableOpacity
                        key={n}
                        style={[styles.settingNumBtn, autoFillSettings.dayMaxCount[dow] === n && styles.settingNumBtnActive]}
                        onPress={() => saveAutoFillSettings({ ...autoFillSettings, dayMaxCount: { ...autoFillSettings.dayMaxCount, [dow]: n } })}
                      >
                        <Text style={[styles.settingNumText, autoFillSettings.dayMaxCount[dow] === n && { color:'#fff' }]}>{n}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}

              </>}

              {settingsTab === 'staff' && <>
              {/* スタッフ別設定 */}
              <Text style={styles.settingSectionTitle}>スタッフ別設定（優先順位・時間）</Text>
              <Text style={{ fontSize:11, color:'#888', marginBottom:8 }}>↑↓で優先順位を変更、ON/OFFで対象外に</Text>
              {autoFillSettings.staffSettings.map((s, idx) => (
                <View key={s.name} style={styles.settingStaffRow}>
                  <View style={{ flexDirection:'column', gap:2, marginRight:6 }}>
                    <TouchableOpacity
                      style={[styles.settingArrowBtn, idx === 0 && { opacity:0.3 }]}
                      disabled={idx === 0}
                      onPress={() => {
                        const arr = [...autoFillSettings.staffSettings];
                        [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
                        arr.forEach((x,i) => x.priority = i+1);
                        saveAutoFillSettings({ ...autoFillSettings, staffSettings: arr });
                      }}
                    ><Ionicons name="chevron-up" size={14} color="#555" /></TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.settingArrowBtn, idx === autoFillSettings.staffSettings.length-1 && { opacity:0.3 }]}
                      disabled={idx === autoFillSettings.staffSettings.length-1}
                      onPress={() => {
                        const arr = [...autoFillSettings.staffSettings];
                        [arr[idx], arr[idx+1]] = [arr[idx+1], arr[idx]];
                        arr.forEach((x,i) => x.priority = i+1);
                        saveAutoFillSettings({ ...autoFillSettings, staffSettings: arr });
                      }}
                    ><Ionicons name="chevron-down" size={14} color="#555" /></TouchableOpacity>
                  </View>
                  <Text style={styles.settingPriority}>{idx+1}</Text>
                  <TouchableOpacity
                    style={[styles.settingEnabledBtn, s.enabled && styles.settingEnabledBtnOn]}
                    onPress={() => {
                      const arr = autoFillSettings.staffSettings.map((x,i) => i===idx ? {...x, enabled:!x.enabled} : x);
                      saveAutoFillSettings({ ...autoFillSettings, staffSettings: arr });
                    }}
                  >
                    <Text style={{ fontSize:10, color: s.enabled ? '#fff' : '#999', fontWeight:'bold' }}>{s.enabled ? 'ON' : 'OFF'}</Text>
                  </TouchableOpacity>
                  <Text style={styles.settingStaffName}>{s.name}</Text>
                  <View style={{ flex:1 }}>
                    <View style={{ flexDirection:'row', gap:4, alignItems:'center' }}>
                      <Text style={styles.settingTimeLabel}>開始</Text>
                      <TextInput
                        style={styles.settingTimeInput}
                        value={s.start}
                        onChangeText={v => {
                          const arr = autoFillSettings.staffSettings.map((x,i) => i===idx ? {...x, start:v} : x);
                          setAutoFillSettings({ ...autoFillSettings, staffSettings: arr });
                        }}
                        placeholder="14:00"
                        placeholderTextColor="#bbb"
                        keyboardType="numbers-and-punctuation"
                      />
                      <Text style={styles.settingTimeLabel}>終了</Text>
                      <TextInput
                        style={styles.settingTimeInput}
                        value={s.end}
                        onChangeText={v => {
                          const arr = autoFillSettings.staffSettings.map((x,i) => i===idx ? {...x, end:v} : x);
                          setAutoFillSettings({ ...autoFillSettings, staffSettings: arr });
                        }}
                        placeholder="18:30"
                        placeholderTextColor="#bbb"
                        keyboardType="numbers-and-punctuation"
                      />
                    </View>
                  </View>
                </View>
              ))}
              {/* 保存ボタン */}
              <TouchableOpacity
                style={{ backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8, marginBottom: 4 }}
                onPress={() => {
                  saveAutoFillSettings(autoFillSettings);
                  Alert.alert('保存完了', 'スタッフ設定を保存しました');
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 15 }}>設定を保存する</Text>
              </TouchableOpacity>
              </>}

              {settingsTab === 'order' && <>
              <Text style={styles.settingSectionTitle}>PDF・シフト表 表示順</Text>
              <Text style={{ fontSize:11, color:'#888', marginBottom:12 }}>↑↓でPDF出力時のスタッフ行の並び順を変更</Text>
              {pdfOrder.map((name, idx) => (
                <View key={name} style={{ flexDirection:'row', alignItems:'center', backgroundColor:'#F8F8F8', borderRadius:10, padding:12, marginBottom:6, borderWidth:1, borderColor:'#EEE' }}>
                  <View style={{ flexDirection:'column', gap:2, marginRight:10 }}>
                    <TouchableOpacity
                      style={[styles.settingArrowBtn, idx === 0 && { opacity:0.3 }]}
                      disabled={idx === 0}
                      onPress={() => {
                        const arr = [...pdfOrder];
                        [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
                        setPdfOrder(arr);
                      }}
                    ><Ionicons name="chevron-up" size={14} color="#555" /></TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.settingArrowBtn, idx === pdfOrder.length-1 && { opacity:0.3 }]}
                      disabled={idx === pdfOrder.length-1}
                      onPress={() => {
                        const arr = [...pdfOrder];
                        [arr[idx], arr[idx+1]] = [arr[idx+1], arr[idx]];
                        setPdfOrder(arr);
                      }}
                    ><Ionicons name="chevron-down" size={14} color="#555" /></TouchableOpacity>
                  </View>
                  <Text style={{ fontSize:14, fontWeight:'bold', color:'#333', flex:1 }}>{idx+1}. {name}</Text>
                </View>
              ))}
              <TouchableOpacity
                style={{ backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 }}
                onPress={() => {
                  saveAutoFillSettings({ ...autoFillSettings, pdfOrder });
                  Alert.alert('保存完了', '表示順を保存しました');
                }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 15 }}>表示順を保存する</Text>
              </TouchableOpacity>
              </>}
              <View style={{ height:40 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      <AdminBottomNav active="shift" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#FFF8F0', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 8 },
  pdfBtnText: { color: COLORS.white, fontWeight: 'bold', marginLeft: 3, fontSize: 11 },
  
  monthSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  monthText: { fontSize: 20, fontWeight: 'bold', marginHorizontal: 12 },
  
  toggleTimeBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E0FFFF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#AFEEEE' },
  toggleTimeText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 12 },

  calHeaderRow: { flexDirection: 'row', marginBottom: 4 },
  calWeekText: { width: '14.2%', textAlign: 'center', fontSize: 13, fontWeight: 'bold' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  
  calCellEmpty: { width: '14.28%', minHeight: 80 },
  calCell: { width: '14.28%', minHeight: 90, borderWidth: 0.5, borderColor: COLORS.border, padding: 4, backgroundColor: COLORS.white },
  
  cellTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  calDayText: { fontSize: 12, fontWeight: 'bold' },
  availableCountText: { fontSize: 9, color: COLORS.textLight, marginBottom: 2 },
  cellCountText: { fontSize: 10, color: COLORS.primary, fontWeight: 'bold' },
  
  cellStaffText: { fontSize: 9, color: '#333', marginBottom: 4, lineHeight: 12 },
  cellStaffRow: { marginBottom: 3, backgroundColor: '#F0F8FF', borderRadius: 4, paddingHorizontal: 3, paddingVertical: 2 },
  cellStaffName: { fontSize: 9, fontWeight: 'bold', color: '#333', lineHeight: 12 },
  cellStaffTime: { fontSize: 8, color: COLORS.primary, lineHeight: 11 },
  
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
  assignedDeleteBtn: { backgroundColor: '#FFF0F0', borderWidth: 1, borderColor: '#FFE0E0', padding: 8, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  
  modalFooter: { padding: 20, borderTopWidth: 1, borderColor: COLORS.border },
  saveBtn: { backgroundColor: COLORS.primary, padding: 16, borderRadius: 12, alignItems: 'center' },
  saveBtnText: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  pickerContent: { width: '100%', backgroundColor: COLORS.white, borderRadius: 16, padding: 20, maxHeight: '92%' },
  pickerTitle: { fontSize: 17, fontWeight: 'bold', textAlign: 'center', marginBottom: 14, color: COLORS.text },
  
  timeTargetRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: 14 },
  timeTargetBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderWidth: 2, borderColor: 'transparent', borderRadius: 12, backgroundColor: '#F5F5F5', marginHorizontal: 4 },
  timeTargetBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '10' },
  timeTargetLabel: { fontSize: 11, color: COLORS.textLight, fontWeight: 'bold', marginBottom: 2 },
  timeTargetValue: { fontSize: 22, fontWeight: 'bold', color: COLORS.text },
  timeTargetValueActive: { color: COLORS.primary },
  
  masterTimesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start', marginTop: 6 },
  masterTimeBtnWrap: { position: 'relative', flexDirection: 'row', alignItems: 'center' },
  masterTimeDeleteBtn: { marginLeft: -8, marginTop: -16, zIndex: 1 },
  masterTimeBtn: { backgroundColor: '#F0F8FF', borderWidth: 1.5, borderColor: COLORS.primary + '40', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center' },
  masterTimeText: { fontSize: 15, fontWeight: 'bold', color: COLORS.primary },
  drumPickerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  drumCol: { flex: 1, alignItems: 'center' },
  drumLabel: { fontSize: 10, color: COLORS.textLight, fontWeight: 'bold', marginBottom: 4, textAlign: 'center' },
  drumScroll: { height: 160, width: '100%', backgroundColor: '#FAFAFA', borderRadius: 8, borderWidth: 1, borderColor: COLORS.border },
  drumItem: { paddingVertical: 12, alignItems: 'center', borderRadius: 6, marginHorizontal: 2, marginVertical: 1 },
  drumItemActive: { backgroundColor: COLORS.primary },
  drumItemText: { fontSize: 18, fontWeight: 'bold', color: COLORS.textLight },
  drumItemTextActive: { color: COLORS.white, fontSize: 20 },
  drumColon: { fontSize: 22, fontWeight: 'bold', color: COLORS.text, paddingBottom: 70, marginHorizontal: 1 },
  drumTilde: { fontSize: 16, fontWeight: 'bold', color: COLORS.textLight, paddingBottom: 70, marginHorizontal: 2 },
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
  addOptionSubmit: { backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 14, borderRadius: 6, marginLeft: 6, marginBottom: 0 },
  settingSectionTitle: { fontSize: 13, fontWeight: 'bold', color: '#444', marginBottom: 10 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#F5F5F5', borderRadius: 10 },
  settingLabel: { fontSize: 14, fontWeight: 'bold', color: '#333', width: 44 },
  settingNumBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: '#CCC', alignItems: 'center', justifyContent: 'center' },
  settingNumBtnActive: { backgroundColor: '#5B9BD5', borderColor: '#5B9BD5' },
  settingNumText: { fontSize: 13, fontWeight: 'bold', color: '#555' },
  settingStaffRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, padding: 8, backgroundColor: '#F8F8F8', borderRadius: 12 },
  settingArrowBtn: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEE', borderRadius: 4 },
  settingPriority: { fontSize: 13, fontWeight: 'bold', color: '#888', width: 18, textAlign: 'center' },
  settingEnabledBtn: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, backgroundColor: '#DDD' },
  settingEnabledBtnOn: { backgroundColor: '#4CAF50' },
  settingStaffName: { fontSize: 13, fontWeight: 'bold', color: '#333', width: 50 },
  settingTimeLabel: { fontSize: 10, color: '#888' },
  settingTimeInput: { borderWidth: 1, borderColor: '#CCC', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, fontSize: 12, width: 56, textAlign: 'center', color: '#333' },
  modalBtn: { flex: 1, padding: 14, alignItems: 'center', borderRadius: 8 },

  // ★ 1画面完全フィット(土日細い版・時間表示改行対応)のスタイル
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
  fabDelete: { position: 'absolute', bottom: ADMIN_BOTTOM_NAV_HEIGHT + 14, right: 16, width: 160, height: 68, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 8, zIndex: 100 },
  fabDeleteText: { color: COLORS.white, fontWeight: 'bold', fontSize: 13, marginLeft: 6 },
  fabAutoFill: { position: 'absolute', bottom: ADMIN_BOTTOM_NAV_HEIGHT + 94, right: 16, width: 160, height: 68, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 8, zIndex: 100 },
  fabAutoFillText: { color: COLORS.white, fontWeight: 'bold', fontSize: 13, marginLeft: 6 },
  fabImg: { width: '100%', height: '100%' },
  autoFillBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  autoFillBtnText: { color: COLORS.white, fontSize: 12, fontWeight: 'bold', marginLeft: 4 },
})
