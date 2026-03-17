import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BoardCleanup = require('../src/cleanup/boardCleanup.js');

const cleanupDeps = {
  stripInternalHiddenTags: (text) => String(text || '')
    .replace(/\s*#hidden-internal-(?:incoming|parked|archived|deleted)\b/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n'),
  hasInternalHiddenTag: (text, tag) => !!(text && tag && String(text).includes(tag)),
  stripLayoutTags: (text) => String(text || '').replace(/\s+#(?:stack|wide|full|half|third|twothird)\b/g, ''),
  getCardTitle: (content) => String(content || '')
    .replace(/^\s*-\s*\[[ xX]\]\s*/, '')
    .split('\n')[0]
    .trim(),
  removeEmptyStacksAndRowsInBoard: () => {},
  getArchiveFileContextForBoard: (boardId) => (
    boardId === 'local-board'
      ? { filename: 'local-board-archive.md' }
      : null
  ),
  getBoardDisplayTitle: (boardId) => boardId === 'local-board' ? 'Local Board' : 'Remote Board'
};

const C = {
  collectHiddenItemsFromBoardData(boardData, tag) {
    return BoardCleanup.collectHiddenItemsFromBoardData(boardData, tag, cleanupDeps);
  },
  getBoardCleanupState(boardId, boardData) {
    return BoardCleanup.getBoardCleanupState(boardId, boardData, cleanupDeps);
  },
  normalizeBoardCleanupAction(action) {
    return BoardCleanup.normalizeBoardCleanupAction(action);
  },
  isBoardCleanupActionApplicable(cleanupState, action) {
    return BoardCleanup.isBoardCleanupActionApplicable(cleanupState, action);
  },
  sortHiddenItemsForRemoval(items) {
    return BoardCleanup.sortHiddenItemsForRemoval(items);
  },
  removeHiddenItemsFromBoardData(boardData, items) {
    return BoardCleanup.removeHiddenItemsFromBoardData(boardData, items, cleanupDeps);
  }
};

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
