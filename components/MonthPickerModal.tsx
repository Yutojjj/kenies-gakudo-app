import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  visible: boolean;
  value: Date;
  onChange: (value: Date) => void;
  onClose: () => void;
};

export default function MonthPickerModal({ visible, value, onChange, onClose }: Props) {
  const years = Array.from({ length: 11 }, (_, index) => value.getFullYear() - 5 + index);
  const selectYear = (year: number) => onChange(new Date(year, value.getMonth(), 1));
  const selectMonth = (month: number) => onChange(new Date(value.getFullYear(), month, 1));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.panel} onPress={event => event.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>年月を選択</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityLabel="閉じる">
              <Ionicons name="close" size={22} color="#5D4037" />
            </TouchableOpacity>
          </View>
          <Text style={styles.sectionLabel}>年</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yearRow}>
            {years.map(year => (
              <TouchableOpacity key={year} style={[styles.yearButton, year === value.getFullYear() && styles.selectedButton]} onPress={() => selectYear(year)}>
                <Text style={[styles.buttonText, year === value.getFullYear() && styles.selectedText]}>{year}年</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.sectionLabel}>月</Text>
          <View style={styles.monthGrid}>
            {Array.from({ length: 12 }, (_, month) => (
              <TouchableOpacity key={month} style={[styles.monthButton, month === value.getMonth() && styles.selectedButton]} onPress={() => selectMonth(month)}>
                <Text style={[styles.buttonText, month === value.getMonth() && styles.selectedText]}>{month + 1}月</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.doneButton} onPress={onClose}><Text style={styles.doneText}>決定</Text></TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18, backgroundColor: 'rgba(35, 30, 27, 0.5)' },
  panel: { width: '100%', maxWidth: 430, borderRadius: 18, padding: 20, backgroundColor: '#FFFDFC' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 19, fontWeight: '900', color: '#3D2A24' },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF1E4' },
  sectionLabel: { marginTop: 16, marginBottom: 8, fontSize: 13, fontWeight: '900', color: '#76665E' },
  yearRow: { gap: 8 },
  yearButton: { minWidth: 76, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#E5D7CB', backgroundColor: '#FFFFFF' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  monthButton: { width: '23%', minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#E5D7CB', backgroundColor: '#FFFFFF' },
  selectedButton: { borderColor: '#00AEB8', backgroundColor: '#D9F1F1' },
  buttonText: { fontSize: 14, fontWeight: '800', color: '#5D4037' },
  selectedText: { color: '#007A82' },
  doneButton: { minHeight: 44, marginTop: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#00AEB8' },
  doneText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
