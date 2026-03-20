(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraFrontendSettings = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var initialized = false;

  function render(options) {
    var panel = document.getElementById('frontend-settings-panel');
    if (!panel) return false;
    var themeSelect = document.getElementById('frontend-settings-theme-select');
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
      ['frontend-settings-overlay-editor', options && options.isOverlayEditorEnabled],
      ['frontend-settings-wysiwyg-editor', options && options.isWysiwygEditorEnabled],
      ['frontend-settings-marp-settings', options && options.isMarpSettingsEnabled],
      ['frontend-settings-special-chars', options && options.isSpecialCharactersVisible]
    ];
    for (var k = 0; k < toggleMap.length; k++) {
      var el = document.getElementById(toggleMap[k][0]);
      var getter = toggleMap[k][1];
      if (el && typeof getter === 'function') el.checked = getter();
    }

    var sidebarToggles = [
      ['frontend-settings-sidebar-counts', 'counts'],
      ['frontend-settings-sidebar-presence', 'presence'],
      ['frontend-settings-sidebar-grips', 'grips']
    ];
    for (var s = 0; s < sidebarToggles.length; s++) {
      var sEl = document.getElementById(sidebarToggles[s][0]);
      if (sEl) sEl.checked = !!sidebarOptions[sidebarToggles[s][1]];
    }
    return true;
  }

  function init(options) {
    if (initialized) return true;
    var panel = document.getElementById('frontend-settings-panel');
    if (!panel) return false;
    initialized = true;

    var themeSelect = document.getElementById('frontend-settings-theme-select');
    if (themeSelect && options && typeof options.applyTheme === 'function') {
      themeSelect.addEventListener('change', function () {
        options.applyTheme(themeSelect.value || 'lexera');
      });
    }

    function bindToggle(id, setter) {
      var input = document.getElementById(id);
      if (!input || typeof setter !== 'function') return;
      input.addEventListener('change', function () {
        setter(!!input.checked);
        if (typeof options.syncMenuCheckStates === 'function') options.syncMenuCheckStates();
        render(options);
      });
    }

    if (options) {
      bindToggle('frontend-settings-overlay-editor', options.setOverlayEditorEnabled);
      bindToggle('frontend-settings-wysiwyg-editor', options.setWysiwygEditorEnabled);
      bindToggle('frontend-settings-marp-settings', options.setMarpSettingsEnabled);
      bindToggle('frontend-settings-special-chars', options.setSpecialCharactersVisible);
    }

    function bindSidebarToggle(id, key) {
      var input = document.getElementById(id);
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

    bindSidebarToggle('frontend-settings-sidebar-counts', 'counts');
    bindSidebarToggle('frontend-settings-sidebar-presence', 'presence');
    bindSidebarToggle('frontend-settings-sidebar-grips', 'grips');

    var inspectorBtn = document.getElementById('frontend-settings-open-inspector');
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
    render(options);
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
