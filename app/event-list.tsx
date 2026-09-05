import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  collection, deleteDoc, doc, getDoc,
  getDocs, onSnapshot, query, setDoc, where
} from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import AdminBottomNav from '../components/AdminBottomNav';
import { EventMediaThumbnail, EventMediaViewer } from '../components/EventMedia';
import SwipeTabPager from '../components/SwipeTabPager';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import MonthPickerModal from '../components/MonthPickerModal';
import { useRequireRole } from '../hooks/useRequireRole';
import { navigateHome } from '../utils/navigationHome';

const customAlert = (title: string, message?: string) => {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n${message}` : title);
  else Alert.alert(title, message);
};
const customConfirm = (title: string, message: string, onConfirm: () => void) => {
  if (Platform.OS === 'web') { if (window.confirm(`${title}\n${message}`)) onConfirm(); }
  else Alert.alert(title, message, [{ text: 'キャンセル', style: 'cancel' }, { text: 'OK', onPress: onConfirm }]);
};

// ── 型 ──────────────────────────────────────────────────────────
type ChildInfo = { id: string; name: string };
type EventItem = { id: string; dateStr: string; title: string; description: string; deadlineDate?: string; hidden?: boolean; coverImage?: string };
type VacTab = 'summer' | 'winter' | 'spring';
type ContentMode = 'year' | VacTab;
type RichSpan = { text: string; bold?: boolean; italic?: boolean; fontSize?: number; color?: string };
type RichLine = RichSpan[];
type RichDoc = RichLine[];
interface YearEventDetail { id: string; eventId: string; description: RichDoc; items: RichDoc }
interface VacationFlyer { id: string; vacation: VacTab; month: number; uri: string; title: string }
interface PastPhoto {
  id: string;
  eventId: string;
  uri: string;
  storagePath: string;
  fiscalYear?: number;
  mediaType?: 'image' | 'video';
  mimeType?: string;
  duration?: number | null;
}

// ── 定数 ──────────────────────────────────────────────────────
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const TERM1_MONTHS = [4, 5, 6, 7];
const TERM2_MONTHS = [9, 10, 11, 12];
const TERM3_MONTHS = [1, 2, 3];
const VAC_MONTHS: Record<VacTab, number[]> = { summer: [7, 8], winter: [12, 1], spring: [3, 4] };
const TERM_COLORS = {
  1: { bg: '#FFF8E1', border: '#FFD54F', text: '#F57F17', light: '#FFFDE7' },
  2: { bg: '#E8F5E9', border: '#66BB6A', text: '#2E7D32', light: '#F1F8E9' },
  3: { bg: '#E3F2FD', border: '#42A5F5', text: '#1565C0', light: '#E8F4FE' },
};
const VAC_COLORS: Record<VacTab, { bg: string; border: string; text: string; label: string }> = {
  summer: { bg: '#FFF3E0', border: '#FF8F00', text: '#E65100', label: '夏休み' },
  winter: { bg: '#E3F2FD', border: '#1E88E5', text: '#0D47A1', label: '冬休み' },
  spring: { bg: '#FCE4EC', border: '#E91E63', text: '#880E4F', label: '春休み' },
};
const PERIOD_IMAGES = {
  term1: require('../assets/event-periods/term-1.png'),
  term2: require('../assets/event-periods/term-2.png'),
  term3: require('../assets/event-periods/term-3.png'),
  summer: require('../assets/event-periods/summer.png'),
  winter: require('../assets/event-periods/winter.png'),
  spring: require('../assets/event-periods/spring.png'),
};

// ── ユーティリティ ────────────────────────────────────────────
const getFiscalYear = (d: Date) => (d.getMonth() + 1) >= 4 ? d.getFullYear() : d.getFullYear() - 1;
const getCurrentFY = () => getFiscalYear(new Date());
const getFYRange = (fy: number) => ({ start: `${fy}-04-01`, end: `${fy + 1}-03-31` });
const formatDateWithDay = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${DAY_NAMES[d.getDay()]}）`;
};

const getLocalDateString = (date: Date) => {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// RichDoc表示コンポーネント
const RichText = ({ doc: rdoc }: { doc: RichDoc }) => {
  if (!rdoc || rdoc.length === 0) return null;
  const toHtml = (doc: RichDoc) => doc.map(line =>
    '<div>' + (line.length === 0 || (line.length === 1 && !line[0].text) ? '<br>' :
      line.map(s => {
        const st: string[] = [];
        if (s.bold) st.push('font-weight:bold');
        if (s.italic) st.push('font-style:italic');
        if (s.fontSize) st.push(`font-size:${s.fontSize}px`);
        if (s.color && s.color !== '#333333') st.push(`color:${s.color}`);
        const escaped = s.text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return st.length ? `<span style="${st.join(';')}">${escaped}</span>` : escaped;
      }).join('')
    ) + '</div>'
  ).join('');
  if (typeof window !== 'undefined') {
    // @ts-ignore
    return <div dangerouslySetInnerHTML={{ __html: toHtml(rdoc) }} style={{ fontSize: 14, color: '#333', lineHeight: '1.8', wordBreak: 'break-word' } as any} />;
  }
  return <View>{rdoc.map((line, i) => <Text key={i} style={{ fontSize: 14, color: '#333', lineHeight: 22 }}>{line.map(s => s.text).join('')}</Text>)}</View>;
};

const toRichDoc = (data: any): RichDoc => {
  if (!data) return [[{ text: '' }]];
  if (Array.isArray(data) && data.length > 0 && 'spans' in data[0]) return data.map((l: any) => l.spans || [{ text: '' }]);
  if (Array.isArray(data)) return data as RichDoc;
  return [[{ text: '' }]];
};

// ── メイン画面 ───────────────────────────────────────────────
export default function EventListScreen() {
  const { verified, checking } = useRequireRole(['admin', 'staff', 'user']);
  const router = useRouter();
  const { name, eventId: targetEventId, openDetail: openDetailParam } = useLocalSearchParams<{ name: string; eventId?: string; openDetail?: string }>();

  const [tab, setTab] = useState<'register' | 'detail'>('register');

  // ── 参加登録用state ──
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<ChildInfo[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<EventItem[]>([]);
  const [participants, setParticipants] = useState<Record<string, Record<string, string>>>({});
  // カレンダー用
  const [calDate, setCalDate] = useState(new Date());
  const [monthPickerTarget, setMonthPickerTarget] = useState<'year' | 'month' | null>(null);
  const [calSelectedDate, setCalSelectedDate] = useState('');
  const [calModalVisible, setCalModalVisible] = useState(false);
  const [calPublicHolidays, setCalPublicHolidays] = useState<Record<string, string>>({});
  // モーダル内の一時選択状態 key: `${eventId}_${childId}` → '参加'|'不参加'|undefined
  const [tempStatus, setTempStatus] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);

  // ── イベント詳細用state ──
  const [yearEvents, setYearEvents] = useState<Record<string, EventItem[]>>({});   // key: "YYYY-MM"
  const [details, setDetails] = useState<Record<string, YearEventDetail>>({});
  const [flyers, setFlyers] = useState<VacationFlyer[]>([]);
  const [holidayPeriods, setHolidayPeriods] = useState<{ id: string; name: string; start: string; end: string }[]>([]);
  const [myAccountId, setMyAccountId] = useState<string | null>(null);
  const [myParticipations, setMyParticipations] = useState<Record<string, string>>({});

  // 詳細モーダル
  const [detailEvent, setDetailEvent] = useState<EventItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [secDesc, setSecDesc] = useState(false);
  const [secItems, setSecItems] = useState(false);
  const [secPhotos, setSecPhotos] = useState(false);
  const [pastPhotos, setPastPhotos] = useState<Record<string, PastPhoto[]>>({});
  const [previewPhotos, setPreviewPhotos] = useState<PastPhoto[] | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [participationConfirm, setParticipationConfirm] = useState<{ eventId: string; isJoined: boolean } | null>(null);

  // 詳細タブ内のサブタブ
  const [vacTab, setVacTab] = useState<VacTab>('summer');
  const [contentMode, setContentMode] = useState<ContentMode>('year');
  const [contentMenuOpen, setContentMenuOpen] = useState(false);

  // チラシプレビュー
  const [flyerPreview, setFlyerPreview] = useState<VacationFlyer | null>(null);

  const yearScrollRef = useRef<ScrollView>(null);
  const vacScrollRef = useRef<ScrollView>(null);
  const termOffsets = useRef<Record<number, number>>({});
  const vacMonthRefs = useRef<Record<string, number>>({});

  const currentFY = getCurrentFY();
  const { start: fyStart, end: fyEnd } = getFYRange(currentFY);
  const isCurrentFY = (dateStr: string) => dateStr >= fyStart && dateStr <= fyEnd;
  const isInAnyHoliday = (dateStr: string) => holidayPeriods.some(p => dateStr >= p.start && dateStr <= p.end);

  const eventsForMonth = (year: number, month: number) => {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    return yearEvents[ym] || [];
  };
  const eventsForVacMonth = (vacLabel: string, month: number): EventItem[] => {
    const result: EventItem[] = [];
    const periods = holidayPeriods.filter(p => p.name.includes(vacLabel));
    periods.forEach(period => {
      const start = new Date(period.start), end = new Date(period.end);
      let cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        if (cur.getMonth() + 1 === month) {
          const ym = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
          (yearEvents[ym] || []).forEach(ev => {
            if (ev.dateStr >= period.start && ev.dateStr <= period.end && !result.find(r => r.id === ev.id)) result.push(ev);
          });
        }
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
    });
    return result;
  };
  const getVacMonths = (vacLabel: string): number[] => {
    const months = new Set<number>();
    const periods = holidayPeriods.filter(p => p.name.includes(vacLabel));
    periods.forEach(period => {
      const start = new Date(period.start), end = new Date(period.end);
      let cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) { months.add(cur.getMonth() + 1); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); }
    });
    const startMonth = periods.length > 0 ? new Date(periods[0].start).getMonth() + 1 : 4;
    const ordered: number[] = [];
    let m = startMonth;
    for (let i = 0; i < 12; i++) { if (months.has(m)) ordered.push(m); m = m === 12 ? 1 : m + 1; }
    return ordered;
  };

  // ── データ取得 ──────────────────────────────────────────────
  useEffect(() => {
    fetch('https://holidays-jp.github.io/api/v1/date.json')
      .then(r => r.json()).then(d => setCalPublicHolidays(d)).catch(() => {});

    const fetchData = async () => {
      try {
        const targetName = name || '';
        const q = query(collection(db, 'accounts'), where('name', '==', targetName));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const docSnap = snapshot.docs[0];
          const data = docSnap.data();
          const parentId = docSnap.id;
          const loadedChildren: ChildInfo[] = [];
          if (data.role === 'staff' && data.hasChild) {
            if (data.staffChildren?.length > 0) {
              data.staffChildren.forEach((child: any, idx: number) => loadedChildren.push({ id: `${parentId}_child_${idx}`, name: child.name }));
            } else if (data.childName) {
              loadedChildren.push({ id: `${parentId}_child`, name: data.childName });
            }
          } else if (data.role === 'user') {
            loadedChildren.push({ id: parentId, name: data.name });
            setMyAccountId(parentId);
            (data.siblings || []).forEach((sib: any, idx: number) => loadedChildren.push({ id: `${parentId}_sib_${idx}`, name: sib.name }));
          }
          setChildren(loadedChildren);
        }

        // 参加登録用：今日以降のイベント
        const unsubEvents = onSnapshot(collection(db, 'events'), snap => {
          const evList: EventItem[] = [];
          const todayStr = getLocalDateString(new Date());
          snap.forEach(d => {
            const ev = d.data() as EventItem;
            if (ev.dateStr >= todayStr) evList.push(ev);
          });
          evList.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
          setUpcomingEvents(evList);
        });

        // 参加状況
        const unsubParts = onSnapshot(collection(db, 'event_participants'), snap => {
          const pData: Record<string, Record<string, string>> = {};
          const myMap: Record<string, string> = {};
          snap.forEach(d => {
            const item = d.data();
            if (!pData[item.eventId]) pData[item.eventId] = {};
            pData[item.eventId][item.childId] = item.status;
            if (item.childId === snapshot.docs[0]?.id) myMap[item.eventId] = item.status;
          });
          setParticipants(pData);
          setMyParticipations(myMap);
          setLoading(false);
        });

        // イベント詳細用
        const unsubYearEvents = onSnapshot(collection(db, 'events'), snap => {
          const map: Record<string, EventItem[]> = {};
          snap.forEach(d => {
            const ev = { id: d.id, ...d.data() } as EventItem;
            const ym = ev.dateStr?.slice(0, 7);
            if (ym) { if (!map[ym]) map[ym] = []; map[ym].push(ev); }
          });
          setYearEvents(map);
        });

        const unsubDetails = onSnapshot(collection(db, 'year_event_details'), snap => {
          const map: Record<string, YearEventDetail> = {};
          snap.forEach(d => {
            const raw = d.data();
            map[raw.eventId] = { id: d.id, eventId: raw.eventId, description: toRichDoc(raw.description), items: toRichDoc(raw.items) };
          });
          setDetails(map);
        });

        const unsubPastPhotos = onSnapshot(collection(db, 'event_past_photos'), snap => {
          const map: Record<string, PastPhoto[]> = {};
          snap.forEach(d => {
            const p = { id: d.id, ...d.data() } as PastPhoto;
            if (!map[p.eventId]) map[p.eventId] = [];
            map[p.eventId].push(p);
          });
          setPastPhotos(map);
        });

        const unsubFlyers = onSnapshot(collection(db, 'vacation_flyers'), snap => {
          setFlyers(snap.docs.map(d => ({ id: d.id, ...d.data() } as VacationFlyer)));
        });

        getDoc(doc(db, 'settings', 'holidays_data')).then(snap => {
          if (snap.exists() && snap.data().periods) setHolidayPeriods(snap.data().periods);
        });
        const unsubHolidays = onSnapshot(doc(db, 'settings', 'holidays_data'), snap => {
          if (snap.exists() && snap.data()?.periods) setHolidayPeriods(snap.data().periods);
        });

        return () => { unsubEvents(); unsubParts(); unsubYearEvents(); unsubDetails(); unsubPastPhotos(); unsubFlyers(); unsubHolidays(); };
      } catch (error) {
        console.error('データ取得エラー:', error);
        setLoading(false);
      }
    };
    fetchData();
  }, [name]);

  // 参加登録のトグル
  const toggleParticipation = async (eventId: string, childId: string, childName: string, status: string) => {
    try {
      const docId = `${eventId}_${childId}`;
      await setDoc(doc(db, 'event_participants', docId), { eventId, childId, childName, status, updatedAt: new Date() }, { merge: true });
    } catch { customAlert('エラー', '保存に失敗しました'); }
  };

  // 詳細モーダルのイベント参加ボタン（自分自身の参加状態）
  const toggleMyParticipation = (eventId: string) => {
    if (!myAccountId) return;
    const isJoined = myParticipations[eventId] === '参加';
    setParticipationConfirm({ eventId, isJoined });
  };

  const confirmMyParticipation = async () => {
    if (!myAccountId || !participationConfirm) return;
    const { eventId, isJoined } = participationConfirm;
    const docId = `${eventId}_${myAccountId}`;
    setParticipationConfirm(null);
    if (isJoined) {
      await deleteDoc(doc(db, 'event_participants', docId));
      return;
    }
    await setDoc(doc(db, 'event_participants', docId), {
      eventId,
      childId: myAccountId,
      childName: name || '',
      status: '参加',
      updatedAt: new Date(),
    });
  };

  const openDetail = (ev: EventItem) => {
    setDetailEvent(ev);
    setSecDesc(false); setSecItems(false); setSecPhotos(false);
    setDetailOpen(true);
  };

  useEffect(() => {
    if (!targetEventId || openDetailParam !== '1' || loading) return;
    const target = Object.values(yearEvents).flat().find(ev => ev.id === targetEventId);
    if (!target || !details[targetEventId]) return;
    setTab('detail');
    openDetail(target);
  }, [targetEventId, openDetailParam, loading, yearEvents, details]);

  // ── EventChipコンポーネント ───────────────────────────────
  const EventChip = ({ ev }: { ev: EventItem }) => (
    <TouchableOpacity style={styles.eventChip} onPress={() => openDetail(ev)} activeOpacity={0.8}>
      <View style={styles.eventChipImgWrap}>
        {ev.coverImage
          ? <Image source={{ uri: ev.coverImage }} style={styles.eventCoverImgFull} resizeMode="cover" />
          : <View style={[styles.eventCoverImgFull, { backgroundColor: '#E8E8E8' }]}>
            </View>
        }
        <View style={styles.eventChipCaption}>
          <Text style={styles.eventChipTitle} numberOfLines={2}>{ev.title}</Text>
          <Text style={styles.eventChipDate}>{formatDateWithDay(ev.dateStr)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  // ── MonthPairコンポーネント ───────────────────────────────
  const MonthPair = ({ months, termColor }: { months: number[]; termColor: any }) => {
    const pairs: number[][] = [];
    for (let i = 0; i < months.length; i += 2) pairs.push(months.slice(i, i + 2));
    return (
      <View>
        {pairs.map((pair, pi) => (
          <View key={pi} style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            {pair.map(m => {
              const dataYear = m >= 4 ? currentFY : currentFY + 1;
              const evs = eventsForMonth(dataYear, m).filter(ev => !ev.hidden && !isInAnyHoliday(ev.dateStr) && isCurrentFY(ev.dateStr));
              return (
                <View key={m} style={[styles.monthCard, { flex: 1, borderTopColor: termColor.border }]}>
                  <Text style={[styles.monthCardLabel, { color: termColor.text }]}>{m}月</Text>
                  {evs.length === 0 ? (
                    <View style={styles.noEventBox}>
                      <Ionicons name="camera-outline" size={21} color="#C7CAC7" />
                      <Text style={styles.noEventText}>イベントなし</Text>
                    </View>
                  ) : evs.map(ev => <EventChip key={ev.id} ev={ev} />)}
                </View>
              );
            })}
            {pair.length === 1 && <View style={{ flex: 1 }} />}
          </View>
        ))}
      </View>
    );
  };

  // ── VacMonthSectionコンポーネント ────────────────────────
  const VacMonthSection = ({ vac, month }: { vac: VacTab; month: number }) => {
    const vc = VAC_COLORS[vac];
    const monthFlyers = flyers.filter(f => f.vacation === vac && f.month === month);
    const vacEvents = eventsForVacMonth(vc.label, month).filter(ev => !ev.hidden && isCurrentFY(ev.dateStr));
    return (
      <View onLayout={e => { vacMonthRefs.current[`${vac}_${month}`] = e.nativeEvent.layout.y; }}
        style={[styles.vacSection, { borderTopColor: vc.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Text style={[styles.vacMonthLabel, { color: vc.text, flex: 1 }]}>{month}月</Text>
          {monthFlyers.map(flyer => (
            <TouchableOpacity key={flyer.id} style={[styles.flyerBtn, { backgroundColor: vc.border }]} onPress={() => setFlyerPreview(flyer)}>
              <Ionicons name="document-text-outline" size={14} color="#fff" style={{ marginRight: 4 }} />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>詳細</Text>
            </TouchableOpacity>
          ))}
        </View>
        {vacEvents.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {vacEvents.map(ev => (
              <View key={ev.id} style={{ width: '47%' }}>
                <EventChip ev={ev} />
              </View>
            ))}
          </View>
        )}
        {vacEvents.length === 0 && monthFlyers.length === 0 && (
          <Text style={styles.noEventText}>イベント・チラシなし</Text>
        )}
      </View>
    );
  };

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></SafeAreaView>;
  if (checking || !verified) return null;

  const detailDet = detailEvent ? details[detailEvent.id] : undefined;
  const currentFY2 = getCurrentFY();
  const detailPhotos = detailEvent
    ? (pastPhotos[detailEvent.id] || []).filter(p => p.fiscalYear === undefined || p.fiscalYear === currentFY2 - 1)
    : [];

  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigateHome(router)}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>イベント</Text>
      </View>

      {/* メインタブ */}
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tab, tab === 'register' && styles.tabActive]} onPress={() => setTab('register')}>
          <Text style={[styles.tabText, tab === 'register' && styles.tabTextActive]}>参加登録</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'detail' && styles.tabActive]} onPress={() => setTab('detail')}>
          <Text style={[styles.tabText, tab === 'detail' && styles.tabTextActive]}>イベント内容</Text>
        </TouchableOpacity>
      </View>

      <SwipeTabPager
        tabs={['register', 'detail']}
        active={tab}
        onChange={setTab}
        renderTab={(currentTab) => (
          <>
      {/* ══ 参加登録タブ ══════════════════════════════════════ */}
      {currentTab === 'register' && (() => {
        // カレンダー生成
        const todayStr = getLocalDateString(new Date());
        const y = calDate.getFullYear(), m = calDate.getMonth();
        const firstDay = new Date(y, m, 1).getDay();
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const calDays: (null | { day: number; dateStr: string })[] = [];
        for (let i = 0; i < firstDay; i++) calDays.push(null);
        for (let i = 1; i <= daysInMonth; i++) {
          calDays.push({ day: i, dateStr: `${y}-${String(m+1).padStart(2,'0')}-${String(i).padStart(2,'0')}` });
        }

        // その日のイベント取得
        const eventsOnDate = (dateStr: string) => upcomingEvents.filter(ev => ev.dateStr === dateStr);

        // その日・その子の参加状況サマリ
        const statusSummary = (dateStr: string) => {
          const evs = eventsOnDate(dateStr);
          if (evs.length === 0) return null;
          const results: string[] = [];
          evs.forEach(ev => {
            children.forEach(child => {
              const s = participants[ev.id]?.[child.id];
              if (s) results.push(s);
            });
          });
          if (results.length === 0) return null;
          const hasJoin = results.includes('参加');
          const hasAbsent = results.includes('不参加');
          if (hasJoin && hasAbsent) return 'mixed';
          if (hasJoin) return '参加';
          return '不参加';
        };

        // 選択日のイベント
        const selectedEvs = eventsOnDate(calSelectedDate);

        return (
          <View style={{ flex: 1 }}>
            <ScrollView>
              {/* 月ナビ */}
              <View style={styles.calMonthNav}>
                <TouchableOpacity style={styles.calNavBtn} onPress={() => setCalDate(new Date(y, m - 1, 1))}>
                  <Ionicons name="chevron-back" size={22} color={COLORS.text} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.calMonthPartButton} accessibilityRole="button" onPress={() => setMonthPickerTarget('year')}><Text style={styles.calMonthTextLabel}>{y}年</Text></TouchableOpacity>
                <TouchableOpacity style={styles.calMonthPartButton} accessibilityRole="button" onPress={() => setMonthPickerTarget('month')}><Text style={styles.calMonthTextLabel}>{m + 1}月</Text></TouchableOpacity>
                <TouchableOpacity style={styles.calNavBtn} onPress={() => setCalDate(new Date(y, m + 1, 1))}>
                  <Ionicons name="chevron-forward" size={22} color={COLORS.text} />
                </TouchableOpacity>
              </View>

              <MonthPickerModal visible={monthPickerTarget !== null} value={calDate} mode={monthPickerTarget ?? 'month'} onChange={setCalDate} onClose={() => setMonthPickerTarget(null)} />

              {/* 曜日ヘッダー */}
              <View style={styles.calWeekRow}>
                {DAY_NAMES.map((w, i) => (
                  <Text key={i} style={[styles.calWeekText, i === 0 && { color: '#E53935' }, i === 6 && { color: '#1E88E5' }]}>{w}</Text>
                ))}
              </View>

              {/* 日付グリッド */}
              <View style={styles.calGrid}>
                {calDays.map((item, idx) => {
                  if (!item) return <View key={`e-${idx}`} style={styles.calCellEmpty} />;
                  const evs = eventsOnDate(item.dateStr);
                  const dow = new Date(item.dateStr).getDay();
                  const isHol = !!calPublicHolidays[item.dateStr];
                  const dateColor = (dow === 0 || isHol) ? '#E53935' : dow === 6 ? '#1E88E5' : COLORS.text;
                  const isSelected = calSelectedDate === item.dateStr;
                  const summary = statusSummary(item.dateStr);
                  return (
                    <TouchableOpacity
                      key={item.dateStr}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.dateStr}のイベント`}
                      style={[
                        styles.calCell,
                        evs.length > 0 && styles.calCellHasEvent,
                        item.dateStr === todayStr && styles.calCellToday,
                        isSelected && styles.calCellSelected,
                      ]}
                      onPress={() => {
                        setCalSelectedDate(item.dateStr);
                        if (evs.length > 0) {
                          // 現在の参加状況をtempStatusに読み込む
                          const init: Record<string, string | undefined> = {};
                          evs.forEach(ev => {
                            children.forEach(child => {
                              const k = `${ev.id}_${child.id}`;
                              init[k] = participants[ev.id]?.[child.id];
                            });
                          });
                          setTempStatus(init);
                          setCalModalVisible(true);
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.calDayText, { color: dateColor }]}>{item.day}</Text>
                      {evs.map(ev => (
                        <View key={ev.id} style={styles.calEventBadge}>
                          <Text style={styles.calEventBadgeTitle}>{ev.title}</Text>
                          {summary && (
                            <Text style={[
                              styles.calEventBadgeStatus,
                              summary === '参加' && { color: '#4CAF50' },
                              summary === '不参加' && { color: '#E53935' },
                              summary === 'mixed' && { color: '#FF9800' },
                            ]}>
                              {summary === 'mixed' ? '一部申し込み済み' : summary === '参加' ? '申し込み済み' : summary}
                            </Text>
                          )}
                        </View>
                      ))}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={{ height: 40 }} />
            </ScrollView>

            {/* 参加登録モーダル */}
            <Modal visible={calModalVisible} animationType="slide" transparent>
              <SafeAreaView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
                <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderColor: '#EEE' }}>
                    <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#333' }}>{calSelectedDate}</Text>
                    <TouchableOpacity onPress={() => setCalModalVisible(false)}>
                      <Ionicons name="close" size={26} color="#333" />
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={{ padding: 16 }}>
                    {selectedEvs.map(ev => (
                      <View key={ev.id} style={styles.modalEventBlock}>
                        <Text style={styles.modalEventTitle}>{ev.title}</Text>
                        {ev.description ? <Text style={styles.modalEventDesc}>{ev.description}</Text> : null}
                        <View style={{ borderTopWidth: 1, borderColor: '#F0F0F0', paddingTop: 12, marginTop: 8 }}>
                          {children.map(child => {
                            const key = `${ev.id}_${child.id}`;
                            const selected = tempStatus[key];
                            return (
                              <View key={child.id} style={styles.childRow}>
                                <Text style={styles.childName}>
                                  <Ionicons name="person" size={14} color={COLORS.textLight} /> {child.name}
                                </Text>
                                <View style={styles.actionBtns}>
                                  <TouchableOpacity
                                    style={[styles.statusBtn, selected === '参加' && styles.statusBtnActiveY]}
                                    onPress={() => setTempStatus(prev => ({ ...prev, [key]: selected === '参加' ? undefined : '参加' }))}
                                  >
                                    <Text style={[styles.statusBtnText, selected === '参加' && styles.statusBtnTextActiveY]}>参加</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[styles.statusBtn, selected === '不参加' && styles.statusBtnActiveN]}
                                    onPress={() => setTempStatus(prev => ({ ...prev, [key]: selected === '不参加' ? undefined : '不参加' }))}
                                  >
                                    <Text style={[styles.statusBtnText, selected === '不参加' && styles.statusBtnTextActiveN]}>不参加</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    ))}
                    <View style={{ height: 16 }} />
                  </ScrollView>
                  {/* 保存ボタン */}
                  <View style={{ padding: 16, borderTopWidth: 1, borderColor: '#EEE' }}>
                    <TouchableOpacity
                      style={{ backgroundColor: saving ? '#ccc' : COLORS.primary, borderRadius: 12, padding: 14, alignItems: 'center' }}
                      disabled={saving}
                      onPress={async () => {
                        setSaving(true);
                        try {
                          for (const ev of selectedEvs) {
                            for (const child of children) {
                              const key = `${ev.id}_${child.id}`;
                              const status = tempStatus[key];
                              if (status) {
                                await setDoc(doc(db, 'event_participants', `${ev.id}_${child.id}`), {
                                  eventId: ev.id, childId: child.id, childName: child.name,
                                  status, updatedAt: new Date(),
                                }, { merge: true });
                              }
                            }
                          }
                          setCalModalVisible(false);
                        } catch {
                          customAlert('エラー', '保存に失敗しました');
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
                        {saving ? '保存中...' : '保存'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </SafeAreaView>
            </Modal>
          </View>
        );
      })()}

      {/* ══ イベント詳細タブ ══════════════════════════════════ */}
      {currentTab === 'detail' && (
        <View style={{ flex: 1 }}>
          <View style={styles.contentSelectorArea}>
            <TouchableOpacity style={styles.contentSelectorButton} onPress={() => setContentMenuOpen(open => !open)}>
              <Text style={styles.contentSelectorButtonText}>
                {contentMode === 'year' ? '年行事' : VAC_COLORS[contentMode].label}
              </Text>
              <Ionicons name={contentMenuOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#5D4037" />
            </TouchableOpacity>
            {contentMenuOpen && (
              <View style={styles.contentSelectorMenu}>
                {(['year', 'summer', 'winter', 'spring'] as ContentMode[]).map(mode => (
                  <TouchableOpacity
                    key={mode}
                    style={[styles.contentSelectorOption, contentMode === mode && styles.contentSelectorOptionActive]}
                    onPress={() => {
                      setContentMode(mode);
                      if (mode !== 'year') setVacTab(mode);
                      setContentMenuOpen(false);
                    }}
                  >
                    <Text style={[styles.contentSelectorOptionText, contentMode === mode && styles.contentSelectorOptionTextActive]}>
                      {mode === 'year' ? '年行事' : VAC_COLORS[mode].label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {contentMode === 'year' ? (
              <ScrollView ref={yearScrollRef} style={styles.eventContentBackground} contentContainerStyle={styles.eventContentScroll}>
                {([1, 2, 3] as const).map(term => {
                  const tc = TERM_COLORS[term];
                  const months = term === 1 ? TERM1_MONTHS : term === 2 ? TERM2_MONTHS : TERM3_MONTHS;
                  return (
                    <View key={term}
                      onLayout={e => { termOffsets.current[term] = e.nativeEvent.layout.y; }}
                      style={[styles.termSection, { borderTopColor: tc.border }]}
                    >
                      <View style={styles.termHeadingRow}>
                        <Image
                          source={term === 1 ? PERIOD_IMAGES.term1 : term === 2 ? PERIOD_IMAGES.term2 : PERIOD_IMAGES.term3}
                          style={styles.periodHeadingImage}
                          resizeMode="contain"
                        />
                        <View style={styles.termHeadingText}>
                          <Text style={[styles.termLabel, { color: tc.text }]}>{term}学期</Text>
                          <Text style={styles.termMonthRange}>{months[0]}月〜{months[months.length - 1]}月</Text>
                        </View>
                      </View>
                      <View style={[styles.termHeadingLine, { backgroundColor: tc.border }]} />
                      <MonthPair months={months} termColor={tc} />
                    </View>
                  );
                })}
                <View style={{ height: 40 }} />
              </ScrollView>
          ) : (
              <ScrollView ref={vacScrollRef} style={styles.eventContentBackground} contentContainerStyle={styles.eventContentScroll}>
                <View style={styles.vacationHeadingBlock}>
                  <View style={styles.vacationScreenHeading}>
                    <Image source={PERIOD_IMAGES[vacTab]} style={styles.periodHeadingImage} resizeMode="contain" />
                    <View>
                      <Text style={[styles.vacationScreenTitle, { color: VAC_COLORS[vacTab].text }]}>{VAC_COLORS[vacTab].label}</Text>
                      <Text style={styles.vacationScreenRange}>
                        {vacTab === 'summer' ? '7月〜8月' : vacTab === 'winter' ? '12月〜1月' : '3月〜4月'}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.vacationHeadingLine, { backgroundColor: VAC_COLORS[vacTab].border }]} />
                </View>
                {(getVacMonths(VAC_COLORS[vacTab].label).length > 0 ? getVacMonths(VAC_COLORS[vacTab].label) : VAC_MONTHS[vacTab]).map(m => (
                  <VacMonthSection key={m} vac={vacTab} month={m} />
                ))}
                <View style={{ height: 40 }} />
              </ScrollView>
          )}
        </View>
      )}
          </>
        )}
      />

      {/* ══ イベント詳細モーダル ═══════════════════════════════ */}
      <Modal visible={detailOpen} animationType="none">
        {detailEvent && (
          <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF0F3' }}>
            <View style={styles.detailHeader}>
              <TouchableOpacity onPress={() => setDetailOpen(false)}>
                <Ionicons name="chevron-back" size={24} color="#5D4037" />
              </TouchableOpacity>
              <Text style={styles.detailTitle} numberOfLines={1}>{detailEvent.title}</Text>
              {myAccountId && (
                <TouchableOpacity
                  style={[styles.joinBtn, myParticipations[detailEvent.id] === '参加' ? styles.joinBtnActive : styles.joinBtnInactive]}
                  onPress={() => toggleMyParticipation(detailEvent.id)}
                >
                  <Ionicons name={myParticipations[detailEvent.id] === '参加' ? 'checkmark-circle' : 'add-circle-outline'} size={15} color="#fff" />
                  <Text style={{ fontSize: 11, marginLeft: 3, color: '#fff', fontWeight: 'bold' }}>
                    {myParticipations[detailEvent.id] === '参加' ? '申し込み済み' : '参加する'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {detailEvent.coverImage && (
              <Image source={{ uri: detailEvent.coverImage }} style={styles.detailCover} resizeMode="cover" />
            )}

            <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
              {/* 説明・日時 */}
              <View style={[styles.section, { borderColor: '#D6EEFF', backgroundColor: '#EEF7FF' }]}>
                <TouchableOpacity style={[styles.sectionHeader, { backgroundColor: '#D6EEFF' }]} onPress={() => setSecDesc(!secDesc)}>
                  <Ionicons name="document-text-outline" size={18} color="#4A90C4" />
                  <Text style={[styles.sectionTitle, { color: '#3A7AAA' }]}>説明・日時</Text>
                  <View style={{ flex: 1 }} />
                  <Ionicons name={secDesc ? 'chevron-up' : 'chevron-down'} size={18} color="#4A90C4" />
                </TouchableOpacity>
                <View style={[styles.sectionBody, { borderColor: '#D6EEFF', backgroundColor: '#EEF7FF' }, !secDesc && { display: 'none' }]}>
                    <Text style={styles.detailDateText}>{formatDateWithDay(detailEvent.dateStr)}</Text>
                    {detailDet?.description ? <RichText doc={detailDet.description} /> : <Text style={styles.emptyText}>説明はまだありません</Text>}
                </View>
              </View>

              {/* 持ち込み・参加費 */}
              <View style={[styles.section, { borderColor: '#C8EFD4', backgroundColor: '#EEF9F2' }]}>
                <TouchableOpacity style={[styles.sectionHeader, { backgroundColor: '#C8EFD4' }]} onPress={() => setSecItems(!secItems)}>
                  <Ionicons name="bag-outline" size={18} color="#4A9A6A" />
                  <Text style={[styles.sectionTitle, { color: '#3A7A55' }]}>持ち込み・参加費等</Text>
                  <View style={{ flex: 1 }} />
                  <Ionicons name={secItems ? 'chevron-up' : 'chevron-down'} size={18} color="#4A9A6A" />
                </TouchableOpacity>
                <View style={[styles.sectionBody, { borderColor: '#C8EFD4', backgroundColor: '#EEF9F2' }, !secItems && { display: 'none' }]}>
                    {detailDet?.items ? <RichText doc={detailDet.items} /> : <Text style={styles.emptyText}>情報はまだありません</Text>}
                </View>
              </View>
              {/* 去年の写真 */}
              <View style={[styles.section, { borderColor: '#E8D6F5', backgroundColor: '#F5EEFF' }]}>
                <TouchableOpacity style={[styles.sectionHeader, { backgroundColor: '#E8D6F5' }]} onPress={() => setSecPhotos(!secPhotos)}>
                  <Ionicons name="images-outline" size={18} color="#8A5BB5" />
                  <Text style={[styles.sectionTitle, { color: '#7A4A9A' }]}>去年の写真</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={[styles.photoCount, { color: '#8A5BB5' }]}>{detailPhotos.length}件</Text>
                  <Ionicons name={secPhotos ? 'chevron-up' : 'chevron-down'} size={18} color="#8A5BB5" />
                </TouchableOpacity>
                <View style={[styles.sectionBody, { borderColor: '#E8D6F5', backgroundColor: '#F5EEFF' }, !secPhotos && { display: 'none' }]}>
                    {detailPhotos.length === 0
                      ? <Text style={styles.emptyText}>写真・動画はまだありません</Text>
                      : (
                        <View style={styles.photoGrid}>
                          {detailPhotos.map((p, idx) => (
                            <TouchableOpacity key={p.id} style={styles.photoThumbWrap}
                              onPress={() => { setPreviewPhotos(detailPhotos); setPreviewIdx(idx); }}
                            >
                              <EventMediaThumbnail media={p} style={styles.photoThumb} />
                            </TouchableOpacity>
                          ))}
                        </View>
                      )
                    }
                </View>
              </View>

              <View style={{ height: 40 }} />
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>

      <Modal visible={!!participationConfirm} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setParticipationConfirm(null)} accessibilityLabel="ポップアップ外を閉じる" />
          <View style={[styles.confirmCard, { zIndex: 1 }]}>
            <Text style={styles.confirmTitle}>
              {participationConfirm?.isJoined ? '申し込みを取り消す' : 'イベントに申し込む'}
            </Text>
            <Text style={styles.confirmMessage}>
              {participationConfirm?.isJoined
                ? 'このイベントへの申し込みを取り消しますか？'
                : 'このイベントに申し込みますか？'}
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setParticipationConfirm(null)}>
                <Text style={styles.confirmCancelText}>閉じる</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmSubmitBtn, participationConfirm?.isJoined && styles.confirmRemoveBtn]}
                onPress={confirmMyParticipation}
              >
                <Text style={styles.confirmSubmitText}>
                  {participationConfirm?.isJoined ? '取り消す' : '申し込む'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 写真フルスクリーンプレビュー */}
      <Modal visible={!!previewPhotos} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }}>
          <TouchableOpacity style={{ position: 'absolute', top: 50, right: 20, zIndex: 10 }} onPress={() => setPreviewPhotos(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {previewPhotos && (
            <>
              <EventMediaViewer media={previewPhotos[previewIdx]} style={{ width: '100%', height: '70%' }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 32, marginTop: 16 }}>
                <TouchableOpacity onPress={() => setPreviewIdx(i => Math.max(0, i - 1))} disabled={previewIdx === 0}>
                  <Ionicons name="chevron-back" size={32} color={previewIdx === 0 ? '#555' : '#fff'} />
                </TouchableOpacity>
                <Text style={{ color: '#fff', fontSize: 14 }}>{previewIdx + 1} / {previewPhotos.length}</Text>
                <TouchableOpacity onPress={() => setPreviewIdx(i => Math.min(previewPhotos.length - 1, i + 1))} disabled={previewIdx === previewPhotos.length - 1}>
                  <Ionicons name="chevron-forward" size={32} color={previewIdx === previewPhotos.length - 1 ? '#555' : '#fff'} />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>

      {/* チラシプレビューモーダル */}
      <Modal visible={!!flyerPreview} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' }}>
          <TouchableOpacity style={{ position: 'absolute', top: 50, right: 20, zIndex: 10 }} onPress={() => setFlyerPreview(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {flyerPreview && (
            <Image source={{ uri: flyerPreview.uri }} style={{ width: '95%', height: '80%' }} resizeMode="contain" />
          )}
        </View>
      </Modal>
      <AdminBottomNav active="event" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFF8F0', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },

  // メインタブ
  tabRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#EEE' },
  tab: { flex: 1, paddingVertical: 13, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: COLORS.primary },
  tabText: { fontSize: 15, fontWeight: 'bold', color: '#888' },
  tabTextActive: { color: COLORS.primary },

  // カレンダー
  calMonthNav: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  calNavBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF8F0', borderRadius: 22, borderWidth: 1, borderColor: '#F2C98F' },
  calMonthText: { minWidth: 170, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: '#F2C98F', backgroundColor: '#FFF8F0' },
  calMonthPartButton: { minHeight: 44, minWidth: 78, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#F2C98F', backgroundColor: '#FFF8F0', alignItems: 'center', justifyContent: 'center' },
  calMonthTextLabel: { fontSize: 16, fontWeight: 'bold', color: '#5D4037' },
  calWeekRow: { flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 6, backgroundColor: '#fff' },
  calWeekText: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 'bold', color: COLORS.textLight },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4 },
  calCellEmpty: { width: '14.28%', minHeight: 70 },
  calCell: { width: '14.28%', minHeight: 70, borderWidth: 0.5, borderColor: COLORS.border, padding: 3, backgroundColor: COLORS.white },
  calCellHasEvent: { backgroundColor: '#F0F8FF' },
  calCellToday: { backgroundColor: '#E8F5E1' },
  calCellSelected: { borderWidth: 2, borderColor: COLORS.primary },
  calDayText: { fontSize: 12, fontWeight: 'bold', marginBottom: 2 },
  calEventBadge: { backgroundColor: COLORS.primary + '22', borderRadius: 3, paddingHorizontal: 2, paddingVertical: 1, marginBottom: 2 },
  calEventBadgeTitle: { flexShrink: 1, fontSize: 8, lineHeight: 11, color: COLORS.primary, fontWeight: 'bold' },
  calEventBadgeStatus: { fontSize: 8, fontWeight: 'bold' },
  modalEventBlock: { backgroundColor: '#F9F9F9', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  modalEventTitle: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, marginBottom: 4 },
  modalEventDesc: { fontSize: 13, color: COLORS.textLight, marginBottom: 6, lineHeight: 18 },

  // 参加登録
  scrollArea: { flex: 1, padding: 16 },
  instruction: { fontSize: 14, color: COLORS.textLight, marginBottom: 16, fontWeight: 'bold', textAlign: 'center' },
  noEventText2: { textAlign: 'center', color: COLORS.textLight, marginTop: 40 },
  eventCard: { backgroundColor: COLORS.white, borderRadius: 16, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 3, borderWidth: 1, borderColor: COLORS.border },
  eventCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  dateBadge: { backgroundColor: COLORS.primary + '20', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginRight: 12 },
  dateText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 14 },
  eventTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text, flex: 1 },
  eventDesc: { fontSize: 14, color: COLORS.textLight, lineHeight: 20, marginBottom: 16, backgroundColor: '#F9F9F9', padding: 12, borderRadius: 8 },
  participantSection: { borderTopWidth: 1, borderColor: COLORS.border, paddingTop: 16 },
  childRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  childName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, flex: 1 },
  actionBtns: { flexDirection: 'row', gap: 8 },
  statusBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white },
  statusBtnActiveY: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  statusBtnActiveN: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
  statusBtnText: { fontSize: 14, fontWeight: 'bold', color: COLORS.textLight },
  statusBtnTextActiveY: { color: COLORS.white },
  statusBtnTextActiveN: { color: COLORS.white },

  contentSelectorArea: { position: 'relative', alignItems: 'flex-end', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#EEE', zIndex: 20, overflow: 'visible' },
  contentSelectorButton: { minWidth: 132, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 9, paddingHorizontal: 14, backgroundColor: '#FFF8F0', borderWidth: 1, borderColor: '#E7D5C3' },
  contentSelectorButtonText: { fontSize: 14, fontWeight: '900', color: '#4A3C35' },
  contentSelectorMenu: { position: 'absolute', top: 54, right: 14, width: 180, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#DDD4CC', backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, elevation: 8, zIndex: 30 },
  contentSelectorOption: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderColor: '#EEE8E3' },
  contentSelectorOptionActive: { backgroundColor: '#E9F8F8' },
  contentSelectorOptionText: { fontSize: 14, fontWeight: '800', color: '#4D4743' },
  contentSelectorOptionTextActive: { color: COLORS.primary },
  eventContentBackground: { flex: 1, backgroundColor: '#F7F8F7' },
  eventContentScroll: { padding: 12, paddingBottom: 40 },

  // 年行事
  termSection: { borderWidth: 1, borderColor: '#E7E8E5', borderRadius: 9, padding: 10, marginBottom: 12, backgroundColor: '#FCFCFB', shadowColor: '#000', shadowOpacity: 0.035, shadowRadius: 5, elevation: 1 },
  termHeadingRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', marginBottom: 1, gap: 8 },
  periodHeadingImage: { width: 34, height: 34 },
  termHeadingText: { flexShrink: 0 },
  termHeadingLine: { width: '100%', height: 2, borderRadius: 1, marginBottom: 10 },
  termLabel: { fontSize: 16, fontWeight: 'bold', marginBottom: 1 },
  termMonthRange: { fontSize: 10, color: '#777' },
  monthCard: { borderWidth: 1, borderColor: '#E6E7E4', borderRadius: 7, padding: 7, minHeight: 156, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.025, shadowRadius: 3, elevation: 1 },
  monthCardLabel: { fontSize: 12, fontWeight: 'bold', marginBottom: 6, color: '#3F3C39' },
  noEventBox: { flex: 1, minHeight: 112, alignItems: 'center', justifyContent: 'center', gap: 5 },
  noEventText: { fontSize: 10, color: '#B5B8B5', textAlign: 'center' },
  eventChip: { borderRadius: 6, overflow: 'hidden', marginBottom: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E6E6E3', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  eventChipImgWrap: { position: 'relative' },
  eventCoverImgFull: { width: '100%', height: 92 },
  eventChipCaption: { paddingHorizontal: 6, paddingVertical: 5, minHeight: 42, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#EEEEEB' },
  eventChipTitle: { fontSize: 10, fontWeight: '800', color: '#393633' },
  eventChipDate: { fontSize: 8, color: '#85817D', marginTop: 2 },

  // 長期休み
  vacationHeadingBlock: { marginBottom: 10 },
  vacationScreenHeading: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8 },
  vacationScreenTitle: { fontSize: 16, fontWeight: 'bold' },
  vacationScreenRange: { marginTop: 1, fontSize: 10, color: '#777' },
  vacationHeadingLine: { width: '100%', height: 2, borderRadius: 1, marginTop: 3 },
  vacSection: { borderWidth: 1, borderColor: '#E7E8E5', borderRadius: 9, borderTopWidth: 2, padding: 10, marginBottom: 12, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.025, shadowRadius: 3, elevation: 1 },
  vacMonthLabel: { fontSize: 16, fontWeight: 'bold', marginBottom: 0 },
  flyerBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },

  // 詳細モーダル
  detailHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFF8F0', gap: 8 },
  detailTitle: { flex: 1, fontSize: 17, fontWeight: 'bold', color: '#5D4037' },
  detailCover: { width: '100%', height: 180, backgroundColor: '#EEE' },
  joinBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  joinBtnActive: { backgroundColor: '#4CAF50' },
  joinBtnInactive: { backgroundColor: COLORS.primary },
  section: { borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 3, borderWidth: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', flex: 1 },
  sectionBody: { padding: 14, paddingTop: 12, borderTopWidth: 1 },
  detailDateText: { fontSize: 14, fontWeight: 'bold', color: '#5D4037', marginBottom: 6 },
  photoCount: { fontSize: 12, marginRight: 4 },
  emptyText: { fontSize: 13, color: '#BDBDBD', fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photoThumbWrap: { position: 'relative' },
  photoThumb: { width: 90, height: 90, borderRadius: 8, backgroundColor: '#EEE' },
  confirmOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(17, 24, 39, 0.45)' },
  confirmCard: { width: '100%', maxWidth: 420, borderRadius: 16, padding: 20, backgroundColor: '#FFFDF9', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 14, elevation: 8 },
  confirmTitle: { color: '#3F3531', fontSize: 19, fontWeight: 'bold', textAlign: 'center' },
  confirmMessage: { marginTop: 10, color: '#625752', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  confirmActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  confirmCancelBtn: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#F1EFEC' },
  confirmCancelText: { color: '#625D59', fontSize: 14, fontWeight: 'bold' },
  confirmSubmitBtn: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: COLORS.primary },
  confirmRemoveBtn: { backgroundColor: '#E86A78' },
  confirmSubmitText: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' },
});
