import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'views', 'hierarchy', 'hierarchy.js'),
  'utf8'
);

function loadHierarchyView(window) {
  const factory = new Function('window', 'document', 'LexeraSubApp', source);
  factory(window, window.document, window.LexeraSubApp);
}

function createDom() {
  return new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <div class="sidebar lexera-shared-panel lexera-shared-panel-hierarchy">
          <header class="sidebar-header hierarchy-header">
            <div class="sidebar-header-title-wrap hierarchy-header-main">
              <span class="sidebar-header-title hierarchy-title" id="title">All Workspaces</span>
              <span class="hierarchy-mode" id="view-mode">follow active board</span>
            </div>
            <span class="hierarchy-status" id="status">connecting</span>
          </header>
          <main class="hierarchy-body">
            <section class="hierarchy-section">
              <h3 class="hierarchy-section-title">Workspace tree <span class="muted" id="local-count"></span></h3>
              <ul class="board-list lexera-shared-board-list" id="local-boards"></ul>
            </section>
            <section class="hierarchy-section">
              <h3 class="hierarchy-section-title">Remote boards <span class="muted" id="remote-count"></span></h3>
              <ul class="board-list" id="remote-boards"></ul>
            </section>
            <section class="hierarchy-section">
              <h3 class="hierarchy-section-title">Workspaces <span class="muted" id="ws-count"></span></h3>
              <ul class="ws-list" id="workspaces"></ul>
            </section>
          </main>
        </div>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/hierarchy/index.html?panelKind=hierarchy&pane=tab-1' });
}

describe('hierarchy view sub-app', () => {
  it('renders grouped workspace boards, supports collapse, and navigates for boards and workspaces', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };

    loadHierarchyView(window);

    expect(window.LexeraSubApp.init).toHaveBeenCalledTimes(1);
    expect(typeof capturedOpts.onCatalog).toBe('function');
    expect(typeof capturedOpts.onActiveBoard).toBe('function');
    expect(typeof capturedOpts.onError).toBe('function');

    capturedOpts.onCatalog({
      boards: [
        { id: 'board-1', name: 'Local Board', workspace_id: 'ws-2' }
      ],
      remoteBoards: [{ id: 'board-2', title: 'Remote Board' }],
      workspaces: [
        { id: 'ws-1', name: 'Workspace One' },
        { id: 'ws-2', name: 'Workspace Two' }
      ],
      activeWorkspaceId: 'ws-2',
      activeWorkspace: { id: 'ws-2', name: 'Workspace Two' },
      viewWorkspaceId: 'ws-2',
      viewWorkspace: { id: 'ws-2', name: 'Workspace Two' },
      workspaceViewMode: 'manual'
    });
    capturedOpts.onActiveBoard('board-2');

    expect(window.document.getElementById('status').textContent).toBe('connected');
    // Each window owns exactly one workspace — title shows that workspace's name
    expect(window.document.getElementById('title').textContent).toBe('Workspace Two');
    expect(window.document.getElementById('view-mode').textContent).toBe('manual view');
    expect(window.document.getElementById('local-count').textContent).toBe('(1)');
    expect(window.document.getElementById('remote-count').textContent).toBe('(1)');
    expect(window.document.getElementById('ws-count').textContent).toBe('(2)');
    expect(window.document.querySelector('#remote-boards .board-item')?.classList.contains('is-active')).toBe(true);
    // The single visible workspace group is the one this window owns
    expect(window.document.querySelector('[data-workspace-group="ws-2"]')).toBeTruthy();
    expect(window.document.querySelector('[data-workspace-group="ws-1"]')).toBeNull();
    // No "All Workspaces" pseudo-item in the workspace picker
    expect(window.document.querySelector('[data-workspace-id="__all__"]')).toBeNull();

    // Click the local board → open it
    window.document.querySelector('#local-boards .board-item')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    // Click a sibling workspace → opens a NEW window pinned to it
    window.document.querySelector('#workspaces [data-workspace-id="ws-1"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(window.LexeraSubApp.navigate).toHaveBeenNthCalledWith(1, {
      type: 'open-board',
      boardId: 'board-1'
    });
    expect(window.LexeraSubApp.navigate).toHaveBeenNthCalledWith(2, {
      type: 'open-workspace-window',
      workspaceId: 'ws-1'
    });
  });

  // ── User-interaction API exercise ────────────────────────────────
  // Drives the hierarchy view ONLY through LexeraHierarchyTestApi.
  // A regression that breaks rendering (board list invisible,
  // workspace items missing) makes clickBoard/clickWorkspace return
  // false so the test fails — no false positive.
  it('LexeraHierarchyTestApi.collectState exposes the rendered grouped tree the user sees', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };
    loadHierarchyView(window);

    capturedOpts.onCatalog({
      boards: [
        { id: 'board-1', title: 'Roadmap', workspace_id: 'ws-1' },
        { id: 'board-2', title: 'Sprint', workspace_id: 'ws-1' },
        { id: 'board-orphan', title: 'Orphan' }
      ],
      remoteBoards: [{ id: 'remote-1', title: 'Shared' }],
      workspaces: [{ id: 'ws-1', name: 'Default' }],
      activeWorkspaceId: 'ws-1',
      activeWorkspace: { id: 'ws-1', name: 'Default' },
      viewWorkspaceId: 'ws-1',
      viewWorkspace: { id: 'ws-1', name: 'Default' },
      workspaceViewMode: 'follow-active-board'
    });
    capturedOpts.onActiveBoard('board-2');

    const state = window.LexeraHierarchyTestApi.collectState();
    expect(state.status).toBe('connected');
    // Title is the workspace this window owns — never "All Workspaces"
    expect(state.title).toBe('Default');
    expect(state.activeBoardId).toBe('board-2');
    expect(state.selectedWorkspaceId).toBe('ws-1');

    // Single workspace group — no __unassigned__ pseudo-group
    expect(state.groups.map((g) => g.id)).toEqual(['ws-1']);
    const wsGroup = state.groups[0];
    expect(wsGroup.expanded).toBe(true);
    expect(wsGroup.boards.map((b) => b.label)).toEqual(['Roadmap', 'Sprint']);
    expect(wsGroup.boards.find((b) => b.id === 'board-2').active).toBe(true);

    expect(state.remote.map((b) => b.label)).toEqual(['Shared']);
    // Workspace picker shows only real workspaces — no `__all__` entry
    expect(state.workspaces.map((w) => w.id)).toEqual(['ws-1']);
  });

  it('LexeraHierarchyTestApi.clickBoard / clickWorkspace dispatch the same navigate a real click does', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };
    loadHierarchyView(window);

    capturedOpts.onCatalog({
      boards: [{ id: 'board-1', title: 'Roadmap', workspace_id: 'ws-1' }],
      remoteBoards: [{ id: 'remote-1', title: 'Shared' }],
      workspaces: [
        { id: 'ws-1', name: 'Default' },
        { id: 'ws-2', name: 'Other' }
      ],
      activeWorkspaceId: 'ws-1',
      activeWorkspace: { id: 'ws-1', name: 'Default' },
      viewWorkspaceId: 'ws-1',
      viewWorkspace: { id: 'ws-1', name: 'Default' }
    });

    expect(window.LexeraHierarchyTestApi.clickBoard('board-1')).toBe(true);
    expect(window.LexeraSubApp.navigate).toHaveBeenLastCalledWith({
      type: 'open-board',
      boardId: 'board-1'
    });

    expect(window.LexeraHierarchyTestApi.clickBoard('remote-1', 'remote')).toBe(true);
    expect(window.LexeraSubApp.navigate).toHaveBeenLastCalledWith({
      type: 'open-board',
      boardId: 'remote-1'
    });

    // Clicking a sibling workspace opens a NEW window pinned to it —
    // each window owns exactly one workspace for its lifetime.
    expect(window.LexeraHierarchyTestApi.clickWorkspace('ws-2')).toBe(true);
    expect(window.LexeraSubApp.navigate).toHaveBeenLastCalledWith({
      type: 'open-workspace-window',
      workspaceId: 'ws-2'
    });

    // Unknown ids → no navigate, no false positives.
    expect(window.LexeraHierarchyTestApi.clickBoard('does-not-exist')).toBe(false);
    expect(window.LexeraHierarchyTestApi.clickWorkspace('does-not-exist')).toBe(false);
  });

  it('LexeraHierarchyTestApi.clickWorkspaceGroupHeader toggles expand state without firing a navigate', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };
    loadHierarchyView(window);

    capturedOpts.onCatalog({
      boards: [{ id: 'board-1', title: 'Roadmap', workspace_id: 'ws-1' }],
      remoteBoards: [],
      workspaces: [{ id: 'ws-1', name: 'Default' }],
      activeWorkspaceId: 'ws-1',
      activeWorkspace: { id: 'ws-1', name: 'Default' },
      viewWorkspaceId: 'ws-1',
      viewWorkspace: { id: 'ws-1', name: 'Default' }
    });

    expect(window.LexeraHierarchyTestApi.collectState().groups[0].expanded).toBe(true);
    expect(window.LexeraHierarchyTestApi.clickWorkspaceGroupHeader('ws-1')).toBe(true);
    expect(window.LexeraHierarchyTestApi.collectState().groups[0].expanded).toBe(false);
    // Toggling group must not fire a board/workspace navigate.
    expect(window.LexeraSubApp.navigate).not.toHaveBeenCalled();
  });
});
