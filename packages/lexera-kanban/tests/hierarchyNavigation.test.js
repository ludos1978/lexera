import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BoardNavigation = require('../src/navigation/boardNavigation.js');
const DashboardTree = require('../src/dashboard/dashboardTree.js');

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
