# Lexera v2 — Data Structures Reference

Last Updated: 2026-02-24

---

## Rust Structs (lexera-core)

### lexera-core/src/types.rs

#### KanbanCard
Single card/task on the board.
```rust
pub struct KanbanCard {
    pub id: String,            // Unique ID (generated on parse)
    pub content: String,       // Full markdown content (first line = title, rest = description)
    pub checked: bool,         // Whether task is completed
    pub kid: Option<String>,   // Persistent card identity for merge (8 hex chars, embedded as <!-- kid:xxxx -->)
}
```

#### IncludeSource
Reference to an external file included in a column.
```rust
pub struct IncludeSource {
    pub raw_path: String,          // Raw path as written in markdown
    pub resolved_path: PathBuf,    // Absolute resolved path (skipped in serialization)
}
```

#### KanbanColumn
Column containing cards.
```rust
pub struct KanbanColumn {
    pub id: String,
    pub title: String,
    pub cards: Vec<KanbanCard>,
    pub include_source: Option<IncludeSource>,
}
```

#### KanbanStack (NEW — row/stack/column hierarchy)
Vertical container for columns within a row.
```rust
pub struct KanbanStack {
    pub id: String,
    pub title: String,
    pub columns: Vec<KanbanColumn>,
}
```

#### KanbanRow (NEW — row/stack/column hierarchy)
Horizontal container for stacks. Top-level board division.
```rust
pub struct KanbanRow {
    pub id: String,
    pub title: String,
    pub stacks: Vec<KanbanStack>,
}
```

#### KanbanBoard
Complete board representation supporting both legacy and new formats.
```rust
pub struct KanbanBoard {
    pub valid: bool,
    pub title: String,
    pub columns: Vec<KanbanColumn>,           // Legacy format columns (flat)
    pub rows: Vec<KanbanRow>,                 // New format hierarchy (empty for legacy)
    pub yaml_header: Option<String>,
    pub kanban_footer: Option<String>,
    pub board_settings: Option<BoardSettings>,
}
```

**Format Detection:**
- `rows` non-empty → new format (# Row / ## Stack / ### Column)
- `rows` empty, `columns` populated → legacy format (## Column with #stack tags)

#### BoardSettings
Board-wide settings parsed from YAML header.
```rust
pub struct BoardSettings {
    pub column_width: Option<String>,
    pub layout_rows: Option<u32>,
    pub max_row_height: Option<u32>,
    pub row_height: Option<String>,
    pub layout_preset: Option<String>,
    pub sticky_stack_mode: Option<String>,
    pub tag_visibility: Option<String>,
    pub card_min_height: Option<String>,
    pub font_size: Option<String>,
    pub font_family: Option<String>,
    pub whitespace: Option<String>,
    pub html_comment_render_mode: Option<String>,
    pub html_content_render_mode: Option<String>,
    pub arrow_key_focus_scroll: Option<String>,
    pub board_color: Option<String>,
    pub board_color_dark: Option<String>,
    pub board_color_light: Option<String>,
}
```

#### BoardInfo
Summary info for board list responses.
```rust
pub struct BoardInfo {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub last_modified: String,
    pub columns: Vec<ColumnSummary>,
}
```

#### ColumnSummary
```rust
pub struct ColumnSummary {
    pub index: usize,
    pub title: String,
    pub card_count: usize,
}
```

#### SearchResult
```rust
pub struct SearchResult {
    pub board_id: String,
    pub board_title: String,
    pub column_title: String,
    pub column_index: usize,
    pub card_content: String,
    pub checked: bool,
}
```

### lexera-core/src/parser.rs

#### ParseContext
Context for parsing boards with include file support.
```rust
pub struct ParseContext {
    pub include_contents: HashMap<String, String>,
    pub board_dir: PathBuf,
}
```

### lexera-core/src/storage/local.rs

#### BoardState
State for a single tracked board file.
```rust
struct BoardState {
    file_path: PathBuf,
    board: KanbanBoard,
    last_modified: SystemTime,
    content_hash: String,       // SHA-256 of file content
    version: u64,               // Incrementing version for ETag
}
```

#### LocalStorage
Local filesystem board storage with concurrency support.
```rust
pub struct LocalStorage {
    boards: RwLock<HashMap<String, BoardState>>,
    write_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    self_write_tracker: Mutex<SelfWriteTracker>,
    include_map: RwLock<IncludeMap>,
    next_version: AtomicU64,
}
```

### lexera-core/src/merge/diff.rs

#### CardSnapshot
Snapshot of card's state for comparison during merge.
```rust
pub struct CardSnapshot {
    pub kid: String,
    pub column_title: String,
    pub content: String,
    pub checked: bool,
    pub position: usize,
}
```

#### CardChange (enum)
```rust
pub enum CardChange {
    Added { kid: String, column_title: String, card: KanbanCard },
    Removed { kid: String, column_title: String },
    Modified { kid: String, column_title: String, old_content: String, new_content: String, old_checked: bool, new_checked: bool },
    Moved { kid: String, old_column: String, new_column: String },
}
```

### lexera-core/src/merge/merge.rs

#### MergeResult
```rust
pub struct MergeResult {
    pub board: KanbanBoard,
    pub conflicts: Vec<CardConflict>,
    pub auto_merged: usize,
}
```

#### CardConflict
```rust
pub struct CardConflict {
    pub card_id: String,
    pub column_title: String,
    pub field: ConflictField,
    pub base_value: String,
    pub theirs_value: String,
    pub ours_value: String,
}
```

#### ConflictField (enum)
```rust
pub enum ConflictField { Content, Checked, Position }
```

### lexera-core/src/storage/mod.rs

#### StorageError (enum)
```rust
pub enum StorageError {
    BoardNotFound(String),
    ColumnOutOfRange { index: usize, max: usize },
    InvalidBoard(String),
    Io(std::io::Error),
    ConflictDetected { board_id: String, conflicts: usize, merge_result: MergeResult },
}
```

#### BoardStorage (trait)
```rust
pub trait BoardStorage: Send + Sync {
    fn list_boards(&self) -> Vec<BoardInfo>;
    fn read_board(&self, board_id: &str) -> Option<KanbanBoard>;
    fn write_board(&self, board_id: &str, board: &KanbanBoard) -> Result<Option<MergeResult>, StorageError>;
    fn add_card(&self, board_id: &str, col_index: usize, content: &str) -> Result<(), StorageError>;
    fn search(&self, query: &str) -> Vec<SearchResult>;
}
```

---

## Rust Constants (lexera-core/src/types.rs)

```rust
pub const HIDDEN_TAG_PARKED: &str = "#hidden-internal-parked";
pub const HIDDEN_TAG_DELETED: &str = "#hidden-internal-deleted";
pub const HIDDEN_TAG_ARCHIVED: &str = "#hidden-internal-archived";

pub const BOARD_SETTING_KEYS: &[&str] = &[
    "columnWidth", "layoutRows", "maxRowHeight", "rowHeight",
    "layoutPreset", "stickyStackMode", "tagVisibility", "cardMinHeight",
    "fontSize", "fontFamily", "whitespace", "htmlCommentRenderMode",
    "htmlContentRenderMode", "arrowKeyFocusScroll", "boardColor",
    "boardColorDark", "boardColorLight",
];
```

---

## API Request/Response Types (lexera-backend/src-tauri/src/api.rs)

```rust
struct SearchQuery { q: Option<String> }
struct FileQuery { path: String }
struct ErrorResponse { error: String }
struct AddCardBody { content: String }
struct FindFileBody { filename: String }
struct ConvertPathBody { card_id: String, path: String, to: String }
```

---

## Markdown Format

### Legacy Format (## Column)
```markdown
---
kanban-plugin: board
---

## Column Title
- [ ] Card content
- [x] Checked card
  Description line

## Column 2 #stack
- [ ] Stacked column card
```

### New Format (# Row / ## Stack / ### Column)
```markdown
---
kanban-plugin: board
---

# Row Title

## Stack Title

### Column Title
- [ ] Card content
- [x] Checked card
  Description line

### Column 2
- [ ] Another card

## Stack 2

### Backlog
- [ ] Backlog item

# Row 2

## Tasks

### Errands
- [ ] Buy groceries
```

**Format Detection:** If any `# ` (h1) headings exist outside YAML/footer → new format.
**Implicit Defaults:** Content before `# ` gets implicit "Default" row; columns before `## ` get implicit "Default" stack.
