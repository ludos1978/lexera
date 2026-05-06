// Pin the dependency-loading contract for the backend management view.
//
// `lexera-backend/src/connection-settings.html` mounts the workspace
// shell to host the management UI's panels. `workspaceShell.js` throws
// at parse time if any of its global deps (LexeraLayoutTree,
// LexeraTreeRegistry, LexeraBoardHost, ...) are missing. When the
// workspace was split into multiple modules (Apr 26-28), the backend's
// HTML and `sync-frontend-view-assets.mjs` were not updated — the
// management view loaded `workspaceShell.js` without its 11 deps and
// rendered as an empty window because the throw aborted boot before
// `connection-settings.js` could call `mountManagementShell()`.
//
// This contract guards the whole chain so the regression can't
// reappear silently:
//
//   1. Every workspace shell dep file is copied by the sync script.
//   2. Each copied file is referenced by a <script src> in
//      connection-settings.html.
//   3. The dep <script> tags appear *before* workspaceShell.js so the
//      globals exist by the time workspaceShell.js parses.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const htmlPath = resolve(repoRoot, 'lexera-backend/src/connection-settings.html');
const syncScriptPath = resolve(repoRoot, 'lexera-backend/scripts/sync-frontend-view-assets.mjs');

// Every workspace dep workspaceShell.js requires at parse time.
// Mirrors the throws at the top of workspaceShell.js + the inline
// titleHelpers usage. Order does not matter inside this list — load
// order is asserted separately below.
const REQUIRED_SHELL_DEPS = [
  'titleHelpers.js',
  'layoutTree.js',
  'lifecycleReconciler.js',
  'boardHost.js',
  'panelHost.js',
  'multiviewWebview.js',
  'messageBridge.js',
  'panelDefinitions.js',
  'treeRegistry.js',
  'layoutPersistence.js',
  'tabDragController.js',
  'sharedPanels.js',
];

function extractScriptSrcs(html) {
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

describe('lexera-backend/src/connection-settings.html — workspaceShell.js deps', () => {
  const html = readFileSync(htmlPath, 'utf-8');
  const srcs = extractScriptSrcs(html);
  const shellIdx = srcs.indexOf('workspaceShell.js');

  it('loads workspaceShell.js', () => {
    expect(shellIdx, 'workspaceShell.js must appear in the script list').toBeGreaterThan(-1);
  });

  for (const dep of REQUIRED_SHELL_DEPS) {
    it('loads ' + dep + ' before workspaceShell.js', () => {
      const idx = srcs.indexOf(dep);
      expect(idx, dep + ' must appear in the script list').toBeGreaterThan(-1);
      expect(idx, dep + ' must load BEFORE workspaceShell.js').toBeLessThan(shellIdx);
    });
  }
});

describe('lexera-backend/scripts/sync-frontend-view-assets.mjs — covers workspaceShell deps', () => {
  const script = readFileSync(syncScriptPath, 'utf-8');

  for (const dep of REQUIRED_SHELL_DEPS) {
    it('declares an asset entry that produces ' + dep, () => {
      // Match the second-element string literal of any asset tuple
      // ending with `, '<dep>']` — robust to source-path renames so
      // long as the destination filename is right.
      const re = new RegExp(",\\s*'" + dep.replace(/\./g, '\\.') + "'\\s*\\]");
      expect(script).toMatch(re);
    });
  }

  it('declares workspaceShell.js itself', () => {
    expect(script).toMatch(/,\s*'workspaceShell\.js'\s*\]/);
  });
});
