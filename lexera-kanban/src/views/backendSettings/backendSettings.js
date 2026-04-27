(function () {
  'use strict';

  function handleManagementRefresh(payload) {
    if (!window.ManagementUI || typeof window.ManagementUI.refresh !== 'function') return;
    var section = payload && payload.section ? String(payload.section) : '';
    if (section) {
      window.ManagementUI.refresh(section);
      return;
    }
    window.ManagementUI.refresh();
  }

  if (window.LexeraSubApp && typeof window.LexeraSubApp.init === 'function') {
    window.LexeraSubApp.init({
      onCustom: {
        'management-refresh': handleManagementRefresh
      },
      onTeardown: function () {
        if (window.ManagementUI && typeof window.ManagementUI.destroy === 'function') {
          window.ManagementUI.destroy();
        }
      }
    });
  }

  var container = document.getElementById('mgmt-container');
  if (!container) return;

  try {
    if (!window.ManagementUI || typeof window.ManagementUI.init !== 'function') {
      throw new Error('ManagementUI not loaded');
    }
    if (!window.LexeraSettingsRuntime ||
        typeof window.LexeraSettingsRuntime.buildBackendApiAdapter !== 'function') {
      throw new Error('LexeraSettingsRuntime not loaded');
    }
    if (typeof window.ManagementUI.destroy === 'function') {
      window.ManagementUI.destroy();
    }
    window.ManagementUI.init({
      container: container,
      ui: window.ManagementUI.getUiPreset('backendSettings'),
      api: window.LexeraSettingsRuntime.buildBackendApiAdapter(),
      callbacks: window.LexeraSettingsRuntime.buildBackendCallbacks()
    });
  } catch (err) {
    container.classList.remove('view-loading');
    container.innerHTML =
      '<div style="padding:16px;color:var(--text-muted,#888);">' +
      '<p>Failed to initialize backend settings:</p>' +
      '<pre style="white-space:pre-wrap;font-size:11px;">' +
      String((err && err.message) || err).replace(/</g, '&lt;') +
      '</pre>' +
      '</div>';
  }
})();
