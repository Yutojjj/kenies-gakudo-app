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
  ActivityIndicator,
  Alert,
  FlatList,
  Modal, Platform, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { useRequireRole } from '../hooks/useRequireRole';

// ─── 型 ────────────────────────────────────────────────────────────────
type Star = 'kuro' | 'aka' | 'ki';
type Result = 'pass' | 'fail';

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
  createdAt: any;
}

// ─── 定数 ───────────────────────────────────────────────────────────────
const GRADES = Array.from({ length: 11 }, (_, i) => i + 1);
const STAR_LABEL: Record<Star, string> = { kuro: '黒★', aka: '赤★', ki: '黄★' };
const STAR_COLOR: Record<Star, string> = { kuro: '#212121', aka: '#C62828', ki: '#F9A825' };
const MAX_STAGES = 10;

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
  const [tab, setTab] = useState<'create' | 'students' | 'history'>('create');

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
  const [stageCount, setStageCount] = useState(8);
  const [stageVals, setStageVals]   = useState<string[]>(Array(8).fill(''));
  const [result, setResult]         = useState<Result>('pass');
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

  // ── 認定者管理
  const [newCertifierName, setNewCertifierName] = useState('');

  // ── ピッカーモーダル（ドロップダウン代替）
  type PickerTarget = 'student' | 'certifier' | 'star' | 'grade' | 'stageCount' | 'newStar' | 'newGrade' | null;
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);

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

  // ── ステージ数変更
  const handleStageCount = (n: number) => {
    setStageCount(n);
    setStageVals(prev => {
      const next = [...prev];
      while (next.length < n) next.push('');
      return next.slice(0, n);
    });
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

  // ── 認定書を保存し、受講者の級・星も更新する共通処理
  const saveCertAndUpdateStudent = async (
    student: Student,
    certifierName: string,
    certDate: string, certStar: Star, certGrade: number,
    certScore: string, certWpm: number, certResult: Result,
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
    if (!wpmResult) { alert$('エラー', 'WPMを計算するためステージ値を入力してください'); return; }
    setSaving(true);
    try {
      await saveCertAndUpdateStudent(
        student, certifier?.name || '', date, star, grade, score, wpmResult.wpm, result,
      );
      alert$('保存完了', '認定書を記録しました');
      setSelStudentId(''); setSelCertifierId(''); setDate(todayStr());
      setScore(''); setStageVals(Array(stageCount).fill('')); setResult('pass');
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
    if (!wpmResult) { alert$('エラー', 'WPMを計算するためステージ値を入力してください'); return; }
    setSaving(true);
    try {
      await saveCertAndUpdateStudent(
        student, certifier?.name || '', date, star, grade, score, wpmResult.wpm, result,
      );
    } catch (e) {
      alert$('エラー', '保存に失敗しました');
      setSaving(false);
      return;
    }
    setSaving(false);
    const p = new URLSearchParams({
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
    setSelStudentId(''); setSelCertifierId(''); setDate(todayStr());
    setScore(''); setStageVals(Array(stageCount).fill('')); setResult('pass');
    // 同じタブでprint.htmlに遷移（ポップアップブロック回避）
    if (typeof window !== 'undefined') {
      window.location.href = '/cert/print.html?' + p.toString();
    }
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>タイピング検定</Text>
      </View>

      {/* タブ */}
      <View style={styles.tabBar}>
        {(['create', 'students', 'history'] as const).map(t => (
          <TouchableOpacity key={t} style={[styles.tabBtn, tab === t && styles.tabBtnActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'create' ? '認定書作成' : t === 'students' ? '受講者' : '履歴'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ══════════ 認定書作成タブ ══════════ */}
      {tab === 'create' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

          {/* 基本情報 */}
          <View style={styles.card}>
            <SectionHeader title="基本情報" />
            {/* 曜日フィルター */}
            <Text style={styles.fieldLabel}>曜日で絞り込み</Text>
            <View style={[styles.dayRow, { marginBottom: 8 }]}>
              <TouchableOpacity style={[styles.dayBtn, createFilterDay === '' && styles.dayBtnActive]} onPress={() => setCreateFilterDay('')}>
                <Text style={[styles.dayBtnText, createFilterDay === '' && styles.dayBtnTextActive]}>全</Text>
              </TouchableOpacity>
              {['月','火','水','木','金'].map(d => (
                <TouchableOpacity key={d} style={[styles.dayBtn, createFilterDay === d && styles.dayBtnActive]} onPress={() => setCreateFilterDay(d)}>
                  <Text style={[styles.dayBtnText, createFilterDay === d && styles.dayBtnTextActive]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* 氏名 */}
            <Text style={styles.fieldLabel}>氏名</Text>
            <TouchableOpacity style={styles.selector} onPress={() => setPickerTarget('student')}>
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
            <TextInput
              style={[styles.input, { width: 120 }]}
              value={score}
              onChangeText={setScore}
              keyboardType="numeric"
              placeholder="例: 85"
              placeholderTextColor="#bbb"
            />
          </View>

          {/* WPM計算 */}
          <View style={styles.card}>
            <SectionHeader title="WPM計算" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <Text style={styles.fieldLabel}>ステージ数</Text>
              <TouchableOpacity style={[styles.selector, { minWidth: 80, marginBottom: 0 }]} onPress={() => setPickerTarget('stageCount')}>
                <Text style={styles.selectorText}>{stageCount}</Text>
                <Ionicons name="chevron-down" size={18} color="#888" />
              </TouchableOpacity>
              <Text style={{ fontSize: 11, color: '#94a3b8' }}>各ステージの 秒/タイプ数 を入力</Text>
            </View>
            <View style={styles.stageGrid}>
              {stageVals.map((v, i) => (
                <View key={i} style={styles.stageCell}>
                  <TextInput
                    style={styles.stageInput}
                    value={v}
                    onChangeText={val => {
                      const next = [...stageVals];
                      next[i] = val;
                      setStageVals(next);
                    }}
                    keyboardType="decimal-pad"
                    placeholder="1.23"
                    placeholderTextColor="#bbb"
                  />
                  <Text style={styles.stageLabel}>ステージ{i + 1}</Text>
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
      {tab === 'students' && (
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
      {tab === 'history' && (
        <FlatList
          data={certs}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.scrollContent}
          ListEmptyComponent={<Text style={[styles.emptyText, { textAlign: 'center', marginTop: 40 }]}>まだ記録がありません</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.card, styles.historyCard]} onPress={() => setEditCert(item)} activeOpacity={0.85}>
              <View style={styles.historyTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyName}>{item.studentName}</Text>
                  <Text style={styles.historyDate}>{formatDate(item.date)}</Text>
                </View>
                <View style={[styles.resultPill, { backgroundColor: item.result === 'pass' ? '#dbeafe' : '#fee2e2' }]}>
                  <Text style={{ fontWeight: 'bold', color: item.result === 'pass' ? '#1d4ed8' : '#b91c1c', fontSize: 13 }}>
                    {item.result === 'pass' ? '✅ 合格' : '❌ 不合格'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => confirm$('削除', `${item.studentName} の記録を削除しますか？`, async () => {
                    await deleteDoc(doc(db, 'typing_certs', item.id));
                  })}
                  style={{ marginLeft: 8, padding: 4 }}
                >
                  <Ionicons name="trash-outline" size={18} color="#ef4444" />
                </TouchableOpacity>
              </View>
              <View style={styles.historyRow}>
                <StarBadge star={item.star} grade={item.grade} />
                <Text style={styles.historyMeta}>得点: {item.score}点</Text>
                <Text style={styles.historyMeta}>WPM: {item.wpm}</Text>
              </View>
              {item.certifierName ? <Text style={styles.historyCertifier}>認定者: {item.certifierName}</Text> : null}
              {/* 印刷ボタン */}
              <TouchableOpacity
                style={styles.historyPrintBtn}
                onPress={() => {
                  const s = students.find(st => st.name === item.studentName);
                  const p = new URLSearchParams({
                    result: item.result,
                    name: item.studentName,
                    kana: s?.kana || '',
                    date: item.date,
                    star: item.star,
                    grade: String(item.grade),
                    score: String(item.score),
                    wpm: String(item.wpm),
                    certifier: item.certifierName,
                  });
                  if (typeof window !== 'undefined') window.location.href = '/cert/print.html?' + p.toString();
                }}
              >
                <Text style={styles.historyPrintBtnText}>PDF印刷</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}



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
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* ══════════ ピッカーモーダル ══════════ */}
      <Modal visible={pickerTarget !== null} transparent animationType="fade" onRequestClose={() => setPickerTarget(null)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setPickerTarget(null)}>
          <View style={styles.pickerBox}>
            <Text style={styles.pickerTitle}>
              {pickerTarget === 'student' ? '氏名を選択'
               : pickerTarget === 'certifier' ? '認定者を選択'
               : pickerTarget === 'star' || pickerTarget === 'newStar' ? '星の色を選択'
               : pickerTarget === 'grade' || pickerTarget === 'newGrade' ? '級を選択'
               : 'ステージ数を選択'}
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {/* 受講者 */}
              {pickerTarget === 'student' && students
                .filter(s => createFilterDay === '' || (s.days || []).includes(createFilterDay))
                .map(s => (
                <TouchableOpacity key={s.id} style={styles.pickerItem} onPress={() => handleSelectStudent(s.id)}>
                  <View>
                    {s.kana ? <Text style={{ fontSize: 10, color: '#94a3b8' }}>{s.kana}</Text> : null}
                    <Text style={styles.pickerItemText}>{s.name}</Text>
                  </View>
                  <StarBadge star={s.star} grade={s.grade} />
                </TouchableOpacity>
              ))}
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
              {/* ステージ数 */}
              {pickerTarget === 'stageCount' && Array.from({ length: MAX_STAGES }, (_, i) => i + 1).map(n => (
                <TouchableOpacity key={n} style={styles.pickerItem} onPress={() => handleStageCount(n)}>
                  <Text style={styles.pickerItemText}>{n}</Text>
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
    backgroundColor: '#AEE4F5', flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 14, borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
  },
  backBtn:     { marginRight: 8, padding: 2 },
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
  stageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  stageCell: { alignItems: 'center', minWidth: 72 },
  stageInput: {
    borderWidth: 1.5, borderColor: '#bfdbfe', borderRadius: 7, padding: 8,
    fontSize: 14, textAlign: 'center', width: 72, backgroundColor: '#fff', color: '#1e3a5f',
  },
  stageLabel:  { fontSize: 10, color: '#94a3b8', marginTop: 2 },
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
  historyCard: { marginBottom: 10 },
  historyTop:  { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
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
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  pickerBox: {
    backgroundColor: '#fff', borderRadius: 16, padding: 8,
    width: 280, maxHeight: 400, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 10,
  },
  pickerTitle: { fontSize: 14, fontWeight: 'bold', color: '#1e3a5f', textAlign: 'center', paddingVertical: 12 },
  pickerItem:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderColor: '#f0f0f0' },
  pickerItemText: { fontSize: 16, color: '#1e3a5f' },





});