import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'views', 'files', 'files.js'),
  'utf8'
);

function loadFilesView(window) {
  const factory = new Function('window', 'document', source);
  factory(window, window.document);
}

function createDom() {
  return new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <div class="shell-settings-panel lexera-shared-panel lexera-shared-panel-files">
          <div class="shell-settings-container lexera-shared-files-container view-loading"
               id="mgmt-container"></div>
        </div>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/files/index.html?panelKind=files&pane=tab-1' });
}

describe('files view sub-app', () => {
  it('boots through LexeraSubApp.init and mounts ManagementUI under the files preset', () => {
    const dom = createDom();
    const { window } = dom;
    const subAppInit = vi.fn();
    const mgmtMount = vi.fn();
    const apiAdapter = { get: vi.fn() };
    window.LexeraSubApp = { init: subAppInit };
    window.ManagementUI = {
      unmount: vi.fn(),
      mount: mgmtMount,
      getUiPreset: vi.fn(() => ({ sections: [] }))
    };
    window.LexeraSettingsRuntime = {
      buildBackendApiAdapter: vi.fn(() => apiAdapter),
      buildBackendCallbacks: vi.fn(() => ({}))
    };

    loadFilesView(window);

    expect(subAppInit).toHaveBeenCalledWith(expect.objectContaining({
      onCustom: expect.objectContaining({
        'management-refresh': expect.any(Function)
      }),
      onTeardown: expect.any(Function)
    }));
    expect(window.ManagementUI.unmount).toHaveBeenCalledWith('files');
    expect(window.ManagementUI.getUiPreset).toHaveBeenCalledWith('files');
    expect(mgmtMount).toHaveBeenCalledTimes(1);
    const [presetName, opts] = mgmtMount.mock.calls[0];
    expect(presetName).toBe('files');
    expect(opts.container).toBe(window.document.getElementById('mgmt-container'));
    expect(opts.api).toBe(apiAdapter);
  });

  it('refreshes the files management surface when the shell broadcasts management-refresh', () => {
    const dom = createDom();
    const { window } = dom;
    const subAppInit = vi.fn();
    const refresh = vi.fn();
    window.LexeraSubApp = { init: subAppInit };
    window.ManagementUI = {
      unmount: vi.fn(),
      refresh,
      mount: vi.fn(),
      getUiPreset: vi.fn(() => ({ sections: [] }))
    };
    window.LexeraSettingsRuntime = {
      buildBackendApiAdapter: vi.fn(() => ({})),
      buildBackendCallbacks: vi.fn(() => ({}))
    };

    loadFilesView(window);

    const onCustom = subAppInit.mock.calls[0][0].onCustom;
    onCustom['management-refresh']({ section: 'peers' });
    onCustom['management-refresh']({});

    expect(refresh).toHaveBeenNthCalledWith(1, 'peers');
    expect(refresh).toHaveBeenNthCalledWith(2);
  });

  it('unmounts the files management surface on teardown', () => {
    const dom = createDom();
    const { window } = dom;
    const subAppInit = vi.fn();
    const unmount = vi.fn();
    window.LexeraSubApp = { init: subAppInit };
    window.ManagementUI = {
      unmount,
      mount: vi.fn(),
      getUiPreset: vi.fn(() => ({ sections: [] }))
    };
    window.LexeraSettingsRuntime = {
      buildBackendApiAdapter: vi.fn(() => ({})),
      buildBackendCallbacks: vi.fn(() => ({}))
    };

    loadFilesView(window);

    const initOpts = subAppInit.mock.calls[0][0];
    initOpts.onTeardown();
    expect(unmount).toHaveBeenCalledTimes(2);
  });

  it('surfaces failures inline when ManagementUI is missing', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    window.LexeraSettingsRuntime = {
      buildBackendApiAdapter: vi.fn(() => ({})),
      buildBackendCallbacks: vi.fn(() => ({}))
    };

    expect(() => loadFilesView(window)).not.toThrow();
    const container = window.document.getElementById('mgmt-container');
    expect(container.textContent).toContain('Failed to initialize workspace settings');
    expect(container.classList.contains('view-loading')).toBe(false);
  });

  it('surfaces failures inline when ManagementUI.mount itself throws', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    window.ManagementUI = {
      unmount: vi.fn(),
      mount: vi.fn(() => { throw new Error('mount failed'); }),
      getUiPreset: vi.fn()
    };
    window.LexeraSettingsRuntime = {
      buildBackendApiAdapter: vi.fn(() => ({})),
      buildBackendCallbacks: vi.fn(() => ({}))
    };

    loadFilesView(window);

    expect(window.document.getElementById('mgmt-container').textContent)
      .toContain('mount failed');
  });

  // ── User-interaction API exercise ────────────────────────────────
  // Drives the files sub-app ONLY through LexeraFilesTestApi. The
  // sub-app is a thin wrapper around ManagementUI, so the user-
  // visible surface owned by THIS file is just the mount state, the
  // inline error block, and the management-refresh hook fired by the
  // shell. A regression that breaks any of those flips collectState.
  it('LexeraFilesTestApi.collectState mirrors mount + error visibility the user sees', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    window.ManagementUI = {
      unmount: vi.fn(),
      mount: vi.fn(),
      getUiPreset: vi.fn(() => ({ sections: [] }))
    };
    window.LexeraSettingsRuntime = {
      buildBackendApiAdapter: vi.fn(() => ({})),
      buildBackendCallbacks: vi.fn(() => ({}))
    };

    loadFilesView(window);

    const state = window.LexeraFilesTestApi.collectState();
    expect(state.mounted).toBe(true);
    expect(state.error).toBe('');
    expect(state.hasErrorBlock).toBe(false);
  });

  it('LexeraFilesTestApi.collectState reports the error path when ManagementUI is missing', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    window.LexeraSettingsRuntime = {
      buildBackendApiAdapter: vi.fn(() => ({})),
      buildBackendCallbacks: vi.fn(() => ({}))
    };

    loadFilesView(window);

    const state = window.LexeraFilesTestApi.collectState();
    expect(state.mounted).toBe(false);
    expect(state.hasErrorBlock).toBe(true);
    expect(state.errorText).toContain('ManagementUI not loaded');
    expect(state.loadingClass).toBe(false);
  });

  it('LexeraFilesTestApi.triggerManagementRefresh fires the same refresh path the shell broadcasts', () => {
    const dom = createDom();
    const { window } = dom;
    const refresh = vi.fn();
    window.LexeraSubApp = { init: vi.fn() };
    window.ManagementUI = {
      unmount: vi.fn(),
      mount: vi.fn(),
      refresh,
      getUiPreset: vi.fn(() => ({ sections: [] }))
    };
    window.LexeraSettingsRuntime = {
      buildBackendApiAdapter: vi.fn(() => ({})),
      buildBackendCallbacks: vi.fn(() => ({}))
    };

    loadFilesView(window);

    expect(window.LexeraFilesTestApi.triggerManagementRefresh('peers')).toBe(true);
    expect(window.LexeraFilesTestApi.triggerManagementRefresh()).toBe(true);
    expect(refresh).toHaveBeenNthCalledWith(1, 'peers');
    expect(refresh).toHaveBeenNthCalledWith(2);
  });
});
