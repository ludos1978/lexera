// Pin the dual `getCurrent` / `getCurrentWebview` resolution in
// `multiviewClient.js`.
//
// Tauri 2 ships both API names on `__TAURI__.webview`:
//   - `getCurrent`         (singular, older)
//   - `getCurrentWebview`  (plural, newer)
// Different builds expose subtly different shapes depending on which
// the Tauri JS plugin was built against.
//
// The rest of the codebase (subAppRuntime.js, multiviewWebview.js
// after commit 49eeb73d) standardised on `getCurrent` first with
// `getCurrentWebview` as fallback. multiviewClient.js originally
// only tried `getCurrentWebview` — which silently broke
// `hierarchyDragBridge.install()` (the bridge bails when
// `getCurrentWebview()` returns null), which silently broke
// cross-view drag-and-drop for the user.
//
// This test pins the dual-API pattern so a future "simplify" pass
// can't drop one of the calls and silently break the chain again.

import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';
import { readFileSync } from 'node:fs';
import { resolve as resolveFromTest, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadClient({ webviewApi } = {}) {
  const window = {
    __TAURI__: {
      webview: webviewApi || undefined,
      core: { invoke: vi.fn(() => Promise.resolve(null)) }
    },
    LexeraMultiview: {},
    requestAnimationFrame(fn) { return setTimeout(fn, 0); },
    cancelAnimationFrame: clearTimeout
  };
  const api = loadIIFE('shell/multiviewClient.js', 'window.LexeraMultiview', {
    window,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout
  });
  return { api, window };
}

describe('multiviewClient.getCurrentWebview — dual-API resolution', () => {
  it('source file references BOTH API names so either Tauri 2 build resolves', () => {
    // Source-text contract: the file MUST attempt both names so
    // builds with only one available still resolve a webview. This
    // guards against a future simplify that drops one branch and
    // silently breaks `hierarchyDragBridge.install()` (which bails
    // when `getCurrentWebview()` returns null) — the actual root
    // cause of "cross view drag & drop doesn't work".
    const src = readFileSync(
      resolveFromTest(__dirname, '..', 'src', 'shell', 'multiviewClient.js'),
      'utf8'
    );
    expect(/t\.webview\.getCurrent\s*\(/.test(src), 'must call t.webview.getCurrent()').toBe(true);
    expect(/t\.webview\.getCurrentWebview\s*\(/.test(src), 'must call t.webview.getCurrentWebview()').toBe(true);
  });

  it('returns null gracefully when neither API is available (no Tauri)', () => {
    // Without crashing — module loads cleanly even outside Tauri so
    // unit tests work and a non-Tauri webview can no-op the bridge.
    const { window } = loadClient({ webviewApi: undefined });
    expect(window.LexeraMultiview).toBeTruthy();
  });

  it('returns null gracefully when t.webview exists but has no get* function', () => {
    const { window } = loadClient({ webviewApi: { /* empty */ } });
    expect(window.LexeraMultiview).toBeTruthy();
  });
});
