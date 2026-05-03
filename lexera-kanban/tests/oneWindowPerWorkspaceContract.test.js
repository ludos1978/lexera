// One-workspace-per-window contract.
//
// User requirement: each window opens exactly one workspace. From any
// workspace dropdown, an "Open" action spawns a fresh window for that
// workspace (so the existing window stays on its current workspace).
// Cross-window drag-drop (boards / cards) must keep working — that
// rides the existing multiview drag IPC, not the in-window workspace
// filter.
//
// This contract test pins the wiring across four files:
//   1. native File > Open Workspace emits `open-workspace:<id>`.
//   2. workspaceShell handles that prefix before forwarding actions
//      into a child view.
//   3. navigationBridge still routes explicit open-workspace-window
//      messages to `shell.openWorkspaceWindow`.
//   4. workspaceShell.openWorkspaceWindow forwards `workspaceId` to
//      `open_new_window` so the URL of the new window carries
//      `?workspace=<id>`.
//   5. Rust `open_new_window` accepts a `workspace_id` parameter and
//      appends it to the URL.
//   6. app.js reads `?workspace=<id>` on boot and pins the window's
//      activeWorkspaceId to it (per-window only — not persisted).
//
// Each link in the chain is independently asserted; a refactor that
// drops any one of them is caught by the matching expect.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspacesJs = readFileSync(resolve(__dirname, '..', 'src', 'views', 'workspaces', 'workspaces.js'), 'utf8');
const navigationBridgeJs = readFileSync(resolve(__dirname, '..', 'src', 'shell', 'bridges', 'navigationBridge.js'), 'utf8');
const workspaceShellJs = readFileSync(resolve(__dirname, '..', 'src', 'workspace', 'workspaceShell.js'), 'utf8');
const mainRs = readFileSync(resolve(__dirname, '..', 'src-tauri', 'src', 'main.rs'), 'utf8');
const appMenuRs = readFileSync(resolve(__dirname, '..', 'src-tauri', 'src', 'app_menu.rs'), 'utf8');
const appJs = readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8');
const actionRegistrationsJs = readFileSync(resolve(__dirname, '..', 'src', 'core', 'actionRegistrations.js'), 'utf8');

describe('one workspace per window — wiring contract', () => {
  it('workspaces sub-app shows only the current workspace and no per-row workspace opener', () => {
    expect(workspacesJs).toContain('function renderCurrentWorkspace');
    expect(workspacesJs).not.toContain('ws-list');
    expect(workspacesJs).not.toContain('ws-item');
    expect(workspacesJs).not.toContain('ws-open-btn');
    expect(workspacesJs).not.toContain("'open-workspace-window'");
    expect(workspacesJs).toContain('activeWorkspaceId');
  });

  it('navigationBridge routes open-workspace-window to shell.openWorkspaceWindow', () => {
    expect(navigationBridgeJs).toContain("payload.type === 'open-workspace-window'");
    expect(navigationBridgeJs).toContain('shell.openWorkspaceWindow(payload.workspaceId)');
  });

  it('workspaceShell.openWorkspaceWindow forwards workspaceId to open_new_window so the URL pins the new window', () => {
    // The function must accept a workspaceId arg AND attach it to the
    // payload as `workspaceId` (camelCase JS field that Tauri maps to
    // the snake_case Rust `workspace_id` parameter).
    expect(workspaceShellJs).toMatch(/function openWorkspaceWindow\(workspaceId\)/);
    expect(workspaceShellJs).toMatch(/payload\.workspaceId\s*=\s*String\(workspaceId\)/);
    // Public export so navigationBridge can dispatch it.
    expect(workspaceShellJs).toContain('openWorkspaceWindow: openWorkspaceWindow');
  });

  it('workspaceShell handles native open-workspace:<id> menu actions before child views can consume them', () => {
    expect(workspaceShellJs).toMatch(/prefix:\s*'open-workspace:'/);
    expect(workspaceShellJs).toMatch(/openWorkspaceWindow\(workspaceId\)/);
  });

  it('Rust open_new_window accepts workspace_id and appends ?workspace=<id> to the new window URL', () => {
    expect(mainRs).toMatch(/workspace_id:\s*Option<String>/);
    expect(mainRs).toContain('"&workspace="');
    expect(mainRs).toContain('"?workspace="');
  });

  it('app.js reads ?workspace=<id> on boot and pins this window\'s activeWorkspaceId without persisting', () => {
    expect(appJs).toContain("urlParams.get('workspace')");
    // Per-window override: in-memory `activeWorkspaceId` is set, but
    // the assignment must NOT call Settings.set('activeWorkspace', …)
    // — otherwise closing a locked window would bleed the lock into
    // the next-opened generic window.
    const lockBlock = appJs.match(/initialWorkspaceLockId\s*=[\s\S]{0,400}?activeWorkspaceId\s*=\s*initialWorkspaceLockId/);
    expect(lockBlock).toBeTruthy();
    expect(lockBlock[0]).not.toMatch(/Settings\.set\(\s*'activeWorkspace'/);
    // The URL-lock branch must set BOTH activeWorkspaceId AND
    // viewWorkspaceId. The sidebar filter `_buildDesiredEntries` reads
    // viewWorkspaceId; without setting it the URL-locked window boots
    // with active=<id> but view=null, so the filter returns no boards
    // (header shows the workspace name, content is empty).
    expect(appJs).toMatch(/initialWorkspaceLockId[\s\S]{0,500}?viewWorkspaceId\s*=\s*initialWorkspaceLockId/);
  });

  // ── File menu reachability — without this entry, the user has no
  // top-level way to spawn a workspace window unless the Workspaces
  // panel is already open. The native menu bar is the canonical
  // entry point per CLAUDE memory ("Views in menu bar only"); this
  // test pins the four-link chain: Rust submenu item → action map →
  // frontend ActionRegistry handler → existing openWorkspaceWindow.
  it('File menu has a dynamic "Open Workspace ▶" submenu populated from the live workspace catalog', () => {
    // Submenu, not a leaf — each child item maps to one workspace and
    // dispatches `open-workspace:<id>` to the frontend ActionRegistry.
    expect(appMenuRs).toContain('SubmenuBuilder::new(app, "Open Workspace")');
    expect(appMenuRs).toContain('OPEN_WORKSPACE_ITEM_PREFIX');
    expect(appMenuRs).toMatch(/"file-open-workspace::"/);
    // Empty catalog renders a disabled placeholder, not an error.
    expect(appMenuRs).toContain('(no workspaces — create one in Workspace Settings)');
    // Dynamic items resolve to `open-workspace:<id>` actions.
    expect(appMenuRs).toMatch(/strip_prefix\(OPEN_WORKSPACE_ITEM_PREFIX\)[\s\S]{0,200}open-workspace:/);
  });

  it('frontend refreshes the native submenu via set_workspaces_submenu after every workspace catalog change', () => {
    expect(appJs).toMatch(/function setWorkspacesState[\s\S]{0,2600}syncWorkspaceMenuEntries\(\)/);
    expect(appJs).toMatch(/function setRemoteBoardsState[\s\S]{0,1200}syncWorkspaceMenuEntries\(\)/);
    expect(appJs).toMatch(/function syncWorkspaceMenuEntries[\s\S]{0,500}if \(embeddedMode\) return/);
    expect(appJs).toMatch(/function syncWorkspaceMenuEntries[\s\S]{0,1200}lastWorkspaceMenuSignature/);
    expect(appJs).toMatch(/function syncWorkspaceMenuEntries[\s\S]{0,1400}tauriInvoke\(['"]set_workspaces_submenu['"]/);
    expect(appJs).toContain("'__remote_boards__'");
    expect(appJs).toContain("'Remote Boards'");
  });

  it('Tauri command set_workspaces_submenu rebuilds the menu with the supplied workspace list', () => {
    const commandsRs = readFileSync(resolve(__dirname, '..', 'src-tauri', 'src', 'commands.rs'), 'utf8');
    expect(commandsRs).toMatch(/pub fn set_workspaces_submenu\([\s\S]{0,400}Vec<crate::app_menu::WorkspaceMenuEntry>/);
    expect(commandsRs).toMatch(/create_app_menu\(&app, &workspaces\)[\s\S]{0,200}set_menu/);
  });

  it('actionRegistrations.js wires both `open-workspace:<id>` (direct dispatch from native submenu) and `open-workspace` (chooser fallback) to WorkspaceShell.openWorkspaceWindow', () => {
    // `open-workspace:<id>` — fires when the user clicks a workspace
    // entry in the native File > Open Workspace submenu. The handler
    // strips the prefix and goes straight to openWorkspaceWindow with
    // no chooser dialog.
    expect(actionRegistrationsJs).toMatch(/ActionRegistry\.register\(\s*'board'\s*,\s*'open-workspace:\*'/);
    // The fallback chooser must read the LIVE workspace list via
    // d.getWorkspaces() — otherwise the array captured at registration
    // time is stale (always empty pre-hydration), which is why the
    // earlier `d.workspaces` reference popped "No workspaces available".
    expect(actionRegistrationsJs).toMatch(/ActionRegistry\.register\(\s*'board'\s*,\s*'open-workspace'/);
    expect(actionRegistrationsJs).toMatch(/d\.getWorkspaces\(\)/);
    expect(actionRegistrationsJs).toMatch(/LexeraWorkspaceShell[\s\S]{0,400}openWorkspaceWindow\(/);
  });

  it('app.js wires `getWorkspaces` (live-getter) into the action dep bag — captures-by-getter, not by-value', () => {
    // Reading `workspaces` directly into the registerAll dep bag
    // captures the empty initial array; subsequent `setWorkspacesState`
    // assignments rebind the local variable but the dep bag still
    // points at the empty original. Use a getter so handlers always
    // see the current array.
    expect(appJs).toMatch(/getWorkspaces:\s*function\s*\(\)\s*\{\s*return workspaces;\s*\}/);
  });

  // ── Each window owns exactly one workspace ─────────────────────────
  // After the catalog hydrates, the window's activeWorkspaceId must be
  // a REAL workspace id (not the legacy `__all__` sentinel, not an
  // orphan id pointing at a deleted workspace). Whoever boots the
  // app — URL lock, persisted setting, or fresh install — should end
  // up viewing exactly one workspace, never "all".
  it('app.js promotes the window to a real workspace whenever the catalog hydrates without a valid active id', () => {
    expect(appJs).toMatch(/function pickDefaultWorkspaceId/);
    // The default-picker prefers the explicitly default-marked
    // workspace, else falls back to the first available.
    expect(appJs).toMatch(/pickDefaultWorkspaceId[\s\S]{0,500}isDefault/);
    // setWorkspacesState invokes the picker when the active id is
    // missing or references a workspace that no longer exists.
    expect(appJs).toMatch(/function setWorkspacesState[\s\S]{0,1500}pickDefaultWorkspaceId/);
    // Validity check: active id must exist in the workspaces catalog.
    expect(appJs).toMatch(/function setWorkspacesState[\s\S]{0,1500}workspaces\.some\(/);
  });

  it('CloseRequested clears LAST_FOCUSED_WINDOW + drops the closing window\'s subscriptions / health entries / focus slot', () => {
    // If a workspace window closes while LAST_FOCUSED_WINDOW points
    // at it, the next menu click does `emit_to(<dead-label>, …)` →
    // silently no-ops → menu appears broken. The Subscription /
    // Health / Focus registries would otherwise accumulate stale
    // entries forever over multi-window churn.
    const webviewMgrRs = readFileSync(resolve(__dirname, '..', 'src-tauri', 'src', 'webview_mgr.rs'), 'utf8');
    expect(webviewMgrRs).toMatch(/impl SubscriptionRegistry[\s\S]{0,600}fn drop_labels/);
    expect(webviewMgrRs).toMatch(/impl HealthTracker[\s\S]{0,300}fn drop_labels/);
    expect(webviewMgrRs).toMatch(/impl FocusTracker[\s\S]{0,300}fn drop_window/);
    expect(mainRs).toMatch(/CloseRequested[\s\S]{0,1500}LAST_FOCUSED_WINDOW\.lock\(\)[\s\S]{0,400}\*last = None/);
    expect(mainRs).toMatch(/CloseRequested[\s\S]{0,6000}SubscriptionRegistry[\s\S]{0,200}drop_labels\(&dead_labels\)/);
    expect(mainRs).toMatch(/CloseRequested[\s\S]{0,6000}HealthTracker[\s\S]{0,200}drop_labels\(&dead_labels\)/);
    expect(mainRs).toMatch(/CloseRequested[\s\S]{0,6000}FocusTracker[\s\S]{0,200}drop_window\(&closing_label\)/);
  });

  it('the menu handler tracks the last-focused window so macOS menu-clicks (which transiently take focus) still resolve a target', () => {
    // On macOS, clicking a menu bar item briefly transfers focus
    // from the window to the menu. During the menu_event handler,
    // `WebviewWindow::is_focused()` returns false for EVERY window.
    // Without a tracker, the handler can't determine the originating
    // window and either broadcasts (wrong-window bug) or drops the
    // action (this regression: "Open Workspace > X stopped opening
    // a new window"). Solution: a `LAST_FOCUSED_WINDOW` Mutex
    // updated by the `WindowEvent::Focused(true)` arm in
    // `on_window_event`.
    expect(mainRs).toMatch(/static LAST_FOCUSED_WINDOW:\s*std::sync::Mutex<Option<String>>/);
    expect(mainRs).toMatch(/WindowEvent::Focused\(true\)[\s\S]{0,800}LAST_FOCUSED_WINDOW\.lock\(\)/);
    // The menu handler falls back to LAST_FOCUSED_WINDOW when
    // is_focused() finds nothing.
    expect(mainRs).toMatch(/is_focused\(\)\.unwrap_or\(false\)\)[\s\S]{0,400}LAST_FOCUSED_WINDOW\.lock\(\)/);
  });

  it('native menu actions target the FOCUSED window only — must use app.emit_to(label, …) since both app.emit and WebviewWindow::emit broadcast in Tauri 2', () => {
    // Each window owns one workspace; menu actions like
    // View > Panels > Dashboard mean "show this panel in THIS
    // window". The user reported "views show in the wrong window"
    // twice: first when we used `app.emit` (obvious broadcast), then
    // again after switching to `WebviewWindow::emit` — which ALSO
    // broadcasts (Tauri 2 quirk: only `emit_to(label, …)` actually
    // targets a single webview). The third fix uses the focused
    // window's label with `app.emit_to(label, …)`.
    expect(mainRs).toMatch(/\.webview_windows\(\)[\s\S]{0,200}is_focused\(\)/);
    expect(mainRs).toMatch(/app\.emit_to\(\s*label\.as_str\(\)\s*,\s*"menu-action"/);
    // The plain `WebviewWindow::emit("menu-action", …)` pattern is
    // explicitly forbidden — it broadcasts.
    expect(mainRs).not.toMatch(/window\.emit\("menu-action"/);
    // No-focus fallback must NOT broadcast. Broadcasting
    // `open-workspace:<id>` lets every webview spawn a workspace
    // window.
    expect(mainRs).not.toMatch(/app\.emit\("menu-action"/);
    expect(mainRs).toMatch(/menu-action dropped because no focused window was found/);
  });
  it('menu-action payloads include the target window label so JavaScript can filter out cross-window leakage', () => {
    // Tauri 2's target: { kind: 'Any' } listener is a greedy wildcard
    // that receives events from all windows. To prevent menu actions
    // from executing in multiple windows simultaneously, the Rust code
    // now emits a structured payload: { target: string, action: string }.
    // The JavaScript side filters events where payload.target !== this
    // window's label (from ?windowLabel= URL param).
    expect(mainRs).toMatch(/serde_json::json!\(\{\s*"target":/);
    expect(mainRs).toMatch(/"action":\s*action/);
  });


  it('open-workspace:<id> is handled directly in the Rust menu handler — never emitted as a frontend menu-action event', () => {
    // Tauri 2's listener filter `target: { kind: 'Any' }` (used by
    // tauriListen) is a greedy wildcard: emit_to(label, …) reaches
    // EVERY listening webview regardless of the emitter's label. So
    // emitting `menu-action: open-workspace:<id>` lets every webview
    // running app.js — shell + each child board/panel webview + each
    // other open window — consume it. Each webview JS context has its
    // own `lastOpenWorkspaceWindowRequest` debounce, so each spawns a
    // fresh window. User reported "now it opens 2 windows when i open
    // one new workspace from the menu".
    //
    // Fix: handle open-workspace:<id> in on_menu_event by calling
    // open_new_window directly with workspace_id, then `return`
    // before the emit_to fall-through. Same pattern as `new-window`.
    expect(mainRs).toMatch(/strip_prefix\("open-workspace:"\)[\s\S]{0,800}open_new_window\(/);
    // The call must pass the workspace_id through to open_new_window
    // so the new window's URL gets `?workspace=<id>` and stays locked.
    expect(mainRs).toMatch(/strip_prefix\("open-workspace:"\)[\s\S]{0,1500}Some\(workspace_id\.to_string\(\)\)/);
  });

  it('multiview_broadcast scopes events to the caller window — sub-app navigates never leak into a sibling window', () => {
    // The user reported "views show in the wrong window" three
    // times. The root cause was multiview_broadcast falling back to
    // `app.emit(...)` (broadcast) when no subscribers were registered,
    // AND not filtering subscribers by the caller's window. A
    // navigate emitted from window B's hierarchy panel would fire in
    // BOTH windows' navigationBridge listeners — and window A would
    // open the board too.
    //
    // Fix: multiview_broadcast resolves the caller's window via the
    // Tauri Webview, enumerates webviews attached to that window, and
    // emits only to those (with the registered-subscribers list as a
    // further filter when present).
    const webviewMgrRs = readFileSync(resolve(__dirname, '..', 'src-tauri', 'src', 'webview_mgr.rs'), 'utf8');
    expect(webviewMgrRs).toMatch(/pub fn multiview_broadcast\([\s\S]{0,400}caller:\s*tauri::Webview/);
    expect(webviewMgrRs).toMatch(/caller\.window\(\)[\s\S]{0,200}\.webviews\(\)/);
    expect(webviewMgrRs).toMatch(/window_webview_labels\.contains\(&label\)/);
    // Empty-subscribers branch must also be window-scoped — no plain
    // `app.emit(&event, payload)` left as a fallback in this fn.
    const fnBody = webviewMgrRs.match(/pub fn multiview_broadcast[\s\S]+?\n\}/);
    expect(fnBody).toBeTruthy();
    expect(fnBody[0]).not.toMatch(/app\.emit\(&event/);
  });

  it('detached-panel "Dock" button targets the originating workspace window, not all open windows', () => {
    // detachPanelView passes `originWindow: state.windowLabel` to
    // open_new_window; the new panel-only window reads it from the
    // URL and dockToMainWindow uses `multiview_emit_to(originWindow, …)`
    // instead of `tauriEmitAll(…)`. Without this, popping a panel
    // from window A and clicking Dock would reveal the panel in
    // every open workspace window simultaneously (same broadcast
    // pattern as the navigation leak).
    expect(mainRs).toMatch(/origin_window:\s*Option<String>/);
    expect(mainRs).toContain('"&originWindow="');
    expect(workspaceShellJs).toMatch(/originWindow:\s*state\.windowLabel/);
    expect(workspaceShellJs).toMatch(/originWindow:\s*String\(urlParams\.get\(['"]originWindow['"]\)/);
    expect(workspaceShellJs).toMatch(/function dockToMainWindow[\s\S]{0,800}multiview_emit_to/);
  });

  it('the legacy ALL_WORKSPACES_ID sentinel is gone — no codepath references __all__ or ALL_WORKSPACES_ID anymore', () => {
    // The pseudo-workspace-id was the source of the cross-window leak
    // in the all-view branches. After 82417477 + this cleanup, every
    // window owns one real workspace, so the sentinel and the branches
    // that special-cased it must be deleted entirely.
    const sourceFiles = [
      readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8'),
      readFileSync(resolve(__dirname, '..', 'src', 'board', 'boardList.js'), 'utf8'),
      readFileSync(resolve(__dirname, '..', 'src', 'board', 'orderHelpers.js'), 'utf8'),
      readFileSync(resolve(__dirname, '..', 'src', 'views', 'hierarchy', 'hierarchy.js'), 'utf8')
    ];
    for (const src of sourceFiles) {
      expect(src).not.toMatch(/ALL_WORKSPACES_ID/);
      expect(src).not.toContain("'__all__'");
    }
  });

  it('per-window state never reacts to sibling-window storage events — no addEventListener("storage", ...) handler routes any per-window key', () => {
    // Listening for cross-window `storage` events on per-window keys
    // is what makes one window steal another's view. The user
    // reported it for `lexera-active-workspace` first (fixed in
    // 82417477), then again for dashboard search and dock-panel
    // (typing in one window's dashboard yanked another's view, and
    // popping a panel-only window made every window reveal the panel).
    // Pin: no storage listener should branch on any of these keys.
    expect(appJs).not.toMatch(/event\.key\s*===\s*['"]lexera-active-workspace['"]/);
    expect(appJs).not.toMatch(/event\.key\s*===\s*['"]lexera-dashboard-query['"]/);
    expect(appJs).not.toMatch(/event\.key\s*===\s*['"]lexera-dashboard-scope['"]/);
    expect(appJs).not.toMatch(/event\.key\s*===\s*['"]lexera-dashboard-active-pinned['"]/);
    expect(appJs).not.toMatch(/event\.key\s*===\s*['"]lexera-dashboard-pinned-queries['"]/);
    expect(appJs).not.toMatch(/event\.key\s*===\s*['"]lexera-dock-panel['"]/);
  });

  it('the active board is NEVER persisted to the shared Settings store — switching boards in window A must not influence window B', () => {
    // User-reported: "now when i switch kanban boards in one view it
    // switches the other view as well!" + "windows must be independant!".
    // Settings.set('lastBoard', boardId) writes localStorage, which:
    //   (a) fires a `storage` event in every other window (no listener
    //       reacts today, but it's a future-leak risk), AND
    //   (b) is read on cold start by pollingService.js — so opening
    //       window B after window A switched to Z auto-loads Z too,
    //       coupling the windows. **Each window owns its active board**
    //       — initial board comes from URL `?board=` only, fallback to
    //       first available; no shared persistence.
    expect(appJs).not.toMatch(/Settings\.set\(\s*['"]lastBoard['"]/);
    expect(appJs).not.toMatch(/setItem\(\s*['"]lexera-last-board['"]/);
    const orderHelpersJs = readFileSync(resolve(__dirname, '..', 'src', 'board', 'orderHelpers.js'), 'utf8');
    expect(orderHelpersJs).not.toMatch(/_Settings\.set\(\s*['"]lastBoard['"]/);
    expect(orderHelpersJs).not.toMatch(/setItem\(\s*['"]lexera-last-board['"]/);
    const boardListJs = readFileSync(resolve(__dirname, '..', 'src', 'board', 'boardList.js'), 'utf8');
    expect(boardListJs).not.toMatch(/_Settings\.set\(\s*['"]lastBoard['"]/);
    const pollingJs = readFileSync(resolve(__dirname, '..', 'src', 'sync', 'pollingService.js'), 'utf8');
    expect(pollingJs).not.toMatch(/_Settings\.set\(\s*['"]lastBoard['"]/);
    // Cold-start read is also forbidden — would re-couple windows on
    // every fresh open.
    expect(pollingJs).not.toMatch(/_Settings\.get\(\s*['"]lastBoard['"]/);
    expect(pollingJs).not.toMatch(/getItem\(\s*['"]lexera-last-board['"]/);
    // The settings DEFS table must not declare `lastBoard` either —
    // every entry there is supposed to have at least one caller, and
    // re-adding the def would tempt callers to use it.
    const settingsStoreJs = readFileSync(resolve(__dirname, '..', 'src', 'core', 'settingsStore.js'), 'utf8');
    expect(settingsStoreJs).not.toMatch(/lastBoard\s*:\s*\{/);
    expect(settingsStoreJs).not.toMatch(/['"]lexera-last-board['"]/);
    // Mirror guard for the state-key registry so dev tools don't keep
    // surfacing the dead key as if it were live.
    const stateKeyRegistryJs = readFileSync(resolve(__dirname, '..', 'src', 'shared', 'stateKeyRegistry.js'), 'utf8');
    expect(stateKeyRegistryJs).not.toMatch(/['"]lexera-last-board['"]/);
  });

  it('the active workspace is NEVER persisted to the shared Settings store (would leak across windows)', () => {
    // Persisting via `Settings.set('activeWorkspace', …)` fires a
    // `storage` event into sibling windows; the listener in app.js
    // then yanks their view to whatever the just-clicked window
    // picked. Each window must own its workspace in-memory only.
    const boardListJs = readFileSync(resolve(__dirname, '..', 'src', 'board', 'boardList.js'), 'utf8');
    expect(boardListJs).not.toMatch(/_Settings\.set\(\s*['"]activeWorkspace['"]/);
    expect(boardListJs).not.toMatch(/writeLocalStorageItem\(\s*['"]lexera-active-workspace['"]/);
    // The boot path must not seed activeWorkspaceId from the shared
    // Settings store either — only the URL `?workspace=` lock and
    // the catalog default-picker are valid sources.
    expect(appJs).not.toMatch(/Settings\.get\(\s*['"]activeWorkspace['"]/);
    // The cross-window storage listener for the legacy key must be
    // gone so an old residual write doesn't switch this window.
    expect(appJs).not.toMatch(/event\.key === ['"]lexera-active-workspace['"]/);
    // The settings DEFS table must NOT declare `activeWorkspace` —
    // re-adding the def tempts callers to use it. Same lockdown
    // pattern as `lastBoard`.
    const settingsStoreJs = readFileSync(resolve(__dirname, '..', 'src', 'core', 'settingsStore.js'), 'utf8');
    expect(settingsStoreJs).not.toMatch(/activeWorkspace\s*:\s*\{/);
    expect(settingsStoreJs).not.toMatch(/['"]lexera-active-workspace['"]/);
    // Mirror guard for the state-key registry.
    const stateKeyRegistryJs = readFileSync(resolve(__dirname, '..', 'src', 'shared', 'stateKeyRegistry.js'), 'utf8');
    expect(stateKeyRegistryJs).not.toMatch(/^\s*['"]lexera-active-workspace['"]:\s*\{/m);
  });
});
