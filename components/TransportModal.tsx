import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { db } from '../firebase';

const COLORS = {
  primary: '#5B9BD5', white: '#FFFFFF', text: '#333333',
  textLight: '#888888', border: '#E0E0E0', danger: '#E53935',
  background: '#F4F6F9',
};
const STAFF_COLORS = [
  '#FF8A65','#FFB74D','#FFD54F','#AED581','#4DB6AC',
  '#4FC3F7','#9575CD','#F06292','#A1887F','#90A4AE',
];

type Block = { key: string; label: string; count: number; time?: string; type?: 'school' | 'lesson'; nameOnly?: string };
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
  const [lastWeekModalVisible, setLastWeekModalVisible] = useState(false);
  const [lastWeekEntries, setLastWeekEntries] = useState<StaffEntry[]>([]);
  const [lastWeekLoading, setLastWeekLoading] = useState(false);
  const [slotDetail, setSlotDetail] = useState<{sIdx:number; tIdx:number} | null>(null);
  const [showTimeline, setShowTimeline] = useState(false); // タイムライン（全体確認）の表示状態

  const date = new Date(dateStr + 'T00:00:00');
  const dateLabel = `${date.getMonth()+1}月${date.getDate()}日(${DOW_JP[date.getDay()]})`;
  const lastWeekDate = new Date(date);
  lastWeekDate.setDate(date.getDate() - 7);

  // ブロック生成（時間順、種類や時間情報を分離）
  const blocks: Block[] = [];
  Object.entries(attendance.schools || {}).forEach(([school, times]) => {
    Object.entries(times).forEach(([time, kids]) => {
      blocks.push({ 
        key: `${school}_${time}`, 
        label: `${school} ${time}`, 
        nameOnly: school, 
        time, 
        count: (kids as any[]).length, 
        type: 'school' 
      });
    });
  });
  Object.entries(attendance.lessons || {}).forEach(([lessonKey, kids]) => {
    const timeMatch = lessonKey.match(/^\d{1,2}:\d{2}/);
    const time = timeMatch ? timeMatch[0] : '';
    const nameOnly = lessonKey.replace(time, '').trim() || lessonKey;
    blocks.push({ 
      key: lessonKey, 
      label: lessonKey, 
      nameOnly, 
      time, 
      count: (kids as any[]).length, 
      type: 'lesson' 
    });
  });
  blocks.sort((a, b) => {
    const ta = a.time || '';
    const tb = b.time || '';
    return ta.localeCompare(tb);
  });

  useEffect(() => {
    if (!visible) return;
    setSelectedBlock(null);
    setShowTimeline(false); // モーダルを開き直した時は常に編集モードから開始
    
    // シフト作成画面で出勤が確定しているメンバーの名前リスト ＋ 「送迎しない」
    const shiftNames = shiftStaff.map(s => s.name);
    const allNames = [...shiftNames, '送迎しない'];
    
    let loadedEntries: StaffEntry[] = [];
    if (assignments?.entries) {
      try {
        const parsed = JSON.parse(assignments.entries);
        if (parsed.entries) {
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

    const syncedEntries = allNames.map(name => {
      const existing = loadedEntries.find(e => e.staffName === name);
      if (existing) return existing;
      return { staffName: name, trips: [{ tripIndex: 0, blockKeys: [] }] };
    });

    setStaffEntries(syncedEntries);
  }, [visible, shiftStaff, assignments]);

  const save = async (entries: StaffEntry[]) => {
    setStaffEntries(entries);
    await onAssign(dateStr, 'entries', JSON.stringify({ entries }));
  };

  // 先週の同日データをFirestoreから取得してポップアップ表示
  const openLastWeekModal = async () => {
    setLastWeekLoading(true);
    setLastWeekModalVisible(true);
    try {
      const lwDateStr = `${lastWeekDate.getFullYear()}-${String(lastWeekDate.getMonth()+1).padStart(2,'0')}-${String(lastWeekDate.getDate()).padStart(2,'0')}`;
      const snap = await getDoc(doc(db, 'pickup_assignments', lwDateStr));
      if (snap.exists() && snap.data()?.entries) {
        const parsed = JSON.parse(snap.data().entries);
        setLastWeekEntries(parsed.entries || []);
      } else {
        setLastWeekEntries([]);
      }
    } catch (e) {
      setLastWeekEntries([]);
    } finally {
      setLastWeekLoading(false);
    }
  };

  // 担当済みブロックkeyのセット
  const assignedBlockKeys = new Set(staffEntries.flatMap(e => e.trips.flatMap(t => t.blockKeys)));

  // スタッフのスロットにブロックを追加（空きスロットに入れる、なければ新規追加）
  const assignBlockToStaff = (sIdx: number, tIdx: number | null, blockKey: string) => {
    const updated = staffEntries.map((e, i) => {
      if (i !== sIdx) return e;
      if (tIdx !== null) {
        return { ...e, trips: e.trips.map((t, ti) =>
          ti !== tIdx ? t : { ...t, blockKeys: [...new Set([...t.blockKeys, blockKey])] }
        )};
      }
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
        return { ...e, trips: e.trips.filter((_, ti) => ti !== tIdx).map((t, ti) => ({ ...t, tripIndex: ti })) };
      }
      return { ...e, trips: e.trips.map((t, ti) => ti !== tIdx ? t : { ...t, blockKeys: newKeys }) };
    });
    save(updated);
  };

  // ── タイムライン表示ビューのレンダリング ──
  const renderTimelineView = () => {
    const START_HOUR = 11; // 11時から
    const END_HOUR = 21;   // 21時まで
    const COL_WIDTH = 28;  // 15分あたりの幅(px) = 1時間で112px
    const TIMELINE_WIDTH = (END_HOUR - START_HOUR) * 4 * COL_WIDTH;
    const ROW_HEIGHT = 65;

    // 型エラーを解決するため、numberの配列であることを明示
    const timeHeaders: number[] = [];
    for (let h = START_HOUR; h < END_HOUR; h++) timeHeaders.push(h);

    const getOffsetLeft = (timeStr?: string) => {
      if (!timeStr) return null;
      const [h, m] = timeStr.split(':').map(Number);
      const offsetMins = (h - START_HOUR) * 60 + m;
      return (offsetMins / 15) * COL_WIDTH;
    };

    return (
      <View style={{ flex: 1, backgroundColor: '#FFF' }}>
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <ScrollView horizontal style={{ flex: 1 }} showsHorizontalScrollIndicator={false}>
            <View style={{ paddingBottom: 20 }}>
              {/* 時間のヘッダー */}
              <View style={{ flexDirection: 'row', height: 30, borderBottomWidth: 1, borderColor: '#CCC', marginLeft: 100 }}>
                {timeHeaders.map(h => (
                  <View key={h} style={{ width: COL_WIDTH * 4, borderLeftWidth: 1, borderColor: '#EEE', paddingLeft: 4 }}>
                    <Text style={{ fontSize: 11, color: '#888', fontWeight: 'bold' }}>{h}:00</Text>
                  </View>
                ))}
              </View>

              {/* 各スタッフのタイムライン */}
              {staffEntries.map((entry, sIdx) => {
                if (entry.staffName === '送迎しない') return null;

                const shift = shiftStaff.find(s => s.name === entry.staffName);
                const startX = getOffsetLeft(shift?.start);
                const endX = getOffsetLeft(shift?.end);
                let shiftLeft = 0;
                let shiftWidth = 0;
                if (startX !== null && endX !== null && endX > startX) {
                  shiftLeft = Math.max(0, startX);
                  shiftWidth = endX - shiftLeft;
                }

                return (
                  <View key={sIdx} style={{ flexDirection: 'row', height: ROW_HEIGHT, borderBottomWidth: 1, borderColor: '#EEE' }}>
                    {/* 左側：スタッフ名とシフト時間 */}
                    <View style={{ width: 100, justifyContent: 'center', paddingLeft: 10, borderRightWidth: 1, borderColor: '#CCC', backgroundColor: '#FAFAFA', zIndex: 2 }}>
                      <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#333' }}>{entry.staffName}</Text>
                      <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{shift?.start || '-'} ~ {shift?.end || '-'}</Text>
                    </View>

                    {/* 右側：タイムライン領域 */}
                    <View style={{ width: TIMELINE_WIDTH, position: 'relative' }}>
                      {/* 1時間ごとの背景の縦線 */}
                      {timeHeaders.map((h, i) => (
                        <View key={h} style={{ position: 'absolute', left: i * COL_WIDTH * 4, width: COL_WIDTH * 4, height: ROW_HEIGHT, borderLeftWidth: 1, borderColor: '#F5F5F5' }} />
                      ))}

                      {/* シフト時間のハイライト（薄い黄色） */}
                      {shiftWidth > 0 && (
                        <View style={{ position: 'absolute', left: shiftLeft, width: shiftWidth, height: ROW_HEIGHT, backgroundColor: '#FFF9C4', opacity: 0.6 }} />
                      )}

                      {/* 送迎のブロック（青・緑） */}
                      {entry.trips.map((trip, tIdx) => {
                        if (trip.blockKeys.length === 0) return null;
                        
                        let minOffset = 9999;
                        let type = 'school';
                        let labels: string[] = [];
                        
                        trip.blockKeys.forEach(bk => {
                          const blk = blocks.find(b => b.key === bk);
                          if (blk && blk.time) {
                            const offset = getOffsetLeft(blk.time);
                            if (offset !== null && offset < minOffset) minOffset = offset;
                            if (blk.type === 'lesson') type = 'lesson';
                            labels.push(`${blk.nameOnly} ${blk.time}(${blk.count}名)`);
                          }
                        });

                        if (minOffset === 9999) return null;
                        minOffset = Math.max(0, minOffset);

                        const bgColor = type === 'school' ? '#E3F2FD' : '#E8F5E9';
                        const borderColor = type === 'school' ? '#64B5F6' : '#81C784';

                        return (
                          <View key={tIdx} style={{
                            position: 'absolute', left: minOffset, top: 6, height: ROW_HEIGHT - 12,
                            width: COL_WIDTH * 3.5, // 約50分枠
                            backgroundColor: bgColor, borderWidth: 1, borderColor, borderRadius: 6,
                            padding: 4, justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 1, elevation: 1
                          }}>
                             <Text style={{ fontSize: 9, lineHeight: 12, color: '#333', fontWeight: 'bold' }} numberOfLines={3} adjustsFontSizeToFit>
                               {labels.join('\n')}
                             </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </ScrollView>
      </View>
    );
  };

  return (
    <>
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* ヘッダー */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{showTimeline ? '🕒 全体確認' : `🚗 ${dateLabel}`}</Text>
            
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {showTimeline ? (
                // タイムライン表示中のボタン
                <TouchableOpacity style={[styles.lastWeekBtn, { borderColor: COLORS.primary }]} onPress={() => setShowTimeline(false)}>
                  <Text style={[styles.lastWeekBtnText, { color: COLORS.primary }]}>編集に戻る</Text>
                </TouchableOpacity>
              ) : (
                // 割り当て編集中のボタン
                <>
                  <TouchableOpacity style={[styles.lastWeekBtn, { borderColor: '#9C27B0' }]} onPress={() => setShowTimeline(true)}>
                    <Text style={[styles.lastWeekBtnText, { color: '#9C27B0' }]}>全体確認</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.lastWeekBtn, showLastWeek && styles.lastWeekBtnActive]} onPress={openLastWeekModal}>
                    <Text style={[styles.lastWeekBtnText, showLastWeek && { color: '#fff' }]}>先週参照</Text>
                  </TouchableOpacity>
                </>
              )}
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
          </View>


          {/* ビューの切り替え */}
          {showTimeline ? (
            renderTimelineView()
          ) : (
            <View style={styles.body}>
              {/* 左：スタッフ一覧（編集モード） */}
              <ScrollView style={styles.staffScroll} showsVerticalScrollIndicator={false}>
                {staffEntries.map((entry, sIdx) => {
                  const isNoTransport = entry.staffName === '送迎しない';
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
                        {/* 新しい回を追加するボタン（selectedBlock選択中のみ） */}
                        {selectedBlock && !isNoTransport && (
                          <TouchableOpacity
                            style={[styles.tripSlot, styles.tripSlotAdd]}
                            onPress={() => assignBlockToStaff(sIdx, null, selectedBlock.key)}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="add-circle-outline" size={16} color={COLORS.primary} />
                            <Text style={styles.addSlotText}>{TRIP_LABELS[entry.trips.length] || `${entry.trips.length+1}回目`}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })}
                <View style={{ height: 60 }} />
              </ScrollView>

              {/* 右：送迎先（編集モード） */}
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
          )}
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

    {/* 先週参照ポップアップ */}
    <Modal visible={lastWeekModalVisible} transparent animationType="fade">
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <View style={{ width: '100%', maxHeight: '80%', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' }}>
          {/* ヘッダー */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#EDE7F6', borderBottomWidth: 1, borderColor: '#D1C4E9' }}>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#4A148C' }}>
              {lastWeekDate.getMonth()+1}/{lastWeekDate.getDate()}（{DOW_JP[lastWeekDate.getDay()]}）の送迎担当
            </Text>
            <TouchableOpacity onPress={() => setLastWeekModalVisible(false)}>
              <Ionicons name="close-circle" size={28} color="#9C27B0" />
            </TouchableOpacity>
          </View>

          {lastWeekLoading ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <Text style={{ color: '#888', fontSize: 14 }}>読み込み中...</Text>
            </View>
          ) : lastWeekEntries.length === 0 ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <Ionicons name="calendar-outline" size={40} color="#ccc" />
              <Text style={{ color: '#888', fontSize: 14, marginTop: 12 }}>先週のデータはありません</Text>
            </View>
          ) : (
            <ScrollView style={{ padding: 16 }}>
              {lastWeekEntries.map((entry, idx) => (
                <View key={entry.staffName} style={{ marginBottom: 14, padding: 12, backgroundColor: '#F3E5F5', borderRadius: 12, borderLeftWidth: 4, borderLeftColor: STAFF_COLORS[idx % STAFF_COLORS.length] }}>
                  <Text style={{ fontWeight: 'bold', fontSize: 15, color: '#4A148C', marginBottom: 8 }}>{entry.staffName}</Text>
                  {entry.trips.map((trip, tIdx) => (
                    trip.blockKeys.length > 0 ? (
                      <View key={tIdx} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 }}>
                        <Text style={{ fontSize: 12, color: '#7B1FA2', fontWeight: 'bold', width: 40 }}>{TRIP_LABELS[tIdx] || `${tIdx+1}回`}</Text>
                        <View style={{ flex: 1 }}>
                          {trip.blockKeys.map((bk: string) => (
                            <Text key={bk} style={{ fontSize: 13, color: '#555' }}>• {bk.replace(/_/g, ' ')}</Text>
                          ))}
                        </View>
                      </View>
                    ) : null
                  ))}
                  {entry.trips.every(t => t.blockKeys.length === 0) && (
                    <Text style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>担当なし</Text>
                  )}
                </View>
              ))}
              <View style={{ height: 20 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
    </>
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