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
});
