import type { ImagePickerAsset } from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from '../firebase';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
const MAX_IMAGE_LONG_EDGE = 1920;
const IMAGE_UPLOAD_QUALITY = 0.78;
const THUMBNAIL_WIDTH = 480;
const THUMBNAIL_QUALITY = 0.68;

export type AlbumUploadQueueState = {
  active: boolean;
  total: number;
  completed: number;
  failed: number;
  progress: number;
  message: string;
};

type UploadResult = {
  uploadedCount: number;
  failedCount: number;
  errors: string[];
};

const initialState: AlbumUploadQueueState = {
  active: false,
  total: 0,
  completed: 0,
  failed: 0,
  progress: 0,
  message: '',
};

let state = initialState;
let queueTail: Promise<unknown> = Promise.resolve();
const listeners = new Set<(next: AlbumUploadQueueState) => void>();

const publish = (patch: Partial<AlbumUploadQueueState>) => {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener(state));
};

export const getAlbumUploadQueueState = () => state;

export const subscribeAlbumUploadQueue = (listener: (next: AlbumUploadQueueState) => void) => {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
};

const uploadAsset = async (
  asset: ImagePickerAsset,
  category: string,
  uploader: string,
  itemIndex: number,
  total: number,
) => {
  const mediaType: 'image' | 'video' = asset.type === 'video' || asset.mimeType?.startsWith('video/') ? 'video' : 'image';
  const maxBytes = mediaType === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (asset.fileSize && asset.fileSize > maxBytes) {
    const maxMb = Math.round(maxBytes / 1024 / 1024);
    throw new Error(`${asset.fileName || (mediaType === 'video' ? '動画' : '画像')}は${maxMb}MB以下にしてください。`);
  }

  let uploadUri = asset.uri;
  let uploadMimeType = asset.mimeType || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg');
  if (mediaType === 'image') {
    const isPortrait = Number(asset.height || 0) > Number(asset.width || 0);
    const longEdge = Math.max(Number(asset.width || 0), Number(asset.height || 0));
    const actions = longEdge > MAX_IMAGE_LONG_EDGE
      ? [{ resize: isPortrait ? { height: MAX_IMAGE_LONG_EDGE } : { width: MAX_IMAGE_LONG_EDGE } }]
      : [];
    const optimized = await manipulateAsync(
      asset.uri,
      actions,
      { compress: IMAGE_UPLOAD_QUALITY, format: SaveFormat.JPEG },
    );
    uploadUri = optimized.uri;
    uploadMimeType = 'image/jpeg';
  }

  const response = await fetch(uploadUri);
  if (!response.ok) throw new Error(`${asset.fileName || 'ファイル'}を読み込めませんでした。`);
  const blob = await response.blob();
  const nameExtension = asset.fileName?.split('.').pop()?.toLowerCase();
  const mimeExtension = asset.mimeType?.split('/').pop()?.replace('quicktime', 'mov').replace('jpeg', 'jpg');
  const extension = mediaType === 'image'
    ? 'jpg'
    : (nameExtension || mimeExtension || 'mp4');
  const filename = `${mediaType}_${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`;
  const storagePath = `albums/${filename}`;
  const storageReference = ref(storage, storagePath);
  const task = uploadBytesResumable(
    storageReference,
    blob,
    { contentType: uploadMimeType },
  );
  let lastProgressPublishedAt = 0;

  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', snapshot => {
      const currentProgress = snapshot.totalBytes > 0 ? snapshot.bytesTransferred / snapshot.totalBytes : 0;
      const now = Date.now();
      const isComplete = snapshot.bytesTransferred >= snapshot.totalBytes;
      if (!isComplete && now - lastProgressPublishedAt < 300) return;
      lastProgressPublishedAt = now;
      publish({
        progress: Math.round(((itemIndex + currentProgress) / total) * 100),
        message: `${itemIndex + 1}/${total}件をアップロード中`,
      });
    }, reject, () => resolve());
  });

  const downloadUrl = await getDownloadURL(storageReference);
  let thumbnailUrl: string | null = null;
  let thumbnailStoragePath: string | null = null;

  if (mediaType === 'image') {
    try {
      const thumbnail = await manipulateAsync(
        uploadUri,
        [{ resize: { width: THUMBNAIL_WIDTH } }],
        { compress: THUMBNAIL_QUALITY, format: SaveFormat.JPEG },
      );
      const thumbnailResponse = await fetch(thumbnail.uri);
      if (!thumbnailResponse.ok) throw new Error('サムネイルを読み込めませんでした。');
      const thumbnailBlob = await thumbnailResponse.blob();
      thumbnailStoragePath = `album-thumbnails/${filename.replace(/\.[^.]+$/, '')}.jpg`;
      const thumbnailReference = ref(storage, thumbnailStoragePath);
      const thumbnailTask = uploadBytesResumable(thumbnailReference, thumbnailBlob, { contentType: 'image/jpeg' });
      await new Promise<void>((resolve, reject) => {
        thumbnailTask.on('state_changed', undefined, reject, () => resolve());
      });
      thumbnailUrl = await getDownloadURL(thumbnailReference);
    } catch (error) {
      // 元画像の登録は成功させ、一覧画像だけ原画像へフォールバックする。
      console.warn('album thumbnail creation error:', error);
      thumbnailStoragePath = null;
    }
  }

  await addDoc(collection(db, 'albums2'), {
    uri: downloadUrl,
    storagePath,
    thumbnailUri: thumbnailUrl,
    thumbnailStoragePath,
    mediaType,
    mimeType: uploadMimeType,
    duration: asset.duration ?? null,
    width: asset.width || null,
    height: asset.height || null,
    uploader: uploader || '不明',
    category,
    createdAt: serverTimestamp(),
  });
};

export function enqueueAlbumUploads(
  assets: ImagePickerAsset[],
  category: string,
  uploader: string,
): Promise<UploadResult> {
  const batchAssets = [...assets];
  const run = async (): Promise<UploadResult> => {
    const total = batchAssets.length;
    let uploadedCount = 0;
    const errors: string[] = [];
    publish({ active: true, total, completed: 0, failed: 0, progress: 0, message: `0/${total}件を準備中` });

    for (let index = 0; index < batchAssets.length; index += 1) {
      try {
        await uploadAsset(batchAssets[index], category, uploader, index, total);
        uploadedCount += 1;
      } catch (error: any) {
        console.error('album background upload error:', error);
        errors.push(error?.message || String(error));
      }
      publish({
        completed: uploadedCount,
        failed: errors.length,
        progress: Math.round(((index + 1) / total) * 100),
      });
    }

    const failedCount = errors.length;
    publish({
      active: false,
      completed: uploadedCount,
      failed: failedCount,
      progress: 100,
      message: failedCount > 0
        ? `${uploadedCount}件完了・${failedCount}件失敗`
        : `${uploadedCount}件のアップロードが完了しました`,
    });
    return { uploadedCount, failedCount, errors };
  };

  const result = queueTail.then(run, run);
  queueTail = result.then(() => undefined, () => undefined);
  return result;
}
