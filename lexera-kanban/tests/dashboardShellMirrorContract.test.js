// @vitest-environment jsdom

/**
 * Workspace-shell dashboard mirror contract — regex + runtime.
 *
 * The dashboard sub-app's visible surface lives in a child webview, so
 * the SHELL no longer has a `#sidebar-dashboard` element of its own.
 * orderHelpers.js#renderDashboard() lazily creates a HIDDEN mirror with
 * the same IDs the renderer pipeline targets — `renderDashboardResult-
 * Items` and friends keep writing innerHTML on
 * `document.getElementById('dashboard-results-list')` exactly as
 * before, but the writes land in the off-screen mirror. After each
 * render we harvest the mirror and broadcast each list's innerHTML
 * to the dashboard webview, which writes it into its own visible
 * elements.
 *
 * Two layers:
 *   1. Source-level regex audit pins the canonical IDs / call sites
 *      so a textual refactor can't drift them silently.
 *   2. Runtime test loads orderHelpers.js into jsdom, exercises
 *      `_ensureDashboardShellMirrorForTest`, and confirms the mirror
 *      DOM has the right structure + style — catches mismatches the
 *      regex layer can't see (e.g. a typo'd id that survives the
 *      regex because the same typo is also in the source).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const orderHelpersJs = readFileSync(resolve(__dirname, '..', 'src', 'board', 'orderHelpers.js'), 'utf8');
const dashboardJs = readFileSync(resolve(__dirname, '..', 'src', 'views', 'dashboard', 'dashboard.js'), 'utf8');

describe('dashboard shell mirror contract', () => {
  it('orderHelpers.js exposes the nine canonical list IDs the renderer pipeline writes into', () => {
    // Drift here would silently leave a list slot un-mirrored: the SHELL
    // would render correctly into its hidden DOM but the matching slot
    // in the dashboard webview would never receive an update.
    const required = [
      'dashboard-results-list',
      'dashboard-pinned-list',
      'dashboard-overdue-list',
      'dashboard-upcoming-list',
      'dashboard-todos-list',
      'dashboard-tagged-list',
      'dashboard-embeds-list',
      'dashboard-broken-list',
      'dashboard-included-list'
    ];
    for (const id of required) {
      expect(orderHelpersJs, `DASHBOARD_MIRROR_LIST_IDS must include '${id}'`).toContain("'" + id + "'");
    }
  });

  it('renderDashboard creates the hidden mirror and broadcasts each list HTML on completion (workspace-shell mode)', () => {
    // ensureDashboardShellMirror is called BEFORE the early-return on
    // missing `getElDashboardRoot`, so the renderer pipeline has live
    // targets — without this call refreshDashboardData would defer
    // forever and the dashboard would stay empty.
    expect(orderHelpersJs).toMatch(/_dep\('workspaceShellEnabled'\)\s*\)\s*ensureDashboardShellMirror\(\)/);
    // The broadcast fires on the tail of renderDashboard() after the
    // existing pipeline has populated the mirror.
    expect(orderHelpersJs).toMatch(/_dep\('workspaceShellEnabled'\)\s*\)\s*broadcastDashboardShellMirrorHtml\(\)/);
    // Mirror is also ensured at refreshDashboardData entry so the
    // initial fetch isn't bypassed via the `hasDashboard` gate.
    expect(orderHelpersJs).toMatch(/function refreshDashboardData[\s\S]{0,800}?ensureDashboardShellMirror\(\)/);
  });

  it('mirror is positioned off-screen + invisible — never paints in the SHELL viewport', () => {
    // Belt-and-braces: position absolute + far off-screen + visibility:
    // hidden + pointer-events: none. Drift here would leak dashboard
    // markup into the visible SHELL window.
    const cssBody = orderHelpersJs.match(/root\.style\.cssText\s*=\s*'([^']+)'/);
    expect(cssBody, "mirror root must set inline style.cssText off-screen").toBeTruthy();
    expect(cssBody[1]).toContain('position:absolute');
    expect(cssBody[1]).toMatch(/left:\s*-99999px/);
    expect(cssBody[1]).toContain('visibility:hidden');
    expect(cssBody[1]).toContain('pointer-events:none');
  });

  it('broadcast payload carries lists + loading + query + scope so the webview can render the right empty-state', () => {
    // The webview uses `loading` to swap the spinner text and `query`/
    // `scope` to render the "search all" / scope-hint copy. Missing
    // any of these would force the webview to derive them from
    // catalog-snapshot, which doesn't carry them.
    const broadcastBlock = orderHelpersJs.match(/event:\s*'dashboard-mirror-update',\s*payload:\s*\{[^}]*\}/);
    expect(broadcastBlock).toBeTruthy();
    expect(broadcastBlock[0]).toContain('lists:');
    expect(broadcastBlock[0]).toContain('loading:');
    expect(broadcastBlock[0]).toContain('query:');
    expect(broadcastBlock[0]).toContain('scope:');
  });

  it('SHELL listens for dashboard-snapshot-request so a late-mounting webview can pull the current state', () => {
    // Without this, a dashboard webview that opens after the last
    // refresh would stay stuck on "Loading dashboard…" until the next
    // unrelated render kicked the broadcast.
    expect(orderHelpersJs).toContain("listen('dashboard-snapshot-request'");
  });

  it('dashboard sub-app subscribes to dashboard-mirror-update and requests a snapshot on mount', () => {
    expect(dashboardJs).toContain("'dashboard-mirror-update': applyDashboardMirrorUpdate");
    expect(dashboardJs).toContain("LexeraSubApp.broadcast('dashboard-snapshot-request'");
    // Sub-app injects the SHELL-rendered HTML directly via innerHTML
    // for each known list ID — keep the list canonical so a renamed
    // slot is caught.
    expect(dashboardJs).toContain("'dashboard-results-list'");
    expect(dashboardJs).toContain("'dashboard-broken-list'");
    expect(dashboardJs).toContain("'dashboard-included-list'");
  });

  it('dashboard sub-app forwards tree-node clicks as dashboard-navigate, SHELL routes them through navigateToSearchResult', () => {
    // Click navigation: the rendered HTML carries data-* attributes
    // but no event handlers. The sub-app reads them and emits
    // `dashboard-navigate { target, nav }`. The SHELL listens and
    // routes the payload through `navigateToSearchResult` so the
    // existing focus + reveal chain runs unchanged.
    expect(dashboardJs).toContain("LexeraSubApp.broadcast('dashboard-navigate'");
    expect(dashboardJs).toContain("'data-dashboard-board-id'");
    expect(dashboardJs).toContain("'data-dashboard-card-id'");
    expect(dashboardJs).toContain("'data-dashboard-broken-src'");
    expect(orderHelpersJs).toContain("listen('dashboard-navigate'");
    expect(orderHelpersJs).toContain("navigateToSearchResult");
  });

  it('dashboard sub-app handles tree-toggle clicks locally so section expand/collapse does not round-trip through the SHELL', () => {
    // Local-only: clicking a section header should toggle the
    // `expanded` class on the matching `.tree-children` without
    // emitting a navigate event. Otherwise every collapse would
    // bounce a no-op `dashboard-navigate` to the SHELL.
    expect(dashboardJs).toContain(".tree-toggle");
    expect(dashboardJs).toContain("classList.toggle('expanded'");
  });
});

describe('dashboard shell mirror — runtime DOM', () => {
  afterEach(() => {
    // jsdom carries DOM state across tests; clean the mirror so
    // each test starts from a known empty state.
    var existing = document.getElementById('sidebar-dashboard');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  });

  function loadOrderHelpers() {
    // Minimal dependency surface — the mirror code only needs `document`
    // and the workspaceShellEnabled flag (reads via `_dep`). Skip the
    // hundreds of unrelated deps so the test stays fast.
    if (!global.LexeraHierarchyContract) {
      // hierarchyContract is required by the IIFE before it returns.
      // eslint-disable-next-line global-require
      global.LexeraHierarchyContract = require('../src/hierarchy/hierarchyContract.js');
    }
    return loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers');
  }

  it('ensureDashboardShellMirror() creates the off-screen mirror with all nine canonical list IDs', () => {
    const OrderHelpers = loadOrderHelpers();
    OrderHelpers.init({});
    expect(typeof OrderHelpers._ensureDashboardShellMirrorForTest).toBe('function');

    // Mirror does not exist yet.
    expect(document.getElementById('sidebar-dashboard')).toBeNull();

    OrderHelpers._ensureDashboardShellMirrorForTest();

    const root = document.getElementById('sidebar-dashboard');
    expect(root).not.toBeNull();
    expect(root.getAttribute('data-shell-mirror')).toBe('dashboard');
    expect(root.getAttribute('aria-hidden')).toBe('true');

    // Inline style must keep the mirror invisible / non-interactive /
    // outside the SHELL viewport. jsdom normalises the inline style
    // with spaces, so match the property names regardless of spacing.
    const style = (root.getAttribute('style') || '').replace(/\s+/g, '');
    expect(style).toContain('position:absolute');
    expect(style).toContain('left:-99999px');
    expect(style).toContain('visibility:hidden');
    expect(style).toContain('pointer-events:none');

    // All nine canonical list IDs land in the mirror.
    const ids = OrderHelpers._getDashboardMirrorListIds();
    expect(ids.length).toBe(9);
    for (const id of ids) {
      const el = document.getElementById(id);
      expect(el, 'mirror must include #' + id).not.toBeNull();
      expect(el.classList.contains('dashboard-list')).toBe(true);
    }
  });

  it('ensureDashboardShellMirror() is idempotent — second call is a no-op', () => {
    const OrderHelpers = loadOrderHelpers();
    OrderHelpers.init({});
    OrderHelpers._ensureDashboardShellMirrorForTest();
    const firstRoot = document.getElementById('sidebar-dashboard');
    expect(firstRoot).not.toBeNull();

    OrderHelpers._ensureDashboardShellMirrorForTest();
    const secondRoot = document.getElementById('sidebar-dashboard');
    expect(secondRoot).toBe(firstRoot);

    // Still exactly one #sidebar-dashboard element in the document.
    expect(document.querySelectorAll('#sidebar-dashboard').length).toBe(1);
  });
});
