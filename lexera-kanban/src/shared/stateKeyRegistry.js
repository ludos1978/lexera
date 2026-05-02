/**
 * Lexera State Key Registry
 *
 * Documents ALL localStorage keys used across the lexera-kanban frontend.
 * This file is for reference/auditing only — it does not affect runtime behavior.
 *
 * Categories:
 *   'preference'  — User preference persisted across sessions (theme, scale, editor mode)
 *   'ephemeral'   — Transient UI state that could be lost without harm (last board, sidebar width)
 *   'boardState'  — Per-board state keyed by board ID (fold state, card collapse, drafts)
 *   'internal'    — Migration flags, version markers, legacy keys
 *   'testing'     — Keys used only by the test harness
 *
 * Managed by Settings Store:
 *   Keys marked `settingsStore: true` are registered in core/settingsStore.js (DEFS / BOARD_DEFS / SCOPED_DEFS).
 *   The Settings wrapper provides typed get/set, defaults, and change notifications.
 *   Direct localStorage fallback is used when Settings is not yet loaded.
 */
var LexeraStateKeyRegistry = {

  // ═══════════════════════════════════════════════════════════════════
  //  APPEARANCE
  // ═══════════════════════════════════════════════════════════════════

  'lexera-visual-theme': {
    type: 'string',
    category: 'preference',
    default: 'classic',
    description: 'Active visual theme ID (e.g. "classic", "sleek-uniform")',
    files: ['app.js', 'appearance/appearance.js', 'visualThemes.js'],
    settingsStore: true
  },

  'lexera-theme': {
    type: 'string',
    category: 'preference',
    default: 'lexera',
    description: 'Color theme ID (e.g. "lexera", "dark", "light")',
    files: ['appearance/appearance.js', 'themes.js'],
    settingsStore: true
  },

  'lexera-ui-scale': {
    type: 'number',
    category: 'preference',
    default: 0.95,
    description: 'Global UI zoom / scale factor',
    files: ['appearance/appearance.js'],
    settingsStore: true
  },

  'lexera-overlay-editor-enabled': {
    type: 'boolean',
    category: 'preference',
    default: true,
    description: 'Whether the overlay (Excalidraw) editor is enabled',
    files: ['appearance/appearance.js'],
    settingsStore: true
  },

  'lexera-show-special-characters': {
    type: 'boolean',
    category: 'preference',
    default: false,
    description: 'Show invisible / special characters in rendered content',
    files: ['appearance/appearance.js'],
    settingsStore: true
  },

  // ═══════════════════════════════════════════════════════════════════
  //  SIDEBAR
  // ═══════════════════════════════════════════════════════════════════

  'lexera-sidebar-split-ratio:{windowScope}': {
    type: 'number',
    category: 'ephemeral',
    default: 0.58,
    description: 'Ratio of sidebar vertical split between tree and detail pane (per workspace; falls back to per-window for unpinned windows)',
    files: ['app.js', 'sidebar/sidebarResize.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-sidebar-width:{windowScope}': {
    type: 'number',
    category: 'ephemeral',
    default: 220,
    description: 'Sidebar width in pixels (per workspace; falls back to per-window for unpinned windows)',
    files: ['app.js', 'sidebar/sidebarResize.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-sidebar-sync': {
    type: 'boolean',
    category: 'preference',
    default: false,
    description: 'Whether sidebar tree auto-syncs to card selection',
    files: ['sidebar/sidebarSync.js'],
    settingsStore: true
  },

  'lexera-hierarchy-locked:{windowScope}': {
    type: 'boolean',
    category: 'preference',
    default: false,
    description: 'Whether hierarchy editing is locked (read-only mode) — per workspace; falls back to per-window for unpinned windows',
    files: ['app.js', 'sidebar/sidebarSync.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-sidebar-expanded': {
    type: 'json',
    category: 'ephemeral',
    default: [],
    description: 'Array of expanded sidebar node IDs (legacy key)',
    files: ['board/boardList.js'],
    settingsStore: true
  },

  'lexera-sidebar-tree-state': {
    type: 'json',
    category: 'ephemeral',
    default: {},
    description: 'Per-board sidebar tree expansion state object',
    files: ['board/boardList.js', 'board/orderHelpers.js'],
    settingsStore: true
  },

  'lexera-sidebar-tree-display': {
    type: 'json',
    category: 'preference',
    default: {},
    description: 'Sidebar tree display options (show tags, counts, etc.)',
    files: ['appearance/appearance.js'],
    settingsStore: true
  },

  // ═══════════════════════════════════════════════════════════════════
  //  HEADER & SEARCH
  // ═══════════════════════════════════════════════════════════════════

  'lexera-header-search-expanded': {
    type: 'boolean',
    category: 'ephemeral',
    default: false,
    description: 'Whether the header search bar is expanded',
    files: ['app.js', 'board/orderHelpers.js'],
    settingsStore: true
  },

  // ═══════════════════════════════════════════════════════════════════
  //  NAVIGATION
  // ═══════════════════════════════════════════════════════════════════

  'lexera-active-workspace': {
    type: 'string',
    category: 'ephemeral',
    default: '',
    description: 'Currently selected workspace ID',
    files: ['app.js', 'board/boardList.js'],
    settingsStore: true
  },

  'lexera-recent-boards': {
    type: 'json',
    category: 'ephemeral',
    default: [],
    description: 'Array of recently opened board IDs (most recent first)',
    files: ['app.js'],
    settingsStore: false
  },

  // ═══════════════════════════════════════════════════════════════════
  //  DASHBOARD
  // ═══════════════════════════════════════════════════════════════════

  'lexera-dashboard-query:{windowScope}': {
    type: 'string',
    category: 'ephemeral',
    default: '',
    description: 'Current dashboard search query text — per workspace; falls back to per-window for unpinned windows',
    files: ['app.js', 'board/orderHelpers.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-dashboard-scope:{windowScope}': {
    type: 'string',
    category: 'ephemeral',
    default: '',
    description: 'Dashboard scope filter ("all" or "active") — per workspace; falls back to per-window',
    files: ['app.js', 'board/orderHelpers.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-dashboard-active-pinned:{windowScope}': {
    type: 'string',
    category: 'ephemeral',
    default: '',
    description: 'Currently active pinned query name in dashboard — per workspace; falls back to per-window',
    files: ['app.js', 'board/orderHelpers.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-dashboard-pinned-queries:{windowScope}': {
    type: 'json',
    category: 'preference',
    default: [],
    description: 'Array of saved/pinned dashboard search queries — per workspace; falls back to per-window',
    files: ['board/orderHelpers.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-dashboard-tags:{windowScope}': {
    type: 'json',
    category: 'ephemeral',
    default: [],
    description: 'Dashboard tag filter selections — per workspace; falls back to per-window',
    files: ['board/orderHelpers.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-dashboard-collapsed:{windowScope}': {
    type: 'json',
    category: 'ephemeral',
    default: {},
    description: 'Dashboard section collapsed/expanded state map — per workspace; falls back to per-window',
    files: ['board/orderHelpers.js'],
    settingsStore: true,
    parameterized: true
  },

  // ═══════════════════════════════════════════════════════════════════
  //  BOARD ORDERING
  // ═══════════════════════════════════════════════════════════════════

  'lexera-board-order': {
    type: 'json',
    category: 'ephemeral',
    default: [],
    description: 'Custom board ordering (array of board IDs)',
    files: ['board/orderHelpers.js', 'board/boardList.js'],
    settingsStore: true
  },

  // ═══════════════════════════════════════════════════════════════════
  //  EDITOR
  // ═══════════════════════════════════════════════════════════════════

  'lexera-card-editor-mode': {
    type: 'string',
    category: 'preference',
    default: 'dual',
    description: 'Card editor mode ("dual", "source", "preview")',
    files: ['editor/cardEditor.js'],
    settingsStore: true
  },

  'lexera-card-editor-font-scale': {
    type: 'number',
    category: 'preference',
    default: 1,
    description: 'Font scale multiplier for the card editor',
    files: ['editor/cardEditor.js'],
    settingsStore: true
  },

  // ═══════════════════════════════════════════════════════════════════
  //  TAG STYLING
  // ═══════════════════════════════════════════════════════════════════

  'lexera-tag-color-overrides': {
    type: 'json',
    category: 'preference',
    default: {},
    description: 'User-defined tag-to-color mapping overrides',
    files: ['app.js', 'tagcolors/tagColors.js'],
    settingsStore: true
  },

  'lexera-tag-style-config': {
    type: 'json',
    category: 'preference',
    default: {},
    description: 'Tag visual style configuration (shape, size, palette)',
    files: ['tagcolors/tagColors.js'],
    settingsStore: true
  },

  // ═══════════════════════════════════════════════════════════════════
  //  LAYOUT
  // ═══════════════════════════════════════════════════════════════════

  'lexera-layout-presets': {
    type: 'json',
    category: 'preference',
    default: {},
    description: 'Saved board layout presets (named layout configurations)',
    files: ['app.js'],
    settingsStore: true
  },

  'lexera-dock-panel': {
    type: 'string',
    category: 'ephemeral',
    default: '',
    description: 'Currently docked panel kind (e.g. "frontendSettings")',
    files: ['app.js', 'workspace/workspaceShell.js'],
    settingsStore: true
  },

  // ═══════════════════════════════════════════════════════════════════
  //  LOGGING
  // ═══════════════════════════════════════════════════════════════════

  'lexera-log-source:{windowScope}': {
    type: 'string',
    category: 'ephemeral',
    default: '',
    description: 'Active log source filter — per workspace; falls back to per-window for unpinned windows',
    files: ['logging/loggingSystem.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-log-categories:{windowScope}': {
    type: 'string',
    category: 'ephemeral',
    default: null,
    description: 'Comma-separated list of active log-source categories (absent = all, empty = none) — per workspace',
    files: ['logging/loggingSystem.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-log-levels:{windowScope}': {
    type: 'string',
    category: 'ephemeral',
    default: null,
    description: 'Comma-separated list of active log levels (absent = all, empty = none) — per workspace',
    files: ['logging/loggingSystem.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-log-search:{windowScope}': {
    type: 'string',
    category: 'ephemeral',
    default: '',
    description: 'Free-text log search filter — per workspace',
    files: ['logging/loggingSystem.js'],
    settingsStore: true,
    parameterized: true
  },

  // ═══════════════════════════════════════════════════════════════════
  //  CUSTOM URLS
  // ═══════════════════════════════════════════════════════════════════

  'lexera-mermaid-url': {
    type: 'string',
    category: 'preference',
    default: '',
    description: 'Custom Mermaid.js CDN URL override',
    files: ['utils/appUtils.js'],
    settingsStore: true
  },

  // ═══════════════════════════════════════════════════════════════════
  //  BOARD DEFAULTS (global defaults applied to new/unset boards)
  // ═══════════════════════════════════════════════════════════════════

  'lexera-default-scrollSpeed': {
    type: 'string',
    category: 'preference',
    default: '1',
    description: 'Default scroll speed for boards without a per-board override',
    files: ['app.js'],
    settingsStore: false
  },

  'lexera-default-zoomSpeed': {
    type: 'string',
    category: 'preference',
    default: '0.06',
    description: 'Default zoom speed for boards without a per-board override',
    files: ['app.js'],
    settingsStore: false
  },

  'lexera-default-tagVisibility': {
    type: 'string',
    category: 'preference',
    default: 'allexcludinglayout',
    description: 'Default tag visibility mode for boards ("allexcludinglayout", "all", "none")',
    files: ['app.js'],
    settingsStore: false
  },

  'lexera-default-htmlCommentRenderMode': {
    type: 'string',
    category: 'preference',
    default: 'hidden',
    description: 'Default HTML comment render mode ("hidden", "dim", "visible")',
    files: ['app.js'],
    settingsStore: false
  },

  'lexera-default-htmlContentRenderMode': {
    type: 'string',
    category: 'preference',
    default: 'html',
    description: 'Default HTML content render mode ("html", "source")',
    files: ['app.js'],
    settingsStore: false
  },

  // ═══════════════════════════════════════════════════════════════════
  //  PER-BOARD STATE (keyed by board ID, pattern: "key:{boardId}")
  //  These are registered in settingsStore.js BOARD_DEFS
  // ═══════════════════════════════════════════════════════════════════

  'lexera-card-collapsed:{boardId}': {
    type: 'json',
    category: 'boardState',
    default: [],
    description: 'Array of collapsed card IDs for the given board',
    files: ['board/cardCollapse.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-board-draft:{boardId}': {
    type: 'json',
    category: 'boardState',
    default: null,
    description: 'Unsaved draft payload for a board (auto-saved editor content)',
    files: ['board/boardList.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-board-scroll-speed:{boardId}': {
    type: 'string',
    category: 'boardState',
    default: '1',
    description: 'Per-board scroll speed override',
    files: ['core/settingsStore.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-board-zoom-speed:{boardId}': {
    type: 'string',
    category: 'boardState',
    default: '0.06',
    description: 'Per-board zoom speed override',
    files: ['core/settingsStore.js'],
    settingsStore: true,
    parameterized: true
  },

  'lexera-col-fold:{boardId}': {
    type: 'json',
    category: 'boardState',
    default: [],
    description: 'Array of folded column fold-keys for the given board',
    files: ['fold/foldState.js'],
    settingsStore: false,
    parameterized: true
  },

  'lexera-row-fold:{boardId}': {
    type: 'json',
    category: 'boardState',
    default: [],
    description: 'Array of folded row fold-keys for the given board',
    files: ['fold/foldState.js'],
    settingsStore: false,
    parameterized: true
  },

  'lexera-stack-fold:{boardId}': {
    type: 'json',
    category: 'boardState',
    default: [],
    description: 'Array of folded stack fold-keys for the given board',
    files: ['fold/foldState.js'],
    settingsStore: false,
    parameterized: true
  },

  // ═══════════════════════════════════════════════════════════════════
  //  SCOPED KEYS (pattern: "key-{scope}")
  //  Registered in settingsStore.js SCOPED_DEFS
  // ═══════════════════════════════════════════════════════════════════

  'lexera-tag-groups-{scope}': {
    type: 'json',
    category: 'preference',
    default: [],
    description: 'Tag grouping definitions per scope (e.g. per-board or global)',
    files: ['menu/contextMenuBuilders.js'],
    settingsStore: true,
    parameterized: true
  },

  // ═══════════════════════════════════════════════════════════════════
  //  LEGACY / MIGRATION KEYS
  //  These are read once for migration and then removed.
  // ═══════════════════════════════════════════════════════════════════

  'lexera-card-expanded:{boardId}': {
    type: 'json',
    category: 'internal',
    default: [],
    description: 'LEGACY: old expanded-cards list, migrated to lexera-card-collapsed:{boardId} and removed',
    files: ['board/cardCollapse.js'],
    settingsStore: false,
    parameterized: true,
    legacy: true
  },

  'lexera-ui-template': {
    type: 'string',
    category: 'internal',
    default: '',
    description: 'LEGACY: old UI template name, read for migration to visual themes',
    files: ['visualThemes.js'],
    settingsStore: false,
    legacy: true
  },

  'lexera-board-theme': {
    type: 'string',
    category: 'internal',
    default: '',
    description: 'LEGACY: old board theme name, read for migration to visual themes',
    files: ['visualThemes.js'],
    settingsStore: false,
    legacy: true
  },

  'lexera-sidebar-tree-default-v2': {
    type: 'string',
    category: 'internal',
    default: '',
    description: 'Migration version flag for sidebar tree defaults (set to "1" after migration)',
    files: ['board/orderHelpers.js'],
    settingsStore: false
  },

  // ═══════════════════════════════════════════════════════════════════
  //  TESTING
  // ═══════════════════════════════════════════════════════════════════

  'lexera-frontend-tests-board': {
    type: 'string',
    category: 'testing',
    default: '',
    description: 'Board ID used by the frontend test harness',
    files: ['test/frontendTests.js'],
    settingsStore: false
  }
};

if (typeof window !== 'undefined') window.LexeraStateKeyRegistry = LexeraStateKeyRegistry;
