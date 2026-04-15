# Board Renderer Specification

**Status**: ✅ Baseline  
**V2 Target**: `lexera-kanban`  
**V1 Reference**: `src/html/boardRenderer.js` (~3,935 lines)  
**Dependencies**: [Markdown Renderer](../shared/markdown/SPEC.md), [Drag/Drop](../ux/dragdrop/SPEC.md), [Editor](../core/editor/SPEC.md)

---

## UX Requirements

### Board Display

- Rows flow vertically within Boards
- Stacks flow horizontally within Rows
- Columns flow vertically within Stacks
- Cards flow vertically within Columns

### Pin

- Headers of Columns can be made Sticky, so only the title is sticky to the bottom or top of the view! This is toggled at the top row.

### Folding State
- User can collapse/expand Rows, Stacks, Columns and Cards (click column header)
- State persists across re-renders (stored in `window.collapsedColumns`, `window.collapsedTasks`)

### View Navigation & Controls Settings

User-configurable input bindings for board interaction. Each view mode (kanban, canvas) has its own set of bindings. Each action can have zero or more bindings. Settings are persisted per-user via localStorage.

#### Actions

| Action | Description |
|--------|-------------|
| **Move view** | Pan/scroll the board viewport |
| **Zoom view** | Zoom in/out on the board |
| **Edit field** | Enter edit mode on the focused element |

#### Binding Types

| Type | Format | Example |
|------|--------|---------|
| `scroll` | Scroll wheel/touchpad, optional modifier | `scroll`, `alt+scroll` |
| `drag` | Mouse button drag, optional modifier | `right-drag`, `alt+left-drag` |
| `dblclick` | Double-click | `dblclick` |
| `key` | Keyboard key, optional modifiers | `Enter`, `F2`, `ctrl+e` |

#### Default Bindings

**Kanban Mode:**
- Move view: `scroll`, `right-drag`, `alt+left-drag`
- Zoom view: `alt+scroll`
- Edit field: `dblclick`, `Enter`

**Canvas Mode:**
- Move view: `right-drag`, `alt+left-drag`
- Zoom view: `scroll`
- Edit field: `dblclick`, `Enter`

#### Data Model (persisted as JSON in localStorage)

```json
{
  "kanban": {
    "move":  [{ "type": "scroll" }, { "type": "drag", "button": 2 }, { "type": "drag", "button": 0, "alt": true }],
    "zoom":  [{ "type": "scroll", "alt": true }],
    "edit":  [{ "type": "dblclick" }, { "type": "key", "key": "Enter" }]
  },
  "canvas": {
    "move":  [{ "type": "drag", "button": 2 }, { "type": "drag", "button": 0, "alt": true }],
    "zoom":  [{ "type": "scroll" }],
    "edit":  [{ "type": "dblclick" }, { "type": "key", "key": "Enter" }]
  }
}
```

#### Controls Settings UI

Located in the Frontend Settings panel under a "Controls" section. Shows kanban and canvas groups side by side. Each binding is a removable chip. A [+] button records a new binding (user presses key, scrolls, or clicks to capture).

#### Constraints
- Ctrl/Cmd+scroll is reserved for browser zoom — never intercept it
- Bindings that conflict show a warning but are allowed (user's choice)
- Reset to Defaults button restores the default bindings above

### Scroll Position
- User scrolls board horizontally/vertically
- Scroll position preserved during updates
- Per-board scroll positions stored in `scrollPositions` Map

### Incremental Updates
- When card changes, only that card re-renders (not full board)
- When column changes, only that column re-renders
- Active editor preserved during updates (not blurred)

### Hidden Items
- Cards with `#hidden-internal-parked` are hidden
- Cards with `#hidden-internal-deleted` are hidden
- Cards with `#hidden-internal-archived` are hidden

---

## Rendering Architecture (v2)

### UI Mutation Entry Point: `persistBoardMutation(options)`

User-driven board edits still enter through `persistBoardMutation()` in `app.js`.
It handles:

1. Display state sync (`updateDisplayFromFullBoard`)
2. Targeted DOM rendering via `refreshTargetedElements(targets)`
3. Board hierarchy sync via `commitLocalBoardChange()` / `refreshBoardHierarchyProjection()`
4. Dashboard refresh scheduling
5. Local draft persistence
6. Auto-save scheduling
7. Live sync coordination

### Embedded Hierarchy Contract: `commitLocalBoardChange(boardId, fullBoard, options)`

Inside an embedded board iframe, any change to `fullBoardData` MUST flow through
`commitLocalBoardChange()`. There is no other supported mutation-to-hierarchy path.

`commitLocalBoardChange()` is responsible for:

1. Updating local `fullBoardData` / `activeBoardData` state when needed
2. Refreshing the board hierarchy projection in non-embedded mode via `refreshBoardHierarchyProjection()`
3. Posting `lexera-board-mutated` with the current `fullBoard` payload to the parent shell in embedded mode

This contract is enforced in these places:

- Writer functions in `app.js`: `persistBoardMutation()`, `applyPollingBoardDelta()`, `commitBoardMutations()`
- Writer functions in `boardList.js`: `applyLiveSyncBoardSnapshot()`, `applyRebasedBoardSnapshot()`
- Parent message bridge in `workspaceShell.js`: `lexera-board-mutated` consumes `data.fullBoard` and forwards it to `refreshBoardHierarchy(...)`
- Hierarchy cache setter in `boardList.js`: `refreshBoardHierarchyProjection()` is the only public projection API; embedded mode skips cache writes/rendering and relies on the parent bridge instead

### Parent-Owned Workspace Catalog

In workspace-shell mode, embedded board iframes do not own `boards[]` or
`workspaces[]`. The parent window is the source of truth and pushes
`lexera-workspace-catalog` snapshots into frames.

This contract is enforced in these places:

- Parent state fan-out in `app.js`: `setBoardsState()`, `setRemoteBoardsState()`, `setWorkspacesState()` call `WorkspaceShell.onCatalogUpdated(...)`
- Parent frame bridge in `workspaceShell.js`: stores the latest catalog snapshot, broadcasts it to loaded frames, and re-sends it when a pane emits `lexera-pane-activated`
- Embedded frame consumer in `orderHelpers.js`: `handleEmbeddedHierarchyFocusMessage()` applies `boards`, `remoteBoards`, and `workspaces` from `lexera-workspace-catalog`
- Embedded polling in `pollingService.js`: `embeddedMode` skips `/config/workspaces`, `/boards`, and `/remoteBoards`

### Target Types

Callers describe WHAT changed via a `targets` array. The system decides HOW to render:

```javascript
persistBoardMutation({
  targets: [
    { type: 'card', colIndex: 3, cardIndex: 5 },       // replace one card
    { type: 'card-insert', colIndex: 3, cardIndex: 0 }, // insert new card
    { type: 'card-remove', colIndex: 3, cardIndex: 2 }, // remove card element
    { type: 'card-content', colIndex: 3, cardIndex: 5 },// re-render card content only
    { type: 'column', colIndex: 7 },                    // replace one column
    { type: 'stack', rowIndex: 0, stackIndex: 1 },      // replace one stack
    { type: 'row', rowIndex: 0 },                       // replace one row
    { type: 'sidebar' },                                // refresh board list
    { type: 'board' },                                  // full column re-render
    { type: 'main-view' },                              // full main view
  ]
});
// Empty targets array = persist only, no DOM changes
```

Targets coalesce automatically: if both a card and its parent row are listed,
only the row is rebuilt.

### Build Functions (one per entity)

Each entity type has a standalone build function that creates a complete DOM
element with all event listeners attached:

| Function | File | Returns |
|----------|------|---------|
| `buildCardElement(card, colIndex, visibleCardIndex, collapsedCards)` | app.js | `<div class="card">` |
| `buildColumnElement(col, foldedCols, collapsedCards, rowIdx, stackIdx, colLocalIdx, colFullIdx)` | app.js | `<div class="column">` |
| `buildStackElement(stack, rowIdx, stackIdx, foldedCols, foldedStacks, collapsedCards)` | app.js | `<div class="board-stack">` |
| `buildRowElement(row, rowIdx, foldedCols, foldedRows, foldedStacks, collapsedCards)` | app.js | `<div class="board-row">` |

### Post-Render Enhancement Pipeline

After any DOM is built or replaced, `enhanceRenderedElement(el, opts)` runs the
complete enhancement sequence. This is the SINGLE SOURCE OF TRUTH:

1. `enhanceEmbeddedContent(el)` -- diagrams, media, content plugins
2. `applyRenderedHtmlCommentVisibility(el, mode)` -- HTML comment toggle
3. `applyRenderedTagVisibility(el, mode)` -- tag visibility mode
4. `attachRenderedTagInteractions(el)` -- tag click handlers
5. `flushPendingDiagramQueues()` -- pending diagram renders
6. `LexeraContentEnhancerRegistry.enhance(el)` -- content enhancer plugins
7. Virtual scroll: `vsActivate()` (structural) or `vsRemeasureColumn(colIndex)` (card-level)

For embed/include previews (not in main board DOM), `enhancePreviewElement(el)`
in embedMenu.js runs the subset: steps 1-5 above (no virtual scroll or tag
interactions, since previews are in overlay panels).

### RULES

- **NEVER** duplicate the enhancement sequence. Always call `enhanceRenderedElement`
  or `enhancePreviewElement`.
- **NEVER** set `.innerHTML` on board elements then call `persistBoardMutation({ skipRender: true })`.
  Instead pass the appropriate `targets` array.
- **NEVER** call `renderColumns()` or `renderMainView()` directly from mutation handlers.
  Use `persistBoardMutation({ targets: [{ type: 'board' }] })`.
- Direct `renderColumns()`/`renderMainView()` calls are ONLY for non-mutation entry
  points: board load, polling delta, search mode exit.

### Legacy Options (deprecated, backward compat only)

The old `skipRender`, `refreshMainView`, `refreshSidebar` options still work but
should be migrated to `targets`. When `targets` is present, the old options are ignored.

### Data Flow

```
Caller mutates board data
       |
       v
persistBoardMutation({ targets: [...] })
       |
       +-- updateDisplayFromFullBoard()
       +-- commitLocalBoardChange(boardId, fullBoardData, ...)
       +-- refreshTargetedElements(targets)
       |      |
       |      +-- coalesce targets
       |      +-- for each target:
       |      |     build*Element() --> replace in DOM
       |      |     enhanceRenderedElement(newEl)
       |      +-- renderBoardList() (if sidebar target)
       |      +-- syncRenderedRowWidths() (if structural)
       |
       +-- refreshBoardHierarchyProjection() (non-embedded)
       |      or
       +-- postMessage('lexera-board-mutated', { fullBoard }) (embedded)
       |
       +-- scheduleDashboardRefresh()
       +-- markBoardDirty()
       +-- saveLocalBoardDraft()
       +-- scheduleAutoSave()
       +-- liveSync coordination
```

---

## Global State

```javascript
// Folding state (persists across renders)
window.collapsedColumns = new Set();     // Column IDs that are collapsed
window.collapsedTasks = new Set();       // Card IDs that are collapsed
window.columnFoldStates = new Map();     // Last manual fold state per column
window.globalColumnFoldState = 'fold-mixed'; // Global fold state

// Template bar state
window.availableTemplates = [];
window.showTemplateBar = true;

// Scroll positions per board
let scrollPositions = new Map();         // boardId → { x, y }

// Render debouncing
let renderTimeout = null;

// Hidden tags (filter these from display)
const PARKED_TAG = '#hidden-internal-parked';
const DELETED_TAG = '#hidden-internal-deleted';
const ARCHIVED_TAG = '#hidden-internal-archived';
```

---

## Functions

### Main Render Functions

```javascript
// Full board render
function renderBoard(board, options = {})

// Single column render (incremental)
function renderSingleColumn(column, columnIndex)

// Single card render (incremental)
function renderCard(card, columnId, columnIndex)

// Card initialization (adds all handlers)
function initializeCardElement(cardElement)
```

### State Preservation

```javascript
// Blur protection (prevents VS Code webview errors)
function blurActiveElementIfContained(container)

// Check if element contains active editor
function containsInlineEditor(element)

// Save/restore scroll position
function saveScrollPosition(boardId)
function restoreScrollPosition(boardId)
```

### Incremental Updates

```javascript
// Add single card to DOM (without full re-render)
function addSingleTaskToDOM(columnId, card, cardIndex)

// Update single card in DOM
function updateSingleTaskInDOM(cardId, newContent)

// Move card in DOM (drag & drop)
function moveCardInDOM(cardId, fromColumnId, toColumnId, newIndex)

// Remove card from DOM
function removeCardFromDOM(cardId)
```

### Helpers

```javascript
// Insert HTML nodes relative to element
function insertHtmlNodes(htmlString, referenceElement, position)

// Check if card should be hidden
function isHiddenTask(card)

// Get column element by ID
function getColumnElement(columnId)

// Get card element by ID
function getCardElement(cardId)
```

---

## DOM Structure

### Board Container

```html
<div id="board-container" class="board-container" data-board-id="board-123">
  <!-- Columns rendered here -->
</div>
```

### Column Element

```html
<div class="column" 
     data-column-id="col-1" 
     data-column-index="0"
     style="width: 300px;">
     
  <!-- Column Header -->
  <div class="column-header">
    <div class="column-title">
      <span class="collapse-icon">▼</span>
      <span class="title-text">To Do</span>
      <span class="card-count">3</span>
    </div>
    <div class="column-menu">
      <!-- Menu buttons -->
    </div>
  </div>
  
  <!-- Column Content (cards) -->
  <div class="column-content">
    <!-- Cards rendered here -->
  </div>
  
  <!-- Add Card Button -->
  <div class="add-card-area">
    <button class="add-card-btn">+ Add Card</button>
  </div>
</div>
```

### Card Element

```html
<div class="card" 
     data-task-id="card-1" 
     data-column-id="col-1"
     data-checked="false">
     
  <!-- Checkbox -->
  <div class="card-checkbox">
    <input type="checkbox" />
  </div>
  
  <!-- Card Content -->
  <div class="card-content">
    <div class="card-title">Card title #tag @date</div>
    <div class="card-description">
      <!-- Markdown rendered content -->
    </div>
  </div>
  
  <!-- Card Actions -->
  <div class="card-actions">
    <button class="edit-btn">✏️</button>
    <button class="delete-btn">🗑️</button>
  </div>
</div>
```

---

## Event Handlers

### Card Events (added by `initializeCardElement`)

| Event | Handler | Action |
|-------|---------|--------|
| `click` | onCardClick | Start inline edit or toggle checkbox |
| `dblclick` | onCardDoubleClick | Open overlay editor |
| `dragstart` | onDragStart | Begin drag operation |
| `dragend` | onDragEnd | End drag operation |
| `mouseenter` | onCardHover | Show action buttons |
| `mouseleave` | onCardLeave | Hide action buttons |

### Column Events

| Event | Handler | Action |
|-------|---------|--------|
| `click .column-title` | onColumnTitleClick | Toggle collapse |
| `dragover` | onColumnDragOver | Allow drop |
| `drop` | onColumnDrop | Handle card drop |

---

## Incremental Update Logic

### Why Incremental?

Full re-render destroys DOM state:
- Active editors lose focus
- Scroll position resets
- Folding state lost
- Drag state corrupted

### Incremental Approach

```javascript
// Instead of:
renderBoard(board); // Full re-render

// Use:
updateSingleTaskInDOM(cardId, newContent); // Only update changed card
```

### When to Use Each

| Scenario | Function |
|----------|----------|
| Card content changed | `updateSingleTaskInDOM()` |
| Card added | `addSingleTaskToDOM()` |
| Card moved | `moveCardInDOM()` |
| Card deleted | `removeCardFromDOM()` |
| Column changed | `renderSingleColumn()` |
| Multiple changes | `renderBoard()` (debounced) |

---

## Folding State Management

### Collapse Column

```javascript
function toggleColumnCollapse(columnId) {
  const column = getColumnElement(columnId);
  const isCollapsed = window.collapsedColumns.has(columnId);
  
  if (isCollapsed) {
    window.collapsedColumns.delete(columnId);
    column.classList.remove('collapsed');
  } else {
    window.collapsedColumns.add(columnId);
    column.classList.add('collapsed');
  }
  
  window.columnFoldStates.set(columnId, !isCollapsed);
}
```

### Collapse Card

```javascript
function toggleCardCollapse(cardId) {
  const card = getCardElement(cardId);
  const isCollapsed = window.collapsedTasks.has(cardId);
  
  if (isCollapsed) {
    window.collapsedTasks.delete(cardId);
    card.classList.remove('collapsed');
  } else {
    window.collapsedTasks.add(cardId);
    card.classList.add('collapsed');
  }
}
```

---

## Settings Application

### Column Width

```javascript
function applyColumnWidth(column, settings) {
  if (settings.columnWidth) {
    column.style.width = settings.columnWidth;
  }
}
```

### Multi-Row Layout

```javascript
function applyMultiRowLayout(board, settings) {
  if (settings.layoutRows > 1) {
    const container = document.getElementById('board-container');
    container.classList.add('multi-row');
    container.style.setProperty('--layout-rows', settings.layoutRows);
  }
}
```

### Theme Colors

```javascript
function applyBoardColors(board, settings) {
  const container = document.getElementById('board-container');
  
  if (settings.boardColor) {
    container.style.backgroundColor = settings.boardColor;
  }
  
  // Dark mode override
  if (document.body.classList.contains('dark') && settings.boardColorDark) {
    container.style.backgroundColor = settings.boardColorDark;
  }
}
```

---

## Integration Points

### Called By
- `webview.js` on board load
- `dragDrop.js` after card move
- `cardEditor.js` after card edit
- Message handler on board update

### Calls
- `markdownRenderer.js` → render card content
- `dragDrop.js` → setup drag handlers
- `cardEditor.js` → setup edit handlers
- `menuOperations.js` → setup context menus

---

## Migration Notes for V2

### Keep Same
- Incremental update approach
- Folding state management
- DOM structure

### Improve
- Use virtual DOM for better performance
- Implement proper React-like diffing
- Add animation transitions

### Modularize
- Split into separate files:
  - `boardRenderer.js` - main render
  - `columnRenderer.js` - column logic
  - `cardRenderer.js` - card logic
  - `foldStateManager.js` - folding state
