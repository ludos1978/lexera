// Dashboard sub-app — uses LexeraSubApp shared runtime.
//
// Restores the LEGACY dashboard surface (search input, scope filter,
// pin button, plus 9 categorized result lists: Results, Pinned,
// Overdue, Upcoming, Open Tasks, Tagged Items, File Embeds, Broken
// Elements, Included Files).
//
// Data flow (workspace-shell mode):
//   1. The SHELL keeps owning the categorization pipeline. After every
//      refresh it populates a hidden mirror DOM (created lazily by
//      `orderHelpers.js#ensureDashboardShellMirror`), then harvests
//      each list element's `innerHTML` and broadcasts a
//      `dashboard-mirror-update` event with `{ lists, loading, query,
//      scope }`.
//   2. This sub-app subscribes to that event and writes the HTML
//      directly into the matching `#dashboard-*-list` elements so the
//      visible surface mirrors the SHELL's render output without
//      having to port the entire renderer family across the IPC
//      boundary.
//   3. On boot the sub-app broadcasts `dashboard-snapshot-request`;
//      the SHELL responds by re-rendering and re-broadcasting so the
//      webview lands populated even when it opens AFTER the last
//      refresh.
// Search / pin / scope still emit `dashboard-search` / `dashboard-pin`
// to the SHELL, which drives the categorization pipeline (unchanged).

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var rootEl = document.querySelector('.lexera-shared-panel-dashboard');
  var searchInput = document.getElementById('dashboard-search-input');
  var searchBtn = document.getElementById('btn-dashboard-search');
  var scopeCheckbox = document.getElementById('dashboard-scope-select');
  var pinBtn = document.getElementById('btn-dashboard-pin');
  var bodyEl = rootEl ? rootEl.querySelector('.sidebar-dashboard-body') : null;
  var resultsList = document.getElementById('dashboard-results-list');

  // List elements receive innerHTML straight from the SHELL's hidden
  // dashboard mirror (rendered by orderHelpers.js#renderDashboard).
  var DASHBOARD_LIST_IDS = [
    'dashboard-results-list', 'dashboard-pinned-list',
    'dashboard-overdue-list', 'dashboard-upcoming-list',
    'dashboard-todos-list',  'dashboard-tagged-list',
    'dashboard-embeds-list', 'dashboard-broken-list',
    'dashboard-included-list'
  ];

  function setEmptyStateMessage(text) {
    if (!resultsList) return;
    resultsList.innerHTML =
      '<div class="dashboard-empty" style="padding:8px 12px;color:var(--text-muted,#888);font-style:italic;">' +
      escapeHtml(text) +
      '</div>';
  }

  // Tracks whether the SHELL has pushed a real snapshot yet — we keep
  // the empty-state message visible until the first update lands.
  var receivedFirstSnapshot = false;

  function applyDashboardMirrorUpdate(payload) {
    if (!payload || !payload.lists) return;
    if (bodyEl) bodyEl.classList.remove('view-loading');
    receivedFirstSnapshot = true;
    for (var i = 0; i < DASHBOARD_LIST_IDS.length; i++) {
      var id = DASHBOARD_LIST_IDS[i];
      if (!Object.prototype.hasOwnProperty.call(payload.lists, id)) continue;
      var el = document.getElementById(id);
      if (el) el.innerHTML = String(payload.lists[id] == null ? '' : payload.lists[id]);
    }
  }

  function requestDashboardSnapshot() {
    LexeraSubApp.broadcast('dashboard-snapshot-request', {});
  }

  function broadcastSearch() {
    if (!searchInput) return;
    var query = String(searchInput.value || '').trim();
    var allBoards = scopeCheckbox ? !!scopeCheckbox.checked : false;
    LexeraSubApp.broadcast('dashboard-search', {
      query: query,
      allBoards: allBoards
    });
  }

  function broadcastPin() {
    if (!searchInput) return;
    var query = String(searchInput.value || '').trim();
    if (!query) return;
    LexeraSubApp.broadcast('dashboard-pin', { query: query });
  }

  if (searchInput) {
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') broadcastSearch();
    });
  }
  if (searchBtn) searchBtn.addEventListener('click', broadcastSearch);
  if (scopeCheckbox) scopeCheckbox.addEventListener('change', broadcastSearch);
  if (pinBtn) pinBtn.addEventListener('click', broadcastPin);

  setEmptyStateMessage('Loading dashboard…');

  LexeraSubApp.init({
    onCatalog: function (snap) {
      if (bodyEl) bodyEl.classList.remove('view-loading');
      // Catalog landed but no mirror snapshot yet — ask the SHELL to
      // push one. Subsequent renders broadcast automatically.
      if (!receivedFirstSnapshot) requestDashboardSnapshot();
    },
    onActiveBoard: function (boardId) {
      // The SHELL re-renders the dashboard whenever the active board
      // changes; that re-render fires another `dashboard-mirror-update`,
      // so nothing to do here beyond letting the subscription handle it.
    },
    onCustom: {
      // The SHELL's renderDashboard() harvests its hidden mirror DOM
      // and broadcasts each list's innerHTML on this channel.
      'dashboard-mirror-update': applyDashboardMirrorUpdate,
      // Legacy event name kept for backwards compatibility — older
      // SHELL builds may still emit `dashboard-results-update` while
      // pinned-search rendering catches up. No-op for now.
      'dashboard-results-update': function () {}
    },
    onError: function (err) {
      setEmptyStateMessage('Error: ' + (err && err.message || err));
    }
  });

  // First mount: ask the SHELL for the latest snapshot. If the SHELL
  // already has one cached (the common case — dashboard data refreshes
  // on connect) we get a `dashboard-mirror-update` back almost
  // immediately and the empty-state message is replaced.
  requestDashboardSnapshot();
})();
