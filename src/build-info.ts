/**
 * Build identity: the app version from `package.json`, the commit-derived build
 * number, the short commit, and whether the tree was dirty at build time.
 *
 * `__BUILD_INFO__` is injected by `vite.config.ts`, so dev, tests, and the built
 * bundle report the same values. Never hand-write version constants elsewhere:
 * they drift from the release that is actually installed.
 */

export interface BuildInfo {
  /** Human version from `package.json`, e.g. `0.2.0`. */
  readonly version: string;
  /** `git rev-list --count HEAD`; 0 when git is unavailable. */
  readonly build: number;
  /** Short commit hash, or `unknown` when git is unavailable. */
  readonly commit: string;
  /** True when the working tree had uncommitted changes at build time. */
  readonly dirty: boolean;
}

declare const __BUILD_INFO__: BuildInfo;

export const BUILD_INFO: BuildInfo = __BUILD_INFO__;

/** The Library tag: `v0.2.0 · build 12 · 4f6fac7`, with `+` for a dirty build. */
export function formatBuildTag(info: BuildInfo): string {
  return `v${info.version} · build ${info.build}${info.dirty ? '+' : ''} · ${info.commit}`;
}
