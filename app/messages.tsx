import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDoc, arrayRemove, collection, doc, getDocs,
  getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, limit,
  where,
} from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type UserInfo = { role: string; name: string; accountId?: string };
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

// accountIdが保存されていない古いセッション用フォールバック
async function resolveAccountId(user: UserInfo): Promise<string> {
  if (user.accountId) return user.accountId;
  if (user.role === 'admin') return ADMIN_ID;
  // Firestoreから名前で検索
  try {
    const snap = await getDocs(query(collection(db, 'accounts'), where('name', '==', user.name)));
    if (!snap.empty) return snap.docs[0].id;
  } catch (e) {
    console.warn('accountId lookup failed', e);
  }
  return user.name; // 最終フォールバック
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
    if (!vapidKey) return;
    const token = await getToken(messaging, { vapidKey });
    if (token) {
      await setDoc(doc(db, 'fcm_tokens', accountId), { token, updatedAt: new Date() });
    }
  } catch (e) {
    // 通知権限がなくてもメッセージは使える
  }
}

async function pushNotify(convId: string, convType: string, senderAccountId: string, senderName: string, text: string) {
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
  } catch (e) { /* 通知失敗は無視 */ }
}

export default function MessagesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string; conversationName?: string }>();

  const [resolvedUser, setResolvedUser] = useState<(UserInfo & { accountId: string }) | null>(null);
  const [view, setView] = useState<'list' | 'chat'>('list');
  const [conversations, setConversations] = useState<ConvDoc[]>([]);
  const [activeConv, setActiveConv] = useState<ConvDoc | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const scrollRef = useRef<ScrollView>(null);
  const unsubMsgsRef = useRef<(() => void) | null>(null);

  // ユーザー情報の読み込みとaccountId解決
  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(async raw => {
      if (!raw) {
        setError('ログインが必要です');
        setLoading(false);
        return;
      }
      const user: UserInfo = JSON.parse(raw);
      const accountId = await resolveAccountId(user);
      setResolvedUser({ ...user, accountId });
    }).catch(() => {
      setError('ユーザー情報の取得に失敗しました');
      setLoading(false);
    });
  }, []);

  // FCMトークン登録
  useEffect(() => {
    if (resolvedUser) setupFCMToken(resolvedUser.accountId);
  }, [resolvedUser?.accountId]);

  // メッセージ画面のセットアップ
  useEffect(() => {
    if (!resolvedUser) return;

    // 出欠画面などから直接遷移してきた場合（管理者→利用者への直接メッセージ）
    if (params.conversationId) {
      const conv: ConvDoc = {
        id: params.conversationId, type: 'direct',
        name: params.conversationName || 'ユーザー',
      };
      setDoc(doc(db, 'conversations', params.conversationId), {
        type: 'direct', name: params.conversationName || 'ユーザー',
        participants: [ADMIN_ID, params.conversationId.replace('direct_', '')],
      }, { merge: true }).catch(() => {});
      openChat(conv);
      setLoading(false);
      return;
    }

    if (resolvedUser.role === 'admin') {
      // 管理者：全会話リストを表示
      const unsub = onSnapshot(
        collection(db, 'conversations'),
        snap => {
          const convs: ConvDoc[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as ConvDoc));
          convs.sort((a, b) => {
            if (a.id === STAFF_GROUP_ID) return -1;
            if (b.id === STAFF_GROUP_ID) return 1;
            return (b.lastMessageAt?.seconds || 0) - (a.lastMessageAt?.seconds || 0);
          });
          setConversations(convs);
          setLoading(false);
        },
        err => {
          console.error('Conversations fetch error:', err);
          setLoading(false);
        }
      );
      return unsub;
    }

    // スタッフ・利用者：自分の会話に直接入る
    const convId = resolvedUser.role === 'staff' ? STAFF_GROUP_ID : `direct_${resolvedUser.accountId}`;
    const convData: ConvDoc = resolvedUser.role === 'staff'
      ? { id: convId, type: 'group', name: 'スタッフグループ' }
      : { id: convId, type: 'direct', name: resolvedUser.name };

    setDoc(doc(db, 'conversations', convId), {
      type: convData.type,
      name: convData.name,
      participants: [ADMIN_ID, resolvedUser.accountId],
    }, { merge: true })
      .then(() => { openChat(convData); })
      .catch(() => { openChat(convData); }) // エラーでもチャット画面は開く
      .finally(() => { setLoading(false); });
  }, [resolvedUser]);

  const openChat = (conv: ConvDoc) => {
    setActiveConv(conv);
    setView('chat');
    unsubMsgsRef.current?.();

    const q = query(
      collection(db, 'conversations', conv.id, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(100),
    );
    unsubMsgsRef.current = onSnapshot(q,
      snap => {
        setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 150);
      },
      err => console.error('Messages fetch error:', err)
    );
  };

  // チャット開いたら既読にする
  useEffect(() => {
    if (!resolvedUser || !activeConv) return;
    setDoc(doc(db, 'conversations', activeConv.id), {
      unreadFor: arrayRemove(resolvedUser.accountId),
    }, { merge: true }).catch(() => {});
  }, [activeConv?.id, resolvedUser?.accountId]);

  useEffect(() => () => { unsubMsgsRef.current?.(); }, []);

  const sendMessage = async () => {
    if (!inputText.trim() || !activeConv || !resolvedUser) return;
    const text = inputText.trim();
    setInputText('');
    try {
      let participants: string[];
      if (activeConv.type === 'group') {
        const snap = await getDocs(collection(db, 'fcm_tokens'));
        participants = [ADMIN_ID, ...snap.docs.map(d => d.id)];
      } else {
        const s = await getDoc(doc(db, 'conversations', activeConv.id));
        participants = s.data()?.participants || [ADMIN_ID, resolvedUser.accountId];
      }
      const unreadFor = participants.filter(id => id !== resolvedUser.accountId);

      await addDoc(collection(db, 'conversations', activeConv.id, 'messages'), {
        senderId: resolvedUser.accountId,
        senderName: resolvedUser.name,
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

      pushNotify(activeConv.id, activeConv.type, resolvedUser.accountId, resolvedUser.name, text);
    } catch (e) {
      console.error('Send failed:', e);
    }
  };

  const goBack = () => {
    if (view === 'chat' && resolvedUser?.role === 'admin' && !params.conversationId) {
      unsubMsgsRef.current?.();
      unsubMsgsRef.current = null;
      setView('list');
      setActiveConv(null);
      setMessages([]);
    } else {
      router.back();
    }
  };

  // ── ローディング ──
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#5D4037" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>メッセージ</Text>
        </View>
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>読み込み中...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── エラー ──
  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#5D4037" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>メッセージ</Text>
        </View>
        <View style={styles.centerBox}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.danger} />
          <Text style={{ color: COLORS.danger, marginTop: 12, fontSize: 16 }}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => router.replace('/')}>
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>ログインし直す</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── 管理者：会話リスト ──
  if (view === 'list' && resolvedUser?.role === 'admin') {
    const hasUnread = (conv: ConvDoc) => (conv.unreadFor || []).includes(ADMIN_ID);
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#5D4037" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>メッセージ</Text>
        </View>

        <ScrollView style={{ flex: 1 }}>
          {conversations.length === 0 && (
            <View style={styles.centerBox}>
              <Ionicons name="chatbubbles-outline" size={60} color={COLORS.border} />
              <Text style={styles.emptyText}>まだ会話がありません</Text>
              <Text style={[styles.emptyText, { fontSize: 13, marginTop: 4 }]}>
                名簿の「💬」から利用者にメッセージを送れます
              </Text>
            </View>
          )}
          {conversations.map(item => {
            const isGroup = item.type === 'group';
            const unread = hasUnread(item);
            return (
              <TouchableOpacity key={item.id} style={styles.convRow} onPress={() => openChat(item)} activeOpacity={0.75}>
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
          })}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── チャット画面 ──
  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Ionicons
          name={activeConv?.type === 'group' ? 'people' : 'chatbubble-ellipses'}
          size={18} color="#5D4037" style={{ marginRight: 8 }}
        />
        <Text style={styles.headerTitle} numberOfLines={1}>
          {activeConv?.name || 'チャット'}
        </Text>
      </View>

      {/* メッセージエリア + 入力欄 */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {/* メッセージリスト */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 14, paddingBottom: 10 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.length === 0 && (
            <View style={styles.centerBox}>
              <Ionicons name="chatbubble-outline" size={48} color={COLORS.border} />
              <Text style={styles.emptyText}>最初のメッセージを送りましょう</Text>
            </View>
          )}
          {messages.map(item => {
            const isMe = item.senderId === resolvedUser?.accountId;
            return (
              <View key={item.id} style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}>
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
          })}
        </ScrollView>

        {/* 入力欄 */}
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

  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  loadingText: { color: COLORS.textLight, marginTop: 12, fontSize: 14 },
  emptyText: { color: COLORS.textLight, marginTop: 16, fontSize: 15, textAlign: 'center' },
  retryBtn: {
    marginTop: 20, backgroundColor: COLORS.primary,
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8,
  },

  // 会話リスト
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

  // チャットメッセージ
  msgRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end' },
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

  // 入力欄
  inputArea: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1, borderColor: '#F0E4D0',
    minHeight: 64,
  },
  textInput: {
    flex: 1, backgroundColor: '#F8F4EE',
    borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, maxHeight: 120,
    borderWidth: 1, borderColor: '#E8DDD0',
    color: '#333',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center', marginLeft: 8,
  },
  sendBtnDisabled: { opacity: 0.4 },
});
