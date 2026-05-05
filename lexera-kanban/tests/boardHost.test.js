import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadWithWindow(windowOverrides = {}) {
  return loadIIFE(
    ['workspace/layoutTree.js', 'workspace/boardHost.js'],
    'window.LexeraBoardHost',
    { window: windowOverrides }
  );
}

const boardHost = loadWithWindow();

function tabsetNode(id, tabs, activeTabId) {
  return {
    type: 'tabs',
    id,
    tabs,
    activeTabId: activeTabId == null ? (tabs[0] && tabs[0].id) || '' : activeTabId
  };
}

function boardTab(id, boardId, viewKind) {
  return { id, kind: 'board', boardId, viewKind: viewKind || 'kanban' };
}

function fakeElement(overrides = {}) {
  const classes = new Set(overrides.classList || []);
  const children = [];
  return {
    children,
    parentNode: overrides.parentNode || { /* offscreen ancestor */ },
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name)
    },
    appendChild(child) {
      children.push(child);
      return child;
    },
    querySelector(selector) {
      if (selector === '.mv-health-dot') {
        return children.find((c) => c.className === 'mv-health-dot') || null;
      }
      return null;
    },
    getBoundingClientRect: overrides.getBoundingClientRect || (() => ({
      left: 10, top: 20, width: 100, height: 50
    })),
    get offsetParent() {
      return overrides.offsetParent === undefined ? this.parentNode : overrides.offsetParent;
    }
  };
}

function fakeDoc() {
  return {
    createElement: (tag) => ({
      tagName: String(tag).toUpperCase(),
      className: '',
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
      }
    })
  };
}

describe('LexeraBoardHost.getFrameWindowForBoard', () => {
  it('returns null when boardId is empty', () => {
    expect(boardHost.getFrameWindowForBoard(tabsetNode('A', []), {}, '')).toBe(null);
    expect(boardHost.getFrameWindowForBoard(tabsetNode('A', []), {}, null)).toBe(null);
  });

  it('returns null when no tab matches the board', () => {
    const tree = tabsetNode('A', [boardTab('t1', 'alpha')]);
    expect(boardHost.getFrameWindowForBoard(tree, {}, 'beta')).toBe(null);
  });

  it('returns null when frameCache lacks an entry for the matching tab', () => {
    const tree = tabsetNode('A', [boardTab('t1', 'alpha')]);
    expect(boardHost.getFrameWindowForBoard(tree, {}, 'alpha')).toBe(null);
  });

  it('returns null when the cached frame has no contentWindow', () => {
    const tree = tabsetNode('A', [boardTab('t1', 'alpha')]);
    const frameCache = { t1: { /* no contentWindow */ } };
    expect(boardHost.getFrameWindowForBoard(tree, frameCache, 'alpha')).toBe(null);
  });

  it('returns the matching tab\'s contentWindow', () => {
    const tree = tabsetNode('A', [boardTab('t1', 'alpha')]);
    const frameWin = { postMessage() {} };
    const frameCache = { t1: { contentWindow: frameWin } };
    expect(boardHost.getFrameWindowForBoard(tree, frameCache, 'alpha')).toBe(frameWin);
  });

  it('matches any viewKind for the same boardId (delegation contract)', () => {
    const tree = tabsetNode('A', [boardTab('t1', 'alpha', 'canvas')]);
    const frameWin = { postMessage() {} };
    const frameCache = { t1: { contentWindow: frameWin } };
    expect(boardHost.getFrameWindowForBoard(tree, frameCache, 'alpha')).toBe(frameWin);
  });

  it('ignores panel tabs when matching by boardId', () => {
    const panelTab = { id: 'p1', kind: 'panel', panelId: 'logs' };
    const tree = tabsetNode('A', [panelTab]);
    expect(boardHost.getFrameWindowForBoard(tree, {}, 'alpha')).toBe(null);
  });

  it('tolerates a null/undefined frameCache', () => {
    const tree = tabsetNode('A', [boardTab('t1', 'alpha')]);
    expect(boardHost.getFrameWindowForBoard(tree, null, 'alpha')).toBe(null);
    expect(boardHost.getFrameWindowForBoard(tree, undefined, 'alpha')).toBe(null);
  });
});

describe('LexeraBoardHost.getEmbeddedUrlForTab', () => {
  const origin = 'http://127.0.0.1:1431/index.html';

  it('returns empty string for panel tabs', () => {
    const tab = { id: 'p1', kind: 'panel', panelId: 'logs' };
    expect(boardHost.getEmbeddedUrlForTab(tab, origin)).toBe('');
  });

  it('builds an embedded url with required search params', () => {
    const tab = { id: 't1', kind: 'board', boardId: 'alpha', viewKind: 'kanban' };
    const result = new URL(boardHost.getEmbeddedUrlForTab(tab, origin));
    expect(result.searchParams.get('embedded')).toBe('1');
    expect(result.searchParams.get('workspaceShell')).toBe('0');
    expect(result.searchParams.get('workspaceShellParent')).toBe('1');
    expect(result.searchParams.get('pane')).toBe('t1');
    expect(result.searchParams.get('board')).toBe('alpha');
    expect(result.searchParams.get('view')).toBe('kanban');
  });

  it('omits view param for default viewKind', () => {
    const tab = { id: 't1', kind: 'board', boardId: 'alpha', viewKind: 'default' };
    const result = new URL(boardHost.getEmbeddedUrlForTab(tab, origin));
    expect(result.searchParams.has('view')).toBe(false);
  });

  it('omits board param when boardId is empty', () => {
    const tab = { id: 't1', kind: 'board', boardId: '', viewKind: 'kanban' };
    const result = new URL(boardHost.getEmbeddedUrlForTab(tab, origin));
    expect(result.searchParams.has('board')).toBe(false);
  });

  it('strips any preexisting query/hash from the host url', () => {
    const dirtyOrigin = 'http://127.0.0.1:1431/index.html?stale=1#frag';
    const tab = { id: 't1', kind: 'board', boardId: 'alpha', viewKind: 'kanban' };
    const result = new URL(boardHost.getEmbeddedUrlForTab(tab, dirtyOrigin));
    expect(result.searchParams.has('stale')).toBe(false);
    expect(result.hash).toBe('');
  });

  it('assigns the child window label and preserves the host shell label', () => {
    const originWithWindowLabel = 'http://127.0.0.1:1431/index.html?windowLabel=workspace-2';
    const tab = { id: 't1', kind: 'board', boardId: 'alpha', viewKind: 'kanban' };
    const result = new URL(boardHost.getEmbeddedUrlForTab(tab, originWithWindowLabel));
    expect(result.searchParams.get('windowLabel')).toBe('board-tab-t1');
    expect(result.searchParams.get('workspaceShellHostLabel')).toBe('workspace-2');
  });

  it('defaults the host shell label to main when the parent url has none', () => {
    const tab = { id: 't1', kind: 'board', boardId: 'alpha', viewKind: 'kanban' };
    const result = new URL(boardHost.getEmbeddedUrlForTab(tab, origin));
    expect(result.searchParams.get('windowLabel')).toBe('board-tab-t1');
    expect(result.searchParams.get('workspaceShellHostLabel')).toBe('main');
  });
});

describe('LexeraBoardHost.multiviewUrlForTab', () => {
  it('strips scheme + host from absolute urls', () => {
    expect(boardHost.multiviewUrlForTab('http://127.0.0.1:1431/index.html?embedded=1&board=x'))
      .toBe('index.html?embedded=1&board=x');
  });

  it('preserves the fragment', () => {
    expect(boardHost.multiviewUrlForTab('http://127.0.0.1:1431/index.html?board=x#anchor'))
      .toBe('index.html?board=x#anchor');
  });

  it('returns the input unchanged when not parseable as URL', () => {
    expect(boardHost.multiviewUrlForTab('not-a-url')).toBe('not-a-url');
  });

  it('returns the input unchanged when falsy', () => {
    expect(boardHost.multiviewUrlForTab('')).toBe('');
    expect(boardHost.multiviewUrlForTab(null)).toBe(null);
    expect(boardHost.multiviewUrlForTab(undefined)).toBe(undefined);
  });

  it('falls back to index.html when the path is empty', () => {
    expect(boardHost.multiviewUrlForTab('http://127.0.0.1:1431/')).toBe('index.html');
  });
});

describe('LexeraBoardHost.multiviewLabelForTab', () => {
  it('prefixes the tab id', () => {
    expect(boardHost.multiviewLabelForTab('abc')).toBe('board-tab-abc');
  });

  it('coerces non-string ids', () => {
    expect(boardHost.multiviewLabelForTab(42)).toBe('board-tab-42');
    expect(boardHost.multiviewLabelForTab(null)).toBe('board-tab-null');
  });

  it('once setup({ bootId }) is called, includes the bootId in the label so two windows do NOT collide on Tauri\'s global webview registry', () => {
    boardHost.setup({ bootId: 'kfo3p2j-abc12' });
    expect(boardHost.multiviewLabelForTab('tab-7')).toBe('board-tab-kfo3p2j-abc12-tab-7');
    // Reset so subsequent describe blocks don't see the bootId.
    boardHost.setup({ bootId: '' });
  });
});

describe('LexeraBoardHost.tabIdFromBoardLabel', () => {
  it('strips the legacy unprefixed format', () => {
    boardHost.setup({ bootId: '' });
    expect(boardHost.tabIdFromBoardLabel('board-tab-tab-3')).toBe('tab-3');
  });

  it('strips the bootId portion when the module is configured with one', () => {
    boardHost.setup({ bootId: 'kfo3p2j-abc12' });
    expect(boardHost.tabIdFromBoardLabel('board-tab-kfo3p2j-abc12-tab-7')).toBe('tab-7');
    boardHost.setup({ bootId: '' });
  });

  it('returns "" for labels that lack the board-tab prefix', () => {
    boardHost.setup({ bootId: '' });
    expect(boardHost.tabIdFromBoardLabel('panel-tab-foo')).toBe('');
    expect(boardHost.tabIdFromBoardLabel('')).toBe('');
    expect(boardHost.tabIdFromBoardLabel(null)).toBe('');
  });

  it('round-trips: tabIdFromBoardLabel(multiviewLabelForTab(id)) === id', () => {
    boardHost.setup({ bootId: 'kfo3p2j-abc12' });
    expect(boardHost.tabIdFromBoardLabel(boardHost.multiviewLabelForTab('tab-99'))).toBe('tab-99');
    boardHost.setup({ bootId: '' });
    expect(boardHost.tabIdFromBoardLabel(boardHost.multiviewLabelForTab('tab-99'))).toBe('tab-99');
  });
});

describe('LexeraBoardHost.ensureHealthDot', () => {
  it('creates a new dot when one does not exist', () => {
    const placeholder = fakeElement();
    const doc = fakeDoc();
    const dot = boardHost.ensureHealthDot(placeholder, doc);
    expect(dot.className).toBe('mv-health-dot');
    expect(dot.getAttribute('data-health')).toBe('unknown');
    expect(dot.getAttribute('title')).toBe('Connection state: unknown');
    expect(placeholder.children).toContain(dot);
  });

  it('returns the existing dot without creating a duplicate', () => {
    const placeholder = fakeElement();
    const doc = fakeDoc();
    const first = boardHost.ensureHealthDot(placeholder, doc);
    const second = boardHost.ensureHealthDot(placeholder, doc);
    expect(second).toBe(first);
    expect(placeholder.children.filter((c) => c.className === 'mv-health-dot').length).toBe(1);
  });

  it('returns null when no document is available', () => {
    const isolated = loadIIFE(
      ['workspace/layoutTree.js', 'workspace/boardHost.js'],
      'window.LexeraBoardHost',
      { window: {} }
    );
    const placeholder = fakeElement();
    expect(isolated.ensureHealthDot(placeholder, null)).toBe(null);
  });
});

describe('LexeraBoardHost.watchPlaceholderVisibility lifecycle', () => {
  function buildEnv(windowOverrides = {}) {
    const setGeometry = vi.fn().mockResolvedValue(undefined);
    const invoke = vi.fn().mockResolvedValue(undefined);
    const moInstances = [];
    const ioInstances = [];

    class FakeMutationObserver {
      constructor(cb) {
        this.cb = cb;
        this.disconnected = false;
        moInstances.push(this);
      }
      observe() {}
      disconnect() { this.disconnected = true; }
    }
    class FakeIntersectionObserver {
      constructor(cb) {
        this.cb = cb;
        this.disconnected = false;
        ioInstances.push(this);
      }
      observe() {}
      disconnect() { this.disconnected = true; }
    }

    const win = {
      LexeraMultiview: { setGeometry, invoke },
      MutationObserver: FakeMutationObserver,
      IntersectionObserver: FakeIntersectionObserver,
      requestAnimationFrame: (fn) => fn(),
      ...windowOverrides
    };
    const isolated = loadWithWindow(win);
    return { isolated, win, setGeometry, invoke, moInstances, ioInstances };
  }

  it('early-returns when LexeraMultiview is unavailable', () => {
    const isolated = loadWithWindow({});
    const placeholder = fakeElement({ classList: ['is-active'] });
    isolated.watchPlaceholderVisibility('t1', placeholder);
    expect(isolated.hasVisibilityObserver('t1')).toBe(false);
  });

  it('registers an observer the first time and is idempotent', () => {
    const { isolated, moInstances, ioInstances } = buildEnv();
    const placeholder = fakeElement({ classList: ['is-active'] });
    isolated.watchPlaceholderVisibility('t1', placeholder);
    expect(isolated.hasVisibilityObserver('t1')).toBe(true);
    expect(moInstances.length).toBe(1);
    expect(ioInstances.length).toBe(1);
    isolated.watchPlaceholderVisibility('t1', placeholder);
    expect(moInstances.length).toBe(1);
    expect(ioInstances.length).toBe(1);
  });

  // When a shell re-render replaces the DOM node for a tab, the cached
  // observer is bound to the *old* (now-detached) element and will never
  // fire again — the webview gets stuck wherever it last was. The host
  // must detect that the placeholder identity changed and re-bind.
  it('rebinds the observer when the placeholder element is replaced for the same tab id', () => {
    const { isolated, moInstances, ioInstances } = buildEnv();
    const placeholderA = fakeElement({ classList: ['is-active'] });
    isolated.watchPlaceholderVisibility('t-rebind', placeholderA);
    expect(moInstances.length).toBe(1);
    expect(ioInstances.length).toBe(1);
    expect(moInstances[0].disconnected).toBe(false);

    const placeholderB = fakeElement({ classList: ['is-active'] });
    isolated.watchPlaceholderVisibility('t-rebind', placeholderB);

    // Old observers must be disconnected, fresh ones spun up.
    expect(moInstances[0].disconnected).toBe(true);
    expect(ioInstances[0].disconnected).toBe(true);
    expect(moInstances.length).toBe(2);
    expect(ioInstances.length).toBe(2);
    expect(moInstances[1].disconnected).toBe(false);
  });

  it('pushes geometry and reports visible on initial visible placeholder', () => {
    const { isolated, setGeometry, invoke } = buildEnv();
    const placeholder = fakeElement({ classList: ['is-active'] });
    isolated.watchPlaceholderVisibility('t2', placeholder);
    expect(invoke).toHaveBeenCalledWith('multiview_set_visible', { label: 'board-tab-t2', visible: true });
    expect(setGeometry).toHaveBeenCalled();
  });

  it('parks the webview offscreen when the placeholder is not active', () => {
    const { isolated, setGeometry, invoke } = buildEnv();
    const placeholder = fakeElement({ classList: [] });
    isolated.watchPlaceholderVisibility('t3', placeholder);
    expect(invoke).toHaveBeenCalledWith('multiview_set_visible', { label: 'board-tab-t3', visible: false });
    const lastCall = setGeometry.mock.calls[setGeometry.mock.calls.length - 1][0][0];
    expect(lastCall.x).toBe(-50000);
    expect(lastCall.y).toBe(-50000);
  });

  it('uses the provided pushGeomFn instead of the local fallback', () => {
    const { isolated, setGeometry } = buildEnv();
    const placeholder = fakeElement({ classList: ['is-active'] });
    const pushGeomFn = vi.fn();
    isolated.watchPlaceholderVisibility('t4', placeholder, pushGeomFn);
    expect(pushGeomFn).toHaveBeenCalledTimes(1);
    expect(setGeometry).not.toHaveBeenCalled();
  });

  it('uses the provided label override for non-board webviews', () => {
    const { isolated, invoke } = buildEnv();
    const placeholder = fakeElement({ classList: ['is-active'] });
    isolated.watchPlaceholderVisibility('p4', placeholder, null, 'panel-tab-p4');
    expect(invoke).toHaveBeenCalledWith('multiview_set_visible', { label: 'panel-tab-p4', visible: true });
  });

  it('uses the shared multiview geometry helper when available', () => {
    const computeNativeGeometry = vi.fn(() => ({
      label: 'board-tab-t6',
      x: 111,
      y: 222,
      width: 333,
      height: 444
    }));
    const { isolated, setGeometry } = buildEnv({
      LexeraMultiviewWebview: { computeNativeGeometry }
    });
    const placeholder = fakeElement({ classList: ['is-active'] });
    isolated.watchPlaceholderVisibility('t6', placeholder);
    expect(computeNativeGeometry).toHaveBeenCalledWith('board-tab-t6', placeholder);
    expect(setGeometry).toHaveBeenCalledWith([{
      label: 'board-tab-t6',
      x: 111,
      y: 222,
      width: 333,
      height: 444
    }]);
  });

  it('cleanupVisibilityObserver disconnects observers and forgets the tab', () => {
    const { isolated, moInstances, ioInstances } = buildEnv();
    const placeholder = fakeElement({ classList: ['is-active'] });
    isolated.watchPlaceholderVisibility('t5', placeholder);
    isolated.cleanupVisibilityObserver('t5');
    expect(isolated.hasVisibilityObserver('t5')).toBe(false);
    expect(moInstances[0].disconnected).toBe(true);
    expect(ioInstances[0].disconnected).toBe(true);
  });

  it('cleanupVisibilityObserver is a no-op for unknown tab ids', () => {
    const { isolated } = buildEnv();
    expect(() => isolated.cleanupVisibilityObserver('never-watched')).not.toThrow();
  });

  // Regression for the multiview-suppression contract: the placeholder
  // visibility observer must respect the global suppression flag set by
  // LexeraMultiviewWebview.setAllVisible(). Without this gate, a drag or
  // shell-DOM dropdown that suppresses webviews would still see them
  // re-shown the moment any placeholder mutation fires (since the
  // observer's first-run pushes visible:true). Pinning the gate here so
  // a refactor that drops the boardHost ↔ multiviewWebview link is caught.
  it('honours LexeraMultiviewWebview.isAllVisibleSuppressed() — keeps the webview hidden even when the placeholder is is-active', () => {
    const { isolated, invoke, setGeometry } = buildEnv({
      LexeraMultiviewWebview: {
        isAllVisibleSuppressed: () => true
      }
    });
    const placeholder = fakeElement({ classList: ['is-active'] });
    isolated.watchPlaceholderVisibility('t-suppressed', placeholder);
    // First call must mark the webview hidden, not visible.
    expect(invoke).toHaveBeenCalledWith('multiview_set_visible', { label: 'board-tab-t-suppressed', visible: false });
    // And it should be parked offscreen as belt-and-braces.
    const lastGeom = setGeometry.mock.calls[setGeometry.mock.calls.length - 1][0][0];
    expect(lastGeom.x).toBe(-50000);
    expect(lastGeom.y).toBe(-50000);
  });

  it('falls through to the placeholder check when isAllVisibleSuppressed is unavailable', () => {
    // No LexeraMultiviewWebview global at all → behaviour is the legacy
    // "is the placeholder is-active and measurable?" path. Confirms the
    // suppression hook is a strict ADD-ON, not a hard dependency.
    const { isolated, invoke } = buildEnv();
    const placeholder = fakeElement({ classList: ['is-active'] });
    isolated.watchPlaceholderVisibility('t-no-mvw', placeholder);
    expect(invoke).toHaveBeenCalledWith('multiview_set_visible', { label: 'board-tab-t-no-mvw', visible: true });
  });
});
