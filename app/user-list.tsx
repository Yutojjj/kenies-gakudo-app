import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, getDocs, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

// 学校カード用の薄い背景色リスト
const BG_COLORS = ['#FFE4E1', '#E0FFFF', '#E6E6FA', '#FFFACD', '#F0FFF0', '#F5FFFA', '#FFE4B5', '#F0F8FF'];

export default function UserListScreen() {
  const router = useRouter();
  const [groupedUsers, setGroupedUsers] = useState<Record<string, any[]>>({});
  const [schools, setSchools] = useState<string[]>([]);
  const [activeSchool, setActiveSchool] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const q = query(collection(db, 'accounts'), where('role', '==', 'user'));
        const snapshot = await getDocs(q);
        const users: any[] = [];
        snapshot.forEach(doc => {
          users.push({ id: doc.id, ...doc.data() });
        });

        const grouped: Record<string, any[]> = {};
        users.forEach(u => {
          const schoolName = u.school || '未設定の学校';
          if (!grouped[schoolName]) grouped[schoolName] = [];
          grouped[schoolName].push(u);
        });

        setGroupedUsers(grouped);
        setSchools(Object.keys(grouped));
      } catch (error) {
        console.error(error);
      } finally {
      }
    };
    fetchUsers();
  }, []);


  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>学校別利用者</Text>
      </View>

      <ScrollView style={styles.scrollArea}>
        <Text style={styles.instruction}>確認したい学校をタップしてください</Text>
        
        {/* 4列のカードグリッド */}
        <View style={styles.gridContainer}>
          {schools.map((school, index) => {
            const isActive = activeSchool === school;
            const bgColor = BG_COLORS[index % BG_COLORS.length];
            return (
              <TouchableOpacity 
                key={school} 
                style={[styles.schoolCard, { backgroundColor: bgColor }, isActive && styles.schoolCardActive]} 
                onPress={() => setActiveSchool(isActive ? null : school)}
              >
                <Ionicons name="school" size={32} color={COLORS.primary} style={{ opacity: 0.8, marginBottom: 8 }} />
                <Text style={styles.schoolCardName} numberOfLines={2}>{school}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 選択された学校の生徒リスト */}
        {activeSchool && (
          <View style={styles.listSection}>
            <Text style={styles.listSectionTitle}>【{activeSchool}】の利用者</Text>
            {groupedUsers[activeSchool].map((user, idx) => (
              <TouchableOpacity 
                key={user.id} 
                style={[styles.userListItem, idx === groupedUsers[activeSchool].length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => router.push({ pathname: '/schedule', params: { name: user.name } } as any)}
              >
                <View style={styles.userIconCircle}>
                  <Ionicons name="person" size={20} color={COLORS.primary} />
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.userName}>{user.name} <Text style={styles.userGrade}>({user.grade || '学年未定'})</Text></Text>
                  <Text style={styles.userKana}>{user.nicknameKana || ''}</Text>
                </View>
                <View style={styles.editBadge}>
                  <Ionicons name="calendar-outline" size={14} color={COLORS.white} />
                  <Text style={styles.editBadgeText}>編集</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
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
  scrollArea: { flex: 1 },
  instruction: { padding: 16, color: COLORS.textLight, fontWeight: 'bold', textAlign: 'center' },
  
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, paddingBottom: 20 },
  schoolCard: { width: '23%', aspectRatio: 0.9, margin: '1%', borderRadius: 12, padding: 8, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, elevation: 2, borderWidth: 2, borderColor: 'transparent' },
  schoolCardActive: { borderColor: COLORS.primary },
  schoolCardName: { fontSize: 11, fontWeight: 'bold', color: COLORS.text, textAlign: 'center' },

  listSection: { backgroundColor: COLORS.white, borderTopWidth: 1, borderColor: COLORS.border, padding: 16, minHeight: 400 },
  listSectionTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.primary, marginBottom: 16, textAlign: 'center' },
  userListItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: COLORS.border },
  userIconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0F8FF', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  userGrade: { fontSize: 14, color: COLORS.textLight, fontWeight: 'normal' },
  userKana: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  editBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  editBadgeText: { color: COLORS.white, fontSize: 12, fontWeight: 'bold', marginLeft: 4 }
});