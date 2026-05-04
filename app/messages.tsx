import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDoc, arrayRemove, collection, doc, getDocs,
  getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, limit,
} from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
  SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type UserInfo = { role: string; name: string; accountId: string };
type ConvDoc = {
  id: string; type: 'direct' | 'group'; name: string;
  lastMessage?: string; lastMessageAt?: any; unreadFor?: string[];
};
type Message = {
  id: string; senderId: string; senderName: string;
  text: string; createdAt: any;
};

const STAFF_GROUP_ID = 'staff_group';
const ADMIN_ID = 'admin';

function relTime(ts: any) {
  if (!ts?.toDate) return '';
  const d: Date = ts.toDate();
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'たった今';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}時間前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function msgTime(ts: any) {
  if (!ts?.toDate) return '';
  const d: Date = ts.toDate();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function setupFCMToken(accountId: string) {
  if (Platform.OS !== 'web' || typeof Notification === 'undefined') return;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    const { getMessaging, getToken } = await import('firebase/messaging');
    const { app } = await import('../firebase');
    const messaging = getMessaging(app);
    const vapidKey = process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY;
    const token = await getToken(messaging, { vapidKey });
    if (token) {
      await setDoc(doc(db, 'fcm_tokens', accountId), { token, updatedAt: new Date() });
    }
  } catch (e) {
    console.warn('FCM setup failed:', e);
  }
}

async function pushNotify(
  convId: string, convType: string,
  senderAccountId: string, senderName: string, text: string,
) {
  if (Platform.OS !== 'web') return;
  try {
    let recipientIds: string[] = [];
    if (convType === 'group') {
      const snap = await getDocs(collection(db, 'fcm_tokens'));
      recipientIds = snap.docs.map(d => d.id).filter(id => id !== senderAccountId);
    } else {
      const s = await getDoc(doc(db, 'conversations', convId));
      const parts: string[] = s.data()?.participants || [];
      recipientIds = parts.filter(id => id !== senderAccountId);
    }
    if (!recipientIds.length) return;
    const tokenDocs = await Promise.all(recipientIds.slice(0, 10).map(id => getDoc(doc(db, 'fcm_tokens', id))));
    const tokens = tokenDocs.filter(d => d.exists()).map(d => d.data()!.token).filter(Boolean);
    if (!tokens.length) return;
    await fetch('/api/send-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens, title: `${senderName}からメッセージ`, body: text }),
    });
  } catch (e) {
    console.warn('Push notification failed:', e);
  }
}

export default function MessagesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string; conversationName?: string }>();

  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [view, setView] = useState<'list' | 'chat'>('list');
  const [conversations, setConversations] = useState<ConvDoc[]>([]);
  const [activeConv, setActiveConv] = useState<ConvDoc | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);

  const flatListRef = useRef<FlatList>(null);
  const unsubMsgsRef = useRef<(() => void) | null>(null);

  // Load user
  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(raw => {
      if (raw) setCurrentUser(JSON.parse(raw));
    });
  }, []);

  // FCM token registration
  useEffect(() => {
    if (currentUser) setupFCMToken(currentUser.accountId);
  }, [currentUser]);

  // Setup based on role / params
  useEffect(() => {
    if (!currentUser) return;

    // Direct open from attendance (admin → user)
    if (params.conversationId) {
      const conv: ConvDoc = {
        id: params.conversationId, type: 'direct',
        name: params.conversationName || 'ユーザー',
      };
      setDoc(doc(db, 'conversations', params.conversationId), {
        type: 'direct', name: params.conversationName || 'ユーザー',
        participants: [ADMIN_ID, params.conversationId.replace('direct_', '')],
      }, { merge: true });
      openChat(conv);
      setLoading(false);
      return;
    }

    if (currentUser.role === 'admin') {
      const unsub = onSnapshot(collection(db, 'conversations'), snap => {
        const convs: ConvDoc[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as ConvDoc));
        convs.sort((a, b) => {
          if (a.id === STAFF_GROUP_ID) return -1;
          if (b.id === STAFF_GROUP_ID) return 1;
          return (b.lastMessageAt?.seconds || 0) - (a.lastMessageAt?.seconds || 0);
        });
        setConversations(convs);
        setLoading(false);
      });
      return unsub;
    }

    // User or staff: auto-enter their conversation
    const convId = currentUser.role === 'staff' ? STAFF_GROUP_ID : `direct_${currentUser.accountId}`;
    const convData: ConvDoc = currentUser.role === 'staff'
      ? { id: convId, type: 'group', name: 'スタッフグループ' }
      : { id: convId, type: 'direct', name: currentUser.name };

    setDoc(doc(db, 'conversations', convId), {
      type: convData.type,
      name: convData.name,
      participants: currentUser.role === 'staff'
        ? [ADMIN_ID, currentUser.accountId]
        : [ADMIN_ID, currentUser.accountId],
    }, { merge: true }).then(() => {
      openChat(convData);
      setLoading(false);
    });
  }, [currentUser]);

  const openChat = (conv: ConvDoc) => {
    setActiveConv(conv);
    setView('chat');
    unsubMsgsRef.current?.();

    const q = query(
      collection(db, 'conversations', conv.id, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(100),
    );
    unsubMsgsRef.current = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 150);
    });
  };

  // Mark as read when opening chat
  useEffect(() => {
    if (!currentUser || !activeConv) return;
    setDoc(doc(db, 'conversations', activeConv.id), {
      unreadFor: arrayRemove(currentUser.accountId),
    }, { merge: true }).catch(() => {});
  }, [activeConv?.id, currentUser?.accountId]);

  useEffect(() => () => { unsubMsgsRef.current?.(); }, []);

  const sendMessage = async () => {
    if (!inputText.trim() || !activeConv || !currentUser) return;
    const text = inputText.trim();
    setInputText('');
    try {
      // Who should be marked as having unread
      let participants: string[];
      if (activeConv.type === 'group') {
        const snap = await getDocs(collection(db, 'fcm_tokens'));
        participants = [ADMIN_ID, ...snap.docs.map(d => d.id)];
      } else {
        const s = await getDoc(doc(db, 'conversations', activeConv.id));
        participants = s.data()?.participants || [ADMIN_ID, currentUser.accountId];
      }
      const unreadFor = participants.filter(id => id !== currentUser.accountId);

      await addDoc(collection(db, 'conversations', activeConv.id, 'messages'), {
        senderId: currentUser.accountId,
        senderName: currentUser.name,
        text,
        createdAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'conversations', activeConv.id), {
        lastMessage: text,
        lastMessageAt: serverTimestamp(),
        unreadFor,
        type: activeConv.type || 'direct',
        name: activeConv.name,
      }, { merge: true });

      pushNotify(activeConv.id, activeConv.type, currentUser.accountId, currentUser.name, text);
    } catch (e) {
      console.error('Send failed:', e);
    }
  };

  const goBack = () => {
    if (view === 'chat' && currentUser?.role === 'admin' && !params.conversationId) {
      unsubMsgsRef.current?.();
      unsubMsgsRef.current = null;
      setView('list');
      setActiveConv(null);
      setMessages([]);
    } else {
      router.back();
    }
  };

  if (loading || !currentUser) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  // ── Admin conversation list ──
  if (view === 'list' && currentUser.role === 'admin') {
    const hasUnread = (conv: ConvDoc) => (conv.unreadFor || []).includes(ADMIN_ID);
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#5D4037" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>メッセージ</Text>
        </View>

        <FlatList
          data={conversations}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="chatbubbles-outline" size={60} color={COLORS.border} />
              <Text style={styles.emptyText}>まだメッセージはありません</Text>
              <Text style={[styles.emptyText, { fontSize: 13, marginTop: 6 }]}>
                利用者のスケジュール画面や名簿からメッセージを送れます
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isGroup = item.type === 'group';
            const unread = hasUnread(item);
            return (
              <TouchableOpacity style={styles.convRow} onPress={() => openChat(item)} activeOpacity={0.75}>
                <View style={[styles.convAvatar, isGroup && styles.convAvatarGroup]}>
                  <Ionicons name={isGroup ? 'people' : 'person'} size={22} color="#fff" />
                </View>
                <View style={styles.convBody}>
                  <View style={styles.convTitleRow}>
                    <Text style={[styles.convName, unread && styles.convNameUnread]}>
                      {item.name || (isGroup ? 'スタッフグループ' : '利用者')}
                    </Text>
                    <Text style={styles.convTime}>{relTime(item.lastMessageAt)}</Text>
                  </View>
                  <View style={styles.convPreviewRow}>
                    <Text style={[styles.convPreview, unread && styles.convPreviewUnread]} numberOfLines={1}>
                      {item.lastMessage || 'メッセージはありません'}
                    </Text>
                    {unread && <View style={styles.unreadDot} />}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textLight} style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            );
          }}
        />
      </SafeAreaView>
    );
  }

  // ── Chat view ──
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Ionicons
          name={activeConv?.type === 'group' ? 'people' : 'chatbubble-ellipses'}
          size={18} color="#5D4037" style={{ marginRight: 8 }}
        />
        <Text style={styles.headerTitle}>{activeConv?.name || 'チャット'}</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 8 }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="chatbubble-outline" size={48} color={COLORS.border} />
              <Text style={styles.emptyText}>最初のメッセージを送りましょう</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isMe = item.senderId === currentUser.accountId;
            return (
              <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}>
                {!isMe && (
                  <View style={styles.msgAvatar}>
                    <Text style={styles.msgAvatarText}>{(item.senderName || '?')[0]}</Text>
                  </View>
                )}
                <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                  {!isMe && <Text style={styles.bubbleSender}>{item.senderName}</Text>}
                  <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.text}</Text>
                  <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
                    {msgTime(item.createdAt)}
                  </Text>
                </View>
              </View>
            );
          }}
        />

        <View style={styles.inputArea}>
          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="メッセージを入力..."
            placeholderTextColor={COLORS.textLight}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!inputText.trim()}
          >
            <Ionicons name="send" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#AEE4F5',
    borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
  },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },

  convRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderColor: '#F0E4D0',
    backgroundColor: '#fff',
  },
  convAvatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: '#87CEEB',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  convAvatarGroup: { backgroundColor: '#B8DF78' },
  convBody: { flex: 1 },
  convTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  convName: { fontSize: 15, fontWeight: 'bold', color: '#333' },
  convNameUnread: { color: COLORS.primary },
  convTime: { fontSize: 11, color: COLORS.textLight },
  convPreviewRow: { flexDirection: 'row', alignItems: 'center' },
  convPreview: { fontSize: 13, color: COLORS.textLight, flex: 1 },
  convPreviewUnread: { color: '#555', fontWeight: '600' },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.primary, marginLeft: 6 },

  msgRow: { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-end' },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  msgAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#87CEEB',
    justifyContent: 'center', alignItems: 'center', marginRight: 8,
  },
  msgAvatarText: { fontSize: 12, color: '#fff', fontWeight: 'bold' },
  bubble: {
    maxWidth: '72%', padding: 10, borderRadius: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
  },
  bubbleMe: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#fff', borderBottomLeftRadius: 4 },
  bubbleSender: { fontSize: 11, fontWeight: 'bold', color: '#888', marginBottom: 3 },
  bubbleText: { fontSize: 15, color: '#333', lineHeight: 21 },
  bubbleTextMe: { color: '#fff' },
  bubbleTime: { fontSize: 10, color: '#999', marginTop: 4, textAlign: 'right' },
  bubbleTimeMe: { color: 'rgba(255,255,255,0.7)' },

  inputArea: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#F0E4D0',
  },
  textInput: {
    flex: 1, backgroundColor: '#F8F4EE',
    borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, maxHeight: 120,
    borderWidth: 1, borderColor: '#E8DDD0',
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center', marginLeft: 8,
  },
  sendBtnDisabled: { opacity: 0.4 },

  emptyState: { alignItems: 'center', marginTop: 80 },
  emptyText: { color: COLORS.textLight, marginTop: 16, fontSize: 15, textAlign: 'center' },
});
