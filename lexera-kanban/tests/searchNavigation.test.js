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

// Minimal DOM helper: creates a .card element with data attributes
function makeCard(opts) {
  const el = { className: 'card', classList: { contains: (c) => c === 'card' }, _attrs: {} };
  el.getAttribute = (k) => el._attrs[k] || null;
  el.querySelector = () => null; // no child elements in test cards
  Object.assign(el._attrs, opts);
  return el;
}

// Minimal container that supports querySelector and querySelectorAll
function makeContainer(cards) {
  return {
    querySelector(sel) {
      return cards.find(c => matchesSimpleSelector(sel, c)) || null;
    },
    querySelectorAll(sel) {
      return cards.filter(c => matchesSimpleSelector(sel, c));
    }
  };
}

// Very small subset of CSS selector matching used by focusSearchResultCard
function matchesSimpleSelector(sel, el) {
  // Handles: .class[attr="val"][attr2="val2"] patterns
  const classMatch = sel.match(/^\.card/);
  if (!classMatch) return false;
  const attrMatches = [...sel.matchAll(/\[([^\]="]+)="([^"]*)"\]/g)];
  return attrMatches.every(([, attr, val]) => el.getAttribute(attr) === val);
}

describe('focusSearchResultCard', () => {
  it('finds card by cardId (Priority 1)', () => {
    const card = makeCard({ 'data-card-id': 'abc', 'data-col-index': '2', 'data-card-index': '0' });
    const focused = [];
    const result = BoardNavigation.focusSearchResultCard(
      { cardId: 'abc', columnIndex: 2, cardIndex: 0 },
      { getColumnsContainer: () => makeContainer([card]), escapeAttr: String, focusCard: (el) => focused.push(el) }
    );
    expect(result).toBe(true);
    expect(focused).toHaveLength(1);
    expect(focused[0]).toBe(card);
  });

  it('finds card by columnIndex + cardIndex when cardId is absent (Priority 2)', () => {
    const card = makeCard({ 'data-card-id': 'xyz', 'data-col-index': '3', 'data-card-index': '1' });
    const focused = [];
    const result = BoardNavigation.focusSearchResultCard(
      { cardId: null, columnIndex: 3, cardIndex: 1 },
      { getColumnsContainer: () => makeContainer([card]), escapeAttr: String, focusCard: (el) => focused.push(el) }
    );
    expect(result).toBe(true);
    expect(focused[0]).toBe(card);
  });

  it('falls back to first card in column when no title or cardIndex match (Priority 3)', () => {
    const card0 = makeCard({ 'data-card-id': 'c0', 'data-col-index': '1', 'data-card-index': '0' });
    const card1 = makeCard({ 'data-card-id': 'c1', 'data-col-index': '1', 'data-card-index': '1' });
    const focused = [];
    const result = BoardNavigation.focusSearchResultCard(
      { cardId: null, columnIndex: 1 },
      { getColumnsContainer: () => makeContainer([card0, card1]), escapeAttr: String, focusCard: (el) => focused.push(el) }
    );
    expect(result).toBe(true);
    expect(focused[0]).toBe(card0);
  });

  it('returns false when no cards match', () => {
    const result = BoardNavigation.focusSearchResultCard(
      { cardId: 'missing', columnIndex: 99, cardIndex: 0 },
      { getColumnsContainer: () => makeContainer([]), escapeAttr: String, focusCard: () => {} }
    );
    expect(result).toBe(false);
  });

  // Regression (TODO: "dashboard links point to a different card"): the
  // dashboard dataset can diverge from the live CRDT board, so the
  // ephemeral data-card-id and the positional col/card index point at the
  // WRONG card. The stable kid must win (Priority 0). Here cardId 'stale'
  // and columnIndex/cardIndex resolve to the wrong card, but cardKid must
  // pick the right one.
  it('prefers the stable cardKid over a drifted cardId / position (Priority 0)', () => {
    const wrongCard = makeCard({ 'data-card-kid': 'kid-wrong', 'data-card-id': 'stale', 'data-col-index': '1', 'data-card-index': '0' });
    const rightCard = makeCard({ 'data-card-kid': 'kid-right', 'data-card-id': 'fresh', 'data-col-index': '4', 'data-card-index': '2' });
    const focused = [];
    const result = BoardNavigation.focusSearchResultCard(
      { cardKid: 'kid-right', cardId: 'stale', columnIndex: 1, cardIndex: 0 },
      { getColumnsContainer: () => makeContainer([wrongCard, rightCard]), escapeAttr: String, focusCard: (el) => focused.push(el) }
    );
    expect(result).toBe(true);
    expect(focused).toHaveLength(1);
    expect(focused[0]).toBe(rightCard);
  });

  it('falls back to cardId when the cardKid is not in the DOM (kid-less / pre-save card)', () => {
    const card = makeCard({ 'data-card-id': 'abc', 'data-col-index': '2', 'data-card-index': '0' });
    const focused = [];
    const result = BoardNavigation.focusSearchResultCard(
      { cardKid: 'kid-not-rendered', cardId: 'abc', columnIndex: 2, cardIndex: 0 },
      { getColumnsContainer: () => makeContainer([card]), escapeAttr: String, focusCard: (el) => focused.push(el) }
    );
    expect(result).toBe(true);
    expect(focused[0]).toBe(card);
  });
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
