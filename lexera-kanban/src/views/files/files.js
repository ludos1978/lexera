(function () {
  'use strict';

  if (window.LexeraSubApp && typeof window.LexeraSubApp.init === 'function') {
    window.LexeraSubApp.init({
      onTeardown: function () {
        if (window.ManagementUI && typeof window.ManagementUI.unmount === 'function') {
          window.ManagementUI.unmount('files');
        }
      }
    });
  }

  var container = document.getElementById('mgmt-container');
  if (!container) return;

  try {
    if (!window.ManagementUI || typeof window.ManagementUI.mount !== 'function') {
      throw new Error('ManagementUI not loaded');
    }
    if (!window.LexeraSettingsRuntime ||
        typeof window.LexeraSettingsRuntime.buildBackendApiAdapter !== 'function') {
      throw new Error('LexeraSettingsRuntime not loaded');
    }
    if (typeof window.ManagementUI.unmount === 'function') {
      window.ManagementUI.unmount('files');
    }
    window.ManagementUI.mount('files', {
      container: container,
      ui: window.ManagementUI.getUiPreset('files'),
      api: window.LexeraSettingsRuntime.buildBackendApiAdapter(),
      callbacks: window.LexeraSettingsRuntime.buildBackendCallbacks()
    });
  } catch (err) {
    container.classList.remove('view-loading');
    container.innerHTML =
      '<div style="padding:16px;color:var(--text-muted,#888);">' +
      '<p>Failed to initialize workspace settings:</p>' +
      '<pre style="white-space:pre-wrap;font-size:11px;">' +
      String((err && err.message) || err).replace(/</g, '&lt;') +
      '</pre>' +
      '</div>';
  }
})();
