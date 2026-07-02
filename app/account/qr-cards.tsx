import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AdminBottomNav from '../../components/AdminBottomNav';
import { COLORS } from '../../constants/theme';
import { db } from '../../firebase';
import { useRequireRole } from '../../hooks/useRequireRole';
import { navigateHome } from '../../utils/navigationHome';

// ── 型 ──────────────────────────────────────────
type Child = {
  id: string;          // FirestoreドキュメントID
  name: string;
  school: string;
  grade: string;
  qrCode?: string;     // QRに埋め込むURL（生成済みの場合）
  qrToken?: string;    // 新しいQR用トークン
  isParentAccount: boolean; // true=メインアカウントの子供、false=兄弟
  parentId?: string;   // 兄弟の場合の親アカウントID
  sibIndex?: number;   // 兄弟インデックス
};

export default function QrCardsScreen() {
  const { verified, checking } = useRequireRole('admin');
  const router = useRouter();

  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // accountsからflat化した子供リスト（兄弟含む）
  const children = useMemo<Child[]>(() => {
    const list: Child[] = [];
    for (const acc of accounts) {
      if (acc.role !== 'user') continue;
      // メインの子供
      list.push({
        id: acc.id,
        name: acc.name,
        school: acc.school || '',
        grade: acc.grade || '',
        qrCode: acc.qrCode,
        qrToken: acc.qrToken,
        isParentAccount: true,
      });
      // 兄弟
      if (acc.siblings && Array.isArray(acc.siblings)) {
        acc.siblings.forEach((sib: any, sibIdx: number) => {
          list.push({
            id: `${acc.id}_sib_${sibIdx}`,
            name: sib.name,
            school: sib.school || acc.school || '',
            grade: sib.grade || '',
            qrCode: sib.qrCode,
            qrToken: sib.qrToken,
            isParentAccount: false,
            parentId: acc.id,
            sibIndex: sibIdx,
          });
        });
      }
    }
    return list;
  }, [accounts]);

  const qrMissingCount = useMemo(() => children.filter(c => !c.qrCode).length, [children]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'accounts')), snap => {
      const data = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => {
          const aT = a.createdAt?.seconds ?? 0;
          const bT = b.createdAt?.seconds ?? 0;
          return bT - aT;
        });
      setAccounts(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ── QRコードURL生成 ──────────────────────────
  const buildQrUrl = (child: Child): string => {
    const base = Platform.OS === 'web' ? window.location.origin : (process.env.EXPO_PUBLIC_APP_URL || '');
    // qrTokenがあればそれを、なければドキュメントIDを使用する
    const token = child.qrToken || child.id;
    return `${base}/qr-scan?id=${token}`;
  };

  // 一括QR生成（未生成のもの全部）
  const handleBulkGenerate = async () => {
    const missing = children.filter(c => !c.qrCode);
    if (!missing.length) {
      if (Platform.OS === 'web') window.alert('すべての子供のQRコードは既に生成済みです。');
      else Alert.alert('完了', 'すべての子供のQRコードは既に生成済みです。');
      return;
    }

    const confirmMsg = `QRコードが未生成の子供が ${missing.length} 名います。一括生成しますか？`;
    const doGenerate = async () => {
      setGenerating(true);
      try {
        // アカウントごとにバッチ更新
        const accountMap: Record<string, any> = {};
        for (const acc of accounts) {
          if (acc.role === 'user') accountMap[acc.id] = acc;
        }

        // メインアカウントの子供 + 兄弟をまとめて処理
        const toUpdateAccounts: Record<string, any> = {}; // accountId -> updates

        for (const child of missing) {
          const qrUrl = buildQrUrl(child);
          if (child.isParentAccount) {
            // メインアカウントに直接qrCodeを保存
            if (!toUpdateAccounts[child.id]) toUpdateAccounts[child.id] = { siblings: accountMap[child.id]?.siblings ? [...accountMap[child.id].siblings] : [] };
            toUpdateAccounts[child.id].qrCode = qrUrl;
          } else if (child.parentId !== undefined && child.sibIndex !== undefined) {
            const parentId = child.parentId;
            if (!toUpdateAccounts[parentId]) {
              const parentSiblings = accountMap[parentId]?.siblings ? [...accountMap[parentId].siblings] : [];
              toUpdateAccounts[parentId] = { siblings: parentSiblings };
            }
            if (toUpdateAccounts[parentId].siblings[child.sibIndex]) {
              toUpdateAccounts[parentId].siblings[child.sibIndex] = {
                ...toUpdateAccounts[parentId].siblings[child.sibIndex],
                qrCode: qrUrl,
              };
            }
          }
        }

        // Firestoreに書き込み（バッチ）
        const batch = writeBatch(db);
        for (const [accId, updates] of Object.entries(toUpdateAccounts)) {
          batch.update(doc(db, 'accounts', accId), { ...updates, updatedAt: serverTimestamp() });
        }
        await batch.commit();

        if (Platform.OS === 'web') window.alert(`${missing.length} 名分のQRコードを生成しました。`);
        else Alert.alert('完了', `${missing.length} 名分のQRコードを生成しました。`);
      } catch (err) {
        console.error(err);
        if (Platform.OS === 'web') window.alert('QRコード生成中にエラーが発生しました。');
        else Alert.alert('エラー', 'QRコード生成中にエラーが発生しました。');
      } finally {
        setGenerating(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(confirmMsg)) doGenerate();
    } else {
      Alert.alert('一括QR生成', confirmMsg, [
        { text: 'キャンセル', style: 'cancel' },
        { text: '生成する', onPress: doGenerate },
      ]);
    }
  };

  // 選択トグル
  const toggleSelect = (childId: string) => {
    const next = new Set(selected);
    if (next.has(childId)) {
      next.delete(childId);
    } else {
      next.add(childId);
    }
    setSelected(next);
  };

  const selectAll = () => {
    setSelected(new Set(children.map(c => c.id)));
  };

  const clearSelect = () => setSelected(new Set());

  // 印刷（選択された子供のカードを非表示のiframeで読み込んで直接印刷画面を開く）
  const handlePrint = () => {
    if (!selected.size) {
      const msg = '印刷する子供を選択してください。';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('未選択', msg);
      return;
    }

    const selectedChildren = children.filter(c => selected.has(c.id));
    const hasNoQr = selectedChildren.some(c => !c.qrCode);
    if (hasNoQr) {
      const msg = 'QRコードが未生成の子供が含まれています。先に一括生成するか、その子を除外してください。';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('未生成あり', msg);
      return;
    }

    if (Platform.OS === 'web') {
      // sessionStorage経由でデータを渡す（URL長制限を回避）
      const payload = selectedChildren.map(c => ({
        id: c.id,
        name: c.name,
        school: c.school,
        qrCodeUrl: c.qrCode // 新しいqrTokenが含まれたURLを渡す
      }));
      sessionStorage.setItem('qr_print_data', JSON.stringify({
        children: payload,
        baseUrl: window.location.origin,
      }));

      // 古い印刷用iframeが残っていればあらかじめ削除
      const oldIframe = document.getElementById('qr-print-iframe');
      if (oldIframe) {
        oldIframe.remove();
      }

      // 非表示の隠しiframeを作成してbodyに挿入
      const iframe = document.createElement('iframe');
      iframe.id = 'qr-print-iframe';
      iframe.style.position = 'absolute';
      iframe.style.width = '0px';
      iframe.style.height = '0px';
      iframe.style.border = 'none';
      iframe.style.opacity = '0';
      iframe.src = '/qr-cards/print.html?src=session';

      document.body.appendChild(iframe);

      // iframeの読み込みが完了したら、中のウィンドウにフォーカスを当てて印刷ダイアログを起動
      iframe.onload = () => {
        setTimeout(() => {
          if (iframe.contentWindow) {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          }
        }, 300);
      };
    } else {
      Alert.alert('印刷', 'この機能はWeb版（ブラウザ）から利用してください。');
    }
  };

  // 単独QR生成
  const handleGenerateSingle = async (child: Child) => {
    const qrUrl = buildQrUrl(child);
    try {
      if (child.isParentAccount) {
        await updateDoc(doc(db, 'accounts', child.id), { qrCode: qrUrl, updatedAt: serverTimestamp() });
      } else if (child.parentId !== undefined && child.sibIndex !== undefined) {
        const parentAcc = accounts.find(a => a.id === child.parentId);
        if (!parentAcc) return;
        const siblings = [...(parentAcc.siblings || [])];
        if (siblings[child.sibIndex]) {
          siblings[child.sibIndex] = { ...siblings[child.sibIndex], qrCode: qrUrl };
          await updateDoc(doc(db, 'accounts', child.parentId), { siblings, updatedAt: serverTimestamp() });
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (checking || !verified) return null;

  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigateHome(router)}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>QRカード発行</Text>
      </View>

      {/* アクションバー */}
      <View style={styles.actionBar}>
        <View style={styles.actionLeft}>
          <Text style={styles.selectedCount}>
            {selected.size} 枚選択中
          </Text>
          {qrMissingCount > 0 && (
            <View style={styles.warningBadge}>
              <Text style={styles.warningBadgeText}>未生成 {qrMissingCount}名</Text>
            </View>
          )}
        </View>
        <View style={styles.actionRight}>
          {qrMissingCount > 0 && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.generateBtn, generating && styles.btnDisabled]}
              onPress={handleBulkGenerate}
              disabled={generating}
            >
              {generating
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="qr-code" size={16} color="#fff" />
              }
              <Text style={styles.actionBtnText}>{generating ? '生成中...' : '一括QR生成'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.actionBtn, styles.printBtn, !selected.size && styles.btnDisabled]} onPress={handlePrint} disabled={!selected.size}>
            <Ionicons name="print" size={16} color="#fff" />
            <Text style={styles.actionBtnText}>印刷する</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 全選択/解除 */}
      <View style={styles.selectBar}>
        <TouchableOpacity onPress={selectAll} style={styles.selectBarBtn}>
          <Ionicons name="checkmark-done" size={16} color={COLORS.primary} />
          <Text style={styles.selectBarText}>全員選択</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={clearSelect} style={styles.selectBarBtn}>
          <Ionicons name="close-circle-outline" size={16} color={COLORS.textLight} />
          <Text style={[styles.selectBarText, { color: COLORS.textLight }]}>選択解除</Text>
        </TouchableOpacity>
        <Text style={styles.totalCount}>全 {children.length} 名</Text>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>読み込み中...</Text>
        </View>
      ) : (
        <FlatList
          data={children}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isSelected = selected.has(item.id);
            const hasQr = !!item.qrCode;
            return (
              <TouchableOpacity
                style={[styles.childCard, isSelected && styles.childCardSelected]}
                onPress={() => toggleSelect(item.id)}
                activeOpacity={0.75}
              >
                {/* 選択チェック */}
                <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                  {isSelected && <Ionicons name="checkmark" size={16} color="#fff" />}
                </View>

                <View style={styles.childInfo}>
                  <View style={styles.childNameRow}>
                    <Text style={styles.childName}>{item.name}</Text>
                    {!item.isParentAccount && (
                      <View style={styles.sibBadge}>
                        <Text style={styles.sibBadgeText}>兄弟</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.childSub}>{item.school}{item.grade ? ` / ${item.grade}` : ''}</Text>
                </View>

                {/* QR状態 */}
                {hasQr ? (
                  <View style={styles.qrOk}>
                    <Ionicons name="qr-code" size={20} color={COLORS.primary} />
                    <Text style={styles.qrOkText}>生成済</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.qrGen}
                    onPress={(e) => { e.stopPropagation?.(); handleGenerateSingle(item); }}
                  >
                    <Ionicons name="qr-code-outline" size={18} color={COLORS.danger} />
                    <Text style={styles.qrGenText}>生成</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="people-outline" size={48} color={COLORS.border} />
              <Text style={styles.emptyText}>利用者アカウントがありません。</Text>
            </View>
          }
        />
      )}
      <AdminBottomNav active="menu" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#FFE4B5',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 10,
  },
  backBtn: {
    marginRight: 16,
    backgroundColor: 'rgba(255,255,255,0.6)',
    padding: 6,
    borderRadius: 16,
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#5D4037', flex: 1 },

  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
    flexWrap: 'wrap',
  },
  actionLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionRight: { flexDirection: 'row', gap: 8 },
  selectedCount: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  warningBadge: { backgroundColor: '#FFF3E0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#FFB300' },
  warningBadgeText: { fontSize: 11, fontWeight: 'bold', color: '#E65100' },

  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  generateBtn: { backgroundColor: '#4CAF50' },
  printBtn: { backgroundColor: COLORS.primary },
  btnDisabled: { opacity: 0.4 },
  actionBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 16,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  selectBarBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  selectBarText: { fontSize: 13, fontWeight: 'bold', color: COLORS.primary },
  totalCount: { marginLeft: 'auto', fontSize: 12, color: COLORS.textLight },

  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 15, color: COLORS.textLight },

  list: { padding: 16, paddingBottom: 80 },

  childCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    gap: 12,
  },
  childCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#FFFDF0',
  },

  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  checkboxSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },

  childInfo: { flex: 1 },
  childNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  childName: { fontSize: 17, fontWeight: 'bold', color: COLORS.text },
  sibBadge: {
    backgroundColor: '#E3F2FD',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#90CAF9',
  },
  sibBadgeText: { fontSize: 10, color: '#1565C0', fontWeight: 'bold' },
  childSub: { fontSize: 12, color: COLORS.textLight },

  qrOk: { alignItems: 'center', gap: 2 },
  qrOkText: { fontSize: 10, color: COLORS.primary, fontWeight: 'bold' },
  qrGen: {
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#FFF0F0',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#FFD0D0',
  },
  qrGenText: { fontSize: 10, color: COLORS.danger, fontWeight: 'bold' },

  emptyBox: { alignItems: 'center', marginTop: 80, gap: 12 },
  emptyText: { color: COLORS.textLight, fontSize: 15 },
});
