(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LexeraTagColors = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var deps = {};

  var TAG_COLORS = {
    '#comment': '#d4883c',
    '#note': '#c9b84e',
    '#urgent': '#e05252',
    '#feature': '#4ec98a',
    '#bug': '#e05252',
    '#todo': '#5c9cd4',
    '#done': '#4ec9b0',
    '#blocked': '#c94e7c',
    '#question': '#9b7ed4',
    '#idea': '#d4c24e',
    '#review': '#5cc9c9',
    '#wip': '#d49b4e',
    '#red': '#DC3545',
    '#orange': '#FD7E14',
    '#yellow': '#FFC107',
    '#green': '#198754',
    '#cyan': '#0DCAF0',
    '#blue': '#0056B3',
    '#purple': '#6F42C1',
    '#pink': '#E83E8C',
    '#brown': '#795548',
    '#gray': '#ADB5BD',
    '#grey': '#ADB5BD',
    '#teal': '#20C997',
    '#indigo': '#6610F2',
    '#dark-red': '#8B0000',
    '#dark-orange': '#CC5500',
    '#dark-yellow': '#B8860B',
    '#dark-green': '#006400',
    '#dark-cyan': '#008B8B',
    '#dark-blue': '#00008B',
    '#dark-purple': '#4B0082',
    '#dark-pink': '#C71585',
    '#dark-brown': '#654321',
    '#dark-gray': '#404040',
    '#dark-grey': '#404040',
    '#black': '#000000',
    '#dark-charcoal': '#1C1C1C',
    '#light-red': '#FFB3BA',
    '#light-orange': '#FFCC99',
    '#light-yellow': '#FFEB99',
    '#light-green': '#B8FFB8',
    '#light-cyan': '#99F2F2',
    '#light-blue': '#A3D3FF',
    '#light-purple': '#E0CCFF',
    '#light-pink': '#FFD6EB',
    '#light-brown': '#DCC7B8',
    '#light-gray': '#E8E8E8',
    '#light-grey': '#E8E8E8',
    '#white': '#FFFFFF',
    '#light-beige': '#F5F5DC',
    '#accessible-indigo': '#332288',
    '#accessible-green': '#117733',
    '#accessible-teal': '#44AA99',
    '#accessible-cyan': '#88CCEE',
    '#accessible-yellow': '#DDCC77',
    '#accessible-rose': '#CC6677',
    '#accessible-purple': '#AA4499',
    '#accessible-magenta': '#882255',
  };

  var TAG_PALETTE = [
    '#d4883c', '#5c9cd4', '#4ec98a', '#c94e7c',
    '#9b7ed4', '#c9b84e', '#5cc9c9', '#d49b4e',
    '#7ed47e', '#d45c8c', '#4ec9b0', '#d4644e',
  ];

  try {
    var storedTagColorOverrides = JSON.parse(localStorage.getItem('lexera-tag-color-overrides') || '{}');
    if (storedTagColorOverrides && typeof storedTagColorOverrides === 'object') {
      for (var storedTagKey in storedTagColorOverrides) {
        if (!Object.prototype.hasOwnProperty.call(storedTagColorOverrides, storedTagKey)) continue;
        TAG_COLORS[String(storedTagKey).toLowerCase()] = String(storedTagColorOverrides[storedTagKey] || '');
      }
    }
  } catch (storedTagColorErr) {
    // Ignore malformed local overrides and keep built-in colors.
  }

  var TAG_CATEGORIES = {
    special: ['header', 'footer', 'hide', 'exclude', 'private', 'draft', 'surface'],
    importance: ['critical', 'normal'],
    status: ['todo', 'inprogress', 'done', 'transferred', 'blocked', 'review', 'testing', 'wip', 'cancelled', 'archived'],
    priority: ['urgent', 'high', 'medium', 'low', 'delayed', 'stopped'],
    moscow: ['must', 'should', 'could', 'wont'],
    positivity: ['++', '+', '\u00f8', '-', '--'],
    type: ['bug', 'feature', 'enhancement', 'documentation', 'epic', 'spike', 'refactor'],
    category: ['backend', 'frontend', 'database', 'api', 'security', 'performance', 'ux', 'ui'],
    colors: ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'brown', 'gray', 'teal', 'indigo'],
    'colors-dark': ['dark-red', 'dark-orange', 'dark-yellow', 'dark-green', 'dark-cyan', 'dark-blue', 'dark-purple', 'dark-pink', 'dark-brown', 'dark-gray', 'black', 'dark-charcoal'],
    'colors-light': ['light-red', 'light-orange', 'light-yellow', 'light-green', 'light-cyan', 'light-blue', 'light-purple', 'light-pink', 'light-brown', 'light-gray', 'white', 'light-beige'],
    'colors-accessible': ['accessible-indigo', 'accessible-green', 'accessible-teal', 'accessible-cyan', 'accessible-yellow', 'accessible-rose', 'accessible-purple', 'accessible-magenta'],
    workflow: ['ideas', 'outline', 'draft', 'reviewing', 'polish', 'ready', 'published', 'active', 'production', 'archive'],
    organization: ['intro', 'core', 'advanced', 'frontend', 'backend', 'infrastructure', 'design'],
    'teaching-content': ['slide', 'video', 'reading', 'exercise', 'quiz', 'demo', 'interactive', 'handout', 'discussion'],
    'product-content': ['story', 'task', 'chore', 'improvement', 'design', 'infrastructure-task'],
    complexity: ['trivial', 'beginner', 'intermediate', 'advanced-level', 'expert'],
    'status-review': ['needs-review', 'in-review', 'needs-changes', 'reviewed', 'needs-approval', 'approved', 'rejected'],
    'time-estimate': ['quick', 'medium-time', 'long'],
    'status-testing': ['untested', 'unit-tested', 'integration-tested', 'e2e-tested', 'security-tested', 'performance-tested', 'regression-tested', 'uat-passed'],
    'teaching-platform': ['online', 'in-person', 'hybrid', 'async', 'sync'],
    'product-platform': ['web', 'mobile', 'ios', 'android', 'desktop', 'api'],
    version: ['v1', 'v2', 'v3', 'rc', 'stable', 'legacy', 'eol'],
    impact: ['minor', 'moderate', 'major', 'breaking'],
    schedule: ['planning', 'preparation', 'verify'],
    overview: ['overview', 'information', 'presentation'],
    example: ['example', 'tasks', 'homework'],
    deliveries: ['deliveries', 'handouts', 'references']
  };

  var TAG_STYLE_ROLE_BY_CATEGORY = {
    importance: 'header',
    status: 'header',
    workflow: 'header',
    organization: 'header',
    'teaching-content': 'header',
    'product-content': 'header',
    complexity: 'header',
    type: 'header',
    category: 'header',
    impact: 'header',
    schedule: 'header',
    overview: 'header',
    example: 'header',
    deliveries: 'header',
    version: 'header',
    priority: 'footer',
    moscow: 'footer',
    'status-review': 'footer',
    'time-estimate': 'footer',
    'status-testing': 'footer',
    positivity: 'badge',
    'teaching-platform': 'badge',
    'product-platform': 'badge',
    colors: 'background',
    'colors-dark': 'background',
    'colors-light': 'background',
    'colors-accessible': 'background',
    special: 'effect'
  };

  // ── Configurable Tag Style System ─────────────────────────────────────
  // Presets define category→role mappings and per-tag style overrides.
  // Users can select a preset and add per-tag overrides via localStorage.

  var TAG_STYLE_PRESETS = {
    'default': {
      label: 'Default',
      description: 'Header bars for status/type, footer bars for priority, badges for platforms',
      categoryRoles: null, // uses TAG_STYLE_ROLE_BY_CATEGORY as-is
      tagOverrides: null
    },
    'minimal': {
      label: 'Minimal',
      description: 'Borders only, no header/footer bars or badges',
      categoryRoles: {
        importance: 'border-only', status: 'border-only', workflow: 'border-only',
        organization: 'border-only', 'teaching-content': 'border-only',
        'product-content': 'border-only', complexity: 'border-only',
        type: 'border-only', category: 'border-only', impact: 'border-only',
        schedule: 'border-only', overview: 'border-only', example: 'border-only',
        deliveries: 'border-only', version: 'border-only',
        priority: 'border-only', moscow: 'border-only',
        'status-review': 'border-only', 'time-estimate': 'border-only',
        'status-testing': 'border-only',
        positivity: 'border-only', 'teaching-platform': 'border-only',
        'product-platform': 'border-only',
        colors: 'background', 'colors-dark': 'background',
        'colors-light': 'background', 'colors-accessible': 'background',
        special: 'effect'
      },
      tagOverrides: null
    },
    'full': {
      label: 'Full',
      description: 'Header and footer bars for all categories',
      categoryRoles: {
        importance: 'header', status: 'header', workflow: 'header',
        organization: 'header', 'teaching-content': 'header',
        'product-content': 'header', complexity: 'header',
        type: 'header', category: 'header', impact: 'header',
        schedule: 'header', overview: 'header', example: 'header',
        deliveries: 'header', version: 'header',
        priority: 'footer', moscow: 'footer',
        'status-review': 'footer', 'time-estimate': 'footer',
        'status-testing': 'footer',
        positivity: 'header', 'teaching-platform': 'footer',
        'product-platform': 'footer',
        colors: 'background', 'colors-dark': 'background',
        'colors-light': 'background', 'colors-accessible': 'background',
        special: 'effect'
      },
      tagOverrides: null
    },
    'badges': {
      label: 'Badges Only',
      description: 'All categories shown as compact badges',
      categoryRoles: {
        importance: 'badge', status: 'badge', workflow: 'badge',
        organization: 'badge', 'teaching-content': 'badge',
        'product-content': 'badge', complexity: 'badge',
        type: 'badge', category: 'badge', impact: 'badge',
        schedule: 'badge', overview: 'badge', example: 'badge',
        deliveries: 'badge', version: 'badge',
        priority: 'badge', moscow: 'badge',
        'status-review': 'badge', 'time-estimate': 'badge',
        'status-testing': 'badge',
        positivity: 'badge', 'teaching-platform': 'badge',
        'product-platform': 'badge',
        colors: 'background', 'colors-dark': 'background',
        'colors-light': 'background', 'colors-accessible': 'background',
        special: 'effect'
      },
      tagOverrides: null
    },
    'priority-focus': {
      label: 'Priority Focus',
      description: 'Priority as header, status as footer, type as badge',
      categoryRoles: {
        importance: 'header', status: 'footer', workflow: 'footer',
        organization: 'badge', 'teaching-content': 'badge',
        'product-content': 'badge', complexity: 'badge',
        type: 'badge', category: 'badge', impact: 'header',
        schedule: 'footer', overview: 'badge', example: 'badge',
        deliveries: 'badge', version: 'badge',
        priority: 'header', moscow: 'header',
        'status-review': 'footer', 'time-estimate': 'badge',
        'status-testing': 'footer',
        positivity: 'badge', 'teaching-platform': 'badge',
        'product-platform': 'badge',
        colors: 'background', 'colors-dark': 'background',
        'colors-light': 'background', 'colors-accessible': 'background',
        special: 'effect'
      },
      tagOverrides: null
    }
  };

  var _activeTagStylePreset = 'default';
  var _tagStyleUserOverrides = {};

  function loadTagStyleConfig() {
    try {
      var stored = localStorage.getItem('lexera-tag-style-config');
      if (stored) {
        var parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          if (parsed.preset && TAG_STYLE_PRESETS[parsed.preset]) {
            _activeTagStylePreset = parsed.preset;
          }
          if (parsed.categoryRoles && typeof parsed.categoryRoles === 'object') {
            _tagStyleUserOverrides.categoryRoles = parsed.categoryRoles;
          }
          if (parsed.tagOverrides && typeof parsed.tagOverrides === 'object') {
            _tagStyleUserOverrides.tagOverrides = parsed.tagOverrides;
          }
        }
      }
    } catch (err) {
      // ignore
    }
  }

  function saveTagStyleConfig() {
    try {
      var config = { preset: _activeTagStylePreset };
      if (_tagStyleUserOverrides.categoryRoles) config.categoryRoles = _tagStyleUserOverrides.categoryRoles;
      if (_tagStyleUserOverrides.tagOverrides) config.tagOverrides = _tagStyleUserOverrides.tagOverrides;
      localStorage.setItem('lexera-tag-style-config', JSON.stringify(config));
    } catch (err) {
      // ignore
    }
  }

  function setActiveTagStylePreset(presetId) {
    if (!TAG_STYLE_PRESETS[presetId]) return;
    _activeTagStylePreset = presetId;
    saveTagStyleConfig();
  }

  function getActiveTagStylePreset() {
    return _activeTagStylePreset;
  }

  function resolveTagStyleProperty(mapKey, entryKey, fallback) {
    if (_tagStyleUserOverrides[mapKey] && _tagStyleUserOverrides[mapKey][entryKey]) {
      return _tagStyleUserOverrides[mapKey][entryKey];
    }
    var preset = TAG_STYLE_PRESETS[_activeTagStylePreset];
    if (preset && preset[mapKey] && preset[mapKey][entryKey]) {
      return preset[mapKey][entryKey];
    }
    return fallback;
  }

  function getResolvedCategoryRole(categoryKey) {
    return resolveTagStyleProperty('categoryRoles', categoryKey, TAG_STYLE_ROLE_BY_CATEGORY[categoryKey] || '');
  }

  function getTagStyleOverride(tagNormalized) {
    return resolveTagStyleProperty('tagOverrides', tagNormalized, null);
  }

  function setUserOverrideEntry(mapKey, entryKey, value) {
    if (!_tagStyleUserOverrides[mapKey]) _tagStyleUserOverrides[mapKey] = {};
    if (value) {
      _tagStyleUserOverrides[mapKey][entryKey] = value;
    } else {
      delete _tagStyleUserOverrides[mapKey][entryKey];
      if (Object.keys(_tagStyleUserOverrides[mapKey]).length === 0) {
        delete _tagStyleUserOverrides[mapKey];
      }
    }
    saveTagStyleConfig();
  }

  function setUserCategoryRoleOverride(categoryKey, role) {
    setUserOverrideEntry('categoryRoles', categoryKey, role);
  }

  function setUserTagStyleOverride(tagNormalized, overrideObj) {
    setUserOverrideEntry('tagOverrides', tagNormalized, overrideObj);
  }

  // Load tag style config on startup
  loadTagStyleConfig();

  function getTagColor(tagName) {
    var lower = tagName.toLowerCase();
    if (TAG_COLORS[lower]) return TAG_COLORS[lower];
    var hash = 0;
    for (var i = 0; i < lower.length; i++) {
      hash = ((hash << 5) - hash) + lower.charCodeAt(i);
      hash = hash & hash;
    }
    return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
  }

  function normalizeTagCategoryName(tagName) {
    var normalized = String(tagName || '').trim().toLowerCase();
    if (!normalized) return '';
    return normalized.charAt(0) === '#' ? normalized.substring(1) : normalized;
  }

  function getTagCategoryKey(tagName) {
    var normalized = normalizeTagCategoryName(tagName);
    if (!normalized) return '';
    var keys = Object.keys(TAG_CATEGORIES);
    for (var i = 0; i < keys.length; i++) {
      var tags = TAG_CATEGORIES[keys[i]];
      if (!Array.isArray(tags)) continue;
      for (var j = 0; j < tags.length; j++) {
        if (String(tags[j]).toLowerCase() === normalized) return keys[i];
      }
    }
    return '';
  }

  function formatTagDisplayLabel(tagName) {
    var normalized = normalizeTagCategoryName(tagName);
    if (!normalized) return '';
    if (/^(?:\+\+|\+|\u00f8|-|--)$/.test(normalized)) return normalized;
    return normalized.replace(/[-_]+/g, ' ').replace(/\b([a-z])/g, function (_, ch) { return ch.toUpperCase(); });
  }

  function parseColorChannels(color) {
    var source = String(color || '').trim();
    var hexMatch = source.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      var hex = hexMatch[1];
      var isShort = hex.length === 3;
      return {
        r: parseInt(isShort ? hex.charAt(0) + hex.charAt(0) : hex.slice(0, 2), 16),
        g: parseInt(isShort ? hex.charAt(1) + hex.charAt(1) : hex.slice(2, 4), 16),
        b: parseInt(isShort ? hex.charAt(2) + hex.charAt(2) : hex.slice(4, 6), 16)
      };
    }
    var rgbMatch = source.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1], 10),
        g: parseInt(rgbMatch[2], 10),
        b: parseInt(rgbMatch[3], 10)
      };
    }
    return null;
  }

  function getContrastingTextColor(color) {
    var channels = parseColorChannels(color);
    if (!channels) return '#ffffff';
    var luminance = ((0.299 * channels.r) + (0.587 * channels.g) + (0.114 * channels.b)) / 255;
    return luminance > 0.6 ? '#111111' : '#ffffff';
  }

  function buildTagStyleDescriptor(tagName) {
    var normalized = normalizeTagCategoryName(tagName);
    if (!normalized) return null;
    var fullTag = '#' + normalized;
    var color = getTagColor(fullTag);
    var categoryKey = getTagCategoryKey(fullTag);
    var descriptor = {
      tag: fullTag,
      normalizedTag: normalized,
      category: categoryKey,
      color: color,
      border: {
        style: 'solid',
        width: '2px',
        position: 'left',
        color: color
      },
      background: null,
      headerBar: null,
      footerBar: null,
      badge: null,
      opacity: '',
      filter: '',
      pattern: ''
    };

    if (normalized === 'surface') {
      descriptor.color = 'var(--text-primary)';
      descriptor.accentSoft = 'transparent';
      descriptor.accentSoftStrong = 'transparent';
      descriptor.accentMuted = 'var(--border)';
      descriptor.border = {
        style: 'solid',
        width: '1px',
        position: 'full',
        color: 'var(--border)'
      };
      descriptor.background = {
        color: 'var(--bg-primary)',
        headerColor: 'var(--bg-primary)',
        contentColor: 'var(--bg-primary)',
        footerColor: 'var(--bg-primary)'
      };
      return descriptor;
    }

    // Check for user per-tag override first
    var tagOverride = getTagStyleOverride(normalized);
    if (tagOverride) {
      if (tagOverride.color) {
        color = tagOverride.color;
        descriptor.color = color;
        descriptor.border.color = color;
      }
      if (tagOverride.border) {
        descriptor.border.style = tagOverride.border.style || descriptor.border.style;
        descriptor.border.width = tagOverride.border.width || descriptor.border.width;
        descriptor.border.position = tagOverride.border.position || descriptor.border.position;
        if (tagOverride.border.color) descriptor.border.color = tagOverride.border.color;
      }
      if (tagOverride.headerBar) {
        var hLabel = tagOverride.headerBar.label || formatTagDisplayLabel(fullTag).toUpperCase();
        descriptor.headerBar = {
          label: hLabel,
          color: tagOverride.headerBar.color || color,
          labelColor: getContrastingTextColor(tagOverride.headerBar.color || color)
        };
      }
      if (tagOverride.footerBar) {
        var fLabel = tagOverride.footerBar.label || formatTagDisplayLabel(fullTag).toUpperCase();
        descriptor.footerBar = {
          label: fLabel,
          color: tagOverride.footerBar.color || color,
          labelColor: getContrastingTextColor(tagOverride.footerBar.color || color)
        };
      }
      if (tagOverride.badge) {
        descriptor.badge = {
          label: tagOverride.badge.label || formatTagDisplayLabel(fullTag),
          color: tagOverride.badge.color || color,
          labelColor: getContrastingTextColor(tagOverride.badge.color || color)
        };
      }
      if (tagOverride.background) {
        descriptor.background = {
          color: tagOverride.background.color || color,
          alpha: typeof tagOverride.background.alpha === 'number' ? tagOverride.background.alpha : 0.14
        };
      }
      if (tagOverride.opacity) descriptor.opacity = tagOverride.opacity;
      if (tagOverride.filter) descriptor.filter = tagOverride.filter;
      if (tagOverride.pattern) descriptor.pattern = tagOverride.pattern;
      // If override provides explicit role fields, skip category-based defaults
      if (tagOverride.headerBar || tagOverride.footerBar || tagOverride.badge ||
          tagOverride.background || tagOverride.opacity || tagOverride.pattern) {
        applyTagBorderSpecialRules(descriptor, normalized);
        return descriptor;
      }
    }

    // Resolve category role (configurable via presets and user overrides)
    var styleRole = getResolvedCategoryRole(categoryKey);
    var label = formatTagDisplayLabel(fullTag).toUpperCase();

    if (styleRole === 'background') {
      descriptor.background = {
        color: color,
        alpha: categoryKey === 'colors-light' ? 0.2 : (categoryKey === 'colors-dark' ? 0.18 : 0.14)
      };
      descriptor.border.position = 'full';
    } else if (styleRole === 'header') {
      descriptor.headerBar = {
        label: label,
        color: color,
        labelColor: getContrastingTextColor(color)
      };
    } else if (styleRole === 'footer') {
      descriptor.footerBar = {
        label: label,
        color: color,
        labelColor: getContrastingTextColor(color)
      };
    } else if (styleRole === 'badge') {
      descriptor.badge = {
        label: /^(?:\+\+|\+|\u00f8|-|--)$/.test(normalized) ? normalized : formatTagDisplayLabel(fullTag),
        color: color,
        labelColor: getContrastingTextColor(color)
      };
    } else if (styleRole === 'border-only') {
      // Only border, no bar/badge/background
    } else if (styleRole === 'effect') {
      if (normalized === 'exclude') {
        descriptor.opacity = '0.55';
        descriptor.pattern = 'stripes';
      } else if (normalized === 'private') {
        descriptor.opacity = '0.72';
        descriptor.pattern = 'stripes';
      } else if (normalized === 'draft') {
        descriptor.opacity = '0.82';
        descriptor.pattern = 'stripes-h';
      } else if (normalized === 'header') {
        descriptor.headerBar = {
          label: 'HEADER',
          color: color,
          labelColor: getContrastingTextColor(color)
        };
      } else if (normalized === 'footer') {
        descriptor.footerBar = {
          label: 'FOOTER',
          color: color,
          labelColor: getContrastingTextColor(color)
        };
      }
    }

    applyTagBorderSpecialRules(descriptor, normalized);
    return descriptor;
  }

  function cloneTagStyleValue(value) {
    if (!value || typeof value !== 'object') return value;
    var clone = {};
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) clone[keys[i]] = value[keys[i]];
    return clone;
  }

  function buildCombinedTagStyleDescriptor(tagNames) {
    if (!Array.isArray(tagNames) || tagNames.length === 0) return null;
    var descriptors = [];
    for (var i = 0; i < tagNames.length; i++) {
      var descriptor = buildTagStyleDescriptor(tagNames[i]);
      if (descriptor) descriptors.push(descriptor);
    }
    if (descriptors.length === 0) return null;

    var firstDescriptor = descriptors[0];
    var backgroundDescriptor = null;
    var borderDescriptor = null;
    var accentDescriptor = firstDescriptor;
    var headerDescriptor = null;
    var footerDescriptor = null;
    var badgeDescriptor = null;
    var opacity = '';
    var filter = '';
    var pattern = '';

    for (var j = 0; j < descriptors.length; j++) {
      var current = descriptors[j];
      if (!backgroundDescriptor && current.background) backgroundDescriptor = current;
      if (current.border && !current.background) borderDescriptor = current;
      if (!headerDescriptor && current.headerBar) headerDescriptor = current;
      if (!footerDescriptor && current.footerBar) footerDescriptor = current;
      if (!badgeDescriptor && current.badge) badgeDescriptor = current;
      if (current.opacity) opacity = current.opacity;
      if (current.filter) filter = current.filter;
      if (current.pattern) pattern = current.pattern;
    }

    if (!borderDescriptor) {
      borderDescriptor = backgroundDescriptor || firstDescriptor;
    }
    accentDescriptor = borderDescriptor || backgroundDescriptor || firstDescriptor;

    return {
      tag: firstDescriptor.tag,
      normalizedTag: firstDescriptor.normalizedTag,
      category: firstDescriptor.category,
      color: accentDescriptor.color || firstDescriptor.color,
      accentSoft: accentDescriptor.accentSoft || '',
      accentSoftStrong: accentDescriptor.accentSoftStrong || '',
      accentMuted: accentDescriptor.accentMuted || '',
      border: cloneTagStyleValue(borderDescriptor && borderDescriptor.border),
      background: cloneTagStyleValue(backgroundDescriptor && backgroundDescriptor.background),
      headerBar: cloneTagStyleValue(headerDescriptor && headerDescriptor.headerBar),
      footerBar: cloneTagStyleValue(footerDescriptor && footerDescriptor.footerBar),
      badge: cloneTagStyleValue(badgeDescriptor && badgeDescriptor.badge),
      opacity: opacity,
      filter: filter,
      pattern: pattern
    };
  }

  function buildTagStyleRenderState(styleSourceText) {
    var _root = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});
    var LexeraTagSystem = _root.LexeraTagSystem || {};
    var extractAllTags = LexeraTagSystem.extractAllTags || function () { return []; };
    var isTagStyleEligible = LexeraTagSystem.isTagStyleEligible || function () { return false; };
    var allTags = extractAllTags(styleSourceText);
    var styleTags = [];
    for (var i = 0; i < allTags.length; i++) {
      if (!isTagStyleEligible(allTags[i])) continue;
      styleTags.push(allTags[i]);
    }
    if (styleTags.length === 0) return null;
    var descriptor = buildCombinedTagStyleDescriptor(styleTags);
    if (!descriptor) return null;
    return {
      styleTags: styleTags,
      descriptor: descriptor,
      color: descriptor.color || getTagColor(styleTags[0] || '#tag')
    };
  }

  function resolveBackgroundSurfaceColors(background, fallbackColor) {
    var bgColor = background.color || fallbackColor;
    var bgAlpha = typeof background.alpha === 'number' ? background.alpha : null;
    return {
      bg: { color: bgColor, alpha: bgAlpha },
      header: {
        color: background.headerColor || bgColor,
        alpha: typeof background.headerAlpha === 'number'
          ? background.headerAlpha
          : (bgAlpha == null ? null : Math.min(bgAlpha + 0.08, 0.28))
      },
      footer: {
        color: background.footerColor || bgColor,
        alpha: typeof background.footerAlpha === 'number'
          ? background.footerAlpha
          : (bgAlpha == null ? null : Math.min(bgAlpha + 0.04, 0.24))
      },
      content: {
        color: background.contentColor || bgColor,
        alpha: typeof background.contentAlpha === 'number'
          ? background.contentAlpha
          : (bgAlpha == null ? null : Math.max(bgAlpha - 0.04, 0.08))
      }
    };
  }

  function toTagAccentRgba(color, alpha) {
    var channels = parseColorChannels(color);
    if (!channels) return String(color || '').trim();
    return 'rgba(' + channels.r + ', ' + channels.g + ', ' + channels.b + ', ' + alpha + ')';
  }

  function resolveTagSurfaceColor(color, alpha) {
    if (typeof alpha === 'number') return toTagAccentRgba(color, alpha);
    return String(color || '');
  }

  function buildTagStyleInlineCssText(styleState) {
    if (!styleState || !styleState.descriptor) return '';
    var descriptor = styleState.descriptor;
    var color = styleState.color || getTagColor('#tag');
    var declarations = [
      '--tag-accent:' + color,
      '--tag-accent-soft:' + (descriptor.accentSoft || toTagAccentRgba(color, 0.14)),
      '--tag-accent-soft-strong:' + (descriptor.accentSoftStrong || toTagAccentRgba(color, 0.24)),
      '--tag-accent-muted:' + (descriptor.accentMuted || toTagAccentRgba(color, 0.42))
    ];
    if (descriptor.border) {
      declarations.push('--tag-border-color:' + (descriptor.border.color || color));
      declarations.push('--tag-border-width:' + (descriptor.border.width || '2px'));
      declarations.push('--tag-border-style:' + (descriptor.border.style || 'solid'));
    }
    if (descriptor.background) {
      var surfaces = resolveBackgroundSurfaceColors(descriptor.background, color);
      declarations.push('--tag-surface-bg:' + resolveTagSurfaceColor(surfaces.bg.color, surfaces.bg.alpha));
      declarations.push('--tag-surface-header-bg:' + resolveTagSurfaceColor(surfaces.header.color, surfaces.header.alpha));
      declarations.push('--tag-surface-footer-bg:' + resolveTagSurfaceColor(surfaces.footer.color, surfaces.footer.alpha));
      declarations.push('--tag-surface-content-bg:' + resolveTagSurfaceColor(surfaces.content.color, surfaces.content.alpha));
    }
    if (descriptor.opacity) declarations.push('--tag-effect-opacity:' + descriptor.opacity);
    if (descriptor.filter) declarations.push('--tag-effect-filter:' + descriptor.filter);
    return declarations.join(';');
  }

  function buildTagStyledLineHtml(tagName, innerHtml, styleSourceText, options) {
    var escapeHtml = deps.escapeHtml || function (s) { return s; };
    var escapeAttr = deps.escapeAttr || function (s) { return s; };
    options = options || {};
    var styleState = buildTagStyleRenderState(styleSourceText);
    var classNames = [];
    if (options.className) classNames.push(options.className);
    if (styleState) {
      classNames.push('tag-line-styled');
      if (styleState.descriptor.pattern === 'stripes') classNames.push('tag-style-pattern-stripes');
      if (styleState.descriptor.pattern === 'stripes-h') classNames.push('tag-style-pattern-stripes-h');
    }
    var attrs = [];
    if (classNames.length > 0) attrs.push('class="' + escapeAttr(classNames.join(' ')) + '"');
    if (options.attrs) attrs.push(options.attrs);
    if (styleState && styleState.descriptor && styleState.descriptor.border && styleState.descriptor.border.position) {
      attrs.push('data-tag-border-position="' + escapeAttr(styleState.descriptor.border.position || 'left') + '"');
    }
    var styleText = styleState ? buildTagStyleInlineCssText(styleState) : '';
    if (options.styleText) styleText = styleText ? (options.styleText + ';' + styleText) : options.styleText;
    if (styleText) attrs.push('style="' + escapeAttr(styleText) + '"');
    var attrText = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    if (options.selfClosing) return '<' + tagName + attrText + '>';
    return '<' + tagName + attrText + '>' + innerHtml + '</' + tagName + '>';
  }

  function wrapRenderedLineBlockHtml(blockHtml, styleSourceText) {
    var styleState = buildTagStyleRenderState(styleSourceText);
    if (!styleState) return blockHtml;
    return buildTagStyledLineHtml('div', blockHtml, styleSourceText, { className: 'card-line-scope' });
  }

  function applyTagBorderSpecialRules(descriptor, normalized) {
    if (normalized === 'critical' || normalized === 'urgent' || normalized === 'blocked') {
      descriptor.border.width = '3px';
      descriptor.border.style = 'dashed';
    } else if (normalized === 'wip' || normalized === 'done' || normalized === 'stopped') {
      descriptor.border.position = 'full';
    } else if (normalized === 'normal' || normalized === 'todo') {
      descriptor.border.style = 'dotted';
    }
  }

  return {
    init: function (d) { deps = d || {}; },
    TAG_COLORS: TAG_COLORS,
    TAG_PALETTE: TAG_PALETTE,
    TAG_CATEGORIES: TAG_CATEGORIES,
    TAG_STYLE_ROLE_BY_CATEGORY: TAG_STYLE_ROLE_BY_CATEGORY,
    TAG_STYLE_PRESETS: TAG_STYLE_PRESETS,
    getTagColor: getTagColor,
    parseColorChannels: parseColorChannels,
    getContrastingTextColor: getContrastingTextColor,
    formatTagDisplayLabel: formatTagDisplayLabel,
    normalizeTagCategoryName: normalizeTagCategoryName,
    getTagCategoryKey: getTagCategoryKey,
    buildTagStyleDescriptor: buildTagStyleDescriptor,
    buildCombinedTagStyleDescriptor: buildCombinedTagStyleDescriptor,
    buildTagStyleRenderState: buildTagStyleRenderState,
    resolveBackgroundSurfaceColors: resolveBackgroundSurfaceColors,
    buildTagStyleInlineCssText: buildTagStyleInlineCssText,
    buildTagStyledLineHtml: buildTagStyledLineHtml,
    wrapRenderedLineBlockHtml: wrapRenderedLineBlockHtml,
    loadTagStyleConfig: loadTagStyleConfig,
    getActiveTagStylePresetId: getActiveTagStylePreset,
    setActiveTagStylePreset: setActiveTagStylePreset,
    getTagStyleOverride: getTagStyleOverride,
    setUserTagStyleOverride: setUserTagStyleOverride,
    getResolvedCategoryRole: getResolvedCategoryRole,
    setUserCategoryRoleOverride: setUserCategoryRoleOverride,
    applyTagBorderSpecialRules: applyTagBorderSpecialRules,
    toTagAccentRgba: toTagAccentRgba,
    resolveTagSurfaceColor: resolveTagSurfaceColor,
  };
}));
