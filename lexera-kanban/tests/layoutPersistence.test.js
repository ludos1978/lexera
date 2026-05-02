import { describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadModule(locationSearch, windowLabel) {
  const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const win = {
    location: { search: locationSearch || '' },
    localStorage: localStorage,
    sessionStorage: sessionStorage
  };
  win.window = win;
  // layoutPersistence.js depends on the LexeraLayoutTree global being present
  // before its IIFE runs. Stub the layoutTree shape it touches in setup() —
  // the keying helpers are pure and don't touch layoutTree, so a minimal
  // shim suffices.
  const layoutTreeStub = {
    isPanelTab: () => false,
    isBoardTab: () => false,
    normalizeViewKind: (v) => v || 'kanban',
    migratePanelDocksToSideDocks: () => null
  };
  win.LexeraLayoutTree = layoutTreeStub;
  const mod = loadIIFE('workspace/layoutPersistence.js', 'window.LexeraLayoutPersistence', {
    window: win,
    LexeraLayoutTree: layoutTreeStub
  });
  // Provide the minimum setup deps so the module's internal `deps` is
  // populated. The keying helpers only read `deps.state.hooks` and
  // `deps.state.windowLabel`.
  mod.setup({
    state: {
      hooks: {},
      windowLabel: windowLabel || 'main'
    },
    layoutTree: layoutTreeStub,
    panelDefs: {},
    nextId: () => 'id-0',
    resolvePanelTarget: (id) => id,
    syncIntegratedPanelVisibility: () => {},
    ensureActiveLeaf: () => {}
  });
  return { mod, win };
}

describe('LexeraLayoutPersistence.getPersistenceKey', () => {
  it('keys by workspace id when ?workspace= is present', () => {
    const { mod } = loadModule('?workspace=ws-alpha&windowLabel=kanban-7', 'kanban-7');
    expect(mod.getPersistenceKey()).toBe('lexera-workspace-shell:ws:ws-alpha');
  });

  it('two windows on the same workspace share one key (last save wins)', () => {
    const a = loadModule('?workspace=shared&windowLabel=kanban-1', 'kanban-1').mod;
    const b = loadModule('?workspace=shared&windowLabel=kanban-2', 'kanban-2').mod;
    expect(a.getPersistenceKey()).toBe(b.getPersistenceKey());
  });

  it('falls back to per-window key when no workspace is set (main window pre-hydrate)', () => {
    const { mod } = loadModule('', 'main');
    expect(mod.getPersistenceKey()).toBe('lexera-workspace-shell:main');
  });

  it('falls back to per-window key for detached panel-only windows', () => {
    const { mod } = loadModule('?panelKind=logs&windowLabel=kanban-3', 'kanban-3');
    expect(mod.getPersistenceKey()).toBe('lexera-workspace-shell:kanban-3');
  });

  it('honours an explicit hooks.getPersistenceKey override', () => {
    const { mod, win } = loadModule('?workspace=ws-alpha', 'kanban-1');
    mod.setup({
      state: {
        hooks: { getPersistenceKey: () => 'custom-key' },
        windowLabel: 'kanban-1'
      },
      layoutTree: win.LexeraLayoutTree,
      panelDefs: {},
      nextId: () => 'id-0',
      resolvePanelTarget: (id) => id,
      syncIntegratedPanelVisibility: () => {},
      ensureActiveLeaf: () => {}
    });
    expect(mod.getPersistenceKey()).toBe('custom-key');
  });
});

describe('LexeraLayoutPersistence.getPersistenceStorage', () => {
  it('uses localStorage for workspace-pinned secondary windows so layout persists across sessions', () => {
    const { mod, win } = loadModule('?workspace=ws-alpha&windowLabel=kanban-9', 'kanban-9');
    expect(mod.getPersistenceStorage()).toBe(win.localStorage);
  });

  it('uses localStorage for the main window even without a workspace', () => {
    const { mod, win } = loadModule('', 'main');
    expect(mod.getPersistenceStorage()).toBe(win.localStorage);
  });

  it('uses sessionStorage for transient secondary windows without a workspace', () => {
    const { mod, win } = loadModule('?panelKind=logs&windowLabel=kanban-2', 'kanban-2');
    expect(mod.getPersistenceStorage()).toBe(win.sessionStorage);
  });
});
