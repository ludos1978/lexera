import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'views', 'renderApps', 'renderApps.js'),
  'utf8'
);

function loadRenderAppsView(window) {
  const factory = new Function('window', 'document', source);
  factory(window, window.document);
}

function createDom() {
  return new JSDOM(`
    <!doctype html>
    <html>
      <body>
        <div class="shell-settings-panel render-apps-settings-panel lexera-shared-panel lexera-shared-panel-render-apps">
          <div class="shell-settings-body">
            <div class="mgmt-status lexera-shared-render-apps-status"></div>
          </div>
        </div>
      </body>
    </html>
  `, { url: 'http://127.0.0.1:1431/views/renderApps/index.html?panelKind=renderApps&pane=tab-1' });
}

describe('renderApps view sub-app', () => {
  it('boots through LexeraSubApp and initializes Plugin Settings on the panel root', () => {
    const dom = createDom();
    const { window } = dom;
    const initPanel = vi.fn();
    const destroyPanel = vi.fn();
    window.LexeraSubApp = {
      init: vi.fn()
    };
    window.LexeraRenderAppsSettings = {
      init: initPanel,
      destroy: destroyPanel
    };

    loadRenderAppsView(window);

    expect(window.LexeraSubApp.init).toHaveBeenCalledWith(expect.objectContaining({
      onTeardown: expect.any(Function)
    }));
    expect(initPanel).toHaveBeenCalledWith(
      window.document.querySelector('.lexera-shared-panel-render-apps')
    );
    window.LexeraSubApp.init.mock.calls[0][0].onTeardown();
    expect(destroyPanel).toHaveBeenCalledWith(
      window.document.querySelector('.lexera-shared-panel-render-apps')
    );
    expect(window.document.querySelector('.lexera-shared-render-apps-status')?.textContent).toBe('');
  });

  it('surfaces bootstrap failures inline', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = {
      init: vi.fn()
    };
    window.LexeraRenderAppsSettings = {
      init: vi.fn(() => {
        throw new Error('boom');
      })
    };

    loadRenderAppsView(window);

    expect(window.document.querySelector('.lexera-shared-render-apps-status')?.textContent)
      .toContain('Failed to initialize: boom');
  });

  // ── User-interaction API exercise ────────────────────────────────
  // Drives the renderApps sub-app ONLY through LexeraRenderAppsTestApi.
  // The visible-to-user surface owned by THIS file is small (init state
  // + status text), so a regression that breaks bootstrap or error
  // reporting flips collectState.
  it('LexeraRenderAppsTestApi.collectState reports initialised=true on success', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    window.LexeraRenderAppsSettings = { init: vi.fn(), destroy: vi.fn() };

    loadRenderAppsView(window);

    const state = window.LexeraRenderAppsTestApi.collectState();
    expect(state.initialised).toBe(true);
    expect(state.error).toBe('');
    expect(state.hasErrorBlock).toBe(false);
    expect(state.statusText).toBe('');
  });

  it('LexeraRenderAppsTestApi.collectState reports the error path when init throws', () => {
    const dom = createDom();
    const { window } = dom;
    window.LexeraSubApp = { init: vi.fn() };
    window.LexeraRenderAppsSettings = {
      init: vi.fn(() => { throw new Error('settings loader missing'); })
    };

    loadRenderAppsView(window);

    const state = window.LexeraRenderAppsTestApi.collectState();
    expect(state.initialised).toBe(false);
    expect(state.error).toBe('settings loader missing');
    expect(state.hasErrorBlock).toBe(true);
    expect(state.statusText).toContain('Failed to initialize: settings loader missing');
  });
});
