// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function stripHtmlComments(text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadColumnContextMenu() {
  return loadIIFE('menu/columnContextMenu.js', 'LexeraColumnContextMenu', {
    window,
    document,
    structuredClone,
    setTimeout,
    clearTimeout
  });
}

function loadRowStackMenu() {
  window.LexeraMenuContributorRegistry = {
    buildMenu: vi.fn(() => [])
  };
  window.LexeraActionRegistry = {
    dispatch: vi.fn(() => true)
  };
  window.LexeraTemplates = {};
  window.LexeraApi = {};
  return loadIIFE('menu/rowStackMenu.js', 'LexeraRowStackMenu', {
    window,
    document,
    structuredClone,
    Date,
    setTimeout,
    clearTimeout
  });
}

describe('header include text editing', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('opens column title editing with the raw include string and saves it as text', () => {
    const ColumnContextMenu = loadColumnContextMenu();
    const column = {
      title: '!!!include(0500-EN-Schedule.md)!!!'
    };
    const reconstructColumnTitle = vi.fn((nextTitle) => nextTitle);
    const pushUndo = vi.fn();
    const persistBoardMutation = vi.fn();

    ColumnContextMenu.init({
      getFullBoardData: () => ({ rows: [] }),
      getActiveBoardId: () => 'board-1',
      getFullColumn: () => column,
      pushUndo,
      persistBoardMutation,
      reconstructColumnTitle,
      stripHtmlComments,
      stripLayoutTags: (title) => title,
      renderTitleInline: (title) => title
    });

    const colEl = document.createElement('div');
    colEl.innerHTML = '<span class="column-title"></span>';

    ColumnContextMenu.enterColumnRename(colEl, 0);

    const input = colEl.querySelector('input');
    expect(input).toBeTruthy();
    expect(input.value).toBe('!!!include(0500-EN-Schedule.md)!!!');

    input.value = 'Schedule !!!include(0600-FR-Schedule.md)!!!';
    input.dispatchEvent(new FocusEvent('blur'));

    expect(reconstructColumnTitle).toHaveBeenCalledWith(
      'Schedule !!!include(0600-FR-Schedule.md)!!!',
      '!!!include(0500-EN-Schedule.md)!!!'
    );
    expect(column.title).toBe('Schedule !!!include(0600-FR-Schedule.md)!!!');
    expect(pushUndo).toHaveBeenCalledTimes(1);
    expect(persistBoardMutation).toHaveBeenCalledWith({
      targets: [{ type: 'column', colIndex: 0 }]
    });
  });

  it('opens stack title editing with the raw include string and saves it as text', () => {
    const RowStackMenu = loadRowStackMenu();
    const stack = {
      title: '!!!include(0500-EN-Schedule.md)!!!'
    };
    const pushUndo = vi.fn();
    const persistBoardMutation = vi.fn();
    const rebuildTitleWithPreservedComments = vi.fn((nextTitle) => nextTitle);

    const columnsContainer = document.createElement('div');
    columnsContainer.innerHTML = `
      <div class="board-stack" data-row-index="0" data-stack-index="0">
        <div class="board-stack-header">
          <span class="board-stack-title">!!!include(0500-EN-Schedule.md)!!!</span>
        </div>
      </div>
    `;
    document.body.appendChild(columnsContainer);

    RowStackMenu.init({
      getElColumnsContainer: () => columnsContainer,
      findFullDataStack: () => stack,
      pushUndo,
      persistBoardMutation,
      stripHtmlComments,
      rebuildTitleWithPreservedComments,
      closeColumnContextMenu: vi.fn(),
      closeCardContextMenu: vi.fn(),
      showNativeMenu: vi.fn(async () => null),
      showNotification: vi.fn(),
      showConfirmDialog: vi.fn(async () => true),
      logFrontendIssue: vi.fn(),
      traceFrontendAction: vi.fn(),
      lexeraLog: vi.fn()
    });

    RowStackMenu.renameRowOrStack('stack', 0, 0);

    const input = columnsContainer.querySelector('input');
    expect(input).toBeTruthy();
    expect(input.value).toBe('!!!include(0500-EN-Schedule.md)!!!');

    input.value = 'Planning !!!include(0600-FR-Schedule.md)!!!';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(rebuildTitleWithPreservedComments).toHaveBeenCalledWith(
      'Planning !!!include(0600-FR-Schedule.md)!!!',
      '!!!include(0500-EN-Schedule.md)!!!'
    );
    expect(stack.title).toBe('Planning !!!include(0600-FR-Schedule.md)!!!');
    expect(pushUndo).toHaveBeenCalledTimes(1);
    expect(persistBoardMutation).toHaveBeenCalledWith({
      targets: [{ type: 'board' }, { type: 'sidebar' }]
    });
  });
});
