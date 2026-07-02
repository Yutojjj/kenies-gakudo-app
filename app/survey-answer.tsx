import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { useRequireRole } from '../hooks/useRequireRole';
import { navigateHome } from '../utils/navigationHome';

const customAlert = (t: string, m?: string) => {
  if (Platform.OS === 'web') window.alert(m ? `${t}\n${m}` : t);
  else Alert.alert(t, m);
};

export default function SurveyAnswerScreen() {
  const { verified, checking, userInfo } = useRequireRole(['admin', 'staff', 'user']);

  const { surveyId } = useLocalSearchParams<{ surveyId: string }>();
  const router = useRouter();
  const [survey, setSurvey] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [alreadyAnswered, setAlreadyAnswered] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!surveyId) return;
    getDoc(doc(db, 'surveys', surveyId)).then(snap => {
      if (snap.exists()) setSurvey({ id: snap.id, ...snap.data() });
    });
    // 既回答チェック
    if (userInfo?.name) {
      getDocs(query(collection(db, 'survey_responses'),
        where('surveyId', '==', surveyId),
        where('respondentName', '==', userInfo.name)
      )).then(snap => { if (!snap.empty) setAlreadyAnswered(true); });
    }
  }, [surveyId]);

  const submit = async () => {
    if (!survey || !userInfo) return;
    const unanswered = survey.questions.filter((q: any) => !answers[q.id]?.trim());
    if (unanswered.length > 0) {
      customAlert('未回答があります', 'すべての質問に回答してください');
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, 'survey_responses'), {
        surveyId: survey.id,
        respondentName: userInfo.name,
        respondentRole: userInfo.role,
        answers,
        submittedAt: serverTimestamp(),
      });
      customAlert('回答完了', 'アンケートを送信しました');
      router.back();
    } catch {
      customAlert('エラー', '送信に失敗しました');
    }
    setSaving(false);
  };

  if (!survey) return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: '#aaa' }}>読み込み中...</Text>
      </View>
    </SafeAreaView>
  );

  if (checking || !verified) return null;
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigateHome(router)} style={{ marginRight: 10 }}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{survey.title}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {survey.description ? (
          <View style={styles.descBox}>
            <Text style={styles.descText}>{survey.description}</Text>
          </View>
        ) : null}

        {alreadyAnswered ? (
          <View style={styles.doneBox}>
            <Ionicons name="checkmark-circle" size={40} color="#4CAF50" />
            <Text style={styles.doneText}>回答済みです</Text>
            <Text style={{ fontSize: 13, color: '#888', marginTop: 4 }}>このアンケートはすでに回答しています</Text>
          </View>
        ) : (
          <>
            {survey.questions?.map((q: any, qi: number) => (
              <View key={q.id} style={styles.questionCard}>
                <Text style={styles.questionNum}>Q{qi + 1}</Text>
                <Text style={styles.questionText}>{q.text}</Text>
                {q.type === 'text' ? (
                  <TextInput
                    style={styles.answerInput}
                    value={answers[q.id] || ''}
                    onChangeText={v => setAnswers({ ...answers, [q.id]: v })}
                    placeholder="回答を入力"
                    multiline
                  />
                ) : (
                  <View style={{ gap: 8, marginTop: 8 }}>
                    {(q.options || []).map((opt: string, oi: number) => (
                      <TouchableOpacity key={oi}
                        style={[styles.optionBtn, answers[q.id] === opt && styles.optionBtnActive]}
                        onPress={() => setAnswers({ ...answers, [q.id]: opt })}>
                        <View style={[styles.optionRadio, answers[q.id] === opt && styles.optionRadioActive]} />
                        <Text style={[styles.optionText, answers[q.id] === opt && { color: COLORS.primary, fontWeight: 'bold' }]}>
                          {opt}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}
            <TouchableOpacity
              style={[styles.submitBtn, saving && { backgroundColor: '#ccc' }]}
              onPress={submit} disabled={saving}>
              <Text style={styles.submitBtnText}>{saving ? '送信中...' : '回答を送信する'}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFF8F0', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  descBox: { backgroundColor: '#FFF8E1', borderRadius: 12, padding: 14, borderLeftWidth: 4, borderLeftColor: COLORS.primary },
  descText: { fontSize: 14, color: '#555', lineHeight: 20 },
  doneBox: { alignItems: 'center', paddingVertical: 50, backgroundColor: '#fff', borderRadius: 14, padding: 24 },
  doneText: { fontSize: 18, fontWeight: 'bold', color: '#4CAF50', marginTop: 10 },
  questionCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  questionNum: { fontSize: 11, fontWeight: 'bold', color: COLORS.primary, marginBottom: 4 },
  questionText: { fontSize: 15, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  answerInput: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10, padding: 12, fontSize: 14, minHeight: 80, backgroundColor: '#FAFAFA' },
  optionBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#E0E0E0', backgroundColor: '#FAFAFA' },
  optionBtnActive: { borderColor: COLORS.primary, backgroundColor: '#FFF8E1' },
  optionRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#ccc' },
  optionRadioActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  optionText: { fontSize: 14, color: '#555' },
  submitBtn: { backgroundColor: COLORS.primary, padding: 16, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
