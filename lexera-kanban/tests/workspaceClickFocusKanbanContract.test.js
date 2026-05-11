// Workspace tree click → focus entity in kanban view contract.
//
// User contract 2026-05-11: "when clicking on an element in the
// workspace (not on the burger menu or the drag icon) then it
// should focus that element in the kanban view (if the kanban
// isnt open, then open it!)"
//
// Wiring:
//   hierarchy.js / workspaces.js click handler →
//     LexeraSubApp.navigate({ type: 'focus-hierarchy-target', target })
//   → shell's navigationBridge.handleNavigate →
//     LexeraWorkspaceShell.focusHierarchyTarget(target, boardId, options)
//   → openBoard({ preferExisting: true }) +
//     messageBridge.focusHierarchy(tabId, target) to the kanban frame
//
// Source-level (regex) test pinning each link in that chain.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const hierarchySrc = readFileSync(
  resolve(repoRoot, 'src', 'views', 'hierarchy', 'hierarchy.js'), 'utf8'
);
const workspacesSrc = readFileSync(
  resolve(repoRoot, 'src', 'views', 'workspaces', 'workspaces.js'), 'utf8'
);
const navigationBridgeSrc = readFileSync(
  resolve(repoRoot, 'src', 'shell', 'bridges', 'navigationBridge.js'), 'utf8'
);

function pinSubAppClickWiring(label, src) {
  describe(label + ' — click handler routes non-board tree-nodes to focus-hierarchy-target', () => {
    it('navigates with type=focus-hierarchy-target carrying { boardId, kind ids, indices }', () => {
      expect(src).toMatch(/LexeraSubApp\.navigate\(\s*\{\s*[\s\S]{0,400}type\s*:\s*['"]focus-hierarchy-target['"]/);
      expect(src).toMatch(/target\s*:\s*focusTarget/);
    });

    it('skips clicks on the burger menu (.tree-menu-btn) and drag icon (.tree-grip)', () => {
      // User contract: clicks on these elements MUST keep their own
      // behavior and not navigate. The early-return is what guards it.
      expect(src).toMatch(/closest\(['"]\.tree-menu-btn['"]\)\s*\|\|\s*[\s\S]{0,100}closest\(['"]\.tree-grip['"]\)/);
    });

    it('only navigates when the node has data-drag-kind (rows/stacks/columns/cards)', () => {
      // Without data-drag-kind, the node is either a board row (handled
      // above) or a structural placeholder — early return.
      expect(src).toMatch(/getAttribute\(\s*['"]data-drag-kind['"]\s*\)/);
      expect(src).toMatch(/if\s*\(\s*!dragKind\s*\)\s*return\s*;/);
    });

    it('builds the focusTarget shape from data-* attributes (boardId, rowId, stackId, columnId, cardId + indices)', () => {
      // Mirror of the shape `boardSearch.navigateToSearchResult` uses
      // so shell.focusHierarchyTarget routes through the same kanban-
      // frame entity finder.
      expect(src).toMatch(/boardId\s*:\s*focusBoardId/);
      expect(src).toMatch(/rowId\s*:\s*node\.getAttribute\(\s*['"]data-row-id['"]/);
      expect(src).toMatch(/stackId\s*:\s*node\.getAttribute\(\s*['"]data-stack-id['"]/);
      expect(src).toMatch(/columnId\s*:\s*node\.getAttribute\(\s*['"]data-column-id['"]/);
      // cardId prefers the kid form (8-char hex), falls back to the
      // Loro container id — mirror of the drag-source convention.
      expect(src).toMatch(/cardId\s*:\s*node\.getAttribute\(\s*['"]data-card-kid['"]\s*\)\s*\|\|\s*[\s\S]{0,200}data-card-id/);
      // Indices: parseInt + isNaN guard so absent attributes don't
      // poison the payload.
      expect(src).toMatch(/parseInt\(\s*node\.getAttribute\(\s*['"]data-row-index['"]/);
      expect(src).toMatch(/parseInt\(\s*node\.getAttribute\(\s*['"]data-stack-index['"]/);
      expect(src).toMatch(/parseInt\(\s*node\.getAttribute\(\s*['"]data-col-local-index['"]/);
      expect(src).toMatch(/parseInt\(\s*node\.getAttribute\(\s*['"]data-card-index['"]/);
    });

    it('the existing open-board branch returns early so non-board navigation is mutually exclusive', () => {
      // Without `return`, clicking a board row would ALSO route to
      // focus-hierarchy-target with cardId=null etc. — meaningless,
      // and shell.focusHierarchyTarget might re-enter openBoard. The
      // explicit return after open-board navigate prevents that.
      expect(src).toMatch(/type\s*:\s*['"]open-board['"][\s\S]{0,200}return\s*;/);
    });
  });
}

describe('workspace tree click → focus kanban entity (user contract 2026-05-11)', () => {
  pinSubAppClickWiring('hierarchy.js', hierarchySrc);
  pinSubAppClickWiring('workspaces.js', workspacesSrc);

  describe('navigationBridge.js — focus-hierarchy-target dispatch', () => {
    it('handleNavigate routes type=focus-hierarchy-target to shell.focusHierarchyTarget(target, boardId, options)', () => {
      // Without this branch, the sub-app's navigate call falls through
      // and the kanban never opens / focuses.
      expect(navigationBridgeSrc).toMatch(/payload\.type\s*===\s*['"]focus-hierarchy-target['"]/);
      expect(navigationBridgeSrc).toMatch(/shell\.focusHierarchyTarget\(\s*payload\.target\s*,\s*payload\.target\.boardId/);
    });

    it('gates on payload.target.boardId so a missing payload silently no-ops', () => {
      // Defensive — sub-app builds the target from DOM attributes that
      // could be empty for malformed tree-nodes. Without the gate,
      // shell.focusHierarchyTarget would be called with undefined boardId.
      expect(navigationBridgeSrc).toMatch(/payload\.target\s*&&\s*payload\.target\.boardId/);
    });
  });
});
