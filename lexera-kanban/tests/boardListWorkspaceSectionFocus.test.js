// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

function loadBoardList() {
  const localStorage = createLocalStorage();
  return loadIIFE('board/boardList.js', 'LexeraBoardList', {
    window,
    document,
    localStorage,
    requestAnimationFrame: window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : (fn) => setTimeout(fn, 0),
    structuredClone,
    lexeraLog: vi.fn(),
    logFrontendIssue: vi.fn(),
    traceFrontendAction: vi.fn()
  });
}

describe('LexeraBoardList workspace section focus button', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="workspace-header-title"></div>
      <div id="board-list"></div>
    `;
  });

  it('renders a focus button for real workspaces and drills into the workspace view without changing the active workspace', () => {
    const BoardList = loadBoardList();
    const state = {
      boards: [
        { id: 'board-1', title: 'Board One', workspace_ids: ['ws-1'], columns: [] },
        { id: 'board-2', title: 'Board Two', workspace_ids: ['ws-2'], columns: [] },
        { id: 'board-3', title: 'Loose Board', workspace_ids: [], columns: [] }
      ],
      remoteBoards: [],
      workspaces: [{ id: 'ws-1', name: 'Workspace One' }, { id: 'ws-2', name: 'Workspace Two' }],
      activeWorkspaceId: 'ws-2',
      viewWorkspaceId: '__all__',
      workspaceViewMode: 'follow-active-board',
      activeBoardId: 'board-2'
    };

    BoardList.init({
      get boards() { return state.boards; },
      get remoteBoards() { return state.remoteBoards; },
      get workspaces() { return state.workspaces; },
      get activeWorkspaceId() { return state.activeWorkspaceId; },
      get viewWorkspaceId() { return state.viewWorkspaceId; },
      get workspaceViewMode() { return state.workspaceViewMode; },
      get activeBoardId() { return state.activeBoardId; },
      get boardPresenceCache() { return {}; },
      get ALL_WORKSPACES_ID() { return '__all__'; },
      setActiveWorkspaceIdState(nextWorkspaceId) { state.activeWorkspaceId = nextWorkspaceId; },
      setViewWorkspaceIdState(nextWorkspaceId) { state.viewWorkspaceId = nextWorkspaceId; },
      setWorkspaceViewModeState(nextMode) { state.workspaceViewMode = nextMode; },
      getOrderedItems(items) { return items; },
      getSharedPanelRoots() { return []; },
      getCreationEntityDragIconSvg() { return ''; },
      getDisplayNameFromPath(path) { return path || ''; },
      escapeHtml(text) { return String(text || ''); }
    });

    BoardList.renderBoardList();

    const workspaceHeader = document.querySelector('.workspace-section-header[data-workspace-id="ws-1"]');
    let focusBtn = workspaceHeader && workspaceHeader.querySelector('.workspace-section-focus');
    expect(focusBtn).toBeTruthy();
    expect(workspaceHeader?.getAttribute('data-tree-structural-role')).toBe('section');
    expect(workspaceHeader?.getAttribute('data-tree-node-role')).toBe('branch');
    workspaceHeader.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    focusBtn = document.querySelector('.workspace-section-header[data-workspace-id="ws-1"] .workspace-section-focus');
    expect(focusBtn).toBeTruthy();
    expect(document.querySelector('.board-item[data-board-id="board-1"]')?.closest('.workspace-section-boards')).toBeTruthy();

    const unassignedHeader = document.querySelector('.workspace-section-header.workspace-unassigned');
    expect(unassignedHeader).toBeTruthy();
    expect(unassignedHeader?.getAttribute('data-tree-structural-role')).toBe('section');
    expect(unassignedHeader.querySelector('.workspace-section-focus')).toBeNull();

    focusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(state.activeWorkspaceId).toBe('ws-2');
    expect(state.viewWorkspaceId).toBe('ws-1');
    expect(state.workspaceViewMode).toBe('manual');
    expect(document.querySelector('.workspace-section-header[data-workspace-id="ws-1"]')).toBeNull();
    expect(document.querySelector('.board-item[data-board-id="board-1"]')).toBeTruthy();
    expect(document.querySelector('.board-item[data-board-id="board-1"]')?.closest('.workspace-section-boards')).toBeFalsy();
    expect(document.querySelector('.board-item[data-board-id="board-1"]')?.getAttribute('data-tree-structural-role')).toBe('group');
    expect(document.querySelector('.board-item[data-board-id="board-1"]')?.getAttribute('data-tree-node-role')).toBe('leaf');
    expect(document.querySelector('.board-item[data-board-id="board-2"]')).toBeNull();
    expect(document.getElementById('workspace-header-title').textContent).toContain('Workspace One');

    BoardList.reconcileActiveWorkspaceContext({ render: false });

    expect(state.activeWorkspaceId).toBe('ws-2');
    expect(state.viewWorkspaceId).toBe('ws-1');
    expect(state.workspaceViewMode).toBe('manual');
  });

  it('drills into the workspace from a mirrored workspace view focus button without resetting to the active board workspace', () => {
    const BoardList = loadBoardList();
    const state = {
      boards: [
        { id: 'board-1', title: 'Board One', workspace_ids: ['ws-1'], columns: [] },
        { id: 'board-2', title: 'Board Two', workspace_ids: ['ws-2'], columns: [] }
      ],
      remoteBoards: [],
      workspaces: [{ id: 'ws-1', name: 'Workspace One' }, { id: 'ws-2', name: 'Workspace Two' }],
      activeWorkspaceId: 'ws-2',
      viewWorkspaceId: '__all__',
      workspaceViewMode: 'follow-active-board',
      activeBoardId: 'board-2'
    };

    BoardList.init({
      get boards() { return state.boards; },
      get remoteBoards() { return state.remoteBoards; },
      get workspaces() { return state.workspaces; },
      get activeWorkspaceId() { return state.activeWorkspaceId; },
      get viewWorkspaceId() { return state.viewWorkspaceId; },
      get workspaceViewMode() { return state.workspaceViewMode; },
      get activeBoardId() { return state.activeBoardId; },
      get boardPresenceCache() { return {}; },
      get ALL_WORKSPACES_ID() { return '__all__'; },
      setActiveWorkspaceIdState(nextWorkspaceId) { state.activeWorkspaceId = nextWorkspaceId; },
      setViewWorkspaceIdState(nextWorkspaceId) { state.viewWorkspaceId = nextWorkspaceId; },
      setWorkspaceViewModeState(nextMode) { state.workspaceViewMode = nextMode; },
      getOrderedItems(items) { return items; },
      getSharedPanelRoots() { return []; },
      getCreationEntityDragIconSvg() { return ''; },
      getDisplayNameFromPath(path) { return path || ''; },
      escapeHtml(text) { return String(text || ''); }
    });

    BoardList.renderBoardList();

    const canonicalWorkspaceHeader = document.querySelector('.workspace-section-header[data-workspace-id="ws-1"]');
    canonicalWorkspaceHeader.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const mirrorRoot = document.createElement('div');
    mirrorRoot.innerHTML = `
      <div class="sidebar-header">
        <div class="sidebar-header-title lexera-shared-workspace-title" title="All Workspaces">All Workspaces</div>
        <div class="sidebar-header-actions">
          <button class="sidebar-btn lexera-shared-workspace-menu" type="button">≡</button>
        </div>
      </div>
      <div class="board-list lexera-shared-board-list"></div>
    `;
    mirrorRoot.querySelector('.lexera-shared-board-list').innerHTML = document.getElementById('board-list').innerHTML;
    document.body.appendChild(mirrorRoot);

    BoardList.bindMirroredWorkspaceView(mirrorRoot);

    const focusBtn = mirrorRoot.querySelector('.workspace-section-header[data-workspace-id="ws-1"] .workspace-section-focus');
    expect(focusBtn).toBeTruthy();
    expect(mirrorRoot.querySelector('.board-item[data-board-id="board-1"]')?.closest('.workspace-section-boards')).toBeTruthy();

    focusBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(state.activeWorkspaceId).toBe('ws-2');
    expect(state.viewWorkspaceId).toBe('ws-1');
    expect(state.workspaceViewMode).toBe('manual');
    expect(document.getElementById('workspace-header-title').textContent).toContain('Workspace One');
    expect(mirrorRoot.querySelector('.lexera-shared-workspace-title').textContent).toContain('Workspace One');
    expect(document.querySelector('.board-item[data-board-id="board-1"]')?.closest('.workspace-section-boards')).toBeFalsy();
    expect(document.querySelector('.board-item[data-board-id="board-1"]')?.getAttribute('data-tree-structural-role')).toBe('group');
    expect(document.querySelector('.board-item[data-board-id="board-1"]')?.getAttribute('data-tree-node-role')).toBe('leaf');
    expect(document.querySelector('.board-item[data-board-id="board-2"]')).toBeNull();
    expect(mirrorRoot.querySelector('.board-item[data-board-id="board-2"]')).toBeNull();

    BoardList.reconcileActiveWorkspaceContext({ render: false });

    expect(state.activeWorkspaceId).toBe('ws-2');
    expect(state.viewWorkspaceId).toBe('ws-1');
    expect(state.workspaceViewMode).toBe('manual');
  });
});
