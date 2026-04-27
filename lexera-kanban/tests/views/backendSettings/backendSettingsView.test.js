import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'views', 'backendSettings', 'backendSettings.js'),
  'utf8'
);

function loadBackendSettingsView(window) {
  const factory = new Function('window', 'document', source);
  factory(window, window.document);
}

function createDom() {
  return new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <div class="shell-settings-panel lexera-shared-panel lexera-shared-panel-backend-settings">
          <div class="shell-settings-container lexera-shared-backend-settings-container view-loading"
               id="mgmt-container"></div>
        </div>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/backendSettings/index.html?panelKind=backendSettings&pane=tab-1' });
}

describe('backendSettings view sub-app', () => {
  it('boots through LexeraSubApp.init and mounts ManagementUI with the backendSettings preset', () => {
    const dom = createDom();
    const { window } = dom;
    const subAppInit = vi.fn();
    const mgmtInit = vi.fn();
    const apiAdapter = { get: vi.fn(), post: vi.fn() };
    const callbacks = { onSaved: vi.fn() };
    window.LexeraSubApp = { init: subAppInit };
    window.ManagementUI = {
      destroy: vi.fn(),
      init: mgmtInit,
      getUiPreset: vi.fn(() => ({ sections: [] }))
    };
    window.LexeraSettingsRuntime = {
      buildBackendApiAdapter: vi.fn(() => apiAdapter),
      buildBackendCallbacks: vi.fn(() => callbacks)
    };

    loadBackendSettingsView(window);

    expect(subAppInit).toHaveBeenCalledWith(expect.objectContaining({
      onCustom: expect.objectContaining({
        'management-refresh': expect.any(Function)
      }),
      onTeardown: expect.any(Function)
    }));
    expect(window.ManagementUI.destroy).toHaveBeenCalledTimes(1);
    expect(window.ManagementUI.getUiPreset).toHaveBeenCalledWith('backendSettings');
    expect(mgmtInit).toHaveBeenCalledTimes(1);
    const opts = mgmtInit.mock.calls[0][0];
    expect(opts.container).toBe(window.document.getElementById('mgmt-container'));
    expect(opts.api).toBe(apiAdapter);
    expect(opts.callbacks).toBe(callbacks);
  });

  it('refreshes the management surface when the shell broadcasts management-refresh', () => {
    const dom = createDom();
    const { window } = dom;
    const subAppInit = vi.fn();
    const refresh = vi.fn();
    window.LexeraSubApp = { init: subAppInit };
    window.ManagementUI = {
      destroy: vi.fn(),
      refresh,
      init: vi.fn(),
      getUiPreset: vi.fn(() => ({ sections: [] }))
    };
    window.LexeraSettingsRuntime = {
      buildBackendApiAdapter: vi.fn(() => ({})),
      buildBackendCallbacks: vi.fn(() => ({}))
    };

    loadBackendSettingsView(window);

    const onCustom = subAppInit.mock.calls[0][0].onCustom;
    onCustom['management-refresh']({ section: 'connections' });
    onCustom['management-refresh']({});

    expect(refresh).toHaveBeenNthCalledWith(1, 'connections');
    expect(refresh).toHaveBeenNthCalledWith(2);
  });

  it('destroys the management mount on teardown', () => {
    const dom = createDom();
    const { window } = dom;
    const subAppInit = vi.fn();
    const destroy = vi.fn();
    window.LexeraSubApp = { init: subAppInit };
    window.ManagementUI = {
      destroy,
      init: vi.fn(),
      getUiPreset: vi.fn(() => ({ sections: [] }))
    };
    window.LexeraSettingsRuntime = {
      buildBackendApiAdapter: vi.fn(() => ({})),
      buildBackendCallbacks: vi.fn(() => ({}))
    };

    loadBackendSettingsView(window);

    const initOpts = subAppInit.mock.calls[0][0];
    initOpts.onTeardown();
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it('surfaces failures inline when ManagementUI is missing', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    window.LexeraSettingsRuntime = {
      buildBackendApiAdapter: vi.fn(() => ({})),
      buildBackendCallbacks: vi.fn(() => ({}))
    };
    // No ManagementUI

    expect(() => loadBackendSettingsView(window)).not.toThrow();
    const container = window.document.getElementById('mgmt-container');
    expect(container.classList.contains('view-loading')).toBe(false);
    expect(container.textContent).toContain('Failed to initialize backend settings');
    expect(container.textContent).toContain('ManagementUI not loaded');
  });

  it('surfaces failures inline when settings runtime is missing', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    window.ManagementUI = { init: vi.fn(), getUiPreset: vi.fn() };
    // No LexeraSettingsRuntime

    expect(() => loadBackendSettingsView(window)).not.toThrow();
    expect(window.document.getElementById('mgmt-container').textContent)
      .toContain('LexeraSettingsRuntime not loaded');
  });

  it('escapes error message HTML', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    window.ManagementUI = {
      destroy: vi.fn(),
      init: vi.fn(() => { throw new Error('<script>alert(1)</script>'); }),
      getUiPreset: vi.fn()
    };
    window.LexeraSettingsRuntime = {
      buildBackendApiAdapter: vi.fn(() => ({})),
      buildBackendCallbacks: vi.fn(() => ({}))
    };

    loadBackendSettingsView(window);

    const container = window.document.getElementById('mgmt-container');
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
});
