import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'crypto-js';
import { useRouter } from 'expo-router';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageSourcePropType,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AdminBottomNav from '../components/AdminBottomNav';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { useRequireRole } from '../hooks/useRequireRole';

type DialogState = {
  visible: boolean;
  title: string;
  message?: string;
  confirm?: boolean;
  onConfirm?: () => void;
};

type MoreItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  image?: ImageSourcePropType;
  cardBg?: string;
  borderColor?: string;
  onPress: () => void;
};

const MORE_IMAGES = {
  account: require('../assets/quick-menu/account.png'),
  paidTransport: require('../assets/quick-menu/paid-transport.png'),
};

const hashPassword = (password: string) => Crypto.SHA256(password).toString();

const GRADE_UP_MAP: Record<string, string> = {
  '小1': '小2',
  '小2': '小3',
  '小3': '小4',
  '小4': '小5',
  '小5': '小6',
  '小6': '卒業',
};

const GRADE_DOWN_MAP: Record<string, string> = {
  '小2': '小1',
  '小3': '小2',
  '小4': '小3',
  '小5': '小4',
  '小6': '小5',
  '卒業': '小6',
};

export default function AdminMoreScreen() {
  const router = useRouter();
  const { verified, checking } = useRequireRole('admin');
  const [adminName, setAdminName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [dialog, setDialog] = useState<DialogState>({ visible: false, title: '' });
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [periodVisible, setPeriodVisible] = useState(false);
  const [periodStart, setPeriodStart] = useState('1');
  const [periodEnd, setPeriodEnd] = useState('15');
  const [gradeChoiceVisible, setGradeChoiceVisible] = useState(false);
  const [gradePreviewVisible, setGradePreviewVisible] = useState(false);
  const [gradeDirection, setGradeDirection] = useState<'up' | 'down'>('up');
  const [gradePreview, setGradePreview] = useState<{ id: string; name: string; oldGrade: string; newGrade: string; role: string }[]>([]);
  const [gradeLoading, setGradeLoading] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(raw => {
      if (!raw) return;
      try {
        const user = JSON.parse(raw);
        setAdminName(user.name || '');
        setAccountId(user.accountId || '');
      } catch {}
    });
  }, []);

  const showAlert = (title: string, message?: string) => {
    setDialog({ visible: true, title, message });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setDialog({ visible: true, title, message, confirm: true, onConfirm });
  };

  const go = (pathname: string, params?: Record<string, string>) => {
    router.push(params ? ({ pathname, params } as any) : (pathname as any));
  };

  const normalizeDay = (value: string) => {
    const n = Number(String(value).replace(/[^\d]/g, ''));
    if (!Number.isFinite(n)) return '';
    return String(Math.min(31, Math.max(1, n)));
  };

  const saveShiftPeriod = async () => {
    const start = normalizeDay(periodStart);
    const end = normalizeDay(periodEnd);
    if (!start || !end) {
      showAlert('入力を確認してください', '1〜31の日付を入力してください。');
      return;
    }
    await setDoc(doc(db, 'settings', 'shift_period'), { start, end }, { merge: true });
    setPeriodStart(start);
    setPeriodEnd(end);
    setPeriodVisible(false);
    showAlert('保存しました', `毎月 ${start}日 〜 ${end}日 を提出期間に設定しました。`);
  };

  const savePassword = async () => {
    if (!newPassword.trim()) {
      showAlert('入力してください', '新しいパスワードを入力してください。');
      return;
    }
    let id = accountId;
    if (!id && adminName) {
      const snap = await getDocs(query(collection(db, 'accounts'), where('name', '==', adminName)));
      if (!snap.empty) id = snap.docs[0].id;
    }
    if (!id) {
      showAlert('エラー', '管理者アカウントを確認できませんでした。');
      return;
    }
    const hashedPassword = hashPassword(newPassword.trim());
    await setDoc(doc(db, 'accounts', id), { generatedPw: hashedPassword, password: hashedPassword }, { merge: true });
    setNewPassword('');
    setPasswordVisible(false);
    showAlert('変更しました', '次回から新しいパスワードでログインできます。');
  };

  const prepareGradeChange = async (direction: 'up' | 'down') => {
    setGradeChoiceVisible(false);
    setGradeDirection(direction);
    setGradeLoading(true);
    const map = direction === 'up' ? GRADE_UP_MAP : GRADE_DOWN_MAP;
    try {
      const snap = await getDocs(collection(db, 'accounts'));
      const preview: { id: string; name: string; oldGrade: string; newGrade: string; role: string }[] = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.role === 'user') {
          if (data.grade && map[data.grade]) {
            preview.push({ id: d.id, name: data.name || '', oldGrade: data.grade, newGrade: map[data.grade], role: '利用者' });
          }
          (data.siblings || []).forEach((s: any, i: number) => {
            if (s.grade && map[s.grade]) {
              preview.push({ id: `${d.id}_sib_${i}`, name: s.name || '', oldGrade: s.grade, newGrade: map[s.grade], role: '兄弟' });
            }
          });
        }
        if (data.role === 'staff') {
          (data.staffChildren || []).forEach((c: any, i: number) => {
            if (c.grade && map[c.grade]) {
              preview.push({ id: `${d.id}_staff_${i}`, name: c.name || '', oldGrade: c.grade, newGrade: map[c.grade], role: 'スタッフ子' });
            }
          });
        }
      });
      preview.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      setGradePreview(preview);
      setGradePreviewVisible(true);
    } catch {
      showAlert('エラー', '学年情報の読み込みに失敗しました。');
    } finally {
      setGradeLoading(false);
    }
  };

  const executeGradeChange = async () => {
    setGradeLoading(true);
    const map = gradeDirection === 'up' ? GRADE_UP_MAP : GRADE_DOWN_MAP;
    try {
      const snap = await getDocs(collection(db, 'accounts'));
      for (const d of snap.docs) {
        const data = d.data();
        const updates: any = {};
        let changed = false;
        if (data.role === 'user') {
          if (data.grade && map[data.grade]) {
            updates.grade = map[data.grade];
            changed = true;
          }
          const siblings = data.siblings || [];
          const nextSiblings = siblings.map((s: any) => s.grade && map[s.grade] ? { ...s, grade: map[s.grade] } : s);
          if (JSON.stringify(nextSiblings) !== JSON.stringify(siblings)) {
            updates.siblings = nextSiblings;
            changed = true;
          }
        }
        if (data.role === 'staff') {
          const children = data.staffChildren || [];
          const nextChildren = children.map((c: any) => c.grade && map[c.grade] ? { ...c, grade: map[c.grade] } : c);
          if (JSON.stringify(nextChildren) !== JSON.stringify(children)) {
            updates.staffChildren = nextChildren;
            changed = true;
          }
        }
        if (changed) await setDoc(doc(db, 'accounts', d.id), updates, { merge: true });
      }
      setGradePreviewVisible(false);
      showAlert('完了しました', gradeDirection === 'up' ? '学年を1つ上げました。' : '学年を1つ下げました。');
    } catch (e: any) {
      showAlert('エラー', `更新に失敗しました。${e?.message || ''}`);
    } finally {
      setGradeLoading(false);
    }
  };

  const logout = () => {
    showConfirm('ログアウト', 'ログアウトしますか？', async () => {
      await AsyncStorage.removeItem('loggedInUser');
      router.replace('/');
    });
  };

  const items: MoreItem[] = [
    { label: '学校別下校時刻', icon: 'school-outline', color: '#00AEB8', bg: '#DFF8FA', onPress: () => go('/school-times') },
    { label: '長期休み設定', icon: 'calendar-number-outline', color: '#4DA3FF', bg: '#E5F2FF', onPress: () => go('/holidays-setting') },
    { label: '習い事一覧', icon: 'musical-notes-outline', color: '#8A63D2', bg: '#EFE7FF', onPress: () => go('/lesson-management') },
    { label: '定期利用者一覧', icon: 'people-outline', color: '#26A65B', bg: '#E5F7E9', onPress: () => go('/regular-users') },
    { label: '学年一括変更', icon: 'trending-up-outline', color: '#FF8F00', bg: '#FFF0D8', onPress: () => setGradeChoiceVisible(true) },
    { label: '有料送迎 管理', icon: 'car-outline', color: '#E86A17', bg: '#FFE8D6', image: MORE_IMAGES.paidTransport, cardBg: '#FFF2D8', borderColor: '#FFC76E', onPress: () => go('/paid-transport', { role: 'admin', name: adminName || '' }) },
    { label: 'シフト入力期間', icon: 'time-outline', color: '#2D8BE8', bg: '#E1F1FF', onPress: () => setPeriodVisible(true) },
    { label: '合計勤務時間', icon: 'bar-chart-outline', color: '#5D6DCE', bg: '#E8EAFF', onPress: () => go('/staff-hours') },
    { label: 'パスワード変更', icon: 'lock-closed-outline', color: '#795548', bg: '#F2E7DF', onPress: () => setPasswordVisible(true) },
    { label: 'アンケート', icon: 'clipboard-outline', color: '#00A176', bg: '#DFF8EF', onPress: () => go('/survey') },
    { label: 'タイピング検定', icon: 'keypad-outline', color: '#F05172', bg: '#FFE4EA', onPress: () => go('/typing-cert') },
    { label: '入室QRリーダー', icon: 'qr-code-outline', color: '#7B61FF', bg: '#ECE7FF', onPress: () => go('/qr-scan') },
    { label: 'QRコード一括更新', icon: 'sync-outline', color: '#0097A7', bg: '#DCF7FA', onPress: () => go('/admin/qr-updater') },
    { label: 'アルバム', icon: 'image-outline', color: '#F2A100', bg: '#FFF1C8', onPress: () => go('/album', { role: 'admin', name: adminName || '' }) },
    { label: 'アカウント管理', icon: 'person-circle-outline', color: '#F05172', bg: '#FFE4EA', image: MORE_IMAGES.account, cardBg: '#FFF1F6', borderColor: '#FFB8CA', onPress: () => go('/account/list') },
    { label: 'アカウント作成', icon: 'person-add-outline', color: '#F05172', bg: '#FFE4EA', image: MORE_IMAGES.account, cardBg: '#FFF1F6', borderColor: '#FFB8CA', onPress: () => go('/account/form') },
    { label: 'ログアウト', icon: 'log-out-outline', color: '#E53935', bg: '#FFE6E6', onPress: logout },
  ];

  if (checking || !verified) return null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>その他</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <Ionicons name="sparkles-outline" size={20} color="#F2A100" />
          <Text style={styles.sectionTitle}>管理メニュー</Text>
        </View>
        <View style={styles.grid}>
          {items.map(item => (
            <TouchableOpacity
              key={item.label}
              style={[styles.card, item.cardBg && { backgroundColor: item.cardBg, borderColor: item.borderColor || item.bg }]}
              onPress={item.onPress}
              activeOpacity={0.82}
            >
              {item.image ? (
                <Image source={item.image} style={styles.cardImage} resizeMode="contain" />
              ) : (
                <View style={[styles.iconCircle, { backgroundColor: item.bg }]}>
                  <Ionicons name={item.icon} size={28} color={item.color} />
                </View>
              )}
              <Text style={styles.cardText} numberOfLines={2}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color="#9A8F86" style={styles.cardChevron} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <Modal visible={periodVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>シフト入力期間</Text>
            <Text style={styles.modalSub}>毎月の提出できる日付を設定します</Text>
            <View style={styles.periodRow}>
              <View style={styles.periodInputWrap}>
                <Text style={styles.inputLabel}>開始日</Text>
                <TextInput style={styles.periodInput} value={periodStart} onChangeText={setPeriodStart} keyboardType="number-pad" />
              </View>
              <Text style={styles.periodWave}>〜</Text>
              <View style={styles.periodInputWrap}>
                <Text style={styles.inputLabel}>終了日</Text>
                <TextInput style={styles.periodInput} value={periodEnd} onChangeText={setPeriodEnd} keyboardType="number-pad" />
              </View>
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setPeriodVisible(false)}>
                <Text style={styles.cancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.okBtn} onPress={saveShiftPeriod}>
                <Text style={styles.okText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={passwordVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>パスワード変更</Text>
            <TextInput
              style={styles.passwordInput}
              placeholder="新しいパスワード"
              placeholderTextColor="#B8AFA8"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setPasswordVisible(false)}>
                <Text style={styles.cancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.okBtn} onPress={savePassword}>
                <Text style={styles.okText}>変更</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={gradeChoiceVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>学年一括変更</Text>
            <Text style={styles.modalSub}>操作を選んでください</Text>
            <TouchableOpacity style={[styles.longActionBtn, { backgroundColor: '#4CAF50' }]} onPress={() => prepareGradeChange('up')}>
              <Text style={styles.longActionText}>進級する</Text>
              <Text style={styles.longActionSub}>小6は「卒業」になります</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.longActionBtn, { backgroundColor: '#FF9800' }]} onPress={() => prepareGradeChange('down')}>
              <Text style={styles.longActionText}>学年を1つ下げる</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 8 }]} onPress={() => setGradeChoiceVisible(false)}>
              <Text style={styles.cancelText}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={gradePreviewVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalBox, { maxHeight: '82%' }]}>
            <Text style={styles.modalTitle}>変更内容の確認</Text>
            <Text style={styles.modalSub}>{gradePreview.length}名の学年を変更します</Text>
            {gradeLoading ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 20 }} />
            ) : (
              <ScrollView style={styles.previewList}>
                {gradePreview.map(item => (
                  <View key={item.id} style={styles.previewRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewName}>{item.name || '名称未設定'}</Text>
                      <Text style={styles.previewRole}>{item.role}</Text>
                    </View>
                    <Text style={styles.previewGrade}>{item.oldGrade}</Text>
                    <Ionicons name="arrow-forward" size={16} color="#9A8F86" />
                    <Text style={[styles.previewGradeNext, item.newGrade === '卒業' && { color: '#E53935' }]}>{item.newGrade}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setGradePreviewVisible(false)}>
                <Text style={styles.cancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.okBtn, gradeLoading && { opacity: 0.5 }]} onPress={executeGradeChange} disabled={gradeLoading}>
                <Text style={styles.okText}>{gradeLoading ? '更新中...' : '実行'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={dialog.visible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.dialogBox}>
            <Text style={styles.modalTitle}>{dialog.title}</Text>
            {!!dialog.message && <Text style={styles.dialogMessage}>{dialog.message}</Text>}
            <View style={styles.modalActions}>
              {dialog.confirm && (
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setDialog({ visible: false, title: '' })}>
                  <Text style={styles.cancelText}>キャンセル</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.okBtn}
                onPress={() => {
                  const action = dialog.onConfirm;
                  setDialog({ visible: false, title: '' });
                  if (action) action();
                }}
              >
                <Text style={styles.okText}>{dialog.confirm ? 'OK' : '閉じる'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <AdminBottomNav active="menu" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderColor: '#F1E3D2',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8F0',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    marginRight: 38,
    fontSize: 20,
    fontWeight: '900',
    color: '#3F302B',
  },
  content: {
    padding: 12,
    paddingBottom: 120,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#3F302B',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  card: {
    width: '31.7%',
    minHeight: 108,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F1E3D2',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingTop: 9,
    paddingBottom: 11,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#8B7340',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 2,
  },
  iconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  cardImage: {
    width: 70,
    height: 70,
    marginBottom: 2,
  },
  cardText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#3F302B',
    textAlign: 'center',
    lineHeight: 16,
  },
  cardChevron: {
    position: 'absolute',
    right: 7,
    top: '50%',
    marginTop: -9,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 18,
  },
  dialogBox: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 18,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#3F302B',
    textAlign: 'center',
  },
  modalSub: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A7A6F',
    textAlign: 'center',
    marginTop: 5,
    marginBottom: 14,
  },
  dialogMessage: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6F5A50',
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 10,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#F4F1ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  okBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: '#00AEB8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#7A7069',
  },
  okText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  periodInputWrap: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#6F5A50',
    marginBottom: 5,
  },
  periodInput: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EADBC6',
    backgroundColor: '#FFF8F0',
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '900',
    color: '#3F302B',
  },
  periodWave: {
    fontSize: 20,
    fontWeight: '900',
    color: '#8A7A6F',
    marginTop: 20,
  },
  passwordInput: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EADBC6',
    backgroundColor: '#FFF8F0',
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#3F302B',
    marginTop: 16,
  },
  longActionBtn: {
    minHeight: 58,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  longActionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  longActionSub: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  previewList: {
    maxHeight: 330,
    marginTop: 8,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    backgroundColor: '#FFF8F0',
    borderWidth: 1,
    borderColor: '#F1E3D2',
    padding: 10,
    marginBottom: 7,
  },
  previewName: {
    fontSize: 13,
    fontWeight: '900',
    color: '#3F302B',
  },
  previewRole: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9A8F86',
    marginTop: 2,
  },
  previewGrade: {
    fontSize: 12,
    fontWeight: '800',
    color: '#7A7069',
  },
  previewGradeNext: {
    fontSize: 13,
    fontWeight: '900',
    color: '#26A65B',
  },
});
