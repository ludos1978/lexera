(function () {
  'use strict';

  var panel = document.querySelector('.lexera-shared-panel-frontend-settings');
  if (!panel) return;
  var themeRegistryListener = null;
  var booted = false;

  function cleanup() {
    if (themeRegistryListener && typeof window.removeEventListener === 'function') {
      window.removeEventListener('lexera-visual-themes-changed', themeRegistryListener);
    }
    themeRegistryListener = null;
  }

  if (window.LexeraSubApp && typeof window.LexeraSubApp.init === 'function') {
    window.LexeraSubApp.init({
      onTeardown: cleanup
    });
  }

  function renderPanel() {
    if (!window.LexeraSettingsRuntime ||
        typeof window.LexeraSettingsRuntime.buildFrontendSettingsOptions !== 'function') {
      throw new Error('LexeraSettingsRuntime not loaded');
    }
    if (!window.LexeraFrontendSettings ||
        typeof window.LexeraFrontendSettings.init !== 'function') {
      throw new Error('LexeraFrontendSettings not loaded');
    }
    var options = window.LexeraSettingsRuntime.buildFrontendSettingsOptions();
    if (booted && typeof window.LexeraFrontendSettings.render === 'function') {
      window.LexeraFrontendSettings.render(options, panel);
      return;
    }
    window.LexeraFrontendSettings.init(options, panel);
    booted = true;
  }

  var lastError = '';

  try {
    renderPanel();
    if (typeof window.addEventListener === 'function') {
      themeRegistryListener = function () {
        try { renderPanel(); } catch (_) { /* keep prior render alive */ }
      };
      window.addEventListener('lexera-visual-themes-changed', themeRegistryListener);
    }
  } catch (err) {
    var errEl = document.createElement('div');
    errEl.className = 'frontend-settings-error';
    errEl.setAttribute('role', 'alert');
    errEl.style.padding = '16px';
    errEl.style.color = 'var(--text-muted, #888)';
    errEl.innerHTML =
      '<p>Failed to initialize frontend settings:</p>' +
      '<pre style="white-space:pre-wrap;font-size:11px;">' +
      String((err && err.message) || err).replace(/</g, '&lt;') +
      '</pre>';
    var body = panel.querySelector('.shell-settings-body') || panel;
    body.appendChild(errEl);
    lastError = String((err && err.message) || err);
  }

  // ── User-interaction test API ──────────────────────────────────
  // Same-shape contract as Lexera{Files,Inspector,Log,Hierarchy,
  // Workspaces,Dashboard}TestApi. Surfaces the mount/error state and
  // the visual-themes-changed re-render hook so tests can drive the
  // sub-app the way the SHELL does.
  window.LexeraFrontendSettingsTestApi = {
    collectState: function () {
      var errEl = panel ? panel.querySelector('.frontend-settings-error') : null;
      var pre = errEl ? errEl.querySelector('pre') : null;
      return {
        booted: booted,
        hasError: !!errEl,
        errorText: pre ? pre.textContent : '',
        lastError: lastError
      };
    },
    triggerVisualThemesChanged: function () {
      if (typeof window.dispatchEvent !== 'function') return false;
      var Ev = window.Event;
      var ev = typeof Ev === 'function'
        ? new Ev('lexera-visual-themes-changed')
        : document.createEvent('Event');
      if (ev.initEvent && typeof Ev !== 'function') ev.initEvent('lexera-visual-themes-changed', false, false);
      window.dispatchEvent(ev);
      return true;
    }
  };
})();
