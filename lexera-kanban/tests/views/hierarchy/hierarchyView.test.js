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
// The unfolded board structure is rendered through the shared
// TreeView component — register it on the test window so hierarchy.js
// can call `window.TreeView.render(...)` without the production
// HTML's <script> tag.
const treeViewSource = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'treeView.js'),
  'utf8'
);

function loadHierarchyView(window) {
  const helpersFactory = new Function('window', 'globalThis', titleHelpersSource);
  helpersFactory(window, window);
  const treeFactory = new Function('window', 'document', 'getComputedStyle', treeViewSource);
  treeFactory(window, window.document, window.getComputedStyle.bind(window));
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
            <div class="sidebar-header-actions">
              <button class="sidebar-btn" id="new-board-btn" type="button" title="New board" aria-label="New board">+</button>
            </div>
          </header>
          <main class="hierarchy-body">
            <section class="hierarchy-section">
              <div class="board-list lexera-shared-board-list" id="local-boards" role="tree"></div>
            </section>
          </main>
        </div>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/hierarchy/index.html?panelKind=hierarchy&pane=tab-1' });
}

describe('hierarchy view sub-app', () => {
  // User feedback 2026-05-18: the "New board" affordance must live in
  // the real workspace hierarchy header (this webview), not the removed
  // legacy sharedPanels mirror. The slim webview only routes the
  // request; the shell owns the create flow.
  it('routes the header New Board button to a create-new-board navigate', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn(), navigate: vi.fn() };

    loadHierarchyView(window);

    const btn = window.document.getElementById('new-board-btn');
    expect(btn).toBeTruthy();
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(window.LexeraSubApp.navigate).toHaveBeenCalledWith({ type: 'create-new-board' });
  });

  it('renders grouped workspace boards, supports collapse, and does not render a workspace list', async () => {
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

    // Status pill, "Workspace tree" title, and `(N)` count are gone
    // from the panel chrome. The header keeps just the workspace title
    // and the view-mode pill.
    expect(window.document.getElementById('status')).toBeNull();
    expect(window.document.getElementById('local-count')).toBeNull();
    expect(window.document.querySelector('.hierarchy-section-title')).toBeNull();
    expect(window.document.getElementById('title').textContent).toBe('Workspace Two');
    expect(window.document.getElementById('view-mode').textContent).toBe('manual view');
    expect(window.document.querySelector('#remote-boards')).toBeNull();
    expect(window.document.getElementById('local-boards').textContent).not.toContain('Remote Board');
    // Boards are TreeView roots — the workspace name lives in the panel
    // header (#title), NOT as a tree node. Verify there is no workspace
    // tree node at all.
    expect(window.document.querySelector('.tree-node[data-tree-target="workspace"]')).toBeNull();
    expect(window.document.querySelector('.tree-node[data-tree-target="board"][data-board-id="board-1"]')).toBeTruthy();
    // No workspace picker/list at all.
    expect(window.document.querySelector('#workspaces')).toBeNull();
    expect(window.document.querySelector('.ws-list')).toBeNull();
    expect(window.document.querySelector('[data-workspace-id="__all__"]')).toBeNull();

    const menuBtn = window.document.querySelector('#local-boards .tree-node[data-tree-target="board"] .tree-menu-btn');
    expect(menuBtn).toBeTruthy();
    menuBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const openAction = window.document.querySelector('.tree-board-action-menu [data-action="open-tab"]');
    expect(openAction).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    openAction.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(window.document.querySelector('.tree-board-action-menu [data-action="open-tab"]')).toBe(openAction);
    openAction.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(window.LexeraSubApp.navigate).toHaveBeenCalledWith({
      type: 'open-board',
      boardId: 'board-1'
    });
    window.LexeraSubApp.navigate.mockClear();

    // Click the local board's label → open it. Whole-row click on a
    // board node fires the same navigate path a real click does.
    window.document.querySelector('#local-boards .tree-node[data-tree-target="board"] .tree-label')
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
        { id: 'b2', title: '', filePath: '/workspace/Roadmap.md', workspace_id: 'ws-1' }
      ],
      remoteBoards: [],
      workspaces: [{ id: 'ws-1', name: 'Default' }],
      activeWorkspaceId: 'ws-1',
      activeWorkspace: { id: 'ws-1', name: 'Default' },
      viewWorkspaceId: 'ws-1',
      viewWorkspace: { id: 'ws-1', name: 'Default' },
      workspaceViewMode: 'follow-active-board'
    });
    const items = window.document.querySelectorAll('#local-boards .tree-node[data-tree-target="board"] .tree-label');
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

    const items = window.document.querySelectorAll('#local-boards .tree-node[data-tree-target="board"]');
    const labels = Array.from(items).map((el) => el.querySelector('.tree-label').textContent);
    expect(labels).toEqual(['Roadmap', 'Legacy Board', 'Canonical']);
    expect(labels).not.toContain('(untitled)');
    expect(labels).not.toContain('Stale');
  });

  it('same-workspace catalog refresh patches board roots without rebuilding the hierarchy tree', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };
    loadHierarchyView(window);
    const snap = {
      boards: [
        { id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' },
        { id: 'b2', title: 'Sprint', workspace_id: 'ws-1' }
      ],
      remoteBoards: [],
      workspaces: [{ id: 'ws-1', name: 'Default' }],
      activeWorkspaceId: 'ws-1',
      activeWorkspace: { id: 'ws-1', name: 'Default' },
      viewWorkspaceId: 'ws-1',
      viewWorkspace: { id: 'ws-1', name: 'Default' }
    };
    capturedOpts.onCatalog(snap);
    const b1Before = window.document.querySelector('#local-boards .tree-node[data-board-id="b1"]');
    const b2Before = window.document.querySelector('#local-boards .tree-node[data-board-id="b2"]');

    capturedOpts.onCatalog(snap);

    expect(window.document.querySelector('#local-boards .tree-node[data-board-id="b1"]')).toBe(b1Before);
    expect(window.document.querySelector('#local-boards .tree-node[data-board-id="b2"]')).toBe(b2Before);
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
    // Status pill removed from the panel chrome — the test API still
    // exposes the property but it's empty when there's no `#status` element.
    expect(state.status).toBe('');
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

    // Boards are the top-level TreeView roots now; the workspace lives
    // in the panel header, not inside the tree, so there's no workspace
    // node to toggle. The clickWorkspaceGroupHeader API is kept for
    // backwards compat but always returns false.
    expect(window.LexeraHierarchyTestApi.collectState().groups[0].expanded).toBe(true);
    expect(window.LexeraHierarchyTestApi.clickWorkspaceGroupHeader('ws-1')).toBe(false);
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

  // ── Unfoldable boards (TODOs 2026-05-03) ────────────────────────
  // The whole panel is one TreeView: workspace → boards → rows →
  // stacks → columns → cards. Clicking a board's `.tree-toggle` lazily
  // fetches its hierarchy and re-renders the tree with the new depth
  // expanded; clicking its `.tree-label` navigates open the board.
  describe('unfoldable boards', () => {
    it('renders a toggle per board that does not navigate when clicked', () => {
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

      const boardNode = window.document.querySelector(
        '#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"]'
      );
      expect(boardNode).toBeTruthy();
      expect(boardNode.getAttribute('aria-expanded')).toBe('false');
      const toggle = boardNode.querySelector('.tree-toggle');
      expect(toggle).toBeTruthy();

      toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

      // Toggle click triggers the lazy fetch but never navigates open.
      expect(window.LexeraSubApp.navigate).not.toHaveBeenCalled();
      expect(window.LexeraApi.getBoardHierarchy).toHaveBeenCalledWith('b1');
    });

    it('expanding a board renders rows / stacks / columns / cards inside the same TreeView', async () => {
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

      const toggle = window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"]')
        .querySelector('.tree-toggle');
      toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      // The whole panel is one TreeView. Walk down from the board node
      // and assert that the row/stack/column/card subtree appears with
      // canonical titles, in order.
      const boardEntry = window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"]')
        .parentElement;
      const subtreeChildren = boardEntry.querySelector('.tree-children');
      expect(subtreeChildren).toBeTruthy();
      const labels = Array.from(subtreeChildren.querySelectorAll('.tree-label'))
        .map((n) => n.textContent);
      expect(labels).toEqual(['Backlog', 'Frontend', 'To do', 'Wire caret']);

      // Phase 2a: row / stack / column / card nodes carry a TreeView
      // drag grip (`.tree-grip` SVG icon, NOT the spacer variant) so
      // the user sees the same drag affordance the dashboard, files
      // panel, and main board sidebar show. Actual drop wiring is
      // Phase 2b — this assertion only pins the visual grip contract.
      const grips = subtreeChildren.querySelectorAll('.tree-grip');
      const realGrips = Array.from(grips).filter((g) => !g.classList.contains('tree-grip-spacer'));
      expect(realGrips.length).toBeGreaterThanOrEqual(4); // row + stack + column + card
      const types = realGrips.map((g) => Array.from(g.classList)
        .filter((c) => c.startsWith('entity-drag-icon-'))[0]);
      expect(types).toContain('entity-drag-icon-row');
      expect(types).toContain('entity-drag-icon-stack');
      expect(types).toContain('entity-drag-icon-column');
      expect(types).toContain('entity-drag-icon-card');
      // The board node itself stays grip-less — it's a TreeView root,
      // not a draggable child of anything.
      const boardNode = window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"]');
      const boardGrip = boardNode.querySelector('.tree-grip');
      expect(boardGrip.classList.contains('tree-grip-spacer')).toBe(true);

      // Pointer-based drag: every entity inside an expanded board
      // carries `data-drag-kind` and `data-drag-board-id` so the
      // mousedown listener can identify its source without walking
      // the DOM. The pointer-drag wiring uses these attrs (not the
      // unreliable HTML5 `draggable` attribute) — see workspaces.js
      // and hierarchy.js for the reasoning.
      const draggableNodes = subtreeChildren.querySelectorAll('.tree-node[data-drag-kind]');
      expect(draggableNodes.length).toBeGreaterThanOrEqual(4);
      const dragKinds = Array.from(draggableNodes)
        .map((n) => n.getAttribute('data-drag-kind'));
      expect(dragKinds).toContain('row');
      expect(dragKinds).toContain('stack');
      expect(dragKinds).toContain('column');
      expect(dragKinds).toContain('card');
      const boardIds = Array.from(draggableNodes)
        .map((n) => n.getAttribute('data-drag-board-id'));
      expect(boardIds.every((id) => id === 'b1')).toBe(true);
      // Board nodes themselves get no drag affordance — they are
      // TreeView roots, not children of anything reorderable.
      expect(boardNode.getAttribute('data-drag-kind')).toBeNull();
    });

    // Pointer-based drag/drop helpers. JSDOM's `elementFromPoint`
    // returns null without layout and `getBoundingClientRect()` returns
    // zeros, so we stub both per-test. Mirrors the production flow:
    //   mousedown on source → mousemove (cross threshold) → mousemove
    //   (over target) → mouseup (over target) — no HTML5 drag events.
    //
    // `opts.zone`: 'before' | 'after' — controls which half of the
    // target's bounding rect the cursor lands on. Defaults to 'before'
    // (top half).
    function pointerDragSequence(window, sourceEl, targetEl, opts) {
      opts = opts || {};
      var origElementFromPoint = window.document.elementFromPoint;
      // Stub the target's getBoundingClientRect so the zone math has
      // a known midpoint. Targets are 100px tall starting at y=200, so
      // top-half y = 220 and bottom-half y = 280.
      var origGetRect = targetEl ? targetEl.getBoundingClientRect : null;
      if (targetEl) {
        targetEl.getBoundingClientRect = function () {
          return { top: 200, bottom: 300, height: 100, left: 0, right: 200, width: 200 };
        };
      }
      var targetY = opts.zone === 'after' ? 280 : 220;
      // hierarchy.js now listens for pointer events (so setPointerCapture
      // can keep events flowing across Tauri webview boundaries — see
      // hierarchy.js pointerdown handler). Tests dispatch PointerEvent
      // when available, falling back to MouseEvent for older JSDOM.
      var Ctor = (typeof window.PointerEvent === 'function') ? window.PointerEvent : window.MouseEvent;
      function makeEvt(type, x, y) {
        return new Ctor(type, {
          bubbles: true, cancelable: true,
          button: 0, pointerId: 1, pointerType: 'mouse',
          clientX: x, clientY: y
        });
      }
      sourceEl.dispatchEvent(makeEvt('pointerdown', 10, 10));
      window.document.elementFromPoint = function () { return sourceEl; };
      window.document.dispatchEvent(makeEvt('pointermove', 11, 11));
      window.document.dispatchEvent(makeEvt('pointermove', 50, 50));
      if (targetEl) {
        window.document.elementFromPoint = function () { return targetEl; };
        window.document.dispatchEvent(makeEvt('pointermove', 100, targetY));
      }
      if (opts.skipMouseup) {
        window.document.elementFromPoint = origElementFromPoint;
        if (targetEl && origGetRect) targetEl.getBoundingClientRect = origGetRect;
        return;
      }
      window.document.dispatchEvent(makeEvt('pointerup', 100, targetY));
      window.document.elementFromPoint = origElementFromPoint;
      if (targetEl && origGetRect) targetEl.getBoundingClientRect = origGetRect;
    }

    // Pointer-based dragstart broadcasts `hierarchy-entity-drag-start`
    // with the source identity once the threshold is crossed.
    it('mousedown + threshold-crossing mousemove broadcasts hierarchy-entity-drag-start', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      const broadcastCalls = [];
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn((event, payload) => { broadcastCalls.push({ event, payload }); })
      };
      const fakeRows = [{
        id: 'r1', title: 'Backlog',
        stacks: [{
          id: 's1', title: 'Frontend',
          columns: [{ id: 'c1', title: 'To do',
            cards: [{ id: 'card-1', title: 'Wire caret' }] }]
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
      // Expand the board so the card node is in the DOM.
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const cardNode = window.document.querySelector(
        '#local-boards .tree-node[data-drag-kind="card"]'
      );
      expect(cardNode).toBeTruthy();

      // Drive the pointer sequence (mousedown → threshold mousemove)
      // without a target so no drop fires; we only care about the
      // drag-start broadcast.
      pointerDragSequence(window, cardNode, null, { skipMouseup: true });

      const dragBroadcast = broadcastCalls.find((c) => c.event === 'hierarchy-entity-drag-start');
      expect(dragBroadcast).toBeTruthy();
      // Stage 17b: drag-start broadcast now includes sourceWebviewLabel
      // so destination per-webview trackers can self-skip the
      // broadcasting webview's own drag.
      expect(dragBroadcast.payload).toEqual({
        boardId: 'b1', kind: 'card', entityId: 'card-1',
        entityIds: ['card-1'],
        sourceWebviewLabel: ''
      });
    });

    // Phase 2b-2-b + Phase 3: dragging a card over a sibling card
    // adds `.is-drop-target` to the target; dropping fires
    // `hierarchy-entity-drop` with { source, target }. Cross-board
    // drops are accepted (Phase 3); cross-kind drops still rejected
    // (Phase 4 territory).
    it('dragover marks same-kind same-board sibling as drop target; drop broadcasts source+target', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      const broadcastCalls = [];
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn((event, payload) => { broadcastCalls.push({ event, payload }); })
      };
      const fakeRows = [{
        id: 'r1', title: 'Backlog',
        stacks: [{
          id: 's1', title: 'Frontend',
          columns: [{ id: 'c1', title: 'To do', cards: [
            { id: 'card-1', title: 'A' },
            { id: 'card-2', title: 'B' }
          ] }]
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
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const cards = window.document.querySelectorAll(
        '#local-boards .tree-node[data-drag-kind="card"]'
      );
      const sourceCard = cards[0];
      const targetCard = cards[1];

      // Drive the full pointer sequence: source mousedown → threshold-
      // crossing mousemoves → mousemove over target (marks is-drop-
      // target) → mouseup over target (fires the drop broadcast).
      pointerDragSequence(window, sourceCard, targetCard);

      // After mouseup, the drop-target indicator is cleared. Drop
      // broadcast carries source + target with a `position`. Default
      // helper drives the cursor onto the TOP half → position 'before'.
      expect(targetCard.classList.contains('is-drop-target')).toBe(false);
      const dropBroadcast = broadcastCalls.find((c) => c.event === 'hierarchy-entity-drop');
      expect(dropBroadcast).toBeTruthy();
      expect(dropBroadcast.payload.source).toEqual({
        boardId: 'b1', kind: 'card', entityId: 'card-1', entityIds: ['card-1']
      });
      expect(dropBroadcast.payload.target.boardId).toBe('b1');
      expect(dropBroadcast.payload.target.kind).toBe('card');
      expect(dropBroadcast.payload.target.entityId).toBe('card-2');
      expect(dropBroadcast.payload.target.position).toBe('before');
    });

    // Zone-aware drop: cursor on the bottom half of a sibling sets
    // `target.position = 'after'`; the bridge inserts the source past
    // the target instead of in front of it.
    it('drop on the bottom half of a sibling carries position=after', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      const broadcastCalls = [];
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn((event, payload) => { broadcastCalls.push({ event, payload }); })
      };
      window.LexeraApi = { getBoardHierarchy: vi.fn(() => Promise.resolve({
        rows: [{ id: 'r1', title: 'R', stacks: [{
          id: 's1', title: 'S', columns: [{
            id: 'c1', title: 'C',
            cards: [{ id: 'card-1', title: 'A' }, { id: 'card-2', title: 'B' }]
          }]
        }] }]
      })) };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' }],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const cards = window.document.querySelectorAll('#local-boards .tree-node[data-drag-kind="card"]');
      pointerDragSequence(window, cards[0], cards[1], { zone: 'after' });
      const dropBroadcast = broadcastCalls.find((c) => c.event === 'hierarchy-entity-drop');
      expect(dropBroadcast).toBeTruthy();
      expect(dropBroadcast.payload.target.position).toBe('after');
    });

    // User contract 2026-05-09: "if dropped on a parent it should
    // highlight it and append as last item". Absorb works on ANY
    // matching parent — empty or not. The shell-side
    // applyEntityAbsorb appends to the end of the children array
    // regardless of how many siblings already exist.
    it('column → stack absorb fires hierarchy-entity-drop on both empty and non-empty parents (append-as-last)', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      const broadcastCalls = [];
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn((event, payload) => { broadcastCalls.push({ event, payload }); })
      };
      window.LexeraApi = { getBoardHierarchy: vi.fn(() => Promise.resolve({
        rows: [{ id: 'r1', title: 'R', stacks: [{
          id: 's1', title: 'Stack with columns',
          columns: [{ id: 'c1', title: 'Col 1', cards: [] }]
        }, {
          id: 's2', title: 'Empty stack', columns: []
        }] }]
      })) };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' }],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      // Drag column c1 onto s1 (stack that already contains c1) —
      // now permitted: applyEntityAbsorb appends c1 to s1.columns.
      var sourceCol = window.document.querySelector('.tree-node[data-drag-kind="column"][data-tree-id="c1"]');
      var nonEmptyStack = window.document.querySelector('.tree-node[data-drag-kind="stack"][data-tree-id="s1"]');
      pointerDragSequence(window, sourceCol, nonEmptyStack);
      var dropOnNonEmpty = broadcastCalls.find((c) => c.event === 'hierarchy-entity-drop');
      expect(dropOnNonEmpty).toBeTruthy();
      expect(dropOnNonEmpty.payload.target.kind).toBe('stack');
      expect(dropOnNonEmpty.payload.target.entityId).toBe('s1');
      // Cross-kind absorb has no `position` — semantic is "append to
      // the end of the parent's children".
      expect(dropOnNonEmpty.payload.target.position).toBeUndefined();

      // Same source column onto s2 (empty stack) is also permitted.
      broadcastCalls.length = 0;
      var emptyStack = window.document.querySelector('.tree-node[data-drag-kind="stack"][data-tree-id="s2"]');
      pointerDragSequence(window, sourceCol, emptyStack);
      var dropOnEmpty = broadcastCalls.find((c) => c.event === 'hierarchy-entity-drop');
      expect(dropOnEmpty).toBeTruthy();
      expect(dropOnEmpty.payload.target.kind).toBe('stack');
      expect(dropOnEmpty.payload.target.entityId).toBe('s2');
    });

    // Drop a row directly onto the kanban (board node) — row joins
    // `board.rows`. The board node carries `data-tree-target="board"`
    // (no `data-drag-kind`) so the readDropTargetFromPoint helper
    // accepts it ONLY when the source is a row.
    it('row dropped onto the board node fires hierarchy-entity-drop with target.kind="board"', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      const broadcastCalls = [];
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn((event, payload) => { broadcastCalls.push({ event, payload }); })
      };
      window.LexeraApi = { getBoardHierarchy: vi.fn(() => Promise.resolve({
        rows: [
          { id: 'r1', title: 'Row 1', stacks: [] },
          { id: 'r2', title: 'Row 2', stacks: [] }
        ]
      })) };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' }],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const sourceRow = window.document.querySelector('#local-boards .tree-node[data-drag-kind="row"][data-tree-id="r1"]');
      const boardNode = window.document.querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"]');
      expect(sourceRow).toBeTruthy();
      expect(boardNode).toBeTruthy();

      pointerDragSequence(window, sourceRow, boardNode);
      const dropBroadcast = broadcastCalls.find((c) => c.event === 'hierarchy-entity-drop');
      expect(dropBroadcast).toBeTruthy();
      expect(dropBroadcast.payload.source).toEqual({
        boardId: 'b1', kind: 'row', entityId: 'r1', entityIds: ['r1']
      });
      expect(dropBroadcast.payload.target.kind).toBe('board');
      expect(dropBroadcast.payload.target.boardId).toBe('b1');
      // Cross-kind absorb → no `position` set (always appended).
      expect(dropBroadcast.payload.target.position).toBeUndefined();
    });

    it('non-row sources cannot drop onto the board node', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      const broadcastCalls = [];
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn((event, payload) => { broadcastCalls.push({ event, payload }); })
      };
      window.LexeraApi = { getBoardHierarchy: vi.fn(() => Promise.resolve({
        rows: [{ id: 'r1', title: 'R', stacks: [{ id: 's1', title: 'S', columns: [{
          id: 'c1', title: 'C', cards: [{ id: 'card-1', title: 'A' }]
        }] }] }]
      })) };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' }],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const cardNode = window.document.querySelector('#local-boards .tree-node[data-drag-kind="card"]');
      const boardNode = window.document.querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"]');
      pointerDragSequence(window, cardNode, boardNode);
      const dropBroadcast = broadcastCalls.find((c) => c.event === 'hierarchy-entity-drop');
      expect(dropBroadcast).toBeFalsy();
    });

    // Phase 3: cross-board drop is accepted. The sub-app shows a
    // single workspace; the user has two of its boards expanded and
    // drags a card from one onto a card in the other.
    it('cross-board same-kind drop fires broadcast with both source and target board ids', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      const broadcastCalls = [];
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn((event, payload) => { broadcastCalls.push({ event, payload }); })
      };
      // Each board's getBoardHierarchy call resolves with a different
      // single-card column so the source and target cards are
      // unambiguously in different boards.
      const hierarchyByBoard = {
        b1: [{ id: 'r-b1', title: 'R', stacks: [{ id: 's-b1', title: 'S',
          columns: [{ id: 'c-b1', title: 'C', cards: [{ id: 'card-b1', title: 'A' }] }] }] }],
        b2: [{ id: 'r-b2', title: 'R', stacks: [{ id: 's-b2', title: 'S',
          columns: [{ id: 'c-b2', title: 'C', cards: [{ id: 'card-b2', title: 'B' }] }] }] }]
      };
      window.LexeraApi = {
        getBoardHierarchy: vi.fn((id) => Promise.resolve({ rows: hierarchyByBoard[id] || [] }))
      };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [
          { id: 'b1', title: 'Board 1', workspace_id: 'ws-1' },
          { id: 'b2', title: 'Board 2', workspace_id: 'ws-1' }
        ],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });
      // Expand both boards so their cards are in the DOM.
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b2"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const sourceCard = window.document.querySelector(
        '#local-boards .tree-node[data-drag-kind="card"][data-drag-board-id="b1"]'
      );
      const targetCard = window.document.querySelector(
        '#local-boards .tree-node[data-drag-kind="card"][data-drag-board-id="b2"]'
      );
      expect(sourceCard).toBeTruthy();
      expect(targetCard).toBeTruthy();

      pointerDragSequence(window, sourceCard, targetCard);
      const dropBroadcast = broadcastCalls.find((c) => c.event === 'hierarchy-entity-drop');
      expect(dropBroadcast).toBeTruthy();
      expect(dropBroadcast.payload.source.boardId).toBe('b1');
      expect(dropBroadcast.payload.target.boardId).toBe('b2');
      expect(dropBroadcast.payload.source.entityId).toBe('card-b1');
      expect(dropBroadcast.payload.target.entityId).toBe('card-b2');
    });

    // Phase 4: card → column is now an ACCEPTED absorb drop (the bridge
    // moves the card into the column's `cards` array). Other cross-kind
    // pairs that aren't one-level-up containers (e.g. card → row) are
    // still rejected.
    it('card → column absorb drop fires broadcast with cross-kind source/target', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      const broadcastCalls = [];
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn((event, payload) => { broadcastCalls.push({ event, payload }); })
      };
      const fakeRows = [{
        id: 'r1', title: 'Backlog',
        stacks: [{ id: 's1', title: 'Frontend', columns: [
          { id: 'c1', title: 'To do', cards: [{ id: 'card-1', title: 'A' }] },
          { id: 'c2', title: 'Done', cards: [] }
        ] }]
      }];
      window.LexeraApi = { getBoardHierarchy: vi.fn(() => Promise.resolve({ rows: fakeRows })) };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' }],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const cardNode = window.document.querySelector('.tree-node[data-drag-kind="card"][data-tree-id="card-1"]');
      // Drop the card onto column c2 (the empty Done column).
      const columnNode = window.document.querySelector('.tree-node[data-drag-kind="column"][data-tree-id="c2"]');
      expect(cardNode).toBeTruthy();
      expect(columnNode).toBeTruthy();
      pointerDragSequence(window, cardNode, columnNode);
      const dropBroadcast = broadcastCalls.find((c) => c.event === 'hierarchy-entity-drop');
      expect(dropBroadcast).toBeTruthy();
      expect(dropBroadcast.payload.source.kind).toBe('card');
      expect(dropBroadcast.payload.target.kind).toBe('column');
      expect(dropBroadcast.payload.source.entityId).toBe('card-1');
      expect(dropBroadcast.payload.target.entityId).toBe('c2');
    });

    it('non-adjacent cross-kind drop (card → row) stays rejected', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      const broadcastCalls = [];
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn((event, payload) => { broadcastCalls.push({ event, payload }); })
      };
      const fakeRows = [{
        id: 'r1', title: 'Backlog',
        stacks: [{ id: 's1', title: 'Frontend', columns: [
          { id: 'c1', title: 'To do', cards: [{ id: 'card-1', title: 'A' }] }
        ] }]
      }];
      window.LexeraApi = { getBoardHierarchy: vi.fn(() => Promise.resolve({ rows: fakeRows })) };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' }],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const cardNode = window.document.querySelector('.tree-node[data-drag-kind="card"]');
      const rowNode = window.document.querySelector('.tree-node[data-drag-kind="row"]');
      // Card → row is two levels up — not a valid absorb. Even though
      // the pointer drag fires a drag-start broadcast, the drop must
      // be silently rejected.
      pointerDragSequence(window, cardNode, rowNode);
      expect(rowNode.classList.contains('is-drop-target')).toBe(false);
      const dropBroadcast = broadcastCalls.find((c) => c.event === 'hierarchy-entity-drop');
      expect(dropBroadcast).toBeFalsy();
    });

    // Phase 5 sender side: when the cursor leaves every local drop
    // target during a drag, the sub-app routes `external-dnd-hover`
    // by screen coordinate to whichever other webview the cursor is
    // over. mouseup outside any local target routes
    // `external-dnd-drop` instead of the local `hierarchy-entity-drop`.
    it('cross-view drag-move/drag-end-external routes fire when no local target is hit', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      const broadcastCalls = [];
      const invokeCalls = [];
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn((event, payload) => { broadcastCalls.push({ event, payload }); }),
        invoke: vi.fn((command, args) => { invokeCalls.push({ command, args }); }),
        getCurrentWebview: vi.fn(() => ({ label: 'workspaces-sub-app' }))
      };
      window.LexeraApi = { getBoardHierarchy: vi.fn(() => Promise.resolve({
        rows: [{ id: 'r1', title: 'R', stacks: [{ id: 's1', title: 'S', columns: [{
          id: 'c1', title: 'C', cards: [{ id: 'card-1', title: 'A' }]
        }] }] }]
      })) };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' }],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const cardNode = window.document.querySelector('#local-boards .tree-node[data-drag-kind="card"]');
      expect(cardNode).toBeTruthy();

      // Drive a pointer drag where the cursor never lands on a valid
      // local target. Explicitly stub `elementFromPoint` so it never
      // resolves to a tree-node — exactly the cross-view scenario.
      const origEFP = window.document.elementFromPoint;
      window.document.elementFromPoint = function () { return window.document.body; };

      // hierarchy.js listens for pointer events (so setPointerCapture
      // can keep events flowing across Tauri webview boundaries).
      const PE = (typeof window.PointerEvent === 'function') ? window.PointerEvent : window.MouseEvent;
      const evtInit = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse' };
      cardNode.dispatchEvent(new PE('pointerdown', Object.assign({ clientX: 10, clientY: 10 }, evtInit)));
      // First move below threshold.
      window.document.dispatchEvent(new PE('pointermove', Object.assign({ clientX: 11, clientY: 11 }, evtInit)));
      // Cross threshold — should fire drag-start.
      window.document.dispatchEvent(new PE('pointermove', Object.assign({ clientX: 100, clientY: 200 }, evtInit)));
      // No local match → also fires drag-move.
      window.document.dispatchEvent(new PE('pointermove', Object.assign({ clientX: 200, clientY: 300 }, evtInit)));
      // Release with no local target → fires drag-end-external, NOT
      // hierarchy-entity-drop.
      window.document.dispatchEvent(new PE('pointerup', Object.assign({ clientX: 200, clientY: 300 }, evtInit)));

      const dragStart = broadcastCalls.find((c) => c.event === 'hierarchy-entity-drag-start');
      expect(dragStart).toBeTruthy();

      const dragMove = invokeCalls.find((c) =>
        c.command === 'multiview_route_external_dnd' &&
        c.args && c.args.request && c.args.request.event === 'external-dnd-hover'
      );
      expect(dragMove).toBeTruthy();
      expect(dragMove.args.request.sourceWebviewLabel).toBe('workspaces-sub-app');
      expect(typeof dragMove.args.request.sourceClientX).toBe('number');
      expect(typeof dragMove.args.request.sourceClientY).toBe('number');
      expect(typeof dragMove.args.request.screenX).toBe('number');
      expect(typeof dragMove.args.request.screenY).toBe('number');
      expect(dragMove.args.request.source).toEqual({
        boardId: 'b1', kind: 'card', entityId: 'card-1', entityIds: ['card-1']
      });
      expect(dragMove.args.request.dndType).toBe('tree-card');

      const dragEnd = invokeCalls.find((c) =>
        c.command === 'multiview_route_external_dnd' &&
        c.args && c.args.request && c.args.request.event === 'external-dnd-drop'
      );
      expect(dragEnd).toBeTruthy();
      expect(dragEnd.args.request.sourceWebviewLabel).toBe('workspaces-sub-app');
      expect(dragEnd.args.request.sourceClientX).toBe(200);
      expect(dragEnd.args.request.sourceClientY).toBe(300);
      expect(typeof dragEnd.args.request.screenX).toBe('number');
      expect(typeof dragEnd.args.request.screenY).toBe('number');

      // Local drop NOT fired (no local target matched).
      expect(broadcastCalls.find((c) => c.event === 'hierarchy-entity-drop')).toBeFalsy();

      window.document.elementFromPoint = origEFP;
    });

    // dblclick on a row / stack / column / card label opens an inline
    // input. Enter commits and broadcasts `hierarchy-entity-rename`;
    // Escape cancels without firing a broadcast.
    it('dblclick on a card label opens an inline editor that broadcasts hierarchy-entity-rename on Enter', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      const broadcastCalls = [];
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn((event, payload) => { broadcastCalls.push({ event, payload }); })
      };
      window.LexeraApi = { getBoardHierarchy: vi.fn(() => Promise.resolve({
        rows: [{ id: 'r1', title: 'R', stacks: [{ id: 's1', title: 'S', columns: [{
          id: 'c1', title: 'C', cards: [{ id: 'card-1', title: 'A' }]
        }] }] }]
      })) };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' }],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const cardNode = window.document.querySelector(
        '#local-boards .tree-node[data-drag-kind="card"]'
      );
      cardNode.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      const input = cardNode.querySelector('.tree-rename-input');
      expect(input).toBeTruthy();
      expect(input.value).toBe('A');
      input.value = 'Renamed!';
      input.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));

      const renameBroadcast = broadcastCalls.find((c) => c.event === 'hierarchy-entity-rename');
      expect(renameBroadcast).toBeTruthy();
      expect(renameBroadcast.payload.source).toEqual({
        boardId: 'b1', kind: 'card', entityId: 'card-1'
      });
      expect(renameBroadcast.payload.newTitle).toBe('Renamed!');
      // Editor was removed from the DOM.
      expect(cardNode.querySelector('.tree-rename-input')).toBeFalsy();
    });

    it('Escape cancels the inline editor without firing a broadcast', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      const broadcastCalls = [];
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn((event, payload) => { broadcastCalls.push({ event, payload }); })
      };
      window.LexeraApi = { getBoardHierarchy: vi.fn(() => Promise.resolve({
        rows: [{ id: 'r1', title: 'R', stacks: [{ id: 's1', title: 'S', columns: [{
          id: 'c1', title: 'C', cards: [{ id: 'card-1', title: 'Original' }]
        }] }] }]
      })) };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' }],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const cardNode = window.document.querySelector('#local-boards .tree-node[data-drag-kind="card"]');
      cardNode.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      const input = cardNode.querySelector('.tree-rename-input');
      input.value = 'Throwaway change';
      input.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));

      const renameBroadcast = broadcastCalls.find((c) => c.event === 'hierarchy-entity-rename');
      expect(renameBroadcast).toBeFalsy();
      expect(cardNode.querySelector('.tree-rename-input')).toBeFalsy();
    });

    // Right-click on an entity row is intentionally not assigned —
    // the browser's default context menu is suppressed so it doesn't
    // pop up over the tree.
    it('contextmenu on an entity row is preventDefault-ed', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn()
      };
      window.LexeraApi = { getBoardHierarchy: vi.fn(() => Promise.resolve({
        rows: [{ id: 'r1', title: 'R', stacks: [{ id: 's1', title: 'S', columns: [{
          id: 'c1', title: 'C', cards: [{ id: 'card-1', title: 'A' }]
        }] }] }]
      })) };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' }],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const cardNode = window.document.querySelector('#local-boards .tree-node[data-drag-kind="card"]');
      const ctxEv = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      cardNode.dispatchEvent(ctxEv);
      expect(ctxEv.defaultPrevented).toBe(true);
    });

    // After the shell-side bridge persists a drop it broadcasts
    // `hierarchy-board-changed` to every webview in the window. The
    // sub-app must drop the cached hierarchy for that board and, if
    // the board is currently expanded, refetch immediately so the
    // user sees the new ordering without having to collapse and
    // re-expand the board.
    it('hierarchy-board-changed event invalidates the cached hierarchy and refetches an expanded board', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn(),
        broadcast: vi.fn()
      };
      let fetchCount = 0;
      const hierarchyVersions = [
        [{ id: 'r1', title: 'V1', stacks: [] }],
        [{ id: 'r1', title: 'V2 (after reorder)', stacks: [] }]
      ];
      window.LexeraApi = {
        getBoardHierarchy: vi.fn(() => Promise.resolve({
          rows: hierarchyVersions[Math.min(fetchCount++, 1)]
        }))
      };
      loadHierarchyView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap', workspace_id: 'ws-1' }],
        remoteBoards: [],
        workspaces: [{ id: 'ws-1', name: 'Default' }],
        activeWorkspaceId: 'ws-1'
      });
      // Expand the board → first fetch.
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
      // Confirm V1 is visible.
      function rowLabels() {
        const entry = window.document
          .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"]')
          .parentElement;
        return Array.from(entry.querySelectorAll('.tree-children .tree-row > .tree-label'))
          .map((n) => n.textContent);
      }
      expect(rowLabels()).toEqual(['V1']);
      expect(window.LexeraApi.getBoardHierarchy).toHaveBeenCalledTimes(1);
      const boardNodeBefore = window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"]');
      const boardChildrenBefore = window.TreeView.getNodeChildrenContainer(boardNodeBefore);
      const patchSpy = vi.spyOn(window.TreeView, 'patch');

      // Fire the change event the bridge would broadcast after a save.
      capturedOpts.onCustom['hierarchy-board-changed']({ boardId: 'b1' });
      await new Promise((r) => setTimeout(r, 0));
      // Cache invalidated + immediate refetch (board still expanded).
      expect(window.LexeraApi.getBoardHierarchy).toHaveBeenCalledTimes(2);
      expect(window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"]'))
        .toBe(boardNodeBefore);
      expect(patchSpy).toHaveBeenCalled();
      expect(patchSpy.mock.calls[0][0]).toBe(boardChildrenBefore);
      expect(patchSpy.mock.calls.find((call) => call[0] === window.document.getElementById('local-boards'))).toBeFalsy();
      expect(rowLabels()).toEqual(['V2 (after reorder)']);
      expect(window.document.querySelector('#local-boards .tree-row').getAttribute('data-tree-depth')).toBe('2');
      patchSpy.mockRestore();
    });

    // Regression 2026-05-03: rows / stacks / columns inside an expanded
    // board must be foldable too. They are rendered with TreeView's
    // built-in toggle; clicking it flips the `.tree-children.expanded`
    // class so the user can collapse a row to focus on others.
    it('row / stack / column toggles fold and unfold their children in-place', async () => {
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
          columns: [{ id: 'c1', title: 'To do', cards: [{ id: 'card-1', title: 'Wire caret' }] }]
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
      // Expand the board so the row/stack/column tree is visible.
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      function rowEntry() {
        // The row node lives one level under the expanded board.
        const boardEntry = window.document
          .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"]')
          .parentElement;
        return boardEntry.querySelector('.tree-children > .tree-entry');
      }
      const rowToggle = rowEntry().querySelector('.tree-toggle');
      const rowChildren = rowEntry().querySelector('.tree-children');
      expect(rowChildren.classList.contains('expanded')).toBe(true);

      // Fold the row.
      rowToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(rowChildren.classList.contains('expanded')).toBe(false);
      // Did not navigate.
      expect(window.LexeraSubApp.navigate).not.toHaveBeenCalled();

      // Unfold again — children re-appear without a refetch.
      rowToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(rowChildren.classList.contains('expanded')).toBe(true);
      expect(window.LexeraApi.getBoardHierarchy).toHaveBeenCalledTimes(1);
    });

    // Alt+click on a row / stack / column toggle folds or unfolds every
    // descendant `.tree-children` container in one go, mirroring the
    // kanban sidebar behaviour (boardList.js). The clicked node's own
    // expand state stays put — only descendants change.
    it('alt+click on a row toggle folds/unfolds all descendants', async () => {
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
          columns: [{ id: 'c1', title: 'To do', cards: [{ id: 'card-1', title: 'Wire caret' }] }]
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
      window.document
        .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      const rowNode = window.document.querySelector('#local-boards .tree-row');
      const rowEntryEl = rowNode.parentElement;
      const rowChildren = rowEntryEl.querySelector('.tree-children');
      const stackChildren = rowChildren.querySelector('.tree-stack + .tree-children');
      const columnChildren = stackChildren.querySelector('.tree-column + .tree-children');

      // Sanity: everything is expanded after the board fetch.
      expect(rowChildren.classList.contains('expanded')).toBe(true);
      expect(stackChildren.classList.contains('expanded')).toBe(true);
      expect(columnChildren.classList.contains('expanded')).toBe(true);

      // Alt+click on the row toggle → all descendants collapse, row stays expanded.
      rowNode.querySelector('.tree-toggle').dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true, altKey: true })
      );
      expect(rowChildren.classList.contains('expanded')).toBe(true);
      expect(stackChildren.classList.contains('expanded')).toBe(false);
      expect(columnChildren.classList.contains('expanded')).toBe(false);

      // Alt+click again → all descendants expand back.
      rowNode.querySelector('.tree-toggle').dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true, altKey: true })
      );
      expect(rowChildren.classList.contains('expanded')).toBe(true);
      expect(stackChildren.classList.contains('expanded')).toBe(true);
      expect(columnChildren.classList.contains('expanded')).toBe(true);
    });

    // Alt+click on an EXPANDED board's toggle folds every descendant
    // `.tree-children` without collapsing the board itself. Alt+click
    // on a COLLAPSED board falls through to the normal expand path.
    it('alt+click on an expanded board toggle folds descendants without collapsing the board', async () => {
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
          columns: [{ id: 'c1', title: 'To do', cards: [{ id: 'card-1', title: 'Wire caret' }] }]
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

      function findBoardToggle() {
        return window.document.querySelector(
          '#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"] .tree-toggle'
        );
      }
      function findBoardChildren() {
        return window.document
          .querySelector('#local-boards .tree-node[data-tree-target="board"][data-board-id="b1"]')
          .parentElement.querySelector('.tree-children');
      }

      // Alt+click on collapsed board → falls through to normal toggle, board expands.
      findBoardToggle().dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true, altKey: true })
      );
      await new Promise((r) => setTimeout(r, 0));
      const boardChildren = findBoardChildren();
      expect(boardChildren.classList.contains('expanded')).toBe(true);
      const rowChildren = boardChildren.querySelector('.tree-row + .tree-children');
      const stackChildren = rowChildren.querySelector('.tree-stack + .tree-children');
      expect(rowChildren.classList.contains('expanded')).toBe(true);
      expect(stackChildren.classList.contains('expanded')).toBe(true);

      // Alt+click on expanded board → descendants collapse, board stays open.
      findBoardToggle().dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true, altKey: true })
      );
      expect(boardChildren.classList.contains('expanded')).toBe(true);
      expect(rowChildren.classList.contains('expanded')).toBe(false);
      expect(stackChildren.classList.contains('expanded')).toBe(false);

      // Alt+click again → everything expands back.
      findBoardToggle().dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true, altKey: true })
      );
      expect(boardChildren.classList.contains('expanded')).toBe(true);
      expect(rowChildren.classList.contains('expanded')).toBe(true);
      expect(stackChildren.classList.contains('expanded')).toBe(true);
    });
  });
});
