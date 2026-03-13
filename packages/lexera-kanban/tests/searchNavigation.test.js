import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadSearchNavigationHarness() {
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

  const navigateToSearchResultDef = extractFunction(findLine('async function navigateToSearchResult('));

  const wrappedSource = `
    var $searchInput = null;
    var embeddedMode = false;
    var splitViewMode = 'single';
    var activeBoardId = null;
    var activeBoardData = null;
    var exitCount = 0;
    var selectCalls = [];
    var loadCalls = [];
    var unfoldCalls = [];
    var notifications = [];
    var focusResult = true;

    function exitSearchMode() { exitCount++; }
    async function selectBoard(boardId) {
      selectCalls.push(boardId);
      activeBoardId = boardId;
    }
    async function loadBoard(boardId) {
      loadCalls.push(boardId);
      activeBoardId = boardId;
      activeBoardData = { id: boardId };
    }
    function unfoldSearchTarget(result) { unfoldCalls.push(result); }
    function focusSearchResultCard() { return focusResult; }
    function showNotification(message) { notifications.push(message); }
    function lexeraLog() {}

    ${navigateToSearchResultDef}

    return {
      setSearchInput: function (input) { $searchInput = input; },
      setActiveBoardState: function (boardId, boardData) {
        activeBoardId = boardId;
        activeBoardData = boardData;
      },
      setFocusResult: function (value) { focusResult = value; },
      getState: function () {
        return {
          exitCount: exitCount,
          selectCalls: selectCalls.slice(),
          loadCalls: loadCalls.slice(),
          unfoldCalls: unfoldCalls.slice(),
          notifications: notifications.slice(),
          activeBoardId: activeBoardId,
          activeBoardData: activeBoardData,
        };
      },
      navigateToSearchResult: navigateToSearchResult,
    };
  `;

  return new Function(wrappedSource)();
}

let H;

beforeAll(() => {
  H = loadSearchNavigationHarness();
});

describe('navigateToSearchResult', () => {
  it('does not crash when the global search input is missing', async () => {
    H.setSearchInput(null);
    H.setActiveBoardState(null, null);

    await expect(H.navigateToSearchResult({
      boardId: 'board-1',
      columnIndex: 0,
      cardId: 'card-1',
    })).resolves.toBeUndefined();

    const state = H.getState();
    expect(state.exitCount).toBe(1);
    expect(state.selectCalls).toEqual(['board-1']);
    expect(state.loadCalls).toEqual(['board-1']);
    expect(state.unfoldCalls).toHaveLength(1);
    expect(state.notifications).toEqual([]);
  });

  it('clears the global search input when present', async () => {
    const input = { value: 'todo' };
    H.setSearchInput(input);
    H.setActiveBoardState(null, null);

    await H.navigateToSearchResult({
      boardId: 'board-2',
      columnIndex: 0,
      cardId: 'card-2',
    });

    expect(input.value).toBe('');
  });
});
