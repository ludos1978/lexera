// Pin the no-write-on-equal-content invariant of
// `lexera-kanban/scripts/sync-excalidraw-assets.mjs`.
//
// Sister test of `syncRuntimeAssetsIdempotent.test.js`, same root
// cause: in Tauri 2 dev mode the `lexera-kanban/src/` frontendDist is
// watched, and any mtime bump inside it (even from a no-op `cp`)
// reloads the main webview a few hundred ms after boot. The reload
// races destroyAll() and leaves orphan child webviews painting at the
// same coordinates as the new ones — the user-visible "ghost views in
// the background" regression. The previous bash version of this sync
// did unconditional `cp -R`, hitting that exact failure mode.
//
// This test exercises the production script directly so the contract
// is enforced in CI even if the script is later rewritten.
//
// The test relies on the actual node_modules/@excalidraw assets being
// present (they are; the repo's package.json pins them and the script
// errors out otherwise — itself a useful sanity check).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, statSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const kanbanRoot = resolve(__dirname, '..');
const scriptPath = resolve(kanbanRoot, 'scripts', 'sync-excalidraw-assets.mjs');
const realVendorDir = resolve(kanbanRoot, 'src', 'vendor', 'excalidraw');

// Top-level files the script copies. Directory `excalidraw-assets/` is
// covered by counting > 3 unchanged in the production-environment run.
const TOP_LEVEL = [
  'react.production.min.js',
  'react-dom.production.min.js',
  'excalidraw.production.min.js',
];

function runSync(cwd) {
  return execFileSync(process.execPath, [scriptPath], {
    cwd: cwd || kanbanRoot,
    encoding: 'utf-8',
  });
}

describe('lexera-kanban/scripts/sync-excalidraw-assets.mjs idempotency', () => {
  it('first invocation populates dest (or reports unchanged if dest already in sync from prior boot)', () => {
    const out = runSync();
    expect(out).toMatch(/\[sync-excalidraw-assets\] synced ->/);
    // Either way, the destination must contain the three top-level files.
    for (const f of TOP_LEVEL) {
      expect(existsSync(join(realVendorDir, f))).toBe(true);
    }
  });

  it('a second invocation with no source change reports 0 written and bumps no mtime', () => {
    // First settle the destination (no-ops if already in sync).
    runSync();
    const before = {};
    for (const f of TOP_LEVEL) {
      before[f] = statSync(join(realVendorDir, f)).mtimeMs;
    }
    // Sleep so a re-write would be visible at ms granularity.
    const t0 = Date.now();
    while (Date.now() - t0 < 25) { /* spin */ }
    const out = runSync();
    expect(out).toMatch(/\(0 written, \d+ unchanged\)/);
    for (const f of TOP_LEVEL) {
      const after = statSync(join(realVendorDir, f)).mtimeMs;
      expect(after, 'mtime of ' + f + ' should not change on a no-op sync').toBe(before[f]);
    }
  });

  it('mutating a single destination file rewrites only that one', () => {
    // First settle.
    runSync();
    const target = TOP_LEVEL[0];
    const targetPath = join(realVendorDir, target);
    const original = readFileSync(targetPath);
    writeFileSync(targetPath, Buffer.concat([original, Buffer.from('// stale\n')]));
    const before = {};
    for (const f of TOP_LEVEL) {
      before[f] = statSync(join(realVendorDir, f)).mtimeMs;
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 25) { /* spin */ }
    const out = runSync();
    // Exactly the mutated file should be rewritten — assets dir +
    // other top-level files must still report as unchanged.
    expect(out).toMatch(/\(1 written, \d+ unchanged\)/);
    expect(statSync(targetPath).mtimeMs).not.toBe(before[target]);
    for (const f of TOP_LEVEL.slice(1)) {
      expect(statSync(join(realVendorDir, f)).mtimeMs).toBe(before[f]);
    }
  });

  it('the production script file ends in .mjs (not .sh) — no shell-cp regression', () => {
    // Pin the Node implementation so a future change can't reintroduce
    // the unconditional `cp -R` that was the original failure mode.
    expect(scriptPath.endsWith('.mjs')).toBe(true);
    expect(existsSync(scriptPath)).toBe(true);
    // The old shell script must be gone.
    const oldShell = resolve(kanbanRoot, 'scripts', 'sync-excalidraw-assets.sh');
    expect(existsSync(oldShell)).toBe(false);
  });
});
