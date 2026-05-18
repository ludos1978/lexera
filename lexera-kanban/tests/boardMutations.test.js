import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

/**
 * Extract board mutation and tag functions from app.js for isolated testing.
 */
function loadMutationFunctions() {
  // Load PathUtils first so delegating wrappers in app.js can reference it
  const pathUtilsSource = readFileSync(resolve(srcDir, 'utils', 'pathUtils.js'), 'utf-8');
  new Function(pathUtilsSource)();

  // Load TitleHelpers so TagSystem and OrderHelpers can delegate to it
  const titleHelpersSource = readFileSync(resolve(srcDir, 'titleHelpers.js'), 'utf-8');
  new Function(titleHelpersSource)();

  // Load TagSystem so delegating functions in app.js can reference it
  const tagSystemSource = readFileSync(resolve(srcDir, 'tagSystem.js'), 'utf-8');
  new Function(tagSystemSource)();

  // Load TagColors so tag data constants and functions are available
  const tagColorsSource = readFileSync(resolve(srcDir, 'tagcolors', 'tagColors.js'), 'utf-8');
  new Function(tagColorsSource)();

  // Load ArchiveFormatting so delegating functions in app.js can reference it
  const archiveFormattingSource = readFileSync(resolve(srcDir, 'export', 'archiveFormatting.js'), 'utf-8');
  new Function(archiveFormattingSource + '\nglobalThis.LexeraArchiveFormatting = LexeraArchiveFormatting;')();

  // Load OrderHelpers so delegation stubs in app.js can reference it
  const orderHelpersSource = readFileSync(resolve(srcDir, 'board', 'orderHelpers.js'), 'utf-8');
  new Function(orderHelpersSource)();

  // Load BoardSettings so delegation stubs in app.js can reference it
  const boardSettingsSource = readFileSync(resolve(srcDir, 'board', 'boardSettings.js'), 'utf-8');
  new Function(boardSettingsSource)();

  // Load AppUtils so delegation stubs in app.js can reference it
  const appUtilsSource = readFileSync(resolve(srcDir, 'utils', 'appUtils.js'), 'utf-8');
  new Function(appUtilsSource)();

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

  // Also load contextMenuBuilders.js for menu builder functions
  const cmbSource = readFileSync(resolve(srcDir, 'menu', 'contextMenuBuilders.js'), 'utf-8');
  const cmbLines = cmbSource.split('\n');

  // Also load boardSettings.js for functions extracted from app.js
  const bsSource = readFileSync(resolve(srcDir, 'board', 'boardSettings.js'), 'utf-8');
  const bsLines = bsSource.split('\n');

  // Also load tagColors.js for extracting constants
  const tcSource = readFileSync(resolve(srcDir, 'tagcolors', 'tagColors.js'), 'utf-8');
  const tcLines = tcSource.split('\n');

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

  function findLineAny(pattern) {
    var idx = findLineIn(lines, pattern);
    if (idx > 0) return { lines: lines, line: idx };
    idx = findLineIn(ccmLines, pattern);
    if (idx > 0) return { lines: ccmLines, line: idx };
    idx = findLineIn(colCtxLines, pattern);
    if (idx > 0) return { lines: colCtxLines, line: idx };
    throw new Error('Could not find in app.js, cardContextMenu.js, or columnContextMenu.js: ' + pattern);
  }

  function extractFunctionAny(pattern) {
    // Prefer extracted modules over app.js (which now has delegation stubs)
    var idx = findLineIn(bsLines, pattern);
    if (idx > 0) return extractFunctionFrom(bsLines, idx);
    idx = findLineIn(cmbLines, pattern);
    if (idx > 0) return extractFunctionFrom(cmbLines, idx).replace(/\bdeps\./g, '');
    idx = findLineIn(ccmLines, pattern);
    if (idx > 0) return extractFunctionFrom(ccmLines, idx).replace(/\bdeps\./g, '');
    idx = findLineIn(colCtxLines, pattern);
    if (idx > 0) return extractFunctionFrom(colCtxLines, idx).replace(/\bdeps\./g, '');
    idx = findLineIn(lines, pattern);
    if (idx > 0) return extractFunctionFrom(lines, idx);
    throw new Error('Could not find in app.js, cardContextMenu.js, columnContextMenu.js, boardSettings.js, or contextMenuBuilders.js: ' + pattern);
  }

  function findLineInTc(pattern) {
    for (let i = 0; i < tcLines.length; i++) {
      if (tcLines[i].includes(pattern)) return i + 1;
    }
    throw new Error('Could not find in tagColors: ' + pattern);
  }

  function extractConstFromTc(startLine) {
    let depth = 0;
    let started = false;
    const result = [];
    for (let i = startLine - 1; i < tcLines.length; i++) {
      const line = tcLines[i];
      result.push(line);
      for (let c = 0; c < line.length; c++) {
        if (line[c] === '{' || line[c] === '[') { depth++; started = true; }
        if (line[c] === '}' || line[c] === ']') depth--;
      }
      if (started && depth === 0) break;
    }
    return result.join('\n');
  }

  function extractFunctionFromTc(startLine) {
    let depth = 0;
    let started = false;
    const result = [];
    for (let i = startLine - 1; i < tcLines.length; i++) {
      const line = tcLines[i];
      result.push(line);
      for (let c = 0; c < line.length; c++) {
        if (line[c] === '{') { depth++; started = true; }
        if (line[c] === '}') depth--;
      }
      if (started && depth === 0) break;
    }
    return result.join('\n');
  }

  // Extract TAG_* constants from tagColors.js (moved from app.js)
  const tagCategoriesSource = extractConstFromTc(findLineInTc('var TAG_CATEGORIES = {'));
  const tagColorsConstSource = extractConstFromTc(findLineInTc('var TAG_COLORS = {'));
  const tagPaletteSource = extractConstFromTc(findLineInTc('var TAG_PALETTE = ['));
  const tagStyleRoleSource = extractConstFromTc(findLineInTc('var TAG_STYLE_ROLE_BY_CATEGORY = {'));
  const tagStylePresetsSource = extractConstFromTc(findLineInTc('var TAG_STYLE_PRESETS = {'));

  const fnDefs = [
    tagColorsConstSource,
    tagPaletteSource,
    tagCategoriesSource,
    tagStyleRoleSource,
    tagStylePresetsSource,
    'var _activeTagStylePreset = "default";',
    'var _tagStyleUserOverrides = {};',
    extractFunction(findLine('function normalizePathForCompare(')),
    extractFunction(findLine('function stripPathSearchAndHash(')),
    extractFunction(findLine('function getFileNameFromPath(')),
    extractFunction(findLine('function getDirNameFromPath(')),
    extractFunction(findLine('function extractHtmlComments(')),
    extractFunction(findLine('function stripHtmlComments(')),
    extractFunction(findLine('function stripLayoutTags(')),
    extractFunction(findLine('function rebuildTitleWithPreservedComments(')),
    extractFunctionAny('function normalizeYamlFrontmatterScalar('),
    extractFunction(findLine('function ensureBoardYamlHeaderLines(')),
    extractFunction(findLine('function getYamlFrontmatterValueMap(')),
    extractFunction(findLine('function updateYamlFrontmatterValue(')),
    extractFunction(findLine('function getWhitespaceTokenList(')),
    extractFunction(findLine('function setWhitespaceTokenList(')),
    extractFunction(findLine('function stripInternalHiddenTags(')),
    extractFunction(findLine('function applyInternalHiddenTag(')),
    extractFunction(findLine('function is_archived_or_deleted(')),
    extractFunction(findLine('function getFullCardIndex(')),
    extractFunction(findLine('function getAllColumnsFromBoardData(')),
    extractFunctionAny('function findColumnContainerInBoard('),
    extractFunction(findLine('function escapeRegex(')),
    extractFunction(findLine('function isTagTokenBoundaryChar(')),
    extractFunction(findLine('function normalizeTagTokenForMatch(')),
    extractFunction(findLine('function isTagExpressionBoundaryChar(')),
    extractFunction(findLine('function collectHeaderTagTokens(')),
    extractFunction(findLine('function tokenizeTagExpression(')),
    extractFunction(findLine('function evaluateTagExpression(')),
    extractFunction(findLine('function isTagExpression(')),
    extractFunction(findLine('function extractAllTags(')),
    extractFunction(findLine('function hasTag(')),
    extractFunctionAny('function getMarpDirectiveFinalName('),
    extractFunctionAny('function getMarpDirectiveRegex('),
    extractFunctionAny('function getManagedMarpFinalNames('),
    extractFunctionAny('function getMarpConsolidatedCommentRegex('),
    extractFunctionAny('function splitMarpFlowEntries('),
    extractFunctionAny('function unquoteMarpScalar('),
    extractFunctionAny('function parseMarpConsolidatedBody('),
    extractFunctionAny('function readMarpConsolidatedSettings('),
    extractFunctionAny('function escapeMarpSettingsValue('),
    extractFunctionAny('function serializeMarpConsolidatedComment('),
    extractFunctionAny('function collectLegacyMarpDirectives('),
    extractFunctionAny('function stripManagedMarpComments('),
    extractFunctionAny('function applyMarpSettingMutation('),
    extractFunctionAny('function getMarpDirectiveValueFromHeader('),
    extractFunctionAny('function clearMarpDirectiveFromHeaderText('),
    extractFunctionAny('function setMarpDirectiveInHeaderText('),
    extractFunctionAny('function hasMarpDirectiveValue('),
    extractFunctionAny('function getMarpClassListFromHeader('),
    extractFunctionAny('function setMarpClassListInHeader('),
    extractFunctionAny('function toggleMarpClassInHeaderText('),
    extractFunction(findLine('function isNumericIndexTag(')),
    extractFunctionAny('function extractNumericTag('),
    extractFunctionAny('function extractAllNumericTags('),
    extractFunction(findLine('function normalizeTagCategoryName(')),
    extractFunction(findLine('function getTagCategoryKey(')),
    extractFunction(findLine('function formatTagDisplayLabel(')),
    extractFunction(findLine('function parseColorChannels(')),
    extractFunction(findLine('function getContrastingTextColor(')),
    extractFunction(findLine('function getTagColor(')),
    extractFunctionAny('function escapeAttr('),
    extractFunctionFromTc(findLineInTc('function resolveTagStyleProperty(')),
    extractFunction(findLine('function getResolvedCategoryRole(')),
    extractFunction(findLine('function getTagStyleOverride(')),
    extractFunction(findLine('function applyTagBorderSpecialRules(')),
    extractFunction(findLine('function buildTagStyleDescriptor(')),
    extractFunctionFromTc(findLineInTc('function cloneTagStyleValue(')),
    extractFunction(findLine('function buildCombinedTagStyleDescriptor(')),
    extractFunction(findLine('function toTagAccentRgba(')),
    extractFunction(findLine('function resolveTagSurfaceColor(')),
    extractFunction(findLine('function buildTagStyleRenderState(')),
    extractFunction(findLine('function resolveBackgroundSurfaceColors(')),
    extractFunction(findLine('function buildTagStyleInlineCssText(')),
    extractFunction(findLine('function buildTagStyledLineHtml(')),
    extractFunction(findLine('function wrapRenderedLineBlockHtml(')),
    extractFunction(findLine('function isLayoutTagName(')),
    extractFunction(findLine('function isTagStyleEligible(')),
    extractFunction(findLine('function getFirstStyleTag(')),
    extractFunction(findLine('function getCardContainerStyleSource(')),
    extractFunctionAny('function buildTagSubmenu('),
    extractFunctionAny('function buildCustomTagsSubmenu('),
    extractFunction(findLine('function getColumnLayoutTags(')),
    'var _archiveFormattingHelpers = null;',
    extractFunction(findLine('function getArchiveFormattingHelpers(')),
    extractFunction(findLine('function buildArchiveFileNameFromBoardPath(')),
    extractFunction(findLine('function buildArchiveRelativePathFromBoardPath(')),
    extractFunction(findLine('function buildArchiveFilePathFromBoardPath(')),
    extractFunction(findLine('function buildArchiveFileHeader(')),
    extractFunction(findLine('function buildArchiveTagValue(')),
    extractFunction(findLine('function buildArchiveSectionHeading(')),
    extractFunction(findLine('function cleanArchiveHeadingTitle(')),
    extractFunction(findLine('function formatArchivedCardMarkdown(')),
    extractFunction(findLine('function buildArchiveMarkdownForColumn(')),
    extractFunction(findLine('function buildArchiveMarkdownForStack(')),
    extractFunction(findLine('function buildArchiveMarkdownForRow(')),
    extractFunction(findLine('function buildArchiveMarkdownForHiddenItems(')),
    extractFunction(findLine('function appendArchivedItemsToArchiveContent(')),
  ];

  const wrappedSource = `
    var OrderHelpers = (typeof globalThis !== 'undefined' && globalThis.LexeraOrderHelpers) || null;
    var _AppUtils = (typeof globalThis !== 'undefined' && globalThis.LexeraAppUtils) || null;
    var BoardSettingsModule = (typeof globalThis !== 'undefined' && globalThis.LexeraBoardSettings) || null;
    var BoardDataStore = (typeof globalThis !== 'undefined' && globalThis.LexeraBoardDataStore) || null;
    var PathUtils = globalThis.LexeraPathUtils;
    var TagColors = globalThis.LexeraTagColors;
    var LexeraTagSystem = globalThis.LexeraTagSystem || null;
    ${fnDefs.join('\n\n')}

    // Initialize BoardDataStore with test mock deps
    if (BoardDataStore && typeof BoardDataStore.init === 'function') {
      BoardDataStore.init({
        getFullBoardData: function () { return null; },
        getActiveBoardData: function () { return null; },
        getActiveBoardId: function () { return null; },
        setFullBoardDataState: function () {},
        setActiveBoardDataState: function () {},
        updateActiveBoardDataState: function () {},
        is_archived_or_deleted: typeof is_archived_or_deleted === 'function' ? is_archived_or_deleted : function () { return false; },
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
        LexeraApi: function () { return {}; },
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

    // Initialize OrderHelpers with extracted functions so delegation stubs work
    if (OrderHelpers && typeof OrderHelpers.init === 'function') {
      OrderHelpers.init({
        hasTag: typeof hasTag === 'function' ? hasTag : function () { return false; },
        is_archived_or_deleted: typeof is_archived_or_deleted === 'function' ? is_archived_or_deleted : function () { return false; },
        stripInternalHiddenTags: typeof stripInternalHiddenTags === 'function' ? stripInternalHiddenTags : function (t) { return t; },
        LexeraTagSystem: LexeraTagSystem
      });
    }
    return {
      TAG_CATEGORIES,
      normalizePathForCompare,
      stripPathSearchAndHash,
      getFileNameFromPath,
      getDirNameFromPath,
      extractHtmlComments,
      stripHtmlComments,
      stripLayoutTags,
      rebuildTitleWithPreservedComments,
      normalizeYamlFrontmatterScalar,
      ensureBoardYamlHeaderLines,
      getYamlFrontmatterValueMap,
      updateYamlFrontmatterValue,
      getWhitespaceTokenList,
      setWhitespaceTokenList,
      stripInternalHiddenTags,
      applyInternalHiddenTag,
      is_archived_or_deleted,
      getFullCardIndex,
      getAllColumnsFromBoardData,
      findColumnContainerInBoard,
      escapeRegex,
      extractAllTags,
      hasTag,
      getMarpDirectiveFinalName,
      getMarpDirectiveRegex,
      getMarpDirectiveValueFromHeader,
      clearMarpDirectiveFromHeaderText,
      setMarpDirectiveInHeaderText,
      hasMarpDirectiveValue,
      getMarpClassListFromHeader,
      setMarpClassListInHeader,
      toggleMarpClassInHeaderText,
      isNumericIndexTag,
      extractNumericTag,
      extractAllNumericTags,
      normalizeTagCategoryName,
      getTagCategoryKey,
      formatTagDisplayLabel,
      parseColorChannels,
      getContrastingTextColor,
      getTagColor,
      buildTagStyleDescriptor,
      buildCombinedTagStyleDescriptor,
      buildTagStyleRenderState,
      buildTagStyleInlineCssText,
      buildTagStyledLineHtml,
      wrapRenderedLineBlockHtml,
      isLayoutTagName,
      isTagStyleEligible,
      getFirstStyleTag,
      getCardContainerStyleSource,
      buildTagSubmenu,
      buildCustomTagsSubmenu,
      getColumnLayoutTags,
      buildArchiveFileNameFromBoardPath,
      buildArchiveRelativePathFromBoardPath,
      buildArchiveFilePathFromBoardPath,
      buildArchiveFileHeader,
      buildArchiveTagValue,
      buildArchiveSectionHeading,
      cleanArchiveHeadingTitle,
      formatArchivedCardMarkdown,
      buildArchiveMarkdownForColumn,
      buildArchiveMarkdownForStack,
      buildArchiveMarkdownForRow,
      buildArchiveMarkdownForHiddenItems,
      appendArchivedItemsToArchiveContent,
    };
  `;

  const factory = new Function(wrappedSource);
  return factory();
}

let F;

beforeAll(() => {
  F = loadMutationFunctions();
});

// ─── Helper builders ───

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
 * Simulate updateDisplayFromFullBoard: filter hidden content for display.
 */
function getVisibleCards(col) {
  return col.cards.filter(function (c) {
    return !F.is_archived_or_deleted(c.content || '');
  });
}

function getVisibleColumns(boardData) {
  var allCols = F.getAllColumnsFromBoardData(boardData);
  var visible = [];
  for (var r = 0; r < boardData.rows.length; r++) {
    var row = boardData.rows[r];
    if (F.is_archived_or_deleted(row.title || '')) continue;
    for (var s = 0; s < row.stacks.length; s++) {
      var stack = row.stacks[s];
      if (F.is_archived_or_deleted(stack.title || '')) continue;
      for (var c = 0; c < stack.columns.length; c++) {
        var col = stack.columns[c];
        if (F.is_archived_or_deleted(col.title || '')) continue;
        visible.push({
          flatIndex: allCols.indexOf(col),
          title: col.title,
          cards: getVisibleCards(col)
        });
      }
    }
  }
  return visible;
}

// ═══════════════════════════════════════════════════════════════════════════
// stripInternalHiddenTags
// ═══════════════════════════════════════════════════════════════════════════

describe('stripInternalHiddenTags', () => {
  it('removes #hidden-internal-deleted tag', () => {
    expect(F.stripInternalHiddenTags('hello #hidden-internal-deleted'))
      .toBe('hello');
  });

  it('removes #hidden-internal-archived tag', () => {
    expect(F.stripInternalHiddenTags('task #hidden-internal-archived'))
      .toBe('task');
  });

  it('removes #hidden-internal-parked tag', () => {
    expect(F.stripInternalHiddenTags('card #hidden-internal-parked'))
      .toBe('card');
  });

  it('returns empty string for tag-only content', () => {
    expect(F.stripInternalHiddenTags('#hidden-internal-deleted'))
      .toBe('');
  });

  it('preserves non-hidden tags', () => {
    expect(F.stripInternalHiddenTags('task #todo #hidden-internal-deleted'))
      .toBe('task #todo');
  });

  it('handles null/undefined', () => {
    expect(F.stripInternalHiddenTags(null)).toBe('');
    expect(F.stripInternalHiddenTags(undefined)).toBe('');
    expect(F.stripInternalHiddenTags('')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyInternalHiddenTag
// ═══════════════════════════════════════════════════════════════════════════

describe('applyInternalHiddenTag', () => {
  it('adds deletion tag to content', () => {
    var result = F.applyInternalHiddenTag('my task', '#hidden-internal-deleted');
    expect(result).toContain('#hidden-internal-deleted');
    expect(result).toContain('my task');
  });

  it('replaces existing hidden tag with new one', () => {
    var result = F.applyInternalHiddenTag(
      'task #hidden-internal-parked',
      '#hidden-internal-deleted'
    );
    expect(result).toContain('#hidden-internal-deleted');
    expect(result).not.toContain('#hidden-internal-parked');
  });

  it('handles empty content', () => {
    var result = F.applyInternalHiddenTag('', '#hidden-internal-deleted');
    expect(result).toBe('#hidden-internal-deleted');
  });

  it('strips tag when called with null tag', () => {
    var result = F.applyInternalHiddenTag('task #hidden-internal-deleted', null);
    expect(result).toBe('task');
    expect(result).not.toContain('#hidden-internal');
  });

  it('preserves multiline content', () => {
    var result = F.applyInternalHiddenTag('line1\nline2\nline3', '#hidden-internal-deleted');
    expect(result).toContain('line1');
    expect(result).toContain('line2');
    expect(result).toContain('line3');
    expect(result).toContain('#hidden-internal-deleted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// is_archived_or_deleted
// ═══════════════════════════════════════════════════════════════════════════

describe('is_archived_or_deleted', () => {
  it('detects #hidden-internal-deleted', () => {
    expect(F.is_archived_or_deleted('task #hidden-internal-deleted')).toBe(true);
  });

  it('detects #hidden-internal-archived', () => {
    expect(F.is_archived_or_deleted('task #hidden-internal-archived')).toBe(true);
  });

  it('detects #hidden-internal-parked', () => {
    expect(F.is_archived_or_deleted('task #hidden-internal-parked')).toBe(true);
  });

  it('detects plain #hidden', () => {
    expect(F.is_archived_or_deleted('task #hidden')).toBe(true);
  });

  it('does not match #hidden-something-else', () => {
    expect(F.is_archived_or_deleted('task #hidden-custom')).toBe(false);
  });

  it('returns false for normal content', () => {
    expect(F.is_archived_or_deleted('normal task')).toBe(false);
    expect(F.is_archived_or_deleted('task #todo')).toBe(false);
    expect(F.is_archived_or_deleted('')).toBe(false);
  });

  it('handles null/undefined', () => {
    expect(F.is_archived_or_deleted(null)).toBe(false);
    expect(F.is_archived_or_deleted(undefined)).toBe(false);
  });
});

describe('extractAllNumericTags', () => {
  it('extracts multiple numeric tags from the title header', () => {
    const result = F.extractAllNumericTags('#1 #1.1 Title');
    expect(result).toEqual([
      { tag: '#1', parts: [1] },
      { tag: '#1.1', parts: [1, 1] },
    ]);
  });

  it('deduplicates repeated numeric tags', () => {
    const result = F.extractAllNumericTags('#2 #2 #2.3');
    expect(result).toEqual([
      { tag: '#2', parts: [2] },
      { tag: '#2.3', parts: [2, 3] },
    ]);
  });

  it('keeps numeric tags in heading text while ignoring heading markers', () => {
    const result = F.extractAllNumericTags('## Heading #1.1 ###');
    expect(result).toEqual([
      { tag: '#1.1', parts: [1, 1] },
    ]);
  });
});

describe('getTagCategoryKey', () => {
  it('resolves extended v1 parity categories', () => {
    expect(F.getTagCategoryKey('#urgent')).toBe('priority');
    expect(F.getTagCategoryKey('#must')).toBe('moscow');
    expect(F.getTagCategoryKey('#backend')).toBe('category');
    expect(F.getTagCategoryKey('#online')).toBe('teaching-platform');
    expect(F.getTagCategoryKey('#surface')).toBe('special');
  });
});

describe('buildTagStyleDescriptor', () => {
  it('maps status tags to header styling', () => {
    const result = F.buildTagStyleDescriptor('#todo');
    expect(result.category).toBe('status');
    expect(result.headerBar).toBeTruthy();
    expect(result.footerBar).toBeNull();
    expect(result.border.position).toBe('left');
  });

  it('maps priority tags to footer styling', () => {
    const result = F.buildTagStyleDescriptor('#urgent');
    expect(result.category).toBe('priority');
    expect(result.footerBar).toBeTruthy();
    expect(result.border.width).toBe('3px');
  });

  it('maps color tags to background styling', () => {
    const result = F.buildTagStyleDescriptor('#blue');
    expect(result.category).toBe('colors');
    expect(result.background).toBeTruthy();
    expect(result.border.position).toBe('full');
  });

  it('maps positivity tags to badge styling', () => {
    const result = F.buildTagStyleDescriptor('#++');
    expect(result.category).toBe('positivity');
    expect(result.badge).toBeTruthy();
    expect(result.badge.label).toBe('++');
  });

  it('maps #surface to a solid theme surface card background', () => {
    const result = F.buildTagStyleDescriptor('#surface');
    expect(result.category).toBe('special');
    expect(result.color).toBe('var(--text-primary)');
    expect(result.background).toMatchObject({
      color: 'var(--bg-primary)',
      headerColor: 'var(--bg-primary)',
      contentColor: 'var(--bg-primary)',
      footerColor: 'var(--bg-primary)'
    });
    expect(result.border).toMatchObject({
      style: 'solid',
      width: '1px',
      position: 'full',
      color: 'var(--border)'
    });
  });
});

describe('buildCombinedTagStyleDescriptor', () => {
  it('combines background and border features from different tags', () => {
    const result = F.buildCombinedTagStyleDescriptor(['#blue', '#urgent']);
    expect(result.background).toBeTruthy();
    expect(result.background.color).toBe('#0056B3');
    expect(result.border).toMatchObject({
      style: 'dashed',
      width: '3px',
      position: 'left'
    });
    expect(result.border.color).toBe(F.getTagColor('#urgent'));
    expect(result.color).toBe(F.getTagColor('#urgent'));
  });

  it('keeps a background tag even when it is not the first styled tag', () => {
    const result = F.buildCombinedTagStyleDescriptor(['#urgent', '#surface']);
    expect(result.background).toMatchObject({
      color: 'var(--bg-primary)',
      headerColor: 'var(--bg-primary)',
      contentColor: 'var(--bg-primary)',
      footerColor: 'var(--bg-primary)'
    });
    expect(result.border).toMatchObject({
      style: 'dashed',
      width: '3px',
      position: 'left'
    });
    expect(result.color).toBe(F.getTagColor('#urgent'));
  });

  it('preserves effect fields alongside structural styling', () => {
    const result = F.buildCombinedTagStyleDescriptor(['#blue', '#exclude']);
    expect(result.background).toBeTruthy();
    expect(result.opacity).toBe('0.20');
    expect(result.pattern).toBe('stripes');
  });
});

describe('card tag style scopes', () => {
  it('uses only the first physical card line for whole-card styling', () => {
    expect(F.getCardContainerStyleSource('Title #todo\nBody #urgent\nTail #blue')).toBe('Title #todo');
    expect(F.getCardContainerStyleSource('')).toBe('');
  });

  it('renders line-scoped styling markup for tagged body lines', () => {
    const html = F.buildTagStyledLineHtml('div', 'Body', 'Body #surface #urgent', {
      className: 'card-line-scope'
    });
    expect(html).toContain('class="card-line-scope tag-line-styled"');
    expect(html).toContain('data-tag-border-position="left"');
    expect(html).toContain('--tag-surface-bg:var(--bg-primary)');
    expect(html).toContain('--tag-border-style:dashed');
    expect(html).toContain('--tag-border-width:3px');
  });

  it('leaves untagged lines untouched when wrapping block html', () => {
    expect(F.wrapRenderedLineBlockHtml('<div>Plain</div>', 'Plain line')).toBe('<div>Plain</div>');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getFullCardIndex
// ═══════════════════════════════════════════════════════════════════════════

describe('getFullCardIndex', () => {
  it('maps visible index 0 to full index 0 when no hidden cards', () => {
    var col = makeColumn('c1', 'Col', [
      makeCard('a', 'card A'),
      makeCard('b', 'card B'),
      makeCard('c', 'card C'),
    ]);
    expect(F.getFullCardIndex(col, 0)).toBe(0);
    expect(F.getFullCardIndex(col, 1)).toBe(1);
    expect(F.getFullCardIndex(col, 2)).toBe(2);
  });

  it('skips deleted cards when mapping', () => {
    var col = makeColumn('c1', 'Col', [
      makeCard('a', 'card A'),
      makeCard('b', 'deleted #hidden-internal-deleted'),
      makeCard('c', 'card C'),
      makeCard('d', 'card D'),
    ]);
    expect(F.getFullCardIndex(col, 0)).toBe(0); // card A
    expect(F.getFullCardIndex(col, 1)).toBe(2); // card C (skips deleted)
    expect(F.getFullCardIndex(col, 2)).toBe(3); // card D
  });

  it('skips archived and parked cards', () => {
    var col = makeColumn('c1', 'Col', [
      makeCard('a', 'archived #hidden-internal-archived'),
      makeCard('b', 'parked #hidden-internal-parked'),
      makeCard('c', 'visible'),
    ]);
    expect(F.getFullCardIndex(col, 0)).toBe(2); // only 'visible' is at vis-0
  });

  it('returns -1 for out-of-range visible index', () => {
    var col = makeColumn('c1', 'Col', [
      makeCard('a', 'card A'),
    ]);
    expect(F.getFullCardIndex(col, 1)).toBe(-1);
    expect(F.getFullCardIndex(col, 5)).toBe(-1);
  });

  it('returns -1 when all cards are hidden', () => {
    var col = makeColumn('c1', 'Col', [
      makeCard('a', '#hidden-internal-deleted'),
      makeCard('b', '#hidden-internal-archived'),
    ]);
    expect(F.getFullCardIndex(col, 0)).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// escapeRegex
// ═══════════════════════════════════════════════════════════════════════════

describe('escapeRegex', () => {
  it('escapes special regex characters', () => {
    expect(F.escapeRegex('#++')).toBe('#\\+\\+');
    expect(F.escapeRegex('#--')).toBe('#--'); // '-' is not a regex special char
    expect(F.escapeRegex('#ø')).toBe('#ø');
  });

  it('leaves normal strings unchanged', () => {
    expect(F.escapeRegex('#todo')).toBe('#todo');
    expect(F.escapeRegex('hello')).toBe('hello');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// extractAllTags
// ═══════════════════════════════════════════════════════════════════════════

describe('extractAllTags', () => {
  it('extracts tags from single line', () => {
    var tags = F.extractAllTags('task #todo #urgent');
    expect(tags).toContain('#todo');
    expect(tags).toContain('#urgent');
  });

  it('extracts tags from header lines only (stops at empty line)', () => {
    var tags = F.extractAllTags('header #tag1\n\nbody #tag2');
    expect(tags).toContain('#tag1');
    expect(tags).not.toContain('#tag2');
  });

  it('extracts non-alphanumeric tags like #++ and #--', () => {
    var tags = F.extractAllTags('task #++ #--');
    expect(tags).toContain('#++');
    expect(tags).toContain('#--');
  });

  it('extracts numeric and dotted tags', () => {
    var tags = F.extractAllTags('task #0 #1 #1.1 #1.01');
    expect(tags).toContain('#0');
    expect(tags).toContain('#1');
    expect(tags).toContain('#1.1');
    expect(tags).toContain('#1.01');
  });

  it('treats &, |, ! as separators between tags', () => {
    var tags = F.extractAllTags('task #todo&#urgent | #1.2 !#later');
    expect(tags).toContain('#todo');
    expect(tags).toContain('#urgent');
    expect(tags).toContain('#1.2');
    expect(tags).toContain('#later');
  });

  it('supports tab/newline terminated tags', () => {
    var tags = F.extractAllTags('title #1\t#1.1\nnext #2');
    expect(tags).toContain('#1');
    expect(tags).toContain('#1.1');
    expect(tags).toContain('#2');
  });

  it('returns empty array for empty text', () => {
    expect(F.extractAllTags('')).toEqual([]);
    expect(F.extractAllTags(null)).toEqual([]);
  });

  it('deduplicates tags', () => {
    var tags = F.extractAllTags('#todo line1\n#todo line2');
    var count = tags.filter(function (t) { return t === '#todo'; }).length;
    expect(count).toBe(1);
  });

  it('extracts from multiline header', () => {
    var tags = F.extractAllTags('title #tag1\nsubtitle #tag2\n\nbody #tag3');
    expect(tags).toContain('#tag1');
    expect(tags).toContain('#tag2');
    expect(tags).not.toContain('#tag3');
  });

  it('ignores markdown heading markers while keeping tags in heading text', () => {
    expect(F.extractAllTags('# Heading')).toEqual([]);
    expect(F.extractAllTags('## Heading ###')).toEqual([]);
    expect(F.extractAllTags('### Heading #todo ###')).toEqual(['#todo']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// hasTag
// ═══════════════════════════════════════════════════════════════════════════

describe('hasTag', () => {
  it('finds tag in header', () => {
    expect(F.hasTag('task #todo', '#todo')).toBe(true);
  });

  it('does not find tag after empty line', () => {
    expect(F.hasTag('header\n\nbody #todo', '#todo')).toBe(false);
  });

  it('does not match partial tags', () => {
    expect(F.hasTag('task #todolist', '#todo')).toBe(false);
  });

  it('handles special characters in tags', () => {
    expect(F.hasTag('task #++', '#++')).toBe(true);
    expect(F.hasTag('task #--', '#--')).toBe(true);
    expect(F.hasTag('task #+', '#+')).toBe(true);
  });

  it('returns false for missing tag', () => {
    expect(F.hasTag('task #todo', '#done')).toBe(false);
  });

  it('handles empty/null text', () => {
    expect(F.hasTag('', '#todo')).toBe(false);
    expect(F.hasTag(null, '#todo')).toBe(false);
  });

  it('finds numeric and dotted tags', () => {
    expect(F.hasTag('task #1 #1.1', '#1')).toBe(true);
    expect(F.hasTag('task #1 #1.1', '#1.1')).toBe(true);
    expect(F.hasTag('task #1 #1.1', '#1.2')).toBe(false);
  });

  it('does not match #1 inside dotted-only #1.1 tag', () => {
    expect(F.hasTag('task #1.1', '#1')).toBe(false);
    expect(F.hasTag('task #1.1', '#1.1')).toBe(true);
  });

  it('supports tab/newline-delimited tags and operator separators', () => {
    var text = 'task #todo\t#urgent\n@today | #later';
    expect(F.hasTag(text, '#todo & #urgent')).toBe(true);
    expect(F.hasTag(text, '#todo & @today')).toBe(true);
    expect(F.hasTag(text, '#todo & #blocked')).toBe(false);
    expect(F.hasTag(text, '#todo & (#later | #blocked)')).toBe(true);
  });

  it('supports expression operators with # and @ tags', () => {
    var text = 'task #todo #urgent @today';
    expect(F.hasTag(text, '#todo & #urgent')).toBe(true);
    expect(F.hasTag(text, '#todo & !#blocked')).toBe(true);
    expect(F.hasTag(text, '#blocked | #urgent')).toBe(true);
    expect(F.hasTag(text, '#todo & @today')).toBe(true);
    expect(F.hasTag(text, '#todo & #blocked')).toBe(false);
  });

  it('supports implicit AND between adjacent tags in expressions', () => {
    var text = 'task #todo #urgent';
    expect(F.hasTag(text, '#todo #urgent')).toBe(true);
    expect(F.hasTag(text, '#todo #blocked')).toBe(false);
  });

  it('supports parentheses grouping in expressions', () => {
    var text = 'task #todo #blocked @today';
    expect(F.hasTag(text, '(#todo | #done) & !#blocked')).toBe(false);
    expect(F.hasTag(text, '(#todo | #done) & (@today | @tomorrow)')).toBe(true);
    expect(F.hasTag(text, '#todo | (#done & @tomorrow)')).toBe(true);
  });

  it('does not treat heading markers as tags', () => {
    expect(F.hasTag('## Heading', '##')).toBe(false);
    expect(F.hasTag('### Heading #todo ###', '#todo')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tag style eligibility
// ═══════════════════════════════════════════════════════════════════════════

describe('tag style eligibility', () => {
  it('treats numeric index tags as non-style tags', () => {
    expect(F.isNumericIndexTag('#0')).toBe(true);
    expect(F.isNumericIndexTag('#1')).toBe(true);
    expect(F.isNumericIndexTag('#1.1')).toBe(true);
    expect(F.isNumericIndexTag('#1.01.3')).toBe(true);
    expect(F.isNumericIndexTag('#todo')).toBe(false);
  });

  it('does not style numeric index tags', () => {
    expect(F.isTagStyleEligible('#1')).toBe(false);
    expect(F.isTagStyleEligible('#1.1')).toBe(false);
  });

  it('picks first non-numeric style tag from title header', () => {
    expect(F.getFirstStyleTag('Plan #1 #1.2 #todo')).toBe('#todo');
    expect(F.getFirstStyleTag('Plan #0 #1.1')).toBe('');
  });
});

describe('extractNumericTag', () => {
  it('extracts first numeric index tag from header block', () => {
    expect(F.extractNumericTag('task #1 #2')).toEqual([1]);
    expect(F.extractNumericTag('task #1.2 #3')).toEqual([1, 2]);
  });

  it('respects separators like tab/newline and operators', () => {
    expect(F.extractNumericTag('task #1\t#2')).toEqual([1]);
    expect(F.extractNumericTag('task #1.1&#2 @today')).toEqual([1, 1]);
    expect(F.extractNumericTag('task !#3 | #4')).toEqual([3]);
  });

  it('does not parse body tags after first blank line', () => {
    expect(F.extractNumericTag('title\n\nbody #7')).toBe(null);
  });

  it('returns null when no numeric tag exists', () => {
    expect(F.extractNumericTag('task #todo @today')).toBe(null);
  });

  it('ignores heading markers when scanning for numeric tags', () => {
    expect(F.extractNumericTag('### Heading #2 ###')).toEqual([2]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getAllColumnsFromBoardData
// ═══════════════════════════════════════════════════════════════════════════

describe('getAllColumnsFromBoardData', () => {
  it('returns flat list from rows→stacks→columns', () => {
    var col1 = makeColumn('c1', 'Col 1', []);
    var col2 = makeColumn('c2', 'Col 2', []);
    var col3 = makeColumn('c3', 'Col 3', []);
    var board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack 1', [col1, col2]),
        makeStack('s2', 'Stack 2', [col3])
      ])
    ]);
    var cols = F.getAllColumnsFromBoardData(board);
    expect(cols).toHaveLength(3);
    expect(cols[0]).toBe(col1);
    expect(cols[1]).toBe(col2);
    expect(cols[2]).toBe(col3);
  });

  it('includes hidden columns in flat list', () => {
    var col1 = makeColumn('c1', 'Visible', []);
    var col2 = makeColumn('c2', 'Hidden #hidden-internal-deleted', []);
    var col3 = makeColumn('c3', 'Also Visible', []);
    var board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [col1, col2, col3])
      ])
    ]);
    var cols = F.getAllColumnsFromBoardData(board);
    expect(cols).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// findColumnContainerInBoard
// ═══════════════════════════════════════════════════════════════════════════

describe('findColumnContainerInBoard', () => {
  it('finds column by flat index', () => {
    var col1 = makeColumn('c1', 'Col 1', []);
    var col2 = makeColumn('c2', 'Col 2', []);
    var board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack 1', [col1]),
        makeStack('s2', 'Stack 2', [col2])
      ])
    ]);
    var result = F.findColumnContainerInBoard(board, 1);
    expect(result).not.toBeNull();
    expect(result.arr).toBe(board.rows[0].stacks[1].columns);
    expect(result.localIdx).toBe(0);
    expect(result.rowIdx).toBe(0);
    expect(result.stackIdx).toBe(1);
  });

  it('returns null for out-of-range index', () => {
    var board = makeBoard([
      makeRow('r1', 'Row', [makeStack('s1', 'Stack', [makeColumn('c1', 'Col', [])])])
    ]);
    expect(F.findColumnContainerInBoard(board, 5)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getColumnLayoutTags
// ═══════════════════════════════════════════════════════════════════════════

describe('getColumnLayoutTags', () => {
  it('extracts #span tag', () => {
    var layout = F.getColumnLayoutTags('Col #span2');
    expect(layout.span).toBe('#span2');
  });

  it('extracts #row tag', () => {
    var layout = F.getColumnLayoutTags('Col #row3');
    expect(layout.row).toBe('#row3');
  });

  it('detects #stack tag', () => {
    var layout = F.getColumnLayoutTags('Col #stack');
    expect(layout.stack).toBe(true);
  });

  it('returns defaults for plain title', () => {
    var layout = F.getColumnLayoutTags('Simple Column');
    expect(layout.row).toBe('');
    expect(layout.span).toBe('');
    expect(layout.stack).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildTagSubmenu
// ═══════════════════════════════════════════════════════════════════════════

describe('buildTagSubmenu', () => {
  it('marks active tags with checkmark', () => {
    var sub = F.buildTagSubmenu('Status', ['todo', 'done'], 'task #todo', 'tag-status-');
    expect(sub.label).toBe('Status');
    var todoItem = sub.items.find(function (i) { return i.id === 'tag-status-todo'; });
    var doneItem = sub.items.find(function (i) { return i.id === 'tag-status-done'; });
    expect(todoItem.label).toMatch(/^✓/);
    expect(doneItem.label).not.toMatch(/^✓/);
  });

  it('creates items for all tags', () => {
    var sub = F.buildTagSubmenu('Colors', ['red', 'blue', 'green'], '', 'tag-color-');
    expect(sub.items).toHaveLength(3);
  });

  it('includes special surface tags in category submenus', () => {
    var sub = F.buildTagSubmenu('Special', ['surface', 'draft'], '', 'tag-special-');
    var ids = sub.items.map(function (i) { return i.id; });
    expect(ids).toContain('tag-special-surface');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildCustomTagsSubmenu
// ═══════════════════════════════════════════════════════════════════════════

describe('buildCustomTagsSubmenu', () => {
  it('returns null when no custom tags', () => {
    expect(F.buildCustomTagsSubmenu('task #todo', 'tag-custom-')).toBeNull();
  });

  it('detects custom tags not in categories', () => {
    var sub = F.buildCustomTagsSubmenu('task #myproject', 'tag-custom-');
    expect(sub).not.toBeNull();
    expect(sub.items.length).toBeGreaterThan(0);
    expect(sub.items[0].id).toBe('tag-custom-myproject');
  });

  it('excludes hidden-internal tags', () => {
    var sub = F.buildCustomTagsSubmenu('task #hidden-internal-parked #myproject', 'tag-custom-');
    var ids = sub.items.map(function (i) { return i.id; });
    expect(ids).not.toContain('tag-custom-hidden-internal-parked');
    expect(ids).toContain('tag-custom-myproject');
  });

  it('excludes layout tags', () => {
    var sub = F.buildCustomTagsSubmenu('task #span2 #stack #myproject', 'tag-custom-');
    var ids = sub.items.map(function (i) { return i.id; });
    expect(ids).not.toContain('tag-custom-span2');
    expect(ids).not.toContain('tag-custom-stack');
    expect(ids).toContain('tag-custom-myproject');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CRUD Flow Simulations
// ═══════════════════════════════════════════════════════════════════════════

describe('Card deletion flow', () => {
  it('marks card as deleted and hides it from display', () => {
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'task one'),
      makeCard('card2', 'task two'),
      makeCard('card3', 'task three'),
    ]);
    var board = makeBoard([makeRow('r1', 'Row', [makeStack('s1', 'Stack', [col])])]);

    // Simulate deleteCard: tagCard → applyInternalHiddenTag
    var fullIdx = F.getFullCardIndex(col, 1); // visible index 1 = card2
    expect(fullIdx).toBe(1);
    col.cards[fullIdx].content = F.applyInternalHiddenTag(col.cards[fullIdx].content, '#hidden-internal-deleted');

    // Verify card is tagged
    expect(col.cards[1].content).toContain('#hidden-internal-deleted');
    expect(F.is_archived_or_deleted(col.cards[1].content)).toBe(true);

    // Verify display filtering
    var visibleCards = getVisibleCards(col);
    expect(visibleCards).toHaveLength(2);
    expect(visibleCards[0].id).toBe('card1');
    expect(visibleCards[1].id).toBe('card3');

    // Full data still has 3 cards
    expect(col.cards).toHaveLength(3);
  });

  it('deletion persists through simulated save/reload cycle', () => {
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'task one'),
      makeCard('card2', 'task two'),
    ]);
    var board = makeBoard([makeRow('r1', 'Row', [makeStack('s1', 'Stack', [col])])]);

    // Delete card2
    var fullIdx = F.getFullCardIndex(col, 1);
    col.cards[fullIdx].content = F.applyInternalHiddenTag(col.cards[fullIdx].content, '#hidden-internal-deleted');

    // Simulate save/reload: deep clone board (as server would return)
    var reloaded = JSON.parse(JSON.stringify(board));
    var reloadedCol = reloaded.rows[0].stacks[0].columns[0];

    // Deleted card should still be marked in reloaded data
    expect(F.is_archived_or_deleted(reloadedCol.cards[1].content)).toBe(true);

    // Display should still filter it out
    var visibleAfterReload = getVisibleCards(reloadedCol);
    expect(visibleAfterReload).toHaveLength(1);
    expect(visibleAfterReload[0].id).toBe('card1');
  });

  it('index mapping stays correct after deletion', () => {
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'first'),
      makeCard('card2', 'second'),
      makeCard('card3', 'third'),
      makeCard('card4', 'fourth'),
    ]);

    // Delete card2 (visible index 1)
    var fullIdx = F.getFullCardIndex(col, 1);
    col.cards[fullIdx].content = F.applyInternalHiddenTag(col.cards[fullIdx].content, '#hidden-internal-deleted');

    // Now visible indices should map correctly
    expect(F.getFullCardIndex(col, 0)).toBe(0); // card1
    expect(F.getFullCardIndex(col, 1)).toBe(2); // card3 (skips deleted card2)
    expect(F.getFullCardIndex(col, 2)).toBe(3); // card4
    expect(F.getFullCardIndex(col, 3)).toBe(-1); // out of range
  });

  it('multiple deletions maintain correct index mapping', () => {
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'first'),
      makeCard('card2', 'second'),
      makeCard('card3', 'third'),
      makeCard('card4', 'fourth'),
      makeCard('card5', 'fifth'),
    ]);

    // Delete card1 (visible 0) and card3 (visible 2)
    var idx1 = F.getFullCardIndex(col, 0);
    col.cards[idx1].content = F.applyInternalHiddenTag(col.cards[idx1].content, '#hidden-internal-deleted');

    // After deleting card1, visible indices shift
    var idx3 = F.getFullCardIndex(col, 1); // was visible 2, now visible 1
    col.cards[idx3].content = F.applyInternalHiddenTag(col.cards[idx3].content, '#hidden-internal-deleted');

    // Verify visible cards
    var visible = getVisibleCards(col);
    expect(visible).toHaveLength(3);
    expect(visible[0].id).toBe('card2');
    expect(visible[1].id).toBe('card4');
    expect(visible[2].id).toBe('card5');

    // Verify index mapping
    expect(F.getFullCardIndex(col, 0)).toBe(1); // card2
    expect(F.getFullCardIndex(col, 1)).toBe(3); // card4
    expect(F.getFullCardIndex(col, 2)).toBe(4); // card5
  });
});

describe('Card addition flow', () => {
  it('adds card to empty column', () => {
    var col = makeColumn('c1', 'Todo', []);
    var board = makeBoard([makeRow('r1', 'Row', [makeStack('s1', 'Stack', [col])])]);

    // Simulate addEmptyCardToActiveBoard
    var card = { id: 'card-new', content: '', checked: false };
    col.cards.push(card);

    expect(col.cards).toHaveLength(1);
    expect(col.cards[0].id).toBe('card-new');

    // Should be visible
    var visible = getVisibleCards(col);
    expect(visible).toHaveLength(1);
  });

  it('adds card at end of non-empty column', () => {
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'existing'),
    ]);

    var card = { id: 'card-new', content: '', checked: false };
    col.cards.push(card);

    expect(col.cards).toHaveLength(2);
    var visible = getVisibleCards(col);
    expect(visible).toHaveLength(2);
    expect(visible[1].id).toBe('card-new');
  });

  it('added card persists through save/reload', () => {
    var col = makeColumn('c1', 'Todo', [makeCard('card1', 'existing')]);
    var board = makeBoard([makeRow('r1', 'Row', [makeStack('s1', 'Stack', [col])])]);

    col.cards.push({ id: 'card-new', content: 'new task', checked: false });

    var reloaded = JSON.parse(JSON.stringify(board));
    var reloadedCol = reloaded.rows[0].stacks[0].columns[0];
    expect(reloadedCol.cards).toHaveLength(2);
    expect(reloadedCol.cards[1].content).toBe('new task');
  });
});

describe('Card insertion at index', () => {
  it('inserts at beginning', () => {
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'first'),
      makeCard('card2', 'second'),
    ]);

    var card = { id: 'card-new', content: '', checked: false };
    col.cards.splice(0, 0, card);

    expect(col.cards).toHaveLength(3);
    expect(col.cards[0].id).toBe('card-new');
    expect(col.cards[1].id).toBe('card1');
  });

  it('inserts at correct full index when deleted cards exist', () => {
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'first'),
      makeCard('card2', 'deleted #hidden-internal-deleted'),
      makeCard('card3', 'third'),
    ]);

    // Want to insert before visible card at index 1 (card3)
    // Must use getFullCardIndex to get the correct full index
    var fullIdx = F.getFullCardIndex(col, 1); // should be 2
    expect(fullIdx).toBe(2);

    var card = { id: 'card-new', content: 'inserted', checked: false };
    col.cards.splice(fullIdx, 0, card);

    // Verify order
    expect(col.cards).toHaveLength(4);
    expect(col.cards[0].id).toBe('card1');
    expect(col.cards[1].id).toBe('card2'); // deleted, still in place
    expect(col.cards[2].id).toBe('card-new'); // inserted before card3
    expect(col.cards[3].id).toBe('card3');

    // Verify visible order
    var visible = getVisibleCards(col);
    expect(visible).toHaveLength(3);
    expect(visible[0].id).toBe('card1');
    expect(visible[1].id).toBe('card-new');
    expect(visible[2].id).toBe('card3');
  });

  it('BUG: inserting with visible index skips deleted cards incorrectly', () => {
    // This documents the bug in insertCardAtIndex where visible index
    // is used directly as splice position without mapping
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'first'),
      makeCard('card2', 'deleted #hidden-internal-deleted'),
      makeCard('card3', 'third'),
    ]);

    // Using visible index 1 directly (BUG: should use getFullCardIndex)
    var visibleIdx = 1;
    var card = { id: 'card-new', content: 'inserted', checked: false };
    col.cards.splice(visibleIdx, 0, card); // WRONG: inserts at full index 1

    // Card ends up between card1 and card2 (deleted), NOT before card3
    expect(col.cards[1].id).toBe('card-new'); // wrong position
    expect(col.cards[3].id).toBe('card3');

    // Visible order is wrong: card-new appears before deleted card2,
    // not before card3 as user intended
    var visible = getVisibleCards(col);
    expect(visible[0].id).toBe('card1');
    expect(visible[1].id).toBe('card-new'); // shows up here instead of before card3
    expect(visible[2].id).toBe('card3');
  });
});

describe('Card duplication flow', () => {
  it('duplicates card at correct position', () => {
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'first'),
      makeCard('card2', 'second'),
      makeCard('card3', 'third'),
    ]);

    // Simulate duplicateCard(colIndex, visibleCardIndex=1)
    var fullIdx = F.getFullCardIndex(col, 1); // card2
    var clone = JSON.parse(JSON.stringify(col.cards[fullIdx]));
    clone.id = 'dup-1';
    clone.kid = null;
    col.cards.splice(fullIdx + 1, 0, clone);

    expect(col.cards).toHaveLength(4);
    expect(col.cards[1].id).toBe('card2');
    expect(col.cards[2].id).toBe('dup-1');
    expect(col.cards[2].content).toBe('second');
    expect(col.cards[3].id).toBe('card3');
  });

  it('duplicates card with deleted cards present', () => {
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'first'),
      makeCard('card2', 'deleted #hidden-internal-deleted'),
      makeCard('card3', 'third'),
    ]);

    // Duplicate visible index 1 (card3)
    var fullIdx = F.getFullCardIndex(col, 1); // = 2
    expect(fullIdx).toBe(2);
    var clone = JSON.parse(JSON.stringify(col.cards[fullIdx]));
    clone.id = 'dup-1';
    clone.kid = null;
    col.cards.splice(fullIdx + 1, 0, clone);

    expect(col.cards).toHaveLength(4);
    var visible = getVisibleCards(col);
    expect(visible).toHaveLength(3);
    expect(visible[0].id).toBe('card1');
    expect(visible[1].id).toBe('card3');
    expect(visible[2].id).toBe('dup-1');
  });
});

describe('Column duplication flow', () => {
  it('deep clones column with all cards', () => {
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'task one'),
      makeCard('card2', 'task two'),
    ]);
    var stack = makeStack('s1', 'Stack', [col]);
    var board = makeBoard([makeRow('r1', 'Row', [stack])]);

    var container = F.findColumnContainerInBoard(board, 0);
    var original = container.arr[container.localIdx];
    var clone = JSON.parse(JSON.stringify(original));
    clone.id = 'col-dup';
    for (var k = 0; k < clone.cards.length; k++) {
      clone.cards[k].id = 'dup-' + k;
      clone.cards[k].kid = null;
    }
    container.arr.splice(container.localIdx + 1, 0, clone);

    expect(stack.columns).toHaveLength(2);
    expect(stack.columns[0].id).toBe('c1');
    expect(stack.columns[1].id).toBe('col-dup');
    expect(stack.columns[1].cards).toHaveLength(2);
    expect(stack.columns[1].cards[0].id).toBe('dup-0');

    // Modifying clone shouldn't affect original
    clone.cards[0].content = 'modified';
    expect(col.cards[0].content).toBe('task one');
  });
});

describe('Row duplication flow', () => {
  it('deep clones row with all stacks, columns, and cards', () => {
    var board = makeBoard([
      makeRow('r1', 'Row 1', [
        makeStack('s1', 'Stack', [
          makeColumn('c1', 'Col', [makeCard('card1', 'content')])
        ])
      ])
    ]);

    var row = board.rows[0];
    var clone = JSON.parse(JSON.stringify(row));
    clone.id = 'row-dup';
    clone.stacks[0].id = 'stack-dup';
    clone.stacks[0].columns[0].id = 'col-dup';
    clone.stacks[0].columns[0].cards[0].id = 'card-dup';
    clone.stacks[0].columns[0].cards[0].kid = null;
    board.rows.splice(1, 0, clone);

    expect(board.rows).toHaveLength(2);
    var cols = F.getAllColumnsFromBoardData(board);
    expect(cols).toHaveLength(2);
    expect(cols[0].id).toBe('c1');
    expect(cols[1].id).toBe('col-dup');

    // Independence check
    clone.stacks[0].columns[0].cards[0].content = 'changed';
    expect(board.rows[0].stacks[0].columns[0].cards[0].content).toBe('content');
  });
});

describe('Tag toggle flow', () => {
  it('adds tag to content without tag', () => {
    var text = 'my task';
    var tagName = '#todo';
    var re = new RegExp('(^|\\s)' + F.escapeRegex(tagName) + '(?=\\s|$)');
    expect(re.test(text)).toBe(false);

    // Add tag
    var lines = text.split('\n');
    lines[0] = (lines[0] || '') + ' ' + tagName;
    var newText = lines.join('\n');

    expect(newText).toBe('my task #todo');
    expect(F.hasTag(newText, '#todo')).toBe(true);
  });

  it('removes tag from content with tag', () => {
    var text = 'my task #todo';
    var tagName = '#todo';
    var re = new RegExp('(^|\\s)' + F.escapeRegex(tagName) + '(?=\\s|$)');
    expect(re.test(text)).toBe(true);

    // Remove tag
    var newText = text.replace(re, '$1').replace(/  +/g, ' ').trim();

    expect(newText).toBe('my task');
    expect(F.hasTag(newText, '#todo')).toBe(false);
  });

  it('toggles positivity tags with special chars', () => {
    var text = 'task #++';
    var tagName = '#++';
    var re = new RegExp('(^|\\s)' + F.escapeRegex(tagName) + '(?=\\s|$)');
    expect(re.test(text)).toBe(true);

    var newText = text.replace(re, '$1').replace(/  +/g, ' ').trim();
    expect(newText).toBe('task');
    expect(F.hasTag(newText, '#++')).toBe(false);
  });

  it('adds tag to empty content', () => {
    var text = '';
    var tagName = '#todo';
    var lines = text.split('\n');
    lines[0] = (lines[0] || '') + ' ' + tagName;
    var newText = lines.join('\n');

    expect(newText).toBe(' #todo');
  });

  it('preserves multiline content when toggling', () => {
    var text = 'title #todo\n\ndescription line';
    var tagName = '#todo';
    var re = new RegExp('(^|\\s)' + F.escapeRegex(tagName) + '(?=\\s|$)');
    var newText = text.replace(re, '$1').replace(/  +/g, ' ').trim();

    // Should only remove from first line, keep structure
    expect(newText).toContain('title');
    expect(newText).toContain('description line');
    expect(F.hasTag(newText, '#todo')).toBe(false);
  });
});

describe('Display filtering (updateDisplayFromFullBoard simulation)', () => {
  it('filters deleted cards from display', () => {
    var board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('c1', 'Col', [
            makeCard('card1', 'visible'),
            makeCard('card2', 'deleted #hidden-internal-deleted'),
            makeCard('card3', 'also visible'),
          ])
        ])
      ])
    ]);

    var visibleCols = getVisibleColumns(board);
    expect(visibleCols).toHaveLength(1);
    expect(visibleCols[0].cards).toHaveLength(2);
    expect(visibleCols[0].cards[0].id).toBe('card1');
    expect(visibleCols[0].cards[1].id).toBe('card3');
  });

  it('filters deleted rows from display', () => {
    var board = makeBoard([
      makeRow('r1', 'Visible Row', [makeStack('s1', 'Stack', [makeColumn('c1', 'Col', [])])]),
      makeRow('r2', 'Deleted Row #hidden-internal-deleted', [makeStack('s2', 'Stack', [makeColumn('c2', 'Col', [])])]),
    ]);

    var visibleCols = getVisibleColumns(board);
    expect(visibleCols).toHaveLength(1);
    expect(visibleCols[0].title).toBe('Col');
  });

  it('filters deleted stacks from display', () => {
    var board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Visible Stack', [makeColumn('c1', 'Col 1', [])]),
        makeStack('s2', 'Deleted Stack #hidden-internal-archived', [makeColumn('c2', 'Col 2', [])]),
      ])
    ]);

    var visibleCols = getVisibleColumns(board);
    expect(visibleCols).toHaveLength(1);
    expect(visibleCols[0].title).toBe('Col 1');
  });

  it('filters deleted columns from display', () => {
    var board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('c1', 'Visible', []),
          makeColumn('c2', 'Hidden #hidden-internal-parked', []),
        ])
      ])
    ]);

    var visibleCols = getVisibleColumns(board);
    expect(visibleCols).toHaveLength(1);
    expect(visibleCols[0].title).toBe('Visible');
  });

  it('preserves flat index mapping after filtering', () => {
    var board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('c1', 'Col 1', []),
          makeColumn('c2', 'Deleted #hidden-internal-deleted', []),
          makeColumn('c3', 'Col 3', []),
        ])
      ])
    ]);

    var allCols = F.getAllColumnsFromBoardData(board);
    expect(allCols).toHaveLength(3);

    var visibleCols = getVisibleColumns(board);
    expect(visibleCols).toHaveLength(2);
    // flatIndex should point to position in ALL columns (including hidden)
    expect(visibleCols[0].flatIndex).toBe(0); // c1 at flat index 0
    expect(visibleCols[1].flatIndex).toBe(2); // c3 at flat index 2 (not 1!)
  });
});

describe('End-to-end: delete then add', () => {
  it('add after delete keeps data consistent', () => {
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'task one'),
      makeCard('card2', 'task two'),
    ]);
    var board = makeBoard([makeRow('r1', 'Row', [makeStack('s1', 'Stack', [col])])]);

    // Delete card1 (visible index 0)
    var deleteIdx = F.getFullCardIndex(col, 0);
    col.cards[deleteIdx].content = F.applyInternalHiddenTag(col.cards[deleteIdx].content, '#hidden-internal-deleted');

    // Add new card
    col.cards.push({ id: 'card-new', content: 'new task', checked: false });

    // Full data has 3 cards (1 deleted + 1 original + 1 new)
    expect(col.cards).toHaveLength(3);

    // Display shows 2 visible cards
    var visible = getVisibleCards(col);
    expect(visible).toHaveLength(2);
    expect(visible[0].id).toBe('card2');
    expect(visible[1].id).toBe('card-new');
  });

  it('delete after add keeps data consistent', () => {
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'task one'),
    ]);

    // Add card
    col.cards.push({ id: 'card-new', content: 'new task', checked: false });
    expect(getVisibleCards(col)).toHaveLength(2);

    // Delete the new card (visible index 1)
    var deleteIdx = F.getFullCardIndex(col, 1);
    col.cards[deleteIdx].content = F.applyInternalHiddenTag(col.cards[deleteIdx].content, '#hidden-internal-deleted');

    expect(col.cards).toHaveLength(2);
    var visible = getVisibleCards(col);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('card1');
  });
});

describe('End-to-end: multiple operations on same board', () => {
  it('add, duplicate, delete, tag toggle sequence', () => {
    var col = makeColumn('c1', 'Todo', [
      makeCard('card1', 'original task'),
    ]);
    var board = makeBoard([makeRow('r1', 'Row', [makeStack('s1', 'Stack', [col])])]);

    // 1. Add card
    col.cards.push({ id: 'card2', content: 'added task', checked: false });
    expect(getVisibleCards(col)).toHaveLength(2);

    // 2. Duplicate card1 (visible 0)
    var dupIdx = F.getFullCardIndex(col, 0);
    var clone = JSON.parse(JSON.stringify(col.cards[dupIdx]));
    clone.id = 'card1-dup';
    clone.kid = null;
    col.cards.splice(dupIdx + 1, 0, clone);
    expect(getVisibleCards(col)).toHaveLength(3);

    // 3. Delete card2 (visible 2)
    var delIdx = F.getFullCardIndex(col, 2);
    col.cards[delIdx].content = F.applyInternalHiddenTag(col.cards[delIdx].content, '#hidden-internal-deleted');
    expect(getVisibleCards(col)).toHaveLength(2);

    // 4. Tag toggle on card1-dup (visible 1)
    var tagIdx = F.getFullCardIndex(col, 1);
    var text = col.cards[tagIdx].content;
    var tagName = '#todo';
    var lines = text.split('\n');
    lines[0] = (lines[0] || '') + ' ' + tagName;
    col.cards[tagIdx].content = lines.join('\n');
    expect(F.hasTag(col.cards[tagIdx].content, '#todo')).toBe(true);

    // Final state
    var visible = getVisibleCards(col);
    expect(visible).toHaveLength(2);
    expect(visible[0].id).toBe('card1');
    expect(visible[1].id).toBe('card1-dup');
    expect(F.hasTag(visible[1].content, '#todo')).toBe(true);

    // Simulate save/reload
    var reloaded = JSON.parse(JSON.stringify(board));
    var reloadedCol = reloaded.rows[0].stacks[0].columns[0];
    var reloadedVisible = getVisibleCards(reloadedCol);
    expect(reloadedVisible).toHaveLength(2);
    expect(reloadedVisible[0].id).toBe('card1');
    expect(reloadedVisible[1].id).toBe('card1-dup');
  });
});

describe('HTML comment title helpers', () => {
  it('strips HTML comments from visible title text', () => {
    expect(F.stripHtmlComments('Roadmap <!-- class: lead --> <!-- color: red -->'))
      .toBe('Roadmap');
  });

  it('preserves HTML comments when rebuilding a renamed title', () => {
    expect(F.rebuildTitleWithPreservedComments('Renamed Title', 'Original <!-- class: lead -->'))
      .toBe('Renamed Title <!-- class: lead -->');
  });
});

describe('Marp directive helpers', () => {
  it('sets and reads local and scoped directive values', () => {
    var header = 'Slide Title';
    header = F.setMarpDirectiveInHeaderText(header, 'color', 'red', 'local');
    header = F.setMarpDirectiveInHeaderText(header, 'color', 'blue', 'scoped');

    expect(F.getMarpDirectiveValueFromHeader(header, 'color', 'local')).toBe('red');
    expect(F.getMarpDirectiveValueFromHeader(header, 'color', 'scoped')).toBe('blue');
    expect(F.hasMarpDirectiveValue(header, 'color', 'local', 'red')).toBe(true);
    expect(F.hasMarpDirectiveValue(header, 'color', 'scoped', 'blue')).toBe(true);
  });

  it('clears directives without removing the display title', () => {
    var header = 'Slide Title <!-- paginate: true -->';
    expect(F.clearMarpDirectiveFromHeaderText(header, 'paginate', 'local')).toBe('Slide Title');
  });

  it('consolidates all directives into ONE flow-map comment on the title line', () => {
    var header = '## Card Title\n#todo #p1';
    var next = F.setMarpDirectiveInHeaderText(header, 'color', 'red', 'local');
    next = F.setMarpDirectiveInHeaderText(next, 'header', 'My Header', 'local');
    next = F.toggleMarpClassInHeaderText(next, 'lead', 'local');
    next = F.toggleMarpClassInHeaderText(next, 'invert', 'scoped');
    var lines = next.split('\n');

    // Exactly ONE comment, single line, at the end of the title line.
    expect((next.match(/<!--/g) || []).length).toBe(1);
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe(
      '## Card Title <!-- { color: "red", header: "My Header", class: "lead", _class: "invert" } -->'
    );
    expect(lines[1]).toBe('#todo #p1');

    // Valid Marp: the comment body is a YAML flow-mapping js-yaml can load.
    var body = next.match(/<!--\s*(\{[\s\S]*?\})\s*-->/)[1];
    expect(() => JSON.parse(body
      .replace(/(\w+):/g, '"$1":'))).not.toThrow();

    // All directives still read back, regardless of scope.
    expect(F.getMarpDirectiveValueFromHeader(next, 'color', 'local')).toBe('red');
    expect(F.getMarpDirectiveValueFromHeader(next, 'header', 'local')).toBe('My Header');
    expect(F.getMarpClassListFromHeader(next, 'local')).toEqual(['lead']);
    expect(F.getMarpClassListFromHeader(next, 'scoped')).toEqual(['invert']);

    // Card-title parser invariant: the single-line comment strips cleanly,
    // so the derived heading text is unaffected by the consolidated comment.
    expect(lines[0].replace(/<!--[\s\S]*?-->/g, '').trim()).toBe('## Card Title');
    // Clearing every directive removes the comment entirely (no residue).
    var cleared = next;
    cleared = F.clearMarpDirectiveFromHeaderText(cleared, 'color', 'local');
    cleared = F.clearMarpDirectiveFromHeaderText(cleared, 'header', 'local');
    cleared = F.setMarpClassListInHeader(cleared, [], 'local');
    cleared = F.setMarpClassListInHeader(cleared, [], 'scoped');
    expect(cleared).toBe('## Card Title\n#todo #p1');
  });

  it('migrates legacy separate directive comments into the consolidated one', () => {
    var header = '## Card <!-- color: red --> <!-- _class: lead -->\n#todo';
    // Reads the legacy form for backward compat.
    expect(F.getMarpDirectiveValueFromHeader(header, 'color', 'local')).toBe('red');
    expect(F.getMarpClassListFromHeader(header, 'scoped')).toEqual(['lead']);
    // Any edit migrates ALL managed legacy comments into one flow map.
    var next = F.setMarpDirectiveInHeaderText(header, 'footer', 'Foot', 'local');
    expect((next.match(/<!--/g) || []).length).toBe(1);
    expect(next.split('\n')[0]).toBe(
      '## Card <!-- { color: "red", _class: "lead", footer: "Foot" } -->'
    );
    expect(next.split('\n')[1]).toBe('#todo');
  });

  it('toggles Marp classes in local and scoped class directives', () => {
    var header = 'Slide Title';
    header = F.toggleMarpClassInHeaderText(header, 'lead', 'local');
    header = F.toggleMarpClassInHeaderText(header, 'invert', 'local');
    header = F.toggleMarpClassInHeaderText(header, 'centerpiece', 'scoped');

    expect(F.getMarpClassListFromHeader(header, 'local')).toEqual(['lead', 'invert']);
    expect(F.getMarpClassListFromHeader(header, 'scoped')).toEqual(['centerpiece']);

    header = F.toggleMarpClassInHeaderText(header, 'lead', 'local');
    expect(F.getMarpClassListFromHeader(header, 'local')).toEqual(['invert']);

    header = F.setMarpClassListInHeader(header, [], 'scoped');
    expect(F.getMarpClassListFromHeader(header, 'scoped')).toEqual([]);
  });
});

describe('YAML frontmatter helpers', () => {
  it('creates a valid board YAML header when adding the first Marp key', () => {
    expect(F.updateYamlFrontmatterValue('', 'marp', 'true')).toBe([
      '---',
      'kanban-plugin: board',
      'marp: true',
      '---'
    ].join('\n'));
  });

  it('updates existing Marp keys without removing unrelated YAML lines', () => {
    var nextYaml = F.updateYamlFrontmatterValue([
      '---',
      'kanban-plugin: board',
      'columnWidth: 320px',
      'theme: default',
      '---'
    ].join('\n'), 'theme', 'gaia');

    expect(nextYaml).toBe([
      '---',
      'kanban-plugin: board',
      'columnWidth: 320px',
      'theme: gaia',
      '---'
    ].join('\n'));
  });

  it('removes keys cleanly and parses the remaining Marp frontmatter', () => {
    var nextYaml = F.updateYamlFrontmatterValue([
      '---',
      'kanban-plugin: board',
      'theme: default',
      'title: Demo Deck',
      '---'
    ].join('\n'), 'theme', null);

    expect(nextYaml).toBe([
      '---',
      'kanban-plugin: board',
      'title: Demo Deck',
      '---'
    ].join('\n'));
    expect(F.getYamlFrontmatterValueMap(nextYaml, ['theme', 'title'])).toEqual({
      title: 'Demo Deck'
    });
  });

  it('normalizes class token lists for board-level Marp classes', () => {
    expect(F.getWhitespaceTokenList('lead invert lead')).toEqual(['lead', 'invert']);
    expect(F.setWhitespaceTokenList(['lead', 'invert', 'lead'])).toBe('lead invert');
  });
});

describe('Archive export helpers', () => {
  it('builds the archive filename and path beside the active board file', () => {
    expect(F.buildArchiveFileNameFromBoardPath('/boards/demo.md')).toBe('demo-archive.md');
    expect(F.buildArchiveRelativePathFromBoardPath('/boards/demo.md')).toBe('demo-archive.md');
    expect(F.buildArchiveFilePathFromBoardPath('/boards/demo.md')).toBe('/boards/demo-archive.md');
  });

  it('appends archive markdown after existing YAML frontmatter', () => {
    var next = F.appendArchivedItemsToArchiveContent([
      '---',
      'archived: true',
      '---',
      '',
      '## Existing Section'
    ].join('\n'), '## New Section');

    expect(next).toBe([
      '---',
      'archived: true',
      '---',
      '## Existing Section',
      '',
      '## New Section',
      ''
    ].join('\n'));
  });

  it('formats row, stack, column, and card archive markdown with cleaned titles', () => {
    var archiveMarkdown = F.buildArchiveMarkdownForHiddenItems([
      {
        kind: 'row',
        data: makeRow('row-1', 'Roadmap <!-- hidden --> #hidden-internal-archived', [
          makeStack('stack-1', 'Sprint A #hidden-internal-archived', [
            makeColumn('col-1', 'Todo #row2 #stack #hidden-internal-archived', [
              makeCard('card-1', 'Build archive flow #hidden-internal-archived\nKeep multiline context', { checked: true })
            ])
          ])
        ])
      },
      {
        kind: 'card',
        data: makeCard('card-2', 'Loose archived card', { checked: false })
      }
    ], {
      now: new Date('2026-03-08T12:34:56')
    });

    expect(archiveMarkdown).toContain('# Archived Row: Roadmap #archived !2026.03.08 !12:34:56');
    expect(archiveMarkdown).toContain('## Archived Stack: Sprint A #archived !2026.03.08 !12:34:56');
    expect(archiveMarkdown).toContain('### Archived Column: Todo #archived !2026.03.08 !12:34:56');
    expect(archiveMarkdown).toContain('- [x] Build archive flow #archived !2026.03.08 !12:34:56');
    expect(archiveMarkdown).toContain('    Keep multiline context');
    expect(archiveMarkdown).toContain('## Archived Cards');
    expect(archiveMarkdown).toContain('- [ ] Loose archived card #archived !2026.03.08 !12:34:56');
    expect(archiveMarkdown).not.toContain('#hidden-internal-archived');
    expect(archiveMarkdown).not.toContain('#row2');
    expect(archiveMarkdown).not.toContain('#stack');
    expect(archiveMarkdown).not.toContain('<!-- hidden -->');
  });
});
