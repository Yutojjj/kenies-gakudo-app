import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
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
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
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

type UserInfo = { role: string; name: string; accountId?: string };
type ConvDoc = {
  id: string; type: 'direct' | 'group'; name: string;
  lastMessage?: string; lastMessageAt?: any; unreadFor?: string[];
  participants?: string[];
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
  if (convId.startsWith('staff_dm_')) {
    // staff_dm_{id1}_{id2} 形式
    const parts = convId.replace('staff_dm_', '').split('__');
    return parts.length === 2 ? parts : [];
  }
  if (convId.startsWith('direct_')) {
    const userId = convId.replace('direct_', '');
    return [ADMIN_ID, userId];
  }
  return [];
}

// スタッフ同士のDM用conversationId生成（order保証）
function getStaffDmId(id1: string, id2: string): string {
  const sorted = [id1, id2].sort();
  return `staff_dm_${sorted[0]}__${sorted[1]}`;
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


// 利用者一覧セクション（絞り込み付き・グループ追加ポップアップ付き）
function UserListSection({ accounts, masterSchools, searchQuery, openChat, openCreateGroupModal, setSelectedUserIds, conversations, onAddToGroup }: {
  accounts: any[]; masterSchools: string[]; searchQuery: string;
  openChat: (c: any) => void; openCreateGroupModal: () => void; setSelectedUserIds: any;
  conversations: any[]; onAddToGroup: (groupId: string, accId: string) => void;
}) {
  const [filterSchool, setFilterSchool] = React.useState('');
  const [filterDow, setFilterDow] = React.useState('');
  const [localSearch, setLocalSearch] = React.useState('');
  const [groupPickTarget, setGroupPickTarget] = React.useState<any | null>(null);
  const DOW = ['月','火','水','木','金'];
  const groups = conversations.filter((c: any) => c.type === 'group');
  const users = accounts.filter(a => {
    if (a.role !== 'user') return false;
    if (localSearch) {
      const q = localSearch.toLowerCase();
      if (!a.name?.toLowerCase().includes(q) && !a.nicknameKana?.toLowerCase().includes(q)) return false;
    }
    if (filterSchool && a.school !== filterSchool) return false;
    if (filterDow && !(a.days?.[filterDow])) return false;
    return true;
  }).sort((a: any, b: any) => {
    const ga = parseInt(a.grade?.match(/\d/)?.[0] || '99');
    const gb = parseInt(b.grade?.match(/\d/)?.[0] || '99');
    return ga - gb;
  });

  const btnStyle = (active: boolean, activeColor: string): any => ({
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12,
    backgroundColor: active ? activeColor : '#F5F5F5',
    borderWidth: 1.5, borderColor: active ? activeColor : '#DDD',
  });
  const btnTextStyle = (active: boolean): any => ({
    fontSize: 13, fontWeight: 'bold', color: active ? '#fff' : '#555',
  });

  return (
    <View style={{ marginHorizontal: 12, marginBottom: 10, backgroundColor: '#FFF8E1', borderRadius: 10, borderWidth: 1, borderColor: '#FFE082', padding: 10 }}>
      {/* 学校フィルター */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={btnStyle(!filterSchool, '#E65100')} onPress={() => setFilterSchool('')}>
            <Text style={btnTextStyle(!filterSchool)}>全校</Text>
          </TouchableOpacity>
          {masterSchools.map(s => (
            <TouchableOpacity key={s} style={btnStyle(filterSchool === s, '#E65100')} onPress={() => setFilterSchool(filterSchool === s ? '' : s)}>
              <Text style={btnTextStyle(filterSchool === s)}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      {/* 曜日フィルター */}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <TouchableOpacity style={btnStyle(!filterDow, '#FF8F00')} onPress={() => setFilterDow('')}>
          <Text style={btnTextStyle(!filterDow)}>全曜日</Text>
        </TouchableOpacity>
        {DOW.map(d => (
          <TouchableOpacity key={d} style={btnStyle(filterDow === d, '#FF8F00')} onPress={() => setFilterDow(filterDow === d ? '' : d)}>
            <Text style={btnTextStyle(filterDow === d)}>{d}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {/* 利用者内検索バー（名前・ニックネーム） */}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 10, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1.5, borderColor: '#FFD54F' }}>
        <Ionicons name="search" size={16} color="#888" style={{ marginRight: 8 }} />
        <TextInput style={{ flex: 1, fontSize: 13 }} placeholder="名前・ニックネームで絞り込み" placeholderTextColor="#BBB"
          onChangeText={text => setLocalSearch(text)} value={localSearch} />
        {localSearch.length > 0 && (
          <TouchableOpacity onPress={() => setLocalSearch('')}>
            <Ionicons name="close-circle" size={16} color="#aaa" />
          </TouchableOpacity>
        )}
      </View>
      {/* 利用者カード */}
      {users.length === 0 ? (
        <Text style={{ textAlign: 'center', color: '#aaa', padding: 16 }}>該当する利用者はいません</Text>
      ) : users.map(acc => (
        <View key={acc.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#FFE082' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: 'bold', fontSize: 14, color: '#333' }}>{acc.name}</Text>
            <Text style={{ fontSize: 11, color: '#888' }}>{acc.grade}　{acc.school}</Text>
            {acc.days && (
              <Text style={{ fontSize: 11, color: '#5B9BD5', marginTop: 2 }}>
                {DOW.filter(d => acc.days[d]).join('・') || '曜日未設定'}
              </Text>
            )}
          </View>
          {/* トークボタン */}
          <TouchableOpacity style={{ padding: 10, backgroundColor: '#E3F2FD', borderRadius: 10, marginRight: 8 }}
            onPress={() => openChat({ id: `direct_${acc.id}`, type: 'direct', name: acc.name })}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color="#1565C0" />
          </TouchableOpacity>
          {/* グループ追加ボタン */}
          <TouchableOpacity style={{ padding: 10, backgroundColor: '#E8F5E9', borderRadius: 10 }}
            onPress={() => setGroupPickTarget(acc)}>
            <Ionicons name="person-add-outline" size={20} color="#2E7D32" />
          </TouchableOpacity>
        </View>
      ))}

      {/* グループ選択ポップアップ */}
      <Modal visible={!!groupPickTarget} transparent animationType="fade">
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'center', alignItems:'center', padding:20 }}>
          <View style={{ width:'100%', maxHeight:'70%', backgroundColor:'#fff', borderRadius:16, overflow:'hidden' }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, backgroundColor:'#E8F5E9', borderBottomWidth:1, borderColor:'#A5D6A7' }}>
              <Text style={{ fontWeight:'bold', fontSize:15, color:'#2E7D32' }}>
                {groupPickTarget?.name} をグループに追加
              </Text>
              <TouchableOpacity onPress={() => setGroupPickTarget(null)}>
                <Ionicons name="close-circle" size={26} color="#555" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding:12 }}>
              {groups.length === 0 ? (
                <View style={{ padding:20, alignItems:'center' }}>
                  <Text style={{ color:'#aaa', fontSize:13 }}>グループがありません</Text>
                  <TouchableOpacity style={{ marginTop:12, backgroundColor:'#2E7D32', borderRadius:10, padding:12, alignItems:'center' }}
                    onPress={() => { setGroupPickTarget(null); openCreateGroupModal(); }}>
                    <Text style={{ color:'#fff', fontWeight:'bold' }}>新規グループを作成</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {groups.map((grp: any) => (
                    <TouchableOpacity key={grp.id}
                      style={{ flexDirection:'row', alignItems:'center', padding:14, borderRadius:12, backgroundColor:'#F9FBE7', marginBottom:8, borderWidth:1, borderColor:'#DCEDC8' }}
                      onPress={() => { onAddToGroup(grp.id, groupPickTarget.id); setGroupPickTarget(null); }}>
                      <Ionicons name="people" size={22} color="#2E7D32" style={{ marginRight:10 }} />
                      <Text style={{ flex:1, fontWeight:'bold', fontSize:14, color:'#333' }}>{grp.name || 'グループ'}</Text>
                      <Ionicons name="add-circle-outline" size={22} color="#2E7D32" />
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={{ flexDirection:'row', alignItems:'center', justifyContent:'center', padding:12, borderRadius:10, borderWidth:1, borderColor:'#A5D6A7', gap:6 }}
                    onPress={() => { setGroupPickTarget(null); setSelectedUserIds((p: string[]) => [...p, groupPickTarget.id]); openCreateGroupModal(); }}>
                    <Ionicons name="add-circle-outline" size={18} color="#2E7D32" />
                    <Text style={{ color:'#2E7D32', fontWeight:'bold', fontSize:13 }}>新規グループを作成して追加</Text>
                  </TouchableOpacity>
                </>
              )}
              <View style={{ height:20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// スタッフ一覧セクション（グループ追加ポップアップ付き）
function StaffListSection({ accounts, searchQuery, conversations, openChat, openCreateGroupModal, setSelectedUserIds, onAddToGroup, myAccountId = '' }: {
  accounts: any[]; searchQuery: string; conversations: any[];
  openChat: (c: any) => void; openCreateGroupModal: () => void; setSelectedUserIds: any;
  onAddToGroup: (groupId: string, accId: string) => void; myAccountId?: string;
}) {
  const [groupPickTarget, setGroupPickTarget] = React.useState<any | null>(null);
  const groups = conversations.filter((c: any) => c.type === 'group');
  const staffList = accounts.filter(a => a.role === 'staff' && a.id !== myAccountId && (!searchQuery || a.name?.includes(searchQuery)));

  return (
    <View style={{ marginHorizontal: 12, marginBottom: 10, backgroundColor: '#E8F0FE', borderRadius: 10, borderWidth: 1, borderColor: '#BBDEFB', overflow: 'hidden' }}>
      {/* 稲熊（管理者）カード - 常に最上部に表示 */}
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1.5, borderColor: '#AEE4F5', backgroundColor: '#F0F9FF' }}
        onPress={() => openChat({ id: 'direct_admin', type: 'direct', name: '稲熊' })}
      >
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#AEE4F5', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
          <Ionicons name="star" size={16} color="#5D4037" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: 'bold', fontSize: 14, color: '#333' }}>稲熊</Text>
          <Text style={{ fontSize: 11, color: '#888' }}>管理者</Text>
        </View>
        <View style={{ padding: 10, backgroundColor: '#AEE4F5', borderRadius: 10 }}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color="#5D4037" />
        </View>
      </TouchableOpacity>

      {staffList.map(acc => (
        <View key={acc.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderColor: '#EEE' }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#90CAF9', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
            <Ionicons name="person" size={16} color="#1565C0" />
          </View>
          <Text style={{ flex: 1, fontWeight: 'bold', fontSize: 14, color: '#333' }}>{acc.name}</Text>
          <TouchableOpacity style={{ padding: 10, backgroundColor: '#BBDEFB', borderRadius: 10, marginRight: 8 }}
            onPress={() => {
              const dmId = getStaffDmId(acc.id, myAccountId || acc.id);
              openChat({ id: dmId, type: 'direct', name: acc.name });
            }}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color="#1565C0" />
          </TouchableOpacity>
          <TouchableOpacity style={{ padding: 10, backgroundColor: '#C8E6C9', borderRadius: 10 }}
            onPress={() => setGroupPickTarget(acc)}>
            <Ionicons name="person-add-outline" size={18} color="#2E7D32" />
          </TouchableOpacity>
        </View>
      ))}

      {/* グループ選択ポップアップ */}
      <Modal visible={!!groupPickTarget} transparent animationType="fade">
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'center', alignItems:'center', padding:20 }}>
          <View style={{ width:'100%', maxHeight:'70%', backgroundColor:'#fff', borderRadius:16, overflow:'hidden' }}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, backgroundColor:'#E8F5E9', borderBottomWidth:1, borderColor:'#A5D6A7' }}>
              <Text style={{ fontWeight:'bold', fontSize:15, color:'#2E7D32' }}>
                {groupPickTarget?.name} をグループに追加
              </Text>
              <TouchableOpacity onPress={() => setGroupPickTarget(null)}>
                <Ionicons name="close-circle" size={26} color="#555" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding:12 }}>
              {groups.length === 0 ? (
                <View style={{ padding:20, alignItems:'center' }}>
                  <Text style={{ color:'#aaa', fontSize:13 }}>グループがありません</Text>
                  <TouchableOpacity style={{ marginTop:12, backgroundColor:'#2E7D32', borderRadius:10, padding:12, alignItems:'center' }}
                    onPress={() => { setGroupPickTarget(null); openCreateGroupModal(); }}>
                    <Text style={{ color:'#fff', fontWeight:'bold' }}>新規グループを作成</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {groups.map((grp: any) => (
                    <TouchableOpacity key={grp.id}
                      style={{ flexDirection:'row', alignItems:'center', padding:14, borderRadius:12, backgroundColor:'#F9FBE7', marginBottom:8, borderWidth:1, borderColor:'#DCEDC8' }}
                      onPress={() => { onAddToGroup(grp.id, groupPickTarget.id); setGroupPickTarget(null); }}>
                      <Ionicons name="people" size={22} color="#2E7D32" style={{ marginRight:10 }} />
                      <Text style={{ flex:1, fontWeight:'bold', fontSize:14, color:'#333' }}>{grp.name || 'グループ'}</Text>
                      <Ionicons name="add-circle-outline" size={22} color="#2E7D32" />
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={{ flexDirection:'row', alignItems:'center', justifyContent:'center', padding:12, borderRadius:10, borderWidth:1, borderColor:'#A5D6A7', gap:6 }}
                    onPress={() => { setGroupPickTarget(null); setSelectedUserIds((p: string[]) => [...p, groupPickTarget.id]); openCreateGroupModal(); }}>
                    <Ionicons name="add-circle-outline" size={18} color="#2E7D32" />
                    <Text style={{ color:'#2E7D32', fontWeight:'bold', fontSize:13 }}>新規グループを作成して追加</Text>
                  </TouchableOpacity>
                </>
              )}
              <View style={{ height:20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default function MessagesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string; conversationName?: string; conversationType?: string }>();
  const { startCall, callStatus } = useCall();

  const [resolvedUser, setResolvedUser] = useState<(UserInfo & { accountId: string }) | null>(null);
  const [view, setView] = useState<'list' | 'chat'>('list');
  const [msgTab, setMsgTab] = useState<'home' | 'talk'>('home'); // ⑬ 管理者用タブ
  const [homeSchool, setHomeSchool] = useState<string | null>(null); // ⑬ ホームタブの学校フィルター
  const [homeMasterSchools, setHomeMasterSchools] = useState<string[]>([]);
  const [homeAllAccounts, setHomeAllAccounts] = useState<any[]>([]);
  const [conversations, setConversations] = useState<ConvDoc[]>([]);
  const [activeConv, setActiveConv] = useState<ConvDoc | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [convReadBy, setConvReadBy] = useState<string[]>([]);

  const [createGroupModalVisible, setCreateGroupModalVisible] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [availableAccounts, setAvailableAccounts] = useState<any[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [groupFilterRole, setGroupFilterRole] = useState<'all' | 'user' | 'staff'>('all');
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [groupFilterSchool, setGroupFilterSchool] = useState('');
  const [groupFilterDow, setGroupFilterDow] = useState('');
  const [allowMemberChat, setAllowMemberChat] = useState(true);
  const [allowMemberCall, setAllowMemberCall] = useState(true);

  const [manageMembersModalVisible, setManageMembersModalVisible] = useState(false);
  const [managingConv, setManagingConv] = useState<ConvDoc | null>(null);
  const [managingParticipants, setManagingParticipants] = useState<string[]>([]);
  const [memberMgmtSearch, setMemberMgmtSearch] = useState('');
  const [memberMgmtSchool, setMemberMgmtSchool] = useState('');
  const [memberMgmtGrade, setMemberMgmtGrade] = useState('');

  const scrollRef = useRef<ScrollView>(null);
  const unsubListRef = useRef<(() => void) | null>(null);
  const unsubMsgsRef = useRef<(() => void) | null>(null);
  const unsubConvRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(async raw => {
      if (!raw) { setError('ログインが必要です'); setLoading(false); return; }
      let user: UserInfo; try { user = JSON.parse(raw); } catch { router.replace('/'); return; }
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

  // ⑬ ホームタブ用データロード（管理者・スタッフ共通）
  useEffect(() => {
    if (!resolvedUser) return;
    if (resolvedUser.role !== 'admin' && resolvedUser.role !== 'staff') return;
    getDocs(collection(db, 'accounts')).then(snap => {
      setHomeAllAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    if (resolvedUser.role === 'admin') {
      getDoc(doc(db, 'settings', 'master_data')).then(snap => {
        if (snap.exists() && snap.data().schools) setHomeMasterSchools(snap.data().schools);
      });
    }
  }, [resolvedUser?.role]);

  useEffect(() => {
    if (!resolvedUser) return;

    unsubListRef.current?.();
    unsubListRef.current = null;

    if (params.conversationId) {
      const loadConv = async () => {
        try {
          const convDocSnap = await getDoc(doc(db, 'conversations', params.conversationId!));
          let conv: ConvDoc;
          if (convDocSnap.exists()) {
            conv = { id: params.conversationId!, ...convDocSnap.data() } as ConvDoc;
          } else {
            const convType = (params.conversationType as 'direct' | 'group') || 'direct';
            conv = { id: params.conversationId!, type: convType, name: params.conversationName || 'ユーザー' };
            if (convType !== 'group') {
              setDoc(doc(db, 'conversations', params.conversationId!), {
                type: 'direct', name: params.conversationName || 'ユーザー',
                participants: [ADMIN_ID, params.conversationId!.replace('direct_', '')],
              }, { merge: true }).catch(() => {});
            }
          }
          openChat(conv);
        } catch (e) {
          openChat({ id: params.conversationId!, type: 'direct', name: params.conversationName || 'ユーザー' });
        } finally {
          setLoading(false);
        }
      };
      loadConv();
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
      unsubListRef.current = unsub;
      return () => { unsubListRef.current?.(); };
    }

    // スタッフ・利用者: 自分が参加している会話一覧を表示
    const setupConversations = async () => {
      try {
        if (resolvedUser.role === 'staff') {
          await setDoc(doc(db, 'conversations', STAFF_GROUP_ID), {
            type: 'group', name: 'スタッフグループ',
            participants: arrayUnion(ADMIN_ID, resolvedUser.accountId),
          }, { merge: true });
        } else {
          const convId = `direct_${resolvedUser.accountId}`;
          await setDoc(doc(db, 'conversations', convId), {
            type: 'direct', name: resolvedUser.name,
            participants: [ADMIN_ID, resolvedUser.accountId],
          }, { merge: true });
        }
      } catch (e) {
        console.warn('Setup conversation error', e);
      }
      unsubListRef.current = onSnapshot(
        query(collection(db, 'conversations'), where('participants', 'array-contains', resolvedUser.accountId)),
        snap => {
          const convs: ConvDoc[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as ConvDoc));
          convs.sort((a, b) => (b.lastMessageAt?.seconds || 0) - (a.lastMessageAt?.seconds || 0));
          setConversations(convs);
          setLoading(false);
        },
        () => setLoading(false)
      );
    };
    setupConversations();
    return () => { unsubListRef.current?.(); };
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
    unsubListRef.current?.();
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
      const convUrl = `/messages?conversationId=${encodeURIComponent(activeConv.id)}&conversationName=${encodeURIComponent(activeConv.name || '')}&conversationType=${activeConv.type}`;
      pushNotify(activeConv.id, activeConv.type, resolvedUser.accountId, resolvedUser.name, text, convUrl);
    } catch (e) {
      console.error('Send failed:', e);
    } finally {
      setIsSending(false);
    }
  };

  const sendImage = async () => {
    if (!activeConv || !resolvedUser || isSending) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('権限エラー', '写真ライブラリへのアクセスを許可してください');
      return;
    }
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
      const convUrl = `/messages?conversationId=${encodeURIComponent(activeConv.id)}&conversationName=${encodeURIComponent(activeConv.name || '')}&conversationType=${activeConv.type}`;
      pushNotify(activeConv.id, activeConv.type, resolvedUser.accountId, resolvedUser.name, '📷 画像', convUrl);
    } catch (e) {
      console.error('Image send failed:', e);
    } finally {
      setIsSending(false);
    }
  };

  const goBack = () => {
    if (view === 'chat' && !params.conversationId) {
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
      // nameが空のもの（兄弟データなど）を除外
      const accs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((a: any) => !!a.name && (a.role === 'user' || a.role === 'staff' || a.role === 'admin'));
      setAvailableAccounts(accs);
      setGroupFilterRole('all');
      setGroupFilterSchool('');
      setGroupFilterDow('');
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

  const openManageMembersModal = async (conv: ConvDoc) => {
    try {
      const convDocSnap = await getDoc(doc(db, 'conversations', conv.id));
      const participants: string[] = convDocSnap.data()?.participants || [];
      if (availableAccounts.length === 0) {
        const snap = await getDocs(collection(db, 'accounts'));
        setAvailableAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
      setManagingConv(conv);
      setManagingParticipants(participants);
      setManageMembersModalVisible(true);
    } catch (e) {
      if (Platform.OS === 'web') {
        window.alert('メンバー情報の取得に失敗しました');
      } else {
        Alert.alert('エラー', 'メンバー情報の取得に失敗しました');
      }
    }
  };

  const handleRemoveMember = async (accountId: string) => {
    if (!managingConv) return;
    try {
      await setDoc(doc(db, 'conversations', managingConv.id), {
        participants: arrayRemove(accountId),
      }, { merge: true });
      setManagingParticipants(prev => prev.filter(id => id !== accountId));
    } catch (e) {
      Alert.alert('エラー', 'メンバーの削除に失敗しました');
    }
  };

  const handleAddMemberToGroup = async (accountId: string) => {
    if (!managingConv) return;
    try {
      await setDoc(doc(db, 'conversations', managingConv.id), {
        participants: arrayUnion(accountId),
        unreadFor: arrayUnion(accountId),
      }, { merge: true });
      setManagingParticipants(prev => [...prev, accountId]);
    } catch (e) {
      Alert.alert('エラー', 'メンバーの追加に失敗しました');
    }
  };

  const filteredGroupAccounts = availableAccounts.filter(acc => {
    if (groupFilterRole !== 'all' && acc.role !== groupFilterRole) return false;
    if (groupFilterSchool && acc.school !== groupFilterSchool) return false;
    if (groupFilterDow && !(acc.days?.[groupFilterDow])) return false;
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
  
  // 管理者は常にOK。DMは常にOK。グループは設定に従う
  const canChat = isAdmin || isDirect || (isGroup && activeConv?.settings?.allowChat !== false);
  const canCall = isAdmin || isDirect || (isGroup && activeConv?.settings?.allowCall !== false);

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

  if (view === 'list') {
    const myId = resolvedUser?.accountId || ADMIN_ID;
    const hasUnread = (conv: ConvDoc) => (conv.unreadFor || []).includes(myId);
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#5D4037" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>メッセージ</Text>
          {isAdmin && (
            <TouchableOpacity onPress={openCreateGroupModal} style={styles.callHeaderBtn}>
              <Ionicons name="people-circle-outline" size={24} color="#5D4037" />
            </TouchableOpacity>
          )}
        </View>

        {/* ⑫⑬ 管理者・スタッフのホーム/トークタブ */}
        {(isAdmin || resolvedUser?.role === 'staff') && (
          <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee' }}>
            <TouchableOpacity
              style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: msgTab === 'home' ? COLORS.primary : 'transparent' }}
              onPress={() => setMsgTab('home')}
            >
              <Text style={{ fontWeight: 'bold', color: msgTab === 'home' ? COLORS.primary : '#888' }}>ホーム</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: msgTab === 'talk' ? COLORS.primary : 'transparent' }}
              onPress={() => setMsgTab('talk')}
            >
              <Text style={{ fontWeight: 'bold', color: msgTab === 'talk' ? COLORS.primary : '#888' }}>トーク</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ⑫⑬ ホームタブ */}
        {(isAdmin || resolvedUser?.role === 'staff') && msgTab === 'home' ? (
          <ScrollView style={{ flex: 1 }}>
            {/* スタッフ専用: スタッフ一覧のみ（利用者とのトークは不可） */}
            {!isAdmin && (
              <>
                <Text style={{ fontSize: 12, color: '#888', padding: 12, paddingBottom: 4 }}>スタッフ同士・スタッフ↔管理者のトークができます</Text>
                <StaffListSection
                  accounts={homeAllAccounts.filter((a: any) => a.role === 'staff' || a.role === 'admin')}
                  searchQuery=""
                  conversations={conversations}
                  openChat={openChat}
                  openCreateGroupModal={openCreateGroupModal}
                  setSelectedUserIds={setSelectedUserIds}
                  myAccountId={resolvedUser?.accountId || ''}
                  onAddToGroup={async (groupId: string, accId: string) => {
                    await setDoc(doc(db, 'conversations', groupId), { participants: arrayUnion(accId) }, { merge: true });
                  }}
                />
              </>
            )}
            {/* 管理者専用: グループ一覧・スタッフ・利用者 */}
            {isAdmin && (<>
            {/* グループ一覧（アコーディオン） */}
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#E8F5E9', borderRadius: 12, marginHorizontal: 12, marginBottom: 4, padding: 14, borderWidth: 1, borderColor: '#A5D6A7' }}
              onPress={() => setHomeSchool(homeSchool === '__groups__' ? null : '__groups__')}
            >
              <Ionicons name="people-circle" size={28} color="#2E7D32" style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: 'bold', fontSize: 15, color: '#2E7D32' }}>グループ一覧</Text>
                <Text style={{ fontSize: 12, color: '#558B2F' }}>{conversations.filter(c => c.type === 'group').length}グループ</Text>
              </View>
              <Ionicons name={homeSchool === '__groups__' ? 'chevron-up' : 'chevron-down'} size={20} color="#2E7D32" />
            </TouchableOpacity>
            {homeSchool === '__groups__' && (
              <View style={{ marginHorizontal: 12, marginBottom: 10, backgroundColor: '#F9FBE7', borderRadius: 10, borderWidth: 1, borderColor: '#DCEDC8', overflow: 'hidden' }}>
                {conversations.filter(c => c.type === 'group' && (!groupSearchQuery || c.name?.includes(groupSearchQuery))).map(grp => (
                  <TouchableOpacity key={grp.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderColor: '#EEE' }} onPress={() => openChat(grp)}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#A5D6A7', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                      <Ionicons name="people" size={16} color="#2E7D32" />
                    </View>
                    <Text style={{ flex: 1, fontWeight: 'bold', fontSize: 14, color: '#333' }}>{grp.name || 'グループ'}</Text>
                    <TouchableOpacity onPress={() => openManageMembersModal(grp)} style={{ padding: 6 }}>
                      <Ionicons name="settings-outline" size={16} color={COLORS.primary} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', padding: 12, justifyContent: 'center', gap: 6 }} onPress={openCreateGroupModal}>
                  <Ionicons name="add-circle-outline" size={18} color="#2E7D32" />
                  <Text style={{ color: '#2E7D32', fontWeight: 'bold', fontSize: 13 }}>新規グループを作成</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* スタッフ一覧（アコーディオン） */}
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#E3F2FD', borderRadius: 12, marginHorizontal: 12, marginBottom: 4, padding: 14, borderWidth: 1, borderColor: '#90CAF9' }}
              onPress={() => setHomeSchool(homeSchool === '__staff__' ? null : '__staff__')}
            >
              <Ionicons name="briefcase-outline" size={28} color="#1565C0" style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: 'bold', fontSize: 15, color: '#1565C0' }}>スタッフ一覧</Text>
                <Text style={{ fontSize: 12, color: '#1976D2' }}>{homeAllAccounts.filter(a => a.role === 'staff').length}名</Text>
              </View>
              <Ionicons name={homeSchool === '__staff__' ? 'chevron-up' : 'chevron-down'} size={20} color="#1565C0" />
            </TouchableOpacity>
            {homeSchool === '__staff__' && (
              <StaffListSection
                accounts={homeAllAccounts}
                searchQuery={groupSearchQuery}
                conversations={conversations}
                openChat={openChat}
                openCreateGroupModal={openCreateGroupModal}
                setSelectedUserIds={setSelectedUserIds}
                onAddToGroup={async (groupId: string, accId: string) => {
                  await setDoc(doc(db, 'conversations', groupId), { participants: arrayUnion(accId) }, { merge: true });
                }}
              />
            )}

            {/* 利用者一覧（アコーディオン＋絞り込み） */}
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF3E0', borderRadius: 12, marginHorizontal: 12, marginBottom: 4, marginTop: 4, padding: 14, borderWidth: 1, borderColor: '#FFCC80' }}
              onPress={() => setHomeSchool(homeSchool === '__users__' ? null : '__users__')}
            >
              <Ionicons name="school-outline" size={28} color="#E65100" style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: 'bold', fontSize: 15, color: '#E65100' }}>利用者一覧</Text>
                <Text style={{ fontSize: 12, color: '#BF360C' }}>{homeAllAccounts.filter(a => a.role === 'user').length}名</Text>
              </View>
              <Ionicons name={homeSchool === '__users__' ? 'chevron-up' : 'chevron-down'} size={20} color="#E65100" />
            </TouchableOpacity>
            {homeSchool === '__users__' && (
              <UserListSection
                accounts={homeAllAccounts}
                masterSchools={homeMasterSchools}
                searchQuery={groupSearchQuery}
                openChat={openChat}
                openCreateGroupModal={openCreateGroupModal}
                setSelectedUserIds={setSelectedUserIds}
                conversations={conversations}
                onAddToGroup={async (groupId: string, accId: string) => {
                  await setDoc(doc(db, 'conversations', groupId), { participants: arrayUnion(accId) }, { merge: true });
                }}
              />
            )}

            <View style={{ height: 60 }} />
            </>)}
          </ScrollView>
        ) : (
          <ScrollView style={{ flex: 1 }}>
          {conversations.length === 0 && (
            <View style={styles.centerBox}>
              <Ionicons name="chatbubbles-outline" size={60} color={COLORS.border} />
              <Text style={styles.emptyText}>まだ会話がありません</Text>
            </View>
          )}
          {conversations.filter(item => {
            // スタッフは利用者(role=user)とのdirectトークを表示しない
            if (resolvedUser?.role === 'staff' && item.type === 'direct') {
              const otherAccountId = item.id.replace('direct_', '');
              const otherAccount = homeAllAccounts.find((a: any) => a.id === otherAccountId);
              if (otherAccount?.role === 'user') return false;
            }
            return true;
          }).map(item => {
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
                {isAdmin && isGroupItem && (
                  <TouchableOpacity onPress={() => openManageMembersModal(item)} style={{ padding: 8, marginLeft: 4 }}>
                    <Ionicons name="settings-outline" size={20} color={COLORS.primary} />
                  </TouchableOpacity>
                )}
                {isAdmin && (
                  <TouchableOpacity onPress={() => handleDeleteConversation(item)} style={{ padding: 8, marginLeft: 4 }}>
                    <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })}
          </ScrollView>
        )} {/* ⑬ isAdmin && msgTab === 'home' の三項演算子終了 */}

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
                  placeholder="読みやすい名前を入力" placeholderTextColor="#BBBBBB"
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
                    <Text style={styles.settingText}>メンバーの通話を許可（音声・ビデオ共通）</Text>
                  </TouchableOpacity>
                </View>
                
                <Text style={styles.modalSubLabel}>メンバーを選択</Text>
                <View style={styles.searchBarGroup}>
                  <Ionicons name="search" size={20} color={COLORS.textLight} style={{marginRight: 8}} />
                  <TextInput
                    style={{ flex: 1, fontSize: 16 }}
                    placeholder="名前・かなで検索" placeholderTextColor="#BBBBBB"
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

                {/* 学校フィルター（利用者絞り込み時） */}
                {(groupFilterRole === 'all' || groupFilterRole === 'user') && homeMasterSchools.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                    <View style={{ flexDirection: 'row', gap: 6, paddingBottom: 4 }}>
                      <TouchableOpacity
                        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: !groupFilterSchool ? COLORS.primary : '#F5F5F5', borderWidth: 1, borderColor: !groupFilterSchool ? COLORS.primary : '#DDD' }}
                        onPress={() => setGroupFilterSchool('')}>
                        <Text style={{ fontSize: 12, fontWeight: 'bold', color: !groupFilterSchool ? '#fff' : '#555' }}>全校</Text>
                      </TouchableOpacity>
                      {homeMasterSchools.map(s => (
                        <TouchableOpacity key={s}
                          style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: groupFilterSchool === s ? COLORS.primary : '#F5F5F5', borderWidth: 1, borderColor: groupFilterSchool === s ? COLORS.primary : '#DDD' }}
                          onPress={() => setGroupFilterSchool(groupFilterSchool === s ? '' : s)}>
                          <Text style={{ fontSize: 12, fontWeight: 'bold', color: groupFilterSchool === s ? '#fff' : '#555' }}>{s}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                )}

                {/* 曜日フィルター（利用者絞り込み時） */}
                {(groupFilterRole === 'all' || groupFilterRole === 'user') && (
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                    {['全曜日','月','火','水','木','金'].map(d => {
                      const active = d === '全曜日' ? !groupFilterDow : groupFilterDow === d;
                      return (
                        <TouchableOpacity key={d}
                          style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: active ? '#FF8F00' : '#F5F5F5', borderWidth: 1, borderColor: active ? '#FF8F00' : '#DDD' }}
                          onPress={() => setGroupFilterDow(d === '全曜日' ? '' : groupFilterDow === d ? '' : d)}>
                          <Text style={{ fontSize: 12, fontWeight: 'bold', color: active ? '#fff' : '#555' }}>{d}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                <View style={{ marginBottom: 20 }}>
                  {/* 全選択/全解除ボタン */}
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingVertical: 8, paddingHorizontal: 4, marginBottom: 4 }}
                    onPress={() => {
                      const allIds = filteredGroupAccounts.map((a: any) => a.id);
                      const allSelected = allIds.every((id: string) => selectedUserIds.includes(id));
                      if (allSelected) {
                        setSelectedUserIds(selectedUserIds.filter((id: string) => !allIds.includes(id)));
                      } else {
                        const merged = [...new Set([...selectedUserIds, ...allIds])];
                        setSelectedUserIds(merged);
                      }
                    }}
                  >
                    <Ionicons
                      name={filteredGroupAccounts.every((a: any) => selectedUserIds.includes(a.id)) ? 'checkbox' : 'square-outline'}
                      size={20} color={COLORS.primary} style={{ marginRight: 6 }}
                    />
                    <Text style={{ fontSize: 13, fontWeight: 'bold', color: COLORS.primary }}>
                      {filteredGroupAccounts.every((a: any) => selectedUserIds.includes(a.id)) ? '全解除' : `全選択（${filteredGroupAccounts.length}名）`}
                    </Text>
                  </TouchableOpacity>
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

        {/* グループメンバー管理モーダル */}
        <Modal visible={manageMembersModalVisible} transparent={true} animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.createGroupModalContentFull}>
              <View style={styles.modalHeaderInner}>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: COLORS.text }}>メンバー管理</Text>
                <TouchableOpacity onPress={() => setManageMembersModalVisible(false)}>
                  <Ionicons name="close" size={28} color={COLORS.textLight} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                <Text style={styles.modalSubLabel}>現在のメンバー</Text>
                {managingParticipants.filter(id => id !== ADMIN_ID).map(id => {
                  const account = availableAccounts.find((a: any) => a.id === id);
                  return (
                    <View key={id} style={[styles.memberSelectRow, { justifyContent: 'space-between' }]}>
                      <View style={[styles.smallBadge, account?.role === 'staff' ? styles.smallBadgeStaff : styles.smallBadgeUser]}>
                        <Text style={styles.smallBadgeText}>{account?.role === 'staff' ? 'スタッフ' : '利用者'}</Text>
                      </View>
                      <Text style={{ flex: 1, fontSize: 16, color: COLORS.text, marginLeft: 8 }}>{account?.name || id}</Text>
                      <TouchableOpacity onPress={() => handleRemoveMember(id)} style={{ padding: 8 }}>
                        <Ionicons name="remove-circle-outline" size={26} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
                {managingParticipants.filter(id => id !== ADMIN_ID).length === 0 && (
                  <Text style={styles.emptyText}>メンバーがいません</Text>
                )}

                <Text style={[styles.modalSubLabel, { marginTop: 24 }]}>メンバーを追加</Text>

                {/* 検索バー */}
                <View style={[styles.searchBarGroup, { marginBottom: 8 }]}>
                  <Ionicons name="search" size={16} color="#aaa" style={{ marginRight: 6 }} />
                  <TextInput
                    style={{ flex: 1, fontSize: 14, color: '#333' }}
                    placeholder="名前・ニックネームで検索"
                    placeholderTextColor="#bbb"
                    value={memberMgmtSearch}
                    onChangeText={setMemberMgmtSearch}
                  />
                  {memberMgmtSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setMemberMgmtSearch('')}>
                      <Ionicons name="close-circle" size={16} color="#bbb" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* 学校・学年フィルター */}
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {['', ...Array.from(new Set(availableAccounts.filter((a: any) => a.role !== 'admin').map((a: any) => a.school).filter(Boolean)))].map((s: string) => (
                      <TouchableOpacity
                        key={s}
                        style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1.5, borderColor: memberMgmtSchool === s ? COLORS.primary : '#DDD', backgroundColor: memberMgmtSchool === s ? COLORS.primary + '22' : '#fff', marginRight: 6 }}
                        onPress={() => setMemberMgmtSchool(s)}
                      >
                        <Text style={{ fontSize: 12, color: memberMgmtSchool === s ? COLORS.primary : '#666', fontWeight: 'bold' }}>{s || '全学校'}</Text>
                      </TouchableOpacity>
                    ))}
                    {['', ...Array.from(new Set(availableAccounts.filter((a: any) => a.role !== 'admin').map((a: any) => a.grade).filter(Boolean)))].map((g: string) => (
                      <TouchableOpacity
                        key={`g_${g}`}
                        style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1.5, borderColor: memberMgmtGrade === g ? '#5B9BD5' : '#DDD', backgroundColor: memberMgmtGrade === g ? '#5B9BD522' : '#fff', marginRight: 6 }}
                        onPress={() => setMemberMgmtGrade(g)}
                      >
                        <Text style={{ fontSize: 12, color: memberMgmtGrade === g ? '#5B9BD5' : '#666', fontWeight: 'bold' }}>{g || '全学年'}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                {availableAccounts
                  .filter((a: any) => {
                    if (a.role === 'admin') return false;
                    if (managingParticipants.includes(a.id)) return false;
                    if (memberMgmtSearch && !a.name?.includes(memberMgmtSearch) && !a.nicknameKana?.includes(memberMgmtSearch)) return false;
                    if (memberMgmtSchool && a.school !== memberMgmtSchool) return false;
                    if (memberMgmtGrade && a.grade !== memberMgmtGrade) return false;
                    return true;
                  })
                  .map((account: any) => (
                    <TouchableOpacity
                      key={account.id}
                      style={styles.memberSelectRow}
                      onPress={() => handleAddMemberToGroup(account.id)}
                    >
                      <View style={[styles.smallBadge, account.role === 'staff' ? styles.smallBadgeStaff : styles.smallBadgeUser]}>
                        <Text style={styles.smallBadgeText}>{account.role === 'staff' ? 'スタッフ' : '利用者'}</Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={{ fontSize: 15, color: COLORS.text }}>{account.name}</Text>
                        {(account.school || account.grade) && (
                          <Text style={{ fontSize: 11, color: '#aaa' }}>{account.school}　{account.grade}</Text>
                        )}
                      </View>
                      <Ionicons name="add-circle-outline" size={26} color={COLORS.primary} />
                    </TouchableOpacity>
                  ))}
              </ScrollView>
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
        {isAdmin && activeConv?.type === 'direct' && (
          <TouchableOpacity
            style={styles.callHeaderBtn}
            onPress={() => {
              const otherId = (activeConv?.participants || []).find((id: string) => id !== ADMIN_ID);
              if (otherId) {
                const acc = availableAccounts?.find((a: any) => a.id === otherId);
                router.push({ pathname: '/schedule', params: { name: acc?.name || activeConv?.name || '' } } as any);
              }
            }}
          >
            <Ionicons name="calendar-outline" size={20} color="#5D4037" />
          </TouchableOpacity>
        )}
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
                      ? <TouchableOpacity onPress={() => setPreviewImageUrl(item.imageUrl!)} activeOpacity={0.85}><Image source={{ uri: item.imageUrl }} style={styles.bubbleImage} resizeMode="cover" /></TouchableOpacity>
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
              placeholder="メッセージ..." placeholderTextColor="#BBBBBB"
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
    {/* 画像プレビューモーダル */}
    <Modal visible={!!previewImageUrl} transparent animationType="fade">
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }}>
        <TouchableOpacity
          style={{ position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 10 }}
          onPress={() => setPreviewImageUrl(null)}
        >
          <Ionicons name="close-circle" size={36} color="#fff" />
        </TouchableOpacity>
        {previewImageUrl && (
          <Image
            source={{ uri: previewImageUrl }}
            style={{ width: '95%', height: '70%' }}
            resizeMode="contain"
          />
        )}
        <TouchableOpacity
          style={{ marginTop: 24, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 30 }}
          onPress={async () => {
            if (!previewImageUrl) return;
            try {
              const { status } = await MediaLibrary.requestPermissionsAsync();
              if (status !== 'granted') {
                Alert.alert('権限エラー', '写真の保存には権限が必要です');
                return;
              }
              await MediaLibrary.saveToLibraryAsync(previewImageUrl);
              Alert.alert('保存完了', '写真を保存しました');
            } catch (e) {
              Alert.alert('エラー', '保存に失敗しました');
            }
          }}
        >
          <Ionicons name="download-outline" size={22} color="#fff" style={{ marginRight: 8 }} />
          <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>保存する</Text>
        </TouchableOpacity>
      </View>
    </Modal>
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