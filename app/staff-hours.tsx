import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, getDocs } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { useRequireRole } from '../hooks/useRequireRole';
import { navigateHome } from '../utils/navigationHome';

type ShiftRecord = { dateStr: string; start: string; end: string };
type StaffSummary = {
  name: string;
  totalMinutes: number;
  days: number;
  records: ShiftRecord[];
};

const MONTHS = (() => {
  const result = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  return result;
})();

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
};

const formatHours = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
};

export default function StaffHoursScreen() {
  const { verified, checking } = useRequireRole('admin');

  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[0]);
  const [summaries, setSummaries] = useState<StaffSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [year, month] = selectedMonth.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();

        // その月の全assigned_shiftsを取得
        const snap = await getDocs(collection(db, 'assigned_shifts'));
        const staffMap = new Map<string, ShiftRecord[]>();

        snap.forEach(d => {
          const dateStr = d.id; // YYYY-MM-DD
          if (!dateStr.startsWith(selectedMonth)) return;
          const data = d.data();
          const dow = new Date(dateStr + 'T00:00:00').getDay();
          if (dow === 0 || dow === 6) return; // 土日除外

          (data.staff || []).forEach((s: any) => {
            if (!s.name || !s.start || !s.end) return;
            if (!staffMap.has(s.name)) staffMap.set(s.name, []);
            staffMap.get(s.name)!.push({ dateStr, start: s.start, end: s.end });
          });
        });

        const result: StaffSummary[] = [];
        staffMap.forEach((records, name) => {
          const totalMinutes = records.reduce((sum, r) => {
            const diff = toMinutes(r.end) - toMinutes(r.start);
            return sum + (diff > 0 ? diff : 0);
          }, 0);
          result.push({ name, totalMinutes, days: records.length, records: records.sort((a,b) => a.dateStr.localeCompare(b.dateStr)) });
        });

        result.sort((a, b) => b.totalMinutes - a.totalMinutes);
        setSummaries(result);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [selectedMonth]);

  const totalAllMinutes = summaries.reduce((sum, s) => sum + s.totalMinutes, 0);

  if (checking || !verified) return null;
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigateHome(router)}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>スタッフ別合計勤務時間</Text>
      </View>

      {/* 月選択 */}
      <View style={styles.monthRow}>
        {MONTHS.map(m => (
          <TouchableOpacity
            key={m}
            style={[styles.monthBtn, selectedMonth === m && styles.monthBtnActive]}
            onPress={() => setSelectedMonth(m)}
          >
            <Text style={[styles.monthBtnText, selectedMonth === m && { color: '#fff' }]}>
              {m.replace('-', '年')}月
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 合計 */}
      <View style={styles.totalBar}>
        <Text style={styles.totalLabel}>{selectedMonth.replace('-','年')}月 全スタッフ合計</Text>
        <Text style={styles.totalHours}>{formatHours(totalAllMinutes)}</Text>
        <Text style={styles.totalCount}>({summaries.length}名)</Text>
      </View>

      {loading ? (
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <Text style={{ color: COLORS.textLight }}>読み込み中...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
          {summaries.length === 0 ? (
            <Text style={{ textAlign:'center', color:COLORS.textLight, marginTop:40 }}>
              この月のシフトデータがありません
            </Text>
          ) : (
            summaries.map((s, idx) => {
              const isOpen = expanded === s.name;
              const barWidth = totalAllMinutes > 0 ? s.totalMinutes / totalAllMinutes : 0;
              return (
                <TouchableOpacity
                  key={s.name}
                  style={styles.card}
                  onPress={() => setExpanded(isOpen ? null : s.name)}
                  activeOpacity={0.8}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.rankBadge}>
                      <Text style={styles.rankText}>{idx + 1}</Text>
                    </View>
                    <Text style={styles.staffName}>{s.name}</Text>
                    <View style={{ flex: 1 }} />
                    <View style={styles.daysBadge}>
                      <Text style={styles.daysText}>{s.days}日</Text>
                    </View>
                    <Text style={styles.hoursText}>{formatHours(s.totalMinutes)}</Text>
                    <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textLight} />
                  </View>

                  {/* 時間バー */}
                  <View style={styles.barBg}>
                    <View style={[styles.barFill, { width: `${barWidth * 100}%` as any }]} />
                  </View>

                  {/* 詳細（展開時） */}
                  {isOpen && (
                    <View style={styles.detailBox}>
                      <View style={styles.detailSummaryRow}>
                        <Text style={styles.detailSummaryText}>平均: {s.days > 0 ? formatHours(Math.round(s.totalMinutes / s.days)) : '-'}/日</Text>
                      </View>
                      {s.records.map(r => {
                        const mins = toMinutes(r.end) - toMinutes(r.start);
                        const d = new Date(r.dateStr + 'T00:00:00');
                        const dow = ['日','月','火','水','木','金','土'][d.getDay()];
                        return (
                          <View key={r.dateStr} style={styles.detailRow}>
                            <Text style={styles.detailDate}>
                              {d.getMonth()+1}/{d.getDate()}({dow})
                            </Text>
                            <Text style={styles.detailTime}>{r.start} - {r.end}</Text>
                            <Text style={styles.detailHours}>{formatHours(mins)}</Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFF8F0', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  monthRow: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 8, paddingHorizontal: 12, gap: 6 },
  monthBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border },
  monthBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  monthBtnText: { fontSize: 12, fontWeight: 'bold', color: COLORS.text },
  totalBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#E8F4FD', gap: 8 },
  totalLabel: { fontSize: 12, color: COLORS.primary, fontWeight: 'bold', flex: 1 },
  totalHours: { fontSize: 18, fontWeight: 'bold', color: COLORS.primary },
  totalCount: { fontSize: 12, color: '#aaa' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 14, shadowColor: '#000', shadowOffset: { width:0, height:1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  rankBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  rankText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  staffName: { fontSize: 15, fontWeight: 'bold', color: COLORS.text },
  daysBadge: { backgroundColor: '#EEF5FF', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  daysText: { fontSize: 11, color: COLORS.primary, fontWeight: 'bold' },
  hoursText: { fontSize: 16, fontWeight: 'bold', color: '#333', marginRight: 4 },
  barBg: { height: 6, backgroundColor: '#F0F0F0', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: COLORS.primary, borderRadius: 3 },
  detailBox: { marginTop: 10, borderTopWidth: 1, borderColor: '#F0F0F0', paddingTop: 8 },
  detailSummaryRow: { marginBottom: 6 },
  detailSummaryText: { fontSize: 12, color: COLORS.textLight, fontWeight: 'bold' },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  detailDate: { width: 72, fontSize: 12, color: COLORS.text, fontWeight: 'bold' },
  detailTime: { flex: 1, fontSize: 12, color: COLORS.textLight },
  detailHours: { fontSize: 12, fontWeight: 'bold', color: COLORS.primary },
});
