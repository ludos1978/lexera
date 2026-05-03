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
// hierarchy.js delegates board-label resolution to the shared
// `LexeraTitleHelpers` global (registered by `titleHelpers.js`).
const titleHelpersSource = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'titleHelpers.js'),
  'utf8'
);

function loadHierarchyView(window) {
  const helpersFactory = new Function('window', 'globalThis', titleHelpersSource);
  helpersFactory(window, window);
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
          </main>
        </div>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/hierarchy/index.html?panelKind=hierarchy&pane=tab-1' });
}

describe('hierarchy view sub-app', () => {
  it('renders grouped workspace boards, supports collapse, and does not render a workspace list', () => {
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
    capturedOpts.onActiveBoard('board-1');

    expect(window.document.getElementById('status').textContent).toBe('connected');
    // Each window owns exactly one workspace — title shows that workspace's name
    expect(window.document.getElementById('title').textContent).toBe('Workspace Two');
    expect(window.document.getElementById('view-mode').textContent).toBe('manual view');
    expect(window.document.getElementById('local-count').textContent).toBe('(1)');
    expect(window.document.querySelector('#remote-boards')).toBeNull();
    expect(window.document.getElementById('local-boards').textContent).not.toContain('Remote Board');
    // The single visible workspace group is the one this window owns
    expect(window.document.querySelector('[data-workspace-group="ws-2"]')).toBeTruthy();
    expect(window.document.querySelector('[data-workspace-group="ws-1"]')).toBeNull();
    // No workspace picker/list at all.
    expect(window.document.querySelector('#workspaces')).toBeNull();
    expect(window.document.querySelector('.ws-list')).toBeNull();
    expect(window.document.querySelector('[data-workspace-id="__all__"]')).toBeNull();

    // Click the local board → open it
    window.document.querySelector('#local-boards .board-item')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(window.LexeraSubApp.navigate).toHaveBeenNthCalledWith(1, {
      type: 'open-board',
      boardId: 'board-1'
    });
    expect(window.LexeraSubApp.navigate).toHaveBeenCalledTimes(1);
  });

  // Regression 2026-05-03: markdown files without an H1 heading
  // ship with `BoardInfo.title === ""`. Without a filename fallback
  // every such board displayed as "(untitled)" in the hierarchy
  // panel, even though its file had a meaningful basename.
  it('falls back to filename basename (sans `.md`) when title is empty', () => {
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
        { id: 'b1', title: '', filePath: '/workspace/Sprint Plan.md', workspace_id: 'ws-1' },
        { id: 'b2', title: '', file_path: '/workspace/Roadmap.md', workspace_id: 'ws-1' }
      ],
      remoteBoards: [],
      workspaces: [{ id: 'ws-1', name: 'Default' }],
      activeWorkspaceId: 'ws-1',
      activeWorkspace: { id: 'ws-1', name: 'Default' },
      viewWorkspaceId: 'ws-1',
      viewWorkspace: { id: 'ws-1', name: 'Default' },
      workspaceViewMode: 'follow-active-board'
    });
    const items = window.document.querySelectorAll('#local-boards .board-item .board-name');
    const labels = Array.from(items).map((el) => el.textContent);
    expect(labels).toEqual(['Sprint Plan', 'Roadmap']);
    expect(window.document.getElementById('local-boards').textContent).not.toContain('(untitled)');
    expect(window.document.getElementById('local-boards').textContent).not.toContain('.md');
  });

  it('renders the canonical board.title (not the legacy board.name) so real boards do not collapse to (untitled)', () => {
    // BoardInfo from /boards uses `title` (camelCase per Rust serde
    // rename); `name` is a legacy field that's typically absent on
    // real boards. The wrong fallback order (`name || title`) made
    // every row show '(untitled)' because `name` was undefined and
    // `title` could be briefly empty during the initial parse. Same
    // bug as workspaces.js had before commit ff9cbf03.
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
        // Real board: only `title`, no `name`.
        { id: 'real', title: 'Roadmap', workspace_id: 'ws-1' },
        // Legacy-shaped board: only `name`, fallback path.
        { id: 'legacy', name: 'Legacy Board', workspace_id: 'ws-1' },
        // Both fields set: `title` must win (canonical wins over legacy).
        { id: 'both', title: 'Canonical', name: 'Stale', workspace_id: 'ws-1' }
      ],
      remoteBoards: [],
      workspaces: [{ id: 'ws-1', name: 'Default' }],
      activeWorkspaceId: 'ws-1',
      activeWorkspace: { id: 'ws-1', name: 'Default' },
      viewWorkspaceId: 'ws-1',
      viewWorkspace: { id: 'ws-1', name: 'Default' },
      workspaceViewMode: 'follow-active-board'
    });

    const items = window.document.querySelectorAll('#local-boards .board-item');
    const labels = Array.from(items).map((el) => el.querySelector('.board-name').textContent);
    expect(labels).toEqual(['Roadmap', 'Legacy Board', 'Canonical']);
    expect(labels).not.toContain('(untitled)');
    expect(labels).not.toContain('Stale');
  });

  // ── User-interaction API exercise ────────────────────────────────
  // Drives the hierarchy view ONLY through LexeraHierarchyTestApi.
  // A regression that breaks rendering (board list invisible,
  // board items missing makes clickBoard return
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

    expect(state.remote).toEqual([]);
    // Workspace selector is not rendered in this view.
    expect(state.workspaces).toEqual([]);
  });

  it('LexeraHierarchyTestApi.clickBoard dispatches navigate, while clickWorkspace is unavailable', () => {
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

    expect(window.LexeraHierarchyTestApi.clickBoard('remote-1', 'remote')).toBe(false);

    // No workspace list in this view.
    expect(window.LexeraHierarchyTestApi.clickWorkspace('ws-2')).toBe(false);

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

  it('renders remote boards as their own workspace tree when that workspace is open', () => {
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
      workspaces: [{ id: 'ws-1', name: 'Default' }],
      activeWorkspaceId: '__remote_boards__',
      viewWorkspaceId: '__remote_boards__',
      workspaceViewMode: 'manual'
    });
    capturedOpts.onActiveBoard('remote-1');

    const state = window.LexeraHierarchyTestApi.collectState();
    expect(state.title).toBe('Remote Boards');
    expect(state.selectedWorkspaceId).toBe('__remote_boards__');
    expect(state.groups.map((g) => g.id)).toEqual(['__remote_boards__']);
    expect(state.groups[0].boards.map((b) => b.label)).toEqual(['Shared']);
    expect(state.groups[0].boards[0].active).toBe(true);
    expect(window.document.getElementById('local-boards').textContent).not.toContain('Roadmap');

    expect(window.LexeraHierarchyTestApi.clickBoard('remote-1', 'remote')).toBe(true);
    expect(window.LexeraSubApp.navigate).toHaveBeenLastCalledWith({
      type: 'open-board',
      boardId: 'remote-1'
    });
  });

  // ── Unfoldable boards (Phase 1b, TODOs 2026-05-03) ──────────────
  // Each board row inside a workspace group now exposes a caret.
  // Clicking the caret toggles a nested tree showing the board's
  // rows / stacks / columns / cards using their parsed titles.
  describe('unfoldable boards', () => {
    it('renders a caret per board that does not navigate when clicked', () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn()
      };
      window.LexeraApi = { getBoardHierarchy: vi.fn(() => Promise.resolve({ rows: [] })) };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' }],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });

      const caret = window.document.querySelector('#local-boards .board-item .board-caret');
      expect(caret).toBeTruthy();
      expect(caret.getAttribute('aria-expanded')).toBe('false');

      caret.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(window.LexeraSubApp.navigate).not.toHaveBeenCalled();
      expect(window.LexeraApi.getBoardHierarchy).toHaveBeenCalledWith('b1');
    });

    it('expanding a board renders rows / stacks / columns / cards as a nested tree', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn()
      };
      const fakeRows = [{
        id: 'r1', title: 'Backlog',
        stacks: [{
          id: 's1', title: 'Frontend',
          columns: [{
            id: 'c1', title: 'To do',
            cards: [{ id: 'card-1', title: 'Wire caret' }]
          }]
        }]
      }];
      window.LexeraApi = { getBoardHierarchy: vi.fn(() => Promise.resolve({ rows: fakeRows })) };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' }],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });

      const caret = window.document.querySelector('#local-boards .board-item .board-caret');
      caret.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const tree = window.document.querySelector('#local-boards .board-tree');
      expect(tree).toBeTruthy();
      const labels = Array.from(tree.querySelectorAll('.board-tree-label')).map((n) => n.textContent);
      expect(labels).toEqual(['Backlog', 'Frontend', 'To do', 'Wire caret']);
    });
  });
});
