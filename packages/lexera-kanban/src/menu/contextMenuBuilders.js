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

    // ── CARD ─────────────────────────────────────────────────────────
    MCR.register({
      id: 'card-actions', scopes: ['card'], priority: 5, section: 'actions',
      build: function () {
        return [
          { id: 'insert-before', label: 'Add card before' },
          { id: 'insert-after', label: 'Add card after' },
          { id: 'duplicate', label: 'Duplicate card' },
          { separator: true },
          { id: 'copy-markdown', label: 'Copy as markdown' },
          { id: 'copy-html', label: 'Copy as formatted' },
          { separator: true },
          { id: 'edit', label: 'Edit inline' },
          { id: 'edit-overlay', label: 'Edit overlay' },
          { separator: true },
          { id: 'park', label: 'Park card' },
          { id: 'park-copy', label: 'Park copy' },
          { id: 'archive', label: 'Archive' },
          { id: 'delete', label: 'Delete' }
        ];
      }
    });
    MCR.register({
      id: 'card-tags', scopes: ['card'], priority: 50, section: 'tag-categories',
      build: function (scope, ctx) {
        var text = ctx.elementText || '';
        var items = [{ id: 'tag-clear', label: 'Clear tags' }];
        var enabledGroups = getTagGroupsForScope('card');
        var tagItems = buildTagCategorySubmenus(text, 'tag-', enabledGroups);
        var customSub = buildCustomTagsSubmenu(text, 'tag-custom-');
        if (customSub) tagItems.push(customSub);
        if (tagItems.length > 0) items = items.concat(tagItems);
        return items;
      }
    });
    MCR.register({
      id: 'card-marp', scopes: ['card'], priority: 55, section: 'marp',
      build: function (scope, ctx) {
        var items = buildMarpMenuItems(ctx.elementText || '');
        return items.length > 0 ? items : null;
      }
    });

    // ── COLUMN ──────────────────────────────────────────────────────
    MCR.register({
      id: 'column-actions', scopes: ['column'], priority: 5, section: 'actions',
      build: function (scope, ctx) {
        return [
          { id: 'rename', label: 'Rename column' },
          { id: 'add-card', label: 'Add card' },
          { id: 'add-after', label: 'Add column after' },
          { id: 'duplicate', label: 'Duplicate column' },
          { separator: true },
          { id: 'copy-markdown', label: 'Copy as markdown' },
          { id: 'export-column', label: 'Export column' },
          { separator: true },
          { id: 'sort-sub', label: 'Sort by', items: (function () {
            var ci = ctx.colIndex;
            var ss = ctx.columnSortState || {};
            return [
              { id: 'sort-title', label: 'Title' + (ss[ci + ':title'] ? (ss[ci + ':title'] === 'asc' ? ' \u2191' : ' \u2193') : '') },
              { id: 'sort-tag', label: 'Tag Value' + (ss[ci + ':tag'] ? (ss[ci + ':tag'] === 'asc' ? ' \u2191' : ' \u2193') : '') },
              { id: 'sort-duedate', label: 'Due Date' + (ss[ci + ':duedate'] ? (ss[ci + ':duedate'] === 'asc' ? ' \u2191' : ' \u2193') : '') }
            ];
          })() },
          { separator: true },
          { id: 'park', label: 'Park column' },
          { id: 'archive', label: 'Archive column' },
          { id: 'delete', label: 'Delete column' }
        ];
      }
    });
    MCR.register({
      id: 'column-include', scopes: ['column'], priority: 10, section: 'include',
      build: function (scope, ctx) {
        if (ctx.includePath) {
          return [
            { id: 'preview-include', label: 'Preview include file' },
            { id: 'open-include', label: 'Open include in system app' },
            { id: 'edit-include', label: 'Edit include file' },
            { id: 'disable-include', label: 'Disable include mode' }
          ];
        }
        return [{ id: 'enable-include', label: 'Enable include mode' }];
      }
    });
    MCR.register({
      id: 'column-tags', scopes: ['column'], priority: 50, section: 'tag-categories',
      build: function (scope, ctx) {
        var text = ctx.elementText || '';
        var items = [{ id: 'tag-clear', label: 'Clear tags' }];
        var enabledGroups = getTagGroupsForScope('column');
        var tagItems = buildTagCategorySubmenus(text, 'tag-', enabledGroups);
        var customSub = buildCustomTagsSubmenu(text, 'tag-custom-');
        if (customSub) tagItems.push(customSub);
        if (tagItems.length > 0) items = items.concat(tagItems);
        return items;
      }
    });
    MCR.register({
      id: 'column-marp', scopes: ['column'], priority: 55, section: 'marp',
      build: function (scope, ctx) {
        var items = buildMarpMenuItems(ctx.elementText || '');
        return items.length > 0 ? items : null;
      }
    });

    // ── STACK ────────────────────────────────────────────────────────
    MCR.register({
      id: 'stack-actions', scopes: ['stack'], priority: 5, section: 'actions',
      build: function () {
        return [
          { id: 'rename', label: 'Rename stack' },
          { id: 'add-column', label: 'Add column' },
          { id: 'add-stack-before', label: 'Add stack before' },
          { id: 'add-stack-after', label: 'Add stack after' },
          { id: 'duplicate', label: 'Duplicate stack' },
          { separator: true },
          { id: 'copy-markdown', label: 'Copy as markdown' },
          { id: 'export-stack', label: 'Export stack' },
          { separator: true },
          { id: 'park', label: 'Park stack' },
          { id: 'archive', label: 'Archive stack' },
          { id: 'delete', label: 'Delete stack' }
        ];
      }
    });
    MCR.register({
      id: 'stack-tags', scopes: ['stack'], priority: 50, section: 'tag-categories',
      build: function (scope, ctx) {
        var text = ctx.elementText || '';
        var items = [{ id: 'tag-clear', label: 'Clear tags' }];
        var enabledGroups = getTagGroupsForScope('stack');
        var tagItems = buildTagCategorySubmenus(text, 'tag-', enabledGroups);
        var customSub = buildCustomTagsSubmenu(text, 'tag-custom-');
        if (customSub) tagItems.push(customSub);
        if (tagItems.length > 0) items = items.concat(tagItems);
        return items;
      }
    });
    MCR.register({
      id: 'stack-marp', scopes: ['stack'], priority: 55, section: 'marp',
      build: function (scope, ctx) {
        var items = buildMarpMenuItems(ctx.elementText || '');
        return items.length > 0 ? items : null;
      }
    });

    // ── ROW ──────────────────────────────────────────────────────────
    MCR.register({
      id: 'row-actions', scopes: ['row'], priority: 5, section: 'actions',
      build: function () {
        return [
          { id: 'rename', label: 'Rename row' },
          { id: 'add-stack', label: 'Add stack' },
          { id: 'add-row-after', label: 'Add row after' },
          { id: 'duplicate', label: 'Duplicate row' },
          { separator: true },
          { id: 'copy-markdown', label: 'Copy as markdown' },
          { id: 'export-row', label: 'Export row' },
          { separator: true },
          { id: 'park', label: 'Park row' },
          { id: 'archive', label: 'Archive row' },
          { id: 'delete', label: 'Delete row' }
        ];
      }
    });
    MCR.register({
      id: 'row-tags', scopes: ['row'], priority: 50, section: 'tag-categories',
      build: function (scope, ctx) {
        var text = ctx.elementText || '';
        var items = [{ id: 'tag-clear', label: 'Clear tags' }];
        var enabledGroups = getTagGroupsForScope('row');
        var tagItems = buildTagCategorySubmenus(text, 'tag-', enabledGroups);
        var customSub = buildCustomTagsSubmenu(text, 'tag-custom-');
        if (customSub) tagItems.push(customSub);
        if (tagItems.length > 0) items = items.concat(tagItems);
        return items;
      }
    });
    MCR.register({
      id: 'row-marp', scopes: ['row'], priority: 55, section: 'marp',
      build: function (scope, ctx) {
        var items = buildMarpMenuItems(ctx.elementText || '');
        return items.length > 0 ? items : null;
      }
    });

    // ── CANVAS BACKGROUND ───────────────────────────────────────────
    MCR.register({
      id: 'core-canvas-background', scopes: ['canvas'], priority: 5, section: 'header',
      build: function (scope, ctx) {
        if (!ctx || !isFinite(ctx.rowIdx)) return null;
        return [{ id: 'add-stack-here', label: 'Create stack here' }];
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
