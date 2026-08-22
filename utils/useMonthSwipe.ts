import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';

type UseMonthSwipeOptions = {
  onMoveMonth: (amount: -1 | 1) => void;
};

export function useMonthSwipe({ onMoveMonth }: UseMonthSwipeOptions) {
  const onMoveMonthRef = useRef(onMoveMonth);
  onMoveMonthRef.current = onMoveMonth;

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => (
      Math.abs(gesture.dx) > 12 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2
    ),
    onPanResponderRelease: (_event, gesture) => {
      const isHorizontal = Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2;
      const shouldMove = Math.abs(gesture.dx) >= 38 || Math.abs(gesture.vx) >= 0.28;
      if (!isHorizontal || !shouldMove) return;
      onMoveMonthRef.current(gesture.dx < 0 ? 1 : -1);
    },
  }), []);

  return panResponder.panHandlers;
}
