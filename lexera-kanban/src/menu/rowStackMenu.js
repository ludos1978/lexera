/**
 * Row & Stack Context Menus — row/stack context menu show/close, renameRowOrStack,
 * creation source (template-aware add buttons), built-in diagram templates,
 * template insertion helpers, and row/stack/column CRUD operations.
 *
 * Dependencies injected via init().
 */
var LexeraRowStackMenu = (function () {
  'use strict';

  // -- Injected dependencies --
  var deps = {};

  // -- Window globals accessed by this module --
  var MenuContributorRegistry = window.LexeraMenuContributorRegistry;
  var ActionRegistry = window.LexeraActionRegistry;
  var LexeraTemplates = window.LexeraTemplates;
  var LexeraApi = window.LexeraApi;

  // ── Row & Stack menu state ──────────────────────────────────────────

  var activeRowStackMenu = null;

  function closeRowStackMenu() {
    if (activeRowStackMenu) { activeRowStackMenu.remove(); activeRowStackMenu = null; }
  }

  function showRowContextMenu(x, y, rowIdx) {
    showElementContextMenu('row', x, y, { rowIdx: rowIdx });
  }

  function showStackContextMenu(x, y, rowIdx, stackIdx) {
    showElementContextMenu('stack', x, y, { rowIdx: rowIdx, stackIdx: stackIdx });
  }

  function showCanvasBackgroundContextMenu(x, y, rowIdx, canvasPosition) {
    showElementContextMenu('canvas', x, y, {
      rowIdx: rowIdx,
      canvasPosition: canvasPosition || null
    });
  }

  function cloneContext(rawContext) {
    var context = {};
    var keys = Object.keys(rawContext || {});
    for (var i = 0; i < keys.length; i++) context[keys[i]] = rawContext[keys[i]];
    return context;
  }

  function normalizeStableContextId(value) {
    if (value == null) return '';
    var normalized = String(value).trim();
    return normalized ? normalized : '';
  }

  function getContextActiveRows() {
    var activeBoardData = deps.getActiveBoardData ? deps.getActiveBoardData() : null;
    return activeBoardData && Array.isArray(activeBoardData.rows) ? activeBoardData.rows : [];
  }

  function getContextFullRows() {
    var fullBoardData = deps.getFullBoardData ? deps.getFullBoardData() : null;
    return fullBoardData && Array.isArray(fullBoardData.rows) ? fullBoardData.rows : [];
  }

  function findActiveRowEntryById(rowId) {
    rowId = normalizeStableContextId(rowId);
    if (!rowId) return null;
    var rows = getContextActiveRows();
    for (var r = 0; r < rows.length; r++) {
      if (normalizeStableContextId(rows[r] && rows[r].id) === rowId) {
        return { row: rows[r], rowIdx: r };
      }
    }
    return null;
  }

  function findActiveStackEntryById(rowId, stackId) {
    stackId = normalizeStableContextId(stackId);
    if (!stackId) return null;
    var rows = getContextActiveRows();
    var normalizedRowId = normalizeStableContextId(rowId);
    for (var r = 0; r < rows.length; r++) {
      if (normalizedRowId && normalizeStableContextId(rows[r] && rows[r].id) !== normalizedRowId) continue;
      var stacks = rows[r] && Array.isArray(rows[r].stacks) ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        if (normalizeStableContextId(stacks[s] && stacks[s].id) === stackId) {
          return { row: rows[r], rowIdx: r, stack: stacks[s], stackIdx: s };
        }
      }
    }
    return null;
  }

  function findActiveColumnEntryById(rowId, stackId, columnId) {
    columnId = normalizeStableContextId(columnId);
    if (!columnId) return null;
    var rows = getContextActiveRows();
    var normalizedRowId = normalizeStableContextId(rowId);
    var normalizedStackId = normalizeStableContextId(stackId);
    for (var r = 0; r < rows.length; r++) {
      if (normalizedRowId && normalizeStableContextId(rows[r] && rows[r].id) !== normalizedRowId) continue;
      var stacks = rows[r] && Array.isArray(rows[r].stacks) ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        if (normalizedStackId && normalizeStableContextId(stacks[s] && stacks[s].id) !== normalizedStackId) continue;
        var columns = stacks[s] && Array.isArray(stacks[s].columns) ? stacks[s].columns : [];
        for (var c = 0; c < columns.length; c++) {
          if (normalizeStableContextId(columns[c] && columns[c].id) === columnId) {
            return {
              row: rows[r],
              rowIdx: r,
              stack: stacks[s],
              stackIdx: s,
              column: columns[c],
              colLocalIdx: c,
              colIndex: typeof columns[c].index === 'number' ? columns[c].index : -1
            };
          }
        }
      }
    }
    return null;
  }

  function findActiveCardEntryById(rowId, stackId, columnId, cardId) {
    cardId = normalizeStableContextId(cardId);
    if (!cardId) return null;
    var rows = getContextActiveRows();
    var normalizedRowId = normalizeStableContextId(rowId);
    var normalizedStackId = normalizeStableContextId(stackId);
    var normalizedColumnId = normalizeStableContextId(columnId);
    for (var r = 0; r < rows.length; r++) {
      if (normalizedRowId && normalizeStableContextId(rows[r] && rows[r].id) !== normalizedRowId) continue;
      var stacks = rows[r] && Array.isArray(rows[r].stacks) ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        if (normalizedStackId && normalizeStableContextId(stacks[s] && stacks[s].id) !== normalizedStackId) continue;
        var columns = stacks[s] && Array.isArray(stacks[s].columns) ? stacks[s].columns : [];
        for (var c = 0; c < columns.length; c++) {
          if (normalizedColumnId && normalizeStableContextId(columns[c] && columns[c].id) !== normalizedColumnId) continue;
          var cards = columns[c] && Array.isArray(columns[c].cards) ? columns[c].cards : [];
          for (var k = 0; k < cards.length; k++) {
            if (normalizeStableContextId(cards[k] && cards[k].id) === cardId) {
              return {
                row: rows[r],
                rowIdx: r,
                stack: stacks[s],
                stackIdx: s,
                column: columns[c],
                colLocalIdx: c,
                colIndex: typeof columns[c].index === 'number' ? columns[c].index : -1,
                card: cards[k],
                cardIndex: k
              };
            }
          }
        }
      }
    }
    return null;
  }

  function findFullColumnEntryById(rowId, stackId, columnId) {
    columnId = normalizeStableContextId(columnId);
    if (!columnId) return null;
    var rows = getContextFullRows();
    var normalizedRowId = normalizeStableContextId(rowId);
    var normalizedStackId = normalizeStableContextId(stackId);
    for (var r = 0; r < rows.length; r++) {
      if (normalizedRowId && normalizeStableContextId(rows[r] && rows[r].id) !== normalizedRowId) continue;
      var stacks = rows[r] && Array.isArray(rows[r].stacks) ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        if (normalizedStackId && normalizeStableContextId(stacks[s] && stacks[s].id) !== normalizedStackId) continue;
        var columns = stacks[s] && Array.isArray(stacks[s].columns) ? stacks[s].columns : [];
        for (var c = 0; c < columns.length; c++) {
          if (normalizeStableContextId(columns[c] && columns[c].id) === columnId) {
            return {
              row: rows[r],
              rowFullIdx: r,
              stack: stacks[s],
              stackFullIdx: s,
              column: columns[c],
              colFullIdx: c
            };
          }
        }
      }
    }
    return null;
  }

  function setCreationRowPath(context, rowIdx) {
    if (typeof rowIdx === 'number' && !isNaN(rowIdx)) {
      context.rowIdx = rowIdx;
      context.rowIndex = rowIdx;
    }
  }

  function setCreationStackPath(context, rowIdx, stackIdx) {
    setCreationRowPath(context, rowIdx);
    if (typeof stackIdx === 'number' && !isNaN(stackIdx)) {
      context.stackIdx = stackIdx;
      context.stackIndex = stackIdx;
    }
  }

  function setCreationColumnPath(context, rowIdx, stackIdx, colLocalIdx, flatColIdx) {
    setCreationStackPath(context, rowIdx, stackIdx);
    if (typeof colLocalIdx === 'number' && !isNaN(colLocalIdx)) {
      context.colLocalIdx = colLocalIdx;
      context.colIndex = colLocalIdx;
    }
    if (typeof flatColIdx === 'number' && !isNaN(flatColIdx)) {
      context.flatColIndex = flatColIdx;
    }
  }

  function resolveContextIndicesByStableIds(scope, context) {
    if (!context || !scope) return;
    var rowId = normalizeStableContextId(context.rowId);
    var stackId = normalizeStableContextId(context.stackId);
    var columnId = normalizeStableContextId(context.columnId);
    var cardId = normalizeStableContextId(context.cardId);
    var cardEntry = null;
    var columnEntry = null;
    var stackEntry = null;
    var rowEntry = null;

    if (scope === 'card' && cardId) {
      cardEntry = findActiveCardEntryById(rowId, stackId, columnId, cardId);
      if (cardEntry) {
        context.rowIdx = cardEntry.rowIdx;
        context.stackIdx = cardEntry.stackIdx;
        context.colLocalIdx = cardEntry.colLocalIdx;
        if (cardEntry.colIndex >= 0) context.colIndex = cardEntry.colIndex;
        context.cardIndex = cardEntry.cardIndex;
      }
    }

    if (!cardEntry && (scope === 'card' || scope === 'column') && columnId) {
      columnEntry = findActiveColumnEntryById(rowId, stackId, columnId);
      if (columnEntry) {
        context.rowIdx = columnEntry.rowIdx;
        context.stackIdx = columnEntry.stackIdx;
        context.colLocalIdx = columnEntry.colLocalIdx;
        if (columnEntry.colIndex >= 0) context.colIndex = columnEntry.colIndex;
      }
    }

    if (!cardEntry && !columnEntry && (scope === 'card' || scope === 'column' || scope === 'stack') && stackId) {
      stackEntry = findActiveStackEntryById(rowId, stackId);
      if (stackEntry) {
        context.rowIdx = stackEntry.rowIdx;
        context.stackIdx = stackEntry.stackIdx;
      }
    }

    if (!cardEntry && !columnEntry && !stackEntry && (scope === 'card' || scope === 'column' || scope === 'stack' || scope === 'row') && rowId) {
      rowEntry = findActiveRowEntryById(rowId);
      if (rowEntry) context.rowIdx = rowEntry.rowIdx;
    }
  }

  function normalizeCreationContextForEntity(entityType, rawContext) {
    if (!rawContext) return rawContext || null;
    var context = cloneContext(rawContext);
    var rowId = normalizeStableContextId(context.rowId);
    var stackId = normalizeStableContextId(context.stackId);
    var columnId = normalizeStableContextId(context.columnId);
    var cardId = normalizeStableContextId(context.cardId);
    var activeRowEntry = rowId ? findActiveRowEntryById(rowId) : null;
    var activeStackEntry = stackId ? findActiveStackEntryById(rowId, stackId) : null;
    var activeColumnEntry = columnId ? findActiveColumnEntryById(rowId, stackId, columnId) : null;
    var activeCardEntry = cardId ? findActiveCardEntryById(rowId, stackId, columnId, cardId) : null;

    if (activeCardEntry) {
      setCreationColumnPath(context, activeCardEntry.rowIdx, activeCardEntry.stackIdx, activeCardEntry.colLocalIdx, activeCardEntry.colIndex);
      context.cardIndex = activeCardEntry.cardIndex;
    } else if (activeColumnEntry) {
      setCreationColumnPath(context, activeColumnEntry.rowIdx, activeColumnEntry.stackIdx, activeColumnEntry.colLocalIdx, activeColumnEntry.colIndex);
    } else if (activeStackEntry) {
      setCreationStackPath(context, activeStackEntry.rowIdx, activeStackEntry.stackIdx);
    } else if (activeRowEntry) {
      setCreationRowPath(context, activeRowEntry.rowIdx);
    }

    if (entityType === 'card') {
      if (typeof context.insertIdx !== 'number' && typeof context.atCardIndex === 'number') context.insertIdx = context.atCardIndex;
      if (typeof context.atCardIndex !== 'number' && typeof context.insertIdx === 'number') context.atCardIndex = context.insertIdx;
      if (activeCardEntry && typeof context.before === 'boolean') {
        var stableInsertIdx = context.before ? activeCardEntry.cardIndex : (activeCardEntry.cardIndex + 1);
        context.insertIdx = stableInsertIdx;
        context.atCardIndex = stableInsertIdx;
        context.insertMode = 'visible';
      }
      return context;
    }

    if (entityType === 'row') {
      if (activeRowEntry && typeof context.before === 'boolean') {
        context.atIndex = context.before ? activeRowEntry.rowIdx : (activeRowEntry.rowIdx + 1);
      }
      return context;
    }

    if (entityType === 'stack') {
      if (activeStackEntry && typeof context.before === 'boolean') {
        context.atStackIdx = context.before ? activeStackEntry.stackIdx : (activeStackEntry.stackIdx + 1);
      }
      return context;
    }

    if (entityType === 'column') {
      if (!stackId && !activeStackEntry && activeRowEntry && typeof context.before === 'boolean') {
        context.atIndex = context.before ? activeRowEntry.rowIdx : (activeRowEntry.rowIdx + 1);
      }
      if (columnId && typeof context.before === 'boolean') {
        var fullColumnEntry = findFullColumnEntryById(rowId, stackId, columnId);
        if (fullColumnEntry) {
          context.atColIdx = context.before ? fullColumnEntry.colFullIdx : (fullColumnEntry.colFullIdx + 1);
        }
      }
      return context;
    }

    return context;
  }

  function buildEnrichedContext(scope, rawContext) {
    var context = cloneContext(rawContext);
    context.scope = scope;

    resolveContextIndicesByStableIds(scope, context);

    // Resolve colIndex from row/stack/colLocal if missing
    if ((scope === 'card' || scope === 'column') && (context.colIndex == null || context.colIndex < 0) &&
        typeof context.rowIdx === 'number' && typeof context.stackIdx === 'number' && typeof context.colLocalIdx === 'number') {
      var activeBoardData = deps.getActiveBoardData();
      if (activeBoardData && activeBoardData.rows) {
        var resolveRows = activeBoardData.rows;
        for (var rri = 0; rri < resolveRows.length; rri++) {
          var resolveStacks = resolveRows[rri].stacks || [];
          for (var rsi = 0; rsi < resolveStacks.length; rsi++) {
            var resolveCols = resolveStacks[rsi].columns || [];
            for (var rci = 0; rci < resolveCols.length; rci++) {
              if (rri === context.rowIdx && rsi === context.stackIdx && rci === context.colLocalIdx) {
                context.colIndex = resolveCols[rci].index;
              }
            }
          }
        }
      }
    }

    if (scope === 'card') {
      var col = deps.getFullColumn(context.colIndex);
      var cardText = '';
      if (col) {
        var fullIdx = deps.getFullCardIndex(col, context.cardIndex);
        if (fullIdx !== -1 && col.cards[fullIdx]) cardText = col.cards[fullIdx].content || '';
      }
      context.elementText = cardText;
      context.visibleCardCount = 0;
      var activeBoardData = deps.getActiveBoardData();
      if (activeBoardData && Array.isArray(activeBoardData.columns)) {
        for (var vc = 0; vc < activeBoardData.columns.length; vc++) {
          if (activeBoardData.columns[vc] && activeBoardData.columns[vc].index === context.colIndex) {
            context.visibleCardCount = Array.isArray(activeBoardData.columns[vc].cards) ? activeBoardData.columns[vc].cards.length : 0;
            break;
          }
        }
      }
      context.boardColumns = activeBoardData && Array.isArray(activeBoardData.columns) ? activeBoardData.columns : [];
    } else if (scope === 'column') {
      var ccol = deps.getFullColumn(context.colIndex);
      var colTitle = ccol ? (ccol.title || '') : '';
      context.elementText = colTitle;
      var layout = deps.getColumnLayoutTags(colTitle);
      context.isStacked = layout.stack;
      context.currentSpan = layout.span ? parseInt(layout.span.match(/\d+/)[0], 10) : 1;
      context.includePath = (ccol && ccol.includeSource && ccol.includeSource.rawPath)
        ? String(ccol.includeSource.rawPath)
        : deps.extractIncludePathFromTitle(colTitle);
      var activeBoardData2 = deps.getActiveBoardData();
      context.boardRows = activeBoardData2 && Array.isArray(activeBoardData2.rows) ? activeBoardData2.rows : [];
      context.columnSortState = deps.getColumnSortState ? deps.getColumnSortState() : {};
    } else if (scope === 'row') {
      var row = deps.findFullDataRow(context.rowIdx);
      context.elementText = row ? (row.title || '') : '';
    } else if (scope === 'stack') {
      var stack = deps.findFullDataStack(context.rowIdx, context.stackIdx);
      context.elementText = stack ? (stack.title || '') : '';
    }
    return context;
  }

  function buildContextMenuItemsAndContext(scope, rawContext) {
    var context = buildEnrichedContext(scope, rawContext);
    var items = MenuContributorRegistry.buildMenu(scope, context);
    return { items: items, context: context };
  }

  function showElementContextMenu(scope, x, y, rawContext) {
    closeRowStackMenu();
    deps.closeColumnContextMenu();
    deps.closeCardContextMenu();

    var built = buildContextMenuItemsAndContext(scope, rawContext);
    var traceTarget = scope + '.menu';

    deps.showNativeMenu(built.items, x, y, traceTarget).then(function (action) {
      if (!action) return;
      ActionRegistry.dispatch(scope, action, built.context);
    }).catch(function (err) {
      deps.logFrontendIssue('error', traceTarget, scope + ' menu action failed', err);
    });
  }

  function renameRowOrStack(type, rowIdx, stackIdx) {
    var rootSelector = type === 'row'
      ? '.board-row[data-row-index="' + rowIdx + '"]'
      : '.board-stack[data-row-index="' + rowIdx + '"][data-stack-index="' + stackIdx + '"]';
    var rootEl = deps.getElColumnsContainer().querySelector(rootSelector);
    if (!rootEl) return;

    var titleSelector = type === 'row' ? '.board-row-title' : '.board-stack-title';
    var titleEl = rootEl.querySelector(titleSelector);
    if (!titleEl) return;
    var target = type === 'row' ? deps.findFullDataRow(rowIdx) : deps.findFullDataStack(rowIdx, stackIdx);
    if (!target) return;

    var headerSelector = type === 'row' ? '.board-row-header' : '.board-stack-header';
    var headerEl = rootEl.querySelector(headerSelector);
    var currentTitle = target.title;
    var currentDisplayTitle = typeof deps.stripHtmlComments === 'function'
      ? deps.stripHtmlComments(currentTitle || '')
      : String(currentTitle || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/\s+/g, ' ').trim();
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'column-rename-input';
    if (type === 'row') input.classList.add('row-rename-input');
    input.value = currentDisplayTitle;
    if (headerEl) headerEl.classList.add('title-editing');
    titleEl.textContent = '';
    titleEl.appendChild(input);
    input.focus();
    input.select();

    var done = false;
    function cleanup() {
      if (headerEl) headerEl.classList.remove('title-editing');
    }
    function getDisplayTitle(title) {
      return title.length > 40 ? title.slice(0, 40) + '\u2026' : title;
    }
    function save() {
      if (done) return;
      done = true;
      var newTitle = input.value.trim();
      cleanup();
      if (newTitle !== currentDisplayTitle) {
        titleEl.textContent = newTitle ? getDisplayTitle(newTitle) : '\u00A0';
        deps.pushUndo();
        target.title = deps.rebuildTitleWithPreservedComments(newTitle, currentTitle);
        // Title-only change: use targeted refresh instead of full board re-render
        var renameTargets = [{ type: 'sidebar' }];
        if (entityType === 'row' && typeof rowIdx === 'number') {
          renameTargets.unshift({ type: 'row', rowIndex: rowIdx });
        } else if (entityType === 'stack' && typeof rowIdx === 'number' && typeof stackIdx === 'number') {
          renameTargets.unshift({ type: 'stack', rowIndex: rowIdx, stackIndex: stackIdx });
        } else {
          renameTargets.unshift({ type: 'board' });
        }
        deps.persistBoardMutation({ targets: renameTargets });
      } else {
        titleEl.textContent = currentDisplayTitle ? getDisplayTitle(currentDisplayTitle) : '\u00A0';
      }
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        input.value = currentDisplayTitle;
        save();
      }
    });
  }

  // ── Creation Source (template-aware add buttons) ───────────────────────

  var templatesLoaded = false;

  function loadTemplatesOnce() {
    if (templatesLoaded) return;
    if (!LexeraTemplates && typeof window !== 'undefined') LexeraTemplates = window.LexeraTemplates;
    if (!LexeraTemplates || typeof LexeraTemplates.loadTemplates !== 'function') return;
    templatesLoaded = true;
    LexeraTemplates.loadTemplates().catch(function (err) {
      if (deps && typeof deps.logFrontendIssue === 'function') {
        deps.logFrontendIssue('warn', 'templates.load', 'Failed to load templates', err);
      }
    });
  }

  /**
   * Build a creation-source dropdown wrapper around an add button.
   * @param {string} entityType - "card"|"column"|"stack"|"row"
   * @param {object} context - { colIndex, rowIdx, stackIdx } as needed
   * @param {object} options - { btnClass, btnText, wrapperClass }
   * @returns {HTMLElement} .creation-source element
   */
  function renderCreationSource(entityType, context, options) {
    options = options || {};
    var wrapper = document.createElement('div');
    wrapper.className = 'creation-source' + (options.wrapperClass ? ' ' + options.wrapperClass : '');

    var btn = document.createElement('button');
    btn.className = options.btnClass || 'add-entity-btn';
    btn.textContent = options.btnText || ('+ Add ' + entityType);
    wrapper.appendChild(btn);

    if (entityType !== 'card' && entityType !== 'column') {
      var dropdown = document.createElement('div');
      dropdown.className = 'creation-dropdown';

      // "Empty" item — always present
      var emptyItem = document.createElement('div');
      emptyItem.className = 'creation-item';
      emptyItem.textContent = 'Empty ' + entityType.charAt(0).toUpperCase() + entityType.slice(1);
      emptyItem.addEventListener('click', function (e) {
        e.stopPropagation();
        handleCreationAction(entityType, 'empty', context);
      });
      dropdown.appendChild(emptyItem);

      // "From Clipboard" item
      var clipItem = document.createElement('div');
      clipItem.className = 'creation-item';
      clipItem.textContent = 'From Clipboard';
      clipItem.addEventListener('click', function (e) {
        e.stopPropagation();
        handleCreationAction(entityType, 'clipboard', context);
      });
      dropdown.appendChild(clipItem);

      // Template items
      var templates = deps.prioritizeDrawioAndExcalidrawTemplates(entityType, LexeraTemplates.getTemplatesForType(entityType));
      if (templates.length > 0) {
        var sep = document.createElement('div');
        sep.className = 'creation-sep';
        dropdown.appendChild(sep);

        for (var i = 0; i < templates.length; i++) {
          (function (tpl) {
            var tplItem = document.createElement('div');
            tplItem.className = 'creation-item';
            tplItem.textContent = tpl.name;
            tplItem.addEventListener('click', function (e) {
              e.stopPropagation();
              handleCreationAction(entityType, 'template:' + tpl.id, context);
            });
            dropdown.appendChild(tplItem);
          })(templates[i]);
        }
      }

      wrapper.appendChild(dropdown);
    }

    // Direct click on button = empty creation (original behavior)
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      handleCreationAction(entityType, 'empty', context);
    });

    return wrapper;
  }

  /**
   * Dispatch creation action for a given entity type.
   */
  async function handleCreationAction(entityType, action, context) {
    context = normalizeCreationContextForEntity(entityType, context);
    deps.traceFrontendAction('info', 'creation.action', 'Dispatching creation action', {
      boardId: deps.getActiveBoardId() || null,
      entityType: entityType,
      action: action,
      context: context || null
    });
    if (action === 'empty') {
      if (entityType === 'card') {
        return deps.addEmptyCardToActiveBoard(
          context || null,
          context && typeof context.atCardIndex === 'number' ? context.atCardIndex : context && context.insertIdx,
          context && context.insertMode
        );
      }
      if (entityType === 'row') {
        addRow(context.atIndex);
      } else if (entityType === 'stack') {
        addStackToRow(context.rowIdx, context.atStackIdx);
      } else if (entityType === 'column') {
        if (context && context.stackIdx != null) {
          addColumnToStack(context.rowIdx, context.stackIdx, context.atColIdx);
        } else if (context && context.rowIdx != null) {
          addStackToRow(context.rowIdx, context.atStackIdx);
        } else if (context && context.atIndex != null) {
          addRow(context.atIndex);
        }
      }
      return;
    }

    if (action === 'clipboard') {
      try {
        var text = await navigator.clipboard.readText();
        if (!text || !text.trim()) {
          deps.showNotification('Clipboard is empty');
          deps.lexeraLog('warn', 'Clipboard is empty');
          return;
        }
        await insertTextContentForEntity(entityType, text.trim(), context);
      } catch (err) {
        deps.lexeraLog('warn', 'Clipboard read failed: ' + err.message);
      }
      return;
    }

    // template:id
    if (action.indexOf('template:') === 0) {
      var templateId = action.substring(9);
      if (templateId.indexOf('__builtin__:diagram:') === 0) {
        var diagramContent = await buildBuiltInDiagramTemplateEmbedMarkdown(templateId);
        if (!diagramContent) return;
        await insertTextContentForEntity(entityType, diagramContent, context);
        return;
      }
      try {
        var tplData = await LexeraTemplates.getFullTemplate(templateId);
        var parsed = tplData.parsed;
        var values = {};

        if (parsed.variables && parsed.variables.length > 0) {
          values = await LexeraTemplates.showVariableDialog(parsed.name, parsed.variables);
          if (values === null) return; // cancelled
        }
        values = LexeraTemplates.applyDefaults(parsed.variables, values);

        // Copy extra template files if any
        if (tplData.files.length > 0 && deps.getActiveBoardId()) {
          LexeraApi.request('/templates/' + encodeURIComponent(templateId) + '/copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ board_id: deps.getActiveBoardId(), variables: values })
          }).catch(function (err) {
            deps.lexeraLog('warn', 'Template file copy failed: ' + err.message);
          });
        }

        // Build entity and insert
        if (entityType === 'card') {
          var card = LexeraTemplates.buildCardFromTemplate(parsed, values);
          if (deps.getActiveBoardId() && context) {
            await deps.addCardToActiveBoard(
              context,
              card.content
            );
          }
        } else if (entityType === 'column') {
          var cols = LexeraTemplates.buildColumnFromTemplate(parsed, values);
          if (context && context.stackIdx != null) {
            insertTemplateColumns(context.rowIdx, context.stackIdx, cols, context.atColIdx);
          } else if (context && context.rowIdx != null) {
            var stackTs = Date.now();
            var stackTpl = {
              id: 'stack-' + stackTs,
              title: 'New Stack',
              columns: cols
            };
            insertTemplateStack(context.rowIdx, stackTpl, context.atStackIdx);
          } else if (context && context.atIndex != null) {
            var rowTs = Date.now();
            var rowTpl = {
              id: 'row-' + rowTs,
              title: 'New Row',
              stacks: [{
                id: 'stack-' + rowTs,
                title: 'New Stack',
                columns: cols
              }]
            };
            deps.applyDefaultCanvasPlacementToStack(rowTpl, rowTpl.stacks[0]);
            insertTemplateRow(context.atIndex, rowTpl);
          }
        } else if (entityType === 'stack') {
          var stackTpl = LexeraTemplates.buildStackFromTemplate(parsed, values);
          insertTemplateStack(context.rowIdx, stackTpl, context.atStackIdx);
        } else if (entityType === 'row') {
          var rowTpl = LexeraTemplates.buildRowFromTemplate(parsed, values);
          insertTemplateRow(context.atIndex, rowTpl);
        }
      } catch (err) {
        deps.lexeraLog('error', 'Template apply failed: ' + err.message);
      }
    }
  }

  async function insertTextContentForEntity(entityType, text, context) {
    context = normalizeCreationContextForEntity(entityType, context);
    var normalized = String(text || '').trim();
    if (!normalized) {
      deps.showNotification('No content available');
      return false;
    }
    if (entityType === 'card' && context && deps.getActiveBoardId()) {
      await deps.addCardToActiveBoard(context, normalized);
      return true;
    }
    if (entityType === 'row') {
      await addRowFromContent(normalized, context && context.atIndex);
      return true;
    }
    if (entityType === 'stack') {
      await addStackFromContent(context && context.rowIdx, normalized, context && context.atStackIdx);
      return true;
    }
    if (entityType === 'column') {
      if (context && context.stackIdx != null) {
        await addColumnFromContent(context.rowIdx, context.stackIdx, normalized, context.atColIdx);
        return true;
      }
      if (context && context.rowIdx != null) {
        await addStackFromContent(context.rowIdx, normalized, context.atStackIdx);
        return true;
      }
      if (context && context.atIndex != null) {
        await addRowFromContent(normalized, context.atIndex);
        return true;
      }
    }
    deps.showNotification('No insertion target available');
    return false;
  }

  function sanitizeBuiltInDiagramFileName(value, extension, fallbackBase) {
    var raw = String(value || '').replace(/\\/g, '/').split('/').pop().trim();
    if (!raw) raw = fallbackBase;
    raw = raw.replace(/[\x00-\x1F<>:"|?*]/g, '-').trim();
    if (!raw) raw = fallbackBase;
    var lower = raw.toLowerCase();
    var normalizedExt = String(extension || '').toLowerCase();
    if (normalizedExt && lower.slice(-normalizedExt.length) !== normalizedExt) {
      raw += normalizedExt;
    }
    return raw;
  }

  function createBuiltInNamedFile(content, fileName, mimeType) {
    if (typeof File !== 'undefined') {
      return new File([content], fileName, { type: mimeType || 'application/octet-stream' });
    }
    var blob = new Blob([content], { type: mimeType || 'application/octet-stream' });
    blob.name = fileName;
    return blob;
  }

  function getBuiltInDiagramTemplateSpec(templateId) {
    if (templateId === '__builtin__:diagram:drawio') {
      return {
        displayName: 'Draw.io',
        extension: '.drawio',
        mimeType: 'application/vnd.jgraph.mxfile',
        fallbackBase: 'diagram',
        content:
          '<mxfile host="app.diagrams.net">\n' +
          '  <diagram id="diagram-1" name="Page-1">\n' +
          '    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100">\n' +
          '      <root><mxCell id="0"/><mxCell id="1" parent="0"/></root>\n' +
          '    </mxGraphModel>\n' +
          '  </diagram>\n' +
          '</mxfile>\n'
      };
    }
    if (templateId === '__builtin__:diagram:excalidraw') {
      return {
        displayName: 'Excalidraw',
        extension: '.excalidraw',
        mimeType: 'application/json',
        fallbackBase: 'diagram',
        content:
          '{\n' +
          '  "type": "excalidraw",\n' +
          '  "version": 2,\n' +
          '  "source": "https://lexera.local",\n' +
          '  "elements": [],\n' +
          '  "appState": { "viewBackgroundColor": "#ffffff", "gridSize": null },\n' +
          '  "files": {}\n' +
          '}\n'
      };
    }
    return null;
  }

  async function buildBuiltInDiagramTemplateEmbedMarkdown(templateId) {
    if (!deps.getActiveBoardId()) {
      deps.showNotification('No active board selected');
      return null;
    }
    var spec = getBuiltInDiagramTemplateSpec(templateId);
    if (!spec) return null;
    var suggestedName = spec.fallbackBase + spec.extension;
    var requestedName = window.prompt('New ' + spec.displayName + ' file name', suggestedName);
    if (requestedName === null) return null;
    var fileName = sanitizeBuiltInDiagramFileName(requestedName, spec.extension, spec.fallbackBase);
    try {
      var file = createBuiltInNamedFile(spec.content, fileName, spec.mimeType);
      var result = await LexeraApi.uploadMedia(deps.getActiveBoardId(), file);
      if (!result || !result.filename) {
        deps.showNotification('Failed to create ' + spec.displayName + ' file');
        return null;
      }
      return '![' + fileName + '](' + result.filename + ')';
    } catch (err) {
      deps.logFrontendIssue('error', 'template.builtin.diagram', 'Failed to create built-in ' + spec.displayName + ' template file', err);
      deps.showNotification('Failed to create ' + spec.displayName + ' file');
      return null;
    }
  }

  async function buildBuiltInDiagramTemplateCardContent(templateId) {
    return buildBuiltInDiagramTemplateEmbedMarkdown(templateId);
  }

  // ── Template insertion helpers ────────────────────────────────────────

  async function addRowFromContent(text, atIndex) {
    var fullBoardData = deps.getFullBoardData();
    if (!fullBoardData) return;
    if (!Array.isArray(fullBoardData.rows)) fullBoardData.rows = [];
    deps.pushUndo();
    var ts = Date.now();
    var card = { id: 'card-' + ts, content: text, checked: false };
    var newRow = {
      id: 'row-' + ts,
      title: 'New Row',
      stacks: [{ id: 'stack-' + ts, title: 'Default', columns: [{ id: 'col-' + ts, title: 'New Column', cards: [card] }] }]
    };
    deps.applyDefaultCanvasPlacementToStack(newRow, newRow.stacks[0]);
    var insertAt = (typeof atIndex === 'number' && !isNaN(atIndex)) ? deps.findInsertRowIndex(atIndex) : fullBoardData.rows.length;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > fullBoardData.rows.length) insertAt = fullBoardData.rows.length;
    fullBoardData.rows.splice(insertAt, 0, newRow);
    await deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
  }

  async function addStackFromContent(rowIdx, text, atStackIdx) {
    var row = deps.findFullDataRow(rowIdx);
    if (!row) return;
    deps.pushUndo();
    var ts = Date.now();
    var card = { id: 'card-' + ts, content: text, checked: false };
    if (!Array.isArray(row.stacks)) row.stacks = [];
    var insertAt = row.stacks.length;
    if (typeof atStackIdx === 'number' && !isNaN(atStackIdx)) {
      insertAt = deps.findInsertStackIndexInRow(row, rowIdx, atStackIdx);
      if (insertAt < 0) insertAt = row.stacks.length;
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > row.stacks.length) insertAt = row.stacks.length;
    var newStack = {
      id: 'stack-' + ts,
      title: 'New Stack',
      columns: [{ id: 'col-' + ts, title: 'New Column', cards: [card] }]
    };
    deps.applyDefaultCanvasPlacementToStack(row, newStack);
    row.stacks.splice(insertAt, 0, newStack);
    await deps.persistBoardMutation({ targets: [{ type: 'row', rowIndex: rowIdx }, { type: 'sidebar' }] });
  }

  async function addColumnFromContent(rowIdx, stackIdx, text, atColIdx) {
    var stack = deps.findFullDataStack(rowIdx, stackIdx);
    if (!stack) return;
    deps.pushUndo();
    var ts = Date.now();
    var card = { id: 'card-' + ts, content: text, checked: false };
    if (!Array.isArray(stack.columns)) stack.columns = [];
    var insertAt = stack.columns.length;
    if (typeof atColIdx === 'number' && !isNaN(atColIdx)) insertAt = atColIdx;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > stack.columns.length) insertAt = stack.columns.length;
    stack.columns.splice(insertAt, 0, { id: 'col-' + ts, title: 'New Column', cards: [card] });
    await deps.persistBoardMutation({ targets: [{ type: 'stack', rowIndex: rowIdx, stackIndex: stackIdx }, { type: 'sidebar' }] });
  }

  async function insertTemplateColumns(rowIdx, stackIdx, cols, atColIdx) {
    var stack = deps.findFullDataStack(rowIdx, stackIdx);
    if (!stack) return;
    deps.pushUndo();
    if (!Array.isArray(stack.columns)) stack.columns = [];
    var insertAt = stack.columns.length;
    if (typeof atColIdx === 'number' && !isNaN(atColIdx)) insertAt = atColIdx;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > stack.columns.length) insertAt = stack.columns.length;
    for (var i = 0; i < cols.length; i++) {
      stack.columns.splice(insertAt + i, 0, cols[i]);
    }
    await deps.persistBoardMutation({ targets: [{ type: 'stack', rowIndex: rowIdx, stackIndex: stackIdx }, { type: 'sidebar' }] });
  }

  async function insertTemplateStack(rowIdx, stack, atStackIdx) {
    var row = deps.findFullDataRow(rowIdx);
    if (!row) return;
    deps.pushUndo();
    if (!Array.isArray(row.stacks)) row.stacks = [];
    var insertAt = row.stacks.length;
    if (typeof atStackIdx === 'number' && !isNaN(atStackIdx)) {
      insertAt = deps.findInsertStackIndexInRow(row, rowIdx, atStackIdx);
      if (insertAt < 0) insertAt = row.stacks.length;
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > row.stacks.length) insertAt = row.stacks.length;
    deps.applyDefaultCanvasPlacementToStack(row, stack);
    row.stacks.splice(insertAt, 0, stack);
    await deps.persistBoardMutation({ targets: [{ type: 'row', rowIndex: rowIdx }, { type: 'sidebar' }] });
  }

  async function insertTemplateRow(atIndex, row) {
    var fullBoardData = deps.getFullBoardData();
    if (!fullBoardData) return;
    if (!Array.isArray(fullBoardData.rows)) fullBoardData.rows = [];
    deps.pushUndo();
    if (typeof atIndex !== 'number' || isNaN(atIndex)) atIndex = fullBoardData.rows.length;
    if (atIndex < 0) atIndex = 0;
    if (atIndex > fullBoardData.rows.length) atIndex = fullBoardData.rows.length;
    fullBoardData.rows.splice(atIndex, 0, row);
    await deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
  }

  async function addRow(atIndex) {
    var fullBoardData = deps.getFullBoardData();
    if (!fullBoardData) {
      deps.traceFrontendAction('warn', 'row.create', 'Aborted add row because fullBoardData is missing', {
        boardId: deps.getActiveBoardId() || null,
        atIndex: atIndex
      });
      return false;
    }
    if (!Array.isArray(fullBoardData.rows)) fullBoardData.rows = [];

    deps.pushUndo();
    var ts = Date.now();
    var newRow = {
      id: 'row-' + ts,
      title: 'New Row',
      stacks: [{ id: 'stack-' + ts, title: 'Default', columns: [{ id: 'col-' + ts, title: 'New Column', cards: [] }] }]
    };
    deps.applyDefaultCanvasPlacementToStack(newRow, newRow.stacks[0]);
    var insertAt;
    if (typeof atIndex !== 'number' || isNaN(atIndex)) {
      insertAt = fullBoardData.rows.length;
    } else {
      // atIndex is a display index — convert to fullBoardData index
      insertAt = deps.findInsertRowIndex(atIndex);
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > fullBoardData.rows.length) insertAt = fullBoardData.rows.length;
    deps.traceFrontendAction('info', 'row.create', 'Inserting new row', {
      boardId: deps.getActiveBoardId() || null,
      atIndex: insertAt,
      rowId: newRow.id,
      summaryBefore: deps.summarizeBoardHierarchy(fullBoardData)
    });
    fullBoardData.rows.splice(insertAt, 0, newRow);
    var saved = await deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
    deps.traceFrontendAction(saved ? 'info' : 'warn', 'row.create', saved ? 'Persisted new row' : 'Row persist reported failure', {
      boardId: deps.getActiveBoardId() || null,
      atIndex: atIndex,
      rowId: newRow.id,
      summaryAfter: deps.summarizeBoardHierarchy(fullBoardData)
    });
    return saved;
  }

  async function setRowHiddenTag(displayRowIdx, tag) {
    var fullBoardData = deps.getFullBoardData();
    if (!fullBoardData || !deps.getActiveBoardId()) return;
    var row = deps.findFullDataRow(displayRowIdx);
    if (!row) return;
    var nextTitle = deps.applyInternalHiddenTag(row.title || '', tag);
    if (nextTitle === row.title) return;
    deps.pushUndo();
    row.title = nextTitle;
    // Hiding a row removes it from view — board-level structural change
    await deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
  }

  async function deleteRow(rowIdx) {
    deps.traceFrontendAction('info', 'row.delete', 'deleteRow called', { rowIdx: rowIdx });
    var row = deps.findFullDataRow(rowIdx);
    if (!row) {
      deps.traceFrontendAction('warn', 'row.delete', 'findFullDataRow returned null', { rowIdx: rowIdx });
      return;
    }
    var visibleCards = 0;
    for (var s = 0; s < row.stacks.length; s++) {
      for (var c = 0; c < row.stacks[s].columns.length; c++) {
        var cards = row.stacks[s].columns[c].cards || [];
        for (var k = 0; k < cards.length; k++) {
          if (!deps.is_archived_or_deleted(cards[k].content || '')) visibleCards++;
        }
      }
    }
    if (visibleCards > 0) {
      var confirmed = await deps.showConfirmDialog('Move row "' + deps.stripInternalHiddenTags(row.title || '') + '" and ' + visibleCards + ' card(s) to trash?');
      if (!confirmed) return;
    }
    await setRowHiddenTag(rowIdx, '#hidden-internal-deleted');
  }

  async function duplicateRow(rowIdx) {
    var fullBoardData = deps.getFullBoardData();
    if (!fullBoardData || !deps.getActiveBoardId()) return;
    var row = deps.findFullDataRow(rowIdx);
    if (!row) return;
    deps.pushUndo();
    var clone = structuredClone(row);
    var ts = Date.now();
    clone.id = 'row-' + ts;
    for (var s = 0; s < clone.stacks.length; s++) {
      clone.stacks[s].id = 'stack-' + ts + '-' + s;
      for (var c = 0; c < clone.stacks[s].columns.length; c++) {
        clone.stacks[s].columns[c].id = 'col-' + ts + '-' + s + '-' + c;
        for (var k = 0; k < clone.stacks[s].columns[c].cards.length; k++) {
          clone.stacks[s].columns[c].cards[k].id = 'dup-' + ts + '-' + s + '-' + c + '-' + k;
          clone.stacks[s].columns[c].cards[k].kid = null;
        }
      }
    }
    var fullRowIdx = fullBoardData.rows.indexOf(row);
    if (fullRowIdx === -1) fullRowIdx = fullBoardData.rows.length - 1;
    fullBoardData.rows.splice(fullRowIdx + 1, 0, clone);
    await deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
  }

  async function addStackToRow(rowIdx, atStackIdx, options) {
    if (atStackIdx && typeof atStackIdx === 'object' && !Array.isArray(atStackIdx)) {
      options = atStackIdx;
      atStackIdx = undefined;
    }
    options = options || {};

    var row = deps.findFullDataRow(rowIdx);
    if (!row) {
      deps.traceFrontendAction('warn', 'stack.create', 'Aborted add stack because row could not be resolved', {
        boardId: deps.getActiveBoardId() || null,
        rowIdx: rowIdx,
        atStackIdx: atStackIdx,
        options: options
      });
      return false;
    }
    if (!Array.isArray(row.stacks)) row.stacks = [];
    deps.pushUndo();
    var ts = Date.now();
    var newStack = {
      id: 'stack-' + ts,
      title: 'New Stack',
      columns: [{ id: 'col-' + ts, title: 'New Column', cards: [] }]
    };
    var explicitCanvasPosition = options && options.canvasPosition ? options.canvasPosition : null;
    var explicitCanvasX = explicitCanvasPosition ? Number(explicitCanvasPosition.x) : NaN;
    var explicitCanvasY = explicitCanvasPosition ? Number(explicitCanvasPosition.y) : NaN;
    if (deps.isCanvasBoardLayout() && isFinite(explicitCanvasX) && isFinite(explicitCanvasY)) {
      if (!newStack.params || typeof newStack.params !== 'object') newStack.params = {};
      newStack.params.x = String(Math.round(explicitCanvasX));
      newStack.params.y = String(Math.round(explicitCanvasY));
    } else {
      deps.applyDefaultCanvasPlacementToStack(row, newStack);
    }
    var insertAt = row.stacks.length;
    if (typeof atStackIdx === 'number' && !isNaN(atStackIdx)) {
      // atStackIdx is a display index — convert to fullBoardData index
      insertAt = deps.findInsertStackIndexInRow(row, rowIdx, atStackIdx);
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > row.stacks.length) insertAt = row.stacks.length;
    deps.traceFrontendAction('info', 'stack.create', 'Inserting new stack', {
      boardId: deps.getActiveBoardId() || null,
      rowIdx: rowIdx,
      rowId: row.id || null,
      rowTitle: row.title || '',
      insertAt: insertAt,
      stackId: newStack.id,
      canvasPosition: deps.isCanvasBoardLayout() ? { x: newStack.params && newStack.params.x, y: newStack.params && newStack.params.y } : null
    });
    row.stacks.splice(insertAt, 0, newStack);
    var saved = await deps.persistBoardMutation({ targets: [{ type: 'row', rowIndex: rowIdx }, { type: 'sidebar' }] });
    deps.traceFrontendAction(saved ? 'info' : 'warn', 'stack.create', saved ? 'Persisted new stack' : 'Stack persist reported failure', {
      boardId: deps.getActiveBoardId() || null,
      rowIdx: rowIdx,
      rowId: row.id || null,
      insertAt: insertAt,
      stackId: newStack.id
    });
    return saved;
  }

  async function setStackHiddenTag(displayRowIdx, displayStackIdx, tag) {
    var fullBoardData = deps.getFullBoardData();
    if (!fullBoardData || !deps.getActiveBoardId()) return;
    var stack = deps.findFullDataStack(displayRowIdx, displayStackIdx);
    if (!stack) return;
    var nextTitle = deps.applyInternalHiddenTag(stack.title || '', tag);
    if (nextTitle === stack.title) return;
    deps.pushUndo();
    stack.title = nextTitle;
    await deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
  }

  async function deleteStack(rowIdx, stackIdx) {
    deps.traceFrontendAction('info', 'stack.delete', 'deleteStack called', { rowIdx: rowIdx, stackIdx: stackIdx });
    var row = deps.findFullDataRow(rowIdx);
    var stack = deps.findFullDataStack(rowIdx, stackIdx);
    if (!row || !stack) {
      deps.traceFrontendAction('warn', 'stack.delete', 'findFullDataRow/Stack returned null', { rowIdx: rowIdx, stackIdx: stackIdx });
      return;
    }
    var visibleCards = 0;
    for (var c = 0; c < stack.columns.length; c++) {
      var cards = stack.columns[c].cards || [];
      for (var k = 0; k < cards.length; k++) {
        if (!deps.is_archived_or_deleted(cards[k].content || '')) visibleCards++;
      }
    }
    if (visibleCards > 0) {
      var confirmed = await deps.showConfirmDialog('Move stack "' + deps.stripInternalHiddenTags(stack.title || '') + '" and ' + visibleCards + ' card(s) to trash?');
      if (!confirmed) return;
    }
    await setStackHiddenTag(rowIdx, stackIdx, '#hidden-internal-deleted');
  }

  async function duplicateStack(rowIdx, stackIdx) {
    var fullBoardData = deps.getFullBoardData();
    if (!fullBoardData || !deps.getActiveBoardId()) return;
    var row = deps.findFullDataRow(rowIdx);
    var stack = deps.findFullDataStack(rowIdx, stackIdx);
    if (!row || !stack) return;
    deps.pushUndo();
    var clone = structuredClone(stack);
    var ts = Date.now();
    clone.id = 'stack-' + ts;
    for (var c = 0; c < clone.columns.length; c++) {
      clone.columns[c].id = 'col-' + ts + '-' + c;
      for (var k = 0; k < clone.columns[c].cards.length; k++) {
        clone.columns[c].cards[k].id = 'dup-' + ts + '-' + c + '-' + k;
        clone.columns[c].cards[k].kid = null;
      }
    }
    // stackIdx is a display index — find the fullBoardData index of the source
    // stack and insert the clone right after it.
    var fullStackIdx = deps.findFullDataStackIndex(row, rowIdx, stackIdx);
    if (fullStackIdx === -1) fullStackIdx = row.stacks.length - 1;
    row.stacks.splice(fullStackIdx + 1, 0, clone);
    await deps.persistBoardMutation({ targets: [{ type: 'row', rowIndex: rowIdx }, { type: 'sidebar' }] });
  }

  async function addColumnToStack(rowIdx, stackIdx, atColIdx) {

    var stack = deps.findFullDataStack(rowIdx, stackIdx);
    if (!stack) {
      deps.traceFrontendAction('warn', 'column.create', 'Aborted add column because stack could not be resolved', {
        boardId: deps.getActiveBoardId() || null,
        rowIdx: rowIdx,
        stackIdx: stackIdx,
        atColIdx: atColIdx
      });
      return false;
    }
    if (!Array.isArray(stack.columns)) stack.columns = [];
    deps.pushUndo();
    var insertAt = stack.columns.length;
    if (typeof atColIdx === 'number' && !isNaN(atColIdx)) insertAt = atColIdx;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > stack.columns.length) insertAt = stack.columns.length;
    var newColumn = { id: 'col-' + Date.now(), title: 'New Column', cards: [] };
    deps.traceFrontendAction('info', 'column.create', 'Inserting new column into stack', {
      boardId: deps.getActiveBoardId() || null,
      rowIdx: rowIdx,
      stackIdx: stackIdx,
      stackId: stack.id || null,
      stackTitle: stack.title || '',
      insertAt: insertAt,
      columnId: newColumn.id,
      stackColumnCountBefore: stack.columns.length
    });
    stack.columns.splice(insertAt, 0, newColumn);
    var saved = await deps.persistBoardMutation({ targets: [{ type: 'stack', rowIndex: rowIdx, stackIndex: stackIdx }, { type: 'sidebar' }] });
    deps.traceFrontendAction(saved ? 'info' : 'warn', 'column.create', saved ? 'Persisted new column in stack' : 'Column persist reported failure', {
      boardId: deps.getActiveBoardId() || null,
      rowIdx: rowIdx,
      stackIdx: stackIdx,
      stackId: stack.id || null,
      insertAt: insertAt,
      columnId: newColumn.id,
      stackColumnCountAfter: stack.columns.length
    });
    return saved;
  }

  // ── Public API ────────────────────────────────────────────────────────

  function init(injected) {
    deps = injected;
  }

  return {
    init: init,
    closeRowStackMenu: closeRowStackMenu,
    showRowContextMenu: showRowContextMenu,
    showStackContextMenu: showStackContextMenu,
    showCanvasBackgroundContextMenu: showCanvasBackgroundContextMenu,
    showElementContextMenu: showElementContextMenu,
    buildEnrichedContext: buildEnrichedContext,
    normalizeCreationContextForEntity: normalizeCreationContextForEntity,
    buildContextMenuItemsAndContext: buildContextMenuItemsAndContext,
    renameRowOrStack: renameRowOrStack,
    loadTemplatesOnce: loadTemplatesOnce,
    renderCreationSource: renderCreationSource,
    handleCreationAction: handleCreationAction,
    insertTextContentForEntity: insertTextContentForEntity,
    sanitizeBuiltInDiagramFileName: sanitizeBuiltInDiagramFileName,
    createBuiltInNamedFile: createBuiltInNamedFile,
    getBuiltInDiagramTemplateSpec: getBuiltInDiagramTemplateSpec,
    buildBuiltInDiagramTemplateEmbedMarkdown: buildBuiltInDiagramTemplateEmbedMarkdown,
    buildBuiltInDiagramTemplateCardContent: buildBuiltInDiagramTemplateCardContent,
    addRowFromContent: addRowFromContent,
    addStackFromContent: addStackFromContent,
    addColumnFromContent: addColumnFromContent,
    insertTemplateColumns: insertTemplateColumns,
    insertTemplateStack: insertTemplateStack,
    insertTemplateRow: insertTemplateRow,
    addRow: addRow,
    setRowHiddenTag: setRowHiddenTag,
    deleteRow: deleteRow,
    duplicateRow: duplicateRow,
    addStackToRow: addStackToRow,
    setStackHiddenTag: setStackHiddenTag,
    deleteStack: deleteStack,
    duplicateStack: duplicateStack,
    addColumnToStack: addColumnToStack,
    getActiveRowStackMenu: function () { return activeRowStackMenu; }
  };
})();
window.LexeraRowStackMenu = LexeraRowStackMenu;
