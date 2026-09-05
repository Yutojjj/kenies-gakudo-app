import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, deleteDoc, doc, getDoc, onSnapshot, query, updateDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AdminBottomNav, { ADMIN_BOTTOM_NAV_HEIGHT } from '../../components/AdminBottomNav';
import { COLORS } from '../../constants/theme';
import { useCall } from '../../contexts/CallContext';
import { db } from '../../firebase';
import { useRequireRole } from '../../hooks/useRequireRole';
import { navigateHome } from '../../utils/navigationHome';

export default function AccountManagementScreen() {
  const { verified, checking } = useRequireRole('admin');

  const router = useRouter();
  const { startCall } = useCall(); 
  
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  // 基本フィルター
  const [filterRole, setFilterRole] = useState<'all' | 'user' | 'staff'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [schoolFilterOpen, setSchoolFilterOpen] = useState(false);
  
  // 詳細絞り込み用ステート
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [selectedSchools, setSelectedSchools] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [selectedUsageTypes, setSelectedUsageTypes] = useState<string[]>([]);
  
  // 詳細絞り込み用マスターデータ
  const [masterSchools, setMasterSchools] = useState<string[]>([]);
  const [masterGrades, setMasterGrades] = useState<string[]>([]);
  const USAGE_TYPES = ['定期利用', '回数券', '不定期'];

  const [selectedAccount, setSelectedAccount] = useState<any | null>(null);

  useEffect(() => {
    let isMounted = true;

    // アカウント一覧の取得
    const q = query(collection(db, 'accounts'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a: any, b: any) => {
          const aTime = a.createdAt?.seconds ?? 0;
          const bTime = b.createdAt?.seconds ?? 0;
          return bTime - aTime;
        });
      if(isMounted) setAccounts(data);
    }, (error) => {
      console.error(error); Alert.alert('エラー', 'データの取得に失敗しました。'); setLoading(false);
    });

    // 学校・学年のマスターデータ取得
    const fetchMasterData = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          const masterRef = doc(db, 'settings', 'master_data');
          const masterSnap = await getDoc(masterRef);
          if (masterSnap.exists() && isMounted) {
            const data = masterSnap.data();
            if (data.schools) setMasterSchools(data.schools);
            if (data.grades) setMasterGrades(data.grades);
          }
          return; 
        } catch (error: any) {
          if (error.code === 'unavailable' || error.message.includes('offline')) {
              console.warn(`Master data fetch error: offline. Retrying... (${i + 1}/${retries})`);
              await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
             console.error("Master data fetch error:", error);
             break;
          }
        }
      }
    };
    
    fetchMasterData();

    return () => {
        isMounted = false;
        unsubscribe();
    };
  }, []);

  const handleDelete = (id: string) => {
    if (Platform.OS === 'web') {
      if (window.confirm('このアカウントを完全に削除しますか？')) {
        deleteDoc(doc(db, 'accounts', id))
          .then(() => setSelectedAccount(null))
          .catch(() => window.alert('削除に失敗しました。'));
      }
      return;
    }
    Alert.alert('削除確認', 'このアカウントを完全に削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => {
        try { await deleteDoc(doc(db, 'accounts', id)); setSelectedAccount(null); }
        catch (error) { Alert.alert('エラー', '削除に失敗しました。'); }
      }}
    ]);
  };

  const handleEdit = (id: string) => { setSelectedAccount(null); router.push({ pathname: '/account/form', params: { id } }); };

  const handleShiftVisibilityChange = async (account: any, value: boolean) => {
    const updated = { ...account, showInShiftTable: value };
    setSelectedAccount(updated);
    try {
      await updateDoc(doc(db, 'accounts', account.id), { showInShiftTable: value });
    } catch (error) {
      setSelectedAccount(account);
      Alert.alert('エラー', 'シフト表の表示設定を更新できませんでした。');
    }
  };

  const handleEventEditPermissionChange = async (account: any, value: boolean) => {
    const updated = { ...account, canEditEvents: value };
    setSelectedAccount(updated);
    try {
      await updateDoc(doc(db, 'accounts', account.id), { canEditEvents: value });
    } catch (error) {
      setSelectedAccount(account);
      Alert.alert('エラー', 'イベント編集権限を更新できませんでした。');
    }
  };

  const toggleFilterArray = (currentArray: string[], value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    if (currentArray.includes(value)) {
      setter(currentArray.filter(item => item !== value));
    } else {
      setter([...currentArray, value]);
    }
  };

  const clearFilters = () => {
    setSelectedSchools([]);
    setSelectedGrades([]);
    setSelectedUsageTypes([]);
  };

  // 表示するデータのフィルタリング
  const filteredAccounts = accounts.filter(acc => {
    if (filterRole !== 'all' && acc.role !== filterRole) return false;
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = acc.name?.toLowerCase().includes(q);
      const matchKana = acc.nicknameKana?.toLowerCase().includes(q);
      
      let matchSibling = false;
      if (acc.siblings && Array.isArray(acc.siblings)) {
        matchSibling = acc.siblings.some((sib: any) => 
          sib.name?.toLowerCase().includes(q) || sib.nicknameKana?.toLowerCase().includes(q)
        );
      }
      
      if (!matchName && !matchKana && !matchSibling) return false;
    }

    const hasDetailedFilters = selectedSchools.length > 0 || selectedGrades.length > 0 || selectedUsageTypes.length > 0;
    
    if (hasDetailedFilters) {
      if (acc.role === 'staff') return false;

      let isMatchMain = true;
      if (selectedSchools.length > 0 && !selectedSchools.includes(acc.school)) isMatchMain = false;
      if (selectedGrades.length > 0 && !selectedGrades.includes(acc.grade)) isMatchMain = false;
      if (selectedUsageTypes.length > 0 && !selectedUsageTypes.includes(acc.usageType)) isMatchMain = false;

      if (isMatchMain) return true;

      if (acc.siblings && Array.isArray(acc.siblings)) {
        const isMatchSibling = acc.siblings.some((sib: any) => {
          let sibMatch = true;
          if (selectedSchools.length > 0 && !selectedSchools.includes(sib.school)) sibMatch = false;
          if (selectedGrades.length > 0 && !selectedGrades.includes(sib.grade)) sibMatch = false;
          if (selectedUsageTypes.length > 0 && !selectedUsageTypes.includes(sib.usageType)) sibMatch = false;
          return sibMatch;
        });
        if (isMatchSibling) return true;
      }
      
      return false; 
    }

    return true;
  });

  const getSkillsText = (skills: any) => {
    if (!skills) return 'なし';
    const activeSkills = [];
    if (skills.drive) activeSkills.push('運転');
    if (skills.program) activeSkills.push('プログラミング');
    if (skills.child) activeSkills.push('子供利用');
    return activeSkills.length > 0 ? activeSkills.join(', ') : 'なし';
  };

  const activeFilterCount = selectedSchools.length + selectedGrades.length + selectedUsageTypes.length;

  if (checking || !verified) return null;
  return (
    <SafeAreaView style={styles.container}>
      {/* ── 色合いを豊かにしたヘッダー ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigateHome(router)}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>アカウント管理</Text>
        <TouchableOpacity
          style={styles.qrBtn}
          onPress={() => router.push('/account/qr-cards')}
        >
          <Ionicons name="qr-code" size={20} color="#5D4037" />
          <Text style={styles.qrBtnText}>QRカード</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterContainer}>
        <TouchableOpacity style={[styles.filterBtn, filterRole === 'all' && styles.filterBtnActive]} onPress={() => setFilterRole('all')}><Text style={[styles.filterText, filterRole === 'all' && styles.filterTextActive]}>すべて</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.filterBtn, filterRole === 'user' && styles.filterBtnActive]} onPress={() => setFilterRole('user')}><Text style={[styles.filterText, filterRole === 'user' && styles.filterTextActive]}>利用者</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.filterBtn, filterRole === 'staff' && styles.filterBtnActive]} onPress={() => setFilterRole('staff')}><Text style={[styles.filterText, filterRole === 'staff' && styles.filterTextActive]}>スタッフ</Text></TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={COLORS.textLight} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="名前やニックネームで検索" placeholderTextColor="#BBBBBB"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearchBtn}>
              <Ionicons name="close-circle" size={20} color={COLORS.textLight} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity 
          style={[styles.detailedFilterBtn, activeFilterCount > 0 && styles.detailedFilterBtnActive]} 
          onPress={() => setFilterModalVisible(true)}
        >
          <Ionicons name="filter" size={20} color={activeFilterCount > 0 ? COLORS.white : COLORS.primary} />
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{activeFilterCount}</Text></View>
          )}
        </TouchableOpacity>
      </View>

      {/* ⑪ 学校名クイックフィルター（利用者タブ時のみ・折りたたみ可能） */}
      {filterRole !== 'staff' && masterSchools.length > 0 && filterRole === 'user' && (
        <View style={{ backgroundColor: COLORS.surface, borderBottomWidth: 1, borderColor: COLORS.border }}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}
            onPress={() => setSchoolFilterOpen(v => !v)}
          >
            <Ionicons name={schoolFilterOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textLight} />
            <Text style={{ fontSize: 12, fontWeight: 'bold', color: COLORS.textLight }}>学校で絞り込む</Text>
            {selectedSchools.length > 0 && (
              <View style={{ backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>{selectedSchools.length}校選択中</Text>
              </View>
            )}
          </TouchableOpacity>
          {schoolFilterOpen && (
            <View style={styles.schoolQuickFilter}>
              {masterSchools.map(school => (
                <TouchableOpacity
                  key={school}
                  style={[styles.schoolQuickBtn, selectedSchools.includes(school) && styles.schoolQuickBtnActive]}
                  onPress={() => toggleFilterArray(selectedSchools, school, setSelectedSchools)}
                >
                  <Text style={[styles.schoolQuickText, selectedSchools.includes(school) && styles.schoolQuickTextActive]} numberOfLines={1}>{school}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

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
                      <View style={styles.shiftVisibilityRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.shiftVisibilityTitle}>シフト表に表示</Text>
                          <Text style={styles.shiftVisibilityDescription}>オフにすると画面とPDFから非表示</Text>
                        </View>
                        <Switch
                          value={selectedAccount.showInShiftTable !== false}
                          onValueChange={(value) => handleShiftVisibilityChange(selectedAccount, value)}
                          trackColor={{ false: '#D7DCDE', true: '#9AD9D3' }}
                          thumbColor={selectedAccount.showInShiftTable !== false ? '#158F87' : '#F5F5F5'}
                        />
                      </View>
                      <View style={styles.eventPermissionRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.shiftVisibilityTitle}>イベントを編集</Text>
                          <Text style={styles.shiftVisibilityDescription}>年行事・長期休み・イベント管理の編集を許可</Text>
                        </View>
                        <Switch
                          value={selectedAccount.canEditEvents === true}
                          onValueChange={(value) => handleEventEditPermissionChange(selectedAccount, value)}
                          trackColor={{ false: '#D7DCDE', true: '#9AD9D3' }}
                          thumbColor={selectedAccount.canEditEvents === true ? '#158F87' : '#F5F5F5'}
                        />
                      </View>
                      
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
                      <View style={styles.detailRow}>
                        <Ionicons name="calendar-outline" size={16} color={COLORS.textLight} style={styles.detailIcon}/>
                        <Text style={styles.detailTitle}>利用形態:</Text>
                        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                          <Text style={styles.detailData}>{selectedAccount.usageType}</Text>
                          {selectedAccount.usageType === '定期利用' && selectedAccount.days && (() => {
                            const activeDays = Object.entries(selectedAccount.days).filter(([_, v]) => v).map(([k]) => k);
                            const count = activeDays.length;
                            return count > 0 ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <Text style={{ fontSize: 13, color: COLORS.text }}>（{activeDays.join('・')}）</Text>
                                <View style={{ backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                                  <Text style={{ fontSize: 11, color: '#fff', fontWeight: 'bold' }}>週{count}回</Text>
                                </View>
                              </View>
                            ) : null;
                          })()}
                        </View>
                      </View>
                      {selectedAccount.siblings && selectedAccount.siblings.length > 0 && (
                        <View style={styles.detailRow}><Ionicons name="people-outline" size={16} color={COLORS.textLight} style={styles.detailIcon}/><Text style={styles.detailTitle}>兄弟登録:</Text><Text style={styles.detailData}>{selectedAccount.siblings.length} 名</Text></View>
                      )}
                    </>
                  )}
                </View>

                <View style={styles.modalActions}>
                  <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                    <TouchableOpacity 
                      style={[styles.modalBtn, { flex: 1, backgroundColor: '#4CAF50' }]} 
                      onPress={() => {
                        const id = selectedAccount.id;
                        const name = selectedAccount.name;
                        setSelectedAccount(null);
                        router.push({ pathname: '/messages', params: { conversationId: `direct_${id}`, conversationName: name } });
                      }}
                    >
                      <Ionicons name="chatbubble" size={18} color={COLORS.white} />
                      <Text style={styles.modalBtnTextWhite}>メッセージ</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.modalBtn, { flex: 1, backgroundColor: '#2196F3' }]} 
                      onPress={() => {
                        const id = selectedAccount.id;
                        const name = selectedAccount.name;
                        setSelectedAccount(null);
                        startCall(`direct_${id}`, name, false);
                      }}
                    >
                      <Ionicons name="call" size={18} color={COLORS.white} />
                      <Text style={styles.modalBtnTextWhite}>通話</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <TouchableOpacity style={[styles.modalBtn, styles.modalEditBtn, { flex: 1 }]} onPress={() => handleEdit(selectedAccount.id)}>
                      <Ionicons name="pencil" size={18} color={COLORS.white} /><Text style={styles.modalBtnTextWhite}>編集する</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.modalBtn, styles.modalDeleteBtn, { flex: 1 }]} onPress={() => handleDelete(selectedAccount.id)}>
                      <Ionicons name="trash" size={18} color={COLORS.danger} /><Text style={styles.modalBtnTextDanger}>削除する</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={filterModalVisible} transparent={true} animationType="slide">
        <View style={styles.filterModalOverlay}>
          <View style={styles.filterModalContent}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>詳細絞り込み</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)}>
                <Ionicons name="close" size={28} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              <Text style={styles.filterSectionTitle}>学校名 (複数選択可)</Text>
              <View style={styles.filterChipContainer}>
                {masterSchools.map(school => (
                  <TouchableOpacity 
                    key={school} 
                    style={[styles.filterChip, selectedSchools.includes(school) && styles.filterChipActive]}
                    onPress={() => toggleFilterArray(selectedSchools, school, setSelectedSchools)}
                  >
                    <Text style={[styles.filterChipText, selectedSchools.includes(school) && styles.filterChipTextActive]}>{school}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.filterSectionTitle}>学年 (複数選択可)</Text>
              <View style={styles.filterChipContainer}>
                {masterGrades.map(grade => (
                  <TouchableOpacity 
                    key={grade} 
                    style={[styles.filterChip, selectedGrades.includes(grade) && styles.filterChipActive]}
                    onPress={() => toggleFilterArray(selectedGrades, grade, setSelectedGrades)}
                  >
                    <Text style={[styles.filterChipText, selectedGrades.includes(grade) && styles.filterChipTextActive]}>{grade}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.filterSectionTitle}>利用形態 (複数選択可)</Text>
              <View style={styles.filterChipContainer}>
                {USAGE_TYPES.map(usage => (
                  <TouchableOpacity 
                    key={usage} 
                    style={[styles.filterChip, selectedUsageTypes.includes(usage) && styles.filterChipActive]}
                    onPress={() => toggleFilterArray(selectedUsageTypes, usage, setSelectedUsageTypes)}
                  >
                    <Text style={[styles.filterChipText, selectedUsageTypes.includes(usage) && styles.filterChipTextActive]}>{usage}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{height: 20}}/>
            </ScrollView>

            <View style={styles.filterModalFooter}>
              <TouchableOpacity style={styles.clearFilterBtn} onPress={clearFilters}>
                <Text style={styles.clearFilterText}>クリア</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyFilterBtn} onPress={() => setFilterModalVisible(false)}>
                <Text style={styles.applyFilterText}>絞り込む</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <AdminBottomNav active="menu" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  // ── 色合いを豊かにしたヘッダーのスタイル ──
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 16, 
    paddingVertical: 16, 
    backgroundColor: '#FFF8F0', // やさしいイエローベージュ
    borderBottomLeftRadius: 16, 
    borderBottomRightRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 10,
  },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 10, backgroundColor: 'rgba(255,255,255,0.6)' },
  qrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
    marginLeft: 8,
  },
  qrBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#5D4037',
  },
  headerTitle: { 
    fontSize: 20, 
    fontWeight: 'bold', 
    color: '#5D4037', // 視認性の良い茶色
    flex: 1 
  },
  // ────────────────────────────
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  filterContainer: { flexDirection: 'row', backgroundColor: COLORS.surface, padding: 12, borderBottomWidth: 1, borderColor: COLORS.border, marginTop: 4 },
  filterBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  filterBtnActive: { backgroundColor: COLORS.primary },
  filterText: { fontSize: 14, fontWeight: 'bold', color: COLORS.textLight },
  filterTextActive: { color: COLORS.white },
  
  searchRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 12 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: COLORS.text },
  clearSearchBtn: { padding: 4 },
  detailedFilterBtn: { width: 44, height: 44, backgroundColor: COLORS.white, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center' },
  detailedFilterBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterBadge: { position: 'absolute', top: -6, right: -6, backgroundColor: COLORS.danger, borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  filterBadgeText: { color: COLORS.white, fontSize: 10, fontWeight: 'bold' },

  schoolQuickFilter: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingVertical: 8, gap: 6, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderColor: COLORS.border },
  schoolQuickBtn: { width: '23%', paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, alignItems: 'center' },
  schoolQuickBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  schoolQuickText: { fontSize: 11, fontWeight: 'bold', color: COLORS.textLight },
  schoolQuickTextActive: { color: COLORS.white },
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
  fab: { position: 'absolute', right: 24, bottom: ADMIN_BOTTOM_NAV_HEIGHT + 14, backgroundColor: COLORS.primary, width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.primary, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6 },
  emptyContainer: { alignItems: 'center', marginTop: 100 },
  emptyText: { color: COLORS.textLight, fontSize: 16, marginTop: 12, fontWeight: 'bold' },
  
  modalOverlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'center', padding: 20 },
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
  shiftVisibilityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: '#F3FAF9', borderWidth: 1, borderColor: '#CFE1DF' },
  eventPermissionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#F2D6B8' },
  shiftVisibilityTitle: { fontSize: 14, fontWeight: '900', color: '#263638' },
  shiftVisibilityDescription: { marginTop: 3, fontSize: 11, color: '#68777A' },
  detailIcon: { marginRight: 8, marginTop: 2 },
  detailTitle: { width: 80, fontSize: 14, color: COLORS.textLight, fontWeight: 'bold', marginTop: 2 },
  detailData: { flex: 1, fontSize: 16, color: COLORS.text, fontWeight: 'bold', marginBottom: 4 },
  modalActions: { gap: 12 },
  modalBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12 },
  modalEditBtn: { backgroundColor: COLORS.primary },
  modalBtnTextWhite: { color: COLORS.white, fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
  modalDeleteBtn: { backgroundColor: '#FFF0F0', borderWidth: 1, borderColor: '#FFE0E0' },
  modalBtnTextDanger: { color: COLORS.danger, fontSize: 16, fontWeight: 'bold', marginLeft: 8 },

  filterModalOverlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  filterModalContent: { backgroundColor: COLORS.white, height: '80%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  filterModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderColor: COLORS.border, paddingBottom: 16, marginBottom: 16 },
  filterModalTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  filterSectionTitle: { fontSize: 14, fontWeight: 'bold', color: COLORS.textLight, marginBottom: 12, marginTop: 16 },
  filterChipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  filterChipActive: { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary },
  filterChipText: { fontSize: 14, color: COLORS.text },
  filterChipTextActive: { color: COLORS.primary, fontWeight: 'bold' },
  filterModalFooter: { flexDirection: 'row', gap: 12, paddingTop: 16, borderTopWidth: 1, borderColor: COLORS.border, paddingBottom: 20 },
  clearFilterBtn: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center', backgroundColor: '#F0F0F0' },
  clearFilterText: { color: COLORS.textLight, fontWeight: 'bold', fontSize: 16 },
  applyFilterBtn: { flex: 2, paddingVertical: 14, borderRadius: 8, alignItems: 'center', backgroundColor: COLORS.primary },
  applyFilterText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
});
