var ContextMenuBuilders = (function () {
  'use strict';

  var deps = {};

  // ── Tag category menu constants ────────────────────────────────────────

  var TAG_CATEGORY_MENU_ORDER = [
    'special',
    'importance',
    'status',
    'priority',
    'moscow',
    'positivity',
    'type',
    'category',
    'colors',
    'colors-dark',
    'colors-light',
    'colors-accessible',
    'workflow',
    'organization',
    'teaching-content',
    'product-content',
    'complexity',
    'status-review',
    'time-estimate',
    'status-testing',
    'teaching-platform',
    'product-platform',
    'version',
    'impact',
    'schedule',
    'overview',
    'example',
    'deliveries'
  ];

  var TAG_CATEGORY_MENU_LABELS = {
    special: 'Special',
    importance: 'Importance',
    status: 'Status',
    priority: 'Priority',
    moscow: 'MoSCoW',
    positivity: 'Positivity',
    type: 'Type',
    category: 'Category',
    colors: 'Colors',
    'colors-dark': 'Colors Dark',
    'colors-light': 'Colors Light',
    'colors-accessible': 'Colors Accessible',
    impact: 'Impact',
    workflow: 'Workflow',
    organization: 'Organization',
    'teaching-content': 'Teaching Content',
    'product-content': 'Product Content',
    complexity: 'Complexity',
    'status-review': 'Status Review',
    'time-estimate': 'Time Estimate',
    'status-testing': 'Status Testing',
    'teaching-platform': 'Teaching Platform',
    'product-platform': 'Product Platform',
    version: 'Version',
    schedule: 'Schedule',
    overview: 'Overview',
    example: 'Example',
    deliveries: 'Deliveries'
  };

  // ── Tag submenu builders ───────────────────────────────────────────────

  function buildTagSubmenu(label, tags, text, idPrefix) {
    var items = [];
    for (var i = 0; i < tags.length; i++) {
      var tagName = '#' + tags[i];
      var active = deps.hasTag(text, tagName);
      items.push({
        id: idPrefix + tags[i],
        label: (active ? '\u2713 ' : '') + tagName
      });
    }
    return { id: idPrefix + '_sub', label: label, items: items };
  }

  // Default tag groups shown per entity type
  var DEFAULT_TAG_GROUPS = {
    card:   ['special', 'status', 'priority', 'type', 'category', 'moscow', 'positivity', 'complexity', 'time-estimate', 'colors'],
    column: ['special', 'status', 'priority', 'type'],
    stack:  ['special', 'status', 'priority'],
    row:    ['special', 'status', 'priority']
  };

  function getTagGroupsForScope(scope) {
    try {
      var stored = localStorage.getItem('lexera-tag-groups-' + scope);
      if (stored) {
        var parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return DEFAULT_TAG_GROUPS[scope] || TAG_CATEGORY_MENU_ORDER;
  }

  function setTagGroupsForScope(scope, groups) {
    try {
      localStorage.setItem('lexera-tag-groups-' + scope, JSON.stringify(groups));
    } catch (_) {}
  }

  function buildTagCategorySubmenus(text, idPrefix, order) {
    var categoryOrder = Array.isArray(order) && order.length > 0 ? order : TAG_CATEGORY_MENU_ORDER;
    var items = [];
    for (var i = 0; i < categoryOrder.length; i++) {
      var key = categoryOrder[i];
      var tags = deps.TAG_CATEGORIES[key];
      if (!Array.isArray(tags) || tags.length === 0) continue;
      var label = TAG_CATEGORY_MENU_LABELS[key] || key;
      items.push(buildTagSubmenu(label, tags, text, idPrefix + 'cat-' + key + '-'));
    }
    return items;
  }

  function buildCustomTagsSubmenu(text, idPrefix) {
    var allTags = deps.extractAllTags(text);
    var knownTags = {};
    var catKeys = Object.keys(deps.TAG_CATEGORIES);
    for (var c = 0; c < catKeys.length; c++) {
      var arr = deps.TAG_CATEGORIES[catKeys[c]];
      for (var t = 0; t < arr.length; t++) knownTags['#' + arr[t]] = true;
    }
    var custom = [];
    for (var i = 0; i < allTags.length; i++) {
      var tag = allTags[i];
      if (knownTags[tag]) continue;
      if (/^#hidden-internal-/.test(tag)) continue;
      if (deps.isLayoutTagName(tag)) continue;
      custom.push(tag);
    }
    if (custom.length === 0) return null;
    var items = [];
    for (var j = 0; j < custom.length; j++) {
      items.push({ id: idPrefix + custom[j].replace(/^#/, ''), label: '\u2713 ' + custom[j] });
    }
    return { id: idPrefix + '_sub', label: 'Custom Tags', items: items };
  }

  // ── Marp submenu builders ──────────────────────────────────────────────

  function buildMarpDirectiveValueSubmenu(headerText, directive) {
    var localValue = deps.getMarpDirectiveValueFromHeader(headerText, directive.key, 'local');
    var scopedValue = deps.getMarpDirectiveValueFromHeader(headerText, directive.key, 'scoped');
    return {
      id: 'marp-directive-group:' + directive.key,
      label: directive.label,
      items: [
        {
          id: 'marp-directive-set-local:' + directive.key,
          label: (localValue ? 'Edit Local\u2026 (' + deps.truncateMarpDirectiveValue(localValue) + ')' : 'Set Local\u2026')
        },
        {
          id: 'marp-directive-clear-local:' + directive.key,
          label: 'Clear Local',
          disabled: !localValue
        },
        { separator: true },
        {
          id: 'marp-directive-set-scoped:' + directive.key,
          label: (scopedValue ? 'Edit Scoped\u2026 (' + deps.truncateMarpDirectiveValue(scopedValue) + ')' : 'Set Scoped\u2026')
        },
        {
          id: 'marp-directive-clear-scoped:' + directive.key,
          label: 'Clear Scoped',
          disabled: !scopedValue
        }
      ]
    };
  }

  function buildMarpClassScopeSubmenu(headerText, classScope) {
    var classes = deps.getAvailableMarpClassNames(headerText);
    var items = [];
    for (var i = 0; i < classes.length; i++) {
      var className = classes[i];
      items.push({
        id: 'marp-class-' + classScope + ':' + className,
        label: deps.formatMenuToggleLabel(deps.getMarpClassListFromHeader(headerText, classScope).indexOf(className) !== -1, className)
      });
    }
    if (items.length > 0) items.push({ separator: true });
    items.push({ id: 'marp-class-custom-' + classScope, label: 'Toggle Custom Class\u2026' });
    items.push({
      id: 'marp-class-clear-' + classScope,
      label: 'Clear ' + (classScope === 'scoped' ? 'Scoped' : 'Local') + ' Classes',
      disabled: deps.getMarpClassListFromHeader(headerText, classScope).length === 0
    });
    return {
      id: 'marp-class-group-' + classScope,
      label: classScope === 'scoped' ? 'Scoped Classes' : 'Local Classes',
      items: items
    };
  }

  function buildMarpMenuItems(headerText) {
    if (!deps.isMarpSettingsEnabled()) return [];
    var currentHeader = String(headerText || '');
    return [
      { separator: true },
      {
        id: 'marp-classes',
        label: 'Marp Classes',
        items: [
          { id: 'marp-classes-refresh', label: 'Refresh Available Classes' },
          { separator: true },
          buildMarpClassScopeSubmenu(currentHeader, 'local'),
          buildMarpClassScopeSubmenu(currentHeader, 'scoped')
        ]
      },
      {
        id: 'marp-colors',
        label: 'Marp Colors',
        items: deps.MARP_COLOR_DIRECTIVES.map(function (directive) {
          return buildMarpDirectiveValueSubmenu(currentHeader, directive);
        })
      },
      {
        id: 'marp-hf',
        label: 'Marp Header & Footer',
        items: [
          buildMarpDirectiveValueSubmenu(currentHeader, deps.MARP_TEXT_DIRECTIVES[0]),
          buildMarpDirectiveValueSubmenu(currentHeader, deps.MARP_TEXT_DIRECTIVES[1]),
          { separator: true },
          { id: 'marp-paginate-local', label: deps.formatMenuToggleLabel(deps.hasMarpDirectiveValue(currentHeader, 'paginate', 'local', 'true'), 'Paginate (Local)') },
          { id: 'marp-paginate-scoped', label: deps.formatMenuToggleLabel(deps.hasMarpDirectiveValue(currentHeader, 'paginate', 'scoped', 'true'), 'Paginate (Scoped)') }
        ]
      }
    ];
  }

  // ── Registration ───────────────────────────────────────────────────────

  function registerAll() {
    var MCR = deps.MenuContributorRegistry;

    // Card header: add card
    MCR.register({
      id: 'core-card-header', scopes: ['card'], priority: 5, section: 'header',
      build: function () {
        return [
          { id: 'add-card', label: 'Add card' },
          { id: 'insert-after', label: 'Add card after' }
        ];
      }
    });
    // Card edit section
    MCR.register({
      id: 'core-card-edit', scopes: ['card'], priority: 10, section: 'edit',
      build: function () {
        return [
          { id: 'edit', label: 'Edit task (inline)' },
          { id: 'edit-overlay', label: 'Edit task (overlay)', disabled: !deps.isOverlayEditorEnabled() },
          { id: 'reveal', label: 'Reveal content' },
          { id: 'copy-markdown', label: 'Copy as markdown' }
        ];
      }
    });
    // Rename (column, row, stack)
    MCR.register({
      id: 'core-rename', scopes: ['column', 'row', 'stack'], priority: 5, section: 'header',
      build: function (scope) {
        return [{ id: 'rename', label: 'Rename ' + scope }];
      }
    });
    // Add items (column, row, stack)
    MCR.register({
      id: 'core-add', scopes: ['column', 'row', 'stack'], priority: 7, section: 'header',
      build: function (scope) {
        if (scope === 'column') return [
          { id: 'add-card', label: 'Add card' },
          { id: 'add-card-top', label: 'Add card at top' },
          { id: 'paste-as-card', label: 'Paste as card' },
          { id: 'add-after', label: 'Add column after' }
        ];
        if (scope === 'row') return [
          { id: 'add-stack', label: 'Add stack' },
          { id: 'add-row-after', label: 'Add row after' }
        ];
        if (scope === 'stack') return [
          { id: 'add-sub', label: 'Add', items: [
            { id: 'add-column', label: 'Column' },
            { id: 'add-stack-before', label: 'Stack before' },
            { id: 'add-stack-after', label: 'Stack after' }
          ]}
        ];
        return null;
      }
    });
    MCR.register({
      id: 'core-canvas-background', scopes: ['canvas'], priority: 5, section: 'header',
      build: function (scope, ctx) {
        if (!ctx || !isFinite(ctx.rowIdx)) return null;
        return [
          { id: 'add-stack-here', label: 'Create stack here' }
        ];
      }
    });
    // Structure: reveal, insert, duplicate (all scopes)
    MCR.register({
      id: 'core-structure', scopes: ['card', 'column', 'row', 'stack'], priority: 20, section: 'structure',
      build: function (scope, ctx) {
        if (scope === 'card') return [
          { id: 'insert-before', label: 'Insert card before' },
          { id: 'insert-after', label: 'Insert card after' },
          { id: 'duplicate', label: 'Duplicate card' },
          { id: 'move-up', label: 'Move up', disabled: ctx.cardIndex <= 0 },
          { id: 'move-down', label: 'Move down', disabled: ctx.visibleCardCount <= 0 || ctx.cardIndex >= (ctx.visibleCardCount - 1) },
          { id: 'move-top', label: 'Move to top', disabled: ctx.cardIndex <= 0 },
          { id: 'move-bottom', label: 'Move to bottom', disabled: ctx.visibleCardCount <= 0 || ctx.cardIndex >= (ctx.visibleCardCount - 1) }
        ];
        var items = [{ id: 'reveal-all', label: 'Reveal all' }];
        if (scope === 'column') {
          items.push({ id: 'add-before', label: 'Insert column before' });
          items.push({ id: 'add-after', label: 'Insert column after' });
          items.push({ id: 'duplicate', label: 'Duplicate column' });
        } else if (scope === 'row') {
          items.push({ id: 'add-row-before', label: 'Insert row before' });
          items.push({ id: 'add-row-after', label: 'Insert row after' });
          items.push({ id: 'duplicate', label: 'Duplicate row' });
        } else if (scope === 'stack') {
          items.push({ id: 'add-stack-before', label: 'Insert stack before' });
          items.push({ id: 'add-stack-after', label: 'Insert stack after' });
          items.push({ id: 'duplicate', label: 'Duplicate stack' });
        }
        return items;
      }
    });
    // Fold/unfold (column only)
    MCR.register({
      id: 'core-fold', scopes: ['column'], priority: 25, section: 'fold',
      build: function () {
        if (deps.isCanvasBoardLayout()) return [];
        return [
          { id: 'fold-all', label: 'Fold all cards' },
          { id: 'unfold-all', label: 'Unfold all cards' }
        ];
      }
    });
    // Visibility: park, archive, delete (all scopes)
    MCR.register({
      id: 'core-visibility', scopes: ['card', 'column', 'row', 'stack'], priority: 30, section: 'visibility',
      build: function (scope) {
        var items = [
          { id: 'park', label: 'Park ' + scope }
        ];
        if (scope === 'card') items.push({ id: 'park-copy', label: 'Park copy' });
        items.push({ id: 'archive', label: 'Archive ' + scope });
        items.push({ id: 'delete', label: 'Delete ' + scope });
        return items;
      }
    });
    // Sort (column, row, stack)
    MCR.register({
      id: 'core-sort', scopes: ['column', 'row', 'stack'], priority: 35, section: 'sort',
      build: function (scope, ctx) {
        if (scope === 'column') {
          var ci = ctx.colIndex;
          var ss = ctx.columnSortState || {};
          return [{ id: 'sort-sub', label: 'Sort by', items: [
            { id: 'sort-title', label: 'Title' + (ss[ci + ':title'] ? (ss[ci + ':title'] === 'asc' ? ' \u2191' : ' \u2193') : '') },
            { id: 'sort-tag', label: 'Tag Value' + (ss[ci + ':tag'] ? (ss[ci + ':tag'] === 'asc' ? ' \u2191' : ' \u2193') : '') },
            { id: 'sort-duedate', label: 'Due Date' + (ss[ci + ':duedate'] ? (ss[ci + ':duedate'] === 'asc' ? ' \u2191' : ' \u2193') : '') }
          ]}];
        }
        return [{ id: 'sort-sub', label: 'Sort all cards', items: [
          { id: 'sort-title', label: 'Title' },
          { id: 'sort-tag', label: 'Tag Value' },
          { id: 'sort-duedate', label: 'Due Date' }
        ]}];
      }
    });
    // Tag operations (all scopes)
    MCR.register({
      id: 'core-tag-ops', scopes: ['card', 'column', 'row', 'stack'], priority: 40, section: 'tags',
      build: function () {
        return [
          { id: 'tag-add', label: 'Add Tag...' },
          { id: 'tag-remove', label: 'Remove Tag...' },
          { id: 'tag-clear', label: 'Clear Tags' }
        ];
      }
    });
    // Move-to submenus (card, column)
    MCR.register({
      id: 'core-move-to', scopes: ['card', 'column'], priority: 45, section: 'move-to',
      build: function (scope, ctx) {
        if (scope === 'card') {
          var cols = ctx.boardColumns || [];
          var moveSubItems = [];
          for (var i = 0; i < cols.length; i++) {
            if (!cols[i] || cols[i].index === ctx.colIndex) continue;
            var lbl = deps.stripLayoutTags(deps.stripInternalHiddenTags(cols[i].title || ''));
            moveSubItems.push({ id: 'move-to:' + cols[i].index, label: lbl || 'Untitled Column' });
          }
          if (moveSubItems.length === 0) return null;
          var items = [{ id: 'move-sub', label: 'Move to Column', items: moveSubItems }];
          var dupToItems = [];
          for (var di = 0; di < moveSubItems.length; di++) {
            dupToItems.push({ id: 'dup-to:' + moveSubItems[di].id.substring(8), label: moveSubItems[di].label });
          }
          items.push({ id: 'dup-to-sub', label: 'Duplicate to Column', items: dupToItems });
          return items;
        }
        if (scope === 'column') {
          var rows = ctx.boardRows || [];
          var stackMoveItems = [];
          for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            if (!row || !Array.isArray(row.stacks)) continue;
            var rowLabel = deps.stripHtmlComments(deps.stripInternalHiddenTags(row.title || '')) || 'Row ' + (r + 1);
            for (var s = 0; s < row.stacks.length; s++) {
              if (ctx.rowIdx === r && ctx.stackIdx === s) continue;
              var stack = row.stacks[s];
              if (!stack) continue;
              var stackLabel = deps.stripHtmlComments(deps.stripInternalHiddenTags(stack.title || '')) || 'Stack ' + (s + 1);
              stackMoveItems.push({ id: 'move-to-stack-' + r + '-' + s, label: rowLabel + ' / ' + stackLabel });
            }
          }
          if (stackMoveItems.length === 0) return null;
          return [{ id: 'move-sub', label: 'Move to Stack', items: stackMoveItems }];
        }
        return null;
      }
    });
    // Tag category submenus + custom tags (all scopes)
    // Filtered by per-entity-type config stored in localStorage
    MCR.register({
      id: 'core-tag-categories', scopes: ['card', 'column', 'row', 'stack'], priority: 50, section: 'tag-categories',
      build: function (scope, ctx) {
        var text = ctx.elementText || '';
        var enabledGroups = getTagGroupsForScope(scope);
        var items = buildTagCategorySubmenus(text, 'tag-', enabledGroups);
        var customSub = buildCustomTagsSubmenu(text, 'tag-custom-');
        if (customSub) items.push(customSub);
        return items.length > 0 ? items : null;
      }
    });
    // Marp directives (all scopes)
    MCR.register({
      id: 'marp-directives', scopes: ['card', 'column', 'row', 'stack'], priority: 55, section: 'marp',
      build: function (scope, ctx) {
        var items = buildMarpMenuItems(ctx.elementText || '');
        return items.length > 0 ? items : null;
      }
    });
    // Layout: width/span, stacked (column only)
    MCR.register({
      id: 'core-layout', scopes: ['column'], priority: 60, section: 'layout',
      build: function (scope, ctx) {
        var cs = ctx.currentSpan || 1;
        return [
          { id: 'width-sub', label: 'Width (span ' + cs + ')', items: [
            { id: 'set-span-1', label: (cs === 1 ? '\u2713 ' : '') + 'Span 1 (default)' },
            { id: 'set-span-2', label: (cs === 2 ? '\u2713 ' : '') + 'Span 2' },
            { id: 'set-span-3', label: (cs === 3 ? '\u2713 ' : '') + 'Span 3' },
            { id: 'set-span-4', label: (cs === 4 ? '\u2713 ' : '') + 'Span 4' }
          ]},
          { id: 'toggle-stacked', label: (ctx.isStacked ? '\u2713 ' : '') + 'Stacked column' }
        ];
      }
    });
    // Copy/export (column, row, stack)
    MCR.register({
      id: 'core-copy-export', scopes: ['column', 'row', 'stack'], priority: 65, section: 'copy-export',
      build: function (scope) {
        return [
          { id: 'copy-markdown', label: 'Copy as markdown' },
          { id: 'export-' + scope, label: 'Export ' + scope }
        ];
      }
    });
    // Include file options (column only)
    MCR.register({
      id: 'core-include', scopes: ['column'], priority: 70, section: 'include',
      build: function (scope, ctx) {
        if (ctx.includePath) {
          return [
            { id: 'preview-include', label: 'Preview Include File' },
            { id: 'open-include', label: 'Open Include in System App' },
            { id: 'edit-include', label: 'Edit Include File' },
            { id: 'disable-include', label: 'Disable Include Mode' }
          ];
        }
        return [{ id: 'enable-include', label: 'Enable Include Mode' }];
      }
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────

  function init(d) {
    deps = d || {};
    registerAll();
  }

  return {
    init: init,
    buildTagSubmenu: buildTagSubmenu,
    buildTagCategorySubmenus: buildTagCategorySubmenus,
    buildCustomTagsSubmenu: buildCustomTagsSubmenu,
    buildMarpDirectiveValueSubmenu: buildMarpDirectiveValueSubmenu,
    buildMarpClassScopeSubmenu: buildMarpClassScopeSubmenu,
    buildMarpMenuItems: buildMarpMenuItems,
    getTagGroupsForScope: getTagGroupsForScope,
    setTagGroupsForScope: setTagGroupsForScope,
    TAG_CATEGORY_MENU_ORDER: TAG_CATEGORY_MENU_ORDER,
    TAG_CATEGORY_MENU_LABELS: TAG_CATEGORY_MENU_LABELS,
    DEFAULT_TAG_GROUPS: DEFAULT_TAG_GROUPS
  };
})();
window.ContextMenuBuilders = ContextMenuBuilders;
