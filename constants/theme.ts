export const COLORS = {
  primary: '#00AEB8',
  secondary: '#2D8BE8',
  accent: '#E8F8FA',
  background: '#FFFFFF', // ピュアホワイト
  surface: '#FAFAFA',    // わずかに色付いた白（カード用）
  white: '#FFFFFF',
  text: '#333333',       // 深みのあるグレー（高級感のある黒）
  textLight: '#888888',
  border: '#EAEAEA',
  danger: '#E74C3C',
  success: '#2EAD6B',
  info: '#2D8BE8',
};

export const Colors = {
  light: {
    text: COLORS.text,
    background: COLORS.background,
    tint: COLORS.primary,
    icon: COLORS.textLight,
    tabIconDefault: COLORS.textLight,
    tabIconSelected: COLORS.primary,
  },
  dark: {
    text: COLORS.white,
    background: COLORS.text,
    tint: COLORS.primary,
    icon: COLORS.border,
    tabIconDefault: COLORS.textLight,
    tabIconSelected: COLORS.primary,
  },
};
