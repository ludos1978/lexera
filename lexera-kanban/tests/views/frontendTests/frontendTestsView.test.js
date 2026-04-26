import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'views', 'frontendTests', 'frontendTests.js'),
  'utf8'
);

function loadFrontendTestsView(window, globals = {}) {
  const argNames = ['window', 'document'].concat(Object.keys(globals));
  const argValues = [window, window.document].concat(Object.values(globals));
  const factory = new Function(...argNames, source);
  factory(...argValues);
}

function createDom() {
  return new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <header class="header">
          <span class="title">Frontend Tests</span>
          <span class="status" id="status">connecting</span>
        </header>
        <main class="body">
          <section class="summary-panel">
            <div class="summary-line" id="summary">Waiting for runner state…</div>
            <div class="summary-meta">
              <span id="progress">No run in progress</span>
              <span id="active-board">Board: none</span>
            </div>
          </section>
          <section class="controls">
            <button id="run-all" type="button">Run All</button>
            <button id="stop" type="button">Stop</button>
            <button id="clear" type="button">Clear</button>
            <select id="copy-scope">
              <option value="all">Copy All</option>
              <option value="errors">Copy Errors</option>
              <option value="errors-with-logs">Copy Errors + Logs</option>
            </select>
            <button id="copy" type="button">Copy</button>
            <button id="refresh" type="button">Refresh</button>
          </section>
          <section><div id="categories"></div></section>
          <section><div id="results"></div></section>
        </main>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/frontendTests/index.html?panelKind=frontendTests&pane=tab-1' });
}

describe('frontendTests view sub-app', () => {
  it('boots through LexeraSubApp, requests state, renders categories/results, and sends commands', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    const broadcast = vi.fn(() => Promise.resolve(null));
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      broadcast
    };

    loadFrontendTestsView(window, { setInterval: vi.fn(() => 1) });

    expect(window.LexeraSubApp.init).toHaveBeenCalledTimes(1);
    expect(capturedOpts).toBeTruthy();
    expect(typeof capturedOpts.onReady).toBe('function');
    expect(typeof capturedOpts.onError).toBe('function');
    expect(capturedOpts.onCustom).toHaveProperty('frontend-tests-state');

    capturedOpts.onReady();
    expect(broadcast).toHaveBeenCalledWith('frontend-tests-command', { action: 'refresh-state' });

    capturedOpts.onCustom['frontend-tests-state']({
      available: true,
      totalTests: 3,
      activeBoardId: 'board-1',
      runState: { active: false, cancelRequested: false, currentIndex: -1, total: 0, phase: 'idle', autoRun: false, currentTestName: '' },
      summary: { total: 3, completed: 2, passed: 1, failed: 1, remaining: 1 },
      categories: [
        { name: 'scope: kanban', total: 2, completed: 2, passed: 1, failed: 1 },
        { name: 'moves', total: 1, completed: 0, passed: 0, failed: 0 }
      ],
      results: [
        { name: 'test pass', passed: true, error: '', durationMs: 12 },
        { name: 'test fail', passed: false, error: 'boom', durationMs: 34 }
      ]
    });

    expect(window.document.getElementById('summary').textContent).toContain('2/3 completed');
    expect(window.document.getElementById('progress').textContent).toContain('No run in progress');
    expect(window.document.getElementById('active-board').textContent).toContain('board-1');
    expect(window.document.getElementById('categories').textContent).toContain('scope: kanban');
    expect(window.document.getElementById('results').textContent).toContain('test fail');

    window.document.getElementById('run-all')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(broadcast).toHaveBeenCalledWith('frontend-tests-command', { action: 'run-all' });

    window.document.querySelector('button[data-action="run-category"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(broadcast).toHaveBeenCalledWith('frontend-tests-command', {
      action: 'run-category',
      category: 'scope: kanban'
    });

    window.document.getElementById('copy-scope').value = 'errors';
    window.document.getElementById('copy')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(broadcast).toHaveBeenCalledWith('frontend-tests-command', {
      action: 'copy-results',
      scope: 'errors'
    });
  });
});
