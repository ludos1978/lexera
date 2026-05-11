import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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
  const bridge = loadIIFE('shell/bridges/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('does not request or render embedded board debug geometry overlays', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/index.html?embedded=1&board=board-alpha&pane=tab-1'
    });
    const { window } = dom;
    const invoke = vi.fn(() => Promise.resolve());
    const bridge = loadIIFE('shell/bridges/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
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
        listen: vi.fn()
      }),
      invoke,
      handleRequest: vi.fn()
    });

    expect(installed).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith('multiview_broadcast', expect.objectContaining({
      event: 'debug-geometry-request'
    }));
    expect(window.document.getElementById('lexera-mv-debug-geometry')).toBeNull();
  });

  it('injects a full-height viewport fill override for embedded board views', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/index.html?embedded=1&board=board-alpha&pane=tab-1'
    });
    const { window } = dom;
    const bridge = loadIIFE('shell/bridges/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
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

  it('queues early external DnD events until the kanban DnD API is registered', () => {
    vi.useFakeTimers();
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/index.html?embedded=1&board=board-alpha&pane=tab-1'
    });
    const { window } = dom;
    const handlers = {};
    const bridge = loadIIFE('shell/bridges/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
      window,
      document: window.document,
      URLSearchParams,
      MessageEvent: window.MessageEvent,
      setTimeout,
      clearTimeout,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });

    const installed = bridge.install({
      getCurrentWebview: () => ({
        label: 'board-tab-tab-1',
        listen: vi.fn((eventName, handler) => {
          handlers[eventName] = handler;
        })
      }),
      invoke: vi.fn(() => Promise.resolve()),
      handleRequest: vi.fn()
    });

    expect(installed).toBe(true);
    handlers['external-dnd-hover']({
      payload: {
        payload: { type: 'tree-card', source: { kind: 'card', entityId: 'card-1' } },
        x: 12,
        y: 34
      }
    });

    const hover = vi.fn();
    window.__lexeraExternalDnd = { hover };
    vi.advanceTimersByTime(50);

    expect(hover).toHaveBeenCalledWith(
      { type: 'tree-card', source: { kind: 'card', entityId: 'card-1' } },
      12,
      34
    );
  });

  it('subscribes embedded boards to dashboard navigation broadcasts and reports applied focus', async () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/index.html?embedded=1&board=board-alpha&pane=tab-1'
    });
    const { window } = dom;
    const invoke = vi.fn(() => Promise.resolve());
    const handlers = {};
    const navigateHierarchyTargetInIframe = vi.fn(() => Promise.resolve(true));
    window.LexeraOrderHelpers = { navigateHierarchyTargetInIframe };
    const bridge = loadIIFE('shell/bridges/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
      window,
      document: window.document,
      URLSearchParams,
      MessageEvent: window.MessageEvent,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });
    const received = [];
    window.addEventListener('message', (event) => {
      received.push(event.data);
    });

    const installed = bridge.install({
      getCurrentWebview: () => ({
        label: 'board-tab-tab-1',
        listen: vi.fn((eventName, handler) => {
          handlers[eventName] = handler;
        })
      }),
      invoke,
      handleRequest: vi.fn()
    });

    expect(installed).toBe(true);
    expect(invoke).toHaveBeenCalledWith('multiview_subscribe', {
      label: 'board-tab-tab-1',
      events: [
        'dashboard-navigate',
        'dashboard-board-test-request',
        // Phase 5 cross-view drag forwarding — the shell-side
        // hierarchyDragBridge emits these to the webview the cursor
        // is over, and the kanban-board webview routes them into
        // window.__lexeraExternalDnd.
        'external-dnd-hover',
        'external-dnd-drop',
        // Per-webview cross-view-drag tracking (2026-05-09). Pointer
        // events do NOT cross separate Tauri WKWebView boundaries —
        // each receiver webview compensates by tracking its OWN local
        // pointer while a drag is in flight, routing local coords
        // through __lexeraExternalDnd.hover/drop. See contract test
        // crossViewDragPerWebviewTrackingContract.test.js.
        'hierarchy-entity-drag-start',
        'cross-view-drag-handled',
        // Stage 13 follow-up (2026-05-10): destination kanban needs
        // an explicit reload trigger now that the legacy
        // relayExternalDnd('drop') local-mutation path is skipped on
        // a successful broadcast. Subscribing to the shell's
        // post-saveBoard hierarchy-board-changed broadcast lets the
        // bridge dispatch a `lexera-hierarchy-board-changed` message
        // into app.js so the active board reloads automatically.
        'hierarchy-board-changed',
        // 2026-05-11 follow-up: workspace tree burger-menu items
        // broadcast their action via this event; the kanban frame's
        // app.js dispatches through ActionRegistry.
        'hierarchy-entity-menu-action'
      ]
    });
    expect(typeof handlers['dashboard-navigate']).toBe('function');

    handlers['dashboard-navigate']({
      payload: {
        nav: {
          boardId: 'board-alpha',
          cardId: 'card-1'
        }
      }
    });

    expect(navigateHierarchyTargetInIframe).toHaveBeenCalledWith({
      boardId: 'board-alpha',
      cardId: 'card-1'
    });
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', {
      event: 'dashboard-focus-applied',
      payload: {
        nav: {
          boardId: 'board-alpha',
          cardId: 'card-1'
        },
        focused: true,
        label: 'board-tab-tab-1'
      }
    });
    expect(received).toEqual([]);
  });

  it('relays external-dnd-hover to window.__lexeraExternalDnd.hover with payload + coords', async () => {
    // Stage 5 of the cross-view DnD chain: when the shell's
    // hierarchyDragBridge emits external-dnd-hover/drop to a board
    // webview, embeddedBoardBridge MUST translate that into a
    // window.__lexeraExternalDnd.{hover,drop}(payload, x, y) call.
    // Without this assertion the relay can silently break (e.g. if
    // the listener is registered but the handler arg-shape changes)
    // and "drag from workspace to board" stops working with no
    // outward sign in JS — exactly the user-reported failure mode.
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/index.html?embedded=1&board=board-alpha&pane=tab-1'
    });
    const { window } = dom;
    const handlers = {};
    const hoverFn = vi.fn();
    const dropFn = vi.fn();
    window.__lexeraExternalDnd = { hover: hoverFn, drop: dropFn };
    const bridge = loadIIFE('shell/bridges/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
      window,
      document: window.document,
      URLSearchParams,
      MessageEvent: window.MessageEvent,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });
    bridge.install({
      getCurrentWebview: () => ({
        label: 'board-tab-tab-1',
        listen: vi.fn((eventName, handler) => { handlers[eventName] = handler; })
      }),
      invoke: vi.fn(() => Promise.resolve()),
      handleRequest: vi.fn()
    });

    expect(typeof handlers['external-dnd-hover']).toBe('function');
    expect(typeof handlers['external-dnd-drop']).toBe('function');

    // Fire a hover event with the payload-shape the shell emits:
    //   payload: { payload: { source, type }, x, y }
    handlers['external-dnd-hover']({
      payload: {
        payload: { source: { boardId: 'b1', kind: 'card', entityId: 'card-1' }, type: 'tree-card' },
        x: 50,
        y: 75
      }
    });
    expect(hoverFn).toHaveBeenCalledTimes(1);
    expect(hoverFn).toHaveBeenCalledWith(
      { source: { boardId: 'b1', kind: 'card', entityId: 'card-1' }, type: 'tree-card' },
      50,
      75
    );

    // And a drop:
    handlers['external-dnd-drop']({
      payload: {
        payload: { source: { boardId: 'b1', kind: 'row', entityId: 'r1' }, type: 'tree-row' },
        x: 100,
        y: 200
      }
    });
    expect(dropFn).toHaveBeenCalledTimes(1);
    expect(dropFn).toHaveBeenCalledWith(
      { source: { boardId: 'b1', kind: 'row', entityId: 'r1' }, type: 'tree-row' },
      100,
      200
    );
  });

  it('resolves a cross-view card drop on a column header as column absorb', async () => {
    const dom = new JSDOM(
      '<!doctype html><html><head></head><body>' +
      '<div id="columns-container">' +
      '<div class="column" data-column-id="col-1">' +
      '<div class="column-header">Backlog</div>' +
      '<div class="column-cards" data-col-index="0" data-column-id="col-1">' +
      '<div class="card" data-card-id="card-existing" data-card-kid="kid-existing"></div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</body></html>',
      { url: 'http://127.0.0.1:1431/index.html?embedded=1&board=board-alpha&pane=tab-1' }
    );
    const { window } = dom;
    const handlers = {};
    const dropFn = vi.fn();
    const invoke = vi.fn(() => Promise.resolve());
    const header = window.document.querySelector('.column-header');
    window.document.elementFromPoint = vi.fn(() => header);
    window.LexeraDashboard = { getActiveBoardId: () => 'board-alpha' };
    window.__lexeraExternalDnd = { drop: dropFn };
    const bridge = loadIIFE('shell/bridges/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
      window,
      document: window.document,
      URLSearchParams,
      MessageEvent: window.MessageEvent,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });
    bridge.install({
      getCurrentWebview: () => ({
        label: 'board-tab-tab-1',
        listen: vi.fn((eventName, handler) => { handlers[eventName] = handler; })
      }),
      invoke,
      handleRequest: vi.fn()
    });

    const source = { boardId: 'source-board', kind: 'card', entityId: 'card-source' };
    handlers['external-dnd-drop']({
      payload: {
        payload: { source, type: 'tree-card' },
        x: 50,
        y: 20
      }
    });

    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', {
      event: 'hierarchy-entity-drop',
      payload: {
        source,
        target: { boardId: 'board-alpha', kind: 'column', entityId: 'col-1' }
      }
    });
    expect(dropFn).not.toHaveBeenCalled();
  });

  it('logs receive.no-handler when window.__lexeraExternalDnd is missing at relay time', () => {
    // Same external-dnd-hover firing path, but the receiver hasn't
    // installed __lexeraExternalDnd yet. The bridge must NOT throw
    // and MUST surface a [xview-dnd] log line so the user can see
    // in the in-app Log panel that the receiver isn't ready.
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/index.html?embedded=1&board=board-alpha&pane=tab-1'
    });
    const { window } = dom;
    const lexeraLog = vi.fn();
    window.lexeraLog = lexeraLog;
    const handlers = {};
    const bridge = loadIIFE('shell/bridges/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
      window,
      document: window.document,
      URLSearchParams,
      MessageEvent: window.MessageEvent,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });
    bridge.install({
      getCurrentWebview: () => ({
        label: 'board-tab-tab-1',
        listen: vi.fn((eventName, handler) => { handlers[eventName] = handler; })
      }),
      invoke: vi.fn(() => Promise.resolve()),
      handleRequest: vi.fn()
    });

    // No throw expected.
    expect(() => {
      handlers['external-dnd-drop']({
        payload: { payload: { source: {}, type: 'tree-card' }, x: 0, y: 0 }
      });
    }).not.toThrow();

    // Diagnostic log fired so the user knows stage 5 receiver is missing.
    // Two log lines fire on each external-dnd-drop now (after the
    // 2026-05-09 destination-side persistence fix): one for the
    // tree-target resolution attempt (`receive.drop.tree-target`),
    // and the legacy relay's `receive.no-handler` when
    // `__lexeraExternalDnd` is missing. Assert that `receive.no-handler`
    // appears anywhere in the log, not necessarily first.
    const xviewCalls = lexeraLog.mock.calls.filter((c) => /\[xview-dnd\]/.test(String(c[1])));
    expect(xviewCalls.length).toBeGreaterThan(0);
    const hasNoHandler = xviewCalls.some((c) => /receive\.no-handler/.test(String(c[1])));
    expect(hasNoHandler).toBe(true);
  });

  it('falls back to focusing a rendered card when dashboard navigation helper returns false', async () => {
    const dom = new JSDOM(
      '<!doctype html><html><head></head><body>' +
      '<div id="columns-container">' +
      '<div class="card focused" data-card-id="card-old"></div>' +
      '<div class="card" data-card-id="card-1" data-col-index="1" data-card-index="2"></div>' +
      '</div>' +
      '</body></html>',
      { url: 'http://127.0.0.1:1431/index.html?embedded=1&board=board-alpha&pane=tab-1' }
    );
    const { window } = dom;
    const invoke = vi.fn(() => Promise.resolve());
    const handlers = {};
    const navigateHierarchyTargetInIframe = vi.fn(() => Promise.resolve(false));
    window.LexeraOrderHelpers = { navigateHierarchyTargetInIframe };
    const bridge = loadIIFE('shell/bridges/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
      window,
      document: window.document,
      URLSearchParams,
      MessageEvent: window.MessageEvent,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });

    expect(bridge.install({
      getCurrentWebview: () => ({
        label: 'board-tab-tab-1',
        listen: vi.fn((eventName, handler) => {
          handlers[eventName] = handler;
        })
      }),
      invoke,
      handleRequest: vi.fn()
    })).toBe(true);

    handlers['dashboard-navigate']({
      payload: {
        nav: {
          boardId: 'board-alpha',
          cardId: 'card-1'
        }
      }
    });

    await Promise.resolve();
    expect(window.document.querySelector('[data-card-id="card-1"]')?.classList.contains('focused')).toBe(true);
    expect(window.document.querySelector('[data-card-id="card-old"]')?.classList.contains('focused')).toBe(false);
    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', {
      event: 'dashboard-focus-applied',
      payload: {
        nav: {
          boardId: 'board-alpha',
          cardId: 'card-1'
        },
        focused: true,
        label: 'board-tab-tab-1'
      }
    });
  });

  it('answers dashboard board test requests from the embedded board data', async () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/index.html?embedded=1&board=board-alpha&pane=tab-1'
    });
    const { window } = dom;
    const invoke = vi.fn(() => Promise.resolve());
    const handlers = {};
    window.LexeraTestApi = {
      getActiveBoardId: () => 'board-alpha',
      getFullBoardData: () => ({
        rows: [{
          id: 'row-1',
          stacks: [{
            id: 'stack-1',
            columns: [{
              id: 'col-1',
              title: 'Column 1',
              cards: [{ id: 'card-1', kid: 'card-1', content: 'Card One\nbody' }]
            }]
          }]
        }]
      })
    };
    const bridge = loadIIFE('shell/bridges/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
      window,
      document: window.document,
      URLSearchParams,
      MessageEvent: window.MessageEvent,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });

    expect(bridge.install({
      getCurrentWebview: () => ({
        label: 'board-tab-tab-1',
        listen: vi.fn((eventName, handler) => {
          handlers[eventName] = handler;
        })
      }),
      invoke,
      handleRequest: vi.fn()
    })).toBe(true);

    handlers['dashboard-board-test-request']({
      payload: {
        action: 'first-visible-card',
        requestId: 'req-1'
      }
    });

    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', {
      event: 'dashboard-board-test-response',
      payload: {
        requestId: 'req-1',
        result: {
          action: 'first-visible-card',
          ok: true,
          card: {
            boardId: 'board-alpha',
            rowId: 'row-1',
            stackId: 'stack-1',
            columnId: 'col-1',
            cardId: 'card-1',
            rowIndex: 0,
            stackIndex: 0,
            colLocalIndex: 0,
            columnIndex: 0,
            cardIndex: 0,
            columnTitle: 'Column 1',
            title: 'Card One'
          }
        }
      }
    });
  });

  it('prefers a rendered DOM card for dashboard board test requests', async () => {
    const dom = new JSDOM(
      '<!doctype html><html><head></head><body>' +
      '<div id="columns-container">' +
      '<div class="card" data-card-id="dom-card-1" data-col-index="2" data-card-index="3">' +
      '<span class="card-title-display">Rendered Card</span>' +
      '</div>' +
      '</div>' +
      '</body></html>',
      { url: 'http://127.0.0.1:1431/index.html?embedded=1&board=board-alpha&pane=tab-1' }
    );
    const { window } = dom;
    const invoke = vi.fn(() => Promise.resolve());
    const handlers = {};
    window.LexeraTestApi = {
      getActiveBoardId: () => 'board-alpha',
      getFullBoardData: () => ({ rows: [] })
    };
    const bridge = loadIIFE('shell/bridges/embeddedBoardBridge.js', 'window.LexeraEmbeddedBoardBridge', {
      window,
      document: window.document,
      URLSearchParams,
      MessageEvent: window.MessageEvent,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });

    expect(bridge.install({
      getCurrentWebview: () => ({
        label: 'board-tab-tab-1',
        listen: vi.fn((eventName, handler) => {
          handlers[eventName] = handler;
        })
      }),
      invoke,
      handleRequest: vi.fn()
    })).toBe(true);

    handlers['dashboard-board-test-request']({
      payload: {
        action: 'first-visible-card',
        requestId: 'req-dom'
      }
    });

    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', {
      event: 'dashboard-board-test-response',
      payload: {
        requestId: 'req-dom',
        result: {
          action: 'first-visible-card',
          ok: true,
          card: {
            boardId: 'board-alpha',
            rowId: '',
            stackId: '',
            columnId: '',
            cardId: 'dom-card-1',
            rowIndex: null,
            stackIndex: null,
            colLocalIndex: null,
            columnIndex: 2,
            cardIndex: 3,
            columnTitle: '',
            title: 'Rendered Card'
          }
        }
      }
    });
  });
});
