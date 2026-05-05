import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type Staff = { id: string, name: string };
type AssignedStaff = { name: string, start: string, end: string };

export default function ShiftViewScreen() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name: string }>();
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [requests, setRequests] = useState<Record<string, string>>({});
  const [assignedShifts, setAssignedShifts] = useState<Record<string, AssignedStaff[]>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});

  const [showOnlyMine, setShowOnlyMine] = useState(false);

  useEffect(() => {
    const fetchHolidays = async () => {
      try {
        const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
        const data = await res.json();
        setPublicHolidays(data);
      } catch (e) {
        console.warn('祝日API取得失敗', e);
      }
    };
    fetchHolidays();

    const fetchStaff = async () => {
      const q = query(collection(db, 'accounts'), where('role', '==', 'staff'));
      const snap = await getDocs(q);
      const staffList = snap.docs.map(d => ({ id: d.id, name: d.data().name }));
      setAllStaff(staffList);
    };
    fetchStaff();

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

    return () => { reqUnsub(); asUnsub(); };
  }, []);

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
  
  const generateWeeksForSpreadsheet = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ day: i, dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
    }
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    return weeks;
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
        // 幅指定を%にして自動調整
        thDates += `<th style="background:${bg}; color:${color}; border:1px solid #333; width:3%;">${i}</th>`;
      }

      const staffToExport = showOnlyMine ? allStaff.filter(s => s.name === name) : allStaff;
      let staffRows = '';
      staffToExport.forEach(staff => {
        let rowHtml = `<tr class="staff-row"><th style="background:#FFC0CB; border:1px solid #333; text-align:center; white-space:nowrap; width:6%; padding:2px;">${staff.name}</th>`;
        for (let i = 1; i <= daysInMonth; i++) {
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
          const assigned = assignedShifts[dateStr]?.find(s => s.name === staff.name);
          const req = requests[`${staff.name}_${dateStr}`];
          if (assigned) {
            rowHtml += `<td style="background:#FFD700; border:1px solid #333; font-weight:bold;">${assigned.start}<br>-${assigned.end}</td>`;
          } else if (req && req.includes('✕')) {
            rowHtml += `<td style="background:#D3D3D3; border:1px solid #333; color:#333;">✕</td>`;
          } else {
            rowHtml += `<td style="border:1px solid #333; background:#FFF;"></td>`;
          }
        }
        rowHtml += `</tr>`;
        staffRows += rowHtml;
      });

      // HTML/CSS設定: カラー強制反映＆A4完全フィット
      const html = `
        <html><head><style>
          /* 1. インク節約設定を無視して色を完全に出力する */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          /* 2. 余白を小さくし、A4横に設定 */
          @page { size: A4 landscape; margin: 5mm; }
          
          /* 3. A4一枚に絶対収めるためのコンテナ設定 */
          html, body {
            margin: 0; padding: 0; width: 100%; height: 100%;
            font-family: sans-serif; box-sizing: border-box; overflow: hidden;
          }
          /* 表全体の高さを100%にすることで、人数が増えても自動で1枚に縮小される */
          table {
            width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; text-align: center;
          }
          th, td {
            border: 1px solid #333; word-wrap: break-word; padding: 1px; line-height: 1.1; overflow: hidden;
          }
          .top-header td {
            font-weight: bold; font-size: 14px; text-align: center; height: 24px; border: 1px solid #333;
          }
          .date-row th { font-size: 10px; height: 20px; }
          .staff-row td { font-size: 8px; }
          .staff-row th { font-size: 9px; }
        </style></head><body>
          <table>
            <tr class="top-header">
              <td style="background:#B0C4DE;">シフト表</td>
              <td colspan="2" style="background:#E6E6FA;">${year}年</td>
              <td colspan="4" style="background:#FFDAB9; font-size: 16px;">${month}月</td>
              <td colspan="${daysInMonth - 6}" style="background:#F0F0F0; text-align: right; padding-right: 10px; font-size:10px; font-weight:normal;">出力日: ${new Date().toLocaleDateString('ja-JP')}</td>
            </tr>
            <tr class="date-row"><th style="background:#FFF3E0; border:1px solid #333;">名前 \\ 日付</th>${thDates}</tr>
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

  const weeks = ['日', '月', '火', '水', '木', '金', '土'];
  const spreadsheetWeeks = generateWeeksForSpreadsheet();

  const displayStaff = showOnlyMine ? allStaff.filter(s => s.name === name) : allStaff;

  return (
    <SafeAreaView style={styles.ssModalContainer}>
      <View style={styles.ssModalHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.ssModalTitle}>シフト表</Text>
        <TouchableOpacity onPress={exportPDF} style={styles.pdfBtn}>
          <Ionicons name="document-text" size={20} color={COLORS.white} />
          <Text style={styles.pdfBtnText}>PDF出力</Text>
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

                {displayStaff.map(staff => (
                  <View key={staff.id} style={styles.ssRow}>
                    <View style={[styles.ssNameCell, { width: '16%', backgroundColor: staff.name === name ? '#FFDAB9' : '#FFC0CB' }]}>
                      <Text style={[styles.ssNameText, staff.name === name && { color: COLORS.primary }]} numberOfLines={1} adjustsFontSizeToFit>{staff.name}</Text>
                    </View>
                    {week.map((day, dIdx) => {
                      let content = '';
                      let bgColor = '#FFFFFF';
                      let isBold = false;
                      const cellWidth = (dIdx === 0 || dIdx === 6) ? '6%' : '14.4%';
                      
                      if (day) {
                        const assigned = assignedShifts[day.dateStr]?.find(s => s.name === staff.name);
                        const req = requests[`${staff.name}_${day.dateStr}`];
                        
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
            <View style={{height: 100}} />
          </View>
        </ScrollView>
      </View>

      <TouchableOpacity style={styles.fab} onPress={() => setShowOnlyMine(!showOnlyMine)}>
        <Ionicons name={showOnlyMine ? "people" : "person"} size={24} color={COLORS.white} />
        <Text style={styles.fabText}>{showOnlyMine ? '全体を見る' : '自分のみ'}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  ssModalContainer: { flex: 1, backgroundColor: COLORS.background },
  ssModalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 12 },
  ssModalTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
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
  
  ssNameCell: { borderWidth: 1, borderColor: '#666', justifyContent: 'center', alignItems: 'center', paddingVertical: 6 },
  ssNameText: { fontSize: 10, fontWeight: 'bold', color: '#333', textAlign: 'center', paddingHorizontal: 2 },
  
  ssDataCell: { borderWidth: 1, borderColor: '#666', justifyContent: 'center', alignItems: 'center', paddingVertical: 4 },
  ssDataText: { fontSize: 9, color: '#333', textAlign: 'center', lineHeight: 11 },

  fab: { position: 'absolute', right: 20, bottom: 40, backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 30, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  fabText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16, marginLeft: 8 },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  pdfBtnText: { color: COLORS.white, fontWeight: 'bold', marginLeft: 4, fontSize: 12 },
});