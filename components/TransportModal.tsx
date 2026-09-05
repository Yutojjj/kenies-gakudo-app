import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, useWindowDimensions, View } from 'react-native';
import { db } from '../firebase';
import { playUiSound } from '../utils/uiSounds';
import { handleWebWheelStep } from '../utils/webWheel';

const WebScrollView = ScrollView as any;

const COLORS = {
  primary: '#5B9BD5', white: '#FFFFFF', text: '#333333',
  textLight: '#888888', border: '#E0E0E0', danger: '#E53935',
  background: '#F4F6F9',
};
const STAFF_COLORS = [
  '#FF8A65','#FFB74D','#FFD54F','#AED581','#4DB6AC',
  '#4FC3F7','#9575CD','#F06292','#A1887F','#90A4AE',
];
const STAFF_SHIFT_TIME_COLORS = [
  '#FFF0D8', '#E7F2FF', '#EAF7EC', '#F3ECFF', '#FFF0F4',
  '#E8F8F7', '#FFF8DE', '#EEF1FF', '#F7F0E9', '#EEF4F5',
];
const getStaffShiftTimeColor = (staffName: string, index: number) =>
  STAFF_SHIFT_TIME_COLORS[index % STAFF_SHIFT_TIME_COLORS.length];
const LAST_WEEK_CARD_COLORS = [
  { background: '#FFF8F1', border: '#EF8A6B' },
  { background: '#F2F8FF', border: '#4B9FE1' },
  { background: '#F2FAF4', border: '#55A879' },
  { background: '#FFFBEF', border: '#D9A52D' },
  { background: '#FFF4F7', border: '#D66C96' },
  { background: '#F2FAF9', border: '#58A7A0' },
];

type Block = { key: string; label: string; count: number; time?: string; type?: 'school' | 'lesson'; nameOnly?: string; kids?: any[] };
type TripSlot = { tripIndex: number; blockKeys: string[] };
type StaffEntry = { staffName: string; trips: TripSlot[] };
type CustomTransportBlock = {
  id: string;
  destination: string;
  time: string;
  members: string[];
  type: 'school' | 'lesson';
};
type Props = {
  visible: boolean; dateStr: string; onClose: () => void;
  attendance: { schools: Record<string, Record<string, any[]>>; lessons: Record<string, any[]>; totalCount: number };
  shiftStaff: { name: string; start: string; end: string }[];
  allStaffList: string[];
  assignments: Record<string, any>;
  onAssign: (dateStr: string, blockKey: string, staffName: string) => Promise<void>;
  onDateChange?: (dateStr: string) => void;
  publicHolidays: Record<string, string>;
  initialMode?: 'edit' | 'overview';
  readOnly?: boolean;
  autoPrintOnOpen?: boolean;
  printOnly?: boolean;
  printPages?: Array<{
    dateStr: string;
    attendance: Props['attendance'];
    shiftStaff: Props['shiftStaff'];
    assignments: Record<string, any>;
  }>;
};
const DOW_JP = ['日','月','火','水','木','金','土'];
const TRIP_LABELS = ['1回目','2回目','3回目','4回目','5回目'];
const CUSTOM_TIME_HOURS = Array.from({ length: 14 }, (_, index) => index + 7);
const CUSTOM_TIME_MINUTES = Array.from({ length: 12 }, (_, index) => index * 5);
const CUSTOM_TIME_ITEM_HEIGHT = 41;
const CUSTOM_TIME_VIEW_HEIGHT = 132;

const escapeHtml = (value: any) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

export default function TransportModal({
  visible, dateStr, onClose, attendance, shiftStaff, assignments, onAssign, onDateChange,
  initialMode = 'edit', readOnly = false, autoPrintOnOpen = false, printOnly = false, printPages,
}: Props) {
  const [staffEntries, setStaffEntries] = useState<StaffEntry[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [showLastWeek, setShowLastWeek] = useState(false);
  const [lastWeekModalVisible, setLastWeekModalVisible] = useState(false);
  const [lastWeekEntries, setLastWeekEntries] = useState<StaffEntry[]>([]);
  const [lastWeekCustomBlocks, setLastWeekCustomBlocks] = useState<CustomTransportBlock[]>([]);
  const [lastWeekLoading, setLastWeekLoading] = useState(false);
  const [slotDetail, setSlotDetail] = useState<{sIdx:number; tIdx:number} | null>(null);
  const [showTimeline, setShowTimeline] = useState(false); // タイムライン（全体確認）の表示状態
  const [timelineZoomVisible, setTimelineZoomVisible] = useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const autoPrintTriggeredRef = useRef(false);
  const [customBlocks, setCustomBlocks] = useState<CustomTransportBlock[]>([]);
  const [customBlockModalVisible, setCustomBlockModalVisible] = useState(false);
  const [customDestination, setCustomDestination] = useState('');
  const [customHour, setCustomHour] = useState(7);
  const [customMinute, setCustomMinute] = useState(0);
  const [customMemberInput, setCustomMemberInput] = useState('');
  const [customMembers, setCustomMembers] = useState<string[]>([]);
  const [customTransportType, setCustomTransportType] = useState<'school' | 'lesson'>('lesson');
  const [customBlockError, setCustomBlockError] = useState('');
  const [customBlockToDelete, setCustomBlockToDelete] = useState<CustomTransportBlock | null>(null);
  const [locallyAssignedBlockKeys, setLocallyAssignedBlockKeys] = useState<Set<string>>(new Set());
  const [defaultShiftTimes, setDefaultShiftTimes] = useState<Record<string, { start: string; end: string }>>({});
  const customHourScrollRef = useRef<ScrollView>(null);
  const customMinuteScrollRef = useRef<ScrollView>(null);
  const customHourWheelWrapRef = useRef<any>(null);
  const customMinuteWheelWrapRef = useRef<any>(null);
  const customHourSnapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customMinuteSnapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customHourWheelLockRef = useRef(0);
  const customMinuteWheelLockRef = useRef(0);

  useEffect(() => {
    if (!customBlockModalVisible || Platform.OS !== 'web') return;
    const wheels = [
      { element: customHourWheelWrapRef.current as HTMLElement | null, values: CUSTOM_TIME_HOURS, selected: customHour, setter: setCustomHour, ref: customHourScrollRef, lockRef: customHourWheelLockRef },
      { element: customMinuteWheelWrapRef.current as HTMLElement | null, values: CUSTOM_TIME_MINUTES, selected: customMinute, setter: setCustomMinute, ref: customMinuteScrollRef, lockRef: customMinuteWheelLockRef },
    ].map(({ element, values, selected, setter, ref, lockRef }) => {
      if (!element?.addEventListener) return null;
      const onWheel = (event: WheelEvent) => handleWebWheelStep(event, {
        index: values.indexOf(selected),
        length: values.length,
        itemHeight: CUSTOM_TIME_ITEM_HEIGHT,
        lockRef,
        onIndexChange: index => setter(values[index]),
        scrollTo: offset => ref.current?.scrollTo({ y: offset, animated: true }),
      });
      element.addEventListener('wheel', onWheel, { passive: false });
      return { element, onWheel };
    });
    return () => wheels.forEach(wheel => wheel?.element.removeEventListener('wheel', wheel.onWheel));
  }, [customBlockModalVisible, customHour, customMinute]);

  const date = new Date(dateStr + 'T00:00:00');
  const dateLabel = `${date.getMonth()+1}月${date.getDate()}日(${DOW_JP[date.getDay()]})`;
  const changeDate = (amount: number) => {
    if (!onDateChange) return;
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + amount);
    const year = nextDate.getFullYear();
    const month = String(nextDate.getMonth() + 1).padStart(2, '0');
    const day = String(nextDate.getDate()).padStart(2, '0');
    onDateChange(`${year}-${month}-${day}`);
  };
  const lastWeekDate = new Date(date);
  lastWeekDate.setDate(date.getDate() - 7);

  useEffect(() => {
    setLocallyAssignedBlockKeys(new Set());
    if (!visible) setTimelineZoomVisible(false);
  }, [dateStr, visible]);

  useEffect(() => {
    if (!visible) return;
    getDoc(doc(db, 'settings', 'autoFillSettings')).then(snapshot => {
      const defaults: Record<string, { start: string; end: string }> = {};
      const settings = snapshot.data()?.staffSettings;
      if (Array.isArray(settings)) {
        settings.forEach((staff: any) => {
          const name = String(staff?.name || '').trim();
          if (name && staff?.start && staff?.end) {
            defaults[name] = { start: String(staff.start), end: String(staff.end) };
          }
        });
      }
      setDefaultShiftTimes(defaults);
    }).catch(() => setDefaultShiftTimes({}));
  }, [visible]);

  const getStaffShift = (staffName: string) => {
    const normalizedName = String(staffName || '').replace(/\s/g, '');
    const daily = shiftStaff.find(shift => String(shift?.name || '').replace(/\s/g, '') === normalizedName) as any;
    const fallbackEntry = Object.entries(defaultShiftTimes).find(([name]) => name.replace(/\s/g, '') === normalizedName)?.[1];
    if (!daily && !fallbackEntry) return null;
    return {
      name: staffName,
      start: String(daily?.start || daily?.startTime || fallbackEntry?.start || ''),
      end: String(daily?.end || daily?.endTime || fallbackEntry?.end || ''),
    };
  };

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
      label: `${nameOnly} ${time}`.trim(), 
      nameOnly, 
      time, 
      count: (kids as any[]).length, 
      kids: kids as any[],
      type: 'lesson' 
    });
  });
  customBlocks.forEach((customBlock) => {
    blocks.push({
      key: customBlock.id,
      label: `${customBlock.destination} ${customBlock.time}`.trim(),
      nameOnly: customBlock.destination,
      time: customBlock.time,
      count: customBlock.members.length,
      kids: customBlock.members.map((member, index) => ({ id: `${customBlock.id}_${index}`, name: member })),
      type: customBlock.type,
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
    setShowTimeline(initialMode === 'overview');
    try {
      const parsedCustomBlocks = assignments?.customBlocks
        ? JSON.parse(String(assignments.customBlocks))
        : [];
      setCustomBlocks(Array.isArray(parsedCustomBlocks) ? parsedCustomBlocks : []);
    } catch {
      setCustomBlocks([]);
    }
    
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
  }, [visible, shiftStaff, assignments, initialMode]);

  const save = async (entries: StaffEntry[]) => {
    setStaffEntries(entries);
    await onAssign(dateStr, 'entries', JSON.stringify({ entries }));
  };

  const resetCustomBlockForm = () => {
    setCustomDestination('');
    setCustomHour(7);
    setCustomMinute(0);
    setCustomMemberInput('');
    setCustomMembers([]);
    setCustomTransportType('lesson');
    setCustomBlockError('');
  };

  const openCustomBlockForm = () => {
    resetCustomBlockForm();
    setCustomBlockModalVisible(true);
    setTimeout(() => {
      customHourScrollRef.current?.scrollTo({ y: 0, animated: false });
      customMinuteScrollRef.current?.scrollTo({ y: 0, animated: false });
    }, 80);
  };

  const settleCustomTimeWheel = (
    values: number[],
    y: number,
    setter: (value: number) => void,
    scrollRef: React.RefObject<ScrollView | null>,
  ) => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(y / CUSTOM_TIME_ITEM_HEIGHT)));
    setter(values[index]);
    const targetY = index * CUSTOM_TIME_ITEM_HEIGHT;
    if (Math.abs(y - targetY) > 0.5) {
      scrollRef.current?.scrollTo({ y: targetY, animated: true });
    }
    setCustomBlockError('');
  };

  const updateCustomTimeFromScroll = (
    values: number[],
    y: number,
    currentValue: number,
    setter: (value: number) => void,
  ) => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(y / CUSTOM_TIME_ITEM_HEIGHT)));
    const nextValue = values[index];
    if (nextValue === currentValue) return;
    setter(nextValue);
    playUiSound('tick');
  };

  const scheduleCustomTimeSnap = (
    values: number[],
    y: number,
    setter: (value: number) => void,
    scrollRef: React.RefObject<ScrollView | null>,
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  ) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      settleCustomTimeWheel(values, y, setter, scrollRef);
      timerRef.current = null;
    }, 120);
  };

  const selectCustomTimeValue = (
    values: number[],
    value: number,
    setter: (value: number) => void,
    scrollRef: React.RefObject<ScrollView | null>,
  ) => {
    const index = values.indexOf(value);
    setter(value);
    playUiSound('tick');
    if (index >= 0) scrollRef.current?.scrollTo({ y: index * CUSTOM_TIME_ITEM_HEIGHT, animated: true });
    setCustomBlockError('');
  };

  const addCustomMember = () => {
    const member = customMemberInput.trim();
    if (!member) return;
    setCustomMembers(current => current.includes(member) ? current : [...current, member]);
    setCustomMemberInput('');
    setCustomBlockError('');
  };

  const saveCustomBlock = async () => {
    const destination = customDestination.trim();
    const pendingMember = customMemberInput.trim();
    const members = Array.from(new Set([
      ...customMembers,
      ...(pendingMember ? [pendingMember] : []),
    ]));
    if (!destination) {
      setCustomBlockError('送迎先を入力してください');
      return;
    }
    const nextBlock: CustomTransportBlock = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      destination,
      time: `${String(customHour).padStart(2, '0')}:${String(customMinute).padStart(2, '0')}`,
      members,
      type: customTransportType,
    };
    const nextBlocks = [...customBlocks, nextBlock];
    setCustomBlocks(nextBlocks);
    await onAssign(dateStr, 'customBlocks', JSON.stringify(nextBlocks));
    setCustomBlockModalVisible(false);
    resetCustomBlockForm();
  };

  const deleteCustomBlock = async () => {
    if (!customBlockToDelete) return;
    const blockId = customBlockToDelete.id;
    const nextBlocks = customBlocks.filter(block => block.id !== blockId);
    const nextEntries = staffEntries.map(entry => ({
      ...entry,
      trips: entry.trips.map(trip => ({
        ...trip,
        blockKeys: trip.blockKeys.filter(blockKey => blockKey !== blockId),
      })),
    }));

    setCustomBlocks(nextBlocks);
    setSelectedBlock(current => current?.key === blockId ? null : current);
    setLocallyAssignedBlockKeys(current => {
      const next = new Set(current);
      next.delete(blockId);
      return next;
    });
    setCustomBlockToDelete(null);
    await onAssign(dateStr, 'customBlocks', JSON.stringify(nextBlocks));
    await save(nextEntries);
  };

  // 先週の同日データをFirestoreから取得してポップアップ表示
  const openLastWeekModal = async () => {
    setLastWeekLoading(true);
    setLastWeekModalVisible(true);
    try {
      const lwDateStr = `${lastWeekDate.getFullYear()}-${String(lastWeekDate.getMonth()+1).padStart(2,'0')}-${String(lastWeekDate.getDate()).padStart(2,'0')}`;
      const snap = await getDoc(doc(db, 'pickup_assignments', lwDateStr));
      if (snap.exists() && snap.data()?.entries) {
        const data = snap.data();
        const rawEntries = typeof data.entries === 'string' ? JSON.parse(data.entries) : data.entries;
        const rawCustomBlocks = data.customBlocks
          ? (typeof data.customBlocks === 'string' ? JSON.parse(data.customBlocks) : data.customBlocks)
          : [];
        setLastWeekEntries(Array.isArray(rawEntries) ? rawEntries : (rawEntries?.entries || []));
        setLastWeekCustomBlocks(Array.isArray(rawCustomBlocks) ? rawCustomBlocks : []);
      } else {
        setLastWeekEntries([]);
        setLastWeekCustomBlocks([]);
      }
    } catch (e) {
      setLastWeekEntries([]);
      setLastWeekCustomBlocks([]);
    } finally {
      setLastWeekLoading(false);
    }
  };

  // 担当済みブロックkeyのセット
  const assignedBlockKeys = new Set([
    ...staffEntries.flatMap(e => e.trips.flatMap(t => t.blockKeys)),
    ...locallyAssignedBlockKeys,
  ]);

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
    setLocallyAssignedBlockKeys(current => new Set([...current, blockKey]));
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
    const remainsAssigned = updated.some(entry => entry.trips.some(trip => trip.blockKeys.includes(blockKey)));
    if (!remainsAssigned) {
      setLocallyAssignedBlockKeys(current => {
        const next = new Set(current);
        next.delete(blockKey);
        return next;
      });
    }
    save(updated);
  };

  const formatLastWeekBlock = (blockKey: string) => {
    const customBlock = lastWeekCustomBlocks.find(block => block.id === blockKey);
    if (customBlock) return `${customBlock.destination} ${customBlock.time}`.trim();
    if (blockKey.startsWith('custom_')) return '追加した送迎先';
    const lessonMatch = blockKey.match(/^(\d{1,2}:\d{2})\s+(.+)$/);
    if (lessonMatch) return `${lessonMatch[2]} ${lessonMatch[1]}`;
    const match = blockKey.match(/^(.*)_(\d{1,2}:\d{2})$/);
    if (match) return `${match[1].replace(/_/g, ' ')} ${match[2]}`;
    return blockKey.replace(/_/g, ' ');
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
      const kidEntries = [...(block.kids || [])]
        .sort((a: any, b: any) => {
          const gradeDiff = parseGradeOrder(a.grade) - parseGradeOrder(b.grade);
          if (gradeDiff !== 0) return gradeDiff;
          return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
        })
        .map((kid: any) => ({ name: String(kid.name || ''), grade: String(kid.grade || '') }))
        .filter((kid) => kid.name);
      return {
        time: block.time || '-',
        typeLabel: block.type === 'lesson' ? '習い事' : 'お迎え',
        name: block.nameOnly || block.label,
        count: block.count,
        staffName: assignment?.staffName || '未割当',
        tripLabel: assignment?.tripLabel || '-',
        kids: kidEntries.map((kid) => `${kid.name}${kid.grade ? `（${kid.grade}）` : ''}`),
        kidEntries,
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

        const shift = getStaffShift(entry.staffName);
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

    const now = Date.now();
    const printLockedUntil = Number(browserWindow.__transportPrintLockedUntil || 0);
    if (printLockedUntil > now) return;
    browserWindow.__transportPrintLockedUntil = now + 8000;

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
          <td class="kids">${row.kidEntries.length > 0
            ? `<div class="kids-grid">${row.kidEntries.map((kid) => `
                <span class="kid-entry">${escapeHtml(`${kid.name}${kid.grade ? `（${kid.grade}）` : ''}`)}</span>
              `).join('')}</div>`
            : '-'}</td>
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
    const timelineGridLinesHtml = Array.from({ length: PRINT_SLOT_COUNT + 1 }, (_, index) => {
      const isHour = index % 4 === 0;
      return `<i class="timeline-grid-line ${isHour ? 'hour' : ''}" style="left:${(index / PRINT_SLOT_COUNT) * 100}%"></i>`;
    }).join('');
    const timelineStaffHtml = staffEntries
      .filter((entry) => entry.staffName !== '送迎しない')
      .map((entry) => {
        const shift = getStaffShift(entry.staffName);
        const staffIndex = staffEntries.findIndex((staffEntry) => staffEntry.staffName === entry.staffName);
        const staffShiftTimeColor = getStaffShiftTimeColor(entry.staffName, Math.max(0, staffIndex));
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
          ? `<div class="timeline-shift" style="grid-column: ${shiftStart + 1} / ${shiftEnd + 1}; grid-row: 1 / span ${laneCount}; background:${staffShiftTimeColor};"></div>`
          : '';
        const blockHtml = timelineBlocks.map(({ block, slotIndex, lane }) => {
            const isSwimming = (block.nameOnly || block.label).includes('スイミング');
            const isLesson = block.type === 'lesson';
            const bg = isSwimming ? '#DDF7FF' : isLesson ? '#EAF7EF' : '#FFF4D8';
            const border = isSwimming ? '#46B8D7' : isLesson ? '#78C28C' : '#F2B760';
            const meta = `${block.time || '-'}・${block.count}名`;
            const label = block.nameOnly || block.label;
            return `
              <div class="timeline-block" style="grid-column: ${slotIndex + 1} / span 3; grid-row: ${lane + 1}; background:${bg}; border-color:${border};">
                <span class="timeline-block-meta">${escapeHtml(meta)}</span>
                <span class="timeline-block-label">${escapeHtml(label)}</span>
              </div>
            `;
        }).join('');
        return `
          <div class="timeline-row" style="height:${rowHeight}px">
            <div class="timeline-staff" style="background:${staffShiftTimeColor}">
              <strong>${escapeHtml(entry.staffName)}</strong>
              <span>${escapeHtml(shift?.start || '-')} - ${escapeHtml(shift?.end || '-')}</span>
            </div>
            <div class="timeline-track" style="grid-template-rows:repeat(${laneCount}, minmax(27px, 1fr)); height:${rowHeight}px">
              ${shiftHtml}
              ${timelineGridLinesHtml}
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

    const renderHomePrintPage = (page: NonNullable<Props['printPages']>[number]) => {
      let pageCustomBlocks: CustomTransportBlock[] = [];
      try {
        const parsed = page.assignments?.customBlocks ? JSON.parse(String(page.assignments.customBlocks)) : [];
        pageCustomBlocks = Array.isArray(parsed) ? parsed : [];
      } catch {}

      const pageBlocks: Block[] = [];
      Object.entries(page.attendance.schools || {}).forEach(([school, times]) => {
        Object.entries(times).forEach(([time, kids]) => pageBlocks.push({ key: `${school}_${time}`, label: `${school} ${time}`, nameOnly: school, time, count: (kids as any[]).length, kids: kids as any[], type: 'school' }));
      });
      Object.entries(page.attendance.lessons || {}).forEach(([lessonKey, kids]) => {
        const timeMatch = lessonKey.match(/^\d{1,2}:\d{2}/);
        const time = timeMatch ? timeMatch[0] : '';
        const nameOnly = lessonKey.replace(time, '').trim() || lessonKey;
        pageBlocks.push({ key: lessonKey, label: `${nameOnly} ${time}`.trim(), nameOnly, time, count: (kids as any[]).length, kids: kids as any[], type: 'lesson' });
      });
      pageCustomBlocks.forEach((block) => pageBlocks.push({ key: block.id, label: `${block.destination} ${block.time}`.trim(), nameOnly: block.destination, time: block.time, count: block.members.length, kids: block.members.map((member, index) => ({ id: `${block.id}_${index}`, name: member })), type: block.type }));

      let loadedEntries: StaffEntry[] = [];
      try {
        const parsed = page.assignments?.entries ? JSON.parse(String(page.assignments.entries)) : null;
        if (parsed?.entries) loadedEntries = parsed.entries.map((entry: any) => ({ ...entry, trips: (entry.trips || []).map((trip: any) => ({ ...trip, blockKeys: trip.blockKeys || (trip.blockKey ? [trip.blockKey] : []) })) }));
      } catch {}
      const pageEntries = [...page.shiftStaff.map(staff => staff.name), '送迎しない'].map((staffName) => loadedEntries.find(entry => entry.staffName === staffName) || ({ staffName, trips: [{ tripIndex: 0, blockKeys: [] }] }));
      const pageDate = new Date(`${page.dateStr}T00:00:00`);
      const pageLabel = `${pageDate.getMonth() + 1}月${pageDate.getDate()}日(${DOW_JP[pageDate.getDay()]})`;
      const getPageShift = (staffName: string) => page.shiftStaff.find(staff => staff.name === staffName);
      const staffCards = pageEntries.map((entry, staffIndex) => {
        const isNoTransport = entry.staffName === '送迎しない';
        const color = isNoTransport ? '#9E9E9E' : STAFF_COLORS[staffIndex % STAFF_COLORS.length];
        const shift = isNoTransport ? null : getPageShift(entry.staffName);
        const trips = entry.trips.filter((trip) => trip.blockKeys.length > 0);
        const tripsHtml = trips.length > 0 ? trips.map((trip, tripIndex) => {
          const sortedBlockKeys = [...trip.blockKeys].sort((leftKey, rightKey) => {
            const leftBlock = pageBlocks.find(block => block.key === leftKey);
            const rightBlock = pageBlocks.find(block => block.key === rightKey);
            return String(leftBlock?.time || '').localeCompare(String(rightBlock?.time || ''));
          });
          const stopsHtml = sortedBlockKeys.map((blockKey) => {
            const block = pageBlocks.find(item => item.key === blockKey);
            if (!block) return '';
            const kids = (block.kids || []).map((kid: any) => String(kid?.name || '')).filter(Boolean);
            return `<div class="home-print-stop"><div class="home-print-main"><span class="home-print-time">${escapeHtml(block.time || '-')}</span><strong class="${block.type === 'lesson' ? 'lesson' : ''}">${escapeHtml(block.nameOnly || block.label)}</strong></div>${kids.length > 0 ? `<div class="home-print-kids">${kids.map(name => `<span>${escapeHtml(name)}</span>`).join('')}</div>` : ''}</div>`;
          });
          const splitIndex = Math.ceil(stopsHtml.length / 2);
          const leftStops = stopsHtml.slice(0, splitIndex);
          const rightStops = stopsHtml.slice(splitIndex);
          const paddedRightStops = [...rightStops, ...Array(Math.max(0, leftStops.length - rightStops.length)).fill('<div class="home-print-stop home-print-no-transport-blank"></div>')];
          const tripBodyHtml = isNoTransport && stopsHtml.length > 1
            ? `<div class="home-print-no-transport-columns"><div class="home-print-no-transport-column">${leftStops.join('')}</div><div class="home-print-no-transport-column">${paddedRightStops.join('')}</div></div>`
            : stopsHtml.join('');
          return `<div class="home-print-trip">${isNoTransport ? '' : `<span class="home-print-number" style="--trip-color:${color}">${tripIndex + 1}</span>`}<div class="home-print-trip-body" style="border-color:${color}">${tripBodyHtml}</div></div>`;
        }).join('') : '<div class="home-print-empty">担当なし</div>';
        return {
          isNoTransport,
          html: `<section class="home-print-staff ${isNoTransport ? 'no-transport' : ''}" style="--staff-color:${color}"><header class="home-print-staff-head"><span class="home-print-dot" style="background:${color}"></span><strong>${escapeHtml(entry.staffName)}</strong>${shift?.start && shift?.end ? `<span class="home-print-shift">${escapeHtml(shift.start)} - ${escapeHtml(shift.end)}</span>` : ''}</header><div class="home-print-trips">${tripsHtml}</div></section>`,
        };
      });
      const transportCards = staffCards.filter(card => !card.isNoTransport).map(card => card.html);
      const noTransportCards = staffCards.filter(card => card.isNoTransport).map(card => card.html);
      const staffHtml = `<div class="home-print-staff-column">${transportCards.filter((_, index) => index % 2 === 0).join('')}</div><div class="home-print-staff-column">${transportCards.filter((_, index) => index % 2 === 1).join('')}</div>${noTransportCards.join('')}`;
      return `<section class="home-print-page"><h1 class="home-print-title">${escapeHtml(pageLabel)}</h1><main class="home-print-list">${staffHtml}</main></section>`;
    };
    const homePrintPages = printPages?.length
      ? printPages
      : [{ dateStr, attendance, shiftStaff, assignments }];
    const homePrintPagesHtml = homePrintPages.map(renderHomePrintPage).join('');

    const homeOverviewHtml = `
      <!doctype html>
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(dateLabel)} 送迎担当</title>
          <style>
            @page { size: A4 portrait; margin: 7mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #202426; }
            .home-print-page { break-after: page; page-break-after: always; }
            .home-print-page:last-child { break-after: auto; page-break-after: auto; }
            .home-print-title { margin: 0 0 4mm; text-align: center; font-size: 20px; font-weight: 900; }
            .home-print-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2mm; align-items: start; }
            .home-print-staff-column { display: flex; flex-direction: column; gap: 2mm; min-width: 0; }
            .home-print-staff { break-inside: avoid; border: 4px solid var(--staff-color); border-radius: 4mm; padding: 2.4mm 3mm; }
            .home-print-staff.no-transport { background: #FAFAFA; }
            .home-print-staff-head { display: flex; align-items: center; gap: 2mm; margin-bottom: 2mm; font-size: 11px; }
            .home-print-dot { width: 3mm; height: 3mm; border-radius: 50%; flex: 0 0 auto; }
            .home-print-shift { margin-left: 1mm; padding: 1mm 2mm; border-radius: 3mm; background: #EDF4F4; color: #46585B; font-size: 8px; font-weight: 800; }
            .home-print-trips { display: block; margin-left: 0; padding-left: 3mm; border-left: 2px solid var(--staff-color); }
            .home-print-trip { position: relative; min-width: 0; padding-left: 1mm; margin-bottom: 2mm; }
            .home-print-trip:last-child { margin-bottom: 0; }
            .home-print-number { position: absolute; left: -5.5mm; top: 0; width: 5mm; height: 5mm; border-radius: 50%; border: 1px solid var(--trip-color); background: var(--trip-color); color: #fff; font-size: 8px; font-weight: 900; text-align: center; line-height: 4.7mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .home-print-trip-body { min-height: 9mm; border: 1px solid; border-radius: 2.5mm; overflow: hidden; }
            .home-print-stop { display: grid; grid-template-columns: minmax(0, 44%) minmax(0, 56%); gap: 2mm; align-items: center; padding: 1.7mm 2.4mm; font-size: 9px; line-height: 1.25; }
            .home-print-stop + .home-print-stop { border-top: 1px solid #E5E5E5; }
            .home-print-main { display: flex; align-items: flex-start; gap: 1.5mm; min-width: 0; }
            .home-print-time { flex: 0 0 13mm; color: #E57D00; font-size: 13px; font-weight: 900; }
            .home-print-stop strong { min-width: 0; font-size: 13px; overflow-wrap: anywhere; }
            .home-print-stop strong.lesson { color: #2577C9; }
            .home-print-kids { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 1.2mm; row-gap: 0.7mm; min-width: 0; padding-left: 2.4mm; border-left: 1px solid #E5E5E5; color: #333; font-size: 9px; font-weight: 700; }
            .home-print-kids span { min-width: 0; white-space: nowrap; }
            .home-print-empty { color: #7A8587; font-size: 8px; padding: 1mm 2mm; }
            .home-print-staff.no-transport .home-print-trips { border-left-color: #A3A3A3; }
            .home-print-no-transport-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .home-print-no-transport-column + .home-print-no-transport-column { border-left: 1px solid #D8D8D8; }
            .home-print-no-transport-column .home-print-stop + .home-print-stop { border-top: 1px solid #E5E5E5; }
            .home-print-no-transport-blank { min-height: 10.5mm; }
            .home-print-staff.no-transport { grid-column: 1 / -1; }
          </style>
        </head>
        <body>
          ${homePrintPagesHtml}
        </body>
      </html>
    `;

    const html = printOnly ? homeOverviewHtml : `
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
              overflow: hidden;
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
              position: relative;
              isolation: isolate;
              align-items: stretch;
              min-height: 42px;
            }
            .timeline-shift {
              grid-row: 1;
              min-height: 0;
              background: #FFF0D8;
              opacity: 0.72;
              border-left: 1px solid rgba(226, 194, 67, 0.7);
              border-right: 1px solid rgba(226, 194, 67, 0.7);
              z-index: 0;
            }
            .timeline-grid-line {
              position: absolute;
              top: 0;
              bottom: 0;
              width: 0;
              pointer-events: none;
              border-left: 1px dashed #d7e1e0;
              z-index: 1;
            }
            .timeline-grid-line.hour { border-left: 1.5px solid #a7c9c6; }
            .timeline-block {
              align-self: stretch;
              height: 23px;
              box-sizing: border-box;
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
            .timeline-block-meta {
              display: block;
              font-size: 7px;
              line-height: 7px;
              color: #555;
              font-weight: 700;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .timeline-block-label {
              display: block;
              line-height: 8px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
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
            .kids-grid {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              column-gap: 5px;
              row-gap: 2px;
            }
            .kid-entry {
              min-width: 0;
              font-size: 7px;
              line-height: 1.15;
              overflow-wrap: anywhere;
              font-weight: 700;
            }
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
    let printStarted = false;
    iframe.onload = () => {
      if (printStarted) return;
      printStarted = true;
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
    iframe.srcdoc = html;
    browserDocument.body.appendChild(iframe);
  };

  useEffect(() => {
    if (!visible) {
      autoPrintTriggeredRef.current = false;
      return;
    }
    if (!autoPrintOnOpen || !showTimeline || autoPrintTriggeredRef.current) return;
    autoPrintTriggeredRef.current = true;
    const timer = setTimeout(() => {
      printTimeline();
      if (printOnly) setTimeout(onClose, 450);
    }, 350);
    return () => clearTimeout(timer);
  }, [visible, autoPrintOnOpen, showTimeline, dateStr]);

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
    const getScreenTimelineLayout = (entry: StaffEntry) => {
      const items = entry.trips.flatMap((trip, tripIndex) => trip.blockKeys.map((blockKey) => {
        const block = blocks.find((item) => item.key === blockKey);
        const offset = getOffsetLeft(block?.time);
        if (!block || offset === null) return null;
        const slotIndex = Math.max(0, Math.floor(offset / COL_WIDTH));
        return { block, tripIndex, slotIndex, lane: 0 };
      }).filter(Boolean) as { block: Block; tripIndex: number; slotIndex: number; lane: number }[])
        .sort((a, b) => a.slotIndex - b.slotIndex);
      const laneEnds: number[] = [];
      items.forEach((item) => {
        let lane = laneEnds.findIndex((endSlot) => endSlot <= item.slotIndex);
        if (lane < 0) lane = laneEnds.length;
        item.lane = lane;
        laneEnds[lane] = item.slotIndex + 3;
      });
      return { items, laneCount: Math.max(1, laneEnds.length) };
    };

    const renderOverviewDestinationTable = (targetRows: typeof rows, columnIndex: number) => (
      <View key={columnIndex} style={styles.overviewTable}>
        <View style={[styles.overviewTableRow, styles.overviewTableHeader]}>
          <Text style={[styles.overviewTableHeadText, styles.overviewTimeCell]}>時刻</Text>
          <Text style={[styles.overviewTableHeadText, styles.overviewTypeCell]}>種別</Text>
          <Text style={[styles.overviewTableHeadText, styles.overviewNameCell]}>行き先</Text>
          <Text style={[styles.overviewTableHeadText, styles.overviewCountCell]}>人数</Text>
          <Text style={[styles.overviewTableHeadText, styles.overviewStaffCell]}>担当</Text>
          <Text style={[styles.overviewTableHeadText, styles.overviewKidsCell]}>児童名</Text>
        </View>
        {targetRows.map((row, index) => {
          const isSwimming = row.name.includes('スイミング');
          const rowBackground = isSwimming ? '#E6F9FF' : row.typeLabel === '習い事' ? '#EFF9F2' : '#FFF8E8';
          return (
            <View key={`${columnIndex}_${row.time}_${row.name}_${index}`} style={[styles.overviewTableRow, { backgroundColor: rowBackground }]}>
              <Text style={[styles.overviewTableText, styles.overviewTimeCell, styles.overviewTimeText]}>{row.time}</Text>
              <Text style={[styles.overviewTableText, styles.overviewTypeCell, row.typeLabel === '習い事' ? styles.overviewLessonText : styles.overviewPickupText]}>{row.typeLabel}</Text>
              <Text style={[styles.overviewTableText, styles.overviewNameCell, styles.overviewNameText]}>{row.name}</Text>
              <Text style={[styles.overviewTableText, styles.overviewCountCell]}>{row.count}名</Text>
              <Text style={[styles.overviewTableText, styles.overviewStaffCell]}>{row.staffName}</Text>
              <Text style={[styles.overviewTableText, styles.overviewKidsCell]}>{row.kids.join('、') || '-'}</Text>
            </View>
          );
        })}
      </View>
    );

    const landscapeWidth = Math.max(windowWidth, windowHeight);
    const landscapeHeight = Math.min(windowWidth, windowHeight);
    const expandedLabelWidth = 88;
    const expandedColWidth = Math.max(14, (landscapeWidth - expandedLabelWidth - 28) / ((END_HOUR - START_HOUR) * 4));
    const expandedTimelineWidth = expandedColWidth * (END_HOUR - START_HOUR) * 4;
    const isPortraitViewport = windowHeight > windowWidth;

    const renderExpandedTimelineBoard = () => (
      <View style={[styles.zoomTimelineFrame, { width: expandedLabelWidth + expandedTimelineWidth }]}>
        <View style={styles.zoomTimelineHeaderRow}>
          <View style={[styles.zoomTimelineLabel, { width: expandedLabelWidth }]}>
            <Text style={styles.zoomTimelineCornerText}>担当</Text>
          </View>
          <View style={{ width: expandedTimelineWidth, flexDirection: 'row' }}>
            {timeHeaders.map(hour => (
              <View key={hour} style={[styles.zoomTimelineHour, { width: expandedColWidth * 4 }]}>
                <Text style={styles.zoomTimelineHourText}>{hour}:00</Text>
              </View>
            ))}
          </View>
        </View>

        {staffEntries.map((entry, staffIndex) => {
          if (entry.staffName === '送迎しない') return null;
          const shift = getStaffShift(entry.staffName);
          const layout = getScreenTimelineLayout(entry);
          const rowHeight = Math.max(42, layout.laneCount * 27);
          const toLeft = (time?: string) => {
            if (!time) return null;
            const [hour, minute] = time.split(':').map(Number);
            return (((hour - START_HOUR) * 60 + minute) / 15) * expandedColWidth;
          };
          const shiftStart = toLeft(shift?.start);
          const shiftEnd = toLeft(shift?.end);
          const shiftLeft = shiftStart === null ? 0 : Math.max(0, shiftStart);
          const shiftWidth = shiftStart !== null && shiftEnd !== null && shiftEnd > shiftStart ? shiftEnd - shiftLeft : 0;

          return (
            <View key={`${entry.staffName}_${staffIndex}`} style={[styles.zoomTimelineStaffRow, { height: rowHeight }]}>
              <View style={[styles.zoomTimelineLabel, { width: expandedLabelWidth, height: rowHeight }]}>
                <Text style={styles.zoomTimelineStaffName}>{entry.staffName}</Text>
                <Text style={styles.zoomTimelineShiftText}>{shift?.start || '-'} ~ {shift?.end || '-'}</Text>
              </View>
              <View style={{ width: expandedTimelineWidth, height: rowHeight, position: 'relative' }}>
                {Array.from({ length: (END_HOUR - START_HOUR) * 4 }).map((_, slotIndex) => (
                  <View key={slotIndex} style={[styles.zoomTimelineGridCell, {
                    left: slotIndex * expandedColWidth,
                    width: expandedColWidth,
                    height: rowHeight,
                    borderLeftWidth: slotIndex % 4 === 0 ? 1.5 : 1,
                    borderStyle: slotIndex % 4 === 0 ? 'solid' : 'dashed',
                    borderColor: slotIndex % 4 === 0 ? '#A7C9C6' : '#D7E1E0',
                  }]} />
                ))}
                {shiftWidth > 0 && <View style={[styles.zoomTimelineShift, { left: shiftLeft, width: shiftWidth, height: rowHeight, backgroundColor: getStaffShiftTimeColor(entry.staffName, staffIndex) }]} />}
                {layout.items.map(({ block, slotIndex, lane }, blockIndex) => {
                  const isSwimming = (block.nameOnly || block.label).includes('スイミング');
                  const isLesson = block.type === 'lesson';
                  const backgroundColor = isSwimming ? '#DDF7FF' : isLesson ? '#EAF7EF' : '#FFF4D8';
                  const borderColor = isSwimming ? '#46B8D7' : isLesson ? '#78C28C' : '#F2B760';
                  return (
                    <View key={`${block.key}_${blockIndex}`} style={[styles.zoomTimelineBlock, {
                      left: slotIndex * expandedColWidth,
                      top: lane * 27 + 2,
                      width: expandedColWidth * 3,
                      backgroundColor,
                      borderColor,
                    }]}>
                      <Text style={styles.zoomTimelineBlockTrip} numberOfLines={1}>{block.time || '-'}・{block.count}名</Text>
                      <Text style={styles.zoomTimelineBlockText} numberOfLines={1} adjustsFontSizeToFit>
                        {block.nameOnly || block.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}

        <View style={styles.zoomTimelineRoomRow}>
          <View style={[styles.zoomTimelineRoomLabel, { width: expandedLabelWidth }]}>
            <Text style={styles.zoomTimelineRoomLabelText}>室内スタッフ</Text>
          </View>
          <View style={{ width: expandedTimelineWidth, flexDirection: 'row' }}>
            {roomStaffCounts.map((count, index) => (
              <View key={index} style={[styles.zoomTimelineRoomCell, { width: expandedColWidth }, index % 4 === 0 && styles.overviewRoomCountHourCell]}>
                <Text style={styles.zoomTimelineRoomValue}>{count}<Text style={styles.zoomTimelineRoomUnit}>名</Text></Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );

    return (
      <>
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

        <Text style={styles.overviewSectionTitle}>送迎先一覧</Text>
        {rows.length > 0 ? (
          renderOverviewDestinationTable(rows, 0)
        ) : (
          <Text style={styles.overviewEmptyText}>この日の送迎予定はありません</Text>
        )}

        <View style={styles.overviewTimelineTitleRow}>
          <Text style={styles.overviewSectionTitle}>スタッフ時間表</Text>
          <TouchableOpacity style={styles.overviewZoomButton} onPress={() => setTimelineZoomVisible(true)}>
            <Ionicons name="expand-outline" size={14} color="#247A82" />
            <Text style={styles.overviewZoomButtonText}>横画面で拡大</Text>
          </TouchableOpacity>
        </View>
        <Pressable onPress={() => setTimelineZoomVisible(true)}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={styles.overviewTimelineFrame}>
            <View style={{ flexDirection: 'row', height: 30, borderBottomWidth: 1, borderColor: '#CFE0DF' }}>
              <View style={styles.overviewTimelineCorner}>
                <Text style={styles.overviewTimelineCornerText}>担当</Text>
              </View>
              <View style={{ flexDirection: 'row', width: TIMELINE_WIDTH }}>
                {/* 時間のヘッダー */}
                {timeHeaders.map(h => (
                  <View key={h} style={{ width: COL_WIDTH * 4, borderLeftWidth: 1.5, borderColor: '#8FB8B5', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ width: '100%', textAlign: 'center', fontSize: 11, color: '#333', fontWeight: 'bold' }}>{h}:00</Text>
                  </View>
                ))}
              </View>
            </View>

              {/* 各スタッフのタイムライン */}
              {staffEntries.map((entry, sIdx) => {
                if (entry.staffName === '送迎しない') return null;

                const shift = getStaffShift(entry.staffName);
                const timelineLayout = getScreenTimelineLayout(entry);
                const rowHeight = Math.max(42, timelineLayout.laneCount * 27);
                const startX = getOffsetLeft(shift?.start);
                const endX = getOffsetLeft(shift?.end);
                let shiftLeft = 0;
                let shiftWidth = 0;
                if (startX !== null && endX !== null && endX > startX) {
                  shiftLeft = Math.max(0, startX);
                  shiftWidth = endX - shiftLeft;
                }

                return (
                  <View key={sIdx} style={{ flexDirection: 'row', height: rowHeight, borderBottomWidth: 1, borderColor: '#EDF2F1' }}>
                    {/* 左側：スタッフ名とシフト時間 */}
                    <View style={{ width: 100, justifyContent: 'center', paddingLeft: 10, borderRightWidth: 1, borderColor: '#CFE0DF', backgroundColor: '#FBFBFB', zIndex: 2 }}>
                      <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#333' }}>{entry.staffName}</Text>
                      <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{shift?.start || '-'} ~ {shift?.end || '-'}</Text>
                    </View>

                    {/* 右側：タイムライン領域 */}
                    <View style={{ width: TIMELINE_WIDTH, position: 'relative' }}>
                      {/* 15分ごとの点線と1時間ごとの実線 */}
                      {Array.from({ length: (END_HOUR - START_HOUR) * 4 }).map((_, i) => (
                        <View key={i} style={{ position: 'absolute', left: i * COL_WIDTH, width: COL_WIDTH, height: rowHeight, borderLeftWidth: i % 4 === 0 ? 1.5 : 1, borderStyle: i % 4 === 0 ? 'solid' : 'dashed', borderColor: i % 4 === 0 ? '#A7C9C6' : '#D7E1E0', zIndex: 1 }} />
                      ))}

                      {/* シフト時間のハイライト（薄い黄色） */}
                      {shiftWidth > 0 && (
                        <View style={{ position: 'absolute', left: shiftLeft, width: shiftWidth, height: rowHeight, backgroundColor: getStaffShiftTimeColor(entry.staffName, sIdx), opacity: 0.72 }} />
                      )}

                      {/* 印刷と同じく、重なる送迎は上下の段へ分けて表示 */}
                      {timelineLayout.items.map(({ block, slotIndex, lane }, blockIndex) => {
                        const isSwimming = (block.nameOnly || block.label).includes('スイミング');
                        const isLesson = block.type === 'lesson';
                        const bgColor = isSwimming ? '#DDF7FF' : isLesson ? '#EAF7EF' : '#FFF4D8';
                        const borderColor = isSwimming ? '#46B8D7' : isLesson ? '#78C28C' : '#F2B760';
                        return (
                          <View key={`${block.key}_${blockIndex}`} style={{
                            position: 'absolute', left: slotIndex * COL_WIDTH, top: lane * 27 + 2, height: 23,
                            width: COL_WIDTH * 3,
                            backgroundColor: bgColor, borderWidth: 1, borderColor, borderRadius: 6,
                            paddingHorizontal: 4, paddingVertical: 2, justifyContent: 'center', zIndex: 2,
                          }}>
                            <Text style={{ fontSize: 7, lineHeight: 8, color: '#555', fontWeight: '800' }} numberOfLines={1}>
                              {block.time || '-'}・{block.count}名
                            </Text>
                            <Text style={{ fontSize: 8, lineHeight: 9, color: '#222', fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit>
                              {block.nameOnly || block.label}
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
        </Pressable>
      </ScrollView>

      <Modal
        visible={timelineZoomVisible}
        transparent
        animationType="fade"
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
        onRequestClose={() => setTimelineZoomVisible(false)}
      >
        <View style={styles.timelineZoomOverlay}>
          <View style={[
            styles.timelineZoomViewport,
            isPortraitViewport
              ? { width: landscapeWidth, height: landscapeHeight, transform: [{ rotate: '90deg' }] }
              : { width: windowWidth, height: windowHeight },
          ]}>
            <View style={styles.timelineZoomHeader}>
              <View>
                <Text style={styles.timelineZoomTitle}>スタッフ時間表</Text>
                <Text style={styles.timelineZoomDate}>{dateLabel}</Text>
              </View>
              <TouchableOpacity style={styles.timelineZoomClose} onPress={() => setTimelineZoomVisible(false)}>
                <Ionicons name="close" size={26} color="#222222" />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.timelineZoomScroll}
              contentContainerStyle={styles.timelineZoomScrollContent}
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
            >
              {renderExpandedTimelineBoard()}
            </ScrollView>
          </View>
        </View>
      </Modal>
      </>
    );
  };

  if (printOnly) {
    return <Modal visible={visible} transparent animationType="none"><View style={styles.printOnlyOverlay} /></Modal>;
  }

  return (
    <>
    <Modal visible={visible} animationType="none" transparent>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={[StyleSheet.absoluteFillObject, styles.modalDismissArea]} />
        </TouchableWithoutFeedback>
        <View style={styles.container}>
          {/* ヘッダー */}
          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <View style={styles.headerTitleGroup}>
                <View style={styles.dateNavigation}>
                  <TouchableOpacity style={styles.dateNavigationButton} onPress={() => changeDate(-1)} accessibilityRole="button" accessibilityLabel="前日へ">
                    <Ionicons name="chevron-back" size={18} color={COLORS.text} />
                  </TouchableOpacity>
                  <Text style={styles.dateNavigationLabel}>{dateLabel}</Text>
                  <TouchableOpacity style={styles.dateNavigationButton} onPress={() => changeDate(1)} accessibilityRole="button" accessibilityLabel="翌日へ">
                    <Ionicons name="chevron-forward" size={18} color={COLORS.text} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.headerActions}>
                {showTimeline ? (
                  <TouchableOpacity style={styles.printBtn} onPress={printTimeline}>
                    <Ionicons name="print-outline" size={14} color="#fff" />
                    <Text style={styles.printBtnText}>印刷</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <TouchableOpacity style={styles.printIconBtn} onPress={printTimeline} accessibilityLabel="印刷">
                      <Ionicons name="print-outline" size={20} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.lastWeekBtn, showLastWeek && styles.lastWeekBtnActive]} onPress={openLastWeekModal}>
                      <Text style={[styles.lastWeekBtnText, showLastWeek && { color: '#fff' }]}>先週</Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                  <Ionicons name="close" size={26} color={COLORS.text} />
                </TouchableOpacity>
              </View>
            </View>

            {!readOnly && (
              <View style={styles.modeTabs} accessibilityRole="tablist">
                <TouchableOpacity
                  style={[styles.modeTab, showTimeline && styles.modeTabActive]}
                  onPress={() => setShowTimeline(true)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: showTimeline }}
                >
                  <Ionicons name="list-outline" size={16} color={showTimeline ? '#FFFFFF' : '#52606A'} />
                  <Text style={[styles.modeTabText, showTimeline && styles.modeTabTextActive]}>全体表示</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeTab, !showTimeline && styles.modeTabActive]}
                  onPress={() => setShowTimeline(false)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: !showTimeline }}
                >
                  <Ionicons name="create-outline" size={16} color={!showTimeline ? '#FFFFFF' : '#52606A'} />
                  <Text style={[styles.modeTabText, !showTimeline && styles.modeTabTextActive]}>編集</Text>
                </TouchableOpacity>
              </View>
            )}
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
                  const staffShift = isNoTransport ? null : getStaffShift(entry.staffName);
                  
                  return (
                    <View key={entry.staffName} style={[styles.staffSection, { borderLeftColor: color }]}>
                      <View style={styles.staffNameRow}>
                        <View style={[styles.staffDot, { backgroundColor: color }]} />
                        <Text style={[styles.staffName, isNoTransport && { color: '#757575' }]}>{entry.staffName}</Text>
                        {staffShift?.start && staffShift?.end && (
                          <Text style={styles.staffShiftTime}>{staffShift.start} - {staffShift.end}</Text>
                        )}
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
                              {!selectedBlock && (
                                <Text style={styles.tripLabelText}>{TRIP_LABELS[tIdx] || `${tIdx+1}回`}</Text>
                              )}
                              {trip.blockKeys.length > 0 ? (
                                <View style={{ flex: 1 }}>
                                  {trip.blockKeys.map((bk) => {
                                    const blk = blocks.find(b => b.key === bk);
                                    const nameColor = blk?.type === 'lesson' ? '#2577C9' : '#111111';
                                    return blk ? (
                                      <Text key={bk} style={[styles.slotFilledText, { color: nameColor }]} numberOfLines={1}>
                                        {blk.label}（{blk.count}名）
                                      </Text>
                                    ) : null;
                                  })}
                                  {selectedBlock && (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
                                      <View style={{ width: 13, height: 13, borderRadius: 7, borderWidth: 1.2, borderColor: '#D94B4B', alignItems: 'center', justifyContent: 'center' }}>
                                        <Text style={{ fontSize: 10, lineHeight: 11, color: '#D94B4B', fontWeight: '900' }}>＋</Text>
                                      </View>
                                      <Text style={{ fontSize: 9, color: '#D94B4B', fontWeight: '900' }}>{TRIP_LABELS[tIdx] || `${tIdx + 1}回目`}に追加</Text>
                                    </View>
                                  )}
                                </View>
                              ) : (
                                selectedBlock ? (
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                    <View style={{ width: 13, height: 13, borderRadius: 7, borderWidth: 1.2, borderColor: '#D94B4B', alignItems: 'center', justifyContent: 'center' }}>
                                      <Text style={{ fontSize: 10, lineHeight: 11, color: '#D94B4B', fontWeight: '900' }}>＋</Text>
                                    </View>
                                    <Text style={{ fontSize: 9, color: '#D94B4B', fontWeight: '900' }}>{TRIP_LABELS[tIdx] || `${tIdx + 1}回目`}に追加</Text>
                                  </View>
                                ) : (
                                  <Text style={styles.slotEmptyText}>空き</Text>
                                )
                              )}
                            </TouchableOpacity>
                          );
                        })}
                        {/* 新しい回を追加するボタン（selectedBlock選択中のみ） */}
                        {selectedBlock && !isNoTransport && entry.trips[entry.trips.length - 1]?.blockKeys.length > 0 && (
                          <TouchableOpacity
                            style={[styles.tripSlot, styles.tripSlotAdd]}
                            onPress={() => assignBlockToStaff(sIdx, null, selectedBlock.key)}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="add-circle-outline" size={16} color={COLORS.primary} />
                            <Text style={styles.addSlotText}>{TRIP_LABELS[entry.trips.length] || `${entry.trips.length+1}回目`}に追加</Text>
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
                <View style={styles.rightTitleRow}>
                  <Text style={styles.rightTitle}>送迎先</Text>
                </View>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {blocks.map((block, bIdx) => {
                    const bColor = STAFF_COLORS[bIdx % STAFF_COLORS.length];
                    const nameColor = block.type === 'lesson' ? '#2577C9' : '#111111';
                    const isAssigned = assignedBlockKeys.has(block.key);
                    const customBlock = customBlocks.find(item => item.id === block.key);
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
                        onPress={() => {
                          if (!isAssigned) setSelectedBlock(isSelected ? null : block);
                        }}
                        onLongPress={() => {
                          if (customBlock) setCustomBlockToDelete(customBlock);
                        }}
                        delayLongPress={550}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.blockChipText, { color: nameColor }]}>{block.label}</Text>
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
                  <TouchableOpacity
                    style={styles.addCustomBlockTile}
                    onPress={openCustomBlockForm}
                    activeOpacity={0.72}
                    accessibilityLabel="送迎先を追加"
                  >
                    <View style={styles.addCustomBlockTileIcon}>
                      <Ionicons name="add" size={20} color="#278E98" />
                    </View>
                    <Text style={styles.addCustomBlockTileText}>追加</Text>
                  </TouchableOpacity>
                  </View>
                  {[...assignedBlockKeys].length === blocks.length && blocks.length > 0 && (
                    <View style={{ alignItems: 'center', marginTop: 8 }}>
                      <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                      <Text style={{ fontSize: 10, color: '#4CAF50', fontWeight: 'bold', marginTop: 2 }}>全完了</Text>
                    </View>
                  )}
                  <Text style={styles.customBlockDeleteHint}>
                    追加した送迎先は長押しで削除できます
                  </Text>
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
                    const nameColor = blk?.type === 'lesson' ? '#2577C9' : '#111111';
                    return (
                      <View key={bk} style={[styles.detailRow, { borderLeftColor: bkColor }]}>
                        <View style={styles.detailRowContent}>
                          <Text style={[styles.detailRowText, { color: nameColor }]}>
                            {blk ? `${blk.label}（${blk.count}名）` : bk}
                          </Text>
                          {blk && (blk.kids || []).length > 0 && (
                            <Text style={styles.detailMemberNames}>
                              {(blk.kids || [])
                                .map((kid: any) => `${kid.name || '名前未登録'}${kid.grade ? `（${kid.grade}）` : ''}`)
                                .join('、')}
                            </Text>
                          )}
                        </View>
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
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#F7FBFA', borderBottomWidth: 1, borderColor: '#CFE4E2' }}>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#222222' }}>
              {lastWeekDate.getMonth()+1}/{lastWeekDate.getDate()}（{DOW_JP[lastWeekDate.getDay()]}）の送迎担当
            </Text>
            <TouchableOpacity onPress={() => setLastWeekModalVisible(false)} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CFE4E2' }}>
              <Ionicons name="close" size={24} color="#333333" />
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
                <View key={entry.staffName} style={{ marginBottom: 10, padding: 12, backgroundColor: LAST_WEEK_CARD_COLORS[idx % LAST_WEEK_CARD_COLORS.length].background, borderRadius: 12, borderWidth: 1, borderColor: '#E4E7E8', borderLeftWidth: 5, borderLeftColor: LAST_WEEK_CARD_COLORS[idx % LAST_WEEK_CARD_COLORS.length].border }}>
                  <Text style={{ fontWeight: '900', fontSize: 15, color: '#222222', marginBottom: 8 }}>{entry.staffName}</Text>
                  {entry.trips.map((trip, tIdx) => (
                    trip.blockKeys.length > 0 ? (
                      <View key={tIdx} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5, borderTopWidth: tIdx > 0 ? 1 : 0, borderTopColor: 'rgba(0,0,0,0.07)' }}>
                        <View style={{ minWidth: 48, marginRight: 8, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7, backgroundColor: '#E4F4F3', alignItems: 'center' }}>
                          <Text style={{ fontSize: 11, color: '#276D70', fontWeight: '900' }}>{TRIP_LABELS[tIdx] || `${tIdx+1}回`}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          {trip.blockKeys.map((bk: string) => (
                            <Text key={bk} style={{ fontSize: 13, lineHeight: 19, color: '#222222', fontWeight: '700' }}>• {formatLastWeekBlock(bk)}</Text>
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

    {/* イレギュラー送迎先の追加 */}
    <Modal
      visible={customBlockModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setCustomBlockModalVisible(false)}
    >
      <View style={styles.customBlockOverlay}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, styles.modalDismissArea]}
          onPress={() => setCustomBlockModalVisible(false)}
          accessibilityLabel="閉じる"
        />
        <View style={styles.customBlockPanel}>
          <View style={styles.customBlockHeader}>
            <View>
              <Text style={styles.customBlockTitle}>送迎先を追加</Text>
              <Text style={styles.customBlockSub}>その日だけの送迎予定を登録します</Text>
            </View>
            <TouchableOpacity style={styles.customBlockCloseBtn} onPress={() => setCustomBlockModalVisible(false)}>
              <Ionicons name="close" size={22} color="#333333" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.customBlockLabel}>種類</Text>
            <View style={styles.customTypeRow}>
              <TouchableOpacity
                style={[styles.customTypeBtn, customTransportType === 'school' && styles.customTypePickupActive]}
                onPress={() => setCustomTransportType('school')}
              >
                <Text style={[styles.customTypeText, customTransportType === 'school' && styles.customTypePickupText]}>お迎え</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.customTypeBtn, customTransportType === 'lesson' && styles.customTypeLessonActive]}
                onPress={() => setCustomTransportType('lesson')}
              >
                <Text style={[styles.customTypeText, customTransportType === 'lesson' && styles.customTypeLessonText]}>習い事</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.customBlockLabel}>送迎先</Text>
            <TextInput
              style={styles.customBlockInput}
              value={customDestination}
              onChangeText={(value) => { setCustomDestination(value); setCustomBlockError(''); }}
              placeholder="例：サッカー"
              placeholderTextColor="#999999"
            />

            <Text style={styles.customBlockLabel}>時刻</Text>
            <View style={styles.customPickerColumns} nativeID="ui-time-wheel-transport">
              <View style={styles.customPickerSelectionFrame} pointerEvents="none" />
              <View ref={customHourWheelWrapRef} style={styles.customPickerScrollWrap}>
                <WebScrollView
                  ref={customHourScrollRef}
                  style={styles.customPickerScroll}
                  contentContainerStyle={styles.customPickerScrollInner}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={CUSTOM_TIME_ITEM_HEIGHT}
                  snapToOffsets={CUSTOM_TIME_HOURS.map((_, index) => index * CUSTOM_TIME_ITEM_HEIGHT)}
                  decelerationRate="fast"
                  disableIntervalMomentum
                  nestedScrollEnabled
                  scrollEventThrottle={16}
                onScroll={(event: any) => {
                  const y = event.nativeEvent.contentOffset.y;
                  updateCustomTimeFromScroll(CUSTOM_TIME_HOURS, y, customHour, setCustomHour);
                  scheduleCustomTimeSnap(
                    CUSTOM_TIME_HOURS,
                    y,
                    setCustomHour,
                    customHourScrollRef,
                    customHourSnapTimerRef,
                  );
                }}
                onMomentumScrollEnd={(event: any) => settleCustomTimeWheel(
                  CUSTOM_TIME_HOURS,
                  event.nativeEvent.contentOffset.y,
                  setCustomHour,
                  customHourScrollRef,
                )}
                onScrollEndDrag={(event: any) => settleCustomTimeWheel(
                  CUSTOM_TIME_HOURS,
                  event.nativeEvent.contentOffset.y,
                  setCustomHour,
                  customHourScrollRef,
                )}
              >
                {CUSTOM_TIME_HOURS.map(hour => (
                  <TouchableOpacity
                    key={hour}
                    style={styles.customPickerItem}
                    onPress={() => selectCustomTimeValue(CUSTOM_TIME_HOURS, hour, setCustomHour, customHourScrollRef)}
                  >
                    <Text style={[styles.customPickerItemText, customHour === hour && styles.customPickerItemTextActive]}>
                      {String(hour).padStart(2, '0')}
                    </Text>
                  </TouchableOpacity>
                ))}
                </WebScrollView>
              </View>
              <Text style={styles.customPickerColon}>:</Text>
              <View ref={customMinuteWheelWrapRef} style={styles.customPickerScrollWrap}>
                <WebScrollView
                  ref={customMinuteScrollRef}
                  style={styles.customPickerScroll}
                  contentContainerStyle={styles.customPickerScrollInner}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={CUSTOM_TIME_ITEM_HEIGHT}
                  snapToOffsets={CUSTOM_TIME_MINUTES.map((_, index) => index * CUSTOM_TIME_ITEM_HEIGHT)}
                  decelerationRate="fast"
                  disableIntervalMomentum
                  nestedScrollEnabled
                  scrollEventThrottle={16}
                onScroll={(event: any) => {
                  const y = event.nativeEvent.contentOffset.y;
                  updateCustomTimeFromScroll(CUSTOM_TIME_MINUTES, y, customMinute, setCustomMinute);
                  scheduleCustomTimeSnap(
                    CUSTOM_TIME_MINUTES,
                    y,
                    setCustomMinute,
                    customMinuteScrollRef,
                    customMinuteSnapTimerRef,
                  );
                }}
                onMomentumScrollEnd={(event: any) => settleCustomTimeWheel(
                  CUSTOM_TIME_MINUTES,
                  event.nativeEvent.contentOffset.y,
                  setCustomMinute,
                  customMinuteScrollRef,
                )}
                onScrollEndDrag={(event: any) => settleCustomTimeWheel(
                  CUSTOM_TIME_MINUTES,
                  event.nativeEvent.contentOffset.y,
                  setCustomMinute,
                  customMinuteScrollRef,
                )}
              >
                {CUSTOM_TIME_MINUTES.map(minute => (
                  <TouchableOpacity
                    key={minute}
                    style={styles.customPickerItem}
                    onPress={() => selectCustomTimeValue(CUSTOM_TIME_MINUTES, minute, setCustomMinute, customMinuteScrollRef)}
                  >
                    <Text style={[styles.customPickerItemText, customMinute === minute && styles.customPickerItemTextActive]}>
                      {String(minute).padStart(2, '0')}
                    </Text>
                  </TouchableOpacity>
                ))}
                </WebScrollView>
              </View>
            </View>

            <Text style={styles.customBlockLabel}>メンバー（任意）</Text>
            <View style={styles.customMemberInputRow}>
              <TextInput
                style={[styles.customBlockInput, styles.customMemberInput]}
                value={customMemberInput}
                onChangeText={(value) => { setCustomMemberInput(value); setCustomBlockError(''); }}
                placeholder="必要な場合のみ名前を入力"
                placeholderTextColor="#999999"
                returnKeyType="done"
                onSubmitEditing={addCustomMember}
              />
              <TouchableOpacity style={styles.customMemberAddBtn} onPress={addCustomMember}>
                <Ionicons name="add" size={18} color="#FFFFFF" />
                <Text style={styles.customMemberAddText}>追加</Text>
              </TouchableOpacity>
            </View>

            {customMembers.length > 0 && (
              <View style={styles.customMemberChips}>
                {customMembers.map(member => (
                  <View key={member} style={styles.customMemberChip}>
                    <Text style={styles.customMemberChipText}>{member}</Text>
                    <TouchableOpacity onPress={() => setCustomMembers(current => current.filter(item => item !== member))}>
                      <Ionicons name="close-circle" size={17} color="#708388" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {!!customBlockError && <Text style={styles.customBlockError}>{customBlockError}</Text>}
          </ScrollView>

          <View style={styles.customBlockActions}>
            <TouchableOpacity style={styles.customBlockCancelBtn} onPress={() => setCustomBlockModalVisible(false)}>
              <Text style={styles.customBlockCancelText}>キャンセル</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.customBlockSaveBtn} onPress={saveCustomBlock}>
              <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
              <Text style={styles.customBlockSaveText}>送迎先を追加</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>

    <Modal visible={!!customBlockToDelete} transparent animationType="fade" onRequestClose={() => setCustomBlockToDelete(null)}>
      <View style={styles.customDeleteOverlay}>
        <Pressable style={[StyleSheet.absoluteFillObject, styles.modalDismissArea]} onPress={() => setCustomBlockToDelete(null)} />
        <View style={styles.customDeletePanel}>
          <View style={styles.customDeleteIcon}>
            <Ionicons name="trash-outline" size={24} color="#C94B4B" />
          </View>
          <Text style={styles.customDeleteTitle}>送迎先を削除しますか？</Text>
          <Text style={styles.customDeleteDescription}>
            {customBlockToDelete?.destination} {customBlockToDelete?.time}
          </Text>
          <Text style={styles.customDeleteNote}>担当に割り当て済みの場合は、担当からも削除されます。</Text>
          <View style={styles.customDeleteActions}>
            <TouchableOpacity style={styles.customDeleteCancelBtn} onPress={() => setCustomBlockToDelete(null)}>
              <Text style={styles.customDeleteCancelText}>キャンセル</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.customDeleteConfirmBtn} onPress={deleteCustomBlock}>
              <Text style={styles.customDeleteConfirmText}>削除する</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: 8 },
  printOnlyOverlay: { flex: 1, backgroundColor: 'transparent' },
  modalDismissArea: { zIndex: 0 },
  container: { width: '100%', maxWidth: 760, height: '92%', backgroundColor: '#FFFFFF', opacity: 1, zIndex: 1, overflow: 'hidden', borderRadius: 24, shadowColor: '#000000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 16, elevation: 14 },
  header: { padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: COLORS.border },
  headerTopRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  headerTitleGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  headerTitle: { fontSize: 15, fontWeight: 'bold', color: COLORS.text },
  dateNavigation: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 10, backgroundColor: '#FFF8ED', paddingHorizontal: 3, paddingVertical: 2 },
  dateNavigationButton: { width: 32, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  dateNavigationLabel: { minWidth: 98, textAlign: 'center', fontSize: 15, fontWeight: '800', color: COLORS.text },
  
  closeBtn: { padding: 4 },
  modeTabs: { width: '100%', maxWidth: 340, minHeight: 40, alignSelf: 'center', marginTop: 9, padding: 3, borderRadius: 12, flexDirection: 'row', backgroundColor: '#EEF2F3', borderWidth: 1, borderColor: '#D8E0E2' },
  modeTab: { flex: 1, minHeight: 34, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  modeTabActive: { backgroundColor: '#4C9CCA' },
  modeTabText: { fontSize: 13, fontWeight: '900', color: '#52606A' },
  modeTabTextActive: { color: '#FFFFFF' },
  printBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, minWidth: 88, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18, backgroundColor: '#56B6C2' },
  printIconBtn: { width: 48, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#56B6C2' },
  printBtnText: { fontSize: 14, color: '#fff', fontWeight: 'bold' },
  overviewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, minWidth: 104, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18, backgroundColor: '#5B9BD5' },
  overviewBtnText: { fontSize: 14, color: '#fff', fontWeight: 'bold' },
  lastWeekBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 40, minWidth: 68, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 18, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: '#fff' },
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
  overviewTimelineTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 7 },
  overviewZoomButton: { minHeight: 34, paddingHorizontal: 11, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#EAF8F8', borderWidth: 1, borderColor: '#9FD5D8' },
  overviewZoomButtonText: { fontSize: 11, fontWeight: '900', color: '#247A82' },
  timelineZoomOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.78)' },
  timelineZoomViewport: { overflow: 'hidden', backgroundColor: '#FFFFFF' },
  timelineZoomHeader: { height: 54, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F8FBFA', borderBottomWidth: 1, borderBottomColor: '#CFE0DF' },
  timelineZoomTitle: { fontSize: 16, fontWeight: '900', color: '#1E2425' },
  timelineZoomDate: { marginTop: 2, fontSize: 10, fontWeight: '700', color: '#657174' },
  timelineZoomClose: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D4DFDE' },
  timelineZoomScroll: { flex: 1 },
  timelineZoomScrollContent: { padding: 12, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  zoomTimelineFrame: { borderWidth: 1, borderColor: '#BBD6D3', borderRadius: 9, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  zoomTimelineHeaderRow: { height: 30, flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#CFE0DF' },
  zoomTimelineLabel: { paddingHorizontal: 7, justifyContent: 'center', backgroundColor: '#FBFBFB', borderRightWidth: 1, borderRightColor: '#CFE0DF', zIndex: 2 },
  zoomTimelineCornerText: { fontSize: 9, fontWeight: '800', color: '#555555' },
  zoomTimelineHour: { alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1.5, borderLeftColor: '#8FB8B5' },
  zoomTimelineHourText: { width: '100%', textAlign: 'center', fontSize: 10, fontWeight: '900', color: '#272727' },
  zoomTimelineStaffRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#EDF2F1' },
  zoomTimelineStaffName: { fontSize: 11, fontWeight: '900', color: '#272727' },
  zoomTimelineShiftText: { marginTop: 2, fontSize: 8, fontWeight: '700', color: '#737B7D' },
  zoomTimelineGridCell: { position: 'absolute', top: 0 },
  zoomTimelineShift: { position: 'absolute', top: 0, backgroundColor: '#FFF4AC', opacity: 0.72 },
  zoomTimelineBlock: { position: 'absolute', height: 23, borderWidth: 1, borderRadius: 5, paddingHorizontal: 3, paddingVertical: 2, justifyContent: 'center', zIndex: 2 },
  zoomTimelineBlockTrip: { fontSize: 6, lineHeight: 7, fontWeight: '700', color: '#555555' },
  zoomTimelineBlockText: { fontSize: 7, lineHeight: 8, fontWeight: '900', color: '#222222' },
  zoomTimelineRoomRow: { minHeight: 38, flexDirection: 'row', borderTopWidth: 2, borderTopColor: '#9A7AC1', backgroundColor: '#F5F0FB' },
  zoomTimelineRoomLabel: { justifyContent: 'center', paddingHorizontal: 7, borderRightWidth: 1, borderRightColor: '#CFE0DF', backgroundColor: '#EEE5F7' },
  zoomTimelineRoomLabelText: { fontSize: 9, fontWeight: '900', color: '#352B40' },
  zoomTimelineRoomCell: { minHeight: 38, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderStyle: 'dashed', borderLeftColor: '#CBBBDD' },
  zoomTimelineRoomValue: { fontSize: 10, lineHeight: 12, fontWeight: '900', color: '#2D2436' },
  zoomTimelineRoomUnit: { fontSize: 6, fontWeight: '700', color: '#2D2436' },
  overviewTable: { width: '100%', borderLeftWidth: 1, borderTopWidth: 1, borderColor: '#B9DCDA' },
  overviewTableRow: { flexDirection: 'row', minHeight: 27 },
  overviewTableHeader: { minHeight: 26, backgroundColor: '#EEF8F7' },
  overviewTableHeadText: { padding: 4, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#B9DCDA', fontSize: 9, fontWeight: '800', color: '#222' },
  overviewTableText: { padding: 4, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#D7E5E3', fontSize: 9, lineHeight: 12, color: '#222' },
  overviewTimeCell: { width: '10%' },
  overviewTypeCell: { width: '11%' },
  overviewNameCell: { width: '20%' },
  overviewCountCell: { width: '9%', textAlign: 'center' },
  overviewStaffCell: { width: '14%' },
  overviewKidsCell: { flex: 1 },
  overviewTimeText: { fontSize: 10, fontWeight: '800', color: '#111' },
  overviewPickupText: { fontSize: 9, fontWeight: '900', color: '#D94B4B' },
  overviewLessonText: { fontSize: 9, fontWeight: '900', color: '#2577C9' },
  overviewNameText: { fontWeight: '700' },
  overviewEmptyText: { padding: 20, textAlign: 'center', color: '#666', borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#D7E5E3' },
  rightPanel: { width: 160, backgroundColor: '#fff', borderLeftWidth: 1, borderColor: COLORS.border, padding: 6 },
  rightTitleRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 6, position: 'relative' },
  rightTitle: { fontSize: 12, fontWeight: 'bold', color: '#333333', textAlign: 'center' },
  addCustomBlockTile: { width: '47%', minHeight: 82, marginBottom: 6, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: '#72C3C8', backgroundColor: '#F3FBFB', alignItems: 'center', justifyContent: 'center', padding: 6 },
  addCustomBlockTileIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DDF3F3', marginBottom: 4 },
  addCustomBlockTileText: { fontSize: 12, fontWeight: '900', color: '#276F75' },
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
  staffShiftTime: { marginLeft: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, backgroundColor: '#F1F6F6', fontSize: 11, fontWeight: '800', color: '#46585B' },
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
  detailRowContent: { flex: 1, minWidth: 0, paddingRight: 8 },
  detailRowText: { fontSize: 13, fontWeight: 'bold' },
  detailMemberNames: { marginTop: 5, fontSize: 12, lineHeight: 18, fontWeight: '700', color: '#3F3A37' },
  detailRowActions: { flexDirection: 'row', gap: 6 },
  detailActionBtn: { padding: 4 },
  detailCloseBtn: { marginTop: 14, backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  detailCloseBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  customBlockOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  customBlockPanel: { width: '100%', maxWidth: 520, maxHeight: '88%', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 12, zIndex: 1 },
  customBlockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  customBlockTitle: { fontSize: 18, fontWeight: '900', color: '#222222' },
  customBlockSub: { marginTop: 3, fontSize: 11, fontWeight: '600', color: '#6D777A' },
  customBlockCloseBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F7F7', borderWidth: 1, borderColor: '#DDE4E4' },
  customBlockLabel: { marginTop: 10, marginBottom: 6, fontSize: 12, fontWeight: '900', color: '#333333' },
  customTypeRow: { flexDirection: 'row', gap: 8 },
  customTypeBtn: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F7F8', borderWidth: 1.5, borderColor: '#D9DEE1' },
  customTypePickupActive: { backgroundColor: '#FFF2EC', borderColor: '#EF8A6B' },
  customTypeLessonActive: { backgroundColor: '#EDF6FF', borderColor: '#5B9BD5' },
  customTypeText: { fontSize: 13, fontWeight: '800', color: '#555555' },
  customTypePickupText: { color: '#C95035' },
  customTypeLessonText: { color: '#2577C9' },
  customBlockInput: { minHeight: 44, borderWidth: 1.5, borderColor: '#CCD9DA', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#FAFCFC', fontSize: 14, fontWeight: '700', color: '#222222' },
  customPickerColumns: { position: 'relative', width: 190, height: CUSTOM_TIME_VIEW_HEIGHT, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  customPickerSelectionFrame: { position: 'absolute', left: 10, right: 10, top: (CUSTOM_TIME_VIEW_HEIGHT - CUSTOM_TIME_ITEM_HEIGHT) / 2, height: CUSTOM_TIME_ITEM_HEIGHT, borderRadius: 10, backgroundColor: '#E9F7F7', borderWidth: 1.5, borderColor: '#79C7CC' },
  customPickerScrollWrap: { width: 72, height: CUSTOM_TIME_VIEW_HEIGHT, flexGrow: 0, flexShrink: 0, zIndex: 1 },
  customPickerScroll: { width: 72, height: CUSTOM_TIME_VIEW_HEIGHT, flexGrow: 0, flexShrink: 0, zIndex: 1 },
  customPickerScrollInner: { paddingVertical: (CUSTOM_TIME_VIEW_HEIGHT - CUSTOM_TIME_ITEM_HEIGHT) / 2 },
  customPickerColon: { width: 18, marginHorizontal: 2, zIndex: 2, textAlign: 'center', fontSize: 23, fontWeight: '900', color: '#333333' },
  customPickerItem: { height: CUSTOM_TIME_ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  customPickerItemText: { fontSize: 17, fontWeight: '700', color: '#92999B' },
  customPickerItemTextActive: { fontSize: 22, fontWeight: '900', color: '#222222' },
  customMemberInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customMemberInput: { flex: 1 },
  customMemberAddBtn: { minHeight: 44, paddingHorizontal: 13, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#36A9B5' },
  customMemberAddText: { fontSize: 12, fontWeight: '900', color: '#FFFFFF' },
  customMemberChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  customMemberChip: { minHeight: 32, paddingLeft: 10, paddingRight: 6, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EDF6F5', borderWidth: 1, borderColor: '#BFDAD7' },
  customMemberChipText: { fontSize: 12, fontWeight: '800', color: '#263638' },
  customBlockError: { marginTop: 10, fontSize: 12, fontWeight: '800', color: '#D44747' },
  customBlockActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  customBlockCancelBtn: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F5F5', borderWidth: 1, borderColor: '#D8DFDF' },
  customBlockCancelText: { fontSize: 13, fontWeight: '900', color: '#555555' },
  customBlockSaveBtn: { flex: 1.5, minHeight: 46, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#36A9B5' },
  customBlockSaveText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
  customDeleteOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  customDeletePanel: { width: '100%', maxWidth: 360, borderRadius: 18, padding: 20, backgroundColor: '#FFFFFF', alignItems: 'center', shadowColor: '#000000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 12, zIndex: 1 },
  customDeleteIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF0F0', marginBottom: 10 },
  customDeleteTitle: { fontSize: 17, fontWeight: '900', color: '#222222' },
  customDeleteDescription: { marginTop: 8, fontSize: 14, fontWeight: '800', color: '#333333', textAlign: 'center' },
  customDeleteNote: { marginTop: 8, fontSize: 11, lineHeight: 17, fontWeight: '600', color: '#6F7779', textAlign: 'center' },
  customDeleteActions: { width: '100%', flexDirection: 'row', gap: 10, marginTop: 18 },
  customDeleteCancelBtn: { flex: 1, minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F5F5', borderWidth: 1, borderColor: '#D8DFDF' },
  customDeleteCancelText: { fontSize: 13, fontWeight: '900', color: '#555555' },
  customDeleteConfirmBtn: { flex: 1, minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#D95B5B' },
  customDeleteConfirmText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
  customBlockDeleteHint: { marginTop: 12, marginBottom: 8, paddingHorizontal: 4, textAlign: 'center', fontSize: 9, lineHeight: 14, fontWeight: '600', color: '#9AA3A5' },
});
