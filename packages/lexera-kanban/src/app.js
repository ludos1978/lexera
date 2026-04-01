
/**
 * Lexera Kanban — Board viewer with markdown rendering.
 * Uses LexeraApi from api.js.
 */
var LexeraDashboard = (function () {
  var PathUtils = window.LexeraPathUtils;
  var _rt = window.LexeraRuntime;
  var Settings = typeof LexeraSettings !== 'undefined' ? LexeraSettings : null;

  // ── Shared state — bridged to LexeraRuntime for cross-module access ──
  // Modules read via _rt.state.xxx; app.js writes via the setter helpers below.
  if (_rt) {
    _rt.defineState('boards', []);
    _rt.defineState('remoteBoards', []);
    _rt.defineState('workspaces', []);
    _rt.defineState('activeWorkspaceId', (Settings ? Settings.get('activeWorkspace') : localStorage.getItem('lexera-active-workspace')) || null);
    _rt.defineState('activeBoardId', null);
    _rt.defineState('activeBoardData', null);
    _rt.defineState('fullBoardData', null);
    _rt.defineState('connected', false);
    _rt.defineState('liveSyncState', null);
    _rt.defineState('boardPresenceCache', {});
    _rt.defineState('workspaceShellEnabled', false);
  }

  // Local variables — kept for backwards compat with code that reads them directly.
  // Setters update BOTH the local var and the runtime state.
  let boards = [];
  let remoteBoards = [];
  let workspaces = [];
  const ALL_WORKSPACES_ID = '__all__';
  let activeWorkspaceId = (Settings ? Settings.get('activeWorkspace') : localStorage.getItem('lexera-active-workspace')) || null;
  let activeBoardId = null;
  let activeBoardData = null;
  let fullBoardData = null;
  // boardHierarchyCache is now owned by LexeraBoardList module
  let connected = false;
  let boardLoadSeq = 0;
  let searchMode = false;
  let searchResults = null;
  // columnSortState now lives in LexeraColumnContextMenu module
  let pollInterval = null;
  let addCardColumn = null;
  // ptrDrag state now lives in DragDropHandlers module
  var isEditing = false;
  var CardEditorModule = window.CardEditor;
  var InlineCardEditorModule = window.InlineCardEditor;
  var LIVE_DRAFT_SYNC_DEBOUNCE_MS = 1200;
  var pendingExternalRebaseConflict = null;
  var pendingRefresh = false;
  var eventSource = null;
  var lastSaveTime = 0;
  var SAVE_DEBOUNCE_MS = 2000;
  var liveSyncState = null;
  var liveSyncLastLocalBroadcastAt = 0;
  var liveSyncMutex = Promise.resolve();
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

  function syncRuntimeState(key, value) {
    if (_rt) _rt.setState(key, value);
  }

  function syncFoldedLogStatusBadges() {
    if (typeof window !== 'undefined' && typeof window.updateFoldedLogStatusBadges === 'function') {
      window.updateFoldedLogStatusBadges();
    }
  }

  function setActiveBoardIdState(nextBoardId) {
    activeBoardId = nextBoardId;
    syncRuntimeState('activeBoardId', nextBoardId);
    syncFoldedLogStatusBadges();
  }
  var BoardSettingRegistry = window.LexeraBoardSettingRegistry;
  var MenuContributorRegistry = window.LexeraMenuContributorRegistry;
  var TreeView = window.TreeView || null;
  var VirtualScroll = window.LexeraVirtualScroll;
  if (VirtualScroll) VirtualScroll.init({
    getColumnsContainer: function() { return getElColumnsContainer(); },
    getCurrentCardEditor: function() { return CardEditorModule ? CardEditorModule.getCurrentCardEditor() : null; },
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
  var DndListeners = window.LexeraDndListeners;
  if (DndListeners) DndListeners.init({
    getElBoardList: function() { return getElBoardList(); },
    getElColumnsContainer: function() { return getElColumnsContainer(); },
    getActiveBoardId: function() { return activeBoardId; },
    getFullBoardData: function() { return fullBoardData; },
    getDragDropHandlers: function() { return DragDropHandlers; },
    toTopFramePoint: function(win, x, y) { return toTopFramePoint(win, x, y); },
    startCrossViewBridge: function(kind) { startCrossViewBridge(kind); },
    stopCrossViewBridge: function() { stopCrossViewBridge(); },
    targetClosest: function(target, selector) { return targetClosest(target, selector); },
    toggleColumnFoldElement: function(colEl, childrenOnly) { toggleColumnFoldElement(colEl, childrenOnly); },
    toggleStackFoldElement: function(stackEl, childrenOnly) { toggleStackFoldElement(stackEl, childrenOnly); },
    toggleRowFoldElement: function(rowEl, childrenOnly) { toggleRowFoldElement(rowEl, childrenOnly); },
    selectCardRange: function(cardEl) { selectCardRange(cardEl); },
    toggleCardSelection: function(cardEl) { toggleCardSelection(cardEl); },
    selectCard: function(cardEl) { selectCard(cardEl); },
    clearCardSelection: function() { clearCardSelection(); },
    unfocusCard: function() { unfocusCard(); },
    openCardEditor: function(cardEl, colIndex, cardIndex, mode) { openCardEditor(cardEl, colIndex, cardIndex, mode); },
    isOverlayEditorEnabled: function() { return isOverlayEditorEnabled(); },
    enterColumnRename: function(colEl, colIndex) { enterColumnRename(colEl, colIndex); },
    renameRowOrStack: function(type, rowIdx, stackIdx) { renameRowOrStack(type, rowIdx, stackIdx); },
    startCardDrag: function(e) { startCardDrag(e); },
    finishCardDrag: function(mx, my) { finishCardDrag(mx, my); },
    cleanupCardDrag: function() { cleanupCardDrag(); },
    vsMaterialiseAll: function() { vsMaterialiseAll(); },
    lockBoardLayoutForDrag: function() { lockBoardLayoutForDrag(); },
    insertStackDropZones: function() { insertStackDropZones(); },
    insertDropZoneIndicators: function(dragType) { insertDropZoneIndicators(dragType); },
    getPtrDragLabel: function() { return getPtrDragLabel(); },
    clearPtrDropIndicators: function() { clearPtrDropIndicators(); },
    resolveHeaderDropTag: function(mx, my) { return resolveHeaderDropTag(mx, my); },
    resolveCanvasRowContentDropTarget: function(mx, my) { return resolveCanvasRowContentDropTarget(mx, my); },
    getCanvasRowContentNodeFromDropTarget: function(target, fallbackNode) { return getCanvasRowContentNodeFromDropTarget(target, fallbackNode); },
    getCanvasDropPositionInRowContent: function(rowContent, clientX, clientY, grabOffsetX, grabOffsetY) { return getCanvasDropPositionInRowContent(rowContent, clientX, clientY, grabOffsetX, grabOffsetY); },
    updatePtrDropTarget: function(mx, my) { return updatePtrDropTarget(mx, my); },
    executePtrDrop: function(mx, my) { executePtrDrop(mx, my); },
    cleanupPtrDrag: function() { cleanupPtrDrag(); },
    isCanvasBoardLayout: function() { return isCanvasBoardLayout(); },
    renderColumns: function() { renderColumns(); },
    scheduleCanvasRowBoundsSync: function(root) { scheduleCanvasRowBoundsSync(root); },
    scheduleCanvasFocusStacksControlSync: function(container) { scheduleCanvasFocusStacksControlSync(container); },
    findFullDataRow: function(i) { return findFullDataRow(i); },
    findFullDataStack: function(r, s) { return findFullDataStack(r, s); },
    findFullColumnIndexInStack: function(s, c) { return findFullColumnIndexInStack(s, c); },
    loadBoardDataForMutation: function(boardId) { return loadBoardDataForMutation(boardId); },
    commitBoardMutations: function(changed, opts) { return commitBoardMutations(changed, opts); },
    pushUndo: function() { pushUndo(); },
    removeEmptyStacksAndRowsInBoard: function(d) { removeEmptyStacksAndRowsInBoard(d); },
    insertUnnamedRowForMutation: function(b, d, t, s) { return insertUnnamedRowForMutation(b, d, t, s); },
    insertUnnamedStackIntoRowForMutation: function(b, d, t) { return insertUnnamedStackIntoRowForMutation(b, d, t); },
    createUnnamedStackForMutation: function(c) { return createUnnamedStackForMutation(c); },
    findInsertStackIndexInRow: function(r, ri, i) { return findInsertStackIndexInRow(r, ri, i); },
    findInsertColumnIndexInStack: function(s, c, b) { return findInsertColumnIndexInStack(s, c, b); },
    getCanvasStackDropApi: function() { return getCanvasStackDropApi(); }
  });
  if (DndListeners) DndListeners.bindAll();
  if (CardEditorModule) CardEditorModule.init({
    getActiveBoardId: function() { return activeBoardId; },
    getActiveBoardFilePath: function() { return getActiveBoardFilePath(); },
    getBoardFilePathForId: function(id) { return getBoardFilePathForId(id); },
    normalizePathForCompare: function(p) { return normalizePathForCompare(p); },
    joinBoardRelativePath: function(b, r) { return joinBoardRelativePath(b, r); },
    getDirNameFromPath: function(p) { return getDirNameFromPath(p); },
    getFullColumn: function(idx) { return getFullColumn(idx); },
    getFullCardIndex: function(col, visIdx) { return getFullCardIndex(col, visIdx); },
    getFullBoardData: function() { return fullBoardData; },
    getElColumnsContainer: function() { return getElColumnsContainer(); },
    LexeraApi: LexeraApi,
    showNativeMenu: function(items, x, y) { return showNativeMenu(items, x, y); },
    escapeHtml: function(s) { return escapeHtml(s); },
    isOverlayEditorEnabled: function() { return isOverlayEditorEnabled(); },
    setIsEditing: function(v) { isEditing = v; },
    getSyncUserName: function() { return syncUserName; },
    getSyncUserId: function() { return syncUserId; },
    shouldBroadcastEditingPresence: function() { return shouldBroadcastEditingPresence(activeBoardId); },
    queueCardDraftLiveSync: function(ci, fi, c) { queueCardDraftLiveSync(ci, fi, c); },
    queueEditingPresenceBroadcast: function(kid, pos, typing) { queueEditingPresenceBroadcast(kid, pos, typing); },
    handleTextareaTabIndent: function(e, ta) { return handleTextareaTabIndent(e, ta); },
    handleEditorPasteImage: function(e, ta) { handleEditorPasteImage(e, ta); },
    resolveDropContent: function(dt) { return resolveDropContent(dt); },
    clearEditingPresenceQueue: function() { clearEditingPresenceQueue(); },
    clearPendingCardDraftSync: function() { clearPendingCardDraftSync(); },
    revertCardDraftLiveSync: function(ci, fi, orig) { return revertCardDraftLiveSync(ci, fi, orig); },
    flushDeferredBoardRefresh: function(opts) { return flushDeferredBoardRefresh(opts); },
    pushUndo: function() { pushUndo(); },
    persistBoardMutation: function(opts) { return persistBoardMutation(opts); },
    updateCardElementInPlace: function(ci, vi) { updateCardElementInPlace(ci, vi); },
    getIncludeResolvedContent: function(content, colIndex) { return getIncludeResolvedContent(content, colIndex); },
    renderCardContent: function(content, boardId, col, opts) { return renderCardContent(content, boardId, col, opts); },
    renderTitleInline: function(title, boardId) { return renderTitleInline(title, boardId); },
    enhanceEmbeddedContent: function(el) { enhanceEmbeddedContent(el); },
    applyRenderedHtmlCommentVisibility: function(el, mode) { applyRenderedHtmlCommentVisibility(el, mode); },
    applyRenderedTagVisibility: function(el, mode) { applyRenderedTagVisibility(el, mode); },
    attachRenderedTagInteractions: function(el) { attachRenderedTagInteractions(el); },
    getCurrentHtmlCommentRenderMode: function() { return currentHtmlCommentRenderMode; },
    getCurrentTagVisibilityMode: function() { return currentTagVisibilityMode; },
    getCardTitle: function(content) { return getCardTitle(content); },
    stripInternalHiddenTags: function(content) { return stripInternalHiddenTags(content); },
    replaceNthMarkdownEmbed: function(c, i, r) { return replaceNthMarkdownEmbed(c, i, r); },
    lexeraLog: function(level, msg) { lexeraLog(level, msg); },
    logFrontendIssue: function(level, tag, msg, err) { logFrontendIssue(level, tag, msg, err); },
    getInlineCardEditor: function() { return InlineCardEditorModule ? InlineCardEditorModule.getCurrentInlineCardEditor() : null; },
    closeInlineCardEditor: function(opts) { return closeInlineCardEditor(opts); },
    enterInlineCardEditMode: function(el, ci, cj) { enterInlineCardEditMode(el, ci, cj); }
  });
  if (InlineCardEditorModule) InlineCardEditorModule.init({
    getCurrentCardEditor: function() { return CardEditorModule ? CardEditorModule.getCurrentCardEditor() : null; },
    getFullBoardData: function() { return fullBoardData; },
    getFullColumn: function(idx) { return getFullColumn(idx); },
    getFullCardIndex: function(col, visIdx) { return getFullCardIndex(col, visIdx); },
    escapeAttr: function(s) { return escapeAttr(s); },
    setIsEditing: function(v) { isEditing = v; },
    LexeraApi: LexeraApi,
    getSyncUserName: function() { return syncUserName; },
    getSyncUserId: function() { return syncUserId; },
    shouldBroadcastEditingPresence: function() { return shouldBroadcastEditingPresence(activeBoardId); },
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
  var CanvasPan = window.LexeraCanvasPan;
  if (CanvasPan) CanvasPan.init({
    getActiveBoardData: function () { return activeBoardData; },
    isCanvasBoardLayout: function () { return isCanvasBoardLayout(); },
    canStartCanvasPointerPan: function (target, button, altKey) { return canStartCanvasPointerPan(target, button, altKey); },
    getElColumnsContainer: function () { return getElColumnsContainer(); },
    getCanvasPanX: function () { return $canvasPanX; },
    getCanvasPanY: function () { return $canvasPanY; },
    applyCanvasPan: function (panX, panY) { applyCanvasPan(panX, panY); }
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
  var BoardSettingsModule = window.LexeraBoardSettings;
  if (BoardSettingsModule) BoardSettingsModule.init({
    getFullBoardData: function () { return fullBoardData; },
    getCachedWorkspaceSettings: function () { return _cachedWorkspaceSettings; },
    getLocalStorage: function () { return typeof localStorage !== 'undefined' ? localStorage : null; }
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
    setActiveBoardId: function (v) { setActiveBoardIdState(v); },
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
    getMgmtPanelOpen: function() { return ManagementWiring ? ManagementWiring.getMgmtPanelOpen() : false; },
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
    syncSidebarToView: function() { syncSidebarToView(); },
    reorderRows: function(s, t, b) { return reorderRows(s, t, b); },
    moveStack: function(fr, fs, tr, ts, b) { return moveStack(fr, fs, tr, ts, b); },
    moveColumnWithinBoard: function(fr, fs, fc, tr, ts, tc, b) { return moveColumnWithinBoard(fr, fs, fc, tr, ts, tc, b); },
    getFullBoardData: function() { return fullBoardData; }
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
  if (_rt) _rt.setState('workspaceShellEnabled', workspaceShellEnabled);
  var SidebarResize = window.LexeraSidebarResize;
  var sidebarSplitRatio = Settings ? Settings.get('sidebarSplitRatio') : parseFloat(localStorage.getItem('lexera-sidebar-split-ratio') || '0.58');
  var sidebarWidth = Settings ? Settings.get('sidebarWidth') : (parseInt(localStorage.getItem('lexera-sidebar-width'), 10) || 0);
  var headerSearchExpanded = Settings ? Settings.get('headerSearchExpanded') : localStorage.getItem('lexera-header-search-expanded') === 'true';
  var _headerSavingInProgress = false;
  var suppressHeaderCreationClickUntil = 0;
  // activeHeaderSourceDropdown and HEADER_SOURCE_ENTITY_TYPES moved to hiddenItems/hiddenItemsDropdown.js
  var incomingCaptureCache = {
    items: [],
    loadedAt: 0,
    pending: null,
    available: true
  };
  // Board header constants/state moved to LexeraBoardHeader module
  var BoardHeader = window.LexeraBoardHeader;
  var $uiScale = 1;
  var dashboardState = {
    query: Settings ? Settings.get('dashboardQuery') : (localStorage.getItem('lexera-dashboard-query') || ''),
    scope: Settings ? (Settings.get('dashboardScope') === 'all' ? 'all' : 'active') : (localStorage.getItem('lexera-dashboard-scope') === 'all' ? 'all' : 'active'),
    pinnedQueries: [],
    activePinnedQuery: Settings ? Settings.get('dashboardActivePinned') : (localStorage.getItem('lexera-dashboard-active-pinned') || ''),
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
    var roots = registry.getRoots(kind);
    return Array.isArray(roots) ? roots : [];
  }

  window.addEventListener('lexera-shared-panel-created', function (event) {
    try {
      var detail = event && event.detail ? event.detail : {};
      if (detail.kind === 'hierarchy') syncMirroredWorkspaceViews();
      if (detail.kind === 'dashboard') syncMirroredDashboardViews();
      if (detail.kind === 'weekCalendar' || detail.kind === 'monthCalendar') {
        var calTasks = OrderHelpers.getCalendarTasks();
        if (calTasks && calTasks.length > 0) {
          OrderHelpers.renderStandaloneCalendarPanels(calTasks);
        } else {
          OrderHelpers.scheduleDashboardRefresh(0);
        }
      }
    } catch (err) {
      logFrontendIssue('error', 'event.panel-created', 'Error in shared panel created handler', err);
    }
  });

  window.addEventListener('storage', function (event) {
    try {
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
        dashboardState.query = Settings ? Settings.get('dashboardQuery') : (localStorage.getItem('lexera-dashboard-query') || '');
        dashboardState.scope = Settings ? (Settings.get('dashboardScope') === 'all' ? 'all' : 'active') : (localStorage.getItem('lexera-dashboard-scope') === 'all' ? 'all' : 'active');
        dashboardState.activePinnedQuery = Settings ? Settings.get('dashboardActivePinned') : (localStorage.getItem('lexera-dashboard-active-pinned') || '');
        dashboardState.pinnedQueries = loadDashboardPinnedQueries();
        renderDashboard();
        scheduleDashboardRefresh(0);
      }
      if (event.key === 'lexera-dock-panel' && event.newValue) {
        if (Settings) Settings.set('dockPanel', null); else localStorage.removeItem('lexera-dock-panel');
        var shell = window.LexeraWorkspaceShell;
        if (shell && typeof shell.revealPanel === 'function') {
          shell.revealPanel(event.newValue);
        }
      }
    } catch (err) {
      logFrontendIssue('error', 'event.storage', 'Error in storage event handler', err);
    }
  });

  // --- Appearance --- (delegated to LexeraAppearance module)
  var Appearance = window.LexeraAppearance;
  var THEMES = Appearance ? Appearance.THEMES : [];
  var VISUAL_THEMES = Appearance ? Appearance.VISUAL_THEMES : [];
  var VISUAL_THEME_LABELS = Appearance ? Appearance.VISUAL_THEME_LABELS : {};
  function applyVisualTheme(themeId) { return Appearance ? Appearance.applyVisualTheme(themeId) : null; }
  function applyTheme(themeId) { if (Appearance) Appearance.applyTheme(themeId); }
  function applySidebarTreeDisplayOptions(opts) { return Appearance ? Appearance.applySidebarTreeDisplayOptions(opts) : opts; }
  function getSidebarTreeDisplayOptions() { return Appearance ? Appearance.getSidebarTreeDisplayOptions() : { counts: true, presence: true, grips: true }; }
  function toggleSidebarTreeDisplayOption(key) { return Appearance ? Appearance.toggleSidebarTreeDisplayOption(key) : getSidebarTreeDisplayOptions(); }
  function buildSidebarHierarchyDisplayMenuItems() { return Appearance ? Appearance.buildSidebarHierarchyDisplayMenuItems() : []; }
  function normalizeUiScale(value) { return Appearance ? Appearance.normalizeUiScale(value) : 1; }
  function applyUiScale(scale) { if (Appearance) { Appearance.applyUiScale(scale); $uiScale = Appearance.getUiScale(); } }
  function getUiScalePercentLabel() { return Appearance ? Appearance.getUiScalePercentLabel() : '100%'; }
  function nudgeUiScale(delta) { var r = Appearance ? Appearance.nudgeUiScale(delta) : false; if (Appearance) $uiScale = Appearance.getUiScale(); return r; }
  function isOverlayEditorEnabled() { return Appearance ? Appearance.isOverlayEditorEnabled() : true; }
  function setOverlayEditorEnabled(v) { if (Appearance) Appearance.setOverlayEditorEnabled(v); }
  function isSpecialCharactersVisible() { return Appearance ? Appearance.isSpecialCharactersVisible() : false; }
  function applySpecialCharactersVisibilitySetting() { if (Appearance) Appearance.applySpecialCharactersVisibilitySetting(); }
  function setSpecialCharactersVisible(v) { if (Appearance) Appearance.setSpecialCharactersVisible(v); }
  function syncMenuCheckStates() { if (Appearance) Appearance.syncMenuCheckStates(); }

  // DOM refs — static elements use lazy-init getters (see top of file)
  // Dynamic elements (not in index.html) still need local lookup:
  var $searchContainer = document.querySelector('.search-container');
  var $searchInput = document.getElementById('search-input');
  var $searchToggleBtn = document.getElementById('btn-search-toggle');
  var BURGER_MENU_ICON_HTML = '<span class="burger-lines" aria-hidden="true"></span>';

  // Apply on load after DOM refs exist so board settings can safely re-apply theme-derived styles.
  if (Appearance) {
    Appearance.applyInitialSettings();
    $uiScale = Appearance.getUiScale();
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
      return Settings ? Settings.get('hierarchyLocked') : localStorage.getItem('lexera-hierarchy-locked') === 'true';
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
    invalidateBoardListFingerprint: function () { return _bl('invalidateBoardListFingerprint'); },
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
    get activeColMenu() { return _ColCtx ? _ColCtx.getActiveColMenu() : null; },
    get activeCardMenu() { return _CCM ? _CCM.getActiveCardMenu() : null; },
    get activeRowStackMenu() { return _RSM ? _RSM.getActiveRowStackMenu() : null; },
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
    get currentCardEditor() { return CardEditorModule ? CardEditorModule.getCurrentCardEditor() : null; },
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
    selectBoard: function (id, opts) { return selectBoard(id, opts); },
    showInFinder: function (p) { return showInFinder(p); },
    THEMES: THEMES,
    getLexeraCurrentThemeId: function () { return getLexeraCurrentThemeId(); },
    escapeAttr: function (v) { return escapeAttr(v); },
    escapeHtml: function (v) { return escapeHtml(v); },
    openManagementPanel: function (opts) { return openManagementPanel(opts); },
    setActiveBoardId: function (v) { setActiveBoardIdState(v); },
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
    getElDashboardEmbedsList: function () { return getElDashboardEmbedsList(); },
    getElDashboardUpcomingList: function () { return getElDashboardUpcomingList(); },
    getElDashboardTodosList: function () { return getElDashboardTodosList(); },
    getElDashboardTaggedList: function () { return getElDashboardTaggedList(); },
    getElDashboardBrokenList: function () { return getElDashboardBrokenList(); },
    getElDashboardIncludedList: function () { return getElDashboardIncludedList(); },
    getSharedPanelRoots: function (kind) { return getSharedPanelRoots(kind); },
    syncMirroredWorkspaceViews: function () { return syncMirroredWorkspaceViews(); },
    getDashboardTreeApi: function () { return getDashboardTreeApi(); },
    TreeView: TreeView,
    navigateToSearchResult: function (r) { return navigateToSearchResult(r); },
    requestFileInfo: function (b, f) { return requestFileInfo(b, f); },
    resolveMarkdownRelativeTargets: function (c, f) { return resolveMarkdownRelativeTargets(c, f); },
    parseMarkdownTarget: function (r) { return parseMarkdownTarget(r); },
    parseLocalFileReference: function (p) { return parseLocalFileReference(p); },
    isExternalHttpUrl: function (value) { return isExternalHttpUrl(value); },
    getFileExtension: function (path) { return getFileExtension(path); },
    getMediaCategory: function (ext) { return getMediaCategory(ext); }
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

  // ── Cached DOM element getters ──────────────────────────────────────
  function _cachedEl(key, id) {
    var c = _cachedEl._c || (_cachedEl._c = {});
    if (c[key] && c[key].isConnected) return c[key];
    c[key] = document.getElementById(id);
    return c[key];
  }
  function getElColumnsContainer() { return _cachedEl('cc', 'columns-container'); }
  function getElBoardList() { return _cachedEl('bl', 'board-list'); }
  function getElBoardHeader() { return _cachedEl('bh', 'board-header'); }
  function getElSidebar() { return document.querySelector('.layout > .sidebar') || document.querySelector('.sidebar'); }
  function getElSidebarHeader() { return document.querySelector('.sidebar-header'); }
  function getElSidebarDashboardDivider() { return _cachedEl('sdd', 'sidebar-dashboard-divider'); }
  function getElSidebarWidthDivider() { return _cachedEl('swd', 'sidebar-width-divider'); }
  function getElLayout() { return document.querySelector('.layout'); }
  function getElMainContent() { return _cachedEl('mc', 'main-content'); }
  function getElEmptyState() { return _cachedEl('es', 'empty-state'); }
  function getElSearchResults() { return _cachedEl('sr', 'search-results'); }
  function getElLogPanel() { return _cachedEl('lp', 'log-panel'); }
  var elLogSettingsContainer = null;
  var elLogSettingsPane = null;
  function getElLogSettingsContainer() {
    if (elLogSettingsContainer && document.body && document.body.contains(elLogSettingsContainer)) {
      return elLogSettingsContainer;
    }
    var shellContainer =
      document.querySelector('[data-shell-panel="backendSettings"] .lexera-shared-backend-settings-container') ||
      document.querySelector('.lexera-shared-backend-settings-container') ||
      document.getElementById('backend-settings-container');
    if (shellContainer) {
      elLogSettingsContainer = shellContainer;
      return shellContainer;
    }
    return null;
  }
  function getElMgmtPanel() { return _cachedEl('mp', 'mgmt-panel'); }
  function getElMgmtPanelBody() { return _cachedEl('mpb', 'mgmt-panel-body'); }
  function getElMgmtClose() { return _cachedEl('mgc', 'mgmt-close'); }
  function getElConnectionStatusBtn() { return _cachedEl('csb', 'btn-connection-status'); }
  function getElConnectionDot() { return _cachedEl('cd', 'connection-dot'); }
  function getElInspectorBtn() { return _cachedEl('ib', 'btn-inspector'); }
  function getElDashboardRoot() { return _cachedEl('dr', 'sidebar-dashboard'); }
  function getElDashboardSearchInput() { return _cachedEl('dsi', 'dashboard-search-input'); }
  function getElDashboardSearchBtn() { return _cachedEl('dsb', 'btn-dashboard-search'); }
  function getElDashboardScopeSelect() { return _cachedEl('dss', 'dashboard-scope-select'); }
  function getElDashboardPinBtn() { return _cachedEl('dpb', 'btn-dashboard-pin'); }
  function getElDashboardPinnedList() { return _cachedEl('dpl', 'dashboard-pinned-list'); }
  function getElDashboardResultsList() { return _cachedEl('drl', 'dashboard-results-list'); }
  function getElDashboardDeadlineList() { return _cachedEl('ddl', 'dashboard-deadline-list'); }
  function getElDashboardOverdueList() { return _cachedEl('dol', 'dashboard-overdue-list'); }
  function getElDashboardEmbedsList() { return _cachedEl('dembl', 'dashboard-embeds-list'); }
  function getElDashboardUpcomingList() { return _cachedEl('dul', 'dashboard-upcoming-list'); }
  function getElDashboardTodosList() { return _cachedEl('dtl', 'dashboard-todos-list'); }
  function getElDashboardTaggedList() { return _cachedEl('dtagl', 'dashboard-tagged-list'); }
  function getElDashboardBrokenList() { return _cachedEl('dbl', 'dashboard-broken-list'); }
  function getElDashboardIncludedList() { return _cachedEl('dfil', 'dashboard-included-list'); }

  function init() {
    try {
    window.__LEXERA_FRONTEND_BUILD = FRONTEND_BUILD_STAMP;

    // Startup health check — discover modules and report status
    if (_rt && typeof _rt.discoverModules === 'function') {
      _rt.discoverModules();
      var report = _rt.getStartupReport();
      traceFrontendAction('info', 'startup.modules',
        report.found.length + '/' + report.total + ' modules loaded' +
        (report.missing.length > 0 ? ', missing: ' + report.missing.join(', ') : ''),
        { found: report.found.length, missing: report.missing }
      );
    }

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

    // Init panels that may already exist after workspace shell restore.
    // Delay to let the first poll establish the backend connection.
    setTimeout(function () {
      if (ManagementWiring) ManagementWiring.initDelayedPanels();
    }, 3000);

    // Initialize HiddenItemsDropdown module
    if (window.HiddenItemsDropdown) {
      HiddenItemsDropdown.init({
        escapeHtml: escapeHtml,
        escapeAttr: escapeAttr,
        showNotification: showNotification,
        logFrontendIssue: logFrontendIssue,
        traceFrontendAction: traceFrontendAction,
        getActiveBoardId: function () { return activeBoardId; },
        getIncomingCaptureCache: function () { return incomingCaptureCache; },
        collectHiddenItems: collectHiddenItems,
        buildHiddenItemLocation: buildHiddenItemLocation,
        updateHiddenItemTag: updateHiddenItemTag,
        captureStableHiddenItemRestoreTarget: captureStableHiddenItemRestoreTarget,
        restoreHiddenItemToCapturedTarget: restoreHiddenItemToCapturedTarget,
        getCreationEntityLabel: getCreationEntityLabel,
        buildCreationEntityDragIconHtml: buildCreationEntityDragIconHtml,
        resolveCardDropTarget: resolveCardDropTarget,
        showCardDropIndicator: showCardDropIndicator,
        clearCardDropIndicators: clearCardDropIndicators,
        clearCardDragOverHighlights: clearCardDragOverHighlights,
        clearHeaderDropTargetHighlights: clearHeaderDropTargetHighlights,
        clearSidebarDropHighlights: clearSidebarDropHighlights,
        insertDropZoneIndicators: insertDropZoneIndicators,
        removeDropZoneIndicators: removeDropZoneIndicators,
        clearPtrDropIndicators: clearPtrDropIndicators,
        updatePtrDropTargetByType: updatePtrDropTargetByType,
        insertStackDropZones: insertStackDropZones,
        removeStackDropZones: removeStackDropZones,
        getElColumnsContainer: getElColumnsContainer,
        isPointInsideRect: isPointInsideRect,
        resolveHeaderCardCreationContext: resolveHeaderCardCreationContext,
        resolveHeaderColumnCreationContext: resolveHeaderColumnCreationContext,
        resolveHeaderStackCreationContext: resolveHeaderStackCreationContext,
        resolveHeaderRowCreationContext: resolveHeaderRowCreationContext,
        resolveHeaderCreationContext: resolveHeaderCreationContext,
        handleCreationAction: handleCreationAction,
        getHeaderCreationDragIndicatorType: getHeaderCreationDragIndicatorType,
        updateHeaderCreationDragVisualsForTarget: updateHeaderCreationDragVisualsForTarget,
        clearHeaderCreationDragVisuals: clearHeaderCreationDragVisuals,
        addCardToActiveBoard: addCardToActiveBoard,
        addRowFromContent: addRowFromContent,
        addStackFromContent: addStackFromContent,
        addColumnFromContent: addColumnFromContent,
        sanitizeBuiltInDiagramFileName: sanitizeBuiltInDiagramFileName,
        createBuiltInNamedFile: createBuiltInNamedFile,
        refreshIncomingCaptureCache: refreshIncomingCaptureCache,
        refreshBoardHeaderActionStates: refreshBoardHeaderActionStates,
        formatIncomingCaptureTimestamp: formatIncomingCaptureTimestamp,
        summarizeIncomingCaptureEntry: summarizeIncomingCaptureEntry,
        prioritizeDrawioAndExcalidrawTemplates: prioritizeDrawioAndExcalidrawTemplates
      });
    }

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

    poll().catch(function (err) {
      logFrontendIssue('error', 'init.poll', 'Initial poll failed', err);
    });
    // Embedded iframes only delta-sync their own board — no workspace/board
    // list/remote-boards fetching — so they can poll much less frequently.
    var pollMs = embeddedMode ? 15000 : 5000;
    pollInterval = setInterval(function () {
      poll().catch(function (err) {
        logFrontendIssue('error', 'poll.interval', 'Poll interval failed', err);
      });
    }, pollMs);
    } catch (err) {
      logFrontendIssue('error', 'init', 'App initialization failed — some features may be unavailable', err);
      // Still try to start polling so boards can load even if UI setup partially failed
      try {
        poll().catch(function () {});
        if (!pollInterval) pollInterval = setInterval(function () { poll().catch(function () {}); }, embeddedMode ? 15000 : 5000);
      } catch (err) {
        logFrontendIssue('error', 'init.poll.recovery', 'Failed to start recovery poll after init error', err);
      }
    }
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
  function selectCard(cardEl) {
    if (KeyboardNav) KeyboardNav.selectCard(cardEl);
  }
  function toggleCardSelection(cardEl) {
    if (KeyboardNav) KeyboardNav.toggleCardSelection(cardEl);
  }
  function selectCardRange(cardEl) {
    if (KeyboardNav) KeyboardNav.selectCardRange(cardEl);
  }
  function clearCardSelection() {
    if (KeyboardNav) KeyboardNav.clearSelection();
  }
  function getSelectedCardEls() {
    return KeyboardNav ? KeyboardNav.getSelectedCardEls() : [];
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

  function getRemoteBoardPresenceCount(boardId) {
    var onlineUsers = boardPresenceCache[boardId];
    if (!Array.isArray(onlineUsers) || onlineUsers.length === 0) return 0;
    var remoteCount = 0;
    for (var i = 0; i < onlineUsers.length; i++) {
      if (!onlineUsers[i] || onlineUsers[i] === syncUserId) continue;
      remoteCount++;
    }
    return remoteCount;
  }

  function shouldLiveSyncCardDraft(boardId) {
    return canUseLiveSync(boardId) && getRemoteBoardPresenceCount(boardId) > 0;
  }

  function shouldBroadcastEditingPresence(boardId) {
    return !!(
      boardId &&
      LexeraApi.isSyncConnected() &&
      getRemoteBoardPresenceCount(boardId) > 0
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

  function applyBoardToLiveSyncSession(boardId, boardData, options) {
    var result;
    liveSyncMutex = liveSyncMutex.then(function () {
      return _applyBoardToLiveSyncSessionCore(boardId, boardData, options).then(function (r) { result = r; });
    }).catch(function (err) {
      traceFrontendAction('error', 'liveSync.apply', 'Mutex-wrapped apply failed', { error: String(err) });
      result = false;
    });
    return liveSyncMutex.then(function () { return result; });
  }

  async function _applyBoardToLiveSyncSessionCore(boardId, boardData, options) {
    options = options || {};
    if (!canUseLiveSync(boardId)) return false;
    var session = getLiveSyncSession(boardId);
    if (!session) return false;

    traceFrontendAction('debug', 'liveSync.apply', 'Sending board to live sync', { board: boardCardSummary(boardData), sessionBoard: boardCardSummary(session.board) });
    traceBoardIdentityPair('info', 'liveSync.apply', 'Applying local board into live sync session', boardId, 'local', boardData, 'session', session.board, {
      vvLength: session.vv ? session.vv.length : 0
    });
    var response = await LexeraApi.applyLiveSyncBoard(session.sessionId, boardData);
    if (response && response.vv) session.vv = response.vv;
    if (response && response.board) session.board = response.board;
    traceFrontendAction('debug', 'liveSync.apply', 'Live sync response received', { changed: response && response.changed, responseBoard: boardCardSummary(response && response.board), updatesLen: response && response.updates ? response.updates.length : 0 });
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
        traceFrontendAction('warn', 'liveSync.apply', 'sendSyncUpdate failed', { updatesLen: response.updates.length });
        return false;
      }
      traceFrontendAction('debug', 'liveSync.apply', 'Sent WS sync update', { updatesLen: response.updates.length });
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

  function flushPendingLiveSyncUpdates(options) {
    var result;
    liveSyncMutex = liveSyncMutex.then(function () {
      return _flushPendingLiveSyncUpdatesCore(options).then(function (r) { result = r; });
    }).catch(function (err) {
      traceFrontendAction('error', 'liveSync.flush', 'Mutex-wrapped flush failed', { error: String(err) });
      result = false;
    });
    return liveSyncMutex.then(function () { return result; });
  }

  async function _flushPendingLiveSyncUpdatesCore(options) {
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
    if (!shouldLiveSyncCardDraft(activeBoardId) || !fullBoardData) return false;
    var draftBoard = cloneBoardWithDraftCardContent(fullBoardData, colIndex, fullCardIdx, content);
    if (!draftBoard) return false;
    return applyBoardToLiveSyncSession(activeBoardId, draftBoard, { skipBoardReplace: true });
  }

  function queueCardDraftLiveSync(colIndex, fullCardIdx, content) {
    if (!shouldLiveSyncCardDraft(activeBoardId)) return;
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
    }, LIVE_DRAFT_SYNC_DEBOUNCE_MS);
  }

  async function revertCardDraftLiveSync(colIndex, fullCardIdx, originalContent) {
    clearPendingCardDraftSync();
    if (!shouldLiveSyncCardDraft(activeBoardId)) return false;
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
    try {
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
      syncRuntimeState('boardPresenceCache', boardPresenceCache);
      syncFoldedLogStatusBadges();
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
    } catch (err) {
      logFrontendIssue('error', 'sync.connect', 'Failed to connect sync for board ' + boardId, err);
    }
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
    if (!cardKid || !shouldBroadcastEditingPresence(activeBoardId)) return;
    editingPresenceRequest = { cardKid: cardKid, cursorPos: cursorPos, isTyping: isTyping };
    if (editingPresenceTimer) return;
    editingPresenceTimer = setTimeout(function () {
      editingPresenceTimer = null;
      var req = editingPresenceRequest;
      editingPresenceRequest = null;
      if (!req) return;
      try {
        LexeraApi.sendEditingPresence(req.cardKid, syncUserName || syncUserId, req.cursorPos, req.isTyping);
      } catch (err) {
        logFrontendIssue('warn', 'presence.send', 'Failed to send editing presence', err);
      }
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
    if (ManagementWiring && ManagementWiring.handleSSEManagementEvent(kind)) return;
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
        updateSyncStatusIndicator('syncing');
        Promise.resolve()
          .then(function () { return loadBoard(activeBoardId); })
          .then(function () { updateSyncStatusIndicator('connected'); })
          .catch(function (err) {
            logFrontendIssue('warn', 'sse.fileChanged.reload', 'Failed to reload clean board after external change', err);
            showNotification('Board file changed on disk. Reload failed.');
            updateSyncStatusIndicator('connected');
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
      updateSyncStatusIndicator('syncing');
      Promise.resolve()
        .then(function () { return rebaseDirtyBoardFromServer(kind); })
        .then(function () { updateSyncStatusIndicator('connected'); })
        .catch(function (err) {
          logFrontendIssue('warn', 'sse.fileChanged.rebase', 'Failed to rebase dirty board after external change', err);
          showNotification('Board file changed on disk. Rebase failed; your local draft was kept.');
          updateSyncStatusIndicator('connected');
        });
    }
    if (kind === 'Resync') {
      traceFrontendAction('warn', 'sse.resync', 'SSE client lagged — performing full board reload', {
        boardId: activeBoardId
      });
      if (activeBoardId) {
        updateSyncStatusIndicator('syncing');
        Promise.resolve()
          .then(function () { return loadBoard(activeBoardId); })
          .then(function () { updateSyncStatusIndicator('connected'); })
          .catch(function (err) {
            logFrontendIssue('warn', 'sse.resync', 'Failed to reload board after SSE resync', err);
            updateSyncStatusIndicator('connected');
          });
      }
    }
    } catch (err) {
      logFrontendIssue('error', 'sse', 'Error in handleSSEEvent', err);
    }
  }

  // --- Polling --- (delegated to LexeraPollingService module)
  var PollingService = window.LexeraPollingService;
  if (PollingService) PollingService.init({
    LexeraApi: LexeraApi,
    WorkspaceShell: WorkspaceShell,
    get connected() { return connected; },
    get activeBoardId() { return activeBoardId; },
    get fullBoardData() { return fullBoardData; },
    get boards() { return boards; },
    get remoteBoards() { return remoteBoards; },
    get searchMode() { return searchMode; },
    get isEditing() { return isEditing; },
    get workspaceShellEnabled() { return workspaceShellEnabled; },
    get embeddedMode() { return embeddedMode; },
    get embeddedPreferredBoardId() { return embeddedPreferredBoardId; },
    get urlParams() { return urlParams; },
    get _lastLoadedRevision() { return _lastLoadedRevision; },
    get _lastLoadedGeneration() { return _lastLoadedGeneration; },
    setConnectedState: function (v) { connected = v; if (_rt) _rt.setState('connected', v); if (!_headerSavingInProgress) updateSyncStatusIndicator(v ? 'connected' : 'disconnected'); if (v) { refreshWorkspaceSettings(); OrderHelpers.refreshDashboardTagsFromBackend(); } },
    setWorkspaces: function (v) { workspaces = v; if (_rt) _rt.setState('workspaces', v); },
    setBoards: function (v) { boards = v; if (_rt) _rt.setState('boards', v); },
    setRemoteBoards: function (v) { remoteBoards = v; if (_rt) _rt.setState('remoteBoards', v); },
    setActiveBoardId: function (v) { setActiveBoardIdState(v); },
    setActiveBoardData: function (v) { activeBoardData = v; if (_rt) _rt.setState('activeBoardData', v); },
    setFullBoardData: function (v) { fullBoardData = v; if (_rt) _rt.setState('fullBoardData', v); },
    setLastLoadedGeneration: function (v) { _lastLoadedGeneration = v; },
    setLastLoadedRevision: function (v) { _lastLoadedRevision = v; },
    connectSSEIfReady: function () { connectSSEIfReady(); },
    connectBackendLogStreamIfReady: function () { connectBackendLogStreamIfReady(); },
    loadTemplatesOnce: function () { loadTemplatesOnce(); },
    getElConnectionStatusBtn: function () { return getElConnectionStatusBtn(); },
    getElConnectionDot: function () { return getElConnectionDot(); },
    resolveActiveWorkspaceId: function (id) { resolveActiveWorkspaceId(id); },
    renderWorkspaceSelect: function () { renderWorkspaceSelect(); },
    refreshBoardHierarchyCache: function (bl) { return refreshBoardHierarchyCache(bl); },
    renderBoardList: function () { renderBoardList(); },
    setShellActiveBoard: function (id) { setShellActiveBoard(id); },
    findBoardMeta: function (id) { return findBoardMeta(id); },
    refreshHeaderFileControls: function () { refreshHeaderFileControls(); },
    scheduleDashboardRefresh: function (ms) { scheduleDashboardRefresh(ms); },
    isBoardDirty: function () { return isBoardDirty(); },
    loadBoard: function (id) { return loadBoard(id); },
    applyPollingBoardDelta: function (boardId, payload) { return applyPollingBoardDelta(boardId, payload); },
    renderMainView: function () { renderMainView(); },
    selectBoard: function (id) { return selectBoard(id); },
    closeLiveSyncSession: function (id) { return closeLiveSyncSession(id); },
    isActiveRemoteBoard: function () { return isActiveRemoteBoard(); },
    summarizeBoardHierarchy: function (d) { return summarizeBoardHierarchy(d); },
    logFrontendIssue: function (level, target, msg, err) { logFrontendIssue(level, target, msg, err); },
    traceFrontendAction: function (level, target, msg, details) { traceFrontendAction(level, target, msg, details); }
  });

  function poll() { if (PollingService) return PollingService.poll(); }
  function setConnected(state) { if (PollingService) PollingService.setConnected(state); }
  function syncConnectionStatusButton(buttonEl, dotEl, state) { if (PollingService) PollingService.syncConnectionStatusButton(buttonEl, dotEl, state); }

  // --- Board List --- (delegated to LexeraBoardList module)

  var BoardList = window.LexeraBoardList;
  if (BoardList) BoardList.init({
    get activeBoardId() { return activeBoardId; },
    get fullBoardData() { return fullBoardData; },
    get activeBoardData() { return activeBoardData; },
    get boards() { return boards; },
    get remoteBoards() { return remoteBoards; },
    get workspaces() { return workspaces; },
    get activeWorkspaceId() { return activeWorkspaceId; },
    get liveSyncState() { return liveSyncState; },
    get boardPresenceCache() { return boardPresenceCache; },
    get workspaceShellEnabled() { return workspaceShellEnabled; },
    get hasTauri() { return hasTauri; },
    get _lastLoadedRevision() { return _lastLoadedRevision; },
    get _saveInFlight() { return _saveInFlight; },
    LexeraApi: LexeraApi,
    TreeView: TreeView,
    SidebarSync: window.LexeraSidebarSync,
    WorkspaceShell: window.LexeraWorkspaceShell,
    ALL_WORKSPACES_ID: ALL_WORKSPACES_ID,
    isBoardDirty: function() { return isBoardDirty(); },
    clearBoardDirty: function() { clearBoardDirty(); },
    markBoardDirty: function() { markBoardDirty(); },
    selectBoard: function(boardId) { selectBoard(boardId); },
    setLastLoadedRevision: function(rev) { _lastLoadedRevision = rev; },
    setLastLoadedGeneration: function(generation) { _lastLoadedGeneration = generation; },
    setActiveBoardId: function(boardId) { setActiveBoardIdState(boardId); },
    setActiveBoardData: function(boardData) { activeBoardData = boardData; if (_rt) _rt.setState('activeBoardData', boardData); },
    setFullBoardData: function(boardData) { fullBoardData = boardData; if (_rt) _rt.setState('fullBoardData', boardData); },
    setBoards: function(nextBoards) { boards = nextBoards; if (_rt) _rt.setState('boards', nextBoards); },
    setActiveWorkspaceIdState: function(id) { activeWorkspaceId = id; if (_rt) _rt.setState('activeWorkspaceId', id); refreshWorkspaceSettings(); OrderHelpers.refreshDashboardTagsFromBackend(); },
    setPendingExternalRebaseConflict: function(conflict) { pendingExternalRebaseConflict = conflict; },
    tauriInvoke: function(cmd, args) { return window.__TAURI__ && window.__TAURI__.core.invoke(cmd, args); },
    getSidebarTreeApi: function() { return getSidebarTreeApi(); },
    stripLayoutTags: function(text) { return stripLayoutTags(text); },
    getDisplayOrderedColumnEntries: function(cols, opts) { return getDisplayOrderedColumnEntries(cols, opts); },
    getOrderedItems: function(items, key, fn) { return getOrderedItems(items, key, fn); },
    getAllColumnsFromBoardData: function(boardData) { return getAllColumnsFromBoardData(boardData); },
    getMutationBoardTitle: function(boardId, boardData) { return getMutationBoardTitle(boardId, boardData); },
    getDisplayNameFromPath: function(filePath) { return getDisplayNameFromPath(filePath); },
    getCreationEntityDragIconSvg: function(type) { return getCreationEntityDragIconSvg(type); },
    getSharedPanelRoots: function(kind) { return getSharedPanelRoots(kind); },
    isRemoteBoardId: function(boardId) { return isRemoteBoardId(boardId); },
    hasTag: function(text, tag) { return hasTag(text, tag); },
    stripStackTag: function(title) { return stripStackTag(title); },
    ensureBoardRowsForMutation: function(boardData, title) { ensureBoardRowsForMutation(boardData, title); },
    updateDisplayFromFullBoard: function() { updateDisplayFromFullBoard(); },
    logFrontendIssue: function(level, target, msg, err) { logFrontendIssue(level, target, msg, err); },
    traceFrontendAction: function(level, target, msg, details) { traceFrontendAction(level, target, msg, details); },
    applyBoardSettings: function() { applyBoardSettings(); },
    renderColumns: function() { renderColumns(); },
    renderBoardList: function() { renderBoardList(); },
    renderMainView: function() { renderMainView(); },
    refreshHeaderFileControls: function() { refreshHeaderFileControls(); },
    scheduleDashboardRefresh: function(ms) { scheduleDashboardRefresh(ms); },
    showNotification: function(msg) { showNotification(msg); },
    showConfirmDialog: function(msg) { return showConfirmDialog(msg); },
    showExternalRebaseConflictDialog: function(result) { showExternalRebaseConflictDialog(result); },
    escapeHtml: function(text) { return escapeHtml(text); },
    exitSearchMode: function() { exitSearchMode(); },
    showNativeMenu: function(items, x, y) { return showNativeMenu(items, x, y); },
    showElementContextMenu: function(scope, x, y, ctx) { showElementContextMenu(scope, x, y, ctx); },
    openConnectionWindow: function() { openConnectionWindow(); },
    showInFinder: function(filePath) { showInFinder(filePath); },
    poll: function() { poll(); },
    applyVisualTheme: function(themeId) { applyVisualTheme(themeId); },
    showSidebarHierarchyMenu: function(anchor) { showSidebarHierarchyMenu(anchor); },
    buildHierarchyFocusTargetFromTreeNode: function(node, boardId) { return buildHierarchyFocusTargetFromTreeNode(node, boardId); },
    navigateToHierarchyTarget: function(target) { return navigateToHierarchyTarget(target); },
    targetClosest: function(target, selector) { return targetClosest(target, selector); },
    cleanupBoardBeforeSidebarClose: function(boardId) { return cleanupBoardBeforeSidebarClose(boardId); },
    updateCardElementInPlace: function(colIndex, visibleCardIndex) { updateCardElementInPlace(colIndex, visibleCardIndex); },
    findVisibleCardIndexById: function(colIndex, cardId) { return findVisibleCardIndexById(colIndex, cardId); },
    updateColumnCountBadge: function(colIndex) { updateColumnCountBadge(colIndex); }
  });
  // Safe BoardList delegate — returns undefined if BoardList not yet loaded
  function _bl(method) {
    if (!BoardList || typeof BoardList[method] !== 'function') return undefined;
    var args = Array.prototype.slice.call(arguments, 1);
    return BoardList[method].apply(BoardList, args);
  }

  function getSidebarExpandedBoards() { return _bl('getSidebarExpandedBoards'); }
  function saveSidebarExpandedBoards(ids) { _bl('saveSidebarExpandedBoards', ids); }
  function getSidebarTreeState(boardId) { return _bl('getSidebarTreeState', boardId); }
  function hasSidebarTreeState(boardId) { return _bl('hasSidebarTreeState', boardId); }
  function saveSidebarTreeState(boardId, state) { _bl('saveSidebarTreeState', boardId, state); }
  function getSidebarTreeChildrenContainer(node) { return _bl('getSidebarTreeChildrenContainer', node); }
  function getSidebarTreeOwnerNode(container) { return _bl('getSidebarTreeOwnerNode', container); }
  function toggleSidebarTreeNode(boardId, kind, id) { _bl('toggleSidebarTreeNode', boardId, kind, id); }
  function setDescendantTreeState(container, expand, boardId) { _bl('setDescendantTreeState', container, expand, boardId); }
  function buildSidebarTreeNodes(rows, boardId, treeState, hasTreeState) { return _bl('buildSidebarTreeNodes', rows, boardId, treeState, hasTreeState); }
  function countCardsInRow(row) { return _bl('countCardsInRow', row); }
  function countCardsInStack(stack) { return _bl('countCardsInStack', stack); }
  function countCardsInRows(rows) { return _bl('countCardsInRows', rows); }
  function cloneRows(rows) { return _bl('cloneRows', rows); }
  function cloneBoardData(boardData) { return _bl('cloneBoardData', boardData); }
  function boardDraftStorageKey(boardId) { return _bl('boardDraftStorageKey', boardId); }

  function getBoardCardKids(boardData) { return _bl('getBoardCardKids', boardData); }
  function getBoardCardIdentityStats(boardA, boardB) { return _bl('getBoardCardIdentityStats', boardA, boardB); }
  function summarizeBoardIdentity(boardData, limit) { return _bl('summarizeBoardIdentity', boardData, limit); }
  function describeBoardIdentityPair(labelA, boardA, labelB, boardB, limit) { return _bl('describeBoardIdentityPair', labelA, boardA, labelB, boardB, limit); }
  function traceBoardIdentityPair(level, target, message, boardId, labelA, boardA, labelB, boardB, extra) { _bl('traceBoardIdentityPair', level, target, message, boardId, labelA, boardA, labelB, boardB, extra); }
  function hasBoardIdentityMismatch(boardA, boardB) { return _bl('hasBoardIdentityMismatch', boardA, boardB); }
  function saveLocalBoardDraft(boardId, boardData) { _bl('saveLocalBoardDraft', boardId, boardData); }
  function loadLocalBoardDraft(boardId) { return _bl('loadLocalBoardDraft', boardId); }
  function clearLocalBoardDraft(boardId) { _bl('clearLocalBoardDraft', boardId); }
  function boardCardSummary(bd) { return _bl('boardCardSummary', bd); }
  function setBoardSaveBase(boardData, baseBoardData) { return _bl('setBoardSaveBase', boardData, baseBoardData); }
  function getBoardSaveBase(boardData) { return _bl('getBoardSaveBase', boardData); }
  function resolveSavedBoardData(boardData, result, boardId) { return _bl('resolveSavedBoardData', boardData, result, boardId); }
  function resolveLiveSyncBoardData(boardData, boardId) { return _bl('resolveLiveSyncBoardData', boardData, boardId); }

  function applyLiveSyncBoardSnapshot(boardId, boardData, options) { _bl('applyLiveSyncBoardSnapshot', boardId, boardData, options); }
  function applyRebasedBoardSnapshot(boardId, workingBoard, currentBoard, result, options) { _bl('applyRebasedBoardSnapshot', boardId, workingBoard, currentBoard, result, options); }
  async function rebaseDirtyBoardFromServer(triggerKind) { return _bl('rebaseDirtyBoardFromServer', triggerKind); }
  function rowsFromLegacyColumns(columns, boardTitle) { return _bl('rowsFromLegacyColumns', columns, boardTitle); }
  function rowsForBoardData(fullBoard, fallbackTitle) { return _bl('rowsForBoardData', fullBoard, fallbackTitle); }

  function setBoardHierarchyRows(boardId, fullBoard, fallbackTitle) { _bl('setBoardHierarchyRows', boardId, fullBoard, fallbackTitle); }
  function getBoardHierarchyRows(boardId) { return _bl('getBoardHierarchyRows', boardId); }
  async function refreshBoardHierarchyCache(boardList) { return _bl('refreshBoardHierarchyCache', boardList); }
  function cardPreviewText(content) { return _bl('cardPreviewText', content); }
  function setActiveWorkspaceId(workspaceId) { _bl('setActiveWorkspaceId', workspaceId); }
  function resolveActiveWorkspaceId(defaultWorkspaceId) { _bl('resolveActiveWorkspaceId', defaultWorkspaceId); }
  function dispatchMirrorMouseEvent(targetEl, eventType, sourceEvent) { return _bl('dispatchMirrorMouseEvent', targetEl, eventType, sourceEvent); }
  function findCanonicalHierarchyTarget(sourceTarget) { return _bl('findCanonicalHierarchyTarget', sourceTarget); }
  function bindMirroredWorkspaceView(rootEl) { _bl('bindMirroredWorkspaceView', rootEl); }
  function syncMirroredWorkspaceViews() { _bl('syncMirroredWorkspaceViews'); }

  function renderWorkspaceSelect() { _bl('renderWorkspaceSelect'); }
  function getBoardWorkspaceIds(board) { return _bl('getBoardWorkspaceIds', board); }
  async function removeBoardFromSidebar(boardId, boardName) { return _bl('removeBoardFromSidebar', boardId, boardName); }

  function renderBoardList() { _bl('renderBoardList'); }

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
      try { await saveFullBoard(); } catch (saveErr) { console.warn('[board-switch] auto-save failed, retry will handle:', saveErr); }
    }
    setActiveBoardIdState(boardId);
    activeBoardData = null;
    fullBoardData = null;
    pendingExternalRebaseConflict = null;
    _lastLoadedGeneration = null;
    _lastLoadedRevision = null;
    addCardColumn = null;
    resetBoardDirtyState('selectBoard-switch', boardId);
    if (!embeddedMode) {
      if (Settings) Settings.set('lastBoard', boardId); else localStorage.setItem('lexera-last-board', boardId);
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
    if (!embeddedMode) renderBoardList();
    refreshHeaderFileControls();
    if (!options.skipLoad) {
      await loadBoard(boardId);
      // Schedule dashboard refresh AFTER board is loaded — avoids race
      // where dashboard queries while fullBoardData is still null
      if (!embeddedMode) scheduleDashboardRefresh(60);
    } else {
      if (!embeddedMode) scheduleDashboardRefresh(60);
    }
  }

  async function loadBoard(boardId) {
    var seq = ++boardLoadSeq;
    var isBoardSwitch = boardId !== activeBoardId;
    if (BoardStatsFilter) BoardStatsFilter.resetState();
    if (_ColCtx) _ColCtx.resetColumnSortState();
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
      // Draft restore only makes sense on board switches (opening a board for
      // the first time or navigating to a different one).  When the same board
      // is reloaded (poll, SSE file-changed from remote peer), any draft is
      // from the current editing session — clear it so it doesn't trigger a
      // spurious restore prompt.  Crash recovery still works: the next time
      // the app starts and opens this board, isBoardSwitch will be true.
      if (!isBoardSwitch && draftSnapshot) {
        clearLocalBoardDraft(boardId);
        draftSnapshot = null;
        traceFrontendAction('info', 'board.draft.sessionClear',
          'Cleared current-session draft during board reload (not a board switch)', { boardId: boardId });
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

  function renderBoardHeader() { if (BoardHeader) BoardHeader.renderBoardHeader(); }

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

  function getCreationEntityLabel(entityType) { return BoardHeader ? BoardHeader.getCreationEntityLabel(entityType) : 'Card'; }

  function getCreationEntityDragIconSvg(entityType) { return BoardHeader ? BoardHeader.getCreationEntityDragIconSvg(entityType) : ''; }

  function buildCreationEntityDragIconHtml(entityType, extraAttrs) { return BoardHeader ? BoardHeader.buildCreationEntityDragIconHtml(entityType, extraAttrs) : ''; }

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

  function buildLayoutPresetMenuItems() { return BoardHeader ? BoardHeader.buildLayoutPresetMenuItems() : []; }

  function buildTagStyleRoleItems(normalizedTag) { return BoardHeader ? BoardHeader.buildTagStyleRoleItems(normalizedTag) : []; }


  // ── Board setting normalizers (delegated to LexeraBoardSettings module) ──
  function normalizeBoardFontSizeValue(rawValue) { return BoardSettingsModule.normalizeBoardFontSizeValue(rawValue); }
  function normalizeBoardFontFamilyToken(rawValue) { return BoardSettingsModule.normalizeBoardFontFamilyToken(rawValue); }
  function resolveBoardFontFamilyValue(token) { return BoardSettingsModule.resolveBoardFontFamilyValue(token); }
  function normalizeWhitespaceValue(rawValue) { return BoardSettingsModule.normalizeWhitespaceValue(rawValue); }


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
    if (ManagementWiring) return ManagementWiring.openRunningProcessesPanel();
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
    // Redirect to Frontend Settings panel — theme/zoom/sidebar settings live there now
    handleBoardAction('open-frontend-settings');
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

  function buildHeaderCreationTemplateSubmenu(actionPrefix, entityType, templates) { return BoardHeader ? BoardHeader.buildHeaderCreationTemplateSubmenu(actionPrefix, entityType, templates) : { id: actionPrefix + '-submenu-' + entityType, label: entityType, items: [] }; }

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

  function resolveHeaderCardCreationContext(mx, my) { return BoardHeader ? BoardHeader.resolveHeaderCardCreationContext(mx, my) : null; }
  function resolveHeaderColumnCreationContext(mx, my) { return BoardHeader ? BoardHeader.resolveHeaderColumnCreationContext(mx, my) : null; }
  function resolveHeaderStackCreationContext(mx, my) { return BoardHeader ? BoardHeader.resolveHeaderStackCreationContext(mx, my) : null; }
  function resolveHeaderRowCreationContext(mx, my) { return BoardHeader ? BoardHeader.resolveHeaderRowCreationContext(mx, my) : null; }
  function resolveHeaderCreationDropTarget(mx, my) { return BoardHeader ? BoardHeader.resolveHeaderCreationDropTarget(mx, my) : null; }
  function clearHeaderCreationDragVisuals() { if (BoardHeader) BoardHeader.clearHeaderCreationDragVisuals(); }

  function getHeaderCreationDragIndicatorType(entityType) { return BoardHeader ? BoardHeader.getHeaderCreationDragIndicatorType(entityType) : null; }
  function updateHeaderCreationDragVisualsForTarget(target, mx, my) { return BoardHeader ? BoardHeader.updateHeaderCreationDragVisualsForTarget(target, mx, my) : false; }
  function getHeaderCreationDragLabel(mode, target) { return BoardHeader ? BoardHeader.getHeaderCreationDragLabel(mode, target) : ''; }

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

  function attachHeaderCreationDragSource(btn, mode) { if (BoardHeader) BoardHeader.attachHeaderCreationDragSource(btn, mode); }

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

  function refreshBoardHeaderActionStates() { if (BoardHeader) BoardHeader.refreshBoardHeaderActionStates(); }

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
    renderFrontendSettingsPanel();
    if (_rt) _rt.emit('setting:changed', { key: key, value: value, source: 'board' });
    return true;
  }

  function normalizeYamlFrontmatterScalar(value) { return BoardSettingsModule.normalizeYamlFrontmatterScalar(value); }

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

  // togglePinnedHeaders removed — column headers are always sticky at top

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

  function showFilenameContextMenu(x, y) {
    var filePath = getActiveBoardFilePath();
    var items = [
      { id: 'rename-file', label: 'Rename File' }
    ];
    if (filePath) {
      items.push(
        { id: 'show-in-finder', label: 'Show in Finder' },
        { id: 'open-in-default-app', label: 'Open in Default App' }
      );
    }
    showNativeMenu(items, x, y, 'header.filename').then(function (action) {
      if (action === 'rename-file') renameActiveBoardFile();
      else if (action === 'show-in-finder' && filePath) showInFinder(filePath);
      else if (action === 'open-in-default-app' && filePath) {
        if (hasTauri) {
          tauriInvoke('open_with_default_app', { path: filePath }).catch(function (err) {
            showNotification('Failed to open file: ' + err);
          });
        }
      }
    });
  }

  async function showFileHeaderSettingsMenu(btnElement, forcedX, forcedY) {
    if (!btnElement) return;
    // Refresh tool status in background — don't block menu from showing
    refreshExportToolStatus('pandoc', false).catch(function () {});
    refreshEmbeddedRendererStatuses(false).catch(function () {});
    refreshAvailableMarpClasses(false).catch(function () {});
    var isCanvasLayout = isCanvasBoardLayout();
    var items = [
      // Per-board layout overrides (stored in YAML header)
      { id: 'set-board-layout', label: 'Board Layout', items: buildSettingMenuItems('boardLayout') },
      { id: 'set-column-width', label: 'Column Width', items: buildSettingMenuItems('columnWidth') },
      { id: 'set-card-height', label: 'Card Height', items: buildSettingMenuItems('cardHeight') },
      { id: 'set-font-size', label: 'Font Size', items: buildSettingMenuItems('fontSize') },
      { id: 'set-font-family', label: 'Font Family', items: buildSettingMenuItems('fontFamily') },
      { id: 'set-whitespace', label: 'Whitespace', items: buildSettingMenuItems('whitespace') },
      { id: 'set-tag-style-preset', label: 'Tag Style', items: buildSettingMenuItems('tagStylePreset') }
    ];
    if (isCanvasLayout) {
      items.push({ id: 'set-canvas-grid', label: 'Canvas Grid', items: buildSettingMenuItems('canvasGrid') });
    }
    items.push(
      { separator: true },
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
    );
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

    var isCanvasLayout = isCanvasBoardLayout();
    var htmlContentMode = getBoardSettingValue('htmlContentRenderMode', 'html');
    var items = [
      // Quick settings
      { id: 'set-column-width', label: 'Column Width', items: buildSettingMenuItems('columnWidth') },
      { id: 'set-tag-visibility', label: 'Tag Visibility', items: buildSettingMenuItems('tagVisibility') },
      { id: 'set-html-comments', label: 'HTML Comments', items: buildSettingMenuItems('htmlComments') },
      { id: 'set-html-content', label: 'HTML Content', items: buildSettingMenuItems('htmlContent') },
      { id: 'toggle-special-chars', label: 'Show Special Characters', checked: isSpecialCharactersVisible() },
      { id: 'toggle-overlay-editor', label: 'Overlay Editor', checked: isOverlayEditorEnabled() },
      { separator: true },
      // Actions
      { id: 'export-board', label: 'Export' }
    ];
    if (isCanvasLayout) {
      items.splice(1, 0, { id: 'set-canvas-zoom', label: 'Zoom', items: buildCanvasZoomMenuItems() });
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
    updateSyncStatusIndicator('saving');
  }
  function hideSaving() {
    clearTimeout(savingTimeout);
    savingTimeout = setTimeout(function () {
      _headerSavingInProgress = false;
      refreshBoardHeaderActionStates();
    }, 500);
    updateSyncStatusIndicator('saved');
  }

  // ── Sync status indicator ──────────────────────────────────────────
  var _syncStatusStates = ['connected', 'disconnected', 'saving', 'saved', 'syncing'];
  function updateSyncStatusIndicator(state) {
    var el = document.getElementById('sync-status-indicator');
    if (!el) return;
    for (var i = 0; i < _syncStatusStates.length; i++) {
      el.classList.remove(_syncStatusStates[i]);
    }
    el.classList.add(state);
    var titles = {
      connected: 'Connected',
      disconnected: 'Disconnected',
      saving: 'Saving\u2026',
      saved: 'Saved',
      syncing: 'Syncing\u2026'
    };
    el.title = titles[state] || state;
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

        traceFrontendAction('debug', 'save.board', 'Saving board', { summary: boardCardSummary(fullBoardData) });
        if (await applyBoardToLiveSyncSession(activeBoardId, fullBoardData, { skipBoardReplace: true, syncSaveBase: true })) {
          traceFrontendAction('debug', 'save.board', 'Live sync save path succeeded', {});
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
        traceFrontendAction('debug', 'save.board', 'Using REST save path', { hasBase: !!baseBoardData, baseSummary: baseBoardData ? boardCardSummary(baseBoardData) : null });
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
    if (activeBoardId && fullBoardData && !options.skipRender) {
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

  // ── Management Panel (shared module) — delegated to LexeraManagementWiring ──

  var ManagementWiring = window.LexeraManagementWiring || null;
  if (ManagementWiring) {
    ManagementWiring.init({
      workspaceShellEnabled: workspaceShellEnabled,
      WorkspaceShell: WorkspaceShell,
      apiRequest: function (path, options) { return LexeraApi.request(path, options); },
      showNotification: function (msg) { showNotification(msg); },
      showConfirmDialog: function (msg) { return showConfirmDialog(msg); },
      poll: function () { poll(); },
      onWorkspacesLoaded: function (workspaceList, defaultWorkspaceId) {
        var nextWorkspaces = Array.isArray(workspaceList) ? workspaceList : [];
        workspaces = nextWorkspaces;
        if (_rt) _rt.setState('workspaces', nextWorkspaces);
        resolveActiveWorkspaceId(defaultWorkspaceId || null);
        renderWorkspaceSelect();
        renderBoardList();
      },
      onBoardRemoved: function (boardId) {
        boards = boards.filter(function (b) { return b.id !== boardId; });
        BoardList.deleteBoardHierarchyCacheEntry(boardId);
        if (activeBoardId === boardId) {
          setActiveBoardIdState(null);
          activeBoardData = null;
          fullBoardData = null;
          if (Settings) Settings.set('lastBoard', null); else localStorage.removeItem('lexera-last-board');
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
      getElLogSettingsContainer: function () { return getElLogSettingsContainer(); },
      getElMgmtPanelBody: function () { return getElMgmtPanelBody(); },
      getElMgmtPanel: function () { return getElMgmtPanel(); },
      getElLogPanel: function () { return getElLogPanel(); },
      setElLogSettingsContainer: function (v) { elLogSettingsContainer = v; },
      setElLogSettingsPane: function (v) { elLogSettingsPane = v; },
      initFrontendSettingsPanel: function (el) { initFrontendSettingsPanel(el); },
      initRenderAppsPanel: function (el) { initRenderAppsPanel(el); },
    });
  }

  function getManagementUiContainer() {
    return ManagementWiring ? ManagementWiring.getManagementUiContainer() : getElMgmtPanelBody();
  }

  var FrontendSettings = window.LexeraFrontendSettings || null;

  function buildFrontendSettingsOptions() {
    return {
      getOptions: function () { return buildFrontendSettingsOptions(); },
      // Visual theme
      getVisualThemes: function () { return Array.isArray(VISUAL_THEMES) ? VISUAL_THEMES : []; },
      getCurrentVisualThemeId: function () {
        return (typeof getLexeraCurrentVisualThemeId === 'function' && getLexeraCurrentVisualThemeId()) ||
          (Settings ? Settings.get('visualTheme') : localStorage.getItem('lexera-visual-theme')) || 'sleek-uniform';
      },
      applyVisualTheme: function (id) { applyVisualTheme(id); },
      // UI scale
      getUiScale: function () { return $uiScale; },
      applyUiScale: function (v) { applyUiScale(parseFloat(v) || 1); },
      // Scroll/zoom speed (saved as frontend defaults)
      getScrollSpeed: function () { return getBoardSettingValue('scrollSpeed', '1'); },
      setScrollSpeed: function (v) { try { localStorage.setItem('lexera-default-scrollSpeed', v); } catch (_) { /* intentional: localStorage unavailable in private browsing */ } },
      getZoomSpeed: function () { return getBoardSettingValue('zoomSpeed', '0.06'); },
      setZoomSpeed: function (v) { try { localStorage.setItem('lexera-default-zoomSpeed', v); } catch (_) { /* intentional: localStorage unavailable in private browsing */ } },
      // Display (saved as frontend defaults, applied immediately to current board)
      getTagVisibility: function () { return getBoardSettingValue('tagVisibility', 'allexcludinglayout'); },
      setTagVisibility: function (v) {
        try { localStorage.setItem('lexera-default-tagVisibility', v); } catch (_) { /* intentional: localStorage unavailable in private browsing */ }
        applyRenderedTagVisibility(getElColumnsContainer(), v);
        renderFrontendSettingsPanel();
      },
      getHtmlCommentMode: function () { return getBoardSettingValue('htmlCommentRenderMode', 'hidden'); },
      setHtmlCommentMode: function (v) {
        try { localStorage.setItem('lexera-default-htmlCommentRenderMode', v); } catch (_) { /* intentional: localStorage unavailable in private browsing */ }
        var container = getElColumnsContainer();
        currentHtmlCommentRenderMode = normalizeHtmlCommentRenderMode(v);
        container.classList.remove('html-comments-hide', 'html-comments-dim');
        if (currentHtmlCommentRenderMode === 'hidden') container.classList.add('html-comments-hide');
        if (currentHtmlCommentRenderMode === 'dim') container.classList.add('html-comments-dim');
        applyRenderedHtmlCommentVisibility(container, currentHtmlCommentRenderMode);
        renderFrontendSettingsPanel();
      },
      getHtmlContentMode: function () { return getBoardSettingValue('htmlContentRenderMode', 'html'); },
      setHtmlContentMode: function (v) {
        try { localStorage.setItem('lexera-default-htmlContentRenderMode', v); } catch (_) { /* intentional: localStorage unavailable in private browsing */ }
        reRenderAllCardDisplayStates();
        renderFrontendSettingsPanel();
      },
      // Sidebar
      getSidebarDisplayOptions: getSidebarTreeDisplayOptions,
      applySidebarDisplayOptions: applySidebarTreeDisplayOptions,
      // Editor toggles
      isOverlayEditorEnabled: isOverlayEditorEnabled,
      isSpecialCharactersVisible: isSpecialCharactersVisible,
      setOverlayEditorEnabled: setOverlayEditorEnabled,
      setSpecialCharactersVisible: setSpecialCharactersVisible,
      syncMenuCheckStates: syncMenuCheckStates,
      getContextMenuBuilders: function () { return window.ContextMenuBuilders || null; },
      revealPanel: workspaceShellEnabled && WorkspaceShell && typeof WorkspaceShell.revealPanel === 'function'
        ? function () { WorkspaceShell.revealPanel('frontendSettings'); }
        : null,
      showFallbackMenu: function () { handleBoardAction('open-frontend-settings'); }
    };
  }

  function renderFrontendSettingsPanel() {
    if (FrontendSettings) return FrontendSettings.render(buildFrontendSettingsOptions());
    return false;
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('lexera-visual-themes-changed', function () {
      renderFrontendSettingsPanel();
    });
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

  var mgmtApiAdapter = ManagementWiring ? ManagementWiring.getMgmtApiAdapter() : null;

  function requireManagementUiMethod(name) { return ManagementWiring.requireManagementUiMethod(name); }
  function getManagementUiPreset(name) { return ManagementWiring.getManagementUiPreset(name); }
  function getManagementSurfaceId(sectionName) { return ManagementWiring.getManagementSurfaceId(sectionName); }
  function getManagementTopTab(sectionName, contextName) { return ManagementWiring.getManagementTopTab(sectionName, contextName); }
  function activateManagementTabInContainer(container, tabName) { ManagementWiring.activateManagementTabInContainer(container, tabName); }
  function getBackendSettingsManagementContainer() { return ManagementWiring.getBackendSettingsManagementContainer(); }
  function getFilesManagementContainer() { return ManagementWiring.getFilesManagementContainer(); }
  function getManagementContainerForContext(contextName) { return ManagementWiring.getManagementContainerForContext(contextName); }
  function rememberManagementTab(contextName, tabName) { ManagementWiring.rememberManagementTab(contextName, tabName); }
  function applyPendingManagementTab(contextName, container) { ManagementWiring.applyPendingManagementTab(contextName, container); }
  function initManagementUI() { ManagementWiring.initManagementUI(); }
  function initFilesPanelMount(container) { ManagementWiring.initFilesPanelMount(container); }
  function openManagementPanel(options) { ManagementWiring.openManagementPanel(options); }
  function runInitManagementUI() { ManagementWiring.runInitManagementUI(); }
  function closeManagementPanel() { ManagementWiring.closeManagementPanel(); }

  // ── Collaboration ────────────────────────────────────────────────

  function openConnectionWindow() { ManagementWiring.openConnectionWindow(); }

  var _notificationQueue = [];
  var _notificationActive = null;

  /**
   * Show a toast notification.
   * @param {string} message — text to display
   * @param {object} [opts] — optional: { variant: 'error'|'success'|'warn'|'info', duration: ms, action: { label, callback } }
   */
  function showNotification(message, opts) {
    opts = opts || {};
    _notificationQueue.push({ message: message, opts: opts });
    if (!_notificationActive) _drainNotificationQueue();
  }

  function _drainNotificationQueue() {
    if (_notificationQueue.length === 0) { _notificationActive = null; return; }
    var item = _notificationQueue.shift();
    var el = document.createElement('div');
    var variant = item.opts.variant || 'info';
    el.className = 'notification notification-' + variant;
    var msgSpan = document.createElement('span');
    msgSpan.className = 'notification-msg';
    msgSpan.textContent = item.message;
    el.appendChild(msgSpan);
    if (item.opts.action && item.opts.action.label) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'notification-action';
      btn.textContent = item.opts.action.label;
      btn.addEventListener('click', function () {
        if (typeof item.opts.action.callback === 'function') item.opts.action.callback();
        el.classList.remove('visible');
        setTimeout(function () { el.remove(); _drainNotificationQueue(); }, 200);
      });
      el.appendChild(btn);
    }
    document.body.appendChild(el);
    el.offsetHeight; // force reflow
    el.classList.add('visible');
    _notificationActive = el;
    var duration = item.opts.duration || 3000;
    setTimeout(function () {
      if (!el.isConnected) return;
      el.classList.remove('visible');
      setTimeout(function () { el.remove(); _drainNotificationQueue(); }, 300);
    }, duration);
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

  // Delta diff/apply functions removed — fully delegated to LexeraBoardDelta module.
  function applyBoardDelta(board, delta, reverse) { return getBoardDeltaApi().applyBoardDelta(board, delta, reverse); }
  function estimateDeltaSize(delta) { return getBoardDeltaApi().estimateDeltaSize(delta); }

  function applyPollingBoardDelta(boardId, payload) {
    if (!boardId || boardId !== activeBoardId || !fullBoardData || !activeBoardData || !payload || !payload.available || !payload.delta) {
      return false;
    }
    applyBoardDelta(fullBoardData, payload.delta, false);
    setBoardSaveBase(fullBoardData, fullBoardData);
    activeBoardData.fullBoard = fullBoardData;
    if (typeof payload.title === 'string') activeBoardData.title = payload.title;
    if (typeof payload.version === 'number') activeBoardData.version = payload.version;
    if (typeof payload.generation === 'number') {
      activeBoardData.generation = payload.generation;
      _lastLoadedGeneration = payload.generation;
    }
    if (payload.revision) {
      activeBoardData.revision = payload.revision;
      _lastLoadedRevision = payload.revision;
    }
    if (typeof payload.isRemote === 'boolean') activeBoardData.isRemote = payload.isRemote;
    updateDisplayFromFullBoard();
    renderMainView();
    traceFrontendAction('info', 'poll.delta', 'Applied polled board delta without full reload', {
      boardId: boardId,
      generation: activeBoardData.generation || null,
      revision: activeBoardData.revision || null,
      summary: summarizeBoardHierarchy(fullBoardData)
    });
    return true;
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

  function updateCanvasGridBackground(rowContent, gridStep) {
    if (!rowContent) return;
    if (gridStep <= 0) {
      rowContent.style.backgroundImage = 'none';
      return;
    }
    var cs = getComputedStyle(rowContent);
    var borderColor = cs.getPropertyValue('--border').trim() || '#888';
    var size = gridStep;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '">'
      + '<rect x="0" y="0" width="1" height="' + size + '" fill="' + borderColor + '" opacity="0.34"/>'
      + '<rect x="0" y="0" width="' + size + '" height="1" fill="' + borderColor + '" opacity="0.34"/>'
      + '</svg>';
    rowContent.style.backgroundImage = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
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
      updateCanvasGridBackground(rowContent, gridStep);
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

  function buildCanvasZoomMenuItems() {
    var levels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
    return levels.map(function (z) {
      return { id: 'set-canvas-zoom:' + z, label: Math.round(z * 100) + '%', checked: Math.abs($canvasZoom - z) < 0.01 };
    });
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

  // --- Canvas pan: delegated to LexeraCanvasPan module ---

  // normalizeStickyHeaderMode removed — column headers are always sticky at top

  // ── Mode normalizers (delegated to LexeraBoardSettings module) ──
  function normalizeTagVisibilityMode(rawMode) { return BoardSettingsModule.normalizeTagVisibilityMode(rawMode); }
  function normalizeHtmlCommentRenderMode(rawMode) { return BoardSettingsModule.normalizeHtmlCommentRenderMode(rawMode); }
  function normalizeArrowKeyFocusScrollMode(rawMode) { return BoardSettingsModule.normalizeArrowKeyFocusScrollMode(rawMode); }

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
      if (Settings) Settings.set('tagColorOverrides', TAG_COLORS); else localStorage.setItem('lexera-tag-color-overrides', JSON.stringify(TAG_COLORS));
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

  function normalizeColumnWidth(rawValue) { return BoardSettingsModule.normalizeColumnWidth(rawValue); }

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

  var _cachedWorkspaceSettings = {};

  function refreshWorkspaceSettings() {
    var wsId = activeWorkspaceId || '';
    if (!wsId || wsId === ALL_WORKSPACES_ID || !LexeraApi || typeof LexeraApi.request !== 'function') return;
    LexeraApi.request('/config/settings?workspace=' + encodeURIComponent(wsId), { timeoutMs: 3000 })
      .then(function (data) {
        if (data && data.settings) _cachedWorkspaceSettings = data.settings;
      })
      .catch(function () { /* use cached */ });
  }

  // ── Board setting value lookup (delegated to LexeraBoardSettings module) ──
  function getBoardSettingValue(key, fallback) { return BoardSettingsModule.getBoardSettingValue(key, fallback); }
  function getHtmlContentRenderMode() { return BoardSettingsModule.getHtmlContentRenderMode(); }
  function resolveActiveBoardColor(settings) { return BoardSettingsModule.resolveActiveBoardColor(settings); }

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
    // sticky-headers classes removed — column headers are always sticky via CSS
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
    // stickyStackMode removed — column headers always sticky via CSS
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
   * Build a single card DOM element with all event listeners attached.
   * Reused by buildColumnElement (full render) and targeted DOM updates.
   */
  function buildCardElement(card, colIndex, visibleCardIndex, collapsedCards) {
    var isCanvasLayout = isCanvasBoardLayout();
    var cardId = String(card.id);
    var cardEl = document.createElement('div');
    cardEl.className = 'card' + (card.checked ? ' checked' : '');
    cardEl.setAttribute('data-col-index', colIndex.toString());
    cardEl.setAttribute('data-card-index', visibleCardIndex.toString());
    cardEl.setAttribute('data-card-id', cardId);
    if (card.kid) cardEl.setAttribute('data-card-kid', card.kid);
    var isCollapsed = !isCanvasLayout && Array.isArray(collapsedCards) && collapsedCards.indexOf(cardId) !== -1;
    if (isCollapsed) cardEl.classList.add('collapsed');
    var cardParams = card.params || {};
    if (cardParams.span) cardEl.setAttribute('data-card-span', cardParams.span);

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
    var _cardTitleRaw = getCardTitle(getIncludeResolvedContent(card.content, colIndex));
    titleDisplay.innerHTML = renderTitleInline(_cardTitleRaw, activeBoardId);
    titleDisplay.title = _cardTitleRaw.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
    titleContainer.appendChild(titleDisplay);
    headerRow.appendChild(titleContainer);
    if (toggle) {
      (function (toggleEl, el) {
        toggleEl.addEventListener('click', function (e) {
          e.stopPropagation();
          if (e.altKey) {
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
    menuBtn.setAttribute('aria-haspopup', 'menu');
    headerRow.appendChild(menuBtn);

    cardEl.appendChild(headerRow);

    var contentBody = document.createElement('div');
    contentBody.className = 'card-content';
    contentBody.innerHTML = renderCardContent(getIncludeResolvedContent(card.content, colIndex), activeBoardId, null, {
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
    })(cardEl, colIndex, visibleCardIndex, menuBtn);
    applyTagStyleToEntity(cardEl, getCardContainerStyleSource(card.content || ''));
    return cardEl;
  }

  /**
   * Update a card element in-place after content edit, without re-rendering the full board.
   * Replaces the old card element with a freshly built one to ensure all badges,
   * tags, and event listeners are correct.
   */
  function updateCardElementInPlace(colIndex, visibleCardIndex) {
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, visibleCardIndex);
    if (fullIdx === -1) return;
    var card = col.cards[fullIdx];
    if (!card) return;
    var oldEl = findVisibleCardElement(colIndex, visibleCardIndex);
    if (!oldEl) return;
    var collapsedCards = getCollapsedCards(activeBoardId, activeBoardData ? activeBoardData.rows : []);
    var newEl = buildCardElement(card, colIndex, visibleCardIndex, collapsedCards);
    // Preserve editing classes if the card was being edited
    if (oldEl.classList.contains('editing')) newEl.classList.add('editing');
    if (oldEl.classList.contains('editing-inline')) newEl.classList.add('editing-inline');
    if (oldEl.classList.contains('editing-overlay')) newEl.classList.add('editing-overlay');
    oldEl.parentNode.replaceChild(newEl, oldEl);
    enhanceEmbeddedContent(newEl);
    applyRenderedHtmlCommentVisibility(newEl, currentHtmlCommentRenderMode);
    applyRenderedTagVisibility(newEl, currentTagVisibilityMode);
    attachRenderedTagInteractions(newEl);
    vsRemeasureColumn(colIndex);
  }

  /**
   * Insert a new card DOM element at the given visible position in a column,
   * without re-rendering the full board. Updates card-index attributes on
   * subsequent sibling cards and the column count badge.
   */
  function insertCardElementAtPosition(colIndex, visibleCardIndex, card) {
    var cardsContainer = getElColumnsContainer().querySelector('.column-cards[data-col-index="' + colIndex + '"]');
    if (!cardsContainer) return false;
    var collapsedCards = getCollapsedCards(activeBoardId, activeBoardData ? activeBoardData.rows : []);
    var newEl = buildCardElement(card, colIndex, visibleCardIndex, collapsedCards);
    var existingCards = cardsContainer.querySelectorAll('.card');
    if (visibleCardIndex < existingCards.length) {
      cardsContainer.insertBefore(newEl, existingCards[visibleCardIndex]);
    } else {
      cardsContainer.appendChild(newEl);
    }
    // Re-index subsequent cards
    var allCards = cardsContainer.querySelectorAll('.card');
    for (var k = visibleCardIndex; k < allCards.length; k++) {
      allCards[k].setAttribute('data-card-index', k.toString());
    }
    enhanceEmbeddedContent(newEl);
    applyRenderedHtmlCommentVisibility(newEl, currentHtmlCommentRenderMode);
    applyRenderedTagVisibility(newEl, currentTagVisibilityMode);
    attachRenderedTagInteractions(newEl);
    // Update column card count badge
    updateColumnCountBadge(colIndex);
    return true;
  }

  /**
   * Update the column-count badge text for a given flat column index.
   */
  function updateColumnCountBadge(colIndex) {
    var colEl = getElColumnsContainer().querySelector('.column-cards[data-col-index="' + colIndex + '"]');
    if (!colEl) return;
    var columnEl = colEl.closest('.column');
    if (!columnEl) return;
    var countEl = columnEl.querySelector('.column-count');
    if (!countEl) return;
    var cardCount = colEl.querySelectorAll('.card').length;
    var col = getFullColumn(colIndex);
    var wipLimit = 0;
    if (col) {
      var layout = getColumnLayoutTags(col.title || '');
      wipLimit = layout.wipLimit || 0;
    }
    countEl.textContent = cardCount + (wipLimit > 0 ? '/' + wipLimit : '');
    if (columnEl && wipLimit > 0) {
      columnEl.classList.toggle('wip-exceeded', cardCount > wipLimit);
    }
  }

  /**
   * Reorder card DOM nodes within the same column after a same-column card move,
   * without re-rendering the full board. Updates data-card-index attributes.
   */
  function reorderCardElements(colIndex, fromVisibleIdx, toVisibleIdx) {
    var cardsContainer = getElColumnsContainer().querySelector('.column-cards[data-col-index="' + colIndex + '"]');
    if (!cardsContainer) return false;
    var cards = cardsContainer.querySelectorAll('.card');
    if (fromVisibleIdx < 0 || fromVisibleIdx >= cards.length) return false;
    if (toVisibleIdx < 0 || toVisibleIdx >= cards.length) return false;
    if (fromVisibleIdx === toVisibleIdx) return true;
    var movedEl = cards[fromVisibleIdx];
    if (toVisibleIdx > fromVisibleIdx) {
      var refEl = cards[toVisibleIdx];
      cardsContainer.insertBefore(movedEl, refEl.nextSibling);
    } else {
      cardsContainer.insertBefore(movedEl, cards[toVisibleIdx]);
    }
    // Clear leftover drag styling so the card is visible at its new position
    movedEl.classList.remove('dragging');
    movedEl.style.display = '';
    // Re-index all cards in this column
    var allCards = cardsContainer.querySelectorAll('.card');
    for (var k = 0; k < allCards.length; k++) {
      allCards[k].setAttribute('data-card-index', k.toString());
    }
    return true;
  }

  /**
   * Remove the inline add-card composer form from a column and replace with
   * the "+ Add card" creation source button. Used after targeted card insertion.
   */
  function removeAddCardComposer(colIndex) {
    var cardsContainer = getElColumnsContainer().querySelector('.column-cards[data-col-index="' + colIndex + '"]');
    if (!cardsContainer) return;
    var columnEl = cardsContainer.closest('.column');
    if (!columnEl) return;
    var footer = columnEl.querySelector('.column-footer');
    if (!footer) return;
    var textarea = footer.querySelector('.add-card-input');
    if (!textarea) return;
    footer.innerHTML = '';
    var cardSource = renderCreationSource('card', { colIndex: colIndex }, {
      btnClass: 'add-card-btn',
      btnText: '+ Add card',
      wrapperClass: 'creation-source-card'
    });
    footer.appendChild(cardSource);
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
      var includeMissing = fullCol.includeSource.missing;
      includeIndicator =
        '<button class="column-include-badge' + (includeMissing ? ' include-broken' : '') + '" type="button" data-include-path="' + escapeAttr(fullCol.includeSource.rawPath || '') + '"' +
        ' title="' + (includeMissing ? 'Missing include: ' : 'Open include: ') + escapeAttr(fullCol.includeSource.rawPath || '') + '">' +
        (includeMissing ? '&#9888;' : '&#128279;') + '</button>';
    }

    var header = document.createElement('div');
    header.className = 'column-header';
    header.innerHTML =
      (isCanvasLayout ? '' : '<button class="column-fold-btn fold-btn" title="Fold column">\u25B6</button>') +
      buildCreationEntityDragIconHtml('column', ['title="Drag to move column"']) +
      '<span class="column-title" title="' + escapeAttr(displayTitle.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim()) + '">' + renderTitleInline(displayTitle, activeBoardId, { allowIncludeDirectives: true }) + '</span>' +
      includeIndicator +
      '<span class="column-count">' + col.cards.length + (colLayout.wipLimit > 0 ? '/' + colLayout.wipLimit : '') + '</span>' +
      '<span class="column-header-actions">' +
        '<button class="column-menu-btn burger-menu-btn" title="Column options" aria-haspopup="menu">' + BURGER_MENU_ICON_HTML + '</button>' +
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
      cardsEl.appendChild(buildCardElement(col.cards[j], col.index, j, collapsedCards));
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
            hideInlineAddComposer(colIndex);
          });
          textarea.addEventListener('keydown', function (e) {
            if (handleTextareaTabIndent(e, textarea)) return;
            if (e.key === 'Enter' && e.altKey) {
              e.preventDefault();
              e.stopPropagation();
              hideInlineAddComposer(colIndex);
              return;
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              submitCard(colIndex, textarea.value);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              hideInlineAddComposer(colIndex);
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

  function hideInlineAddComposer(colIndex) {
    addCardColumn = null;
    var container = getElColumnsContainer();
    if (!container) return;
    var cardsEl = container.querySelector('.column-cards[data-col-index="' + colIndex + '"]');
    var colEl = cardsEl ? cardsEl.closest('.column') : null;
    if (!colEl) return;
    var footer = colEl.querySelector('.column-footer');
    if (!footer) return;
    // Check if column has zero visible cards — if so, show add-card button
    var col = null;
    var columns = activeBoardData ? activeBoardData.columns : [];
    for (var i = 0; i < columns.length; i++) {
      if (columns[i].index === colIndex) { col = columns[i]; break; }
    }
    var hasCards = col && col.cards && col.cards.length > 0;
    if (hasCards) {
      footer.remove();
    } else {
      footer.innerHTML = '';
      var cardSource = renderCreationSource('card', { colIndex: colIndex }, {
        btnClass: 'add-card-btn',
        btnText: '+ Add card',
        wrapperClass: 'creation-source-card'
      });
      footer.appendChild(cardSource);
    }
  }

  function showInlineAddComposer(colIndex) {
    addCardColumn = colIndex;
    var container = getElColumnsContainer();
    if (!container) return;
    var cardsEl = container.querySelector('.column-cards[data-col-index="' + colIndex + '"]');
    var colEl = cardsEl ? cardsEl.closest('.column') : null;
    if (!colEl) return;
    var footer = colEl.querySelector('.column-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'column-footer';
      colEl.appendChild(footer);
    }
    footer.innerHTML =
      '<textarea class="add-card-input" placeholder="Card content..." autofocus></textarea>' +
      '<div class="add-card-actions">' +
      '<button class="btn-small btn-primary add-card-submit">Add</button>' +
      '<button class="btn-small btn-cancel add-card-cancel">Cancel</button>' +
      '</div>';
    (function (ci) {
      var textarea = footer.querySelector('.add-card-input');
      footer.querySelector('.add-card-submit').addEventListener('click', function () {
        submitCard(ci, textarea.value);
      });
      footer.querySelector('.add-card-cancel').addEventListener('click', function () {
        hideInlineAddComposer(ci);
      });
      textarea.addEventListener('keydown', function (e) {
        if (handleTextareaTabIndent(e, textarea)) return;
        if (e.key === 'Enter' && e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          hideInlineAddComposer(ci);
          return;
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          submitCard(ci, textarea.value);
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          hideInlineAddComposer(ci);
        }
      });
      requestAnimationFrame(function () { textarea.focus(); });
    })(colIndex);
  }

  function reRenderAllCardDisplayStates() {
    var container = getElColumnsContainer();
    if (!container || !activeBoardData) return;
    var columns = activeBoardData.columns || [];
    var cards = container.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      var cardEl = cards[i];
      var colIndex = parseInt(cardEl.getAttribute('data-col-index') || '-1', 10);
      var cardIndex = parseInt(cardEl.getAttribute('data-card-index') || '-1', 10);
      if (colIndex < 0 || cardIndex < 0) continue;
      var col = null;
      for (var c = 0; c < columns.length; c++) {
        if (columns[c].index === colIndex) { col = columns[c]; break; }
      }
      if (!col || cardIndex >= col.cards.length) continue;
      renderCardDisplayState(cardEl, col.cards[cardIndex].content);
    }
  }

  function renderColumns() {
    try {
    vsTeardown();
    clearCardSelection();
    unfocusCard();
    // Defensive cleanup: stale drag artifacts can inflate row widths.
    cleanupPtrDrag();
    getElColumnsContainer().innerHTML = '';
    if (!activeBoardData) return;

    getElColumnsContainer().classList.add('new-format');
    renderNewFormatBoard();
    var isCanvas = isCanvasBoardLayout();
    if (!isCanvas) {
      clearLayoutLockStyles();
    }

    // Batch all post-render DOM work into a single rAF to avoid multiple
    // forced layouts / reflows.  Each helper scans the board subtree, so
    // running them synchronously right after innerHTML assignment causes
    // the browser to recalculate layout once per call.  A single rAF
    // defers them all until the next frame and lets the browser coalesce
    // the reads/writes.
    requestAnimationFrame(function () {
      var container = getElColumnsContainer();
      if (isCanvas) {
        syncCanvasRowBounds(container);
      } else {
        syncRenderedRowWidths();
      }
      enhanceEmbeddedContent(container);
      applyRenderedHtmlCommentVisibility(container, currentHtmlCommentRenderMode);
      applyRenderedTagVisibility(container, currentTagVisibilityMode);
      attachRenderedTagInteractions(container);
      syncSidebarToView();
      updateCardEditingIndicators();
      refreshBoardHeaderActionStates();
      vsActivate();
    });
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
        '<span class="board-row-title" title="' + escapeAttr(rowDisplayTitle.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim()) + '">' + renderTitleInline(rowDisplayTitle, activeBoardId, {}) + '</span>' +
        '<span class="board-row-count">' + totalCards + '</span>' +
        '<span class="row-header-actions">' +
          '<button class="row-menu-btn burger-menu-btn" title="Row options" aria-haspopup="menu">' + BURGER_MENU_ICON_HTML + '</button>' +
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
              if (el.classList.contains('resizing')) return;
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
                var pendingPtrDrag = DragDropHandlers ? DragDropHandlers.getPtrDrag() : null;
                if (pendingPtrDrag) return; // timer from pre-drag resize; skip during drag
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
          '<span class="board-stack-title" title="' + escapeAttr((stackDisplayTitle || '').replace(/#\S+/g, '').replace(/\s+/g, ' ').trim()) + '">' + (stackDisplayTitle ? renderTitleInline(stackDisplayTitle, activeBoardId, {}) : '&nbsp;') + '</span>' +
          '<span class="board-stack-count">' + stackColCount + '</span>' +
          '<span class="stack-header-actions">' +
            '<button class="stack-menu-btn burger-menu-btn" title="Stack options" aria-haspopup="menu">' + BURGER_MENU_ICON_HTML + '</button>' +
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
              var lastWidth = startWidth;
              var pendingClientX = startX;
              var resizeFrame = 0;
              el.classList.add('resizing');
              if (resizeHandle.setPointerCapture) {
                try { resizeHandle.setPointerCapture(e.pointerId); } catch (_) { /* intentional: pointer may already be released */ }
              }
              function applyResizeWidth(clientX) {
                var nextWidth = Math.max(220, Math.round(startWidth + (clientX - startX)));
                if (nextWidth === lastWidth) return;
                lastWidth = nextWidth;
                el.style.width = nextWidth + 'px';
                scheduleCanvasRowBoundsSync(getElColumnsContainer());
              }
              function scheduleResizeWidth(clientX) {
                pendingClientX = clientX;
                if (resizeFrame) return;
                resizeFrame = requestAnimationFrame(function () {
                  resizeFrame = 0;
                  applyResizeWidth(pendingClientX);
                });
              }
              function handleMove(moveEvent) {
                scheduleResizeWidth(moveEvent.clientX);
              }
              function handleUp(upEvent) {
                if (resizeFrame) {
                  cancelAnimationFrame(resizeFrame);
                  resizeFrame = 0;
                }
                applyResizeWidth(pendingClientX);
                el.classList.remove('resizing');
                if (resizeHandle.releasePointerCapture) {
                  try { resizeHandle.releasePointerCapture(upEvent.pointerId); } catch (_) { /* intentional: pointer may already be released */ }
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

  // --- New-format DnD mutations (delegated to LexeraDndMutations module) ---

  var DndMutations = typeof LexeraDndMutations !== 'undefined' ? LexeraDndMutations : null;

  function initDndMutations() {
    if (!DndMutations) return;
    DndMutations.init({
      getFullBoardData: function () { return fullBoardData; },
      getActiveBoardData: function () { return activeBoardData; },
      getActiveBoardId: function () { return activeBoardId; },
      pushUndo: pushUndo,
      persistBoardMutation: persistBoardMutation,
      addColumnToStack: addColumnToStack,
      applyDefaultCanvasPlacementToStack: applyDefaultCanvasPlacementToStack,
      getDisplayOrderedColumnEntries: getDisplayOrderedColumnEntries,
      stripInternalHiddenTags: stripInternalHiddenTags,
      stripHtmlComments: stripHtmlComments,
      traceFrontendAction: traceFrontendAction,
      resolveRowForMutation: resolveRowForMutation,
      resolveStackForMutation: resolveStackForMutation,
      resolveColumnRefForCardMutation: resolveColumnRefForCardMutation
    });
  }
  initDndMutations();

  function _dnd(m) { if (!DndMutations || typeof DndMutations[m] !== 'function') return undefined; var a = Array.prototype.slice.call(arguments, 1); return DndMutations[m].apply(DndMutations, a); }
  function reorderRows(s, t, b) { return _dnd('reorderRows', s, t, b); }
  function moveStack(fr, fs, tr, ts, b) { return _dnd('moveStack', fr, fs, tr, ts, b); }
  function findFullDataRow(i) { return _dnd('findFullDataRow', i); }
  function findFullDataStack(r, s) { return _dnd('findFullDataStack', r, s); }
  function findFullDataRowIndex(i) { return _dnd('findFullDataRowIndex', i); }
  function findInsertRowIndex(i) { return _dnd('findInsertRowIndex', i); }
  function visibleColumnIndicesInStack(s) { return _dnd('visibleColumnIndicesInStack', s); }
  function findFullDataStackIndex(r, ri, si) { return _dnd('findFullDataStackIndex', r, ri, si); }
  function findFullColumnIndexInStack(s, c) { return _dnd('findFullColumnIndexInStack', s, c); }
  function findInsertStackIndexInRow(r, ri, i) { return _dnd('findInsertStackIndexInRow', r, ri, i); }
  function findInsertColumnIndexInStack(s, c, b) { return _dnd('findInsertColumnIndexInStack', s, c, b); }
  function addColumnRelativeToDisplayPosition(r, s, c, b) { return _dnd('addColumnRelativeToDisplayPosition', r, s, c, b); }
  function nextMutationEntityId(p) { return _dnd('nextMutationEntityId', p); }
  function isUnnamedStructuralTitle(t) { return _dnd('isUnnamedStructuralTitle', t); }
  function createUnnamedColumnForMutation(c) { return _dnd('createUnnamedColumnForMutation', c); }
  function createUnnamedStackForMutation(c) { return _dnd('createUnnamedStackForMutation', c); }
  function createUnnamedRowForMutation(s) { return _dnd('createUnnamedRowForMutation', s); }
  function resolveRowInsertIndexForMutation(b, d, t) { return _dnd('resolveRowInsertIndexForMutation', b, d, t); }
  function insertUnnamedRowForMutation(b, d, t, s) { return _dnd('insertUnnamedRowForMutation', b, d, t, s); }
  function insertUnnamedStackIntoRowForMutation(b, d, t) { return _dnd('insertUnnamedStackIntoRowForMutation', b, d, t); }
  function resolvePreferredCardColumnRefInStack(s, l) { return _dnd('resolvePreferredCardColumnRefInStack', s, l); }
  function ensureCardTargetColumnForMutation(b, d, desc) { return _dnd('ensureCardTargetColumnForMutation', b, d, desc); }
  function cleanupUnnamedStructuralContainersInBoard(d) { return _dnd('cleanupUnnamedStructuralContainersInBoard', d); }
  function removeEmptyStacksAndRowsInBoard(d) { return _dnd('removeEmptyStacksAndRowsInBoard', d); }
  function removeEmptyStacksAndRows() { return _dnd('removeEmptyStacksAndRows'); }

  // --- Row & Stack Context Menus (delegated to LexeraRowStackMenu module) ---
  var _RSM = window.LexeraRowStackMenu;
  function closeRowStackMenu() { if (_RSM) _RSM.closeRowStackMenu(); }
  function showRowContextMenu(x, y, rowIdx) { if (_RSM) _RSM.showRowContextMenu(x, y, rowIdx); }
  function showStackContextMenu(x, y, rowIdx, stackIdx) { if (_RSM) _RSM.showStackContextMenu(x, y, rowIdx, stackIdx); }
  function showCanvasBackgroundContextMenu(x, y, rowIdx, canvasPosition) { if (_RSM) _RSM.showCanvasBackgroundContextMenu(x, y, rowIdx, canvasPosition); }
  function showElementContextMenu(scope, x, y, rawContext) { if (_RSM) _RSM.showElementContextMenu(scope, x, y, rawContext); }
  function renameRowOrStack(type, rowIdx, stackIdx) { if (_RSM) _RSM.renameRowOrStack(type, rowIdx, stackIdx); }
  function loadTemplatesOnce() { if (_RSM) _RSM.loadTemplatesOnce(); }
  function renderCreationSource(entityType, context, options) { return _RSM ? _RSM.renderCreationSource(entityType, context, options) : document.createElement('div'); }
  async function handleCreationAction(entityType, action, context) { if (_RSM) return _RSM.handleCreationAction(entityType, action, context); }
  function sanitizeBuiltInDiagramFileName(value, extension, fallbackBase) { return _RSM ? _RSM.sanitizeBuiltInDiagramFileName(value, extension, fallbackBase) : ''; }
  function createBuiltInNamedFile(content, fileName, mimeType) { return _RSM ? _RSM.createBuiltInNamedFile(content, fileName, mimeType) : null; }
  function getBuiltInDiagramTemplateSpec(templateId) { return _RSM ? _RSM.getBuiltInDiagramTemplateSpec(templateId) : null; }
  async function buildBuiltInDiagramTemplateCardContent(templateId) { return _RSM ? _RSM.buildBuiltInDiagramTemplateCardContent(templateId) : null; }
  async function addRowFromContent(text, atIndex) { if (_RSM) return _RSM.addRowFromContent(text, atIndex); }
  async function addStackFromContent(rowIdx, text, atStackIdx) { if (_RSM) return _RSM.addStackFromContent(rowIdx, text, atStackIdx); }
  async function addColumnFromContent(rowIdx, stackIdx, text, atColIdx) { if (_RSM) return _RSM.addColumnFromContent(rowIdx, stackIdx, text, atColIdx); }
  async function insertTemplateColumns(rowIdx, stackIdx, cols, atColIdx) { if (_RSM) return _RSM.insertTemplateColumns(rowIdx, stackIdx, cols, atColIdx); }
  async function insertTemplateStack(rowIdx, stack, atStackIdx) { if (_RSM) return _RSM.insertTemplateStack(rowIdx, stack, atStackIdx); }
  async function insertTemplateRow(atIndex, row) { if (_RSM) return _RSM.insertTemplateRow(atIndex, row); }
  async function addRow(atIndex) { return _RSM ? _RSM.addRow(atIndex) : false; }
  async function setRowHiddenTag(displayRowIdx, tag) { if (_RSM) return _RSM.setRowHiddenTag(displayRowIdx, tag); }
  async function deleteRow(rowIdx) { if (_RSM) return _RSM.deleteRow(rowIdx); }
  async function duplicateRow(rowIdx) { if (_RSM) return _RSM.duplicateRow(rowIdx); }
  async function addStackToRow(rowIdx, atStackIdx, options) { return _RSM ? _RSM.addStackToRow(rowIdx, atStackIdx, options) : false; }
  async function setStackHiddenTag(displayRowIdx, displayStackIdx, tag) { if (_RSM) return _RSM.setStackHiddenTag(displayRowIdx, displayStackIdx, tag); }
  async function deleteStack(rowIdx, stackIdx) { if (_RSM) return _RSM.deleteStack(rowIdx, stackIdx); }
  async function duplicateStack(rowIdx, stackIdx) { if (_RSM) return _RSM.duplicateStack(rowIdx, stackIdx); }
  async function addColumnToStack(rowIdx, stackIdx, atColIdx) { return _RSM ? _RSM.addColumnToStack(rowIdx, stackIdx, atColIdx) : false; }

  async function addCardToActiveBoard(colIndex, content, atCardIndex, insertMode) {
    content = String(content || '').trim();
    if (!content || !activeBoardId || !fullBoardData) return false;
    var normalizedTarget = null;
    var targetColIndex = colIndex;
    if (typeof colIndex === 'object' && colIndex) {
      normalizedTarget = {
        boardId: activeBoardId,
        indexMode: colIndex.indexMode || 'display',
        insertIdx: typeof colIndex.insertIdx === 'number'
          ? colIndex.insertIdx
          : (typeof colIndex.atCardIndex === 'number' ? colIndex.atCardIndex : atCardIndex),
        insertMode: colIndex.insertMode || insertMode || 'visible'
      };
      if (typeof colIndex.flatColIndex === 'number') normalizedTarget.flatColIndex = colIndex.flatColIndex;
      else if (typeof colIndex.colIndex === 'number' && typeof colIndex.rowIndex !== 'number' && typeof colIndex.stackIndex !== 'number') {
        normalizedTarget.flatColIndex = colIndex.colIndex;
      }
      if (typeof colIndex.rowIndex === 'number') normalizedTarget.rowIndex = colIndex.rowIndex;
      else if (typeof colIndex.rowIdx === 'number') normalizedTarget.rowIndex = colIndex.rowIdx;
      if (typeof colIndex.stackIndex === 'number') normalizedTarget.stackIndex = colIndex.stackIndex;
      else if (typeof colIndex.stackIdx === 'number') normalizedTarget.stackIndex = colIndex.stackIdx;
      if (typeof colIndex.colIdx === 'number') normalizedTarget.colIndex = colIndex.colIdx;
      else if (
        typeof colIndex.colIndex === 'number' &&
        typeof normalizedTarget.rowIndex === 'number' &&
        typeof normalizedTarget.stackIndex === 'number'
      ) {
        normalizedTarget.colIndex = colIndex.colIndex;
      }
      pushUndo();
      var ensuredTarget = ensureCardTargetColumnForMutation(activeBoardId, fullBoardData, normalizedTarget);
      if (!ensuredTarget || !ensuredTarget.column) return false;
      targetColIndex = getAllFullColumns().indexOf(ensuredTarget.column);
      if (targetColIndex < 0) return false;
    }
    var column = getFullColumn(targetColIndex);
    if (!column || !Array.isArray(column.cards)) return false;
    if (!normalizedTarget) pushUndo();
    var insertAt = column.cards.length;
    var desiredInsertIdx = normalizedTarget && typeof normalizedTarget.insertIdx === 'number'
      ? normalizedTarget.insertIdx
      : atCardIndex;
    var desiredInsertMode = normalizedTarget ? normalizedTarget.insertMode : insertMode;
    if (typeof desiredInsertIdx === 'number') {
      var resolvedInsertIdx = resolveInsertCardIndex(column, desiredInsertIdx, desiredInsertMode === 'full' ? 'full' : 'visible');
      if (resolvedInsertIdx >= 0) insertAt = resolvedInsertIdx;
    }
    var newCard = {
      id: 'card-' + Date.now(),
      content: content,
      checked: false
    };
    column.cards.splice(insertAt, 0, newCard);
    addCardColumn = null;
    await persistBoardMutation({ skipRender: true });
    // Find the visible index of the newly added card
    var visibleIdx = findVisibleCardIndexById(targetColIndex, newCard.id);
    if (visibleIdx >= 0) {
      insertCardElementAtPosition(targetColIndex, visibleIdx, newCard);
      removeAddCardComposer(targetColIndex);
    } else {
      renderColumns();
    }
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
    var normalizedTarget = null;
    var targetColIndex = colIndex;
    if (typeof colIndex === 'object' && colIndex) {
      normalizedTarget = {
        boardId: activeBoardId,
        indexMode: colIndex.indexMode || 'display',
        insertIdx: typeof colIndex.insertIdx === 'number'
          ? colIndex.insertIdx
          : (typeof colIndex.atCardIndex === 'number' ? colIndex.atCardIndex : atCardIndex),
        insertMode: colIndex.insertMode || insertMode || 'visible'
      };
      if (typeof colIndex.flatColIndex === 'number') normalizedTarget.flatColIndex = colIndex.flatColIndex;
      else if (typeof colIndex.colIndex === 'number' && typeof colIndex.rowIndex !== 'number' && typeof colIndex.stackIndex !== 'number') {
        normalizedTarget.flatColIndex = colIndex.colIndex;
      }
      if (typeof colIndex.rowIndex === 'number') normalizedTarget.rowIndex = colIndex.rowIndex;
      else if (typeof colIndex.rowIdx === 'number') normalizedTarget.rowIndex = colIndex.rowIdx;
      if (typeof colIndex.stackIndex === 'number') normalizedTarget.stackIndex = colIndex.stackIndex;
      else if (typeof colIndex.stackIdx === 'number') normalizedTarget.stackIndex = colIndex.stackIdx;
      if (typeof colIndex.colIdx === 'number') normalizedTarget.colIndex = colIndex.colIdx;
      else if (
        typeof colIndex.colIndex === 'number' &&
        typeof normalizedTarget.rowIndex === 'number' &&
        typeof normalizedTarget.stackIndex === 'number'
      ) {
        normalizedTarget.colIndex = colIndex.colIndex;
      }
      pushUndo();
      var ensuredTarget = ensureCardTargetColumnForMutation(activeBoardId, fullBoardData, normalizedTarget);
      if (!ensuredTarget || !ensuredTarget.column) {
        traceFrontendAction('warn', 'card.create', 'Aborted empty card creation because card target could not be ensured', {
          boardId: activeBoardId || null,
          target: normalizedTarget
        });
        return false;
      }
      targetColIndex = getAllFullColumns().indexOf(ensuredTarget.column);
      if (targetColIndex < 0) return false;
    }
    var column = getFullColumn(targetColIndex);
    if (!column || !Array.isArray(column.cards)) {
      traceFrontendAction('warn', 'card.create', 'Aborted empty card creation because column could not be resolved', {
        boardId: activeBoardId || null,
        colIndex: targetColIndex
      });
      return false;
    }
    if (!normalizedTarget) pushUndo();
    var card = {
      id: 'card-' + Date.now(),
      content: '',
      checked: false
    };
    traceFrontendAction('info', 'card.create', 'Creating blank card', {
      boardId: activeBoardId || null,
      colIndex: targetColIndex,
      columnId: column.id || null,
      cardId: card.id,
      cardCountBefore: column.cards.length
    });
    var insertAt = column.cards.length;
    var desiredInsertIdx = normalizedTarget && typeof normalizedTarget.insertIdx === 'number'
      ? normalizedTarget.insertIdx
      : atCardIndex;
    var desiredInsertMode = normalizedTarget ? normalizedTarget.insertMode : insertMode;
    if (typeof desiredInsertIdx === 'number') {
      var resolvedInsert = resolveInsertCardIndex(column, desiredInsertIdx, desiredInsertMode === 'full' ? 'full' : 'visible');
      if (resolvedInsert >= 0) insertAt = resolvedInsert;
    }
    column.cards.splice(insertAt, 0, card);
    var saved = await persistBoardMutation({ skipRender: true });
    var visibleIdx = findVisibleCardIndexById(targetColIndex, card.id);
    if (visibleIdx >= 0) {
      insertCardElementAtPosition(targetColIndex, visibleIdx, card);
    } else {
      renderColumns();
    }
    traceFrontendAction(saved ? 'info' : 'warn', 'card.create', saved ? 'Persisted blank card' : 'Blank card persist reported failure', {
      boardId: activeBoardId || null,
      colIndex: targetColIndex,
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
    await persistBoardMutation({ skipRender: true });
    var visibleIdx = findVisibleCardIndexById(colIndex, card.id);
    if (visibleIdx >= 0) {
      insertCardElementAtPosition(colIndex, visibleIdx, card);
    } else {
      renderColumns();
    }
    return true;
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
      await persistBoardMutation({ skipRender: true });
      var visibleIdx = findVisibleCardIndexById(colIndex, card.id);
      if (visibleIdx >= 0) {
        insertCardElementAtPosition(colIndex, visibleIdx, card);
      } else {
        renderColumns();
      }
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
      await persistBoardMutation({ skipRender: true });
      var visibleIdx = findVisibleCardIndexById(targetCol, card.id);
      if (visibleIdx >= 0) {
        insertCardElementAtPosition(targetCol, visibleIdx, card);
      } else {
        renderColumns();
      }
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
  function resolveHeaderDropTag(mx, my) { return BoardHeader ? BoardHeader.resolveHeaderDropTag(mx, my) : null; }
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


  // --- Pointer-based DnD event listeners (delegated to LexeraDndListeners module) ---
  function resolveColumnLocationForMutation(boardId, boardData, rowIndex, stackIndex, colIndex, indexMode) { return DndListeners ? DndListeners.resolveColumnLocationForMutation(boardId, boardData, rowIndex, stackIndex, colIndex, indexMode) : null; }
  function resolveStackForMutation(boardId, boardData, rowIndex, stackIndex, indexMode) { return DndListeners ? DndListeners.resolveStackForMutation(boardId, boardData, rowIndex, stackIndex, indexMode) : null; }
  function resolveRowForMutation(boardId, boardData, rowIndex, indexMode) { return DndListeners ? DndListeners.resolveRowForMutation(boardId, boardData, rowIndex, indexMode) : null; }
  function moveRowAcrossBoards(source, target) { return DndListeners ? DndListeners.moveRowAcrossBoards(source, target) : undefined; }
  function moveStackAcrossBoards(source, target) { return DndListeners ? DndListeners.moveStackAcrossBoards(source, target) : undefined; }
  function moveColumnAcrossBoards(source, target) { return DndListeners ? DndListeners.moveColumnAcrossBoards(source, target) : undefined; }

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

      // Same-column reorder on the active board: targeted DOM update
      var isSameColumnOnActiveBoard = source.boardId === activeBoardId &&
        target.boardId === activeBoardId &&
        sourceBoardData === targetBoardData &&
        sourceRef.column === targetRef.column;
      if (isSameColumnOnActiveBoard) {
        await persistBoardMutation({ skipRender: true });
        var srcVisible = typeof source.cardIndex === 'number' ? source.cardIndex : -1;
        var dstVisible = findVisibleCardIndexById(source.flatColIndex, movedCard.id);
        if (srcVisible >= 0 && dstVisible >= 0) {
          reorderCardElements(source.flatColIndex, srcVisible, dstVisible);
        } else {
          renderColumns();
        }
        return;
      }

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

  /**
   * Find the visible card index for a card by its ID within a full column.
   * Returns -1 if not found or the card is archived/deleted.
   */
  function findVisibleCardIndexById(colIndex, cardId) {
    var col = getFullColumn(colIndex);
    if (!col || !col.cards) return -1;
    var visible = 0;
    for (var i = 0; i < col.cards.length; i++) {
      if (is_archived_or_deleted(col.cards[i].content)) continue;
      if (col.cards[i].id === cardId) return visible;
      visible++;
    }
    return -1;
  }

  // --- Card Editing (delegated to CardEditorModule) ---
  function _ce(m) { if (!CardEditorModule || typeof CardEditorModule[m] !== 'function') return undefined; var a = Array.prototype.slice.call(arguments, 1); return CardEditorModule[m].apply(CardEditorModule, a); }

  function getCurrentEditorBoardId() { return _ce('getCurrentEditorBoardId'); }
  function getCurrentEditorFilePath() { return _ce('getCurrentEditorFilePath'); }
  function safeDecodePath(value) { return _ce('safeDecodePath', value); }
  function isWindowsAbsolutePath(value) { return _ce('isWindowsAbsolutePath', value); }
  function normalizeWindowsAbsolutePath(value) { return _ce('normalizeWindowsAbsolutePath', value); }
  function isRelativeResourcePath(value) { return _ce('isRelativeResourcePath', value); }
  function resolveRelativePath(baseDir, relativePath) { return _ce('resolveRelativePath', baseDir, relativePath); }
  function buildWebviewResourceUrl(pathValue) { return _ce('buildWebviewResourceUrl', pathValue); }
  function resolveCurrentEditorResourcePath(pathValue, includeDir) { return _ce('resolveCurrentEditorResourcePath', pathValue, includeDir); }
  function syncCardEditorWysiwygContext(editor) { _ce('syncCardEditorWysiwygContext', editor); }
  function setCurrentCardEditorMarkdown(nextValue, options) { _ce('setCurrentCardEditorMarkdown', nextValue, options); }
  function updateCardEditorWysiwygToolbar(selectionState) { _ce('updateCardEditorWysiwygToolbar', selectionState); }
  function applyCardEditorFontScale(scale, persist) { _ce('applyCardEditorFontScale', scale, persist); }
  function openCardEditorFontScaleMenu(anchorEl) { _ce('openCardEditorFontScaleMenu', anchorEl); }
  function openFileSearchDialog(textarea) { _ce('openFileSearchDialog', textarea); }
  function insertAtCursor(textarea, text) { _ce('insertAtCursor', textarea, text); }
  function syncCardEditorTextareaFromWysiwyg() { _ce('syncCardEditorTextareaFromWysiwyg'); }
  function destroyCardEditorWysiwyg(editor) { _ce('destroyCardEditorWysiwyg', editor); }
  function ensureCardEditorWysiwyg() { return _ce('ensureCardEditorWysiwyg'); }
  function applyCardEditorFormatting(textarea, fmt) { _ce('applyCardEditorFormatting', textarea, fmt); }
  function getEmbedOccurrenceRoot(container) { return _ce('getEmbedOccurrenceRoot', container); }
  function getRenderedEmbedAbsoluteIndex(container) { return _ce('getRenderedEmbedAbsoluteIndex', container); }
  function replaceCurrentEmbedOccurrence(content, container, replacer) { return _ce('replaceCurrentEmbedOccurrence', content, container, replacer); }
  function replaceNthIncludeDirective(content, targetIndex, replacer) { return _ce('replaceNthIncludeDirective', content, targetIndex, replacer); }
  function normalizeCardEditorMode(mode) { return _ce('normalizeCardEditorMode', mode); }
  function normalizeCardEditorFontScale(value) { return _ce('normalizeCardEditorFontScale', value); }
  function getCardEditorFormatSpec(fmt) { return _ce('getCardEditorFormatSpec', fmt); }
  function buildCardEditorSnippetSelectHtml() { return _ce('buildCardEditorSnippetSelectHtml'); }
  function updateCheckboxLineInText(text, lineIndex, checked) { return _ce('updateCheckboxLineInText', text, lineIndex, checked); }
  function renderCardDisplayState(cardEl, content) { _ce('renderCardDisplayState', cardEl, content); }

  function autoResizeInlineCardTextarea(textarea) {
    if (InlineCardEditorModule) InlineCardEditorModule.autoResizeInlineCardTextarea(textarea);
  }

  function findVisibleCardElement(colIndex, cardIndex) { return _ce('findVisibleCardElement', colIndex, cardIndex); }
  function openCardEditor(cardEl, colIndex, cardIndex, mode) { _ce('openCardEditor', cardEl, colIndex, cardIndex, mode); }

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

  function applyCardEditorMode(mode) { _ce('applyCardEditorMode', mode); }
  function enterCardEditMode(cardEl, colIndex, cardIndex) { _ce('enterCardEditMode', cardEl, colIndex, cardIndex); }
  function refreshCardEditorPreview() { _ce('refreshCardEditorPreview'); }
  function closeCardEditorOverlay(options) { return _ce('closeCardEditorOverlay', options); }
  function insertFormatting(textarea, fmt) { _ce('insertFormatting', textarea, fmt); }
  function saveCardEdit(cardEl, colIndex, fullCardIdx, newContent) { return _ce('saveCardEdit', cardEl, colIndex, fullCardIdx, newContent); }

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
    await persistBoardMutation({ skipRender: true });
    updateCardElementInPlace(colIndex, cardIndex);
  }

  // --- Card Context Menu (delegated to CardContextMenu module) ---

  var _CCM = window.CardContextMenu;

  function closeCardContextMenu() { if (_CCM) _CCM.closeCardContextMenu(); }
  function showCardContextMenu(x, y, colIndex, cardIndex) { if (_CCM) _CCM.showCardContextMenu(x, y, colIndex, cardIndex); }
  function duplicateCard(colIndex, cardIndex) { return _CCM ? _CCM.duplicateCard(colIndex, cardIndex) : Promise.resolve(); }
  function duplicateCardToColumn(colIndex, cardIndex, targetColIndex) { return _CCM ? _CCM.duplicateCardToColumn(colIndex, cardIndex, targetColIndex) : Promise.resolve(); }
  function parkCopyCard(colIndex, cardIndex) { return _CCM ? _CCM.parkCopyCard(colIndex, cardIndex) : Promise.resolve(); }
  function tagCard(colIndex, cardIndex, tag) { return _CCM ? _CCM.tagCard(colIndex, cardIndex, tag) : Promise.resolve(); }
  function deleteCard(colIndex, cardIndex) { return _CCM ? _CCM.deleteCard(colIndex, cardIndex) : Promise.resolve(); }
  function resolveTagTarget(elementType, indices) { return _CCM ? _CCM.resolveTagTarget(elementType, indices) : null; }
  function splitTagHeaderAndBody(text) { return _CCM ? _CCM.splitTagHeaderAndBody(text) : { header: '', bodyLines: [] }; }
  function rebuildTagHeaderAndBody(headerText, bodyLines) { return _CCM ? _CCM.rebuildTagHeaderAndBody(headerText, bodyLines) : ''; }
  function mutateEntityHeaderText(elementType, indices, mutator) { return _CCM ? _CCM.mutateEntityHeaderText(elementType, indices, mutator) : Promise.resolve(false); }
  function normalizePromptTagToken(rawToken) { return _CCM ? _CCM.normalizePromptTagToken(rawToken) : ''; }
  function parsePromptTagList(rawInput) { return _CCM ? _CCM.parsePromptTagList(rawInput) : []; }
  function removeTagFromHeaderText(headerText, tagName) { return _CCM ? _CCM.removeTagFromHeaderText(headerText, tagName) : headerText; }
  function addTagToHeaderText(headerText, tagName) { return _CCM ? _CCM.addTagToHeaderText(headerText, tagName) : headerText; }
  function clearRemovableTagsFromHeaderText(headerText) { return _CCM ? _CCM.clearRemovableTagsFromHeaderText(headerText) : headerText; }
  function mutateEntityHeaderTags(elementType, indices, mutator) { return _CCM ? _CCM.mutateEntityHeaderTags(elementType, indices, mutator) : Promise.resolve(false); }
  function handleEntityTagMenuAction(action, elementType, indices) { return _CCM ? _CCM.handleEntityTagMenuAction(action, elementType, indices) : Promise.resolve(false); }
  function handleEntityMarpMenuAction(action, elementType, indices) { return _CCM ? _CCM.handleEntityMarpMenuAction(action, elementType, indices) : Promise.resolve(false); }
  function toggleTag(elementType, indices, tagName) { return _CCM ? _CCM.toggleTag(elementType, indices, tagName) : Promise.resolve(); }
  function extractTagNameFromMenuAction(action) { return _CCM ? _CCM.extractTagNameFromMenuAction(action) : ''; }
  function refreshAvailableMarpClasses(force) { return _CCM ? _CCM.refreshAvailableMarpClasses(force) : Promise.resolve([]); }
  function buildFileHeaderMarpMenuItems() { return _CCM ? _CCM.buildFileHeaderMarpMenuItems() : []; }
  function handleBoardMarpMenuAction(action) { return _CCM ? _CCM.handleBoardMarpMenuAction(action) : Promise.resolve(false); }
  function getMarpDirectiveValueFromHeader(headerText, directiveName, directiveScope) { return _CCM ? _CCM.getMarpDirectiveValueFromHeader(headerText, directiveName, directiveScope) : ''; }
  function truncateMarpDirectiveValue(value) { return _CCM ? _CCM.truncateMarpDirectiveValue(value) : ''; }
  function getAvailableMarpClassNames(headerText) { return _CCM ? _CCM.getAvailableMarpClassNames(headerText) : []; }
  function getMarpClassListFromHeader(headerText, classScope) { return _CCM ? _CCM.getMarpClassListFromHeader(headerText, classScope) : []; }
  function hasMarpDirectiveValue(headerText, directiveName, directiveScope, targetValue) { return _CCM ? _CCM.hasMarpDirectiveValue(headerText, directiveName, directiveScope, targetValue) : false; }
  // Marp constant references (delegated)
  var MARP_COLOR_DIRECTIVES = _CCM ? _CCM.MARP_COLOR_DIRECTIVES : [];
  var MARP_TEXT_DIRECTIVES = _CCM ? _CCM.MARP_TEXT_DIRECTIVES : [];
  var BOARD_MARP_FRONTMATTER_KEYS = _CCM ? _CCM.BOARD_MARP_FRONTMATTER_KEYS : [];
  var DEFAULT_MARP_CLASS_NAMES = _CCM ? _CCM.DEFAULT_MARP_CLASS_NAMES : ['lead', 'invert'];

  // --- Removed: tag builders, marp constants/helpers, card ops, entity tag/marp ops ---
  // All moved to CardContextMenu module (menu/cardContextMenu.js)


  // --- Column Context Menu & Operations ---
  // All moved to LexeraColumnContextMenu module (menu/columnContextMenu.js)

  var _ColCtx = window.LexeraColumnContextMenu;
  function _col(m) { if (!_ColCtx || typeof _ColCtx[m] !== 'function') return undefined; var a = Array.prototype.slice.call(arguments, 1); return _ColCtx[m].apply(_ColCtx, a); }

  function closeColumnContextMenu() { _col('closeColumnContextMenu'); }
  function showColumnContextMenu(x, y, colIndex, context) { _col('showColumnContextMenu', x, y, colIndex, context); }
  function setColumnIncludePath(colIndex, nextPath) { return _col('setColumnIncludePath', colIndex, nextPath); }
  function enableColumnIncludeMode(colIndex) { return _col('enableColumnIncludeMode', colIndex); }
  function editColumnIncludeFile(colIndex) { return _col('editColumnIncludeFile', colIndex); }
  function disableColumnIncludeMode(colIndex) { return _col('disableColumnIncludeMode', colIndex); }
  function moveColumnToStack(colIndex, targetRowIdx, targetStackIdx) { return _col('moveColumnToStack', colIndex, targetRowIdx, targetStackIdx); }
  function setColumnHiddenTag(colIndex, tag) { return _col('setColumnHiddenTag', colIndex, tag); }
  function compareNumericTagParts(aParts, bParts) { return _col('compareNumericTagParts', aParts, bParts); }
  function extractFirstTemporalDateValue(content) { return _col('extractFirstTemporalDateValue', content); }
  function compareCardsForSort(a, b, mode) { return _col('compareCardsForSort', a, b, mode); }
  function sortColumnCards(colIndex, mode) { return _col('sortColumnCards', colIndex, mode); }
  function sortColumnsCards(columns, mode) { return _col('sortColumnsCards', columns, mode); }
  function sortRowCards(rowIdx, mode) { return _col('sortRowCards', rowIdx, mode); }
  function sortStackCards(rowIdx, stackIdx, mode) { return _col('sortStackCards', rowIdx, stackIdx, mode); }
  function sortAllCardsAcrossBoard(mode) { return _col('sortAllCardsAcrossBoard', mode); }
  function extractNumericTag(content) { return _col('extractNumericTag', content); }
  function extractAllNumericTags(content) { return _col('extractAllNumericTags', content); }
  function escapeAttr(str) { return _col('escapeAttr', str); }
  function enterColumnRename(colEl, colIndex) { _col('enterColumnRename', colEl, colIndex); }
  function getBoardColumnByPath(boardData, rowIdx, stackIdx, colIdx) { return _col('getBoardColumnByPath', boardData, rowIdx, stackIdx, colIdx); }
  function findColumnContainerInBoard(boardData, flatIndex) { return _col('findColumnContainerInBoard', boardData, flatIndex); }
  function findColumnContainer(flatIndex) { return _col('findColumnContainer', flatIndex); }
  function addColumn(atIndex) { return _col('addColumn', atIndex); }
  function deleteColumn(colIndex) { return _col('deleteColumn', colIndex); }
  function duplicateColumn(colIndex) { return _col('duplicateColumn', colIndex); }
  function toggleColCards(colIndex, collapse) { _col('toggleColCards', colIndex, collapse); }
  function revealCardContent(colIndex, cardIndex) { _col('revealCardContent', colIndex, cardIndex); }
  function revealColumnContent(colIndex) { _col('revealColumnContent', colIndex); }
  function revealRowContent(rowIdx) { _col('revealRowContent', rowIdx); }
  function revealStackContent(rowIdx, stackIdx) { _col('revealStackContent', rowIdx, stackIdx); }

  // Close context menus on outside click
  document.addEventListener('click', function () {
    closeColumnContextMenu();
    closeRowStackMenu();
  });

  // --- Search --- (delegated to LexeraBoardSearch module)

  var _BoardSearch = window.LexeraBoardSearch || null;
  if (_BoardSearch) _BoardSearch.init({
    $searchInput: $searchInput,
    getSearchMode: function () { return searchMode; },
    setSearchMode: function (v) { searchMode = v; },
    getSearchResults: function () { return searchResults; },
    setSearchResults: function (v) { searchResults = v; },
    getActiveBoardId: function () { return activeBoardId; },
    getActiveBoardData: function () { return activeBoardData; },
    isHeaderSearchExpanded: function () { return headerSearchExpanded; },
    setHeaderSearchExpanded: function (v) { setHeaderSearchExpanded(v); },
    updateHeaderSearchVisibility: function () { updateHeaderSearchVisibility(); },
    renderMainView: function () { renderMainView(); },
    selectBoard: function (id, opts) { return selectBoard(id, opts); },
    loadBoard: function () { return loadBoard(); },
    resolveWikiDocument: function (name) { return resolveWikiDocument(name); },
    showNotification: function (msg) { showNotification(msg); },
    lexeraLog: function (level, msg) { lexeraLog(level, msg); },
    logFrontendIssue: function (level, area, msg, err) { logFrontendIssue(level, area, msg, err); },
    escapeHtml: function (s) { return escapeHtml(s); },
    escapeAttr: function (s) { return escapeAttr(s); },
    focusCard: function (el) { focusCard(el); },
    unfocusCard: function () { unfocusCard(); },
    focusBoardEntity: function (el) { focusBoardEntity(el); },
    syncSidebarToView: function () { syncSidebarToView(); },
    saveFoldState: function () { saveFoldState(); },
    isWorkspaceShellEnabled: function () { return workspaceShellEnabled; },
    getWorkspaceShell: function () { return WorkspaceShell; },
    getDashboardTreeApi: function () { return getDashboardTreeApi(); },
    getBoardNavigationApi: function () { return getBoardNavigationApi(); },
    LexeraApi: LexeraApi
  });

  function onSearchInput() { if (_BoardSearch) _BoardSearch.onSearchInput(); }
  function performSearch(query) { return _BoardSearch ? _BoardSearch.performSearch(query) : Promise.resolve(); }
  function openWikiSearch(query) { if (_BoardSearch) _BoardSearch.openWikiSearch(query); }
  function openWikiDocument(documentName, options) { return _BoardSearch ? _BoardSearch.openWikiDocument(documentName, options) : Promise.resolve({ kind: 'unknown' }); }
  function exitSearchMode() { if (_BoardSearch) _BoardSearch.exitSearchMode(); }
  function parseOptionalSearchIndex(value) { return _BoardSearch ? _BoardSearch.parseOptionalSearchIndex(value) : null; }
  function buildSearchResultLocation(item) { return _BoardSearch ? _BoardSearch.buildSearchResultLocation(item) : ''; }
  function buildHierarchyFocusTargetFromTreeNode(node, boardId) { return _BoardSearch ? _BoardSearch.buildHierarchyFocusTargetFromTreeNode(node, boardId) : null; }
  function findBoardEntityElement(target) { return _BoardSearch ? _BoardSearch.findBoardEntityElement(target) : null; }
  function focusHierarchyTargetLocally(target) { return _BoardSearch ? _BoardSearch.focusHierarchyTargetLocally(target) : false; }
  function unfoldSearchTarget(result) { return _BoardSearch ? _BoardSearch.unfoldSearchTarget(result) : null; }
  function navigateToHierarchyTarget(target, options) { return _BoardSearch ? _BoardSearch.navigateToHierarchyTarget(target, options) : Promise.resolve(false); }
  function focusSearchResultCard(result) { return _BoardSearch ? _BoardSearch.focusSearchResultCard(result) : false; }
  function navigateToSearchResult(result) { return _BoardSearch ? _BoardSearch.navigateToSearchResult(result) : Promise.resolve(false); }
  function renderSearchResults() { if (_BoardSearch) _BoardSearch.renderSearchResults(); }

  // ── Board Tag Filter & Statistics Bar (delegated to BoardStatsFilter module) ──
  function toggleBoardTagFilter(tag) { if (BoardStatsFilter) BoardStatsFilter.toggleBoardTagFilter(tag); }
  function clearBoardTagFilter() { if (BoardStatsFilter) BoardStatsFilter.clearBoardTagFilter(); }
  function applyBoardTagFilter() { if (BoardStatsFilter) BoardStatsFilter.applyBoardTagFilter(); }
  function renderBoardTagFilterBar() { if (BoardStatsFilter) BoardStatsFilter.renderBoardTagFilterBar(); }
  function toggleBoardStatsBar() { if (BoardStatsFilter) BoardStatsFilter.toggleBoardStatsBar(); }
  function renderBoardStatsBar() { if (BoardStatsFilter) BoardStatsFilter.renderBoardStatsBar(); }

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
      getCurrentCardEditor: function () { return CardEditorModule ? CardEditorModule.getCurrentCardEditor() : null; },
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

  // --- Media Category (delegated to LexeraMediaCategory) ---

  var _MediaCategory = typeof LexeraMediaCategory !== 'undefined' ? LexeraMediaCategory : null;
  function _initMediaCategory() {
    if (_MediaCategory && _MediaCategory.init) {
      _MediaCategory.init({
        isExternalHttpUrl: isExternalHttpUrl,
        normalizeFilePathForDetection: normalizeFilePathForDetection,
        getFileNameFromPath: getFileNameFromPath
      });
    }
  }

  function getMediaCategory(ext) { return _MediaCategory ? _MediaCategory.getMediaCategory(ext) : 'unknown'; }
  function inferExternalMediaCategoryFromUrl(url) { return _MediaCategory ? _MediaCategory.inferExternalMediaCategoryFromUrl(url) : ''; }
  function getFileExtension(path) { return _MediaCategory ? _MediaCategory.getFileExtension(path) : ''; }
  function getInlineFileEmbedExtension(path) { return _MediaCategory ? _MediaCategory.getInlineFileEmbedExtension(path) : ''; }
  _initMediaCategory();

  // --- Card Collapse --- (delegated to LexeraCardCollapse module)
  var CardCollapse = window.LexeraCardCollapse;
  if (CardCollapse) CardCollapse.init({ logFrontendIssue: function () { return logFrontendIssue.apply(null, arguments); }, getElColumnsContainer: function () { return getElColumnsContainer(); } });
  function collectBoardCardIds(rows) { return CardCollapse ? CardCollapse.collectBoardCardIds(rows) : []; }
  function getCollapsedCards(boardId, rows) { return CardCollapse ? CardCollapse.getCollapsedCards(boardId, rows) : []; }
  function saveCardCollapseState(boardId) { if (CardCollapse) CardCollapse.saveCardCollapseState(boardId); }

  // --- Board Header --- (delegated to LexeraBoardHeader module)
  if (BoardHeader) BoardHeader.init({
    getIncomingCount: function () { return getIncomingCount(); },
    getParkedCount: function () { return getParkedCount(); },
    getArchivedCount: function () { return getArchivedCount(); },
    getDeletedCount: function () { return getDeletedCount(); },
    getActiveBoardFilePath: function () { return getActiveBoardFilePath(); },
    getActiveBoardData: function () { return activeBoardData; },
    getActiveBoardId: function () { return activeBoardId; },
    getFullBoardData: function () { return fullBoardData; },
    getConnected: function () { return connected; },
    getEmbeddedMode: function () { return embeddedMode; },
    BURGER_MENU_ICON_HTML: BURGER_MENU_ICON_HTML,
    DRAG_THRESHOLD: DRAG_THRESHOLD,
    getDisplayFileNameFromPath: function (p) { return getDisplayFileNameFromPath(p); },
    escapeAttr: function (s) { return escapeAttr(s); },
    escapeHtml: function (s) { return escapeHtml(s); },
    getElBoardHeader: function () { return getElBoardHeader(); },
    applyTagStyleToEntity: function (el, title) { applyTagStyleToEntity(el, title); },
    loadTemplatesOnce: function () { loadTemplatesOnce(); },
    notifyParentPaneActivated: function () { notifyParentPaneActivated(); },
    renameActiveBoardFile: function () { renameActiveBoardFile(); },
    showFilenameContextMenu: function (x, y) { showFilenameContextMenu(x, y); },
    showFileHeaderSettingsMenu: function (btn) { return showFileHeaderSettingsMenu(btn); },
    isBoardDirty: function () { return isBoardDirty(); },
    handleBoardAction: function (action) { handleBoardAction(action); },
    showSaveTrackingMenu: function (btn, x, y) { showSaveTrackingMenu(btn, x, y); },
    showThemeZoomMenu: function (btn) { showThemeZoomMenu(btn); },
    showHeaderSourceDropdown: function (mode, btn) { showHeaderSourceDropdown(mode, btn); },
    showIncomingItems: function (btn) { showIncomingItems(btn); },
    triggerBoardExport: function () { return triggerBoardExport(); },
    showParkedItems: function (btn) { showParkedItems(btn); },
    showArchivedItems: function (btn) { showArchivedItems(btn); },
    showDeletedItems: function (btn) { showDeletedItems(btn); },
    showBoardContextMenu: function (x, y) { showBoardContextMenu(x, y); },
    getBoardSettingValue: function (key, def) { return getBoardSettingValue(key, def); },
    getSavedLayoutPresets: function () { return typeof getSavedLayoutPresets === 'function' ? getSavedLayoutPresets() : {}; },
    getTagCategoryKey: function (tag) { return getTagCategoryKey(tag); },
    getResolvedCategoryRole: function (key) { return getResolvedCategoryRole(key); },
    resolveCardDropTarget: function (mx, my) { return resolveCardDropTarget(mx, my); },
    resolveFlatColumnIndexForCreationDescriptor: function (d) { return resolveFlatColumnIndexForCreationDescriptor(d); },
    findDraggableColumnAt: function (mx, my) { return findDraggableColumnAt(mx, my); },
    findFullDataStack: function (r, s) { return findFullDataStack(r, s); },
    findInsertColumnIndexInStack: function (stack, colIdx, before) { return findInsertColumnIndexInStack(stack, colIdx, before); },
    findBoardStackAt: function (mx, my) { return findBoardStackAt(mx, my); },
    getTreeColumnDropTarget: function (mx, my) { return getTreeColumnDropTarget(mx, my); },
    getTreeStackDropTarget: function (mx, my) { return getTreeStackDropTarget(mx, my); },
    resolveRowBodyDropTarget: function (mx, my) { return resolveRowBodyDropTarget(mx, my); },
    getRowDropTarget: function (mx, my) { return getRowDropTarget(mx, my); },
    getElColumnsContainer: function () { return getElColumnsContainer(); },
    isPointInsideRect: function (mx, my, rect) { return isPointInsideRect(mx, my, rect); },
    getStackDropTarget: function (mx, my) { return getStackDropTarget(mx, my); },
    findNodeAtPoint: function (nodeList, mx, my) { return findNodeAtPoint(nodeList, mx, my); },
    getElBoardList: function () { return getElBoardList(); },
    DragDropHandlers_resolveHeaderDropTag: function (mx, my) { return DragDropHandlers ? DragDropHandlers.resolveHeaderDropTag(mx, my) : null; },
    removeStackDropZones: function () { removeStackDropZones(); },
    removeDropZoneIndicators: function () { removeDropZoneIndicators(); },
    clearPtrDropIndicators: function () { clearPtrDropIndicators(); },
    clearCardDropIndicators: function () { clearCardDropIndicators(); },
    clearSidebarDropHighlights: function () { clearSidebarDropHighlights(); },
    clearCardDragOverHighlights: function () { clearCardDragOverHighlights(); },
    clearHeaderDropTargetHighlights: function () { clearHeaderDropTargetHighlights(); },
    clearDropZoneIndicatorHighlights: function () { clearDropZoneIndicatorHighlights(); },
    updateCardDropTarget: function (mx, my) { return updateCardDropTarget(mx, my); },
    updatePtrDropTargetByType: function (type, mx, my) { return updatePtrDropTargetByType(type, mx, my); },
    getPtrDrag: function () { return DragDropHandlers ? DragDropHandlers.getPtrDrag() : null; },
    getCardDrag: function () { return DragDropHandlers ? DragDropHandlers.getCardDrag() : null; },
    insertStackDropZones: function () { insertStackDropZones(); },
    insertDropZoneIndicators: function (dragType) { insertDropZoneIndicators(dragType); },
    setSuppressHeaderCreationClickUntil: function (v) { suppressHeaderCreationClickUntil = v; },
    applyHeaderCreationDragDrop: function (mode, target, x, y) { return applyHeaderCreationDragDrop(mode, target, x, y); },
    logFrontendIssue: function (level, area, msg, err) { logFrontendIssue(level, area, msg, err); },
    showNotification: function (msg) { showNotification(msg); },
    areAllColumnsFolded: function () { return areAllColumnsFolded(); },
    areAllCardsCollapsed: function () { return areAllCardsCollapsed(); },
    isCanvasBoardLayout: function () { return isCanvasBoardLayout(); },
    getHeaderSavingInProgress: function () { return _headerSavingInProgress; }
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

  // --- Util (delegated to LexeraAppUtils module – utils/appUtils.js) ---

  var _AppUtils = typeof LexeraAppUtils !== 'undefined' ? LexeraAppUtils : null;

  function renderTable(lines, startIdx, boardId, renderState) { return _AppUtils ? _AppUtils.renderTable(lines, startIdx, boardId, renderState) : ''; }
  function flushPendingDiagramQueues() { if (_AppUtils) _AppUtils.flushPendingDiagramQueues(); }
  function escapeRegex(str) { return _AppUtils ? _AppUtils.escapeRegex(str) : String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function applyAbbreviationsToHtml(html, abbrDefs) { return _AppUtils ? _AppUtils.applyAbbreviationsToHtml(html, abbrDefs) : html; }

  if (_AppUtils) _AppUtils.init({
    handleDiagramAction: handleDiagramAction,
    requestRenderedPlantUmlSvg: requestRenderedPlantUmlSvg,
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr
  });

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
  function vsRemeasureColumn(colIndex) { if (VirtualScroll) VirtualScroll.remeasureColumn(colIndex); }

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
      if (columns.length > 0) { showInlineAddComposer(columns[0].index); }
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
      settingsKey: 'columnWidth', actionPrefix: 'set-column-width', defaultValue: '350px',
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
      'layoutRows', 'rowHeight', 'cardMinHeight', 'layoutSpacing'
    ];
    var LAYOUT_PRESETS_STORAGE_KEY = 'lexera-layout-presets';

    function getSavedLayoutPresets() {
      if (Settings) return Settings.get('layoutPresets') || {};
      try { return JSON.parse(localStorage.getItem(LAYOUT_PRESETS_STORAGE_KEY)) || {}; }
      catch (_) { return {}; } /* localStorage/JSON parse fallback */
    }

    function saveLayoutPreset(name, settings) {
      var presets = getSavedLayoutPresets();
      presets[name] = settings;
      if (Settings) Settings.set('layoutPresets', presets); else localStorage.setItem(LAYOUT_PRESETS_STORAGE_KEY, JSON.stringify(presets));
    }

    function deleteLayoutPreset(name) {
      var presets = getSavedLayoutPresets();
      delete presets[name];
      if (Settings) Settings.set('layoutPresets', presets); else localStorage.setItem(LAYOUT_PRESETS_STORAGE_KEY, JSON.stringify(presets));
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
    // stickyHeaders registry entry removed — always sticky at top
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
      settingsKey: null, actionPrefix: 'set-visual-theme', defaultValue: 'sleek-uniform',
      getCurrentValue: function () {
        return (typeof getLexeraCurrentVisualThemeId === 'function' && getLexeraCurrentVisualThemeId()) || 'sleek-uniform';
      },
      handler: function (raw) {
        var applied = applyVisualTheme(raw);
        var label = (applied && applied.name) || VISUAL_THEME_LABELS[String(raw || '').trim()] || String(raw || 'sleek-uniform');
        showNotification('Visual theme: ' + label);
      },
      options: function () {
        return VISUAL_THEMES.map(function (theme) {
          return {
            value: theme.id,
            label: theme.name + (theme.description ? ' \u2014 ' + theme.description : '')
          };
        });
      }
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
    // pin-headers/unpin-headers actions removed — always sticky at top
    ActionRegistry.register('board', 'toggle-overlay-editor', function () { setOverlayEditorEnabled(!isOverlayEditorEnabled()); syncMenuCheckStates(); });
    ActionRegistry.register('board', 'toggle-special-chars', function () { setSpecialCharactersVisible(!isSpecialCharactersVisible()); syncMenuCheckStates(); });
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
    ActionRegistry.register('board', 'set-canvas-zoom:*', function (action) {
      var zoom = parseFloat(action.substring('set-canvas-zoom:'.length));
      if (isFinite(zoom) && zoom > 0) applyCanvasZoom(zoom);
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
    ActionRegistry.register('board', 'reveal-panel:weekCalendar', function () {
      if (WorkspaceShell) WorkspaceShell.revealPanel('weekCalendar');
    });
    ActionRegistry.register('board', 'reveal-panel:monthCalendar', function () {
      if (WorkspaceShell) WorkspaceShell.revealPanel('monthCalendar');
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
    ActionRegistry.register('card', 'add-card', function (action, ctx) { showInlineAddComposer(ctx.colIndex); });
    ActionRegistry.register('card', 'edit', function (action, ctx) {
      var els = getElColumnsContainer().querySelectorAll('.card[data-col-index="' + ctx.colIndex + '"][data-card-index="' + ctx.cardIndex + '"]');
      if (els.length > 0) openCardEditor(els[0], ctx.colIndex, ctx.cardIndex, 'inline');
    });
    ActionRegistry.register('card', 'edit-inline', function (action, ctx) {
      var els = getElColumnsContainer().querySelectorAll('.card[data-col-index="' + ctx.colIndex + '"][data-card-index="' + ctx.cardIndex + '"]');
      if (els.length > 0) openCardEditor(els[0], ctx.colIndex, ctx.cardIndex, 'inline');
    });
    ActionRegistry.register('card', 'edit-overlay', function (action, ctx) {
      // Overlay editor is always available — the setting only controls the DEFAULT editor
      var els = getElColumnsContainer().querySelectorAll('.card[data-col-index="' + ctx.colIndex + '"][data-card-index="' + ctx.cardIndex + '"]');
      if (els.length > 0) openCardEditor(els[0], ctx.colIndex, ctx.cardIndex, 'overlay');
    });
    ActionRegistry.register('card', 'reveal', function (action, ctx) { revealCardContent(ctx.colIndex, ctx.cardIndex); });
    ActionRegistry.register('card', 'copy-markdown', function (action, ctx) { copyElementAsMarkdown('card', { colIndex: ctx.colIndex, cardIndex: ctx.cardIndex }); });
    ActionRegistry.register('card', 'copy-html', function (action, ctx) {
      var cardEl = findVisibleCardElement(ctx.colIndex, ctx.cardIndex);
      if (!cardEl) return;
      var contentEl = cardEl.querySelector('.card-content');
      if (!contentEl) return;
      var html = contentEl.innerHTML;
      if (navigator.clipboard && navigator.clipboard.write) {
        navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([contentEl.textContent || ''], { type: 'text/plain' })
        })]).catch(function () {
          // Fallback to text
          if (navigator.clipboard.writeText) navigator.clipboard.writeText(contentEl.textContent || '');
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(contentEl.textContent || '');
      }
    });
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
    ActionRegistry.register('column', 'add-card', function (action, ctx) { showInlineAddComposer(ctx.colIndex); });
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

    // ── LexeraRowStackMenu init ──
    if (_RSM) {
      _RSM.init({
        getFullBoardData: function () { return fullBoardData; },
        getActiveBoardData: function () { return activeBoardData; },
        getActiveBoardId: function () { return activeBoardId; },
        getFullColumn: function (idx) { return getFullColumn(idx); },
        getFullCardIndex: function (col, visIdx) { return getFullCardIndex(col, visIdx); },
        getElColumnsContainer: function () { return getElColumnsContainer(); },
        findFullDataRow: function (rowIdx) { return findFullDataRow(rowIdx); },
        findFullDataStack: function (rowIdx, stackIdx) { return findFullDataStack(rowIdx, stackIdx); },
        findFullDataStackIndex: function (row, rowIdx, stackIdx) { return findFullDataStackIndex(row, rowIdx, stackIdx); },
        findInsertRowIndex: function (atIndex) { return findInsertRowIndex(atIndex); },
        findInsertStackIndexInRow: function (row, rowIdx, atStackIdx) { return findInsertStackIndexInRow(row, rowIdx, atStackIdx); },
        pushUndo: function () { pushUndo(); },
        persistBoardMutation: function (opts) { return persistBoardMutation(opts); },
        closeColumnContextMenu: function () { closeColumnContextMenu(); },
        closeCardContextMenu: function () { closeCardContextMenu(); },
        showNativeMenu: function (items, x, y, id) { return showNativeMenu(items, x, y, id); },
        showNotification: function (msg) { showNotification(msg); },
        showConfirmDialog: function (msg) { return showConfirmDialog(msg); },
        logFrontendIssue: function (level, area, msg, data) { logFrontendIssue(level, area, msg, data); },
        traceFrontendAction: function (level, area, msg, data) { traceFrontendAction(level, area, msg, data); },
        lexeraLog: function (level, msg) { lexeraLog(level, msg); },
        stripHtmlComments: function (text) { return stripHtmlComments(text); },
        rebuildTitleWithPreservedComments: function (newTitle, oldTitle) { return rebuildTitleWithPreservedComments(newTitle, oldTitle); },
        getColumnLayoutTags: function (title) { return getColumnLayoutTags(title); },
        extractIncludePathFromTitle: function (title) { return extractIncludePathFromTitle(title); },
        getColumnSortState: function () { return _ColCtx ? _ColCtx.getColumnSortState() : {}; },
        applyDefaultCanvasPlacementToStack: function (row, stack) { applyDefaultCanvasPlacementToStack(row, stack); },
        isCanvasBoardLayout: function () { return isCanvasBoardLayout(); },
        applyInternalHiddenTag: function (title, tag) { return applyInternalHiddenTag(title, tag); },
        stripInternalHiddenTags: function (text) { return stripInternalHiddenTags(text); },
        is_archived_or_deleted: function (text) { return is_archived_or_deleted(text); },
        summarizeBoardHierarchy: function (bd) { return summarizeBoardHierarchy(bd); },
        prioritizeDrawioAndExcalidrawTemplates: function (entityType, templates) { return prioritizeDrawioAndExcalidrawTemplates(entityType, templates); },
        addEmptyCardToActiveBoard: function (colIndex, atCardIndex, insertMode) { return addEmptyCardToActiveBoard(colIndex, atCardIndex, insertMode); },
        addCardToActiveBoard: function (colIndex, content, atCardIndex, insertMode) { return addCardToActiveBoard(colIndex, content, atCardIndex, insertMode); }
      });
    }

    // ── LexeraColumnContextMenu init ──
    if (window.LexeraColumnContextMenu) {
      LexeraColumnContextMenu.init({
        getFullBoardData: function () { return fullBoardData; },
        getActiveBoardId: function () { return activeBoardId; },
        getFullColumn: function (idx) { return getFullColumn(idx); },
        findFullDataRow: function (rowIdx) { return findFullDataRow(rowIdx); },
        findFullDataStack: function (rowIdx, stackIdx) { return findFullDataStack(rowIdx, stackIdx); },
        getAllColumnsFromBoardData: function (bd) { return getAllColumnsFromBoardData(bd); },
        pushUndo: function () { pushUndo(); },
        persistBoardMutation: function (opts) { return persistBoardMutation(opts); },
        showElementContextMenu: function (scope, x, y, ctx) { showElementContextMenu(scope, x, y, ctx); },
        showNotification: function (msg) { showNotification(msg); },
        showConfirmDialog: function (msg) { return showConfirmDialog(msg); },
        traceFrontendAction: function (level, area, msg, data) { traceFrontendAction(level, area, msg, data); },
        reconstructColumnTitle: function (newTitle, oldTitle) { return reconstructColumnTitle(newTitle, oldTitle); },
        addIncludeSyntaxToTitle: function (title, path) { return addIncludeSyntaxToTitle(title, path); },
        removeIncludeSyntaxFromTitle: function (title) { return removeIncludeSyntaxFromTitle(title); },
        extractIncludePathFromTitle: function (title) { return extractIncludePathFromTitle(title); },
        suggestIncludePathForColumn: function (title) { return suggestIncludePathForColumn(title); },
        getDisplayNameFromPath: function (p) { return getDisplayNameFromPath(p); },
        applyInternalHiddenTag: function (content, tag) { return applyInternalHiddenTag(content, tag); },
        removeEmptyStacksAndRows: function () { removeEmptyStacksAndRows(); },
        stripLayoutTags: function (title) { return stripLayoutTags(title); },
        renderTitleInline: function (title, boardId, opts) { return renderTitleInline(title, boardId, opts); },
        is_archived_or_deleted: function (content) { return is_archived_or_deleted(content); },
        isCanvasBoardLayout: function () { return isCanvasBoardLayout(); },
        getElColumnsContainer: function () { return getElColumnsContainer(); },
        saveCardCollapseState: function (boardId) { saveCardCollapseState(boardId); },
        collectHeaderTagTokens: function (content, opts) { return collectHeaderTagTokens(content, opts); },
        getTemporalTagType: function (token) { return getTemporalTagType(token); },
        resolveTemporalTag: function (token) { return resolveTemporalTag(token); },
        isNumericIndexTag: function (token) { return isNumericIndexTag(token); }
      });
    }

    // ── CardContextMenu init ──
    if (window.CardContextMenu) {
      CardContextMenu.init({
        ContextMenuBuilders: window.ContextMenuBuilders,
        LexeraTagSystem: LexeraTagSystem,
        getFullBoardData: function () { return fullBoardData; },
        getActiveBoardId: function () { return activeBoardId; },
        getFullColumn: function (idx) { return getFullColumn(idx); },
        getFullCardIndex: function (col, visIdx) { return getFullCardIndex(col, visIdx); },
        findFullDataRow: function (rowIdx) { return findFullDataRow(rowIdx); },
        findFullDataStack: function (rowIdx, stackIdx) { return findFullDataStack(rowIdx, stackIdx); },
        pushUndo: function () { pushUndo(); },
        persistBoardMutation: function (opts) { return persistBoardMutation(opts); },
        applyInternalHiddenTag: function (content, tag) { return applyInternalHiddenTag(content, tag); },
        showElementContextMenu: function (scope, x, y, ctx) { showElementContextMenu(scope, x, y, ctx); },
        showNotification: function (msg) { showNotification(msg); },
        logFrontendIssue: function (level, area, msg, err) { logFrontendIssue(level, area, msg, err); },
        hasTag: function (text, tag) { return hasTag(text, tag); },
        extractAllTags: function (text) { return extractAllTags(text); },
        escapeRegex: function (str) { return escapeRegex(str); },
        findVisibleCardElement: function (ci, cj) { return findVisibleCardElement(ci, cj); },
        renderCardDisplayState: function (el, content) { renderCardDisplayState(el, content); },
        applyTagStyleToEntity: function (el, text) { applyTagStyleToEntity(el, text); },
        getElColumnsContainer: function () { return getElColumnsContainer(); },
        stripLayoutTags: function (text) { return stripLayoutTags(text); },
        renderTitleInline: function (title, boardId, opts) { return renderTitleInline(title, boardId, opts); },
        formatMenuToggleLabel: function (enabled, label) { return formatMenuToggleLabel(enabled, label); },
        getActiveBoardFilePath: function () { return getActiveBoardFilePath(); },
        getDirNameFromPath: function (p) { return getDirNameFromPath(p); },
        normalizePathForCompare: function (p) { return normalizePathForCompare(p); },
        copyTextToClipboard: function (t, s, f) { return copyTextToClipboard(t, s, f); },
        getBoardMarpFrontmatter: function () { return getBoardMarpFrontmatter(); },
        setBoardFrontmatterValue: function (key, value) { return setBoardFrontmatterValue(key, value); },
        normalizeYamlFrontmatterScalar: function (value) { return normalizeYamlFrontmatterScalar(value); },
        getWhitespaceTokenList: function (value) { return getWhitespaceTokenList(value); },
        setWhitespaceTokenList: function (tokens) { return setWhitespaceTokenList(tokens); }
      });
    }

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
if (typeof window !== 'undefined') window.LexeraDashboard = LexeraDashboard;
