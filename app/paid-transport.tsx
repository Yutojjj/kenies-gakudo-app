import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  collection, deleteDoc, doc, getDocs, onSnapshot,
  query, setDoc, where
} from 'firebase/firestore';
import {
  getDownloadURL, ref as storageRef, uploadString
} from 'firebase/storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Image, Modal, Platform, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View
} from 'react-native';
import SignaturePad from '../components/SignaturePad';
import { COLORS } from '../constants/theme';
import { db, storage } from '../firebase';
import { useRequireRole } from '../hooks/useRequireRole';
import { navigateHome } from '../utils/navigationHome';

// ─── ユーティリティ ───────────────────────────────────────────────────
const customAlert = (title: string, message?: string) => {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n${message}` : title);
  else Alert.alert(title, message);
};
const customConfirm = (title: string, msg: string, onOk: () => void) => {
  if (Platform.OS === 'web') { if (window.confirm(`${title}\n${msg}`)) onOk(); }
  else Alert.alert(title, msg, [{ text: 'キャンセル' }, { text: 'OK', onPress: onOk }]);
};

// ─── 型定義 ──────────────────────────────────────────────────────────
interface Kid {
  id: string;       // accounts ドキュメントID
  childId: string;  // 子供識別ID (accountId + "__sib__n" or just accountId)
  name: string;
  nickname: string;
  school: string;
  grade: string;
}

interface DayEntry {
  status: 'circle' | 'cross';  // ○ or ✕
  count: number;                // 送迎回数
}

// Firestore: paid_transport_members/{memberId}
interface Member {
  id: string;  // childId ベースのID
  childId: string;
  name: string;
  nickname: string;
  school: string;
  grade: string;
  accountDocId: string;
}

// Firestore: paid_transport_monthly/{memberId}_{YYYY-MM}
interface MonthlyRecord {
  id: string;
  memberId: string;
  yearMonth: string;    // "YYYY-MM"
  days: Record<string, DayEntry>;  // key: "YYYY-MM-DD"
  estimatedAmount: number;
  confirmedAmount: number;
  isConfirmed: boolean;  // 管理者が確定押した
  isAccepted: boolean;   // 利用者が承諾した
  signatureData?: string;
  confirmedAt?: any;
  acceptedAt?: any;
}

// ─── 定数 ───────────────────────────────────────────────────────────
const PRICE_PER = 500;

const getDaysInMonth = (year: number, month: number) => {
  return new Date(year, month, 0).getDate();
};

const formatYM = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, '0')}`;

const today = new Date();

// ─── メイン画面 ──────────────────────────────────────────────────────
export default function PaidTransportScreen() {
  const { verified, checking } = useRequireRole(['admin', 'user', 'staff']);

  const router = useRouter();
  const { role: roleParam, name: nameParam } = useLocalSearchParams<{ role?: string; name?: string }>();
  const isAdmin = roleParam === 'admin';
  const isUser = roleParam === 'user';

  // 年月選択
  const [selYear, setSelYear] = useState(today.getFullYear());
  const [selMonth, setSelMonth] = useState(today.getMonth() + 1);
  const ym = formatYM(selYear, selMonth);

  // データ
  const [members, setMembers] = useState<Member[]>([]);
  const [monthlyRecords, setMonthlyRecords] = useState<MonthlyRecord[]>([]);
  const [lessons, setLessons] = useState<any[]>([]);  // isPaid=trueの習い事

  // モーダル制御
  const [addMemberModal, setAddMemberModal] = useState(false);
  const [calendarModal, setCalendarModal] = useState(false);
  const [calendarMember, setCalendarMember] = useState<Member | null>(null);
  const [signModal, setSignModal] = useState(false);
  const [signViewModal, setSignViewModal] = useState(false);
  const [signViewData, setSignViewData] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState(false);

  // メンバー追加検索
  const [kidList, setKidList] = useState<Kid[]>([]);
  const [memberSearch, setMemberSearch] = useState('');

  // ─── ロード ──────────────────────────────────────────────────────
  // メンバー一覧をリアルタイム
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'paid_transport_members'), snap => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Member)));
    });
    return () => unsub();
  }, []);

  // 月次レコードをリアルタイム
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'paid_transport_monthly'), where('yearMonth', '==', ym)),
      snap => setMonthlyRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as MonthlyRecord)))
    );
    return () => unsub();
  }, [ym]);

  // isPaid=trueの習い事
  useEffect(() => {
    getDocs(query(collection(db, 'lessons'), where('isPaid', '==', true)))
      .then(snap => setLessons(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, []);

  // ─── メンバー追加モーダル用：子供一覧ロード ──────────────────────
  const openAddMemberModal = async () => {
    const snap = await getDocs(query(collection(db, 'accounts'), where('role', '==', 'user')));
    const kids: Kid[] = [];
    snap.docs.forEach(d => {
      const data = d.data();
      if (data.name) {
        kids.push({
          id: d.id,
          childId: d.id,
          name: data.name,
          nickname: data.nicknameKana || '',
          school: data.school || '',
          grade: data.grade || '',
        });
      }
      // 兄弟姉妹
      if (data.siblings && Array.isArray(data.siblings)) {
        data.siblings.forEach((sib: any, i: number) => {
          if (sib.name) {
            kids.push({
              id: d.id,
              childId: `${d.id}__sib__${i}`,
              name: sib.name,
              nickname: sib.nicknameKana || '',
              school: sib.school || '',
              grade: sib.grade || '',
            });
          }
        });
      }
    });
    // 既にメンバーのchildIdを除外
    const existingIds = new Set(members.map(m => m.childId));
    setKidList(kids.filter(k => !existingIds.has(k.childId)));
    setMemberSearch('');
    setAddMemberModal(true);
  };

  const addMember = async (kid: Kid) => {
    const memberId = kid.childId.replace(/[^a-zA-Z0-9_]/g, '_');
    await setDoc(doc(db, 'paid_transport_members', memberId), {
      childId: kid.childId,
      name: kid.name,
      nickname: kid.nickname,
      school: kid.school,
      grade: kid.grade,
      accountDocId: kid.id,
      createdAt: new Date(),
    });
    setAddMemberModal(false);
  };

  const removeMember = async (member: Member) => {
    customConfirm('メンバー削除', `${member.name}を有料送迎メンバーから削除しますか？`, async () => {
      await deleteDoc(doc(db, 'paid_transport_members', member.id));
    });
  };

  // ─── 月次レコード取得ヘルパー ──────────────────────────────────
  const getRecord = (memberId: string): MonthlyRecord | null => {
    return monthlyRecords.find(r => r.memberId === memberId) || null;
  };

  const getOrCreateRecordId = (memberId: string) => `${memberId}_${ym}`;

  // ─── カレンダーモーダルを開く ──────────────────────────────────
  const openCalendar = (member: Member) => {
    setCalendarMember(member);
    setCalendarModal(true);
  };

  // ─── 管理者：確定ボタン ───────────────────────────────────────
  const confirmRecord = async (member: Member) => {
    const record = getRecord(member.id);
    const totalConfirmed = calcConfirmedAmount(record);
    const docId = getOrCreateRecordId(member.id);
    await setDoc(doc(db, 'paid_transport_monthly', docId), {
      memberId: member.id,
      yearMonth: ym,
      days: record?.days || {},
      estimatedAmount: calcEstimatedAmount(record),
      confirmedAmount: totalConfirmed,
      isConfirmed: true,
      isAccepted: record?.isAccepted || false,
      signatureData: record?.signatureData || null,
      confirmedAt: new Date(),
    }, { merge: true });
    customAlert('確定しました', `${member.name} の ${ym} 分を確定しました`);
    setConfirmDialog(false);
  };

  // ─── 利用者：承諾ボタン ───────────────────────────────────────
  const acceptRecord = async (member: Member, signatureDataUrl: string) => {
    const record = getRecord(member.id);
    if (!record) return;
    const docId = getOrCreateRecordId(member.id);
    try {
      // Base64をStorageにアップロードしてURL取得
      const path = `albums/signatures/${member.id}_${selYear}_${String(selMonth).padStart(2,'0')}_${Date.now()}.png`;
      const sref = storageRef(storage, path);
      // data:image/png;base64,... 形式をアップロード
      await uploadString(sref, signatureDataUrl, 'data_url');
      const signatureUrl = await getDownloadURL(sref);

      await setDoc(doc(db, 'paid_transport_monthly', docId), {
        ...record,
        isAccepted: true,
        signatureData: signatureUrl,  // URLを保存（Base64ではなく）
        acceptedAt: new Date(),
      }, { merge: true });
      setSignModal(false);
      customAlert('承諾しました', 'サインが保存されました');
    } catch (e: any) {
      customAlert('エラー', 'サインの保存に失敗しました: ' + (e?.message || ''));
    }
  };

  // ─── 金額計算 ─────────────────────────────────────────────────
  const DOW_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

  // その月の有料送迎の予定日数を習い事の曜日から計算
  const countPaidLessonDaysInMonth = (member: Member, year: number, month: number): number => {
    const memberLessons = lessons.filter(l => l.childId === member.childId && l.isPaid === true);
    if (memberLessons.length === 0) return 0;
    const paidDows = new Set(memberLessons.map((l: any) => l.dayOfWeek));
    const daysInMonth = new Date(year, month, 0).getDate();
    let count = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (paidDows.has(DOW_NAMES[dow])) count++;
    }
    return count;
  };

  const calcEstimatedAmount = (record: MonthlyRecord | null, member?: Member): number => {
    const days = record?.days || {};
    let total = 0;
    const daysInMonth = new Date(selYear, selMonth, 0).getDate();

    // メンバーの有料送迎曜日を取得
    const memberLessons = member
      ? lessons.filter(l => l.childId === member.childId && l.isPaid === true)
      : [];
    const paidDows = new Set(memberLessons.map((l: any) => l.dayOfWeek));

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${selYear}-${String(selMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dow = new Date(selYear, selMonth - 1, d).getDay();
      const dowName = DOW_NAMES[dow];
      const entry = days[dateStr];

      if (entry?.status === 'circle') {
        // ○確定済み → 設定回数 × 500
        total += (entry.count || 1) * PRICE_PER;
      } else if (entry?.status === 'cross') {
        // ✕ → 0円
      } else if (paidDows.has(dowName)) {
        // 未設定で有料送迎曜日 → 1回分を見込みに含める
        total += PRICE_PER;
      }
    }
    return total;
  };

  const calcConfirmedAmount = (record: MonthlyRecord | null): number => {
    // 確定金額は○のみ
    if (!record) return 0;
    return Object.values(record.days || {})
      .filter(d => d.status === 'circle')
      .reduce((sum, d) => sum + (d.count || 1) * PRICE_PER, 0);
  };

  // ─── その月の未入力チェック ───────────────────────────────────
  const hasUnfilledDays = (member: Member): boolean => {
    const record = getRecord(member.id);
    if (!record) return false;
    const days = record.days || {};
    const daysInMonth = getDaysInMonth(selYear, selMonth);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${ym}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(selYear, selMonth - 1, d).getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;  // 土日は除外
      const entry = days[dateStr];
      // ○が入っているが回数が未設定のケース
      if (entry?.status === 'circle' && (!entry.count || entry.count < 1)) return true;
    }
    return false;
  };

  // ─── 利用者向け：自分のメンバーIDを探す ──────────────────────
  const myMember = useMemo(() => {
    if (!isUser || !nameParam) return null;
    return members.find(m => m.name === nameParam) || null;
  }, [isUser, nameParam, members]);

  // ─── フィルタ済みキッズリスト ────────────────────────────────
  const filteredKids = useMemo(() => {
    const q = memberSearch.toLowerCase();
    if (!q) return kidList;
    return kidList.filter(k =>
      k.name.toLowerCase().includes(q) ||
      k.nickname.toLowerCase().includes(q) ||
      k.school.toLowerCase().includes(q) ||
      k.grade.toLowerCase().includes(q)
    );
  }, [kidList, memberSearch]);

  // ─── UI：月ナビゲーター ──────────────────────────────────────
  const MonthNav = () => (
    <View style={styles.monthNav}>
      <Text style={styles.yearLabel}>{selYear}年</Text>
      <View style={styles.monthRow}>
        <TouchableOpacity onPress={() => {
          if (selMonth === 1) { setSelMonth(12); setSelYear(y => y - 1); }
          else setSelMonth(m => m - 1);
        }} style={styles.monthArrow}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{selMonth}月</Text>
        <TouchableOpacity onPress={() => {
          if (selMonth === 12) { setSelMonth(1); setSelYear(y => y + 1); }
          else setSelMonth(m => m + 1);
        }} style={styles.monthArrow}>
          <Ionicons name="chevron-forward" size={22} color={COLORS.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );

  // ─── 管理者メンバーカード ─────────────────────────────────────
  const AdminMemberCard = ({ member }: { member: Member }) => {
    const record = getRecord(member.id);
    const estimated = calcEstimatedAmount(record, member);
    const confirmed = calcConfirmedAmount(record);
    const unfilled = hasUnfilledDays(member);

    return (
      <TouchableOpacity style={styles.memberCard} onPress={() => openCalendar(member)} activeOpacity={0.85}>
        <View style={styles.memberCardTop}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.memberName}>{member.name}</Text>
              {unfilled && (
                <View style={styles.alertBadge}>
                  <Text style={styles.alertBadgeText}>！</Text>
                </View>
              )}
            </View>
            <Text style={styles.memberSub}>{member.school}　{member.grade}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.statusBadge, record?.isConfirmed ? styles.confirmedBadge : styles.unconfirmedBadge]}>
              <Text style={styles.statusBadgeText}>{record?.isConfirmed ? '確定済み' : '未確定'}</Text>
            </View>
            <View style={[styles.statusBadge, record?.isAccepted ? styles.acceptedBadge : styles.unacceptedBadge]}>
              <Text style={styles.statusBadgeText}>{record?.isAccepted ? '承諾済み' : '未承諾'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.memberCardAmounts}>
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>見込み</Text>
            <Text style={styles.amountValue}>{estimated.toLocaleString()}円</Text>
          </View>
          <View style={styles.amountDivider} />
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>確定</Text>
            <Text style={[styles.amountValue, { color: '#FF7043' }]}>{confirmed.toLocaleString()}円</Text>
          </View>
        </View>

        {/* サイン表示ボタン */}
        {record?.signatureData && (
          <TouchableOpacity style={styles.signViewBtn}
            onPress={e => { e.stopPropagation?.(); setSignViewData(record.signatureData!); setSignViewModal(true); }}>
            <Ionicons name="create-outline" size={14} color="#9C27B0" />
            <Text style={styles.signViewBtnText}>サイン確認</Text>
          </TouchableOpacity>
        )}

        {/* 管理者の削除 */}
        <TouchableOpacity style={styles.removeBtn}
          onPress={e => { e.stopPropagation?.(); removeMember(member); }}>
          <Ionicons name="trash-outline" size={14} color={COLORS.danger} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  // ─── 利用者カード ─────────────────────────────────────────────
  const UserMemberCard = ({ member }: { member: Member }) => {
    const record = getRecord(member.id);
    const estimated = calcEstimatedAmount(record, member);
    return (
      <TouchableOpacity style={styles.memberCard} onPress={() => openCalendar(member)} activeOpacity={0.85}>
        <View style={styles.memberCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.memberName}>{member.name}</Text>
            <Text style={styles.memberSub}>{member.school}　{member.grade}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.statusBadge, record?.isConfirmed ? styles.confirmedBadge : styles.unconfirmedBadge]}>
              <Text style={styles.statusBadgeText}>{record?.isConfirmed ? '確定済み' : '未確定'}</Text>
            </View>
            <View style={[styles.statusBadge, record?.isAccepted ? styles.acceptedBadge : styles.unacceptedBadge]}>
              <Text style={styles.statusBadgeText}>{record?.isAccepted ? '承諾済み' : '未承諾'}</Text>
            </View>
          </View>
        </View>
        <View style={styles.memberCardAmounts}>
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>{selYear}年{selMonth}月 金額</Text>
            <Text style={styles.amountValue}>{estimated.toLocaleString()}円</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // ─── カレンダーモーダル ───────────────────────────────────────
  const CalendarModal = () => {
    if (!calendarMember) return null;
    const member = calendarMember;
    const record = getRecord(member.id);
    const isAdminLocal = isAdmin;
    const isUserLocal = isUser;
    const [days, setDays] = useState<Record<string, DayEntry>>(record?.days || {});
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [dayPickerVisible, setDayPickerVisible] = useState(false);
    const [saving, setSaving] = useState(false);
    const [confirmVisible, setConfirmVisible] = useState(false);

    const daysInMonth = getDaysInMonth(selYear, selMonth);
    const firstDayOfWeek = new Date(selYear, selMonth - 1, 1).getDay(); // 0=日

    // 見込み：○確定 + 未設定の有料送迎曜日
    const memberLessonsForCal = lessons.filter(l => l.childId === member.childId && l.isPaid === true);
    const paidDowsForCal = new Set(memberLessonsForCal.map((l: any) => l.dayOfWeek));
    const DOW_N = ['日','月','火','水','木','金','土'];
    let totalEstimated = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${selYear}-${String(selMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dow = new Date(selYear, selMonth - 1, d).getDay();
      const entry = days[dateStr];
      if (entry?.status === 'circle') totalEstimated += (entry.count || 1) * PRICE_PER;
      else if (entry?.status !== 'cross' && paidDowsForCal.has(DOW_N[dow])) totalEstimated += PRICE_PER;
    }
    // 確定金額：○のみ
    const totalConfirmed = Object.values(days)
      .filter(d => d.status === 'circle')
      .reduce((s, d) => s + (d.count || 1) * PRICE_PER, 0);

    // 今日以降で未入力かチェック
    const isUnfilled = (dateStr: string) => {
      const d = new Date(dateStr);
      if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) return false;
      const entry = days[dateStr];
      return !entry || (entry.status === 'circle' && entry.count < 1);
    };

    // スケジュールの有料送迎を調べる（その子・その曜日）
    const getPaidLessonsForDate = (dateStr: string) => {
      const d = new Date(dateStr);
      const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
      const dow = weekDays[d.getDay()];
      return lessons.filter(l =>
        l.childId === member.childId &&
        l.dayOfWeek === dow &&
        l.isPaid === true
      );
    };

    const saveDay = async (dateStr: string, status: 'circle' | 'cross', count: number) => {
      const newDays = { ...days, [dateStr]: { status, count } };
      if (status === 'cross') {
        // ✕の場合はcountを0に
        newDays[dateStr] = { status: 'cross', count: 0 };
      }
      setDays(newDays);

      const estimated = Object.values(newDays)
        .filter(d => d.status === 'circle')
        .reduce((s, d) => s + d.count * PRICE_PER, 0);

      const docId = getOrCreateRecordId(member.id);
      await setDoc(doc(db, 'paid_transport_monthly', docId), {
        memberId: member.id,
        yearMonth: ym,
        days: newDays,
        estimatedAmount: estimated,
        confirmedAmount: estimated,
        isConfirmed: record?.isConfirmed || false,
        isAccepted: record?.isAccepted || false,
      }, { merge: true });
      setDayPickerVisible(false);
      setSelectedDate(null);
    };

    // カレンダー日付セルのレンダリング
    const renderCalendar = () => {
      const cells = [];
      // 空セル
      for (let i = 0; i < firstDayOfWeek; i++) {
        cells.push(<View key={`empty-${i}`} style={styles.calCell} />);
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${ym}-${String(d).padStart(2, '0')}`;
        const entry = days[dateStr];
        const paidLessons = getPaidLessonsForDate(dateStr);
        const hasPaidLesson = paidLessons.length > 0;
        const unfilled = isUnfilled(dateStr);
        const isConfirmedAndLocked = record?.isConfirmed;
        const dow = new Date(selYear, selMonth - 1, d).getDay();
        const isWeekend = dow === 0 || dow === 6;
        const isToday = dateStr === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        cells.push(
          <TouchableOpacity
            key={dateStr}
            style={[
              styles.calCell,
              isWeekend && styles.calCellWeekend,
              unfilled && styles.calCellUnfilled,
              isToday && styles.calCellToday,
            ]}
            onPress={() => {
              if (isAdminLocal && !isConfirmedAndLocked) {
                setSelectedDate(dateStr);
                setDayPickerVisible(true);
              }
            }}
            activeOpacity={isAdminLocal && !isConfirmedAndLocked ? 0.7 : 1}
          >
            <Text style={[styles.calDateNum, isWeekend && { color: dow === 0 ? '#E53935' : '#1565C0' }]}>{d}</Text>
            {/* 習い事情報は常に表示 */}
            {hasPaidLesson && (
              <View style={{ marginTop: 1 }}>
                {paidLessons.slice(0, 1).map((l: any, li: number) => (
                  <Text key={li} style={{ fontSize: 8, color: '#1565C0', fontWeight: 'bold', textAlign: 'center', lineHeight: 10 }} numberOfLines={2}>
                    {l.lessonName || '送迎'}{'\n'}{l.lessonTime || ''}
                  </Text>
                ))}
              </View>
            )}
            {entry?.status === 'circle' && (
              <>
                <Text style={styles.calCircle}>○</Text>
                <Text style={styles.calCount}>{entry.count}回</Text>
              </>
            )}
            {entry?.status === 'cross' && <Text style={styles.calCross}>✕</Text>}
          </TouchableOpacity>
        );
      }
      return cells;
    };

    return (
      <Modal visible={calendarModal} animationType="slide" transparent>
        <View style={styles.calModalOverlay}>
          <SafeAreaView style={styles.calModalContent}>
            {/* ヘッダー */}
            <View style={styles.calHeader}>
              <TouchableOpacity onPress={() => setCalendarModal(false)}>
                <Ionicons name="chevron-back" size={24} color="#5D4037" />
              </TouchableOpacity>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.calHeaderName}>{member.name}</Text>
                <Text style={styles.calHeaderSub}>{member.school}　{member.grade}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.calYM}>{selYear}年{selMonth}月</Text>
              </View>
            </View>

            {/* 金額サマリー */}
            <View style={styles.calAmountBar}>
              <View style={styles.calAmountItem}>
                <Text style={styles.calAmountLabel}>見込み金額</Text>
                <Text style={styles.calAmountValue}>{totalEstimated.toLocaleString()}円</Text>
              </View>
              <View style={styles.calAmountDivider} />
              <View style={styles.calAmountItem}>
                <Text style={styles.calAmountLabel}>確定金額</Text>
                <Text style={[styles.calAmountValue, { color: '#FF7043' }]}>{totalConfirmed.toLocaleString()}円</Text>
              </View>
            </View>

            {/* 曜日ヘッダー */}
            <View style={styles.calWeekHeader}>
              {['日', '月', '火', '水', '木', '金', '土'].map((w, i) => (
                <Text key={w} style={[styles.calWeekDay, i === 0 && { color: '#E53935' }, i === 6 && { color: '#1565C0' }]}>{w}</Text>
              ))}
            </View>

            {/* カレンダー */}
            <ScrollView>
              <View style={styles.calGrid}>
                {renderCalendar()}
              </View>

              {/* 凡例 */}
              <View style={styles.calLegend}>
                <View style={styles.legendItem}><View style={[styles.legendBox, { backgroundColor: '#FFF9C4' }]} /><Text style={styles.legendText}>未入力（今日以降）</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendBox, { backgroundColor: '#E3F2FD' }]} /><Text style={styles.legendText}>有料送迎あり</Text></View>
              </View>
            </ScrollView>

            {/* 管理者：確定ボタン */}
            {isAdminLocal && !record?.isConfirmed && (
              <TouchableOpacity style={styles.confirmBtn} onPress={() => setConfirmVisible(true)}>
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                <Text style={styles.confirmBtnText}>確定する</Text>
              </TouchableOpacity>
            )}
            {isAdminLocal && record?.isConfirmed && (
              <View style={styles.confirmedBar}>
                <Ionicons name="checkmark-circle" size={18} color="#4CAF50" />
                <Text style={{ color: '#4CAF50', fontWeight: 'bold', marginLeft: 6 }}>確定済み</Text>
              </View>
            )}

            {/* 利用者：承諾ボタン */}
            {isUserLocal && record?.isConfirmed && !record?.isAccepted && (
              <TouchableOpacity style={styles.acceptBtn} onPress={() => setSignModal(true)}>
                <Ionicons name="create-outline" size={20} color="#fff" />
                <Text style={styles.confirmBtnText}>承諾してサインする</Text>
              </TouchableOpacity>
            )}
            {isUserLocal && record?.isAccepted && (
              <View style={styles.confirmedBar}>
                <Ionicons name="checkmark-circle" size={18} color="#4CAF50" />
                <Text style={{ color: '#4CAF50', fontWeight: 'bold', marginLeft: 6 }}>承諾済み</Text>
              </View>
            )}
          </SafeAreaView>
        </View>

        {/* 日付入力ピッカー */}
        {dayPickerVisible && selectedDate && (
          <DayPickerModal
            dateStr={selectedDate}
            existing={days[selectedDate]}
            onClose={() => { setDayPickerVisible(false); setSelectedDate(null); }}
            onSave={(status, count) => saveDay(selectedDate, status, count)}
          />
        )}

        {/* 確定確認ダイアログ */}
        <Modal visible={confirmVisible} transparent animationType="fade">
          <View style={styles.overlayCenter}>
            <View style={styles.confirmDialog}>
              <Text style={styles.confirmDialogTitle}>確定しますか？</Text>
              <Text style={styles.confirmDialogBody}>
                確定すると利用者が拒否するまで変更できなくなります。{'\n\n'}
                {member.name} / {selYear}年{selMonth}月{'\n'}
                金額：{totalEstimated.toLocaleString()}円
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={[styles.dialogBtn, { backgroundColor: '#EEE' }]} onPress={() => setConfirmVisible(false)}>
                  <Text style={{ fontWeight: 'bold' }}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.dialogBtn, { backgroundColor: '#FF7043' }]} onPress={() => { confirmRecord(member); setConfirmVisible(false); }}>
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>確定する</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* 承諾サインモーダル */}
        <Modal visible={signModal} transparent animationType="slide">
          <View style={styles.signOverlay}>
            <View style={styles.signContent}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={styles.modalTitle}>承諾サイン</Text>
                <TouchableOpacity onPress={() => setSignModal(false)}>
                  <Ionicons name="close" size={24} color="#333" />
                </TouchableOpacity>
              </View>
              <Text style={{ color: '#555', fontSize: 13, marginBottom: 4 }}>
                {selYear}年{selMonth}月分　金額：{totalEstimated.toLocaleString()}円
              </Text>
              <Text style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
                内容を確認の上、下記にサインしてください
              </Text>
              <SignaturePad
                onSave={(dataUrl) => acceptRecord(member, dataUrl)}
              />
            </View>
          </View>
        </Modal>
      </Modal>
    );
  };

  // ─── 日付選択ピッカー ──────────────────────────────────────────
  const DayPickerModal = ({
    dateStr, existing, onClose, onSave
  }: {
    dateStr: string;
    existing?: DayEntry;
    onClose: () => void;
    onSave: (status: 'circle' | 'cross', count: number) => void;
  }) => {
    const [status, setStatus] = useState<'circle' | 'cross'>(existing?.status || 'circle');
    const [count, setCount] = useState(existing?.count || 1);
    const d = new Date(dateStr);
    const weekDays = ['日', '月', '火', '水', '木', '金', '土'];

    return (
      <View style={styles.overlayCenter}>
        <View style={styles.dayPickerCard}>
          <Text style={styles.dayPickerTitle}>
            {d.getMonth() + 1}/{d.getDate()}（{weekDays[d.getDay()]}）
          </Text>
          <View style={styles.statusButtons}>
            <TouchableOpacity
              style={[styles.statusBtn, status === 'circle' && styles.statusBtnCircleActive]}
              onPress={() => setStatus('circle')}
            >
              <Text style={[styles.statusBtnText, status === 'circle' && { color: '#fff' }]}>○ 利用</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.statusBtn, status === 'cross' && styles.statusBtnCrossActive]}
              onPress={() => setStatus('cross')}
            >
              <Text style={[styles.statusBtnText, status === 'cross' && { color: '#fff' }]}>✕ 未利用</Text>
            </TouchableOpacity>
          </View>

          {status === 'circle' && (
            <View style={styles.countRow}>
              <Text style={styles.countLabel}>回数</Text>
              <TouchableOpacity style={styles.countBtn} onPress={() => setCount(c => Math.max(1, c - 1))}>
                <Ionicons name="remove" size={18} color={COLORS.primary} />
              </TouchableOpacity>
              <Text style={styles.countNum}>{count}</Text>
              <TouchableOpacity style={styles.countBtn} onPress={() => setCount(c => c + 1)}>
                <Ionicons name="add" size={18} color={COLORS.primary} />
              </TouchableOpacity>
              <Text style={styles.countPrice}>{(count * PRICE_PER).toLocaleString()}円</Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <TouchableOpacity style={[styles.dialogBtn, { backgroundColor: '#EEE' }]} onPress={onClose}>
              <Text style={{ fontWeight: 'bold' }}>キャンセル</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.dialogBtn, { backgroundColor: COLORS.primary }]} onPress={() => onSave(status, count)}>
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>保存</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  // ─── メインレンダリング ────────────────────────────────────────
  // 利用者向け：自分がメンバーでない場合
  if (isUser && !myMember) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigateHome(router)}>
            <Ionicons name="chevron-back" size={24} color="#5D4037" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>送迎費承諾</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Ionicons name="car-outline" size={48} color="#ccc" />
          <Text style={{ color: '#aaa', marginTop: 12 }}>有料送迎メンバーではありません</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (checking || !verified) return null;
  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigateHome(router)}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isAdmin ? '有料送迎 管理' : '送迎費承諾'}
        </Text>
        {isAdmin && (
          <TouchableOpacity style={styles.addBtn} onPress={openAddMemberModal}>
            <Ionicons name="person-add-outline" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {/* 年・月ナビゲーター */}
      <MonthNav />

      {/* メンバー一覧 */}
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
        {isAdmin && members.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: 60 }}>
            <Ionicons name="people-outline" size={48} color="#ccc" />
            <Text style={{ color: '#aaa', marginTop: 12, marginBottom: 20 }}>メンバーがいません</Text>
            <TouchableOpacity style={styles.addMemberBigBtn} onPress={openAddMemberModal}>
              <Ionicons name="person-add-outline" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: 'bold', marginLeft: 6 }}>メンバーを追加</Text>
            </TouchableOpacity>
          </View>
        )}
        {isAdmin && members.map(m => <AdminMemberCard key={m.id} member={m} />)}
        {isUser && myMember && <UserMemberCard member={myMember} />}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* メンバー追加モーダル */}
      <Modal visible={addMemberModal} transparent animationType="fade">
        <View style={styles.overlayCenter}>
          <View style={styles.addMemberModal}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={styles.modalTitle}>メンバーを追加</Text>
              <TouchableOpacity onPress={() => setAddMemberModal(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            {/* 検索バー */}
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={16} color="#aaa" />
              <TextInput
                style={styles.searchInput}
                placeholder="名前・ニックネーム・学校・学年で検索"
                placeholderTextColor="#bbb"
                value={memberSearch}
                onChangeText={setMemberSearch}
              />
            </View>

            <ScrollView style={{ maxHeight: 340 }}>
              {filteredKids.length === 0 && (
                <Text style={{ textAlign: 'center', color: '#aaa', padding: 20 }}>
                  {memberSearch ? '該当する子供が見つかりません' : '追加できる子供がいません'}
                </Text>
              )}
              {filteredKids.map(kid => (
                <TouchableOpacity key={kid.childId} style={styles.kidRow} onPress={() => addMember(kid)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kidName}>{kid.name}</Text>
                    <Text style={styles.kidSub}>{kid.school}　{kid.grade}</Text>
                    {kid.nickname && <Text style={styles.kidNick}>（{kid.nickname}）</Text>}
                  </View>
                  <Ionicons name="add-circle-outline" size={22} color={COLORS.primary} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* カレンダーモーダル */}
      <CalendarModal />

      {/* サインプレビューモーダル */}
      <Modal visible={signViewModal} transparent animationType="fade">
        <View style={styles.overlayCenter}>
          <View style={styles.signViewCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={styles.modalTitle}>承諾サイン</Text>
              <TouchableOpacity onPress={() => setSignViewModal(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            {signViewData && (
              <Image source={{ uri: signViewData }} style={{ width: '100%', height: 180 }} resizeMode="contain" />
            )}
            <TouchableOpacity style={[styles.dialogBtn, { backgroundColor: COLORS.primary, marginTop: 12, flex: 0, width: '100%' }]}
              onPress={() => setSignViewModal(false)}>
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>閉じる</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );

// ─── スタイル ─────────────────────────────────────────────────────

}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  // ヘッダー
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFF8F0', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 10 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  addBtn: { backgroundColor: COLORS.primary, borderRadius: 20, padding: 7 },

  // 月ナビ
  monthNav: { alignItems: 'center', paddingVertical: 10, backgroundColor: '#FFF8E1' },
  yearLabel: { fontSize: 13, color: '#888', marginBottom: 2 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  monthArrow: { padding: 6 },
  monthLabel: { fontSize: 28, fontWeight: 'bold', color: COLORS.primary, minWidth: 60, textAlign: 'center' },

  // メンバーカード
  memberCard: { backgroundColor: '#fff', borderRadius: 16, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 3, marginBottom: 4 },
  memberCardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  memberName: { fontSize: 17, fontWeight: 'bold', color: '#333' },
  memberSub: { fontSize: 12, color: '#888', marginTop: 2 },
  memberCardAmounts: { flexDirection: 'row', backgroundColor: '#F8F8F8', borderRadius: 10, padding: 10 },
  amountItem: { flex: 1, alignItems: 'center' },
  amountLabel: { fontSize: 11, color: '#aaa' },
  amountValue: { fontSize: 16, fontWeight: 'bold', color: '#333', marginTop: 2 },
  amountDivider: { width: 1, backgroundColor: '#EEE' },
  alertBadge: { backgroundColor: '#FF7043', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  alertBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  statusBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  confirmedBadge: { backgroundColor: '#E8F5E9' },
  unconfirmedBadge: { backgroundColor: '#FFF3E0' },
  acceptedBadge: { backgroundColor: '#E8EAF6' },
  unacceptedBadge: { backgroundColor: '#F5F5F5' },
  statusBadgeText: { fontSize: 11, fontWeight: 'bold', color: '#555' },
  signViewBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#9C27B0', alignSelf: 'flex-start' },
  signViewBtnText: { fontSize: 12, color: '#9C27B0', fontWeight: 'bold' },
  removeBtn: { position: 'absolute', top: 12, right: 12 },
  addMemberBigBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14 },

  // メンバー追加モーダル
  addMemberModal: { backgroundColor: '#fff', borderRadius: 20, padding: 20, width: '90%', maxWidth: 480 },
  searchBar: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#E0E0E0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12, gap: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#333' },
  kidRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderColor: '#F0F0F0' },
  kidName: { fontSize: 15, fontWeight: 'bold', color: '#333' },
  kidSub: { fontSize: 12, color: '#888', marginTop: 1 },
  kidNick: { fontSize: 11, color: '#aaa' },

  // カレンダーモーダル
  calModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  calModalContent: { flex: 1, backgroundColor: '#FAFAFA' },
  calHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFF8F0' },
  calHeaderName: { fontSize: 16, fontWeight: 'bold', color: '#5D4037' },
  calHeaderSub: { fontSize: 12, color: '#8D6E63', marginTop: 1 },
  calYM: { fontSize: 14, fontWeight: 'bold', color: '#5D4037' },
  calAmountBar: { flexDirection: 'row', backgroundColor: '#FFF3E0', paddingVertical: 10, paddingHorizontal: 16 },
  calAmountItem: { flex: 1, alignItems: 'center' },
  calAmountLabel: { fontSize: 11, color: '#aaa' },
  calAmountValue: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  calAmountDivider: { width: 1, backgroundColor: '#FFD0A0' },
  calWeekHeader: { flexDirection: 'row', backgroundColor: '#F5F5F5' },
  calWeekDay: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 'bold', paddingVertical: 6, color: '#666' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4 },
  calCell: { width: '14.28%', minHeight: 70, padding: 2, borderWidth: 0.5, borderColor: '#E0E0E0', alignItems: 'center', justifyContent: 'flex-start', backgroundColor: '#fff' },
  calCellWeekend: { backgroundColor: '#F8F8F8' },
  calCellUnfilled: { backgroundColor: '#FFF9C4' },
  calCellToday: { borderColor: COLORS.primary, borderWidth: 1.5 },
  calDateNum: { fontSize: 12, fontWeight: 'bold', color: '#333', alignSelf: 'flex-start', marginLeft: 2 },
  calCircle: { fontSize: 16, color: '#4CAF50', fontWeight: 'bold' },
  calCross: { fontSize: 16, color: '#E53935', fontWeight: 'bold' },
  calCount: { fontSize: 10, color: '#4CAF50', fontWeight: 'bold' },
  lessonDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#2196F3', marginTop: 2 },
  calLegend: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendBox: { width: 16, height: 16, borderRadius: 3 },
  legendText: { fontSize: 11, color: '#888' },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FF7043', margin: 16, borderRadius: 14, paddingVertical: 14, gap: 8 },
  acceptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#9C27B0', margin: 16, borderRadius: 14, paddingVertical: 14, gap: 8 },
  confirmBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  confirmedBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', margin: 16, padding: 12, backgroundColor: '#E8F5E9', borderRadius: 12 },

  // 日付ピッカー
  overlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  dayPickerCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, width: '80%', maxWidth: 340 },
  dayPickerTitle: { fontSize: 16, fontWeight: 'bold', textAlign: 'center', color: '#333', marginBottom: 16 },
  statusButtons: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statusBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#DDD', alignItems: 'center' },
  statusBtnCircleActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  statusBtnCrossActive: { backgroundColor: '#E53935', borderColor: '#E53935' },
  statusBtnText: { fontWeight: 'bold', fontSize: 14, color: '#555' },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#F5F5F5', borderRadius: 12, paddingVertical: 10 },
  countLabel: { fontSize: 13, color: '#888' },
  countBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  countNum: { fontSize: 26, fontWeight: 'bold', color: '#333', minWidth: 30, textAlign: 'center' },
  countPrice: { fontSize: 13, color: '#FF7043', fontWeight: 'bold' },
  dialogBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },

  // 確定ダイアログ
  confirmDialog: { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '85%', maxWidth: 380 },
  confirmDialogTitle: { fontSize: 17, fontWeight: 'bold', color: '#333', marginBottom: 12, textAlign: 'center' },
  confirmDialogBody: { fontSize: 14, color: '#555', lineHeight: 22, marginBottom: 20, textAlign: 'center' },

  // サイン
  signOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  signContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  signViewCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, width: '90%', maxWidth: 420 },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#333' },
});
