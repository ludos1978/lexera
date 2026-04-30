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

function loadWorkspacesView(window) {
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
            <h3>Local boards <span class="muted" id="local-count"></span></h3>
            <ul class="board-list" id="local-boards"></ul>
          </section>
          <section>
            <h3>Remote boards <span class="muted" id="remote-count"></span></h3>
            <ul class="board-list" id="remote-boards"></ul>
          </section>
          <section>
            <h3>Workspaces <span class="muted" id="ws-count"></span></h3>
            <ul class="ws-list" id="workspaces"></ul>
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
      workspaces: [{ id: 'ws-1', name: 'Primary Workspace' }]
    });
    capturedOpts.onActiveBoard('board-2');

    expect(window.document.getElementById('status').textContent).toBe('connected');
    expect(window.document.getElementById('local-count').textContent).toBe('(1)');
    expect(window.document.getElementById('remote-count').textContent).toBe('(1)');
    expect(window.document.getElementById('ws-count').textContent).toBe('(1)');
    expect(window.document.getElementById('remote-boards').textContent).toContain('Remote Board');
    expect(window.document.querySelector('#remote-boards .board-item')?.classList.contains('is-active')).toBe(true);

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

  it('falls back to (untitled) only when both title and name are absent', () => {
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
    expect(items[2].textContent).toBe('(untitled)');
    expect(items[3].textContent).toBe('(untitled)');
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
      workspaces: [{ id: 'w1', name: 'Default' }]
    });
    capturedOpts.onActiveBoard('b2');

    const state = window.LexeraWorkspacesTestApi.collectState();
    expect(state.status).toBe('connected');
    expect(state.activeBoardId).toBe('b2');
    expect(state.local.map((b) => b.label)).toEqual(['Roadmap', 'Sprint']);
    expect(state.local.find((b) => b.id === 'b2').active).toBe(true);
    expect(state.local.find((b) => b.id === 'b1').active).toBe(false);
    expect(state.remote.map((b) => b.label)).toEqual(['Shared']);
    expect(state.workspaces.map((w) => w.label)).toEqual(['Default']);
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

    expect(window.LexeraWorkspacesTestApi.clickBoard('r1', 'remote')).toBe(true);
    expect(window.LexeraSubApp.navigate).toHaveBeenLastCalledWith({
      type: 'open-board',
      boardId: 'r1'
    });

    // Unknown id → no false-positive navigate.
    expect(window.LexeraWorkspacesTestApi.clickBoard('does-not-exist')).toBe(false);
  });
});
