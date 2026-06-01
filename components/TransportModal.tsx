import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const COLORS = {
  primary: '#5B9BD5', white: '#FFFFFF', text: '#333333',
  textLight: '#888888', border: '#E0E0E0', danger: '#E53935',
  background: '#F4F6F9',
};
const STAFF_COLORS = [
  '#FF8A65','#FFB74D','#FFD54F','#AED581','#4DB6AC',
  '#4FC3F7','#9575CD','#F06292','#A1887F','#90A4AE',
];

type Block = { key: string; label: string; count: number };
type TripSlot = { tripIndex: number; blockKeys: string[] };
type StaffEntry = { staffName: string; trips: TripSlot[] };
type Props = {
  visible: boolean; dateStr: string; onClose: () => void;
  attendance: { schools: Record<string, Record<string, any[]>>; lessons: Record<string, any[]>; totalCount: number };
  shiftStaff: { name: string; start: string; end: string }[];
  allStaffList: string[];
  assignments: Record<string, any>;
  onAssign: (dateStr: string, blockKey: string, staffName: string) => Promise<void>;
  publicHolidays: Record<string, string>;
};
const DOW_JP = ['日','月','火','水','木','金','土'];
const TRIP_LABELS = ['1回目','2回目','3回目','4回目','5回目'];

export default function TransportModal({
  visible, dateStr, onClose, attendance, shiftStaff, assignments, onAssign,
}: Props) {
  const [staffEntries, setStaffEntries] = useState<StaffEntry[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [showLastWeek, setShowLastWeek] = useState(false);
  const [slotDetail, setSlotDetail] = useState<{sIdx:number; tIdx:number} | null>(null);

  const date = new Date(dateStr + 'T00:00:00');
  const dateLabel = `${date.getMonth()+1}月${date.getDate()}日(${DOW_JP[date.getDay()]})`;
  const lastWeekDate = new Date(date);
  lastWeekDate.setDate(date.getDate() - 7);

  // ブロック生成（時間順）
  const blocks: Block[] = [];
  Object.entries(attendance.schools).forEach(([school, times]) => {
    Object.entries(times).forEach(([time, kids]) => {
      blocks.push({ key: `${school}_${time}`, label: `${school} ${time}`, count: (kids as any[]).length });
    });
  });
  blocks.sort((a, b) => {
    const ta = a.key.split('_').pop() || '';
    const tb = b.key.split('_').pop() || '';
    return ta.localeCompare(tb);
  });

  useEffect(() => {
    if (!visible) return;
    setSelectedBlock(null);
    
    // シフト作成画面で出勤が確定しているメンバーの名前リスト ＋ 「送迎しない」
    const shiftNames = shiftStaff.map(s => s.name);
    const allNames = [...shiftNames, '送迎しない'];
    
    let loadedEntries: StaffEntry[] = [];
    if (assignments?.entries) {
      try {
        const parsed = JSON.parse(assignments.entries);
        if (parsed.entries) {
          // blockKey(旧形式)をblockKeysに変換して読み込み
          loadedEntries = parsed.entries.map((e: any) => ({
            ...e,
            trips: e.trips.map((t: any) => ({
              ...t,
              blockKeys: t.blockKeys || (t.blockKey ? [t.blockKey] : [])
            }))
          }));
        }
      } catch {}
    }

    // 保存済みのデータがあっても、シフト出勤メンバー＋「送迎しない」のみにフィルタリングし、順番も同期させる
    const syncedEntries = allNames.map(name => {
      const existing = loadedEntries.find(e => e.staffName === name);
      if (existing) {
        return existing;
      }
      // 新しく追加されたメンバーや「送迎しない」項目は空の枠を作成
      return { staffName: name, trips: [{ tripIndex: 0, blockKeys: [] }] };
    });

    setStaffEntries(syncedEntries);
  }, [visible, shiftStaff, assignments]);

  const save = async (entries: StaffEntry[]) => {
    setStaffEntries(entries);
    await onAssign(dateStr, 'entries', JSON.stringify({ entries }));
  };

  // 担当済みブロックkeyのセット
  const assignedBlockKeys = new Set(staffEntries.flatMap(e => e.trips.flatMap(t => t.blockKeys)));

  // スタッフのスロットにブロックを追加（空きスロットに入れる、なければ新規追加）
  const assignBlockToStaff = (sIdx: number, tIdx: number | null, blockKey: string) => {
    const updated = staffEntries.map((e, i) => {
      if (i !== sIdx) return e;
      if (tIdx !== null) {
        // 指定スロットのblockKeysに追加（重複除外）
        return { ...e, trips: e.trips.map((t, ti) =>
          ti !== tIdx ? t : { ...t, blockKeys: [...new Set([...t.blockKeys, blockKey])] }
        )};
      }
      // 新しいスロットを追加
      return { ...e, trips: [...e.trips, { tripIndex: e.trips.length, blockKeys: [blockKey] }] };
    });
    save(updated);
    setSelectedBlock(null);
  };

  const removeBlockFromTrip = (sIdx: number, tIdx: number, blockKey: string) => {
    const updated = staffEntries.map((e, i) => {
      if (i !== sIdx) return e;
      const newKeys = e.trips[tIdx].blockKeys.filter(k => k !== blockKey);
      if (newKeys.length === 0 && e.trips.length > 1) {
        // blockKeysが空になったスロットを削除
        return { ...e, trips: e.trips.filter((_, ti) => ti !== tIdx).map((t, ti) => ({ ...t, tripIndex: ti })) };
      }
      return { ...e, trips: e.trips.map((t, ti) => ti !== tIdx ? t : { ...t, blockKeys: newKeys }) };
    });
    save(updated);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* ヘッダー */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>🚗 {dateLabel}</Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TouchableOpacity style={[styles.lastWeekBtn, showLastWeek && styles.lastWeekBtnActive]} onPress={() => setShowLastWeek(v => !v)}>
                <Text style={[styles.lastWeekBtnText, showLastWeek && { color: '#fff' }]}>先週参照</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
          </View>

          {showLastWeek && (
            <View style={styles.lastWeekBanner}>
              <Text style={styles.lastWeekBannerText}>※ {lastWeekDate.getMonth()+1}/{lastWeekDate.getDate()} の担当を参照中</Text>
            </View>
          )}

          <View style={styles.body}>
          {/* 左：スタッフ一覧 */}
          <ScrollView style={styles.staffScroll} showsVerticalScrollIndicator={false}>
            {staffEntries.map((entry, sIdx) => {
              const isNoTransport = entry.staffName === '送迎しない';
              // 「送迎しない」の場合はグレーの色を使用
              const color = isNoTransport ? '#9E9E9E' : STAFF_COLORS[sIdx % STAFF_COLORS.length];
              
              return (
                <View key={entry.staffName} style={[styles.staffSection, { borderLeftColor: color }]}>
                  <View style={styles.staffNameRow}>
                    <View style={[styles.staffDot, { backgroundColor: color }]} />
                    <Text style={[styles.staffName, isNoTransport && { color: '#757575' }]}>{entry.staffName}</Text>
                  </View>

                  <View style={styles.tripsRow}>
                    {entry.trips.map((trip, tIdx) => {


                      return (
                        <TouchableOpacity
                          key={tIdx}
                          style={[
                            styles.tripSlot,
                            trip.blockKeys.length > 0 && { borderColor: color, backgroundColor: color + '11', borderStyle: 'solid' },
                            selectedBlock && styles.tripSlotSelectable,
                          ]}
                          onPress={() => {
                            if (selectedBlock) {
                              assignBlockToStaff(sIdx, tIdx, selectedBlock.key);
                            } else if (trip.blockKeys.length > 0) {
                              setSlotDetail({ sIdx, tIdx });
                            }
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.tripLabelText}>{TRIP_LABELS[tIdx] || `${tIdx+1}回`}</Text>
                          {trip.blockKeys.length > 0 ? (
                            <View style={{ flex: 1 }}>
                              {trip.blockKeys.map((bk) => {
                                const blk = blocks.find(b => b.key === bk);
                                const bkIdx = blk ? blocks.indexOf(blk) : 0;
                                const bkColor = STAFF_COLORS[bkIdx % STAFF_COLORS.length];
                                return blk ? (
                                  <Text key={bk} style={[styles.slotFilledText, { color: bkColor }]} numberOfLines={1}>
                                    {blk.label}（{blk.count}名）
                                  </Text>
                                ) : null;
                              })}
                            </View>
                          ) : (
                            <Text style={[styles.slotEmptyText, selectedBlock && styles.slotSelectableText]}>
                              {selectedBlock ? '👆 タップ' : '空き'}
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}

                    {/* 新しいスロットに追加（selectedBlock時のみ） */}
                    {selectedBlock && (
                      <TouchableOpacity
                        style={[styles.tripSlot, styles.tripSlotAdd]}
                        onPress={() => assignBlockToStaff(sIdx, null, selectedBlock.key)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="add-circle-outline" size={16} color={COLORS.primary} />
                        <Text style={styles.addSlotText}>追加</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
            <View style={{ height: 60 }} />
          </ScrollView>

          {/* 右：送迎先 */}
          <View style={styles.rightPanel}>
            <Text style={styles.rightTitle}>送迎先</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {blocks.map((block, bIdx) => {
                const bColor = STAFF_COLORS[bIdx % STAFF_COLORS.length];
                const isAssigned = assignedBlockKeys.has(block.key);
                const isSelected = selectedBlock?.key === block.key;
                if (isAssigned) return null;
                return (
                  <TouchableOpacity
                    key={block.key}
                    style={[
                      styles.blockChip,
                      { borderColor: bColor, backgroundColor: bColor + '22' },
                      isSelected && { borderWidth: 3, backgroundColor: bColor + '44' },
                    ]}
                    onPress={() => setSelectedBlock(isSelected ? null : block)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.blockChipText, { color: bColor }]}>{block.label}</Text>
                    <View style={[styles.countBadge, { backgroundColor: bColor }]}>
                      <Text style={styles.countText}>{block.count}名</Text>
                    </View>
                    {isSelected && (
                      <View style={styles.selectedMark}>
                        <Text style={styles.selectedMarkText}>選択中</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
              {[...assignedBlockKeys].length === blocks.length && blocks.length > 0 && (
                <View style={{ alignItems: 'center', marginTop: 8 }}>
                  <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                  <Text style={{ fontSize: 10, color: '#4CAF50', fontWeight: 'bold', marginTop: 2 }}>全完了</Text>
                </View>
              )}
            </ScrollView>
          </View>
          </View>
        </View>

        {/* スロット詳細モーダル */}
        {slotDetail && (() => {
          const entry = staffEntries[slotDetail.sIdx];
          const trip = entry?.trips[slotDetail.tIdx];
          if (!entry || !trip) return null;
          return (
            <View style={styles.detailOverlay}>
              <View style={styles.detailPanel}>
                <View style={styles.detailHeader}>
                  <Text style={styles.detailTitle}>{entry.staffName} {TRIP_LABELS[slotDetail.tIdx]}</Text>
                  <TouchableOpacity onPress={() => setSlotDetail(null)}>
                    <Ionicons name="close" size={22} color={COLORS.text} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ maxHeight: 260 }}>
                  {trip.blockKeys.map((bk, bki) => {
                    const blk = blocks.find(b => b.key === bk);
                    const bkColor = blk ? STAFF_COLORS[blocks.indexOf(blk) % STAFF_COLORS.length] : '#aaa';
                    return (
                      <View key={bk} style={[styles.detailRow, { borderLeftColor: bkColor }]}>
                        <Text style={[styles.detailRowText, { color: bkColor }]}>
                          {blk ? `${blk.label}（${blk.count}名）` : bk}
                        </Text>
                        <View style={styles.detailRowActions}>
                          {bki > 0 && (
                            <TouchableOpacity
                              style={styles.detailActionBtn}
                              onPress={() => {
                                const newKeys = [...trip.blockKeys];
                                [newKeys[bki-1], newKeys[bki]] = [newKeys[bki], newKeys[bki-1]];
                                const updated = staffEntries.map((e, i) => i !== slotDetail.sIdx ? e : {
                                  ...e, trips: e.trips.map((t, ti) => ti !== slotDetail.tIdx ? t : { ...t, blockKeys: newKeys })
                                });
                                save(updated);
                              }}
                            >
                              <Ionicons name="arrow-up" size={16} color={COLORS.primary} />
                            </TouchableOpacity>
                          )}
                          {bki < trip.blockKeys.length - 1 && (
                            <TouchableOpacity
                              style={styles.detailActionBtn}
                              onPress={() => {
                                const newKeys = [...trip.blockKeys];
                                [newKeys[bki], newKeys[bki+1]] = [newKeys[bki+1], newKeys[bki]];
                                const updated = staffEntries.map((e, i) => i !== slotDetail.sIdx ? e : {
                                  ...e, trips: e.trips.map((t, ti) => ti !== slotDetail.tIdx ? t : { ...t, blockKeys: newKeys })
                                });
                                save(updated);
                              }}
                            >
                              <Ionicons name="arrow-down" size={16} color={COLORS.primary} />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            style={styles.detailActionBtn}
                            onPress={() => { removeBlockFromTrip(slotDetail.sIdx, slotDetail.tIdx, bk); }}
                          >
                            <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
                <TouchableOpacity style={styles.detailCloseBtn} onPress={() => setSlotDetail(null)}>
                  <Text style={styles.detailCloseBtnText}>閉じる</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })()}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  container: { backgroundColor: COLORS.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '92%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderBottomWidth: 1, borderColor: COLORS.border },
  headerTitle: { fontSize: 15, fontWeight: 'bold', color: COLORS.text, flex: 1 },
  closeBtn: { padding: 4 },
  lastWeekBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: COLORS.primary },
  lastWeekBtnActive: { backgroundColor: COLORS.primary },
  lastWeekBtnText: { fontSize: 11, color: COLORS.primary, fontWeight: 'bold' },
  lastWeekBanner: { backgroundColor: '#FFF9C4', padding: 7, alignItems: 'center' },
  lastWeekBannerText: { fontSize: 11, color: '#856404', fontWeight: 'bold' },

  body: { flex: 1, flexDirection: 'row' },
  rightPanel: { width: 110, backgroundColor: '#fff', borderLeftWidth: 1, borderColor: COLORS.border, padding: 8 },
  rightTitle: { fontSize: 12, fontWeight: 'bold', color: '#555', textAlign: 'center', marginBottom: 8 },
  blockChip: { borderRadius: 12, padding: 8, marginBottom: 8, borderWidth: 2, alignItems: 'center' },
  blockChipText: { fontSize: 12, fontWeight: 'bold', textAlign: 'center' },
  countBadge: { marginTop: 3, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  countText: { fontSize: 10, color: '#fff', fontWeight: 'bold' },
  selectedMark: { marginTop: 3, backgroundColor: '#FF9800', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  selectedMarkText: { fontSize: 9, color: '#fff', fontWeight: 'bold' },
  allDoneChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8 },
  allDoneText: { fontSize: 12, color: '#4CAF50', fontWeight: 'bold' },

  // スタッフ
  staffScroll: { flex: 1, padding: 10, backgroundColor: COLORS.background },
  staffSection: { backgroundColor: '#fff', borderRadius: 14, marginBottom: 10, padding: 10, borderLeftWidth: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 3, elevation: 2 },
  staffNameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  staffDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  staffName: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  tripsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tripSlot: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#CCC', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8, minWidth: 80 },
  tripSlotSelectable: { borderColor: '#FF9800', borderStyle: 'solid', backgroundColor: '#FFF8E1' },
  tripSlotAdd: { borderColor: COLORS.primary, borderStyle: 'dashed', backgroundColor: '#F0F8FF' },
  tripLabelText: { fontSize: 9, fontWeight: 'bold', color: COLORS.textLight },
  slotFilledText: { flex: 1, fontSize: 10, fontWeight: 'bold', color: COLORS.text },
  slotEmptyText: { fontSize: 10, color: '#BBB' },
  slotSelectableText: { color: '#E65100', fontWeight: 'bold' },
  addSlotText: { fontSize: 10, color: COLORS.primary, fontWeight: 'bold' },
  detailOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  detailPanel: { backgroundColor: '#fff', borderRadius: 20, padding: 18, width: '85%', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 10 },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  detailTitle: { fontSize: 15, fontWeight: 'bold', color: COLORS.text },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 10, borderLeftWidth: 4, borderRadius: 8, backgroundColor: '#F8F8F8', marginBottom: 6 },
  detailRowText: { flex: 1, fontSize: 13, fontWeight: 'bold' },
  detailRowActions: { flexDirection: 'row', gap: 6 },
  detailActionBtn: { padding: 4 },
  detailCloseBtn: { marginTop: 14, backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  detailCloseBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
});