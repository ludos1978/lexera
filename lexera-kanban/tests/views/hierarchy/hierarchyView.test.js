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
        { id: 'board-1', name: 'Local Board', workspace_id: 'ws-1' },
        { id: 'board-3', name: 'Loose Board' }
      ],
      remoteBoards: [{ id: 'board-2', title: 'Remote Board' }],
      workspaces: [
        { id: 'ws-1', name: 'Workspace One' },
        { id: 'ws-2', name: 'Workspace Two' }
      ],
      activeWorkspaceId: 'ws-1',
      activeWorkspace: { id: 'ws-1', name: 'Workspace One' },
      viewWorkspaceId: 'ws-2',
      viewWorkspace: { id: 'ws-2', name: 'Workspace Two' },
      workspaceViewMode: 'manual'
    });
    capturedOpts.onActiveBoard('board-2');

    expect(window.document.getElementById('status').textContent).toBe('connected');
    expect(window.document.getElementById('title').textContent).toBe('Workspace Two');
    expect(window.document.getElementById('view-mode').textContent).toBe('manual view');
    expect(window.document.getElementById('local-count').textContent).toBe('(2)');
    expect(window.document.getElementById('remote-count').textContent).toBe('(1)');
    expect(window.document.getElementById('ws-count').textContent).toBe('(2)');
    expect(window.document.querySelector('#remote-boards .board-item')?.classList.contains('is-active')).toBe(true);
    expect(window.document.querySelector('[data-workspace-id="ws-2"]')?.classList.contains('is-active')).toBe(true);
    expect(window.document.querySelector('[data-workspace-group="ws-2"]')).toBeTruthy();
    expect(window.document.querySelector('[data-workspace-group="ws-1"]')).toBeNull();

    capturedOpts.onCatalog({
      boards: [
        { id: 'board-1', name: 'Local Board', workspace_id: 'ws-1' },
        { id: 'board-3', name: 'Loose Board' }
      ],
      remoteBoards: [{ id: 'board-2', title: 'Remote Board' }],
      workspaces: [
        { id: 'ws-1', name: 'Workspace One' },
        { id: 'ws-2', name: 'Workspace Two' }
      ],
      activeWorkspaceId: 'ws-1',
      activeWorkspace: { id: 'ws-1', name: 'Workspace One' },
      viewWorkspaceId: '__all__',
      viewWorkspace: null,
      workspaceViewMode: 'follow-active-board'
    });

    expect(window.document.getElementById('title').textContent).toBe('All Workspaces');
    expect(window.document.getElementById('view-mode').textContent).toBe('follow active board');
    expect(window.document.querySelector('[data-workspace-group="ws-1"]')).toBeTruthy();
    expect(window.document.querySelector('[data-workspace-group="__unassigned__"]')).toBeTruthy();

    window.document.querySelector('#local-boards .board-item')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    window.document.querySelector('[data-workspace-group="ws-1"] .ws-group-header')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(window.document.querySelector('[data-workspace-group="ws-1"] .board-list.nested')?.classList.contains('collapsed')).toBe(true);
    window.document.querySelector('[data-workspace-id="__all__"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    window.document.querySelector('#workspaces [data-workspace-id="ws-1"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(window.LexeraSubApp.navigate).toHaveBeenNthCalledWith(1, {
      type: 'open-board',
      boardId: 'board-1'
    });
    expect(window.LexeraSubApp.navigate).toHaveBeenNthCalledWith(2, {
      type: 'focus-workspace',
      workspaceId: '__all__'
    });
    expect(window.LexeraSubApp.navigate).toHaveBeenNthCalledWith(3, {
      type: 'focus-workspace',
      workspaceId: 'ws-1'
    });
  });
});
