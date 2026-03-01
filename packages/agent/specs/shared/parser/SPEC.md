# Markdown Parser Specification

**File**: `src/markdownParser.ts`
**Purpose**: Parse markdown files into KanbanBoard structures
**Dependencies**: `KanbanTypes`, `PluginRegistry`

---

## UX Requirements

### File Opening
- User opens a `.md` file in VS Code
- If file has `kanban-plugin: board` in YAML frontmatter, it's a kanban board
- System parses file and displays as interactive board

### Column Detection
- User writes `## Column Title` headings
- System treats each `##` heading as a column
- Column title can contain tags and includes

### Card Detection
- User writes `- [ ] Task` or `- [x] Done` lines under columns
- System creates cards from these lines
- Multi-line descriptions are supported (indented lines after card)

### Include Expansion
- User writes `!!!include(path/file.md)!!!` in column headers
- System reads included file and expands content
- Included files can contain cards or full presentations

### Board Settings
- User adds settings in YAML frontmatter
- System extracts settings and applies to board display

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     PARSING FLOW                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Markdown File                                                  │
│   (board.md)                                                     │
│        │                                                         │
│        ▼                                                         │
│   ┌──────────────────┐                                          │
│   │ Read File        │  fs.readFileSync()                       │
│   └──────────────────┘                                          │
│        │                                                         │
│        ▼                                                         │
│   ┌──────────────────┐                                          │
│   │ Split Lines      │  content.split('\n')                     │
│   └──────────────────┘                                          │
│        │                                                         │
│        ▼                                                         │
│   ┌──────────────────┐                                          │
│   │ Parse YAML       │  Extract frontmatter                     │
│   │ Frontmatter      │  Validate kanban-plugin: board           │
│   └──────────────────┘                                          │
│        │                                                         │
│        ▼ (if valid)                                             │
│   ┌──────────────────┐                                          │
│   │ Line-by-Line     │  State machine parsing                   │
│   │ Processing       │                                          │
│   │                  │  ├── Detect ## headings → columns        │
│   │                  │  ├── Detect - [ ] cards → cards          │
│   │                  │  ├── Detect indented → descriptions      │
│   │                  │  └── Detect !!!include()!!! → includes   │
│   └──────────────────┘                                          │
│        │                                                         │
│        ▼                                                         │
│   ┌──────────────────┐                                          │
│   │ Include          │  PluginRegistry.detectIncludes()         │
│   │ Detection        │  Read include files                      │
│   └──────────────────┘                                          │
│        │                                                         │
│        ▼                                                         │
│   ┌──────────────────┐                                          │
│   │ Build Board      │  Create KanbanBoard object               │
│   │ Structure        │  Assign stable IDs                       │
│   └──────────────────┘                                          │
│        │                                                         │
│        ▼                                                         │
│   KanbanBoard                                                    │
│   { valid, title, columns, ... }                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Parsing State Machine

```typescript
enum ParseState {
  YAML_HEADER,      // Reading --- ... --- block
  BEFORE_BOARD,     // Before first ## heading
  IN_COLUMN,        // Inside a column (after ## heading)
  IN_CARD,          // Inside a card (after - [ ])
  IN_DESCRIPTION,   // Reading card description (indented lines)
  IN_FOOTER         // After all columns (non-heading content)
}
```

### State Transitions

```
                    ┌─────────────────┐
                    │  Start File     │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
              ┌────►│  YAML_HEADER    │◄─────┐
              │     └────────┬────────┘      │
              │              │               │
              │   --- found  │               │
              │              ▼               │
              │     ┌─────────────────┐      │
              │     │  BEFORE_BOARD   │      │
              │     └────────┬────────┘      │
              │              │               │
              │   ## found   │               │
              │              ▼               │
              │     ┌─────────────────┐      │
              │     │  IN_COLUMN      │──────┘
              │     └────────┬────────┘   ## found
              │              │               (new column)
              │   - [ ] found│
              │              ▼               ┌─────────────────┐
              │     ┌─────────────────┐      │  IN_COLUMN      │
              │     │  IN_CARD        │◄─────┘
              │     └────────┬────────┘
              │              │
              │   indented   │
              │   line       ▼
              │     ┌─────────────────┐
              │     │  IN_DESCRIPTION │
              │     └────────┬────────┘
              │              │
              │   non-       │
              │   indented   │
              └──────────────┘
```

---

## Data Structures

### Parse Result

```typescript
interface ParseResult {
  board: KanbanBoard;
  includedFiles: string[];      // All include files referenced
  columnIncludeFiles: string[]; // Includes from column headers
  cardIncludeFiles: string[];   // Includes from card lines
}
```

### Line Types

```typescript
type LineType = 
  | 'yaml-delimiter'    // ---
  | 'heading'           // ## Title
  | 'task-unchecked'    // - [ ] Task
  | 'task-checked'      // - [x] Task
  | 'indented'          //     Description
  | 'empty'             // (blank line)
  | 'text';             // Other content
```

---

## Functions

### Main Entry Point

```typescript
static parseMarkdown(
  content: string,
  basePath?: string,
  existingBoard?: KanbanBoard,
  mainFilePath?: string,
  resolveIncludes: boolean = true
): ParseResult
```

**Parameters:**
- `content` - Raw markdown file content
- `basePath` - Directory path for resolving relative includes
- `existingBoard` - Previous board state (for ID preservation)
- `mainFilePath` - Path to main file (for include context)
- `resolveIncludes` - Whether to read include files (default: true)

**Returns:** `ParseResult` with board and include file lists

### Include Detection

```typescript
private static detectIncludes(
  content: string,
  contextLocation: IncludeContextLocation
): string[]
```

**Uses:** `PluginRegistry.detectIncludes()`

**Context Locations:**
- `'column-header'` - In `## Title !!!include()!!!`
- `'task-title'` - In `- [ ] Card !!!include()!!!`
- `'description'` - In card description

### Column Matching

```typescript
private static findExistingColumn(
  existingBoard: KanbanBoard | undefined,
  title: string,
  columnIndex?: number,
  newTasks?: KanbanCard[]
): KanbanColumn | undefined
```

**IMPORTANT:** Matches by POSITION ONLY, never by title.
Titles can be duplicated or changed. Position determines identity.

### ID Generation

```typescript
// Uses IdGenerator for stable IDs
const id = IdGenerator.generate(content, index);
```

---

## Parsing Rules

### YAML Frontmatter

```
---
kanban-plugin: board
columnWidth: 300px
tagVisibility: all
---
```

- Must start with `---` on line 1
- Must contain `kanban-plugin: board` to be valid
- Ends with `---`
- Extracted into `board.yamlHeader` and `board.boardSettings`

### Column Headings

```markdown
## To Do

## In Progress #active

## Done !!!include(archives/done.md)!!!
```

- `##` creates a new column
- Title can contain `#tags` and `!!!include()!!!`
- Everything after `##` until next `##` belongs to this column

### Card Lines

```markdown
- [ ] Buy groceries #personal @2024-03-15
- [x] Finish report
- [ ] Multi-line card
    This is the description.
    More description here.
```

- `- [ ]` creates unchecked card
- `- [x]` creates checked card
- Indented lines after card become description
- Content includes tags, dates, links

### Include Syntax

```markdown
## Sprint Tasks !!!include(sprint.md)!!!

- [ ] Review !!!include(cards/review.md)!!!
```

- `!!!include(path)!!!` in column header includes file
- Path is relative to board file
- Included file content replaces the include

---

## Data Instances

### Input Markdown

```markdown
---
kanban-plugin: board
columnWidth: 300px
---

# Project Board

## Backlog

- [ ] Define requirements #planning
- [ ] Create mockups

## In Progress

- [x] Setup project
- [ ] Implement feature A
    This is a multi-line
    description.

## Done

- [x] Initial meeting
```

### Output Board

```json
{
  "valid": true,
  "title": "Project Board",
  "columns": [
    {
      "id": "col-0",
      "title": "Backlog",
      "cards": [
        {
          "id": "card-0-0",
          "content": "Define requirements #planning",
          "checked": false
        },
        {
          "id": "card-0-1",
          "content": "Create mockups",
          "checked": false
        }
      ]
    },
    {
      "id": "col-1",
      "title": "In Progress",
      "cards": [
        {
          "id": "card-1-0",
          "content": "Setup project",
          "checked": true
        },
        {
          "id": "card-1-1",
          "content": "Implement feature A\nThis is a multi-line\ndescription.",
          "checked": false
        }
      ]
    },
    {
      "id": "col-2",
      "title": "Done",
      "cards": [
        {
          "id": "card-2-0",
          "content": "Initial meeting",
          "checked": true
        }
      ]
    }
  ],
  "yamlHeader": "---\nkanban-plugin: board\ncolumnWidth: 300px\n---",
  "kanbanFooter": null,
  "boardSettings": {
    "columnWidth": "300px"
  }
}
```

---

## Edge Cases

### Empty Board

```markdown
---
kanban-plugin: board
---
```

Result: `board.valid = true`, `board.columns = []`

### Invalid Board (no frontmatter)

```markdown
## To Do

- [ ] Task
```

Result: `board.valid = false`

### Empty Column

```markdown
## Empty Column

## Next Column

- [ ] Task
```

Result: First column has `cards: []`

### Nested Lists (not descriptions)

```markdown
- [ ] Task
  - Nested item (NOT a description)
  - Another nested
```

These are part of the card content, not separate cards.

### Code Blocks

```markdown
- [ ] Card with code

```javascript
const x = 1;
```
```

Code blocks are preserved in card content.

---

## Integration Points

### Called By
- `KanbanFileService.readFile()` → parses file content
- `UnifiedChangeHandler` → re-parses on file change
- Export plugins → parse for export

### Calls
- `PluginRegistry.detectIncludes()` → include detection
- `IdGenerator.generate()` → ID creation
- `PathResolver.resolve()` → path resolution

---

## Migration Notes for V2

### Keep Same
- Line-by-line state machine parsing
- YAML frontmatter extraction
- Include system design

### Enhance
- Add streaming parser for large files
- Add incremental parsing (only changed sections)
- Better error messages with line numbers

### Rust Port
- Use `nom` or `pest` parser combinators
- Zero-copy parsing where possible
- Parallel include resolution
