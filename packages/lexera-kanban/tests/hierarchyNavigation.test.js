import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const BoardNavigation = require('../src/navigation/boardNavigation.js');
const DashboardTree = require('../src/dashboard/dashboardTree.js');

/**
 * Extract and wrap `openEditForHierarchyTarget` from `src/app.js` with a stub
 * `ActionRegistry` so we can verify the target→action mapping without booting
 * the full LexeraDashboard IIFE or any DOM.
 */
function loadOpenEditForHierarchyTarget() {
  const source = fs.readFileSync(
    path.resolve('src/app.js'),
    'utf8'
  );
  const lines = source.split('\n');
  let startIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes('function openEditForHierarchyTarget(target)')) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    throw new Error('openEditForHierarchyTarget not found in src/app.js');
  }
  // Walk forward to find the matching closing brace.
  let depth = 0;
  let started = false;
  const body = [];
  for (let i = startIdx; i < lines.length; i += 1) {
    const line = lines[i];
    body.push(line);
    for (let c = 0; c < line.length; c += 1) {
      if (line[c] === '{') { depth += 1; started = true; }
      if (line[c] === '}') depth -= 1;
    }
    if (started && depth === 0) break;
  }
  const fnSrc = body.join('\n');
  // Build a factory that injects a mocked ActionRegistry and returns the fn.
  const wrappedSrc = `
    ${fnSrc}
    return openEditForHierarchyTarget;
  `;
  return function create(mockRegistry) {
    const factory = new Function('ActionRegistry', wrappedSrc);
    return factory(mockRegistry);
  };
}

const openEditFactory = loadOpenEditForHierarchyTarget();

let state;

function resetState() {
  state = {
    activeBoardId: null,
    activeBoardData: null,
    selectCalls: [],
    loadCalls: [],
    unfoldCalls: [],
    localFocusCalls: []
  };
}

function buildOptions(extra) {
  extra = extra || {};
  return {
    async selectBoard(boardId, options) {
      state.selectCalls.push({ boardId, options: options || {} });
      state.activeBoardId = boardId;
    },
    getActiveBoardId() {
      return state.activeBoardId;
    },
    getActiveBoardData() {
      return state.activeBoardData;
    },
    async loadBoard(boardId) {
      state.loadCalls.push(boardId);
      state.activeBoardId = boardId;
      state.activeBoardData = { id: boardId };
    },
    unfoldSearchTarget(target) {
      state.unfoldCalls.push(target);
    },
    focusHierarchyTargetLocally(target) {
      state.localFocusCalls.push(target);
      return true;
    }
  };
}

function makeTreeNode(classes, attrs) {
  const attrMap = Object.assign({}, attrs);
  return {
    classList: {
      contains(name) {
        return classes.indexOf(name) >= 0;
      }
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrMap, name) ? attrMap[name] : null;
    }
  };
}

beforeEach(() => {
  resetState();
});

describe('buildHierarchyFocusTargetFromTreeNode', () => {
  it('extracts row navigation coordinates', () => {
    const node = makeTreeNode(['tree-node', 'tree-row'], {
      'data-row-index': '2'
    });
    expect(BoardNavigation.buildHierarchyFocusTargetFromTreeNode(node, 'board-1', {
      parseOptionalSearchIndex: DashboardTree.parseOptionalSearchIndex
    })).toEqual({
      boardId: 'board-1',
      rowIndex: 2
    });
  });

  it('extracts card navigation coordinates including card id', () => {
    const node = makeTreeNode(['tree-node', 'tree-card'], {
      'data-board-id': 'board-7',
      'data-row-index': '1',
      'data-stack-index': '3',
      'data-col-local-index': '4',
      'data-col-index': '9',
      'data-card-index': '6',
      'data-card-id': 'card-99'
    });
    expect(BoardNavigation.buildHierarchyFocusTargetFromTreeNode(node, null, {
      parseOptionalSearchIndex: DashboardTree.parseOptionalSearchIndex
    })).toEqual({
      boardId: 'board-7',
      rowIndex: 1,
      stackIndex: 3,
      colLocalIndex: 4,
      columnIndex: 9,
      cardIndex: 6,
      cardId: 'card-99'
    });
  });
});

describe('navigateToHierarchyTarget', () => {
  it('loads and focuses locally', async () => {
    await BoardNavigation.navigateToHierarchyTarget({
      boardId: 'board-local',
      rowIndex: 0,
      stackIndex: 1,
      colLocalIndex: 2
    }, buildOptions());

    expect(state.selectCalls).toEqual([
      { boardId: 'board-local', options: {} }
    ]);
    expect(state.loadCalls).toEqual(['board-local']);
    expect(state.unfoldCalls).toHaveLength(1);
    expect(state.localFocusCalls).toHaveLength(1);
  });

  it('navigates to a different board and focuses locally', async () => {
    state.activeBoardId = 'board-old';
    state.activeBoardData = null;

    await BoardNavigation.navigateToHierarchyTarget({
      boardId: 'board-other',
      rowIndex: 1
    }, buildOptions());

    expect(state.selectCalls.at(-1)).toEqual({
      boardId: 'board-other',
      options: {}
    });
    expect(state.loadCalls).toEqual(['board-other']);
    expect(state.unfoldCalls).toHaveLength(1);
    expect(state.localFocusCalls).toHaveLength(1);
  });
});

describe('openEditForHierarchyTarget', () => {
  // Regression coverage for double-click-to-edit in the workspace hierarchy.
  // This function is the iframe-side contract that the workspace shell calls
  // via `frame.contentWindow.LexeraDashboard.openEditForHierarchyTarget(target)`
  // after delivering a focus target. It MUST translate between the tree-node
  // target shape (rowIndex / stackIndex / colLocalIndex / columnIndex /
  // cardIndex) and the ActionRegistry ctx shape (rowIdx / stackIdx /
  // colLocalIdx / colIndex / cardIndex), then dispatch the right scope+action
  // pair: card→edit, column→rename, stack→rename, row→rename.
  function createMockRegistry() {
    const calls = [];
    return {
      dispatch(scope, action, ctx) {
        calls.push({ scope, action, ctx });
        return true;
      },
      calls
    };
  }

  it('dispatches card.edit for a card target with columnIndex and cardIndex', () => {
    const registry = createMockRegistry();
    const openEdit = openEditFactory(registry);
    const result = openEdit({
      boardId: 'board-1',
      rowIndex: 1,
      stackIndex: 2,
      colLocalIndex: 3,
      columnIndex: 9,
      cardIndex: 4,
      cardId: 'card-abc'
    });
    expect(result).toBe(true);
    expect(registry.calls).toHaveLength(1);
    expect(registry.calls[0]).toEqual({
      scope: 'card',
      action: 'edit',
      ctx: { colIndex: 9, cardIndex: 4 }
    });
  });

  it('dispatches column.rename for a column target with colLocalIndex', () => {
    const registry = createMockRegistry();
    const openEdit = openEditFactory(registry);
    const result = openEdit({
      boardId: 'board-1',
      rowIndex: 2,
      stackIndex: 1,
      colLocalIndex: 0,
      columnIndex: 5
    });
    expect(result).toBe(true);
    expect(registry.calls).toHaveLength(1);
    expect(registry.calls[0]).toEqual({
      scope: 'column',
      action: 'rename',
      ctx: { colIndex: 5, rowIdx: 2, stackIdx: 1, colLocalIdx: 0 }
    });
  });

  it('falls back to colIndex=-1 when columnIndex is missing on a column target', () => {
    const registry = createMockRegistry();
    const openEdit = openEditFactory(registry);
    openEdit({
      boardId: 'board-1',
      rowIndex: 0,
      stackIndex: 0,
      colLocalIndex: 0
    });
    expect(registry.calls[0].ctx.colIndex).toBe(-1);
  });

  it('dispatches stack.rename for a stack target', () => {
    const registry = createMockRegistry();
    const openEdit = openEditFactory(registry);
    const result = openEdit({
      boardId: 'board-1',
      rowIndex: 1,
      stackIndex: 2
    });
    expect(result).toBe(true);
    expect(registry.calls).toHaveLength(1);
    expect(registry.calls[0]).toEqual({
      scope: 'stack',
      action: 'rename',
      ctx: { rowIdx: 1, stackIdx: 2 }
    });
  });

  it('dispatches row.rename for a row target', () => {
    const registry = createMockRegistry();
    const openEdit = openEditFactory(registry);
    const result = openEdit({
      boardId: 'board-1',
      rowIndex: 3
    });
    expect(result).toBe(true);
    expect(registry.calls).toHaveLength(1);
    expect(registry.calls[0]).toEqual({
      scope: 'row',
      action: 'rename',
      ctx: { rowIdx: 3 }
    });
  });

  it('prefers card dispatch when a target carries every field', () => {
    // A card target has every parent coordinate too; we must not dispatch
    // both card.edit and column.rename — only the most specific one.
    const registry = createMockRegistry();
    const openEdit = openEditFactory(registry);
    openEdit({
      boardId: 'board-1',
      rowIndex: 0,
      stackIndex: 0,
      colLocalIndex: 0,
      columnIndex: 0,
      cardIndex: 2
    });
    expect(registry.calls).toHaveLength(1);
    expect(registry.calls[0].scope).toBe('card');
  });

  it('returns false and dispatches nothing for a null target', () => {
    const registry = createMockRegistry();
    const openEdit = openEditFactory(registry);
    expect(openEdit(null)).toBe(false);
    expect(openEdit(undefined)).toBe(false);
    expect(registry.calls).toHaveLength(0);
  });

  it('returns false and dispatches nothing when ActionRegistry is missing', () => {
    const openEdit = openEditFactory(null);
    expect(openEdit({ boardId: 'b1', rowIndex: 0 })).toBe(false);
  });

  it('returns false for a target with no positional coordinates', () => {
    const registry = createMockRegistry();
    const openEdit = openEditFactory(registry);
    expect(openEdit({ boardId: 'board-1' })).toBe(false);
    expect(registry.calls).toHaveLength(0);
  });
});
