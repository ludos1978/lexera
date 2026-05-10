// Kanban → Workspace cross-view drop contract (Stage 14 + 17d
// refactor — destination receiver lives in shared module).
//
// User report 2026-05-10: "i cant drag from the kanban to the
// workspace!". The kanban view's `dragDropHandlers.js` dispatches
// `external-dnd-hover` / `external-dnd-drop` to whichever webview
// the cursor lands on (Stage 17a) AND broadcasts
// `hierarchy-entity-drag-start` so destinations can arm per-webview
// pointer trackers when pointer events don't cross WKWebView
// boundaries.
//
// The destination-side wiring used to be inlined in hierarchy.js
// and workspaces.js; Stage 17d consolidated it into
// `_shared/treeCrossViewDrop.js`. The full contract now splits:
//   - `workspaceTreeCrossViewDragReceiverContract.test.js` pins the
//     shared module + each sub-app's wiring of it.
//   - This test pins the sub-app-side onCustom subscriptions for
//     external-dnd-hover/-drop/-clear (which delegate to the shared
//     receiver) AND the source's payload-shape compatibility.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

function pinReceiverWiring(label, src, handlerVarName) {
  describe(label, () => {
    it('subscribes to external-dnd-hover, external-dnd-drop, and external-dnd-clear via LexeraSubApp.init onCustom', () => {
      expect(src).toMatch(/['"]external-dnd-hover['"]\s*:/);
      expect(src).toMatch(/['"]external-dnd-drop['"]\s*:/);
      expect(src).toMatch(/['"]external-dnd-clear['"]\s*:/);
    });

    it(`onCustom callbacks delegate to ${handlerVarName} with the right event-kind tag`, () => {
      expect(src).toMatch(new RegExp(`${handlerVarName}\\s*\\(\\s*['"]hover['"]`));
      expect(src).toMatch(new RegExp(`${handlerVarName}\\s*\\(\\s*['"]drop['"]`));
      expect(src).toMatch(new RegExp(`${handlerVarName}\\s*\\(\\s*['"]clear['"]`));
    });

    it(`${handlerVarName} is wired from LexeraTreeCrossViewDrop.install (no inline duplication)`, () => {
      // Stage 17d (consolidation): handler used to be defined inline
      // in each sub-app. Now it comes from the shared module.
      expect(src).toMatch(new RegExp(`${handlerVarName}\\s*=\\s*crossViewDropReceiver\\.onExternalDnd`));
    });
  });
}

describe('shared receiver — payload mapper accepts kanban dispatch shape', () => {
  it('mapXviewSourceFromPayload maps kanban dispatch source { boardId, cardId, ... } via type discriminant', () => {
    // The kanban's `getCrossViewDragPayload` emits source as
    //   { boardId, cardId | columnId | stackId | rowId, ... }
    // with `type: 'tree-card' | 'tree-column' | 'tree-stack' | 'tree-row'`.
    // The shell-forwarder format already carries { kind, entityId }.
    // Mapper accepts BOTH or kanban→workspace silently returns null.
    expect(sharedSrc).toMatch(/function\s+mapXviewSourceFromPayload\s*\(/);
    expect(sharedSrc).toMatch(/src\.kind\s*&&\s*src\.entityId/);
    expect(sharedSrc).toMatch(/['"]tree-card['"]/);
    expect(sharedSrc).toMatch(/['"]tree-column['"]/);
    expect(sharedSrc).toMatch(/['"]tree-stack['"]/);
    expect(sharedSrc).toMatch(/['"]tree-row['"]/);
    expect(sharedSrc).toMatch(/src\.cardId/);
    expect(sharedSrc).toMatch(/src\.columnId/);
    expect(sharedSrc).toMatch(/src\.stackId/);
    expect(sharedSrc).toMatch(/src\.rowId/);
  });

  it('on hover: paints is-drop-before / -after / -absorb based on match.info.position', () => {
    expect(sharedSrc).toMatch(/is-drop-before/);
    expect(sharedSrc).toMatch(/is-drop-after/);
    expect(sharedSrc).toMatch(/is-drop-absorb/);
    expect(sharedSrc).toMatch(/match\.info\.position\s*===\s*['"]before['"]/);
    expect(sharedSrc).toMatch(/match\.info\.position\s*===\s*['"]after['"]/);
  });

  it('on drop: broadcasts hierarchy-entity-drop with { source, target } AND cross-view-drag-handled echo', () => {
    expect(sharedSrc).toMatch(/broadcast\(\s*['"]hierarchy-entity-drop['"]/);
    expect(sharedSrc).toMatch(/broadcast\(\s*['"]cross-view-drag-handled['"]/);
  });

  it('on drop: only broadcasts when a target was actually resolved (no dead-letter on miss)', () => {
    // Releasing over an empty area must NOT fire hierarchy-entity-drop
    // — that would carry an undefined target and the shell would log
    // `apply.local-drop.skip(missing-source-or-target)`.
    expect(sharedSrc).toMatch(/if\s*\(\s*match\s*&&\s*source\s*&&[\s\S]{0,400}broadcast\(\s*['"]hierarchy-entity-drop['"]/);
  });
});

describe('kanban → workspace cross-view drop sub-app wiring', () => {
  pinReceiverWiring('hierarchy.js', hierarchySrc, '_hierarchyOnExternalDnd');
  pinReceiverWiring('workspaces.js', workspacesSrc, '_workspacesOnExternalDnd');
});
