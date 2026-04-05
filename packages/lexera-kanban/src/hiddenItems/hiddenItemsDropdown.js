/**
 * HiddenItemsDropdown — manages hidden-items dropdown panels, header source
 * dropdowns, and related utility helpers (base64 decode, image file naming).
 *
 * Dependencies are injected via init() so this module does not reach into
 * app.js globals directly.  Window globals (LexeraApi, LexeraTemplates) are
 * read at call time.
 */
var HiddenItemsDropdown = (function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════

  var activeHiddenDropdown = null;
  var activeHeaderSourceDropdown = null;

  var HEADER_SOURCE_ENTITY_TYPES = ['card', 'column', 'stack', 'row'];
  var DRAG_THRESHOLD = 5;

  // ═══════════════════════════════════════════════════════════════════════════
  // Injected dependencies (set via init)
  // ═══════════════════════════════════════════════════════════════════════════

  var _deps = {};

  // ═══════════════════════════════════════════════════════════════════════════
  // Close helpers
  // ═══════════════════════════════════════════════════════════════════════════

  function closeHeaderSourceDropdown() {
    if (activeHeaderSourceDropdown) {
      if (activeHeaderSourceDropdown.el && activeHeaderSourceDropdown.el.parentNode) activeHeaderSourceDropdown.el.remove();
      if (activeHeaderSourceDropdown.closeListener) document.removeEventListener('mousedown', activeHeaderSourceDropdown.closeListener, true);
      if (activeHeaderSourceDropdown.keyListener) document.removeEventListener('keydown', activeHeaderSourceDropdown.keyListener, true);
      activeHeaderSourceDropdown = null;
    }
  }

  function closeHiddenItemsDropdown() {
    if (activeHiddenDropdown) {
      if (activeHiddenDropdown.el && activeHiddenDropdown.el.parentNode) activeHiddenDropdown.el.remove();
      if (activeHiddenDropdown.closeListener) document.removeEventListener('mousedown', activeHiddenDropdown.closeListener, true);
      if (activeHiddenDropdown.keyListener) document.removeEventListener('keydown', activeHiddenDropdown.keyListener, true);
      activeHiddenDropdown = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // showHiddenItemsDropdown
  // ═══════════════════════════════════════════════════════════════════════════

  function showHiddenItemsDropdown(btnElement, tag, title, emptyMessage, actions, footerActions, kindFilter) {
    closeHeaderSourceDropdown();
    closeHiddenItemsDropdown();
    actions = Array.isArray(actions) ? actions : [];
    footerActions = Array.isArray(footerActions) ? footerActions : [];
    var items = _deps.collectHiddenItems(tag);
    if (kindFilter) items = items.filter(function (it) { return it.kind === kindFilter; });
    var hasItems = !!(items && items.length > 0);

    var panel = document.createElement('div');
    panel.className = 'hidden-items-dropdown';

    // Build HTML
    var html = '<div class="hidden-items-dropdown-header">' + _deps.escapeHtml(title) + ' (' + (hasItems ? items.length : 0) + ')</div>';
    html += '<div class="hidden-items-dropdown-list">';
    if (hasItems) {
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var kindLabel = _deps.getCreationEntityLabel(item.kind);
        html += '<div class="hidden-items-dropdown-item" data-idx="' + i + '">';
        html += _deps.buildCreationEntityDragIconHtml(item.kind);
        html += '<span class="hidden-item-kind">' + kindLabel + '</span>';
        html += '<span class="hidden-item-title">' + _deps.escapeHtml(item.title) + '</span>';
        html += '<span class="hidden-item-loc">' + _deps.escapeHtml(_deps.buildHiddenItemLocation(item)) + '</span>';
        for (var a = 0; a < actions.length; a++) {
          html += '<button class="board-action-btn' + (actions[a].danger ? ' danger' : '') + '" data-item-action="' +
            _deps.escapeAttr(actions[a].id) + '" data-item-index="' + i + '">' + _deps.escapeHtml(actions[a].label) + '</button>';
        }
        html += '</div>';
      }
    } else {
      html += '<div class="hidden-items-dropdown-empty">' + _deps.escapeHtml(emptyMessage) + '</div>';
    }
    html += '</div>';
    if (footerActions.length > 0) {
      html += '<div class="hidden-items-dropdown-footer">';
      for (var f = 0; f < footerActions.length; f++) {
        html += '<button class="board-action-btn' + (footerActions[f].danger ? ' danger' : '') + '" data-footer-action="' +
          _deps.escapeAttr(footerActions[f].id) + '">' + _deps.escapeHtml(footerActions[f].label) + '</button>';
      }
      html += '</div>';
    }
    panel.innerHTML = html;

    // Position below button, right-aligned
    document.body.appendChild(panel);
    var btnRect = btnElement.getBoundingClientRect();
    var panelRect = panel.getBoundingClientRect();
    var left = btnRect.right - panelRect.width;
    var top = btnRect.bottom + 4;
    if (left < 4) left = 4;
    if (top + panelRect.height > window.innerHeight - 4) top = Math.max(4, window.innerHeight - panelRect.height - 4);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';

    // Action button clicks
    panel.addEventListener('click', async function (e) {
      var itemBtn = e.target.closest('[data-item-action]');
      if (itemBtn) {
        var idx = parseInt(itemBtn.getAttribute('data-item-index'), 10);
        var actionId = itemBtn.getAttribute('data-item-action');
        var selectedItem = items[idx];
        if (!selectedItem) return;
        for (var a = 0; a < actions.length; a++) {
          if (actions[a].id === actionId && typeof actions[a].handler === 'function') {
            try {
              var shouldClose = await actions[a].handler(selectedItem, { closeDialog: closeHiddenItemsDropdown });
              if (shouldClose !== false) closeHiddenItemsDropdown();
            } catch (err) {
              _deps.logFrontendIssue('error', 'hidden.dropdown', 'Action failed', err);
              _deps.showNotification('Action failed');
            }
            return;
          }
        }
      }
      var footerBtn = e.target.closest('[data-footer-action]');
      if (footerBtn && footerActions) {
        var footerId = footerBtn.getAttribute('data-footer-action');
        for (var f = 0; f < footerActions.length; f++) {
          if (footerActions[f].id === footerId && typeof footerActions[f].handler === 'function') {
            try {
              var shouldClose = await footerActions[f].handler(items, { closeDialog: closeHiddenItemsDropdown });
              if (shouldClose !== false) closeHiddenItemsDropdown();
            } catch (err) {
              _deps.logFrontendIssue('error', 'hidden.dropdown', 'Footer action failed', err);
              _deps.showNotification('Action failed');
            }
            return;
          }
        }
      }
    });

    // Drag-out support on grip handles — type-aware drop zones
    var grips = panel.querySelectorAll('.drag-grip');
    for (var g = 0; g < grips.length; g++) {
      (function (grip) {
        grip.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var itemEl = grip.closest('.hidden-items-dropdown-item');
          if (!itemEl) return;
          var idx = parseInt(itemEl.getAttribute('data-idx'), 10);
          var dragItem = items[idx];
          if (!dragItem) return;
          var startX = e.clientX, startY = e.clientY;
          var ghost = null;
          var dragging = false;
          // Map item kind to ptrDrag type for drop zone indicators
          var ptrType = dragItem.kind === 'row' ? 'tree-row'
            : dragItem.kind === 'stack' ? 'tree-stack'
            : dragItem.kind === 'column' ? 'column'
            : null; // cards use their own system

          function onMove(ev) {
            var dx = ev.clientX - startX, dy = ev.clientY - startY;
            if (!dragging && (dx * dx + dy * dy) < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
            if (!dragging) {
              dragging = true;
              ghost = document.createElement('div');
              ghost.className = 'hidden-items-drag-ghost';
              ghost.textContent = (dragItem.kind !== 'card' ? dragItem.kind.charAt(0).toUpperCase() + dragItem.kind.slice(1) + ': ' : '') + dragItem.title;
              document.body.appendChild(ghost);
              itemEl.style.opacity = '0.3';
              // Insert type-specific drop zone indicators for non-card items
              if (ptrType) _deps.insertDropZoneIndicators(ptrType);
            }
            ghost.style.left = (ev.clientX + 10) + 'px';
            ghost.style.top = (ev.clientY - 10) + 'px';
            // Show type-appropriate drop highlights
            if (dragItem.kind === 'card') {
              _deps.clearCardDropIndicators();
              _deps.clearCardDragOverHighlights();
              _deps.clearHeaderDropTargetHighlights();
              var target = _deps.resolveCardDropTarget(ev.clientX, ev.clientY);
              if (target && target.kind !== 'header-incoming' && target.kind !== 'header-park' && target.kind !== 'header-archive' && target.kind !== 'header-trash') {
                if (target.container) {
                  target.container.classList.add('card-drag-over');
                  _deps.showCardDropIndicator(target.container, target.insertIdx);
                } else if (target.kind === 'sidebar' && target.sidebarNode) {
                  target.sidebarNode.classList.add('drop-target');
                }
              }
            } else {
              // Use ptrDrag visual feedback for row/stack/column items
              _deps.updatePtrDropTargetByType(ptrType, ev.clientX, ev.clientY);
            }
          }

          function onUp(ev) {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            if (!dragging) return;
            var capturedRestoreTarget = _deps.captureStableHiddenItemRestoreTarget(dragItem.kind, ev.clientX, ev.clientY);
            if (ghost) ghost.remove();
            itemEl.style.opacity = '';
            // Clean up all drop indicators
            _deps.clearCardDropIndicators();
            _deps.clearCardDragOverHighlights();
            _deps.clearHeaderDropTargetHighlights();
            _deps.clearSidebarDropHighlights();
            if (ptrType) {
              _deps.removeDropZoneIndicators();
              _deps.clearPtrDropIndicators();
            }

            if (dragItem.kind === 'card') {
              if (capturedRestoreTarget) {
                _deps.restoreHiddenItemToCapturedTarget(dragItem, capturedRestoreTarget).catch(function (err) {
                  _deps.logFrontendIssue('error', 'hidden.dropdown.drag', 'Card drag-out failed', err);
                });
                closeHiddenItemsDropdown();
              }
            } else {
              if (capturedRestoreTarget) {
                _deps.restoreHiddenItemToCapturedTarget(dragItem, capturedRestoreTarget).catch(function (err) {
                  _deps.logFrontendIssue('error', 'hidden.dropdown.drag', 'Non-card drag-out failed', err);
                });
                closeHiddenItemsDropdown();
                return;
              }
              // Non-card items: if dropped on the main board without a specific target, restore in place
              var boardRect = _deps.getElColumnsContainer().getBoundingClientRect();
              if (_deps.isPointInsideRect(ev.clientX, ev.clientY, boardRect)) {
                _deps.updateHiddenItemTag(dragItem, null).catch(function (err) {
                  _deps.logFrontendIssue('error', 'hidden.dropdown.drag', 'Non-card drag-out failed', err);
                });
                closeHiddenItemsDropdown();
              }
            }
          }

          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
        });
      })(grips[g]);
    }

    // Close on click-outside
    function closeListener(e) {
      if (!panel.contains(e.target) && e.target !== btnElement) {
        closeHiddenItemsDropdown();
      }
    }
    function keyListener(e) {
      if (e.key === 'Escape') { e.preventDefault(); closeHiddenItemsDropdown(); }
    }
    // Delay to avoid the opening click from closing
    setTimeout(function () {
      document.addEventListener('mousedown', closeListener, true);
      document.addEventListener('keydown', keyListener, true);
    }, 0);

    activeHiddenDropdown = { el: panel, closeListener: closeListener, keyListener: keyListener };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // showHiddenItemsDialog (modal variant)
  // ═══════════════════════════════════════════════════════════════════════════

  function showHiddenItemsDialog(title, emptyMessage, items, actions, footerActions) {
    if (!items || items.length === 0) {
      _deps.showNotification(emptyMessage);
      return;
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'modal-dialog hidden-items-dialog';
    var html = '<div class="modal-title">' + _deps.escapeHtml(title) + ' (' + items.length + ')</div>';
    html += '<div class="hidden-items-list">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      html += '<div class="parked-item hidden-item" data-idx="' + i + '">';
      html += '<span class="hidden-item-kind">' + _deps.getCreationEntityLabel(item.kind) + '</span>';
      html += '<div class="parked-item-content">' + _deps.escapeHtml(item.title) + '</div>';
      html += '<div class="parked-item-col">' + _deps.escapeHtml(_deps.buildHiddenItemLocation(item)) + '</div>';
      for (var a = 0; a < actions.length; a++) {
        var action = actions[a];
        html += '<button class="board-action-btn' + (action.danger ? ' danger' : '') + '" data-item-action="' +
          _deps.escapeAttr(action.id) + '" data-item-index="' + i + '">' + _deps.escapeHtml(action.label) + '</button>';
      }
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="hidden-items-footer">';
    if (footerActions && footerActions.length > 0) {
      for (var f = 0; f < footerActions.length; f++) {
        var footerAction = footerActions[f];
        html += '<button class="board-action-btn' + (footerAction.danger ? ' danger' : '') + '" data-footer-action="' +
          _deps.escapeAttr(footerAction.id) + '">' + _deps.escapeHtml(footerAction.label) + '</button>';
      }
    }
    html += '<button class="board-action-btn" id="close-hidden-items">Close</button>';
    html += '</div>';
    dialog.innerHTML = html;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function closeDialog() {
      if (overlay && overlay.parentNode) overlay.remove();
    }

    overlay.addEventListener('click', async function (e) {
      if (e.target === overlay || e.target.id === 'close-hidden-items') {
        closeDialog();
        return;
      }
      var itemBtn = e.target.closest('[data-item-action]');
      if (itemBtn) {
        var itemIdx = parseInt(itemBtn.getAttribute('data-item-index'), 10);
        var itemAction = itemBtn.getAttribute('data-item-action');
        var selectedItem = items[itemIdx];
        if (!selectedItem) return;
        for (var a = 0; a < actions.length; a++) {
          if (actions[a].id === itemAction && typeof actions[a].handler === 'function') {
            try {
              _deps.traceFrontendAction('info', 'hidden.items', 'Running hidden item action', {
                boardId: _deps.getActiveBoardId() || null,
                dialogTitle: title,
                action: itemAction,
                kind: selectedItem.kind,
                itemTitle: selectedItem.title || ''
              });
              var shouldClose = await actions[a].handler(selectedItem, { closeDialog: closeDialog });
              if (shouldClose !== false) closeDialog();
            } catch (err) {
              _deps.logFrontendIssue('error', 'hidden.items', 'Hidden item action failed', err);
              _deps.showNotification('Action failed');
            }
            return;
          }
        }
      }
      var footerBtn = e.target.closest('[data-footer-action]');
      if (footerBtn) {
        var footerId = footerBtn.getAttribute('data-footer-action');
        if (!footerActions) return;
        for (var f = 0; f < footerActions.length; f++) {
          if (footerActions[f].id === footerId && typeof footerActions[f].handler === 'function') {
            try {
              _deps.traceFrontendAction('info', 'hidden.items', 'Running hidden items footer action', {
                boardId: _deps.getActiveBoardId() || null,
                dialogTitle: title,
                action: footerId,
                itemCount: items.length
              });
              var shouldClose = await footerActions[f].handler(items, { closeDialog: closeDialog });
              if (shouldClose !== false) closeDialog();
            } catch (err) {
              _deps.logFrontendIssue('error', 'hidden.items', 'Hidden items footer action failed', err);
              _deps.showNotification('Action failed');
            }
            return;
          }
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Floating dropdown positioning
  // ═══════════════════════════════════════════════════════════════════════════

  function positionFloatingDropdownPanel(panel, btnElement) {
    if (!panel || !btnElement) return;
    document.body.appendChild(panel);
    var btnRect = btnElement.getBoundingClientRect();
    var panelRect = panel.getBoundingClientRect();
    var left = btnRect.right - panelRect.width;
    var top = btnRect.bottom + 4;
    if (left < 4) left = 4;
    if (left + panelRect.width > window.innerWidth - 4) left = Math.max(4, window.innerWidth - panelRect.width - 4);
    if (top + panelRect.height > window.innerHeight - 4) top = Math.max(4, window.innerHeight - panelRect.height - 4);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Header source dropdown helpers
  // ═══════════════════════════════════════════════════════════════════════════

  function getHeaderSourceDropdownTitle(mode) {
    if (mode === 'new') return 'New';
    if (mode === 'template') return 'Templates';
    if (mode === 'clipboard') return 'Clipboard';
    if (mode === 'incoming') return 'Incoming';
    return 'Empty';
  }

  function getHeaderSourceDescriptorLabel(descriptor) {
    if (!descriptor) return '';
    if (descriptor.mode === 'template') return _deps.getCreationEntityLabel(descriptor.entityType) + ': ' + descriptor.title;
    if (descriptor.mode === 'incoming') return _deps.getCreationEntityLabel(descriptor.entityType) + ': ' + descriptor.title;
    return descriptor.title;
  }

  function getHeaderSourceDropdownEmptyMessage(mode) {
    if (mode === 'template') return 'No templates available';
    if (mode === 'clipboard') {
      if (!navigator.clipboard || !navigator.clipboard.readText) return 'Clipboard read unavailable';
      return 'Clipboard is empty';
    }
    if (mode === 'incoming') {
      return _deps.getIncomingCaptureCache().available === false
        ? 'Incoming history unavailable'
        : 'No incoming items';
    }
    return 'No source items available';
  }

  function buildSourceSummaryLabel(text, fallback) {
    var normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return fallback || '(empty)';
    if (normalized.length > 80) return normalized.slice(0, 77) + '...';
    return normalized;
  }

  async function readClipboardCreationText() {
    if (!navigator.clipboard || !navigator.clipboard.readText) return '';
    try {
      return String(await navigator.clipboard.readText() || '');
    } catch (err) {
      _deps.logFrontendIssue('warn', 'header.source.clipboard', 'Failed to read clipboard content for header source list', err);
      return '';
    }
  }

  function buildClipboardSourceDescriptorsFromText(text) {
    var normalized = String(text || '');
    if (!normalized.trim()) return [];
    var summary = buildSourceSummaryLabel(normalized, 'Clipboard content');
    return HEADER_SOURCE_ENTITY_TYPES.map(function (entityType) {
      return {
        mode: 'clipboard',
        entityType: entityType,
        title: summary,
        subtitle: 'Clipboard',
        text: normalized
      };
    });
  }

  function buildTemplateSourceDescriptorsFromTemplates(entityType, templates) {
    var list = Array.isArray(templates) ? templates : [];
    return list.map(function (templateSummary) {
      return {
        mode: 'template',
        entityType: entityType,
        templateId: templateSummary.id,
        title: templateSummary.name || templateSummary.id || 'Unnamed Template',
        subtitle: templateSummary.description || templateSummary.id || 'Template'
      };
    });
  }

  async function buildHeaderSourceDescriptors(mode) {
    var LexeraTemplates = window.LexeraTemplates;

    if (mode === 'new') {
      try {
        await LexeraTemplates.loadTemplates();
      } catch (err) {
        _deps.logFrontendIssue('warn', 'header.source.new', 'Failed to load templates for combined New list', err);
      }
      // Pre-read clipboard so drop/click won't trigger browser paste prompt
      var clipboardText = await readClipboardCreationText();
      var newDescriptors = [];
      var groupOrder = ['row', 'stack', 'column', 'card'];
      for (var g = 0; g < groupOrder.length; g++) {
        var et = groupOrder[g];
        // Group header
        newDescriptors.push({ isGroupHeader: true, entityType: et, title: _deps.getCreationEntityLabel(et) });
        // Empty item
        newDescriptors.push({ mode: 'empty', entityType: et, title: 'Empty ' + _deps.getCreationEntityLabel(et), subtitle: '' });
        // Templates (with drawio/excalidraw prioritized for card type)
        var templates = _deps.prioritizeDrawioAndExcalidrawTemplates(et, LexeraTemplates.getTemplatesForType(et));
        for (var t = 0; t < templates.length; t++) {
          newDescriptors.push({
            mode: 'template',
            entityType: et,
            templateId: templates[t].id,
            title: templates[t].name || templates[t].id || 'Unnamed Template',
            subtitle: templates[t].description || ''
          });
        }
        // Clipboard (only for column and card)
        if (et === 'column' || et === 'card') {
          var clipSummary = clipboardText ? buildSourceSummaryLabel(clipboardText, '') : '';
          newDescriptors.push({
            mode: 'clipboard',
            entityType: et,
            text: clipboardText,
            title: _deps.getCreationEntityLabel(et) + ' from Clipboard',
            subtitle: clipSummary
          });
        }
      }
      return newDescriptors;
    }

    if (mode === 'empty') {
      return HEADER_SOURCE_ENTITY_TYPES.map(function (entityType) {
        return {
          mode: 'empty',
          entityType: entityType,
          title: 'Empty ' + _deps.getCreationEntityLabel(entityType),
          subtitle: 'Blank ' + _deps.getCreationEntityLabel(entityType).toLowerCase()
        };
      });
    }

    if (mode === 'clipboard') {
      // Don't read clipboard eagerly — avoid browser paste permission prompt.
      // Text is read lazily at drop/click time in runHeaderSourceDescriptorAction.
      return HEADER_SOURCE_ENTITY_TYPES.map(function (entityType) {
        return {
          mode: 'clipboard',
          entityType: entityType,
          title: _deps.getCreationEntityLabel(entityType) + ' from Clipboard',
          subtitle: 'Drag to board'
        };
      });
    }

    if (mode === 'template') {
      try {
        await LexeraTemplates.loadTemplates();
      } catch (err) {
        _deps.logFrontendIssue('warn', 'header.source.template', 'Failed to load templates for header source list', err);
      }
      var templateDescriptors = [];
      for (var i = 0; i < HEADER_SOURCE_ENTITY_TYPES.length; i++) {
        var entityType = HEADER_SOURCE_ENTITY_TYPES[i];
        templateDescriptors = templateDescriptors.concat(
          buildTemplateSourceDescriptorsFromTemplates(
            entityType,
            _deps.prioritizeDrawioAndExcalidrawTemplates(entityType, LexeraTemplates.getTemplatesForType(entityType))
          )
        );
      }
      return templateDescriptors;
    }

    if (mode === 'incoming') {
      var incomingItems = await _deps.refreshIncomingCaptureCache(false);
      var incomingDescriptors = [];
      var entries = Array.isArray(incomingItems) ? incomingItems : [];
      for (var entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        var entry = entries[entryIndex];
        var timestampLabel = _deps.formatIncomingCaptureTimestamp(entry.timestamp);
        for (var typeIndex = 0; typeIndex < HEADER_SOURCE_ENTITY_TYPES.length; typeIndex++) {
          var incomingEntityType = HEADER_SOURCE_ENTITY_TYPES[typeIndex];
          incomingDescriptors.push({
            mode: 'incoming',
            entityType: incomingEntityType,
            entry: entry,
            title: '#' + (entryIndex + 1) + ' ' + _deps.summarizeIncomingCaptureEntry(entry),
            subtitle: timestampLabel ? ('Incoming \u2022 ' + timestampLabel) : 'Incoming'
          });
        }
      }
      return incomingDescriptors;
    }

    return [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Base64 / image utilities
  // ═══════════════════════════════════════════════════════════════════════════

  function normalizeIncomingImageBase64(value) {
    var source = String(value || '').trim();
    if (!source) return '';
    var commaIndex = source.indexOf(',');
    if (source.indexOf('data:') === 0 && commaIndex >= 0) return source.slice(commaIndex + 1);
    return source;
  }

  function decodeBase64BinaryStringToUint8Array(value) {
    var normalized = normalizeIncomingImageBase64(value);
    if (!normalized) return new Uint8Array(0);
    if (typeof atob !== 'function') throw new Error('Base64 decode unavailable');
    var binary = atob(normalized);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function buildPastedEmbedImageFileName(clipboardFilename) {
    var fallbackBase = 'pasted-image-' + String(Date.now());
    return _deps.sanitizeBuiltInDiagramFileName(
      clipboardFilename || (fallbackBase + '.png'),
      '.png',
      fallbackBase
    );
  }

  function getUploadedMediaEmbedTarget(uploadResult) {
    if (!uploadResult) return '';
    if (uploadResult.path) return String(uploadResult.path);
    if (uploadResult.filename) return String(uploadResult.filename);
    return '';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Incoming capture markdown builder
  // ═══════════════════════════════════════════════════════════════════════════

  async function buildIncomingCaptureMarkdown(entry) {
    if (!entry) return '';
    var parts = [];
    var text = String(entry.text || '').trim();
    if (text) parts.push(text);
    if (entry.imageData) {
      var activeBoardId = _deps.getActiveBoardId();
      if (!activeBoardId) throw new Error('No active board selected');
      var fileName = _deps.sanitizeBuiltInDiagramFileName(
        entry.imageFilename || ('incoming-' + String(entry.id || Date.now())),
        '.png',
        'incoming-' + String(entry.id || Date.now())
      );
      var bytes = decodeBase64BinaryStringToUint8Array(entry.imageData);
      if (!bytes || bytes.length === 0) throw new Error('Incoming image payload is empty');
      var file = _deps.createBuiltInNamedFile(bytes, fileName, 'image/png');
      var LexeraApi = window.LexeraApi;
      var uploadResult = await LexeraApi.uploadMedia(activeBoardId, file);
      if (!uploadResult || !uploadResult.filename) throw new Error('Incoming image upload failed');
      parts.push('![' + fileName + '](' + uploadResult.filename + ')');
    }
    return parts.join('\n\n').trim();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Header source insertion / action
  // ═══════════════════════════════════════════════════════════════════════════

  async function insertHeaderSourceText(entityType, text, context) {
    if (_deps.insertTextContentForEntity) {
      return _deps.insertTextContentForEntity(entityType, text, context);
    }
    var normalized = String(text || '').trim();
    if (!normalized) {
      _deps.showNotification('No content available');
      return false;
    }
    if (entityType === 'card' && context && _deps.getActiveBoardId()) {
      await _deps.addCardToActiveBoard(
        context,
        normalized
      );
      return true;
    }
    if (entityType === 'row') {
      await _deps.addRowFromContent(normalized, context && context.atIndex);
      return true;
    }
    if (entityType === 'stack') {
      await _deps.addStackFromContent(context && context.rowIdx, normalized, context && context.atStackIdx);
      return true;
    }
    if (entityType === 'column') {
      if (context && context.stackIdx != null) {
        await _deps.addColumnFromContent(context.rowIdx, context.stackIdx, normalized, context.atColIdx);
        return true;
      }
      if (context && context.rowIdx != null) {
        await _deps.addStackFromContent(context.rowIdx, normalized, context.atStackIdx);
        return true;
      }
      if (context && context.atIndex != null) {
        await _deps.addRowFromContent(normalized, context.atIndex);
        return true;
      }
    }
    _deps.showNotification('No insertion target available');
    return false;
  }

  function resolveHeaderCreationDropTargetForEntity(entityType, mx, my) {
    var context = null;
    if (entityType === 'card') context = _deps.resolveHeaderCardCreationContext(mx, my);
    else if (entityType === 'column') context = _deps.resolveHeaderColumnCreationContext(mx, my);
    else if (entityType === 'stack') context = _deps.resolveHeaderStackCreationContext(mx, my);
    else if (entityType === 'row') context = _deps.resolveHeaderRowCreationContext(mx, my);
    return context ? { entityType: entityType, context: context } : null;
  }

  async function runHeaderSourceDescriptorAction(descriptor, target) {
    if (!descriptor || descriptor.disabled) return false;
    var entityType = String(descriptor.entityType || '').trim().toLowerCase();
    if (!entityType) return false;
    var resolvedTarget = target && target.context ? target : null;
    var context = resolvedTarget ? resolvedTarget.context : await _deps.resolveHeaderCreationContext(entityType);
    if (!context) {
      _deps.showNotification('No insertion target available');
      return false;
    }

    if (descriptor.mode === 'empty') {
      await _deps.handleCreationAction(entityType, 'empty', context);
      return true;
    }

    if (descriptor.mode === 'template') {
      if (!descriptor.templateId) return false;
      await _deps.handleCreationAction(entityType, 'template:' + descriptor.templateId, context);
      return true;
    }

    if (descriptor.mode === 'clipboard') {
      var clipboardText = typeof descriptor.text === 'string' ? descriptor.text : await readClipboardCreationText();
      return insertHeaderSourceText(entityType, clipboardText, context);
    }

    if (descriptor.mode === 'incoming') {
      var markdown = await buildIncomingCaptureMarkdown(descriptor.entry);
      var inserted = await insertHeaderSourceText(entityType, markdown, context);
      if (!inserted) return false;
      var LexeraApi = window.LexeraApi;
      if (
        descriptor.entry &&
        descriptor.entry.id != null &&
        LexeraApi &&
        typeof LexeraApi.removeCaptureEntry === 'function'
      ) {
        try {
          await LexeraApi.removeCaptureEntry(descriptor.entry.id);
        } catch (err) {
          _deps.logFrontendIssue('warn', 'header.source.incoming.remove', 'Failed to remove consumed incoming capture entry', err);
          _deps.showNotification('Created item, but incoming cleanup failed');
        }
      }
      await _deps.refreshIncomingCaptureCache(true);
      _deps.refreshBoardHeaderActionStates();
      return true;
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Header source dropdown grip binding
  // ═══════════════════════════════════════════════════════════════════════════

  function bindHeaderSourceDropdownGrip(grip, itemEl, descriptor, onSuccess) {
    if (!grip || !itemEl || !descriptor) return;
    grip.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      var startX = e.clientX;
      var startY = e.clientY;
      var started = false;
      var ghost = null;
      var currentTarget = null;
      var currentIndicatorType = null;

      function setIndicatorForEntity(entityType) {
        var nextIndicatorType = _deps.getHeaderCreationDragIndicatorType(entityType);
        if (nextIndicatorType === currentIndicatorType) return;
        _deps.removeStackDropZones();
        _deps.removeDropZoneIndicators();
        currentIndicatorType = nextIndicatorType;
        if (!nextIndicatorType) return;
        if (nextIndicatorType === 'column') _deps.insertStackDropZones();
        _deps.insertDropZoneIndicators(nextIndicatorType);
      }

      function cleanup() {
        itemEl.style.opacity = '';
        if (ghost) ghost.remove();
        ghost = null;
        _deps.clearHeaderCreationDragVisuals();
      }

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var dy = ev.clientY - startY;
        if (!started) {
          if ((dx * dx + dy * dy) < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
          started = true;
          itemEl.style.opacity = '0.3';
          ghost = document.createElement('div');
          ghost.className = 'hidden-items-drag-ghost';
          ghost.textContent = getHeaderSourceDescriptorLabel(descriptor);
          document.body.appendChild(ghost);
          setIndicatorForEntity(descriptor.entityType);
        }

        if (ghost) {
          ghost.style.left = (ev.clientX + 8) + 'px';
          ghost.style.top = (ev.clientY - 12) + 'px';
        }

        currentTarget = resolveHeaderCreationDropTargetForEntity(descriptor.entityType, ev.clientX, ev.clientY);
        _deps.updateHeaderCreationDragVisualsForTarget(currentTarget, ev.clientX, ev.clientY);
      }

      function onUp(ev) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        if (!started) return;
        cleanup();
        runHeaderSourceDescriptorAction(
          descriptor,
          resolveHeaderCreationDropTargetForEntity(descriptor.entityType, ev.clientX, ev.clientY) || currentTarget
        ).then(function (success) {
          if (success && typeof onSuccess === 'function') onSuccess();
        }).catch(function (err) {
          _deps.logFrontendIssue('error', 'header.source.drag', 'Failed to apply header source drag', err);
          _deps.showNotification('Creation drop failed');
        });
      }

      function onCancel() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        if (!started) return;
        cleanup();
      }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // showHeaderSourceDropdown
  // ═══════════════════════════════════════════════════════════════════════════

  function showHeaderSourceDropdown(mode, btnElement) {
    if (!btnElement) return;
    closeHiddenItemsDropdown();
    closeHeaderSourceDropdown();

    buildHeaderSourceDescriptors(mode).then(function (items) {
      var list = Array.isArray(items) ? items : [];
      var panel = document.createElement('div');
      panel.className = 'hidden-items-dropdown header-source-dropdown';

      var title = getHeaderSourceDropdownTitle(mode);
      var actionableCount = 0;
      for (var ci = 0; ci < list.length; ci++) { if (!list[ci].isGroupHeader) actionableCount++; }
      var html = '<div class="hidden-items-dropdown-header">' + _deps.escapeHtml(title) + ' (' + actionableCount + ')</div>';
      html += '<div class="hidden-items-dropdown-list">';
      if (list.length > 0) {
        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          if (item.isGroupHeader) {
            html += '<div class="header-source-group-header">' + _deps.escapeHtml(item.title || '') + '</div>';
            continue;
          }
          html += '<div class="hidden-items-dropdown-item header-source-dropdown-item' + (item.disabled ? ' disabled' : '') + '" data-source-index="' + i + '">';
          html += item.disabled
            ? _deps.buildCreationEntityDragIconHtml(item.entityType)
            : _deps.buildCreationEntityDragIconHtml(item.entityType, ['data-source-grip="' + i + '"', 'title="Drag ' + _deps.getCreationEntityLabel(item.entityType).toLowerCase() + '"']);
          html += '<span class="hidden-item-title">' + _deps.escapeHtml(item.title || '') + '</span>';
          if (item.subtitle) html += '<span class="hidden-item-loc">' + _deps.escapeHtml(item.subtitle) + '</span>';
          html += '</div>';
        }
      } else {
        html += '<div class="hidden-items-dropdown-empty">' + _deps.escapeHtml(getHeaderSourceDropdownEmptyMessage(mode)) + '</div>';
      }
      html += '</div>';
      panel.innerHTML = html;

      positionFloatingDropdownPanel(panel, btnElement);

      panel.addEventListener('click', function (e) {
        if (e.target.closest('.drag-grip')) return;
        var itemEl = e.target.closest('[data-source-index]');
        if (!itemEl) return;
        var idx = parseInt(itemEl.getAttribute('data-source-index'), 10);
        var descriptor = list[idx];
        if (!descriptor || descriptor.disabled) return;
        runHeaderSourceDescriptorAction(descriptor).then(function (success) {
          if (success) closeHeaderSourceDropdown();
        }).catch(function (err) {
          _deps.logFrontendIssue('error', 'header.source.click', 'Failed to apply header source item', err);
          _deps.showNotification('Creation failed');
        });
      });

      var grips = panel.querySelectorAll('[data-source-grip]');
      for (var g = 0; g < grips.length; g++) {
        var grip = grips[g];
        var gripIndex = parseInt(grip.getAttribute('data-source-grip'), 10);
        if (isNaN(gripIndex) || !list[gripIndex] || list[gripIndex].disabled) continue;
        bindHeaderSourceDropdownGrip(grip, grip.closest('.header-source-dropdown-item'), list[gripIndex], function () {
          closeHeaderSourceDropdown();
        });
      }

      function closeListener(e) {
        if (!panel.contains(e.target) && e.target !== btnElement) {
          closeHeaderSourceDropdown();
        }
      }
      function keyListener(e) {
        if (e.key === 'Escape') { e.preventDefault(); closeHeaderSourceDropdown(); }
      }
      setTimeout(function () {
        document.addEventListener('mousedown', closeListener, true);
        document.addEventListener('keydown', keyListener, true);
      }, 0);

      activeHeaderSourceDropdown = { el: panel, closeListener: closeListener, keyListener: keyListener };
    }).catch(function (err) {
      _deps.logFrontendIssue('error', 'header.source.build', 'Failed to build header source dropdown', err);
      _deps.showNotification('Failed to open source list');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Init + public API
  // ═══════════════════════════════════════════════════════════════════════════

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  return {
    init: init,
    // Dropdown open / close
    closeHiddenItemsDropdown: closeHiddenItemsDropdown,
    closeHeaderSourceDropdown: closeHeaderSourceDropdown,
    showHiddenItemsDropdown: showHiddenItemsDropdown,
    showHiddenItemsDialog: showHiddenItemsDialog,
    showHeaderSourceDropdown: showHeaderSourceDropdown,
    // Utilities used externally
    decodeBase64BinaryStringToUint8Array: decodeBase64BinaryStringToUint8Array,
    buildPastedEmbedImageFileName: buildPastedEmbedImageFileName,
    getUploadedMediaEmbedTarget: getUploadedMediaEmbedTarget,
    normalizeIncomingImageBase64: normalizeIncomingImageBase64,
    // Positioning helper
    positionFloatingDropdownPanel: positionFloatingDropdownPanel
  };
})();

window.HiddenItemsDropdown = HiddenItemsDropdown;
