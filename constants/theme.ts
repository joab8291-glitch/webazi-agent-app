/**
 * Webazi brand theme — light & dark
 * Palette matches the approved "v2" Home mockup (greeting header, hero
 * card, floating pill tab bar).
 */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0B1F17',
    textSecondary: '#5A6B63',
    background: '#F4FAF7',
    surface: '#FFFFFF',
    surfaceAlt: '#E7F5EE',
    tint: '#0C9A63',
    tintDeep: '#0B7F52',
    accent: '#D99A1F',
    icon: '#5A6B63',
    tabIconDefault: '#8A9A92',
    tabIconSelected: '#0C9A63',
    success: '#16A34A',
    warning: '#CA8A04',
    error: '#DC2626',
    border: '#DCEAE2',
    muted: '#93A79C',
    onTint: '#FFFFFF',
  },
  dark: {
    text: '#F1F7F3',
    textSecondary: '#9FB3A8',
    background: '#081712',
    surface: '#102820',
    surfaceAlt: '#1A3B2A',
    tint: '#16C784',
    tintDeep: '#0E9F6E',
    accent: '#F4B942',
    icon: '#9FB3A8',
    tabIconDefault: '#657A6E',
    tabIconSelected: '#16C784',
    success: '#22C55E',
    warning: '#F4B942',
    error: '#F0556B',
    border: '#21402F',
    muted: '#657A6E',
    onTint: '#06150F',
  },
};

/** Gradient stop pairs for LinearGradient — used for the avatar mark,
 * the primary pill CTA, and the active floating-tab-bar pill. */
export const Gradients = {
  light: { tint: ['#0C9A63', '#0B7F52'] as const },
  dark: { tint: ['#16C784', '#0E9F6E'] as const },
};

/** Adds an alpha channel to a 6-digit hex color, e.g. withAlpha('#22C55E', 0.16). */
export function withAlpha(hex: string, alpha: number) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Consistent card elevation across iOS/Android/web. */
export function cardShadow(elevated = true) {
  if (!elevated) return {};
  return Platform.select({
    web: { boxShadow: '0 10px 24px -8px rgba(0,0,0,0.35)' },
    default: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 16,
      elevation: 6,
    },
  });
}

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
