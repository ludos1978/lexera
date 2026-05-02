import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function createSettings(locationSearch) {
  // Provide localStorage shim
  var store = {};
  var localStorageShim = {
    getItem: function (k) { return store.hasOwnProperty(k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };

  // Load moduleRuntime first (provides LexeraRuntime)
  var runtimeSource = readFileSync(resolve(srcDir, 'core', 'moduleRuntime.js'), 'utf-8');
  var settingsSource = readFileSync(resolve(srcDir, 'core', 'settingsStore.js'), 'utf-8');

  var factory = new Function('localStorage', 'window', 'globalThis', 'URLSearchParams',
    runtimeSource + '\n' + settingsSource + '\nreturn LexeraSettings;'
  );
  var windowShim = {
    LexeraRuntime: null,
    location: { search: locationSearch || '' }
  };
  var Settings = factory(localStorageShim, windowShim, globalThis, URLSearchParams);

  return { Settings: Settings, store: store };
}

describe('SettingsStore', () => {
  var Settings, store;

  beforeEach(() => {
    var ctx = createSettings();
    Settings = ctx.Settings;
    store = ctx.store;
  });

  describe('get/set', () => {
    it('returns default for unset string setting', () => {
      expect(Settings.get('visualTheme')).toBe('classic');
    });

    it('returns default for unset number setting', () => {
      expect(Settings.get('uiScale')).toBe(1);
    });

    it('returns default for unset boolean setting', () => {
      expect(Settings.get('overlayEditorEnabled')).toBe(true);
      expect(Settings.get('specialCharsVisible')).toBe(false);
    });

    it('returns the default overlay editor mode when unset', () => {
      expect(Settings.get('cardEditorMode')).toBe('dual');
    });

    it('returns default for unset json setting', () => {
      expect(Settings.get('sidebarExpanded')).toEqual([]);
      expect(Settings.get('tagColorOverrides')).toEqual({});
    });

    it('persists and reads string values', () => {
      Settings.set('visualTheme', 'classic');
      expect(Settings.get('visualTheme')).toBe('classic');
      expect(store['lexera-visual-theme']).toBe('classic');
    });

    it('persists and reads number values', () => {
      Settings.set('uiScale', 1.5);
      expect(Settings.get('uiScale')).toBe(1.5);
      expect(store['lexera-ui-scale']).toBe('1.5');
    });

    it('persists and reads boolean values', () => {
      Settings.set('overlayEditorEnabled', false);
      expect(Settings.get('overlayEditorEnabled')).toBe(false);
      expect(store['lexera-overlay-editor-enabled']).toBe('false');
    });

    it('persists and reads json values', () => {
      Settings.set('boardOrder', ['a', 'b', 'c']);
      expect(Settings.get('boardOrder')).toEqual(['a', 'b', 'c']);
      expect(JSON.parse(store['lexera-board-order'])).toEqual(['a', 'b', 'c']);
    });

    it('returns undefined for unknown setting name', () => {
      expect(Settings.get('nonexistent')).toBeUndefined();
    });

    it('handles corrupted JSON gracefully', () => {
      store['lexera-board-order'] = '{bad json';
      expect(Settings.get('boardOrder')).toEqual([]);
    });

    it('handles NaN number gracefully', () => {
      store['lexera-ui-scale'] = 'not-a-number';
      expect(Settings.get('uiScale')).toBe(1); // default
    });
  });

  describe('per-board keys', () => {
    it('reads and writes per-board settings', () => {
      Settings.setForBoard('cardCollapsed', 'board-1', ['card-a', 'card-b']);
      expect(Settings.getForBoard('cardCollapsed', 'board-1')).toEqual(['card-a', 'card-b']);
      expect(store['lexera-card-collapsed:board-1']).toBeTruthy();
    });

    it('returns default when board setting not stored', () => {
      expect(Settings.getForBoard('cardCollapsed', 'board-x')).toEqual([]);
    });

    it('removes per-board setting', () => {
      Settings.setForBoard('cardCollapsed', 'board-1', ['a']);
      Settings.removeForBoard('cardCollapsed', 'board-1');
      expect(Settings.getForBoard('cardCollapsed', 'board-1')).toEqual([]);
    });

    it('handles missing boardId gracefully', () => {
      expect(Settings.getForBoard('cardCollapsed', '')).toEqual([]);
      expect(Settings.getForBoard('cardCollapsed', null)).toEqual([]);
    });
  });

  describe('scoped keys', () => {
    it('reads and writes scoped settings', () => {
      Settings.setScoped('tagGroups', 'card', [{ name: 'priority' }]);
      expect(Settings.getScoped('tagGroups', 'card')).toEqual([{ name: 'priority' }]);
    });
  });

  describe('change listeners', () => {
    it('notifies on set', () => {
      var received = null;
      Settings.on('uiScale', function (val) { received = val; });
      Settings.set('uiScale', 2);
      expect(received).toBe(2);
    });

    it('unsubscribe stops notifications', () => {
      var count = 0;
      var unsub = Settings.on('theme', function () { count++; });
      Settings.set('theme', 'dark');
      expect(count).toBe(1);
      unsub();
      Settings.set('theme', 'light');
      expect(count).toBe(1);
    });
  });

  describe('per-window keys (getForWindow / setForWindow)', () => {
    it('keys by `ws:<workspaceId>` when ?workspace= is set', () => {
      var ctx = createSettings('?workspace=ws-alpha&windowLabel=kanban-7');
      ctx.Settings.WINDOW_DEFS.testKey = { key: 'lexera-test:{windowScope}', type: 'string', default: '' };
      ctx.Settings.setForWindow('testKey', 'value-A');
      expect(ctx.store['lexera-test:ws:ws-alpha']).toBe('value-A');
      expect(ctx.Settings.getForWindow('testKey')).toBe('value-A');
    });

    it('two windows on the same workspace share storage (last save wins)', () => {
      var a = createSettings('?workspace=shared&windowLabel=kanban-1');
      var b = createSettings('?workspace=shared&windowLabel=kanban-2');
      a.Settings.WINDOW_DEFS.testKey = { key: 'lexera-test:{windowScope}', type: 'string', default: '' };
      b.Settings.WINDOW_DEFS.testKey = { key: 'lexera-test:{windowScope}', type: 'string', default: '' };
      a.Settings.setForWindow('testKey', 'from-A');
      // Reading from B's store with the same scope key would see the same
      // entry IF they shared a backing store. They don't here (test isolation),
      // but the keys collide — that's the point.
      expect(a.Settings.keyOf('testKey')).toBe('lexera-test:{windowScope}');
      a.Settings.setForWindow('testKey', 'from-A');
      b.Settings.setForWindow('testKey', 'from-B');
      // Each test has its own store, but the resolved storage key matches.
      var aKeys = Object.keys(a.store);
      var bKeys = Object.keys(b.store);
      expect(aKeys).toEqual(bKeys);
      expect(aKeys[0]).toBe('lexera-test:ws:shared');
    });

    it('falls back to `wl:<windowLabel>` when no workspace is set', () => {
      var ctx = createSettings('?windowLabel=kanban-3');
      ctx.Settings.WINDOW_DEFS.testKey = { key: 'lexera-test:{windowScope}', type: 'json', default: null };
      ctx.Settings.setForWindow('testKey', { ratio: 0.42 });
      expect(ctx.store['lexera-test:wl:kanban-3']).toBe(JSON.stringify({ ratio: 0.42 }));
      expect(ctx.Settings.getForWindow('testKey')).toEqual({ ratio: 0.42 });
    });

    it('falls back to `wl:main` when neither workspace nor windowLabel is set', () => {
      var ctx = createSettings('');
      ctx.Settings.WINDOW_DEFS.testKey = { key: 'lexera-test:{windowScope}', type: 'string', default: '' };
      ctx.Settings.setForWindow('testKey', 'main-default');
      expect(ctx.store['lexera-test:wl:main']).toBe('main-default');
    });

    it('isolates two windows with different windowLabels (no workspace pin)', () => {
      var a = createSettings('?windowLabel=kanban-1');
      var b = createSettings('?windowLabel=kanban-2');
      a.Settings.WINDOW_DEFS.testKey = { key: 'lexera-test:{windowScope}', type: 'string', default: '' };
      b.Settings.WINDOW_DEFS.testKey = { key: 'lexera-test:{windowScope}', type: 'string', default: '' };
      a.Settings.setForWindow('testKey', 'from-A');
      b.Settings.setForWindow('testKey', 'from-B');
      expect(Object.keys(a.store)[0]).toBe('lexera-test:wl:kanban-1');
      expect(Object.keys(b.store)[0]).toBe('lexera-test:wl:kanban-2');
    });

    it('returns the default when no value is stored', () => {
      var ctx = createSettings('?workspace=ws-alpha');
      ctx.Settings.WINDOW_DEFS.testKey = { key: 'lexera-test:{windowScope}', type: 'number', default: 0.58 };
      expect(ctx.Settings.getForWindow('testKey')).toBe(0.58);
    });

    it('removeForWindow drops the current scope only', () => {
      var ctx = createSettings('?workspace=ws-alpha');
      ctx.Settings.WINDOW_DEFS.testKey = { key: 'lexera-test:{windowScope}', type: 'string', default: '' };
      ctx.Settings.setForWindow('testKey', 'X');
      expect(ctx.store['lexera-test:ws:ws-alpha']).toBe('X');
      ctx.Settings.removeForWindow('testKey');
      expect(ctx.store['lexera-test:ws:ws-alpha']).toBeUndefined();
    });

    it('keyOf includes WINDOW_DEFS entries', () => {
      var ctx = createSettings('');
      ctx.Settings.WINDOW_DEFS.testKey = { key: 'lexera-test:{windowScope}', type: 'string', default: '' };
      expect(ctx.Settings.keyOf('testKey')).toBe('lexera-test:{windowScope}');
    });
  });

  describe('metadata', () => {
    it('keyOf returns raw localStorage key', () => {
      expect(Settings.keyOf('uiScale')).toBe('lexera-ui-scale');
      expect(Settings.keyOf('cardCollapsed')).toBe('lexera-card-collapsed:{boardId}');
    });

    it('allKeys returns all app-level setting names', () => {
      var keys = Settings.allKeys();
      expect(keys).toContain('uiScale');
      expect(keys).toContain('visualTheme');
      expect(keys).toContain('dashboardQuery');
      expect(keys.length).toBeGreaterThan(20);
    });

    it('defOf returns definition with type and default', () => {
      var def = Settings.defOf('uiScale');
      expect(def.type).toBe('number');
      expect(def.default).toBe(1);
    });
  });
});
