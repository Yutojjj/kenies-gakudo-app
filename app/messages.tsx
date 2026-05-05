import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDoc, arrayRemove, collection, doc, getDocs,
  getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, limit,
  updateDoc, where,
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

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

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

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function resolveAccountId(user: UserInfo): Promise<string> {
  if (user.accountId) return user.accountId;
  if (user.role === 'admin') return ADMIN_ID;
  try {
    const snap = await getDocs(query(collection(db, 'accounts'), where('name', '==', user.name)));
    if (!snap.empty) return snap.docs[0].id;
  } catch (e) {
    console.warn('accountId lookup failed', e);
  }
  return user.name;
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
  } catch (e) { /* 通知権限がなくてもメッセージは使える */ }
}

async function pushNotify(
  convId: string, convType: string,
  senderAccountId: string, senderName: string,
  text: string, url = '/messages'
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
    const tokenDocs = await Promise.all(
      recipientIds.slice(0, 10).map(id => getDoc(doc(db, 'fcm_tokens', id)))
    );
    const tokens = tokenDocs.filter(d => d.exists()).map(d => d.data()!.token).filter(Boolean);
    if (!tokens.length) return;
    await fetch('/api/send-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens, title: `${senderName}からメッセージ`, body: text, url }),
    });
  } catch (e) { /* 通知失敗は無視 */ }
}

// ── WebRTC ヘルパー（web 専用） ──
function createPC(): any {
  if (typeof window === 'undefined') return null;
  return new (window as any).RTCPeerConnection({ iceServers: ICE_SERVERS });
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
  const [isSending, setIsSending] = useState(false);

  // ── 通話状態 ──
  type CallStatus = 'idle' | 'calling' | 'receiving' | 'connected';
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<{ id: string; callerName: string } | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const peerRef = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const remoteAudioRef = useRef<any>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const unsubMsgsRef = useRef<(() => void) | null>(null);
  const unsubCallRef = useRef<(() => void) | null>(null);

  // ── ユーザー解決 ──
  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(async raw => {
      if (!raw) { setError('ログインが必要です'); setLoading(false); return; }
      const user: UserInfo = JSON.parse(raw);
      const accountId = await resolveAccountId(user);
      setResolvedUser({ ...user, accountId });
    }).catch(() => {
      setError('ユーザー情報の取得に失敗しました');
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (resolvedUser) setupFCMToken(resolvedUser.accountId);
  }, [resolvedUser?.accountId]);

  // ── 着信リスナー ──
  useEffect(() => {
    if (!resolvedUser || Platform.OS !== 'web') return;
    const q = query(
      collection(db, 'calls'),
      where('calleeId', '==', resolvedUser.accountId),
      where('status', '==', 'calling')
    );
    const unsub = onSnapshot(q, snap => {
      if (!snap.empty && callStatus === 'idle') {
        const d = snap.docs[0];
        setIncomingCall({ id: d.id, callerName: d.data().callerName });
        setCallStatus('receiving');
      }
    });
    return unsub;
  }, [resolvedUser?.accountId, callStatus]);

  // ── メッセージ/会話セットアップ ──
  useEffect(() => {
    if (!resolvedUser) return;

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
        () => setLoading(false)
      );
      return unsub;
    }

    const convId = resolvedUser.role === 'staff' ? STAFF_GROUP_ID : `direct_${resolvedUser.accountId}`;
    const convData: ConvDoc = resolvedUser.role === 'staff'
      ? { id: convId, type: 'group', name: 'スタッフグループ' }
      : { id: convId, type: 'direct', name: resolvedUser.name };

    setDoc(doc(db, 'conversations', convId), {
      type: convData.type, name: convData.name,
      participants: [ADMIN_ID, resolvedUser.accountId],
    }, { merge: true })
      .then(() => openChat(convData))
      .catch(() => openChat(convData))
      .finally(() => setLoading(false));
  }, [resolvedUser]);

  const openChat = (conv: ConvDoc) => {
    setActiveConv(conv);
    setView('chat');
    unsubMsgsRef.current?.();
    const q = query(
      collection(db, 'conversations', conv.id, 'messages'),
      orderBy('createdAt', 'asc'), limit(100),
    );
    unsubMsgsRef.current = onSnapshot(q,
      snap => {
        setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 150);
      },
      err => console.error('Messages fetch error:', err)
    );
  };

  useEffect(() => {
    if (!resolvedUser || !activeConv) return;
    setDoc(doc(db, 'conversations', activeConv.id), {
      unreadFor: arrayRemove(resolvedUser.accountId),
    }, { merge: true }).catch(() => {});
  }, [activeConv?.id, resolvedUser?.accountId]);

  useEffect(() => () => {
    unsubMsgsRef.current?.();
    unsubCallRef.current?.();
    callTimerRef.current && clearInterval(callTimerRef.current);
    peerRef.current?.close();
    localStreamRef.current?.getTracks().forEach((t: any) => t.stop());
  }, []);

  // ── メッセージ送信 ──
  const sendMessage = async () => {
    if (!inputText.trim() || !activeConv || !resolvedUser || isSending) return;
    const text = inputText.trim();
    setInputText('');
    setIsSending(true);
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
        senderId: resolvedUser.accountId, senderName: resolvedUser.name,
        text, createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'conversations', activeConv.id), {
        lastMessage: text, lastMessageAt: serverTimestamp(),
        unreadFor, type: activeConv.type || 'direct', name: activeConv.name,
      }, { merge: true });
      pushNotify(activeConv.id, activeConv.type, resolvedUser.accountId, resolvedUser.name, text);
    } catch (e) {
      console.error('Send failed:', e);
    } finally {
      setIsSending(false);
    }
  };

  // ── 通話処理 ──
  const startCallTimer = () => {
    callTimerRef.current && clearInterval(callTimerRef.current);
    setCallDuration(0);
    callTimerRef.current = setInterval(() => setCallDuration(p => p + 1), 1000);
  };

  const cleanupCall = () => {
    callTimerRef.current && clearInterval(callTimerRef.current);
    callTimerRef.current = null;
    unsubCallRef.current?.();
    unsubCallRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((t: any) => t.stop());
    localStreamRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }
    setCallStatus('idle');
    setActiveCallId(null);
    setIncomingCall(null);
    setCallDuration(0);
  };

  const endCall = async (callId?: string) => {
    const id = callId || activeCallId;
    if (id) await setDoc(doc(db, 'calls', id), { status: 'ended' }, { merge: true }).catch(() => {});
    cleanupCall();
  };

  const startCall = async () => {
    if (!resolvedUser || !activeConv || activeConv.type !== 'direct' || Platform.OS !== 'web') return;
    const calleeId = activeConv.id.replace('direct_', '');
    try {
      const pc = createPC();
      if (!pc) return;
      peerRef.current = pc;

      const stream = await (navigator as any).mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      stream.getTracks().forEach((t: any) => pc.addTrack(t, stream));

      const callRef = doc(collection(db, 'calls'));
      setActiveCallId(callRef.id);
      setCallStatus('calling');

      pc.onicecandidate = (e: any) => {
        if (e.candidate) addDoc(collection(db, 'calls', callRef.id, 'callerCandidates'), e.candidate.toJSON()).catch(() => {});
      };
      pc.ontrack = (e: any) => {
        if (!remoteAudioRef.current) {
          const audio = new (window as any).Audio();
          audio.autoplay = true;
          remoteAudioRef.current = audio;
        }
        remoteAudioRef.current.srcObject = e.streams[0];
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await setDoc(callRef, {
        callerId: resolvedUser.accountId, callerName: resolvedUser.name,
        calleeId, calleeName: activeConv.name,
        status: 'calling', sdpOffer: JSON.stringify(offer),
        createdAt: serverTimestamp(),
      });

      // 相手のICE候補を受信
      onSnapshot(collection(db, 'calls', callRef.id, 'calleeCandidates'), snap => {
        snap.docChanges().forEach(ch => {
          if (ch.type === 'added') pc.addIceCandidate(new (window as any).RTCIceCandidate(ch.doc.data())).catch(() => {});
        });
      });

      // 応答 & ステータス監視
      unsubCallRef.current = onSnapshot(doc(db, 'calls', callRef.id), async snap => {
        const d = snap.data();
        if (!d) return;
        if (d.sdpAnswer && !pc.currentRemoteDescription) {
          await pc.setRemoteDescription(new (window as any).RTCSessionDescription(JSON.parse(d.sdpAnswer)));
          setCallStatus('connected');
          startCallTimer();
        }
        if (d.status === 'ended' || d.status === 'rejected') endCall(callRef.id);
      });

      // 相手へプッシュ通知
      const calleeToken = await getDoc(doc(db, 'fcm_tokens', calleeId));
      if (calleeToken.exists()) {
        const token = calleeToken.data().token;
        if (token) fetch('/api/send-notification', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokens: [token],
            title: `${resolvedUser.name}から着信`,
            body: 'メッセージ画面を開いて応答してください',
            url: '/messages',
          }),
        }).catch(() => {});
      }
    } catch (e) {
      cleanupCall();
      alert('マイクへのアクセスが許可されていません。ブラウザの設定を確認してください。');
    }
  };

  const acceptCall = async () => {
    if (!incomingCall || !resolvedUser || Platform.OS !== 'web') return;
    const callId = incomingCall.id;
    try {
      const callSnap = await getDoc(doc(db, 'calls', callId));
      if (!callSnap.exists()) return;
      const callData = callSnap.data();

      const pc = createPC();
      if (!pc) return;
      peerRef.current = pc;

      const stream = await (navigator as any).mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      stream.getTracks().forEach((t: any) => pc.addTrack(t, stream));

      pc.ontrack = (e: any) => {
        if (!remoteAudioRef.current) {
          const audio = new (window as any).Audio();
          audio.autoplay = true;
          remoteAudioRef.current = audio;
        }
        remoteAudioRef.current.srcObject = e.streams[0];
      };
      pc.onicecandidate = (e: any) => {
        if (e.candidate) addDoc(collection(db, 'calls', callId, 'calleeCandidates'), e.candidate.toJSON()).catch(() => {});
      };

      await pc.setRemoteDescription(new (window as any).RTCSessionDescription(JSON.parse(callData.sdpOffer)));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await updateDoc(doc(db, 'calls', callId), { sdpAnswer: JSON.stringify(answer), status: 'connected' });

      onSnapshot(collection(db, 'calls', callId, 'callerCandidates'), snap => {
        snap.docChanges().forEach(ch => {
          if (ch.type === 'added') pc.addIceCandidate(new (window as any).RTCIceCandidate(ch.doc.data())).catch(() => {});
        });
      });

      setActiveCallId(callId);
      setCallStatus('connected');
      setIncomingCall(null);
      startCallTimer();
    } catch (e) {
      cleanupCall();
      alert('通話の開始に失敗しました。マイクのアクセスを確認してください。');
    }
  };

  const rejectCall = async () => {
    if (!incomingCall) return;
    await updateDoc(doc(db, 'calls', incomingCall.id), { status: 'rejected' }).catch(() => {});
    setCallStatus('idle');
    setIncomingCall(null);
  };

  const goBack = () => {
    if (view === 'chat' && resolvedUser?.role === 'admin' && !params.conversationId) {
      unsubMsgsRef.current?.(); unsubMsgsRef.current = null;
      setView('list'); setActiveConv(null); setMessages([]);
    } else {
      router.back();
    }
  };

  // ── 通話オーバーレイ ──
  const callOverlay = callStatus !== 'idle' && (
    <View style={styles.callOverlay}>
      <View style={styles.callBox}>
        {callStatus === 'receiving' && incomingCall ? (
          <>
            <View style={styles.callAvatar}>
              <Text style={styles.callAvatarText}>{(incomingCall.callerName || '?')[0]}</Text>
            </View>
            <Text style={styles.callName}>{incomingCall.callerName}</Text>
            <Text style={styles.callStatusText}>着信中...</Text>
            <View style={styles.callBtns}>
              <TouchableOpacity style={styles.rejectBtn} onPress={rejectCall}>
                <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.acceptBtn} onPress={acceptCall}>
                <Ionicons name="call" size={28} color="#fff" />
              </TouchableOpacity>
            </View>
          </>
        ) : callStatus === 'calling' ? (
          <>
            <View style={styles.callAvatar}>
              <Text style={styles.callAvatarText}>{(activeConv?.name || '?')[0]}</Text>
            </View>
            <Text style={styles.callName}>{activeConv?.name}</Text>
            <Text style={styles.callStatusText}>呼び出し中...</Text>
            <TouchableOpacity style={styles.hangupBtn} onPress={() => endCall()}>
              <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={[styles.callAvatar, { backgroundColor: '#4CAF50' }]}>
              <Ionicons name="call" size={28} color="#fff" />
            </View>
            <Text style={styles.callName}>
              {incomingCall?.callerName || activeConv?.name}
            </Text>
            <Text style={styles.callStatusText}>{fmtDuration(callDuration)}</Text>
            <TouchableOpacity style={styles.hangupBtn} onPress={() => endCall()}>
              <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );

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
        {callOverlay}
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
  const canCall = Platform.OS === 'web' && activeConv?.type === 'direct';
  return (
    <SafeAreaView style={styles.container}>
      {callOverlay}

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
        {canCall && callStatus === 'idle' && (
          <TouchableOpacity style={styles.callHeaderBtn} onPress={startCall}>
            <Ionicons name="call" size={20} color="#5D4037" />
          </TouchableOpacity>
        )}
      </View>

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
            style={[styles.sendBtn, (!inputText.trim() || isSending) && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!inputText.trim() || isSending}
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
  callHeaderBtn: {
    padding: 8, marginLeft: 4,
    backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 20,
  },

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
    borderBottomWidth: 1, borderColor: '#F0E4D0', backgroundColor: '#fff',
  },
  convAvatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: '#87CEEB', justifyContent: 'center', alignItems: 'center', marginRight: 12,
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
    backgroundColor: '#87CEEB', justifyContent: 'center', alignItems: 'center', marginRight: 8,
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
    backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#F0E4D0', minHeight: 64,
  },
  textInput: {
    flex: 1, backgroundColor: '#F8F4EE',
    borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, maxHeight: 120, borderWidth: 1, borderColor: '#E8DDD0', color: '#333',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', marginLeft: 8,
  },
  sendBtnDisabled: { opacity: 0.4 },

  // 通話オーバーレイ
  callOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 200,
    justifyContent: 'center', alignItems: 'center',
  },
  callBox: {
    width: 280, backgroundColor: '#1C1C2E', borderRadius: 24,
    padding: 32, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, elevation: 20,
  },
  callAvatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#87CEEB', justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  callAvatarText: { fontSize: 28, color: '#fff', fontWeight: 'bold' },
  callName: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 8, textAlign: 'center' },
  callStatusText: { fontSize: 14, color: 'rgba(255,255,255,0.6)', marginBottom: 32 },
  callBtns: { flexDirection: 'row', gap: 32 },
  acceptBtn: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#4CAF50', justifyContent: 'center', alignItems: 'center',
  },
  rejectBtn: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#E53935', justifyContent: 'center', alignItems: 'center',
  },
  hangupBtn: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#E53935', justifyContent: 'center', alignItems: 'center',
  },
});
