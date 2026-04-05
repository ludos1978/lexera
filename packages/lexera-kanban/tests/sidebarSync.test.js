import { beforeEach, describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createSidebarSync() {
  return loadIIFE('sidebar/sidebarSync.js', 'LexeraSidebarSync', {
    document: {
      getElementById() {
        return null;
      }
    },
    localStorage: globalThis.localStorage
  });
}

function createClassList(initial) {
  const classes = new Set(Array.isArray(initial) ? initial : []);
  return {
    add(name) {
      classes.add(name);
    },
    remove(name) {
      classes.delete(name);
    },
    contains(name) {
      return classes.has(name);
    }
  };
}

function createTreeNode() {
  return {
    classList: createClassList([]),
    parentElement: null,
    scrollIntoView() {}
  };
}

function createBoardList(selectorMap) {
  const boardList = {
    querySelector(selector) {
      if (selector === '.sync-highlight') {
        const selectors = Object.keys(selectorMap);
        for (let i = 0; i < selectors.length; i += 1) {
          const node = selectorMap[selectors[i]];
          if (node && node.classList && node.classList.contains('sync-highlight')) return node;
        }
        return null;
      }
      return Object.prototype.hasOwnProperty.call(selectorMap, selector) ? selectorMap[selector] : null;
    }
  };

  Object.keys(selectorMap).forEach((selector) => {
    if (selectorMap[selector]) selectorMap[selector].parentElement = boardList;
  });

  return boardList;
}

function createAttrNode(attrs) {
  const map = Object.assign({}, attrs);
  return {
    isConnected: true,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null;
    }
  };
}

beforeEach(() => {
  globalThis.localStorage = {
    getItem(key) {
      if (key === 'lexera-sidebar-sync') return 'true';
      if (key === 'lexera-hierarchy-locked') return 'false';
      return null;
    },
    setItem() {},
    removeItem() {}
  };
});

describe('SidebarSync.syncSidebarToView', () => {
  it('highlights a focused card by stable card id before visible index fallback', () => {
    const SidebarSync = createSidebarSync();
    const idNode = createTreeNode();
    const indexNode = createTreeNode();
    const boardList = createBoardList({
      '.tree-card[data-card-id="card-b"]': idNode,
      '.tree-card[data-col-index="0"][data-card-index="0"]': indexNode
    });

    SidebarSync.init({
      getFocusedCardEl() {
        return createAttrNode({
          'data-card-id': 'card-b',
          'data-col-index': '0',
          'data-card-index': '0'
        });
      },
      getElBoardList() {
        return boardList;
      },
      getElColumnsContainer() {
        return null;
      }
    });

    SidebarSync.syncSidebarToView();

    expect(idNode.classList.contains('sync-highlight')).toBe(true);
    expect(indexNode.classList.contains('sync-highlight')).toBe(false);
  });

  it('highlights the first visible column by stable column id before flat index fallback', () => {
    const SidebarSync = createSidebarSync();
    const idNode = createTreeNode();
    const indexNode = createTreeNode();
    const boardList = createBoardList({
      '.tree-column[data-column-id="col-b"]': idNode,
      '.tree-column[data-col-index="5"]': indexNode
    });

    const columnCards = createAttrNode({
      'data-column-id': 'col-b',
      'data-col-index': '5'
    });
    const column = {
      getBoundingClientRect() {
        return { left: 10, right: 210 };
      },
      querySelector(selector) {
        return selector === '.column-cards' ? columnCards : null;
      },
      getAttribute(name) {
        if (name === 'data-column-id') return 'col-b';
        return null;
      }
    };
    const container = {
      getBoundingClientRect() {
        return { left: 0, right: 400 };
      },
      addEventListener() {},
      querySelectorAll(selector) {
        return selector === '.column' ? [column] : [];
      }
    };

    SidebarSync.init({
      getFocusedCardEl() {
        return null;
      },
      getElBoardList() {
        return boardList;
      },
      getElColumnsContainer() {
        return container;
      }
    });

    SidebarSync.syncSidebarToView();

    expect(idNode.classList.contains('sync-highlight')).toBe(true);
    expect(indexNode.classList.contains('sync-highlight')).toBe(false);
  });
});
