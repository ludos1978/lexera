// Workspace tree per-webview pointer tracker contract (Stage 17b
// + 17d refactor — destination receiver lives in shared module).
//
// User report 2026-05-10: "dragging from kanban to workspace doesnt
// work at all (no cross window drag indicator, no highlight, etc)".
//
// Stage 17a wired the SOURCE side: kanban broadcasts
// `hierarchy-entity-drag-start`. Stage 17b wired the DESTINATION
// side: workspace tree sub-apps install document-level pointer
// listeners on receipt. Stage 17d (this commit) consolidated the
// duplicated destination logic into `_shared/treeCrossViewDrop.js`
// — both sub-apps now wire the same module via `install({ ... })`.
//
// Source-level (regex) test: pins the shared module's contract +
// each sub-app's wiring to it.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const sharedSrc = readFileSync(
  resolve(repoRoot, 'src', 'views', '_shared', 'treeCrossViewDrop.js'), 'utf8'
);
const hierarchySrc = readFileSync(
  resolve(repoRoot, 'src', 'views', 'hierarchy', 'hierarchy.js'), 'utf8'
);
const workspacesSrc = readFileSync(
  resolve(repoRoot, 'src', 'views', 'workspaces', 'workspaces.js'), 'utf8'
);
const hierarchyHtml = readFileSync(
  resolve(repoRoot, 'src', 'views', 'hierarchy', 'index.html'), 'utf8'
);
const workspacesHtml = readFileSync(
  resolve(repoRoot, 'src', 'views', 'workspaces', 'index.html'), 'utf8'
);

function loadSharedReceiver() {
  return loadIIFE('views/_shared/treeCrossViewDrop.js', 'window.LexeraTreeCrossViewDrop', {
    window: {},
    globalThis: {}
  });
}

describe('shared destination cross-view drop receiver — _shared/treeCrossViewDrop.js', () => {
  it('exposes the IIFE module on window.LexeraTreeCrossViewDrop with install / mapXviewSourceFromPayload / KIND_TO_TYPE', () => {
    expect(sharedSrc).toMatch(/window\.LexeraTreeCrossViewDrop\s*=\s*api/);
    expect(sharedSrc).toMatch(/install\s*:\s*install/);
    expect(sharedSrc).toMatch(/mapXviewSourceFromPayload\s*:\s*mapXviewSourceFromPayload/);
    expect(sharedSrc).toMatch(/KIND_TO_TYPE\s*:\s*KIND_TO_TYPE/);
  });

  it('install requires readDropTargetFromPoint dep — throws otherwise', () => {
    expect(sharedSrc).toMatch(/typeof\s+readDropTargetFromPoint\s*!==\s*['"]function['"][\s\S]{0,200}throw\s+new\s+Error/);
  });

  it('install returns { onExternalDnd, armCrossDragTracker, teardownCrossDragTracker }', () => {
    const installIdx = sharedSrc.search(/function\s+install\s*\(/);
    expect(installIdx).toBeGreaterThan(-1);
    const tail = sharedSrc.slice(installIdx, installIdx + 12000);
    // The install body is large (handler + tracker definitions).
    // Just verify the three return-shape members are emitted as
    // object properties before the closing brace of the install body.
    const returnIdx = tail.search(/return\s*\{/);
    expect(returnIdx, 'install must `return { ... }`').toBeGreaterThan(-1);
    const returnTail = tail.slice(returnIdx, returnIdx + 800);
    expect(returnTail).toMatch(/onExternalDnd\s*:/);
    expect(returnTail).toMatch(/armCrossDragTracker\s*:/);
    expect(returnTail).toMatch(/teardownCrossDragTracker\s*:/);
  });

  it('mapXviewSourceFromPayload accepts both shell-forwarder shape AND kanban-dispatch shape', () => {
    const mapIdx = sharedSrc.search(/function\s+mapXviewSourceFromPayload\s*\(/);
    expect(mapIdx).toBeGreaterThan(-1);
    const tail = sharedSrc.slice(mapIdx, mapIdx + 2000);
    // Shell-forwarder shortcut.
    expect(tail).toMatch(/src\.kind\s*&&\s*src\.entityId/);
    // Kanban per-kind id resolution.
    expect(tail).toMatch(/['"]tree-card['"]/);
    expect(tail).toMatch(/['"]tree-column['"]/);
    expect(tail).toMatch(/['"]tree-stack['"]/);
    expect(tail).toMatch(/['"]tree-row['"]/);
    expect(tail).toMatch(/src\.cardId/);
    expect(tail).toMatch(/src\.columnId/);
    expect(tail).toMatch(/src\.stackId/);
    expect(tail).toMatch(/src\.rowId/);
  });

  it('mapXviewSourceFromPayload preserves entityIds aliases for stale-primary-id recovery', () => {
    const shared = loadSharedReceiver();
    const source = shared.mapXviewSourceFromPayload({
      payload: {
        type: 'tree-card',
        source: {
          boardId: 'board-a',
          kind: 'card',
          entityId: 'stale-tree-id',
          entityIds: ['stale-tree-id', 'kid-a-1'],
          cardId: 'crdt-a-1',
          cardKid: 'kid-a-1',
          rowId: 'row-a',
          stackId: 'stack-a',
          columnId: 'col-a',
          rowIndex: 0,
          stackIndex: 1,
          colIndex: 2,
          cardIndex: 3
        }
      }
    });

    expect(source).toEqual({
      boardId: 'board-a',
      kind: 'card',
      entityId: 'stale-tree-id',
      entityIds: ['stale-tree-id', 'kid-a-1', 'crdt-a-1'],
      rowId: 'row-a',
      stackId: 'stack-a',
      columnId: 'col-a',
      cardId: 'crdt-a-1',
      cardKid: 'kid-a-1',
      rowIndex: 0,
      stackIndex: 1,
      colIndex: 2,
      cardIndex: 3
    });
  });

  it('onExternalDnd hover paints is-drop-before / -after / -absorb classes from match.info.position', () => {
    const installIdx = sharedSrc.search(/function\s+install\s*\(/);
    const tail = sharedSrc.slice(installIdx, installIdx + 12000);
    expect(tail).toMatch(/is-drop-before/);
    expect(tail).toMatch(/is-drop-after/);
    expect(tail).toMatch(/is-drop-absorb/);
    expect(tail).toMatch(/match\.info\.position\s*===\s*['"]before['"]/);
    expect(tail).toMatch(/match\.info\.position\s*===\s*['"]after['"]/);
  });

  it('onExternalDnd drop broadcasts hierarchy-entity-drop AND cross-view-drag-handled, gated on resolved match', () => {
    const installIdx = sharedSrc.search(/function\s+install\s*\(/);
    const tail = sharedSrc.slice(installIdx, installIdx + 12000);
    expect(tail).toMatch(/broadcast\(\s*['"]hierarchy-entity-drop['"]/);
    expect(tail).toMatch(/broadcast\(\s*['"]cross-view-drag-handled['"]/);
    expect(tail).toMatch(/if\s*\(\s*match\s*&&\s*source\s*&&[\s\S]{0,400}broadcast\(\s*['"]hierarchy-entity-drop['"]/);
  });

  it('armCrossDragTracker self-skips when payload.sourceWebviewLabel === own label', () => {
    const installIdx = sharedSrc.search(/function\s+install\s*\(/);
    const tail = sharedSrc.slice(installIdx, installIdx + 12000);
    expect(tail).toMatch(/sourceWebviewLabel\s*&&\s*ownLabel\s*&&\s*src\.sourceWebviewLabel\s*===\s*ownLabel/);
  });

  it('armCrossDragTracker installs document pointermove + pointerup + pointercancel listeners with 30s safety teardown', () => {
    const installIdx = sharedSrc.search(/function\s+install\s*\(/);
    const tail = sharedSrc.slice(installIdx, installIdx + 12000);
    expect(tail).toMatch(/document\.addEventListener\(\s*['"]pointermove['"]/);
    expect(tail).toMatch(/document\.addEventListener\(\s*['"]pointerup['"]/);
    expect(tail).toMatch(/document\.addEventListener\(\s*['"]pointercancel['"]/);
    expect(tail).toMatch(/setTimeout\([\s\S]{0,300}30000/);
  });

  it('teardownCrossDragTracker removes the three listeners + clears the safety timer + clears destination indicator via onExternalDnd("clear")', () => {
    const installIdx = sharedSrc.search(/function\s+install\s*\(/);
    const tail = sharedSrc.slice(installIdx, installIdx + 12000);
    expect(tail).toMatch(/removeEventListener\(\s*['"]pointermove['"]/);
    expect(tail).toMatch(/removeEventListener\(\s*['"]pointerup['"]/);
    expect(tail).toMatch(/removeEventListener\(\s*['"]pointercancel['"]/);
    expect(tail).toMatch(/clearTimeout/);
    expect(tail).toMatch(/onExternalDnd\(\s*['"]clear['"]/);
  });

  it('move handler routes through onExternalDnd("hover", ...) with local pointer coords', () => {
    const installIdx = sharedSrc.search(/function\s+install\s*\(/);
    const tail = sharedSrc.slice(installIdx, installIdx + 12000);
    expect(tail).toMatch(/onExternalDnd\(\s*['"]hover['"]/);
    expect(tail).toMatch(/x\s*:\s*e\.clientX/);
    expect(tail).toMatch(/y\s*:\s*e\.clientY/);
  });

  it('up handler routes through onExternalDnd("drop", ...) before teardown', () => {
    const installIdx = sharedSrc.search(/function\s+install\s*\(/);
    const tail = sharedSrc.slice(installIdx, installIdx + 12000);
    // Generous gap — teardown is called with a `'pointerup'` reason
    // string so the regex needs slack for the argument.
    expect(tail).toMatch(/onExternalDnd\(\s*['"]drop['"][\s\S]{0,800}teardownCrossDragTracker/);
  });

  it('emits Stage-17f diagnostic logs that pin where the kanban→workspace chain breaks', () => {
    // User-reported failure mode (2026-05-10): workspace tracker
    // arms but no pointerup ever fires. These three first-fire-per-drag
    // diagnostics tell apart "OS isn't routing pointer events to the
    // workspace at all" vs "pointermove fires but target lookup
    // fails" vs "match found but user released outside the node".
    expect(sharedSrc).toMatch(/tree\.tracker\.armed/);
    expect(sharedSrc).toMatch(/tree\.tracker\.pointermove\(first\)/);
    expect(sharedSrc).toMatch(/tree\.tracker\.hover\.match/);
    expect(sharedSrc).toMatch(/tree\.tracker\.hover\.no-match/);
    expect(sharedSrc).toMatch(/tree\.tracker\.pointerup/);
    expect(sharedSrc).toMatch(/tree\.tracker\.skip\(self\)/);
  });

  it('first-fire flags reset on every armCrossDragTracker so consecutive drags each emit', () => {
    // Without the reset, a user dragging twice in a row would only
    // see hover.match / hover.no-match for the FIRST drag — then
    // silence, masking whether the second drag's chain is actually
    // working.
    const armIdx = sharedSrc.search(/function\s+armCrossDragTracker\s*\(/);
    expect(armIdx).toBeGreaterThan(-1);
    const tail = sharedSrc.slice(armIdx, armIdx + 4000);
    expect(tail).toMatch(/_xviewLogFlags\.hoverNoMatch\s*=\s*false/);
    expect(tail).toMatch(/_xviewLogFlags\.hoverMatch\s*=\s*false/);
    expect(tail).toMatch(/_firstMoveLogged\s*=\s*false/);
  });
});

function pinSubAppWiring(label, src, htmlSrc, prefix) {
  describe(label + ' — wires the shared receiver', () => {
    it('loads _shared/treeCrossViewDrop.js BEFORE the sub-app script', () => {
      const sharedIdx = htmlSrc.indexOf('treeCrossViewDrop.js');
      const subAppIdx = htmlSrc.indexOf(label);
      expect(sharedIdx, 'shared module script tag must exist').toBeGreaterThan(-1);
      expect(subAppIdx, 'sub-app script tag must exist').toBeGreaterThan(-1);
      expect(sharedIdx).toBeLessThan(subAppIdx);
    });

    it('calls LexeraTreeCrossViewDrop.install with readDropTargetFromPoint + getOwnWebviewLabel', () => {
      expect(src).toMatch(/window\.LexeraTreeCrossViewDrop[\s\S]{0,200}\.install\s*\(\s*\{/);
      expect(src).toMatch(/readDropTargetFromPoint\s*:\s*readDropTargetFromPoint/);
      expect(src).toMatch(/getOwnWebviewLabel\s*:\s*getOwnWebviewLabel/);
    });

    it(`assigns the install return to _${prefix}OnExternalDnd / _${prefix}ArmCrossDragTracker / _${prefix}TeardownCrossDragTracker`, () => {
      // These outer-scope vars are what the LexeraSubApp.init onCustom
      // callbacks delegate to.
      expect(src).toMatch(new RegExp(`_${prefix}OnExternalDnd\\s*=\\s*crossViewDropReceiver\\.onExternalDnd`));
      expect(src).toMatch(new RegExp(`_${prefix}ArmCrossDragTracker\\s*=\\s*crossViewDropReceiver\\.armCrossDragTracker`));
      expect(src).toMatch(new RegExp(`_${prefix}TeardownCrossDragTracker\\s*=\\s*crossViewDropReceiver\\.teardownCrossDragTracker`));
    });

    it("LexeraSubApp.init's onCustom subscribes to hierarchy-entity-drag-start and routes through the arm hook", () => {
      expect(src).toMatch(/['"]hierarchy-entity-drag-start['"]\s*:/);
      expect(src).toMatch(new RegExp(`_${prefix}ArmCrossDragTracker\\(`));
    });

    it("cross-view-drag-handled handler also tears down the destination tracker", () => {
      const idx = src.search(/['"]cross-view-drag-handled['"]\s*:/);
      expect(idx).toBeGreaterThan(-1);
      const tail = src.slice(idx, idx + 1000);
      expect(tail).toMatch(new RegExp(`_${prefix}TeardownCrossDragTracker\\(`));
    });

    it('drag-start broadcast (source side) includes sourceWebviewLabel for the self-skip', () => {
      const idx = src.search(/broadcast\(\s*['"]hierarchy-entity-drag-start['"]/);
      expect(idx).toBeGreaterThan(-1);
      const tail = src.slice(Math.max(0, idx - 400), idx + 200);
      expect(tail).toMatch(/sourceWebviewLabel\s*:\s*getOwnWebviewLabel\(/);
    });

    it("subscribes to external-dnd-hover / -drop / -clear AND each delegates to _" + prefix + "OnExternalDnd", () => {
      expect(src).toMatch(/['"]external-dnd-hover['"]\s*:/);
      expect(src).toMatch(/['"]external-dnd-drop['"]\s*:/);
      expect(src).toMatch(/['"]external-dnd-clear['"]\s*:/);
      expect(src).toMatch(new RegExp(`_${prefix}OnExternalDnd\\(\\s*['"]hover['"]`));
      expect(src).toMatch(new RegExp(`_${prefix}OnExternalDnd\\(\\s*['"]drop['"]`));
      expect(src).toMatch(new RegExp(`_${prefix}OnExternalDnd\\(\\s*['"]clear['"]`));
    });
  });
}

describe('workspace tree sub-apps wire the shared receiver (Stage 17d)', () => {
  pinSubAppWiring('hierarchy.js', hierarchySrc, hierarchyHtml, 'hierarchy');
  pinSubAppWiring('workspaces.js', workspacesSrc, workspacesHtml, 'workspaces');
});
