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

describe('LexeraEmbedMenu.tauriListen — per-webview scope', () => {
  it('subscribes with target { kind: WebviewLabel, label } when the webview API is available', async () => {
    const { EmbedMenu, internalsInvoke } = loadEmbedMenu({ webviewLabel: 'kanban-7' });
    await EmbedMenu.tauriListen('menu-action', () => {});
    expect(internalsInvoke).toHaveBeenCalledWith('plugin:event|listen', expect.objectContaining({
      event: 'menu-action',
      target: { kind: 'WebviewLabel', label: 'kanban-7' }
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
      target: { kind: 'WebviewLabel', label: 'main' }
    }));
  });
});
