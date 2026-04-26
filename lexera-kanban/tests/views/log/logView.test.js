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

function createDom() {
  return new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <header class="header">
          <span class="title">Log</span>
          <div class="filters" id="filters"></div>
          <button class="clear-btn" id="clear-btn" type="button">Clear</button>
          <span class="status" id="status"></span>
        </header>
        <main class="entries" id="entries"></main>
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
      init: vi.fn((opts) => { capturedOpts = opts; })
    };

    loadLogView(window);

    expect(window.LexeraSubApp.init).toHaveBeenCalledTimes(1);
    expect(capturedOpts).toBeTruthy();
    expect(typeof capturedOpts.onLog).toBe('function');
    expect(typeof capturedOpts.onReady).toBe('function');
    expect(typeof capturedOpts.onError).toBe('function');

    capturedOpts.onReady();
    expect(window.document.getElementById('status').textContent).toBe('connected');

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
    expect(window.document.getElementById('status').textContent).toBe('1/1 entries');
  });

  it('filters and clears entries locally after subscription delivery', () => {
    const dom = createDom();
    const { window } = dom;
    let capturedOpts = null;
    window.LexeraSubApp = {
      init: vi.fn((opts) => { capturedOpts = opts; })
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

    const chips = window.document.querySelectorAll('.filter-chip');
    const infoChip = Array.from(chips).find((chip) => chip.textContent === 'info');
    infoChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    let rendered = window.document.querySelectorAll('.entry');
    expect(rendered).toHaveLength(1);
    expect(rendered[0].textContent).toContain('Error line');

    window.document.getElementById('clear-btn')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    rendered = window.document.querySelectorAll('.entry');
    expect(rendered).toHaveLength(0);
    expect(window.document.getElementById('status').textContent).toBe('0/0 entries');
  });
});
