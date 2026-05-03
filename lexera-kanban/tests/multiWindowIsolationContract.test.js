// Multi-window isolation contract — single high-level audit.
//
// The lexera-kanban Tauri app supports multiple top-level windows
// (File > New Window, File > Open Workspace ▶ <ws>, panel-only
// detached windows). For these to feel like independent apps,
// shell state, layout, drag, focus, dialogs, and external watch
// processes MUST stay per-window. The few things that DO cross
// windows (backend connection, file watcher events, log stream)
// are intentional and documented as such.
//
// Earlier audits found 11+ leak vectors. Each was fixed in its own
// commit with a per-feature contract test. THIS file is the
// architectural summary: it re-asserts the *general patterns*
// (not specific call sites) so a refactor that breaks any of them
// fails CI even if a per-feature test was deleted.
//
// If a new pattern of cross-window leak is discovered, ADD an
// assertion here AND link the per-feature contract that pins the
// concrete fix.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '..', 'src');
const tauriRoot = resolve(__dirname, '..', 'src-tauri', 'src');

function readSrc(rel) { return readFileSync(resolve(srcRoot, rel), 'utf8'); }
function readTauri(rel) { return readFileSync(resolve(tauriRoot, rel), 'utf8'); }

// Strip line comments (`// …` to end-of-line) so contract regexes
// match only ACTUAL Rust/JS code, not patterns documented in comments
// (which often reference what we DON'T do).
function codeOnly(text) {
  return text.split('\n').map(function (line) {
    var idx = line.indexOf('//');
    return idx === -1 ? line : line.substring(0, idx);
  }).join('\n');
}

// ────────────────────────────────────────────────────────────────────
// PATTERN 1 — Shared Tauri-managed Rust state must be keyed per-window
// ────────────────────────────────────────────────────────────────────

describe('Pattern 1: shared Rust state is keyed by window or webview label', () => {
  const webviewMgrRs = codeOnly(readTauri('webview_mgr.rs'));
  const dragRs = codeOnly(readTauri('drag_coordinator.rs'));
  const exportRs = codeOnly(readTauri('export_commands.rs'));

  it('FocusTracker is HashMap<window_label, Option<webview_label>> — never Option<String>', () => {
    expect(webviewMgrRs).toMatch(/inner:\s*parking_lot::Mutex<std::collections::HashMap<String,\s*Option<String>>>/);
    expect(webviewMgrRs).not.toMatch(/struct FocusTracker[\s\S]{0,200}Mutex<Option<String>>/);
  });

  it('DragState is HashMap<window_label, ActiveDrag> — never Option<ActiveDrag>', () => {
    expect(dragRs).toMatch(/inner:\s*Mutex<HashMap<String,\s*ActiveDrag>>/);
    expect(dragRs).not.toMatch(/inner:\s*Mutex<Option<ActiveDrag>>/);
  });

  it('MarpWatchState pids HashMap is keyed by (window_label, input_path)', () => {
    expect(exportRs).toMatch(/pids:\s*Mutex<HashMap<\(String,\s*String\),\s*u32>>/);
    expect(exportRs).not.toMatch(/pids:\s*Mutex<HashMap<String,\s*u32>>/);
  });
});

// ────────────────────────────────────────────────────────────────────
// PATTERN 2 — Lifecycle commands resolve target windows from registry
// ────────────────────────────────────────────────────────────────────

describe('Pattern 2: lifecycle commands resolve windows dynamically (no hardcoded "main")', () => {
  const webviewMgrRs = codeOnly(readTauri('webview_mgr.rs'));

  function fnSlice(name) {
    var start = webviewMgrRs.indexOf('pub fn ' + name);
    var end = webviewMgrRs.indexOf('pub fn ', start + 1);
    return webviewMgrRs.substring(start, end === -1 ? webviewMgrRs.length : end);
  }

  // The 4 lifecycle commands that previously hardcoded `app.get_window("main")`.
  // Each must now resolve via `app.webviews().get(label)` so secondary windows work.
  const HARDCODED_FREE = ['multiview_destroy', 'multiview_set_geometry', 'multiview_navigate', 'multiview_set_visible'];

  HARDCODED_FREE.forEach(function (fn) {
    it(fn + ' does NOT contain `app.get_window("main")` in production code', () => {
      var slice = fnSlice(fn);
      expect(slice).not.toMatch(/app\.get_window\("main"\)/);
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// PATTERN 3 — Cross-window events must use scoped emit, not app.emit
// ────────────────────────────────────────────────────────────────────

describe('Pattern 3: window-scoped events do not use global app.emit', () => {
  const webviewMgrRs = codeOnly(readTauri('webview_mgr.rs'));
  const dragRs = codeOnly(readTauri('drag_coordinator.rs'));

  // Events that, when emitted globally, leak into sibling windows.
  // Each must use `emit_to_window_of_label` or per-webview `emit_to`.
  const SCOPED_EVENTS = [
    'drag-began', 'drag-ended',
    'focus-changed', 'multiview-destroyed', 'health-changed'
  ];

  SCOPED_EVENTS.forEach(function (eventName) {
    it('"' + eventName + '" is never emitted via global app.emit', () => {
      var pattern = new RegExp('app\\.emit\\(\\s*"' + eventName + '"');
      expect(webviewMgrRs).not.toMatch(pattern);
      expect(dragRs).not.toMatch(pattern);
    });
  });

  it('log-message stays GLOBAL by design (Log panel reflects activity from any window)', () => {
    // Sanity: log-message is the one event that should keep app.emit.
    // If this assertion ever needs to be removed, the architectural
    // decision must be re-evaluated.
    expect(webviewMgrRs).toMatch(/app\.emit\(\s*"log-message"/);
  });
});

// ────────────────────────────────────────────────────────────────────
// PATTERN 4 — Webview labels are globally unique (bootId suffix)
// ────────────────────────────────────────────────────────────────────

describe('Pattern 4: every webview label embeds a per-shell bootId', () => {
  const boardHostJs = readSrc('workspace/boardHost.js');
  const panelHostJs = readSrc('workspace/panelHost.js');
  const workspaceShellJs = readSrc('workspace/workspaceShell.js');

  it('boardHost.multiviewLabelForTab embeds the configured bootId', () => {
    expect(boardHostJs).toMatch(/'board-tab-' \+ _bootId \+ '-' \+ safeTabId/);
  });

  it('panelHost.panelLabelForTab embeds the configured bootId', () => {
    expect(panelHostJs).toMatch(/'panel-tab-' \+ _bootId \+ '-' \+ safeTabId/);
  });

  it('workspaceShell calls setup({ bootId }) on both host modules', () => {
    expect(workspaceShellJs).toMatch(/boardHost\.setup\(\{\s*bootId:\s*WORKSPACE_SHELL_BOOT_ID\s*\}\)/);
    expect(workspaceShellJs).toMatch(/panelHost\.setup\(\{\s*bootId:\s*WORKSPACE_SHELL_BOOT_ID\s*\}\)/);
  });
});

// ────────────────────────────────────────────────────────────────────
// PATTERN 5 — Window-close cleanup purges every per-window registry
// ────────────────────────────────────────────────────────────────────

describe('Pattern 5: CloseRequested cleans up every per-window registry', () => {
  const mainRs = codeOnly(readTauri('main.rs'));
  const webviewMgrRs = codeOnly(readTauri('webview_mgr.rs'));
  const exportRs = codeOnly(readTauri('export_commands.rs'));

  it('SubscriptionRegistry exposes drop_labels and CloseRequested invokes it', () => {
    expect(webviewMgrRs).toMatch(/impl SubscriptionRegistry[\s\S]{0,800}fn drop_labels/);
    expect(mainRs).toMatch(/CloseRequested[\s\S]{0,5000}SubscriptionRegistry[\s\S]{0,200}drop_labels\(&dead_labels\)/);
  });

  it('HealthTracker exposes drop_labels and CloseRequested invokes it', () => {
    expect(webviewMgrRs).toMatch(/impl HealthTracker[\s\S]{0,500}fn drop_labels/);
    expect(mainRs).toMatch(/CloseRequested[\s\S]{0,5000}HealthTracker[\s\S]{0,200}drop_labels\(&dead_labels\)/);
  });

  it('FocusTracker exposes drop_window and CloseRequested invokes it', () => {
    expect(webviewMgrRs).toMatch(/impl FocusTracker[\s\S]{0,400}fn drop_window/);
    expect(mainRs).toMatch(/CloseRequested[\s\S]{0,5000}FocusTracker[\s\S]{0,200}drop_window\(&closing_label\)/);
  });

  it('MarpWatchState exposes stop_window and CloseRequested invokes it (kills orphan watch processes)', () => {
    expect(exportRs).toMatch(/impl MarpWatchState[\s\S]{0,1500}fn stop_window/);
    expect(mainRs).toMatch(/CloseRequested[\s\S]{0,5000}MarpWatchState[\s\S]{0,200}stop_window\(&closing_label\)/);
  });

  it('LAST_FOCUSED_WINDOW is cleared if it pointed at the closing window', () => {
    expect(mainRs).toMatch(/CloseRequested[\s\S]{0,2000}LAST_FOCUSED_WINDOW\.lock\(\)[\s\S]{0,400}\*last = None/);
  });
});

// ────────────────────────────────────────────────────────────────────
// PATTERN 6 — Per-window UX state goes through Settings.WINDOW_DEFS
// ────────────────────────────────────────────────────────────────────

describe('Pattern 6: per-window UX state lives in WINDOW_DEFS, not DEFS', () => {
  const settingsJs = readSrc('core/settingsStore.js');

  it('WINDOW_DEFS is exposed and the resolver picks workspace > windowLabel', () => {
    expect(settingsJs).toMatch(/var WINDOW_DEFS\s*=\s*\{/);
    expect(settingsJs).toMatch(/function _resolveWindowScope/);
    expect(settingsJs).toMatch(/params\.get\('workspace'\)/);
    expect(settingsJs).toMatch(/params\.get\('windowLabel'\)/);
  });

  it('UX state keys that previously leaked are NOT in DEFS anymore', () => {
    // Each of these used to be a DEFS entry; storage events fired
    // cross-window when one window updated its sidebar / dashboard /
    // log filters. Moving them to WINDOW_DEFS scopes the storage
    // key by `:{windowScope}` so sibling windows write to a
    // different key — no `storage` event in the other window.
    var defs = settingsJs.substring(settingsJs.indexOf('var DEFS = {'), settingsJs.indexOf('var BOARD_DEFS = {'));
    [
      'sidebarSplitRatio', 'sidebarWidth', 'hierarchyLocked',
      'dashboardQuery', 'dashboardScope', 'dashboardActivePinned',
      'dashboardPinnedQueries', 'dashboardTags', 'dashboardCollapsed',
      'logCategories', 'logLevels', 'logSearch', 'logSource',
      'activeWorkspace'
    ].forEach(function (key) {
      var pattern = new RegExp('^\\s*' + key + ':\\s*\\{', 'm');
      expect(defs).not.toMatch(pattern);
    });
  });

  it('No frontend file installs a cross-window storage event listener for a known leaky key', () => {
    // Reads every .js file under src/ and checks for the legacy
    // pattern `event.key === 'lexera-…'`. The dashboard / log /
    // active-workspace branches were removed; if any reappear,
    // multi-window UX state syncs cross-window.
    var leakyKeys = [
      'lexera-active-workspace',
      'lexera-dashboard-query',
      'lexera-dashboard-scope',
      'lexera-dashboard-active-pinned',
      'lexera-dashboard-pinned-queries',
      'lexera-dashboard-collapsed',
      'lexera-dashboard-tags',
      'lexera-log-categories',
      'lexera-log-levels',
      'lexera-log-search',
      'lexera-sidebar-width',
      'lexera-sidebar-split-ratio',
      'lexera-hierarchy-locked'
    ];
    function walk(dir) {
      var entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
      var out = [];
      entries.forEach(function (e) {
        var full = resolve(dir, e.name);
        if (e.isDirectory()) out = out.concat(walk(full));
        else if (e.name.endsWith('.js')) out.push(full);
      });
      return out;
    }
    var jsFiles = walk(srcRoot);
    var offenders = [];
    jsFiles.forEach(function (path) {
      var src = readFileSync(path, 'utf8');
      leakyKeys.forEach(function (key) {
        var pattern = new RegExp("event\\.key\\s*===\\s*['\"]" + key + "['\"]");
        if (pattern.test(src)) offenders.push(path + ' :: ' + key);
      });
    });
    expect(offenders).toEqual([]);
  });
});
