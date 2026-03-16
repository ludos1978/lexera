import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadCanvasDragHelpers() {
  const source = readFileSync(resolve(srcDir, 'app.js'), 'utf-8');
  const lines = source.split('\n');

  function findLine(pattern) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(pattern)) return i + 1;
    }
    throw new Error('Could not find: ' + pattern);
  }

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

  const wrappedSource = `
    ${extractFunction(findLine('function getCanvasRowContentNodeFromDropTarget('))}

    return {
      getCanvasRowContentNodeFromDropTarget
    };
  `;

  return new Function(wrappedSource)();
}

let CanvasDragHelpers;

beforeAll(() => {
  CanvasDragHelpers = loadCanvasDragHelpers();
});

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
