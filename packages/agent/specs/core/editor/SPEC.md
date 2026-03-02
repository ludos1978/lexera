# Card Editor Specification

**Status**: ✅ Baseline  
**V2 Target**: `packages/lexera-kanban`  
**V1 Reference**: `src/html/cardEditor.js` (~3,135 lines)  
**Dependencies**: [Board Renderer](../core/board/SPEC.md), WYSIWYG editor, [Markdown Renderer](../shared/markdown/SPEC.md)

---

## UX Requirements

### Inline Title Editing
- User clicks on card title to start editing
- Editor appears in-place (no dialog)
- Textarea auto-resizes to fit content
- Enter saves, Escape cancels
- Tab transitions to description

### Inline Description Editing
- User clicks on card description to edit
- Multi-line editing with auto-resize
- Tab from title transitions to description
- Shift+Tab goes back to title

### Column Title Editing
- User clicks column title to edit
- Supports markdown in column titles
- Include syntax preserved during edit

### WYSIWYG Mode
- User can toggle WYSIWYG editing
- Rich text toolbar for formatting
- Markdown preview in split view
- Sync between WYSIWYG and markdown

### Keyboard Shortcuts
- `Enter` - Save and close
- `Escape` - Cancel and close
- `Tab` - Save and move to next field
- `Shift+Tab` - Save and move to previous field
- `Ctrl+B` - Bold (in WYSIWYG)
- `Ctrl+I` - Italic (in WYSIWYG)

---

## Architecture

### CardEditor Class

```javascript
class CardEditor {
  constructor() {
    this.currentEditor = null;      // Current edit session
    this.isTransitioning = false;   // Title → description transition
    this.keystrokeTimeout = null;   // Debounce keystroke saves
    this.lastEditContext = null;    // Track what was last edited
    this.indentUnit = '  ';         // Indentation for lists
    
    // Stack layout recalculation
    this._stackLayoutNeedsFullRecalc = false;
    this._stackLayoutPendingColumns = new Set();
    this._wysiwygRecalcTimeout = null;
    this._postCloseFocusTimeout = null;
    
    this.setupGlobalHandlers();
  }
}
```

### Editor State

```javascript
this.currentEditor = {
  type: 'card-title' | 'card-description' | 'column-title',
  cardId: string | null,
  columnId: string,
  element: HTMLElement,           // Textarea/contenteditable
  displayElement: HTMLElement,    // Display element (hidden during edit)
  originalValue: string,          // Value before edit (for cancel)
  wysiwyg: WysiwygEditor | null,  // WYSIWYG instance if active
  wysiwygContainer: HTMLElement,  // WYSIWYG container
  containerElement: HTMLElement,  // Card/column container
  includeContext: Object | null,  // Include file context
};
```

---

## Data Flow

### Edit Start Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    EDIT START FLOW                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. User clicks on card title                                  │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Click handler    │  event.target.closest('.card-title')     │
│   │ detects click    │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Get edit         │  _getEditElements(element, 'card-title') │
│   │ elements         │  Returns: { editEl, displayEl }          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Initialize       │  _initializeTaskTitleValue()             │
│   │ value            │  Set textarea.value from card content    │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Store state      │  _storeEditorState()                     │
│   │                  │  - type, cardId, columnId                │
│   │                  │  - originalValue                         │
│   │                  │  - includeContext                        │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Setup visibility │  _setupEditVisibility()                  │
│   │                  │  - Hide display element                  │
│   │                  │  - Show edit element                     │
│   │                  │  - Auto-resize textarea                  │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Setup handlers   │  - _setupInputHandler()                  │
│   │                  │  - _setupBlurHandler()                   │
│   │                  │  - _setupMouseHandlers()                 │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Focus element    │  _focusElement(editElement)              │
│   │                  │  Position cursor at end                  │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Notify           │  _notifyEditingStarted()                 │
│   │                  │  Set window.isEditing = true             │
│   └──────────────────┘                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Save Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    SAVE FLOW                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   User presses Enter or clicks away                             │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ saveCurrentField │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ├─────────────────────────────────┐                  │
│            │                                 │                   │
│            ▼                                 ▼                   │
│   ┌──────────────────┐              ┌──────────────────┐        │
│   │ _saveColumnTitle │              │ _saveTaskField   │        │
│   │                  │              │                  │        │
│   │ - Get new value  │              │ - Get card       │        │
│   │ - Update column  │              │ - Update content │        │
│   │ - Handle includes│              │ - Handle includes│        │
│   └────────┬─────────┘              └────────┬─────────┘        │
│            │                                 │                   │
│            └────────────────┬────────────────┘                  │
│                             │                                   │
│                             ▼                                   │
│   ┌──────────────────────────────────────────────────┐          │
│   │ Update display                                    │          │
│   │ - _updateColumnDisplay() or _updateTaskDisplay() │          │
│   │ - Re-render markdown                             │          │
│   │ - Update tag styling                             │          │
│   └──────────────────────────────────────────────────┘          │
│                             │                                   │
│                             ▼                                   │
│   ┌──────────────────┐                                          │
│   │ Mark unsaved     │  markUnsavedChanges()                    │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Sync to backend  │  sendBoardUpdateToBackend()              │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Close editor     │  closeEditor()                           │
│   │                  │  - Restore visibility                    │
│   │                  │  - Clear state                           │
│   │                  │  - window.isEditing = false              │
│   └──────────────────┘                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Tab Transition Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    TAB TRANSITION                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   User presses Tab while editing title                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Check if card    │  currentEditor.type === 'card-title'     │
│   │ title            │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Set transition   │  this.isTransitioning = true             │
│   │ flag             │  (prevents blur save)                    │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Save current     │  saveCurrentField()                      │
│   │ field            │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Start            │  editDescription(element, cardId, colId) │
│   │ description      │                                          │
│   │ edit             │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Clear transition │  this.isTransitioning = false            │
│   │ flag             │                                          │
│   └──────────────────┘                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Functions

### Public API

```javascript
class CardEditor {
  // Start editing
  editTitle(element, cardId, columnId)
  editDescription(element, cardId, columnId)
  editColumnTitle(element, columnId)
  
  // Save/Cancel
  save()
  cancel()
  saveCurrentField()
  
  // State
  getCurrentEditState()
  applyCurrentEditToBoard(board)
  
  // Transition
  transitionToDescription()
  
  // Utilities
  autoResize(textarea)
  replaceSelection(newText)
  scheduleKeystrokeUndoSave(operation, cardId, columnId)
  saveUndoStateImmediately(operation, cardId, columnId)
}
```

### Internal Functions

```javascript
// Initialization
_setupEditVisibility(displayElement, editElement, wysiwygContainer, containerElement)
_storeEditorState(editElement, displayElement, type, cardId, columnId, includeContext, wysiwygContext, containerElement)
_notifyEditingStarted(type, cardId, columnId)

// Handlers
_setupInputHandler(editElement, containerElement)
_setupBlurHandler(editElement)
_setupMouseHandlers(editElement)
setupGlobalHandlers()

// Value initialization
_initializeColumnTitleValue(editElement, columnId)
_initializeTaskDescriptionValue(editElement, cardId, columnId)

// Save implementations
_saveColumnTitle()
_saveTaskField()
_saveTaskTitle(card, value, cardId, columnId, element)
_saveTaskDescription(card, value, cardId, columnId)

// Display updates
_updateColumnDisplay(column, columnId)
_updateTaskDisplay(card, type, value, cardId)
_updateColumnTagStyling(column, columnId)
_updateTaskTagStyling(card, cardId, columnId)

// Focus management
_focusElement(element)
_focusElementAfterRender(element)
_positionCursor(editElement, type, preserveCursor, wysiwygEditor)

// Scroll management
_lockScrollForFrames(element, top, left, frames)
_captureScrollPositions(baseElement)
_restoreScrollPositions(positions)

// Stack layout
_recalculateStackLayout(containerElement)
_requestStackLayoutRecalc(columnId, forceFull)
_flushStackLayoutRecalc()

// WYSIWYG
_shouldUseWysiwyg(type)
_setupWysiwygEditor(editElement, containerElement)
_setupWysiwygHandlers(editor, wysiwygContainer, containerElement)
_handleWysiwygInput(containerElement)

// Markdown style insertion
_handleMarkdownStyleInsertion(event, element)
_handleInlineUndoRedo(event, element)
_handleVSCodeShortcut(event, element)

// Text manipulation
_indentSelection(element)
_unindentSelection(element)
_findPositionBeforeFirstTag(text)
```

---

## Markdown Style Insertion

### Supported Styles

```javascript
const MARKDOWN_STYLE_PAIRS = {
  '*': { start: '*', end: '*' },     // Italic
  '_': { start: '_', end: '_' },     // Italic (alt)
  '~': { start: '~', end: '~' },     // Strikethrough
  '^': { start: '^', end: '^' },     // Superscript
  '`': { start: '`', end: '`' },     // Code
  '[': { start: '[', end: ']' },     // Link
  '"': { start: '"', end: '"' },     // Quote
};
```

### Behavior

When user types a style character with text selected:
1. Wrap selection with style pair
2. Example: `Hello` → `*Hello*`

When user types a style character with no selection:
1. Insert paired characters
2. Position cursor between them
3. Example: `|` → `*|*`

---

## Auto-Resize

```javascript
autoResize(textarea) {
  // Reset height to get accurate scrollHeight
  textarea.style.height = 'auto';
  
  // Set to scrollHeight (content height)
  textarea.style.height = textarea.scrollHeight + 'px';
  
  // Recalculate stack layout if needed
  this._requestStackLayoutRecalc(columnId);
}
```

---

## Undo/Redo During Edit

### Keystroke-Level Undo

```javascript
// Save undo state after user stops typing
scheduleKeystrokeUndoSave(operation, cardId, columnId) {
  clearTimeout(this.keystrokeTimeout);
  
  this.keystrokeTimeout = setTimeout(() => {
    this.saveUndoStateImmediately(operation, cardId, columnId);
  }, 500); // 500ms debounce
}
```

### Inline Undo/Redo

```javascript
// Ctrl+Z / Ctrl+Shift+Z handled specially
_handleInlineUndoRedo(event, element) {
  if (event.ctrlKey || event.metaKey) {
    if (event.key === 'z' && !event.shiftKey) {
      // Undo: restore from undo stack
    } else if (event.key === 'z' && event.shiftKey) {
      // Redo: restore from redo stack
    }
  }
}
```

---

## WYSIWYG Integration

### When to Use WYSIWYG

```javascript
_shouldUseWysiwyg(type) {
  // Use WYSIWYG for card descriptions, not titles
  return type === 'card-description' && 
         window.wysiwygEnabled === true;
}
```

### WYSIWYG Setup

```javascript
_setupWysiwygEditor(editElement, containerElement) {
  // Create WYSIWYG container
  const wysiwygContainer = document.createElement('div');
  wysiwygContainer.className = 'wysiwyg-editor-container';
  
  // Initialize WYSIWYG editor
  const editor = createWysiwygEditor({
    element: wysiwygContainer,
    content: editElement.value,
    onChange: (markdown) => {
      editElement.value = markdown;
      this._handleWysiwygInput(containerElement);
    }
  });
  
  // Store reference
  this.currentEditor.wysiwyg = editor;
  this.currentEditor.wysiwygContainer = wysiwygContainer;
}
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Save and close |
| `Escape` | Cancel and close |
| `Tab` | Save and move to next field |
| `Shift+Tab` | Save and move to previous field |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+B` | Bold (WYSIWYG) |
| `Ctrl+I` | Italic (WYSIWYG) |
| `Ctrl+S` | Force save |
| `*text*` | Wrap in italic |
| `` `text` `` | Wrap in code |

---

## Integration Points

### Called By
- `boardRenderer.js` → `initializeCardElement()` sets up click handlers
- `dragDrop.js` → checks `window.isEditing` before operations

### Calls
- `boardRenderer.js` → `_updateTaskDisplay()`, `_updateColumnDisplay()`
- `markdownRenderer.js` → render markdown in display
- VS Code API → `vscode.postMessage()` for undo state

---

## Migration Notes for V2

### Keep Same
- Inline editing approach
- Tab transitions
- Auto-resize
- Keyboard shortcuts

### Improve
- Better WYSIWYG integration (ProseMirror)
- Real-time collaboration support
- Better mobile support (touch)

### Modularize
- Split into:
  - `inlineEditor.js` - Core editing logic
  - `titleEditor.js` - Title-specific logic
  - `descriptionEditor.js` - Description-specific logic
  - `wysiwygIntegration.js` - WYSIWYG wrapper
