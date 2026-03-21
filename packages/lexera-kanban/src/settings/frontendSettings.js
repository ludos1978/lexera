(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraFrontendSettings = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var initializedPanels = [];

  function findPanel() {
    return document.querySelector('.lexera-shared-panel-frontend-settings') ||
           document.getElementById('frontend-settings-panel');
  }

  function q(panel, cls) {
    return panel.querySelector('.lexera-shared-frontend-settings-' + cls) ||
           panel.querySelector('#frontend-settings-' + cls);
  }

  function render(options) {
    var panel = findPanel();
    if (!panel) return false;
    var themeSelect = q(panel, 'theme-select');
    if (themeSelect && themeSelect.options.length === 0) {
      var themes = options && options.getThemes ? options.getThemes() : [];
      for (var i = 0; i < themes.length; i++) {
        var opt = document.createElement('option');
        opt.value = themes[i].id;
        opt.textContent = themes[i].label || themes[i].name || themes[i].id;
        themeSelect.appendChild(opt);
      }
    }
    if (themeSelect && options && typeof options.getCurrentThemeId === 'function') {
      themeSelect.value = options.getCurrentThemeId();
    }
    var sidebarOptions = options && typeof options.getSidebarDisplayOptions === 'function'
      ? options.getSidebarDisplayOptions() : {};

    var toggleMap = [
      ['overlay-editor', options && options.isOverlayEditorEnabled],
      ['wysiwyg-editor', options && options.isWysiwygEditorEnabled],
      ['marp-settings', options && options.isMarpSettingsEnabled],
      ['special-chars', options && options.isSpecialCharactersVisible]
    ];
    for (var k = 0; k < toggleMap.length; k++) {
      var el = q(panel, toggleMap[k][0]);
      var getter = toggleMap[k][1];
      if (el && typeof getter === 'function') el.checked = getter();
    }

    var sidebarToggles = [
      ['sidebar-counts', 'counts'],
      ['sidebar-presence', 'presence'],
      ['sidebar-grips', 'grips']
    ];
    for (var s = 0; s < sidebarToggles.length; s++) {
      var sEl = q(panel, sidebarToggles[s][0]);
      if (sEl) sEl.checked = !!sidebarOptions[sidebarToggles[s][1]];
    }
    return true;
  }

  function init(options) {
    var panel = findPanel();
    if (!panel) return false;
    if (initializedPanels.indexOf(panel) !== -1) return true;
    initializedPanels.push(panel);

    var themeSelect = q(panel, 'theme-select');
    if (themeSelect && options && typeof options.applyTheme === 'function') {
      themeSelect.addEventListener('change', function () {
        options.applyTheme(themeSelect.value || 'lexera');
      });
    }

    function bindToggle(cls, setter) {
      var input = q(panel, cls);
      if (!input || typeof setter !== 'function') return;
      input.addEventListener('change', function () {
        setter(!!input.checked);
        if (typeof options.syncMenuCheckStates === 'function') options.syncMenuCheckStates();
        render(options);
      });
    }

    if (options) {
      bindToggle('overlay-editor', options.setOverlayEditorEnabled);
      bindToggle('wysiwyg-editor', options.setWysiwygEditorEnabled);
      bindToggle('marp-settings', options.setMarpSettingsEnabled);
      bindToggle('special-chars', options.setSpecialCharactersVisible);
    }

    function bindSidebarToggle(cls, key) {
      var input = q(panel, cls);
      if (!input) return;
      input.addEventListener('change', function () {
        if (options && typeof options.getSidebarDisplayOptions === 'function' &&
            typeof options.applySidebarDisplayOptions === 'function') {
          var next = options.getSidebarDisplayOptions();
          next[key] = !!input.checked;
          options.applySidebarDisplayOptions(next);
        }
      });
    }

    bindSidebarToggle('sidebar-counts', 'counts');
    bindSidebarToggle('sidebar-presence', 'presence');
    bindSidebarToggle('sidebar-grips', 'grips');

    var inspectorBtn = q(panel, 'open-inspector');
    if (inspectorBtn && options && typeof options.toggleInspector === 'function') {
      inspectorBtn.addEventListener('click', function (e) {
        e.preventDefault();
        options.toggleInspector();
      });
    }

    render(options);
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
