import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadScrollHelpers() {
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
    var fullBoardData = null;
    ${extractFunction(findLine('function getBoardSettingValue('))}
    ${extractFunction(findLine('function normalizeBoardScrollSpeedValue('))}
    ${extractFunction(findLine('function getBoardScrollSpeedMultiplier('))}
    ${extractFunction(findLine('function normalizeWheelDeltaToPixels('))}
    ${extractFunction(findLine('function canScrollableElementConsumeWheelDelta('))}
    ${extractFunction(findLine('function shouldHandleBoardViewportWheelEvent('))}

    return {
      setBoardSettings: function (settings) {
        fullBoardData = { boardSettings: settings || {} };
      },
      clearBoardSettings: function () {
        fullBoardData = null;
      },
      normalizeBoardScrollSpeedValue,
      getBoardScrollSpeedMultiplier,
      normalizeWheelDeltaToPixels,
      canScrollableElementConsumeWheelDelta,
      shouldHandleBoardViewportWheelEvent
    };
  `;

  return new Function(wrappedSource)();
}

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

let ScrollHelpers;
const originalGetComputedStyle = globalThis.getComputedStyle;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

beforeAll(() => {
  ScrollHelpers = loadScrollHelpers();
});

afterEach(() => {
  ScrollHelpers.clearBoardSettings();
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
    ScrollHelpers.setBoardSettings({ scrollSpeed: '0.5' });
    expect(ScrollHelpers.getBoardScrollSpeedMultiplier()).toBe(0.5);
  });

  it('falls back to 1 when the board has no custom speed', () => {
    ScrollHelpers.setBoardSettings({});
    expect(ScrollHelpers.getBoardScrollSpeedMultiplier()).toBe(1);
  });
});

describe('normalizeWheelDeltaToPixels', () => {
  it('keeps pixel deltas unchanged and expands line deltas', () => {
    expect(ScrollHelpers.normalizeWheelDeltaToPixels(24, 0)).toBe(24);
    expect(ScrollHelpers.normalizeWheelDeltaToPixels(2, 1)).toBe(32);
  });

  it('uses viewport-relative page deltas', () => {
    globalThis.window = { innerHeight: 1000 };
    expect(ScrollHelpers.normalizeWheelDeltaToPixels(1, 2)).toBe(850);
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

    expect(ScrollHelpers.canScrollableElementConsumeWheelDelta(node, 'y', 40)).toBe(true);
    expect(ScrollHelpers.canScrollableElementConsumeWheelDelta(node, 'y', -40)).toBe(true);
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

    expect(ScrollHelpers.canScrollableElementConsumeWheelDelta(node, 'y', 40)).toBe(false);
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

    expect(ScrollHelpers.shouldHandleBoardViewportWheelEvent(nested, container, 0, 60)).toBe(false);
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

    expect(ScrollHelpers.shouldHandleBoardViewportWheelEvent(nested, container, 0, 60)).toBe(true);
  });
});
