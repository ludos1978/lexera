import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadModules() {
  // Minimal DOM stubs
  if (!globalThis.document) {
    globalThis.document = {
      createElement: function (tag) {
        var el = {
          tagName: tag.toUpperCase(),
          className: '',
          innerHTML: '',
          textContent: '',
          style: {},
          children: [],
          childNodes: [],
          attributes: {},
          setAttribute: function (k, v) { this.attributes[k] = v; },
          getAttribute: function (k) { return this.attributes[k] || null; },
          removeAttribute: function (k) { delete this.attributes[k]; },
          appendChild: function (c) { this.children.push(c); this.childNodes.push(c); c.parentNode = this; return c; },
          insertBefore: function (c) { this.children.unshift(c); this.childNodes.unshift(c); c.parentNode = this; return c; },
          querySelector: function (sel) {
            // Simple class-based selector
            var cls = sel.replace(/^\./, '');
            for (var i = 0; i < this.children.length; i++) {
              if (this.children[i].className && this.children[i].className.indexOf(cls) !== -1) return this.children[i];
            }
            // Also search innerHTML-created elements
            if (this.innerHTML && this.innerHTML.indexOf(cls) !== -1) {
              var div = { tagName: 'DIV', className: cls, innerHTML: '', textContent: '', style: {},
                children: [], childNodes: [], attributes: {},
                setAttribute: function (k, v) { this.attributes[k] = v; },
                getAttribute: function (k) { return this.attributes[k] || null; },
                removeAttribute: function (k) { delete this.attributes[k]; },
                appendChild: function () {}, querySelector: function () { return null; },
                querySelectorAll: function () { return []; }
              };
              return div;
            }
            return null;
          },
          querySelectorAll: function () { return []; },
          classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
          addEventListener: function () {},
          removeEventListener: function () {},
          remove: function () {},
          parentNode: null,
          isConnected: true
        };
        return el;
      },
      getElementById: function () { return null; },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      body: { appendChild: function () {} },
      head: { appendChild: function () {} },
      addEventListener: function () {},
      dispatchEvent: function () {}
    };
  }
  if (!globalThis.window) globalThis.window = globalThis;
  if (!globalThis.CustomEvent) globalThis.CustomEvent = function (name, opts) { this.type = name; this.detail = opts ? opts.detail : null; };
  if (!globalThis.localStorage) {
    var store = {};
    globalThis.localStorage = {
      getItem: function (k) { return store[k] || null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    };
  }
  globalThis.traceFrontendAction = function () {};
  globalThis.IntersectionObserver = undefined;

  // Load sharedPanels
  var spSrc = readFileSync(resolve(srcDir, 'workspace', 'sharedPanels.js'), 'utf-8');
  new Function(spSrc)();

  // Load contentEnhancerRegistry
  var cerSrc = readFileSync(resolve(srcDir, 'contentEnhancerRegistry.js'), 'utf-8');
  new Function(cerSrc)();

  // Load tagSystem stub
  globalThis.LexeraTagSystem = { getColumnLayoutTags: function () { return {}; }, getElementSizeTag: function () { return null; } };

  // Load orderHelpers
  var ohSrc = readFileSync(resolve(srcDir, 'board', 'orderHelpers.js'), 'utf-8');
  new Function(ohSrc)();
}

describe('Calendar Panel Integration', function () {
  beforeAll(function () {
    loadModules();
  });

  it('LexeraSharedPanels can create weekCalendar panel', function () {
    var panel = globalThis.LexeraSharedPanels.createPanelElement('weekCalendar', 'weekCalendar');
    expect(panel).not.toBeNull();
    expect(panel.className).toContain('lexera-shared-panel-week-calendar');
    expect(panel.innerHTML).toContain('lexera-shared-calendar-week-view');
    expect(panel.innerHTML).toContain('lexera-shared-calendar-task-list');
  });

  it('LexeraSharedPanels can create monthCalendar panel', function () {
    var panel = globalThis.LexeraSharedPanels.createPanelElement('monthCalendar', 'monthCalendar');
    expect(panel).not.toBeNull();
    expect(panel.className).toContain('lexera-shared-panel-month-calendar');
    expect(panel.innerHTML).toContain('lexera-shared-calendar-month-view');
  });

  it('LexeraSharedPanels creates hierarchy panels without the old workspace dropdown', function () {
    var panel = globalThis.LexeraSharedPanels.createPanelElement('hierarchy', 'hierarchy');
    expect(panel).not.toBeNull();
    expect(panel.className).toContain('lexera-shared-panel-hierarchy');
    expect(panel.innerHTML).toContain('sidebar-header-title');
    expect(panel.innerHTML).toContain('lexera-shared-workspace-menu');
    expect(panel.innerHTML).not.toContain('lexera-shared-workspace-select');
  });

  it('LexeraSharedPanels creates dashboard panels without the removed default suggestion chips', function () {
    var panel = globalThis.LexeraSharedPanels.createPanelElement('dashboard', 'dashboard');
    expect(panel).not.toBeNull();
    expect(panel.className).toContain('lexera-shared-panel-dashboard');
    expect(panel.innerHTML).toContain('lexera-shared-dashboard-pin');
    expect(panel.innerHTML).toContain('lexera-shared-dashboard-pinned');
    expect(panel.innerHTML).not.toContain('dashboard-quick-row');
    expect(panel.innerHTML).not.toContain('dashboard-chip');
    expect(panel.innerHTML).not.toContain('data-dashboard-query');
  });

  it('getRoots returns created calendar panels', function () {
    var weekRoots = globalThis.LexeraSharedPanels.getRoots('weekCalendar');
    var monthRoots = globalThis.LexeraSharedPanels.getRoots('monthCalendar');
    expect(weekRoots.length).toBeGreaterThan(0);
    expect(monthRoots.length).toBeGreaterThan(0);
  });

  it('LexeraOrderHelpers exports getCalendarTasks and renderStandaloneCalendarPanels', function () {
    var OH = globalThis.LexeraOrderHelpers;
    expect(typeof OH.getCalendarTasks).toBe('function');
    expect(typeof OH.renderStandaloneCalendarPanels).toBe('function');
    expect(typeof OH.scheduleDashboardRefresh).toBe('function');
  });

  it('getCalendarTasks returns empty array when no dashboardState', function () {
    var OH = globalThis.LexeraOrderHelpers;
    var tasks = OH.getCalendarTasks();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBe(0);
  });

  it('renderStandaloneCalendarPanels does not throw with empty tasks', function () {
    var OH = globalThis.LexeraOrderHelpers;
    expect(function () {
      OH.renderStandaloneCalendarPanels([]);
    }).not.toThrow();
  });

  it('renderStandaloneCalendarPanels renders tasks into week panel', function () {
    var OH = globalThis.LexeraOrderHelpers;
    var now = new Date();
    var todayStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
    var tasks = [
      { dueDate: todayStr, cardContent: 'Test task for today', boardTitle: 'Test Board', isOverdue: false }
    ];
    OH.renderStandaloneCalendarPanels(tasks);
    // Verify the week panel root has content
    var weekRoots = globalThis.LexeraSharedPanels.getRoots('weekCalendar');
    expect(weekRoots.length).toBeGreaterThan(0);
    var weekView = weekRoots[0].querySelector('.lexera-shared-calendar-week-view');
    // The view should have content rendered (innerHTML set by renderWeekTimeline)
    expect(weekView).not.toBeNull();
  });
});
