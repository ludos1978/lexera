import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'views', 'workspaces', 'workspaces.js'),
  'utf8'
);
// workspaces.js delegates board-label resolution to the shared
// `LexeraTitleHelpers` global (registered by `titleHelpers.js`).
// Load it into the test window before workspaces.js runs.
const titleHelpersSource = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'titleHelpers.js'),
  'utf8'
);
// The unfolded board structure is rendered through the shared
// TreeView component (treeView.js) — register it on the test window
// so workspaces.js can call `window.TreeView.render(...)` without
// the production HTML's <script> tag.
const treeViewSource = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'treeView.js'),
  'utf8'
);

function loadWorkspacesView(window) {
  const helpersFactory = new Function('window', 'globalThis', titleHelpersSource);
  helpersFactory(window, window);
  // treeView.js self-registers `window.TreeView` on its last line when
  // `window` is in scope, so we just need to run it once with the test
  // window.
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
        <header class="header">
          <span class="title">Workspaces</span>
          <span class="status" id="status">connecting</span>
        </header>
        <main class="body">
          <section>
            <h3>Boards <span class="muted" id="local-count"></span></h3>
            <ul class="board-list" id="local-boards"></ul>
          </section>
          <section>
            <h3>Current workspace</h3>
            <div class="current-workspace" id="current-workspace"></div>
          </section>
        </main>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/workspaces/index.html?panelKind=hierarchy&pane=tab-1' });
}

describe('workspaces view sub-app', () => {
  it('hydrates catalog data, tracks the active board, and navigates on click', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };

    loadWorkspacesView(window);

    expect(window.LexeraSubApp.init).toHaveBeenCalledTimes(1);
    expect(typeof capturedOpts.onCatalog).toBe('function');
    expect(typeof capturedOpts.onActiveBoard).toBe('function');
    expect(typeof capturedOpts.onError).toBe('function');

    capturedOpts.onCatalog({
      boards: [{ id: 'board-1', name: 'Local Board' }],
      remoteBoards: [{ id: 'board-2', title: 'Remote Board' }],
      activeWorkspaceId: 'ws-1',
      activeWorkspace: { id: 'ws-1', name: 'Primary Workspace' },
      workspaces: [
        { id: 'ws-1', name: 'Primary Workspace' },
        { id: 'ws-2', name: 'Sibling Workspace' }
      ]
    });
    capturedOpts.onActiveBoard('board-1');

    expect(window.document.getElementById('status').textContent).toBe('connected');
    expect(window.document.getElementById('local-count').textContent).toBe('(1)');
    expect(window.document.getElementById('current-workspace').textContent).toContain('Primary Workspace');
    expect(window.document.getElementById('current-workspace').textContent).not.toContain('Sibling Workspace');
    expect(window.document.querySelector('#workspaces')).toBeNull();
    expect(window.document.querySelector('#remote-boards')).toBeNull();
    expect(window.document.getElementById('local-boards').textContent).not.toContain('Remote Board');
    expect(window.document.querySelector('#local-boards .board-item')?.classList.contains('is-active')).toBe(true);

    window.document.querySelector('#local-boards .board-item')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(window.LexeraSubApp.navigate).toHaveBeenCalledWith({
      type: 'open-board',
      boardId: 'board-1'
    });
  });

  // Regression: every board showed "(untitled)" because the fallback
  // chain checked `b.name` first. Real /boards payloads ship `title`
  // (camelCase rename of BoardInfo.title in lexera-core), and `name`
  // is undefined — so the chain `undefined || ''` short-circuited
  // straight to "(untitled)" the moment a board's title was briefly
  // empty (e.g. while the file was being parsed).
  it('renders the canonical board title from the /boards payload (title field, not name)', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };

    loadWorkspacesView(window);

    // Real /boards payload shape: { id, title, filePath, ... } — no `name`.
    capturedOpts.onCatalog({
      boards: [
        { id: 'b1', title: 'My Roadmap' },
        { id: 'b2', title: 'Sprint 42' }
      ],
      remoteBoards: [],
      workspaces: []
    });

    const items = window.document.querySelectorAll('#local-boards .board-item .board-name');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('My Roadmap');
    expect(items[1].textContent).toBe('Sprint 42');
    expect(window.document.getElementById('local-boards').textContent).not.toContain('(untitled)');
  });

  // Regression 2026-05-03: a markdown board file without an H1
  // heading produces `BoardInfo.title === ""`. The frontend's
  // fallback chain `b.title || b.name || '(untitled)'` then
  // collapsed every such board to "(untitled)" even though its file
  // had a meaningful name. Now the chain is title → filename
  // basename (sans `.md`) → name → '(untitled)'.
  it('falls back to filename basename without `.md` when title is empty', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };
    loadWorkspacesView(window);
    capturedOpts.onCatalog({
      boards: [
        { id: 'b1', title: '', filePath: '/workspace/Sprint Plan.md' },
        { id: 'b2', title: '', filePath: '/workspace/sub/board-3.md' },
        // snake_case from a legacy payload shape — still recovered.
        { id: 'b3', title: '', file_path: '/workspace/Roadmap.md' }
      ],
      remoteBoards: [],
      workspaces: []
    });
    const items = window.document.querySelectorAll('#local-boards .board-item .board-name');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('Sprint Plan');
    expect(items[1].textContent).toBe('board-3');
    expect(items[2].textContent).toBe('Roadmap');
    expect(window.document.getElementById('local-boards').textContent).not.toContain('(untitled)');
    expect(window.document.getElementById('local-boards').textContent).not.toContain('.md');
  });

  it('falls back to (untitled) only when title and name are absent', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };

    loadWorkspacesView(window);

    capturedOpts.onCatalog({
      boards: [
        { id: 'b1', title: 'Has title only' },
        { id: 'b2', name: 'Has name only (legacy)' },
        { id: 'b3', title: '', name: '' },
        { id: 'b4' }
      ],
      remoteBoards: [],
      workspaces: []
    });

    const items = window.document.querySelectorAll('#local-boards .board-item .board-name');
    expect(items.length).toBe(4);
    expect(items[0].textContent).toBe('Has title only');
    expect(items[1].textContent).toBe('Has name only (legacy)');
    expect(items[2].textContent).toBe('Untitled');
    expect(items[3].textContent).toBe('Untitled');
  });

  // ── User-interaction API exercise ────────────────────────────────
  // The TODO at the top of TODOs-lexera.md asks every sub-app to expose
  // a small "do what a user would do" API so tests stop drifting from
  // user-visible behaviour. These tests drive the workspaces view ONLY
  // through `LexeraWorkspacesTestApi`. If a regression makes the board
  // list invisible, the click stops finding the row and the test
  // fails — so the test result tracks user-visible behaviour, not
  // string-matched source.
  it('LexeraWorkspacesTestApi.collectState mirrors what the user sees in the rendered tree', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };
    loadWorkspacesView(window);

    capturedOpts.onCatalog({
      boards: [{ id: 'b1', title: 'Roadmap' }, { id: 'b2', title: 'Sprint' }],
      remoteBoards: [{ id: 'r1', title: 'Shared' }],
      activeWorkspaceId: 'w1',
      workspaces: [
        { id: 'w1', name: 'Default' },
        { id: 'w2', name: 'Sandbox' }
      ]
    });
    capturedOpts.onActiveBoard('b2');

    const state = window.LexeraWorkspacesTestApi.collectState();
    expect(state.status).toBe('connected');
    expect(state.activeBoardId).toBe('b2');
    expect(state.local.map((b) => b.label)).toEqual(['Roadmap', 'Sprint']);
    expect(state.local.find((b) => b.id === 'b2').active).toBe(true);
    expect(state.local.find((b) => b.id === 'b1').active).toBe(false);
    expect(state.remote).toEqual([]);
    expect(state.currentWorkspace).toEqual({ id: 'w1', label: 'Default' });
    expect(state.workspaces).toEqual([]);
  });

  it('LexeraWorkspacesTestApi.clickBoard fires the same navigate call a real click would', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };
    loadWorkspacesView(window);

    capturedOpts.onCatalog({
      boards: [{ id: 'b1', title: 'Roadmap' }],
      remoteBoards: [{ id: 'r1', title: 'Shared' }],
      workspaces: []
    });

    expect(window.LexeraWorkspacesTestApi.clickBoard('b1')).toBe(true);
    expect(window.LexeraSubApp.navigate).toHaveBeenLastCalledWith({
      type: 'open-board',
      boardId: 'b1'
    });

    expect(window.LexeraWorkspacesTestApi.clickBoard('r1', 'remote')).toBe(false);

    // Unknown id → no false-positive navigate.
    expect(window.LexeraWorkspacesTestApi.clickBoard('does-not-exist')).toBe(false);
  });

  it('renders remote boards only when the current workspace is the remote workspace', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };
    loadWorkspacesView(window);

    capturedOpts.onCatalog({
      boards: [{ id: 'b1', title: 'Local Roadmap' }],
      remoteBoards: [{ id: 'r1', title: 'Shared' }],
      activeWorkspaceId: '__remote_boards__',
      workspaces: [{ id: 'w1', name: 'Default' }]
    });
    capturedOpts.onActiveBoard('r1');

    const state = window.LexeraWorkspacesTestApi.collectState();
    expect(state.currentWorkspace).toEqual({ id: '__remote_boards__', label: 'Remote Boards' });
    expect(state.local.map((b) => b.label)).toEqual(['Shared']);
    expect(state.local.find((b) => b.id === 'r1').active).toBe(true);
    expect(window.document.getElementById('local-boards').textContent).not.toContain('Local Roadmap');

    expect(window.LexeraWorkspacesTestApi.clickBoard('r1', 'remote')).toBe(true);
    expect(window.LexeraSubApp.navigate).toHaveBeenLastCalledWith({
      type: 'open-board',
      boardId: 'r1'
    });
  });

  it('renders only the current workspace and has no per-row workspace opener', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };
    loadWorkspacesView(window);

    capturedOpts.onCatalog({
      boards: [],
      remoteBoards: [],
      activeWorkspaceId: 'ws-1',
      workspaces: [
        { id: 'ws-1', name: 'Default' },
        { id: 'ws-2', name: 'Sandbox' }
      ]
    });

    const state = window.LexeraWorkspacesTestApi.collectState();
    expect(state.currentWorkspace).toEqual({ id: 'ws-1', label: 'Default' });
    expect(state.workspaces).toEqual([]);
    expect(window.document.getElementById('current-workspace').textContent).not.toContain('Sandbox');
    expect(window.document.querySelector('#workspaces')).toBeNull();
    expect(window.LexeraWorkspacesTestApi.clickOpenWorkspace('ws-1')).toBe(false);
    expect(window.LexeraSubApp.navigate).not.toHaveBeenCalled();
  });

  // ── Unfoldable boards (Phase 1, TODOs 2026-05-03) ───────────────
  // The board list now exposes a caret per row. Clicking the caret
  // toggles a nested tree showing the board's rows / stacks / columns
  // / cards using their parsed titles. Drag/drop and re-ordering ride
  // on this scaffolding in later phases — this test pins ONLY the
  // structural read-only render.
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
      loadWorkspacesView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap' }],
        remoteBoards: [],
        workspaces: []
      });

      const caret = window.document.querySelector('#local-boards .board-item .board-caret');
      expect(caret).toBeTruthy();
      expect(caret.getAttribute('aria-expanded')).toBe('false');

      caret.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

      // Caret click must NOT propagate into the row's open-board click.
      expect(window.LexeraSubApp.navigate).not.toHaveBeenCalled();
      expect(window.LexeraApi.getBoardHierarchy).toHaveBeenCalledWith('b1');
    });

    it('expanding a board fetches its hierarchy and renders rows / stacks / columns / cards by title', async () => {
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
            cards: [{ id: 'card-1', title: 'Wire caret' }, { id: 'card-2', title: 'Render tree' }]
          }]
        }]
      }];
      window.LexeraApi = { getBoardHierarchy: vi.fn(() => Promise.resolve({ rows: fakeRows })) };
      loadWorkspacesView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap' }],
        remoteBoards: [],
        workspaces: []
      });

      const caret = window.document.querySelector('#local-boards .board-item .board-caret');
      caret.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      // Wait for the fetch promise to resolve and the re-render to run.
      await new Promise((r) => setTimeout(r, 0));

      // Subtree is rendered through the shared TreeView, so we look at
      // `.tree-view` / `.tree-label` here — the SAME classes the dashboard,
      // files panel, and main board sidebar emit. The wrapping `<li>` lives
      // inside the board list as a sibling of the .board-item row.
      const tree = window.document.querySelector('#local-boards .board-subtree .tree-view');
      expect(tree).toBeTruthy();
      const labels = Array.from(tree.querySelectorAll('.tree-label')).map((n) => n.textContent);
      expect(labels).toEqual(['Backlog', 'Frontend', 'To do', 'Wire caret', 'Render tree']);
      expect(window.document.querySelector('.board-caret').getAttribute('aria-expanded')).toBe('true');
    });

    it('collapsing a board removes its tree but keeps the cached hierarchy', async () => {
      const dom = createDom();
      const { window } = dom;
      let capturedOpts = null;
      window.LexeraSubApp = {
        init: vi.fn((opts) => { capturedOpts = opts; }),
        navigate: vi.fn()
      };
      const getHierarchy = vi.fn(() => Promise.resolve({
        rows: [{ id: 'r1', title: 'R', stacks: [] }]
      }));
      window.LexeraApi = { getBoardHierarchy: getHierarchy };
      loadWorkspacesView(window);
      capturedOpts.onCatalog({
        boards: [{ id: 'b1', title: 'Roadmap' }],
        remoteBoards: [],
        workspaces: []
      });

      const caret = window.document.querySelector('#local-boards .board-item .board-caret');
      // Expand
      caret.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
      expect(window.document.querySelector('#local-boards .board-subtree')).toBeTruthy();
      // Collapse — caret is rebuilt on every render so re-query.
      window.document.querySelector('#local-boards .board-item .board-caret')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(window.document.querySelector('#local-boards .board-subtree')).toBeFalsy();
      // Re-expand should NOT trigger a second fetch — hierarchy is cached.
      window.document.querySelector('#local-boards .board-item .board-caret')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
      expect(getHierarchy).toHaveBeenCalledTimes(1);
      expect(window.document.querySelector('#local-boards .board-subtree')).toBeTruthy();
    });
  });
});
