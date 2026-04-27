import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'views', 'weekCalendar', 'weekCalendar.js'),
  'utf8'
);

function loadWeekCalendarView(window) {
  const factory = new Function('window', 'document', source);
  factory(window, window.document);
}

function createDom() {
  return new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <div class="calendar-panel lexera-shared-panel lexera-shared-panel-week-calendar">
          <header class="calendar-panel-header">
            <span class="calendar-panel-title">Week Calendar</span>
            <div class="calendar-panel-controls">
              <select class="calendar-scope-select lexera-shared-calendar-scope">
                <option value="active">Active Board</option>
                <option value="all">All Boards</option>
              </select>
            </div>
          </header>
          <main class="calendar-panel-body view-loading">
            <div class="dashboard-calendar lexera-shared-calendar-week-view"></div>
            <div class="dashboard-list lexera-shared-calendar-task-list"></div>
          </main>
        </div>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/weekCalendar/index.html?panelKind=weekCalendar&pane=tab-1' });
}

describe('weekCalendar view sub-app', () => {
  it('mounts the runtime in week mode then registers refresh callbacks via a single LexeraSubApp.init', () => {
    const dom = createDom();
    const { window } = dom;
    const subAppInit = vi.fn();
    const refresh = vi.fn();
    const mount = vi.fn(() => ({ refresh }));
    window.LexeraSubApp = { init: subAppInit };
    window.LexeraCalendarRuntime = { mount };

    loadWeekCalendarView(window);

    // Mount runs first so the bootstrap can attach refresh to subsequent
    // multiview events.
    expect(mount).toHaveBeenCalledTimes(1);
    const [panelArg, opts] = mount.mock.calls[0];
    expect(panelArg).toBe(window.document.querySelector('.calendar-panel'));
    expect(opts).toEqual({ kind: 'week' });

    // Single SubApp.init with the calendar's onCustom handlers — replaces
    // the previous double-init (one in the bootstrap with `{}`, another
    // inside calendarRuntime.mount with onCustom).
    expect(subAppInit).toHaveBeenCalledTimes(1);
    const initOpts = subAppInit.mock.calls[0][0];
    expect(typeof initOpts.onCustom['management-board-mutation']).toBe('function');
    expect(typeof initOpts.onCustom['calendar-tasks-update']).toBe('function');
    initOpts.onCustom['management-board-mutation']();
    initOpts.onCustom['calendar-tasks-update']();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('refreshes the calendar when the scope filter changes', () => {
    const dom = createDom();
    const { window } = dom;
    const refresh = vi.fn();
    window.LexeraSubApp = { init: vi.fn() };
    window.LexeraCalendarRuntime = { mount: vi.fn(() => ({ refresh })) };

    loadWeekCalendarView(window);

    const scope = window.document.querySelector('.lexera-shared-calendar-scope');
    scope.value = 'all';
    scope.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('surfaces mount failures inline without throwing', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    window.LexeraCalendarRuntime = {
      mount: vi.fn(() => { throw new Error('boom'); })
    };

    expect(() => loadWeekCalendarView(window)).not.toThrow();
    const errEl = window.document.querySelector('.calendar-panel-error');
    expect(errEl).toBeTruthy();
    expect(errEl.textContent).toContain('Failed to initialize Week Calendar');
    expect(errEl.textContent).toContain('boom');
  });

  it('does not crash when LexeraCalendarRuntime is missing', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    // No LexeraCalendarRuntime set
    expect(() => loadWeekCalendarView(window)).not.toThrow();
  });
});
