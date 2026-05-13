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

  function renderTagGroupChips(root, scope, CMB) {
    var container = q(root, 'tag-groups-' + scope);
    if (!container) return;
    var allGroups = CMB.TAG_CATEGORY_MENU_ORDER || [];
    var labels = CMB.TAG_CATEGORY_MENU_LABELS || {};
    var enabled = CMB.getTagGroupsForScope(scope);

    // Rebuild chips
    var chipsWrap = container.querySelector('.tag-group-chips-list');
    if (!chipsWrap) {
      chipsWrap = document.createElement('div');
      chipsWrap.className = 'tag-group-chips-list';
      container.appendChild(chipsWrap);
    }
    chipsWrap.innerHTML = '';
    for (var i = 0; i < enabled.length; i++) {
      var chip = document.createElement('span');
      chip.className = 'tag-group-chip';
      chip.setAttribute('data-group-id', enabled[i]);
      chip.innerHTML = '<span class="tag-group-chip-label">' + (labels[enabled[i]] || enabled[i]) + '</span><button class="tag-group-chip-remove" type="button">\u00D7</button>';
      chipsWrap.appendChild(chip);
    }

    // Add input if not present
    if (!container.querySelector('.tag-group-add-input')) {
      var input = document.createElement('input');
      input.className = 'tag-group-add-input';
      input.type = 'text';
      input.placeholder = '+ add group';
      input.setAttribute('list', 'tag-group-options-' + scope);
      var datalist = document.createElement('datalist');
      datalist.id = 'tag-group-options-' + scope;
      for (var g = 0; g < allGroups.length; g++) {
        var opt = document.createElement('option');
        opt.value = labels[allGroups[g]] || allGroups[g];
        opt.setAttribute('data-group-id', allGroups[g]);
        datalist.appendChild(opt);
      }
      container.appendChild(input);
      container.appendChild(datalist);
    }
  }

  function render(options, panel) {
    var panels = resolvePanels(panel);
    if (!panels.length) return false;
    for (var p = 0; p < panels.length; p++) {
      var root = panels[p];
      if (!root) continue;
      var opts = getOptionsForPanel(root) || options;

      // Theme mode select (auto / light / dark). Reads the user's
      // REQUESTED mode (not the resolved effective one) so the dropdown
      // can show "Auto" even when OS preference resolved to dark.
      var themeModeSelect = q(root, 'theme-mode');
      if (themeModeSelect && opts && typeof opts.getThemeMode === 'function') {
        var modeNow = opts.getThemeMode();
        themeModeSelect.value = (modeNow === 'auto' || modeNow === 'light' || modeNow === 'dark')
          ? modeNow
          : 'auto';
      }

      // Visual theme select
      var visualThemeSelect = q(root, 'visual-theme');
      if (visualThemeSelect) {
        var vThemes = opts && opts.getVisualThemes ? opts.getVisualThemes() : [];
        visualThemeSelect.innerHTML = '';
        for (var vi = 0; vi < vThemes.length; vi++) {
          var vOpt = document.createElement('option');
          vOpt.value = vThemes[vi].id;
          vOpt.textContent = vThemes[vi].name || vThemes[vi].id;
          visualThemeSelect.appendChild(vOpt);
        }
      }
      if (visualThemeSelect && opts && typeof opts.getCurrentVisualThemeId === 'function') {
        visualThemeSelect.value = opts.getCurrentVisualThemeId();
      }

      // UI scale
      var uiScaleSelect = q(root, 'ui-scale');
      if (uiScaleSelect && opts && typeof opts.getUiScale === 'function') {
        uiScaleSelect.value = String(opts.getUiScale());
      }

      // Scroll/zoom speed
      var scrollSpeedSelect = q(root, 'scroll-speed');
      if (scrollSpeedSelect && opts && typeof opts.getScrollSpeed === 'function') {
        scrollSpeedSelect.value = String(opts.getScrollSpeed());
      }
      var zoomSpeedSelect = q(root, 'zoom-speed');
      if (zoomSpeedSelect && opts && typeof opts.getZoomSpeed === 'function') {
        zoomSpeedSelect.value = String(opts.getZoomSpeed());
      }

      // Display settings
      var tagVisSelect = q(root, 'tag-visibility');
      if (tagVisSelect && opts && typeof opts.getTagVisibility === 'function') {
        tagVisSelect.value = opts.getTagVisibility();
      }
      var htmlCommentsSelect = q(root, 'html-comments');
      if (htmlCommentsSelect && opts && typeof opts.getHtmlCommentMode === 'function') {
        htmlCommentsSelect.value = opts.getHtmlCommentMode();
      }
      var htmlContentSelect = q(root, 'html-content');
      if (htmlContentSelect && opts && typeof opts.getHtmlContentMode === 'function') {
        htmlContentSelect.value = opts.getHtmlContentMode();
      }

      // Tag group chips per entity type
      var CMB = opts && opts.getContextMenuBuilders ? opts.getContextMenuBuilders() : null;
      if (CMB) {
        var scopes = ['card', 'column', 'stack', 'row'];
        for (var tg = 0; tg < scopes.length; tg++) {
          renderTagGroupChips(root, scopes[tg], CMB);
        }
      }

      // Toggles
      var toggleMap = [
        ['overlay-editor', opts && opts.isOverlayEditorEnabled],
        ['special-chars', opts && opts.isSpecialCharactersVisible]
      ];
      for (var k = 0; k < toggleMap.length; k++) {
        var el = q(root, toggleMap[k][0]);
        var getter = toggleMap[k][1];
        if (el && typeof getter === 'function') el.checked = getter();
      }

    }
    return true;
  }

  function bindPanel(panel, getOptions) {
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

    // Select-based settings
    function bindSelect(cls, setterKey) {
      var input = q(panel, cls);
      if (!input) return;
      input.addEventListener('change', function () {
        var opts = getOptions();
        if (!opts) return;
        var setter = opts[setterKey];
        if (typeof setter === 'function') setter(input.value);
      });
    }

    bindSelect('theme-mode', 'applyThemeMode');
    bindSelect('visual-theme', 'applyVisualTheme');
    bindSelect('ui-scale', 'applyUiScale');
    bindSelect('scroll-speed', 'setScrollSpeed');
    bindSelect('zoom-speed', 'setZoomSpeed');
    bindSelect('tag-visibility', 'setTagVisibility');
    bindSelect('html-comments', 'setHtmlCommentMode');
    bindSelect('html-content', 'setHtmlContentMode');

    // Checkbox toggles
    bindToggle('overlay-editor', 'setOverlayEditorEnabled');
    bindToggle('special-chars', 'setSpecialCharactersVisible');

    // Tag group chips — remove chip on x click, add on input
    var tagScopes = ['card', 'column', 'stack', 'row'];
    for (var tgi = 0; tgi < tagScopes.length; tgi++) {
      (function (scope) {
        var container = q(panel, 'tag-groups-' + scope);
        if (!container) return;

        // Remove chip on x click
        container.addEventListener('click', function (e) {
          var removeBtn = e.target.closest('.tag-group-chip-remove');
          if (!removeBtn) return;
          var chip = removeBtn.closest('.tag-group-chip');
          if (!chip) return;
          var groupId = chip.getAttribute('data-group-id');
          var opts = getOptions();
          var CMB = opts && opts.getContextMenuBuilders ? opts.getContextMenuBuilders() : null;
          if (!CMB) return;
          var current = CMB.getTagGroupsForScope(scope);
          var next = [];
          for (var ri = 0; ri < current.length; ri++) {
            if (current[ri] !== groupId) next.push(current[ri]);
          }
          CMB.setTagGroupsForScope(scope, next);
          renderTagGroupChips(panel, scope, CMB);
        });

        // Add group from autocomplete input — use delegation since input
        // is created later by renderTagGroupChips
        container.addEventListener('change', function (e) {
          var inp = e.target;
          if (!inp || !inp.classList.contains('tag-group-add-input')) return;
          var val = inp.value.trim();
          if (!val) return;
          var opts = getOptions();
          var CMB = opts && opts.getContextMenuBuilders ? opts.getContextMenuBuilders() : null;
          if (!CMB) return;
          var allGroups = CMB.TAG_CATEGORY_MENU_ORDER || [];
          var labels = CMB.TAG_CATEGORY_MENU_LABELS || {};
          var groupId = null;
          for (var ai = 0; ai < allGroups.length; ai++) {
            var lbl = labels[allGroups[ai]] || allGroups[ai];
            if (lbl.toLowerCase() === val.toLowerCase() || allGroups[ai] === val) {
              groupId = allGroups[ai];
              break;
            }
          }
          if (!groupId) { inp.value = ''; return; }
          var current = CMB.getTagGroupsForScope(scope);
          if (current.indexOf(groupId) === -1) {
            current.push(groupId);
            CMB.setTagGroupsForScope(scope, current);
          }
          inp.value = '';
          renderTagGroupChips(panel, scope, CMB);
        });
      })(tagScopes[tgi]);
    }

    // ── Controls settings ──
    bindControlsSettings(panel);
  }

  function renderControlsChips(panel) {
    var CS = typeof LexeraControlsSettings !== 'undefined' ? LexeraControlsSettings : null;
    if (!CS) return;
    var groups = panel.querySelectorAll('[data-controls-mode]');
    for (var gi = 0; gi < groups.length; gi++) {
      var mode = groups[gi].getAttribute('data-controls-mode');
      var actions = groups[gi].querySelectorAll('[data-controls-action]');
      for (var ai = 0; ai < actions.length; ai++) {
        var action = actions[ai].getAttribute('data-controls-action');
        var container = actions[ai].querySelector('.controls-settings-chips');
        if (!container) continue;
        container.innerHTML = '';
        var bindings = CS.getBindings(mode, action);
        for (var bi = 0; bi < bindings.length; bi++) {
          (function (idx, curMode, curAction, curContainer, curBinding) {
            var chip = document.createElement('span');
            chip.className = 'controls-chip';
            chip.textContent = CS.bindingLabel(curBinding);
            var removeBtn = document.createElement('button');
            removeBtn.className = 'controls-chip-remove';
            removeBtn.type = 'button';
            removeBtn.textContent = '\u00d7';
            removeBtn.title = 'Remove binding';
            removeBtn.addEventListener('click', function (e) {
              e.preventDefault();
              e.stopPropagation();
              var currentList = CS.getBindings(curMode, curAction);
              var removeAt = idx;
              var key = CS.bindingKey(curBinding);
              if (!currentList[removeAt] || CS.bindingKey(currentList[removeAt]) !== key) {
                removeAt = -1;
                for (var k = 0; k < currentList.length; k++) {
                  if (CS.bindingKey(currentList[k]) === key) { removeAt = k; break; }
                }
              }
              if (removeAt >= 0) CS.removeBinding(curMode, curAction, removeAt);
              renderControlsChips(panel);
            });
            chip.appendChild(removeBtn);
            curContainer.appendChild(chip);
          })(bi, mode, action, container, bindings[bi]);
        }
      }
    }
  }

  function bindControlsSettings(panel) {
    var CS = typeof LexeraControlsSettings !== 'undefined' ? LexeraControlsSettings : null;
    if (!CS) return;

    // Delegate add-binding button clicks
    var controlsSection = panel.querySelector('[data-frontend-settings-section="controls"]');
    if (!controlsSection) return;

    controlsSection.addEventListener('click', function (e) {
      // Reset button
      var resetBtn = e.target.closest('[data-controls-reset]');
      if (resetBtn) {
        CS.resetToDefaults();
        renderControlsChips(panel);
        return;
      }

      // Add binding button
      var addBtn = e.target.closest('[data-controls-add]');
      if (!addBtn) return;
      var actionEl = addBtn.closest('[data-controls-action]');
      var groupEl = addBtn.closest('[data-controls-mode]');
      if (!actionEl || !groupEl) return;
      var mode = groupEl.getAttribute('data-controls-mode');
      var action = actionEl.getAttribute('data-controls-action');

      // Start capture mode — show a prompt overlay
      startBindingCapture(panel, mode, action);
    });

    renderControlsChips(panel);
  }

  function startBindingCapture(panel, mode, action) {
    var CS = typeof LexeraControlsSettings !== 'undefined' ? LexeraControlsSettings : null;
    if (!CS) return;

    // Create capture overlay
    var overlay = document.createElement('div');
    overlay.className = 'controls-capture-overlay';
    overlay.innerHTML =
      '<div class="controls-capture-prompt">' +
        '<div class="controls-capture-title">Recording binding for <b>' +
          mode + ' / ' + action + '</b></div>' +
        '<div class="controls-capture-hint">Press a key, scroll, double-click, or drag to record.</div>' +
        '<button class="controls-capture-cancel mgmt-btn mgmt-btn-small" type="button">Cancel</button>' +
      '</div>';
    panel.appendChild(overlay);

    var done = false;
    function finish(binding) {
      if (done) return;
      done = true;
      cleanup();
      if (binding) {
        CS.addBinding(mode, action, binding);
        renderControlsChips(panel);
      }
    }
    function cancel() { finish(null); }

    overlay.querySelector('.controls-capture-cancel').addEventListener('click', cancel);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) cancel();
    });

    // Capture keydown
    function onKey(e) {
      if (e.key === 'Escape') { cancel(); return; }
      e.preventDefault();
      e.stopPropagation();
      var binding = { type: 'key', key: e.key };
      if (e.ctrlKey) binding.ctrl = true;
      if (e.altKey) binding.alt = true;
      if (e.shiftKey) binding.shift = true;
      if (e.metaKey) binding.meta = true;
      // Don't capture bare modifiers
      if (['Control', 'Alt', 'Shift', 'Meta'].indexOf(e.key) !== -1) return;
      finish(binding);
    }

    // Capture wheel
    function onWheel(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) return; // reserved for browser zoom
      var binding = { type: 'scroll' };
      if (e.altKey) binding.alt = true;
      if (e.shiftKey) binding.shift = true;
      finish(binding);
    }

    // Capture mouse drag (mousedown on overlay)
    function onMouseDown(e) {
      if (e.target.closest('.controls-capture-cancel')) return;
      if (e.target === overlay || e.target.closest('.controls-capture-prompt')) {
        e.preventDefault();
        var binding = { type: 'drag', button: e.button };
        if (e.altKey) binding.alt = true;
        if (e.shiftKey) binding.shift = true;
        finish(binding);
      }
    }

    // Capture dblclick
    function onDblClick(e) {
      e.preventDefault();
      finish({ type: 'dblclick' });
    }

    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('wheel', onWheel, { capture: true, passive: false });
    overlay.addEventListener('mousedown', onMouseDown, true);
    overlay.addEventListener('dblclick', onDblClick, true);

    function cleanup() {
      document.removeEventListener('keydown', onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
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
