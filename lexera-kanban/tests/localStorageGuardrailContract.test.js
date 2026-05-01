// Raw `localStorage.*` access guardrail.
//
// The settings architecture aims to centralise local-only frontend
// preferences behind a single settings service (currently `core/
// settingsStore.js` + `views/_shared/settingsRuntime.js`). Spreading
// raw `localStorage.getItem` / `setItem` calls across feature files
// re-creates the duplication this work is trying to eliminate — a
// rename of the storage key has to update every call site, and a
// future migration to backend-config or sync-aware storage breaks
// silently.
//
// Approach: pin the EXACT current set of files that touch
// `localStorage.*` as the baseline. New files cannot introduce raw
// access (test fails — push the call through `LexeraSettings` /
// `settingsStore` instead). Existing files are allowed to keep their
// calls; if a refactor moves them out, update this baseline so the
// win is recorded.
//
// This is a guardrail, not a refactor: the 22 baseline files keep
// their existing calls, but no 23rd file may join them quietly.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '..', 'src');

// Baseline as of 2026-04-30. Sorted by path. Keep this list sorted —
// alphabetisation is the only reliable diff anchor when a single new
// entry sneaks in. To remove an entry: confirm the file no longer has
// any `localStorage.*` usage and delete its line.
const ALLOWED_LOCAL_STORAGE_FILES = [
  'app.js',
  'appearance/appearance.js',
  'board/cardCollapse.js',
  'board/orderHelpers.js',
  'core/actionRegistrations.js',
  'core/settingsStore.js',
  'editor/cardEditor.js',
  'logging/loggingSystem.js',
  'menu/contextMenuBuilders.js',
  'plugins/diagrams/mermaid.js',
  'plugins/pluginConfig.js',
  'settings/controlsSettings.js',
  'shared/stateManager.js',
  'sidebar/sidebarResize.js',
  'sidebar/sidebarSync.js',
  'tagcolors/tagColors.js',
  'test/autoRunBootstrap.js',
  'test/frontendTests.js',
  'views/_shared/settingsRuntime.js',
  'visualThemes.js',
  'workspace/multiviewWebview.js',
  'workspace/workspaceShell.js'
];

// Build-synced from lexera-shared/scripts/sync-runtime-assets.mjs.
// Their source of truth lives in lexera-shared/, the on-disk copies in
// src/ are gitignored — auditing them here would force a baseline
// entry whose real owner is in another package.
const BUILD_SYNCED_FILES = new Set([
  'management.js',
  'themes.js',
  'backendDiscovery.js',
  'dialogs.js'
]);

function walkJs(dir, out = [], srcRootArg = null) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'node_modules') continue;
    const full = join(dir, name);
    let s;
    try { s = statSync(full); } catch (_) { continue; }
    if (s.isDirectory()) walkJs(full, out, srcRootArg);
    else if (s.isFile() && full.endsWith('.js')) {
      const rel = srcRootArg ? relative(srcRootArg, full) : '';
      if (BUILD_SYNCED_FILES.has(rel)) continue;
      out.push(full);
    }
  }
  return out;
}

// Detects real localStorage usage. Strips line comments first so a
// `// localStorage` doc reference doesn't trigger the check; block
// comments are kept (rare and would still be a code smell if present).
function fileTouchesLocalStorage(absPath) {
  const src = readFileSync(absPath, 'utf8');
  const stripped = src.replace(/\/\/[^\n]*/g, '');
  return /\blocalStorage\.[a-zA-Z]/.test(stripped);
}

describe('localStorage guardrail contract', () => {
  it('only the baseline files touch localStorage directly — new files must route through the settings layer', () => {
    const allFiles = walkJs(srcRoot, [], srcRoot);
    const offenders = [];
    for (const file of allFiles) {
      if (!fileTouchesLocalStorage(file)) continue;
      const rel = relative(srcRoot, file);
      if (!ALLOWED_LOCAL_STORAGE_FILES.includes(rel)) offenders.push(rel);
    }
    expect(
      offenders,
      'These files added raw localStorage.* access. Route the call through LexeraSettings / core/settingsStore.js so storage keys, normalisation, and future backend-config migration stay centralised. If the call genuinely belongs in this file, add it to ALLOWED_LOCAL_STORAGE_FILES with a comment explaining why.'
    ).toEqual([]);
  });

  it('no baseline entry is stale — every allowlisted file still touches localStorage', () => {
    // The allowlist must shrink, not stay padded with file names that
    // no longer use localStorage. Otherwise the next time someone
    // legitimately deletes a localStorage call they get no signal that
    // they should also remove the file from the allowlist, and the
    // list rots.
    const stale = [];
    for (const rel of ALLOWED_LOCAL_STORAGE_FILES) {
      const abs = join(srcRoot, rel);
      try {
        if (!fileTouchesLocalStorage(abs)) stale.push(rel);
      } catch (_) {
        stale.push(rel + ' (file missing)');
      }
    }
    expect(
      stale,
      'These allowlist entries no longer use localStorage. Remove them from ALLOWED_LOCAL_STORAGE_FILES.'
    ).toEqual([]);
  });
});
