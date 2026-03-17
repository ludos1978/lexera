import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ScrollHelpers = require('../src/interaction/scrollBehavior.js');

function createScrollableNode(options = {}) {
  return {
    nodeType: 1,
    parentElement: options.parentElement || null,
    scrollHeight: options.scrollHeight || 0,
    clientHeight: options.clientHeight || 0,
    scrollTop: options.scrollTop || 0,
    scrollWidth: options.scrollWidth || 0,
    clientWidth: options.clientWidth || 0,
    scrollLeft: options.scrollLeft || 0,
    __styles: options.styles || {}
  };
}

function createClosestTarget(matches = []) {
  const set = new Set(matches);
  return {
    closest(selector) {
      const selectors = String(selector || '').split(',').map((part) => part.trim()).filter(Boolean);
      for (const candidate of selectors) {
        if (set.has(candidate)) return { selector: candidate };
      }
      return null;
    }
  };
}

const originalGetComputedStyle = globalThis.getComputedStyle;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.getComputedStyle = originalGetComputedStyle;
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
});

describe('normalizeBoardScrollSpeedValue', () => {
  it('normalizes menu-style values and keeps sane defaults', () => {
    expect(ScrollHelpers.normalizeBoardScrollSpeedValue('')).toBe('1');
    expect(ScrollHelpers.normalizeBoardScrollSpeedValue('0.75x')).toBe('0.75');
    expect(ScrollHelpers.normalizeBoardScrollSpeedValue('1.5')).toBe('1.5');
  });

  it('clamps extreme values into the supported range', () => {
    expect(ScrollHelpers.normalizeBoardScrollSpeedValue('0.01')).toBe('0.1');
    expect(ScrollHelpers.normalizeBoardScrollSpeedValue('5')).toBe('3');
  });
});

describe('getBoardScrollSpeedMultiplier', () => {
  it('uses the board setting when present', () => {
    expect(ScrollHelpers.getBoardScrollSpeedMultiplier({ scrollSpeed: '0.5' })).toBe(0.5);
  });

  it('falls back to 1 when the board has no custom speed', () => {
    expect(ScrollHelpers.getBoardScrollSpeedMultiplier({})).toBe(1);
  });
});

describe('normalizeWheelDeltaToPixels', () => {
  it('keeps pixel deltas unchanged and expands line deltas', () => {
    expect(ScrollHelpers.normalizeWheelDeltaToPixels(24, 0)).toBe(24);
    expect(ScrollHelpers.normalizeWheelDeltaToPixels(2, 1)).toBe(32);
  });

  it('uses viewport-relative page deltas', () => {
    globalThis.window = { innerHeight: 1000 };
    expect(ScrollHelpers.normalizeWheelDeltaToPixels(1, 2, { window: globalThis.window })).toBe(850);
  });
});

describe('canStartCanvasPointerPan', () => {
  it('allows plain left-drag on empty canvas space', () => {
    expect(
      ScrollHelpers.canStartCanvasPointerPan(
        createClosestTarget(['#columns-container', '.board-row-content']),
        0,
        false
      )
    ).toBe(true);
  });

  it('blocks plain left-drag on stacks and other interactive elements', () => {
    expect(
      ScrollHelpers.canStartCanvasPointerPan(
        createClosestTarget(['#columns-container', '.board-row-content', '.board-stack']),
        0,
        false
      )
    ).toBe(false);
  });

  it('keeps the existing modifier pan gestures available', () => {
    expect(
      ScrollHelpers.canStartCanvasPointerPan(
        createClosestTarget(['#columns-container', '.board-stack']),
        1,
        false
      )
    ).toBe(true);
    expect(
      ScrollHelpers.canStartCanvasPointerPan(
        createClosestTarget(['#columns-container', '.board-stack']),
        0,
        true
      )
    ).toBe(true);
  });
});

describe('canScrollableElementConsumeWheelDelta', () => {
  it('allows scrolling within the remaining scroll range', () => {
    const node = createScrollableNode({
      scrollHeight: 500,
      clientHeight: 200,
      scrollTop: 100,
      styles: { overflowY: 'auto' }
    });
    globalThis.getComputedStyle = (el) => ({
      overflowY: el.__styles.overflowY || 'visible',
      overflowX: el.__styles.overflowX || 'visible'
    });

    expect(ScrollHelpers.canScrollableElementConsumeWheelDelta(node, 'y', 40, { getComputedStyle: globalThis.getComputedStyle })).toBe(true);
    expect(ScrollHelpers.canScrollableElementConsumeWheelDelta(node, 'y', -40, { getComputedStyle: globalThis.getComputedStyle })).toBe(true);
  });

  it('returns false when the element is already at the relevant edge', () => {
    const node = createScrollableNode({
      scrollHeight: 500,
      clientHeight: 200,
      scrollTop: 300,
      styles: { overflowY: 'auto' }
    });
    globalThis.getComputedStyle = (el) => ({
      overflowY: el.__styles.overflowY || 'visible',
      overflowX: el.__styles.overflowX || 'visible'
    });

    expect(ScrollHelpers.canScrollableElementConsumeWheelDelta(node, 'y', 40, { getComputedStyle: globalThis.getComputedStyle })).toBe(false);
  });
});

describe('shouldHandleBoardViewportWheelEvent', () => {
  it('lets nested scrollable content consume the wheel event first', () => {
    const container = createScrollableNode();
    const nested = createScrollableNode({
      parentElement: container,
      scrollHeight: 600,
      clientHeight: 200,
      scrollTop: 120,
      styles: { overflowY: 'auto' }
    });
    globalThis.getComputedStyle = (el) => ({
      overflowY: el.__styles.overflowY || 'visible',
      overflowX: el.__styles.overflowX || 'visible'
    });
    globalThis.document = { body: { nodeType: 1 } };

    expect(ScrollHelpers.shouldHandleBoardViewportWheelEvent(nested, container, 0, 60, {
      getComputedStyle: globalThis.getComputedStyle,
      document: globalThis.document
    })).toBe(false);
  });

  it('falls back to the board viewport when nested content cannot scroll further', () => {
    const container = createScrollableNode();
    const nested = createScrollableNode({
      parentElement: container,
      scrollHeight: 600,
      clientHeight: 200,
      scrollTop: 400,
      styles: { overflowY: 'auto' }
    });
    globalThis.getComputedStyle = (el) => ({
      overflowY: el.__styles.overflowY || 'visible',
      overflowX: el.__styles.overflowX || 'visible'
    });
    globalThis.document = { body: { nodeType: 1 } };

    expect(ScrollHelpers.shouldHandleBoardViewportWheelEvent(nested, container, 0, 60, {
      getComputedStyle: globalThis.getComputedStyle,
      document: globalThis.document
    })).toBe(true);
  });
});
