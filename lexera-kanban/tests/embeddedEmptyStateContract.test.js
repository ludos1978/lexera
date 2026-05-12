// Source-level contract: the empty-state branch in app.js#renderMainView
// must distinguish embedded child webviews from the shell-mode main
// view. Embedded children have no sidebar — telling the user to "select
// a board from the sidebar" is nonsense there. The fix routes empty
// state through three branches:
//   - !connected → "Waiting for server..."
//   - embeddedMode → "Loading board…"
//   - shell mode  → "Select a board from the sidebar"
//
// Testing renderMainView() directly would require booting the giant
// app.js IIFE, so this contract pins the three message strings + the
// three discriminators in source. If anyone strips one branch the
// failure points at the regression site.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJsSource = readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8');

describe('embedded empty-state contract', () => {
  it('keeps the shell-mode "Select a board from the sidebar" copy', () => {
    expect(appJsSource).toContain("'Select a board from the sidebar'");
  });

  it('shows "Loading board…" inside embedded child webviews', () => {
    expect(appJsSource).toContain("'Loading board…'");
  });

  it('preserves the disconnected fallback "Waiting for server..."', () => {
    expect(appJsSource).toContain("'Waiting for server...'");
  });

  it('keys the embedded branch on embeddedMode (the URL ?embedded=1 flag)', () => {
    // The branch must consult embeddedMode rather than re-keying off
    // workspaceShellEnabled — embeddedMode is set per-webview from the
    // URL, while workspaceShellEnabled is computed at the shell level.
    // Empty-state logic lives in the CHILD's app.js so embeddedMode is
    // the right discriminator.
    const branchMatch = /embeddedMode\)\s*emptyMsg\s*=\s*'Loading board…'/.test(appJsSource);
    expect(branchMatch).toBe(true);
  });

  it('routes through emptyMsg before innerHTML so the three branches share one render path', () => {
    // Single-write contract: the if/else chain must build a `emptyMsg`
    // string and the innerHTML assignment must reference it. Inlining
    // a ternary back into the innerHTML invites partial fixes that
    // miss the embedded branch.
    expect(appJsSource).toMatch(/var emptyMsg;[\s\S]{0,800}emptyMsg\s*=\s*'Loading board…'/);
    expect(appJsSource).toMatch(/<div>'\s*\+\s*emptyMsg\s*\+\s*'<\/div>/);
  });
});
