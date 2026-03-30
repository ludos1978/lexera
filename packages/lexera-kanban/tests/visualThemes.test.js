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

function loadVisualThemeWindow(initialStorage = {}) {
  const window = {};
  const documentElement = createDocumentElement();
  const localStorage = createStorage(initialStorage);
  const document = {
    documentElement,
    querySelectorAll() {
      return [];
    }
  };

  loadIIFE('visualThemes.js', 'window', {
    window,
    document,
    localStorage
  });

  return { window, documentElement, localStorage };
}

describe('visualThemes', () => {
  it('restores the saved sleek visual theme and applies the root attribute on load', () => {
    const { window, documentElement } = loadVisualThemeWindow({ 'lexera-visual-theme': 'sleek' });

    expect(window.getLexeraCurrentVisualThemeId()).toBe('sleek');
    expect(documentElement.getAttribute('data-visual-theme')).toBe('sleek');
    expect(window.LEXERA_VISUAL_THEMES.map(theme => theme.id)).toEqual(['classic', 'sleek', 'sleek-uniform', 'gap', 'lines']);
  });

  it('migrates legacy board-theme storage into the unified visual theme', () => {
    const { window, documentElement } = loadVisualThemeWindow({ 'lexera-board-theme': 'gap-highlight' });

    expect(window.getLexeraCurrentVisualThemeId()).toBe('gap');
    expect(documentElement.getAttribute('data-visual-theme')).toBe('gap');
  });

  it('normalizes aliases back to classic and persists the unified storage key', () => {
    const { window, documentElement, localStorage } = loadVisualThemeWindow({ 'lexera-visual-theme': 'sleek' });

    const applied = window.applyLexeraVisualTheme('legacy');

    expect(applied).toEqual({
      id: 'sleek-uniform',
      baseId: 'sleek',
      name: 'Sleek Uniform',
      description: 'Sleek layout copy for unified typography'
    });
    expect(window.getLexeraCurrentVisualThemeId()).toBe('sleek-uniform');
    expect(documentElement.getAttribute('data-visual-theme')).toBe('sleek');
    expect(localStorage.getItem('lexera-visual-theme')).toBe('sleek-uniform');
  });

  it('maps the removed bordered alias back to classic', () => {
    const { window, documentElement } = loadVisualThemeWindow({ 'lexera-visual-theme': 'bordered' });

    expect(window.getLexeraCurrentVisualThemeId()).toBe('classic');
    expect(documentElement.getAttribute('data-visual-theme')).toBe('classic');
  });
});
