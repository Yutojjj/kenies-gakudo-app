import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDoc, arrayRemove, arrayUnion, collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot, orderBy, query, serverTimestamp, setDoc,
  where
} from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View
} from 'react-native';
import { COLORS } from '../constants/theme';
import { useCall } from '../contexts/CallContext';
import { db, storage } from '../firebase';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

type UserInfo = { role: string; name: string; accountId?: string };
type ConvDoc = {
  id: string; type: 'direct' | 'group'; name: string;
  lastMessage?: string; lastMessageAt?: any; unreadFor?: string[];
  settings?: { allowChat?: boolean; allowCall?: boolean };
};
type Message = {
  id: string; senderId: string; senderName: string;
  text: string; createdAt: any; imageUrl?: string;
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
  } catch (e) { /* 通知権限なしでも動作可 */ }
}

function deriveParticipants(convId: string): string[] {
  if (convId.startsWith('direct_')) {
    const userId = convId.replace('direct_', '');
    return [ADMIN_ID, userId];
  }
  return [];
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
      const parts: string[] = s.data()?.participants?.length
        ? s.data()!.participants
        : deriveParticipants(convId);
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
  } catch (e) { }
}

export default function MessagesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string; conversationName?: string }>();
  const { startCall, callStatus } = useCall();

  const [resolvedUser, setResolvedUser] = useState<(UserInfo & { accountId: string }) | null>(null);
  const [view, setView] = useState<'list' | 'chat'>('list');
  const [conversations, setConversations] = useState<ConvDoc[]>([]);
  const [activeConv, setActiveConv] = useState<ConvDoc | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [convReadBy, setConvReadBy] = useState<string[]>([]);

  const [createGroupModalVisible, setCreateGroupModalVisible] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [availableAccounts, setAvailableAccounts] = useState<any[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [groupFilterRole, setGroupFilterRole] = useState<'all' | 'user' | 'staff'>('all');
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [allowMemberChat, setAllowMemberChat] = useState(true);
  const [allowMemberCall, setAllowMemberCall] = useState(true);

  const scrollRef = useRef<ScrollView>(null);
  const unsubMsgsRef = useRef<(() => void) | null>(null);
  const unsubConvRef = useRef<(() => void) | null>(null);

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
    setConvReadBy([]);
    unsubMsgsRef.current?.();
    unsubConvRef.current?.();

    unsubConvRef.current = onSnapshot(doc(db, 'conversations', conv.id), snap => {
      setConvReadBy(snap.data()?.readBy || []);
    });

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
      readBy: arrayUnion(resolvedUser.accountId),
    }, { merge: true }).catch(() => {});
  }, [activeConv?.id, resolvedUser?.accountId]);

  useEffect(() => () => {
    unsubMsgsRef.current?.();
    unsubConvRef.current?.();
  }, []);

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
        participants = s.data()?.participants?.length
          ? s.data()!.participants
          : deriveParticipants(activeConv.id);
      }
      const unreadFor = participants.filter(id => id !== resolvedUser.accountId);

      await addDoc(collection(db, 'conversations', activeConv.id, 'messages'), {
        senderId: resolvedUser.accountId, senderName: resolvedUser.name,
        text, createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'conversations', activeConv.id), {
        lastMessage: text, lastMessageAt: serverTimestamp(),
        unreadFor, type: activeConv.type || 'direct', name: activeConv.name,
        readBy: [resolvedUser.accountId],
      }, { merge: true });
      pushNotify(activeConv.id, activeConv.type, resolvedUser.accountId, resolvedUser.name, text);
    } catch (e) {
      console.error('Send failed:', e);
    } finally {
      setIsSending(false);
    }
  };

  const sendImage = async () => {
    if (!activeConv || !resolvedUser || isSending) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsMultipleSelection: false,
      quality: 0.7,
    });
    if (result.canceled) return;
    setIsSending(true);
    try {
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const filename = `messages/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      const storageRef = ref(storage, filename);
      await uploadBytes(storageRef, blob);
      const imageUrl = await getDownloadURL(storageRef);

      let participants: string[];
      if (activeConv.type === 'group') {
        const snap = await getDocs(collection(db, 'fcm_tokens'));
        participants = [ADMIN_ID, ...snap.docs.map(d => d.id)];
      } else {
        const s = await getDoc(doc(db, 'conversations', activeConv.id));
        participants = s.data()?.participants?.length
          ? s.data()!.participants
          : deriveParticipants(activeConv.id);
      }
      const unreadFor = participants.filter(id => id !== resolvedUser.accountId);

      await addDoc(collection(db, 'conversations', activeConv.id, 'messages'), {
        senderId: resolvedUser.accountId, senderName: resolvedUser.name,
        text: '', imageUrl, createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'conversations', activeConv.id), {
        lastMessage: '📷 画像', lastMessageAt: serverTimestamp(),
        unreadFor, type: activeConv.type || 'direct', name: activeConv.name,
        readBy: [resolvedUser.accountId],
      }, { merge: true });
    } catch (e) {
      console.error('Image send failed:', e);
    } finally {
      setIsSending(false);
    }
  };

  const goBack = () => {
    if (view === 'chat' && resolvedUser?.role === 'admin' && !params.conversationId) {
      unsubMsgsRef.current?.(); unsubMsgsRef.current = null;
      unsubConvRef.current?.(); unsubConvRef.current = null;
      setView('list'); setActiveConv(null); setMessages([]); setConvReadBy([]);
    } else {
      router.back();
    }
  };

  const handleDeleteConversation = (conv: ConvDoc) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`「${conv.name || 'トーク'}」を完全に削除しますか？\n（復元できません）`)) {
        deleteDoc(doc(db, 'conversations', conv.id)).then(() => {
          if (activeConv?.id === conv.id) goBack();
        }).catch(() => window.alert('削除に失敗しました。'));
      }
      return;
    }
    Alert.alert('削除確認', `「${conv.name || 'トーク'}」を完全に削除しますか？\n（復元できません）`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => {
        try {
          await deleteDoc(doc(db, 'conversations', conv.id));
          if (activeConv?.id === conv.id) goBack();
        } catch (e) {
          Alert.alert('エラー', '削除に失敗しました。');
        }
      }}
    ]);
  };

  const openCreateGroupModal = async () => {
    try {
      const snap = await getDocs(collection(db, 'accounts'));
      const accs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAvailableAccounts(accs);
      setGroupFilterRole('all');
      setGroupSearchQuery('');
      setNewGroupName('');
      setSelectedUserIds([]);
      setAllowMemberChat(true);
      setAllowMemberCall(true);
      setCreateGroupModalVisible(true);
    } catch (e) {
      Alert.alert('エラー', 'ユーザーの取得に失敗しました');
    }
  };

  const toggleUserSelection = (id: string) => {
    if (selectedUserIds.includes(id)) {
      setSelectedUserIds(selectedUserIds.filter(uid => uid !== id));
    } else {
      setSelectedUserIds([...selectedUserIds, id]);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      Alert.alert('エラー', 'グループ名を入力してください');
      return;
    }
    if (selectedUserIds.length === 0) {
      Alert.alert('エラー', 'メンバーを1人以上選択してください');
      return;
    }
    try {
      await addDoc(collection(db, 'conversations'), {
        type: 'group',
        name: newGroupName.trim(),
        participants: [ADMIN_ID, ...selectedUserIds],
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        lastMessage: 'グループが作成されました',
        readBy: [ADMIN_ID],
        unreadFor: selectedUserIds,
        settings: {
          allowChat: allowMemberChat,
          allowCall: allowMemberCall,
        }
      });
      setCreateGroupModalVisible(false);
    } catch (e) {
      Alert.alert('エラー', 'グループの作成に失敗しました');
    }
  };

  const filteredGroupAccounts = availableAccounts.filter(acc => {
    if (groupFilterRole !== 'all' && acc.role !== groupFilterRole) return false;
    if (groupSearchQuery) {
      const q = groupSearchQuery.toLowerCase();
      const matchName = acc.name?.toLowerCase().includes(q);
      const matchKana = acc.nicknameKana?.toLowerCase().includes(q);
      if (!matchName && !matchKana) return false;
    }
    return true;
  });

  const myLastMsgId = resolvedUser
    ? [...messages].reverse().find(m => m.senderId === resolvedUser.accountId)?.id ?? null
    : null;
  const othersHaveRead = convReadBy.some(id => id !== resolvedUser?.accountId);

  const isAdmin = resolvedUser?.role === 'admin';
  const isDirect = activeConv?.type === 'direct';
  const isGroup = activeConv?.type === 'group';
  
  // 修正：ダイレクトメッセージなら常にOK、グループなら設定に従う。管理者は常にOK
  const canChat = isAdmin || isDirect || (isGroup && activeConv?.settings?.allowChat !== false);
  const canCall = (isDirect || (isGroup && (isAdmin || activeConv?.settings?.allowCall !== false)));

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

  if (view === 'list' && resolvedUser?.role === 'admin') {
    const hasUnread = (conv: ConvDoc) => (conv.unreadFor || []).includes(ADMIN_ID);
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#5D4037" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>メッセージ</Text>
          <TouchableOpacity onPress={openCreateGroupModal} style={styles.callHeaderBtn}>
            <Ionicons name="people-circle-outline" size={24} color="#5D4037" />
          </TouchableOpacity>
        </View>
        
        <ScrollView style={{ flex: 1 }}>
          {conversations.length === 0 && (
            <View style={styles.centerBox}>
              <Ionicons name="chatbubbles-outline" size={60} color={COLORS.border} />
              <Text style={styles.emptyText}>まだ会話がありません</Text>
            </View>
          )}
          {conversations.map(item => {
            const isGroupItem = item.type === 'group';
            const unread = hasUnread(item);
            return (
              <TouchableOpacity key={item.id} style={styles.convRow} onPress={() => openChat(item)} activeOpacity={0.75}>
                <View style={[styles.convAvatar, isGroupItem && styles.convAvatarGroup]}>
                  <Ionicons name={isGroupItem ? 'people' : 'person'} size={22} color="#fff" />
                </View>
                <View style={styles.convBody}>
                  <View style={styles.convTitleRow}>
                    <Text style={[styles.convName, unread && styles.convNameUnread]}>
                      {item.name || (isGroupItem ? 'グループ' : '利用者')}
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
                <TouchableOpacity onPress={() => handleDeleteConversation(item)} style={{ padding: 8, marginLeft: 4 }}>
                  <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* グループ作成モーダル - 縦スクロール方式に変更 */}
        <Modal visible={createGroupModalVisible} transparent={true} animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.createGroupModalContentFull}>
              <View style={styles.modalHeaderInner}>
                 <Text style={{ fontSize: 20, fontWeight: 'bold', color: COLORS.text }}>新規グループ作成</Text>
                 <TouchableOpacity onPress={() => setCreateGroupModalVisible(false)}>
                    <Ionicons name="close" size={28} color={COLORS.textLight} />
                 </TouchableOpacity>
              </View>
              
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                <Text style={styles.modalSubLabel}>グループ名</Text>
                <TextInput
                  style={styles.textInputLarge}
                  placeholder="読みやすい名前を入力"
                  placeholderTextColor={COLORS.textLight}
                  value={newGroupName}
                  onChangeText={setNewGroupName}
                />

                <Text style={styles.modalSubLabel}>グループ権限設定</Text>
                <View style={styles.settingsContainer}>
                  <TouchableOpacity 
                    style={styles.settingItem}
                    onPress={() => setAllowMemberChat(!allowMemberChat)}
                  >
                    <Ionicons 
                      name={allowMemberChat ? "checkbox" : "square-outline"} 
                      size={24} color={allowMemberChat ? COLORS.primary : '#ccc'} 
                    />
                    <Text style={styles.settingText}>メンバーの発言を許可</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.settingItem, { marginTop: 12 }]}
                    onPress={() => setAllowMemberCall(!allowMemberCall)}
                  >
                    <Ionicons 
                      name={allowMemberCall ? "checkbox" : "square-outline"} 
                      size={24} color={allowMemberCall ? COLORS.primary : '#ccc'} 
                    />
                    <Text style={styles.settingText}>メンバーのビデオ通話を許可</Text>
                  </TouchableOpacity>
                </View>
                
                <Text style={styles.modalSubLabel}>メンバーを選択</Text>
                <View style={styles.searchBarGroup}>
                  <Ionicons name="search" size={20} color={COLORS.textLight} style={{marginRight: 8}} />
                  <TextInput
                    style={{ flex: 1, fontSize: 16 }}
                    placeholder="名前・かなで検索"
                    value={groupSearchQuery}
                    onChangeText={setGroupSearchQuery}
                  />
                </View>

                <View style={styles.filterContainerGroup}>
                  {['all', 'user', 'staff'].map((r: any) => (
                    <TouchableOpacity 
                       key={r} 
                       style={[styles.filterBtnGroup, groupFilterRole === r && styles.filterBtnGroupActive]} 
                       onPress={() => setGroupFilterRole(r)}
                    >
                      <Text style={[styles.filterTextGroup, groupFilterRole === r && styles.filterTextGroupActive]}>
                        {r === 'all' ? 'すべて' : r === 'user' ? '利用者' : 'スタッフ'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={{ marginBottom: 20 }}>
                  {filteredGroupAccounts.map(item => (
                    <TouchableOpacity 
                      key={item.id}
                      style={styles.memberSelectRow}
                      onPress={() => toggleUserSelection(item.id)}
                    >
                      <Ionicons 
                        name={selectedUserIds.includes(item.id) ? "checkbox" : "square-outline"} 
                        size={26} color={selectedUserIds.includes(item.id) ? COLORS.primary : '#ccc'} 
                        style={{ marginRight: 12 }}
                      />
                      <View style={[styles.smallBadge, item.role === 'staff' ? styles.smallBadgeStaff : styles.smallBadgeUser]}>
                        <Text style={styles.smallBadgeText}>{item.role === 'staff' ? 'スタッフ' : '利用者'}</Text>
                      </View>
                      <Text style={{ fontSize: 17, color: COLORS.text }}>{item.name}</Text>
                    </TouchableOpacity>
                  ))}
                  {filteredGroupAccounts.length === 0 && <Text style={styles.emptyText}>該当者なし</Text>}
                </View>
              </ScrollView>
              
              <View style={styles.modalFooter}>
                <TouchableOpacity style={styles.modalCreateBtn} onPress={handleCreateGroup}>
                  <Text style={styles.modalCreateBtnText}>グループを作成する</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  const calleeDisplayName = resolvedUser?.role === 'admin' ? (activeConv?.name ?? '') : '管理者';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {activeConv?.name || 'チャット'}
        </Text>
        {canCall && callStatus === 'idle' && (
          <TouchableOpacity style={styles.callHeaderBtn} onPress={() => startCall(activeConv!.id, calleeDisplayName, true)}>
            <Ionicons name="call" size={20} color="#5D4037" />
          </TouchableOpacity>
        )}
        {canCall && callStatus === 'idle' && (
          <TouchableOpacity style={styles.callHeaderBtn} onPress={() => startCall(activeConv!.id, calleeDisplayName)}>
            <Ionicons name="videocam" size={20} color="#5D4037" />
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 14, paddingBottom: 10 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.length === 0 && (
            <View style={styles.centerBox}>
              <Ionicons name="chatbubble-outline" size={48} color={COLORS.border} />
              <Text style={styles.emptyText}>メッセージはまだありません</Text>
            </View>
          )}
          {messages.map(item => {
            const isMe = item.senderId === resolvedUser?.accountId;
            const showRead = isMe && activeConv?.type === 'direct' && item.id === myLastMsgId && othersHaveRead;
            return (
              <View key={item.id} style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}>
                {!isMe && (
                  <View style={styles.msgAvatar}>
                    <Text style={styles.msgAvatarText}>{(item.senderName || '?')[0]}</Text>
                  </View>
                )}
                <View style={{ flex: 1, alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                  <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                    {!isMe && <Text style={styles.bubbleSender}>{item.senderName}</Text>}
                    {item.imageUrl
                      ? <Image source={{ uri: item.imageUrl }} style={styles.bubbleImage} resizeMode="cover" />
                      : <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.text}</Text>
                    }
                    <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>{msgTime(item.createdAt)}</Text>
                  </View>
                  {showRead && <Text style={styles.readLabel}>既読</Text>}
                </View>
              </View>
            );
          })}
        </ScrollView>

        {canChat ? (
          <View style={styles.inputArea}>
            <TouchableOpacity style={styles.imageBtn} onPress={sendImage} disabled={isSending}>
              <Ionicons name="image-outline" size={24} color={COLORS.primary} />
            </TouchableOpacity>
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder="メッセージ..."
              multiline
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!inputText.trim() || isSending) && styles.sendBtnDisabled]}
              onPress={sendMessage}
              disabled={!inputText.trim() || isSending}
            >
              <Ionicons name="send" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.readOnlyArea}>
            <Text style={styles.readOnlyText}>管理者のみ発信可能です</Text>
          </View>
        )}
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
  callHeaderBtn: { padding: 8, marginLeft: 8, backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 20 },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  loadingText: { color: COLORS.textLight, marginTop: 12 },
  emptyText: { color: COLORS.textLight, marginTop: 16, fontSize: 15, textAlign: 'center' },
  retryBtn: { marginTop: 20, backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  convRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#F0E4D0', backgroundColor: '#fff' },
  convAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#87CEEB', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
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
  msgRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end' },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  msgAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#87CEEB', justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  msgAvatarText: { fontSize: 12, color: '#fff', fontWeight: 'bold' },
  bubble: { maxWidth: '72%', padding: 10, borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 },
  bubbleImage: { width: 200, height: 150, borderRadius: 8, marginBottom: 4 },
  bubbleMe: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#fff', borderBottomLeftRadius: 4 },
  bubbleSender: { fontSize: 11, fontWeight: 'bold', color: '#888', marginBottom: 3 },
  bubbleText: { fontSize: 15, color: '#333', lineHeight: 21 },
  bubbleTextMe: { color: '#fff' },
  bubbleTime: { fontSize: 10, color: '#999', marginTop: 4, textAlign: 'right' },
  bubbleTimeMe: { color: 'rgba(255,255,255,0.7)' },
  readLabel: { fontSize: 10, color: COLORS.textLight, marginTop: 2, marginRight: 2 },
  inputArea: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#F0E4D0' },
  imageBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', marginRight: 6 },
  textInput: { flex: 1, backgroundColor: '#F8F4EE', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 120, borderWidth: 1, borderColor: '#E8DDD0' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  sendBtnDisabled: { opacity: 0.4 },
  readOnlyArea: { paddingVertical: 20, alignItems: 'center', borderTopWidth: 1, borderColor: '#F0E4D0' },
  readOnlyText: { fontSize: 13, color: COLORS.textLight, fontWeight: 'bold' },

  // モーダル強化 (縦スクロール・ゆったり配置)
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  createGroupModalContentFull: { width: '100%', height: '90%', backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHeaderInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalSubLabel: { fontSize: 15, fontWeight: 'bold', color: COLORS.text, marginBottom: 12, marginTop: 8 },
  textInputLarge: { backgroundColor: '#F8F4EE', borderRadius: 12, padding: 16, fontSize: 18, borderWidth: 1, borderColor: '#E8DDD0', marginBottom: 20 },
  settingsContainer: { backgroundColor: '#F8F4EE', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E8DDD0', marginBottom: 24 },
  settingItem: { flexDirection: 'row', alignItems: 'center' },
  settingText: { fontSize: 16, color: COLORS.text, marginLeft: 12 },
  searchBarGroup: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F4EE', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 12, borderWidth: 1, borderColor: '#E8DDD0' },
  filterContainerGroup: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  filterBtnGroup: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10, backgroundColor: '#F8F4EE', borderWidth: 1, borderColor: '#E8DDD0' },
  filterBtnGroupActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterTextGroup: { fontSize: 14, fontWeight: 'bold', color: COLORS.textLight },
  filterTextGroupActive: { color: '#fff' },
  memberSelectRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: '#F0E4D0' },
  smallBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginRight: 10 },
  smallBadgeStaff: { backgroundColor: COLORS.secondary },
  smallBadgeUser: { backgroundColor: COLORS.primary },
  smallBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  modalFooter: { paddingTop: 16, borderTopWidth: 1, borderColor: '#F0E4D0', paddingBottom: Platform.OS === 'ios' ? 20 : 0 },
  modalCreateBtn: { backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  modalCreateBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});