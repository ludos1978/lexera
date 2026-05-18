// @vitest-environment jsdom

// Header "New Board" button in the workspace hierarchy panel.
//
// User feedback (2026-05-18): "right clicking into the workspace
// doesn't have a menu option 'New Board', in the header we could have
// a 'new board' button." The board webviews cover the workspace at the
// OS layer so the right-click rarely lands on shell chrome; the header
// button is the reliable, always-visible path.
//
// These tests assert the user-visible affordance: the button is
// rendered next to the hierarchy menu, and clicking it runs the
// create-new-board flow (and does NOT trigger the hierarchy menu).

import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadSharedPanels() {
  return loadIIFE('workspace/sharedPanels.js', 'window.LexeraSharedPanels', {
    window,
    document
  });
}

function loadBoardList() {
  return loadIIFE('board/boardList.js', 'LexeraBoardList', {
    window,
    document,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    structuredClone,
    lexeraLog: vi.fn(),
    logFrontendIssue: vi.fn(),
    traceFrontendAction: vi.fn()
  });
}

describe('workspace hierarchy panel — New Board button', () => {
  it('renders a New Board button beside the hierarchy menu', () => {
    const SharedPanels = loadSharedPanels();
    const root = SharedPanels.createPanelElement('hierarchy', 'inst-1');

    const btn = root.querySelector('.lexera-shared-new-board');
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('title')).toBe('New board');
    // Lives in the same header-actions row as the hierarchy menu.
    expect(btn.closest('.sidebar-header-actions')).toBeTruthy();
    expect(root.querySelector('.lexera-shared-workspace-menu')).toBeTruthy();
  });

  it('clicking the button runs the create-new-board flow', () => {
    const SharedPanels = loadSharedPanels();
    const BoardList = loadBoardList();
    const root = SharedPanels.createPanelElement('hierarchy', 'inst-2');
    document.body.appendChild(root);

    const createNewBoard = vi.fn();
    const showSidebarHierarchyMenu = vi.fn();
    BoardList.init({ createNewBoard, showSidebarHierarchyMenu });
    BoardList.bindMirroredWorkspaceView(root);

    root.querySelector('.lexera-shared-new-board')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(createNewBoard).toHaveBeenCalledTimes(1);
    expect(showSidebarHierarchyMenu).not.toHaveBeenCalled();
  });

  it('still routes the hierarchy menu button to its own handler', () => {
    const SharedPanels = loadSharedPanels();
    const BoardList = loadBoardList();
    const root = SharedPanels.createPanelElement('hierarchy', 'inst-3');
    document.body.appendChild(root);

    const createNewBoard = vi.fn();
    const showSidebarHierarchyMenu = vi.fn();
    BoardList.init({ createNewBoard, showSidebarHierarchyMenu });
    BoardList.bindMirroredWorkspaceView(root);

    root.querySelector('.lexera-shared-workspace-menu')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(showSidebarHierarchyMenu).toHaveBeenCalledTimes(1);
    expect(createNewBoard).not.toHaveBeenCalled();
  });

  it('keeps mirrored board burger pointer events clickable and opens the board menu', () => {
    const BoardList = loadBoardList();
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="board-item-wrapper" data-workspace-id="ws-1">
        <div class="board-item tree-board" data-board-id="board-1">
          <button class="board-item-ws-menu" type="button">menu</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const showNativeMenu = vi.fn(() => Promise.resolve(null));
    BoardList.init({
      boards: [{ id: 'board-1', title: 'Board One', filePath: '/tmp/board-one.md' }],
      showNativeMenu
    });
    BoardList.bindMirroredWorkspaceView(root);

    const menuButton = root.querySelector('.board-item-ws-menu');
    const pointerDown = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    menuButton.dispatchEvent(pointerDown);
    expect(pointerDown.defaultPrevented).toBe(false);

    const mouseDown = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    menuButton.dispatchEvent(mouseDown);
    expect(mouseDown.defaultPrevented).toBe(false);

    menuButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(showNativeMenu).toHaveBeenCalledTimes(1);
    expect(showNativeMenu.mock.calls[0][0].map((item) => item.id)).toContain('open-tab');
  });
});
