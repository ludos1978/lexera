/**
 * Render Applications Settings Panel
 *
 * Manages configuration of external tool paths (draw.io, marp, pandoc, etc.)
 * via the backend REST API (GET/PUT /config/render-apps).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraRenderAppsSettings = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FIELD_KEYS = ['drawio', 'marp', 'pandoc', 'soffice', 'pdftoppm', 'mutool'];
  var initializedPanels = [];

  function findPanels() {
    var panels = [];
    var shared = document.querySelectorAll('.lexera-shared-panel-render-apps');
    for (var i = 0; i < shared.length; i++) {
      if (panels.indexOf(shared[i]) === -1) panels.push(shared[i]);
    }
    return panels;
  }

  function resolvePanels(panel) {
    if (panel && panel.nodeType === 1) return [panel];
    return findPanels();
  }

  function q(panel, cls) {
    return panel.querySelector('.lexera-shared-render-apps-' + cls);
  }

  function getApi() {
    return window.LexeraApi || null;
  }

  function getTauriInvoke() {
    if (typeof window === 'undefined') return null;
    var tauri = window.__TAURI__;
    if (tauri && tauri.core && typeof tauri.core.invoke === 'function') {
      return function (cmd, args) { return tauri.core.invoke(cmd, args || {}); };
    }
    return null;
  }

  function setIndicator(panel, key, state, tooltip) {
    var el = q(panel, 'indicator-' + key);
    if (!el) return;
    el.classList.remove('is-ok', 'is-bad', 'is-pending');
    if (state === 'ok') {
      el.textContent = '\u2713';
      el.classList.add('is-ok');
    } else if (state === 'bad') {
      el.textContent = '\u2717';
      el.classList.add('is-bad');
    } else if (state === 'pending') {
      el.textContent = '\u2026';
      el.classList.add('is-pending');
    } else {
      el.textContent = '';
    }
    if (tooltip) el.title = tooltip;
    else el.removeAttribute('title');
  }

  function clearIndicators(panel) {
    for (var k = 0; k < FIELD_KEYS.length; k++) {
      setIndicator(panel, FIELD_KEYS[k], 'none', '');
    }
  }

  function formatTooltip(result) {
    if (!result) return '';
    var parts = [];
    if (result.source === 'user') parts.push('User-configured path');
    else if (result.source === 'auto') parts.push('Auto-detected');
    else if (result.source === 'missing') parts.push('Not found');
    if (result.path) parts.push(result.path);
    if (result.version) parts.push('Version: ' + result.version);
    if (result.error) parts.push(result.error);
    if (result.functional) {
      var f = result.functional;
      var label = f.ok ? 'Test run: OK' : 'Test run: FAILED';
      if (typeof f.durationMs === 'number') label += ' (' + f.durationMs + 'ms)';
      parts.push(label);
      if (f.details) parts.push(f.details);
      if (f.error) parts.push(f.error);
    }
    return parts.join('\n');
  }

  function deriveIndicatorState(result, functional) {
    if (!result || !result.ok) return 'bad';
    if (functional) {
      if (!result.functional) return 'bad';
      return result.functional.ok ? 'ok' : 'bad';
    }
    return 'ok';
  }

  function render(data, panel) {
    var panels = resolvePanels(panel);
    if (!panels.length) return false;
    for (var p = 0; p < panels.length; p++) {
      var root = panels[p];
      if (!root) continue;
      for (var k = 0; k < FIELD_KEYS.length; k++) {
        var input = q(root, FIELD_KEYS[k]);
        if (input) input.value = (data && data[FIELD_KEYS[k]]) || '';
      }
      clearIndicators(root);
      var statusEl = q(root, 'status');
      if (statusEl) statusEl.textContent = '';
    }
    return true;
  }

  async function testBackend(panel, functional) {
    var invoke = getTauriInvoke();
    if (!invoke) {
      showStatus(panel, 'Test unavailable outside Tauri', true);
      return;
    }
    var values = collectValues(panel);
    values.functional = !!functional;
    for (var k = 0; k < FIELD_KEYS.length; k++) {
      setIndicator(panel, FIELD_KEYS[k], 'pending', functional ? 'Running test\u2026' : 'Testing version\u2026');
    }
    showStatus(panel,
      functional ? 'Running test conversions\u2026 (this can take a while)' : 'Testing versions\u2026',
      false);
    try {
      var results = await invoke('test_render_apps', { request: values });
      var okCount = 0;
      for (var i = 0; i < FIELD_KEYS.length; i++) {
        var key = FIELD_KEYS[i];
        var r = results && results[key];
        var state = deriveIndicatorState(r, functional);
        setIndicator(panel, key, state, formatTooltip(r));
        if (state === 'ok') okCount++;
      }
      showStatus(panel,
        okCount + '/' + FIELD_KEYS.length + (functional ? ' tools rendered successfully' : ' tools available'),
        okCount < FIELD_KEYS.length);
    } catch (err) {
      for (var j = 0; j < FIELD_KEYS.length; j++) {
        setIndicator(panel, FIELD_KEYS[j], 'none', '');
      }
      showStatus(panel, 'Test failed: ' + (err.message || String(err)), true);
    }
  }

  function collectValues(panel) {
    var result = {};
    for (var k = 0; k < FIELD_KEYS.length; k++) {
      var input = q(panel, FIELD_KEYS[k]);
      var value = input ? input.value.trim() : '';
      result[FIELD_KEYS[k]] = value || null;
    }
    return result;
  }

  function showStatus(panel, message, isError) {
    var statusEl = q(panel, 'status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = 'mgmt-status lexera-shared-render-apps-status' +
      (isError ? ' error' : ' success');
  }

  async function loadFromBackend(panel) {
    var api = getApi();
    if (!api || typeof api.get !== 'function') {
      showStatus(panel, 'API not available', true);
      return;
    }
    try {
      var result = await api.get('/config/render-apps');
      render(result, panel);
    } catch (err) {
      showStatus(panel, 'Failed to load: ' + (err.message || String(err)), true);
    }
  }

  async function saveToBackend(panel) {
    var api = getApi();
    if (!api || typeof api.put !== 'function') {
      showStatus(panel, 'API not available', true);
      return;
    }
    var values = collectValues(panel);
    try {
      await api.put('/config/render-apps', values);
      showStatus(panel, 'Saved', false);
    } catch (err) {
      showStatus(panel, 'Failed to save: ' + (err.message || String(err)), true);
    }
  }

  function bindPanel(panel) {
    var saveBtn = q(panel, 'save');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        saveToBackend(panel);
      });
    }
    var reloadBtn = q(panel, 'reload');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', function () {
        loadFromBackend(panel);
      });
    }
    var testBtn = q(panel, 'test');
    if (testBtn) {
      testBtn.addEventListener('click', function () {
        testBackend(panel, false);
      });
    }
    var testRunBtn = q(panel, 'test-run');
    if (testRunBtn) {
      testRunBtn.addEventListener('click', function () {
        testBackend(panel, true);
      });
    }
    for (var k = 0; k < FIELD_KEYS.length; k++) {
      var input = q(panel, FIELD_KEYS[k]);
      if (input) {
        input.addEventListener('input', (function (key) {
          return function () { setIndicator(panel, key, 'none', ''); };
        })(FIELD_KEYS[k]));
      }
    }
  }

  function init(panel) {
    var panels = resolvePanels(panel);
    if (!panels.length) return false;
    for (var i = 0; i < panels.length; i++) {
      var root = panels[i];
      if (!root) continue;
      if (initializedPanels.indexOf(root) === -1) {
        initializedPanels.push(root);
        bindPanel(root);
        loadFromBackend(root);
      }
    }
    return true;
  }

  return {
    render: render,
    init: init,
    reload: function (panel) {
      var panels = resolvePanels(panel);
      for (var i = 0; i < panels.length; i++) {
        loadFromBackend(panels[i]);
      }
    }
  };
}));
