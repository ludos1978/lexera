// @vitest-environment jsdom

/**
 * Contract tests for `window.__lexeraExternalDnd`, the cross-webview
 * drop-reception bridge installed by `registerExternalDndBridge` in
 * dragDropHandlers.js.
 *
 * This bridge is what an external drag source (e.g. the workspace tree
 * webview, or a future native-Tauri-webview drag origin) calls to
 * negotiate hover / drop / clear inside this webview. The same bridge
 * is also used by the in-process cross-iframe path
 * (`tryExternalFrameHover`/`tryExternalFrameDrop`) when both frames
 * share a top window.
 *
 * Locking the bridge's signature here means the upcoming Phase 5 work
 * (extending cross-view drag to native Tauri webviews) cannot
 * accidentally break the existing reception path while introducing
 * IPC-based forwarding.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadDragDropHandlers() {
  const source = readFileSync(resolve(srcDir, 'dragdrop/dragDropHandlers.js'), 'utf-8');
  return new Function(`${source}\nreturn LexeraDragDropHandlers;`)();
}

let DDH;

beforeAll(() => {
  DDH = loadDragDropHandlers();
});

beforeEach(() => {
  document.body.innerHTML = '';
  delete window.__lexeraExternalDnd;
});

function makeMinimalDeps(overrides = {}) {
  return {
    getElColumnsContainer: () => document.getElementById('columns-container') || (() => {
      const cc = document.createElement('div');
      cc.id = 'columns-container';
      cc.className = 'columns-container';
      document.body.appendChild(cc);
      return cc;
    })(),
    getElBoardList: () => {
      let bl = document.getElementById('board-list');
      if (!bl) {
        bl = document.createElement('div');
        bl.id = 'board-list';
        bl.className = 'board-list';
        document.body.appendChild(bl);
      }
      return bl;
    },
    getActiveBoardId: () => 'test-board',
    getFullBoardData: () => ({ valid: true, columns: [], rows: [] }),
    getBoardHierarchyRows: () => [],
    moveCard: vi.fn().mockResolvedValue(),
    tagCard: vi.fn(),
    logFrontendIssue: () => {},
    lexeraLog: () => {},
    insertDropZoneIndicators: vi.fn(),
    removeDropZoneIndicators: vi.fn(),
    highlightDropZoneIndicator: vi.fn(),
    clearDropZoneIndicatorHighlights: vi.fn(),
    insertStackDropZones: vi.fn(),
    removeStackDropZones: vi.fn(),
    vsMaterialiseAll: () => {},
    vsRestoreAfterDrag: () => {},
    poll: () => {},
    findFullDataRow: () => null,
    findFullDataStack: () => null,
    findFullColumnIndexInStack: () => -1,
    findFullDataStackIndex: () => -1,
    removeEmptyStacksAndRows: () => {},
    persistBoardMutation: () => Promise.resolve(),
    pushUndo: () => {},
    applyInternalHiddenTag: (t) => t,
    isCanvasBoardLayout: () => false,
    isHorizontalCanvasStackElement: () => false,
    getCanvasStackDropApi: () => ({
      resolveCanvasStackDropTarget: () => null,
      applyCanvasDropPositionToStack: (_, __, ___, ____, s) => s
    }),
    getCanvasDomApi: () => ({ getCanvasRowContentNodeFromDropTarget: (_, fb) => fb }),
    getCanvasPositionFromViewportPoint: () => ({ x: 0, y: 0 }),
    setRowHiddenTag: () => Promise.resolve(),
    setStackHiddenTag: () => Promise.resolve(),
    reorderRows: vi.fn(),
    moveStack: vi.fn(),
    moveStackAcrossBoards: vi.fn().mockResolvedValue(),
    moveRowAcrossBoards: vi.fn().mockResolvedValue(),
    moveColumnAcrossBoards: vi.fn().mockResolvedValue(),
    moveColumnWithinBoard: vi.fn(),
    moveColumnToExistingStack: vi.fn(),
    moveColumnToNewStack: vi.fn(),
    reorderBoards: vi.fn(),
    ...overrides
  };
}

describe('__lexeraExternalDnd — bridge installation', () => {
  it('registers a global bridge object with hover/drop/clear methods', () => {
    DDH.init(makeMinimalDeps());
    DDH.registerExternalDndBridge();
    expect(window.__lexeraExternalDnd).toBeDefined();
    expect(typeof window.__lexeraExternalDnd.hover).toBe('function');
    expect(typeof window.__lexeraExternalDnd.drop).toBe('function');
    expect(typeof window.__lexeraExternalDnd.clear).toBe('function');
  });

  it('replaces an existing bridge on re-registration (no leak)', () => {
    DDH.init(makeMinimalDeps());
    DDH.registerExternalDndBridge();
    const first = window.__lexeraExternalDnd;
    DDH.registerExternalDndBridge();
    const second = window.__lexeraExternalDnd;
    expect(second).not.toBe(first);
  });
});

describe('__lexeraExternalDnd.hover — payload routing', () => {
  beforeEach(() => {
    DDH.init(makeMinimalDeps());
    DDH.registerExternalDndBridge();
  });

  it('rejects payloads without a source (cannot hover an empty drag)', () => {
    expect(window.__lexeraExternalDnd.hover(null, 100, 100)).toBe(false);
    expect(window.__lexeraExternalDnd.hover({}, 100, 100)).toBe(false);
    expect(window.__lexeraExternalDnd.hover({ type: 'tree-card' }, 100, 100)).toBe(false);
  });

  it('inserts drop zone indicators on first hover for a new drag type', () => {
    const insertSpy = vi.fn();
    DDH.init(makeMinimalDeps({ insertDropZoneIndicators: insertSpy }));
    DDH.registerExternalDndBridge();
    window.__lexeraExternalDnd.hover({ type: 'tree-card', source: { boardId: 'b', cardIndex: 0 } }, 1, 1);
    expect(insertSpy).toHaveBeenCalledWith('tree-card');
  });

  it('does NOT re-insert indicators when the same drag type hovers repeatedly', () => {
    const insertSpy = vi.fn();
    DDH.init(makeMinimalDeps({ insertDropZoneIndicators: insertSpy }));
    DDH.registerExternalDndBridge();
    window.__lexeraExternalDnd.hover({ type: 'tree-card', source: { boardId: 'b' } }, 1, 1);
    window.__lexeraExternalDnd.hover({ type: 'tree-card', source: { boardId: 'b' } }, 2, 2);
    window.__lexeraExternalDnd.hover({ type: 'tree-card', source: { boardId: 'b' } }, 3, 3);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it('re-inserts indicators when the drag type changes mid-flight', () => {
    const insertSpy = vi.fn();
    DDH.init(makeMinimalDeps({ insertDropZoneIndicators: insertSpy }));
    DDH.registerExternalDndBridge();
    window.__lexeraExternalDnd.hover({ type: 'tree-card', source: { boardId: 'b' } }, 1, 1);
    window.__lexeraExternalDnd.hover({ type: 'tree-row', source: { boardId: 'b', rowIndex: 0 } }, 2, 2);
    expect(insertSpy).toHaveBeenCalledTimes(2);
    expect(insertSpy.mock.calls[0][0]).toBe('tree-card');
    expect(insertSpy.mock.calls[1][0]).toBe('tree-row');
  });
});

describe('__lexeraExternalDnd.drop — kind-to-handler routing', () => {
  it('rejects drop payloads without a source', () => {
    DDH.init(makeMinimalDeps());
    DDH.registerExternalDndBridge();
    expect(window.__lexeraExternalDnd.drop(null, 1, 1)).toBe(false);
    expect(window.__lexeraExternalDnd.drop({}, 1, 1)).toBe(false);
  });

  it('rejects an unknown drag type', () => {
    DDH.init(makeMinimalDeps());
    DDH.registerExternalDndBridge();
    expect(window.__lexeraExternalDnd.drop(
      { type: 'unknown', source: { boardId: 'b' } }, 100, 100
    )).toBe(false);
  });

  it('returns true for a column-type drop (executeColumnPtrDrop returns void, bridge always reports handled)', () => {
    DDH.init(makeMinimalDeps());
    DDH.registerExternalDndBridge();
    // Stub elementFromPoint so isDropTargetValidForKind('column', ...) returns
    // false (no valid column target) — executeColumnPtrDrop early-outs but the
    // bridge contract still reports the drop as accepted by this view.
    document.elementFromPoint = () => null;
    const result = window.__lexeraExternalDnd.drop(
      { type: 'column', source: { boardId: 'b', rowIndex: 0, stackIndex: 0, colIndex: 0 } },
      100, 100
    );
    expect(result).toBe(true);
  });
});

describe('__lexeraExternalDnd.clear — state reset', () => {
  it('clears drop indicators without throwing', () => {
    DDH.init(makeMinimalDeps());
    DDH.registerExternalDndBridge();
    expect(() => window.__lexeraExternalDnd.clear()).not.toThrow();
  });

  it('lets the next hover re-insert indicators (drag type tracker is reset)', () => {
    const insertSpy = vi.fn();
    DDH.init(makeMinimalDeps({ insertDropZoneIndicators: insertSpy }));
    DDH.registerExternalDndBridge();
    window.__lexeraExternalDnd.hover({ type: 'tree-card', source: { boardId: 'b' } }, 1, 1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    window.__lexeraExternalDnd.clear();
    window.__lexeraExternalDnd.hover({ type: 'tree-card', source: { boardId: 'b' } }, 2, 2);
    // After clear, the next hover should treat 'tree-card' as a fresh type
    // and re-call insertDropZoneIndicators rather than skipping it.
    expect(insertSpy).toHaveBeenCalledTimes(2);
  });
});
