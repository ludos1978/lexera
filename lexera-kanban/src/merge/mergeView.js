/**
 * LexeraMergeView — non-CRDT save-conflict resolution UI.
 *
 * Shown when a markdown-only (crdt-disabled) save returns
 * `hasConflicts: true` with a `mergeConflicts` array. The user either
 * resolves each conflicting card (card-identity 3-way: keep theirs / ours
 * / base) or picks the conflict-file-backup strategy (keep one whole side,
 * the other is written to `{stem}-conflict-{ts}.md` server-side). The
 * decision is POSTed to `/boards/{id}/resolve-merge` via LexeraApi.
 *
 * Overlay/singleton pattern intentionally mirrors app.js
 * `showConflictDialog` for visual + lifecycle consistency. The payload
 * builder (`buildResolution`) is pure and unit-tested in isolation.
 */
var LexeraMergeView = (function () {
  'use strict';

  var STRATEGY_THREE_WAY = 'card-identity-three-way';
  var STRATEGY_BACKUP = 'conflict-file-backup';
  var _state = null;

  function _log(deps, level, msg, data) {
    try {
      if (deps && typeof deps.log === 'function') deps.log(level, 'merge.view', msg, data);
      else if (typeof lexeraLog === 'function') lexeraLog(level, 'merge.view', msg, data);
    } catch (_) { /* logging must never throw */ }
  }

  function _notify(deps, msg) {
    try {
      if (deps && typeof deps.notify === 'function') deps.notify(msg);
    } catch (_) { /* best-effort */ }
  }

  /**
   * Pure: turn the user's selections into the MergeResolution payload the
   * backend expects (serde camelCase: boardId / strategy / choices /
   * backupKeep; ConflictChoice = { cardId, pick }; pick + backupKeep are
   * lowercase ours|theirs|base).
   *
   * @param {string} boardId
   * @param {Array<{cardId:string}>} conflicts
   * @param {{strategy:string, picks:Object<string,string>, backupKeep:string}} sel
   */
  function buildResolution(boardId, conflicts, sel) {
    sel = sel || {};
    var strategy = sel.strategy === STRATEGY_BACKUP ? STRATEGY_BACKUP : STRATEGY_THREE_WAY;
    var payload = { boardId: boardId, strategy: strategy };
    if (strategy === STRATEGY_BACKUP) {
      payload.backupKeep = sel.backupKeep === 'ours' ? 'ours'
        : sel.backupKeep === 'base' ? 'base' : 'theirs';
      payload.choices = [];
      return payload;
    }
    var picks = sel.picks || {};
    var choices = [];
    for (var i = 0; i < (conflicts || []).length; i++) {
      var c = conflicts[i];
      if (!c || !c.cardId) continue;
      var pick = picks[c.cardId];
      // Default (no explicit pick) = keep current ("theirs") — never
      // silently take incoming. Matches the backend's apply_resolution.
      pick = (pick === 'ours' || pick === 'base') ? pick : 'theirs';
      choices.push({ cardId: c.cardId, pick: pick });
    }
    payload.choices = choices;
    return payload;
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _renderBody(dialog, opts) {
    var conflicts = opts.conflicts || [];
    var rows = '';
    for (var i = 0; i < conflicts.length; i++) {
      var c = conflicts[i] || {};
      var cid = _esc(c.cardId);
      rows +=
        '<div class="merge-row" data-card-id="' + cid + '">' +
          '<div class="merge-row-head">' +
            '<span class="merge-col">' + _esc(c.columnTitle || '') + '</span>' +
            '<span class="merge-field">' + _esc(c.field || 'Content') + '</span>' +
          '</div>' +
          '<label class="merge-opt"><input type="radio" name="mc-' + cid + '" value="theirs" checked> ' +
            'Keep current: <code>' + _esc(c.theirsValue) + '</code></label>' +
          '<label class="merge-opt"><input type="radio" name="mc-' + cid + '" value="ours"> ' +
            'Use mine: <code>' + _esc(c.oursValue) + '</code></label>' +
          '<label class="merge-opt"><input type="radio" name="mc-' + cid + '" value="base"> ' +
            'Revert to base: <code>' + _esc(c.baseValue) + '</code></label>' +
        '</div>';
    }
    dialog.innerHTML =
      '<div class="dialog-title">Resolve merge conflicts</div>' +
      '<div class="dialog-message">' + conflicts.length +
        ' card conflict(s). The non-conflicting changes were already merged.</div>' +
      '<div class="merge-strategy">' +
        '<label><input type="radio" name="mc-strategy" value="' + STRATEGY_THREE_WAY + '" checked> ' +
          'Resolve per card</label>' +
        '<label><input type="radio" name="mc-strategy" value="' + STRATEGY_BACKUP + '"> ' +
          'Keep one side, back up the other</label>' +
      '</div>' +
      '<div class="merge-backup-keep" style="display:none">' +
        '<label>Keep: ' +
          '<select data-mc="backupKeep">' +
            '<option value="theirs">current (server) version</option>' +
            '<option value="ours">my version</option>' +
            '<option value="base">the common base</option>' +
          '</select></label>' +
        '<div class="merge-hint">The other side is saved as a ' +
          '<code>-conflict-</code> file — nothing is lost.</div>' +
      '</div>' +
      '<div class="merge-rows">' + rows + '</div>' +
      '<div class="dialog-actions">' +
        '<button class="btn-small btn-cancel" data-mc-action="cancel">Cancel</button>' +
        '<button class="btn-small btn-primary" data-mc-action="apply">Apply resolution</button>' +
      '</div>';
  }

  function _readSelections(dialog) {
    function picked(name) {
      var el = dialog.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : null;
    }
    var strategy = picked('mc-strategy') || STRATEGY_THREE_WAY;
    var picks = {};
    var rows = dialog.querySelectorAll('.merge-row');
    for (var i = 0; i < rows.length; i++) {
      var cid = rows[i].getAttribute('data-card-id');
      var p = picked('mc-' + cid);
      if (cid && p) picks[cid] = p;
    }
    var keepEl = dialog.querySelector('[data-mc="backupKeep"]');
    return {
      strategy: strategy,
      picks: picks,
      backupKeep: keepEl ? keepEl.value : 'theirs'
    };
  }

  function close() {
    if (_state && _state.overlay && _state.overlay.parentNode) {
      _state.overlay.parentNode.removeChild(_state.overlay);
    }
    _state = null;
  }

  /**
   * Open the merge view. opts:
   *   boardId, conflicts[], strategies[], baseBoard, incoming,
   *   api (LexeraApi-like with resolveMerge), log, notify, reload()
   */
  function open(opts) {
    opts = opts || {};
    if (typeof document === 'undefined' || !document.body) {
      _log(opts, 'error', 'No document — cannot open merge view');
      return null;
    }
    close();

    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay lexera-merge-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'dialog dialog--wide lexera-merge-view';
    _renderBody(dialog, opts);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    _state = { overlay: overlay, dialog: dialog };
    _log(opts, 'info', 'Merge view opened', {
      boardId: opts.boardId,
      conflicts: (opts.conflicts || []).length
    });

    // Toggle the backup-keep selector vs the per-card rows.
    dialog.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'mc-strategy') {
        var backup = e.target.value === STRATEGY_BACKUP;
        var keepBox = dialog.querySelector('.merge-backup-keep');
        var rowsBox = dialog.querySelector('.merge-rows');
        if (keepBox) keepBox.style.display = backup ? '' : 'none';
        if (rowsBox) rowsBox.style.display = backup ? 'none' : '';
      }
    });

    dialog.addEventListener('click', async function (e) {
      var btn = e.target.closest ? e.target.closest('[data-mc-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-mc-action');
      if (action === 'cancel') {
        _log(opts, 'info', 'Merge view cancelled', { boardId: opts.boardId });
        close();
        return;
      }
      if (action !== 'apply') return;
      var resolution = buildResolution(opts.boardId, opts.conflicts, _readSelections(dialog));
      btn.disabled = true;
      try {
        if (!opts.api || typeof opts.api.resolveMerge !== 'function') {
          throw new Error('resolveMerge API unavailable');
        }
        var res = await opts.api.resolveMerge(
          opts.boardId, opts.baseBoard, opts.incoming, resolution
        );
        _log(opts, 'info', 'Merge resolved', {
          boardId: opts.boardId,
          strategy: resolution.strategy,
          conflictBackupPath: res && res.conflictBackupPath || null
        });
        _notify(opts, res && res.conflictBackupPath
          ? 'Merge resolved — other side saved to a conflict file'
          : 'Merge resolved');
        close();
        if (typeof opts.reload === 'function') opts.reload();
      } catch (err) {
        btn.disabled = false;
        _log(opts, 'error', 'Merge resolution failed: ' +
          (err && err.message ? err.message : String(err)), err);
        _notify(opts, 'Merge resolution failed — see the Log panel');
      }
    });

    return _state;
  }

  return { open: open, close: close, buildResolution: buildResolution };
})();

if (typeof window !== 'undefined') window.LexeraMergeView = LexeraMergeView;
if (typeof module !== 'undefined' && module.exports) module.exports = LexeraMergeView;
