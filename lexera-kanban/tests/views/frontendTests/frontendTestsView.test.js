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
        <div class="test-panel lexera-shared-panel lexera-shared-panel-frontend-tests">
          <div class="test-panel-header">
            <div class="test-panel-actions">
              <div class="test-panel-action-group test-panel-action-group-run">
                <select class="test-panel-board-select lexera-shared-test-board-select"></select>
                <input class="test-panel-filter lexera-shared-test-filter" type="search">
                <span class="test-panel-control-cluster">
                  <button class="test-panel-btn lexera-shared-test-expand-all" type="button">Expand All</button>
                  <button class="test-panel-btn lexera-shared-test-collapse-all" type="button">Collapse All</button>
                </span>
                <span class="test-panel-control-cluster test-panel-run-controls">
                  <button class="test-panel-btn lexera-shared-test-run-all" type="button">Run All</button>
                  <button class="test-panel-btn lexera-shared-test-stop" type="button">Stop Run</button>
                  <button class="test-panel-btn lexera-shared-test-clear-results" type="button">Clear Results</button>
                </span>
                <span class="test-panel-control-cluster test-panel-restore-controls">
                  <label class="test-panel-restore-toggle">
                    <input class="lexera-shared-test-manual-inspect" type="checkbox">
                    Pause after Do
                  </label>
                  <button class="test-panel-btn lexera-shared-test-continue-undo" type="button">Restore Snapshot</button>
                </span>
              </div>
              <div class="test-panel-action-group test-panel-action-group-copy">
                <select class="test-panel-copy-scope lexera-shared-test-copy-scope">
                  <option value="all">All Results</option>
                  <option value="errors">Only Errors</option>
                  <option value="errors-with-logs">Errors + FE/BE Logs</option>
                </select>
                <button class="test-panel-btn lexera-shared-test-copy" type="button">Copy</button>
                <button class="test-panel-btn lexera-shared-test-refresh" type="button">Refresh</button>
                <span class="test-panel-copy-feedback lexera-shared-test-copy-feedback"></span>
              </div>
            </div>
          </div>
          <div class="test-panel-summary lexera-shared-test-summary">Waiting for runner state…</div>
          <div class="test-panel-body lexera-shared-test-list"></div>
        </div>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/frontendTests/index.html?panelKind=frontendTests&pane=tab-1' });
}

describe('frontendTests view sub-app', () => {
  it('boots through LexeraSubApp, restores the legacy test panel layout, and bridges runner commands', async () => {
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
      activeBoardId: 'board-active',
      selectedBoardId: 'board-1',
      boardOptions: [
        { id: 'board-1', title: 'Board One', isRemote: false },
        { id: 'board-2', title: 'Board Two', isRemote: true }
      ],
      manualInspectEnabled: true,
      awaitingUndo: false,
      tests: [
        { index: 0, name: 'test pass', categories: ['scope: kanban', 'moves'] },
        { index: 1, name: 'test fail', categories: ['scope: kanban'] },
        { index: 2, name: 'test idle', categories: ['editor'] }
      ],
      runState: { active: false, cancelRequested: false, currentIndex: -1, total: 0, phase: 'idle', autoRun: false, currentTestName: '' },
      summary: { total: 3, completed: 2, passed: 1, failed: 1, remaining: 1 },
      categories: [
        { name: 'scope: kanban', total: 2, completed: 2, passed: 1, failed: 1 },
        { name: 'moves', total: 1, completed: 1, passed: 1, failed: 0 },
        { name: 'editor', total: 1, completed: 0, passed: 0, failed: 0 }
      ],
      results: [
        { name: 'test pass', passed: true, error: '', durationMs: 12, setupMs: 1, bodyMs: 10, teardownMs: 1 },
        { name: 'test fail', passed: false, error: 'boom', durationMs: 34, setupMs: 2, bodyMs: 30, teardownMs: 2 }
      ]
    });

    expect(window.document.querySelector('.lexera-shared-test-summary').textContent).toContain('1 passed, 1 failed / 3');
    expect(window.document.querySelector('.lexera-shared-test-board-select').value).toBe('board-1');
    expect(window.document.querySelector('.lexera-shared-test-manual-inspect').checked).toBe(true);
    expect(window.document.querySelector('.lexera-shared-test-list').textContent).toContain('scope: kanban');
    expect(window.document.querySelector('.lexera-shared-test-list').textContent).toContain('test fail');

    window.document.querySelector('.lexera-shared-test-filter').value = 'fail';
    window.document.querySelector('.lexera-shared-test-filter')
      .dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(window.document.querySelector('.lexera-shared-test-run-all').textContent).toBe('Run 1/3');

    window.document.querySelector('.lexera-shared-test-run-all')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(broadcast).toHaveBeenCalledWith('frontend-tests-command', {
      action: 'run-all',
      options: { filter: 'fail' }
    });

    window.document.querySelector('button.test-category-run')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(broadcast).toHaveBeenCalledWith('frontend-tests-command', {
      action: 'run-category',
      category: 'scope: kanban'
    });

    window.document.querySelector('.test-row[data-test-name="test fail"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(broadcast).toHaveBeenCalledWith('frontend-tests-command', {
      action: 'run-test',
      testName: 'test fail'
    });

    window.document.querySelector('.lexera-shared-test-board-select').value = 'board-2';
    window.document.querySelector('.lexera-shared-test-board-select')
      .dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(broadcast).toHaveBeenCalledWith('frontend-tests-command', {
      action: 'set-board-selection',
      boardId: 'board-2'
    });

    window.document.querySelector('.lexera-shared-test-manual-inspect').checked = false;
    window.document.querySelector('.lexera-shared-test-manual-inspect')
      .dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(broadcast).toHaveBeenCalledWith('frontend-tests-command', {
      action: 'set-manual-inspect',
      enabled: false
    });

    window.document.querySelector('.lexera-shared-test-continue-undo')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(broadcast).toHaveBeenCalledWith('frontend-tests-command', { action: 'continue-undo' });

    window.document.querySelector('.lexera-shared-test-copy-scope').value = 'errors';
    window.document.querySelector('.lexera-shared-test-copy')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(broadcast).toHaveBeenCalledWith('frontend-tests-command', {
      action: 'copy-results',
      scope: 'errors'
    });

    await Promise.resolve();
    expect(window.document.querySelector('.lexera-shared-test-copy-feedback').textContent).toContain('Copied');
  });
});
