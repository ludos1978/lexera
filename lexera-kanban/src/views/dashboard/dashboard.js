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
  /** @type {HTMLInputElement | null} */
  var searchInput = /** @type {HTMLInputElement | null} */ (document.getElementById('dashboard-search-input'));
  var searchBtn = document.getElementById('btn-dashboard-search');
  /** @type {HTMLInputElement | null} */
  var scopeCheckbox = /** @type {HTMLInputElement | null} */ (document.getElementById('dashboard-scope-select'));
  var pinBtn = document.getElementById('btn-dashboard-pin');
  var bodyEl = rootEl ? rootEl.querySelector('.sidebar-dashboard-body') : null;
  var resultsList = document.getElementById('dashboard-results-list');
  var lastActiveBoardId = '';

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
    lastActiveBoardId = String(payload.activeBoardId || lastActiveBoardId || '').trim();
    for (var i = 0; i < DASHBOARD_LIST_IDS.length; i++) {
      var id = DASHBOARD_LIST_IDS[i];
      if (!Object.prototype.hasOwnProperty.call(payload.lists, id)) continue;
      var el = document.getElementById(id);
      if (el) el.innerHTML = String(payload.lists[id] == null ? '' : payload.lists[id]);
    }
  }

  function collectDashboardTestState() {
    /** @type {{ [k: string]: { cardIds: string[]; nodeCount: number; htmlLength: number } }} */
    var lists = {};
    for (var i = 0; i < DASHBOARD_LIST_IDS.length; i++) {
      var id = DASHBOARD_LIST_IDS[i];
      var el = document.getElementById(id);
      var cardIds = [];
      if (el && el.querySelectorAll) {
        var nodes = el.querySelectorAll('.tree-node[data-dashboard-card-id]');
        for (var n = 0; n < nodes.length; n++) {
          var cardId = String(nodes[n].getAttribute('data-dashboard-card-id') || '').trim();
          if (cardId) cardIds.push(cardId);
        }
      }
      lists[id] = {
        cardIds: cardIds,
        nodeCount: el && el.querySelectorAll ? el.querySelectorAll('.tree-node[data-dashboard-target]').length : 0,
        htmlLength: el ? String(el.innerHTML || '').length : 0
      };
    }
    return {
      mounted: !!rootEl,
      loading: !!(bodyEl && bodyEl.classList.contains('view-loading')),
      receivedFirstSnapshot: !!receivedFirstSnapshot,
      query: searchInput ? String(searchInput.value || '') : '',
      allBoards: scopeCheckbox ? !!scopeCheckbox.checked : false,
      activeBoardId: lastActiveBoardId,
      lists: lists
    };
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

  // ── Click navigation ──────────────────────────────────────────────
  // The HTML the SHELL pushes carries no event handlers. Result rows,
  // file-embed rows, broken-element rows etc. all expose
  // `data-dashboard-target` plus enough data-* attributes to identify
  // the target — collect them and broadcast a navigation request the
  // SHELL routes through `navigateToHierarchyTarget` /
  // `navigateToSearchResult`.
  function readNumericAttr(el, name) {
    var raw = el.getAttribute(name);
    if (raw == null || raw === '') return null;
    var n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }
  function buildNavTargetFromNode(node) {
    if (!node) return null;
    var boardId = (node.getAttribute('data-dashboard-board-id') || lastActiveBoardId || '').trim();
    if (!boardId) return null;
    var columnIndex = readNumericAttr(node, 'data-dashboard-column-index');
    if (columnIndex == null) columnIndex = readNumericAttr(node, 'data-dashboard-col-index');
    // User report 2026-05-14: when the backend reports a stable
    // `card_kid` (8-char hex), prefer it over the Loro container id
    // for cardId. Loro ids drift across CRDT regenerations (file-watcher
    // reload, save round-trip) so a stale dashboard cache + a fresh
    // kanban DOM see different Loro ids for the same card. The kid is
    // stable across re-parses; the kanban's `data-card-kid` lookup
    // matches it directly.
    var cardKid = (node.getAttribute('data-dashboard-card-kid') || '').trim() || null;
    var cardLoroId = (node.getAttribute('data-dashboard-card-id') || '').trim() || null;
    return {
      boardId: boardId,
      rowId: (node.getAttribute('data-dashboard-row-id') || '').trim() || null,
      stackId: (node.getAttribute('data-dashboard-stack-id') || '').trim() || null,
      columnId: (node.getAttribute('data-dashboard-column-id') || '').trim() || null,
      // Prefer kid as the primary cardId — findBoardEntityElement tries
      // both data-card-kid and data-card-id, so sending the kid here
      // hits the stable attribute first.
      cardId: cardKid || cardLoroId,
      cardKid: cardKid,
      columnIndex: columnIndex,
      rowIndex: readNumericAttr(node, 'data-dashboard-row-index'),
      stackIndex: readNumericAttr(node, 'data-dashboard-stack-index'),
      colLocalIndex: readNumericAttr(node, 'data-dashboard-col-local-index'),
      cardIndex: readNumericAttr(node, 'data-dashboard-card-index'),
      columnTitle: (node.getAttribute('data-dashboard-column-title') || '').trim() || null,
      brokenSrc: (node.getAttribute('data-dashboard-broken-src') || '').trim() || null
    };
  }
  function findDashboardNodeForCard(cardId, listId) {
    var targetCardId = String(cardId || '').trim();
    if (!targetCardId) return null;
    var roots = [];
    if (listId) {
      var listEl = document.getElementById(String(listId));
      if (listEl) roots.push(listEl);
    } else if (bodyEl) {
      roots.push(bodyEl);
    }
    for (var r = 0; r < roots.length; r++) {
      var nodes = roots[r].querySelectorAll('.tree-node[data-dashboard-card-id]');
      for (var i = 0; i < nodes.length; i++) {
        if (String(nodes[i].getAttribute('data-dashboard-card-id') || '').trim() === targetCardId) {
          return nodes[i];
        }
      }
    }
    return null;
  }

  function clickDashboardNode(node) {
    if (!node) return false;
    var ev = typeof MouseEvent === 'function'
      ? new MouseEvent('click', { bubbles: true, cancelable: true })
      : document.createEvent('MouseEvent');
    if (ev.initMouseEvent) {
      ev.initMouseEvent('click', true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);
    }
    node.dispatchEvent(ev);
    return true;
  }

  function handleDashboardTestRequest(payload) {
    payload = payload || {};
    var action = String(payload.action || 'state');
    var result = { action: action, ok: true };
    if (action === 'set-search') {
      if (searchInput) searchInput.value = String(payload.query || '');
      if (scopeCheckbox) scopeCheckbox.checked = !!payload.allBoards;
      broadcastSearch();
    } else if (action === 'apply-mirror') {
      applyDashboardMirrorUpdate({
        activeBoardId: payload.activeBoardId || lastActiveBoardId || '',
        lists: payload.lists || {}
      });
    } else if (action === 'click-card') {
      var node = findDashboardNodeForCard(payload.cardId, payload.listId);
      result.nav = node ? buildNavTargetFromNode(node) : null;
      result.target = node ? String(node.getAttribute('data-dashboard-target') || '') : '';
      result.clicked = clickDashboardNode(node);
      result.cardId = String(payload.cardId || '');
      if (!result.clicked) result.ok = false;
    }
    LexeraSubApp.broadcast('dashboard-test-response', {
      requestId: String(payload.requestId || ''),
      result: result,
      state: collectDashboardTestState()
    });
  }

  if (bodyEl) {
    bodyEl.addEventListener('click', function (e) {
      var clickTarget = /** @type {Element | null} */ (e.target);
      // Local toggle: section headers should expand/collapse in place
      // instead of routing as a navigate. The SHELL renders these with
      // a `.tree-toggle` element; we just flip the `expanded` class on
      // the matching `.tree-children` sibling.
      var toggle = clickTarget && clickTarget.closest && clickTarget.closest('.tree-toggle');
      if (toggle) {
        var section = toggle.closest('.tree-node');
        if (section) {
          var children = section.parentNode && /** @type {Element} */ (section.parentNode).querySelector
            ? /** @type {Element} */ (section.parentNode).querySelector(':scope > .tree-children')
            : null;
          if (children) {
            var nowExpanded = !children.classList.contains('expanded');
            children.classList.toggle('expanded', nowExpanded);
            toggle.classList.toggle('expanded', nowExpanded);
            section.setAttribute('aria-expanded', nowExpanded ? 'true' : 'false');
          }
          return;
        }
      }
      var node = clickTarget && clickTarget.closest && clickTarget.closest('.tree-node[data-dashboard-target]');
      if (!node) return;
      var target = (node.getAttribute('data-dashboard-target') || '').trim();
      // Group / context / tag / board headers are not navigation targets
      // on their own — they only group children. Ignore so the click
      // can fall through to the toggle path above on the next event.
      if (target === 'context' || target === 'tag' || target === 'board' || target === 'group' || target === 'broken-group') return;
      var navTarget = buildNavTargetFromNode(node);
      if (!navTarget) return;
      LexeraSubApp.broadcast('dashboard-navigate', {
        target: target || 'result',
        nav: navTarget
      });
    });
  }

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
      lastActiveBoardId = String(boardId || '').trim();
    },
    onCustom: {
      // The SHELL's renderDashboard() harvests its hidden mirror DOM
      // and broadcasts each list's innerHTML on this channel.
      'dashboard-mirror-update': applyDashboardMirrorUpdate,
      // Legacy event name kept for backwards compatibility — older
      // SHELL builds may still emit `dashboard-results-update` while
      // pinned-search rendering catches up. No-op for now.
      'dashboard-results-update': function () {},
      'dashboard-test-request': handleDashboardTestRequest
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

  window.LexeraDashboardTestApi = {
    collectState: collectDashboardTestState,
    setSearch: function (query, allBoards) {
      handleDashboardTestRequest({ action: 'set-search', query: query, allBoards: allBoards });
    },
    applyMirror: function (snapshot) {
      applyDashboardMirrorUpdate(snapshot || {});
    },
    clickCard: function (cardId, listId) {
      return clickDashboardNode(findDashboardNodeForCard(cardId, listId));
    }
  };
})();
