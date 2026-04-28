import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '..', '..', '..', 'src', 'views', 'log', 'log.js'), 'utf8');

function loadLogView(window, globals = {}) {
  const argNames = ['window', 'document'].concat(Object.keys(globals));
  const argValues = [window, window.document].concat(Object.values(globals));
  const factory = new Function(...argNames, source);
  factory(...argValues);
}

// DOM mirrors the canonical log markup from `sharedPanels.js#
// createLogsPanelElement` and `views/log/index.html`. Kept inline to
// keep the test isolated from the HTML loader.
function createDom() {
  return new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <div class="log-panel lexera-shared-panel lexera-shared-panel-logs"
             data-shell-panel="logs" data-shell-panel-instance="logs">
          <div class="log-panel-header">
            <div class="log-panel-header-main">
              <span class="log-panel-title">Logs</span>
              <div class="log-panel-source-dropdown">
                <button id="log-source-btn" class="log-panel-tab" type="button" aria-expanded="false">
                  <span id="log-source-label">Sources</span>
                </button>
                <button id="log-source-clear" class="hidden" type="button">&times;</button>
                <div id="log-source-menu" class="log-panel-source-menu hidden"></div>
              </div>
              <div class="log-panel-source-dropdown">
                <button id="log-level-btn" class="log-panel-tab" type="button" aria-expanded="false">
                  <span id="log-level-label">Levels</span>
                </button>
                <button id="log-level-clear" class="hidden" type="button">&times;</button>
                <div id="log-level-menu" class="log-panel-source-menu hidden"></div>
              </div>
              <div class="log-panel-search-wrap">
                <input id="log-search-input" class="log-panel-search" type="text" />
                <button id="log-search-clear" class="hidden" type="button">&times;</button>
              </div>
            </div>
            <div class="log-panel-actions">
              <button id="btn-connection-status" class="connection-status-btn disconnected" type="button">
                <span id="connection-dot"></span>
                <span class="connection-status-label">Disconnected</span>
              </button>
              <button id="log-refresh-btn" type="button">Reload</button>
              <button id="log-copy-btn" type="button">Copy</button>
              <button id="log-clear-btn" type="button">Clear</button>
            </div>
          </div>
          <div class="log-panel-status">
            <span id="status-msg" class="status-msg"></span>
          </div>
          <div class="log-panel-body">
            <div class="log-panel-main view-loading">
              <div id="log-entries" class="log-entries"></div>
              <div id="log-entries-stats" class="log-entries hidden"></div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/log/index.html?panelKind=logs&panel=logs&pane=tab-1' });
}

describe('log view sub-app', () => {
  it('boots through LexeraSubApp and renders incoming log events', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      broadcast: vi.fn()
    };

    loadLogView(window);

    expect(window.LexeraSubApp.init).toHaveBeenCalledTimes(1);
    expect(capturedOpts).toBeTruthy();
    expect(typeof capturedOpts.onLog).toBe('function');
    expect(typeof capturedOpts.onReady).toBe('function');
    expect(typeof capturedOpts.onError).toBe('function');

    capturedOpts.onReady();
    expect(window.document.getElementById('status-msg').textContent).toBe('0/0 entries');

    capturedOpts.onLog({
      level: 'warn',
      source: 'frontend',
      message: 'Something drifted',
      timestamp_ms: Date.UTC(2026, 3, 26, 8, 15, 30, 125)
    });

    const entries = window.document.querySelectorAll('.entry');
    expect(entries).toHaveLength(1);
    expect(entries[0].textContent).toContain('frontend');
    expect(entries[0].textContent).toContain('Something drifted');
    expect(window.document.getElementById('status-msg').textContent).toBe('1/1 entries');
  });

  it('filters by level via the dropdown and clears all entries', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      broadcast: vi.fn()
    };

    loadLogView(window);

    capturedOpts.onLog({
      level: 'info',
      source: 'frontend',
      message: 'Info line',
      timestamp_ms: Date.UTC(2026, 3, 26, 8, 15, 30, 125)
    });
    capturedOpts.onLog({
      level: 'error',
      source: 'frontend',
      message: 'Error line',
      timestamp_ms: Date.UTC(2026, 3, 26, 8, 15, 31, 125)
    });

    // Uncheck the 'info' level checkbox in the level dropdown.
    const levelMenu = window.document.getElementById('log-level-menu');
    const labels = levelMenu.querySelectorAll('.log-panel-source-menu-item');
    const infoLabel = Array.from(labels).find((el) => el.textContent.includes('info'));
    const infoCheckbox = infoLabel.querySelector('input[type="checkbox"]');
    infoCheckbox.checked = false;
    infoCheckbox.dispatchEvent(new window.Event('change', { bubbles: true }));

    let rendered = window.document.querySelectorAll('.entry');
    expect(rendered).toHaveLength(1);
    expect(rendered[0].textContent).toContain('Error line');

    window.document.getElementById('log-clear-btn')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    rendered = window.document.querySelectorAll('.entry');
    expect(rendered).toHaveLength(0);
    expect(window.document.getElementById('status-msg').textContent).toBe('0/0 entries');
  });

  it('filters by search text and broadcasts a reload request', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      broadcast: vi.fn()
    };

    loadLogView(window);

    capturedOpts.onLog({ level: 'info', source: 'frontend', message: 'Apple', timestamp_ms: Date.UTC(2026, 3, 26, 8) });
    capturedOpts.onLog({ level: 'info', source: 'frontend', message: 'Banana', timestamp_ms: Date.UTC(2026, 3, 26, 9) });

    const search = window.document.getElementById('log-search-input');
    search.value = 'banana';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));

    const rendered = window.document.querySelectorAll('.entry');
    expect(rendered).toHaveLength(1);
    expect(rendered[0].textContent).toContain('Banana');

    window.document.getElementById('log-refresh-btn')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(window.LexeraSubApp.broadcast).toHaveBeenCalledWith('log-reload-request', {});
  });
});
