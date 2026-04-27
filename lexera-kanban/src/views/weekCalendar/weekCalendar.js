(function () {
  'use strict';

  var panel = document.querySelector('.calendar-panel');

  if (window.LexeraSubApp && typeof window.LexeraSubApp.init === 'function') {
    window.LexeraSubApp.init({});
  }

  var instance = null;
  try {
    if (window.LexeraCalendarRuntime && typeof window.LexeraCalendarRuntime.mount === 'function') {
      instance = window.LexeraCalendarRuntime.mount(panel, { kind: 'week' });
    }
  } catch (err) {
    if (panel) {
      panel.innerHTML = '<div class="calendar-panel-error" role="alert" style="padding:12px;color:var(--text-muted,#888);">' +
        'Failed to initialize Week Calendar: ' +
        String((err && err.message) || err).replace(/[<&>]/g, '?') +
        '</div>';
    }
  }

  // Scope filter is a UI-side concern — backend returns ALL boards;
  // future enhancement could filter to the active board only. For now
  // any change just re-asks the runtime to refresh.
  var scope = panel ? panel.querySelector('.lexera-shared-calendar-scope') : null;
  if (scope && instance && typeof instance.refresh === 'function') {
    scope.addEventListener('change', function () {
      instance.refresh();
    });
  }
})();
