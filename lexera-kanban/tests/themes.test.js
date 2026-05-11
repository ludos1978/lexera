import { describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createStorage(initialValues = {}) {
  const store = { ...initialValues };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    }
  };
}

function createStyledDocumentElement() {
  const styleValues = {};
  const style = {
    setProperty(name, value) {
      styleValues[name] = String(value);
    },
    getPropertyValue(name) {
      return Object.prototype.hasOwnProperty.call(styleValues, name) ? styleValues[name] : '';
    },
    colorScheme: ''
  };
  return { style };
}

function createMatchMedia(isDark = false, listeners = []) {
  return function matchMedia() {
    return {
      matches: isDark,
      addEventListener(eventName, handler) {
        if (eventName === 'change' && typeof handler === 'function') listeners.push(handler);
      }
    };
  };
}

function loadThemeWindow({ storage = {}, isDark = false, iframes = [], mediaListeners = [] } = {}) {
  const documentElement = createStyledDocumentElement();
  const localStorage = createStorage(storage);
  const window = {
    matchMedia: createMatchMedia(isDark, mediaListeners)
  };
  const document = {
    documentElement,
    querySelectorAll(selector) {
      return selector === 'iframe' ? iframes : [];
    }
  };

  const themeRuntime = loadIIFE('themes.js', '({ applyLexeraTheme, getLexeraCurrentThemeId, LEXERA_THEMES })', {
    window,
    document,
    localStorage
  });

  return { themeRuntime, documentElement, localStorage };
}

describe('themes', () => {
  it('does not write the legacy palette on OS changes before explicit legacy use', () => {
    const mediaListeners = [];
    const { documentElement } = loadThemeWindow({ mediaListeners });

    for (const listener of mediaListeners) listener();

    expect(documentElement.style.getPropertyValue('--bg-primary')).toBe('');
  });

  it('applies the integrated lexera palette to same-origin iframe roots and clears legacy selection', () => {
    const iframeRoot = createStyledDocumentElement();
    const iframes = [
      { contentDocument: { documentElement: iframeRoot } }
    ];
    const { themeRuntime, documentElement, localStorage } = loadThemeWindow({
      iframes,
      storage: { 'lexera-theme': 'warm' }
    });

    const applied = themeRuntime.applyLexeraTheme('warm');

    expect(applied.id).toBe('lexera');
    expect(documentElement.style.getPropertyValue('--bg-primary')).toBe('#ffffff');
    expect(documentElement.style.colorScheme).toBe('light');
    expect(iframeRoot.style.getPropertyValue('--bg-primary')).toBe('#ffffff');
    expect(iframeRoot.style.colorScheme).toBe('light');
    expect(localStorage.getItem('lexera-theme')).toBe(null);
  });

  it('uses the dark palette variant when the OS color scheme is dark', () => {
    const { themeRuntime, documentElement } = loadThemeWindow({ isDark: true });

    expect(() => themeRuntime.applyLexeraTheme('lexera')).not.toThrow();
    expect(documentElement.style.getPropertyValue('--bg-primary')).toBe('#1e1e1e');
    expect(documentElement.style.colorScheme).toBe('dark');
  });

  it('ignores inaccessible iframe documents while still applying the root theme', () => {
    const inaccessibleIframe = {
      get contentDocument() {
        throw new Error('cross-origin');
      }
    };
    const { themeRuntime, documentElement } = loadThemeWindow({ iframes: [inaccessibleIframe] });

    expect(() => themeRuntime.applyLexeraTheme('mono')).not.toThrow();
    expect(documentElement.style.getPropertyValue('--bg-primary')).toBe('#ffffff');
  });
});
