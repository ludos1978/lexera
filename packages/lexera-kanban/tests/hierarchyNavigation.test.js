import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadHierarchyNavigationHarness() {
  const source = readFileSync(resolve(srcDir, 'app.js'), 'utf-8');
  const lines = source.split('\n');

  function extractFunction(startLine) {
    let depth = 0;
    let started = false;
    const result = [];
    for (let i = startLine - 1; i < lines.length; i++) {
      const line = lines[i];
      result.push(line);
      for (let c = 0; c < line.length; c++) {
        if (line[c] === '{') { depth++; started = true; }
        if (line[c] === '}') depth--;
      }
      if (started && depth === 0) break;
    }
    return result.join('\n');
  }

  function findLine(pattern) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(pattern)) return i + 1;
    }
    throw new Error('Could not find: ' + pattern);
  }

  const wrappedSource = `
    var embeddedMode = false;
    var splitViewMode = 'single';
    var activeSplitPane = 'a';
    var activeBoardId = null;
    var activeBoardData = null;
    var selectCalls = [];
    var loadCalls = [];
    var unfoldCalls = [];
    var localFocusCalls = [];
    var paneFocusCalls = [];

    function normalizeSplitPane(value) { return value === 'b' ? 'b' : 'a'; }
    async function selectBoard(boardId, options) {
      selectCalls.push({ boardId: boardId, options: options || {} });
      activeBoardId = boardId;
    }
    async function loadBoard(boardId) {
      loadCalls.push(boardId);
      activeBoardId = boardId;
      activeBoardData = { id: boardId };
    }
    function unfoldSearchTarget(target) { unfoldCalls.push(target); }
    function focusHierarchyTargetLocally(target) {
      localFocusCalls.push(target);
      return true;
    }
    function scheduleHierarchyFocusMessageToPane(pane, target) {
      paneFocusCalls.push({ pane: pane, target: target });
      return true;
    }
    function logFrontendIssue() {}
    function showNotification() {}

    ${extractFunction(findLine('function parseOptionalSearchIndex('))}
    ${extractFunction(findLine('function buildHierarchyFocusTargetFromTreeNode('))}
    ${extractFunction(findLine('async function navigateToHierarchyTarget('))}

    return {
      buildHierarchyFocusTargetFromTreeNode: buildHierarchyFocusTargetFromTreeNode,
      navigateToHierarchyTarget: navigateToHierarchyTarget,
      reset: function () {
        selectCalls = [];
        loadCalls = [];
        unfoldCalls = [];
        localFocusCalls = [];
        paneFocusCalls = [];
        activeBoardId = null;
        activeBoardData = null;
        embeddedMode = false;
        splitViewMode = 'single';
        activeSplitPane = 'a';
      },
      setEmbeddedMode: function (value) { embeddedMode = !!value; },
      setSplitViewMode: function (value) { splitViewMode = value; },
      setActiveSplitPane: function (value) { activeSplitPane = value; },
      setActiveBoardState: function (boardId, boardData) {
        activeBoardId = boardId;
        activeBoardData = boardData;
      },
      getState: function () {
        return {
          selectCalls: selectCalls.slice(),
          loadCalls: loadCalls.slice(),
          unfoldCalls: unfoldCalls.slice(),
          localFocusCalls: localFocusCalls.slice(),
          paneFocusCalls: paneFocusCalls.slice(),
          activeBoardId: activeBoardId,
          activeBoardData: activeBoardData
        };
      }
    };
  `;

  return new Function(wrappedSource)();
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

let H;

beforeAll(() => {
  H = loadHierarchyNavigationHarness();
});

describe('buildHierarchyFocusTargetFromTreeNode', () => {
  it('extracts row navigation coordinates', () => {
    const node = makeTreeNode(['tree-node', 'tree-row'], {
      'data-row-index': '2'
    });
    expect(H.buildHierarchyFocusTargetFromTreeNode(node, 'board-1')).toEqual({
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
    expect(H.buildHierarchyFocusTargetFromTreeNode(node)).toEqual({
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
  it('loads and focuses locally in single view', async () => {
    H.reset();
    H.setEmbeddedMode(false);
    H.setSplitViewMode('single');
    H.setActiveBoardState(null, null);

    await H.navigateToHierarchyTarget({
      boardId: 'board-local',
      rowIndex: 0,
      stackIndex: 1,
      colLocalIndex: 2
    });

    const state = H.getState();
    expect(state.selectCalls).toEqual([
      { boardId: 'board-local', options: { routeToPane: false } }
    ]);
    expect(state.loadCalls).toEqual(['board-local']);
    expect(state.unfoldCalls).toHaveLength(1);
    expect(state.localFocusCalls).toHaveLength(1);
    expect(state.paneFocusCalls).toEqual([]);
  });

  it('routes focus into the active split pane instead of local view', async () => {
    H.reset();
    H.setEmbeddedMode(false);
    H.setSplitViewMode('vertical');
    H.setActiveSplitPane('b');
    H.setActiveBoardState('board-old', { id: 'board-old' });

    await H.navigateToHierarchyTarget({
      boardId: 'board-split',
      rowIndex: 1
    });

    const state = H.getState();
    expect(state.selectCalls.at(-1)).toEqual({
      boardId: 'board-split',
      options: { pane: 'b' }
    });
    expect(state.paneFocusCalls.at(-1)).toEqual({
      pane: 'b',
      target: { boardId: 'board-split', rowIndex: 1 }
    });
    expect(state.localFocusCalls).toEqual([]);
  });
});
