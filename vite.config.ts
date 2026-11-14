import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

import type { BuildInfo } from './src/build-info.ts';

const base = '/DuoReader/';
const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** Run git from the repo root, or null when git or the repository is missing. */
function git(args: readonly string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function packageVersion(): string {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
  );
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    typeof parsed.version !== 'string'
  ) {
    throw new Error('package.json has no string version');
  }
  return parsed.version;
}

/**
 * Computed once when the config loads so dev, tests, and the bundle agree.
 * The build number is the commit count; CI checks out full history for it.
 */
function collectBuildInfo(): BuildInfo {
  const status = git(['status', '--porcelain']);
  const count = Number.parseInt(git(['rev-list', '--count', 'HEAD']) ?? '0', 10);
  return {
    version: packageVersion(),
    build: Number.isFinite(count) && count > 0 ? count : 0,
    commit: git(['rev-parse', '--short', 'HEAD']) ?? 'unknown',
    dirty: status !== null && status !== '',
  };
}

const BUILD_INFO = collectBuildInfo();

/** Emit the same identity beside the bundle so a deployed build can be inspected. */
function buildManifest(info: BuildInfo): Plugin {
  return {
    name: 'duoreader-build-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-manifest.json',
        source: `${JSON.stringify(info, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  base,
  define: {
    __BUILD_INFO__: JSON.stringify(BUILD_INFO),
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        id: base,
        name: 'DuoReader',
        short_name: 'DuoReader',
        description: 'Offline bilingual EPUB reader for BePub sentence pairs.',
        lang: 'en',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        theme_color: '#faf8f4',
        background_color: '#faf8f4',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,webmanifest}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
    buildManifest(BUILD_INFO),
  ],
  server: {
    host: true,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
