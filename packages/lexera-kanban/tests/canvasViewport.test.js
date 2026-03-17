import { describe, it, expect } from 'vitest';
import CanvasViewport from '../src/canvas/canvasViewport.js';

describe('canvas viewport helpers', () => {
  it('does not treat the gap inside an overall bounds box as visible content', () => {
    var viewportRect = { left: 420, top: 20, right: 520, bottom: 140 };
    var stackRects = [
      { left: 0, top: 0, right: 120, bottom: 120 },
      { left: 900, top: 0, right: 1020, bottom: 120 }
    ];

    expect(CanvasViewport.hasAnyVisibleCanvasStack(stackRects, viewportRect)).toBe(false);
  });

  it('reports visible content when any stack rect intersects the viewport', () => {
    var viewportRect = { left: 420, top: 20, right: 520, bottom: 140 };
    var stackRects = [
      { left: 480, top: 40, right: 640, bottom: 180 }
    ];

    expect(CanvasViewport.hasAnyVisibleCanvasStack(stackRects, viewportRect)).toBe(true);
  });

  it('calculates a pan and zoom that fits all stack bounds into the viewport', () => {
    var focus = CanvasViewport.calculateCanvasFocusViewport(
      [
        { x: -80, y: 40, w: 140, h: 100 },
        { x: 260, y: 180, w: 200, h: 160 }
      ],
      { width: 800, height: 600 },
      { padding: 40, minZoom: 0.25, maxZoom: 3, surfaceOffsetX: 300, surfaceOffsetY: 260 }
    );

    expect(focus).not.toBeNull();
    expect(focus.zoom).toBeGreaterThanOrEqual(0.25);
    expect(focus.zoom).toBeLessThanOrEqual(3);

    var bounds = focus.bounds;
    var left = 300 + focus.panX + bounds.left * focus.zoom;
    var top = 260 + focus.panY + bounds.top * focus.zoom;
    var right = 300 + focus.panX + bounds.right * focus.zoom;
    var bottom = 260 + focus.panY + bounds.bottom * focus.zoom;

    expect(left).toBeGreaterThanOrEqual(39.5);
    expect(top).toBeGreaterThanOrEqual(39.5);
    expect(right).toBeLessThanOrEqual(760.5);
    expect(bottom).toBeLessThanOrEqual(560.5);
  });
});
