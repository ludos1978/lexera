// Pin the "no-write-on-equal-content" invariant of
// `lexera-shared/scripts/sync-runtime-assets.mjs`.
//
// Why this test exists: the Tauri 2 dev-mode watcher reloads the
// `lexera-kanban` main webview on any mtime change inside its
// `frontendDist` (= `lexera-kanban/src/`). If the sync script writes
// a destination file whose content hasn't changed, the mtime bumps
// anyway and the watcher fires — main webview reloads mid-boot, the
// old shell's `destroyAll()` IPCs race the new shell's spawn loop,
// and the user sees every Tauri child webview duplicated at the same
// coordinates ("windows visible multiple times", "content in the
// background view").
//
// The fix: only write when bytes differ. This contract test catches
// any regression that re-introduces unconditional `copyFileSync` (or
// equivalent).

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const scriptPath = resolve(repoRoot, 'lexera-shared', 'scripts', 'sync-runtime-assets.mjs');
const sharedDir = resolve(repoRoot, 'lexera-shared');

// All of these are written by the script; if any goes missing we
// want to know — otherwise the dev-mode watcher trigger comes back
// silently for whatever new asset got added without test coverage.
const SYNCED_ASSETS = [
  'managementLogViewer.js',
  'management.js',
  'management.css',
  'themes.js',
  'backendDiscovery.js',
  'dialogs.js',
  'dialogs.css',
];

describe('lexera-shared/scripts/sync-runtime-assets.mjs idempotency', () => {
  let dest;

  beforeAll(() => {
    dest = mkdtempSync(join(tmpdir(), 'lexera-sync-test-'));
    return () => { try { rmSync(dest, { recursive: true, force: true }); } catch (_) {} };
  });

  function runSync() {
    return execFileSync(process.execPath, [scriptPath, dest], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
  }

  it('first run copies all assets', () => {
    const out = runSync();
    expect(out).toMatch(/synced runtime assets/);
    const got = new Set(readdirSync(dest));
    for (const asset of SYNCED_ASSETS) {
      expect(got.has(asset)).toBe(true);
    }
  });

  it('first-run output reports every asset as written (not skipped)', () => {
    rmSync(dest, { recursive: true, force: true });
    dest = mkdtempSync(join(tmpdir(), 'lexera-sync-test-'));
    const out = runSync();
    expect(out).toMatch(new RegExp('\\(' + SYNCED_ASSETS.length + ' written, 0 unchanged\\)'));
  });

  it('second run with identical content does not bump any mtime', () => {
    // Capture mtimes after the first run.
    const before = {};
    for (const asset of SYNCED_ASSETS) {
      before[asset] = statSync(join(dest, asset)).mtimeMs;
    }
    // Sleep a tick so a re-write would be visible at ms granularity.
    const t0 = Date.now();
    while (Date.now() - t0 < 25) { /* spin */ }
    const out = runSync();
    expect(out).toMatch(new RegExp('\\(0 written, ' + SYNCED_ASSETS.length + ' unchanged\\)'));
    for (const asset of SYNCED_ASSETS) {
      const after = statSync(join(dest, asset)).mtimeMs;
      expect(after).toBe(before[asset]);
    }
  });

  it('rewrites only the asset whose source content actually changed', () => {
    // Mutate ONE destination file so its bytes differ from the
    // source. The script should rewrite that one and leave the rest
    // alone.
    const target = SYNCED_ASSETS[0];
    const targetPath = join(dest, target);
    const original = readFileSync(targetPath);
    writeFileSync(targetPath, Buffer.concat([original, Buffer.from('// stale\n')]));
    const before = {};
    for (const asset of SYNCED_ASSETS) {
      before[asset] = statSync(join(dest, asset)).mtimeMs;
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 25) { /* spin */ }
    const out = runSync();
    expect(out).toMatch(new RegExp('\\(1 written, ' + (SYNCED_ASSETS.length - 1) + ' unchanged\\)'));
    expect(statSync(targetPath).mtimeMs).not.toBe(before[target]);
    for (const asset of SYNCED_ASSETS.slice(1)) {
      expect(statSync(join(dest, asset)).mtimeMs).toBe(before[asset]);
    }
  });

  it('all six expected assets exist on disk in the lexera-shared source dir', () => {
    // Pin the asset list so the script and test do not drift.
    for (const asset of SYNCED_ASSETS) {
      const srcPath = resolve(sharedDir, asset);
      expect(() => statSync(srcPath)).not.toThrow();
    }
  });
});
