import { describe, expect, it } from 'vitest';

import packageJson from '../package.json';
import { BUILD_INFO, formatBuildTag, type BuildInfo } from '../src/build-info';

const SAMPLE: BuildInfo = {
  version: '1.2.3',
  build: 41,
  commit: 'abcdef0',
  dirty: false,
};

describe('formatBuildTag', () => {
  it('prints the version, build number, and commit', () => {
    expect(formatBuildTag(SAMPLE)).toBe('v1.2.3 · build 41 · abcdef0');
  });

  it('marks a build made from a dirty tree', () => {
    expect(formatBuildTag({ ...SAMPLE, dirty: true })).toBe('v1.2.3 · build 41+ · abcdef0');
  });
});

describe('BUILD_INFO', () => {
  it('uses the package version and a sensible build identity', () => {
    expect(BUILD_INFO.version).toBe(packageJson.version);
    expect(BUILD_INFO.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number.isInteger(BUILD_INFO.build)).toBe(true);
    expect(BUILD_INFO.build).toBeGreaterThanOrEqual(0);
    expect(BUILD_INFO.commit).not.toBe('');
    expect(typeof BUILD_INFO.dirty).toBe('boolean');
  });
});
