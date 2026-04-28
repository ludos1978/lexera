// Dashboard sub-app — uses LexeraSubApp shared runtime.
//
// Restores the LEGACY dashboard surface (search input, scope filter,
// pin button, plus 9 categorized result lists: Results, Pinned,
// Overdue, Upcoming, Open Tasks, Tagged Items, File Embeds, Broken
// Elements, Included Files).
//
// Status: markup parity is complete (matches `sharedPanels.js#
// createDashboardPanelElement` and the legacy SHELL HTML one-to-one).
// The full search / categorization / pin-persistence logic still
// lives in the SHELL's `app.js` against the legacy DOM and has not
// yet been ported into this webview process — that's a separate slice
// because the dashboard needs the full board content (cards, tags,
// dates), which currently isn't broadcast from the SHELL. Until the
// port lands, this script:
//   - wires up the basic input/button event handlers so they don't
//     silently no-op
//   - subscribes to `catalog-snapshot` and `active-board-changed` so
//     the boot lifecycle is correct (theme, focus, teardown)
//   - shows an "empty state" message in the Results list when the
//     full data flow isn't there yet
//
// TODO: Port `app.js#renderDashboard*` family + pinned-search store
// into this file once the SHELL→dashboard board-content broadcast
// channel is in place. Until then, the visible result lists stay
// empty (the search input is wired but emits a navigate event the
// SHELL can pick up to drive search).

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

  function setEmptyStateMessage(text) {
    if (!resultsList) return;
    resultsList.innerHTML =
      '<div class="dashboard-empty" style="padding:8px 12px;color:var(--text-muted,#888);font-style:italic;">' +
      escapeHtml(text) +
      '</div>';
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

  setEmptyStateMessage('Dashboard search/categorize is wired up but not yet hooked to live board data — port pending.');

  LexeraSubApp.init({
    onCatalog: function (snap) {
      if (bodyEl) bodyEl.classList.remove('view-loading');
      // TODO: feed `snap.boards` / `snap.workspaces` into the
      // categorization pipeline (Overdue / Upcoming / Tagged …).
    },
    onActiveBoard: function (boardId) {
      // TODO: when scope = "active board", trigger a re-categorize
      // against the new active board's content.
    },
    onCustom: {
      // The SHELL is the source of truth for pinned searches and
      // categorized results today; once the data flow lands, dashboard
      // updates will arrive on these custom events and we'll render
      // into the 9 result lists.
      'dashboard-results-update': function (payload) {
        // Placeholder for the future render path.
        if (payload && resultsList && Array.isArray(payload.results)) {
          if (payload.results.length === 0) {
            setEmptyStateMessage('No results.');
          }
        }
      }
    },
    onError: function (err) {
      setEmptyStateMessage('Error: ' + (err && err.message || err));
    }
  });
})();
