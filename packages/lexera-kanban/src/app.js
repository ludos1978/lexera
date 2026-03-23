
/**
 * Lexera Kanban — Board viewer with markdown rendering.
 * Uses LexeraApi from api.js.
 */
const LexeraDashboard = (function () {
  var PathUtils = window.LexeraPathUtils;

  // State
  let boards = [];
  let remoteBoards = [];
  let workspaces = [];
  const ALL_WORKSPACES_ID = '__all__';
  let activeWorkspaceId = localStorage.getItem('lexera-active-workspace') || null;
  let activeBoardId = null;
  let activeBoardData = null;
  let fullBoardData = null;
  // boardHierarchyCache is now owned by LexeraBoardList module
  let connected = false;
  let boardLoadSeq = 0;
  let searchMode = false;
  let searchResults = null;
  var columnSortState = {};
  let pollInterval = null;
  let addCardColumn = null;
  // ptrDrag state now lives in DragDropHandlers module
  var isEditing = false;
  var currentCardEditor = null;
  var InlineCardEditorModule = window.InlineCardEditor;
  var cardEditorMode = null;
  var cardEditorFontScale = 1;
  var pendingExternalRebaseConflict = null;
  var pendingRefresh = false;
  var eventSource = null;
  var lastSaveTime = 0;
  var SAVE_DEBOUNCE_MS = 2000;
  var liveSyncState = null;
  var liveSyncLastLocalBroadcastAt = 0;
  var liveDraftSyncTimer = null;
  var liveDraftSyncRequest = null;
  var undoStack = [];
  var redoStack = [];
  var MAX_UNDO = 30;
  var MAX_UNDO_BYTES = 10 * 1024 * 1024;
  var undoTotalBytes = 0;
  var undoPendingSnapshot = null; // snapshot taken before the last mutation, awaiting delta computation
  var SidebarSync = window.LexeraSidebarSync;
  var DiagramRegistry = window.LexeraDiagramRegistry;
  var CardContentRenderer = window.LexeraCardContentRenderer;
  var ContentEnhancerRegistry = window.LexeraContentEnhancerRegistry;
  var ActionRegistry = window.LexeraActionRegistry;
  var BoardSettingRegistry = window.LexeraBoardSettingRegistry;
  var MenuContributorRegistry = window.LexeraMenuContributorRegistry;
  var TreeView = window.TreeView || null;
  var VirtualScroll = window.LexeraVirtualScroll;
  if (VirtualScroll) VirtualScroll.init({
    getColumnsContainer: function() { return getElColumnsContainer(); },
    getCurrentCardEditor: function() { return currentCardEditor; },
    getPtrDrag: function() { return DragDropHandlers ? DragDropHandlers.getPtrDrag() : null; },
    getCardDrag: function() { return DragDropHandlers ? DragDropHandlers.getCardDrag() : null; }
  });
  var DropZoneIndicators = window.LexeraDropZoneIndicators;
  if (DropZoneIndicators) DropZoneIndicators.init({
    getElColumnsContainer: function() { return getElColumnsContainer(); },
    isHorizontalCanvasStack: function(stackEl) { return isHorizontalCanvasStackElement(stackEl); }
  });
  if (SidebarSync) SidebarSync.init({
    getFocusedCardEl: function () { return focusedCardEl; },
    getElColumnsContainer: function () { return getElColumnsContainer(); },
    getElBoardList: function () { return getElBoardList(); },
    getSidebarTreeOwnerNode: function (el) { return getSidebarTreeOwnerNode(el); },
    renderBoardList: function () { renderBoardList(); },
    buildSidebarHierarchyDisplayMenuItems: function () { return buildSidebarHierarchyDisplayMenuItems(); },
    formatMenuToggleLabel: function (on, label) { return formatMenuToggleLabel(on, label); },
    showNativeMenu: function (items, x, y, id) { return showNativeMenu(items, x, y, id); },
    getActionRegistry: function () { return ActionRegistry; }
  });

  var DragDropHandlers = window.LexeraDragDropHandlers;
  if (DragDropHandlers) DragDropHandlers.init({
    getElColumnsContainer: function() { return getElColumnsContainer(); },
    getElBoardList: function() { return getElBoardList(); },
    getActiveBoardId: function() { return activeBoardId; },
    getFullBoardData: function() { return fullBoardData; },
    is_archived_or_deleted: function(text) { return is_archived_or_deleted(text); },
    getBoardHierarchyRows: function(boardId) { return getBoardHierarchyRows(boardId); },
    findFullDataStack: function(rowIdx, stackIdx) { return findFullDataStack(rowIdx, stackIdx); },
    findFullColumnIndexInStack: function(stack, colIdx) { return findFullColumnIndexInStack(stack, colIdx); },
    findFullDataRow: function(rowIdx) { return findFullDataRow(rowIdx); },
    findFullDataStackIndex: function(row, rowIdx, stackIdx) { return findFullDataStackIndex(row, rowIdx, stackIdx); },
    insertDropZoneIndicators: function(dragType) { insertDropZoneIndicators(dragType); },
    removeDropZoneIndicators: function() { removeDropZoneIndicators(); },
    clearDropZoneIndicatorHighlights: function() { clearDropZoneIndicatorHighlights(); },
    highlightDropZoneIndicator: function(dragType, mx, my) { highlightDropZoneIndicator(dragType, mx, my); },
    insertStackDropZones: function() { insertStackDropZones(); },
    removeStackDropZones: function() { removeStackDropZones(); },
    vsRestoreAfterDrag: function() { vsRestoreAfterDrag(); },
    tagCard: function(colIdx, cardIdx, tag) { tagCard(colIdx, cardIdx, tag); },
    moveCard: function(source, target) { return moveCard(source, target); },
    logFrontendIssue: function(level, area, msg, err) { logFrontendIssue(level, area, msg, err); },
    lexeraLog: function(level, msg) { lexeraLog(level, msg); },
    poll: function() { poll(); },
    reorderRows: function(srcIdx, targetIdx, before) { reorderRows(srcIdx, targetIdx, before); },
    moveRowAcrossBoards: function(src, target) { return moveRowAcrossBoards(src, target); },
    moveStack: function(srcRow, srcStack, targetRow, targetStack, before) { moveStack(srcRow, srcStack, targetRow, targetStack, before); },
    moveStackAcrossBoards: function(src, target) { return moveStackAcrossBoards(src, target); },
    moveColumnToNewStack: function(srcRow, srcStack, srcCol, targetRow, insertIdx) { moveColumnToNewStack(srcRow, srcStack, srcCol, targetRow, insertIdx); },
    moveColumnWithinBoard: function(srcRow, srcStack, srcCol, targetRow, targetStack, targetCol, before) { moveColumnWithinBoard(srcRow, srcStack, srcCol, targetRow, targetStack, targetCol, before); },
    moveColumnToExistingStack: function(srcRow, srcStack, srcCol, targetRow, targetStack) { moveColumnToExistingStack(srcRow, srcStack, srcCol, targetRow, targetStack); },
    moveColumnAcrossBoards: function(src, target) { return moveColumnAcrossBoards(src, target); },
    reorderBoards: function(srcIdx, targetIdx, before) { reorderBoards(srcIdx, targetIdx, before); },
    isCanvasBoardLayout: function() { return isCanvasBoardLayout(); },
    isHorizontalCanvasStackElement: function(stackEl) { return isHorizontalCanvasStackElement(stackEl); },
    getCanvasStackDropApi: function() { return getCanvasStackDropApi(); },
    getCanvasDomApi: function() { return getCanvasDomApi(); },
    getCanvasPositionFromViewportPoint: function(rowContent, x, y, grabX, grabY) { return getCanvasPositionFromViewportPoint(rowContent, x, y, grabX, grabY); },
    pushUndo: function() { pushUndo(); },
    persistBoardMutation: function(opts) { return persistBoardMutation(opts); },
    removeEmptyStacksAndRows: function() { removeEmptyStacksAndRows(); },
    setRowHiddenTag: function(rowIdx, tag) { return setRowHiddenTag(rowIdx, tag); },
    setStackHiddenTag: function(rowIdx, stackIdx, tag) { return setStackHiddenTag(rowIdx, stackIdx, tag); },
    applyInternalHiddenTag: function(title, tag) { return applyInternalHiddenTag(title, tag); },
    renderColumns: function() { renderColumns(); }
  });
  if (InlineCardEditorModule) InlineCardEditorModule.init({
    getCurrentCardEditor: function() { return currentCardEditor; },
    getFullBoardData: function() { return fullBoardData; },
    getFullColumn: function(idx) { return getFullColumn(idx); },
    getFullCardIndex: function(col, visIdx) { return getFullCardIndex(col, visIdx); },
    escapeAttr: function(s) { return escapeAttr(s); },
    setIsEditing: function(v) { isEditing = v; },
    LexeraApi: LexeraApi,
    getSyncUserName: function() { return syncUserName; },
    getSyncUserId: function() { return syncUserId; },
    queueCardDraftLiveSync: function(ci, fi, c) { queueCardDraftLiveSync(ci, fi, c); },
    queueEditingPresenceBroadcast: function(kid, pos, typing) { queueEditingPresenceBroadcast(kid, pos, typing); },
    handleTextareaTabIndent: function(e, ta) { return handleTextareaTabIndent(e, ta); },
    insertFormatting: function(ta, fmt) { insertFormatting(ta, fmt); },
    resolveDropContent: function(dt) { return resolveDropContent(dt); },
    handleEditorPasteImage: function(e, ta) { handleEditorPasteImage(e, ta); },
    clearEditingPresenceQueue: function() { clearEditingPresenceQueue(); },
    clearPendingCardDraftSync: function() { clearPendingCardDraftSync(); },
    saveCardEdit: function(el, ci, fi, val) { return saveCardEdit(el, ci, fi, val); },
    renderCardDisplayState: function(el, content) { renderCardDisplayState(el, content); },
    revertCardDraftLiveSync: function(ci, fi, orig) { return revertCardDraftLiveSync(ci, fi, orig); },
    flushDeferredBoardRefresh: function(opts) { return flushDeferredBoardRefresh(opts); }
  });
  var CanvasLayout = window.LexeraCanvasLayout;
  if (CanvasLayout) CanvasLayout.init({
    stripLayoutTags: function(title) { return stripLayoutTags(title); },
    getCanvasColumnWidthSpec: function(value) { return getCanvasColumnWidthSpec(value); }
  });
  if (window.BoardSearchReplace) window.BoardSearchReplace.init({
    getFullBoardData: function () { return fullBoardData; },
    getActiveBoardId: function () { return activeBoardId; },
    getAllColumnsFromBoardData: function (bd) { return getAllColumnsFromBoardData(bd); },
    pushUndo: function () { pushUndo(); },
    persistBoardMutation: function () { return persistBoardMutation(); },
    showNotification: function (msg) { showNotification(msg); }
  });
  var BoardStatsFilter = window.BoardStatsFilter;
  if (BoardStatsFilter) BoardStatsFilter.init({
    getElColumnsContainer: function() { return getElColumnsContainer(); },
    getElBoardHeader: function() { return getElBoardHeader(); },
    getFullColumn: function(idx) { return getFullColumn(idx); },
    getFullBoardData: function() { return fullBoardData; },
    getAllColumnsFromBoardData: function(bd) { return getAllColumnsFromBoardData(bd); },
    hasInternalHiddenTag: function(content, tag) { return hasInternalHiddenTag(content, tag); },
    countCheckboxes: function(content) { return countCheckboxes(content); },
    collectHeaderTagTokens: function(content, opts) { return collectHeaderTagTokens(content, opts); },
    escapeHtml: function(str) { return escapeHtml(str); }
  });
  if (BoardList) BoardList.init({
    TreeView: TreeView,
    SidebarSync: SidebarSync,
    LexeraApi: LexeraApi,
    get activeBoardId() { return activeBoardId; },
    get activeBoardData() { return activeBoardData; },
    get fullBoardData() { return fullBoardData; },
    get liveSyncState() { return liveSyncState; },
    get boards() { return boards; },
    get remoteBoards() { return remoteBoards; },
    get workspaces() { return workspaces; },
    get activeWorkspaceId() { return activeWorkspaceId; },
    get ALL_WORKSPACES_ID() { return ALL_WORKSPACES_ID; },
    get boardPresenceCache() { return boardPresenceCache; },
    get _lastLoadedRevision() { return _lastLoadedRevision; },
    get _saveInFlight() { return _saveInFlight; },
    get workspaceShellEnabled() { return workspaceShellEnabled; },
    get WorkspaceShell() { return WorkspaceShell; },
    get hasTauri() { return hasTauri; },
    setFullBoardData: function (v) { fullBoardData = v; },
    setActiveBoardId: function (v) { activeBoardId = v; },
    setActiveBoardData: function (v) { activeBoardData = v; },
    setBoards: function (v) { boards = v; },
    setActiveWorkspaceIdState: function (v) { activeWorkspaceId = v; },
    setLastLoadedGeneration: function (v) { _lastLoadedGeneration = v; },
    setLastLoadedRevision: function (v) { _lastLoadedRevision = v; },
    setPendingExternalRebaseConflict: function (v) { pendingExternalRebaseConflict = v; },
    getSidebarTreeApi: function () { return getSidebarTreeApi(); },
    stripLayoutTags: function (t) { return stripLayoutTags(t); },
    getDisplayOrderedColumnEntries: function (cols, opts) { return getDisplayOrderedColumnEntries(cols, opts); },
    getOrderedItems: function (items, key, fn) { return getOrderedItems(items, key, fn); },
    getAllColumnsFromBoardData: function (bd) { return getAllColumnsFromBoardData(bd); },
    isRemoteBoardId: function (id) { return isRemoteBoardId(id); },
    hasTag: function (text, tag) { return hasTag(text, tag); },
    stripStackTag: function (title) { return stripStackTag(title); },
    ensureBoardRowsForMutation: function (bd, t) { ensureBoardRowsForMutation(bd, t); },
    getMutationBoardTitle: function (id, bd) { return getMutationBoardTitle(id, bd); },
    isBoardDirty: function () { return isBoardDirty(); },
    clearBoardDirty: function () { clearBoardDirty(); },
    markBoardDirty: function () { markBoardDirty(); },
    updateDisplayFromFullBoard: function () { updateDisplayFromFullBoard(); },
    renderMainView: function () { renderMainView(); },
    applyBoardSettings: function () { applyBoardSettings(); },
    renderColumns: function () { renderColumns(); },
    refreshHeaderFileControls: function () { refreshHeaderFileControls(); },
    scheduleDashboardRefresh: function (ms) { scheduleDashboardRefresh(ms); },
    showNotification: function (msg) { showNotification(msg); },
    showConfirmDialog: function (msg) { return showConfirmDialog(msg); },
    showExternalRebaseConflictDialog: function (r) { showExternalRebaseConflictDialog(r); },
    cleanupBoardBeforeSidebarClose: function (id) { return cleanupBoardBeforeSidebarClose(id); },
    getDisplayNameFromPath: function (p) { return getDisplayNameFromPath(p); },
    escapeHtml: function (s) { return escapeHtml(s); },
    getCreationEntityDragIconSvg: function (t) { return getCreationEntityDragIconSvg(t); },
    targetClosest: function (t, s) { return targetClosest(t, s); },
    exitSearchMode: function () { exitSearchMode(); },
    selectBoard: function (id) { selectBoard(id); },
    showNativeMenu: function (items, x, y) { return showNativeMenu(items, x, y); },
    tauriInvoke: function (cmd, args) { return tauriInvoke(cmd, args); },
    openConnectionWindow: function () { openConnectionWindow(); },
    showInFinder: function (p) { showInFinder(p); },
    poll: function () { poll(); },
    applyVisualTheme: function (id) { applyVisualTheme(id); },
    getSharedPanelRoots: function (kind) { return getSharedPanelRoots(kind); },
    showSidebarHierarchyMenu: function (el) { showSidebarHierarchyMenu(el); },
    buildHierarchyFocusTargetFromTreeNode: function (node, bid) { return buildHierarchyFocusTargetFromTreeNode(node, bid); },
    navigateToHierarchyTarget: function (target) { return navigateToHierarchyTarget(target); }
  });
  if (KeyboardNav) KeyboardNav.init({
    getElColumnsContainer: function() { return getElColumnsContainer(); },
    getActiveBoardColumns: function() { return activeBoardData ? activeBoardData.columns : []; },
    getIsEditing: function() { return isEditing; },
    getSearchMode: function() { return searchMode; },
    getMgmtPanelOpen: function() { return mgmtPanelOpen; },
    getCurrentArrowKeyFocusScrollMode: function() { return currentArrowKeyFocusScrollMode; },
    moveCard: function(sci, scj, tci, tcj) { return moveCard(sci, scj, tci, tcj); },
    openCardEditor: function(el, ci, cj, mode) { openCardEditor(el, ci, cj, mode); },
    duplicateCard: function(ci, cj) { duplicateCard(ci, cj); },
    deleteCard: function(ci, cj) { deleteCard(ci, cj); },
    tagCard: function(ci, cj, tag) { tagCard(ci, cj, tag); },
    revealCardContent: function(ci, cj) { revealCardContent(ci, cj); },
    insertCardAtIndex: function(ci, cj) { insertCardAtIndex(ci, cj); },
    copyElementAsMarkdown: function(type, opts) { copyElementAsMarkdown(type, opts); },
    isOverlayEditorEnabled: function() { return isOverlayEditorEnabled(); },
    showCardContextMenu: function(x, y, ci, cj) { showCardContextMenu(x, y, ci, cj); },
    setAddCardColumn: function(idx) { addCardColumn = idx; },
    renderColumns: function() { renderColumns(); },
    closeManagementPanel: function() { closeManagementPanel(); },
    syncSidebarToView: function() { syncSidebarToView(); }
  });
  var currentTagVisibilityMode = 'allexcludinglayout';
  var currentArrowKeyFocusScrollMode = 'nearest';
  var currentHtmlCommentRenderMode = 'hidden';
  var urlParams = new URLSearchParams(window.location.search || '');
  var embeddedMode = urlParams.get('embedded') === '1';
  var embeddedPaneId = urlParams.get('pane') || '';
  var embeddedInitialBoardId = urlParams.get('board') || '';
  var embeddedPreferredBoardId = embeddedInitialBoardId;
  var embeddedForcedBoardLayout = embeddedMode ? String(urlParams.get('view') || '').trim().toLowerCase() : '';
  var embeddedWorkspaceShellParent = embeddedMode && urlParams.get('workspaceShellParent') === '1';
  var WorkspaceShell = window.LexeraWorkspaceShell || null;
  var workspaceShellEnabled = !embeddedMode && !!(WorkspaceShell && typeof WorkspaceShell.isEnabled === 'function' && WorkspaceShell.isEnabled());
  var SidebarResize = window.LexeraSidebarResize;
  var sidebarSplitRatio = parseFloat(localStorage.getItem('lexera-sidebar-split-ratio') || '0.58');
  var sidebarWidth = parseInt(localStorage.getItem('lexera-sidebar-width'), 10) || 0;
  var headerSearchExpanded = localStorage.getItem('lexera-header-search-expanded') === 'true';
  var $foldAllBtn = null;
  var $foldAllCardsBtn = null;
  var $pinHeadersBtn = null;
  var $saveTrackingBtn = null;
  var _headerSavingInProgress = false;
  var _boardHeaderResizeBound = false;
  var suppressHeaderCreationClickUntil = 0;
  // activeHeaderSourceDropdown and HEADER_SOURCE_ENTITY_TYPES moved to hiddenItems/hiddenItemsDropdown.js
  var incomingCaptureCache = {
    items: [],
    loadedAt: 0,
    pending: null,
    available: true
  };
  var BOARD_HEADER_COMPACT_WIDTH = 1320;
  var BOARD_HEADER_COMPACT_HEADER_WIDTH = 1180;
  var BOARD_HEADER_V1_COMPACT_ICONS = {
    createEmpty: '+',
    createTemplate: '\u25A6',
    createClipboard: '\u2398',
    incoming: '\u2193',
    parked: '\u23F8',
    archived: '\u25A3',
    trash: '\u2715',
    foldColumnsCollapsed: '\u25B3',
    foldColumnsExpanded: '\u25BD',
    foldCardsCollapsed: '\u25B4',
    foldCardsExpanded: '\u25BE',
    pinHeaders: '\uD83D\uDCCC',
    processes: '\u2699',
    themeZoom: '\u2315',
    exportPack: '\u21EA'
  };
  var $uiScale = 1;
  var dashboardState = {
    query: localStorage.getItem('lexera-dashboard-query') || '',
    scope: localStorage.getItem('lexera-dashboard-scope') === 'all' ? 'all' : 'active',
    pinnedQueries: [],
    activePinnedQuery: localStorage.getItem('lexera-dashboard-active-pinned') || '',
    loading: false,
    results: [],
    deadlines: [],
    overdue: []
  };
  var dashboardSearchDebounce = null;
  var dashboardRefreshTimer = null;
  var dashboardRefreshSeq = 0;

  function getSharedPanelRegistry() {
    return window.LexeraSharedPanels || null;
  }

  function getSharedPanelRoots(kind) {
    var registry = getSharedPanelRegistry();
    if (!registry || typeof registry.getRoots !== 'function') return [];
    return registry.getRoots(kind);
  }

  window.addEventListener('lexera-shared-panel-created', function (event) {
    var detail = event && event.detail ? event.detail : {};
    if (detail.kind === 'hierarchy') syncMirroredWorkspaceViews();
    if (detail.kind === 'dashboard') syncMirroredDashboardViews();
  });

  window.addEventListener('storage', function (event) {
    if (!event || !event.key) return;
    if (event.key === 'lexera-active-workspace') {
      activeWorkspaceId = event.newValue || ALL_WORKSPACES_ID;
      renderWorkspaceSelect();
      renderBoardList();
      return;
    }
    if (
      event.key === 'lexera-dashboard-query' ||
      event.key === 'lexera-dashboard-scope' ||
      event.key === 'lexera-dashboard-active-pinned' ||
      event.key === 'lexera-dashboard-pinned-queries'
    ) {
      dashboardState.query = localStorage.getItem('lexera-dashboard-query') || '';
      dashboardState.scope = localStorage.getItem('lexera-dashboard-scope') === 'all' ? 'all' : 'active';
      dashboardState.activePinnedQuery = localStorage.getItem('lexera-dashboard-active-pinned') || '';
      dashboardState.pinnedQueries = loadDashboardPinnedQueries();
      renderDashboard();
      scheduleDashboardRefresh(0);
    }
    if (event.key === 'lexera-dock-panel' && event.newValue) {
      localStorage.removeItem('lexera-dock-panel');
      var shell = window.LexeraWorkspaceShell;
      if (shell && typeof shell.revealPanel === 'function') {
        shell.revealPanel(event.newValue);
      }
    }
  });

  // --- Themes ---
  // LEXERA_THEMES and applyLexeraTheme are provided by the shared themes.js script.
  // THEMES is an alias for backward compatibility within app.js.
  var THEMES = (typeof LEXERA_THEMES !== 'undefined') ? LEXERA_THEMES : [];
  var VISUAL_THEMES = (typeof LEXERA_VISUAL_THEMES !== 'undefined') ? LEXERA_VISUAL_THEMES : [
    { id: 'classic', name: 'Classic', description: 'Balanced Lexera layout' }
  ];
  var VISUAL_THEME_LABELS = {};
  for (var visualThemeIdx = 0; visualThemeIdx < VISUAL_THEMES.length; visualThemeIdx++) {
    VISUAL_THEME_LABELS[VISUAL_THEMES[visualThemeIdx].id] = VISUAL_THEMES[visualThemeIdx].name;
  }

  function applyVisualTheme(themeId) {
    if (typeof applyLexeraVisualTheme === 'function') {
      return applyLexeraVisualTheme(themeId);
    }
    return null;
  }

  var DEFAULT_SIDEBAR_TREE_DISPLAY_OPTIONS = {
    counts: true,
    presence: true,
    grips: true
  };

  function normalizeSidebarTreeDisplayOptions(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      counts: source.counts !== false,
      presence: source.presence !== false,
      grips: source.grips !== false
    };
  }

  function readStoredSidebarTreeDisplayOptions() {
    try {
      var raw = localStorage.getItem('lexera-sidebar-tree-display');
      if (!raw) return normalizeSidebarTreeDisplayOptions(DEFAULT_SIDEBAR_TREE_DISPLAY_OPTIONS);
      return normalizeSidebarTreeDisplayOptions(JSON.parse(raw));
    } catch (err) {
      return normalizeSidebarTreeDisplayOptions(DEFAULT_SIDEBAR_TREE_DISPLAY_OPTIONS);
    }
  }

  var sidebarTreeDisplayOptions = readStoredSidebarTreeDisplayOptions();

  function applySidebarTreeDisplayOptions(nextOptions) {
    sidebarTreeDisplayOptions = normalizeSidebarTreeDisplayOptions(nextOptions);
    var root = document && document.documentElement ? document.documentElement : null;
    if (root) {
      root.setAttribute('data-sidebar-tree-counts', sidebarTreeDisplayOptions.counts ? 'on' : 'off');
      root.setAttribute('data-sidebar-tree-presence', sidebarTreeDisplayOptions.presence ? 'on' : 'off');
      root.setAttribute('data-sidebar-tree-grips', sidebarTreeDisplayOptions.grips ? 'on' : 'off');
    }
    try {
      localStorage.setItem('lexera-sidebar-tree-display', JSON.stringify(sidebarTreeDisplayOptions));
    } catch (err) {
      /* ignore localStorage errors */
    }
    renderFrontendSettingsPanel();
    return getSidebarTreeDisplayOptions();
  }

  function getSidebarTreeDisplayOptions() {
    return {
      counts: !!sidebarTreeDisplayOptions.counts,
      presence: !!sidebarTreeDisplayOptions.presence,
      grips: !!sidebarTreeDisplayOptions.grips
    };
  }

  function toggleSidebarTreeDisplayOption(optionKey) {
    var next = getSidebarTreeDisplayOptions();
    if (!Object.prototype.hasOwnProperty.call(next, optionKey)) return next;
    next[optionKey] = !next[optionKey];
    return applySidebarTreeDisplayOptions(next);
  }

  function buildSidebarHierarchyDisplayMenuItems() {
    var options = getSidebarTreeDisplayOptions();
    return [
      { id: 'toggle-sidebar-counts', label: formatMenuToggleLabel(options.counts, 'Counts') },
      { id: 'toggle-sidebar-presence', label: formatMenuToggleLabel(options.presence, 'Presence Badges') },
      { id: 'toggle-sidebar-grips', label: formatMenuToggleLabel(options.grips, 'Drag Icons') }
    ];
  }

  applySidebarTreeDisplayOptions(sidebarTreeDisplayOptions);

  function applyTheme(themeId) {
    // Use shared theme applier for base CSS variables
    if (typeof applyLexeraTheme === 'function') {
      applyLexeraTheme(themeId);
    }

    // Find the active theme and palette for kanban-specific derived tokens
    var theme = null;
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === themeId) { theme = THEMES[i]; break; }
    }
    if (!theme) theme = THEMES[0];
    if (!theme) return;

    var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var palette = isDark ? theme.dark : theme.light;
    var root = document.documentElement;

    // Derive extended style tokens from the active palette so spacing/colors stay unified.
    root.style.setProperty('--board-bg', palette['--bg-primary'] || '');
    root.style.setProperty('--surface-row-bg', palette['--bg-primary'] || '');
    root.style.setProperty('--surface-row-border', palette['--border'] || '');
    root.style.setProperty('--surface-stack-bg', palette['--bg-secondary'] || '');
    root.style.setProperty('--surface-stack-border', palette['--border'] || '');
    root.style.setProperty('--surface-column-bg', palette['--bg-secondary'] || '');
    root.style.setProperty('--surface-column-border', palette['--border'] || '');
    root.style.setProperty('--surface-header-bg', palette['--bg-tertiary'] || palette['--bg-secondary'] || '');
    root.style.setProperty('--surface-header-border', palette['--border'] || '');
    root.style.setProperty('--surface-footer-bg', palette['--bg-secondary'] || '');
    root.style.setProperty('--title-row-color', palette['--text-bright'] || '');
    root.style.setProperty('--title-stack-color', palette['--text-secondary'] || '');
    root.style.setProperty('--title-column-color', palette['--text-bright'] || '');

    root.style.setProperty('--icon-btn-bg', palette['--bg-tertiary'] || palette['--btn-bg'] || '');
    root.style.setProperty('--icon-btn-bg-hover', palette['--bg-hover'] || palette['--btn-bg-hover'] || '');
    root.style.setProperty('--icon-btn-bg-active', 'rgba(0, 122, 204, 0.22)');
    root.style.setProperty('--icon-btn-border', palette['--text-secondary'] || palette['--border'] || '');
    root.style.setProperty('--icon-btn-border-hover', palette['--text-bright'] || palette['--text-primary'] || '');
    root.style.setProperty('--icon-btn-fg', palette['--text-bright'] || palette['--btn-fg'] || '');
    root.style.setProperty('--icon-btn-fg-hover', palette['--text-bright'] || palette['--text-primary'] || '');

    // Update theme selector if present
    var themeSelectors = [
      document.getElementById('theme-select'),
      document.getElementById('mgmt-theme-select'),
      document.getElementById('frontend-settings-theme-select')
    ];
    for (var selIndex = 0; selIndex < themeSelectors.length; selIndex++) {
      var sel = themeSelectors[selIndex];
      if (sel && sel.value !== theme.id) sel.value = theme.id;
    }

    if (typeof applyBoardSettings === 'function') {
      applyBoardSettings();
    }
    renderFrontendSettingsPanel();
  }

  // Re-apply kanban-specific derived tokens on OS light/dark switch
  // (base variables are already re-applied by themes.js listener)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    var themeId = (typeof getLexeraCurrentThemeId === 'function' && getLexeraCurrentThemeId()) ||
                  localStorage.getItem('lexera-theme') || 'lexera';
    applyTheme(themeId);
  });

  // DOM refs — static elements use lazy-init getters (see top of file)
  // Dynamic elements (not in index.html) still need local lookup:
  const $searchContainer = document.querySelector('.search-container');
  const $searchInput = document.getElementById('search-input');
  const $searchToggleBtn = document.getElementById('btn-search-toggle');
  const BURGER_MENU_ICON_HTML = '<span class="burger-lines" aria-hidden="true"></span>';

  // Apply on load after DOM refs exist so board settings can safely re-apply theme-derived styles.
  applyVisualTheme(localStorage.getItem('lexera-visual-theme') || 'classic');
  applyTheme(localStorage.getItem('lexera-theme') || 'lexera');
  cardEditorMode = normalizeCardEditorMode(localStorage.getItem('lexera-card-editor-mode') || 'dual');
  cardEditorFontScale = normalizeCardEditorFontScale(localStorage.getItem('lexera-card-editor-font-scale') || '1');
  $uiScale = normalizeUiScale(localStorage.getItem('lexera-ui-scale') || '1');
  applyUiScale($uiScale);
  applySpecialCharactersVisibilitySetting();

  function normalizeUiScale(value) {
    var parsed = parseFloat(value);
    if (!isFinite(parsed)) return 1;
    if (parsed < 0.75) return 0.75;
    if (parsed > 1.5) return 1.5;
    return Math.round(parsed * 10000) / 10000;
  }

  function applyUiScale(scale) {
    var normalized = normalizeUiScale(scale);
    $uiScale = normalized;
    document.documentElement.style.setProperty('--ui-scale', String(normalized));
    localStorage.setItem('lexera-ui-scale', String(normalized));
  }

  function getUiScalePercentLabel() {
    return Math.round($uiScale * 100) + '%';
  }

  function nudgeUiScale(delta) {
    var next = normalizeUiScale($uiScale + delta);
    if (next === $uiScale) return false;
    applyUiScale(next);
    showNotification('Zoom ' + getUiScalePercentLabel());
    return true;
  }

  function isOverlayEditorEnabled() {
    return localStorage.getItem('lexera-overlay-editor-enabled') !== 'false';
  }

  function setOverlayEditorEnabled(enabled) {
    localStorage.setItem('lexera-overlay-editor-enabled', enabled ? 'true' : 'false');
    if (!enabled && currentCardEditor) {
      closeCardEditorOverlay({ save: true });
    }
    renderFrontendSettingsPanel();
  }

  function isWysiwygEditorEnabled() {
    return localStorage.getItem('lexera-wysiwyg-editor-enabled') !== 'false';
  }

  function setWysiwygEditorEnabled(enabled) {
    localStorage.setItem('lexera-wysiwyg-editor-enabled', enabled ? 'true' : 'false');
    if (!enabled && currentCardEditor && currentCardEditor.mode === 'wysiwyg') {
      applyCardEditorMode('dual');
    }
    renderFrontendSettingsPanel();
  }

  function isSpecialCharactersVisible() {
    return localStorage.getItem('lexera-show-special-characters') === 'true';
  }

  function applySpecialCharactersVisibilitySetting() {
    document.body.classList.toggle('show-special-characters', isSpecialCharactersVisible());
  }

  function setSpecialCharactersVisible(enabled) {
    localStorage.setItem('lexera-show-special-characters', enabled ? 'true' : 'false');
    applySpecialCharactersVisibilitySetting();
    renderFrontendSettingsPanel();
  }

  function isMarpSettingsEnabled() {
    return localStorage.getItem('lexera-show-marp-settings') !== 'false';
  }

  function setMarpSettingsEnabled(enabled) {
    localStorage.setItem('lexera-show-marp-settings', enabled ? 'true' : 'false');
    renderFrontendSettingsPanel();
  }

  /** Sync all View toggle check states to the native OS menu bar. */
  function syncMenuCheckStates() {
    if (!hasTauri) return;
    var states = {
      'view-special-chars': isSpecialCharactersVisible(),
      'view-marp-settings': isMarpSettingsEnabled(),
      'view-overlay-editor': isOverlayEditorEnabled(),
      'view-wysiwyg-editor': isWysiwygEditorEnabled()
    };
    Object.keys(states).forEach(function (id) {
      tauriInvoke('set_menu_check_state', { id: id, checked: states[id] });
    });
  }

  function normalizePathForCompare(path) { return PathUtils.normalizePathForCompare(path); }

  function decodeHtmlEntities(value) { return PathUtils.decodeHtmlEntities(value); }

  function findBoardMeta(boardId) {
    if (!boardId) return null;
    var groups = [boards, remoteBoards];
    for (var g = 0; g < groups.length; g++) {
      var list = groups[g] || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === boardId) return list[i];
      }
    }
    return null;
  }

  function isRemoteBoardId(boardId) {
    var meta = findBoardMeta(boardId);
    return !!(meta && meta.isRemote);
  }

  function isActiveRemoteBoard() {
    if (!activeBoardId) return false;
    if (activeBoardData && activeBoardData.isRemote) return true;
    return isRemoteBoardId(activeBoardId);
  }

  function stripPathSearchAndHash(path) { return PathUtils.stripPathSearchAndHash(path); }

  function parseLocalFileReference(path) {
    var raw = String(path || '').trim();
    var basePath = stripPathSearchAndHash(raw);
    var suffix = basePath && raw.indexOf(basePath) === 0 ? raw.slice(basePath.length) : '';
    var pageNumber = null;
    var hashMatch = raw.match(/^(.+\.pdf)#(\d+)$/i);
    if (hashMatch) pageNumber = parseInt(hashMatch[2], 10);
    var queryMatch = raw.match(/^(.+\.pdf)\?(?:p|page)=(\d+)$/i);
    if (!pageNumber && queryMatch) pageNumber = parseInt(queryMatch[2], 10);
    return {
      raw: raw,
      path: basePath || raw,
      suffix: suffix,
      pageNumber: isFinite(pageNumber) ? pageNumber : null
    };
  }

  function getFileNameFromPath(path) { return PathUtils.getFileNameFromPath(path); }

  function decodePathDisplayValue(value) { return PathUtils.decodePathDisplayValue(value); }

  function getDisplayFileNameFromPath(path) { return PathUtils.getDisplayFileNameFromPath(path); }

  function getDirNameFromPath(path) { return PathUtils.getDirNameFromPath(path); }

  function getDisplayNameFromPath(path) { return PathUtils.getDisplayNameFromPath(path); }

  function getActiveBoardFilePath() {
    if (!activeBoardId) return '';
    if (activeBoardData && activeBoardData.filePath) return activeBoardData.filePath;
    var board = findBoardMeta(activeBoardId);
    return board && board.filePath ? board.filePath : '';
  }

  function getBoardFilePathForId(boardId) {
    if (!boardId) return '';
    if (boardId === activeBoardId && activeBoardData && activeBoardData.filePath) {
      return activeBoardData.filePath;
    }
    var board = findBoardMeta(boardId);
    return board && board.filePath ? board.filePath : '';
  }

  function stripMarkdownExtension(value) {
    return String(value || '').replace(/\.md$/i, '');
  }

  function normalizeWikiLookupKey(value) {
    return stripMarkdownExtension(normalizePathForCompare(value))
      .replace(/^\.\/+/, '')
      .replace(/^\/+/, '')
      .trim()
      .toLowerCase();
  }

  function getBoardDisplayName(board) {
    if (!board) return '';
    return String(board.title || stripMarkdownExtension(getDisplayFileNameFromPath(board.filePath || '')) || '').trim();
  }

  function getKnownBoards() {
    var all = [];
    var seen = {};
    var groups = [boards, remoteBoards];
    for (var g = 0; g < groups.length; g++) {
      var list = groups[g] || [];
      for (var i = 0; i < list.length; i++) {
        var board = list[i];
        if (!board || !board.id || seen[board.id]) continue;
        seen[board.id] = true;
        all.push(board);
      }
    }
    return all;
  }

  function resolveWikiDocument(documentName) {
    var rawDocument = decodeHtmlEntities(documentName).trim();
    if (!rawDocument) return { kind: 'missing', document: '' };
    if (rawDocument.charAt(0) === '#') return { kind: 'tag', document: rawDocument };

    var documentKey = normalizeWikiLookupKey(rawDocument);
    var documentBaseKey = normalizeWikiLookupKey(getFileNameFromPath(rawDocument));
    var knownBoards = getKnownBoards();
    var best = null;

    for (var i = 0; i < knownBoards.length; i++) {
      var board = knownBoards[i];
      var filePath = normalizePathForCompare(board.filePath || '');
      var filePathKey = normalizeWikiLookupKey(filePath);
      var fileNameKey = normalizeWikiLookupKey(getFileNameFromPath(filePath));
      var titleKey = normalizeWikiLookupKey(getBoardDisplayName(board));
      var score = null;

      if (documentKey && (documentKey === titleKey || documentKey === filePathKey)) {
        score = 0;
      } else if (documentKey && documentKey === fileNameKey) {
        score = 1;
      } else if (documentKey && filePathKey && filePathKey.slice(-documentKey.length - 1) === '/' + documentKey) {
        score = 2;
      } else if (documentBaseKey && documentBaseKey === titleKey) {
        score = 3;
      } else if (documentBaseKey && documentBaseKey === fileNameKey) {
        score = 4;
      }

      if (score == null) continue;
      if (!best || score < best.score || (score === best.score && filePath.length < best.filePathLength)) {
        best = {
          score: score,
          board: board,
          filePathLength: filePath.length
        };
      }
    }

    if (!best) return { kind: 'missing', document: rawDocument };
    return {
      kind: 'board',
      document: rawDocument,
      boardId: best.board.id,
      board: best.board
    };
  }

  function isHierarchyLocked() {
    if (SidebarSync && typeof SidebarSync.isHierarchyLocked === 'function') {
      return !!SidebarSync.isHierarchyLocked();
    }
    try {
      return localStorage.getItem('lexera-hierarchy-locked') === 'true';
    } catch (err) {
      return false;
    }
  }

  // --- Order Helpers --- (delegated to LexeraOrderHelpers module)
  var orderHelpersInitConfig = {
    getCanvasModeHelpers: function () { return getCanvasModeHelpers(); },
    getBoardSettingValue: function (k, d) { return getBoardSettingValue(k, d); },
    embeddedForcedBoardLayout: embeddedForcedBoardLayout,
    LexeraTagSystem: window.LexeraTagSystem,
    hasTag: function (text, tag) { return hasTag(text, tag); },
    is_archived_or_deleted: function (text) { return is_archived_or_deleted(text); },
    stripInternalHiddenTags: function (text) { return stripInternalHiddenTags(text); },
    get fullBoardData() { return fullBoardData; },
    get activeBoardId() { return activeBoardId; },
    get activeBoardData() { return activeBoardData; },
    getFullColumn: function (idx) { return getFullColumn(idx); },
    pushUndo: function () { return pushUndo(); },
    persistBoardMutation: function (opts) { return persistBoardMutation(opts); },
    get boards() { return boards; },
    renderBoardList: function () { return renderBoardList(); },
    renderColumns: function () { return renderColumns(); },
    getFoldStateApi: function () { return getFoldStateApi(); },
    getElColumnsContainer: function () { return getElColumnsContainer(); },
    saveCardCollapseState: function (bid) { return saveCardCollapseState(bid); },
    refreshBoardHeaderActionStates: function () { return refreshBoardHeaderActionStates(); },
    get hierarchyLocked() { return isHierarchyLocked(); },
    LexeraApi: LexeraApi,
    lexeraLog: function () { return lexeraLog.apply(null, arguments); },
    poll: function () { return poll(); },
    getElSidebar: function () { return getElSidebar(); },
    getElBoardList: function () { return getElBoardList(); },
    getElDashboardRoot: function () { return getElDashboardRoot(); },
    getElSidebarHeader: function () { return getElSidebarHeader(); },
    getElSidebarDashboardDivider: function () { return getElSidebarDashboardDivider(); },
    getElSidebarWidthDivider: function () { return getElSidebarWidthDivider(); },
    getElLayout: function () { return getElLayout(); },
    getElMainContent: function () { return getElMainContent(); },
    get workspaceShellEnabled() { return workspaceShellEnabled; },
    WorkspaceShell: WorkspaceShell,
    get embeddedMode() { return embeddedMode; },
    get embeddedPaneId() { return embeddedPaneId; },
    get embeddedWorkspaceShellParent() { return embeddedWorkspaceShellParent; },
    get sidebarSplitRatio() { return sidebarSplitRatio; },
    setSidebarSplitRatio: function (v) { sidebarSplitRatio = v; },
    get sidebarWidth() { return sidebarWidth; },
    setSidebarWidth: function (v) { sidebarWidth = v; },
    get headerSearchExpanded() { return headerSearchExpanded; },
    setHeaderSearchExpandedState: function (v) { headerSearchExpanded = v; },
    get searchMode() { return searchMode; },
    get addCardColumn() { return addCardColumn; },
    setAddCardColumn: function (v) { addCardColumn = v; },
    get activeColMenu() { return activeColMenu; },
    get activeCardMenu() { return activeCardMenu; },
    get activeRowStackMenu() { return activeRowStackMenu; },
    get activeEmbedMenu() {
      return window.LexeraEmbedMenu && typeof window.LexeraEmbedMenu.getActiveEmbedMenu === 'function'
        ? window.LexeraEmbedMenu.getActiveEmbedMenu()
        : null;
    },
    get activeHtmlMenu() {
      return window.LexeraEmbedMenu && typeof window.LexeraEmbedMenu.getActiveHtmlMenu === 'function'
        ? window.LexeraEmbedMenu.getActiveHtmlMenu()
        : null;
    },
    closeColumnContextMenu: function () { return closeColumnContextMenu(); },
    closeCardContextMenu: function () { return closeCardContextMenu(); },
    closeRowStackMenu: function () { return closeRowStackMenu(); },
    closeEmbedMenu: function () { return closeEmbedMenu(); },
    closeHtmlMenu: function () { return closeHtmlMenu(); },
    get currentInlineCardEditor() {
      return InlineCardEditorModule && typeof InlineCardEditorModule.getCurrentInlineCardEditor === 'function'
        ? InlineCardEditorModule.getCurrentInlineCardEditor()
        : null;
    },
    closeInlineCardEditor: function (opts) { return closeInlineCardEditor(opts); },
    get currentCardEditor() { return currentCardEditor; },
    closeCardEditorOverlay: function (opts) { return closeCardEditorOverlay(opts); },
    get $searchInput() { return $searchInput; },
    get $searchContainer() { return $searchContainer; },
    get $searchToggleBtn() { return $searchToggleBtn; },
    exitSearchMode: function () { return exitSearchMode(); },
    handleBoardAction: function (action) { return handleBoardAction(action); },
    navigateToHierarchyTarget: function (target) { return navigateToHierarchyTarget(target); },
    logFrontendIssue: function () { return logFrontendIssue.apply(null, arguments); },
    get hasTauri() { return hasTauri; },
    tauriInvoke: function () { return tauriInvoke.apply(null, arguments); },
    getActiveBoardFilePath: function () { return getActiveBoardFilePath(); },
    getFileNameFromPath: function (p) { return getFileNameFromPath(p); },
    getDirNameFromPath: function (p) { return getDirNameFromPath(p); },
    normalizePathForCompare: function (p) { return normalizePathForCompare(p); },
    showNotification: function (msg) { return showNotification(msg); },
    selectBoard: function (id) { return selectBoard(id); },
    showInFinder: function (p) { return showInFinder(p); },
    THEMES: THEMES,
    getLexeraCurrentThemeId: function () { return getLexeraCurrentThemeId(); },
    escapeAttr: function (v) { return escapeAttr(v); },
    escapeHtml: function (v) { return escapeHtml(v); },
    openManagementPanel: function (opts) { return openManagementPanel(opts); },
    setActiveBoardId: function (v) { activeBoardId = v; },
    setActiveBoardData: function (v) { activeBoardData = v; },
    setFullBoardData: function (v) { fullBoardData = v; },
    setPendingExternalRebaseConflict: function (v) { pendingExternalRebaseConflict = v; },
    setLastLoadedGeneration: function (v) { _lastLoadedGeneration = v; },
    setLastLoadedRevision: function (v) { _lastLoadedRevision = v; },
    trackRecentBoard: function (id) { return trackRecentBoard(id); },
    get connected() { return connected; },
    dashboardState: dashboardState,
    getElDashboardSearchInput: function () { return getElDashboardSearchInput(); },
    getElDashboardScopeSelect: function () { return getElDashboardScopeSelect(); },
    getElDashboardSearchBtn: function () { return getElDashboardSearchBtn(); },
    getElDashboardPinBtn: function () { return getElDashboardPinBtn(); },
    getElDashboardPinnedList: function () { return getElDashboardPinnedList(); },
    getElDashboardResultsList: function () { return getElDashboardResultsList(); },
    getElDashboardDeadlineList: function () { return getElDashboardDeadlineList(); },
    getElDashboardOverdueList: function () { return getElDashboardOverdueList(); },
    getSharedPanelRoots: function (kind) { return getSharedPanelRoots(kind); },
    getDashboardTreeApi: function () { return getDashboardTreeApi(); },
    TreeView: TreeView,
    navigateToSearchResult: function (r) { return navigateToSearchResult(r); }
  };

  var _resolvedOrderHelpers = null;
  var _initializedOrderHelpers = null;
  var _missingOrderHelperWarnings = {};

  function getOrderHelpersGlobal() {
    if (typeof window !== 'undefined' && window) return window;
    if (typeof globalThis !== 'undefined' && globalThis) return globalThis;
    if (typeof self !== 'undefined' && self) return self;
    return null;
  }

  function normalizeCanvasStackDirectionFallback(value) {
    var normalized = String(value == null ? '' : value).trim().toLowerCase();
    if (normalized === 'horizontal') normalized = 'row';
    if (normalized === 'vertical') normalized = 'column';
    return normalized === 'row' ? 'row' : 'column';
  }

  function resolveOrderHelpersModule() {
    var globalObj = getOrderHelpersGlobal();
    var helpers = globalObj && globalObj.LexeraOrderHelpers ? globalObj.LexeraOrderHelpers : null;
    if (!helpers) return null;
    _resolvedOrderHelpers = helpers;
    if (_initializedOrderHelpers !== helpers && typeof helpers.init === 'function') {
      helpers.init(orderHelpersInitConfig);
      _initializedOrderHelpers = helpers;
    }
    return helpers;
  }

  function getOrderHelpersFallback(prop) {
    if (prop === 'normalizeBoardLayoutValue') {
      return function (value) { return getCanvasModeHelpers().normalizeBoardLayoutValue(value); };
    }
    if (prop === 'normalizeCanvasGridValue') {
      return function (value) { return getCanvasModeHelpers().normalizeCanvasGridValue(value); };
    }
    if (prop === 'getCurrentBoardLayout') {
      return function () {
        if (embeddedForcedBoardLayout === 'canvas') return 'canvas';
        if (embeddedForcedBoardLayout === 'kanban') return 'kanban';
        return getCanvasModeHelpers().normalizeBoardLayoutValue(getBoardSettingValue('boardLayout', 'kanban'));
      };
    }
    if (prop === 'isCanvasBoardLayout') {
      return function () { return getOrderHelpersFallback('getCurrentBoardLayout')() === 'canvas'; };
    }
    if (prop === 'normalizeCanvasStackDirection') {
      return normalizeCanvasStackDirectionFallback;
    }
    return function () {
      if (!_missingOrderHelperWarnings[prop]) {
        _missingOrderHelperWarnings[prop] = true;
        logFrontendIssue('error', 'order.helpers', 'LexeraOrderHelpers unavailable', { method: String(prop) });
      }
      return undefined;
    };
  }

  var OrderHelpers = typeof Proxy === 'function'
    ? new Proxy({}, {
      get: function (_target, prop) {
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        var helpers = resolveOrderHelpersModule();
        if (helpers && helpers[prop] != null) {
          var value = helpers[prop];
          if (typeof value === 'function') {
            return function () {
              var liveHelpers = resolveOrderHelpersModule();
              var liveValue = liveHelpers && liveHelpers[prop];
              if (typeof liveValue === 'function') return liveValue.apply(liveHelpers, arguments);
              return getOrderHelpersFallback(prop).apply(null, arguments);
            };
          }
          return value;
        }
        return getOrderHelpersFallback(prop);
      }
    })
    : (resolveOrderHelpersModule() || {});

  resolveOrderHelpersModule();

  function extractHtmlComments(text) { return OrderHelpers.extractHtmlComments(text); }
  function stripHtmlComments(text) { return OrderHelpers.stripHtmlComments(text); }
  function rebuildTitleWithPreservedComments(userInput, originalTitle) { return OrderHelpers.rebuildTitleWithPreservedComments(userInput, originalTitle); }
  function normalizeBoardLayoutValue(value) { return getCanvasModeHelpers().normalizeBoardLayoutValue(value); }
  function normalizeCanvasGridValue(value) { return getCanvasModeHelpers().normalizeCanvasGridValue(value); }
  function getCurrentBoardLayout() {
    if (embeddedForcedBoardLayout === 'canvas') return 'canvas';
    if (embeddedForcedBoardLayout === 'kanban') return 'kanban';
    return normalizeBoardLayoutValue(getBoardSettingValue('boardLayout', 'kanban'));
  }
  function isCanvasBoardLayout() { return getCurrentBoardLayout() === 'canvas'; }
  function normalizeCanvasStackDirection(value) {
    var normalized = String(value == null ? '' : value).trim().toLowerCase();
    if (normalized === 'horizontal') normalized = 'row';
    if (normalized === 'vertical') normalized = 'column';
    return normalized === 'row' ? 'row' : 'column';
  }
  function stripLayoutTags(title) { return OrderHelpers.stripLayoutTags(title); }
  function stripStackTag(title) { return OrderHelpers.stripStackTag(title); }
  function stripLegacyImportStructureTags(title) { return OrderHelpers.stripLegacyImportStructureTags(title); }
  function isColumnHeaderTagged(title) { return OrderHelpers.isColumnHeaderTagged(title); }
  function isColumnFooterTagged(title) { return OrderHelpers.isColumnFooterTagged(title); }
  function getDisplayOrderedColumnEntries(columns, options) { return OrderHelpers.getDisplayOrderedColumnEntries(columns, options); }
  function extractIncludePathFromTitle(title) { return OrderHelpers.extractIncludePathFromTitle(title); }
  function removeIncludeSyntaxFromTitle(title) { return OrderHelpers.removeIncludeSyntaxFromTitle(title); }
  function addIncludeSyntaxToTitle(title, filePath) { return OrderHelpers.addIncludeSyntaxToTitle(title, filePath); }
  function suggestIncludePathForColumn(title) { return OrderHelpers.suggestIncludePathForColumn(title); }
  function getColumnLayoutTags(title) { return OrderHelpers.getColumnLayoutTags(title); }
  function getElementSizeTag(title, tagName) { return OrderHelpers.getElementSizeTag(title, tagName); }
  function getLegacyImportRowNumber(title) { return OrderHelpers.getLegacyImportRowNumber(title); }
  function buildRowsFromLegacyColumns(cols, fallbackTitle) { return OrderHelpers.buildRowsFromLegacyColumns(cols, fallbackTitle); }
  function reconstructColumnTitle(userInput, originalTitle) { return OrderHelpers.reconstructColumnTitle(userInput, originalTitle); }
  async function toggleColumnWidth(colIndex) { return OrderHelpers.toggleColumnWidth(colIndex); }
  async function setColumnSpan(colIndex, span) { return OrderHelpers.setColumnSpan(colIndex, span); }
  function getOrderedItems(items, storageKey, idFn) { return OrderHelpers.getOrderedItems(items, storageKey, idFn); }
  function saveOrder(items, storageKey, idFn) { return OrderHelpers.saveOrder(items, storageKey, idFn); }
  function getFoldedColumns(boardId) { return OrderHelpers.getFoldedColumns(boardId); }
  function getFoldedItems(boardId, kind) { return OrderHelpers.getFoldedItems(boardId, kind); }
  function normalizeFoldStorageList(values) { return OrderHelpers.normalizeFoldStorageList(values); }
  function getRowFoldKey(row, rowIdx) { return OrderHelpers.getRowFoldKey(row, rowIdx); }
  function getStackFoldKey(stack, rowIdx, stackIdx) { return OrderHelpers.getStackFoldKey(stack, rowIdx, stackIdx); }
  function getColumnFoldKey(col, rowIdx, stackIdx, colLocalIdx, colFullIdx) { return OrderHelpers.getColumnFoldKey(col, rowIdx, stackIdx, colLocalIdx, colFullIdx); }
  function hasSavedFoldMatch(savedValues, foldKey, legacyValue) { return OrderHelpers.hasSavedFoldMatch(savedValues, foldKey, legacyValue); }
  function saveFoldState(boardId) { return OrderHelpers.saveFoldState(boardId); }
  function setDirectChildFoldState(parentEl, childClassName, folded) { return OrderHelpers.setDirectChildFoldState(parentEl, childClassName, folded); }
  function setColumnChildrenFoldState(columnEl, folded) { return OrderHelpers.setColumnChildrenFoldState(columnEl, folded); }
  function setRowChildrenFoldState(rowEl, folded) { return OrderHelpers.setRowChildrenFoldState(rowEl, folded); }
  function setStackChildrenFoldState(stackEl, folded) { return OrderHelpers.setStackChildrenFoldState(stackEl, folded); }
  function toggleColumnFoldElement(columnEl, childrenOnly) { return OrderHelpers.toggleColumnFoldElement(columnEl, childrenOnly); }
  function toggleStackFoldElement(stackEl, childrenOnly) { return OrderHelpers.toggleStackFoldElement(stackEl, childrenOnly); }
  function toggleRowFoldElement(rowEl, childrenOnly) { return OrderHelpers.toggleRowFoldElement(rowEl, childrenOnly); }
  function reorderItems(items, sourceIdx, targetIdx, insertBefore) { return OrderHelpers.reorderItems(items, sourceIdx, targetIdx, insertBefore); }
  function reorderBoards(sourceIdx, targetIdx, insertBefore) { return OrderHelpers.reorderBoards(sourceIdx, targetIdx, insertBefore); }
  function targetClosest(target, selector) { return OrderHelpers.targetClosest(target, selector); }
  function normalizeDroppedPath(path) { return OrderHelpers.normalizeDroppedPath(path); }
  function isMarkdownPath(path) { return OrderHelpers.isMarkdownPath(path); }
  function isAbsoluteLikePath(path) { return OrderHelpers.isAbsoluteLikePath(path); }
  function isPositionInsideElement(pos, el) { return OrderHelpers.isPositionInsideElement(pos, el); }
  function parseDroppedUriList(text) { return OrderHelpers.parseDroppedUriList(text); }
  function collectDroppedPathsFromDataTransfer(dt) { return OrderHelpers.collectDroppedPathsFromDataTransfer(dt); }
  function addBoardsByPath(paths) { return OrderHelpers.addBoardsByPath(paths); }
  function normalizeRatio(rawRatio, options) { return OrderHelpers.normalizeRatio(rawRatio, options); }
  function normalizeSidebarSplitRatio(rawRatio) { return OrderHelpers.normalizeSidebarSplitRatio(rawRatio); }
  function bindPointerDividerDrag(divider, handlers) { return OrderHelpers.bindPointerDividerDrag(divider, handlers); }
  function applySidebarSectionLayout() { return OrderHelpers.applySidebarSectionLayout(); }
  function setupSidebarSectionResize() { return OrderHelpers.setupSidebarSectionResize(); }
  function applySidebarWidth() { return OrderHelpers.applySidebarWidth(); }
  function setupSidebarWidthResize() { return OrderHelpers.setupSidebarWidthResize(); }
  function handleTextareaTabIndent(e, textarea) { return OrderHelpers.handleTextareaTabIndent(e, textarea); }
  function closeTransientUiViaHotkey() { return OrderHelpers.closeTransientUiViaHotkey(); }
  function setHeaderSearchExpanded(expanded, options) { return OrderHelpers.setHeaderSearchExpanded(expanded, options); }
  function updateHeaderSearchVisibility(options) { return OrderHelpers.updateHeaderSearchVisibility(options); }
  function notifyParentPaneActivated() { return OrderHelpers.notifyParentPaneActivated(); }
  function setupEmbeddedPaneActivation() { return OrderHelpers.setupEmbeddedPaneActivation(); }
  function handleEmbeddedHierarchyFocusMessage(event) { return OrderHelpers.handleEmbeddedHierarchyFocusMessage(event); }
  function requestWorkspaceShellViewKind(viewKind) { return OrderHelpers.requestWorkspaceShellViewKind(viewKind); }
  function refreshHeaderFileControls() { return OrderHelpers.refreshHeaderFileControls(); }
  function setShellActiveBoard(boardId) { return OrderHelpers.setShellActiveBoard(boardId); }
  function setupWorkspaceShell() { return OrderHelpers.setupWorkspaceShell(); }
  function normalizeMarkdownFileName(rawName) { return OrderHelpers.normalizeMarkdownFileName(rawName); }
  async function renameActiveBoardFile() { return OrderHelpers.renameActiveBoardFile(); }
  function openActiveBoardFolder() { return OrderHelpers.openActiveBoardFolder(); }
  function buildThemeOptionsMarkup(selectedThemeId) { return OrderHelpers.buildThemeOptionsMarkup(selectedThemeId); }
  async function openSettingsDialogForBoard(boardId) { return OrderHelpers.openSettingsDialogForBoard(boardId); }
  function setupHeaderFileControls() { return OrderHelpers.setupHeaderFileControls(); }
  function setupSearchControls() { return OrderHelpers.setupSearchControls(); }
  function ensureSidebarTreeDefaultState() { return OrderHelpers.ensureSidebarTreeDefaultState(); }
  function normalizeDashboardScope(scope) { return OrderHelpers.normalizeDashboardScope(scope); }
  function loadDashboardPinnedQueries() { return OrderHelpers.loadDashboardPinnedQueries(); }
  function persistDashboardPrefs() { return OrderHelpers.persistDashboardPrefs(); }
  function setDashboardScope(scope) { return OrderHelpers.setDashboardScope(scope); }
  function setDashboardQuery(query, options) { return OrderHelpers.setDashboardQuery(query, options); }
  function filterDashboardResultsByScope(results) { return OrderHelpers.filterDashboardResultsByScope(results); }
  function parseSearchDateValue(dateStr) { return OrderHelpers.parseSearchDateValue(dateStr); }
  function formatLocalDateValue(date) { return OrderHelpers.formatLocalDateValue(date); }
  function dashboardCalendarBaseDate(item) { return OrderHelpers.dashboardCalendarBaseDate(item); }
  function isDashboardCalendarQuery(query) { return OrderHelpers.isDashboardCalendarQuery(query); }
  function filterCalendarTasksForDashboardQuery(tasks, query) { return OrderHelpers.filterCalendarTasksForDashboardQuery(tasks, query); }
  function sortSearchByDueDateAsc(results) { return OrderHelpers.sortSearchByDueDateAsc(results); }
  function asCalendarTaskArray(payload) { return OrderHelpers.asCalendarTaskArray(payload); }
  function limitedSearchResults(results, maxCount) { return OrderHelpers.limitedSearchResults(results, maxCount); }
  function asSearchResultArray(payload) { return OrderHelpers.asSearchResultArray(payload); }
  function scopeHintForDashboard() { return OrderHelpers.scopeHintForDashboard(); }
  function bindMirroredDashboardView(rootEl) { return OrderHelpers.bindMirroredDashboardView(rootEl); }
  function syncMirroredDashboardViews() { return OrderHelpers.syncMirroredDashboardViews(); }
  function renderDashboardPinnedList() { return OrderHelpers.renderDashboardPinnedList(); }
  function setDashboardGroupEmptyState(targetEl, isEmpty) { return OrderHelpers.setDashboardGroupEmptyState(targetEl, isEmpty); }
  function renderDashboardResultItems(targetEl, items, emptyText, options) { return OrderHelpers.renderDashboardResultItems(targetEl, items, emptyText, options); }
  function renderDashboard() { return OrderHelpers.renderDashboard(); }
  async function refreshDashboardData(options) { return OrderHelpers.refreshDashboardData(options); }
  function scheduleDashboardRefresh(delayMs) { return OrderHelpers.scheduleDashboardRefresh(delayMs); }
  function setupDashboardControls() { return OrderHelpers.setupDashboardControls(); }

  function init() {
    window.__LEXERA_FRONTEND_BUILD = FRONTEND_BUILD_STAMP;
    traceFrontendAction('info', 'frontend.build', 'Loaded frontend build', {
      buildStamp: FRONTEND_BUILD_STAMP
    });
    if (embeddedMode) document.body.classList.add('embedded-mode');
    if (typeof window.updateAppBottomInset === 'function') window.updateAppBottomInset();

    // Load user keybindings from ~/.config/lexera/keybindings.json
    if (hasTauri && window.LexeraKeybindingRegistry) {
      tauriInvoke('read_keybindings', {}).then(function (json) {
        window.LexeraKeybindingRegistry.loadFromJson(json);
        if (json) traceFrontendAction('info', 'keybinding.load', 'Loaded user keybindings');
      }).catch(function (err) {
        traceFrontendAction('warn', 'keybinding.load', 'Failed to load keybindings', err);
        window.LexeraKeybindingRegistry.loadFromJson('');
      });
    } else if (window.LexeraKeybindingRegistry) {
      window.LexeraKeybindingRegistry.loadFromJson('');
    }
    ensureSidebarTreeDefaultState();
    setupSearchControls();
    setupDashboardControls();
    setupSidebarSectionResize();
    setupSidebarWidthResize();
    setupWorkspaceShell();

    if ($searchInput) {
      $searchInput.addEventListener('input', onSearchInput);
      $searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          $searchInput.value = '';
          exitSearchMode();
        }
      });
    }

    document.addEventListener('keydown', handleKeyNavigation);

    if (typeof window.setLogBackendConnectionState === 'function') {
      window.setLogBackendConnectionState(connected);
    } else {
      syncConnectionStatusButton(getElConnectionStatusBtn(), getElConnectionDot(), connected);
    }

    // Management panel close button
    if (getElMgmtClose()) getElMgmtClose().addEventListener('click', function () {
      closeManagementPanel();
    });

    // External file drop on columns container
    getElColumnsContainer().addEventListener('dragover', function (e) {
      if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    getElColumnsContainer().addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
      if (!activeBoardId) return;
      e.preventDefault();
      handleFileDrop(e.dataTransfer.files, e.target);
    });

    // Clipboard paste for images
    document.addEventListener('paste', function (e) {
      if (!activeBoardId || isEditing) return;
      if (!e.clipboardData || !e.clipboardData.files || e.clipboardData.files.length === 0) return;
      var hasImage = false;
      for (var i = 0; i < e.clipboardData.files.length; i++) {
        if (e.clipboardData.files[i].type.indexOf('image/') === 0) { hasImage = true; break; }
      }
      if (!hasImage) return;
      e.preventDefault();
      handleFileDrop(e.clipboardData.files, null);
    });

      // Sidebar drop: add .md files from OS drag-and-drop when unlocked.
    if (getElSidebar()) {
      getElSidebar().addEventListener('dragover', function (e) {
        if (isHierarchyLocked()) return;
        if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          getElSidebar().classList.add('drop-zone-active');
        }
      });
      getElSidebar().addEventListener('dragleave', function (e) {
        if (!e.relatedTarget || !getElSidebar().contains(e.relatedTarget)) {
          getElSidebar().classList.remove('drop-zone-active');
        }
      });
      getElSidebar().addEventListener('drop', function (e) {
        getElSidebar().classList.remove('drop-zone-active');
        if (isHierarchyLocked()) return;
        var dt = e.dataTransfer;
        if (!dt) return;
        var paths = collectDroppedPathsFromDataTransfer(dt);
        if (paths.length === 0) return;
        e.preventDefault();
        addBoardsByPath(paths);
      });
    }

    // Tauri drag-drop payload (paths + pointer position).
    if (hasTauri) {
      tauriListen('tauri://drag-over', function (event) {
        var pos = event.payload.position;
        // Boards section drop zone
        var boardsSection = document.querySelector('[data-mgmt-section="boards"]');
        if (boardsSection && pos) {
          boardsSection.classList.toggle('mgmt-drop-active', isPositionInsideElement(pos, boardsSection));
        }
        // Sidebar drop zone
        if (isHierarchyLocked()) return;
        if (getElSidebar() && pos) {
          if (isPositionInsideElement(pos, getElSidebar())) {
            getElSidebar().classList.add('drop-zone-active');
          } else {
            getElSidebar().classList.remove('drop-zone-active');
          }
        }
      });
      tauriListen('tauri://drag-leave', function () {
        if (getElSidebar()) getElSidebar().classList.remove('drop-zone-active');
        var boardsSection = document.querySelector('[data-mgmt-section="boards"]');
        if (boardsSection) boardsSection.classList.remove('mgmt-drop-active');
      });
      tauriListen('tauri://drag-drop', function (event) {
        if (getElSidebar()) getElSidebar().classList.remove('drop-zone-active');
        var boardsSection = document.querySelector('[data-mgmt-section="boards"]');
        if (boardsSection) boardsSection.classList.remove('mgmt-drop-active');
        var paths = event.payload.paths || [];
        var pos = event.payload.position;
        // Check boards section first
        if (boardsSection && pos && isPositionInsideElement(pos, boardsSection)) {
          addBoardsByPath(paths);
          return;
        }
        // Sidebar drop
        if (isHierarchyLocked()) return;
        if (getElSidebar() && pos && !isPositionInsideElement(pos, getElSidebar())) {
          return;
        }
        addBoardsByPath(paths);
      });
      // Native OS menu bar actions
      tauriListen('menu-action', function (event) {
        var action = event.payload;
        if (action) handleBoardAction(action);
      });
      // Sync initial check states to native menu
      syncMenuCheckStates();
    }

    setupHeaderFileControls();
    setupEmbeddedPaneActivation();
    registerExternalDndBridge();

    poll();
    pollInterval = setInterval(poll, 5000);
  }

  // --- Keyboard Navigation --- (delegated to LexeraKeyboardNavigation module)
  var KeyboardNav = window.LexeraKeyboardNavigation;

  function handleKeyNavigation(e) {
    if (KeyboardNav) KeyboardNav.handleKeyNavigation(e);
  }
  function navigateCards(key) {
    if (KeyboardNav) KeyboardNav.navigateCards(key);
  }
  function focusCard(cardEl) {
    if (KeyboardNav) KeyboardNav.focusCard(cardEl);
  }
  function unfocusCard() {
    if (KeyboardNav) KeyboardNav.unfocusCard();
  }
  function focusBoardEntity(el) {
    if (KeyboardNav) return KeyboardNav.focusBoardEntity(el);
    return false;
  }
  function getFocusedCardEl() {
    if (KeyboardNav) return KeyboardNav.getFocusedCardEl();
    return null;
  }

  function connectSSEIfReady() {
    if (eventSource) return;
    traceFrontendAction('info', 'sse.connect', 'Opening board SSE stream', {});
    eventSource = LexeraApi.connectSSE(handleSSEEvent);
    if (eventSource) {
      // Reduce polling to 30s health checks while SSE is active
      clearInterval(pollInterval);
      pollInterval = setInterval(poll, 30000);
      eventSource.onopen = function () {
        traceFrontendAction('info', 'sse.connect', 'Board SSE stream connected', {});
      };
      eventSource.onerror = function () {
        traceFrontendAction('warn', 'sse.connect', 'Board SSE stream error; falling back to short polling', {});
        eventSource.close();
        eventSource = null;
        // Restore normal polling
        clearInterval(pollInterval);
        pollInterval = setInterval(poll, 5000);
      };
    } else {
      traceFrontendAction('warn', 'sse.connect', 'Board SSE stream not opened because backend URL is unavailable', {});
    }
  }

  // ── WebSocket CRDT Sync ─────────────────────────────────────────────

  var syncUserId = null;
  var syncUserName = null;
  var boardPresenceCache = {}; // boardId -> [user_id, ...]
  var editingPresenceMap = {}; // user_id -> { card_kid, user_name, cursor_pos, is_typing }

  function getLiveSyncSession(boardId) {
    if (!liveSyncState) return null;
    if (!boardId) return liveSyncState;
    return liveSyncState.boardId === boardId ? liveSyncState : null;
  }

  function hasLiveSyncSession(boardId) {
    return !!getLiveSyncSession(boardId);
  }

  function canUseLiveSync(boardId) {
    return !!(
      boardId &&
      hasLiveSyncSession(boardId) &&
      LexeraApi.isSyncConnected() &&
      LexeraApi.getSyncBoardId() === boardId
    );
  }

  async function closeLiveSyncSession(boardId) {
    var session = getLiveSyncSession(boardId);
    if (!session) return;
    liveSyncState = null;
    try {
      await LexeraApi.closeLiveSyncSession(session.sessionId);
    } catch (e) {
      // best-effort cleanup
    }
  }

  async function ensureLiveSyncSession(boardId) {
    if (!boardId) return null;
    var existing = getLiveSyncSession(boardId);
    if (existing) return existing;
    if (liveSyncState && liveSyncState.boardId !== boardId) {
      await closeLiveSyncSession();
    }
    var response = await LexeraApi.openLiveSyncSession(boardId);
    liveSyncState = {
      boardId: boardId,
      sessionId: response.sessionId,
      vv: response.vv || '',
      board: response.board || null,
      pendingRemoteUpdates: []
    };
    traceFrontendAction('info', 'liveSync.session', 'Opened live sync session', {
      boardId: boardId,
      sessionId: response.sessionId,
      vvLength: response && response.vv ? response.vv.length : 0,
      sessionIdentity: summarizeBoardIdentity(response.board)
    });
    if (activeBoardId === boardId && fullBoardData && response && response.board) {
      traceBoardIdentityPair('info', 'liveSync.session', 'Identity comparison after live sync session open', boardId, 'local', fullBoardData, 'session', response.board);
    }
    return liveSyncState;
  }

  async function reopenLiveSyncSession(boardId) {
    if (!boardId) return null;
    await closeLiveSyncSession(boardId);
    return ensureLiveSyncSession(boardId);
  }

  function getLiveSyncHelloVv(boardId) {
    var session = getLiveSyncSession(boardId);
    return session && session.vv ? session.vv : '';
  }

  async function applyBoardToLiveSyncSession(boardId, boardData, options) {
    options = options || {};
    if (!canUseLiveSync(boardId)) return false;
    var session = getLiveSyncSession(boardId);
    if (!session) return false;

    console.log('[applyBoardToLiveSync] sending board=' + boardCardSummary(boardData) + ' session_board=' + boardCardSummary(session.board));
    traceBoardIdentityPair('info', 'liveSync.apply', 'Applying local board into live sync session', boardId, 'local', boardData, 'session', session.board, {
      vvLength: session.vv ? session.vv.length : 0
    });
    var response = await LexeraApi.applyLiveSyncBoard(session.sessionId, boardData);
    if (response && response.vv) session.vv = response.vv;
    if (response && response.board) session.board = response.board;
    console.log('[applyBoardToLiveSync] response changed=' + (response && response.changed) + ' response_board=' + boardCardSummary(response && response.board) + ' updates_len=' + (response && response.updates ? response.updates.length : 0));
    if (response && response.board && options.syncSaveBase && boardId === activeBoardId && fullBoardData) {
      var savedLiveBoard = resolveLiveSyncBoardData(cloneBoardData(response.board), boardId);
      setBoardSaveBase(fullBoardData, savedLiveBoard);
      pendingExternalRebaseConflict = null;
      traceFrontendAction('info', 'liveSync.saveBase', 'Updated local save base from live sync save result', {
        boardId: boardId,
        liveSummary: summarizeBoardHierarchy(savedLiveBoard),
        workingSummary: summarizeBoardHierarchy(fullBoardData)
      });
      traceBoardIdentityPair('info', 'liveSync.saveBase', 'Identity comparison after live sync save result', boardId, 'local', fullBoardData, 'saveBase', savedLiveBoard);
    }
    if (response && response.changed && response.updates) {
      if (!LexeraApi.sendSyncUpdate(response.updates)) {
        console.log('[applyBoardToLiveSync] sendSyncUpdate FAILED');
        return false;
      }
      console.log('[applyBoardToLiveSync] sent WS update');
      liveSyncLastLocalBroadcastAt = Date.now();
      lastSaveTime = liveSyncLastLocalBroadcastAt;
    }
    if (response && response.board && !options.skipBoardReplace && boardId === activeBoardId) {
      applyLiveSyncBoardSnapshot(boardId, response.board, options);
    }
    return true;
  }

  async function importLiveSyncMessage(boardId, updates, options) {
    options = options || {};
    var session = getLiveSyncSession(boardId);
    if (!session || !updates) return false;

    if (activeBoardId === boardId && isEditing && !options.force) {
      session.pendingRemoteUpdates.push(updates);
      pendingRefresh = true;
      return true;
    }

    var response = await LexeraApi.importLiveSyncUpdates(session.sessionId, updates);
    if (response && response.vv) session.vv = response.vv;
    if (response && response.board) session.board = response.board;
    if (response && response.changed && response.board && boardId === activeBoardId) {
      traceBoardIdentityPair('info', 'liveSync.import', 'Received remote live sync board update', boardId, 'local', fullBoardData, 'remote', response.board, {
        updateBytes: updates ? updates.length : 0,
        dirty: isBoardDirty()
      });
      if (isBoardDirty()) {
        traceFrontendAction('info', 'liveSync.rebase', 'Rebasing dirty local board after remote live sync update', {
          boardId: boardId,
          incomingSummary: summarizeBoardHierarchy(response.board),
          workingSummary: summarizeBoardHierarchy(fullBoardData)
        });
        await rebaseDirtyBoardFromServer('live-sync');
      } else {
        applyLiveSyncBoardSnapshot(boardId, response.board, options);
      }
    }
    return !!(response && response.changed);
  }

  async function flushPendingLiveSyncUpdates(options) {
    options = options || {};
    var session = getLiveSyncSession(activeBoardId);
    if (!session || !session.pendingRemoteUpdates || session.pendingRemoteUpdates.length === 0) {
      return false;
    }
    if (isEditing && !options.force) {
      return false;
    }

    var pending = session.pendingRemoteUpdates.slice();
    session.pendingRemoteUpdates.length = 0;
    var changed = false;
    var lastBoard = null;
    for (var i = 0; i < pending.length; i++) {
      var response = await LexeraApi.importLiveSyncUpdates(session.sessionId, pending[i]);
      if (response && response.vv) session.vv = response.vv;
      if (response && response.board) session.board = response.board;
      if (response && response.changed) {
        changed = true;
      }
      if (response && response.board) {
        lastBoard = response.board;
      }
    }
    if (changed && lastBoard && session.boardId === activeBoardId) {
      traceBoardIdentityPair('info', 'liveSync.import', 'Applying queued remote live sync updates', session.boardId, 'local', fullBoardData, 'remote', lastBoard, {
        batchCount: pending.length,
        dirty: isBoardDirty()
      });
      if (isBoardDirty()) {
        traceFrontendAction('info', 'liveSync.rebase', 'Rebasing dirty local board after queued remote live sync updates', {
          boardId: session.boardId,
          incomingSummary: summarizeBoardHierarchy(lastBoard),
          workingSummary: summarizeBoardHierarchy(fullBoardData)
        });
        await rebaseDirtyBoardFromServer('live-sync-pending');
      } else {
        applyLiveSyncBoardSnapshot(session.boardId, lastBoard, options);
      }
    }
    return changed;
  }

  async function flushDeferredBoardRefresh(options) {
    options = options || {};
    if (!pendingRefresh) return false;
    pendingRefresh = false;
    if (hasLiveSyncSession(activeBoardId)) {
      return flushPendingLiveSyncUpdates(options);
    }
    // Never reload from disk if there are unsaved changes
    if (activeBoardId && !isBoardDirty()) {
      await loadBoard(activeBoardId);
      return true;
    }
    return false;
  }

  function clearPendingCardDraftSync() {
    if (liveDraftSyncTimer) {
      clearTimeout(liveDraftSyncTimer);
      liveDraftSyncTimer = null;
    }
    liveDraftSyncRequest = null;
  }

  function cloneBoardWithDraftCardContent(boardData, colIndex, fullCardIdx, content) {
    var draftBoard = cloneBoardData(boardData);
    var columns = getAllColumnsFromBoardData(draftBoard);
    var column = columns[colIndex];
    if (!column || !column.cards || !column.cards[fullCardIdx]) return null;
    column.cards[fullCardIdx].content = content;
    return draftBoard;
  }

  async function syncCardDraftToLiveSession(colIndex, fullCardIdx, content) {
    if (!canUseLiveSync(activeBoardId) || !fullBoardData) return false;
    var draftBoard = cloneBoardWithDraftCardContent(fullBoardData, colIndex, fullCardIdx, content);
    if (!draftBoard) return false;
    return applyBoardToLiveSyncSession(activeBoardId, draftBoard, { skipBoardReplace: true });
  }

  function queueCardDraftLiveSync(colIndex, fullCardIdx, content) {
    if (!canUseLiveSync(activeBoardId)) return;
    liveDraftSyncRequest = {
      boardId: activeBoardId,
      colIndex: colIndex,
      fullCardIdx: fullCardIdx,
      content: content
    };
    if (liveDraftSyncTimer) clearTimeout(liveDraftSyncTimer);
    liveDraftSyncTimer = setTimeout(function () {
      liveDraftSyncTimer = null;
      var request = liveDraftSyncRequest;
      liveDraftSyncRequest = null;
      if (!request || request.boardId !== activeBoardId) return;
      syncCardDraftToLiveSession(request.colIndex, request.fullCardIdx, request.content).catch(function (err) {
        logFrontendIssue('error', 'live-sync', 'Failed to sync card draft', err);
      });
    }, 250);
  }

  async function revertCardDraftLiveSync(colIndex, fullCardIdx, originalContent) {
    clearPendingCardDraftSync();
    if (!canUseLiveSync(activeBoardId)) return false;
    return syncCardDraftToLiveSession(colIndex, fullCardIdx, originalContent);
  }

  /** Fetch the local user ID for sync, caching it for the session. */
  async function ensureSyncUserId() {
    if (syncUserId) return syncUserId;
    try {
      var data = await LexeraApi.request('/collab/me');
      if (data && data.id) syncUserId = data.id;
      if (data && data.name) syncUserName = data.name;
    } catch (e) {
      // collab/me not available — use a fallback
    }
    if (!syncUserId) syncUserId = 'anon-' + Math.random().toString(36).slice(2, 8);
    return syncUserId;
  }

  /** Connect sync for the active board. Disconnects previous if different. */
  var syncDebounceTimer = null;
  async function connectSyncForBoard(boardId) {
    if (!boardId) {
      LexeraApi.disconnectSync();
      await closeLiveSyncSession();
      return;
    }
    try {
      await ensureLiveSyncSession(boardId);
    } catch (err) {
      logFrontendIssue('warn', 'live-sync', 'Failed to open session for board ' + boardId, err);
    }
    if (LexeraApi.isSyncConnected() && LexeraApi.getSyncBoardId() === boardId) return;
    var userId = await ensureSyncUserId();
    LexeraApi.connectSync(boardId, userId, function (message) {
      if (!message || !message.updates || activeBoardId !== boardId) return;
      if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
      syncDebounceTimer = setTimeout(function () {
        syncDebounceTimer = null;
        importLiveSyncMessage(boardId, message.updates).catch(function (err) {
          logFrontendIssue('error', 'live-sync', 'Failed to import sync update', err);
          if (activeBoardId === boardId && !isEditing) loadBoard(boardId);
        });
      }, message.type === 'hello' ? 0 : 50);
    }, function (onlineUsers) {
      // On ServerPresence: update cache and sidebar badge
      boardPresenceCache[boardId] = onlineUsers;
      updateBoardPresenceIndicator(boardId);
      // Clean up editing presence for users who went offline
      var changed = false;
      for (var uid in editingPresenceMap) {
        if (onlineUsers.indexOf(uid) === -1) {
          delete editingPresenceMap[uid];
          changed = true;
        }
      }
      if (changed) updateCardEditingIndicators();
    }, {
      getHelloVv: function () {
        return getLiveSyncHelloVv(boardId);
      },
      onEditingPresence: handleEditingPresence
    });
  }

  function updateBoardPresenceIndicator(boardId) {
    var wrapper = document.querySelector('.board-item-wrapper[data-board-id="' + boardId + '"]');
    if (!wrapper) return;
    var badge = wrapper.querySelector('.board-presence-badge');
    var count = (boardPresenceCache[boardId] || []).length;
    if (badge) {
      if (count > 0) {
        badge.textContent = count;
        badge.title = count + ' user(s) online';
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  // ── Per-card editing presence ──────────────────────────────────────

  var PRESENCE_COLORS = [
    '#e57373', '#f06292', '#ba68c8', '#9575cd',
    '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1',
    '#4db6ac', '#81c784', '#aed581', '#ffb74d'
  ];

  function userIdToColor(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
  }

  function getInitials(name) {
    if (!name) return 'U';
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }

  function handleEditingPresence(msg) {
    var userId = msg.user_id;
    if (!userId || userId === syncUserId) return;
    if (!msg.card_kid) {
      delete editingPresenceMap[userId];
    } else {
      editingPresenceMap[userId] = {
        card_kid: msg.card_kid,
        user_name: msg.user_name || userId,
        cursor_pos: msg.cursor_pos,
        is_typing: msg.is_typing
      };
    }
    updateCardEditingIndicators();
  }

  function updateCardEditingIndicators() {
    // Remove all existing indicators and remote-editing classes
    var existing = document.querySelectorAll('.card-editing-indicator');
    for (var i = 0; i < existing.length; i++) {
      existing[i].parentNode.removeChild(existing[i]);
    }
    var remoteCards = document.querySelectorAll('.card.remote-editing');
    for (var i = 0; i < remoteCards.length; i++) {
      remoteCards[i].classList.remove('remote-editing');
    }

    // Build kid -> [editors] map
    var kidEditors = {};
    for (var uid in editingPresenceMap) {
      var entry = editingPresenceMap[uid];
      if (!entry.card_kid) continue;
      if (!kidEditors[entry.card_kid]) kidEditors[entry.card_kid] = [];
      kidEditors[entry.card_kid].push(entry);
    }

    if (Object.keys(kidEditors).length === 0) return;

    // Find card elements by data-card-kid attribute
    for (var kid in kidEditors) {
      var cardEl = document.querySelector('.card[data-card-kid="' + kid + '"]');
      if (!cardEl) continue;
      cardEl.classList.add('remote-editing');
      var indicator = document.createElement('div');
      indicator.className = 'card-editing-indicator';
      var html = '';
      var editors = kidEditors[kid];
      for (var j = 0; j < editors.length; j++) {
        var e = editors[j];
        var color = userIdToColor(e.user_name || 'unknown');
        var typingClass = e.is_typing ? ' typing' : '';
        html += '<span class="card-editor-badge' + typingClass + '" style="background:' + color + '" title="' + escapeHtml(e.user_name) + '">'
          + escapeHtml(getInitials(e.user_name))
          + '</span>';
      }
      indicator.innerHTML = html;
      var header = cardEl.querySelector('.card-header');
      var menuBtn = cardEl.querySelector('.card-menu-btn');
      if (header && menuBtn) {
        header.insertBefore(indicator, menuBtn);
      } else if (header) {
        header.appendChild(indicator);
      }
    }
  }

  var editingPresenceTimer = null;
  var editingPresenceRequest = null;

  function queueEditingPresenceBroadcast(cardKid, cursorPos, isTyping) {
    if (!cardKid || !LexeraApi.isSyncConnected()) return;
    editingPresenceRequest = { cardKid: cardKid, cursorPos: cursorPos, isTyping: isTyping };
    if (editingPresenceTimer) return;
    editingPresenceTimer = setTimeout(function () {
      editingPresenceTimer = null;
      var req = editingPresenceRequest;
      editingPresenceRequest = null;
      if (!req) return;
      LexeraApi.sendEditingPresence(req.cardKid, syncUserName || syncUserId, req.cursorPos, req.isTyping);
    }, 250);
  }

  function clearEditingPresenceQueue() {
    if (editingPresenceTimer) {
      clearTimeout(editingPresenceTimer);
      editingPresenceTimer = null;
    }
    editingPresenceRequest = null;
  }

  function handleSSEEvent(event) {
    try {
    var kind = event.kind || event.type || '';
    // Forward collab/peer/config events to the shared management UI
    if (typeof ManagementUI !== 'undefined' && mgmtInitialized) {
      if (kind === 'CollabConnectionChanged') { ManagementUI.refresh('connections'); return; }
      if (kind === 'PeerDiscoveryChanged') { ManagementUI.refresh('peers'); return; }
      if (kind === 'ConfigChanged') { ManagementUI.refresh(); return; }
    }
    if (!activeBoardId || searchMode) return;
    var boardId = event.board_id || event.boardId || '';
    var includeBoardIds = event.board_ids || event.boardIds || [];
    var writerId = event.writer_id || event.writerId || null;
    if (boardId && boardId !== activeBoardId) return;
    if (kind === 'IncludeFileChanged' && Array.isArray(includeBoardIds) && includeBoardIds.length > 0 && includeBoardIds.indexOf(activeBoardId) === -1) {
      traceFrontendAction('info', 'sse.fileChanged.ignore', 'Ignoring include change for unrelated board', {
        activeBoardId: activeBoardId,
        includeBoardIds: includeBoardIds
      });
      return;
    }
    if (kind === 'MainFileChanged' || kind === 'IncludeFileChanged') {
      // Skip echoes caused by our own saves
      if (Date.now() - lastSaveTime < SAVE_DEBOUNCE_MS) return;
      if (canUseLiveSync(activeBoardId) && Date.now() - liveSyncLastLocalBroadcastAt < SAVE_DEBOUNCE_MS) return;
      var eventGen = event.generation;
      var eventRevision = typeof event.revision === 'string' && event.revision ? event.revision : null;
      var remoteActive = isActiveRemoteBoard();
      if (!remoteActive && kind === 'MainFileChanged' && eventRevision && _lastLoadedRevision && eventRevision === _lastLoadedRevision) {
        traceFrontendAction('info', 'sse.fileChanged.stale', 'Ignoring stale file change event', {
          eventRevision: eventRevision,
          loadedRevision: _lastLoadedRevision,
          eventGeneration: eventGen,
          loadedGeneration: _lastLoadedGeneration,
          writerId: writerId
        });
        return;
      }
      traceFrontendAction('info', 'sse.fileChanged', 'File changed on disk, reconciling with active board', {
        boardId: activeBoardId,
        kind: kind,
        dirty: _boardDirty,
        isRemoteBoard: remoteActive,
        writerId: writerId,
        eventRevision: eventRevision,
        loadedRevision: _lastLoadedRevision,
        eventGeneration: eventGen,
        loadedGeneration: _lastLoadedGeneration,
        includeBoardIds: includeBoardIds
      });
      if (!_boardDirty && !_saveInFlight) {
        traceFrontendAction('info', 'sse.fileChanged.reload', 'Reloading clean active board after external change event', {
          boardId: activeBoardId,
          kind: kind,
          eventRevision: eventRevision,
          eventGeneration: eventGen
        });
        Promise.resolve()
          .then(function () { return loadBoard(activeBoardId); })
          .catch(function (err) {
            logFrontendIssue('warn', 'sse.fileChanged.reload', 'Failed to reload clean board after external change', err);
            showNotification('Board file changed on disk. Reload failed.');
          });
        return;
      }
      if (_saveInFlight && !_boardDirty) {
        traceFrontendAction('info', 'sse.fileChanged.deferred', 'Deferring board reload because save is in flight', {
          boardId: activeBoardId,
          kind: kind
        });
        return;
      }
      traceFrontendAction('warn', 'sse.fileChanged.rebase', 'Board is dirty while external change arrived; attempting rebase', {
        boardId: activeBoardId,
        kind: kind,
        isRemoteBoard: isActiveRemoteBoard(),
        eventRevision: eventRevision,
        loadedRevision: _lastLoadedRevision,
        eventGeneration: eventGen,
        loadedGeneration: _lastLoadedGeneration
      });
      Promise.resolve()
        .then(function () { return rebaseDirtyBoardFromServer(kind); })
        .catch(function (err) {
          logFrontendIssue('warn', 'sse.fileChanged.rebase', 'Failed to rebase dirty board after external change', err);
          showNotification('Board file changed on disk. Rebase failed; your local draft was kept.');
        });
    }
    if (kind === 'Resync') {
      traceFrontendAction('warn', 'sse.resync', 'SSE client lagged — performing full board reload', {
        boardId: activeBoardId
      });
      if (activeBoardId) {
        Promise.resolve()
          .then(function () { return loadBoard(activeBoardId); })
          .catch(function (err) {
            logFrontendIssue('warn', 'sse.resync', 'Failed to reload board after SSE resync', err);
          });
      }
    }
    } catch (err) {
      logFrontendIssue('error', 'sse', 'Error in handleSSEEvent', err);
    }
  }

  // --- Polling ---

  async function poll() {
    try {
      const ok = await LexeraApi.checkStatus();
      setConnected(ok);
      if (!ok) return;
    } catch (err) {
      logFrontendIssue('warn', 'poll.status', 'Failed to check backend status', err);
      setConnected(false);
      return;
    }

    connectSSEIfReady();
    connectBackendLogStreamIfReady();

    try {
      // Load workspaces
      try {
        var wsData = await LexeraApi.request('/config/workspaces');
        workspaces = Array.isArray(wsData.workspaces) ? wsData.workspaces : [];
        resolveActiveWorkspaceId(wsData.default_workspace || null);
        renderWorkspaceSelect();
      } catch (err) {
        logFrontendIssue('warn', 'poll.workspaces', 'Failed to load workspaces', err);
      }

      const data = await LexeraApi.getBoards();
      boards = data.boards || [];
      try {
        var rb = await LexeraApi.getRemoteBoards();
        remoteBoards = (rb.boards || []).map(function (board) {
          if (board) board.isRemote = true;
          return board;
        });
      } catch (err) {
        logFrontendIssue('warn', 'boards.remote', 'Failed to load remote boards', err);
        remoteBoards = [];
      }
      await refreshBoardHierarchyCache(boards);
      renderBoardList();
      if (workspaceShellEnabled && WorkspaceShell && typeof WorkspaceShell.onBoardsUpdated === 'function') {
        WorkspaceShell.onBoardsUpdated(boards.concat(remoteBoards));
      }
      if (workspaceShellEnabled) {
        if (!searchMode) {
          if (activeBoardId && !findBoardMeta(activeBoardId)) {
            setShellActiveBoard(null);
          }
          if (!activeBoardId) {
            var initialBoardId = embeddedMode
              ? embeddedPreferredBoardId
              : (urlParams.get('board') || localStorage.getItem('lexera-last-board') || (boards[0] && boards[0].id) || '');
            if (initialBoardId && findBoardMeta(initialBoardId) && typeof WorkspaceShell.ensureInitialTab === 'function') {
              WorkspaceShell.ensureInitialTab(initialBoardId);
            }
          }
        }
        refreshHeaderFileControls();
        scheduleDashboardRefresh(120);
        return;
      }

      if (activeBoardId && !searchMode) {
        const stillExists = !!findBoardMeta(activeBoardId);
        if (stillExists) {
          // Never reload the board if there are unsaved changes or the user
          // is actively editing a card — that would discard work.
          if (!isBoardDirty() && !isEditing) {
            traceFrontendAction('info', 'poll.reload', 'Polling reload for active board (clean)', {
              boardId: activeBoardId,
              revision: _lastLoadedRevision || null,
              generation: _lastLoadedGeneration
            });
            await loadBoard(activeBoardId);
          } else {
            traceFrontendAction('warn', 'poll.reload.skipDirty', 'Skipped polling reload because active board is dirty or being edited', {
              boardId: activeBoardId,
              isRemoteBoard: isActiveRemoteBoard(),
              dirty: isBoardDirty(),
              editing: isEditing,
              revision: _lastLoadedRevision || null,
              generation: _lastLoadedGeneration,
              summary: summarizeBoardHierarchy(fullBoardData)
            });
          }
        } else {
          // Board was removed while we had it open.  If the user is editing
          // or has unsaved changes, write a crashsave so work is not lost.
          if (isBoardDirty() || isEditing) {
            logFrontendIssue('warn', 'poll.boardRemoved', 'Active board removed while dirty/editing — creating crashsave', { boardId: activeBoardId });
            try { await LexeraApi.writeBoardCrashsave(activeBoardId, fullBoardData); } catch (_) { /* best-effort */ }
          }
          await closeLiveSyncSession(activeBoardId);
          LexeraApi.disconnectSync();
          activeBoardId = null;
          activeBoardData = null;
          fullBoardData = null;
          _lastLoadedGeneration = null;
          _lastLoadedRevision = null;
          if (!embeddedMode) localStorage.removeItem('lexera-last-board');
          renderMainView();
        }
      } else if (!activeBoardId && !searchMode) {
        var lastBoard = embeddedMode ? embeddedPreferredBoardId : (urlParams.get('board') || localStorage.getItem('lexera-last-board'));
        if (lastBoard) {
          var found = findBoardMeta(lastBoard);
          if (found) {
            await selectBoard(lastBoard);
          }
        }
      }
      refreshHeaderFileControls();
      scheduleDashboardRefresh(120);
    } catch (err) {
      logFrontendIssue('warn', 'poll.refresh', 'Failed to refresh board list or active board state', err);
      // keep previous state
      refreshHeaderFileControls();
      scheduleDashboardRefresh(250);
    }
  }

  function setConnected(state) {
    if (state && !connected) loadTemplatesOnce();
    connected = state;
    if (typeof window.setLogBackendConnectionState === 'function') {
      window.setLogBackendConnectionState(state);
    }
    syncConnectionStatusButton(getElConnectionStatusBtn(), getElConnectionDot(), state);
  }

  function syncConnectionStatusButton(buttonEl, dotEl, state) {
    var isConnected = !!state;
    var title = isConnected
      ? 'Backend connected. Open backend settings'
      : 'Backend disconnected. Open backend settings';
    if (buttonEl) {
      buttonEl.classList.toggle('connected', isConnected);
      buttonEl.classList.toggle('disconnected', !isConnected);
      buttonEl.setAttribute('data-connection-state', isConnected ? 'connected' : 'disconnected');
      buttonEl.title = title;
      buttonEl.setAttribute('aria-label', title);
      var labelEl = buttonEl.querySelector('.connection-status-label');
      if (labelEl) labelEl.textContent = isConnected ? 'Connected' : 'Disconnected';
    }
    if (dotEl) {
      dotEl.classList.toggle('connected', isConnected);
      dotEl.classList.toggle('disconnected', !isConnected);
    }
  }

  // --- Board List --- (delegated to LexeraBoardList module)

  var BoardList = window.LexeraBoardList;
  function getSidebarExpandedBoards() { return BoardList.getSidebarExpandedBoards(); }
  function saveSidebarExpandedBoards(ids) { BoardList.saveSidebarExpandedBoards(ids); }
  function getSidebarTreeState(boardId) { return BoardList.getSidebarTreeState(boardId); }
  function hasSidebarTreeState(boardId) { return BoardList.hasSidebarTreeState(boardId); }
  function saveSidebarTreeState(boardId, state) { BoardList.saveSidebarTreeState(boardId, state); }
  function getSidebarTreeChildrenContainer(node) { return BoardList.getSidebarTreeChildrenContainer(node); }
  function getSidebarTreeOwnerNode(container) { return BoardList.getSidebarTreeOwnerNode(container); }
  function toggleSidebarTreeNode(boardId, kind, id) { BoardList.toggleSidebarTreeNode(boardId, kind, id); }
  function setDescendantTreeState(container, expand, boardId) { BoardList.setDescendantTreeState(container, expand, boardId); }
  function buildSidebarTreeNodes(rows, boardId, treeState, hasTreeState) { return BoardList.buildSidebarTreeNodes(rows, boardId, treeState, hasTreeState); }
  function countCardsInRow(row) { return BoardList.countCardsInRow(row); }
  function countCardsInStack(stack) { return BoardList.countCardsInStack(stack); }
  function countCardsInRows(rows) { return BoardList.countCardsInRows(rows); }
  function cloneRows(rows) { return BoardList.cloneRows(rows); }
  function cloneBoardData(boardData) { return BoardList.cloneBoardData(boardData); }
  function boardDraftStorageKey(boardId) { return BoardList.boardDraftStorageKey(boardId); }

  function getBoardCardKids(boardData) { return BoardList.getBoardCardKids(boardData); }
  function getBoardCardIdentityStats(boardA, boardB) { return BoardList.getBoardCardIdentityStats(boardA, boardB); }
  function summarizeBoardIdentity(boardData, limit) { return BoardList.summarizeBoardIdentity(boardData, limit); }
  function describeBoardIdentityPair(labelA, boardA, labelB, boardB, limit) { return BoardList.describeBoardIdentityPair(labelA, boardA, labelB, boardB, limit); }
  function traceBoardIdentityPair(level, target, message, boardId, labelA, boardA, labelB, boardB, extra) { BoardList.traceBoardIdentityPair(level, target, message, boardId, labelA, boardA, labelB, boardB, extra); }
  function hasBoardIdentityMismatch(boardA, boardB) { return BoardList.hasBoardIdentityMismatch(boardA, boardB); }
  function saveLocalBoardDraft(boardId, boardData) { BoardList.saveLocalBoardDraft(boardId, boardData); }
  function loadLocalBoardDraft(boardId) { return BoardList.loadLocalBoardDraft(boardId); }
  function clearLocalBoardDraft(boardId) { BoardList.clearLocalBoardDraft(boardId); }
  function boardCardSummary(bd) { return BoardList.boardCardSummary(bd); }
  function setBoardSaveBase(boardData, baseBoardData) { return BoardList.setBoardSaveBase(boardData, baseBoardData); }
  function getBoardSaveBase(boardData) { return BoardList.getBoardSaveBase(boardData); }
  function resolveSavedBoardData(boardData, result, boardId) { return BoardList.resolveSavedBoardData(boardData, result, boardId); }
  function resolveLiveSyncBoardData(boardData, boardId) { return BoardList.resolveLiveSyncBoardData(boardData, boardId); }

  function applyLiveSyncBoardSnapshot(boardId, boardData, options) { BoardList.applyLiveSyncBoardSnapshot(boardId, boardData, options); }
  function applyRebasedBoardSnapshot(boardId, workingBoard, currentBoard, result, options) { BoardList.applyRebasedBoardSnapshot(boardId, workingBoard, currentBoard, result, options); }
  async function rebaseDirtyBoardFromServer(triggerKind) { return BoardList.rebaseDirtyBoardFromServer(triggerKind); }
  function rowsFromLegacyColumns(columns, boardTitle) { return BoardList.rowsFromLegacyColumns(columns, boardTitle); }
  function rowsForBoardData(fullBoard, fallbackTitle) { return BoardList.rowsForBoardData(fullBoard, fallbackTitle); }

  function setBoardHierarchyRows(boardId, fullBoard, fallbackTitle) { BoardList.setBoardHierarchyRows(boardId, fullBoard, fallbackTitle); }
  function getBoardHierarchyRows(boardId) { return BoardList.getBoardHierarchyRows(boardId); }
  async function refreshBoardHierarchyCache(boardList) { return BoardList.refreshBoardHierarchyCache(boardList); }
  function cardPreviewText(content) { return BoardList.cardPreviewText(content); }
  function setActiveWorkspaceId(workspaceId) { BoardList.setActiveWorkspaceId(workspaceId); }
  function applyWorkspaceAppearance(workspaceId) { BoardList.applyWorkspaceAppearance(workspaceId); }
  function resolveActiveWorkspaceId(defaultWorkspaceId) { BoardList.resolveActiveWorkspaceId(defaultWorkspaceId); }
  function dispatchMirrorMouseEvent(targetEl, eventType, sourceEvent) { return BoardList.dispatchMirrorMouseEvent(targetEl, eventType, sourceEvent); }
  function findCanonicalHierarchyTarget(sourceTarget) { return BoardList.findCanonicalHierarchyTarget(sourceTarget); }
  function bindMirroredWorkspaceView(rootEl) { BoardList.bindMirroredWorkspaceView(rootEl); }
  function syncMirroredWorkspaceViews() { BoardList.syncMirroredWorkspaceViews(); }

  function renderWorkspaceSelect() { BoardList.renderWorkspaceSelect(); }
  function getBoardWorkspaceIds(board) { return BoardList.getBoardWorkspaceIds(board); }
  async function removeBoardFromSidebar(boardId, boardName) { return BoardList.removeBoardFromSidebar(boardId, boardName); }

  function renderBoardList() { BoardList.renderBoardList(); }

  // --- Sidebar Sync --- (delegated to LexeraSidebarSync module)

  function syncSidebarToView() { if (SidebarSync) SidebarSync.syncSidebarToView(); }
  function highlightSidebarNode(selector) { if (SidebarSync) SidebarSync.highlightSidebarNode(selector); }
  function toggleSidebarSync() { if (SidebarSync) SidebarSync.toggleSidebarSync(); }
  function toggleSidebarLock() { if (SidebarSync) SidebarSync.toggleSidebarLock(); }
  function showSidebarHierarchyMenu(anchorEl) { if (SidebarSync) SidebarSync.showSidebarHierarchyMenu(anchorEl); }

  function trackRecentBoard(boardId) {
    if (!boardId || embeddedMode) return;
    try {
      var raw = JSON.parse(localStorage.getItem('lexera-recent-boards') || '[]');
      if (!Array.isArray(raw)) raw = [];
      raw = raw.filter(function (id) { return id !== boardId; });
      raw.unshift(boardId);
      if (raw.length > 10) raw.length = 10;
      localStorage.setItem('lexera-recent-boards', JSON.stringify(raw));
    } catch (e) { /* ignore storage errors */ }
  }

  function getRecentBoards() {
    try {
      var raw = JSON.parse(localStorage.getItem('lexera-recent-boards') || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (e) { return []; }
  }

  async function selectBoard(boardId, options) {
    options = options || {};
    if (!boardId) return;
    if (workspaceShellEnabled && WorkspaceShell && !options.forceLocalBoardLoad) {
      WorkspaceShell.openBoard(boardId, {
        duplicate: !!options.duplicate,
        preferExisting: options.preferExisting !== false,
        viewKind: options.viewKind || 'default'
      });
      return;
    }
    // Save unsaved changes before switching away from the current board
    if (activeBoardId && activeBoardId !== boardId && isBoardDirty()) {
      try { await saveFullBoard(); } catch (_) { /* auto-save retry will handle it */ }
    }
    activeBoardId = boardId;
    activeBoardData = null;
    fullBoardData = null;
    pendingExternalRebaseConflict = null;
    _lastLoadedGeneration = null;
    _lastLoadedRevision = null;
    addCardColumn = null;
    resetBoardDirtyState('selectBoard-switch', boardId);
    if (!embeddedMode) {
      localStorage.setItem('lexera-last-board', boardId);
      trackRecentBoard(boardId);
    } else {
      embeddedPreferredBoardId = boardId;
      if (window.parent && window.parent !== window) {
        try {
          window.parent.postMessage({
            type: 'lexera-pane-board-change',
            pane: embeddedPaneId || '',
            boardId: boardId
          }, '*');
        } catch (e) {
          // ignore cross-frame messaging issues
        }
      }
      notifyParentPaneActivated();
    }
    renderBoardList();
    refreshHeaderFileControls();
    scheduleDashboardRefresh(60);
    if (!options.skipLoad) await loadBoard(boardId);
  }

  async function loadBoard(boardId) {
    var seq = ++boardLoadSeq;
    var isBoardSwitch = boardId !== activeBoardId;
    if (BoardStatsFilter) BoardStatsFilter.resetState();
    columnSortState = {};
    closeSearchReplacePanel();
    // Reset canvas zoom and pan only when switching to a different board.
    // Reloading the same board (e.g. poll, save-then-poll) must preserve viewport.
    if (isBoardSwitch) {
      if ($canvasZoom !== 1) applyCanvasZoom(1);
      resetCanvasPan();
    }
    var loadStage = 'start';
    try {
      loadStage = 'clear-caches';
      clearBoardPreviewCaches(boardId);
      editingPresenceMap = {};
      var cachedRevision = (!isBoardSwitch && (_lastLoadedRevision || (activeBoardData && activeBoardData.revision)))
        ? (_lastLoadedRevision || activeBoardData.revision)
        : null;
      loadStage = cachedRevision != null ? 'fetch-cached' : 'fetch';
      var response = cachedRevision != null
        ? await LexeraApi.getBoardColumnsCached(boardId, cachedRevision)
        : await LexeraApi.getBoardColumns(boardId);
      if (seq !== boardLoadSeq) return; // stale response, a newer load was started
      if (response && response.notModified) {
        traceFrontendAction('info', 'board.load.notModified', 'Skipped board reload because backend returned not-modified', {
          boardId: boardId,
          revision: cachedRevision || null,
          dirty: isBoardDirty(),
          isRemoteBoard: isRemoteBoardId(boardId)
        });
        loadStage = 'connect-sync-not-modified';
        connectSyncForBoard(boardId);
        return;
      }
      loadStage = 'prepare-board-meta';
      var boardMeta = findBoardMeta(boardId);
      if (boardMeta && boardMeta.filePath) {
        response.filePath = boardMeta.filePath;
      }
      loadStage = 'assign-board-data';
      fullBoardData = response.fullBoard || null;
      if (fullBoardData) setBoardSaveBase(fullBoardData, fullBoardData);
      var isRemoteBoard = !!(response && response.isRemote);
      if (fullBoardData) {
        traceFrontendAction('info', 'board.load.identity', 'Loaded board from backend', {
          boardId: boardId,
          identity: summarizeBoardIdentity(fullBoardData)
        });
      }
      activeBoardData = response;
      try {
        await refreshAvailableMarpClasses(false);
      } catch (marpClassErr) {
        logFrontendIssue('warn', 'board.load.marp-classes', 'Failed to refresh Marp classes during board load', marpClassErr);
      }
      pendingExternalRebaseConflict = null;
      resetBoardDirtyState('loadBoard-fresh-backend-snapshot', boardId);
      var draftSnapshot = isRemoteBoard ? null : loadLocalBoardDraft(boardId);
      var shouldPrepareLiveSync = true;
      if (response && typeof response.generation === 'number') {
        _lastLoadedGeneration = response.generation;
      }
      _lastLoadedRevision = response && response.revision ? response.revision : null;
      // Auto-convert legacy boards and save immediately
      if (isRemoteBoard) {
        clearLocalBoardDraft(boardId);
      } else if (fullBoardData && (!fullBoardData.rows || fullBoardData.rows.length === 0)) {
        loadStage = 'migrate-legacy-board';
        migrateLegacyBoard();
        try {
          loadStage = 'save-migrated-board';
          await saveFullBoard();
        } catch (err) {
          logFrontendIssue('warn', 'board.load.migrate', 'Failed to persist migrated board ' + boardId, err);
        }
        if (seq !== boardLoadSeq) return; // check again after second await
      }
      if (draftSnapshot && draftSnapshot.board) {
        var currentSerialized = JSON.stringify(cloneBoardData(fullBoardData));
        var draftSerialized = JSON.stringify(draftSnapshot.board);
        if (currentSerialized !== draftSerialized) {
          var currentBoard = response.fullBoard || null;
          var draftBaseBoard = draftSnapshot.baseBoard || null;
          var sameRevision = !!(draftSnapshot.revision && response.revision && draftSnapshot.revision === response.revision);
          var draftIdentity = getBoardCardIdentityStats(currentBoard, draftSnapshot.board);
          var draftMatchesCurrentIds = !hasBoardIdentityMismatch(currentBoard, draftSnapshot.board);
          var draftHasBase = !!draftBaseBoard;
          var canRestoreDirectly = sameRevision && draftMatchesCurrentIds;
          var canRestoreViaRebase = draftHasBase && !sameRevision;
          if (!canRestoreDirectly && !canRestoreViaRebase) {
            loadStage = 'restore-local-draft-blocked';
            shouldPrepareLiveSync = true;
            var discardUnrecoverableDraft = sameRevision && !draftHasBase && draftIdentity.overlap === 0;
            if (discardUnrecoverableDraft) {
              clearLocalBoardDraft(boardId);
              traceFrontendAction('info', 'board.draft.discard', 'Discarded incompatible stale local draft during board load', {
                boardId: boardId,
                currentRevision: response.revision || null,
                draftRevision: draftSnapshot.revision || null,
                hasBaseBoard: draftHasBase,
                identity: draftIdentity
              });
            } else {
              traceFrontendAction('warn', 'board.draft.restore', 'Skipped unsafe local draft restore because card identities no longer match current board', {
                boardId: boardId,
                currentRevision: response.revision || null,
                draftRevision: draftSnapshot.revision || null,
                hasBaseBoard: draftHasBase,
                discarded: false,
                identity: draftIdentity
              });
              showNotification('A local draft was preserved but not restored because it no longer matches the current board revision safely.');
            }
          } else {
            loadStage = 'restore-local-draft';
            var restoreMessage = canRestoreDirectly
              ? 'Restore the unsaved local draft for this board?\n\nIt was saved automatically on this device.'
              : (canRestoreViaRebase
                ? 'Restore the unsaved local draft for this board?\n\nExternal changes will be rebased against its saved base first.'
                : 'Restore the unsaved local draft for this board?\n\nIt was saved automatically on this device.');
            var restoreDraft = await showConfirmDialog(restoreMessage);
          }
          if (typeof restoreDraft !== 'undefined') {
            if (restoreDraft) {
              if (canRestoreViaRebase) {
                loadStage = 'restore-local-draft-rebase';
                try {
                  var rebasedDraft = await LexeraApi.rebaseBoardWithBase(boardId, draftBaseBoard, draftSnapshot.board);
                  if (rebasedDraft && rebasedDraft.currentBoard && !rebasedDraft.hasConflicts) {
                    fullBoardData = rebasedDraft.board || draftSnapshot.board;
                    ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
                    if (!fullBoardData.columns) fullBoardData.columns = [];
                    setBoardSaveBase(fullBoardData, rebasedDraft.currentBoard || response.fullBoard || fullBoardData);
                    markBoardDirty();
                  } else if (rebasedDraft && rebasedDraft.hasConflicts) {
                    shouldPrepareLiveSync = false;
                    pendingExternalRebaseConflict = {
                      result: rebasedDraft,
                      savedAt: Date.now()
                    };
                    traceFrontendAction('warn', 'board.draft.restore', 'Draft restore blocked by rebase conflicts', {
                      boardId: boardId,
                      currentRevision: response.revision || null,
                      draftRevision: draftSnapshot.revision || null,
                      conflicts: rebasedDraft.conflicts || 0
                    });
                    showNotification('The local draft was preserved, but it conflicts with the current board and was not restored automatically.');
                  }
                } catch (restoreErr) {
                  shouldPrepareLiveSync = false;
                  logFrontendIssue('warn', 'board.draft.restore', 'Failed to rebase local draft before restore', restoreErr);
                  showNotification('The local draft was preserved, but automatic restore failed.');
                }
              } else {
                fullBoardData = draftSnapshot.board;
                ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
                if (!fullBoardData.columns) fullBoardData.columns = [];
                setBoardSaveBase(fullBoardData, draftBaseBoard || response.fullBoard || fullBoardData);
                markBoardDirty();
              }
            } else {
              clearLocalBoardDraft(boardId);
            }
          }
        } else {
          clearLocalBoardDraft(boardId);
        }
      }
      if (fullBoardData) {
        try {
          loadStage = 'prepare-live-sync';
          await closeLiveSyncSession(boardId);
          if (shouldPrepareLiveSync) {
            await ensureLiveSyncSession(boardId);
            if (liveSyncState && liveSyncState.boardId === boardId && fullBoardData) {
              traceBoardIdentityPair('info', 'board.load.identity', 'Identity comparison after board load session prepare', boardId, 'local', fullBoardData, 'session', liveSyncState.board);
            }
          } else {
            liveSyncState = null;
            LexeraApi.disconnectSync();
          }
        } catch (e) {
          logFrontendIssue('warn', 'board.load.live-sync', 'Failed to prepare live sync session for board ' + boardId, e);
        }
      }
      loadStage = 'update-display';
      updateDisplayFromFullBoard(); // populate activeBoardData.rows before sidebar render
      loadStage = 'set-board-hierarchy';
      setBoardHierarchyRows(boardId, fullBoardData, response.title || '');
      loadStage = 'render-board-list';
      renderBoardList();
      loadStage = 'render-main-view';
      renderMainView();
      loadStage = 'schedule-dashboard-refresh';
      scheduleDashboardRefresh(80);
      // Connect WS sync for this board (no-op if already connected)
      loadStage = 'connect-sync';
      connectSyncForBoard(boardId);
    } catch (err) {
      if (seq !== boardLoadSeq) return; // stale error, ignore
      logFrontendIssue('error', 'board.load', 'Failed to load board ' + boardId + ' during ' + loadStage, err);
      try {
        await closeLiveSyncSession(boardId);
      } catch (closeErr) {
        logFrontendIssue('warn', 'board.load.live-sync', 'Failed to close live sync session after load failure for board ' + boardId, closeErr);
      }
      activeBoardData = null;
      fullBoardData = null;
      _lastLoadedGeneration = null;
      _lastLoadedRevision = null;
      renderMainView();
      scheduleDashboardRefresh(80);
    }
  }

  /**
   * Migrate legacy flat-column board to rows→stacks→columns format.
   * Called once on load; on next save the new format is persisted.
   */
  function migrateLegacyBoard() {
    if (!fullBoardData) return;
    if (fullBoardData.rows && fullBoardData.rows.length > 0) return; // already new format
    var cols = fullBoardData.columns || [];
    if (cols.length === 0) {
      fullBoardData.rows = [];
      return;
    }
    fullBoardData.rows = buildRowsFromLegacyColumns(cols, fullBoardData.title || 'Default');
    fullBoardData.columns = [];
  }

  /**
   * Get a flat list of all columns from fullBoardData (rows→stacks→columns).
   */
  function getAllColumnsFromBoardData(boardData) {
    var cols = [];
    if (!boardData || !boardData.rows) return cols;
    for (var r = 0; r < boardData.rows.length; r++) {
      var row = boardData.rows[r];
      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        for (var c = 0; c < stack.columns.length; c++) {
          cols.push(stack.columns[c]);
        }
      }
    }
    return cols;
  }

  /**
   * Get a flat list of all columns from fullBoardData (rows→stacks→columns).
   */
  function getAllFullColumns() {
    return getAllColumnsFromBoardData(fullBoardData);
  }

  /**
   * Get the column at flat index from fullBoardData (either format).
   */
  function getFullColumn(flatIndex) {
    var cols = getAllColumnsFromBoardData(fullBoardData);
    return (flatIndex >= 0 && flatIndex < cols.length) ? cols[flatIndex] : null;
  }

  function updateDisplayFromFullBoard() {
    if (!fullBoardData || !activeBoardData) return;

    var allCols = getAllFullColumns();
    var visibleColumns = [];
    var visibleRows = (fullBoardData.rows || [])
      .filter(function (row) {
        return !is_archived_or_deleted(row && row.title ? row.title : '');
      })
      .map(function (row) {
        var stacks = (row.stacks || [])
          .filter(function (stack) {
            return !is_archived_or_deleted(stack && stack.title ? stack.title : '');
          })
          .map(function (stack) {
            var cols = (stack.columns || [])
              .filter(function (col) { return !is_archived_or_deleted(col && col.title ? col.title : ''); })
              .map(function (col) {
                var cards = (col.cards || []).filter(function (c) {
                  return !is_archived_or_deleted(c && c.content ? c.content : '');
                });
                var flatIdx = allCols.indexOf(col);
                var visibleCards = cards.map(function (card) {
                  return {
                    id: card.id,
                    content: card.content,
                    checked: !!card.checked,
                    kid: card.kid,
                    params: card.params || {}
                  };
                });
                var visibleCol = {
                  index: flatIdx,
                  id: col.id,
                  title: col.title,
                  cards: visibleCards,
                  params: col.params || {}
                };
                visibleColumns.push(visibleCol);
                return visibleCol;
              });
            return { id: stack.id, title: stack.title, columns: cols, params: stack.params };
          });
        return { id: row.id, title: row.title, stacks: stacks, params: row.params || {} };
      });

    activeBoardData.columns = visibleColumns;
    activeBoardData.rows = visibleRows;
  }

  function is_archived_or_deleted(text) {
    return LexeraTagSystem.isArchivedOrDeleted(text);
  }

  function hasInternalHiddenTag(text, tag) {
    return LexeraTagSystem.hasInternalHiddenTag(text, tag);
  }

  function stripInternalHiddenTags(text) {
    return LexeraTagSystem.stripInternalHiddenTags(text);
  }

  function applyInternalHiddenTag(text, tag) {
    return LexeraTagSystem.applyInternalHiddenTag(text, tag);
  }

  function getColumnByLocation(rowIndex, stackIndex, colIndex) {
    if (!fullBoardData || !fullBoardData.rows) return null;
    var row = fullBoardData.rows[rowIndex];
    if (!row || !row.stacks) return null;
    var stack = row.stacks[stackIndex];
    if (!stack || !stack.columns) return null;
    return stack.columns[colIndex] || null;
  }

  function getRowByLocation(rowIndex) {
    if (!fullBoardData || !fullBoardData.rows) return null;
    return fullBoardData.rows[rowIndex] || null;
  }

  function getStackByLocation(rowIndex, stackIndex) {
    var row = getRowByLocation(rowIndex);
    if (!row || !row.stacks) return null;
    return row.stacks[stackIndex] || null;
  }

  function getCardByLocation(rowIndex, stackIndex, colIndex, cardIndex) {
    var col = getColumnByLocation(rowIndex, stackIndex, colIndex);
    if (!col || !col.cards) return null;
    return col.cards[cardIndex] || null;
  }

  function getRowByLocationInBoard(boardData, rowIndex) {
    return getBoardCleanupApi().getRowByLocationInBoard(boardData, rowIndex);
  }

  function getStackByLocationInBoard(boardData, rowIndex, stackIndex) {
    return getBoardCleanupApi().getStackByLocationInBoard(boardData, rowIndex, stackIndex);
  }

  function getColumnByLocationInBoard(boardData, rowIndex, stackIndex, colIndex) {
    return getBoardCleanupApi().getColumnByLocationInBoard(boardData, rowIndex, stackIndex, colIndex);
  }

  function getCardByLocationInBoard(boardData, rowIndex, stackIndex, colIndex, cardIndex) {
    return getBoardCleanupApi().getCardByLocationInBoard(boardData, rowIndex, stackIndex, colIndex, cardIndex);
  }

  function getBoardDisplayTitle(boardId, boardData) {
    if (boardData && boardData.title) return boardData.title;
    if (boardId === activeBoardId && activeBoardData && activeBoardData.title) return activeBoardData.title;
    var meta = findBoardMeta(boardId);
    if (meta && meta.title) return meta.title;
    var filePath = getBoardFilePathForId(boardId);
    return getDisplayNameFromPath(filePath || '') || 'Untitled';
  }

  function collectHiddenItemsFromBoardData(boardData, tag) {
    return getBoardCleanupApi().collectHiddenItemsFromBoardData(boardData, tag, getBoardCleanupDeps());
  }

  function collectHiddenItems(tag) {
    return collectHiddenItemsFromBoardData(fullBoardData, tag);
  }

  function getHiddenItemCount(tag) {
    return collectHiddenItems(tag).length;
  }

  function buildHiddenItemLocation(item) {
    var parts = [];
    if (item.kind !== 'row' && item.rowTitle) parts.push(item.rowTitle);
    if (item.kind !== 'stack' && item.kind !== 'row' && item.stackTitle) parts.push(item.stackTitle);
    if (item.kind === 'card' && item.colTitle) parts.push(item.colTitle);
    return parts.join(' / ');
  }

  // ── Archive formatting helpers (delegated to LexeraArchiveFormatting) ──
  var _archiveFormattingHelpers = null;

  function getArchiveFormattingHelpers() {
    if (_archiveFormattingHelpers) return _archiveFormattingHelpers;
    if (typeof globalThis !== 'undefined' && globalThis.LexeraArchiveFormatting && typeof globalThis.LexeraArchiveFormatting.createArchiveFormattingHelpers === 'function') {
      _archiveFormattingHelpers = globalThis.LexeraArchiveFormatting.createArchiveFormattingHelpers({
        getFileNameFromPath: getFileNameFromPath,
        getDirNameFromPath: getDirNameFromPath,
        stripInternalHiddenTags: stripInternalHiddenTags,
        stripLayoutTags: stripLayoutTags,
        stripHtmlComments: stripHtmlComments
      });
      return _archiveFormattingHelpers;
    }
    throw new Error('LexeraArchiveFormatting is unavailable');
  }

  function buildArchiveFileNameFromBoardPath(boardFilePath) {
    return getArchiveFormattingHelpers().buildArchiveFileNameFromBoardPath(boardFilePath);
  }

  function buildArchiveRelativePathFromBoardPath(boardFilePath) {
    return getArchiveFormattingHelpers().buildArchiveRelativePathFromBoardPath(boardFilePath);
  }

  function buildArchiveFilePathFromBoardPath(boardFilePath) {
    return getArchiveFormattingHelpers().buildArchiveFilePathFromBoardPath(boardFilePath);
  }

  function buildArchiveFileHeader() {
    return getArchiveFormattingHelpers().buildArchiveFileHeader();
  }

  function buildArchiveTagValue(dateValue) {
    return getArchiveFormattingHelpers().buildArchiveTagValue(dateValue);
  }

  function buildArchiveSectionHeading(level, label, title, archiveTag) {
    return getArchiveFormattingHelpers().buildArchiveSectionHeading(level, label, title, archiveTag);
  }

  function cleanArchiveHeadingTitle(title, options) {
    return getArchiveFormattingHelpers().cleanArchiveHeadingTitle(title, options);
  }

  function formatArchivedCardMarkdown(card, archiveTag) {
    return getArchiveFormattingHelpers().formatArchivedCardMarkdown(card, archiveTag);
  }

  function buildArchiveMarkdownForColumn(column, archiveTag, headingLevel) {
    return getArchiveFormattingHelpers().buildArchiveMarkdownForColumn(column, archiveTag, headingLevel);
  }

  function buildArchiveMarkdownForStack(stack, archiveTag, headingLevel) {
    return getArchiveFormattingHelpers().buildArchiveMarkdownForStack(stack, archiveTag, headingLevel);
  }

  function buildArchiveMarkdownForRow(row, archiveTag, headingLevel) {
    return getArchiveFormattingHelpers().buildArchiveMarkdownForRow(row, archiveTag, headingLevel);
  }

  function buildArchiveMarkdownForHiddenItems(items, options) {
    return getArchiveFormattingHelpers().buildArchiveMarkdownForHiddenItems(items, options);
  }

  function appendArchivedItemsToArchiveContent(existingContent, archivedContent) {
    return getArchiveFormattingHelpers().appendArchivedItemsToArchiveContent(existingContent, archivedContent);
  }

  function getArchiveFileContextForBoard(boardId) {
    var boardFilePath = boardId === activeBoardId
      ? getActiveBoardFilePath()
      : getBoardFilePathForId(boardId);
    if (!boardId || !boardFilePath) return null;
    return {
      boardId: boardId,
      boardFilePath: boardFilePath,
      filename: buildArchiveFileNameFromBoardPath(boardFilePath),
      relativePath: buildArchiveRelativePathFromBoardPath(boardFilePath),
      absolutePath: buildArchiveFilePathFromBoardPath(boardFilePath)
    };
  }

  function getArchiveFileContext() {
    return getArchiveFileContextForBoard(activeBoardId);
  }

  function getHiddenItemArchiveExportEntryFromBoardData(boardData, item) {
    if (!item || !boardData) return null;
    if (item.kind === 'row') {
      var row = getRowByLocationInBoard(boardData, item.rowIndex);
      return row ? { kind: 'row', data: row } : null;
    }
    if (item.kind === 'stack') {
      var stack = getStackByLocationInBoard(boardData, item.rowIndex, item.stackIndex);
      return stack ? { kind: 'stack', data: stack } : null;
    }
    if (item.kind === 'column') {
      var col = getColumnByLocationInBoard(boardData, item.rowIndex, item.stackIndex, item.colIndex);
      return col ? { kind: 'column', data: col } : null;
    }
    var card = getCardByLocationInBoard(boardData, item.rowIndex, item.stackIndex, item.colIndex, item.cardIndex);
    return card ? { kind: 'card', data: card } : null;
  }

  function getHiddenItemArchiveExportEntry(item) {
    return getHiddenItemArchiveExportEntryFromBoardData(fullBoardData, item);
  }

  function collectHiddenItemArchiveExportEntriesFromBoardData(boardData, items) {
    var list = Array.isArray(items) ? items : [];
    var exports = [];
    for (var i = 0; i < list.length; i++) {
      var entry = getHiddenItemArchiveExportEntryFromBoardData(boardData, list[i]);
      if (entry) exports.push(entry);
    }
    return exports;
  }

  function collectHiddenItemArchiveExportEntries(items) {
    return collectHiddenItemArchiveExportEntriesFromBoardData(fullBoardData, items);
  }

  async function readArchiveFileText(archiveContext) {
    if (!archiveContext || !archiveContext.boardId || !archiveContext.relativePath) return '';
    try {
      var info = await LexeraApi.fileInfo(archiveContext.boardId, archiveContext.relativePath);
      if (!info || info.exists === false) return '';
      var response = await fetch(LexeraApi.fileUrl(archiveContext.boardId, archiveContext.relativePath));
      if (!response.ok) return '';
      return await response.text();
    } catch (err) {
      logFrontendIssue('warn', 'archive.read', 'Failed to read archive file ' + archiveContext.relativePath, err);
      return '';
    }
  }

  async function openArchiveFileFromHeader() {
    var archiveContext = getArchiveFileContext();
    if (!archiveContext) {
      showNotification('Archive file is only available for local board files');
      return false;
    }
    try {
      var info = await LexeraApi.fileInfo(archiveContext.boardId, archiveContext.relativePath);
      if (!info || info.exists === false) {
        showNotification('Archive file does not exist yet');
        return false;
      }
      openInSystem(archiveContext.absolutePath);
      return true;
    } catch (err) {
      logFrontendIssue('warn', 'archive.open', 'Failed to open archive file ' + archiveContext.relativePath, err);
      showNotification('Failed to open archive file');
      return false;
    }
  }

  async function updateHiddenItemTag(item, tag) {
    if (!item || !fullBoardData || !activeBoardId) return false;
    if (item.kind === 'row') {
      var row = getRowByLocation(item.rowIndex);
      if (!row) return false;
      var nextRowTitle = applyInternalHiddenTag(row.title || '', tag);
      if (nextRowTitle === row.title) return false;
      pushUndo();
      row.title = nextRowTitle;
    } else if (item.kind === 'stack') {
      var stack = getStackByLocation(item.rowIndex, item.stackIndex);
      if (!stack) return false;
      var nextStackTitle = applyInternalHiddenTag(stack.title || '', tag);
      if (nextStackTitle === stack.title) return false;
      pushUndo();
      stack.title = nextStackTitle;
    } else if (item.kind === 'column') {
      var col = getColumnByLocation(item.rowIndex, item.stackIndex, item.colIndex);
      if (!col) return false;
      var nextTitle = applyInternalHiddenTag(col.title || '', tag);
      if (nextTitle === col.title) return false;
      pushUndo();
      col.title = nextTitle;
    } else {
      var card = getCardByLocation(item.rowIndex, item.stackIndex, item.colIndex, item.cardIndex);
      if (!card) return false;
      var nextContent = applyInternalHiddenTag(card.content || '', tag);
      if (nextContent === card.content) return false;
      pushUndo();
      card.content = nextContent;
    }
    return persistBoardMutation({
      refreshMainView: true,
      refreshSidebar: true
    });
  }

  function buildHiddenItemRestoreSource(item) {
    if (!item || !activeBoardId) return null;
    if (item.kind === 'row') {
      return {
        boardId: activeBoardId,
        rowIndex: item.rowIndex,
        indexMode: 'full'
      };
    }
    if (item.kind === 'stack') {
      return {
        boardId: activeBoardId,
        rowIndex: item.rowIndex,
        stackIndex: item.stackIndex,
        indexMode: 'full'
      };
    }
    if (item.kind === 'column') {
      return {
        boardId: activeBoardId,
        rowIndex: item.rowIndex,
        stackIndex: item.stackIndex,
        colIndex: item.colIndex,
        indexMode: 'full'
      };
    }
    if (item.kind === 'card') {
      return {
        boardId: activeBoardId,
        rowIndex: item.rowIndex,
        stackIndex: item.stackIndex,
        colIndex: item.colIndex,
        cardIndex: item.cardIndex,
        cardIndexMode: 'full',
        indexMode: 'full'
      };
    }
    return null;
  }

  function captureStableRowRestoreTarget(target) {
    if (!target || !target.boardId || !isFinite(target.rowIndex)) return null;
    var normalized = {
      kind: target.kind || 'row',
      boardId: target.boardId,
      rowIndex: target.rowIndex,
      before: !!target.before,
      indexMode: target.indexMode || (target.boardId === activeBoardId ? 'display' : 'full')
    };
    if (normalized.boardId === activeBoardId && normalized.indexMode === 'display') {
      var fullRowIndex = findFullDataRowIndex(normalized.rowIndex);
      if (fullRowIndex < 0) return null;
      normalized.rowIndex = fullRowIndex;
      normalized.indexMode = 'full';
    }
    return normalized;
  }

  function captureStableStackRestoreTarget(target) {
    if (!target || !target.boardId) return null;
    if (target.kind === 'row' || target.kind === 'new-row') {
      return captureStableRowRestoreTarget(target);
    }
    if (!isFinite(target.rowIndex) || !isFinite(target.stackIndex)) return null;
    var normalized = {
      kind: target.kind || 'stack',
      boardId: target.boardId,
      rowIndex: target.rowIndex,
      stackIndex: target.stackIndex,
      before: !!target.before,
      indexMode: target.indexMode || (target.boardId === activeBoardId ? 'display' : 'full')
    };
    if (normalized.boardId === activeBoardId && normalized.indexMode === 'display') {
      var fullRowIndex = findFullDataRowIndex(normalized.rowIndex);
      if (fullRowIndex < 0 || !fullBoardData || !fullBoardData.rows || fullRowIndex >= fullBoardData.rows.length) return null;
      var fullRow = fullBoardData.rows[fullRowIndex];
      var fullStackIndex = findFullDataStackIndex(fullRow, target.rowIndex, target.stackIndex);
      if (fullStackIndex < 0) return null;
      normalized.rowIndex = fullRowIndex;
      normalized.stackIndex = fullStackIndex;
      normalized.indexMode = 'full';
    }
    return normalized;
  }

  function captureStableColumnRestoreTarget(target) {
    if (!target || !target.boardId) return null;
    if (target.kind === 'row' || target.kind === 'new-row') {
      return captureStableRowRestoreTarget(target);
    }
    if (target.kind === 'stack') {
      return captureStableStackRestoreTarget(target);
    }
    if (target.kind === 'new-stack') {
      if (!isFinite(target.rowIndex)) return null;
      var normalizedNewStack = {
        kind: 'new-stack',
        boardId: target.boardId,
        rowIndex: target.rowIndex,
        insertAtStackIdx: typeof target.insertAtStackIdx === 'number' ? target.insertAtStackIdx : 0,
        indexMode: target.indexMode || (target.boardId === activeBoardId ? 'display' : 'full')
      };
      if (normalizedNewStack.boardId === activeBoardId && normalizedNewStack.indexMode === 'display') {
        var fullNewStackRowIndex = findFullDataRowIndex(normalizedNewStack.rowIndex);
        if (fullNewStackRowIndex < 0 || !fullBoardData || !fullBoardData.rows || fullNewStackRowIndex >= fullBoardData.rows.length) return null;
        var fullTargetRow = fullBoardData.rows[fullNewStackRowIndex];
        normalizedNewStack.insertAtStackIdx = findInsertStackIndexInRow(
          fullTargetRow,
          target.rowIndex,
          normalizedNewStack.insertAtStackIdx
        );
        normalizedNewStack.rowIndex = fullNewStackRowIndex;
        normalizedNewStack.indexMode = 'full';
      }
      return normalizedNewStack;
    }
    if (
      target.kind === 'column' &&
      isFinite(target.rowIndex) &&
      isFinite(target.stackIndex) &&
      isFinite(target.colIndex)
    ) {
      var normalizedColumn = {
        kind: 'column',
        boardId: target.boardId,
        rowIndex: target.rowIndex,
        stackIndex: target.stackIndex,
        colIndex: target.colIndex,
        before: !!target.before,
        indexMode: target.indexMode || (target.boardId === activeBoardId ? 'display' : 'full')
      };
      if (normalizedColumn.boardId === activeBoardId && normalizedColumn.indexMode === 'display') {
        var columnLoc = resolveColumnLocationForMutation(
          activeBoardId,
          fullBoardData,
          target.rowIndex,
          target.stackIndex,
          target.colIndex,
          'display'
        );
        if (!columnLoc) return null;
        normalizedColumn.rowIndex = columnLoc.rowIndex;
        normalizedColumn.stackIndex = columnLoc.stackIndex;
        normalizedColumn.colIndex = columnLoc.colIndex;
        normalizedColumn.indexMode = 'full';
      }
      return normalizedColumn;
    }
    return null;
  }

  function getCardTargetDisplayPath(target) {
    if (!target) return null;
    if (
      typeof target.rowIndex === 'number' &&
      typeof target.stackIndex === 'number' &&
      typeof target.colIndex === 'number'
    ) {
      return {
        rowIndex: target.rowIndex,
        stackIndex: target.stackIndex,
        colIndex: target.colIndex
      };
    }
    var columnEl = target.container && typeof target.container.closest === 'function'
      ? target.container.closest('.column[data-row-index][data-stack-index][data-col-local-index]')
      : null;
    if (!columnEl) return null;
    var rowIndex = parseInt(columnEl.getAttribute('data-row-index') || '', 10);
    var stackIndex = parseInt(columnEl.getAttribute('data-stack-index') || '', 10);
    var colIndex = parseInt(columnEl.getAttribute('data-col-local-index') || '', 10);
    if (isNaN(rowIndex) || isNaN(stackIndex) || isNaN(colIndex)) return null;
    return {
      rowIndex: rowIndex,
      stackIndex: stackIndex,
      colIndex: colIndex
    };
  }

  function captureStableCardRestoreTarget(target) {
    if (!target || !target.boardId) return null;
    if (target.kind === 'header-incoming' || target.kind === 'header-park' || target.kind === 'header-archive' || target.kind === 'header-trash') {
      return null;
    }
    if (isFinite(target.rowIndex) && isFinite(target.stackIndex) && isFinite(target.colIndex)) {
      var normalizedColumnTarget = {
        kind: target.kind || 'main',
        boardId: target.boardId,
        rowIndex: target.rowIndex,
        stackIndex: target.stackIndex,
        colIndex: target.colIndex,
        insertIdx: typeof target.insertIdx === 'number' ? target.insertIdx : 0,
        insertMode: target.insertMode || 'visible',
        indexMode: target.indexMode || (target.boardId === activeBoardId ? 'display' : 'full')
      };
      if (normalizedColumnTarget.boardId === activeBoardId && normalizedColumnTarget.indexMode === 'display') {
        var targetColumnLoc = resolveColumnLocationForMutation(
          activeBoardId,
          fullBoardData,
          target.rowIndex,
          target.stackIndex,
          target.colIndex,
          'display'
        );
        var targetColumn = targetColumnLoc && targetColumnLoc.stack && targetColumnLoc.stack.columns
          ? targetColumnLoc.stack.columns[targetColumnLoc.colIndex]
          : null;
        if (!targetColumnLoc || !targetColumn) return null;
        normalizedColumnTarget.rowIndex = targetColumnLoc.rowIndex;
        normalizedColumnTarget.stackIndex = targetColumnLoc.stackIndex;
        normalizedColumnTarget.colIndex = targetColumnLoc.colIndex;
        normalizedColumnTarget.insertIdx = resolveInsertCardIndex(
          targetColumn,
          normalizedColumnTarget.insertIdx,
          normalizedColumnTarget.insertMode
        );
        normalizedColumnTarget.insertMode = 'full';
        normalizedColumnTarget.indexMode = 'full';
      }
      return normalizedColumnTarget;
    }
    if (isFinite(target.rowIndex) && isFinite(target.stackIndex)) {
      return captureStableStackRestoreTarget(target);
    }
    if (isFinite(target.rowIndex)) {
      return captureStableRowRestoreTarget(target);
    }
    var displayPath = getCardTargetDisplayPath(target);
    if (!displayPath) return null;
    return captureStableCardRestoreTarget({
      kind: target.kind || 'main',
      boardId: target.boardId,
      rowIndex: displayPath.rowIndex,
      stackIndex: displayPath.stackIndex,
      colIndex: displayPath.colIndex,
      insertIdx: target.insertIdx,
      insertMode: target.insertMode,
      indexMode: target.indexMode
    });
  }

  function captureStableHiddenItemRestoreTarget(kind, mx, my) {
    if (kind === 'row') {
      return captureStableRowRestoreTarget(getRowDropTarget(mx, my));
    }
    if (kind === 'stack') {
      var stackTarget = getStackDropTarget(mx, my);
      if (stackTarget) {
        return captureStableStackRestoreTarget({
          kind: 'stack',
          boardId: stackTarget.boardId,
          rowIndex: stackTarget.rowIndex,
          stackIndex: stackTarget.stackIndex,
          before: stackTarget.before,
          indexMode: stackTarget.indexMode
        });
      }
      var stackRowBodyTarget = resolveRowBodyDropTarget(mx, my);
      if (stackRowBodyTarget) {
        return captureStableStackRestoreTarget({
          kind: 'row',
          boardId: stackRowBodyTarget.boardId,
          rowIndex: stackRowBodyTarget.rowIndex,
          indexMode: stackRowBodyTarget.indexMode
        });
      }
      var stackRowTarget = getRowDropTarget(mx, my);
      if (stackRowTarget) {
        return captureStableStackRestoreTarget({
          kind: 'new-row',
          boardId: stackRowTarget.boardId,
          rowIndex: stackRowTarget.rowIndex,
          before: stackRowTarget.before,
          indexMode: stackRowTarget.indexMode
        });
      }
      return null;
    }
    if (kind === 'column') {
      var zone = findStackDropZoneAt(mx, my);
      if (zone) {
        return captureStableColumnRestoreTarget({
          kind: 'new-stack',
          boardId: activeBoardId,
          rowIndex: parseInt(zone.getAttribute('data-row-index') || '', 10),
          insertAtStackIdx: parseInt(zone.getAttribute('data-insert-index') || '', 10),
          indexMode: 'display'
        });
      }
      var column = findDraggableColumnAt(mx, my);
      if (column) {
        var stackEl = column.closest('.board-stack');
        var stackColumns = stackEl ? stackEl.querySelectorAll('.board-stack-content > .column') : [];
        var columnDisplayIndex = Array.prototype.indexOf.call(stackColumns, column);
        return captureStableColumnRestoreTarget({
          kind: 'column',
          boardId: activeBoardId,
          rowIndex: parseInt(stackEl && stackEl.getAttribute('data-row-index') || '', 10),
          stackIndex: parseInt(stackEl && stackEl.getAttribute('data-stack-index') || '', 10),
          colIndex: columnDisplayIndex,
          before: my < column.getBoundingClientRect().top + column.getBoundingClientRect().height / 2,
          indexMode: 'display'
        });
      }
      var boardStack = findBoardStackAt(mx, my);
      if (boardStack) {
        return captureStableColumnRestoreTarget({
          kind: 'stack',
          boardId: activeBoardId,
          rowIndex: parseInt(boardStack.getAttribute('data-row-index') || '', 10),
          stackIndex: parseInt(boardStack.getAttribute('data-stack-index') || '', 10),
          indexMode: 'display'
        });
      }
      var treeColumnTarget = getTreeColumnDropTarget(mx, my);
      if (treeColumnTarget) {
        return captureStableColumnRestoreTarget({
          kind: 'column',
          boardId: treeColumnTarget.boardId,
          rowIndex: treeColumnTarget.rowIndex,
          stackIndex: treeColumnTarget.stackIndex,
          colIndex: treeColumnTarget.colIndex,
          before: treeColumnTarget.before,
          indexMode: treeColumnTarget.indexMode
        });
      }
      var treeStackTarget = getTreeStackDropTarget(mx, my);
      if (treeStackTarget) {
        return captureStableColumnRestoreTarget({
          kind: 'stack',
          boardId: treeStackTarget.boardId,
          rowIndex: treeStackTarget.rowIndex,
          stackIndex: treeStackTarget.stackIndex,
          indexMode: treeStackTarget.indexMode
        });
      }
      var columnRowBodyTarget = resolveRowBodyDropTarget(mx, my);
      if (columnRowBodyTarget) {
        return captureStableColumnRestoreTarget({
          kind: 'row',
          boardId: columnRowBodyTarget.boardId,
          rowIndex: columnRowBodyTarget.rowIndex,
          indexMode: columnRowBodyTarget.indexMode
        });
      }
      var columnRowTarget = getRowDropTarget(mx, my);
      if (columnRowTarget) {
        return captureStableColumnRestoreTarget({
          kind: 'new-row',
          boardId: columnRowTarget.boardId,
          rowIndex: columnRowTarget.rowIndex,
          before: columnRowTarget.before,
          indexMode: columnRowTarget.indexMode
        });
      }
      return null;
    }
    if (kind === 'card') {
      return captureStableCardRestoreTarget(resolveCardDropTarget(mx, my));
    }
    return null;
  }

  async function restoreHiddenItemToCapturedTarget(item, target) {
    if (!item) return false;
    var source = buildHiddenItemRestoreSource(item);
    if (!source) return false;
    var restored = await updateHiddenItemTag(item, null);
    if (restored === false) return false;
    if (!target) return true;
    if (item.kind === 'row') {
      await moveRowAcrossBoards(source, target);
      return true;
    }
    if (item.kind === 'stack') {
      await moveStackAcrossBoards(source, target);
      return true;
    }
    if (item.kind === 'column') {
      await moveColumnAcrossBoards(source, target);
      return true;
    }
    if (item.kind === 'card') {
      await moveCard(source, target);
      return true;
    }
    return true;
  }

  function removeHiddenItemFromBoardData(boardData, item) {
    return getBoardCleanupApi().removeHiddenItemFromBoardData(boardData, item, getBoardCleanupDeps());
  }

  function removeHiddenItemFromBoard(item) {
    return removeHiddenItemFromBoardData(fullBoardData, item);
  }

  function sortHiddenItemsForRemoval(items) {
    return getBoardCleanupApi().sortHiddenItemsForRemoval(items);
  }

  function removeHiddenItemsFromBoardData(boardData, items) {
    return getBoardCleanupApi().removeHiddenItemsFromBoardData(boardData, items, getBoardCleanupDeps());
  }

  function removeHiddenItemsFromBoard(items) {
    return removeHiddenItemsFromBoardData(fullBoardData, items);
  }

  async function permanentlyDeleteHiddenItem(item) {
    if (!item || !fullBoardData || !activeBoardId) return false;
    traceFrontendAction('info', 'trash.delete', 'Permanently deleting hidden item', {
      boardId: activeBoardId || null,
      kind: item.kind,
      rowIndex: item.rowIndex,
      stackIndex: item.stackIndex,
      colIndex: item.colIndex,
      cardIndex: item.cardIndex,
      title: item.title || ''
    });
    pushUndo();
    if (!removeHiddenItemFromBoard(item)) return false;
    return persistBoardMutation({
      refreshMainView: true,
      refreshSidebar: true
    });
  }

  async function permanentlyDeleteHiddenItems(items) {
    if (!items || items.length === 0 || !fullBoardData || !activeBoardId) return false;
    traceFrontendAction('info', 'trash.empty', 'Permanently deleting all trash items', {
      boardId: activeBoardId || null,
      itemCount: items.length
    });
    pushUndo();
    if (!removeHiddenItemsFromBoard(items)) return false;
    return persistBoardMutation({
      refreshMainView: true,
      refreshSidebar: true
    });
  }

  async function removeArchivedHiddenItemsAfterExport(items) {
    var list = Array.isArray(items) ? items.filter(Boolean) : (items ? [items] : []);
    if (list.length === 0 || !fullBoardData || !activeBoardId) return false;
    pushUndo();
    if (!removeHiddenItemsFromBoard(list)) {
      return false;
    }
    return persistBoardMutation({
      refreshMainView: true,
      refreshSidebar: true
    });
  }

  async function writeArchivedHiddenItemsToArchiveFileForBoard(boardId, boardData, items, options) {
    options = options || {};
    var list = Array.isArray(items) ? items.filter(Boolean) : (items ? [items] : []);
    if (list.length === 0) {
      if (options.notifyFailure !== false) showNotification('No archived items to export');
      return null;
    }

    var archiveContext = getArchiveFileContextForBoard(boardId);
    if (!archiveContext) {
      if (options.notifyFailure !== false) showNotification('Archive export is only available for local board files');
      return null;
    }

    var exportEntries = collectHiddenItemArchiveExportEntriesFromBoardData(boardData, list);
    if (exportEntries.length === 0) {
      if (options.notifyFailure !== false) showNotification('No archived items to export');
      return null;
    }

    traceFrontendAction('info', 'archive.export', 'Exporting archived items to archive file', {
      boardId: archiveContext.boardId,
      itemCount: exportEntries.length,
      archivePath: archiveContext.absolutePath
    });

    try {
      var archivedMarkdown = buildArchiveMarkdownForHiddenItems(exportEntries, { now: new Date() });
      var existingContent = await readArchiveFileText(archiveContext);
      var finalContent = appendArchivedItemsToArchiveContent(existingContent, archivedMarkdown);
      await tauriInvoke('write_export_file', {
        path: archiveContext.absolutePath,
        content: finalContent
      });
      if (options.notifySuccess !== false) {
        showNotification('Exported ' + exportEntries.length + ' archived item(s) to ' + archiveContext.filename);
      }
      return {
        count: exportEntries.length,
        archiveContext: archiveContext
      };
    } catch (err) {
      logFrontendIssue('error', 'archive.export', 'Failed to export archived items to ' + archiveContext.absolutePath, err);
      if (options.notifyFailure !== false) showNotification('Failed to export archived items');
      return null;
    }
  }

  async function exportArchivedHiddenItemsToArchiveFile(items) {
    if (!fullBoardData || !activeBoardId) return false;
    var list = Array.isArray(items) ? items.filter(Boolean) : (items ? [items] : []);
    var exportResult = await writeArchivedHiddenItemsToArchiveFileForBoard(activeBoardId, fullBoardData, list, {
      notifySuccess: false,
      notifyFailure: true
    });
    if (!exportResult) return false;

    var removed = await removeArchivedHiddenItemsAfterExport(list);
    if (!removed) {
      showNotification('Archive file updated, but board cleanup failed');
      return false;
    }
    showNotification('Exported ' + exportResult.count + ' archived item(s) to ' + exportResult.archiveContext.filename);
    return true;
  }

  // ── Hidden Items Dropdown Panel (delegated to HiddenItemsDropdown module) ──
  function closeHeaderSourceDropdown() { if (window.HiddenItemsDropdown) HiddenItemsDropdown.closeHeaderSourceDropdown(); }
  function closeHiddenItemsDropdown() { if (window.HiddenItemsDropdown) HiddenItemsDropdown.closeHiddenItemsDropdown(); }
  function showHiddenItemsDropdown(btnElement, tag, title, emptyMessage, actions, footerActions, kindFilter) {
    if (window.HiddenItemsDropdown) HiddenItemsDropdown.showHiddenItemsDropdown(btnElement, tag, title, emptyMessage, actions, footerActions, kindFilter);
  }
  function showHeaderSourceDropdown(mode, btnElement) {
    if (window.HiddenItemsDropdown) HiddenItemsDropdown.showHeaderSourceDropdown(mode, btnElement);
  }
  function decodeBase64BinaryStringToUint8Array(value) {
    return window.HiddenItemsDropdown ? HiddenItemsDropdown.decodeBase64BinaryStringToUint8Array(value) : new Uint8Array(0);
  }
  function buildPastedEmbedImageFileName(clipboardFilename) {
    return window.HiddenItemsDropdown ? HiddenItemsDropdown.buildPastedEmbedImageFileName(clipboardFilename) : '';
  }
  function getUploadedMediaEmbedTarget(uploadResult) {
    return window.HiddenItemsDropdown ? HiddenItemsDropdown.getUploadedMediaEmbedTarget(uploadResult) : '';
  }

  // --- Main View ---

  function renderMainView() {
    if (workspaceShellEnabled) {
      getElSearchResults().classList.add('hidden');
      getElBoardHeader().classList.add('hidden');
      getElColumnsContainer().classList.add('hidden');
      getElEmptyState().classList.add('hidden');
      refreshHeaderFileControls();
      return;
    }
    if (searchMode && searchResults) {
      renderSearchResults();
      refreshHeaderFileControls();
      return;
    }

    getElSearchResults().classList.add('hidden');

    if (!activeBoardData) {
      refreshHeaderFileControls();
      getElBoardHeader().classList.add('hidden');
      getElColumnsContainer().classList.add('hidden');
      getElEmptyState().classList.remove('hidden');
      getElEmptyState().innerHTML =
        '<div class="empty-state-icon">&#9776;</div>' +
        '<div>' + (connected ? 'Select a board from the sidebar' : 'Waiting for server...') + '</div>';
      return;
    }

    getElEmptyState().classList.add('hidden');
    getElBoardHeader().classList.remove('hidden');
    renderBoardHeader();
    getElColumnsContainer().classList.remove('hidden');
    applyBoardSettings();
    updateDisplayFromFullBoard();
    renderColumns();
    applyBoardTagFilter();
    renderBoardTagFilterBar();
    renderBoardStatsBar();
    refreshHeaderFileControls();
  }

  function renderBoardHeader() {
    var incomingCount = getIncomingCount();
    var parkedCount = getParkedCount();
    var archivedCount = getArchivedCount();
    var deletedCount = getDeletedCount();
    var stickyMode = normalizeStickyHeaderMode(getBoardSettingValue('stickyStackMode', ''));
    var boardFilePath = getActiveBoardFilePath();
    var boardFileName = boardFilePath
      ? getDisplayFileNameFromPath(boardFilePath)
      : ((activeBoardData && activeBoardData.title) ? activeBoardData.title : 'Untitled');
    var hasBoardFile = !!(activeBoardId && boardFilePath);
    var html = '';
    var fileTitle = boardFileName || 'Untitled';
    html += '<div class="board-header-zone board-header-zone-left">';
    html += '<div class="board-header-file-group">';
    html += '<button id="btn-pane-file-title" class="board-header-file-title' + (hasBoardFile ? ' has-board' : '') + '" title="' +
      escapeAttr(hasBoardFile ? boardFilePath : fileTitle) + '">' + escapeHtml(fileTitle) + '</button>';
    html += '<button class="burger-menu-btn board-menu-btn" id="btn-file-header-menu" title="File header settings">' + BURGER_MENU_ICON_HTML + '</button>';
    html += '</div>';
    html += '</div>';

    html += '<div class="board-header-zone board-header-zone-middle">';
    html += '<div class="board-header-actions board-header-actions-middle">';
    html += '<button class="board-action-btn" id="btn-create-new" title="Create new row, stack, column or card">New</button>';
    html += '<span class="board-header-separator" aria-hidden="true"></span>';
    html += '<button class="board-action-btn header-drop-target' + (incomingCount > 0 ? ' has-items' : '') + '" id="btn-incoming" title="Incoming — drop cards here to mark as incoming">Incoming' + (incomingCount > 0 ? ' (' + incomingCount + ')' : '') + '</button>';
    html += '<button class="board-action-btn header-drop-target' + (parkedCount > 0 ? ' has-items' : '') + '" id="btn-parked" title="Show parked items — drop cards here to park">Park' + (parkedCount > 0 ? ' (' + parkedCount + ')' : '') + '</button>';
    html += '<span class="board-header-separator" aria-hidden="true"></span>';
    html += '<button class="board-action-btn header-drop-target' + (archivedCount > 0 ? ' has-items' : '') + '" id="btn-archived" title="Show archived items — drop cards here to archive">Archive' + (archivedCount > 0 ? ' (' + archivedCount + ')' : '') + '</button>';
    html += '<button class="board-action-btn header-drop-target danger' + (deletedCount > 0 ? ' has-items' : '') + '" id="btn-trash" title="Show deleted items — drop cards here to delete">Trash' + (deletedCount > 0 ? ' (' + deletedCount + ')' : '') + '</button>';
    html += '</div>';
    html += '</div>';

    html += '<div class="board-header-zone board-header-zone-right">';
    html += '<div class="board-header-actions board-header-actions-right">';
    html += '<button class="board-action-btn' + (stickyMode ? ' has-items' : '') + '" id="btn-pin-column-headers" title="Pin or unpin column headers">Pin Headers</button>';
    // Undo/redo: keyboard only (Cmd/Ctrl+Z/Y), stats & processes: bottom bar tabs
    html += '<button class="board-action-btn" id="btn-save-tracking" title="Save now and inspect change tracking">Changes</button>';
    html += '<button class="board-action-btn" id="btn-theme-zoom" title="Visual style and zoom controls">Themes / Zoom</button>';
    html += '<button class="board-action-btn" id="btn-export" title="Export or pack board">Export / Pack</button>';
    html += '<button class="burger-menu-btn board-menu-btn" id="btn-board-menu" title="Extended board settings">' + BURGER_MENU_ICON_HTML + '</button>';
    html += '</div>';
    html += '</div>';
    getElBoardHeader().innerHTML = html;
    applyTagStyleToEntity(getElBoardHeader(), activeBoardData && activeBoardData.title ? activeBoardData.title : '');
    loadTemplatesOnce();

    // Refresh board-header-lifetime cached refs
    $foldAllBtn = null;
    $foldAllCardsBtn = null;
    $pinHeadersBtn = document.getElementById('btn-pin-column-headers');
    $saveTrackingBtn = document.getElementById('btn-save-tracking');
    var paneFileTitleBtn = document.getElementById('btn-pane-file-title');
    var fileHeaderMenuBtn = document.getElementById('btn-file-header-menu');
    if (paneFileTitleBtn) {
      paneFileTitleBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (embeddedMode) notifyParentPaneActivated();
      });
      paneFileTitleBtn.addEventListener('dblclick', function (e) {
        if (!hasBoardFile) return;
        e.preventDefault();
        e.stopPropagation();
        renameActiveBoardFile();
      });
      paneFileTitleBtn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showFileHeaderSettingsMenu(paneFileTitleBtn, e.clientX, e.clientY);
      });
    }
    if (fileHeaderMenuBtn) {
      var _fileMenuOpen = false;
      fileHeaderMenuBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (_fileMenuOpen) return;
        _fileMenuOpen = true;
        showFileHeaderSettingsMenu(fileHeaderMenuBtn).finally(function () {
          _fileMenuOpen = false;
        });
      });
    }

    if ($pinHeadersBtn) {
      $pinHeadersBtn.addEventListener('click', function () {
        togglePinnedHeaders();
      });
    }
    // undo/redo and stats buttons removed from header (keyboard / bottom bar)
    if ($saveTrackingBtn) {
      $saveTrackingBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!activeBoardId || !fullBoardData) return;
        if (isBoardDirty()) {
          handleBoardAction('save-now');
          return;
        }
        showSaveTrackingMenu($saveTrackingBtn);
      });
      $saveTrackingBtn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showSaveTrackingMenu($saveTrackingBtn, e.clientX, e.clientY);
      });
    }
    // processes button removed from header (bottom bar tab)
    var themeZoomBtn = document.getElementById('btn-theme-zoom');
    if (themeZoomBtn) {
      themeZoomBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showThemeZoomMenu(themeZoomBtn);
      });
    }
    var createNewBtn = document.getElementById('btn-create-new');
    if (createNewBtn) {
      createNewBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showHeaderSourceDropdown('new', createNewBtn);
      });
    }
    var incomingBtn = document.getElementById('btn-incoming');
    if (incomingBtn) {
      incomingBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showIncomingItems(incomingBtn);
      });
    }
    var exportBtn = document.getElementById('btn-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', async function () {
        await triggerBoardExport();
      });
    }
    var parkedBtn = document.getElementById('btn-parked');
    if (parkedBtn) {
      parkedBtn.addEventListener('click', function () {
        showParkedItems(parkedBtn);
      });
    }
    var archivedBtn = document.getElementById('btn-archived');
    if (archivedBtn) {
      archivedBtn.addEventListener('click', function () {
        showArchivedItems(archivedBtn);
      });
    }
    var trashBtn = document.getElementById('btn-trash');
    if (trashBtn) {
      trashBtn.addEventListener('click', function () {
        showDeletedItems(trashBtn);
      });
    }
    var boardMenuBtn = document.getElementById('btn-board-menu');
    if (boardMenuBtn) {
      boardMenuBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var rect = boardMenuBtn.getBoundingClientRect();
        showBoardContextMenu(rect.right, rect.bottom);
      });
    }
    getElBoardHeader().oncontextmenu = function (e) {
      e.preventDefault();
      e.stopPropagation();
      showBoardContextMenu(e.clientX, e.clientY);
    };
    if (!_boardHeaderResizeBound) {
      _boardHeaderResizeBound = true;
      window.addEventListener('resize', refreshBoardHeaderActionStates);
    }
    refreshBoardHeaderActionStates();
  }

  function getParkedCount() {
    return getHiddenItemCount('#hidden-internal-parked');
  }

  function getArchivedCount() {
    return getHiddenItemCount('#hidden-internal-archived');
  }

  function getDeletedCount() {
    return getHiddenItemCount('#hidden-internal-deleted');
  }

  function getIncomingCount() {
    return collectHiddenItems('#hidden-internal-incoming').filter(function (it) { return it.kind === 'card'; }).length;
  }

  function getIncomingCaptureCount() {
    return incomingCaptureCache && Array.isArray(incomingCaptureCache.items)
      ? incomingCaptureCache.items.length
      : 0;
  }

  function normalizeIncomingCaptureEntry(rawEntry) {
    if (!rawEntry || typeof rawEntry !== 'object') return null;
    var text = typeof rawEntry.text === 'string' ? rawEntry.text : '';
    var imageData = typeof rawEntry.image_data === 'string' ? rawEntry.image_data : '';
    var imageFilename = typeof rawEntry.image_filename === 'string' ? rawEntry.image_filename : '';
    if (!text && !imageData) return null;
    return {
      id: rawEntry.id,
      text: text,
      imageData: imageData,
      imageFilename: imageFilename,
      timestamp: typeof rawEntry.timestamp === 'number' ? rawEntry.timestamp : 0
    };
  }

  function summarizeIncomingCaptureEntry(entry) {
    if (!entry) return '(empty)';
    if (entry.imageData) {
      return entry.imageFilename ? ('Image: ' + entry.imageFilename) : 'Image capture';
    }
    var text = String(entry.text || '').replace(/\s+/g, ' ').trim();
    if (!text) return '(empty)';
    if (text.length > 80) return text.slice(0, 77) + '...';
    return text;
  }

  function formatIncomingCaptureTimestamp(timestamp) {
    if (!timestamp || !isFinite(timestamp)) return '';
    var dt = new Date(timestamp);
    if (!isFinite(dt.getTime())) return '';
    return dt.toLocaleString();
  }

  async function refreshIncomingCaptureCache(force) {
    force = !!force;
    var maxAgeMs = 5000;
    if (!force && incomingCaptureCache.pending) return incomingCaptureCache.pending;
    if (!force && incomingCaptureCache.loadedAt > 0 && (Date.now() - incomingCaptureCache.loadedAt) < maxAgeMs) {
      return incomingCaptureCache.items.slice();
    }
    incomingCaptureCache.pending = LexeraApi.getCaptureHistory().then(function (entries) {
      incomingCaptureCache.items = Array.isArray(entries)
        ? entries.map(normalizeIncomingCaptureEntry).filter(Boolean)
        : [];
      incomingCaptureCache.loadedAt = Date.now();
      incomingCaptureCache.available = true;
      incomingCaptureCache.pending = null;
      return incomingCaptureCache.items.slice();
    }).catch(function (err) {
      incomingCaptureCache.items = [];
      incomingCaptureCache.loadedAt = Date.now();
      incomingCaptureCache.available = false;
      incomingCaptureCache.pending = null;
      logFrontendIssue('warn', 'header.incoming.history', 'Failed to refresh incoming capture history', err);
      return [];
    });
    return incomingCaptureCache.pending;
  }

  function getCreationEntityLabel(entityType) {
    var value = String(entityType || '').trim().toLowerCase();
    if (value === 'board') return 'Board';
    if (value === 'row') return 'Row';
    if (value === 'stack') return 'Stack';
    if (value === 'column') return 'Column';
    return 'Card';
  }

  function getCreationEntityDragIconSvg(entityType) {
    var value = String(entityType || '').trim().toLowerCase();
    if (value === 'board') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1"></rect><rect x="6" y="6" width="5" height="5" rx="1"></rect><rect x="13" y="6" width="5" height="5" rx="1"></rect><rect x="6" y="13" width="12" height="5" rx="1"></rect></svg>';
    }
    if (value === 'row') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="6" rx="1"></rect><rect x="3" y="13" width="18" height="8" rx="1"></rect></svg>';
    }
    if (value === 'stack') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="4" height="18" rx="1"></rect><rect x="10" y="3" width="4" height="18" rx="1"></rect><rect x="17" y="3" width="4" height="18" rx="1"></rect></svg>';
    }
    if (value === 'column') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="13" height="11" rx="2" stroke-dasharray="4 2"></rect><rect x="9" y="9" width="13" height="11" rx="2"></rect></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="8" y1="9" x2="16" y2="9"></line><line x1="8" y1="13" x2="13" y2="13"></line></svg>';
  }

  function buildCreationEntityDragIconHtml(entityType, extraAttrs) {
    var value = String(entityType || '').trim().toLowerCase();
    if (value !== 'board' && value !== 'row' && value !== 'stack' && value !== 'column' && value !== 'card') value = 'card';
    var attrs = Array.isArray(extraAttrs) ? extraAttrs.join(' ') : '';
    if (attrs) attrs = ' ' + attrs;
    return '<span class="drag-grip entity-drag-icon entity-drag-icon-' + value + '"' + attrs + '>' +
      getCreationEntityDragIconSvg(value) +
      '</span>';
  }

  function formatMenuToggleLabel(enabled, label) {
    return (enabled ? '\u2713 ' : '') + label;
  }

  function buildModeMenuItems(currentValue, actionPrefix, options) {
    var items = [];
    for (var i = 0; i < options.length; i++) {
      var option = options[i];
      if (option && option.separator) { items.push({ separator: true }); continue; }
      items.push({
        id: actionPrefix + ':' + option.value,
        label: (currentValue === option.value ? '\u2713 ' : '') + option.label
      });
    }
    return items;
  }

  function buildSettingMenuItems(settingId) {
    var desc = BoardSettingRegistry.get(settingId);
    if (!desc) return [];
    var current;
    if (desc.getCurrentValue) {
      current = desc.getCurrentValue();
    } else {
      var raw = getBoardSettingValue(desc.settingsKey, desc.defaultValue);
      current = desc.normalize ? desc.normalize(raw) : String(raw || desc.defaultValue);
    }
    return BoardSettingRegistry.buildMenuItems(settingId, current);
  }

  function buildLayoutPresetMenuItems() {
    var current = getBoardSettingValue('layoutPreset', 'normal') || 'normal';
    var items = [
      { id: 'set-layout-preset:normal', label: (current === 'normal' ? '\u2713 ' : '') + 'Normal' },
      { id: 'set-layout-preset:spacious', label: (current === 'spacious' ? '\u2713 ' : '') + 'Spacious' }
    ];
    var presets = typeof getSavedLayoutPresets === 'function' ? getSavedLayoutPresets() : {};
    var presetNames = Object.keys(presets);
    if (presetNames.length > 0) {
      items.push({ separator: true });
      for (var i = 0; i < presetNames.length; i++) {
        var name = presetNames[i];
        items.push({ id: 'set-layout-preset:' + name, label: (current === name ? '\u2713 ' : '') + name });
      }
    }
    items.push({ separator: true });
    items.push({ id: 'save-layout-preset', label: 'Save Current as Preset\u2026' });
    if (presetNames.length > 0) {
      var deleteItems = [];
      for (var j = 0; j < presetNames.length; j++) {
        deleteItems.push({ id: 'delete-layout-preset:' + presetNames[j], label: presetNames[j] });
      }
      items.push({ id: 'delete-layout-preset', label: 'Delete Preset', items: deleteItems });
    }
    return items;
  }

  function buildTagStyleRoleItems(normalizedTag) {
    var TAG_STYLE_ROLES = [
      { value: 'header', label: 'Header Bar' },
      { value: 'footer', label: 'Footer Bar' },
      { value: 'badge', label: 'Badge' },
      { value: 'border-only', label: 'Border Only' },
      { value: 'background', label: 'Background' },
      { value: 'effect', label: 'Effect' },
      { value: '', label: 'None' }
    ];
    var rawTag = normalizedTag.charAt(0) === '#' ? normalizedTag.substring(1) : normalizedTag;
    var categoryKey = getTagCategoryKey(rawTag);
    var currentRole = categoryKey ? getResolvedCategoryRole(categoryKey) : '';
    var items = [];
    for (var i = 0; i < TAG_STYLE_ROLES.length; i++) {
      var r = TAG_STYLE_ROLES[i];
      items.push({
        id: 'tag-style-role:' + r.value,
        label: (currentRole === r.value ? '\u2713 ' : '') + r.label
      });
    }
    if (categoryKey) {
      items.push({ separator: true });
      items.push({ id: 'tag-style-role-info', label: 'Category: ' + categoryKey, disabled: true });
    }
    return items;
  }


  function normalizeBoardFontSizeValue(rawValue) {
    var source = String(rawValue || '').trim().toLowerCase();
    if (!source || source === 'normal' || source === '1x') return '13px';
    if (source === 'small' || source === '0.75x') return '9.75px';
    if (source === 'large' || source === '1.25x') return '16.25px';
    if (source === '0.5x') return '6.5px';
    if (source === '1.5x') return '19.5px';
    if (source === '2x') return '26px';
    if (/^\d+(?:\.\d+)?px$/.test(source)) return source;
    var numeric = parseFloat(source);
    if (isFinite(numeric) && numeric > 0) return numeric + 'px';
    return '13px';
  }


  function normalizeBoardFontFamilyToken(rawValue) {
    var source = String(rawValue || '').trim().toLowerCase();
    if (!source || source === 'system') return 'system';
    if (source.indexOf('plus jakarta') !== -1 || source.indexOf('plusjakarta') !== -1) return 'plusjakarta';
    if (source.indexOf('open sans') !== -1 || source.indexOf('opensans') !== -1) return 'opensans';
    if (source.indexOf('new roman') !== -1 || source.indexOf('times') !== -1) return 'times';
    if (source.indexOf('fira code') !== -1 || source.indexOf('firacode') !== -1) return 'firacode';
    if (source.indexOf('jetbrains') !== -1) return 'jetbrains';
    if (source.indexOf('source code') !== -1 || source.indexOf('sourcecodepro') !== -1) return 'sourcecodepro';
    if (source.indexOf('helvetica') !== -1) return 'helvetica';
    if (source.indexOf('arial') !== -1) return 'arial';
    if (source.indexOf('georgia') !== -1) return 'georgia';
    if (source.indexOf('consolas') !== -1) return 'consolas';
    if (source.indexOf('inter') !== -1) return 'inter';
    if (source.indexOf('roboto') !== -1) return 'roboto';
    if (source.indexOf('lato') !== -1) return 'lato';
    if (source.indexOf('poppins') !== -1) return 'poppins';
    return 'system';
  }

  function resolveBoardFontFamilyValue(token) {
    if (!token || token === 'system') return null;
    if (token === 'roboto') return "'Roboto', sans-serif";
    if (token === 'opensans') return "'Open Sans', sans-serif";
    if (token === 'lato') return "'Lato', sans-serif";
    if (token === 'plusjakarta') return "'Plus Jakarta Sans', sans-serif";
    if (token === 'inter') return "'Inter', sans-serif";
    if (token === 'poppins') return "'Poppins', sans-serif";
    if (token === 'helvetica') return "'Helvetica Neue', Helvetica, Arial, sans-serif";
    if (token === 'arial') return "Arial, sans-serif";
    if (token === 'georgia') return "Georgia, serif";
    if (token === 'times') return "'Times New Roman', serif";
    if (token === 'firacode') return "'Fira Code', monospace";
    if (token === 'jetbrains') return "'JetBrains Mono', monospace";
    if (token === 'sourcecodepro') return "'Source Code Pro', monospace";
    if (token === 'consolas') return "Consolas, monospace";
    return null;
  }


  function normalizeWhitespaceValue(rawValue) {
    var source = String(rawValue || '').trim().toLowerCase();
    if (!source) return '';
    if (source === 'compact') return '8px';
    if (source === 'default' || source === 'normal') return '16px';
    if (source === 'spacious') return '32px';
    var match = source.match(/^(\d+(?:\.\d+)?)px$/);
    if (!match) return '';
    var px = parseFloat(match[1]);
    if (!isFinite(px) || px <= 0) return '';
    if (px <= 12) return '8px';
    if (px >= 24) return '32px';
    return '16px';
  }


  // ── Export tool status delegates (logic moved to ExportToolStatus module) ──

  function getExportToolStatus() { return window.ExportToolStatus; }

  function normalizeExportDialogFormat(value) { return getExportToolStatus().normalizeExportDialogFormat(value); }
  function normalizePandocExportFormat(value) { return getExportToolStatus().normalizePandocExportFormat(value); }
  function normalizeDocumentPageBreakPreference(value) { return getExportToolStatus().normalizeDocumentPageBreakPreference(value); }

  function getStoredExportDefault(key, fallback) { return getExportToolStatus().getStoredExportDefault(key, fallback); }
  function setStoredExportDefault(key, value) { getExportToolStatus().setStoredExportDefault(key, value); }

  function formatEmbeddedRendererStatusItem(status) { return getExportToolStatus().formatEmbeddedRendererStatusItem(status); }

  function refreshEmbeddedRendererStatuses(force) { return getExportToolStatus().refreshEmbeddedRendererStatuses(force); }
  function refreshExportToolStatus(toolName, force) { return getExportToolStatus().refreshExportToolStatus(toolName, force); }

  function buildEmbeddedRendererStatusMenuItems() { return getExportToolStatus().buildEmbeddedRendererStatusMenuItems(); }
  function buildFileHeaderPandocMenuItems() { return getExportToolStatus().buildFileHeaderPandocMenuItems(); }

  function getExportToolStatusCache() { return getExportToolStatus().getToolStatusCache(); }

  async function handleBoardPandocMenuAction(action) {
    return getExportToolStatus().handleBoardPandocMenuAction(action, triggerBoardExport);
  }

  async function handleEmbeddedRendererMenuAction(action) {
    return getExportToolStatus().handleEmbeddedRendererMenuAction(action);
  }

  async function triggerBoardExport(initialOptions) {
    if (!window.ExportUI) return;
    if (!window._exportUI) window._exportUI = new ExportUI();
    await window._exportUI.init(activeBoardId, fullBoardData, initialOptions || null);
    window._exportUI.show();
  }

  function triggerAutoExportAfterBoardSave(boardId) {
    if (!boardId || !window.ExportUI || typeof window.ExportUI.handleBoardSaved !== 'function') return;
    window.ExportUI.handleBoardSaved(boardId).catch(function (err) {
      logFrontendIssue('warn', 'export.auto', 'Auto-export after save failed', err);
    });
  }

  function openRunningProcessesPanel() {
    setActiveLogSource('backend');
    var panel = getElLogPanel();
    if (panel) panel.classList.remove('hidden');
    updateAppBottomInset();
  }

  function formatSaveTrackingTimestamp(ts) {
    if (!ts || !isFinite(ts)) return 'Never';
    var dt = new Date(ts);
    if (!isFinite(dt.getTime())) return 'Never';
    return dt.toLocaleString();
  }

  function createChangeCounter() {
    return { added: 0, removed: 0, modified: 0, reordered: 0 };
  }

  function hasChangeCounterValues(counter) {
    return !!counter && (counter.added > 0 || counter.removed > 0 || counter.modified > 0 || counter.reordered > 0);
  }

  function formatChangeCounter(counter) {
    if (!counter) return '0';
    var parts = [];
    if (counter.added > 0) parts.push('+' + counter.added);
    if (counter.removed > 0) parts.push('-' + counter.removed);
    if (counter.modified > 0) parts.push('~' + counter.modified);
    if (counter.reordered > 0) parts.push('\u21C5' + counter.reordered);
    if (parts.length === 0) return '0';
    return parts.join(' ');
  }

  function countObjectEntries(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    return Object.keys(obj).length;
  }

  function createBoardChangeStats() {
    return {
      boardFields: 0,
      settings: 0,
      row: createChangeCounter(),
      stack: createChangeCounter(),
      column: createChangeCounter(),
      card: createChangeCounter()
    };
  }

  function applyColumnSnapshotCounts(column, stats, mode) {
    if (!column || !stats || !mode) return;
    var cards = Array.isArray(column.cards) ? column.cards : [];
    stats.card[mode] += cards.length;
  }

  function applyStackSnapshotCounts(stack, stats, mode) {
    if (!stack || !stats || !mode) return;
    var cols = Array.isArray(stack.columns) ? stack.columns : [];
    stats.column[mode] += cols.length;
    for (var c = 0; c < cols.length; c++) {
      applyColumnSnapshotCounts(cols[c], stats, mode);
    }
  }

  function applyRowSnapshotCounts(row, stats, mode) {
    if (!row || !stats || !mode) return;
    var stacks = Array.isArray(row.stacks) ? row.stacks : [];
    stats.stack[mode] += stacks.length;
    for (var s = 0; s < stacks.length; s++) {
      applyStackSnapshotCounts(stacks[s], stats, mode);
    }
  }

  function applyCardArrayDeltaStats(arrayDelta, stats) {
    if (!arrayDelta || !stats) return;
    stats.card.added += countObjectEntries(arrayDelta.added);
    stats.card.removed += countObjectEntries(arrayDelta.removed);
    stats.card.modified += countObjectEntries(arrayDelta.modified);
    if (arrayDelta.oldOrder && arrayDelta.newOrder) stats.card.reordered += 1;
  }

  function applyColumnArrayDeltaStats(arrayDelta, stats) {
    if (!arrayDelta || !stats) return;
    var colId;
    if (arrayDelta.added) {
      for (colId in arrayDelta.added) {
        if (!Object.prototype.hasOwnProperty.call(arrayDelta.added, colId)) continue;
        stats.column.added += 1;
        applyColumnSnapshotCounts(arrayDelta.added[colId], stats, 'added');
      }
    }
    if (arrayDelta.removed) {
      for (colId in arrayDelta.removed) {
        if (!Object.prototype.hasOwnProperty.call(arrayDelta.removed, colId)) continue;
        stats.column.removed += 1;
        applyColumnSnapshotCounts(arrayDelta.removed[colId], stats, 'removed');
      }
    }
    if (arrayDelta.modified) {
      for (colId in arrayDelta.modified) {
        if (!Object.prototype.hasOwnProperty.call(arrayDelta.modified, colId)) continue;
        stats.column.modified += 1;
        var colDelta = arrayDelta.modified[colId];
        if (colDelta && colDelta.cards) applyCardArrayDeltaStats(colDelta.cards, stats);
      }
    }
    if (arrayDelta.oldOrder && arrayDelta.newOrder) stats.column.reordered += 1;
  }

  function applyStackArrayDeltaStats(arrayDelta, stats) {
    if (!arrayDelta || !stats) return;
    var stackId;
    if (arrayDelta.added) {
      for (stackId in arrayDelta.added) {
        if (!Object.prototype.hasOwnProperty.call(arrayDelta.added, stackId)) continue;
        stats.stack.added += 1;
        applyStackSnapshotCounts(arrayDelta.added[stackId], stats, 'added');
      }
    }
    if (arrayDelta.removed) {
      for (stackId in arrayDelta.removed) {
        if (!Object.prototype.hasOwnProperty.call(arrayDelta.removed, stackId)) continue;
        stats.stack.removed += 1;
        applyStackSnapshotCounts(arrayDelta.removed[stackId], stats, 'removed');
      }
    }
    if (arrayDelta.modified) {
      for (stackId in arrayDelta.modified) {
        if (!Object.prototype.hasOwnProperty.call(arrayDelta.modified, stackId)) continue;
        stats.stack.modified += 1;
        var stackDelta = arrayDelta.modified[stackId];
        if (stackDelta && stackDelta.columns) applyColumnArrayDeltaStats(stackDelta.columns, stats);
      }
    }
    if (arrayDelta.oldOrder && arrayDelta.newOrder) stats.stack.reordered += 1;
  }

  function applyRowArrayDeltaStats(arrayDelta, stats) {
    if (!arrayDelta || !stats) return;
    var rowId;
    if (arrayDelta.added) {
      for (rowId in arrayDelta.added) {
        if (!Object.prototype.hasOwnProperty.call(arrayDelta.added, rowId)) continue;
        stats.row.added += 1;
        applyRowSnapshotCounts(arrayDelta.added[rowId], stats, 'added');
      }
    }
    if (arrayDelta.removed) {
      for (rowId in arrayDelta.removed) {
        if (!Object.prototype.hasOwnProperty.call(arrayDelta.removed, rowId)) continue;
        stats.row.removed += 1;
        applyRowSnapshotCounts(arrayDelta.removed[rowId], stats, 'removed');
      }
    }
    if (arrayDelta.modified) {
      for (rowId in arrayDelta.modified) {
        if (!Object.prototype.hasOwnProperty.call(arrayDelta.modified, rowId)) continue;
        stats.row.modified += 1;
        var rowDelta = arrayDelta.modified[rowId];
        if (rowDelta && rowDelta.stacks) applyStackArrayDeltaStats(rowDelta.stacks, stats);
      }
    }
    if (arrayDelta.oldOrder && arrayDelta.newOrder) stats.row.reordered += 1;
  }

  function countBoardScalarDeltaFields(delta) {
    if (!delta || typeof delta !== 'object') return 0;
    var fields = ['valid', 'title', 'yamlHeader', 'kanbanFooter'];
    var count = 0;
    for (var i = 0; i < fields.length; i++) {
      if (Object.prototype.hasOwnProperty.call(delta, fields[i])) count++;
    }
    return count;
  }

  function countFlatObjectDeltaFields(diff) {
    if (!diff || typeof diff !== 'object') return 0;
    if (diff.__replaced) return 1;
    return Object.keys(diff).length;
  }

  function collectBoardChangeStatsFromDelta(delta) {
    var stats = createBoardChangeStats();
    if (!delta || typeof delta !== 'object') return stats;
    stats.boardFields = countBoardScalarDeltaFields(delta);
    stats.settings = countFlatObjectDeltaFields(delta.boardSettings);
    if (delta.rows) applyRowArrayDeltaStats(delta.rows, stats);
    if (delta.columns) applyColumnArrayDeltaStats(delta.columns, stats);
    return stats;
  }

  function buildChangeSummaryLabel(stats, dirty) {
    if (!dirty) return 'Changes: none';
    var parts = [];
    if (stats.boardFields > 0) parts.push('board ' + stats.boardFields);
    if (stats.settings > 0) parts.push('settings ' + stats.settings);
    if (hasChangeCounterValues(stats.row)) parts.push('rows ' + formatChangeCounter(stats.row));
    if (hasChangeCounterValues(stats.stack)) parts.push('stacks ' + formatChangeCounter(stats.stack));
    if (hasChangeCounterValues(stats.column)) parts.push('columns ' + formatChangeCounter(stats.column));
    if (hasChangeCounterValues(stats.card)) parts.push('cards ' + formatChangeCounter(stats.card));
    if (parts.length === 0) return 'Changes: local edits pending';
    return 'Changes: ' + parts.join(' | ');
  }

  function showSaveTrackingMenu(btnElement, forcedX, forcedY) {
    if (!btnElement) return;
    var dirty = isBoardDirty();
    var revision = _lastLoadedRevision || (activeBoardData && activeBoardData.revision) || '';
    var statusLabel = _headerSavingInProgress
      ? 'Saving in progress'
      : (dirty ? 'Unsaved local changes' : 'All changes saved');
    var baseBoard = (dirty && fullBoardData)
      ? (getBoardSaveBase(fullBoardData) || fullBoardData)
      : null;
    var delta = (dirty && baseBoard && fullBoardData)
      ? computeBoardDelta(baseBoard, fullBoardData)
      : null;
    var changeStats = collectBoardChangeStatsFromDelta(delta);
    var changeSummaryLabel = buildChangeSummaryLabel(changeStats, dirty);
    var historyUndoDepth = undoStack.length + (undoPendingSnapshot ? 1 : 0);
    var historyRedoDepth = redoStack.length;
    var saveFlowLabel = _saveInFlight
      ? 'Save flow: in-flight'
      : (_savePending ? 'Save flow: queued' : 'Save flow: idle');
    var autoSaveLabel = _autoSaveTimer ? 'Auto-save: scheduled' : 'Auto-save: idle';
    var conflictCount = (pendingExternalRebaseConflict && pendingExternalRebaseConflict.result)
      ? (pendingExternalRebaseConflict.result.conflicts || 0)
      : 0;
    var conflictLabel = conflictCount > 0
      ? ('Conflicts pending: ' + conflictCount)
      : 'Conflicts pending: none';
    var items = [
      {
        id: 'save-now',
        label: _headerSavingInProgress ? 'Saving...' : (dirty ? 'Save Now' : 'Save Now (no pending changes)'),
        disabled: _headerSavingInProgress || !dirty
      },
      { id: 'open-running-processes', label: 'Open Running Processes' },
      { separator: true },
      { id: 'save-status-info', label: 'Status: ' + statusLabel, disabled: true },
      { id: 'save-changes-info', label: changeSummaryLabel, disabled: true },
      { id: 'save-last-info', label: 'Last save: ' + formatSaveTrackingTimestamp(lastSaveTime), disabled: true },
      { id: 'save-revision-info', label: 'Revision: ' + (revision || 'n/a'), disabled: true },
      { id: 'save-history-info', label: 'History: undo ' + historyUndoDepth + ' / redo ' + historyRedoDepth, disabled: true },
      { id: 'save-flow-info', label: saveFlowLabel, disabled: true },
      { id: 'save-autosave-info', label: autoSaveLabel, disabled: true },
      { id: 'save-conflicts-info', label: conflictLabel, disabled: true }
    ];
    var x = forcedX;
    var y = forcedY;
    if (typeof x !== 'number' || typeof y !== 'number') {
      var rect = btnElement.getBoundingClientRect();
      x = rect.right;
      y = rect.bottom;
    }
    showNativeMenu(items, x, y, 'header.save').then(function (action) {
      if (!action) return;
      if (action === 'save-now') handleBoardAction('save-now');
      if (action === 'open-running-processes') openRunningProcessesPanel();
    });
  }

  function showThemeZoomMenu(btnElement) {
    if (!btnElement) return;
    var rect = btnElement.getBoundingClientRect();
    var zoomLevels = [0.8, 0.9, 1, 1.1, 1.25];
    var items = buildSettingMenuItems('visualTheme');
    items.push({ separator: true });
    items.push({ id: 'sidebar-hierarchy-display', label: 'Sidebar Hierarchy', items: buildSidebarHierarchyDisplayMenuItems() });
    items.push({ separator: true });
    var zoomItems = zoomLevels.map(function (scale) {
      var percent = Math.round(scale * 100);
      return { id: 'ui-scale:' + scale, label: ($uiScale === scale ? '\u2713 ' : '') + 'Zoom ' + percent + '%' };
    });
    items = items.concat(zoomItems);
    items.push({ separator: true });
    items.push({ id: 'zoom-in', label: 'Zoom In (+)' });
    items.push({ id: 'zoom-out', label: 'Zoom Out (-)' });
    items.push({ id: 'zoom-reset', label: 'Reset Zoom (100%)' });
    showNativeMenu(items, rect.right, rect.bottom, 'header.themeZoom').then(function (action) {
      if (!action) return;
      if (action.indexOf('set-visual-theme:') === 0) {
        handleBoardAction(action);
        return;
      }
      if (action.indexOf('ui-scale:') === 0) {
        var nextScale = parseFloat(action.substring('ui-scale:'.length));
        if (isFinite(nextScale)) {
          applyUiScale(nextScale);
          showNotification('Zoom ' + getUiScalePercentLabel());
        }
        return;
      }
      if (action === 'zoom-in') { nudgeUiScale(getUiZoomStep(0.05)); return; }
      if (action === 'zoom-out') { nudgeUiScale(getUiZoomStep(-0.05)); return; }
      if (action === 'zoom-reset') {
        applyUiScale(1);
        showNotification('Zoom 100%');
      }
    });
  }

  async function buildIncomingClipboardSummaryLabel() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      return 'Clipboard source unavailable in this environment';
    }
    try {
      var text = await navigator.clipboard.readText();
      var normalized = String(text || '').replace(/\s+/g, ' ').trim();
      if (!normalized) return 'Clipboard is empty';
      if (normalized.length > 80) normalized = normalized.slice(0, 77) + '...';
      return 'Clipboard: ' + normalized;
    } catch (err) {
      logFrontendIssue('warn', 'header.incoming.clipboard', 'Failed to read clipboard preview for incoming menu', err);
      return 'Clipboard preview not available';
    }
  }

  function showIncomingQueueMenu(btnElement) {
    if (!btnElement) return;
    var rect = btnElement.getBoundingClientRect();
    buildIncomingClipboardSummaryLabel().then(function (summaryLabel) {
      var clipboardReady = summaryLabel.indexOf('Clipboard: ') === 0;
      var items = [
        { id: 'incoming-summary', label: summaryLabel, disabled: true },
        { separator: true },
        { id: 'incoming-create-card', label: 'Create Card From Clipboard', disabled: !clipboardReady },
        { id: 'incoming-create-column', label: 'Create Column From Clipboard', disabled: !clipboardReady },
        { id: 'incoming-create-stack', label: 'Create Stack From Clipboard', disabled: !clipboardReady },
        { id: 'incoming-create-row', label: 'Create Row From Clipboard', disabled: !clipboardReady },
        { separator: true },
        { id: 'incoming-open-clipboard', label: 'Open Clipboard Drag Menu' }
      ];
      return showNativeMenu(items, rect.right, rect.bottom, 'header.incoming');
    }).then(function (action) {
      if (!action) return;
      if (action === 'incoming-open-clipboard') {
        var createNewBtn = document.getElementById('btn-create-new');
        if (createNewBtn) showHeaderSourceDropdown('new', createNewBtn);
        else showHeaderCreationMenu('clipboard', btnElement);
        return;
      }
      var map = {
        'incoming-create-card': 'card',
        'incoming-create-column': 'column',
        'incoming-create-stack': 'stack',
        'incoming-create-row': 'row'
      };
      var entityType = map[action];
      if (!entityType) return;
      runHeaderCreationAction(entityType, 'clipboard').catch(function (err) {
        logFrontendIssue('error', 'header.incoming.create', 'Failed to create clipboard item from incoming menu', err);
        showNotification('Clipboard creation failed');
      });
    });
  }

  function buildHeaderCreationTemplateSubmenu(actionPrefix, entityType, templates) {
    var entityLabel = entityType.charAt(0).toUpperCase() + entityType.slice(1);
    var items = [];
    for (var i = 0; i < templates.length; i++) {
      items.push({
        id: actionPrefix + ':' + entityType + ':' + templates[i].id,
        label: templates[i].name || templates[i].id
      });
    }
    if (items.length === 0) {
      items.push({ id: actionPrefix + ':' + entityType + ':none', label: 'No templates available', disabled: true });
    }
    return {
      id: actionPrefix + '-submenu-' + entityType,
      label: entityLabel,
      items: items
    };
  }

  function isDrawioOrExcalidrawTemplateSummary(tpl) {
    var hay = ((tpl && tpl.name) ? tpl.name : '') + ' ' + ((tpl && tpl.id) ? tpl.id : '') + ' ' + ((tpl && tpl.description) ? tpl.description : '');
    return /(draw\.?io|excalidraw|exclidraw)/i.test(hay);
  }

  function getBuiltInDiagramTemplateSummaries(entityType) {
    if (entityType !== 'card') return [];
    return [
      {
        id: '__builtin__:diagram:excalidraw',
        name: 'Excalidraw File',
        description: 'Create and embed a new Excalidraw file',
        templateType: 'card'
      },
      {
        id: '__builtin__:diagram:drawio',
        name: 'Draw.io File',
        description: 'Create and embed a new Draw.io file',
        templateType: 'card'
      }
    ];
  }

  function mergeBuiltInDiagramTemplates(entityType, templates) {
    var list = Array.isArray(templates) ? templates.slice() : [];
    var builtIns = getBuiltInDiagramTemplateSummaries(entityType);
    if (builtIns.length === 0) return list;

    var hasDrawio = false;
    var hasExcalidraw = false;
    for (var i = 0; i < list.length; i++) {
      var summary = list[i];
      var hay = ((summary && summary.name) ? summary.name : '') + ' ' + ((summary && summary.id) ? summary.id : '') + ' ' + ((summary && summary.description) ? summary.description : '');
      if (/draw\.?io/i.test(hay)) hasDrawio = true;
      if (/(excalidraw|exclidraw)/i.test(hay)) hasExcalidraw = true;
    }

    for (var b = 0; b < builtIns.length; b++) {
      var builtin = builtIns[b];
      if (builtin.id.indexOf('drawio') !== -1 && hasDrawio) continue;
      if (builtin.id.indexOf('excalidraw') !== -1 && hasExcalidraw) continue;
      list.push(builtin);
    }
    return list;
  }

  function prioritizeDrawioAndExcalidrawTemplates(entityType, templates) {
    var merged = mergeBuiltInDiagramTemplates(entityType, templates);
    if (!Array.isArray(merged) || merged.length === 0) return [];
    var prioritized = [];
    var regular = [];
    for (var i = 0; i < merged.length; i++) {
      if (isDrawioOrExcalidrawTemplateSummary(merged[i])) prioritized.push(merged[i]);
      else regular.push(merged[i]);
    }
    return prioritized.concat(regular);
  }

  async function showHeaderCreationMenu(mode, btnElement) {
    if (!btnElement) return;
    if (mode === 'template') {
      try {
        await LexeraTemplates.loadTemplates();
      } catch (err) {
        logFrontendIssue('warn', 'header.creation', 'Failed to refresh templates for header creation menu', err);
      }
    }
    var rect = btnElement.getBoundingClientRect();
    var items = [];
    if (mode === 'empty') {
      items = [
        { id: 'create-empty:card', label: 'Empty Card' },
        { id: 'create-empty:column', label: 'Empty Column' },
        { id: 'create-empty:stack', label: 'Empty Stack' },
        { id: 'create-empty:row', label: 'Empty Row' }
      ];
    } else if (mode === 'clipboard') {
      items = [
        { id: 'create-clipboard:card', label: 'Card from Clipboard' },
        { id: 'create-clipboard:column', label: 'Column from Clipboard' },
        { id: 'create-clipboard:stack', label: 'Stack from Clipboard' },
        { id: 'create-clipboard:row', label: 'Row from Clipboard' }
      ];
    } else if (mode === 'template') {
      items = [
        buildHeaderCreationTemplateSubmenu('create-template', 'card', prioritizeDrawioAndExcalidrawTemplates('card', LexeraTemplates.getTemplatesForType('card'))),
        buildHeaderCreationTemplateSubmenu('create-template', 'column', prioritizeDrawioAndExcalidrawTemplates('column', LexeraTemplates.getTemplatesForType('column'))),
        buildHeaderCreationTemplateSubmenu('create-template', 'stack', prioritizeDrawioAndExcalidrawTemplates('stack', LexeraTemplates.getTemplatesForType('stack'))),
        buildHeaderCreationTemplateSubmenu('create-template', 'row', prioritizeDrawioAndExcalidrawTemplates('row', LexeraTemplates.getTemplatesForType('row')))
      ];
    }
    if (!items || items.length === 0) return;
    showNativeMenu(items, rect.right, rect.bottom, 'header.creation.' + mode).then(function (action) {
      if (action) handleHeaderCreationMenuAction(action);
    });
  }

  async function handleHeaderCreationMenuAction(action) {
    if (!action) return;
    var parts = action.split(':');
    if (parts.length < 2) return;
    var kind = parts[0];
    var mode = parts[1];
    if (kind === 'create-empty' || kind === 'create-clipboard') {
      await runHeaderCreationAction(mode, kind === 'create-empty' ? 'empty' : 'clipboard');
      return;
    }
    if (kind === 'create-template') {
      if (parts.length < 3) return;
      var entityType = parts[1];
      var templateId = parts.slice(2).join(':');
      if (templateId === 'none') return;
      await runHeaderCreationAction(entityType, 'template', templateId);
    }
  }

  async function resolveHeaderCreationContext(entityType) {
    if (!activeBoardId || !fullBoardData || !activeBoardData) return null;
    updateDisplayFromFullBoard();
    var rows = activeBoardData.rows || [];

    if (entityType === 'row') {
      return { atIndex: rows.length };
    }

    if (rows.length === 0) {
      var nextIndex = (fullBoardData && fullBoardData.rows) ? fullBoardData.rows.length : 0;
      await addRow(nextIndex);
      updateDisplayFromFullBoard();
      rows = activeBoardData.rows || [];
    }
    if (rows.length === 0) return null;
    var rowIdx = 0;

    if (entityType === 'stack') {
      return { rowIdx: rowIdx };
    }

    var stacks = rows[rowIdx] && rows[rowIdx].stacks ? rows[rowIdx].stacks : [];
    if (stacks.length === 0) {
      await addStackToRow(rowIdx);
      updateDisplayFromFullBoard();
      rows = activeBoardData.rows || [];
      stacks = rows[rowIdx] && rows[rowIdx].stacks ? rows[rowIdx].stacks : [];
    }
    if (stacks.length === 0) return null;
    var stackIdx = 0;

    if (entityType === 'column') {
      return { rowIdx: rowIdx, stackIdx: stackIdx };
    }

    var cols = stacks[stackIdx] && stacks[stackIdx].columns ? stacks[stackIdx].columns : [];
    if (cols.length === 0) {
      await addColumnToStack(rowIdx, stackIdx);
      updateDisplayFromFullBoard();
      rows = activeBoardData.rows || [];
      stacks = rows[rowIdx] && rows[rowIdx].stacks ? rows[rowIdx].stacks : [];
      cols = stacks[stackIdx] && stacks[stackIdx].columns ? stacks[stackIdx].columns : [];
    }
    if (cols.length === 0) return null;
    return { colIndex: cols[0].index };
  }

  async function runHeaderCreationAction(entityType, actionMode, templateId) {
    var context = await resolveHeaderCreationContext(entityType);
    if (!context) {
      showNotification('No insertion target available');
      return;
    }
    var action = actionMode;
    if (actionMode === 'template') action = 'template:' + templateId;
    await handleCreationAction(entityType, action, context);
  }

  function consumeHeaderCreationClickSuppression() {
    var now = Date.now();
    if (now <= suppressHeaderCreationClickUntil) {
      suppressHeaderCreationClickUntil = 0;
      return true;
    }
    suppressHeaderCreationClickUntil = 0;
    return false;
  }

  function resolveFlatColumnIndexForCreationDescriptor(descriptor) {
    if (!activeBoardId || !fullBoardData || !descriptor) return -1;
    var ref = resolveColumnRefForCardMutation(activeBoardId, fullBoardData, descriptor);
    if (!ref || !ref.column) return -1;
    var cols = getAllFullColumns();
    return cols.indexOf(ref.column);
  }

  function resolveHeaderCardCreationContext(mx, my) {
    if (!activeBoardId || !fullBoardData) return null;

    var mainContainer = findColumnCardsContainerAt(mx, my);
    if (mainContainer) {
      var mainColIndex = parseInt(mainContainer.getAttribute('data-col-index'), 10);
      if (!isNaN(mainColIndex)) {
        return {
          colIndex: mainColIndex,
          atCardIndex: findCardInsertIndex(my, mainContainer),
          insertMode: 'visible'
        };
      }
    }

    var treeCardTarget = getTreeCardDropTarget(mx, my);
    if (treeCardTarget && treeCardTarget.boardId === activeBoardId) {
      var treeFlatColIdx = resolveFlatColumnIndexForCreationDescriptor({
        rowIndex: treeCardTarget.rowIndex,
        stackIndex: treeCardTarget.stackIndex,
        colIndex: treeCardTarget.colIndex,
        indexMode: treeCardTarget.indexMode || 'display'
      });
      if (treeFlatColIdx >= 0) {
        return {
          colIndex: treeFlatColIdx,
          atCardIndex: treeCardTarget.before ? treeCardTarget.cardIndex : (treeCardTarget.cardIndex + 1),
          insertMode: treeCardTarget.indexMode === 'full' ? 'full' : 'visible'
        };
      }
    }

    var sidebarCol = findSidebarColumnAt(mx, my);
    if (sidebarCol) {
      var boardId = sidebarCol.getAttribute('data-board-id');
      var rowIdx = parseInt(sidebarCol.getAttribute('data-row-index'), 10);
      var stackIdx = parseInt(sidebarCol.getAttribute('data-stack-index'), 10);
      var colIdx = parseInt(sidebarCol.getAttribute('data-col-local-index'), 10);
      if (boardId === activeBoardId && !isNaN(rowIdx) && !isNaN(stackIdx) && !isNaN(colIdx)) {
        var sideFlatColIdx = resolveFlatColumnIndexForCreationDescriptor({
          rowIndex: rowIdx,
          stackIndex: stackIdx,
          colIndex: colIdx,
          indexMode: 'display'
        });
        if (sideFlatColIdx >= 0) {
          var sideInsertIdx = 0;
          var sideStack = findFullDataStack(rowIdx, stackIdx);
          if (sideStack) {
            var sideFullColIdx = findFullColumnIndexInStack(sideStack, colIdx);
            if (sideFullColIdx >= 0 && sideFullColIdx < sideStack.columns.length) {
              sideInsertIdx = getVisibleCardCountInColumn(sideStack.columns[sideFullColIdx]);
            }
          }
          return {
            colIndex: sideFlatColIdx,
            atCardIndex: sideInsertIdx,
            insertMode: 'visible'
          };
        }
      }
    }

    return null;
  }

  function resolveHeaderColumnCreationContext(mx, my) {
    if (!activeBoardId || !fullBoardData) return null;

    var columnEl = findDraggableColumnAt(mx, my);
    if (columnEl) {
      var columnRect = columnEl.getBoundingClientRect();
      var insertBefore = my < columnRect.top + columnRect.height / 2;
      var rowIdx = parseInt(columnEl.getAttribute('data-row-index'), 10);
      var stackIdx = parseInt(columnEl.getAttribute('data-stack-index'), 10);
      var displayColIdx = parseInt(columnEl.getAttribute('data-col-local-index'), 10);
      if (!isNaN(rowIdx) && !isNaN(stackIdx) && !isNaN(displayColIdx)) {
        var stack = findFullDataStack(rowIdx, stackIdx);
        if (stack) {
          var atColIdx = findInsertColumnIndexInStack(stack, displayColIdx, insertBefore);
          if (atColIdx >= 0) {
            return { rowIdx: rowIdx, stackIdx: stackIdx, atColIdx: atColIdx };
          }
        }
      }
    }

    var stackEl = findBoardStackAt(mx, my);
    if (stackEl) {
      var stackRowIdx = parseInt(stackEl.getAttribute('data-row-index'), 10);
      var stackIdx = parseInt(stackEl.getAttribute('data-stack-index'), 10);
      if (!isNaN(stackRowIdx) && !isNaN(stackIdx)) {
        return { rowIdx: stackRowIdx, stackIdx: stackIdx };
      }
    }

    var treeColTarget = getTreeColumnDropTarget(mx, my);
    if (treeColTarget && treeColTarget.boardId === activeBoardId) {
      if (treeColTarget.indexMode === 'full') {
        var fullInsert = treeColTarget.before ? treeColTarget.colIndex : (treeColTarget.colIndex + 1);
        return { rowIdx: treeColTarget.rowIndex, stackIdx: treeColTarget.stackIndex, atColIdx: fullInsert };
      }
      var targetStack = findFullDataStack(treeColTarget.rowIndex, treeColTarget.stackIndex);
      if (targetStack) {
        var treeInsert = findInsertColumnIndexInStack(targetStack, treeColTarget.colIndex, treeColTarget.before);
        if (treeInsert >= 0) {
          return { rowIdx: treeColTarget.rowIndex, stackIdx: treeColTarget.stackIndex, atColIdx: treeInsert };
        }
      }
    }

    var treeStackTarget = getTreeStackDropTarget(mx, my);
    if (treeStackTarget && treeStackTarget.boardId === activeBoardId) {
      return { rowIdx: treeStackTarget.rowIndex, stackIdx: treeStackTarget.stackIndex };
    }

    return null;
  }

  function resolveHeaderStackCreationContext(mx, my) {
    if (!activeBoardId) return null;

    var stackTarget = getStackDropTarget(mx, my);
    if (stackTarget && stackTarget.boardId === activeBoardId) {
      var atStackIdx = stackTarget.before ? stackTarget.stackIndex : (stackTarget.stackIndex + 1);
      return { rowIdx: stackTarget.rowIndex, atStackIdx: atStackIdx };
    }

    var rowEl = findNodeAtPoint(getElColumnsContainer().querySelectorAll('.board-row'), mx, my);
    if (rowEl) {
      var rowIdx = parseInt(rowEl.getAttribute('data-row-index'), 10);
      if (!isNaN(rowIdx)) return { rowIdx: rowIdx };
    }

    var treeRow = findNodeAtPoint(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-row"]'), mx, my);
    if (treeRow) {
      var rowBoardId = treeRow.getAttribute('data-board-id') || activeBoardId;
      var treeRowIdx = parseInt(treeRow.getAttribute('data-row-index'), 10);
      if (rowBoardId === activeBoardId && !isNaN(treeRowIdx)) {
        return { rowIdx: treeRowIdx };
      }
    }

    return null;
  }

  function resolveHeaderRowCreationContext(mx, my) {
    if (!activeBoardId) return null;
    var rowTarget = getRowDropTarget(mx, my);
    if (rowTarget && rowTarget.boardId === activeBoardId) {
      var atIndex = rowTarget.before ? rowTarget.rowIndex : (rowTarget.rowIndex + 1);
      return { atIndex: atIndex };
    }

    var boardRect = getElColumnsContainer().getBoundingClientRect();
    if (isPointInsideRect(mx, my, boardRect)) {
      var visibleRows = (activeBoardData && Array.isArray(activeBoardData.rows)) ? activeBoardData.rows : [];
      return { atIndex: visibleRows.length };
    }

    return null;
  }

  function resolveHeaderCreationDropTarget(mx, my) {
    if (!activeBoardId || !fullBoardData) return null;

    var cardContext = resolveHeaderCardCreationContext(mx, my);
    if (cardContext) return { entityType: 'card', context: cardContext };

    var columnContext = resolveHeaderColumnCreationContext(mx, my);
    if (columnContext) return { entityType: 'column', context: columnContext };

    var stackContext = resolveHeaderStackCreationContext(mx, my);
    if (stackContext) return { entityType: 'stack', context: stackContext };

    var rowContext = resolveHeaderRowCreationContext(mx, my);
    if (rowContext) return { entityType: 'row', context: rowContext };

    return null;
  }

  function clearHeaderCreationDragVisuals() {
    removeStackDropZones();
    removeDropZoneIndicators();
    clearPtrDropIndicators();
    clearCardDropIndicators();
    clearSidebarDropHighlights();
    clearCardDragOverHighlights();
    clearHeaderDropTargetHighlights();
  }

  function getHeaderCreationDragIndicatorType(entityType) {
    if (entityType === 'card') return 'tree-card';
    if (entityType === 'column') return 'column';
    if (entityType === 'stack') return 'board-stack';
    if (entityType === 'row') return 'board-row';
    return null;
  }

  function updateHeaderCreationDragVisualsForTarget(target, mx, my) {
    clearPtrDropIndicators();
    clearCardDropIndicators();
    clearSidebarDropHighlights();
    clearCardDragOverHighlights();
    clearDropZoneIndicatorHighlights();
    clearHeaderDropTargetHighlights();
    if (!target) return false;

    if (target.entityType === 'card') {
      var highlightedCard = updateCardDropTarget(mx, my);
      clearHeaderDropTargetHighlights();
      return highlightedCard;
    }

    if (target.entityType === 'column') {
      var highlightedColumn = updatePtrDropTargetByType('column', mx, my);
      clearHeaderDropTargetHighlights();
      return highlightedColumn;
    }

    if (target.entityType === 'stack') {
      var highlightedStack = updatePtrDropTargetByType('board-stack', mx, my);
      clearHeaderDropTargetHighlights();
      return highlightedStack;
    }

    if (target.entityType === 'row') {
      var highlightedRow = updatePtrDropTargetByType('board-row', mx, my);
      clearHeaderDropTargetHighlights();
      return highlightedRow;
    }

    return false;
  }

  function getHeaderCreationDragLabel(mode, target) {
    var base = mode === 'empty' ? 'Empty' : (mode === 'template' ? 'Template' : 'Clipboard');
    if (!target || !target.entityType) return base;
    return base + ' ' + target.entityType.charAt(0).toUpperCase() + target.entityType.slice(1);
  }

  async function pickTemplateIdForEntity(entityType, x, y) {
    try {
      await LexeraTemplates.loadTemplates();
    } catch (err) {
      logFrontendIssue('warn', 'header.creation.template', 'Failed to refresh templates for drag drop', err);
    }
    var templates = prioritizeDrawioAndExcalidrawTemplates(entityType, LexeraTemplates.getTemplatesForType(entityType));
    if (!templates || templates.length === 0) {
      showNotification('No templates available for ' + entityType);
      return null;
    }
    if (templates.length === 1) return templates[0].id;

    var items = [];
    for (var i = 0; i < templates.length; i++) {
      items.push({ id: templates[i].id, label: templates[i].name || templates[i].id });
    }
    return await showNativeMenu(items, x, y, 'header.creation.drag.template.' + entityType);
  }

  async function applyHeaderCreationDragDrop(mode, target, x, y) {
    if (!target || !target.entityType || !target.context) {
      showNotification('Drop onto row, stack, column, or card target');
      return false;
    }

    var action = mode;
    if (mode === 'template') {
      var templateId = await pickTemplateIdForEntity(target.entityType, x, y);
      if (!templateId) return false;
      action = 'template:' + templateId;
    }

    await handleCreationAction(target.entityType, action, target.context);
    return true;
  }

  function attachHeaderCreationDragSource(btn, mode) {
    if (!btn) return;
    btn.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (!activeBoardId || !fullBoardData) return;
      if (ptrDrag || cardDrag) return;

      var startX = e.clientX;
      var startY = e.clientY;
      var started = false;
      var ghost = null;
      var currentTarget = null;
      var currentIndicatorType = null;

      function setIndicatorForEntity(entityType) {
        var nextIndicatorType = getHeaderCreationDragIndicatorType(entityType);
        if (nextIndicatorType === currentIndicatorType) return;
        removeStackDropZones();
        removeDropZoneIndicators();
        currentIndicatorType = nextIndicatorType;
        if (!nextIndicatorType) return;
        if (nextIndicatorType === 'column') insertStackDropZones();
        insertDropZoneIndicators(nextIndicatorType);
      }

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var dy = ev.clientY - startY;
        if (!started) {
          if ((dx * dx + dy * dy) < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
          started = true;
          btn.classList.add('dragging');
          ghost = document.createElement('div');
          ghost.className = 'card-drag-ghost';
          ghost.textContent = getHeaderCreationDragLabel(mode, null);
          ghost.style.left = (ev.clientX + 8) + 'px';
          ghost.style.top = (ev.clientY - 12) + 'px';
          document.body.appendChild(ghost);
          var sel = window.getSelection();
          if (sel) sel.removeAllRanges();
        }

        if (ghost) {
          ghost.style.left = (ev.clientX + 8) + 'px';
          ghost.style.top = (ev.clientY - 12) + 'px';
        }

        currentTarget = resolveHeaderCreationDropTarget(ev.clientX, ev.clientY);
        setIndicatorForEntity(currentTarget ? currentTarget.entityType : null);
        updateHeaderCreationDragVisualsForTarget(currentTarget, ev.clientX, ev.clientY);
        if (ghost) ghost.textContent = getHeaderCreationDragLabel(mode, currentTarget);
      }

      function cleanup() {
        btn.classList.remove('dragging');
        if (ghost) ghost.remove();
        ghost = null;
        clearHeaderCreationDragVisuals();
      }

      function onUp(ev) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        if (!started) return;
        suppressHeaderCreationClickUntil = Date.now() + 500;
        ev.preventDefault();
        ev.stopPropagation();
        var dropTarget = resolveHeaderCreationDropTarget(ev.clientX, ev.clientY) || currentTarget;
        cleanup();
        applyHeaderCreationDragDrop(mode, dropTarget, ev.clientX, ev.clientY).catch(function (err) {
          logFrontendIssue('error', 'header.creation.drag', 'Drop apply failed', err);
          showNotification('Creation drop failed');
        });
      }

      function onCancel() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        if (!started) return;
        cleanup();
      }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    });
  }

  function areAllCardsCollapsed() {
    if (isCanvasBoardLayout()) return false;
    var cards = getElColumnsContainer().querySelectorAll('.card');
    if (cards.length === 0) return false;
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].classList.contains('collapsed')) return false;
    }
    return true;
  }

  function areAllColumnsFolded() {
    if (isCanvasBoardLayout()) return false;
    var foldables = getElColumnsContainer().querySelectorAll('.column[data-fold-key]');
    if (foldables.length === 0) return false;
    for (var i = 0; i < foldables.length; i++) {
      if (!foldables[i].classList.contains('folded')) return false;
    }
    return true;
  }

  function areAllBoardItemsFolded() {
    var selector = isCanvasBoardLayout()
      ? '.board-row[data-fold-key]'
      : '.column[data-fold-key], .board-row[data-fold-key], .board-stack[data-fold-key]';
    var foldables = getElColumnsContainer().querySelectorAll(selector);
    if (foldables.length === 0) return false;
    for (var i = 0; i < foldables.length; i++) {
      if (!foldables[i].classList.contains('folded')) return false;
    }
    return true;
  }

  function refreshBoardHeaderActionStates() {
    var boardHeaderEl = getElBoardHeader();
    var headerWidth = 0;
    if (boardHeaderEl) {
      var headerRect = boardHeaderEl.getBoundingClientRect();
      headerWidth = isFinite(headerRect.width) ? Math.round(headerRect.width) : 0;
    }
    var compactMode = !!(
      typeof window !== 'undefined' &&
      (window.innerWidth <= BOARD_HEADER_COMPACT_WIDTH ||
        (headerWidth > 0 && headerWidth <= BOARD_HEADER_COMPACT_HEADER_WIDTH))
    );

    var createNewBtn = document.getElementById('btn-create-new');
    var incomingBtn = document.getElementById('btn-incoming');
    var parkedBtn = document.getElementById('btn-parked');
    var archivedBtn = document.getElementById('btn-archived');
    var trashBtn = document.getElementById('btn-trash');
    var runningProcessesBtn = document.getElementById('btn-running-processes');
    var themeZoomBtn = document.getElementById('btn-theme-zoom');
    var exportBtn = document.getElementById('btn-export');

    var parkedCount = getParkedCount();
    var archivedCount = getArchivedCount();
    var deletedCount = getDeletedCount();
    var incomingCount = getIncomingCount();

    function setHeaderActionLabel(btn, fullLabel, compactLabel, title) {
      if (!btn) return;
      btn.textContent = compactMode ? compactLabel : fullLabel;
      btn.classList.toggle('icon-only', compactMode);
      btn.setAttribute('aria-label', fullLabel);
      if (title) btn.title = title;
    }

    function applyHeaderLabelsForMode() {
      if (boardHeaderEl) boardHeaderEl.classList.toggle('board-header-compact', compactMode);

      setHeaderActionLabel(createNewBtn, 'New', BOARD_HEADER_V1_COMPACT_ICONS.createEmpty, 'Create new row, stack, column or card');

      setHeaderActionLabel(
        incomingBtn,
        'Incoming' + (incomingCount > 0 ? ' (' + incomingCount + ')' : ''),
        BOARD_HEADER_V1_COMPACT_ICONS.incoming,
        'Incoming (clipboard-fed)'
      );
      setHeaderActionLabel(
        parkedBtn,
        'Park' + (parkedCount > 0 ? ' (' + parkedCount + ')' : ''),
        BOARD_HEADER_V1_COMPACT_ICONS.parked,
        'Show parked items — drop cards here to park'
      );
      setHeaderActionLabel(
        archivedBtn,
        'Archive' + (archivedCount > 0 ? ' (' + archivedCount + ')' : ''),
        BOARD_HEADER_V1_COMPACT_ICONS.archived,
        'Show archived items — drop cards here to archive'
      );
      setHeaderActionLabel(
        trashBtn,
        'Trash' + (deletedCount > 0 ? ' (' + deletedCount + ')' : ''),
        BOARD_HEADER_V1_COMPACT_ICONS.trash,
        'Show deleted items — drop cards here to delete'
      );
      if (incomingBtn) incomingBtn.classList.toggle('has-items', incomingCount > 0);
      if (parkedBtn) parkedBtn.classList.toggle('has-items', parkedCount > 0);
      if (archivedBtn) archivedBtn.classList.toggle('has-items', archivedCount > 0);
      if (trashBtn) trashBtn.classList.toggle('has-items', deletedCount > 0);

      var allColumnsFolded = areAllColumnsFolded();
      var allCardsCollapsed = areAllCardsCollapsed();
      var isCanvasLayout = isCanvasBoardLayout();
      if ($foldAllBtn) $foldAllBtn.style.display = isCanvasLayout ? 'none' : '';
      if ($foldAllCardsBtn) $foldAllCardsBtn.style.display = isCanvasLayout ? 'none' : '';
      if (!isCanvasLayout) {
        setHeaderActionLabel(
          $foldAllBtn,
          allColumnsFolded ? 'Unfold Columns' : 'Fold Columns',
          allColumnsFolded ? BOARD_HEADER_V1_COMPACT_ICONS.foldColumnsCollapsed : BOARD_HEADER_V1_COMPACT_ICONS.foldColumnsExpanded,
          'Fold/unfold all columns'
        );
        setHeaderActionLabel(
          $foldAllCardsBtn,
          allCardsCollapsed ? 'Unfold Cards' : 'Fold Cards',
          allCardsCollapsed ? BOARD_HEADER_V1_COMPACT_ICONS.foldCardsCollapsed : BOARD_HEADER_V1_COMPACT_ICONS.foldCardsExpanded,
          'Collapse or expand all cards'
        );
      }

      if ($pinHeadersBtn) {
        var stickyMode = normalizeStickyHeaderMode(getBoardSettingValue('stickyStackMode', ''));
        var pinned = !!stickyMode;
        setHeaderActionLabel(
          $pinHeadersBtn,
          pinned ? 'Unpin Headers' : 'Pin Headers',
          BOARD_HEADER_V1_COMPACT_ICONS.pinHeaders,
          'Pin or unpin column headers'
        );
        $pinHeadersBtn.classList.toggle('has-items', pinned);
      }

      setHeaderActionLabel(runningProcessesBtn, 'Processes', BOARD_HEADER_V1_COMPACT_ICONS.processes, 'Open running processes and logs');
      setHeaderActionLabel(themeZoomBtn, 'Themes / Zoom', BOARD_HEADER_V1_COMPACT_ICONS.themeZoom, 'Visual style and zoom controls');
      setHeaderActionLabel(exportBtn, 'Export / Pack', BOARD_HEADER_V1_COMPACT_ICONS.exportPack, 'Export or pack board');

      if ($saveTrackingBtn) {
        var dirty = isBoardDirty();
        var saveLabel = _headerSavingInProgress ? 'Saving...' : (dirty ? 'Save*' : 'Saved');
        var saveIcon = _headerSavingInProgress ? '\u2026' : (dirty ? '\u25CF' : '\u2713');
        setHeaderActionLabel($saveTrackingBtn, saveLabel, saveIcon, 'Save now and inspect change tracking');
        $saveTrackingBtn.classList.toggle('has-items', dirty || _headerSavingInProgress);
        $saveTrackingBtn.disabled = _headerSavingInProgress;
      }
    }

    function headerActionsOverflowing() {
      if (!boardHeaderEl) return false;
      var tolerance = 4;
      var actionGroups = boardHeaderEl.querySelectorAll('.board-header-actions-middle, .board-header-actions-right');
      for (var i = 0; i < actionGroups.length; i++) {
        if (!actionGroups[i]) continue;
        if ((actionGroups[i].scrollWidth - actionGroups[i].clientWidth) > tolerance) return true;
      }
      return false;
    }

    applyHeaderLabelsForMode();

    if (!compactMode && headerActionsOverflowing()) {
      compactMode = true;
      applyHeaderLabelsForMode();
    }
  }

  async function setBoardSettingValue(key, value) {
    if (!activeBoardId || !fullBoardData) return false;
    if (!fullBoardData.boardSettings) fullBoardData.boardSettings = {};
    var settings = fullBoardData.boardSettings;
    var hasValue = Object.prototype.hasOwnProperty.call(settings, key);
    var previous = hasValue ? settings[key] : undefined;
    var changed = false;
    if (value == null || value === '') {
      if (hasValue) {
        pushUndo();
        delete settings[key];
        changed = true;
      }
    } else if (!hasValue || previous !== value) {
      pushUndo();
      settings[key] = value;
      changed = true;
    }
    if (!changed) return false;
    applyBoardSettings();
    await persistBoardMutation();
    refreshBoardHeaderActionStates();
    return true;
  }

  function normalizeYamlFrontmatterScalar(value) {
    if (value == null) return '';
    return String(value)
      .replace(/\r\n?/g, '\n')
      .trim();
  }

  function ensureBoardYamlHeaderLines(yamlHeader) {
    var normalizedYaml = String(yamlHeader || '')
      .replace(/\r\n?/g, '\n')
      .trim();
    var lines = normalizedYaml ? normalizedYaml.split('\n') : [];
    if (lines.length === 0) return ['---', 'kanban-plugin: board', '---'];
    if (lines[0].trim() !== '---') lines.unshift('---');
    if (lines[lines.length - 1].trim() !== '---') lines.push('---');
    var hasBoardMarker = false;
    for (var i = 1; i < lines.length - 1; i++) {
      if (/^kanban-plugin:\s*board\s*$/i.test(lines[i].trim())) {
        hasBoardMarker = true;
        break;
      }
    }
    if (!hasBoardMarker) {
      lines.splice(Math.max(1, lines.length - 1), 0, 'kanban-plugin: board');
    }
    return lines;
  }

  function getYamlFrontmatterValueMap(yamlHeader, allowedKeys) {
    var lines = String(yamlHeader || '').replace(/\r\n?/g, '\n').split('\n');
    var allowed = null;
    if (Array.isArray(allowedKeys) && allowedKeys.length > 0) {
      allowed = {};
      for (var i = 0; i < allowedKeys.length; i++) {
        allowed[String(allowedKeys[i])] = true;
      }
    }
    var out = {};
    for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      var line = lines[lineIndex];
      var match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) continue;
      var key = match[1];
      if (allowed && !allowed[key]) continue;
      out[key] = normalizeYamlFrontmatterScalar(match[2]);
    }
    return out;
  }

  function updateYamlFrontmatterValue(yamlHeader, key, value) {
    var normalizedKey = String(key || '').trim();
    if (!normalizedKey) return String(yamlHeader || '').trim();

    var normalizedValue = normalizeYamlFrontmatterScalar(value);
    var normalizedYaml = String(yamlHeader || '').replace(/\r\n?/g, '\n').trim();
    if (!normalizedValue && !normalizedYaml) return '';

    var lines = ensureBoardYamlHeaderLines(normalizedYaml);
    var keyRegex = new RegExp('^\\s*' + escapeRegex(normalizedKey) + '\\s*:\\s*(.*)$');
    var result = [];
    var replaced = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (i > 0 && i < lines.length - 1 && keyRegex.test(line)) {
        if (!replaced && normalizedValue) result.push(normalizedKey + ': ' + normalizedValue);
        replaced = true;
        continue;
      }
      result.push(line);
    }

    if (!replaced && normalizedValue) {
      result.splice(Math.max(1, result.length - 1), 0, normalizedKey + ': ' + normalizedValue);
    }

    return result.join('\n');
  }

  function getWhitespaceTokenList(value) {
    var tokens = String(value || '').split(/\s+/);
    var out = [];
    var seen = {};
    for (var i = 0; i < tokens.length; i++) {
      var token = String(tokens[i] || '').trim();
      if (!token || seen[token]) continue;
      seen[token] = true;
      out.push(token);
    }
    return out;
  }

  function setWhitespaceTokenList(tokens) {
    var clean = getWhitespaceTokenList(Array.isArray(tokens) ? tokens.join(' ') : '');
    return clean.length > 0 ? clean.join(' ') : '';
  }

  function syncBoardFrontmatterCache() {
    if (!fullBoardData) return {};
    var nextFrontmatter = getYamlFrontmatterValueMap(fullBoardData.yamlHeader || '', BOARD_MARP_FRONTMATTER_KEYS);
    fullBoardData.frontmatter = nextFrontmatter;
    if (activeBoardData && activeBoardData.fullBoard) {
      activeBoardData.fullBoard.frontmatter = nextFrontmatter;
      activeBoardData.fullBoard.yamlHeader = fullBoardData.yamlHeader;
      activeBoardData.fullBoard.valid = fullBoardData.valid;
    }
    return nextFrontmatter;
  }

  function getBoardMarpFrontmatter() {
    if (!fullBoardData) return {};
    return getYamlFrontmatterValueMap(fullBoardData.yamlHeader || '', BOARD_MARP_FRONTMATTER_KEYS);
  }

  async function setBoardFrontmatterValue(key, value) {
    if (!activeBoardId || !fullBoardData) return false;
    var previousYaml = fullBoardData.yamlHeader || '';
    var nextYaml = updateYamlFrontmatterValue(previousYaml, key, value);
    if ((nextYaml || '') === previousYaml) return false;

    pushUndo();
    fullBoardData.yamlHeader = nextYaml || null;
    fullBoardData.valid = !!((fullBoardData.yamlHeader || '').indexOf('kanban-plugin: board') !== -1);
    syncBoardFrontmatterCache();
    await persistBoardMutation();
    refreshBoardHeaderActionStates();
    return true;
  }

  async function togglePinnedHeaders() {
    var stickyMode = normalizeStickyHeaderMode(getBoardSettingValue('stickyStackMode', ''));
    await setBoardSettingValue('stickyStackMode', stickyMode ? null : 'top');
  }

  function toggleFoldAllColumns() {
    if (isCanvasBoardLayout()) return;
    var foldables = getElColumnsContainer().querySelectorAll('.column[data-fold-key]');
    if (foldables.length === 0) return;
    var allFolded = areAllColumnsFolded();
    for (var i = 0; i < foldables.length; i++) {
      if (allFolded) foldables[i].classList.remove('folded');
      else foldables[i].classList.add('folded');
    }
    saveFoldState(activeBoardId);
    refreshBoardHeaderActionStates();
  }

  function toggleFoldAllCards() {
    if (isCanvasBoardLayout()) return;
    var cards = getElColumnsContainer().querySelectorAll('.card');
    if (cards.length === 0) return;
    var collapse = !areAllCardsCollapsed();
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('collapsed', collapse);
      var toggle = cards[i].querySelector('.card-collapse-toggle');
      if (toggle) toggle.classList.toggle('expanded', !collapse);
    }
    saveCardCollapseState(activeBoardId);
    refreshBoardHeaderActionStates();
  }

  async function showFileHeaderSettingsMenu(btnElement, forcedX, forcedY) {
    if (!btnElement) return;
    // Refresh tool status in background — don't block menu from showing
    refreshExportToolStatus('pandoc', false).catch(function () {});
    refreshEmbeddedRendererStatuses(false).catch(function () {});
    refreshAvailableMarpClasses(false).catch(function () {});
    var items = [
      {
        id: 'file-marp-global',
        label: 'Marp YAML / Frontmatter',
        items: buildFileHeaderMarpMenuItems()
      },
      {
        id: 'file-pandoc-settings',
        label: 'Pandoc Document Export',
        items: buildFileHeaderPandocMenuItems()
      },
      {
        id: 'file-renderer-settings',
        label: 'Embedded Renderer Status',
        items: buildEmbeddedRendererStatusMenuItems()
      }
    ];
    var x = forcedX;
    var y = forcedY;
    if (typeof x !== 'number' || typeof y !== 'number') {
      var rect = btnElement.getBoundingClientRect();
      x = rect.right;
      y = rect.bottom;
    }
    return showNativeMenu(items, x, y, 'header.file').then(function (action) {
      if (action) handleBoardAction(action);
    });
  }

  function showBoardContextMenu(x, y) {
    if (!activeBoardId) return;
    closeRowStackMenu();
    closeColumnContextMenu();
    closeCardContextMenu();

    var stickyMode = normalizeStickyHeaderMode(getBoardSettingValue('stickyStackMode', ''));
    var allColumnsFolded = areAllColumnsFolded();
    var allCardsCollapsed = areAllCardsCollapsed();
    var isCanvasLayout = isCanvasBoardLayout();
    var items = [
      { id: 'set-visual-theme', label: 'Visual Theme', items: buildSettingMenuItems('visualTheme') },
      { id: 'sidebar-hierarchy-display', label: 'Sidebar Hierarchy', items: buildSidebarHierarchyDisplayMenuItems() },
      { id: 'set-tag-style-preset', label: 'Tag Style Preset', items: buildSettingMenuItems('tagStylePreset') },
      { separator: true },
      { id: 'open-frontend-settings', label: 'Frontend Settings' },
      { id: 'backend-settings', label: 'Backend Settings' },
      { id: 'show-processes', label: 'Logs' },
      { separator: true },
      { id: 'set-column-width', label: 'Column Width', items: buildSettingMenuItems('columnWidth') },
      { id: 'set-card-height', label: 'Card Height', items: buildSettingMenuItems('cardHeight') },
      { id: 'set-whitespace', label: 'Whitespace', items: buildSettingMenuItems('whitespace') },
      { id: 'set-font-size', label: 'Font Size', items: buildSettingMenuItems('fontSize') },
      { id: 'set-font-family', label: 'Font Family', items: buildSettingMenuItems('fontFamily') },
      { separator: true },
      { id: 'set-board-layout', label: 'Board Layout', items: buildSettingMenuItems('boardLayout') }
    ];
    if (isCanvasLayout) {
      items.push(
        { id: 'set-canvas-grid', label: 'Canvas Grid', items: buildSettingMenuItems('canvasGrid') }
      );
    }
    items.push(
      { id: 'set-layout-rows', label: 'Layout Rows', items: buildSettingMenuItems('layoutRows') },
      { id: 'set-row-height', label: 'Row Height', items: buildSettingMenuItems('rowHeight') },
      { id: 'set-layout-preset', label: 'Layout Preset', items: buildLayoutPresetMenuItems() },
      { id: stickyMode ? 'unpin-headers' : 'pin-headers', label: stickyMode ? 'Unpin Column Headers' : 'Pin Column Headers' },
      { id: 'set-sticky-headers', label: 'Pinned Header Mode', items: buildSettingMenuItems('stickyHeaders') },
      { id: 'set-arrow-focus-scroll', label: 'Arrow Key Focus Scroll', items: buildSettingMenuItems('arrowFocusScroll') },
      { id: 'set-scroll-speed', label: 'Scroll Speed', items: buildSettingMenuItems('scrollSpeed') },
      { id: 'set-zoom-speed', label: 'Zoom Speed', items: buildSettingMenuItems('zoomSpeed') }
    );
    if (!isCanvasLayout) {
      var pinHeadersIndex = -1;
      for (var itemIndex = 0; itemIndex < items.length; itemIndex++) {
        if (items[itemIndex] && (items[itemIndex].id === 'pin-headers' || items[itemIndex].id === 'unpin-headers')) {
          pinHeadersIndex = itemIndex;
          break;
        }
      }
      if (pinHeadersIndex < 0) pinHeadersIndex = items.length;
      items.splice(pinHeadersIndex, 0,
        { id: allColumnsFolded ? 'unfold-columns' : 'fold-columns', label: allColumnsFolded ? 'Unfold All Columns' : 'Fold All Columns' },
        { id: allCardsCollapsed ? 'unfold-cards' : 'fold-cards', label: allCardsCollapsed ? 'Unfold All Cards' : 'Fold All Cards' }
      );
    }

    showNativeMenu(items, x, y).then(function (action) {
      handleBoardAction(action);
    });
  }

  async function handleBoardAction(action) {
    if (!action) return;
    if (embeddedWorkspaceShellParent && action.indexOf('set-board-layout:') === 0) {
      if (requestWorkspaceShellViewKind(action.substring('set-board-layout:'.length))) return;
    }
    if (workspaceShellEnabled && WorkspaceShell && typeof WorkspaceShell.handleBoardAction === 'function') {
      if (WorkspaceShell.handleBoardAction(action)) return;
    }
    // Try registered actions first
    if (ActionRegistry && ActionRegistry.dispatch('board', action, {})) return;
    // Fallback: delegation to sub-handlers that do their own prefix matching
    if (await handleBoardMarpMenuAction(action)) return;
    if (await handleBoardPandocMenuAction(action)) return;
    if (await handleEmbeddedRendererMenuAction(action)) return;
    // Fallback for unregistered actions
    traceFrontendAction('warn', 'action.board', 'Unhandled board action: ' + action);
  }

  function toggleFoldAll() {
    var selector = isCanvasBoardLayout()
      ? '.board-row[data-fold-key]'
      : '.column[data-fold-key], .board-row[data-fold-key], .board-stack[data-fold-key]';
    var foldables = getElColumnsContainer().querySelectorAll(selector);
    var allFolded = areAllBoardItemsFolded();
    for (var i = 0; i < foldables.length; i++) {
      if (allFolded) {
        foldables[i].classList.remove('folded');
      } else {
        foldables[i].classList.add('folded');
      }
    }
    saveFoldState(activeBoardId);
    refreshBoardHeaderActionStates();
  }

  function showIncomingItems(btnElement) {
    var btn = btnElement || document.getElementById('btn-incoming');
    showHiddenItemsDropdown(btn, '#hidden-internal-incoming', 'Incoming', 'No incoming items',
      [
        { id: 'restore', label: 'Place', handler: function (item) { return updateHiddenItemTag(item, null); } },
        { id: 'trash', label: 'Trash', danger: true, handler: function (item) { return updateHiddenItemTag(item, '#hidden-internal-deleted'); } }
      ],
      [],
      'card'
    );
  }

  function showParkedItems(btnElement) {
    var btn = btnElement || document.getElementById('btn-parked');
    showHiddenItemsDropdown(btn, '#hidden-internal-parked', 'Parked', 'No parked items',
      [
        { id: 'restore', label: 'Unpark', handler: function (item) { return updateHiddenItemTag(item, null); } },
        { id: 'trash', label: 'Trash', danger: true, handler: function (item) { return updateHiddenItemTag(item, '#hidden-internal-deleted'); } }
      ]
    );
  }

  async function unparkCard(colIndex, fullCardIndex) {
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var card = col.cards[fullCardIndex];
    if (!card) return;
    pushUndo();
    card.content = card.content.replace(/\s*#hidden-internal-parked/g, '');
    await persistBoardMutation({ refreshMainView: true });
  }

  function showArchivedItems(btnElement) {
    var btn = btnElement || document.getElementById('btn-archived');
    showHiddenItemsDropdown(btn, '#hidden-internal-archived', 'Archived', 'No archived items',
      [
        { id: 'restore', label: 'Restore', handler: function (item) { return updateHiddenItemTag(item, null); } },
        { id: 'export', label: 'Export', handler: function (item) { return exportArchivedHiddenItemsToArchiveFile(item); } }
      ],
      [
        {
          id: 'export-all', label: 'Move to Archive',
          handler: function (items) { return exportArchivedHiddenItemsToArchiveFile(items); }
        },
        {
          id: 'open-archive-file', label: 'Open Archive File',
          handler: function () { return openArchiveFileFromHeader(); }
        }
      ]
    );
  }

  function showDeletedItems(btnElement) {
    var btn = btnElement || document.getElementById('btn-trash');
    showHiddenItemsDropdown(btn, '#hidden-internal-deleted', 'Trash', 'Trash is empty',
      [
        { id: 'restore', label: 'Restore', handler: function (item) { return updateHiddenItemTag(item, null); } },
        { id: 'delete-forever', label: 'Delete Forever', danger: true, handler: function (item) { return permanentlyDeleteHiddenItem(item); } }
      ],
      [
        {
          id: 'empty-trash', label: 'Empty Trash', danger: true,
          handler: async function (items, controls) {
            if (!items || items.length === 0) return true;
            traceFrontendAction('info', 'trash.empty', 'Requested empty trash', { boardId: activeBoardId || null, itemCount: items.length });
            if (controls && typeof controls.closeDialog === 'function') {
              controls.closeDialog();
              await new Promise(function (resolve) { requestAnimationFrame(resolve); });
            }
            var success = await permanentlyDeleteHiddenItems(items);
            if (!success) showNotification('Failed to empty trash');
            return false;
          }
        }
      ]
    );
  }

  var savingTimeout = null;
  function showSaving() {
    _headerSavingInProgress = true;
    refreshBoardHeaderActionStates();
    clearTimeout(savingTimeout);
  }
  function hideSaving() {
    clearTimeout(savingTimeout);
    savingTimeout = setTimeout(function () {
      _headerSavingInProgress = false;
      refreshBoardHeaderActionStates();
    }, 500);
  }

  // Save coalescing: when a save is already in-flight, new requests are
  // deferred and coalesced into a single follow-up save.  This is purely
  // an optimisation to avoid redundant network round-trips.
  //
  // DESIGN INVARIANT — local edits live in fullBoardData until they are saved
  // or explicitly rebased. Clean boards may adopt authoritative external
  // snapshots directly so card identities stay aligned with live sync/storage.
  // Dirty boards keep their working copy and rebase when external changes land.
  var _saveInFlight = false;
  var _savePending = false;
  var _autoSaveTimer = null;
  var _autoSaveRetryCount = 0;
  var AUTO_SAVE_DELAY_MS = 1200;
  var AUTO_SAVE_REMOTE_DELAY_MS = 180;
  var AUTO_SAVE_MAX_RETRIES = 5;
  var AUTO_SAVE_RETRY_DELAYS = [2000, 5000, 10000, 30000, 60000];

  function clearScheduledAutoSave(reason) {
    if (_autoSaveTimer) {
      clearTimeout(_autoSaveTimer);
      _autoSaveTimer = null;
      traceFrontendAction('info', 'save.auto.cancel', 'Cancelled pending auto-save', {
        boardId: activeBoardId || null,
        reason: reason || null
      });
    }
  }

  function scheduleAutoSave(reason, delayMs) {
    var boardId = activeBoardId || null;
    var waitMs = typeof delayMs === 'number' && isFinite(delayMs) && delayMs >= 0
      ? Math.floor(delayMs)
      : AUTO_SAVE_DELAY_MS;
    if (!boardId || !fullBoardData) {
      traceFrontendAction('warn', 'save.auto.skip', 'Skipped auto-save scheduling because active board is not ready', {
        boardId: boardId,
        reason: reason || null,
        hasBoardData: !!fullBoardData
      });
      return false;
    }
    if (!isBoardDirty()) {
      traceFrontendAction('info', 'save.auto.skip', 'Skipped auto-save scheduling because board is not dirty', {
        boardId: boardId,
        reason: reason || null
      });
      return false;
    }
    if (pendingExternalRebaseConflict && pendingExternalRebaseConflict.result) {
      traceFrontendAction('warn', 'save.auto.skip', 'Skipped auto-save scheduling because unresolved rebase conflicts exist', {
        boardId: boardId,
        reason: reason || null,
        conflicts: pendingExternalRebaseConflict.result.conflicts || 0
      });
      return false;
    }
    if (_autoSaveTimer) {
      clearTimeout(_autoSaveTimer);
      _autoSaveTimer = null;
    }
    traceFrontendAction('info', 'save.auto.schedule', 'Scheduled auto-save after board mutation', {
      boardId: boardId,
      reason: reason || null,
      delayMs: waitMs,
      dirty: isBoardDirty(),
      saveInFlight: _saveInFlight
    });
    _autoSaveTimer = setTimeout(async function () {
      _autoSaveTimer = null;
      if (activeBoardId !== boardId) {
        traceFrontendAction('warn', 'save.auto.skip', 'Skipped auto-save because active board changed before timer fired', {
          scheduledBoardId: boardId,
          activeBoardId: activeBoardId || null,
          reason: reason || null
        });
        return;
      }
      if (!isBoardDirty()) {
        traceFrontendAction('info', 'save.auto.skip', 'Skipped auto-save because board is no longer dirty', {
          boardId: boardId,
          reason: reason || null
        });
        return;
      }
      if (pendingExternalRebaseConflict && pendingExternalRebaseConflict.result) {
        traceFrontendAction('warn', 'save.auto.skip', 'Skipped auto-save because unresolved rebase conflicts exist at execution time', {
          boardId: boardId,
          reason: reason || null,
          conflicts: pendingExternalRebaseConflict.result.conflicts || 0
        });
        return;
      }
      traceFrontendAction('info', 'save.auto.run', 'Executing auto-save', {
        boardId: boardId,
        reason: reason || null,
        dirty: isBoardDirty(),
        saveInFlight: _saveInFlight
      });
      try {
        var genAtSaveStart = getBoardDirtyGeneration();
        var saved = await saveFullBoard();
        if (saved) {
          _autoSaveRetryCount = 0;
          clearBoardDirtyIfUnchanged(genAtSaveStart);
          traceFrontendAction('info', 'save.auto.success', 'Auto-save completed successfully', {
            boardId: boardId,
            reason: reason || null
          });
        } else {
          traceFrontendAction('warn', 'save.auto.blocked', 'Auto-save did not persist changes (blocked or deferred)', {
            boardId: boardId,
            reason: reason || null,
            dirty: isBoardDirty(),
            saveInFlight: _saveInFlight
          });
        }
      } catch (err) {
        logFrontendIssue('error', 'save.auto', 'Auto-save failed (retry ' + _autoSaveRetryCount + '/' + AUTO_SAVE_MAX_RETRIES + ')', err);
        if (isBoardDirty()) {
          _autoSaveRetryCount++;
          if (_autoSaveRetryCount <= AUTO_SAVE_MAX_RETRIES) {
            var retryDelay = AUTO_SAVE_RETRY_DELAYS[Math.min(_autoSaveRetryCount - 1, AUTO_SAVE_RETRY_DELAYS.length - 1)];
            scheduleAutoSave('retry-after-failure-' + _autoSaveRetryCount, retryDelay);
          } else {
            logFrontendIssue('error', 'save.auto', 'Auto-save retries exhausted, writing crashsave to prevent data loss');
            writeBoardCrashsave('auto-save-retries-exhausted', fullBoardData);
          }
        }
      }
    }, waitMs);
    return true;
  }

  async function writeBoardCrashsave(reason, boardData, extra) {
    if (!activeBoardId || !boardData) return null;
    var payload = boardData;
    var crashsaveReason = reason || 'save-recovery';
    traceFrontendAction('warn', 'board.crashsave', 'Attempting to persist crashsave for active board', {
      boardId: activeBoardId,
      reason: crashsaveReason,
      summary: summarizeBoardHierarchy(boardData),
      extra: extra || null
    });
    try {
      var result = await LexeraApi.createBoardCrashsave(activeBoardId, payload, crashsaveReason);
      traceFrontendAction('warn', 'board.crashsave', 'Crashsave persisted for active board', {
        boardId: activeBoardId,
        reason: crashsaveReason,
        path: result && result.path ? result.path : null,
        filename: result && result.filename ? result.filename : null
      });
      return result || null;
    } catch (err) {
      logFrontendIssue('error', 'board.crashsave', 'Failed to persist crashsave for active board', err);
      return null;
    }
  }

  async function overwriteBoardWithLocalDraft(trigger) {
    if (!activeBoardId || !fullBoardData) return false;
    if (_saveInFlight) return false;
    _saveInFlight = true;
    showSaving();
    try {
      lastSaveTime = Date.now();
      ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(activeBoardId, fullBoardData));
      if (!fullBoardData.columns) fullBoardData.columns = [];
      traceFrontendAction('warn', 'board.save.force', 'Overwriting external board version with local draft', {
        boardId: activeBoardId,
        trigger: trigger || null,
        workingSummary: summarizeBoardHierarchy(fullBoardData),
        conflictSummary: pendingExternalRebaseConflict && pendingExternalRebaseConflict.result
          ? {
              conflicts: pendingExternalRebaseConflict.result.conflicts || 0,
              autoMerged: pendingExternalRebaseConflict.result.autoMerged || 0
            }
          : null
      });
      var result = await LexeraApi.saveBoard(activeBoardId, fullBoardData);
      var savedBoard = result && result.board ? result.board : null;
      if (savedBoard) {
        ensureBoardRowsForMutation(savedBoard, getMutationBoardTitle(activeBoardId, savedBoard));
        setBoardSaveBase(fullBoardData, savedBoard);
      } else {
        setBoardSaveBase(fullBoardData, fullBoardData);
      }
      pendingExternalRebaseConflict = null;
      if (activeBoardData && result && typeof result.version === 'number') {
        activeBoardData.version = result.version;
      }
      if (activeBoardData && result && result.revision) {
        activeBoardData.revision = result.revision;
      }
      if (result && typeof result.generation === 'number') {
        _lastLoadedGeneration = result.generation;
      }
      _lastLoadedRevision = result && result.revision ? result.revision : _lastLoadedRevision;
      clearBoardDirty();
      try {
        await reopenLiveSyncSession(activeBoardId);
      } catch (err) {
        logFrontendIssue('warn', 'board.save.force', 'Forced overwrite save succeeded but live sync session could not be reopened', err);
      }
      triggerAutoExportAfterBoardSave(activeBoardId);
      showNotification('Local draft saved and overwrote the external board version.');
      return true;
    } catch (err) {
      logFrontendIssue('error', 'board.save.force', 'Failed to overwrite external board version with local draft', err);
      var overwriteCrashsave = await writeBoardCrashsave('force-overwrite-save-exception', fullBoardData, {
        error: err && err.message ? err.message : String(err),
        trigger: trigger || null
      });
      showNotification(
        overwriteCrashsave && overwriteCrashsave.filename
          ? ('Overwrite failed. Recovery copy written: ' + overwriteCrashsave.filename)
          : 'Overwrite failed. The local draft remains open, but crashsave could not be written.'
      );
      return false;
    } finally {
      _saveInFlight = false;
      hideSaving();
    }
  }

  async function saveFullBoard() {
    clearScheduledAutoSave('saveFullBoard-start');
    if (pendingExternalRebaseConflict && pendingExternalRebaseConflict.result) {
      traceFrontendAction('warn', 'save.blocked.conflict', 'Blocked save because unresolved external rebase conflict exists', {
        boardId: activeBoardId || null,
        conflicts: pendingExternalRebaseConflict.result.conflicts || 0,
        autoMerged: pendingExternalRebaseConflict.result.autoMerged || 0
      });
      showExternalRebaseConflictDialog(pendingExternalRebaseConflict.result);
      return false;
    }
    if (_saveInFlight) {
      _savePending = true;
      traceFrontendAction('info', 'save.coalesce', 'Save request coalesced because another save is in flight', {
        boardId: activeBoardId || null,
        dirty: isBoardDirty()
      });
      return false;
    }
    _saveInFlight = true;
    var saveSucceeded = false;
    traceFrontendAction('info', 'save.begin', 'Starting board save', {
      boardId: activeBoardId || null,
      isRemoteBoard: isActiveRemoteBoard(),
      dirty: isBoardDirty(),
      savePending: _savePending
    });
    showSaving();
    try {
      do {
        _savePending = false;
        lastSaveTime = Date.now();
        // Ensure columns field exists (backend requires it)
        if (!fullBoardData.columns) fullBoardData.columns = [];

        var liveSession = getLiveSyncSession(activeBoardId);
        if (liveSession) {
          traceBoardIdentityPair('info', 'save.preflight', 'Pre-save identity comparison against live sync session', activeBoardId, 'local', fullBoardData, 'session', liveSession.board);
        }
        if (liveSession && hasBoardIdentityMismatch(fullBoardData, liveSession.board)) {
          traceFrontendAction('error', 'save.identityMismatch', 'Blocked save because local board identities do not match live sync session', {
            boardId: activeBoardId,
            local: getBoardCardIdentityStats(fullBoardData, liveSession.board),
            incomingSummary: summarizeBoardHierarchy(fullBoardData),
            sessionSummary: summarizeBoardHierarchy(liveSession.board)
          });
          var liveSessionCrashsave = await writeBoardCrashsave('identity-mismatch-live-session', fullBoardData, {
            sessionSummary: summarizeBoardHierarchy(liveSession.board)
          });
          showNotification(
            liveSessionCrashsave && liveSessionCrashsave.filename
              ? ('Save blocked. Recovery copy written: ' + liveSessionCrashsave.filename)
              : 'Save blocked and crashsave failed. The local draft remains open in the app.'
          );
          return false;
        }

        console.log('[saveFullBoard] incoming=' + boardCardSummary(fullBoardData));
        if (await applyBoardToLiveSyncSession(activeBoardId, fullBoardData, { skipBoardReplace: true, syncSaveBase: true })) {
          console.log('[saveFullBoard] live sync path succeeded');
          if (pendingRefresh) {
            pendingRefresh = false;
            await flushPendingLiveSyncUpdates({ refreshSidebar: true });
          }
          saveSucceeded = true;
          break;
        }
        var baseBoardData = getBoardSaveBase(fullBoardData);
        if (baseBoardData) {
          traceBoardIdentityPair('info', 'save.preflight', 'Pre-save identity comparison against save base', activeBoardId, 'local', fullBoardData, 'saveBase', baseBoardData);
        }
        if (baseBoardData && hasBoardIdentityMismatch(fullBoardData, baseBoardData)) {
          traceFrontendAction('error', 'save.identityMismatch', 'Blocked save because local board identities do not match its save base', {
            boardId: activeBoardId,
            local: getBoardCardIdentityStats(fullBoardData, baseBoardData),
            incomingSummary: summarizeBoardHierarchy(fullBoardData),
            baseSummary: summarizeBoardHierarchy(baseBoardData)
          });
          var baseMismatchCrashsave = await writeBoardCrashsave('identity-mismatch-save-base', fullBoardData, {
            baseSummary: summarizeBoardHierarchy(baseBoardData)
          });
          showNotification(
            baseMismatchCrashsave && baseMismatchCrashsave.filename
              ? ('Save blocked. Recovery copy written: ' + baseMismatchCrashsave.filename)
              : 'Save blocked and crashsave failed. The local draft remains open in the app.'
          );
          return false;
        }
        console.log('[saveFullBoard] REST path, has_base=' + !!baseBoardData + (baseBoardData ? ' base=' + boardCardSummary(baseBoardData) : ''));
        if (isActiveRemoteBoard()) {
          traceFrontendAction('info', 'save.remote', 'Saving remote board via REST', {
            boardId: activeBoardId,
            hasBase: !!baseBoardData,
            summary: summarizeBoardHierarchy(fullBoardData)
          });
        }
        var result;
        try {
          result = baseBoardData
            ? await LexeraApi.saveBoardWithBase(activeBoardId, baseBoardData, fullBoardData)
            : await LexeraApi.saveBoard(activeBoardId, fullBoardData);
        } catch (err) {
          if (err && err.status === 409) {
            traceFrontendAction('warn', 'board.save.conflict', 'Save blocked by external conflicting changes', {
              boardId: activeBoardId,
              hasBase: !!baseBoardData,
              error: err && err.message ? err.message : String(err)
            });
            if (baseBoardData) {
              try {
                var conflictResult = await LexeraApi.rebaseBoardWithBase(activeBoardId, baseBoardData, fullBoardData);
                if (conflictResult && conflictResult.hasConflicts) {
                  pendingExternalRebaseConflict = {
                    result: conflictResult,
                    savedAt: Date.now()
                  };
                  showExternalRebaseConflictDialog(conflictResult);
                  return false;
                }
              } catch (rebaseErr) {
                logFrontendIssue('error', 'board.save.conflict', 'Failed to fetch rebase preview after conflict', rebaseErr);
              }
            }
            showNotification('Save blocked: the board changed externally and needs to be reloaded or rebased before saving.');
            return false;
          }
          throw err;
        }

        // Never replace fullBoardData — only update the save base.
        var savedBoard = result && result.board ? result.board : null;
        if (savedBoard) {
          ensureBoardRowsForMutation(savedBoard, getMutationBoardTitle(activeBoardId, savedBoard));
          setBoardSaveBase(fullBoardData, savedBoard);
          pendingExternalRebaseConflict = null;
        } else {
          setBoardSaveBase(fullBoardData, fullBoardData);
        }
        // Legacy→v2 redirect: backend saved to a new filename to preserve
        // the original v1 file.  Update the tracked file path everywhere.
        if (result && result.redirectedPath && activeBoardData) {
          activeBoardData.filePath = result.redirectedPath;
          traceFrontendAction('info', 'save.legacy_redirect', 'Board saved to new file to preserve original v1 file', {
            boardId: activeBoardId,
            redirectedPath: result.redirectedPath
          });
        }
        if (activeBoardData && result && typeof result.version === 'number') {
          activeBoardData.version = result.version;
        }
        if (activeBoardData && result && result.revision) {
          activeBoardData.revision = result.revision;
        }
        if (result && typeof result.generation === 'number') {
          _lastLoadedGeneration = result.generation;
        }
        _lastLoadedRevision = result && result.revision ? result.revision : _lastLoadedRevision;

        try {
          await reopenLiveSyncSession(activeBoardId);
        } catch (e) {
          // REST save succeeded even if the live session cannot be refreshed.
        }
        if (result && result.hasConflicts) {
          showConflictDialog(result.conflicts, result.autoMerged);
        } else if (result && result.merged && result.autoMerged > 0) {
          showNotification('Auto-merged ' + result.autoMerged + ' change(s) with server version');
        }
        if (isActiveRemoteBoard()) {
          traceFrontendAction('info', 'save.remote', 'Remote board save finished', {
            boardId: activeBoardId,
            revision: result && result.revision ? result.revision : null,
            generation: result && typeof result.generation === 'number' ? result.generation : null,
            hasConflicts: !!(result && result.hasConflicts)
          });
        }
        saveSucceeded = true;
      } while (_savePending);
      if (saveSucceeded) triggerAutoExportAfterBoardSave(activeBoardId);
      return saveSucceeded;
    } catch (err) {
      var failedSaveCrashsave = await writeBoardCrashsave('save-exception', fullBoardData, {
        error: err && err.message ? err.message : String(err)
      });
      showNotification(
        failedSaveCrashsave && failedSaveCrashsave.filename
          ? ('Save failed. Recovery copy written: ' + failedSaveCrashsave.filename)
          : 'Save failed. The local draft remains open, but crashsave could not be written.'
      );
      throw err;
    } finally {
      _saveInFlight = false;
      hideSaving();
    }
  }

  // Generation is kept for diagnostics only; backend-computed revision is the
  // authoritative freshness token for external file changes.
  var _lastLoadedGeneration = null;
  var _lastLoadedRevision = null;

  // Board dirty state: tracks whether fullBoardData has unsaved changes.
  // _boardDirtyGeneration increments on each mutation. Save captures the generation
  // at start and only clears dirty if no new mutations arrived during the save.
  var _boardDirty = false;
  var _boardDirtyGeneration = 0;

  function resetBoardDirtyState(reason, boardId) {
    clearScheduledAutoSave('resetBoardDirtyState:' + (reason || 'unknown'));
    _boardDirty = false;
    pendingExternalRebaseConflict = null;
    refreshBoardHeaderActionStates();
    traceFrontendAction('info', 'board.dirty.reset', 'Reset board dirty state', {
      boardId: boardId || activeBoardId || null,
      reason: reason || null
    });
  }

  function markBoardDirty() {
    _boardDirtyGeneration++;
    if (_boardDirty) return;
    _boardDirty = true;
    refreshBoardHeaderActionStates();
  }

  function getBoardDirtyGeneration() {
    return _boardDirtyGeneration;
  }

  function clearBoardDirtyIfUnchanged(savedGeneration) {
    if (_boardDirtyGeneration !== savedGeneration) {
      // New mutations arrived during save — keep dirty, schedule another auto-save
      traceFrontendAction('info', 'board.dirty.keepDirty', 'Keeping board dirty because mutations arrived during save', {
        boardId: activeBoardId || null,
        savedGeneration: savedGeneration,
        currentGeneration: _boardDirtyGeneration
      });
      scheduleAutoSave('post-save-still-dirty', AUTO_SAVE_DELAY_MS);
      return;
    }
    resetBoardDirtyState('clearBoardDirty', activeBoardId);
    clearLocalBoardDraft(activeBoardId);
  }

  function clearBoardDirty() {
    resetBoardDirtyState('clearBoardDirty', activeBoardId);
    clearLocalBoardDraft(activeBoardId);
  }

  function isBoardDirty() {
    return _boardDirty;
  }

  function persistBoardMutation(options) {
    options = options || {};
    traceFrontendAction('info', 'board.persist', 'Persist board mutation (UI refresh, no immediate save)', {
      boardId: activeBoardId || null,
      refreshMainView: !!options.refreshMainView,
      refreshSidebar: !!options.refreshSidebar,
      skipRender: !!options.skipRender,
      skipAutoSave: !!options.skipAutoSave,
      summaryBefore: summarizeBoardHierarchy(fullBoardData)
    });
    if (typeof options.beforeRefresh === 'function') {
      options.beforeRefresh();
    }
    updateDisplayFromFullBoard();
    if (activeBoardId && fullBoardData) {
      setBoardHierarchyRows(activeBoardId, fullBoardData, activeBoardData ? activeBoardData.title : '');
    }
    if (options.refreshMainView) {
      renderMainView();
    } else if (!options.skipRender) {
      renderColumns();
      if (options.refreshSidebar) renderBoardList();
    }
    if (typeof options.afterRefresh === 'function') {
      options.afterRefresh();
    }
    scheduleDashboardRefresh(80);
    markBoardDirty();
    saveLocalBoardDraft(activeBoardId, fullBoardData);
    if (options.skipAutoSave) {
      traceFrontendAction('info', 'save.auto.skip', 'Skipped auto-save due to explicit persistBoardMutation option', {
        boardId: activeBoardId || null,
        reason: options.autoSaveReason || 'persist-option-skip'
      });
    } else {
      var isRemoteMutationBoard = isActiveRemoteBoard();
      var autoSaveDelay = typeof options.autoSaveDelayMs === 'number'
        ? options.autoSaveDelayMs
        : (isRemoteMutationBoard ? AUTO_SAVE_REMOTE_DELAY_MS : AUTO_SAVE_DELAY_MS);
      scheduleAutoSave(
        options.autoSaveReason || (isRemoteMutationBoard ? 'persist-remote-board-mutation' : 'persist-board-mutation'),
        autoSaveDelay
      );
    }
    traceFrontendAction('info', 'board.persist', 'Persist board mutation success', {
      boardId: activeBoardId || null,
      refreshMainView: !!options.refreshMainView,
      refreshSidebar: !!options.refreshSidebar,
      skipRender: !!options.skipRender,
      summaryAfter: summarizeBoardHierarchy(fullBoardData)
    });
    if (activeBoardId && fullBoardData) {
      var session = getLiveSyncSession(activeBoardId);
      if (session && session.board) {
        traceBoardIdentityPair('info', 'board.persist.identity', 'Identity comparison after board mutation against live sync session', activeBoardId, 'local', fullBoardData, 'session', session.board);
      }
      var saveBase = getBoardSaveBase(fullBoardData);
      if (saveBase) {
        traceBoardIdentityPair('info', 'board.persist.identity', 'Identity comparison after board mutation against save base', activeBoardId, 'local', fullBoardData, 'saveBase', saveBase);
      }
    }
    return true;
  }

  function ensureBoardRowsForMutation(boardData, fallbackTitle) {
    if (!boardData) return;
    if (boardData.rows && boardData.rows.length > 0) {
      if (!boardData.columns) boardData.columns = [];
      return;
    }
    var cols = boardData.columns || [];
    if (cols.length === 0) {
      boardData.rows = [];
      boardData.columns = [];
      return;
    }
    boardData.rows = buildRowsFromLegacyColumns(cols, boardData.title || fallbackTitle || 'Default');
    boardData.columns = [];
  }

  function getMutationBoardTitle(boardId, boardData) {
    if (boardData && boardData.title) return boardData.title;
    if (boardId === activeBoardId && activeBoardData && activeBoardData.title) return activeBoardData.title;
    var meta = findBoardMeta(boardId);
    return meta && meta.title ? meta.title : 'Board';
  }

  async function loadBoardDataForMutation(boardId) {
    if (!boardId) return null;
    if (boardId === activeBoardId && fullBoardData) {
      ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
      if (!getBoardSaveBase(fullBoardData)) setBoardSaveBase(fullBoardData, fullBoardData);
      return fullBoardData;
    }
    var response = await LexeraApi.getBoardColumns(boardId);
    var boardData = response && response.fullBoard ? response.fullBoard : { rows: [], columns: [] };
    ensureBoardRowsForMutation(boardData, response && response.title ? response.title : getMutationBoardTitle(boardId, boardData));
    return setBoardSaveBase(boardData, boardData);
  }

  async function commitBoardMutations(changedBoards, options) {
    options = options || {};
    var boardIds = Object.keys(changedBoards || {});
    if (boardIds.length === 0) return true;

    try {
      for (var i = 0; i < boardIds.length; i++) {
        var boardId = boardIds[i];
        var boardData = changedBoards[boardId];
        if (!boardData) continue;

        if (boardId === activeBoardId) {
          // Active board: don't save — user saves explicitly with Cmd+S.
          // Just refresh the UI and mark dirty.
          updateDisplayFromFullBoard();
          markBoardDirty();
          setBoardHierarchyRows(boardId, fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
          continue;
        }

        // Non-active boards: must save since they're not kept in memory.
        showSaving();
        lastSaveTime = Date.now();
        ensureBoardRowsForMutation(boardData, getMutationBoardTitle(boardId, boardData));
        if (!boardData.columns) boardData.columns = [];
        var baseBoardData = getBoardSaveBase(boardData);
        var result = baseBoardData
          ? await LexeraApi.saveBoardWithBase(boardId, baseBoardData, boardData)
          : await LexeraApi.saveBoard(boardId, boardData);
        var savedBoardData = resolveSavedBoardData(boardData, result, boardId);
        changedBoards[boardId] = savedBoardData;
        setBoardHierarchyRows(boardId, savedBoardData, getMutationBoardTitle(boardId, savedBoardData));
      }
      if (typeof options.beforeRefresh === 'function') options.beforeRefresh();
      if (options.refreshMainView) {
        renderMainView();
      } else if (!options.skipRender && boardIds.indexOf(activeBoardId) !== -1) {
        renderColumns();
      }
      if (boardIds.indexOf(activeBoardId) !== -1) refreshHeaderFileControls();
      if (options.refreshSidebar) renderBoardList();
      if (typeof options.afterRefresh === 'function') options.afterRefresh();
      scheduleDashboardRefresh(80);
      return true;
    } catch (err) {
      logFrontendIssue('error', 'commitBoardMutations', 'Save failed for non-active board', err);
      if (typeof options.onError === 'function') options.onError(err);
      return false;
    } finally {
      hideSaving();
    }
  }

  function showConflictDialog(conflictCount, autoMerged) {
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.innerHTML =
      '<div class="dialog-title">Merge Conflict</div>' +
      '<div style="margin-bottom:12px;color:var(--text-primary);font-size:13px">' +
        'The board was modified externally while you were editing.' +
        (autoMerged > 0 ? '<br>' + autoMerged + ' change(s) were merged automatically.' : '') +
        '<br><strong>' + conflictCount + ' conflict(s)</strong> could not be resolved automatically.' +
      '</div>' +
      '<div class="dialog-actions">' +
        '<button class="btn-small btn-cancel" data-conflict-action="reload">Load Server Version</button>' +
        '<button class="btn-small btn-primary" data-conflict-action="overwrite">Overwrite With My Version</button>' +
      '</div>';

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    dialog.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-conflict-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-conflict-action');
      overlay.remove();
      if (action === 'reload') {
        loadBoard(activeBoardId);
        return;
      }
      if (action === 'overwrite') {
        await overwriteBoardWithLocalDraft('merge-conflict-dialog');
      }
    });
  }

  function showExternalRebaseConflictDialog(result) {
    if (!result) return;
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.innerHTML =
      '<div class="dialog-title">External Changes Need Resolution</div>' +
      '<div style="margin-bottom:12px;color:var(--text-primary);font-size:13px;line-height:1.45">' +
        'The board changed on disk while you had unsaved edits.' +
        '<br>Your local draft was preserved and saving is blocked until you resolve this.' +
        (result.autoMerged > 0 ? '<br>' + result.autoMerged + ' change(s) were merged automatically before conflicts were found.' : '') +
        '<br><strong>' + (result.conflicts || 0) + ' conflict(s)</strong> still need manual resolution.' +
        '<br>Non-conflicting changes were already merged automatically. The remaining conflict is an overlapping edit that still needs a decision.' +
      '</div>' +
      '<div class="dialog-actions">' +
        '<button class="btn-small btn-cancel" data-rebase-action="keep">Keep Local Draft</button>' +
        '<button class="btn-small btn-cancel" data-rebase-action="reload">Load Disk Version</button>' +
        '<button class="btn-small btn-primary" data-rebase-action="overwrite">Overwrite Disk With Local Draft</button>' +
      '</div>';

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    dialog.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-rebase-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-rebase-action');
      overlay.remove();
      if (action === 'reload') {
        pendingExternalRebaseConflict = null;
        loadBoard(activeBoardId);
        return;
      }
      if (action === 'overwrite') {
        await overwriteBoardWithLocalDraft('external-rebase-conflict-dialog');
        return;
      }
      pendingExternalRebaseConflict = pendingExternalRebaseConflict || { result: result, savedAt: Date.now() };
      showNotification('Local draft kept. Resolve the external change before saving.');
    });
  }

  // ── Confirm Dialog (replaces broken window.confirm in Tauri 2) ──

  function showConfirmDialog(message) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';
      var dialog = document.createElement('div');
      dialog.className = 'dialog';
      dialog.style.maxWidth = '380px';
      dialog.innerHTML =
        '<div class="dialog-title">Confirm</div>' +
        '<div class="dialog-note" style="margin-bottom:16px;line-height:1.4;white-space:pre-line">' + escapeHtml(message) + '</div>' +
        '<div class="dialog-actions">' +
        '<button class="btn-small btn-cancel" data-confirm="cancel">Cancel</button>' +
        '<button class="btn-small btn-primary" data-confirm="ok">OK</button>' +
        '</div>';
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      function close(result) {
        overlay.remove();
        resolve(result);
      }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close(false);
      });
      dialog.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-confirm]');
        if (!btn) return;
        close(btn.getAttribute('data-confirm') === 'ok');
      });
    });
  }

  var _quitAppInProgress = false;

  function normalizeBoardCleanupAction(action) {
    return getBoardCleanupApi().normalizeBoardCleanupAction(action);
  }

  function getBoardCleanupState(boardId, boardData) {
    return getBoardCleanupApi().getBoardCleanupState(boardId, boardData, getBoardCleanupDeps());
  }

  function isBoardCleanupActionApplicable(cleanupState, action) {
    return getBoardCleanupApi().isBoardCleanupActionApplicable(cleanupState, action);
  }

  function buildBoardCleanupDialogActions(cleanupState) {
    var actions = [
      { id: 'cancel', label: 'Cancel', className: 'btn-cancel' },
      { id: 'skip', label: 'Keep As Is', className: 'btn-cancel' }
    ];
    if (cleanupState.deletedCount > 0) {
      actions.push({ id: 'trash', label: 'Empty Trash', className: '' });
    }
    if (cleanupState.archivedCount > 0 && cleanupState.archiveAvailable) {
      actions.push({
        id: 'archive',
        label: 'Move to Archive',
        className: cleanupState.deletedCount > 0 ? '' : 'btn-primary'
      });
    }
    if (cleanupState.deletedCount > 0 && cleanupState.archivedCount > 0 && cleanupState.archiveAvailable) {
      actions.push({ id: 'both', label: 'Clean Both', className: 'btn-primary' });
    }
    return actions;
  }

  function showBoardCleanupDialog(cleanupState, options) {
    options = options || {};
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';

      var dialog = document.createElement('div');
      dialog.className = 'dialog';
      dialog.style.maxWidth = '540px';

      var summaryLines = [];
      if (cleanupState.deletedCount > 0) {
        summaryLines.push('<div><strong>' + cleanupState.deletedCount + '</strong> item(s) in Trash</div>');
      }
      if (cleanupState.archivedCount > 0) {
        summaryLines.push('<div><strong>' + cleanupState.archivedCount + '</strong> item(s) in Archive</div>');
      }

      var notes = [];
      if (cleanupState.archivedCount > 0 && cleanupState.archiveAvailable && cleanupState.archiveContext) {
        notes.push('Move to Archive will append the archived items to <strong>' + escapeHtml(cleanupState.archiveContext.filename) + '</strong>.');
      } else if (cleanupState.archivedCount > 0 && !cleanupState.archiveAvailable) {
        notes.push('Move to Archive is unavailable because this board does not have a local board file.');
      }

      var actions = buildBoardCleanupDialogActions(cleanupState);
      var buttonsHtml = actions.map(function (action) {
        return '<button class="btn-small ' + action.className + '" data-cleanup-action="' + action.id + '">' + escapeHtml(action.label) + '</button>';
      }).join('');

      var repeatHtml = options.allowRepeat
        ? '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary)">' +
            '<input type="checkbox" data-cleanup-repeat />' +
            '<span>Repeat this action for all remaining boards</span>' +
          '</label>'
        : '';

      dialog.innerHTML =
        '<div class="dialog-title">' + escapeHtml(options.dialogTitle || 'Clean Up Board') + '</div>' +
        '<div class="dialog-note" style="margin-bottom:12px;line-height:1.45">' +
          'Board <strong>' + escapeHtml(cleanupState.boardTitle || 'Untitled') + '</strong> still has cleanup items ' +
          escapeHtml(options.intentLabel || 'before continuing') + '.' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--text-primary);margin-bottom:12px">' +
          summaryLines.join('') +
        '</div>' +
        (notes.length
          ? ('<div class="dialog-note" style="line-height:1.45;margin-bottom:12px">' + notes.join('<br>') + '</div>')
          : '') +
        '<div class="dialog-actions dialog-actions-between" style="margin-top:18px;gap:12px;flex-wrap:wrap">' +
          repeatHtml +
          '<div class="dialog-actions-right" style="flex-wrap:wrap">' + buttonsHtml + '</div>' +
        '</div>';

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      function close(result) {
        overlay.remove();
        resolve(result);
      }

      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close({ action: 'cancel', repeat: false });
      });

      dialog.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-cleanup-action]');
        if (!btn) return;
        var repeatInput = dialog.querySelector('[data-cleanup-repeat]');
        close({
          action: normalizeBoardCleanupAction(btn.getAttribute('data-cleanup-action')),
          repeat: !!(repeatInput && repeatInput.checked)
        });
      });
    });
  }

  async function persistCleanedBoard(boardId, options) {
    options = options || {};
    if (!boardId) return false;
    if (boardId === activeBoardId) {
      var persisted = persistBoardMutation({
        refreshMainView: !!options.renderActiveBoard,
        refreshSidebar: !!options.refreshSidebar,
        skipRender: !options.renderActiveBoard,
        skipAutoSave: true,
        autoSaveReason: options.saveReason || 'board-cleanup-explicit-save'
      });
      if (!persisted) return false;
      var generation = getBoardDirtyGeneration();
      var saved = await saveFullBoard();
      if (saved) clearBoardDirtyIfUnchanged(generation);
      return !!saved;
    }
    var changedBoards = {};
    changedBoards[boardId] = options.boardData;
    return commitBoardMutations(changedBoards, {
      refreshSidebar: !!options.refreshSidebar,
      refreshMainView: false,
      skipRender: true
    });
  }

  async function applyCleanupActionToBoard(boardId, boardData, cleanupState, action, options) {
    options = options || {};
    var normalized = normalizeBoardCleanupAction(action);
    if (normalized === 'skip') return true;
    if (!isBoardCleanupActionApplicable(cleanupState, normalized)) return true;

    traceFrontendAction('info', 'board.cleanup', 'Applying board cleanup action', {
      boardId: boardId,
      boardTitle: cleanupState && cleanupState.boardTitle ? cleanupState.boardTitle : null,
      action: normalized,
      archivedCount: cleanupState ? cleanupState.archivedCount : 0,
      deletedCount: cleanupState ? cleanupState.deletedCount : 0
    });

    if ((normalized === 'archive' || normalized === 'both') && cleanupState.archivedCount > 0) {
      var exportResult = await writeArchivedHiddenItemsToArchiveFileForBoard(boardId, boardData, cleanupState.archivedItems, {
        notifySuccess: false,
        notifyFailure: options.notifyFailure !== false
      });
      if (!exportResult) return false;
    }

    var itemsToRemove = [];
    if (normalized === 'archive' || normalized === 'both') {
      itemsToRemove = itemsToRemove.concat(cleanupState.archivedItems);
    }
    if (normalized === 'trash' || normalized === 'both') {
      itemsToRemove = itemsToRemove.concat(cleanupState.deletedItems);
    }

    if (itemsToRemove.length > 0 && !removeHiddenItemsFromBoardData(boardData, itemsToRemove)) {
      if (options.notifyFailure !== false) {
        showNotification('Failed to clean up board "' + cleanupState.boardTitle + '"');
      }
      return false;
    }

    return persistCleanedBoard(boardId, {
      boardData: boardData,
      renderActiveBoard: !!options.renderActiveBoard,
      refreshSidebar: !!options.refreshSidebar,
      saveReason: options.saveReason || 'board-cleanup-save'
    });
  }

  async function runBoardCleanupFlow(boardIds, options) {
    options = options || {};
    var remaining = [];
    var seenBoardIds = {};
    var list = Array.isArray(boardIds) ? boardIds : [];
    for (var i = 0; i < list.length; i++) {
      var boardId = list[i];
      if (!boardId || seenBoardIds[boardId]) continue;
      seenBoardIds[boardId] = true;
      var boardData = await loadBoardDataForMutation(boardId);
      if (!boardData) continue;
      var cleanupState = getBoardCleanupState(boardId, boardData);
      if (!cleanupState.needsCleanup) continue;
      remaining.push({
        boardId: boardId,
        boardData: boardData,
        cleanupState: cleanupState
      });
    }

    if (remaining.length === 0) return true;

    var repeatedAction = null;
    for (var r = 0; r < remaining.length; r++) {
      var entry = remaining[r];
      var action = null;
      if (repeatedAction && isBoardCleanupActionApplicable(entry.cleanupState, repeatedAction)) {
        action = repeatedAction;
      } else {
        var dialogResult = await showBoardCleanupDialog(entry.cleanupState, {
          dialogTitle: options.dialogTitle || 'Clean Up Board',
          intentLabel: options.intentLabel || 'before continuing',
          allowRepeat: !!options.allowRepeat && r < remaining.length - 1
        });
        action = dialogResult && dialogResult.action ? dialogResult.action : 'cancel';
        if (action === 'cancel') return false;
        if (dialogResult && dialogResult.repeat) repeatedAction = action;
      }

      if (action === 'skip') continue;

      var success = await applyCleanupActionToBoard(entry.boardId, entry.boardData, entry.cleanupState, action, {
        renderActiveBoard: !!options.renderActiveBoard && entry.boardId === activeBoardId,
        refreshSidebar: !!options.refreshSidebar,
        notifyFailure: true,
        saveReason: options.saveReason || 'board-cleanup-flow'
      });
      if (!success) return false;
    }

    return true;
  }

  async function cleanupBoardBeforeSidebarClose(boardId) {
    try {
      return await runBoardCleanupFlow([boardId], {
        dialogTitle: 'Clean Up Before Closing Board',
        intentLabel: 'before closing this board',
        allowRepeat: false,
        renderActiveBoard: true,
        refreshSidebar: true,
        saveReason: 'board-close-cleanup'
      });
    } catch (err) {
      logFrontendIssue('error', 'board.close.cleanup', 'Failed to run cleanup flow before closing board ' + boardId, err);
      showNotification('Failed to clean up board before closing');
      return false;
    }
  }

  async function requestApplicationQuitWithCleanup() {
    if (_quitAppInProgress) return false;
    _quitAppInProgress = true;
    try {
      var boardIds = (boards || []).map(function (board) { return board && board.id ? board.id : null; });
      var cleanupOk = await runBoardCleanupFlow(boardIds, {
        dialogTitle: 'Clean Up Before Quitting',
        intentLabel: 'before quitting the application',
        allowRepeat: true,
        renderActiveBoard: false,
        refreshSidebar: false,
        saveReason: 'app-quit-cleanup'
      });
      if (!cleanupOk) return false;
      if (hasTauri) {
        await tauriInvoke('quit_app', {});
      } else {
        window.close();
      }
      return true;
    } catch (err) {
      logFrontendIssue('error', 'app.quit', 'Failed to quit application after cleanup flow', err);
      showNotification('Failed to quit application');
      return false;
    } finally {
      _quitAppInProgress = false;
    }
  }

  // ── Management Panel (shared module) ─────────────────────────

  var mgmtPanelOpen = false;
  var mgmtInitialized = false;
  function getManagementUiContainer() {
    if (workspaceShellEnabled) {
      return getElLogSettingsContainer() || getElMgmtPanelBody();
    }
    return getElMgmtPanelBody();
  }

  var FrontendSettings = window.LexeraFrontendSettings || null;

  function buildFrontendSettingsOptions() {
    return {
      getOptions: function () { return buildFrontendSettingsOptions(); },
      getThemes: function () { return Array.isArray(THEMES) ? THEMES : []; },
      getCurrentThemeId: function () {
        return (typeof getLexeraCurrentThemeId === 'function' && getLexeraCurrentThemeId()) ||
          localStorage.getItem('lexera-theme') || 'lexera';
      },
      getSidebarDisplayOptions: getSidebarTreeDisplayOptions,
      applySidebarDisplayOptions: applySidebarTreeDisplayOptions,
      isOverlayEditorEnabled: isOverlayEditorEnabled,
      isWysiwygEditorEnabled: isWysiwygEditorEnabled,
      isMarpSettingsEnabled: isMarpSettingsEnabled,
      isSpecialCharactersVisible: isSpecialCharactersVisible,
      applyTheme: applyTheme,
      setOverlayEditorEnabled: setOverlayEditorEnabled,
      setWysiwygEditorEnabled: setWysiwygEditorEnabled,
      setMarpSettingsEnabled: setMarpSettingsEnabled,
      setSpecialCharactersVisible: setSpecialCharactersVisible,
      syncMenuCheckStates: syncMenuCheckStates,
      revealPanel: workspaceShellEnabled && WorkspaceShell && typeof WorkspaceShell.revealPanel === 'function'
        ? function () { WorkspaceShell.revealPanel('frontendSettings'); }
        : null,
      showFallbackMenu: function () {
        var btn = document.getElementById('btn-theme-zoom');
        if (btn) showThemeZoomMenu(btn);
      }
    };
  }

  function renderFrontendSettingsPanel() {
    if (FrontendSettings) return FrontendSettings.render(buildFrontendSettingsOptions());
    return false;
  }

  function initFrontendSettingsPanel(panelEl) {
    if (FrontendSettings) return FrontendSettings.init(buildFrontendSettingsOptions(), panelEl);
    return false;
  }

  var RenderAppsSettings = window.LexeraRenderAppsSettings || null;

  function initRenderAppsPanel(panelEl) {
    if (RenderAppsSettings) return RenderAppsSettings.init(panelEl);
    return false;
  }

  function openFrontendSettingsPanel() {
    if (FrontendSettings) { FrontendSettings.open(buildFrontendSettingsOptions()); return; }
    var btn = document.getElementById('btn-theme-zoom');
    if (btn) showThemeZoomMenu(btn);
  }

  var mgmtApiAdapter = {
    get: function (path) { return LexeraApi.request(path); },
    post: function (path, body) {
      return LexeraApi.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    put: function (path, body) {
      return LexeraApi.request(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    delete: function (path) {
      return LexeraApi.request(path, { method: 'DELETE' });
    },
  };

  var mgmtCallbacks = {
    onThemeChange: function (themeId) {
      if (typeof applyTheme === 'function') applyTheme(themeId);
    },
    openLogStream: function (onEntry, onOpen, onError) {
      var es = LexeraApi.connectLogStream(onEntry);
      if (!es) return null;
      var previousError = es.onerror;
      es.onopen = function (event) {
        if (onOpen) onOpen(event);
      };
      es.onerror = function (event) {
        if (typeof previousError === 'function') previousError(event);
        if (onError) onError(event);
      };
      return es;
    },
    onNotify: function (msg) { showNotification(msg); },
    onConfirm: function (msg) { return showConfirmDialog(msg); },
    onBoardAdded: function () { poll(); },
    onBoardRemoved: function (boardId) {
      boards = boards.filter(function (b) { return b.id !== boardId; });
      BoardList.deleteBoardHierarchyCacheEntry(boardId);
      if (activeBoardId === boardId) {
        activeBoardId = null;
        activeBoardData = null;
        fullBoardData = null;
        localStorage.removeItem('lexera-last-board');
      }
      renderBoardList();
      renderMainView();
      scheduleDashboardRefresh(60);
    },
    onBoardSettingsSaved: function (boardId, settings) {
      if (boardId === activeBoardId && fullBoardData) {
        if (!fullBoardData.boardSettings) fullBoardData.boardSettings = {};
        for (var s in settings) {
          if (settings[s] == null) {
            delete fullBoardData.boardSettings[s];
          } else {
            fullBoardData.boardSettings[s] = settings[s];
          }
        }
        applyBoardSettings();
      }
    },
    onServerRestarted: function () {},
    getThemes: function () {
      return typeof LEXERA_THEMES !== 'undefined' ? LEXERA_THEMES : [];
    },
  };

  function initManagementUI() {
    var managementContainer = getManagementUiContainer();
    if (mgmtInitialized || !managementContainer) return;
    mgmtInitialized = true;
    ManagementUI.init({
      container: managementContainer,
      ui: {
        topTabs: ['network'],
        defaultTopTab: 'network',
        themeEnabled: false
      },
      api: mgmtApiAdapter,
      callbacks: mgmtCallbacks,
    });
    syncEmbeddedManagementUiState('network');
  }

  var filesMountInitialized = false;

  function initFilesPanelMount(container) {
    if (!container) return;
    ManagementUI.mount('files', {
      container: container,
      ui: {
        topTabs: ['workspaces', 'boards'],
        defaultTopTab: 'workspaces',
        themeEnabled: false
      },
      api: mgmtApiAdapter,
      callbacks: mgmtCallbacks,
    });
    filesMountInitialized = true;
  }

  if (typeof window !== 'undefined') {
    window.initManagementUI = initManagementUI;
    if (isLogPanelVisible()) initManagementUI();
    window.addEventListener('lexera-shared-panel-created', function (event) {
      if (!event.detail) return;
      var el = event.detail.element;
      if (event.detail.kind === 'backendSettings' && el) {
        var container = el.querySelector('.lexera-shared-backend-settings-container');
        if (container) {
          elLogSettingsContainer = container;
          elLogSettingsPane = el;
          mgmtInitialized = false;
          initManagementUI();
        }
      }
      if (event.detail.kind === 'files' && el) {
        var container = el.querySelector('.lexera-shared-files-container');
        if (container) {
          initFilesPanelMount(container);
        }
      }
      if (event.detail.kind === 'frontendSettings') {
        initFrontendSettingsPanel(event.detail.element);
      }
      if (event.detail.kind === 'renderApps') {
        initRenderAppsPanel(event.detail.element);
      }
    });
  }

  function openManagementPanel(options) {
    options = options || {};
    mgmtPanelOpen = true;
    var isFilesSection = options.section === 'boards' || options.section === 'sharing' || options.section === 'workspaces';
    if (workspaceShellEnabled && WorkspaceShell && typeof WorkspaceShell.revealPanel === 'function') {
      WorkspaceShell.revealPanel(isFilesSection ? 'files' : 'backendSettings');
      return;
    }
    runInitManagementUI();
    syncEmbeddedManagementUiState(isFilesSection ? 'workspaces' : 'network');
    if (getElMgmtPanel()) getElMgmtPanel().classList.add('open');
  }

  function closeManagementPanel() {
    mgmtPanelOpen = false;
    if (getElMgmtPanel()) getElMgmtPanel().classList.remove('open');
  }

  // ── Collaboration ────────────────────────────────────────────────

  function openConnectionWindow() {
    openManagementPanel({ section: 'config' });
  }
  window.openConnectionWindow = openConnectionWindow;

  function showNotification(message) {
    var el = document.createElement('div');
    el.className = 'notification';
    el.textContent = message;
    document.body.appendChild(el);
    el.offsetHeight; // force reflow
    el.classList.add('visible');
    setTimeout(function () {
      el.classList.remove('visible');
      setTimeout(function () { el.remove(); }, 300);
    }, 3000);
  }

  function toggleInspector() {
    if (!hasTauri) {
      showNotification('Inspector: use browser DevTools (Cmd+Option+I)');
      return;
    }
    tauriInvoke('toggle_devtools', {})
      .then(function (opened) {
        showNotification(opened ? 'Inspector opened' : 'Inspector closed');
      })
      .catch(function (err) {
        logFrontendIssue('error', 'inspector', 'Failed to toggle devtools', err);
        showNotification('Inspector unavailable in this build');
      });
  }

  function isInspectorShortcut(e) {
    var code = e.code || '';
    if (e.key === 'F12') return true;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && code === 'KeyI') return true;
    if (e.altKey && !e.ctrlKey && !e.metaKey && code === 'KeyI') return true;
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'i' || e.key === 'I')) return true;
    return false;
  }

  if (getElInspectorBtn()) {
    getElInspectorBtn().addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleInspector();
    });
  }

  /**
   * Compute a structural delta between two board states.
   * Returns a delta object containing only the differences.
   * Uses the known board hierarchy: top-level fields, boardSettings,
   * rows > stacks > columns > cards.
   * Arrays of objects with 'id' fields are diffed by id matching.
   */
  function computeBoardDelta(oldBoard, newBoard) {
    return getBoardDeltaApi().computeBoardDelta(oldBoard, newBoard);
  }

  /**
   * Diff two flat objects (like boardSettings). Returns null if identical.
   * Result: { key: { o: oldVal, n: newVal }, ... } for changed/added/removed keys.
   */
  function diffFlatObject(oldObj, newObj) {
    if (oldObj === newObj) return null;
    if (!oldObj && !newObj) return null;
    if (!oldObj) return { __replaced: { o: null, n: JSON.parse(JSON.stringify(newObj)) } };
    if (!newObj) return { __replaced: { o: JSON.parse(JSON.stringify(oldObj)), n: null } };
    var diff = null;
    var allKeys = {};
    var k;
    for (k in oldObj) allKeys[k] = true;
    for (k in newObj) allKeys[k] = true;
    for (k in allKeys) {
      var ov = oldObj[k], nv = newObj[k];
      if (ov !== nv) {
        if (!diff) diff = {};
        diff[k] = { o: ov, n: nv };
      }
    }
    return diff;
  }

  /**
   * Diff two arrays of objects that each have an 'id' field.
   * diffItemFn is called for items that exist in both arrays to produce per-item deltas.
   * Returns null if arrays are identical.
   * Result: { order: [id1, id2, ...], added: { id: fullItem }, removed: { id: fullItem }, modified: { id: itemDelta } }
   */
  function diffIdArray(oldArr, newArr, diffItemFn) {
    var oldIds = oldArr.map(function (item) { return item.id; });
    var newIds = newArr.map(function (item) { return item.id; });
    var oldMap = {};
    for (var i = 0; i < oldArr.length; i++) oldMap[oldArr[i].id] = oldArr[i];
    var newMap = {};
    for (var j = 0; j < newArr.length; j++) newMap[newArr[j].id] = newArr[j];
    var result = null;
    // Check order change
    var orderChanged = oldIds.length !== newIds.length || oldIds.some(function (id, idx) { return id !== newIds[idx]; });
    if (orderChanged) {
      result = result || {};
      result.oldOrder = oldIds;
      result.newOrder = newIds;
    }
    // Find added items
    for (var a = 0; a < newArr.length; a++) {
      if (!oldMap[newArr[a].id]) {
        result = result || {};
        if (!result.added) result.added = {};
        result.added[newArr[a].id] = JSON.parse(JSON.stringify(newArr[a]));
      }
    }
    // Find removed items
    for (var r = 0; r < oldArr.length; r++) {
      if (!newMap[oldArr[r].id]) {
        result = result || {};
        if (!result.removed) result.removed = {};
        result.removed[oldArr[r].id] = JSON.parse(JSON.stringify(oldArr[r]));
      }
    }
    // Find modified items
    for (var m = 0; m < newArr.length; m++) {
      if (oldMap[newArr[m].id]) {
        var itemDelta = diffItemFn(oldMap[newArr[m].id], newArr[m]);
        if (itemDelta) {
          result = result || {};
          if (!result.modified) result.modified = {};
          result.modified[newArr[m].id] = itemDelta;
        }
      }
    }
    return result;
  }

  /** Diff a single row: compare title + stacks array. */
  function diffRow(oldRow, newRow) {
    var delta = null;
    if (oldRow.title !== newRow.title) {
      delta = delta || {};
      delta.title = { o: oldRow.title, n: newRow.title };
    }
    var stacksDelta = diffIdArray(oldRow.stacks || [], newRow.stacks || [], diffStack);
    if (stacksDelta) {
      delta = delta || {};
      delta.stacks = stacksDelta;
    }
    return delta;
  }

  /** Diff a single stack: compare title + columns array. */
  function diffStack(oldStack, newStack) {
    var delta = null;
    if (oldStack.title !== newStack.title) {
      delta = delta || {};
      delta.title = { o: oldStack.title, n: newStack.title };
    }
    var colsDelta = diffIdArray(oldStack.columns || [], newStack.columns || [], diffColumn);
    if (colsDelta) {
      delta = delta || {};
      delta.columns = colsDelta;
    }
    return delta;
  }

  /** Diff a single column: compare title, include_source, + cards array. */
  function diffColumn(oldCol, newCol) {
    var delta = null;
    if (oldCol.title !== newCol.title) {
      delta = delta || {};
      delta.title = { o: oldCol.title, n: newCol.title };
    }
    var oldSrc = oldCol.include_source ? JSON.stringify(oldCol.include_source) : null;
    var newSrc = newCol.include_source ? JSON.stringify(newCol.include_source) : null;
    if (oldSrc !== newSrc) {
      delta = delta || {};
      delta.include_source = { o: oldCol.include_source || null, n: newCol.include_source || null };
    }
    var cardsDelta = diffIdArray(oldCol.cards || [], newCol.cards || [], diffCard);
    if (cardsDelta) {
      delta = delta || {};
      delta.cards = cardsDelta;
    }
    return delta;
  }

  /** Diff a single card: compare content, checked, kid. */
  function diffCard(oldCard, newCard) {
    var delta = null;
    var cardFields = ['content', 'checked', 'kid'];
    for (var f = 0; f < cardFields.length; f++) {
      var field = cardFields[f];
      if (oldCard[field] !== newCard[field]) {
        delta = delta || {};
        delta[field] = { o: oldCard[field], n: newCard[field] };
      }
    }
    return delta;
  }

  /**
   * Apply a board delta to fullBoardData, mutating it in place.
   * If reverse is true, apply the delta in reverse (undo direction).
   */
  function applyBoardDelta(board, delta, reverse) {
    return getBoardDeltaApi().applyBoardDelta(board, delta, reverse);
  }

  /** Apply a flat-object delta (for boardSettings). */
  function applyFlatObjectDelta(parent, prop, diff, reverse) {
    if (diff.__replaced) {
      parent[prop] = reverse ? JSON.parse(JSON.stringify(diff.__replaced.o)) : JSON.parse(JSON.stringify(diff.__replaced.n));
      return;
    }
    if (!parent[prop]) parent[prop] = {};
    for (var k in diff) {
      parent[prop][k] = reverse ? diff[k].o : diff[k].n;
    }
  }

  /**
   * Apply an id-array delta. Returns the new array.
   * applyItemDeltaFn applies per-item modifications in place.
   */
  function applyIdArrayDelta(arr, delta, reverse, applyItemDeltaFn) {
    // Build id->item map from current array
    var map = {};
    for (var i = 0; i < arr.length; i++) map[arr[i].id] = arr[i];
    // Handle removals (in reverse direction these are additions)
    var toRemove = reverse ? delta.added : delta.removed;
    if (toRemove) {
      for (var rid in toRemove) delete map[rid];
    }
    // Handle additions (in reverse direction these are removals)
    var toAdd = reverse ? delta.removed : delta.added;
    if (toAdd) {
      for (var aid in toAdd) map[aid] = JSON.parse(JSON.stringify(toAdd[aid]));
    }
    // Apply modifications
    if (delta.modified) {
      for (var mid in delta.modified) {
        if (map[mid]) {
          applyItemDeltaFn(map[mid], delta.modified[mid], reverse);
        }
      }
    }
    // Reconstruct array in correct order
    var targetOrder = reverse ? (delta.oldOrder || delta.newOrder) : (delta.newOrder || delta.oldOrder);
    if (targetOrder) {
      var result = [];
      for (var o = 0; o < targetOrder.length; o++) {
        if (map[targetOrder[o]]) result.push(map[targetOrder[o]]);
      }
      return result;
    }
    // No order change — return current array with modifications applied
    return arr.filter(function (item) { return !!map[item.id]; })
      .concat(Object.keys(map).filter(function (id) {
        return !arr.some(function (item) { return item.id === id; });
      }).map(function (id) { return map[id]; }));
  }

  /** Apply a row delta in place. */
  function applyRowDelta(row, delta, reverse) {
    if (delta.title) row.title = reverse ? delta.title.o : delta.title.n;
    if (delta.stacks) {
      row.stacks = applyIdArrayDelta(row.stacks || [], delta.stacks, reverse, applyStackDelta);
    }
  }

  /** Apply a stack delta in place. */
  function applyStackDelta(stack, delta, reverse) {
    if (delta.title) stack.title = reverse ? delta.title.o : delta.title.n;
    if (delta.columns) {
      stack.columns = applyIdArrayDelta(stack.columns || [], delta.columns, reverse, applyColumnDelta);
    }
  }

  /** Apply a column delta in place. */
  function applyColumnDelta(col, delta, reverse) {
    if (delta.title) col.title = reverse ? delta.title.o : delta.title.n;
    if (delta.include_source) col.include_source = reverse ? delta.include_source.o : delta.include_source.n;
    if (delta.cards) {
      col.cards = applyIdArrayDelta(col.cards || [], delta.cards, reverse, applyCardDelta);
    }
  }

  /** Apply a card delta in place. */
  function applyCardDelta(card, delta, reverse) {
    var cardFields = ['content', 'checked', 'kid'];
    for (var f = 0; f < cardFields.length; f++) {
      var field = cardFields[f];
      if (delta[field]) {
        card[field] = reverse ? delta[field].o : delta[field].n;
      }
    }
  }

  /** Estimate the byte size of a delta object for memory tracking. */
  function estimateDeltaSize(delta) {
    return getBoardDeltaApi().estimateDeltaSize(delta);
  }

  /**
   * Finalize any pending undo snapshot by computing the delta
   * between the snapshot (pre-mutation state) and current fullBoardData (post-mutation state).
   */
  function finalizePendingUndo() {
    if (!undoPendingSnapshot || !fullBoardData) return;
    var delta = computeBoardDelta(undoPendingSnapshot, fullBoardData);
    var deltaSize = estimateDeltaSize(delta);
    undoStack.push({ delta: delta, size: deltaSize });
    undoTotalBytes += deltaSize;
    while (undoStack.length > MAX_UNDO) {
      undoTotalBytes -= undoStack.shift().size;
    }
    while (undoTotalBytes > MAX_UNDO_BYTES && undoStack.length > 0) {
      undoTotalBytes -= undoStack.shift().size;
    }
    undoPendingSnapshot = null;
  }

  function pushUndo() {
    if (!fullBoardData) return;
    finalizePendingUndo();
    undoPendingSnapshot = cloneBoardData(fullBoardData);
    redoStack = [];
  }

  async function undo() {
    finalizePendingUndo();
    if (undoStack.length === 0 || !fullBoardData || !activeBoardId) return;
    var saveBase = getBoardSaveBase(fullBoardData);
    var entry = undoStack.pop();
    undoTotalBytes -= entry.size;
    redoStack.push(entry);
    applyBoardDelta(fullBoardData, entry.delta, true);
    setBoardSaveBase(fullBoardData, saveBase || fullBoardData);
    await persistBoardMutation();
  }

  async function redo() {
    if (redoStack.length === 0 || !fullBoardData || !activeBoardId) return;
    var saveBase = getBoardSaveBase(fullBoardData);
    var entry = redoStack.pop();
    undoStack.push(entry);
    undoTotalBytes += entry.size;
    applyBoardDelta(fullBoardData, entry.delta, false);
    setBoardSaveBase(fullBoardData, saveBase || fullBoardData);
    await persistBoardMutation();
  }

  function showKeyboardShortcutsHelp() {
    var existing = document.querySelector('.shortcuts-help-overlay');
    if (existing) { existing.remove(); return; }
    var isMac = navigator.platform && navigator.platform.indexOf('Mac') >= 0;
    var mod = isMac ? '\u2318' : 'Ctrl';
    var shortcuts = [
      { section: 'Board' },
      { keys: mod + '+S', desc: 'Save board' },
      { keys: mod + '+Z', desc: 'Undo' },
      { keys: mod + '+Y / ' + mod + '+Shift+Z', desc: 'Redo' },
      { keys: mod + '+F', desc: 'Search' },
      { keys: mod + '+Shift+H', desc: 'Search & Replace' },
      { keys: mod + '+Shift+V', desc: 'Smart Paste (auto-format)' },
      { keys: mod + '+= / ' + mod + '+-', desc: 'Zoom in / out' },
      { keys: mod + '+0', desc: 'Reset zoom' },
      { keys: 'Drag empty canvas / Middle-drag / Alt+Drag', desc: 'Pan canvas board' },
      { keys: 'Alt+Enter', desc: 'Close panels' },
      { keys: mod + '+Shift+L', desc: 'Toggle logger' },
      { section: 'Card Editor' },
      { keys: mod + '+Enter', desc: 'Save and close' },
      { keys: 'Escape', desc: 'Cancel / close editor' },
      { keys: mod + '+1', desc: 'Markdown mode' },
      { keys: mod + '+2', desc: 'Split mode' },
      { keys: mod + '+3', desc: 'Preview mode' },
      { keys: mod + '+4', desc: 'WYSIWYG mode' },
      { keys: mod + '+B', desc: 'Bold' },
      { keys: mod + '+I', desc: 'Italic' },
      { keys: mod + '+U', desc: 'Underline' },
      { keys: mod + '+K', desc: 'Insert link' },
      { keys: mod + '+H', desc: 'Heading' },
      { keys: mod + '+`', desc: 'Inline code' },
      { section: 'Card Navigation' },
      { keys: '\u2191 / \u2193', desc: 'Move focus up / down' },
      { keys: '\u2190 / \u2192', desc: 'Move focus left / right' },
      { keys: 'Home / End', desc: 'Jump to first / last card' },
      { keys: 'Enter', desc: 'Edit focused card' },
      { keys: 'Escape', desc: 'Unfocus card' },
      { keys: 'Alt+\u2191/\u2193', desc: 'Move card up / down' },
      { keys: 'Alt+\u2190/\u2192', desc: 'Move card to adjacent column' },
      { keys: mod + '+D', desc: 'Duplicate focused card' },
      { keys: 'R', desc: 'Reveal / collapse card content' },
      { keys: 'I', desc: 'Insert card after focused' },
      { keys: 'C', desc: 'Copy card as markdown' },
      { keys: 'E', desc: 'Edit card (overlay if enabled)' },
      { keys: 'P', desc: 'Park focused card' },
      { keys: 'Space', desc: 'Open card context menu' },
      { keys: 'Delete', desc: 'Delete focused card' },
      { keys: 'N', desc: 'New card (when no card focused)' },
      { keys: '1\u20139', desc: 'Jump to column by position' },
      { section: 'Other' },
      { keys: 'Alt+Click', desc: 'Open link/image/embed in system app' },
      { keys: '?', desc: 'Toggle this help' },
    ];
    // Append user-defined keybindings
    if (window.LexeraKeybindingRegistry) {
      var userBindings = window.LexeraKeybindingRegistry.getUserBindings();
      if (userBindings.length > 0) {
        shortcuts.push({ section: 'Custom Keybindings' });
        for (var ui = 0; ui < userBindings.length; ui++) {
          var ub = userBindings[ui];
          var desc = ub.description || ub.action;
          if (ub.action === 'insert-text' && !ub.description) desc = 'Insert text snippet';
          if (ub.action === 'insert-formatting' && !ub.description) desc = 'Insert formatting';
          shortcuts.push({
            keys: window.LexeraKeybindingRegistry.formatKeyDisplay(ub.key),
            desc: desc + ' (' + ub.when + ')'
          });
        }
      }
    }
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay shortcuts-help-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'modal-dialog shortcuts-help-dialog';
    dialog.setAttribute('tabindex', '-1');
    var html = '<div class="modal-title">Keyboard Shortcuts</div><div class="shortcuts-help-grid">';
    for (var i = 0; i < shortcuts.length; i++) {
      var s = shortcuts[i];
      if (s.section) {
        html += '<div class="shortcuts-help-section">' + escapeHtml(s.section) + '</div>';
      } else {
        html += '<div class="shortcuts-help-row"><span class="shortcuts-help-keys">' + escapeHtml(s.keys) + '</span><span class="shortcuts-help-desc">' + escapeHtml(s.desc) + '</span></div>';
      }
    }
    html += '</div><div class="hidden-items-footer"><button class="board-action-btn shortcuts-help-close">Close</button></div>';
    dialog.innerHTML = html;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('.shortcuts-help-close')) overlay.remove();
    });
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); overlay.remove(); }
    });
    dialog.focus();
  }

  // ── Board Search & Replace (delegated to BoardSearchReplace module) ──
  function openSearchReplacePanel() {
    if (window.BoardSearchReplace) window.BoardSearchReplace.openSearchReplacePanel();
  }

  function closeSearchReplacePanel() {
    if (window.BoardSearchReplace) window.BoardSearchReplace.closeSearchReplacePanel();
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    // Check user-defined keybindings first (board context when not editing)
    if (window.LexeraKeybindingRegistry && !isEditing) {
      var kb = window.LexeraKeybindingRegistry.match(e, 'board');
      if (kb) {
        e.preventDefault();
        window.LexeraKeybindingRegistry.execute(kb, null, null);
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      nudgeUiScale(getUiZoomStep(0.05));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === '-') {
      e.preventDefault();
      nudgeUiScale(getUiZoomStep(-0.05));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === '0') {
      e.preventDefault();
      applyUiScale(1);
      showNotification('Zoom 100%');
      return;
    }

    // Search & Replace: Ctrl/Cmd+Shift+H (when not editing a card)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'h' && !isEditing) {
      e.preventDefault();
      openSearchReplacePanel();
      return;
    }

    // Undo: Ctrl/Cmd+Z
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    // Redo: Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey) || (e.key === 'Z' && e.shiftKey))) {
      e.preventDefault();
      redo();
      return;
    }
    // Save: Ctrl/Cmd+S
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (fullBoardData && activeBoardId) {
        var gen = getBoardDirtyGeneration();
        saveFullBoard().then(function (saved) {
          if (saved) clearBoardDirtyIfUnchanged(gen);
        }).catch(function (err) {
          logFrontendIssue('warn', 'keyboard.save', 'Save shortcut failed after saveFullBoard already handled recovery', err);
        });
      }
      return;
    }

    if (isInspectorShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      toggleInspector();
      return;
    }

    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'Enter') {
      if (closeTransientUiViaHotkey()) e.preventDefault();
      return;
    }

    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditing) {
      e.preventDefault();
      showKeyboardShortcutsHelp();
      return;
    }

    // Smart Paste: Shift+Cmd/Ctrl+V — detect content type and paste with formatting
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v' && !isEditing) {
      e.preventDefault();
      smartPasteAsCard();
      return;
    }
  });

  var $canvasZoom = 1;
  var $canvasPanX = 0;
  var $canvasPanY = 0;
  var CANVAS_DEFAULT_STACK_X = 24;
  var CANVAS_DEFAULT_STACK_Y = 24;
  var CANVAS_DEFAULT_STACK_W = 300;
  var CANVAS_DEFAULT_STACK_H = 220;
  var CANVAS_STACK_SPACING = 28;
  var CANVAS_ROW_PADDING = 40;
  var CANVAS_MIN_ROW_WIDTH = 960;
  var CANVAS_MIN_ROW_HEIGHT = 640;
  var CANVAS_SURFACE_OVERSCAN_X = Math.floor(CANVAS_MIN_ROW_WIDTH / 2);
  var CANVAS_SURFACE_OVERSCAN_Y = Math.floor(CANVAS_MIN_ROW_HEIGHT / 2);

  function getCanvasMathApi() {
    if (typeof globalThis !== 'undefined' && globalThis.LexeraCanvasMath) return globalThis.LexeraCanvasMath;
    throw new Error('LexeraCanvasMath is unavailable');
  }

  var _canvasModeHelpers = null;

  function createFallbackCanvasModeHelpers() {
    function normalizeBoardLayoutValueFallback(value) {
      var normalized = String(value == null ? '' : value).trim().toLowerCase();
      if (normalized === 'canvas') return 'canvas';
      return 'kanban';
    }

    function normalizeCanvasGridValueFallback(value) {
      var normalized = String(value == null ? '' : value).trim().toLowerCase();
      if (!normalized || normalized === 'default' || normalized === 'medium') return '32';
      if (normalized === 'off' || normalized === 'none' || normalized === 'hidden') return 'off';
      if (normalized === 'fine' || normalized === 'small') return '16';
      if (normalized === 'large') return '64';
      if (normalized === 'largest' || normalized === 'largest-element' || normalized === 'auto') return 'largest';
      var parsed = parseFloat(normalized);
      if (!isFinite(parsed) || parsed <= 0) return '32';
      return String(Math.round(parsed));
    }

    function parseCanvasParamMapFallback(raw) {
      var out = {};
      var text = String(raw || '').trim();
      if (!text) return out;
      var parts = text.split(',');
      for (var i = 0; i < parts.length; i++) {
        var pair = String(parts[i] || '').trim();
        if (!pair) continue;
        var colon = pair.indexOf(':');
        if (colon === -1) continue;
        var key = pair.substring(0, colon).trim();
        var value = pair.substring(colon + 1).trim();
        if (!key) continue;
        out[key] = value;
      }
      return out;
    }

    function extractCanvasConnectionSpecsFallback(title) {
      var out = [];
      var text = stripHtmlComments(String(title || ''));
      var connectionRe = /\[(#[^\]\s]+)\]\u007B([^\u007D]+)\u007D/gi;
      var match;
      while ((match = connectionRe.exec(text))) {
        out.push({
          targetTag: String(match[1] || '').toLowerCase(),
          params: parseCanvasParamMapFallback(match[2])
        });
      }
      return out;
    }

    function getCanvasColumnWidthSpecFallback(value) {
      var raw = String(value == null ? '' : value).trim().toLowerCase();
      if (!raw) return null;
      if (/^-?\d+(\.\d+)?%$/.test(raw)) {
        return { kind: 'percent', value: Math.max(0, parseFloat(raw)) };
      }
      var fractionMatch = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
      if (fractionMatch) {
        var numerator = parseFloat(fractionMatch[1]);
        var denominator = parseFloat(fractionMatch[2]);
        if (isFinite(numerator) && isFinite(denominator) && denominator > 0) {
          return { kind: 'percent', value: Math.max(0, (numerator / denominator) * 100) };
        }
      }
      var numeric = parseFloat(raw);
      if (!isFinite(numeric) || numeric <= 0) return null;
      if (numeric <= 1) return { kind: 'percent', value: numeric * 100 };
      if (numeric <= 100) return { kind: 'percent', value: numeric };
      return { kind: 'px', value: numeric };
    }

    return {
      normalizeBoardLayoutValue: normalizeBoardLayoutValueFallback,
      normalizeCanvasGridValue: normalizeCanvasGridValueFallback,
      parseCanvasParamMap: parseCanvasParamMapFallback,
      extractCanvasConnectionSpecs: extractCanvasConnectionSpecsFallback,
      getCanvasColumnWidthSpec: getCanvasColumnWidthSpecFallback
    };
  }

  function getCanvasModeHelpers() {
    if (_canvasModeHelpers) return _canvasModeHelpers;
    if (typeof globalThis === 'undefined' || !globalThis.LexeraCanvasMode || typeof globalThis.LexeraCanvasMode.createCanvasModeHelpers !== 'function') {
      _canvasModeHelpers = createFallbackCanvasModeHelpers();
      return _canvasModeHelpers;
    }
    _canvasModeHelpers = globalThis.LexeraCanvasMode.createCanvasModeHelpers({
      stripHtmlComments: stripHtmlComments
    });
    return _canvasModeHelpers;
  }

  function getCanvasViewportApi() {
    if (typeof globalThis !== 'undefined' && globalThis.LexeraCanvasViewport) return globalThis.LexeraCanvasViewport;
    throw new Error('LexeraCanvasViewport is unavailable');
  }

  function getCanvasDomApi() {
    if (typeof globalThis !== 'undefined' && globalThis.LexeraCanvasDom) return globalThis.LexeraCanvasDom;
    throw new Error('LexeraCanvasDom is unavailable');
  }

  function getCanvasStackDropApi() {
    if (typeof globalThis !== 'undefined' && globalThis.LexeraCanvasStackDrop) return globalThis.LexeraCanvasStackDrop;
    throw new Error('LexeraCanvasStackDrop is unavailable');
  }

  function getCanvasLayoutApi() {
    if (typeof globalThis !== 'undefined' && globalThis.LexeraCanvasLayout) return globalThis.LexeraCanvasLayout;
    throw new Error('LexeraCanvasLayout is unavailable');
  }

  function getBoardDeltaApi() {
    if (typeof globalThis !== 'undefined' && globalThis.LexeraBoardDelta) return globalThis.LexeraBoardDelta;
    throw new Error('LexeraBoardDelta is unavailable');
  }

  function getBoardCleanupApi() {
    if (typeof globalThis !== 'undefined' && globalThis.LexeraBoardCleanup) return globalThis.LexeraBoardCleanup;
    throw new Error('LexeraBoardCleanup is unavailable');
  }

  function getDashboardTreeApi() {
    if (typeof globalThis !== 'undefined' && globalThis.LexeraDashboardTree) return globalThis.LexeraDashboardTree;
    throw new Error('LexeraDashboardTree is unavailable');
  }

  function getFoldStateApi() {
    if (typeof globalThis !== 'undefined' && globalThis.LexeraFoldState) return globalThis.LexeraFoldState;
    throw new Error('LexeraFoldState is unavailable');
  }

  function getScrollBehaviorApi() {
    if (typeof globalThis !== 'undefined' && globalThis.LexeraScrollBehavior) return globalThis.LexeraScrollBehavior;
    throw new Error('LexeraScrollBehavior is unavailable');
  }

  function getBoardNavigationApi() {
    if (typeof globalThis !== 'undefined' && globalThis.LexeraBoardNavigation) return globalThis.LexeraBoardNavigation;
    throw new Error('LexeraBoardNavigation is unavailable');
  }

  function getSidebarTreeApi() {
    if (typeof globalThis !== 'undefined' && globalThis.LexeraSidebarTree) return globalThis.LexeraSidebarTree;
    throw new Error('LexeraSidebarTree is unavailable');
  }

  function getBoardCleanupDeps() {
    return {
      stripInternalHiddenTags: stripInternalHiddenTags,
      hasInternalHiddenTag: hasInternalHiddenTag,
      stripLayoutTags: stripLayoutTags,
      getCardTitle: getCardTitle,
      removeEmptyStacksAndRowsInBoard: removeEmptyStacksAndRowsInBoard,
      getArchiveFileContextForBoard: getArchiveFileContextForBoard,
      getBoardDisplayTitle: getBoardDisplayTitle
    };
  }

  function parseCanvasLayoutNumber(value, fallback) {
    var n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
  }

  function parseCanvasParamMap(raw) {
    return getCanvasModeHelpers().parseCanvasParamMap(raw);
  }

  function extractCanvasConnectionSpecs(title) {
    return getCanvasModeHelpers().extractCanvasConnectionSpecs(title);
  }

  function extractCanvasStackTags(title) {
    return getCanvasLayoutApi().extractCanvasStackTags(title);
  }

  function normalizeCanvasAnchorSide(value, fallback) {
    return getCanvasLayoutApi().normalizeCanvasAnchorSide(value, fallback);
  }

  function parseCanvasAnchorOffset(value, size, start, center, end) {
    return getCanvasLayoutApi().parseCanvasAnchorOffset(value, size, start, center, end);
  }

  function getDefaultCanvasConnectionSide(sourceBox, targetBox, role) {
    return getCanvasLayoutApi().getDefaultCanvasConnectionSide(sourceBox, targetBox, role);
  }

  function resolveCanvasConnectionAnchor(box, params, keys, fallbackSide) {
    return getCanvasLayoutApi().resolveCanvasConnectionAnchor(box, params, keys, fallbackSide);
  }

  function canvasSideToVector(side) {
    return getCanvasLayoutApi().canvasSideToVector(side);
  }

  function getCanvasConnectionPath(sourceAnchor, targetAnchor) {
    return getCanvasLayoutApi().getCanvasConnectionPath(sourceAnchor, targetAnchor);
  }

  function getCanvasColumnWidthSpec(value) {
    return getCanvasModeHelpers().getCanvasColumnWidthSpec(value);
  }

  function applyCanvasColumnLayout(colEl, col) {
    getCanvasLayoutApi().applyCanvasColumnLayout(colEl, col);
  }

  function isHorizontalCanvasStackElement(stackEl) {
    return !!stackEl && isCanvasBoardLayout() && normalizeCanvasStackDirection(stackEl.getAttribute('data-stack-dir')) === 'row';
  }

  function getCanvasStackLayoutBox(stack, stackIndex) {
    return getCanvasMathApi().getCanvasStackLayoutBox(stack, stackIndex);
  }

  function getCanvasSceneElement(rowContent, createIfMissing) {
    if (!rowContent || typeof rowContent.querySelector !== 'function') return null;
    var scene = rowContent.querySelector(':scope > .canvas-scene');
    if (!scene && createIfMissing && typeof document !== 'undefined' && document.createElement) {
      scene = document.createElement('div');
      scene.className = 'canvas-scene';
      rowContent.insertBefore(scene, rowContent.firstChild);
    }
    return scene;
  }

  function getCanvasStackElements(rowContent) {
    if (!rowContent || typeof rowContent.querySelectorAll !== 'function') return [];
    var scene = getCanvasSceneElement(rowContent, false);
    if (scene && typeof scene.querySelectorAll === 'function') {
      return scene.querySelectorAll(':scope > .board-stack');
    }
    return rowContent.querySelectorAll(':scope > .board-stack');
  }

  function getCanvasConnectionLayerElement(rowContent) {
    var scene = getCanvasSceneElement(rowContent, false);
    var root = scene || rowContent;
    if (!root || typeof root.querySelector !== 'function') return null;
    return root.querySelector(':scope > .canvas-connection-layer');
  }

  function getCanvasRenderedStackMetrics(stackEl) {
    return getCanvasMathApi().getCanvasRenderedStackMetrics(stackEl);
  }

  function roundUpCanvasUnit(value, step) {
    var numericValue = parseCanvasLayoutNumber(value, 0);
    var numericStep = Math.max(1, parseCanvasLayoutNumber(step, 1));
    return Math.ceil(numericValue / numericStep) * numericStep;
  }

  function resolveCanvasLargestElementSize(stackMetrics) {
    var metrics = Array.isArray(stackMetrics) ? stackMetrics : [];
    var largest = Math.max(CANVAS_DEFAULT_STACK_W, CANVAS_DEFAULT_STACK_H);
    for (var i = 0; i < metrics.length; i++) {
      var metric = metrics[i] || {};
      largest = Math.max(
        largest,
        Math.max(0, parseCanvasLayoutNumber(metric.w, 0)),
        Math.max(0, parseCanvasLayoutNumber(metric.h, 0))
      );
    }
    return largest;
  }

  function resolveCanvasGridStep(stackMetrics, rawValue) {
    return getCanvasMathApi().resolveCanvasGridStep(stackMetrics, rawValue);
  }

  function calculateCanvasSurface(stackMetrics, options) {
    return getCanvasMathApi().calculateCanvasSurface(stackMetrics, options);
  }

  function getNextCanvasStackPlacement(stacks) {
    return getCanvasMathApi().getNextCanvasStackPlacement(stacks);
  }

  function applyDefaultCanvasPlacementToStack(row, stack) {
    if (!isCanvasBoardLayout() || !row || !stack) return stack;
    if (!stack.params) stack.params = {};
    if (stack.params.x != null || stack.params.y != null) return stack;
    var placement = getNextCanvasStackPlacement(row.stacks || []);
    stack.params.x = String(placement.x);
    stack.params.y = String(placement.y);
    return stack;
  }

  function syncCanvasRowConnections(rowContent) {
    if (!rowContent || !rowContent.querySelectorAll) return;
    var existingLayer = getCanvasConnectionLayerElement(rowContent);
    if (existingLayer) existingLayer.remove();

    var stackEls = getCanvasStackElements(rowContent);
    if (!stackEls.length) return;

    var scene = getCanvasSceneElement(rowContent, false);
    var layerRoot = scene || rowContent;

    var stackEntries = [];
    var tagIndex = {};
    for (var i = 0; i < stackEls.length; i++) {
      var stackEl = stackEls[i];
      var title = stackEl.getAttribute('data-stack-title') || '';
      var box = getCanvasRenderedStackMetrics(stackEl);
      var entry = {
        el: stackEl,
        title: title,
        box: box,
        tags: extractCanvasStackTags(title)
      };
      stackEntries.push(entry);
      for (var t = 0; t < entry.tags.length; t++) {
        if (!tagIndex[entry.tags[t]]) tagIndex[entry.tags[t]] = entry;
      }
    }

    var zoom = $canvasZoom || 1;
    var width = Math.max(
      parseCanvasLayoutNumber(scene && scene.style.width, CANVAS_MIN_ROW_WIDTH),
      layerRoot.scrollWidth || 0,
      (rowContent.clientWidth || 0) / zoom
    );
    var height = Math.max(
      parseCanvasLayoutNumber(scene && scene.style.height, CANVAS_MIN_ROW_HEIGHT),
      layerRoot.scrollHeight || 0,
      (rowContent.clientHeight || 0) / zoom
    );
    var svgNs = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'canvas-connection-layer');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('aria-hidden', 'true');

    var defs = document.createElementNS(svgNs, 'defs');
    var marker = document.createElementNS(svgNs, 'marker');
    marker.setAttribute('id', 'canvas-connection-arrow');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('orient', 'auto-start-reverse');
    var markerPath = document.createElementNS(svgNs, 'path');
    markerPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    markerPath.setAttribute('fill', 'context-stroke');
    marker.appendChild(markerPath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    var hasPaths = false;
    for (var s = 0; s < stackEntries.length; s++) {
      var sourceEntry = stackEntries[s];
      var specs = extractCanvasConnectionSpecs(sourceEntry.title);
      for (var c = 0; c < specs.length; c++) {
        var spec = specs[c];
        var targetEntry = tagIndex[spec.targetTag];
        if (!targetEntry || targetEntry === sourceEntry) continue;
        var sourceFallbackSide = getDefaultCanvasConnectionSide(sourceEntry.box, targetEntry.box, 'source');
        var targetFallbackSide = getDefaultCanvasConnectionSide(sourceEntry.box, targetEntry.box, 'target');
        var sourceAnchor = resolveCanvasConnectionAnchor(sourceEntry.box, spec.params, {
          side: 'source',
          aliasSide: 'from',
          position: 'sourcePosition',
          x: spec.params.sourceX != null ? 'sourceX' : 'sx',
          y: spec.params.sourceY != null ? 'sourceY' : 'sy'
        }, sourceFallbackSide);
        var targetAnchor = resolveCanvasConnectionAnchor(targetEntry.box, spec.params, {
          side: 'target',
          aliasSide: 'to',
          position: 'targetPosition',
          x: spec.params.targetX != null ? 'targetX' : 'tx',
          y: spec.params.targetY != null ? 'targetY' : 'ty'
        }, targetFallbackSide);
        var path = document.createElementNS(svgNs, 'path');
        path.setAttribute('class', 'canvas-connection-path');
        path.setAttribute('d', getCanvasConnectionPath(sourceAnchor, targetAnchor));
        path.setAttribute('marker-end', 'url(#canvas-connection-arrow)');
        path.setAttribute('stroke', getTagColor(spec.targetTag));
        svg.appendChild(path);
        hasPaths = true;
      }
    }

    if (!hasPaths) return;
    layerRoot.insertBefore(svg, layerRoot.firstChild);
  }

  function syncCanvasRowBounds(root) {
    if (!isCanvasBoardLayout()) return;
    var container = root && typeof root.querySelectorAll === 'function' ? root : getElColumnsContainer();
    if (!container || !container.querySelectorAll) return;
    var rowContents = container.querySelectorAll('.board-row-content');
    for (var i = 0; i < rowContents.length; i++) {
      var rowContent = rowContents[i];
      var scene = getCanvasSceneElement(rowContent, true);
      var stackEls = getCanvasStackElements(rowContent);
      var metrics = [];
      for (var s = 0; s < stackEls.length; s++) {
        metrics.push(getCanvasRenderedStackMetrics(stackEls[s]));
      }
      var gridMode = normalizeCanvasGridValue(getBoardSettingValue('canvasGrid', '32'));
      var surface = calculateCanvasSurface(metrics);
      var gridStep = resolveCanvasGridStep(metrics, gridMode);
      if (scene) {
        var stableOffsetX = container.__canvasSceneOffsetX != null ? container.__canvasSceneOffsetX : surface.offsetX;
        var stableOffsetY = container.__canvasSceneOffsetY != null ? container.__canvasSceneOffsetY : surface.offsetY;
        container.__canvasSceneOffsetX = stableOffsetX;
        container.__canvasSceneOffsetY = stableOffsetY;
        scene.style.left = stableOffsetX + 'px';
        scene.style.top = stableOffsetY + 'px';
        scene.style.width = surface.width + 'px';
        scene.style.height = surface.height + 'px';
      }
      rowContent.style.setProperty('--canvas-grid-size', Math.max(1, gridStep) + 'px');
      rowContent.style.setProperty('--canvas-grid-color', gridStep > 0 ? 'color-mix(in srgb, var(--border) 34%, transparent)' : 'transparent');
      rowContent.style.setProperty('--canvas-scene-offset-x', (container.__canvasSceneOffsetX || 0) + 'px');
      rowContent.style.setProperty('--canvas-scene-offset-y', (container.__canvasSceneOffsetY || 0) + 'px');
      rowContent.setAttribute('data-canvas-grid', gridMode);
      rowContent.__canvasSurface = surface;
      syncCanvasRowConnections(rowContent);
    }
    updateCanvasScrollIndicators(container);
    scheduleCanvasFocusStacksControlSync(container);
  }

  function scheduleCanvasRowBoundsSync(root) {
    var container = root && typeof root.querySelectorAll === 'function' ? root : getElColumnsContainer();
    if (!container) return;
    if (container.__canvasBoundsSyncScheduled) return;
    container.__canvasBoundsSyncScheduled = true;
    requestAnimationFrame(function () {
      container.__canvasBoundsSyncScheduled = false;
      if (!container.isConnected) return;
      syncCanvasRowBounds(container);
    });
  }

  function updateCanvasScrollIndicators(container) {
    if (!container) container = getElColumnsContainer();
    if (!container) return;
    var hBar = container.querySelector('.canvas-scroll-indicator-h');
    var vBar = container.querySelector('.canvas-scroll-indicator-v');
    if (!hBar || !vBar) return;
    var rowContent = container.querySelector('.board-row-content');
    var surface = rowContent && rowContent.__canvasSurface;
    if (!surface) { hBar.style.opacity = '0'; vBar.style.opacity = '0'; return; }
    var zoom = $canvasZoom || 1;
    var viewW = container.clientWidth || 1;
    var viewH = container.clientHeight || 1;
    var visW = viewW / zoom;
    var visH = viewH / zoom;
    var visLeft = (-surface.offsetX - $canvasPanX) / zoom;
    var visTop = (-surface.offsetY - $canvasPanY) / zoom;
    var totalLeft = Math.min(surface.left, visLeft);
    var totalTop = Math.min(surface.top, visTop);
    var totalW = (Math.max(surface.left + surface.width, visLeft + visW) - totalLeft) || 1;
    var totalH = (Math.max(surface.top + surface.height, visTop + visH) - totalTop) || 1;
    var thumbLeft = (visLeft - totalLeft) / totalW;
    var thumbWidth = visW / totalW;
    var thumbTop = (visTop - totalTop) / totalH;
    var thumbHeight = visH / totalH;
    if (thumbWidth >= 0.98 && thumbHeight >= 0.98) {
      hBar.style.opacity = '0';
      vBar.style.opacity = '0';
      return;
    }
    var barMargin = 8;
    var trackW = viewW - barMargin * 2;
    var trackH = viewH - barMargin * 2;
    hBar.style.left = Math.round(barMargin + thumbLeft * trackW) + 'px';
    hBar.style.width = Math.max(24, Math.round(thumbWidth * trackW)) + 'px';
    vBar.style.top = Math.round(barMargin + thumbTop * trackH) + 'px';
    vBar.style.height = Math.max(24, Math.round(thumbHeight * trackH)) + 'px';
    hBar.style.removeProperty('opacity');
    vBar.style.removeProperty('opacity');
  }

  function ensureCanvasScrollIndicators(container) {
    if (!container) return;
    if (container.querySelector('.canvas-scroll-indicator-h')) return;
    var hBar = document.createElement('div');
    hBar.className = 'canvas-scroll-indicator canvas-scroll-indicator-h';
    var vBar = document.createElement('div');
    vBar.className = 'canvas-scroll-indicator canvas-scroll-indicator-v';
    container.appendChild(hBar);
    container.appendChild(vBar);
  }

  function removeCanvasScrollIndicators() {
    var container = getElColumnsContainer();
    if (!container) return;
    var indicators = container.querySelectorAll('.canvas-scroll-indicator');
    for (var i = 0; i < indicators.length; i++) {
      indicators[i].remove();
    }
  }

  function getCanvasRowContentMetrics(rowContent) {
    return getCanvasMathApi().getCanvasRowContentMetrics(rowContent, {
      zoom: $canvasZoom || 1,
      panX: $canvasPanX,
      panY: $canvasPanY,
      container: getElColumnsContainer()
    });
  }

  function getCanvasPositionFromViewportPoint(rowContent, clientX, clientY, grabOffsetX, grabOffsetY) {
    return getCanvasMathApi().getCanvasPositionFromViewportPoint(
      rowContent,
      clientX,
      clientY,
      grabOffsetX,
      grabOffsetY,
      {
        zoom: $canvasZoom || 1,
        panX: $canvasPanX,
        panY: $canvasPanY,
        container: getElColumnsContainer()
      }
    );
  }

  function getPrimaryCanvasRowContent(container) {
    if (!container || typeof container.querySelector !== 'function') return null;
    return container.querySelector('.board-row-content');
  }

  function collectCanvasStackMetrics(rowContent) {
    var stackEls = getCanvasStackElements(rowContent);
    var metrics = [];
    for (var i = 0; i < stackEls.length; i++) {
      metrics.push(getCanvasRenderedStackMetrics(stackEls[i]));
    }
    return metrics;
  }

  function collectRenderedCanvasStackRects(rowContent) {
    var stackEls = getCanvasStackElements(rowContent);
    var rects = [];
    for (var i = 0; i < stackEls.length; i++) {
      var rect = stackEls[i].getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      rects.push({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      });
    }
    return rects;
  }

  function ensureCanvasFocusStacksControl(container) {
    if (!container || typeof document === 'undefined' || !document.createElement) return null;
    var control = container.querySelector('.canvas-focus-stacks-control');
    if (control) return control;
    control = document.createElement('div');
    control.className = 'canvas-focus-stacks-control';
    control.hidden = true;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'board-action-btn canvas-focus-stacks-btn';
    button.textContent = 'Focus stacks';
    button.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      focusCanvasStacks();
    });
    control.appendChild(button);
    container.appendChild(control);
    return control;
  }

  function removeCanvasFocusStacksControl() {
    var container = getElColumnsContainer();
    if (!container) return;
    var control = container.querySelector('.canvas-focus-stacks-control');
    if (control) control.remove();
  }

  function updateCanvasFocusStacksControl(container) {
    if (!container) container = getElColumnsContainer();
    if (!container) return;
    if (!isCanvasBoardLayout()) {
      removeCanvasFocusStacksControl();
      return;
    }
    var rowContent = getPrimaryCanvasRowContent(container);
    if (!rowContent) {
      removeCanvasFocusStacksControl();
      return;
    }
    var stackRects = collectRenderedCanvasStackRects(rowContent);
    if (!stackRects.length) {
      removeCanvasFocusStacksControl();
      return;
    }
    var control = ensureCanvasFocusStacksControl(container);
    if (!control) return;
    var viewportRect = container.getBoundingClientRect();
    var hasVisibleStack = getCanvasViewportApi().hasAnyVisibleCanvasStack(stackRects, viewportRect);
    control.hidden = hasVisibleStack;
  }

  function scheduleCanvasFocusStacksControlSync(container) {
    if (!container) container = getElColumnsContainer();
    if (!container || container.__canvasFocusStacksControlScheduled) return;
    container.__canvasFocusStacksControlScheduled = true;
    requestAnimationFrame(function () {
      container.__canvasFocusStacksControlScheduled = false;
      if (!container.isConnected) return;
      updateCanvasFocusStacksControl(container);
    });
  }

  function focusCanvasStacks() {
    var container = getElColumnsContainer();
    if (!container || !isCanvasBoardLayout()) return;
    var rowContent = getPrimaryCanvasRowContent(container);
    if (!rowContent) return;
    var stackMetrics = collectCanvasStackMetrics(rowContent);
    if (!stackMetrics.length) return;
    var surface = rowContent.__canvasSurface || calculateCanvasSurface(stackMetrics);
    var focusViewport = getCanvasViewportApi().calculateCanvasFocusViewport(
      stackMetrics,
      {
        width: container.clientWidth || 0,
        height: container.clientHeight || 0
      },
      {
        padding: 36,
        minZoom: 0.25,
        maxZoom: 3,
        surfaceOffsetX: container.__canvasSceneOffsetX != null ? container.__canvasSceneOffsetX : (surface ? surface.offsetX : 0),
        surfaceOffsetY: container.__canvasSceneOffsetY != null ? container.__canvasSceneOffsetY : (surface ? surface.offsetY : 0)
      }
    );
    if (!focusViewport) return;
    applyCanvasZoom(focusViewport.zoom);
    applyCanvasPan(focusViewport.panX, focusViewport.panY);
    scheduleCanvasFocusStacksControlSync(container);
  }

  function applyCanvasPan(panX, panY) {
    $canvasPanX = panX;
    $canvasPanY = panY;
    var container = getElColumnsContainer();
    if (!container) return;
    container.style.setProperty('--canvas-pan-x', panX + 'px');
    container.style.setProperty('--canvas-pan-y', panY + 'px');
    updateCanvasScrollIndicators(container);
    scheduleCanvasFocusStacksControlSync(container);
  }

  function resetCanvasPan() {
    $canvasPanX = 0;
    $canvasPanY = 0;
    var container = getElColumnsContainer();
    if (container) {
      container.style.setProperty('--canvas-pan-x', '0px');
      container.style.setProperty('--canvas-pan-y', '0px');
      delete container.__canvasSceneOffsetX;
      delete container.__canvasSceneOffsetY;
    }
  }

  function applyCanvasZoom(zoom, localOriginX, localOriginY) {
    var container = getElColumnsContainer();
    if (!container) return;
    var oldZoom = $canvasZoom;
    $canvasZoom = zoom;
    container.style.zoom = '';
    container.style.setProperty('--canvas-zoom', String(zoom));
    // Adjust pan to keep the point under the cursor stationary
    // Screen position of canvas point cx: containerLeft + offsetX + panX + cx * zoom
    // So origin relative to transform base: localOriginX - offsetX
    if (localOriginX != null && localOriginY != null && oldZoom !== zoom) {
      var ratio = zoom / oldZoom;
      var offsetX = container.__canvasSceneOffsetX || 0;
      var offsetY = container.__canvasSceneOffsetY || 0;
      var newPanX = $canvasPanX * ratio + (localOriginX - offsetX) * (1 - ratio);
      var newPanY = $canvasPanY * ratio + (localOriginY - offsetY) * (1 - ratio);
      applyCanvasPan(newPanX, newPanY);
    }
    scheduleCanvasRowBoundsSync(container);
    scheduleCanvasFocusStacksControlSync(container);
    showNotification('Canvas Zoom ' + Math.round(zoom * 100) + '%');
  }

  function nudgeCanvasZoom(delta, localOriginX, localOriginY) {
    var next = Math.round(($canvasZoom + delta) * 10000) / 10000;
    if (next < 0.25) next = 0.25;
    if (next > 3) next = 3;
    if (next === $canvasZoom) return;
    applyCanvasZoom(next, localOriginX, localOriginY);
  }

  function canStartCanvasPointerPan(target, button, altKey) {
    return getScrollBehaviorApi().canStartCanvasPointerPan(target, button, altKey);
  }

  document.addEventListener('wheel', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (!activeBoardData) return;
    var target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    if (!target.closest('#board-header, #columns-container')) return;
    if (target.closest('.card-editor-dialog, .export-dialog, .mgmt-panel')) return;
    e.preventDefault();
    if (isCanvasBoardLayout()) {
      var container = getElColumnsContainer();
      var rect = container ? container.getBoundingClientRect() : null;
      var ox = rect ? (e.clientX - rect.left) : undefined;
      var oy = rect ? (e.clientY - rect.top) : undefined;
      nudgeCanvasZoom(getCanvasZoomStep(e.deltaY < 0 ? 0.1 : -0.1), ox, oy);
    } else {
      nudgeUiScale(getUiZoomStep(e.deltaY < 0 ? 0.05 : -0.05));
    }
  }, { passive: false });

  document.addEventListener('wheel', function (e) {
    if (e.ctrlKey || e.metaKey) return;
    if (!activeBoardData) return;
    var container = getElColumnsContainer();
    if (!container) return;
    var target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    if (!target.closest('#columns-container')) return;
    if (target.closest('.card-editor-dialog, .export-dialog, .mgmt-panel')) return;
    if (targetClosest(target, 'input, textarea, select, [contenteditable="true"], .cm-editor, .cm-scroller, .monaco-editor')) {
      return;
    }
    var multiplier = getBoardScrollSpeedMultiplier();
    var deltaX = normalizeWheelDeltaToPixels(e.deltaX, e.deltaMode);
    var deltaY = normalizeWheelDeltaToPixels(e.deltaY, e.deltaMode);
    if (e.shiftKey && !deltaX && deltaY) {
      deltaX = deltaY;
      deltaY = 0;
    }
    if (isCanvasBoardLayout()) {
      if (!shouldHandleBoardViewportWheelEvent(target, container, deltaX, deltaY)) return;
      if (!deltaX && !deltaY) return;
      e.preventDefault();
      var rect = container.getBoundingClientRect();
      var ox = e.clientX - rect.left;
      var oy = e.clientY - rect.top;
      nudgeCanvasZoom(getCanvasZoomStep(deltaY < 0 ? 0.1 : -0.1), ox, oy);
      return;
    }
    if (multiplier === 1) return;
    if (!shouldHandleBoardViewportWheelEvent(target, container, deltaX, deltaY)) return;
    e.preventDefault();
    container.scrollLeft += deltaX * multiplier;
    container.scrollTop += deltaY * multiplier;
  }, { passive: false });

  // --- Canvas pan: middle-mouse or alt+left-mouse drag ---
  var _canvasPan = null;

  document.addEventListener('mousedown', function (e) {
    if (!activeBoardData || !isCanvasBoardLayout()) return;
    var target = e.target;
    if (!canStartCanvasPointerPan(target, e.button, !!e.altKey)) return;
    var container = getElColumnsContainer();
    if (!container) return;
    e.preventDefault();
    _canvasPan = {
      container: container,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: $canvasPanX,
      startPanY: $canvasPanY
    };
    container.classList.add('canvas-panning');
    container.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', function (e) {
    if (!_canvasPan) return;
    var dx = e.clientX - _canvasPan.startX;
    var dy = e.clientY - _canvasPan.startY;
    applyCanvasPan(_canvasPan.startPanX + dx, _canvasPan.startPanY + dy);
  });

  document.addEventListener('mouseup', function (e) {
    if (!_canvasPan) return;
    _canvasPan.container.classList.remove('canvas-panning');
    _canvasPan.container.style.cursor = '';
    _canvasPan = null;
  });

  // Prevent default middle-click auto-scroll behavior in canvas mode
  document.addEventListener('auxclick', function (e) {
    if (e.button === 1 && activeBoardData && isCanvasBoardLayout()) {
      var target = e.target;
      if (target && typeof target.closest === 'function' && target.closest('#columns-container')) {
        e.preventDefault();
      }
    }
  });

  // In canvas mode, prevent any programmatic scrolling (e.g. scrollIntoView, focus)
  // from shifting the viewport — all navigation uses CSS transform pan instead.
  document.addEventListener('scroll', function () {
    if (!isCanvasBoardLayout()) return;
    var container = getElColumnsContainer();
    if (!container) return;
    if (container.scrollLeft !== 0 || container.scrollTop !== 0) {
      container.scrollLeft = 0;
      container.scrollTop = 0;
    }
  }, true);

  function normalizeStickyHeaderMode(rawMode) {
    var mode = String(rawMode || '').trim().toLowerCase();
    if (!mode) return '';
    if (mode === 'column' || mode === 'enabled' || mode === 'true' || mode === 'titleonly' || mode === 'full') return 'top';
    if (mode === 'top' || mode === 'bottom') return mode;
    return '';
  }

  var TAG_VISIBILITY_MODE_MAP = {
    '': 'allexcludinglayout',
    'show': 'all', 'hide': 'none', 'standard': 'allexcludinglayout',
    'custom': 'customonly', 'mentions': 'mentionsonly',
    'all': 'all', 'allexcludinglayout': 'allexcludinglayout',
    'customonly': 'customonly', 'mentionsonly': 'mentionsonly',
    'none': 'none', 'dim': 'dim'
  };

  function normalizeTagVisibilityMode(rawMode) {
    var mode = String(rawMode || '').trim().toLowerCase();
    return TAG_VISIBILITY_MODE_MAP[mode] || 'all';
  }

  function normalizeHtmlCommentRenderMode(rawMode) {
    var mode = String(rawMode || '').trim().toLowerCase();
    if (!mode) return 'hidden';
    if (mode === 'show') return 'text';
    if (mode === 'hide' || mode === 'hidden') return 'hidden';
    if (mode === 'text' || mode === 'dim') return mode;
    return 'text';
  }

  function normalizeArrowKeyFocusScrollMode(rawMode) {
    var mode = String(rawMode || '').trim().toLowerCase();
    if (!mode || mode === 'enabled') return 'nearest';
    if (mode === 'disabled') return 'disabled';
    if (mode === 'center' || mode === 'nearest') return mode;
    return 'nearest';
  }

  function normalizeBoardScrollSpeedValue(rawValue) {
    return getScrollBehaviorApi().normalizeBoardScrollSpeedValue(rawValue);
  }

  function getBoardScrollSpeedMultiplier() {
    return getScrollBehaviorApi().getBoardScrollSpeedMultiplier(getBoardSettingValue, '1');
  }

  function normalizeBoardZoomSpeedValue(rawValue) {
    return getScrollBehaviorApi().normalizeBoardZoomSpeedValue(rawValue);
  }

  function getBoardZoomSpeedMultiplier() {
    return getScrollBehaviorApi().getBoardZoomSpeedMultiplier(getBoardSettingValue, '0.06');
  }

  function getUiZoomStep(delta) {
    return getScrollBehaviorApi().scaleZoomDelta(delta, getBoardSettingValue, { fallback: '1', precision: 4 });
  }

  function getCanvasZoomStep(delta) {
    return getScrollBehaviorApi().scaleZoomDelta(delta, getBoardSettingValue, { fallback: '1', precision: 4 });
  }

  function normalizeWheelDeltaToPixels(delta, deltaMode) {
    return getScrollBehaviorApi().normalizeWheelDeltaToPixels(delta, deltaMode);
  }

  function canScrollableElementConsumeWheelDelta(el, axis, delta) {
    return getScrollBehaviorApi().canScrollableElementConsumeWheelDelta(el, axis, delta);
  }

  function shouldHandleBoardViewportWheelEvent(target, container, deltaX, deltaY) {
    return getScrollBehaviorApi().shouldHandleBoardViewportWheelEvent(target, container, deltaX, deltaY);
  }

  function isLayoutTagName(tagName) {
    return LexeraTagSystem.isLayoutTag(tagName);
  }

  function applyRenderedTagVisibility(root, mode) {
    if (!root || !root.querySelectorAll) return;
    var normalizedMode = normalizeTagVisibilityMode(mode);
    var tags = root.querySelectorAll('.tag[data-tag]');
    for (var i = 0; i < tags.length; i++) {
      var tagEl = tags[i];
      var tagName = tagEl.getAttribute('data-tag') || '';
      var lowerTagName = tagName.toLowerCase();
      var hide = false;
      tagEl.style.display = '';
      tagEl.style.opacity = '';

      if (normalizedMode === 'none' || normalizedMode === 'mentionsonly') {
        hide = true;
      } else if (normalizedMode === 'allexcludinglayout') {
        hide = isLayoutTagName(tagName);
      } else if (normalizedMode === 'customonly') {
        hide = isLayoutTagName(tagName) || !!TAG_COLORS[lowerTagName];
      } else if (normalizedMode === 'dim') {
        tagEl.style.opacity = '0.3';
      }

      if (hide) tagEl.style.display = 'none';
    }
  }

  function applyRenderedHtmlCommentVisibility(root, mode) {
    if (!root || !root.querySelectorAll) return;
    var normalizedMode = normalizeHtmlCommentRenderMode(mode);
    var comments = root.querySelectorAll('.html-comment');
    for (var i = 0; i < comments.length; i++) {
      comments[i].style.display = normalizedMode === 'hidden' ? 'none' : '';
      comments[i].style.opacity = normalizedMode === 'dim' ? '0.3' : '';
    }
  }

  function isValidCssColorValue(value) {
    var probe = document.createElement('span');
    probe.style.color = '';
    probe.style.color = String(value || '').trim();
    return !!probe.style.color;
  }

  function showTagColorPicker(tag, currentColor, x, y) {
    return new Promise(function (resolve) {
      var existing = document.querySelector('.tag-color-picker-popover');
      if (existing) existing.remove();

      var popover = document.createElement('div');
      popover.className = 'tag-color-picker-popover';
      popover.style.left = Math.min(x, window.innerWidth - 240) + 'px';
      popover.style.top = Math.min(y, window.innerHeight - 200) + 'px';

      var titleEl = document.createElement('div');
      titleEl.className = 'tag-color-picker-title';
      titleEl.textContent = 'Color for ' + tag;
      popover.appendChild(titleEl);

      var swatchGrid = document.createElement('div');
      swatchGrid.className = 'tag-color-picker-grid';
      for (var i = 0; i < TAG_PALETTE.length; i++) {
        var swatch = document.createElement('button');
        swatch.className = 'tag-color-picker-swatch';
        swatch.style.background = TAG_PALETTE[i];
        swatch.setAttribute('data-color', TAG_PALETTE[i]);
        if (TAG_PALETTE[i].toLowerCase() === currentColor.toLowerCase()) {
          swatch.classList.add('tag-color-picker-swatch-active');
        }
        swatch.title = TAG_PALETTE[i];
        swatchGrid.appendChild(swatch);
      }
      popover.appendChild(swatchGrid);

      var customRow = document.createElement('div');
      customRow.className = 'tag-color-picker-custom';
      var customInput = document.createElement('input');
      customInput.type = 'text';
      customInput.className = 'tag-color-picker-input';
      customInput.value = currentColor;
      customInput.placeholder = '#hex or CSS color';
      var applyBtn = document.createElement('button');
      applyBtn.className = 'board-action-btn tag-color-picker-apply';
      applyBtn.textContent = 'Apply';
      customRow.appendChild(customInput);
      customRow.appendChild(applyBtn);
      popover.appendChild(customRow);

      document.body.appendChild(popover);

      function cleanup(result) {
        popover.remove();
        document.removeEventListener('mousedown', outsideHandler, true);
        resolve(result);
      }

      function outsideHandler(e) {
        if (!popover.contains(e.target)) cleanup(null);
      }

      swatchGrid.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-color]');
        if (btn) cleanup(btn.getAttribute('data-color'));
      });

      applyBtn.addEventListener('click', function () {
        var val = customInput.value.trim();
        if (val && isValidCssColorValue(val)) {
          cleanup(val);
        } else {
          customInput.classList.add('tag-color-picker-input-invalid');
        }
      });

      customInput.addEventListener('keydown', function (e) {
        customInput.classList.remove('tag-color-picker-input-invalid');
        if (e.key === 'Enter') {
          var val = customInput.value.trim();
          if (val && isValidCssColorValue(val)) {
            cleanup(val);
          } else {
            customInput.classList.add('tag-color-picker-input-invalid');
          }
        }
        if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
      });

      customInput.addEventListener('input', function () {
        customInput.classList.remove('tag-color-picker-input-invalid');
      });

      requestAnimationFrame(function () {
        document.addEventListener('mousedown', outsideHandler, true);
        customInput.focus();
        customInput.select();
      });
    });
  }

  function persistTagColorOverrides() {
    try {
      localStorage.setItem('lexera-tag-color-overrides', JSON.stringify(TAG_COLORS));
    } catch (err) {
      logFrontendIssue('warn', 'tag.color.persist', 'Failed to persist tag color overrides', err);
    }
  }

  function replaceTagTokenInHeaderText(headerText, oldTag, newTag) {
    return LexeraTagSystem.replaceTagInHeader(headerText, oldTag, newTag);
  }

  async function renameTagAcrossBoard(oldTag, newTag) {
    var fromTag = normalizePromptTagToken(oldTag);
    var toTag = normalizePromptTagToken(newTag);
    if (!fromTag || !toTag || fromTag === toTag || !fullBoardData || !activeBoardId) return false;
    var changed = false;
    pushUndo();

    function renameInTarget(kind, indices) {
      var target = resolveTagTarget(kind, indices);
      if (!target) return;
      var parts = splitTagHeaderAndBody(target.text || '');
      var nextHeader = replaceTagTokenInHeaderText(parts.header || '', fromTag, toTag);
      if (nextHeader === parts.header) return;
      target.setText(rebuildTagHeaderAndBody(nextHeader, parts.bodyLines));
      changed = true;
    }

    var rows = Array.isArray(fullBoardData.rows) ? fullBoardData.rows : [];
    for (var r = 0; r < rows.length; r++) {
      renameInTarget('row', { rowIdx: r });
      var stacks = Array.isArray(rows[r].stacks) ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        renameInTarget('stack', { rowIdx: r, stackIdx: s });
        var columns = Array.isArray(stacks[s].columns) ? stacks[s].columns : [];
        for (var c = 0; c < columns.length; c++) {
          var colIndex = columns[c] && columns[c].index != null ? columns[c].index : c;
          renameInTarget('column', { colIndex: colIndex });
          var cards = Array.isArray(columns[c].cards) ? columns[c].cards : [];
          for (var k = 0; k < cards.length; k++) {
            renameInTarget('card', { colIndex: colIndex, cardIndex: k });
          }
        }
      }
    }

    if (!changed) {
      undoStack.pop();
      return false;
    }
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
    return true;
  }

  async function performBoardScopedSearch(query) {
    if (!activeBoardId) return;
    try {
      var response = await LexeraApi.search(query);
      var filtered = Array.isArray(response && response.results)
        ? response.results.filter(function (item) { return item && item.boardId === activeBoardId; })
        : [];
      searchResults = {
        query: response && response.query ? response.query : query,
        results: filtered
      };
      searchMode = true;
      updateHeaderSearchVisibility();
      renderSearchResults();
    } catch (err) {
      logFrontendIssue('warn', 'search.board.tag', 'Board-scoped tag search failed for "' + query + '"', err);
    }
  }

  function showRenderedTagMenu(tagName, x, y) {
    var normalizedTag = normalizePromptTagToken(tagName);
    if (!normalizedTag) return;
    var currentColor = getTagColor(normalizedTag);
    var items = [
      { id: 'filter-current-board', label: 'Filter Current Board By ' + normalizedTag, disabled: !activeBoardId },
      { id: 'search-everywhere', label: 'Search For ' + normalizedTag },
      { separator: true },
      { id: 'rename-tag', label: 'Rename ' + normalizedTag + ' In This Board', disabled: !activeBoardId },
      { id: 'change-color', label: 'Change Color (' + currentColor + ')' },
      { id: 'copy-tag', label: 'Copy ' + normalizedTag },
      { separator: true },
      { id: 'tag-style-role', label: 'Style Role', items: buildTagStyleRoleItems(normalizedTag) }
    ];
    showNativeMenu(items, x, y, 'tag.menu').then(async function (action) {
      if (!action) return;
      if (action === 'filter-current-board') {
        toggleBoardTagFilter(normalizedTag);
        return;
      }
      if (action === 'search-everywhere') {
        await performSearch(normalizedTag);
        return;
      }
      if (action === 'rename-tag') {
        var requestedTag = window.prompt('Rename tag', normalizedTag);
        if (requestedTag == null) return;
        var nextTag = normalizePromptTagToken(requestedTag);
        if (!nextTag) {
          showNotification('Invalid tag');
          return;
        }
        var renamed = await renameTagAcrossBoard(normalizedTag, nextTag);
        if (!renamed) showNotification('Tag not found in this board');
        return;
      }
      if (action === 'change-color') {
        var pickedColor = await showTagColorPicker(normalizedTag, currentColor, x, y);
        if (pickedColor == null) return;
        TAG_COLORS[normalizedTag] = pickedColor.trim();
        persistTagColorOverrides();
        renderMainView();
        return;
      }
      if (action === 'copy-tag') {
        copyTextToClipboard(normalizedTag, 'Tag copied to clipboard', 'Failed to copy tag');
        return;
      }
      if (action.indexOf('tag-style-role:') === 0) {
        var newRole = action.substring('tag-style-role:'.length);
        var rawTag = normalizedTag.charAt(0) === '#' ? normalizedTag.substring(1) : normalizedTag;
        var catKey = getTagCategoryKey(rawTag);
        if (!catKey) {
          showNotification('Tag "' + normalizedTag + '" has no known category');
          return;
        }
        setUserCategoryRole(catKey, newRole || null);
        renderMainView();
        showNotification('Style role for "' + catKey + '" set to ' + (newRole || 'none'));
        return;
      }
    }).catch(function (err) {
      logFrontendIssue('warn', 'tag.menu', 'Failed to open rendered tag menu for ' + normalizedTag, err);
    });
  }

  function attachRenderedTagInteractions(root) {
    if (!root || root.__tagInteractionsBound) return;
    root.__tagInteractionsBound = true;
    root.addEventListener('click', function (e) {
      var tagEl = e.target && e.target.closest ? e.target.closest('.tag[data-tag]') : null;
      if (!tagEl || !root.contains(tagEl)) return;
      e.preventDefault();
      e.stopPropagation();
      showRenderedTagMenu(tagEl.getAttribute('data-tag') || '', e.clientX, e.clientY);
    });
    root.addEventListener('contextmenu', function (e) {
      var tagEl = e.target && e.target.closest ? e.target.closest('.tag[data-tag]') : null;
      if (!tagEl || !root.contains(tagEl)) return;
      e.preventDefault();
      e.stopPropagation();
      showRenderedTagMenu(tagEl.getAttribute('data-tag') || '', e.clientX, e.clientY);
    });
  }

  function normalizeColumnWidth(rawValue) {
    var value = String(rawValue || '').trim();
    if (!value) return '';
    if (/^\d+(\.\d+)?$/.test(value)) value += 'px';

    var pxMatch = value.match(/^(\d+(?:\.\d+)?)px$/i);
    if (pxMatch) {
      var px = parseFloat(pxMatch[1]);
      if (!isFinite(px)) return '';
      px = Math.max(120, Math.min(1200, px));
      return px + 'px';
    }

    if (/^\d+(\.\d+)?(rem|em|ch|vw|vh)$/i.test(value)) return value;
    return '';
  }

  function clearLayoutLockStyles() {
    var nodes = getElColumnsContainer().querySelectorAll('.board-row, .board-stack, .column');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || !el.style) continue;
      if (el.classList.contains('layout-locked')) continue;
      el.style.width = '';
      el.style.minWidth = '';
      el.style.maxWidth = '';
      el.style.height = '';
      el.style.minHeight = '';
      el.style.maxHeight = '';
    }
  }

  function syncRenderedRowWidths() {
    if (!getElColumnsContainer()) return;
    var rows = getElColumnsContainer().querySelectorAll('.board-row');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || row.classList.contains('layout-locked') || row.classList.contains('folded')) {
        var foldedContent = row ? row.querySelector(':scope > .board-row-content') : null;
        if (foldedContent && foldedContent.style) foldedContent.style.width = '';
        continue;
      }

      var content = row.querySelector(':scope > .board-row-content');
      if (!content || content.classList.contains('layout-locked')) continue;

      content.style.width = '';

      var stacks = content.querySelectorAll(':scope > .board-stack');
      var contentWidth = 0;

      if (stacks.length > 0) {
        var maxRight = 0;
        for (var s = 0; s < stacks.length; s++) {
          var stack = stacks[s];
          var right = stack.offsetLeft + stack.offsetWidth;
          if (right > maxRight) maxRight = right;
        }
        var contentStyle = window.getComputedStyle(content);
        var padRight = parseFloat(contentStyle.paddingRight || '0') || 0;
        contentWidth = Math.max(0, Math.ceil(maxRight + padRight));
      } else {
        var empty = content.querySelector(':scope > .board-level-empty');
        var emptyStyle = window.getComputedStyle(content);
        var padLeft = parseFloat(emptyStyle.paddingLeft || '0') || 0;
        var padRightEmpty = parseFloat(emptyStyle.paddingRight || '0') || 0;
        contentWidth = Math.max(120, Math.ceil((empty ? empty.offsetWidth : 0) + padLeft + padRightEmpty));
      }

      if (contentWidth > 0) {
        content.style.width = contentWidth + 'px';
      }
    }
  }

  function getBoardSettingValue(key, fallback) {
    if (!fullBoardData || !fullBoardData.boardSettings) return fallback;
    var value = fullBoardData.boardSettings[key];
    return value == null || value === '' ? fallback : value;
  }

  function getHtmlContentRenderMode() {
    var mode = getBoardSettingValue('htmlContentRenderMode', 'html');
    return mode === 'html' ? 'html' : 'text';
  }

  function resolveActiveBoardColor(settings) {
    settings = settings || {};
    var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) return settings.boardColorDark || settings.boardColor || '';
    return settings.boardColorLight || settings.boardColor || '';
  }

  function applyBoardSettings() {
    var container = getElColumnsContainer();
    var cssProps = [
      '--board-column-width', '--board-font-size', '--board-font-family',
      '--board-bg', '--board-color', '--board-color-dark', '--board-color-light',
      '--board-row-height', '--board-max-row-height', '--board-card-min-height',
      '--board-layout-rows', '--board-row-gap', '--board-stack-gap',
      '--board-column-gap', '--board-inner-padding'
    ];
    for (var i = 0; i < cssProps.length; i++) {
      container.style.removeProperty(cssProps[i]);
    }
    // Reset class-based settings
    container.classList.remove('sticky-headers', 'sticky-headers-top', 'sticky-headers-bottom');
    container.classList.remove('html-comments-hide', 'html-comments-dim');
    var wasCanvas = container.classList.contains('layout-canvas');
    container.classList.remove('layout-spacious', 'layout-rows-fixed', 'layout-canvas');
    var willBeCanvas = getCurrentBoardLayout() === 'canvas';
    // Reset canvas zoom and pan only when actually leaving canvas mode
    if (wasCanvas && !willBeCanvas) {
      if ($canvasZoom !== 1) applyCanvasZoom(1);
      resetCanvasPan();
      removeCanvasScrollIndicators();
      removeCanvasFocusStacksControl();
    }
    container.removeAttribute('data-layout-preset');
    currentTagVisibilityMode = 'allexcludinglayout';
    currentArrowKeyFocusScrollMode = 'nearest';
    currentHtmlCommentRenderMode = 'hidden';

    if (!fullBoardData || !fullBoardData.boardSettings) {
      container.classList.add('html-comments-hide');
      return;
    }
    var s = fullBoardData.boardSettings;
    var normalizedColWidth = normalizeColumnWidth(s.columnWidth);
    if (normalizedColWidth) container.style.setProperty('--board-column-width', normalizedColWidth);
    if (s.fontSize) container.style.setProperty('--board-font-size', s.fontSize);
    if (s.fontFamily) container.style.setProperty('--board-font-family', s.fontFamily);
    if (s.rowHeight) container.style.setProperty('--board-row-height', s.rowHeight);
    if (s.maxRowHeight) container.style.setProperty('--board-max-row-height', s.maxRowHeight + 'px');
    if (s.cardMinHeight) container.style.setProperty('--board-card-min-height', s.cardMinHeight);
    var normalizedWhitespace = normalizeWhitespaceValue(s.whitespace);
    if (normalizedWhitespace) {
      var whitespacePx = parseFloat(normalizedWhitespace);
      if (isFinite(whitespacePx) && whitespacePx > 0) {
        var roundedWhitespaceScale = Math.round((whitespacePx / 16) * 1000) / 1000;
        container.style.setProperty('--board-row-gap', 'calc(12px * var(--ui-scale) * ' + roundedWhitespaceScale + ')');
        container.style.setProperty('--board-stack-gap', 'calc(10px * var(--ui-scale) * ' + roundedWhitespaceScale + ')');
        container.style.setProperty('--board-column-gap', 'calc(6px * var(--ui-scale) * ' + roundedWhitespaceScale + ')');
        container.style.setProperty('--board-inner-padding', 'calc(8px * var(--ui-scale) * ' + roundedWhitespaceScale + ')');
      }
    }
    var layoutRows = Math.max(1, Math.min(6, parseInt(s.layoutRows, 10) || 1));
    container.style.setProperty('--board-layout-rows', String(layoutRows));
    if (layoutRows > 1) container.classList.add('layout-rows-fixed');
    currentTagVisibilityMode = normalizeTagVisibilityMode(s.tagVisibility);
    var stickyMode = normalizeStickyHeaderMode(s.stickyStackMode);
    if (stickyMode) container.classList.add('sticky-headers-' + stickyMode);
    if (stickyMode === 'top') container.classList.add('sticky-headers'); // legacy alias
    currentHtmlCommentRenderMode = normalizeHtmlCommentRenderMode(s.htmlCommentRenderMode);
    if (currentHtmlCommentRenderMode === 'hidden') container.classList.add('html-comments-hide');
    if (currentHtmlCommentRenderMode === 'dim') container.classList.add('html-comments-dim');
    currentArrowKeyFocusScrollMode = normalizeArrowKeyFocusScrollMode(s.arrowKeyFocusScroll);
    if (currentArrowKeyFocusScrollMode !== 'disabled') container.classList.add('focus-scroll-mode');
    if (s.layoutSpacing === 'spacious' || s.layoutPreset === 'spacious') container.classList.add('layout-spacious');
    if (s.layoutPreset) container.setAttribute('data-layout-preset', s.layoutPreset);
    if (willBeCanvas) {
      container.classList.add('layout-canvas');
      ensureCanvasScrollIndicators(container);
    }

    var boardColor = resolveActiveBoardColor(s);
    if (boardColor) container.style.setProperty('--board-color', boardColor);
    if (s.boardColorDark || s.boardColor) container.style.setProperty('--board-color-dark', s.boardColorDark || s.boardColor);
    if (s.boardColorLight || s.boardColor) container.style.setProperty('--board-color-light', s.boardColorLight || s.boardColor);
  }

  /**
   * Build a single column element (header, cards, footer) — shared by both formats.
   */
  function buildColumnElement(col, foldedCols, collapsedCards, rowIdx, stackIdx, colLocalIdx, colFullIdx) {
    var isCanvasLayout = isCanvasBoardLayout();
    var displayTitle = stripLayoutTags(col.title);
    var colFoldKey = getColumnFoldKey(col, rowIdx, stackIdx, colLocalIdx, colFullIdx);

    var colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.setAttribute('data-col-title', col.title);
    colEl.setAttribute('data-fold-key', colFoldKey);
    if (typeof rowIdx === 'number') colEl.setAttribute('data-row-index', rowIdx.toString());
    if (typeof stackIdx === 'number') colEl.setAttribute('data-stack-index', stackIdx.toString());
    if (typeof colLocalIdx === 'number') colEl.setAttribute('data-col-local-index', colLocalIdx.toString());
    if (!isCanvasLayout && hasSavedFoldMatch(foldedCols, colFoldKey, col.title)) {
      colEl.classList.add('folded');
    }
    var colLayout = getColumnLayoutTags(col.title);
    if (colLayout.wipLimit > 0 && col.cards.length > colLayout.wipLimit) {
      colEl.classList.add('wip-exceeded');
    }

    // Check if column has include source
    var fullCol = getFullColumn(col.index);
    var includeIndicator = '';
    if (fullCol && fullCol.includeSource) {
      includeIndicator =
        '<button class="column-include-badge" type="button" data-include-path="' + escapeAttr(fullCol.includeSource.rawPath || '') + '"' +
        ' title="Open include: ' + escapeAttr(fullCol.includeSource.rawPath || '') + '">&#128279;</button>';
    }

    var header = document.createElement('div');
    header.className = 'column-header';
    header.innerHTML =
      (isCanvasLayout ? '' : '<button class="column-fold-btn fold-btn" title="Fold column">\u25B6</button>') +
      buildCreationEntityDragIconHtml('column', ['title="Drag to move column"']) +
      '<span class="column-title">' + renderTitleInline(displayTitle, activeBoardId, { allowIncludeDirectives: true }) + '</span>' +
      includeIndicator +
      '<span class="column-count">' + col.cards.length + (colLayout.wipLimit > 0 ? '/' + colLayout.wipLimit : '') + '</span>' +
      '<span class="column-header-actions">' +
        '<button class="column-menu-btn burger-menu-btn" title="Column options">' + BURGER_MENU_ICON_HTML + '</button>' +
      '</span>';
    (function (columnEl, colIdx, rIdx, sIdx, cIdx) {
      header.addEventListener('click', function (e) {
        var includeBadge = targetClosest(e.target, '.column-include-badge[data-include-path]');
        if (includeBadge) {
          e.preventDefault();
          e.stopPropagation();
          var includePath = includeBadge.getAttribute('data-include-path') || '';
          if (!includePath) return;
          if (e.altKey) openBoardFileInSystem(activeBoardId, includePath);
          else showBoardFilePreview(activeBoardId, includePath);
          return;
        }
        if (targetClosest(e.target, '.column-title')) return;
        if (targetClosest(e.target, 'button, .drag-grip, .column-rename-input')) return;
        if (!e.altKey) return;
        e.stopPropagation();
        toggleColumnFoldElement(columnEl, true);
      });
      var foldBtn = header.querySelector('.column-fold-btn');
      if (foldBtn) {
        foldBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          toggleColumnFoldElement(columnEl, !!e.altKey);
        });
      }
      header.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showColumnContextMenu(e.clientX, e.clientY, colIdx, {
          rowIdx: rIdx,
          stackIdx: sIdx,
          colLocalIdx: cIdx
        });
      });
      header.querySelector('.column-menu-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        var rect = this.getBoundingClientRect();
        showColumnContextMenu(rect.right, rect.bottom, colIdx, {
          rowIdx: rIdx,
          stackIdx: sIdx,
          colLocalIdx: cIdx
        });
      });
    })(colEl, col.index, rowIdx, stackIdx, colLocalIdx);
    colEl.appendChild(header);

    var cardsEl = document.createElement('div');
    cardsEl.className = 'column-cards';
    cardsEl.setAttribute('data-col-index', col.index.toString());
    for (var j = 0; j < col.cards.length; j++) {
      var card = col.cards[j];
      var cardId = String(card.id);
      var cardEl = document.createElement('div');
      cardEl.className = 'card' + (card.checked ? ' checked' : '');
      cardEl.setAttribute('data-col-index', col.index.toString());
      cardEl.setAttribute('data-card-index', j.toString());
      cardEl.setAttribute('data-card-id', cardId);
      if (card.kid) cardEl.setAttribute('data-card-kid', card.kid);
      var isCollapsed = !isCanvasLayout && collapsedCards.indexOf(cardId) !== -1;
      if (isCollapsed) cardEl.classList.add('collapsed');
      // Canvas layout: apply card span param
      var cardParams = card.params || {};
      if (cardParams.span) cardEl.setAttribute('data-card-span', cardParams.span);

      // --- Card Header Row ---
      var headerRow = document.createElement('div');
      headerRow.className = 'card-header';

      var toggle = null;
      if (!isCanvasLayout) {
        toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'card-collapse-toggle fold-btn' + (isCollapsed ? '' : ' expanded');
        toggle.textContent = '\u25B6';
        headerRow.appendChild(toggle);
      }

      var dragHandle = document.createElement('div');
      dragHandle.className = 'card-drag-handle entity-drag-icon entity-drag-icon-card';
      dragHandle.innerHTML = getCreationEntityDragIconSvg('card');
      dragHandle.title = 'Drag to move card';
      headerRow.appendChild(dragHandle);

      var titleContainer = document.createElement('div');
      titleContainer.className = 'card-title-container';
      var titleDisplay = document.createElement('div');
      titleDisplay.className = 'card-title-display';
      titleDisplay.innerHTML = renderTitleInline(getCardTitle(getIncludeResolvedContent(card.content, col.index)), activeBoardId);
      titleContainer.appendChild(titleDisplay);
      headerRow.appendChild(titleContainer);
      if (toggle) {
        (function (toggleEl, el) {
          toggleEl.addEventListener('click', function (e) {
            e.stopPropagation();
            if (e.altKey) {
              // Alt+click: fold/unfold all OTHER cards in the same column (not the clicked one)
              var column = el.closest('.column');
              if (column) {
                var anyOtherExpanded = false;
                var allCards = column.querySelectorAll('.card');
                for (var ai = 0; ai < allCards.length; ai++) {
                  if (allCards[ai] === el) continue;
                  if (!allCards[ai].classList.contains('collapsed')) { anyOtherExpanded = true; break; }
                }
                for (var ai = 0; ai < allCards.length; ai++) {
                  if (allCards[ai] === el) continue;
                  allCards[ai].classList.toggle('collapsed', anyOtherExpanded);
                  var t = allCards[ai].querySelector('.card-collapse-toggle');
                  if (t) t.classList.toggle('expanded', !anyOtherExpanded);
                }
              }
            } else {
              el.classList.toggle('collapsed');
              toggleEl.classList.toggle('expanded');
            }
            saveCardCollapseState(activeBoardId);
          });
        })(toggle, cardEl);
      }

      var cardDueDate = extractFirstTemporalDateValue(card.content || '');
      if (cardDueDate) {
        var dueBadge = document.createElement('span');
        var todayStr = formatDate(new Date());
        var isOverdue = cardDueDate < todayStr;
        var isDueToday = cardDueDate === todayStr;
        dueBadge.className = 'card-due-badge' + (isOverdue ? ' overdue' : '') + (isDueToday ? ' due-today' : '');
        dueBadge.textContent = cardDueDate;
        dueBadge.title = isOverdue ? 'Overdue' : isDueToday ? 'Due today' : 'Due ' + cardDueDate;
        headerRow.appendChild(dueBadge);
      }

      var checkboxStats = countCheckboxes(card.content || '');
      if (checkboxStats.total > 0) {
        var progressBadge = document.createElement('span');
        progressBadge.className = 'card-progress-badge' + (checkboxStats.checked === checkboxStats.total ? ' complete' : '');
        progressBadge.textContent = checkboxStats.checked + '/' + checkboxStats.total;
        progressBadge.title = checkboxStats.checked + ' of ' + checkboxStats.total + ' tasks completed';
        headerRow.appendChild(progressBadge);
      }

      var menuBtn = document.createElement('button');
      menuBtn.className = 'card-menu-btn burger-menu-btn';
      menuBtn.innerHTML = BURGER_MENU_ICON_HTML;
      menuBtn.title = 'Card options';
      headerRow.appendChild(menuBtn);

      cardEl.appendChild(headerRow);

      // --- Card Content Body ---
      var contentBody = document.createElement('div');
      contentBody.className = 'card-content';
      contentBody.innerHTML = renderCardContent(getIncludeResolvedContent(card.content, col.index), activeBoardId, null, {
        skipFirstLineTagStyle: true
      });
      cardEl.appendChild(contentBody);

      (function (el, ci, cj, btn) {
        el.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          e.stopPropagation();
          showCardContextMenu(e.clientX, e.clientY, ci, cj);
        });
        el.addEventListener('change', function (e) {
          if (!e.target.classList.contains('card-checkbox')) return;
          e.stopPropagation();
          toggleCheckbox(ci, cj, parseInt(e.target.getAttribute('data-line'), 10), e.target.checked);
        });
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var rect = btn.getBoundingClientRect();
          showCardContextMenu(rect.right, rect.bottom, ci, cj);
        });
      })(cardEl, col.index, j, menuBtn);
      applyTagStyleToEntity(cardEl, getCardContainerStyleSource(card.content || ''));
      cardsEl.appendChild(cardEl);
    }
    colEl.appendChild(cardsEl);

    var showInlineAddComposer = addCardColumn === col.index;
    var showEmptyColumnAddButton = col.cards.length === 0;
    var footer = null;
    if (showInlineAddComposer || showEmptyColumnAddButton) {
      footer = document.createElement('div');
      footer.className = 'column-footer';

      if (showInlineAddComposer) {
        footer.innerHTML =
          '<textarea class="add-card-input" placeholder="Card content..." autofocus></textarea>' +
          '<div class="add-card-actions">' +
          '<button class="btn-small btn-primary add-card-submit">Add</button>' +
          '<button class="btn-small btn-cancel add-card-cancel">Cancel</button>' +
          '</div>';

        (function (colIndex) {
          var textarea = footer.querySelector('.add-card-input');
          footer.querySelector('.add-card-submit').addEventListener('click', function () {
            submitCard(colIndex, textarea.value);
          });
          footer.querySelector('.add-card-cancel').addEventListener('click', function () {
            addCardColumn = null;
            renderColumns();
          });
          textarea.addEventListener('keydown', function (e) {
            if (handleTextareaTabIndent(e, textarea)) return;
            if (e.key === 'Enter' && e.altKey) {
              e.preventDefault();
              e.stopPropagation();
              addCardColumn = null;
              renderColumns();
              return;
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              submitCard(colIndex, textarea.value);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              addCardColumn = null;
              renderColumns();
            }
          });
          requestAnimationFrame(function () { textarea.focus(); });
        })(col.index);
      } else {
        var cardSource = renderCreationSource('card', { colIndex: col.index }, {
          btnClass: 'add-card-btn',
          btnText: '+ Add card',
          wrapperClass: 'creation-source-card'
        });
        footer.appendChild(cardSource);
      }

      colEl.appendChild(footer);
    }
    applyTagStyleToEntity(colEl, col.title || '');
    return colEl;
  }

  function renderColumns() {
    try {
    vsTeardown();
    unfocusCard();
    // Defensive cleanup: stale drag artifacts can inflate row widths.
    cleanupPtrDrag();
    getElColumnsContainer().innerHTML = '';
    if (!activeBoardData) return;

    getElColumnsContainer().classList.add('new-format');
    renderNewFormatBoard();
    var isCanvas = isCanvasBoardLayout();
    if (isCanvas) {
      syncCanvasRowBounds(getElColumnsContainer());
      requestAnimationFrame(function () {
        syncCanvasRowBounds(getElColumnsContainer());
      });
    } else {
      clearLayoutLockStyles();
      syncRenderedRowWidths();
      requestAnimationFrame(syncRenderedRowWidths);
    }

    enhanceEmbeddedContent(getElColumnsContainer());
    applyRenderedHtmlCommentVisibility(getElColumnsContainer(), currentHtmlCommentRenderMode);
    applyRenderedTagVisibility(getElColumnsContainer(), currentTagVisibilityMode);
    attachRenderedTagInteractions(getElColumnsContainer());

    syncSidebarToView();
    updateCardEditingIndicators();
    refreshBoardHeaderActionStates();

    vsActivate();
    } catch (err) {
      logFrontendIssue('error', 'render', 'Failed to render columns', err);
    }
  }

  /**
   * Render board with rows → stacks → columns hierarchy.
   */
  function renderNewFormatBoard() {
    var rows = activeBoardData.rows;
    var isCanvasLayout = isCanvasBoardLayout();
    var foldedCols = getFoldedColumns(activeBoardId);
    var foldedRows = getFoldedItems(activeBoardId, 'row');
    var foldedStacks = getFoldedItems(activeBoardId, 'stack');
    var collapsedCards = isCanvasLayout ? [] : getCollapsedCards(activeBoardId, rows);

    if (!rows || rows.length === 0) {
      var emptyRows = document.createElement('div');
      emptyRows.className = 'board-level-empty board-level-empty-rows';
      emptyRows.appendChild(renderCreationSource('row', {}, { btnText: '+ Add row' }));
      getElColumnsContainer().appendChild(emptyRows);
      return;
    }

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var rowStacks = Array.isArray(row.stacks) ? row.stacks : [];
      var rowFoldKey = getRowFoldKey(row, r);
      var rowEl = document.createElement('div');
      rowEl.className = 'board-row';
      rowEl.setAttribute('data-row-title', row.title);
      rowEl.setAttribute('data-fold-key', rowFoldKey);
      rowEl.setAttribute('data-row-index', r.toString());
      if (hasSavedFoldMatch(foldedRows, rowFoldKey, row.title)) {
        rowEl.classList.add('folded');
      }
      var rowHeightTag = getElementSizeTag(row.title, 'height');
      if (rowHeightTag > 0) rowEl.style.setProperty('--board-row-height', rowHeightTag + 'px');
      // Canvas layout: apply inline params for row height
      var rowParams = row.params || {};
      if (rowParams.h) rowEl.style.setProperty('--board-row-height', rowParams.h + 'px');

      // Row header
      var rowHeader = document.createElement('div');
      rowHeader.className = 'board-row-header';
      var rowTitle = typeof row.title === 'string' ? row.title : '';
      var rowDisplayTitle = stripLayoutTags(rowTitle);
      var totalCards = 0;
      for (var si = 0; si < rowStacks.length; si++) {
        var cardCols = Array.isArray(rowStacks[si].columns) ? rowStacks[si].columns : [];
        for (var ci = 0; ci < cardCols.length; ci++) {
          var cards = Array.isArray(cardCols[ci].cards) ? cardCols[ci].cards : [];
          totalCards += cards.length;
        }
      }
      rowHeader.innerHTML =
        '<button class="row-fold-btn fold-btn" title="Fold row">\u25B6</button>' +
        buildCreationEntityDragIconHtml('row', ['title="Drag to move row"']) +
        '<span class="board-row-title">' + escapeHtml(rowDisplayTitle.length > 40 ? rowDisplayTitle.slice(0, 40) + '\u2026' : rowDisplayTitle) + '</span>' +
        '<span class="board-row-count">' + totalCards + '</span>' +
        '<span class="row-header-actions">' +
          '<button class="row-menu-btn burger-menu-btn" title="Row options">' + BURGER_MENU_ICON_HTML + '</button>' +
        '</span>';
      (function (el, rowIdx) {
        rowHeader.addEventListener('click', function (e) {
          if (targetClosest(e.target, '.board-row-title')) return;
          if (targetClosest(e.target, 'button, .drag-grip')) return;
          if (!e.altKey) return;
          e.stopPropagation();
          toggleRowFoldElement(el, true);
        });
        rowHeader.querySelector('.row-fold-btn').addEventListener('click', function (e) {
          e.stopPropagation();
          toggleRowFoldElement(el, !!e.altKey);
        });
        rowHeader.querySelector('.row-menu-btn').addEventListener('click', function (e) {
          e.stopPropagation();
          var rect = this.getBoundingClientRect();
          showRowContextMenu(rect.right, rect.bottom, rowIdx);
        });
        rowHeader.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          e.stopPropagation();
          showRowContextMenu(e.clientX, e.clientY, rowIdx);
        });
        // Row drag is handled by the pointer-based drag system (mousedown on getElColumnsContainer())
      })(rowEl, r);
      rowEl.appendChild(rowHeader);

      // Row DnD handled by the pointer-based drag system

      // Row content container
      var rowContent = document.createElement('div');
      rowContent.className = 'board-row-content';

      // Column-to-row drop handled by the pointer-based drag system

      if (rowStacks.length === 0) {
        var emptyStacks = document.createElement('div');
        emptyStacks.className = 'board-level-empty board-level-empty-stacks';
        (function (rowIdx) {
          emptyStacks.appendChild(renderCreationSource('stack', { rowIdx: rowIdx }, { btnText: '+ Add stack' }));
        })(r);
        rowContent.appendChild(emptyStacks);
      }

      if (isCanvasLayout) {
        (function (rowIdx, contentEl) {
          contentEl.addEventListener('contextmenu', function (e) {
            if (!isCanvasBoardLayout()) return;
            if (targetClosest(
              e.target,
              '.board-stack, .column, .card, button, input, textarea, select, a, [contenteditable="true"], .cm-editor, .cm-scroller, .monaco-editor, .canvas-focus-stacks-control'
            )) {
              return;
            }
            var canvasPosition = getCanvasPositionFromViewportPoint(contentEl, e.clientX, e.clientY, 0, 0);
            if (!canvasPosition || !isFinite(canvasPosition.x) || !isFinite(canvasPosition.y)) return;
            e.preventDefault();
            e.stopPropagation();
            showCanvasBackgroundContextMenu(e.clientX, e.clientY, rowIdx, {
              x: Math.round(canvasPosition.x),
              y: Math.round(canvasPosition.y)
            });
          });
        })(r, rowContent);
      }

      for (var s = 0; s < rowStacks.length; s++) {
        var stack = rowStacks[s];
        var stackFoldKey = getStackFoldKey(stack, r, s);
        var stackEl = document.createElement('div');
        stackEl.className = 'board-stack';
        stackEl.setAttribute('data-stack-title', stack.title);
        stackEl.setAttribute('data-fold-key', stackFoldKey);
        stackEl.setAttribute('data-row-index', r.toString());
        stackEl.setAttribute('data-stack-index', s.toString());
        var stackColumnEntries = getDisplayOrderedColumnEntries(stack.columns || []);
        var isEmptyStack = stackColumnEntries.length === 0;
        if (!isCanvasLayout && hasSavedFoldMatch(foldedStacks, stackFoldKey, stack.title)) {
          stackEl.classList.add('folded');
        }
        var stackWidthTag = getElementSizeTag(stack.title, 'width');
        if (!isCanvasLayout && stackWidthTag > 0) stackEl.style.setProperty('--board-column-width', stackWidthTag + 'px');

        // Canvas layout: apply position/size params (canvas-only)
        var stackParams = stack.params || {};
        if (isCanvasLayout) {
        var canvasBox = getCanvasStackLayoutBox(stack, s);
          stackEl.style.left = Math.round(canvasBox.x) + 'px';
          stackEl.style.top = Math.round(canvasBox.y) + 'px';
          stackEl.style.width = canvasBox.w + 'px';
          stackEl.style.removeProperty('height');
          stackEl.style.zIndex = String(10 + s);
          stackEl.setAttribute('data-stack-dir', normalizeCanvasStackDirection(stackParams.dir));
        }

        // Canvas mode: persist resize when user drags the CSS resize handle
        if (isCanvasLayout) {
          (function (el, rIdx, sIdx) {
            var resizeTimer = null;
            var layoutSyncFrame = 0;
            var lastObservedWidth = null;
            var observer = new ResizeObserver(function (entries) {
              var ptrDrag = DragDropHandlers ? DragDropHandlers.getPtrDrag() : null;
              if (ptrDrag) return; // ignore resize during drag
              var entry = entries[0];
              if (!entry) return;
              var newW = Math.round(entry.contentRect.width);
              if (newW === lastObservedWidth) return;
              lastObservedWidth = newW;
              if (!layoutSyncFrame) {
                layoutSyncFrame = requestAnimationFrame(function () {
                  layoutSyncFrame = 0;
                  scheduleCanvasRowBoundsSync(getElColumnsContainer());
                });
              }
              clearTimeout(resizeTimer);
              resizeTimer = setTimeout(function () {
                var fullStack = findFullDataStack(rIdx, sIdx);
                if (!fullStack) return;
                var curW = fullStack.params && fullStack.params.w ? parseInt(fullStack.params.w, 10) : 0;
                if (Math.abs(newW - curW) < 5) return;
                pushUndo();
                if (!fullStack.params) fullStack.params = {};
                fullStack.params.w = String(newW);
                if (Object.prototype.hasOwnProperty.call(fullStack.params, 'h')) delete fullStack.params.h;
                persistBoardMutation({ skipRender: true });
              }, 400);
            });
            observer.observe(el);
          })(stackEl, r, s);
        }

        // Stack header
        var stackHeader = document.createElement('div');
        stackHeader.className = 'board-stack-header';
        var stackColCount = stackColumnEntries.length;
        var stackDisplayTitle = stripLayoutTags(stack.title || '');
        stackHeader.innerHTML =
          (isCanvasLayout ? '' : '<button class="stack-fold-btn fold-btn" title="Fold stack">\u25B6</button>') +
          buildCreationEntityDragIconHtml('stack', ['title="Drag to move stack"']) +
          '<span class="board-stack-title">' + (stackDisplayTitle ? escapeHtml(stackDisplayTitle.length > 40 ? stackDisplayTitle.slice(0, 40) + '\u2026' : stackDisplayTitle) : '&nbsp;') + '</span>' +
          '<span class="board-stack-count">' + stackColCount + '</span>' +
          '<span class="stack-header-actions">' +
            '<button class="stack-menu-btn burger-menu-btn" title="Stack options">' + BURGER_MENU_ICON_HTML + '</button>' +
            (isEmptyStack ? '<button class="stack-delete-btn" title="Delete empty stack">\u00d7</button>' : '') +
          '</span>';
        (function (el, rIdx, sIdx) {
          var deleteBtn = stackHeader.querySelector('.stack-delete-btn');
          if (deleteBtn) {
            deleteBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              deleteStack(rIdx, sIdx);
            });
          }
          stackHeader.addEventListener('click', function (e) {
            if (targetClosest(e.target, '.board-stack-title')) return;
            if (targetClosest(e.target, 'button, .drag-grip, .column-rename-input')) return;
            if (!e.altKey) return;
            e.stopPropagation();
            toggleStackFoldElement(el, true);
          });
          var foldBtn = stackHeader.querySelector('.stack-fold-btn');
          if (foldBtn) {
            foldBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              toggleStackFoldElement(el, !!e.altKey);
            });
          }
          stackHeader.querySelector('.stack-menu-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            var rect = this.getBoundingClientRect();
            showStackContextMenu(rect.right, rect.bottom, rIdx, sIdx);
          });
          stackHeader.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            e.stopPropagation();
            showStackContextMenu(e.clientX, e.clientY, rIdx, sIdx);
          });
          // Stack drag is handled by the pointer-based drag system
        })(stackEl, r, s);
        stackEl.appendChild(stackHeader);

        // Stack DnD handled by the pointer-based drag system

        // Stack content container
        var stackContent = document.createElement('div');
        stackContent.className = 'board-stack-content';

        if (stackColumnEntries.length === 0) {
          var emptyColumns = document.createElement('div');
          emptyColumns.className = 'board-level-empty board-level-empty-columns';
          (function (rowIdx, stackIdx) {
            emptyColumns.appendChild(renderCreationSource('column', { rowIdx: rowIdx, stackIdx: stackIdx }, { btnText: '+ Add column' }));
          })(r, s);
          stackContent.appendChild(emptyColumns);
        }

        for (var c = 0; c < stackColumnEntries.length; c++) {
          var col = stackColumnEntries[c].col;
          var colEl = buildColumnElement(col, foldedCols, collapsedCards, r, s, c, stackColumnEntries[c].fullIndex);
          if (isCanvasLayout) applyCanvasColumnLayout(colEl, col);
          // Column drag via grip is handled by the pointer-based drag system
          // Column DnD handled by the pointer-based drag system
          stackContent.appendChild(colEl);
        }

        stackEl.appendChild(stackContent);
        var stackFooter = document.createElement('div');
        stackFooter.className = 'board-stack-footer';
        stackEl.appendChild(stackFooter);
        if (isCanvasLayout) {
          (function (el) {
            var resizeHandle = document.createElement('div');
            resizeHandle.className = 'canvas-stack-resize-handle';
            resizeHandle.title = 'Resize stack width';
            resizeHandle.setAttribute('aria-hidden', 'true');
            resizeHandle.addEventListener('pointerdown', function (e) {
              e.preventDefault();
              e.stopPropagation();
              var startX = e.clientX;
              var startWidth = Math.round(el.getBoundingClientRect().width);
              el.classList.add('resizing');
              if (resizeHandle.setPointerCapture) {
                try { resizeHandle.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
              }
              function handleMove(moveEvent) {
                var nextWidth = Math.max(220, Math.round(startWidth + (moveEvent.clientX - startX)));
                el.style.width = nextWidth + 'px';
                scheduleCanvasRowBoundsSync(getElColumnsContainer());
              }
              function handleUp(upEvent) {
                el.classList.remove('resizing');
                if (resizeHandle.releasePointerCapture) {
                  try { resizeHandle.releasePointerCapture(upEvent.pointerId); } catch (_) { /* ignore */ }
                }
                window.removeEventListener('pointermove', handleMove, true);
                window.removeEventListener('pointerup', handleUp, true);
                window.removeEventListener('pointercancel', handleUp, true);
              }
              window.addEventListener('pointermove', handleMove, true);
              window.addEventListener('pointerup', handleUp, true);
              window.addEventListener('pointercancel', handleUp, true);
            });
            el.appendChild(resizeHandle);
          })(stackEl);
        }
        applyTagStyleToEntity(stackEl, stack.title || '');
        if (isCanvasLayout) {
          getCanvasSceneElement(rowContent, true).appendChild(stackEl);
        } else {
          rowContent.appendChild(stackEl);
        }
      }

      rowEl.appendChild(rowContent);
      var rowFooter = document.createElement('div');
      rowFooter.className = 'board-row-footer';
      rowEl.appendChild(rowFooter);
      applyTagStyleToEntity(rowEl, row.title || '');
      getElColumnsContainer().appendChild(rowEl);
    }
  }


  async function moveColumnWithinBoard(fromRowIdx, fromStackIdx, fromColIdx, toRowIdx, toStackIdx, toColIdx, insertBefore) {
    if (!fullBoardData) return;
    var fromRow = findFullDataRow(fromRowIdx);
    var toRow = findFullDataRow(toRowIdx);
    if (!fromRow || !toRow) return;
    var fromStack = findFullDataStack(fromRowIdx, fromStackIdx);
    var toStack = findFullDataStack(toRowIdx, toStackIdx);
    if (!fromStack || !toStack) return;

    var fromFullColIdx = findFullColumnIndexInStack(fromStack, fromColIdx);
    if (fromFullColIdx === -1) return;

    var insertAt = findInsertColumnIndexInStack(toStack, toColIdx, insertBefore);
    if (fromStack === toStack && fromFullColIdx < insertAt) insertAt--;
    if (fromStack === toStack && insertAt === fromFullColIdx) return;

    pushUndo();
    var moved = fromStack.columns.splice(fromFullColIdx, 1)[0];
    if (insertAt < 0) insertAt = 0;
    if (insertAt > toStack.columns.length) insertAt = toStack.columns.length;
    toStack.columns.splice(insertAt, 0, moved);

    removeEmptyStacksAndRows();

    await persistBoardMutation({ refreshSidebar: true });
  }

  async function moveColumnToExistingStack(fromRowIdx, fromStackIdx, fromColIdx, toRowIdx, toStackIdx) {
    if (!fullBoardData) return;
    var fromRow = findFullDataRow(fromRowIdx);
    var toRow = findFullDataRow(toRowIdx);
    if (!fromRow || !toRow) return;
    var fromStack = findFullDataStack(fromRowIdx, fromStackIdx);
    var toStack = findFullDataStack(toRowIdx, toStackIdx);
    if (!fromStack || !toStack) return;
    if (fromStack === toStack) return;

    var fromFullColIdx = findFullColumnIndexInStack(fromStack, fromColIdx);
    if (fromFullColIdx === -1) return;

    pushUndo();
    var moved = fromStack.columns.splice(fromFullColIdx, 1)[0];
    toStack.columns.push(moved);

    removeEmptyStacksAndRows();

    await persistBoardMutation({ refreshSidebar: true });
  }

  async function moveColumnToNewStack(fromRowIdx, fromStackIdx, fromColIdx, toRowIdx, insertAtStackIdx) {
    if (!fullBoardData) return;
    var fromRow = findFullDataRow(fromRowIdx);
    var toRow = findFullDataRow(toRowIdx);
    if (!fromRow || !toRow) return;
    var fromStack = findFullDataStack(fromRowIdx, fromStackIdx);
    if (!fromStack) return;

    var fromFullColIdx = findFullColumnIndexInStack(fromStack, fromColIdx);
    if (fromFullColIdx === -1) return;

    pushUndo();
    var moved = fromStack.columns.splice(fromFullColIdx, 1)[0];

    // Create a new stack with this column (empty title by default)
    var newStack = {
      id: 'stack-' + Date.now(),
      title: '',
      columns: [moved]
    };
    applyDefaultCanvasPlacementToStack(toRow, newStack);
    if (insertAtStackIdx != null) {
      // insertAtStackIdx is a display index — convert to fullBoardData index
      var fullInsertAt = findInsertStackIndexInRow(toRow, toRowIdx, insertAtStackIdx);
      toRow.stacks.splice(fullInsertAt, 0, newStack);
    } else {
      toRow.stacks.push(newStack);
    }

    removeEmptyStacksAndRows();

    await persistBoardMutation({ refreshSidebar: true });
  }

  // --- New-format DnD mutations ---

  async function reorderRows(sourceIdx, targetIdx, insertBefore) {
    if (!fullBoardData) return;

    var sourceFullIdx = findFullDataRowIndex(sourceIdx);
    var targetFullIdx = findFullDataRowIndex(targetIdx);
    if (sourceFullIdx === -1 || targetFullIdx === -1 || sourceFullIdx === targetFullIdx) return;

    var insertAt = targetFullIdx;
    if (sourceFullIdx < targetFullIdx) insertAt--;
    if (!insertBefore) insertAt++;
    if (insertAt === sourceFullIdx) return;

    pushUndo();
    var moved = fullBoardData.rows.splice(sourceFullIdx, 1)[0];
    fullBoardData.rows.splice(insertAt, 0, moved);
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function moveStack(fromRowIdx, fromStackIdx, toRowIdx, toStackIdx, insertBefore) {
    if (!fullBoardData) return;

    // Map display indices to fullBoardData row indices
    var fromRow = findFullDataRow(fromRowIdx);
    var toRow = findFullDataRow(toRowIdx);
    if (!fromRow || !toRow) return;
    var fromFullStackIdx = findFullDataStackIndex(fromRow, fromRowIdx, fromStackIdx);
    var toFullStackIdx = findFullDataStackIndex(toRow, toRowIdx, toStackIdx);
    if (fromFullStackIdx === -1 || toFullStackIdx === -1) return;
    var insertAt = toFullStackIdx;
    if (fromRow === toRow && fromFullStackIdx < toFullStackIdx) insertAt--;
    if (!insertBefore) insertAt++;
    if (fromRow === toRow && insertAt === fromFullStackIdx) return;

    pushUndo();
    var moved = fromRow.stacks.splice(fromFullStackIdx, 1)[0];
    if (insertAt < 0) insertAt = 0;
    if (insertAt > toRow.stacks.length) insertAt = toRow.stacks.length;
    toRow.stacks.splice(insertAt, 0, moved);
    removeEmptyStacksAndRows();

    await persistBoardMutation({ refreshSidebar: true });
  }

  /**
   * Find the fullBoardData row that corresponds to a display row index.
   * Matches by row title from activeBoardData.rows.
   */
  function findFullDataRow(displayRowIdx) {
    if (!activeBoardData || !activeBoardData.rows || displayRowIdx >= activeBoardData.rows.length) return null;
    var displayRow = activeBoardData.rows[displayRowIdx];
    for (var i = 0; i < fullBoardData.rows.length; i++) {
      if (fullBoardData.rows[i].id === displayRow.id) return fullBoardData.rows[i];
    }
    return null;
  }

  function findFullDataStack(displayRowIdx, displayStackIdx) {
    var row = findFullDataRow(displayRowIdx);
    if (!row || !activeBoardData || !activeBoardData.rows || displayRowIdx < 0 || displayRowIdx >= activeBoardData.rows.length) return null;
    var displayRow = activeBoardData.rows[displayRowIdx];
    if (!displayRow || displayStackIdx < 0 || displayStackIdx >= displayRow.stacks.length) return null;
    var displayStack = displayRow.stacks[displayStackIdx];
    for (var i = 0; i < row.stacks.length; i++) {
      if (row.stacks[i].id === displayStack.id) return row.stacks[i];
    }
    return null;
  }

  function findFullDataRowIndex(displayRowIdx) {
    if (!activeBoardData || !activeBoardData.rows || displayRowIdx < 0 || displayRowIdx >= activeBoardData.rows.length) return -1;
    var displayRow = activeBoardData.rows[displayRowIdx];
    for (var i = 0; i < fullBoardData.rows.length; i++) {
      if (fullBoardData.rows[i].id === displayRow.id) return i;
    }
    return -1;
  }

  function findInsertRowIndex(displayInsertAtIdx) {
    if (!fullBoardData || !fullBoardData.rows) return 0;
    if (!activeBoardData || !activeBoardData.rows || displayInsertAtIdx >= activeBoardData.rows.length) {
      return fullBoardData.rows.length;
    }
    if (displayInsertAtIdx <= 0) {
      var first = activeBoardData.rows[0];
      if (first && first.id) {
        for (var i = 0; i < fullBoardData.rows.length; i++) {
          if (fullBoardData.rows[i].id === first.id) return i;
        }
      }
      return 0;
    }
    var target = activeBoardData.rows[displayInsertAtIdx];
    if (target && target.id) {
      for (var i = 0; i < fullBoardData.rows.length; i++) {
        if (fullBoardData.rows[i].id === target.id) return i;
      }
    }
    return fullBoardData.rows.length;
  }

  function visibleColumnIndicesInStack(stack) {
    var result = [];
    if (!stack || !stack.columns) return result;
    var entries = getDisplayOrderedColumnEntries(stack.columns || []);
    for (var i = 0; i < entries.length; i++) {
      result.push(entries[i].fullIndex);
    }
    return result;
  }

  function findFullDataStackIndex(fullRow, displayRowIdx, displayStackIdx) {
    if (!fullRow || !activeBoardData || !activeBoardData.rows || displayRowIdx < 0 || displayRowIdx >= activeBoardData.rows.length) return -1;
    var displayRow = activeBoardData.rows[displayRowIdx];
    if (!displayRow || displayStackIdx < 0 || displayStackIdx >= displayRow.stacks.length) return -1;
    var displayStack = displayRow.stacks[displayStackIdx];

    if (displayStack.id) {
      for (var i = 0; i < fullRow.stacks.length; i++) {
        if (fullRow.stacks[i].id === displayStack.id) return i;
      }
    }

    // Fallback when IDs are missing: map by visible stack order.
    var visibleStackIdx = -1;
    for (var i = 0; i < fullRow.stacks.length; i++) {
      if (visibleColumnIndicesInStack(fullRow.stacks[i]).length === 0) continue;
      visibleStackIdx++;
      if (visibleStackIdx === displayStackIdx) return i;
    }
    return -1;
  }

  function findFullColumnIndexInStack(stack, displayColIdx) {
    if (!stack || displayColIdx < 0) return -1;
    var visible = visibleColumnIndicesInStack(stack);
    return displayColIdx < visible.length ? visible[displayColIdx] : -1;
  }

  function findInsertStackIndexInRow(fullRow, displayRowIdx, displayInsertAtIdx) {
    if (!fullRow || !fullRow.stacks) return 0;
    if (!activeBoardData || !activeBoardData.rows || displayRowIdx < 0 || displayRowIdx >= activeBoardData.rows.length) {
      return fullRow.stacks.length;
    }
    var displayRow = activeBoardData.rows[displayRowIdx];
    if (!displayRow || !displayRow.stacks || displayInsertAtIdx >= displayRow.stacks.length) {
      return fullRow.stacks.length;
    }
    if (displayInsertAtIdx <= 0) {
      // Insert before the first visible stack
      var first = displayRow.stacks[0];
      if (first && first.id) {
        for (var i = 0; i < fullRow.stacks.length; i++) {
          if (fullRow.stacks[i].id === first.id) return i;
        }
      }
      return 0;
    }
    // Insert before the display stack at displayInsertAtIdx
    var target = displayRow.stacks[displayInsertAtIdx];
    if (target && target.id) {
      for (var i = 0; i < fullRow.stacks.length; i++) {
        if (fullRow.stacks[i].id === target.id) return i;
      }
    }
    return fullRow.stacks.length;
  }

  function findInsertColumnIndexInStack(stack, displayColIdx, insertBefore) {
    if (!stack) return -1;
    var visible = visibleColumnIndicesInStack(stack);
    if (displayColIdx < 0 || displayColIdx >= visible.length) {
      return stack.columns.length;
    }
    return insertBefore ? visible[displayColIdx] : (visible[displayColIdx] + 1);
  }

  async function addColumnRelativeToDisplayPosition(displayRowIdx, displayStackIdx, displayColIdx, insertBefore) {
    var stack = findFullDataStack(displayRowIdx, displayStackIdx);
    if (!stack) {
      traceFrontendAction('warn', 'column.insert.relative', 'Failed to resolve stack for display-relative insert', {
        boardId: activeBoardId || null,
        displayRowIdx: displayRowIdx,
        displayStackIdx: displayStackIdx,
        displayColIdx: displayColIdx,
        insertBefore: !!insertBefore
      });
      return false;
    }
    var visibleIndices = visibleColumnIndicesInStack(stack);
    var insertAt = findInsertColumnIndexInStack(stack, displayColIdx, insertBefore);
    if (insertAt < 0) {
      traceFrontendAction('warn', 'column.insert.relative', 'Failed to compute insert index for display-relative insert', {
        boardId: activeBoardId || null,
        displayRowIdx: displayRowIdx,
        displayStackIdx: displayStackIdx,
        displayColIdx: displayColIdx,
        insertBefore: !!insertBefore,
        stackId: stack.id || null,
        visibleIndices: visibleIndices
      });
      return false;
    }
    traceFrontendAction('info', 'column.insert.relative', 'Resolved display-relative insert position', {
      boardId: activeBoardId || null,
      displayRowIdx: displayRowIdx,
      displayStackIdx: displayStackIdx,
      displayColIdx: displayColIdx,
      insertBefore: !!insertBefore,
      stackId: stack.id || null,
      stackTitle: stack.title || '',
      insertAt: insertAt,
      visibleIndices: visibleIndices
    });
    return addColumnToStack(displayRowIdx, displayStackIdx, insertAt);
  }

  var mutationEntityIdSeed = 0;

  function nextMutationEntityId(prefix) {
    mutationEntityIdSeed = (mutationEntityIdSeed + 1) % 1000000;
    return prefix + '-' + Date.now() + '-' + mutationEntityIdSeed;
  }

  function isUnnamedStructuralTitle(title) {
    return stripInternalHiddenTags(stripHtmlComments(String(title || ''))).trim() === '';
  }

  function createUnnamedColumnForMutation(cards) {
    return {
      id: nextMutationEntityId('col'),
      title: '',
      cards: Array.isArray(cards) ? cards : []
    };
  }

  function createUnnamedStackForMutation(columns) {
    return {
      id: nextMutationEntityId('stack'),
      title: '',
      columns: Array.isArray(columns) ? columns : []
    };
  }

  function createUnnamedRowForMutation(stacks) {
    return {
      id: nextMutationEntityId('row'),
      title: '',
      stacks: Array.isArray(stacks) ? stacks : []
    };
  }

  function resolveRowInsertIndexForMutation(boardId, boardData, target) {
    if (!boardData || !boardData.rows) return 0;
    if (!target || typeof target.rowIndex !== 'number') return boardData.rows.length;

    var rowInfo = resolveRowForMutation(
      boardId,
      boardData,
      target.rowIndex,
      target.indexMode || (boardId === activeBoardId ? 'display' : 'full')
    );
    if (!rowInfo || !rowInfo.row) return boardData.rows.length;

    var insertAt = target.before ? rowInfo.rowIndex : (rowInfo.rowIndex + 1);
    if (insertAt < 0) insertAt = 0;
    if (insertAt > boardData.rows.length) insertAt = boardData.rows.length;
    return insertAt;
  }

  function insertUnnamedRowForMutation(boardId, boardData, target, stacks) {
    if (!boardData) return null;
    if (!boardData.rows) boardData.rows = [];
    var row = createUnnamedRowForMutation(stacks);
    var insertAt = resolveRowInsertIndexForMutation(boardId, boardData, target);
    boardData.rows.splice(insertAt, 0, row);
    return { row: row, rowIndex: insertAt };
  }

  function insertUnnamedStackIntoRowForMutation(boardId, boardData, target) {
    if (!target || typeof target.rowIndex !== 'number') return null;
    var rowInfo = resolveRowForMutation(
      boardId,
      boardData,
      target.rowIndex,
      target.indexMode || (boardId === activeBoardId ? 'display' : 'full')
    );
    if (!rowInfo || !rowInfo.row) return null;

    if (!rowInfo.row.stacks) rowInfo.row.stacks = [];
    var stack = createUnnamedStackForMutation([]);
    applyDefaultCanvasPlacementToStack(rowInfo.row, stack);
    var insertAt = rowInfo.row.stacks.length;
    if (typeof target.insertAtStackIdx === 'number') {
      if ((target.indexMode || (boardId === activeBoardId ? 'display' : 'full')) === 'display' && boardId === activeBoardId) {
        insertAt = findInsertStackIndexInRow(rowInfo.row, target.rowIndex, target.insertAtStackIdx);
      } else {
        insertAt = target.insertAtStackIdx;
      }
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > rowInfo.row.stacks.length) insertAt = rowInfo.row.stacks.length;
    rowInfo.row.stacks.splice(insertAt, 0, stack);
    return {
      row: rowInfo.row,
      rowIndex: rowInfo.rowIndex,
      stack: stack,
      stackIndex: insertAt
    };
  }

  function resolvePreferredCardColumnRefInStack(stack, preferLast) {
    if (!stack || !Array.isArray(stack.columns)) return null;
    var entries = getDisplayOrderedColumnEntries(stack.columns || []);
    if (entries.length > 0) {
      var entry = preferLast ? entries[entries.length - 1] : entries[0];
      return {
        column: stack.columns[entry.fullIndex],
        columnIndex: entry.fullIndex,
        stack: stack
      };
    }
    if (stack.columns.length > 0) {
      var idx = preferLast ? (stack.columns.length - 1) : 0;
      return {
        column: stack.columns[idx],
        columnIndex: idx,
        stack: stack
      };
    }
    return null;
  }

  function ensureCardTargetColumnForMutation(boardId, boardData, descriptor) {
    var existing = resolveColumnRefForCardMutation(boardId, boardData, descriptor);
    if (existing && existing.column) return existing;
    if (!descriptor) return null;

    var indexMode = descriptor.indexMode || (boardId === activeBoardId ? 'display' : 'full');

    if (typeof descriptor.rowIndex === 'number' && typeof descriptor.stackIndex === 'number') {
      var stackInfo = resolveStackForMutation(boardId, boardData, descriptor.rowIndex, descriptor.stackIndex, indexMode);
      if (!stackInfo || !stackInfo.stack) return null;
      if (!stackInfo.stack.columns) stackInfo.stack.columns = [];
      var preferredColumn = resolvePreferredCardColumnRefInStack(stackInfo.stack, true);
      if (preferredColumn) return preferredColumn;
      var newColumn = createUnnamedColumnForMutation([]);
      stackInfo.stack.columns.push(newColumn);
      return {
        column: newColumn,
        columnIndex: stackInfo.stack.columns.length - 1,
        stack: stackInfo.stack
      };
    }

    if (typeof descriptor.rowIndex === 'number') {
      var rowInfo = resolveRowForMutation(boardId, boardData, descriptor.rowIndex, indexMode);
      if (!rowInfo || !rowInfo.row) return null;
      if (!rowInfo.row.stacks) rowInfo.row.stacks = [];
      for (var i = 0; i < rowInfo.row.stacks.length; i++) {
        var stackTarget = resolvePreferredCardColumnRefInStack(rowInfo.row.stacks[i], false);
        if (stackTarget) return stackTarget;
      }
      var insertedStackInfo = insertUnnamedStackIntoRowForMutation(boardId, boardData, descriptor);
      if (!insertedStackInfo || !insertedStackInfo.stack) return null;
      var insertedColumn = createUnnamedColumnForMutation([]);
      insertedStackInfo.stack.columns.push(insertedColumn);
      return {
        column: insertedColumn,
        columnIndex: insertedStackInfo.stack.columns.length - 1,
        stack: insertedStackInfo.stack
      };
    }

    return null;
  }

  function cleanupUnnamedStructuralContainersInBoard(boardData) {
    if (!boardData || !boardData.rows) return;
    for (var r = boardData.rows.length - 1; r >= 0; r--) {
      var row = boardData.rows[r];
      if (!row.stacks) row.stacks = [];
      for (var s = row.stacks.length - 1; s >= 0; s--) {
        var stack = row.stacks[s];
        if (!stack.columns) stack.columns = [];
        for (var c = stack.columns.length - 1; c >= 0; c--) {
          var column = stack.columns[c];
          var cards = column && Array.isArray(column.cards) ? column.cards : [];
          if (cards.length === 0 && isUnnamedStructuralTitle(column && column.title ? column.title : '')) {
            stack.columns.splice(c, 1);
          }
        }
        if (stack.columns.length === 0 && isUnnamedStructuralTitle(stack && stack.title ? stack.title : '')) {
          row.stacks.splice(s, 1);
        }
      }
      if (row.stacks.length === 0 && isUnnamedStructuralTitle(row && row.title ? row.title : '')) {
        boardData.rows.splice(r, 1);
      }
    }
  }

  function removeEmptyStacksAndRowsInBoard(boardData) {
    if (!boardData || !boardData.rows) return;
    cleanupUnnamedStructuralContainersInBoard(boardData);
    for (var r = boardData.rows.length - 1; r >= 0; r--) {
      var row = boardData.rows[r];
      if (!row.stacks) row.stacks = [];
      if (row.stacks.length === 0) {
        boardData.rows.splice(r, 1);
      }
    }
  }

  function removeEmptyStacksAndRows() {
    removeEmptyStacksAndRowsInBoard(fullBoardData);
  }

  // --- Row & Stack Context Menus ---

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

  function showElementContextMenu(scope, x, y, rawContext) {
    closeRowStackMenu();
    closeColumnContextMenu();
    closeCardContextMenu();

    var context = {};
    var keys = Object.keys(rawContext || {});
    for (var ck = 0; ck < keys.length; ck++) context[keys[ck]] = rawContext[keys[ck]];
    context.scope = scope;

    // Prepare scope-specific context fields
    if (scope === 'card') {
      var col = getFullColumn(context.colIndex);
      var cardText = '';
      if (col) {
        var fullIdx = getFullCardIndex(col, context.cardIndex);
        if (fullIdx !== -1 && col.cards[fullIdx]) cardText = col.cards[fullIdx].content || '';
      }
      context.elementText = cardText;
      context.visibleCardCount = 0;
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
      var ccol = getFullColumn(context.colIndex);
      var colTitle = ccol ? (ccol.title || '') : '';
      context.elementText = colTitle;
      var layout = getColumnLayoutTags(colTitle);
      context.isStacked = layout.stack;
      context.currentSpan = layout.span ? parseInt(layout.span.match(/\d+/)[0], 10) : 1;
      context.includePath = (ccol && ccol.includeSource && ccol.includeSource.rawPath)
        ? String(ccol.includeSource.rawPath)
        : extractIncludePathFromTitle(colTitle);
      context.boardRows = activeBoardData && Array.isArray(activeBoardData.rows) ? activeBoardData.rows : [];
      context.columnSortState = columnSortState;
    } else if (scope === 'row') {
      var row = findFullDataRow(context.rowIdx);
      context.elementText = row ? (row.title || '') : '';
    } else if (scope === 'stack') {
      var stack = findFullDataStack(context.rowIdx, context.stackIdx);
      context.elementText = stack ? (stack.title || '') : '';
    }

    var items = MenuContributorRegistry.buildMenu(scope, context);
    var traceTarget = scope + '.menu';

    showNativeMenu(items, x, y, traceTarget).then(function (action) {
      if (!action) return;
      ActionRegistry.dispatch(scope, action, context);
    }).catch(function (err) {
      logFrontendIssue('error', traceTarget, scope + ' menu action failed', err);
    });
  }

  function renameRowOrStack(type, rowIdx, stackIdx) {
    var rootSelector = type === 'row'
      ? '.board-row[data-row-index="' + rowIdx + '"]'
      : '.board-stack[data-row-index="' + rowIdx + '"][data-stack-index="' + stackIdx + '"]';
    var rootEl = getElColumnsContainer().querySelector(rootSelector);
    if (!rootEl) return;

    var titleSelector = type === 'row' ? '.board-row-title' : '.board-stack-title';
    var titleEl = rootEl.querySelector(titleSelector);
    if (!titleEl) return;
    var target = type === 'row' ? findFullDataRow(rowIdx) : findFullDataStack(rowIdx, stackIdx);
    if (!target) return;

    var headerSelector = type === 'row' ? '.board-row-header' : '.board-stack-header';
    var headerEl = rootEl.querySelector(headerSelector);
    var currentTitle = target.title;
    var currentDisplayTitle = stripHtmlComments(currentTitle);
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
      if (newTitle && newTitle !== currentDisplayTitle) {
        titleEl.textContent = getDisplayTitle(newTitle);
        pushUndo();
        target.title = rebuildTitleWithPreservedComments(newTitle, currentTitle);
        persistBoardMutation();
      } else {
        titleEl.textContent = getDisplayTitle(currentDisplayTitle);
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
    templatesLoaded = true;
    LexeraTemplates.loadTemplates().catch(function (err) {
      logFrontendIssue('warn', 'templates.load', 'Failed to load templates', err);
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
      var templates = prioritizeDrawioAndExcalidrawTemplates(entityType, LexeraTemplates.getTemplatesForType(entityType));
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
    traceFrontendAction('info', 'creation.action', 'Dispatching creation action', {
      boardId: activeBoardId || null,
      entityType: entityType,
      action: action,
      context: context || null
    });
    if (action === 'empty') {
      if (entityType === 'card') {
        return addEmptyCardToActiveBoard(
          context && context.colIndex,
          context && context.atCardIndex,
          context && context.insertMode
        );
      }
      if (entityType === 'row') {
        addRow(context.atIndex);
      } else if (entityType === 'stack') {
        addStackToRow(context.rowIdx, context.atStackIdx);
      } else if (entityType === 'column') {
        addColumnToStack(context.rowIdx, context.stackIdx, context.atColIdx);
      }
      return;
    }

    if (action === 'clipboard') {
      try {
        var text = await navigator.clipboard.readText();
        if (!text || !text.trim()) {
          showNotification('Clipboard is empty');
          lexeraLog('warn', 'Clipboard is empty');
          return;
        }
        if (entityType === 'card' && context && context.colIndex !== undefined && activeBoardId) {
          await addCardToActiveBoard(
            context.colIndex,
            text.trim(),
            context.atCardIndex,
            context.insertMode
          );
        } else if (entityType === 'row') {
          await addRowFromContent(text.trim(), context.atIndex);
        } else if (entityType === 'stack') {
          await addStackFromContent(context.rowIdx, text.trim(), context.atStackIdx);
        } else if (entityType === 'column') {
          await addColumnFromContent(context.rowIdx, context.stackIdx, text.trim(), context.atColIdx);
        }
      } catch (err) {
        lexeraLog('warn', 'Clipboard read failed: ' + err.message);
      }
      return;
    }

    // template:id
    if (action.indexOf('template:') === 0) {
      var templateId = action.substring(9);
      if (templateId.indexOf('__builtin__:diagram:') === 0) {
        if (entityType !== 'card') {
          showNotification('Built-in diagram templates are card-only');
          return;
        }
        var diagramCardContent = await buildBuiltInDiagramTemplateCardContent(templateId);
        if (!diagramCardContent) return;
        if (activeBoardId && context && context.colIndex !== undefined) {
          await addCardToActiveBoard(
            context.colIndex,
            diagramCardContent,
            context.atCardIndex,
            context.insertMode
          );
        }
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
        if (tplData.files.length > 0 && activeBoardId) {
          LexeraApi.request('/templates/' + encodeURIComponent(templateId) + '/copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ board_id: activeBoardId, variables: values })
          }).catch(function (err) {
            lexeraLog('warn', 'Template file copy failed: ' + err.message);
          });
        }

        // Build entity and insert
        if (entityType === 'card') {
          var card = LexeraTemplates.buildCardFromTemplate(parsed, values);
          if (activeBoardId && context.colIndex !== undefined) {
            await addCardToActiveBoard(
              context.colIndex,
              card.content,
              context.atCardIndex,
              context.insertMode
            );
          }
        } else if (entityType === 'column') {
          var cols = LexeraTemplates.buildColumnFromTemplate(parsed, values);
          insertTemplateColumns(context.rowIdx, context.stackIdx, cols, context.atColIdx);
        } else if (entityType === 'stack') {
          var stack = LexeraTemplates.buildStackFromTemplate(parsed, values);
          insertTemplateStack(context.rowIdx, stack, context.atStackIdx);
        } else if (entityType === 'row') {
          var row = LexeraTemplates.buildRowFromTemplate(parsed, values);
          insertTemplateRow(context.atIndex, row);
        }
      } catch (err) {
        lexeraLog('error', 'Template apply failed: ' + err.message);
      }
    }
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

  async function buildBuiltInDiagramTemplateCardContent(templateId) {
    if (!activeBoardId) {
      showNotification('No active board selected');
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
      var result = await LexeraApi.uploadMedia(activeBoardId, file);
      if (!result || !result.filename) {
        showNotification('Failed to create ' + spec.displayName + ' file');
        return null;
      }
      return '![' + fileName + '](' + result.filename + ')';
    } catch (err) {
      logFrontendIssue('error', 'template.builtin.diagram', 'Failed to create built-in ' + spec.displayName + ' template file', err);
      showNotification('Failed to create ' + spec.displayName + ' file');
      return null;
    }
  }

  // ── Template insertion helpers ────────────────────────────────────────

  async function addRowFromContent(text, atIndex) {
    if (!fullBoardData) return;
    if (!Array.isArray(fullBoardData.rows)) fullBoardData.rows = [];
    pushUndo();
    var ts = Date.now();
    var card = { id: 'card-' + ts, content: text, checked: false };
    var newRow = {
      id: 'row-' + ts,
      title: 'New Row',
      stacks: [{ id: 'stack-' + ts, title: 'Default', columns: [{ id: 'col-' + ts, title: 'New Column', cards: [card] }] }]
    };
    applyDefaultCanvasPlacementToStack(newRow, newRow.stacks[0]);
    var insertAt = (typeof atIndex === 'number' && !isNaN(atIndex)) ? findInsertRowIndex(atIndex) : fullBoardData.rows.length;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > fullBoardData.rows.length) insertAt = fullBoardData.rows.length;
    fullBoardData.rows.splice(insertAt, 0, newRow);
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function addStackFromContent(rowIdx, text, atStackIdx) {
    var row = findFullDataRow(rowIdx);
    if (!row) return;
    pushUndo();
    var ts = Date.now();
    var card = { id: 'card-' + ts, content: text, checked: false };
    if (!Array.isArray(row.stacks)) row.stacks = [];
    var insertAt = row.stacks.length;
    if (typeof atStackIdx === 'number' && !isNaN(atStackIdx)) {
      insertAt = findInsertStackIndexInRow(row, rowIdx, atStackIdx);
      if (insertAt < 0) insertAt = row.stacks.length;
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > row.stacks.length) insertAt = row.stacks.length;
    var newStack = {
      id: 'stack-' + ts,
      title: 'New Stack',
      columns: [{ id: 'col-' + ts, title: 'New Column', cards: [card] }]
    };
    applyDefaultCanvasPlacementToStack(row, newStack);
    row.stacks.splice(insertAt, 0, newStack);
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function addColumnFromContent(rowIdx, stackIdx, text, atColIdx) {
    var stack = findFullDataStack(rowIdx, stackIdx);
    if (!stack) return;
    pushUndo();
    var ts = Date.now();
    var card = { id: 'card-' + ts, content: text, checked: false };
    if (!Array.isArray(stack.columns)) stack.columns = [];
    var insertAt = stack.columns.length;
    if (typeof atColIdx === 'number' && !isNaN(atColIdx)) insertAt = atColIdx;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > stack.columns.length) insertAt = stack.columns.length;
    stack.columns.splice(insertAt, 0, { id: 'col-' + ts, title: 'New Column', cards: [card] });
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function insertTemplateColumns(rowIdx, stackIdx, cols, atColIdx) {
    var stack = findFullDataStack(rowIdx, stackIdx);
    if (!stack) return;
    pushUndo();
    if (!Array.isArray(stack.columns)) stack.columns = [];
    var insertAt = stack.columns.length;
    if (typeof atColIdx === 'number' && !isNaN(atColIdx)) insertAt = atColIdx;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > stack.columns.length) insertAt = stack.columns.length;
    for (var i = 0; i < cols.length; i++) {
      stack.columns.splice(insertAt + i, 0, cols[i]);
    }
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function insertTemplateStack(rowIdx, stack, atStackIdx) {
    var row = findFullDataRow(rowIdx);
    if (!row) return;
    pushUndo();
    if (!Array.isArray(row.stacks)) row.stacks = [];
    var insertAt = row.stacks.length;
    if (typeof atStackIdx === 'number' && !isNaN(atStackIdx)) {
      insertAt = findInsertStackIndexInRow(row, rowIdx, atStackIdx);
      if (insertAt < 0) insertAt = row.stacks.length;
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > row.stacks.length) insertAt = row.stacks.length;
    applyDefaultCanvasPlacementToStack(row, stack);
    row.stacks.splice(insertAt, 0, stack);
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function insertTemplateRow(atIndex, row) {
    if (!fullBoardData) return;
    if (!Array.isArray(fullBoardData.rows)) fullBoardData.rows = [];
    pushUndo();
    if (typeof atIndex !== 'number' || isNaN(atIndex)) atIndex = fullBoardData.rows.length;
    if (atIndex < 0) atIndex = 0;
    if (atIndex > fullBoardData.rows.length) atIndex = fullBoardData.rows.length;
    fullBoardData.rows.splice(atIndex, 0, row);
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function addRow(atIndex) {
    if (!fullBoardData) {
      traceFrontendAction('warn', 'row.create', 'Aborted add row because fullBoardData is missing', {
        boardId: activeBoardId || null,
        atIndex: atIndex
      });
      return false;
    }
    if (!Array.isArray(fullBoardData.rows)) fullBoardData.rows = [];

    pushUndo();
    var ts = Date.now();
    var newRow = {
      id: 'row-' + ts,
      title: 'New Row',
      stacks: [{ id: 'stack-' + ts, title: 'Default', columns: [{ id: 'col-' + ts, title: 'New Column', cards: [] }] }]
    };
    applyDefaultCanvasPlacementToStack(newRow, newRow.stacks[0]);
    var insertAt;
    if (typeof atIndex !== 'number' || isNaN(atIndex)) {
      insertAt = fullBoardData.rows.length;
    } else {
      // atIndex is a display index — convert to fullBoardData index
      insertAt = findInsertRowIndex(atIndex);
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > fullBoardData.rows.length) insertAt = fullBoardData.rows.length;
    traceFrontendAction('info', 'row.create', 'Inserting new row', {
      boardId: activeBoardId || null,
      atIndex: insertAt,
      rowId: newRow.id,
      summaryBefore: summarizeBoardHierarchy(fullBoardData)
    });
    fullBoardData.rows.splice(insertAt, 0, newRow);
    var saved = await persistBoardMutation({ refreshSidebar: true });
    traceFrontendAction(saved ? 'info' : 'warn', 'row.create', saved ? 'Persisted new row' : 'Row persist reported failure', {
      boardId: activeBoardId || null,
      atIndex: atIndex,
      rowId: newRow.id,
      summaryAfter: summarizeBoardHierarchy(fullBoardData)
    });
    return saved;
  }

  async function setRowHiddenTag(displayRowIdx, tag) {
    if (!fullBoardData || !activeBoardId) return;
    var row = findFullDataRow(displayRowIdx);
    if (!row) return;
    var nextTitle = applyInternalHiddenTag(row.title || '', tag);
    if (nextTitle === row.title) return;
    pushUndo();
    row.title = nextTitle;
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  async function deleteRow(rowIdx) {
    traceFrontendAction('info', 'row.delete', 'deleteRow called', { rowIdx: rowIdx });
    var row = findFullDataRow(rowIdx);
    if (!row) {
      traceFrontendAction('warn', 'row.delete', 'findFullDataRow returned null', { rowIdx: rowIdx });
      return;
    }
    var visibleCards = 0;
    for (var s = 0; s < row.stacks.length; s++) {
      for (var c = 0; c < row.stacks[s].columns.length; c++) {
        var cards = row.stacks[s].columns[c].cards || [];
        for (var k = 0; k < cards.length; k++) {
          if (!is_archived_or_deleted(cards[k].content || '')) visibleCards++;
        }
      }
    }
    if (visibleCards > 0) {
      var confirmed = await showConfirmDialog('Move row "' + stripInternalHiddenTags(row.title || '') + '" and ' + visibleCards + ' card(s) to trash?');
      if (!confirmed) return;
    }
    await setRowHiddenTag(rowIdx, '#hidden-internal-deleted');
  }

  async function duplicateRow(rowIdx) {
    if (!fullBoardData || !activeBoardId) return;
    var row = findFullDataRow(rowIdx);
    if (!row) return;
    pushUndo();
    var clone = JSON.parse(JSON.stringify(row));
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
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function addStackToRow(rowIdx, atStackIdx, options) {
    if (atStackIdx && typeof atStackIdx === 'object' && !Array.isArray(atStackIdx)) {
      options = atStackIdx;
      atStackIdx = undefined;
    }
    options = options || {};

    var row = findFullDataRow(rowIdx);
    if (!row) {
      traceFrontendAction('warn', 'stack.create', 'Aborted add stack because row could not be resolved', {
        boardId: activeBoardId || null,
        rowIdx: rowIdx,
        atStackIdx: atStackIdx,
        options: options
      });
      return false;
    }
    if (!Array.isArray(row.stacks)) row.stacks = [];
    pushUndo();
    var ts = Date.now();
    var newStack = {
      id: 'stack-' + ts,
      title: 'New Stack',
      columns: [{ id: 'col-' + ts, title: 'New Column', cards: [] }]
    };
    var explicitCanvasPosition = options && options.canvasPosition ? options.canvasPosition : null;
    var explicitCanvasX = explicitCanvasPosition ? Number(explicitCanvasPosition.x) : NaN;
    var explicitCanvasY = explicitCanvasPosition ? Number(explicitCanvasPosition.y) : NaN;
    if (isCanvasBoardLayout() && isFinite(explicitCanvasX) && isFinite(explicitCanvasY)) {
      if (!newStack.params || typeof newStack.params !== 'object') newStack.params = {};
      newStack.params.x = String(Math.round(explicitCanvasX));
      newStack.params.y = String(Math.round(explicitCanvasY));
    } else {
      applyDefaultCanvasPlacementToStack(row, newStack);
    }
    var insertAt = row.stacks.length;
    if (typeof atStackIdx === 'number' && !isNaN(atStackIdx)) {
      // atStackIdx is a display index — convert to fullBoardData index
      insertAt = findInsertStackIndexInRow(row, rowIdx, atStackIdx);
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > row.stacks.length) insertAt = row.stacks.length;
    traceFrontendAction('info', 'stack.create', 'Inserting new stack', {
      boardId: activeBoardId || null,
      rowIdx: rowIdx,
      rowId: row.id || null,
      rowTitle: row.title || '',
      insertAt: insertAt,
      stackId: newStack.id,
      canvasPosition: isCanvasBoardLayout() ? { x: newStack.params && newStack.params.x, y: newStack.params && newStack.params.y } : null
    });
    row.stacks.splice(insertAt, 0, newStack);
    var saved = await persistBoardMutation({ refreshSidebar: true });
    traceFrontendAction(saved ? 'info' : 'warn', 'stack.create', saved ? 'Persisted new stack' : 'Stack persist reported failure', {
      boardId: activeBoardId || null,
      rowIdx: rowIdx,
      rowId: row.id || null,
      insertAt: insertAt,
      stackId: newStack.id
    });
    return saved;
  }

  async function setStackHiddenTag(displayRowIdx, displayStackIdx, tag) {
    if (!fullBoardData || !activeBoardId) return;
    var stack = findFullDataStack(displayRowIdx, displayStackIdx);
    if (!stack) return;
    var nextTitle = applyInternalHiddenTag(stack.title || '', tag);
    if (nextTitle === stack.title) return;
    pushUndo();
    stack.title = nextTitle;
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  async function deleteStack(rowIdx, stackIdx) {
    traceFrontendAction('info', 'stack.delete', 'deleteStack called', { rowIdx: rowIdx, stackIdx: stackIdx });
    var row = findFullDataRow(rowIdx);
    var stack = findFullDataStack(rowIdx, stackIdx);
    if (!row || !stack) {
      traceFrontendAction('warn', 'stack.delete', 'findFullDataRow/Stack returned null', { rowIdx: rowIdx, stackIdx: stackIdx });
      return;
    }
    var visibleCards = 0;
    for (var c = 0; c < stack.columns.length; c++) {
      var cards = stack.columns[c].cards || [];
      for (var k = 0; k < cards.length; k++) {
        if (!is_archived_or_deleted(cards[k].content || '')) visibleCards++;
      }
    }
    if (visibleCards > 0) {
      var confirmed = await showConfirmDialog('Move stack "' + stripInternalHiddenTags(stack.title || '') + '" and ' + visibleCards + ' card(s) to trash?');
      if (!confirmed) return;
    }
    await setStackHiddenTag(rowIdx, stackIdx, '#hidden-internal-deleted');
  }

  async function duplicateStack(rowIdx, stackIdx) {
    if (!fullBoardData || !activeBoardId) return;
    var row = findFullDataRow(rowIdx);
    var stack = findFullDataStack(rowIdx, stackIdx);
    if (!row || !stack) return;
    pushUndo();
    var clone = JSON.parse(JSON.stringify(stack));
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
    var fullStackIdx = findFullDataStackIndex(row, rowIdx, stackIdx);
    if (fullStackIdx === -1) fullStackIdx = row.stacks.length - 1;
    row.stacks.splice(fullStackIdx + 1, 0, clone);
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function addColumnToStack(rowIdx, stackIdx, atColIdx) {

    var stack = findFullDataStack(rowIdx, stackIdx);
    if (!stack) {
      traceFrontendAction('warn', 'column.create', 'Aborted add column because stack could not be resolved', {
        boardId: activeBoardId || null,
        rowIdx: rowIdx,
        stackIdx: stackIdx,
        atColIdx: atColIdx
      });
      return false;
    }
    if (!Array.isArray(stack.columns)) stack.columns = [];
    pushUndo();
    var insertAt = stack.columns.length;
    if (typeof atColIdx === 'number' && !isNaN(atColIdx)) insertAt = atColIdx;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > stack.columns.length) insertAt = stack.columns.length;
    var newColumn = { id: 'col-' + Date.now(), title: 'New Column', cards: [] };
    traceFrontendAction('info', 'column.create', 'Inserting new column into stack', {
      boardId: activeBoardId || null,
      rowIdx: rowIdx,
      stackIdx: stackIdx,
      stackId: stack.id || null,
      stackTitle: stack.title || '',
      insertAt: insertAt,
      columnId: newColumn.id,
      stackColumnCountBefore: stack.columns.length
    });
    stack.columns.splice(insertAt, 0, newColumn);
    var saved = await persistBoardMutation({ refreshSidebar: true });
    traceFrontendAction(saved ? 'info' : 'warn', 'column.create', saved ? 'Persisted new column in stack' : 'Column persist reported failure', {
      boardId: activeBoardId || null,
      rowIdx: rowIdx,
      stackIdx: stackIdx,
      stackId: stack.id || null,
      insertAt: insertAt,
      columnId: newColumn.id,
      stackColumnCountAfter: stack.columns.length
    });
    return saved;
  }

  async function addCardToActiveBoard(colIndex, content, atCardIndex, insertMode) {
    content = String(content || '').trim();
    if (!content || !activeBoardId || !fullBoardData) return false;
    var column = getFullColumn(colIndex);
    if (!column || !Array.isArray(column.cards)) return false;
    pushUndo();
    var insertAt = column.cards.length;
    if (typeof atCardIndex === 'number') {
      var resolvedInsertIdx = resolveInsertCardIndex(column, atCardIndex, insertMode === 'full' ? 'full' : 'visible');
      if (resolvedInsertIdx >= 0) insertAt = resolvedInsertIdx;
    }
    column.cards.splice(insertAt, 0, {
      id: 'card-' + Date.now(),
      content: content,
      checked: false
    });
    addCardColumn = null;
    await persistBoardMutation();
    return true;
  }

  async function addEmptyCardToActiveBoard(colIndex, atCardIndex, insertMode) {
    if (colIndex == null || !activeBoardId || !fullBoardData) {
      traceFrontendAction('warn', 'card.create', 'Aborted empty card creation because board or column context is missing', {
        boardId: activeBoardId || null,
        colIndex: colIndex
      });
      return false;
    }
    var column = getFullColumn(colIndex);
    if (!column || !Array.isArray(column.cards)) {
      traceFrontendAction('warn', 'card.create', 'Aborted empty card creation because column could not be resolved', {
        boardId: activeBoardId || null,
        colIndex: colIndex
      });
      return false;
    }
    pushUndo();
    var card = {
      id: 'card-' + Date.now(),
      content: '',
      checked: false
    };
    traceFrontendAction('info', 'card.create', 'Creating blank card', {
      boardId: activeBoardId || null,
      colIndex: colIndex,
      columnId: column.id || null,
      cardId: card.id,
      cardCountBefore: column.cards.length
    });
    var insertAt = column.cards.length;
    if (typeof atCardIndex === 'number') {
      var resolvedInsert = resolveInsertCardIndex(column, atCardIndex, insertMode === 'full' ? 'full' : 'visible');
      if (resolvedInsert >= 0) insertAt = resolvedInsert;
    }
    column.cards.splice(insertAt, 0, card);
    var saved = await persistBoardMutation();
    traceFrontendAction(saved ? 'info' : 'warn', 'card.create', saved ? 'Persisted blank card' : 'Blank card persist reported failure', {
      boardId: activeBoardId || null,
      colIndex: colIndex,
      columnId: column.id || null,
      cardId: card.id,
      cardCountAfter: column.cards.length
    });
    return saved;
  }

  async function insertCardAtIndex(colIndex, atCardIndex) {
    if (colIndex == null || !activeBoardId || !fullBoardData) return false;
    var column = getFullColumn(colIndex);
    if (!column || !Array.isArray(column.cards)) return false;
    pushUndo();
    var card = { id: 'card-' + Date.now(), content: '', checked: false };
    var insertAt;
    if (typeof atCardIndex === 'number') {
      var fullIdx = getFullCardIndex(column, atCardIndex);
      insertAt = fullIdx !== -1 ? fullIdx : column.cards.length;
    } else {
      insertAt = column.cards.length;
    }
    column.cards.splice(insertAt, 0, card);
    return await persistBoardMutation();
  }

  async function submitCard(colIndex, content) {
    try {
      if (!await addCardToActiveBoard(colIndex, content)) {
        throw new Error('Column not available for card creation');
      }
    } catch (err) {
      alert('Failed to add card: ' + err.message);
    }
  }

  async function pasteClipboardAsCard(colIndex) {
    if (!fullBoardData || !activeBoardId) return;
    try {
      var text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        showNotification('Clipboard is empty');
        return;
      }
      var column = getFullColumn(colIndex);
      if (!column) return;
      pushUndo();
      var card = { id: 'card-' + Date.now(), content: text.trim(), checked: false };
      column.cards.push(card);
      await persistBoardMutation();
      showNotification('Pasted as new card');
    } catch (err) {
      showNotification('Clipboard access denied');
    }
  }

  async function smartPasteAsCard(colIndex) {
    if (!fullBoardData || !activeBoardId) return;
    try {
      var text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        showNotification('Clipboard is empty');
        return;
      }
      text = text.trim();
      var content = formatSmartPasteContent(text);
      var columns = activeBoardData ? activeBoardData.columns : [];
      var targetCol = colIndex != null ? colIndex : (columns.length > 0 ? columns[0].index : null);
      if (targetCol == null) return;
      var column = getFullColumn(targetCol);
      if (!column) return;
      pushUndo();
      var card = { id: 'card-' + Date.now(), content: content, checked: false };
      column.cards.push(card);
      await persistBoardMutation();
      showNotification('Smart pasted as new card');
    } catch (err) {
      showNotification('Clipboard access denied');
    }
  }

  function formatSmartPasteContent(text) {
    // Single URL on its own line → markdown link
    if (/^https?:\/\/\S+$/i.test(text)) {
      var urlTitle = text.replace(/^https?:\/\/(www\.)?/i, '').split(/[?#]/)[0];
      if (urlTitle.length > 60) urlTitle = urlTitle.substring(0, 57) + '...';
      return '[' + urlTitle + '](' + text + ')';
    }

    // Image file path (local or relative) → markdown image embed
    if (/\.(png|jpe?g|gif|svg|webp|bmp|ico|tiff?)$/i.test(text) && !/\n/.test(text)) {
      return '![' + text.split('/').pop().split('\\').pop() + '](' + text + ')';
    }

    // Marp slide separators (--- on its own line) → split into multiple cards note
    if (/^---\s*$/m.test(text) && text.indexOf('\n') !== -1) {
      var lines = text.split('\n');
      var hasMultipleSlides = 0;
      for (var i = 0; i < lines.length; i++) {
        if (/^---\s*$/.test(lines[i])) hasMultipleSlides++;
      }
      if (hasMultipleSlides >= 1) {
        // Keep the content as-is; presentation slides are valid card content
        return text;
      }
    }

    // Multi-line text with bullet points or numbered lists → keep as markdown
    if (/^(\s*[-*+]\s|\s*\d+\.\s)/m.test(text)) {
      return text;
    }

    // Multi-line text starting with # → keep as markdown headings
    if (/^#{1,6}\s/m.test(text)) {
      return text;
    }

    // Everything else → use as-is
    return text;
  }

  // --- Card & Pointer DnD (delegated to LexeraDragDropHandlers module) ---
  var DRAG_THRESHOLD = 5;
  function lockBoardLayoutForDrag() { if (DragDropHandlers) DragDropHandlers.lockBoardLayoutForDrag(); }
  function unlockBoardLayoutForDrag() { if (DragDropHandlers) DragDropHandlers.unlockBoardLayoutForDrag(); }
  function startCardDrag(e) { if (DragDropHandlers) DragDropHandlers.startCardDrag(e); }
  function updateCardDropTarget(mx, my) { return DragDropHandlers ? DragDropHandlers.updateCardDropTarget(mx, my) : false; }
  function applyCardDropByPoint(source, mx, my) { return DragDropHandlers ? DragDropHandlers.applyCardDropByPoint(source, mx, my) : false; }
  function finishCardDrag(mx, my) { if (DragDropHandlers) DragDropHandlers.finishCardDrag(mx, my); }
  function cancelCardDrag() { if (DragDropHandlers) DragDropHandlers.cancelCardDrag(); }
  function cleanupCardDrag() { if (DragDropHandlers) DragDropHandlers.cleanupCardDrag(); }
  function clearCardDropIndicators() { if (DragDropHandlers) DragDropHandlers.clearCardDropIndicators(); }
  function showCardDropIndicator(cardsEl, insertIdx) { if (DragDropHandlers) DragDropHandlers.showCardDropIndicator(cardsEl, insertIdx); }
  function findCardInsertIndex(mouseY, cardsEl) { return DragDropHandlers ? DragDropHandlers.findCardInsertIndex(mouseY, cardsEl) : 0; }
  function clearHeaderDropTargetHighlights() { if (DragDropHandlers) DragDropHandlers.clearHeaderDropTargetHighlights(); }
  function clearCardDragOverHighlights() { if (DragDropHandlers) DragDropHandlers.clearCardDragOverHighlights(); }
  function clearSidebarDropHighlights() { if (DragDropHandlers) DragDropHandlers.clearSidebarDropHighlights(); }
  function isPointInsideRect(mx, my, rect) { return DragDropHandlers ? DragDropHandlers.isPointInsideRect(mx, my, rect) : false; }
  function findNodeAtPoint(nodeList, mx, my) { return DragDropHandlers ? DragDropHandlers.findNodeAtPoint(nodeList, mx, my) : null; }
  function removeClassFromNodeList(nodeList, className) { if (DragDropHandlers) DragDropHandlers.removeClassFromNodeList(nodeList, className); }
  function removeClassesFromNodeList(nodeList, classNames) { if (DragDropHandlers) DragDropHandlers.removeClassesFromNodeList(nodeList, classNames); }
  function findStackDropZoneAt(mx, my) { return DragDropHandlers ? DragDropHandlers.findStackDropZoneAt(mx, my) : null; }
  function findDraggableColumnAt(mx, my) { return DragDropHandlers ? DragDropHandlers.findDraggableColumnAt(mx, my) : null; }
  function findBoardStackAt(mx, my) { return DragDropHandlers ? DragDropHandlers.findBoardStackAt(mx, my) : null; }
  function findColumnCardsContainerAt(mx, my) { return DragDropHandlers ? DragDropHandlers.findColumnCardsContainerAt(mx, my) : null; }
  function findSidebarColumnAt(mx, my) { return DragDropHandlers ? DragDropHandlers.findSidebarColumnAt(mx, my) : null; }
  function resolveCardDropTarget(mx, my) { return DragDropHandlers ? DragDropHandlers.resolveCardDropTarget(mx, my) : null; }
  function resolveDropTarget(nodeList, mx, my, vertical) { return DragDropHandlers ? DragDropHandlers.resolveDropTarget(nodeList, mx, my, vertical) : null; }
  function resolveDropTargetStrict(nodeList, mx, my, vertical) { return DragDropHandlers ? DragDropHandlers.resolveDropTargetStrict(nodeList, mx, my, vertical) : null; }
  function resolveRowBodyDropTarget(mx, my) { return DragDropHandlers ? DragDropHandlers.resolveRowBodyDropTarget(mx, my) : null; }
  function resolveCanvasRowContentDropTarget(mx, my) { return DragDropHandlers ? DragDropHandlers.resolveCanvasRowContentDropTarget(mx, my) : null; }
  function resolveHeaderDropTag(mx, my) { return DragDropHandlers ? DragDropHandlers.resolveHeaderDropTag(mx, my) : null; }
  function getPtrDragLabel() { return DragDropHandlers ? DragDropHandlers.getPtrDragLabel() : 'Drag'; }
  function updatePtrDropTarget(mx, my) { return DragDropHandlers ? DragDropHandlers.updatePtrDropTarget(mx, my) : false; }
  function updatePtrDropTargetByType(type, mx, my) { return DragDropHandlers ? DragDropHandlers.updatePtrDropTargetByType(type, mx, my) : false; }
  function updateColumnPtrDropTarget(mx, my) { return DragDropHandlers ? DragDropHandlers.updateColumnPtrDropTarget(mx, my) : false; }
  function clearPtrDropIndicators() { if (DragDropHandlers) DragDropHandlers.clearPtrDropIndicators(); }
  function executePtrDrop(mx, my) { if (DragDropHandlers) DragDropHandlers.executePtrDrop(mx, my); }
  function executeColumnPtrDrop(mx, my, src) { if (DragDropHandlers) DragDropHandlers.executeColumnPtrDrop(mx, my, src); }
  function cleanupPtrDrag() { if (DragDropHandlers) DragDropHandlers.cleanupPtrDrag(); }
  function applyPtrDragHiddenTag(type, src, tag) { if (DragDropHandlers) return DragDropHandlers.applyPtrDragHiddenTag(type, src, tag); }
  function applyRowDropByPoint(source, mx, my) { return DragDropHandlers ? DragDropHandlers.applyRowDropByPoint(source, mx, my) : false; }
  function applyStackDropByPoint(source, mx, my) { return DragDropHandlers ? DragDropHandlers.applyStackDropByPoint(source, mx, my) : false; }
  function applyCanvasStackDrop(source, mx, my) { return DragDropHandlers ? DragDropHandlers.applyCanvasStackDrop(source, mx, my) : false; }
  function getRowDropTarget(mx, my) { return DragDropHandlers ? DragDropHandlers.getRowDropTarget(mx, my) : null; }
  function getStackDropTarget(mx, my) { return DragDropHandlers ? DragDropHandlers.getStackDropTarget(mx, my) : null; }
  function getTreeColumnDropTarget(mx, my) { return DragDropHandlers ? DragDropHandlers.getTreeColumnDropTarget(mx, my) : null; }
  function getTreeStackDropTarget(mx, my) { return DragDropHandlers ? DragDropHandlers.getTreeStackDropTarget(mx, my) : null; }
  function getTreeCardDropTarget(mx, my) { return DragDropHandlers ? DragDropHandlers.getTreeCardDropTarget(mx, my) : null; }
  function getCanvasDropPositionInRowContent(rowContent, clientX, clientY, grabOffsetX, grabOffsetY) { return DragDropHandlers ? DragDropHandlers.getCanvasDropPositionInRowContent(rowContent, clientX, clientY, grabOffsetX, grabOffsetY) : { x: 0, y: 0 }; }
  function getCanvasRowContentNodeFromDropTarget(target, fallbackNode) { return DragDropHandlers ? DragDropHandlers.getCanvasRowContentNodeFromDropTarget(target, fallbackNode) : fallbackNode; }
  function clearCanvasDragStyles(stackEl) { if (DragDropHandlers) DragDropHandlers.clearCanvasDragStyles(stackEl); }
  function startCrossViewBridge(kind) { if (DragDropHandlers) DragDropHandlers.startCrossViewBridge(kind); }
  function stopCrossViewBridge() { if (DragDropHandlers) DragDropHandlers.stopCrossViewBridge(); }
  function toTopFramePoint(win, x, y) { return DragDropHandlers ? DragDropHandlers.toTopFramePoint(win, x, y) : null; }
  function ptrFindHitNode(nodeList, mx, my, classBefore, classAfter, vertical) { return DragDropHandlers ? DragDropHandlers.ptrFindHitNode(nodeList, mx, my, classBefore, classAfter, vertical) : null; }
  function ptrFindStrictHitNode(nodeList, mx, my, classBefore, classAfter, vertical) { return DragDropHandlers ? DragDropHandlers.ptrFindStrictHitNode(nodeList, mx, my, classBefore, classAfter, vertical) : null; }
  function ptrFindDropTarget(nodeList, mx, my, vertical) { return DragDropHandlers ? DragDropHandlers.ptrFindDropTarget(nodeList, mx, my, vertical) : null; }
  function getVisibleCardCountInColumn(col) { return DragDropHandlers ? DragDropHandlers.getVisibleCardCountInColumn(col) : 0; }
  function buildSidebarCardTarget(boardId, rowIdx, stackIdx, colIdx, sidebarNode) { return DragDropHandlers ? DragDropHandlers.buildSidebarCardTarget(boardId, rowIdx, stackIdx, colIdx, sidebarNode) : null; }
  function getFirstSidebarCardTargetForBoard(boardId, sidebarNode) { return DragDropHandlers ? DragDropHandlers.getFirstSidebarCardTargetForBoard(boardId, sidebarNode) : null; }
  function getSourceRowIndex(source) { return DragDropHandlers ? DragDropHandlers.getSourceRowIndex(source) : -1; }
  function getColumnCardsContainers() { return getElColumnsContainer().querySelectorAll('.column-cards'); }
  function registerExternalDndBridge() { if (DragDropHandlers) DragDropHandlers.registerExternalDndBridge(); }


  // --- Pointer-based DnD event listeners for rows/stacks/columns/boards ---
  getElBoardList().addEventListener('mousedown', function (e) {
    try {
    if (e.button !== 0) return;
    var ptrDrag = DragDropHandlers ? DragDropHandlers.getPtrDrag() : null;
    var cardDrag = DragDropHandlers ? DragDropHandlers.getCardDrag() : null;
    if (ptrDrag || cardDrag) return;

    var grip = e.target.closest('.tree-grip');
    if (!grip) return;

    var treeNode = grip.closest('.tree-node[data-tree-drag]');
    if (treeNode) {
      var dragType = treeNode.getAttribute('data-tree-drag');
      var ownerBoardId = treeNode.getAttribute('data-board-id');
      if (!ownerBoardId) {
        var ownerWrapper = treeNode.closest('.board-item-wrapper');
        ownerBoardId = ownerWrapper ? ownerWrapper.getAttribute('data-board-id') : null;
      }
      var source = { type: dragType, boardId: ownerBoardId || activeBoardId };
      if (dragType === 'tree-row') {
        source.rowIndex = parseInt(treeNode.getAttribute('data-row-index'), 10);
        source.indexMode = source.boardId === activeBoardId ? 'display' : 'full';
      } else if (dragType === 'tree-stack') {
        source.rowIndex = parseInt(treeNode.getAttribute('data-row-index'), 10);
        source.stackIndex = parseInt(treeNode.getAttribute('data-stack-index'), 10);
        source.indexMode = source.boardId === activeBoardId ? 'display' : 'full';
      } else if (dragType === 'tree-column') {
        source.rowIndex = parseInt(treeNode.getAttribute('data-row-index'), 10);
        source.stackIndex = parseInt(treeNode.getAttribute('data-stack-index'), 10);
        source.colIndex = parseInt(treeNode.getAttribute('data-col-local-index'), 10);
        source.indexMode = source.boardId === activeBoardId ? 'display' : 'full';
      } else if (dragType === 'tree-card') {
        source.rowIndex = parseInt(treeNode.getAttribute('data-row-index'), 10);
        source.stackIndex = parseInt(treeNode.getAttribute('data-stack-index'), 10);
        source.colIndex = parseInt(treeNode.getAttribute('data-col-local-index'), 10);
        source.flatColIndex = parseInt(treeNode.getAttribute('data-col-index'), 10);
        source.cardIndex = parseInt(treeNode.getAttribute('data-card-index'), 10);
        source.cardIndexMode = source.boardId === activeBoardId ? 'visible' : 'full';
        source.indexMode = source.boardId === activeBoardId ? 'display' : 'full';
      }
      var newPtrDrag = { type: dragType, source: source, startX: e.clientX, startY: e.clientY, startTopX: null, startTopY: null, started: false, ghost: null, el: treeNode };
      var treeStartTop = toTopFramePoint(window, e.clientX, e.clientY);
      if (treeStartTop) {
        newPtrDrag.startTopX = treeStartTop.x;
        newPtrDrag.startTopY = treeStartTop.y;
      }
      DragDropHandlers.setPtrDrag(newPtrDrag);
      startCrossViewBridge('ptr');
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    var boardItem = grip.closest('.board-item');
    if (boardItem) {
      var boardIndex = parseInt(boardItem.getAttribute('data-board-index'), 10);
      if (isNaN(boardIndex)) return;
      var newPtrDrag = { type: 'board', source: { type: 'board', index: boardIndex }, startX: e.clientX, startY: e.clientY, startTopX: null, startTopY: null, started: false, ghost: null, el: boardItem };
      var boardStartTop = toTopFramePoint(window, e.clientX, e.clientY);
      if (boardStartTop) {
        newPtrDrag.startTopX = boardStartTop.x;
        newPtrDrag.startTopY = boardStartTop.y;
      }
      DragDropHandlers.setPtrDrag(newPtrDrag);
      startCrossViewBridge('ptr');
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    } catch (err) {
      logFrontendIssue('error', 'drag.ptr', 'Error in sidebar mousedown handler', err);
    }
  });

  getElColumnsContainer().addEventListener('click', function (e) {
    try {
      var columnFoldBtn = targetClosest(e.target, '.column-fold-btn');
      if (columnFoldBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleColumnFoldElement(targetClosest(columnFoldBtn, '.column'), !!e.altKey);
        return;
      }

      var stackFoldBtn = targetClosest(e.target, '.stack-fold-btn');
      if (stackFoldBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleStackFoldElement(targetClosest(stackFoldBtn, '.board-stack'), !!e.altKey);
        return;
      }

      var rowFoldBtn = targetClosest(e.target, '.row-fold-btn');
      if (rowFoldBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleRowFoldElement(targetClosest(rowFoldBtn, '.board-row'), !!e.altKey);
      }
    } catch (err) {
      logFrontendIssue('error', 'fold.click', 'Error in delegated fold click handler', err);
    }
  });

  getElColumnsContainer().addEventListener('mousedown', function (e) {
    try {
    if (e.button !== 0) return;
    var ptrDrag = DragDropHandlers ? DragDropHandlers.getPtrDrag() : null;
    var cardDrag = DragDropHandlers ? DragDropHandlers.getCardDrag() : null;
    if (ptrDrag || cardDrag) return;
    if (e.target.closest('.board-row-title, .board-stack-title, .column-title')) return;
    if (e.target.closest('button, input, textarea, select, a, .column-rename-input, .card-menu-btn, .card-collapse-toggle, .card-checkbox')) {
      return;
    }

    var rowHeader = e.target.closest('.board-row-header');
    if (rowHeader) {
      var rowEl = rowHeader.closest('.board-row');
      var rowIdx = parseInt(rowEl.getAttribute('data-row-index'), 10);
      var newPtrDrag = { type: 'board-row', source: { type: 'board-row', boardId: activeBoardId, rowIndex: rowIdx, indexMode: 'display' }, startX: e.clientX, startY: e.clientY, startTopX: null, startTopY: null, started: false, ghost: null, el: rowEl };
      var rowStartTop = toTopFramePoint(window, e.clientX, e.clientY);
      if (rowStartTop) {
        newPtrDrag.startTopX = rowStartTop.x;
        newPtrDrag.startTopY = rowStartTop.y;
      }
      DragDropHandlers.setPtrDrag(newPtrDrag);
      startCrossViewBridge('ptr');
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    var stackHeader = e.target.closest('.board-stack-header');
    if (stackHeader) {
      var stackEl = stackHeader.closest('.board-stack');
      var rowIdx = parseInt(stackEl.getAttribute('data-row-index'), 10);
      var stackIdx = parseInt(stackEl.getAttribute('data-stack-index'), 10);
      var stackRect = stackEl.getBoundingClientRect();
      var rowContentEl = stackEl.closest('.board-row-content');
      var newPtrDrag = {
        type: 'board-stack',
        source: { type: 'board-stack', boardId: activeBoardId, rowIndex: rowIdx, stackIndex: stackIdx, indexMode: 'display' },
        startX: e.clientX,
        startY: e.clientY,
        startTopX: null,
        startTopY: null,
        started: false,
        ghost: null,
        el: stackEl,
        grabOffsetX: e.clientX - stackRect.left,
        grabOffsetY: e.clientY - stackRect.top,
        canvasSourceRowContent: rowContentEl || null
      };
      var stackStartTop = toTopFramePoint(window, e.clientX, e.clientY);
      if (stackStartTop) {
        newPtrDrag.startTopX = stackStartTop.x;
        newPtrDrag.startTopY = stackStartTop.y;
      }
      DragDropHandlers.setPtrDrag(newPtrDrag);
      startCrossViewBridge('ptr');
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    var columnHeader = e.target.closest('.column-header');
    if (columnHeader) {
      var colEl = columnHeader.closest('.column');
      var stackEl = colEl.closest('.board-stack');
      var rowIdx = parseInt(stackEl.getAttribute('data-row-index'), 10);
      var stackIdx = parseInt(stackEl.getAttribute('data-stack-index'), 10);
      var columns = stackEl.querySelectorAll('.board-stack-content > .column');
      var colIdx = Array.prototype.indexOf.call(columns, colEl);
      var newPtrDrag = {
        type: 'column',
        source: {
          type: 'column',
          boardId: activeBoardId,
          rowIndex: rowIdx,
          stackIndex: stackIdx,
          colIndex: colIdx,
          indexMode: 'display'
        },
        startX: e.clientX,
        startY: e.clientY,
        startTopX: null,
        startTopY: null,
        started: false,
        ghost: null,
        el: colEl
      };
      var colStartTop = toTopFramePoint(window, e.clientX, e.clientY);
      if (colStartTop) {
        newPtrDrag.startTopX = colStartTop.x;
        newPtrDrag.startTopY = colStartTop.y;
      }
      DragDropHandlers.setPtrDrag(newPtrDrag);
      startCrossViewBridge('ptr');
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    } catch (err) {
      logFrontendIssue('error', 'drag.ptr', 'Error in board mousedown handler', err);
    }
  });

  // Pointer drag: mousemove
  document.addEventListener('mousemove', function (e) {
    var ptrDrag = DragDropHandlers ? DragDropHandlers.getPtrDrag() : null;
    if (!ptrDrag) return;
    try {
    if (!ptrDrag.started) {
      var dx = e.clientX - ptrDrag.startX;
      var dy = e.clientY - ptrDrag.startY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      ptrDrag.started = true;
      if (ptrDrag.type === 'board-stack' && isCanvasBoardLayout()) {
        ptrDrag.canvasMove = true;
        ptrDrag.el.classList.add('dragging');
        ptrDrag.el.style.pointerEvents = 'none';
        ptrDrag.el.style.zIndex = '100';
        var sel = window.getSelection();
        if (sel) sel.removeAllRanges();
        return;
      }
      vsMaterialiseAll();
      ptrDrag.el.classList.add('dragging');
      var lockableDragType =
        ptrDrag.type === 'board-row' ||
        ptrDrag.type === 'tree-row' ||
        ptrDrag.type === 'board-stack' ||
        ptrDrag.type === 'tree-stack' ||
        ptrDrag.type === 'column' ||
        ptrDrag.type === 'tree-column' ||
        ptrDrag.type === 'tree-card';
      if (lockableDragType) {
        lockBoardLayoutForDrag();
      }
      startCrossViewBridge('ptr');
      if (ptrDrag.type === 'column' || ptrDrag.type === 'tree-column') {
        insertStackDropZones();
      }
      insertDropZoneIndicators(ptrDrag.type);

      var ghost = document.createElement('div');
      ghost.className = 'card-drag-ghost';
      ghost.textContent = getPtrDragLabel();
      ghost.style.left = (e.clientX + 8) + 'px';
      ghost.style.top = (e.clientY - 12) + 'px';
      document.body.appendChild(ghost);
      ptrDrag.ghost = ghost;

      var sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    }

    if (ptrDrag.canvasMove) {
      clearPtrDropIndicators();
      var canvasHeaderTag = resolveHeaderDropTag(e.clientX, e.clientY);
      var canvasRowTarget;
      if (canvasHeaderTag) {
        var canvasHeaderBtnId = canvasHeaderTag === '#hidden-internal-incoming' ? 'btn-incoming'
          : canvasHeaderTag === '#hidden-internal-parked' ? 'btn-parked'
          : canvasHeaderTag === '#hidden-internal-archived' ? 'btn-archived' : 'btn-trash';
        var canvasHeaderBtn = document.getElementById(canvasHeaderBtnId);
        if (canvasHeaderBtn) canvasHeaderBtn.classList.add('drop-target');
      } else {
        canvasRowTarget = resolveCanvasRowContentDropTarget(e.clientX, e.clientY);
        if (canvasRowTarget && canvasRowTarget.node) canvasRowTarget.node.classList.add('drop-target');
      }

      var activeCanvasRowContent = getCanvasRowContentNodeFromDropTarget(
        canvasRowTarget,
        ptrDrag.canvasSourceRowContent || ptrDrag.el.closest('.board-row-content')
      );
      if (!activeCanvasRowContent) return;
      var nextCanvasPos = getCanvasDropPositionInRowContent(
        activeCanvasRowContent,
        e.clientX,
        e.clientY,
        ptrDrag.grabOffsetX,
        ptrDrag.grabOffsetY
      );
      ptrDrag.el.style.left = Math.round(nextCanvasPos.x) + 'px';
      ptrDrag.el.style.top = Math.round(nextCanvasPos.y) + 'px';
      return;
    }

    if (ptrDrag.ghost) {
      ptrDrag.ghost.style.left = (e.clientX + 8) + 'px';
      ptrDrag.ghost.style.top = (e.clientY - 12) + 'px';
    }

    updatePtrDropTarget(e.clientX, e.clientY);
    } catch (err) {
      logFrontendIssue('error', 'drag.ptr', 'Error in ptr mousemove handler', err);
      cleanupPtrDrag();
    }
  });

  // Pointer drag: mouseup
  document.addEventListener('mouseup', function (e) {
    var ptrDrag = DragDropHandlers ? DragDropHandlers.getPtrDrag() : null;
    if (!ptrDrag) return;
    try {
    if (!ptrDrag.started) {
      DragDropHandlers.setPtrDrag(null);
      stopCrossViewBridge();
      return;
    }
    executePtrDrop(e.clientX, e.clientY);
    cleanupPtrDrag();
    } catch (err) {
      logFrontendIssue('error', 'drag.ptr', 'Error in ptr mouseup handler', err);
      cleanupPtrDrag();
    }
  });

  // Safety net for interrupted drags (window focus loss, tab hide).
  window.addEventListener('blur', function () {
    var ptrDrag = DragDropHandlers ? DragDropHandlers.getPtrDrag() : null;
    var dragLayoutLocks = DragDropHandlers ? DragDropHandlers.getDragLayoutLocks() : null;
    if (ptrDrag || dragLayoutLocks) {
      var wasCanvas = ptrDrag && ptrDrag.canvasMove;
      cleanupPtrDrag();
      if (wasCanvas) renderColumns();
    }
  });
  document.addEventListener('visibilitychange', function () {
    var ptrDrag = DragDropHandlers ? DragDropHandlers.getPtrDrag() : null;
    var dragLayoutLocks = DragDropHandlers ? DragDropHandlers.getDragLayoutLocks() : null;
    if (document.visibilityState === 'hidden' && (ptrDrag || dragLayoutLocks)) {
      var wasCanvas = ptrDrag && ptrDrag.canvasMove;
      cleanupPtrDrag();
      if (wasCanvas) renderColumns();
    }
  });

  window.addEventListener('resize', function () {
    if (!isCanvasBoardLayout()) return;
    var container = getElColumnsContainer();
    if (!container) return;
    scheduleCanvasRowBoundsSync(container);
    scheduleCanvasFocusStacksControlSync(container);
  });

  function resolveColumnLocationForMutation(boardId, boardData, rowIndex, stackIndex, colIndex, indexMode) {
    if (!boardData || !boardData.rows) return null;
    if (indexMode === 'display' && boardId === activeBoardId) {
      var row = findFullDataRow(rowIndex);
      var stack = findFullDataStack(rowIndex, stackIndex);
      if (!row || !stack) return null;
      var fullColIdx = findFullColumnIndexInStack(stack, colIndex);
      if (fullColIdx === -1) return null;
      return {
        row: row,
        stack: stack,
        rowIndex: fullBoardData.rows.indexOf(row),
        stackIndex: row.stacks.indexOf(stack),
        colIndex: fullColIdx
      };
    }
    if (indexMode === 'display') {
      var displayRow = boardData.rows[rowIndex];
      if (!displayRow || !displayRow.stacks || stackIndex < 0 || stackIndex >= displayRow.stacks.length) return null;
      var displayStack = displayRow.stacks[stackIndex];
      if (!displayStack || !displayStack.columns) return null;
      var mappedColIdx = findFullColumnIndexInStack(displayStack, colIndex);
      if (mappedColIdx === -1) return null;
      return {
        row: displayRow,
        stack: displayStack,
        rowIndex: rowIndex,
        stackIndex: stackIndex,
        colIndex: mappedColIdx
      };
    }
    var targetRow = boardData.rows[rowIndex];
    if (!targetRow || !targetRow.stacks || stackIndex < 0 || stackIndex >= targetRow.stacks.length) return null;
    var targetStack = targetRow.stacks[stackIndex];
    if (!targetStack || !targetStack.columns || colIndex < 0 || colIndex >= targetStack.columns.length) return null;
    return {
      row: targetRow,
      stack: targetStack,
      rowIndex: rowIndex,
      stackIndex: stackIndex,
      colIndex: colIndex
    };
  }

  function resolveStackForMutation(boardId, boardData, rowIndex, stackIndex, indexMode) {
    if (!boardData || !boardData.rows) return null;
    if (indexMode === 'display' && boardId === activeBoardId) {
      var row = findFullDataRow(rowIndex);
      var stack = findFullDataStack(rowIndex, stackIndex);
      if (!row || !stack) return null;
      return {
        row: row,
        stack: stack,
        rowIndex: fullBoardData.rows.indexOf(row),
        stackIndex: row.stacks.indexOf(stack)
      };
    }
    var targetRow = boardData.rows[rowIndex];
    if (!targetRow || !targetRow.stacks || stackIndex < 0 || stackIndex >= targetRow.stacks.length) return null;
    return {
      row: targetRow,
      stack: targetRow.stacks[stackIndex],
      rowIndex: rowIndex,
      stackIndex: stackIndex
    };
  }

  function resolveRowForMutation(boardId, boardData, rowIndex, indexMode) {
    if (!boardData || !boardData.rows) return null;
    if (indexMode === 'display' && boardId === activeBoardId) {
      var row = findFullDataRow(rowIndex);
      if (!row) return null;
      return { row: row, rowIndex: fullBoardData.rows.indexOf(row) };
    }
    if (rowIndex < 0 || rowIndex >= boardData.rows.length) return null;
    return { row: boardData.rows[rowIndex], rowIndex: rowIndex };
  }

  async function moveRowAcrossBoards(source, target) {
    if (!source || !target || !source.boardId || !target.boardId) return;

    var sourceBoardId = source.boardId;
    var targetBoardId = target.boardId;
    var sourceBoardData = await loadBoardDataForMutation(sourceBoardId);
    if (!sourceBoardData) return;
    var targetBoardData = sourceBoardId === targetBoardId
      ? sourceBoardData
      : await loadBoardDataForMutation(targetBoardId);
    if (!targetBoardData) return;

    var sourceRowInfo = resolveRowForMutation(
      sourceBoardId,
      sourceBoardData,
      source.rowIndex,
      source.indexMode || 'full'
    );
    if (!sourceRowInfo || !sourceRowInfo.row) return;

    var targetRowInfo = resolveRowForMutation(
      targetBoardId,
      targetBoardData,
      target.rowIndex,
      target.indexMode || 'full'
    );

    var activeTouched = sourceBoardId === activeBoardId || targetBoardId === activeBoardId;
    if (activeTouched && fullBoardData) pushUndo();

    var movedRow = sourceBoardData.rows.splice(sourceRowInfo.rowIndex, 1)[0];
    if (!movedRow) return;

    var insertAt = targetBoardData.rows.length;
    if (targetRowInfo && targetRowInfo.row) {
      insertAt = target.before ? targetRowInfo.rowIndex : (targetRowInfo.rowIndex + 1);
      if (sourceBoardData === targetBoardData && sourceRowInfo.rowIndex < insertAt) insertAt--;
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > targetBoardData.rows.length) insertAt = targetBoardData.rows.length;

    if (sourceBoardData === targetBoardData && insertAt === sourceRowInfo.rowIndex) {
      sourceBoardData.rows.splice(sourceRowInfo.rowIndex, 0, movedRow);
      return;
    }

    targetBoardData.rows.splice(insertAt, 0, movedRow);

    removeEmptyStacksAndRowsInBoard(sourceBoardData);
    if (sourceBoardData !== targetBoardData) removeEmptyStacksAndRowsInBoard(targetBoardData);

    var changedRows = {};
    changedRows[sourceBoardId] = sourceBoardData;
    if (targetBoardId !== sourceBoardId) changedRows[targetBoardId] = targetBoardData;
    await commitBoardMutations(changedRows, { refreshSidebar: true });
  }

  async function moveStackAcrossBoards(source, target) {
    if (!source || !target || !source.boardId || !target.boardId) return;

    var sourceBoardId = source.boardId;
    var targetBoardId = target.boardId;
    var sourceBoardData = await loadBoardDataForMutation(sourceBoardId);
    if (!sourceBoardData) return;
    var targetBoardData = sourceBoardId === targetBoardId
      ? sourceBoardData
      : await loadBoardDataForMutation(targetBoardId);
    if (!targetBoardData) return;

    var sourceStackInfo = resolveStackForMutation(
      sourceBoardId,
      sourceBoardData,
      source.rowIndex,
      source.stackIndex,
      source.indexMode || 'full'
    );
    if (!sourceStackInfo || !sourceStackInfo.stack || !sourceStackInfo.row) return;

    var activeTouched = sourceBoardId === activeBoardId || targetBoardId === activeBoardId;
    var targetRowInfo = null;
    if (target.kind !== 'new-row') {
      targetRowInfo = resolveRowForMutation(
        targetBoardId,
        targetBoardData,
        target.rowIndex,
        target.indexMode || 'full'
      );
    }
    if (
      target.kind === 'row' &&
      targetRowInfo &&
      targetRowInfo.row &&
      sourceBoardData === targetBoardData &&
      sourceStackInfo.row === targetRowInfo.row &&
      target.canvasPosition
    ) {
      if (activeTouched && fullBoardData) pushUndo();
      getCanvasStackDropApi().applyCanvasDropPositionToStack(
        targetBoardId,
        activeBoardId,
        isCanvasBoardLayout(),
        target,
        sourceStackInfo.stack
      );
      var changedCanvasPlacement = {};
      changedCanvasPlacement[sourceBoardId] = sourceBoardData;
      await commitBoardMutations(changedCanvasPlacement, { refreshSidebar: true });
      return;
    }
    if (activeTouched && fullBoardData) pushUndo();

    var movedStack = sourceStackInfo.row.stacks.splice(sourceStackInfo.stackIndex, 1)[0];
    if (!movedStack) return;
    getCanvasStackDropApi().applyCanvasDropPositionToStack(
      targetBoardId,
      activeBoardId,
      isCanvasBoardLayout(),
      target,
      movedStack
    );

    if (target.kind === 'new-row') {
      insertUnnamedRowForMutation(targetBoardId, targetBoardData, target, [movedStack]);
      removeEmptyStacksAndRowsInBoard(sourceBoardData);
      if (sourceBoardData !== targetBoardData) removeEmptyStacksAndRowsInBoard(targetBoardData);
      var changedNewRows = {};
      changedNewRows[sourceBoardId] = sourceBoardData;
      if (targetBoardId !== sourceBoardId) changedNewRows[targetBoardId] = targetBoardData;
      await commitBoardMutations(changedNewRows, { refreshSidebar: true });
      return;
    }

    if (!targetRowInfo || !targetRowInfo.row || !targetRowInfo.row.stacks) {
      sourceStackInfo.row.stacks.splice(sourceStackInfo.stackIndex, 0, movedStack);
      return;
    }

    if (target.kind === 'row') {
      targetRowInfo.row.stacks.push(movedStack);
      removeEmptyStacksAndRowsInBoard(sourceBoardData);
      if (sourceBoardData !== targetBoardData) removeEmptyStacksAndRowsInBoard(targetBoardData);
      var changedRows = {};
      changedRows[sourceBoardId] = sourceBoardData;
      if (targetBoardId !== sourceBoardId) changedRows[targetBoardId] = targetBoardData;
      await commitBoardMutations(changedRows, { refreshSidebar: true });
      return;
    }

    var targetStackInfo = resolveStackForMutation(
      targetBoardId,
      targetBoardData,
      target.rowIndex,
      target.stackIndex,
      target.indexMode || 'full'
    );

    var insertAt = targetRowInfo.row.stacks.length;
    if (targetStackInfo && targetStackInfo.stack) {
      insertAt = target.before ? targetStackInfo.stackIndex : (targetStackInfo.stackIndex + 1);
      if (sourceBoardData === targetBoardData && sourceStackInfo.row === targetRowInfo.row && sourceStackInfo.stackIndex < insertAt) {
        insertAt--;
      }
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > targetRowInfo.row.stacks.length) insertAt = targetRowInfo.row.stacks.length;

    if (sourceBoardData === targetBoardData && sourceStackInfo.row === targetRowInfo.row && insertAt === sourceStackInfo.stackIndex) {
      sourceStackInfo.row.stacks.splice(sourceStackInfo.stackIndex, 0, movedStack);
      return;
    }

    targetRowInfo.row.stacks.splice(insertAt, 0, movedStack);

    removeEmptyStacksAndRowsInBoard(sourceBoardData);
    if (sourceBoardData !== targetBoardData) removeEmptyStacksAndRowsInBoard(targetBoardData);

    var changedStacks = {};
    changedStacks[sourceBoardId] = sourceBoardData;
    if (targetBoardId !== sourceBoardId) changedStacks[targetBoardId] = targetBoardData;
    await commitBoardMutations(changedStacks, { refreshSidebar: true });
  }

  async function moveColumnAcrossBoards(source, target) {
    if (!source || !target || !source.boardId || !target.boardId) { lexeraLogWithTarget('warn', 'COL-XBOARD', 'abort: missing source/target boardId'); return; }

    var sourceBoardId = source.boardId;
    var targetBoardId = target.boardId;
    var sourceBoardData = await loadBoardDataForMutation(sourceBoardId);
    if (!sourceBoardData) { lexeraLogWithTarget('warn', 'COL-XBOARD', 'abort: no sourceBoardData'); return; }
    var targetBoardData = sourceBoardId === targetBoardId
      ? sourceBoardData
      : await loadBoardDataForMutation(targetBoardId);
    if (!targetBoardData) { lexeraLogWithTarget('warn', 'COL-XBOARD', 'abort: no targetBoardData'); return; }

    var sourceLoc = resolveColumnLocationForMutation(
      sourceBoardId,
      sourceBoardData,
      source.rowIndex,
      source.stackIndex,
      source.colIndex,
      source.indexMode || 'full'
    );
    if (!sourceLoc || !sourceLoc.stack || !sourceLoc.stack.columns) { lexeraLogWithTarget('warn', 'COL-XBOARD', 'abort: sourceLoc not resolved'); return; }

    var activeTouched = sourceBoardId === activeBoardId || targetBoardId === activeBoardId;
    if (activeTouched && fullBoardData) pushUndo();

    var movedColumn = sourceLoc.stack.columns.splice(sourceLoc.colIndex, 1)[0];
    if (!movedColumn) return;

    var insertStack = null;
    var insertAt = 0;

    if (target.kind === 'new-row') {
      var insertedRow = insertUnnamedRowForMutation(
        targetBoardId,
        targetBoardData,
        target,
        [createUnnamedStackForMutation([movedColumn])]
      );
      if (!insertedRow || !insertedRow.row) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
      removeEmptyStacksAndRowsInBoard(sourceBoardData);
      if (sourceBoardData !== targetBoardData) removeEmptyStacksAndRowsInBoard(targetBoardData);
      var changedNewRows = {};
      changedNewRows[sourceBoardId] = sourceBoardData;
      if (targetBoardId !== sourceBoardId) changedNewRows[targetBoardId] = targetBoardData;
      await commitBoardMutations(changedNewRows, { refreshSidebar: true });
      return;
    }

    if (target.kind === 'row') {
      var insertedStackInfo = insertUnnamedStackIntoRowForMutation(targetBoardId, targetBoardData, target);
      if (!insertedStackInfo || !insertedStackInfo.stack) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
      if (!insertedStackInfo.stack.columns) insertedStackInfo.stack.columns = [];
      insertedStackInfo.stack.columns.push(movedColumn);
      removeEmptyStacksAndRowsInBoard(sourceBoardData);
      if (sourceBoardData !== targetBoardData) removeEmptyStacksAndRowsInBoard(targetBoardData);
      var changedNewStacks = {};
      changedNewStacks[sourceBoardId] = sourceBoardData;
      if (targetBoardId !== sourceBoardId) changedNewStacks[targetBoardId] = targetBoardData;
      await commitBoardMutations(changedNewStacks, { refreshSidebar: true });
      return;
    }

    if (target.kind === 'new-stack') {
      var targetRowInfo = resolveRowForMutation(
        targetBoardId,
        targetBoardData,
        target.rowIndex,
        target.indexMode || 'full'
      );
      if (!targetRowInfo || !targetRowInfo.row || !targetRowInfo.row.stacks) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
      var newStack = {
        id: 'stack-' + Date.now(),
        title: '',
        columns: [movedColumn]
      };
      var stackInsertIdx;
      if (typeof target.insertAtStackIdx === 'number' && (target.indexMode || 'full') === 'display' && targetBoardId === activeBoardId) {
        stackInsertIdx = findInsertStackIndexInRow(targetRowInfo.row, target.rowIndex, target.insertAtStackIdx);
      } else if (typeof target.insertAtStackIdx === 'number') {
        stackInsertIdx = target.insertAtStackIdx;
      } else {
        stackInsertIdx = targetRowInfo.row.stacks.length;
      }
      if (stackInsertIdx < 0) stackInsertIdx = 0;
      if (stackInsertIdx > targetRowInfo.row.stacks.length) stackInsertIdx = targetRowInfo.row.stacks.length;
      targetRowInfo.row.stacks.splice(stackInsertIdx, 0, newStack);
      removeEmptyStacksAndRowsInBoard(sourceBoardData);
      if (sourceBoardData !== targetBoardData) removeEmptyStacksAndRowsInBoard(targetBoardData);
      var changedNewStackBoards = {};
      changedNewStackBoards[sourceBoardId] = sourceBoardData;
      if (targetBoardId !== sourceBoardId) changedNewStackBoards[targetBoardId] = targetBoardData;
      await commitBoardMutations(changedNewStackBoards, { refreshSidebar: true });
      return;
    }

    if (target.kind === 'stack') {
      var targetStackInfo = resolveStackForMutation(
        targetBoardId,
        targetBoardData,
        target.rowIndex,
        target.stackIndex,
        target.indexMode || 'full'
      );
      if (!targetStackInfo || !targetStackInfo.stack || !targetStackInfo.stack.columns) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
      insertStack = targetStackInfo.stack;
      insertAt = insertStack.columns.length;
    } else if (target.kind === 'column') {
      var targetStackForCol = resolveStackForMutation(
        targetBoardId,
        targetBoardData,
        target.rowIndex,
        target.stackIndex,
        target.indexMode || 'full'
      );
      if (!targetStackForCol || !targetStackForCol.stack || !targetStackForCol.stack.columns) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
      insertStack = targetStackForCol.stack;
      if (target.indexMode === 'display' && targetBoardId === activeBoardId) {
        insertAt = findInsertColumnIndexInStack(insertStack, target.colIndex, target.before);
      } else {
        insertAt = target.before ? target.colIndex : (target.colIndex + 1);
      }
    } else {
      sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
      return;
    }

    if (!insertStack || !insertStack.columns) {
      sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
      return;
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > insertStack.columns.length) insertAt = insertStack.columns.length;

    if (sourceBoardData === targetBoardData && sourceLoc.stack === insertStack) {
      if (sourceLoc.colIndex < insertAt) insertAt--;
      if (insertAt === sourceLoc.colIndex) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
    }

    insertStack.columns.splice(insertAt, 0, movedColumn);
    removeEmptyStacksAndRowsInBoard(sourceBoardData);
    if (sourceBoardData !== targetBoardData) removeEmptyStacksAndRowsInBoard(targetBoardData);

    var changed = {};
    changed[sourceBoardId] = sourceBoardData;
    if (targetBoardId !== sourceBoardId) changed[targetBoardId] = targetBoardData;
    await commitBoardMutations(changed, { refreshSidebar: true });
    return;
  }

  // --- Drop Zone Indicators --- (delegated to LexeraDropZoneIndicators module)
  function insertStackDropZones() { if (DropZoneIndicators) DropZoneIndicators.insertStackDropZones(); }
  function removeStackDropZones() { if (DropZoneIndicators) DropZoneIndicators.removeStackDropZones(); }
  function insertDropZoneIndicators(dragType) { if (DropZoneIndicators) DropZoneIndicators.insertDropZoneIndicators(dragType); }
  function removeDropZoneIndicators() { if (DropZoneIndicators) DropZoneIndicators.removeDropZoneIndicators(); }
  function clearDropZoneIndicatorHighlights() { if (DropZoneIndicators) DropZoneIndicators.clearDropZoneIndicatorHighlights(); }
  function highlightDropZoneIndicator(dragType, mx, my) { if (DropZoneIndicators) DropZoneIndicators.highlightDropZoneIndicator(dragType, mx, my); }


  function resolveColumnRefForCardMutation(boardId, boardData, descriptor) {
    if (!descriptor) return null;
    var indexMode = descriptor.indexMode || (boardId === activeBoardId ? 'display' : 'full');

    if (
      typeof descriptor.rowIndex === 'number' &&
      typeof descriptor.stackIndex === 'number' &&
      typeof descriptor.colIndex === 'number'
    ) {
      if (indexMode === 'display') {
        if (boardId === activeBoardId) {
          var activeDisplayStack = findFullDataStack(descriptor.rowIndex, descriptor.stackIndex);
          if (!activeDisplayStack) return null;
          var activeColIdx = findFullColumnIndexInStack(activeDisplayStack, descriptor.colIndex);
          if (activeColIdx === -1 || activeColIdx >= activeDisplayStack.columns.length) return null;
          return { column: activeDisplayStack.columns[activeColIdx], columnIndex: activeColIdx, stack: activeDisplayStack };
        }
        var displayRow = boardData.rows[descriptor.rowIndex];
        if (!displayRow || !displayRow.stacks || descriptor.stackIndex < 0 || descriptor.stackIndex >= displayRow.stacks.length) return null;
        var displayStack = displayRow.stacks[descriptor.stackIndex];
        if (!displayStack || !displayStack.columns) return null;
        var fullColIdx = findFullColumnIndexInStack(displayStack, descriptor.colIndex);
        if (fullColIdx === -1 || fullColIdx >= displayStack.columns.length) return null;
        return { column: displayStack.columns[fullColIdx], columnIndex: fullColIdx, stack: displayStack };
      }
      var treeCol = getBoardColumnByPath(boardData, descriptor.rowIndex, descriptor.stackIndex, descriptor.colIndex);
      if (!treeCol) return null;
      var treeStack = boardData.rows[descriptor.rowIndex].stacks[descriptor.stackIndex];
      return { column: treeCol, columnIndex: descriptor.colIndex, stack: treeStack };
    }

    var flatColIndex = null;
    if (typeof descriptor.flatColIndex === 'number') flatColIndex = descriptor.flatColIndex;
    else if (typeof descriptor.colIndex === 'number') flatColIndex = descriptor.colIndex;
    if (flatColIndex == null || isNaN(flatColIndex)) return null;

    var flatContainer = findColumnContainerInBoard(boardData, flatColIndex);
    if (!flatContainer) return null;
    return {
      column: flatContainer.arr[flatContainer.localIdx],
      columnIndex: flatContainer.localIdx,
      stack: flatContainer.stack
    };
  }

  function resolveSourceCardIndex(column, cardIndex, cardIndexMode) {
    if (!column || !column.cards || typeof cardIndex !== 'number') return -1;
    if (cardIndexMode === 'full') {
      return (cardIndex >= 0 && cardIndex < column.cards.length) ? cardIndex : -1;
    }
    return getFullCardIndex(column, cardIndex);
  }

  function resolveInsertCardIndex(column, insertIdx, insertMode) {
    if (!column || !column.cards) return -1;
    if (insertMode === 'full') {
      var idx = typeof insertIdx === 'number' ? insertIdx : column.cards.length;
      if (idx < 0) idx = 0;
      if (idx > column.cards.length) idx = column.cards.length;
      return idx;
    }
    var visibleIdx = typeof insertIdx === 'number' ? insertIdx : column.cards.length;
    var fullIdx = getFullCardIndex(column, visibleIdx);
    if (fullIdx === -1) fullIdx = column.cards.length;
    return fullIdx;
  }

  async function moveCard(sourceOrFromColIdx, fromCardIdxOrTarget, toColIdx, toInsertIdx) {
    try {
      var source;
      var target;

      if (typeof sourceOrFromColIdx === 'object' && sourceOrFromColIdx) {
        source = sourceOrFromColIdx;
        target = fromCardIdxOrTarget;
      } else {
        source = {
          boardId: activeBoardId,
          flatColIndex: sourceOrFromColIdx,
          cardIndex: fromCardIdxOrTarget,
          cardIndexMode: 'visible',
          indexMode: 'display'
        };
        target = {
          boardId: activeBoardId,
          flatColIndex: toColIdx,
          insertIdx: toInsertIdx,
          insertMode: 'visible',
          indexMode: 'display'
        };
      }

      if (!source || !target || !source.boardId || !target.boardId) return;

      var sourceBoardData = await loadBoardDataForMutation(source.boardId);
      if (!sourceBoardData) return;
      var targetBoardData = source.boardId === target.boardId
        ? sourceBoardData
        : await loadBoardDataForMutation(target.boardId);
      if (!targetBoardData) return;

      var sourceRef = resolveColumnRefForCardMutation(source.boardId, sourceBoardData, source);
      var targetRef = ensureCardTargetColumnForMutation(target.boardId, targetBoardData, target);
      if (!sourceRef || !sourceRef.column || !targetRef || !targetRef.column) return;

      var sourceCardMode = source.cardIndexMode || (source.boardId === activeBoardId ? 'visible' : 'full');
      var sourceCardIdx = resolveSourceCardIndex(sourceRef.column, source.cardIndex, sourceCardMode);
      if (sourceCardIdx < 0 || sourceCardIdx >= sourceRef.column.cards.length) return;

      var targetInsertMode = target.insertMode || 'visible';
      var targetInsertIdx = resolveInsertCardIndex(targetRef.column, target.insertIdx, targetInsertMode);
      if (targetInsertIdx < 0) return;

      var activeTouched = source.boardId === activeBoardId || target.boardId === activeBoardId;
      if (activeTouched && fullBoardData) pushUndo();

      var movedCard = sourceRef.column.cards.splice(sourceCardIdx, 1)[0];
      if (!movedCard) return;

      if (sourceBoardData === targetBoardData && sourceRef.column === targetRef.column) {
        if (sourceCardIdx < targetInsertIdx) targetInsertIdx--;
        if (targetInsertIdx === sourceCardIdx) {
          sourceRef.column.cards.splice(sourceCardIdx, 0, movedCard);
          return;
        }
      }

      if (targetInsertIdx < 0) targetInsertIdx = 0;
      if (targetInsertIdx > targetRef.column.cards.length) targetInsertIdx = targetRef.column.cards.length;
      targetRef.column.cards.splice(targetInsertIdx, 0, movedCard);

      removeEmptyStacksAndRowsInBoard(sourceBoardData);
      if (sourceBoardData !== targetBoardData) removeEmptyStacksAndRowsInBoard(targetBoardData);

      var changedBoards = {};
      changedBoards[source.boardId] = sourceBoardData;
      if (target.boardId !== source.boardId) changedBoards[target.boardId] = targetBoardData;
      await commitBoardMutations(changedBoards, { refreshSidebar: true });
    } catch (err) {
      lexeraLog('error', '[moveCard] Failed: ' + err);
    }
  }

  function getFullCardIndex(col, visibleIdx) {
    var visible = 0;
    for (var i = 0; i < col.cards.length; i++) {
      if (!is_archived_or_deleted(col.cards[i].content)) {
        if (visible === visibleIdx) return i;
        visible++;
      }
    }
    return -1;
  }

  // --- Card Editing ---

  function getCurrentEditorBoardId() {
    if (currentCardEditor && currentCardEditor.boardId) return currentCardEditor.boardId;
    return activeBoardId || '';
  }

  function getCurrentEditorFilePath() {
    var boardId = getCurrentEditorBoardId();
    return getBoardFilePathForId(boardId) || getActiveBoardFilePath() || '';
  }

  function safeDecodePath(value) {
    var text = String(value || '');
    try {
      return decodeURIComponent(text);
    } catch (e) {
      return text;
    }
  }

  function isWindowsAbsolutePath(value) {
    return /^[a-zA-Z]:[\\/]/.test(String(value || ''));
  }

  function normalizeWindowsAbsolutePath(value) {
    return normalizePathForCompare(String(value || ''));
  }

  function isRelativeResourcePath(value) {
    var normalized = String(value || '').trim();
    if (!normalized) return false;
    return normalized.charAt(0) !== '/' &&
      !isWindowsAbsolutePath(normalized) &&
      !/^(https?:\/\/|mailto:|data:|blob:|vscode-webview:\/\/)/i.test(normalized);
  }

  function resolveRelativePath(baseDir, relativePath) {
    return joinBoardRelativePath(baseDir, relativePath);
  }

  function buildWebviewResourceUrl(pathValue) {
    var resolvedPath = normalizeWindowsAbsolutePath(safeDecodePath(pathValue));
    if (!resolvedPath || /^(https?:\/\/|mailto:|data:|blob:|vscode-webview:\/\/)/i.test(resolvedPath)) {
      return resolvedPath;
    }
    var boardId = getCurrentEditorBoardId();
    if (!boardId) return resolvedPath;
    return LexeraApi.fileUrl(boardId, resolvedPath);
  }

  function resolveCurrentEditorResourcePath(pathValue, includeDir) {
    var decodedPath = safeDecodePath(pathValue);
    if (!decodedPath) return '';
    if (!isRelativeResourcePath(decodedPath)) {
      return normalizeWindowsAbsolutePath(decodedPath);
    }
    if (includeDir) {
      return resolveRelativePath(safeDecodePath(includeDir), decodedPath);
    }
    var boardDir = getDirNameFromPath(getCurrentEditorFilePath());
    if (!boardDir) return decodedPath;
    return resolveRelativePath(boardDir, decodedPath);
  }

  function syncCardEditorWysiwygContext(editor) {
    var boardId = editor && editor.boardId ? editor.boardId : (activeBoardId || '');
    var boardFilePath = getBoardFilePathForId(boardId) || getActiveBoardFilePath() || '';
    var includeDir = '';
    var col = editor && editor.colIndex != null ? getFullColumn(editor.colIndex) : null;
    if (col && col.includeSource && col.includeSource.rawPath) {
      var boardDir = getDirNameFromPath(boardFilePath);
      includeDir = getDirNameFromPath(joinBoardRelativePath(boardDir, col.includeSource.rawPath));
    } else {
      includeDir = getDirNameFromPath(boardFilePath);
    }
    window.currentTaskIncludeContext = includeDir ? { includeDir: includeDir } : null;
    window.currentFilePath = boardFilePath || '';
  }

  function setCurrentCardEditorMarkdown(nextValue, options) {
    options = options || {};
    if (!currentCardEditor) return;
    var normalizedValue = String(nextValue || '');
    if (currentCardEditor.textarea) currentCardEditor.textarea.value = normalizedValue;
    if (
      currentCardEditor.wysiwyg &&
      !options.skipWysiwygSync &&
      typeof currentCardEditor.wysiwyg.setMarkdown === 'function'
    ) {
      currentCardEditor.suppressWysiwygChange = true;
      try {
        currentCardEditor.wysiwyg.setMarkdown(normalizedValue);
      } finally {
        currentCardEditor.suppressWysiwygChange = false;
      }
    }
    if (!options.skipPreviewRefresh) refreshCardEditorPreview();
  }

  function updateCardEditorWysiwygToolbar(selectionState) {
    if (!currentCardEditor || !currentCardEditor.dialog) return;
    var markMap = {
      bold: 'strong',
      italic: 'em',
      underline: 'underline',
      strike: 'strike',
      mark: 'mark',
      sub: 'sub',
      sup: 'sup',
      code: 'code',
      ins: 'ins'
    };
    var marks = selectionState && selectionState.marks ? selectionState.marks : [];
    var block = selectionState && selectionState.block ? selectionState.block : '';
    var buttons = currentCardEditor.dialog.querySelectorAll('[data-card-editor-fmt]');
    for (var i = 0; i < buttons.length; i++) {
      var fmt = buttons[i].getAttribute('data-card-editor-fmt') || '';
      var isActive = false;
      if (fmt === 'code-block') {
        isActive = block === 'code_block';
      } else if (fmt === 'columns') {
        isActive = block === 'multicolumn_column';
      } else if (markMap[fmt]) {
        isActive = marks.indexOf(markMap[fmt]) !== -1;
      }
      buttons[i].classList.toggle('active', isActive);
      buttons[i].setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  }

  function applyCardEditorFontScale(scale, persist) {
    var normalizedScale = normalizeCardEditorFontScale(scale);
    cardEditorFontScale = normalizedScale;
    if (!currentCardEditor || !currentCardEditor.dialog) {
      if (persist !== false) localStorage.setItem('lexera-card-editor-font-scale', String(normalizedScale));
      return;
    }
    currentCardEditor.fontScale = normalizedScale;
    currentCardEditor.dialog.style.setProperty('--task-overlay-font-scale', String(normalizedScale));
    if (currentCardEditor.textarea) currentCardEditor.textarea.style.fontSize = 'calc(14px * ' + normalizedScale + ')';
    if (currentCardEditor.preview) currentCardEditor.preview.style.fontSize = 'calc(14px * ' + normalizedScale + ')';
    if (currentCardEditor.wysiwygWrap) currentCardEditor.wysiwygWrap.style.fontSize = 'calc(1em * ' + normalizedScale + ')';
    if (persist !== false) localStorage.setItem('lexera-card-editor-font-scale', String(normalizedScale));
  }

  function openCardEditorFontScaleMenu(anchorEl) {
    if (!anchorEl || !currentCardEditor) return;
    var rect = anchorEl.getBoundingClientRect();
    var items = [
      { id: 'font-1.0', label: 'Text 100%' },
      { id: 'font-1.2', label: 'Text 120%' },
      { id: 'font-1.4', label: 'Text 140%' }
    ];
    showNativeMenu(items, rect.right, rect.bottom).then(function (action) {
      if (!action) return;
      var nextScale = action === 'font-1.4' ? 1.4 : (action === 'font-1.2' ? 1.2 : 1);
      applyCardEditorFontScale(nextScale, true);
    });
  }

  // ── File search dialog for card editor ──────────────────────────────
  function openFileSearchDialog(textarea) {
    if (!textarea) return;
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay file-search-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'dialog file-search-dialog';
    dialog.innerHTML =
      '<div class="file-search-header">' +
        '<div class="file-search-title">Search Files</div>' +
        '<div class="file-search-categories" role="group">' +
          '<button class="board-action-btn file-search-cat active" type="button" data-cat="">All</button>' +
          '<button class="board-action-btn file-search-cat" type="button" data-cat="image">Images</button>' +
          '<button class="board-action-btn file-search-cat" type="button" data-cat="document">Docs</button>' +
          '<button class="board-action-btn file-search-cat" type="button" data-cat="video">Video</button>' +
          '<button class="board-action-btn file-search-cat" type="button" data-cat="audio">Audio</button>' +
        '</div>' +
        '<button class="btn-small btn-cancel file-search-close" type="button">Close</button>' +
      '</div>' +
      '<input class="file-search-input" type="text" placeholder="Type to search files..." spellcheck="false" />' +
      '<div class="file-search-results"></div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    var input = dialog.querySelector('.file-search-input');
    var resultsEl = dialog.querySelector('.file-search-results');
    var activeCategory = '';
    var searchTimer = null;

    function closeDialog() {
      if (searchTimer) clearTimeout(searchTimer);
      overlay.remove();
      textarea.focus();
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeDialog();
    });
    dialog.querySelector('.file-search-close').addEventListener('click', closeDialog);
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeDialog(); }
    });

    // Category filter buttons
    dialog.addEventListener('click', function (e) {
      var catBtn = e.target.closest('[data-cat]');
      if (!catBtn) return;
      activeCategory = catBtn.getAttribute('data-cat');
      dialog.querySelectorAll('.file-search-cat').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-cat') === activeCategory);
      });
      doSearch();
    });

    function doSearch() {
      var q = input.value.trim();
      if (q.length < 2) {
        resultsEl.innerHTML = '<div class="file-search-hint">Type at least 2 characters to search</div>';
        return;
      }
      resultsEl.innerHTML = '<div class="file-search-hint">Searching...</div>';
      var body = { query: q };
      if (activeCategory) body.category = activeCategory;
      LexeraApi.request('/search/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (data) {
        var results = data && data.results ? data.results : [];
        if (results.length === 0) {
          resultsEl.innerHTML = '<div class="file-search-hint">No files found</div>';
          return;
        }
        var html = '';
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          var catClass = 'badge-' + (r.category || 'unknown');
          html += '<div class="file-search-item" data-index="' + i + '">' +
            '<span class="file-search-badge ' + catClass + '">' + escapeHtml(r.category || '?') + '</span>' +
            '<span class="file-search-filename">' + escapeHtml(r.filename) + '</span>' +
            '<span class="file-search-board">' + escapeHtml(r.boardName) + '</span>' +
            '<span class="file-search-path">' + escapeHtml(r.path) + '</span>' +
          '</div>';
        }
        resultsEl.innerHTML = html;
        resultsEl._results = results;
      }).catch(function () {
        resultsEl.innerHTML = '<div class="file-search-hint">Search failed</div>';
      });
    }

    // Click result to insert
    resultsEl.addEventListener('click', function (e) {
      var item = e.target.closest('.file-search-item');
      if (!item || !resultsEl._results) return;
      var idx = parseInt(item.getAttribute('data-index'), 10);
      var r = resultsEl._results[idx];
      if (!r) return;
      var embed = '';
      if (r.category === 'image') {
        embed = '![' + r.filename + '](' + r.path + ')';
      } else {
        embed = '[' + r.filename + '](' + r.path + ')';
      }
      // If the result is from a different board, use the file API URL
      if (r.boardId && activeBoardId && r.boardId !== activeBoardId) {
        var url = LexeraApi.fileUrl(r.boardId, r.path);
        if (r.category === 'image') {
          embed = '![' + r.filename + '](' + url + ')';
        } else {
          embed = '[' + r.filename + '](' + url + ')';
        }
      }
      insertAtCursor(textarea, embed);
      closeDialog();
      textarea.dispatchEvent(new Event('input'));
    });

    input.addEventListener('input', function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(doSearch, 300);
    });

    input.focus();
  }

  function insertAtCursor(textarea, text) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var before = textarea.value.substring(0, start);
    var after = textarea.value.substring(end);
    textarea.value = before + text + after;
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
  }

  function syncCardEditorTextareaFromWysiwyg() {
    if (
      !currentCardEditor ||
      !currentCardEditor.wysiwyg ||
      typeof currentCardEditor.wysiwyg.getMarkdown !== 'function'
    ) {
      return;
    }
    if (currentCardEditor.textarea) {
      currentCardEditor.textarea.value = currentCardEditor.wysiwyg.getMarkdown() || '';
    }
  }

  function destroyCardEditorWysiwyg(editor) {
    if (!editor || !editor.wysiwyg) return;
    try {
      if (typeof editor.wysiwyg.destroy === 'function') editor.wysiwyg.destroy();
    } catch (err) {
      lexeraLog('warn', '[card-editor] Failed to destroy WYSIWYG editor: ' + err);
    }
    editor.wysiwyg = null;
    if (editor.wysiwygWrap) editor.wysiwygWrap.innerHTML = '';
  }

  function ensureCardEditorWysiwyg() {
    if (
      !currentCardEditor ||
      !currentCardEditor.wysiwygWrap ||
      typeof window.WysiwygEditor !== 'function'
    ) {
      return null;
    }
    syncCardEditorWysiwygContext(currentCardEditor);
    if (!currentCardEditor.wysiwyg) {
      currentCardEditor.wysiwygWrap.innerHTML = '';
      currentCardEditor.wysiwyg = new window.WysiwygEditor(currentCardEditor.wysiwygWrap, {
        markdown: currentCardEditor.textarea ? currentCardEditor.textarea.value : '',
        temporalPrefix: '!',
        onChange: function (markdown) {
          if (!currentCardEditor || currentCardEditor.suppressWysiwygChange) return;
          if (currentCardEditor.textarea) currentCardEditor.textarea.value = markdown || '';
          refreshCardEditorPreview();
          queueCardDraftLiveSync(currentCardEditor.colIndex, currentCardEditor.fullCardIdx, markdown || '');
        },
        onSelectionChange: function (selectionState) {
          updateCardEditorWysiwygToolbar(selectionState);
        },
        onSubmit: function () {
          closeCardEditorOverlay({ save: true });
        }
      });
      return currentCardEditor.wysiwyg;
    }
    if (
      currentCardEditor.textarea &&
      typeof currentCardEditor.wysiwyg.getMarkdown === 'function' &&
      currentCardEditor.wysiwyg.getMarkdown() !== currentCardEditor.textarea.value
    ) {
      currentCardEditor.suppressWysiwygChange = true;
      try {
        currentCardEditor.wysiwyg.setMarkdown(currentCardEditor.textarea.value);
      } finally {
        currentCardEditor.suppressWysiwygChange = false;
      }
    }
    return currentCardEditor.wysiwyg;
  }

  function applyCardEditorFormatting(textarea, fmt) {
    if (!currentCardEditor || !fmt) return;
    if (currentCardEditor.mode === 'wysiwyg') {
      var editor = ensureCardEditorWysiwyg();
      if (editor) {
        var command = fmt;
        if (fmt === 'columns') command = 'multicolumn';
        if (fmt === 'code-block' || fmt === 'link' || fmt === 'bold' || fmt === 'italic' ||
          fmt === 'underline' || fmt === 'strike' || fmt === 'mark' || fmt === 'sub' ||
          fmt === 'sup' || fmt === 'code' || fmt === 'ins') {
          if (editor.applyCommand(command)) {
            return;
          }
        }
        var wysiwygFormatSpec = getCardEditorFormatSpec(fmt);
        if (wysiwygFormatSpec) {
          var snippet = '';
          if (wysiwygFormatSpec.snippet != null) snippet = wysiwygFormatSpec.snippet;
          else if (wysiwygFormatSpec.wrap) snippet = wysiwygFormatSpec.wrap + 'text' + wysiwygFormatSpec.wrap;
          else snippet = wysiwygFormatSpec.prefix + 'text' + wysiwygFormatSpec.suffix;
          editor.insertText(snippet);
        }
        return;
      }
    }
    var formatSpec = getCardEditorFormatSpec(fmt);
    if (formatSpec) {
      insertFormatting(textarea, formatSpec);
      textarea.focus();
    }
  }

  function getEmbedOccurrenceRoot(container) {
    if (!container) return null;
    if (
      currentCardEditor &&
      currentCardEditor.wysiwygWrap &&
      currentCardEditor.wysiwygWrap.contains(container)
    ) {
      return currentCardEditor.wysiwygWrap;
    }
    if (
      currentCardEditor &&
      currentCardEditor.preview &&
      currentCardEditor.preview.contains(container)
    ) {
      return currentCardEditor.preview;
    }
    var cardEl = container.closest('.card[data-card-id]');
    if (cardEl) return cardEl;
    return container.closest('.board-header, .board-row, .board-stack, .column') || container.parentElement || null;
  }

  function getRenderedEmbedAbsoluteIndex(container) {
    if (!container) return 0;
    var explicitIndex = parseInt(container.getAttribute('data-embed-index') || '', 10);
    if (isFinite(explicitIndex) && explicitIndex >= 0) return explicitIndex;
    var root = getEmbedOccurrenceRoot(container);
    if (!root) return 0;
    var selector = [
      '.embed-container[data-file-path]',
      '.external-embed-container[data-embed-url]',
      '.inline-file-embed-container[data-file-path]',
      '.image-path-overlay-container[data-file-path]',
      '.video-path-overlay-container[data-file-path]',
      '.wysiwyg-media[data-file-path]',
      '.wysiwyg-media-block[data-file-path]'
    ].join(', ');
    var nodes = root.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] === container) return i;
    }
    return 0;
  }

  function replaceCurrentEmbedOccurrence(content, container, replacer) {
    return replaceNthMarkdownEmbed(
      content,
      getRenderedEmbedAbsoluteIndex(container),
      replacer
    );
  }

  function replaceNthIncludeDirective(content, targetIndex, replacer) {
    var matchIndex = 0;
    return String(content || '').replace(/!!!include\(([^)]+)\)!!!/g, function (match, rawPath) {
      var currentIndex = matchIndex++;
      if (currentIndex !== targetIndex) return match;
      return replacer({
        match: match,
        path: String(rawPath || '').trim()
      });
    });
  }

  function normalizeCardEditorMode(mode) {
    if (mode === 'markdown' || mode === 'preview') return mode;
    if (mode === 'wysiwyg' && isWysiwygEditorEnabled() && typeof window.WysiwygEditor === 'function') return mode;
    return 'dual';
  }

  function normalizeCardEditorFontScale(value) {
    var parsed = parseFloat(value);
    if (Math.abs(parsed - 1.4) < 0.01) return 1.4;
    if (Math.abs(parsed - 1.2) < 0.01) return 1.2;
    return 1;
  }

  function getCardEditorFormatSpec(fmt) {
    if (fmt === 'bold') return { wrap: '**' };
    if (fmt === 'italic') return { wrap: '*' };
    if (fmt === 'underline') return { wrap: '_' };
    if (fmt === 'strike') return { wrap: '~~' };
    if (fmt === 'mark') return { wrap: '==' };
    if (fmt === 'ins') return { wrap: '++' };
    if (fmt === 'sub') return { wrap: '~' };
    if (fmt === 'sup') return { wrap: '^' };
    if (fmt === 'code') return { wrap: '`' };
    if (fmt === 'link') return { prefix: '[', suffix: '](url)' };
    if (fmt === 'image') return { snippet: '![alt](path)' };
    if (fmt === 'heading') return { prefix: '## ', suffix: '' };
    if (fmt === 'quote') return { prefix: '> ', suffix: '' };
    if (fmt === 'bullet-list') return { prefix: '- ', suffix: '' };
    if (fmt === 'numbered-list') return { prefix: '1. ', suffix: '' };
    if (fmt === 'task') return { prefix: '- [ ] ', suffix: '' };
    if (fmt === 'include') return { snippet: '!!!include(path)!!!' };
    if (fmt === 'wiki') return { snippet: '[[Page]]' };
    if (fmt === 'footnote') return { snippet: 'Reference[^1]\n\n[^1]: Footnote text' };
    if (fmt === 'code-block') return { snippet: '```\ncode\n```' };
    if (fmt === 'mermaid') return { snippet: '```mermaid\ngraph TD\n  A[Start] --> B[End]\n```' };
    if (fmt === 'plantuml') return { snippet: '```plantuml\n@startuml\nAlice -> Bob: hello\n@enduml\n```' };
    if (fmt === 'columns') return { snippet: '---:\n\n:--:\n\n:---' };
    if (fmt === 'note') return { snippet: '::: note\n\n:::\n' };
    if (fmt === 'container-comment') return { snippet: '::: comment\n\n:::\n' };
    if (fmt === 'container-highlight') return { snippet: '::: highlight\n\n:::\n' };
    if (fmt === 'container-mark-red') return { snippet: '::: mark-red\n\n:::\n' };
    if (fmt === 'container-mark-green') return { snippet: '::: mark-green\n\n:::\n' };
    if (fmt === 'container-mark-blue') return { snippet: '::: mark-blue\n\n:::\n' };
    if (fmt === 'container-mark-cyan') return { snippet: '::: mark-cyan\n\n:::\n' };
    if (fmt === 'container-mark-magenta') return { snippet: '::: mark-magenta\n\n:::\n' };
    if (fmt === 'container-mark-yellow') return { snippet: '::: mark-yellow\n\n:::\n' };
    if (fmt === 'container-center') return { snippet: '::: center\n\n:::\n' };
    if (fmt === 'container-center100') return { snippet: '::: center100\n\n:::\n' };
    if (fmt === 'container-right') return { snippet: '::: right\n\n:::\n' };
    if (fmt === 'container-caption') return { snippet: '::: caption\n\n:::\n' };
    if (fmt === 'emoji') return { snippet: ':smile:' };
    return null;
  }

  function buildCardEditorSnippetSelectHtml() {
    return '' +
      '<select class="dialog-input card-editor-snippet-select" data-card-editor-snippet="snippet" title="Insert snippet">' +
        '<option value="">Insert...</option>' +
        '<option value="quote">Quote</option>' +
        '<option value="bullet-list">Bullet list</option>' +
        '<option value="numbered-list">Numbered list</option>' +
        '<option value="columns">Multicolumn ---: :--: :---</option>' +
        '<option value="mermaid">Mermaid diagram</option>' +
        '<option value="plantuml">PlantUML diagram</option>' +
        '<option value="note">Container: note</option>' +
        '<option value="container-comment">Container: comment</option>' +
        '<option value="container-highlight">Container: highlight</option>' +
        '<option value="container-mark-red">Container: mark-red</option>' +
        '<option value="container-mark-green">Container: mark-green</option>' +
        '<option value="container-mark-blue">Container: mark-blue</option>' +
        '<option value="container-mark-cyan">Container: mark-cyan</option>' +
        '<option value="container-mark-magenta">Container: mark-magenta</option>' +
        '<option value="container-mark-yellow">Container: mark-yellow</option>' +
        '<option value="container-center">Container: center</option>' +
        '<option value="container-center100">Container: center100</option>' +
        '<option value="container-right">Container: right</option>' +
        '<option value="container-caption">Container: caption</option>' +
        '<option value="footnote">Footnote</option>' +
        '<option value="emoji">Emoji</option>' +
      '</select>';
  }

  function updateCheckboxLineInText(text, lineIndex, checked) {
    var lines = String(text || '').split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return String(text || '');
    if (checked) {
      lines[lineIndex] = lines[lineIndex].replace(/\[([ ])\]/, '[x]');
    } else {
      lines[lineIndex] = lines[lineIndex].replace(/\[([xX])\]/, '[ ]');
    }
    return lines.join('\n');
  }

  function renderCardDisplayState(cardEl, content) {
    if (!cardEl) return;
    var colIndex = parseInt(cardEl.getAttribute('data-col-index') || '-1', 10);
    var resolved = getIncludeResolvedContent(content, colIndex);
    var titleEl = cardEl.querySelector('.card-title-display');
    if (titleEl) titleEl.innerHTML = renderTitleInline(getCardTitle(resolved), activeBoardId);
    var contentEl = cardEl.querySelector('.card-content');
    if (contentEl) {
      contentEl.innerHTML = renderCardContent(resolved, activeBoardId, null, { skipFirstLineTagStyle: true });
      enhanceEmbeddedContent(contentEl);
      applyRenderedHtmlCommentVisibility(contentEl, currentHtmlCommentRenderMode);
      applyRenderedTagVisibility(contentEl, currentTagVisibilityMode);
    }
    attachRenderedTagInteractions(cardEl);
  }

  function autoResizeInlineCardTextarea(textarea) {
    if (InlineCardEditorModule) InlineCardEditorModule.autoResizeInlineCardTextarea(textarea);
  }

  function findVisibleCardElement(colIndex, cardIndex) {
    return getElColumnsContainer().querySelector('.card[data-col-index="' + colIndex + '"][data-card-index="' + cardIndex + '"]');
  }

  function openCardEditor(cardEl, colIndex, cardIndex, mode) {
    cardEl = findVisibleCardElement(colIndex, cardIndex) || cardEl;
    if (mode === 'overlay' && !isOverlayEditorEnabled()) mode = 'inline';
    var targetCol = getFullColumn(colIndex);
    var targetFullIdx = targetCol ? getFullCardIndex(targetCol, cardIndex) : -1;
    var inlineEditor = InlineCardEditorModule ? InlineCardEditorModule.getCurrentInlineCardEditor() : null;
    if (inlineEditor) {
      var sameInlineCard = inlineEditor.cardEl === cardEl &&
        inlineEditor.colIndex === colIndex &&
        inlineEditor.fullCardIdx === targetFullIdx;
      if (sameInlineCard && mode !== 'overlay') {
        if (inlineEditor.textarea) inlineEditor.textarea.focus();
        return;
      }
      closeInlineCardEditor({ save: true }).then(function () {
        openCardEditor(cardEl, colIndex, cardIndex, mode);
      });
      return;
    }
    if (currentCardEditor) {
      var sameOverlayCard = currentCardEditor.cardEl === cardEl &&
        currentCardEditor.colIndex === colIndex &&
        currentCardEditor.fullCardIdx === targetFullIdx;
      if (sameOverlayCard && mode === 'overlay') {
        if (currentCardEditor.textarea) currentCardEditor.textarea.focus();
        return;
      }
      closeCardEditorOverlay({ save: true }).then(function () {
        openCardEditor(cardEl, colIndex, cardIndex, mode);
      });
      return;
    }
    if (mode === 'overlay') {
      enterCardEditMode(cardEl, colIndex, cardIndex);
      return;
    }
    enterInlineCardEditMode(cardEl, colIndex, cardIndex);
  }

  function shouldKeepInlineEditorOpenOnBlur() {
    if (InlineCardEditorModule) return InlineCardEditorModule.shouldKeepInlineEditorOpenOnBlur();
    return false;
  }

  function shouldCancelInlineEditorOnEscape(event) {
    if (InlineCardEditorModule) return InlineCardEditorModule.shouldCancelInlineEditorOnEscape(event);
    return false;
  }

  function enterInlineCardEditMode(cardEl, colIndex, cardIndex) {
    if (InlineCardEditorModule) InlineCardEditorModule.enterInlineCardEditMode(cardEl, colIndex, cardIndex);
  }

  function closeInlineCardEditor(options) {
    if (InlineCardEditorModule) return InlineCardEditorModule.closeInlineCardEditor(options);
    return Promise.resolve();
  }

  function applyCardEditorMode(mode) {
    if (!currentCardEditor || !currentCardEditor.dialog) return;
    mode = normalizeCardEditorMode(mode);
    if (currentCardEditor.mode === 'wysiwyg' && mode !== 'wysiwyg') {
      syncCardEditorTextareaFromWysiwyg();
    }
    currentCardEditor.mode = mode;
    currentCardEditor.dialog.setAttribute('data-editor-mode', mode);
    var buttons = currentCardEditor.dialog.querySelectorAll('[data-card-editor-mode]');
    for (var i = 0; i < buttons.length; i++) {
      var isActive = buttons[i].getAttribute('data-card-editor-mode') === mode;
      buttons[i].classList.toggle('active', isActive);
      buttons[i].setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
    if (mode === 'wysiwyg') {
      ensureCardEditorWysiwyg();
    } else {
      updateCardEditorWysiwygToolbar(null);
    }
    if (mode === 'preview') {
      refreshCardEditorPreview();
    }
    cardEditorMode = mode;
    localStorage.setItem('lexera-card-editor-mode', mode);
  }

  function enterCardEditMode(cardEl, colIndex, cardIndex) {
    if (currentCardEditor || (InlineCardEditorModule && InlineCardEditorModule.getCurrentInlineCardEditor())) return;
    if (!fullBoardData) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return;

    isEditing = true;
    cardEl.classList.add('editing');
    cardEl.classList.add('editing-overlay');
    cardEl.classList.remove('editing-inline');
    cardEl.classList.remove('collapsed');
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay card-editor-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'dialog card-editor-dialog';
    var allowWysiwygMode = isWysiwygEditorEnabled() && typeof window.WysiwygEditor === 'function';
    dialog.innerHTML =
      '<div class="card-editor-header">' +
        '<div class="card-editor-header-main">' +
          '<div class="card-editor-title-label">Card Editor</div>' +
          '<div class="card-editor-title-text"></div>' +
        '</div>' +
        '<div class="card-editor-header-actions">' +
          '<div class="card-editor-mode-toggle" role="group" aria-label="Editor mode">' +
            '<button class="board-action-btn" type="button" data-card-editor-mode="markdown" aria-pressed="false">Markdown</button>' +
            '<button class="board-action-btn" type="button" data-card-editor-mode="dual" aria-pressed="false">Dual</button>' +
            '<button class="board-action-btn" type="button" data-card-editor-mode="preview" aria-pressed="false">Preview</button>' +
            (allowWysiwygMode ? '<button class="board-action-btn" type="button" data-card-editor-mode="wysiwyg" aria-pressed="false">WYSIWYG</button>' : '') +
          '</div>' +
          '<button class="board-action-btn" type="button" data-card-editor-action="font-scale">Aa</button>' +
          '<button class="btn-small btn-cancel" data-card-editor-action="cancel">Cancel</button>' +
          '<button class="btn-small btn-primary" data-card-editor-action="save">Save</button>' +
        '</div>' +
      '</div>' +
      '<div class="card-editor-toolbar">' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="bold" title="Bold">Bold</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="italic" title="Italic">Italic</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="underline" title="Underline">Underline</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="strike" title="Strikethrough">Strike</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="mark" title="Mark">Mark</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="ins" title="Inserted text">Ins</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="sub" title="Subscript">Sub</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="sup" title="Superscript">Sup</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="code" title="Inline code">Code</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="link" title="Link">Link</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="image" title="Image">Image</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-action="file-search" title="Search files across workspace">Files</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="heading" title="Heading">H2</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="quote" title="Quote">Quote</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="task" title="Checklist item">Task</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="include" title="Include">Include</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="wiki" title="Wiki link">Wiki</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="footnote" title="Footnote">Footnote</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="code-block" title="Code block">Block</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="mermaid" title="Mermaid diagram">Mermaid</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="columns" title="Multi-column block">Columns</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="note" title="Note container">Note</button>' +
        buildCardEditorSnippetSelectHtml() +
        '<span class="card-editor-hint">Ctrl/Cmd+Enter to save, Esc to cancel</span>' +
      '</div>' +
      '<div class="card-editor-body">' +
        '<div class="card-editor-pane card-editor-text-pane">' +
          '<div class="card-editor-pane-title">Markdown</div>' +
          '<textarea class="card-editor-textarea card-edit-input" spellcheck="false"></textarea>' +
        '</div>' +
        '<div class="card-editor-pane card-editor-preview-pane">' +
          '<div class="card-editor-pane-title">Preview</div>' +
          '<div class="card-editor-preview" tabindex="0"></div>' +
        '</div>' +
        '<div class="card-editor-pane card-editor-wysiwyg-pane">' +
          '<div class="card-editor-pane-title">WYSIWYG</div>' +
          '<div class="card-overlay-wysiwyg"></div>' +
        '</div>' +
      '</div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function updateCardEditorOverlayHeight() {
      dialog.style.setProperty(
        '--card-overlay-wysiwyg-height',
        Math.max(360, Math.min(window.innerHeight - 320, 720)) + 'px'
      );
    }
    updateCardEditorOverlayHeight();
    window.addEventListener('resize', updateCardEditorOverlayHeight);

    var textarea = dialog.querySelector('.card-editor-textarea');
    var preview = dialog.querySelector('.card-editor-preview');
    var wysiwygWrap = dialog.querySelector('.card-overlay-wysiwyg');
    textarea.value = card.content;

    currentCardEditor = {
      overlay: overlay,
      dialog: dialog,
      textarea: textarea,
      preview: preview,
      wysiwygWrap: wysiwygWrap,
      wysiwyg: null,
      resizeHandler: updateCardEditorOverlayHeight,
      cardEl: cardEl,
      colIndex: colIndex,
      fullCardIdx: fullIdx,
      originalContent: card.content || '',
      boardId: activeBoardId || '',
      fontScale: normalizeCardEditorFontScale(cardEditorFontScale),
      mode: normalizeCardEditorMode(cardEditorMode || localStorage.getItem('lexera-card-editor-mode') || 'dual')
    };
    syncCardEditorWysiwygContext(currentCardEditor);
    applyCardEditorFontScale(currentCardEditor.fontScale, false);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeCardEditorOverlay({ save: false });
    });
    dialog.addEventListener('click', function (e) {
      var modeBtn = e.target.closest('[data-card-editor-mode]');
      if (modeBtn) {
        applyCardEditorMode(modeBtn.getAttribute('data-card-editor-mode'));
        if (currentCardEditor && currentCardEditor.textarea && currentCardEditor.mode !== 'preview') {
          currentCardEditor.textarea.focus();
        }
        return;
      }
      var actionBtn = e.target.closest('[data-card-editor-action]');
      if (actionBtn) {
        var action = actionBtn.getAttribute('data-card-editor-action');
        if (action === 'save') closeCardEditorOverlay({ save: true });
        else if (action === 'cancel') closeCardEditorOverlay({ save: false });
        else if (action === 'font-scale') openCardEditorFontScaleMenu(actionBtn);
        else if (action === 'file-search') openFileSearchDialog(textarea);
        return;
      }
      var fmtBtn = e.target.closest('[data-card-editor-fmt]');
      if (!fmtBtn) return;
      applyCardEditorFormatting(textarea, fmtBtn.getAttribute('data-card-editor-fmt'));
    });
    dialog.addEventListener('change', function (e) {
      var snippetSelect = e.target.closest('[data-card-editor-snippet]');
      if (!snippetSelect) return;
      var snippet = snippetSelect.value;
      if (!snippet) return;
      snippetSelect.value = '';
      applyCardEditorFormatting(textarea, snippet);
    });

    // Broadcast editing presence when opening overlay editor
    if (card.kid && LexeraApi.isSyncConnected()) {
      LexeraApi.sendEditingPresence(card.kid, syncUserName || syncUserId, textarea.selectionStart, false);
    }

    textarea.addEventListener('input', function () {
      try {
      refreshCardEditorPreview();
      queueCardDraftLiveSync(colIndex, fullIdx, textarea.value);
      if (card.kid) queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, true);
      } catch (err) {
        logFrontendIssue('error', 'editor.overlay', 'Error in overlay editor input handler', err);
      }
    });
    textarea.addEventListener('keyup', function () {
      if (card.kid) queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, false);
    });
    textarea.addEventListener('mouseup', function () {
      if (card.kid) queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, false);
    });
    textarea.addEventListener('paste', function (e) {
      handleEditorPasteImage(e, textarea);
    });
    preview.addEventListener('change', function (e) {
      if (!e.target.classList.contains('card-checkbox')) return;
      e.preventDefault();
      e.stopPropagation();
      var lineIndex = parseInt(e.target.getAttribute('data-line'), 10);
      if (!isFinite(lineIndex)) return;
      textarea.value = updateCheckboxLineInText(textarea.value, lineIndex, e.target.checked);
      refreshCardEditorPreview();
      queueCardDraftLiveSync(colIndex, fullIdx, textarea.value);
    });
    dialog.addEventListener('dragover', function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    dialog.addEventListener('drop', async function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      var markdown = typeof resolveDropContent === 'function'
        ? await resolveDropContent(e.dataTransfer)
        : '';
      if (!markdown) return;
      if (currentCardEditor && currentCardEditor.mode === 'wysiwyg') {
        var editor = ensureCardEditorWysiwyg();
        if (editor) {
          editor.insertText(markdown);
          return;
        }
      }
      insertFormatting(textarea, { snippet: markdown });
      textarea.focus();
    });
    dialog.addEventListener('keydown', function (e) {
      try {
      if (e.target === textarea) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        closeCardEditorOverlay({ save: true });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        closeCardEditorOverlay({ save: true });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCardEditorOverlay({ save: false });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key === '1') {
          e.preventDefault();
          applyCardEditorMode('markdown');
        } else if (e.key === '2') {
          e.preventDefault();
          applyCardEditorMode('dual');
        } else if (e.key === '3') {
          e.preventDefault();
          applyCardEditorMode('preview');
        } else if (e.key === '4') {
          if (isWysiwygEditorEnabled() && typeof window.WysiwygEditor === 'function') {
            e.preventDefault();
            applyCardEditorMode('wysiwyg');
          }
        }
      }
      } catch (err) {
        logFrontendIssue('error', 'editor.overlay', 'Error in overlay dialog keydown handler', err);
      }
    });
    textarea.addEventListener('keydown', function (e) {
      try {
      if (handleTextareaTabIndent(e, textarea)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        closeCardEditorOverlay({ save: true });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        closeCardEditorOverlay({ save: true });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCardEditorOverlay({ save: false });
        return;
      }
      // Check user-defined keybindings for editor context
      if (window.LexeraKeybindingRegistry) {
        var kb = window.LexeraKeybindingRegistry.match(e, 'editor');
        if (kb) {
          e.preventDefault();
          window.LexeraKeybindingRegistry.execute(kb, textarea, insertFormatting);
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key === '1') {
          e.preventDefault();
          applyCardEditorMode('markdown');
          return;
        }
        if (e.key === '2') {
          e.preventDefault();
          applyCardEditorMode('dual');
          return;
        }
        if (e.key === '3') {
          e.preventDefault();
          applyCardEditorMode('preview');
          return;
        }
        if (e.key === '4') {
          if (isWysiwygEditorEnabled() && typeof window.WysiwygEditor === 'function') {
            e.preventDefault();
            applyCardEditorMode('wysiwyg');
          }
          return;
        }
      }
      if (e.ctrlKey || e.metaKey) {
        var fmt = null;
        if (e.key === 'b') fmt = { wrap: '**' };
        else if (e.key === 'i') fmt = { wrap: '*' };
        else if (e.key === '`') fmt = { wrap: '`' };
        else if (e.key === 'k') fmt = { prefix: '[', suffix: '](url)' };
        else if (e.key === 'u') fmt = { wrap: '_' };
        else if (e.key === 'h') fmt = { prefix: '## ', suffix: '' };
        if (fmt) {
          e.preventDefault();
          insertFormatting(textarea, fmt);
        }
      }
      } catch (err) {
        logFrontendIssue('error', 'editor.overlay', 'Error in overlay textarea keydown handler', err);
      }
    });

    refreshCardEditorPreview();
    applyCardEditorMode(currentCardEditor.mode);
    requestAnimationFrame(function () {
      if (currentCardEditor && currentCardEditor.mode === 'wysiwyg') {
        var wysiwyg = ensureCardEditorWysiwyg();
        if (wysiwyg && typeof wysiwyg.focus === 'function') {
          wysiwyg.focus();
        }
      } else if (currentCardEditor && currentCardEditor.mode !== 'preview') {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      } else if (preview) {
        preview.focus();
      }
    });
  }

  function refreshCardEditorPreview() {
    if (!currentCardEditor) return;
    var value = currentCardEditor.textarea ? currentCardEditor.textarea.value : '';
    if (currentCardEditor.preview) {
      var resolved = getIncludeResolvedContent(value, currentCardEditor.colIndex);
      currentCardEditor.preview.innerHTML = renderCardContent(resolved, activeBoardId, null, { skipFirstLineTagStyle: true });
      enhanceEmbeddedContent(currentCardEditor.preview);
      applyRenderedHtmlCommentVisibility(currentCardEditor.preview, currentHtmlCommentRenderMode);
      applyRenderedTagVisibility(currentCardEditor.preview, currentTagVisibilityMode);
    }
    var titleEl = currentCardEditor.dialog
      ? currentCardEditor.dialog.querySelector('.card-editor-title-text')
      : null;
    if (titleEl) {
      var resolvedForTitle = getIncludeResolvedContent(value, currentCardEditor.colIndex);
      titleEl.textContent = getCardTitle(stripInternalHiddenTags(resolvedForTitle)).trim() || 'Untitled';
    }
  }

  async function closeCardEditorOverlay(options) {
    options = options || {};
    if (!currentCardEditor) return;
    var editor = currentCardEditor;
    currentCardEditor = null;
    isEditing = false;
    // Clear editing presence
    clearEditingPresenceQueue();
    if (LexeraApi.isSyncConnected()) {
      LexeraApi.sendEditingPresence(null, '', null, false);
    }
    if (editor.wysiwyg && typeof editor.wysiwyg.getMarkdown === 'function' && editor.textarea) {
      editor.textarea.value = editor.wysiwyg.getMarkdown() || editor.textarea.value;
    }
    if (editor.resizeHandler) {
      window.removeEventListener('resize', editor.resizeHandler);
    }
    destroyCardEditorWysiwyg(editor);
    window.currentTaskIncludeContext = null;
    window.currentFilePath = '';
    if (editor.cardEl && editor.cardEl.classList) {
      editor.cardEl.classList.remove('editing');
      editor.cardEl.classList.remove('editing-inline');
      editor.cardEl.classList.remove('editing-overlay');
    }
    if (editor.overlay && editor.overlay.parentNode) editor.overlay.parentNode.removeChild(editor.overlay);
    if (options.save) {
      clearPendingCardDraftSync();
      await saveCardEdit(editor.cardEl, editor.colIndex, editor.fullCardIdx, editor.textarea.value);
      return;
    }
    await revertCardDraftLiveSync(editor.colIndex, editor.fullCardIdx, editor.originalContent).catch(function (err) {
      logFrontendIssue('warn', 'live-sync.revert', 'Failed to revert overlay editor live-sync draft', err);
      return false;
    });
    await flushDeferredBoardRefresh({ refreshSidebar: true });
  }

  function insertFormatting(textarea, fmt) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var text = textarea.value;
    var selected = text.substring(start, end);

    var replacement;
    if (fmt.snippet != null) {
      replacement = fmt.snippet;
    } else if (fmt.wrap) {
      replacement = fmt.wrap + (selected || 'text') + fmt.wrap;
    } else {
      replacement = fmt.prefix + (selected || 'text') + fmt.suffix;
    }

    textarea.value = text.substring(0, start) + replacement + text.substring(end);

    if (fmt.snippet != null) {
      textarea.setSelectionRange(start, start + replacement.length);
    } else if (selected) {
      // Place cursor: if there was a selection, select the content between markers
      var contentStart = start + (fmt.wrap ? fmt.wrap.length : fmt.prefix.length);
      textarea.setSelectionRange(contentStart, contentStart + selected.length);
    } else {
      var contentStart = start + (fmt.wrap ? fmt.wrap.length : fmt.prefix.length);
      textarea.setSelectionRange(contentStart, contentStart + 4); // select 'text'
    }
    textarea.dispatchEvent(new Event('input'));
  }

  async function saveCardEdit(cardEl, colIndex, fullCardIdx, newContent) {
    isEditing = false;
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col || !col.cards[fullCardIdx]) return;

    var oldContent = col.cards[fullCardIdx].content;
    if (newContent === oldContent) {
      if (cardEl && cardEl.classList) cardEl.classList.remove('editing');
      renderCardDisplayState(cardEl, oldContent);
      await flushDeferredBoardRefresh({ refreshSidebar: true });
      return;
    }

    pushUndo();
    col.cards[fullCardIdx].content = newContent;
    await persistBoardMutation();
    await flushDeferredBoardRefresh({ refreshSidebar: true });
  }

  // --- Checkbox Toggle ---

  async function toggleCheckbox(colIndex, cardIndex, lineIndex, checked) {
    if (!fullBoardData || !activeBoardId) return;
    pushUndo();
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    if (fullIdx === -1) return;
    var card = col.cards[fullIdx];
    if (!card) return;

    var lines = card.content.split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return;
    if (checked) {
      lines[lineIndex] = lines[lineIndex].replace(/\[([ ])\]/, '[x]');
    } else {
      lines[lineIndex] = lines[lineIndex].replace(/\[([xX])\]/, '[ ]');
    }
    card.content = lines.join('\n');
    await persistBoardMutation();
  }

  // --- Card Context Menu ---

  var activeCardMenu = null;

  function closeCardContextMenu() {
    if (activeCardMenu) {
      activeCardMenu.remove();
      activeCardMenu = null;
    }
  }

  function buildTagSubmenu(label, tags, text, idPrefix) {
    var items = [];
    for (var i = 0; i < tags.length; i++) {
      var tagName = '#' + tags[i];
      var active = hasTag(text, tagName);
      items.push({
        id: idPrefix + tags[i],
        label: (active ? '\u2713 ' : '') + tagName
      });
    }
    return { id: idPrefix + '_sub', label: label, items: items };
  }

  function buildTagCategorySubmenus(text, idPrefix, order) {
    var categoryOrder = Array.isArray(order) && order.length > 0 ? order : TAG_CATEGORY_MENU_ORDER;
    var items = [];
    for (var i = 0; i < categoryOrder.length; i++) {
      var key = categoryOrder[i];
      var tags = TAG_CATEGORIES[key];
      if (!Array.isArray(tags) || tags.length === 0) continue;
      var label = TAG_CATEGORY_MENU_LABELS[key] || key;
      items.push(buildTagSubmenu(label, tags, text, idPrefix + 'cat-' + key + '-'));
    }
    return items;
  }

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

  function buildCustomTagsSubmenu(text, idPrefix) {
    var allTags = extractAllTags(text);
    var knownTags = {};
    var catKeys = Object.keys(TAG_CATEGORIES);
    for (var c = 0; c < catKeys.length; c++) {
      var arr = TAG_CATEGORIES[catKeys[c]];
      for (var t = 0; t < arr.length; t++) knownTags['#' + arr[t]] = true;
    }
    var custom = [];
    for (var i = 0; i < allTags.length; i++) {
      var tag = allTags[i];
      if (knownTags[tag]) continue;
      if (/^#hidden-internal-/.test(tag)) continue;
      if (isLayoutTagName(tag)) continue;
      custom.push(tag);
    }
    if (custom.length === 0) return null;
    var items = [];
    for (var j = 0; j < custom.length; j++) {
      items.push({ id: idPrefix + custom[j].replace(/^#/, ''), label: '\u2713 ' + custom[j] });
    }
    return { id: idPrefix + '_sub', label: 'Custom Tags', items: items };
  }

  function extractTagNameFromMenuAction(action) {
    var match = String(action || '').match(/^tag-(?:cat-[a-z0-9_-]+|custom)-(.+)$/i);
    return match ? ('#' + match[1]) : '';
  }

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

  function buildMarpClassDiscoveryDirs() {
    var dirs = [];
    var seen = {};

    function addDir(path) {
      var normalized = normalizePathForCompare(String(path || '').trim());
      if (!normalized || seen[normalized]) return;
      seen[normalized] = true;
      dirs.push(normalized);
    }

    var boardFilePath = getActiveBoardFilePath();
    var boardDir = getDirNameFromPath(boardFilePath);
    if (boardDir) {
      addDir(boardDir);
      addDir(boardDir + '/themes');
      addDir(boardDir + '/_themes');
      addDir(boardDir + '/assets/themes');
    }

    return dirs;
  }

  async function refreshAvailableMarpClasses(force) {
    if (!window.ExportService || typeof ExportService.getMarpClasses !== 'function') {
      return Array.isArray(window.marpAvailableClasses) ? window.marpAvailableClasses : [];
    }

    var dirs = buildMarpClassDiscoveryDirs();
    var dirKey = dirs.join('|');
    var existing = Array.isArray(window.marpAvailableClasses) ? window.marpAvailableClasses : [];

    if (!force && marpClassDiscoveryState.pending) {
      return marpClassDiscoveryState.pending;
    }
    if (!force && existing.length > 0 && marpClassDiscoveryState.lastDirKey === dirKey) {
      return existing;
    }

    marpClassDiscoveryState.pending = ExportService.getMarpClasses(dirs).then(function (classes) {
      window.marpAvailableClasses = Array.isArray(classes) ? classes.slice() : [];
      marpClassDiscoveryState.lastDirKey = dirKey;
      marpClassDiscoveryState.lastUpdatedAt = Date.now();
      marpClassDiscoveryState.pending = null;
      return window.marpAvailableClasses;
    }).catch(function (err) {
      marpClassDiscoveryState.pending = null;
      logFrontendIssue('warn', 'marp.classes', 'Failed to discover Marp classes', err);
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

  function getMarpDirectiveFinalName(directiveName, directiveScope) {
    return directiveScope === 'scoped' ? ('_' + directiveName) : directiveName;
  }

  function getMarpDirectiveRegex(directiveName, directiveScope) {
    var finalDirectiveName = getMarpDirectiveFinalName(directiveName, directiveScope);
    return new RegExp('<!--\\s*' + escapeRegex(finalDirectiveName) + '\\s*:\\s*([\\s\\S]*?)\\s*-->', 'gi');
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
    return text.length > 24 ? (text.slice(0, 24) + '…') : text;
  }

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
        label: formatMenuToggleLabel(getMarpClassListFromHeader(headerText, classScope).indexOf(className) !== -1, className)
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
    if (!isMarpSettingsEnabled()) return [];
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
          { id: 'marp-paginate-local', label: formatMenuToggleLabel(hasMarpDirectiveValue(currentHeader, 'paginate', 'local', 'true'), 'Paginate (Local)') },
          { id: 'marp-paginate-scoped', label: formatMenuToggleLabel(hasMarpDirectiveValue(currentHeader, 'paginate', 'scoped', 'true'), 'Paginate (Scoped)') }
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
    addNames(getWhitespaceTokenList(frontmatter && frontmatter['class']));

    return available;
  }

  function buildBoardMarpValueSubmenu(frontmatter, descriptor) {
    var currentValue = normalizeYamlFrontmatterScalar(frontmatter && frontmatter[descriptor.key]);
    var items = [];
    var presets = Array.isArray(descriptor.presets) ? descriptor.presets : [];
    for (var i = 0; i < presets.length; i++) {
      var preset = presets[i];
      items.push({
        id: 'file-marp-set:' + descriptor.key + ':' + encodeURIComponent(String(preset.value)),
        label: formatMenuToggleLabel(currentValue.toLowerCase() === String(preset.value).trim().toLowerCase(), preset.label)
      });
    }
    if (items.length > 0) items.push({ separator: true });
    items.push({
      id: 'file-marp-prompt:' + descriptor.key,
      label: currentValue ? ('Edit… (' + truncateMarpDirectiveValue(currentValue) + ')') : 'Set…'
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
    var activeClasses = getWhitespaceTokenList(frontmatter && frontmatter['class']);
    var availableClasses = getAvailableBoardMarpClassNames(frontmatter);
    var items = [
      { id: 'file-marp-refresh-classes', label: 'Refresh Available Classes' },
      { separator: true }
    ];
    for (var i = 0; i < availableClasses.length; i++) {
      var className = availableClasses[i];
      items.push({
        id: 'file-marp-toggle-class:' + className,
        label: formatMenuToggleLabel(activeClasses.indexOf(className) !== -1, className)
      });
    }
    if (items.length > 0) items.push({ separator: true });
    items.push({ id: 'file-marp-prompt-class', label: 'Toggle Custom Class…' });
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
    var yamlHeader = fullBoardData && fullBoardData.yamlHeader ? String(fullBoardData.yamlHeader) : '';
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
      items.push({ id: 'file-marp-yaml-more', label: '…', disabled: true });
    }
    return items;
  }

  function buildFileHeaderMarpMenuItems() {
    var frontmatter = getBoardMarpFrontmatter();
    var marpEnabled = normalizeYamlFrontmatterScalar(frontmatter.marp).toLowerCase() === 'true';
    return [
      { id: 'file-marp-toggle-enabled', label: formatMenuToggleLabel(marpEnabled, 'Enable Marp') },
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

  async function toggleBoardMarpClass(className) {
    var normalizedClass = String(className || '').trim();
    if (!normalizedClass) return false;
    var frontmatter = getBoardMarpFrontmatter();
    var classes = getWhitespaceTokenList(frontmatter['class']);
    var index = classes.indexOf(normalizedClass);
    if (index === -1) classes.push(normalizedClass);
    else classes.splice(index, 1);
    return setBoardFrontmatterValue('class', setWhitespaceTokenList(classes) || null);
  }

  async function clearBoardMarpClasses() {
    return setBoardFrontmatterValue('class', null);
  }

  async function promptBoardMarpValue(key) {
    var descriptor = findBoardMarpFieldDefinition(key);
    var currentValue = normalizeYamlFrontmatterScalar(getBoardMarpFrontmatter()[key]);
    var label = descriptor && descriptor.prompt ? descriptor.prompt : ('Marp ' + key);
    var requested = window.prompt(label, currentValue || '');
    if (requested == null) return false;
    var normalizedValue = normalizeYamlFrontmatterScalar(requested);
    return setBoardFrontmatterValue(key, normalizedValue || null);
  }

  async function promptBoardMarpClassToggle() {
    var requested = window.prompt('Marp class name(s) to toggle', '');
    if (requested == null) return false;
    var classNames = getWhitespaceTokenList(requested);
    if (classNames.length === 0) return false;
    var changed = false;
    for (var i = 0; i < classNames.length; i++) {
      changed = (await toggleBoardMarpClass(classNames[i])) || changed;
    }
    return changed;
  }

  async function handleBoardMarpMenuAction(action) {
    if (action === 'file-marp-toggle-enabled') {
      var enabled = normalizeYamlFrontmatterScalar(getBoardMarpFrontmatter().marp).toLowerCase() === 'true';
      await setBoardFrontmatterValue('marp', enabled ? 'false' : 'true');
      return true;
    }
    if (action === 'file-marp-refresh-classes') {
      await refreshAvailableMarpClasses(true);
      return true;
    }
    if (action === 'file-marp-prompt-class') {
      await promptBoardMarpClassToggle();
      return true;
    }
    if (action === 'file-marp-clear-class') {
      await clearBoardMarpClasses();
      return true;
    }
    if (action === 'file-marp-copy-yaml') {
      copyTextToClipboard(
        fullBoardData && fullBoardData.yamlHeader ? String(fullBoardData.yamlHeader) : '',
        'YAML header copied to clipboard',
        'Failed to copy YAML header'
      );
      return true;
    }
    if (action.indexOf('file-marp-toggle-class:') === 0) {
      await toggleBoardMarpClass(action.substring('file-marp-toggle-class:'.length));
      return true;
    }

    var setMatch = String(action || '').match(/^file-marp-set:([A-Za-z0-9_]+):(.+)$/);
    if (setMatch) {
      await setBoardFrontmatterValue(setMatch[1], decodeURIComponent(setMatch[2]));
      return true;
    }

    var promptMatch = String(action || '').match(/^file-marp-prompt:([A-Za-z0-9_]+)$/);
    if (promptMatch) {
      await promptBoardMarpValue(promptMatch[1]);
      return true;
    }

    var clearMatch = String(action || '').match(/^file-marp-clear:([A-Za-z0-9_]+)$/);
    if (clearMatch) {
      await setBoardFrontmatterValue(clearMatch[1], null);
      return true;
    }

    return false;
  }

  async function setEntityMarpDirective(elementType, indices, directiveName, directiveValue, directiveScope) {
    return mutateEntityHeaderText(elementType, indices, function (headerText) {
      return setMarpDirectiveInHeaderText(headerText, directiveName, directiveValue, directiveScope);
    });
  }

  async function clearEntityMarpDirective(elementType, indices, directiveName, directiveScope) {
    return mutateEntityHeaderText(elementType, indices, function (headerText) {
      return clearMarpDirectiveFromHeaderText(headerText, directiveName, directiveScope);
    });
  }

  async function toggleEntityMarpDirective(elementType, indices, directiveName, enabledValue, directiveScope) {
    var targetValue = String(enabledValue || '').trim() || 'true';
    return mutateEntityHeaderText(elementType, indices, function (headerText) {
      if (hasMarpDirectiveValue(headerText, directiveName, directiveScope, targetValue)) {
        return clearMarpDirectiveFromHeaderText(headerText, directiveName, directiveScope);
      }
      return setMarpDirectiveInHeaderText(headerText, directiveName, targetValue, directiveScope);
    });
  }

  async function toggleEntityMarpClass(elementType, indices, className, classScope) {
    return mutateEntityHeaderText(elementType, indices, function (headerText) {
      return toggleMarpClassInHeaderText(headerText, className, classScope);
    });
  }

  async function clearEntityMarpClasses(elementType, indices, classScope) {
    return mutateEntityHeaderText(elementType, indices, function (headerText) {
      return setMarpClassListInHeader(headerText, [], classScope);
    });
  }

  async function promptEntityMarpDirective(elementType, indices, directiveName, directiveScope) {
    var target = resolveTagTarget(elementType, indices);
    if (!target) return false;
    var currentValue = getMarpDirectiveValueFromHeader(splitTagHeaderAndBody(target.text || '').header || '', directiveName, directiveScope);
    var descriptor = findMarpDirectiveDefinition(directiveName);
    var label = descriptor && descriptor.prompt ? descriptor.prompt : ('Marp ' + directiveName);
    var requested = window.prompt(label + ' (' + directiveScope + ')', currentValue || '');
    if (requested == null) return false;
    var cleanValue = String(requested || '').trim();
    if (!cleanValue) {
      return clearEntityMarpDirective(elementType, indices, directiveName, directiveScope);
    }
    return setEntityMarpDirective(elementType, indices, directiveName, cleanValue, directiveScope);
  }

  async function promptEntityMarpClassToggle(elementType, indices, classScope) {
    var requested = window.prompt('Marp class name(s) to toggle (' + classScope + ')', '');
    if (requested == null) return false;
    var tokens = String(requested || '').split(/\s+/);
    var classNames = [];
    var seen = {};
    for (var i = 0; i < tokens.length; i++) {
      var className = String(tokens[i] || '').trim();
      if (!className || seen[className]) continue;
      seen[className] = true;
      classNames.push(className);
    }
    if (classNames.length === 0) return false;
    return mutateEntityHeaderText(elementType, indices, function (headerText) {
      var nextHeader = String(headerText || '');
      for (var j = 0; j < classNames.length; j++) {
        nextHeader = toggleMarpClassInHeaderText(nextHeader, classNames[j], classScope);
      }
      return nextHeader;
    });
  }

  async function handleEntityMarpMenuAction(action, elementType, indices) {
    if (action === 'marp-classes-refresh') {
      await refreshAvailableMarpClasses(true);
      return true;
    }
    if (action === 'marp-paginate-local') {
      await toggleEntityMarpDirective(elementType, indices, 'paginate', 'true', 'local');
      return true;
    }
    if (action === 'marp-paginate-scoped') {
      await toggleEntityMarpDirective(elementType, indices, 'paginate', 'true', 'scoped');
      return true;
    }
    if (action === 'marp-class-custom-local') {
      await promptEntityMarpClassToggle(elementType, indices, 'local');
      return true;
    }
    if (action === 'marp-class-custom-scoped') {
      await promptEntityMarpClassToggle(elementType, indices, 'scoped');
      return true;
    }
    if (action === 'marp-class-clear-local') {
      await clearEntityMarpClasses(elementType, indices, 'local');
      return true;
    }
    if (action === 'marp-class-clear-scoped') {
      await clearEntityMarpClasses(elementType, indices, 'scoped');
      return true;
    }
    if (action.indexOf('marp-class-local:') === 0) {
      await toggleEntityMarpClass(elementType, indices, action.substring('marp-class-local:'.length), 'local');
      return true;
    }
    if (action.indexOf('marp-class-scoped:') === 0) {
      await toggleEntityMarpClass(elementType, indices, action.substring('marp-class-scoped:'.length), 'scoped');
      return true;
    }
    var directiveMatch = String(action || '').match(/^marp-directive-(set|clear)-(local|scoped):([A-Za-z0-9_]+)$/);
    if (!directiveMatch) return false;
    if (directiveMatch[1] === 'set') {
      await promptEntityMarpDirective(elementType, indices, directiveMatch[3], directiveMatch[2]);
    } else {
      await clearEntityMarpDirective(elementType, indices, directiveMatch[3], directiveMatch[2]);
    }
    return true;
  }

  function showCardContextMenu(x, y, colIndex, cardIndex) {
    showElementContextMenu('card', x, y, { colIndex: colIndex, cardIndex: cardIndex });
  }

  async function duplicateCard(colIndex, cardIndex) {
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return;
    pushUndo();

    var clone = JSON.parse(JSON.stringify(card));
    clone.id = 'dup-' + Date.now();
    clone.kid = null;
    col.cards.splice(fullIdx + 1, 0, clone);
    await persistBoardMutation();
  }

  async function duplicateCardToColumn(colIndex, cardIndex, targetColIndex) {
    if (!fullBoardData || !activeBoardId) return;
    var srcCol = getFullColumn(colIndex);
    var dstCol = getFullColumn(targetColIndex);
    if (!srcCol || !dstCol) return;
    var fullIdx = getFullCardIndex(srcCol, cardIndex);
    var card = srcCol.cards[fullIdx];
    if (!card) return;
    pushUndo();
    var clone = JSON.parse(JSON.stringify(card));
    clone.id = 'dup-' + Date.now();
    clone.kid = null;
    dstCol.cards.push(clone);
    await persistBoardMutation();
  }

  async function parkCopyCard(colIndex, cardIndex) {
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return;
    pushUndo();
    var clone = JSON.parse(JSON.stringify(card));
    clone.id = 'dup-' + Date.now();
    clone.kid = null;
    clone.content = applyInternalHiddenTag(clone.content || '', '#hidden-internal-parked');
    col.cards.splice(fullIdx + 1, 0, clone);
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  async function tagCard(colIndex, cardIndex, tag) {
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    if (fullIdx === -1) return;
    var card = col.cards[fullIdx];
    if (!card) return;
    var nextContent = applyInternalHiddenTag(card.content || '', tag);
    if (nextContent === card.content) return;
    pushUndo();
    card.content = nextContent;
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  async function deleteCard(colIndex, cardIndex) {
    await tagCard(colIndex, cardIndex, '#hidden-internal-deleted');
  }

  function resolveTagTarget(elementType, indices) {
    var text = '';
    var setFn = null;
    if (elementType === 'card') {
      var col = getFullColumn(indices.colIndex);
      if (!col) return null;
      var fullIdx = getFullCardIndex(col, indices.cardIndex);
      if (fullIdx === -1) return null;
      text = col.cards[fullIdx].content || '';
      setFn = function (val) { col.cards[fullIdx].content = val; };
    } else if (elementType === 'column') {
      var col = getFullColumn(indices.colIndex);
      if (!col) return null;
      text = col.title || '';
      setFn = function (val) { col.title = val; };
    } else if (elementType === 'row') {
      var row = findFullDataRow(indices.rowIdx);
      if (!row) return null;
      text = row.title || '';
      setFn = function (val) { row.title = val; };
    } else if (elementType === 'stack') {
      var stack = findFullDataStack(indices.rowIdx, indices.stackIdx);
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

  async function mutateEntityHeaderText(elementType, indices, mutator) {
    if (!fullBoardData || !activeBoardId || typeof mutator !== 'function') return false;
    var target = resolveTagTarget(elementType, indices);
    if (!target || typeof target.setText !== 'function') return false;
    var parts = splitTagHeaderAndBody(target.text || '');
    var nextHeader = mutator(parts.header || '', target.text || '');
    if (typeof nextHeader !== 'string' || nextHeader === parts.header) return false;
    var nextText = rebuildTagHeaderAndBody(nextHeader, parts.bodyLines);
    if (nextText === target.text) return false;
    pushUndo();
    target.setText(nextText);
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
    return true;
  }

  function normalizePromptTagToken(rawToken) {
    return LexeraTagSystem.normalizePromptTagToken(rawToken);
  }

  function parsePromptTagList(rawInput) {
    return LexeraTagSystem.parsePromptTagList(rawInput);
  }

  function removeTagFromHeaderText(headerText, tagName) {
    return LexeraTagSystem.removeTagFromHeader(headerText, tagName);
  }

  function addTagToHeaderText(headerText, tagName) {
    return LexeraTagSystem.addTagToHeader(headerText, tagName);
  }

  function clearRemovableTagsFromHeaderText(headerText) {
    return LexeraTagSystem.clearRemovableTags(headerText);
  }

  async function mutateEntityHeaderTags(elementType, indices, mutator) {
    return mutateEntityHeaderText(elementType, indices, function (header) {
      return mutator(header || '');
    });
  }

  async function promptAddTagsToEntity(elementType, indices) {
    var raw = window.prompt('Add tags (space/comma separated)', '#todo');
    if (raw == null) return;
    var tags = parsePromptTagList(raw);
    if (tags.length === 0) {
      showNotification('No valid tags provided');
      return;
    }
    var changed = await mutateEntityHeaderTags(elementType, indices, function (header) {
      var next = header;
      for (var i = 0; i < tags.length; i++) next = addTagToHeaderText(next, tags[i]);
      return next;
    });
    if (!changed) showNotification('Tags already present');
  }

  async function promptRemoveTagsFromEntity(elementType, indices) {
    var target = resolveTagTarget(elementType, indices);
    var prefill = target ? extractAllTags(target.text || '').join(' ') : '';
    var raw = window.prompt('Remove tags (space/comma separated)', prefill || '#todo');
    if (raw == null) return;
    var tags = parsePromptTagList(raw);
    if (tags.length === 0) {
      showNotification('No valid tags provided');
      return;
    }
    var changed = await mutateEntityHeaderTags(elementType, indices, function (header) {
      var next = header;
      for (var i = 0; i < tags.length; i++) next = removeTagFromHeaderText(next, tags[i]);
      return next;
    });
    if (!changed) showNotification('Selected tags not found');
  }

  async function clearTagsFromEntity(elementType, indices) {
    var changed = await mutateEntityHeaderTags(elementType, indices, clearRemovableTagsFromHeaderText);
    if (!changed) showNotification('No removable tags found');
  }

  async function handleEntityTagMenuAction(action, elementType, indices) {
    if (action === 'tag-add') {
      await promptAddTagsToEntity(elementType, indices);
      return true;
    }
    if (action === 'tag-remove') {
      await promptRemoveTagsFromEntity(elementType, indices);
      return true;
    }
    if (action === 'tag-clear') {
      await clearTagsFromEntity(elementType, indices);
      return true;
    }
    var tagName = extractTagNameFromMenuAction(action);
    if (tagName) {
      await toggleTag(elementType, indices, tagName);
      return true;
    }
    return false;
  }

  async function toggleTag(elementType, indices, tagName) {
    var normalizedTag = normalizePromptTagToken(tagName);
    if (!normalizedTag) return;
    await mutateEntityHeaderTags(elementType, indices, function (header) {
      if (hasTag(header, normalizedTag)) return removeTagFromHeaderText(header, normalizedTag);
      return addTagToHeaderText(header, normalizedTag);
    });
  }

  // --- Column Context Menu & Operations ---

  var activeColMenu = null;

  function closeColumnContextMenu() {
    if (activeColMenu) { activeColMenu.remove(); activeColMenu = null; }
  }

  function showColumnContextMenu(x, y, colIndex, context) {
    var ctx = { colIndex: colIndex };
    if (context) { ctx.rowIdx = context.rowIdx; ctx.stackIdx = context.stackIdx; ctx.colLocalIdx = context.colLocalIdx; }
    showElementContextMenu('column', x, y, ctx);
  }

  async function setColumnIncludePath(colIndex, nextPath) {
    var col = getFullColumn(colIndex);
    if (!col || !fullBoardData || !activeBoardId) return false;
    var cleanPath = String(nextPath || '').trim();
    if (!cleanPath) return false;
    var nextTitle = reconstructColumnTitle(
      addIncludeSyntaxToTitle(col.title || '', cleanPath),
      col.title || ''
    );
    if (nextTitle === col.title && col.includeSource && col.includeSource.rawPath === cleanPath) {
      return false;
    }
    pushUndo();
    col.title = nextTitle;
    col.includeSource = { rawPath: cleanPath };
    return persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  async function enableColumnIncludeMode(colIndex) {
    var col = getFullColumn(colIndex);
    if (!col) return;
    var requested = window.prompt('Include file path', suggestIncludePathForColumn(col.title || ''));
    if (requested == null) return;
    await setColumnIncludePath(colIndex, requested);
  }

  async function editColumnIncludeFile(colIndex) {
    var col = getFullColumn(colIndex);
    if (!col) return;
    var currentPath = col && col.includeSource && col.includeSource.rawPath
      ? String(col.includeSource.rawPath)
      : extractIncludePathFromTitle(col.title || '');
    if (!currentPath) {
      showNotification('This column is not in include mode');
      return;
    }
    var requested = window.prompt('Edit include file path', currentPath);
    if (requested == null) return;
    await setColumnIncludePath(colIndex, requested);
  }

  async function disableColumnIncludeMode(colIndex) {
    var col = getFullColumn(colIndex);
    if (!col) return;
    var currentPath = col && col.includeSource && col.includeSource.rawPath
      ? String(col.includeSource.rawPath)
      : extractIncludePathFromTitle(col.title || '');
    if (!currentPath) return;
    if (!(await showConfirmDialog('Disable include mode? Included cards will be written back into this board as regular cards.'))) {
      return;
    }
    var cleanTitle = removeIncludeSyntaxFromTitle(col.title || '');
    if (!cleanTitle) {
      cleanTitle = getDisplayNameFromPath(currentPath).replace(/\.[^.]+$/, '') || 'Untitled Column';
    }
    pushUndo();
    col.title = reconstructColumnTitle(cleanTitle, col.title || '');
    col.includeSource = null;
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  async function moveColumnToStack(colIndex, targetRowIdx, targetStackIdx) {
    if (!fullBoardData || !fullBoardData.rows) {
      traceFrontendAction('warn', 'column.move', 'Aborted move because fullBoardData is missing', {
        boardId: activeBoardId || null,
        colIndex: colIndex,
        targetRowIdx: targetRowIdx,
        targetStackIdx: targetStackIdx
      });
      return;
    }
    // Find and remove column from current location
    var col = getFullColumn(colIndex);
    if (!col) {
      traceFrontendAction('warn', 'column.move', 'Aborted move because source column could not be resolved', {
        boardId: activeBoardId || null,
        colIndex: colIndex,
        targetRowIdx: targetRowIdx,
        targetStackIdx: targetStackIdx
      });
      return;
    }
    var container = findColumnContainer(colIndex);
    if (!container) {
      traceFrontendAction('warn', 'column.move', 'Aborted move because source container could not be resolved', {
        boardId: activeBoardId || null,
        colIndex: colIndex,
        targetRowIdx: targetRowIdx,
        targetStackIdx: targetStackIdx,
        columnId: col.id || null
      });
      return;
    }
    // Add to target stack — targetRowIdx/targetStackIdx are display indices
    var targetStack = findFullDataStack(targetRowIdx, targetStackIdx);
    if (!targetStack) {
      traceFrontendAction('warn', 'column.move', 'Aborted move because target stack could not be resolved', {
        boardId: activeBoardId || null,
        colIndex: colIndex,
        columnId: col.id || null,
        targetRowIdx: targetRowIdx,
        targetStackIdx: targetStackIdx
      });
      return;
    }
    if (container.stack === targetStack) {
      traceFrontendAction('warn', 'column.move', 'Skipping move because source and target stack are identical', {
        boardId: activeBoardId || null,
        colIndex: colIndex,
        columnId: col.id || null,
        rowIdx: container.rowIdx,
        stackIdx: container.stackIdx
      });
      return;
    }
    traceFrontendAction('info', 'column.move', 'Moving column to stack', {
      boardId: activeBoardId || null,
      colIndex: colIndex,
      columnId: col.id || null,
      sourceRowIdx: container.rowIdx,
      sourceStackIdx: container.stackIdx,
      targetRowIdx: targetRowIdx,
      targetStackIdx: targetStackIdx
    });
    pushUndo();
    var removed = container.arr.splice(container.localIdx, 1)[0];
    targetStack.columns.push(removed);
    removeEmptyStacksAndRows();
    await persistBoardMutation({ refreshSidebar: true });
  }


  async function setColumnHiddenTag(colIndex, tag) {
    traceFrontendAction('info', 'column.hiddenTag', 'setColumnHiddenTag called', { colIndex: colIndex, tag: tag });
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col) {
      traceFrontendAction('warn', 'column.hiddenTag', 'getFullColumn returned null', { colIndex: colIndex });
      return;
    }
    var nextTitle = applyInternalHiddenTag(col.title || '', tag);
    traceFrontendAction('info', 'column.hiddenTag', 'Title transformation', { oldTitle: col.title, nextTitle: nextTitle, same: nextTitle === col.title });
    if (nextTitle === col.title) return;
    pushUndo();
    col.title = nextTitle;
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
    // Post-save verification: check if the tag survived the save round-trip
    var postSaveCol = getFullColumn(colIndex);
    var postTitle = postSaveCol ? postSaveCol.title : '(col gone)';
    var tagSurvived = postTitle.indexOf(tag) !== -1;
    traceFrontendAction(tagSurvived ? 'info' : 'error', 'column.hiddenTag', 'Post-save verification', {
      colIndex: colIndex,
      expectedTag: tag,
      postSaveTitle: postTitle,
      tagSurvived: tagSurvived
    });
  }

  function compareNumericTagParts(aParts, bParts) {
    var left = Array.isArray(aParts) ? aParts : null;
    var right = Array.isArray(bParts) ? bParts : null;
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    var maxLen = Math.max(left.length, right.length);
    for (var i = 0; i < maxLen; i++) {
      var lv = i < left.length ? left[i] : 0;
      var rv = i < right.length ? right[i] : 0;
      if (lv !== rv) return lv - rv;
    }
    return left.length - right.length;
  }

  function extractFirstTemporalDateValue(content) {
    var tokens = collectHeaderTagTokens(content, { includeHash: false, includeAt: true, includeTemporalBang: true });
    for (var i = 0; i < tokens.length; i++) {
      var type = getTemporalTagType(tokens[i]);
      if (type === 'date' || type === 'weekday') {
        var resolved = resolveTemporalTag(tokens[i]);
        if (resolved) return resolved;
      }
    }
    return '';
  }

  function compareCardsForSort(a, b, mode) {
    if (mode === 'title') {
      var titleA = String((a && a.content ? a.content : '')).split('\n')[0].toLowerCase();
      var titleB = String((b && b.content ? b.content : '')).split('\n')[0].toLowerCase();
      return titleA < titleB ? -1 : titleA > titleB ? 1 : 0;
    }
    if (mode === 'tag') {
      return compareNumericTagParts(extractNumericTag(a && a.content ? a.content : ''), extractNumericTag(b && b.content ? b.content : ''));
    }
    if (mode === 'duedate') {
      var dateA = extractFirstTemporalDateValue(a && a.content ? a.content : '');
      var dateB = extractFirstTemporalDateValue(b && b.content ? b.content : '');
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA < dateB ? -1 : dateA > dateB ? 1 : 0;
    }
    return 0;
  }

  async function sortColumnCards(colIndex, mode) {
    var col = getFullColumn(colIndex);
    if (!col || col.cards.length < 2) return;
    var key = colIndex + ':' + mode;
    var prevDir = columnSortState[key] || 'asc';
    var dir = prevDir === 'asc' ? 'desc' : 'asc';
    columnSortState[key] = dir;
    pushUndo();
    col.cards.sort(function (a, b) {
      var cmp = compareCardsForSort(a, b, mode);
      return dir === 'desc' ? -cmp : cmp;
    });
    await persistBoardMutation();
  }

  function sortColumnsCards(columns, mode) {
    var changed = false;
    for (var i = 0; i < columns.length; i++) {
      var col = columns[i];
      if (!col || !Array.isArray(col.cards) || col.cards.length < 2) continue;
      col.cards.sort(function (a, b) { return compareCardsForSort(a, b, mode); });
      changed = true;
    }
    return changed;
  }

  async function sortRowCards(rowIdx, mode) {
    var row = findFullDataRow(rowIdx);
    if (!row || !row.stacks) return;
    var cols = [];
    for (var s = 0; s < row.stacks.length; s++) {
      var stack = row.stacks[s];
      if (stack && stack.columns) cols = cols.concat(stack.columns);
    }
    if (cols.length === 0) return;
    pushUndo();
    sortColumnsCards(cols, mode);
    await persistBoardMutation();
  }

  async function sortStackCards(rowIdx, stackIdx, mode) {
    var stack = findFullDataStack(rowIdx, stackIdx);
    if (!stack || !stack.columns) return;
    pushUndo();
    sortColumnsCards(stack.columns, mode);
    await persistBoardMutation();
  }

  async function sortAllCardsAcrossBoard(mode) {
    if (!fullBoardData || !activeBoardId) return;
    var allCols = getAllColumnsFromBoardData(fullBoardData);
    if (!allCols || allCols.length === 0) return;

    var plans = [];
    for (var i = 0; i < allCols.length; i++) {
      var col = allCols[i];
      if (!col || !Array.isArray(col.cards) || col.cards.length < 2) continue;
      var sorted = col.cards.slice().sort(function (a, b) { return compareCardsForSort(a, b, mode); });
      var different = false;
      for (var j = 0; j < sorted.length; j++) {
        if (sorted[j] !== col.cards[j]) {
          different = true;
          break;
        }
      }
      if (different) plans.push({ column: col, cards: sorted });
    }
    if (plans.length === 0) return;

    pushUndo();
    for (var p = 0; p < plans.length; p++) {
      plans[p].column.cards = plans[p].cards;
    }
    await persistBoardMutation();
  }

  function extractNumericTag(content) {
    var numericTags = extractAllNumericTags(content);
    return numericTags.length > 0 ? numericTags[0].parts.slice() : null;
  }

  function extractAllNumericTags(content) {
    var tokens = collectHeaderTagTokens(content, {
      includeHash: true,
      includeAt: false,
      includeTemporalBang: false
    });
    var out = [];
    var seen = {};
    for (var i = 0; i < tokens.length; i++) {
      var token = String(tokens[i] || '');
      if (!isNumericIndexTag(token)) continue;
      var normalizedToken = token.toLowerCase();
      if (seen[normalizedToken]) continue;
      seen[normalizedToken] = true;
      var parts = token.slice(1).split('.');
      var numbers = [];
      for (var p = 0; p < parts.length; p++) {
        var part = parseInt(parts[p], 10);
        if (!isFinite(part)) {
          numbers = null;
          break;
        }
        numbers.push(part);
      }
      if (numbers && numbers.length > 0) {
        out.push({
          tag: token,
          parts: numbers
        });
      }
    }
    return out;
  }

  function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function enterColumnRename(colEl, colIndex) {
    if (!fullBoardData) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var titleEl = colEl.querySelector('.column-title');
    if (!titleEl) return;
    var includePath = extractIncludePathFromTitle(col.title);
    var currentTitle = removeIncludeSyntaxFromTitle(stripLayoutTags(col.title));
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'column-rename-input';
    input.value = currentTitle;
    titleEl.textContent = '';
    titleEl.appendChild(input);
    input.focus();
    input.select();

    var done = false;
    function save() {
      if (done) return;
      done = true;
      var newTitle = input.value.trim();
      if (newTitle && newTitle !== currentTitle) {
        pushUndo();
        var rebuilt = reconstructColumnTitle(newTitle, col.title);
        if (includePath) {
          rebuilt = addIncludeSyntaxToTitle(rebuilt, includePath);
        }
        col.title = rebuilt;
        persistBoardMutation();
      } else {
        var displayTitle = includePath ? addIncludeSyntaxToTitle(currentTitle, includePath) : currentTitle;
        titleEl.innerHTML = renderTitleInline(displayTitle, activeBoardId, { allowIncludeDirectives: true });
      }
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); save(); }
    });
  }

  /**
   * Find the container array and local index for a flat column index.
   * Returns { arr: array, localIdx: number } where arr is the columns array
   * containing the column, and localIdx is its position within that array.
   */
  function getBoardColumnByPath(boardData, rowIdx, stackIdx, colIdx) {
    if (!boardData || !boardData.rows) return null;
    if (rowIdx < 0 || rowIdx >= boardData.rows.length) return null;
    var row = boardData.rows[rowIdx];
    if (!row.stacks || stackIdx < 0 || stackIdx >= row.stacks.length) return null;
    var stack = row.stacks[stackIdx];
    if (!stack.columns || colIdx < 0 || colIdx >= stack.columns.length) return null;
    return stack.columns[colIdx];
  }

  function findColumnContainerInBoard(boardData, flatIndex) {
    if (!boardData || !boardData.rows) return null;
    var idx = 0;
    for (var r = 0; r < boardData.rows.length; r++) {
      var row = boardData.rows[r];
      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        for (var c = 0; c < stack.columns.length; c++) {
          if (idx === flatIndex) {
            return {
              arr: stack.columns,
              localIdx: c,
              row: row,
              rowIdx: r,
              stack: stack,
              stackIdx: s
            };
          }
          idx++;
        }
      }
    }
    return null;
  }

  function findColumnContainer(flatIndex) {
    return findColumnContainerInBoard(fullBoardData, flatIndex);
  }

  async function addColumn(atIndex) {
    if (!fullBoardData || !activeBoardId) {
      traceFrontendAction('warn', 'column.create.flat', 'Aborted flat add column because board data is missing', {
        boardId: activeBoardId || null,
        atIndex: atIndex
      });
      return false;
    }
    pushUndo();
    var newCol = { id: 'col-' + Date.now(), title: 'New Column', cards: [] };
    var container = findColumnContainer(atIndex);
    if (container) {
      traceFrontendAction('info', 'column.create.flat', 'Resolved flat insertion container', {
        boardId: activeBoardId || null,
        atIndex: atIndex,
        rowIdx: container.rowIdx,
        stackIdx: container.stackIdx,
        localIdx: container.localIdx,
        columnId: newCol.id
      });
    } else {
      traceFrontendAction('warn', 'column.create.flat', 'Flat insertion fell back to last visible stack', {
        boardId: activeBoardId || null,
        atIndex: atIndex,
        columnId: newCol.id
      });
    }
    if (container) {
      container.arr.splice(container.localIdx, 0, newCol);
    } else {
      // atIndex is past end — append to last stack of last row.
      // Ensure at least one row/stack exists for empty boards.
      if (!fullBoardData.rows || fullBoardData.rows.length === 0) {
        fullBoardData.rows = [{
          id: 'row-' + Date.now(),
          title: fullBoardData.title || 'Board',
          stacks: []
        }];
      }
      var lastRow = fullBoardData.rows[fullBoardData.rows.length - 1];
      if (!lastRow.stacks || lastRow.stacks.length === 0) {
        lastRow.stacks = [{
          id: 'stack-' + Date.now(),
          title: 'Default',
          columns: []
        }];
      }
      lastRow.stacks[lastRow.stacks.length - 1].columns.push(newCol);
    }
    var saved = await persistBoardMutation();
    traceFrontendAction(saved ? 'info' : 'warn', 'column.create.flat', saved ? 'Persisted flat column insertion' : 'Flat column insertion persist reported failure', {
      boardId: activeBoardId || null,
      atIndex: atIndex,
      columnId: newCol.id
    });
    return saved;
  }

  async function deleteColumn(colIndex) {
    traceFrontendAction('info', 'column.delete', 'deleteColumn called', { colIndex: colIndex });
    if (!fullBoardData || !activeBoardId) {
      traceFrontendAction('warn', 'column.delete', 'No fullBoardData or activeBoardId');
      return;
    }
    var col = getFullColumn(colIndex);
    if (!col) {
      traceFrontendAction('warn', 'column.delete', 'getFullColumn returned null', { colIndex: colIndex });
      return;
    }
    var visibleCards = (col.cards || []).filter(function (c) { return !is_archived_or_deleted(c.content || ''); });
    traceFrontendAction('info', 'column.delete', 'Column found', { title: col.title, totalCards: col.cards.length, visibleCards: visibleCards.length });
    if (visibleCards.length > 0) {
      var confirmed = await showConfirmDialog('Move column "' + stripLayoutTags(col.title) + '" and ' + visibleCards.length + ' card(s) to trash?');
      traceFrontendAction('info', 'column.delete', 'Confirm dialog result', { confirmed: confirmed });
      if (!confirmed) return;
    }
    traceFrontendAction('info', 'column.delete', 'Calling setColumnHiddenTag');
    await setColumnHiddenTag(colIndex, '#hidden-internal-deleted');
  }

  async function duplicateColumn(colIndex) {
    if (!fullBoardData || !activeBoardId) return;
    var container = findColumnContainer(colIndex);
    if (!container) return;
    var col = container.arr[container.localIdx];
    if (!col) return;
    pushUndo();
    var clone = JSON.parse(JSON.stringify(col));
    var ts = Date.now();
    clone.id = 'col-' + ts;
    for (var k = 0; k < clone.cards.length; k++) {
      clone.cards[k].id = 'dup-' + ts + '-' + k;
      clone.cards[k].kid = null;
    }
    container.arr.splice(container.localIdx + 1, 0, clone);
    await persistBoardMutation({ refreshSidebar: true });
  }

  function toggleColCards(colIndex, collapse) {
    if (isCanvasBoardLayout()) return;
    var cards = getElColumnsContainer().querySelectorAll('.card[data-col-index="' + colIndex + '"]');
    for (var i = 0; i < cards.length; i++) {
      if (collapse) {
        cards[i].classList.add('collapsed');
      } else {
        cards[i].classList.remove('collapsed');
      }
      var toggle = cards[i].querySelector('.card-collapse-toggle');
      if (toggle) {
        if (collapse) toggle.classList.remove('expanded');
        else toggle.classList.add('expanded');
      }
    }
    saveCardCollapseState(activeBoardId);
  }

  function revealCardContent(colIndex, cardIndex) {
    var card = getElColumnsContainer().querySelector('.card[data-col-index="' + colIndex + '"][data-card-index="' + cardIndex + '"]');
    if (!card) return;
    if (card.hasAttribute('data-hidden-revealed')) {
      card.removeAttribute('data-hidden-revealed');
    } else {
      card.setAttribute('data-hidden-revealed', '');
    }
  }

  function revealColumnContent(colIndex) {
    var cards = getElColumnsContainer().querySelectorAll('.card[data-col-index="' + colIndex + '"]');
    var allRevealed = true;
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].hasAttribute('data-hidden-revealed')) { allRevealed = false; break; }
    }
    for (var j = 0; j < cards.length; j++) {
      if (allRevealed) cards[j].removeAttribute('data-hidden-revealed');
      else cards[j].setAttribute('data-hidden-revealed', '');
    }
  }

  function revealRowContent(rowIdx) {
    var columnsContainer = getElColumnsContainer();
    var rowEl = columnsContainer.querySelectorAll('.kanban-row')[rowIdx];
    if (!rowEl) return;
    var cards = rowEl.querySelectorAll('.card');
    var allRevealed = true;
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].hasAttribute('data-hidden-revealed')) { allRevealed = false; break; }
    }
    for (var j = 0; j < cards.length; j++) {
      if (allRevealed) cards[j].removeAttribute('data-hidden-revealed');
      else cards[j].setAttribute('data-hidden-revealed', '');
    }
  }

  function revealStackContent(rowIdx, stackIdx) {
    var columnsContainer = getElColumnsContainer();
    var rowEl = columnsContainer.querySelectorAll('.kanban-row')[rowIdx];
    if (!rowEl) return;
    var stackEl = rowEl.querySelectorAll('.kanban-column-stack')[stackIdx];
    if (!stackEl) return;
    var cards = stackEl.querySelectorAll('.card');
    var allRevealed = true;
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].hasAttribute('data-hidden-revealed')) { allRevealed = false; break; }
    }
    for (var j = 0; j < cards.length; j++) {
      if (allRevealed) cards[j].removeAttribute('data-hidden-revealed');
      else cards[j].setAttribute('data-hidden-revealed', '');
    }
  }

  // Close context menus on outside click
  document.addEventListener('click', function () {
    closeColumnContextMenu();
    closeRowStackMenu();
  });

  // --- Search ---

  let searchDebounce = null;

  function onSearchInput() {
    clearTimeout(searchDebounce);
    var q = $searchInput.value.trim();
    if (!q) {
      exitSearchMode();
      updateHeaderSearchVisibility();
      return;
    }
    if (!headerSearchExpanded) setHeaderSearchExpanded(true);
    searchDebounce = setTimeout(function () { performSearch(q); }, 300);
  }

  async function performSearch(query) {
    try {
      searchResults = await LexeraApi.search(query);
      searchMode = true;
      updateHeaderSearchVisibility();
      renderSearchResults();
    } catch (err) {
      logFrontendIssue('warn', 'search.perform', 'Search failed for query "' + query + '"', err);
    }
  }

  function openWikiSearch(query) {
    var value = String(query || '').trim();
    if (!value) return;
    if ($searchInput) $searchInput.value = value;
    if (!headerSearchExpanded) setHeaderSearchExpanded(true);
    performSearch(value);
  }

  async function openWikiDocument(documentName, options) {
    options = options || {};
    var resolved = resolveWikiDocument(documentName);
    if (resolved.kind === 'tag') {
      openWikiSearch(resolved.document);
      return resolved;
    }
    if (resolved.kind !== 'board' || !resolved.boardId) {
      if (!options.silent) showNotification('Wiki link not found: ' + String(documentName || ''));
      return resolved;
    }
    try {
      await selectBoard(resolved.boardId, { duplicate: !!options.duplicate });
    } catch (err) {
      lexeraLog('error', '[wiki] Failed to open document: ' + resolved.document + ' ' + err);
      if (!options.silent) showNotification('Failed to open wiki link');
    }
    return resolved;
  }

  function exitSearchMode() {
    searchMode = false;
    searchResults = null;
    getElSearchResults().classList.add('hidden');
    updateHeaderSearchVisibility();
    renderMainView();
  }

  // ── Board Tag Filter & Statistics Bar (delegated to BoardStatsFilter module) ──
  function toggleBoardTagFilter(tag) { if (BoardStatsFilter) BoardStatsFilter.toggleBoardTagFilter(tag); }
  function clearBoardTagFilter() { if (BoardStatsFilter) BoardStatsFilter.clearBoardTagFilter(); }
  function applyBoardTagFilter() { if (BoardStatsFilter) BoardStatsFilter.applyBoardTagFilter(); }
  function renderBoardTagFilterBar() { if (BoardStatsFilter) BoardStatsFilter.renderBoardTagFilterBar(); }
  function toggleBoardStatsBar() { if (BoardStatsFilter) BoardStatsFilter.toggleBoardStatsBar(); }
  function renderBoardStatsBar() { if (BoardStatsFilter) BoardStatsFilter.renderBoardStatsBar(); }

  function parseOptionalSearchIndex(value) {
    return getDashboardTreeApi().parseOptionalSearchIndex(value);
  }

  function buildSearchResultLocation(item) {
    return getDashboardTreeApi().buildSearchResultLocation(item);
  }

  function buildHierarchyFocusTargetFromTreeNode(node, boardId) {
    return getBoardNavigationApi().buildHierarchyFocusTargetFromTreeNode(node, boardId, {
      parseOptionalSearchIndex: parseOptionalSearchIndex
    });
  }

  function findBoardEntityElement(target) {
    if (!target || !getElColumnsContainer()) return null;

    if (target.cardId) {
      var byCardId = getElColumnsContainer().querySelector('.card[data-card-id="' + escapeAttr(String(target.cardId)) + '"]');
      if (byCardId) return byCardId;
    }

    if (
      typeof target.rowIndex === 'number' &&
      typeof target.stackIndex === 'number' &&
      typeof target.colLocalIndex === 'number' &&
      typeof target.cardIndex === 'number'
    ) {
      var cardSelector =
        '.column[data-row-index="' + target.rowIndex + '"][data-stack-index="' + target.stackIndex + '"][data-col-local-index="' + target.colLocalIndex + '"] ' +
        '.card[data-card-index="' + target.cardIndex + '"]';
      var byPath = getElColumnsContainer().querySelector(cardSelector);
      if (byPath) return byPath;
    }

    if (
      typeof target.rowIndex === 'number' &&
      typeof target.stackIndex === 'number' &&
      typeof target.colLocalIndex === 'number'
    ) {
      var columnSelector = '.column[data-row-index="' + target.rowIndex + '"][data-stack-index="' + target.stackIndex + '"][data-col-local-index="' + target.colLocalIndex + '"]';
      var columnEl = getElColumnsContainer().querySelector(columnSelector);
      if (columnEl) return columnEl;
    }

    if (typeof target.rowIndex === 'number' && typeof target.stackIndex === 'number') {
      var stackSelector = '.board-stack[data-row-index="' + target.rowIndex + '"][data-stack-index="' + target.stackIndex + '"]';
      var stackEl = getElColumnsContainer().querySelector(stackSelector);
      if (stackEl) return stackEl;
    }

    if (typeof target.rowIndex === 'number') {
      return getElColumnsContainer().querySelector('.board-row[data-row-index="' + target.rowIndex + '"]');
    }

    return null;
  }

  function focusHierarchyTargetLocally(target) {
    var el = findBoardEntityElement(target);
    if (!el) return false;

    if (el.classList.contains('card')) {
      focusCard(el);
      return true;
    }

    unfocusCard();
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    focusBoardEntity(el);
    syncSidebarToView();
    return true;
  }

  function unfoldSearchTarget(result) {
    return getBoardNavigationApi().unfoldSearchTarget(result, {
      getActiveBoardId: function () { return activeBoardId; },
      getColumnsContainer: getElColumnsContainer,
      saveFoldState: saveFoldState
    });
  }

  async function navigateToHierarchyTarget(target, options) {
    options = options || {};
    if (workspaceShellEnabled && WorkspaceShell && target && target.boardId) {
      WorkspaceShell.focusHierarchyTarget(target, target.boardId, options || {});
      return true;
    }
    return getBoardNavigationApi().navigateToHierarchyTarget(target, {
      selectBoard: selectBoard,
      getActiveBoardId: function () { return activeBoardId; },
      getActiveBoardData: function () { return activeBoardData; },
      loadBoard: loadBoard,
      unfoldSearchTarget: unfoldSearchTarget,
      focusHierarchyTargetLocally: focusHierarchyTargetLocally
    });
  }

  function focusSearchResultCard(result) {
    return getBoardNavigationApi().focusSearchResultCard(result, {
      getColumnsContainer: getElColumnsContainer,
      escapeAttr: escapeAttr,
      focusCard: focusCard
    });
  }

  async function navigateToSearchResult(result) {
    if (workspaceShellEnabled && WorkspaceShell && result && result.boardId) {
      WorkspaceShell.focusHierarchyTarget({
        boardId: result.boardId,
        cardId: result.cardId,
        rowIndex: parseOptionalSearchIndex(result.rowIndex),
        stackIndex: parseOptionalSearchIndex(result.stackIndex),
        colLocalIndex: parseOptionalSearchIndex(result.colLocalIndex),
        cardIndex: parseOptionalSearchIndex(result.cardIndex)
      }, result.boardId, {});
      return true;
    }
    return getBoardNavigationApi().navigateToSearchResult(result, {
      searchInput: $searchInput,
      exitSearchMode: exitSearchMode,
      selectBoard: selectBoard,
      getActiveBoardId: function () { return activeBoardId; },
      getActiveBoardData: function () { return activeBoardData; },
      loadBoard: loadBoard,
      unfoldSearchTarget: unfoldSearchTarget,
      focusSearchResultCard: focusSearchResultCard,
      showNotification: showNotification,
      lexeraLog: lexeraLog
    });
  }

  function renderSearchResults() {
    getElBoardHeader().classList.add('hidden');
    getElColumnsContainer().classList.add('hidden');
    getElEmptyState().classList.add('hidden');
    getElSearchResults().classList.remove('hidden');

    if (!searchResults || !searchResults.results.length) {
      getElSearchResults().innerHTML =
        '<div class="search-results-title">Search: "' + escapeHtml(searchResults ? searchResults.query : '') + '"</div>' +
        '<div class="empty-state" style="height:auto;padding:40px"><div>No results found</div></div>';
      return;
    }

    var groups = {};
    for (var i = 0; i < searchResults.results.length; i++) {
      var r = searchResults.results[i];
      var key = r.boardId;
      if (!groups[key]) groups[key] = { title: r.boardTitle, boardId: r.boardId, items: [] };
      groups[key].items.push(r);
    }

    var html = '<div class="search-results-title">Search: "' + escapeHtml(searchResults.query) + '" (' + searchResults.results.length + ' results)</div>';

    var keys = Object.keys(groups);
    var resultCursor = 0;
    for (var g = 0; g < keys.length; g++) {
      var group = groups[keys[g]];
      html += '<div class="search-group">';
      html += '<div class="search-group-title">' + escapeHtml(group.title || 'Untitled') + '</div>';

      for (var j = 0; j < group.items.length; j++) {
        var item = group.items[j];
        var resultIdx = resultCursor;
        resultCursor += 1;
        var location = buildSearchResultLocation(item);
        html += '<div class="search-result-item" data-result-index="' + resultIdx + '"' +
          ' data-board="' + escapeAttr(String(item.boardId || '')) + '"' +
          ' data-card-id="' + escapeAttr(String(item.cardId || '')) + '"' +
          ' data-column-index="' + escapeAttr(String(item.columnIndex)) + '"' +
          ' data-row-index="' + escapeAttr(String(item.rowIndex == null ? '' : item.rowIndex)) + '"' +
          ' data-stack-index="' + escapeAttr(String(item.stackIndex == null ? '' : item.stackIndex)) + '"' +
          '>';
        html += '<div class="search-result-column">' + escapeHtml(location) + '</div>';
        html += '<div class="search-result-content">' + escapeHtml(item.cardContent) + '</div>';
        html += '</div>';
      }
      html += '</div>';
    }

    getElSearchResults().innerHTML = html;

    var resultItems = getElSearchResults().querySelectorAll('.search-result-item');
    for (var k = 0; k < resultItems.length; k++) {
      resultItems[k].addEventListener('click', function () {
        var idx = parseOptionalSearchIndex(this.getAttribute('data-result-index'));
        if (idx == null || !searchResults || !searchResults.results || idx < 0 || idx >= searchResults.results.length) {
          return;
        }
        var raw = searchResults.results[idx];
        var nav = {
          boardId: raw.boardId,
          cardId: raw.cardId,
          cardContent: raw.cardContent,
          columnIndex: parseOptionalSearchIndex(raw.columnIndex),
          rowIndex: parseOptionalSearchIndex(raw.rowIndex),
          stackIndex: parseOptionalSearchIndex(raw.stackIndex),
          columnTitle: raw.columnTitle
        };
        navigateToSearchResult(nav);
      });
    }
  }

  // --- Embed Menu --- (delegated to LexeraEmbedMenu module)

  var _EmbedMenu = window.LexeraEmbedMenu || null;

  // Init the embed menu module with all required dependencies
  if (_EmbedMenu && typeof _EmbedMenu.init === 'function') {
    _EmbedMenu.init({
      // Pure utility deps
      escapeHtml: escapeHtml,
      escapeAttr: escapeAttr,
      escapeRegex: escapeRegex,
      decodeHtmlEntities: decodeHtmlEntities,
      getDisplayFileNameFromPath: getDisplayFileNameFromPath,
      getDisplayNameFromPath: getDisplayNameFromPath,
      getFileExtension: getFileExtension,
      getFileNameFromPath: getFileNameFromPath,
      getDirNameFromPath: getDirNameFromPath,
      normalizePathForCompare: normalizePathForCompare,
      parseLocalFileReference: parseLocalFileReference,
      showNotification: showNotification,
      showConfirmDialog: showConfirmDialog,
      logFrontendIssue: logFrontendIssue,
      traceFrontendAction: traceFrontendAction,
      summarizeMenuItems: summarizeMenuItems,
      lexeraLog: lexeraLog,
      getTagColor: getTagColor,
      getContrastingTextColor: getContrastingTextColor,
      buildTagStyleDescriptor: buildTagStyleDescriptor,
      describeTemporalTag: describeTemporalTag,
      renderCardContent: renderCardContent,
      renderInline: renderInline,
      applyRenderedHtmlCommentVisibility: applyRenderedHtmlCommentVisibility,
      applyRenderedTagVisibility: applyRenderedTagVisibility,
      flushPendingDiagramQueues: flushPendingDiagramQueues,
      getCurrentEditorBoardId: getCurrentEditorBoardId,
      getBoardFilePathForId: getBoardFilePathForId,
      getBoardDisplayName: getBoardDisplayName,
      getFullColumn: getFullColumn,
      getFullCardIndex: getFullCardIndex,
      findFullDataRow: findFullDataRow,
      findFullDataStack: findFullDataStack,
      findColumnContainer: findColumnContainer,
      getColumnByLocation: getColumnByLocation,
      pushUndo: pushUndo,
      persistBoardMutation: persistBoardMutation,
      resolveWikiDocument: resolveWikiDocument,
      openWikiDocument: openWikiDocument,
      openWikiSearch: openWikiSearch,
      setCurrentCardEditorMarkdown: setCurrentCardEditorMarkdown,
      ensureCardEditorWysiwyg: ensureCardEditorWysiwyg,
      refreshCardEditorPreview: refreshCardEditorPreview,
      triggerBoardExport: triggerBoardExport,
      resolveCurrentEditorResourcePath: resolveCurrentEditorResourcePath,
      insertFormatting: insertFormatting,
      formatEmbeddedRendererStatusItem: formatEmbeddedRendererStatusItem,
      refreshEmbeddedRendererStatuses: refreshEmbeddedRendererStatuses,
      replaceNthIncludeDirective: replaceNthIncludeDirective,
      replaceCurrentEmbedOccurrence: replaceCurrentEmbedOccurrence,
      getInlineFileEmbedExtension: getInlineFileEmbedExtension,
      getMediaCategory: getMediaCategory,
      hasInternalHiddenTag: hasInternalHiddenTag,
      createBuiltInNamedFile: createBuiltInNamedFile,
      decodeBase64BinaryStringToUint8Array: decodeBase64BinaryStringToUint8Array,
      buildPastedEmbedImageFileName: buildPastedEmbedImageFileName,
      getUploadedMediaEmbedTarget: getUploadedMediaEmbedTarget,
      safeDecodePath: safeDecodePath,
      resolveRelativePath: resolveRelativePath,
      isRelativeResourcePath: isRelativeResourcePath,
      isWindowsAbsolutePath: isWindowsAbsolutePath,
      normalizeWindowsAbsolutePath: normalizeWindowsAbsolutePath,
      buildWebviewResourceUrl: buildWebviewResourceUrl,

      // State getters
      getActiveBoardId: function () { return activeBoardId; },
      getCurrentCardEditor: function () { return currentCardEditor; },
      getFullBoardData: function () { return fullBoardData; },
      getCurrentHtmlCommentRenderMode: function () { return currentHtmlCommentRenderMode; },
      getCurrentTagVisibilityMode: function () { return currentTagVisibilityMode; },
      getExportToolStatusCache: function () { return getExportToolStatusCache(); },
      isEmbeddedMode: function () { return embeddedMode; },
      getLexeraApi: function () { return LexeraApi; },
      getContentEnhancerRegistry: function () { return ContentEnhancerRegistry; },
      getDiagramRegistry: function () { return DiagramRegistry; }
    });

    // Register content enhancers and event listeners
    _EmbedMenu._registerContentEnhancers();
    _EmbedMenu._registerEventListeners();
    _EmbedMenu._registerWindowGlobals();
  }

  // Delegation stubs — thin wrappers that forward to the module
  function isMarkdownPreviewExtension(ext) { return _EmbedMenu ? _EmbedMenu.isMarkdownPreviewExtension(ext) : false; }
  function isTextPreviewExtension(ext) { return _EmbedMenu ? _EmbedMenu.isTextPreviewExtension(ext) : false; }
  function normalizeFilePathForDetection(path) { return _EmbedMenu ? _EmbedMenu.normalizeFilePathForDetection(path) : ''; }
  function getSpecialPreviewType(filePath) { return _EmbedMenu ? _EmbedMenu.getSpecialPreviewType(filePath) : ''; }
  function getPreviewKindMeta(kind, filePath) { return _EmbedMenu ? _EmbedMenu.getPreviewKindMeta(kind, filePath) : { label: 'File', emoji: '&#128196;' }; }
  function buildFilePreviewPlaceholderHtml(kind, filePath, desc) { return _EmbedMenu ? _EmbedMenu.buildFilePreviewPlaceholderHtml(kind, filePath, desc) : ''; }
  function getFileEmbedChipHtml(kind, filePath, extra) { return _EmbedMenu ? _EmbedMenu.getFileEmbedChipHtml(kind, filePath, extra) : ''; }
  function getSpecialPreviewPlaceholderText(k, f) { return _EmbedMenu ? _EmbedMenu.getSpecialPreviewPlaceholderText(k, f) : ''; }
  function isRenderedSpecialPreviewKind(k) { return _EmbedMenu ? _EmbedMenu.isRenderedSpecialPreviewKind(k) : false; }
  function getEmbedPreviewKind(f) { return _EmbedMenu ? _EmbedMenu.getEmbedPreviewKind(f) : ''; }
  function getEmbedPreviewCacheKey(b, f) { return _EmbedMenu ? _EmbedMenu.getEmbedPreviewCacheKey(b, f) : ''; }
  function getSpecialFileEditorKind(f) { return _EmbedMenu ? _EmbedMenu.getSpecialFileEditorKind(f) : ''; }
  function clearCachedFilePreviewState(b, f) { if (_EmbedMenu) _EmbedMenu.clearCachedFilePreviewState(b, f); }
  function clearBoardPreviewCaches(b) { if (_EmbedMenu) _EmbedMenu.clearBoardPreviewCaches(b); }
  function requestFileInfo(b, f) { return _EmbedMenu ? _EmbedMenu.requestFileInfo(b, f) : Promise.resolve(null); }
  function renderCachedSpecialPreview(el, b, f, k, o) { return _EmbedMenu ? _EmbedMenu.renderCachedSpecialPreview(el, b, f, k, o) : Promise.resolve(false); }
  function requestRenderedPlantUmlSvg(b, c) { return _EmbedMenu ? _EmbedMenu.requestRenderedPlantUmlSvg(b, c) : Promise.reject(new Error('module not loaded')); }
  function buildSpecialPreviewPlaceholderMessage(k, b, f) { return _EmbedMenu ? _EmbedMenu.buildSpecialPreviewPlaceholderMessage(k, b, f) : ''; }
  function openSpecialFileEditorOverlay(b, f) { return _EmbedMenu ? _EmbedMenu.openSpecialFileEditorOverlay(b, f) : Promise.resolve(); }
  function showBoardFilePreview(b, f, o) { return _EmbedMenu ? _EmbedMenu.showBoardFilePreview(b, f, o) : undefined; }
  function showFileRendererStatusMenu(b, f, t) { return _EmbedMenu ? _EmbedMenu.showFileRendererStatusMenu(b, f, t) : Promise.resolve(); }
  function refreshVisibleBoardFileEmbeds(b, f) { if (_EmbedMenu) _EmbedMenu.refreshVisibleBoardFileEmbeds(b, f); }
  function refreshVisibleIncludePreviews(b, f) { if (_EmbedMenu) _EmbedMenu.refreshVisibleIncludePreviews(b, f); }

  function enhanceEmbeddedContent(root) { if (_EmbedMenu) _EmbedMenu.enhanceEmbeddedContent(root); }
  function enhanceSingleEmbedContainer(c, o) { if (_EmbedMenu) _EmbedMenu.enhanceSingleEmbedContainer(c, o); }
  function enhanceSingleExternalEmbedContainer(c, o) { if (_EmbedMenu) _EmbedMenu.enhanceSingleExternalEmbedContainer(c, o); }
  function enhanceSingleFileLink(l) { if (_EmbedMenu) _EmbedMenu.enhanceSingleFileLink(l); }
  function enhanceSingleInlineFileEmbed(c) { if (_EmbedMenu) _EmbedMenu.enhanceSingleInlineFileEmbed(c); }
  function enhanceSingleColumnIncludeBadge(b) { if (_EmbedMenu) _EmbedMenu.enhanceSingleColumnIncludeBadge(b); }
  function enhanceSingleIncludeDirective(c) { if (_EmbedMenu) _EmbedMenu.enhanceSingleIncludeDirective(c); }

  function closeEmbedMenu() { if (_EmbedMenu) _EmbedMenu.closeEmbedMenu(); }
  function showEmbedMenu(c, b) { if (_EmbedMenu) _EmbedMenu.showEmbedMenu(c, b); }
  function showIncludeMenu(c, b) { if (_EmbedMenu) _EmbedMenu.showIncludeMenu(c, b); }
  function showBoardFileLinkMenu(c, t) { if (_EmbedMenu) _EmbedMenu.showBoardFileLinkMenu(c, t); }
  function showDiagramMenu(c, t) { if (_EmbedMenu) _EmbedMenu.showDiagramMenu(c, t); }
  function showWikiMenu(c, b) { if (_EmbedMenu) _EmbedMenu.showWikiMenu(c, b); }
  function handleEmbedAction(a, c, t) { if (_EmbedMenu) _EmbedMenu.handleEmbedAction(a, c, t); }
  function handleIncludeAction(a, c) { if (_EmbedMenu) _EmbedMenu.handleIncludeAction(a, c); }
  function handleBoardFileLinkAction(a, c) { if (_EmbedMenu) _EmbedMenu.handleBoardFileLinkAction(a, c); }
  function handleDiagramAction(a, c) { if (_EmbedMenu) _EmbedMenu.handleDiagramAction(a, c); }
  function handleWikiAction(a, c) { if (_EmbedMenu) _EmbedMenu.handleWikiAction(a, c); }

  function mutateEmbedSource(c, m) { return _EmbedMenu ? _EmbedMenu.mutateEmbedSource(c, m) : Promise.resolve(false); }
  function updateEmbedTarget(c, t) { return _EmbedMenu ? _EmbedMenu.updateEmbedTarget(c, t) : Promise.resolve(false); }
  function deleteEmbedFromSource(c) { return _EmbedMenu ? _EmbedMenu.deleteEmbedFromSource(c) : Promise.resolve(false); }
  function updateIncludeTarget(c, t) { return _EmbedMenu ? _EmbedMenu.updateIncludeTarget(c, t) : Promise.resolve(false); }
  function deleteIncludeFromSource(c) { return _EmbedMenu ? _EmbedMenu.deleteIncludeFromSource(c) : Promise.resolve(false); }
  function updateBoardFileLinkTarget(c, t) { return _EmbedMenu ? _EmbedMenu.updateBoardFileLinkTarget(c, t) : Promise.resolve(false); }

  function isExternalHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || ''));
  }
  function isKnownExternalEmbedUrl(u) { return _EmbedMenu ? _EmbedMenu.isKnownExternalEmbedUrl(u) : false; }
  function hasForcedExternalEmbedFlag(a) { return _EmbedMenu ? _EmbedMenu.hasForcedExternalEmbedFlag(a) : false; }
  function getCanonicalExternalEmbedFrameUrl(u) { return _EmbedMenu ? _EmbedMenu.getCanonicalExternalEmbedFrameUrl(u) : ''; }
  function getExternalEmbedConfig(u, a) { return _EmbedMenu ? _EmbedMenu.getExternalEmbedConfig(u, a) : null; }
  function shouldRenderExternalEmbed(u, a) { return _EmbedMenu ? _EmbedMenu.shouldRenderExternalEmbed(u, a) : false; }

  function sanitizeCssLength(v) { return _EmbedMenu ? _EmbedMenu.sanitizeCssLength(v) : ''; }
  function normalizeMarkdownAttrValue(v) { return _EmbedMenu ? _EmbedMenu.normalizeMarkdownAttrValue(v) : ''; }
  function parseMarkdownImageAttributes(a) { return _EmbedMenu ? _EmbedMenu.parseMarkdownImageAttributes(a) : { raw: '', values: {}, classes: [] }; }
  function parseMarkdownTarget(r) { return _EmbedMenu ? _EmbedMenu.parseMarkdownTarget(r) : { path: '', title: '' }; }
  function getMarkdownMediaStyleAttr(a, o) { return _EmbedMenu ? _EmbedMenu.getMarkdownMediaStyleAttr(a, o) : ''; }
  function buildMarkdownEmbed(a, p, t, at) { return _EmbedMenu ? _EmbedMenu.buildMarkdownEmbed(a, p, t, at) : ''; }
  function replaceNthMarkdownEmbed(c, i, r) { return _EmbedMenu ? _EmbedMenu.replaceNthMarkdownEmbed(c, i, r) : c; }
  function replaceNthMarkdownLink(c, i, r) { return _EmbedMenu ? _EmbedMenu.replaceNthMarkdownLink(c, i, r) : c; }
  function normalizeCardContentAfterInlineMutation(c) { return _EmbedMenu ? _EmbedMenu.normalizeCardContentAfterInlineMutation(c) : c; }
  function resolveMarkdownRelativeTargets(c, f) { return _EmbedMenu ? _EmbedMenu.resolveMarkdownRelativeTargets(c, f) : c; }
  function getIncludeResolvedContent(c, i) { return _EmbedMenu ? _EmbedMenu.getIncludeResolvedContent(c, i) : c; }

  function renderInlineFileEmbedHtml(f, b, a, t, e, i) { return _EmbedMenu ? _EmbedMenu.renderInlineFileEmbedHtml(f, b, a, t, e, i) : ''; }
  function renderBoardFileLinkHtml(f, b, l, t, c, o) { return _EmbedMenu ? _EmbedMenu.renderBoardFileLinkHtml(f, b, l, t, c, o) : ''; }
  function renderIncludeDirectiveHtml(r, b, c, o) { return _EmbedMenu ? _EmbedMenu.renderIncludeDirectiveHtml(r, b, c, o) : ''; }
  function renderWikiLinkHtml(d, l, o) { return _EmbedMenu ? _EmbedMenu.renderWikiLinkHtml(d, l, o) : ''; }
  function renderTagChipHtml(tag) { return _EmbedMenu ? _EmbedMenu.renderTagChipHtml(tag) : ''; }
  function renderTemporalTagHtml(t) { return _EmbedMenu ? _EmbedMenu.renderTemporalTagHtml(t) : ''; }
  function renderEmbedPreviewContent(k, b, f, c) { return _EmbedMenu ? _EmbedMenu.renderEmbedPreviewContent(k, b, f, c) : ''; }

  function findCardRefById(id) { return _EmbedMenu ? _EmbedMenu.findCardRefById(id) : null; }
  function adjustPathForIncludeContext(c, p) { return _EmbedMenu ? _EmbedMenu.adjustPathForIncludeContext(c, p) : p; }

  function isExternalEmbedContainer(c) { return _EmbedMenu ? _EmbedMenu.isExternalEmbedContainer(c) : false; }
  function isIncludeDirectiveContainer(c) { return _EmbedMenu ? _EmbedMenu.isIncludeDirectiveContainer(c) : false; }
  function getEmbedActionTarget(c) { return _EmbedMenu ? _EmbedMenu.getEmbedActionTarget(c) : ''; }
  function getEmbedSearchQuery(c, f) { return _EmbedMenu ? _EmbedMenu.getEmbedSearchQuery(c, f) : ''; }
  function formatFileSize(b) { return _EmbedMenu ? _EmbedMenu.formatFileSize(b) : ''; }

  function copyTextToClipboard(t, s, f) { return _EmbedMenu ? _EmbedMenu.copyTextToClipboard(t, s, f) : Promise.resolve(false); }
  function copyElementAsMarkdown(t, i) { if (_EmbedMenu) _EmbedMenu.copyElementAsMarkdown(t, i); }
  function exportColumn(i) { return _EmbedMenu ? _EmbedMenu.exportColumn(i) : Promise.resolve(); }

  function uploadFileAndBuildMarkdown(f) { return _EmbedMenu ? _EmbedMenu.uploadFileAndBuildMarkdown(f) : Promise.resolve(''); }
  function resolveDropContent(d) { return _EmbedMenu ? _EmbedMenu.resolveDropContent(d) : Promise.resolve(''); }
  function handleEditorPasteImage(e, t) { return _EmbedMenu ? _EmbedMenu.handleEditorPasteImage(e, t) : Promise.resolve(false); }
  function handleFileDrop(f, t) { return _EmbedMenu ? _EmbedMenu.handleFileDrop(f, t) : Promise.resolve(); }

  // Tauri IPC bridge
  function resolveTauriInternals() { return _EmbedMenu ? _EmbedMenu.resolveTauriInternals() : null; }
  var tauriIpc = resolveTauriInternals();
  var hasTauri = !!tauriIpc;
  function tauriInvoke(cmd, args) { return _EmbedMenu ? _EmbedMenu.tauriInvoke(cmd, args) : Promise.reject(new Error('not available')); }
  function tauriListen(ev, cb) { if (_EmbedMenu) _EmbedMenu.tauriListen(ev, cb); }

  // Native/HTML context menu
  function showNativeMenu(items, x, y, t) { return _EmbedMenu ? _EmbedMenu.showNativeMenu(items, x, y, t) : Promise.resolve(null); }
  function showHtmlMenu(items, x, y) { return _EmbedMenu ? _EmbedMenu.showHtmlMenu(items, x, y) : Promise.resolve(null); }
  function closeHtmlMenu() { if (_EmbedMenu) _EmbedMenu.closeHtmlMenu(); }

  // System interaction
  function openInSystem(path) {
    lexeraLog('info', 'Opening in system: ' + path);
    if (hasTauri) {
      tauriInvoke('open_in_system', { path: path }).then(function () {
        lexeraLog('info', 'Opened: ' + path);
      }).catch(function (e) {
        lexeraLog('error', 'open_in_system failed: ' + e);
        showNotification('Failed to open file');
      });
    } else {
      window.open('file://' + path, '_blank');
    }
  }

  function openUrlInSystem(url) {
    if (!url) return;
    if (hasTauri) {
      tauriInvoke('open_url', { url: url }).catch(function (err) {
        logFrontendIssue('warn', 'open.url', 'Tauri URL open failed, falling back to browser open for ' + url, err);
        window.open(url, '_blank', 'noopener,noreferrer');
      });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function showInFinder(path) {
    if (hasTauri) {
      tauriInvoke('show_in_folder', { path: path }).then(function (result) {
        lexeraLog('info', 'Revealed in Finder: ' + result);
      }).catch(function (e) {
        lexeraLog('error', 'Show in Finder failed: ' + e);
        showNotification('Failed to reveal in folder');
      });
    }
  }

  function resolveBoardPath(boardId, filePath, toMode) {
    return LexeraApi.request('/boards/' + boardId + '/convert-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: '', path: filePath, to: toMode }),
    }).then(function (res) {
      return res && res.path ? res.path : filePath;
    }).catch(function (err) {
      logFrontendIssue(
        'warn',
        'path.resolve',
        'Failed to resolve ' + toMode + ' path for board ' + boardId + ' path ' + filePath,
        err
      );
      return filePath;
    });
  }

  function openBoardFileInSystem(boardId, filePath) {
    if (!filePath) return;
    var fileRef = parseLocalFileReference(filePath);
    if (isAbsoluteFilePath(fileRef.path) || !boardId) {
      openInSystem(fileRef.path);
      return;
    }
    resolveBoardPath(boardId, fileRef.path, 'absolute').then(function (absPath) {
      openInSystem(absPath);
    });
  }

  // Path utilities delegated to module
  function isAbsoluteFilePath(v) { return _EmbedMenu ? _EmbedMenu.isAbsoluteFilePath(v) : PathUtils.isAbsoluteFilePath(v); }
  function isBoardRelativePath(v) { return _EmbedMenu ? _EmbedMenu.isBoardRelativePath(v) : PathUtils.isBoardRelativePath(v); }
  function joinBoardRelativePath(b, r) { return _EmbedMenu ? _EmbedMenu.joinBoardRelativePath(b, r) : PathUtils.joinBoardRelativePath(b, r); }
  function computeRelativePath(f, t) { return _EmbedMenu ? _EmbedMenu.computeRelativePath(f, t) : PathUtils.computeRelativePath(f, t); }
  function buildDiagramCacheDir(b, s, c) { return _EmbedMenu ? _EmbedMenu.buildDiagramCacheDir(b, s, c) : ''; }
  function buildDiagramCacheFileName(s, m, e, su) { return _EmbedMenu ? _EmbedMenu.buildDiagramCacheFileName(s, m, e, su) : ''; }
  function buildPlantUmlCachePath(b, c) { return _EmbedMenu ? _EmbedMenu.buildPlantUmlCachePath(b, c) : ''; }

  var KNOWN_EXTERNAL_EMBED_PATTERNS = _EmbedMenu ? _EmbedMenu.KNOWN_EXTERNAL_EMBED_PATTERNS : [];
  var IMAGE_EMBED_EXTENSIONS = _EmbedMenu ? _EmbedMenu.IMAGE_EMBED_EXTENSIONS : /\.(png|jpg|jpeg|gif|webp|avif|svg)$/i;

  // --- Media Category ---

  function getMediaCategory(ext) {
    if (!ext) return 'unknown';
    ext = ext.toLowerCase();
    var cats = {
      image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif'],
      video: ['mp4', 'webm', 'mov', 'avi', 'mkv'],
      audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
      document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'txt', 'md', 'csv', 'json', 'epub'],
    };
    for (var cat in cats) {
      if (cats[cat].indexOf(ext) !== -1) return cat;
    }
    return 'unknown';
  }

  function inferExternalMediaCategoryFromUrl(url) {
    if (!isExternalHttpUrl(url)) return '';
    try {
      var parsed = new URL(String(url || ''));
      var host = (parsed.hostname || '').toLowerCase();
      if (
        /(^|\.)googleusercontent\.com$/.test(host) ||
        /(^|\.)ggpht\.com$/.test(host) ||
        /(^|\.)ytimg\.com$/.test(host)
      ) {
        return 'image';
      }
      var formatHint = (
        parsed.searchParams.get('format') ||
        parsed.searchParams.get('fm') ||
        parsed.searchParams.get('mime')
      );
      var hintedExt = getFileExtension(formatHint || '');
      if (hintedExt) return getMediaCategory(hintedExt);
    } catch (err) {
      return '';
    }
    return '';
  }

  function getFileExtension(path) {
    var value = normalizeFilePathForDetection(path);
    if (!value) return '';
    var fileName = getFileNameFromPath(value);
    var dot = fileName.lastIndexOf('.');
    if (dot <= 0 || dot === fileName.length - 1) return '';
    return fileName.substring(dot + 1).toLowerCase();
  }

  var INLINE_FILE_EMBED_EXTENSIONS = {
    md: true,
    markdown: true,
    txt: true,
    log: true,
    csv: true,
    tsv: true,
    json: true,
    yaml: true,
    yml: true,
    toml: true,
    ini: true,
    cfg: true,
    conf: true,
    xml: true,
    html: true,
    htm: true
  };

  function getInlineFileEmbedExtension(path) {
    var ext = getFileExtension(path);
    return INLINE_FILE_EMBED_EXTENSIONS[ext] ? ext : '';
  }

  // --- Card Collapse ---

  function collectBoardCardIds(rows) {
    var ids = [];
    if (!Array.isArray(rows)) return ids;
    for (var r = 0; r < rows.length; r++) {
      var stacks = Array.isArray(rows[r].stacks) ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        var cols = Array.isArray(stacks[s].columns) ? stacks[s].columns : [];
        for (var c = 0; c < cols.length; c++) {
          var cards = Array.isArray(cols[c].cards) ? cols[c].cards : [];
          for (var i = 0; i < cards.length; i++) {
            ids.push(String(cards[i].id));
          }
        }
      }
    }
    return ids;
  }

  function getCollapsedCards(boardId, rows) {
    var collapsedKey = 'lexera-card-collapsed:' + boardId;
    var legacyExpandedKey = 'lexera-card-expanded:' + boardId;
    var saved = localStorage.getItem(collapsedKey);
    if (saved) {
      try {
        var parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(function (id) { return String(id); });
      } catch (e) {
        logFrontendIssue('warn', 'cards.collapse', 'Failed to parse collapsed card state for board ' + boardId, e);
      }
    }

    // Legacy migration: old state stored expanded IDs. Convert to collapsed IDs.
    var legacy = localStorage.getItem(legacyExpandedKey);
    if (legacy) {
      try {
        var expanded = JSON.parse(legacy);
        if (Array.isArray(expanded)) {
          var expandedSet = {};
          for (var i = 0; i < expanded.length; i++) {
            expandedSet[String(expanded[i])] = true;
          }
          var allIds = collectBoardCardIds(rows);
          var migratedCollapsed = [];
          for (var j = 0; j < allIds.length; j++) {
            if (!expandedSet[allIds[j]]) migratedCollapsed.push(allIds[j]);
          }
          localStorage.setItem(collapsedKey, JSON.stringify(migratedCollapsed));
          localStorage.removeItem(legacyExpandedKey);
          return migratedCollapsed;
        }
      } catch (e) {
        logFrontendIssue('warn', 'cards.collapse', 'Failed to migrate legacy expanded card state for board ' + boardId, e);
      }
      localStorage.removeItem(legacyExpandedKey);
    }

    // Default behavior: cards are open unless explicitly collapsed.
    return [];
  }

  function saveCardCollapseState(boardId) {
    var collapsed = [];
    var cards = getElColumnsContainer().querySelectorAll('.card[data-card-id]');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].classList.contains('collapsed')) {
        collapsed.push(cards[i].getAttribute('data-card-id'));
      }
    }
    localStorage.setItem('lexera-card-collapsed:' + boardId, JSON.stringify(collapsed));
    // Remove legacy key so new default-open semantics apply consistently.
    localStorage.removeItem('lexera-card-expanded:' + boardId);
  }

  // --- Embed Enhancer --- (delegated to EmbedEnhancer module)
  if (window.EmbedEnhancer) EmbedEnhancer.init({
    LexeraApi: LexeraApi,
    ContentEnhancerRegistry: ContentEnhancerRegistry,
    getActiveBoardId: function () { return activeBoardId; },
    getCurrentTagVisibilityMode: function () { return currentTagVisibilityMode; },
    getCurrentHtmlCommentRenderMode: function () { return currentHtmlCommentRenderMode; },
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    decodeHtmlEntities: decodeHtmlEntities,
    sanitizeCssLength: sanitizeCssLength,
    parseLocalFileReference: parseLocalFileReference,
    isBoardRelativePath: isBoardRelativePath,
    getInlineFileEmbedExtension: getInlineFileEmbedExtension,
    getEmbedPreviewKind: getEmbedPreviewKind,
    getEmbedPreviewCacheKey: getEmbedPreviewCacheKey,
    getDisplayFileNameFromPath: getDisplayFileNameFromPath,
    isRenderedSpecialPreviewKind: isRenderedSpecialPreviewKind,
    renderCachedSpecialPreview: renderCachedSpecialPreview,
    buildFilePreviewPlaceholderHtml: buildFilePreviewPlaceholderHtml,
    buildSpecialPreviewPlaceholderMessage: buildSpecialPreviewPlaceholderMessage,
    resolveMarkdownRelativeTargets: resolveMarkdownRelativeTargets,
    renderCardContent: renderCardContent,
    applyRenderedHtmlCommentVisibility: applyRenderedHtmlCommentVisibility,
    applyRenderedTagVisibility: applyRenderedTagVisibility,
    applyFileLinkInfo: function () {
      return _EmbedMenu && typeof _EmbedMenu.applyFileLinkInfo === 'function'
        ? _EmbedMenu.applyFileLinkInfo.apply(_EmbedMenu, arguments)
        : undefined;
    },
    requestFileInfo: requestFileInfo,
    flushPendingDiagramQueues: flushPendingDiagramQueues
  });

  // --- Tag Colors --- (delegated to LexeraTagColors module)
  var TagColors = window.LexeraTagColors;
  if (TagColors) TagColors.init({ escapeHtml: escapeHtml, escapeAttr: escapeAttr });
  var TAG_COLORS = TagColors ? TagColors.TAG_COLORS : {};
  var TAG_PALETTE = TagColors ? TagColors.TAG_PALETTE : [];
  var TAG_CATEGORIES = TagColors ? TagColors.TAG_CATEGORIES : {};
  var TAG_STYLE_ROLE_BY_CATEGORY = TagColors ? TagColors.TAG_STYLE_ROLE_BY_CATEGORY : {};
  var TAG_STYLE_PRESETS = TagColors ? TagColors.TAG_STYLE_PRESETS : {};
  function loadTagStyleConfig() { return TagColors ? TagColors.loadTagStyleConfig() : undefined; }
  function getActiveTagStylePreset() { return TagColors ? TagColors.getActiveTagStylePresetId() : 'default'; }
  function setActiveTagStylePreset(id) { if (TagColors) TagColors.setActiveTagStylePreset(id); }
  function getTagStyleOverride(t) { return TagColors ? TagColors.getTagStyleOverride(t) : null; }
  function setUserTagStyleOverride(t, o) { if (TagColors) TagColors.setUserTagStyleOverride(t, o); }
  function getResolvedCategoryRole(c) { return TagColors ? TagColors.getResolvedCategoryRole(c) : ''; }
  function setUserCategoryRoleOverride(c, r) { if (TagColors) TagColors.setUserCategoryRoleOverride(c, r); }
  function setUserCategoryRole(c, r) { if (TagColors) TagColors.setUserCategoryRoleOverride(c, r); }

  // ── Visual Themes ───────────────────────────────────────────────────
  // CSS does all the work via [data-visual-theme]. JS only toggles the active theme.

  var EMOJI_SHORTCODES = {
    smile: '\u{1F604}',
    grin: '\u{1F601}',
    joy: '\u{1F602}',
    wink: '\u{1F609}',
    blush: '\u{1F60A}',
    thinking: '\u{1F914}',
    sunglasses: '\u{1F60E}',
    cry: '\u{1F622}',
    heart: '\u{2764}\u{FE0F}',
    broken_heart: '\u{1F494}',
    thumbs_up: '\u{1F44D}',
    thumbs_down: '\u{1F44E}',
    clap: '\u{1F44F}',
    tada: '\u{1F389}',
    fire: '\u{1F525}',
    rocket: '\u{1F680}',
    sparkles: '\u{2728}',
    star: '\u{2B50}',
    warning: '\u{26A0}\u{FE0F}',
    bulb: '\u{1F4A1}',
    bug: '\u{1F41B}',
    eyes: '\u{1F440}',
    pushpin: '\u{1F4CC}',
    memo: '\u{1F4DD}',
    calendar: '\u{1F4C5}',
    question: '\u{2753}',
    x: '\u{274C}',
    white_check_mark: '\u{2705}',
    heavy_check_mark: '\u{2714}\u{FE0F}',
    hourglass: '\u{23F3}'
  };

  function getTagColor(tag) { return TagColors ? TagColors.getTagColor(tag) : '#888'; }
  function normalizeTagCategoryName(t) { return TagColors ? TagColors.normalizeTagCategoryName(t) : ''; }
  function getTagCategoryKey(t) { return TagColors ? TagColors.getTagCategoryKey(t) : ''; }
  function formatTagDisplayLabel(t) { return TagColors ? TagColors.formatTagDisplayLabel(t) : ''; }
  function parseColorChannels(c) { return TagColors ? TagColors.parseColorChannels(c) : null; }
  function getContrastingTextColor(c) { return TagColors ? TagColors.getContrastingTextColor(c) : '#fff'; }

  function buildTagStyleDescriptor(t, c) { return TagColors ? TagColors.buildTagStyleDescriptor(t, c) : null; }
  function buildCombinedTagStyleDescriptor(t) { return TagColors ? TagColors.buildCombinedTagStyleDescriptor(t) : null; }
  function buildTagStyleRenderState(t) { return TagColors ? TagColors.buildTagStyleRenderState(t) : null; }
  function resolveBackgroundSurfaceColors(b, c) { return TagColors ? TagColors.resolveBackgroundSurfaceColors(b, c) : {}; }
  function buildTagStyleInlineCssText(d) { return TagColors ? TagColors.buildTagStyleInlineCssText(d) : ''; }
  function buildTagStyledLineHtml(t, h, s, o) { return TagColors ? TagColors.buildTagStyledLineHtml(t, h, s, o) : ''; }
  function wrapRenderedLineBlockHtml(b, s) { return TagColors ? TagColors.wrapRenderedLineBlockHtml(b, s) : b; }
  function applyTagBorderSpecialRules(d, t) { if (TagColors) TagColors.applyTagBorderSpecialRules(d, t); }

  function renderEmojiShortcodes(text) {
    return String(text || '').replace(/(^|[^\w&]):([a-z][a-z0-9_+-]*):(?=$|[^\w;])/gi, function (_, prefix, code) {
      var emoji = EMOJI_SHORTCODES[String(code || '').toLowerCase()];
      if (!emoji) return _;
      return prefix + '<span class="emoji-shortcode" aria-label="' + escapeAttr(code) + '">' + emoji + '</span>';
    });
  }

  function isTagTokenBoundaryChar(ch) {
    return LexeraTagSystem.isTagTokenBoundaryChar(ch);
  }

  function normalizeTagTokenForMatch(token) {
    return LexeraTagSystem.normalizeTagTokenForMatch(token);
  }

  function isTagExpressionBoundaryChar(ch) {
    return LexeraTagSystem.isTagTokenBoundaryChar(ch) || ch === '(' || ch === ')';
  }

  function collectHeaderTagTokens(text, options) {
    return LexeraTagSystem.collectHeaderTagTokens(text, options);
  }

  function tokenizeTagExpression(expression) {
    return LexeraTagSystem.tokenizeTagExpression(expression);
  }

  function evaluateTagExpression(expression, tagLookup) {
    return LexeraTagSystem.evaluateTagExpression(expression, tagLookup);
  }

  function isTagExpression(tagName) {
    return LexeraTagSystem.isTagExpression(tagName);
  }

  function extractAllTags(text) {
    return LexeraTagSystem.extractAllTags(text);
  }

  function hasTag(text, tagName) {
    return LexeraTagSystem.hasTag(text, tagName);
  }

  function isNumericIndexTag(tagName) {
    return LexeraTagSystem.isNumericIndexTag(tagName);
  }

  function isTagStyleEligible(tagName) {
    return LexeraTagSystem.isTagStyleEligible(tagName);
  }

  function toTagAccentRgba(c, a) { return TagColors ? TagColors.toTagAccentRgba(c, a) : String(c || '').trim(); }
  function resolveTagSurfaceColor(c, a) { return TagColors ? TagColors.resolveTagSurfaceColor(c, a) : String(c || ''); }

  function getFirstStyleTag(text) {
    var tags = extractAllTags(text);
    for (var i = 0; i < tags.length; i++) {
      if (isTagStyleEligible(tags[i])) return tags[i];
    }
    return '';
  }

  function getCardContainerStyleSource(content) {
    var lines = String(content || '').split('\n');
    return lines.length > 0 ? lines[0] : '';
  }

  function getTagStyleEntityType(containerEl) {
    if (!containerEl || !containerEl.classList) return '';
    if (containerEl.classList.contains('board-header')) return 'board';
    if (containerEl.classList.contains('board-row')) return 'row';
    if (containerEl.classList.contains('board-stack')) return 'stack';
    if (containerEl.classList.contains('column')) return 'column';
    if (containerEl.classList.contains('card')) return 'card';
    return '';
  }

  function getTagStyleHeaderElement(containerEl, entityType) {
    if (!containerEl) return null;
    if (entityType === 'board') return containerEl;
    if (entityType === 'row') return containerEl.querySelector(':scope > .board-row-header');
    if (entityType === 'stack') return containerEl.querySelector(':scope > .board-stack-header');
    if (entityType === 'column') return containerEl.querySelector(':scope > .column-header');
    if (entityType === 'card') return containerEl.querySelector(':scope > .card-header');
    return null;
  }

  function getTagStyleFooterElement(containerEl, entityType, allowCreate) {
    if (!containerEl) return null;
    if (entityType === 'row') return containerEl.querySelector(':scope > .board-row-footer');
    if (entityType === 'stack') return containerEl.querySelector(':scope > .board-stack-footer');
    if (entityType === 'column') return containerEl.querySelector(':scope > .column-footer');
    if (entityType !== 'card') return null;
    var footer = containerEl.querySelector(':scope > .card-footer.tag-style-generated');
    if (!footer && allowCreate) {
      footer = document.createElement('div');
      footer.className = 'card-footer tag-style-generated';
      containerEl.appendChild(footer);
    }
    return footer;
  }

  function clearTagStyleGeneratedNodes(containerEl) {
    if (!containerEl) return;
    var generated = containerEl.querySelectorAll('.tag-style-generated');
    for (var i = 0; i < generated.length; i++) {
      if (generated[i] && generated[i].parentNode) generated[i].parentNode.removeChild(generated[i]);
    }
  }

  function applyTagStyleToEntity(containerEl, styleSourceText) {
    if (!containerEl || !containerEl.style) return;
    var entityType = getTagStyleEntityType(containerEl);
    var headerEl = getTagStyleHeaderElement(containerEl, entityType);
    var footerEl = getTagStyleFooterElement(containerEl, entityType, false);
    clearTagStyleGeneratedNodes(containerEl);

    var removableProps = [
      '--tag-accent', '--tag-accent-soft', '--tag-accent-soft-strong', '--tag-accent-muted',
      '--tag-label-bg', '--tag-label-fg', '--tag-footer-label-bg', '--tag-footer-label-fg',
      '--tag-border-color', '--tag-border-width', '--tag-border-style',
      '--tag-surface-bg', '--tag-surface-header-bg', '--tag-surface-footer-bg', '--tag-surface-content-bg',
      '--tag-effect-opacity', '--tag-effect-filter'
    ];
    for (var rp = 0; rp < removableProps.length; rp++) {
      containerEl.style.removeProperty(removableProps[rp]);
    }
    containerEl.classList.remove('tag-styled', 'tag-style-pattern-stripes', 'tag-style-pattern-stripes-h');
    containerEl.removeAttribute('data-tag-border-position');

    if (headerEl) headerEl.removeAttribute('data-tag-style-label');
    if (footerEl) footerEl.removeAttribute('data-tag-style-label');

    var styleState = buildTagStyleRenderState(styleSourceText);
    if (!styleState || !styleState.descriptor) {
      if (entityType === 'card' && footerEl && footerEl.parentNode) footerEl.parentNode.removeChild(footerEl);
      return;
    }

    var descriptor = styleState.descriptor;
    var color = styleState.color || getTagColor('#tag');
    containerEl.classList.add('tag-styled');
    containerEl.style.setProperty('--tag-accent', color);
    containerEl.style.setProperty('--tag-accent-soft', descriptor.accentSoft || toTagAccentRgba(color, 0.14));
    containerEl.style.setProperty('--tag-accent-soft-strong', descriptor.accentSoftStrong || toTagAccentRgba(color, 0.24));
    containerEl.style.setProperty('--tag-accent-muted', descriptor.accentMuted || toTagAccentRgba(color, 0.42));

    if (descriptor.border) {
      containerEl.style.setProperty('--tag-border-color', descriptor.border.color || color);
      containerEl.style.setProperty('--tag-border-width', descriptor.border.width || '2px');
      containerEl.style.setProperty('--tag-border-style', descriptor.border.style || 'solid');
      containerEl.setAttribute('data-tag-border-position', descriptor.border.position || 'left');
    }

    if (descriptor.background) {
      var surfaces = resolveBackgroundSurfaceColors(descriptor.background, color);
      containerEl.style.setProperty('--tag-surface-bg', resolveTagSurfaceColor(surfaces.bg.color, surfaces.bg.alpha));
      containerEl.style.setProperty('--tag-surface-header-bg', resolveTagSurfaceColor(surfaces.header.color, surfaces.header.alpha));
      containerEl.style.setProperty('--tag-surface-footer-bg', resolveTagSurfaceColor(surfaces.footer.color, surfaces.footer.alpha));
      containerEl.style.setProperty('--tag-surface-content-bg', resolveTagSurfaceColor(surfaces.content.color, surfaces.content.alpha));
    }

    if (descriptor.opacity) containerEl.style.setProperty('--tag-effect-opacity', descriptor.opacity);
    if (descriptor.filter) containerEl.style.setProperty('--tag-effect-filter', descriptor.filter);
    if (descriptor.pattern === 'stripes') containerEl.classList.add('tag-style-pattern-stripes');
    if (descriptor.pattern === 'stripes-h') containerEl.classList.add('tag-style-pattern-stripes-h');
    if (entityType === 'card' && footerEl && footerEl.parentNode) footerEl.parentNode.removeChild(footerEl);
  }

  function countCheckboxes(content) {
    var total = 0;
    var checked = 0;
    var lines = (content || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var match = lines[i].match(/^[ \t]*-\s+\[([ xX])\]/);
      if (match) {
        total++;
        if (match[1] !== ' ') checked++;
      }
    }
    return { total: total, checked: checked };
  }

  function getCardTitle(content) {
    var lines = content.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var trimmed = stripInternalHiddenTags(lines[i].replace(/<!--[\s\S]*?-->/g, '')).trim();
      if (trimmed === '') break;
      if (/^!\[/.test(trimmed)) continue; // skip image-only lines
      var headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
      if (headingMatch) return headingMatch[1].trim();
      return trimmed;
    }
    for (var i = 0; i < lines.length; i++) {
      var fallback = stripInternalHiddenTags(lines[i].replace(/<!--[\s\S]*?-->/g, '')).trim();
      if (fallback !== '') return fallback;
    }
    return '';
  }

  function stashRenderedHtmlToken(htmlTokens, html) {
    var token = '@@HTMLTOKEN' + htmlTokens.length + '@@';
    htmlTokens.push(String(html || ''));
    return token;
  }

  function restoreRenderedHtmlTokens(text, htmlTokens) {
    var restored = String(text || '');
    for (var i = 0; i < htmlTokens.length; i++) {
      restored = restored.replace('@@HTMLTOKEN' + i + '@@', htmlTokens[i]);
    }
    return restored;
  }

  function extractAngleBracketAutolinks(text) {
    var links = [];
    var rewritten = String(text || '').replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/gi, function (_, href) {
      var token = '@@AUTOLINKTOKEN' + links.length + '@@';
      links.push(String(href || '').trim());
      return token;
    });
    return {
      text: rewritten,
      links: links
    };
  }

  function buildAngleBracketAutolinkHtml(href) {
    var normalizedHref = String(href || '').trim();
    if (!normalizedHref) return '';
    var safeHref = escapeAttr(normalizedHref);
    var isExternal = /^https?:\/\//i.test(normalizedHref);
    var targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
    return '<a href="' + safeHref + '"' + targetAttr + '>' + escapeHtml(normalizedHref) + '</a>';
  }

  var InlineRendererFactory = window.LexeraInlineRenderer || null;
  var _inlineRendererHelpers = null;

  function getInlineRendererHelpers() {
    if (_inlineRendererHelpers) return _inlineRendererHelpers;
    if (!InlineRendererFactory || typeof InlineRendererFactory.createInlineRenderers !== 'function') return null;
    _inlineRendererHelpers = InlineRendererFactory.createInlineRenderers({
      getActiveBoardId: function () { return activeBoardId || ''; },
      extractAngleBracketAutolinks: extractAngleBracketAutolinks,
      stripHtmlComments: stripHtmlComments,
      escapeHtml: escapeHtml,
      stashRenderedHtmlToken: stashRenderedHtmlToken,
      restoreRenderedHtmlTokens: restoreRenderedHtmlTokens,
      renderIncludeDirectiveHtml: renderIncludeDirectiveHtml,
      parseMarkdownTarget: parseMarkdownTarget,
      escapeAttr: escapeAttr,
      renderBoardFileLinkHtml: renderBoardFileLinkHtml,
      buildAngleBracketAutolinkHtml: buildAngleBracketAutolinkHtml,
      decodeHtmlEntities: decodeHtmlEntities,
      renderWikiLinkHtml: renderWikiLinkHtml,
      renderTagChipHtml: renderTagChipHtml,
      renderTemporalTagHtml: renderTemporalTagHtml,
      renderEmojiShortcodes: renderEmojiShortcodes,
      getHtmlContentRenderMode: getHtmlContentRenderMode,
      parseLocalFileReference: parseLocalFileReference,
      normalizeMarkdownAttrValue: normalizeMarkdownAttrValue,
      parseMarkdownImageAttributes: parseMarkdownImageAttributes,
      getFileExtension: getFileExtension,
      isExternalHttpUrl: isExternalHttpUrl,
      getExternalEmbedConfig: getExternalEmbedConfig,
      getInlineFileEmbedExtension: getInlineFileEmbedExtension,
      getMediaCategory: getMediaCategory,
      inferExternalMediaCategoryFromUrl: inferExternalMediaCategoryFromUrl,
      LexeraApi: LexeraApi,
      getMarkdownMediaStyleAttr: getMarkdownMediaStyleAttr,
      getEmbedPreviewKind: getEmbedPreviewKind,
      renderInlineFileEmbedHtml: renderInlineFileEmbedHtml,
      getFileEmbedChipHtml: getFileEmbedChipHtml,
      getDisplayFileNameFromPath: getDisplayFileNameFromPath,
      isRenderedSpecialPreviewKind: isRenderedSpecialPreviewKind,
      applyAbbreviationsToHtml: applyAbbreviationsToHtml,
      sanitizeCssLength: sanitizeCssLength
    });
    return _inlineRendererHelpers;
  }

  function renderTitleInline(text, boardId, options) {
    if (CardContentRenderer) return CardContentRenderer.renderTitleInline(text, boardId, options);
    var helpers = getInlineRendererHelpers();
    if (!helpers || typeof helpers.renderTitleInline !== 'function') {
      return escapeHtml(String(text || ''));
    }
    return helpers.renderTitleInline(text, boardId, options);
  }

  // --- Util ---

  function renderTable(lines, startIdx, boardId, renderState) {
    if (CardContentRenderer) return CardContentRenderer.renderTable(lines, startIdx, boardId, renderState);
    return '';
  }

  function flushPendingDiagramQueues() {
    if (DiagramRegistry) DiagramRegistry.flush();
  }

  if (DiagramRegistry) {
    DiagramRegistry.register({
      id: 'mermaid',
      languages: ['mermaid'],
      _ready: false,
      _loading: false,
      isReady: function () { return this._ready; },
      init: function () {
        var self = this;
        if (self._ready) return Promise.resolve();
        if (self._loading) return new Promise(function (resolve) {
          var check = setInterval(function () { if (self._ready) { clearInterval(check); resolve(); } }, 50);
        });
        self._loading = true;
        return new Promise(function (resolve, reject) {
          var script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
          script.onload = function () {
            mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose', fontFamily: 'inherit' });
            self._ready = true;
            self._loading = false;
            resolve();
          };
          script.onerror = function () {
            self._loading = false;
            reject(new Error('Failed to load Mermaid library'));
          };
          document.head.appendChild(script);
        });
      },
      render: function (id, code) {
        return mermaid.render(id + '-svg', code).then(function (result) { return result.svg; });
      },
      placeholder: function (id) {
        return '<div class="mermaid-placeholder" id="' + id + '">Loading diagram...</div>';
      },
      menuItems: function () {
        return [
          { id: 'copy-svg', label: 'Copy SVG' },
          { id: 'copy-code', label: 'Copy Mermaid Code' },
        ];
      },
      handleMenuAction: function (action, container) {
        handleDiagramAction(action, container);
      }
    });

    DiagramRegistry.register({
      id: 'plantuml',
      languages: ['plantuml', 'puml'],
      _ready: true,
      isReady: function () { return true; },
      init: function () { return Promise.resolve(); },
      render: function (id, code, boardId) {
        return requestRenderedPlantUmlSvg(boardId, code);
      },
      placeholder: function (id, code) {
        return '<div class="plantuml-placeholder" id="' + id + '"><div class="plantuml-title">PlantUML</div><pre class="code-block"><code class="language-plantuml">' + escapeHtml(code) + '</code></pre></div>';
      },
      menuItems: function () {
        return [
          { id: 'copy-svg', label: 'Copy SVG' },
          { id: 'copy-code', label: 'Copy PlantUML Code' },
        ];
      },
      handleMenuAction: function (action, container) {
        handleDiagramAction(action, container);
      }
    });
  }

  function escapeRegex(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyAbbreviationsToHtml(html, abbrDefs) {
    var keys = Object.keys(abbrDefs || {});
    if (!html || keys.length === 0) return html;
    keys.sort(function (a, b) { return b.length - a.length; });
    var parts = String(html).split(/(<[^>]+>)/g);
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i] || parts[i].charAt(0) === '<') continue;
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var pattern = new RegExp('(^|[^\\w])(' + escapeRegex(key) + ')(?=[^\\w]|$)', 'g');
        parts[i] = parts[i].replace(pattern, function (_, pre, match) {
          return pre + '<abbr title="' + escapeAttr(abbrDefs[key]) + '">' + match + '</abbr>';
        });
      }
    }
    return parts.join('');
  }

  // --- CardContentRenderer init (must be after getInlineRendererHelpers, buildTagStyledLineHtml, etc.) ---
  if (CardContentRenderer) CardContentRenderer.init({
    getInlineRendererHelpers: getInlineRendererHelpers,
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    buildTagStyledLineHtml: buildTagStyledLineHtml,
    wrapRenderedLineBlockHtml: wrapRenderedLineBlockHtml,
    DiagramRegistry: DiagramRegistry,
    getActiveBoardId: function () { return activeBoardId || ''; }
  });

  function renderCardContent(content, boardId, renderState, options) {
    if (CardContentRenderer) return CardContentRenderer.renderCardContent(content, boardId, renderState, options);
    return '';
  }

  function renderInline(text, boardId, renderState) {
    if (CardContentRenderer) return CardContentRenderer.renderInline(text, boardId, renderState);
    var helpers = getInlineRendererHelpers();
    if (!helpers || typeof helpers.renderInline !== 'function') {
      return escapeHtml(String(text || ''));
    }
    return helpers.renderInline(text, boardId, renderState);
  }

  function getTemporalTagType(tag) {
    var value = String(tag || '').trim();
    if (!value) return '';
    var body = value.charAt(0) === '!' || value.charAt(0) === '@' ? value.slice(1) : value;
    var lower = body.toLowerCase();
    if (/^(today|tomorrow|yesterday|date\([^)]+\)|days[+-]\d+)$/.test(lower)) return 'date';
    if (/^(?:\d{4})[-.]?(?:w|kw)\d{1,2}$/i.test(body) || /^(?:w|kw)\d{1,2}$/i.test(body)) return 'week';
    if (/^(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)$/i.test(body)) return 'weekday';
    if (/^:\d{1,2}-:\d{1,2}$/i.test(body)) return 'minuteSlot';
    if (/^\d{1,2}(?::\d{2})?(?:am|pm)?-\d{1,2}(?::\d{2})?(?:am|pm)?$/i.test(body)) return 'timeSlot';
    if (/^\d{1,2}(?::\d{2})?(?:am|pm)?$/i.test(body)) return 'time';
    if (/^\d{1,4}[./-]\d{1,2}(?:[./-]\d{2,4})?$/i.test(body)) return 'date';
    return '';
  }

  function describeTemporalTag(tag) {
    var type = getTemporalTagType(tag);
    if (!type) return null;
    return {
      type: type,
      resolved: resolveTemporalTag(tag)
    };
  }

  function resolveTemporalTag(tag) {
    var raw = String(tag || '').trim();
    var prefix = raw.charAt(0);
    var lower = raw.toLowerCase();
    var body = (prefix === '!' || prefix === '@') ? raw.slice(1) : raw;
    var lowerBody = body.toLowerCase();
    var now = new Date();
    now.setHours(0, 0, 0, 0);

    if (lowerBody === 'today') return formatDate(now);
    if (lowerBody === 'tomorrow') { now.setDate(now.getDate() + 1); return formatDate(now); }
    if (lowerBody === 'yesterday') { now.setDate(now.getDate() - 1); return formatDate(now); }

    var daysMatch = lowerBody.match(/^days([+-])(\d+)$/);
    if (daysMatch) {
      var offset = parseInt(daysMatch[2], 10) * (daysMatch[1] === '+' ? 1 : -1);
      now.setDate(now.getDate() + offset);
      return formatDate(now);
    }

    var dateMatch = body.match(/^date\((\d{4}-\d{2}-\d{2})\)$/i);
    if (dateMatch) return dateMatch[1];

    var weekdays = {
      sun: 0, sunday: 0,
      mon: 1, monday: 1,
      tue: 2, tuesday: 2,
      wed: 3, wednesday: 3,
      thu: 4, thursday: 4,
      fri: 5, friday: 5,
      sat: 6, saturday: 6
    };
    var dayName = lowerBody;
    if (weekdays[dayName] !== undefined) {
      var target = weekdays[dayName];
      var current = now.getDay();
      var diff = target - current;
      if (diff <= 0) diff += 7;
      now.setDate(now.getDate() + diff);
      return formatDate(now);
    }

    if (/^(?:\d{4})[-.]?(?:w|kw)(\d{1,2})$/i.test(body) || /^(?:w|kw)(\d{1,2})$/i.test(body)) {
      return 'Week ' + body.replace(/^(?:\d{4})[-.]?/i, '').toUpperCase();
    }

    if (/^:\d{1,2}-:\d{1,2}$/i.test(body) || /^\d{1,2}(?::\d{2})?(?:am|pm)?-\d{1,2}(?::\d{2})?(?:am|pm)?$/i.test(body)) {
      return body;
    }

    if (/^\d{1,2}(?::\d{2})?(?:am|pm)?$/i.test(body)) {
      return body;
    }

    if (/^\d{1,4}[./-]\d{1,2}(?:[./-]\d{2,4})?$/i.test(body)) {
      return body;
    }

    return tag;
  }

  function formatDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Virtual scrolling — delegated to LexeraVirtualScroll module
  function vsActivate() { if (VirtualScroll) VirtualScroll.activate(); }
  function vsTeardown() { if (VirtualScroll) VirtualScroll.teardown(); }
  function vsMaterialiseAll() { if (VirtualScroll) VirtualScroll.materialiseAll(); }
  function vsRestoreAfterDrag() { if (VirtualScroll) VirtualScroll.restoreAfterDrag(); }

  // ===== Action Registry Registrations =====
  if (ActionRegistry) {
    // ----- Board scope -----
    // Recent boards
    ActionRegistry.register('board', 'recent:*', function (action) { var id = action.substring(7); if (id) selectBoard(id); });

    // Window management
    ActionRegistry.register('board', 'new-window', function () {
      if (hasTauri) tauriInvoke('open_new_window', { boardId: null });
    });

    // Undo/redo
    ActionRegistry.register('board', 'undo', function () { undo(); });
    ActionRegistry.register('board', 'redo', function () { redo(); });

    // Board structure
    ActionRegistry.register('board', 'add-row', function () { addRow(); });
    ActionRegistry.register('board', 'add-stack', function () {
      if (activeBoardData && activeBoardData.rows && activeBoardData.rows.length > 0) addStackToRow(activeBoardData.rows.length - 1);
    });
    ActionRegistry.register('board', 'add-column', function () {
      if (activeBoardData && activeBoardData.rows && activeBoardData.rows.length > 0) {
        var lastRow = activeBoardData.rows[activeBoardData.rows.length - 1];
        if (lastRow.stacks && lastRow.stacks.length > 0) addColumnToStack(activeBoardData.rows.length - 1, lastRow.stacks.length - 1);
      }
    });
    ActionRegistry.register('board', 'add-card', function () {
      var columns = activeBoardData ? activeBoardData.columns : [];
      if (columns.length > 0) { addCardColumn = columns[0].index; renderColumns(); }
    });

    // Fold
    ActionRegistry.register('board', 'fold-all', function () { toggleFoldAll(); });
    ActionRegistry.register('board', 'unfold-all', function () { toggleFoldAll(); });
    ActionRegistry.register('board', 'fold-columns', function () { toggleFoldAllColumns(); });
    ActionRegistry.register('board', 'unfold-columns', function () { toggleFoldAllColumns(); });
    ActionRegistry.register('board', 'fold-cards', function () { toggleFoldAllCards(); });
    ActionRegistry.register('board', 'unfold-cards', function () { toggleFoldAllCards(); });
    ActionRegistry.register('board', 'toggle-fold-cards', function () { toggleFoldAllCards(); });
    ActionRegistry.register('board', 'toggle-fold-columns', function () { toggleFoldAllColumns(); });

    // Sorting
    ActionRegistry.register('board', 'sort-all-cards:*', function (action) {
      var sortMode = action.substring('sort-all-cards:'.length);
      var resolvedMode = sortMode === 'tag' ? 'tag' : sortMode === 'duedate' ? 'duedate' : 'title';
      sortAllCardsAcrossBoard(resolvedMode);
    });

    // ── Board Setting Descriptors ─────────────────────────────────────
    BoardSettingRegistry.register({
      id: 'columnWidth', label: 'Column Width', category: 'format',
      settingsKey: 'columnWidth', actionPrefix: 'set-column-width', defaultValue: '450px',
      normalize: normalizeColumnWidth,
      options: [
        { value: '250px', label: '250px' }, { value: '350px', label: '350px' },
        { value: '450px', label: '450px' }, { value: '550px', label: '550px' },
        { value: '650px', label: '650px' }, { separator: true },
        { value: '31.5vw', label: '1/3 Screen' }, { value: '48vw', label: '1/2 Screen' },
        { value: '63vw', label: '2/3 Screen' }, { value: '95vw', label: 'Full Width' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'cardHeight', label: 'Card Height', category: 'format',
      settingsKey: 'cardMinHeight', actionPrefix: 'set-card-height', defaultValue: 'auto',
      normalize: function (v) { return String(v || 'auto').trim().toLowerCase(); },
      options: [
        { value: 'auto', label: 'Auto' }, { separator: true },
        { value: '200px', label: 'Small' }, { value: '400px', label: 'Medium' },
        { value: '600px', label: 'Large' }, { separator: true },
        { value: '26.5vh', label: '1/3 Screen' }, { value: '43.5vh', label: '1/2 Screen' },
        { value: '59vh', label: '2/3 Screen' }, { value: '92vh', label: 'Full Screen' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'whitespace', label: 'Whitespace', category: 'format',
      settingsKey: 'whitespace', actionPrefix: 'set-whitespace', defaultValue: '8px',
      normalize: normalizeWhitespaceValue,
      options: [
        { value: '8px', label: 'Compact' }, { value: '16px', label: 'Relaxed' },
        { value: '32px', label: 'Spacious' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'fontSize', label: 'Font Size', category: 'format',
      settingsKey: 'fontSize', actionPrefix: 'set-font-size', defaultValue: '13px',
      normalize: normalizeBoardFontSizeValue,
      options: [
        { value: '6.5px', label: '0.5x' }, { value: '9.75px', label: '0.75x' },
        { value: '13px', label: '1x' }, { value: '16.25px', label: '1.25x' },
        { value: '19.5px', label: '1.5x' }, { value: '26px', label: '2x' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'fontFamily', label: 'Font Family', category: 'format',
      settingsKey: 'fontFamily', actionPrefix: 'set-font-family', defaultValue: 'system',
      normalize: normalizeBoardFontFamilyToken,
      resolve: resolveBoardFontFamilyValue,
      options: [
        { value: 'system', label: 'System Default' },
        { value: 'roboto', label: 'Roboto' }, { value: 'opensans', label: 'Open Sans' },
        { value: 'lato', label: 'Lato' }, { value: 'plusjakarta', label: 'Plus Jakarta Sans' },
        { value: 'inter', label: 'Inter' }, { value: 'poppins', label: 'Poppins' },
        { separator: true },
        { value: 'helvetica', label: 'Helvetica' }, { value: 'arial', label: 'Arial' },
        { value: 'georgia', label: 'Georgia' }, { value: 'times', label: 'Times New Roman' },
        { separator: true },
        { value: 'firacode', label: 'Fira Code' }, { value: 'jetbrains', label: 'JetBrains Mono' },
        { value: 'sourcecodepro', label: 'Source Code Pro' }, { value: 'consolas', label: 'Consolas' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'layoutRows', label: 'Layout Rows', category: 'format',
      settingsKey: 'layoutRows', actionPrefix: 'set-layout-rows', defaultValue: '1',
      normalize: function (v) {
        var n = parseInt(v, 10);
        if (!isFinite(n) || n < 1) n = 1; if (n > 6) n = 6;
        return String(n);
      },
      options: [
        { value: '1', label: '1 Row' }, { value: '2', label: '2 Rows' },
        { value: '3', label: '3 Rows' }, { value: '4', label: '4 Rows' },
        { value: '5', label: '5 Rows' }, { value: '6', label: '6 Rows' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'rowHeight', label: 'Row Height', category: 'format',
      settingsKey: 'rowHeight', actionPrefix: 'set-row-height', defaultValue: 'auto',
      normalize: function (v) { return String(v || 'auto').trim().toLowerCase(); },
      options: [
        { value: 'auto', label: 'Auto' }, { separator: true },
        { value: '300px', label: 'Small' }, { value: '500px', label: 'Medium' },
        { value: '700px', label: 'Large' }, { separator: true },
        { value: '31.5vh', label: '1/3 Screen' }, { value: '48vh', label: '1/2 Screen' },
        { value: '63vh', label: '2/3 Screen' }, { value: '95vh', label: 'Full Screen' }
      ]
    });
    // --- Named Layout Presets (save/load/delete) ---
    var LAYOUT_PRESET_SETTINGS_KEYS = [
      'columnWidth', 'whitespace', 'fontSize', 'fontFamily',
      'layoutRows', 'rowHeight', 'cardMinHeight', 'stickyStackMode', 'layoutSpacing'
    ];
    var LAYOUT_PRESETS_STORAGE_KEY = 'lexera-layout-presets';

    function getSavedLayoutPresets() {
      try { return JSON.parse(localStorage.getItem(LAYOUT_PRESETS_STORAGE_KEY)) || {}; }
      catch (_) { return {}; }
    }

    function saveLayoutPreset(name, settings) {
      var presets = getSavedLayoutPresets();
      presets[name] = settings;
      localStorage.setItem(LAYOUT_PRESETS_STORAGE_KEY, JSON.stringify(presets));
    }

    function deleteLayoutPreset(name) {
      var presets = getSavedLayoutPresets();
      delete presets[name];
      localStorage.setItem(LAYOUT_PRESETS_STORAGE_KEY, JSON.stringify(presets));
    }

    function captureCurrentLayoutSettings() {
      var captured = {};
      for (var i = 0; i < LAYOUT_PRESET_SETTINGS_KEYS.length; i++) {
        var key = LAYOUT_PRESET_SETTINGS_KEYS[i];
        captured[key] = getBoardSettingValue(key, null);
      }
      return captured;
    }

    function applyLayoutPresetSettings(settings) {
      for (var i = 0; i < LAYOUT_PRESET_SETTINGS_KEYS.length; i++) {
        var key = LAYOUT_PRESET_SETTINGS_KEYS[i];
        setBoardSettingValue(key, settings[key] || null);
      }
    }

    BoardSettingRegistry.register({
      id: 'boardLayout', label: 'Board Layout', category: 'format',
      settingsKey: 'boardLayout', actionPrefix: 'set-board-layout', defaultValue: 'kanban',
      normalize: normalizeBoardLayoutValue,
      options: [
        { value: 'kanban', label: 'Kanban' }, { value: 'canvas', label: 'Canvas' }
      ],
      handler: function (raw) {
        var v = normalizeBoardLayoutValue(raw);
        setBoardSettingValue('boardLayout', v);
      }
    });
    BoardSettingRegistry.register({
      id: 'canvasGrid', label: 'Canvas Grid', category: 'format',
      settingsKey: 'canvasGrid', actionPrefix: 'set-canvas-grid', defaultValue: '32',
      normalize: normalizeCanvasGridValue,
      options: [
        { value: 'off', label: 'Off' },
        { value: '16', label: 'Fine 16px' },
        { value: '32', label: 'Medium 32px' },
        { value: '64', label: 'Large 64px' },
        { value: 'largest', label: 'Largest Element' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'layoutPreset', label: 'Layout Preset', category: 'format',
      settingsKey: 'layoutPreset', actionPrefix: 'set-layout-preset', defaultValue: 'normal',
      normalize: function (v) { return String(v || 'normal').toLowerCase(); },
      handler: function (raw) {
        var v = String(raw || '').trim().toLowerCase();
        if (v === 'spacious') {
          setBoardSettingValue('layoutPreset', 'spacious');
          setBoardSettingValue('layoutSpacing', 'spacious');
        } else if (v === 'normal' || !v) {
          setBoardSettingValue('layoutPreset', null);
          setBoardSettingValue('layoutSpacing', null);
        } else {
          // Custom saved preset
          var presets = getSavedLayoutPresets();
          if (presets[v]) {
            applyLayoutPresetSettings(presets[v]);
            setBoardSettingValue('layoutPreset', v);
            showNotification('Layout preset: ' + v);
          }
        }
      },
      options: [
        { value: 'normal', label: 'Normal' }, { value: 'spacious', label: 'Spacious' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'stickyHeaders', label: 'Pinned Header Mode', category: 'format',
      settingsKey: 'stickyStackMode', actionPrefix: 'set-sticky-headers', defaultValue: '',
      normalize: function (v) { return normalizeStickyHeaderMode(v) || 'off'; },
      options: [
        { value: 'off', label: 'Off' }, { value: 'top', label: 'Top Edge' },
        { value: 'bottom', label: 'Bottom Edge' }
      ],
      handler: function (raw) {
        var v = normalizeStickyHeaderMode(raw);
        setBoardSettingValue('stickyStackMode', v || null);
      }
    });
    BoardSettingRegistry.register({
      id: 'arrowFocusScroll', label: 'Arrow Key Focus Scroll', category: 'format',
      settingsKey: 'arrowKeyFocusScroll', actionPrefix: 'set-arrow-focus-scroll', defaultValue: 'nearest',
      normalize: normalizeArrowKeyFocusScrollMode,
      options: [
        { value: 'nearest', label: 'Nearest' }, { value: 'center', label: 'Center' },
        { value: 'disabled', label: 'Disabled' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'scrollSpeed', label: 'Scroll Speed', category: 'format',
      settingsKey: 'scrollSpeed', actionPrefix: 'set-scroll-speed', defaultValue: '1',
      normalize: normalizeBoardScrollSpeedValue,
      options: [
        { value: '0.01', label: '1%' }, { value: '0.02', label: '2%' },
        { value: '0.03', label: '3%' }, { value: '0.06', label: '6%' },
        { value: '0.1', label: '10%' }, { value: '0.18', label: '18%' },
        { value: '0.32', label: '32%' }, { value: '0.56', label: '56%' },
        { value: '1', label: '100%' }, { value: '1.33', label: '133%' },
        { value: '1.67', label: '167%' }, { value: '2', label: '200%' },
        { value: '3', label: '300%' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'zoomSpeed', label: 'Zoom Speed', category: 'format',
      settingsKey: 'zoomSpeed', actionPrefix: 'set-zoom-speed', defaultValue: '0.06',
      normalize: normalizeBoardZoomSpeedValue,
      options: [
        { value: '0.01', label: '1%' }, { value: '0.02', label: '2%' },
        { value: '0.03', label: '3%' }, { value: '0.06', label: '6%' },
        { value: '0.1', label: '10%' }, { value: '0.18', label: '18%' },
        { value: '0.32', label: '32%' }, { value: '0.56', label: '56%' },
        { value: '1', label: '100%' }, { value: '1.33', label: '133%' },
        { value: '1.67', label: '167%' }, { value: '2', label: '200%' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'htmlComments', label: 'HTML Comments', category: 'display',
      settingsKey: 'htmlCommentRenderMode', actionPrefix: 'set-html-comments', defaultValue: 'hidden',
      normalize: normalizeHtmlCommentRenderMode,
      options: [
        { value: 'hidden', label: 'Hide Comments' }, { value: 'text', label: 'Show as Text' },
        { value: 'dim', label: 'Dim Comments' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'htmlContent', label: 'HTML Content', category: 'display',
      settingsKey: 'htmlContentRenderMode', actionPrefix: 'set-html-content', defaultValue: 'html',
      normalize: function (v) { return v === 'html' ? 'html' : 'text'; },
      options: [
        { value: 'html', label: 'Render HTML' }, { value: 'text', label: 'Show as Text' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'tagVisibility', label: 'Tag Visibility', category: 'display',
      settingsKey: 'tagVisibility', actionPrefix: 'set-tag-visibility', defaultValue: 'allexcludinglayout',
      normalize: normalizeTagVisibilityMode,
      options: [
        { value: 'all', label: 'All Tags' }, { value: 'allexcludinglayout', label: 'All Except Layout Tags' },
        { value: 'customonly', label: 'Custom Tags Only' }, { value: 'mentionsonly', label: 'Mentions Only' },
        { value: 'dim', label: 'Dim Tags' }, { value: 'none', label: 'Hide Tags' }
      ]
    });
    BoardSettingRegistry.register({
      id: 'tagStylePreset', label: 'Tag Style Preset', category: 'display',
      settingsKey: null, actionPrefix: 'set-tag-style-preset', defaultValue: 'default',
      getCurrentValue: function () { return getActiveTagStylePreset(); },
      handler: function (raw) {
        setActiveTagStylePreset(raw);
        renderColumns();
        showNotification('Tag style: ' + (TAG_STYLE_PRESETS[raw] ? TAG_STYLE_PRESETS[raw].label : raw));
      },
      options: (function () {
        var items = [];
        var keys = Object.keys(TAG_STYLE_PRESETS);
        for (var i = 0; i < keys.length; i++) {
          var p = TAG_STYLE_PRESETS[keys[i]];
          items.push({ value: keys[i], label: p.label + (p.description ? ' \u2014 ' + p.description : '') });
        }
        return items;
      })()
    });
    BoardSettingRegistry.register({
      id: 'visualTheme', label: 'Visual Theme', category: 'display',
      settingsKey: null, actionPrefix: 'set-visual-theme', defaultValue: 'classic',
      getCurrentValue: function () {
        return (typeof getLexeraCurrentVisualThemeId === 'function' && getLexeraCurrentVisualThemeId()) || 'classic';
      },
      handler: function (raw) {
        var applied = applyVisualTheme(raw);
        var label = (applied && applied.name) || VISUAL_THEME_LABELS[String(raw || '').trim()] || String(raw || 'classic');
        showNotification('Visual theme: ' + label);
      },
      options: VISUAL_THEMES.map(function (theme) {
        return {
          value: theme.id,
          label: theme.name + (theme.description ? ' \u2014 ' + theme.description : '')
        };
      })
    });

    // Auto-wire board setting action handlers from descriptors
    var allSettingDescs = BoardSettingRegistry.getAll();
    for (var bsi = 0; bsi < allSettingDescs.length; bsi++) {
      (function (desc) {
        ActionRegistry.register('board', desc.actionPrefix + ':*', function (action) {
          var raw = action.substring(desc.actionPrefix.length + 1);
          if (desc.handler) {
            desc.handler(raw);
          } else {
            var v = desc.normalize ? desc.normalize(raw) : raw;
            if (desc.resolve) v = desc.resolve(v);
            setBoardSettingValue(desc.settingsKey, v || null);
          }
        });
      })(allSettingDescs[bsi]);
    }
    ActionRegistry.register('board', 'set-ui-template:*', function (action) {
      var raw = action.substring('set-ui-template:'.length);
      var applied = applyVisualTheme(raw);
      showNotification('Visual theme: ' + ((applied && applied.name) || VISUAL_THEME_LABELS[raw] || raw));
    });
    ActionRegistry.register('board', 'set-board-theme:*', function (action) {
      var raw = action.substring('set-board-theme:'.length);
      var applied = applyVisualTheme(raw);
      showNotification('Visual theme: ' + ((applied && applied.name) || VISUAL_THEME_LABELS[raw] || raw));
    });

    // Layout preset save/delete actions
    ActionRegistry.register('board', 'save-layout-preset', function () {
      var name = window.prompt('Preset name');
      if (!name) return;
      name = name.trim();
      if (!name || name === 'normal' || name === 'spacious') {
        showNotification('Cannot use reserved preset name');
        return;
      }
      saveLayoutPreset(name, captureCurrentLayoutSettings());
      setBoardSettingValue('layoutPreset', name);
      showNotification('Layout preset saved: ' + name);
    });
    ActionRegistry.register('board', 'delete-layout-preset:*', function (action) {
      var name = action.substring('delete-layout-preset:'.length);
      deleteLayoutPreset(name);
      var current = getBoardSettingValue('layoutPreset', 'normal');
      if (current === name) {
        setBoardSettingValue('layoutPreset', null);
        setBoardSettingValue('layoutSpacing', null);
      }
      showNotification('Layout preset deleted: ' + name);
    });

    // Feature toggles
    ActionRegistry.register('board', 'pin-headers', function () { togglePinnedHeaders(); });
    ActionRegistry.register('board', 'unpin-headers', function () { togglePinnedHeaders(); });
    ActionRegistry.register('board', 'toggle-overlay-editor', function () { setOverlayEditorEnabled(!isOverlayEditorEnabled()); syncMenuCheckStates(); });
    ActionRegistry.register('board', 'toggle-wysiwyg-editor', function () { setWysiwygEditorEnabled(!isWysiwygEditorEnabled()); syncMenuCheckStates(); });
    ActionRegistry.register('board', 'toggle-special-chars', function () { setSpecialCharactersVisible(!isSpecialCharactersVisible()); syncMenuCheckStates(); });
    ActionRegistry.register('board', 'toggle-marp-settings', function () { setMarpSettingsEnabled(!isMarpSettingsEnabled()); syncMenuCheckStates(); });
    ActionRegistry.register('board', 'toggle-html-comments', function () {
      var mode = normalizeHtmlCommentRenderMode(getBoardSettingValue('htmlCommentRenderMode', 'hidden'));
      setBoardSettingValue('htmlCommentRenderMode', mode === 'hidden' ? 'text' : 'hidden');
    });
    ActionRegistry.register('board', 'toggle-html-content', function () {
      setBoardSettingValue('htmlContentRenderMode', getHtmlContentRenderMode() === 'html' ? 'text' : 'html');
    });
    ActionRegistry.register('board', 'toggle-tag-visibility', function () {
      var mode = normalizeTagVisibilityMode(getBoardSettingValue('tagVisibility', 'allexcludinglayout'));
      setBoardSettingValue('tagVisibility', mode === 'none' ? 'allexcludinglayout' : 'none');
    });
    ActionRegistry.register('board', 'toggle-sidebar-counts', function () {
      var next = toggleSidebarTreeDisplayOption('counts');
      showNotification('Sidebar counts ' + (next.counts ? 'shown' : 'hidden'));
    });
    ActionRegistry.register('board', 'toggle-sidebar-presence', function () {
      var next = toggleSidebarTreeDisplayOption('presence');
      showNotification('Sidebar presence ' + (next.presence ? 'shown' : 'hidden'));
    });
    ActionRegistry.register('board', 'toggle-sidebar-grips', function () {
      var next = toggleSidebarTreeDisplayOption('grips');
      showNotification('Sidebar drag icons ' + (next.grips ? 'shown' : 'hidden'));
    });
    ActionRegistry.register('board', 'toggle-inspector', function () { toggleInspector(); });
    ActionRegistry.register('board', 'file-toggle-marp-settings', function () { setMarpSettingsEnabled(!isMarpSettingsEnabled()); syncMenuCheckStates(); });

    // Save/export/settings
    ActionRegistry.register('board', 'save-now', function () {
      if (activeBoardId && fullBoardData && isBoardDirty()) {
        var gen = getBoardDirtyGeneration();
        saveFullBoard().then(function (saved) { if (saved) clearBoardDirtyIfUnchanged(gen); });
      } else {
        var trackingBtn = document.getElementById('btn-save-tracking');
        if (trackingBtn) showSaveTrackingMenu(trackingBtn);
        else showNotification('No unsaved changes');
      }
      refreshBoardHeaderActionStates();
    });
    ActionRegistry.register('board', 'quit-app', function () {
      requestApplicationQuitWithCleanup();
    });
    ActionRegistry.register('board', 'file-open-board-settings', function () { openSettingsDialogForBoard(activeBoardId); });
    ActionRegistry.register('board', 'file-open-export-settings', function () { triggerBoardExport(); });
    ActionRegistry.register('board', 'export-board', function () { triggerBoardExport(); });

    // Panels
    ActionRegistry.register('board', 'running-processes', function () { openRunningProcessesPanel(); });
    ActionRegistry.register('board', 'show-processes', function () { openRunningProcessesPanel(); });
    ActionRegistry.register('board', 'open-save-tracking', function () {
      var btn = document.getElementById('btn-save-tracking');
      if (btn) showSaveTrackingMenu(btn);
    });
    ActionRegistry.register('board', 'open-management', function () { openManagementPanel(); });
    ActionRegistry.register('board', 'open-theme-zoom', function () {
      openFrontendSettingsPanel();
    });
    ActionRegistry.register('board', 'open-frontend-settings', function () { openFrontendSettingsPanel(); });

    // View management
    ActionRegistry.register('board', 'show-parked', function () { showParkedItems(); });
    ActionRegistry.register('board', 'show-archived', function () { showArchivedItems(); });
    ActionRegistry.register('board', 'show-trash', function () { showDeletedItems(); });
    ActionRegistry.register('board', 'rename-file', function () { renameActiveBoardFile(); });
    ActionRegistry.register('board', 'open-folder', function () { openActiveBoardFolder(); });
    ActionRegistry.register('board', 'copy-board-markdown', function () { copyElementAsMarkdown('board', {}); });

    // Backend/connection
    ActionRegistry.register('board', 'backend-settings', function () { openConnectionWindow(); });
    ActionRegistry.register('board', 'settings', function () { openConnectionWindow(); });
    ActionRegistry.register('board', 'collab', function () { openConnectionWindow(); });
    ActionRegistry.register('board', 'reveal-panel:hierarchy', function () {
      if (WorkspaceShell) WorkspaceShell.revealPanel('hierarchy');
    });
    ActionRegistry.register('board', 'reveal-panel:dashboard', function () {
      if (WorkspaceShell) WorkspaceShell.revealPanel('dashboard');
    });
    ActionRegistry.register('board', 'reveal-panel:logs', function () {
      if (WorkspaceShell) WorkspaceShell.revealPanel('logs');
    });
    ActionRegistry.register('board', 'reveal-panel:backendSettings', function () {
      if (WorkspaceShell) WorkspaceShell.revealPanel('backendSettings');
      else openConnectionWindow();
    });
    ActionRegistry.register('board', 'reveal-panel:frontendSettings', function () {
      if (WorkspaceShell) WorkspaceShell.revealPanel('frontendSettings');
    });
    ActionRegistry.register('board', 'reveal-panel:renderApps', function () {
      if (WorkspaceShell) WorkspaceShell.revealPanel('renderApps');
    });
    ActionRegistry.register('board', 'reveal-panel:files', function () {
      if (WorkspaceShell) WorkspaceShell.revealPanel('files');
    });

    // Search
    ActionRegistry.register('board', 'open-search', function () { openSearchReplacePanel(); });
    ActionRegistry.register('board', 'open-search-replace', function () { openSearchReplacePanel(); });
    ActionRegistry.register('board', 'paste-as-card', function () {
      var columns = activeBoardData ? activeBoardData.columns : [];
      if (columns.length > 0) pasteClipboardAsCard(columns[0].index);
    });
    ActionRegistry.register('board', 'smart-paste', function () {
      smartPasteAsCard();
    });

    // Zoom
    ActionRegistry.register('board', 'zoom-in', function () {
      if (isCanvasBoardLayout()) { nudgeCanvasZoom(getCanvasZoomStep(0.1)); } else { nudgeUiScale(getUiZoomStep(0.05)); }
    });
    ActionRegistry.register('board', 'zoom-out', function () {
      if (isCanvasBoardLayout()) { nudgeCanvasZoom(getCanvasZoomStep(-0.1)); } else { nudgeUiScale(getUiZoomStep(-0.05)); }
    });
    ActionRegistry.register('board', 'zoom-reset', function () {
      if (isCanvasBoardLayout()) { applyCanvasZoom(1); resetCanvasPan(); } else { applyUiScale(1); showNotification('Zoom 100%'); }
    });

    // Navigation
    ActionRegistry.register('board', 'show-recent-boards', function () {
      var items = document.querySelectorAll('.sidebar-board-item');
      if (items.length > 0) items[0].scrollIntoView({ behavior: 'smooth' });
    });
    ActionRegistry.register('board', 'focus-next-card', function () { navigateCards('ArrowDown'); });
    ActionRegistry.register('board', 'focus-prev-card', function () { navigateCards('ArrowUp'); });
    ActionRegistry.register('board', 'focus-next-column', function () { navigateCards('ArrowRight'); });
    ActionRegistry.register('board', 'focus-prev-column', function () { navigateCards('ArrowLeft'); });

    // Stats
    ActionRegistry.register('board', 'toggle-board-stats', function () { toggleBoardStatsBar(); });
    ActionRegistry.register('board', 'show-keyboard-shortcuts', function () { showKeyboardShortcutsHelp(); });

    // ----- Card scope -----
    ActionRegistry.register('card', 'add-card', function (action, ctx) { addCardColumn = ctx.colIndex; renderColumns(); });
    ActionRegistry.register('card', 'edit', function (action, ctx) {
      var els = getElColumnsContainer().querySelectorAll('.card[data-col-index="' + ctx.colIndex + '"][data-card-index="' + ctx.cardIndex + '"]');
      if (els.length > 0) openCardEditor(els[0], ctx.colIndex, ctx.cardIndex, 'inline');
    });
    ActionRegistry.register('card', 'edit-inline', function (action, ctx) {
      var els = getElColumnsContainer().querySelectorAll('.card[data-col-index="' + ctx.colIndex + '"][data-card-index="' + ctx.cardIndex + '"]');
      if (els.length > 0) openCardEditor(els[0], ctx.colIndex, ctx.cardIndex, 'inline');
    });
    ActionRegistry.register('card', 'edit-overlay', function (action, ctx) {
      if (!isOverlayEditorEnabled()) { showNotification('Overlay editor is disabled in header settings'); return; }
      var els = getElColumnsContainer().querySelectorAll('.card[data-col-index="' + ctx.colIndex + '"][data-card-index="' + ctx.cardIndex + '"]');
      if (els.length > 0) openCardEditor(els[0], ctx.colIndex, ctx.cardIndex, 'overlay');
    });
    ActionRegistry.register('card', 'reveal', function (action, ctx) { revealCardContent(ctx.colIndex, ctx.cardIndex); });
    ActionRegistry.register('card', 'copy-markdown', function (action, ctx) { copyElementAsMarkdown('card', { colIndex: ctx.colIndex, cardIndex: ctx.cardIndex }); });
    ActionRegistry.register('card', 'insert-before', function (action, ctx) { insertCardAtIndex(ctx.colIndex, ctx.cardIndex); });
    ActionRegistry.register('card', 'insert-after', function (action, ctx) { insertCardAtIndex(ctx.colIndex, ctx.cardIndex + 1); });
    ActionRegistry.register('card', 'duplicate', function (action, ctx) { duplicateCard(ctx.colIndex, ctx.cardIndex); });
    ActionRegistry.register('card', 'move-up', function (action, ctx) { if (ctx.cardIndex > 0) moveCard(ctx.colIndex, ctx.cardIndex, ctx.colIndex, ctx.cardIndex - 1); });
    ActionRegistry.register('card', 'move-down', function (action, ctx) { moveCard(ctx.colIndex, ctx.cardIndex, ctx.colIndex, ctx.cardIndex + 2); });
    ActionRegistry.register('card', 'move-top', function (action, ctx) { if (ctx.cardIndex > 0) moveCard(ctx.colIndex, ctx.cardIndex, ctx.colIndex, 0); });
    ActionRegistry.register('card', 'move-bottom', function (action, ctx) {
      var col = getFullColumn(ctx.colIndex);
      if (col && ctx.cardIndex < col.cards.length - 1) moveCard(ctx.colIndex, ctx.cardIndex, ctx.colIndex, col.cards.length);
    });
    ActionRegistry.register('card', 'move-to:*', function (action, ctx) {
      var targetColIdx = parseInt(action.substring(8), 10);
      if (isFinite(targetColIdx)) moveCard(ctx.colIndex, ctx.cardIndex, targetColIdx, 0);
    });
    ActionRegistry.register('card', 'dup-to:*', function (action, ctx) {
      var dupTargetIdx = parseInt(action.substring(7), 10);
      if (isFinite(dupTargetIdx)) duplicateCardToColumn(ctx.colIndex, ctx.cardIndex, dupTargetIdx);
    });
    ActionRegistry.register('card', 'park', function (action, ctx) { tagCard(ctx.colIndex, ctx.cardIndex, '#hidden-internal-parked'); });
    ActionRegistry.register('card', 'park-copy', function (action, ctx) { parkCopyCard(ctx.colIndex, ctx.cardIndex); });
    ActionRegistry.register('card', 'archive', function (action, ctx) { tagCard(ctx.colIndex, ctx.cardIndex, '#hidden-internal-archived'); });
    ActionRegistry.register('card', 'delete', function (action, ctx) { deleteCard(ctx.colIndex, ctx.cardIndex); });
    ActionRegistry.register('card', 'marp-*', function (action, ctx) { handleEntityMarpMenuAction(action, 'card', { colIndex: ctx.colIndex, cardIndex: ctx.cardIndex }); });
    ActionRegistry.register('card', 'tag-*', function (action, ctx) { handleEntityTagMenuAction(action, 'card', { colIndex: ctx.colIndex, cardIndex: ctx.cardIndex }); });

    // ----- Column scope -----
    ActionRegistry.register('column', /^move-to-stack-(\d+)-(\d+)$/, function (action, ctx) {
      var m = action.match(/^move-to-stack-(\d+)-(\d+)$/);
      if (m) moveColumnToStack(ctx.colIndex, parseInt(m[1], 10), parseInt(m[2], 10));
    });
    ActionRegistry.register('column', 'rename', function (action, ctx) {
      var colCardsEl = getElColumnsContainer().querySelector('.column-cards[data-col-index="' + ctx.colIndex + '"]');
      var colRootEl = colCardsEl ? colCardsEl.closest('.column') : null;
      if (colRootEl) enterColumnRename(colRootEl, ctx.colIndex);
    });
    ActionRegistry.register('column', 'add-card', function (action, ctx) { addCardColumn = ctx.colIndex; renderColumns(); });
    ActionRegistry.register('column', 'add-card-top', function (action, ctx) { insertCardAtIndex(ctx.colIndex, 0); });
    ActionRegistry.register('column', 'paste-as-card', function (action, ctx) { pasteClipboardAsCard(ctx.colIndex); });
    ActionRegistry.register('column', 'smart-paste', function (action, ctx) { smartPasteAsCard(ctx.colIndex); });
    ActionRegistry.register('column', 'reveal-all', function (action, ctx) { revealColumnContent(ctx.colIndex); });
    ActionRegistry.register('column', 'add-before', function (action, ctx) {
      if (!(ctx.rowIdx !== undefined && addColumnRelativeToDisplayPosition(ctx.rowIdx, ctx.stackIdx, ctx.colLocalIdx, true))) {
        addColumn(ctx.colIndex);
      }
    });
    ActionRegistry.register('column', 'add-after', function (action, ctx) {
      if (!(ctx.rowIdx !== undefined && addColumnRelativeToDisplayPosition(ctx.rowIdx, ctx.stackIdx, ctx.colLocalIdx, false))) {
        addColumn(ctx.colIndex + 1);
      }
    });
    ActionRegistry.register('column', 'duplicate', function (action, ctx) { duplicateColumn(ctx.colIndex); });
    ActionRegistry.register('column', 'fold-all', function (action, ctx) { toggleColCards(ctx.colIndex, true); });
    ActionRegistry.register('column', 'unfold-all', function (action, ctx) { toggleColCards(ctx.colIndex, false); });
    ActionRegistry.register('column', 'park', function (action, ctx) { setColumnHiddenTag(ctx.colIndex, '#hidden-internal-parked'); });
    ActionRegistry.register('column', 'archive', function (action, ctx) { setColumnHiddenTag(ctx.colIndex, '#hidden-internal-archived'); });
    ActionRegistry.register('column', 'delete', function (action, ctx) { deleteColumn(ctx.colIndex); });
    ActionRegistry.register('column', 'toggle-width', function (action, ctx) { toggleColumnWidth(ctx.colIndex); });
    ActionRegistry.register('column', 'set-span-*', function (action, ctx) { setColumnSpan(ctx.colIndex, parseInt(action.substring(9), 10)); });
    ActionRegistry.register('column', 'toggle-stacked', function (action, ctx) { toggleTag('column', { colIndex: ctx.colIndex }, '#stack'); });
    ActionRegistry.register('column', 'sort-title', function (action, ctx) { sortColumnCards(ctx.colIndex, 'title'); });
    ActionRegistry.register('column', 'sort-tag', function (action, ctx) { sortColumnCards(ctx.colIndex, 'tag'); });
    ActionRegistry.register('column', 'sort-duedate', function (action, ctx) { sortColumnCards(ctx.colIndex, 'duedate'); });
    ActionRegistry.register('column', 'copy-markdown', function (action, ctx) { copyElementAsMarkdown('column', { colIndex: ctx.colIndex }); });
    ActionRegistry.register('column', 'export-column', function (action, ctx) { exportColumn(ctx.colIndex); });
    ActionRegistry.register('column', 'preview-include', function (action, ctx) {
      var col = getFullColumn(ctx.colIndex);
      var path = col && col.includeSource && col.includeSource.rawPath ? String(col.includeSource.rawPath) : extractIncludePathFromTitle(col && col.title ? col.title : '');
      if (path) showBoardFilePreview(activeBoardId, path);
    });
    ActionRegistry.register('column', 'open-include', function (action, ctx) {
      var col = getFullColumn(ctx.colIndex);
      var path = col && col.includeSource && col.includeSource.rawPath ? String(col.includeSource.rawPath) : extractIncludePathFromTitle(col && col.title ? col.title : '');
      if (path) openBoardFileInSystem(activeBoardId, path);
    });
    ActionRegistry.register('column', 'enable-include', function (action, ctx) { enableColumnIncludeMode(ctx.colIndex); });
    ActionRegistry.register('column', 'edit-include', function (action, ctx) { editColumnIncludeFile(ctx.colIndex); });
    ActionRegistry.register('column', 'disable-include', function (action, ctx) { disableColumnIncludeMode(ctx.colIndex); });
    ActionRegistry.register('column', 'marp-*', function (action, ctx) { handleEntityMarpMenuAction(action, 'column', { colIndex: ctx.colIndex }); });
    ActionRegistry.register('column', 'tag-*', function (action, ctx) { handleEntityTagMenuAction(action, 'column', { colIndex: ctx.colIndex }); });

    // ----- Row scope -----
    ActionRegistry.register('row', 'rename', function (action, ctx) { renameRowOrStack('row', ctx.rowIdx); });
    ActionRegistry.register('row', 'add-stack', function (action, ctx) { addStackToRow(ctx.rowIdx); });
    ActionRegistry.register('row', 'reveal-all', function (action, ctx) { revealRowContent(ctx.rowIdx); });
    ActionRegistry.register('row', 'insert-before', function (action, ctx) { addRow(ctx.rowIdx); });
    ActionRegistry.register('row', 'add-row-before', function (action, ctx) { addRow(ctx.rowIdx); });
    ActionRegistry.register('row', 'insert-after', function (action, ctx) { addRow(ctx.rowIdx + 1); });
    ActionRegistry.register('row', 'add-row-after', function (action, ctx) { addRow(ctx.rowIdx + 1); });
    ActionRegistry.register('row', 'duplicate', function (action, ctx) { duplicateRow(ctx.rowIdx); });
    ActionRegistry.register('row', 'park', function (action, ctx) { setRowHiddenTag(ctx.rowIdx, '#hidden-internal-parked'); });
    ActionRegistry.register('row', 'archive', function (action, ctx) { setRowHiddenTag(ctx.rowIdx, '#hidden-internal-archived'); });
    ActionRegistry.register('row', 'delete', function (action, ctx) { deleteRow(ctx.rowIdx); });
    ActionRegistry.register('row', 'sort-title', function (action, ctx) { sortRowCards(ctx.rowIdx, 'title'); });
    ActionRegistry.register('row', 'sort-tag', function (action, ctx) { sortRowCards(ctx.rowIdx, 'tag'); });
    ActionRegistry.register('row', 'sort-duedate', function (action, ctx) { sortRowCards(ctx.rowIdx, 'duedate'); });
    ActionRegistry.register('row', 'copy-markdown', function (action, ctx) { copyElementAsMarkdown('row', { rowIdx: ctx.rowIdx }); });
    ActionRegistry.register('row', 'export-row', function (action, ctx) {
      triggerBoardExport({ selection: { scope: 'row', rowIndex: ctx.rowIdx } });
    });
    ActionRegistry.register('row', 'marp-*', function (action, ctx) { handleEntityMarpMenuAction(action, 'row', { rowIdx: ctx.rowIdx }); });
    ActionRegistry.register('row', 'tag-*', function (action, ctx) { handleEntityTagMenuAction(action, 'row', { rowIdx: ctx.rowIdx }); });

    // ----- Canvas background scope -----
    ActionRegistry.register('canvas', 'add-stack-here', function (action, ctx) {
      addStackToRow(ctx.rowIdx, { canvasPosition: ctx.canvasPosition });
    });

    // ----- Stack scope -----
    ActionRegistry.register('stack', 'rename', function (action, ctx) { renameRowOrStack('stack', ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'add-column', function (action, ctx) { addColumnToStack(ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'reveal-all', function (action, ctx) { revealStackContent(ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'insert-before', function (action, ctx) { addStackToRow(ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'add-stack-before', function (action, ctx) { addStackToRow(ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'insert-after', function (action, ctx) { addStackToRow(ctx.rowIdx, ctx.stackIdx + 1); });
    ActionRegistry.register('stack', 'add-stack-after', function (action, ctx) { addStackToRow(ctx.rowIdx, ctx.stackIdx + 1); });
    ActionRegistry.register('stack', 'duplicate', function (action, ctx) { duplicateStack(ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'park', function (action, ctx) { setStackHiddenTag(ctx.rowIdx, ctx.stackIdx, '#hidden-internal-parked'); });
    ActionRegistry.register('stack', 'archive', function (action, ctx) { setStackHiddenTag(ctx.rowIdx, ctx.stackIdx, '#hidden-internal-archived'); });
    ActionRegistry.register('stack', 'delete', function (action, ctx) { deleteStack(ctx.rowIdx, ctx.stackIdx); });
    ActionRegistry.register('stack', 'sort-title', function (action, ctx) { sortStackCards(ctx.rowIdx, ctx.stackIdx, 'title'); });
    ActionRegistry.register('stack', 'sort-tag', function (action, ctx) { sortStackCards(ctx.rowIdx, ctx.stackIdx, 'tag'); });
    ActionRegistry.register('stack', 'sort-duedate', function (action, ctx) { sortStackCards(ctx.rowIdx, ctx.stackIdx, 'duedate'); });
    ActionRegistry.register('stack', 'copy-markdown', function (action, ctx) { copyElementAsMarkdown('stack', { rowIdx: ctx.rowIdx, stackIdx: ctx.stackIdx }); });
    ActionRegistry.register('stack', 'export-stack', function (action, ctx) {
      triggerBoardExport({ selection: { scope: 'stack', rowIndex: ctx.rowIdx, stackIndex: ctx.stackIdx } });
    });
    ActionRegistry.register('stack', 'marp-*', function (action, ctx) { handleEntityMarpMenuAction(action, 'stack', { rowIdx: ctx.rowIdx, stackIdx: ctx.stackIdx }); });
    ActionRegistry.register('stack', 'tag-*', function (action, ctx) { handleEntityTagMenuAction(action, 'stack', { rowIdx: ctx.rowIdx, stackIdx: ctx.stackIdx }); });

    // ── Menu Contributor Registrations (delegated to ContextMenuBuilders) ──
    if (window.ContextMenuBuilders) {
      ContextMenuBuilders.init({
        MenuContributorRegistry: MenuContributorRegistry,
        TAG_CATEGORIES: TAG_CATEGORIES,
        hasTag: hasTag,
        extractAllTags: extractAllTags,
        isLayoutTagName: isLayoutTagName,
        isOverlayEditorEnabled: isOverlayEditorEnabled,
        isCanvasBoardLayout: isCanvasBoardLayout,
        stripLayoutTags: stripLayoutTags,
        stripInternalHiddenTags: stripInternalHiddenTags,
        stripHtmlComments: stripHtmlComments,
        formatMenuToggleLabel: formatMenuToggleLabel,
        isMarpSettingsEnabled: isMarpSettingsEnabled,
        getMarpDirectiveValueFromHeader: getMarpDirectiveValueFromHeader,
        truncateMarpDirectiveValue: truncateMarpDirectiveValue,
        getAvailableMarpClassNames: getAvailableMarpClassNames,
        getMarpClassListFromHeader: getMarpClassListFromHeader,
        hasMarpDirectiveValue: hasMarpDirectiveValue,
        MARP_COLOR_DIRECTIVES: MARP_COLOR_DIRECTIVES,
        MARP_TEXT_DIRECTIVES: MARP_TEXT_DIRECTIVES
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { poll: poll };
})();
