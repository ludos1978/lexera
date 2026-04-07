import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CanvasHelpers = require('../src/canvas/canvasMath.js');

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

  it('respects explicit canvas position and width while keeping auto-height fallback', () => {
    expect(CanvasHelpers.getCanvasStackLayoutBox({
      params: { x: '80', y: '140', w: '260', h: '180' }
    }, 0)).toEqual({
      x: 80,
      y: 140,
      w: 260,
      h: 220
    });
  });

  it('keeps negative canvas coordinates so pages can expand left and up', () => {
    expect(CanvasHelpers.getCanvasStackLayoutBox({
      params: { x: '-80', y: '-40', w: '260', h: '180' }
    }, 0)).toEqual({
      x: -80,
      y: -40,
      w: 260,
      h: 220
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

  it('keeps extending to the right instead of wrapping at a fixed canvas width', () => {
    const next = CanvasHelpers.getNextCanvasStackPlacement([
      { params: { x: '1320', y: '40', w: '300', h: '220' } }
    ]);
    expect(next).toEqual({ x: 1648, y: 40 });
  });

  it('keeps the top-most stack lane even when stacks sit above zero', () => {
    const next = CanvasHelpers.getNextCanvasStackPlacement([
      { params: { x: '-420', y: '-180', w: '260', h: '180' } },
      { params: { x: '40', y: '-120', w: '300', h: '220' } }
    ]);
    expect(next).toEqual({ x: 368, y: -180 });
  });
});

describe('canvas surface helpers', () => {
  it('uses the largest element size for auto grid sizing', () => {
    const metrics = [
      { x: 24, y: 24, w: 300, h: 220 },
      { x: 420, y: 60, w: 512, h: 280 }
    ];
    expect(CanvasHelpers.resolveCanvasGridStep(metrics, 'largest')).toBeGreaterThanOrEqual(512);
  });

  it('expands the canvas surface into negative space using actual stack bounds', () => {
    expect(CanvasHelpers.calculateCanvasSurface([
      { x: -180, y: -120, w: 300, h: 220 }
    ])).toEqual({
      left: -700,
      top: -480,
      width: 1340,
      height: 940,
      offsetX: 700,
      offsetY: 480
    });
  });

  it('keeps left and top breathing room even when stacks are only on the positive side', () => {
    expect(CanvasHelpers.calculateCanvasSurface([
      { x: 24, y: 24, w: 300, h: 220 }
    ])).toEqual({
      left: -496,
      top: -336,
      width: 1340,
      height: 940,
      offsetX: 496,
      offsetY: 336
    });
  });

  it('keeps large-board overscan instead of shrinking back to padding-only edges', () => {
    expect(CanvasHelpers.calculateCanvasSurface([
      { x: 0, y: 0, w: 320, h: 220 },
      { x: 1600, y: 900, w: 320, h: 240 }
    ])).toEqual({
      left: -520,
      top: -360,
      width: 2960,
      height: 1860,
      offsetX: 520,
      offsetY: 360
    });
  });
});

describe('getCanvasRenderedStackMetrics', () => {
  it('keeps stack metrics in unscaled canvas units so scene zoom handles both size and distance', () => {
    expect(CanvasHelpers.getCanvasRenderedStackMetrics({
      style: {
        left: '240px',
        top: '120px',
        width: '300px',
        height: '220px'
      },
      offsetLeft: 240,
      offsetTop: 120,
      offsetWidth: 300,
      offsetHeight: 220
    })).toEqual({
      x: 240,
      y: 120,
      w: 300,
      h: 220
    });
  });
});

describe('canvas coordinate helpers', () => {
  it('keeps viewport-to-canvas translation stable under zoom with borders', () => {
    const getComputedStyle = () => ({
      borderLeftWidth: '1px',
      borderTopWidth: '2px',
      paddingLeft: '8px',
      paddingTop: '10px'
    });
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
      20,
      { zoom: 2, getComputedStyle }
    )).toEqual({
      x: 25,
      y: 33
    });
  });
});
