import React, { useMemo, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, PanResponder, StyleSheet, View } from 'react-native';

type Props = {
  currentDate: Date;
  onChangeDate: (date: Date) => void;
  renderMonth: (date: Date) => React.ReactNode;
  enabled?: boolean;
};

const monthDate = (date: Date, amount: number) =>
  new Date(date.getFullYear(), date.getMonth() + amount, 1);

const monthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}`;

export default function SwipeMonthPager({
  currentDate,
  onChangeDate,
  renderMonth,
  enabled = true,
}: Props) {
  const [pageWidth, setPageWidth] = useState(1);
  const dragX = useRef(new Animated.Value(0)).current;
  const currentDateRef = useRef(currentDate);
  const onChangeDateRef = useRef(onChangeDate);
  const enabledRef = useRef(enabled);
  const widthRef = useRef(pageWidth);

  currentDateRef.current = currentDate;
  onChangeDateRef.current = onChangeDate;
  enabledRef.current = enabled;
  widthRef.current = pageWidth;

  const settleBack = () => {
    Animated.spring(dragX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 26,
      bounciness: 1,
    }).start();
  };

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => enabledRef.current && (
      Math.abs(gesture.dx) > 7 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.05
    ),
    onPanResponderMove: (_event, gesture) => {
      const width = widthRef.current;
      dragX.setValue(Math.max(-width, Math.min(width, gesture.dx)));
    },
    onPanResponderRelease: (_event, gesture) => {
      const width = widthRef.current;
      const horizontal = Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.05;
      const distance = Math.min(48, Math.max(34, width * 0.09));
      const quickFlick = Math.abs(gesture.vx) >= 0.3;
      if (!horizontal || (Math.abs(gesture.dx) < distance && !quickFlick)) {
        settleBack();
        return;
      }

      const amount = gesture.dx < 0 ? 1 : -1;
      Animated.timing(dragX, {
        toValue: amount > 0 ? -width : width,
        duration: 120,
        useNativeDriver: true,
      }).start(() => {
        dragX.setValue(0);
        onChangeDateRef.current(monthDate(currentDateRef.current, amount));
      });
    },
    onPanResponderTerminate: settleBack,
  }), [dragX]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const width = Math.max(1, event.nativeEvent.layout.width);
    widthRef.current = width;
    setPageWidth(width);
  };

  const previousDate = monthDate(currentDate, -1);
  const nextDate = monthDate(currentDate, 1);

  return (
    <View style={styles.viewport} onLayout={handleLayout} {...panResponder.panHandlers}>
      <Animated.View
        style={[
          styles.track,
          {
            width: pageWidth * 3,
            transform: [{ translateX: Animated.add(dragX, -pageWidth) }],
          },
        ]}
      >
        <View key={`previous-${monthKey(previousDate)}`} style={[styles.page, { width: pageWidth }]}>
          {renderMonth(previousDate)}
        </View>
        <View key={`current-${monthKey(currentDate)}`} style={[styles.page, { width: pageWidth }]}>
          {renderMonth(currentDate)}
        </View>
        <View key={`next-${monthKey(nextDate)}`} style={[styles.page, { width: pageWidth }]}>
          {renderMonth(nextDate)}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
  track: {
    flex: 1,
    flexDirection: 'row',
  },
  page: {
    flex: 1,
  },
});
