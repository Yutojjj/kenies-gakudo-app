export type UiSoundType = 'tap' | 'success' | 'back' | 'tick';

type WebAudioContext = AudioContext & { resume: () => Promise<void> };

let audioContext: WebAudioContext | null = null;
const lastPlayed: Record<UiSoundType, number> = { tap: 0, success: 0, back: 0, tick: 0 };
const minIntervals: Record<UiSoundType, number> = { tap: 36, success: 180, back: 90, tick: 34 };

const getAudioContext = () => {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();
  const context = audioContext;
  if (!context) return null;
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context;
};

const addTone = (
  context: WebAudioContext,
  frequency: number,
  delay: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
  endFrequency?: number,
) => {
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.008, duration * 0.25));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
};

export const playUiSound = (type: UiSoundType) => {
  const now = Date.now();
  if (now - lastPlayed[type] < minIntervals[type]) return;
  lastPlayed[type] = now;

  try {
    const context = getAudioContext();
    if (!context) return;
    if (type === 'tap') {
      addTone(context, 880, 0, 0.045, 0.026, 'triangle', 1120);
      addTone(context, 1320, 0.018, 0.035, 0.012, 'sine');
    } else if (type === 'success') {
      addTone(context, 660, 0, 0.11, 0.032, 'triangle');
      addTone(context, 880, 0.07, 0.12, 0.034, 'triangle');
      addTone(context, 1175, 0.14, 0.17, 0.038, 'sine');
    } else if (type === 'back') {
      addTone(context, 540, 0, 0.085, 0.025, 'triangle', 390);
      addTone(context, 330, 0.045, 0.09, 0.018, 'sine', 250);
    } else {
      addTone(context, 1550, 0, 0.018, 0.011, 'square', 1050);
    }
  } catch {
    // Sound must never interrupt the app operation.
  }
};

const actionText = (element: Element) => [
  element.getAttribute('aria-label'),
  element.getAttribute('title'),
  element.textContent,
].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

export const installGlobalUiSounds = () => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};

  const onPointerDown = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('[id^="ui-time-wheel"], [id="ui-sound-none"]')) return;
    const action = target.closest('[role="button"], button, a');
    if (!action || action.getAttribute('aria-disabled') === 'true' || action.hasAttribute('disabled')) return;
    const text = actionText(action);
    if (/削除|消去|取り消し|戻る|閉じる|キャンセル|ログアウト|back|close|trash/i.test(text)) {
      playUiSound('back');
    } else {
      playUiSound('tap');
    }
  };

  const originalAlert = window.alert.bind(window);
  window.alert = ((message?: any) => {
    const text = String(message ?? '');
    if (/保存完了|保存しました|更新完了|登録完了|作成完了|送信完了|完了[:：\s]/.test(text)) {
      playUiSound('success');
    } else if (/削除しました|削除完了/.test(text)) {
      playUiSound('back');
    }
    return originalAlert(message);
  }) as typeof window.alert;

  const successObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        const text = (node.textContent || '').replace(/\s+/g, ' ').slice(0, 300);
        if (/保存完了|保存しました|更新完了|登録完了|作成完了|送信完了/.test(text)) {
          playUiSound('success');
          return;
        }
      }
    }
  });

  document.addEventListener('pointerdown', onPointerDown, true);
  successObserver.observe(document.body, { childList: true, subtree: true });
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    successObserver.disconnect();
    window.alert = originalAlert;
  };
};
