import { Platform } from 'react-native';

type WebWheelStepOptions = {
  index: number;
  length: number;
  itemHeight: number;
  lockRef: { current: number };
  onIndexChange: (index: number) => void;
  scrollTo: (offset: number) => void;
};

// PCのホイール操作を候補の移動量へ変換する。
// 小さなトラックパッド操作は1つ、大きなホイール操作は複数候補進める。
export function handleWebWheelStep(event: any, options: WebWheelStepOptions) {
  if (Platform.OS !== 'web') return;

  const deltaY = Number(event?.deltaY ?? event?.nativeEvent?.deltaY ?? 0);
  if (!Number.isFinite(deltaY) || deltaY === 0) return;

  event?.preventDefault?.();
  event?.stopPropagation?.();

  const now = Date.now();
  if (now < options.lockRef.current) return;
  // 同じノッチが短時間に重複通知される場合だけ抑制する。
  // 待ち時間を長くすると連続スクロールまで止まるため短くする。
  options.lockRef.current = now + 24;

  const direction = deltaY > 0 ? 1 : -1;
  const magnitude = Math.abs(deltaY);
  const steps = Math.max(1, Math.min(8, Math.round(magnitude / 100)));
  const nextIndex = Math.max(0, Math.min(options.length - 1, options.index + direction * steps));
  if (nextIndex === options.index) {
    options.scrollTo(nextIndex * options.itemHeight);
    return;
  }

  options.onIndexChange(nextIndex);
  options.scrollTo(nextIndex * options.itemHeight);
}
