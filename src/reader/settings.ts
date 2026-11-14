import type { ReaderSettings, ReaderTheme } from './types';

export const SETTINGS_KEY = 'reader';

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.5,
  theme: 'light',
};

export const THEME_COLORS: Record<ReaderTheme, string> = {
  light: '#faf8f4',
  sepia: '#f1e6d2',
  dark: '#171411',
};

export const THEMES: { id: ReaderTheme; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dark', label: 'Dark' },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeSettings(value: unknown): ReaderSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const raw = value as Partial<ReaderSettings>;

  const fontSize = finiteNumber(raw.fontSize);
  const lineHeight = finiteNumber(raw.lineHeight);
  const theme = raw.theme;

  return {
    fontSize: fontSize === undefined ? DEFAULT_SETTINGS.fontSize : clamp(Math.round(fontSize), 16, 24),
    lineHeight:
      lineHeight === undefined
        ? DEFAULT_SETTINGS.lineHeight
        : clamp(Math.round(lineHeight * 10) / 10, 1.3, 1.9),
    theme:
      theme === 'light' || theme === 'sepia' || theme === 'dark'
        ? theme
        : DEFAULT_SETTINGS.theme,
  };
}
