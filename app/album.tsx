import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db, storage } from '../firebase';

// --- 型定義 ---
type Mode = 'top' | 'add' | 'view';
type TabType = '月' | '火' | '水' | '木' | '金' | 'イベント';
const ALL_TABS: TabType[] = ['月', '火', '水', '木', '金', 'イベント'];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// ★ 追加: ローカル時間での日付文字列 (YYYY-MM-DD) を取得するヘルパー関数
const getLocalDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function AlbumScreen() {
  const router = useRouter();
  const { role, name } = useLocalSearchParams<{ role: string, name: string }>();

  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  
  const [mode, setMode] = useState<Mode>(role === 'user' ? 'view' : 'top');
  const [viewMonth, setViewMonth] = useState(new Date().getMonth() + 1);
  const [activeTab, setActiveTab] = useState<TabType>('月');
  
  const [selectedPhoto, setSelectedPhoto] = useState<{ id: string, uri: string, key: string, storagePath?: string } | null>(null);

  const [calendarModalVisible, setCalendarModalVisible] = useState(false);
  const [eventModalVisible, setEventModalVisible] = useState(false);
  const [eventNameInput, setEventNameInput] = useState('');
  const [pastDate, setPastDate] = useState(new Date());
  
  const [albumPhotos, setAlbumPhotos] = useState<Record<string, { id: string, uri: string, storagePath?: string }[]>>({});
  
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const fetchUser = async () => {
      if (role === 'user') {
        const q = query(collection(db, 'accounts'), where('role', '==', 'user'), where('name', '==', name));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const data = snap.docs[0].data();
          setUserData(data);
          const firstAllowedDay = ALL_TABS.find(t => t === 'イベント' || (data.days && data.days[t]));
          if (firstAllowedDay) setActiveTab(firstAllowedDay);
        }
      }
    };
    fetchUser();

    const qAlbums = query(collection(db, 'albums'));
    const unsubscribe = onSnapshot(qAlbums, (snapshot) => {
      const photosData: Record<string, { id: string, uri: string, storagePath?: string }[]> = {};
      snapshot.forEach(d => {
        const item = d.data();
        const key = item.category;
        if (!photosData[key]) photosData[key] = [];
        photosData[key].push({ id: d.id, uri: item.uri, storagePath: item.storagePath });
      });
      setAlbumPhotos(photosData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [role, name]);

  const toggleExpand = (key: string) => {
    setExpandedDates(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const pickImages = async (targetTitle: string, targetKey: string) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.6,
    });

    if (!result.canceled) {
      setIsUploading(true);
      try {
        let uploadedCount = 0;
        for (const asset of result.assets) {
          const response = await fetch(asset.uri);
          const blob = await response.blob();
          const filename = `photo_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
          const storagePath = `albums/${filename}`;
          const storageRef = ref(storage, storagePath);
          await uploadBytes(storageRef, blob);
          const downloadUrl = await getDownloadURL(storageRef);

          await addDoc(collection(db, 'albums'), {
            uri: downloadUrl,
            storagePath: storagePath,
            uploader: name || '不明',
            category: targetKey,
            createdAt: new Date()
          });
          uploadedCount++;
        }
        Alert.alert('アップロード完了', `${targetTitle} に ${uploadedCount} 枚の写真を保存しました。`);
      } catch (e) {
        console.error("Upload error:", e);
        Alert.alert('エラー', '画像のアップロードに失敗しました。');
      } finally {
        setIsUploading(false);
        setCalendarModalVisible(false);
        setEventModalVisible(false);
        setEventNameInput('');
      }
    }
  };

  // ★ 修正: toISOString() ではなく、ローカルの時刻文字列を使う
  const handleAddToday = () => {
    const todayStr = getLocalDateString(new Date());
    pickImages('今日', todayStr);
  };
  
  const handleAddPast = () => {
    const pastDateStr = getLocalDateString(pastDate);
    pickImages(pastDateStr, pastDateStr);
  };

  const handleAddEvent = () => {
    if (!eventNameInput.trim()) return Alert.alert('エラー', 'イベント名を入力してください');
    pickImages(eventNameInput.trim(), `EVENT_${eventNameInput.trim()}`);
  };

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const generatePastCalendar = () => {
    const year = pastDate.getFullYear();
    const month = pastDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = getDaysInMonth(year, month);
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  };

  const getDatesForTab = () => {
    if (activeTab === 'イベント') {
      return Object.keys(albumPhotos).filter(k => k.startsWith('EVENT_')).map(k => ({
        key: k,
        label: k.replace('EVENT_', ''),
        photos: albumPhotos[k]
      }));
    }

    const year = new Date().getFullYear();
    const dayIdx = ['日', '月', '火', '水', '木', '金', '土'].indexOf(activeTab);
    const dates = [];
    const d = new Date(year, viewMonth - 1, 1);

    while (d.getMonth() === viewMonth - 1) {
      if (d.getDay() === dayIdx) {
        const dateObj = new Date(d);
        let canView = true;
        if (role === 'user' && userData?.createdAt) {
          const createdTime = userData.createdAt.toDate().getTime();
          if (dateObj.getTime() < createdTime) canView = false;
        }
        if (canView) {
          const dateStr = getLocalDateString(dateObj); // ★ 修正
          dates.push({
            key: dateStr,
            label: `${viewMonth}月${dateObj.getDate()}日(${activeTab})`,
            photos: albumPhotos[dateStr] || []
          });
        }
      }
      d.setDate(d.getDate() + 1);
    }
    return dates;
  };

  const handleSavePhoto = () => Alert.alert('保存完了', '端末のアルバムに保存しました。');

  const handleDeletePhoto = async () => {
    if (Platform.OS === 'web') {
      if (window.confirm('この写真をクラウドから完全に削除しますか？')) {
        if (selectedPhoto) {
          try {
            if (selectedPhoto.storagePath) {
              const storageRef = ref(storage, selectedPhoto.storagePath);
              await deleteObject(storageRef);
            }
            await deleteDoc(doc(db, 'albums', selectedPhoto.id));
            setSelectedPhoto(null);
          } catch (e) {
            console.error("Delete error:", e);
            window.alert('削除に失敗しました。');
          }
        }
      }
      return;
    }
    Alert.alert('削除確認', 'この写真をクラウドから完全に削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => {
        if (selectedPhoto) {
          try {
            if (selectedPhoto.storagePath) {
              const storageRef = ref(storage, selectedPhoto.storagePath);
              await deleteObject(storageRef);
            }
            await deleteDoc(doc(db, 'albums', selectedPhoto.id));
            setSelectedPhoto(null);
          } catch (e) {
            console.error("Delete error:", e);
            Alert.alert('エラー', '削除に失敗しました。');
          }
        }
      }}
    ]);
  };

  if (loading) return <SafeAreaView style={[styles.container, styles.center]}><ActivityIndicator size="large" color={COLORS.primary} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container}>
      {isUploading && (
        <View style={styles.uploadingOverlay}>
          <ActivityIndicator size="large" color={COLORS.white} />
          <Text style={styles.uploadingText}>写真をアップロード中...</Text>
        </View>
      )}

      <View style={styles.header}>
        {mode !== 'top' && role !== 'user' && (
          <TouchableOpacity style={styles.backBtn} onPress={() => setMode('top')}><Ionicons name="chevron-back" size={24} color={COLORS.text} /></TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>{mode === 'top' ? 'アルバム管理' : mode === 'add' ? '写真を追加' : 'アルバムを見る'}</Text>
      </View>

      {mode === 'top' && (
        <View style={styles.topContainer}>
          <TouchableOpacity style={[styles.mainCard, { backgroundColor: '#E0FFFF' }]} onPress={() => setMode('view')}>
            <Ionicons name="images-outline" size={48} color="#4682B4" />
            <Text style={styles.mainCardTitle}>見る</Text>
            <Text style={styles.mainCardDesc}>月ごとの写真やイベントを閲覧します。</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.mainCard, { backgroundColor: '#FFE4E1' }]} onPress={() => setMode('add')}>
            <Ionicons name="add-circle-outline" size={48} color="#D87093" />
            <Text style={styles.mainCardTitle}>追加する</Text>
            <Text style={styles.mainCardDesc}>スマホのアルバムから写真をアップロードします。</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === 'add' && (
        <ScrollView style={styles.scrollArea} contentContainerStyle={styles.addGrid}>
          <TouchableOpacity style={styles.addOptionCard} onPress={handleAddToday}>
            <View style={[styles.iconCircle, { backgroundColor: '#E0FFFF' }]}><Ionicons name="today" size={32} color="#4682B4" /></View>
            <Text style={styles.addOptionTitle}>今日</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addOptionCard} onPress={() => setCalendarModalVisible(true)}>
            <View style={[styles.iconCircle, { backgroundColor: '#FFE4E1' }]}><Ionicons name="calendar" size={32} color="#D87093" /></View>
            <Text style={styles.addOptionTitle}>過去</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addOptionCard} onPress={() => setEventModalVisible(true)}>
            <View style={[styles.iconCircle, { backgroundColor: '#FFFACD' }]}><Ionicons name="star" size={32} color="#DAA520" /></View>
            <Text style={styles.addOptionTitle}>イベント</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {mode === 'view' && (
        <View style={{ flex: 1 }}>
          {activeTab !== 'イベント' && (
            <View style={styles.monthSelector}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthScroll}>
                {MONTHS.map(m => (
                  <TouchableOpacity key={m} style={[styles.monthBtn, viewMonth === m && styles.monthBtnActive]} onPress={() => setViewMonth(m)}>
                    <Text style={[styles.monthText, viewMonth === m && styles.monthTextActive]}>{m}月</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={styles.tabContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
              {ALL_TABS.map(tab => {
                if (role === 'user' && tab !== 'イベント') {
                  if (!userData?.days || !userData.days[tab]) return null;
                }
                return (
                  <TouchableOpacity key={tab} style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]} onPress={() => setActiveTab(tab)}>
                    <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <ScrollView style={styles.scrollArea}>
            {getDatesForTab().length === 0 ? (
              <View style={styles.noDataBox}><Text style={styles.noDataText}>閲覧できる写真がありません</Text></View>
            ) : (
              getDatesForTab().map(item => {
                const isExpanded = !!expandedDates[item.key];
                return (
                  <View key={item.key} style={styles.dateSection}>
                    <TouchableOpacity style={styles.dateHeaderContainer} onPress={() => toggleExpand(item.key)} activeOpacity={0.7}>
                      <Text style={styles.dateHeader}>{item.label}</Text>
                      <View style={styles.expandBadge}>
                        <Text style={styles.expandText}>{isExpanded ? 'たたむ' : `表示する (${item.photos.length}枚)`}</Text>
                        <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={COLORS.primary} />
                      </View>
                    </TouchableOpacity>

                    {isExpanded && (
                      item.photos.length > 0 ? (
                        <View style={styles.photoGrid}>
                          {item.photos.map((photoObj, idx) => (
                            <TouchableOpacity 
                              key={idx} style={styles.photoWrapper} activeOpacity={0.8} 
                              onPress={() => setSelectedPhoto({ id: photoObj.id, uri: photoObj.uri, key: item.key, storagePath: photoObj.storagePath })}
                            >
                              <Image source={{ uri: photoObj.uri }} style={styles.photo} resizeMode="cover" />
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.noPhotoText}>写真がありません</Text>
                      )
                    )}
                  </View>
                );
              })
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      )}

      <Modal visible={calendarModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>過去の日付を選択</Text>
              <TouchableOpacity onPress={() => setCalendarModalVisible(false)}><Ionicons name="close" size={28} color={COLORS.textLight} /></TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
              <TouchableOpacity onPress={() => setPastDate(new Date(pastDate.getFullYear(), pastDate.getMonth() - 1, 1))}><Ionicons name="chevron-back" size={24} color={COLORS.text} /></TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: 'bold' }}>{pastDate.getFullYear()}年 {pastDate.getMonth() + 1}月</Text>
              <TouchableOpacity onPress={() => setPastDate(new Date(pastDate.getFullYear(), pastDate.getMonth() + 1, 1))}><Ionicons name="chevron-forward" size={24} color={COLORS.text} /></TouchableOpacity>
            </View>
            <View style={styles.calHeaderRow}>
              {DAY_NAMES.map((w, i) => (
                <Text key={i} style={[styles.calWeekText, i === 0 && {color: '#E74C3C'}, i === 6 && {color: '#3498DB'}]}>{w}</Text>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {generatePastCalendar().map((day, idx) => (
                <TouchableOpacity key={idx} style={[styles.calCell, !day && {borderWidth: 0}]} disabled={!day} onPress={() => { if (day) { pastDate.setDate(day); handleAddPast(); } }}>
                  {day && <Text style={{ fontWeight: 'bold', color: COLORS.text }}>{day}</Text>}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={eventModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>イベント写真を追加</Text>
              <TouchableOpacity onPress={() => setEventModalVisible(false)}><Ionicons name="close" size={28} color={COLORS.textLight} /></TouchableOpacity>
            </View>
            <Text style={{ marginBottom: 8, fontWeight: 'bold', color: COLORS.text }}>イベント名</Text>
            <TextInput style={styles.input} placeholder="例: 春の遠足" value={eventNameInput} onChangeText={setEventNameInput} />
            <TouchableOpacity style={styles.primaryBtn} onPress={handleAddEvent}><Text style={styles.primaryBtnText}>写真を選択する</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!selectedPhoto} transparent animationType="fade">
        <SafeAreaView style={styles.fullScreenContainer}>
          <View style={styles.fullScreenHeader}>
            <TouchableOpacity style={styles.fullScreenIconBtn} onPress={() => setSelectedPhoto(null)}><Ionicons name="close" size={32} color={COLORS.white} /></TouchableOpacity>
          </View>
          {selectedPhoto && <Image source={{ uri: selectedPhoto.uri }} style={styles.fullScreenImage} resizeMode="contain" />}
          <View style={styles.fullScreenFooter}>
            <TouchableOpacity style={styles.fullScreenActionBtn} onPress={handleSavePhoto}>
              <Ionicons name="download-outline" size={28} color={COLORS.white} />
              <Text style={styles.fullScreenActionText}>保存</Text>
            </TouchableOpacity>
            {role !== 'user' && (
              <TouchableOpacity style={styles.fullScreenActionBtn} onPress={handleDeletePhoto}>
                <Ionicons name="trash-outline" size={28} color={COLORS.danger} />
                <Text style={[styles.fullScreenActionText, { color: COLORS.danger }]}>削除</Text>
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { justifyContent: 'center', alignItems: 'center' },
  uploadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', zIndex: 9999 },
  uploadingText: { color: COLORS.white, marginTop: 16, fontSize: 16, fontWeight: 'bold' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderColor: COLORS.border },
  backBtn: { marginRight: 16 },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: COLORS.text },
  scrollArea: { flex: 1 },
  topContainer: { flex: 1, padding: 20, gap: 20, justifyContent: 'center' },
  mainCard: { padding: 30, borderRadius: 20, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 4, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  mainCardTitle: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, marginTop: 16, marginBottom: 8 },
  mainCardDesc: { fontSize: 14, color: COLORS.textLight, textAlign: 'center' },
  addGrid: { padding: 20, gap: 16 },
  addOptionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
  iconCircle: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', marginRight: 20 },
  addOptionTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  monthSelector: { backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border },
  monthScroll: { },
  monthBtn: { paddingHorizontal: 22, paddingVertical: 14, backgroundColor: COLORS.white, borderRightWidth: 1, borderColor: COLORS.border },
  monthBtnActive: { backgroundColor: COLORS.primary },
  monthText: { fontSize: 16, fontWeight: 'bold', color: COLORS.textLight },
  monthTextActive: { color: COLORS.white },
  tabContainer: { backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border },
  tabScroll: { },
  tabBtn: { paddingHorizontal: 26, paddingVertical: 14, backgroundColor: COLORS.white, borderRightWidth: 1, borderColor: COLORS.border },
  tabBtnActive: { backgroundColor: '#E6E6FA' },
  tabText: { fontSize: 14, fontWeight: 'bold', color: COLORS.textLight },
  tabTextActive: { color: '#9370DB' },
  dateSection: { marginBottom: 12 },
  
  dateHeaderContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderColor: COLORS.border },
  dateHeader: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  expandBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F0F0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  expandText: { fontSize: 12, color: COLORS.primary, fontWeight: 'bold', marginRight: 4 },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: COLORS.background },
  photoWrapper: { width: '33.333%', aspectRatio: 1, padding: 1 }, 
  photo: { flex: 1, backgroundColor: '#EAEAEA' },
  noPhotoText: { color: COLORS.textLight, paddingHorizontal: 16, paddingVertical: 16, fontStyle: 'italic', fontSize: 14, textAlign: 'center' },
  noDataBox: { padding: 60, alignItems: 'center' },
  noDataText: { color: COLORS.textLight, fontWeight: 'bold', fontSize: 16, textAlign: 'center' },
  fullScreenContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' },
  fullScreenHeader: { position: 'absolute', top: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'flex-end', padding: 20, zIndex: 10 },
  fullScreenIconBtn: { padding: 8 },
  fullScreenImage: { width: '100%', height: '75%' },
  fullScreenFooter: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 60, zIndex: 10 },
  fullScreenActionBtn: { alignItems: 'center', padding: 10 },
  fullScreenActionText: { color: COLORS.white, fontSize: 14, marginTop: 6, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', backgroundColor: COLORS.white, borderRadius: 16, padding: 24, shadowColor: '#000', elevation: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  calHeaderRow: { flexDirection: 'row', marginBottom: 8 },
  calWeekText: { width: '14.2%', textAlign: 'center', fontSize: 13, fontWeight: 'bold', color: COLORS.textLight },
  calCell: { width: '14.2%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center', borderWidth: 0.5, borderColor: COLORS.border },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 14, fontSize: 16, marginBottom: 20 },
  primaryBtn: { backgroundColor: COLORS.primary, padding: 16, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
});