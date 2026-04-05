import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createBoardHeader() {
  return loadIIFE('board/boardHeader.js', 'LexeraBoardHeader', {
    window: {
      addEventListener: vi.fn()
    },
    document: {}
  });
}

function makeAttrNode(attrs, rect) {
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    getBoundingClientRect() {
      return rect || { top: 0, height: 20 };
    }
  };
}

describe('board header creation target synthesis', () => {
  it('preserves stable ids for card creation targets', () => {
    const BoardHeader = createBoardHeader();
    BoardHeader.init({
      getActiveBoardId: () => 'board-1',
      getFullBoardData: () => ({ rows: [] }),
      resolveCardDropTarget: () => ({
        boardId: 'board-1',
        flatColIndex: 5,
        rowIndex: 2,
        stackIndex: 3,
        colIndex: 4,
        rowId: 'row-main',
        stackId: 'stack-active',
        columnId: 'col-todo',
        cardId: 'card-b',
        before: true,
        insertIdx: 1,
        insertMode: 'visible'
      })
    });

    expect(BoardHeader.resolveHeaderCardCreationContext(10, 20)).toEqual({
      flatColIndex: 5,
      rowIndex: 2,
      stackIndex: 3,
      colIndex: 4,
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo',
      cardId: 'card-b',
      before: true,
      atCardIndex: 1,
      insertMode: 'visible'
    });
  });

  it('preserves stable ids for column creation targets', () => {
    const BoardHeader = createBoardHeader();
    const columnNode = makeAttrNode({
      'data-row-index': '9',
      'data-stack-index': '8',
      'data-col-local-index': '7',
      'data-row-id': 'row-main',
      'data-stack-id': 'stack-active',
      'data-column-id': 'col-todo'
    }, { top: 0, height: 20 });

    BoardHeader.init({
      getActiveBoardId: () => 'board-1',
      getFullBoardData: () => ({ rows: [] }),
      findDraggableColumnAt: () => columnNode,
      findFullDataStack: () => ({ columns: [] }),
      findInsertColumnIndexInStack: (_stack, _displayColIdx, before) => (before ? 0 : 1),
      findBoardStackAt: () => null,
      getTreeColumnDropTarget: () => null,
      getTreeStackDropTarget: () => null,
      resolveRowBodyDropTarget: () => null,
      getRowDropTarget: () => null,
      getElColumnsContainer: () => ({ getBoundingClientRect: () => ({}) }),
      isPointInsideRect: () => false
    });

    expect(BoardHeader.resolveHeaderColumnCreationContext(10, 5)).toEqual({
      rowIdx: 9,
      stackIdx: 8,
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo',
      before: true,
      atColIdx: 0
    });
  });

  it('preserves stable ids for stack creation targets', () => {
    const BoardHeader = createBoardHeader();
    BoardHeader.init({
      getActiveBoardId: () => 'board-1',
      getStackDropTarget: () => ({
        boardId: 'board-1',
        rowIndex: 6,
        stackIndex: 4,
        rowId: 'row-main',
        stackId: 'stack-active',
        before: false
      })
    });

    expect(BoardHeader.resolveHeaderStackCreationContext(10, 20)).toEqual({
      rowIdx: 6,
      rowId: 'row-main',
      stackId: 'stack-active',
      before: false,
      atStackIdx: 5
    });
  });

  it('preserves stable ids for row creation targets', () => {
    const BoardHeader = createBoardHeader();
    BoardHeader.init({
      getActiveBoardId: () => 'board-1',
      getRowDropTarget: () => ({
        boardId: 'board-1',
        rowIndex: 3,
        rowId: 'row-secondary',
        before: true
      }),
      getElColumnsContainer: () => ({ getBoundingClientRect: () => ({}) }),
      isPointInsideRect: () => false
    });

    expect(BoardHeader.resolveHeaderRowCreationContext(10, 20)).toEqual({
      atIndex: 3,
      rowId: 'row-secondary',
      before: true
    });
  });
});
