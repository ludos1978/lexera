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
 *   LexeraDialogs.choose(message, options, o) -> Promise<value|null>
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

  // When multiview is active, HTML overlays are hidden under native
  // child webviews. Delegate to the modal-as-window helper which
  // composites above all webviews. Falls back to the HTML overlay
  // when the multiview helper is unavailable (test, embedded mode).
  function _multiviewConfirmIfAvailable(message) {
    if (typeof window !== 'undefined' &&
        window.LexeraMultiview &&
        typeof window.LexeraMultiview.confirmModal === 'function') {
      return window.LexeraMultiview.confirmModal({
        title: 'Confirm',
        message: String(message == null ? '' : message)
      });
    }
    return null;
  }

  function confirm(message) {
    _log('info', '[dialog.confirm] ' + message);
    var multiviewPromise = _multiviewConfirmIfAvailable(message);
    if (multiviewPromise) return multiviewPromise;
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

  function _multiviewPromptIfAvailable(message, initial, title) {
    if (typeof window !== 'undefined' &&
        window.LexeraMultiview &&
        typeof window.LexeraMultiview.promptModal === 'function') {
      return window.LexeraMultiview.promptModal({
        title: title || 'Input',
        message: String(message == null ? '' : message),
        initial: initial == null ? '' : String(initial)
      });
    }
    return null;
  }

  function prompt(message, initialValue, opts) {
    opts = opts || {};
    var initial = initialValue == null ? '' : String(initialValue);
    var title = opts.title || 'Input';
    _log('info', '[dialog.prompt] ' + message + (initial ? ' (initial="' + initial + '")' : ''));
    var multiviewPromise = _multiviewPromptIfAvailable(message, initial, title);
    if (multiviewPromise) return multiviewPromise;

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

  // choose(message, options, opts) -> Promise<value|null>
  //
  // `options` is an array of `{ value, label, hint? }` records. The
  // dialog renders one button per option, returns the matching `value`
  // when clicked, or null on Escape / overlay click / Cancel.
  function choose(message, options, opts) {
    opts = opts || {};
    var title = opts.title || 'Choose';
    var list = Array.isArray(options) ? options : [];
    _log('info', '[dialog.choose] ' + message + ' (' + list.length + ' options)');

    return new Promise(function (resolve) {
      var rowsHtml = '';
      for (var i = 0; i < list.length; i++) {
        var o = list[i] || {};
        var hintHtml = o.hint
          ? '<div class="dialog-choose-hint">' + _escapeHtml(o.hint) + '</div>'
          : '';
        rowsHtml +=
          '<button type="button" class="dialog-btn dialog-choose-row" ' +
          'data-choose-index="' + i + '">' +
          '<div class="dialog-choose-label">' +
          _escapeHtml(o.label == null ? o.value : o.label) +
          '</div>' + hintHtml + '</button>';
      }
      var emptyHtml = list.length === 0
        ? '<div class="dialog-note">No options available.</div>'
        : '';
      var m = _mountOverlay(
        '<div class="dialog-title">' + _escapeHtml(title) + '</div>' +
        '<div class="dialog-note dialog-note--spacious dialog-note--preline">' + _escapeHtml(message) + '</div>' +
        '<div class="dialog-choose-list">' + rowsHtml + emptyHtml + '</div>' +
        '<div class="dialog-actions">' +
        '<button type="button" class="dialog-btn" data-choose-cancel>Cancel</button>' +
        '</div>'
      );

      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        m.overlay.remove();
        _log('info', '[dialog.choose] result=' + (result === null ? 'cancel' : JSON.stringify(result)));
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      }

      m.overlay.addEventListener('click', function (e) {
        if (e.target === m.overlay) close(null);
      });
      m.dialog.addEventListener('click', function (e) {
        var row = e.target.closest('[data-choose-index]');
        if (row) {
          var idx = Number(row.getAttribute('data-choose-index'));
          var picked = list[idx];
          close(picked ? (picked.value != null ? picked.value : null) : null);
          return;
        }
        if (e.target.closest('[data-choose-cancel]')) close(null);
      });
      document.addEventListener('keydown', onKey, true);

      var first = m.dialog.querySelector('[data-choose-index]');
      if (first) first.focus();
    });
  }

  return { confirm: confirm, prompt: prompt, choose: choose };
})();

if (typeof window !== 'undefined') {
  window.LexeraDialogs = LexeraDialogs;
}
