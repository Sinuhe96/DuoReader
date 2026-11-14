import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/reader/settings';

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
    });
    expect(normalizeSettings({ fontSize: 15.4, lineHeight: 1.24, theme: 'sepia' })).toEqual({
      fontSize: 16,
      lineHeight: 1.3,
      theme: 'sepia',
    });
  });

  it('keeps a valid in-range setting', () => {
    expect(normalizeSettings({ fontSize: 21, lineHeight: 1.7, theme: 'sepia' })).toEqual({
      fontSize: 21,
      lineHeight: 1.7,
      theme: 'sepia',
    });
  });
});
