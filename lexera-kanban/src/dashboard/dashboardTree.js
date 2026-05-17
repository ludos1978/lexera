(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraDashboardTree = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function parseOptionalSearchIndex(value) {
    if (value == null || value === '') return null;
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }

  function buildSearchResultLocation(item) {
    if (item == null) return '';
    var parts = [];
    if (typeof item.rowIndex === 'number') parts.push('Row ' + (item.rowIndex + 1));
    if (typeof item.stackIndex === 'number') parts.push('Stack ' + (item.stackIndex + 1));
    parts.push(item.columnTitle || 'Column');
    return parts.join(' / ');
  }

  function dashboardCardTitle(content) {
    if (!content) return '(empty card)';
    var lines = String(content).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) break;
      // Skip image-only lines
      if (/^!\[/.test(line)) continue;
      // Strip HTML comments
      line = line.replace(/<!--[\s\S]*?-->/g, '').trim();
      // Strip hidden-internal tags (e.g. #hidden-internal-archived)
      line = line.replace(/\s*#hidden-internal-\S+/g, '').trim();
      if (!line) continue;
      // Strip heading markers for display
      var headingMatch = line.match(/^#{1,3}\s+(.+)/);
      if (headingMatch) line = headingMatch[1].trim();
      return line.length > 62 ? line.slice(0, 59) + '...' : line;
    }
    return '(empty card)';
  }

  function dashboardItemTitle(item) {
    if (item && item.summary) return String(item.summary);
    return dashboardCardTitle(item && item.cardContent);
  }

  function dashboardDueLabel(result) {
    if (!result) return '';
    if (result.isOverdue) return 'Overdue';
    if (result.displayDate) return result.displayDate;
    if (result.dueDate) return result.dueDate;
    return '';
  }

  function dashboardTreeNodeTooltip(item) {
    if (!item) return '';
    var parts = [];
    var boardTitle = String(item.boardTitle || 'Untitled').trim();
    if (boardTitle) parts.push(boardTitle);
    var location = buildSearchResultLocation(item);
    if (location) parts.push(location);
    var due = dashboardDueLabel(item);
    if (due) parts.push(due);
    return parts.join(' / ');
  }

  function sanitizeDashboardNodeId(value, fallback) {
    var source = String(value || '').trim().toLowerCase();
    if (!source) return fallback || 'node';
    return source.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || (fallback || 'node');
  }


  function dashboardInventoryStatusLabel(item) {
    var status = String(item && item.status || 'unknown').trim().toLowerCase();
    if (status === 'missing') return 'Missing';
    if (status === 'exists') return 'Exists';
    return 'Unknown';
  }

  function dashboardInventoryNodeCount(item) {
    var statusLabel = dashboardInventoryStatusLabel(item);
    var duplicateCount = item && item.count > 1 ? 'x' + item.count : '';
    return duplicateCount ? (statusLabel + ' · ' + duplicateCount) : statusLabel;
  }

  function dashboardInventoryTooltip(item) {
    if (!item) return '';
    var parts = [];
    var path = String(item.path || '').trim();
    var context = String(item.firstContextLabel || '').trim();
    if (path) parts.push(path);
    if (context) parts.push(context);
    parts.push(dashboardInventoryStatusLabel(item));
    if (item.count > 1) parts.push(String(item.count) + ' references');
    return parts.join(' / ');
  }

  function dashboardBrokenGroupLabel(type) {
    var value = String(type || 'embed').trim().toLowerCase();
    if (!value) value = 'embed';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function dashboardBrokenTooltip(item) {
    if (!item) return '';
    var parts = [];
    var source = String(item.src || '').trim();
    if (source) parts.push(source);
    parts.push(dashboardBrokenGroupLabel(item.type));
    if (item.reason) parts.push(String(item.reason));
    if (item.count > 1) parts.push(String(item.count) + ' occurrences');
    return parts.join(' / ');
  }

  /**
   * Group items into keyed buckets and build a flat list of group nodes,
   * each containing the grouped children. Extracts the pattern shared by
   * result / inventory / broken builders.
   *
   * @param {Array} items        — raw data items
   * @param {Function} getKey    — (item, index) → groupKey string
   * @param {Function} getGroup  — (groupKey, item) → { label, ... } (called once per new key)
   * @param {Function} buildChild — (item, groupKey, index) → TreeNode
   * @param {Function} buildGroup — (groupKey, groupData, index) → TreeNode (groupData has .children[])
   * @returns {Array} TreeNode[]
   */
  function buildGroupedDashboardNodes(items, getKey, getGroup, buildChild, buildGroup) {
    if (!Array.isArray(items) || items.length === 0) return [];

    var groupOrder = [];
    var groups = Object.create(null);

    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var key = getKey(item, i);
      if (!groups[key]) {
        groups[key] = getGroup(key, item);
        groups[key].children = [];
        groupOrder.push(key);
      }
      groups[key].children.push(buildChild(item, key, i));
    }

    var nodes = [];
    for (var gi = 0; gi < groupOrder.length; gi++) {
      nodes.push(buildGroup(groupOrder[gi], groups[groupOrder[gi]], gi));
    }
    return nodes;
  }

  function buildDashboardResultTreeNodes(items) {
    // Same card may appear multiple times within a section when it matches
    // multiple temporal tags or merged sub-queries. Dedupe before grouping.
    var deduped = [];
    var seen = new Set();
    if (Array.isArray(items)) {
      for (var di = 0; di < items.length; di++) {
        var it = items[di];
        if (!it) continue;
        var bid = String(it.boardId || '').trim();
        var ident = String(
          it.cardKid || it.cardId || ('content:' + (it.cardContent || it.cardTitle || ''))
        ).trim();
        if (!ident) {
          deduped.push(it);
          continue;
        }
        var key = bid + '' + ident;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(it);
      }
    }
    return buildGroupedDashboardNodes(
      deduped,
      function (item) {
        var boardId = String(item.boardId || '').trim();
        return boardId || ('board-title:' + (String(item.boardTitle || 'Untitled').trim() || 'Untitled'));
      },
      function (key, item) {
        return {
          boardId: String(item.boardId || '').trim(),
          label: String(item.boardTitle || 'Untitled').trim() || 'Untitled'
        };
      },
      function (item, groupKey) {
        var boardId = String(item.boardId || '').trim();
        return LexeraHierarchyContract.createHierarchyNode({
          id: null,
          label: dashboardItemTitle(item),
          count: dashboardDueLabel(item) || null,
          type: 'dashboard-result',
          structuralRole: 'item',
          expanded: false,
          hasToggle: false,
          grip: false,
          hierarchy: {
            surface: 'dashboard',
            kind: 'result',
            entityId: item.cardId ? String(item.cardId) : null,
            capabilities: ['activate']
          },
          attrs: {
            'data-dashboard-target': 'result',
            'data-dashboard-board-id': boardId || null,
            'data-dashboard-card-id': item.cardId ? String(item.cardId) : null,
            // Stable card identifier (8-char hex). Backend dashboard
            // result now reports this alongside the Loro container id
            // so the kanban-side lookup can prefer the stable kid over
            // the drifty Loro id. See `dashboard.rs::UpcomingItem`.
            'data-dashboard-card-kid': item.cardKid ? String(item.cardKid) : null,
            // Stable-id columns / stacks / rows — user report 2026-05-14:
            // these were missing, so dashboard nav targets carried only
            // position-based hints (columnIndex etc.), and when those
            // hints went stale relative to the kanban DOM the focus
            // chain landed "totally off" the desired card. Including
            // the ids lets boardSearch.findBoardEntityElement scope the
            // cardId lookup to the matching column subtree.
            'data-dashboard-column-id': item.columnId ? String(item.columnId) : null,
            'data-dashboard-row-id': item.rowId ? String(item.rowId) : null,
            'data-dashboard-stack-id': item.stackId ? String(item.stackId) : null,
            'data-dashboard-column-index': item.columnIndex != null ? String(item.columnIndex) : null,
            'data-dashboard-row-index': item.rowIndex != null ? String(item.rowIndex) : null,
            'data-dashboard-stack-index': item.stackIndex != null ? String(item.stackIndex) : null,
            'data-dashboard-col-local-index': item.colLocalIndex != null ? String(item.colLocalIndex) : null,
            'data-dashboard-card-index': item.cardIndex != null ? String(item.cardIndex) : null,
            'data-dashboard-column-title': item.columnTitle ? String(item.columnTitle) : null,
            title: dashboardTreeNodeTooltip(item) || null
          }
        });
      },
      function (key, group, gi) {
        return LexeraHierarchyContract.createHierarchyNode({
          id: 'dashboard-group-' + (group.boardId || gi),
          label: group.label,
          count: group.children.length,
          type: 'dashboard-group',
          structuralRole: 'group',
          expanded: true,
          hasToggle: true,
          grip: false,
          hierarchy: {
            surface: 'dashboard',
            kind: 'board-group',
            entityId: group.boardId || null,
            capabilities: []
          },
          attrs: {
            'data-dashboard-target': 'board',
            'data-dashboard-board-id': group.boardId || null
          },
          children: group.children
        });
      }
    );
  }

  function buildDashboardInventoryTreeNodes(items) {
    return buildGroupedDashboardNodes(
      items,
      function (item, i) {
        var contextLabel = String(item.firstContextLabel || 'Other').trim() || 'Other';
        return sanitizeDashboardNodeId(contextLabel, 'context-' + i);
      },
      function (key, item) {
        return { label: String(item.firstContextLabel || 'Other').trim() || 'Other' };
      },
      function (item) {
        return LexeraHierarchyContract.createHierarchyNode({
          id: null,
          label: String(item.path || '').trim() || '(missing path)',
          count: dashboardInventoryNodeCount(item),
          type: 'dashboard-file',
          structuralRole: 'item',
          expanded: false,
          hasToggle: false,
          grip: false,
          hierarchy: {
            surface: 'dashboard',
            kind: 'file-result',
            entityId: item.firstCardId || null,
            capabilities: ['activate']
          },
          attrs: {
            'data-dashboard-target': 'file',
            'data-dashboard-board-id': item.boardId || item.firstBoardId || null,
            'data-dashboard-card-id': item.firstCardId || null,
            'data-dashboard-column-index': item.firstColumnIndex != null ? String(item.firstColumnIndex) : null,
            'data-dashboard-row-index': item.firstRowIndex != null ? String(item.firstRowIndex) : null,
            'data-dashboard-stack-index': item.firstStackIndex != null ? String(item.firstStackIndex) : null,
            'data-dashboard-col-local-index': item.firstColLocalIndex != null ? String(item.firstColLocalIndex) : null,
            'data-dashboard-status': String(item.status || 'unknown').trim().toLowerCase() || 'unknown',
            title: dashboardInventoryTooltip(item) || null
          }
        });
      },
      function (key, group) {
        return LexeraHierarchyContract.createHierarchyNode({
          id: 'dashboard-context-' + key,
          label: group.label,
          count: group.children.length,
          type: 'dashboard-group',
          structuralRole: 'group',
          expanded: true,
          hasToggle: true,
          grip: false,
          hierarchy: {
            surface: 'dashboard',
            kind: 'context-group',
            entityId: group.label,
            capabilities: []
          },
          attrs: { 'data-dashboard-target': 'context' },
          children: group.children
        });
      }
    );
  }

  function buildDashboardBrokenTreeNodes(items) {
    return buildGroupedDashboardNodes(
      items,
      function (item) {
        return String(item.type || 'embed').trim().toLowerCase() || 'embed';
      },
      function (key) {
        return { label: dashboardBrokenGroupLabel(key) };
      },
      function (item, groupKey) {
        return LexeraHierarchyContract.createHierarchyNode({
          id: null,
          label: String(item.src || '').trim() || '(unknown source)',
          count: item.count > 1 ? ('x' + item.count) : null,
          type: 'dashboard-broken',
          structuralRole: 'item',
          expanded: false,
          hasToggle: false,
          grip: false,
          hierarchy: {
            surface: 'dashboard',
            kind: 'broken-result',
            entityId: item.cardId || String(item.src || '').trim() || null,
            capabilities: ['activate']
          },
          attrs: {
            'data-dashboard-target': 'broken',
            'data-dashboard-board-id': item.boardId || null,
            'data-dashboard-col-index': item.colIndex != null ? String(item.colIndex) : null,
            'data-dashboard-column-index': item.colIndex != null ? String(item.colIndex) : null,
            'data-dashboard-card-index': item.cardIndex != null ? String(item.cardIndex) : null,
            'data-dashboard-card-id': item.cardId || null,
            'data-dashboard-row-index': item.rowIndex != null ? String(item.rowIndex) : null,
            'data-dashboard-stack-index': item.stackIndex != null ? String(item.stackIndex) : null,
            'data-dashboard-col-local-index': item.colLocalIndex != null ? String(item.colLocalIndex) : null,
            'data-dashboard-broken-src': String(item.src || '') || null,
            'data-dashboard-broken-type': groupKey,
            title: dashboardBrokenTooltip(item) || null
          }
        });
      },
      function (key, group, gi) {
        return LexeraHierarchyContract.createHierarchyNode({
          id: 'dashboard-broken-' + sanitizeDashboardNodeId(key, 'broken-' + gi),
          label: group.label,
          count: group.children.length,
          type: 'dashboard-group',
          structuralRole: 'group',
          expanded: true,
          hasToggle: true,
          grip: false,
          hierarchy: {
            surface: 'dashboard',
            kind: 'broken-group',
            entityId: key,
            capabilities: []
          },
          attrs: {
            'data-dashboard-target': 'broken-group',
            'data-dashboard-broken-type': key
          },
          children: group.children
        });
      }
    );
  }

  function buildDashboardTaggedTreeNodes(groups) {
    if (!Array.isArray(groups) || groups.length === 0) return [];
    var nodes = [];
    for (var i = 0; i < groups.length; i++) {
      var group = groups[i] || {};
      var tag = String(group.tag || '').trim();
      var children = buildDashboardResultTreeNodes(group.items || []);
      if (!tag) continue;
      nodes.push(LexeraHierarchyContract.createHierarchyNode({
        id: 'dashboard-tag-' + sanitizeDashboardNodeId(tag, 'tag-' + i),
        label: tag,
        count: Array.isArray(group.items) ? group.items.length : 0,
        type: 'dashboard-group',
        structuralRole: 'group',
        expanded: true,
        hasToggle: true,
        grip: false,
        hierarchy: {
          surface: 'dashboard',
          kind: 'tag-group',
          entityId: tag,
          capabilities: []
        },
        attrs: {
          'data-dashboard-target': 'tag',
          'data-dashboard-tag': tag
        },
        children: children
      }));
    }
    return nodes;
  }

  function buildDashboardNavResult(result) {
    return {
      boardId: result.boardId,
      cardKid: result.cardKid || null,
      cardId: result.cardId,
      cardContent: result.cardContent,
      columnIndex: parseOptionalSearchIndex(result.columnIndex),
      rowIndex: parseOptionalSearchIndex(result.rowIndex),
      stackIndex: parseOptionalSearchIndex(result.stackIndex),
      colLocalIndex: parseOptionalSearchIndex(result.colLocalIndex),
      cardIndex: parseOptionalSearchIndex(result.cardIndex),
      columnTitle: result.columnTitle
    };
  }

  function buildDashboardNavResultFromTreeNode(node) {
    if (!node || !node.getAttribute) return null;
    var boardId = String(node.getAttribute('data-dashboard-board-id') || '').trim();
    if (!boardId) return null;
    return {
      boardId: boardId,
      // Stable persistent identity — written by buildDashboard*TreeNodes as
      // data-dashboard-card-kid (backend dashboard.rs card_kid). Carried so
      // focusSearchResultCard can prefer the kid over the drifty cardId.
      cardKid: String(node.getAttribute('data-dashboard-card-kid') || '').trim() || null,
      cardId: String(node.getAttribute('data-dashboard-card-id') || '').trim() || null,
      columnIndex: parseOptionalSearchIndex(node.getAttribute('data-dashboard-column-index')),
      rowIndex: parseOptionalSearchIndex(node.getAttribute('data-dashboard-row-index')),
      stackIndex: parseOptionalSearchIndex(node.getAttribute('data-dashboard-stack-index')),
      colLocalIndex: parseOptionalSearchIndex(node.getAttribute('data-dashboard-col-local-index')),
      cardIndex: parseOptionalSearchIndex(node.getAttribute('data-dashboard-card-index')),
      columnTitle: String(node.getAttribute('data-dashboard-column-title') || '').trim() || null
    };
  }

  return {
    parseOptionalSearchIndex: parseOptionalSearchIndex,
    buildSearchResultLocation: buildSearchResultLocation,
    dashboardCardTitle: dashboardCardTitle,
    dashboardItemTitle: dashboardItemTitle,
    dashboardDueLabel: dashboardDueLabel,
    dashboardTreeNodeTooltip: dashboardTreeNodeTooltip,
    buildDashboardResultTreeNodes: buildDashboardResultTreeNodes,
    buildDashboardInventoryTreeNodes: buildDashboardInventoryTreeNodes,
    buildDashboardBrokenTreeNodes: buildDashboardBrokenTreeNodes,
    buildDashboardTaggedTreeNodes: buildDashboardTaggedTreeNodes,
    buildDashboardNavResult: buildDashboardNavResult,
    buildDashboardNavResultFromTreeNode: buildDashboardNavResultFromTreeNode
  };
}));
