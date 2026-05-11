import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createStorage(initialValues = {}) {
  const store = { ...initialValues };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    }
  };
}

function createDocumentElement() {
  const attrs = {};
  return {
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    removeAttribute(name) {
      delete attrs[name];
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    }
  };
}

function createMockDocument() {
  const documentElement = createDocumentElement();
  const headChildren = [];
  const head = {
    appendChild(node) {
      if (headChildren.indexOf(node) === -1) headChildren.push(node);
      node.parentNode = head;
      return node;
    },
    removeChild(node) {
      const idx = headChildren.indexOf(node);
      if (idx !== -1) headChildren.splice(idx, 1);
      node.parentNode = null;
      return node;
    }
  };

  const document = {
    documentElement,
    head,
    createElement(tagName) {
      return {
        tagName: String(tagName || '').toUpperCase(),
        attributes: {},
        id: '',
        textContent: '',
        parentNode: null,
        setAttribute(name, value) {
          this.attributes[name] = String(value);
        },
        getAttribute(name) {
          return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
        }
      };
    },
    getElementById(id) {
      for (let i = 0; i < headChildren.length; i++) {
        if (headChildren[i].id === id) return headChildren[i];
      }
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'iframe' ? [] : [];
    }
  };

  return { document, documentElement, headChildren };
}

function createWindow(overrides = {}) {
  const listeners = {};
  return Object.assign({
    addEventListener(name, fn) {
      if (!listeners[name]) listeners[name] = [];
      listeners[name].push(fn);
    },
    dispatchEvent(event) {
      const name = event && event.type ? event.type : '';
      const handlers = listeners[name] || [];
      for (let i = 0; i < handlers.length; i++) handlers[i](event);
      return true;
    },
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    }
  }, overrides);
}

function flushPromises() {
  return Promise.resolve().then(() => Promise.resolve());
}

function loadVisualThemeWindow(options = {}) {
  const window = createWindow(options.windowOverrides || {});
  const { document, documentElement, headChildren } = createMockDocument();
  const localStorage = createStorage(options.initialStorage || {});

  if (options.discovery) {
    window.LexeraBackendDiscovery = {
      canUseTauriInvoke() {
        return true;
      },
      invokeTauri(command, args) {
        return options.discovery(command, args || {});
      }
    };
  }

  loadIIFE('visualThemes.js', 'window', {
    window,
    document,
    localStorage,
    ...(options.globals || {})
  });

  return { window, document, documentElement, headChildren, localStorage };
}

describe('visualThemes', () => {
  it('uses warm-paper as the default and migrates the old classic alias', async () => {
    const { window, documentElement, localStorage } = loadVisualThemeWindow({
      initialStorage: { 'lexera-visual-theme': 'classic' }
    });

    await flushPromises();

    expect(window.getLexeraCurrentVisualThemeId()).toBe('warm-paper');
    expect(documentElement.getAttribute('data-visual-theme')).toBe('warm-paper');
    expect(documentElement.getAttribute('data-visual-theme-variant')).toBe('warm-paper');
    expect(documentElement.getAttribute('data-visual-theme-lineage')).toBe('warm-paper');
    expect(localStorage.getItem('lexera-visual-theme')).toBe('warm-paper');
    expect(window.LEXERA_VISUAL_THEMES.map(theme => theme.id)).toEqual(['warm-paper', 'no-style']);
  });

  it('keeps no-style free of visual theme attributes and legacy palette writes', async () => {
    const applyLexeraTheme = vi.fn();
    const { window, documentElement, localStorage } = loadVisualThemeWindow({
      initialStorage: { 'lexera-visual-theme': 'no-style' },
      globals: { applyLexeraTheme }
    });

    await flushPromises();

    expect(window.getLexeraCurrentVisualThemeId()).toBe('no-style');
    expect(documentElement.getAttribute('data-visual-theme')).toBe(null);
    expect(documentElement.getAttribute('data-visual-theme-variant')).toBe(null);
    expect(documentElement.getAttribute('data-visual-theme-lineage')).toBe(null);
    expect(localStorage.getItem('lexera-visual-theme')).toBe('no-style');
    expect(applyLexeraTheme).not.toHaveBeenCalled();
  });

  it('does not apply the default theme while a requested user theme is still being discovered', async () => {
    let resolveDiscovery;
    const discoveryPromise = new Promise(resolve => {
      resolveDiscovery = resolve;
    });
    const { window, documentElement, localStorage } = loadVisualThemeWindow({
      initialStorage: { 'lexera-visual-theme': 'sleek-uniform' },
      discovery(command) {
        if (command === 'discover_visual_themes') return discoveryPromise;
        return Promise.reject(new Error('Unexpected command: ' + command));
      }
    });

    expect(window.getLexeraCurrentVisualThemeId()).toBe('sleek-uniform');
    expect(documentElement.getAttribute('data-visual-theme')).toBe('sleek');
    expect(documentElement.getAttribute('data-visual-theme-variant')).toBe('sleek-uniform');
    expect(localStorage.getItem('lexera-visual-theme')).toBe('sleek-uniform');

    resolveDiscovery({ rootPath: '/config/lexera/themes', themes: [] });
    await flushPromises();
    await flushPromises();

    expect(window.getLexeraCurrentVisualThemeId()).toBe('warm-paper');
    expect(documentElement.getAttribute('data-visual-theme')).toBe('warm-paper');
    expect(localStorage.getItem('lexera-visual-theme')).toBe('warm-paper');
  });

  it('discovers user themes from the config directory and loads their css inline', async () => {
    const themeCss = ':root[data-visual-theme-lineage~="midnight-grid"] { --board-font-size: 99px; }';
    const sleekCss = ':root[data-visual-theme="sleek"] { --header-height: 48px; }';
    const { window, documentElement, headChildren, localStorage } = loadVisualThemeWindow({
      initialStorage: { 'lexera-visual-theme': 'midnight-grid' },
      discovery(command, args) {
        if (command === 'discover_visual_themes') {
          // sleek-uniform is now a seeded user theme too — bundled by
          // src-tauri/templates/ and copied to the user themes dir on
          // first launch. Discovery returns it alongside any custom
          // themes the user has added.
          return Promise.resolve({
            rootPath: '/config/lexera/themes',
            themes: [
              {
                id: 'sleek-uniform',
                baseId: 'sleek',
                name: 'Sleek Uniform',
                description: 'Seeded template',
                cssPath: '/config/lexera/themes/sleek-uniform/theme.css',
                rootPath: '/config/lexera/themes/sleek-uniform',
                source: 'user'
              },
              {
                id: 'midnight-grid',
                name: 'Midnight Grid',
                description: 'User theme',
                extends: 'sleek-uniform',
                cssPath: '/config/lexera/themes/midnight-grid/theme.css',
                rootPath: '/config/lexera/themes/midnight-grid',
                source: 'user'
              }
            ]
          });
        }
        if (command === 'read_text_file') {
          if (args.path === '/config/lexera/themes/sleek-uniform/theme.css') return Promise.resolve(sleekCss);
          if (args.path === '/config/lexera/themes/midnight-grid/theme.css') return Promise.resolve(themeCss);
        }
        return Promise.reject(new Error('Unexpected command: ' + command));
      }
    });

    await window.refreshLexeraVisualThemes();
    await flushPromises();

    expect(window.getLexeraVisualThemesDirectory()).toBe('/config/lexera/themes');
    expect(window.LEXERA_VISUAL_THEMES.map(theme => theme.id)).toEqual(['warm-paper', 'no-style', 'sleek-uniform', 'midnight-grid']);
    expect(window.getLexeraCurrentVisualThemeId()).toBe('midnight-grid');
    expect(documentElement.getAttribute('data-visual-theme')).toBe('sleek');
    expect(documentElement.getAttribute('data-visual-theme-variant')).toBe('midnight-grid');
    expect(documentElement.getAttribute('data-visual-theme-lineage')).toBe('sleek-uniform midnight-grid');
    expect(localStorage.getItem('lexera-visual-theme')).toBe('midnight-grid');

    const styleNode = headChildren.find(node => node.id === 'lexera-visual-theme-user-style');
    expect(styleNode).toBeTruthy();
    expect(styleNode.textContent).toContain('--board-font-size: 99px;');
  });
});
