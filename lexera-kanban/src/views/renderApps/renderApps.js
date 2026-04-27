(function () {
  'use strict';

  var panel = document.querySelector('.lexera-shared-panel-render-apps');

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
    }
  } catch (err) {
    var status = document.querySelector('.lexera-shared-render-apps-status');
    if (status) {
      status.textContent = 'Failed to initialize: ' + ((err && err.message) || err);
    }
  }
})();
