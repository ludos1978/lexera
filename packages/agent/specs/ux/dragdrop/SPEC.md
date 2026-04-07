# Drag & Drop System Specification

**Status**: ✅ Baseline  
**V2 Target**: `lexera-kanban`  
**V1 Reference**: `src/html/dragDrop.js` (~6,514 lines)  
**Dependencies**: [Board Renderer](../core/board/SPEC.md), [Menus](../ux/menus/SPEC.md), Backend API

---

## UX Requirements

### card Dragging
- User can drag a card card by its drag handle (grip icon)
- Card dont need to show a visual preview while dragging
- Card can be dropped in any column at any position in the view and in the hierarchy in other boards. also accross split view into other boards.
- they can be re-ordereed within the same column.
- if a card is dragged into a row without stacks/column or into a stack without a column, it adding them without a name
- if the last card is moved away from a column without a name, or the last column is moved from a stack without a name, or from a row without a name it's removed automatically!
- Drop indicator shows where card will be inserted
- ESC key cancels drag operation

### Column Dragging
- User can drag a column by its drag handle
- Column shows visual feedback while dragging
- append similar rules as the card has, but for columns...

### stack dragging
- append similar rules as the card has, but for stacks...

### Row Dragging
- append similar rules as the card has, but for rows...

### External File Drops
- User can drag files from OS into board
  - Any media that can be displayed or previewed is embedded ![alt text](/link/to/media){"title"}
  - Any unknown file is linked [alt text](/link/to/file)
- When dropped into an open edtior field
  - it adds all markdown text into lines
- When dropped outside an open editor
  - it adds them as individual files
- "Apply to all" option for batch drops

### Template Drops
- Templates can exist for row, stack, column and cards
- User can drag templates from top bar
- on release variables are asked from the user which can be defined in the templates
- Template content creates new structures at drop position (or insert at the drop position)
- Template variables are resolved
- templates might contain included files, which can have variables in the filename
- (include)files are by default created in the same folder as the main kanban file or a sobfolder if that is defined as such in the template.

### Clipboard Drops
- User can paste clipboard content as new card
- normal paste cmd+v (osx) or ctrl+v (win) are pasting the content in the original format
- shift+paste shift+cmd+v (osx) or shift+ctrl+v (win) is pasting the content parsed and converted
  - Links, paths etc. that are detected within the content are converted as defined in the file drops (convert to links)

### Parked, Archived, Trash Item Drops
- At the top of the board we have "Park", "Archive" and "Trash"
- Any element (cards, columns, stacks and rows) can be moved to any of these elements.
- Deleting something is the same as moving to Trash
- Archiving something is the same as moving to Archvie
- The elements are tagged with the tag #internal-park #internal-archive or #internal-trash
- Any element that has any of the tags #internal-park #internal-archive or #internal-trash is not shown in the board anymore.
- All elements are saved with the board even if they are parked/archived/trashed.
- Park/Archive/Trash buttons lists all the cards/columns/stacks/rows the elements when hovered.
  - they can be dragged back to the board to specific positions and are positioned there, the tags are removed.
- The Trash can be emptied, only then are all tagged elements deleted from the board.
- The Archive can be archived, only then are all tagged elements archived into a file named {main-or-include-filename}-archive.md 


---

## Architecture

### State Machine

The drag system uses a finite state machine:

```
┌─────────────────────────────────────────────────────────────────┐
│                    DRAG DROP STATE MACHINE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌───────┐                                                      │
│   │ IDLE  │◄─────────────────────────────────────────────┐      │
│   └───┬───┘                                              │      │
│       │                                                  │      │
│       │ dragstart (card)                                 │      │
│       ▼                                                  │      │
│   ┌───────┐                                              │      │
│   │ CARD  │──────────────────────────────────────────────┤      │
│   └───┬───┘  dragend/drop/escape                         │      │
│       │                                                  │      │
│       │ dragstart (column)                               │      │
│       ▼                                                  │      │
│   ┌─────────┐                                            │      │
│   │ COLUMN  │────────────────────────────────────────────┤      │
│   └────┬────┘  dragend/drop/escape                       │      │
│        │                                                 │      │
│        │ dragstart (clipboard)                           │      │
│        ▼                                                 │      │
│   ┌───────────┐                                          │      │
│   │ CLIPBOARD │──────────────────────────────────────────┤      │
│   └─────┬─────┘  dragend/drop/escape                     │      │
│         │                                                │      │
│         │ dragstart (template)                           │      │
│         ▼                                                │      │
│   ┌───────────┐                                          │      │
│   │ TEMPLATE  │──────────────────────────────────────────┤      │
│   └─────┬─────┘  dragend/drop/escape                     │      │
│         │                                                │      │
│         │ external file enter                            │      │
│         ▼                                                │      │
│   ┌───────────┐                                          │      │
│   │ EXTERNAL  │──────────────────────────────────────────┘      │
│   └───────────┘  dragleave/drop/escape                     │      │
│                                                            │      │
└─────────────────────────────────────────────────────────────────┘

```

### State Variables

```javascript
// Centralized drag state (window.dragState)
const DRAG_STATE_DEFAULTS = {
  isDragging: false,
  draggedCard: null,            // Current card element being dragged
  draggedColumn: null,          // Current column element being dragged
  draggedClipboardCard: null,   // Clipboard card data
  draggedEmptyCard: null,       // Empty card placeholder
  draggedTemplate: null,        // Template data
  
  // Column drag tracking
  draggedColumnId: null,
  originalColumnIndex: -1,
  originalColumnNextSibling: null,
  originalColumnParent: null,
  originalDataIndex: -1,
  
  // Card drag tracking
  originalCardIndex: -1,
  originalCardColumnId: null,
  originalCardParent: null,
  originalCardNextSibling: null,
  
  // Drop tracking
  lastValidDropTarget: null,
  lastDropTarget: null,
  lastRowDropTarget: null,
  lastRow: null,
  targetRowNumber: null,
  targetPosition: null,
  finalRowNumber: null,
  
  // Modifier keys
  altKeyPressed: false,
  
  // View tracking (for cancel on leave)
  leftView: false,
  leftViewTimestamp: null
};

// State machine states
const DragDropStates = Object.freeze({
  IDLE: 'idle',
  CARD: 'card',
  COLUMN: 'column',
  CLIPBOARD: 'clipboard',
  EMPTY_CARD: 'empty-card',
  DIAGRAM: 'diagram',
  TEMPLATE: 'template',
  EXTERNAL: 'external'
});
```

---

## Data Flow

### Card Drag Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    CARD DRAG FLOW                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. DRAG START                                                  │
│   ┌──────────────────┐                                          │
│   │ User grabs       │  onDragStart()                           │
│   │ drag handle      │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Store original   │  - originalCardIndex                     │
│   │ position         │  - originalCardColumnId                  │
│   │                  │  - originalCardParent                    │
│   │                  │  - originalCardNextSibling               │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Set drag state   │  dragState.isDragging = true             │
│   │                  │  dragState.draggedCard = element         │
│   │                  │  dragDropStateMachine.start('card')      │
│   └────────┬─────────┘                                          │
│            │                                                     │
│   2. DRAG OVER (continuous)                                     │
│   ┌──────────────────┐                                          │
│   │ Calculate drop   │  findDropPositionHierarchical()          │
│   │ position         │                                          │
│   │                  │  Row (Y) → Stack (X) → Column (X)        │
│   │                  │         → Card (Y midpoint)              │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Show drop        │  showCardDropIndicator()                 │
│   │ indicator        │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│   3. DROP                                                         │
│   ┌──────────────────┐                                          │
│   │ User releases    │  onDrop()                                │
│   │ mouse            │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Calculate final  │  findDropPositionHierarchical()          │
│   │ position         │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Update data      │  - Remove from original column           │
│   │                  │  - Insert in target column               │
│   │                  │  - Update cachedBoard                    │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Update DOM       │  moveCardInDOM() (incremental)           │
│   │ (incremental)    │  OR renderBoard() (fallback)             │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Save to backend  │  sendBoardUpdateToBackend()              │
│   │                  │  markUnsavedChanges()                    │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Reset state      │  resetCardDragState()                    │
│   │                  │  dragDropStateMachine.reset()            │
│   └──────────────────┘                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Drop Position Calculation

```
┌─────────────────────────────────────────────────────────────────┐
│              HIERARCHICAL DROP POSITION                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   findDropPositionHierarchical(mouseX, mouseY, draggedCard)     │
│                                                                  │
│   STEP 1: Find ROW by Y coordinate                              │
│   ┌─────────────────────────────────────────────────────┐       │
│   │  Row 1 (Y: 0-400)    ┌───┬───┬───┐                  │       │
│   │                      │ A │ B │ C │                  │       │
│   │                      └───┴───┴───┘                  │       │
│   ├─────────────────────────────────────────────────────┤       │
│   │  Row 2 (Y: 400-800)  ┌───┬───┐                      │       │
│   │                      │ D │ E │                      │       │
│   │                      └───┴───┘                      │       │
│   └─────────────────────────────────────────────────────┘       │
│                                                                  │
│   STEP 2: Within ROW, find STACK by X coordinate                │
│   ┌─────────────────────────────────────────────────────┐       │
│   │  Stack 1    Stack 2    Stack 3                      │       │
│   │  (X: 0-300) (X: 300-600) (X: 600-900)               │       │
│   │  ┌─────┐    ┌─────┐    ┌─────┐                     │       │
│   │  │     │    │     │    │     │                     │       │
│   │  └─────┘    └─────┘    └─────┘                     │       │
│   └─────────────────────────────────────────────────────┘       │
│                                                                  │
│   STEP 3: Within STACK, find COLUMN by X coordinate             │
│   (Same as stack for single-column stacks)                      │
│                                                                  │
│   STEP 4: Within COLUMN, find INSERTION INDEX by Y              │
│   ┌─────────────────────────────────────────────────────┐       │
│   │  Card 1 (Y: 0-80)                                   │       │
│   │  ─────────────────                                  │       │
│   │  Card 2 (Y: 80-160)                                 │       │
│   │  ─────────────────  ← INSERT HERE (Y: 120)         │       │
│   │  Card 3 (Y: 160-240)                                │       │
│   │  ─────────────────                                  │       │
│   │  Card 4 (Y: 240-320)                                │       │
│   └─────────────────────────────────────────────────────┘       │
│                                                                  │
│   Returns: { columnId, insertionIndex, columnElement }          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Functions

### Setup Functions

```javascript
// Main setup - call once on board load
function setupGlobalDragAndDrop()

// Setup card drag for specific column
function setupCardDragAndDropForColumn(columnElement)

// Setup column drag
function setupColumnDragAndDrop()

// Setup row drag (for multi-row layout)
function setupRowDragAndDrop()

// Setup template drag handlers
function setupTemplateDragHandlers()
```

### State Management

```javascript
// Reset card drag state
function resetCardDragState()

// Reset column drag state
function resetColumnDragState()

// Reset all drop targets
function resetDropTargets()

// Get current drag mode
function getCurrentDragMode()

// Check if template drag is active
function isTemplateDragActive()

// Check if internal drag is active
function isInternalDragActive()
```

### Position Calculation

```javascript
// Main position finder (hierarchical)
function findDropPositionHierarchical(mouseX, mouseY, draggedCard)

// Calculate column drop target
function calculateColumnDropTarget(mouseX, mouseY)

// Get include context for drop
function getIncludeContextForDrop(event)
```

### Drop Handlers

```javascript
// Handle card drop
function handleCardDrop(e, dropResult)

// Handle column drop
function processColumnDrop(columnId, dropTarget)

// Handle external file drop
function handleMultipleFilesDrop(e, filesContent)

// Handle clipboard card drop
function handleClipboardCardDrop(e, clipboardData)

// Handle template drop
function applyTemplateAtPosition(templatePath, dropPosition)

// Handle parked item drop
function handleParkedItemDrop(e, parkedData)
```

### DOM Manipulation

```javascript
// Move card in DOM (incremental update)
function moveCardInDOM(cardId, fromColumnId, toColumnId, newIndex)

// Create cards at position
function createCardsWithContent(cardsData, dropPosition, explicitColumnId, explicitInsertionIndex)

// Restore card position (on cancel)
function restoreCardPosition()

// Move column to drop target
function moveColumnToDropTarget(columnId, beforeColumnId, targetStackFirstColId, options)
```

### File Handling

```javascript
// Process image save
function processImageSave(e, base64Data, imageType, md5Hash)

// Execute file object copy
function executeFileObjectCopy(dropId, isImage)

// Cancel pending file drop
function cancelPendingFileDrop(dropId)

// Show file drop dialog
function showFileDropDialogue(options)

// Read partial file for hash
function readPartialFileForHash(file)
```

---

## Event Handlers

### Document-Level Events

| Event | Handler | Purpose |
|-------|---------|---------|
| `keydown` (ESC) | Cancel drag | Restore position, reset state |
| `dragstart` | Prevent text drag | Block non-handle drags |
| `dragover` | Calculate position | Show drop indicator |
| `drop` | Process drop | Handle all drop types |
| `dragleave` | Hide feedback | Clear drop indicators |

### Card Events

| Event | Handler | Purpose |
|-------|---------|---------|
| `dragstart` | onCardDragStart | Store position, set state |
| `dragend` | onCardDragEnd | Cleanup, reset state |

### Column Events

| Event | Handler | Purpose |
|-------|---------|---------|
| `dragstart` | onColumnDragStart | Store position, set state |
| `dragend` | onColumnDragEnd | Cleanup, reset state |
| `dragover` | onColumnDragOver | Allow drop, show indicator |
| `drop` | onColumnDrop | Process column reorder |

---

## External File Drop Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                EXTERNAL FILE DROP FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. User drags file from OS into board                         │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ dragenter        │  Mark external drag active               │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ dragover         │  Show drop zone feedback                 │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   2. User drops file                                            │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Read file        │  FileReader.readAsArrayBuffer()          │
│   │                  │                                          │
│   │ Check type:      │                                          │
│   │ - Image?         │  → Show preview dialog                   │
│   │ - Other?         │  → Create card with link                 │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Size check       │  if > 10MB: show warning                 │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Hash calculation │  readPartialFileForHash()                │
│   │ (first 1MB)      │  For duplicate detection                 │
│   └────────┬─────────┘                                          │
│            │                                                     │
│   3a. IMAGE: Show Dialog                                        │
│   ┌──────────────────┐                                          │
│   │ File Drop        │  - Preview image                         │
│   │ Dialog           │  - Filename input                        │
│   │                  │  - "Copy to attachments" checkbox        │
│   │                  │  - "Apply to all" for batch              │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ User confirms    │  → Copy file to attachments/             │
│   │                  │  → Create card with ![image](path)       │
│   └────────┬─────────┘                                          │
│            │                                                     │
│   3b. NON-IMAGE: Direct Create                                  │
│   ┌──────────────────┐                                          │
│   │ Create card      │  - [ ] filename.ext                      │
│   │                  │    [file](path/to/file)                  │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Create card(s)   │  createCardsWithContent()                │
│   │ at drop position │                                          │
│   └──────────────────┘                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Drop Dialog

### Dialog Structure

```html
<div class="file-drop-dialog">
  <div class="dialog-content">
    <!-- Image Preview -->
    <div class="image-preview">
      <img src="data:image/..." />
    </div>
    
    <!-- File Info -->
    <div class="file-info">
      <span class="filename">image.png</span>
      <span class="filesize">1.2 MB</span>
    </div>
    
    <!-- Filename Input -->
    <input type="text" class="filename-input" value="image" />
    
    <!-- Options -->
    <label class="checkbox">
      <input type="checkbox" checked />
      Copy to attachments folder
    </label>
    
    <label class="checkbox">
      <input type="checkbox" />
      Apply to all (5 files)
    </label>
    
    <!-- Actions -->
    <div class="dialog-actions">
      <button class="btn-cancel">Cancel</button>
      <button class="btn-skip">Skip</button>
      <button class="btn-confirm">Create Card</button>
    </div>
  </div>
</div>
```

### Apply to All Logic

```javascript
// Store apply-all action for batch drops
let fileDropApplyAllAction = null;

// When user checks "Apply to all"
if (applyAllChecked) {
  fileDropApplyAllAction = {
    copyToAttachments: copyChecked,
    skip: false
  };
}

// For subsequent files
if (fileDropApplyAllAction) {
  // Use stored action instead of showing dialog
  processFileWithAction(file, fileDropApplyAllAction);
}
```

---

## Parked Items System

### What are Parked Items?

Parked items are cards/columns that have been removed from the board but not deleted. They appear in a sidebar section and can be dragged back.

### Hidden Tags

```javascript
const PARKED_TAG = '#hidden-internal-parked';
const DELETED_TAG = '#hidden-internal-deleted';
const ARCHIVED_TAG = '#hidden-internal-archived';
```

### Restore Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                PARKED ITEM RESTORE FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. User drags parked item from sidebar                        │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Store drop       │  Capture drop target BEFORE cleanup      │
│   │ target           │  (elements become stale after render)    │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Remove hidden    │  card.content = removeInternalTags()     │
│   │ tags             │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Add to board     │  createCardsWithContent() OR             │
│   │ data             │  addSingleColumnToDOM()                  │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Move to drop     │  moveCardInDOM() OR                      │
│   │ position         │  moveColumnToDropTarget()                │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Update parked    │  updateParkedItemsUI()                   │
│   │ items UI         │                                          │
│   └──────────────────┘                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Constants

```javascript
// File size limits
const FILE_SIZE_LIMIT_MB = 10;
const FILE_SIZE_LIMIT_BYTES = FILE_SIZE_LIMIT_MB * 1024 * 1024;
const PARTIAL_HASH_SIZE = 1024 * 1024; // 1MB for hash

// Throttling
const INDICATOR_UPDATE_THROTTLE = 100; // ms

// State
let dragDropInitialized = false;
let isProcessingDrop = false;
```

---

## Integration Points

### Called By
- `boardRenderer.js` → `setupGlobalDragAndDrop()` after render
- `boardRenderer.js` → `setupCardDragAndDropForColumn()` for new columns
- Template sidebar → drag handlers

### Calls
- `boardRenderer.js` → `renderBoard()`, `addSingleCardToDOM()`, `moveCardInDOM()`
- `menuOperations.js` → context menus
- VS Code API → `vscode.postMessage()` for file operations

---

## Migration Notes for V2

### Keep Same
- State machine approach
- Hierarchical drop position calculation
- File drop dialog pattern
- Parked items system

### Improve
- Use native HTML5 drag/drop events more consistently
- Add touch support for mobile
- Improve drop indicator animations
- Better handling of rapid drags

### Modularize
- Split into:
  - `cardDrag.js` - Card drag logic
  - `columnDrag.js` - Column drag logic
  - `fileDrop.js` - External file handling
  - `dropIndicator.js` - Visual feedback
  - `parkedItems.js` - Parked items management
