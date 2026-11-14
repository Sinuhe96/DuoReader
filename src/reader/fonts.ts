import fontCatalog from './fonts.json';

export interface ReaderFont {
  id: string;
  label: string;
  stack: string;
}

// The catalog is data, not code: `fonts.json` can be edited to change the
// picker without touching the reader. Stacks are iOS-first with fallbacks so
// the same ids work in desktop browsers.
export const READER_FONTS: readonly ReaderFont[] = fontCatalog.fonts;

export const DEFAULT_FONT_ID: string =
  READER_FONTS.find((font) => font.id === fontCatalog.default)?.id ?? READER_FONTS[0].id;

export function normalizeFontId(value: unknown): string {
  return READER_FONTS.some((font) => font.id === value) ? (value as string) : DEFAULT_FONT_ID;
}

export function fontStack(id: string): string {
  return (READER_FONTS.find((font) => font.id === id) ?? READER_FONTS[0]).stack;
}
