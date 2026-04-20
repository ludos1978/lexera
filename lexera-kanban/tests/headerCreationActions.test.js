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
    expect(deps.addCardToActiveBoard).toHaveBeenCalledWith(
      expect.objectContaining({
        rowIndex: 2,
        stackIndex: 1,
        insertIdx: 0,
        atCardIndex: 0,
        insertMode: 'full',
        indexMode: 'display'
      }),
      'clipboard body'
    );
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
    expect(deps.addCardToActiveBoard).toHaveBeenCalledWith(
      expect.objectContaining({
        rowIndex: 4,
        insertIdx: 0,
        atCardIndex: 0,
        insertMode: 'full',
        indexMode: 'display'
      }),
      'templated card'
    );
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
      // Matches the real backend response: `path` is the board-relative URL
      // that the renderer resolves (`{boardStem}-Media/<filename>`), and
      // `filename` is just the basename. The template flow must embed `path`
      // so the renderer can actually locate the uploaded file.
      uploadMedia: vi.fn(async (_boardId, file) => ({
        path: 'board-Media/' + file.name,
        filename: file.name
      }))
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

    // Built-in diagram templates auto-generate a timestamped filename so the
    // drop works without blocking on window.prompt (Tauri's WKWebView returns
    // null from prompt() during pointerup, which silently dropped the flow).
    expect(prompt).not.toHaveBeenCalled();
    expect(api.uploadMedia).toHaveBeenCalledTimes(4);
    expect(fullBoardData.rows).toHaveLength(2);
    // The embed URL must be the `path` from uploadMedia (board-Media/<name>),
    // not the bare filename — otherwise the renderer can't locate the file
    // and falls back to the "preview is rendered through…" placeholder.
    const embedPattern = /^!\[diagram-\d+\.excalidraw\]\(board-Media\/diagram-\d+\.excalidraw\)$/;
    expect(fullBoardData.rows[1].stacks[0].columns[0].cards[0].content).toMatch(embedPattern);
    expect(fullBoardData.rows[0].stacks).toHaveLength(2);
    expect(fullBoardData.rows[0].stacks[1].columns[0].cards[0].content).toMatch(embedPattern);
    expect(fullBoardData.rows[0].stacks[0].columns).toHaveLength(2);
    expect(fullBoardData.rows[0].stacks[0].columns[1].cards[0].content).toMatch(embedPattern);
    expect(deps.addCardToActiveBoard).toHaveBeenCalledWith(
      expect.objectContaining({
        rowIndex: 0,
        stackIndex: 0,
        insertIdx: 0,
        atCardIndex: 0,
        insertMode: 'full',
        indexMode: 'display'
      }),
      expect.stringMatching(embedPattern)
    );
    expect(deps.showNotification).not.toHaveBeenCalledWith('Built-in diagram templates are card-only');
  });

  it('embeds the media-folder path (not just filename) so the renderer can locate the uploaded file', async () => {
    // Regression: the built-in diagram flow used to embed `result.filename`
    // directly. The backend stores files under `{boardStem}-Media/` and
    // returns `{ path: "<stem>-Media/<name>", filename: "<name>" }`; without
    // the folder prefix the renderer can't find the file and the card shows
    // the "preview is rendered through the integrated export worker" stub.
    const api = {
      request: vi.fn(() => Promise.resolve()),
      uploadMedia: vi.fn(async (_boardId, file) => ({
        path: 'myboard-Media/' + file.name,
        filename: file.name
      }))
    };
    const RowStackMenu = createMenu({ api });
    const deps = createBaseDeps();
    RowStackMenu.init(deps);

    await RowStackMenu.handleCreationAction(
      'card',
      'template:__builtin__:diagram:drawio',
      { rowIndex: 0, stackIndex: 0, insertIdx: 0, insertMode: 'full', indexMode: 'display' }
    );

    expect(api.uploadMedia).toHaveBeenCalledTimes(1);
    const callArg = deps.addCardToActiveBoard.mock.calls[0][1];
    expect(callArg).toMatch(/^!\[diagram-\d+\.drawio\]\(myboard-Media\/diagram-\d+\.drawio\)$/);
    // Must not fall back to the bare filename when `path` is provided.
    expect(callArg).not.toMatch(/\]\(diagram-\d+\.drawio\)$/);
  });

  it('falls back to filename when uploadMedia omits path', async () => {
    const api = {
      request: vi.fn(() => Promise.resolve()),
      uploadMedia: vi.fn(async (_boardId, file) => ({ filename: file.name }))
    };
    const RowStackMenu = createMenu({ api });
    const deps = createBaseDeps();
    RowStackMenu.init(deps);

    await RowStackMenu.handleCreationAction(
      'card',
      'template:__builtin__:diagram:excalidraw',
      { rowIndex: 0, stackIndex: 0, insertIdx: 0, insertMode: 'full', indexMode: 'display' }
    );

    const callArg = deps.addCardToActiveBoard.mock.calls[0][1];
    expect(callArg).toMatch(/^!\[diagram-\d+\.excalidraw\]\(diagram-\d+\.excalidraw\)$/);
  });

  // ── Built-in draw.io and excalidraw drag sources must create empty boards ──
  // The top-row "+ new" dropdown exposes both built-ins as draggable card
  // sources. Dragging them has to drop a brand-new *empty* diagram file into
  // the board: a minimal mxfile for draw.io (two mandatory structural
  // mxCells, no shapes) and a minimal excalidraw JSON with an empty
  // elements array.

  it('exposes an empty draw.io diagram for the built-in drag source', () => {
    const RowStackMenu = createMenu();
    RowStackMenu.init(createBaseDeps());
    const spec = RowStackMenu.getBuiltInDiagramTemplateSpec('__builtin__:diagram:drawio');
    expect(spec).toBeTruthy();
    expect(spec.displayName).toBe('Draw.io');
    expect(spec.extension).toBe('.drawio');
    expect(spec.mimeType).toBe('application/vnd.jgraph.mxfile');

    // Use regex parsing so the test works in every vitest env (no DOMParser
    // on the server). An empty draw.io board has exactly two structural
    // mxCell entries inside <root> and zero shape/edge cells.
    expect(spec.content).toMatch(/<mxfile\b/);
    expect(spec.content).toMatch(/<diagram\b/);
    const rootMatch = spec.content.match(/<root\b[^>]*>([\s\S]*?)<\/root>/);
    expect(rootMatch).not.toBeNull();
    const rootBody = rootMatch[1];
    const cellMatches = rootBody.match(/<mxCell\b[^>]*\/?>/g) || [];
    expect(cellMatches).toHaveLength(2);
    expect(rootBody).toMatch(/<mxCell[^>]*\bid="0"[^>]*\/?>/);
    expect(rootBody).toMatch(/<mxCell[^>]*\bid="1"[^>]*\bparent="0"[^>]*\/?>/);
    // No shape or edge cells in a blank board.
    expect(rootBody).not.toMatch(/\bvertex="1"/);
    expect(rootBody).not.toMatch(/\bedge="1"/);
  });

  it('exposes an empty excalidraw diagram for the built-in drag source', () => {
    const RowStackMenu = createMenu();
    RowStackMenu.init(createBaseDeps());
    const spec = RowStackMenu.getBuiltInDiagramTemplateSpec('__builtin__:diagram:excalidraw');
    expect(spec).toBeTruthy();
    expect(spec.displayName).toBe('Excalidraw');
    expect(spec.extension).toBe('.excalidraw');
    expect(spec.mimeType).toBe('application/json');

    const data = JSON.parse(spec.content);
    expect(data.type).toBe('excalidraw');
    expect(typeof data.version).toBe('number');
    expect(data.version).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(data.elements)).toBe(true);
    expect(data.elements).toHaveLength(0);
    expect(data.appState && typeof data.appState).toBe('object');
    expect(data.files && typeof data.files).toBe('object');
    expect(Object.keys(data.files)).toHaveLength(0);
  });
});
