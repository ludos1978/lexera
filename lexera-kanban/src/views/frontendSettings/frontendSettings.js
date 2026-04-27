(function () {
  'use strict';

  if (window.LexeraSubApp && typeof window.LexeraSubApp.init === 'function') {
    window.LexeraSubApp.init({});
  }

  var panel = document.querySelector('.lexera-shared-panel-frontend-settings');
  if (!panel) return;

  try {
    if (!window.LexeraSettingsRuntime ||
        typeof window.LexeraSettingsRuntime.buildFrontendSettingsOptions !== 'function') {
      throw new Error('LexeraSettingsRuntime not loaded');
    }
    if (!window.LexeraFrontendSettings ||
        typeof window.LexeraFrontendSettings.init !== 'function') {
      throw new Error('LexeraFrontendSettings not loaded');
    }
    var options = window.LexeraSettingsRuntime.buildFrontendSettingsOptions();
    window.LexeraFrontendSettings.init(options, panel);
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
