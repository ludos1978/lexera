// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HierarchyController = require('../src/hierarchy/hierarchyController.js');

function flushMicrotasks() {
  return Promise.resolve().then(() => Promise.resolve());
}

function createBoardData() {
  return {
    title: 'Board',
    rows: [{
      id: 'row-1',
      title: 'Row A',
      stacks: [{
        id: 'stack-1',
        title: 'Stack A',
        columns: [{
          id: 'col-1',
          index: 0,
          title: 'Column A',
          cards: []
        }]
      }]
    }],
    columns: []
  };
}

function createCardBoardData(cards) {
  return {
    title: 'Board',
    rows: [{
      id: 'row-1',
      title: 'Row A',
      stacks: [{
        id: 'stack-1',
        title: 'Stack A',
        columns: [{
          id: 'col-1',
          index: 0,
          title: 'Column A',
          cards: cards || []
        }]
      }]
    }],
    columns: []
  };
}

const sidebarTreeApi = {
  cardPreviewText(content) {
    if (!content) return '';
    const text = String(content)
      .replace(/^#+\s*/gm, '')
      .replace(/\*\*|__|\*|_|~~|`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    const firstLine = text.split('\n')[0].trim();
    return firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;
  },
  isHiddenCard(content) {
    return /#hidden-internal-(?:deleted|archived|parked|incoming)\b|(^|\s)#hidden(\s|$)/.test(content || '');
  }
};

function loadBoardList() {
  return loadIIFE('board/boardList.js', 'LexeraBoardList', {
    window,
    document,
    localStorage: window.localStorage,
    requestAnimationFrame: window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : (fn) => setTimeout(fn, 0),
    structuredClone,
    lexeraLog: vi.fn(),
    logFrontendIssue: vi.fn(),
    traceFrontendAction: vi.fn()
  });
}

describe('LexeraBoardList hierarchy inline edit', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    if (window.localStorage && typeof window.localStorage.clear === 'function') {
      window.localStorage.clear();
    }
  });

  it('renames row nodes inline and commits through the hierarchy edit seam', async () => {
    const BoardList = loadBoardList();
    const boardData = createBoardData();
    const commitHierarchyTreeEdit = vi.fn(async () => true);
    const pushUndo = vi.fn();

    BoardList.init({
      get activeBoardId() { return 'board-1'; },
      getHierarchyControllerApi: () => HierarchyController,
      getSidebarTreeApi: () => sidebarTreeApi,
      loadBoardDataForMutation: vi.fn(async () => boardData),
      commitHierarchyTreeEdit,
      pushUndo,
      stripHtmlComments: (text) => String(text || ''),
      rebuildTitleWithPreservedComments: (nextTitle) => nextTitle,
      reconstructColumnTitle: (nextTitle) => nextTitle,
      extractIncludePathFromTitle: () => '',
      addIncludeSyntaxToTitle: (title) => title,
      removeIncludeSyntaxFromTitle: (title) => title,
      stripLayoutTags: (title) => title,
      showNotification: vi.fn()
    });

    const treeNode = document.createElement('div');
    treeNode.className = 'tree-node tree-row';
    treeNode.setAttribute('data-board-id', 'board-1');
    treeNode.setAttribute('data-row-id', 'row-1');
    treeNode.setAttribute('data-row-index', '0');
    treeNode.innerHTML = '<span class="tree-label">Row A</span>';
    document.body.appendChild(treeNode);

    const handled = await BoardList.beginHierarchyNodeInlineEdit(treeNode, 'board-1');
    expect(handled).toBe(true);

    const input = treeNode.querySelector('input');
    expect(input).toBeTruthy();
    input.value = 'Row B';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await flushMicrotasks();

    expect(boardData.rows[0].title).toBe('Row B');
    expect(pushUndo).toHaveBeenCalledTimes(1);
    expect(commitHierarchyTreeEdit).toHaveBeenCalledWith('board-1', boardData, {
      targets: [{ type: 'row', rowIndex: 0 }, { type: 'sidebar' }]
    });
    expect(treeNode.querySelector('.tree-label').textContent).toBe('Row B');
  });

  it('renames board nodes inline and preserves the board title label markup', async () => {
    const BoardList = loadBoardList();
    const boardData = createBoardData();
    const commitHierarchyTreeEdit = vi.fn(async () => true);
    const pushUndo = vi.fn();

    BoardList.init({
      get activeBoardId() { return 'board-1'; },
      getHierarchyControllerApi: () => HierarchyController,
      getSidebarTreeApi: () => sidebarTreeApi,
      loadBoardDataForMutation: vi.fn(async () => boardData),
      commitHierarchyTreeEdit,
      pushUndo,
      stripHtmlComments: (text) => String(text || ''),
      rebuildTitleWithPreservedComments: (nextTitle) => nextTitle,
      reconstructColumnTitle: (nextTitle) => nextTitle,
      extractIncludePathFromTitle: () => '',
      addIncludeSyntaxToTitle: (title) => title,
      removeIncludeSyntaxFromTitle: (title) => title,
      stripLayoutTags: (title) => title,
      showNotification: vi.fn()
    });

    const treeNode = document.createElement('div');
    treeNode.className = 'board-item tree-node tree-board';
    treeNode.setAttribute('data-board-id', 'board-1');
    treeNode.innerHTML = '<span class="tree-label board-item-title"><span class="board-item-title-text">Board</span></span>';
    document.body.appendChild(treeNode);

    const handled = await BoardList.beginHierarchyNodeInlineEdit(treeNode, 'board-1');
    expect(handled).toBe(true);

    const input = treeNode.querySelector('input');
    expect(input).toBeTruthy();
    input.value = 'Board B';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await flushMicrotasks();

    expect(boardData.title).toBe('Board B');
    expect(pushUndo).toHaveBeenCalledTimes(1);
    expect(commitHierarchyTreeEdit).toHaveBeenCalledWith('board-1', boardData, {
      targets: [{ type: 'board' }, { type: 'sidebar' }]
    });
    expect(treeNode.querySelector('.board-item-title-text')).toBeTruthy();
    expect(treeNode.querySelector('.board-item-title-text').textContent).toBe('Board B');
  });

  it('edits card nodes inline with a multiline editor and targeted card refresh', async () => {
    const BoardList = loadBoardList();
    const boardData = createCardBoardData([{
      id: 'card-1',
      content: 'Old title\nOld body'
    }]);
    const commitHierarchyTreeEdit = vi.fn(async () => true);
    const pushUndo = vi.fn();

    BoardList.init({
      get activeBoardId() { return 'board-1'; },
      getHierarchyControllerApi: () => HierarchyController,
      getSidebarTreeApi: () => sidebarTreeApi,
      loadBoardDataForMutation: vi.fn(async () => boardData),
      commitHierarchyTreeEdit,
      pushUndo,
      stripHtmlComments: (text) => String(text || ''),
      rebuildTitleWithPreservedComments: (nextTitle) => nextTitle,
      reconstructColumnTitle: (nextTitle) => nextTitle,
      extractIncludePathFromTitle: () => '',
      addIncludeSyntaxToTitle: (title) => title,
      removeIncludeSyntaxFromTitle: (title) => title,
      stripLayoutTags: (title) => title,
      showNotification: vi.fn()
    });

    const treeNode = document.createElement('div');
    treeNode.className = 'tree-node tree-card';
    treeNode.setAttribute('data-board-id', 'board-1');
    treeNode.setAttribute('data-row-id', 'row-1');
    treeNode.setAttribute('data-stack-id', 'stack-1');
    treeNode.setAttribute('data-column-id', 'col-1');
    treeNode.setAttribute('data-card-id', 'card-1');
    treeNode.setAttribute('data-row-index', '0');
    treeNode.setAttribute('data-stack-index', '0');
    treeNode.setAttribute('data-col-local-index', '0');
    treeNode.setAttribute('data-col-index', '0');
    treeNode.setAttribute('data-card-index', '0');
    treeNode.innerHTML = '<span class="tree-label">Old title</span>';
    document.body.appendChild(treeNode);

    const handled = await BoardList.beginHierarchyNodeInlineEdit(treeNode, 'board-1');
    expect(handled).toBe(true);

    const input = treeNode.querySelector('textarea');
    expect(input).toBeTruthy();
    input.value = '# New title\nNew body';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));

    await flushMicrotasks();

    expect(boardData.rows[0].stacks[0].columns[0].cards[0].content).toBe('# New title\nNew body');
    expect(pushUndo).toHaveBeenCalledTimes(1);
    expect(commitHierarchyTreeEdit).toHaveBeenCalledWith('board-1', boardData, {
      targets: [{ type: 'card', colIndex: 0, cardIndex: 0 }, { type: 'sidebar' }]
    });
    expect(treeNode.querySelector('.tree-label').textContent).toBe('New title');
  });

  it('resolves fallback card edits by visible index even when hidden cards precede them', async () => {
    const BoardList = loadBoardList();
    const boardData = createCardBoardData([
      { content: '#hidden-internal-archived Hidden card' },
      { content: 'Visible A' },
      { content: 'Visible B' }
    ]);
    const commitHierarchyTreeEdit = vi.fn(async () => true);

    BoardList.init({
      get activeBoardId() { return 'board-1'; },
      getHierarchyControllerApi: () => HierarchyController,
      getSidebarTreeApi: () => sidebarTreeApi,
      loadBoardDataForMutation: vi.fn(async () => boardData),
      commitHierarchyTreeEdit,
      pushUndo: vi.fn(),
      stripHtmlComments: (text) => String(text || ''),
      rebuildTitleWithPreservedComments: (nextTitle) => nextTitle,
      reconstructColumnTitle: (nextTitle) => nextTitle,
      extractIncludePathFromTitle: () => '',
      addIncludeSyntaxToTitle: (title) => title,
      removeIncludeSyntaxFromTitle: (title) => title,
      stripLayoutTags: (title) => title,
      showNotification: vi.fn()
    });

    const treeNode = document.createElement('div');
    treeNode.className = 'tree-node tree-card';
    treeNode.setAttribute('data-board-id', 'board-1');
    treeNode.setAttribute('data-row-id', 'row-1');
    treeNode.setAttribute('data-stack-id', 'stack-1');
    treeNode.setAttribute('data-column-id', 'col-1');
    treeNode.setAttribute('data-row-index', '0');
    treeNode.setAttribute('data-stack-index', '0');
    treeNode.setAttribute('data-col-local-index', '0');
    treeNode.setAttribute('data-col-index', '0');
    treeNode.setAttribute('data-card-index', '1');
    treeNode.innerHTML = '<span class="tree-label">Visible B</span>';
    document.body.appendChild(treeNode);

    await BoardList.beginHierarchyNodeInlineEdit(treeNode, 'board-1');

    const input = treeNode.querySelector('textarea');
    expect(input).toBeTruthy();
    input.value = 'Visible B updated';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));

    await flushMicrotasks();

    expect(boardData.rows[0].stacks[0].columns[0].cards[1].content).toBe('Visible A');
    expect(boardData.rows[0].stacks[0].columns[0].cards[2].content).toBe('Visible B updated');
    expect(commitHierarchyTreeEdit).toHaveBeenCalledWith('board-1', boardData, {
      targets: [{ type: 'card', colIndex: 0, cardIndex: 1 }, { type: 'sidebar' }]
    });
  });

  it('starts inline card editing inside mirrored hierarchy views on double click', async () => {
    const BoardList = loadBoardList();
    const boardData = createCardBoardData([{
      id: 'card-1',
      content: 'Card A'
    }]);

    BoardList.init({
      getHierarchyControllerApi: () => HierarchyController,
      getSidebarTreeApi: () => sidebarTreeApi,
      loadBoardDataForMutation: vi.fn(async () => boardData),
      commitHierarchyTreeEdit: vi.fn(async () => true),
      stripHtmlComments: (text) => String(text || ''),
      rebuildTitleWithPreservedComments: (nextTitle) => nextTitle,
      reconstructColumnTitle: (nextTitle) => nextTitle,
      extractIncludePathFromTitle: () => '',
      addIncludeSyntaxToTitle: (title) => title,
      removeIncludeSyntaxFromTitle: (title) => title,
      stripLayoutTags: (title) => title,
      showNotification: vi.fn()
    });

    const mirrorRoot = document.createElement('div');
    mirrorRoot.innerHTML = `
      <div class="board-item-wrapper" data-board-id="board-1">
        <div class="tree-node tree-card" data-board-id="board-1" data-row-id="row-1" data-stack-id="stack-1" data-column-id="col-1" data-card-id="card-1" data-row-index="0" data-stack-index="0" data-col-local-index="0" data-col-index="0" data-card-index="0">
          <span class="tree-label">Card A</span>
        </div>
      </div>
    `;
    document.body.appendChild(mirrorRoot);

    BoardList.bindMirroredWorkspaceView(mirrorRoot);

    const label = mirrorRoot.querySelector('.tree-label');
    label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

    await flushMicrotasks();

    expect(mirrorRoot.querySelector('textarea')).toBeTruthy();
  });

  it('starts inline board title editing inside mirrored workspace views on double click', async () => {
    const BoardList = loadBoardList();
    const boardData = createBoardData();
    const commitHierarchyTreeEdit = vi.fn(async () => true);

    BoardList.init({
      get activeBoardId() { return 'board-1'; },
      getHierarchyControllerApi: () => HierarchyController,
      getSidebarTreeApi: () => sidebarTreeApi,
      loadBoardDataForMutation: vi.fn(async () => boardData),
      commitHierarchyTreeEdit,
      pushUndo: vi.fn(),
      stripHtmlComments: (text) => String(text || ''),
      rebuildTitleWithPreservedComments: (nextTitle) => nextTitle,
      reconstructColumnTitle: (nextTitle) => nextTitle,
      extractIncludePathFromTitle: () => '',
      addIncludeSyntaxToTitle: (title) => title,
      removeIncludeSyntaxFromTitle: (title) => title,
      stripLayoutTags: (title) => title,
      showNotification: vi.fn()
    });

    const mirrorRoot = document.createElement('div');
    mirrorRoot.innerHTML = `
      <div class="board-item-wrapper" data-board-id="board-1">
        <div class="board-item tree-node tree-board" data-board-id="board-1">
          <span class="tree-label board-item-title"><span class="board-item-title-text">Board</span></span>
        </div>
      </div>
    `;
    document.body.appendChild(mirrorRoot);

    BoardList.bindMirroredWorkspaceView(mirrorRoot);

    const label = mirrorRoot.querySelector('.board-item-title-text');
    label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

    await flushMicrotasks();

    const input = mirrorRoot.querySelector('input');
    expect(input).toBeTruthy();
    input.value = 'Board C';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await flushMicrotasks();

    expect(boardData.title).toBe('Board C');
    expect(commitHierarchyTreeEdit).toHaveBeenCalledWith('board-1', boardData, {
      targets: [{ type: 'board' }, { type: 'sidebar' }]
    });
    expect(mirrorRoot.querySelector('.board-item-title-text').textContent).toBe('Board C');
  });
});
