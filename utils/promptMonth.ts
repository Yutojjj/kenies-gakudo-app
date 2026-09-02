import { Alert, Platform } from 'react-native';

export const promptMonth = (date: Date, onChange: (next: Date) => void) => {
  const initial = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const apply = (value?: string) => {
    const match = String(value || '').trim().match(/^(\d{4})[-\/]?(\d{1,2})$/);
    if (!match) return;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return;
    onChange(new Date(year, month - 1, 1));
  };

  if (Platform.OS === 'web') {
    apply(window.prompt('年月を入力してください（例：2026-09）', initial) || undefined);
    return;
  }
  Alert.prompt('年月を変更', 'YYYY-MM形式で入力してください', apply, 'plain-text', initial);
};
