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
  }
})();
