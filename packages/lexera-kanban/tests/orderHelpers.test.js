import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

let OrderHelpers;
let localStorageMock;
let renderBoardList;

function createStorage(initialValues = {}) {
  const store = { ...initialValues };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    }
  };
}

beforeAll(() => {
  OrderHelpers = loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers', {
    window: {},
    document: {}
  });
});

beforeEach(() => {
  localStorageMock = createStorage();
  renderBoardList = vi.fn();
  globalThis.localStorage = localStorageMock;
  OrderHelpers.init({
    boards: [
      { id: 'board-a', title: 'A' },
      { id: 'board-b', title: 'B' },
      { id: 'board-c', title: 'C' }
    ],
    renderBoardList
  });
});

describe('orderHelpers.reorderBoards', () => {
  it('reorders persisted board order by board id', () => {
    localStorageMock.setItem('lexera-board-order', JSON.stringify(['board-a', 'board-b', 'board-c']));

    OrderHelpers.reorderBoards('board-c', 'board-a', true);

    expect(localStorageMock.getItem('lexera-board-order')).toBe(JSON.stringify(['board-c', 'board-a', 'board-b']));
    expect(renderBoardList).toHaveBeenCalledTimes(1);
  });

  it('ignores invalid numeric refs instead of saving undefined entries', () => {
    localStorageMock.setItem('lexera-board-order', JSON.stringify(['board-a', 'board-b', 'board-c']));

    expect(() => OrderHelpers.reorderBoards(9, 0, true)).not.toThrow();
    expect(localStorageMock.getItem('lexera-board-order')).toBe(JSON.stringify(['board-a', 'board-b', 'board-c']));
    expect(renderBoardList).not.toHaveBeenCalled();
  });
});
