import { describe, it, expect, beforeAll } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadCanvasModeHelpers() {
  const CanvasMode = loadIIFE('canvas/canvasMode.js', 'LexeraCanvasMode');
  return CanvasMode.createCanvasModeHelpers({
    stripHtmlComments(text) {
      return String(text || '')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
  });
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

describe('canvas grid setting normalization', () => {
  it('normalizes canvas grid values', () => {
    expect(CanvasModeHelpers.normalizeCanvasGridValue('off')).toBe('off');
    expect(CanvasModeHelpers.normalizeCanvasGridValue('largest-element')).toBe('largest');
    expect(CanvasModeHelpers.normalizeCanvasGridValue('64')).toBe('64');
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
