import { useMemo, useRef } from 'react';
import { Animated, PanResponder } from 'react-native';

type UseSwipeTabsOptions<T extends string> = {
  tabs: T[];
  active: T;
  onChange: (next: T) => void;
  edgeGuard?: boolean;
};

export function useSwipeTabs<T extends string>({
  tabs,
  active,
  onChange,
  edgeGuard = true,
}: UseSwipeTabsOptions<T>) {
  const translateX = useRef(new Animated.Value(0)).current;

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
      const clamped = Math.max(-82, Math.min(82, gestureState.dx));
      translateX.setValue(clamped);
    },
    onPanResponderRelease: (_evt, gestureState) => {
      const shouldMove = Math.abs(gestureState.dx) >= 72 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.45;
      const currentIndex = tabs.indexOf(active);
      const nextIndex = gestureState.dx < 0 ? currentIndex + 1 : currentIndex - 1;
      const next = tabs[nextIndex];

      if (shouldMove && next) {
        Animated.timing(translateX, {
          toValue: gestureState.dx < 0 ? -120 : 120,
          duration: 105,
          useNativeDriver: true,
        }).start(() => {
          translateX.setValue(0);
          onChange(next);
        });
        return;
      }

      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        speed: 18,
        bounciness: 4,
      }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        speed: 18,
        bounciness: 4,
      }).start();
    },
  }), [active, edgeGuard, onChange, tabs, translateX]);

  return {
    panHandlers: panResponder.panHandlers,
    animatedStyle: {
      transform: [{ translateX }],
    },
  };
}
