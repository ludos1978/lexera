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

// Mirror of the canonical dashboard markup that
// `sharedPanels.js#createDashboardPanelElement` and
// `views/dashboard/index.html` both produce. Keeping it inline here
// (rather than importing the file) keeps the test independent of any
// HTML-loader pipeline.
function createDom() {
  return new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <div class="sidebar-dashboard lexera-shared-panel lexera-shared-panel-dashboard"
             data-shell-panel="dashboard" data-shell-panel-instance="dashboard">
          <div class="sidebar-dashboard-controls">
            <div class="dashboard-query-row">
              <input id="dashboard-search-input" class="dashboard-search-input lexera-shared-dashboard-search" type="text">
            </div>
            <div class="dashboard-filter-row">
              <button id="btn-dashboard-search" class="dashboard-search-btn lexera-shared-dashboard-search-btn" type="button"></button>
              <label><input id="dashboard-scope-select" class="dashboard-scope-checkbox lexera-shared-dashboard-scope" type="checkbox">All Boards</label>
              <button id="btn-dashboard-pin" class="board-action-btn lexera-shared-dashboard-pin" type="button">Pin</button>
            </div>
          </div>
          <div class="sidebar-dashboard-body view-loading">
            <div class="dashboard-group" data-dashboard-group-key="results">
              <div id="dashboard-results-list" class="dashboard-list lexera-shared-dashboard-results"></div>
            </div>
            <div class="dashboard-group" data-dashboard-group-key="pinned">
              <div id="dashboard-pinned-list" class="dashboard-list lexera-shared-dashboard-pinned"></div>
            </div>
            <div class="dashboard-group" data-dashboard-group-key="overdue">
              <div id="dashboard-overdue-list" class="dashboard-list lexera-shared-dashboard-overdue"></div>
            </div>
            <div class="dashboard-group" data-dashboard-group-key="upcoming">
              <div id="dashboard-upcoming-list" class="dashboard-list lexera-shared-dashboard-upcoming"></div>
            </div>
            <div class="dashboard-group" data-dashboard-group-key="open-tasks">
              <div id="dashboard-todos-list" class="dashboard-list lexera-shared-dashboard-todos"></div>
            </div>
            <div class="dashboard-group" data-dashboard-group-key="tagged">
              <div id="dashboard-tagged-list" class="dashboard-list lexera-shared-dashboard-tagged"></div>
            </div>
            <div class="dashboard-group" data-dashboard-group-key="file-embeds">
              <div id="dashboard-embeds-list" class="dashboard-list lexera-shared-dashboard-embeds"></div>
            </div>
            <div class="dashboard-group" data-dashboard-group-key="broken-elements">
              <div id="dashboard-broken-list" class="dashboard-list lexera-shared-dashboard-broken"></div>
            </div>
            <div class="dashboard-group" data-dashboard-group-key="included-files">
              <div id="dashboard-included-list" class="dashboard-list lexera-shared-dashboard-included"></div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/dashboard/index.html?panelKind=dashboard&pane=tab-1' });
}

describe('dashboard view sub-app', () => {
  it('renders the canonical dashboard markup and registers a single LexeraSubApp.init', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn(),
      broadcast: vi.fn()
    };

    loadDashboardView(window);

    expect(window.LexeraSubApp.init).toHaveBeenCalledTimes(1);
    expect(typeof capturedOpts.onCatalog).toBe('function');
    expect(typeof capturedOpts.onActiveBoard).toBe('function');
    expect(typeof capturedOpts.onError).toBe('function');
    expect(capturedOpts.onCustom && typeof capturedOpts.onCustom['dashboard-results-update']).toBe('function');

    // Confirm all 9 result lists are present from the canonical markup.
    [
      'dashboard-results-list',
      'dashboard-pinned-list',
      'dashboard-overdue-list',
      'dashboard-upcoming-list',
      'dashboard-todos-list',
      'dashboard-tagged-list',
      'dashboard-embeds-list',
      'dashboard-broken-list',
      'dashboard-included-list'
    ].forEach((id) => {
      expect(window.document.getElementById(id)).toBeTruthy();
    });
  });

  it('broadcasts a dashboard-search event when Enter is pressed in the search input', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = {
      init: vi.fn(),
      navigate: vi.fn(),
      broadcast: vi.fn()
    };

    loadDashboardView(window);

    const input = window.document.getElementById('dashboard-search-input');
    const scope = window.document.getElementById('dashboard-scope-select');
    input.value = 'test query';
    scope.checked = true;
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(window.LexeraSubApp.broadcast).toHaveBeenCalledWith('dashboard-search', {
      query: 'test query',
      allBoards: true
    });
  });

  it('broadcasts a dashboard-pin event when the Pin button is clicked', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = {
      init: vi.fn(),
      navigate: vi.fn(),
      broadcast: vi.fn()
    };

    loadDashboardView(window);

    const input = window.document.getElementById('dashboard-search-input');
    input.value = 'pinned query';
    const pin = window.document.getElementById('btn-dashboard-pin');
    pin.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(window.LexeraSubApp.broadcast).toHaveBeenCalledWith('dashboard-pin', {
      query: 'pinned query'
    });
  });

  it('does not broadcast a pin event when the search input is empty', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = {
      init: vi.fn(),
      navigate: vi.fn(),
      broadcast: vi.fn()
    };

    loadDashboardView(window);

    // The mount also broadcasts `dashboard-snapshot-request` to pull
    // the SHELL's current mirror — clear the spy so we only assert
    // on the pin click below.
    window.LexeraSubApp.broadcast.mockClear();

    const pin = window.document.getElementById('btn-dashboard-pin');
    pin.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(window.LexeraSubApp.broadcast).not.toHaveBeenCalled();
  });

  it('mirrors visible result HTML and lets tests click the dashboard panel DOM', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      navigate: vi.fn(),
      broadcast: vi.fn()
    };

    loadDashboardView(window);
    capturedOpts.onCustom['dashboard-mirror-update']({
      activeBoardId: 'board-1',
      lists: {
        'dashboard-results-list': `
          <div class="tree-node"
               data-dashboard-target="result"
               data-dashboard-board-id="board-1"
               data-dashboard-card-id="card-1"
               data-dashboard-column-index="2"
               data-dashboard-card-index="4"
               data-dashboard-column-title="Doing">Card 1</div>
        `
      }
    });

    const state = window.LexeraDashboardTestApi.collectState();
    expect(state.mounted).toBe(true);
    expect(state.receivedFirstSnapshot).toBe(true);
    expect(state.activeBoardId).toBe('board-1');
    expect(state.lists['dashboard-results-list'].cardIds).toEqual(['card-1']);

    window.LexeraSubApp.broadcast.mockClear();
    expect(window.LexeraDashboardTestApi.clickCard('card-1', 'dashboard-results-list')).toBe(true);
    expect(window.LexeraSubApp.broadcast).toHaveBeenCalledWith('dashboard-navigate', {
      target: 'result',
      nav: expect.objectContaining({
        boardId: 'board-1',
        cardId: 'card-1',
        columnIndex: 2,
        cardIndex: 4,
        columnTitle: 'Doing'
      })
    });
  });
});
