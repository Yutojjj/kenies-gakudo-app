import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
    addDoc, collection, deleteDoc, doc, getDoc,
    getDocs, onSnapshot, query, setDoc, where
} from 'firebase/firestore';
import {
    deleteObject, getDownloadURL,
    ref as storageRef, uploadBytes
} from 'firebase/storage';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator, Image, Modal, Platform,
    SafeAreaView, ScrollView, StyleSheet, Text,
    TextInput, TouchableOpacity, View
} from 'react-native';
import { COLORS } from '../constants/theme';
import { db, storage } from '../firebase';

// ─── ユーティリティ ────────────────────────────────────────────
const customAlert = (title: string, msg?: string) => {
  if (Platform.OS === 'web') window.alert(msg ? `${title}\n${msg}` : title);
  else { const { Alert } = require('react-native'); Alert.alert(title, msg); }
};
const customConfirm = (title: string, msg: string, onOk: () => void) => {
  if (Platform.OS === 'web') { if (window.confirm(`${title}\n${msg}`)) onOk(); }
  else { const { Alert } = require('react-native'); Alert.alert(title, msg, [{ text: 'キャンセル' }, { text: 'OK', onPress: onOk }]); }
};

// ─── 型定義 ────────────────────────────────────────────────────
type MainTab = 'year' | 'vacation';
type VacTab = 'summer' | 'winter' | 'spring';

// リッチテキストのノード
type RichSpan = { text: string; bold?: boolean; italic?: boolean; fontSize?: number; color?: string };
type RichLine = RichSpan[];
type RichDoc = RichLine[];

// イベント詳細（Firestore: year_event_details/{eventId}）
interface YearEventDetail {
  id: string;
  eventId: string;      // events コレクションのID or 独自
  description: RichDoc; // 説明・日時
  items: RichDoc;       // 持ち込み・参加費等
}

// 休み期間の広告画像（Firestore: vacation_flyers/{id}）
interface VacationFlyer {
  id: string;
  vacation: VacTab;
  month: number;
  uri: string;
  storagePath: string;
  title: string;
}

// 去年の写真（Firestore: event_past_photos/{id}）
interface PastPhoto {
  id: string;
  eventId: string;
  uri: string;
  storagePath: string;
}

// ─── 学期定義 ──────────────────────────────────────────────────
const TERM1_MONTHS = [4, 5, 6, 7];
const TERM2_MONTHS = [9, 10, 11, 12];
const TERM3_MONTHS = [1, 2, 3];

const VAC_MONTHS: Record<VacTab, number[]> = {
  summer: [7, 8],
  winter: [12, 1],
  spring: [3, 4],
};

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

const MONTH_NAMES = ['', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

// ─── リッチテキストレンダラー ───────────────────────────────────
const RichText = ({ doc: rdoc }: { doc: RichDoc }) => (
  <View>
    {rdoc.map((line, li) => (
      <Text key={li} style={{ marginBottom: 2 }}>
        {line.map((span, si) => (
          <Text key={si} style={{
            fontWeight: span.bold ? 'bold' : 'normal',
            fontStyle: span.italic ? 'italic' : 'normal',
            fontSize: span.fontSize || 14,
            color: span.color || '#333',
          }}>{span.text}</Text>
        ))}
        {line.length === 0 ? '\n' : ''}
      </Text>
    ))}
  </View>
);

// ─── リッチテキストエディタ ────────────────────────────────────
const RichEditor = ({ value, onChange }: { value: RichDoc; onChange: (v: RichDoc) => void }) => {
  const [selLine, setSelLine] = useState(0);
  const [selSpan, setSelSpan] = useState(0);
  const COLORS_LIST = ['#333333', '#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA'];
  const SIZES = [12, 14, 16, 18, 20];

  const ensureDoc = (d: RichDoc): RichDoc => d.length ? d : [[{ text: '' }]];
  const doc = ensureDoc(value);

  const getSpan = (): RichSpan => doc[selLine]?.[selSpan] || { text: '' };

  const updateSpan = (patch: Partial<RichSpan>) => {
    const newDoc = doc.map((l, li) => l.map((s, si) =>
      li === selLine && si === selSpan ? { ...s, ...patch } : s
    ));
    onChange(newDoc);
  };

  const addLine = () => {
    const newDoc = [...doc, [{ text: '' }]];
    onChange(newDoc);
    setSelLine(newDoc.length - 1);
    setSelSpan(0);
  };

  const addSpan = () => {
    const newDoc = doc.map((l, li) =>
      li === selLine ? [...l, { text: '' }] : l
    );
    onChange(newDoc);
    setSelSpan(doc[selLine].length);
  };

  const span = getSpan();

  return (
    <View style={re.wrap}>
      {/* ツールバー */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={re.toolbar}>
        <TouchableOpacity style={[re.toolBtn, span.bold && re.toolBtnActive]} onPress={() => updateSpan({ bold: !span.bold })}>
          <Text style={[re.toolText, span.bold && re.toolTextActive]}>B</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[re.toolBtn, span.italic && re.toolBtnActive]} onPress={() => updateSpan({ italic: !span.italic })}>
          <Text style={[re.toolText, { fontStyle: 'italic' }, span.italic && re.toolTextActive]}>I</Text>
        </TouchableOpacity>
        <View style={re.sep} />
        {SIZES.map(s => (
          <TouchableOpacity key={s} style={[re.toolBtn, span.fontSize === s && re.toolBtnActive]} onPress={() => updateSpan({ fontSize: s })}>
            <Text style={[re.toolText, span.fontSize === s && re.toolTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
        <View style={re.sep} />
        {COLORS_LIST.map(c => (
          <TouchableOpacity key={c} style={[re.colorDot, { backgroundColor: c }, span.color === c && { borderWidth: 2, borderColor: '#333' }]} onPress={() => updateSpan({ color: c })} />
        ))}
      </ScrollView>

      {/* 行一覧 */}
      <ScrollView style={{ maxHeight: 260 }}>
        {doc.map((line, li) => (
          <View key={li} style={{ marginBottom: 4 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 2 }}>
              {line.map((s, si) => (
                <TouchableOpacity key={si} onPress={() => { setSelLine(li); setSelSpan(si); }}
                  style={[re.spanChip, selLine === li && selSpan === si && re.spanChipSel]}>
                  <Text style={{ fontWeight: s.bold ? 'bold' : 'normal', fontStyle: s.italic ? 'italic' : 'normal', fontSize: Math.min(s.fontSize || 14, 16), color: s.color || '#333' }}>
                    {s.text || '（空）'}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={re.addSpanBtn} onPress={() => { setSelLine(li); addSpan(); }}>
                <Ionicons name="add" size={14} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
            {selLine === li && (
              <TextInput
                style={re.lineInput}
                value={span.text}
                onChangeText={t => updateSpan({ text: t })}
                multiline
                placeholder="テキストを入力..."
                placeholderTextColor="#bbb"
              />
            )}
          </View>
        ))}
      </ScrollView>

      <TouchableOpacity style={re.addLineBtn} onPress={addLine}>
        <Ionicons name="return-down-forward" size={14} color={COLORS.primary} />
        <Text style={{ color: COLORS.primary, fontSize: 12, marginLeft: 4 }}>行を追加</Text>
      </TouchableOpacity>
    </View>
  );
};

const re = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10, overflow: 'hidden', backgroundColor: '#FAFAFA' },
  toolbar: { backgroundColor: '#F5F5F5', borderBottomWidth: 1, borderColor: '#E0E0E0', paddingVertical: 6, paddingHorizontal: 6 },
  toolBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginRight: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: '#DDD' },
  toolBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  toolText: { fontWeight: 'bold', fontSize: 13, color: '#555' },
  toolTextActive: { color: '#fff' },
  sep: { width: 1, backgroundColor: '#DDD', marginHorizontal: 4 },
  colorDot: { width: 22, height: 22, borderRadius: 11, marginRight: 4, alignSelf: 'center' },
  spanChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#E0E0E0', marginRight: 4, marginBottom: 4, backgroundColor: '#fff' },
  spanChipSel: { borderColor: COLORS.primary, borderWidth: 2 },
  addSpanBtn: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  lineInput: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8, padding: 10, fontSize: 14, backgroundColor: '#fff', minHeight: 60, textAlignVertical: 'top', margin: 4 },
  addLineBtn: { flexDirection: 'row', alignItems: 'center', padding: 10, borderTopWidth: 1, borderColor: '#E0E0E0' },
});

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const formatDateWithDay = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${DAY_NAMES[d.getDay()]}）`;
};

const EMPTY_RICH: RichDoc = [[{ text: '' }]];

// ─── メイン画面 ───────────────────────────────────────────────
export default function YearEventsScreen() {
  const router = useRouter();
  const { role, name } = useLocalSearchParams<{ role?: string; name?: string }>();
  const isAdmin = role === 'admin';
  const isUser = role === 'user';

  // 参加状態 key: eventId → '参加' | undefined
  const [myParticipations, setMyParticipations] = useState<Record<string, string>>({});
  const [myAccountId, setMyAccountId] = useState<string | null>(null);

  const [mainTab, setMainTab] = useState<MainTab>('year');
  const [vacTab, setVacTab] = useState<VacTab>('summer');

  // Firestore data
  const [events, setEvents] = useState<Record<string, any[]>>({});   // key: "YYYY-MM"→配列 (events collection)
  const [details, setDetails] = useState<Record<string, YearEventDetail>>({});  // key: eventId
  const [pastPhotos, setPastPhotos] = useState<Record<string, PastPhoto[]>>({}); // key: eventId
  const [flyers, setFlyers] = useState<VacationFlyer[]>([]);
  const [holidayPeriods, setHolidayPeriods] = useState<{id: string; name: string; start: string; end: string}[]>([]);

  // 詳細画面
  const [detailEvent, setDetailEvent] = useState<any | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [secDesc, setSecDesc] = useState(false);
  const [secItems, setSecItems] = useState(false);
  const [secPhotos, setSecPhotos] = useState(false);

  // 編集
  const [editDesc, setEditDesc] = useState(false);
  const [editItems, setEditItems] = useState(false);
  const [descDraft, setDescDraft] = useState<RichDoc>(EMPTY_RICH);
  const [itemsDraft, setItemsDraft] = useState<RichDoc>(EMPTY_RICH);
  const [saving, setSaving] = useState(false);

  // 写真プレビュー
  const [previewPhotos, setPreviewPhotos] = useState<PastPhoto[] | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [uploading, setUploading] = useState(false);

  // チラシプレビュー
  const [flyerPreview, setFlyerPreview] = useState<VacationFlyer | null>(null);

  // スクロール ref
  const yearScrollRef = useRef<ScrollView>(null);
  const vacScrollRef = useRef<ScrollView>(null);
  const term1Ref = useRef<View>(null);
  const term2Ref = useRef<View>(null);
  const term3Ref = useRef<View>(null);
  const termOffsets = useRef<Record<number, number>>({});
  const vacMonthRefs = useRef<Record<string, number>>({});

  // ─── データロード ──────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'events'), snap => {
      const map: Record<string, any[]> = {};
      snap.forEach(d => {
        const data = { id: d.id, ...d.data() };
        const ym = (data as any).dateStr?.slice(0, 7);
        if (ym) { if (!map[ym]) map[ym] = []; map[ym].push(data); }
      });
      setEvents(map);
    });
    const unsub2 = onSnapshot(collection(db, 'year_event_details'), snap => {
      const map: Record<string, YearEventDetail> = {};
      snap.forEach(d => { const data = { id: d.id, ...d.data() } as YearEventDetail; map[data.eventId] = data; });
      setDetails(map);
    });
    const unsub3 = onSnapshot(collection(db, 'event_past_photos'), snap => {
      const map: Record<string, PastPhoto[]> = {};
      snap.forEach(d => { const p = { id: d.id, ...d.data() } as PastPhoto; if (!map[p.eventId]) map[p.eventId] = []; map[p.eventId].push(p); });
      setPastPhotos(map);
    });
    const unsub4 = onSnapshot(collection(db, 'vacation_flyers'), snap => {
      setFlyers(snap.docs.map(d => ({ id: d.id, ...d.data() } as VacationFlyer)));
    });
    // 利用者の参加状態ロード
    if (isUser && name) {
      getDocs(query(collection(db, 'accounts'), where('name', '==', name)))
        .then(snap => {
          if (!snap.empty) {
            const accId = snap.docs[0].id;
            setMyAccountId(accId);
            const unsub5 = onSnapshot(
              query(collection(db, 'event_participants'), where('childId', '==', accId)),
              psnap => {
                const map: Record<string, string> = {};
                psnap.forEach(d => { map[d.data().eventId] = d.data().status; });
                setMyParticipations(map);
              }
            );
            return () => unsub5();
          }
        });
    }
    // 長期休み期間ロード
    getDoc(doc(db, 'settings', 'holidays_data')).then(snap => {
      if (snap.exists() && snap.data().periods) setHolidayPeriods(snap.data().periods);
    });
    const unsubHolidays = onSnapshot(doc(db, 'settings', 'holidays_data'), snap => {
      if (snap.exists() && snap.data().periods) setHolidayPeriods(snap.data().periods);
    });

    return () => { unsub(); unsub2(); unsub3(); unsub4(); unsubHolidays(); };
  }, []);

  // ─── ヘルパー ──────────────────────────────────────────────
  const eventsForMonth = (year: number, month: number) => {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    return events[ym] || [];
  };

  // イベントが長期休み期間に含まれるか
  const isInAnyHoliday = (dateStr: string): boolean => {
    return holidayPeriods.some(p => dateStr >= p.start && dateStr <= p.end);
  };

  // 長期休み名に対応する期間のイベントを取得（月で絞り込み）
  const eventsForVacMonth = (vacLabel: string, month: number): any[] => {
    const result: any[] = [];
    const periods = holidayPeriods.filter(p => p.name.includes(vacLabel));
    periods.forEach(period => {
      // period.start 〜 period.end の月をまたぐ全イベントを取得
      const start = new Date(period.start);
      const end = new Date(period.end);
      let cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        const ym = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
        const monthNum = cur.getMonth() + 1;
        if (monthNum === month) {
          (events[ym] || []).forEach(ev => {
            if (ev.dateStr >= period.start && ev.dateStr <= period.end && !result.find(r => r.id === ev.id)) {
              result.push(ev);
            }
          });
        }
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
    });
    return result;
  };

  // 長期休みに含まれる月一覧を動的に取得
  const getVacMonths = (vacLabel: string): number[] => {
    const months = new Set<number>();
    holidayPeriods.filter(p => p.name.includes(vacLabel)).forEach(period => {
      const start = new Date(period.start);
      const end = new Date(period.end);
      let cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        months.add(cur.getMonth() + 1);
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
    });
    return Array.from(months).sort((a, b) => a - b);
  };

  const currentYear = new Date().getFullYear();

  const openDetail = (ev: any) => {
    setDetailEvent(ev);
    const det = details[ev.id];
    setDescDraft(det?.description || EMPTY_RICH);
    setItemsDraft(det?.items || EMPTY_RICH);
    setSecDesc(false); setSecItems(false); setSecPhotos(false);
    setEditDesc(false); setEditItems(false);
    setDetailOpen(true);
  };

  const saveDetail = async (field: 'description' | 'items') => {
    if (!detailEvent) return;
    setSaving(true);
    const det = details[detailEvent.id];
    const docId = det?.id || detailEvent.id;
    await setDoc(doc(db, 'year_event_details', docId), {
      eventId: detailEvent.id,
      description: field === 'description' ? descDraft : (det?.description || EMPTY_RICH),
      items: field === 'items' ? itemsDraft : (det?.items || EMPTY_RICH),
    }, { merge: true });
    setSaving(false);
    if (field === 'description') setEditDesc(false);
    else setEditItems(false);
  };

  const toggleParticipation = async (eventId: string) => {
    if (!myAccountId) return;
    const docId = `${eventId}_${myAccountId}`;
    const isJoined = myParticipations[eventId] === '参加';
    if (isJoined) {
      customConfirm('参加を取り消す', 'このイベントの参加を取り消しますか？', async () => {
        await deleteDoc(doc(db, 'event_participants', docId));
      });
    } else {
      customConfirm('参加する', 'このイベントに参加しますか？', async () => {
        await setDoc(doc(db, 'event_participants', docId), {
          eventId, childId: myAccountId, childName: name || '',
          status: '参加', updatedAt: new Date(),
        });
      });
    }
  };

  const toggleHidden = async (ev: any) => {
    const newHidden = !ev.hidden;
    await setDoc(doc(db, 'events', ev.id), { hidden: newHidden }, { merge: true });
    setDetailEvent((prev: any) => prev ? { ...prev, hidden: newHidden } : prev);
  };

  // ─── 画像アップロード（イベントカバー） ────────────────────
  const deleteEventCover = async (ev: any) => {
    customConfirm('画像を削除', 'カバー画像を削除しますか？', async () => {
      if (ev.coverStoragePath) {
        await deleteObject(storageRef(storage, ev.coverStoragePath)).catch(() => {});
      }
      await setDoc(doc(db, 'events', ev.id), { coverImage: null, coverStoragePath: null }, { merge: true });
      setDetailEvent((prev: any) => prev ? { ...prev, coverImage: null, coverStoragePath: null } : prev);
    });
  };

  const pickEventCover = async (eventId: string) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const asset = result.assets[0];
      const res = await fetch(asset.uri);
      const blob = await res.blob();
      const ext = (asset.mimeType || '').includes('png') ? 'png' : 'jpg';
      const filename = `albums/event_cover_${eventId}_${Date.now()}.${ext}`;
      const sref = storageRef(storage, filename);
      await uploadBytes(sref, blob);
      const url = await getDownloadURL(sref);
      await setDoc(doc(db, 'events', eventId), { coverImage: url, coverStoragePath: filename }, { merge: true });
    } catch (e: any) {
      console.error('cover upload error:', e);
      customAlert('エラー', e?.message || 'アップロードに失敗しました');
    }
    setUploading(false);
  };

  // ─── 去年の写真アップロード ────────────────────────────────
  const uploadPastPhoto = async () => {
    if (!detailEvent) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { customAlert('権限エラー', '写真ライブラリへのアクセスを許可してください'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsMultipleSelection: true,
      quality: 0.7,
    });
    if (result.canceled) return;
    setUploading(true);
    let count = 0;
    for (const asset of result.assets) {
      try {
        const res = await fetch(asset.uri);
        const blob = await res.blob();
        const ext = (asset.mimeType || '').includes('png') ? 'png' : 'jpg';
        const filename = `albums/event_past_${detailEvent.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const sref = storageRef(storage, filename);
        await uploadBytes(sref, blob);
        const url = await getDownloadURL(sref);
        await addDoc(collection(db, 'event_past_photos'), {
          eventId: detailEvent.id, uri: url, storagePath: filename, createdAt: new Date()
        });
        count++;
      } catch (e: any) {
        console.error('upload error:', e);
        customAlert('アップロード失敗', e?.message || String(e));
      }
    }
    setUploading(false);
    if (count > 0) customAlert('完了', `${count}枚アップロードしました`);
  };

  const deletePastPhoto = async (photo: PastPhoto) => {
    customConfirm('削除', 'この写真を削除しますか？', async () => {
      await deleteObject(storageRef(storage, photo.storagePath)).catch(() => {});
      await deleteDoc(doc(db, 'event_past_photos', photo.id));
    });
  };

  // ─── チラシアップロード ────────────────────────────────────
  const uploadFlyer = async (vac: VacTab, month: number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const uri = result.assets[0].uri;
      const blob = await fetch(uri).then(r => r.blob());
      const filename = `albums/vacation_flyer_${vac}_${month}_${Date.now()}.jpg`;
      const sref = storageRef(storage, filename);
      await uploadBytes(sref, blob);
      const url = await getDownloadURL(sref);
      const title = `${VAC_COLORS[vac].label} ${month}月`;
      await addDoc(collection(db, 'vacation_flyers'), { vacation: vac, month, uri: url, storagePath: filename, title, createdAt: new Date() });
    } catch (e) { customAlert('エラー', 'アップロードに失敗しました'); }
    setUploading(false);
  };

  const replaceFlyer = async (flyer: VacationFlyer) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      // 旧画像削除
      await deleteObject(storageRef(storage, flyer.storagePath)).catch(() => {});
      const asset = result.assets[0];
      const res = await fetch(asset.uri);
      const blob = await res.blob();
      const ext = (asset.mimeType || '').includes('png') ? 'png' : 'jpg';
      const filename = `albums/vacation_flyer_${flyer.vacation}_${flyer.month}_${Date.now()}.${ext}`;
      const sref = storageRef(storage, filename);
      await uploadBytes(sref, blob);
      const url = await getDownloadURL(sref);
      await setDoc(doc(db, 'vacation_flyers', flyer.id), { ...flyer, uri: url, storagePath: filename });
    } catch (e: any) { customAlert('エラー', e?.message || 'アップロードに失敗しました'); }
    setUploading(false);
  };

  const deleteFlyer = async (flyer: VacationFlyer) => {
    customConfirm('削除', 'このチラシを削除しますか？', async () => {
      await deleteObject(storageRef(storage, flyer.storagePath)).catch(() => {});
      await deleteDoc(doc(db, 'vacation_flyers', flyer.id));
    });
  };

  // ─── 月カードのペアレンダリング ───────────────────────────
  const MonthPair = ({ months, termColor }: { months: number[]; termColor: any }) => {
    const pairs: number[][] = [];
    for (let i = 0; i < months.length; i += 2) pairs.push(months.slice(i, i + 2));
    return (
      <View>
        {pairs.map((pair, pi) => (
          <View key={pi} style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            {pair.map(m => {
              const evs = eventsForMonth(currentYear, m)
                .filter(ev => (isAdmin || !ev.hidden) && !isInAnyHoliday(ev.dateStr));
              return (
                <View key={m} style={[styles.monthCard, { flex: 1, borderColor: termColor.border, backgroundColor: termColor.light }]}>
                  <Text style={[styles.monthCardLabel, { color: termColor.text }]}>{m}月</Text>
                  {evs.length === 0 ? (
                    <Text style={styles.noEventText}>イベントなし</Text>
                  ) : (
                    evs.map(ev => <EventChip key={ev.id} ev={ev} />)
                  )}
                </View>
              );
            })}
            {pair.length === 1 && <View style={{ flex: 1 }} />}
          </View>
        ))}
      </View>
    );
  };

  // ─── イベントチップレンダリング（共通） ─────────────────────
  const EventChip = ({ ev }: { ev: any }) => (
    <TouchableOpacity style={[styles.eventChip, ev.hidden && { opacity: 0.5 }]}
      onPress={() => openDetail(ev)} activeOpacity={0.8}>
      <View style={styles.eventChipImgWrap}>
        {ev.coverImage ? (
          <Image source={{ uri: ev.coverImage }} style={styles.eventCoverImgFull} resizeMode="cover" />
        ) : (
          <View style={[styles.eventCoverImgFull, { backgroundColor: '#E8E8E8', alignItems: 'center', justifyContent: 'center' }]}>
            {isAdmin && (
              <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); pickEventCover(ev.id); }} style={{ alignItems: 'center' }}>
                <Ionicons name="camera-outline" size={22} color="#bbb" />
                <Text style={{ fontSize: 10, color: '#bbb', marginTop: 3 }}>画像追加</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {isAdmin && ev.coverImage && (
          <View style={styles.coverActionBtns}>
            <TouchableOpacity style={styles.coverActionBtn} onPress={(e) => { e.stopPropagation?.(); pickEventCover(ev.id); }}>
              <Ionicons name="camera-outline" size={13} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.coverActionBtn, { backgroundColor: 'rgba(220,50,50,0.75)' }]} onPress={(e) => { e.stopPropagation?.(); deleteEventCover(ev); }}>
              <Ionicons name="trash-outline" size={13} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.eventChipGradient}>
          <Text style={styles.eventChipTitle} numberOfLines={2}>{ev.title}</Text>
          {ev.hidden && <Text style={styles.hiddenBadge}>非表示</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );

  // ─── 長期休み月セクション ─────────────────────────────────
  const VacMonthSection = ({ vac, month }: { vac: VacTab; month: number }) => {
    const vc = VAC_COLORS[vac];
    const monthFlyers = flyers.filter(f => f.vacation === vac && f.month === month);
    const vacLabel = vc.label;
    const vacEvents = eventsForVacMonth(vacLabel, month).filter(ev => isAdmin || !ev.hidden);
    return (
      <View
        onLayout={e => { vacMonthRefs.current[`${vac}_${month}`] = e.nativeEvent.layout.y; }}
        style={[styles.vacSection, { borderColor: vc.border }]}
      >
        <Text style={[styles.vacMonthLabel, { color: vc.text }]}>{month}月</Text>

        {/* 長期休み期間のイベント（年行事と同じカード形式・2列） */}
        {vacEvents.length > 0 && (
          <View style={{ marginBottom: 10 }}>
            <Text style={{ fontSize: 11, color: vc.text, fontWeight: 'bold', marginBottom: 6 }}>イベント</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {vacEvents.map(ev => (
                <View key={ev.id} style={{ width: '47%' }}>
                  <EventChip ev={ev} />
                </View>
              ))}
            </View>
          </View>
        )}

        {/* チラシ */}
        {monthFlyers.map(flyer => (
          <View key={flyer.id} style={styles.flyerRow}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => setFlyerPreview(flyer)}>
              <Image source={{ uri: flyer.uri }} style={styles.flyerThumb} resizeMode="cover" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.flyerDetailBtn} onPress={() => setFlyerPreview(flyer)}>
              <Text style={styles.flyerDetailBtnText}>詳細</Text>
            </TouchableOpacity>
            {isAdmin && (
              <>
                <TouchableOpacity style={[styles.flyerDeleteBtn, { backgroundColor: '#E3F2FD', borderRadius: 8, padding: 8, marginRight: 4 }]} onPress={() => replaceFlyer(flyer)}>
                  <Ionicons name="camera-outline" size={16} color="#1565C0" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.flyerDeleteBtn} onPress={() => deleteFlyer(flyer)}>
                  <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                </TouchableOpacity>
              </>
            )}
          </View>
        ))}

        {vacEvents.length === 0 && monthFlyers.length === 0 && (
          <Text style={styles.noEventText}>イベント・チラシなし</Text>
        )}

        {isAdmin && (
          <TouchableOpacity style={styles.uploadFlyerBtn} onPress={() => uploadFlyer(vac, month)}>
            <Ionicons name="cloud-upload-outline" size={18} color={vc.text} />
            <Text style={[styles.uploadFlyerBtnText, { color: vc.text }]}>チラシをアップロード</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ─── 詳細画面（インライン・アンマウントなし） ─────────────
  const detailPhotos = detailEvent ? (pastPhotos[detailEvent.id] || []) : [];
  const detailDet = detailEvent ? details[detailEvent.id] : undefined;
  const DetailModal = (
    <Modal visible={detailOpen} animationType="none">
      {detailEvent ? (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF0F3' }}>
          {/* ヘッダー */}
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setDetailOpen(false)}>
              <Ionicons name="chevron-back" size={24} color="#5D4037" />
            </TouchableOpacity>
            <Text style={styles.detailTitle} numberOfLines={1}>{detailEvent.title}</Text>
            {isAdmin && (
              <TouchableOpacity
                style={[styles.hiddenToggleBtn, detailEvent.hidden ? styles.hiddenToggleBtnHidden : styles.hiddenToggleBtnVisible]}
                onPress={() => toggleHidden(detailEvent)}
              >
                <Ionicons name={detailEvent.hidden ? 'eye-off' : 'eye'} size={15} color="#fff" />
                <Text style={{ fontSize: 11, marginLeft: 3, color: '#fff', fontWeight: 'bold' }}>
                  {detailEvent.hidden ? '非表示' : '表示中'}
                </Text>
              </TouchableOpacity>
            )}
            {isUser && (
              <TouchableOpacity
                style={[styles.joinBtn, myParticipations[detailEvent.id] === '参加' ? styles.joinBtnActive : styles.joinBtnInactive]}
                onPress={() => toggleParticipation(detailEvent.id)}
              >
                <Ionicons name={myParticipations[detailEvent.id] === '参加' ? 'checkmark-circle' : 'add-circle-outline'} size={15} color="#fff" />
                <Text style={{ fontSize: 11, marginLeft: 3, color: '#fff', fontWeight: 'bold' }}>
                  {myParticipations[detailEvent.id] === '参加' ? '参加中' : '参加する'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* カバー画像 */}
          {detailEvent.coverImage && (
            <Image source={{ uri: detailEvent.coverImage }} style={styles.detailCover} resizeMode="cover" />
          )}

          <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>

            {/* ── セクション①：説明・日時 */}
            <View style={[styles.section, { borderColor: '#D6EEFF', backgroundColor: '#EEF7FF' }]}>
              <TouchableOpacity style={[styles.sectionHeader, { backgroundColor: '#D6EEFF' }]} onPress={() => setSecDesc(!secDesc)}>
                <Ionicons name="document-text-outline" size={18} color="#4A90C4" />
                <Text style={[styles.sectionTitle, { color: '#3A7AAA' }]}>説明・日時</Text>
                <View style={{ flex: 1 }} />
                <Ionicons name={secDesc ? 'chevron-up' : 'chevron-down'} size={18} color="#4A90C4" />
              </TouchableOpacity>
              <View style={[styles.sectionBody, { borderColor: '#D6EEFF', backgroundColor: '#EEF7FF' }, !secDesc && { display: 'none' }]}>
                <Text style={styles.dateText}>{formatDateWithDay(detailEvent.dateStr)}</Text>
                {editDesc ? (
                  <View style={{ marginTop: 10 }}>
                    <RichEditor value={descDraft} onChange={setDescDraft} />
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={() => saveDetail('description')} disabled={saving}>
                        <Text style={styles.saveBtnText}>{saving ? '保存中...' : '保存'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.cancelBtn, { flex: 1 }]} onPress={() => setEditDesc(false)}>
                        <Text style={styles.cancelBtnText}>キャンセル</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={{ marginTop: 10 }}>
                    {detailDet?.description ? <RichText doc={detailDet.description} /> : <Text style={styles.emptyText}>説明はまだありません</Text>}
                    {isAdmin && (
                      <TouchableOpacity style={styles.editBtn} onPress={() => { setDescDraft(detailDet?.description || EMPTY_RICH); setEditDesc(true); }}>
                        <Ionicons name="pencil-outline" size={14} color={COLORS.primary} />
                        <Text style={styles.editBtnText}>編集</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>

            {/* ── セクション②：持ち込み・参加費等 */}
            <View style={[styles.section, { borderColor: '#C8EFD4', backgroundColor: '#EEF9F2' }]}>
              <TouchableOpacity style={[styles.sectionHeader, { backgroundColor: '#C8EFD4' }]} onPress={() => setSecItems(!secItems)}>
                <Ionicons name="bag-outline" size={18} color="#4A9A6A" />
                <Text style={[styles.sectionTitle, { color: '#3A7A55' }]}>持ち込み・参加費等</Text>
                <View style={{ flex: 1 }} />
                <Ionicons name={secItems ? 'chevron-up' : 'chevron-down'} size={18} color="#4A9A6A" />
              </TouchableOpacity>
              <View style={[styles.sectionBody, { borderColor: '#C8EFD4', backgroundColor: '#EEF9F2' }, !secItems && { display: 'none' }]}>
                {editItems ? (
                  <View>
                    <RichEditor value={itemsDraft} onChange={setItemsDraft} />
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={() => saveDetail('items')} disabled={saving}>
                        <Text style={styles.saveBtnText}>{saving ? '保存中...' : '保存'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.cancelBtn, { flex: 1 }]} onPress={() => setEditItems(false)}>
                        <Text style={styles.cancelBtnText}>キャンセル</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View>
                    {detailDet?.items ? <RichText doc={detailDet.items} /> : <Text style={styles.emptyText}>情報はまだありません</Text>}
                    {isAdmin && (
                      <TouchableOpacity style={styles.editBtn} onPress={() => { setItemsDraft(detailDet?.items || EMPTY_RICH); setEditItems(true); }}>
                        <Ionicons name="pencil-outline" size={14} color={COLORS.primary} />
                        <Text style={styles.editBtnText}>編集</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>

            {/* ── セクション③：去年の写真 */}
            <View style={[styles.section, { borderColor: '#E8D6F5', backgroundColor: '#F5EEFF' }]}>
              <TouchableOpacity style={[styles.sectionHeader, { backgroundColor: '#E8D6F5' }]} onPress={() => setSecPhotos(!secPhotos)}>
                <Ionicons name="images-outline" size={18} color="#8A5BB5" />
                <Text style={[styles.sectionTitle, { color: '#7A4A9A' }]}>去年の写真</Text>
                <View style={{ flex: 1 }} />
                <Text style={[styles.photoCount, { color: '#8A5BB5' }]}>{detailPhotos.length}枚</Text>
                <Ionicons name={secPhotos ? 'chevron-up' : 'chevron-down'} size={18} color="#8A5BB5" />
              </TouchableOpacity>
              <View style={[styles.sectionBody, { borderColor: '#E8D6F5', backgroundColor: '#F5EEFF' }, !secPhotos && { display: 'none' }]}>
                {isAdmin && (
                  <TouchableOpacity style={styles.uploadPhotoBtn} onPress={uploadPastPhoto}>
                    <Ionicons name="cloud-upload-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.uploadPhotoBtnText}>写真をアップロード</Text>
                  </TouchableOpacity>
                )}
                {uploading && <ActivityIndicator size="small" color={COLORS.primary} style={{ margin: 8 }} />}
                {detailPhotos.length === 0 ? (
                  <Text style={styles.emptyText}>写真はまだありません</Text>
                ) : (
                  <View style={styles.photoGrid}>
                    {detailPhotos.map((p, idx) => (
                      <TouchableOpacity key={p.id} style={styles.photoThumbWrap} onPress={() => { setPreviewPhotos(detailPhotos); setPreviewIdx(idx); }}>
                        <Image source={{ uri: p.uri }} style={styles.photoThumb} />
                        {isAdmin && (
                          <TouchableOpacity style={styles.photoDeleteBtn} onPress={() => deletePastPhoto(p)}>
                            <Ionicons name="close-circle" size={18} color={COLORS.danger} />
                          </TouchableOpacity>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      ) : null}
    </Modal>
  );

  // ─── メインレンダリング ───────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>イベント詳細</Text>
      </View>

      {/* メインタブ */}
      <View style={styles.mainTabRow}>
        <TouchableOpacity style={[styles.mainTab, mainTab === 'year' && styles.mainTabActive]} onPress={() => setMainTab('year')}>
          <Text style={[styles.mainTabText, mainTab === 'year' && styles.mainTabTextActive]}>年行事</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.mainTab, mainTab === 'vacation' && styles.mainTabActive]} onPress={() => setMainTab('vacation')}>
          <Text style={[styles.mainTabText, mainTab === 'vacation' && styles.mainTabTextActive]}>長期休み</Text>
        </TouchableOpacity>
      </View>

      {/* ── 年行事タブ ── */}
      {mainTab === 'year' && (
        <View style={{ flex: 1 }}>
          {/* 学期ジャンプボタン */}
          <View style={styles.termJumpRow}>
            {([1, 2, 3] as const).map(t => (
              <TouchableOpacity key={t} style={[styles.termJumpBtn, { borderColor: TERM_COLORS[t].border, backgroundColor: TERM_COLORS[t].bg }]}
                onPress={() => {
                  const offset = termOffsets.current[t] || 0;
                  yearScrollRef.current?.scrollTo({ y: offset, animated: true });
                }}>
                <Text style={[styles.termJumpText, { color: TERM_COLORS[t].text }]}>{t}学期</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView ref={yearScrollRef} contentContainerStyle={{ padding: 14 }}>
            {([1, 2, 3] as const).map(term => {
              const tc = TERM_COLORS[term];
              const months = term === 1 ? TERM1_MONTHS : term === 2 ? TERM2_MONTHS : TERM3_MONTHS;
              return (
                <View key={term}
                  onLayout={e => { termOffsets.current[term] = e.nativeEvent.layout.y; }}
                  style={[styles.termSection, { borderLeftColor: tc.border, backgroundColor: tc.bg }]}>
                  <Text style={[styles.termLabel, { color: tc.text }]}>{term}学期</Text>
                  <Text style={styles.termMonthRange}>
                    {months[0]}月 〜 {months[months.length - 1]}月
                  </Text>
                  <MonthPair months={months} termColor={tc} />
                </View>
              );
            })}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      )}

      {/* ── 長期休みタブ ── */}
      {mainTab === 'vacation' && (
        <View style={{ flex: 1 }}>
          {/* 休み種別タブ */}
          <View style={styles.vacTabRow}>
            {(['summer', 'winter', 'spring'] as VacTab[]).map(v => {
              const vc = VAC_COLORS[v];
              return (
                <TouchableOpacity key={v}
                  style={[styles.vacTab, vacTab === v && { backgroundColor: vc.bg, borderBottomColor: vc.border }]}
                  onPress={() => setVacTab(v)}>
                  <Text style={[styles.vacTabText, vacTab === v && { color: vc.text, fontWeight: 'bold' }]}>{vc.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 月ジャンプボタン */}
          <View style={styles.termJumpRow}>
            {(getVacMonths(VAC_COLORS[vacTab].label).length > 0 ? getVacMonths(VAC_COLORS[vacTab].label) : VAC_MONTHS[vacTab]).map(m => {
              const vc = VAC_COLORS[vacTab];
              return (
                <TouchableOpacity key={m}
                  style={[styles.termJumpBtn, { borderColor: vc.border, backgroundColor: vc.bg }]}
                  onPress={() => {
                    const offset = vacMonthRefs.current[`${vacTab}_${m}`] || 0;
                    vacScrollRef.current?.scrollTo({ y: offset, animated: true });
                  }}>
                  <Text style={[styles.termJumpText, { color: vc.text }]}>{m}月</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <ScrollView ref={vacScrollRef} contentContainerStyle={{ padding: 14 }}>
            {(getVacMonths(VAC_COLORS[vacTab].label).length > 0 ? getVacMonths(VAC_COLORS[vacTab].label) : VAC_MONTHS[vacTab]).map(m => <VacMonthSection key={m} vac={vacTab} month={m} />)}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      )}

      {/* 詳細モーダル */}
      {DetailModal}

      {/* 写真フルスクリーン */}
      <Modal visible={!!previewPhotos} transparent animationType="fade">
        <View style={styles.fsOverlay}>
          <TouchableOpacity style={styles.fsClose} onPress={() => setPreviewPhotos(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {previewPhotos && (
            <>
              <Image source={{ uri: previewPhotos[previewIdx].uri }} style={styles.fsImage} resizeMode="contain" />
              <View style={styles.fsNav}>
                <TouchableOpacity onPress={() => setPreviewIdx(i => Math.max(0, i - 1))} disabled={previewIdx === 0}>
                  <Ionicons name="chevron-back" size={32} color={previewIdx === 0 ? '#555' : '#fff'} />
                </TouchableOpacity>
                <Text style={{ color: '#fff' }}>{previewIdx + 1} / {previewPhotos.length}</Text>
                <TouchableOpacity onPress={() => setPreviewIdx(i => Math.min(previewPhotos.length - 1, i + 1))} disabled={previewIdx === previewPhotos.length - 1}>
                  <Ionicons name="chevron-forward" size={32} color={previewIdx === previewPhotos.length - 1 ? '#555' : '#fff'} />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>

      {/* チラシプレビュー */}
      <Modal visible={!!flyerPreview} transparent animationType="fade">
        <View style={styles.fsOverlay}>
          <TouchableOpacity style={styles.fsClose} onPress={() => setFlyerPreview(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {flyerPreview && (
            <Image source={{ uri: flyerPreview.uri }} style={styles.fsImage} resizeMode="contain" />
          )}
        </View>
      </Modal>

      {/* アップロードオーバーレイ */}
      {uploading && (
        <View style={styles.uploadOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={{ color: '#fff', marginTop: 10 }}>アップロード中...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── スタイル ────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },

  // ヘッダー
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 10 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037' },

  // メインタブ
  mainTabRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#EEE' },
  mainTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 6, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  mainTabActive: { borderBottomColor: COLORS.primary },
  mainTabText: { fontSize: 15, color: '#888', fontWeight: 'bold' },
  mainTabTextActive: { color: COLORS.primary },

  // 学期ジャンプ
  termJumpRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#EEE' },
  termJumpBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, borderWidth: 1.5, alignItems: 'center' },
  termJumpText: { fontSize: 13, fontWeight: 'bold' },

  // 学期セクション
  termSection: { borderLeftWidth: 4, borderRadius: 12, padding: 12, marginBottom: 16 },
  termLabel: { fontSize: 18, fontWeight: 'bold', marginBottom: 2 },
  termMonthRange: { fontSize: 12, color: '#888', marginBottom: 10 },

  // 月カード
  monthCard: { borderWidth: 1.5, borderRadius: 12, padding: 10, minHeight: 80 },
  monthCardLabel: { fontSize: 14, fontWeight: 'bold', marginBottom: 8 },
  noEventText: { fontSize: 12, color: '#bbb', textAlign: 'center', paddingVertical: 10 },

  // イベントチップ
  eventChip: { borderRadius: 10, overflow: 'hidden', marginBottom: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E0E0E0', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  eventChipHeader: { padding: 8 },
  eventCoverImgFull: { width: '100%', height: 80 },
  eventCoverPlaceholderFull: { width: '100%', height: 70, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  eventCoverImg: { width: 60, height: 60 },
  eventCoverPlaceholder: { width: 60, height: 60, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  eventChipInfo: { padding: 7, borderTopWidth: 1, borderColor: '#F0F0F0' },
  eventChipImgWrap: { position: 'relative' },
  eventChipGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.28)', paddingHorizontal: 6, paddingVertical: 3 },
  eventChipOverlay: { padding: 6, backgroundColor: 'rgba(0,0,0,0.42)' },
  eventChipTitle: { fontSize: 10, fontWeight: '500', color: '#fff' },
  eventChipDate: { fontSize: 9, color: 'rgba(255,255,255,0.82)' },
  hiddenBadge: { fontSize: 10, color: '#ffcccc', fontWeight: 'bold', marginTop: 2 },
  hiddenToggleBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, marginLeft: 6 },
  hiddenToggleBtnVisible: { backgroundColor: '#7BC67E' },
  hiddenToggleBtnHidden: { backgroundColor: COLORS.danger },
  joinBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginLeft: 6 },
  joinBtnInactive: { backgroundColor: COLORS.primary },
  joinBtnActive: { backgroundColor: '#4CAF50' },
  addCoverBtn: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8 },
  coverActionBtns: { position: 'absolute', top: 5, right: 5, flexDirection: 'row', gap: 4 },
  coverActionBtn: { backgroundColor: 'rgba(0,0,0,0.5)', padding: 5, borderRadius: 6 },

  // 長期休みタブ
  vacTabRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#EEE' },
  vacTab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  vacTabText: { fontSize: 14, color: '#888', fontWeight: 'bold' },

  // 長期休みセクション
  vacSection: { borderWidth: 1.5, borderRadius: 12, padding: 12, marginBottom: 12, backgroundColor: '#fff' },
  vacMonthLabel: { fontSize: 16, fontWeight: 'bold', marginBottom: 10 },

  // チラシ
  flyerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  flyerThumb: { width: 80, height: 56, borderRadius: 6, backgroundColor: '#F5F5F5' },
  flyerDetailBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  flyerDetailBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  flyerDeleteBtn: { padding: 8 },
  uploadFlyerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 10, justifyContent: 'center', marginTop: 4 },
  uploadFlyerBtnText: { fontWeight: 'bold', fontSize: 13 },

  // 詳細画面
  detailHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', gap: 8 },
  detailTitle: { fontSize: 17, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  detailCover: { width: '100%', height: 180, backgroundColor: '#EEE' },

  // セクション
  section: { borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 3, borderWidth: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: '#333' },
  sectionBody: { padding: 14, paddingTop: 12, borderTopWidth: 1 },
  dateText: { fontSize: 14, fontWeight: 'bold', color: '#5D4037', marginBottom: 6 },
  photoCount: { fontSize: 12, color: '#aaa', marginRight: 4 },
  emptyText: { color: '#bbb', fontSize: 13, textAlign: 'center', paddingVertical: 12 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-end', padding: 6 },
  editBtnText: { color: COLORS.primary, fontSize: 13 },
  saveBtn: { backgroundColor: COLORS.primary, padding: 12, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
  cancelBtn: { backgroundColor: '#F0F0F0', padding: 12, borderRadius: 10, alignItems: 'center' },
  cancelBtnText: { color: '#555', fontWeight: 'bold' },

  // 去年の写真
  uploadPhotoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.primary, borderRadius: 10, justifyContent: 'center', marginBottom: 10 },
  uploadPhotoBtnText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 13 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photoThumbWrap: { position: 'relative' },
  photoThumb: { width: 90, height: 90, borderRadius: 8, backgroundColor: '#EEE' },
  photoDeleteBtn: { position: 'absolute', top: -6, right: -6, backgroundColor: '#fff', borderRadius: 10 },

  // フルスクリーン
  fsOverlay: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  fsClose: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 8 },
  fsImage: { width: '100%', height: '80%' },
  fsNav: { flexDirection: 'row', alignItems: 'center', gap: 40, marginTop: 16 },

  // アップロードオーバーレイ
  uploadOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', zIndex: 999 },
});