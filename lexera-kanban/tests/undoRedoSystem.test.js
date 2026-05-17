import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const UndoRedo = require('../src/core/undoRedoSystem.js');

function initUndoRedo() {
  UndoRedo.init({
    getFullBoardData: () => null,
    getActiveBoardId: () => null,
    getActiveBoardData: () => null,
    computeBoardDelta: () => ({}),
    cloneBoardData: (value) => JSON.parse(JSON.stringify(value)),
    estimateDeltaSize: () => 0,
    applyBoardDelta: () => {},
    deltaToTargets: () => [{ type: 'board' }],
    getBoardSaveBase: () => null,
    setBoardSaveBase: () => {},
    persistBoardMutation: async () => {}
  });
  UndoRedo.clear();
}

describe('UndoRedo operation entries', () => {
  beforeEach(initUndoRedo);

  it('runs async operation undo and redo without requiring active board data', async () => {
    const calls = [];

    UndoRedo.pushUndoOperation({
      meta: { type: 'cross-board-card-move', cardId: 'card-1' },
      undo: async () => {
        calls.push('undo');
      },
      redo: async () => {
        calls.push('redo');
      }
    });

    expect(UndoRedo.getUndoDepth()).toBe(1);

    await UndoRedo.undo();
    expect(calls).toEqual(['undo']);
    expect(UndoRedo.getUndoDepth()).toBe(0);
    expect(UndoRedo.getRedoDepth()).toBe(1);

    await UndoRedo.redo();
    expect(calls).toEqual(['undo', 'redo']);
    expect(UndoRedo.getUndoDepth()).toBe(1);
    expect(UndoRedo.getRedoDepth()).toBe(0);
  });
});
