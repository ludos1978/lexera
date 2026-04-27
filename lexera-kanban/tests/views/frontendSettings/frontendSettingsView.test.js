import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'views', 'frontendSettings', 'frontendSettings.js'),
  'utf8'
);

function loadFrontendSettingsView(window) {
  const factory = new Function('window', 'document', source);
  factory(window, window.document);
}

function createDom() {
  return new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <div class="shell-settings-panel frontend-settings-panel lexera-shared-panel lexera-shared-panel-frontend-settings">
          <div class="shell-settings-header"><span class="shell-settings-title">Frontend Settings</span></div>
          <div class="shell-settings-body"></div>
        </div>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/frontendSettings/index.html?panelKind=frontendSettings&pane=tab-1' });
}

describe('frontendSettings view sub-app', () => {
  it('boots through LexeraSubApp.init and forwards options to LexeraFrontendSettings.init', () => {
    const dom = createDom();
    const { window } = dom;
    const subAppInit = vi.fn();
    const fsInit = vi.fn();
    const fsRender = vi.fn();
    const builtOptions = { theme: 'auto', uiScale: 1 };
    window.LexeraSubApp = { init: subAppInit };
    window.LexeraSettingsRuntime = {
      buildFrontendSettingsOptions: vi.fn(() => builtOptions)
    };
    window.LexeraFrontendSettings = { init: fsInit, render: fsRender };

    loadFrontendSettingsView(window);

    expect(subAppInit).toHaveBeenCalledWith(expect.objectContaining({
      onTeardown: expect.any(Function)
    }));
    expect(window.LexeraSettingsRuntime.buildFrontendSettingsOptions).toHaveBeenCalledTimes(1);
    expect(fsInit).toHaveBeenCalledTimes(1);
    const [optsArg, panelArg] = fsInit.mock.calls[0];
    expect(optsArg).toBe(builtOptions);
    expect(panelArg).toBe(window.document.querySelector('.lexera-shared-panel-frontend-settings'));

    window.dispatchEvent(new window.Event('lexera-visual-themes-changed'));
    expect(window.LexeraSettingsRuntime.buildFrontendSettingsOptions).toHaveBeenCalledTimes(2);
    expect(fsRender).toHaveBeenCalledWith(
      builtOptions,
      window.document.querySelector('.lexera-shared-panel-frontend-settings')
    );
  });

  it('surfaces failures inline when LexeraFrontendSettings is missing', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    window.LexeraSettingsRuntime = {
      buildFrontendSettingsOptions: vi.fn(() => ({}))
    };
    // No LexeraFrontendSettings

    expect(() => loadFrontendSettingsView(window)).not.toThrow();
    const errEl = window.document.querySelector('.frontend-settings-error');
    expect(errEl).toBeTruthy();
    expect(errEl.textContent).toContain('LexeraFrontendSettings not loaded');
  });

  it('surfaces failures inline when settings runtime is missing', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    window.LexeraFrontendSettings = { init: vi.fn() };
    // No LexeraSettingsRuntime

    expect(() => loadFrontendSettingsView(window)).not.toThrow();
    const errEl = window.document.querySelector('.frontend-settings-error');
    expect(errEl).toBeTruthy();
    expect(errEl.textContent).toContain('LexeraSettingsRuntime not loaded');
  });

  it('surfaces failures inline when init throws', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    window.LexeraSettingsRuntime = { buildFrontendSettingsOptions: vi.fn(() => ({})) };
    window.LexeraFrontendSettings = {
      init: vi.fn(() => { throw new Error('boot failed'); })
    };

    loadFrontendSettingsView(window);

    expect(window.document.querySelector('.frontend-settings-error').textContent)
      .toContain('boot failed');
  });
});
