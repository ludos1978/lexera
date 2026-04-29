import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '..', 'src', 'views', '_shared', 'subAppRuntime.js'), 'utf8');

function loadSubApp(window, globals = {}) {
  const argNames = ['window', 'document'].concat(Object.keys(globals));
  const argValues = [window, window.document].concat(Object.values(globals));
  const factory = new Function(...argNames, source + '\nreturn window.LexeraSubApp;');
  return factory(...argValues);
}

describe('LexeraSubApp runtime metadata', () => {
  it('exposes panel and window identity from the child webview URL', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/views/log/index.html?panelKind=logs&panel=logs-2&pane=tab-9&windowLabel=panel-tab-tab-9&workspaceShellHostLabel=main'
    });
    const { window } = dom;
    const subApp = loadSubApp(window, { URLSearchParams });

    expect(subApp.getPanelKind()).toBe('logs');
    expect(subApp.getPanelInstanceId()).toBe('logs-2');
    expect(subApp.getPaneId()).toBe('tab-9');
    expect(subApp.getWindowLabel()).toBe('panel-tab-tab-9');
    expect(subApp.getHostWindowLabel()).toBe('main');
    expect(subApp.getContext()).toEqual({
      panelKind: 'logs',
      panelInstanceId: 'logs-2',
      paneId: 'tab-9',
      windowLabel: 'panel-tab-tab-9',
      hostWindowLabel: 'main'
    });
  });

  it('applies workspace-shell-mode root/body classes so legacy panel CSS rules and full-height panel layout work inside the child webview', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/views/hierarchy/index.html?panelKind=hierarchy&panel=hierarchy&pane=tab-77&windowLabel=panel-tab-tab-77&workspaceShellHostLabel=main'
    });
    const { window } = dom;
    const listen = vi.fn();
    window.__TAURI__ = {
      core: { invoke: vi.fn(() => Promise.resolve(null)) },
      webview: {
        getCurrentWebview() { return { label: 'panel-tab-tab-77', listen }; }
      }
    };
    const subApp = loadSubApp(window, {
      URLSearchParams,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });
    subApp.init({ requestTheme: false, reportFocus: false, shortcuts: false });
    expect(window.document.documentElement.classList.contains('workspace-shell-mode')).toBe(true);
    expect(window.document.documentElement.getAttribute('data-shell-panel')).toBe('hierarchy');
    expect(window.document.documentElement.getAttribute('data-shell-pane')).toBe('tab-77');
    expect(window.document.body.classList.contains('workspace-shell-mode')).toBe(true);
    expect(window.document.body.getAttribute('data-shell-panel')).toBe('hierarchy');
    expect(window.document.body.getAttribute('data-shell-pane')).toBe('tab-77');
  });

  it('renders a top-left debug geometry overlay from child-webview geometry events', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/views/hierarchy/index.html?panelKind=hierarchy&panel=hierarchy&pane=tab-77&windowLabel=panel-tab-tab-77&workspaceShellHostLabel=main'
    });
    const { window } = dom;
    const listeners = {};
    window.__TAURI__ = {
      core: { invoke: vi.fn(() => Promise.resolve(null)) },
      webview: {
        getCurrentWebview() {
          return {
            label: 'panel-tab-tab-77',
            listen: vi.fn((eventName, handler) => {
              listeners[eventName] = handler;
            })
          };
        }
      }
    };
    const subApp = loadSubApp(window, {
      URLSearchParams,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });

    subApp.init({ requestTheme: false, reportFocus: false, shortcuts: false });
    expect(window.__TAURI__?.core?.invoke).toHaveBeenCalledWith('multiview_broadcast', {
      event: 'debug-geometry-request',
      payload: { label: 'panel-tab-tab-77' }
    });
    listeners['debug-geometry']({
      payload: {
        kind: 'hierarchy',
        label: 'panel-tab-tab-77',
        adjust: { x: 0, y: 0, width: 0, height: 0 },
        shell: { x: 12.2, y: 32.6, width: 280.1, height: 610.8 },
        native: { x: 12.2, y: 32.6, width: 280.1, height: 610.8 }
      }
    });

    const overlay = window.document.getElementById('lexera-mv-debug-geometry');
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain('panel hierarchy');
    expect(overlay?.textContent).toContain('native 12,33 280x611');
    expect(overlay?.textContent).toContain('shell  12,33 280x611');
    expect(overlay?.textContent).toContain('delta  0,0 0x0');

    const plusButtons = overlay?.querySelectorAll('button') || [];
    plusButtons[1]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(window.__TAURI__?.core?.invoke).toHaveBeenCalledWith('multiview_broadcast', {
      event: 'debug-geometry-adjust',
      payload: {
        label: 'panel-tab-tab-77',
        field: 'x',
        delta: 1
      }
    });
  });

  it('applies root/body layout classes gracefully when there is no Tauri context', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/views/log/index.html'
    });
    const { window } = dom;
    // No __TAURI__ on window — init() should still apply the body class
    // before bailing out, so layout is consistent even in test/fallback runs.
    const subApp = loadSubApp(window, {
      URLSearchParams,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });
    subApp.init({ onError: vi.fn() });
    expect(window.document.documentElement.classList.contains('workspace-shell-mode')).toBe(true);
    expect(window.document.body.classList.contains('workspace-shell-mode')).toBe(true);
  });

  it('emits panel-ready on init and panel-teardown on beforeunload', async () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/views/frontendSettings/index.html?panelKind=frontendSettings&panel=frontendSettings-3&pane=tab-12&windowLabel=panel-tab-tab-12&workspaceShellHostLabel=main'
    });
    const { window } = dom;
    const invoke = vi.fn(() => Promise.resolve(null));
    const listen = vi.fn();
    window.__TAURI__ = {
      core: { invoke },
      webview: {
        getCurrentWebview() {
          return { label: 'panel-tab-tab-12', listen };
        }
      }
    };
    const subApp = loadSubApp(window, {
      URLSearchParams,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });
    const onTeardown = vi.fn();

    subApp.init({
      requestTheme: false,
      reportFocus: false,
      shortcuts: false,
      onTeardown
    });
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', {
      event: 'panel-ready',
      payload: {
        label: 'panel-tab-tab-12',
        at: expect.any(Number),
        paneId: 'tab-12',
        panelKind: 'frontendSettings',
        panelInstanceId: 'frontendSettings-3',
        windowLabel: 'panel-tab-tab-12',
        hostWindowLabel: 'main'
      }
    });

    window.dispatchEvent(new window.Event('beforeunload'));
    await Promise.resolve();

    expect(onTeardown).toHaveBeenCalledTimes(1);

    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', {
      event: 'panel-teardown',
      payload: {
        label: 'panel-tab-tab-12',
        at: expect.any(Number),
        paneId: 'tab-12',
        panelKind: 'frontendSettings',
        panelInstanceId: 'frontendSettings-3',
        windowLabel: 'panel-tab-tab-12',
        hostWindowLabel: 'main'
      }
    });
  });

  it('installs sub-app log helpers that forward into log_broadcast when shell logging is absent', async () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/views/renderApps/index.html?panelKind=renderApps&panel=renderApps-1&pane=tab-4&windowLabel=panel-tab-tab-4&workspaceShellHostLabel=main'
    });
    const { window } = dom;
    const invoke = vi.fn(() => Promise.resolve(null));
    const listen = vi.fn();
    window.__TAURI__ = {
      core: { invoke },
      webview: {
        getCurrentWebview() {
          return { label: 'panel-tab-tab-4', listen };
        }
      }
    };
    const subApp = loadSubApp(window, {
      URLSearchParams,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });

    subApp.init({
      requestTheme: false,
      reportFocus: false,
      shortcuts: false
    });

    window.logFrontendIssue('error', 'render-apps.test-run', 'Test run failed', new Error('boom'));
    window.traceFrontendAction('warn', 'settings.save', 'Saved settings', { panel: 'frontend' });

    await Promise.resolve();

    expect(invoke).toHaveBeenCalledWith('log_broadcast', {
      entry: {
        level: 'error',
        source: 'render-apps.test-run',
        message: expect.stringContaining('Test run failed: Error: boom'),
        timestamp_ms: expect.any(Number)
      }
    });
    expect(invoke).toHaveBeenCalledWith('log_broadcast', {
      entry: {
        level: 'warn',
        source: 'settings.save',
        message: expect.stringContaining('Saved settings'),
        timestamp_ms: expect.any(Number)
      }
    });
  });

  it('installs a child-webview showNotification shim with shell-style dedupe and auto-dismiss', () => {
    vi.useFakeTimers();
    try {
      const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
        url: 'http://127.0.0.1:1431/views/backendSettings/index.html?panelKind=backendSettings&panel=backendSettings-1&pane=tab-5&windowLabel=panel-tab-tab-5&workspaceShellHostLabel=main'
      });
      const { window } = dom;
      const subApp = loadSubApp(window, {
        URLSearchParams,
        setInterval: vi.fn(() => 1),
        clearInterval: vi.fn()
      });

      subApp.init({ onError: vi.fn() });

      expect(typeof window.showNotification).toBe('function');

      window.showNotification('Workspace created');
      window.showNotification('Workspace created');

      expect(window.document.querySelectorAll('.notification')).toHaveLength(1);
      expect(window.document.querySelector('.notification')?.textContent).toContain('Workspace created');

      vi.advanceTimersByTime(3300);
      expect(window.document.querySelector('.notification')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens confirm modals through the shared child-webview runtime', async () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/views/backendSettings/index.html?panelKind=backendSettings&panel=backendSettings-1&pane=tab-5&windowLabel=panel-tab-tab-5&workspaceShellHostLabel=main'
    });
    const { window } = dom;
    let modalHandler = null;
    const unsub = vi.fn();
    const invoke = vi.fn(() => Promise.resolve(null));
    const listen = vi.fn((eventName, handler) => {
      modalHandler = handler;
      return Promise.resolve(unsub);
    });
    window.__TAURI__ = {
      core: { invoke },
      event: { listen },
      webview: {
        getCurrentWebview() {
          return { label: 'panel-tab-tab-5', listen: vi.fn() };
        }
      }
    };
    const subApp = loadSubApp(window, {
      URLSearchParams,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });

    const resultPromise = subApp.confirmModal({ title: 'Confirm delete', message: 'Delete workspace?' });
    await Promise.resolve();

    expect(listen).toHaveBeenCalledWith(expect.stringMatching(/^modal-result-confirm-modal-/), expect.any(Function));
    expect(invoke).toHaveBeenCalledWith('multiview_open_modal_window', {
      spec: expect.objectContaining({
        title: 'Confirm delete',
        url: expect.stringContaining('views/modals/confirm.html?')
      })
    });

    modalHandler({ payload: { accepted: true } });
    await expect(resultPromise).resolves.toBe(true);
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('opens prompt modals through the shared child-webview runtime and unsubscribes after resolve', async () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/views/files/index.html?panelKind=files&panel=files-1&pane=tab-6&windowLabel=panel-tab-tab-6&workspaceShellHostLabel=main'
    });
    const { window } = dom;
    let modalHandler = null;
    const unsub = vi.fn();
    const invoke = vi.fn(() => Promise.resolve(null));
    const listen = vi.fn((eventName, handler) => {
      modalHandler = handler;
      return Promise.resolve(unsub);
    });
    window.__TAURI__ = {
      core: { invoke },
      event: { listen },
      webview: {
        getCurrentWebview() {
          return { label: 'panel-tab-tab-6', listen: vi.fn() };
        }
      }
    };
    const subApp = loadSubApp(window, {
      URLSearchParams,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });

    const resultPromise = subApp.promptModal({
      title: 'Rename workspace',
      message: 'Enter the new name',
      initial: 'Alpha'
    });
    await Promise.resolve();

    expect(listen).toHaveBeenCalledWith(expect.stringMatching(/^modal-result-prompt-modal-/), expect.any(Function));
    expect(invoke).toHaveBeenCalledWith('multiview_open_modal_window', {
      spec: expect.objectContaining({
        title: 'Rename workspace',
        url: expect.stringContaining('views/modals/prompt.html?')
      })
    });

    modalHandler({ payload: { value: 'Beta' } });
    await expect(resultPromise).resolves.toBe('Beta');
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('cleans up a late modal listener when opening the modal window fails', async () => {
    let resolveListen = null;
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/views/backendSettings/index.html?panelKind=backendSettings&panel=backendSettings-1&pane=tab-5&windowLabel=panel-tab-tab-5&workspaceShellHostLabel=main'
    });
    const { window } = dom;
    const unsub = vi.fn();
    const invoke = vi.fn(() => Promise.reject(new Error('open failed')));
    const listen = vi.fn(() => new Promise((resolve) => {
      resolveListen = resolve;
    }));
    window.__TAURI__ = {
      core: { invoke },
      event: { listen },
      webview: {
        getCurrentWebview() {
          return { label: 'panel-tab-tab-5', listen: vi.fn() };
        }
      }
    };
    const subApp = loadSubApp(window, {
      URLSearchParams,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });

    const resultPromise = subApp.confirmModal({ title: 'Confirm delete', message: 'Delete workspace?' });
    await Promise.resolve();
    await expect(resultPromise).resolves.toBe(false);

    resolveListen(unsub);
    await Promise.resolve();

    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
