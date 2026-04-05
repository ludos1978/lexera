import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createMenu(overrides = {}) {
  const windowMock = {
    LexeraMenuContributorRegistry: null,
    LexeraActionRegistry: null,
    prompt: overrides.prompt || vi.fn(() => 'diagram.excalidraw'),
    LexeraTemplates: overrides.templates || {
      getFullTemplate: vi.fn(async () => ({
        parsed: { name: 'Template', variables: [] },
        files: []
      })),
      buildCardFromTemplate: vi.fn(() => ({ content: 'templated card' })),
      buildColumnFromTemplate: vi.fn(() => []),
      buildStackFromTemplate: vi.fn(() => ({ id: 'stack-template', title: 'Template Stack', columns: [] })),
      buildRowFromTemplate: vi.fn(() => ({ id: 'row-template', title: 'Template Row', stacks: [] })),
      applyDefaults: vi.fn((variables, values) => values || {}),
      showVariableDialog: vi.fn(async () => ({}))
    },
    LexeraApi: overrides.api || { request: vi.fn(() => Promise.resolve()) }
  };

  return loadIIFE('menu/rowStackMenu.js', 'LexeraRowStackMenu', {
    window: windowMock,
    navigator: overrides.navigator || { clipboard: { readText: vi.fn(async () => 'clipboard body') } },
    structuredClone,
    Date,
    setTimeout,
    clearTimeout
  });
}

function createBaseDeps() {
  return {
    traceFrontendAction: vi.fn(),
    showNotification: vi.fn(),
    lexeraLog: vi.fn(),
    getActiveBoardId: vi.fn(() => 'board-1'),
    addCardToActiveBoard: vi.fn(async () => true),
    addEmptyCardToActiveBoard: vi.fn(async () => true),
    addRowFromContent: vi.fn(async () => true),
    addStackFromContent: vi.fn(async () => true),
    addColumnFromContent: vi.fn(async () => true),
    applyDefaultCanvasPlacementToStack: vi.fn(),
    persistBoardMutation: vi.fn(async () => true),
    closeColumnContextMenu: vi.fn(),
    closeCardContextMenu: vi.fn()
  };
}

describe('header creation actions', () => {
  it('keeps broad card targets for clipboard card creation', async () => {
    const RowStackMenu = createMenu();
    const deps = createBaseDeps();
    RowStackMenu.init(deps);

    const target = { rowIndex: 2, stackIndex: 1, insertIdx: 0, insertMode: 'full', indexMode: 'display' };
    await RowStackMenu.handleCreationAction('card', 'clipboard', target);

    expect(deps.addCardToActiveBoard).toHaveBeenCalledTimes(1);
    expect(deps.addCardToActiveBoard).toHaveBeenCalledWith(target, 'clipboard body');
  });

  it('keeps broad card targets for template card creation', async () => {
    const templates = {
      getFullTemplate: vi.fn(async () => ({
        parsed: { name: 'Card Template', variables: [] },
        files: []
      })),
      buildCardFromTemplate: vi.fn(() => ({ content: 'templated card' })),
      buildColumnFromTemplate: vi.fn(() => []),
      buildStackFromTemplate: vi.fn(() => ({ id: 'stack-template', title: 'Template Stack', columns: [] })),
      buildRowFromTemplate: vi.fn(() => ({ id: 'row-template', title: 'Template Row', stacks: [] })),
      applyDefaults: vi.fn((variables, values) => values || {}),
      showVariableDialog: vi.fn(async () => ({}))
    };
    const RowStackMenu = createMenu({ templates });
    const deps = createBaseDeps();
    RowStackMenu.init(deps);

    const target = { rowIndex: 4, insertIdx: 0, insertMode: 'full', indexMode: 'display' };
    await RowStackMenu.handleCreationAction('card', 'template:card-template', target);

    expect(templates.getFullTemplate).toHaveBeenCalledWith('card-template');
    expect(deps.addCardToActiveBoard).toHaveBeenCalledTimes(1);
    expect(deps.addCardToActiveBoard).toHaveBeenCalledWith(target, 'templated card');
  });

  it('creates a stack when column clipboard content is dropped on a row target', async () => {
    const RowStackMenu = createMenu();
    const deps = createBaseDeps();
    const row = { id: 'row-1', title: 'Row', stacks: [] };
    deps.findFullDataRow = vi.fn(() => row);
    deps.findInsertStackIndexInRow = vi.fn(() => 0);
    deps.pushUndo = vi.fn();
    RowStackMenu.init(deps);

    await RowStackMenu.handleCreationAction('column', 'clipboard', { rowIdx: 3, atStackIdx: 2 });

    expect(row.stacks).toHaveLength(1);
    expect(row.stacks[0].columns).toHaveLength(1);
    expect(row.stacks[0].columns[0].cards).toHaveLength(1);
    expect(row.stacks[0].columns[0].cards[0].content).toBe('clipboard body');
    expect(deps.persistBoardMutation).toHaveBeenCalledTimes(1);
  });

  it('routes built-in file templates through the generic content insertion path for every entity type', async () => {
    const api = {
      request: vi.fn(() => Promise.resolve()),
      uploadMedia: vi.fn(async (_boardId, file) => ({ filename: 'media/' + file.name }))
    };
    const prompt = vi.fn(() => 'diagram.excalidraw');
    const RowStackMenu = createMenu({ api, prompt });
    const deps = createBaseDeps();
    const fullBoardData = {
      rows: [{
        id: 'row-existing',
        title: 'Existing Row',
        stacks: [{
          id: 'stack-existing',
          title: 'Existing Stack',
          columns: [{ id: 'col-existing', title: 'Existing Column', cards: [] }]
        }]
      }]
    };
    deps.getFullBoardData = vi.fn(() => fullBoardData);
    deps.findFullDataRow = vi.fn((rowIdx) => fullBoardData.rows[rowIdx] || null);
    deps.findFullDataStack = vi.fn((rowIdx, stackIdx) => {
      const row = fullBoardData.rows[rowIdx];
      return row && row.stacks ? row.stacks[stackIdx] || null : null;
    });
    deps.findInsertRowIndex = vi.fn((atIndex) => atIndex);
    deps.findInsertStackIndexInRow = vi.fn((_row, _rowIdx, atStackIdx) => atStackIdx);
    deps.pushUndo = vi.fn();
    RowStackMenu.init(deps);

    await RowStackMenu.handleCreationAction('row', 'template:__builtin__:diagram:excalidraw', { atIndex: 1 });
    await RowStackMenu.handleCreationAction('stack', 'template:__builtin__:diagram:excalidraw', { rowIdx: 0, atStackIdx: 1 });
    await RowStackMenu.handleCreationAction('column', 'template:__builtin__:diagram:excalidraw', { rowIdx: 0, stackIdx: 0, atColIdx: 1 });
    await RowStackMenu.handleCreationAction('card', 'template:__builtin__:diagram:excalidraw', { rowIndex: 0, stackIndex: 0, insertIdx: 0, insertMode: 'full', indexMode: 'display' });

    const embed = '![diagram.excalidraw](media/diagram.excalidraw)';
    expect(prompt).toHaveBeenCalledTimes(4);
    expect(api.uploadMedia).toHaveBeenCalledTimes(4);
    expect(fullBoardData.rows).toHaveLength(2);
    expect(fullBoardData.rows[1].stacks[0].columns[0].cards[0].content).toBe(embed);
    expect(fullBoardData.rows[0].stacks).toHaveLength(2);
    expect(fullBoardData.rows[0].stacks[1].columns[0].cards[0].content).toBe(embed);
    expect(fullBoardData.rows[0].stacks[0].columns).toHaveLength(2);
    expect(fullBoardData.rows[0].stacks[0].columns[1].cards[0].content).toBe(embed);
    expect(deps.addCardToActiveBoard).toHaveBeenCalledWith(
      { rowIndex: 0, stackIndex: 0, insertIdx: 0, insertMode: 'full', indexMode: 'display' },
      embed
    );
    expect(deps.showNotification).not.toHaveBeenCalledWith('Built-in diagram templates are card-only');
  });
});
