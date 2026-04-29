import { describe, expect, it, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { loadIIFE } from './load-iife.js';

function freshBridge(locationSearch = '') {
  // The bridge reads window.location.search, so build a minimal window
  // shim with the requested search string. document is also referenced
  // by injectFillStyles, which only runs inside install() — irrelevant
  // for the URL-detection tests.
  const win = {
    location: { search: locationSearch }
  };
  const bridge = loadIIFE('shell/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
    window: win,
    document: { getElementById: () => null, head: { appendChild: () => {} }, createElement: () => ({}) }
  });
  return { bridge, win };
}

describe('LexeraEmbeddedBoardBridge.isEmbeddedKanban', () => {
  it('returns true when ?embedded=1', () => {
    const { bridge } = freshBridge('?embedded=1');
    expect(bridge.isEmbeddedKanban()).toBe(true);
  });

  it('returns false without the embedded flag', () => {
    const { bridge } = freshBridge('?board=alpha');
    expect(bridge.isEmbeddedKanban()).toBe(false);
  });

  it('returns false on empty search', () => {
    const { bridge } = freshBridge('');
    expect(bridge.isEmbeddedKanban()).toBe(false);
  });

  it('returns false when embedded is something other than 1', () => {
    const { bridge } = freshBridge('?embedded=0');
    expect(bridge.isEmbeddedKanban()).toBe(false);
    const b2 = freshBridge('?embedded=true').bridge;
    expect(b2.isEmbeddedKanban()).toBe(false);
  });
});

describe('LexeraEmbeddedBoardBridge.shortcutForKeydownEvent', () => {
  let bridge;
  beforeEach(() => {
    bridge = freshBridge().bridge;
  });

  it('maps Ctrl+Alt+L → open-log-view', () => {
    expect(bridge.shortcutForKeydownEvent({ ctrlKey: true, altKey: true, key: 'L' })).toBe('open-log-view');
  });

  it('maps Meta+Alt+L → open-log-view (mac variant)', () => {
    expect(bridge.shortcutForKeydownEvent({ metaKey: true, altKey: true, key: 'L' })).toBe('open-log-view');
  });

  it('lowercases single-key inputs', () => {
    expect(bridge.shortcutForKeydownEvent({ ctrlKey: true, altKey: true, key: 'i' })).toBe('open-inspector');
  });

  it('maps Ctrl+Alt+W → open-workspaces', () => {
    expect(bridge.shortcutForKeydownEvent({ ctrlKey: true, altKey: true, key: 'W' })).toBe('open-workspaces');
  });

  it('maps Ctrl+Alt+D → open-dashboard', () => {
    expect(bridge.shortcutForKeydownEvent({ ctrlKey: true, altKey: true, key: 'D' })).toBe('open-dashboard');
  });

  it('returns null for unmapped combos', () => {
    expect(bridge.shortcutForKeydownEvent({ ctrlKey: true, altKey: true, key: 'X' })).toBe(null);
    expect(bridge.shortcutForKeydownEvent({ ctrlKey: true, key: 'L' })).toBe(null);  // no Alt
    expect(bridge.shortcutForKeydownEvent({ key: 'L' })).toBe(null);
  });
});

describe('LexeraEmbeddedBoardBridge.install', () => {
  it('returns false when the URL does not mark this as embedded', () => {
    const { bridge } = freshBridge('?board=alpha');
    expect(bridge.install({})).toBe(false);
  });

  it('returns false when getCurrentWebview is missing', () => {
    const { bridge } = freshBridge('?embedded=1');
    expect(bridge.install({ invoke: () => Promise.resolve() })).toBe(false);
  });

  it('returns false when invoke is missing', () => {
    const { bridge } = freshBridge('?embedded=1');
    expect(bridge.install({ getCurrentWebview: () => ({}) })).toBe(false);
  });

  it('returns false when getCurrentWebview returns no listenable webview', () => {
    const { bridge } = freshBridge('?embedded=1');
    expect(bridge.install({
      getCurrentWebview: () => null,
      invoke: () => Promise.resolve()
    })).toBe(false);
  });

  it('renders a top-left debug geometry overlay for embedded board views', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/index.html?embedded=1&board=board-alpha&pane=tab-1'
    });
    const { window } = dom;
    const listeners = {};
    const invoke = vi.fn(() => Promise.resolve());
    const bridge = loadIIFE('shell/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
      window,
      document: window.document,
      URLSearchParams,
      MessageEvent: window.MessageEvent,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });

    const installed = bridge.install({
      getCurrentWebview: () => ({
        label: 'board-tab-tab-1',
        listen: vi.fn((eventName, handler) => {
          listeners[eventName] = handler;
        })
      }),
      invoke,
      handleRequest: vi.fn()
    });

    expect(installed).toBe(true);
    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', {
      event: 'debug-geometry-request',
      payload: { label: 'board-tab-tab-1' }
    });
    listeners['debug-geometry']({
      payload: {
        label: 'board-tab-tab-1',
        boardId: 'board-alpha',
        adjust: { x: 0, y: 0, width: 0, height: 0 },
        shell: { x: 300.4, y: 41.2, width: 912.9, height: 620.1 },
        native: { x: 300.4, y: 41.2, width: 912.9, height: 620.1 }
      }
    });

    const overlay = window.document.getElementById('lexera-mv-debug-geometry');
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain('board board-alpha');
    expect(overlay?.textContent).toContain('native 300,41 913x620');
    expect(overlay?.textContent).toContain('shell  300,41 913x620');
    expect(overlay?.textContent).toContain('delta  0,0 0x0');

    const minusButtons = overlay?.querySelectorAll('button') || [];
    minusButtons[0]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', {
      event: 'debug-geometry-adjust',
      payload: {
        label: 'board-tab-tab-1',
        field: 'x',
        delta: -1
      }
    });
  });

  it('injects a full-height viewport fill override for embedded board views', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/index.html?embedded=1&board=board-alpha&pane=tab-1'
    });
    const { window } = dom;
    const bridge = loadIIFE('shell/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
      window,
      document: window.document,
      URLSearchParams,
      MessageEvent: window.MessageEvent,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });

    const installed = bridge.install({
      getCurrentWebview: () => ({
        label: 'board-tab-tab-1',
        listen: vi.fn(() => {})
      }),
      invoke: vi.fn(() => Promise.resolve()),
      handleRequest: vi.fn()
    });

    expect(installed).toBe(true);
    const styleEl = window.document.getElementById('lexera-mv-embed-fill-styles');
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).toContain('html, body { width: 100%; height: 100%; min-height: 100%;');
    expect(styleEl?.textContent).toContain('overflow: hidden;');
  });
});
