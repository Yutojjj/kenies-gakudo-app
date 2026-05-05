import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { COLORS } from '../constants/theme';
import { db, storage } from '../firebase';

type Mode = 'top' | 'add' | 'view';
type TabType = '月' | '火' | '水' | '木' | '金' | 'イベント';
const ALL_TABS: TabType[] = ['月', '火', '水', '木', '金', 'イベント'];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// iOSかどうかを判定するヘルパー
const isIOSWeb = Platform.OS === 'web' && /iPad|iPhone|iPod/.test(navigator.userAgent);

const getLocalDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const saveImageToDevice = async (uri: string): Promise<boolean> => {
  if (Platform.OS === 'web') {
    if (isIOSWeb) {
      window.open(uri, '_blank');
      return true;
    } 
    try {
      const response = await fetch(uri);
      if (!response.ok) throw new Error('Network error');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const extension = uri.split(/[#?]/)[0].split('.').pop()?.trim().toLowerCase() || 'jpg';
      link.download = `kenies_photo_${Date.now()}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      console.error('Web Save Error:', e);
      return false;
    }
  } else {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('権限エラー', '写真へのアクセス権限が必要です。');
        return false;
      }
      const extension = uri.split(/[#?]/)[0].split('.').pop()?.trim().toLowerCase() || 'jpg';
      const cacheDir = (FileSystem as any).cacheDirectory;
      if (!cacheDir) return false;
      const fileUri = `${cacheDir}temp_photo_${Date.now()}.${extension}`;
      const downloadRes = await FileSystem.downloadAsync(uri, fileUri);
      if (downloadRes.status !== 200) return false;
      await MediaLibrary.saveToLibraryAsync(downloadRes.uri);
      await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
      return true;
    } catch (e) {
      console.error('Native Save Error:', e);
      return false;
    }
  }
};

export default function AlbumScreen() {
  const router = useRouter();
  const { role, name } = useLocalSearchParams<{ role: string, name: string }>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  const [mode, setMode] = useState<Mode>(role === 'user' ? 'view' : 'top');
  const [viewMonth, setViewMonth] = useState(new Date().getMonth() + 1);
  const [activeTab, setActiveTab] = useState<TabType>('月');
  
  const [fullScreenPhotos, setFullScreenPhotos] = useState<any[] | null>(null);
  const [fullScreenIndex, setFullScreenIndex] = useState(0);

  const [calendarModalVisible, setCalendarModalVisible] = useState(false);
  const [eventModalVisible, setEventModalVisible] = useState(false);
  const [eventNameInput, setEventNameInput] = useState('');
  const [pastDate, setPastDate] = useState(new Date());
  
  const [eventChoiceModalVisible, setEventChoiceModalVisible] = useState(false);
  const [newEventCalendarVisible, setNewEventCalendarVisible] = useState(false);
  const [newEventDate, setNewEventDate] = useState(new Date());
  const [addToExistingModalVisible, setAddToExistingModalVisible] = useState(false);
  
  const [albumPhotos, setAlbumPhotos] = useState<Record<string, { id: string, uri: string, storagePath?: string }[]>>({});
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});

  const [albumEvents, setAlbumEvents] = useState<{id: string, name: string, code: string, category: string}[]>([]);
  const [unlockedEvents, setUnlockedEvents] = useState<string[]>([]);
  const [unlockModalVisible, setUnlockModalVisible] = useState(false);
  const [unlockCodeInput, setUnlockCodeInput] = useState('');

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);

  const flatListRef = useRef<FlatList>(null);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems && viewableItems.length > 0) {
      setFullScreenIndex(viewableItems[0].index);
    }
  }).current;

  const onScrollToIndexFailed = (info: { index: number, highestMeasuredFrameIndex: number, averageItemLength: number }) => {
    setTimeout(() => {
      flatListRef.current?.scrollToIndex({ index: info.index, animated: false });
    }, 100);
  };

  const scrollToIndex = (index: number) => {
    if (fullScreenPhotos && index >= 0 && index < fullScreenPhotos.length) {
      flatListRef.current?.scrollToIndex({ index, animated: true });
    }
  };

  useEffect(() => {
    let isMounted = true;
    const fetchUser = async () => {
      if (role === 'user') {
        const q = query(collection(db, 'accounts'), where('role', '==', 'user'), where('name', '==', name));
        const snap = await getDocs(q);
        if (!snap.empty && isMounted) {
          const data = snap.docs[0].data();
          setUserData(data);
          const firstAllowedDay = ALL_TABS.find(t => t === 'イベント' || (data.days && data.days[t]));
          if (firstAllowedDay) setActiveTab(firstAllowedDay);
        }
      }
    };
    fetchUser();

    AsyncStorage.getItem('unlockedEvents').then(res => {
      if (res && isMounted) setUnlockedEvents(JSON.parse(res));
    });

    const qPhotos = query(collection(db, 'albums'));
    const unsubPhotos = onSnapshot(qPhotos, (snapshot) => {
      const photosData: Record<string, { id: string, uri: string, storagePath?: string }[]> = {};
      snapshot.forEach(d => {
        const item = d.data();
        const key = item.category as string;
        if (!key) return; 
        if (!photosData[key]) photosData[key] = [];
        photosData[key].push({ id: d.id, uri: item.uri, storagePath: item.storagePath });
      });
      if (isMounted) setAlbumPhotos(photosData);
    });

    const qEvents = query(collection(db, 'album_events'));
    const unsubEvents = onSnapshot(qEvents, (snapshot) => {
      const evs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as {id: string, name: string, code: string, category: string}));
      if (isMounted) setAlbumEvents(evs);
    });

    return () => {
      isMounted = false;
      unsubPhotos();
      unsubEvents();
    };
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
      setCalendarModalVisible(false);
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
            createdAt: serverTimestamp()
          });
          uploadedCount++;
        }
        Alert.alert('アップロード完了', `${targetTitle} に ${uploadedCount} 枚の写真を保存しました。`);
      } catch (e) {
        Alert.alert('エラー', '画像のアップロードに失敗しました。');
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleAddToday = () => {
    const todayStr = getLocalDateString(new Date());
    pickImages('今日', todayStr);
  };
  
  const handleAddPast = () => {
    const pastDateStr = getLocalDateString(pastDate);
    pickImages(pastDateStr, pastDateStr);
  };

  const generateEventCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
  };

  const uploadPhotosToCategory = async (category: string): Promise<number> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.6,
    });
    if (result.canceled) return 0;
    
    setEventModalVisible(false);
    setAddToExistingModalVisible(false);
    setEventChoiceModalVisible(false);
    setIsUploading(true);
    
    let count = 0;
    for (const asset of result.assets) {
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const filename = `photo_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      const storagePath = `albums/${filename}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, blob);
      const downloadUrl = await getDownloadURL(storageRef);
      await addDoc(collection(db, 'albums'), {
        uri: downloadUrl, storagePath,
        uploader: name || '不明', category, createdAt: serverTimestamp()
      });
      count++;
    }
    return count;
  };

  const handleCreateEvent = async () => {
    if (!eventNameInput.trim()) return Alert.alert('エラー', 'イベント名を入力してください');
    const eventCode = generateEventCode();
    const dateStr = getLocalDateString(newEventDate);
    const eventCategory = `EVENT_${eventNameInput.trim()}_${dateStr}`;
    
    try {
      const uploaded = await uploadPhotosToCategory(eventCategory);
      if (uploaded > 0) {
        await addDoc(collection(db, 'album_events'), {
          name: `${eventNameInput.trim()}_${dateStr}`,
          code: eventCode, category: eventCategory, createdAt: serverTimestamp()
        });
        if (Platform.OS === 'web') {
          window.alert(`イベント作成完了\nイベント名: ${eventNameInput.trim()}_${dateStr}\n発行コード: ${eventCode}\n\n${uploaded} 枚の写真を保存しました。`);
        } else {
          Alert.alert('イベント作成完了', `イベント名: ${eventNameInput.trim()}_${dateStr}\n発行コード: ${eventCode}\n\n${uploaded} 枚の写真を保存しました。\n※保護者にはこのコードを伝えてください。`);
        }
      }
    } catch (e) {
      if (Platform.OS === 'web') window.alert('イベント作成または画像のアップロードに失敗しました。');
      else Alert.alert('エラー', 'イベント作成または画像のアップロードに失敗しました。');
    } finally {
      setIsUploading(false);
      setEventNameInput('');
    }
  };

  const handleAddToExistingEvent = async (ev: {id: string, name: string, category: string}) => {
    try {
      const uploaded = await uploadPhotosToCategory(ev.category);
      if (uploaded > 0) {
        if (Platform.OS === 'web') window.alert(`追加完了\n「${ev.name}」に ${uploaded} 枚の写真を追加しました。`);
        else Alert.alert('追加完了', `「${ev.name}」に ${uploaded} 枚の写真を追加しました。`);
      }
    } catch (e) {
      if (Platform.OS === 'web') window.alert('写真のアップロードに失敗しました。');
      else Alert.alert('エラー', '写真のアップロードに失敗しました。');
    } finally {
      setIsUploading(false);
    }
  };

  const generateNewEventCalendar = () => {
    const year = newEventDate.getFullYear();
    const month = newEventDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  };

  const handleUnlockEvent = () => {
    const inputCode = unlockCodeInput.trim().toUpperCase();
    const ev = albumEvents.find(e => e.code === inputCode);
    if (ev) {
      if (!unlockedEvents.includes(ev.id)) {
        const newUnlocked = [...unlockedEvents, ev.id];
        setUnlockedEvents(newUnlocked);
        AsyncStorage.setItem('unlockedEvents', JSON.stringify(newUnlocked));
      }
      Alert.alert('成功', `「${ev.name}」のアルバムをロック解除しました！`);
      setUnlockModalVisible(false);
      setUnlockCodeInput('');
    } else {
      Alert.alert('エラー', '無効なイベントコードです');
    }
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
      return albumEvents
        .filter(ev => role !== 'user' || unlockedEvents.includes(ev.id)) 
        .map(ev => ({
          key: ev.category,
          label: ev.name,
          code: ev.code, 
          eventId: ev.id,
          photos: albumPhotos[ev.category] || []
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
          const dateStr = getLocalDateString(dateObj);
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

  const toggleSelectPhoto = (id: string) => {
    if (selectedPhotoIds.includes(id)) {
      setSelectedPhotoIds(selectedPhotoIds.filter(pid => pid !== id));
    } else {
      setSelectedPhotoIds([...selectedPhotoIds, id]);
    }
  };

  const handleSelectAllInSection = (photos: any[]) => {
    const sectionIds = photos.map(p => p.id);
    const allSelected = sectionIds.every(id => selectedPhotoIds.includes(id));
    if (allSelected) {
      setSelectedPhotoIds(selectedPhotoIds.filter(id => !sectionIds.includes(id)));
    } else {
      const newSelections = new Set([...selectedPhotoIds, ...sectionIds]);
      setSelectedPhotoIds(Array.from(newSelections));
    }
  };

  const handleSaveSinglePhoto = async () => {
    const targetPhoto = fullScreenPhotos ? fullScreenPhotos[fullScreenIndex] : null;
    if (!targetPhoto || !targetPhoto.uri) return;
    
    if (isIOSWeb) {
      await saveImageToDevice(targetPhoto.uri);
      return;
    }

    setIsDownloading(true);
    const success = await saveImageToDevice(targetPhoto.uri);
    setIsDownloading(false);
    if (success) Alert.alert('保存完了', 'アルバムに保存しました。');
    else Alert.alert('エラー', '保存に失敗しました。');
  };

  const handleBulkSave = async () => {
    if (selectedPhotoIds.length === 0) return;
    
    // iOS Web版では一括保存ボタンそのものを非表示にするが、
    // 万が一呼ばれた際もガードをかけておく
    if (isIOSWeb) return;

    setIsDownloading(true);
    try {
      const allPhotosFlat = Object.values(albumPhotos).flat();
      let successCount = 0;
      for (const id of selectedPhotoIds) {
        const photo = allPhotosFlat.find(p => p.id === id);
        if (photo && photo.uri) {
          if (await saveImageToDevice(photo.uri)) successCount++;
        }
      }
      setIsSelectMode(false);
      setSelectedPhotoIds([]);
      Alert.alert('保存完了', `${successCount} 枚の画像を端末のアルバムに保存しました。`);
    } catch (error) {
      Alert.alert('エラー', '一括保存中にエラーが発生しました。');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleBulkDelete = () => {
    if (selectedPhotoIds.length === 0) return;
    if (Platform.OS === 'web') {
      if (window.confirm(`選択した ${selectedPhotoIds.length} 枚の画像を完全に削除しますか？`)) {
        executeBulkDelete(selectedPhotoIds);
      }
      return;
    }
    Alert.alert('一括削除確認', `選択した ${selectedPhotoIds.length} 枚の画像を完全に削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => executeBulkDelete(selectedPhotoIds) }
    ]);
  };

  const handleSectionDelete = (sectionLabel: string, photos: any[], eventId?: string) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`「${sectionLabel}」のアルバムを全て削除しますか？`)) {
        executeBulkDelete(photos.map(p => p.id));
        if (eventId) deleteDoc(doc(db, 'album_events', eventId));
      }
      return;
    }
    Alert.alert('アルバム削除確認', `「${sectionLabel}」のアルバムを全て削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => {
        await executeBulkDelete(photos.map(p => p.id));
        if (eventId) await deleteDoc(doc(db, 'album_events', eventId));
      }}
    ]);
  };

  const executeBulkDelete = async (idsToDelete: string[]) => {
    setLoading(true);
    try {
      const allPhotosFlat = Object.values(albumPhotos).flat();
      for (const id of idsToDelete) {
        const photo = allPhotosFlat.find(p => p.id === id);
        if (photo) {
          if (photo.storagePath) {
            const storageRef = ref(storage, photo.storagePath);
            await deleteObject(storageRef).catch(() => {});
          }
          await deleteDoc(doc(db, 'albums', photo.id));
        }
      }
      setIsSelectMode(false);
      setSelectedPhotoIds([]);
    } catch (e) {
      Alert.alert('エラー', '一部の画像の削除に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const openFullScreen = (photos: any[], index: number) => {
    setFullScreenPhotos(photos);
    setFullScreenIndex(index);
  };

  const closeFullScreen = () => {
    setFullScreenPhotos(null);
  };

  const currentFullScreenPhoto = fullScreenPhotos ? fullScreenPhotos[fullScreenIndex] : null;

  return (
    <SafeAreaView style={styles.container}>
      
      <View style={isUploading || (isDownloading && !fullScreenPhotos) || loading ? styles.uploadingOverlay : { display: 'none' }}>
        <ActivityIndicator size="large" color={COLORS.white} />
        <Text style={styles.uploadingText}>
          {isUploading ? '写真をアップロード中...' : isDownloading ? '端末に保存しています...' : '処理中...'}
        </Text>
      </View>

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => {
          if (isSelectMode) {
            setIsSelectMode(false);
            setSelectedPhotoIds([]);
          } else {
            mode === 'top' || role === 'user' ? router.back() : setMode('top');
          }
        }}>
          <Ionicons name={isSelectMode ? "close" : "chevron-back"} size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isSelectMode ? `${selectedPhotoIds.length}枚選択中` : mode === 'top' ? 'アルバム管理' : mode === 'add' ? '写真を追加' : 'アルバムを見る'}
        </Text>
      </View>

      {mode === 'top' && (
        <View style={styles.topContainerFull}>
          <TouchableOpacity style={[styles.mainCardHuge, { backgroundColor: '#E0FFFF' }]} onPress={() => setMode('view')}>
            <Ionicons name="images-outline" size={80} color="#4682B4" />
            <Text style={styles.mainCardTitleHuge}>見る</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.mainCardHuge, { backgroundColor: '#FFE4E1' }]} onPress={() => setMode('add')}>
            <Ionicons name="add-circle-outline" size={80} color="#D87093" />
            <Text style={styles.mainCardTitleHuge}>追加する</Text>
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
          <TouchableOpacity style={styles.addOptionCard} onPress={() => setEventChoiceModalVisible(true)}>
            <View style={[styles.iconCircle, { backgroundColor: '#FFFACD' }]}><Ionicons name="star" size={32} color="#DAA520" /></View>
            <Text style={styles.addOptionTitle}>イベントアルバム</Text>
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
            {activeTab === 'イベント' && role === 'user' && (
               <View style={{ padding: 16 }}>
                 <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#9370DB' }]} onPress={() => setUnlockModalVisible(true)}>
                   <Ionicons name="key-outline" size={20} color="#fff" style={{marginRight: 8}} />
                   <Text style={styles.primaryBtnText}>イベントをアンロックする</Text>
                 </TouchableOpacity>
               </View>
            )}

            {getDatesForTab().length === 0 ? (
              <View style={styles.noDataBox}><Text style={styles.noDataText}>閲覧できる写真がありません</Text></View>
            ) : (
              getDatesForTab().map((item: any) => {
                const isExpanded = !!expandedDates[item.key];
                return (
                  <View key={item.key} style={styles.dateSection}>
                    <TouchableOpacity style={styles.dateHeaderContainer} onPress={() => toggleExpand(item.key)} activeOpacity={0.7}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.dateHeader}>{item.label}</Text>
                        {role !== 'user' && item.code && (
                          <Text style={styles.eventCodeText}>コード: {item.code}</Text>
                        )}
                      </View>

                      <View style={styles.sectionActions}>
                        {isSelectMode ? (
                          // iOS Web版は一括保存できないため、選択モードでも「すべて選択」は出さないように制御可（必要なら）
                          !isIOSWeb && (
                            <TouchableOpacity style={styles.sectionActionBtn} onPress={() => handleSelectAllInSection(item.photos)}>
                              <Text style={{color: COLORS.primary, fontWeight: 'bold'}}>すべて選択</Text>
                            </TouchableOpacity>
                          )
                        ) : (
                          <>
                            {role !== 'user' && activeTab === 'イベント' && (
                              <TouchableOpacity style={styles.sectionActionBtn} onPress={() => pickImages(item.label, item.key)}>
                                <Ionicons name="add-circle" size={24} color={COLORS.primary} />
                              </TouchableOpacity>
                            )}
                            {role !== 'user' && (
                              <TouchableOpacity style={styles.sectionActionBtn} onPress={() => handleSectionDelete(item.label, item.photos, item.eventId)}>
                                <Ionicons name="trash" size={24} color={COLORS.danger} />
                              </TouchableOpacity>
                            )}
                          </>
                        )}
                        <View style={styles.expandBadge}>
                          <Text style={styles.expandText}>{isExpanded ? 'たたむ' : `表示 (${item.photos.length}枚)`}</Text>
                          <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={COLORS.primary} />
                        </View>
                      </View>
                    </TouchableOpacity>

                    {isExpanded && (
                      item.photos.length > 0 ? (
                        <View style={styles.photoGrid}>
                          {item.photos.map((photoObj: any, idx: number) => {
                            const isSelected = selectedPhotoIds.includes(photoObj.id);
                            return (
                              <TouchableOpacity 
                                key={photoObj.id} 
                                style={[styles.photoWrapper, isSelectMode && isSelected && { opacity: 0.6 }]} 
                                activeOpacity={0.8} 
                                onPress={() => {
                                  if (isSelectMode) toggleSelectPhoto(photoObj.id);
                                  else openFullScreen(item.photos, idx);
                                }}
                                onLongPress={() => {
                                  // iOS Web版以外なら長押しで選択モード開始
                                  if (!isSelectMode && !isIOSWeb) {
                                    setIsSelectMode(true);
                                    setSelectedPhotoIds([photoObj.id]);
                                  }
                                }}
                              >
                                <Image source={{ uri: photoObj.uri }} style={styles.photo} resizeMode="cover" />
                                {isSelectMode && !isIOSWeb && (
                                  <View style={styles.checkOverlay}>
                                    <Ionicons name={isSelected ? "checkmark-circle" : "ellipse-outline"} size={28} color={isSelected ? COLORS.primary : "rgba(255,255,255,0.7)"} />
                                  </View>
                                )}
                              </TouchableOpacity>
                            )
                          })}
                        </View>
                      ) : (
                        <Text style={styles.noPhotoText}>写真がありません</Text>
                      )
                    )}
                  </View>
                );
              })
            )}
            <View style={{ height: 100 }} />
          </ScrollView>

          {isSelectMode && !isIOSWeb && (
            <View style={styles.selectionBottomBar}>
              {role !== 'user' && (
                <TouchableOpacity style={[styles.bottomActionBtn, { backgroundColor: '#FFF0F0', borderColor: COLORS.danger, borderWidth: 1 }]} onPress={handleBulkDelete}>
                  <Ionicons name="trash" size={20} color={COLORS.danger} />
                  <Text style={[styles.bottomActionText, { color: COLORS.danger }]}>削除</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.bottomActionBtn, { backgroundColor: COLORS.primary, flex: 1, marginLeft: 12 }]} onPress={handleBulkSave}>
                <Ionicons name="download" size={20} color={COLORS.white} />
                <Text style={[styles.bottomActionText, { color: COLORS.white }]}>一括保存</Text>
              </TouchableOpacity>
            </View>
          )}

          {!isSelectMode && !isIOSWeb && (
            <TouchableOpacity style={styles.fab} onPress={() => setIsSelectMode(true)}>
              <Ionicons name="checkmark-done" size={28} color={COLORS.white} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* 各種モーダル */}
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

      <Modal visible={eventChoiceModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>イベントアルバム</Text>
              <TouchableOpacity onPress={() => setEventChoiceModalVisible(false)}><Ionicons name="close" size={28} color={COLORS.textLight} /></TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.primaryBtn, { marginBottom: 12 }]} onPress={() => { setEventChoiceModalVisible(false); setNewEventDate(new Date()); setNewEventCalendarVisible(true); }}>
              <Ionicons name="add-circle-outline" size={20} color={COLORS.white} style={{ marginRight: 8 }} />
              <Text style={styles.primaryBtnText}>新規イベントアルバム作成</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#7B68EE' }]} onPress={() => { setEventChoiceModalVisible(false); setAddToExistingModalVisible(true); }}>
              <Ionicons name="folder-open-outline" size={20} color={COLORS.white} style={{ marginRight: 8 }} />
              <Text style={styles.primaryBtnText}>既存のアルバムに追加</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={newEventCalendarVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>イベントの日付を選択</Text>
              <TouchableOpacity onPress={() => setNewEventCalendarVisible(false)}><Ionicons name="close" size={28} color={COLORS.textLight} /></TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
              <TouchableOpacity onPress={() => setNewEventDate(new Date(newEventDate.getFullYear(), newEventDate.getMonth() - 1, 1))}><Ionicons name="chevron-back" size={24} color={COLORS.text} /></TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: 'bold' }}>{newEventDate.getFullYear()}年 {newEventDate.getMonth() + 1}月</Text>
              <TouchableOpacity onPress={() => setNewEventDate(new Date(newEventDate.getFullYear(), newEventDate.getMonth() + 1, 1))}><Ionicons name="chevron-forward" size={24} color={COLORS.text} /></TouchableOpacity>
            </View>
            <View style={styles.calHeaderRow}>
              {DAY_NAMES.map((w, i) => (
                <Text key={i} style={[styles.calWeekText, i === 0 && {color: '#E74C3C'}, i === 6 && {color: '#3498DB'}]}>{w}</Text>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {generateNewEventCalendar().map((day, idx) => (
                <TouchableOpacity key={idx} style={[styles.calCell, !day && {borderWidth: 0}]} disabled={!day}
                  onPress={() => {
                    if (day) {
                      const selected = new Date(newEventDate.getFullYear(), newEventDate.getMonth(), day);
                      setNewEventDate(selected);
                      setNewEventCalendarVisible(false);
                      setEventNameInput('');
                      setEventModalVisible(true);
                    }
                  }}>
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
              <Text style={styles.modalTitle}>新しいイベントを作成</Text>
              <TouchableOpacity onPress={() => setEventModalVisible(false)}><Ionicons name="close" size={28} color={COLORS.textLight} /></TouchableOpacity>
            </View>
            <Text style={{ marginBottom: 4, color: COLORS.textLight, fontSize: 13 }}>
              日付: {getLocalDateString(newEventDate)}
            </Text>
            <Text style={{ marginBottom: 8, fontWeight: 'bold', color: COLORS.text }}>イベント名</Text>
            <TextInput style={styles.input} placeholder="例: 春の遠足" value={eventNameInput} onChangeText={setEventNameInput} />
            <Text style={{ marginBottom: 16, color: COLORS.textLight, fontSize: 12 }}>
              ※ 保存名: {eventNameInput.trim() || 'イベント名'}_{getLocalDateString(newEventDate)}
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleCreateEvent}><Text style={styles.primaryBtnText}>作成して写真を選択</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={addToExistingModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>既存のアルバムに追加</Text>
              <TouchableOpacity onPress={() => setAddToExistingModalVisible(false)}><Ionicons name="close" size={28} color={COLORS.textLight} /></TouchableOpacity>
            </View>
            {albumEvents.length === 0 ? (
              <Text style={{ color: COLORS.textLight, textAlign: 'center', paddingVertical: 20 }}>イベントアルバムがまだありません</Text>
            ) : (
              <ScrollView>
                {albumEvents.map(ev => (
                  <TouchableOpacity key={ev.id} style={{ padding: 16, borderBottomWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center' }}
                    onPress={() => handleAddToExistingEvent(ev)}>
                    <Ionicons name="images-outline" size={24} color={COLORS.primary} style={{ marginRight: 12 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: 'bold', color: COLORS.text }}>{ev.name}</Text>
                      <Text style={{ fontSize: 12, color: COLORS.textLight }}>コード: {ev.code}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={unlockModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>イベントをアンロック</Text>
              <TouchableOpacity onPress={() => setUnlockModalVisible(false)}><Ionicons name="close" size={28} color={COLORS.textLight} /></TouchableOpacity>
            </View>
            <Text style={{ marginBottom: 8, fontWeight: 'bold', color: COLORS.text }}>イベントコード</Text>
            <TextInput 
              style={styles.input} placeholder="コードを入力 (例: AB12C3)" 
              value={unlockCodeInput} onChangeText={setUnlockCodeInput} 
              autoCapitalize="characters"
            />
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#9370DB' }]} onPress={handleUnlockEvent}>
              <Text style={styles.primaryBtnText}>アルバムを見る</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!fullScreenPhotos} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', width: windowWidth, height: windowHeight }}>
          
          <View style={isDownloading ? styles.uploadingOverlay : { display: 'none' }}>
            <ActivityIndicator size="large" color={COLORS.white} />
            <Text style={styles.uploadingText}>処理中...</Text>
          </View>

          <View style={styles.fullScreenHeader}>
            <Text style={styles.fullScreenCounter}>{fullScreenIndex + 1} / {fullScreenPhotos?.length}</Text>
            <TouchableOpacity style={styles.fullScreenIconBtn} onPress={closeFullScreen}>
              <Ionicons name="close" size={32} color={COLORS.white} />
            </TouchableOpacity>
          </View>

          {fullScreenPhotos && (
            <>
              <FlatList
                ref={flatListRef}
                data={fullScreenPhotos}
                keyExtractor={(item) => item.id}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={fullScreenIndex}
                getItemLayout={(data, index) => ({ length: windowWidth, offset: windowWidth * index, index })}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={viewabilityConfig}
                onScrollToIndexFailed={onScrollToIndexFailed}
                removeClippedSubviews={false}
                snapToInterval={windowWidth}
                snapToAlignment="center"
                decelerationRate="fast"
                disableIntervalMomentum={true}
                onMomentumScrollEnd={(e) => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
                  setFullScreenIndex(idx);
                }}
                renderItem={({ item }) => (
                  <View style={{ width: windowWidth, height: windowHeight, justifyContent: 'center', alignItems: 'center' }}>
                    <Image source={{ uri: item.uri }} style={{ width: windowWidth, height: windowHeight }} resizeMode="contain" />
                  </View>
                )}
              />

              {fullScreenIndex > 0 && (
                 <TouchableOpacity style={[styles.navArrowBtn, { left: 20 }]} onPress={() => scrollToIndex(fullScreenIndex - 1)}>
                   <Ionicons name="chevron-back" size={40} color={COLORS.white} />
                 </TouchableOpacity>
              )}
              {fullScreenIndex < fullScreenPhotos.length - 1 && (
                 <TouchableOpacity style={[styles.navArrowBtn, { right: 20 }]} onPress={() => scrollToIndex(fullScreenIndex + 1)}>
                   <Ionicons name="chevron-forward" size={40} color={COLORS.white} />
                 </TouchableOpacity>
              )}
            </>
          )}

          <View style={styles.fullScreenFooter}>
            {isIOSWeb ? (
              // ★ iOS Web版のみ：ボタンではなくメッセージを表示
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: COLORS.white, fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
                  画像をなが押しして保存
                </Text>
                <TouchableOpacity style={styles.fullScreenActionBtn} onPress={handleSaveSinglePhoto}>
                  <Ionicons name="expand-outline" size={24} color={COLORS.white} />
                  <Text style={styles.fullScreenActionText}>全画面で表示</Text>
                </TouchableOpacity>
              </View>
            ) : (
              // Android / アプリ版：通常の保存ボタン
              <TouchableOpacity style={styles.fullScreenActionBtn} onPress={handleSaveSinglePhoto}>
                <Ionicons name="download-outline" size={28} color={COLORS.white} />
                <Text style={styles.fullScreenActionText}>保存</Text>
              </TouchableOpacity>
            )}

            {role !== 'user' && currentFullScreenPhoto && (
              <TouchableOpacity style={styles.fullScreenActionBtn} onPress={async () => {
                if (Platform.OS === 'web') {
                  if (window.confirm('この写真を削除しますか？')) {
                    await executeBulkDelete([currentFullScreenPhoto.id]);
                    closeFullScreen();
                  }
                  return;
                }
                Alert.alert('削除確認', 'この写真を削除しますか？', [
                  { text: 'キャンセル', style: 'cancel' },
                  { text: '削除', style: 'destructive', onPress: async () => {
                    await executeBulkDelete([currentFullScreenPhoto.id]);
                    closeFullScreen();
                  }}
                ]);
              }}>
                <Ionicons name="trash-outline" size={28} color={COLORS.danger} />
                <Text style={[styles.fullScreenActionText, { color: COLORS.danger }]}>削除</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  uploadingOverlay: { 
    ...StyleSheet.absoluteFillObject, 
    backgroundColor: 'rgba(0,0,0,0.8)', 
    justifyContent: 'center', 
    alignItems: 'center', 
    zIndex: 9999 
  },
  uploadingText: { color: COLORS.white, marginTop: 16, fontSize: 16, fontWeight: 'bold' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  scrollArea: { flex: 1 },
  topContainerFull: { flex: 1, padding: 20, gap: 20, justifyContent: 'center', alignItems: 'center' },
  mainCardHuge: { width: '100%', flex: 0.45, borderRadius: 30, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 15, elevation: 6, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  mainCardTitleHuge: { fontSize: 32, fontWeight: 'bold', color: COLORS.text, marginTop: 24 },
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
  eventCodeText: { fontSize: 12, color: COLORS.primary, marginTop: 4, fontWeight: 'bold' },
  sectionActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionActionBtn: { padding: 4 },
  expandBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F0F0', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  expandText: { fontSize: 12, color: COLORS.primary, fontWeight: 'bold', marginRight: 4 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: COLORS.background },
  photoWrapper: { width: '33.333%', aspectRatio: 1, padding: 1 }, 
  photo: { flex: 1, backgroundColor: '#EAEAEA' },
  checkOverlay: { position: 'absolute', top: 4, right: 4, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 14 },
  noPhotoText: { color: COLORS.textLight, paddingHorizontal: 16, paddingVertical: 16, fontStyle: 'italic', fontSize: 14, textAlign: 'center' },
  noDataBox: { padding: 60, alignItems: 'center' },
  noDataText: { color: COLORS.textLight, fontWeight: 'bold', fontSize: 16, textAlign: 'center' },
  fullScreenHeader: { position: 'absolute', top: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, zIndex: 10 },
  fullScreenCounter: { color: COLORS.white, fontSize: 18, fontWeight: 'bold' },
  fullScreenIconBtn: { padding: 8 },
  fullScreenFooter: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 60, zIndex: 10 },
  fullScreenActionBtn: { alignItems: 'center', padding: 10 },
  fullScreenActionText: { color: COLORS.white, fontSize: 14, marginTop: 6, fontWeight: 'bold' },
  navArrowBtn: { position: 'absolute', top: '50%', marginTop: -25, width: 50, height: 50, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 25, zIndex: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', backgroundColor: COLORS.white, borderRadius: 16, padding: 24, shadowColor: '#000', elevation: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  calHeaderRow: { flexDirection: 'row', marginBottom: 8 },
  calWeekText: { width: '14.2%', textAlign: 'center', fontSize: 13, fontWeight: 'bold', color: COLORS.textLight },
  calCell: { width: '14.2%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center', borderWidth: 0.5, borderColor: COLORS.border },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 14, fontSize: 16, marginBottom: 20 },
  primaryBtn: { flexDirection: 'row', justifyContent: 'center', backgroundColor: COLORS.primary, padding: 16, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  fab: { position: 'absolute', bottom: 30, right: 24, backgroundColor: COLORS.primary, width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  selectionBottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: COLORS.white, padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16, flexDirection: 'row', borderTopWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 10 },
  bottomActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12 },
  bottomActionText: { fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
});