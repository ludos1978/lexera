// @vitest-environment jsdom

/**
 * Workspace-shell dashboard mirror contract.
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
 * This test pins the SHELL-side half: the mirror DOM exists with the
 * right IDs, and the renderDashboard() tail issues a
 * `dashboard-mirror-update` broadcast carrying { lists, loading,
 * query, scope }.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
});
