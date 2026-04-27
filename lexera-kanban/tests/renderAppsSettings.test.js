import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { loadIIFE } from './load-iife.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createPanel(window) {
  const panel = window.document.createElement('div');
  panel.className = 'lexera-shared-panel-render-apps';
  panel.innerHTML = `
    <input class="lexera-shared-render-apps-marpEnginePath" type="text">
    <input class="lexera-shared-render-apps-marpTemplatesPath" type="text">
    <button class="lexera-shared-render-apps-save" type="button">Save</button>
    <button class="lexera-shared-render-apps-themes-refresh" type="button">Refresh</button>
    <div class="lexera-shared-render-apps-themes"></div>
    <div class="lexera-shared-render-apps-tool-status"></div>
    <div class="lexera-shared-render-apps-status"></div>
  `;
  window.document.body.appendChild(panel);
  return panel;
}

describe('LexeraRenderAppsSettings', () => {
  it('broadcasts successful plugin-settings saves and shows a toast in child views', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://127.0.0.1:1431/views/renderApps/index.html?panelKind=renderApps&pane=tab-1'
    });
    const { window } = dom;
    const panel = createPanel(window);
    const request = vi.fn((path, options) => {
      if (!options || !options.method) {
        return Promise.resolve({
          marpEnginePath: '/old/engine.js',
          marpTemplatesPath: '/old/themes'
        });
      }
      if (path === '/config/render-apps' && options.method === 'PUT') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });
    window.LexeraApi = { request };
    window.LexeraSubApp = {
      broadcast: vi.fn(() => Promise.resolve(null))
    };
    window.showNotification = vi.fn();

    const settings = loadIIFE('settings/renderAppsSettings.js', 'LexeraRenderAppsSettings', {
      window,
      document: window.document,
      console,
      setTimeout,
      clearTimeout,
      Promise,
      JSON
    });

    settings.init(panel);
    await flush();

    panel.querySelector('.lexera-shared-render-apps-marpEnginePath').value = '/custom/engine.js';
    panel.querySelector('.lexera-shared-render-apps-marpTemplatesPath').value = '/custom/themes';
    panel.querySelector('.lexera-shared-render-apps-save')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    await flush();

    expect(request).toHaveBeenCalledWith('/config/render-apps', expect.objectContaining({
      method: 'PUT',
      body: expect.any(String)
    }));
    expect(window.LexeraSubApp.broadcast).toHaveBeenCalledWith('render-apps-config-saved', {
      values: expect.objectContaining({
        marpEnginePath: '/custom/engine.js',
        marpTemplatesPath: '/custom/themes'
      })
    });
    expect(window.showNotification).toHaveBeenCalledWith('Plugin settings saved', {
      variant: 'success'
    });
    expect(panel.querySelector('.lexera-shared-render-apps-status')?.textContent).toBe('Saved');
  });
});
