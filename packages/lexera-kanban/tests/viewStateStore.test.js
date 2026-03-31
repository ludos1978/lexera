import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

var __dirname = dirname(fileURLToPath(import.meta.url));
var srcDir = resolve(__dirname, '..', 'src');

function createViewState() {
  var runtimeSource = readFileSync(resolve(srcDir, 'core', 'moduleRuntime.js'), 'utf-8');
  var viewStateSource = readFileSync(resolve(srcDir, 'core', 'viewStateStore.js'), 'utf-8');

  var windowShim = { LexeraRuntime: null };
  var factory = new Function('window', 'globalThis',
    runtimeSource + '\n' + viewStateSource + '\nreturn { LexeraViewState: LexeraViewState, LexeraRuntime: LexeraRuntime };'
  );
  var result = factory(windowShim, globalThis);
  return { ViewState: result.LexeraViewState, Runtime: result.LexeraRuntime };
}

describe('ViewStateStore', function () {
  var ViewState, Runtime;

  beforeEach(function () {
    var ctx = createViewState();
    ViewState = ctx.ViewState;
    Runtime = ctx.Runtime;
  });

  describe('KEYS', function () {
    it('exposes all expected keys', function () {
      var expected = ['searchMode', 'isEditing', 'connected', 'embeddedMode', 'headerSearchExpanded', 'addCardColumn'];
      var actual = Object.keys(ViewState.KEYS);
      for (var i = 0; i < expected.length; i++) {
        expect(actual).toContain(expected[i]);
      }
      expect(actual.length).toBe(expected.length);
    });

    it('has correct default types', function () {
      expect(ViewState.KEYS.searchMode).toBe(false);
      expect(ViewState.KEYS.isEditing).toBe(false);
      expect(ViewState.KEYS.connected).toBe(false);
      expect(ViewState.KEYS.embeddedMode).toBe(false);
      expect(ViewState.KEYS.headerSearchExpanded).toBe(false);
      expect(ViewState.KEYS.addCardColumn).toBe(null);
    });
  });

  describe('get', function () {
    it('returns the default value for each key', function () {
      expect(ViewState.get('searchMode')).toBe(false);
      expect(ViewState.get('isEditing')).toBe(false);
      expect(ViewState.get('connected')).toBe(false);
      expect(ViewState.get('embeddedMode')).toBe(false);
      expect(ViewState.get('headerSearchExpanded')).toBe(false);
      expect(ViewState.get('addCardColumn')).toBe(null);
    });

    it('returns undefined for an unregistered key', function () {
      expect(ViewState.get('nonexistent')).toBeUndefined();
    });
  });

  describe('set / get round-trip', function () {
    it('sets and reads boolean true', function () {
      ViewState.set('searchMode', true);
      expect(ViewState.get('searchMode')).toBe(true);
    });

    it('sets and reads boolean false after true', function () {
      ViewState.set('connected', true);
      expect(ViewState.get('connected')).toBe(true);
      ViewState.set('connected', false);
      expect(ViewState.get('connected')).toBe(false);
    });

    it('sets and reads a number', function () {
      ViewState.set('addCardColumn', 3);
      expect(ViewState.get('addCardColumn')).toBe(3);
    });

    it('sets and reads null', function () {
      ViewState.set('addCardColumn', 5);
      ViewState.set('addCardColumn', null);
      expect(ViewState.get('addCardColumn')).toBe(null);
    });
  });

  describe('on (change subscription)', function () {
    it('calls listener when value changes', function () {
      var received = [];
      ViewState.on('isEditing', function (val, old) {
        received.push({ val: val, old: old });
      });
      ViewState.set('isEditing', true);
      expect(received.length).toBe(1);
      expect(received[0].val).toBe(true);
      expect(received[0].old).toBe(false);
    });

    it('calls listener on every set, even same value', function () {
      var count = 0;
      ViewState.on('searchMode', function () { count++; });
      ViewState.set('searchMode', true);
      ViewState.set('searchMode', true);
      expect(count).toBe(2);
    });

    it('unsubscribe stops notifications', function () {
      var count = 0;
      var unsub = ViewState.on('embeddedMode', function () { count++; });
      ViewState.set('embeddedMode', true);
      expect(count).toBe(1);
      unsub();
      ViewState.set('embeddedMode', false);
      expect(count).toBe(1);
    });

    it('multiple listeners on the same key all fire', function () {
      var a = 0, b = 0;
      ViewState.on('connected', function () { a++; });
      ViewState.on('connected', function () { b++; });
      ViewState.set('connected', true);
      expect(a).toBe(1);
      expect(b).toBe(1);
    });
  });

  describe('runtime integration', function () {
    it('values are accessible via runtime.getState', function () {
      ViewState.set('headerSearchExpanded', true);
      expect(Runtime.getState('headerSearchExpanded')).toBe(true);
    });

    it('runtime.setState updates are visible via ViewState.get', function () {
      Runtime.setState('addCardColumn', 7);
      expect(ViewState.get('addCardColumn')).toBe(7);
    });

    it('runtime event bus emits key:changed events', function () {
      var received = null;
      Runtime.on('searchMode:changed', function (data) { received = data; });
      ViewState.set('searchMode', true);
      expect(received).toBeTruthy();
      expect(received.key).toBe('searchMode');
      expect(received.value).toBe(true);
      expect(received.previous).toBe(false);
    });
  });

  describe('isolation', function () {
    it('setting one key does not affect another', function () {
      ViewState.set('searchMode', true);
      ViewState.set('isEditing', true);
      expect(ViewState.get('connected')).toBe(false);
      expect(ViewState.get('embeddedMode')).toBe(false);
      expect(ViewState.get('addCardColumn')).toBe(null);
    });
  });
});
