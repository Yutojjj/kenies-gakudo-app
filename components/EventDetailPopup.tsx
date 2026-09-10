import { Ionicons } from '@expo/vector-icons';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { db } from '../firebase';

type EventValue = {
  id: string;
  dateStr: string;
  title: string;
  description?: string;
  coverImage?: string | null;
};

type Props = {
  event: EventValue | null;
  visible: boolean;
  accountId?: string;
  accountName?: string;
  onClose: () => void;
};

type DetailDoc = { description?: unknown; items?: unknown };
type PastPhoto = { id: string; uri: string; mediaType?: string };

const formatDate = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
};

const formatDetailText = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((line: any) => {
    const spans = Array.isArray(line?.spans) ? line.spans : Array.isArray(line) ? line : [line];
    return spans.map((span: any) => typeof span === 'string' ? span : String(span?.text || '')).join('');
  }).join('\n');
};

const confirmParticipation = (message: string, onConfirm: () => void) => {
  if (Platform.OS === 'web') {
    if (window.confirm(message)) onConfirm();
    return;
  }
  Alert.alert('イベント参加', message, [
    { text: 'キャンセル', style: 'cancel' },
    { text: '実行', onPress: onConfirm },
  ]);
};

export default function EventDetailPopup({ event, visible, accountId, accountName, onClose }: Props) {
  const [detail, setDetail] = useState<DetailDoc | null>(null);
  const [photos, setPhotos] = useState<PastPhoto[]>([]);
  const [joined, setJoined] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);

  useEffect(() => {
    if (!event || !visible) return;
    setDescriptionOpen(false);
    setItemsOpen(false);
    setPhotosOpen(false);
    const detailUnsub = onSnapshot(query(collection(db, 'year_event_details'), where('eventId', '==', event.id)), snap => {
      setDetail(snap.empty ? null : snap.docs[0].data() as DetailDoc);
    }, () => setDetail(null));
    const photosUnsub = onSnapshot(query(collection(db, 'event_past_photos'), where('eventId', '==', event.id)), snap => {
      setPhotos(snap.docs.map(item => ({ id: item.id, ...item.data() } as PastPhoto)));
    }, () => setPhotos([]));
    const participantRef = accountId ? doc(db, 'event_participants', `${event.id}_${accountId}`) : null;
    const participantUnsub = participantRef ? onSnapshot(participantRef, snap => setJoined(snap.exists() && snap.data()?.status === '参加')) : undefined;
    return () => {
      detailUnsub();
      photosUnsub();
      participantUnsub?.();
    };
  }, [event, visible, accountId]);

  const toggleParticipation = () => {
    if (!event || !accountId) return;
    const nextJoined = !joined;
    confirmParticipation(nextJoined ? 'このイベントに参加しますか？' : '参加を取り消しますか？', async () => {
      const ref = doc(db, 'event_participants', `${event.id}_${accountId}`);
      if (nextJoined) {
        await setDoc(ref, { eventId: event.id, childId: accountId, childName: accountName || '', status: '参加', updatedAt: new Date() }, { merge: true });
      } else {
        await deleteDoc(ref);
      }
    });
  };

  if (!event) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityLabel="ポップアップを閉じる" />
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerSide} />
            <Text style={styles.title} numberOfLines={1}>{event.title}</Text>
            <TouchableOpacity style={styles.close} onPress={onClose} accessibilityLabel="イベント詳細を閉じる">
              <Ionicons name="close" size={25} color="#5D4037" />
            </TouchableOpacity>
          </View>
          {event.coverImage && <Image source={{ uri: event.coverImage }} style={styles.cover} resizeMode="cover" />}
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <Section icon="document-text-outline" label="説明・日時" open={descriptionOpen} onPress={() => setDescriptionOpen(v => !v)}>
              <Text style={styles.date}>{formatDate(event.dateStr)}</Text>
              <Text style={styles.bodyText}>{formatDetailText(detail?.description) || event.description || '説明はまだありません'}</Text>
            </Section>
            <Section icon="bag-outline" label="持ち込み・参加費等" open={itemsOpen} onPress={() => setItemsOpen(v => !v)}>
              <Text style={styles.bodyText}>{formatDetailText(detail?.items) || '情報はまだありません'}</Text>
            </Section>
            <Section icon="images-outline" label="去年の写真" count={`${photos.length}件`} open={photosOpen} onPress={() => setPhotosOpen(v => !v)}>
              {photos.length === 0 ? <Text style={styles.bodyText}>写真・動画はまだありません</Text> : photos.map(photo => (
                <Image key={photo.id} source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" />
              ))}
            </Section>
          </ScrollView>
          {accountId && (
            <TouchableOpacity style={[styles.join, joined && styles.joinActive]} onPress={toggleParticipation} activeOpacity={0.82} accessibilityLabel={joined ? '参加を取り消す' : 'イベントに参加する'}>
              <Ionicons name={joined ? 'checkmark' : 'add'} size={26} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Section({ icon, label, count, open, onPress, children }: { icon: any; label: string; count?: string; open: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onPress}>
        <Ionicons name={icon} size={19} color="#00B8C4" />
        <Text style={styles.sectionLabel}>{label}</Text>
        <View style={{ flex: 1 }} />
        {!!count && <Text style={styles.count}>{count}</Text>}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={19} color="#756B64" />
      </TouchableOpacity>
      {open && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12, backgroundColor: 'rgba(35,29,24,0.42)' },
  card: { width: '100%', maxWidth: 760, height: '88%', maxHeight: 860, overflow: 'hidden', borderRadius: 18, backgroundColor: '#FFFDF9' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFF8F0' },
  headerSide: { width: 38, height: 38 },
  title: { flex: 1, textAlign: 'center', fontSize: 19, fontWeight: 'bold', color: '#5D4037' },
  close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  cover: { width: '100%', height: 180, backgroundColor: '#EEE' },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 96 },
  section: { borderBottomWidth: 1, borderColor: '#E5DDD5' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 15, backgroundColor: '#FFFDF9' },
  sectionLabel: { fontSize: 18, fontWeight: 'bold', color: '#403832' },
  sectionBody: { paddingBottom: 16 },
  date: { fontSize: 15, fontWeight: 'bold', color: '#5D4037', marginBottom: 6 },
  bodyText: { fontSize: 14, color: '#4B4540', lineHeight: 22 },
  count: { color: '#AAA39D', fontSize: 14, marginRight: 8 },
  photo: { width: '100%', height: 150, borderRadius: 8, marginBottom: 8 },
  join: { position: 'absolute', right: 22, bottom: 24, width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00AEB8', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  joinActive: { backgroundColor: '#4CAF50' },
});
