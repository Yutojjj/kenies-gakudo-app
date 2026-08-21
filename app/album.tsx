import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Image as CachedImage } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore';
import { deleteObject, getDownloadURL, listAll, ref, uploadBytes } from 'firebase/storage';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { memo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import AdminBottomNav from '../components/AdminBottomNav';
import SwipeTabPager from '../components/SwipeTabPager';
import { COLORS } from '../constants/theme';
import { db, storage } from '../firebase';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const INITIAL_MEDIA_COUNT = 24;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;

type AlbumMedia = {
  id: string;
  uri: string;
  storagePath?: string;
  mediaType: 'image' | 'video';
  duration?: number | null;
};

type AlbumEvent = {
  id: string;
  name: string;
  code: string;
  category: string;
  dateStr?: string;
};

type CalendarEvent = {
  id: string;
  dateStr: string;
  title: string;
  hidden?: boolean;
};

const DIRECTORY_DB_NAME = 'kenies-album-directory';
const DIRECTORY_STORE_NAME = 'handles';
const DIRECTORY_HANDLE_KEY = 'media-library';

const openDirectoryDatabase = (): Promise<IDBDatabase | null> => {
  if (Platform.OS !== 'web' || typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DIRECTORY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DIRECTORY_STORE_NAME)) {
        request.result.createObjectStore(DIRECTORY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
};

const loadSavedDirectoryHandle = async (): Promise<any | null> => {
  const database = await openDirectoryDatabase();
  if (!database) return null;
  return new Promise((resolve) => {
    const request = database.transaction(DIRECTORY_STORE_NAME, 'readonly').objectStore(DIRECTORY_STORE_NAME).get(DIRECTORY_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
};

const saveDirectoryHandle = async (handle: any) => {
  const database = await openDirectoryDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const request = database.transaction(DIRECTORY_STORE_NAME, 'readwrite').objectStore(DIRECTORY_STORE_NAME).put(handle, DIRECTORY_HANDLE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
};

const isVisualMediaFile = (file: File) => {
  if (file.type.startsWith('image/') || file.type.startsWith('video/')) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|mp4|mov|m4v|webm)$/i.test(file.name);
};

const fileToPickerAsset = (file: File): ImagePicker.ImagePickerAsset => {
  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
  return {
    uri: URL.createObjectURL(file),
    width: 0,
    height: 0,
    type: isVideo ? 'video' : 'image',
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
    duration: null,
    file,
  };
};

const getMediaType = (item: any): 'image' | 'video' => {
  if (item?.mediaType === 'video') return 'video';
  const value = `${item?.mimeType || ''} ${item?.storagePath || ''} ${item?.uri || ''}`.toLowerCase();
  return /video|\.mp4|\.mov|\.m4v|\.webm/.test(value) ? 'video' : 'image';
};

const getStoragePath = (item: AlbumMedia) => {
  if (item.storagePath) return item.storagePath;
  try {
    const match = item.uri.match(/\/o\/([^?]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
};

const AlbumMediaThumbnail = memo(function AlbumMediaThumbnail({ item }: { item: AlbumMedia }) {
  const [imageUri, setImageUri] = useState(item.uri);
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const refreshAttemptedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    refreshAttemptedRef.current = false;
    setImageState('loading');
    const storagePath = getStoragePath(item);
    if (!storagePath) {
      setImageUri(item.uri);
      return () => { cancelled = true; };
    }
    getDownloadURL(ref(storage, storagePath))
      .then(currentUri => {
        if (!cancelled) setImageUri(currentUri);
      })
      .catch(error => {
        console.warn('アルバム画像URLの取得に失敗しました', error);
        if (!cancelled) setImageState('failed');
      });
    return () => { cancelled = true; };
  }, [item.uri, item.storagePath]);

  const retryImage = async () => {
    setImageState('loading');
    try {
      const storagePath = getStoragePath(item);
      const freshUri = storagePath
        ? await getDownloadURL(ref(storage, storagePath))
        : item.uri;
      const separator = freshUri.includes('?') ? '&' : '?';
      setImageUri(`${freshUri}${separator}reload=${Date.now()}`);
    } catch (error) {
      console.warn('アルバム画像URLの再取得に失敗しました', error);
      setImageState('failed');
    }
  };

  const handleImageError = () => {
    if (!refreshAttemptedRef.current) {
      refreshAttemptedRef.current = true;
      retryImage();
      return;
    }
    setImageState('failed');
  };

  useEffect(() => {
    if (item.mediaType !== 'image' || imageState !== 'loading') return;
    const timeout = setTimeout(handleImageError, 12000);
    return () => clearTimeout(timeout);
  }, [imageState, imageUri, item.mediaType]);

  if (item.mediaType === 'video') {
    return (
      <View style={styles.videoThumbnail}>
        <View style={styles.videoPlayCircle}>
          <Ionicons name="play" size={24} color="#FFFFFF" />
        </View>
        <Text style={styles.videoThumbnailText}>動画</Text>
      </View>
    );
  }
  if (imageState === 'failed') {
    return (
      <TouchableOpacity style={styles.mediaFailed} onPress={retryImage} activeOpacity={0.75}>
        <Ionicons name="refresh" size={24} color={COLORS.primary} />
        <Text style={styles.mediaFailedText}>再読み込み</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.photo}>
      {Platform.OS === 'web' ? (
        <Image
          source={{ uri: imageUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onLoad={() => setImageState('loaded')}
          onError={handleImageError}
        />
      ) : (
        <CachedImage
          source={{ uri: imageUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory"
          transition={160}
          onLoad={() => setImageState('loaded')}
          onError={handleImageError}
        />
      )}
      {imageState === 'loading' && (
        <View style={styles.mediaLoadingOverlay}>
          <ActivityIndicator size="small" color={COLORS.primary} />
        </View>
      )}
    </View>
  );
});

function FullScreenMedia({ item, width, height }: { item: AlbumMedia; width: number; height: number }) {
  const [currentUri, setCurrentUri] = useState('');
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const refreshAttemptedRef = useRef(false);

  const resolveMediaUri = async (forceReload = false) => {
    const storagePath = getStoragePath(item);
    const freshUri = storagePath ? await getDownloadURL(ref(storage, storagePath)) : item.uri;
    if (!forceReload) return freshUri;
    const separator = freshUri.includes('?') ? '&' : '?';
    return `${freshUri}${separator}reload=${Date.now()}`;
  };

  useEffect(() => {
    let cancelled = false;
    refreshAttemptedRef.current = false;
    setCurrentUri('');
    setLoadState('loading');
    resolveMediaUri()
      .then(uri => { if (!cancelled) setCurrentUri(uri); })
      .catch(error => {
        console.warn('アルバムメディアURLの取得に失敗しました', error);
        if (!cancelled) setLoadState('failed');
      });
    return () => { cancelled = true; };
  }, [item.id, item.uri, item.storagePath]);

  const retryMedia = async () => {
    setLoadState('loading');
    try {
      setCurrentUri(await resolveMediaUri(true));
    } catch (error) {
      console.warn('全画面メディアの再取得に失敗しました', error);
      setLoadState('failed');
    }
  };

  const handleMediaError = () => {
    if (!refreshAttemptedRef.current) {
      refreshAttemptedRef.current = true;
      void retryMedia();
      return;
    }
    setLoadState('failed');
  };

  useEffect(() => {
    if (!currentUri || loadState !== 'loading') return;
    const timeout = setTimeout(handleMediaError, 15000);
    return () => clearTimeout(timeout);
  }, [currentUri, loadState]);

  const player = useVideoPlayer(item.mediaType === 'video' && currentUri ? currentUri : null, currentPlayer => {
    currentPlayer.loop = false;
  });

  if (loadState === 'failed') {
    return (
      <TouchableOpacity style={[styles.fullScreenMediaStatus, { width, height }]} onPress={retryMedia}>
        <Ionicons name="refresh" size={38} color="#FFFFFF" />
        <Text style={styles.fullScreenMediaStatusText}>タップして再読み込み</Text>
      </TouchableOpacity>
    );
  }

  if (!currentUri) {
    return (
      <View style={[styles.fullScreenMediaStatus, { width, height }]}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  if (item.mediaType === 'video') {
    return <VideoView player={player} style={{ width, height }} nativeControls contentFit="contain" />;
  }
  if (Platform.OS === 'web') {
    return <Image source={{ uri: currentUri }} style={{ width, height }} resizeMode="contain" onLoad={() => setLoadState('loaded')} onError={handleMediaError} />;
  }
  return <CachedImage source={{ uri: currentUri }} style={{ width, height }} contentFit="contain" cachePolicy="memory-disk" onLoad={() => setLoadState('loaded')} onError={handleMediaError} />;
}

// iOSかどうかを判定するヘルパー
const isIOSWeb = Platform.OS === 'web' && /iPad|iPhone|iPod/.test(navigator.userAgent);

const ALBUM_IMAGES = {
  watch: require('../assets/menu/album_watch.png'),
  add:   require('../assets/menu/album_add.png'),
};

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
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaLoadError, setMediaLoadError] = useState('');
  const [mediaReloadKey, setMediaReloadKey] = useState(0);
  
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth() + 1);
  const [dateJumpPicker, setDateJumpPicker] = useState<'year' | 'month' | null>(null);
  const [selectedAlbumDate, setSelectedAlbumDate] = useState<string | null>(null);
  const [isChoosingAddDate, setIsChoosingAddDate] = useState(false);
  const [addMenuVisible, setAddMenuVisible] = useState(false);
  const [addTargetDate, setAddTargetDate] = useState<string | null>(null);
  
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
  const [webGalleryVisible, setWebGalleryVisible] = useState(false);
  const [webGalleryLoading, setWebGalleryLoading] = useState(false);
  const [webGalleryAssets, setWebGalleryAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [webGallerySelectedUris, setWebGallerySelectedUris] = useState<string[]>([]);
  const [webGalleryDirectoryName, setWebGalleryDirectoryName] = useState('');
  const [webGalleryNeedsDirectory, setWebGalleryNeedsDirectory] = useState(false);
  
  const [albumPhotos, setAlbumPhotos] = useState<Record<string, AlbumMedia[]>>({});
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});
  const [visibleMediaCounts, setVisibleMediaCounts] = useState<Record<string, number>>({});

  const [albumEvents, setAlbumEvents] = useState<AlbumEvent[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [unlockedEvents, setUnlockedEvents] = useState<string[]>([]);
  const [unlockModalVisible, setUnlockModalVisible] = useState(false);
  const [unlockCodeInput, setUnlockCodeInput] = useState('');

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);

  const flatListRef = useRef<FlatList>(null);
  const webGalleryResolverRef = useRef<((result: ImagePicker.ImagePickerResult) => void) | null>(null);
  const webDirectoryHandleRef = useRef<any>(null);
  const fullScreenDragStartIndexRef = useRef(0);
  const fullScreenProgrammaticScrollRef = useRef(false);

  const onScrollToIndexFailed = (info: { index: number, highestMeasuredFrameIndex: number, averageItemLength: number }) => {
    setTimeout(() => {
      flatListRef.current?.scrollToIndex({ index: info.index, animated: false });
    }, 100);
  };

  const scrollToIndex = (index: number) => {
    if (fullScreenPhotos && index >= 0 && index < fullScreenPhotos.length) {
      fullScreenProgrammaticScrollRef.current = true;
      fullScreenDragStartIndexRef.current = index;
      setFullScreenIndex(index);
      flatListRef.current?.scrollToIndex({ index, animated: true });
    }
  };

  const settleFullScreenPage = (offsetX: number) => {
    if (!fullScreenPhotos?.length) return;
    const rawIndex = Math.max(0, Math.min(fullScreenPhotos.length - 1, Math.round(offsetX / windowWidth)));
    if (fullScreenProgrammaticScrollRef.current) {
      fullScreenProgrammaticScrollRef.current = false;
      setFullScreenIndex(rawIndex);
      fullScreenDragStartIndexRef.current = rawIndex;
      flatListRef.current?.scrollToOffset({ offset: rawIndex * windowWidth, animated: false });
      return;
    }

    const startIndex = fullScreenDragStartIndexRef.current;
    const targetIndex = Math.max(startIndex - 1, Math.min(startIndex + 1, rawIndex));
    setFullScreenIndex(targetIndex);
    fullScreenDragStartIndexRef.current = targetIndex;
    // ブラウザの慣性スクロールが画像の境界から数pxずれて止まると、
    // FlatListの未描画領域が黒く見えるため、必ず1枚の先頭へ固定する。
    flatListRef.current?.scrollToOffset({ offset: targetIndex * windowWidth, animated: false });
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
        }
      }
    };
    fetchUser();

    AsyncStorage.getItem('unlockedEvents').then(res => {
      if (res && isMounted) { try { setUnlockedEvents(JSON.parse(res)); } catch {} }
    });
    AsyncStorage.removeItem('albumMediaCacheV2').catch(() => {});

    setMediaLoadError('');
    // メタデータだけを同期し、実画像・動画はセクションを開いた時に読み込む。
    const unsubPhotos = onSnapshot(collection(db, 'albums2'), (photosSnap) => {
      if (!isMounted) return;
      const photosData: Record<string, AlbumMedia[]> = {};
      photosSnap.forEach(d => {
        const item = d.data();
        const key = item.category as string;
        if (!key || !item.uri) return;
        if (!photosData[key]) photosData[key] = [];
        photosData[key].push({
          id: d.id,
          uri: item.uri,
          storagePath: item.storagePath,
          mediaType: getMediaType(item),
          duration: item.duration ?? null,
        });
      });
      setAlbumPhotos(photosData);
      setMediaLoading(false);
      setMediaLoadError('');
    }, (e) => {
      console.warn('albums読み込みエラー:', e);
      if (!isMounted) return;
      setMediaLoading(false);
      setMediaLoadError('アルバムを読み込めませんでした');
    });

    const unsubEvents = onSnapshot(collection(db, 'album_events2'), (eventsSnap) => {
      if (!isMounted) return;
      const evs = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() } as AlbumEvent));
      setAlbumEvents(evs);
    }, (e) => console.warn('album_events読み込みエラー:', e));

    const unsubCalendarEvents = onSnapshot(collection(db, 'events'), (eventsSnap) => {
      if (!isMounted) return;
      const events = eventsSnap.docs.flatMap(eventDoc => {
        const data = eventDoc.data();
        const dateStr = String(data.dateStr || eventDoc.id || '');
        const title = String(data.title || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !title) return [];
        return [{ id: eventDoc.id, dateStr, title, hidden: !!data.hidden }];
      });
      setCalendarEvents(events);
    }, (e) => console.warn('events読み込みエラー:', e));

    return () => { isMounted = false; unsubPhotos(); unsubEvents(); unsubCalendarEvents(); };
  }, [role, name, mediaReloadKey]);

  const toggleExpand = (key: string) => {
    setExpandedDates(prev => ({ ...prev, [key]: !prev[key] }));
    setVisibleMediaCounts(prev => prev[key] ? prev : { ...prev, [key]: INITIAL_MEDIA_COUNT });
  };

  const uploadAlbumAsset = async (asset: ImagePicker.ImagePickerAsset, category: string) => {
    const mediaType: 'image' | 'video' = asset.type === 'video' || asset.mimeType?.startsWith('video/') ? 'video' : 'image';
    const maxBytes = mediaType === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (asset.fileSize && asset.fileSize > maxBytes) {
      const maxMb = Math.round(maxBytes / 1024 / 1024);
      throw new Error(`${asset.fileName || (mediaType === 'video' ? '動画' : '画像')}は${maxMb}MB以下にしてください。`);
    }

    const response = await fetch(asset.uri);
    const blob = await response.blob();
    const nameExtension = asset.fileName?.split('.').pop()?.toLowerCase();
    const mimeExtension = asset.mimeType?.split('/').pop()?.replace('quicktime', 'mov').replace('jpeg', 'jpg');
    const extension = nameExtension || mimeExtension || (mediaType === 'video' ? 'mp4' : 'jpg');
    const filename = `${mediaType}_${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`;
    const storagePath = `albums/${filename}`;
    const storageReference = ref(storage, storagePath);
    await uploadBytes(storageReference, blob, asset.mimeType ? { contentType: asset.mimeType } : undefined);
    const downloadUrl = await getDownloadURL(storageReference);
    await addDoc(collection(db, 'albums2'), {
      uri: downloadUrl,
      storagePath,
      mediaType,
      mimeType: asset.mimeType || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg'),
      duration: asset.duration ?? null,
      width: asset.width || null,
      height: asset.height || null,
      uploader: name || '不明',
      category,
      createdAt: serverTimestamp(),
    });
  };

  const releasePickerAssets = (assets: ImagePicker.ImagePickerAsset[]) => {
    assets.forEach(asset => {
      if (asset.uri.startsWith('blob:')) URL.revokeObjectURL(asset.uri);
    });
  };

  const readDirectoryAssets = async (directoryHandle: any) => {
    const files: File[] = [];
    const walk = async (handle: any, depth: number) => {
      if (depth > 4 || files.length >= 800) return;
      for await (const entry of handle.values()) {
        if (files.length >= 800) break;
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          if (isVisualMediaFile(file)) files.push(file);
        } else if (entry.kind === 'directory') {
          await walk(entry, depth + 1);
        }
      }
    };
    await walk(directoryHandle, 0);
    files.sort((a, b) => b.lastModified - a.lastModified);
    return files.map(fileToPickerAsset);
  };

  const loadWebGalleryDirectory = async (directoryHandle: any) => {
    setWebGalleryLoading(true);
    setWebGalleryNeedsDirectory(false);
    try {
      releasePickerAssets(webGalleryAssets);
      const assets = await readDirectoryAssets(directoryHandle);
      webDirectoryHandleRef.current = directoryHandle;
      setWebGalleryDirectoryName(directoryHandle.name || '写真フォルダ');
      setWebGalleryAssets(assets);
      setWebGallerySelectedUris([]);
    } catch (error) {
      console.warn('写真フォルダの読み込みに失敗しました', error);
      setWebGalleryNeedsDirectory(true);
      setWebGalleryAssets([]);
    } finally {
      setWebGalleryLoading(false);
    }
  };

  const chooseWebGalleryDirectory = async () => {
    try {
      const picker = (window as any).showDirectoryPicker;
      if (typeof picker === 'function') {
        const handle = await picker({ id: 'kenies-album-media', mode: 'read', startIn: 'pictures' });
        await saveDirectoryHandle(handle);
        await loadWebGalleryDirectory(handle);
        return;
      }

      // AndroidなどFile System Access API非対応のブラウザでも、最初に
      // 写真フォルダを選んでもらい、その中身を同じアプリ内一覧へ表示する。
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'image/*,video/*';
      input.setAttribute('webkitdirectory', '');
      input.onchange = () => {
        const files = Array.from(input.files || []).filter(isVisualMediaFile);
        files.sort((a, b) => b.lastModified - a.lastModified);
        releasePickerAssets(webGalleryAssets);
        setWebGalleryAssets(files.map(fileToPickerAsset));
        setWebGallerySelectedUris([]);
        setWebGalleryDirectoryName(files[0]?.webkitRelativePath?.split('/')[0] || '写真フォルダ');
        setWebGalleryNeedsDirectory(false);
        setWebGalleryLoading(false);
      };
      input.click();
    } catch (error: any) {
      if (error?.name !== 'AbortError') console.warn('写真フォルダを選択できませんでした', error);
    }
  };

  const openWebMediaGallery = async (): Promise<ImagePicker.ImagePickerResult> => {
    setWebGalleryVisible(true);
    setWebGalleryLoading(true);
    setWebGalleryNeedsDirectory(false);
    setWebGallerySelectedUris([]);

    const resultPromise = new Promise<ImagePicker.ImagePickerResult>((resolve) => {
      webGalleryResolverRef.current = resolve;
    });

    void (async () => {
      const savedHandle = webDirectoryHandleRef.current || await loadSavedDirectoryHandle();
      if (!savedHandle) {
        setWebGalleryNeedsDirectory(true);
        setWebGalleryLoading(false);
        return;
      }
      try {
        const permission = await savedHandle.queryPermission({ mode: 'read' });
        if (permission === 'granted') await loadWebGalleryDirectory(savedHandle);
        else {
          setWebGalleryNeedsDirectory(true);
          setWebGalleryLoading(false);
        }
      } catch {
        setWebGalleryNeedsDirectory(true);
        setWebGalleryLoading(false);
      }
    })();

    return resultPromise;
  };

  const finishWebMediaGallery = (confirmed: boolean) => {
    const selectedSet = new Set(webGallerySelectedUris);
    const selectedAssets = confirmed ? webGalleryAssets.filter(asset => selectedSet.has(asset.uri)) : [];
    releasePickerAssets(webGalleryAssets.filter(asset => !selectedSet.has(asset.uri) || !confirmed));
    setWebGalleryVisible(false);
    setWebGalleryAssets([]);
    setWebGallerySelectedUris([]);
    const resolver = webGalleryResolverRef.current;
    webGalleryResolverRef.current = null;
    resolver?.(confirmed && selectedAssets.length > 0
      ? { canceled: false, assets: selectedAssets }
      : { canceled: true, assets: null });
  };

  const launchWebMediaPicker = (): Promise<ImagePicker.ImagePickerResult> => (
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*';
      input.multiple = true;

      input.onchange = () => {
        const files = Array.from(input.files || []).filter(isVisualMediaFile);
        resolve(files.length > 0
          ? { canceled: false, assets: files.map(fileToPickerAsset) }
          : { canceled: true, assets: null });
      };
      input.oncancel = () => resolve({ canceled: true, assets: null });
      input.click();
    })
  );

  const launchAlbumMediaPicker = async () => {
    // Web/PWAでは端末標準の写真・動画選択画面を直接開く。
    // captureを指定しないことで、カメラではなく保存済みメディアを選択させる。
    if (Platform.OS === 'web') {
      return launchWebMediaPicker();
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('権限エラー', '写真ライブラリへのアクセスを許可してください');
      return null;
    }

    return ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: 0,
      quality: 0.6,
      videoMaxDuration: 180,
      presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
    });
  };

  const closeAddFlow = () => {
    setCalendarModalVisible(false);
    setAddMenuVisible(false);
    setEventChoiceModalVisible(false);
    setNewEventCalendarVisible(false);
    setEventModalVisible(false);
    setAddToExistingModalVisible(false);
    setAddTargetDate(null);
  };

  const pickImages = async (targetTitle: string, targetKey: string) => {
    const result = await launchAlbumMediaPicker();
    if (!result) return;

    if (!result.canceled) {
      closeAddFlow();
      setIsUploading(true);
      try {
        let uploadedCount = 0;
        for (const asset of result.assets) {
          await uploadAlbumAsset(asset, targetKey);
          uploadedCount++;
        }
        if (Platform.OS === 'web') window.alert(`${targetTitle} に ${uploadedCount} 件保存しました`);
        else Alert.alert('完了', `${targetTitle} に写真・動画を ${uploadedCount} 件保存しました`);
      } catch (e: any) {
        console.error('upload error:', e);
        const msg = e?.message || String(e);
        if (Platform.OS === 'web') window.alert('アップロード失敗: ' + msg);
        else Alert.alert('エラー', 'アップロード失敗: ' + msg);
      } finally {
        releasePickerAssets(result.assets);
        setIsUploading(false);
      }
    }
  };

  const restoreFromStorage = async () => {
    if (Platform.OS === 'web') {
      if (!window.confirm('Storageのファイルを元にFirestoreを復元しますか？\n※既存データと重複する可能性があります')) return;
    } else {
      await new Promise<void>((resolve, reject) =>
        Alert.alert('復元確認', 'Storageのファイルを元にFirestoreを復元しますか？', [
          { text: 'キャンセル', onPress: () => reject() },
          { text: '復元', onPress: () => resolve() }
        ])
      ).catch(() => { return; });
    }
    setIsUploading(true);
    try {
      const albumsRef = ref(storage, 'albums');
      const listResult = await listAll(albumsRef);
      let count = 0;
      for (const itemRef of listResult.items) {
        const url = await getDownloadURL(itemRef);
        // 既にFirestoreに存在するか確認
        const existing = await getDocs(query(collection(db, 'albums2'), where('storagePath', '==', `albums/${itemRef.name}`)));
        if (existing.empty) {
          // ファイル名からカテゴリを推測（デフォルトは日付から）
          const category = 'restored';
          await addDoc(collection(db, 'albums2'), {
            uri: url,
            storagePath: `albums/${itemRef.name}`,
            mediaType: getMediaType({ storagePath: itemRef.name }),
            uploader: '復元',
            category,
            createdAt: serverTimestamp(),
          });
          count++;
        }
      }
      if (Platform.OS === 'web') window.alert(`${count}件のファイルを復元しました`);
      else Alert.alert('復元完了', `${count}件のファイルを復元しました`);
    } catch (e: any) {
      console.error('復元エラー:', e);
      if (Platform.OS === 'web') window.alert('復元失敗: ' + (e?.message || String(e)));
      else Alert.alert('エラー', '復元失敗: ' + (e?.message || String(e)));
    } finally {
      setIsUploading(false);
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
    const result = await launchAlbumMediaPicker();
    if (!result || result.canceled) return 0;

    closeAddFlow();
    setIsUploading(true);
    
    let count = 0;
    try {
      for (const asset of result.assets) {
        await uploadAlbumAsset(asset, category);
        count++;
      }
    } catch (e: any) {
      console.error('uploadPhotosToCategory error:', e?.message || e);
      if (Platform.OS === 'web') window.alert('アップロード失敗: ' + (e?.message || String(e)));
      else Alert.alert('エラー', 'アップロード失敗: ' + (e?.message || String(e)));
    } finally {
      releasePickerAssets(result.assets);
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
        await addDoc(collection(db, 'album_events2'), {
          name: `${eventNameInput.trim()}_${dateStr}`,
          code: eventCode, category: eventCategory, dateStr, createdAt: serverTimestamp()
        });
        if (Platform.OS === 'web') {
          window.alert(`イベント作成完了\nイベント名: ${eventNameInput.trim()}_${dateStr}\n発行コード: ${eventCode}\n\n写真・動画を${uploaded}件保存しました。`);
        } else {
          Alert.alert('イベント作成完了', `イベント名: ${eventNameInput.trim()}_${dateStr}\n発行コード: ${eventCode}\n\n写真・動画を${uploaded}件保存しました。\n※保護者にはこのコードを伝えてください。`);
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
        if (Platform.OS === 'web') window.alert(`追加完了\n「${ev.name}」に写真・動画を${uploaded}件追加しました。`);
        else Alert.alert('追加完了', `「${ev.name}」に写真・動画を${uploaded}件追加しました。`);
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

  const getEventDateStr = (event: AlbumEvent) => {
    if (event.dateStr && /^\d{4}-\d{2}-\d{2}$/.test(event.dateStr)) return event.dateStr;
    return event.category.match(/(\d{4}-\d{2}-\d{2})$/)?.[1]
      || event.name.match(/(\d{4}-\d{2}-\d{2})$/)?.[1]
      || '';
  };

  const getEventDisplayName = (event: AlbumEvent) => event.name.replace(/_?\d{4}-\d{2}-\d{2}$/, '');

  const canViewDailyDate = (dateStr: string) => {
    if (role !== 'user') return true;
    const date = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(date.getTime())) return false;
    const dayName = DAY_NAMES[date.getDay()];
    if (!userData?.days?.[dayName]) return false;
    if (userData?.createdAt) {
      const created = userData.createdAt?.toDate?.() || new Date(userData.createdAt);
      if (!Number.isNaN(created?.getTime?.())) {
        const createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime();
        if (date.getTime() < createdDay) return false;
      }
    }
    return true;
  };

  const getVisibleEventsForDate = (dateStr: string) => albumEvents.filter(event => (
    getEventDateStr(event) === dateStr && (role !== 'user' || unlockedEvents.includes(event.id))
  ));

  const getCalendarEventTitlesForDate = (dateStr: string) => {
    const managedEventTitles = calendarEvents
      .filter(event => event.dateStr === dateStr && (role !== 'user' || !event.hidden))
      .map(event => event.title);
    const albumEventTitles = getVisibleEventsForDate(dateStr).map(getEventDisplayName);
    return Array.from(new Set([...managedEventTitles, ...albumEventTitles]));
  };

  const getDailyMediaForDate = (dateStr: string) => (
    canViewDailyDate(dateStr) ? (albumPhotos[dateStr] || []) : []
  );

  const getEventMediaForDate = (dateStr: string) => {
    const unique = new Map<string, AlbumMedia>();
    getVisibleEventsForDate(dateStr)
      .flatMap(event => albumPhotos[event.category] || [])
      .forEach(item => unique.set(item.id, item));
    return Array.from(unique.values());
  };

  const getMediaForDate = (dateStr: string) => {
    const dailyMedia = getDailyMediaForDate(dateStr);
    const eventMedia = getEventMediaForDate(dateStr);
    const unique = new Map<string, AlbumMedia>();
    [...dailyMedia, ...eventMedia].forEach(item => unique.set(item.id, item));
    return Array.from(unique.values());
  };

  const getCalendarCells = (year: number, month: number) => {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const cellCount = Math.ceil((firstDay + daysInMonth) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => {
      const day = index - firstDay + 1;
      if (day < 1 || day > daysInMonth) return null;
      const date = new Date(year, month - 1, day);
      const dateStr = getLocalDateString(date);
      const dailyMedia = getDailyMediaForDate(dateStr);
      const eventMedia = getEventMediaForDate(dateStr);
      return {
        day,
        dateStr,
        media: getMediaForDate(dateStr),
        dailyMediaCount: dailyMedia.length,
        eventMediaCount: eventMedia.length,
        eventTitles: getCalendarEventTitlesForDate(dateStr),
        isToday: dateStr === getLocalDateString(new Date()),
      };
    });
  };

  const availableMediaDates = Array.from(new Set([
    ...Object.keys(albumPhotos).filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key)),
    ...albumEvents.map(getEventDateStr).filter(Boolean),
  ])).filter(dateStr => getMediaForDate(dateStr).length > 0).sort();

  const moveViewMonth = (amount: number) => {
    const next = new Date(viewYear, viewMonth - 1 + amount, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth() + 1);
  };

  const selectableYears = (() => {
    const currentYear = new Date().getFullYear();
    const years = new Set<number>();
    for (let year = currentYear - 5; year <= currentYear + 5; year++) years.add(year);
    Object.keys(albumPhotos).forEach(key => {
      const match = key.match(/^(\d{4})-\d{2}-\d{2}$/);
      if (match) years.add(Number(match[1]));
    });
    return Array.from(years).sort((a, b) => a - b);
  })();
  const monthPagerKeys = selectableYears.flatMap(year => MONTHS.map(month => `${year}-${String(month).padStart(2, '0')}`));
  const activeMonthPagerKey = `${viewYear}-${String(viewMonth).padStart(2, '0')}`;

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
    if (success) Alert.alert('保存完了', targetPhoto.mediaType === 'video' ? '動画を端末に保存しました。' : '画像を端末に保存しました。');
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
      Alert.alert('保存完了', `${successCount} 件の写真・動画を端末に保存しました。`);
    } catch (error) {
      Alert.alert('エラー', '一括保存中にエラーが発生しました。');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleBulkDelete = () => {
    if (selectedPhotoIds.length === 0) return;
    if (Platform.OS === 'web') {
      if (window.confirm(`選択した ${selectedPhotoIds.length} 件の写真・動画を完全に削除しますか？`)) {
        executeBulkDelete(selectedPhotoIds);
      }
      return;
    }
    Alert.alert('一括削除確認', `選択した ${selectedPhotoIds.length} 件の写真・動画を完全に削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => executeBulkDelete(selectedPhotoIds) }
    ]);
  };

  const handleSectionDelete = (sectionLabel: string, photos: any[], eventId?: string) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`「${sectionLabel}」のアルバムを全て削除しますか？`)) {
        executeBulkDelete(photos.map(p => p.id));
        if (eventId) deleteDoc(doc(db, 'album_events2', eventId));
      }
      return;
    }
    Alert.alert('アルバム削除確認', `「${sectionLabel}」のアルバムを全て削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => {
        await executeBulkDelete(photos.map(p => p.id));
        if (eventId) await deleteDoc(doc(db, 'album_events2', eventId));
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
          await deleteDoc(doc(db, 'albums2', photo.id));
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
    fullScreenDragStartIndexRef.current = index;
    fullScreenProgrammaticScrollRef.current = false;
    setFullScreenPhotos(photos);
    setFullScreenIndex(index);
  };

  const closeFullScreen = () => {
    setFullScreenPhotos(null);
  };

  const currentFullScreenPhoto = fullScreenPhotos ? fullScreenPhotos[fullScreenIndex] : null;
  const selectedDateMedia = selectedAlbumDate ? getMediaForDate(selectedAlbumDate) : [];
  const selectedDateEventTitles = selectedAlbumDate ? getCalendarEventTitlesForDate(selectedAlbumDate) : [];
  const selectedDateIndex = selectedAlbumDate ? availableMediaDates.indexOf(selectedAlbumDate) : -1;

  const moveSelectedAlbumDate = (amount: number) => {
    const nextDate = availableMediaDates[selectedDateIndex + amount];
    if (nextDate) setSelectedAlbumDate(nextDate);
  };

  const formatAlbumDate = (dateStr: string) => {
    const date = new Date(`${dateStr}T00:00:00`);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${DAY_NAMES[date.getDay()]}）`;
  };

  const formatAlbumDay = (dateStr: string) => {
    const date = new Date(`${dateStr}T00:00:00`);
    return `${date.getMonth() + 1}月${date.getDate()}日(${DAY_NAMES[date.getDay()]})`;
  };

  const renderCalendarPage = (year: number, month: number) => {
    const cells = getCalendarCells(year, month);
    const calendarRows = Array.from(
      { length: Math.ceil(cells.length / 7) },
      (_, rowIndex) => cells.slice(rowIndex * 7, rowIndex * 7 + 7),
    );
    return (
      <ScrollView style={styles.calendarPage} contentContainerStyle={styles.calendarPageContent} nestedScrollEnabled>
        {mediaLoading && Object.keys(albumPhotos).length === 0 ? (
          <View style={styles.noDataBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={[styles.noDataText, { marginTop: 14 }]}>アルバムを読み込んでいます</Text>
          </View>
        ) : mediaLoadError && Object.keys(albumPhotos).length === 0 ? (
          <View style={styles.noDataBox}>
            <Ionicons name="cloud-offline-outline" size={42} color={COLORS.textLight} />
            <Text style={[styles.noDataText, { marginTop: 12 }]}>{mediaLoadError}</Text>
            <TouchableOpacity style={styles.reloadMediaButton} onPress={() => { setMediaLoading(true); setMediaReloadKey(value => value + 1); }}>
              <Ionicons name="refresh" size={19} color="#FFFFFF" />
              <Text style={styles.reloadMediaButtonText}>もう一度読み込む</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.calendarWeekRow}>
              {DAY_NAMES.map((dayName, index) => (
                <Text key={dayName} style={[styles.calendarWeekText, index === 0 && styles.calendarSundayText, index === 6 && styles.calendarSaturdayText]}>{dayName}</Text>
              ))}
            </View>
            <View style={styles.albumCalendarGrid}>
              {calendarRows.map((row, rowIndex) => (
                <View key={`calendar-row-${rowIndex}`} style={styles.albumCalendarRow}>
                  {row.map((cell, columnIndex) => {
                    if (!cell) {
                      return <View key={`empty-${rowIndex}-${columnIndex}`} style={styles.albumCalendarCell} />;
                    }
                    const hasMedia = cell.media.length > 0;
                    const weekday = new Date(`${cell.dateStr}T00:00:00`).getDay();
                    return (
                      <TouchableOpacity
                        key={cell.dateStr}
                        style={[
                          styles.albumCalendarCell,
                          cell.isToday && styles.albumCalendarToday,
                          hasMedia && styles.albumCalendarCellActive,
                          isChoosingAddDate && styles.albumCalendarCellSelecting,
                        ]}
                        disabled={role === 'user' && !hasMedia}
                        activeOpacity={0.72}
                        onPress={() => {
                          if (role !== 'user' && isChoosingAddDate) {
                            setAddTargetDate(cell.dateStr);
                            setIsChoosingAddDate(false);
                            setAddMenuVisible(true);
                            return;
                          }
                          setSelectedAlbumDate(cell.dateStr);
                        }}
                      >
                        <Text style={[
                          styles.albumCalendarDay,
                          role !== 'user' && styles.albumCalendarDayManageable,
                          hasMedia && styles.albumCalendarDayWithMedia,
                          hasMedia && weekday === 0 && styles.calendarSundayText,
                          hasMedia && weekday === 6 && styles.calendarSaturdayText,
                        ]}>{cell.day}</Text>
                        {cell.dailyMediaCount > 0 && (
                          <View style={styles.albumCalendarDailyBadge}>
                            <Text style={styles.albumCalendarBadgeText}>日常写真</Text>
                            <Text style={styles.albumCalendarBadgeCount}>{cell.dailyMediaCount}件</Text>
                          </View>
                        )}
                        {cell.eventTitles.slice(0, 1).map(eventTitle => (
                          <View key={eventTitle} style={styles.albumCalendarEventBadge}>
                            <Text style={styles.albumCalendarBadgeText}>{eventTitle}</Text>
                            <Text style={styles.albumCalendarEventCount}>{cell.eventMediaCount}件</Text>
                          </View>
                        ))}
                        {cell.eventTitles.length > 1 && <Text style={styles.albumCalendarMore}>ほか{cell.eventTitles.length - 1}件</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>
            {cells.every(cell => !cell || cell.media.length === 0) && (
              <Text style={styles.calendarEmptyText}>この月に閲覧できる写真・動画はありません</Text>
            )}
          </>
        )}
      </ScrollView>
    );
  };

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
            router.back();
          }
        }}>
          <Ionicons name={isSelectMode ? "close" : "chevron-back"} size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isSelectMode ? `${selectedPhotoIds.length}件選択中` : 'アルバム'}
        </Text>
        {!isSelectMode && role === 'user' && (
          <TouchableOpacity style={styles.headerCodeButton} onPress={() => setUnlockModalVisible(true)}>
            <Text style={styles.headerCodeButtonText}>イベントコード</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={{ flex: 1 }}>
            <View style={styles.monthSelector}>
              <TouchableOpacity style={styles.monthArrowButton} onPress={() => moveViewMonth(-1)} accessibilityLabel="前の月">
                <Ionicons name="chevron-back" size={23} color={COLORS.text} />
              </TouchableOpacity>
              <View style={styles.yearMonthButtons}>
                <TouchableOpacity style={styles.dateJumpButton} onPress={() => setDateJumpPicker('year')}>
                  <Text style={styles.dateJumpButtonText}>{viewYear}年</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.dateJumpButton} onPress={() => setDateJumpPicker('month')}>
                  <Text style={styles.dateJumpButtonText}>{viewMonth}月</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.monthArrowButton} onPress={() => moveViewMonth(1)} accessibilityLabel="次の月">
                <Ionicons name="chevron-forward" size={23} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {isChoosingAddDate && role !== 'user' && (
              <View style={styles.addDateSelectionBanner}>
                <Text style={styles.addDateSelectionBannerText}>追加する日付を選択</Text>
              </View>
            )}

          <SwipeTabPager
            tabs={monthPagerKeys}
            active={activeMonthPagerKey}
            onChange={(nextKey) => {
              const [year, month] = nextKey.split('-').map(Number);
              setViewYear(year);
              setViewMonth(month);
            }}
            renderTab={(monthKey) => {
              const [year, month] = monthKey.split('-').map(Number);
              return renderCalendarPage(year, month);
            }}
          />

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

      </View>

      {!isSelectMode && role !== 'user' && !selectedAlbumDate && (
        <TouchableOpacity
          style={styles.albumFab}
          accessibilityLabel={isChoosingAddDate ? '日付選択をキャンセル' : 'アルバムに追加'}
          onPress={() => {
            setAddTargetDate(null);
            setIsChoosingAddDate(value => !value);
          }}
        >
          <Ionicons name={isChoosingAddDate ? 'close' : 'add'} size={34} color="#FFFFFF" />
        </TouchableOpacity>
      )}

      {/* 各種モーダル */}
      <Modal visible={!!selectedAlbumDate} transparent animationType="fade" onRequestClose={() => setSelectedAlbumDate(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelectedAlbumDate(null)}>
          <TouchableOpacity style={styles.dateAlbumModal} activeOpacity={1} onPress={() => {}}>
            <View style={styles.dateAlbumTopRow}>
              <Text style={styles.dateAlbumTitle}>写真・動画</Text>
              <TouchableOpacity style={styles.dateAlbumCloseButton} onPress={() => setSelectedAlbumDate(null)}>
                <Ionicons name="close" size={28} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            {selectedAlbumDate && (
              <>
                <View style={styles.dateAlbumNavigator}>
                  <TouchableOpacity
                    style={[styles.dateAlbumNavButton, selectedDateIndex <= 0 && styles.dateAlbumNavButtonDisabled]}
                    disabled={selectedDateIndex <= 0}
                    onPress={() => moveSelectedAlbumDate(-1)}
                  >
                    <Ionicons name="chevron-back" size={24} color={selectedDateIndex <= 0 ? '#C8C8C8' : COLORS.text} />
                  </TouchableOpacity>
                  <Text style={styles.dateAlbumDateText} numberOfLines={1}>{formatAlbumDay(selectedAlbumDate)}</Text>
                  <TouchableOpacity
                    style={[styles.dateAlbumNavButton, selectedDateIndex < 0 || selectedDateIndex >= availableMediaDates.length - 1 ? styles.dateAlbumNavButtonDisabled : null]}
                    disabled={selectedDateIndex < 0 || selectedDateIndex >= availableMediaDates.length - 1}
                    onPress={() => moveSelectedAlbumDate(1)}
                  >
                    <Ionicons name="chevron-forward" size={24} color={selectedDateIndex < 0 || selectedDateIndex >= availableMediaDates.length - 1 ? '#C8C8C8' : COLORS.text} />
                  </TouchableOpacity>
                </View>
                {selectedDateEventTitles.length > 0 && (
                  <View style={styles.dateAlbumEventRow}>
                    {selectedDateEventTitles.map(eventTitle => (
                      <View key={eventTitle} style={styles.dateAlbumEventBadge}>
                        <Text style={styles.dateAlbumEventBadgeText}>イベント　{eventTitle}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {selectedDateMedia.length > 0 ? (
                  <ScrollView style={styles.dateAlbumMediaScroll} contentContainerStyle={styles.dateAlbumMediaGrid}>
                    {selectedDateMedia.map((media, index) => (
                      <TouchableOpacity key={media.id} style={styles.dateAlbumMediaItem} activeOpacity={0.8} onPress={() => openFullScreen(selectedDateMedia, index)}>
                        <AlbumMediaThumbnail item={media} />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <View style={styles.dateAlbumEmpty}>
                    <Ionicons name="images-outline" size={40} color="#B9C4C4" />
                    <Text style={styles.dateAlbumEmptyTitle}>この日の写真・動画はまだありません</Text>
                    {role !== 'user' && <Text style={styles.dateAlbumEmptyCaption}>右下の「＋」から登録できます</Text>}
                  </View>
                )}
              </>
            )}
            {role !== 'user' && selectedAlbumDate && (
              <TouchableOpacity
                style={styles.dateAlbumFab}
                accessibilityLabel="この日に追加"
                onPress={() => {
                  setAddTargetDate(selectedAlbumDate);
                  setAddMenuVisible(true);
                }}
              >
                <Ionicons name="add" size={32} color="#FFFFFF" />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!dateJumpPicker} transparent animationType="fade" onRequestClose={() => setDateJumpPicker(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDateJumpPicker(null)}>
          <TouchableOpacity style={styles.dateJumpModal} activeOpacity={1} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{dateJumpPicker === 'year' ? '年を選択' : '月を選択'}</Text>
              <TouchableOpacity onPress={() => setDateJumpPicker(null)}>
                <Ionicons name="close" size={28} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            {dateJumpPicker === 'year' ? (
              <ScrollView style={styles.yearPickerScroll} contentContainerStyle={styles.dateJumpGrid}>
                {selectableYears.map(year => (
                  <TouchableOpacity
                    key={year}
                    style={[styles.dateJumpOption, viewYear === year && styles.dateJumpOptionActive]}
                    onPress={() => { setViewYear(year); setDateJumpPicker(null); }}
                  >
                    <Text style={[styles.dateJumpOptionText, viewYear === year && styles.dateJumpOptionTextActive]}>{year}年</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.dateJumpGrid}>
                {MONTHS.map(month => (
                  <TouchableOpacity
                    key={month}
                    style={[styles.dateJumpOption, viewMonth === month && styles.dateJumpOptionActive]}
                    onPress={() => { setViewMonth(month); setDateJumpPicker(null); }}
                  >
                    <Text style={[styles.dateJumpOptionText, viewMonth === month && styles.dateJumpOptionTextActive]}>{month}月</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={calendarModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>追加する日付を選択</Text>
              <TouchableOpacity onPress={closeAddFlow}><Ionicons name="close" size={28} color={COLORS.textLight} /></TouchableOpacity>
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
                <TouchableOpacity key={idx} style={[styles.calCell, !day && {borderWidth: 0}]} disabled={!day} onPress={() => {
                  if (!day) return;
                  const selected = new Date(pastDate.getFullYear(), pastDate.getMonth(), day);
                  setPastDate(selected);
                  const dateStr = getLocalDateString(selected);
                  setAddTargetDate(dateStr);
                  setAddMenuVisible(true);
                }}>
                  {day && <Text style={{ fontWeight: 'bold', color: COLORS.text }}>{day}</Text>}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={addMenuVisible} transparent animationType="fade" onRequestClose={() => setAddMenuVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => { setAddTargetDate(null); setAddMenuVisible(false); }}>
          <TouchableOpacity style={styles.albumAddMenuModal} activeOpacity={1} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{addTargetDate ? `${formatAlbumDate(addTargetDate)}に追加` : 'アルバムに追加'}</Text>
              <TouchableOpacity onPress={() => { setAddTargetDate(null); setAddMenuVisible(false); }}><Ionicons name="close" size={28} color={COLORS.text} /></TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.albumAddChoice, styles.albumAddChoiceDaily]} onPress={() => {
              if (addTargetDate) {
                pickImages(formatAlbumDate(addTargetDate), addTargetDate);
                return;
              }
              setPastDate(new Date(viewYear, viewMonth - 1, 1));
              setCalendarModalVisible(true);
            }}>
              <Ionicons name="images-outline" size={26} color="#23767A" />
              <View style={{ flex: 1 }}>
                <Text style={styles.albumAddChoiceTitle}>日常写真・動画を追加</Text>
                <Text style={styles.albumAddChoiceCaption}>端末の写真フォルダから複数選択</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.albumAddChoice, styles.albumAddChoiceEvent]}
              onPress={() => setEventChoiceModalVisible(true)}
            >
              <Ionicons name="images-outline" size={26} color="#7861B5" />
              <View style={{ flex: 1 }}>
                <Text style={styles.albumAddChoiceTitle}>イベントアルバム</Text>
                <Text style={styles.albumAddChoiceCaption}>新規作成または既存アルバムへ追加</Text>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={eventChoiceModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>イベントアルバム</Text>
              <TouchableOpacity onPress={() => setEventChoiceModalVisible(false)}><Ionicons name="close" size={28} color={COLORS.textLight} /></TouchableOpacity>
            </View>
             <TouchableOpacity style={[styles.primaryBtn, { marginBottom: 12 }]} onPress={() => {
               setNewEventDate(addTargetDate ? new Date(`${addTargetDate}T00:00:00`) : new Date());
               setEventNameInput('');
               if (addTargetDate) setEventModalVisible(true);
               else setNewEventCalendarVisible(true);
             }}>
              <Ionicons name="add-circle-outline" size={20} color={COLORS.white} style={{ marginRight: 8 }} />
              <Text style={styles.primaryBtnText}>新規イベントアルバム作成</Text>
            </TouchableOpacity>
             <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#7B68EE' }]} onPress={() => setAddToExistingModalVisible(true)}>
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
            <TextInput style={styles.input} placeholder="例: 春の遠足" placeholderTextColor="#BBBBBB" value={eventNameInput} onChangeText={setEventNameInput} />
            <Text style={{ marginBottom: 16, color: COLORS.textLight, fontSize: 12 }}>
              ※ 保存名: {eventNameInput.trim() || 'イベント名'}_{getLocalDateString(newEventDate)}
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleCreateEvent}>
              <Text style={styles.primaryBtnText}>写真・動画を選択</Text>
            </TouchableOpacity>
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
              style={styles.input} placeholder="コードを入力 (例: AB12C3)" placeholderTextColor="#BBBBBB" 
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
                snapToInterval={windowWidth}
                snapToAlignment="start"
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={fullScreenIndex}
                getItemLayout={(data, index) => ({ length: windowWidth, offset: windowWidth * index, index })}
                onScrollToIndexFailed={onScrollToIndexFailed}
                initialNumToRender={3}
                maxToRenderPerBatch={5}
                windowSize={7}
                removeClippedSubviews={Platform.OS !== 'web'}
                decelerationRate="fast"
                disableIntervalMomentum={true}
                onScrollBeginDrag={() => {
                  fullScreenProgrammaticScrollRef.current = false;
                  fullScreenDragStartIndexRef.current = fullScreenIndex;
                }}
                onMomentumScrollEnd={(e) => {
                  settleFullScreenPage(e.nativeEvent.contentOffset.x);
                }}
                renderItem={({ item }) => (
                  <View style={{ width: windowWidth, height: windowHeight, justifyContent: 'center', alignItems: 'center' }}>
                    <FullScreenMedia item={item} width={windowWidth} height={windowHeight} />
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
            {isIOSWeb && currentFullScreenPhoto?.mediaType !== 'video' ? (
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
                  if (window.confirm('この写真・動画を削除しますか？')) {
                    await executeBulkDelete([currentFullScreenPhoto.id]);
                    closeFullScreen();
                  }
                  return;
                }
                Alert.alert('削除確認', 'この写真・動画を削除しますか？', [
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

      <Modal visible={webGalleryVisible} transparent animationType="fade" onRequestClose={() => finishWebMediaGallery(false)}>
        <View style={styles.webGalleryOverlay}>
          <View style={styles.webGalleryModal}>
            <View style={styles.webGalleryHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.webGalleryTitle}>端末の写真・動画</Text>
                {!!webGalleryDirectoryName && <Text style={styles.webGalleryDirectoryName}>{webGalleryDirectoryName}</Text>}
              </View>
              <TouchableOpacity style={styles.webGalleryFolderButton} onPress={chooseWebGalleryDirectory}>
                <Text style={styles.webGalleryFolderButtonText}>フォルダ変更</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.webGalleryCloseButton} onPress={() => finishWebMediaGallery(false)}>
                <Ionicons name="close" size={28} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {webGalleryLoading ? (
              <View style={styles.webGalleryStatus}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.webGalleryStatusText}>写真・動画を読み込んでいます</Text>
              </View>
            ) : webGalleryNeedsDirectory ? (
              <View style={styles.webGalleryStatus}>
                <Ionicons name="folder-open-outline" size={48} color={COLORS.primary} />
                <Text style={styles.webGalleryStatusTitle}>写真フォルダを選択</Text>
                <Text style={styles.webGalleryStatusText}>最初にDCIMやPicturesなど、表示するフォルダを選んでください</Text>
                <TouchableOpacity style={styles.webGalleryChooseFolderButton} onPress={chooseWebGalleryDirectory}>
                  <Text style={styles.webGalleryChooseFolderButtonText}>フォルダを選択</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <ScrollView style={styles.webGalleryScroll} contentContainerStyle={styles.webGalleryGrid}>
                  {webGalleryAssets.map(asset => {
                    const selected = webGallerySelectedUris.includes(asset.uri);
                    const isVideo = asset.type === 'video';
                    return (
                      <TouchableOpacity
                        key={asset.uri}
                        style={styles.webGalleryItem}
                        activeOpacity={0.78}
                        onPress={() => setWebGallerySelectedUris(current => current.includes(asset.uri)
                          ? current.filter(uri => uri !== asset.uri)
                          : [...current, asset.uri])}
                      >
                        {isVideo ? (
                          <View style={styles.webGalleryVideoItem}>
                            <Ionicons name="play-circle" size={34} color="#FFFFFF" />
                            <Text style={styles.webGalleryVideoText} numberOfLines={1}>{asset.fileName || '動画'}</Text>
                          </View>
                        ) : (
                          <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        )}
                        <View style={[styles.webGalleryCheck, selected && styles.webGalleryCheckSelected]}>
                          {selected && <Ionicons name="checkmark" size={17} color="#FFFFFF" />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {webGalleryAssets.length === 0 && (
                    <View style={styles.webGalleryEmpty}>
                      <Text style={styles.webGalleryStatusText}>このフォルダに写真・動画はありません</Text>
                    </View>
                  )}
                </ScrollView>
                <View style={styles.webGalleryFooter}>
                  <Text style={styles.webGallerySelectedCount}>{webGallerySelectedUris.length}件選択中</Text>
                  <TouchableOpacity
                    style={[styles.webGalleryConfirmButton, webGallerySelectedUris.length === 0 && styles.webGalleryConfirmButtonDisabled]}
                    disabled={webGallerySelectedUris.length === 0}
                    onPress={() => finishWebMediaGallery(true)}
                  >
                    <Text style={styles.webGalleryConfirmButtonText}>追加する</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <AdminBottomNav active="album" />
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFF8F0', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  headerCodeButton: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1EAFB', borderWidth: 1, borderColor: '#D4C3EE' },
  headerCodeButtonText: { color: '#6D55A6', fontSize: 12, fontWeight: 'bold' },
  scrollArea: { flex: 1 },
  topContainerFull: { flex: 1, padding: 20, gap: 20, justifyContent: 'center', alignItems: 'center' },
  albumImgCard: { flex: 0.48, aspectRatio: 1, borderRadius: 22, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 10, elevation: 6 },
  albumImgCardImg: { width: '100%', height: '100%' },
  mainCardHuge: { width: '100%', flex: 0.45, borderRadius: 30, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 15, elevation: 6, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  mainCardTitleHuge: { fontSize: 32, fontWeight: 'bold', color: COLORS.text, marginTop: 24 },
  addGrid: { padding: 20, gap: 16 },
  addOptionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
  iconCircle: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', marginRight: 20 },
  addOptionTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  monthSelector: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border, paddingVertical: 9, paddingHorizontal: 12 },
  monthArrowButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF8F0', borderWidth: 1, borderColor: '#E9D7C5' },
  yearMonthButtons: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 12 },
  dateJumpButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 13, borderRadius: 8, backgroundColor: '#EFF9FA', borderWidth: 1, borderColor: '#B8E2E4' },
  dateJumpButtonText: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  tabContainer: { flexDirection: 'row', width: '100%', backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border },
  tabBtn: { flex: 1, minWidth: 0, paddingHorizontal: 2, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white, borderRightWidth: 1, borderColor: COLORS.border },
  tabBtnActive: { backgroundColor: '#E6E6FA' },
  tabText: { fontSize: 13, fontWeight: 'bold', color: COLORS.textLight },
  tabTextActive: { color: '#9370DB' },
  dateJumpModal: { width: '88%', maxWidth: 440, maxHeight: '76%', borderRadius: 14, backgroundColor: COLORS.white, padding: 18 },
  yearPickerScroll: { maxHeight: 360 },
  dateJumpGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 6 },
  dateJumpOption: { width: '31%', minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: COLORS.border },
  dateJumpOptionActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dateJumpOptionText: { fontSize: 15, fontWeight: 'bold', color: COLORS.text },
  dateJumpOptionTextActive: { color: COLORS.white },
  calendarPage: { flex: 1, backgroundColor: '#FAFAFA' },
  calendarPageContent: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 100, alignItems: 'center' },
  calendarWeekRow: { width: '100%', maxWidth: 760, flexDirection: 'row', paddingVertical: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: '#F4F7F7', borderWidth: 1, borderColor: '#DCE5E5' },
  calendarWeekText: { width: '14.285%', textAlign: 'center', color: '#5B5B5B', fontSize: 13, fontWeight: 'bold' },
  calendarSundayText: { color: '#D94D55' },
  calendarSaturdayText: { color: '#3D78C5' },
  albumCalendarGrid: { width: '100%', maxWidth: 760, borderLeftWidth: 1, borderColor: '#DCE5E5' },
  albumCalendarRow: { width: '100%', flexDirection: 'row', alignItems: 'stretch' },
  albumCalendarCell: { flex: 1, minWidth: 0, minHeight: 78, paddingVertical: 6, paddingHorizontal: 0, backgroundColor: '#FFFFFF', borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#DCE5E5' },
  albumCalendarCellSelecting: { backgroundColor: '#F1FBFB', borderColor: '#9FD7D9' },
  albumCalendarCellActive: { backgroundColor: '#FBFEFE' },
  albumCalendarToday: { backgroundColor: '#FFF5C9' },
  albumCalendarDay: { marginHorizontal: 6, color: '#B7B7B7', fontSize: 14, fontWeight: '500' },
  albumCalendarDayManageable: { color: '#555555', fontWeight: '700' },
  albumCalendarDayWithMedia: { color: '#222222', fontWeight: '800' },
  albumCalendarDailyBadge: { width: '100%', marginTop: 4, paddingHorizontal: 3, paddingVertical: 3, backgroundColor: '#FCE8EE', alignItems: 'center' },
  albumCalendarEventBadge: { width: '100%', marginTop: 4, paddingHorizontal: 3, paddingVertical: 3, backgroundColor: '#FFF3C9', alignItems: 'center' },
  albumCalendarBadgeText: { width: '100%', color: '#4A4141', fontSize: 9, lineHeight: 12, fontWeight: 'bold', flexShrink: 1, textAlign: 'center' },
  albumCalendarBadgeCount: { width: '100%', marginTop: 2, color: '#333333', fontSize: 9, lineHeight: 12, fontWeight: '800', textAlign: 'center' },
  albumCalendarEventCount: { width: '100%', marginTop: 2, color: '#333333', fontSize: 9, lineHeight: 12, fontWeight: '800', textAlign: 'center' },
  albumCalendarMore: { marginTop: 1, paddingHorizontal: 3, color: '#8A8A8A', fontSize: 9 },
  calendarEmptyText: { marginTop: 20, color: COLORS.textLight, fontSize: 14, fontWeight: 'bold', textAlign: 'center' },
  addDateSelectionBanner: { alignSelf: 'center', marginTop: 8, marginBottom: 2, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 16, backgroundColor: '#DFF4F4', borderWidth: 1, borderColor: '#9FD7D9' },
  addDateSelectionBannerText: { color: '#176F73', fontSize: 13, fontWeight: 'bold' },
  albumFab: { position: 'absolute', right: 20, bottom: 92, zIndex: 30, width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, shadowColor: '#184D50', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.24, shadowRadius: 8, elevation: 8 },
  albumAddMenuModal: { width: '90%', maxWidth: 480, borderRadius: 14, backgroundColor: COLORS.white, padding: 18 },
  albumAddChoice: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  albumAddChoiceDaily: { backgroundColor: '#EFF9FA', borderColor: '#B8E2E4' },
  albumAddChoiceEvent: { backgroundColor: '#F5F0FC', borderColor: '#D8C9EC' },
  albumAddChoiceTitle: { color: COLORS.text, fontSize: 16, fontWeight: 'bold' },
  albumAddChoiceCaption: { marginTop: 3, color: COLORS.textLight, fontSize: 12 },
  dateAlbumModal: { width: '96%', maxWidth: 900, height: '84%', maxHeight: 820, borderRadius: 14, backgroundColor: COLORS.white, overflow: 'hidden' },
  dateAlbumTopRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: 1, borderColor: COLORS.border },
  dateAlbumTitle: { color: COLORS.text, fontSize: 17, fontWeight: 'bold' },
  dateAlbumCloseButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  dateAlbumNavigator: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, gap: 8, backgroundColor: '#FFFDFB', borderBottomWidth: 1, borderColor: COLORS.border, position: 'relative' },
  dateAlbumNavButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF8F0', borderWidth: 1, borderColor: '#E9D7C5' },
  dateAlbumNavButtonDisabled: { opacity: 0.45 },
  dateAlbumDateText: { minWidth: 0, flexShrink: 1, color: COLORS.text, fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
  dateAlbumFab: { position: 'absolute', right: 18, bottom: 18, zIndex: 20, width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, shadowColor: '#184D50', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.24, shadowRadius: 8, elevation: 8 },
  dateAlbumEventRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#FAF7FE' },
  dateAlbumEventBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 11, backgroundColor: '#EDE3F8' },
  dateAlbumEventBadgeText: { color: '#674F9C', fontSize: 11, fontWeight: 'bold' },
  dateAlbumMediaScroll: { flex: 1 },
  dateAlbumMediaGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 2 },
  dateAlbumMediaItem: { width: '33.333%', aspectRatio: 1, padding: 1 },
  dateAlbumEmpty: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  dateAlbumEmptyTitle: { marginTop: 12, color: COLORS.text, fontSize: 15, fontWeight: 'bold', textAlign: 'center' },
  dateAlbumEmptyCaption: { marginTop: 6, color: COLORS.textLight, fontSize: 12, textAlign: 'center' },
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
  mediaLoadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F4F4' },
  mediaFailed: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F7F7' },
  mediaFailedText: { marginTop: 6, color: COLORS.primary, fontSize: 11, fontWeight: 'bold' },
  fullScreenMediaStatus: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111111' },
  fullScreenMediaStatusText: { marginTop: 10, color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' },
  videoThumbnail: { flex: 1, backgroundColor: '#DDEFF4', alignItems: 'center', justifyContent: 'center' },
  videoPlayCircle: { width: 48, height: 48, borderRadius: 24, paddingLeft: 3, backgroundColor: 'rgba(0,126,132,0.82)', alignItems: 'center', justifyContent: 'center' },
  videoThumbnailText: { marginTop: 7, color: '#2F555A', fontSize: 12, fontWeight: 'bold' },
  loadMoreMediaButton: { width: '100%', minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F7F5F3', borderTopWidth: 1, borderColor: COLORS.border },
  loadMoreMediaText: { color: COLORS.primary, fontSize: 13, fontWeight: 'bold' },
  checkOverlay: { position: 'absolute', top: 4, right: 4, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 14 },
  noPhotoText: { color: COLORS.textLight, paddingHorizontal: 16, paddingVertical: 16, fontStyle: 'italic', fontSize: 14, textAlign: 'center' },
  noDataBox: { padding: 60, alignItems: 'center' },
  noDataText: { color: COLORS.textLight, fontWeight: 'bold', fontSize: 16, textAlign: 'center' },
  reloadMediaButton: { marginTop: 18, minHeight: 44, paddingHorizontal: 18, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: COLORS.primary },
  reloadMediaButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' },
  webGalleryOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12, backgroundColor: 'rgba(0,0,0,0.58)' },
  webGalleryModal: { width: '100%', maxWidth: 720, height: '88%', maxHeight: 860, overflow: 'hidden', borderRadius: 16, backgroundColor: '#FFFFFF' },
  webGalleryHeader: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderBottomWidth: 1, borderColor: COLORS.border, backgroundColor: '#FFF8F0' },
  webGalleryTitle: { color: COLORS.text, fontSize: 17, fontWeight: 'bold' },
  webGalleryDirectoryName: { marginTop: 2, color: COLORS.textLight, fontSize: 11 },
  webGalleryFolderButton: { minHeight: 34, paddingHorizontal: 10, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF9FA', borderWidth: 1, borderColor: '#B8E2E4' },
  webGalleryFolderButtonText: { color: '#23767A', fontSize: 11, fontWeight: 'bold' },
  webGalleryCloseButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  webGalleryStatus: { flex: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  webGalleryStatusTitle: { marginTop: 14, color: COLORS.text, fontSize: 18, fontWeight: 'bold' },
  webGalleryStatusText: { marginTop: 8, color: COLORS.textLight, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  webGalleryChooseFolderButton: { marginTop: 22, minHeight: 48, paddingHorizontal: 24, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary },
  webGalleryChooseFolderButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' },
  webGalleryScroll: { flex: 1, backgroundColor: '#F3F4F4' },
  webGalleryGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 2 },
  webGalleryItem: { width: '33.333%', aspectRatio: 1, padding: 1, overflow: 'hidden', backgroundColor: '#DCE7E8' },
  webGalleryVideoItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, backgroundColor: '#607D8B' },
  webGalleryVideoText: { width: '100%', marginTop: 5, color: '#FFFFFF', fontSize: 9, textAlign: 'center' },
  webGalleryCheck: { position: 'absolute', top: 7, right: 7, width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.28)' },
  webGalleryCheckSelected: { backgroundColor: COLORS.primary },
  webGalleryEmpty: { width: '100%', minHeight: 220, alignItems: 'center', justifyContent: 'center' },
  webGalleryFooter: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, borderTopWidth: 1, borderColor: COLORS.border, backgroundColor: '#FFFFFF' },
  webGallerySelectedCount: { color: COLORS.text, fontSize: 14, fontWeight: 'bold' },
  webGalleryConfirmButton: { minWidth: 118, minHeight: 44, paddingHorizontal: 18, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary },
  webGalleryConfirmButtonDisabled: { opacity: 0.4 },
  webGalleryConfirmButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' },
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
