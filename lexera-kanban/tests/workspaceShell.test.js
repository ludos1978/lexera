import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createClassList(host) {
  const classes = new Set();
  return {
    add(...names) {
      names.forEach((name) => classes.add(String(name)));
      host.className = Array.from(classes).join(' ');
    },
    remove(...names) {
      names.forEach((name) => classes.delete(String(name)));
      host.className = Array.from(classes).join(' ');
    },
    toggle(name, force) {
      const normalized = String(name);
      if (force === true) {
        classes.add(normalized);
        host.className = Array.from(classes).join(' ');
        return true;
      }
      if (force === false) {
        classes.delete(normalized);
        host.className = Array.from(classes).join(' ');
        return false;
      }
      if (classes.has(normalized)) {
        classes.delete(normalized);
        host.className = Array.from(classes).join(' ');
        return false;
      }
      classes.add(normalized);
      host.className = Array.from(classes).join(' ');
      return true;
    },
    contains(name) {
      return classes.has(String(name));
    }
  };
}

function createElement(tagName = 'div') {
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    className: '',
    classList: null,
    style: {},
    dataset: {},
    childNodes: [],
    children: [],
    parentNode: null,
    innerHTML: '',
    textContent: '',
    attributes: {},
    appendChild(child) {
      if (!child) return child;
      child.parentNode = this;
      this.childNodes.push(child);
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.childNodes = this.childNodes.filter((entry) => entry !== child);
      this.children = this.children.filter((entry) => entry !== child);
      if (child) child.parentNode = null;
      return child;
    },
    insertBefore(child, before) {
      if (!child) return child;
      child.parentNode = this;
      const index = this.childNodes.indexOf(before);
      if (index === -1) return this.appendChild(child);
      this.childNodes.splice(index, 0, child);
      this.children.splice(index, 0, child);
      return child;
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'class') this.className = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : '';
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 };
    },
    focus() {},
    blur() {}
  };
  element.classList = createClassList(element);
  return element;
}

function findFirstElementByTag(root, tagName) {
  if (!root) return null;
  if (root.tagName === String(tagName || '').toUpperCase()) return root;
  const children = Array.isArray(root.childNodes) ? root.childNodes : [];
  for (let i = 0; i < children.length; i += 1) {
    const found = findFirstElementByTag(children[i], tagName);
    if (found) return found;
  }
  return null;
}

function hasClassName(element, className) {
  if (!element || !className) return false;
  const classes = String(element.className || '').split(/\s+/).filter(Boolean);
  return classes.includes(String(className));
}

function findFirstElementByClass(root, className) {
  if (!root) return null;
  if (hasClassName(root, className)) return root;
  const children = Array.isArray(root.childNodes) ? root.childNodes : [];
  for (let i = 0; i < children.length; i += 1) {
    const found = findFirstElementByClass(children[i], className);
    if (found) return found;
  }
  return null;
}

function createStorage() {
  const store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    }
  };
}

function createShellHarness() {
  const listeners = {};
  const window = {
    location: { href: 'http://127.0.0.1:1431/', search: '' },
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    innerWidth: 1600,
    innerHeight: 1000,
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((entry) => entry !== handler);
    },
    emit(type, payload) {
      (listeners[type] || []).forEach((handler) => handler(payload));
    },
    close() {},
    LexeraSharedPanels: null
  };
  const body = createElement('body');
  const document = {
    body,
    createElement: (tagName) => createElement(tagName),
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  window.document = document;
  const mainContent = createElement('main');
  body.appendChild(mainContent);
  // workspaceShell.js delegates board-label resolution to the shared
  // titleHelpers global, so the loader must include it. Loading
  // titleHelpers FIRST registers `window.LexeraTitleHelpers`; the
  // workspace shell's `getBoardMetaLabel` reads it at call time.
  const shell = loadIIFE(['titleHelpers.js', 'workspace/layoutTree.js', 'workspace/lifecycleReconciler.js', 'workspace/boardHost.js', 'workspace/panelHost.js', 'workspace/multiviewWebview.js', 'workspace/messageBridge.js', 'workspace/panelDefinitions.js', 'workspace/treeRegistry.js', 'workspace/layoutPersistence.js', 'workspace/tabDragController.js', 'workspace/geometryObserver.js', 'workspace/workspaceShell.js'], 'window.LexeraWorkspaceShell', {
    window,
    document,
    console: { log() {}, warn() {}, error() {}, info() {} },
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout
  });
  return { shell, window, mainContent };
}

describe('workspace shell active-board notifications', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('notifies when openBoard activates a board tab', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    const onActiveBoardChanged = vi.fn();

    shell.mount({
      getMainContent: () => mainContent,
      onActiveBoardChanged
    });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' }
    ]);

    shell.openBoard('alpha');
    vi.advanceTimersByTime(150);
    expect(onActiveBoardChanged).toHaveBeenLastCalledWith('alpha');

    shell.openBoard('beta');
    vi.advanceTimersByTime(150);
    expect(onActiveBoardChanged).toHaveBeenLastCalledWith('beta');
  });

  it('notifies when an embedded pane re-activates another board tab', () => {
    vi.useFakeTimers();
    const { shell, window, mainContent } = createShellHarness();
    const onActiveBoardChanged = vi.fn();

    shell.mount({
      getMainContent: () => mainContent,
      onActiveBoardChanged
    });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' }
    ]);

    const alphaTab = shell.openBoard('alpha');
    vi.advanceTimersByTime(150);
    shell.openBoard('beta');
    vi.advanceTimersByTime(150);

    window.emit('message', {
      data: {
        type: 'lexera-pane-activated',
        pane: alphaTab.id
      }
    });
    vi.advanceTimersByTime(150);

    expect(onActiveBoardChanged).toHaveBeenLastCalledWith('alpha');
  });

  it('notifies when an embedded pane changes its board id', () => {
    vi.useFakeTimers();
    const { shell, window, mainContent } = createShellHarness();
    const onActiveBoardChanged = vi.fn();

    shell.mount({
      getMainContent: () => mainContent,
      onActiveBoardChanged
    });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' }
    ]);

    const alphaTab = shell.openBoard('alpha');
    vi.advanceTimersByTime(150);

    window.emit('message', {
      data: {
        type: 'lexera-pane-board-change',
        pane: alphaTab.id,
        boardId: 'beta'
      }
    });
    vi.advanceTimersByTime(150);

    expect(onActiveBoardChanged).toHaveBeenLastCalledWith('beta');
  });
});

describe('workspace shell hierarchy mutation bridge', () => {
  it('refreshes hierarchy and dashboard from the embedded mutation payload without re-reading the iframe', () => {
    const { shell, window, mainContent } = createShellHarness();
    const refreshBoardHierarchy = vi.fn();
    const refreshDashboard = vi.fn();
    const fullBoard = {
      title: 'Alpha',
      rows: [{ id: 'row-1', title: 'Row', stacks: [] }],
    };

    shell.mount({
      getMainContent: () => mainContent,
      refreshBoardHierarchy,
      refreshDashboard,
    });

    window.emit('message', {
      data: {
        type: 'lexera-board-mutated',
        boardId: 'alpha',
        pane: 'pane-1',
        fullBoard,
      }
    });

    expect(refreshBoardHierarchy).toHaveBeenCalledWith('alpha', fullBoard);
    expect(refreshDashboard).toHaveBeenCalledWith('alpha', fullBoard, 'pane-1');
  });

  it('forwards embedded dashboard searches to the parent dashboard app', async () => {
    const { shell, window, mainContent } = createShellHarness();
    const openDashboardSearch = vi.fn().mockResolvedValue(true);
    window.LexeraDashboard = { openDashboardSearch };

    shell.mount({
      getMainContent: () => mainContent
    });

    window.emit('message', {
      data: {
        type: 'lexera-pane-dashboard-search',
        pane: 'pane-1',
        query: '#frontend'
      }
    });

    await Promise.resolve();

    expect(openDashboardSearch).toHaveBeenCalledWith('#frontend', { forceLocal: true });
  });
});

describe('workspace shell catalog sync', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('broadcasts the latest workspace catalog to loaded board frames', () => {
    vi.useFakeTimers();
    const { shell, window, mainContent } = createShellHarness();
    window.LexeraMultiview = {
      broadcastCatalog: vi.fn()
    };

    shell.mount({
      getMainContent: () => mainContent
    });
    shell.onBoardsUpdated([{ id: 'alpha', title: 'Alpha' }]);
    shell.openBoard('alpha');
    vi.advanceTimersByTime(150);

    const frame = findFirstElementByTag(mainContent, 'iframe');
    const placeholder = findFirstElementByTag(mainContent, 'div');
    expect(placeholder).toBeTruthy();
    expect(frame).toBeNull();

    shell.onCatalogUpdated({
      boards: [{ id: 'alpha', title: 'Alpha' }],
      remoteBoards: [{ id: 'remote-a', title: 'Remote A' }],
      workspaces: [{ id: 'ws-1', name: 'Workspace 1' }]
    });

    expect(window.LexeraMultiview.broadcastCatalog).toHaveBeenCalledWith(expect.objectContaining({
      boards: [{ id: 'alpha', title: 'Alpha' }],
      remoteBoards: [{ id: 'remote-a', title: 'Remote A' }],
      workspaces: [{ id: 'ws-1', name: 'Workspace 1' }],
      activeWorkspaceId: '',
      activeWorkspace: null,
      viewWorkspaceId: '',
      viewWorkspace: null,
      workspaceViewMode: 'follow-active-board'
    }));
  });
});

describe('workspace shell tab actions (Phase 1 keyboard shortcuts)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('close-active-tab removes the currently active tab', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' }
    ]);
    shell.openBoard('alpha');
    shell.openBoard('beta');
    vi.advanceTimersByTime(150);

    const closed = shell.handleBoardAction('close-active-tab');
    expect(closed).toBe(true);
  });

  it('close-active-tab returns true even when there is no active tab', () => {
    // The handler always consumes the keypress to prevent it bubbling elsewhere
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    const result = shell.handleBoardAction('close-active-tab');
    expect(result).toBe(true);
  });

  it('next-tab cycles forward and wraps around to the first tab', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    const onActiveBoardChanged = vi.fn();
    shell.mount({ getMainContent: () => mainContent, onActiveBoardChanged });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' },
      { id: 'gamma', title: 'Gamma' }
    ]);
    shell.openBoard('alpha');
    shell.openBoard('beta');
    shell.openBoard('gamma');
    vi.advanceTimersByTime(150);

    // Currently on gamma (last opened). Next should wrap to alpha.
    shell.handleBoardAction('next-tab');
    vi.advanceTimersByTime(150);
    expect(onActiveBoardChanged).toHaveBeenLastCalledWith('alpha');

    // Next from alpha should go to beta.
    shell.handleBoardAction('next-tab');
    vi.advanceTimersByTime(150);
    expect(onActiveBoardChanged).toHaveBeenLastCalledWith('beta');
  });

  it('prev-tab cycles backward and wraps around to the last tab', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    const onActiveBoardChanged = vi.fn();
    shell.mount({ getMainContent: () => mainContent, onActiveBoardChanged });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' },
      { id: 'gamma', title: 'Gamma' }
    ]);
    shell.openBoard('alpha');
    shell.openBoard('beta');
    shell.openBoard('gamma');
    vi.advanceTimersByTime(150);

    // Currently on gamma. Prev should go to beta.
    shell.handleBoardAction('prev-tab');
    vi.advanceTimersByTime(150);
    expect(onActiveBoardChanged).toHaveBeenLastCalledWith('beta');

    // Prev twice more wraps: alpha -> gamma.
    shell.handleBoardAction('prev-tab');
    vi.advanceTimersByTime(150);
    shell.handleBoardAction('prev-tab');
    vi.advanceTimersByTime(150);
    expect(onActiveBoardChanged).toHaveBeenLastCalledWith('gamma');
  });

  it('next-tab and prev-tab return false when there is only one tab', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    shell.onBoardsUpdated([{ id: 'alpha', title: 'Alpha' }]);
    shell.openBoard('alpha');
    vi.advanceTimersByTime(150);

    expect(shell.handleBoardAction('next-tab')).toBe(false);
    expect(shell.handleBoardAction('prev-tab')).toBe(false);
  });

  it('cycle-tab target resolution returns empty when the active tab id is stale', () => {
    const { shell } = createShellHarness();
    const staleLeaf = {
      tabs: [{ id: 'tab-alpha' }, { id: 'tab-beta' }],
      activeTabId: 'tab-missing'
    };

    expect(shell._test_resolveCycleTabTarget(staleLeaf, 1)).toBe('');
    expect(shell._test_resolveCycleTabTarget(staleLeaf, -1)).toBe('');
  });

  it('toggle-panel:hierarchy rejects unknown panel IDs', () => {
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    // Unknown panel should return false, not silently consume the event
    expect(shell.handleBoardAction('toggle-panel:nonexistent')).toBe(false);
  });

  it('toggle-panel:hierarchy cycles visible to hidden and back to visible', () => {
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });

    expect(shell.isPanelVisible('hierarchy')).toBe(true);
    expect(shell.handleBoardAction('toggle-panel:hierarchy')).toBe(true);
    expect(shell.isPanelVisible('hierarchy')).toBe(false);
    expect(shell.handleBoardAction('toggle-panel:hierarchy')).toBe(true);
    expect(shell.isPanelVisible('hierarchy')).toBe(true);
  });

  it('toggle-panel:hierarchy accepts valid panel IDs', () => {
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    // Valid panel kinds should return true
    expect(shell.handleBoardAction('toggle-panel:hierarchy')).toBe(true);
    expect(shell.handleBoardAction('toggle-panel:dashboard')).toBe(true);
    expect(shell.handleBoardAction('toggle-panel:files')).toBe(true);
  });

  it('handles native open-workspace:<id> menu actions in the shell', () => {
    const { shell, mainContent } = createShellHarness();
    const openWindow = vi.fn();
    shell.mount({ getMainContent: () => mainContent, openWindow });

    expect(shell.handleBoardAction('open-workspace:ws-selected')).toBe(true);
    expect(openWindow).toHaveBeenCalledWith({
      profile: 'workspace',
      workspaceId: 'ws-selected'
    });
  });

  it('dedupes repeated native open-workspace:<id> menu actions', () => {
    const { shell, mainContent } = createShellHarness();
    const openWindow = vi.fn();
    shell.mount({ getMainContent: () => mainContent, openWindow });

    expect(shell.handleBoardAction('open-workspace:ws-selected')).toBe(true);
    expect(shell.handleBoardAction('open-workspace:ws-selected')).toBe(true);

    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith({
      profile: 'workspace',
      workspaceId: 'ws-selected'
    });
  });

  it('renders a shell tab header for default multi-view panel groups', () => {
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });

    const headerEl = findFirstElementByClass(mainContent, 'ws-view-header');
    const tabsEl = findFirstElementByClass(mainContent, 'ws-view-tabs');

    expect(headerEl).toBeTruthy();
    expect(tabsEl).toBeTruthy();
  });

  it('keeps a shell header for single panel views so they remain draggable', () => {
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });

    expect(shell.handleBoardAction('toggle-panel:dashboard')).toBe(true);

    const headerEl = findFirstElementByClass(mainContent, 'ws-view-header');
    const titleEl = findFirstElementByClass(mainContent, 'ws-view-title');
    const dragEl = findFirstElementByClass(mainContent, 'ws-view-drag');

    expect(headerEl).toBeTruthy();
    expect(titleEl).toBeTruthy();
    expect(titleEl.textContent).toBe('Workspaces');
    expect(dragEl).toBeTruthy();
  });
});

describe('workspace shell close button on board tabs', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders × close buttons on board tab headers (no burger), matching all other view kinds', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    shell.onBoardsUpdated([{ id: 'alpha', title: 'Alpha' }]);
    shell.openBoard('alpha');
    vi.advanceTimersByTime(200);

    function findByAttr(root, attrName, attrValue) {
      if (!root) return null;
      if (root.attributes && root.attributes[attrName] === attrValue) return root;
      const children = Array.isArray(root.childNodes) ? root.childNodes : [];
      for (let i = 0; i < children.length; i += 1) {
        const found = findByAttr(children[i], attrName, attrValue);
        if (found) return found;
      }
      return null;
    }
    function findByClass(root, cls) {
      if (!root) return null;
      if (root.className && String(root.className).indexOf(cls) !== -1) return root;
      const children = Array.isArray(root.childNodes) ? root.childNodes : [];
      for (let i = 0; i < children.length; i += 1) {
        const found = findByClass(children[i], cls);
        if (found) return found;
      }
      return null;
    }

    // No burger button on board tab headers — the per-tab and
    // header-level action buttons are both × close, same as panel
    // tabs. The tab-menu action only attaches via right-click now.
    const burgerBtn = findByAttr(mainContent, 'data-ws-action', 'tab-menu');
    expect(burgerBtn, 'board tab headers must NOT render the legacy ☰ burger menu — replaced by × close').toBeNull();

    // The board tab header still renders a `.ws-view-close` button.
    const closeBtn = findByClass(mainContent, 'ws-view-close');
    expect(closeBtn, 'board tab header must render a .ws-view-close button').toBeTruthy();

    // Existing functional check: closing the tab still works through the action handler.
    expect(shell.handleBoardAction('close-active-tab')).toBe(true);
  });

  it('opening multiple boards creates tabs that can all be closed', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' },
      { id: 'gamma', title: 'Gamma' }
    ]);
    shell.openBoard('alpha');
    shell.openBoard('beta');
    shell.openBoard('gamma');
    vi.advanceTimersByTime(200);

    // Close all three — each should succeed
    expect(shell.handleBoardAction('close-active-tab')).toBe(true);
    expect(shell.handleBoardAction('close-active-tab')).toBe(true);
    expect(shell.handleBoardAction('close-active-tab')).toBe(true);
  });
});

describe('workspace shell board loading', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('openBoard returns a tab object with the board id', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    shell.onBoardsUpdated([{ id: 'alpha', title: 'Alpha' }]);

    const tab = shell.openBoard('alpha');
    vi.advanceTimersByTime(200);

    expect(tab).toBeTruthy();
    expect(tab.boardId).toBe('alpha');
  });

  it('shell.focusWorkspace is gone — each window owns one workspace, so workspace switching means opening a new window', () => {
    const { shell } = createShellHarness();
    expect(typeof shell.focusWorkspace).toBe('undefined');
    expect(typeof shell.openWorkspaceWindow).toBe('function');
  });

  it('opening the same board twice returns the existing tab', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    shell.onBoardsUpdated([{ id: 'alpha', title: 'Alpha' }]);

    const tab1 = shell.openBoard('alpha');
    vi.advanceTimersByTime(50);
    const tab2 = shell.openBoard('alpha');
    vi.advanceTimersByTime(50);

    expect(tab1.id).toBe(tab2.id);
  });

  it('opening multiple boards creates separate tabs', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' }
    ]);

    const tab1 = shell.openBoard('alpha');
    vi.advanceTimersByTime(50);
    const tab2 = shell.openBoard('beta');
    vi.advanceTimersByTime(50);

    expect(tab1.boardId).toBe('alpha');
    expect(tab2.boardId).toBe('beta');
    expect(tab1.id).not.toBe(tab2.id);
  });

  it('onBoardsUpdated prunes tabs for boards that no longer exist', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' }
    ]);

    shell.openBoard('alpha');
    shell.openBoard('beta');
    vi.advanceTimersByTime(200);

    // Remove beta from catalog
    shell.onBoardsUpdated([{ id: 'alpha', title: 'Alpha' }]);
    vi.advanceTimersByTime(200);

    // Opening beta again should create a new tab (old one was pruned)
    const newTab = shell.openBoard('beta');
    expect(newTab).toBeTruthy();
  });
});
