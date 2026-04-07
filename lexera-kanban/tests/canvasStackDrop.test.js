import { describe, it, expect } from 'vitest';
import CanvasStackDrop from '../src/canvas/stackDrop.js';

describe('canvas stack drop helpers', () => {
  it('builds a canvas row target with explicit drop coordinates', () => {
    var target = CanvasStackDrop.resolveCanvasStackDropTarget({
      isCanvasLayout: true,
      activeBoardId: 'board-a',
      clientX: 400,
      clientY: 220,
      grabOffsetX: 12,
      grabOffsetY: 8,
      resolveCanvasRowContentDropTarget: function () {
        return {
          boardId: 'board-a',
          rowIndex: 3,
          indexMode: 'display',
          node: { id: 'row-node' },
          contentNode: { id: 'row-content' }
        };
      },
      getCanvasRowContentNodeFromDropTarget: function (rowTarget) {
        return rowTarget.contentNode;
      },
      getCanvasDropPositionInRowContent: function (rowContent, x, y, grabOffsetX, grabOffsetY) {
        expect(rowContent).toEqual({ id: 'row-content' });
        expect(x).toBe(400);
        expect(y).toBe(220);
        expect(grabOffsetX).toBe(12);
        expect(grabOffsetY).toBe(8);
        return { x: 187.6, y: 92.2 };
      }
    });

    expect(target).toEqual({
      kind: 'row',
      boardId: 'board-a',
      rowIndex: 3,
      indexMode: 'display',
      canvasPosition: { x: 188, y: 92 }
    });
  });

  it('ignores canvas row targets outside the active board', () => {
    var target = CanvasStackDrop.resolveCanvasStackDropTarget({
      isCanvasLayout: true,
      activeBoardId: 'board-a',
      clientX: 10,
      clientY: 10,
      resolveCanvasRowContentDropTarget: function () {
        return {
          boardId: 'board-b',
          rowIndex: 0,
          indexMode: 'display'
        };
      },
      getCanvasRowContentNodeFromDropTarget: function () {
        return { id: 'row-content' };
      },
      getCanvasDropPositionInRowContent: function () {
        return { x: 1, y: 2 };
      }
    });

    expect(target).toBeNull();
  });

  it('applies explicit canvas coordinates to a moved stack', () => {
    var stack = { id: 'stack-a', title: 'Stack A' };

    CanvasStackDrop.applyCanvasDropPositionToStack(
      'board-a',
      'board-a',
      true,
      { canvasPosition: { x: 321.4, y: 654.8 } },
      stack
    );

    expect(stack.params).toEqual({ x: '321', y: '655' });
  });
});
