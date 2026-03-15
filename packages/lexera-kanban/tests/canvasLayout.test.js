import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadCanvasHelpers() {
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

  function extractLineRange(startPattern, endPattern) {
    const startLine = findLine(startPattern);
    const endLine = findLine(endPattern);
    return lines.slice(startLine - 1, endLine).join('\n');
  }

  const wrappedSource = `
    var $canvasZoom = 1;
    ${extractLineRange('var CANVAS_DEFAULT_STACK_X = 24;', 'var CANVAS_WRAP_WIDTH = 1600;')}
    ${extractFunction(findLine('function parseCanvasLayoutNumber('))}
    ${extractFunction(findLine('function getCanvasFallbackStackBox('))}
    ${extractFunction(findLine('function getCanvasStackLayoutBox('))}
    ${extractFunction(findLine('function getNextCanvasStackPlacement('))}
    ${extractFunction(findLine('function calculateCanvasBounds('))}
    ${extractFunction(findLine('function getCanvasRowContentMetrics('))}
    ${extractFunction(findLine('function getCanvasPositionFromViewportPoint('))}
    ${extractFunction(findLine('function getCanvasPositionFromElementRect('))}

    return {
      setCanvasZoom: function (zoom) { $canvasZoom = zoom; },
      getCanvasStackLayoutBox,
      getNextCanvasStackPlacement,
      calculateCanvasBounds,
      getCanvasPositionFromViewportPoint,
      getCanvasPositionFromElementRect
    };
  `;

  return new Function(wrappedSource)();
}

let CanvasHelpers;

beforeAll(() => {
  CanvasHelpers = loadCanvasHelpers();
});

describe('getCanvasStackLayoutBox', () => {
  it('uses a stable fallback grid when stack params are missing', () => {
    expect(CanvasHelpers.getCanvasStackLayoutBox({}, 0)).toEqual({
      x: 24,
      y: 24,
      w: 300,
      h: 220
    });
    expect(CanvasHelpers.getCanvasStackLayoutBox({}, 1)).toEqual({
      x: 352,
      y: 24,
      w: 300,
      h: 220
    });
  });

  it('respects explicit canvas params with minimum size guards', () => {
    expect(CanvasHelpers.getCanvasStackLayoutBox({
      params: { x: '80', y: '140', w: '260', h: '180' }
    }, 0)).toEqual({
      x: 80,
      y: 140,
      w: 260,
      h: 180
    });
  });
});

describe('getNextCanvasStackPlacement', () => {
  it('starts the first stack at the default canvas origin', () => {
    expect(CanvasHelpers.getNextCanvasStackPlacement([])).toEqual({ x: 24, y: 24 });
  });

  it('places the next stack to the right of the current right-most stack', () => {
    const next = CanvasHelpers.getNextCanvasStackPlacement([
      { params: { x: '24', y: '24', w: '300', h: '220' } }
    ]);
    expect(next).toEqual({ x: 352, y: 24 });
  });

  it('wraps to a new canvas lane when the next position would exceed the wrap width', () => {
    const next = CanvasHelpers.getNextCanvasStackPlacement([
      { params: { x: '1320', y: '40', w: '300', h: '220' } }
    ]);
    expect(next).toEqual({ x: 24, y: 288 });
  });
});

describe('calculateCanvasBounds', () => {
  it('preserves the minimum canvas footprint for small layouts', () => {
    expect(CanvasHelpers.calculateCanvasBounds([
      { x: 24, y: 24, w: 300, h: 220 }
    ])).toEqual({
      minWidth: 960,
      minHeight: 640
    });
  });

  it('expands the canvas footprint to include stacks placed near the bottom-right edge', () => {
    expect(CanvasHelpers.calculateCanvasBounds([
      { x: 820, y: 560, w: 320, h: 240 }
    ])).toEqual({
      minWidth: 1180,
      minHeight: 840
    });
  });
});

describe('canvas coordinate helpers', () => {
  it('uses the row padding box as the canvas origin instead of subtracting padding', () => {
    const originalGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({
      borderLeftWidth: '0px',
      borderTopWidth: '0px',
      paddingLeft: '12px',
      paddingTop: '18px'
    });
    CanvasHelpers.setCanvasZoom(1);
    const rowContent = {
      getBoundingClientRect() {
        return { left: 100, top: 200 };
      }
    };

    expect(CanvasHelpers.getCanvasPositionFromElementRect(rowContent, {
      left: 124,
      top: 236
    })).toEqual({
      x: 24,
      y: 36
    });

    globalThis.getComputedStyle = originalGetComputedStyle;
  });

  it('keeps viewport-to-canvas translation stable under zoom with borders', () => {
    const originalGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({
      borderLeftWidth: '1px',
      borderTopWidth: '2px',
      paddingLeft: '8px',
      paddingTop: '10px'
    });
    CanvasHelpers.setCanvasZoom(2);
    const rowContent = {
      getBoundingClientRect() {
        return { left: 50, top: 60 };
      }
    };

    expect(CanvasHelpers.getCanvasPositionFromViewportPoint(
      rowContent,
      120,
      148,
      20,
      20
    )).toEqual({
      x: 24,
      y: 32
    });

    globalThis.getComputedStyle = originalGetComputedStyle;
    CanvasHelpers.setCanvasZoom(1);
  });
});
