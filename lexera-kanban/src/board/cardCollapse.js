/**
 * LexeraCardCollapse — Card collapse/expand state management.
 *
 * Provides: collectBoardCardIds, getCollapsedCards, saveCardCollapseState.
 *
 * IIFE module — no const/let, no ES imports.
 */
var LexeraCardCollapse = (function () {
  'use strict';

  var Settings = typeof LexeraSettings !== 'undefined' ? LexeraSettings : null;

  // --- Dependencies (injected via init) ---
  var _deps = {};

  function _callDep(name) {
    var fn = _deps[name];
    if (typeof fn === 'function') return fn.apply(null, Array.prototype.slice.call(arguments, 1));
    return undefined;
  }

  // ─── Card Collapse ───────────────────────────────────────────────────

  function collectBoardCardIds(rows) {
    var ids = [];
    if (!Array.isArray(rows)) return ids;
    for (var r = 0; r < rows.length; r++) {
      var stacks = Array.isArray(rows[r].stacks) ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        var cols = Array.isArray(stacks[s].columns) ? stacks[s].columns : [];
        for (var c = 0; c < cols.length; c++) {
          var cards = Array.isArray(cols[c].cards) ? cols[c].cards : [];
          for (var i = 0; i < cards.length; i++) {
            ids.push(String(cards[i].id));
          }
        }
      }
    }
    return ids;
  }

  function getCollapsedCards(boardId, rows) {
    var legacyExpandedKey = 'lexera-card-expanded:' + boardId;
    var saved = Settings
      ? Settings.getForBoard('cardCollapsed', boardId)
      : (function () { try { var r = localStorage.getItem('lexera-card-collapsed:' + boardId); return r ? JSON.parse(r) : null; } catch (e) { return null; } })();
    if (saved && Array.isArray(saved) && saved.length > 0) {
      return saved.map(function (id) { return String(id); });
    }

    // Legacy migration: old state stored expanded IDs. Convert to collapsed IDs.
    var legacy = localStorage.getItem(legacyExpandedKey);
    if (legacy) {
      try {
        var expanded = JSON.parse(legacy);
        if (Array.isArray(expanded)) {
          var expandedSet = {};
          for (var i = 0; i < expanded.length; i++) {
            expandedSet[String(expanded[i])] = true;
          }
          var allIds = collectBoardCardIds(rows);
          var migratedCollapsed = [];
          for (var j = 0; j < allIds.length; j++) {
            if (!expandedSet[allIds[j]]) migratedCollapsed.push(allIds[j]);
          }
          if (Settings) {
            Settings.setForBoard('cardCollapsed', boardId, migratedCollapsed);
          } else {
            localStorage.setItem('lexera-card-collapsed:' + boardId, JSON.stringify(migratedCollapsed));
          }
          localStorage.removeItem(legacyExpandedKey);
          return migratedCollapsed;
        }
      } catch (e) {
        _callDep('logFrontendIssue', 'warn', 'cards.collapse', 'Failed to migrate legacy expanded card state for board ' + boardId, e);
      }
      localStorage.removeItem(legacyExpandedKey);
    }

    // Default behavior: cards are open unless explicitly collapsed.
    return [];
  }

  function saveCardCollapseState(boardId) {
    var collapsed = [];
    var container = _callDep('getElColumnsContainer');
    if (!container) return;
    var cards = container.querySelectorAll('.card[data-card-id]');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].classList.contains('collapsed')) {
        collapsed.push(cards[i].getAttribute('data-card-id'));
      }
    }
    if (Settings) {
      Settings.setForBoard('cardCollapsed', boardId, collapsed);
    } else {
      localStorage.setItem('lexera-card-collapsed:' + boardId, JSON.stringify(collapsed));
    }
    // Remove legacy key so new default-open semantics apply consistently.
    localStorage.removeItem('lexera-card-expanded:' + boardId);
  }

  // ─── Init ────────────────────────────────────────────────────────────

  function init(deps) {
    if (!deps) return;
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
      var keys = Object.keys(deps);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(deps, keys[i]);
        if (desc && (desc.get || desc.set)) {
          Object.defineProperty(_deps, keys[i], desc);
        } else {
          _deps[keys[i]] = deps[keys[i]];
        }
      }
    }
  }

  return {
    init: init,
    collectBoardCardIds: collectBoardCardIds,
    getCollapsedCards: getCollapsedCards,
    saveCardCollapseState: saveCardCollapseState
  };
})();
(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : {}).LexeraCardCollapse = LexeraCardCollapse;
