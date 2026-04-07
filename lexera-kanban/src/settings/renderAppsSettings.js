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
      var statusEl = q(root, 'status');
      if (statusEl) statusEl.textContent = '';
    }
    return true;
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
