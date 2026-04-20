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

  // Tool-path keys get a Test Version / Test Run indicator next to them;
  // marp engine + templates are user-supplied paths with no runtime probe.
  var TOOL_KEYS = ['drawio', 'marp', 'pandoc', 'soffice', 'pdftoppm', 'mutool'];
  var MARP_PLUGIN_KEYS = ['marpEnginePath', 'marpTemplatesPath'];
  var FIELD_KEYS = TOOL_KEYS.concat(MARP_PLUGIN_KEYS);
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

  // Thin adapter that exposes get/put on top of LexeraApi.request — the
  // global LexeraApi (api.js) exposes only request(). Mirrors the adapter
  // pattern in src/management/managementWiring.js. Resolves the host's
  // LexeraApi from either the current window or the parent (iframe case).
  function resolveLexeraApi() {
    if (typeof window === 'undefined') return null;
    if (window.LexeraApi && typeof window.LexeraApi.request === 'function') return window.LexeraApi;
    try {
      if (window.parent && window.parent !== window
          && window.parent.LexeraApi && typeof window.parent.LexeraApi.request === 'function') {
        return window.parent.LexeraApi;
      }
    } catch (e) { /* cross-origin — ignore */ }
    return null;
  }
  function getApi() {
    var api = resolveLexeraApi();
    if (!api) return null;
    return {
      get: function (path) { return api.request(path); },
      put: function (path, body) {
        return api.request(path, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      },
    };
  }

  // Resolve the Tauri IPC bridge across iframes. The panel may render
  // inside a workspace-shell iframe whose window has no __TAURI__ globals;
  // walk up to window.parent when available. Mirrors the same fallback
  // used by src/export/exportService.js:resolveExportTauriIpc.
  function getTauriInvoke() {
    if (typeof window === 'undefined') return null;
    function candidate(w) {
      if (!w) return null;
      if (w.__TAURI_INTERNALS__ && typeof w.__TAURI_INTERNALS__.invoke === 'function') return w.__TAURI_INTERNALS__;
      if (w.__TAURI__ && w.__TAURI__.core && typeof w.__TAURI__.core.invoke === 'function') return w.__TAURI__.core;
      return null;
    }
    var ipc = candidate(window);
    if (!ipc) {
      try { if (window.parent && window.parent !== window) ipc = candidate(window.parent); } catch (e) {}
    }
    if (!ipc) return null;
    return function (cmd, args) { return ipc.invoke(cmd, args || {}); };
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
    // Only tool keys have indicators; marp-plugin paths are user inputs
    // without a runtime probe.
    for (var k = 0; k < TOOL_KEYS.length; k++) {
      setIndicator(panel, TOOL_KEYS[k], 'none', '');
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

  // Forward to the in-app Logger View (window.logFrontendIssue lives in
  // src/logging/loggingSystem.js). Guarded so unit tests / non-Tauri hosts
  // where the logger hasn't loaded don't explode.
  function logToLoggerView(level, target, context, error) {
    if (typeof window !== 'undefined' && typeof window.logFrontendIssue === 'function') {
      window.logFrontendIssue(level, target, context, error);
    }
  }

  function composeFailureMessage(toolKey, result, functional) {
    var detail = '';
    if (functional && result && result.functional && result.functional.error) {
      detail = result.functional.error;
    } else if (result && result.error) {
      detail = result.error;
    }
    var headline = functional ? 'Test run failed' : 'Test version failed';
    if (functional && result && result.functional && typeof result.functional.durationMs === 'number') {
      headline += ' after ' + result.functional.durationMs + 'ms';
    }
    var msg = toolKey + ': ' + headline;
    if (detail) msg += ' — ' + detail;
    else msg += ' (no error detail)';
    if (result && result.path) msg += ' [path=' + result.path + ']';
    return msg;
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
    for (var k = 0; k < TOOL_KEYS.length; k++) {
      setIndicator(panel, TOOL_KEYS[k], 'pending', functional ? 'Running test\u2026' : 'Testing version\u2026');
    }
    showStatus(panel,
      functional ? 'Running test conversions\u2026 (this can take a while)' : 'Testing versions\u2026',
      false);
    var logTarget = functional ? 'render-apps.test-run' : 'render-apps.test-version';
    try {
      var results = await invoke('test_render_apps', { request: values });
      var okCount = 0;
      for (var i = 0; i < TOOL_KEYS.length; i++) {
        var key = TOOL_KEYS[i];
        var r = results && results[key];
        var state = deriveIndicatorState(r, functional);
        setIndicator(panel, key, state, formatTooltip(r));
        if (state === 'ok') okCount++;
        else logToLoggerView('error', logTarget, composeFailureMessage(key, r, functional), null);
      }
      showStatus(panel,
        okCount + '/' + TOOL_KEYS.length + (functional ? ' tools rendered successfully' : ' tools available'),
        okCount < TOOL_KEYS.length);
    } catch (err) {
      for (var j = 0; j < TOOL_KEYS.length; j++) {
        setIndicator(panel, TOOL_KEYS[j], 'none', '');
      }
      logToLoggerView('error', logTarget, 'test_render_apps invocation failed', err);
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
    for (var k = 0; k < TOOL_KEYS.length; k++) {
      var input = q(panel, TOOL_KEYS[k]);
      if (input) {
        input.addEventListener('input', (function (key) {
          return function () { setIndicator(panel, key, 'none', ''); };
        })(TOOL_KEYS[k]));
      }
    }

    // Browse buttons for Marp engine.js + templates folder — the two keys
    // that are plain user-supplied paths. Engine = file picker, templates
    // = folder picker. Falls back silently when not running inside Tauri.
    function wireBrowseButton(key, mode) {
      var btn = q(panel, key + '-browse');
      var input = q(panel, key);
      if (!btn || !input) return;
      btn.addEventListener('click', async function () {
        var invoke = getTauriInvoke();
        if (!invoke) {
          showStatus(panel, 'Browse unavailable outside Tauri', true);
          return;
        }
        try {
          if (mode === 'file') {
            var files = await invoke('browse_files', {
              title: 'Select Marp engine.js',
              extensions: ['js', 'cjs', 'mjs'],
              multiple: false,
              defaultPath: input.value || null,
            });
            var picked = Array.isArray(files) && files.length > 0 ? files[0] : null;
            if (picked) { input.value = picked; showStatus(panel, 'Engine set — click Save to persist.', false); }
          } else {
            var folder = await invoke('browse_folder', {
              title: 'Select Marp templates folder',
              defaultPath: input.value || null,
            });
            if (folder) { input.value = folder; showStatus(panel, 'Templates folder set — click Save to persist.', false); }
          }
        } catch (err) {
          showStatus(panel, 'Browse failed: ' + (err.message || String(err)), true);
        }
      });
    }
    wireBrowseButton('marpEnginePath', 'file');
    wireBrowseButton('marpTemplatesPath', 'folder');
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
