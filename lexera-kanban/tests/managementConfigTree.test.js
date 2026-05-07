// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HierarchyContract = require('../src/hierarchy/hierarchyContract.js');
const HierarchyController = require('../src/hierarchy/hierarchyController.js');

function loadTreeView() {
  return loadIIFE('treeView.js', 'TreeView', {
    window,
    document,
    getComputedStyle: window.getComputedStyle.bind(window)
  });
}

function loadManagementUI() {
  return loadIIFE(['managementLogViewer.js', 'management.js'], 'ManagementUI', {
    window,
    document,
    console,
    setTimeout,
    clearTimeout
  });
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('ManagementUI config tree hierarchy', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.TreeView = loadTreeView();
    window.LexeraHierarchyContract = HierarchyContract;
    window.LexeraHierarchyController = HierarchyController;
  });

  it('renders the files config catalog through the shared tree view', async () => {
    const api = {
      get: vi.fn(async (path) => {
        if (path === '/config/workspaces') {
          return {
            workspaces: [
              { id: 'ws-1', name: 'Workspace 1' },
              { id: 'ws-2', name: 'Workspace 2' }
            ],
            default_workspace: 'ws-1'
          };
        }
        if (path === '/boards') {
          return {
            boards: [
              { id: 'board-1', title: 'Board One', workspace_ids: ['ws-1'] },
              { id: 'board-2', title: 'Board Two', workspace_ids: ['ws-1'] },
              { id: 'board-3', title: 'Loose Board', workspace_ids: [] }
            ]
          };
        }
        if (path === '/config/global-sync') return {};
        return {};
      }),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const ManagementUI = loadManagementUI();

    ManagementUI.init({
      container,
      api,
      callbacks: {},
      ui: { topTabs: ['workspace-config'], defaultTopTab: 'workspace-config' }
    });

    await flush();
    await flush();

    const tree = container.querySelector('#mgmt-config-tree');
    expect(tree).toBeTruthy();
    expect(tree.classList.contains('tree-view')).toBe(true);
    expect(tree.querySelector('.tree-node[data-mgmt-config-type="global"]')).toBeTruthy();

    const workspaceNode = tree.querySelector('.tree-node[data-mgmt-config-type="workspace"][data-mgmt-config-id="ws-1"]');
    expect(workspaceNode).toBeTruthy();
    expect(workspaceNode.textContent).toContain('Workspace 1');
    expect(workspaceNode.textContent).toContain('2');
    expect(workspaceNode.getAttribute('data-hierarchy-surface')).toBe('files');
    expect(workspaceNode.getAttribute('data-hierarchy-kind')).toBe('workspace');
    expect(workspaceNode.getAttribute('data-tree-root')).toBe('true');
    expect(workspaceNode.getAttribute('data-tree-node-role')).toBe('branch');
    expect(workspaceNode.getAttribute('data-tree-structural-role')).toBe('group');

    const boardNode = tree.querySelector('.tree-node[data-mgmt-config-type="board"][data-mgmt-config-id="board-1"]');
    expect(boardNode).toBeTruthy();
    // mgmt-config-tree-child is no longer applied — board nodes use the
    // shared TreeView indent system instead of custom child CSS classes.
    // TreeView prefixes type → .tree-board.
    expect(boardNode.classList.contains('tree-board')).toBe(true);
    expect(boardNode.getAttribute('data-hierarchy-capabilities')).toBe('activate');
    expect(boardNode.hasAttribute('data-tree-root')).toBe(false);
    expect(boardNode.getAttribute('data-tree-node-role')).toBe('leaf');
    expect(boardNode.getAttribute('data-tree-structural-role')).toBe('item');
    expect(boardNode.querySelectorAll('.tree-indent .indent-guide')).toHaveLength(2);

    const looseBoardNode = tree.querySelector('.tree-node[data-mgmt-config-type="board"][data-mgmt-config-id="board-3"]');
    expect(looseBoardNode).toBeTruthy();
    expect(tree.textContent).toContain('Unassigned');

    expect(tree.querySelector('[data-mgmt-action="config-add-workspace"]')).toBeTruthy();
  });

  it('selects boards through the shared hierarchy controller and rerenders the inspector', async () => {
    const api = {
      get: vi.fn(async (path) => {
        if (path === '/config/workspaces') {
          return {
            workspaces: [{ id: 'ws-1', name: 'Workspace 1' }],
            default_workspace: 'ws-1'
          };
        }
        if (path === '/boards') {
          return {
            boards: [{ id: 'board-1', title: 'Board One', workspace_ids: ['ws-1'] }]
          };
        }
        if (path === '/config/global-sync') return {};
        return {};
      }),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const ManagementUI = loadManagementUI();

    ManagementUI.init({
      container,
      api,
      callbacks: {},
      ui: { topTabs: ['workspace-config'], defaultTopTab: 'workspace-config' }
    });

    await flush();
    await flush();

    const boardNode = container.querySelector('.tree-node[data-mgmt-config-type="board"][data-mgmt-config-id="board-1"]');
    expect(boardNode).toBeTruthy();

    boardNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    const inspector = container.querySelector('#mgmt-config-inspector');
    expect(inspector.textContent).toContain('Board');
    expect(inspector.textContent).toContain('Board One');
    expect(container.querySelector('.tree-node.selected[data-mgmt-config-type="board"][data-mgmt-config-id="board-1"]')).toBeTruthy();
  });
});
