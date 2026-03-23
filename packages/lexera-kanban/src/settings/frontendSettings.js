(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraFrontendSettings = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var initializedPanels = [];
  var panelOptionGetters = [];

  function findPanels() {
    var panels = [];
    var shared = document.querySelectorAll('.lexera-shared-panel-frontend-settings');
    for (var i = 0; i < shared.length; i++) {
      if (panels.indexOf(shared[i]) === -1) panels.push(shared[i]);
    }
    var legacy = document.getElementById('frontend-settings-panel');
    if (legacy && panels.indexOf(legacy) === -1) panels.push(legacy);
    return panels;
  }

  function resolvePanels(panel) {
    if (panel && panel.nodeType === 1) return [panel];
    return findPanels();
  }

  function q(panel, cls) {
    return panel.querySelector('.lexera-shared-frontend-settings-' + cls) ||
           panel.querySelector('#frontend-settings-' + cls);
  }

  /** Look up the latest options getter for a panel element. */
  function getOptionsForPanel(panel) {
    for (var i = 0; i < panelOptionGetters.length; i++) {
      if (panelOptionGetters[i].panel === panel) {
        return panelOptionGetters[i].getOptions();
      }
    }
    return null;
  }

  function render(options, panel) {
    var panels = resolvePanels(panel);
    if (!panels.length) return false;
    for (var p = 0; p < panels.length; p++) {
      var root = panels[p];
      if (!root) continue;
      // Use panel-specific options if available, fall back to passed options
      var opts = getOptionsForPanel(root) || options;
      var themeSelect = q(root, 'theme-select');
      if (themeSelect && themeSelect.options.length === 0) {
        var themes = opts && opts.getThemes ? opts.getThemes() : [];
        for (var i = 0; i < themes.length; i++) {
          var opt = document.createElement('option');
          opt.value = themes[i].id;
          opt.textContent = themes[i].label || themes[i].name || themes[i].id;
          themeSelect.appendChild(opt);
        }
      }
      if (themeSelect && opts && typeof opts.getCurrentThemeId === 'function') {
        themeSelect.value = opts.getCurrentThemeId();
      }
      var sidebarOptions = opts && typeof opts.getSidebarDisplayOptions === 'function'
        ? opts.getSidebarDisplayOptions() : {};

      var toggleMap = [
        ['overlay-editor', opts && opts.isOverlayEditorEnabled],
        ['wysiwyg-editor', opts && opts.isWysiwygEditorEnabled],
        ['marp-settings', opts && opts.isMarpSettingsEnabled],
        ['special-chars', opts && opts.isSpecialCharactersVisible]
      ];
      for (var k = 0; k < toggleMap.length; k++) {
        var el = q(root, toggleMap[k][0]);
        var getter = toggleMap[k][1];
        if (el && typeof getter === 'function') el.checked = getter();
      }

      var sidebarToggles = [
        ['sidebar-counts', 'counts'],
        ['sidebar-presence', 'presence'],
        ['sidebar-grips', 'grips']
      ];
      for (var s = 0; s < sidebarToggles.length; s++) {
        var sEl = q(root, sidebarToggles[s][0]);
        if (sEl) sEl.checked = !!sidebarOptions[sidebarToggles[s][1]];
      }
    }
    return true;
  }

  function bindPanel(panel, getOptions) {
    var themeSelect = q(panel, 'theme-select');
    if (themeSelect) {
      themeSelect.addEventListener('change', function () {
        var opts = getOptions();
        if (opts && typeof opts.applyTheme === 'function') {
          opts.applyTheme(themeSelect.value || 'lexera');
        }
      });
    }

    function bindToggle(cls, setterKey) {
      var input = q(panel, cls);
      if (!input) return;
      input.addEventListener('change', function () {
        var opts = getOptions();
        if (!opts) return;
        var setter = opts[setterKey];
        if (typeof setter === 'function') setter(!!input.checked);
        if (typeof opts.syncMenuCheckStates === 'function') opts.syncMenuCheckStates();
      });
    }

    bindToggle('overlay-editor', 'setOverlayEditorEnabled');
    bindToggle('wysiwyg-editor', 'setWysiwygEditorEnabled');
    bindToggle('marp-settings', 'setMarpSettingsEnabled');
    bindToggle('special-chars', 'setSpecialCharactersVisible');

    function bindSidebarToggle(cls, key) {
      var input = q(panel, cls);
      if (!input) return;
      input.addEventListener('change', function () {
        var opts = getOptions();
        if (opts && typeof opts.getSidebarDisplayOptions === 'function' &&
            typeof opts.applySidebarDisplayOptions === 'function') {
          var next = opts.getSidebarDisplayOptions();
          next[key] = !!input.checked;
          opts.applySidebarDisplayOptions(next);
        }
      });
    }

    bindSidebarToggle('sidebar-counts', 'counts');
    bindSidebarToggle('sidebar-presence', 'presence');
    bindSidebarToggle('sidebar-grips', 'grips');
  }

  function init(options, panel) {
    var panels = resolvePanels(panel);
    if (!panels.length) return false;
    // If options has a getOptions function use it; otherwise wrap the static object
    var getOptions = typeof options.getOptions === 'function'
      ? options.getOptions
      : function () { return options; };
    for (var i = 0; i < panels.length; i++) {
      var root = panels[i];
      if (!root) continue;
      if (initializedPanels.indexOf(root) === -1) {
        initializedPanels.push(root);
        panelOptionGetters.push({ panel: root, getOptions: getOptions });
        bindPanel(root, getOptions);
      }
      render(options, root);
    }
    return true;
  }

  function open(options) {
    init(options);
    if (options && typeof options.revealPanel === 'function') {
      options.revealPanel();
      return;
    }
    if (options && typeof options.showFallbackMenu === 'function') {
      options.showFallbackMenu();
    }
  }

  return {
    render: render,
    init: init,
    open: open
  };
}));
