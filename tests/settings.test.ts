import { describe, expect, it } from 'vitest';
import { DEFAULT_FONT_ID, READER_FONTS } from '../src/reader/fonts';
import { DEFAULT_SETTINGS, normalizeSettings, resolveTheme } from '../src/reader/settings';

describe('reader settings', () => {
  it('defaults missing or malformed values', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ fontSize: Number.NaN, lineHeight: '1.8', theme: 'blue' }))
      .toEqual(DEFAULT_SETTINGS);
  });

  it('clamps and rounds valid values', () => {
    expect(normalizeSettings({ fontSize: 99, lineHeight: 9, theme: 'dark' })).toEqual({
      fontSize: 24,
      lineHeight: 1.9,
      theme: 'dark',
      fontFamily: DEFAULT_FONT_ID,
      displayMode: 'sentence',
      translation: true,
      languageOrder: 'source-first',
    });
    expect(normalizeSettings({ fontSize: 15.4, lineHeight: 1.24, theme: 'sepia' })).toEqual({
      fontSize: 16,
      lineHeight: 1.3,
      theme: 'sepia',
      fontFamily: DEFAULT_FONT_ID,
      displayMode: 'sentence',
      translation: true,
      languageOrder: 'source-first',
    });
  });

  it('keeps a valid in-range setting', () => {
    expect(normalizeSettings({ fontSize: 21, lineHeight: 1.7, theme: 'sepia' })).toEqual({
      fontSize: 21,
      lineHeight: 1.7,
      theme: 'sepia',
      fontFamily: DEFAULT_FONT_ID,
      displayMode: 'sentence',
      translation: true,
      languageOrder: 'source-first',
    });
  });

  it('keeps a catalog font and rejects unknown ones', () => {
    const chosen = READER_FONTS.find((font) => font.id !== DEFAULT_FONT_ID);
    expect(chosen).toBeDefined();
    expect(normalizeSettings({ fontFamily: chosen?.id }).fontFamily).toBe(chosen?.id);
    expect(normalizeSettings({ fontFamily: 'comic-sans' }).fontFamily).toBe(DEFAULT_FONT_ID);
    expect(normalizeSettings({ fontFamily: 42 }).fontFamily).toBe(DEFAULT_FONT_ID);
  });

  it('resolves the system theme from the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('sepia', true)).toBe('sepia');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('accepts the system theme and rejects unknown ones', () => {
    expect(normalizeSettings({ theme: 'system' }).theme).toBe('system');
    expect(normalizeSettings({ theme: 'light' }).theme).toBe('light');
    expect(normalizeSettings({ theme: 'paper' }).theme).toBe('system');
  });

  it('keeps a known display mode and defaults the rest to sentences', () => {
    expect(normalizeSettings({ displayMode: 'paragraph' }).displayMode).toBe('paragraph');
    expect(normalizeSettings({ displayMode: 'sentence' }).displayMode).toBe('sentence');
    expect(normalizeSettings({ displayMode: 'columns' }).displayMode).toBe('sentence');
    expect(normalizeSettings({ displayMode: 7 }).displayMode).toBe('sentence');
  });

  it('defaults translation and language order and rejects unknown values', () => {
    expect(normalizeSettings({}).translation).toBe(true);
    expect(normalizeSettings({}).languageOrder).toBe('source-first');
    expect(normalizeSettings({ translation: false }).translation).toBe(false);
    expect(normalizeSettings({ languageOrder: 'target-first' }).languageOrder).toBe(
      'target-first',
    );
    expect(normalizeSettings({ translation: 'hide' }).translation).toBe(true);
    expect(normalizeSettings({ translation: 0 }).translation).toBe(true);
    expect(normalizeSettings({ languageOrder: 'reverse' }).languageOrder).toBe(
      'source-first',
    );
  });
});
