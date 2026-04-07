import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CanvasDragHelpers = require('../src/canvas/canvasDom.js');

describe('getCanvasRowContentNodeFromDropTarget', () => {
  it('prefers the explicit row content node when the drop target provides one', () => {
    const rowContent = { id: 'content-node' };
    const rowNode = {
      classList: { contains: () => false },
      querySelector() {
        throw new Error('should not query the row wrapper when contentNode is present');
      }
    };

    expect(CanvasDragHelpers.getCanvasRowContentNodeFromDropTarget({
      node: rowNode,
      contentNode: rowContent
    }, null)).toBe(rowContent);
  });

  it('falls back to the nested .board-row-content node when only the outer row is available', () => {
    const rowContent = { id: 'queried-content-node' };
    const rowNode = {
      classList: { contains: (name) => name === 'board-row' },
      querySelector(selector) {
        expect(selector).toBe(':scope > .board-row-content');
        return rowContent;
      }
    };

    expect(CanvasDragHelpers.getCanvasRowContentNodeFromDropTarget({
      node: rowNode
    }, null)).toBe(rowContent);
  });

  it('returns the fallback node when no content node can be resolved', () => {
    const fallback = { id: 'fallback-content-node' };
    const rowNode = {
      classList: { contains: () => false },
      querySelector() {
        return null;
      }
    };

    expect(CanvasDragHelpers.getCanvasRowContentNodeFromDropTarget({
      node: rowNode
    }, fallback)).toBe(fallback);
  });
});
