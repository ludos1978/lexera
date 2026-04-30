(function () {
  'use strict';

  var panel = document.querySelector('.lexera-shared-panel-render-apps');
  var mountState = { initialised: false, error: '' };

  if (window.LexeraSubApp && typeof window.LexeraSubApp.init === 'function') {
    window.LexeraSubApp.init({
      onTeardown: function () {
        if (window.LexeraRenderAppsSettings &&
            typeof window.LexeraRenderAppsSettings.destroy === 'function') {
          window.LexeraRenderAppsSettings.destroy(panel);
        }
      }
    });
  }

  try {
    if (window.LexeraRenderAppsSettings && typeof window.LexeraRenderAppsSettings.init === 'function') {
      window.LexeraRenderAppsSettings.init(panel);
      mountState.initialised = true;
    }
  } catch (err) {
    var status = document.querySelector('.lexera-shared-render-apps-status');
    var msg = String((err && err.message) || err);
    if (status) {
      status.textContent = 'Failed to initialize: ' + msg;
    }
    mountState.error = msg;
  }

  // ── User-interaction test API ──────────────────────────────────
  // Same-shape contract as the other Lexera*TestApi surfaces. The
  // renderApps sub-app is a thin wrapper around LexeraRenderAppsSettings,
  // so the visible-to-user state owned by THIS file is small: did init
  // succeed, what status text sits in the panel, what error landed.
  window.LexeraRenderAppsTestApi = {
    collectState: function () {
      var status = panel ? panel.querySelector('.lexera-shared-render-apps-status') : null;
      return {
        initialised: mountState.initialised,
        error: mountState.error,
        statusText: status ? status.textContent : '',
        hasErrorBlock: !!(status && status.textContent.indexOf('Failed to initialize') === 0)
      };
    }
  };
})();
