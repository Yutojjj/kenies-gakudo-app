import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  value: Date;
  mode: 'year' | 'month';
  onChange: (value: Date) => void;
  onClose: () => void;
};

export default function MonthPickerModal({ visible, value, mode, onChange, onClose }: Props) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const years = Array.from({ length: 11 }, (_, index) => value.getFullYear() - 5 + index);
  const selectYear = (year: number) => onChange(new Date(year, value.getMonth(), 1));
  const selectMonth = (month: number) => onChange(new Date(value.getFullYear(), month, 1));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.dismissArea} onPress={onClose} accessible={false} focusable={false} />
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.title}>{mode === 'year' ? '年を選択' : '月を選択'}</Text>
            <Pressable
              style={({ pressed }) => [styles.closeButton, (hoveredKey === 'close' || pressed) && styles.closeButtonInteraction]}
              accessibilityRole="button"
              onPress={onClose}
              onHoverIn={() => setHoveredKey('close')}
              onHoverOut={() => setHoveredKey(null)}
              accessibilityLabel="閉じる"
            >
              <Ionicons name="close" size={22} color="#5D4037" />
            </Pressable>
          </View>
          <Text style={styles.sectionLabel}>{mode === 'year' ? '年' : '月'}</Text>
          {mode === 'year' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yearRow}>
              {years.map(year => (
                <Pressable
                  key={year}
                  style={({ pressed }) => [
                    styles.yearButton,
                    year === value.getFullYear() && styles.selectedButton,
                    (hoveredKey === `year-${year}` || pressed) && styles.buttonInteraction,
                  ]}
                  accessibilityRole="button"
                  onPress={() => selectYear(year)}
                  onHoverIn={() => setHoveredKey(`year-${year}`)}
                  onHoverOut={() => setHoveredKey(null)}
                >
                  <Text style={[styles.buttonText, year === value.getFullYear() && styles.selectedText]}>{year}年</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.monthGrid}>
              {Array.from({ length: 12 }, (_, month) => (
                <Pressable
                  key={month}
                  style={({ pressed }) => [
                    styles.monthButton,
                    month === value.getMonth() && styles.selectedButton,
                    (hoveredKey === `month-${month}` || pressed) && styles.buttonInteraction,
                  ]}
                  accessibilityRole="button"
                  onPress={() => selectMonth(month)}
                  onHoverIn={() => setHoveredKey(`month-${month}`)}
                  onHoverOut={() => setHoveredKey(null)}
                >
                  <Text style={[styles.buttonText, month === value.getMonth() && styles.selectedText]}>{month + 1}月</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Pressable
            style={({ pressed }) => [styles.doneButton, (hoveredKey === 'done' || pressed) && styles.doneButtonInteraction]}
            accessibilityRole="button"
            onPress={onClose}
            onHoverIn={() => setHoveredKey('done')}
            onHoverOut={() => setHoveredKey(null)}
          >
            <Text style={styles.doneText}>決定</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18, backgroundColor: 'rgba(35, 30, 27, 0.5)' },
  dismissArea: { ...StyleSheet.absoluteFillObject },
  panel: { width: '100%', maxWidth: 430, borderRadius: 18, padding: 20, backgroundColor: '#FFFDFC' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 19, fontWeight: '900', color: '#3D2A24' },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF1E4' },
  closeButtonInteraction: { backgroundColor: '#EAD9CB' },
  sectionLabel: { marginTop: 16, marginBottom: 8, fontSize: 13, fontWeight: '900', color: '#76665E' },
  yearRow: { gap: 8 },
  yearButton: { minWidth: 76, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#E5D7CB', backgroundColor: '#FFFFFF' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  monthButton: { width: '23%', minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#E5D7CB', backgroundColor: '#FFFFFF' },
  selectedButton: { borderColor: '#00AEB8', backgroundColor: '#D9F1F1' },
  buttonInteraction: { backgroundColor: '#C4E6E7' },
  buttonText: { fontSize: 14, fontWeight: '800', color: '#5D4037' },
  selectedText: { color: '#007A82' },
  doneButton: { minHeight: 44, marginTop: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#00AEB8' },
  doneButtonInteraction: { backgroundColor: '#008F98' },
  doneText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
