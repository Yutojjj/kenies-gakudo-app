export const COLORS = {
  primary: '#D4AF37',    // ゴールド
  secondary: '#B8860B',  // ダークゴールド
  accent: '#F3E5AB',     // シャンパンゴールド
  background: '#FFFFFF', // ピュアホワイト
  surface: '#FAFAFA',    // わずかに色付いた白（カード用）
  white: '#FFFFFF',
  text: '#333333',       // 深みのあるグレー（高級感のある黒）
  textLight: '#888888',
  border: '#EAEAEA',
  danger: '#E74C3C',
  success: '#D4AF37',    // 全体の統一感を出すためサクセスもゴールド系に
  info: '#B8860B',
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
