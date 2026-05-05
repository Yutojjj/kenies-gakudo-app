import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, query, serverTimestamp } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../../constants/theme';
import { db } from '../../firebase';

export default function AccountManagementScreen() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  // 基本フィルター
  const [filterRole, setFilterRole] = useState<'all' | 'user' | 'staff'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // 詳細絞り込み用ステート
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [selectedSchools, setSelectedSchools] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [selectedUsageTypes, setSelectedUsageTypes] = useState<string[]>([]);
  
  // グループ作成（選択モード）用ステート
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [createGroupModalVisible, setCreateGroupModalVisible] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

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
      // ▼ クライアント側でソート（orderByはインデックス不要で確実）▼
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

    // 学校・学年のマスターデータ取得（絞り込みの選択肢用）
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
          return; // 成功で終了
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

  // --- 絞り込み処理 ---
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
    // 1. タブ（Role）での絞り込み
    if (filterRole !== 'all' && acc.role !== filterRole) return false;
    
    // 2. 検索バーでの絞り込み (名前 or ニックネーム)
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = acc.name?.toLowerCase().includes(q);
      const matchKana = acc.nicknameKana?.toLowerCase().includes(q);
      
      // 兄弟の名前やニックネームも検索対象に含める場合
      let matchSibling = false;
      if (acc.siblings && Array.isArray(acc.siblings)) {
        matchSibling = acc.siblings.some((sib: any) => 
          sib.name?.toLowerCase().includes(q) || sib.nicknameKana?.toLowerCase().includes(q)
        );
      }
      
      if (!matchName && !matchKana && !matchSibling) return false;
    }

    // 3. 詳細絞り込み（学校、学年、利用形態）※スタッフは基本的に弾かれるか、条件なしなら表示
    const hasDetailedFilters = selectedSchools.length > 0 || selectedGrades.length > 0 || selectedUsageTypes.length > 0;
    
    if (hasDetailedFilters) {
      // スタッフは学校等の属性を持たないため、詳細フィルターがかかっている場合は除外する
      if (acc.role === 'staff') return false;

      let isMatchMain = true;
      if (selectedSchools.length > 0 && !selectedSchools.includes(acc.school)) isMatchMain = false;
      if (selectedGrades.length > 0 && !selectedGrades.includes(acc.grade)) isMatchMain = false;
      if (selectedUsageTypes.length > 0 && !selectedUsageTypes.includes(acc.usageType)) isMatchMain = false;

      // 本人がマッチしていればOK
      if (isMatchMain) return true;

      // 本人がマッチしなくても、兄弟がマッチしていれば親アカウントごと表示する
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
      
      return false; // 本人も兄弟も条件に合わない
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

  // --- グループ作成（選択モード）処理 ---
  const toggleSelection = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      Alert.alert('エラー', 'グループ名を入力してください。');
      return;
    }
    
    setLoading(true);
    try {
      await addDoc(collection(db, 'conversations'), {
        type: 'group',
        name: newGroupName.trim(),
        // 管理者自身(admin)と、選択したメンバー全員のIDを参加者として登録
        participants: ['admin', ...selectedIds],
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        lastMessage: 'グループが作成されました',
        readBy: ['admin'],
        unreadFor: selectedIds, // 他のメンバーには未読として通知させる
      });
      
      Alert.alert('成功', 'グループを作成しました！\nメッセージ画面から確認できます。', [
        { text: 'OK', onPress: () => {
            setCreateGroupModalVisible(false);
            setNewGroupName('');
            setIsSelectionMode(false);
            setSelectedIds([]);
        }}
      ]);
    } catch (error) {
      console.error(error);
      Alert.alert('エラー', 'グループの作成に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.filterContainer}>
        <TouchableOpacity style={[styles.filterBtn, filterRole === 'all' && styles.filterBtnActive]} onPress={() => setFilterRole('all')}><Text style={[styles.filterText, filterRole === 'all' && styles.filterTextActive]}>すべて</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.filterBtn, filterRole === 'user' && styles.filterBtnActive]} onPress={() => setFilterRole('user')}><Text style={[styles.filterText, filterRole === 'user' && styles.filterTextActive]}>利用者</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.filterBtn, filterRole === 'staff' && styles.filterBtnActive]} onPress={() => setFilterRole('staff')}><Text style={[styles.filterText, filterRole === 'staff' && styles.filterTextActive]}>スタッフ</Text></TouchableOpacity>
      </View>

      {/* 検索バー ＆ 詳細絞り込みボタン ＆ 選択モードボタン */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={COLORS.textLight} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="名前やニックネームで検索"
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

        {/* グループ作成用（選択モード）切替ボタン */}
        <TouchableOpacity 
          style={[styles.detailedFilterBtn, isSelectionMode && styles.detailedFilterBtnActive, { marginLeft: 8 }]} 
          onPress={() => {
            setIsSelectionMode(!isSelectionMode);
            if (isSelectionMode) setSelectedIds([]); // 終了時にリセット
          }}
        >
          <Ionicons name="checkbox-outline" size={20} color={isSelectionMode ? COLORS.white : COLORS.primary} />
        </TouchableOpacity>
      </View>

      <FlatList
          data={filteredAccounts}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item }) => (
            <TouchableOpacity 
              style={[
                styles.accountCard, 
                item.role === 'staff' ? styles.cardStaff : styles.cardUser,
                isSelectionMode && selectedIds.includes(item.id) && { borderColor: COLORS.primary, borderWidth: 2 }
              ]} 
              onPress={() => {
                if (isSelectionMode) {
                  toggleSelection(item.id);
                } else {
                  setSelectedAccount(item);
                }
              }}
              activeOpacity={0.7}
            >
              <View style={styles.cardHeader}>
                {isSelectionMode && (
                  <Ionicons 
                    name={selectedIds.includes(item.id) ? "checkmark-circle" : "ellipse-outline"} 
                    size={24} 
                    color={selectedIds.includes(item.id) ? COLORS.primary : COLORS.border} 
                    style={{ marginRight: 12 }} 
                  />
                )}
                <View style={[styles.badge, item.role === 'staff' ? styles.badgeStaff : styles.badgeUser]}>
                  <Ionicons name={item.role === 'staff' ? "briefcase" : "school"} size={12} color={COLORS.white} style={{marginRight: 4}} />
                  <Text style={styles.badgeText}>{item.role === 'staff' ? 'スタッフ' : '利用者'}</Text>
                </View>
                <Text style={styles.accountName}>{item.name}</Text>
              </View>
              {!isSelectionMode && <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />}
            </TouchableOpacity>
          )}
          ListEmptyComponent={<View style={styles.emptyContainer}><Ionicons name="folder-open-outline" size={48} color={COLORS.border} /><Text style={styles.emptyText}>該当するアカウントはありません。</Text></View>}
        />

      {/* 選択モード中はFABを隠し、下部にアクションバーを表示 */}
      {!isSelectionMode && (
        <TouchableOpacity style={styles.fab} onPress={() => router.push('/account/form')}><Ionicons name="add" size={32} color={COLORS.white} /></TouchableOpacity>
      )}

      {isSelectionMode && (
        <View style={styles.selectionBottomBar}>
          <Text style={styles.selectionText}>{selectedIds.length}人選択中</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity 
              style={[styles.selectionBtn, styles.selectionCancelBtn]} 
              onPress={() => { setIsSelectionMode(false); setSelectedIds([]); }}
            >
              <Text style={styles.selectionCancelText}>キャンセル</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.selectionBtn, styles.selectionCreateBtn, selectedIds.length === 0 && { opacity: 0.5 }]} 
              onPress={() => {
                if (selectedIds.length > 0) setCreateGroupModalVisible(true);
              }}
              disabled={selectedIds.length === 0}
            >
              <Text style={styles.selectionCreateText}>グループ作成</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* --- グループ作成モーダル --- */}
      <Modal visible={createGroupModalVisible} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.createGroupModalContent}>
            <Text style={styles.modalName}>グループ作成</Text>
            <Text style={{ color: COLORS.textLight, marginBottom: 16, marginTop: 8, lineHeight: 20 }}>
              選択した {selectedIds.length} 人のメンバーとチャットができる新しいグループを作成します。
            </Text>
            <TextInput
              style={styles.input}
              placeholder="例：〇〇プロジェクトチーム"
              placeholderTextColor={COLORS.textLight}
              value={newGroupName}
              onChangeText={setNewGroupName}
              autoFocus
            />
            <View style={[styles.modalActions, { marginTop: 24, flexDirection: 'row' }]}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalDeleteBtn, { flex: 1, marginRight: 6 }]} onPress={() => setCreateGroupModalVisible(false)}>
                <Text style={styles.modalBtnTextDanger}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalEditBtn, { flex: 1, marginLeft: 6 }]} onPress={handleCreateGroup}>
                <Text style={styles.modalBtnTextWhite}>作成する</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* --- アカウント詳細モーダル --- */}
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

      {/* --- 詳細絞り込みモーダル --- */}
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
  
  // 検索バー＆詳細フィルターボタン
  searchRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 12 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: COLORS.text },
  clearSearchBtn: { padding: 4 },
  detailedFilterBtn: { width: 44, height: 44, backgroundColor: COLORS.white, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center' },
  detailedFilterBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterBadge: { position: 'absolute', top: -6, right: -6, backgroundColor: COLORS.danger, borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  filterBadgeText: { color: COLORS.white, fontSize: 10, fontWeight: 'bold' },

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
  
  // モーダル全般
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxHeight: '85%', backgroundColor: COLORS.white, borderRadius: 20, padding: 24, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 15, elevation: 10 },
  createGroupModalContent: { width: '90%', backgroundColor: COLORS.white, borderRadius: 20, padding: 24, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 15, elevation: 10 },
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
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 16, fontSize: 16, color: COLORS.text },

  // グループ作成用ボトムバー
  selectionBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, 
    backgroundColor: COLORS.white, padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    borderTopWidth: 1, borderColor: COLORS.border,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 10,
  },
  selectionText: { fontSize: 16, fontWeight: 'bold', color: COLORS.primary },
  selectionBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  selectionCancelBtn: { backgroundColor: '#F0F0F0' },
  selectionCancelText: { color: COLORS.textLight, fontWeight: 'bold' },
  selectionCreateBtn: { backgroundColor: COLORS.primary },
  selectionCreateText: { color: COLORS.white, fontWeight: 'bold' },

  // 詳細絞り込みモーダル
  filterModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
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