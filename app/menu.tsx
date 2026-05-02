import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

const { width } = Dimensions.get('window');

export default function MenuScreen() {
  const router = useRouter();
  const { role, name } = useLocalSearchParams<{ role: string, name: string }>();
  
  // ▼ 修正①: userDocId の取得をパスワード変更時だけ行う（初期ロード不要）▼
  const userDocIdRef = useRef<string>('');
  const [fetchingDocId, setFetchingDocId] = useState(false);

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [slideAnim] = useState(new Animated.Value(width));

  const [periodModal, setPeriodModal] = useState(false);
  const [startDay, setStartDay] = useState('1');
  const [endDay, setEndDay] = useState('15');
  const [passwordModal, setPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const openSettings = () => {
    setSettingsVisible(true);
    Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
  };
  const closeSettings = () => {
    Animated.timing(slideAnim, { toValue: width, duration: 300, useNativeDriver: true }).start(() => setSettingsVisible(false));
  };

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      if (window.confirm('ログアウトしますか？')) {
        await AsyncStorage.removeItem('loggedInUser');
        router.replace('/');
      }
      return;
    }
    Alert.alert('ログアウト', 'ログアウトしますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: 'ログアウト', style: 'destructive', onPress: async () => { await AsyncStorage.removeItem('loggedInUser'); router.replace('/'); }}
    ]);
  };

  const saveShiftPeriod = async () => {
    try {
      await setDoc(doc(db, 'settings', 'shift_period'), { start: startDay, end: endDay });
      Alert.alert('保存完了', `毎月 ${startDay}日 〜 ${endDay}日 を提出期間に設定しました。`);
      setPeriodModal(false);
    } catch (e) {
      Alert.alert('エラー', '保存に失敗しました');
    }
  };

  // ▼ 修正②: パスワードモーダルを開く際に userDocId を遅延取得 ▼
  const openPasswordModal = async () => {
    if (!userDocIdRef.current && name) {
      setFetchingDocId(true);
      try {
        const q = query(collection(db, 'accounts'), where('name', '==', name));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          userDocIdRef.current = snapshot.docs[0].id;
        }
      } catch (error) {
        console.error('ユーザー取得エラー:', error);
      } finally {
        setFetchingDocId(false);
      }
    }
    setPasswordModal(true);
  };

  const savePassword = async () => {
    if (!newPassword) return;
    if (!userDocIdRef.current) {
      Alert.alert('エラー', 'ユーザー情報の取得に失敗しました。');
      return;
    }
    try {
      await setDoc(doc(db, 'accounts', userDocIdRef.current), { generatedPw: newPassword, password: newPassword }, { merge: true });
      Alert.alert('変更完了', 'パスワードを変更しました。');
      setPasswordModal(false);
      setNewPassword('');
    } catch (e) {
      Alert.alert('エラー', 'パスワード変更に失敗しました。');
    }
  };

  // ▼ 修正③: loading スピナーを削除 → メニューを即時表示 ▼

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerArea}>
          <View style={styles.headerTopRow}>
            <View style={{ flex: 1 }} />
            <View style={styles.headerCenter}><Text style={styles.headerTitle}>Kenie's System</Text><Text style={styles.headerSubtitle}>ケーニーズ学童クラブ</Text></View>
            <View style={styles.headerRight}>{role !== 'user' && (<TouchableOpacity onPress={openSettings} style={styles.settingsBtn}><Ionicons name="menu" size={32} color={COLORS.primary} /></TouchableOpacity>)}</View>
          </View>
          {name && <View style={styles.welcomeBadge}><Text style={styles.welcomeText}>{name} 様</Text></View>}
        </View>

        {role === 'user' ? (
          <View style={styles.menuContainer}>
            <View style={styles.grid2x2}>
              <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#FFE4E1' }]} onPress={() => router.push({ pathname: '/schedule', params: { name: name || '' } } as any)}>
                <View style={styles.iconCircle}><Ionicons name="calendar-outline" size={32} color="#D87093" /></View><Text style={styles.gridTitle}>利用日・習い事{"\n"}変更</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#E0FFFF' }]} onPress={() => {}}>
                <View style={styles.iconCircle}><Ionicons name="today-outline" size={32} color="#4682B4" /></View><Text style={styles.gridTitle}>カレンダー</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#E6E6FA' }]} onPress={() => router.push({ pathname: '/album', params: { role: role || '', name: name || '' } } as any)}>
                <View style={styles.iconCircle}><Ionicons name="images-outline" size={32} color="#9370DB" /></View><Text style={styles.gridTitle}>アルバム</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#FFFACD' }]} onPress={() => router.push({ pathname: '/event-list', params: { name: name || '' } } as any)}>
                <View style={styles.iconCircle}><Ionicons name="ticket-outline" size={32} color="#DAA520" /></View><Text style={styles.gridTitle}>イベント参加</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.menuContainer}>
            <View style={styles.grid2x2}>
              <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#FFE4E1' }]} onPress={() => router.push('/attendance')}>
                <View style={styles.iconCircle}><Ionicons name="people-outline" size={32} color="#D87093" /></View><Text style={styles.gridTitle}>出欠一覧</Text>
              </TouchableOpacity>
              {role === 'admin' ? (
                <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#E0FFFF' }]} onPress={() => router.push('/shift-create')}>
                  <View style={styles.iconCircle}><Ionicons name="calendar-outline" size={32} color="#4682B4" /></View><Text style={styles.gridTitle}>シフト作成</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#E0FFFF' }]} onPress={() => router.push({ pathname: '/shift', params: { name: name || '' } } as any)}>
                  <View style={styles.iconCircle}><Ionicons name="time-outline" size={32} color="#4682B4" /></View><Text style={styles.gridTitle}>シフト提出</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#E6E6FA' }]} onPress={() => router.push({ pathname: '/album', params: { role: role || '', name: name || '' } } as any)}>
                <View style={styles.iconCircle}><Ionicons name="images-outline" size={32} color="#9370DB" /></View><Text style={styles.gridTitle}>アルバム</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#F0FFF0' }]} onPress={() => router.push('/user-list')}>
                <View style={styles.iconCircle}><Ionicons name="school-outline" size={32} color="#2E8B57" /></View><Text style={styles.gridTitle}>学校別利用者</Text>
              </TouchableOpacity>
            </View>

            {role === 'admin' && (
              <View style={{ marginTop: 24, borderTopWidth: 1, borderColor: COLORS.border, paddingTop: 24 }}>
                <Text style={{ fontSize: 12, color: COLORS.danger, fontWeight: 'bold', marginBottom: 16, textAlign: 'center' }}>※管理者専用メニュー</Text>
                <View style={styles.grid2x2}>
                  <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#FFFACD', width: '48%' }]} onPress={() => router.push('/school-times')}>
                    <View style={styles.iconCircle}><Ionicons name="alarm-outline" size={32} color="#DAA520" /></View><Text style={styles.gridTitle}>学校別下校時刻</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#FFE4E1', width: '48%' }]} onPress={() => router.push('/account/list')}>
                    <View style={styles.iconCircle}><Ionicons name="key-outline" size={32} color="#D87093" /></View><Text style={styles.gridTitle}>アカウント管理</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#E0FFFF', width: '48%' }]} onPress={() => {}}>
                    <View style={styles.iconCircle}><Ionicons name="bus-outline" size={32} color="#4682B4" /></View><Text style={styles.gridTitle}>送迎一覧</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#FFE4B5', width: '48%' }]} onPress={() => router.push('/holidays-setting')}>
                    <View style={styles.iconCircle}><Ionicons name="calendar-clear-outline" size={32} color="#FF8C00" /></View><Text style={styles.gridTitle}>長期休み設定</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.gridCard, { backgroundColor: '#F5FFFA', width: '100%' }]} onPress={() => router.push('/event-management')}>
                    <View style={styles.iconCircle}><Ionicons name="flag-outline" size={32} color="#20B2AA" /></View><Text style={styles.gridTitle}>イベント管理</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {settingsVisible && (
        <View style={styles.drawerOverlay}>
          <TouchableOpacity style={styles.drawerCloseArea} onPress={closeSettings} />
          <Animated.View style={[styles.drawerContent, { transform: [{ translateX: slideAnim }] }]}>
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>設定メニュー</Text><TouchableOpacity onPress={closeSettings}><Ionicons name="close" size={28} color={COLORS.text} /></TouchableOpacity>
            </View>
            <ScrollView style={styles.drawerScroll}>
              <TouchableOpacity style={styles.drawerItem} onPress={() => setPeriodModal(true)}><Ionicons name="calendar-outline" size={24} color={COLORS.primary} style={styles.drawerIcon} /><Text style={styles.drawerItemText}>シフトの入力期間の設定</Text></TouchableOpacity>
              <TouchableOpacity style={styles.drawerItem} onPress={() => Alert.alert('集計機能', 'スタッフ別の合計勤務時間を集計する画面へ遷移します。')}><Ionicons name="time-outline" size={24} color={COLORS.primary} style={styles.drawerIcon} /><Text style={styles.drawerItemText}>スタッフ別合計勤務時間</Text></TouchableOpacity>
              <TouchableOpacity style={styles.drawerItem} onPress={openPasswordModal}>
                {fetchingDocId
                  ? <ActivityIndicator size="small" color={COLORS.primary} style={styles.drawerIcon} />
                  : <Ionicons name="lock-closed-outline" size={24} color={COLORS.primary} style={styles.drawerIcon} />
                }
                <Text style={styles.drawerItemText}>パスワード変更</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.drawerItem, { borderBottomWidth: 0, marginTop: 40 }]} onPress={handleLogout}><Ionicons name="log-out-outline" size={24} color={COLORS.danger} style={styles.drawerIcon} /><Text style={[styles.drawerItemText, { color: COLORS.danger, fontWeight: 'bold' }]}>ログアウト</Text></TouchableOpacity>
            </ScrollView>
          </Animated.View>
        </View>
      )}

      <Modal visible={periodModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>シフト入力期間の設定</Text>
            <View style={{flexDirection:'row', alignItems:'center', justifyContent:'center', marginVertical: 20}}>
              <TextInput style={styles.numInput} value={startDay} onChangeText={setStartDay} keyboardType="number-pad" /><Text style={{marginHorizontal: 10}}>日 〜 </Text>
              <TextInput style={styles.numInput} value={endDay} onChangeText={setEndDay} keyboardType="number-pad" /><Text style={{marginLeft: 10}}>日</Text>
            </View>
            <View style={{flexDirection:'row', gap: 12}}>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: '#CCC'}]} onPress={() => setPeriodModal(false)}><Text>キャンセル</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: COLORS.primary}]} onPress={saveShiftPeriod}><Text style={{color: COLORS.white, fontWeight:'bold'}}>保存</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={passwordModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>パスワード変更</Text>
            <TextInput style={[styles.input, {marginVertical: 20}]} placeholder="新しいパスワード" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
            <View style={{flexDirection:'row', gap: 12}}>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: '#CCC'}]} onPress={() => setPasswordModal(false)}><Text>キャンセル</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, {backgroundColor: COLORS.primary}]} onPress={savePassword}><Text style={{color: COLORS.white, fontWeight:'bold'}}>変更</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { paddingBottom: 40 },
  headerArea: { padding: 20, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border, marginBottom: 24 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerCenter: { alignItems: 'center', flex: 3 },
  headerRight: { flex: 1, alignItems: 'flex-end' },
  headerTitle: { fontSize: 24, color: COLORS.primary, fontWeight: 'bold', marginBottom: 4 },
  headerSubtitle: { fontSize: 12, color: COLORS.textLight, fontWeight: 'bold' },
  settingsBtn: { padding: 8 },
  welcomeBadge: { marginTop: 16, alignSelf: 'center', backgroundColor: COLORS.background, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: COLORS.accent },
  welcomeText: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  menuContainer: { paddingHorizontal: 20 },
  grid2x2: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridCard: { width: '48%', borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 3 },
  iconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.6)', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  gridTitle: { fontSize: 15, fontWeight: 'bold', color: '#333', textAlign: 'center', lineHeight: 22 },
  drawerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, flexDirection: 'row' },
  drawerCloseArea: { flex: 1 },
  drawerContent: { width: width * 0.75, backgroundColor: COLORS.white, height: '100%', shadowColor: '#000', shadowOpacity: 0.2, elevation: 20 },
  drawerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderColor: COLORS.border, paddingTop: 60 },
  drawerTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  drawerScroll: { padding: 20 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: COLORS.border },
  drawerIcon: { marginRight: 16 },
  drawerItemText: { fontSize: 16, color: COLORS.text },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.white, padding: 24, borderRadius: 16 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  modalBtn: { flex: 1, padding: 16, alignItems: 'center', borderRadius: 8 },
  numInput: { borderWidth: 1, borderColor: COLORS.border, padding: 12, borderRadius: 8, width: 60, textAlign: 'center', fontSize: 18 },
  input: { borderWidth: 1, borderColor: COLORS.border, padding: 16, borderRadius: 8, fontSize: 16 }
});