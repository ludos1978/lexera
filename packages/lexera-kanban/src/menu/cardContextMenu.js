/**
 * Card Context Menu — card operations, entity tag/marp mutation system,
 * board-level marp menu, Marp directive helpers, tag action handlers.
 *
 * Dependencies injected via init().
 */
var CardContextMenu = (function () {
  'use strict';

  // -- Injected dependencies --
  var deps = {};

  // ── Card context menu state ───────────────────────────────────────────

  var activeCardMenu = null;

  function getActiveCardMenu() {
    return activeCardMenu;
  }

  function setActiveCardMenu(el) {
    activeCardMenu = el;
  }

  function closeCardContextMenu() {
    if (activeCardMenu) {
      activeCardMenu.remove();
      activeCardMenu = null;
    }
  }

  // ── Tag menu builder helpers (delegated to ContextMenuBuilders) ──────

  function buildTagSubmenu(label, tags, text, idPrefix) {
    return deps.ContextMenuBuilders.buildTagSubmenu(label, tags, text, idPrefix);
  }

  function buildTagCategorySubmenus(text, idPrefix, order) {
    return deps.ContextMenuBuilders.buildTagCategorySubmenus(text, idPrefix, order);
  }

  function buildCustomTagsSubmenu(text, idPrefix) {
    return deps.ContextMenuBuilders.buildCustomTagsSubmenu(text, idPrefix);
  }

  // ── Tag name extraction ─────────────────────────────────────────────

  function extractTagNameFromMenuAction(action) {
    var match = String(action || '').match(/^tag-(?:cat-[a-z0-9_-]+|custom)-(.+)$/i);
    return match ? ('#' + match[1]) : '';
  }

  // ── Marp constants ──────────────────────────────────────────────────

  var TAG_CATEGORY_MENU_ORDER = [
    'special', 'importance', 'status', 'priority', 'moscow', 'positivity',
    'type', 'category', 'colors', 'colors-dark', 'colors-light', 'colors-accessible',
    'workflow', 'organization', 'teaching-content', 'product-content', 'complexity',
    'status-review', 'time-estimate', 'status-testing', 'teaching-platform',
    'product-platform', 'version', 'impact', 'schedule', 'overview', 'example', 'deliveries'
  ];
  var TAG_CATEGORY_MENU_LABELS = {
    special: 'Special', importance: 'Importance', status: 'Status', priority: 'Priority',
    moscow: 'MoSCoW', positivity: 'Positivity', type: 'Type', category: 'Category',
    colors: 'Colors', 'colors-dark': 'Colors Dark', 'colors-light': 'Colors Light',
    'colors-accessible': 'Colors Accessible', impact: 'Impact', workflow: 'Workflow',
    organization: 'Organization', 'teaching-content': 'Teaching Content',
    'product-content': 'Product Content', complexity: 'Complexity',
    'status-review': 'Status Review', 'time-estimate': 'Time Estimate',
    'status-testing': 'Status Testing', 'teaching-platform': 'Teaching Platform',
    'product-platform': 'Product Platform', version: 'Version', schedule: 'Schedule',
    overview: 'Overview', example: 'Example', deliveries: 'Deliveries'
  };

  var DEFAULT_MARP_CLASS_NAMES = ['lead', 'invert'];
  var marpClassDiscoveryState = {
    pending: null,
    lastDirKey: '',
    lastUpdatedAt: 0
  };
  var MARP_COLOR_DIRECTIVES = [
    { key: 'color', label: 'Text Color', prompt: 'Marp text color' },
    { key: 'backgroundColor', label: 'Background Color', prompt: 'Marp background color' },
    { key: 'backgroundImage', label: 'Background Image', prompt: 'Marp background image' },
    { key: 'backgroundPosition', label: 'Background Position', prompt: 'Marp background position' },
    { key: 'backgroundRepeat', label: 'Background Repeat', prompt: 'Marp background repeat' },
    { key: 'backgroundSize', label: 'Background Size', prompt: 'Marp background size' }
  ];
  var MARP_TEXT_DIRECTIVES = [
    { key: 'header', label: 'Header Text', prompt: 'Marp header text' },
    { key: 'footer', label: 'Footer Text', prompt: 'Marp footer text' }
  ];
  var BOARD_MARP_PRESENTATION_FIELDS = [
    {
      key: 'theme',
      label: 'Theme',
      prompt: 'Marp theme',
      presets: [
        { label: 'Default', value: 'default' },
        { label: 'Gaia', value: 'gaia' },
        { label: 'Uncover', value: 'uncover' }
      ]
    },
    {
      key: 'style',
      label: 'Style',
      prompt: 'Marp style'
    },
    {
      key: 'size',
      label: 'Size',
      prompt: 'Marp size',
      presets: [
        { label: '16:9', value: '16:9' },
        { label: '4:3', value: '4:3' },
        { label: '16:10', value: '16:10' },
        { label: 'A4', value: 'A4' }
      ]
    },
    {
      key: 'headingDivider',
      label: 'Heading Divider',
      prompt: 'Marp heading divider',
      presets: [
        { label: 'Off', value: 'false' },
        { label: 'All Headings', value: 'true' },
        { label: 'Level 1', value: '1' },
        { label: 'Level 2', value: '2' },
        { label: 'Level 3', value: '3' },
        { label: 'Level 4', value: '4' },
        { label: 'Level 5', value: '5' },
        { label: 'Level 6', value: '6' }
      ]
    },
    {
      key: 'math',
      label: 'Math',
      prompt: 'Marp math engine',
      presets: [
        { label: 'Off', value: 'false' },
        { label: 'KaTeX', value: 'katex' },
        { label: 'MathJax', value: 'mathjax' }
      ]
    }
  ];
  var BOARD_MARP_METADATA_FIELDS = [
    { key: 'title', label: 'Title', prompt: 'Document title' },
    { key: 'author', label: 'Author', prompt: 'Document author' },
    { key: 'description', label: 'Description', prompt: 'Document description' },
    { key: 'keywords', label: 'Keywords', prompt: 'Document keywords' },
    { key: 'url', label: 'URL', prompt: 'Document URL' },
    { key: 'image', label: 'Image', prompt: 'Document image URL/path' }
  ];
  var BOARD_MARP_SLIDE_FIELDS = [
    {
      key: 'paginate',
      label: 'Paginate',
      prompt: 'Paginate',
      presets: [
        { label: 'Enabled', value: 'true' },
        { label: 'Disabled', value: 'false' }
      ]
    },
    { key: 'header', label: 'Header', prompt: 'Marp header text' },
    { key: 'footer', label: 'Footer', prompt: 'Marp footer text' }
  ];
  var BOARD_MARP_STYLING_FIELDS = [
    { key: 'color', label: 'Text Color', prompt: 'Marp text color' },
    { key: 'backgroundColor', label: 'Background Color', prompt: 'Marp background color' },
    { key: 'backgroundImage', label: 'Background Image', prompt: 'Marp background image URL/path' },
    { key: 'backgroundPosition', label: 'Background Position', prompt: 'Marp background position' },
    { key: 'backgroundRepeat', label: 'Background Repeat', prompt: 'Marp background repeat' },
    { key: 'backgroundSize', label: 'Background Size', prompt: 'Marp background size' }
  ];

  // ── Marp class discovery ────────────────────────────────────────────

  function buildMarpClassDiscoveryDirs() {
    var dirs = [];
    var seen = {};

    function addDir(path) {
      var normalized = deps.normalizePathForCompare(String(path || '').trim());
      if (!normalized || seen[normalized]) return;
      seen[normalized] = true;
      dirs.push(normalized);
    }

    var boardFilePath = deps.getActiveBoardFilePath();
    var boardDir = deps.getDirNameFromPath(boardFilePath);
    if (boardDir) {
      addDir(boardDir);
      addDir(boardDir + '/themes');
      addDir(boardDir + '/_themes');
      addDir(boardDir + '/assets/themes');
    }

    return dirs;
  }

  function refreshAvailableMarpClasses(force) {
    if (!window.ExportService || typeof ExportService.getMarpClasses !== 'function') {
      return Promise.resolve(Array.isArray(window.marpAvailableClasses) ? window.marpAvailableClasses : []);
    }

    var dirs = buildMarpClassDiscoveryDirs();
    var dirKey = dirs.join('|');
    var existing = Array.isArray(window.marpAvailableClasses) ? window.marpAvailableClasses : [];

    if (!force && marpClassDiscoveryState.pending) {
      return marpClassDiscoveryState.pending;
    }
    if (!force && existing.length > 0 && marpClassDiscoveryState.lastDirKey === dirKey) {
      return Promise.resolve(existing);
    }

    marpClassDiscoveryState.pending = ExportService.getMarpClasses(dirs).then(function (classes) {
      window.marpAvailableClasses = Array.isArray(classes) ? classes.slice() : [];
      marpClassDiscoveryState.lastDirKey = dirKey;
      marpClassDiscoveryState.lastUpdatedAt = Date.now();
      marpClassDiscoveryState.pending = null;
      return window.marpAvailableClasses;
    }).catch(function (err) {
      marpClassDiscoveryState.pending = null;
      deps.logFrontendIssue('warn', 'marp.classes', 'Failed to discover Marp classes', err);
      return existing;
    });

    return marpClassDiscoveryState.pending;
  }

  var BOARD_MARP_FRONTMATTER_KEYS = ['marp']
    .concat(BOARD_MARP_PRESENTATION_FIELDS.map(function (field) { return field.key; }))
    .concat(BOARD_MARP_METADATA_FIELDS.map(function (field) { return field.key; }))
    .concat(BOARD_MARP_SLIDE_FIELDS.map(function (field) { return field.key; }))
    .concat(['class'])
    .concat(BOARD_MARP_STYLING_FIELDS.map(function (field) { return field.key; }));

  // ── Marp directive helpers ──────────────────────────────────────────

  function getMarpDirectiveFinalName(directiveName, directiveScope) {
    return directiveScope === 'scoped' ? ('_' + directiveName) : directiveName;
  }

  function getMarpDirectiveRegex(directiveName, directiveScope) {
    var finalDirectiveName = getMarpDirectiveFinalName(directiveName, directiveScope);
    return new RegExp('<!--\\s*' + deps.escapeRegex(finalDirectiveName) + '\\s*:\\s*([\\s\\S]*?)\\s*-->', 'gi');
  }

  function getMarpDirectiveValueFromHeader(headerText, directiveName, directiveScope) {
    var re = getMarpDirectiveRegex(directiveName, directiveScope);
    var text = String(headerText || '');
    var match = null;
    var value = '';
    while ((match = re.exec(text)) !== null) {
      value = String(match[1] || '').trim();
    }
    return value;
  }

  function clearMarpDirectiveFromHeaderText(headerText, directiveName, directiveScope) {
    return String(headerText || '')
      .replace(getMarpDirectiveRegex(directiveName, directiveScope), ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function setMarpDirectiveInHeaderText(headerText, directiveName, value, directiveScope) {
    var cleanValue = String(value || '').trim();
    if (!cleanValue) {
      return clearMarpDirectiveFromHeaderText(headerText, directiveName, directiveScope);
    }
    var nextHeader = clearMarpDirectiveFromHeaderText(headerText, directiveName, directiveScope);
    var comment = '<!-- ' + getMarpDirectiveFinalName(directiveName, directiveScope) + ': ' + cleanValue + ' -->';
    return nextHeader ? (nextHeader + ' ' + comment).trim() : comment;
  }

  function hasMarpDirectiveValue(headerText, directiveName, directiveScope, targetValue) {
    var currentValue = getMarpDirectiveValueFromHeader(headerText, directiveName, directiveScope);
    return currentValue.toLowerCase() === String(targetValue || '').trim().toLowerCase();
  }

  function getMarpClassListFromHeader(headerText, classScope) {
    var raw = getMarpDirectiveValueFromHeader(headerText, 'class', classScope);
    if (!raw) return [];
    var tokens = raw.split(/\s+/);
    var out = [];
    var seen = {};
    for (var i = 0; i < tokens.length; i++) {
      var className = String(tokens[i] || '').trim();
      if (!className || seen[className]) continue;
      seen[className] = true;
      out.push(className);
    }
    return out;
  }

  function setMarpClassListInHeader(headerText, classNames, classScope) {
    var list = Array.isArray(classNames) ? classNames : [];
    var clean = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var className = String(list[i] || '').trim();
      if (!className || seen[className]) continue;
      seen[className] = true;
      clean.push(className);
    }
    if (clean.length === 0) {
      return clearMarpDirectiveFromHeaderText(headerText, 'class', classScope);
    }
    return setMarpDirectiveInHeaderText(headerText, 'class', clean.join(' '), classScope);
  }

  function toggleMarpClassInHeaderText(headerText, className, classScope) {
    var normalized = String(className || '').trim();
    if (!normalized) return String(headerText || '');
    var classes = getMarpClassListFromHeader(headerText, classScope);
    var index = classes.indexOf(normalized);
    if (index === -1) classes.push(normalized);
    else classes.splice(index, 1);
    return setMarpClassListInHeader(headerText, classes, classScope);
  }

  function getAvailableMarpClassNames(headerText) {
    var available = [];
    var seen = {};

    function addClassNames(list) {
      var names = Array.isArray(list) ? list : [];
      for (var i = 0; i < names.length; i++) {
        var className = String(names[i] || '').trim();
        if (!className || seen[className]) continue;
        seen[className] = true;
        available.push(className);
      }
    }

    addClassNames(window.marpAvailableClasses);
    addClassNames(DEFAULT_MARP_CLASS_NAMES);
    addClassNames(getMarpClassListFromHeader(headerText, 'local'));
    addClassNames(getMarpClassListFromHeader(headerText, 'scoped'));

    return available;
  }

  function truncateMarpDirectiveValue(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    return text.length > 24 ? (text.slice(0, 24) + '\u2026') : text;
  }

  // ── Marp menu builders (card/entity level) ──────────────────────────

  function buildMarpDirectiveValueSubmenu(headerText, directive) {
    var localValue = getMarpDirectiveValueFromHeader(headerText, directive.key, 'local');
    var scopedValue = getMarpDirectiveValueFromHeader(headerText, directive.key, 'scoped');
    return {
      id: 'marp-directive-group:' + directive.key,
      label: directive.label,
      items: [
        {
          id: 'marp-directive-set-local:' + directive.key,
          label: (localValue ? 'Edit Local\u2026 (' + truncateMarpDirectiveValue(localValue) + ')' : 'Set Local\u2026')
        },
        {
          id: 'marp-directive-clear-local:' + directive.key,
          label: 'Clear Local',
          disabled: !localValue
        },
        { separator: true },
        {
          id: 'marp-directive-set-scoped:' + directive.key,
          label: (scopedValue ? 'Edit Scoped\u2026 (' + truncateMarpDirectiveValue(scopedValue) + ')' : 'Set Scoped\u2026')
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
    var classes = getAvailableMarpClassNames(headerText);
    var items = [];
    for (var i = 0; i < classes.length; i++) {
      var className = classes[i];
      items.push({
        id: 'marp-class-' + classScope + ':' + className,
        label: deps.formatMenuToggleLabel(getMarpClassListFromHeader(headerText, classScope).indexOf(className) !== -1, className)
      });
    }
    if (items.length > 0) items.push({ separator: true });
    items.push({ id: 'marp-class-custom-' + classScope, label: 'Toggle Custom Class\u2026' });
    items.push({
      id: 'marp-class-clear-' + classScope,
      label: 'Clear ' + (classScope === 'scoped' ? 'Scoped' : 'Local') + ' Classes',
      disabled: getMarpClassListFromHeader(headerText, classScope).length === 0
    });
    return {
      id: 'marp-class-group-' + classScope,
      label: classScope === 'scoped' ? 'Scoped Classes' : 'Local Classes',
      items: items
    };
  }

  function buildMarpMenuItems(headerText) {
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
        items: MARP_COLOR_DIRECTIVES.map(function (directive) {
          return buildMarpDirectiveValueSubmenu(currentHeader, directive);
        })
      },
      {
        id: 'marp-hf',
        label: 'Marp Header & Footer',
        items: [
          buildMarpDirectiveValueSubmenu(currentHeader, MARP_TEXT_DIRECTIVES[0]),
          buildMarpDirectiveValueSubmenu(currentHeader, MARP_TEXT_DIRECTIVES[1]),
          { separator: true },
          { id: 'marp-paginate-local', label: deps.formatMenuToggleLabel(hasMarpDirectiveValue(currentHeader, 'paginate', 'local', 'true'), 'Paginate (Local)') },
          { id: 'marp-paginate-scoped', label: deps.formatMenuToggleLabel(hasMarpDirectiveValue(currentHeader, 'paginate', 'scoped', 'true'), 'Paginate (Scoped)') }
        ]
      }
    ];
  }

  function findMarpDirectiveDefinition(directiveName) {
    var all = MARP_COLOR_DIRECTIVES.concat(MARP_TEXT_DIRECTIVES);
    for (var i = 0; i < all.length; i++) {
      if (all[i].key === directiveName) return all[i];
    }
    return null;
  }

  function findBoardMarpFieldDefinition(key) {
    var groups = BOARD_MARP_PRESENTATION_FIELDS
      .concat(BOARD_MARP_METADATA_FIELDS)
      .concat(BOARD_MARP_SLIDE_FIELDS)
      .concat(BOARD_MARP_STYLING_FIELDS);
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].key === key) return groups[i];
    }
    return null;
  }

  function getAvailableBoardMarpClassNames(frontmatter) {
    var available = [];
    var seen = {};

    function addNames(list) {
      var names = Array.isArray(list) ? list : [];
      for (var i = 0; i < names.length; i++) {
        var className = String(names[i] || '').trim();
        if (!className || seen[className]) continue;
        seen[className] = true;
        available.push(className);
      }
    }

    addNames(window.marpAvailableClasses);
    addNames(DEFAULT_MARP_CLASS_NAMES);
    addNames(deps.getWhitespaceTokenList(frontmatter && frontmatter['class']));

    return available;
  }

  function buildBoardMarpValueSubmenu(frontmatter, descriptor) {
    var currentValue = deps.normalizeYamlFrontmatterScalar(frontmatter && frontmatter[descriptor.key]);
    var items = [];
    var presets = Array.isArray(descriptor.presets) ? descriptor.presets : [];
    for (var i = 0; i < presets.length; i++) {
      var preset = presets[i];
      items.push({
        id: 'file-marp-set:' + descriptor.key + ':' + encodeURIComponent(String(preset.value)),
        label: deps.formatMenuToggleLabel(currentValue.toLowerCase() === String(preset.value).trim().toLowerCase(), preset.label)
      });
    }
    if (items.length > 0) items.push({ separator: true });
    items.push({
      id: 'file-marp-prompt:' + descriptor.key,
      label: currentValue ? ('Edit\u2026 (' + truncateMarpDirectiveValue(currentValue) + ')') : 'Set\u2026'
    });
    items.push({
      id: 'file-marp-clear:' + descriptor.key,
      label: 'Clear',
      disabled: !currentValue
    });
    return {
      id: 'file-marp-field-group:' + descriptor.key,
      label: descriptor.label + (currentValue ? ' (' + truncateMarpDirectiveValue(currentValue) + ')' : ''),
      items: items
    };
  }

  function buildBoardMarpClassSubmenu(frontmatter) {
    var activeClasses = deps.getWhitespaceTokenList(frontmatter && frontmatter['class']);
    var availableClasses = getAvailableBoardMarpClassNames(frontmatter);
    var items = [
      { id: 'file-marp-refresh-classes', label: 'Refresh Available Classes' },
      { separator: true }
    ];
    for (var i = 0; i < availableClasses.length; i++) {
      var className = availableClasses[i];
      items.push({
        id: 'file-marp-toggle-class:' + className,
        label: deps.formatMenuToggleLabel(activeClasses.indexOf(className) !== -1, className)
      });
    }
    if (items.length > 0) items.push({ separator: true });
    items.push({ id: 'file-marp-prompt-class', label: 'Toggle Custom Class\u2026' });
    items.push({
      id: 'file-marp-clear-class',
      label: 'Clear Classes',
      disabled: activeClasses.length === 0
    });
    return {
      id: 'file-marp-classes',
      label: 'Class' + (activeClasses.length > 0 ? ' (' + truncateMarpDirectiveValue(activeClasses.join(' ')) + ')' : ''),
      items: items
    };
  }

  function buildBoardMarpYamlPreviewItems() {
    var yamlHeader = deps.getFullBoardData() && deps.getFullBoardData().yamlHeader ? String(deps.getFullBoardData().yamlHeader) : '';
    var items = [
      {
        id: 'file-marp-copy-yaml',
        label: 'Copy YAML Header',
        disabled: !yamlHeader
      }
    ];
    items.push({ separator: true });
    if (!yamlHeader) {
      items.push({ id: 'file-marp-yaml-empty', label: '(No YAML header yet)', disabled: true });
      return items;
    }
    var lines = yamlHeader.split(/\r?\n/);
    var maxLines = 16;
    for (var i = 0; i < lines.length && i < maxLines; i++) {
      items.push({
        id: 'file-marp-yaml-line:' + i,
        label: lines[i] || ' ',
        disabled: true
      });
    }
    if (lines.length > maxLines) {
      items.push({ id: 'file-marp-yaml-more', label: '\u2026', disabled: true });
    }
    return items;
  }

  function buildFileHeaderMarpMenuItems() {
    var frontmatter = deps.getBoardMarpFrontmatter();
    var marpEnabled = deps.normalizeYamlFrontmatterScalar(frontmatter.marp).toLowerCase() === 'true';
    return [
      { id: 'file-marp-toggle-enabled', label: deps.formatMenuToggleLabel(marpEnabled, 'Enable Marp') },
      { separator: true },
      {
        id: 'file-marp-presentation',
        label: 'Presentation',
        items: BOARD_MARP_PRESENTATION_FIELDS.map(function (field) {
          return buildBoardMarpValueSubmenu(frontmatter, field);
        })
      },
      {
        id: 'file-marp-metadata',
        label: 'Metadata',
        items: BOARD_MARP_METADATA_FIELDS.map(function (field) {
          return buildBoardMarpValueSubmenu(frontmatter, field);
        })
      },
      {
        id: 'file-marp-slide',
        label: 'Slide Settings',
        items: BOARD_MARP_SLIDE_FIELDS.map(function (field) {
          return buildBoardMarpValueSubmenu(frontmatter, field);
        })
      },
      {
        id: 'file-marp-styling',
        label: 'Styling',
        items: [buildBoardMarpClassSubmenu(frontmatter)].concat(
          BOARD_MARP_STYLING_FIELDS.map(function (field) {
            return buildBoardMarpValueSubmenu(frontmatter, field);
          })
        )
      },
      {
        id: 'file-marp-yaml',
        label: 'Current YAML',
        items: buildBoardMarpYamlPreviewItems()
      }
    ];
  }

  // ── Board-level marp actions ────────────────────────────────────────

  function toggleBoardMarpClass(className) {
    var normalizedClass = String(className || '').trim();
    if (!normalizedClass) return Promise.resolve(false);
    var frontmatter = deps.getBoardMarpFrontmatter();
    var classes = deps.getWhitespaceTokenList(frontmatter['class']);
    var index = classes.indexOf(normalizedClass);
    if (index === -1) classes.push(normalizedClass);
    else classes.splice(index, 1);
    return deps.setBoardFrontmatterValue('class', deps.setWhitespaceTokenList(classes) || null);
  }

  function clearBoardMarpClasses() {
    return deps.setBoardFrontmatterValue('class', null);
  }

  function promptBoardMarpValue(key) {
    var descriptor = findBoardMarpFieldDefinition(key);
    var currentValue = deps.normalizeYamlFrontmatterScalar(deps.getBoardMarpFrontmatter()[key]);
    var label = descriptor && descriptor.prompt ? descriptor.prompt : ('Marp ' + key);
    var requested = window.prompt(label, currentValue || '');
    if (requested == null) return Promise.resolve(false);
    var normalizedValue = deps.normalizeYamlFrontmatterScalar(requested);
    return deps.setBoardFrontmatterValue(key, normalizedValue || null);
  }

  function promptBoardMarpClassToggle() {
    var requested = window.prompt('Marp class name(s) to toggle', '');
    if (requested == null) return Promise.resolve(false);
    var classNames = deps.getWhitespaceTokenList(requested);
    if (classNames.length === 0) return Promise.resolve(false);
    var chain = Promise.resolve(false);
    for (var i = 0; i < classNames.length; i++) {
      (function (cn) {
        chain = chain.then(function (changed) {
          return toggleBoardMarpClass(cn).then(function (r) { return r || changed; });
        });
      })(classNames[i]);
    }
    return chain;
  }

  function handleBoardMarpMenuAction(action) {
    if (action === 'file-marp-toggle-enabled') {
      var enabled = deps.normalizeYamlFrontmatterScalar(deps.getBoardMarpFrontmatter().marp).toLowerCase() === 'true';
      return deps.setBoardFrontmatterValue('marp', enabled ? 'false' : 'true').then(function () { return true; });
    }
    if (action === 'file-marp-refresh-classes') {
      return refreshAvailableMarpClasses(true).then(function () { return true; });
    }
    if (action === 'file-marp-prompt-class') {
      return promptBoardMarpClassToggle().then(function () { return true; });
    }
    if (action === 'file-marp-clear-class') {
      return clearBoardMarpClasses().then(function () { return true; });
    }
    if (action === 'file-marp-copy-yaml') {
      deps.copyTextToClipboard(
        deps.getFullBoardData() && deps.getFullBoardData().yamlHeader ? String(deps.getFullBoardData().yamlHeader) : '',
        'YAML header copied to clipboard',
        'Failed to copy YAML header'
      );
      return Promise.resolve(true);
    }
    if (action.indexOf('file-marp-toggle-class:') === 0) {
      return toggleBoardMarpClass(action.substring('file-marp-toggle-class:'.length)).then(function () { return true; });
    }

    var setMatch = String(action || '').match(/^file-marp-set:([A-Za-z0-9_]+):(.+)$/);
    if (setMatch) {
      return deps.setBoardFrontmatterValue(setMatch[1], decodeURIComponent(setMatch[2])).then(function () { return true; });
    }

    var promptMatch = String(action || '').match(/^file-marp-prompt:([A-Za-z0-9_]+)$/);
    if (promptMatch) {
      return promptBoardMarpValue(promptMatch[1]).then(function () { return true; });
    }

    var clearMatch = String(action || '').match(/^file-marp-clear:([A-Za-z0-9_]+)$/);
    if (clearMatch) {
      return deps.setBoardFrontmatterValue(clearMatch[1], null).then(function () { return true; });
    }

    return Promise.resolve(false);
  }

  // ── Entity-level marp operations ────────────────────────────────────

  function setEntityMarpDirective(elementType, indices, directiveName, directiveValue, directiveScope) {
    return mutateEntityHeaderText(elementType, indices, function (headerText) {
      return setMarpDirectiveInHeaderText(headerText, directiveName, directiveValue, directiveScope);
    });
  }

  function clearEntityMarpDirective(elementType, indices, directiveName, directiveScope) {
    return mutateEntityHeaderText(elementType, indices, function (headerText) {
      return clearMarpDirectiveFromHeaderText(headerText, directiveName, directiveScope);
    });
  }

  function toggleEntityMarpDirective(elementType, indices, directiveName, enabledValue, directiveScope) {
    var targetValue = String(enabledValue || '').trim() || 'true';
    return mutateEntityHeaderText(elementType, indices, function (headerText) {
      if (hasMarpDirectiveValue(headerText, directiveName, directiveScope, targetValue)) {
        return clearMarpDirectiveFromHeaderText(headerText, directiveName, directiveScope);
      }
      return setMarpDirectiveInHeaderText(headerText, directiveName, targetValue, directiveScope);
    });
  }

  function toggleEntityMarpClass(elementType, indices, className, classScope) {
    return mutateEntityHeaderText(elementType, indices, function (headerText) {
      return toggleMarpClassInHeaderText(headerText, className, classScope);
    });
  }

  function clearEntityMarpClasses(elementType, indices, classScope) {
    return mutateEntityHeaderText(elementType, indices, function (headerText) {
      return setMarpClassListInHeader(headerText, [], classScope);
    });
  }

  function promptEntityMarpDirective(elementType, indices, directiveName, directiveScope) {
    var target = resolveTagTarget(elementType, indices);
    if (!target) return Promise.resolve(false);
    var currentValue = getMarpDirectiveValueFromHeader(splitTagHeaderAndBody(target.text || '').header || '', directiveName, directiveScope);
    var descriptor = findMarpDirectiveDefinition(directiveName);
    var label = descriptor && descriptor.prompt ? descriptor.prompt : ('Marp ' + directiveName);
    var requested = window.prompt(label + ' (' + directiveScope + ')', currentValue || '');
    if (requested == null) return Promise.resolve(false);
    var cleanValue = String(requested || '').trim();
    if (!cleanValue) {
      return clearEntityMarpDirective(elementType, indices, directiveName, directiveScope);
    }
    return setEntityMarpDirective(elementType, indices, directiveName, cleanValue, directiveScope);
  }

  function promptEntityMarpClassToggle(elementType, indices, classScope) {
    var requested = window.prompt('Marp class name(s) to toggle (' + classScope + ')', '');
    if (requested == null) return Promise.resolve(false);
    var tokens = String(requested || '').split(/\s+/);
    var classNames = [];
    var seen = {};
    for (var i = 0; i < tokens.length; i++) {
      var className = String(tokens[i] || '').trim();
      if (!className || seen[className]) continue;
      seen[className] = true;
      classNames.push(className);
    }
    if (classNames.length === 0) return Promise.resolve(false);
    return mutateEntityHeaderText(elementType, indices, function (headerText) {
      var nextHeader = String(headerText || '');
      for (var j = 0; j < classNames.length; j++) {
        nextHeader = toggleMarpClassInHeaderText(nextHeader, classNames[j], classScope);
      }
      return nextHeader;
    });
  }

  function handleEntityMarpMenuAction(action, elementType, indices) {
    if (action === 'marp-classes-refresh') {
      return refreshAvailableMarpClasses(true).then(function () { return true; });
    }
    if (action === 'marp-paginate-local') {
      return toggleEntityMarpDirective(elementType, indices, 'paginate', 'true', 'local').then(function () { return true; });
    }
    if (action === 'marp-paginate-scoped') {
      return toggleEntityMarpDirective(elementType, indices, 'paginate', 'true', 'scoped').then(function () { return true; });
    }
    if (action === 'marp-class-custom-local') {
      return promptEntityMarpClassToggle(elementType, indices, 'local').then(function () { return true; });
    }
    if (action === 'marp-class-custom-scoped') {
      return promptEntityMarpClassToggle(elementType, indices, 'scoped').then(function () { return true; });
    }
    if (action === 'marp-class-clear-local') {
      return clearEntityMarpClasses(elementType, indices, 'local').then(function () { return true; });
    }
    if (action === 'marp-class-clear-scoped') {
      return clearEntityMarpClasses(elementType, indices, 'scoped').then(function () { return true; });
    }
    if (action.indexOf('marp-class-local:') === 0) {
      return toggleEntityMarpClass(elementType, indices, action.substring('marp-class-local:'.length), 'local').then(function () { return true; });
    }
    if (action.indexOf('marp-class-scoped:') === 0) {
      return toggleEntityMarpClass(elementType, indices, action.substring('marp-class-scoped:'.length), 'scoped').then(function () { return true; });
    }
    var directiveMatch = String(action || '').match(/^marp-directive-(set|clear)-(local|scoped):([A-Za-z0-9_]+)$/);
    if (!directiveMatch) return Promise.resolve(false);
    if (directiveMatch[1] === 'set') {
      return promptEntityMarpDirective(elementType, indices, directiveMatch[3], directiveMatch[2]).then(function () { return true; });
    }
    return clearEntityMarpDirective(elementType, indices, directiveMatch[3], directiveMatch[2]).then(function () { return true; });
  }

  // ── Show card context menu ──────────────────────────────────────────

  function showCardContextMenu(x, y, colIndex, cardIndex) {
    deps.showElementContextMenu('card', x, y, { colIndex: colIndex, cardIndex: cardIndex });
  }

  // ── Card operations ─────────────────────────────────────────────────

  function duplicateCard(colIndex, cardIndex) {
    if (!deps.getFullBoardData() || !deps.getActiveBoardId()) return Promise.resolve();
    var col = deps.getFullColumn(colIndex);
    if (!col) return Promise.resolve();
    var fullIdx = deps.getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return Promise.resolve();
    deps.pushUndo();

    var clone = structuredClone(card);
    clone.id = 'dup-' + Date.now();
    clone.kid = null;
    col.cards.splice(fullIdx + 1, 0, clone);
    return deps.persistBoardMutation({ targets: [{ type: 'card-insert', colIndex: colIndex, cardIndex: cardIndex + 1 }] });
  }

  function duplicateCardToColumn(colIndex, cardIndex, targetColIndex) {
    if (!deps.getFullBoardData() || !deps.getActiveBoardId()) return Promise.resolve();
    var srcCol = deps.getFullColumn(colIndex);
    var dstCol = deps.getFullColumn(targetColIndex);
    if (!srcCol || !dstCol) return Promise.resolve();
    var fullIdx = deps.getFullCardIndex(srcCol, cardIndex);
    var card = srcCol.cards[fullIdx];
    if (!card) return Promise.resolve();
    deps.pushUndo();
    var clone = structuredClone(card);
    clone.id = 'dup-' + Date.now();
    clone.kid = null;
    dstCol.cards.push(clone);
    return deps.persistBoardMutation({ targets: [{ type: 'column', colIndex: targetColIndex }] });
  }

  function parkCopyCard(colIndex, cardIndex) {
    if (!deps.getFullBoardData() || !deps.getActiveBoardId()) return Promise.resolve();
    var col = deps.getFullColumn(colIndex);
    if (!col) return Promise.resolve();
    var fullIdx = deps.getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return Promise.resolve();
    deps.pushUndo();
    var clone = structuredClone(card);
    clone.id = 'dup-' + Date.now();
    clone.kid = null;
    clone.content = deps.applyInternalHiddenTag(clone.content || '', '#hidden-internal-parked');
    col.cards.splice(fullIdx + 1, 0, clone);
    // Clone is hidden — no visible change, persist only
    return deps.persistBoardMutation({ targets: [] });
  }

  function tagCard(colIndex, cardIndex, tag) {
    if (!deps.getFullBoardData() || !deps.getActiveBoardId()) return Promise.resolve();
    var col = deps.getFullColumn(colIndex);
    if (!col) return Promise.resolve();
    var fullIdx = deps.getFullCardIndex(col, cardIndex);
    if (fullIdx === -1) return Promise.resolve();
    var card = col.cards[fullIdx];
    if (!card) return Promise.resolve();
    var nextContent = deps.applyInternalHiddenTag(card.content || '', tag);
    if (nextContent === card.content) return Promise.resolve();
    deps.pushUndo();
    card.content = nextContent;
    return deps.persistBoardMutation({ targets: [{ type: 'card-remove', colIndex: colIndex, cardIndex: cardIndex }] });
  }

  function deleteCard(colIndex, cardIndex) {
    return tagCard(colIndex, cardIndex, '#hidden-internal-deleted');
  }

  // ── Entity tag target resolution ────────────────────────────────────

  function resolveTagTarget(elementType, indices) {
    var text = '';
    var setFn = null;
    if (elementType === 'card') {
      var col = deps.getFullColumn(indices.colIndex);
      if (!col) return null;
      var fullIdx = deps.getFullCardIndex(col, indices.cardIndex);
      if (fullIdx === -1) return null;
      text = col.cards[fullIdx].content || '';
      setFn = function (val) { col.cards[fullIdx].content = val; };
    } else if (elementType === 'column') {
      var col2 = deps.getFullColumn(indices.colIndex);
      if (!col2) return null;
      text = col2.title || '';
      setFn = function (val) { col2.title = val; };
    } else if (elementType === 'row') {
      var row = deps.findFullDataRow(indices.rowIdx);
      if (!row) return null;
      text = row.title || '';
      setFn = function (val) { row.title = val; };
    } else if (elementType === 'stack') {
      var stack = deps.findFullDataStack(indices.rowIdx, indices.stackIdx);
      if (!stack) return null;
      text = stack.title || '';
      setFn = function (val) { stack.title = val; };
    } else {
      return null;
    }
    return { text: text, setText: setFn };
  }

  function splitTagHeaderAndBody(text) {
    var lines = String(text || '').split('\n');
    var splitIdx = lines.length;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') {
        splitIdx = i;
        break;
      }
    }
    return {
      header: lines.slice(0, splitIdx).join('\n'),
      bodyLines: lines.slice(splitIdx)
    };
  }

  function rebuildTagHeaderAndBody(headerText, bodyLines) {
    var parts = [];
    if (headerText) parts = headerText.split('\n');
    if (Array.isArray(bodyLines) && bodyLines.length > 0) {
      var nextBodyLines = bodyLines.slice();
      if (!headerText) {
        while (nextBodyLines.length > 0 && String(nextBodyLines[0] || '').trim() === '') {
          nextBodyLines.shift();
        }
      }
      parts = parts.concat(nextBodyLines);
    }
    return parts.join('\n');
  }

  function mutateEntityHeaderText(elementType, indices, mutator) {
    if (!deps.getFullBoardData() || !deps.getActiveBoardId() || typeof mutator !== 'function') return Promise.resolve(false);
    var target = resolveTagTarget(elementType, indices);
    if (!target || typeof target.setText !== 'function') return Promise.resolve(false);
    var parts = splitTagHeaderAndBody(target.text || '');
    var nextHeader = mutator(parts.header || '', target.text || '');
    if (typeof nextHeader !== 'string' || nextHeader === parts.header) return Promise.resolve(false);
    var nextText = rebuildTagHeaderAndBody(nextHeader, parts.bodyLines);
    if (nextText === target.text) return Promise.resolve(false);
    deps.pushUndo();
    target.setText(nextText);

    var mutTarget;
    if (elementType === 'card') {
      mutTarget = { type: 'card', colIndex: indices.colIndex, cardIndex: indices.cardIndex };
    } else if (elementType === 'column') {
      mutTarget = { type: 'column', colIndex: indices.colIndex };
    } else if (elementType === 'row') {
      mutTarget = { type: 'row', rowIndex: indices.rowIdx };
    } else if (elementType === 'stack') {
      mutTarget = { type: 'stack', rowIndex: indices.rowIdx, stackIndex: indices.stackIdx };
    } else {
      mutTarget = { type: 'board' };
    }
    return deps.persistBoardMutation({ targets: [mutTarget] }).then(function () { return true; });
  }

  // ── Tag helpers (delegating to LexeraTagSystem) ─────────────────────

  function normalizePromptTagToken(rawToken) {
    return deps.LexeraTagSystem.normalizePromptTagToken(rawToken);
  }

  function parsePromptTagList(rawInput) {
    return deps.LexeraTagSystem.parsePromptTagList(rawInput);
  }

  function removeTagFromHeaderText(headerText, tagName) {
    return deps.LexeraTagSystem.removeTagFromHeader(headerText, tagName);
  }

  function addTagToHeaderText(headerText, tagName) {
    return deps.LexeraTagSystem.addTagToHeader(headerText, tagName);
  }

  function clearRemovableTagsFromHeaderText(headerText) {
    return deps.LexeraTagSystem.clearRemovableTags(headerText);
  }

  // ── Entity tag mutations ────────────────────────────────────────────

  function mutateEntityHeaderTags(elementType, indices, mutator) {
    return mutateEntityHeaderText(elementType, indices, function (header) {
      return mutator(header || '');
    });
  }

  function promptAddTagsToEntity(elementType, indices) {
    var raw = window.prompt('Add tags (space/comma separated)', '#todo');
    if (raw == null) return Promise.resolve();
    var tags = parsePromptTagList(raw);
    if (tags.length === 0) {
      deps.showNotification('No valid tags provided');
      return Promise.resolve();
    }
    return mutateEntityHeaderTags(elementType, indices, function (header) {
      var next = header;
      for (var i = 0; i < tags.length; i++) next = addTagToHeaderText(next, tags[i]);
      return next;
    }).then(function (changed) {
      if (!changed) deps.showNotification('Tags already present');
    });
  }

  function promptRemoveTagsFromEntity(elementType, indices) {
    var target = resolveTagTarget(elementType, indices);
    var prefill = target ? deps.extractAllTags(target.text || '').join(' ') : '';
    var raw = window.prompt('Remove tags (space/comma separated)', prefill || '#todo');
    if (raw == null) return Promise.resolve();
    var tags = parsePromptTagList(raw);
    if (tags.length === 0) {
      deps.showNotification('No valid tags provided');
      return Promise.resolve();
    }
    return mutateEntityHeaderTags(elementType, indices, function (header) {
      var next = header;
      for (var i = 0; i < tags.length; i++) next = removeTagFromHeaderText(next, tags[i]);
      return next;
    }).then(function (changed) {
      if (!changed) deps.showNotification('Selected tags not found');
    });
  }

  function clearTagsFromEntity(elementType, indices) {
    return mutateEntityHeaderTags(elementType, indices, clearRemovableTagsFromHeaderText).then(function (changed) {
      if (!changed) deps.showNotification('No removable tags found');
    });
  }

  function handleEntityTagMenuAction(action, elementType, indices) {
    if (action === 'tag-add') {
      return promptAddTagsToEntity(elementType, indices).then(function () { return true; });
    }
    if (action === 'tag-remove') {
      return promptRemoveTagsFromEntity(elementType, indices).then(function () { return true; });
    }
    if (action === 'tag-clear') {
      return clearTagsFromEntity(elementType, indices).then(function () { return true; });
    }
    var tagName = extractTagNameFromMenuAction(action);
    if (tagName) {
      return toggleTag(elementType, indices, tagName).then(function () { return true; });
    }
    return Promise.resolve(false);
  }

  function toggleTag(elementType, indices, tagName) {
    var normalizedTag = normalizePromptTagToken(tagName);
    if (!normalizedTag) return Promise.resolve();
    return mutateEntityHeaderTags(elementType, indices, function (header) {
      if (deps.hasTag(header, normalizedTag)) return removeTagFromHeaderText(header, normalizedTag);
      return addTagToHeaderText(header, normalizedTag);
    });
  }

  // ── Init ────────────────────────────────────────────────────────────

  function init(d) {
    deps = d || {};
  }

  // ── Public API ──────────────────────────────────────────────────────

  return {
    init: init,
    // Card menu state
    getActiveCardMenu: getActiveCardMenu,
    setActiveCardMenu: setActiveCardMenu,
    closeCardContextMenu: closeCardContextMenu,
    // Tag menu helpers
    extractTagNameFromMenuAction: extractTagNameFromMenuAction,
    // Tag category constants (for ContextMenuBuilders backward compat)
    TAG_CATEGORY_MENU_ORDER: TAG_CATEGORY_MENU_ORDER,
    TAG_CATEGORY_MENU_LABELS: TAG_CATEGORY_MENU_LABELS,
    // Marp constants
    DEFAULT_MARP_CLASS_NAMES: DEFAULT_MARP_CLASS_NAMES,
    MARP_COLOR_DIRECTIVES: MARP_COLOR_DIRECTIVES,
    MARP_TEXT_DIRECTIVES: MARP_TEXT_DIRECTIVES,
    BOARD_MARP_PRESENTATION_FIELDS: BOARD_MARP_PRESENTATION_FIELDS,
    BOARD_MARP_METADATA_FIELDS: BOARD_MARP_METADATA_FIELDS,
    BOARD_MARP_SLIDE_FIELDS: BOARD_MARP_SLIDE_FIELDS,
    BOARD_MARP_STYLING_FIELDS: BOARD_MARP_STYLING_FIELDS,
    BOARD_MARP_FRONTMATTER_KEYS: BOARD_MARP_FRONTMATTER_KEYS,
    // Marp directive helpers
    getMarpDirectiveFinalName: getMarpDirectiveFinalName,
    getMarpDirectiveRegex: getMarpDirectiveRegex,
    getMarpDirectiveValueFromHeader: getMarpDirectiveValueFromHeader,
    clearMarpDirectiveFromHeaderText: clearMarpDirectiveFromHeaderText,
    setMarpDirectiveInHeaderText: setMarpDirectiveInHeaderText,
    hasMarpDirectiveValue: hasMarpDirectiveValue,
    getMarpClassListFromHeader: getMarpClassListFromHeader,
    setMarpClassListInHeader: setMarpClassListInHeader,
    toggleMarpClassInHeaderText: toggleMarpClassInHeaderText,
    getAvailableMarpClassNames: getAvailableMarpClassNames,
    truncateMarpDirectiveValue: truncateMarpDirectiveValue,
    // Marp class discovery
    refreshAvailableMarpClasses: refreshAvailableMarpClasses,
    // Marp menu builders
    buildMarpDirectiveValueSubmenu: buildMarpDirectiveValueSubmenu,
    buildMarpClassScopeSubmenu: buildMarpClassScopeSubmenu,
    buildMarpMenuItems: buildMarpMenuItems,
    findMarpDirectiveDefinition: findMarpDirectiveDefinition,
    findBoardMarpFieldDefinition: findBoardMarpFieldDefinition,
    buildFileHeaderMarpMenuItems: buildFileHeaderMarpMenuItems,
    // Board-level marp actions
    handleBoardMarpMenuAction: handleBoardMarpMenuAction,
    // Entity-level marp operations
    handleEntityMarpMenuAction: handleEntityMarpMenuAction,
    // Card context menu
    showCardContextMenu: showCardContextMenu,
    // Card operations
    duplicateCard: duplicateCard,
    duplicateCardToColumn: duplicateCardToColumn,
    parkCopyCard: parkCopyCard,
    tagCard: tagCard,
    deleteCard: deleteCard,
    // Entity tag target resolution
    resolveTagTarget: resolveTagTarget,
    splitTagHeaderAndBody: splitTagHeaderAndBody,
    rebuildTagHeaderAndBody: rebuildTagHeaderAndBody,
    mutateEntityHeaderText: mutateEntityHeaderText,
    // Tag helpers
    normalizePromptTagToken: normalizePromptTagToken,
    parsePromptTagList: parsePromptTagList,
    removeTagFromHeaderText: removeTagFromHeaderText,
    addTagToHeaderText: addTagToHeaderText,
    clearRemovableTagsFromHeaderText: clearRemovableTagsFromHeaderText,
    // Entity tag operations
    mutateEntityHeaderTags: mutateEntityHeaderTags,
    handleEntityTagMenuAction: handleEntityTagMenuAction,
    toggleTag: toggleTag
  };
})();
window.CardContextMenu = CardContextMenu;
