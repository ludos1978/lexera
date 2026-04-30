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
const appJs = readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8');

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
  });
});
