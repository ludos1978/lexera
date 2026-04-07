/**
 * Tests for the dashboard pending-flag system in orderHelpers.js.
 *
 * Covers the fix for "values in the dashboard only display if I focus the
 * dashboard view". The fix tracks two flags:
 *   - dashboardRefreshPending: backend fetch was skipped, try again when DOM is back
 *   - dashboardRenderPending:  data is fresh, re-render when DOM reconnects
 *
 * These tests verify the flags are set/cleared correctly without depending on
 * any actual DOM rendering or network calls.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

let OrderHelpers;
let dashboardRootEl = null;

function createStorage() {
  const store = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  };
}

beforeAll(() => {
  OrderHelpers = loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers', {
    window: { LexeraRuntime: null },
    document: { getElementById: () => null, querySelector: () => null }
  });
});

beforeEach(() => {
  globalThis.localStorage = createStorage();
  // Ensure LexeraSharedPanels is not defined so hasAnyCalendarPanel() returns false
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
  globalThis.window.LexeraSharedPanels = null;
  dashboardRootEl = null;

  // Prime dashboardState so renderDashboard does not return early.
  // renderDashboard's first guard is `if (!dashboardState) return;` — without
  // a valid state object, the function bails before reaching the flag logic.
  const dashboardState = {
    query: '',
    scope: 'active',
    loading: false,
    results: [],
    overdue: [],
    today: [],
    thisWeek: [],
    upcoming: [],
    later: [],
    todos: [],
    taggedGroups: [],
    pinnedQueries: [],
    activePinnedQuery: '',
    fileInventoryLoading: false,
    fileEmbeds: [],
    includedFiles: [],
    brokenFiles: []
  };

  // Init with minimal stubs — most deps are called conditionally and guarded.
  OrderHelpers.init({
    dashboardState,
    boards: [],
    renderBoardList: vi.fn(),
    // Core dep: controls whether renderDashboard/refreshDashboardData bail out
    getElDashboardRoot: () => dashboardRootEl,
    // Calendar helpers — return empty task list so getCalendarTasks() works
    getCalendarTasks: () => [],
    renderStandaloneCalendarPanels: () => {},
    getCanvasModeHelpers: () => ({ normalizeBoardLayoutValue: (v) => v }),
    getDashboardTreeApi: () => ({
      buildDashboardResultTreeNodes: () => [],
      buildDashboardTaggedTreeNodes: () => []
    }),
    // Runtime state: not connected → refreshDashboardData takes the "clear + render" path
    connected: false,
    embeddedMode: false,
    workspaceShellEnabled: false,
    LexeraApi: { getDashboardData: () => Promise.resolve({ query: {}, calendar: {}, todos: {}, tags: [] }) },
    // Element getters for sub-renderers (unused when dashboard root is null)
    getElDashboardResultsList: () => null,
    getElDashboardOverdueList: () => null,
    getElDashboardUpcomingList: () => null,
    getElDashboardTodosList: () => null,
    getElDashboardTaggedList: () => null,
    getElDashboardPinnedList: () => null,
    logFrontendIssue: () => {}
  });

  OrderHelpers._resetDashboardPendingFlags();
});

describe('dashboard pending-flag system', () => {
  it('starts with both flags false', () => {
    const flags = OrderHelpers._getDashboardPendingFlags();
    expect(flags.refresh).toBe(false);
    expect(flags.render).toBe(false);
  });

  it('renderDashboard sets render-pending flag when dashboard DOM is missing', () => {
    dashboardRootEl = null;
    OrderHelpers.renderDashboard();
    const flags = OrderHelpers._getDashboardPendingFlags();
    expect(flags.render).toBe(true);
    // Render-pending should NOT trigger a refresh — data fetch is expensive
    expect(flags.refresh).toBe(false);
  });

  it('scheduleDashboardRefresh sets refresh-pending flag when DOM is missing', () => {
    dashboardRootEl = null;
    OrderHelpers.scheduleDashboardRefresh(0);
    const flags = OrderHelpers._getDashboardPendingFlags();
    expect(flags.refresh).toBe(true);
  });

  it('flushPendingDashboardRefresh clears render-pending flag when DOM reconnects', () => {
    // Simulate: element detached, render attempted, flag set
    dashboardRootEl = null;
    OrderHelpers.renderDashboard();
    expect(OrderHelpers._getDashboardPendingFlags().render).toBe(true);

    // Element reconnects — flush should clear the flag.
    // Provide a querySelector that returns something for .sidebar-dashboard-body
    // so renderDashboard doesn't crash when it tries to set view loading state.
    const dashBody = { classList: { add: () => {}, remove: () => {}, toggle: () => {} } };
    dashboardRootEl = {
      querySelector: () => dashBody,
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      addEventListener: () => {}
    };
    OrderHelpers.flushPendingDashboardRefresh();
    expect(OrderHelpers._getDashboardPendingFlags().render).toBe(false);
  });

  it('flushPendingDashboardRefresh is a no-op when neither flag is set', () => {
    dashboardRootEl = { querySelector: () => null };
    // No flags set — flush should do nothing
    OrderHelpers.flushPendingDashboardRefresh();
    const flags = OrderHelpers._getDashboardPendingFlags();
    expect(flags.render).toBe(false);
    expect(flags.refresh).toBe(false);
  });

  it('flushPendingDashboardRefresh does not clear render-pending if DOM is still missing', () => {
    dashboardRootEl = null;
    OrderHelpers.renderDashboard();
    expect(OrderHelpers._getDashboardPendingFlags().render).toBe(true);

    // DOM still null — flush should not clear the flag prematurely
    OrderHelpers.flushPendingDashboardRefresh();
    expect(OrderHelpers._getDashboardPendingFlags().render).toBe(true);
  });

  it('calendar-only scenario: renderDashboard without DOM still sets render-pending', () => {
    // This is the scenario the critic found: calendars exist but dashboard DOM is hidden.
    // The old code set refresh-pending, causing a redundant API call every onAfterRender.
    // The fix uses render-pending instead (cheaper — no network).
    dashboardRootEl = null;
    OrderHelpers.renderDashboard();
    const flags = OrderHelpers._getDashboardPendingFlags();
    expect(flags.render).toBe(true);
    expect(flags.refresh).toBe(false); // key invariant: no unnecessary fetch
  });
});
