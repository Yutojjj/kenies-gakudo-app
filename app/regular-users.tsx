import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, doc, getDocs, query, setDoc } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { useRequireRole } from '../hooks/useRequireRole';

type Kid = {
  id: string; name: string; nicknameKana: string;
  school: string; grade: string;
  usageType: string; days: Record<string, boolean>;
  parentName?: string;
};

const DOW = ['月','火','水','木','金'] as const;
const SCHOOL_COLORS = [
  '#FFE0B2','#F8BBD0','#DCEDC8','#B3E5FC','#E1BEE7',
  '#FFE082','#B2DFDB','#FFCCBC','#C5CAE9','#F0F4C3',
];
const getSchoolColor = (school: string) => {
  let hash = 0;
  for (let i = 0; i < school.length; i++) hash = school.charCodeAt(i) + ((hash << 5) - hash);
  return SCHOOL_COLORS[Math.abs(hash) % SCHOOL_COLORS.length];
};

const GRADE_ORDER: Record<string, number> = {
  '小1':1,'小2':2,'小3':3,'小4':4,'小5':5,'小6':6,'卒業':7,
};
const gradeVal = (g: string) => GRADE_ORDER[g] ?? 99;

export default function RegularUsersScreen() {
  const { verified } = useRequireRole('admin');
  if (!verified) return null;

  const router = useRouter();
  const [kids, setKids] = useState<Kid[]>([]);
  const [filterDow, setFilterDow] = useState<string>('全て');
  const [filterCount, setFilterCount] = useState<number>(0);
  const [expandedSchools, setExpandedSchools] = useState<Set<string>>(new Set());
  const [editKid, setEditKid] = useState<Kid | null>(null);
  const [editDays, setEditDays] = useState<Record<string, boolean>>({月:false,火:false,水:false,木:false,金:false});

  useEffect(() => {
    const load = async () => {
      const snap = await getDocs(query(collection(db, 'accounts')));
      const all: Kid[] = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.role === 'user') {
          const kid: Kid = {
            id: d.id, name: data.name || '', nicknameKana: data.nicknameKana || '',
            school: data.school || '', grade: data.grade || '',
            usageType: data.usageType || '', days: data.days || {},
          };
          if (kid.usageType === '定期利用') all.push(kid);
          // 兄弟
          (data.siblings || []).forEach((sib: any) => {
            if (sib.usageType === '定期利用') {
              all.push({
                id: `${d.id}_sib_${sib.name}`,
                name: sib.name || '', nicknameKana: sib.nicknameKana || '',
                school: sib.school || '', grade: sib.grade || '',
                usageType: '定期利用', days: sib.days || {},
                parentName: data.name,
              });
            }
          });
        }
      });
      all.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      setKids(all);
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    return kids.filter(k => {
      const activeDays = Object.entries(k.days).filter(([_, v]) => v).map(([d]) => d);
      if (filterDow !== '全て' && !activeDays.includes(filterDow)) return false;
      if (filterCount > 0 && activeDays.length !== filterCount) return false;
      return true;
    });
  }, [kids, filterDow, filterCount]);

  // 曜日別集計
  const dowCounts = useMemo(() => {
    const counts: Record<string, number> = { 全て: kids.length };
    DOW.forEach(d => {
      counts[d] = kids.filter(k => k.days[d]).length;
    });
    return counts;
  }, [kids]);

  const saveEdit = async () => {
    if (!editKid) return;
    try {
      // 本人かsiblingか判断（idに__sib__が含まれる場合はsibling）
      if (editKid.id.includes('__sib__')) {
        const parts = editKid.id.split('__sib__');
        const parentId = parts[0];
        const sibIdx = parseInt(parts[1]);
        const snap = await getDocs(query(collection(db, 'accounts')));
        const parentDoc = snap.docs.find(d => d.id === parentId);
        if (parentDoc) {
          const siblings = [...(parentDoc.data().siblings || [])];
          siblings[sibIdx] = { ...siblings[sibIdx], days: editDays };
          await setDoc(doc(db, 'accounts', parentId), { siblings }, { merge: true });
        }
      } else {
        await setDoc(doc(db, 'accounts', editKid.id), { days: editDays }, { merge: true });
      }
      // ローカル更新
      setKids(prev => prev.map(k => k.id === editKid.id ? { ...k, days: editDays } : k));
      setEditKid(null);
    } catch (e: any) {
      Alert.alert('エラー', e?.message || '保存失敗');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>定期利用者一覧</Text>
        <Text style={styles.headerCount}>{filtered.length}名</Text>
      </View>

      {/* 曜日フィルター */}
      <View style={styles.filterRow}>
        {['全て', ...DOW].map(d => (
          <TouchableOpacity
            key={d}
            style={[styles.filterBtn, filterDow === d && styles.filterBtnActive]}
            onPress={() => setFilterDow(d)}
          >
            <Text style={[styles.filterBtnText, filterDow === d && styles.filterBtnTextActive]}>
              {d}
            </Text>
            <Text style={[styles.filterCount, filterDow === d && { color: '#fff' }]}>
              {dowCounts[d] ?? 0}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 週回数フィルター */}
      <View style={styles.countFilterRow}>
        <Text style={styles.countFilterLabel}>週何回：</Text>
        {[0,1,2,3,4,5].map(n => (
          <TouchableOpacity
            key={n}
            style={[styles.countBtn, filterCount === n && styles.countBtnActive]}
            onPress={() => setFilterCount(n)}
          >
            <Text style={[styles.countBtnText, filterCount === n && { color: '#fff' }]}>
              {n === 0 ? '全て' : `${n}回`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 一覧 */}
      <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
        {filtered.length === 0 ? (
          <Text style={{ textAlign: 'center', color: COLORS.textLight, marginTop: 40 }}>該当する利用者がいません</Text>
        ) : (
          (() => {
            const schoolMap = new Map<string, Kid[]>();
            filtered.forEach(k => {
              const s = k.school || '（学校未設定）';
              if (!schoolMap.has(s)) schoolMap.set(s, []);
              schoolMap.get(s)!.push(k);
            });
            schoolMap.forEach(arr => arr.sort((a,b) => gradeVal(a.grade) - gradeVal(b.grade)));
            const schools = [...schoolMap.keys()].sort();
            // 学校を3列グリッドで並べる
            return (
              <View style={styles.schoolGrid}>
                {schools.map(school => {
                  const kids_ = schoolMap.get(school)!;
                  const isOpen = expandedSchools.has(school);
                  return (
                    <View key={school} style={[styles.schoolCard, { backgroundColor: getSchoolColor(school) }]}>
                      <TouchableOpacity
                        style={styles.schoolHeader}
                        onPress={() => {
                          const next = new Set(expandedSchools);
                          isOpen ? next.delete(school) : next.add(school);
                          setExpandedSchools(next);
                        }}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="school-outline" size={14} color="#333" />
                        <Text style={styles.schoolHeaderText} numberOfLines={1}>{school}</Text>
                        <View style={styles.schoolHeaderBadge}>
                          <Text style={styles.schoolHeaderCount}>{kids_.length}名</Text>
                        </View>
                        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textLight} />
                      </TouchableOpacity>

                      {isOpen && (
                        <View style={{ paddingHorizontal: 8, paddingBottom: 8 }}>
                          {kids_.map(kid => {
                            const activeDays = Object.entries(kid.days).filter(([_, v]) => v).map(([d]) => d);
                            const count = activeDays.length;
                            return (
                              <TouchableOpacity
                                key={kid.id}
                                style={styles.kidCard}
                                onPress={() => { setEditKid(kid); setEditDays({...kid.days}); }}
                                activeOpacity={0.8}
                              >
                                <View style={{ flex:1 }}>
                                  <Text style={styles.kidSub} numberOfLines={1}>{kid.grade}{kid.parentName ? ' 兄弟' : ''}</Text>
                                  <Text style={styles.kidName} numberOfLines={1}>{kid.name}</Text>
                                </View>
                                <View style={{ alignItems:'flex-end', gap:3 }}>
                                  <View style={styles.dayBadgesRow}>
                                    {DOW.map(d => (
                                      <View key={d} style={[styles.dayBadgeSmall, kid.days[d] && styles.dayBadgeActive]}>
                                        <Text style={[styles.dayBadgeTextSmall, kid.days[d] && styles.dayBadgeTextActive]}>{d}</Text>
                                      </View>
                                    ))}
                                  </View>
                                  <View style={styles.countBadge}>
                                    <Text style={styles.countBadgeText}>週{count}回</Text>
                                  </View>
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })()
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
      {/* 編集モーダル */}
      <Modal visible={!!editKid} transparent animationType="fade">
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'center', alignItems:'center' }}>
          <View style={{ backgroundColor:'#fff', borderRadius:20, padding:20, width:'85%' }}>
            <Text style={{ fontSize:17, fontWeight:'bold', color:'#333', marginBottom:4 }}>{editKid?.name}</Text>
            <Text style={{ fontSize:13, color:'#888', marginBottom:16 }}>{editKid?.school} {editKid?.grade}</Text>

            <Text style={{ fontSize:13, fontWeight:'bold', color:'#555', marginBottom:10 }}>利用曜日</Text>
            <View style={{ flexDirection:'row', gap:8, justifyContent:'center', marginBottom:20 }}>
              {DOW.map(d => (
                <TouchableOpacity
                  key={d}
                  style={{ width:44, height:44, borderRadius:22, borderWidth:2,
                    borderColor: editDays[d] ? COLORS.primary : '#DDD',
                    backgroundColor: editDays[d] ? COLORS.primary : '#F8F8F8',
                    alignItems:'center', justifyContent:'center' }}
                  onPress={() => setEditDays(prev => ({ ...prev, [d]: !prev[d] }))}
                >
                  <Text style={{ fontWeight:'bold', color: editDays[d] ? '#fff' : '#888', fontSize:14 }}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ textAlign:'center', color:'#888', fontSize:12, marginBottom:16 }}>
              週{Object.values(editDays).filter(Boolean).length}回
            </Text>

            <View style={{ flexDirection:'row', gap:10 }}>
              <TouchableOpacity
                style={{ flex:1, paddingVertical:12, borderRadius:12, borderWidth:1.5, borderColor:'#ccc', alignItems:'center' }}
                onPress={() => setEditKid(null)}
              >
                <Text style={{ color:'#666', fontWeight:'bold' }}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex:2, paddingVertical:12, borderRadius:12, backgroundColor:COLORS.primary, alignItems:'center' }}
                onPress={saveEdit}
              >
                <Text style={{ color:'#fff', fontWeight:'bold' }}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  headerCount: { fontSize: 14, color: '#5D4037', fontWeight: 'bold' },
  filterRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  filterBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', minWidth: 44 },
  filterBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterBtnText: { fontSize: 12, fontWeight: 'bold', color: COLORS.text },
  filterBtnTextActive: { color: '#fff' },
  filterCount: { fontSize: 10, color: COLORS.textLight, marginTop: 1 },
  countFilterRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, gap: 6 },
  countFilterLabel: { fontSize: 12, color: COLORS.textLight, fontWeight: 'bold' },
  countBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border },
  countBtnActive: { backgroundColor: COLORS.secondary, borderColor: COLORS.secondary },
  countBtnText: { fontSize: 11, fontWeight: 'bold', color: COLORS.text },
  schoolGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  schoolCard: { width: '48%', backgroundColor: '#fff', borderRadius: 16, shadowColor: '#000', shadowOffset: { width:0, height:2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 3, overflow: 'hidden' },
  schoolHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  schoolHeaderText: { fontSize: 15, fontWeight: 'bold', color: '#222', flex: 1 },
  schoolHeaderBadge: { backgroundColor: '#EEF5FF', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  schoolHeaderCount: { fontSize: 12, color: COLORS.primary, fontWeight: 'bold' },
  kidGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, paddingBottom: 12, gap: 8 },
  kidGridCard: { width: '31%', backgroundColor: '#F8F8F8', borderRadius: 12, padding: 10, alignItems: 'center', gap: 4 },
  dayBadgeSmall: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  dayBadgeTextSmall: { fontSize: 8, fontWeight: 'bold', color: COLORS.textLight },
  kidCard: { backgroundColor: '#fff', borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 },
  kidCardLeft: { flex: 1 },
  kidName: { fontSize: 15, fontWeight: 'bold', color: COLORS.text },
  kidSub: { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  kidCardRight: { alignItems: 'flex-end', gap: 6 },
  dayBadgesRow: { flexDirection: 'row', gap: 3 },
  dayBadge: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  dayBadgeActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dayBadgeText: { fontSize: 9, fontWeight: 'bold', color: COLORS.textLight },
  dayBadgeTextActive: { color: '#fff' },
  countBadge: { backgroundColor: COLORS.secondary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  countBadgeText: { fontSize: 11, color: '#fff', fontWeight: 'bold' },
});