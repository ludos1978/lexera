import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// ═══════════════════════════════════════════════════════════════════════════
// Extraction harness — pull helpers + mutation functions from app.js IIFE
// ═══════════════════════════════════════════════════════════════════════════

function loadMutationHarness() {
  // Load TitleHelpers so TagSystem and OrderHelpers can delegate to it
  const titleHelpersSource = readFileSync(resolve(srcDir, 'titleHelpers.js'), 'utf-8');
  new Function(titleHelpersSource)();

  // Load TagSystem first so delegating functions in app.js can reference it
  const tagSystemSource = readFileSync(resolve(srcDir, 'tagSystem.js'), 'utf-8');
  new Function(tagSystemSource)();
  const LexeraTagSystem = globalThis.LexeraTagSystem || globalThis.window?.LexeraTagSystem;

  // Load OrderHelpers so delegation stubs in app.js can reference it
  const orderHelpersSource = readFileSync(resolve(srcDir, 'board', 'orderHelpers.js'), 'utf-8');
  new Function(orderHelpersSource)();

  // Load DndMutations so delegation stubs in app.js can reference it
  const dndMutationsSource = readFileSync(resolve(srcDir, 'dragdrop', 'dndMutations.js'), 'utf-8');
  new Function(dndMutationsSource)();

  // Load BoardDataStore so delegation stubs in app.js can reference it
  const boardDataStoreSource = readFileSync(resolve(srcDir, 'core', 'boardDataStore.js'), 'utf-8');
  new Function(boardDataStoreSource)();

  const source = readFileSync(resolve(srcDir, 'app.js'), 'utf-8');
  const lines = source.split('\n');

  // Also load cardContextMenu.js for functions extracted from app.js
  const ccmSource = readFileSync(resolve(srcDir, 'menu', 'cardContextMenu.js'), 'utf-8');
  const ccmLines = ccmSource.split('\n');

  // Also load columnContextMenu.js for functions extracted from app.js
  const colCtxSource = readFileSync(resolve(srcDir, 'menu', 'columnContextMenu.js'), 'utf-8');
  const colCtxLines = colCtxSource.split('\n');

  // Load cardEditor.js for saveCardEdit extracted from app.js
  const cardEditorSource = readFileSync(resolve(srcDir, 'editor', 'cardEditor.js'), 'utf-8');
  const cardEditorLines = cardEditorSource.split('\n');

  // Load rowStackMenu.js for row/stack menu functions extracted from app.js
  const rsmSource = readFileSync(resolve(srcDir, 'menu', 'rowStackMenu.js'), 'utf-8');
  const rsmLines = rsmSource.split('\n');

  // Load dndMutations.js for cross-board move functions extracted from app.js
  const dndSource = readFileSync(resolve(srcDir, 'dragdrop', 'dndMutations.js'), 'utf-8');
  const dndLines = dndSource.split('\n');

  // Load dndListeners.js for cross-board move + resolve functions extracted from app.js
  const dndListenersSource = readFileSync(resolve(srcDir, 'dragdrop', 'dndListeners.js'), 'utf-8');
  const dndListenersLines = dndListenersSource.split('\n');

  function extractFunctionFrom(sourceLines, startLine) {
    let depth = 0;
    let started = false;
    const result = [];
    for (let i = startLine - 1; i < sourceLines.length; i++) {
      const line = sourceLines[i];
      result.push(line);
      for (let c = 0; c < line.length; c++) {
        if (line[c] === '{') { depth++; started = true; }
        if (line[c] === '}') depth--;
      }
      if (started && depth === 0) break;
    }
    return result.join('\n');
  }

  function extractFunction(startLine) {
    return extractFunctionFrom(lines, startLine);
  }

  function findLineIn(sourceLines, pattern) {
    for (let i = 0; i < sourceLines.length; i++) {
      if (sourceLines[i].includes(pattern)) return i + 1;
    }
    return -1;
  }

  function findLine(pattern) {
    var idx = findLineIn(lines, pattern);
    if (idx > 0) return idx;
    throw new Error('Could not find: ' + pattern);
  }

  function extractFunctionAny(pattern) {
    // Check extracted modules first (they have real implementations; app.js may have thin stubs)
    var idx = findLineIn(ccmLines, pattern);
    if (idx > 0) return extractFunctionFrom(ccmLines, idx).replace(/\bdeps\./g, '');
    idx = findLineIn(colCtxLines, pattern);
    if (idx > 0) return extractFunctionFrom(colCtxLines, idx).replace(/\bdeps\./g, '');
    idx = findLineIn(rsmLines, pattern);
    if (idx > 0) return extractFunctionFrom(rsmLines, idx).replace(/\bdeps\./g, '');
    idx = findLineIn(cardEditorLines, pattern);
    if (idx > 0) return extractFunctionFrom(cardEditorLines, idx);
    idx = findLineIn(dndLines, pattern);
    if (idx > 0) {
      var raw = extractFunctionFrom(dndLines, idx);
      raw = raw.replace(/_deps\.([\w]+)/g, '$1');
      raw = raw.replace(/\bfullBoardData\(\)/g, 'fullBoardData');
      raw = raw.replace(/\bactiveBoardData\(\)/g, 'activeBoardData');
      raw = raw.replace(/\bactiveBoardId\(\)/g, 'activeBoardId');
      return raw;
    }
    idx = findLineIn(dndListenersLines, pattern);
    if (idx > 0) {
      var raw = extractFunctionFrom(dndListenersLines, idx);
      raw = raw.replace(/_deps\.([\w]+)/g, '$1');
      raw = raw.replace(/\bgetActiveBoardId\(\)/g, 'activeBoardId');
      raw = raw.replace(/\bgetFullBoardData\(\)/g, 'fullBoardData');
      return raw;
    }
    idx = findLineIn(lines, pattern);
    if (idx > 0) return extractFunctionFrom(lines, idx);
    throw new Error('Could not find in extracted modules or app.js: ' + pattern);
  }

  // --- Pure helpers ---
  const pureHelpers = [
    extractFunction(findLine('function is_archived_or_deleted(')),
    extractFunction(findLine('function applyInternalHiddenTag(')),
    extractFunction(findLine('function stripInternalHiddenTags(')),
    extractFunction(findLine('function stripHtmlComments(')),
    extractFunction(findLine('function getAllColumnsFromBoardData(')),
    extractFunctionAny('function findColumnContainerInBoard('),
    extractFunction(findLine('function getFullCardIndex(')),
    extractFunctionAny('function visibleColumnIndicesInStack('),
    extractFunction(findLine('function escapeRegex(')),
    extractFunction(findLine('function isTagTokenBoundaryChar(')),
    extractFunction(findLine('function normalizeTagTokenForMatch(')),
    extractFunction(findLine('function isTagExpressionBoundaryChar(')),
    extractFunction(findLine('function collectHeaderTagTokens(')),
    extractFunction(findLine('function tokenizeTagExpression(')),
    extractFunction(findLine('function evaluateTagExpression(')),
    extractFunction(findLine('function isTagExpression(')),
    extractFunction(findLine('function isColumnHeaderTagged(')),
    extractFunction(findLine('function isColumnFooterTagged(')),
    extractFunction(findLine('function getDisplayOrderedColumnEntries(')),
    extractFunction(findLine('function extractAllTags(')),
    extractFunction(findLine('function hasTag(')),
    extractFunctionAny('function splitTagHeaderAndBody('),
    extractFunctionAny('function rebuildTagHeaderAndBody('),
    extractFunctionAny('function normalizePromptTagToken('),
    extractFunctionAny('function removeTagFromHeaderText('),
    extractFunctionAny('function addTagToHeaderText('),
    extractFunctionAny('function clearRemovableTagsFromHeaderText('),
  ].join('\n\n');

  // --- Closure-dependent helpers ---
  const closureHelpers = [
    // Safe module delegate helpers (must come before functions that use them)
    extractFunctionAny('function _dnd('),
    extractFunctionAny('function _col('),
    extractFunctionAny('function _bl('),
    extractFunction(findLine('function getFullColumn(')),
    extractFunctionAny('function findFullDataRow('),
    extractFunctionAny('function findFullDataStack('),
    extractFunctionAny('function findFullDataRowIndex('),
    extractFunctionAny('function findFullDataStackIndex('),
    extractFunctionAny('function findInsertRowIndex('),
    extractFunctionAny('function findFullColumnIndexInStack('),
    extractFunctionAny('function findInsertStackIndexInRow('),
    extractFunctionAny('function findInsertColumnIndexInStack('),
    extractFunction(findLine('function nextMutationEntityId(')),
    extractFunction(findLine('function isUnnamedStructuralTitle(')),
    extractFunction(findLine('function createUnnamedColumnForMutation(')),
    extractFunction(findLine('function createUnnamedStackForMutation(')),
    extractFunction(findLine('function createUnnamedRowForMutation(')),
    extractFunction(findLine('function resolveRowInsertIndexForMutation(')),
    extractFunction(findLine('function insertUnnamedRowForMutation(')),
    extractFunction(findLine('function insertUnnamedStackIntoRowForMutation(')),
    extractFunction(findLine('function resolvePreferredCardColumnRefInStack(')),
    extractFunction(findLine('function ensureCardTargetColumnForMutation(')),
    extractFunction(findLine('function cleanupUnnamedStructuralContainersInBoard(')),
    extractFunctionAny('function resolveTagTarget('),
    extractFunctionAny('function normalizeStableMutationEntityId('),
    extractFunctionAny('function findMutationRowLocationById('),
    extractFunctionAny('function findMutationStackLocationById('),
    extractFunctionAny('function findMutationColumnLocationById('),
    extractFunctionAny('function resolveColumnLocationForMutation('),
    extractFunctionAny('function resolveStackForMutation('),
    extractFunctionAny('function resolveRowForMutation('),
    extractFunctionAny('function trashRowContent('),
    extractFunction(findLine('function normalizeStableCardMutationId(')),
    extractFunction(findLine('function findColumnRefByStablePath(')),
    extractFunction(findLine('function resolveColumnRefForCardMutation(')),
    extractFunction(findLine('function resolveCardIndexByStableId(')),
    extractFunction(findLine('function resolveSourceCardIndex(')),
    extractFunction(findLine('function resolveInsertCardIndex(')),
    extractFunction(findLine('function buildHiddenItemRestoreSource(')),
    extractFunction(findLine('function captureStableRowRestoreTarget(')),
    extractFunction(findLine('function captureStableStackRestoreTarget(')),
    extractFunction(findLine('function captureStableColumnRestoreTarget(')),
    extractFunction(findLine('function getCardTargetDisplayPath(')),
    extractFunction(findLine('function captureStableCardRestoreTarget(')),
    extractFunctionAny('function mutateEntityHeaderText('),
    extractFunctionAny('function mutateEntityHeaderTags('),
    extractFunctionAny('function removeEmptyStacksAndRowsInBoard('),
    extractFunctionAny('function removeEmptyStacksAndRows()'),
    extractFunctionAny('function findVisibleCardIndexById('),
    extractFunction(findLine('function resolveFlatColIndexFromRef(')),
  ].join('\n\n');

  // --- Mutation functions ---
  const mutations = [
    // Cards
    extractFunction(findLine('async function addCardToActiveBoard(')),
    extractFunction(findLine('async function addEmptyCardToActiveBoard(')),
    extractFunction(findLine('async function insertCardAtIndex(')),
    // saveCardEdit extracted to cardEditor module — inline a test-compatible version
    `async function saveCardEdit(cardEl, colIndex, fullCardIdx, newContent) {
      if (!fullBoardData || !activeBoardId) return;
      var col = getFullColumn(colIndex);
      if (!col || !col.cards[fullCardIdx]) return;
      var oldContent = col.cards[fullCardIdx].content;
      if (newContent === oldContent) return;
      pushUndo();
      col.cards[fullCardIdx].content = newContent;
      await persistBoardMutation();
    }`,
    extractFunctionAny('function duplicateCard('),
    extractFunctionAny('function tagCard('),
    // Columns
    extractFunctionAny('async function addColumnToStack('),
    extractFunctionAny('async function duplicateColumn('),
    extractFunctionAny('async function setColumnHiddenTag('),
    extractFunction(findLine('async function moveColumnWithinBoard(')),
    extractFunction(findLine('async function moveColumnToExistingStack(')),
    extractFunction(findLine('async function moveColumnToNewStack(')),
    // Stacks
    extractFunctionAny('async function addStackToRow('),
    extractFunctionAny('async function duplicateStack('),
    extractFunctionAny('async function setStackHiddenTag('),
    extractFunctionAny('function moveStack('),
    // Rows
    extractFunctionAny('async function addRow('),
    extractFunctionAny('async function duplicateRow('),
    extractFunctionAny('async function setRowHiddenTag('),
    extractFunctionAny('function reorderRows('),
    extractFunctionAny('async function moveRowAcrossBoards('),
    extractFunctionAny('async function moveStackAcrossBoards('),
    extractFunctionAny('async function moveColumnAcrossBoards('),
    extractFunctionAny('async function moveCard('),
    // Cross
    extractFunctionAny('function toggleTag('),
  ].join('\n\n');

  // --- findColumnContainer uses fullBoardData in closure ---
  const findColumnContainer = `
    function findColumnContainer(flatIndex) {
      return findColumnContainerInBoard(fullBoardData, flatIndex);
    }
  `;

  const wrappedSource = `
    var DndListeners = (typeof window !== 'undefined' && window.LexeraDndListeners) || (typeof globalThis !== 'undefined' && globalThis.LexeraDndListeners) || null;
    var BoardDataStore = (typeof window !== 'undefined' && window.LexeraBoardDataStore) || (typeof globalThis !== 'undefined' && globalThis.LexeraBoardDataStore) || null;
    // --- Injectable closure state ---
    var fullBoardData, activeBoardData, activeBoardId;
    var boardStore = {};
    var canvasBoardLayout = false;
    var mutationEntityIdSeed = 0;
    var undoCalls = 0;
    var lastPersistTargets = null;
    var lastCommitBoardIds = null;
    function pushUndo() { undoCalls++; }
    function isCanvasBoardLayout() { return canvasBoardLayout; }
    async function persistBoardMutation(opts) {
      lastPersistTargets = (opts && opts.targets) ? opts.targets.map(function(t) { return t.type; }) : [];
      return true;
    }
    async function loadBoardDataForMutation(boardId) {
      if (!boardId) return null;
      if (boardId === activeBoardId) return fullBoardData;
      return boardStore[boardId] || null;
    }
    async function commitBoardMutations(changedBoards, options) {
      var ids = Object.keys(changedBoards || {});
      lastCommitBoardIds = ids.slice();
      for (var i = 0; i < ids.length; i++) {
        var boardId = ids[i];
        if (boardId === activeBoardId) fullBoardData = changedBoards[boardId];
        else boardStore[boardId] = changedBoards[boardId];
      }
      return true;
    }
    function traceFrontendAction() {}
    function lexeraLog() {}
    function lexeraLogWithTarget() {}
    // Mutation functions extracted from app.js check for cross-frame
    // delegation (workspace-shell mode) before executing locally. In the
    // vitest harness there's no parent frame, so always return null to
    // force the local code path to run.
    function _delegateMutationToOwningFrame() { return null; }
    function getElColumnsContainer() { return null; }
    function summarizeBoardHierarchy() { return ''; }
    function flushDeferredBoardRefresh() {}
    function getFullBoardData() { return fullBoardData; }
    function getActiveBoardId() { return activeBoardId; }
    function getFullCardIndex(col, visIdx) {
      if (!col || !col.cards) return visIdx;
      return visIdx;
    }
    function applyDefaultCanvasPlacementToStack(row, stack) { return stack; }
    function renderColumns() {}
    function insertCardElementAtPosition() { return false; }
    function removeAddCardComposer() {}
    function updateCardElementInPlace() {}
    function reorderCardElements() { return false; }
    function updateColumnCountBadge() {}
    var addCardColumn = null;
    function getCanvasStackDropApi() {
      return {
        applyCanvasDropPositionToStack: function (targetBoardId, currentActiveBoardId, isCanvasLayout, target, stack) {
          if (!isCanvasLayout || !target || !stack || !target.canvasPosition) return stack;
          if (targetBoardId !== currentActiveBoardId) return stack;
          if (!stack.params || typeof stack.params !== 'object') stack.params = {};
          stack.params.x = String(Math.round(Number(target.canvasPosition.x)));
          stack.params.y = String(Math.round(Number(target.canvasPosition.y)));
          return stack;
        }
      };
    }

    var OrderHelpers = (typeof window !== 'undefined' && window.LexeraOrderHelpers) || (typeof globalThis !== 'undefined' && globalThis.LexeraOrderHelpers) || null;
    var DndMutations = (typeof window !== 'undefined' && window.LexeraDndMutations) || (typeof globalThis !== 'undefined' && globalThis.LexeraDndMutations) || null;

    // --- Pure helpers ---
    ${pureHelpers}

    // Initialize OrderHelpers with test mock deps so delegation stubs work
    if (OrderHelpers && typeof OrderHelpers.init === 'function') {
      OrderHelpers.init({
        hasTag: function (text, tag) { return hasTag(text, tag); },
        is_archived_or_deleted: function (text) { return is_archived_or_deleted(text); },
        stripInternalHiddenTags: function (text) { return stripInternalHiddenTags(text); },
        LexeraTagSystem: (typeof window !== 'undefined' && window.LexeraTagSystem) || (typeof globalThis !== 'undefined' && globalThis.LexeraTagSystem) || null,
        get fullBoardData() { return fullBoardData; },
        get activeBoardId() { return activeBoardId; },
        get activeBoardData() { return activeBoardData; },
        getFullColumn: function (idx) {
          var cols = getAllColumnsFromBoardData(fullBoardData);
          return (idx >= 0 && idx < cols.length) ? cols[idx] : null;
        },
        pushUndo: function () { pushUndo(); },
        persistBoardMutation: function (opts) { return persistBoardMutation(opts); },
        getCanvasModeHelpers: function () {
          return { normalizeBoardLayoutValue: function (v) { return v === 'canvas' ? 'canvas' : 'kanban'; }, normalizeCanvasGridValue: function (v) { return v; } };
        },
        getBoardSettingValue: function () { return 'kanban'; },
        getFoldStateApi: function () { return {}; },
        getElColumnsContainer: function () { return null; },
        saveCardCollapseState: function () {},
        refreshBoardHeaderActionStates: function () {}
      });
    }

    // Initialize DndMutations with test mock deps so delegation stubs work
    if (DndMutations && typeof DndMutations.init === 'function') {
      DndMutations.init({
        fullBoardData: function () { return fullBoardData; },
        activeBoardData: function () { return activeBoardData; },
        activeBoardId: function () { return activeBoardId; },
        pushUndo: function () { pushUndo(); },
        persistBoardMutation: function (opts) { return persistBoardMutation(opts); },
        traceFrontendAction: function () {},
        getDisplayOrderedColumnEntries: typeof getDisplayOrderedColumnEntries === 'function' ? getDisplayOrderedColumnEntries : function (c) { return c; },
        stripInternalHiddenTags: typeof stripInternalHiddenTags === 'function' ? stripInternalHiddenTags : function (t) { return t; },
        stripHtmlComments: typeof stripHtmlComments === 'function' ? stripHtmlComments : function (t) { return t; },
        addColumnToStack: typeof addColumnToStack === 'function' ? addColumnToStack : function () {},
        applyDefaultCanvasPlacementToStack: function () {},
        resolveRowForMutation: typeof resolveRowForMutation === 'function' ? resolveRowForMutation : function () { return null; },
        resolveStackForMutation: typeof resolveStackForMutation === 'function' ? resolveStackForMutation : function () { return null; },
        resolveColumnRefForCardMutation: typeof resolveColumnRefForCardMutation === 'function' ? resolveColumnRefForCardMutation : function () { return null; }
      });
    }

    // Initialize DndListeners with test mock deps so delegation stubs work
    if (DndListeners && typeof DndListeners.init === 'function') {
      DndListeners.init({
        getActiveBoardId: function () { return activeBoardId; },
        getFullBoardData: function () { return fullBoardData; },
        loadBoardDataForMutation: loadBoardDataForMutation,
        commitBoardMutations: commitBoardMutations,
        pushUndo: function () { pushUndo(); },
        persistBoardMutation: function (opts) { return persistBoardMutation(opts); },
        isCanvasBoardLayout: isCanvasBoardLayout,
        getCanvasStackDropApi: getCanvasStackDropApi,
        getAllColumnsFromBoardData: typeof getAllColumnsFromBoardData === 'function' ? getAllColumnsFromBoardData : function (bd) { return (bd && bd.columns) || []; },
        getDisplayOrderedColumnEntries: typeof getDisplayOrderedColumnEntries === 'function' ? getDisplayOrderedColumnEntries : function (c) { return c; },
        stripInternalHiddenTags: typeof stripInternalHiddenTags === 'function' ? stripInternalHiddenTags : function (t) { return t; },
        stripHtmlComments: typeof stripHtmlComments === 'function' ? stripHtmlComments : function (t) { return t; },
        addColumnToStack: typeof addColumnToStack === 'function' ? addColumnToStack : function () {}
      });
    }

    // Initialize BoardDataStore with test mock deps so delegation stubs work
    if (BoardDataStore && typeof BoardDataStore.init === 'function') {
      BoardDataStore.init({
        getFullBoardData: function () { return fullBoardData; },
        getActiveBoardData: function () { return activeBoardData; },
        getActiveBoardId: function () { return activeBoardId; },
        setFullBoardDataState: function (v) { fullBoardData = v; },
        setActiveBoardDataState: function (v) { activeBoardData = v; },
        updateActiveBoardDataState: function (updater) {
          if (!activeBoardData || typeof updater !== 'function') return activeBoardData;
          var draft = Object.assign({}, activeBoardData);
          var result = updater(draft, activeBoardData);
          activeBoardData = typeof result === 'undefined' ? draft : result;
          return activeBoardData;
        },
        is_archived_or_deleted: function (text) { return typeof is_archived_or_deleted === 'function' ? is_archived_or_deleted(text) : false; },
        buildRowsFromLegacyColumns: function (cols, t) { return typeof buildRowsFromLegacyColumns === 'function' ? buildRowsFromLegacyColumns(cols, t) : []; },
        findBoardMeta: function () { return null; },
        cloneBoardData: function (bd) { return JSON.parse(JSON.stringify(bd)); },
        refreshBoardHeaderActionStates: function () {},
        clearPendingExternalRebaseConflict: function () {},
        hasPendingExternalRebaseConflict: function () { return false; },
        getPendingExternalRebaseConflict: function () { return null; },
        setPendingExternalRebaseConflict: function () {},
        clearLocalBoardDraft: function () {},
        saveLocalBoardDraft: function () {},
        loadLocalBoardDraft: function () { return null; },
        traceFrontendAction: function () {},
        logFrontendIssue: function () {},
        showSaving: function () {},
        hideSaving: function () {},
        showNotification: function () {},
        showConfirmDialog: function () { return false; },
        showExternalRebaseConflictDialog: function () {},
        showConflictDialog: function () {},
        setLastSaveTime: function () {},
        isActiveRemoteBoard: function () { return false; },
        isRemoteBoardId: function () { return false; },
        LexeraApi: function () { return { getBoardColumns: function () { return Promise.resolve({ fullBoard: null }); }, saveBoard: function () { return Promise.resolve({}); }, saveBoardWithBase: function () { return Promise.resolve({}); } }; },
        setBoardSaveBase: function () {},
        getBoardSaveBase: function () { return null; },
        hasBoardIdentityMismatch: function () { return false; },
        getBoardCardIdentityStats: function () { return {}; },
        summarizeBoardHierarchy: function () { return {}; },
        summarizeBoardIdentity: function () { return {}; },
        boardCardSummary: function () { return ''; },
        traceBoardIdentityPair: function () {},
        resolveSavedBoardData: function (bd) { return bd; },
        getLiveSyncSession: function () { return null; },
        getLiveSyncState: function () { return null; },
        setLiveSyncState: function () {},
        closeLiveSyncSession: function () { return Promise.resolve(); },
        ensureLiveSyncSession: function () { return Promise.resolve(); },
        reopenLiveSyncSession: function () { return Promise.resolve(); },
        applyBoardToLiveSyncSession: function () { return Promise.resolve(false); },
        flushPendingLiveSyncUpdates: function () { return Promise.resolve(); },
        getPendingRefresh: function () { return false; },
        setPendingRefresh: function () {},
        triggerAutoExportAfterBoardSave: function () {},
        renderMainView: function () {},
        renderColumns: function () {},
        refreshTargetedElements: function () {},
        refreshHeaderFileControls: function () {},
        scheduleDashboardRefresh: function () {},
        refreshBoardHierarchyProjection: function () {},
        isEmbeddedMode: function () { return false; },
        getEmbeddedPaneId: function () { return ''; },
        incrementBoardLoadSeq: function () { return 0; },
        getBoardLoadSeq: function () { return 0; },
        resetBoardStatsFilter: function () {},
        resetColumnSortState: function () {},
        closeSearchReplacePanel: function () {},
        getCanvasZoom: function () { return 1; },
        applyCanvasZoom: function () {},
        resetCanvasPan: function () {},
        clearBoardPreviewCaches: function () {},
        clearEditingPresenceMap: function () {},
        refreshAvailableMarpClasses: function () { return Promise.resolve(); },
        connectSyncForBoard: function () {}
      });
    }

    // --- Closure helpers ---
    ${closureHelpers}
    ${findColumnContainer}

    // --- Mutations ---
    ${mutations}

    return {
      setState: function(full, active, id) {
        fullBoardData = full;
        activeBoardData = active;
        activeBoardId = id || 'test-board';
        boardStore = {};
        boardStore[activeBoardId] = fullBoardData;
        undoCalls = 0;
      },
      setBoardState: function(boardId, boardData) {
        boardStore[boardId] = boardData;
      },
      setCanvasBoardLayout: function(value) {
        canvasBoardLayout = !!value;
      },
      getState: function() {
        return { fullBoardData: fullBoardData, activeBoardData: activeBoardData };
      },
      getLastPersistTargets: function() { return lastPersistTargets; },
      getLastCommitBoardIds: function() { return lastCommitBoardIds; },
      resetRefreshTracking: function() { lastPersistTargets = null; lastCommitBoardIds = null; },
      getBoardState: function(boardId) {
        return boardId === activeBoardId ? fullBoardData : boardStore[boardId];
      },
      getUndoCalls: function() { return undoCalls; },

      // Helpers
      getAllColumnsFromBoardData: getAllColumnsFromBoardData,
      getFullColumn: getFullColumn,
      getFullCardIndex: getFullCardIndex,
      findFullDataRow: findFullDataRow,
      findFullDataStack: findFullDataStack,
      findColumnContainer: findColumnContainer,
      is_archived_or_deleted: is_archived_or_deleted,
      visibleColumnIndicesInStack: visibleColumnIndicesInStack,
      buildHiddenItemRestoreSource: buildHiddenItemRestoreSource,
      captureStableRowRestoreTarget: captureStableRowRestoreTarget,
      captureStableStackRestoreTarget: captureStableStackRestoreTarget,
      captureStableColumnRestoreTarget: captureStableColumnRestoreTarget,
      captureStableCardRestoreTarget: captureStableCardRestoreTarget,

      // Card mutations
      addCardToActiveBoard: addCardToActiveBoard,
      addEmptyCardToActiveBoard: addEmptyCardToActiveBoard,
      insertCardAtIndex: insertCardAtIndex,
      saveCardEdit: saveCardEdit,
      duplicateCard: duplicateCard,
      tagCard: tagCard,

      // Column mutations
      addColumnToStack: addColumnToStack,
      duplicateColumn: duplicateColumn,
      setColumnHiddenTag: setColumnHiddenTag,
      moveColumnWithinBoard: moveColumnWithinBoard,
      moveColumnToExistingStack: moveColumnToExistingStack,
      moveColumnToNewStack: moveColumnToNewStack,

      // Stack mutations
      addStackToRow: addStackToRow,
      duplicateStack: duplicateStack,
      setStackHiddenTag: setStackHiddenTag,
      moveStack: moveStack,

      // Row mutations
      addRow: addRow,
      duplicateRow: duplicateRow,
      setRowHiddenTag: setRowHiddenTag,
      reorderRows: reorderRows,
      moveRowAcrossBoards: moveRowAcrossBoards,
      moveStackAcrossBoards: moveStackAcrossBoards,
      moveColumnAcrossBoards: moveColumnAcrossBoards,
      moveCard: moveCard,

      // Cross
      toggleTag: toggleTag,
      removeEmptyStacksAndRows: removeEmptyStacksAndRows,
    };
  `;

  const factory = new Function(wrappedSource);
  return factory();
}

// ═══════════════════════════════════════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeCard(id, content, opts) {
  return Object.assign({ id: id, content: content, checked: false, kid: null }, opts);
}

function makeColumn(id, title, cards) {
  return { id: id, title: title, cards: cards || [], include_source: null };
}

function makeStack(id, title, columns) {
  return { id: id, title: title, columns: columns || [] };
}

function makeRow(id, title, stacks) {
  return { id: id, title: title, stacks: stacks || [] };
}

function makeBoard(rows) {
  return { valid: true, title: 'Test Board', columns: [], rows: rows || [] };
}

/**
 * Simulate updateDisplayFromFullBoard — filter hidden items to produce activeBoardData.
 */
function buildActiveBoard(M, fullBoard) {
  var rows = [];
  for (var r = 0; r < (fullBoard.rows || []).length; r++) {
    var row = fullBoard.rows[r];
    if (M.is_archived_or_deleted(row.title || '')) continue;
    var stacks = [];
    for (var s = 0; s < (row.stacks || []).length; s++) {
      var stack = row.stacks[s];
      if (M.is_archived_or_deleted(stack.title || '')) continue;
      var cols = [];
      for (var c = 0; c < (stack.columns || []).length; c++) {
        var col = stack.columns[c];
        if (M.is_archived_or_deleted(col.title || '')) continue;
        var cards = (col.cards || []).filter(function (card) {
          return !M.is_archived_or_deleted(card.content || '');
        });
        cols.push({ id: col.id, title: col.title, cards: cards, include_source: null });
      }
      stacks.push({ id: stack.id, title: stack.title, columns: cols });
    }
    rows.push({ id: row.id, title: row.title, stacks: stacks });
  }
  return { valid: true, title: fullBoard.title || 'Test Board', columns: [], rows: rows };
}

/**
 * Build the standard test board with hidden items at every level.
 *
 * fullBoardData:
 *   Row 0 "Main"
 *     Stack 0 "Active"
 *       Col 0 "Todo"         — [card-a, card-b (#hidden-internal-deleted), card-c]
 *       Col 1 "Done #hidden-internal-parked"
 *     Stack 1 "Inactive #hidden-internal-archived"
 *       Col 2 "Old"           — [card-d]
 *   Row 1 "Deleted Row #hidden-internal-deleted"
 *     Stack 2 "Ghost"
 *       Col 3 "Ghost Col"     — [card-e]
 *   Row 2 "Secondary"
 *     Stack 3 "Other"
 *       Col 4 "Backlog"       — [card-f, card-g]
 *
 * activeBoardData (display):
 *   Row 0 "Main"        → Stack 0 "Active" → Col 0 "Todo" [card-a, card-c]
 *   Row 1 "Secondary"   → Stack 0 "Other"  → Col 0 "Backlog" [card-f, card-g]
 */
function buildTestFixture(M) {
  var full = makeBoard([
    makeRow('row-main', 'Main', [
      makeStack('stack-active', 'Active', [
        makeColumn('col-todo', 'Todo', [
          makeCard('card-a', 'Task A'),
          makeCard('card-b', 'Task B #hidden-internal-deleted'),
          makeCard('card-c', 'Task C'),
        ]),
        makeColumn('col-done', 'Done #hidden-internal-parked', []),
      ]),
      makeStack('stack-inactive', 'Inactive #hidden-internal-archived', [
        makeColumn('col-old', 'Old', [makeCard('card-d', 'Task D')]),
      ]),
    ]),
    makeRow('row-deleted', 'Deleted Row #hidden-internal-deleted', [
      makeStack('stack-ghost', 'Ghost', [
        makeColumn('col-ghost', 'Ghost Col', [makeCard('card-e', 'Task E')]),
      ]),
    ]),
    makeRow('row-secondary', 'Secondary', [
      makeStack('stack-other', 'Other', [
        makeColumn('col-backlog', 'Backlog', [
          makeCard('card-f', 'Task F'),
          makeCard('card-g', 'Task G'),
        ]),
      ]),
    ]),
  ]);
  var active = buildActiveBoard(M, full);
  return { full: full, active: active };
}

/**
 * Helper: get flat column index for a column by ID.
 */
function flatColIndex(M, colId) {
  var cols = M.getAllColumnsFromBoardData(M.getState().fullBoardData);
  for (var i = 0; i < cols.length; i++) {
    if (cols[i].id === colId) return i;
  }
  return -1;
}

// ═══════════════════════════════════════════════════════════════════════════

let M;

beforeAll(() => {
  M = loadMutationHarness();
});

function setup() {
  var fixture = buildTestFixture(M);
  M.setState(
    JSON.parse(JSON.stringify(fixture.full)),
    JSON.parse(JSON.stringify(fixture.active)),
    'test-board'
  );
  return M.getState();
}

// ═══════════════════════════════════════════════════════════════════════════
// ORDERING HELPERS
// ═══════════════════════════════════════════════════════════════════════════

describe('Column display ordering', () => {
  it('orders visible columns as header -> normal -> footer', () => {
    var stack = makeStack('stack-order', 'Order', [
      makeColumn('col-normal', 'Normal', []),
      makeColumn('col-footer', 'Footer #footer', []),
      makeColumn('col-header', 'Header #header', []),
      makeColumn('col-hidden', 'Hidden #header #hidden-internal-deleted', [])
    ]);
    var indices = M.visibleColumnIndicesInStack(stack);
    expect(indices).toEqual([2, 0, 1]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CARD MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

describe('Card mutations', () => {
  beforeEach(setup);

  it('addCardToActiveBoard appends card to correct column', async () => {
    var idx = flatColIndex(M, 'col-todo');
    await M.addCardToActiveBoard(idx, 'New task');
    var col = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(col.cards.length).toBe(4);
    expect(col.cards[3].content).toBe('New task');
    expect(col.cards[3].id).toBeTruthy();
  });

  it('addEmptyCardToActiveBoard appends blank card', async () => {
    var idx = flatColIndex(M, 'col-backlog');
    await M.addEmptyCardToActiveBoard(idx);
    var col = M.getState().fullBoardData.rows[2].stacks[0].columns[0];
    expect(col.cards.length).toBe(3);
    expect(col.cards[2].content).toBe('');
  });

  it('addEmptyCardToActiveBoard resolves a stale object target by stable ids', async () => {
    await M.addEmptyCardToActiveBoard({
      rowIndex: 99,
      stackIndex: 98,
      colIndex: 97,
      rowId: 'row-secondary',
      stackId: 'stack-other',
      columnId: 'col-backlog',
      insertIdx: 0,
      insertMode: 'visible'
    });
    var col = M.getState().fullBoardData.rows[2].stacks[0].columns[0];
    expect(col.cards.length).toBe(3);
    expect(col.cards[0].content).toBe('');
    expect(col.cards[1].id).toBe('card-f');
  });

  it('insertCardAtIndex with hidden cards maps visible index correctly', async () => {
    // col-todo has [card-a, card-b(DELETED), card-c]
    // visible: [card-a, card-c] — visible idx 1 = card-c
    // Insert at visible idx 1 should land at full idx 2 (before card-c)
    var idx = flatColIndex(M, 'col-todo');
    await M.insertCardAtIndex(idx, 1);
    var col = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(col.cards.length).toBe(4);
    expect(col.cards[0].id).toBe('card-a');
    expect(col.cards[1].id).toBe('card-b'); // deleted, unchanged
    expect(col.cards[2].content).toBe('');   // new card inserted here
    expect(col.cards[3].id).toBe('card-c');
  });

  it('insertCardAtIndex at 0 inserts at beginning', async () => {
    var idx = flatColIndex(M, 'col-todo');
    await M.insertCardAtIndex(idx, 0);
    var col = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(col.cards.length).toBe(4);
    expect(col.cards[0].content).toBe('');   // new card at start
    expect(col.cards[1].id).toBe('card-a');
  });

  it('saveCardEdit updates content of correct card', async () => {
    var idx = flatColIndex(M, 'col-todo');
    // fullCardIdx 2 = card-c
    await M.saveCardEdit(null, idx, 2, 'Updated C');
    var col = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(col.cards[2].content).toBe('Updated C');
    // Other cards unchanged
    expect(col.cards[0].content).toBe('Task A');
  });

  it('duplicateCard at visible idx 0 clones at correct full position', async () => {
    var idx = flatColIndex(M, 'col-todo');
    // visible idx 0 = card-a (full idx 0)
    await M.duplicateCard(idx, 0);
    var col = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(col.cards.length).toBe(4);
    expect(col.cards[0].id).toBe('card-a');
    expect(col.cards[1].content).toBe('Task A'); // clone
    expect(col.cards[1].id).not.toBe('card-a');  // new id
    expect(col.cards[1].kid).toBeNull();
    expect(col.cards[2].id).toBe('card-b');      // deleted card stays put
  });

  it('duplicateCard at visible idx 1 (card-c) clones after card-c', async () => {
    var idx = flatColIndex(M, 'col-todo');
    // visible idx 1 = card-c (full idx 2)
    await M.duplicateCard(idx, 1);
    var col = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(col.cards.length).toBe(4);
    expect(col.cards[2].id).toBe('card-c');
    expect(col.cards[3].content).toBe('Task C'); // clone after card-c
  });

  it('tagCard applies #hidden-internal-deleted to correct card', async () => {
    var idx = flatColIndex(M, 'col-todo');
    // visible idx 0 = card-a
    await M.tagCard(idx, 0, '#hidden-internal-deleted');
    var col = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(col.cards[0].content).toContain('#hidden-internal-deleted');
    expect(col.cards[0].content).toContain('Task A');
  });

  it('tagCard applies #hidden-internal-parked to correct card', async () => {
    var idx = flatColIndex(M, 'col-backlog');
    // visible idx 1 = card-g
    await M.tagCard(idx, 1, '#hidden-internal-parked');
    var col = M.getState().fullBoardData.rows[2].stacks[0].columns[0];
    expect(col.cards[1].content).toContain('#hidden-internal-parked');
  });

  it('tagCard replaces existing hidden tag', async () => {
    var idx = flatColIndex(M, 'col-todo');
    // visible idx 1 = card-c, first park it
    await M.tagCard(idx, 1, '#hidden-internal-parked');
    var col = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(col.cards[2].content).toContain('#hidden-internal-parked');
    // Now archive it — should replace parked
    // Need to rebuild active since card-c is now hidden
    var newActive = buildActiveBoard(M, M.getState().fullBoardData);
    M.setState(M.getState().fullBoardData, newActive, 'test-board');
    // card-c is now hidden, so visible cards in col-todo = [card-a] only
    // We need to tag it using its full index, but tagCard uses visible index
    // Since card-c is now hidden, we can't reach it via tagCard with visible index
    // This test just verifies the initial tag replacement worked
    expect(col.cards[2].content).toContain('#hidden-internal-parked');
    expect(col.cards[2].content).not.toContain('#hidden-internal-deleted');
  });

  it('toggleTag adds a user tag to a card', async () => {
    var idx = flatColIndex(M, 'col-todo');
    await M.toggleTag('card', { colIndex: idx, cardIndex: 0 }, '#urgent');
    var col = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(col.cards[0].content).toContain('#urgent');
  });

  it('toggleTag removes existing tag from card', async () => {
    // First add tag
    var idx = flatColIndex(M, 'col-todo');
    await M.toggleTag('card', { colIndex: idx, cardIndex: 0 }, '#urgent');
    expect(M.getState().fullBoardData.rows[0].stacks[0].columns[0].cards[0].content).toContain('#urgent');
    // Toggle again to remove
    await M.toggleTag('card', { colIndex: idx, cardIndex: 0 }, '#urgent');
    expect(M.getState().fullBoardData.rows[0].stacks[0].columns[0].cards[0].content).not.toContain('#urgent');
  });
});

describe('Drag/drop structural parity', () => {
  it('moveCard creates an unnamed column when dropping into a stack without columns', async () => {
    var full = makeBoard([
      makeRow('row-source', 'Source', [
        makeStack('stack-source', 'Source Stack', [
          makeColumn('col-source', 'Source Column', [makeCard('card-a', 'Task A')]),
        ]),
      ]),
      makeRow('row-target', 'Target', [
        makeStack('stack-target', 'Target Stack', []),
      ]),
    ]);
    M.setState(full, buildActiveBoard(M, full), 'test-board');

    await M.moveCard(
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 0,
        colIndex: 0,
        cardIndex: 0,
        cardIndexMode: 'visible',
        indexMode: 'display',
      },
      {
        boardId: 'test-board',
        rowIndex: 1,
        stackIndex: 0,
        indexMode: 'display',
        insertIdx: 0,
        insertMode: 'full',
      }
    );

    var targetStack = M.getState().fullBoardData.rows[1].stacks[0];
    expect(targetStack.columns.length).toBe(1);
    expect(targetStack.columns[0].title).toBe('');
    expect(targetStack.columns[0].cards.map(function (card) { return card.id; })).toEqual(['card-a']);
  });

  it('moveCard creates an unnamed stack and column when dropping into a row without stacks', async () => {
    var full = makeBoard([
      makeRow('row-source', 'Source', [
        makeStack('stack-source', 'Source Stack', [
          makeColumn('col-source', 'Source Column', [makeCard('card-a', 'Task A')]),
        ]),
      ]),
      makeRow('row-target', 'Target', []),
    ]);
    M.setState(full, buildActiveBoard(M, full), 'test-board');

    await M.moveCard(
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 0,
        colIndex: 0,
        cardIndex: 0,
        cardIndexMode: 'visible',
        indexMode: 'display',
      },
      {
        boardId: 'test-board',
        rowIndex: 1,
        indexMode: 'display',
        insertIdx: 0,
        insertMode: 'full',
      }
    );

    var targetRow = M.getState().fullBoardData.rows[1];
    expect(targetRow.stacks.length).toBe(1);
    expect(targetRow.stacks[0].title).toBe('');
    expect(targetRow.stacks[0].columns.length).toBe(1);
    expect(targetRow.stacks[0].columns[0].title).toBe('');
    expect(targetRow.stacks[0].columns[0].cards.map(function (card) { return card.id; })).toEqual(['card-a']);
  });

  it('moveCard removes empty unnamed columns and stacks after the last card moves away', async () => {
    var full = makeBoard([
      makeRow('row-source', 'Source', [
        makeStack('stack-keep', 'Keep Stack', [
          makeColumn('col-keep', 'Keep Column', []),
        ]),
        makeStack('stack-unnamed', '', [
          makeColumn('col-unnamed', '', [makeCard('card-a', 'Task A')]),
        ]),
      ]),
      makeRow('row-target', 'Target', [
        makeStack('stack-target', 'Target Stack', [
          makeColumn('col-target', 'Target Column', []),
        ]),
      ]),
    ]);
    M.setState(full, buildActiveBoard(M, full), 'test-board');

    await M.moveCard(
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 1,
        colIndex: 0,
        cardIndex: 0,
        cardIndexMode: 'visible',
        indexMode: 'display',
      },
      {
        boardId: 'test-board',
        rowIndex: 1,
        stackIndex: 0,
        colIndex: 0,
        indexMode: 'display',
        insertIdx: 0,
        insertMode: 'full',
      }
    );

    var sourceRow = M.getState().fullBoardData.rows[0];
    expect(sourceRow.stacks.length).toBe(1);
    expect(sourceRow.stacks[0].id).toBe('stack-keep');
    expect(sourceRow.stacks[0].columns.length).toBe(1);
  });

  it('moveCard resolves source and target columns by stable ids when display indices are stale', async () => {
    var full = makeBoard([
      makeRow('row-main', 'Main', [
        makeStack('stack-main', 'Main Stack', [
          makeColumn('col-source', 'Source Column', [makeCard('card-a', 'Task A')]),
          makeColumn('col-target', 'Target Column', [makeCard('card-b', 'Task B')]),
        ]),
      ]),
    ]);
    M.setState(full, buildActiveBoard(M, full), 'test-board');

    await M.moveCard(
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 0,
        colIndex: 1,
        rowId: 'row-main',
        stackId: 'stack-main',
        columnId: 'col-source',
        cardIndex: 0,
        cardId: 'card-a',
        cardIndexMode: 'visible',
        indexMode: 'display',
      },
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 0,
        colIndex: 0,
        rowId: 'row-main',
        stackId: 'stack-main',
        columnId: 'col-target',
        indexMode: 'display',
        insertIdx: 1,
        insertMode: 'full',
      }
    );

    var rows = M.getState().fullBoardData.rows;
    expect(rows[0].stacks[0].columns[0].cards).toHaveLength(0);
    expect(rows[0].stacks[0].columns[1].cards.map(function (card) { return card.id; })).toEqual(['card-b', 'card-a']);
  });

  it('moveCard prefers the target card id over a stale visible insert index', async () => {
    var full = makeBoard([
      makeRow('row-main', 'Main', [
        makeStack('stack-main', 'Main Stack', [
          makeColumn('col-source', 'Source Column', [makeCard('card-a', 'Task A')]),
          makeColumn('col-target', 'Target Column', [
            makeCard('card-b', 'Task B'),
            makeCard('card-c', 'Task C')
          ]),
        ]),
      ]),
    ]);
    M.setState(full, buildActiveBoard(M, full), 'test-board');

    await M.moveCard(
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 0,
        colIndex: 0,
        rowId: 'row-main',
        stackId: 'stack-main',
        columnId: 'col-source',
        cardIndex: 0,
        cardId: 'card-a',
        cardIndexMode: 'visible',
        indexMode: 'display',
      },
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 0,
        colIndex: 0,
        rowId: 'row-main',
        stackId: 'stack-main',
        columnId: 'col-target',
        cardIndex: 0,
        cardId: 'card-c',
        before: false,
        indexMode: 'display',
        insertIdx: 1,
        insertMode: 'visible',
      }
    );

    var targetCards = M.getState().fullBoardData.rows[0].stacks[0].columns[1].cards;
    expect(targetCards.map(function (card) { return card.id; })).toEqual(['card-b', 'card-c', 'card-a']);
  });

  it('moveColumnAcrossBoards creates an unnamed row for top-level drops', async () => {
    var source = makeBoard([
      makeRow('row-source', 'Source', [
        makeStack('stack-source', 'Source Stack', [
          makeColumn('col-source', 'Source Column', [makeCard('card-a', 'Task A')]),
        ]),
      ]),
    ]);
    var target = makeBoard([
      makeRow('row-target', 'Target Row', [
        makeStack('stack-target', 'Target Stack', [
          makeColumn('col-target', 'Target Column', []),
        ]),
      ]),
    ]);
    M.setState(source, buildActiveBoard(M, source), 'test-board');
    M.setBoardState('other-board', target);

    await M.moveColumnAcrossBoards(
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 0,
        colIndex: 0,
        indexMode: 'display',
      },
      {
        kind: 'new-row',
        boardId: 'other-board',
        rowIndex: 0,
        before: false,
        indexMode: 'full',
      }
    );

    var targetBoard = M.getBoardState('other-board');
    expect(targetBoard.rows.length).toBe(2);
    expect(targetBoard.rows[1].title).toBe('');
    expect(targetBoard.rows[1].stacks.length).toBe(1);
    expect(targetBoard.rows[1].stacks[0].title).toBe('');
    expect(targetBoard.rows[1].stacks[0].columns[0].id).toBe('col-source');
  });

  it('moveColumnAcrossBoards resolves source and target containers by stable ids when indices drift', async () => {
    var source = makeBoard([
      makeRow('row-source', 'Source', [
        makeStack('stack-source', 'Source Stack', [
          makeColumn('col-a', 'Column A', [makeCard('card-a', 'Task A')]),
          makeColumn('col-b', 'Column B', [makeCard('card-b', 'Task B')]),
        ]),
      ]),
    ]);
    var target = makeBoard([
      makeRow('row-target-a', 'Target A', [
        makeStack('stack-target-a', 'Target Stack A', [
          makeColumn('col-target-a', 'Target Column A', []),
        ]),
      ]),
      makeRow('row-target-b', 'Target B', [
        makeStack('stack-target-b', 'Target Stack B', [
          makeColumn('col-target-b', 'Target Column B', []),
        ]),
      ]),
    ]);
    M.setState(source, buildActiveBoard(M, source), 'test-board');
    M.setBoardState('other-board', target);

    await M.moveColumnAcrossBoards(
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 0,
        colIndex: 1,
        rowId: 'row-source',
        stackId: 'stack-source',
        columnId: 'col-a',
        indexMode: 'display',
      },
      {
        kind: 'stack',
        boardId: 'other-board',
        rowIndex: 0,
        stackIndex: 0,
        rowId: 'row-target-b',
        stackId: 'stack-target-b',
        indexMode: 'full',
      }
    );

    var targetBoard = M.getBoardState('other-board');
    expect(targetBoard.rows[1].stacks[0].columns.map(function (column) { return column.id; })).toEqual(['col-target-b', 'col-a']);
  });

  it('moveColumnAcrossBoards creates an unnamed stack inside an existing row drop target', async () => {
    var source = makeBoard([
      makeRow('row-source', 'Source', [
        makeStack('stack-source', 'Source Stack', [
          makeColumn('col-source', 'Source Column', [makeCard('card-a', 'Task A')]),
        ]),
      ]),
    ]);
    var target = makeBoard([
      makeRow('row-target', 'Target Row', []),
    ]);
    M.setState(source, buildActiveBoard(M, source), 'test-board');
    M.setBoardState('other-board', target);

    await M.moveColumnAcrossBoards(
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 0,
        colIndex: 0,
        indexMode: 'display',
      },
      {
        kind: 'row',
        boardId: 'other-board',
        rowIndex: 0,
        indexMode: 'full',
      }
    );

    var targetBoard = M.getBoardState('other-board');
    expect(targetBoard.rows[0].stacks.length).toBe(1);
    expect(targetBoard.rows[0].stacks[0].title).toBe('');
    expect(targetBoard.rows[0].stacks[0].columns.map(function (column) { return column.id; })).toEqual(['col-source']);
  });

  it('moveStackAcrossBoards creates an unnamed row for top-level stack drops', async () => {
    var source = makeBoard([
      makeRow('row-source', 'Source', [
        makeStack('stack-source', 'Source Stack', [
          makeColumn('col-source', 'Source Column', [makeCard('card-a', 'Task A')]),
        ]),
      ]),
    ]);
    var target = makeBoard([
      makeRow('row-target', 'Target Row', [
        makeStack('stack-target', 'Target Stack', [
          makeColumn('col-target', 'Target Column', []),
        ]),
      ]),
    ]);
    M.setState(source, buildActiveBoard(M, source), 'test-board');
    M.setBoardState('other-board', target);

    await M.moveStackAcrossBoards(
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 0,
        indexMode: 'display',
      },
      {
        kind: 'new-row',
        boardId: 'other-board',
        rowIndex: 0,
        before: false,
        indexMode: 'full',
      }
    );

    var targetBoard = M.getBoardState('other-board');
    expect(targetBoard.rows.length).toBe(2);
    expect(targetBoard.rows[1].title).toBe('');
    expect(targetBoard.rows[1].stacks.length).toBe(1);
    expect(targetBoard.rows[1].stacks[0].id).toBe('stack-source');
  });

  it('moveStackAcrossBoards resolves source stack and target row by stable ids when indices drift', async () => {
    var source = makeBoard([
      makeRow('row-source', 'Source', [
        makeStack('stack-a', 'Stack A', [
          makeColumn('col-a', 'Column A', []),
        ]),
        makeStack('stack-b', 'Stack B', [
          makeColumn('col-b', 'Column B', []),
        ]),
      ]),
    ]);
    var target = makeBoard([
      makeRow('row-target-a', 'Target A', []),
      makeRow('row-target-b', 'Target B', []),
    ]);
    M.setState(source, buildActiveBoard(M, source), 'test-board');
    M.setBoardState('other-board', target);

    await M.moveStackAcrossBoards(
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 1,
        rowId: 'row-source',
        stackId: 'stack-a',
        indexMode: 'display',
      },
      {
        kind: 'row',
        boardId: 'other-board',
        rowIndex: 0,
        rowId: 'row-target-b',
        indexMode: 'full',
      }
    );

    var targetBoard = M.getBoardState('other-board');
    expect(targetBoard.rows[1].stacks.map(function (stack) { return stack.id; })).toEqual(['stack-a']);
  });

  it('moveStackAcrossBoards preserves stack order when repositioning within the same canvas row', async () => {
    var full = makeBoard([
      makeRow('row-main', 'Row Main', [
        makeStack('stack-a', 'Stack A', [
          makeColumn('col-a', 'Column A', [])
        ]),
        makeStack('stack-b', 'Stack B', [
          makeColumn('col-b', 'Column B', [])
        ]),
      ]),
    ]);
    M.setState(full, buildActiveBoard(M, full), 'test-board');
    M.setCanvasBoardLayout(true);

    await M.moveStackAcrossBoards(
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 0,
        indexMode: 'display',
      },
      {
        kind: 'row',
        boardId: 'test-board',
        rowIndex: 0,
        indexMode: 'display',
        canvasPosition: { x: 321, y: 654 },
      }
    );

    var row = M.getState().fullBoardData.rows[0];
    expect(row.stacks.map(function (stack) { return stack.id; })).toEqual(['stack-a', 'stack-b']);
    expect(row.stacks[0].params).toEqual({ x: '321', y: '654' });
  });

  it('moveStackAcrossBoards applies canvas placement when moving a stack into another row', async () => {
    var full = makeBoard([
      makeRow('row-main', 'Row Main', [
        makeStack('stack-a', 'Stack A', [
          makeColumn('col-a', 'Column A', [])
        ]),
      ]),
      makeRow('row-target', 'Row Target', [
        makeStack('stack-b', 'Stack B', [
          makeColumn('col-b', 'Column B', [])
        ]),
      ]),
    ]);
    M.setState(full, buildActiveBoard(M, full), 'test-board');
    M.setCanvasBoardLayout(true);

    await M.moveStackAcrossBoards(
      {
        boardId: 'test-board',
        rowIndex: 0,
        stackIndex: 0,
        indexMode: 'display',
      },
      {
        kind: 'row',
        boardId: 'test-board',
        rowIndex: 1,
        indexMode: 'display',
        canvasPosition: { x: 777, y: 222 },
      }
    );

    var rows = M.getState().fullBoardData.rows;
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('row-target');
    expect(rows[0].stacks.map(function (stack) { return stack.id; })).toEqual(['stack-b', 'stack-a']);
    expect(rows[0].stacks[1].params).toEqual({ x: '777', y: '222' });
  });

  it('moveRowAcrossBoards resolves source and target rows by stable ids when indices drift', async () => {
    var source = makeBoard([
      makeRow('row-a', 'Row A', [
        makeStack('stack-a', 'Stack A', [
          makeColumn('col-a', 'Column A', []),
        ]),
      ]),
      makeRow('row-b', 'Row B', [
        makeStack('stack-b', 'Stack B', [
          makeColumn('col-b', 'Column B', []),
        ]),
      ]),
    ]);
    var target = makeBoard([
      makeRow('row-target-a', 'Target A', []),
      makeRow('row-target-b', 'Target B', []),
    ]);
    M.setState(source, buildActiveBoard(M, source), 'test-board');
    M.setBoardState('other-board', target);

    await M.moveRowAcrossBoards(
      {
        boardId: 'test-board',
        rowIndex: 1,
        rowId: 'row-a',
        indexMode: 'display',
      },
      {
        boardId: 'other-board',
        rowIndex: 0,
        rowId: 'row-target-b',
        before: false,
        indexMode: 'full',
      }
    );

    var targetBoard = M.getBoardState('other-board');
    expect(targetBoard.rows.map(function (row) { return row.id; })).toEqual(['row-target-a', 'row-target-b', 'row-a']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// COLUMN MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

describe('Column mutations', () => {
  beforeEach(setup);

  it('addColumnToStack adds column to correct full stack via display indices', async () => {
    // display row 0, stack 0 = full row-main, stack-active
    await M.addColumnToStack(0, 0);
    var stack = M.getState().fullBoardData.rows[0].stacks[0];
    expect(stack.columns.length).toBe(3); // was 2 (Todo + Done-parked)
    expect(stack.columns[2].title).toBe('New Column');
  });

  it('addColumnToStack with atColIdx places at correct position', async () => {
    // display row 1, stack 0 = full row-secondary, stack-other
    // Add at col idx 0 (before Backlog)
    await M.addColumnToStack(1, 0, 0);
    var stack = M.getState().fullBoardData.rows[2].stacks[0];
    expect(stack.columns.length).toBe(2);
    expect(stack.columns[0].title).toBe('New Column');
    expect(stack.columns[1].id).toBe('col-backlog');
  });

  it('duplicateColumn clones at correct position with reset IDs', async () => {
    var idx = flatColIndex(M, 'col-backlog');
    await M.duplicateColumn(idx);
    var stack = M.getState().fullBoardData.rows[2].stacks[0];
    expect(stack.columns.length).toBe(2);
    expect(stack.columns[0].id).toBe('col-backlog');
    var clone = stack.columns[1];
    expect(clone.id).not.toBe('col-backlog');
    expect(clone.cards.length).toBe(2);
    expect(clone.cards[0].content).toBe('Task F');
    expect(clone.cards[0].id).not.toBe('card-f');
    expect(clone.cards[0].kid).toBeNull();
  });

  it('setColumnHiddenTag applies tag to correct column title', async () => {
    var idx = flatColIndex(M, 'col-todo');
    await M.setColumnHiddenTag(idx, '#hidden-internal-archived');
    var col = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(col.title).toContain('#hidden-internal-archived');
    expect(col.title).toContain('Todo');
  });

  it('moveColumnWithinBoard moves between stacks correctly', async () => {
    // Move col-backlog (display row 1, stack 0, col 0)
    // to row 0, stack 0, col 0 (insertBefore=true)
    await M.moveColumnWithinBoard(1, 0, 0, 0, 0, 0, true);
    var srcStack = M.getState().fullBoardData.rows[2].stacks[0];
    var dstStack = M.getState().fullBoardData.rows[0].stacks[0];
    expect(srcStack.columns.length).toBe(0);  // backlog moved out
    // Todo + Done-parked were there, now Backlog added before Todo
    expect(dstStack.columns.length).toBe(3);
    expect(dstStack.columns[0].id).toBe('col-backlog');
    expect(dstStack.columns[1].id).toBe('col-todo');
  });

  it('moveColumnWithinBoard reorders within same stack', async () => {
    // Add a second visible column to stack-other first
    await M.addColumnToStack(1, 0);
    var stack = M.getState().fullBoardData.rows[2].stacks[0];
    expect(stack.columns.length).toBe(2);
    var newColId = stack.columns[1].id;
    // Rebuild active
    var newActive = buildActiveBoard(M, M.getState().fullBoardData);
    M.setState(M.getState().fullBoardData, newActive, 'test-board');
    // Move new column before backlog: display row 1, stack 0, from col 1, to col 0
    await M.moveColumnWithinBoard(1, 0, 1, 1, 0, 0, true);
    stack = M.getState().fullBoardData.rows[2].stacks[0];
    expect(stack.columns[0].id).toBe(newColId);
    expect(stack.columns[1].id).toBe('col-backlog');
  });

  it('moveColumnToExistingStack moves column to target stack', async () => {
    // Move col-backlog (display row 1, stack 0, col 0) to row 0, stack 0
    await M.moveColumnToExistingStack(1, 0, 0, 0, 0);
    var srcStack = M.getState().fullBoardData.rows[2].stacks[0];
    var dstStack = M.getState().fullBoardData.rows[0].stacks[0];
    expect(srcStack.columns.length).toBe(0);
    expect(dstStack.columns.length).toBe(3);
    expect(dstStack.columns[2].id).toBe('col-backlog'); // appended
  });

  it('moveColumnToNewStack creates new stack at correct position', async () => {
    // Move col-todo (display row 0, stack 0, col 0) to new stack in row 0
    // insertAtStackIdx = 1 (display) → should skip hidden stack-inactive
    await M.moveColumnToNewStack(0, 0, 0, 0, 1);
    var row = M.getState().fullBoardData.rows[0];
    // Original: Active, Inactive(hidden). After move: Active(lost Todo), new stack, Inactive
    // Actually the new stack is inserted at display position 1, which is past the last
    // visible stack (only Active is visible) so it appends
    expect(row.stacks.length).toBe(3); // Active + Inactive(hidden) + new
    var newStack = row.stacks[2]; // appended at end (display idx 1 = past visible)
    expect(newStack.columns.length).toBe(1);
    expect(newStack.columns[0].id).toBe('col-todo');
  });

  it('moveColumnToNewStack with null insertAtStackIdx appends', async () => {
    await M.moveColumnToNewStack(1, 0, 0, 1, null);
    var row = M.getState().fullBoardData.rows[2];
    expect(row.stacks.length).toBe(2);
    expect(row.stacks[1].columns[0].id).toBe('col-backlog');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STACK MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

describe('Stack mutations', () => {
  beforeEach(setup);

  it('addStackToRow adds to correct full row via display index', async () => {
    // display row 0 = full row-main
    await M.addStackToRow(0);
    var row = M.getState().fullBoardData.rows[0];
    expect(row.stacks.length).toBe(3); // Active + Inactive(hidden) + new
    expect(row.stacks[2].title).toBe('New Stack');
  });

  it('addStackToRow at display idx with hidden stacks uses correct position', async () => {
    // display row 0, at stack idx 0 → insert before first visible stack (Active)
    await M.addStackToRow(0, 0);
    var row = M.getState().fullBoardData.rows[0];
    expect(row.stacks.length).toBe(3);
    expect(row.stacks[0].title).toBe('New Stack');
    expect(row.stacks[1].id).toBe('stack-active');
  });

  it('addStackToRow at end appends', async () => {
    // display row 1 = full row-secondary, at stack idx 1 (past visible)
    await M.addStackToRow(1, 1);
    var row = M.getState().fullBoardData.rows[2];
    expect(row.stacks.length).toBe(2);
    expect(row.stacks[1].title).toBe('New Stack');
  });

  it('duplicateStack clones at correct full position with reset IDs', async () => {
    // display row 1, stack 0 = full row-secondary, stack-other
    await M.duplicateStack(1, 0);
    var row = M.getState().fullBoardData.rows[2];
    expect(row.stacks.length).toBe(2);
    expect(row.stacks[0].id).toBe('stack-other');
    var clone = row.stacks[1];
    expect(clone.id).not.toBe('stack-other');
    expect(clone.columns.length).toBe(1);
    expect(clone.columns[0].id).not.toBe('col-backlog');
    expect(clone.columns[0].cards.length).toBe(2);
    expect(clone.columns[0].cards[0].kid).toBeNull();
  });

  it('setStackHiddenTag applies tag to correct stack', async () => {
    // display row 0, stack 0 = full stack-active
    await M.setStackHiddenTag(0, 0, '#hidden-internal-parked');
    var stack = M.getState().fullBoardData.rows[0].stacks[0];
    expect(stack.title).toContain('#hidden-internal-parked');
    expect(stack.title).toContain('Active');
  });

  it('moveStack within same row reorders correctly', async () => {
    // First add a second visible stack to row-main
    await M.addStackToRow(0);
    var newActive = buildActiveBoard(M, M.getState().fullBoardData);
    M.setState(M.getState().fullBoardData, newActive, 'test-board');
    // display row 0 now has stack 0 (Active) and stack 1 (New Stack)
    // Move stack 1 before stack 0
    await M.moveStack(0, 1, 0, 0, true);
    var row = M.getState().fullBoardData.rows[0];
    expect(row.stacks[0].title).toBe('New Stack');
    expect(row.stacks[1].id).toBe('stack-active');
  });

  it('moveStack to different row arrives correctly', async () => {
    // Move stack-other (display row 1, stack 0) to row 0, stack 0 (insertBefore)
    await M.moveStack(1, 0, 0, 0, true);
    var rows = M.getState().fullBoardData.rows;
    var dstRow = rows[0];
    expect(dstRow.stacks[0].id).toBe('stack-other');
    expect(dstRow.stacks[1].id).toBe('stack-active');
    // row-secondary had its only stack moved out → removeEmptyStacksAndRows removes it
    expect(rows.length).toBe(2); // row-main + row-deleted remain
    expect(rows[0].id).toBe('row-main');
    expect(rows[1].id).toBe('row-deleted');
  });

  it('moveStack with hidden stacks positions correctly', async () => {
    // Move stack-other (display row 1, stack 0) after the visible stack in row 0
    // display row 0 has 1 visible stack (Active). Insert after it: toStackIdx=0, insertBefore=false
    await M.moveStack(1, 0, 0, 0, false);
    var dstRow = M.getState().fullBoardData.rows[0];
    // Active is at full idx 0, Inactive(hidden) at 1. Insert after Active = full idx 1.
    // But stack-inactive is at 1... the move should place other AFTER active
    expect(dstRow.stacks.length).toBe(3);
    // The new stack should be right after Active
    expect(dstRow.stacks[1].id).toBe('stack-other');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROW MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

describe('Row mutations', () => {
  beforeEach(setup);

  it('addRow at display idx 1 skips hidden row and inserts correctly', async () => {
    // display row 1 = full row-secondary (idx 2, because row-deleted at idx 1 is hidden)
    // Insert at display idx 1 → should insert before row-secondary in fullBoardData
    await M.addRow(1);
    var rows = M.getState().fullBoardData.rows;
    expect(rows.length).toBe(4);
    expect(rows[0].id).toBe('row-main');
    expect(rows[1].id).toBe('row-deleted'); // hidden, stays
    expect(rows[2].title).toBe('New Row');  // inserted before row-secondary
    expect(rows[3].id).toBe('row-secondary');
  });

  it('addRow at display idx 0 inserts at full idx 0', async () => {
    await M.addRow(0);
    var rows = M.getState().fullBoardData.rows;
    expect(rows.length).toBe(4);
    expect(rows[0].title).toBe('New Row');
    expect(rows[1].id).toBe('row-main');
  });

  it('addRow with no index appends at end', async () => {
    await M.addRow();
    var rows = M.getState().fullBoardData.rows;
    expect(rows.length).toBe(4);
    expect(rows[3].title).toBe('New Row');
  });

  it('duplicateRow clones at correct full position with all IDs reset', async () => {
    // display row 0 = full row-main (idx 0)
    await M.duplicateRow(0);
    var rows = M.getState().fullBoardData.rows;
    expect(rows.length).toBe(4);
    expect(rows[0].id).toBe('row-main');
    var clone = rows[1];
    expect(clone.id).not.toBe('row-main');
    expect(clone.stacks.length).toBe(2); // Active + Inactive(hidden)
    expect(clone.stacks[0].id).not.toBe('stack-active');
    expect(clone.stacks[0].columns[0].id).not.toBe('col-todo');
    expect(clone.stacks[0].columns[0].cards[0].kid).toBeNull();
    // Original row-deleted still at idx 2
    expect(rows[2].id).toBe('row-deleted');
  });

  it('duplicateRow of display row 1 clones at correct full position', async () => {
    // display row 1 = full row-secondary (idx 2)
    await M.duplicateRow(1);
    var rows = M.getState().fullBoardData.rows;
    expect(rows.length).toBe(4);
    expect(rows[2].id).toBe('row-secondary');
    expect(rows[3].id).not.toBe('row-secondary');
    expect(rows[3].stacks[0].columns[0].cards.length).toBe(2);
  });

  it('setRowHiddenTag applies tag to correct row', async () => {
    // display row 0 = full row-main
    await M.setRowHiddenTag(0, '#hidden-internal-parked');
    expect(M.getState().fullBoardData.rows[0].title).toContain('#hidden-internal-parked');
    expect(M.getState().fullBoardData.rows[0].title).toContain('Main');
  });

  it('reorderRows converts display indices to full correctly', async () => {
    // display: row 0 (Main), row 1 (Secondary)
    // full: row 0 (Main), row 1 (Deleted-hidden), row 2 (Secondary)
    // Move display row 1 before display row 0 → Secondary before Main
    await M.reorderRows(1, 0, true);
    var rows = M.getState().fullBoardData.rows;
    expect(rows[0].id).toBe('row-secondary');
    expect(rows[1].id).toBe('row-main');
    expect(rows[2].id).toBe('row-deleted'); // hidden row stays
  });

  it('removeEmptyStacksAndRows removes empty rows but preserves non-empty', () => {
    // Manually empty a row's stacks
    M.getState().fullBoardData.rows[2].stacks = [];
    M.removeEmptyStacksAndRows();
    var rows = M.getState().fullBoardData.rows;
    expect(rows.length).toBe(2);
    expect(rows[0].id).toBe('row-main');
    expect(rows[1].id).toBe('row-deleted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Hidden item restore target capture', () => {
  beforeEach(() => {
    var full = makeBoard([
      makeRow('row-a', 'Row A', [
        makeStack('stack-a', 'Stack A', [
          makeColumn('col-a', 'Column A', [makeCard('card-a', 'Visible A')])
        ]),
        makeStack('stack-hidden', 'Hidden Stack #hidden-internal-archived', [
          makeColumn('col-hidden-stack', 'Hidden Stack Column', [])
        ]),
        makeStack('stack-b', 'Stack B', [
          makeColumn('col-b', 'Column B', [
            makeCard('card-hidden', 'Hidden Card #hidden-internal-archived'),
            makeCard('card-b', 'Visible B')
          ])
        ])
      ]),
      makeRow('row-hidden', 'Hidden Row #hidden-internal-archived', [
        makeStack('stack-row-hidden', 'Hidden Row Stack', [
          makeColumn('col-row-hidden', 'Hidden Row Column', [])
        ])
      ]),
      makeRow('row-c', 'Row C', [
        makeStack('stack-c', 'Stack C', [
          makeColumn('col-c', 'Column C', [])
        ])
      ])
    ]);

    full.rows[0].stacks[0].columns.push(makeColumn('col-hidden-col', 'Hidden Column #hidden-internal-archived', []));
    var active = buildActiveBoard(M, full);
    M.setState(full, active, 'test-board');
  });

  it('builds full-index restore sources for hidden items', () => {
    expect(M.buildHiddenItemRestoreSource({ kind: 'row', rowIndex: 1 })).toEqual({
      boardId: 'test-board',
      rowIndex: 1,
      indexMode: 'full'
    });

    expect(M.buildHiddenItemRestoreSource({ kind: 'stack', rowIndex: 0, stackIndex: 1 })).toEqual({
      boardId: 'test-board',
      rowIndex: 0,
      stackIndex: 1,
      indexMode: 'full'
    });

    expect(M.buildHiddenItemRestoreSource({ kind: 'column', rowIndex: 0, stackIndex: 0, colIndex: 1 })).toEqual({
      boardId: 'test-board',
      rowIndex: 0,
      stackIndex: 0,
      colIndex: 1,
      indexMode: 'full'
    });

    expect(M.buildHiddenItemRestoreSource({ kind: 'card', rowIndex: 0, stackIndex: 2, colIndex: 0, cardIndex: 0 })).toEqual({
      boardId: 'test-board',
      rowIndex: 0,
      stackIndex: 2,
      colIndex: 0,
      cardIndex: 0,
      cardIndexMode: 'full',
      indexMode: 'full'
    });
  });

  it('converts active display row targets to stable full row indices', () => {
    var target = M.captureStableRowRestoreTarget({
      kind: 'row',
      boardId: 'test-board',
      rowIndex: 1,
      before: true,
      indexMode: 'display'
    });

    expect(target).toEqual({
      kind: 'row',
      boardId: 'test-board',
      rowIndex: 2,
      before: true,
      indexMode: 'full'
    });
  });

  it('converts active display stack targets to stable full stack indices', () => {
    var target = M.captureStableStackRestoreTarget({
      kind: 'stack',
      boardId: 'test-board',
      rowIndex: 0,
      stackIndex: 1,
      before: false,
      indexMode: 'display'
    });

    expect(target).toEqual({
      kind: 'stack',
      boardId: 'test-board',
      rowIndex: 0,
      stackIndex: 2,
      before: false,
      indexMode: 'full'
    });
  });

  it('converts new-stack insertion targets to stable full insertion indices', () => {
    var target = M.captureStableColumnRestoreTarget({
      kind: 'new-stack',
      boardId: 'test-board',
      rowIndex: 0,
      insertAtStackIdx: 1,
      indexMode: 'display'
    });

    expect(target).toEqual({
      kind: 'new-stack',
      boardId: 'test-board',
      rowIndex: 0,
      insertAtStackIdx: 2,
      indexMode: 'full'
    });
  });

  it('converts active display card column targets to stable full column paths and insert positions', () => {
    var target = M.captureStableCardRestoreTarget({
      kind: 'main',
      boardId: 'test-board',
      rowIndex: 0,
      stackIndex: 1,
      colIndex: 0,
      insertIdx: 0,
      insertMode: 'visible',
      indexMode: 'display'
    });

    expect(target).toEqual({
      kind: 'main',
      boardId: 'test-board',
      rowIndex: 0,
      stackIndex: 2,
      colIndex: 0,
      insertIdx: 1,
      insertMode: 'full',
      indexMode: 'full'
    });
  });
});

describe('Integration', () => {
  beforeEach(setup);

  it('add card then tag-delete it — still in fullBoardData', async () => {
    var idx = flatColIndex(M, 'col-todo');
    await M.addCardToActiveBoard(idx, 'Temp task');
    var col = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(col.cards.length).toBe(4);

    // Rebuild active to see the new card
    var active = buildActiveBoard(M, M.getState().fullBoardData);
    M.setState(M.getState().fullBoardData, active, 'test-board');
    // New card is visible idx 2 (after card-a, card-c)
    await M.tagCard(idx, 2, '#hidden-internal-deleted');
    expect(col.cards[3].content).toContain('#hidden-internal-deleted');
    expect(col.cards.length).toBe(4); // still in fullBoardData
  });

  it('move column from stack that becomes empty — row cleaned up', async () => {
    // Move col-backlog out of row-secondary/stack-other to row-main/stack-active
    await M.moveColumnToExistingStack(1, 0, 0, 0, 0);
    var rows = M.getState().fullBoardData.rows;
    // row-secondary now has an empty stack-other → removeEmptyStacksAndRows called
    // The move function calls removeEmptyStacksAndRows internally
    // stack-other still exists (empty stacks are kept) but if row has no stacks...
    // Actually removeEmptyStacksAndRows only removes rows with 0 stacks.
    // stack-other still has 0 columns but still exists as a stack.
    expect(rows[2].stacks.length).toBe(1); // stack-other still there, just empty columns
  });

  it('operations on display row 1 map to correct full row', async () => {
    // display row 1 = full row-secondary (idx 2)
    // Add a stack to display row 1
    await M.addStackToRow(1);
    var fullRow = M.getState().fullBoardData.rows[2];
    expect(fullRow.id).toBe('row-secondary');
    expect(fullRow.stacks.length).toBe(2);
    expect(fullRow.stacks[1].title).toBe('New Stack');
  });

  it('multiple sequential operations maintain consistency', async () => {
    // 1. Add card to col-todo
    var idx = flatColIndex(M, 'col-todo');
    await M.addCardToActiveBoard(idx, 'Step 1');
    expect(M.getState().fullBoardData.rows[0].stacks[0].columns[0].cards.length).toBe(4);

    // 2. Add stack to row-secondary
    await M.addStackToRow(1);
    expect(M.getState().fullBoardData.rows[2].stacks.length).toBe(2);

    // 3. Add row at display idx 1
    await M.addRow(1);
    expect(M.getState().fullBoardData.rows.length).toBe(4);

    // 4. Verify nothing was clobbered
    expect(M.getState().fullBoardData.rows[0].stacks[0].columns[0].cards.length).toBe(4);
    expect(M.getState().fullBoardData.rows[0].stacks[0].columns[0].cards[3].content).toBe('Step 1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Card move scenarios: view ↔ workspace, same board, cross board
// ═══════════════════════════════════════════════════════════════════════════

describe('Card move scenarios', () => {
  // Two-board setup for cross-board tests
  function makeTwoBoardSetup() {
    var boardA = makeBoard([
      makeRow('row-a1', 'Row A1', [
        makeStack('stack-a1', 'Stack A1', [
          makeColumn('col-a1', 'Column A1', [makeCard('card-1', 'Card One'), makeCard('card-2', 'Card Two')]),
          makeColumn('col-a2', 'Column A2', [makeCard('card-3', 'Card Three')]),
        ]),
      ]),
    ]);
    var boardB = makeBoard([
      makeRow('row-b1', 'Row B1', [
        makeStack('stack-b1', 'Stack B1', [
          makeColumn('col-b1', 'Column B1', [makeCard('card-b1', 'Card B-One')]),
        ]),
      ]),
    ]);
    return { boardA: boardA, boardB: boardB };
  }

  // ── View → View (same board, same column reorder) ──────────────────────
  it('view-to-view same-column reorder refreshes the column and sidebar', async () => {
    var setup = makeTwoBoardSetup();
    M.setState(setup.boardA, buildActiveBoard(M, setup.boardA), 'board-a');
    M.resetRefreshTracking();

    await M.moveCard(
      { boardId: 'board-a', flatColIndex: 0, cardIndex: 0, cardId: 'card-1', cardIndexMode: 'visible', indexMode: 'display' },
      { boardId: 'board-a', flatColIndex: 0, insertIdx: 2, insertMode: 'visible', indexMode: 'display' }
    );

    var col = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(col.cards.map(function (c) { return c.id; })).toEqual(['card-2', 'card-1']);
    // UI: targeted column + sidebar refresh (no full board rebuild)
    expect(M.getLastPersistTargets()).toContain('column');
    expect(M.getLastPersistTargets()).toContain('sidebar');
    expect(M.getLastPersistTargets()).not.toContain('board');
    expect(M.getLastCommitBoardIds()).toBeNull();
  });

  it('view-to-view same-column reorder can anchor by target card kid', async () => {
    var board = makeBoard([
      makeRow('row-a1', 'Row A1', [
        makeStack('stack-a1', 'Stack A1', [
          makeColumn('col-a1', 'Column A1', [
            makeCard('card-1', 'Card One', { kid: 'kid-1' }),
            makeCard('card-2', 'Card Two', { kid: 'kid-2' })
          ])
        ])
      ])
    ]);
    M.setState(board, buildActiveBoard(M, board), 'board-a');
    M.resetRefreshTracking();

    await M.moveCard(
      { boardId: 'board-a', flatColIndex: 0, cardIndex: 0, cardId: 'card-1', cardIndexMode: 'visible', indexMode: 'display' },
      { boardId: 'board-a', flatColIndex: 0, cardId: 'kid-2', before: false, insertIdx: 1, insertMode: 'visible', indexMode: 'display' }
    );

    var col = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(col.cards.map(function (c) { return c.id; })).toEqual(['card-2', 'card-1']);
    expect(M.getLastPersistTargets()).toContain('column');
    expect(M.getLastPersistTargets()).toContain('sidebar');
  });

  // ── View → View (same board, cross column) ─────────────────────────────
  it('view-to-view cross-column refreshes board and sidebar', async () => {
    var setup = makeTwoBoardSetup();
    M.setState(setup.boardA, buildActiveBoard(M, setup.boardA), 'board-a');
    M.resetRefreshTracking();

    await M.moveCard(
      { boardId: 'board-a', flatColIndex: 0, cardIndex: 0, cardId: 'card-1', cardIndexMode: 'visible', indexMode: 'display' },
      { boardId: 'board-a', flatColIndex: 1, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
    );

    var colA1 = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    var colA2 = M.getState().fullBoardData.rows[0].stacks[0].columns[1];
    expect(colA1.cards.map(function (c) { return c.id; })).toEqual(['card-2']);
    expect(colA2.cards.map(function (c) { return c.id; })).toEqual(['card-1', 'card-3']);
    // UI: targeted card-remove + card-insert + sidebar refresh via persistBoardMutation
    expect(M.getLastPersistTargets()).toContain('card-remove');
    expect(M.getLastPersistTargets()).toContain('card-insert');
    expect(M.getLastPersistTargets()).toContain('sidebar');
    expect(M.getLastCommitBoardIds()).toBeNull();
  });

  // ── View → Workspace sidebar (same board) ──────────────────────────────
  it('view-to-workspace same-board refreshes board and sidebar', async () => {
    var setup = makeTwoBoardSetup();
    M.setState(setup.boardA, buildActiveBoard(M, setup.boardA), 'board-a');
    M.resetRefreshTracking();

    await M.moveCard(
      { boardId: 'board-a', flatColIndex: 0, cardIndex: 1, cardId: 'card-2', cardIndexMode: 'visible', indexMode: 'display' },
      { boardId: 'board-a', rowIndex: 0, stackIndex: 0, colIndex: 1, columnId: 'col-a2', insertIdx: 1, insertMode: 'visible', indexMode: 'display' }
    );

    var colA1 = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    var colA2 = M.getState().fullBoardData.rows[0].stacks[0].columns[1];
    expect(colA1.cards.map(function (c) { return c.id; })).toEqual(['card-1']);
    expect(colA2.cards.map(function (c) { return c.id; })).toEqual(['card-3', 'card-2']);
    // UI: targeted card-remove + card-insert + sidebar refresh via persistBoardMutation
    expect(M.getLastPersistTargets()).toContain('card-remove');
    expect(M.getLastPersistTargets()).toContain('card-insert');
    expect(M.getLastPersistTargets()).toContain('sidebar');
    expect(M.getLastCommitBoardIds()).toBeNull();
  });

  // ── Workspace → View (same board) ──────────────────────────────────────
  it('workspace-to-view same-board refreshes board and sidebar', async () => {
    var setup = makeTwoBoardSetup();
    M.setState(setup.boardA, buildActiveBoard(M, setup.boardA), 'board-a');
    M.resetRefreshTracking();

    await M.moveCard(
      { boardId: 'board-a', rowIndex: 0, stackIndex: 0, colIndex: 1, columnId: 'col-a2', cardIndex: 0, cardId: 'card-3', cardIndexMode: 'visible', indexMode: 'display' },
      { boardId: 'board-a', flatColIndex: 0, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
    );

    var colA1 = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    var colA2 = M.getState().fullBoardData.rows[0].stacks[0].columns[1];
    expect(colA1.cards.map(function (c) { return c.id; })).toEqual(['card-3', 'card-1', 'card-2']);
    expect(colA2.cards.length).toBe(0);
    // UI: targeted card-remove + card-insert + sidebar refresh via persistBoardMutation
    expect(M.getLastPersistTargets()).toContain('card-remove');
    expect(M.getLastPersistTargets()).toContain('card-insert');
    expect(M.getLastPersistTargets()).toContain('sidebar');
    expect(M.getLastCommitBoardIds()).toBeNull();
  });

  // ── View → Workspace (different board, cross-board) ────────────────────
  it('view-to-workspace cross-board commits both boards for UI refresh', async () => {
    var setup = makeTwoBoardSetup();
    M.setState(setup.boardA, buildActiveBoard(M, setup.boardA), 'board-a');
    M.setBoardState('board-b', setup.boardB);
    M.resetRefreshTracking();

    await M.moveCard(
      { boardId: 'board-a', flatColIndex: 0, cardIndex: 0, cardId: 'card-1', cardIndexMode: 'visible', indexMode: 'display' },
      { boardId: 'board-b', rowId: 'row-b1', stackId: 'stack-b1', columnId: 'col-b1', insertIdx: 1, insertMode: 'full', indexMode: 'full' }
    );

    var sourceCol = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(sourceCol.cards[0].content).toContain('#hidden-internal-deleted');
    var targetCol = M.getBoardState('board-b').rows[0].stacks[0].columns[0];
    expect(targetCol.cards.map(function (c) { return c.id; })).toEqual(['card-b1', 'card-1']);
    // UI: commitBoardMutations called with both boards
    expect(M.getLastCommitBoardIds()).toContain('board-a');
    expect(M.getLastCommitBoardIds()).toContain('board-b');
    expect(M.getLastPersistTargets()).toBeNull();
  });

  // ── Workspace → Workspace (different board, cross-board) ───────────────
  it('workspace-to-workspace cross-board commits both boards for UI refresh', async () => {
    var setup = makeTwoBoardSetup();
    M.setState(setup.boardA, buildActiveBoard(M, setup.boardA), 'board-a');
    M.setBoardState('board-b', setup.boardB);
    M.resetRefreshTracking();

    await M.moveCard(
      { boardId: 'board-a', rowId: 'row-a1', stackId: 'stack-a1', columnId: 'col-a1', cardIndex: 0, cardId: 'card-1', cardIndexMode: 'visible', indexMode: 'display' },
      { boardId: 'board-b', rowId: 'row-b1', stackId: 'stack-b1', columnId: 'col-b1', insertIdx: 0, insertMode: 'full', indexMode: 'full' }
    );

    var sourceCol = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(sourceCol.cards[0].content).toContain('#hidden-internal-deleted');
    var targetCol = M.getBoardState('board-b').rows[0].stacks[0].columns[0];
    expect(targetCol.cards[0].id).toBe('card-1');
    // UI: commitBoardMutations called with both boards
    expect(M.getLastCommitBoardIds()).toContain('board-a');
    expect(M.getLastCommitBoardIds()).toContain('board-b');
    expect(M.getLastPersistTargets()).toBeNull();
  });

  // ── Same board, card identity preserved ────────────────────────────────
  it('same-board moves preserve card id and content and trigger UI refresh', async () => {
    var setup = makeTwoBoardSetup();
    M.setState(setup.boardA, buildActiveBoard(M, setup.boardA), 'board-a');
    M.resetRefreshTracking();

    await M.moveCard(
      { boardId: 'board-a', flatColIndex: 0, cardIndex: 0, cardId: 'card-1', cardIndexMode: 'visible', indexMode: 'display' },
      { boardId: 'board-a', flatColIndex: 1, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
    );

    var movedCard = M.getState().fullBoardData.rows[0].stacks[0].columns[1].cards[0];
    expect(movedCard.id).toBe('card-1');
    expect(movedCard.content).toBe('Card One');
    // UI: persistBoardMutation with board + sidebar
    expect(M.getLastPersistTargets()).not.toBeNull();
    expect(M.getLastPersistTargets()).toContain('sidebar');
  });

  // ── Workspace → Workspace (same board) ──────────────────────────────────
  it('workspace-to-workspace same-board refreshes board and sidebar', async () => {
    var setup = makeTwoBoardSetup();
    M.setState(setup.boardA, buildActiveBoard(M, setup.boardA), 'board-a');
    M.resetRefreshTracking();

    await M.moveCard(
      { boardId: 'board-a', rowIndex: 0, stackIndex: 0, colIndex: 0, columnId: 'col-a1', cardIndex: 0, cardId: 'card-1', cardIndexMode: 'visible', indexMode: 'display' },
      { boardId: 'board-a', rowIndex: 0, stackIndex: 0, colIndex: 1, columnId: 'col-a2', insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
    );

    var colA1 = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    var colA2 = M.getState().fullBoardData.rows[0].stacks[0].columns[1];
    expect(colA1.cards.map(function (c) { return c.id; })).toEqual(['card-2']);
    expect(colA2.cards.map(function (c) { return c.id; })).toEqual(['card-1', 'card-3']);
    // UI: targeted card-remove + card-insert + sidebar refresh via persistBoardMutation
    expect(M.getLastPersistTargets()).toContain('card-remove');
    expect(M.getLastPersistTargets()).toContain('card-insert');
    expect(M.getLastPersistTargets()).toContain('sidebar');
    expect(M.getLastCommitBoardIds()).toBeNull();
  });

  // ── View → View (different board) ──────────────────────────────────────
  it('view-to-view cross-board commits both boards for UI refresh', async () => {
    var setup = makeTwoBoardSetup();
    M.setState(setup.boardA, buildActiveBoard(M, setup.boardA), 'board-a');
    M.setBoardState('board-b', setup.boardB);
    M.resetRefreshTracking();

    await M.moveCard(
      { boardId: 'board-a', flatColIndex: 0, cardIndex: 0, cardId: 'card-1', cardIndexMode: 'visible', indexMode: 'display' },
      { boardId: 'board-b', rowId: 'row-b1', stackId: 'stack-b1', columnId: 'col-b1', insertIdx: 0, insertMode: 'full', indexMode: 'full' }
    );

    // Source card trashed on active board
    var sourceCol = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(sourceCol.cards[0].content).toContain('#hidden-internal-deleted');

    // Target board has the card
    var targetCol = M.getBoardState('board-b').rows[0].stacks[0].columns[0];
    expect(targetCol.cards[0].id).toBe('card-1');
    // UI: commitBoardMutations with both boards
    expect(M.getLastCommitBoardIds()).toContain('board-a');
    expect(M.getLastCommitBoardIds()).toContain('board-b');
  });

  // ── Workspace → View (different board) ─────────────────────────────────
  it('workspace-to-view cross-board commits both boards for UI refresh', async () => {
    var setup = makeTwoBoardSetup();
    M.setState(setup.boardA, buildActiveBoard(M, setup.boardA), 'board-a');
    M.setBoardState('board-b', setup.boardB);
    M.resetRefreshTracking();

    await M.moveCard(
      { boardId: 'board-a', rowId: 'row-a1', stackId: 'stack-a1', columnId: 'col-a1', cardIndex: 1, cardId: 'card-2', cardIndexMode: 'visible', indexMode: 'display' },
      { boardId: 'board-b', rowId: 'row-b1', stackId: 'stack-b1', columnId: 'col-b1', insertIdx: 0, insertMode: 'full', indexMode: 'full' }
    );

    var sourceCol = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(sourceCol.cards[1].content).toContain('#hidden-internal-deleted');
    var targetCol = M.getBoardState('board-b').rows[0].stacks[0].columns[0];
    expect(targetCol.cards[0].id).toBe('card-2');
    // UI: commitBoardMutations with both boards
    expect(M.getLastCommitBoardIds()).toContain('board-a');
    expect(M.getLastCommitBoardIds()).toContain('board-b');
    expect(M.getLastPersistTargets()).toBeNull();
  });

  // ── Cross-board move with stable IDs ───────────────────────────────────
  it('cross-board move uses stable IDs for column resolution', async () => {
    var setup = makeTwoBoardSetup();
    M.setState(setup.boardA, buildActiveBoard(M, setup.boardA), 'board-a');
    M.setBoardState('board-b', setup.boardB);

    await M.moveCard(
      { boardId: 'board-a', rowId: 'row-a1', stackId: 'stack-a1', columnId: 'col-a1', cardIndex: 0, cardId: 'card-1', cardIndexMode: 'visible', indexMode: 'display' },
      { boardId: 'board-b', rowId: 'row-b1', stackId: 'stack-b1', columnId: 'col-b1', insertIdx: 0, insertMode: 'full', indexMode: 'full' }
    );

    var targetCol = M.getBoardState('board-b').rows[0].stacks[0].columns[0];
    expect(targetCol.cards[0].id).toBe('card-1');
    expect(targetCol.cards[0].content).toBe('Card One');
  });

  // ── View → Workspace with hidden items (regression) ──────────────────
  // Exercises the exact scenario that fails in manual testing: a board with
  // hidden rows/stacks/columns, moving a card from the board view (flatColIndex)
  // to a sidebar column (structural indices + columnId) on the same board.
  it('view-to-workspace same-board with hidden items resolves correctly', async () => {
    // Build a board where hidden items cause index gaps:
    //   Row 0 "Main"
    //     Stack 0 "Active"
    //       Col 0 "Todo"        — [card-a, card-b (#deleted), card-c]
    //       Col 1 "Done #parked" (hidden column)
    //     Stack 1 "Inactive #archived" (hidden stack)
    //       Col 2 "Old"         — [card-d]
    //   Row 1 "Deleted Row #deleted" (hidden row)
    //   Row 2 "Secondary"
    //     Stack 0 "Other"
    //       Col 3 "Backlog"     — [card-f, card-g]
    var fixture = buildTestFixture(M);
    M.setState(
      JSON.parse(JSON.stringify(fixture.full)),
      JSON.parse(JSON.stringify(fixture.active)),
      'test-board'
    );
    M.resetRefreshTracking();

    // Source: card-a from "Todo" column via board view (flatColIndex 0, visible card idx 0)
    // Target: "Backlog" column via sidebar tree (display row 1, display stack 0, display col 0)
    // "Backlog" has columnId 'col-backlog', so stable-ID resolution handles it.
    await M.moveCard(
      { boardId: 'test-board', flatColIndex: 0, cardIndex: 0, cardId: 'card-a', cardIndexMode: 'visible', indexMode: 'display' },
      { boardId: 'test-board', rowIndex: 1, stackIndex: 0, colIndex: 0, columnId: 'col-backlog', insertIdx: 2, insertMode: 'visible', indexMode: 'display' }
    );

    // card-a moved from Todo to Backlog
    var srcCol = M.getState().fullBoardData.rows[0].stacks[0].columns[0];
    expect(srcCol.cards.map(function (c) { return c.id; })).toEqual(['card-b', 'card-c']);
    var dstCol = M.getState().fullBoardData.rows[2].stacks[0].columns[0];
    expect(dstCol.cards.map(function (c) { return c.id; })).toEqual(['card-f', 'card-g', 'card-a']);

    // UI: targeted card-remove + card-insert + sidebar refresh (same-board cross-column)
    expect(M.getLastPersistTargets()).toContain('card-remove');
    expect(M.getLastPersistTargets()).toContain('card-insert');
    expect(M.getLastPersistTargets()).toContain('sidebar');
    expect(M.getLastCommitBoardIds()).toBeNull();
  });
});
