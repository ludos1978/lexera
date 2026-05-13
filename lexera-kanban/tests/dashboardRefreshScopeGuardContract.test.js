// Dashboard-refresh scope-guard contract.
//
// User TODO line 40: "Ensure board changes from cross-view drops refresh
// only the changed board subtree or affected webview, not the whole
// workspace". The workspace shell's `state.hooks.refreshDashboard` is
// called whenever any embedded kanban posts `lexera-board-mutated` to
// its parent. Without a scope guard, a mutation to ANY board triggers
// `scheduleDashboardRefresh(0)` — which fires a global
// `LexeraApi.getDashboardData` query even when the dashboard is scoped
// to 'active' and a DIFFERENT board changed. That's the "whole-
// workspace refresh" the TODO calls out.
//
// Fix shipped in orderHelpers.js: when `dashboardState.scope === 'active'`
// AND the mutated boardId differs from the active boardId, skip the
// refresh entirely. For scope 'all' (every board contributes to the
// dashboard) the guard is a no-op so the existing behavior is unchanged.
//
// Source-grep contract — pins the guard's exact location and shape so
// it can't silently regress.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const orderHelpersSrc = readFileSync(
  resolve(repoRoot, 'src', 'board', 'orderHelpers.js'),
  'utf8'
);

describe('dashboard-refresh scope guard (TODO line 40)', () => {
  it('refreshDashboard hook accepts boardId as first argument (was previously dropping it)', () => {
    // Hook signature is `function (boardId, _fullBoard, _pane)`. The
    // shell calls it as `refreshDashboard(mutatedBoardId, fullBoard,
    // data.pane)` so the boardId must flow through.
    expect(orderHelpersSrc).toMatch(
      /refreshDashboard\s*:\s*function\s*\(\s*boardId\s*,\s*_?fullBoard\s*,\s*_?pane\s*\)/
    );
  });

  it('skips scheduleDashboardRefresh when scope=active AND boardId !== activeBoardId', () => {
    // The guard pattern — when dashboardState.scope is 'active' and the
    // mutated board isn't the active one, the refresh produces no visible
    // delta in the dashboard so we skip the LexeraApi.getDashboardData
    // query that scheduleDashboardRefresh(0) would have triggered.
    expect(orderHelpersSrc).toMatch(
      /refreshDashboard\s*:\s*function[\s\S]{0,1200}dashboardState\s*&&\s*dashboardState\.scope\s*===\s*['"]active['"][\s\S]{0,300}boardId\s*!==\s*activeId[\s\S]{0,200}return\s*;/
    );
  });

  it('still calls scheduleDashboardRefresh for scope=all OR when boardId matches activeBoardId', () => {
    // The fallthrough path — the guard only returns early for the
    // specific 'active scope + different board' case; every other case
    // continues to the existing refresh call.
    expect(orderHelpersSrc).toMatch(
      /refreshDashboard\s*:\s*function[\s\S]{0,800}scheduleDashboardRefresh\(0\)/
    );
  });
});
