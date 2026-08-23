import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, doc, getDoc, onSnapshot, orderBy, query, setDoc, Timestamp, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AdminBottomNav from '../components/AdminBottomNav';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { useRequireRole } from '../hooks/useRequireRole';
import { navigateHome } from '../utils/navigationHome';

type ChangeLog = {
  id: string;
  date: string;
  userId: string;
  userName: string;
  childName: string;
  description: string;
  changedAt: Timestamp | null;
};

const fmt = (dateStr: string) => {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const fmtTime = (ts: Timestamp | null) => {
  if (!ts?.toDate) return '';
  const d = ts.toDate();
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function ScheduleChangesScreen() {
  const { verified, checking, userInfo } = useRequireRole(['admin', 'staff', 'user']);

  const router = useRouter();
  const [logs, setLogs] = useState<ChangeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [changeNotificationsEnabled, setChangeNotificationsEnabled] = useState(true);
  const [notificationSettingSaving, setNotificationSettingSaving] = useState(false);

  useEffect(() => {
    if (userInfo?.role !== 'admin') return;
    getDoc(doc(db, 'settings', 'schedule_change_notifications')).then(snapshot => {
      if (snapshot.exists()) setChangeNotificationsEnabled(snapshot.data().enabled !== false);
    }).catch(() => {});
  }, [userInfo?.role]);

  const toggleChangeNotifications = async () => {
    if (userInfo?.role !== 'admin' || notificationSettingSaving) return;
    const next = !changeNotificationsEnabled;
    setChangeNotificationsEnabled(next);
    setNotificationSettingSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'schedule_change_notifications'), {
        enabled: next,
        updatedAt: new Date(),
        updatedBy: userInfo.name,
      }, { merge: true });
    } catch {
      setChangeNotificationsEnabled(!next);
    } finally {
      setNotificationSettingSaving(false);
    }
  };

  useEffect(() => {
    // 今日を含む過去7日分を取得
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const fromDateStr = `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(sevenDaysAgo.getDate()).padStart(2, '0')}`;

    const q = query(
      collection(db, 'scheduleChanges'),
      where('date', '>=', fromDateStr),
      orderBy('date', 'desc'),
    );

    const unsub = onSnapshot(q,
      snap => {
        const items: ChangeLog[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChangeLog));
        // 同一日内はchangedAt降順で並べる
        items.sort((a, b) => {
          if (a.date !== b.date) return b.date.localeCompare(a.date);
          return (b.changedAt?.seconds || 0) - (a.changedAt?.seconds || 0);
        });
        setLogs(items);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  // date でグルーピング
  const grouped = logs.reduce<Record<string, ChangeLog[]>>((acc, log) => {
    if (!acc[log.date]) acc[log.date] = [];
    acc[log.date].push(log);
    return acc;
  }, {});
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  if (checking || !verified) return null;
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigateHome(router)} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>スケジュール変更履歴</Text>
        {userInfo?.role === 'admin' ? (
          <TouchableOpacity
            style={[styles.notificationToggle, changeNotificationsEnabled && styles.notificationToggleOn]}
            onPress={toggleChangeNotifications}
            disabled={notificationSettingSaving}
          >
            <Ionicons
              name={changeNotificationsEnabled ? 'notifications-outline' : 'notifications-off-outline'}
              size={16}
              color={changeNotificationsEnabled ? '#087D84' : '#8D8580'}
            />
            <Text style={[styles.notificationToggleText, changeNotificationsEnabled && styles.notificationToggleTextOn]}>
              変更通知 {changeNotificationsEnabled ? 'オン' : 'オフ'}
            </Text>
          </TouchableOpacity>
        ) : <Text style={styles.headerSub}>直近7日間</Text>}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : logs.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="checkmark-circle-outline" size={56} color={COLORS.border} />
          <Text style={styles.emptyText}>この7日間に変更はありません</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {sortedDates.map(dateStr => (
            <View key={dateStr} style={styles.group}>
              {/* 日付ヘッダー */}
              <View style={styles.dateHeader}>
                <View style={styles.dateDot} />
                <Text style={styles.dateText}>{fmt(dateStr)}</Text>
                <Text style={styles.countText}>{grouped[dateStr].length}件</Text>
              </View>

              {/* 変更ログ一覧 */}
              {grouped[dateStr].map(log => (
                <View key={log.id} style={styles.logCard}>
                  <View style={styles.logRow}>
                    <View style={styles.userBadge}>
                      <Text style={styles.userBadgeText}>{log.userName?.[0] || '?'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.logUser}>
                        {log.userName}
                        {log.childName && log.childName !== log.userName
                          ? <Text style={styles.logChild}>（{log.childName}）</Text>
                          : null}
                      </Text>
                      <Text style={styles.logDesc}>{log.description}</Text>
                    </View>
                    <Text style={styles.logTime}>{fmtTime(log.changedAt)}</Text>
                  </View>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
      <AdminBottomNav active="attendance" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#FFF8F0',
    borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
  },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  headerSub: { fontSize: 12, color: '#5D4037', opacity: 0.7 },
  notificationToggle: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D8D0CB',
    backgroundColor: '#F2EFED',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  notificationToggleOn: { borderColor: '#9EDADD', backgroundColor: '#EFF9FA' },
  notificationToggleText: { color: '#8D8580', fontSize: 11, fontWeight: '800' },
  notificationToggleTextOn: { color: '#087D84' },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyText: { color: COLORS.textLight, fontSize: 15, marginTop: 16 },

  group: { marginBottom: 24 },

  dateHeader: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 10,
  },
  dateDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: COLORS.primary, marginRight: 10,
  },
  dateText: { fontSize: 17, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  countText: { fontSize: 12, color: COLORS.textLight },

  logCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
    borderLeftWidth: 3, borderLeftColor: COLORS.primary,
  },
  logRow: { flexDirection: 'row', alignItems: 'flex-start' },
  userBadge: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 10,
  },
  userBadgeText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  logUser: { fontSize: 14, fontWeight: 'bold', color: '#333', marginBottom: 2 },
  logChild: { fontSize: 12, color: COLORS.textLight, fontWeight: 'normal' },
  logDesc: { fontSize: 13, color: '#555' },
  logTime: { fontSize: 11, color: COLORS.textLight, marginLeft: 8, marginTop: 2 },
});
