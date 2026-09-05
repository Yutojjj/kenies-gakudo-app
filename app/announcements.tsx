import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDoc, collection, doc, getDocs, onSnapshot, query, serverTimestamp,
  Timestamp, updateDoc, where,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet,
  NativeScrollEvent, NativeSyntheticEvent, Text, TextInput, TouchableOpacity,
  TouchableWithoutFeedback, View,
} from 'react-native';
import AdminBottomNav from '../components/AdminBottomNav';
import CropImageModal from '../components/CropImageModal';
import { db, storage } from '../firebase';
import { sendPushNotification } from '../utils/sendPushNotification';
import { handleWebWheelStep } from '../utils/webWheel';

const WebScrollView = ScrollView as any;

type Announcement = {
  id: string;
  subject: string;
  content: string;
  imageUrl?: string;
  headerImageUrl?: string;
  referenceImages?: AnnouncementImage[];
  isPromotional?: boolean;
  isActive?: boolean;
  notificationSent?: boolean;
  publishAt?: any;
  expiresAt?: any;
  headerImageStoragePath?: string | null;
  retiredImageStoragePaths?: string[];
  createdAt?: any;
  createdBy?: string;
};

type AnnouncementImage = {
  url: string;
  storagePath?: string | null;
  sourceAlbumId?: string | null;
};

type AlbumMedia = AnnouncementImage & {
  id: string;
  category: string;
};

type AlbumEvent = {
  id: string;
  name: string;
  dateStr: string;
  category: string;
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'));
const TIME_ITEM_HEIGHT = 41;
const TIME_WHEEL_HEIGHT = 132;

const fiscalYearRange = (base = new Date()) => {
  const startYear = base.getMonth() >= 3 ? base.getFullYear() : base.getFullYear() - 1;
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-04-01`,
  };
};

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const toDate = (value: any) => {
  if (value?.toDate) return value.toDate();
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const formatPublishedAt = (value: any) => {
  const date = toDate(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日(${WEEKDAYS[date.getDay()]}) ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

function TimeWheel({ values, value, onChange }: { values: string[]; value: string; onChange: (next: string) => void }) {
  const ref = useRef<ScrollView>(null);
  const wheelWrapRef = useRef<any>(null);
  const wheelLockRef = useRef(0);
  const selectedIndex = Math.max(0, values.indexOf(value));

  const valueFromOffset = (offset: number) => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(offset / TIME_ITEM_HEIGHT)));
    return values[index];
  };

  const applyOffset = (offset: number) => {
    const nextValue = valueFromOffset(offset);
    if (nextValue !== value) onChange(nextValue);
  };

  useEffect(() => {
    const timer = setTimeout(() => ref.current?.scrollTo({ y: selectedIndex * TIME_ITEM_HEIGHT, animated: false }), 40);
    return () => clearTimeout(timer);
  }, [selectedIndex]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const element = wheelWrapRef.current as HTMLElement | null;
    if (!element?.addEventListener) return;
    const onWheel = (event: WheelEvent) => handleWebWheelStep(event, {
      index: values.indexOf(value),
      length: values.length,
      itemHeight: TIME_ITEM_HEIGHT,
      lockRef: wheelLockRef,
      onIndexChange: index => onChange(values[index]),
      scrollTo: offset => ref.current?.scrollTo({ y: offset, animated: true }),
    });
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [values, value]);

  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    const nextValue = valueFromOffset(offset);
    const index = values.indexOf(nextValue);
    if (nextValue !== value) onChange(nextValue);
    ref.current?.scrollTo({ y: index * TIME_ITEM_HEIGHT, animated: true });
  };

  return (
    <View ref={wheelWrapRef} style={styles.timeWheelViewport}>
      <View pointerEvents="none" style={styles.timeWheelSelection} />
      <WebScrollView
        ref={ref}
        style={styles.timeList}
        contentContainerStyle={styles.timeListContent}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        snapToInterval={TIME_ITEM_HEIGHT}
        snapToOffsets={values.map((_, index) => index * TIME_ITEM_HEIGHT)}
        snapToAlignment="center"
        disableIntervalMomentum
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={(event: any) => applyOffset(event.nativeEvent.contentOffset.y)}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
      >
        {values.map(item => (
          <TouchableOpacity
            key={item}
            style={styles.timeOption}
            onPress={() => {
              onChange(item);
              ref.current?.scrollTo({ y: values.indexOf(item) * TIME_ITEM_HEIGHT, animated: true });
            }}
          >
            <Text style={[styles.timeOptionText, value === item && styles.timeOptionTextSelected]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </WebScrollView>
    </View>
  );
}

export default function AnnouncementsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ role?: string; name?: string }>();
  const [role, setRole] = useState(params.role || '');
  const [name, setName] = useState(params.name || '');
  const [items, setItems] = useState<Announcement[]>([]);
  const [formVisible, setFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [isPromotional, setIsPromotional] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [headerImageUrl, setHeaderImageUrl] = useState('');
  const [headerImageStoragePath, setHeaderImageStoragePath] = useState<string | null>(null);
  const [localHeaderImageUri, setLocalHeaderImageUri] = useState('');
  const [cropImageUri, setCropImageUri] = useState('');
  const [referenceImages, setReferenceImages] = useState<AnnouncementImage[]>([]);
  const [localReferenceUris, setLocalReferenceUris] = useState<string[]>([]);
  const [retiredImageStoragePaths, setRetiredImageStoragePaths] = useState<string[]>([]);
  const [photoSourceVisible, setPhotoSourceVisible] = useState(false);
  const [albumPickerVisible, setAlbumPickerVisible] = useState(false);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [albumEvents, setAlbumEvents] = useState<AlbumEvent[]>([]);
  const [albumMedia, setAlbumMedia] = useState<AlbumMedia[]>([]);
  const [expandedAlbumId, setExpandedAlbumId] = useState<string | null>(null);
  const [selectedAlbumMediaIds, setSelectedAlbumMediaIds] = useState<string[]>([]);
  const [publishDate, setPublishDate] = useState(() => new Date());
  const [publishEndDate, setPublishEndDate] = useState(() => new Date());
  const [publishHour, setPublishHour] = useState(() => String(new Date().getHours()).padStart(2, '0'));
  const [publishMinute, setPublishMinute] = useState(() => String(Math.floor(new Date().getMinutes() / 5) * 5).padStart(2, '0'));
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarTarget, setCalendarTarget] = useState<'start' | 'end'>('start');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [timeVisible, setTimeVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(raw => {
      if (!raw) return;
      try {
        const user = JSON.parse(raw);
        setRole(current => current || user.role || '');
        setName(current => current || user.name || '');
      } catch {}
    });
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'announcements'), snap => {
      const next = snap.docs.map(item => ({ id: item.id, ...item.data() } as Announcement));
      next.sort((a, b) => toDate(b.publishAt).getTime() - toDate(a.publishAt).getTime());
      setItems(next);
    });
    return unsub;
  }, []);

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const first = new Date(year, month, 1).getDay();
    const count = new Date(year, month + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
  }, [calendarMonth]);

  const resetForm = () => {
    const now = new Date();
    setEditingId(null);
    setSubject('');
    setContent('');
    setIsPromotional(false);
    setIsActive(true);
    setHeaderImageUrl('');
    setHeaderImageStoragePath(null);
    setLocalHeaderImageUri('');
    setReferenceImages([]);
    setLocalReferenceUris([]);
    setRetiredImageStoragePaths([]);
    setPublishDate(now);
    setPublishEndDate(now);
    setCalendarMonth(now);
    setPublishHour(String(now.getHours()).padStart(2, '0'));
    setPublishMinute(String(Math.floor(now.getMinutes() / 5) * 5).padStart(2, '0'));
    setMessage('');
  };

  const startEdit = (item: Announcement) => {
    const date = toDate(item.publishAt);
    setEditingId(item.id);
    setSubject(item.subject || '');
    setContent(item.content || '');
    setIsPromotional(!!item.isPromotional);
    setIsActive(item.isActive !== false);
    setHeaderImageUrl(item.headerImageUrl || item.imageUrl || '');
    setHeaderImageStoragePath(item.headerImageStoragePath || null);
    setLocalHeaderImageUri('');
    setReferenceImages(Array.isArray(item.referenceImages) ? item.referenceImages.filter(image => image?.url) : []);
    setLocalReferenceUris([]);
    setRetiredImageStoragePaths(Array.isArray(item.retiredImageStoragePaths) ? item.retiredImageStoragePaths : []);
    setPublishDate(date);
    setPublishEndDate(item.expiresAt ? toDate(item.expiresAt) : date);
    setCalendarMonth(date);
    setPublishHour(String(date.getHours()).padStart(2, '0'));
    setPublishMinute(String(date.getMinutes()).padStart(2, '0'));
    setMessage('');
    setFormVisible(true);
  };

  const openCreateForm = () => {
    resetForm();
    setFormVisible(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormVisible(false);
    resetForm();
  };

  const requestPhotoPermission = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage('写真へのアクセスを許可してください');
      return false;
    }
    return true;
  };

  const pickHeaderImage = async () => {
    if (!(await requestPhotoPermission())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]?.uri) setCropImageUri(result.assets[0].uri);
  };

  const pickReferenceImages = async () => {
    setPhotoSourceVisible(false);
    if (!(await requestPhotoPermission())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 12,
      quality: 0.88,
    });
    if (!result.canceled) {
      setLocalReferenceUris(current => Array.from(new Set([...current, ...result.assets.map(asset => asset.uri).filter(Boolean)])));
    }
  };

  const uploadUri = async (uri: string, prefix: string): Promise<AnnouncementImage> => {
    const response = await fetch(uri);
    const blob = await response.blob();
    if (blob.size > 8 * 1024 * 1024) throw new Error('画像は8MB以下にしてください');
    const extension = uri.split('.').pop()?.split('?')[0] || 'jpg';
    const path = `announcements/${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`;
    const target = storageRef(storage, path);
    await uploadBytes(target, blob, { contentType: blob.type || 'image/jpeg' });
    return { url: await getDownloadURL(target), storagePath: path };
  };

  const uploadAnnouncementImages = async () => {
    const header = localHeaderImageUri
      ? await uploadUri(localHeaderImageUri, 'header')
      : { url: headerImageUrl, storagePath: headerImageStoragePath };
    const uploadedReferences = await Promise.all(localReferenceUris.map(uri => uploadUri(uri, 'reference')));
    return {
      headerUrl: header.url || '',
      headerStoragePath: header.storagePath || null,
      references: [...referenceImages, ...uploadedReferences],
    };
  };

  const retireAnnouncementImage = (image?: AnnouncementImage | null) => {
    if (!image?.storagePath || image.sourceAlbumId) return;
    setRetiredImageStoragePaths(current => Array.from(new Set([...current, image.storagePath as string])));
  };

  const openAlbumPicker = async () => {
    setPhotoSourceVisible(false);
    setAlbumPickerVisible(true);
    setAlbumLoading(true);
    setSelectedAlbumMediaIds([]);
    setExpandedAlbumId(null);
    try {
      const [mediaSnap, eventSnap] = await Promise.all([
        getDocs(collection(db, 'albums2')),
        getDocs(collection(db, 'album_events2')),
      ]);
      const range = fiscalYearRange();
      const events = eventSnap.docs.flatMap(eventDoc => {
        const data = eventDoc.data();
        const dateStr = String(data.dateStr || '');
        const category = String(data.category || '');
        if (!category || dateStr < range.start || dateStr >= range.end) return [];
        return [{
          id: eventDoc.id,
          name: String(data.name || 'イベント').replace(/_\d{4}-\d{2}-\d{2}$/, ''),
          dateStr,
          category,
        }];
      }).sort((a, b) => b.dateStr.localeCompare(a.dateStr));
      const allowedCategories = new Set(events.map(event => event.category));
      const media = mediaSnap.docs.flatMap(mediaDoc => {
        const data = mediaDoc.data();
        const category = String(data.category || '');
        const url = String(data.uri || '');
        if (!url || !allowedCategories.has(category)) return [];
        const mediaText = `${data.mediaType || ''} ${data.mimeType || ''} ${url}`.toLowerCase();
        if (/video|\.mp4|\.mov|\.m4v|\.webm/.test(mediaText)) return [];
        return [{ id: mediaDoc.id, url, storagePath: data.storagePath || null, sourceAlbumId: mediaDoc.id, category }];
      });
      setAlbumEvents(events);
      setAlbumMedia(media);
    } catch {
      setMessage('イベントアルバムを読み込めませんでした');
      setAlbumPickerVisible(false);
    } finally {
      setAlbumLoading(false);
    }
  };

  const addSelectedAlbumImages = () => {
    const selected = new Set(selectedAlbumMediaIds);
    const existing = new Set(referenceImages.map(image => image.url));
    const additions = albumMedia
      .filter(media => selected.has(media.id) && !existing.has(media.url))
      .map(({ url, storagePath, sourceAlbumId }) => ({ url, storagePath, sourceAlbumId }));
    setReferenceImages(current => [...current, ...additions]);
    setAlbumPickerVisible(false);
    setSelectedAlbumMediaIds([]);
  };

  const notifyUsersNow = async (id: string, title: string, body: string) => {
    const userSnap = await getDocs(query(collection(db, 'accounts'), where('role', '==', 'user')));
    const ids = userSnap.docs.map(account => account.id);
    await sendPushNotification({ accountIds: ids, title: `お知らせ: ${title}`, body, url: `/menu?announcementId=${id}` });
  };

  const saveAnnouncement = async () => {
    if (!subject.trim() || !content.trim()) {
      setMessage('件名と内容を入力してください');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const scheduled = new Date(publishDate);
      scheduled.setHours(Number(publishHour), Number(publishMinute), 0, 0);
      const expiresAt = new Date(publishEndDate);
      expiresAt.setHours(23, 59, 59, 999);
      if (expiresAt.getTime() < scheduled.getTime()) {
        setMessage('終了日は開始日時以降にしてください');
        return;
      }
      const uploadedImages = await uploadAnnouncementImages();
      const publishImmediately = scheduled.getTime() <= Date.now();
      const existing = editingId ? items.find(item => item.id === editingId) : undefined;
      const existingPublishTime = existing ? toDate(existing.publishAt).getTime() : 0;
      const publishTimeChanged = !!existing && Math.abs(existingPublishTime - scheduled.getTime()) >= 60_000;
      const shouldNotifyNow = isActive && publishImmediately && (
        !existing || existing.notificationSent !== true || existing.isActive === false || publishTimeChanged
      );
      const payload = {
        subject: subject.trim(),
        content: content.trim(),
        imageUrl: uploadedImages.headerUrl,
        headerImageUrl: uploadedImages.headerUrl,
        headerImageStoragePath: uploadedImages.headerStoragePath,
        referenceImages: uploadedImages.references,
        retiredImageStoragePaths,
        isPromotional,
        isActive,
        publishAt: Timestamp.fromDate(scheduled),
        expiresAt: Timestamp.fromDate(expiresAt),
        notificationSent: publishImmediately ? true : false,
        updatedAt: serverTimestamp(),
        updatedBy: name,
      };
      let savedId = editingId;
      if (editingId) {
        await updateDoc(doc(db, 'announcements', editingId), payload);
      } else {
        const created = await addDoc(collection(db, 'announcements'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: name,
        });
        savedId = created.id;
      }
      if (savedId && shouldNotifyNow) {
        try {
          await notifyUsersNow(savedId, subject.trim(), content.trim());
          await updateDoc(doc(db, 'announcements', savedId), {
            notificationSentAt: serverTimestamp(),
          });
        } catch (error) {
          await updateDoc(doc(db, 'announcements', savedId), {
            notificationSent: false,
          }).catch(() => {});
          throw error;
        }
      }
      resetForm();
      setFormVisible(false);
      setMessage('保存しました');
    } catch (error: any) {
      setMessage(error?.message || '保存できませんでした');
    } finally {
      setSaving(false);
    }
  };

  const isEditor = role === 'admin' || role === 'staff';
  if (!isEditor) {
    return <SafeAreaView style={styles.container}><View style={styles.empty}><Text>この画面を開く権限がありません</Text></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/menu')}>
          <Ionicons name="chevron-back" size={26} color="#4D3830" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>お知らせ</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
          {!!message && <Text style={styles.successMessage}>{message}</Text>}
          {items.length === 0 ? (
            <View style={styles.empty}><Ionicons name="bulb-outline" size={42} color="#C2C9C9" /><Text style={styles.emptyText}>お知らせはまだありません</Text></View>
          ) : items.map(item => (
            <TouchableOpacity key={item.id} style={styles.itemCard} onPress={() => startEdit(item)} activeOpacity={0.82}>
              <View style={styles.itemBody}>
                <View style={styles.itemBadges}>
                  {item.isPromotional && <Text style={styles.promoBadge}>宣伝</Text>}
                  {item.isActive === false && <Text style={styles.hiddenBadge}>非表示</Text>}
                </View>
                <Text style={styles.itemTitle}>{item.subject}</Text>
                <Text style={styles.itemDate}>{formatPublishedAt(item.publishAt)}</Text>
                <Text style={styles.itemExcerpt} numberOfLines={2}>{item.content}</Text>
              </View>
              {(item.headerImageUrl || item.imageUrl) ? <Image source={{ uri: item.headerImageUrl || item.imageUrl }} style={styles.itemImage} /> : <View style={styles.itemImageEmpty}><Ionicons name="image-outline" size={24} color="#BBC4C4" /></View>}
            </TouchableOpacity>
          ))}
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={openCreateForm} activeOpacity={0.86} accessibilityRole="button" accessibilityLabel="お知らせを作成">
        <Ionicons name="add" size={34} color="#fff" />
      </TouchableOpacity>

      <Modal visible={formVisible} transparent animationType="fade" onRequestClose={closeForm}>
        <View style={styles.formModalOverlay}>
          <Pressable style={styles.modalDismissArea} onPress={closeForm} accessible={false} focusable={false} />
          <View style={styles.formModalCard}>
              <View style={styles.formModalHeader}>
                <Text style={styles.formModalTitle}>{editingId ? 'お知らせを編集' : 'お知らせを作成'}</Text>
                <TouchableOpacity style={styles.formModalClose} onPress={closeForm} accessibilityRole="button" accessibilityLabel="閉じる">
                  <Ionicons name="close" size={30} color="#332F2C" />
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>宣伝告知</Text>
          <View style={styles.segmented}>
            <TouchableOpacity style={[styles.segment, !isPromotional && styles.segmentActive]} onPress={() => setIsPromotional(false)}><Text style={[styles.segmentText, !isPromotional && styles.segmentTextActive]}>しない</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.segment, isPromotional && styles.segmentActive]} onPress={() => setIsPromotional(true)}><Text style={[styles.segmentText, isPromotional && styles.segmentTextActive]}>する</Text></TouchableOpacity>
          </View>

          <Text style={styles.label}>件名</Text>
          <TextInput style={styles.input} value={subject} onChangeText={setSubject} placeholder="例: 夏祭りのお知らせ" placeholderTextColor="#AAA" maxLength={80} />
          <Text style={styles.label}>内容</Text>
          <TextInput style={[styles.input, styles.contentInput]} value={content} onChangeText={setContent} placeholder="お知らせする内容を入力" placeholderTextColor="#AAA" multiline textAlignVertical="top" maxLength={1000} />

          <Text style={styles.label}>ヘッダー写真（任意）</Text>
          <Text style={styles.helperText}>利用者がお知らせを開いたとき、最上部に大きく表示されます</Text>
          <TouchableOpacity style={styles.headerImagePicker} onPress={pickHeaderImage}>
            {(localHeaderImageUri || headerImageUrl) ? <Image source={{ uri: localHeaderImageUri || headerImageUrl }} style={styles.previewImage} /> : <><Ionicons name="image-outline" size={30} color="#00AEB8" /><Text style={styles.imagePickerText}>画像を選択</Text></>}
          </TouchableOpacity>
          {(localHeaderImageUri || headerImageUrl) ? <TouchableOpacity style={styles.removeImage} onPress={() => {
            retireAnnouncementImage({ url: headerImageUrl, storagePath: headerImageStoragePath });
            setLocalHeaderImageUri('');
            setHeaderImageUrl('');
            setHeaderImageStoragePath(null);
          }}><Text style={styles.removeImageText}>ヘッダー写真を外す</Text></TouchableOpacity> : null}

          <View style={styles.referenceHeadingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>参考写真（任意）</Text>
              <Text style={styles.helperText}>複数の写真を追加できます</Text>
            </View>
            <TouchableOpacity style={styles.referenceAddButton} onPress={() => setPhotoSourceVisible(true)}>
              <Ionicons name="add" size={21} color="#fff" />
              <Text style={styles.referenceAddText}>追加</Text>
            </TouchableOpacity>
          </View>
          {(referenceImages.length + localReferenceUris.length) > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.referencePreviewRow}>
              {referenceImages.map((image, index) => (
                <View key={`${image.url}-${index}`} style={styles.referencePreviewWrap}>
                  <Image source={{ uri: image.url }} style={styles.referencePreview} />
                  <TouchableOpacity style={styles.referenceRemove} onPress={() => {
                    retireAnnouncementImage(image);
                    setReferenceImages(current => current.filter((_, i) => i !== index));
                  }}><Ionicons name="close" size={17} color="#fff" /></TouchableOpacity>
                </View>
              ))}
              {localReferenceUris.map((uri, index) => (
                <View key={`${uri}-${index}`} style={styles.referencePreviewWrap}>
                  <Image source={{ uri }} style={styles.referencePreview} />
                  <TouchableOpacity style={styles.referenceRemove} onPress={() => setLocalReferenceUris(current => current.filter((_, i) => i !== index))}><Ionicons name="close" size={17} color="#fff" /></TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          ) : <View style={styles.referenceEmpty}><Text style={styles.referenceEmptyText}>参考写真はまだありません</Text></View>}

          <Text style={styles.label}>掲載期間</Text>
          <TouchableOpacity
            style={styles.publishScheduleCard}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel="掲載期間を設定"
            onPress={() => {
              setCalendarTarget('start');
              setCalendarMonth(publishDate);
              setCalendarVisible(true);
            }}
          >
            <View style={styles.publishPeriodRow}>
              <View style={styles.publishDateButton}>
                <View style={styles.publishDateContent}>
                  <Text style={styles.publishFieldLabel}>開始日</Text>
                  <View style={styles.publishDateValueRow}><Text style={styles.publishDateText} numberOfLines={1} adjustsFontSizeToFit>{publishDate.getFullYear()}年{publishDate.getMonth() + 1}月{publishDate.getDate()}日</Text></View>
                </View>
              </View>
              <Text style={styles.publishRangeSeparator}>〜</Text>
              <View style={styles.publishDateButton}>
                <View style={styles.publishDateContent}>
                  <Text style={styles.publishFieldLabel}>終了日</Text>
                  <View style={styles.publishDateValueRow}><Text style={styles.publishDateText} numberOfLines={1} adjustsFontSizeToFit>{publishEndDate.getFullYear()}年{publishEndDate.getMonth() + 1}月{publishEndDate.getDate()}日</Text></View>
                </View>
              </View>
            </View>
            <View style={styles.publishScheduleDivider} />
            <View style={styles.publishTimeButton}>
                <Text style={styles.publishTimeLabel}>開始時刻</Text>
                <Text style={styles.publishTimeText}>{publishHour}:{publishMinute}〜</Text>
            </View>
          </TouchableOpacity>

          {editingId && <><Text style={styles.label}>利用者への表示</Text><TouchableOpacity style={[styles.visibilityButton, isActive && styles.visibilityButtonActive]} onPress={() => setIsActive(current => !current)}><Ionicons name={isActive ? 'eye-outline' : 'eye-off-outline'} size={20} color={isActive ? '#217A54' : '#7D7773'} /><Text style={[styles.visibilityText, isActive && styles.visibilityTextActive]}>{isActive ? '表示する' : '非表示にする'}</Text></TouchableOpacity></>}
          {!!message && <Text style={styles.errorMessage}>{message}</Text>}
          <TouchableOpacity style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={saveAnnouncement} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>{editingId ? '変更を保存する' : '投稿する'}</Text>}
          </TouchableOpacity>
              </ScrollView>
          </View>
        </View>
      </Modal>

      <AdminBottomNav active="home" />

      <Modal visible={calendarVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalDismissArea} onPress={() => setCalendarVisible(false)} accessible={false} focusable={false} />
          <View style={styles.calendarCard}>
            <View style={styles.rangeModalTitleRow}>
              <Text style={styles.rangeModalTitle}>掲載期間を選択</Text>
              <TouchableOpacity style={styles.rangeModalClose} onPress={() => setCalendarVisible(false)}><Ionicons name="close" size={28} color="#4D4641" /></TouchableOpacity>
            </View>
            <View style={styles.rangeSummaryRow}>
              <TouchableOpacity style={[styles.rangeSummary, calendarTarget === 'start' && styles.rangeSummaryStartActive]} onPress={() => { setCalendarTarget('start'); setCalendarMonth(publishDate); }}>
                <Text style={[styles.rangeSummaryCaption, calendarTarget === 'start' && styles.rangeSummaryStartText]}>開始日</Text>
                <Text style={styles.rangeSummaryDate}>{publishDate.getFullYear()}-{String(publishDate.getMonth() + 1).padStart(2, '0')}-{String(publishDate.getDate()).padStart(2, '0')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.rangeSummary, calendarTarget === 'end' && styles.rangeSummaryEndActive]} onPress={() => { setCalendarTarget('end'); setCalendarMonth(publishEndDate); }}>
                <Text style={[styles.rangeSummaryCaption, calendarTarget === 'end' && styles.rangeSummaryEndText]}>終了日</Text>
                <Text style={styles.rangeSummaryDate}>{publishEndDate.getFullYear()}-{String(publishEndDate.getMonth() + 1).padStart(2, '0')}-{String(publishEndDate.getDate()).padStart(2, '0')}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.calendarTargetLabel}>{calendarTarget === 'start' ? '開始日を選択してください' : '終了日を選択してください'}</Text>
            <View style={styles.calendarHeader}>
              <TouchableOpacity style={styles.roundButton} onPress={() => setCalendarMonth(date => new Date(date.getFullYear(), date.getMonth() - 1, 1))}><Ionicons name="chevron-back" size={22} color="#493B35" /></TouchableOpacity>
              <Text style={styles.calendarTitle}>{calendarMonth.getFullYear()}年{calendarMonth.getMonth() + 1}月</Text>
              <TouchableOpacity style={styles.roundButton} onPress={() => setCalendarMonth(date => new Date(date.getFullYear(), date.getMonth() + 1, 1))}><Ionicons name="chevron-forward" size={22} color="#493B35" /></TouchableOpacity>
            </View>
            <View style={styles.calendarGrid}>{WEEKDAYS.map(day => <Text key={day} style={styles.weekday}>{day}</Text>)}{calendarDays.map((day, index) => day === null ? <View key={`empty-${index}`} style={styles.dayCell} /> : (() => {
              const candidate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
              const candidateTime = candidate.getTime();
              const startTime = new Date(publishDate.getFullYear(), publishDate.getMonth(), publishDate.getDate()).getTime();
              const endTime = new Date(publishEndDate.getFullYear(), publishEndDate.getMonth(), publishEndDate.getDate()).getTime();
              const isStart = dateKey(candidate) === dateKey(publishDate);
              const isEnd = dateKey(candidate) === dateKey(publishEndDate);
              const isInRange = candidateTime > startTime && candidateTime < endTime;
              return <TouchableOpacity key={day} style={[styles.dayCell, isInRange && styles.dayCellInRange, isStart && styles.dayCellStart, isEnd && styles.dayCellEnd]} onPress={() => {
                if (calendarTarget === 'start') {
                  setPublishDate(candidate);
                  if (candidateTime > endTime) setPublishEndDate(candidate);
                  setCalendarTarget('end');
                  return;
                }
                if (candidateTime < startTime) {
                  setPublishDate(candidate);
                  setPublishEndDate(candidate);
                  setCalendarTarget('end');
                  return;
                }
                setPublishEndDate(candidate);
                setCalendarVisible(false);
                setTimeout(() => setTimeVisible(true), 160);
              }}><Text style={[styles.dayText, (isStart || isEnd) && styles.dayTextSelected]}>{day}</Text></TouchableOpacity>;
            })())}</View>
          </View>
        </View>
      </Modal>

      <Modal visible={timeVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalDismissArea} onPress={() => setTimeVisible(false)} accessible={false} focusable={false} />
          <View style={styles.timeCard}>
            <Text style={styles.timeTitle}>時間を選択</Text>
            <View style={styles.timeColumns}>
              <TimeWheel values={HOURS} value={publishHour} onChange={setPublishHour} />
              <Text style={styles.timeColon}>:</Text>
              <TimeWheel values={MINUTES} value={publishMinute} onChange={setPublishMinute} />
            </View>
            <TouchableOpacity style={styles.timeDone} onPress={() => setTimeVisible(false)}><Text style={styles.timeDoneText}>決定</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={photoSourceVisible} transparent animationType="fade" onRequestClose={() => setPhotoSourceVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalDismissArea} onPress={() => setPhotoSourceVisible(false)} accessible={false} focusable={false} />
          <View style={styles.photoSourceCard}>
            <View style={styles.photoSourceHeader}>
              <Text style={styles.photoSourceTitle}>参考写真を追加</Text>
              <TouchableOpacity style={styles.photoSourceClose} onPress={() => setPhotoSourceVisible(false)}><Ionicons name="close" size={28} color="#332F2C" /></TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.photoSourceChoice, styles.photoSourceAlbum]} onPress={openAlbumPicker}>
              <Ionicons name="images-outline" size={28} color="#16878E" />
              <View style={{ flex: 1 }}><Text style={styles.photoSourceChoiceTitle}>イベントアルバムから追加</Text><Text style={styles.photoSourceChoiceCaption}>今年度（4月から翌年3月）の写真を選択</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.photoSourceChoice, styles.photoSourceDevice]} onPress={pickReferenceImages}>
              <Ionicons name="phone-portrait-outline" size={28} color="#C34F76" />
              <View style={{ flex: 1 }}><Text style={styles.photoSourceChoiceTitle}>端末から追加</Text><Text style={styles.photoSourceChoiceCaption}>端末の写真を複数選択</Text></View>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={albumPickerVisible} transparent animationType="fade" onRequestClose={() => setAlbumPickerVisible(false)}>
        <View style={styles.albumOverlay}>
          <View style={styles.albumPickerCard}>
            <View style={styles.albumPickerHeader}>
              <View style={styles.albumPickerHeaderCenter}>
                <Text style={styles.albumPickerTitle}>イベントアルバムから追加</Text>
                <Text style={styles.albumPickerCount}>{selectedAlbumMediaIds.length}件選択中</Text>
              </View>
              <TouchableOpacity style={styles.albumPickerClose} onPress={() => setAlbumPickerVisible(false)}><Ionicons name="close" size={28} color="#332F2C" /></TouchableOpacity>
            </View>
            {albumLoading ? <View style={styles.albumStatus}><ActivityIndicator color="#00AEB8" /><Text style={styles.albumStatusText}>アルバムを読み込んでいます</Text></View> : albumEvents.length === 0 ? <View style={styles.albumStatus}><Ionicons name="images-outline" size={42} color="#BCC6C6" /><Text style={styles.albumStatusText}>今年度のイベントアルバムがありません</Text></View> : (
              <ScrollView style={styles.albumPickerScroll} contentContainerStyle={styles.albumList}>
                {albumEvents.map(event => {
                  const media = albumMedia.filter(image => image.category === event.category);
                  const expanded = expandedAlbumId === event.id;
                  const date = new Date(`${event.dateStr}T00:00:00`);
                  return <View key={event.id} style={styles.albumEventCard}>
                    <TouchableOpacity style={styles.albumEventHeader} onPress={() => setExpandedAlbumId(current => current === event.id ? null : event.id)}>
                      <View style={{ flex: 1 }}><Text style={styles.albumEventTitle}>{event.name}</Text><Text style={styles.albumEventDate}>{date.getFullYear()}年{date.getMonth() + 1}月{date.getDate()}日</Text></View>
                      <Text style={styles.albumEventCount}>{media.length}件</Text>
                      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={21} color="#557477" />
                    </TouchableOpacity>
                    {expanded && (media.length === 0 ? <Text style={styles.albumEventEmpty}>写真がありません</Text> : <View style={styles.albumGrid}>{media.map(image => {
                      const selected = selectedAlbumMediaIds.includes(image.id);
                      return <TouchableOpacity key={image.id} style={styles.albumMediaButton} onPress={() => setSelectedAlbumMediaIds(current => selected ? current.filter(id => id !== image.id) : [...current, image.id])}>
                        <Image source={{ uri: image.url }} style={styles.albumMediaImage} />
                        <View style={[styles.albumMediaCheck, selected && styles.albumMediaCheckSelected]}>{selected && <Ionicons name="checkmark" size={18} color="#fff" />}</View>
                      </TouchableOpacity>;
                    })}</View>)}
                  </View>;
                })}
              </ScrollView>
            )}
            <View style={styles.albumPickerFooter}>
              <TouchableOpacity style={styles.albumCancel} onPress={() => setAlbumPickerVisible(false)}><Text style={styles.albumCancelText}>閉じる</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.albumAdd, selectedAlbumMediaIds.length === 0 && styles.albumAddDisabled]} disabled={selectedAlbumMediaIds.length === 0} onPress={addSelectedAlbumImages}><Text style={styles.albumAddText}>選択した写真を追加</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <CropImageModal
        visible={!!cropImageUri}
        uri={cropImageUri}
        title="ヘッダー写真をトリミング"
        onCancel={() => setCropImageUri('')}
        onDone={uri => {
          retireAnnouncementImage({ url: headerImageUrl, storagePath: headerImageStoragePath });
          setLocalHeaderImageUri(uri);
          setCropImageUri('');
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF9F2' },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, backgroundColor: '#FFF8F0', borderBottomWidth: 1, borderColor: '#EEE3D8' },
  backButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#3E302A' },
  listContent: { padding: 12, paddingBottom: 170 },
  formContent: { padding: 14, paddingBottom: 30 },
  fab: { position: 'absolute', right: 18, bottom: 88, zIndex: 8, width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00AEB8', shadowColor: '#294B4D', shadowOpacity: 0.24, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 7 },
  formModalOverlay: { flex: 1, padding: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  modalDismissArea: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
  formModalCard: { width: '100%', maxWidth: 720, height: '92%', maxHeight: 900, overflow: 'hidden', borderRadius: 18, backgroundColor: '#FFF9F2', zIndex: 1 },
  formModalHeader: { minHeight: 64, paddingLeft: 18, paddingRight: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#E8DED4', backgroundColor: '#FFF' },
  formModalTitle: { flex: 1, fontSize: 20, fontWeight: '900', color: '#332F2C' },
  formModalClose: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  itemCard: { flexDirection: 'row', minHeight: 112, marginBottom: 10, padding: 12, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E7DCD1', shadowColor: '#715B4A', shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 },
  itemBody: { flex: 1, paddingRight: 10 },
  itemBadges: { flexDirection: 'row', gap: 6, minHeight: 20 },
  promoBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden', backgroundColor: '#FFF0B8', color: '#8B5D00', fontSize: 10, fontWeight: '900' },
  hiddenBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden', backgroundColor: '#EEE', color: '#666', fontSize: 10, fontWeight: '900' },
  itemTitle: { fontSize: 16, fontWeight: '900', color: '#302B28', marginTop: 3 },
  itemDate: { fontSize: 10, fontWeight: '700', color: '#8B817A', marginTop: 4 },
  itemExcerpt: { fontSize: 12, color: '#625B57', lineHeight: 17, marginTop: 5 },
  itemImage: { width: 84, height: 84, borderRadius: 9, backgroundColor: '#EDF0F0' },
  itemImageEmpty: { width: 84, height: 84, borderRadius: 9, backgroundColor: '#F1F3F3', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, fontWeight: '900', color: '#413732', marginTop: 15, marginBottom: 7 },
  segmented: { flexDirection: 'row', padding: 3, borderRadius: 10, backgroundColor: '#EEF1F1' },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  segmentActive: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#73C8CC' },
  segmentText: { fontSize: 14, fontWeight: '800', color: '#777' },
  segmentTextActive: { color: '#087D84' },
  input: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: '#D8D8D8', backgroundColor: '#fff', paddingHorizontal: 12, fontSize: 15, color: '#222' },
  contentInput: { minHeight: 150, paddingTop: 12 },
  helperText: { marginTop: -3, marginBottom: 7, color: '#7E7772', fontSize: 11, lineHeight: 16 },
  headerImagePicker: { width: '100%', aspectRatio: 16 / 9, maxHeight: 260, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#8ED4D8', backgroundColor: '#F1FBFB', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  imagePickerText: { marginTop: 7, fontSize: 13, fontWeight: '900', color: '#16878E' },
  previewImage: { width: '100%', height: '100%' },
  removeImage: { alignSelf: 'flex-end', padding: 8 },
  removeImageText: { color: '#C74646', fontSize: 12, fontWeight: '800' },
  referenceHeadingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  referenceAddButton: { minHeight: 40, marginBottom: 6, paddingHorizontal: 14, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#00AEB8' },
  referenceAddText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  referencePreviewRow: { gap: 8, paddingVertical: 5, paddingRight: 10 },
  referencePreviewWrap: { position: 'relative', width: 112, height: 84, borderRadius: 9, overflow: 'hidden', backgroundColor: '#EEF1F1' },
  referencePreview: { width: '100%', height: '100%' },
  referenceRemove: { position: 'absolute', top: 4, right: 4, width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(38,31,28,0.72)' },
  referenceEmpty: { minHeight: 72, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: '#D5DBDB', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFBFB' },
  referenceEmptyText: { color: '#969B9B', fontSize: 12, fontWeight: '700' },
  publishScheduleCard: { overflow: 'hidden', borderRadius: 10, borderWidth: 1, borderColor: '#A8D9DC', backgroundColor: '#F2FBFB' },
  publishPeriodRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 48, paddingHorizontal: 6 },
  publishDateButton: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 4 },
  publishDateContent: { flex: 1, minWidth: 0, alignItems: 'center' },
  publishFieldLabel: { marginBottom: 2, fontSize: 9, fontWeight: '800', color: '#668084' },
  publishDateValueRow: { width: '100%', minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  publishDateText: { flexShrink: 1, fontSize: 13, fontWeight: '900', color: '#314D50', textAlign: 'center' },
  publishRangeSeparator: { fontSize: 17, fontWeight: '900', color: '#6B7778' },
  publishScheduleDivider: { height: 1, marginHorizontal: 14, backgroundColor: '#CDE6E8' },
  publishTimeButton: { alignSelf: 'center', minWidth: 148, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 12 },
  publishTimeLabel: { fontSize: 12, fontWeight: '800', color: '#668084' },
  publishTimeText: { fontSize: 14, fontWeight: '900', color: '#314D50' },
  visibilityButton: { minHeight: 46, borderRadius: 10, backgroundColor: '#F2F2F2', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  visibilityButtonActive: { backgroundColor: '#E8F8EF', borderWidth: 1, borderColor: '#A9DFC0' },
  visibilityText: { color: '#6F6965', fontWeight: '900' },
  visibilityTextActive: { color: '#217A54' },
  saveButton: { marginTop: 24, minHeight: 54, borderRadius: 13, backgroundColor: '#00AEB8', alignItems: 'center', justifyContent: 'center' },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  errorMessage: { marginTop: 14, color: '#C53E3E', fontWeight: '800', textAlign: 'center' },
  successMessage: { marginBottom: 10, color: '#25805B', fontWeight: '900', textAlign: 'center' },
  empty: { flex: 1, minHeight: 240, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyText: { marginTop: 10, color: '#8A9292', fontWeight: '800' },
  modalOverlay: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: 18 },
  calendarCard: { width: '100%', maxWidth: 440, borderRadius: 18, backgroundColor: '#fff', padding: 14, zIndex: 1 },
  rangeModalTitleRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  rangeModalTitle: { fontSize: 20, fontWeight: '900', color: '#302B28' },
  rangeModalClose: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  rangeSummaryRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  rangeSummary: { flex: 1, minHeight: 68, borderRadius: 11, borderWidth: 1, borderColor: '#D8DEDE', backgroundColor: '#FAFBFB', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  rangeSummaryStartActive: { borderColor: '#00AEB8', backgroundColor: '#E9F9FA' },
  rangeSummaryEndActive: { borderColor: '#F0A22E', backgroundColor: '#FFF6E9' },
  rangeSummaryCaption: { marginBottom: 4, fontSize: 10, fontWeight: '900', color: '#777' },
  rangeSummaryStartText: { color: '#008B93' },
  rangeSummaryEndText: { color: '#C97800' },
  rangeSummaryDate: { fontSize: 15, fontWeight: '900', color: '#302C29' },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  roundButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF6EC', borderWidth: 1, borderColor: '#EED7BE' },
  calendarTitle: { fontSize: 18, fontWeight: '900', color: '#352F2B' },
  calendarTargetLabel: { marginBottom: 10, color: '#267A80', fontSize: 15, fontWeight: '900', textAlign: 'center' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: '14.2857%', textAlign: 'center', paddingVertical: 7, fontSize: 12, fontWeight: '900', color: '#6F6965' },
  dayCell: { width: '14.2857%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  dayCellInRange: { backgroundColor: '#F6F0E5', borderRadius: 0 },
  dayCellStart: { backgroundColor: '#00AEB8' },
  dayCellEnd: { backgroundColor: '#F0A22E' },
  dayText: { fontSize: 14, fontWeight: '800', color: '#302C29' },
  dayTextSelected: { color: '#fff' },
  timeCard: { width: '100%', maxWidth: 340, borderRadius: 24, backgroundColor: '#fff', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 16, overflow: 'hidden', zIndex: 1 },
  timeTitle: { fontSize: 18, fontWeight: '900', color: '#302B28', textAlign: 'center', marginBottom: 14 },
  timeColumns: { height: TIME_WHEEL_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  timeWheelViewport: { width: 88, height: TIME_WHEEL_HEIGHT, overflow: 'hidden' },
  timeWheelSelection: { position: 'absolute', zIndex: 0, left: 8, right: 8, top: (TIME_WHEEL_HEIGHT - TIME_ITEM_HEIGHT) / 2, height: TIME_ITEM_HEIGHT, borderRadius: 12, backgroundColor: '#FFF5D6', borderWidth: 1, borderColor: '#F4D778' },
  timeList: { width: '100%', height: TIME_WHEEL_HEIGHT, zIndex: 1 },
  timeListContent: { paddingVertical: (TIME_WHEEL_HEIGHT - TIME_ITEM_HEIGHT) / 2 },
  timeOption: { height: TIME_ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  timeOptionText: { fontSize: 19, color: '#8A8580', fontWeight: '700' },
  timeOptionTextSelected: { color: '#D6A91E', fontSize: 22, fontWeight: '900' },
  timeColon: { fontSize: 24, fontWeight: 'bold', color: '#7D7772', marginHorizontal: 8 },
  timeDone: { minHeight: 48, borderRadius: 11, backgroundColor: '#00AEB8', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  timeDoneText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  photoSourceCard: { width: '100%', maxWidth: 480, borderRadius: 16, backgroundColor: '#fff', padding: 18, zIndex: 1 },
  photoSourceHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  photoSourceTitle: { fontSize: 20, fontWeight: '900', color: '#332F2C' },
  photoSourceClose: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  photoSourceChoice: { minHeight: 88, marginTop: 10, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  photoSourceAlbum: { backgroundColor: '#EFF9FA', borderColor: '#A9DADC' },
  photoSourceDevice: { backgroundColor: '#FFF2F6', borderColor: '#EBC1CF' },
  photoSourceChoiceTitle: { color: '#302B28', fontSize: 15, fontWeight: '900' },
  photoSourceChoiceCaption: { marginTop: 4, color: '#77716D', fontSize: 11, lineHeight: 16 },
  albumOverlay: { flex: 1, padding: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  albumPickerCard: { width: '100%', maxWidth: 680, height: '88%', maxHeight: 820, borderRadius: 16, overflow: 'hidden', backgroundColor: '#fff' },
  albumPickerHeader: { minHeight: 68, position: 'relative', paddingHorizontal: 52, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderColor: '#E7E7E7' },
  albumPickerHeaderCenter: { alignItems: 'center' },
  albumPickerTitle: { color: '#302B28', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  albumPickerCount: { marginTop: 3, color: '#00AEB8', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  albumPickerClose: { position: 'absolute', right: 8, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  albumStatus: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  albumStatusText: { marginTop: 10, color: '#7E8585', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  albumPickerScroll: { flex: 1, backgroundColor: '#F5F7F7' },
  albumList: { padding: 10, gap: 8 },
  albumEventCard: { overflow: 'hidden', borderRadius: 10, borderWidth: 1, borderColor: '#C8DDDE', backgroundColor: '#fff' },
  albumEventHeader: { minHeight: 66, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EFF9FA' },
  albumEventTitle: { color: '#302B28', fontSize: 14, fontWeight: '900' },
  albumEventDate: { marginTop: 3, color: '#6E6A67', fontSize: 11 },
  albumEventCount: { color: '#267A80', fontSize: 12, fontWeight: '900' },
  albumEventEmpty: { padding: 18, color: '#8A8F8F', fontSize: 12, textAlign: 'center' },
  albumGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 2 },
  albumMediaButton: { width: '33.333%', aspectRatio: 1, padding: 1, position: 'relative' },
  albumMediaImage: { width: '100%', height: '100%', backgroundColor: '#E7ECEC' },
  albumMediaCheck: { position: 'absolute', top: 7, right: 7, width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  albumMediaCheckSelected: { backgroundColor: '#00AEB8' },
  albumPickerFooter: { minHeight: 68, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderColor: '#E7E7E7' },
  albumCancel: { minHeight: 44, paddingHorizontal: 18, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F0F0' },
  albumCancelText: { color: '#555', fontSize: 13, fontWeight: '900' },
  albumAdd: { flex: 1, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00AEB8' },
  albumAddDisabled: { opacity: 0.4 },
  albumAddText: { color: '#fff', fontSize: 13, fontWeight: '900' },
});
