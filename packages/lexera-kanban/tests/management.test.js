import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createElement(tagName = 'div') {
  return {
    tagName: String(tagName).toUpperCase(),
    innerHTML: '',
    textContent: '',
    value: '',
    className: '',
    children: [],
    style: {},
    attributes: {},
    classList: {
      add() {},
      remove() {},
      toggle() { return false; },
      contains() { return false; }
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((entry) => entry !== child);
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : '';
    },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

function createContainer(selectorMap) {
  return {
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      return Object.prototype.hasOwnProperty.call(selectorMap, selector) ? selectorMap[selector] : null;
    },
    querySelectorAll() {
      return [];
    }
  };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('management workspace invite permissions', () => {
  it('removes the empty configuration tab from shared presets while keeping config deep links compatible', async () => {
    const ManagementUI = loadIIFE('management.js', 'ManagementUI', {
      window: {},
      document: {
        createElement: (tagName) => createElement(tagName),
        addEventListener() {},
        removeEventListener() {}
      },
      console,
      setTimeout,
      clearTimeout
    });

    expect(ManagementUI.getUiPreset('combinedManagement').topTabs).toEqual(['sharing', 'network', 'logs']);
    expect(ManagementUI.getUiPreset('backendSettings').topTabs).toEqual(['network', 'logs']);
    expect(ManagementUI.getUiPreset('backendConfig').topTabs).toEqual(['network']);
    expect(ManagementUI.getTopTabForContext('config', 'backendSettings')).toBe('network');
    expect(ManagementUI.getTopTabForContext('config', 'combinedManagement')).toBe('network');
  });

  it('renders a permission message instead of invite controls after workspace invite 403', async () => {
    const workspacesList = createElement();
    const defaultWorkspaceSelect = createElement('select');
    const invitesList = createElement();
    const container = createContainer({
      '#mgmt-workspaces-list': workspacesList,
      '#mgmt-default-workspace-select': defaultWorkspaceSelect,
      '[data-mgmt-ws-invites-list="ws-1"]': invitesList
    });
    const document = {
      createElement: (tagName) => createElement(tagName),
      addEventListener() {},
      removeEventListener() {}
    };
    const api = {
      get: vi.fn(async (path) => {
        if (path === '/collab/me') return { id: 'u1', name: 'Test User' };
        if (path === '/collab/server-info') return { address: '127.0.0.1', port: 13080, bind_address: '127.0.0.1' };
        if (path === '/collab/network-interfaces') return { interfaces: [], current_bind_address: '127.0.0.1', current_port: 13080, default_port: 13080 };
        if (path === '/config/workspaces') {
          return {
            workspaces: [{ id: 'ws-1', name: 'Workspace 1' }],
            default_workspace: 'ws-1'
          };
        }
        if (path === '/collab/workspaces/ws-1/invites') {
          const error = new Error('403: Forbidden');
          error.status = 403;
          throw error;
        }
        return {};
      }),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    };

    const ManagementUI = loadIIFE('management.js', 'ManagementUI', {
      window: {},
      document,
      console,
      setTimeout,
      clearTimeout
    });

    ManagementUI.init({
      container,
      api,
      callbacks: { onWorkspacesLoaded() {} },
      ui: { topTabs: ['network', 'workspaces'], defaultTopTab: 'network', themeEnabled: false }
    });

    await flush();
    ManagementUI.refresh('workspaces');
    await flush();

    expect(workspacesList.innerHTML).toContain('You can manage workspace invites only if you own at least one board in this workspace.');
    expect(workspacesList.innerHTML).not.toContain('create-workspace-invite');
  });
});
