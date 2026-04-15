// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); }
  };
}

function loadBoardList() {
  return loadIIFE('board/boardList.js', 'LexeraBoardList', {
    window,
    document,
    localStorage: createLocalStorage(),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    structuredClone,
    lexeraLog: vi.fn(),
    logFrontendIssue: vi.fn(),
    traceFrontendAction: vi.fn()
  });
}

function createState(overrides) {
  return {
    boards: [],
    remoteBoards: [],
    workspaces: [],
    activeWorkspaceId: '__all__',
    viewWorkspaceId: '__all__',
    workspaceViewMode: 'follow-active-board',
    activeBoardId: '',
    boardPresenceCache: {},
    ALL_WORKSPACES_ID: '__all__',
    ...overrides
  };
}

function initBoardList(BoardList, state) {
  BoardList.init({
    get boards() { return state.boards; },
    get remoteBoards() { return state.remoteBoards; },
    get workspaces() { return state.workspaces; },
    get activeWorkspaceId() { return state.activeWorkspaceId; },
    get viewWorkspaceId() { return state.viewWorkspaceId; },
    get workspaceViewMode() { return state.workspaceViewMode; },
    get activeBoardId() { return state.activeBoardId; },
    get boardPresenceCache() { return state.boardPresenceCache; },
    get ALL_WORKSPACES_ID() { return state.ALL_WORKSPACES_ID; },
    setActiveWorkspaceIdState() {},
    setViewWorkspaceIdState() {},
    setWorkspaceViewModeState() {},
    getOrderedItems(items) { return items; },
    getSharedPanelRoots() { return []; },
    getCreationEntityDragIconSvg() { return ''; },
    getDisplayNameFromPath(path) { return path || ''; },
    escapeHtml(text) { return String(text || ''); }
  });
}

describe('board list loading state', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="board-list" class="board-list view-loading"></div>';
    // Provide a minimal LexeraRuntime mock so boardList uses the runtime
    // setViewLoading path instead of the no-op fallback.
    window.LexeraRuntime = {
      setViewLoading(el, loading) {
        if (loading) el.classList.add('view-loading');
        else el.classList.remove('view-loading');
      },
      setViewConnected() {},
      mergeDeps(target, source) {
        Object.keys(source).forEach(function (k) {
          Object.defineProperty(target, k, Object.getOwnPropertyDescriptor(source, k));
        });
      },
      onStateChange() { return function () {}; },
      on() { return function () {}; },
      getState() { return undefined; },
      setViewEmpty() {},
      defineState() {}
    };
  });

  it('keeps view-loading class when no board data is available', () => {
    const BoardList = loadBoardList();
    const state = createState();
    initBoardList(BoardList, state);

    BoardList.renderBoardList();

    const el = document.getElementById('board-list');
    expect(el.classList.contains('view-loading')).toBe(true);
  });

  it('removes view-loading class once boards arrive', () => {
    const BoardList = loadBoardList();
    const state = createState();
    initBoardList(BoardList, state);

    // First render with no data — loading stays
    BoardList.renderBoardList();
    const el = document.getElementById('board-list');
    expect(el.classList.contains('view-loading')).toBe(true);

    // Simulate poll data arriving
    state.boards = [
      { id: 'board-1', title: 'Test Board', columns: [] }
    ];
    BoardList.renderBoardList();
    expect(el.classList.contains('view-loading')).toBe(false);
  });

  it('removes view-loading class when remote boards arrive even without local boards', () => {
    const BoardList = loadBoardList();
    const state = createState({
      remoteBoards: [{ id: 'remote-1', title: 'Remote Board', isRemote: true, columns: [] }]
    });
    initBoardList(BoardList, state);

    BoardList.renderBoardList();

    const el = document.getElementById('board-list');
    expect(el.classList.contains('view-loading')).toBe(false);
  });

  it('renders board items after data arrives', () => {
    const BoardList = loadBoardList();
    const state = createState({
      boards: [
        { id: 'board-1', title: 'Alpha', columns: [] },
        { id: 'board-2', title: 'Beta', columns: [] }
      ]
    });
    initBoardList(BoardList, state);

    BoardList.renderBoardList();

    const el = document.getElementById('board-list');
    const items = el.querySelectorAll('.board-item');
    expect(items.length).toBe(2);
  });

  it('does not render any DOM children when no data (early return)', () => {
    const BoardList = loadBoardList();
    const state = createState();
    initBoardList(BoardList, state);

    BoardList.renderBoardList();

    const el = document.getElementById('board-list');
    // Early return should leave the element empty (no board items, no empty message)
    expect(el.children.length).toBe(0);
  });

  it('does not call setViewEmpty when no data (preserves loading spinner)', () => {
    const setViewEmptyCalls = [];
    window.LexeraRuntime.setViewEmpty = function (el, empty, msg) {
      setViewEmptyCalls.push({ empty, msg });
      if (empty) el.classList.add('view-empty');
      else el.classList.remove('view-empty');
    };

    const BoardList = loadBoardList();
    const state = createState();
    initBoardList(BoardList, state);

    BoardList.renderBoardList();

    // setViewEmpty should NOT have been called since we returned early
    expect(setViewEmptyCalls.length).toBe(0);
    // view-loading should still be present
    const el = document.getElementById('board-list');
    expect(el.classList.contains('view-loading')).toBe(true);
  });

  it('transitions from loading to data in sequence', () => {
    const BoardList = loadBoardList();
    const state = createState();
    initBoardList(BoardList, state);

    const el = document.getElementById('board-list');

    // Step 1: Initial render — no data, loading spinner stays
    BoardList.renderBoardList();
    expect(el.classList.contains('view-loading')).toBe(true);
    expect(el.children.length).toBe(0);

    // Step 2: Still no data — loading persists
    BoardList.renderBoardList();
    expect(el.classList.contains('view-loading')).toBe(true);

    // Step 3: Data arrives — loading removed, boards rendered
    state.boards = [{ id: 'b1', title: 'Board', columns: [] }];
    BoardList.renderBoardList();
    expect(el.classList.contains('view-loading')).toBe(false);
    expect(el.querySelectorAll('.board-item').length).toBe(1);
  });
});
