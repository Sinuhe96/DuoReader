import { DEFAULT_FONT_ID, normalizeFontId } from './fonts';
import type {
  DisplayMode,
  ReaderPalette,
  ReaderSettings,
  ReaderTheme,
} from './types';

export const SETTINGS_KEY = 'reader';

/** Synchronous copy of the resolved palette, read by the boot shim in index.html. */
export const THEME_HINT_KEY = 'duoreader.theme';

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.5,
  theme: 'system',
  fontFamily: DEFAULT_FONT_ID,
  displayMode: 'sentence',
};

export const THEME_COLORS: Record<ReaderPalette, string> = {
  light: '#faf8f4',
  sepia: '#f1e6d2',
  dark: '#171411',
};

export const THEMES: { id: ReaderTheme; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dark', label: 'Dark' },
];

export const DISPLAY_MODES: { id: DisplayMode; label: string }[] = [
  { id: 'sentence', label: 'Sentence' },
  { id: 'paragraph', label: 'Paragraph' },
];

export function resolveTheme(theme: ReaderTheme, systemIsDark: boolean): ReaderPalette {
  if (theme !== 'system') return theme;
  return systemIsDark ? 'dark' : 'light';
}

function isTheme(value: unknown): value is ReaderTheme {
  return value === 'light' || value === 'sepia' || value === 'dark' || value === 'system';
}

function isDisplayMode(value: unknown): value is DisplayMode {
  return value === 'sentence' || value === 'paragraph';
}

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
    theme: isTheme(theme) ? theme : DEFAULT_SETTINGS.theme,
    fontFamily: normalizeFontId(raw.fontFamily),
    displayMode: isDisplayMode(raw.displayMode)
      ? raw.displayMode
      : DEFAULT_SETTINGS.displayMode,
  };
}
