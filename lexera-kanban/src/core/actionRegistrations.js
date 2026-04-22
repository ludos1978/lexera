/**
 * Lexera Action Registrations — extracted from app.js.
 *
 * Contains all ActionRegistry.register() and BoardSettingRegistry.register()
 * calls that wire user actions to board/card/column/row/stack/canvas handlers.
 *
 * Exposed as window.LexeraActionRegistrations with a single entry point:
 *   LexeraActionRegistrations.registerAll(deps)
 */
(function () {
  'use strict';

  // --- Named Layout Presets (save/load/delete) ---
  var LAYOUT_PRESET_SETTINGS_KEYS = [
    'columnWidth', 'stackWidth', 'whitespace', 'fontSize', 'fontFamily',
    'layoutRows', 'rowHeight', 'cardMinHeight', 'layoutSpacing'
  ];
  var LAYOUT_PRESETS_STORAGE_KEY = 'lexera-layout-presets';

  function getSavedLayoutPresets(Settings) {
    if (Settings) return Settings.get('layoutPresets') || {};
    try { return JSON.parse(localStorage.getItem(LAYOUT_PRESETS_STORAGE_KEY)) || {}; }
    catch (_) { return {}; }
  }

  function saveLayoutPreset(name, settings, Settings) {
    var presets = getSavedLayoutPresets(Settings);
    presets[name] = settings;
    if (Settings) Settings.set('layoutPresets', presets); else localStorage.setItem(LAYOUT_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  }

  function deleteLayoutPreset(name, Settings) {
    var presets = getSavedLayoutPresets(Settings);
    delete presets[name];
    if (Settings) Settings.set('layoutPresets', presets); else localStorage.setItem(LAYOUT_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  }

  function captureCurrentLayoutSettings(getBoardSettingValue) {
    var captured = {};
    for (var i = 0; i < LAYOUT_PRESET_SETTINGS_KEYS.length; i++) {
      var key = LAYOUT_PRESET_SETTINGS_KEYS[i];
      captured[key] = getBoardSettingValue(key, null);
    }
    return captured;
  }

  function applyLayoutPresetSettings(settings, setBoardSettingValue) {
    for (var i = 0; i < LAYOUT_PRESET_SETTINGS_KEYS.length; i++) {
      var key = LAYOUT_PRESET_SETTINGS_KEYS[i];
      setBoardSettingValue(key, settings[key] || null);
    }
  }

  /**
   * Register all actions.
   * @param {Object} d - dependency bag from app.js
   */
  function registerAll(d) {
    var ActionRegistry = d.ActionRegistry;
    var BoardSettingRegistry = d.BoardSettingRegistry;
    var Settings = d.Settings;

    // =========================================================================
    // ----- Board scope -----
    // =========================================================================

    // Recent boards
    ActionRegistry.register('board', 'recent:*', function (action) { var id = action.substring(7); if (id) d.selectBoard(id); });

    // Window management
    ActionRegistry.register('board', 'new-window', function () {
      if (d.hasTauri) d.tauriInvoke('open_new_window', { boardId: null });
    });

    // Undo/redo
    ActionRegistry.register('board', 'undo', function () { d.undo(); });
    ActionRegistry.register('board', 'redo', function () { d.redo(); });

    // Board structure
    ActionRegistry.register('board', 'add-row', function () { d.addRow(); });
    ActionRegistry.register('board', 'add-stack', function () {
      var abd = d.getActiveBoardData();
      if (abd && abd.rows && abd.rows.length > 0) d.addStackToRow(abd.rows.length - 1);
    });
    ActionRegistry.register('board', 'add-column', function () {
      var abd = d.getActiveBoardData();
      if (abd && abd.rows && abd.rows.length > 0) {
        var lastRow = abd.rows[abd.rows.length - 1];
        if (lastRow.stacks && lastRow.stacks.length > 0) d.addColumnToStack(abd.rows.length - 1, lastRow.stacks.length - 1);
      }
    });
    ActionRegistry.register('board', 'add-card', function () {
      var abd = d.getActiveBoardData();
      var columns = abd ? abd.columns : [];
      if (columns.length > 0) {
        d.insertCardAtIndex(columns[0].index).then(function (ok) {
          if (!ok) return;
          var allCards = d.getElColumnsContainer().querySelectorAll('.card[data-col-index="' + columns[0].index + '"]');
          var cardEl = allCards.length > 0 ? allCards[allCards.length - 1] : null;
          if (cardEl) d.openCardEditor(cardEl, columns[0].index, parseInt(cardEl.getAttribute('data-card-index'), 10), 'inline');
        });
      }
    });

    // Fold
    ActionRegistry.register('board', 'fold-all', function () { d.toggleFoldAll(); });
    ActionRegistry.register('board', 'unfold-all', function () { d.toggleFoldAll(); });
    ActionRegistry.register('board', 'fold-columns', function () { d.toggleFoldAllColumns(); });
    ActionRegistry.register('board', 'unfold-columns', function () { d.toggleFoldAllColumns(); });
    ActionRegistry.register('board', 'fold-cards', function () { d.toggleFoldAllCards(); });
    ActionRegistry.register('board', 'unfold-cards', function () { d.toggleFoldAllCards(); });
    ActionRegistry.register('board', 'toggle-fold-cards', function () { d.toggleFoldAllCards(); });
    ActionRegistry.register('board', 'toggle-fold-columns', function () { d.toggleFoldAllColumns(); });

    // Sorting
    ActionRegistry.register('board', 'sort-all-cards:*', function (action) {
      var sortMode = action.substring('sort-all-cards:'.length);
      var resolvedMode = sortMode === 'tag' ? 'tag' : sortMode === 'duedate' ? 'duedate' : 'title';
      d.sortAllCardsAcrossBoard(resolvedMode);
    });

    // ── Board Setting Descriptors ─────────────────────────────────────
    BoardSettingRegistry.register({
      id: 'columnWidth', label: 'Column Width', category: 'format',
      settingsKey: 'columnWidth', actionPrefix: 'set-column-width', defaultValue: '350px',
      normalize: d.normalizeColumnWidth,
      options: [
        { value: '250px', label: '250px' }, { value: '350px', label: '350px' },
        { value: '450px', label: '450px' }, { value: '550px', label: '550px' },
        { value: '650px', label: '650px' }, { separator: true },
        { value: '31.5vw', label: '1/3 Screen' }, { value: '48vw', label: '1/2 Screen' },
        { value: '63vw', label: '2/3 Screen' }, { value: '95vw', label: 'Full Width' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'stackWidth', label: 'Stack Width', category: 'format',
      settingsKey: 'stackWidth', actionPrefix: 'set-stack-width-default', defaultValue: '350px',
      normalize: d.normalizeStackWidth,
      options: [
        { value: '200px', label: '200px' }, { value: '250px', label: '250px' },
        { value: '300px', label: '300px' }, { value: '350px', label: '350px (default)' },
        { value: '400px', label: '400px' }, { value: '500px', label: '500px' },
        { value: '600px', label: '600px' }, { value: '800px', label: '800px' },
        { value: '1000px', label: '1000px' }, { value: '1200px', label: '1200px' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'cardHeight', label: 'Card Height', category: 'format',
      settingsKey: 'cardMinHeight', actionPrefix: 'set-card-height', defaultValue: 'auto',
      normalize: function (v) { return String(v || 'auto').trim().toLowerCase(); },
      options: [
        { value: 'auto', label: 'Auto' }, { separator: true },
        { value: '200px', label: 'Small' }, { value: '400px', label: 'Medium' },
        { value: '600px', label: 'Large' }, { separator: true },
        { value: '26.5vh', label: '1/3 Screen' }, { value: '43.5vh', label: '1/2 Screen' },
        { value: '59vh', label: '2/3 Screen' }, { value: '92vh', label: 'Full Screen' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'whitespace', label: 'Whitespace', category: 'format',
      settingsKey: 'whitespace', actionPrefix: 'set-whitespace', defaultValue: '8px',
      normalize: d.normalizeWhitespaceValue,
      options: [
        { value: '8px', label: 'Compact' }, { value: '16px', label: 'Relaxed' },
        { value: '32px', label: 'Spacious' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'fontSize', label: 'Font Size', category: 'format',
      settingsKey: 'fontSize', actionPrefix: 'set-font-size', defaultValue: '13px',
      normalize: d.normalizeBoardFontSizeValue,
      options: [
        { value: '6.5px', label: '0.5x' }, { value: '9.75px', label: '0.75x' },
        { value: '13px', label: '1x' }, { value: '16.25px', label: '1.25x' },
        { value: '19.5px', label: '1.5x' }, { value: '26px', label: '2x' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'fontFamily', label: 'Font Family', category: 'format',
      settingsKey: 'fontFamily', actionPrefix: 'set-font-family', defaultValue: 'system',
      normalize: d.normalizeBoardFontFamilyToken,
      resolve: d.resolveBoardFontFamilyValue,
      options: [
        { value: 'system', label: 'System Default' },
        { value: 'roboto', label: 'Roboto' }, { value: 'opensans', label: 'Open Sans' },
        { value: 'lato', label: 'Lato' }, { value: 'plusjakarta', label: 'Plus Jakarta Sans' },
        { value: 'inter', label: 'Inter' }, { value: 'poppins', label: 'Poppins' },
        { separator: true },
        { value: 'helvetica', label: 'Helvetica' }, { value: 'arial', label: 'Arial' },
        { value: 'georgia', label: 'Georgia' }, { value: 'times', label: 'Times New Roman' },
        { separator: true },
        { value: 'firacode', label: 'Fira Code' }, { value: 'jetbrains', label: 'JetBrains Mono' },
        { value: 'sourcecodepro', label: 'Source Code Pro' }, { value: 'consolas', label: 'Consolas' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'rowHeight', label: 'Row Height', category: 'format',
      settingsKey: 'rowHeight', actionPrefix: 'set-row-height', defaultValue: 'auto',
      normalize: function (v) { return String(v || 'auto').trim().toLowerCase(); },
      options: [
        { value: 'auto', label: 'Auto' }, { separator: true },
        { value: '300px', label: 'Small' }, { value: '500px', label: 'Medium' },
        { value: '700px', label: 'Large' }, { separator: true },
        { value: '31.5vh', label: '1/3 Screen' }, { value: '48vh', label: '1/2 Screen' },
        { value: '63vh', label: '2/3 Screen' }, { value: '95vh', label: 'Full Screen' }
      ]
    });

    BoardSettingRegistry.register({
      id: 'boardLayout', label: 'Board Layout', category: 'format',
      settingsKey: 'boardLayout', actionPrefix: 'set-board-layout', defaultValue: 'kanban',
      normalize: d.normalizeBoardLayoutValue,
      options: [
        { value: 'kanban', label: 'Kanban' }, { value: 'canvas', label: 'Canvas' }
      ],
      handler: function (raw) {
        var v = d.normalizeBoardLayoutValue(raw);
        d.setBoardSettingValue('boardLayout', v);
      }
    });
    BoardSettingRegistry.register({
      id: 'canvasGrid', label: 'Canvas Grid', category: 'format',
      settingsKey: 'canvasGrid', actionPrefix: 'set-canvas-grid', defaultValue: '32',
      normalize: d.normalizeCanvasGridValue,
      options: [
        { value: 'off', label: 'Off' },
        { value: '16', label: 'Fine 16px' },
        { value: '32', label: 'Medium 32px' },
        { value: '64', label: 'Large 64px' },
        { value: 'largest', label: 'Largest Element' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'layoutPreset', label: 'Layout Preset', category: 'format',
      settingsKey: 'layoutPreset', actionPrefix: 'set-layout-preset', defaultValue: 'normal',
      normalize: function (v) { return String(v || 'normal').toLowerCase(); },
      handler: function (raw) {
        var v = String(raw || '').trim().toLowerCase();
        if (v === 'spacious') {
          d.setBoardSettingValue('layoutPreset', 'spacious');
          d.setBoardSettingValue('layoutSpacing', 'spacious');
        } else if (v === 'normal' || !v) {
          d.setBoardSettingValue('layoutPreset', null);
          d.setBoardSettingValue('layoutSpacing', null);
        } else {
          // Custom saved preset
          var presets = getSavedLayoutPresets(Settings);
          if (presets[v]) {
            applyLayoutPresetSettings(presets[v], d.setBoardSettingValue);
            d.setBoardSettingValue('layoutPreset', v);
            d.showNotification('Layout preset: ' + v);
          }
        }
      },
      options: [
        { value: 'normal', label: 'Normal' }, { value: 'spacious', label: 'Spacious' }
      ]
    });
    // stickyHeaders registry entry removed — always sticky at top
    BoardSettingRegistry.register({
      id: 'arrowFocusScroll', label: 'Arrow Key Focus Scroll', category: 'format',
      settingsKey: 'arrowKeyFocusScroll', actionPrefix: 'set-arrow-focus-scroll', defaultValue: 'nearest',
      normalize: d.normalizeArrowKeyFocusScrollMode,
      options: [
        { value: 'nearest', label: 'Nearest' }, { value: 'center', label: 'Center' },
        { value: 'disabled', label: 'Disabled' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'scrollSpeed', label: 'Scroll Speed', category: 'format',
      settingsKey: 'scrollSpeed', actionPrefix: 'set-scroll-speed', defaultValue: '1',
      normalize: d.normalizeBoardScrollSpeedValue,
      options: [
        { value: '0.01', label: '1%' }, { value: '0.02', label: '2%' },
        { value: '0.03', label: '3%' }, { value: '0.06', label: '6%' },
        { value: '0.1', label: '10%' }, { value: '0.18', label: '18%' },
        { value: '0.32', label: '32%' }, { value: '0.56', label: '56%' },
        { value: '1', label: '100%' }, { value: '1.33', label: '133%' },
        { value: '1.67', label: '167%' }, { value: '2', label: '200%' },
        { value: '3', label: '300%' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'zoomSpeed', label: 'Zoom Speed', category: 'format',
      settingsKey: 'zoomSpeed', actionPrefix: 'set-zoom-speed', defaultValue: '0.06',
      normalize: d.normalizeBoardZoomSpeedValue,
      options: [
        { value: '0.01', label: '1%' }, { value: '0.02', label: '2%' },
        { value: '0.03', label: '3%' }, { value: '0.06', label: '6%' },
        { value: '0.1', label: '10%' }, { value: '0.18', label: '18%' },
        { value: '0.32', label: '32%' }, { value: '0.56', label: '56%' },
        { value: '1', label: '100%' }, { value: '1.33', label: '133%' },
        { value: '1.67', label: '167%' }, { value: '2', label: '200%' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'htmlComments', label: 'HTML Comments', category: 'display',
      settingsKey: 'htmlCommentRenderMode', actionPrefix: 'set-html-comments', defaultValue: 'hidden',
      normalize: d.normalizeHtmlCommentRenderMode,
      options: [
        { value: 'hidden', label: 'Hide Comments' }, { value: 'text', label: 'Show as Text' },
        { value: 'dim', label: 'Dim Comments' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'htmlContent', label: 'HTML Content', category: 'display',
      settingsKey: 'htmlContentRenderMode', actionPrefix: 'set-html-content', defaultValue: 'html',
      normalize: function (v) { return v === 'html' ? 'html' : 'text'; },
      options: [
        { value: 'html', label: 'Render HTML' }, { value: 'text', label: 'Show as Text' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'tagVisibility', label: 'Tag Visibility', category: 'display',
      settingsKey: 'tagVisibility', actionPrefix: 'set-tag-visibility', defaultValue: 'allexcludinglayout',
      normalize: d.normalizeTagVisibilityMode,
      options: [
        { value: 'all', label: 'All Tags' }, { value: 'allexcludinglayout', label: 'All Except Layout Tags' },
        { value: 'customonly', label: 'Custom Tags Only' }, { value: 'mentionsonly', label: 'Mentions Only' },
        { value: 'dim', label: 'Dim Tags' }, { value: 'none', label: 'Hide Tags' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'tagStylePreset', label: 'Tag Style Preset', category: 'display',
      settingsKey: null, actionPrefix: 'set-tag-style-preset', defaultValue: 'default',
      getCurrentValue: function () { return d.getActiveTagStylePreset(); },
      handler: function (raw) {
        d.setActiveTagStylePreset(raw);
        d.refreshTargetedElements([{ type: 'board' }]);
        d.showNotification('Tag style: ' + (d.TAG_STYLE_PRESETS[raw] ? d.TAG_STYLE_PRESETS[raw].label : raw));
      },
      options: (function () {
        var items = [];
        var keys = Object.keys(d.TAG_STYLE_PRESETS);
        for (var i = 0; i < keys.length; i++) {
          var p = d.TAG_STYLE_PRESETS[keys[i]];
          items.push({ value: keys[i], label: p.label + (p.description ? ' \u2014 ' + p.description : '') });
        }
        return items;
      })()
    });
    BoardSettingRegistry.register({
      id: 'visualTheme', label: 'Visual Theme', category: 'display',
      settingsKey: null, actionPrefix: 'set-visual-theme', defaultValue: 'classic',
      getCurrentValue: function () {
        return (typeof d.getLexeraCurrentVisualThemeId === 'function' && d.getLexeraCurrentVisualThemeId()) || 'classic';
      },
      handler: function (raw) {
        var applied = d.applyVisualTheme(raw);
        var label = (applied && applied.name) || d.VISUAL_THEME_LABELS[String(raw || '').trim()] || String(raw || 'classic');
        d.showNotification('Visual theme: ' + label);
      },
      options: function () {
        return d.VISUAL_THEMES.map(function (theme) {
          return {
            value: theme.id,
            label: theme.name + (theme.description ? ' \u2014 ' + theme.description : '')
          };
        });
      }
    });

    // Auto-wire board setting action handlers from descriptors
    var allSettingDescs = BoardSettingRegistry.getAll();
    for (var bsi = 0; bsi < allSettingDescs.length; bsi++) {
      (function (desc) {
        ActionRegistry.register('board', desc.actionPrefix + ':*', function (action) {
          var raw = action.substring(desc.actionPrefix.length + 1);
          if (desc.handler) {
            desc.handler(raw);
          } else {
            var v = desc.normalize ? desc.normalize(raw) : raw;
            if (desc.resolve) v = desc.resolve(v);
            d.setBoardSettingValue(desc.settingsKey, v || null);
          }
        });
      })(allSettingDescs[bsi]);
    }
    ActionRegistry.register('board', 'set-ui-template:*', function (action) {
      var raw = action.substring('set-ui-template:'.length);
      var applied = d.applyVisualTheme(raw);
      d.showNotification('Visual theme: ' + ((applied && applied.name) || d.VISUAL_THEME_LABELS[raw] || raw));
    });
    ActionRegistry.register('board', 'set-board-theme:*', function (action) {
      var raw = action.substring('set-board-theme:'.length);
      var applied = d.applyVisualTheme(raw);
      d.showNotification('Visual theme: ' + ((applied && applied.name) || d.VISUAL_THEME_LABELS[raw] || raw));
    });

    // Layout preset save/delete actions
    ActionRegistry.register('board', 'save-layout-preset', async function () {
      var name = await LexeraDialogs.prompt('Preset name', '');
      if (!name) return;
      name = name.trim();
      if (!name || name === 'normal' || name === 'spacious') {
        d.showNotification('Cannot use reserved preset name');
        return;
      }
      saveLayoutPreset(name, captureCurrentLayoutSettings(d.getBoardSettingValue), Settings);
      d.setBoardSettingValue('layoutPreset', name);
      d.showNotification('Layout preset saved: ' + name);
    });
    ActionRegistry.register('board', 'delete-layout-preset:*', function (action) {
      var name = action.substring('delete-layout-preset:'.length);
      deleteLayoutPreset(name, Settings);
      var current = d.getBoardSettingValue('layoutPreset', 'normal');
      if (current === name) {
        d.setBoardSettingValue('layoutPreset', null);
        d.setBoardSettingValue('layoutSpacing', null);
      }
      d.showNotification('Layout preset deleted: ' + name);
    });

    // Feature toggles
    // pin-headers/unpin-headers actions removed — always sticky at top
    ActionRegistry.register('board', 'toggle-overlay-editor', function () { d.setOverlayEditorEnabled(!d.isOverlayEditorEnabled()); d.syncMenuCheckStates(); });
    ActionRegistry.register('board', 'toggle-special-chars', function () { d.setSpecialCharactersVisible(!d.isSpecialCharactersVisible()); d.syncMenuCheckStates(); });
    ActionRegistry.register('board', 'toggle-html-comments', function () {
      var mode = d.normalizeHtmlCommentRenderMode(d.getBoardSettingValue('htmlCommentRenderMode', 'hidden'));
      d.setBoardSettingValue('htmlCommentRenderMode', mode === 'hidden' ? 'text' : 'hidden');
    });
    ActionRegistry.register('board', 'toggle-html-content', function () {
      d.setBoardSettingValue('htmlContentRenderMode', d.getHtmlContentRenderMode() === 'html' ? 'text' : 'html');
    });
    ActionRegistry.register('board', 'toggle-tag-visibility', function () {
      var mode = d.normalizeTagVisibilityMode(d.getBoardSettingValue('tagVisibility', 'allexcludinglayout'));
      d.setBoardSettingValue('tagVisibility', mode === 'none' ? 'allexcludinglayout' : 'none');
    });
    ActionRegistry.register('board', 'toggle-sidebar-counts', function () {
      var next = d.toggleSidebarTreeDisplayOption('counts');
      d.showNotification('Sidebar counts ' + (next.counts ? 'shown' : 'hidden'));
    });
    ActionRegistry.register('board', 'toggle-sidebar-presence', function () {
      var next = d.toggleSidebarTreeDisplayOption('presence');
      d.showNotification('Sidebar presence ' + (next.presence ? 'shown' : 'hidden'));
    });
    ActionRegistry.register('board', 'toggle-sidebar-grips', function () {
      var next = d.toggleSidebarTreeDisplayOption('grips');
      d.showNotification('Sidebar drag icons ' + (next.grips ? 'shown' : 'hidden'));
    });
    ActionRegistry.register('board', 'toggle-sidebar-menus', function () {
      var next = d.toggleSidebarTreeDisplayOption('menus');
      d.showNotification('Sidebar burger menus ' + (next.menus ? 'shown' : 'hidden'));
    });
    ActionRegistry.register('board', 'toggle-inspector', function () { d.toggleInspector(); });
    // Save/export/settings
    ActionRegistry.register('board', 'save-now', function () {
      if (d.getActiveBoardId() && d.getFullBoardData() && d.isBoardDirty()) {
        var gen = d.getBoardDirtyGeneration();
        d.saveFullBoard().then(function (saved) { if (saved) d.clearBoardDirtyIfUnchanged(gen); });
      } else {
        var trackingBtn = document.getElementById('btn-save-tracking');
        if (trackingBtn) d.showSaveTrackingMenu(trackingBtn);
        else d.showNotification('No unsaved changes');
      }
      d.refreshBoardHeaderActionStates();
    });
    ActionRegistry.register('board', 'set-canvas-zoom:*', function (action) {
      var zoom = parseFloat(action.substring('set-canvas-zoom:'.length));
      if (isFinite(zoom) && zoom > 0) d.applyCanvasZoom(zoom);
    });
    ActionRegistry.register('board', 'quit-app', function () {
      d.requestApplicationQuitWithCleanup();
    });
    ActionRegistry.register('board', 'file-open-board-settings', function () { d.openSettingsDialogForBoard(d.getActiveBoardId()); });
    ActionRegistry.register('board', 'file-open-export-settings', function () { d.triggerBoardExport(); });
    ActionRegistry.register('board', 'export-board', function () { d.triggerBoardExport(); });

    // Panels
    ActionRegistry.register('board', 'running-processes', function () { d.openRunningProcessesPanel(); });
    ActionRegistry.register('board', 'show-processes', function () { d.openRunningProcessesPanel(); });
    ActionRegistry.register('board', 'open-save-tracking', function () {
      var btn = document.getElementById('btn-save-tracking');
      if (btn) d.showSaveTrackingMenu(btn);
    });
    ActionRegistry.register('board', 'open-management', function () { d.openManagementPanel(); });
    ActionRegistry.register('board', 'open-theme-zoom', function () {
      d.openFrontendSettingsPanel();
    });
    ActionRegistry.register('board', 'open-frontend-settings', function () { d.openFrontendSettingsPanel(); });

    // View management
    ActionRegistry.register('board', 'show-parked', function () { d.showParkedItems(); });
    ActionRegistry.register('board', 'show-archived', function () { d.showArchivedItems(); });
    ActionRegistry.register('board', 'show-trash', function () { d.showDeletedItems(); });
    ActionRegistry.register('board', 'rename-file', function () { d.renameActiveBoardFile(); });
    ActionRegistry.register('board', 'open-folder', function () { d.openActiveBoardFolder(); });
    ActionRegistry.register('board', 'copy-board-markdown', function () { d.copyElementAsMarkdown('board', {}); });

    // Backend/connection
    ActionRegistry.register('board', 'backend-settings', function () { d.openConnectionWindow(); });
    ActionRegistry.register('board', 'settings', function () { d.openConnectionWindow(); });
    ActionRegistry.register('board', 'collab', function () { d.openConnectionWindow(); });
    ActionRegistry.register('board', 'reveal-panel:hierarchy', function () {
      if (d.WorkspaceShell) d.WorkspaceShell.revealPanel('hierarchy');
    });
    ActionRegistry.register('board', 'reveal-panel:dashboard', function () {
      if (d.WorkspaceShell) d.WorkspaceShell.revealPanel('dashboard');
    });
    ActionRegistry.register('board', 'reveal-panel:logs', function () {
      if (d.WorkspaceShell) d.WorkspaceShell.revealPanel('logs');
    });
    ActionRegistry.register('board', 'reveal-panel:backendSettings', function () {
      if (d.WorkspaceShell) d.WorkspaceShell.revealPanel('backendSettings');
      else d.openConnectionWindow();
    });
    ActionRegistry.register('board', 'reveal-panel:frontendSettings', function () {
      if (d.WorkspaceShell) d.WorkspaceShell.revealPanel('frontendSettings');
    });
    ActionRegistry.register('board', 'reveal-panel:renderApps', function () {
      if (d.WorkspaceShell) d.WorkspaceShell.revealPanel('renderApps');
    });
    ActionRegistry.register('board', 'reveal-panel:files', function () {
      if (d.WorkspaceShell) d.WorkspaceShell.revealPanel('files');
    });
    ActionRegistry.register('board', 'reveal-panel:weekCalendar', function () {
      if (d.WorkspaceShell) d.WorkspaceShell.revealPanel('weekCalendar');
    });
    ActionRegistry.register('board', 'reveal-panel:monthCalendar', function () {
      if (d.WorkspaceShell) d.WorkspaceShell.revealPanel('monthCalendar');
    });

    // Frontend tests
    ActionRegistry.register('board', 'reveal-panel:frontendTests', function () {
      if (d.WorkspaceShell) d.WorkspaceShell.revealPanel('frontendTests');
    });

    // Search
    ActionRegistry.register('board', 'open-search', function () { d.openSearchReplacePanel(); });
    ActionRegistry.register('board', 'open-search-replace', function () { d.openSearchReplacePanel(); });
    ActionRegistry.register('board', 'paste-as-card', function () {
      var abd = d.getActiveBoardData();
      var columns = abd ? abd.columns : [];
      if (columns.length > 0) d.pasteClipboardAsCard(columns[0].index);
    });
    ActionRegistry.register('board', 'smart-paste', function () {
      d.smartPasteAsCard();
    });

    // Zoom
    ActionRegistry.register('board', 'zoom-in', function () {
      if (d.isCanvasBoardLayout()) { d.nudgeCanvasZoom(d.getCanvasZoomStep(0.1)); } else { d.nudgeUiScale(d.getUiZoomStep(0.05)); }
    });
    ActionRegistry.register('board', 'zoom-out', function () {
      if (d.isCanvasBoardLayout()) { d.nudgeCanvasZoom(d.getCanvasZoomStep(-0.1)); } else { d.nudgeUiScale(d.getUiZoomStep(-0.05)); }
    });
    ActionRegistry.register('board', 'zoom-reset', function () {
      if (d.isCanvasBoardLayout()) { d.applyCanvasZoom(1); d.resetCanvasPan(); } else { d.applyUiScale(1); d.showNotification('Zoom 100%'); }
    });

    // Navigation
    ActionRegistry.register('board', 'show-recent-boards', function () {
      var items = document.querySelectorAll('.sidebar-board-item');
      if (items.length > 0) items[0].scrollIntoView({ behavior: 'smooth' });
    });
    ActionRegistry.register('board', 'focus-next-card', function () { d.navigateCards('ArrowDown'); });
    ActionRegistry.register('board', 'focus-prev-card', function () { d.navigateCards('ArrowUp'); });
    ActionRegistry.register('board', 'focus-next-column', function () { d.navigateCards('ArrowRight'); });
    ActionRegistry.register('board', 'focus-prev-column', function () { d.navigateCards('ArrowLeft'); });

    // Stats
    ActionRegistry.register('board', 'toggle-board-stats', function () { d.toggleBoardStatsBar(); });
    ActionRegistry.register('board', 'show-keyboard-shortcuts', function () { d.showKeyboardShortcutsHelp(); });

    // =========================================================================
    // ----- Card scope -----
    // =========================================================================
    ActionRegistry.register('card', 'add-card', function (action, ctx) {
      d.insertCardAtIndex(ctx.colIndex, typeof ctx.cardIndex === 'number' ? ctx.cardIndex + 1 : undefined).then(function (ok) {
        if (!ok) return;
        var insertIdx = typeof ctx.cardIndex === 'number' ? ctx.cardIndex + 1 : undefined;
        var cardEl = insertIdx != null
          ? d.getElColumnsContainer().querySelector('.card[data-col-index="' + ctx.colIndex + '"][data-card-index="' + insertIdx + '"]')
          : null;
        if (!cardEl) {
          var allCards = d.getElColumnsContainer().querySelectorAll('.card[data-col-index="' + ctx.colIndex + '"]');
          cardEl = allCards.length > 0 ? allCards[allCards.length - 1] : null;
        }
        if (cardEl) d.openCardEditor(cardEl, ctx.colIndex, parseInt(cardEl.getAttribute('data-card-index'), 10), 'inline');
      });
    });
    ActionRegistry.register('card', 'edit', function (action, ctx) {
      var els = d.getElColumnsContainer().querySelectorAll('.card[data-col-index="' + ctx.colIndex + '"][data-card-index="' + ctx.cardIndex + '"]');
      if (els.length > 0) d.openCardEditor(els[0], ctx.colIndex, ctx.cardIndex, 'inline');
    });
    ActionRegistry.register('card', 'edit-inline', function (action, ctx) {
      var els = d.getElColumnsContainer().querySelectorAll('.card[data-col-index="' + ctx.colIndex + '"][data-card-index="' + ctx.cardIndex + '"]');
      if (els.length > 0) d.openCardEditor(els[0], ctx.colIndex, ctx.cardIndex, 'inline');
    });
    ActionRegistry.register('card', 'edit-overlay', function (action, ctx) {
      // Overlay editor is always available — the setting only controls the DEFAULT editor
      var els = d.getElColumnsContainer().querySelectorAll('.card[data-col-index="' + ctx.colIndex + '"][data-card-index="' + ctx.cardIndex + '"]');
      if (els.length > 0) d.openCardEditor(els[0], ctx.colIndex, ctx.cardIndex, 'overlay');
    });
    ActionRegistry.register('card', 'reveal', function (action, ctx) { d.revealCardContent(ctx.colIndex, ctx.cardIndex); });
    ActionRegistry.register('card', 'copy-markdown', function (action, ctx) { d.copyElementAsMarkdown('card', { colIndex: ctx.colIndex, cardIndex: ctx.cardIndex }); });
    ActionRegistry.register('card', 'copy-html', function (action, ctx) {
      var cardEl = d.findVisibleCardElement(ctx.colIndex, ctx.cardIndex);
      if (!cardEl) return;
      var contentEl = cardEl.querySelector('.card-content');
      if (!contentEl) return;
      var html = contentEl.innerHTML;
      if (navigator.clipboard && navigator.clipboard.write) {
        navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([contentEl.textContent || ''], { type: 'text/plain' })
        })]).catch(function () {
          // Fallback to text
          if (navigator.clipboard.writeText) navigator.clipboard.writeText(contentEl.textContent || '');
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(contentEl.textContent || '');
      }
    });
    ActionRegistry.register('card', 'insert-before', function (action, ctx) { d.insertCardAtIndex(ctx.colIndex, ctx.cardIndex); });
    ActionRegistry.register('card', 'insert-after', function (action, ctx) { d.insertCardAtIndex(ctx.colIndex, ctx.cardIndex + 1); });
    ActionRegistry.register('card', 'duplicate', function (action, ctx) { d.duplicateCard(ctx.colIndex, ctx.cardIndex); });
    ActionRegistry.register('card', 'move-up', function (action, ctx) { if (ctx.cardIndex > 0) d.moveCard(ctx.colIndex, ctx.cardIndex, ctx.colIndex, ctx.cardIndex - 1); });
    ActionRegistry.register('card', 'move-down', function (action, ctx) { d.moveCard(ctx.colIndex, ctx.cardIndex, ctx.colIndex, ctx.cardIndex + 2); });
    ActionRegistry.register('card', 'move-top', function (action, ctx) { if (ctx.cardIndex > 0) d.moveCard(ctx.colIndex, ctx.cardIndex, ctx.colIndex, 0); });
    ActionRegistry.register('card', 'move-bottom', function (action, ctx) {
      var col = d.getFullColumn(ctx.colIndex);
      if (col && ctx.cardIndex < col.cards.length - 1) d.moveCard(ctx.colIndex, ctx.cardIndex, ctx.colIndex, col.cards.length);
    });
    ActionRegistry.register('card', 'move-to:*', function (action, ctx) {
      var targetColIdx = parseInt(action.substring(8), 10);
      if (isFinite(targetColIdx)) d.moveCard(ctx.colIndex, ctx.cardIndex, targetColIdx, 0);
    });
    ActionRegistry.register('card', 'dup-to:*', function (action, ctx) {
      var dupTargetIdx = parseInt(action.substring(7), 10);
      if (isFinite(dupTargetIdx)) d.duplicateCardToColumn(ctx.colIndex, ctx.cardIndex, dupTargetIdx);
    });
    ActionRegistry.register('card', 'park', function (action, ctx) { d.tagCard(ctx.colIndex, ctx.cardIndex, '#hidden-internal-parked'); });
    ActionRegistry.register('card', 'park-copy', function (action, ctx) { d.parkCopyCard(ctx.colIndex, ctx.cardIndex); });
    ActionRegistry.register('card', 'archive', function (action, ctx) { d.tagCard(ctx.colIndex, ctx.cardIndex, '#hidden-internal-archived'); });
    ActionRegistry.register('card', 'delete', function (action, ctx) { d.deleteCard(ctx.colIndex, ctx.cardIndex); });
    ActionRegistry.register('card', 'marp-*', function (action, ctx) { d.handleEntityMarpMenuAction(action, 'card', { colIndex: ctx.colIndex, cardIndex: ctx.cardIndex }); });
    ActionRegistry.register('card', 'tag-*', function (action, ctx) { d.handleEntityTagMenuAction(action, 'card', { colIndex: ctx.colIndex, cardIndex: ctx.cardIndex }); });

    // =========================================================================
    // ----- Column scope -----
    // =========================================================================
    ActionRegistry.register('column', /^move-to-stack-(\d+)-(\d+)$/, function (action, ctx) {
      var m = action.match(/^move-to-stack-(\d+)-(\d+)$/);
      if (m) d.moveColumnToStack(ctx.colIndex, parseInt(m[1], 10), parseInt(m[2], 10));
    });
    ActionRegistry.register('column', 'rename', function (action, ctx) {
      var colCardsEl = d.getElColumnsContainer().querySelector('.column-cards[data-col-index="' + ctx.colIndex + '"]');
      var colRootEl = colCardsEl ? colCardsEl.closest('.column') : null;
      if (colRootEl) d.enterColumnRename(colRootEl, ctx.colIndex);
    });
    ActionRegistry.register('column', 'add-card', function (action, ctx) {
      d.insertCardAtIndex(ctx.colIndex).then(function (ok) {
        if (!ok) return;
        var allCards = d.getElColumnsContainer().querySelectorAll('.card[data-col-index="' + ctx.colIndex + '"]');
        var cardEl = allCards.length > 0 ? allCards[allCards.length - 1] : null;
        if (cardEl) d.openCardEditor(cardEl, ctx.colIndex, parseInt(cardEl.getAttribute('data-card-index'), 10), 'inline');
      });
    });
    ActionRegistry.register('column', 'add-card-top', function (action, ctx) { d.insertCardAtIndex(ctx.colIndex, 0); });
    ActionRegistry.register('column', 'paste-as-card', function (action, ctx) { d.pasteClipboardAsCard(ctx.colIndex); });
    ActionRegistry.register('column', 'smart-paste', function (action, ctx) { d.smartPasteAsCard(ctx.colIndex); });
    ActionRegistry.register('column', 'reveal-all', function (action, ctx) { d.revealColumnContent(ctx.colIndex); });
    ActionRegistry.register('column', 'add-before', function (action, ctx) {
      if (!(ctx.rowIdx !== undefined && d.addColumnRelativeToDisplayPosition(ctx.rowIdx, ctx.stackIdx, ctx.colLocalIdx, true))) {
        d.addColumn(ctx.colIndex);
      }
    });
    ActionRegistry.register('column', 'add-after', function (action, ctx) {
      if (!(ctx.rowIdx !== undefined && d.addColumnRelativeToDisplayPosition(ctx.rowIdx, ctx.stackIdx, ctx.colLocalIdx, false))) {
        d.addColumn(ctx.colIndex + 1);
      }
    });
    ActionRegistry.register('column', 'duplicate', function (action, ctx) { d.duplicateColumn(ctx.colIndex); });
    ActionRegistry.register('column', 'fold-all', function (action, ctx) { d.toggleColCards(ctx.colIndex, true); });
    ActionRegistry.register('column', 'unfold-all', function (action, ctx) { d.toggleColCards(ctx.colIndex, false); });
    ActionRegistry.register('column', 'park', function (action, ctx) { d.setColumnHiddenTag(ctx.colIndex, '#hidden-internal-parked'); });
    ActionRegistry.register('column', 'archive', function (action, ctx) { d.setColumnHiddenTag(ctx.colIndex, '#hidden-internal-archived'); });
    ActionRegistry.register('column', 'delete', function (action, ctx) { d.deleteColumn(ctx.colIndex); });
    ActionRegistry.register('column', 'toggle-width', function (action, ctx) { d.toggleColumnWidth(ctx.colIndex); });
    ActionRegistry.register('column', 'set-span-*', function (action, ctx) { d.setColumnSpan(ctx.colIndex, parseInt(action.substring(9), 10)); });
    ActionRegistry.register('column', 'toggle-stacked', function (action, ctx) { d.toggleTag('column', { colIndex: ctx.colIndex }, '#stack'); });
    ActionRegistry.register('column', 'sort-title', function (action, ctx) { d.sortColumnCards(ctx.colIndex, 'title'); });
    ActionRegistry.register('column', 'sort-tag', function (action, ctx) { d.sortColumnCards(ctx.colIndex, 'tag'); });
    ActionRegistry.register('column', 'sort-duedate', function (action, ctx) { d.sortColumnCards(ctx.colIndex, 'duedate'); });
    ActionRegistry.register('column', 'copy-markdown', function (action, ctx) { d.copyElementAsMarkdown('column', { colIndex: ctx.colIndex }); });
    ActionRegistry.register('column', 'copy-html', function (action, ctx) {
      var cardsEl = d.getElColumnsContainer().querySelector('.column-cards[data-col-index="' + ctx.colIndex + '"]');
      if (!cardsEl) return;
      var html = cardsEl.innerHTML;
      if (navigator.clipboard && navigator.clipboard.write) {
        navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([cardsEl.textContent || ''], { type: 'text/plain' })
        })]).catch(function () {
          if (navigator.clipboard.writeText) navigator.clipboard.writeText(cardsEl.textContent || '');
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cardsEl.textContent || '');
      }
    });
    ActionRegistry.register('column', 'export-column', function (action, ctx) { return d.exportColumn(ctx.colIndex); });
    ActionRegistry.register('column', 'preview-include', function (action, ctx) {
      var col = d.getFullColumn(ctx.colIndex);
      var path = col && col.includeSource && col.includeSource.rawPath ? String(col.includeSource.rawPath) : d.extractIncludePathFromTitle(col && col.title ? col.title : '');
      if (path) d.showBoardFilePreview(d.getActiveBoardId(), path);
    });
    ActionRegistry.register('column', 'open-include', function (action, ctx) {
      var col = d.getFullColumn(ctx.colIndex);
      var path = col && col.includeSource && col.includeSource.rawPath ? String(col.includeSource.rawPath) : d.extractIncludePathFromTitle(col && col.title ? col.title : '');
      if (path) d.openBoardFileInSystem(d.getActiveBoardId(), path);
    });
    ActionRegistry.register('column', 'enable-include', function (action, ctx) { d.enableColumnIncludeMode(ctx.colIndex); });
    ActionRegistry.register('column', 'edit-include', function (action, ctx) { d.editColumnIncludeFile(ctx.colIndex); });
    ActionRegistry.register('column', 'disable-include', function (action, ctx) { d.disableColumnIncludeMode(ctx.colIndex); });
    ActionRegistry.register('column', 'marp-*', function (action, ctx) { d.handleEntityMarpMenuAction(action, 'column', { colIndex: ctx.colIndex }); });
    ActionRegistry.register('column', 'tag-*', function (action, ctx) { d.handleEntityTagMenuAction(action, 'column', { colIndex: ctx.colIndex }); });

    // =========================================================================
    // ----- Row scope -----
    // =========================================================================
    ActionRegistry.register('row', 'rename', function (action, ctx) { d.renameRowOrStack('row', ctx.rowIdx); });
    ActionRegistry.register('row', 'add-stack', function (action, ctx) { d.addStackToRow(ctx.rowIdx); });
    ActionRegistry.register('row', 'reveal-all', function (action, ctx) { d.revealRowContent(ctx.rowIdx); });
    ActionRegistry.register('row', 'insert-before', function (action, ctx) { d.addRow(ctx.rowIdx); });
    ActionRegistry.register('row', 'add-row-before', function (action, ctx) { d.addRow(ctx.rowIdx); });
    ActionRegistry.register('row', 'insert-after', function (action, ctx) { d.addRow(ctx.rowIdx + 1); });
    ActionRegistry.register('row', 'add-row-after', function (action, ctx) { d.addRow(ctx.rowIdx + 1); });
    ActionRegistry.register('row', 'duplicate', function (action, ctx) { d.duplicateRow(ctx.rowIdx); });
    ActionRegistry.register('row', 'park', function (action, ctx) { d.setRowHiddenTag(ctx.rowIdx, '#hidden-internal-parked'); });
    ActionRegistry.register('row', 'archive', function (action, ctx) { d.setRowHiddenTag(ctx.rowIdx, '#hidden-internal-archived'); });
    ActionRegistry.register('row', 'delete', function (action, ctx) { d.deleteRow(ctx.rowIdx); });
    ActionRegistry.register('row', 'sort-title', function (action, ctx) { d.sortRowCards(ctx.rowIdx, 'title'); });
    ActionRegistry.register('row', 'sort-tag', function (action, ctx) { d.sortRowCards(ctx.rowIdx, 'tag'); });
    ActionRegistry.register('row', 'sort-duedate', function (action, ctx) { d.sortRowCards(ctx.rowIdx, 'duedate'); });
    ActionRegistry.register('row', 'copy-markdown', function (action, ctx) { d.copyElementAsMarkdown('row', { rowIdx: ctx.rowIdx }); });
    ActionRegistry.register('row', 'copy-html', function (action, ctx) {
      var rowEl = d.getElColumnsContainer().querySelector('.board-row[data-row-index="' + ctx.rowIdx + '"]');
      if (!rowEl) return;
      var contentEl = rowEl.querySelector('.board-row-content');
      if (!contentEl) return;
      var html = contentEl.innerHTML;
      if (navigator.clipboard && navigator.clipboard.write) {
        navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([contentEl.textContent || ''], { type: 'text/plain' })
        })]).catch(function () {
          if (navigator.clipboard.writeText) navigator.clipboard.writeText(contentEl.textContent || '');
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(contentEl.textContent || '');
      }
    });
    ActionRegistry.register('row', 'export-row', function (action, ctx) {
      // Return the promise so dispatchAction awaits triggerBoardExport's
      // init() completing. Without this, callers (tests, keyboard shortcuts
      // chained to `await dispatchAction(…)`) see the old modal state
      // because the async init is still running when control returns.
      return d.triggerBoardExport({ selection: { scope: 'row', rowIndex: ctx.rowIdx } });
    });
    ActionRegistry.register('row', 'marp-*', function (action, ctx) { d.handleEntityMarpMenuAction(action, 'row', { rowIdx: ctx.rowIdx }); });
    ActionRegistry.register('row', 'tag-*', function (action, ctx) { d.handleEntityTagMenuAction(action, 'row', { rowIdx: ctx.rowIdx }); });

    // =========================================================================
    // ----- Canvas background scope -----
    // =========================================================================
    ActionRegistry.register('canvas', 'add-stack-here', function (action, ctx) {
      d.addStackToRow(ctx.rowIdx, { canvasPosition: ctx.canvasPosition });
    });

    // =========================================================================
    // ----- Stack scope -----
    // =========================================================================
    ActionRegistry.register('stack', 'rename', function (action, ctx) { d.renameRowOrStack('stack', ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'add-column', function (action, ctx) { d.addColumnToStack(ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'reveal-all', function (action, ctx) { d.revealStackContent(ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'insert-before', function (action, ctx) { d.addStackToRow(ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'add-stack-before', function (action, ctx) { d.addStackToRow(ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'insert-after', function (action, ctx) { d.addStackToRow(ctx.rowIdx, ctx.stackIdx + 1); });
    ActionRegistry.register('stack', 'add-stack-after', function (action, ctx) { d.addStackToRow(ctx.rowIdx, ctx.stackIdx + 1); });
    ActionRegistry.register('stack', 'duplicate', function (action, ctx) { d.duplicateStack(ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'park', function (action, ctx) { d.setStackHiddenTag(ctx.rowIdx, ctx.stackIdx, '#hidden-internal-parked'); });
    ActionRegistry.register('stack', 'archive', function (action, ctx) { d.setStackHiddenTag(ctx.rowIdx, ctx.stackIdx, '#hidden-internal-archived'); });
    ActionRegistry.register('stack', 'delete', function (action, ctx) { d.deleteStack(ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'sort-title', function (action, ctx) { d.sortStackCards(ctx.rowIdx, ctx.stackIdx, 'title'); });
    ActionRegistry.register('stack', 'sort-tag', function (action, ctx) { d.sortStackCards(ctx.rowIdx, ctx.stackIdx, 'tag'); });
    ActionRegistry.register('stack', 'sort-duedate', function (action, ctx) { d.sortStackCards(ctx.rowIdx, ctx.stackIdx, 'duedate'); });
    ActionRegistry.register('stack', 'copy-markdown', function (action, ctx) { d.copyElementAsMarkdown('stack', { rowIdx: ctx.rowIdx, stackIdx: ctx.stackIdx }); });
    ActionRegistry.register('stack', 'copy-html', function (action, ctx) {
      var stackEl = d.getElColumnsContainer().querySelector('.board-stack[data-row-index="' + ctx.rowIdx + '"][data-stack-index="' + ctx.stackIdx + '"]');
      if (!stackEl) return;
      var contentEl = stackEl.querySelector('.board-stack-content');
      if (!contentEl) return;
      var html = contentEl.innerHTML;
      if (navigator.clipboard && navigator.clipboard.write) {
        navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([contentEl.textContent || ''], { type: 'text/plain' })
        })]).catch(function () {
          if (navigator.clipboard.writeText) navigator.clipboard.writeText(contentEl.textContent || '');
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(contentEl.textContent || '');
      }
    });
    ActionRegistry.register('stack', 'export-stack', function (action, ctx) {
      return d.triggerBoardExport({ selection: { scope: 'stack', rowIndex: ctx.rowIdx, stackIndex: ctx.stackIdx } });
    });
    ActionRegistry.register('stack', 'marp-*', function (action, ctx) { d.handleEntityMarpMenuAction(action, 'stack', { rowIdx: ctx.rowIdx, stackIdx: ctx.stackIdx }); });
    ActionRegistry.register('stack', 'tag-*', function (action, ctx) { d.handleEntityTagMenuAction(action, 'stack', { rowIdx: ctx.rowIdx, stackIdx: ctx.stackIdx }); });
    ActionRegistry.register('stack', 'set-stack-width:*', function (action, ctx) {
      var op = action.substring('set-stack-width:'.length);
      var stack = d.findFullDataStack(ctx.rowIdx, ctx.stackIdx);
      if (!stack) return;
      var currentTag = d.getElementSizeTag(stack.title, 'width');
      var current = currentTag > 0 ? currentTag : (parseInt(d.normalizeStackWidth(d.getBoardSettingValue('stackWidth', '350px'))) || 350);
      var next;
      if (op === 'increase') next = Math.min(1200, current + 50);
      else if (op === 'decrease') next = Math.max(200, current - 50);
      else if (op === 'reset') next = 0;
      else return;
      var newTitle = String(stack.title || '').replace(/#width\{\d+\}/gi, '').replace(/\s+/g, ' ').trim();
      if (next > 0) newTitle = newTitle ? (newTitle + ' #width{' + next + '}') : ('#width{' + next + '}');
      if (newTitle === stack.title) return;
      d.pushUndo();
      stack.title = newTitle;
      d.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
    });
  }

  window.LexeraActionRegistrations = {
    registerAll: registerAll
  };
})();
