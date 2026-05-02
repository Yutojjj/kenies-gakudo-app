import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

// --- Web/Native 共通の安全なアラート関数 ---
const customAlert = (title: string, message?: string) => {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
};

type ChildInfo = { id: string; name: string; };
type EventData = { id: string; dateStr: string; title: string; description: string; };

const getLocalDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function EventListScreen() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name: string }>();

  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<ChildInfo[]>([]);
  const [events, setEvents] = useState<EventData[]>([]);
  
  // participants[eventId][childId] = '参加' | '不参加'
  const [participants, setParticipants] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const targetName = name || '';
        const q = query(collection(db, 'accounts'), where('name', '==', targetName));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
          const docSnap = snapshot.docs[0];
          const data = docSnap.data();
          const parentId = docSnap.id;
          
          const loadedChildren: ChildInfo[] = [];
          
          if (data.role === 'staff' && data.hasChild) {
            if (data.staffChildren && data.staffChildren.length > 0) {
              data.staffChildren.forEach((child: any, idx: number) => {
                loadedChildren.push({ id: `${parentId}_child_${idx}`, name: child.name });
              });
            } else if (data.childName) {
              loadedChildren.push({ id: `${parentId}_child`, name: data.childName });
            }
          } else if (data.role === 'user') {
            loadedChildren.push({ id: parentId, name: data.name });
            if (data.siblings && Array.isArray(data.siblings)) {
              data.siblings.forEach((sib: any, idx: number) => {
                loadedChildren.push({ id: `${parentId}_sib_${idx}`, name: sib.name });
              });
            }
          }
          setChildren(loadedChildren);
        }

        const unsubEvents = onSnapshot(collection(db, 'events'), (snap) => {
          const evList: EventData[] = [];
          const todayStr = getLocalDateString(new Date());

          snap.forEach(d => {
            const evData = d.data() as EventData;
            // 今日以降のイベントのみリストに追加
            if (evData.dateStr >= todayStr) {
              evList.push(evData);
            }
          });
          evList.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
          setEvents(evList);
        });

        const unsubParts = onSnapshot(collection(db, 'event_participants'), (snap) => {
          const pData: Record<string, Record<string, string>> = {};
          snap.forEach(d => {
            const item = d.data();
            if (!pData[item.eventId]) pData[item.eventId] = {};
            pData[item.eventId][item.childId] = item.status;
          });
          setParticipants(pData);
          setLoading(false);
        });

        return () => {
          unsubEvents();
          unsubParts();
        };

      } catch (error) {
        console.error("データ取得エラー:", error);
        setLoading(false);
      }
    };
    fetchData();
  }, [name]);

  const toggleParticipation = async (eventId: string, childId: string, childName: string, status: string) => {
    try {
      const docId = `${eventId}_${childId}`;
      await setDoc(doc(db, 'event_participants', docId), {
        eventId,
        childId,
        childName,
        status,
        updatedAt: new Date()
      }, { merge: true });
    } catch (e) {
      customAlert('エラー', '保存に失敗しました');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>イベント参加登録</Text>
      </View>

      <ScrollView style={styles.scrollArea}>
        <Text style={styles.instruction}>参加するイベントを選択してください</Text>

        {events.length === 0 ? (
          <Text style={styles.noEventText}>現在、予定されているイベントはありません。</Text>
        ) : (
          events.map(ev => (
            <View key={ev.id} style={styles.eventCard}>
              <View style={styles.eventHeader}>
                <View style={styles.dateBadge}>
                  <Text style={styles.dateText}>{ev.dateStr}</Text>
                </View>
                <Text style={styles.eventTitle}>{ev.title}</Text>
              </View>
              
              {ev.description ? (
                <Text style={styles.eventDesc}>{ev.description}</Text>
              ) : null}

              <View style={styles.participantSection}>
                {children.map(child => {
                  const currentStatus = participants[ev.id]?.[child.id];
                  
                  return (
                    <View key={child.id} style={styles.childRow}>
                      <Text style={styles.childName}>
                        <Ionicons name="person" size={14} color={COLORS.textLight} /> {child.name}
                      </Text>
                      
                      <View style={styles.actionBtns}>
                        <TouchableOpacity 
                          style={[styles.statusBtn, currentStatus === '参加' && styles.statusBtnActiveY]}
                          onPress={() => toggleParticipation(ev.id, child.id, child.name, '参加')}
                        >
                          <Text style={[styles.statusBtnText, currentStatus === '参加' && styles.statusBtnTextActiveY]}>
                            参加する
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                          style={[styles.statusBtn, currentStatus === '不参加' && styles.statusBtnActiveN]}
                          onPress={() => toggleParticipation(ev.id, child.id, child.name, '不参加')}
                        >
                          <Text style={[styles.statusBtnText, currentStatus === '不参加' && styles.statusBtnTextActiveN]}>
                            欠席する
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, backgroundColor: COLORS.white, borderBottomWidth: 1, borderColor: COLORS.border },
  backBtn: { marginRight: 16 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  scrollArea: { flex: 1, padding: 16 },
  instruction: { fontSize: 14, color: COLORS.textLight, marginBottom: 16, fontWeight: 'bold', textAlign: 'center' },
  noEventText: { textAlign: 'center', color: COLORS.textLight, marginTop: 40 },
  eventCard: { backgroundColor: COLORS.white, borderRadius: 16, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 3, borderWidth: 1, borderColor: COLORS.border },
  eventHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  dateBadge: { backgroundColor: COLORS.primary + '20', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginRight: 12 },
  dateText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 14 },
  eventTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text, flex: 1 },
  eventDesc: { fontSize: 14, color: COLORS.textLight, lineHeight: 20, marginBottom: 16, backgroundColor: '#F9F9F9', padding: 12, borderRadius: 8 },
  participantSection: { borderTopWidth: 1, borderColor: COLORS.border, paddingTop: 16 },
  childRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  childName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, flex: 1 },
  actionBtns: { flexDirection: 'row', gap: 8 },
  statusBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white },
  statusBtnActiveY: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  statusBtnActiveN: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
  statusBtnText: { fontSize: 14, fontWeight: 'bold', color: COLORS.textLight },
  statusBtnTextActiveY: { color: COLORS.white },
  statusBtnTextActiveN: { color: COLORS.white }
});