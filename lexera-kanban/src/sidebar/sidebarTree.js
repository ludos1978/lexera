// Leading line comment so checkJs doesn't parse the first @typedef
// block as a module-description comment + typedef duplicate (slice-13
// lesson).

/**
 * @typedef {Object} LexeraSidebarTreeStackLocal
 * @property {Array<{ cards?: Array<unknown> }>} [columns]
 */

/**
 * @typedef {Object} LexeraSidebarTreeRowLocal
 * @property {Array<LexeraSidebarTreeStackLocal>} [stacks]
 */

/**
 * @typedef {Object} LexeraSidebarTreeStateLocal
 * @property {Array<string>} [rows]
 * @property {Array<string>} [stacks]
 * @property {Array<string>} [columns]
 */

/**
 * @typedef {Object} LexeraSidebarTreeOptionsLocal
 * @property {(text: string | null | undefined) => string} [stripLayoutTags]
 * @property {(columns: Array<unknown>) => Array<{ col: unknown; fullIndex: number }>} [getDisplayOrderedColumnEntries]
 */

/**
 * @typedef {Object} LexeraSidebarTreeApiLocal
 * @property {(content: string | null | undefined) => boolean} isHiddenCard
 * @property {(row: LexeraSidebarTreeRowLocal | null | undefined) => number} countCardsInRow
 * @property {(stack: LexeraSidebarTreeStackLocal | null | undefined) => number} countCardsInStack
 * @property {(content: string | null | undefined) => string} cardPreviewText
 * @property {(rows: Array<LexeraSidebarTreeRowLocal> | null | undefined, boardId: string, treeState: LexeraSidebarTreeStateLocal | null | undefined, hasTreeState: boolean, options?: LexeraSidebarTreeOptionsLocal) => Array<unknown>} buildSidebarTreeNodes
 */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  /** @type {any} */ (root).LexeraSidebarTree = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';


  /** @param {LexeraSidebarTreeStackLocal | null | undefined} stack */
  function countCardsInStack(stack) {
    var columns = stack && Array.isArray(stack.columns) ? stack.columns : [];
    var n = 0;
    for (var c = 0; c < columns.length; c++) {
      n += columns[c].cards ? columns[c].cards.length : 0;
    }
    return n;
  }

  /** @param {LexeraSidebarTreeRowLocal | null | undefined} row */
  function countCardsInRow(row) {
    var stacks = row && Array.isArray(row.stacks) ? row.stacks : [];
    var n = 0;
    for (var s = 0; s < stacks.length; s++) {
      n += countCardsInStack(stacks[s]);
    }
    return n;
  }

  var HIDDEN_RE = /#hidden-internal-(?:deleted|archived|parked|incoming)\b|(^|\s)#hidden(\s|$)/;
  function isHiddenTitle(title) {
    return HIDDEN_RE.test(title || '');
  }

  function isHiddenCard(content) {
    return HIDDEN_RE.test(content || '');
  }

  function cardPreviewText(content) {
    if (!content) return '';
    var text = content.replace(/^#+\s*/gm, '').replace(/\*\*|__|\*|_|~~|`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    var firstLine = text.split('\n')[0].trim();
    return firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;
  }

  function getDefaultDisplayOrderedColumnEntries(columns) {
    var items = Array.isArray(columns) ? columns : [];
    var entries = [];
    for (var i = 0; i < items.length; i++) {
      entries.push({ col: items[i], fullIndex: i });
    }
    return entries;
  }


  function buildSidebarTreeNodes(rows, boardId, treeState, hasTreeState, options) {
    rows = Array.isArray(rows) ? rows : [];
    treeState = treeState || { rows: [], stacks: [], columns: [] };
    options = options || {};
    var stripLayout = typeof options.stripLayoutTags === 'function' ? options.stripLayoutTags : LexeraTagSystem.stripLayoutTags;
    var getDisplayOrderedColumnEntries = typeof options.getDisplayOrderedColumnEntries === 'function'
      ? options.getDisplayOrderedColumnEntries
      : getDefaultDisplayOrderedColumnEntries;
    var singleRow = rows.length === 1;

    function resolveExpanded(kind, id, fallbackExpanded) {
      var expandedIds = Array.isArray(treeState[kind]) ? treeState[kind] : [];
      if (!hasTreeState) return fallbackExpanded;
      if (kind === 'columns') return expandedIds.indexOf(id) !== -1;
      return expandedIds.indexOf(id) === -1;
    }

    var nodes = [];
    var displayRi = 0;
    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri] || {};
      if (isHiddenTitle(row.title)) continue;
      var rowStacks = Array.isArray(row.stacks) ? row.stacks : [];
      var rowId = row.id || ('row-' + ri);
      var rowExpanded = resolveExpanded('rows', rowId, singleRow);
      var rowCardCount = countCardsInRow(row);
      var singleStack = rowStacks.length === 1;

      var stackNodes = [];
      var displaySi = 0;
      for (var si = 0; si < rowStacks.length; si++) {
        var stack = rowStacks[si] || {};
        if (isHiddenTitle(stack.title)) continue;
        var stackId = stack.id || ('stack-' + ri + '-' + si);
        var stackExpanded = resolveExpanded('stacks', stackId, singleRow && singleStack);
        var stackCardCount = countCardsInStack(stack);

        var colNodes = [];
        var stackColumnEntries = getDisplayOrderedColumnEntries(stack.columns || []);
        for (var ci = 0; ci < stackColumnEntries.length; ci++) {
          var col = stackColumnEntries[ci].col || {};
          if (isHiddenTitle(col.title)) continue;
          var colIdx = col.index != null ? col.index : -1;
          var colId = 'col-' + colIdx;
          var colExpanded = resolveExpanded('columns', colId, false);
          var cards = Array.isArray(col.cards) ? col.cards : [];
          var cardCount = cards.length;

          var cardNodes = [];
          if (cardCount > 0) {
            // `cards` comes from fullBoardData and includes hidden cards.
            // The sidebar skips hidden ones but `data-card-index` must be the
            // VISIBLE index (matching main-view conventions), because every
            // downstream action (`insert-before`, `insert-after`, `duplicate`,
            // `edit`, `delete`…) treats `ctx.cardIndex` as a visible index and
            // runs it through `getFullCardIndex` to re-map. Using the full
            // array index here caused off-by-one insertions whenever a hidden
            // card was present before the selection.
            var visibleCardIdx = 0;
            for (var cdi = 0; cdi < cards.length; cdi++) {
              var card = cards[cdi] || {};
              if (isHiddenCard(card.content)) continue;
              cardNodes.push(LexeraHierarchyContract.createHierarchyNode({
                id: null,
                label: cardPreviewText(card.content),
                type: 'card',
                structuralRole: 'item',
                grip: true,
                menu: true,
                gripTitle: 'Drag to move',
                hasToggle: false,
                children: null,
                expanded: false,
                hierarchy: {
                  surface: 'workspace',
                  kind: 'card',
                  entityId: card && card.id != null ? String(card.id) : null,
                  capabilities: ['activate', 'menu', 'drag', 'edit']
                },
                attrs: {
                  'data-board-id': boardId,
                  'data-row-id': rowId,
                  'data-stack-id': stackId,
                  'data-column-id': col && col.id != null ? String(col.id) : null,
                  'data-row-index': displayRi.toString(),
                  'data-stack-index': displaySi.toString(),
                  'data-col-local-index': ci.toString(),
                  'data-col-index': colIdx >= 0 ? colIdx.toString() : null,
                  'data-card-id': card && card.id != null ? String(card.id) : null,
                  'data-card-kid': card && card.kid != null ? String(card.kid) : null,
                  'data-card-index': visibleCardIdx.toString(),
                  'data-tree-drag': 'tree-card'
                }
              }));
              visibleCardIdx++;
            }
          }

          colNodes.push(LexeraHierarchyContract.createHierarchyNode({
            id: colId,
            label: stripLayout(col.title),
            count: cardCount,
            type: 'column',
            structuralRole: 'group',
            expanded: colExpanded,
            hasToggle: cardCount > 0,
            grip: true,
            menu: true,
            children: cardNodes.length > 0 ? cardNodes : null,
            hierarchy: {
              surface: 'workspace',
              kind: 'column',
              entityId: col && col.id != null ? String(col.id) : null,
              capabilities: ['activate', 'menu', 'drag', 'edit']
            },
            attrs: {
              'data-board-id': boardId,
              'data-row-id': rowId,
              'data-stack-id': stackId,
              'data-column-id': col && col.id != null ? String(col.id) : null,
              'data-col-index': colIdx >= 0 ? colIdx.toString() : null,
              'data-row-index': displayRi.toString(),
              'data-stack-index': displaySi.toString(),
              'data-col-local-index': ci.toString(),
              'data-tree-drag': 'tree-column'
            }
          }));
        }

        stackNodes.push(LexeraHierarchyContract.createHierarchyNode({
          id: stackId,
          label: stack.title || 'Stack ' + (displaySi + 1),
          count: rowStacks.length > 1 ? stackCardCount : null,
          type: 'stack',
          structuralRole: 'group',
          expanded: stackExpanded,
          grip: true,
          menu: true,
          children: colNodes,
          hierarchy: {
            surface: 'workspace',
            kind: 'stack',
            entityId: stackId,
            capabilities: ['activate', 'menu', 'drag', 'edit']
          },
          attrs: {
            'data-board-id': boardId,
            'data-row-id': rowId,
            'data-stack-id': stackId,
            'data-row-index': displayRi.toString(),
            'data-stack-index': displaySi.toString(),
            'data-tree-drag': 'tree-stack'
          }
        }));
        displaySi++;
      }

      nodes.push(LexeraHierarchyContract.createHierarchyNode({
        id: rowId,
        label: row.title || 'Row ' + (displayRi + 1),
        count: rows.length > 1 ? rowCardCount : null,
        type: 'row',
        structuralRole: 'group',
        expanded: rowExpanded,
        grip: true,
        menu: true,
        children: stackNodes,
        hierarchy: {
          surface: 'workspace',
          kind: 'row',
          entityId: rowId,
          capabilities: ['activate', 'menu', 'drag', 'edit']
        },
        attrs: {
          'data-board-id': boardId,
          'data-row-id': rowId,
          'data-row-index': displayRi.toString(),
          'data-tree-drag': 'tree-row'
        }
      }));
      displayRi++;
    }
    return nodes;
  }

  /** @type {LexeraSidebarTreeApiLocal} */
  var api = {
    isHiddenCard: isHiddenCard,
    countCardsInRow: countCardsInRow,
    countCardsInStack: countCardsInStack,
    cardPreviewText: cardPreviewText,
    buildSidebarTreeNodes: buildSidebarTreeNodes
  };
  return api;
}));
