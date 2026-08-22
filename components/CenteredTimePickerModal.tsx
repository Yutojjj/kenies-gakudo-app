import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { COLORS } from '../constants/theme';

const ITEM_HEIGHT = 48;
const VISIBLE_ITEMS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const WHEEL_PADDING = ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2);
const DEFAULT_HOURS = Array.from({ length: 24 }, (_, index) => index);
const DEFAULT_MINUTES = Array.from({ length: 12 }, (_, index) => index * 5);

type Props = {
  visible: boolean;
  value: string;
  title?: string;
  hours?: number[];
  minutes?: number[];
  onClose: () => void;
  onConfirm: (value: string) => void;
};

const nearestIndex = (offset: number, length: number) =>
  Math.max(0, Math.min(length - 1, Math.round(offset / ITEM_HEIGHT)));

export default function CenteredTimePickerModal({
  visible,
  value,
  title = '時刻を選択',
  hours = DEFAULT_HOURS,
  minutes = DEFAULT_MINUTES,
  onClose,
  onConfirm,
}: Props) {
  const [hour, setHour] = useState(hours[0] ?? 0);
  const [minute, setMinute] = useState(minutes[0] ?? 0);
  const hourRef = useRef<ScrollView>(null);
  const minuteRef = useRef<ScrollView>(null);

  const settle = (
    offset: number,
    values: number[],
    setter: (next: number) => void,
    ref: React.RefObject<ScrollView | null>,
  ) => {
    const index = nearestIndex(offset, values.length);
    setter(values[index]);
    ref.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
  };

  useEffect(() => {
    if (!visible) return;
    const [rawHour, rawMinute] = String(value || '').split(':').map(Number);
    const nextHour = hours.includes(rawHour) ? rawHour : (hours[0] ?? 0);
    const nextMinute = minutes.includes(rawMinute) ? rawMinute : (minutes[0] ?? 0);
    setHour(nextHour);
    setMinute(nextMinute);
    const timer = setTimeout(() => {
      hourRef.current?.scrollTo({ y: Math.max(0, hours.indexOf(nextHour)) * ITEM_HEIGHT, animated: false });
      minuteRef.current?.scrollTo({ y: Math.max(0, minutes.indexOf(nextMinute)) * ITEM_HEIGHT, animated: false });
    }, 60);
    return () => clearTimeout(timer);
  }, [visible, value, hours, minutes]);

  const renderWheel = (
    values: number[],
    selected: number,
    setter: (next: number) => void,
    ref: React.RefObject<ScrollView | null>,
    pad: boolean,
  ) => (
    <View style={styles.wheelColumn}>
      <ScrollView
        ref={ref}
        style={styles.wheelScroll}
        contentContainerStyle={styles.wheelContent}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        snapToOffsets={values.map((_, index) => index * ITEM_HEIGHT)}
        snapToAlignment="start"
        disableIntervalMomentum
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={event => {
          const index = nearestIndex(event.nativeEvent.contentOffset.y, values.length);
          if (values[index] !== selected) setter(values[index]);
        }}
        onMomentumScrollEnd={event => settle(event.nativeEvent.contentOffset.y, values, setter, ref)}
        onScrollEndDrag={event => settle(event.nativeEvent.contentOffset.y, values, setter, ref)}
      >
        {values.map(item => (
          <TouchableOpacity
            key={item}
            style={styles.wheelItem}
            activeOpacity={0.7}
            onPress={() => {
              setter(item);
              ref.current?.scrollTo({ y: values.indexOf(item) * ITEM_HEIGHT, animated: true });
            }}
          >
            <Text style={[styles.wheelItemText, selected === item && styles.wheelItemTextSelected]}>
              {pad ? String(item).padStart(2, '0') : item}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.panel}>
              <View style={styles.header}>
                <Text style={styles.title}>{title}</Text>
                <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                  <Ionicons name="close" size={24} color={COLORS.text} />
                </TouchableOpacity>
              </View>
              <Text style={styles.valueText}>
                {String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}
              </Text>
              <View style={styles.wheels}>
                <View pointerEvents="none" style={styles.selectionFrame} />
                {renderWheel(hours, hour, setHour, hourRef, true)}
                <Text pointerEvents="none" style={styles.colon}>:</Text>
                {renderWheel(minutes, minute, setMinute, minuteRef, true)}
              </View>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                  <Text style={styles.cancelText}>閉じる</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmButton}
                  onPress={() => onConfirm(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)}
                >
                  <Text style={styles.confirmText}>決定</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18, backgroundColor: 'rgba(0,0,0,0.48)' },
  panel: { width: '100%', maxWidth: 380, borderRadius: 16, padding: 18, backgroundColor: '#FFFFFF' },
  header: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '900' },
  closeButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F5F5' },
  valueText: { marginVertical: 8, color: COLORS.primary, fontSize: 28, fontWeight: '900', textAlign: 'center' },
  wheels: { height: WHEEL_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  selectionFrame: { position: 'absolute', left: 18, right: 18, top: WHEEL_PADDING, height: ITEM_HEIGHT, borderRadius: 10, backgroundColor: '#DFF4F4', borderWidth: 1, borderColor: '#8ED5D8' },
  wheelColumn: { width: 104, height: WHEEL_HEIGHT },
  wheelScroll: { flex: 1 },
  wheelContent: { paddingVertical: WHEEL_PADDING },
  wheelItem: { height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  wheelItemText: { color: '#858585', fontSize: 21, fontWeight: '700' },
  wheelItemTextSelected: { color: '#173D40', fontSize: 25, fontWeight: '900' },
  colon: { zIndex: 2, width: 28, color: COLORS.text, fontSize: 25, fontWeight: '900', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#F2F2F2' },
  cancelText: { color: COLORS.text, fontSize: 15, fontWeight: 'bold' },
  confirmButton: { flex: 1.4, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: COLORS.primary },
  confirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' },
});
