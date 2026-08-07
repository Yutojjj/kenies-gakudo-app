import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, useWindowDimensions, View } from 'react-native';

type Props<T extends string> = {
  tabs: T[];
  active: T;
  onChange: (next: T) => void;
  renderTab: (tab: T) => React.ReactNode;
  edgeGuard?: boolean;
};

export default function SwipeTabPager<T extends string>({
  tabs,
  active,
  onChange,
  renderTab,
  edgeGuard = true,
}: Props<T>) {
  const { width } = useWindowDimensions();
  const dragX = useRef(new Animated.Value(0)).current;
  const activeIndex = Math.max(0, tabs.indexOf(active));
  const prev = tabs[activeIndex - 1];
  const next = tabs[activeIndex + 1];

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gestureState) => {
      const startX = evt.nativeEvent.pageX - gestureState.dx;
      return (
        (!edgeGuard || startX > 32) &&
        Math.abs(gestureState.dx) > 34 &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.45
      );
    },
    onPanResponderMove: (_evt, gestureState) => {
      const maxRight = prev ? width * 0.92 : 32;
      const maxLeft = next ? width * 0.92 : 32;
      dragX.setValue(Math.max(-maxLeft, Math.min(maxRight, gestureState.dx)));
    },
    onPanResponderRelease: (_evt, gestureState) => {
      const canMoveNext = gestureState.dx < 0 && next;
      const canMovePrev = gestureState.dx > 0 && prev;
      const shouldMove = Math.abs(gestureState.dx) >= 72 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.45;

      if (shouldMove && (canMoveNext || canMovePrev)) {
        const target = gestureState.dx < 0 ? -width : width;
        const targetTab = gestureState.dx < 0 ? next : prev;
        Animated.timing(dragX, {
          toValue: target,
          duration: 130,
          useNativeDriver: true,
        }).start(() => {
          dragX.setValue(0);
          if (targetTab) onChange(targetTab);
        });
        return;
      }

      Animated.spring(dragX, {
        toValue: 0,
        useNativeDriver: true,
        speed: 18,
        bounciness: 4,
      }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(dragX, {
        toValue: 0,
        useNativeDriver: true,
        speed: 18,
        bounciness: 4,
      }).start();
    },
  }), [active, dragX, edgeGuard, next, onChange, prev, width]);

  return (
    <View style={styles.wrap} {...panResponder.panHandlers}>
      <Animated.View style={[styles.track, { width: width * 3, transform: [{ translateX: Animated.add(dragX, -width) }] }]}>
        <View style={[styles.page, { width }]}>{prev ? renderTab(prev) : null}</View>
        <View style={[styles.page, { width }]}>{renderTab(active)}</View>
        <View style={[styles.page, { width }]}>{next ? renderTab(next) : null}</View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
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
