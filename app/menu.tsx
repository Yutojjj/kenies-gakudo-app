import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'crypto-js';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Modal,
  Platform, SafeAreaView, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, TouchableWithoutFeedback, View
} from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

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

// ── プレスアニメーション付きカード ──
function AnimatedCard({
  onPress, style, children
}: { onPress: () => void; style?: any; children: React.ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.94, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
  return (
    <TouchableWithoutFeedback onPress={onPress} onPressIn={pressIn} onPressOut={pressOut}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </TouchableWithoutFeedback>
  );
}

// ── カテゴリーセクション ──
function CategorySection({ label, icon, children }: { label: string; icon: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.wrapper}>
      <View style={sectionStyles.header}>
        <View style={sectionStyles.headerLine} />
        <View style={sectionStyles.labelWrap}>
          <Ionicons name={icon as any} size={12} color={COLORS.primary} />
          <Text style={sectionStyles.label}>{label}</Text>
        </View>
        <View style={sectionStyles.headerLine} />
      </View>
      <View style={sectionStyles.row}>{children}</View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  wrapper: { marginBottom: 20 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  headerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  labelWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 5 },
  label: { fontSize: 11, fontWeight: 'bold', color: COLORS.primary, letterSpacing: 1.5, textTransform: 'uppercase' },
  row: { flexDirection: 'row', gap: 12 },
});

export default function MenuScreen() {
  const router = useRouter();
  const { role, name } = useLocalSearchParams<{ role: string; name: string }>();

  const userDocIdRef = useRef<string>('');
  const [fetchingDocId, setFetchingDocId] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [slideAnim] = useState(new Animated.Value(width));
  const [periodModal, setPeriodModal] = useState(false);
  const [startDay, setStartDay] = useState('1');
  const [endDay, setEndDay] = useState('15');
  const [passwordModal, setPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  // 入場アニメーション
  const headerAnim = useRef(new Animated.Value(0)).current;
  const cardAnims = useRef(Array.from({ length: 6 }, () => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(headerAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.stagger(80, cardAnims.map(a =>
        Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 8 })
      )),
    ]).start();
  }, []);

  const animStyle = (index: number) => ({
    opacity: cardAnims[index],
    transform: [{ translateY: cardAnims[index].interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
  });

  const openSettings = () => {
    setSettingsVisible(true);
    Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
  };
  const closeSettings = () => {
    Animated.timing(slideAnim, { toValue: width, duration: 300, useNativeDriver: true }).start(() => setSettingsVisible(false));
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
    if (role === 'admin') { customAlert('エラー', '管理者のパスワードはこの画面からは変更できません。'); return; }
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
      await setDoc(doc(db, 'accounts', userDocIdRef.current), { generatedPw: hashedPassword, password: hashedPassword }, { merge: true });
      customAlert('変更完了', 'パスワードを変更しました。次回から新しいパスワードでログインしてください。');
      setPasswordModal(false);
      setNewPassword('');
    } catch (e) { customAlert('エラー', 'パスワード変更に失敗しました。'); }
  };

  // ── カード定義 ──
  const menuCard = (
    index: number,
    onPress: () => void,
    iconName: string,
    iconColor: string,
    bgColor: string,
    accentColor: string,
    label: string
  ) => (
    <Animated.View key={label} style={[{ flex: 1 }, animStyle(index)]}>
      <AnimatedCard onPress={onPress} style={[styles.card, { backgroundColor: bgColor }]}>
        <View style={[styles.cardAccent, { backgroundColor: accentColor + '40' }]} />
        <View style={[styles.iconWrap, { backgroundColor: accentColor + '25' }]}>
          <Ionicons name={iconName as any} size={30} color={iconColor} />
        </View>
        <Text style={[styles.cardLabel, { color: iconColor }]} numberOfLines={2}>{label}</Text>
        <View style={[styles.cardFooterLine, { backgroundColor: accentColor }]} />
      </AnimatedCard>
    </Animated.View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── ヘッダー ── */}
        <Animated.View style={[styles.header, {
          opacity: headerAnim,
          transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }]
        }]}>
          <View style={styles.headerBg}>
            <View style={styles.headerRow}>
              <View style={styles.headerTextWrap}>
                <Text style={styles.headerSub}>ケーニーズ学童クラブ</Text>
                <Text style={styles.headerTitle}>Kenie's System</Text>
                {name && (
                  <View style={styles.nameBadge}>
                    <Ionicons name="person-circle" size={14} color={COLORS.primary} />
                    <Text style={styles.nameBadgeText}>{name} 様</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={openSettings} style={styles.menuBtn}>
                <Ionicons name="menu" size={26} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>

        <View style={styles.body}>
          {role === 'user' ? (
            // ── 利用者メニュー（変更なし）──
            <View>
              <CategorySection label="メニュー" icon="grid-outline">
                {menuCard(0, () => router.push({ pathname: '/schedule', params: { name: name || '' } } as any), 'calendar-outline', '#D87093', '#FFF0EE', '#D87093', '利用日・習い事')}
                {menuCard(1, () => router.push({ pathname: '/album', params: { role: role || '', name: name || '' } } as any), 'images-outline', '#9370DB', '#F3F0FF', '#9370DB', 'アルバム')}
              </CategorySection>
              <CategorySection label="" icon="ellipsis-horizontal">
                {menuCard(2, () => router.push({ pathname: '/event-list', params: { name: name || '' } } as any), 'ticket-outline', '#DAA520', '#FFFBEE', '#DAA520', 'イベント参加')}
                <View style={{ flex: 1 }} />
              </CategorySection>
            </View>
          ) : (
            // ── 管理者・スタッフメニュー ──
            <View>
              <CategorySection label="業務・管理" icon="briefcase-outline">
                {menuCard(0, () => router.push('/attendance'), 'people-outline', '#C0392B', '#FFF5F5', '#E74C3C', '出欠一覧')}
                {menuCard(1, () => router.push({ pathname: '/event-management', params: { role: role || '' } } as any), 'flag-outline', '#16A085', '#F0FFFE', '#1ABC9C', 'イベント管理')}
              </CategorySection>

              <CategorySection label="シフト" icon="calendar-outline">
                {role === 'admin'
                  ? menuCard(2, () => router.push('/shift-create'), 'create-outline', '#2471A3', '#EEF6FF', '#3498DB', '作成')
                  : menuCard(2, () => router.push({ pathname: '/shift', params: { name: name || '' } } as any), 'time-outline', '#2471A3', '#EEF6FF', '#3498DB', '提出')
                }
                {menuCard(3, () => router.push({ pathname: '/shift-view', params: { name: name || '' } } as any), 'grid-outline', '#1A5276', '#EAF2FF', '#2980B9', '見る')}
              </CategorySection>

              <CategorySection label="その他" icon="ellipsis-horizontal">
                {menuCard(4, () => router.push({ pathname: '/album', params: { role: role || '', name: name || '' } } as any), 'images-outline', '#7D3C98', '#F8F0FF', '#9B59B6', 'アルバム')}
                {role === 'admin'
                  ? menuCard(5, () => router.push('/account/list'), 'key-outline', '#B7770D', '#FFFBF0', '#D4AF37', 'アカウント管理')
                  : <View style={{ flex: 1 }} />
                }
              </CategorySection>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── 設定ドロワー ── */}
      {settingsVisible && (
        <View style={styles.drawerOverlay}>
          <TouchableOpacity style={styles.drawerCloseArea} onPress={closeSettings} />
          <Animated.View style={[styles.drawerContent, { transform: [{ translateX: slideAnim }] }]}>
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>設定メニュー</Text>
              <TouchableOpacity onPress={closeSettings}><Ionicons name="close" size={28} color={COLORS.text} /></TouchableOpacity>
            </View>
            <ScrollView style={styles.drawerScroll}>
              {role === 'admin' && (
                <>
                  <Text style={styles.drawerSectionTitle}>【管理者専用】</Text>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => { closeSettings(); router.push('/school-times'); }}>
                    <Ionicons name="alarm-outline" size={20} color={COLORS.primary} style={styles.drawerIcon} />
                    <Text style={styles.drawerItemText}>学校別下校時刻</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => { closeSettings(); router.push('/holidays-setting'); }}>
                    <Ionicons name="calendar-clear-outline" size={20} color={COLORS.primary} style={styles.drawerIcon} />
                    <Text style={styles.drawerItemText}>長期休み設定</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => { closeSettings(); router.push('/lesson-management' as any); }}>
                    <Ionicons name="book-outline" size={20} color={COLORS.primary} style={styles.drawerIcon} />
                    <Text style={styles.drawerItemText}>習い事一覧</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => { closeSettings(); setPeriodModal(true); }}>
                    <Ionicons name="calendar-outline" size={20} color={COLORS.primary} style={styles.drawerIcon} />
                    <Text style={styles.drawerItemText}>シフト入力期間の設定</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => { closeSettings(); customAlert('集計機能', 'スタッフ別の合計勤務時間を集計する画面へ遷移します。'); }}>
                    <Ionicons name="time-outline" size={20} color={COLORS.primary} style={styles.drawerIcon} />
                    <Text style={styles.drawerItemText}>スタッフ別合計勤務時間</Text>
                  </TouchableOpacity>
                  <View style={{ height: 1, backgroundColor: COLORS.border, marginVertical: 16 }} />
                </>
              )}
              {role !== 'admin' && (
                <TouchableOpacity style={styles.drawerItem} onPress={openPasswordModal}>
                  {fetchingDocId
                    ? <ActivityIndicator size="small" color={COLORS.primary} style={styles.drawerIcon} />
                    : <Ionicons name="lock-closed-outline" size={24} color={COLORS.primary} style={styles.drawerIcon} />
                  }
                  <Text style={styles.drawerItemText}>パスワード変更</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.drawerItem, { borderBottomWidth: 0, marginTop: 20 }]} onPress={handleLogout}>
                <Ionicons name="log-out-outline" size={24} color={COLORS.danger} style={styles.drawerIcon} />
                <Text style={[styles.drawerItemText, { color: COLORS.danger, fontWeight: 'bold' }]}>ログアウト</Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        </View>
      )}

      <Modal visible={periodModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>シフト入力期間の設定</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 20 }}>
              <TextInput style={styles.numInput} value={startDay} onChangeText={setStartDay} keyboardType="number-pad" />
              <Text style={{ marginHorizontal: 10 }}>日 〜 </Text>
              <TextInput style={styles.numInput} value={endDay} onChangeText={setEndDay} keyboardType="number-pad" />
              <Text style={{ marginLeft: 10 }}>日</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#CCC' }]} onPress={() => setPeriodModal(false)}><Text>キャンセル</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: COLORS.primary }]} onPress={saveShiftPeriod}><Text style={{ color: COLORS.white, fontWeight: 'bold' }}>保存</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={passwordModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>パスワード変更</Text>
            <TextInput style={[styles.input, { marginVertical: 20 }]} placeholder="新しいパスワード" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#CCC' }]} onPress={() => setPasswordModal(false)}><Text>キャンセル</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: COLORS.primary }]} onPress={savePassword}><Text style={{ color: COLORS.white, fontWeight: 'bold' }}>変更</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F7' },
  scrollContent: { paddingBottom: 48 },

  // ── ヘッダー ──
  header: { marginBottom: 24 },
  headerBg: {
    backgroundColor: '#FFFDF5',
    paddingTop: 24, paddingBottom: 28,
    paddingHorizontal: 24,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.primary + '40',
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center',
  },
  headerTextWrap: { flex: 1, paddingRight: 12 },
  headerSub: { fontSize: 10, color: COLORS.secondary, letterSpacing: 2, fontWeight: '600', marginBottom: 4 },
  headerTitle: { fontSize: 26, fontWeight: 'bold', color: COLORS.primary, letterSpacing: 0.5 },
  nameBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary + '25',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1, borderColor: COLORS.primary + '60',
  },
  nameBadgeText: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },
  menuBtn: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1, borderColor: COLORS.primary + '50',
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },

  // ── ボディ ──
  body: { paddingHorizontal: 18 },

  // ── カード ──
  card: {
    flex: 1,
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: '#8B7340',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
    minHeight: 120,
    justifyContent: 'center',
  },
  cardAccent: {
    position: 'absolute', top: -20, right: -20,
    width: 70, height: 70, borderRadius: 35,
  },
  iconWrap: {
    width: 58, height: 58, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 10,
  },
  cardLabel: {
    fontSize: 13, fontWeight: 'bold',
    textAlign: 'center', lineHeight: 18,
    flexShrink: 1,
  },
  cardFooterLine: {
    height: 3, width: 28, borderRadius: 2, marginTop: 10,
  },

  // ── ドロワー ──
  drawerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(45,42,34,0.5)', zIndex: 100, flexDirection: 'row' },
  drawerCloseArea: { flex: 1 },
  drawerContent: { width: width * 0.75, backgroundColor: COLORS.white, height: '100%', shadowColor: '#8B7340', shadowOpacity: 0.2, elevation: 20 },
  drawerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderColor: COLORS.border, paddingTop: 60 },
  drawerTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  drawerScroll: { padding: 20 },
  drawerSectionTitle: { fontSize: 11, fontWeight: 'bold', color: COLORS.primary, marginBottom: 12, letterSpacing: 1 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderColor: COLORS.border },
  drawerIcon: { marginRight: 16 },
  drawerItemText: { fontSize: 14, color: COLORS.text },

  // ── モーダル ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(45,42,34,0.55)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.white, padding: 24, borderRadius: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', color: COLORS.text },
  modalBtn: { flex: 1, padding: 16, alignItems: 'center', borderRadius: 10 },
  numInput: { borderWidth: 1, borderColor: COLORS.border, padding: 12, borderRadius: 8, width: 60, textAlign: 'center', fontSize: 18 },
  input: { borderWidth: 1, borderColor: COLORS.border, padding: 16, borderRadius: 8, fontSize: 16 },
});