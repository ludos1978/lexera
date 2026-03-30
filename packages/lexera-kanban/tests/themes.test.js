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

function createMatchMedia(isDark = false) {
  return function matchMedia() {
    return {
      matches: isDark,
      addEventListener() {}
    };
  };
}

function loadThemeWindow({ storage = {}, isDark = false, iframes = [] } = {}) {
  const documentElement = createStyledDocumentElement();
  const localStorage = createStorage(storage);
  const window = {
    matchMedia: createMatchMedia(isDark)
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
  it('applies the selected palette to same-origin iframe roots', () => {
    const iframeRoot = createStyledDocumentElement();
    const iframes = [
      { contentDocument: { documentElement: iframeRoot } }
    ];
    const { themeRuntime, documentElement, localStorage } = loadThemeWindow({ iframes });

    const applied = themeRuntime.applyLexeraTheme('warm');

    expect(applied.id).toBe('warm');
    expect(documentElement.style.getPropertyValue('--bg-primary')).toBe('#fdf6e3');
    expect(documentElement.style.colorScheme).toBe('light');
    expect(iframeRoot.style.getPropertyValue('--bg-primary')).toBe('#fdf6e3');
    expect(iframeRoot.style.colorScheme).toBe('light');
    expect(localStorage.getItem('lexera-theme')).toBe('warm');
  });

  it('ignores inaccessible iframe documents while still applying the root theme', () => {
    const inaccessibleIframe = {
      get contentDocument() {
        throw new Error('cross-origin');
      }
    };
    const { themeRuntime, documentElement } = loadThemeWindow({ iframes: [inaccessibleIframe] });

    expect(() => themeRuntime.applyLexeraTheme('mono')).not.toThrow();
    expect(documentElement.style.getPropertyValue('--bg-primary')).toBe('#fafafa');
  });
});
