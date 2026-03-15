import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadCanvasModeHelpers() {
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
    ${extractFunction(findLine('function normalizeBoardLayoutValue('))}
    ${extractFunction(findLine('function stripHtmlComments('))}
    ${extractFunction(findLine('function parseCanvasParamMap('))}
    ${extractFunction(findLine('function extractCanvasConnectionSpecs('))}
    ${extractFunction(findLine('function getCanvasColumnWidthSpec('))}

    return {
      normalizeBoardLayoutValue,
      extractCanvasConnectionSpecs,
      getCanvasColumnWidthSpec
    };
  `;

  return new Function(wrappedSource)();
}

let CanvasModeHelpers;

beforeAll(() => {
  CanvasModeHelpers = loadCanvasModeHelpers();
});

describe('normalizeBoardLayoutValue', () => {
  it('maps legacy structured and empty values to kanban', () => {
    expect(CanvasModeHelpers.normalizeBoardLayoutValue('structured')).toBe('kanban');
    expect(CanvasModeHelpers.normalizeBoardLayoutValue('')).toBe('kanban');
    expect(CanvasModeHelpers.normalizeBoardLayoutValue(null)).toBe('kanban');
  });

  it('preserves canvas and kanban values', () => {
    expect(CanvasModeHelpers.normalizeBoardLayoutValue('canvas')).toBe('canvas');
    expect(CanvasModeHelpers.normalizeBoardLayoutValue('kanban')).toBe('kanban');
  });
});

describe('extractCanvasConnectionSpecs', () => {
  it('parses stack connection annotations and normalizes the target tag', () => {
    expect(
      CanvasModeHelpers.extractCanvasConnectionSpecs(
        'System Map [#Backend]{from:right, to:left, sy:25%, ty:75%}'
      )
    ).toEqual([
      {
        targetTag: '#backend',
        params: {
          from: 'right',
          to: 'left',
          sy: '25%',
          ty: '75%'
        }
      }
    ]);
  });
});

describe('getCanvasColumnWidthSpec', () => {
  it('supports percent, fraction, and pixel width tokens for canvas columns', () => {
    expect(CanvasModeHelpers.getCanvasColumnWidthSpec('33%')).toEqual({ kind: 'percent', value: 33 });
    expect(CanvasModeHelpers.getCanvasColumnWidthSpec('1/3').kind).toBe('percent');
    expect(CanvasModeHelpers.getCanvasColumnWidthSpec('1/3').value).toBeCloseTo(100 / 3, 5);
    expect(CanvasModeHelpers.getCanvasColumnWidthSpec('320')).toEqual({ kind: 'px', value: 320 });
  });
});
