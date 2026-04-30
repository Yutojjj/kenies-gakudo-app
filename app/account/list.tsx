import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, deleteDoc, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../../constants/theme';
import { db } from '../../firebase';

export default function AccountManagementScreen() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState<'all' | 'user' | 'staff'>('all');
  const [selectedAccount, setSelectedAccount] = useState<any | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'accounts'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAccounts(data); setLoading(false);
    }, (error) => {
      console.error(error); Alert.alert('エラー', 'データの取得に失敗しました。'); setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleDelete = (id: string) => {
    Alert.alert('削除確認', 'このアカウントを完全に削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => {
        try { await deleteDoc(doc(db, 'accounts', id)); setSelectedAccount(null); } 
        catch (error) { Alert.alert('エラー', '削除に失敗しました。'); }
      }}
    ]);
  };

  const handleEdit = (id: string) => { setSelectedAccount(null); router.push({ pathname: '/account/form', params: { id } }); };

  const filteredAccounts = accounts.filter(acc => filterRole === 'all' ? true : acc.role === filterRole);

  const getSkillsText = (skills: any) => {
    if (!skills) return 'なし';
    const activeSkills = [];
    if (skills.drive) activeSkills.push('運転');
    if (skills.program) activeSkills.push('プログラミング');
    if (skills.child) activeSkills.push('子供利用');
    return activeSkills.length > 0 ? activeSkills.join(', ') : 'なし';
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.filterContainer}>
        <TouchableOpacity style={[styles.filterBtn, filterRole === 'all' && styles.filterBtnActive]} onPress={() => setFilterRole('all')}><Text style={[styles.filterText, filterRole === 'all' && styles.filterTextActive]}>すべて</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.filterBtn, filterRole === 'user' && styles.filterBtnActive]} onPress={() => setFilterRole('user')}><Text style={[styles.filterText, filterRole === 'user' && styles.filterTextActive]}>利用者</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.filterBtn, filterRole === 'staff' && styles.filterBtnActive]} onPress={() => setFilterRole('staff')}><Text style={[styles.filterText, filterRole === 'staff' && styles.filterTextActive]}>スタッフ</Text></TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <FlatList
          data={filteredAccounts}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.accountCard, item.role === 'staff' ? styles.cardStaff : styles.cardUser]} onPress={() => setSelectedAccount(item)}>
              <View style={styles.cardHeader}>
                <View style={[styles.badge, item.role === 'staff' ? styles.badgeStaff : styles.badgeUser]}>
                  <Ionicons name={item.role === 'staff' ? "briefcase" : "school"} size={12} color={COLORS.white} style={{marginRight: 4}} />
                  <Text style={styles.badgeText}>{item.role === 'staff' ? 'スタッフ' : '利用者'}</Text>
                </View>
                <Text style={styles.accountName}>{item.name}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={<View style={styles.emptyContainer}><Ionicons name="folder-open-outline" size={48} color={COLORS.border} /><Text style={styles.emptyText}>該当するアカウントはありません。</Text></View>}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/account/form')}><Ionicons name="add" size={32} color={COLORS.white} /></TouchableOpacity>

      <Modal visible={!!selectedAccount} transparent={true} animationType="fade" onRequestClose={() => setSelectedAccount(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedAccount && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalHeader}>
                  <View style={[styles.badge, selectedAccount.role === 'staff' ? styles.badgeStaff : styles.badgeUser]}>
                    <Ionicons name={selectedAccount.role === 'staff' ? "briefcase" : "school"} size={12} color={COLORS.white} style={{marginRight: 4}} />
                    <Text style={styles.badgeText}>{selectedAccount.role === 'staff' ? 'スタッフ' : '利用者'}</Text>
                  </View>
                  <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setSelectedAccount(null)}><Ionicons name="close" size={28} color={COLORS.textLight} /></TouchableOpacity>
                </View>

                <Text style={styles.modalName}>{selectedAccount.name}</Text>
                {selectedAccount.nicknameKana && <Text style={styles.modalKana}>{selectedAccount.nicknameKana}</Text>}

                <View style={styles.authInfoBox}>
                  <View style={styles.authInfoRow}><Ionicons name="key-outline" size={16} color={COLORS.primary} style={styles.authIcon} /><Text style={styles.authLabel}>ID:</Text><Text style={styles.authValue}>{selectedAccount.generatedId}</Text></View>
                  <View style={styles.authInfoRow}><Ionicons name="lock-closed-outline" size={16} color={COLORS.primary} style={styles.authIcon} /><Text style={styles.authLabel}>PW:</Text><Text style={styles.authValue}>{selectedAccount.generatedPw}</Text></View>
                </View>

                <View style={styles.modalDetails}>
                  {selectedAccount.role === 'staff' ? (
                    <>
                      <View style={styles.detailRow}><Ionicons name="business-outline" size={16} color={COLORS.textLight} style={styles.detailIcon}/><Text style={styles.detailTitle}>雇用形態:</Text><Text style={styles.detailData}>{selectedAccount.empType}</Text></View>
                      <View style={styles.detailRow}><Ionicons name="options-outline" size={16} color={COLORS.textLight} style={styles.detailIcon}/><Text style={styles.detailTitle}>スキル:</Text><Text style={styles.detailData}>{getSkillsText(selectedAccount.skills)}</Text></View>
                      
                      {/* ★ スタッフの子供情報（複数対応） */}
                      {selectedAccount.hasChild && (selectedAccount.staffChildren || selectedAccount.childName) && (
                        <View style={styles.detailRow}>
                          <Ionicons name="people-outline" size={16} color={COLORS.textLight} style={styles.detailIcon}/>
                          <Text style={styles.detailTitle}>子供利用:</Text>
                          <View style={{ flex: 1 }}>
                            {selectedAccount.staffChildren && selectedAccount.staffChildren.length > 0 ? (
                              selectedAccount.staffChildren.map((c: any, i: number) => (
                                <Text key={i} style={styles.detailData}>{c.name} ({c.school} / {c.grade})</Text>
                              ))
                            ) : (
                              <Text style={styles.detailData}>{selectedAccount.childName} ({selectedAccount.childSchool} / {selectedAccount.childGrade})</Text>
                            )}
                          </View>
                        </View>
                      )}
                    </>
                  ) : (
                    <>
                      <View style={styles.detailRow}><Ionicons name="business-outline" size={16} color={COLORS.textLight} style={styles.detailIcon}/><Text style={styles.detailTitle}>学校:</Text><Text style={styles.detailData}>{selectedAccount.school || '未登録'}</Text></View>
                      <View style={styles.detailRow}><Ionicons name="book-outline" size={16} color={COLORS.textLight} style={styles.detailIcon}/><Text style={styles.detailTitle}>学年:</Text><Text style={styles.detailData}>{selectedAccount.grade || '未登録'}</Text></View>
                      <View style={styles.detailRow}><Ionicons name="calendar-outline" size={16} color={COLORS.textLight} style={styles.detailIcon}/><Text style={styles.detailTitle}>利用形態:</Text><Text style={styles.detailData}>{selectedAccount.usageType}</Text></View>
                      {selectedAccount.siblings && selectedAccount.siblings.length > 0 && (
                        <View style={styles.detailRow}><Ionicons name="people-outline" size={16} color={COLORS.textLight} style={styles.detailIcon}/><Text style={styles.detailTitle}>兄弟登録:</Text><Text style={styles.detailData}>{selectedAccount.siblings.length} 名</Text></View>
                      )}
                    </>
                  )}
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity style={[styles.modalBtn, styles.modalEditBtn]} onPress={() => handleEdit(selectedAccount.id)}>
                    <Ionicons name="pencil" size={18} color={COLORS.white} /><Text style={styles.modalBtnTextWhite}>編集する</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalBtn, styles.modalDeleteBtn]} onPress={() => handleDelete(selectedAccount.id)}>
                    <Ionicons name="trash" size={18} color={COLORS.danger} /><Text style={styles.modalBtnTextDanger}>削除する</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  filterContainer: { flexDirection: 'row', backgroundColor: COLORS.surface, padding: 12, borderBottomWidth: 1, borderColor: COLORS.border },
  filterBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  filterBtnActive: { backgroundColor: COLORS.primary },
  filterText: { fontSize: 14, fontWeight: 'bold', color: COLORS.textLight },
  filterTextActive: { color: COLORS.white },
  listContainer: { padding: 16, paddingBottom: 100 },
  accountCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: 12, padding: 20, marginBottom: 12, shadowColor: COLORS.primary, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2, borderWidth: 1 },
  cardStaff: { backgroundColor: '#FAFAFA', borderColor: '#EAEAEA' }, 
  cardUser: { backgroundColor: '#FFFDF5', borderColor: '#F3E5AB' }, 
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, marginRight: 12 },
  badgeStaff: { backgroundColor: COLORS.secondary },
  badgeUser: { backgroundColor: COLORS.primary },
  badgeText: { color: COLORS.white, fontSize: 12, fontWeight: 'bold' },
  accountName: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  fab: { position: 'absolute', right: 24, bottom: 40, backgroundColor: COLORS.primary, width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.primary, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6 },
  emptyContainer: { alignItems: 'center', marginTop: 100 },
  emptyText: { color: COLORS.textLight, fontSize: 16, marginTop: 12, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxHeight: '85%', backgroundColor: COLORS.white, borderRadius: 20, padding: 24, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 15, elevation: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalCloseBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center' },
  modalName: { fontSize: 24, fontWeight: 'bold', color: COLORS.text },
  modalKana: { fontSize: 14, color: COLORS.textLight, marginBottom: 16, fontWeight: 'bold' },
  authInfoBox: { backgroundColor: COLORS.surface, padding: 16, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: COLORS.border },
  authInfoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  authIcon: { marginRight: 8 },
  authLabel: { width: 36, fontSize: 14, fontWeight: 'bold', color: COLORS.textLight },
  authValue: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  modalDetails: { marginBottom: 24 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderColor: '#F0F0F0' },
  detailIcon: { marginRight: 8, marginTop: 2 },
  detailTitle: { width: 80, fontSize: 14, color: COLORS.textLight, fontWeight: 'bold', marginTop: 2 },
  detailData: { flex: 1, fontSize: 16, color: COLORS.text, fontWeight: 'bold', marginBottom: 4 },
  modalActions: { gap: 12 },
  modalBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12 },
  modalEditBtn: { backgroundColor: COLORS.primary },
  modalBtnTextWhite: { color: COLORS.white, fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
  modalDeleteBtn: { backgroundColor: '#FFF0F0', borderWidth: 1, borderColor: '#FFE0E0' },
  modalBtnTextDanger: { color: COLORS.danger, fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
});