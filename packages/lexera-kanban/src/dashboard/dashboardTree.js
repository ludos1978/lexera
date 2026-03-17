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
    buildDashboardNavResult: buildDashboardNavResult,
    buildDashboardNavResultFromTreeNode: buildDashboardNavResultFromTreeNode
  };
}));
