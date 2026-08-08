import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

type Block = { key: string; label: string; count: number; time?: string; type?: 'school' | 'lesson'; nameOnly?: string; kids?: any[] };
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

const escapeHtml = (value: any) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

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
        kids: kids as any[],
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
      kids: kids as any[],
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

  const getTimelinePrintRows = () => {
    const parseGradeOrder = (grade?: string) => {
      const text = String(grade || '');
      const match = text.match(/[1-6１-６一二三四五六]/);
      if (!match) return 99;
      const gradeMap: Record<string, number> = {
        '1': 1, '１': 1, '一': 1,
        '2': 2, '２': 2, '二': 2,
        '3': 3, '３': 3, '三': 3,
        '4': 4, '４': 4, '四': 4,
        '5': 5, '５': 5, '五': 5,
        '6': 6, '６': 6, '六': 6,
      };
      return gradeMap[match[0]] ?? 99;
    };

    const assignmentMap = new Map<string, { staffName: string; tripLabel: string }>();
    staffEntries.forEach((entry) => {
      if (entry.staffName === '送迎しない') return;
      entry.trips.forEach((trip, tIdx) => {
        trip.blockKeys.forEach((blockKey) => {
          assignmentMap.set(blockKey, {
            staffName: entry.staffName,
            tripLabel: TRIP_LABELS[tIdx] || `${tIdx + 1}回目`,
          });
        });
      });
    });

    return blocks.map((block) => {
      const assignment = assignmentMap.get(block.key);
      return {
        time: block.time || '-',
        typeLabel: block.type === 'lesson' ? '習い事' : 'お迎え',
        name: block.nameOnly || block.label,
        count: block.count,
        staffName: assignment?.staffName || '未割当',
        tripLabel: assignment?.tripLabel || '-',
        kids: [...(block.kids || [])]
          .sort((a: any, b: any) => {
            const gradeDiff = parseGradeOrder(a.grade) - parseGradeOrder(b.grade);
            if (gradeDiff !== 0) return gradeDiff;
            return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
          })
          .map((kid: any) => {
            const grade = kid.grade ? `（${kid.grade}）` : '';
            return `${kid.name || ''}${grade}`;
          }).filter(Boolean),
      };
    }).sort((a, b) => `${a.time}${a.name}`.localeCompare(`${b.time}${b.name}`));
  };

  const getRoomStaffCounts = (startHour: number, endHour: number) => {
    const slotCount = (endHour - startHour) * 4;
    const getSlotBoundary = (timeStr?: string, roundUp = false) => {
      if (!timeStr) return null;
      const [hour, minute] = timeStr.split(':').map(Number);
      if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
      const raw = (hour - startHour) * 4 + (roundUp ? Math.ceil(minute / 15) : Math.floor(minute / 15));
      return Math.max(0, Math.min(slotCount, raw));
    };

    return Array.from({ length: slotCount }, (_, slotIndex) => {
      return staffEntries.filter((entry) => {
        if (entry.staffName === '送迎しない') return false;

        const shift = shiftStaff.find((staff) => staff.name === entry.staffName);
        const shiftStart = getSlotBoundary(shift?.start);
        const shiftEnd = getSlotBoundary(shift?.end, true);
        if (shiftStart === null || shiftEnd === null || slotIndex < shiftStart || slotIndex >= shiftEnd) {
          return false;
        }

        const isOnTransport = entry.trips.some((trip) => trip.blockKeys.some((blockKey) => {
          const block = blocks.find((item) => item.key === blockKey);
          if ((block?.nameOnly || block?.label || '').includes('スイミング')) return false;
          const transportStart = getSlotBoundary(block?.time);
          if (transportStart === null) return false;
          // タイムライン上の送迎枠と同じ45分間を外出扱いにする。
          return slotIndex >= transportStart && slotIndex < transportStart + 3;
        }));

        return !isOnTransport;
      }).length;
    });
  };

  const printTimeline = () => {
    if (Platform.OS !== 'web') {
      Alert.alert('印刷', '印刷はWeb版またはPWA版で利用できます。');
      return;
    }

    const browserWindow = (globalThis as any).window;
    const browserDocument = (globalThis as any).document;
    if (!browserWindow || !browserDocument?.createElement) {
      Alert.alert('印刷', 'この環境では印刷画面を開けませんでした。');
      return;
    }

    const rows = getTimelinePrintRows();
    const renderPrintRows = (targetRows: typeof rows) => targetRows.map((row) => {
        const rowClass = row.name.includes('スイミング')
          ? 'row-swimming'
          : row.typeLabel === '習い事'
            ? 'row-lesson'
            : 'row-pickup';
        return `
        <tr class="${rowClass}">
          <td class="time">${escapeHtml(row.time)}</td>
          <td class="type-cell ${row.typeLabel === '習い事' ? 'type-lesson' : 'type-pickup'}">${escapeHtml(row.typeLabel)}</td>
          <td class="name">${escapeHtml(row.name)}</td>
          <td class="count">${escapeHtml(row.count)}名</td>
          <td>${escapeHtml(row.staffName)}</td>
          <td class="kids">${escapeHtml(row.kids.join('、') || '-')}</td>
        </tr>
      `;
      }).join('');
    const renderDestinationTable = (targetRows: typeof rows) => `
      <table>
        <thead>
          <tr>
            <th style="width:10%">時刻</th>
            <th style="width:11%">種別</th>
            <th style="width:20%">行き先</th>
            <th style="width:9%">人数</th>
            <th style="width:14%">担当</th>
            <th>児童名</th>
          </tr>
        </thead>
        <tbody>${renderPrintRows(targetRows)}</tbody>
      </table>
    `;
    const destinationSplitIndex = Math.ceil(rows.length / 2);
    const destinationTablesHtml = rows.length > 0
      ? `<div class="destination-grid">
          ${renderDestinationTable(rows.slice(0, destinationSplitIndex))}
          ${renderDestinationTable(rows.slice(destinationSplitIndex))}
        </div>`
      : '<div class="empty destination-empty">この日の送迎予定はありません</div>';

    const PRINT_START_HOUR = 11;
    const PRINT_END_HOUR = 21;
    const PRINT_SLOT_COUNT = (PRINT_END_HOUR - PRINT_START_HOUR) * 4;
    const getPrintSlotIndex = (timeStr?: string) => {
      if (!timeStr) return null;
      const [hour, minute] = timeStr.split(':').map(Number);
      if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
      const index = (hour - PRINT_START_HOUR) * 4 + Math.floor(minute / 15);
      return Math.max(0, Math.min(PRINT_SLOT_COUNT - 1, index));
    };
    const getPrintSlotBoundary = (timeStr?: string, mode: 'start' | 'end' = 'start') => {
      if (!timeStr) return null;
      const [hour, minute] = timeStr.split(':').map(Number);
      if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
      const raw = (hour - PRINT_START_HOUR) * 4 + (mode === 'end' ? Math.ceil(minute / 15) : Math.floor(minute / 15));
      return Math.max(0, Math.min(PRINT_SLOT_COUNT, raw));
    };
    const timelineHeaderHtml = Array.from({ length: PRINT_SLOT_COUNT }, (_, index) => {
      const hour = PRINT_START_HOUR + Math.floor(index / 4);
      const minute = (index % 4) * 15;
      return `<div class="quarter ${minute === 0 ? 'hour' : ''}">${minute === 0 ? `${hour}:00` : ''}</div>`;
    }).join('');
    const timelineStaffHtml = staffEntries
      .filter((entry) => entry.staffName !== '送迎しない')
      .map((entry) => {
        const shift = shiftStaff.find((s) => s.name === entry.staffName);
        const shiftStart = getPrintSlotBoundary(shift?.start, 'start');
        const shiftEnd = getPrintSlotBoundary(shift?.end, 'end');
        const timelineBlocks = entry.trips.flatMap((trip, tIdx) => {
          return trip.blockKeys.map((blockKey) => {
            const block = blocks.find((b) => b.key === blockKey);
            const slotIndex = getPrintSlotIndex(block?.time);
            if (!block || slotIndex === null) return null;
            return { block, slotIndex, tripIndex: tIdx, lane: 0 };
          }).filter(Boolean) as { block: Block; slotIndex: number; tripIndex: number; lane: number }[];
        }).sort((a, b) => a.slotIndex - b.slotIndex);
        const laneEnds: number[] = [];
        timelineBlocks.forEach((item) => {
          let lane = laneEnds.findIndex((endSlot) => endSlot <= item.slotIndex);
          if (lane < 0) lane = laneEnds.length;
          item.lane = lane;
          laneEnds[lane] = item.slotIndex + 3;
        });
        const laneCount = Math.max(1, laneEnds.length);
        const rowHeight = Math.max(42, laneCount * 27);
        const shiftHtml = shiftStart !== null && shiftEnd !== null && shiftEnd > shiftStart
          ? `<div class="timeline-shift" style="grid-column: ${shiftStart + 1} / ${shiftEnd + 1}; grid-row: 1 / span ${laneCount};"></div>`
          : '';
        const blockHtml = timelineBlocks.map(({ block, slotIndex, tripIndex, lane }) => {
            const isSwimming = (block.nameOnly || block.label).includes('スイミング');
            const isLesson = block.type === 'lesson';
            const bg = isSwimming ? '#DDF7FF' : isLesson ? '#EAF7EF' : '#FFF4D8';
            const border = isSwimming ? '#46B8D7' : isLesson ? '#78C28C' : '#F2B760';
            const label = `${block.time || '-'} ${block.nameOnly || block.label} ${block.count}名`;
            return `
              <div class="timeline-block" style="grid-column: ${slotIndex + 1} / span 3; grid-row: ${lane + 1}; background:${bg}; border-color:${border};">
                <span>${escapeHtml(TRIP_LABELS[tripIndex] || `${tripIndex + 1}回目`)}</span>
                ${escapeHtml(label)}
              </div>
            `;
        }).join('');
        return `
          <div class="timeline-row" style="min-height:${rowHeight}px">
            <div class="timeline-staff">
              <strong>${escapeHtml(entry.staffName)}</strong>
              <span>${escapeHtml(shift?.start || '-')} - ${escapeHtml(shift?.end || '-')}</span>
            </div>
            <div class="timeline-track" style="grid-template-rows:repeat(${laneCount}, minmax(27px, auto)); min-height:${rowHeight}px">
              ${shiftHtml}
              ${blockHtml || '<div class="timeline-empty">担当なし</div>'}
            </div>
          </div>
        `;
      }).join('');
    const roomStaffCounts = getRoomStaffCounts(PRINT_START_HOUR, PRINT_END_HOUR);
    const roomStaffHtml = roomStaffCounts.map((count, index) => {
      const hour = PRINT_START_HOUR + Math.floor(index / 4);
      const minute = (index % 4) * 15;
      const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      return `<div class="room-count-cell" title="${time} ${count}名"><strong>${count}</strong><span>名</span></div>`;
    }).join('');
    const assignedStaffNames = staffEntries
      .filter((entry) => entry.staffName !== '送迎しない')
      .map((entry) => entry.staffName);

    const html = `
      <!doctype html>
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(dateLabel)} 送迎一覧 全体確認</title>
          <style>
            @page { size: A4 landscape; margin: 6mm; }
            * { box-sizing: border-box; }
            html, body, table, tr, th, td, div {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            body {
              margin: 0;
              color: #222;
              font-family: -apple-system, BlinkMacSystemFont, "Yu Gothic", "Yu Gothic UI", Meiryo, sans-serif;
              background: #fff;
            }
            .header {
              border-bottom: 3px solid #56b6c2;
              padding-bottom: 4px;
              margin-bottom: 6px;
            }
            h1 { font-size: 23px; margin: 0; letter-spacing: 0; font-weight: 900; line-height: 1.1; }
            .date-strong { color: #111; margin-right: 8px; }
            .title-tail { font-size: 18px; font-weight: 800; color: #222; }
            .sub { font-size: 12px; color: #555; }
            .summary {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 6px;
              margin-bottom: 6px;
            }
            .summary-card {
              border: 1px solid #d8e8e6;
              border-radius: 7px;
              padding: 5px 9px;
              background: #f7fbfa;
              font-size: 10px;
              color: #111;
              font-weight: 700;
            }
            .summary-card strong {
              display: block;
              font-size: 20px;
              line-height: 1;
              margin-top: 2px;
              color: #111;
              font-weight: 900;
            }
            .summary-staff-title {
              font-size: 10px;
              font-weight: 800;
              color: #222;
              margin-bottom: 2px;
            }
            .summary-staff-row {
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .summary-staff-count {
              flex: 0 0 auto;
              font-size: 20px;
              line-height: 1;
              color: #111;
              font-weight: 900;
            }
            .summary-staff-names {
              font-size: 11px;
              line-height: 1.2;
              color: #111;
              font-weight: 800;
            }
            .section-title {
              font-size: 11px;
              font-weight: 800;
              margin: 5px 0 3px;
            }
            .timeline {
              border: 1px solid #cfe0df;
              border-radius: 10px;
              overflow: hidden;
              margin-bottom: 6px;
              page-break-inside: avoid;
            }
            .timeline-head {
              display: grid;
              grid-template-columns: 88px 1fr;
              background: #f8fbfa;
              border-bottom: 1px solid #cfe0df;
            }
            .timeline-corner {
              padding: 5px 7px;
              font-size: 10px;
              color: #555;
              border-right: 1px solid #cfe0df;
            }
            .timeline-hours {
              display: grid;
              grid-template-columns: repeat(${PRINT_SLOT_COUNT}, minmax(0, 1fr));
              min-height: 22px;
            }
            .quarter {
              border-left: 1px dashed #d7e1e0;
              font-size: 8px;
              color: #888;
              padding: 3px 1px;
            }
            .quarter.hour {
              border-left: 1.5px solid #8fb8b5;
              color: #333;
              font-weight: 700;
            }
            .timeline-row {
              display: grid;
              grid-template-columns: 88px 1fr;
              min-height: 42px;
              border-bottom: 1px solid #edf2f1;
            }
            .timeline-row:last-child { border-bottom: 0; }
            .timeline-staff {
              padding: 6px 7px;
              border-right: 1px solid #cfe0df;
              background: #fbfbfb;
            }
            .timeline-staff strong {
              display: block;
              font-size: 11px;
            }
            .timeline-staff span {
              display: block;
              font-size: 9px;
              color: #555;
              margin-top: 2px;
            }
            .timeline-track {
              display: grid;
              grid-template-columns: repeat(${PRINT_SLOT_COUNT}, minmax(0, 1fr));
              align-items: stretch;
              min-height: 42px;
              background-image:
                repeating-linear-gradient(
                  to right,
                  transparent 0,
                  transparent calc(2.5% - 1px),
                  #dbe8e7 calc(2.5% - 1px),
                  #dbe8e7 2.5%
                ),
                repeating-linear-gradient(
                  to right,
                  transparent 0,
                  transparent calc(10% - 1.5px),
                  #a7c9c6 calc(10% - 1.5px),
                  #a7c9c6 10%
                );
            }
            .timeline-shift {
              grid-row: 1;
              min-height: 42px;
              background: rgba(255, 244, 172, 0.72);
              border-left: 1px solid rgba(226, 194, 67, 0.7);
              border-right: 1px solid rgba(226, 194, 67, 0.7);
              z-index: 0;
            }
            .timeline-block {
              align-self: stretch;
              min-height: 23px;
              margin: 2px 0;
              border: 1px solid;
              border-radius: 6px;
              padding: 2px 4px;
              font-size: 7.5px;
              line-height: 1.15;
              font-weight: 700;
              color: #222;
              overflow: hidden;
              position: relative;
              z-index: 2;
            }
            .timeline-block span {
              display: block;
              font-size: 7px;
              color: #555;
              font-weight: 700;
            }
            .timeline-empty {
              grid-row: 1;
              grid-column: 1 / -1;
              align-self: center;
              padding-left: 8px;
              font-size: 9px;
              color: #999;
              z-index: 1;
            }
            .room-count-row {
              min-height: 34px;
              background: #f5f0fb;
              border-top: 2px solid #9a7ac1;
            }
            .room-count-label {
              display: flex;
              align-items: center;
              padding: 5px 7px;
              border-right: 1px solid #cfe0df;
              background: #eee5f7;
              font-size: 10px;
              font-weight: 900;
              color: #352b40;
            }
            .room-count-track {
              display: grid;
              grid-template-columns: repeat(${PRINT_SLOT_COUNT}, minmax(0, 1fr));
              min-height: 34px;
            }
            .room-count-cell {
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 1px;
              border-left: 1px dashed #cbbddd;
              color: #2d2436;
              background: rgba(255, 255, 255, 0.35);
            }
            .room-count-cell:nth-child(4n + 1) {
              border-left: 1.5px solid #9174b5;
            }
            .room-count-cell strong {
              font-size: 12px;
              line-height: 1;
              font-weight: 900;
            }
            .room-count-cell span {
              font-size: 7px;
              font-weight: 700;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
              font-size: 9px;
            }
            .destination-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 8px;
              align-items: start;
              page-break-inside: avoid;
            }
            th {
              background: #eef8f7;
              border: 1px solid #b9dcda;
              padding: 4px 3px;
              text-align: left;
              font-size: 9px;
            }
            td {
              border: 1px solid #d7e5e3;
              padding: 4px 3px;
              vertical-align: top;
              line-height: 1.25;
              word-break: break-word;
            }
            tr:nth-child(even) td { background: #fbfdfc; }
            tr.row-pickup td { background: #fff8e8; }
            tr.row-lesson td { background: #eff9f2; }
            tr.row-swimming td { background: #e6f9ff; }
            .time { font-size: 10px; font-weight: 800; color: #111; }
            .type-cell { font-size: 9px; font-weight: 900; }
            .type-pickup { color: #D94B4B; }
            .type-lesson { color: #2577C9; }
            .name { font-weight: 700; }
            .count { text-align: center; font-weight: 700; }
            .kids { font-size: 8px; }
            .empty { text-align: center; padding: 20px; color: #666; }
            .destination-empty { border: 1px solid #d7e5e3; }
            @media print {
              .no-print { display: none; }
              body { zoom: 0.92; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1><span class="date-strong">${escapeHtml(dateLabel)}</span><span class="title-tail">送迎一覧</span></h1>
          </div>
          <div class="summary">
            <div class="summary-card">送迎先<strong>${escapeHtml(blocks.length)}件</strong></div>
            <div class="summary-card">対象児童<strong>${escapeHtml(attendance.totalCount || rows.reduce((sum, row) => sum + row.count, 0))}名</strong></div>
            <div class="summary-card">
              <div class="summary-staff-title">スタッフ</div>
              <div class="summary-staff-row">
                <div class="summary-staff-count">${escapeHtml(assignedStaffNames.length)}名</div>
                <div class="summary-staff-names">${escapeHtml(assignedStaffNames.join('、') || 'なし')}</div>
              </div>
            </div>
          </div>
          <div class="timeline">
            <div class="timeline-head">
              <div class="timeline-corner">担当</div>
              <div class="timeline-hours">${timelineHeaderHtml}</div>
            </div>
            ${timelineStaffHtml}
            <div class="timeline-row room-count-row">
              <div class="room-count-label">室内スタッフ</div>
              <div class="room-count-track">${roomStaffHtml}</div>
            </div>
          </div>
          <div class="section-title">送迎先一覧</div>
          ${destinationTablesHtml}
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 250);
            };
          </script>
        </body>
      </html>
    `;

    const oldIframe = browserDocument.getElementById('transport-print-iframe');
    if (oldIframe?.parentNode) {
      oldIframe.parentNode.removeChild(oldIframe);
    }

    const iframe = browserDocument.createElement('iframe');
    iframe.id = 'transport-print-iframe';
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;visibility:hidden;right:0;bottom:0;';
    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          if (iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          }
        }, 1000);
      }, 300);
    };
    browserDocument.body.appendChild(iframe);
    iframe.srcdoc = html;
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

    const rows = getTimelinePrintRows();
    const assignedStaffNames = staffEntries
      .filter((entry) => entry.staffName !== '送迎しない')
      .map((entry) => entry.staffName);
    const targetCount = attendance.totalCount || rows.reduce((sum, row) => sum + row.count, 0);
    const roomStaffCounts = getRoomStaffCounts(START_HOUR, END_HOUR);

    return (
      <ScrollView style={styles.overviewScroll} contentContainerStyle={styles.overviewContent} showsVerticalScrollIndicator={false}>
        <View style={styles.overviewDocumentHeader}>
          <Text style={styles.overviewDate}>{dateLabel}</Text>
          <Text style={styles.overviewTitle}>送迎一覧</Text>
        </View>

        <View style={styles.overviewSummaryRow}>
          <View style={styles.overviewSummaryCard}>
            <Text style={styles.overviewSummaryLabel}>送迎先</Text>
            <Text style={styles.overviewSummaryValue}>{blocks.length}件</Text>
          </View>
          <View style={styles.overviewSummaryCard}>
            <Text style={styles.overviewSummaryLabel}>対象児童</Text>
            <Text style={styles.overviewSummaryValue}>{targetCount}名</Text>
          </View>
          <View style={[styles.overviewSummaryCard, styles.overviewStaffCard]}>
            <Text style={styles.overviewSummaryLabel}>スタッフ</Text>
            <View style={styles.overviewStaffRow}>
              <Text style={styles.overviewSummaryValue}>{assignedStaffNames.length}名</Text>
              <Text style={styles.overviewStaffNames}>{assignedStaffNames.join('、') || 'なし'}</Text>
            </View>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={styles.overviewTimelineFrame}>
            <View style={{ flexDirection: 'row', height: 30, borderBottomWidth: 1, borderColor: '#CFE0DF' }}>
              <View style={styles.overviewTimelineCorner}>
                <Text style={styles.overviewTimelineCornerText}>担当</Text>
              </View>
              <View style={{ flexDirection: 'row', width: TIMELINE_WIDTH }}>
                {/* 時間のヘッダー */}
                {timeHeaders.map(h => (
                  <View key={h} style={{ width: COL_WIDTH * 4, borderLeftWidth: 1.5, borderColor: '#8FB8B5', paddingLeft: 4 }}>
                    <Text style={{ fontSize: 11, color: '#333', fontWeight: 'bold' }}>{h}:00</Text>
                  </View>
                ))}
              </View>
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
                  <View key={sIdx} style={{ flexDirection: 'row', height: ROW_HEIGHT, borderBottomWidth: 1, borderColor: '#EDF2F1' }}>
                    {/* 左側：スタッフ名とシフト時間 */}
                    <View style={{ width: 100, justifyContent: 'center', paddingLeft: 10, borderRightWidth: 1, borderColor: '#CFE0DF', backgroundColor: '#FBFBFB', zIndex: 2 }}>
                      <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#333' }}>{entry.staffName}</Text>
                      <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{shift?.start || '-'} ~ {shift?.end || '-'}</Text>
                    </View>

                    {/* 右側：タイムライン領域 */}
                    <View style={{ width: TIMELINE_WIDTH, position: 'relative' }}>
                      {/* 15分ごとの点線と1時間ごとの実線 */}
                      {Array.from({ length: (END_HOUR - START_HOUR) * 4 }).map((_, i) => (
                        <View key={i} style={{ position: 'absolute', left: i * COL_WIDTH, width: COL_WIDTH, height: ROW_HEIGHT, borderLeftWidth: i % 4 === 0 ? 1.5 : 1, borderStyle: i % 4 === 0 ? 'solid' : 'dashed', borderColor: i % 4 === 0 ? '#A7C9C6' : '#D7E1E0' }} />
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
              <View style={styles.overviewRoomCountRow}>
                <View style={styles.overviewRoomCountLabel}>
                  <Text style={styles.overviewRoomCountLabelText}>室内スタッフ</Text>
                </View>
                <View style={{ width: TIMELINE_WIDTH, flexDirection: 'row' }}>
                  {roomStaffCounts.map((count, index) => (
                    <View
                      key={index}
                      style={[
                        styles.overviewRoomCountCell,
                        { width: COL_WIDTH },
                        index % 4 === 0 && styles.overviewRoomCountHourCell,
                      ]}
                    >
                      <Text style={styles.overviewRoomCountValue}>{count}</Text>
                      <Text style={styles.overviewRoomCountUnit}>名</Text>
                    </View>
                  ))}
                </View>
              </View>
          </View>
        </ScrollView>

        <Text style={styles.overviewSectionTitle}>送迎先一覧</Text>
        <View style={styles.overviewTable}>
          <View style={[styles.overviewTableRow, styles.overviewTableHeader]}>
            <Text style={[styles.overviewTableHeadText, styles.overviewTimeCell]}>時刻</Text>
            <Text style={[styles.overviewTableHeadText, styles.overviewTypeCell]}>種別</Text>
            <Text style={[styles.overviewTableHeadText, styles.overviewNameCell]}>行き先</Text>
            <Text style={[styles.overviewTableHeadText, styles.overviewCountCell]}>人数</Text>
            <Text style={[styles.overviewTableHeadText, styles.overviewStaffCell]}>担当</Text>
            <Text style={[styles.overviewTableHeadText, styles.overviewKidsCell]}>児童名</Text>
          </View>
          {rows.length > 0 ? rows.map((row, index) => {
            const isSwimming = row.name.includes('スイミング');
            const rowBackground = isSwimming ? '#E6F9FF' : row.typeLabel === '習い事' ? '#EFF9F2' : '#FFF8E8';
            return (
              <View key={`${row.time}_${row.name}_${index}`} style={[styles.overviewTableRow, { backgroundColor: rowBackground }]}>
                <Text style={[styles.overviewTableText, styles.overviewTimeCell, styles.overviewTimeText]}>{row.time}</Text>
                <Text style={[styles.overviewTableText, styles.overviewTypeCell, row.typeLabel === '習い事' ? styles.overviewLessonText : styles.overviewPickupText]}>{row.typeLabel}</Text>
                <Text style={[styles.overviewTableText, styles.overviewNameCell, styles.overviewNameText]}>{row.name}</Text>
                <Text style={[styles.overviewTableText, styles.overviewCountCell]}>{row.count}名</Text>
                <Text style={[styles.overviewTableText, styles.overviewStaffCell]}>{row.staffName}</Text>
                <Text style={[styles.overviewTableText, styles.overviewKidsCell]}>{row.kids.join('、') || '-'}</Text>
              </View>
            );
          }) : (
            <Text style={styles.overviewEmptyText}>この日の送迎予定はありません</Text>
          )}
        </View>
      </ScrollView>
    );
  };

  return (
    <>
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* ヘッダー */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{showTimeline ? `${dateLabel} 送迎一覧` : `🚗 ${dateLabel}`}</Text>
            
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {showTimeline ? (
                // タイムライン表示中のボタン
                <>
                  <TouchableOpacity style={styles.printBtn} onPress={printTimeline}>
                    <Ionicons name="print-outline" size={14} color="#fff" />
                    <Text style={styles.printBtnText}>印刷</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.lastWeekBtn, { borderColor: COLORS.primary }]} onPress={() => setShowTimeline(false)}>
                    <Text style={[styles.lastWeekBtnText, { color: COLORS.primary }]}>編集に戻る</Text>
                  </TouchableOpacity>
                </>
              ) : (
                // 割り当て編集中のボタン
                <>
                  <TouchableOpacity style={styles.overviewBtn} onPress={() => setShowTimeline(true)}>
                    <Ionicons name="list-outline" size={17} color="#fff" />
                    <Text style={styles.overviewBtnText}>全体表示</Text>
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
                                  <Text style={{ fontSize: 9, color: '#aaa', marginTop: 2 }}>＋追加可</Text>
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
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
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
                          <>
                            <View style={styles.selectedMark}>
                              <Text style={styles.selectedMarkText}>選択中</Text>
                            </View>
                            <View style={styles.blockMemberList}>
                              {(block.kids || []).map((kid, kidIdx) => (
                                <Text key={`${block.key}-${kid.id || kid.name || kidIdx}`} style={styles.blockMemberText} numberOfLines={1}>
                                  {kid.name}{kid.grade ? ` (${kid.grade})` : ''}
                                </Text>
                              ))}
                            </View>
                          </>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                  </View>
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
  printBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, minWidth: 88, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18, backgroundColor: '#56B6C2' },
  printBtnText: { fontSize: 14, color: '#fff', fontWeight: 'bold' },
  overviewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, minWidth: 104, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18, backgroundColor: '#5B9BD5' },
  overviewBtnText: { fontSize: 14, color: '#fff', fontWeight: 'bold' },
  lastWeekBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 40, minWidth: 96, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: '#fff' },
  lastWeekBtnActive: { backgroundColor: COLORS.primary },
  lastWeekBtnText: { fontSize: 14, color: COLORS.primary, fontWeight: 'bold' },
  lastWeekBanner: { backgroundColor: '#FFF9C4', padding: 7, alignItems: 'center' },
  lastWeekBannerText: { fontSize: 11, color: '#856404', fontWeight: 'bold' },

  body: { flex: 1, flexDirection: 'row' },
  overviewScroll: { flex: 1, backgroundColor: '#fff' },
  overviewContent: { padding: 10, paddingBottom: 24 },
  overviewDocumentHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 8, borderBottomWidth: 3, borderBottomColor: '#56B6C2', paddingBottom: 4, marginBottom: 6 },
  overviewDate: { fontSize: 23, lineHeight: 27, fontWeight: '900', color: '#111' },
  overviewTitle: { fontSize: 18, fontWeight: '800', color: '#222' },
  overviewSummaryRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  overviewSummaryCard: { flex: 1, minHeight: 56, borderWidth: 1, borderColor: '#D8E8E6', borderRadius: 7, paddingVertical: 5, paddingHorizontal: 9, backgroundColor: '#F7FBFA' },
  overviewStaffCard: { flex: 1.45 },
  overviewSummaryLabel: { fontSize: 10, color: '#111', fontWeight: '700' },
  overviewSummaryValue: { fontSize: 20, lineHeight: 22, marginTop: 2, color: '#111', fontWeight: '900' },
  overviewStaffRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  overviewStaffNames: { flex: 1, fontSize: 11, lineHeight: 14, color: '#111', fontWeight: '800' },
  overviewTimelineFrame: { borderWidth: 1, borderColor: '#CFE0DF', borderRadius: 10, overflow: 'hidden', marginBottom: 10 },
  overviewTimelineCorner: { width: 100, justifyContent: 'center', paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: '#CFE0DF', backgroundColor: '#F8FBFA' },
  overviewTimelineCornerText: { fontSize: 10, color: '#555' },
  overviewRoomCountRow: { flexDirection: 'row', minHeight: 42, borderTopWidth: 2, borderTopColor: '#9A7AC1', backgroundColor: '#F5F0FB' },
  overviewRoomCountLabel: { width: 100, justifyContent: 'center', paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: '#CFE0DF', backgroundColor: '#EEE5F7' },
  overviewRoomCountLabelText: { fontSize: 11, fontWeight: '900', color: '#352B40' },
  overviewRoomCountCell: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderStyle: 'dashed', borderLeftColor: '#CBBBDD', backgroundColor: 'rgba(255,255,255,0.35)' },
  overviewRoomCountHourCell: { borderLeftWidth: 1.5, borderStyle: 'solid', borderLeftColor: '#9174B5' },
  overviewRoomCountValue: { fontSize: 13, lineHeight: 16, fontWeight: '900', color: '#2D2436' },
  overviewRoomCountUnit: { fontSize: 7, fontWeight: '700', color: '#2D2436', marginLeft: 1 },
  overviewSectionTitle: { fontSize: 14, fontWeight: '800', color: '#222', marginTop: 4, marginBottom: 7 },
  overviewTable: { borderLeftWidth: 1, borderTopWidth: 1, borderColor: '#B9DCDA' },
  overviewTableRow: { flexDirection: 'row', minHeight: 40 },
  overviewTableHeader: { minHeight: 34, backgroundColor: '#EEF8F7' },
  overviewTableHeadText: { padding: 6, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#B9DCDA', fontSize: 11, fontWeight: '800', color: '#222' },
  overviewTableText: { padding: 6, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#D7E5E3', fontSize: 11, lineHeight: 16, color: '#222' },
  overviewTimeCell: { width: '8%' },
  overviewTypeCell: { width: '9%' },
  overviewNameCell: { width: '18%' },
  overviewCountCell: { width: '8%', textAlign: 'center' },
  overviewStaffCell: { width: '13%' },
  overviewKidsCell: { flex: 1 },
  overviewTimeText: { fontSize: 13, fontWeight: '800', color: '#111' },
  overviewPickupText: { fontSize: 12, fontWeight: '900', color: '#D94B4B' },
  overviewLessonText: { fontSize: 12, fontWeight: '900', color: '#2577C9' },
  overviewNameText: { fontWeight: '700' },
  overviewEmptyText: { padding: 20, textAlign: 'center', color: '#666', borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#D7E5E3' },
  rightPanel: { width: 160, backgroundColor: '#fff', borderLeftWidth: 1, borderColor: COLORS.border, padding: 6 },
  rightTitle: { fontSize: 12, fontWeight: 'bold', color: '#555', textAlign: 'center', marginBottom: 6 },
  blockChip: { borderRadius: 12, padding: 6, marginBottom: 6, borderWidth: 2, alignItems: 'center', width: '47%' },
  blockChipText: { fontSize: 12, fontWeight: 'bold', textAlign: 'center' },
  countBadge: { marginTop: 3, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  countText: { fontSize: 10, color: '#fff', fontWeight: 'bold' },
  selectedMark: { marginTop: 3, backgroundColor: '#FF9800', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  selectedMarkText: { fontSize: 9, color: '#fff', fontWeight: 'bold' },
  blockMemberList: { width: '100%', marginTop: 5, paddingTop: 4, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)', gap: 2 },
  blockMemberText: { fontSize: 9, color: COLORS.text, fontWeight: '600', textAlign: 'center' },
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
