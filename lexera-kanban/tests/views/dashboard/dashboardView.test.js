import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'views', 'dashboard', 'dashboard.js'),
  'utf8'
);

function loadDashboardView(window) {
  const factory = new Function('window', 'document', 'LexeraSubApp', source);
  factory(window, window.document, window.LexeraSubApp);
}

function createDom() {
  return new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <header class="header">
          <span class="title">Dashboard</span>
          <span class="status" id="status">connecting</span>
        </header>
        <main class="body">
          <section class="metrics">
            <div class="metric"><div class="metric-value" id="m-local">—</div></div>
            <div class="metric"><div class="metric-value" id="m-remote">—</div></div>
            <div class="metric"><div class="metric-value" id="m-ws">—</div></div>
            <div class="metric"><div class="metric-value small" id="m-active">none</div></div>
          </section>
          <section>
            <ul class="recent-list" id="recent"></ul>
          </section>
        </main>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/dashboard/index.html?panelKind=dashboard&pane=tab-1' });
}

describe('dashboard view sub-app', () => {
  it('renders metrics, keeps the active board first, and navigates from the recent list', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn()
    };

    loadDashboardView(window);

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
    expect(window.document.getElementById('m-local').textContent).toBe('1');
    expect(window.document.getElementById('m-remote').textContent).toBe('1');
    expect(window.document.getElementById('m-ws').textContent).toBe('1');
    expect(window.document.getElementById('m-active').textContent).toBe('Remote Board');

    const recentItems = window.document.querySelectorAll('.recent-item');
    expect(recentItems).toHaveLength(2);
    expect(recentItems[0].dataset.boardId).toBe('board-2');
    expect(recentItems[0].classList.contains('is-active')).toBe(true);

    recentItems[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(window.LexeraSubApp.navigate).toHaveBeenCalledWith({
      type: 'open-board',
      boardId: 'board-1'
    });
  });
});
