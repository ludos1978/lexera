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

  it('applies workspace-shell-mode body class so legacy panel CSS rules in app.css apply inside the child webview', () => {
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
    expect(window.document.body.classList.contains('workspace-shell-mode')).toBe(true);
    expect(window.document.body.getAttribute('data-shell-panel')).toBe('hierarchy');
    expect(window.document.body.getAttribute('data-shell-pane')).toBe('tab-77');
  });

  it('skips body-class application gracefully when there is no Tauri context', () => {
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
});
