// Pin: the legacy in-shell panel-only mode is permanently disabled.
//
// Background: workspaceShell.js used to mount one panel directly into
// the shell DOM when the window URL carried `?panelKind=<kind>`. That
// path was a duplicate of the per-kind sub-app entrypoints under
// `src/views/<kind>/index.html` and shipped its own state, lifecycle,
// and CSS. The user requirement is that EVERY panel boots as a child
// webview — there is no in-shell single-DOM render path.
//
// Rather than ripping out all 12 callsites of `isPanelOnlyWindow()`
// and the symbols `state.panelOnlyKind`, `state.panelOnlyId`,
// `state.originWindow`, `applyPanelOnlyWindowState`, etc. (a partial
// removal previously broke the shell at parse time and collapsed the
// kanban into a single DOM), the function bodies are stubbed:
//
//   - `isPanelOnlyWindow()` returns the constant `false`.
//   - `renderPanelOnly()` is a no-op.
//
// This test pins both stubs so a future "let me restore panel-only
// mode" refactor must consciously opt in by removing the disable.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceShellJs = readFileSync(
  resolve(__dirname, '..', 'src', 'workspace', 'workspaceShell.js'),
  'utf8'
);

describe('workspaceShell.js — legacy panel-only mode is disabled', () => {
  it('isPanelOnlyWindow() returns the constant false', () => {
    // The function body must be exactly `return false;` — no read of
    // state.panelOnlyKind, no truthy expression. If a future refactor
    // re-introduces a state-driven body, the gate at every callsite
    // (e.g. canHostBoardTabs, ensureInitialPanelTab, render(), the
    // dispatcher in handleBoardAction) becomes live again and the
    // shell can revert to in-DOM panel rendering.
    const match = workspaceShellJs.match(
      /function\s+isPanelOnlyWindow\s*\([^)]*\)\s*\{\s*return\s+false\s*;\s*\}/
    );
    expect(match).not.toBeNull();
  });

  it('renderPanelOnly() is a no-op', () => {
    // Body must be just `return;` — no DOM mutation, no header build,
    // no `getPanelElement(...)` reparent. The legacy implementation
    // appended a `.workspace-shell-panel-only-window` element to its
    // host; this regex catches a body that contains any non-trivial
    // statement.
    const fnMatch = workspaceShellJs.match(
      /function\s+renderPanelOnly\s*\([^)]*\)\s*\{([\s\S]*?)\n\s\s\}/
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch[1];
    expect(body).not.toMatch(/getPanelElement/);
    expect(body).not.toMatch(/createElement/);
    expect(body).not.toMatch(/appendChild/);
    expect(body).not.toMatch(/innerHTML/);
    expect(body).not.toMatch(/workspace-shell-panel-only-window/);
  });
});
