import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BoardNavigation = require('../src/navigation/boardNavigation.js');

let searchInput;
let state;

function resetState() {
  searchInput = null;
  state = {
    embeddedMode: false,
    splitViewMode: 'single',
    activeBoardId: null,
    activeBoardData: null,
    exitCount: 0,
    selectCalls: [],
    loadCalls: [],
    unfoldCalls: [],
    notifications: [],
    focusResult: true,
  };
}

function buildOptions() {
  return {
    searchInput,
    exitSearchMode() {
      state.exitCount += 1;
    },
    async selectBoard(boardId) {
      state.selectCalls.push(boardId);
      state.activeBoardId = boardId;
    },
    embeddedMode: state.embeddedMode,
    splitViewMode: state.splitViewMode,
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
    unfoldSearchTarget(result) {
      state.unfoldCalls.push(result);
    },
    focusSearchResultCard() {
      return state.focusResult;
    },
    showNotification(message) {
      state.notifications.push(message);
    },
    lexeraLog() {}
  };
}

beforeEach(() => {
  resetState();
});

describe('navigateToSearchResult', () => {
  it('does not crash when the global search input is missing', async () => {
    searchInput = null;

    await expect(BoardNavigation.navigateToSearchResult({
      boardId: 'board-1',
      columnIndex: 0,
      cardId: 'card-1',
    }, buildOptions())).resolves.toBeUndefined();

    expect(state.exitCount).toBe(1);
    expect(state.selectCalls).toEqual(['board-1']);
    expect(state.loadCalls).toEqual(['board-1']);
    expect(state.unfoldCalls).toHaveLength(1);
    expect(state.notifications).toEqual([]);
  });

  it('clears the global search input when present', async () => {
    searchInput = { value: 'todo' };

    await BoardNavigation.navigateToSearchResult({
      boardId: 'board-2',
      columnIndex: 0,
      cardId: 'card-2',
    }, buildOptions());

    expect(searchInput.value).toBe('');
  });
});
