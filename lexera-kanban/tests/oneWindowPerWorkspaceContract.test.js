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
//   1. workspaces sub-app emits `open-workspace-window` navigate.
//   2. navigationBridge routes that to `shell.openWorkspaceWindow`.
//   3. workspaceShell.openWorkspaceWindow forwards `workspaceId` to
//      `open_new_window` so the URL of the new window carries
//      `?workspace=<id>`.
//   4. Rust `open_new_window` accepts a `workspace_id` parameter and
//      appends it to the URL.
//   5. app.js reads `?workspace=<id>` on boot and pins the window's
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
const navigationBridgeJs = readFileSync(resolve(__dirname, '..', 'src', 'shell', 'navigationBridge.js'), 'utf8');
const workspaceShellJs = readFileSync(resolve(__dirname, '..', 'src', 'workspace', 'workspaceShell.js'), 'utf8');
const mainRs = readFileSync(resolve(__dirname, '..', 'src-tauri', 'src', 'main.rs'), 'utf8');
const appMenuRs = readFileSync(resolve(__dirname, '..', 'src-tauri', 'src', 'app_menu.rs'), 'utf8');
const appJs = readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8');
const actionRegistrationsJs = readFileSync(resolve(__dirname, '..', 'src', 'core', 'actionRegistrations.js'), 'utf8');

describe('one workspace per window — wiring contract', () => {
  it('workspaces sub-app emits the new open-workspace-window navigate from per-row "Open" button', () => {
    expect(workspacesJs).toContain("'open-workspace-window'");
    expect(workspacesJs).toContain('ws-open-btn');
    // The Open button stops propagation so the click doesn't bubble
    // up to the row and accidentally fire a focus-workspace navigate.
    expect(workspacesJs).toMatch(/openBtn[\s\S]{0,200}?stopPropagation\(\)/);
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
    expect(appJs).toMatch(/function setWorkspacesState[\s\S]{0,2400}tauriInvoke\(['"]set_workspaces_submenu['"]/);
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

  it('native menu actions target the FOCUSED window only — no app-wide broadcast that would fire the action in every window', () => {
    // Each window owns one workspace; menu actions like
    // View > Panels > Dashboard mean "show this panel in THIS
    // window". `app.emit("menu-action", …)` broadcasts to every
    // window and was causing the panel to reveal everywhere at once.
    // Focused-window targeting via `webview_windows()` + `is_focused`
    // routes the action to just the window the user clicked from.
    expect(mainRs).toMatch(/\.webview_windows\(\)[\s\S]{0,200}is_focused\(\)/);
    expect(mainRs).toMatch(/window\.emit\("menu-action"/);
    // The fallback `app.emit` only runs when no window is focused —
    // pin the structure so a future refactor doesn't accidentally
    // re-broadcast unconditionally.
    expect(mainRs).toMatch(/if let Some\(window\) = focused[\s\S]{0,500}else[\s\S]{0,300}app\.emit\("menu-action"/);
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
  });
});
