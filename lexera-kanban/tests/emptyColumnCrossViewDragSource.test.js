// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');
const appSrc = readFileSync(resolve(srcDir, 'app.js'), 'utf-8');

function loadDndListeners() {
  const source = readFileSync(resolve(srcDir, 'dragdrop/dndListeners.js'), 'utf-8');
  const wrappedSource = `
    ${source}
    return LexeraDndListeners;
  `;
  return new Function(wrappedSource)();
}

function dispatchMouse(target, type, x, y) {
  const ev = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  target.dispatchEvent(ev);
  return ev;
}

function buildColumnDom({ withCard = false } = {}) {
  document.body.innerHTML =
    '<div id="board-list"></div>' +
    '<div id="columns-container">' +
      '<div class="board-row" data-row-index="0" data-row-id="row-main">' +
        '<div class="board-row-content">' +
          '<div class="board-stack" data-row-index="0" data-stack-index="0" data-row-id="row-main" data-stack-id="stack-main">' +
            '<div class="board-stack-content">' +
              '<div class="column" data-row-index="0" data-stack-index="0" data-col-local-index="0" data-col-index="0" data-row-id="row-main" data-stack-id="stack-main" data-column-id="col-empty">' +
                '<div class="column-header"><span class="column-title">Empty column</span></div>' +
                '<div class="column-cards" data-col-index="0" data-row-id="row-main" data-stack-id="stack-main" data-column-id="col-empty">' +
                  (withCard ? '<div class="card" data-card-id="card-1" data-col-index="0" data-card-index="0">Card</div>' : '') +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  return {
    container: document.getElementById('columns-container'),
    boardList: document.getElementById('board-list'),
    title: document.querySelector('.column-title'),
  };
}

function bindDndListeners(dom) {
  const DndListeners = loadDndListeners();
  let ptrDrag = null;
  const startCalls = [];
  const DDH = {
    getPtrDrag: () => ptrDrag,
    setPtrDrag: (value) => { ptrDrag = value; },
    getCardDrag: () => null,
  };

  DndListeners.init({
    getElColumnsContainer: () => dom.container,
    getElBoardList: () => dom.boardList,
    getActiveBoardId: () => 'board-source',
    getDragDropHandlers: () => DDH,
    isCanvasBoardLayout: () => false,
    toTopFramePoint: (win, x, y) => ({ x, y }),
    startCrossViewBridge: (kind) => { startCalls.push(kind); },
    stopCrossViewBridge: vi.fn(),
    targetClosest: (target, selector) => target && target.closest ? target.closest(selector) : null,
    clearCardSelection: vi.fn(),
    unfocusCard: vi.fn(),
    logFrontendIssue: vi.fn(),
  });
  DndListeners.bindAll();
  return { DDH, startCalls };
}

describe('empty kanban column cross-view drag source', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('arms an empty column title as a column drag source with stable IDs', () => {
    const dom = buildColumnDom({ withCard: false });
    const { DDH, startCalls } = bindDndListeners(dom);

    dispatchMouse(dom.title, 'mousedown', 24, 24);

    const ptr = DDH.getPtrDrag();
    expect(ptr).toBeTruthy();
    expect(ptr.type).toBe('column');
    expect(ptr.source).toMatchObject({
      type: 'column',
      boardId: 'board-source',
      rowIndex: 0,
      stackIndex: 0,
      colIndex: 0,
      rowId: 'row-main',
      stackId: 'stack-main',
      columnId: 'col-empty',
      indexMode: 'display',
    });
    expect(startCalls).toEqual(['ptr']);
  });

  it('leaves non-empty column titles out of drag arming for rename/edit gestures', () => {
    const dom = buildColumnDom({ withCard: true });
    const { DDH, startCalls } = bindDndListeners(dom);

    dispatchMouse(dom.title, 'mousedown', 24, 24);

    expect(DDH.getPtrDrag()).toBeNull();
    expect(startCalls).toEqual([]);
  });

  it('renders stable parent ids onto column drag surfaces', () => {
    const colIdx = appSrc.indexOf('function buildColumnElement');
    expect(colIdx).toBeGreaterThan(-1);
    const colBlock = appSrc.slice(colIdx, colIdx + 7000);
    expect(colBlock).toMatch(/colEl\.setAttribute\(\s*['"]data-row-id['"]/);
    expect(colBlock).toMatch(/colEl\.setAttribute\(\s*['"]data-stack-id['"]/);
    expect(colBlock).toMatch(/cardsEl\.setAttribute\(\s*['"]data-row-id['"]/);
    expect(colBlock).toMatch(/cardsEl\.setAttribute\(\s*['"]data-stack-id['"]/);

    const stackIdx = appSrc.indexOf('function buildStackElement');
    expect(stackIdx).toBeGreaterThan(-1);
    const stackBlock = appSrc.slice(stackIdx, stackIdx + 1800);
    expect(stackBlock).toMatch(/stackEl\.setAttribute\(\s*['"]data-row-id['"]/);
  });
});
