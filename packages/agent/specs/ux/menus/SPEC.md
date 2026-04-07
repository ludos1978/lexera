# Menu Operations Specification

**Status**: ✅ Baseline  
**V2 Target**: `lexera-kanban`  
**V1 Reference**: `src/html/menuOperations.js` (~3,989 lines)  
**Dependencies**: [Board Renderer](../core/board/SPEC.md), [Editor](../core/editor/SPEC.md), Backend API

---

## UX Requirements

### Card Context Menus

- User right-clicks or clicks donut menu (⋮) on card
- Menu shows:
  - Edit task (overlay)
  - Reveal content (unhides #hidden/#hide tags)
  - ---
  - Insert Card (before / after, duplicate )
  - ---
  - Park, Park Copy, Archive, Delete
  - ---
  - Add, Remove, Clear All - Tags, Show all Categories
  - ---
  - Marp / Pandoc options

### Column, Stack, Row Context Menus
- User right-clicks or clicks donut menu (⋮)  for same Element
- Menu shows:
  - Insert Column (before / after, duplicate)
  - ---
  - Park, Park Copy, Archive, Delete
  - ---
  - Add, Remove, Clear All - Tags, Show all Categories
  - ---
  - Marp / Pandoc options for same Element
  - Export


### Move Operations
- User can move card to top/bottom/up/down
- User can move card to different column
- DOM updates incrementally (no full re-render)

---

## Architecture

### Menu Types

```
┌─────────────────────────────────────────────────────────────────┐
│                    MENU TYPES                              │
├─────────────────────────────────────────────────────────────────┤
│                                                            │
│   1. TAG MENU (on #tag click)                              │
│   ┌─────────────────────┐                                    │
│   │ Filter by #tag    │                                    │
│   │ Search for #tag   │                                    │
│   │ Rename #tag       │                                    │
│   │ Change color      │                                    │
│   └─────────────────────┘                                    │
│                                                            │
│   2. CARD DONUT MENU (⋮ button)                            │
│   ┌─────────────────────┐                                    │
│   │ Edit              │                                    │
│   │ Duplicate         │                                    │
│   │ Move to column ►  │                                    │
│   │ Archive           │                                    │
│   │ Delete            │                                    │
│   └─────────────────────┘                                    │
│                                                            │
│   3. COLUMN MENU (header)                                  │
│   ┌─────────────────────┐                                    │
│   │ Add card          │                                    │
│   │ Sort by date      │                                    │
│   │ Sort by name      │                                    │
│   │ Span: ◀ ▶         │                                    │
│   │ Archive           │                                    │
│   │ Delete            │                                    │
│   └─────────────────────┘                                    │
│                                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Functions

### Menu Management

```javascript
// Close all open menus
function closeAllMenus()

// Toggle donut menu visibility
function toggleDonutMenu(event, button)

// Position dropdown relative to trigger
function positionDropdown(triggerButton, dropdown)

// Setup hover handlers for submenus
function setupMenuHoverHandlers(menu, dropdown)

// Cleanup dropdown after close
function cleanupDropdown(dropdown)
```

### Card Operations

```javascript
// Add new card to column
function addTask(columnId)

// Add card and unfold column
function addTaskAndUnfold(columnId)

// Duplicate card
function duplicateTask(cardId, columnId)

// Insert card before/after
function insertTaskBefore(cardId, columnId)
function insertTaskAfter(cardId, columnId)

// Move card in direction
function moveTaskInDirection(cardId, columnId, direction) // 'up', 'down', 'top', 'bottom'

// Move card to different column
function moveTaskToColumn(cardId, fromColumnId, toColumnId)

// Delete card
function deleteTask(cardId, columnId)

// Archive card (add #archive tag)
function archiveTaskFromMenu(cardId, columnId)

// Park card (hide from board)
function parkTaskFromMenu(cardId, columnId)

// Move card in DOM (incremental)
function moveTaskInDOM(cardId, columnId, newIndex, targetColumnId)
```

### Column Operations

```javascript
// Add new column
function addColumn(rowNumber)

// Insert column before/after
function insertColumnBefore(columnId)
function insertColumnAfter(columnId)

// Duplicate column
function duplicateColumn(columnId)

// Move column left/right
function moveColumnLeft(columnId)
function moveColumnRight(columnId)

// Change column span
function changeColumnSpan(columnId, delta)

// Toggle column sticky
function toggleColumnSticky(columnId)

// Toggle column stack
function toggleColumnStack(columnId)

// Sort column
function sortColumn(columnId, sortType) // 'bydate', 'byname'

// Delete column
function deleteColumn(columnId)

// Archive column
function archiveColumnFromMenu(columnId)

// Park column
function parkColumnFromMenu(columnId)
```

### Tag Operations

```javascript
// Toggle tag on column
function toggleColumnTag(columnId, tagName, event)

// Toggle tag on card
function toggleTaskTag(cardId, columnId, tagName, event)

// Handle tag click (shows menu)
window.handleColumnTagClick = function(columnId, tagName, event)
window.handleTaskTagClick = function(cardId, columnId, tagName, event)
```

### Utility Functions

```javascript
// Scroll element into view if needed
function scrollToElementIfNeeded(element, type)

// Update column empty state
function updateColumnEmptyState(columnId)

// Update cache for new card
function updateCacheForNewTask(columnId, newTask, insertIndex)

// Update cache for new column
function updateCacheForNewColumn(newColumn, insertIndex, referenceColumnId)

// Unfold column if collapsed
function unfoldColumnIfCollapsed(columnId, skipUnfold)

// Toggle hidden content visibility
function toggleHiddenContent(cardId)
function toggleHiddenColumnContent(columnId)

// Copy to clipboard
function copyToClipboard(text)

// Global sticky toggle
function toggleGlobalSticky(event)
function updateGlobalStickyButton()
```

---

## DOM Move Operations

### moveTaskInDOM

Moves card element without full re-render:

```javascript
function moveTaskInDOM(cardId, columnId, newIndex, targetColumnId = null) {
  // 1. Find card element
  const taskElement = document.querySelector(`[data-card-id="${cardId}"]`);
  
  // 2. Find target container
  const targetContainer = document.querySelector(`#tasks-${targetColId}`);
  
  // 3. Track source stack for recalculation
  const sourceStack = taskElement.closest('.kanban-column-stack');
  
  // 4. Remove from current position
  taskElement.parentNode.removeChild(taskElement);
  
  // 5. Insert at new position
  if (newIndex >= taskItems.length) {
    targetContainer.appendChild(taskElement);
  } else {
    targetContainer.insertBefore(taskElement, taskItems[newIndex]);
  }
  
  // 6. Update column ID references in handlers
  if (targetColId !== columnId) {
    // Update onclick attributes
    // Update data-column-id attributes
  }
  
  // 7. Update empty state
  updateColumnEmptyState(columnId);
  if (targetColId !== columnId) {
    updateColumnEmptyState(targetColId);
  }
  
  // 8. Recalculate stack heights
  updateStackLayoutDebounced(sourceStack);
  updateStackLayoutDebounced(targetStack);
}
```

---

## Tag Menu Structure

```html
<div class="tag-menu" data-tag-name="work">
  <button onclick="filterByTag('work')">Filter by #work</button>
  <button onclick="searchTag('work')">Search for #work</button>
  <button onclick="renameTag('work')">Rename #work</button>
  <div class="color-picker">
    <button class="color-btn" data-color="#ff0000"></button>
    <button class="color-btn" data-color="#00ff00"></button>
    <!-- ... more colors -->
  </div>
</div>
```

---

## Donut Menu Structure

```html
<div class="donut-menu">
  <button class="donut-menu-item" onclick="editTask(...)">
    <span class="icon">✏️</span>
    <span class="label">Edit</span>
  </button>
  <button class="donut-menu-item" onclick="duplicateTask(...)">
    <span class="icon">📋</span>
    <span class="label">Duplicate</span>
  </button>
  <div class="donut-menu-item has-submenu">
    <span class="icon">↔️</span>
    <span class="label">Move to column</span>
    <div class="submenu">
      <button onclick="moveTaskToColumn(..., 'col-1')">To Do</button>
      <button onclick="moveTaskToColumn(..., 'col-2')">In Progress</button>
      <!-- ... more columns -->
    </div>
  </div>
  <button class="donut-menu-item" onclick="archiveTaskFromMenu(...)">
    <span class="icon">📦</span>
    <span class="label">Archive</span>
  </button>
  <button class="donut-menu-item danger" onclick="deleteTask(...)">
    <span class="icon">🗑️</span>
    <span class="label">Delete</span>
  </button>
</div>
```

---

## Global State

```javascript
// Active tag menu reference
let activeTagMenu = null;

// Save coordination
window._lastFlushedChanges = null;
window._saveInFlight = false;
window._saveAckTimeout = null;
window._pendingPostSaveEditorSync = false;
```

---

## Event Flow

### Tag Click Flow

```
User clicks #tag
       │
       ▼
handleTaskTagClick(cardId, columnId, tagName, event)
       │
       ├─ Close existing menu
       │
       ├─ Create menu element
       │
       ├─ Position near click
       │
       └─ Add to DOM

User clicks menu item
       │
       ▼
Execute action (filter/search/rename/color)
       │
       ▼
closeAllMenus()
```

### Donut Menu Flow

```
User clicks ⋮ button
       │
       ▼
toggleDonutMenu(event, button)
       │
       ├─ Menu already open?
       │     └─ Yes → close, return
       │
       ├─ Close other menus
       │
       ├─ Show dropdown
       │
       └─ Position near button

User clicks item
       │
       ▼
Execute action
       │
       ▼
closeAllMenus()
```

---

## Embed / Include Context Menus

### Local File Embed Menu (right-click or gear button on embedded file)

```
Open in System App
Show in Finder
Copy Path
─────────────────
Replace Document
Force Refresh
Convert to Relative Path
─────────────────
Info
Delete Embed
```

### Include Directive Menu (right-click or gear button on included file)

Same structure as embed menu, with "Delete Include" instead of "Delete Embed".

### External Embed Menu (embedded URLs)

```
Open Page Here
Open URL in Browser
Copy URL
Recheck Embed Permission
─────────────────
Edit URL
Delete Embed
```

### Replace Document Overlay

Displayed when "Replace Document" is selected. Provides multiple ways to
replace the current embed/include file path:

- **File search**: Searches the board workspace for files with the same name
- **Drag & drop**: Drop a file from the OS into the drop zone
- **Paste**: Paste a file from clipboard
- **Browse**: OS file dialog starting in the embed file's directory (or board directory as fallback)
- **Web Search**: Opens a web search prefilled with the filename (stays open)

Pasted/dropped files are uploaded to the media folder of the main kanban file
(or the include file's media folder if the embed is inside an include column).

### Board File Link Menu (clickable file links in card content)

```
Preview File
─────────────────
Open in System App
Show in Finder
Copy Path
Automatic Path Fix
Manual Path Fix
Web-Search File
Convert to Relative/Absolute
```

---

## Integration Points

### Called By
- `boardRenderer.js` → onclick handlers in rendered HTML
- `cardEditor.js` → after edit operations

### Calls
- `boardRenderer.js` → `renderBoard()`, `updateColumnEmptyState()`
- `cardEditor.js` → edit functions
- VS Code API → `vscode.postMessage()` for data persistence

---

## Migration Notes for V2

### Keep Same
- Menu structure and positioning
- Tag click handling
- Donut menu pattern

### Improve
- Use proper event delegation
- Add keyboard navigation (arrow keys)
- ARIA attributes for accessibility

### Modularize
- `menuManager.js` - Core menu logic
- `cardMenus.js` - Card-specific menus
- `columnMenus.js` - Column-specific menus
- `tagMenus.js` - Tag click menus

### Plugin Architecture (see related specs)
- [Menu Contributors](../menu-contributors/SPEC.md) — contributor registry replacing four duplicated menu builders
- [Action Registry](../actions/SPEC.md) — dispatch registry replacing five if/else chains
- [Board Settings](../board-settings/SPEC.md) — settings descriptors replacing scattered format handlers
