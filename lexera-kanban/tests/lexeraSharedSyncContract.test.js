// lexera-shared sync surface contract.
//
// `lexera-shared/scripts/sync-runtime-assets.mjs` copies a fixed list of
// files into each consuming app's `src/` on every dev/build. Each app's
// `src/.gitignore` must list those same files — otherwise:
//   * a missing entry → the copied file ends up tracked, and git history
//     grows two diverging copies (the original lexera-shared version and
//     the copy), which is exactly the duplication this dedup work was
//     supposed to eliminate (closed by 9d36932e for backendDiscovery).
//   * a stale entry that the sync script no longer owns → the gitignore
//     silently masks a tracked file the codebase actually ships, and
//     refactors that delete the source file in lexera-shared keep working
//     locally because the stale copy is still on disk.
//
// This test pins the two lists in lockstep. It runs from
// `lexera-kanban/tests/` so it lives next to the other contract tests
// even though it asserts on lexera-backend's gitignore too.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const syncScript = readFileSync(
  resolve(repoRoot, 'lexera-shared', 'scripts', 'sync-runtime-assets.mjs'),
  'utf8'
);

function syncedAssets() {
  // Pull the literal asset list out of the script. The script defines:
  //   const assets = [
  //     'management.js', ...
  //   ];
  const block = syncScript.match(/const\s+assets\s*=\s*\[([\s\S]*?)\]/);
  expect(block, 'sync-runtime-assets.mjs must declare a literal `assets` array').toBeTruthy();
  const items = [];
  const re = /'([^']+)'/g;
  let m;
  while ((m = re.exec(block[1])) !== null) items.push(m[1]);
  return items;
}

function gitignoreLines(absPath) {
  return readFileSync(absPath, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
}

describe('lexera-shared sync surface contract', () => {
  it('every asset the sync script copies is covered by the destination app gitignore', () => {
    const assets = syncedAssets();
    expect(assets.length).toBeGreaterThan(0);

    const kanbanIgnore = gitignoreLines(
      resolve(repoRoot, 'lexera-kanban', 'src', '.gitignore')
    );
    const backendIgnore = gitignoreLines(
      resolve(repoRoot, 'lexera-backend', 'src', '.gitignore')
    );

    for (const asset of assets) {
      expect(
        kanbanIgnore,
        `lexera-kanban/src/.gitignore must list '${asset}' so the build-time copy is not tracked`
      ).toContain(asset);
      expect(
        backendIgnore,
        `lexera-backend/src/.gitignore must list '${asset}' so the build-time copy is not tracked`
      ).toContain(asset);
    }
  });
});
