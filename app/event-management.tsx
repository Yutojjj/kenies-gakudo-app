import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, deleteDoc, doc, getDocs, onSnapshot, setDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import AdminBottomNav from '../components/AdminBottomNav';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { useRequireRole } from '../hooks/useRequireRole';

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

type EventData = { id: string; dateStr: string; title: string; description: string; externalParticipants: any[] };
type Participant = { id: string; childName: string; childSchool?: string; childGrade?: string; status: string };
type MemberInfo = { id: string; name: string; nicknameKana?: string; school?: string; grade?: string };

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// ── タブ型 ─────────────────────────────────────────────
type ParticipantTab = 'list' | 'add';
type AddSubTab = 'user' | 'external';

export default function EventManagementScreen() {
  const { verified, checking } = useRequireRole(['admin', 'staff']);
  const router = useRouter();
  useLocalSearchParams<{ role: string }>();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<Record<string, EventData>>({});
  const [participantsMap, setParticipantsMap] = useState<Record<string, Participant[]>>({});
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});

  // カレンダー選択日・イベント編集
  const [selectedDateStr, setSelectedDateStr] = useState('');
  const [calModalVisible, setCalModalVisible] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventDesc, setEventDesc] = useState('');

  // 参加者管理モーダル
  const [participantModalVisible, setParticipantModalVisible] = useState(false);
  const [participantTab, setParticipantTab] = useState<ParticipantTab>('list');
  const [addSubTab, setAddSubTab] = useState<AddSubTab>('user');

  // 利用者から追加 - フィルター
  const [allMembers, setAllMembers] = useState<MemberInfo[]>([]);
  const [allSchools, setAllSchools] = useState<string[]>([]);
  const [allGrades, setAllGrades] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [filterSchool, setFilterSchool] = useState('');
  const [filterGrade, setFilterGrade] = useState('');

  // 非利用者から追加
  const [extName, setExtName] = useState('');
  const [extSchool, setExtSchool] = useState('');
  const [extGrade, setExtGrade] = useState('');

  // ── データ取得 ────────────────────────────────────────
  useEffect(() => {
    fetch('https://holidays-jp.github.io/api/v1/date.json')
      .then(r => r.json()).then(setPublicHolidays).catch(() => {});

    // accounts → メンバー一覧
    getDocs(collection(db, 'accounts')).then(snap => {
      const members: MemberInfo[] = [];
      const schoolSet = new Set<string>();
      const gradeSet = new Set<string>();

      snap.forEach(d => {
        const data = d.data();
        const pushMember = (m: MemberInfo) => {
          members.push(m);
          if (m.school) schoolSet.add(m.school);
          if (m.grade) gradeSet.add(m.grade);
        };

        if (data.role === 'user' && data.name) {
          pushMember({ id: d.id, name: data.name, nicknameKana: data.nicknameKana, school: data.school, grade: data.grade });
          (data.siblings || []).forEach((s: any, i: number) => {
            if (s.name) pushMember({ id: `${d.id}_sib_${i}`, name: s.name, nicknameKana: s.nicknameKana, school: s.school, grade: s.grade });
          });
        } else if (data.role === 'staff' && data.hasChild) {
          (data.staffChildren || []).forEach((c: any, i: number) => {
            if (c.name) pushMember({ id: `${d.id}_child_${i}`, name: c.name, school: c.school, grade: c.grade });
          });
        }
      });

      members.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      setAllMembers(members);

      // 学年を数値順にソート
      const gradeOrder = ['小1','小2','小3','小4','小5','小6'];
      const sortedGrades = [...gradeSet].sort((a, b) => {
        const ai = gradeOrder.indexOf(a); const bi = gradeOrder.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b, 'ja');
        if (ai === -1) return 1; if (bi === -1) return -1;
        return ai - bi;
      });
      setAllSchools([...schoolSet].sort((a, b) => a.localeCompare(b, 'ja')));
      setAllGrades(sortedGrades);
    });

    const unsubEvents = onSnapshot(collection(db, 'events'), snap => {
      const eData: Record<string, EventData> = {};
      snap.forEach(d => { eData[d.id] = d.data() as EventData; });
      setEvents(eData);
    });

    const unsubParts = onSnapshot(collection(db, 'event_participants'), snap => {
      const pData: Record<string, Participant[]> = {};
      snap.forEach(d => {
        const item = d.data();
        if (!pData[item.eventId]) pData[item.eventId] = [];
        pData[item.eventId].push({
          id: d.id,
          childName: item.childName,
          childSchool: item.childSchool,
          childGrade: item.childGrade,
          status: item.status,
        });
      });
      setParticipantsMap(pData);
    });

    return () => { unsubEvents(); unsubParts(); };
  }, []);

  // ── カレンダー操作 ────────────────────────────────────
  const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDay = (y: number, m: number) => new Date(y, m, 1).getDay();
  const changeMonth = (offset: number) =>
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));

  const generateDays = () => {
    const y = currentDate.getFullYear(), m = currentDate.getMonth();
    const days: (null | { day: number; dateStr: string })[] = [];
    for (let i = 0; i < getFirstDay(y, m); i++) days.push(null);
    for (let i = 1; i <= getDaysInMonth(y, m); i++) {
      days.push({ day: i, dateStr: `${y}-${String(m+1).padStart(2,'0')}-${String(i).padStart(2,'0')}` });
    }
    return days;
  };

  const openCalModal = (dateStr: string) => {
    setSelectedDateStr(dateStr);
    const ev = events[dateStr];
    setEventTitle(ev?.title || '');
    setEventDesc(ev?.description || '');
    setCalModalVisible(true);
  };

  // イベント登録済みカードタップ → 参加者モーダル
  const openParticipantModal = (dateStr: string) => {
    setSelectedDateStr(dateStr);
    setParticipantTab('list');
    setAddSubTab('user');
    setMemberSearch(''); setFilterSchool(''); setFilterGrade('');
    setExtName(''); setExtSchool(''); setExtGrade('');
    setParticipantModalVisible(true);
  };

  // ── イベント CRUD ─────────────────────────────────────
  const saveEvent = async () => {
    if (!eventTitle) return customAlert('エラー', 'イベント名を入力してください');
    try {
      const ev = events[selectedDateStr] || { id: selectedDateStr, dateStr: selectedDateStr, externalParticipants: [] };
      await setDoc(doc(db, 'events', selectedDateStr), { ...ev, title: eventTitle, description: eventDesc }, { merge: true });
      customAlert('保存完了', 'イベント情報を保存しました');
      setCalModalVisible(false);
    } catch { customAlert('エラー', '保存に失敗しました'); }
  };

  const deleteEvent = () =>
    customConfirm('削除確認', 'このイベントを削除しますか？', async () => {
      await deleteDoc(doc(db, 'events', selectedDateStr));
      setCalModalVisible(false);
    });

  // ── 参加者操作 ────────────────────────────────────────
  const addMember = async (member: MemberInfo) => {
    try {
      await setDoc(doc(db, 'event_participants', `${selectedDateStr}_${member.id}`), {
        eventId: selectedDateStr,
        childId: member.id,
        childName: member.name,
        childSchool: member.school || '',
        childGrade: member.grade || '',
        status: '参加',
        updatedAt: new Date(),
      }, { merge: true });
    } catch { customAlert('エラー', '追加に失敗しました'); }
  };

  const addExternalParticipant = async () => {
    if (!extName) return customAlert('エラー', '氏名を入力してください');
    try {
      const ev = events[selectedDateStr] || { id: selectedDateStr, dateStr: selectedDateStr, title: eventTitle, description: eventDesc, externalParticipants: [] };
      const newExt = { id: Date.now().toString(), name: extName, school: extSchool, grade: extGrade };
      await setDoc(doc(db, 'events', selectedDateStr), { ...ev, externalParticipants: [...(ev.externalParticipants || []), newExt] }, { merge: true });
      setExtName(''); setExtSchool(''); setExtGrade('');
      customAlert('追加しました');
    } catch { customAlert('エラー', '追加に失敗しました'); }
  };

  const removeParticipant = (docId: string) =>
    customConfirm('削除確認', 'この参加者を削除しますか？', async () => {
      await deleteDoc(doc(db, 'event_participants', docId));
    });

  const removeExternal = async (extId: string) => {
    const ev = events[selectedDateStr];
    if (!ev) return;
    await setDoc(doc(db, 'events', selectedDateStr), {
      externalParticipants: ev.externalParticipants.filter((p: any) => p.id !== extId)
    }, { merge: true });
  };

  // ── 派生値 ────────────────────────────────────────────
  const days = generateDays();
  const currentEvent = events[selectedDateStr];
  const allParticipants = participantsMap[selectedDateStr] || [];
  const attendingMembers = allParticipants.filter(p => p.status === '参加');
  const externalParts = currentEvent?.externalParticipants || [];
  const totalCount = attendingMembers.length + externalParts.length;

  const filteredMembers = allMembers.filter(m => {
    const q = memberSearch.trim();
    const matchSearch = !q || m.name.includes(q) || (m.nicknameKana || '').includes(q);
    const matchSchool = !filterSchool || m.school === filterSchool;
    const matchGrade = !filterGrade || m.grade === filterGrade;
    return matchSearch && matchSchool && matchGrade;
  });

  if (checking || !verified) return null;

  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>イベント管理</Text>
      </View>

      {/* 月選択 */}
      <View style={styles.monthSelector}>
        <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.monthBtn}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.monthText}>{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</Text>
        <TouchableOpacity onPress={() => changeMonth(1)} style={styles.monthBtn}>
          <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* カレンダー */}
      <ScrollView style={styles.scrollArea}>
        <View style={styles.calendarContainer}>
          <View style={styles.calHeaderRow}>
            {DAY_NAMES.map((w, i) => (
              <Text key={i} style={[styles.calWeekText, i === 0 && { color: 'red' }, i === 6 && { color: 'blue' }]}>{w}</Text>
            ))}
          </View>
          <View style={styles.calGrid}>
            {days.map((item, index) => {
              if (!item) return <View key={`e-${index}`} style={styles.calCellEmpty} />;
              const ev = events[item.dateStr];
              const d = new Date(item.dateStr);
              let dateColor = COLORS.text;
              if (d.getDay() === 0 || !!publicHolidays[item.dateStr]) dateColor = 'red';
              else if (d.getDay() === 6) dateColor = 'blue';
              return (
                <TouchableOpacity
                  key={item.dateStr}
                  style={[styles.calCell, ev && styles.calCellActive]}
                  onPress={() => ev ? openParticipantModal(item.dateStr) : openCalModal(item.dateStr)}
                  onLongPress={() => openCalModal(item.dateStr)}
                >
                  <Text style={[styles.calDayText, { color: dateColor }]}>{item.day}</Text>
                  {ev && (
                    <View style={styles.eventBadge}>
                      <Text style={styles.eventBadgeText} numberOfLines={2}>{ev.title}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.calHint}>※ イベントのないマスをタップ→新規登録　イベントありをタップ→参加者管理　長押し→編集</Text>
        </View>
      </ScrollView>

      {/* ═══════════════════════════════════════════════════
          カレンダー日付選択モーダル（イベント登録・編集）
      ═══════════════════════════════════════════════════ */}
      <Modal visible={calModalVisible} animationType="slide" transparent>
        <SafeAreaView style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedDateStr}{publicHolidays[selectedDateStr] ? ` (${publicHolidays[selectedDateStr]})` : ''}
              </Text>
              <TouchableOpacity onPress={() => setCalModalVisible(false)}>
                <Ionicons name="close" size={28} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1, padding: 20 }}>
              <Text style={styles.label}>イベント名</Text>
              <TextInput style={styles.input} value={eventTitle} onChangeText={setEventTitle} placeholder="例: 春の遠足" placeholderTextColor="#BBB" />
              <Text style={styles.label}>説明・詳細</Text>
              <TextInput style={[styles.input, { height: 80 }]} value={eventDesc} onChangeText={setEventDesc} placeholder="持ち物や集合時間など" placeholderTextColor="#BBB" multiline />
              <View style={styles.actionRow}>
                {events[selectedDateStr] && (
                  <TouchableOpacity style={styles.deleteBtn} onPress={deleteEvent}>
                    <Text style={styles.deleteBtnText}>削除</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.saveBtn} onPress={saveEvent}>
                  <Text style={styles.saveBtnText}>保存する</Text>
                </TouchableOpacity>
              </View>
              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      {/* ═══════════════════════════════════════════════════
          参加者管理モーダル（タブ: 参加者一覧 / 新規追加）
      ═══════════════════════════════════════════════════ */}
      <Modal visible={participantModalVisible} animationType="slide" transparent>
        <SafeAreaView style={styles.modalOverlay}>
          <View style={styles.modalContent}>

            {/* モーダルヘッダー */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{currentEvent?.title || selectedDateStr}</Text>
                <Text style={{ fontSize: 12, color: COLORS.textLight, marginTop: 2 }}>
                  {selectedDateStr}　合計 {totalCount}名
                </Text>
              </View>
              <TouchableOpacity onPress={() => setParticipantModalVisible(false)}>
                <Ionicons name="close" size={28} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {/* タブ切り替え */}
            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tab, participantTab === 'list' && styles.tabActive]}
                onPress={() => setParticipantTab('list')}
              >
                <Text style={[styles.tabText, participantTab === 'list' && styles.tabTextActive]}>
                  参加者メンバー ({totalCount}名)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, participantTab === 'add' && styles.tabActive]}
                onPress={() => setParticipantTab('add')}
              >
                <Text style={[styles.tabText, participantTab === 'add' && styles.tabTextActive]}>新規追加</Text>
              </TouchableOpacity>
            </View>

            {/* ─── 参加者一覧タブ ─────────────────────── */}
            {participantTab === 'list' && (
              <ScrollView style={{ flex: 1, padding: 16 }}>

                {/* 学童メンバー */}
                <Text style={styles.subTitle}>学童メンバー（{attendingMembers.length}名）</Text>
                {attendingMembers.length === 0
                  ? <Text style={styles.emptyText}>まだ登録がありません</Text>
                  : attendingMembers.map(p => (
                    <View key={p.id} style={styles.participantRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.participantName}>{p.childName}</Text>
                        {(p.childSchool || p.childGrade) && (
                          <Text style={styles.participantSub}>
                            {[p.childSchool, p.childGrade].filter(Boolean).join(' / ')}
                          </Text>
                        )}
                      </View>
                      <TouchableOpacity onPress={() => removeParticipant(p.id)} style={styles.trashBtn}>
                        <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  ))
                }

                {/* 外部参加者 */}
                <Text style={[styles.subTitle, { marginTop: 20 }]}>外部参加者（{externalParts.length}名）</Text>
                {externalParts.length === 0
                  ? <Text style={styles.emptyText}>まだ登録がありません</Text>
                  : externalParts.map((p: any) => (
                    <View key={p.id} style={styles.participantRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.participantName}>{p.name}</Text>
                        {(p.school || p.grade) && (
                          <Text style={styles.participantSub}>{[p.school, p.grade].filter(Boolean).join(' / ')}</Text>
                        )}
                      </View>
                      <TouchableOpacity onPress={() => removeExternal(p.id)} style={styles.trashBtn}>
                        <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  ))
                }
                <View style={{ height: 40 }} />
              </ScrollView>
            )}

            {/* ─── 新規追加タブ ───────────────────────── */}
            {participantTab === 'add' && (
              <View style={{ flex: 1 }}>
                {/* サブタブ */}
                <View style={styles.subTabRow}>
                  <TouchableOpacity
                    style={[styles.subTab, addSubTab === 'user' && styles.subTabActive]}
                    onPress={() => setAddSubTab('user')}
                  >
                    <Ionicons name="people-outline" size={14} color={addSubTab === 'user' ? COLORS.primary : COLORS.textLight} />
                    <Text style={[styles.subTabText, addSubTab === 'user' && styles.subTabTextActive]}>利用者から追加</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.subTab, addSubTab === 'external' && styles.subTabActive]}
                    onPress={() => setAddSubTab('external')}
                  >
                    <Ionicons name="person-add-outline" size={14} color={addSubTab === 'external' ? COLORS.primary : COLORS.textLight} />
                    <Text style={[styles.subTabText, addSubTab === 'external' && styles.subTabTextActive]}>非利用者から追加</Text>
                  </TouchableOpacity>
                </View>

                {/* ── 利用者から追加 ── */}
                {addSubTab === 'user' && (
                  <View style={{ flex: 1 }}>
                    {/* 検索バー */}
                    <View style={styles.searchBar}>
                      <Ionicons name="search-outline" size={16} color={COLORS.textLight} style={{ marginRight: 6 }} />
                      <TextInput
                        style={{ flex: 1, fontSize: 14, color: COLORS.text }}
                        placeholder="名前・ニックネームで検索"
                        placeholderTextColor="#BBBBBB"
                        value={memberSearch}
                        onChangeText={setMemberSearch}
                      />
                      {memberSearch.length > 0 && (
                        <TouchableOpacity onPress={() => setMemberSearch('')}>
                          <Ionicons name="close-circle" size={16} color={COLORS.textLight} />
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* 学校フィルター */}
                    {allSchools.length > 0 && (
                      <View style={styles.filterSection}>
                        <Text style={styles.filterLabel}>学校</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View style={styles.filterChips}>
                            <TouchableOpacity
                              style={[styles.chip, !filterSchool && styles.chipActive]}
                              onPress={() => setFilterSchool('')}
                            >
                              <Text style={[styles.chipText, !filterSchool && styles.chipTextActive]}>すべて</Text>
                            </TouchableOpacity>
                            {allSchools.map(s => (
                              <TouchableOpacity
                                key={s}
                                style={[styles.chip, filterSchool === s && styles.chipActive]}
                                onPress={() => setFilterSchool(filterSchool === s ? '' : s)}
                              >
                                <Text style={[styles.chipText, filterSchool === s && styles.chipTextActive]}>{s}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </ScrollView>
                      </View>
                    )}

                    {/* 学年フィルター */}
                    {allGrades.length > 0 && (
                      <View style={styles.filterSection}>
                        <Text style={styles.filterLabel}>学年</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          <View style={styles.filterChips}>
                            <TouchableOpacity
                              style={[styles.chip, !filterGrade && styles.chipActive]}
                              onPress={() => setFilterGrade('')}
                            >
                              <Text style={[styles.chipText, !filterGrade && styles.chipTextActive]}>すべて</Text>
                            </TouchableOpacity>
                            {allGrades.map(g => (
                              <TouchableOpacity
                                key={g}
                                style={[styles.chip, filterGrade === g && styles.chipActive]}
                                onPress={() => setFilterGrade(filterGrade === g ? '' : g)}
                              >
                                <Text style={[styles.chipText, filterGrade === g && styles.chipTextActive]}>{g}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </ScrollView>
                      </View>
                    )}

                    {/* メンバーリスト */}
                    <ScrollView style={{ flex: 1, paddingHorizontal: 16 }}>
                      {filteredMembers.length === 0
                        ? <Text style={[styles.emptyText, { textAlign: 'center', marginTop: 24 }]}>該当するメンバーがいません</Text>
                        : filteredMembers.map(member => {
                          const added = allParticipants.some(p => p.childName === member.name);
                          return (
                            <TouchableOpacity
                              key={member.id}
                              style={[styles.memberRow, added && styles.memberRowAdded]}
                              onPress={() => { if (!added) addMember(member); }}
                              disabled={added}
                              activeOpacity={0.7}
                            >
                              <View style={styles.memberAvatar}>
                                <Text style={styles.memberAvatarText}>{member.name.charAt(0)}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.memberName, added && { color: COLORS.textLight }]}>{member.name}</Text>
                                {(member.school || member.grade) && (
                                  <Text style={styles.memberSub}>
                                    {[member.school, member.grade].filter(Boolean).join(' ・ ')}
                                  </Text>
                                )}
                              </View>
                              {added
                                ? <View style={styles.addedBadge}><Text style={styles.addedBadgeText}>追加済</Text></View>
                                : <View style={styles.addBtn}><Ionicons name="add" size={18} color="#fff" /></View>
                              }
                            </TouchableOpacity>
                          );
                        })
                      }
                      <View style={{ height: 40 }} />
                    </ScrollView>
                  </View>
                )}

                {/* ── 非利用者から追加 ── */}
                {addSubTab === 'external' && (
                  <ScrollView style={{ flex: 1, padding: 16 }}>
                    <Text style={styles.externalDesc}>学童に登録のない外部参加者を手動で追加できます。</Text>

                    <Text style={styles.label}>氏名 *</Text>
                    <TextInput
                      style={styles.input}
                      value={extName}
                      onChangeText={setExtName}
                      placeholder="例: 田中 太郎"
                      placeholderTextColor="#BBBBBB"
                    />
                    <Text style={styles.label}>学校名</Text>
                    <TextInput
                      style={styles.input}
                      value={extSchool}
                      onChangeText={setExtSchool}
                      placeholder="例: ○○小学校"
                      placeholderTextColor="#BBBBBB"
                    />
                    <Text style={styles.label}>学年</Text>
                    <TextInput
                      style={styles.input}
                      value={extGrade}
                      onChangeText={setExtGrade}
                      placeholder="例: 小3"
                      placeholderTextColor="#BBBBBB"
                    />
                    <TouchableOpacity
                      style={[styles.saveBtn, { marginTop: 24, opacity: extName.trim() ? 1 : 0.5 }]}
                      onPress={addExternalParticipant}
                      disabled={!extName.trim()}
                    >
                      <Ionicons name="person-add-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
                      <Text style={styles.saveBtnText}>外部参加者として追加</Text>
                    </TouchableOpacity>
                    <View style={{ height: 60 }} />
                  </ScrollView>
                )}
              </View>
            )}

          </View>
        </SafeAreaView>
      </Modal>
      <AdminBottomNav active="event" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },

  monthSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  monthBtn: { padding: 8, backgroundColor: COLORS.surface, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border },
  monthText: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },

  scrollArea: { flex: 1 },
  calendarContainer: { paddingHorizontal: 8, paddingBottom: 20 },
  calHeaderRow: { flexDirection: 'row', marginBottom: 8 },
  calWeekText: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 'bold', color: COLORS.textLight },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCellEmpty: { width: '14.28%', minHeight: 60 },
  calCell: { width: '14.28%', minHeight: 70, borderWidth: 0.5, borderColor: COLORS.border, padding: 2, backgroundColor: COLORS.white },
  calCellActive: { backgroundColor: '#EEF6FF' },
  calDayText: { fontSize: 12, fontWeight: 'bold', marginBottom: 2 },
  eventBadge: { backgroundColor: COLORS.primary, borderRadius: 4, padding: 2 },
  eventBadgeText: { fontSize: 8, color: COLORS.white, fontWeight: 'bold', textAlign: 'center' },
  calHint: { fontSize: 11, color: COLORS.textLight, textAlign: 'center', marginTop: 12, lineHeight: 16 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: COLORS.white, height: '92%', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20, borderBottomWidth: 1, borderColor: COLORS.border },
  modalTitle: { fontSize: 17, fontWeight: 'bold', color: COLORS.text },

  label: { fontSize: 14, fontWeight: 'bold', marginBottom: 8, marginTop: 16, color: COLORS.text },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 12, fontSize: 15, backgroundColor: '#FAFAFA', color: COLORS.text },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  saveBtn: { flex: 1, flexDirection: 'row', backgroundColor: COLORS.primary, padding: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 15 },
  deleteBtn: { backgroundColor: '#FFF0F0', padding: 14, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#FFE0E0' },
  deleteBtnText: { color: COLORS.danger, fontWeight: 'bold' },

  // ── タブ ──
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: COLORS.border },
  tab: { flex: 1, paddingVertical: 13, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  tabText: { fontSize: 14, fontWeight: 'bold', color: COLORS.textLight },
  tabTextActive: { color: COLORS.primary },

  subTabRow: { flexDirection: 'row', margin: 12, borderRadius: 10, backgroundColor: '#F2F2F2', padding: 3 },
  subTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 8 },
  subTabActive: { backgroundColor: COLORS.white, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  subTabText: { fontSize: 13, fontWeight: 'bold', color: COLORS.textLight },
  subTabTextActive: { color: COLORS.primary },

  // ── 参加者一覧 ──
  subTitle: { fontSize: 15, fontWeight: 'bold', color: COLORS.text, marginBottom: 10 },
  emptyText: { color: COLORS.textLight, fontStyle: 'italic', marginBottom: 8 },
  participantRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#F0F0F0' },
  participantName: { fontSize: 15, fontWeight: 'bold', color: COLORS.text },
  participantSub: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  trashBtn: { padding: 6 },

  // ── 利用者検索 ──
  searchBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#FAFAFA' },

  filterSection: { marginHorizontal: 16, marginBottom: 6 },
  filterLabel: { fontSize: 11, fontWeight: 'bold', color: COLORS.textLight, marginBottom: 4 },
  filterChips: { flexDirection: 'row', gap: 6, paddingBottom: 2 },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 12, color: COLORS.text, fontWeight: 'bold' },
  chipTextActive: { color: COLORS.white },

  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#F5F5F5', gap: 10 },
  memberRowAdded: { opacity: 0.5 },
  memberAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.primary + '20', alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 16, fontWeight: 'bold', color: COLORS.primary },
  memberName: { fontSize: 15, fontWeight: 'bold', color: COLORS.text },
  memberSub: { fontSize: 12, color: COLORS.textLight, marginTop: 1 },
  addedBadge: { backgroundColor: '#E0E0E0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  addedBadgeText: { fontSize: 11, color: '#757575', fontWeight: 'bold' },
  addBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },

  // ── 外部参加者追加 ──
  externalDesc: { fontSize: 13, color: COLORS.textLight, marginBottom: 8, lineHeight: 18 },
});
