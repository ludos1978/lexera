// Raw `console.{log,debug,info,warn,error}` guardrail.
//
// User rule (in memory + AGENT.md):
//   "Only log into the in-app logger view ... always use lexeraLog /
//   logFrontendIssue; never console.* or stderr, the user only watches
//   the in-app Log panel."
//
// Direct console.* calls don't reach the in-app log panel — they go to
// the WKWebView devtools that the user never opens, so the warning or
// error is effectively silent in production.
//
// Same baseline-pinning approach as localStorageGuardrailContract: pin
// the existing console.* surface, refuse new entries. Existing baseline
// files are allowed to keep their calls (separate refactor work routes
// each one through `lexeraLog`).
//
// Build-synced files from lexera-shared are skipped — their authoring
// owner is in another package.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '..', 'src');

// Baseline as of 2026-04-30. Sorted by path. Each entry should be a
// candidate for `lexeraLog` migration in a future round; this test
// pins the surface so it cannot grow silently.
const ALLOWED_CONSOLE_FILES = [
  'app.js',
  'core/boardDataStore.js',
  'core/moduleRuntime.js',
  'core/settingsStore.js',
  'keybindingRegistry.js',
  'menu/contextMenuBuilders.js',
  'plugins/pluginConfig.js',
  'plugins/pluginLoader.js',
  'plugins/pluginRegistry.js',
  'shared/stateManager.js',
  'shell/lifecycle.js',
  'shell/multiviewClient.js',
  'shell/bridges/navigationBridge.js',
  'shell/panelLaunchers.js',
  'sync/pollingService.js',
  'test/autoRunBootstrap.js',
  'test/frontendTests.js',
  'views/_shared/settingsRuntime.js',
  'visualThemes.js',
  'workspace/layoutPersistence.js',
  'workspace/multiviewWebview.js',
  'workspace/workspaceShell.js',
  'wysiwyg-editor.js'
];

// Build-synced from lexera-shared/scripts/sync-runtime-assets.mjs.
const BUILD_SYNCED_FILES = new Set([
  'management.js',
  'themes.js',
  'backendDiscovery.js',
  'dialogs.js'
]);

function walkJs(dir, out, srcRootArg) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'node_modules') continue;
    const full = join(dir, name);
    let s;
    try { s = statSync(full); } catch (_) { continue; }
    if (s.isDirectory()) walkJs(full, out, srcRootArg);
    else if (s.isFile() && full.endsWith('.js')) {
      const rel = relative(srcRootArg, full);
      if (BUILD_SYNCED_FILES.has(rel)) continue;
      out.push(full);
    }
  }
  return out;
}

// Detects real console.{log,debug,info,warn,error} usage. Strips line
// comments first so a `// console.log` doc reference doesn't trigger.
function fileTouchesConsole(absPath) {
  const src = readFileSync(absPath, 'utf8');
  const stripped = src.replace(/\/\/[^\n]*/g, '');
  return /\bconsole\.(log|debug|info|warn|error)\s*\(/.test(stripped);
}

describe('console logging guardrail contract', () => {
  it('only the baseline files use raw console.* — new files must route through lexeraLog / logFrontendIssue', () => {
    const allFiles = walkJs(srcRoot, [], srcRoot);
    const offenders = [];
    for (const file of allFiles) {
      if (!fileTouchesConsole(file)) continue;
      const rel = relative(srcRoot, file);
      if (!ALLOWED_CONSOLE_FILES.includes(rel)) offenders.push(rel);
    }
    expect(
      offenders,
      'These files added raw console.* calls. The user only watches the in-app Log panel — log via lexeraLog / logFrontendIssue (kanban) so the message reaches them. If the call genuinely needs console (eg the logger itself failing), add the file to ALLOWED_CONSOLE_FILES with a comment explaining why.'
    ).toEqual([]);
  });

  it('no baseline entry is stale — every allowlisted file still uses console.*', () => {
    // The allowlist must shrink, not stay padded. When a refactor
    // migrates a file's logging to lexeraLog, the test surfaces it so
    // the win is recorded by removing the entry.
    const stale = [];
    for (const rel of ALLOWED_CONSOLE_FILES) {
      const abs = join(srcRoot, rel);
      try {
        if (!fileTouchesConsole(abs)) stale.push(rel);
      } catch (_) {
        stale.push(rel + ' (file missing)');
      }
    }
    expect(
      stale,
      'These allowlist entries no longer use console.*. Remove them from ALLOWED_CONSOLE_FILES.'
    ).toEqual([]);
  });
});
