import { Platform } from 'react-native';

type WebWheelStepOptions = {
  index: number;
  length: number;
  itemHeight: number;
  lockRef: { current: number };
  onIndexChange: (index: number) => void;
  scrollTo: (offset: number) => void;
};

// PCの1回のホイール操作を、候補1つ分の移動に揃える。
export function handleWebWheelStep(event: any, options: WebWheelStepOptions) {
  if (Platform.OS !== 'web') return;

  const deltaY = Number(event?.deltaY ?? event?.nativeEvent?.deltaY ?? 0);
  if (!Number.isFinite(deltaY) || deltaY === 0) return;

  event?.preventDefault?.();
  event?.stopPropagation?.();

  const now = Date.now();
  if (now < options.lockRef.current) return;
  options.lockRef.current = now + 160;

  const direction = deltaY > 0 ? 1 : -1;
  const nextIndex = Math.max(0, Math.min(options.length - 1, options.index + direction));
  if (nextIndex === options.index) {
    options.scrollTo(nextIndex * options.itemHeight);
    return;
  }

  options.onIndexChange(nextIndex);
  options.scrollTo(nextIndex * options.itemHeight);
}
