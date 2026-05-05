import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function runSource(sandbox, file) {
  vm.runInContext(readFileSync(resolve(srcDir, file), 'utf8'), sandbox, { filename: file });
  ['LexeraPathUtils', 'LexeraPluginRegistry', 'LexeraFileFormatHelpers', 'LexeraFileFormatRegistry', 'LexeraEmbedMenu'].forEach((key) => {
    if (sandbox[key] !== undefined) sandbox.window[key] = sandbox[key];
  });
}

function loadEmbedMenu({ webviewLabel } = {}) {
  const internalsInvoke = vi.fn(() => Promise.resolve(42));
  const tauriInternals = {
    invoke: internalsInvoke,
    transformCallback: (cb) => cb
  };
  const sandbox = {
    window: {},
    globalThis: null,
    document: { createElement: vi.fn(() => ({ innerHTML: '' })) },
    console,
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    encodeURIComponent,
    parseInt,
    isFinite,
    btoa: (value) => Buffer.from(String(value), 'binary').toString('base64')
  };
  sandbox.globalThis = sandbox.window;
  sandbox.window.globalThis = sandbox.window;
  sandbox.window.window = sandbox.window;
  sandbox.window.parent = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.window.__TAURI_INTERNALS__ = tauriInternals;
  sandbox.window.addEventListener = vi.fn();
  sandbox.window.removeEventListener = vi.fn();
  // Per-webview scope: tauriListen should read the current webview's
  // label via __TAURI__.webview.getCurrentWebview().
  if (webviewLabel) {
    sandbox.window.__TAURI__ = {
      webview: { getCurrentWebview: () => ({ label: webviewLabel }) }
    };
  }

  vm.createContext(sandbox);
  ['utils/pathUtils.js', 'plugins/pluginRegistry.js', 'plugins/formats/fileFormatHelpers.js', 'plugins/formats/excalidraw.js', 'plugins/fileFormatRegistry.js', 'menu/embedMenu.js'].forEach((file) => runSource(sandbox, file));

  return { EmbedMenu: sandbox.window.LexeraEmbedMenu, internalsInvoke };
}

// Tauri 2's `EventTarget` enum (tauri/src/event/mod.rs) is serialized
// with `#[serde(tag = "kind")]`. Any kind string outside this set causes
// Rust-side serde deserialization of `plugin:event|listen` to fail, the
// listener is never registered, and every event for this webview is
// silently dropped. The previous code used 'WebviewLabel' (not a valid
// kind), which is what broke the entire native dropdown menu — every
// menu-action emit had no listeners to deliver to.
const VALID_TAURI_EVENT_TARGET_KINDS = new Set([
  'Any', 'AnyLabel', 'App', 'Window', 'Webview', 'WebviewWindow'
]);

describe('LexeraEmbedMenu.tauriListen — per-webview scope', () => {
  it('subscribes with target { kind: Webview, label } when the webview API is available', async () => {
    const { EmbedMenu, internalsInvoke } = loadEmbedMenu({ webviewLabel: 'kanban-7' });
    await EmbedMenu.tauriListen('menu-action', () => {});
    expect(internalsInvoke).toHaveBeenCalledWith('plugin:event|listen', expect.objectContaining({
      event: 'menu-action',
      target: { kind: 'Webview', label: 'kanban-7' }
    }));
  });

  it('falls back to target { kind: Any } when getCurrentWebview is unavailable (boot before webview API)', async () => {
    const { EmbedMenu, internalsInvoke } = loadEmbedMenu({ webviewLabel: null });
    await EmbedMenu.tauriListen('menu-action', () => {});
    expect(internalsInvoke).toHaveBeenCalledWith('plugin:event|listen', expect.objectContaining({
      event: 'menu-action',
      target: { kind: 'Any' }
    }));
  });

  it('uses the main window label for the shell webview', async () => {
    const { EmbedMenu, internalsInvoke } = loadEmbedMenu({ webviewLabel: 'main' });
    await EmbedMenu.tauriListen('catalog-snapshot', () => {});
    expect(internalsInvoke).toHaveBeenCalledWith('plugin:event|listen', expect.objectContaining({
      target: { kind: 'Webview', label: 'main' }
    }));
  });

  it('always uses a kind that is a valid Tauri 2 EventTarget variant', async () => {
    for (const webviewLabel of ['kanban-7', 'main', null]) {
      const { EmbedMenu, internalsInvoke } = loadEmbedMenu({ webviewLabel });
      await EmbedMenu.tauriListen('menu-action', () => {});
      const call = internalsInvoke.mock.calls.find((c) => c[0] === 'plugin:event|listen');
      expect(call, `no plugin:event|listen call for webviewLabel=${webviewLabel}`).toBeTruthy();
      const kind = call[1].target.kind;
      expect(
        VALID_TAURI_EVENT_TARGET_KINDS.has(kind),
        `target.kind="${kind}" is not a valid Tauri 2 EventTarget variant — Rust serde will reject it and the listener will never be registered`
      ).toBe(true);
    }
  });
});
