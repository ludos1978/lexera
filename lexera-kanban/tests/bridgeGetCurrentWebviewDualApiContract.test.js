// Pin the dual `getCurrent` / `getCurrentWebview` resolution across
// every shell-side bridge file.
//
// Why this test exists: Tauri 2 ships both API names on
// `__TAURI__.webview` and different builds expose subtly different
// shapes. Files that resolve only one name silently break their
// install path on builds where that one returns null. This bit
// `multiviewClient.js` (commit 1d19e940 / silent cross-view DnD
// failure); the same surface in five sibling bridges + multiviewClient
// is fixed preemptively to forestall the same bug class for theme,
// catalog, navigation, management, and request flows.
//
// Each file MUST attempt both names. The order doesn't matter for
// correctness here (the codebase prefers `getCurrent` first by
// convention, but a future change could swap), so the contract only
// requires both calls are present in the same file.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Files that own a `getCurrentWebview()` helper used by an `install()`
// path. If the helper returns null the install bails — therefore each
// MUST try both Tauri 2 API names.
const BRIDGE_FILES = [
  'shell/multiviewClient.js',
  'shell/bridges/themeBridge.js',
  'shell/bridges/navigationBridge.js',
  'shell/bridges/catalogBridge.js',
  'shell/bridges/managementBridge.js',
  'shell/bridges/requestBridge.js'
];

describe('shell-side bridges — dual `getCurrent` / `getCurrentWebview` resolution', () => {
  it.each(BRIDGE_FILES)('%s references both Tauri 2 webview API names', (relPath) => {
    const src = readFileSync(resolve(srcDir, relPath), 'utf8');
    expect(
      /\.webview\.getCurrent\s*\(/.test(src),
      relPath + ' must call .webview.getCurrent() — single-API fallback caused silent install failure pre-1d19e940'
    ).toBe(true);
    expect(
      /\.webview\.getCurrentWebview\s*\(/.test(src),
      relPath + ' must also call .webview.getCurrentWebview() so builds that only expose the plural form still resolve'
    ).toBe(true);
  });

  it('every bridge file in the allowlist still exists on disk', () => {
    // If a refactor renames or moves a bridge, the test must fail loudly
    // rather than silently skip.
    for (const rel of BRIDGE_FILES) {
      expect(() => readFileSync(resolve(srcDir, rel), 'utf8')).not.toThrow();
    }
  });
});
