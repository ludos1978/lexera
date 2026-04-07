import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createRowStackMenu() {
  return loadIIFE('menu/rowStackMenu.js', 'LexeraRowStackMenu', {
    window: {
      LexeraMenuContributorRegistry: {
        buildMenu: vi.fn(() => [])
      },
      LexeraActionRegistry: {
        dispatch: vi.fn(() => true)
      },
      LexeraTemplates: {},
      LexeraApi: {},
      prompt: vi.fn(() => '')
    },
    structuredClone,
    Date,
    setTimeout,
    clearTimeout
  });
}

function buildBoardFixture() {
  const fullColumn = {
    id: 'col-todo',
    index: 5,
    title: 'Todo',
    cards: [
      { id: 'card-a', content: 'Task A' },
      { id: 'card-b', content: 'Task B' }
    ]
  };
  const fullStack = {
    id: 'stack-active',
    title: 'Active',
    columns: [fullColumn]
  };
  const fullRow = {
    id: 'row-main',
    title: 'Main',
    stacks: [fullStack]
  };
  const secondRow = {
    id: 'row-secondary',
    title: 'Secondary',
    stacks: [{
      id: 'stack-secondary',
      title: 'Secondary Stack',
      columns: [{
        id: 'col-secondary',
        index: 9,
        title: 'Secondary Column',
        cards: []
      }]
    }]
  };
  const fullBoardData = {
    rows: [fullRow, secondRow]
  };
  const activeBoardData = {
    rows: [{
      id: 'row-main',
      title: 'Main',
      stacks: [{
        id: 'stack-active',
        title: 'Active',
        columns: [{
          id: 'col-todo',
          index: 5,
          title: 'Todo',
          cards: [
            { id: 'card-a', content: 'Task A' },
            { id: 'card-b', content: 'Task B' }
          ]
        }]
      }]
    }, {
      id: 'row-secondary',
      title: 'Secondary',
      stacks: [{
        id: 'stack-secondary',
        title: 'Secondary Stack',
        columns: [{
          id: 'col-secondary',
          index: 9,
          title: 'Secondary Column',
          cards: []
        }]
      }]
    }],
    columns: [{
      id: 'col-todo',
      index: 5,
      title: 'Todo',
      cards: [
        { id: 'card-a', content: 'Task A' },
        { id: 'card-b', content: 'Task B' }
      ]
    }, {
      id: 'col-secondary',
      index: 9,
      title: 'Secondary Column',
      cards: []
    }]
  };

  return { fullColumn, fullStack, fullRow, secondRow, fullBoardData, activeBoardData };
}

function initRowStackMenu(RowStackMenu, fixture, overrides = {}) {
  const deps = {
    getActiveBoardData: () => fixture.activeBoardData,
    getFullBoardData: () => fixture.fullBoardData,
    getActiveBoardId: () => 'board-1',
    getFullColumn: (index) => (index === 5 ? fixture.fullColumn : null),
    getFullCardIndex: (_column, visibleIndex) => visibleIndex,
    findFullDataRow: (rowIdx) => fixture.fullBoardData.rows[rowIdx] || null,
    findFullDataStack: (rowIdx, stackIdx) => {
      const row = fixture.fullBoardData.rows[rowIdx];
      return row && row.stacks ? row.stacks[stackIdx] || null : null;
    },
    findInsertRowIndex: (atIndex) => atIndex,
    findInsertStackIndexInRow: (_row, _rowIdx, atStackIdx) => atStackIdx,
    pushUndo: vi.fn(),
    persistBoardMutation: vi.fn(async () => true),
    showNotification: vi.fn(),
    lexeraLog: vi.fn(),
    traceFrontendAction: vi.fn(),
    addEmptyCardToActiveBoard: vi.fn(async () => true),
    getColumnLayoutTags: () => ({ stack: false, span: null }),
    extractIncludePathFromTitle: () => '',
    getColumnSortState: () => ({})
  };
  Object.assign(deps, overrides);
  RowStackMenu.init(deps);
  return deps;
}

describe('rowStackMenu stable-id context normalization', () => {
  it('resolves column contexts by stable ids before stale display indices', () => {
    const RowStackMenu = createRowStackMenu();
    const fixture = buildBoardFixture();
    initRowStackMenu(RowStackMenu, fixture);

    const context = RowStackMenu.buildEnrichedContext('column', {
      rowIdx: 9,
      stackIdx: 8,
      colLocalIdx: 7,
      colIndex: -1,
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo'
    });

    expect(context).toMatchObject({
      rowIdx: 0,
      stackIdx: 0,
      colLocalIdx: 0,
      colIndex: 5,
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo',
      elementText: 'Todo'
    });
  });

  it('resolves card contexts by stable ids before stale visible indices', () => {
    const RowStackMenu = createRowStackMenu();
    const fixture = buildBoardFixture();
    initRowStackMenu(RowStackMenu, fixture);

    const context = RowStackMenu.buildEnrichedContext('card', {
      rowIdx: 9,
      stackIdx: 8,
      colLocalIdx: 7,
      colIndex: 99,
      cardIndex: 42,
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo',
      cardId: 'card-b'
    });

    expect(context).toMatchObject({
      rowIdx: 0,
      stackIdx: 0,
      colLocalIdx: 0,
      colIndex: 5,
      cardIndex: 1,
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo',
      cardId: 'card-b',
      elementText: 'Task B',
      visibleCardCount: 2
    });
  });

  it('resolves stack contexts by stable ids before stale display indices', () => {
    const RowStackMenu = createRowStackMenu();
    const fixture = buildBoardFixture();
    initRowStackMenu(RowStackMenu, fixture);

    const context = RowStackMenu.buildEnrichedContext('stack', {
      rowIdx: 12,
      stackIdx: 11,
      rowId: 'row-main',
      stackId: 'stack-active'
    });

    expect(context).toMatchObject({
      rowIdx: 0,
      stackIdx: 0,
      rowId: 'row-main',
      stackId: 'stack-active',
      elementText: 'Active'
    });
  });

  it('normalizes row creation targets by stable row id before stale insert indices', () => {
    const RowStackMenu = createRowStackMenu();
    const fixture = buildBoardFixture();
    initRowStackMenu(RowStackMenu, fixture);

    const context = RowStackMenu.normalizeCreationContextForEntity('row', {
      atIndex: 99,
      rowId: 'row-secondary',
      before: true
    });

    expect(context).toMatchObject({
      atIndex: 1,
      rowId: 'row-secondary',
      before: true
    });
  });

  it('normalizes stack creation targets by stable ids before stale display indices', () => {
    const RowStackMenu = createRowStackMenu();
    const fixture = buildBoardFixture();
    initRowStackMenu(RowStackMenu, fixture);

    const context = RowStackMenu.normalizeCreationContextForEntity('stack', {
      rowIdx: 99,
      atStackIdx: 42,
      rowId: 'row-main',
      stackId: 'stack-active',
      before: true
    });

    expect(context).toMatchObject({
      rowIdx: 0,
      rowIndex: 0,
      atStackIdx: 0,
      rowId: 'row-main',
      stackId: 'stack-active',
      before: true
    });
  });

  it('normalizes column creation targets by stable ids before stale indices', () => {
    const RowStackMenu = createRowStackMenu();
    const fixture = buildBoardFixture();
    initRowStackMenu(RowStackMenu, fixture);

    const context = RowStackMenu.normalizeCreationContextForEntity('column', {
      rowIdx: 99,
      stackIdx: 98,
      atColIdx: 77,
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo',
      before: true
    });

    expect(context).toMatchObject({
      rowIdx: 0,
      rowIndex: 0,
      stackIdx: 0,
      stackIndex: 0,
      colLocalIdx: 0,
      colIndex: 0,
      flatColIndex: 5,
      atColIdx: 0,
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo',
      before: true
    });
  });

  it('normalizes card creation targets by stable ids before stale indices', () => {
    const RowStackMenu = createRowStackMenu();
    const fixture = buildBoardFixture();
    initRowStackMenu(RowStackMenu, fixture);

    const context = RowStackMenu.normalizeCreationContextForEntity('card', {
      rowIndex: 99,
      stackIndex: 98,
      colIndex: 97,
      insertIdx: 44,
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo',
      cardId: 'card-b',
      before: true
    });

    expect(context).toMatchObject({
      rowIndex: 0,
      stackIndex: 0,
      colIndex: 0,
      flatColIndex: 5,
      cardIndex: 1,
      insertIdx: 1,
      atCardIndex: 1,
      insertMode: 'visible',
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo',
      cardId: 'card-b',
      before: true
    });
  });

  it('uses normalized stable card targets when dispatching creation actions', async () => {
    const RowStackMenu = createRowStackMenu();
    const fixture = buildBoardFixture();
    const deps = initRowStackMenu(RowStackMenu, fixture);

    await RowStackMenu.handleCreationAction('card', 'empty', {
      rowIndex: 99,
      stackIndex: 98,
      colIndex: 97,
      insertIdx: 44,
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo',
      cardId: 'card-b',
      before: true
    });

    expect(deps.addEmptyCardToActiveBoard).toHaveBeenCalledTimes(1);
    expect(deps.addEmptyCardToActiveBoard).toHaveBeenCalledWith(
      expect.objectContaining({
        rowIndex: 0,
        stackIndex: 0,
        colIndex: 0,
        flatColIndex: 5,
        insertIdx: 1,
        atCardIndex: 1,
        insertMode: 'visible',
        rowId: 'row-main',
        stackId: 'stack-active',
        columnId: 'col-todo',
        cardId: 'card-b',
        before: true
      }),
      1,
      'visible'
    );
  });
});
