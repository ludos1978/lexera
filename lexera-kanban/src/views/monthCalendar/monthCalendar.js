(function () {
  'use strict';

  var panel = document.querySelector('.calendar-panel');

  var instance = null;
  try {
    if (window.LexeraCalendarRuntime && typeof window.LexeraCalendarRuntime.mount === 'function') {
      instance = window.LexeraCalendarRuntime.mount(panel, { kind: 'month' });
    }
  } catch (err) {
    if (panel) {
      panel.innerHTML = '<div class="calendar-panel-error" role="alert" style="padding:12px;color:var(--text-muted,#888);">' +
        'Failed to initialize Month Calendar: ' +
        String((err && err.message) || err).replace(/[<&>]/g, '?') +
        '</div>';
    }
  }

  // Single LexeraSubApp.init: see weekCalendar.js for rationale.
  if (window.LexeraSubApp && typeof window.LexeraSubApp.init === 'function') {
    var refresh = instance && typeof instance.refresh === 'function'
      ? instance.refresh : function () {};
    window.LexeraSubApp.init({
      onCustom: {
        'management-board-mutation': refresh,
        'calendar-tasks-update': refresh
      }
    });
  }

  var scope = panel ? panel.querySelector('.lexera-shared-calendar-scope') : null;
  if (scope && instance && typeof instance.refresh === 'function') {
    scope.addEventListener('change', function () {
      instance.refresh();
    });
  }
})();
