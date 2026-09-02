/**
 * typing-cert.tsx
 * タイピング検定認定書管理画面（管理者専用）
 *
 * Firestore コレクション:
 *   typing_students/{id}   … { name, star, grade, updatedAt }
 *   typing_certifiers/{id} … { name }
 *   typing_certs/{id}      … { studentName, certifierName, date, star, grade, score, wpm, result, createdAt }
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  addDoc, collection, deleteDoc, doc,
  onSnapshot, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  Alert, Modal, Platform, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
  ActivityIndicator, FlatList,
} from 'react-native';
import { COLORS } from '../constants/theme';
import SwipeTabPager from '../components/SwipeTabPager';
import { db } from '../firebase';
import { useRequireRole } from '../hooks/useRequireRole';
import { navigateHome } from '../utils/navigationHome';

// ─── 型 ────────────────────────────────────────────────────────────────
type Star = 'kuro' | 'aka' | 'ki';
type Result = 'pass' | 'fail';
type TypingTab = 'create' | 'students' | 'history';

interface Student {
  id: string;
  name: string;
  kana: string;
  star: Star;
  grade: number;
  days: string[];
  updatedAt: string;
}

interface Certifier {
  id: string;
  name: string;
}

interface Cert {
  id: string;
  studentName: string;
  certifierName: string;
  date: string;
  star: Star;
  grade: number;
  score: string;
  wpm: number;
  result: Result;
  stageValues?: string[];
  stageMisses?: number[];
  createdAt: any;
}

// ─── 定数 ───────────────────────────────────────────────────────────────
const GRADES = Array.from({ length: 11 }, (_, i) => i + 1);
const STAR_LABEL: Record<Star, string> = { kuro: '黒★', aka: '赤★', ki: '黄★' };
const STAR_COLOR: Record<Star, string> = { kuro: '#212121', aka: '#C62828', ki: '#F9A825' };
const STAGE_COUNT = 8;
const PASSING_SCORE = 90;
const TYPING_TABS: TypingTab[] = ['create', 'students', 'history'];

// ─── ユーティリティ ──────────────────────────────────────────────────────
const alert$ = (title: string, msg?: string) =>
  Platform.OS === 'web' ? window.alert(msg ? `${title}\n${msg}` : title) : Alert.alert(title, msg);

const confirm$ = (title: string, msg: string, onOk: () => void) =>
  Platform.OS === 'web'
    ? window.confirm(`${title}\n${msg}`) && onOk()
    : Alert.alert(title, msg, [{ text: 'キャンセル', style: 'cancel' }, { text: 'OK', onPress: onOk }]);

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 今日の曜日を取得（'月', '火', ... '日'）
const getTodayDayOfWeek = () => {
  const d = new Date();
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return days[d.getDay()];
};

const formatDate = (s: string) => {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${y}年${m}月${d}日`;
};

// ─── サブコンポーネント ─────────────────────────────────────────────────
function StarBadge({ star, grade }: { star: Star; grade: number }) {
  return (
    <View style={[styles.badge, { backgroundColor: STAR_COLOR[star] + '22', borderColor: STAR_COLOR[star] }]}>
      <Text style={[styles.badgeText, { color: STAR_COLOR[star] }]}>{STAR_LABEL[star]} {grade}級</Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

// ─── メイン ─────────────────────────────────────────────────────────────
export default function TypingCertScreen() {
  const { verified, checking } = useRequireRole(['admin', 'staff']);
  const router = useRouter();

  // ── タブ
  const [tab, setTab] = useState<TypingTab>('create');

  // ── Firestore data
  const [students, setStudents]     = useState<Student[]>([]);
  const [certifiers, setCertifiers] = useState<Certifier[]>([]);
  const [certs, setCerts]           = useState<Cert[]>([]);
  const [loading, setLoading]       = useState(true);

  // ── 認定書作成フォーム
  const [selStudentId, setSelStudentId] = useState('');
  const [selCertifierId, setSelCertifierId] = useState('');
  const [date, setDate]             = useState(todayStr());
  const [star, setStar]             = useState<Star>('kuro');
  const [grade, setGrade]           = useState(3);
  const [score, setScore]           = useState('');
  const [stageVals, setStageVals]   = useState<string[]>(Array(STAGE_COUNT).fill(''));
  const [stageMisses, setStageMisses] = useState<string[]>(Array(STAGE_COUNT).fill(''));
  const [activeStageInput, setActiveStageInput] = useState<number | null>(null);
  const [stageInputMode, setStageInputMode] = useState<'value' | 'misses'>('value');
  const [clearStagesVisible, setClearStagesVisible] = useState(false);
  const [result, setResult]         = useState<Result>('fail');
  const [saving, setSaving]         = useState(false);

  // ── 受講者管理
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentKana, setNewStudentKana] = useState('');
  const [newStudentStar, setNewStudentStar] = useState<Star>('kuro');
  const [newStudentGrade, setNewStudentGrade] = useState(3);
  const [newStudentDays, setNewStudentDays] = useState<string[]>([]);
  const [filterDay, setFilterDay] = useState('');        // 受講者一覧絞り込み
  const [createFilterDay, setCreateFilterDay] = useState(''); // 認定書作成絞り込み
  const [editCert, setEditCert] = useState<Cert | null>(null); // 履歴編集
  const [historyFilterDay, setHistoryFilterDay] = useState(''); // 履歴曜日フィルター

  // ── 認定者管理
  const [newCertifierName, setNewCertifierName] = useState('');

  // ── ピッカーモーダル（ドロップダウン代替）
  type PickerTarget = 'student' | 'certifier' | 'star' | 'grade' | 'newStar' | 'newGrade' | null;
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);

  useEffect(() => {
    const numericScore = Number(score);
    const passed = score.trim() !== '' && Number.isFinite(numericScore) && numericScore >= PASSING_SCORE;
    setResult(passed ? 'pass' : 'fail');
  }, [score]);

  useEffect(() => {
    const hasMissInput = stageMisses.some(value => value.trim() !== '');
    if (!hasMissInput) {
      setScore('');
      return;
    }
    const totalMisses = stageMisses.reduce((sum, value) => sum + (Number.parseInt(value, 10) || 0), 0);
    setScore(String(Math.max(0, 100 - totalMisses)));
  }, [stageMisses]);

  // ── Firestore 購読
  useEffect(() => {
    if (!verified) return;
    console.log('typing-cert: verified OK, starting onSnapshot');
    const unsubs = [
      onSnapshot(query(collection(db, 'typing_students'), orderBy('name')), snap => {
        setStudents(snap.docs.map(d => ({ id: d.id, ...d.data() } as Student)));
      }, e => console.error('typing_students error:', e.code, e.message)),
      onSnapshot(query(collection(db, 'typing_certifiers'), orderBy('name')), snap => {
        setCertifiers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Certifier)));
        setLoading(false);
      }, e => console.error('typing_certifiers error:', e.code, e.message)),
      onSnapshot(query(collection(db, 'typing_certs'), orderBy('createdAt', 'desc')), snap => {
        setCerts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Cert)));
      }, e => console.error('typing_certs error:', e.code, e.message)),
    ];
    return () => unsubs.forEach(u => u());
  }, [verified]);

  // ── 氏名選択 → 星・級を自動セット
  const handleSelectStudent = (id: string) => {
    setSelStudentId(id);
    const s = students.find(st => st.id === id);
    if (s) { setStar(s.star); setGrade(s.grade); }
    setPickerTarget(null);
  };

  // ── WPM計算
  const calcWPM = () => {
    const vals = stageVals.map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0);
    if (vals.length === 0) return null;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { avg, wpm: Math.round(avg * 60) };
  };
  const wpmResult = calcWPM();
  // 入力されたステージ（はやさが入力済み）だけを対象にする。8ステージすべての入力は不要。
  const hasAllStageInputs = stageVals.some(value => Number.parseFloat(value) > 0);
  const hasStageData = stageVals.some(value => value !== '') || stageMisses.some(value => value !== '');

  const pressCustomNumberKey = (key: string) => {
    if (activeStageInput === null) return;
    const update = stageInputMode === 'value' ? setStageVals : setStageMisses;
    update(prev => {
      const next = [...prev];
      const current = next[activeStageInput] || '';
      if (key === 'clear') next[activeStageInput] = '';
      else if (key === 'backspace') next[activeStageInput] = current.slice(0, -1);
      else if (key === '.' && stageInputMode === 'value') next[activeStageInput] = current.includes('.') ? current : current ? `${current}.` : '0.';
      else if (/^\d$/.test(key) && current.length < 7) next[activeStageInput] = current === '0' ? key : `${current}${key}`;
      return next;
    });
  };

  const openStageInput = (index: number, mode: 'value' | 'misses' = 'value') => {
    setActiveStageInput(index);
    setStageInputMode(mode);
  };

  const moveToNextStage = () => {
    if (activeStageInput === null || activeStageInput >= STAGE_COUNT - 1) {
      setActiveStageInput(null);
      setStageInputMode('value');
      return;
    }
    setActiveStageInput(activeStageInput + 1);
    setStageInputMode('value');
  };

  const advanceStageInput = () => {
    if (stageInputMode === 'value') {
      setStageInputMode('misses');
      return;
    }
    // ミス数が未入力のまま次へ進む場合、UI表示（0）に合わせて実際の値も0として確定する
    if (activeStageInput !== null && stageMisses[activeStageInput] === '') {
      const index = activeStageInput;
      setStageMisses(prev => {
        const next = [...prev];
        next[index] = '0';
        return next;
      });
    }
    moveToNextStage();
  };

  const clearAllStages = () => {
    setStageVals(Array(STAGE_COUNT).fill(''));
    setStageMisses(Array(STAGE_COUNT).fill(''));
    setActiveStageInput(null);
    setStageInputMode('value');
    setClearStagesVisible(false);
  };

  // ── 認定書を画面に表示せず、印刷用フレームから直接印刷する
  const openPrintPage = (params: Record<string, string>) => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(params);
    if (Platform.OS !== 'web') {
      window.location.href = '/cert/print.html?' + p.toString();
      return;
    }

    const oldFrame = document.getElementById('typing-cert-print-iframe');
    oldFrame?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'typing-cert-print-iframe';
    frame.style.cssText = 'position:fixed;width:210mm;height:297mm;left:-10000px;top:0;border:0;visibility:hidden;';
    const cleanup = () => frame.remove();
    frame.addEventListener('load', () => {
      frame.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
      window.setTimeout(cleanup, 60000);
    }, { once: true });
    frame.src = '/cert/print.html?' + p.toString();
    document.body.appendChild(frame);
  };

  const printHistoryCert = (cert: Cert) => {
    const student = students.find(item => item.name === cert.studentName);
    openPrintPage({
      result: cert.result,
      name: cert.studentName,
      kana: student?.kana || '',
      date: cert.date,
      star: cert.star,
      grade: String(cert.grade),
      score: String(cert.score),
      wpm: String(cert.wpm),
      certifier: cert.certifierName,
    });
  };

  // ── 認定書を保存し、受講者の級・星も更新する共通処理
  const saveCertAndUpdateStudent = async (
    student: Student,
    certifierName: string,
    certDate: string, certStar: Star, certGrade: number,
    certScore: string, certWpm: number, certResult: Result,
    certStageValues: string[], certStageMisses: string[],
  ) => {
    await addDoc(collection(db, 'typing_certs'), {
      studentName: student.name,
      certifierName,
      date: certDate,
      star: certStar,
      grade: certGrade,
      score: certScore,
      wpm: certWpm,
      result: certResult,
      stageValues: certStageValues,
      stageMisses: certStageMisses.map(value => Number.parseInt(value, 10) || 0),
      createdAt: serverTimestamp(),
    });
    // 合格のときのみ受講者の級・星を更新
    if (certResult === 'pass') {
      await updateDoc(doc(db, 'typing_students', student.id), {
        star: certStar,
        grade: certGrade,
        updatedAt: certDate,
      });
    }
  };

  // ── 認定書保存（記録のみ）
  const handleSave = async () => {
    const student = students.find(s => s.id === selStudentId);
    const certifier = certifiers.find(c => c.id === selCertifierId);
    if (!student) { alert$('エラー', '氏名を選択してください'); return; }
    if (!hasAllStageInputs) { alert$('エラー', '少なくとも1ステージ分のはやさを入力してください'); return; }
    if (!wpmResult) { alert$('エラー', 'WPMを計算するためステージ値を入力してください'); return; }
    setSaving(true);
    try {
      await saveCertAndUpdateStudent(
        student, certifier?.name || '', date, star, grade, score, wpmResult.wpm, result,
        stageVals, stageMisses,
      );
      alert$('保存完了', '認定書を記録しました');
      setSelStudentId(''); setSelCertifierId(''); setDate(todayStr());
      setScore(''); setStageVals(Array(STAGE_COUNT).fill('')); setStageMisses(Array(STAGE_COUNT).fill('')); setResult('fail');
    } catch (e) {
      alert$('エラー', '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // ── 印刷（保存 → print.htmlを別タブで開く）
  const handlePrint = async () => {
    const student = students.find(s => s.id === selStudentId);
    const certifier = certifiers.find(c => c.id === selCertifierId);
    if (!student) { alert$('エラー', '氏名を選択してください'); return; }
    if (!hasAllStageInputs) { alert$('エラー', '少なくとも1ステージ分のはやさを入力してください'); return; }
    if (!wpmResult) { alert$('エラー', 'WPMを計算するためステージ値を入力してください'); return; }
    setSaving(true);
    try {
      await saveCertAndUpdateStudent(
        student, certifier?.name || '', date, star, grade, score, wpmResult.wpm, result,
        stageVals, stageMisses,
      );
    } catch (e) {
      alert$('エラー', '保存に失敗しました');
      setSaving(false);
      return;
    }
    setSaving(false);
    setSelStudentId(''); setSelCertifierId(''); setDate(todayStr());
    setScore(''); setStageVals(Array(STAGE_COUNT).fill('')); setStageMisses(Array(STAGE_COUNT).fill('')); setResult('fail');
    openPrintPage({
      result,
      name: student.name,
      kana: student.kana || '',
      date,
      star,
      grade: String(grade),
      score,
      wpm: String(wpmResult.wpm),
      certifier: certifier?.name || '',
    });
  };

  // ── 受講者追加
  const handleAddStudent = async () => {
    const name = newStudentName.trim();
    if (!name) return;
    if (students.find(s => s.name === name)) { alert$('エラー', '同じ名前の受講者がいます'); return; }
    await addDoc(collection(db, 'typing_students'), { name, kana: newStudentKana.trim(), star: newStudentStar, grade: newStudentGrade, days: newStudentDays, updatedAt: todayStr() });
    setNewStudentKana('');
    setNewStudentName('');
    setNewStudentDays([]);
  };

  // ── 受講者の級・星を更新
  const handleUpdateStudent = async (id: string, update: Partial<{ star: Star; grade: number }>) => {
    await updateDoc(doc(db, 'typing_students', id), { ...update, updatedAt: todayStr() });
  };

  // ── 受講者削除
  const handleDeleteStudent = (id: string, name: string) => {
    confirm$('削除', `${name} を削除しますか？`, async () => {
      await deleteDoc(doc(db, 'typing_students', id));
    });
  };

  // ── 認定者追加
  const handleAddCertifier = async () => {
    const name = newCertifierName.trim();
    if (!name) return;
    if (certifiers.find(c => c.name === name)) { alert$('エラー', '同じ名前の認定者がいます'); return; }
    await addDoc(collection(db, 'typing_certifiers'), { name });
    setNewCertifierName('');
  };

  // ── 認定者削除
  const handleDeleteCertifier = (id: string, name: string) => {
    confirm$('削除', `${name} を削除しますか？`, async () => {
      await deleteDoc(doc(db, 'typing_certifiers', id));
    });
  };

  // ─ ローディング・認証
  if (checking) return (
    <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
  );
  if (!verified) return null;

  // ── 現在選択中の受講者・認定者
  const selectedStudent   = students.find(s => s.id === selStudentId);
  const selectedCertifier = certifiers.find(c => c.id === selCertifierId);

  // ─────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigateHome(router)} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>タイピング検定</Text>
      </View>

      {/* タブ */}
      <View style={styles.tabBar}>
        {TYPING_TABS.map(t => (
          <TouchableOpacity key={t} style={[styles.tabBtn, tab === t && styles.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'create' ? '認定書作成' : t === 'students' ? '受講者' : '履歴'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <SwipeTabPager
        tabs={TYPING_TABS}
        active={tab}
        onChange={setTab}
        renderTab={(pageTab) => (
          <>
      {/* ══════════ 認定書作成タブ ══════════ */}
      {pageTab === 'create' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

          {/* 基本情報 */}
          <View style={styles.card}>
            <SectionHeader title="基本情報" />
            {/* 氏名 */}
            <Text style={styles.fieldLabel}>氏名</Text>
            <TouchableOpacity style={styles.selector} onPress={() => {
              setCreateFilterDay(getTodayDayOfWeek());
              setPickerTarget('student');
            }}>
              <Text style={selectedStudent ? styles.selectorText : styles.selectorPlaceholder}>
                {selectedStudent ? selectedStudent.name : '-- 選択 --'}
              </Text>
              <Ionicons name="chevron-down" size={18} color="#888" />
            </TouchableOpacity>
            {selectedStudent && (
              <View style={{ marginBottom: 8 }}>
                <StarBadge star={selectedStudent.star} grade={selectedStudent.grade} />
              </View>
            )}
            {/* 認定者 */}
            <Text style={styles.fieldLabel}>認定者</Text>
            <TouchableOpacity style={styles.selector} onPress={() => setPickerTarget('certifier')}>
              <Text style={selectedCertifier ? styles.selectorText : styles.selectorPlaceholder}>
                {selectedCertifier ? selectedCertifier.name : '-- 選択 --'}
              </Text>
              <Ionicons name="chevron-down" size={18} color="#888" />
            </TouchableOpacity>
            {/* 日付 */}
            <Text style={styles.fieldLabel}>日付</Text>
            <TextInput
              style={styles.input}
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#bbb"
            />
          </View>

          {/* 実施級 */}
          <View style={styles.card}>
            <SectionHeader title="実施級" />
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>星の色</Text>
                <TouchableOpacity style={styles.selector} onPress={() => setPickerTarget('star')}>
                  <Text style={[styles.selectorText, { color: STAR_COLOR[star] }]}>{STAR_LABEL[star]}</Text>
                  <Ionicons name="chevron-down" size={18} color="#888" />
                </TouchableOpacity>
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>級</Text>
                <TouchableOpacity style={styles.selector} onPress={() => setPickerTarget('grade')}>
                  <Text style={styles.selectorText}>{grade}級</Text>
                  <Ionicons name="chevron-down" size={18} color="#888" />
                </TouchableOpacity>
              </View>
            </View>
            <StarBadge star={star} grade={grade} />

            {/* 得点 */}
            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>得点</Text>
            <View style={styles.autoScoreBox}>
              <Text style={score ? styles.autoScoreValue : styles.autoScorePlaceholder}>
                {score ? `${score}点` : 'ミス数を入力すると自動計算されます'}
              </Text>
            </View>
          </View>

          {/* WPM計算 */}
          <View style={styles.card}>
            <View style={styles.stageSectionHeader}>
              <Text style={[styles.sectionHeader, { marginBottom: 0 }]}>WPM計算</Text>
              <TouchableOpacity
                style={[styles.clearAllStagesButton, !hasStageData && styles.clearAllStagesButtonDisabled]}
                onPress={() => setClearStagesVisible(true)}
                disabled={!hasStageData}
                activeOpacity={0.72}
              >
                <Ionicons name="trash-outline" size={15} color={hasStageData ? '#C24D61' : '#AEB5B8'} />
                <Text style={[styles.clearAllStagesText, !hasStageData && styles.clearAllStagesTextDisabled]}>すべてクリア</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.stageGuide}>各ステージを押して、はやさとミス数を順番に入力</Text>
            <View style={styles.stageGrid}>
              {stageVals.map((v, i) => (
                <View key={i} style={styles.stageCell}>
                  <Text style={styles.stageLabel}>ステージ{i + 1}</Text>
                  <View style={styles.stageInput}>
                    <TouchableOpacity
                      style={styles.stageValueButton}
                      onPress={() => openStageInput(i, 'value')}
                      activeOpacity={0.72}
                      accessibilityLabel={`ステージ${i + 1}のはやさを編集`}
                    >
                      <Text style={styles.stageInputCaption}>はやさ</Text>
                      <Text style={v ? styles.stageInputValue : styles.stageInputPlaceholder}>{v || '入力'}</Text>
                    </TouchableOpacity>
                    <View style={styles.stageInputDivider} />
                    <TouchableOpacity
                      style={styles.stageMissButton}
                      onPress={() => openStageInput(i, 'misses')}
                      activeOpacity={0.72}
                      accessibilityLabel={`ステージ${i + 1}のミス数を編集`}
                    >
                      <Text style={styles.stageMissCaption}>ミス数</Text>
                      <Text style={stageMisses[i] !== '' ? styles.stageMissValue : styles.stageMissPlaceholder}>
                        {stageMisses[i] !== '' ? stageMisses[i] : '—'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.wpmResult}>
              {wpmResult
                ? <Text style={styles.wpmResultText}>平均 {wpmResult.avg.toFixed(3)} 秒/打 → <Text style={{ fontSize: 18, fontWeight: 'bold' }}>WPM: {wpmResult.wpm}</Text></Text>
                : <Text style={styles.wpmResultText}>WPM: —</Text>
              }
            </View>
          </View>

          {/* 判定 */}
          <View style={styles.card}>
            <SectionHeader title="判定" />
            <View style={styles.row}>
              {(['pass', 'fail'] as Result[]).map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.resultBtn, result === r && (r === 'pass' ? styles.resultBtnPass : styles.resultBtnFail)]}
                  onPress={() => setResult(r)}
                >
                  <Text style={[styles.resultBtnText, result === r && { color: r === 'pass' ? '#fff' : '#fff' }]}>
                    {r === 'pass' ? '合格' : '不合格'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ボタン行 */}
          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={handleSave} disabled={saving}>
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.saveBtnText}>記録のみ</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity style={[styles.printBtn, { flex: 1 }]} onPress={handlePrint} disabled={saving}>
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.saveBtnText}>PDF印刷して記録</Text>
              }
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* ══════════ 受講者タブ ══════════ */}
      {pageTab === 'students' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

          {/* 受講者追加 */}
          <View style={styles.card}>
            <SectionHeader title="受講者を追加" />
            <TextInput
              style={styles.input}
              value={newStudentName}
              onChangeText={setNewStudentName}
              placeholder="氏名（漢字）"
              placeholderTextColor="#bbb"
              returnKeyType="next"
            />
            <TextInput
              style={styles.input}
              value={newStudentKana}
              onChangeText={setNewStudentKana}
              placeholder="よみがな"
              placeholderTextColor="#bbb"
              returnKeyType="done"
            />
            <Text style={styles.fieldLabel}>登録曜日（複数選択可）</Text>
            <View style={styles.dayRow}>
              {['月','火','水','木','金'].map(d => (
                <TouchableOpacity
                  key={d}
                  style={[styles.dayBtn, newStudentDays.includes(d) && styles.dayBtnActive]}
                  onPress={() => setNewStudentDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])}
                >
                  <Text style={[styles.dayBtnText, newStudentDays.includes(d) && styles.dayBtnTextActive]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>星の色</Text>
                <TouchableOpacity style={styles.selector} onPress={() => setPickerTarget('newStar')}>
                  <Text style={[styles.selectorText, { color: STAR_COLOR[newStudentStar] }]}>{STAR_LABEL[newStudentStar]}</Text>
                  <Ionicons name="chevron-down" size={18} color="#888" />
                </TouchableOpacity>
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>級</Text>
                <TouchableOpacity style={styles.selector} onPress={() => setPickerTarget('newGrade')}>
                  <Text style={styles.selectorText}>{newStudentGrade}級</Text>
                  <Ionicons name="chevron-down" size={18} color="#888" />
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity style={styles.addBtn} onPress={handleAddStudent}>
              <Text style={styles.addBtnText}>＋ 追加</Text>
            </TouchableOpacity>
          </View>

          {/* 受講者一覧 */}
          <View style={styles.card}>
            <SectionHeader title="受講者一覧" />
            <View style={styles.dayRow}>
              <TouchableOpacity style={[styles.dayBtn, filterDay === '' && styles.dayBtnActive]} onPress={() => setFilterDay('')}>
                <Text style={[styles.dayBtnText, filterDay === '' && styles.dayBtnTextActive]}>全</Text>
              </TouchableOpacity>
              {['月','火','水','木','金'].map(d => (
                <TouchableOpacity key={d} style={[styles.dayBtn, filterDay === d && styles.dayBtnActive]} onPress={() => setFilterDay(d)}>
                  <Text style={[styles.dayBtnText, filterDay === d && styles.dayBtnTextActive]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {loading && <ActivityIndicator color={COLORS.primary} />}
            {!loading && students.length === 0 && <Text style={styles.emptyText}>受講者がいません</Text>}
            {students.filter(s => filterDay === '' || (s.days || []).includes(filterDay)).map(s => (
              <View key={s.id} style={styles.studentRow}>
                <View style={{ flex: 1 }}>
                  {s.kana ? <Text style={styles.studentKana}>{s.kana}</Text> : null}
                  <Text style={styles.studentName}>{s.name}</Text>
                  <StarBadge star={s.star} grade={s.grade} />
                  {(s.days || []).length > 0 && (
                    <Text style={{ fontSize: 10, color: '#7eb8d8', marginTop: 2 }}>{(s.days || []).join('・')}曜日</Text>
                  )}
                  <Text style={styles.studentDate}>{s.updatedAt}</Text>
                </View>
                <View style={styles.studentActions}>
                  {/* 星変更: 横一列 */}
                  <View style={styles.starRow}>
                    {(['kuro', 'aka', 'ki'] as Star[]).map(st => (
                      <TouchableOpacity
                        key={st}
                        style={[styles.starMiniBtn, s.star === st && { backgroundColor: STAR_COLOR[st] + '33', borderColor: STAR_COLOR[st] }]}
                        onPress={() => handleUpdateStudent(s.id, { star: st })}
                      >
                        <Text style={{ fontSize: 10, color: STAR_COLOR[st], fontWeight: 'bold' }}>{STAR_LABEL[st]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {/* 級変更 */}
                  <View style={styles.gradeMiniRow}>
                    <TouchableOpacity onPress={() => handleUpdateStudent(s.id, { grade: Math.max(1, s.grade - 1) })} style={styles.gradeArrow}>
                      <Text style={styles.gradeArrowText}>▲</Text>
                    </TouchableOpacity>
                    <Text style={styles.gradeMiniText}>{s.grade}級</Text>
                    <TouchableOpacity onPress={() => handleUpdateStudent(s.id, { grade: Math.min(11, s.grade + 1) })} style={styles.gradeArrow}>
                      <Text style={styles.gradeArrowText}>▼</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => handleDeleteStudent(s.id, s.name)} style={styles.deleteBtn}>
                    <Ionicons name="trash-outline" size={18} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>

          {/* 認定者管理 */}
          <View style={styles.card}>
            <SectionHeader title="認定者候補" />
            <View style={[styles.row, { alignItems: 'center' }]}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={newCertifierName}
                onChangeText={setNewCertifierName}
                placeholder="認定者名"
                placeholderTextColor="#bbb"
                returnKeyType="done"
                onSubmitEditing={handleAddCertifier}
              />
              <TouchableOpacity style={[styles.addBtn, { marginBottom: 0, marginLeft: 8, paddingVertical: 10 }]} onPress={handleAddCertifier}>
                <Text style={styles.addBtnText}>＋</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.chipRow}>
              {certifiers.map(c => (
                <View key={c.id} style={styles.chip}>
                  <Text style={styles.chipText}>{c.name}</Text>
                  <TouchableOpacity onPress={() => handleDeleteCertifier(c.id, c.name)}>
                    <Ionicons name="close-circle" size={16} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}

      {/* ══════════ 履歴タブ ══════════ */}
      {pageTab === 'history' && (() => {
        // 曜日フィルター
        const filteredCerts = certs.filter(c => {
          if (!historyFilterDay) return true;
          const s = students.find(st => st.name === c.studentName);
          return (s?.days || []).includes(historyFilterDay);
        });
        // 日付でグループ化（新しい順）
        const grouped: { date: string; items: Cert[] }[] = [];
        filteredCerts.forEach(c => {
          const existing = grouped.find(g => g.date === c.date);
          if (existing) existing.items.push(c);
          else grouped.push({ date: c.date, items: [c] });
        });
        grouped.sort((a, b) => b.date.localeCompare(a.date));
        return (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {/* 曜日フィルター */}
            <View style={[styles.dayRow, { marginBottom: 8 }]}>
              <TouchableOpacity style={[styles.dayBtn, historyFilterDay === '' && styles.dayBtnActive]} onPress={() => setHistoryFilterDay('')}>
                <Text style={[styles.dayBtnText, historyFilterDay === '' && styles.dayBtnTextActive]}>全</Text>
              </TouchableOpacity>
              {['月','火','水','木','金'].map(d => (
                <TouchableOpacity key={d} style={[styles.dayBtn, historyFilterDay === d && styles.dayBtnActive]} onPress={() => setHistoryFilterDay(d)}>
                  <Text style={[styles.dayBtnText, historyFilterDay === d && styles.dayBtnTextActive]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {grouped.length === 0 && <Text style={[styles.emptyText, { textAlign: 'center', marginTop: 40 }]}>まだ記録がありません</Text>}
            {grouped.map(group => (
              <View key={group.date}>
                {/* 日付ヘッダー */}
                <View style={styles.historyDateHeader}>
                  <Text style={styles.historyDateHeaderText}>{formatDate(group.date)}</Text>
                </View>
                {group.items.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.card, styles.historyCard]}
                    onPress={() => setEditCert({ ...item })}
                    activeOpacity={0.75}
                  >
                    <View style={styles.historyTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyName}>{item.studentName}</Text>
                      </View>
                      <View style={styles.historyTopActions}>
                        <View style={[styles.resultPill, { backgroundColor: item.result === 'pass' ? '#dbeafe' : '#fee2e2' }]}>
                          <Text style={{ fontWeight: 'bold', color: item.result === 'pass' ? '#1d4ed8' : '#b91c1c', fontSize: 13 }}>
                            {item.result === 'pass' ? '合格' : '不合格'}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.historyPrintIconBtn}
                          onPress={event => {
                            event.stopPropagation();
                            printHistoryCert(item);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`${item.studentName}の認定書を印刷`}
                        >
                          <Ionicons name="print-outline" size={19} color="#2e7fc1" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    <View style={styles.historyRow}>
                      <StarBadge star={item.star} grade={item.grade} />
                      <Text style={styles.historyMeta}>得点: {item.score}点</Text>
                      <Text style={styles.historyMeta}>WPM: {item.wpm}</Text>
                    </View>
                    {item.certifierName ? <Text style={styles.historyCertifier}>認定者: {item.certifierName}</Text> : null}
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>
        );
      })()}
          </>
        )}
      />



      {/* ══════════ 履歴編集モーダル ══════════ */}
      {editCert !== null && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setEditCert(null)}>
          <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'flex-end' }}>
            <View style={{ backgroundColor:'#fff', borderTopLeftRadius:20, borderTopRightRadius:20, padding:20, maxHeight:'85%' }}>
              <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <Text style={{ fontSize:17, fontWeight:'bold', color:'#1e3a5f' }}>履歴を編集</Text>
                <TouchableOpacity onPress={() => setEditCert(null)}>
                  <Ionicons name="close" size={24} color="#888" />
                </TouchableOpacity>
              </View>
              <ScrollView>
                <Text style={styles.fieldLabel}>得点</Text>
                <TextInput
                  style={styles.input}
                  value={String(editCert.score)}
                  onChangeText={v => setEditCert({ ...editCert, score: v })}
                  keyboardType="numeric"
                  placeholder="85"
                  placeholderTextColor="#bbb"
                />
                <Text style={styles.fieldLabel}>WPM</Text>
                <TextInput
                  style={styles.input}
                  value={String(editCert.wpm)}
                  onChangeText={v => setEditCert({ ...editCert, wpm: +v || 0 })}
                  keyboardType="numeric"
                  placeholder="60"
                  placeholderTextColor="#bbb"
                />
                <Text style={styles.fieldLabel}>星の色</Text>
                <View style={styles.starRow}>
                  {(['kuro','aka','ki'] as Star[]).map(st => (
                    <TouchableOpacity
                      key={st}
                      style={[styles.starMiniBtn, editCert.star === st && { backgroundColor: STAR_COLOR[st]+'33', borderColor: STAR_COLOR[st] }]}
                      onPress={() => setEditCert({ ...editCert, star: st })}
                    >
                      <Text style={{ fontSize: 12, color: STAR_COLOR[st], fontWeight:'bold' }}>{STAR_LABEL[st]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.fieldLabel}>級</Text>
                <View style={{ flexDirection:'row', flexWrap:'wrap', gap:6, marginBottom:8 }}>
                  {Array.from({length:11},(_,i)=>i+1).map(g => (
                    <TouchableOpacity
                      key={g}
                      style={[styles.dayBtn, editCert.grade === g && styles.dayBtnActive]}
                      onPress={() => setEditCert({ ...editCert, grade: g })}
                    >
                      <Text style={[styles.dayBtnText, editCert.grade === g && styles.dayBtnTextActive]}>{g}級</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.fieldLabel}>判定</Text>
                <View style={[styles.row, { marginBottom:12 }]}>
                  {(['pass','fail'] as Result[]).map(r => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.resultBtn, editCert.result === r && (r==='pass' ? styles.resultBtnPass : styles.resultBtnFail)]}
                      onPress={() => setEditCert({ ...editCert, result: r })}
                    >
                      <Text style={[styles.resultBtnText, editCert.result === r && { color: r==='pass'?'#fff':'#fff' }]}>
                        {r === 'pass' ? '合格' : '不合格'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  style={[styles.saveBtn, { marginTop:8 }]}
                  onPress={async () => {
                    if (!editCert) return;
                    await updateDoc(doc(db, 'typing_certs', editCert.id), {
                      score: editCert.score,
                      wpm: editCert.wpm,
                      star: editCert.star,
                      grade: editCert.grade,
                      result: editCert.result,
                    });
                    setEditCert(null);
                  }}
                >
                  <Text style={styles.saveBtnText}>保存</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.printBtn, { marginTop:8 }]}
                  onPress={() => {
                    if (!editCert) return;
                    const s = students.find(st => st.name === editCert.studentName);
                    const p = new URLSearchParams({
                      result: editCert.result,
                      name: editCert.studentName,
                      kana: s?.kana || '',
                      date: editCert.date,
                      star: editCert.star,
                      grade: String(editCert.grade),
                      score: String(editCert.score),
                      wpm: String(editCert.wpm),
                      certifier: editCert.certifierName,
                    });
                    openPrintPage({
                      result: editCert.result,
                      name: editCert.studentName,
                      kana: s?.kana || '',
                      date: editCert.date,
                      star: editCert.star,
                      grade: String(editCert.grade),
                      score: String(editCert.score),
                      wpm: String(editCert.wpm),
                      certifier: editCert.certifierName,
                    });
                  }}
                >
                  <Text style={styles.saveBtnText}>PDF印刷</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ marginTop:12, alignItems:'center' }}
                  onPress={() => confirm$('削除', `${editCert?.studentName} の記録を削除しますか？`, async () => {
                    if (!editCert) return;
                    await deleteDoc(doc(db, 'typing_certs', editCert.id));
                    setEditCert(null);
                  })}
                >
                  <Text style={{ color:'#ef4444', fontSize:14 }}>この記録を削除</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      <Modal visible={clearStagesVisible} transparent animationType="fade" onRequestClose={() => setClearStagesVisible(false)}>
        <TouchableOpacity style={styles.stageClearOverlay} activeOpacity={1} focusable={false} onPress={() => setClearStagesVisible(false)}>
          <TouchableOpacity style={styles.stageClearDialog} activeOpacity={1} focusable={false} onPress={event => event.stopPropagation()}>
            <Text style={styles.stageClearTitle}>ステージ入力をすべて消しますか？</Text>
            <Text style={styles.stageClearDescription}>8ステージ分のはやさとミス数がすべて消去されます。</Text>
            <View style={styles.stageClearActions}>
              <TouchableOpacity style={styles.stageClearCancel} onPress={() => setClearStagesVisible(false)} activeOpacity={0.75}>
                <Text style={styles.stageClearCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.stageClearConfirm} onPress={clearAllStages} activeOpacity={0.75}>
                <Text style={styles.stageClearConfirmText}>すべてクリア</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={activeStageInput !== null}
        transparent
        animationType="slide"
        onRequestClose={() => { setActiveStageInput(null); setStageInputMode('value'); }}
      >
        <TouchableOpacity style={styles.numberPadBackdrop} activeOpacity={1} focusable={false} onPress={() => { setActiveStageInput(null); setStageInputMode('value'); }}>
          <TouchableOpacity style={styles.numberPadSheet} activeOpacity={1} focusable={false} onPress={event => event.stopPropagation()}>
            <View style={styles.numberPadHeader}>
              <View style={styles.numberPadHeading}>
                <Text style={styles.numberPadStageLabel}>
                  {activeStageInput === null ? '' : `ステージ${activeStageInput + 1}`}
                </Text>
                <Text style={[styles.numberPadInputTitle, stageInputMode === 'value' ? styles.numberPadInputTitleSpeed : styles.numberPadInputTitleMiss]}>
                  {stageInputMode === 'value' ? 'はやさを入力' : 'ミス数を入力'}
                </Text>
                <View style={styles.numberPadValueRow}>
                  <Text style={styles.numberPadValueLabel}>入力値</Text>
                  <Text style={styles.numberPadValue}>
                    {activeStageInput === null
                      ? '0'
                      : (stageInputMode === 'value' ? stageVals[activeStageInput] : stageMisses[activeStageInput]) || '0'}
                  </Text>
                </View>
              </View>
              <View style={styles.numberPadHeaderActions}>
                <TouchableOpacity style={styles.numberPadClear} onPress={() => pressCustomNumberKey('clear')} activeOpacity={0.72}>
                  <Text style={styles.numberPadClearText}>クリア</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.numberPadCloseIcon}
                  onPress={() => { setActiveStageInput(null); setStageInputMode('value'); }}
                  activeOpacity={0.72}
                  accessibilityLabel="数字入力を閉じる"
                >
                  <Ionicons name="close" size={29} color="#314A51" />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.numberPadGrid}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'backspace', '0', stageInputMode === 'value' ? '.' : 'empty'].map(key => (
                key === 'empty'
                  ? <View key={key} style={styles.numberPadKeyPlaceholder} />
                  : (
                    <TouchableOpacity
                      key={key}
                      style={[styles.numberPadKey, key === '.' && styles.numberPadDecimalKey]}
                      onPress={() => pressCustomNumberKey(key)}
                      activeOpacity={0.68}
                      accessibilityLabel={key === 'backspace' ? '一文字削除' : key === '.' ? '小数点' : key}
                    >
                      {key === 'backspace'
                        ? <Ionicons name="backspace-outline" size={25} color="#355B66" />
                        : <Text style={styles.numberPadKeyText}>{key}</Text>}
                    </TouchableOpacity>
                  )
              ))}
            </View>
            <View style={styles.numberPadActionRow}>
              <TouchableOpacity
                style={styles.numberPadClose}
                onPress={() => { setActiveStageInput(null); setStageInputMode('value'); }}
                activeOpacity={0.78}
              >
                <Text style={styles.numberPadCloseText}>閉じる</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.numberPadDone, styles.numberPadNext]} onPress={advanceStageInput} activeOpacity={0.78}>
                <Text style={styles.numberPadDoneText}>次へ</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ══════════ ピッカーモーダル ══════════ */}
      <Modal visible={pickerTarget !== null} transparent animationType="fade" onRequestClose={() => setPickerTarget(null)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} focusable={false} onPress={() => setPickerTarget(null)}>
          <View style={styles.pickerBox}>
            <Text style={styles.pickerTitle}>
              {pickerTarget === 'student' ? '氏名を選択'
               : pickerTarget === 'certifier' ? '認定者を選択'
               : pickerTarget === 'star' || pickerTarget === 'newStar' ? '星の色を選択'
               : pickerTarget === 'grade' || pickerTarget === 'newGrade' ? '級を選択'
               : '選択してください'}
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {/* 受講者 - 曜日フィルター付き */}
              {pickerTarget === 'student' && (
                <>
                  <View style={[styles.dayRow, { paddingHorizontal: 8, paddingBottom: 8 }]}>
                    <TouchableOpacity style={[styles.dayBtn, createFilterDay === '' && styles.dayBtnActive]} onPress={() => setCreateFilterDay('')}>
                      <Text style={[styles.dayBtnText, createFilterDay === '' && styles.dayBtnTextActive]}>全</Text>
                    </TouchableOpacity>
                    {['月','火','水','木','金'].map(d => (
                      <TouchableOpacity key={d} style={[styles.dayBtn, createFilterDay === d && styles.dayBtnActive]} onPress={() => setCreateFilterDay(d)}>
                        <Text style={[styles.dayBtnText, createFilterDay === d && styles.dayBtnTextActive]}>{d}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {students
                    .filter(s => createFilterDay === '' || (s.days || []).includes(createFilterDay))
                    .map(s => (
                      <TouchableOpacity key={s.id} style={styles.pickerItem} onPress={() => handleSelectStudent(s.id)}>
                        <View>
                          {s.kana ? <Text style={{ fontSize: 10, color: '#94a3b8' }}>{s.kana}</Text> : null}
                          <Text style={styles.pickerItemText}>{s.name}</Text>
                        </View>
                        <StarBadge star={s.star} grade={s.grade} />
                      </TouchableOpacity>
                    ))
                  }
                </>
              )}
              {/* 認定者 */}
              {pickerTarget === 'certifier' && certifiers.map(c => (
                <TouchableOpacity key={c.id} style={styles.pickerItem} onPress={() => { setSelCertifierId(c.id); setPickerTarget(null); }}>
                  <Text style={styles.pickerItemText}>{c.name}</Text>
                </TouchableOpacity>
              ))}
              {/* 星 */}
              {(pickerTarget === 'star' || pickerTarget === 'newStar') && (['kuro', 'aka', 'ki'] as Star[]).map(st => (
                <TouchableOpacity key={st} style={styles.pickerItem} onPress={() => {
                  if (pickerTarget === 'star') setStar(st); else setNewStudentStar(st);
                  setPickerTarget(null);
                }}>
                  <Text style={[styles.pickerItemText, { color: STAR_COLOR[st] }]}>{STAR_LABEL[st]}</Text>
                </TouchableOpacity>
              ))}
              {/* 級 */}
              {(pickerTarget === 'grade' || pickerTarget === 'newGrade') && GRADES.map(g => (
                <TouchableOpacity key={g} style={styles.pickerItem} onPress={() => {
                  if (pickerTarget === 'grade') setGrade(g); else setNewStudentGrade(g);
                  setPickerTarget(null);
                }}>
                  <Text style={styles.pickerItemText}>{g}級</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

    </SafeAreaView>
  );
}

// ─── スタイル ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f7ff' },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: '#FFF8F0', flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 14, borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
  },
  backBtn:     { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  tabBar:      { flexDirection: 'row', backgroundColor: '#b8d8f0' },
  tabBtn:      { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabBtnActive:{ borderBottomColor: '#2e7fc1', backgroundColor: '#d6eaf8' },
  tabLabel:    { fontSize: 12, color: '#2e7fc1', fontWeight: 'bold' },
  tabLabelActive: { color: '#1a5a8a' },
  scroll:      { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 6, elevation: 2,
  },
  sectionHeader: { fontSize: 11, color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  fieldLabel:  { fontSize: 12, color: '#475569', fontWeight: 'bold', marginBottom: 4, marginTop: 6 },
  input: {
    borderWidth: 1.5, borderColor: '#bfdbfe', borderRadius: 8, padding: 9,
    fontSize: 15, color: '#1e3a5f', marginBottom: 8, backgroundColor: '#fff',
  },
  selector: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#bfdbfe', borderRadius: 8, padding: 9,
    backgroundColor: '#fff', marginBottom: 8,
  },
  selectorText:       { fontSize: 15, color: '#1e3a5f' },
  selectorPlaceholder:{ fontSize: 15, color: '#bbb' },
  row:  { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  badge: {
    alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 3, marginBottom: 6,
  },
  badgeText: { fontSize: 13, fontWeight: 'bold' },
  stageSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  clearAllStagesButton: {
    minHeight: 34, paddingHorizontal: 10, borderRadius: 9, flexDirection: 'row', gap: 4,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF0F3', borderWidth: 1, borderColor: '#F4C3CC',
  },
  clearAllStagesButtonDisabled: { backgroundColor: '#F3F4F4', borderColor: '#E3E6E7' },
  clearAllStagesText: { fontSize: 11, fontWeight: '900', color: '#B64156' },
  clearAllStagesTextDisabled: { color: '#AEB5B8' },
  stageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },
  stageCell: { alignItems: 'center', width: 66 },
  stageGuide: { marginBottom: 6, fontSize: 12, color: '#64748B', fontWeight: '700' },
  stageInput: {
    borderWidth: 1.5, borderColor: '#bfdbfe', borderRadius: 8,
    width: 66, minHeight: 64, overflow: 'hidden', backgroundColor: '#fff',
  },
  stageValueButton: { minHeight: 40, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5FBFC' },
  stageMissButton: {
    minHeight: 25, paddingHorizontal: 5, flexDirection: 'row', gap: 4,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF3F6',
  },
  stageInputDivider: { height: 1, backgroundColor: '#DCE9F2' },
  stageInputCaption: { fontSize: 9, fontWeight: '900', color: '#168293' },
  stageInputValue: { fontSize: 13, fontWeight: '800', color: '#1E3A5F' },
  stageInputPlaceholder: { fontSize: 12, color: '#BBBBBB' },
  stageMissCaption: { fontSize: 8, fontWeight: '900', color: '#C3465E' },
  stageMissValue: { fontSize: 10, fontWeight: '900', color: '#B92F4A' },
  stageMissPlaceholder: { fontSize: 10, fontWeight: '800', color: '#9AA5AA' },
  stageLabel:  { marginBottom: 3, fontSize: 10, fontWeight: '900', color: '#304B55' },
  autoScoreBox: {
    width: 160, minHeight: 48, paddingHorizontal: 12, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF7F8', borderWidth: 1.5, borderColor: '#B6DDE0',
  },
  autoScoreValue: { fontSize: 22, fontWeight: '900', color: '#203F48' },
  autoScorePlaceholder: { fontSize: 11, fontWeight: '700', color: '#7B8D92', textAlign: 'center' },
  stageClearOverlay: { flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(24,35,40,0.42)' },
  stageClearDialog: { width: '100%', maxWidth: 390, padding: 20, borderRadius: 18, backgroundColor: '#FFFDF9' },
  stageClearTitle: { fontSize: 18, fontWeight: '900', color: '#283F46', textAlign: 'center' },
  stageClearDescription: { marginTop: 8, fontSize: 12, fontWeight: '700', color: '#748287', textAlign: 'center', lineHeight: 18 },
  stageClearActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  stageClearCancel: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECEEEF' },
  stageClearCancelText: { fontSize: 14, fontWeight: '900', color: '#525B5E' },
  stageClearConfirm: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E95E74' },
  stageClearConfirmText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  numberPadBackdrop: { flex: 1, backgroundColor: 'rgba(24,35,40,0.38)', justifyContent: 'flex-end' },
  numberPadSheet: {
    width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: '#FFFDF9',
    borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 15, paddingBottom: 22,
    shadowColor: '#243A40', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 12,
  },
  numberPadHeader: { minHeight: 92, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 7, marginBottom: 10 },
  numberPadHeading: { flex: 1, alignItems: 'flex-start' },
  numberPadStageLabel: { fontSize: 12, fontWeight: '900', color: '#526B73', marginBottom: 3 },
  numberPadInputTitle: { fontSize: 19, fontWeight: '900', letterSpacing: 0, marginBottom: 5 },
  numberPadInputTitleSpeed: { color: '#087F91' },
  numberPadInputTitleMiss: { color: '#C33F59' },
  numberPadValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  numberPadValueLabel: { fontSize: 10, fontWeight: '900', color: '#7A8D93' },
  numberPadValue: { fontSize: 27, fontWeight: '900', color: '#223C44' },
  numberPadHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numberPadClear: { minHeight: 38, borderRadius: 10, backgroundColor: '#F4ECE8', paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  numberPadClearText: { fontSize: 13, fontWeight: '900', color: '#8A554D' },
  numberPadCloseIcon: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#EAF3F4', borderWidth: 1, borderColor: '#C6DDE0',
  },
  numberPadGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  numberPadKey: {
    width: '31.7%', height: 54, borderRadius: 13, backgroundColor: '#EFF7F8', borderWidth: 1, borderColor: '#C8E0E3',
    alignItems: 'center', justifyContent: 'center',
  },
  numberPadKeyPlaceholder: { width: '31.7%', height: 54 },
  numberPadDecimalKey: { backgroundColor: '#E2F3F5', borderColor: '#A9D7DB' },
  numberPadKeyText: { fontSize: 23, fontWeight: '900', color: '#284952' },
  numberPadDone: { height: 50, borderRadius: 13, backgroundColor: '#00AEB8', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  numberPadDoneText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  numberPadActionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  numberPadClose: { flex: 1, height: 50, borderRadius: 13, backgroundColor: '#ECEEEF', alignItems: 'center', justifyContent: 'center' },
  numberPadCloseText: { color: '#535B5E', fontSize: 15, fontWeight: '900' },
  numberPadNext: { flex: 1, marginTop: 0 },
  wpmResult:   { backgroundColor: '#eff6ff', borderRadius: 8, padding: 10, marginTop: 8 },
  wpmResultText: { fontSize: 14, color: '#1d4ed8', fontWeight: '600' },
  resultBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 2,
    borderColor: '#bfdbfe', alignItems: 'center', backgroundColor: '#f0f9ff', marginHorizontal: 4,
  },
  resultBtnPass: { backgroundColor: '#4caf82', borderColor: '#2e8b57' },
  resultBtnFail: { backgroundColor: '#e05c5c', borderColor: '#c0392b' },
  resultBtnText: { fontSize: 15, fontWeight: 'bold', color: '#4a7a9b' },
  saveBtn: {
    backgroundColor: '#7eb8d8', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 4,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  printBtn: {
    backgroundColor: '#5aabcc', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center',
  },
  addBtn: {
    backgroundColor: '#7eb8d8', borderRadius: 8, paddingVertical: 9,
    paddingHorizontal: 20, alignSelf: 'flex-start', marginTop: 8, marginBottom: 4,
  },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  studentRow: {
    flexDirection: 'row', paddingVertical: 10,
    borderBottomWidth: 1, borderColor: '#f0f0f0', alignItems: 'flex-start',
  },
  studentName: { fontSize: 15, fontWeight: 'bold', color: '#1e3a5f', marginBottom: 4 },
  studentDate: { fontSize: 10, color: '#94a3b8', marginTop: 4 },
  studentActions: { alignItems: 'flex-end', gap: 6 },
  starRow: { flexDirection: 'row', gap: 4 },
  studentKana: { fontSize: 10, color: '#94a3b8', marginBottom: 1 },
  starMiniBtn: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3, marginBottom: 2,
  },
  gradeMiniRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  gradeArrow:  { padding: 3 },
  gradeArrowText: { fontSize: 11, color: '#475569', fontWeight: 'bold' },
  gradeMiniText: { fontSize: 13, fontWeight: 'bold', color: '#1e3a5f', minWidth: 28, textAlign: 'center' },
  deleteBtn:   { padding: 4, marginTop: 4 },
  chipRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe',
    borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4,
  },
  chipText:    { fontSize: 13, color: '#1e3a5f' },
  emptyText:   { color: '#94a3b8', fontSize: 14, paddingVertical: 12 },
  dayRow: { flexDirection: 'row', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  dayBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1.5, borderColor: '#bfdbfe', backgroundColor: '#f0f9ff',
  },
  dayBtnActive: { backgroundColor: '#7eb8d8', borderColor: '#5aabcc' },
  dayBtnText: { fontSize: 12, fontWeight: 'bold', color: '#4a7a9b' },
  dayBtnTextActive: { color: '#fff' },
  historyCard: { marginBottom: 8 },
  historyDateHeader: { paddingVertical: 6, paddingHorizontal: 4, marginBottom: 4, marginTop: 8, borderLeftWidth: 3, borderLeftColor: '#7eb8d8', paddingLeft: 10 },
  historyDateHeaderText: { fontSize: 13, fontWeight: 'bold', color: '#2e7fc1' },
  historyTop:  { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  historyTopActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  historyName: { fontSize: 16, fontWeight: 'bold', color: '#1e3a5f' },
  historyDate: { fontSize: 12, color: '#94a3b8' },
  resultPill:  { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  historyRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  historyMeta: { fontSize: 13, color: '#475569' },
  historyCertifier: { fontSize: 12, color: '#94a3b8' },
  historyPrintBtn: {
    flexDirection: 'row' as const, alignItems: 'center', gap: 4,
    alignSelf: 'flex-end', marginTop: 6,
    backgroundColor: '#e8f4fb', borderWidth: 1, borderColor: '#a8d4ee',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  historyPrintBtnText: { fontSize: 12, color: '#2e7fc1', fontWeight: 'bold' },
  historyPrintIconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#e8f4fb', borderWidth: 1, borderColor: '#a8d4ee' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  pickerBox: {
    backgroundColor: '#fff', borderRadius: 16, padding: 8,
    width: 280, maxHeight: 400, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 10,
  },
  pickerTitle: { fontSize: 14, fontWeight: 'bold', color: '#1e3a5f', textAlign: 'center', paddingVertical: 12 },
  pickerItem:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderColor: '#f0f0f0' },
  pickerItemText: { fontSize: 16, color: '#1e3a5f' },





});
