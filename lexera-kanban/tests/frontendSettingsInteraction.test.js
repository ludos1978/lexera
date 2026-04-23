import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '..', 'src', 'settings', 'frontendSettings.js'), 'utf8');

function loadFrontendSettings(window) {
  const factory = new Function('globalThis', 'document', source + '\nreturn globalThis.LexeraFrontendSettings;');
  return factory(window, window.document);
}

function createPanel(window) {
  const panel = window.document.createElement('div');
  panel.className = 'lexera-shared-panel-frontend-settings';
  panel.innerHTML = `
    <select class="lexera-shared-frontend-settings-visual-theme"></select>
    <select class="lexera-shared-frontend-settings-ui-scale"><option value="1">100%</option><option value="1.25">125%</option></select>
    <select class="lexera-shared-frontend-settings-scroll-speed"><option value="1">1</option><option value="2">2</option></select>
    <select class="lexera-shared-frontend-settings-zoom-speed"><option value="1">1</option><option value="3">3</option></select>
    <select class="lexera-shared-frontend-settings-tag-visibility"><option value="all">All</option><option value="none">None</option></select>
    <select class="lexera-shared-frontend-settings-html-comments"><option value="hidden">Hidden</option><option value="visible">Visible</option></select>
    <select class="lexera-shared-frontend-settings-html-content"><option value="escaped">Escaped</option><option value="rendered">Rendered</option></select>
    <input class="lexera-shared-frontend-settings-overlay-editor" type="checkbox" />
    <input class="lexera-shared-frontend-settings-special-chars" type="checkbox" />
    <input class="lexera-shared-frontend-settings-sidebar-counts" type="checkbox" />
    <input class="lexera-shared-frontend-settings-sidebar-presence" type="checkbox" />
  `;
  window.document.body.appendChild(panel);
  return panel;
}

describe('LexeraFrontendSettings interactions', () => {
  it('dispatches user changes from select and checkbox controls to settings handlers', () => {
    const dom = new JSDOM('<!doctype html><body></body>');
    const { window } = dom;
    const panel = createPanel(window);
    const applyVisualTheme = vi.fn();
    const applyUiScale = vi.fn();
    const setOverlayEditorEnabled = vi.fn();
    const syncMenuCheckStates = vi.fn();
    const applySidebarDisplayOptions = vi.fn();
    const sidebarOptions = { counts: true, presence: true, grips: false, menus: true };
    const LexeraFrontendSettings = loadFrontendSettings(window);

    LexeraFrontendSettings.init({
      getVisualThemes: () => [{ id: 'sleek', name: 'Sleek' }, { id: 'paper', name: 'Paper' }],
      getCurrentVisualThemeId: () => 'sleek',
      applyVisualTheme,
      getUiScale: () => 1,
      applyUiScale,
      getScrollSpeed: () => 1,
      setScrollSpeed: vi.fn(),
      getZoomSpeed: () => 1,
      setZoomSpeed: vi.fn(),
      getTagVisibility: () => 'all',
      setTagVisibility: vi.fn(),
      getHtmlCommentMode: () => 'hidden',
      setHtmlCommentMode: vi.fn(),
      getHtmlContentMode: () => 'escaped',
      setHtmlContentMode: vi.fn(),
      isOverlayEditorEnabled: () => false,
      setOverlayEditorEnabled,
      isSpecialCharactersVisible: () => false,
      setSpecialCharactersVisible: vi.fn(),
      syncMenuCheckStates,
      getSidebarDisplayOptions: () => ({ ...sidebarOptions }),
      applySidebarDisplayOptions
    }, panel);

    const themeSelect = panel.querySelector('.lexera-shared-frontend-settings-visual-theme');
    themeSelect.value = 'paper';
    themeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(applyVisualTheme).toHaveBeenCalledWith('paper');

    const scaleSelect = panel.querySelector('.lexera-shared-frontend-settings-ui-scale');
    scaleSelect.value = '1.25';
    scaleSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(applyUiScale).toHaveBeenCalledWith('1.25');

    const overlayToggle = panel.querySelector('.lexera-shared-frontend-settings-overlay-editor');
    overlayToggle.checked = true;
    overlayToggle.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(setOverlayEditorEnabled).toHaveBeenCalledWith(true);
    expect(syncMenuCheckStates).toHaveBeenCalled();

    const countsToggle = panel.querySelector('.lexera-shared-frontend-settings-sidebar-counts');
    countsToggle.checked = false;
    countsToggle.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(applySidebarDisplayOptions).toHaveBeenCalledWith({
      counts: false,
      presence: true,
      grips: false,
      menus: true
    });
  });
});
