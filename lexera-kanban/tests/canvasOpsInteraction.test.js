import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createStyleRecorder() {
  const values = {};
  return {
    values,
    zoom: '',
    setProperty(key, value) {
      values[key] = value;
    },
    getPropertyValue(key) {
      return values[key] || '';
    }
  };
}

describe('LexeraCanvasOps interactions', () => {
  it('zooms around the pointer and keeps the canvas point anchored with pan CSS variables', () => {
    const style = createStyleRecorder();
    const container = {
      style,
      isConnected: false,
      __canvasSceneOffsetX: 100,
      __canvasSceneOffsetY: 50,
      querySelector: () => null,
      querySelectorAll: () => [],
      clientWidth: 800,
      clientHeight: 600
    };
    const showNotification = vi.fn();
    const CanvasOps = loadIIFE('canvas/canvasOps.js', 'LexeraCanvasOps', {
      window: {},
      document: { createElement: () => ({}) },
      requestAnimationFrame: (fn) => {
        fn();
        return 1;
      },
      getComputedStyle: () => ({ getPropertyValue: () => '#888' })
    });

    CanvasOps.init({
      getElColumnsContainer: () => container,
      isCanvasBoardLayout: () => true,
      showNotification,
      getTagColor: () => '#123456',
      getBoardSettingValue: () => '32',
      normalizeCanvasGridValue: (value) => value,
      getCanvasViewportApi: () => ({
        hasAnyVisibleCanvasStack: () => true,
        calculateCanvasFocusViewport: () => null
      }),
      getScrollBehaviorApi: () => ({ scaleZoomDelta: () => 0.1 }),
      getCanvasMathApi: () => ({}),
      getCanvasLayoutApi: () => ({}),
      extractCanvasConnectionSpecs: () => [],
      extractCanvasStackTags: () => [],
      getCanvasRenderedStackMetrics: () => ({ x: 0, y: 0, w: 1, h: 1 }),
      getCanvasConnectionPath: () => '',
      getDefaultCanvasConnectionSide: () => 'right',
      resolveCanvasConnectionAnchor: () => ({ x: 0, y: 0 }),
      parseCanvasLayoutNumber: (value, fallback) => Number(value) || fallback,
      calculateCanvasSurface: () => ({ offsetX: 0, offsetY: 0, width: 1, height: 1 }),
      resolveCanvasGridStep: () => 32,
      getNextCanvasStackPlacement: () => ({ x: 0, y: 0 })
    });

    CanvasOps.setCanvasPanX(20);
    CanvasOps.setCanvasPanY(10);
    CanvasOps.applyCanvasZoom(2, 300, 200);

    expect(CanvasOps.getCanvasZoom()).toBe(2);
    expect(CanvasOps.getCanvasPanX()).toBe(-160);
    expect(CanvasOps.getCanvasPanY()).toBe(-130);
    expect(style.values['--canvas-zoom']).toBe('2');
    expect(style.values['--canvas-pan-x']).toBe('-160px');
    expect(style.values['--canvas-pan-y']).toBe('-130px');
    expect(showNotification).toHaveBeenCalledWith('Canvas Zoom 200%');
  });
});
