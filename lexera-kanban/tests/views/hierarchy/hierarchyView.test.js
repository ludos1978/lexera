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
        <header class="hierarchy-header">
          <span class="hierarchy-title" id="title">All Workspaces</span>
          <span class="hierarchy-status" id="status">connecting</span>
        </header>
        <main class="hierarchy-body">
          <section class="hierarchy-section">
            <h3 class="hierarchy-section-title">Local boards <span class="muted" id="local-count"></span></h3>
            <ul class="board-list" id="local-boards"></ul>
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
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/hierarchy/index.html?panelKind=hierarchy&pane=tab-1' });
}

describe('hierarchy view sub-app', () => {
  it('renders the selected workspace, highlights active rows, and navigates for boards and workspaces', () => {
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
      boards: [{ id: 'board-1', name: 'Local Board' }],
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
    expect(window.document.getElementById('local-count').textContent).toBe('(1)');
    expect(window.document.getElementById('remote-count').textContent).toBe('(1)');
    expect(window.document.getElementById('ws-count').textContent).toBe('(2)');
    expect(window.document.querySelector('#remote-boards .board-item')?.classList.contains('is-active')).toBe(true);
    expect(window.document.querySelector('[data-workspace-id="ws-2"]')?.classList.contains('is-active')).toBe(true);

    window.document.querySelector('#local-boards .board-item')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    window.document.querySelector('[data-workspace-id="ws-1"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(window.LexeraSubApp.navigate).toHaveBeenNthCalledWith(1, {
      type: 'open-board',
      boardId: 'board-1'
    });
    expect(window.LexeraSubApp.navigate).toHaveBeenNthCalledWith(2, {
      type: 'focus-workspace',
      workspaceId: 'ws-1'
    });
  });
});
