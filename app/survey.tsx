import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  addDoc, collection, deleteDoc, doc,
  onSnapshot, orderBy, query,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  Alert, Modal, Platform, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { useRequireRole } from '../hooks/useRequireRole';

const customAlert = (title: string, msg?: string) => {
  if (Platform.OS === 'web') window.alert(msg ? `${title}\n${msg}` : title);
  else Alert.alert(title, msg);
};
const customConfirm = (title: string, msg: string, onOk: () => void) => {
  if (Platform.OS === 'web') { if (window.confirm(`${title}\n${msg}`)) onOk(); }
  else Alert.alert(title, msg, [{ text: 'キャンセル', style: 'cancel' }, { text: 'OK', onPress: onOk }]);
};

interface SurveyQuestion { id: string; text: string; type: 'text' | 'select'; options?: string[]; }
interface Survey {
  id: string; title: string; description: string;
  questions: SurveyQuestion[]; createdAt: any;
  isPublished: boolean; notified: boolean;
}
interface SurveyResponse {
  id: string; surveyId: string; respondentName: string;
  answers: Record<string, string>; submittedAt: any;
}

export default function SurveyScreen() {
  const { verified, checking } = useRequireRole('admin');

  const router = useRouter();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [createModal, setCreateModal] = useState(false);
  const [detailSurvey, setDetailSurvey] = useState<Survey | null>(null);
  const [detailModal, setDetailModal] = useState(false);

  // 作成フォームのstate
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [questions, setQuestions] = useState<{ text: string; type: 'text' | 'select'; options: string }[]>([
    { text: '', type: 'text', options: '' }
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub1 = onSnapshot(
      query(collection(db, 'surveys'), orderBy('createdAt', 'desc')),
      snap => setSurveys(snap.docs.map(d => ({ id: d.id, ...d.data() } as Survey)))
    );
    const unsub2 = onSnapshot(
      collection(db, 'survey_responses'),
      snap => setResponses(snap.docs.map(d => ({ id: d.id, ...d.data() } as SurveyResponse)))
    );
    return () => { unsub1(); unsub2(); };
  }, []);

  const createSurvey = async () => {
    if (!newTitle.trim()) { customAlert('エラー', 'タイトルを入力してください'); return; }
    const validQs = questions.filter(q => q.text.trim());
    if (validQs.length === 0) { customAlert('エラー', '質問を1つ以上入力してください'); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, 'surveys'), {
        title: newTitle.trim(),
        description: newDesc.trim(),
        questions: validQs.map((q, i) => ({
          id: `q${i}`,
          text: q.text.trim(),
          type: q.type,
          options: q.type === 'select' ? q.options.split('\n').filter(o => o.trim()) : [],
        })),
        isPublished: false,
        notified: false,
        createdAt: serverTimestamp(),
      });
      setCreateModal(false);
      setNewTitle(''); setNewDesc('');
      setQuestions([{ text: '', type: 'text', options: '' }]);
      customAlert('作成完了', 'アンケートを作成しました');
    } catch (e) { customAlert('エラー', '作成に失敗しました'); }
    setSaving(false);
  };

  const togglePublish = async (survey: Survey) => {
    const newVal = !survey.isPublished;
    customConfirm(
      newVal ? 'アンケートを公開' : 'アンケートを非公開に',
      newVal ? '利用者・スタッフに公開しますか？' : '非公開にしますか？',
      async () => {
        await setDoc(doc(db, 'surveys', survey.id), { isPublished: newVal }, { merge: true });
      }
    );
  };

  const sendNotification = async (survey: Survey) => {
    customConfirm('通知を送る', 'アンケートの通知を全員に送りますか？', async () => {
      // admin_noticesコレクションに通知を追加
      await addDoc(collection(db, 'admin_notices'), {
        type: 'survey',
        surveyId: survey.id,
        title: `📋 アンケートのお知らせ`,
        body: `「${survey.title}」のアンケートが届いています。ご回答をお願いします。`,
        createdAt: serverTimestamp(),
        read: false,
      });
      await setDoc(doc(db, 'surveys', survey.id), { notified: true }, { merge: true });
      customAlert('送信完了', '通知を送りました');
    });
  };

  const deleteSurvey = async (survey: Survey) => {
    customConfirm('削除', `「${survey.title}」を削除しますか？回答も全て削除されます。`, async () => {
      // 回答も削除
      const surveyResponses = responses.filter(r => r.surveyId === survey.id);
      await Promise.all(surveyResponses.map(r => deleteDoc(doc(db, 'survey_responses', r.id))));
      await deleteDoc(doc(db, 'surveys', survey.id));
    });
  };

  const openDetail = (survey: Survey) => {
    setDetailSurvey(survey);
    setDetailModal(true);
  };

  const surveyResponses = detailSurvey
    ? responses.filter(r => r.surveyId === detailSurvey.id)
    : [];

  if (checking || !verified) return null;
  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📋 アンケート管理</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setCreateModal(true)}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {surveys.length === 0 && (
          <View style={styles.emptyBox}>
            <Ionicons name="clipboard-outline" size={40} color="#ccc" />
            <Text style={styles.emptyText}>アンケートがありません</Text>
            <Text style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>右上の＋ボタンから作成できます</Text>
          </View>
        )}
        {surveys.map(survey => {
          const resCount = responses.filter(r => r.surveyId === survey.id).length;
          return (
            <TouchableOpacity key={survey.id} style={styles.surveyCard} onPress={() => openDetail(survey)} activeOpacity={0.8}>
              <View style={styles.surveyCardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.surveyTitle}>{survey.title}</Text>
                  {survey.description ? <Text style={styles.surveyDesc} numberOfLines={2}>{survey.description}</Text> : null}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <View style={[styles.badge, { backgroundColor: survey.isPublished ? '#E8F5E9' : '#FFF3E0' }]}>
                      <Text style={{ fontSize: 11, color: survey.isPublished ? '#2E7D32' : '#E65100', fontWeight: 'bold' }}>
                        {survey.isPublished ? '公開中' : '非公開'}
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: '#E3F2FD' }]}>
                      <Text style={{ fontSize: 11, color: '#1565C0', fontWeight: 'bold' }}>回答 {resCount}件</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: '#F3E5F5' }]}>
                      <Text style={{ fontSize: 11, color: '#6A1B9A', fontWeight: 'bold' }}>{survey.questions?.length || 0}問</Text>
                    </View>
                  </View>
                </View>
              </View>
              <View style={styles.surveyActions}>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: survey.isPublished ? '#FFF3E0' : '#E8F5E9' }]}
                  onPress={() => togglePublish(survey)}>
                  <Ionicons name={survey.isPublished ? 'eye-off-outline' : 'eye-outline'} size={15}
                    color={survey.isPublished ? '#E65100' : '#2E7D32'} />
                  <Text style={{ fontSize: 12, color: survey.isPublished ? '#E65100' : '#2E7D32', marginLeft: 4, fontWeight: 'bold' }}>
                    {survey.isPublished ? '非公開にする' : '公開する'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#E3F2FD' }]}
                  onPress={() => sendNotification(survey)}>
                  <Ionicons name="notifications-outline" size={15} color="#1565C0" />
                  <Text style={{ fontSize: 12, color: '#1565C0', marginLeft: 4, fontWeight: 'bold' }}>通知</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#FFEBEE' }]}
                  onPress={() => deleteSurvey(survey)}>
                  <Ionicons name="trash-outline" size={15} color="#C62828" />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* アンケート作成モーダル */}
      <Modal visible={createModal} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FAFAFA' }}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setCreateModal(false)} style={styles.backBtn}>
              <Ionicons name="close" size={24} color="#5D4037" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>アンケート作成</Text>
            <TouchableOpacity style={[styles.addBtn, { backgroundColor: saving ? '#ccc' : COLORS.primary }]}
              onPress={createSurvey} disabled={saving}>
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>{saving ? '保存中' : '保存'}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>タイトル *</Text>
              <TextInput style={styles.textInput} value={newTitle} onChangeText={setNewTitle}
                placeholder="例：夏のイベントについて" placeholderTextColor="#C0C0C0" />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>説明（任意）</Text>
              <TextInput style={[styles.textInput, { height: 80 }]} value={newDesc} onChangeText={setNewDesc}
                placeholder="アンケートの説明を入力" placeholderTextColor="#C0C0C0" multiline />
            </View>

            <Text style={[styles.inputLabel, { fontSize: 15 }]}>質問</Text>
            {questions.map((q, qi) => (
              <View key={qi} style={styles.questionCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#555' }}>Q{qi + 1}</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {(['text', 'select'] as const).map(t => (
                      <TouchableOpacity key={t}
                        style={[styles.typeBtn, q.type === t && styles.typeBtnActive]}
                        onPress={() => {
                          const newQs = [...questions];
                          newQs[qi] = { ...newQs[qi], type: t };
                          setQuestions(newQs);
                        }}>
                        <Text style={{ fontSize: 11, color: q.type === t ? '#fff' : '#666', fontWeight: 'bold' }}>
                          {t === 'text' ? '自由記述' : '選択肢'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {questions.length > 1 && (
                    <TouchableOpacity onPress={() => setQuestions(questions.filter((_, i) => i !== qi))}
                      style={{ marginLeft: 'auto' }}>
                      <Ionicons name="close-circle" size={20} color="#E53935" />
                    </TouchableOpacity>
                  )}
                </View>
                <TextInput style={styles.textInput} value={q.text}
                  onChangeText={v => { const n = [...questions]; n[qi] = { ...n[qi], text: v }; setQuestions(n); }}
                  placeholder="質問文を入力" placeholderTextColor="#C0C0C0" />
                {q.type === 'select' && (
                  <TextInput style={[styles.textInput, { marginTop: 8, height: 80 }]}
                    value={q.options}
                    onChangeText={v => { const n = [...questions]; n[qi] = { ...n[qi], options: v }; setQuestions(n); }}
                    placeholder="選択肢を改行で区切って入力&#10;例：はい&#10;いいえ&#10;どちらでもない" placeholderTextColor="#C0C0C0"
                    multiline />
                )}
              </View>
            ))}
            <TouchableOpacity style={styles.addQuestionBtn}
              onPress={() => setQuestions([...questions, { text: '', type: 'text', options: '' }])}>
              <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
              <Text style={{ color: COLORS.primary, fontWeight: 'bold', marginLeft: 6 }}>質問を追加</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* 回答一覧モーダル */}
      <Modal visible={detailModal} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FAFAFA' }}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setDetailModal(false)} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={24} color="#5D4037" />
            </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>{detailSurvey?.title}</Text>
            <View style={[styles.addBtn, { backgroundColor: '#E3F2FD' }]}>
              <Text style={{ fontSize: 12, color: '#1565C0', fontWeight: 'bold' }}>{surveyResponses.length}件</Text>
            </View>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
            {surveyResponses.length === 0 && (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>まだ回答がありません</Text>
              </View>
            )}
            {surveyResponses.map((res, ri) => (
              <View key={res.id} style={styles.responseCard}>
                <Text style={styles.respondentName}>👤 {res.respondentName}</Text>
                {detailSurvey?.questions.map(q => (
                  <View key={q.id} style={{ marginTop: 8 }}>
                    <Text style={{ fontSize: 12, color: '#888' }}>{q.text}</Text>
                    <Text style={{ fontSize: 14, color: '#333', marginTop: 2, fontWeight: '500' }}>
                      {res.answers?.[q.id] || '（未回答）'}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 10 },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  addBtn: { backgroundColor: COLORS.primary, borderRadius: 20, padding: 7, minWidth: 36, alignItems: 'center' },
  emptyBox: { alignItems: 'center', paddingVertical: 50 },
  emptyText: { fontSize: 15, color: '#aaa', marginTop: 12 },
  surveyCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 3 },
  surveyCardTop: { flexDirection: 'row', gap: 10 },
  surveyTitle: { fontSize: 15, fontWeight: 'bold', color: '#333' },
  surveyDesc: { fontSize: 12, color: '#888', marginTop: 3 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  surveyActions: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  inputGroup: { gap: 6 },
  inputLabel: { fontSize: 13, fontWeight: 'bold', color: '#555' },
  textInput: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10, padding: 12, fontSize: 14, backgroundColor: '#fff' },
  questionCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#EDEDED' },
  typeBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#F0F0F0' },
  typeBtnActive: { backgroundColor: COLORS.primary },
  addQuestionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.primary, borderStyle: 'dashed' },
  responseCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E8EAF6' },
  respondentName: { fontSize: 14, fontWeight: 'bold', color: '#3949AB' },
});