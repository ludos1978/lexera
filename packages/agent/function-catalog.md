# Lexera Kanban Frontend Function Catalog

This document catalogs all PUBLIC functions across the major modules of the Lexera Kanban frontend (`packages/lexera-kanban/src/`). Functions are organized by module with their descriptions and cross-module callers.

---

## Module: app.js (LexeraDashboard)
**Path:** `packages/lexera-kanban/src/app.js`
**Type:** Main application module (12,142 lines) — IIFE with 1000+ internal functions
**Public API:** Single exported function

| Function | Description | Callers |
|----------|-------------|---------|
| `poll()` | Main polling loop for board and workspace updates | External (window) |

**Note:** app.js houses the core rendering engine and state management with 1000+ internal functions (stripLayoutTags, renderColumns, updateCardElement, persistBoardMutation, etc.) but exposes only `poll()` as public API. All other functions are called indirectly via dependency injection to modules initialized at startup.

---

## Module: board/orderHelpers.js (LexeraOrderHelpers)
**Path:** `packages/lexera-kanban/src/board/orderHelpers.js`
**Type:** UI state, layout, and search helpers (3,164 lines)
**Public API:** 96 exported functions

| Function | Description | Callers |
|----------|-------------|---------|
| `normalizeBoardLayoutValue(value)` | Normalize board layout string to 'kanban' or other valid modes | app.js (board rendering setup) |
| `normalizeCanvasGridValue(value)` | Normalize canvas grid layout value | app.js (canvas setup) |
| `getCurrentBoardLayout()` | Get active board's current layout mode | app.js, dragDropHandlers |
| `isCanvasBoardLayout()` | Check if board is in canvas mode | app.js, dragDropHandlers, workspace shell |
| `normalizeCanvasStackDirection(value)` | Normalize canvas stack to 'row' or 'column' | app.js (canvas rendering) |
| `stripLayoutTags(title)` | Remove layout tags (#header, #hidden-internal-*) from title | app.js, columnContextMenu |
| `isColumnHeaderTagged(title)` | Check if column has #header tag | app.js (rendering) |
| `extractColumnLayoutTags(title)` | Extract all layout tags from column title | app.js (columnContextMenu init) |
| `getColumnLayoutTags(title)` | Get column layout configuration tags | app.js (rowStackMenu init) |
| `normalizeRatio(value)` | Normalize numeric ratio to valid range | app.js (sidebar resize) |
| `normalizeSidebarSplitRatio(value)` | Validate sidebar split ratio | app.js (sidebar resize) |
| `bindPointerDividerDrag(el, handler)` | Bind pointer drag events to divider element | app.js (sidebar setup) |
| `applySidebarSectionLayout(container, ratio)` | Apply split ratio layout to sidebar sections | app.js (initialization) |
| `setupSidebarSectionResize(container, onChanged)` | Enable sidebar section resizing | app.js (startup) |
| `applySidebarWidth(container, width)` | Apply width style to sidebar container | app.js (startup) |
| `setupSidebarWidthResize(container, onChanged)` | Enable sidebar width resizing | app.js (initialization) |
| `handleTextareaTabIndent(event)` | Handle Tab key in textarea for indentation | cardEditor |
| `closeTransientUiViaHotkey()` | Close search/dialogs on escape key | app.js (hotkey handler) |
| `setHeaderSearchExpanded(expanded)` | Update header search visibility state | app.js (header interaction) |
| `updateHeaderSearchVisibility()` | Sync header search UI with state | app.js (render) |
| `notifyParentPaneActivated()` | Signal parent frame when embedded pane focused | embeddedMenu |
| `setupEmbeddedPaneActivation()` | Initialize parent frame messaging for embedded mode | app.js (startup in embedded) |
| `handleEmbeddedHierarchyFocusMessage(event)` | Process hierarchy focus requests from parent | app.js (message listener) |
| `requestWorkspaceShellViewKind()` | Request workspace shell layout mode change | app.js (action handler) |
| `refreshHeaderFileControls()` | Update file controls in header | app.js (after board load) |
| `setShellActiveBoard(boardId)` | Notify workspace shell of active board | workspaceShell integration |
| `setupWorkspaceShell()` | Initialize workspace shell UI | app.js (conditional startup) |
| `normalizeMarkdownFileName(name)` | Validate/sanitize markdown filename | app.js (file operations) |
| `renameActiveBoardFile(newName)` | Rename current board's markdown file | app.js (file menu) |
| `openActiveBoardFolder()` | Open board folder in file explorer | app.js (file menu) |
| `buildThemeOptionsMarkup()` | Generate theme selector HTML | app.js (settings) |
| `openSettingsDialogForBoard()` | Display board settings dialog | app.js (action) |
| `setupHeaderFileControls()` | Initialize file control buttons | app.js (render) |
| `setupSearchControls()` | Initialize search UI controls | app.js (render) |
| `ensureSidebarTreeDefaultState()` | Initialize sidebar tree with defaults | app.js (first load) |
| `normalizeDashboardScope(scope)` | Validate dashboard filter scope | app.js (dashboard init) |
| `loadDashboardPinnedQueries()` | Load saved pinned search queries | app.js (dashboard startup) |
| `persistDashboardPrefs()` | Save dashboard configuration to storage | app.js (after changes) |
| `setDashboardScope(scope)` | Update dashboard filter scope | app.js (search controls) |
| `setDashboardQuery(query)` | Update dashboard search query | app.js (search input) |
| `filterDashboardResultsByScope(results, scope)` | Filter search results by scope (boards, rows, etc) | app.js (dashboard render) |
| `parseSearchDateValue(str)` | Parse date filter value | app.js (search parsing) |
| `formatLocalDateValue(date)` | Format date for display in search | app.js (dashboard render) |
| `dashboardCalendarBaseDate()` | Get calendar query reference date | app.js (calendar init) |
| `isDashboardCalendarQuery()` | Check if active dashboard is calendar mode | app.js (render conditionals) |
| `filterCalendarTasksForDashboardQuery(tasks, query)` | Filter tasks for calendar display | app.js (calendar render) |
| `sortSearchByDueDateAsc(results)` | Sort search results by due date | app.js (search results) |
| `asCalendarTaskArray(results)` | Convert search results to calendar task format | app.js (calendar setup) |
| `limitedSearchResults(results, limit)` | Truncate search results to limit | app.js (dashboard render) |
| `asSearchResultArray(data)` | Normalize search results format | app.js (search) |
| `scopeHintForDashboard()` | Get hint text for current scope | app.js (UI) |
| `bindMirroredDashboardView(frameEl, frameWindow)` | Link embedded dashboard frame | app.js (embed setup) |
| `syncMirroredDashboardViews()` | Update all mirrored dashboard views | app.js (after mutation) |
| `collectDashboardFileReferences(container)` | Find embedded file links in container | app.js (analyze) |
| `collectDashboardFileReferencesFromContainer(container)` | Scan container for file references | app.js (dashboard render) |
| `collectDashboardFileEmbeds(container)` | Find embedded content in container | app.js (render) |
| `collectDashboardIncludedFiles(container)` | Find included file directives | app.js (analyze) |
| `scanBrokenElements(container)` | Find broken embeds/includes in container | app.js (validation) |
| `scanBrokenElementsFromContainer(container)` | Scan element children for broken content | app.js (error checking) |
| `renderDashboardPinnedList(container)` | Render pinned query buttons | app.js (dashboard init) |
| `setDashboardGroupEmptyState(groupEl, empty)` | Show/hide empty state for search group | app.js (dashboard render) |
| `renderDashboardResultItems(results, container)` | Render search result items | app.js (dashboard) |
| `renderDashboard(container, query, scope)` | Full dashboard render with search results | app.js (main render) |
| `refreshDashboardData()` | Reload dashboard data from board state | app.js (after board change) |
| `scheduleDashboardRefresh()` | Queue dashboard update (debounced) | app.js (mutation handler) |
| `setupDashboardControls()` | Initialize dashboard search UI | app.js (startup) |
| `getCalendarTasks()` | Get tasks for calendar view | app.js (calendar) |
| `renderStandaloneCalendarPanels()` | Render calendar-only view | app.js (layout) |
| `refreshDashboardTagsFromBackend()` | Reload tag list from server | app.js (after sync) |
| `invalidateDashboardRenderCache()` | Clear cached dashboard HTML | app.js (after mutation) |
| `markFileInventoryDirty()` | Flag file list needs refresh | app.js (file change) |

---

## Module: board/boardList.js (LexeraBoardList)
**Path:** `packages/lexera-kanban/src/board/boardList.js`
**Type:** Board/workspace state and sidebar management (1,832 lines)
**Public API:** 35 exported functions

| Function | Description | Callers |
|----------|-------------|---------|
| `init(deps)` | Initialize module with dependencies | app.js (startup) |
| `getSidebarExpandedBoards()` | Get list of expanded board IDs in sidebar | app.js (sidebar render) |
| `saveSidebarExpandedBoards(ids)` | Persist expanded board state | app.js (sidebar interaction) |
| `getSidebarTreeState(boardId)` | Get sidebar tree collapse state for board | app.js (sidebar init) |
| `hasSidebarTreeState(boardId)` | Check if board has saved tree state | app.js (conditional logic) |
| `saveSidebarTreeState(boardId, state)` | Save sidebar tree collapse state | app.js (sidebar change) |
| `getSidebarTreeChildrenContainer(node)` | Find children container DOM element | sidebarTree |
| `getSidebarTreeOwnerNode(container)` | Find parent node DOM element | sidebarTree |
| `toggleSidebarTreeNode(boardId, kind, id)` | Toggle tree node expanded/collapsed | app.js (sidebar click) |
| `setDescendantTreeState(node, kind, ids)` | Set collapse state on child nodes | app.js (sidebar interaction) |
| `buildSidebarTreeNodes(boardData)` | Generate tree structure for sidebar | app.js (render) |
| `countCardsInRow(row)` | Count total cards in row | app.js (stats) |
| `countCardsInStack(stack)` | Count total cards in stack | app.js (stats) |
| `countCardsInRows(rows)` | Sum cards across rows | app.js (board stats) |
| `cloneRows(rows)` | Deep copy row array | app.js (undo/redo) |
| `cloneBoardData(data)` | Deep copy full board data | app.js (snapshot) |
| `boardDraftStorageKey(boardId)` | Get localStorage key for board draft | app.js (draft storage) |
| `getBoardCardKids(cardId)` | Get child cards for parent card | app.js (hierarchy) |
| `getBoardCardIdentityStats(boardData)` | Count unique card identities | app.js (diagnostics) |
| `summarizeBoardIdentity(boardData)` | Generate board identity hash/summary | app.js (cache invalidation) |
| `describeBoardIdentityPair(before, after)` | Describe what changed between versions | app.js (logging) |
| `traceBoardIdentityPair(before, after)` | Log detailed identity changes | app.js (debug) |
| `hasBoardIdentityMismatch(before, after)` | Check if board structure changed | app.js (conflict detection) |
| `saveLocalBoardDraft(boardId, boardData)` | Store draft to localStorage | app.js (auto-save) |
| `loadLocalBoardDraft(boardId)` | Restore draft from localStorage | app.js (recovery) |
| `clearLocalBoardDraft(boardId)` | Delete draft from storage | app.js (after merge) |
| `boardCardSummary(boardData)` | Generate short board summary | app.js (logging) |
| `setBoardSaveBase(boardId, data)` | Store last-saved board state | app.js (after persist) |
| `getBoardSaveBase(boardId)` | Retrieve last-saved board state | app.js (conflict detection) |
| `resolveSavedBoardData(boardId)` | Load board from server | app.js (board fetch) |
| `resolveLiveSyncBoardData(boardId)` | Load board from live sync | pollingService |
| `applyLiveSyncBoardSnapshot(boardId, snapshot)` | Apply live sync changes to board | pollingService (live updates) |
| `applyRebasedBoardSnapshot(boardId, snapshot)` | Apply conflict-resolved board | app.js (rebase) |
| `rebaseDirtyBoardFromServer(boardId)` | Merge local edits with server version | app.js (conflict resolution) |
| `rowsFromLegacyColumns(columns)` | Convert old column format to rows | app.js (migration) |
| `rowsForBoardData(boardData)` | Get rows from board data | app.js (rendering) |
| `setBoardHierarchyRows(boardId, rows)` | Cache board's row structure | app.js (after render) |
| `getBoardHierarchyRows(boardId)` | Get cached row structure | app.js (multiple places) |
| `deleteBoardHierarchyCacheEntry(boardId)` | Clear cached rows for board | app.js (on delete) |
| `refreshBoardHierarchyCache(boardId, rows)` | Update row cache | app.js (after change) |
| `cardPreviewText(card)` | Generate card preview snippet | app.js (hover) |
| `setActiveWorkspaceId(id)` | Update active workspace | app.js (workspace switch) |
| `resolveActiveWorkspaceId()` | Get current workspace ID | app.js (init) |
| `dispatchMirrorMouseEvent(event)` | Forward mouse event to mirrored view | embedMenu |
| `findCanonicalHierarchyTarget(el)` | Find actual element in mirrored view | app.js (embed) |
| `bindMirroredWorkspaceView(frameEl)` | Link workspace frame | app.js (embed setup) |
| `syncMirroredWorkspaceViews()` | Update all workspace mirrors | app.js (after mutation) |
| `renderWorkspaceSelect(container)` | Render workspace switcher dropdown | app.js (header) |
| `getBoardWorkspaceIds(boardId)` | Get workspaces containing board | app.js (workspace logic) |
| `removeBoardFromSidebar(boardId)` | Remove board from sidebar tree | app.js (delete board) |
| `renderBoardList()` | Render full sidebar board list | app.js (main render) |
| `invalidateBoardListFingerprint()` | Clear board list cache | app.js (refresh) |

---

## Module: dragdrop/dragDropHandlers.js (LexeraDragDropHandlers)
**Path:** `packages/lexera-kanban/src/dragdrop/dragDropHandlers.js`
**Type:** Drag-and-drop event handling and geometry (2,044 lines)
**Public API:** 67 exported functions

| Function | Description | Callers |
|----------|-------------|---------|
| `init(deps)` | Initialize module with dependencies | app.js (startup) |
| `getPtrDrag()` | Get current pointer drag state | app.js (virtual scroll) |
| `getCardDrag()` | Get current card drag state | app.js (virtual scroll) |
| `startCardDrag(event)` | Begin card drag operation | dndListeners, app.js |
| `updateCardDropTarget(clientX, clientY)` | Update hover target during card drag | app.js (mousemove) |
| `applyCardDropByPoint(clientX, clientY)` | Execute card drop at position | app.js (mouseup) |
| `finishCardDrag(clientX, clientY)` | Complete card drag with drop | dndListeners (mouseup) |
| `cancelCardDrag()` | Abort card drag without drop | app.js (escape key) |
| `cleanupCardDrag()` | Clean up card drag state | dndListeners (finish) |
| `lockBoardLayoutForDrag()` | Prevent layout shifts during drag | app.js (drag start) |
| `unlockBoardLayoutForDrag()` | Re-enable layout adjustments | app.js (drag end) |
| `cacheDropTargetGeometry()` | Cache drop zone positions | app.js (before drag) |
| `clearDropTargetGeometryCache()` | Clear cached geometry | app.js (after drag) |
| `clearCardDropIndicators()` | Remove visual drop zone markers | app.js (render) |
| `showCardDropIndicator(target, position)` | Display card insert indicator | app.js (drag over) |
| `findCardInsertIndex(target, clientY)` | Get card index for drop position | app.js (drop) |
| `clearHeaderDropTargetHighlights()` | Remove header drag highlights | app.js (drag end) |
| `clearCardDragOverHighlights()` | Remove column drag highlights | app.js (drag end) |
| `clearSidebarDropHighlights()` | Remove sidebar drag highlights | app.js (drag end) |
| `isPointInsideRect(x, y, rect)` | Check if point in rectangle | app.js (hit testing) |
| `findNodeAtPoint(x, y, selector)` | Find DOM element at position | app.js (drag targeting) |
| `removeClassFromNodeList(nodeList, className)` | Remove class from multiple elements | app.js (cleanup) |
| `removeClassesFromNodeList(nodeList, classNames)` | Remove multiple classes | app.js (cleanup) |
| `findStackDropZoneAt(x, y)` | Find drop zone for stack at position | app.js (canvas drop) |
| `findDraggableColumnAt(x, y)` | Find draggable column header at position | app.js (column drag) |
| `findBoardStackAt(x, y)` | Find stack element at position | app.js (targeting) |
| `findColumnCardsContainerAt(x, y)` | Find column's cards container | app.js (drop targeting) |
| `findSidebarColumnAt(x, y)` | Find sidebar column element | app.js (sidebar drag) |
| `resolveCardDropTarget(clientX, clientY)` | Resolve full card drop target | app.js (drop execute) |
| `resolveDropTarget(clientX, clientY)` | Resolve generic drop target | app.js (drag) |
| `resolveDropTargetStrict(clientX, clientY)` | Resolve drop target with strict matching | app.js (canvas) |
| `resolveRowBodyDropTarget(clientX, clientY)` | Resolve drop target in row body | app.js (canvas drop) |
| `resolveCanvasRowContentDropTarget(clientX, clientY)` | Resolve canvas row content drop | app.js (canvas drag) |
| `resolveHeaderDropTag(clientX, clientY)` | Resolve header tag at position | app.js (header drag) |
| `getPtrDragLabel()` | Get label for current PTR drag | app.js (drag indicator) |
| `updatePtrDropTarget(clientX, clientY)` | Update target for PTR drag | app.js (ptr drag) |
| `updatePtrDropTargetByType(dragType, clientX, clientY)` | Update PTR target by drag type | app.js (ptr) |
| `updateColumnPtrDropTarget(clientX, clientY)` | Update column PTR target | app.js (ptr) |
| `clearPtrDropIndicators()` | Remove PTR indicators | app.js (cleanup) |
| `executePtrDrop(clientX, clientY)` | Execute PTR drop operation | app.js (ptr drop) |
| `executeColumnPtrDrop(clientX, clientY)` | Execute column PTR drop | app.js (column ptr) |
| `cleanupPtrDrag()` | Clean up PTR drag state | app.js (after drop) |
| `applyPtrDragHiddenTag(title, tag)` | Apply hidden tag for PTR result | app.js (ptr drop) |
| `applyRowDropByPoint(clientX, clientY)` | Execute row drop at position | app.js (row drop) |
| `applyStackDropByPoint(clientX, clientY)` | Execute stack drop at position | app.js (stack drop) |
| `applyCanvasStackDrop(canvasDropInfo)` | Execute canvas stack drop | app.js (canvas) |
| `getRowDropTarget(clientX, clientY)` | Get row drop target element | app.js (row drag) |
| `getStackDropTarget(clientX, clientY)` | Get stack drop target element | app.js (stack drag) |
| `getTreeColumnDropTarget(boardId, clientX, clientY)` | Get sidebar column drop target | app.js (sidebar) |
| `getTreeStackDropTarget(boardId, clientX, clientY)` | Get sidebar stack drop target | app.js (sidebar) |
| `getTreeCardDropTarget(boardId, clientX, clientY)` | Get sidebar card drop target | app.js (sidebar) |
| `getCanvasDropPositionInRowContent(rowContent, clientX, clientY, grabOffsetX, grabOffsetY)` | Calculate canvas drop position | app.js (canvas drop) |
| `getCanvasRowContentNodeFromDropTarget(target, fallbackNode)` | Extract canvas row content node | app.js (canvas) |
| `clearCanvasDragStyles()` | Clear canvas drag styling | app.js (drag cleanup) |
| `startCrossViewBridge(kind)` | Start cross-frame drag bridge | dndListeners (cross-view drag) |
| `stopCrossViewBridge()` | Stop cross-frame drag | dndListeners (drag end) |
| `toTopFramePoint(x, y)` | Convert point to top frame coords | dndListeners (cross-view) |
| `toLocalFramePoint(x, y)` | Convert point to local frame coords | app.js (embedded) |
| `getDragStartTopPoint()` | Get drag start point in top frame | dndListeners (cross-view) |
| `hasCrossViewDragMovedBeyondThreshold()` | Check if cross-view drag exceeds threshold | dndListeners (validation) |
| `getCrossViewDragPayload()` | Get data from cross-frame drag | dndListeners (drop) |
| `registerExternalDndBridge(handlers)` | Register external DnD handlers | app.js (plugin init) |
| `ptrFindHitNode(mx, my)` | Find hit node for PTR | app.js (ptr) |
| `ptrFindStrictHitNode(mx, my)` | Find strict hit node for PTR | app.js (ptr) |
| `ptrFindDropTarget(mx, my)` | Find drop target for PTR | app.js (ptr) |
| `buildSidebarCardTarget(card, column, boardId)` | Build sidebar card drop target | app.js (sidebar) |
| `getFirstSidebarCardTargetForBoard(boardId)` | Get first card target in sidebar | app.js (sidebar) |
| `getVisibleCardCountInColumn(column, boardId)` | Count visible cards in column | app.js (sidebar) |
| `getSourceRowIndex()` | Get source row index in drag | app.js (drag) |

---

## Module: workspace/workspaceShell.js (LexeraWorkspaceShell)
**Path:** `packages/lexera-kanban/src/workspace/workspaceShell.js`
**Type:** Multi-pane workspace UI layout manager (4,453 lines)
**Public API:** 17 exported functions

| Function | Description | Callers |
|----------|-------------|---------|
| `isEnabled()` | Check if workspace shell is active | app.js (conditional) |
| `mount(mainContent)` | Initialize workspace shell DOM | app.js (startup) |
| `render()` | Render workspace shell layout | app.js (after change) |
| `onBoardsUpdated(boardList)` | Update shell when board list changes | app.js (board fetch) |
| `openBoard(boardId)` | Open board in workspace | app.js (selection) |
| `ensureInitialTab(boardId)` | Initialize first board tab | app.js (startup) |
| `focusHierarchyTarget(el)` | Focus element in hierarchy | app.js (selection) |
| `handleBoardAction(action)` | Process board-related actions | app.js (action dispatch) |
| `revealPanel(panelId)` | Show/activate panel | app.js (menu) |
| `setPanelVisibility(panelId, visible, opts)` | Control panel visibility | app.js (action) |
| `movePanelToDock(panelId, dockId)` | Move panel to dock area | app.js (layout) |
| `movePanelToGroup(panelId, groupId)` | Move panel to group | app.js (layout) |
| `openPanelInCenter(panelId)` | Open panel in center area | app.js (action) |
| `duplicatePanel(panelId)` | Create copy of panel | app.js (menu) |
| `closePanelView(panelId)` | Close panel | app.js (action) |
| `isPanelVisible(panelId)` | Check panel visibility state | app.js (conditional) |
| `didRestoreState()` | Check if layout was restored | app.js (after mount) |
| `collapsePanel(panelId)` | Collapse panel | app.js (interaction) |
| `restoreDock(dockId)` | Restore dock layout | app.js (state) |
| `collapseDock(dockId)` | Collapse dock area | app.js (interaction) |
| `getActiveBoardColumnsContainer()` | Get board's column container | app.js (render) |

---

## Module: menu/embedMenu.js (LexeraEmbedMenu)
**Path:** `packages/lexera-kanban/src/menu/embedMenu.js`
**Type:** Embed/include/link mutation and content management (4,428 lines)
**Public API:** 41 exported functions

| Function | Description | Callers |
|----------|-------------|---------|
| `closeEmbedMenu()` | Close active embed popup menu | app.js (escape key) |
| `showEmbedMenu(cardEl, embedEl)` | Show embed context menu | app.js (right-click) |
| `showIncludeMenu(cardEl, includeEl)` | Show include directive menu | app.js (right-click) |
| `showBoardFileLinkMenu(cardEl, linkEl)` | Show board file link menu | app.js (right-click) |
| `showDiagramMenu(cardEl, diagramEl)` | Show diagram menu | app.js (right-click) |
| `showWikiMenu(cardEl, wikiEl)` | Show wiki link menu | app.js (right-click) |
| `handleEmbedAction(action, embedEl)` | Process embed menu action | app.js (menu select) |
| `handleIncludeAction(action, includeEl)` | Process include menu action | app.js (menu select) |
| `handleBoardFileLinkAction(action, linkEl)` | Process board link menu action | app.js (menu select) |
| `handleDiagramAction(action, diagramEl)` | Process diagram menu action | app.js (menu select) |
| `handleWikiAction(action, wikiEl)` | Process wiki menu action | app.js (menu select) |
| `mutateEmbedSource(sourceCardId, embedIndex, mutation)` | Modify source file embed | app.js (persist) |
| `updateEmbedTarget(embed, newPath)` | Change embed target path | app.js (edit) |
| `deleteEmbedFromSource(sourceCardId, embedIndex)` | Remove embed from source | app.js (delete) |
| `updateIncludeTarget(include, newPath)` | Change include target path | app.js (edit) |
| `deleteIncludeFromSource(sourceCardId, includeIndex)` | Remove include from source | app.js (delete) |
| `updateBoardFileLinkTarget(link, newPath)` | Change board link target | app.js (edit) |
| `replaceNthMarkdownEmbed(content, n, newTarget)` | Replace embed by index | app.js (mutation) |
| `replaceNthMarkdownLink(content, n, newTarget)` | Replace link by index | app.js (mutation) |
| `normalizeCardContentAfterInlineMutation(content)` | Clean up content after edit | app.js (cleanup) |
| `resolveMarkdownRelativeTargets(content, baseDir)` | Resolve relative paths in content | app.js (render) |
| `getIncludeResolvedContent(includePath, baseDir)` | Load included file content | app.js (render) |
| `adjustPathForIncludeContext(path, baseDir)` | Adjust path for inclusion | app.js (resolve) |
| `findCardRefById(cardId)` | Find card by ID in content | app.js (search) |
| `mutateBoardTitleSource(boardId, newTitle)` | Update board title source | app.js (rename) |
| `isExternalEmbedContainer(el)` | Check if element is external embed | app.js (rendering) |
| `isIncludeDirectiveContainer(el)` | Check if element is include | app.js (rendering) |
| `getEmbedActionTarget(embedEl)` | Get target path from embed | app.js (menu) |
| `getEmbedSearchQuery(embedEl)` | Get search query from embed | app.js (search) |
| `promptForEmbedTarget()` | Show embed target dialog | app.js (new embed) |
| `applyAutomaticPathFix(paths)` | Auto-fix multiple paths | app.js (batch) |
| `formatFileSize(bytes)` | Format byte size for display | app.js (UI) |
| `showPathFixResults(results)` | Display path fix results | app.js (after batch) |
| `openEmbedWebSearch(query)` | Open web search for embed | app.js (action) |
| `pasteClipboardImageIntoEmbed(embedEl)` | Paste image into embed | app.js (paste) |
| `uploadFileAndBuildMarkdown(file, baseDir)` | Upload file and create markdown | app.js (drop) |
| `resolveDropContent(files, baseDir)` | Process dropped files | app.js (ondrop) |
| `handleEditorPasteImage(imageData, editor)` | Handle image paste in editor | cardEditor (paste) |
| `handleFileDrop(files, dropTarget)` | Process file drop | app.js (ondrop) |
| `copyTextToClipboard(text, successMsg, failMsg)` | Copy text to clipboard | app.js (copy) |
| `copyElementAsMarkdown(scope, context)` | Copy element as markdown | app.js (action) |
| `exportColumn(colIndex)` | Export column to markdown | app.js (action) |
| `buildExportSelectionForColumn(colIndex)` | Build export metadata for column | app.js (export) |
| `openExternalEmbedInPlace(embedEl)` | Expand external embed inline | app.js (interaction) |
| `requestExternalEmbedPolicy()` | Request external embed policy | app.js (security) |
| `buildExternalEmbedFrameHtml(url, policy)` | Generate iframe HTML for external embed | app.js (render) |
| `renderExternalEmbedPrompt(error)` | Show permission prompt for external embed | app.js (UI) |

---

## Module: editor/cardEditor.js (CardEditor)
**Path:** `packages/lexera-kanban/src/editor/cardEditor.js`
**Type:** Card content editor overlay UI (1,205 lines)
**Public API:** 32 exported functions

| Function | Description | Callers |
|----------|-------------|---------|
| `init(deps)` | Initialize editor module | app.js (startup) |
| `getCurrentCardEditor()` | Get active card editor instance | app.js (virtual scroll) |
| `getCurrentEditorBoardId()` | Get board ID of active editor | app.js (editor state) |
| `getCurrentEditorFilePath()` | Get file path of active editor | app.js (resource resolve) |
| `safeDecodePath(path)` | Safely decode file path | app.js (path processing) |
| `isWindowsAbsolutePath(path)` | Check if Windows absolute path | app.js (path detection) |
| `normalizeWindowsAbsolutePath(path)` | Normalize Windows path | app.js (path handling) |
| `isRelativeResourcePath(path)` | Check if relative resource path | app.js (resolution) |
| `resolveRelativePath(path, baseDir)` | Resolve relative to base | app.js (resource) |
| `buildWebviewResourceUrl(path)` | Build webview resource URL | app.js (embed) |
| `resolveCurrentEditorResourcePath(path)` | Resolve path in editor context | app.js (embed) |
| `syncCardEditorWysiwygContext(editor, boardId)` | Sync WYSIWYG with markdown | app.js (editor init) |
| `setCurrentCardEditorMarkdown(markdown)` | Update editor markdown | app.js (programmatic edit) |
| `updateCardEditorWysiwygToolbar()` | Refresh WYSIWYG toolbar | app.js (state change) |
| `applyCardEditorFontScale(scale)` | Apply font size scale | app.js (settings) |
| `openCardEditorFontScaleMenu()` | Show font scale picker | app.js (menu) |
| `openFileSearchDialog()` | Show file picker dialog | app.js (embed dialog) |
| `insertAtCursor(text)` | Insert text at cursor | app.js (programmatic) |
| `syncCardEditorTextareaFromWysiwyg()` | Update markdown from WYSIWYG | app.js (dual mode) |
| `destroyCardEditorWysiwyg()` | Destroy WYSIWYG editor | app.js (close) |
| `ensureCardEditorWysiwyg()` | Initialize WYSIWYG editor | app.js (switch mode) |
| `applyCardEditorFormatting(format)` | Apply text formatting | app.js (toolbar) |
| `getEmbedOccurrenceRoot(embedEl)` | Find embed occurrence root | app.js (embed analysis) |
| `getRenderedEmbedAbsoluteIndex(embedEl)` | Get embed absolute index | app.js (mutation) |
| `replaceCurrentEmbedOccurrence(newTarget)` | Replace current embed | app.js (edit embed) |
| `replaceNthIncludeDirective(n, newTarget)` | Replace include by index | app.js (edit include) |
| `normalizeCardEditorMode(mode)` | Validate editor mode | app.js (settings) |
| `normalizeCardEditorFontScale(scale)` | Validate font scale | app.js (settings) |
| `getCardEditorFormatSpec()` | Get format toolbar config | app.js (toolbar) |
| `buildCardEditorSnippetSelectHtml()` | Build snippet dropdown HTML | app.js (toolbar) |
| `updateCheckboxLineInText(text, lineNum, checked)` | Toggle checkbox in text | app.js (checkbox) |
| `renderCardDisplayState(cardEl, content)` | Render card content display | app.js (render) |
| `findVisibleCardElement(colIndex, cardIndex)` | Find card DOM element | app.js (locate) |
| `openCardEditor(cardEl, colIndex, cardIndex, mode)` | Open editor for card | app.js (double-click) |
| `applyCardEditorMode(mode)` | Switch editor mode | app.js (mode change) |
| `enterCardEditMode(cardEl, colIndex, cardIndex, mode)` | Enter card edit state | app.js (edit) |
| `closeCardEditorOverlay()` | Close editor popup | app.js (esc/blur) |
| `insertFormatting(textarea, fmt)` | Insert formatting around selection | app.js (toolbar) |
| `saveCardEdit(cardEl, colIndex, fullCardIdx, newContent)` | Save card edit and persist | app.js (blur) |

---

## Module: core/moduleRuntime.js (LexeraRuntime)
**Path:** `packages/lexera-kanban/src/core/moduleRuntime.js`
**Type:** Shared module infrastructure and state management (217 lines)
**Public API:** 14 exported functions

| Function | Description | Callers |
|----------|-------------|---------|
| `defineState(key, initialValue)` | Define a reactive state key | app.js (startup) |
| `getState(key)` | Read state value | All modules (state access) |
| `setState(key, value)` | Update state and notify listeners | All modules (state mutation) |
| `onStateChange(key, fn)` | Subscribe to state changes | All modules (watchers) |
| `on(event, fn)` | Subscribe to event | All modules (event bus) |
| `emit(event, data)` | Emit event to listeners | All modules (event dispatch) |
| `mergeDeps(target, source)` | Merge dependencies preserving getters | All modules (init) |
| `registerModule(name, mod)` | Register module by name | app.js (discovery) |
| `getModule(name)` | Get registered module | All modules (lookup) |
| `discoverModules()` | Auto-discover known modules | app.js (startup) |
| `getStartupReport()` | Get module load status | app.js (diagnostics) |
| `setViewLoading(container, loading)` | Set view loading state | app.js (UI state) |
| `setViewEmpty(container, empty, message)` | Set view empty state | app.js (UI state) |
| `setViewError(container, error, message)` | Set view error state | app.js (UI state) |
| `setViewConnected(container, connected)` | Set connection state | app.js (UI state) |

---

## Module: core/settingsStore.js (LexeraSettings)
**Path:** `packages/lexera-kanban/src/core/settingsStore.js`
**Type:** localStorage-backed configuration store (276 lines)
**Public API:** 12 exported functions

| Function | Description | Callers |
|----------|-------------|---------|
| `get(name)` | Get global setting value | All modules (config access) |
| `set(name, value)` | Set global setting value | All modules (config change) |
| `getForBoard(name, boardId)` | Get per-board setting | app.js (board config) |
| `setForBoard(name, boardId, value)` | Set per-board setting | app.js (board config save) |
| `removeForBoard(name, boardId)` | Delete per-board setting | app.js (cleanup) |
| `getScoped(name, scope)` | Get scoped setting | app.js (scope config) |
| `setScoped(name, scope, value)` | Set scoped setting | app.js (scope config save) |
| `on(name, fn)` | Subscribe to setting changes | All modules (watchers) |
| `keyOf(name)` | Get storage key for setting | app.js (migration) |
| `allKeys()` | List all defined settings | app.js (diagnostics) |
| `defOf(name)` | Get setting definition | app.js (introspection) |
| `DEFS` | All global setting definitions | app.js (reference) |
| `BOARD_DEFS` | All per-board setting definitions | app.js (reference) |
| `SCOPED_DEFS` | All scoped setting definitions | app.js (reference) |

---

## Module: sync/pollingService.js (LexeraPollingService)
**Path:** `packages/lexera-kanban/src/sync/pollingService.js`
**Type:** Board/workspace polling and sync coordination (375 lines)
**Public API:** 4 exported functions

| Function | Description | Callers |
|----------|-------------|---------|
| `init(deps)` | Initialize polling service | app.js (startup) |
| `poll()` | Execute single poll cycle | app.js (timer) |
| `setConnected(state)` | Update backend connection status | app.js (connection) |
| `syncConnectionStatusButton(buttonEl, dotEl, state)` | Update connection indicator UI | app.js (render) |
| `resetFingerprints()` | Clear sync state cache | app.js (refresh) |

---

## Module: render/cardContentRenderer.js (LexeraCardContentRenderer)
**Path:** `packages/lexera-kanban/src/render/cardContentRenderer.js`
**Type:** Markdown to HTML rendering with inline syntax (402 lines)
**Public API:** 5 exported functions

| Function | Description | Callers |
|----------|-------------|---------|
| `init(deps)` | Initialize renderer module | app.js (startup) |
| `renderCardContent(markdown, boardId, options)` | Render full card markdown to HTML | app.js (card display) |
| `renderTable(markdown, options)` | Render markdown table to HTML | app.js (table rendering) |
| `renderInline(markdown, boardId, options)` | Render inline markdown | app.js (inline content) |
| `renderTitleInline(markdown, boardId, options)` | Render title markdown | app.js (title display) |
| `decorateSpecialChars(html)` | Add special character markers | app.js (special chars mode) |

---

## Analysis & Insights

### High-Usage Modules (Called by Many Other Modules)
1. **app.js** - Central hub, calls into all major modules
2. **moduleRuntime** - Infrastructure used by all modules for state/events
3. **settingsStore** - Config access from all modules
4. **orderHelpers** - Layout and UI state (96 functions, high entropy)
5. **boardList** - Board/workspace state management (35 functions)

### Low-Usage Modules (Few Callers)
1. **cardContentRenderer** - Only called by app.js for rendering
2. **pollingService** - Only called by app.js for polling
3. **cardEditor** - Called by app.js, dndListeners, embedMenu
4. **workspaceShell** - Called by app.js when enabled

### Functions Exported But Potentially Unused
- Many dashboard functions in orderHelpers (renderDashboard, filterDashboardResultsByScope, etc.) may be unused if dashboard feature is disabled
- Canvas-specific functions in dragDropHandlers only used if canvas mode is enabled
- Workspace shell functions only if embedded mode is active

### Candidates for Module Extraction
1. **Dashboard functions** in orderHelpers could move to dedicated `dashboard.js` module (~1000 lines)
2. **Canvas functions** in dragDropHandlers could move to `dragdrop/canvasDrop.js` (~400 lines)
3. **Sidebar functions** in boardList could move to `sidebar/sidebarState.js` (~500 lines)
4. **Embed/menu functions** in embedMenu could split to:
   - `embed/embedMutations.js` - Mutation logic
   - `embed/embedUI.js` - Menu/UI rendering

### Known Duplication
- `stripLayoutTags()` implemented in both orderHelpers and LexeraTagSystem
- `renderTitleInline()` wrapped in cardContentRenderer but called from multiple places
- HTML/special-chars handling scattered across app.js and cardContentRenderer

---

**Generated:** 2026-03-31
**Total Modules Analyzed:** 10
**Total Public Functions:** 278
**Total Internal Functions (app.js only):** 1000+
