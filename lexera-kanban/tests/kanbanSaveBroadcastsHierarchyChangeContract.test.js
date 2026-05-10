// Kanban save broadcasts hierarchy-board-changed.
//
// User report 2026-05-10: "workspace doesnt update if i change the
// same board in the kanban view!" — the workspace tree subapps
// (hierarchy.js / workspaces.js) and Stage-15's app.js reload
// handler both listen for `hierarchy-board-changed`, but no one
// broadcasts it for kanban-internal saves. Only the shell-side
// hierarchyDragBridge broadcasts on its own apply path.
//
// Fix: kanban's `saveFullBoard` wrapper in app.js now broadcasts
// `hierarchy-board-changed` on success. Source-level (regex) test
// pinning the wiring.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const appSrc = readFileSync(resolve(repoRoot, 'src', 'app.js'), 'utf8');

describe('kanban save broadcasts hierarchy-board-changed', () => {
  it('saveFullBoard wrapper awaits BoardDataStore.saveFullBoard, then broadcasts on success', () => {
    // The wrapper used to be a one-liner re-export. It now needs
    // to capture the result so it can gate the broadcast.
    const block = appSrc.match(
      /async\s+function\s+saveFullBoard\s*\(\s*\)\s*\{[\s\S]{0,2000}?BoardDataStore\.saveFullBoard\(\s*\)[\s\S]{0,2000}?multiview_broadcast[\s\S]{0,400}?\}/
    );
    expect(block, 'saveFullBoard wrapper must call BoardDataStore.saveFullBoard AND multiview_broadcast').not.toBeNull();
  });

  it('broadcast is gated on save success (skipped when saveFullBoard returns falsy)', () => {
    // Otherwise a failed save would still tell every subscriber the
    // board changed, causing spurious refetches that would either
    // no-op (revisions match) or overwrite local in-flight state.
    // Pull the wrapper body — anchor to the BoardDataStore call and
    // the broadcast call so the slice covers the whole body even
    // when intermediate comments grow.
    const startIdx = appSrc.search(/async\s+function\s+saveFullBoard\s*\(\s*\)/);
    expect(startIdx).toBeGreaterThan(-1);
    const block = [appSrc.slice(startIdx, startIdx + 2500)];
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/var\s+ok\s*=\s*await\s+BoardDataStore\.saveFullBoard\(\s*\)/);
    expect(block[0]).toMatch(/if\s*\(\s*ok\s*&&\s*activeBoardId/);
  });

  it('broadcast carries event=hierarchy-board-changed and payload={ boardId: activeBoardId }', () => {
    // The receivers (hierarchy.js / workspaces.js cache invalidate,
    // Stage-15's app.js reload handler in OTHER kanban webviews)
    // expect this exact event + payload shape.
    // Pull the wrapper body — anchor to the BoardDataStore call and
    // the broadcast call so the slice covers the whole body even
    // when intermediate comments grow.
    const startIdx = appSrc.search(/async\s+function\s+saveFullBoard\s*\(\s*\)/);
    expect(startIdx).toBeGreaterThan(-1);
    const block = [appSrc.slice(startIdx, startIdx + 2500)];
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/event\s*:\s*['"]hierarchy-board-changed['"]/);
    expect(block[0]).toMatch(/payload\s*:\s*\{\s*boardId\s*:\s*activeBoardId\s*\}/);
  });

  it('broadcast errors route through logFrontendIssue (in-app log panel)', () => {
    // Per the project's "log into the in-app logger view" rule —
    // never console.* / stderr.
    // Pull the wrapper body — anchor to the BoardDataStore call and
    // the broadcast call so the slice covers the whole body even
    // when intermediate comments grow.
    const startIdx = appSrc.search(/async\s+function\s+saveFullBoard\s*\(\s*\)/);
    expect(startIdx).toBeGreaterThan(-1);
    const block = [appSrc.slice(startIdx, startIdx + 2500)];
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/logFrontendIssue/);
  });

  it('broadcast is guarded on window.LexeraMultiview availability (degrades gracefully without Tauri runtime)', () => {
    // Otherwise the wrapper would throw in test fixtures and any
    // non-Tauri runtime where LexeraMultiview is absent.
    // Pull the wrapper body — anchor to the BoardDataStore call and
    // the broadcast call so the slice covers the whole body even
    // when intermediate comments grow.
    const startIdx = appSrc.search(/async\s+function\s+saveFullBoard\s*\(\s*\)/);
    expect(startIdx).toBeGreaterThan(-1);
    const block = [appSrc.slice(startIdx, startIdx + 2500)];
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/window\.LexeraMultiview/);
    expect(block[0]).toMatch(/typeof\s+window\.LexeraMultiview\.invoke\s*===\s*['"]function['"]/);
  });
});
