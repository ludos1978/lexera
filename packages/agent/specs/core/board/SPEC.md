# Board Renderer Specification

**File**: `src/html/boardRenderer.js`
**Lines**: ~3,935
**Purpose**: Render KanbanBoard to DOM, handle updates
**Dependencies**: `markdownRenderer.js`, `dragDrop.js`, `cardEditor.js`

---

## UX Requirements

### Board Display
- User sees board as columns with cards
- Columns flow horizontally (or in grid for multi-row layout)
- Cards stack vertically within columns
- Board respects settings (column width, row height, colors)

### Folding State
- User can collapse/expand columns (click column header)
- User can collapse/expand cards (click chevron)
- State persists across re-renders (stored in `window.collapsedColumns`, `window.collapsedTasks`)

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

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    RENDERING FLOW                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   KanbanBoard                                                    │
│   (from parser)                                                  │
│        │                                                         │
│        ▼                                                         │
│   ┌──────────────────┐                                          │
│   │ renderBoard()    │  Main entry point                        │
│   └──────────────────┘                                          │
│        │                                                         │
│        ├─────────────────────────────────────┐                  │
│        │                                     │                   │
│        ▼                                     ▼                   │
│   ┌──────────────────┐              ┌──────────────────┐        │
│   │ Clear Old Board  │              │ Preserve State   │        │
│   │ (with blur       │              │ - collapsedCols  │        │
│   │  protection)     │              │ - collapsedTasks │        │
│   └──────────────────┘              │ - scrollPos      │        │
│        │                            └──────────────────┘        │
│        ▼                                                         │
│   ┌──────────────────┐                                          │
│   │ Create Columns   │  For each column:                        │
│   │                  │  renderColumn(col, index)                │
│   └──────────────────┘                                          │
│        │                                                         │
│        ▼                                                         │
│   ┌──────────────────┐                                          │
│   │ renderColumn()   │  For each column:                        │
│   │                  │                                          │
│   │  1. Create col   │   - Create column element                │
│   │     element      │   - Apply settings (width, color)        │
│   │  2. Render title │   - Render title (with markdown)         │
│   │  3. Render cards │   - Render cards                         │
│   │  4. Add handlers │   - Add drag/drop/edit handlers          │
│   └──────────────────┘                                          │
│        │                                                         │
│        ▼                                                         │
│   ┌──────────────────┐                                          │
│   │ renderCard()     │  For each card:                          │
│   │                  │                                          │
│   │  1. Create card  │   - Create card element                  │
│   │     element      │   - Apply checked state                  │
│   │  2. Render       │   - Render content (with markdown)       │
│   │     content      │   - Handle tags, dates, links            │
│   │  3. Add handlers │   - Add click/drag/edit handlers         │
│   └──────────────────┘                                          │
│        │                                                         │
│        ▼                                                         │
│   ┌──────────────────┐                                          │
│   │ initializeCard   │  Centralized card setup                  │
│   │ Element()        │                                          │
│   │                  │  - Add drag handlers                     │
│   │                  │  - Add click handlers                    │
│   │                  │  - Add edit handlers                     │
│   │                  │  - Mark as initialized                   │
│   └──────────────────┘                                          │
│        │                                                         │
│        ▼                                                         │
│   DOM Ready                                                       │
│   (board-container populated)                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
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
