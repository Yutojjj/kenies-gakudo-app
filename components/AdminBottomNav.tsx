import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { collection, onSnapshot } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { db } from '../firebase';

type AdminBottomNavActive = 'home' | 'attendance' | 'schedule' | 'event' | 'messages' | 'shift' | 'menu' | 'album';

type Props = {
  active?: AdminBottomNavActive;
};

export const ADMIN_BOTTOM_NAV_HEIGHT = Platform.OS === 'ios' ? 90 : 76;

export default function AdminBottomNav({ active = 'home' }: Props) {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [isUser, setIsUser] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    (async () => {
      const raw = await AsyncStorage.getItem('loggedInUser');
      if (!raw) return;
      let user: any = {};
      try { user = JSON.parse(raw); } catch { return; }
      if (user.role !== 'admin' && user.role !== 'staff' && user.role !== 'user') return;
      setIsAdmin(user.role === 'admin');
      setIsStaff(user.role === 'staff');
      setIsUser(user.role === 'user');
      setAdminName(user.name || '');
      const accountId = user.accountId || (user.role === 'admin' ? 'admin' : '');
      unsub = onSnapshot(collection(db, 'conversations'), snap => {
        const count = snap.docs.filter(d => (d.data().unreadFor || []).includes(accountId)).length;
        setUnreadCount(count);
      });
    })();
    return () => { unsub?.(); };
  }, []);

  if (!isAdmin && !isStaff && !isUser) return null;

  const goHome = () => {
    router.push({ pathname: '/menu', params: { role: isAdmin ? 'admin' : isStaff ? 'staff' : 'user', name: adminName || (isAdmin ? 'admin' : '') } } as any);
  };

  const itemColor = (key: AdminBottomNavActive) => active === key ? '#00AEB8' : '#766B64';

  return (
    <>
      <View style={styles.navSpacer} />
      <View style={styles.nav}>
        <TouchableOpacity style={styles.item} onPress={goHome} activeOpacity={0.78}>
          <Ionicons name={active === 'home' ? 'home' : 'home-outline'} size={21} color={itemColor('home')} />
          <Text style={[styles.text, { color: itemColor('home') }]}>ホーム</Text>
        </TouchableOpacity>
        {isUser && (
          <TouchableOpacity style={styles.item} onPress={() => router.push({ pathname: '/schedule', params: { name: adminName || '' } } as any)} activeOpacity={0.78}>
            <Ionicons name={active === 'schedule' ? 'calendar' : 'calendar-outline'} size={21} color={itemColor('schedule')} />
            <Text style={[styles.text, { color: itemColor('schedule') }]}>スケジュール</Text>
          </TouchableOpacity>
        )}
        {(isAdmin || isStaff) && (
          <TouchableOpacity style={styles.item} onPress={() => router.push('/attendance')} activeOpacity={0.78}>
            <Ionicons name={active === 'attendance' ? 'people' : 'people-outline'} size={21} color={itemColor('attendance')} />
            <Text style={[styles.text, { color: itemColor('attendance') }]}>出欠一覧</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.item} onPress={() => router.push(isUser ? ({ pathname: '/event-list', params: { name: adminName || '' } } as any) : ({ pathname: '/year-events', params: { role: isAdmin ? 'admin' : 'staff', tab: 'management' } } as any))} activeOpacity={0.78}>
          <Ionicons name={active === 'event' ? 'flag' : 'flag-outline'} size={21} color={itemColor('event')} />
          <Text style={[styles.text, { color: itemColor('event') }]}>イベント</Text>
        </TouchableOpacity>
        {isUser && (
          <TouchableOpacity style={styles.item} onPress={() => router.push({ pathname: '/album', params: { role: 'user', name: adminName || '' } } as any)} activeOpacity={0.78}>
            <Ionicons name={active === 'album' ? 'image' : 'image-outline'} size={21} color={itemColor('album')} />
            <Text style={[styles.text, { color: itemColor('album') }]}>アルバム</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.item} onPress={() => router.push({ pathname: '/messages', params: { tab: 'talk' } } as any)} activeOpacity={0.78}>
          <Ionicons name={active === 'messages' ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'} size={21} color={itemColor('messages')} />
          <Text style={[styles.text, { color: itemColor('messages') }]}>メッセージ</Text>
          {unreadCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text></View>}
        </TouchableOpacity>
        {!isUser && (
          <TouchableOpacity style={styles.item} onPress={() => router.push({ pathname: '/shift-view', params: { name: adminName || '' } } as any)} activeOpacity={0.78}>
            <Ionicons name={active === 'shift' ? 'calendar' : 'calendar-outline'} size={21} color={itemColor('shift')} />
            <Text style={[styles.text, { color: itemColor('shift') }]}>シフト</Text>
          </TouchableOpacity>
        )}
        {isAdmin ? (
          <TouchableOpacity style={styles.item} onPress={() => router.push('/admin-more' as any)} activeOpacity={0.78}>
            <Ionicons name={active === 'menu' ? 'grid' : 'grid-outline'} size={21} color={itemColor('menu')} />
            <Text style={[styles.text, { color: itemColor('menu') }]}>その他</Text>
          </TouchableOpacity>
        ) : !isUser ? (
          <TouchableOpacity style={styles.item} onPress={() => router.push({ pathname: '/album', params: { role: 'staff', name: adminName || '' } } as any)} activeOpacity={0.78}>
            <Ionicons name={active === 'album' ? 'image' : 'image-outline'} size={21} color={itemColor('album')} />
            <Text style={[styles.text, { color: itemColor('album') }]}>アルバム</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  navSpacer: {
    height: ADMIN_BOTTOM_NAV_HEIGHT,
  },
  nav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 72,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 18 : 10,
    paddingHorizontal: 4,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderTopWidth: 1,
    borderTopColor: '#EADBC6',
    flexDirection: 'row',
    shadowColor: '#8B7340',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.11,
    shadowRadius: 8,
    elevation: 12,
    zIndex: 100,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    position: 'relative',
  },
  text: {
    fontSize: 9,
    fontWeight: '800',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: 11,
    backgroundColor: '#E53935',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
});
