import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIIFE } from './load-iife.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '..', 'src', 'settings', 'frontendSettings.js'), 'utf8');

function loadFrontendSettings(window, globals = {}) {
  const argNames = ['globalThis', 'document'].concat(Object.keys(globals));
  const argValues = [window, window.document].concat(Object.values(globals));
  const factory = new Function(...argNames, source + '\nreturn globalThis.LexeraFrontendSettings;');
  return factory(...argValues);
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
  `;
  window.document.body.appendChild(panel);
  return panel;
}

function createTagGroupsPanel(window) {
  const panel = window.document.createElement('div');
  panel.className = 'lexera-shared-panel-frontend-settings';
  panel.innerHTML = `
    <div class="lexera-shared-frontend-settings-tag-groups-card tag-group-chips"></div>
  `;
  window.document.body.appendChild(panel);
  return panel;
}

function createControlsPanel(window) {
  const panel = window.document.createElement('div');
  panel.className = 'lexera-shared-panel-frontend-settings';
  panel.innerHTML = `
    <div data-frontend-settings-section="controls">
      <div class="controls-settings-group" data-controls-mode="kanban">
        <div class="controls-settings-action" data-controls-action="move">
          <div class="controls-settings-chips"></div>
          <button type="button" data-controls-add="true">+</button>
        </div>
      </div>
      <button type="button" data-controls-reset="true">Reset</button>
    </div>
  `;
  window.document.body.appendChild(panel);
  return panel;
}

describe('LexeraFrontendSettings interactions', () => {
  it('dispatches user changes from select and checkbox controls to settings handlers', () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
    const { window } = dom;
    const panel = createPanel(window);
    const applyVisualTheme = vi.fn();
    const applyUiScale = vi.fn();
    const setOverlayEditorEnabled = vi.fn();
    const syncMenuCheckStates = vi.fn();
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
      syncMenuCheckStates
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
  });

  it('renders tag-group chips and persists add/remove actions through ContextMenuBuilders', () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
    const { window } = dom;
    const panel = createTagGroupsPanel(window);
    window.localStorage.setItem('lexera-tag-groups-card', JSON.stringify(['special', 'priority']));
    const ContextMenuBuilders = loadIIFE('menu/contextMenuBuilders.js', 'ContextMenuBuilders', {
      window,
      localStorage: window.localStorage,
      console,
      JSON
    });
    const LexeraFrontendSettings = loadFrontendSettings(window);

    LexeraFrontendSettings.init({
      getContextMenuBuilders: () => ContextMenuBuilders
    }, panel);

    const firstChip = panel.querySelector('.tag-group-chip');
    expect(firstChip).toBeTruthy();
    expect(firstChip.textContent).toContain('Special');
    expect(panel.querySelectorAll('.tag-group-chip')).toHaveLength(2);

    const removeBtn = panel.querySelector('.tag-group-chip-remove');
    removeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(JSON.parse(window.localStorage.getItem('lexera-tag-groups-card'))).toEqual(['priority']);
    expect(panel.querySelectorAll('.tag-group-chip')).toHaveLength(1);

    const input = panel.querySelector('.tag-group-add-input');
    input.value = 'Status';
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(JSON.parse(window.localStorage.getItem('lexera-tag-groups-card'))).toEqual(['priority', 'status']);
    expect(Array.from(panel.querySelectorAll('.tag-group-chip')).map((chip) => chip.textContent)).toEqual([
      expect.stringContaining('Priority'),
      expect.stringContaining('Status')
    ]);
  });

  it('renders control-binding chips and removes bindings via LexeraControlsSettings', () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
    const { window } = dom;
    const panel = createControlsPanel(window);
    const LexeraControlsSettings = loadIIFE('settings/controlsSettings.js', 'LexeraControlsSettings', {
      window,
      localStorage: window.localStorage,
      JSON
    });
    const LexeraFrontendSettings = loadFrontendSettings(window, { LexeraControlsSettings });

    LexeraFrontendSettings.init({}, panel);

    expect(panel.querySelectorAll('.controls-chip')).toHaveLength(3);

    const removeBtn = panel.querySelector('.controls-chip-remove');
    removeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(panel.querySelectorAll('.controls-chip')).toHaveLength(2);
    expect(JSON.parse(window.localStorage.getItem('lexera-controls-settings')).kanban.move).toHaveLength(2);
  });

  it('settings runtime exposes ContextMenuBuilders to frontend settings sub-apps', () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
    const { window } = dom;
    const ContextMenuBuilders = loadIIFE('menu/contextMenuBuilders.js', 'ContextMenuBuilders', {
      window,
      localStorage: window.localStorage,
      console,
      JSON
    });
    const runtime = loadIIFE('views/_shared/settingsRuntime.js', 'window.LexeraSettingsRuntime', {
      window,
      localStorage: window.localStorage,
      JSON
    });

    const options = runtime.buildFrontendSettingsOptions();
    expect(options.getContextMenuBuilders()).toBe(ContextMenuBuilders);
  });

  it('settings runtime uses the live visual theme registry when available', () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
    const { window } = dom;
    const applyLexeraVisualTheme = vi.fn(() => ({ id: 'sleek-uniform' }));
    window.LEXERA_VISUAL_THEMES = [
      { id: 'warm-paper', name: 'Warm Paper' },
      { id: 'no-style', name: 'No style' },
      { id: 'sleek-uniform', name: 'Sleek Uniform' }
    ];
    window.getLexeraCurrentVisualThemeId = vi.fn(() => 'warm-paper');
    window.applyLexeraVisualTheme = applyLexeraVisualTheme;
    window.__TAURI__ = {
      core: {
        invoke: vi.fn(() => Promise.resolve(null))
      }
    };

    const runtime = loadIIFE('views/_shared/settingsRuntime.js', 'window.LexeraSettingsRuntime', {
      window,
      localStorage: window.localStorage,
      JSON
    });

    const options = runtime.buildFrontendSettingsOptions();
    expect(options.getVisualThemes()).toEqual(window.LEXERA_VISUAL_THEMES);
    expect(options.getCurrentVisualThemeId()).toBe('warm-paper');

    options.applyVisualTheme('sleek-uniform');
    expect(applyLexeraVisualTheme).toHaveBeenCalledWith('sleek-uniform');
    expect(window.localStorage.getItem('lexera-visual-theme')).toBe('sleek-uniform');
  });

  it('settings runtime does not expose removed hierarchy display options', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
    const { window } = dom;
    const invoke = vi.fn(() => Promise.resolve(null));
    window.__TAURI__ = {
      core: { invoke }
    };
    window.localStorage.setItem('lexera-sidebar-tree-display', JSON.stringify({
      counts: false,
      presence: true,
      grips: false,
      menus: false
    }));

    const runtime = loadIIFE('views/_shared/settingsRuntime.js', 'window.LexeraSettingsRuntime', {
      window,
      localStorage: window.localStorage,
      JSON
    });

    const options = runtime.buildFrontendSettingsOptions();
    expect(options.getSidebarDisplayOptions).toBeUndefined();
    expect(options.applySidebarDisplayOptions).toBeUndefined();
    await Promise.resolve();

    expect(JSON.parse(window.localStorage.getItem('lexera-sidebar-tree-display'))).toEqual({
      counts: false,
      presence: true,
      grips: false,
      menus: false
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('settings runtime routes backend notifications through showNotification when present', () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
    const { window } = dom;
    window.showNotification = vi.fn();

    const runtime = loadIIFE('views/_shared/settingsRuntime.js', 'window.LexeraSettingsRuntime', {
      window,
      localStorage: window.localStorage,
      JSON
    });

    const callbacks = runtime.buildBackendCallbacks();
    callbacks.onNotify('Workspace created');

    expect(window.showNotification).toHaveBeenCalledWith('Workspace created');
  });

  it('settings runtime broadcasts workspace snapshots for shell-state refresh', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
    const { window } = dom;
    const invoke = vi.fn(() => Promise.resolve(null));
    window.__TAURI__ = {
      core: { invoke }
    };

    const runtime = loadIIFE('views/_shared/settingsRuntime.js', 'window.LexeraSettingsRuntime', {
      window,
      localStorage: window.localStorage,
      JSON
    });

    const callbacks = runtime.buildBackendCallbacks();
    callbacks.onWorkspacesLoaded([{ id: 'ws-1', name: 'Alpha' }], 'ws-1');
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', {
      event: 'management-workspaces-loaded',
      payload: {
        workspaces: [{ id: 'ws-1', name: 'Alpha' }],
        defaultWorkspaceId: 'ws-1'
      }
    });
  });

  it('settings runtime prefers the shared sub-app confirm modal over window.confirm', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
    const { window } = dom;
    const confirmModal = vi.fn(() => Promise.resolve(true));
    window.LexeraSubApp = { confirmModal };
    window.confirm = vi.fn(() => false);

    const runtime = loadIIFE('views/_shared/settingsRuntime.js', 'window.LexeraSettingsRuntime', {
      window,
      localStorage: window.localStorage,
      JSON
    });

    const callbacks = runtime.buildBackendCallbacks();
    await expect(callbacks.onConfirm('Delete workspace?')).resolves.toBe(true);
    expect(confirmModal).toHaveBeenCalledWith({
      title: 'Confirm',
      message: 'Delete workspace?'
    });
    expect(window.confirm).not.toHaveBeenCalled();
  });
});
