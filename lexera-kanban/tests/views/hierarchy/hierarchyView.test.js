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
      sourceEl.dispatchEvent(new window.MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10
      }));
      window.document.elementFromPoint = function () { return sourceEl; };
      window.document.dispatchEvent(new window.MouseEvent('mousemove', {
        bubbles: true, clientX: 11, clientY: 11
      }));
      window.document.dispatchEvent(new window.MouseEvent('mousemove', {
        bubbles: true, clientX: 50, clientY: 50
      }));
      if (targetEl) {
        window.document.elementFromPoint = function () { return targetEl; };
        window.document.dispatchEvent(new window.MouseEvent('mousemove', {
          bubbles: true, clientX: 100, clientY: targetY
        }));
      }
      if (opts.skipMouseup) {
        window.document.elementFromPoint = origElementFromPoint;
        if (targetEl && origGetRect) targetEl.getBoundingClientRect = origGetRect;
        return;
      }
      window.document.dispatchEvent(new window.MouseEvent('mouseup', {
        bubbles: true, clientX: 100, clientY: targetY
      }));
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
      expect(dragBroadcast.payload).toEqual({ boardId: 'b1', kind: 'card', entityId: 'card-1' });
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
      expect(dropBroadcast.payload.source).toEqual({ boardId: 'b1', kind: 'card', entityId: 'card-1' });
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

      // Fire the change event the bridge would broadcast after a save.
      capturedOpts.onCustom['hierarchy-board-changed']({ boardId: 'b1' });
      await new Promise((r) => setTimeout(r, 0));
      // Cache invalidated + immediate refetch (board still expanded).
      expect(window.LexeraApi.getBoardHierarchy).toHaveBeenCalledTimes(2);
      expect(rowLabels()).toEqual(['V2 (after reorder)']);
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
  });
});
