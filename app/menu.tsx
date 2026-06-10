import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'crypto-js';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadString } from 'firebase/storage';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Image,
  ImageSourcePropType, Linking, Modal,
  Platform, SafeAreaView, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, TouchableWithoutFeedback, View
} from 'react-native';
import SignaturePad from '../components/SignaturePad';
import { db, storage } from '../firebase';
const ANIMALS = {
  bear:    require('../assets/animals/bear.png'),
  cat:     require('../assets/animals/cat.png'),
  dolphin: require('../assets/animals/dolphin.png'),
  frog:    require('../assets/animals/frog.png'),
  chick:   require('../assets/animals/chick.png'),
  panda:   require('../assets/animals/panda.png'),
  koala:   require('../assets/animals/koala.png'),
  rabbit:  require('../assets/animals/rabbit.png'),
};
const KANYES_LOGO = require('../assets/kanyes-logo.png');

// ── メニューアイコン画像（assets/menu/に配置済みのファイルを使用）──
const MENU_ICONS = {
  attendance:      require('../assets/menu/attendance.png'),
  eventManagement: require('../assets/menu/event-management.png'),
  shiftCreate:     require('../assets/menu/shift-create.png'),
  shiftView:       require('../assets/menu/shift-view.png'),
  album:           require('../assets/menu/album.png'),
  accountList:     require('../assets/menu/account-list.png'),
  messages:        require('../assets/menu/messages.png'),
  scheduleChanges: require('../assets/menu/schedule-changes.png'),
  schedule:        require('../assets/menu/schedule.png'),
  eventList:       require('../assets/menu/event-list.png'),
  yearEvents:      require('../assets/menu/year-events.png'),
};

const STAFF_COLORS = [
  '#FF8A65','#FFB74D','#FFD54F','#AED581','#4DB6AC',
  '#4FC3F7','#9575CD','#F06292','#A1887F','#90A4AE',
];
const TRIP_LABELS = ['1回目','2回目','3回目','4回目','5回目'];

const { width } = Dimensions.get('window');

const customAlert = (title: string, message?: string) => {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
};

const customConfirm = (title: string, message: string, onConfirm: () => void) => {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: 'キャンセル', style: 'cancel' },
      { text: 'OK', style: 'destructive', onPress: onConfirm }
    ]);
  }
};

const hashPassword = (password: string) => Crypto.SHA256(password).toString();

// ── メニューカード ──
function MenuCard({
  image, title, subtitle, bgColor, onPress, animValue, badge,
}: {
  image: ImageSourcePropType;
  title: string;
  subtitle?: string;
  bgColor: string;
  onPress: () => void;
  animValue: Animated.Value;
  badge?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.91, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 12 }).start();

  return (
    <Animated.View style={[{ flex: 1 }, {
      opacity: animValue,
      transform: [
        { scale: animValue.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
        { translateY: animValue.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
      ],
    }]}>
      <TouchableWithoutFeedback onPress={onPress} onPressIn={pressIn} onPressOut={pressOut}>
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          {badge != null && badge > 0 && (
            <View style={styles.badgeWrap}>
              <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
            </View>
          )}
          <Image source={image} style={styles.cardImage} resizeMode="cover" />
        </Animated.View>
      </TouchableWithoutFeedback>
    </Animated.View>
  );
}

// ── 背景装飾 ──
const DECO_ITEMS: { emoji: string; top: number; side: 'left' | 'right'; x: number; size: number; rotate: string; opacity: number }[] = [
  { emoji: '✏️',  top: 165, side: 'left',  x: 14, size: 30, rotate: '-22deg', opacity: 0.13 },
  { emoji: '⭐',  top: 148, side: 'right', x: 22, size: 22, rotate: '14deg',  opacity: 0.11 },
  { emoji: '🌸',  top: 290, side: 'left',  x: 16, size: 26, rotate: '-8deg',  opacity: 0.13 },
  { emoji: '📚',  top: 310, side: 'right', x: 18, size: 30, rotate: '12deg',  opacity: 0.12 },
  { emoji: '🎵',  top: 440, side: 'right', x: 22, size: 24, rotate: '-14deg', opacity: 0.13 },
  { emoji: '🎨',  top: 465, side: 'left',  x: 16, size: 26, rotate: '9deg',   opacity: 0.12 },
  { emoji: '🌟',  top: 600, side: 'left',  x: 14, size: 22, rotate: '-6deg',  opacity: 0.11 },
  { emoji: '🎒',  top: 585, side: 'right', x: 20, size: 28, rotate: '18deg',  opacity: 0.12 },
  { emoji: '🎈',  top: 720, side: 'left',  x: 20, size: 24, rotate: '-16deg', opacity: 0.12 },
  { emoji: '✏️',  top: 735, side: 'right', x: 16, size: 26, rotate: '26deg',  opacity: 0.13 },
  { emoji: '🖍️',  top: 860, side: 'right', x: 22, size: 24, rotate: '-10deg', opacity: 0.12 },
  { emoji: '📐',  top: 845, side: 'left',  x: 16, size: 22, rotate: '6deg',   opacity: 0.11 },
];

function DecoBackground() {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {DECO_ITEMS.map((item, i) => (
        <Text
          key={i}
          style={{
            position: 'absolute',
            top: item.top,
            [item.side]: item.x,
            fontSize: item.size,
            opacity: item.opacity,
            transform: [{ rotate: item.rotate }],
          }}
        >
          {item.emoji}
        </Text>
      ))}
    </View>
  );
}

export default function MenuScreen() {
  const router = useRouter();
  const { role: roleParam, name: nameParam } = useLocalSearchParams<{ role: string; name: string }>();
  const [role, setRole] = useState(roleParam || '');
  const [name, setName] = useState(nameParam || '');
  const [authChecked, setAuthChecked] = useState(false);
  const [todayPickup, setTodayPickup] = useState<Record<string, any>>({});
  const [paidTransportCount, setPaidTransportCount] = useState(0);
  const [isPaidTransportMember, setIsPaidTransportMember] = useState(false);
  const [signModalVisible, setSignModalVisible] = useState(false);
  const [showAllPickup, setShowAllPickup] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [todayMemos, setTodayMemos] = useState<{kidName: string; memo: string}[]>([]);
  const [adminNotices, setAdminNotices] = useState<{id: string; content: string; createdAt: any}[]>([]);
  const [newNotice, setNewNotice] = useState('');
  // ⑩ 週間メモ用
  const [weekMemoVisible, setWeekMemoVisible] = useState(false);
  const [weekMemoDay, setWeekMemoDay] = useState<string | null>(null);
  const [weekMemos, setWeekMemos] = useState<Record<string, {kidName: string; memo: string; isAdmin?: boolean}[]>>({});
  // お知らせ予約投稿用
  const [scheduleNoticeVisible, setScheduleNoticeVisible] = useState(false);
  const [scheduleNoticeCalDate, setScheduleNoticeCalDate] = useState<string>('');
  const [scheduleNoticeContent, setScheduleNoticeContent] = useState('');
  const [scheduleNoticeCalViewDate, setScheduleNoticeCalViewDate] = useState(new Date());
  const [scheduleNoticeStep, setScheduleNoticeStep] = useState<'calendar' | 'input'>('calendar');
  const [gradeUpModalVisible, setGradeUpModalVisible] = useState(false);
  const [gradeChoiceModalVisible, setGradeChoiceModalVisible] = useState(false);
  const [gradeUpPreview, setGradeUpPreview] = useState<{id:string; name:string; oldGrade:string; newGrade:string; role:string}[]>([]);
  const [gradeUpLoading, setGradeUpLoading] = useState(false);
  const [gradeUpDirection, setGradeUpDirection] = useState<'up'|'down'>('up');

  const userDocIdRef = useRef<string>('');
  const [fetchingDocId, setFetchingDocId] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [slideAnim] = useState(new Animated.Value(width));
  const [periodModal, setPeriodModal] = useState(false);
  const [startDay, setStartDay] = useState('1');
  const [endDay, setEndDay] = useState('15');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [calendarTarget, setCalendarTarget] = useState<'start'|'end'>('start');
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [passwordModal, setPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const [unreadCount, setUnreadCount] = useState(0);
  const [surveyCount, setSurveyCount] = useState(0); // 公開中アンケート件数

  const headerAnim = useRef(new Animated.Value(0)).current;
  const cardAnims = useRef(Array.from({ length: 8 }, () => new Animated.Value(0))).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;

  // ── 認証チェック：AsyncStorageのログイン状態を必ず確認 ──
  useEffect(() => {
    const checkAuth = async () => {
      const raw = await AsyncStorage.getItem('loggedInUser');
      if (!raw) {
        // ログイン情報なし → ログイン画面に強制リダイレクト
        router.replace('/');
        return;
      }
      let user: any = {};
      try { user = JSON.parse(raw); } catch { router.replace('/'); return; }
      // URLパラメータのroleがAsyncStorageと一致するか確認
      if (user.role !== roleParam) {
        // 不一致の場合は正しいroleで上書き（URLの改ざん対策）
        router.replace('/');
        return;
      }
      setRole(user.role || '');
      setName(user.name || '');
      setAuthChecked(true);
    };
    checkAuth();
  }, []);

  // アンケート公開件数を購読（管理者は全件、それ以外は公開中のみ）
  useEffect(() => {
    const q = role === 'admin'
      ? collection(db, 'surveys')
      : query(collection(db, 'surveys'), where('isPublished', '==', true));
    const unsub = onSnapshot(q, snap => setSurveyCount(snap.docs.length));
    return () => unsub();
  }, [role]);

  // 未読メッセージ数を購読
  useEffect(() => {
    let unsub: (() => void) | null = null;
    (async () => {
      const raw = await AsyncStorage.getItem('loggedInUser');
      if (!raw) return;
      let user: any = {};
      try { user = JSON.parse(raw); } catch { return; }
      let accountId: string = user.accountId || (user.role === 'admin' ? 'admin' : '');
      // accountId が未保存の場合は Firestore から取得
      if (!accountId && user.name) {
        try {
          const snap = await getDocs(query(collection(db, 'accounts'), where('name', '==', user.name)));
          if (!snap.empty) accountId = snap.docs[0].id;
        } catch (e) {}
      }
      if (!accountId) return;
      unsub = onSnapshot(collection(db, 'conversations'), snap => {
        const count = snap.docs.filter(d => (d.data().unreadFor || []).includes(accountId)).length;
        setUnreadCount(count);
      });
    })();
    return () => { unsub?.(); };
  }, []);

  // 有料送迎カウント（利用者向け）
  useEffect(() => {
    if (role !== 'user') return;
    const today = new Date();
    const ym = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
    // その月の有料送迎回数を集計
    getDocs(query(collection(db, 'paid_transport_records'),
      where('userName', '==', name),
      where('month', '==', ym)
    )).then(snap => {
      setPaidTransportCount(snap.docs.reduce((sum, d) => sum + (d.data().count || 0), 0));
    });
    // 有料送迎メンバーかチェック
    getDocs(collection(db, 'paid_transport_members')).then(snap => {
      const isMember = snap.docs.some(d => d.data().name === name);
      setIsPaidTransportMember(isMember);
    });
  }, [role, name]);

  // 今日のメモと管理者お知らせを取得
  useEffect(() => {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    // schedulesとschedule_memos両方からメモを取得
    const fromSchedules = getDocs(collection(db, 'schedules2')).then(snap => {
      const memos: {kidName: string; memo: string}[] = [];
      snap.forEach(d => {
        const data = d.data();
        if (d.id.endsWith(`_${dateStr}`) && data.memo) {
          memos.push({ kidName: data.kidName || data.childName || data.name || '', memo: data.memo });
        }
      });
      return memos;
    });
    const fromScheduleMemos = getDocs(query(collection(db, 'schedule_memos'), where('dateStr', '==', dateStr))).then(snap => {
      const memos: {kidName: string; memo: string}[] = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.memo) memos.push({ kidName: data.childName || data.kidName || '', memo: data.memo });
      });
      return memos;
    });
    Promise.all([fromSchedules, fromScheduleMemos]).then(([s, sm]) => {
      const combined = [...s];
      sm.forEach(m => { if (!combined.find(e => e.kidName === m.kidName && e.memo === m.memo)) combined.push(m); });
      setTodayMemos(combined);
    });

    // 管理者お知らせ
    const unsubNotices = onSnapshot(
      query(collection(db, 'admin_notices'), where('date', '==', dateStr)),
      snap => setAdminNotices(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)))
    );

    return () => { unsubNotices(); };
  }, []);

  // ⑩ 今日〜6日後の週間メモをロード
  useEffect(() => {
    const today = new Date();
    const dateStrs: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      dateStrs.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    }
    // 週間メモをschedulesとschedule_memos両方から取得
    const weekFromSchedules = getDocs(collection(db, 'schedules2')).then(snap => {
      const byDate: Record<string, {kidName: string; memo: string; isAdmin?: boolean}[]> = {};
      dateStrs.forEach(ds => { byDate[ds] = []; });
      snap.forEach(d => {
        const data = d.data();
        if (!data.memo) return;
        const matched = dateStrs.find(ds => d.id.endsWith(`_${ds}`));
        if (matched) byDate[matched].push({ kidName: data.kidName || data.childName || data.name || '', memo: data.memo, isAdmin: false });
      });
      return byDate;
    });
    const weekFromScheduleMemos = getDocs(query(collection(db, 'schedule_memos'), where('dateStr', 'in', dateStrs))).then(snap => {
      const byDate: Record<string, {kidName: string; memo: string; isAdmin?: boolean}[]> = {};
      dateStrs.forEach(ds => { byDate[ds] = []; });
      snap.forEach(d => {
        const data = d.data();
        if (data.memo && data.dateStr && byDate[data.dateStr] !== undefined) {
          byDate[data.dateStr].push({ kidName: data.childName || data.kidName || '', memo: data.memo, isAdmin: false });
        }
      });
      return byDate;
    });
    Promise.all([weekFromSchedules, weekFromScheduleMemos]).then(([ws, wsm]) => {
      const merged = { ...ws };
      dateStrs.forEach(ds => {
        (wsm[ds] || []).forEach(m => {
          if (!merged[ds]) merged[ds] = [];
          if (!merged[ds].find(e => e.kidName === m.kidName && e.memo === m.memo)) merged[ds].push(m);
        });
      });
      setWeekMemos(merged);
    });
    // 管理者お知らせも週間対応
    const unsubNoticesWeek = onSnapshot(collection(db, 'admin_notices'), snap => {
      setWeekMemos(prev => {
        const next = { ...prev };
        snap.docs.forEach(d => {
          const data = d.data();
          if (!data.date || !data.content) return;
          if (next[data.date]) {
            // 既にあれば更新しない（schedules unsubが先に走るため再セット）
          }
        });
        return next;
      });
    });
    return () => { unsubNoticesWeek(); };
  }, []);

  useEffect(() => {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const unsub2 = onSnapshot(doc(db, 'pickup_assignments', dateStr), snap => {
      if (snap.exists()) setTodayPickup(snap.data() as Record<string, string>);
      else setTodayPickup({});
    });
    return () => unsub2();
  }, []);

  useEffect(() => {
    // フワフワアニメーション
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    ).start();

    // 手振りアニメーション
    Animated.loop(
      Animated.sequence([
        Animated.timing(waveAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(waveAnim, { toValue: -1, duration: 300, useNativeDriver: true }),
        Animated.timing(waveAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(waveAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.delay(2000),
      ])
    ).start();

    Animated.sequence([
      Animated.timing(headerAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.stagger(100, cardAnims.map(a =>
        Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 10 })
      )),
    ]).start();
  }, []);

  const openSettings = () => {
    setSettingsVisible(true);
    Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
  };
  const closeSettings = () => {
    Animated.timing(slideAnim, { toValue: width, duration: 300, useNativeDriver: true })
      .start(() => setSettingsVisible(false));
  };

  const handleLogout = async () => {
    customConfirm('ログアウト', 'ログアウトしますか？', async () => {
      await AsyncStorage.removeItem('loggedInUser');
      router.replace('/');
    });
  };

  const saveShiftPeriod = async () => {
    try {
      await setDoc(doc(db, 'settings', 'shift_period'), { start: startDay, end: endDay });
      customAlert('保存完了', `毎月 ${startDay}日 〜 ${endDay}日 を提出期間に設定しました。`);
      setPeriodModal(false);
    } catch (e) {
      customAlert('エラー', '保存に失敗しました');
    }
  };

  const openPasswordModal = async () => {
    if (!userDocIdRef.current && name) {
      setFetchingDocId(true);
      try {
        const q = query(collection(db, 'accounts'), where('name', '==', name));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) userDocIdRef.current = snapshot.docs[0].id;
      } catch (error) { console.error(error); }
      finally { setFetchingDocId(false); }
    }
    setPasswordModal(true);
  };

  const savePassword = async () => {
    if (!newPassword) return;
    if (!userDocIdRef.current) { customAlert('エラー', 'ユーザー情報の取得に失敗しました。'); return; }
    try {
      const hashedPassword = hashPassword(newPassword);
      await setDoc(
        doc(db, 'accounts', userDocIdRef.current),
        { generatedPw: hashedPassword, password: hashedPassword },
        { merge: true }
      );
      customAlert('変更完了', 'パスワードを変更しました。次回から新しいパスワードでログインしてください。');
      setPasswordModal(false);
      setNewPassword('');
    } catch (e) { customAlert('エラー', 'パスワード変更に失敗しました。'); }
  };

  const floatStyle = {
    transform: [{ translateY: floatAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }],
  };
  const waveStyle = {
    transform: [{ rotate: waveAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-20deg', '0deg', '20deg'] }) }],
  };

  // 認証チェック中はローディング表示
  if (!authChecked) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF8F0' }}>
        <ActivityIndicator size="large" color='#5B9BD5' />
      </SafeAreaView>
    );
  }

  const GRADE_UP_MAP: Record<string, string> = {
    '小1': '小2', '小2': '小3', '小3': '小4',
    '小4': '小5', '小5': '小6', '小6': '卒業',
  };
  const GRADE_DOWN_MAP: Record<string, string> = {
    '小2': '小1', '小3': '小2', '小4': '小3',
    '小5': '小4', '小6': '小5', '卒業': '小6',
  };

  const prepareGradeUp = async (direction: 'up' | 'down') => {
    setGradeUpDirection(direction);
    setGradeUpLoading(true);
    const MAP = direction === 'up' ? GRADE_UP_MAP : GRADE_DOWN_MAP;
    try {
      const snap = await getDocs(collection(db, 'accounts'));
      const preview: {id:string; name:string; oldGrade:string; newGrade:string; role:string}[] = [];
      snap.forEach(d => {
        const data = d.data();
        const role = data.role || '';
        if (role !== 'user' && role !== 'staff') return;
        if (role === 'user') {
          if (data.grade && MAP[data.grade]) {
            preview.push({ id: d.id, name: data.name || '', oldGrade: data.grade, newGrade: MAP[data.grade], role });
          }
          (data.siblings || []).forEach((s: any, i: number) => {
            if (s.grade && MAP[s.grade]) {
              preview.push({ id: `${d.id}__sib__${i}`, name: s.name || '', oldGrade: s.grade, newGrade: MAP[s.grade], role });
            }
          });
        }
        if (role === 'staff') {
          (data.staffChildren || []).forEach((c: any, i: number) => {
            if (c.grade && MAP[c.grade]) {
              preview.push({ id: `${d.id}__staffchild__${i}`, name: c.name || '', oldGrade: c.grade, newGrade: MAP[c.grade], role: 'staffchild' });
            }
          });
        }
      });
      preview.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      setGradeUpPreview(preview);
      setGradeUpModalVisible(true);
    } catch (e) {
      Alert.alert('エラー', '読み込みに失敗しました');
    } finally {
      setGradeUpLoading(false);
    }
  };

  const executeGradeUp = async () => {
    setGradeUpLoading(true);
    const MAP = gradeUpDirection === 'up' ? GRADE_UP_MAP : GRADE_DOWN_MAP;
    try {
      const snap = await getDocs(collection(db, 'accounts'));
      for (const d of snap.docs) {
        const data = d.data();
        const role = data.role || '';
        if (role !== 'user' && role !== 'staff') continue;
        const updates: any = {};
        let changed = false;
        if (role === 'user') {
          if (data.grade && MAP[data.grade]) { updates.grade = MAP[data.grade]; changed = true; }
          const siblings = data.siblings || [];
          const newSibs = siblings.map((s: any) => s.grade && MAP[s.grade] ? { ...s, grade: MAP[s.grade] } : s);
          if (JSON.stringify(newSibs) !== JSON.stringify(siblings)) { updates.siblings = newSibs; changed = true; }
        }
        if (role === 'staff') {
          const children = data.staffChildren || [];
          const newChildren = children.map((c: any) => c.grade && MAP[c.grade] ? { ...c, grade: MAP[c.grade] } : c);
          if (JSON.stringify(newChildren) !== JSON.stringify(children)) { updates.staffChildren = newChildren; changed = true; }
        }
        if (changed) await setDoc(doc(db, 'accounts', d.id), updates, { merge: true });
      }
      setGradeUpModalVisible(false);
      Alert.alert('完了', gradeUpDirection === 'up' ? '学年を1つ上げました。小6は「卒業」になりました。' : '学年を1つ下げました。');
    } catch (e: any) {
      Alert.alert('エラー', `更新失敗: ${e?.message}`);
    } finally {
      setGradeUpLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <DecoBackground />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── ヘッダー ── */}
        <Animated.View style={{
          opacity: headerAnim,
          transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
        }}>
          <View style={styles.headerBg}>
            {/* ☰ ボタン：最前面に固定 */}
            <TouchableOpacity onPress={openSettings} style={styles.menuBtn}>
              <Text style={{ fontSize: 20 }}>☰</Text>
              {surveyCount > 0 && (
                <View style={styles.menuBtnBadge}>
                  <Text style={{ fontSize: 9, color: '#fff', fontWeight: 'bold' }}>{surveyCount}</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* ロゴを中央に */}
            <Image
              source={KANYES_LOGO}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
              resizeMode="contain"
            />

            <View style={styles.headerContent}>
              <View style={{ flexDirection: 'column', gap: 2 }}>
                <Text style={[styles.headerGreeting, { color: '#fff', fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 3 }]}>
                  こんにちは！
                </Text>
                <Text style={[styles.headerGreeting, { color: '#fff', fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 3, fontSize: 16 }]}>
                  {name || 'ゲスト'}さん
                </Text>
              </View>
            </View>

            {/* ホームページリンク（左下） */}
            <TouchableOpacity
              style={{ position: 'absolute', bottom: 14, left: 16, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 }}
              onPress={async () => {
                const url = 'https://kanyes-club.com/';
                try {
                  if (Platform.OS === 'web') {
                    window.open(url, '_blank');
                  } else {
                    const supported = await Linking.canOpenURL(url);
                    if (supported) {
                      await Linking.openURL(url);
                    } else {
                      customAlert('エラー', 'URLを開けませんでした');
                    }
                  }
                } catch (e) {
                  customAlert('エラー', '公式サイトを開けませんでした');
                }
              }}
            >
              <Ionicons name="globe-outline" size={14} color="#fff" />
              <Text style={{ fontSize: 11, color: '#fff', fontWeight: 'bold' }}>公式サイトへ</Text>
              <Ionicons name="open-outline" size={11} color="rgba(255,255,255,0.8)" />
            </TouchableOpacity>

            {/* クマの装飾 */}
            <View style={styles.bearDecoration}>
              <Image source={ANIMALS.bear} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            </View>
          </View>
        </Animated.View>

        {/* ── 今日の送迎先（スタッフ用） ── */}
        {(role === 'staff' || role === 'admin') && Object.keys(todayPickup).length > 0 && (
          <View style={[styles.pickupSection, { borderLeftWidth: 4, borderLeftColor: '#FF8F00' }]}>
            <View style={styles.pickupSectionHeader}>
              <View>
                <Text style={[styles.pickupSectionTitle, { fontSize: 16 }]}>今日の送迎担当</Text>
                <Text style={{ fontSize: 11, color: '#BCAAA4', marginTop: 1 }}>{new Date().getMonth()+1}月{new Date().getDate()}日</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                {/* 編集ボタン */}
                <TouchableOpacity
                  style={{ backgroundColor: '#FF8F00', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  onPress={() => router.push('/attendance')}
                >
                  <Ionicons name="pencil-outline" size={13} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>編集</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.pickupToggleBtn, { paddingHorizontal: 14, paddingVertical: 8 }]} onPress={() => setShowAllPickup(v => !v)}>
                  <Text style={styles.pickupToggleBtnText}>{showAllPickup ? '自分のみ' : '全員表示'}</Text>
                </TouchableOpacity>
              </View>
            </View>
            {(() => {
              let parsedEntries: any[] = [];
              try {
                if (todayPickup.entries) {
                  const parsed = JSON.parse(todayPickup.entries as string);
                  parsedEntries = parsed.entries || [];
                }
              } catch {}
              // 管理者は「稲熊」名義のエントリを表示、スタッフは自分のみ
              const myDisplayName = role === 'admin' ? '稲熊' : name;
              const filteredEntries = showAllPickup ? parsedEntries : parsedEntries.filter((e: any) => e.staffName === myDisplayName);
              if (filteredEntries.length === 0) {
                return <View style={{ alignItems: 'center', paddingVertical: 12 }}><Text style={{ color: '#BDBDBD', fontSize: 13 }}>担当の送迎はありません</Text></View>;
              }
              return filteredEntries.map((entry: any, sIdx: number) => {
                const color = STAFF_COLORS[sIdx % STAFF_COLORS.length];
                const activeTrips = entry.trips ? entry.trips.filter((t: any) => t.blockKeys && t.blockKeys.length > 0) : [];
                if (activeTrips.length === 0) return null;
                return (
                  <View key={entry.staffName || sIdx} style={[styles.staffSection, { borderLeftColor: color, backgroundColor: color + '18', borderRadius: 10, marginBottom: 6 }]}>
                    <View style={styles.staffNameRow}>
                      <View style={[styles.staffDot, { backgroundColor: color }]} />
                      <Text style={[styles.staffName, { fontSize: 14 }]}>{entry.staffName}</Text>
                    </View>
                    <View style={[styles.tripsRow, { flexWrap: 'wrap' }]}>
                      {activeTrips.map((trip: any, tIdx: number) => (
                        <View key={tIdx} style={[styles.tripSlot, { borderColor: color, backgroundColor: '#fff', borderRadius: 8 }]}>
                          <Text style={[styles.tripLabelText, { color, fontWeight: 'bold' }]}>{TRIP_LABELS[trip.tripIndex || tIdx] || `${(trip.tripIndex || tIdx)+1}回目`}</Text>
                          <View style={{ flex: 1 }}>
                            {trip.blockKeys.map((bk: string, bkIdx: number) => {
                              const parts = bk.split('_');
                              const label = parts.slice(0, -1).join('_') + ' ' + parts[parts.length - 1];
                              return <Text key={bk} style={[styles.slotFilledText, { color: STAFF_COLORS[bkIdx % STAFF_COLORS.length] }]} numberOfLines={1}>{label}</Text>;
                            })}
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              });
            })()}
          </View>
        )}

        {/* ── ⑩ 連絡事項インライン表示（送迎担当の下） ── */}
        {(role === 'staff' || role === 'admin') && (todayMemos.length > 0 || adminNotices.length > 0) && (
          <View style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderLeftWidth: 4, borderLeftColor: '#5B9BD5', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#333' }}>今日の連絡</Text>
              <TouchableOpacity style={{ backgroundColor: '#E3F2FD', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10 }} onPress={() => setWeekMemoVisible(true)}>
                <Text style={{ color: '#1565C0', fontSize: 11, fontWeight: 'bold' }}>今週を見る</Text>
              </TouchableOpacity>
            </View>
            {adminNotices.map((n, i) => (
              <View key={n.id} style={{ flexDirection: 'row', marginBottom: 6 }}>
                <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: '#FFF3E0', marginRight: 8, alignSelf: 'flex-start' }}>
                  <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#E65100' }}>{(n as any).posterName || '稲熊'}</Text>
                </View>
                <Text style={{ fontSize: 13, color: '#424242', flex: 1, lineHeight: 18 }}>{n.content}</Text>
              </View>
            ))}
            {todayMemos.map((m, i) => (
              <View key={i} style={{ flexDirection: 'row', marginBottom: 6 }}>
                <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: '#E3F2FD', marginRight: 8, alignSelf: 'flex-start' }}>
                  <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#1565C0' }}>{m.kidName}</Text>
                </View>
                <Text style={{ fontSize: 13, color: '#424242', flex: 1, lineHeight: 18 }}>{m.memo}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── セクションラベル ── */}
        <View style={styles.sectionLabelWrap}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 4, height: 28, backgroundColor: '#00C0C7', borderRadius: 2 }} />
            <Text style={styles.sectionLabel}>MENU</Text>
          </View>
          {(role === 'staff' || role === 'admin') && (
            <TouchableOpacity style={styles.noticeBtn} onPress={() => setNoticeVisible(true)}>
              <Ionicons name="pencil-outline" size={14} color="#fff" />
              <Text style={styles.noticeBtnText}>メモを追加</Text>
              {(todayMemos.length + adminNotices.length) > 0 && (
                <View style={styles.noticeBadge}><Text style={styles.noticeBadgeText}>{todayMemos.length + adminNotices.length}</Text></View>
              )}
            </TouchableOpacity>
          )}
        </View>

                {/* ── メニューグリッド ── */}
        <View style={styles.grid}>
          {role === 'user' ? (
            <>
              {isPaidTransportMember && (
                <TouchableOpacity
                  style={[styles.paidBanner, { backgroundColor: '#E8F5E9', borderColor: '#4CAF50' }]}
                  onPress={() => router.push({ pathname: '/paid-transport', params: { role: 'user', name: name || '' } } as any)}
                  activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.paidBannerTitle, { color: '#2E7D32' }]}>🚗 送迎費承諾</Text>
                    <Text style={[styles.paidBannerCount, { color: '#388E3C' }]}>確認・サインはこちら</Text>
                  </View>
                  <View style={[styles.paidBannerBtn, { backgroundColor: '#4CAF50' }]}>
                    <Text style={styles.paidBannerBtnText}>確認する</Text>
                  </View>
                </TouchableOpacity>
              )}
              <Animated.View style={[{ opacity: cardAnims[0], transform: [{ scale: cardAnims[0].interpolate({ inputRange: [0,1], outputRange: [0.7,1] }) }, { translateY: cardAnims[0].interpolate({ inputRange: [0,1], outputRange: [40,0] }) }] }]}>
                <TouchableOpacity style={styles.cardWide} onPress={() => router.push({ pathname: '/schedule', params: { name: name || '' } } as any)} activeOpacity={0.85}>
                  <Image source={MENU_ICONS.schedule} style={styles.cardWideImage} resizeMode="contain" />
                </TouchableOpacity>
              </Animated.View>
              <Animated.View style={[{ opacity: cardAnims[1], transform: [{ scale: cardAnims[1].interpolate({ inputRange: [0,1], outputRange: [0.7,1] }) }, { translateY: cardAnims[1].interpolate({ inputRange: [0,1], outputRange: [40,0] }) }] }]}>
                <TouchableOpacity style={styles.cardWide} onPress={() => router.push({ pathname: '/event-list', params: { name: name || '' } } as any)} activeOpacity={0.85}>
                  <Image source={MENU_ICONS.eventList} style={styles.cardWideImage} resizeMode="contain" />
                </TouchableOpacity>
              </Animated.View>

              <View style={styles.gridRow}>
                <MenuCard
                  image={MENU_ICONS.album} title="アルバム" subtitle="" bgColor="#C49FD8"
                  onPress={() => router.push({ pathname: '/album', params: { role: role || '', name: name || '' } } as any)}
                  animValue={cardAnims[2]}
                />
                <MenuCard
                  image={MENU_ICONS.messages} title="メッセージ" subtitle="" bgColor="#C9AADF"
                  onPress={() => router.push('/messages' as any)}
                  animValue={cardAnims[3]}
                  badge={unreadCount}
                />
              </View>
            </>
          ) : (
            <>
              <View style={styles.gridRow}>
                <MenuCard
                  image={MENU_ICONS.attendance} title="出欠一覧" subtitle="今日の出席を確認" bgColor="#F4A460"
                  onPress={() => router.push('/attendance')}
                  animValue={cardAnims[0]}
                />
                <MenuCard
                  image={MENU_ICONS.yearEvents} title="イベント管理" subtitle="行事の管理" bgColor="#F5C842"
                  onPress={() => router.push({ pathname: '/year-events', params: { role: role || '', tab: 'management' } } as any)}
                  animValue={cardAnims[1]}
                />
              </View>
              <View style={styles.gridRow}>
                <MenuCard
                  image={MENU_ICONS.shiftCreate}
                  title={role === 'admin' ? 'シフト作成' : 'シフト提出'}
                  subtitle="シフトを管理"
                  bgColor="#8CC84B"
                  onPress={() =>
                    role === 'admin'
                      ? router.push('/shift-create')
                      : router.push({ pathname: '/shift', params: { name: name || '' } } as any)
                  }
                  animValue={cardAnims[2]}
                />
                <MenuCard
                  image={MENU_ICONS.shiftView} title="シフトを見る" subtitle="シフトを確認" bgColor="#6CBDE8"
                  onPress={() => router.push({ pathname: '/shift-view', params: { name: name || '' } } as any)}
                  animValue={cardAnims[3]}
                />
              </View>
              <View style={styles.gridRow}>
                <MenuCard
                  image={MENU_ICONS.album} title="アルバム" subtitle="思い出の写真" bgColor="#C49FD8"
                  onPress={() => router.push({ pathname: '/album', params: { role: role || '', name: name || '' } } as any)}
                  animValue={cardAnims[4]}
                />
                {role === 'admin'
                  ? <MenuCard
                      image={MENU_ICONS.accountList} title="アカウント管理" subtitle="プロフィール設定" bgColor="#F9C0C0"
                      onPress={() => router.push('/account/list')}
                      animValue={cardAnims[5]}
                    />
                  : <MenuCard
                      image={MENU_ICONS.messages} title="メッセージ" subtitle="管理者に連絡" bgColor="#C9AADF"
                      onPress={() => router.push('/messages' as any)}
                      animValue={cardAnims[5]}
                      badge={unreadCount}
                    />
                }
              </View>
              {role === 'admin' && (
                <View style={styles.gridRow}>
                  <MenuCard
                    image={MENU_ICONS.messages} title="メッセージ" subtitle="利用者・スタッフと連絡" bgColor="#C9AADF"
                    onPress={() => router.push('/messages' as any)}
                    animValue={cardAnims[6]}
                    badge={unreadCount}
                  />
                  <MenuCard
                    image={MENU_ICONS.scheduleChanges} title="変更履歴" subtitle="スケジュール変更を確認" bgColor="#E8C97A"
                    onPress={() => router.push('/schedule-changes' as any)}
                    animValue={cardAnims[7]}
                  />
                </View>
              )}
              
            </>
          )}
        </View>


      </ScrollView>

      {/* ── 学年一括更新モーダル ── */}
      {/* 学年変更：上げる/下げる選択モーダル */}
      <Modal visible={gradeChoiceModalVisible} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 30 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 }}>
            <Text style={{ fontSize: 17, fontWeight: 'bold', textAlign: 'center', color: '#333', marginBottom: 8 }}>学年一括変更</Text>
            <Text style={{ fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 24 }}>操作を選んでください</Text>
            <TouchableOpacity
              style={{ backgroundColor: '#4CAF50', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 10 }}
              onPress={() => { setGradeChoiceModalVisible(false); prepareGradeUp('up'); }}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>進級（学年を1つ上げる）</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 }}>小6は「卒業」になります</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ backgroundColor: '#FF9800', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 10 }}
              onPress={() => { setGradeChoiceModalVisible(false); prepareGradeUp('down'); }}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>学年を1つ下げる（戻す）</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ backgroundColor: '#EEE', padding: 14, borderRadius: 12, alignItems: 'center' }}
              onPress={() => setGradeChoiceModalVisible(false)}
            >
              <Text style={{ color: '#555', fontWeight: 'bold' }}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={gradeUpModalVisible} animationType="slide" transparent>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' }}>
          <View style={{ backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, maxHeight:'85%' }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, borderBottomWidth:1, borderColor:'#eee' }}>
              <Text style={{ fontSize:17, fontWeight:'bold', color:'#33691E' }}>🎓 学年一括更新（進級）</Text>
              <TouchableOpacity onPress={() => setGradeUpModalVisible(false)}>
                <Ionicons name="close" size={26} color="#333" />
              </TouchableOpacity>
            </View>
            <View style={{ padding:14, backgroundColor:'#FFF8E1', borderBottomWidth:1, borderColor:'#eee' }}>
              <Text style={{ fontSize:13, color:'#856404' }}>
                ⚠️ {gradeUpDirection === 'up' ? `以下の${gradeUpPreview.length}名の学年を1つ上げます。小6は「卒業」になります。` : `以下の${gradeUpPreview.length}名の学年を1つ下げます。`}実行前にご確認ください。
              </Text>
            </View>
            <ScrollView style={{ maxHeight:320 }} contentContainerStyle={{ padding:12, gap:6 }}>
              {gradeUpPreview.map((p, i) => (
                <View key={i} style={{ flexDirection:'row', alignItems:'center', padding:10, backgroundColor:'#F8F8F8', borderRadius:10 }}>
                  <Text style={{ flex:1, fontSize:14, fontWeight:'bold', color:'#333' }}>{p.name}</Text>
                  <Text style={{ fontSize:10, color:'#888', marginRight:4 }}>{p.role === 'staffchild' ? 'スタッフ子' : '利用者'}</Text>
                  <Text style={{ fontSize:13, color:'#888', marginRight:8 }}>{p.oldGrade}</Text>
                  <Ionicons name="arrow-forward" size={14} color="#5B9BD5" />
                  <Text style={{ fontSize:13, fontWeight:'bold', color: p.newGrade === '卒業' ? '#E53935' : '#4CAF50', marginLeft:8 }}>{p.newGrade}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection:'row', gap:10, padding:16 }}>
              <TouchableOpacity
                style={{ flex:1, paddingVertical:14, borderRadius:14, borderWidth:1.5, borderColor:'#ccc', alignItems:'center' }}
                onPress={() => setGradeUpModalVisible(false)}
              >
                <Text style={{ color:'#666', fontWeight:'bold', fontSize:15 }}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex:2, paddingVertical:14, borderRadius:14, backgroundColor: gradeUpLoading ? '#ccc' : gradeUpDirection === 'up' ? '#4CAF50' : '#FF9800', alignItems:'center' }}
                onPress={executeGradeUp}
                disabled={gradeUpLoading}
              >
                <Text style={{ color:'#fff', fontWeight:'bold', fontSize:15 }}>
                  {gradeUpLoading ? '更新中...' : gradeUpDirection === 'up' ? `${gradeUpPreview.length}名を進級させる` : `${gradeUpPreview.length}名の学年を下げる`}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── 有料送迎サインモーダル ── */}
      <Modal visible={signModalVisible} animationType="slide" transparent>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' }}>
          <View style={{ backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, padding:20 }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <Text style={{ fontSize:17, fontWeight:'bold', color:'#5D4037' }}>🚗 有料送迎 確認書</Text>
              <TouchableOpacity onPress={() => setSignModalVisible(false)}>
                <Ionicons name="close" size={26} color="#333" />
              </TouchableOpacity>
            </View>
            <View style={{ backgroundColor:'#FFF8F0', borderRadius:12, padding:16, marginBottom:16 }}>
              <Text style={{ fontSize:13, color:'#888', marginBottom:8 }}>今月の有料送迎サービス利用料金をご確認ください。</Text>
              <Text style={{ fontSize:16, color:'#333', marginBottom:4 }}>利用回数：<Text style={{ fontWeight:'bold', color:'#FF7043' }}>{paidTransportCount}回</Text></Text>
              <Text style={{ fontSize:16, color:'#333', marginBottom:8 }}>お支払い金額：<Text style={{ fontWeight:'bold', color:'#FF7043' }}>{paidTransportCount * 500}円</Text></Text>
              <Text style={{ fontSize:13, color:'#888' }}>上記の内容でよろしければ、以下の枠内にサインをしてください。</Text>
            </View>
            <SignaturePad
              onSave={async (signData: string) => {
                const today = new Date();
                const ym = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
                try {
                  // Base64をStorageにアップロード
                  const path = `albums/signatures/${name}_${ym}_${Date.now()}.png`;
                  const sref = storageRef(storage, path);
                  await uploadString(sref, signData, 'data_url');
                  const signatureUrl = await getDownloadURL(sref);

                  await setDoc(doc(db, 'paid_transport_records', `${name}_${ym}`), {
                    userName: name,
                    month: ym,
                    count: paidTransportCount,
                    amount: paidTransportCount * 500,
                    signatureData: signatureUrl,
                    signedAt: new Date(),
                  }, { merge: true });
                  setSignModalVisible(false);
                  Alert.alert('完了', 'サインを保存しました');
                } catch (e: any) {
                  Alert.alert('エラー', 'サインの保存に失敗しました');
                }
              }}
            />
          </View>
        </View>
      </Modal>

      {/* ── ⑩ 週間メモポップアップ ── */}
      <Modal visible={weekMemoVisible} transparent animationType="fade">
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'center', alignItems:'center', padding:16 }}>
          <View style={{ width:'100%', maxHeight:'85%', backgroundColor:'#FFFDF7', borderRadius:24, overflow:'hidden', shadowColor:'#000', shadowOpacity:0.3, shadowRadius:16, elevation:12 }}>
            {/* ヘッダー */}
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:20, paddingVertical:16, backgroundColor:'#FFF3E0', borderBottomWidth:1, borderColor:'#FFE0B2' }}>
              <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                <View style={{ width:36, height:36, borderRadius:18, backgroundColor:'#FF8F00', alignItems:'center', justifyContent:'center' }}>
                  <Ionicons name="calendar" size={20} color="#fff" />
                </View>
                <View>
                  <Text style={{ fontSize:16, fontWeight:'bold', color:'#E65100' }}>今週の連絡事項</Text>
                  <Text style={{ fontSize:11, color:'#BF360C' }}>明日から6日分</Text>
                </View>
              </View>
              <TouchableOpacity
                style={{ width:32, height:32, borderRadius:16, backgroundColor:'#FFCCBC', alignItems:'center', justifyContent:'center' }}
                onPress={() => { setWeekMemoVisible(false); setWeekMemoDay(null); }}>
                <Ionicons name="close" size={18} color="#BF360C" />
              </TouchableOpacity>
            </View>

            {weekMemoDay === null ? (
              <View style={{ padding:16 }}>
                <Text style={{ fontSize:12, color:'#BCAAA4', marginBottom:14, textAlign:'center', letterSpacing:0.5 }}>日付カードをタップしてメモを確認</Text>
                <View style={{ flexDirection:'row', flexWrap:'wrap', gap:10 }}>
                  {(() => {
                    const today = new Date();
                    const DOW = ['日','月','火','水','木','金','土'];
                    const DOW_COLORS: Record<number, {bg: string, text: string, border: string}> = {
                      0: { bg:'#FFEBEE', text:'#C62828', border:'#EF9A9A' },
                      6: { bg:'#E3F2FD', text:'#1565C0', border:'#90CAF9' },
                    };
                    return Array.from({length:6}, (_,i) => {
                      const d = new Date(today);
                      d.setDate(today.getDate() + i + 1);
                      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                      const count = (weekMemos[ds] || []).length;
                      const dow = d.getDay();
                      const dowColor = DOW_COLORS[dow] || { bg: count > 0 ? '#FFF8E1' : '#F5F5F5', text: count > 0 ? '#E65100' : '#666', border: count > 0 ? '#FFCC02' : '#E0E0E0' };
                      return (
                        <TouchableOpacity
                          key={ds}
                          activeOpacity={0.75}
                          style={{
                            width:'30%', paddingVertical:16,
                            backgroundColor: dowColor.bg,
                            borderRadius:16, borderWidth:2,
                            borderColor: dowColor.border,
                            alignItems:'center', justifyContent:'center',
                            position:'relative',
                            shadowColor:'#000', shadowOpacity:0.06, shadowRadius:4, elevation:2,
                          }}
                          onPress={() => setWeekMemoDay(ds)}
                        >
                          <Text style={{ fontSize:13, color: dowColor.text, fontWeight:'600', marginBottom:2 }}>
                            {d.getMonth()+1}/{d.getDate()}
                          </Text>
                          <Text style={{ fontSize:22, fontWeight:'bold', color: dowColor.text }}>
                            {DOW[dow]}
                          </Text>
                          {count > 0 ? (
                            <View style={{ marginTop:6, backgroundColor:'#FF8F00', borderRadius:10, paddingHorizontal:8, paddingVertical:2 }}>
                              <Text style={{ color:'#fff', fontSize:11, fontWeight:'bold' }}>{count}件</Text>
                            </View>
                          ) : (
                            <Text style={{ marginTop:6, fontSize:10, color:'#BDBDBD' }}>なし</Text>
                          )}
                          {count > 0 && (
                            <View style={{ position:'absolute', top:8, right:8, width:10, height:10, borderRadius:5, backgroundColor:'#FF8F00' }} />
                          )}
                        </TouchableOpacity>
                      );
                    });
                  })()}
                </View>
              </View>
            ) : (
              <ScrollView style={{ padding:16 }}>
                <TouchableOpacity style={{ flexDirection:'row', alignItems:'center', marginBottom:16, gap:4 }} onPress={() => setWeekMemoDay(null)}>
                  <Ionicons name="chevron-back" size={16} color="#FF8F00" />
                  <Text style={{ color:'#FF8F00', fontWeight:'bold', fontSize:13 }}>カレンダーに戻る</Text>
                </TouchableOpacity>
                {(() => {
                  const d = new Date(weekMemoDay);
                  const DOW = ['日','月','火','水','木','金','土'];
                  return (
                    <View style={{ flexDirection:'row', alignItems:'center', gap:10, marginBottom:16 }}>
                      <View style={{ width:44, height:44, borderRadius:22, backgroundColor:'#FF8F00', alignItems:'center', justifyContent:'center' }}>
                        <Text style={{ color:'#fff', fontWeight:'bold', fontSize:16 }}>{DOW[d.getDay()]}</Text>
                      </View>
                      <View>
                        <Text style={{ fontSize:18, fontWeight:'bold', color:'#E65100' }}>{d.getMonth()+1}月{d.getDate()}日</Text>
                        <Text style={{ fontSize:12, color:'#BCAAA4' }}>{(weekMemos[weekMemoDay] || []).length}件のメモ</Text>
                      </View>
                    </View>
                  );
                })()}
                {(weekMemos[weekMemoDay] || []).length === 0 ? (
                  <View style={{ alignItems:'center', paddingVertical:32 }}>
                    <Ionicons name="document-outline" size={40} color="#E0E0E0" />
                    <Text style={{ color:'#BDBDBD', marginTop:8, fontSize:13 }}>この日のメモはありません</Text>
                  </View>
                ) : (
                  (weekMemos[weekMemoDay] || []).map((m, i) => (
                    <View key={i} style={{ backgroundColor:'#fff', borderRadius:14, padding:14, marginBottom:10, borderLeftWidth:4, borderLeftColor: m.isAdmin ? '#FF8F00' : '#5B9BD5', shadowColor:'#000', shadowOpacity:0.05, shadowRadius:4, elevation:2 }}>
                      <View style={{ flexDirection:'row', alignItems:'center', gap:6, marginBottom:6 }}>
                        <View style={{ paddingHorizontal:8, paddingVertical:2, borderRadius:8, backgroundColor: m.isAdmin ? '#FFF3E0' : '#E3F2FD' }}>
                          <Text style={{ fontSize:11, fontWeight:'bold', color: m.isAdmin ? '#E65100' : '#1565C0' }}>
                            {m.isAdmin ? '稲熊' : m.kidName}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ fontSize:14, color:'#424242', lineHeight:20 }}>{m.memo}</Text>
                    </View>
                  ))
                )}
                <View style={{ height:30 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── 連絡事項モーダル ── */}
      <Modal visible={noticeVisible} animationType="slide" transparent>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' }}>
          <View style={{ backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, maxHeight:'85%' }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, borderBottomWidth:1, borderColor:'#eee' }}>
              <Text style={{ fontSize:17, fontWeight:'bold', color:'#5D4037' }}>📋 連絡事項</Text>
              <TouchableOpacity onPress={() => setNoticeVisible(false)}>
                <Ionicons name="close" size={26} color="#333" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding:16 }}>
              {/* 管理者お知らせ */}
              {adminNotices.length > 0 && adminNotices.map(n => (
                <View key={n.id} style={{ backgroundColor:'#FFF8E1', borderRadius:12, padding:12, marginBottom:8, borderLeftWidth:4, borderLeftColor:'#FFB300' }}>
                  <Text style={{ fontSize:11, fontWeight:'bold', color:'#E65100', marginBottom:4 }}>{(n as any).posterName || '稲熊'}</Text>
                  <Text style={{ fontSize:14, color:'#333' }}>{n.content}</Text>
                  {role === 'admin' && (
                    <TouchableOpacity style={{ alignSelf:'flex-end', marginTop:4 }} onPress={async () => {
                      await deleteDoc(doc(db, 'admin_notices', n.id));
                    }}>
                      <Ionicons name="trash-outline" size={16} color="#E53935" />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {/* 今日のメモ */}
              {todayMemos.length > 0 && todayMemos.map((m, i) => (
                <View key={i} style={{ backgroundColor:'#F3F9FF', borderRadius:12, padding:12, marginBottom:8, borderLeftWidth:4, borderLeftColor:'#5B9BD5' }}>
                  <Text style={{ fontSize:12, fontWeight:'bold', color:'#5B9BD5', marginBottom:4 }}>{m.kidName}</Text>
                  <Text style={{ fontSize:14, color:'#333' }}>{m.memo}</Text>
                </View>
              ))}
              {adminNotices.length === 0 && todayMemos.length === 0 && (
                <Text style={{ textAlign:'center', color:'#aaa', marginTop:20, marginBottom:20 }}>今日の連絡事項はありません</Text>
              )}
              {/* お知らせを入力するボタン（管理者・スタッフのみ） */}
              {(role === 'admin' || role === 'staff') && (
                <TouchableOpacity
                  style={{ marginTop:16, backgroundColor:'#7CB342', borderRadius:14, padding:16, alignItems:'center', flexDirection:'row', justifyContent:'center', gap:8 }}
                  onPress={() => {
                    setScheduleNoticeContent('');
                    setScheduleNoticeStep('calendar');
                    setScheduleNoticeCalViewDate(new Date());
                    setScheduleNoticeVisible(true);
                  }}
                >
                  <Ionicons name="calendar-outline" size={20} color="#fff" />
                  <Text style={{ color:'#fff', fontWeight:'bold', fontSize:15 }}>お知らせを入力する</Text>
                </TouchableOpacity>
              )}
              <View style={{ height:40 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── お知らせ予約投稿モーダル ── */}
      <Modal visible={scheduleNoticeVisible} transparent animationType="fade">
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.55)', justifyContent:'center', alignItems:'center', padding:16 }}>
          <View style={{ width:'100%', maxHeight:'85%', backgroundColor:'#fff', borderRadius:20, overflow:'hidden' }}>
            {/* ヘッダー */}
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, backgroundColor:'#F1F8E9', borderBottomWidth:1, borderColor:'#DCEDC8' }}>
              <Text style={{ fontSize:15, fontWeight:'bold', color:'#5D4037' }}>
                {scheduleNoticeStep === 'calendar' ? '📅 表示する日付を選択' : `📝 ${scheduleNoticeCalDate} のお知らせ内容`}
              </Text>
              <TouchableOpacity onPress={() => setScheduleNoticeVisible(false)}>
                <Ionicons name="close-circle" size={28} color="#795548" />
              </TouchableOpacity>
            </View>

            {scheduleNoticeStep === 'calendar' ? (
              // ── カレンダー選択 ──
              <View style={{ padding:16 }}>
                <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                  <TouchableOpacity onPress={() => setScheduleNoticeCalViewDate(new Date(scheduleNoticeCalViewDate.getFullYear(), scheduleNoticeCalViewDate.getMonth()-1, 1))}>
                    <Ionicons name="chevron-back" size={24} color="#5D4037" />
                  </TouchableOpacity>
                  <Text style={{ fontSize:17, fontWeight:'bold', color:'#5D4037' }}>
                    {scheduleNoticeCalViewDate.getFullYear()}年 {scheduleNoticeCalViewDate.getMonth()+1}月
                  </Text>
                  <TouchableOpacity onPress={() => setScheduleNoticeCalViewDate(new Date(scheduleNoticeCalViewDate.getFullYear(), scheduleNoticeCalViewDate.getMonth()+1, 1))}>
                    <Ionicons name="chevron-forward" size={24} color="#5D4037" />
                  </TouchableOpacity>
                </View>
                {/* 曜日ヘッダー */}
                <View style={{ flexDirection:'row', marginBottom:6 }}>
                  {['日','月','火','水','木','金','土'].map((w,i) => (
                    <Text key={i} style={{ width:'14.2%', textAlign:'center', fontWeight:'bold', fontSize:12, color: i===0?'#E53935':i===6?'#1565C0':'#555' }}>{w}</Text>
                  ))}
                </View>
                {/* 日付グリッド */}
                <View>
                  {(() => {
                    const y = scheduleNoticeCalViewDate.getFullYear();
                    const m = scheduleNoticeCalViewDate.getMonth();
                    const firstDow = new Date(y, m, 1).getDay();
                    const daysInMonth = new Date(y, m + 1, 0).getDate();
                    const cells: (number | null)[] = Array(firstDow).fill(null);
                    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
                    while (cells.length % 7 !== 0) cells.push(null);
                    const weeks: (number | null)[][] = [];
                    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
                    return weeks.map((week, wi) => (
                      <View key={wi} style={{ flexDirection: 'row', marginBottom: 2 }}>
                        {week.map((day, di) => {
                          if (!day) return <View key={di} style={{ width: '14.2%', height: 36 }} />;
                          const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                          const isSelected = dateStr === scheduleNoticeCalDate;
                          return (
                            <TouchableOpacity
                              key={di}
                              style={{ width: '14.2%', height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: isSelected ? '#7CB342' : 'transparent', borderRadius: 18 }}
                              onPress={() => { setScheduleNoticeCalDate(dateStr); setScheduleNoticeStep('input'); }}
                            >
                              <Text style={{ fontSize: 14, fontWeight: isSelected ? 'bold' : 'normal', color: isSelected ? '#fff' : di === 0 ? '#E53935' : di === 6 ? '#1565C0' : '#333' }}>
                                {day}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ));
                  })()}
                </View>
              </View>
            ) : (
              // ── 内容入力 ──
              <ScrollView style={{ padding:16 }}>
                <TouchableOpacity style={{ flexDirection:'row', alignItems:'center', marginBottom:12 }} onPress={() => setScheduleNoticeStep('calendar')}>
                  <Ionicons name="chevron-back" size={16} color="#7CB342" />
                  <Text style={{ color:'#7CB342', fontSize:13, fontWeight:'bold' }}>日付を選び直す</Text>
                </TouchableOpacity>
                <Text style={{ fontSize:12, color:'#888', marginBottom:4 }}>
                  投稿者：<Text style={{ fontWeight:'bold', color: role==='admin' ? '#E65100' : '#5B9BD5' }}>{role==='admin' ? '稲熊' : name}</Text>
                  {'  '}表示日：<Text style={{ fontWeight:'bold', color:'#7CB342' }}>{scheduleNoticeCalDate}</Text>
                </Text>
                <Text style={{ fontSize:13, fontWeight:'bold', color:'#5D4037', marginBottom:8 }}>お知らせ内容</Text>
                <TextInput
                  style={{ borderWidth:1, borderColor:'#D7CCC8', borderRadius:12, padding:12, fontSize:14, minHeight:100, textAlignVertical:'top', color:'#333', backgroundColor:'#FAFAFA' }}
                  placeholder="この日に表示するお知らせを入力..."
                  placeholderTextColor="#bbb"
                  multiline
                  value={scheduleNoticeContent}
                  onChangeText={setScheduleNoticeContent}
                  autoFocus
                />
                <TouchableOpacity
                  style={{ marginTop:12, backgroundColor: scheduleNoticeContent.trim() ? '#7CB342' : '#CCC', borderRadius:12, padding:14, alignItems:'center' }}
                  disabled={!scheduleNoticeContent.trim()}
                  onPress={async () => {
                    if (!scheduleNoticeContent.trim() || !scheduleNoticeCalDate) return;
                    const posterName = role === 'admin' ? '稲熊' : name;
                    await addDoc(collection(db, 'admin_notices'), {
                      content: scheduleNoticeContent.trim(),
                      date: scheduleNoticeCalDate,
                      posterName,
                      createdAt: new Date(),
                    });
                    setScheduleNoticeContent('');
                    setScheduleNoticeCalDate('');
                    setScheduleNoticeVisible(false);
                    setNewNotice('');
                  }}
                >
                  <Text style={{ color:'#fff', fontWeight:'bold', fontSize:15 }}>📅 {scheduleNoticeCalDate} に保存する</Text>
                </TouchableOpacity>
                <View style={{ height:30 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>


      {/* ── 設定ドロワー（右からスライド） ── */}
      {settingsVisible && (
        <View style={styles.drawerOverlay}>
          <TouchableOpacity style={styles.drawerCloseArea} onPress={closeSettings} />
          <Animated.View style={[styles.drawerContent, { transform: [{ translateX: slideAnim }] }]}>
            {/* 閉じるボタン */}
            <TouchableOpacity onPress={closeSettings} style={styles.drawerCloseBtn}>
              <Text style={{ fontSize: 22, color: '#fff' }}>✕</Text>
            </TouchableOpacity>

            <ScrollView style={styles.drawerScroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 60, paddingBottom: 60 }}>
              {role === 'admin' && (
                <>
                  {[
                    { label: '学校別下校時刻', onPress: () => { closeSettings(); router.push('/school-times'); } },
                    { label: '長期休み設定', onPress: () => { closeSettings(); router.push('/holidays-setting'); } },
                    { label: '習い事一覧', onPress: () => { closeSettings(); router.push('/lesson-management' as any); } },
                    { label: '定期利用者一覧', onPress: () => { closeSettings(); router.push('/regular-users' as any); } },
                    { label: '学年一括変更', onPress: () => { closeSettings(); setGradeChoiceModalVisible(true); } },
                    { label: '有料送迎 管理', onPress: () => { closeSettings(); router.push({ pathname: '/paid-transport', params: { role: 'admin', name: name || '' } } as any); } },
                    { label: 'シフト入力期間', onPress: () => { closeSettings(); setPeriodModal(true); } },
                    { label: '合計勤務時間', onPress: () => { closeSettings(); router.push('/staff-hours' as any); } },
                    { label: 'パスワード変更', onPress: () => { closeSettings(); openPasswordModal(); } },
                    { label: `アンケート${surveyCount > 0 ? `（${surveyCount}件）` : ''}`, onPress: () => { closeSettings(); router.push('/survey' as any); } },
                  ].map((item, i) => (
                    <View key={i} style={styles.drawerItem}>
                      <TouchableOpacity onPress={item.onPress} style={{ alignItems: 'center', width: '100%' }}>
                        <Text style={styles.drawerItemText}>{item.label}</Text>
                      </TouchableOpacity>
                      <View style={styles.drawerDivider} />
                    </View>
                  ))}
                </>
              )}
              {role !== 'admin' && (
                <View style={styles.drawerItem}>
                  <TouchableOpacity onPress={openPasswordModal} style={{ alignItems: 'center', width: '100%' }}>
                    <Text style={styles.drawerItemText}>パスワード変更</Text>
                  </TouchableOpacity>
                  <View style={styles.drawerDivider} />
                </View>
              )}
              <View style={[styles.drawerItem, { marginTop: 16 }]}>
                <TouchableOpacity onPress={handleLogout} style={{ alignItems: 'center', width: '100%' }}>
                  <Text style={[styles.drawerItemText, { color: '#FFB3B3' }]}>ログアウト</Text>
                </TouchableOpacity>
                <View style={styles.drawerDivider} />
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      )}

      <Modal visible={periodModal} transparent animationType="slide">
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' }}>
          <View style={{ backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, maxHeight:'85%' }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, borderBottomWidth:1, borderColor:'#eee' }}>
              <Text style={{ fontSize:17, fontWeight:'bold', color:'#5D4037' }}>📆 シフト入力期間の設定</Text>
              <TouchableOpacity onPress={() => setPeriodModal(false)}>
                <Ionicons name="close" size={26} color="#333" />
              </TouchableOpacity>
            </View>

            {/* 選択中の期間表示 */}
            <View style={{ flexDirection:'row', justifyContent:'center', alignItems:'center', gap:12, padding:14, backgroundColor:'#FFF8F0' }}>
              <TouchableOpacity
                style={{ paddingHorizontal:16, paddingVertical:10, backgroundColor: calendarTarget==='start' ? '#D4AF37' : '#F5F5F5', borderRadius:12, minWidth:100, alignItems:'center' }}
                onPress={() => setCalendarTarget('start')}
              >
                <Text style={{ fontSize:11, color: calendarTarget==='start' ? '#fff' : '#888' }}>開始日</Text>
                <Text style={{ fontSize:16, fontWeight:'bold', color: calendarTarget==='start' ? '#fff' : '#333' }}>
                  {startDate || '未選択'}
                </Text>
              </TouchableOpacity>
              <Text style={{ fontSize:18, color:'#888' }}>〜</Text>
              <TouchableOpacity
                style={{ paddingHorizontal:16, paddingVertical:10, backgroundColor: calendarTarget==='end' ? '#D4AF37' : '#F5F5F5', borderRadius:12, minWidth:100, alignItems:'center' }}
                onPress={() => setCalendarTarget('end')}
              >
                <Text style={{ fontSize:11, color: calendarTarget==='end' ? '#fff' : '#888' }}>終了日</Text>
                <Text style={{ fontSize:16, fontWeight:'bold', color: calendarTarget==='end' ? '#fff' : '#333' }}>
                  {endDate || '未選択'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* カレンダー */}
            <View style={{ padding:12 }}>
              {/* 月ナビ */}
              <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <TouchableOpacity style={{ padding:8 }} onPress={() => {
                  if (calendarMonth === 0) { setCalendarMonth(11); setCalendarYear(y => y-1); }
                  else setCalendarMonth(m => m-1);
                }}>
                  <Ionicons name="chevron-back" size={22} color="#5D4037" />
                </TouchableOpacity>
                <Text style={{ fontSize:16, fontWeight:'bold', color:'#5D4037' }}>
                  {calendarYear}年 {calendarMonth+1}月
                </Text>
                <TouchableOpacity style={{ padding:8 }} onPress={() => {
                  if (calendarMonth === 11) { setCalendarMonth(0); setCalendarYear(y => y+1); }
                  else setCalendarMonth(m => m+1);
                }}>
                  <Ionicons name="chevron-forward" size={22} color="#5D4037" />
                </TouchableOpacity>
              </View>

              {/* 曜日ヘッダー */}
              <View style={{ flexDirection:'row', marginBottom:4 }}>
                {['日','月','火','水','木','金','土'].map((d,i) => (
                  <Text key={d} style={{ flex:1, textAlign:'center', fontSize:11, fontWeight:'bold', color: i===0?'#CC0000':i===6?'#0055CC':'#555' }}>{d}</Text>
                ))}
              </View>

              {/* 日グリッド */}
              {(() => {
                const firstDow = new Date(calendarYear, calendarMonth, 1).getDay();
                const daysInMonth = new Date(calendarYear, calendarMonth+1, 0).getDate();
                const cells: (number|null)[] = Array(firstDow).fill(null);
                for (let d=1; d<=daysInMonth; d++) cells.push(d);
                while (cells.length % 7 !== 0) cells.push(null);
                const weeks: (number|null)[][] = [];
                for (let i=0; i<cells.length; i+=7) weeks.push(cells.slice(i,i+7));
                return weeks.map((week, wi) => (
                  <View key={wi} style={{ flexDirection:'row', marginBottom:2 }}>
                    {week.map((day, di) => {
                      if (!day) return <View key={di} style={{ flex:1, height:36 }} />;
                      const dateStr = `${calendarYear}-${String(calendarMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                      const isStart = dateStr === startDate;
                      const isEnd = dateStr === endDate;
                      const inRange = startDate && endDate && dateStr > startDate && dateStr < endDate;
                      const isSun = di===0, isSat = di===6;
                      return (
                        <TouchableOpacity
                          key={di}
                          style={{ flex:1, height:36, alignItems:'center', justifyContent:'center', borderRadius:18,
                            backgroundColor: (isStart||isEnd) ? '#D4AF37' : inRange ? '#FFF3CD' : 'transparent' }}
                          onPress={() => {
                            if (calendarTarget === 'start') { setStartDate(dateStr); setCalendarTarget('end'); }
                            else { setEndDate(dateStr); }
                          }}
                        >
                          <Text style={{ fontSize:14, fontWeight:(isStart||isEnd)?'bold':'normal',
                            color:(isStart||isEnd)?'#fff':isSun?'#CC0000':isSat?'#0055CC':'#333' }}>{day}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ));
              })()}
            </View>

            <View style={{ flexDirection:'row', gap:10, padding:16 }}>
              <TouchableOpacity style={{ flex:1, paddingVertical:13, borderRadius:14, borderWidth:1.5, borderColor:'#ccc', alignItems:'center' }} onPress={() => setPeriodModal(false)}>
                <Text style={{ color:'#666', fontWeight:'bold' }}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex:2, paddingVertical:13, borderRadius:14, backgroundColor: startDate&&endDate ? '#D4AF37' : '#ccc', alignItems:'center' }}
                onPress={saveShiftPeriod}
                disabled={!startDate || !endDate}
              >
                <Text style={{ color:'#fff', fontWeight:'bold' }}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={passwordModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🔒 パスワード変更</Text>
            <TextInput
              style={[styles.input, { marginVertical: 20 }]}
              placeholder="新しいパスワード" placeholderTextColor="#BBBBBB"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#CCC' }]} onPress={() => setPasswordModal(false)}>
                <Text style={{ color: '#555' }}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#D4AF37' }]} onPress={savePassword}>
                <Text style={{ color: '#FFF', fontWeight: 'bold' }}>変更</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  scrollContent: { paddingBottom: 40 },

  // ── ヘッダー ──
  headerBg: {
    backgroundColor: '#00C0C7',
    paddingTop: 20,
    paddingBottom: 52,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 140,
  },
  cloud: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderRadius: 20,
    opacity: 0.7,
  },
  menuBtn: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 10,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center', alignItems: 'center',
  },
  menuBtnBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: '#E53935', borderRadius: 8,
    minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 3,
  },
  headerContent: {
    marginTop: 10,
    paddingRight: 48,
  },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  headerGreeting: { fontSize: 14, color: '#fff', fontWeight: '600' },
  bearDecoration: {
    position: 'absolute',
    width: 88,
    height: 88,
    bottom: -8,
    right: 20,
    zIndex: 1,
  },

  // ── 今日の送迎先 ──
  pickupSection: { marginHorizontal: 16, marginTop: 16, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  pickupSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  pickupSectionTitle: { fontSize: 15, fontWeight: 'bold', color: '#5D4037' },
  pickupToggleBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#FFF3E0', borderRadius: 12, borderWidth: 1, borderColor: '#FFCC80' },
  pickupToggleBtnText: { fontSize: 12, fontWeight: 'bold', color: '#E65100' },
  
  // 新しい送迎UI用スタイル
  staffSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 10,
    padding: 10,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  staffNameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  staffDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  staffName: { fontSize: 14, fontWeight: 'bold', color: '#333333' },
  tripsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tripSlot: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    width: '47%',
    borderStyle: 'solid'
  },
  tripLabelText: { fontSize: 10, fontWeight: 'bold', color: '#888888', marginTop: 1 },
  slotFilledText: { fontSize: 12, fontWeight: 'bold', color: '#333333', marginBottom: 2 },

  // 元の不要スタイル（念のため保持）
  pickupRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, marginBottom: 6, backgroundColor: '#F5F5F5' },
  pickupRowMe: { backgroundColor: '#FFF9E6', borderWidth: 1.5, borderColor: '#FFD54F' },
  pickupBlockLabel: { fontSize: 14, fontWeight: 'bold', color: '#333333' },
  pickupStaffBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, backgroundColor: '#E0E0E0' },
  pickupStaffBadgeMe: { backgroundColor: '#5B9BD5' },
  pickupStaffText: { fontSize: 13, fontWeight: 'bold', color: '#555' },

  // ── セクションラベル ──
  sectionLabelWrap: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  paidBanner: { marginHorizontal: 16, marginTop: 12, backgroundColor: '#FFF3E0', borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#FF7043' },
  paidBannerTitle: { fontSize: 13, fontWeight: 'bold', color: '#FF7043' },
  paidBannerCount: { fontSize: 18, fontWeight: 'bold', color: '#333', marginTop: 2 },
  paidBannerBtn: { backgroundColor: '#FF7043', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  paidBannerBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  noticeBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#00C0C7', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, gap: 5, shadowColor: '#00C0C7', shadowOpacity: 0.3, shadowRadius: 6, elevation: 4 },
  noticeBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  noticeBadge: { backgroundColor: '#E53935', borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  noticeBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  sectionLabel: {
    fontSize: 26,
    fontWeight: '900',
    color: '#333',
    letterSpacing: 8,
    fontStyle: 'italic',
  },

  // ── グリッド ──
  grid: { paddingHorizontal: 14, gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12, marginBottom: 0 },
  gridRowSingle: { flexDirection: 'row', gap: 12, marginBottom: 0 },
  cardWide: { flex: 1, borderRadius: 22, overflow: 'hidden', shadowColor: '#8B7340', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 6, aspectRatio: 2.7, backgroundColor: '#F5DCA8' },
  cardWideImage: { width: '100%', height: '100%' },

  // ── カード ──
  card: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: '#8B7340',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
    aspectRatio: 1.35,
  },
  cardImage: { width: '100%', height: '100%' },
  cardLabelWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingVertical: 8, paddingHorizontal: 6,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: '#fff', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  cardSubtitle: { fontSize: 11, color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginTop: 1 },
  badgeWrap: {
    position: 'absolute', top: 8, right: 8, zIndex: 10,
    minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: '#E74C3C',
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },

  // ── ドロワー ──
  drawerOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, flexDirection: 'row',
  },
  drawerCloseArea: { flex: 1 },
  drawerContent: {
    width: width * 0.55, backgroundColor: '#00C0C7', height: '100%',
    shadowColor: '#000', shadowOpacity: 0.3, elevation: 20,
  },
  drawerHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, paddingTop: 52,
    borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  drawerCloseBtn: {
    position: 'absolute', top: 16, right: 16, zIndex: 10, paddingTop: 20, padding: 8,
  },
  drawerTitle: { fontSize: 15, fontWeight: 'bold', color: '#fff' },
  drawerScroll: { paddingHorizontal: 20 },
  drawerSectionTitle: { fontSize: 10, color: 'rgba(255,255,255,0.5)', marginBottom: 10, textAlign: 'center' },
  drawerItem: { alignItems: 'center', paddingVertical: 2 },
  drawerDivider: { width: 30, height: 1.5, backgroundColor: 'rgba(255,255,255,0.5)', marginTop: 6, marginBottom: 6, alignSelf: 'center' },
  drawerIcon: { fontSize: 0, width: 0 },
  drawerItemText: { fontSize: 16, color: '#fff', fontWeight: '400', textAlign: 'center', letterSpacing: 0.5, fontStyle: 'normal', paddingVertical: 8 },

  // ── モーダル ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(45,42,34,0.55)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#FFF8F0', padding: 24, borderRadius: 24 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', color: '#5D4037' },
  modalBtn: { flex: 1, padding: 16, alignItems: 'center', borderRadius: 14 },
  numInput: {
    borderWidth: 1, borderColor: '#E8DDD0', padding: 12,
    borderRadius: 10, width: 60, textAlign: 'center', fontSize: 18,
    backgroundColor: '#FFF', color: '#5D4037',
  },
  input: {
    borderWidth: 1, borderColor: '#E8DDD0', padding: 16,
    borderRadius: 10, fontSize: 16, backgroundColor: '#FFF', color: '#5D4037',
  },
});