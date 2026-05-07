// Pure log-viewer helpers used by ManagementUI. Hoisted out of the
// 2800-line `management.js` IIFE so the transform/format logic is
// independently testable, can be loaded into other tools (debug
// console, future log-viewer surfaces), and stays free of the heavy
// rendering state ManagementUI carries.
//
// Loads BEFORE `management.js` in every host page; the management
// IIFE captures the global as `LEXERA_MGMT_LOG_HELPERS` and continues
// to call `helpers.normalizeLogEntry(...)` etc. exactly as before.
// No state is captured here — every helper is a pure function of its
// inputs except `MAX_RENDERED_LOG_ENTRIES`, which is a constant cap.
//
// Synced from `lexera-shared/managementLogViewer.js` into each app's
// `src/` by `sync-runtime-assets.mjs`. Edits go in this file only;
// per-app copies are gitignored.

(function () {
  'use strict';

  /** Maximum log rows kept in the rendered DOM at once. Older entries are
   *  trimmed to keep the viewer responsive on long-running boards. */
  var MAX_RENDERED_LOG_ENTRIES = 500;

  function normalizeLogEntry(entry) {
    if (!entry) return null;
    return {
      timestampMs: Number(entry.timestampMs || entry.timestamp_ms || Date.now()),
      level: String(entry.level || 'info').toLowerCase(),
      target: String(entry.target || 'backend'),
      message: String(entry.message || ''),
    };
  }

  function logSourceForEntry() {
    return 'backend';
  }

  function formatLogTimestamp(timestampMs) {
    try {
      return new Date(timestampMs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch (_) { /* intentional: invalid timestamp → empty string fallback */
      return '';
    }
  }

  /** Filter predicate. Takes the active filter mode as an argument so the
   *  helper stays state-free. `'backend'` keeps backend-sourced entries,
   *  `'errors'` keeps warn/error level entries, anything else passes through. */
  function logMatchesFilter(filter, entry) {
    if (filter === 'backend') return logSourceForEntry(entry) === 'backend';
    if (filter === 'errors') return entry.level === 'warn' || entry.level === 'error';
    return true;
  }

  var api = {
    MAX_RENDERED_LOG_ENTRIES: MAX_RENDERED_LOG_ENTRIES,
    normalizeLogEntry: normalizeLogEntry,
    logSourceForEntry: logSourceForEntry,
    formatLogTimestamp: formatLogTimestamp,
    logMatchesFilter: logMatchesFilter,
  };

  if (typeof window !== 'undefined') {
    window.LexeraManagementLogHelpers = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
