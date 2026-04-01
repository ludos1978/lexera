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
    var line = String(content || '').split('\n')[0].trim();
    if (!line) return '(empty card)';
    return line.length > 62 ? line.slice(0, 59) + '...' : line;
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

  function buildDashboardResultTreeNodes(items) {
    if (!Array.isArray(items) || items.length === 0) return [];

    var groupOrder = [];
    var groups = Object.create(null);

    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var boardId = String(item.boardId || '').trim();
      var boardTitle = String(item.boardTitle || 'Untitled').trim() || 'Untitled';
      var groupKey = boardId || ('board-title:' + boardTitle);
      if (!groups[groupKey]) {
        groups[groupKey] = {
          boardId: boardId,
          label: boardTitle,
          children: []
        };
        groupOrder.push(groupKey);
      }
      groups[groupKey].children.push({
        id: null,
        label: dashboardItemTitle(item),
        count: dashboardDueLabel(item) || null,
        type: 'dashboard-result',
        expanded: false,
        hasToggle: false,
        grip: false,
        attrs: {
          'data-dashboard-target': 'result',
          'data-dashboard-board-id': boardId || null,
          'data-dashboard-card-id': item.cardId ? String(item.cardId) : null,
          'data-dashboard-column-index': item.columnIndex != null ? String(item.columnIndex) : null,
          'data-dashboard-row-index': item.rowIndex != null ? String(item.rowIndex) : null,
          'data-dashboard-stack-index': item.stackIndex != null ? String(item.stackIndex) : null,
          'data-dashboard-column-title': item.columnTitle ? String(item.columnTitle) : null,
          title: dashboardTreeNodeTooltip(item) || null
        }
      });
    }

    var nodes = [];
    for (var gi = 0; gi < groupOrder.length; gi++) {
      var group = groups[groupOrder[gi]];
      nodes.push({
        id: 'dashboard-group-' + (group.boardId || gi),
        label: group.label,
        count: group.children.length,
        type: 'dashboard-group',
        expanded: true,
        hasToggle: true,
        grip: false,
        attrs: {
          'data-dashboard-target': 'board',
          'data-dashboard-board-id': group.boardId || null
        },
        children: group.children
      });
    }
    return nodes;
  }

  function buildDashboardInventoryTreeNodes(items) {
    if (!Array.isArray(items) || items.length === 0) return [];

    var groupOrder = [];
    var groups = Object.create(null);

    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var contextLabel = String(item.firstContextLabel || 'Other').trim() || 'Other';
      var groupKey = sanitizeDashboardNodeId(contextLabel, 'context-' + i);
      if (!groups[groupKey]) {
        groups[groupKey] = {
          label: contextLabel,
          children: []
        };
        groupOrder.push(groupKey);
      }
      groups[groupKey].children.push({
        id: null,
        label: String(item.path || '').trim() || '(missing path)',
        count: dashboardInventoryNodeCount(item),
        type: 'dashboard-file',
        expanded: false,
        hasToggle: false,
        grip: false,
        attrs: {
          'data-dashboard-target': 'file',
          'data-dashboard-card-id': item.firstCardId || null,
          'data-dashboard-column-index': item.firstColumnIndex != null ? String(item.firstColumnIndex) : null,
          'data-dashboard-row-index': item.firstRowIndex != null ? String(item.firstRowIndex) : null,
          'data-dashboard-stack-index': item.firstStackIndex != null ? String(item.firstStackIndex) : null,
          'data-dashboard-col-local-index': item.firstColLocalIndex != null ? String(item.firstColLocalIndex) : null,
          'data-dashboard-status': String(item.status || 'unknown').trim().toLowerCase() || 'unknown',
          title: dashboardInventoryTooltip(item) || null
        }
      });
    }

    var nodes = [];
    for (var gi = 0; gi < groupOrder.length; gi++) {
      var group = groups[groupOrder[gi]];
      nodes.push({
        id: 'dashboard-context-' + groupOrder[gi],
        label: group.label,
        count: group.children.length,
        type: 'dashboard-group',
        expanded: true,
        hasToggle: true,
        grip: false,
        attrs: {
          'data-dashboard-target': 'context'
        },
        children: group.children
      });
    }
    return nodes;
  }

  function buildDashboardBrokenTreeNodes(items) {
    if (!Array.isArray(items) || items.length === 0) return [];

    var groupOrder = [];
    var groups = Object.create(null);

    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var type = String(item.type || 'embed').trim().toLowerCase() || 'embed';
      if (!groups[type]) {
        groups[type] = {
          label: dashboardBrokenGroupLabel(type),
          children: []
        };
        groupOrder.push(type);
      }
      groups[type].children.push({
        id: null,
        label: String(item.src || '').trim() || '(unknown source)',
        count: item.count > 1 ? ('x' + item.count) : null,
        type: 'dashboard-broken',
        expanded: false,
        hasToggle: false,
        grip: false,
        attrs: {
          'data-dashboard-target': 'broken',
          'data-dashboard-col-index': item.colIndex != null ? String(item.colIndex) : null,
          'data-dashboard-card-index': item.cardIndex != null ? String(item.cardIndex) : null,
          'data-dashboard-card-id': item.cardId || null,
          'data-dashboard-row-index': item.rowIndex != null ? String(item.rowIndex) : null,
          'data-dashboard-stack-index': item.stackIndex != null ? String(item.stackIndex) : null,
          'data-dashboard-col-local-index': item.colLocalIndex != null ? String(item.colLocalIndex) : null,
          'data-dashboard-broken-src': String(item.src || '') || null,
          'data-dashboard-broken-type': type,
          title: dashboardBrokenTooltip(item) || null
        }
      });
    }

    var nodes = [];
    for (var gi = 0; gi < groupOrder.length; gi++) {
      var groupKey = groupOrder[gi];
      var group = groups[groupKey];
      nodes.push({
        id: 'dashboard-broken-' + sanitizeDashboardNodeId(groupKey, 'broken-' + gi),
        label: group.label,
        count: group.children.length,
        type: 'dashboard-group',
        expanded: true,
        hasToggle: true,
        grip: false,
        attrs: {
          'data-dashboard-target': 'broken-group',
          'data-dashboard-broken-type': groupKey
        },
        children: group.children
      });
    }
    return nodes;
  }

  function buildDashboardTaggedTreeNodes(groups) {
    if (!Array.isArray(groups) || groups.length === 0) return [];
    var nodes = [];
    for (var i = 0; i < groups.length; i++) {
      var group = groups[i] || {};
      var tag = String(group.tag || '').trim();
      var children = buildDashboardResultTreeNodes(group.items || []);
      if (!tag) continue;
      nodes.push({
        id: 'dashboard-tag-' + sanitizeDashboardNodeId(tag, 'tag-' + i),
        label: tag,
        count: Array.isArray(group.items) ? group.items.length : 0,
        type: 'dashboard-group',
        expanded: true,
        hasToggle: true,
        grip: false,
        attrs: {
          'data-dashboard-target': 'tag',
          'data-dashboard-tag': tag
        },
        children: children
      });
    }
    return nodes;
  }

  function buildDashboardNavResult(result) {
    return {
      boardId: result.boardId,
      cardId: result.cardId,
      cardContent: result.cardContent,
      columnIndex: parseOptionalSearchIndex(result.columnIndex),
      rowIndex: parseOptionalSearchIndex(result.rowIndex),
      stackIndex: parseOptionalSearchIndex(result.stackIndex),
      columnTitle: result.columnTitle
    };
  }

  function buildDashboardNavResultFromTreeNode(node) {
    if (!node || !node.getAttribute) return null;
    var boardId = String(node.getAttribute('data-dashboard-board-id') || '').trim();
    if (!boardId) return null;
    return {
      boardId: boardId,
      cardId: String(node.getAttribute('data-dashboard-card-id') || '').trim() || null,
      columnIndex: parseOptionalSearchIndex(node.getAttribute('data-dashboard-column-index')),
      rowIndex: parseOptionalSearchIndex(node.getAttribute('data-dashboard-row-index')),
      stackIndex: parseOptionalSearchIndex(node.getAttribute('data-dashboard-stack-index')),
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
