// Layout-tree direct-mutation lint contract.
//
// Phase 3 of the workspace-shell view-lifecycle plan introduced typed
// wrappers — `LexeraLayoutTree.removeTabById`, `insertTabIntoLeaf`,
// `moveTab`, `replaceTreeRoot` — so every layout-tree mutation goes
// through one place. The wrappers ensure invariants like:
//   - active-tab id stays valid after a removal
//   - `frameCache` / `multiviewSpawnedTabs` aren't orphaned
//   - the render-loop reconciler sees a well-formed tree
//
// If a future change reaches in and pokes `.tabs.splice(…)` or
// reassigns `state.dockTree` / `state.sideDocks[…]` directly, those
// invariants break silently — usually as a "ghost view" leak that
// only surfaces under a specific user flow weeks later.
//
// This test pins which files are allowed to do the direct mutation:
//   - `workspace/layoutTree.js`     — the wrapper implementation itself.
//   - `workspace/workspaceShell.js` — in-flight 3.2 migration; sites
//     will shrink to zero as the migration completes. Until then it
//     keeps freedom.
//   - `workspace/layoutPersistence.js` — hydrate-from-JSON path; this
//     is legitimate I/O at boot, not a runtime mutation.
//
// Adding a new file to this allowlist requires a comment explaining
// why the wrapper isn't appropriate there — same baseline-pinning
// approach as `consoleLoggingGuardrailContract`.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '..', 'src');

const ALLOWED_FILES = new Set([
  // Implementation of the wrappers themselves.
  'workspace/layoutTree.js',
  // Centralised tree fan-out registry; `setTreeRoot(treeId, root)` is
  // the blessed wrapper that the rest of the codebase calls. It MUST
  // assign to `state.dockTree` / `state.sideDocks[id]` to do its job.
  'workspace/treeRegistry.js',
  // In-flight 3.2 splice migration; allowlist will shrink to zero
  // (or this entry will move out) when the migration completes.
  'workspace/workspaceShell.js',
  // Hydrate-from-JSON I/O at boot. Reads persisted `dockTree` /
  // `sideDocks[…]` and assigns them onto state — legitimate boot
  // path, not a runtime mutation.
  'workspace/layoutPersistence.js'
]);

// Files synced from lexera-shared get checked in their own package's
// test run; skip the local copies here so we don't double-count.
const SYNCED_SHARED_FILES = new Set([
  'management.js',
  'management.css',
  'themes.js',
  'backendDiscovery.js',
  'dialogs.js',
  'dialogs.css'
]);

function* walkJsFiles(dir, basePrefix = '') {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = basePrefix ? `${basePrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      // Skip vendor + minified bundles.
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      yield* walkJsFiles(full, rel);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      if (SYNCED_SHARED_FILES.has(entry.name)) continue;
      yield { relPath: rel.replace(/\\/g, '/'), absPath: full };
    }
  }
}

function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

const FORBIDDEN_PATTERNS = [
  { name: '.tabs.splice(',           re: /\.tabs\.splice\(/ },
  { name: 'state.dockTree =',        re: /state\.dockTree\s*=[^=]/ },
  { name: 'state.sideDocks[…] =',    re: /state\.sideDocks\[[^\]]+\]\s*=[^=]/ }
];

describe('layout-tree direct-mutation lint contract', () => {
  it('every direct mutation lives in an allowlisted file', () => {
    const offenders = [];
    for (const { relPath, absPath } of walkJsFiles(srcRoot)) {
      if (ALLOWED_FILES.has(relPath)) continue;
      const raw = readFileSync(absPath, 'utf8');
      const stripped = stripCommentsAndStrings(raw);
      const lines = stripped.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const { name, re } of FORBIDDEN_PATTERNS) {
          if (re.test(lines[i])) {
            offenders.push({ file: relPath, line: i + 1, pattern: name, code: lines[i].trim() });
          }
        }
      }
    }
    if (offenders.length > 0) {
      const list = offenders
        .map((o) => `  ${o.file}:${o.line}  [${o.pattern}]  ${o.code}`)
        .join('\n');
      throw new Error(
        'Direct layout-tree mutation found outside the allowlist. ' +
        'Use LexeraLayoutTree.{removeTabById, insertTabIntoLeaf, moveTab, replaceTreeRoot} ' +
        'so the lifecycle reconciler sees a well-formed tree.\n' + list
      );
    }
    expect(offenders).toEqual([]);
  });

  it('every allowlisted file still exists on disk (so the allowlist does not rot silently)', () => {
    for (const relPath of ALLOWED_FILES) {
      const absPath = resolve(srcRoot, relPath);
      const stat = statSync(absPath);
      expect(stat.isFile(), `${relPath} should be a regular file`).toBe(true);
    }
  });
});
