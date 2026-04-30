import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';

type ShiftType = '✕' | '午前✕' | '午後✕';

export default function ShiftScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const [currentDate, setCurrentDate] = useState(new Date());
  
  // 日付文字列 ('YYYY-MM-DD') をキーにしたシフトデータ
  const [shiftData, setShiftData] = useState<Record<string, ShiftType>>({});
  
  // 現在選択されているスタンプの種類（デフォルトは「✕」）
  const [activeStamp, setActiveStamp] = useState<ShiftType>('✕');
  
  // 右下アクションボタンのポップアップ管理
  const [stampModalVisible, setStampModalVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  // --- Firestoreから自分のシフトデータをリアルタイム取得 ---
  useEffect(() => {
    const staffName = name || '不明なスタッフ';
    const q = query(collection(db, 'shifts'), where('staffName', '==', staffName));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: Record<string, ShiftType> = {};
      snapshot.forEach((doc) => {
        const item = doc.data();
        data[item.dateStr] = item.type;
      });
      setShiftData(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [name]);

  // --- カレンダー生成ロジック ---
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const generateCalendarDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ day: i, dateStr });
    }
    return days;
  };

  const changeMonth = (offset: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
  };

  // --- タップ操作 (Firestoreに即時保存/削除) ---
  const handleDayPress = async (dateStr: string) => {
    const staffName = name || '不明なスタッフ';
    const docId = `${staffName}_${dateStr}`;
    const docRef = doc(db, 'shifts', docId);

    const currentStamp = shiftData[dateStr];

    // UIを先に更新（Optimistic Update）
    setShiftData(prev => {
      if (currentStamp === activeStamp) {
        const newData = { ...prev };
        delete newData[dateStr];
        return newData;
      }
      return { ...prev, [dateStr]: activeStamp };
    });

    // データベースを更新
    try {
      if (currentStamp === activeStamp) {
        await deleteDoc(docRef);
      } else {
        await setDoc(docRef, {
          staffName,
          dateStr,
          type: activeStamp,
          updatedAt: new Date()
        });
      }
    } catch (error) {
      console.error(error);
      Alert.alert('エラー', '保存に失敗しました。');
    }
  };

  // --- 右下ボタンからのスタンプ選択 ---
  const selectStamp = (stamp: ShiftType) => {
    setActiveStamp(stamp);
    setStampModalVisible(false);
  };

  const handleSubmit = () => {
    Alert.alert('提出完了', 'シフトの希望を提出しました。');
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  const days = generateCalendarDays();
  const weeks = ['日', '月', '火', '水', '木', '金', '土'];

  return (
    <SafeAreaView style={styles.container}>
      
      {/* 選択中のスタンプを表示するバナー */}
      <View style={styles.stampBanner}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="create-outline" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
          <Text style={styles.bannerText}>現在選択中：</Text>
        </View>
        <View style={styles.activeStampBadge}>
          <Text style={styles.activeStampText}>{activeStamp}</Text>
        </View>
      </View>

      <ScrollView style={styles.scrollArea}>
        
        {/* 月切り替えナビゲーション */}
        <View style={styles.monthSelector}>
          <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.monthBtn}>
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.monthText}>{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</Text>
          <TouchableOpacity onPress={() => changeMonth(1)} style={styles.monthBtn}>
            <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        {/* カレンダー本体 */}
        <View style={styles.calendarContainer}>
          <View style={styles.calHeaderRow}>
            {weeks.map((w, i) => (
              <Text key={i} style={[styles.calWeekText, i === 0 && {color: '#E74C3C'}, i === 6 && {color: '#3498DB'}]}>{w}</Text>
            ))}
          </View>
          
          <View style={styles.calGrid}>
            {days.map((item, index) => {
              if (!item) return <View key={`empty-${index}`} style={styles.calCellEmpty} />;
              
              const isWeekend = new Date(item.dateStr).getDay() === 0 || new Date(item.dateStr).getDay() === 6;
              const cellStamp = shiftData[item.dateStr];

              return (
                <TouchableOpacity 
                  key={item.dateStr} 
                  style={[styles.calCell, cellStamp && styles.calCellActive]}
                  onPress={() => handleDayPress(item.dateStr)}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.calDayText, isWeekend && { color: '#999' }]}>{item.day}</Text>
                  
                  <View style={styles.cellContent}>
                    {cellStamp && (
                      <View style={[
                        styles.stampBadge, 
                        cellStamp === '✕' ? styles.stampBadgeAll : 
                        cellStamp === '午前✕' ? styles.stampBadgeAM : styles.stampBadgePM
                      ]}>
                        <Text style={styles.stampText}>{cellStamp}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 保存ボタン */}
        <View style={styles.submitContainer}>
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            <Ionicons name="send" size={20} color={COLORS.white} style={{ marginRight: 8 }} />
            <Text style={styles.submitBtnText}>シフトを提出する</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      {/* 右下のアクションボタン (スタンプ切り替え) */}
      <TouchableOpacity style={styles.fab} onPress={() => setStampModalVisible(true)}>
        <Ionicons name="options-outline" size={24} color={COLORS.white} />
        <Text style={styles.fabText}>種類変更</Text>
      </TouchableOpacity>

      {/* =========================================================
          ポップアップ：スタンプ（✕）の種類選択
          ========================================================= */}
      <Modal visible={stampModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>希望休の種類を選択</Text>
              <TouchableOpacity onPress={() => setStampModalVisible(false)}>
                <Ionicons name="close" size={28} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalDesc}>選択した状態でカレンダーをタップすると入力できます。</Text>

            <TouchableOpacity style={styles.stampSelectBtn} onPress={() => selectStamp('✕')}>
              <View style={[styles.stampIconDemo, styles.stampBadgeAll]}>
                <Text style={styles.stampTextDemo}>✕</Text>
              </View>
              <Text style={styles.stampSelectText}>1日お休み</Text>
              {activeStamp === '✕' && <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />}
            </TouchableOpacity>

            <TouchableOpacity style={styles.stampSelectBtn} onPress={() => selectStamp('午前✕')}>
              <View style={[styles.stampIconDemo, styles.stampBadgeAM]}>
                <Text style={styles.stampTextDemo}>午前✕</Text>
              </View>
              <Text style={styles.stampSelectText}>午前のみお休み</Text>
              {activeStamp === '午前✕' && <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />}
            </TouchableOpacity>

            <TouchableOpacity style={styles.stampSelectBtn} onPress={() => selectStamp('午後✕')}>
              <View style={[styles.stampIconDemo, styles.stampBadgePM]}>
                <Text style={styles.stampTextDemo}>午後✕</Text>
              </View>
              <Text style={styles.stampSelectText}>午後のみお休み</Text>
              {activeStamp === '午後✕' && <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />}
            </TouchableOpacity>

          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  
  stampBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFDF5', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#F3E5AB' },
  bannerText: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  activeStampBadge: { backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
  activeStampText: { color: COLORS.white, fontWeight: 'bold', fontSize: 14 },

  scrollArea: { flex: 1 },

  // 月切り替え
  monthSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  monthBtn: { padding: 8, backgroundColor: COLORS.surface, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border },
  monthText: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },

  // カレンダー
  calendarContainer: { paddingHorizontal: 12, paddingBottom: 20 },
  calHeaderRow: { flexDirection: 'row', marginBottom: 12 },
  calWeekText: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 'bold', color: COLORS.textLight },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCellEmpty: { width: '14.28%', aspectRatio: 0.8 },
  calCell: { width: '14.28%', aspectRatio: 0.8, borderWidth: 0.5, borderColor: COLORS.border, padding: 4, backgroundColor: COLORS.white },
  calCellActive: { backgroundColor: '#FAFAFA' },
  calDayText: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 4, textAlign: 'center' },
  cellContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  
  // スタンプバッジ
  stampBadge: { paddingHorizontal: 4, paddingVertical: 4, borderRadius: 6, width: '100%', alignItems: 'center', justifyContent: 'center' },
  stampBadgeAll: { backgroundColor: '#FFE4E1' }, // 1日休みは赤系
  stampBadgeAM: { backgroundColor: '#E0FFFF' },  // 午前休みは青系
  stampBadgePM: { backgroundColor: '#FFFACD' },  // 午後休みは黄系
  stampText: { fontSize: 11, fontWeight: 'bold', color: COLORS.text },

  submitContainer: { padding: 20, paddingBottom: 100 },
  submitBtn: { flexDirection: 'row', backgroundColor: COLORS.primary, padding: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  submitBtnText: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },

  // FAB (アクションボタン)
  fab: { position: 'absolute', right: 20, bottom: 40, backgroundColor: COLORS.secondary, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 30, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  fabText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16, marginLeft: 8 },

  // モーダル共通
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { width: '100%', backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 15, elevation: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  modalDesc: { fontSize: 13, color: COLORS.textLight, marginBottom: 24 },

  // スタンプ選択リスト
  stampSelectBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: COLORS.border },
  stampIconDemo: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, marginRight: 16, width: 80, alignItems: 'center' },
  stampTextDemo: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
  stampSelectText: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, flex: 1 },
});