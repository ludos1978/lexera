/**
 * Export processes button — floating top-right indicator that tracks
 * auto-export runs and recent one-shot exports.
 *
 * Listens to window events:
 *   'lexera-export-process-changed' with detail = {
 *     kind: 'active-start'|'active-stop'|'completed',
 *     boardId, boardName, outputPath?,
 *     success?, readmePath?, message?,
 *     reportEntries? { skipped:[], embedded:[] }
 *   }
 *
 * The button only mounts when a board is loaded in the current window. The
 * recent list is in-memory only (size cap = 10) and clears on app restart,
 * matching the toast-as-ephemeral mental model — the toast is the primary
 * surface, this popover is the recall mechanism.
 */
var LexeraExportProcesses = (function () {
  var RECENT_LIMIT = 10;
  var _active = Object.create(null);   // boardId -> { boardName, outputPath, startedAt }
  var _recent = [];                    // newest first, capped at RECENT_LIMIT
  var _mounted = false;
  var _rootEl = null;
  var _btnEl = null;
  var _popoverEl = null;
  var _countEl = null;

  function invokeTauri(cmd, args) {
    var internals = (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) || null;
    if (internals && typeof internals.invoke === 'function') {
      return internals.invoke(cmd, args || {});
    }
    var core = (typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.core) || null;
    if (core && typeof core.invoke === 'function') {
      return core.invoke(cmd, args || {});
    }
    return Promise.reject(new Error('Tauri invoke unavailable for ' + cmd));
  }

  function stopAutoExport(boardId) {
    if (typeof ExportUI !== 'undefined' && ExportUI && typeof ExportUI.clearActiveAutoExport === 'function') {
      ExportUI.clearActiveAutoExport(boardId);
    }
    delete _active[boardId];
    _updateBadge();
    _renderPopover();
  }

  function openOutputFile(path) {
    if (!path) return;
    invokeTauri('open_with_default_app', { path: path }).catch(function () {});
  }

  function revealInFinder(path) {
    if (!path) return;
    invokeTauri('show_in_folder', { path: path }).catch(function () {});
  }

  function ensureMounted() {
    if (_mounted || typeof document === 'undefined') return;
    _rootEl = document.createElement('div');
    _rootEl.className = 'lexera-export-processes';
    _rootEl.setAttribute('data-lexera-export-processes', 'true');
    _btnEl = document.createElement('button');
    _btnEl.type = 'button';
    _btnEl.className = 'lexera-export-processes-btn';
    _btnEl.title = 'Active and recent exports';
    _btnEl.setAttribute('aria-label', 'Export processes');
    _btnEl.innerHTML = '<span class="lexera-export-processes-icon">\u21BB</span>'
      + '<span class="lexera-export-processes-count"></span>';
    _countEl = _btnEl.querySelector('.lexera-export-processes-count');
    _popoverEl = document.createElement('div');
    _popoverEl.className = 'lexera-export-processes-popover';
    _popoverEl.hidden = true;
    _btnEl.addEventListener('click', function (e) {
      e.stopPropagation();
      _popoverEl.hidden = !_popoverEl.hidden;
      if (!_popoverEl.hidden) _renderPopover();
    });
    document.addEventListener('click', function (e) {
      if (!_rootEl.contains(e.target)) _popoverEl.hidden = true;
    });
    _rootEl.appendChild(_btnEl);
    _rootEl.appendChild(_popoverEl);
    document.body.appendChild(_rootEl);
    _mounted = true;
    _updateBadge();
  }

  function _countActive() {
    return Object.keys(_active).length;
  }

  function _updateBadge() {
    if (!_mounted) return;
    var count = _countActive();
    var hasRecent = _recent.length > 0;
    _rootEl.classList.toggle('is-active', count > 0);
    _rootEl.classList.toggle('is-visible', count > 0 || hasRecent);
    if (_countEl) {
      if (count > 0) {
        _countEl.textContent = String(count);
        _countEl.hidden = false;
      } else if (hasRecent) {
        _countEl.textContent = String(_recent.length);
        _countEl.hidden = false;
      } else {
        _countEl.textContent = '';
        _countEl.hidden = true;
      }
    }
  }

  function _renderPopover() {
    if (!_mounted) return;
    var html = '';
    var activeKeys = Object.keys(_active);
    if (activeKeys.length) {
      html += '<div class="lexera-export-processes-section">';
      html += '<div class="lexera-export-processes-section-title">Active exports</div>';
      for (var i = 0; i < activeKeys.length; i++) {
        var a = _active[activeKeys[i]];
        html += '<div class="lexera-export-processes-item is-active" data-board-id="'
          + _escapeAttr(activeKeys[i]) + '">';
        html += '<div class="lexera-export-processes-item-main">';
        html += '<span class="lexera-export-processes-item-spinner">\u21BB</span> ';
        html += '<span class="lexera-export-processes-item-label">' + _escapeText(a.boardName || 'Board') + '</span>';
        if (a.outputPath) {
          html += '<div class="lexera-export-processes-item-path">' + _escapeText(a.outputPath) + '</div>';
        }
        html += '</div>';
        html += '<div class="lexera-export-processes-item-actions">';
        html += '<button type="button" data-action="stop" data-board-id="' + _escapeAttr(activeKeys[i]) + '">Stop</button>';
        html += '</div>';
        html += '</div>';
      }
      html += '</div>';
    }
    if (_recent.length) {
      html += '<div class="lexera-export-processes-section">';
      html += '<div class="lexera-export-processes-section-title">Recent exports</div>';
      for (var r = 0; r < _recent.length; r++) {
        var it = _recent[r];
        var variant = it.success === false ? 'is-failed' : 'is-succeeded';
        html += '<div class="lexera-export-processes-item ' + variant + '" data-recent-idx="' + r + '">';
        html += '<div class="lexera-export-processes-item-main">';
        html += '<span class="lexera-export-processes-item-label">' + _escapeText(it.boardName || 'Board') + '</span>';
        if (it.message) {
          html += ' <span class="lexera-export-processes-item-meta">' + _escapeText(it.message) + '</span>';
        }
        if (it.outputPath) {
          html += '<div class="lexera-export-processes-item-path">' + _escapeText(it.outputPath) + '</div>';
        }
        if (it.reportEntries && (
            (it.reportEntries.skipped && it.reportEntries.skipped.length) ||
            (it.reportEntries.embedded && it.reportEntries.embedded.length))) {
          html += '<details class="lexera-export-processes-item-report"><summary>Warnings</summary>';
          html += '<ul>';
          var skipped = it.reportEntries.skipped || [];
          for (var s = 0; s < skipped.length; s++) {
            html += '<li>Skipped ' + _escapeText(skipped[s].category || 'file') + ': '
              + _escapeText(skipped[s].path || '') + '</li>';
          }
          var embedded = it.reportEntries.embedded || [];
          for (var e = 0; e < embedded.length; e++) {
            html += '<li>Embedded ' + _escapeText(embedded[e].category || 'file') + ': '
              + _escapeText(embedded[e].path || '') + ' \u2192 ' + _escapeText(embedded[e].outputFormat || '') + '</li>';
          }
          html += '</ul></details>';
        }
        html += '</div>';
        html += '<div class="lexera-export-processes-item-actions">';
        if (it.outputPath) {
          html += '<button type="button" data-action="open" data-recent-idx="' + r + '">Open</button>';
          html += '<button type="button" data-action="reveal" data-recent-idx="' + r + '">Reveal</button>';
        }
        if (it.readmePath) {
          html += '<button type="button" data-action="report" data-recent-idx="' + r + '">Report</button>';
        }
        html += '</div>';
        html += '</div>';
      }
      html += '</div>';
    }
    if (!html) {
      html = '<div class="lexera-export-processes-empty">No active or recent exports.</div>';
    }
    _popoverEl.innerHTML = html;
    // Delegate button clicks to the static handler so dynamic re-renders
    // don't accumulate listeners.
    _popoverEl.onclick = function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var boardId = btn.getAttribute('data-board-id');
      var idxAttr = btn.getAttribute('data-recent-idx');
      var idx = idxAttr == null ? -1 : parseInt(idxAttr, 10);
      var recent = idx >= 0 && idx < _recent.length ? _recent[idx] : null;
      if (action === 'stop' && boardId) { stopAutoExport(boardId); return; }
      if (action === 'open' && recent) { openOutputFile(recent.outputPath); return; }
      if (action === 'reveal' && recent) { revealInFinder(recent.outputPath); return; }
      if (action === 'report' && recent) { openOutputFile(recent.readmePath); return; }
    };
  }

  function _escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _escapeAttr(value) {
    return _escapeText(value).replace(/"/g, '&quot;');
  }

  function recordActive(boardId, info) {
    if (!boardId) return;
    _active[boardId] = {
      boardName: (info && info.boardName) || boardId,
      outputPath: info && info.outputPath ? String(info.outputPath) : '',
      startedAt: Date.now(),
    };
    ensureMounted();
    _updateBadge();
    if (_mounted && !_popoverEl.hidden) _renderPopover();
  }

  function recordStopped(boardId) {
    if (!boardId) return;
    delete _active[boardId];
    _updateBadge();
    if (_mounted && !_popoverEl.hidden) _renderPopover();
  }

  function recordCompleted(info) {
    if (!info) return;
    var entry = {
      boardId: info.boardId || null,
      boardName: info.boardName || '',
      outputPath: info.outputPath || '',
      success: info.success !== false,
      message: info.message || '',
      readmePath: info.readmePath || '',
      reportEntries: info.reportEntries || null,
      completedAt: Date.now(),
    };
    _recent.unshift(entry);
    if (_recent.length > RECENT_LIMIT) _recent.length = RECENT_LIMIT;
    ensureMounted();
    _updateBadge();
    if (_mounted && !_popoverEl.hidden) _renderPopover();
  }

  function handleEvent(detail) {
    if (!detail || !detail.kind) return;
    if (detail.kind === 'active-start') recordActive(detail.boardId, detail);
    else if (detail.kind === 'active-stop') recordStopped(detail.boardId);
    else if (detail.kind === 'completed') recordCompleted(detail);
  }

  function install() {
    if (typeof window === 'undefined') return;
    window.addEventListener('lexera-export-process-changed', function (ev) {
      handleEvent(ev && ev.detail);
    });
  }

  // Auto-install when loaded. Tests can bypass by not dispatching events.
  install();

  return {
    install: install,
    recordActive: recordActive,
    recordStopped: recordStopped,
    recordCompleted: recordCompleted,
    handleEvent: handleEvent,
    // Internals exposed for tests
    _getActive: function () { return Object.assign({}, _active); },
    _getRecent: function () { return _recent.slice(); },
    _reset: function () {
      _active = Object.create(null);
      _recent = [];
      if (_mounted) {
        _updateBadge();
        _renderPopover();
      }
    },
    _isMounted: function () { return _mounted; },
  };
})();

if (typeof window !== 'undefined') window.LexeraExportProcesses = LexeraExportProcesses;
