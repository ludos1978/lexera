import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadBoardCleanupFunctions() {
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

  const fnDefs = [
    extractFunction(findLine('function getRowByLocationInBoard(')),
    extractFunction(findLine('function getStackByLocationInBoard(')),
    extractFunction(findLine('function getColumnByLocationInBoard(')),
    extractFunction(findLine('function getCardByLocationInBoard(')),
    extractFunction(findLine('function collectHiddenItemsFromBoardData(')),
    extractFunction(findLine('function getBoardCleanupState(')),
    extractFunction(findLine('function normalizeBoardCleanupAction(')),
    extractFunction(findLine('function isBoardCleanupActionApplicable(')),
    extractFunction(findLine('function sortHiddenItemsForRemoval(')),
    extractFunction(findLine('function removeHiddenItemsFromBoardData(')),
  ];

  const wrappedSource = `
    ${fnDefs.join('\n\n')}
    return {
      collectHiddenItemsFromBoardData,
      getBoardCleanupState,
      normalizeBoardCleanupAction,
      isBoardCleanupActionApplicable,
      sortHiddenItemsForRemoval,
      removeHiddenItemsFromBoardData,
    };
  `;

  const stripInternalHiddenTags = (text) => String(text || '')
    .replace(/\s*#hidden-internal-(?:incoming|parked|archived|deleted)\b/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  const hasInternalHiddenTag = (text, tag) => !!(text && tag && String(text).includes(tag));
  const stripLayoutTags = (text) => String(text || '').replace(/\s+#(?:stack|wide|full|half|third|twothird)\b/g, '');
  const getCardTitle = (content) => String(content || '')
    .replace(/^\s*-\s*\[[ xX]\]\s*/, '')
    .split('\n')[0]
    .trim();
  const removeEmptyStacksAndRowsInBoard = () => {};
  const getArchiveFileContextForBoard = (boardId) => (
    boardId === 'local-board'
      ? { filename: 'local-board-archive.md' }
      : null
  );
  const getBoardDisplayTitle = (boardId) => boardId === 'local-board' ? 'Local Board' : 'Remote Board';

  const factory = new Function(
    'stripInternalHiddenTags',
    'hasInternalHiddenTag',
    'stripLayoutTags',
    'getCardTitle',
    'removeEmptyStacksAndRowsInBoard',
    'getArchiveFileContextForBoard',
    'getBoardDisplayTitle',
    wrappedSource
  );

  return factory(
    stripInternalHiddenTags,
    hasInternalHiddenTag,
    stripLayoutTags,
    getCardTitle,
    removeEmptyStacksAndRowsInBoard,
    getArchiveFileContextForBoard,
    getBoardDisplayTitle
  );
}

let C;

beforeAll(() => {
  C = loadBoardCleanupFunctions();
});

describe('collectHiddenItemsFromBoardData', () => {
  it('collects archived rows, stacks, columns, and cards from board data', () => {
    const board = {
      rows: [
        {
          title: 'Row One',
          stacks: [
            {
              title: 'Stack One #hidden-internal-archived',
              columns: [
                { title: 'Column One', cards: [] },
              ],
            },
          ],
        },
        {
          title: 'Row Two',
          stacks: [
            {
              title: 'Stack Two',
              columns: [
                {
                  title: 'Column Two #hidden-internal-archived',
                  cards: [
                    { content: '- [ ] Nested in archived column' },
                  ],
                },
                {
                  title: 'Column Three',
                  cards: [
                    { content: '- [ ] Visible card' },
                    { content: '- [ ] Archived card #hidden-internal-archived' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const archived = C.collectHiddenItemsFromBoardData(board, '#hidden-internal-archived');
    expect(archived.map((item) => item.kind)).toEqual(['stack', 'column', 'card']);
    expect(archived.map((item) => item.title)).toEqual(['Stack One', 'Column Two', 'Archived card']);
  });
});

describe('getBoardCleanupState', () => {
  it('counts archived and deleted items and detects archive availability', () => {
    const board = {
      rows: [
        {
          title: 'Row',
          stacks: [
            {
              title: 'Stack',
              columns: [
                {
                  title: 'Column',
                  cards: [
                    { content: '- [ ] Archived #hidden-internal-archived' },
                    { content: '- [ ] Deleted #hidden-internal-deleted' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const localState = C.getBoardCleanupState('local-board', board);
    expect(localState.archivedCount).toBe(1);
    expect(localState.deletedCount).toBe(1);
    expect(localState.archiveAvailable).toBe(true);
    expect(localState.boardTitle).toBe('Local Board');

    const remoteState = C.getBoardCleanupState('remote-board', board);
    expect(remoteState.archiveAvailable).toBe(false);
  });
});

describe('normalizeBoardCleanupAction', () => {
  it('normalizes action aliases used by the cleanup dialog', () => {
    expect(C.normalizeBoardCleanupAction('empty-trash')).toBe('trash');
    expect(C.normalizeBoardCleanupAction('move-to-archive')).toBe('archive');
    expect(C.normalizeBoardCleanupAction('clean-both')).toBe('both');
    expect(C.normalizeBoardCleanupAction('keep')).toBe('skip');
  });
});

describe('isBoardCleanupActionApplicable', () => {
  it('checks action applicability against available cleanup work', () => {
    const state = {
      needsCleanup: true,
      deletedCount: 2,
      archivedCount: 1,
      archiveAvailable: true,
    };
    expect(C.isBoardCleanupActionApplicable(state, 'trash')).toBe(true);
    expect(C.isBoardCleanupActionApplicable(state, 'archive')).toBe(true);
    expect(C.isBoardCleanupActionApplicable(state, 'both')).toBe(true);
    expect(C.isBoardCleanupActionApplicable({ ...state, archiveAvailable: false }, 'archive')).toBe(false);
    expect(C.isBoardCleanupActionApplicable({ ...state, deletedCount: 0 }, 'trash')).toBe(false);
  });
});

describe('removeHiddenItemsFromBoardData', () => {
  it('removes mixed hidden items in stable reverse order', () => {
    const board = {
      rows: [
        {
          title: 'Row One',
          stacks: [
            {
              title: 'Stack One',
              columns: [
                {
                  title: 'Column One',
                  cards: [
                    { content: '- [ ] Deleted A #hidden-internal-deleted' },
                    { content: '- [ ] Visible' },
                  ],
                },
              ],
            },
          ],
        },
        {
          title: 'Row Two #hidden-internal-archived',
          stacks: [],
        },
      ],
    };

    const items = [
      { kind: 'card', rowIndex: 0, stackIndex: 0, colIndex: 0, cardIndex: 0 },
      { kind: 'row', rowIndex: 1 },
    ];

    expect(C.removeHiddenItemsFromBoardData(board, items)).toBe(true);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].stacks[0].columns[0].cards).toHaveLength(1);
    expect(board.rows[0].stacks[0].columns[0].cards[0].content).toContain('Visible');
  });
});
