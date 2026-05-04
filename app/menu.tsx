import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'crypto-js';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Image, ImageSourcePropType, Modal,
  Platform, SafeAreaView, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, TouchableWithoutFeedback, View
} from 'react-native';
import { db } from '../firebase';

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
  image, title, subtitle, bgColor, onPress, animValue,
}: {
  image: ImageSourcePropType;
  title: string;
  subtitle?: string;
  bgColor: string;
  onPress: () => void;
  animValue: Animated.Value;
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
        <Animated.View style={[styles.card, { backgroundColor: bgColor, transform: [{ scale }] }]}>
          <Image source={image} style={styles.cardImage} resizeMode="contain" />
          <View style={styles.cardLabelWrap}>
            <Text style={styles.cardTitle}>{title}</Text>
            {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
          </View>
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

  const headerAnim = useRef(new Animated.Value(0)).current;
  const cardAnims = useRef(Array.from({ length: 8 }, () => new Animated.Value(0))).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;

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
            {/* 雲の装飾 */}
            <View style={[styles.cloud, { top: 14, left: 16, width: 72, height: 22 }]} />
            <View style={[styles.cloud, { top: 30, left: 78, width: 52, height: 16, opacity: 0.5 }]} />
            <View style={[styles.cloud, { top: 18, right: 60, width: 48, height: 16, opacity: 0.6 }]} />
            <View style={[styles.cloud, { top: 34, right: 10, width: 36, height: 12, opacity: 0.45 }]} />

            {/* ☰ ボタン：最前面に固定 */}
            <TouchableOpacity onPress={openSettings} style={styles.menuBtn}>
              <Text style={{ fontSize: 20 }}>☰</Text>
            </TouchableOpacity>

            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>ケーニーズ学童保育</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 }}>
                <Text style={styles.headerGreeting}>
                  こんにちは！{name || 'ゲスト'}さん
                </Text>
                <Animated.Text style={[{ fontSize: 16 }, waveStyle]}>👋</Animated.Text>
              </View>
            </View>

            {/* クマの装飾 */}
            <Animated.View style={[styles.bearDecoration, floatStyle]}>
              <Image source={ANIMALS.bear} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            </Animated.View>
          </View>
        </Animated.View>

        {/* ── セクションラベル ── */}
        <View style={styles.sectionLabelWrap}>
          <Text style={styles.sectionLabel}>📋 きょうのメニュー</Text>
        </View>

        {/* ── メニューグリッド ── */}
        <View style={styles.grid}>
          {role === 'user' ? (
            <>
              <View style={styles.gridRow}>
                <MenuCard
                  image={ANIMALS.dolphin} title="利用日・習い事" subtitle="予定を見る" bgColor="#87CEEB"
                  onPress={() => router.push({ pathname: '/schedule', params: { name: name || '' } } as any)}
                  animValue={cardAnims[0]}
                />
                <MenuCard
                  image={ANIMALS.rabbit} title="アルバム" subtitle="思い出の写真" bgColor="#C9AADF"
                  onPress={() => router.push({ pathname: '/album', params: { role: role || '', name: name || '' } } as any)}
                  animValue={cardAnims[1]}
                />
              </View>
              <View style={styles.gridRow}>
                <MenuCard
                  image={ANIMALS.chick} title="イベント参加" subtitle="行事の予定" bgColor="#F5DCA8"
                  onPress={() => router.push({ pathname: '/event-list', params: { name: name || '' } } as any)}
                  animValue={cardAnims[2]}
                />
                <MenuCard
                  image={ANIMALS.koala} title="メッセージ" subtitle="先生に連絡" bgColor="#C9AADF"
                  onPress={() => router.push('/messages' as any)}
                  animValue={cardAnims[3]}
                />
              </View>
            </>
          ) : (
            <>
              <View style={styles.gridRow}>
                <MenuCard
                  image={ANIMALS.cat} title="出欠一覧" subtitle="今日の出席を確認" bgColor="#EFA060"
                  onPress={() => router.push('/attendance')}
                  animValue={cardAnims[0]}
                />
                <MenuCard
                  image={ANIMALS.chick} title="イベント管理" subtitle="行事の管理" bgColor="#F5DCA8"
                  onPress={() => router.push({ pathname: '/event-management', params: { role: role || '' } } as any)}
                  animValue={cardAnims[1]}
                />
              </View>
              <View style={styles.gridRow}>
                <MenuCard
                  image={ANIMALS.frog}
                  title={role === 'admin' ? 'シフト作成' : 'シフト提出'}
                  subtitle="シフトを管理"
                  bgColor="#B8DF78"
                  onPress={() =>
                    role === 'admin'
                      ? router.push('/shift-create')
                      : router.push({ pathname: '/shift', params: { name: name || '' } } as any)
                  }
                  animValue={cardAnims[2]}
                />
                <MenuCard
                  image={ANIMALS.dolphin} title="シフトを見る" subtitle="シフトを確認" bgColor="#87CEEB"
                  onPress={() => router.push({ pathname: '/shift-view', params: { name: name || '' } } as any)}
                  animValue={cardAnims[3]}
                />
              </View>
              <View style={styles.gridRow}>
                <MenuCard
                  image={ANIMALS.rabbit} title="アルバム" subtitle="思い出の写真" bgColor="#C9AADF"
                  onPress={() => router.push({ pathname: '/album', params: { role: role || '', name: name || '' } } as any)}
                  animValue={cardAnims[4]}
                />
                {role === 'admin'
                  ? <MenuCard
                      image={ANIMALS.panda} title="アカウント管理" subtitle="プロフィール設定" bgColor="#FAD2D2"
                      onPress={() => router.push('/account/list')}
                      animValue={cardAnims[5]}
                    />
                  : <MenuCard
                      image={ANIMALS.koala} title="メッセージ" subtitle="管理者に連絡" bgColor="#C9AADF"
                      onPress={() => router.push('/messages' as any)}
                      animValue={cardAnims[5]}
                    />
                }
              </View>
              {role === 'admin' && (
                <View style={styles.gridRow}>
                  <MenuCard
                    image={ANIMALS.koala} title="メッセージ" subtitle="利用者・スタッフと連絡" bgColor="#C9AADF"
                    onPress={() => router.push('/messages' as any)}
                    animValue={cardAnims[6]}
                  />
                  <View style={{ flex: 1 }} />
                </View>
              )}
            </>
          )}
        </View>


      </ScrollView>

      {/* ── 設定ドロワー ── */}
      {settingsVisible && (
        <View style={styles.drawerOverlay}>
          <TouchableOpacity style={styles.drawerCloseArea} onPress={closeSettings} />
          <Animated.View style={[styles.drawerContent, { transform: [{ translateX: slideAnim }] }]}>
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>⚙️ 設定メニュー</Text>
              <TouchableOpacity onPress={closeSettings}>
                <Text style={{ fontSize: 24, color: '#5D4037' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.drawerScroll}>
              {role === 'admin' && (
                <>
                  <Text style={styles.drawerSectionTitle}>【管理者専用】</Text>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => { closeSettings(); router.push('/school-times'); }}>
                    <Text style={styles.drawerIcon}>⏰</Text>
                    <Text style={styles.drawerItemText}>学校別下校時刻</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => { closeSettings(); router.push('/holidays-setting'); }}>
                    <Text style={styles.drawerIcon}>📅</Text>
                    <Text style={styles.drawerItemText}>長期休み設定</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => { closeSettings(); router.push('/lesson-management' as any); }}>
                    <Text style={styles.drawerIcon}>📚</Text>
                    <Text style={styles.drawerItemText}>習い事一覧</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => { closeSettings(); setPeriodModal(true); }}>
                    <Text style={styles.drawerIcon}>📆</Text>
                    <Text style={styles.drawerItemText}>シフト入力期間の設定</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.drawerItem} onPress={() => { closeSettings(); customAlert('集計機能', 'スタッフ別の合計勤務時間を集計する画面へ遷移します。'); }}>
                    <Text style={styles.drawerIcon}>⏱️</Text>
                    <Text style={styles.drawerItemText}>スタッフ別合計勤務時間</Text>
                  </TouchableOpacity>
                  <View style={{ height: 1, backgroundColor: '#E8DDD0', marginVertical: 16 }} />
                </>
              )}
              {role !== 'admin' && (
                <TouchableOpacity style={styles.drawerItem} onPress={openPasswordModal}>
                  {fetchingDocId
                    ? <ActivityIndicator size="small" color="#D4AF37" style={{ marginRight: 16 }} />
                    : <Text style={styles.drawerIcon}>🔒</Text>
                  }
                  <Text style={styles.drawerItemText}>パスワード変更</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.drawerItem, { borderBottomWidth: 0, marginTop: 20 }]} onPress={handleLogout}>
                <Text style={styles.drawerIcon}>🚪</Text>
                <Text style={[styles.drawerItemText, { color: '#E74C3C', fontWeight: 'bold' }]}>ログアウト</Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        </View>
      )}

      <Modal visible={periodModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>📆 シフト入力期間の設定</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 20 }}>
              <TextInput style={styles.numInput} value={startDay} onChangeText={setStartDay} keyboardType="number-pad" />
              <Text style={{ marginHorizontal: 10, color: '#5D4037' }}>日 〜 </Text>
              <TextInput style={styles.numInput} value={endDay} onChangeText={setEndDay} keyboardType="number-pad" />
              <Text style={{ marginLeft: 10, color: '#5D4037' }}>日</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#CCC' }]} onPress={() => setPeriodModal(false)}>
                <Text style={{ color: '#555' }}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#D4AF37' }]} onPress={saveShiftPeriod}>
                <Text style={{ color: '#FFF', fontWeight: 'bold' }}>保存</Text>
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
              placeholder="新しいパスワード"
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
    backgroundColor: '#AEE4F5',
    paddingTop: 20,
    paddingBottom: 52,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    position: 'relative',
    overflow: 'hidden',
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
  headerContent: {
    marginTop: 10,
    paddingRight: 48,
  },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#5D4037' },
  headerGreeting: { fontSize: 14, color: '#5D4037', fontWeight: '600' },
  bearDecoration: {
    position: 'absolute',
    width: 88,
    height: 88,
    bottom: -8,
    right: 20,
    zIndex: 1,
  },

  // ── セクションラベル ──
  sectionLabelWrap: { paddingHorizontal: 18, paddingTop: 22, paddingBottom: 12 },
  sectionLabel: { fontSize: 16, fontWeight: 'bold', color: '#5D4037' },

  // ── グリッド ──
  grid: { paddingHorizontal: 14, gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12 },

  // ── カード ──
  card: {
    flex: 1,
    borderRadius: 22,
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    shadowColor: '#8B7340',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 5,
    minHeight: 140,
    justifyContent: 'space-between',
  },
  cardImage: { width: 76, height: 76 },
  cardLabelWrap: { width: '100%', alignItems: 'center', paddingBottom: 2 },
  cardTitle: { fontSize: 14, fontWeight: 'bold', color: '#5D4037', textAlign: 'center' },
  cardSubtitle: { fontSize: 11, color: '#8D6E63', textAlign: 'center', marginTop: 2 },

  // ── ドロワー ──
  drawerOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(45,42,34,0.5)', zIndex: 100, flexDirection: 'row',
  },
  drawerCloseArea: { flex: 1 },
  drawerContent: {
    width: width * 0.75, backgroundColor: '#FFF8F0', height: '100%',
    shadowColor: '#000', shadowOpacity: 0.2, elevation: 20,
  },
  drawerHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderColor: '#E8DDD0', paddingTop: 60,
  },
  drawerTitle: { fontSize: 20, fontWeight: 'bold', color: '#5D4037' },
  drawerScroll: { padding: 20 },
  drawerSectionTitle: { fontSize: 11, fontWeight: 'bold', color: '#D4AF37', marginBottom: 12, letterSpacing: 1 },
  drawerItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderColor: '#E8DDD0',
  },
  drawerIcon: { fontSize: 20, marginRight: 16 },
  drawerItemText: { fontSize: 14, color: '#5D4037' },

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
