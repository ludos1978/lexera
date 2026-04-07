# Core Types Specification

**Status**: ✅ Baseline  
**V2 Target**: `lexera-core`  
**V1 Reference**: `src/board/KanbanTypes.ts`  
**Dependencies**: None (base types)

---

## UX Requirements

### Board Data Model
- User creates a markdown file with YAML frontmatter
- System parses file into structured `KanbanBoard` object
- All operations (add, edit, delete, move) work on this structure
- Structure serializes back to markdown for saving

### Card Data Model
- User writes markdown task lines: `- [ ] Task content #tag @date`
- System stores raw content plus metadata (checked state, includes)
- Include files expand card content dynamically
- Card identity (id) persists across edits

### Column Data Model
- User defines columns via `## Column Title` headings
- System groups cards under columns
- Columns can also have includes for dynamic content

---

## Data Structures

### KanbanCard

```typescript
interface KanbanCard {
  // Core fields (always present)
  id: string;              // Unique identifier (generated from content hash or UUID)
  content: string;         // Raw markdown content of the card
  
  // Checkbox state
  checked?: boolean;       // true = [x], undefined/false = [ ]
  
  // Include system (task includes)
  includeMode?: boolean;   // true when content comes from included files
  includeFiles?: string[]; // Paths to included files
  regularIncludeFiles?: string[]; // Paths for !!!include()!!! syntax
  originalTitle?: string;  // Title before include processing
  displayTitle?: string;   // Cleaned title for display
  isLoadingContent?: boolean; // Shows loading indicator
  includeError?: boolean;  // true if include file not found
  
  // Path context for image resolution
  includeContext?: {
    includeFilePath: string;  // Absolute path to include file
    includeDir: string;       // Directory of include file
    mainFilePath: string;     // Absolute path to main kanban file
    mainDir: string;          // Directory of main file
  };
}
```

### KanbanColumn

```typescript
interface KanbanColumn {
  // Core fields (always present)
  id: string;              // Unique identifier
  title: string;           // Column heading text (## Title)
  cards: KanbanCard[];     // Cards in this column
  
  // Include system (column includes)
  includeMode?: boolean;   // true when tasks come from included files
  includeFiles?: string[]; // Paths to included presentation files
  originalTitle?: string;  // Title before include processing
  displayTitle?: string;   // Cleaned title for display
  isLoadingContent?: boolean; // Shows loading indicator
  includeError?: boolean;  // true if include file not found
}
```

### BoardSettings

```typescript
interface BoardSettings {
  // Layout settings
  columnWidth?: string;     // CSS width (e.g., "300px", "20rem")
  layoutRows?: number;      // Number of rows in multi-row layout
  maxRowHeight?: string;    // CSS max-height for rows
  rowHeight?: string;       // CSS height for rows
  layoutPreset?: string;    // Preset name (e.g., "compact", "wide")
  stickyStackMode?: string; // How sticky cards stack
  
  // Display settings
  tagVisibility?: string;   // Which tags to show ("all", "none", etc.)
  cardMinHeight?: string;   // CSS min-height for cards
  fontSize?: string;        // CSS font-size
  fontFamily?: string;      // CSS font-family
  whitespace?: string;      // CSS white-space
  
  // HTML rendering
  htmlCommentRenderMode?: string; // "hidden", "visible", "block"
  htmlContentRenderMode?: string; // "raw", "escaped", "rendered"
  
  // Navigation
  arrowKeyFocusScroll?: string; // "nearest", "center", "top"
  
  // Theming
  boardColor?: string;      // Board background color
  boardColorDark?: string;  // Dark mode color
  boardColorLight?: string; // Light mode color
}
```

### KanbanBoard

```typescript
interface KanbanBoard {
  // Core fields
  valid: boolean;           // true if parsing succeeded
  title: string;            // Board title from first heading
  columns: KanbanColumn[];  // All columns
  
  // Raw markdown sections
  yamlHeader: string | null;    // Raw YAML frontmatter text
  kanbanFooter: string | null;  // Content after board section
  
  // Parsed frontmatter
  frontmatter?: Record<string, string>; // Parsed YAML key-values
  
  // Board settings (extracted from frontmatter)
  boardSettings?: BoardSettings;
}
```

---

## Data Instances

### Simple Card

```json
{
  "id": "abc123",
  "content": "Buy groceries #personal @2024-03-15",
  "checked": false
}
```

### Card with Include

```json
{
  "id": "def456",
  "content": "!!!include(tasks/sprint.md)!!!",
  "includeMode": true,
  "includeFiles": ["/path/to/tasks/sprint.md"],
  "isLoadingContent": false,
  "includeContext": {
    "includeFilePath": "/path/to/tasks/sprint.md",
    "includeDir": "/path/to/tasks",
    "mainFilePath": "/path/to/board.md",
    "mainDir": "/path/to"
  }
}
```

### Simple Column

```json
{
  "id": "col-1",
  "title": "To Do",
  "cards": [
    { "id": "card-1", "content": "Task 1", "checked": false },
    { "id": "card-2", "content": "Task 2", "checked": true }
  ]
}
```

### Column with Include

```json
{
  "id": "col-2",
  "title": "!!!include(columns/sprint.md)!!!",
  "cards": [],
  "includeMode": true,
  "includeFiles": ["/path/to/columns/sprint.md"],
  "originalTitle": "!!!include(columns/sprint.md)!!!",
  "displayTitle": "Sprint Tasks"
}
```

### Full Board

```json
{
  "valid": true,
  "title": "Project Board",
  "columns": [
    {
      "id": "col-1",
      "title": "Backlog",
      "cards": [
        { "id": "card-1", "content": "Define requirements", "checked": false }
      ]
    },
    {
      "id": "col-2", 
      "title": "In Progress",
      "cards": [
        { "id": "card-2", "content": "Implement feature", "checked": false }
      ]
    }
  ],
  "yamlHeader": "---\nkanban-plugin: basic\n---",
  "kanbanFooter": "",
  "frontmatter": {
    "kanban-plugin": "basic"
  },
  "boardSettings": {
    "columnWidth": "300px",
    "tagVisibility": "all"
  }
}
```

---

## Functions

### ID Generation

Cards and columns need unique IDs:

```typescript
// In markdownParser.ts
function generateId(content: string, index: number): string {
  // Uses content hash for stable IDs across edits
  // Falls back to index-based ID if content is empty
}
```

### Card Creation

```typescript
function createCard(content: string, checked: boolean = false): KanbanCard {
  return {
    id: generateId(content, Date.now()),
    content,
    checked
  };
}
```

### Column Creation

```typescript
function createColumn(title: string): KanbanColumn {
  return {
    id: generateId(title, Date.now()),
    title,
    cards: []
  };
}
```

### Board Validation

```typescript
function isValidBoard(board: KanbanBoard): boolean {
  return board.valid && board.columns.length > 0;
}
```

---

## Integration Points

### Parser → Types
- `markdownParser.ts` creates `KanbanBoard` from markdown
- Uses `createCard()` and `createColumn()` helpers

### Types → Storage
- `KanbanFileService` serializes `KanbanBoard` to markdown
- Reads markdown → parses → returns `KanbanBoard`

### Types → Webview
- `kanbanWebviewPanel.ts` sends `KanbanBoard` to frontend
- Frontend receives JSON and renders

### Types → Export
- Export plugins receive `KanbanBoard` for conversion
- Marp, Pandoc plugins iterate columns/cards

---

## Migration Notes for V2

### Keep Same
- Core structure (`KanbanBoard`, `KanbanColumn`, `KanbanCard`)
- ID generation approach (stable IDs)
- Settings structure

### Enhance
- Add CRDT metadata to cards (for sync)
- Add `version` field to board
- Add `lastModified` timestamp

### Add
- `richTextContent` field for WYSIWYG
- `attachments` array for embedded media
- `metadata` object for extensions
