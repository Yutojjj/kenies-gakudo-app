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
  return audioContext;
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
  try {
    const context = getAudioContext();
    if (!context) return;

    const play = () => {
      const now = Date.now();
      if (now - lastPlayed[type] < minIntervals[type]) return;
      lastPlayed[type] = now;

      if (type === 'tap') {
        addTone(context, 720, 0, 0.06, 0.07, 'triangle', 980);
        addTone(context, 1080, 0.022, 0.045, 0.035, 'sine');
      } else if (type === 'success') {
        addTone(context, 600, 0, 0.12, 0.065, 'triangle');
        addTone(context, 820, 0.075, 0.13, 0.07, 'triangle');
        addTone(context, 1100, 0.15, 0.18, 0.075, 'sine');
      } else if (type === 'back') {
        addTone(context, 520, 0, 0.09, 0.055, 'triangle', 370);
        addTone(context, 320, 0.05, 0.1, 0.04, 'sine', 240);
      } else {
        addTone(context, 1300, 0, 0.024, 0.032, 'square', 900);
      }
    };

    if (context.state === 'suspended') {
      context.resume().then(play).catch(() => {});
    } else {
      play();
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

  let lastInteractionAt = 0;

  const onPointerDown = (event: Event) => {
    const now = Date.now();
    if (event.type === 'click' && now - lastInteractionAt < 700) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('[id^="ui-time-wheel"], [id="ui-sound-none"]')) return;
    const action = target.closest('[role="button"], button, a, [tabindex="0"]');
    if (!action || action.getAttribute('aria-disabled') === 'true' || action.hasAttribute('disabled')) return;
    if (action.matches('input, textarea, select') || action.closest('input, textarea, select')) return;
    lastInteractionAt = now;
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
  document.addEventListener('click', onPointerDown, true);
  successObserver.observe(document.body, { childList: true, subtree: true });
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onPointerDown, true);
    successObserver.disconnect();
    window.alert = originalAlert;
  };
};
