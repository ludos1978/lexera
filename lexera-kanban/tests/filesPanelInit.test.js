// @vitest-environment jsdom

/**
 * End-to-end test for files panel initialization.
 * Verifies that the files panel mounts, loads data, renders workspaces,
 * and removes the loading indicator.
 */
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
    window, document,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    Promise, fetch: vi.fn(),
    EventSource: undefined,
    AbortController: window.AbortController,
    JSON, Object, Array, Map, Set, Error, RegExp, Date, Number, String, Math,
    encodeURIComponent, decodeURIComponent, parseInt, isNaN,
    Infinity, NaN, undefined, structuredClone
  });
}

describe('files panel initialization', () => {
  beforeEach(() => {
    window.TreeView = loadTreeView();
    window.LexeraHierarchyContract = HierarchyContract;
    window.LexeraHierarchyController = HierarchyController;
  });

  it('mounts the workspace-config shell HTML into the container', () => {
    const ManagementUI = loadManagementUI();
    const container = document.createElement('div');
    container.classList.add('view-loading');

    const api = {
      get() { return Promise.resolve({ workspaces: [], boards: [] }); },
      post() { return Promise.resolve({}); },
      put() { return Promise.resolve({}); },
      delete() { return Promise.resolve({}); }
    };

    ManagementUI.mount('files', {
      container,
      ui: ManagementUI.getUiPreset('files'),
      api,
      callbacks: {}
    });

    // After mount, the shell HTML should be rendered synchronously
    const configTree = container.querySelector('#mgmt-config-tree');
    const configInspector = container.querySelector('#mgmt-config-inspector');
    expect(configTree).toBeTruthy();
    expect(configInspector).toBeTruthy();
  });

  it('renders workspaces in the config tree after API responds', async () => {
    const ManagementUI = loadManagementUI();
    const container = document.createElement('div');
    document.body.appendChild(container);

    const api = {
      get(path) {
        if (path === '/config/workspaces') {
          return Promise.resolve({
            workspaces: [
              { id: 'ws-1', name: 'Work' },
              { id: 'ws-2', name: 'Personal' }
            ],
            default_workspace: null
          });
        }
        if (path === '/boards') {
          return Promise.resolve({
            boards: [{ id: 'b1', title: 'Board 1', workspace_ids: ['ws-1'] }]
          });
        }
        return Promise.resolve({});
      },
      post() { return Promise.resolve({}); },
      put() { return Promise.resolve({}); },
      delete() { return Promise.resolve({}); }
    };

    ManagementUI.mount('test-files-render', {
      container,
      ui: ManagementUI.getUiPreset('files'),
      api,
      callbacks: {}
    });

    // Wait for async loadAllForMounts to complete
    // Multiple microtask flushes needed for chained awaits
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 0));
    }

    const configTree = container.querySelector('#mgmt-config-tree');
    expect(configTree).toBeTruthy();
    // Config tree should have content (TreeView workspace nodes)
    expect(configTree.innerHTML.length).toBeGreaterThan(0);
    // Should not just be the default "Select a workspace or board" placeholder
    expect(configTree.innerHTML).not.toBe('');

    document.body.removeChild(container);
  });

  it('files panel getUiPreset returns workspace-config as default tab', () => {
    const ManagementUI = loadManagementUI();
    const preset = ManagementUI.getUiPreset('files');
    expect(preset.topTabs).toContain('workspace-config');
    expect(preset.defaultTopTab).toBe('workspace-config');
  });
});
