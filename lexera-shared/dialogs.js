/**
 * LexeraDialogs — Unified confirm/prompt dialogs shared by all Lexera apps.
 *
 * Replaces native window.confirm / window.prompt (which are forbidden in
 * this codebase) with styled overlays that integrate with the in-app
 * logger. Every shown dialog and every close result is routed through
 * lexeraLog so the unified Log panel has a record of user-visible prompts.
 *
 *   LexeraDialogs.confirm(message)            -> Promise<boolean>
 *   LexeraDialogs.prompt(message, initial, o) -> Promise<string|null>
 *
 * Styling lives in dialogs.css (also copied from lexera-shared).
 */
var LexeraDialogs = (function () {
  'use strict';

  function _log(level, message) {
    if (typeof lexeraLog === 'function') {
      try { lexeraLog(level, message); } catch (e) { /* logger failed */ }
    }
  }

  function _escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = String(s == null ? '' : s);
    return div.innerHTML;
  }

  function _mountOverlay(innerHtml) {
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay lexera-dialog-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'dialog dialog--narrow';
    dialog.innerHTML = innerHtml;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    return { overlay: overlay, dialog: dialog };
  }

  function confirm(message) {
    _log('info', '[dialog.confirm] ' + message);
    return new Promise(function (resolve) {
      var m = _mountOverlay(
        '<div class="dialog-title">Confirm</div>' +
        '<div class="dialog-note dialog-note--spacious dialog-note--preline">' + _escapeHtml(message) + '</div>' +
        '<div class="dialog-actions">' +
        '<button type="button" class="dialog-btn" data-confirm="cancel">Cancel</button>' +
        '<button type="button" class="dialog-btn dialog-btn-primary" data-confirm="ok">OK</button>' +
        '</div>'
      );

      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        m.overlay.remove();
        _log('info', '[dialog.confirm] result=' + (result ? 'ok' : 'cancel'));
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true); }
      }

      m.overlay.addEventListener('click', function (e) {
        if (e.target === m.overlay) close(false);
      });
      m.dialog.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-confirm]');
        if (!btn) return;
        close(btn.getAttribute('data-confirm') === 'ok');
      });
      document.addEventListener('keydown', onKey, true);

      var okBtn = m.dialog.querySelector('[data-confirm="ok"]');
      if (okBtn) okBtn.focus();
    });
  }

  function prompt(message, initialValue, opts) {
    opts = opts || {};
    var initial = initialValue == null ? '' : String(initialValue);
    var title = opts.title || 'Input';
    _log('info', '[dialog.prompt] ' + message + (initial ? ' (initial="' + initial + '")' : ''));

    return new Promise(function (resolve) {
      var m = _mountOverlay(
        '<div class="dialog-title">' + _escapeHtml(title) + '</div>' +
        '<div class="dialog-note dialog-note--spacious dialog-note--preline">' + _escapeHtml(message) + '</div>' +
        '<div class="dialog-field"><input type="text" class="dialog-input" data-dialog-prompt-input></div>' +
        '<div class="dialog-actions">' +
        '<button type="button" class="dialog-btn" data-confirm="cancel">Cancel</button>' +
        '<button type="button" class="dialog-btn dialog-btn-primary" data-confirm="ok">OK</button>' +
        '</div>'
      );

      var input = m.dialog.querySelector('[data-dialog-prompt-input]');
      input.value = initial;

      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        m.overlay.remove();
        _log('info', '[dialog.prompt] result=' + (result === null ? 'cancel' : '"' + result + '"'));
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(input.value); }
      }

      m.overlay.addEventListener('click', function (e) {
        if (e.target === m.overlay) close(null);
      });
      m.dialog.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-confirm]');
        if (!btn) return;
        close(btn.getAttribute('data-confirm') === 'ok' ? input.value : null);
      });
      document.addEventListener('keydown', onKey, true);

      input.focus();
      input.select();
    });
  }

  return { confirm: confirm, prompt: prompt };
})();

if (typeof window !== 'undefined') {
  window.LexeraDialogs = LexeraDialogs;
}
