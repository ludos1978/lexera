// @vitest-environment jsdom
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
  it('renders a header slot for the export processes control beside Export', () => {
    document.body.innerHTML = '<div id="board-header" class="board-header"></div>';
    // boardHeader.renderBoardHeader delegates the file/title label to
    // window.LexeraTitleHelpers.resolveBoardLabel, so titleHelpers.js
    // must be loaded into the same window first.
    loadIIFE('titleHelpers.js', 'LexeraTitleHelpers', {
      window: window,
      globalThis: window
    });
    const BoardHeader = loadIIFE('board/boardHeader.js', 'LexeraBoardHeader', {
      window: window,
      document: document
    });
    BoardHeader.init({
      BURGER_MENU_ICON_HTML: 'menu',
      getIncomingCount: () => 0,
      getParkedCount: () => 0,
      getArchivedCount: () => 0,
      getDeletedCount: () => 0,
      getActiveBoardFilePath: () => '/boards/demo.md',
      getActiveBoardData: () => ({ title: 'Demo' }),
      getActiveBoardId: () => 'board-1',
      getConnected: () => true,
      getEmbeddedMode: () => false,
      getDisplayFileNameFromPath: () => 'demo.md',
      escapeAttr: (value) => String(value == null ? '' : value).replace(/"/g, '&quot;'),
      escapeHtml: (value) => String(value == null ? '' : value),
      getElBoardHeader: () => document.getElementById('board-header'),
      applyTagStyleToEntity: vi.fn(),
      loadTemplatesOnce: vi.fn(),
      areAllColumnsFolded: () => false,
      areAllCardsCollapsed: () => false,
      isCanvasBoardLayout: () => false,
      isBoardDirty: () => false,
      getHeaderSavingInProgress: () => false,
      getFullBoardData: () => ({ rows: [] }),
      handleBoardAction: vi.fn(),
      showSaveTrackingMenu: vi.fn(),
      showThemeZoomMenu: vi.fn(),
      showHeaderSourceDropdown: vi.fn(),
      showIncomingItems: vi.fn(),
      triggerBoardExport: vi.fn(),
      showParkedItems: vi.fn(),
      showArchivedItems: vi.fn(),
      showDeletedItems: vi.fn(),
      showBoardContextMenu: vi.fn()
    });

    BoardHeader.renderBoardHeader();

    const slot = document.getElementById('board-export-processes-slot');
    expect(slot).toBeTruthy();
    expect(slot.classList.contains('board-export-processes-slot')).toBe(true);
    expect(slot.previousElementSibling?.id).toBe('btn-export');
  });

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
