import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'views', 'inspector', 'inspector.js'),
  'utf8'
);
const html = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'views', 'inspector', 'index.html'),
  'utf8'
);

function loadInspectorView(window, globals = {}) {
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
          <span class="title">Multiview Inspector</span>
          <span class="lexera-mv-status-dot" data-health="green"></span>
          <span class="fps" id="fps">— fps</span>
        </header>
        <main class="body">
          <section>
            <h3>Process info</h3>
            <table id="proc-info"></table>
          </section>
          <section>
            <h3>Active child webviews <span class="muted" id="webview-count"></span></h3>
            <table id="webview-table">
              <tbody id="webview-tbody"></tbody>
            </table>
          </section>
          <section>
            <h3>Recent log events <span class="muted">(last 50)</span></h3>
            <div class="log-tail" id="log-tail"></div>
          </section>
        </main>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/inspector/index.html?panelKind=inspector&pane=tab-1' });
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('inspector view sub-app', () => {
  it('loads the shared shell-fit layout styles used by utility side panels', () => {
    expect(html).toContain('<link rel="stylesheet" href="../../app.css">');
    expect(html).toContain('<link rel="stylesheet" href="../../workspace/workspaceShell.css">');
    expect(html).toContain('<link rel="stylesheet" href="../_shared/panelShellFit.css">');
  });

  it('boots through LexeraSubApp, polls webviews, and appends log events', async () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    const invoke = vi.fn((cmd) => {
      if (cmd === 'multiview_list') {
        return Promise.resolve([{
          label: 'board-tab-tab-1',
          x: 12,
          y: 24,
          width: 640,
          height: 360,
          url: 'http://127.0.0.1:1431/index.html?embedded=1&board=b1'
        }]);
      }
      if (cmd === 'multiview_list_health') {
        return Promise.resolve({ 'board-tab-tab-1': 'green' });
      }
      return Promise.resolve(null);
    });
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      invoke,
      getCurrentWebview: vi.fn(() => ({ label: 'inspector' }))
    };

    loadInspectorView(window, {
      requestAnimationFrame: vi.fn(() => 1),
      setInterval: vi.fn(() => 1)
    });

    expect(window.LexeraSubApp.init).toHaveBeenCalledTimes(1);
    expect(capturedOpts).toBeTruthy();
    expect(typeof capturedOpts.onLog).toBe('function');
    expect(typeof capturedOpts.onReady).toBe('function');
    expect(typeof capturedOpts.onError).toBe('function');

    capturedOpts.onReady();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('multiview_list', {});
    expect(invoke).toHaveBeenCalledWith('multiview_list_health', {});
    expect(window.document.getElementById('proc-info').textContent).toContain('inspector');
    expect(window.document.getElementById('webview-count').textContent).toBe('(1)');
    expect(window.document.getElementById('webview-tbody').textContent).toContain('board-tab-tab-1');

    capturedOpts.onLog({
      level: 'warn',
      source: 'frontend',
      message: 'Inspector saw a respawn',
      timestamp_ms: Date.UTC(2026, 3, 26, 9, 45, 30, 125)
    });

    const logLines = window.document.querySelectorAll('.log-line');
    expect(logLines).toHaveLength(1);
    expect(logLines[0].textContent).toContain('Inspector saw a respawn');
  });

  it('reloads a selected child webview from its last known geometry', async () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    const invoke = vi.fn((cmd, args) => {
      if (cmd === 'multiview_list') {
        return Promise.resolve([{
          label: 'board-tab-tab-1',
          x: 12,
          y: 24,
          width: 640,
          height: 360,
          url: 'http://127.0.0.1:1431/index.html?embedded=1&board=b1'
        }]);
      }
      if (cmd === 'multiview_list_health') {
        return Promise.resolve({ 'board-tab-tab-1': 'yellow' });
      }
      if (cmd === 'multiview_destroy' || cmd === 'multiview_spawn') {
        return Promise.resolve(args || null);
      }
      return Promise.resolve(null);
    });
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      invoke,
      getCurrentWebview: vi.fn(() => ({ label: 'inspector' }))
    };

    loadInspectorView(window, {
      requestAnimationFrame: vi.fn(() => 1),
      setInterval: vi.fn(() => 1)
    });

    capturedOpts.onReady();
    await flushPromises();

    window.document.querySelector('button[data-reload="1"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flushPromises();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('multiview_destroy', {
      label: 'board-tab-tab-1'
    });
    expect(invoke).toHaveBeenCalledWith('multiview_spawn', {
      req: {
        label: 'board-tab-tab-1',
        url: 'http://127.0.0.1:1431/index.html?embedded=1&board=b1',
        x: 12,
        y: 24,
        width: 640,
        height: 360
      }
    });
  });

  // ── User-interaction API exercise ────────────────────────────────
  // Drives the inspector view ONLY through LexeraInspectorTestApi —
  // a regression that breaks the table render or destroy/reload
  // wiring makes the API return false / yield wrong state, so the
  // test result tracks user-visible behaviour, not source matching.
  it('LexeraInspectorTestApi.collectState mirrors the rows + log tail the user sees', async () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    const invoke = vi.fn((cmd) => {
      if (cmd === 'multiview_list') {
        return Promise.resolve([
          { label: 'board-tab-tab-1', x: 0, y: 0, width: 100, height: 80, url: 'http://x/' },
          { label: 'panel-logs-tab-1', x: 200, y: 50, width: 320, height: 240, url: 'http://y/' }
        ]);
      }
      if (cmd === 'multiview_list_health') {
        return Promise.resolve({ 'board-tab-tab-1': 'green', 'panel-logs-tab-1': 'yellow' });
      }
      return Promise.resolve(null);
    });
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      invoke,
      getCurrentWebview: vi.fn(() => ({ label: 'inspector' }))
    };

    loadInspectorView(window, {
      requestAnimationFrame: vi.fn(() => 1),
      setInterval: vi.fn(() => 1)
    });

    capturedOpts.onReady();
    await flushPromises();
    capturedOpts.onLog({ level: 'error', source: 'frontend', message: 'Disk drift', timestamp_ms: Date.UTC(2026, 3, 30, 10) });

    const state = window.LexeraInspectorTestApi.collectState();
    expect(state.countLabel).toBe('(2)');
    expect(state.rows.map((r) => r.label)).toEqual(['board-tab-tab-1', 'panel-logs-tab-1']);
    expect(state.rows[0]).toMatchObject({ health: 'green', x: 0, y: 0, width: 100, height: 80 });
    expect(state.rows[1]).toMatchObject({ health: 'yellow', x: 200, y: 50, width: 320, height: 240 });
    expect(state.logLines).toHaveLength(1);
    expect(state.logLines[0].level).toBe('error');
    expect(state.logLines[0].text).toContain('Disk drift');
  });

  it('LexeraInspectorTestApi.clickDestroy / clickReload fire the same Tauri commands a real click would', async () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    const invoke = vi.fn((cmd, args) => {
      if (cmd === 'multiview_list') {
        return Promise.resolve([{ label: 'panel-logs-tab-1', x: 1, y: 2, width: 3, height: 4, url: 'http://z/' }]);
      }
      if (cmd === 'multiview_list_health') return Promise.resolve({ 'panel-logs-tab-1': 'green' });
      if (cmd === 'multiview_destroy' || cmd === 'multiview_spawn') return Promise.resolve(args || null);
      return Promise.resolve(null);
    });
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; }),
      invoke,
      getCurrentWebview: vi.fn(() => ({ label: 'inspector' }))
    };

    loadInspectorView(window, {
      requestAnimationFrame: vi.fn(() => 1),
      setInterval: vi.fn(() => 1)
    });

    capturedOpts.onReady();
    await flushPromises();

    expect(window.LexeraInspectorTestApi.clickReload('panel-logs-tab-1')).toBe(true);
    await flushPromises();
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith('multiview_destroy', { label: 'panel-logs-tab-1' });
    expect(invoke).toHaveBeenCalledWith('multiview_spawn', {
      req: { label: 'panel-logs-tab-1', url: 'http://z/', x: 1, y: 2, width: 3, height: 4 }
    });

    invoke.mockClear();

    // After reload, the row repopulates through polling.
    await flushPromises();
    expect(window.LexeraInspectorTestApi.clickDestroy('panel-logs-tab-1')).toBe(true);
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith('multiview_destroy', { label: 'panel-logs-tab-1' });

    // Unknown label → no-op (returns false).
    expect(window.LexeraInspectorTestApi.clickDestroy('does-not-exist')).toBe(false);
    expect(window.LexeraInspectorTestApi.clickReload('does-not-exist')).toBe(false);
  });
});
