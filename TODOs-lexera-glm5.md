# Lexera Structural Improvements Analysis

**Generated:** 2026-03-01
**Scope:** packages/lexera-core, lexera-backend, lexera-kanban, lexera-capture-ios

---

# Part I: V1 vs V2 Feature Comparison

This section compares the original VS Code extension (v1 in `src/`) with the standalone application (v2 in `packages/lexera`).

## V1 Components

V1 consists of multiple packages:
- **src/** - VS Code extension main code (~269 TypeScript files, ~113,750 LOC)
- **packages/ludos-sync/** - WebDAV/CalDAV sync server (~18 TypeScript files)
- **packages/marp-engine/** - Marp presentation export engine (~30KB JS + Python scripts)
- **packages/shared/** - Shared parser and types (referenced by ludos-sync)

## Architecture Differences

| Aspect | V1 (VS Code Extension) | V2 (Standalone App) |
|--------|------------------------|---------------------|
| **Platform** | VS Code Extension | Tauri Desktop App |
| **Language** | TypeScript (~269 files) | Rust Core + JS Frontend |
| **LOC** | ~113,750 lines TS/JS | ~10,000 lines Rust + ~18,000 lines JS |
| **UI Framework** | VS Code Webview | Native Webview + HTML |
| **Storage** | VS Code workspaceState | Rust LocalStorage + File System |
| **Collaboration** | None | CRDT (Loro) + WebSocket Sync |
| **Sync Server** | ludos-sync (WebDAV/CalDAV) | Built-in WebSocket |
| **Export Engine** | marp-engine (external) | Rust export module |

---

## Feature Matrix

### ✅ Features Present in V2

| Feature | V2 Implementation | Location |
|---------|-------------------|----------|
| Board parsing (legacy ## format) | ✅ Full | `lexera-core/src/parser.rs` |
| Board parsing (new #/##/### format) | ✅ Full | `lexera-core/src/parser.rs` |
| Card CRUD operations | ✅ Full | `lexera-backend/src/api/board.rs` |
| YAML header + board settings | ✅ Full | `lexera-core/src/types.rs` |
| Search with tag/temporal support | ✅ Full | `lexera-core/src/search.rs` |
| CRDT-based sync | ✅ Full (Loro) | `lexera-core/src/crdt/bridge.rs` |
| Three-way merge | ✅ Full | `lexera-core/src/merge/merge.rs` |
| WebSocket collaboration | ✅ Basic | `lexera-backend/src/sync_ws.rs` |
| REST API | ✅ Full | `lexera-backend/src/api/mod.rs` |
| Include file support | ✅ Basic | `lexera-core/src/include/` |
| Export to Marp presentations | ✅ Full | `lexera-core/src/export/presentation.rs` |
| Media file handling | ✅ Full | `lexera-backend/src/api/media.rs` |
| Templates | ✅ Basic | `lexera-backend/src/api/template.rs` |
| iOS capture app | ✅ Full | `lexera-capture-ios/` |
| System tray | ✅ Full | `lexera-backend/src/tray.rs` |
| Board discovery | ✅ Full | `lexera-backend/src/discovery.rs` |
| File watching | ✅ Full | `lexera-core/src/watcher/` |

### ❌ Features Missing from V2 (Present in V1)

#### 1. Plugin System
**V1 Location:** `src/plugins/` (~15 files)

**V1 Implementation:**
- `PluginRegistry` - Singleton managing plugin lifecycle
- `DiagramPlugin` interface - Mermaid, PlantUML, DrawIO, PDF, EPUB, XLSX, Excalidraw, Document
- `ExportPlugin` interface - Marp, Pandoc exporters
- `ImportPlugin` interface - Column include detection
- `EmbedPlugin` interface - Embed rendering

**V2 Status:** Not implemented. Export is hardcoded.

**Impact:** High - No extensibility for diagram formats or custom exporters.

**Recommendation:** Implement plugin registry based on Priority 2.1-2.3 in Part II.

---

#### 2. Full WYSIWYG Editor
**V1 Location:** `src/wysiwyg/` (~17 files, ~75KB)

**V1 Implementation:**
- `pipeline.ts` - Markdown ↔ WysiwygDoc conversion
- `prosemirrorSchema.ts` - Full ProseMirror schema (doc, paragraph, heading, list, code_block, image, etc.)
- `nodeViews.ts` - Custom node views for media_inline, media_block, diagram_fence
- `normalizer.ts` - Content normalization rules
- `inputRules.ts` - Markdown shortcuts (`, **, __, etc.)
- `tokenParser.ts` - Markdown-it token to ProseMirror conversion
- `serializer.ts` - ProseMirror to Markdown serialization

**V2 Status:** Stub only - `wysiwyg-editor.js` is 58 lines with minimal implementation.

**Missing in V2:**
- Full ProseMirror schema with all node types
- Custom node views for embedded content
- Input rules for markdown shortcuts
- Content normalization
- Markdown round-trip conversion

**Impact:** High - Rich editing experience is core feature.

**Recommendation:** Port v1 WYSIWYG system or implement from scratch based on v1 architecture.

---

#### 3. Dashboard Scanner
**V1 Location:** `src/dashboard/DashboardScanner.ts` (~700 lines)

**V1 Implementation:**
- Temporal tag extraction and resolution
- Upcoming items calculation with timeframe filtering
- Recurring task classification (overdue, outdated, resetToRepeat, future)
- Calendar event detection
- Undated task collection
- Tag-based search

**V2 Status:** Not implemented. Frontend has `LexeraDashboard` stub but no scanning logic.

**Impact:** Medium - Dashboard is key for task overview.

**Recommendation:** Port `DashboardScanner.ts` logic to Rust in `lexera-core/src/dashboard/`.

---

#### 4. Gather Query Engine
**V1 Location:** `src/board/GatherQueryEngine.ts` (~400 lines)

**V1 Implementation:**
- Query syntax in column titles: `?#tag`, `?@temporal`, `?.today`
- Automatic task sorting based on gather rules
- `#ungathered` collection for unmatched tasks
- Sticky task support (tasks that shouldn't move)
- Date-based filtering

**V2 Status:** Not implemented.

**Impact:** Medium - Automatic organization is powerful feature.

**Recommendation:** Port to `lexera-core/src/gather.rs` and expose via API.

---

#### 5. Change State Machine
**V1 Location:** `src/core/ChangeStateMachine.ts` (~700 lines)

**V1 Implementation:**
- Unified entry point for all file changes
- State machine with states: IDLE, READING, PROCESSING, WRITING
- Event queue for sequential processing
- Handles: file_system_change, user_edit, save, include_switch
- Conflict detection and resolution
- Debouncing and coalescing

**V2 Status:** Not implemented. Changes go directly to storage.

**Impact:** Medium - Complex change scenarios may cause issues.

**Recommendation:** Implement state machine in backend for robust file handling.

---

#### 6. Board Registry Service
**V1 Location:** `src/services/BoardRegistryService.ts` (~900 lines)

**V1 Implementation:**
- Board list management with custom ordering
- Board locking
- Search history (recent + pinned)
- Calendar sharing configuration
- File watchers per board
- Event emitters for UI updates

**V2 Status:** Partial - `lexera-core/src/storage/local.rs` has basic board list, but no:
- Custom ordering
- Search history
- Calendar sharing
- Per-board file watchers

**Impact:** Medium - Board management UX.

**Recommendation:** Extend `LocalStorage` with registry features.

---

#### 7. Keybinding Service
**V1 Location:** `src/services/KeybindingService.ts` (~400 lines)

**V1 Implementation:**
- VS Code keybinding discovery from `keybindings.json`
- Snippet resolution
- Command palette integration
- Extension shortcut loading
- Normalization of key formats

**V2 Status:** Not implemented. Frontend has basic keyboard handling inline.

**Impact:** Low - Nice to have for power users.

**Recommendation:** Implement `KeyboardManager` module in frontend.

---

#### 8. Clipboard Commands
**V1 Location:** `src/commands/ClipboardCommands.ts` (~1,200 lines)

**V1 Implementation:**
- Copy/paste cards with markdown formatting
- Cross-board card movement
- Multi-select operations
- Card link generation
- Image paste handling

**V2 Status:** Basic clipboard only, no special formatting.

**Impact:** Medium - Power user feature.

**Recommendation:** Implement clipboard module in frontend.

---

#### 9. Diagram Commands
**V1 Location:** `src/commands/DiagramCommands.ts` (~1,000 lines)

**V1 Implementation:**
- Mermaid diagram generation commands
- PlantUML diagram generation
- Export diagram to image
- Webview-based diagram preview
- Diagram insertion into cards

**V2 Status:** Not implemented.

**Impact:** Medium - Important for technical users.

**Recommendation:** Implement via plugin system (see Priority 2.3).

---

#### 10. Archive/Date Commands
**V1 Location:** `src/commands/ArchiveCommands.ts`, `src/commands/CardCommands.ts`

**V1 Implementation:**
- Archive completed cards
- Move cards to archive column
- Date-based archiving
- Bulk archive operations

**V2 Status:** Not implemented.

**Impact:** Low - Can be done manually.

**Recommendation:** Add archive API endpoint and frontend buttons.

---

#### 11. Link Handling
**V1 Location:** `src/services/LinkHandler.ts` (~800 lines), `src/services/LinkReplacementService.ts` (~1,000 lines)

**V1 Implementation:**
- Wiki link resolution `[[filename]]`
- Relative path handling
- Link validation
- Link replacement on file move/rename
- Media link tracking

**V2 Status:** Basic link rendering only.

**Impact:** Medium - Wiki-style linking is powerful.

**Recommendation:** Port link handling to `lexera-core/src/links.rs`.

---

#### 12. Backup Manager
**V1 Location:** `src/services/BackupManager.ts` (~400 lines)

**V1 Implementation:**
- Automatic backup before saves
- Backup rotation (keep last N)
- Backup restoration
- Conflict file handling

**V2 Status:** Not implemented.

**Impact:** Medium - Data safety.

**Recommendation:** Add backup logic to `LocalStorage::write_board`.

---

#### 13. Workspace Media Index
**V1 Location:** `src/services/WorkspaceMediaIndex.ts` (~700 lines)

**V1 Implementation:**
- Scan workspace for media files
- Build media index for autocomplete
- Track media usage across boards
- Media file preview

**V2 Status:** Not implemented.

**Impact:** Low - Convenience feature.

**Recommendation:** Add media search endpoint if needed.

---

#### 14. Card Editor (HTML-based)
**V1 Location:** `src/html/cardEditor.js` (~59KB minified)

**V1 Implementation:**
- In-card editing with markdown-it
- Checkbox toggle handling
- Inline date picker
- Tag autocomplete
- Card content preview

**V2 Status:** Basic inline editing only.

**Impact:** Medium - Editing UX.

**Recommendation:** Port card editor or implement equivalent.

---

#### 15. Webview Update Service
**V1 Location:** `src/services/WebviewUpdateService.ts` (~500 lines)

**V1 Implementation:**
- Debounced webview updates
- Message batching
- State synchronization
- Performance optimization

**V2 Status:** Direct updates, no batching.

**Impact:** Low - Performance optimization.

**Recommendation:** Add if performance issues arise.

---

#### 16. iCal Mapping
**V1 Location:** `src/dashboard/IcalMapper.ts`

**V1 Implementation:**
- Export board to iCal format
- Temporal tag to VEVENT mapping
- Calendar subscription support

**V2 Status:** Not implemented.

**Impact:** Low - Calendar integration.

**Recommendation:** Add `lexera-core/src/export/ical.rs` if needed.

---

### 🟡 Features Partially Implemented in V2

| Feature | V1 | V2 | Gap |
|---------|----|----|----|
| Export | Multiple formats (Marp, Pandoc, Markdown) | Marp only | Add Pandoc support |
| Templates | Full template system with variables | Basic template copy | Add variable substitution |
| Include files | Full include resolution + sync | Include parsing only | Add sync |
| Search | Full-text + tag + temporal | Full-text + tag + temporal | ✅ Complete |
| Media handling | Upload + serve + preview | Upload + serve | Add preview |

---

## packages/ludos-sync Features (V1 Sync Server)

The `packages/ludos-sync` package provides external sync capabilities that should be integrated into v2:

### 17. WebDAV Bookmark Sync
**V1 Location:** `packages/ludos-sync/src/adapters/`, `src/mappers/XbelMapper.ts`

**V1 Implementation:**
- `BookmarkAdapter` - Nephele WebDAV adapter for Floccus sync
- `XbelMapper` - Bidirectional XBEL ↔ KanbanColumn conversion
  - Folders → Columns (with path flattening)
  - Bookmarks → Cards with `[Title](url "xbel-id")` format
  - XBEL ID stored in link title attribute
  - `#stack` tag for grouping columns from same folder
- WebDAV server at `/bookmarks/` endpoint
- ETag-based change detection
- Mutex-protected read-modify-write for concurrent access

**V2 Status:** Not implemented.

**Impact:** Medium - Browser bookmark sync is powerful integration.

**Recommendation:** Port WebDAV adapter to `lexera-backend/src/webdav/` (TypeScript → Rust).

---

### 18. CalDAV Calendar Sync
**V1 Location:** `packages/ludos-sync/src/middleware/caldavMiddleware.ts`, `src/mappers/IcalMapper.ts`

**V1 Implementation:**
- Full CalDAV protocol support (PROPFIND, REPORT, calendar-multiget, calendar-query)
- `IcalMapper` - Kanban → iCalendar conversion
  - Temporal tags → VEVENT components
  - Time range parsing (`@09:00-17:00`)
  - Week tags → week-spanning events
  - Checkbox state → STATUS:COMPLETED/CONFIRMED
  - #tags → CATEGORIES
  - SHA-256 based stable UIDs
- Calendar discovery via `/.well-known/caldav`
- Multiple calendar support (per-board or workspace-wide)
- Read-only mode with PROPPATCH acknowledgment
- Time-range filtering for calendar-query

**V2 Status:** Not implemented.

**Impact:** High - Calendar integration is key for task management.

**Recommendation:** Port `IcalMapper` to `lexera-core/src/export/ical.rs` and add CalDAV endpoint to backend.

---

### 19. Sync REST API
**V1 Location:** `packages/ludos-sync/src/middleware/apiMiddleware.ts`

**V1 Implementation:**
- `GET /boards` - List all boards with column summaries
- `GET /boards/:boardId/columns` - Full column data with cards
- `POST /boards/:boardId/columns/:colIndex/cards` - Add card
- `GET /search?q=term` - Cross-board search
- Deterministic board IDs (SHA-256 hash of file path)
- CORS headers for Tauri webview

**V2 Status:** Fully implemented in `lexera-backend/src/api/`.

**Impact:** N/A - Already in v2.

---

### 20. Board File Watcher
**V1 Location:** `packages/ludos-sync/src/fileWatcher.ts`

**V1 Implementation:**
- Chokidar-based file watching with debouncing
- Multi-board support with per-board state
- XBEL and iCal cache generation
- Self-write suppression (prevents feedback loops)
- Mutex-protected concurrent access
- Automatic empty board creation
- ETag computation for change detection

**V2 Status:** Implemented in `lexera-core/src/watcher/`.

**Impact:** N/A - Already in v2.

---

### 21. Client Tracking
**V1 Location:** `packages/ludos-sync/src/clientTracker.ts`

**V1 Implementation:**
- Process name resolution via `lsof`
- Connection tracking with access history
- Recent clients list for debugging

**V2 Status:** Not implemented.

**Impact:** Low - Debugging aid.

**Recommendation:** Optional - add if needed for debugging.

---

### 22. Localhost Authentication
**V1 Location:** `packages/ludos-sync/src/auth/LocalhostAuth.ts`

**V1 Implementation:**
- IP-based localhost verification
- Optional Basic Auth when credentials configured
- Rejects non-localhost connections

**V2 Status:** Partial - v2 has auth service but different implementation.

**Impact:** Medium - Security baseline.

**Recommendation:** Port localhost check to v2 auth.

---

## packages/marp-engine Features (V1 Export Engine)

The `packages/marp-engine` package is a sophisticated Marp presentation engine that should be reused in v2:

### 23. Marp Presentation Engine
**V1 Location:** `packages/marp-engine/engine/engine.js` (~30KB)

**V1 Implementation:**

**Core Plugins:**
- `yamlStrippingIncludePlugin` - Strips YAML from `!!!include()!!!` files
- `speakerNotePlugin` - Converts `;;` lines to `<!-- -->` comments
- `marpitFragmentedTableRowPlugin` - Fragmented table rows
- `_fragment_plus` - `+` list items become fragments
- `_customImageCaption` - Image title → `<figure>/<figcaption>`

**Markdown Extensions:**
- `markdown-it-include` - `!!!include(path)!!!` syntax
- `markdown-it-strikethrough-alt` - `--strikethrough--`
- `markdown-it-underline` - `_underline_`
- `markdown-it-sub` - `H~2~O`
- `markdown-it-sup` - `29^th^`
- `markdown-it-mark` - `==marked==`
- `markdown-it-ins` - `++inserted++`
- `markdown-it-multicolumn` - `---:1 / :--:2 / :---` columns
- `markdown-it-abbr` - Abbreviations
- `markdown-it-footnote-here` - Footnotes
- `markdown-it-anchor` - Heading IDs
- `markdown-it-toc-done-right` - `[toc]` table of contents
- `markdown-it-checkboxes` - `[ ]` / `[x]` checkboxes
- `markdown-it-deflist` - Definition lists
- `mermaid-it` - Mermaid diagrams
- `markdown-it-media` - Video/audio embeds with posters

**Container Plugins:**
- `::: note`, `::: comment`, `::: highlight`
- `::: mark-red/green/blue/cyan/magenta/yellow`
- `::: center`, `::: center100`, `::: right`, `::: caption`
- `::: columns`, `::: columns3`
- `::: small66/50/33/25`

**V2 Status:** Minimal - v2 has basic Marp export but lacks plugins.

**Missing in V2:**
- All markdown extensions (underline, subscript, superscript, mark, insert)
- Multicolumn support
- Image captions
- Fragment support (`+` lists, table rows)
- Speaker notes (`;;` syntax)
- Custom containers
- Mermaid diagram rendering
- Media embeds

**Impact:** High - Export quality depends on these features.

**Recommendation:** Port `engine.js` configuration to v2 or call marp-engine as subprocess.

---

### 24. Handout Generator
**V1 Location:** `packages/marp-engine/engine/engine.js` (HandoutTransformer)

**V1 Implementation:**
- Environment variable triggered (`MARP_HANDOUT=true`)
- Options via env vars:
  - `MARP_HANDOUT_LAYOUT` - portrait/landscape
  - `MARP_HANDOUT_NOTES_POSITION` - below/beside
  - `MARP_HANDOUT_SLIDES_PER_PAGE` - 1, 2, 3, 4, 6
  - `MARP_HANDOUT_DIRECTION` - horizontal/vertical
  - `MARP_HANDOUT_WRITING_SPACE` - Add lined space
- Multi-slide grid layouts
- Print-optimized CSS with page breaks
- Notes formatting with markdown support

**V2 Status:** Not implemented.

**Impact:** Medium - Useful for printing presentations.

**Recommendation:** Port HandoutTransformer to v2 export module.

---

### 25. Python Export Scripts
**V1 Location:** `packages/marp-engine/bin/`

**V1 Implementation:**
- `marped.py` (~15KB) - Main Marp CLI wrapper
- `marped2html.py` - HTML export
- `marped2pdf.py` - PDF export
- `marped2pdfComments.py` - PDF with comments
- `marped2pptx.py` - PowerPoint export
- `marpedConverter.py` - Batch conversion

**Features:**
- Theme selection
- PDF export with Puppeteer
- PPTX export with python-pptx
- Batch processing
- Custom CSS injection

**V2 Status:** Not implemented.

**Impact:** Medium - Multiple export formats needed.

**Recommendation:** Port PDF/PPTX export to Rust or call Python scripts.

---

## Code Size Comparison

| Component | V1 (TypeScript) | V2 (Rust) | V2 (JS) |
|-----------|-----------------|-----------|---------|
| Parser | ~800 lines | ~1,050 lines | - |
| Types | ~400 lines | ~275 lines | - |
| Storage | ~600 lines | ~1,700 lines | - |
| Search | ~400 lines | ~615 lines | - |
| Export | ~1,200 lines | ~2,100 lines | ~570 lines |
| Merge | - | ~590 lines | - |
| CRDT | - | ~1,090 lines | - |
| API | - | ~650 lines | ~700 lines |
| **Core Total** | ~3,400 lines | ~10,000 lines | - |
| **Frontend Total** | ~75,000 lines | - | ~18,000 lines |
| **Backend Total** | - | ~6,300 lines | - |

---

## Migration Recommendations

### Must Port (High Impact)

1. **WYSIWYG Editor** - Core feature, v2 stub is insufficient
2. **Dashboard Scanner** - Essential for task overview
3. **Plugin System** - Required for extensibility
4. **Gather Query Engine** - Automatic organization

### Should Port (Medium Impact)

5. **Change State Machine** - Robustness
6. **Board Registry** - UX improvements
7. **Link Handling** - Wiki links
8. **Clipboard Commands** - Power user features
9. **Backup Manager** - Data safety

### Nice to Have (Low Impact)

10. Keybinding Service
11. Diagram Commands (via plugins)
12. Archive Commands
13. Workspace Media Index
14. iCal Export
15. Webview Update Service

---

# Part II: Structural Improvements

## Executive Summary

This analysis identifies structural improvements for stability, extensibility, and plugin-based feature expansion while keeping complexity minimal. The codebase has solid foundations (Rust core, CRDT sync, clean API layer) but several areas need attention.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        lexera-kanban (Frontend)                      │
│  Tauri app · app.js (14,700 LOC) · WYSIWYG · Export · Templates     │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ REST API + WebSocket
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       lexera-backend (Tauri + Axum)                  │
│  HTTP Server · SSE · WS Sync · Auth · Discovery · Capture · Tray    │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ Uses
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        lexera-core (Rust Library)                    │
│  Parser · Types · CRDT Bridge · Merge · Storage · Search · Export   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Priority 1: Stability Fixes (Critical)

### 1.1 CRDT Bridge Error Handling

**Problem:** 41+ `unwrap()` calls in `crdt/bridge.rs` can cause silent panics.

**Location:** `packages/lexera-core/src/crdt/bridge.rs`

**Current State:**
```rust
card_map.insert("kid", kid.as_str()).map_err(loro_err)?;  // Good
card_map.insert("content", content.as_str()).map_err(loro_err)?;  // Good
// But many Loro operations still use .unwrap() internally
```

**Recommendation:**
- Replace all `unwrap()` with proper `Result` propagation
- Add recovery fallback: rebuild CRDT from `.md` if `.crdt` is corrupted
- Add logging before any potential panic point

**Impact:** High - prevents data loss from silent crashes

---

### 1.2 iOS Storage Lock Poisoning

**Problem:** 12 `RwLock::unwrap()` calls can crash the app if any thread panics.

**Location:** `packages/lexera-capture-ios/src/ios_storage.rs`

**Current State:**
```rust
let boards = self.boards.read().unwrap();  // Crashes if lock poisoned
```

**Recommendation:**
```rust
let boards = self.boards.read().unwrap_or_else(|p| p.into_inner());
```

**Impact:** High - iOS app stability

---

### 1.3 Frontend Monolith Decomposition

**Problem:** `app.js` is 14,700 lines with 50+ global mutable variables.

**Location:** `packages/lexera-kanban/src/app.js`

**Current Issues:**
- Untestable (no unit tests exist)
- High cognitive load for modifications
- Implicit script load order dependencies
- Memory leak potential (event listeners without cleanup)

**Recommendation - Split into modules:**

```
src/
├── modules/
│   ├── boardManager.js      # Board state, loading, saving
│   ├── cardManager.js       # Card CRUD, editing
│   ├── dragDrop.js          # DnD handlers, drop targets
│   ├── syncManager.js       # WebSocket, SSE, reconnection
│   ├── uiManager.js         # Theme, panels, modals
│   ├── keyboardManager.js   # Shortcuts, focus
│   ├── sidebarManager.js    # Board list, hierarchy
│   ├── exportManager.js     # Export pipeline
│   └── analytics.js         # Dashboard, search
├── app.js                   # Orchestration only
└── api.js                   # HTTP client (already clean)
```

**Impact:** High - enables testing, reduces bugs, improves maintainability

---

## Priority 2: Plugin Architecture (Extensibility)

### 2.1 Export Pipeline Plugin System

**Problem:** Export is hardcoded to Marp/Pandoc. Adding new exporters requires code changes.

**Current State:** `exportService.js` has hardcoded format handling.

**Recommendation - Plugin Interface:**

```javascript
// Exporter plugin contract
interface ExporterPlugin {
  name: string;
  formats: string[];
  checkAvailable(): Promise<{available: boolean, version?: string}>;
  export(options: ExportOptions): Promise<ExportResult>;
  preview?(options: PreviewOptions): Promise<void>;
}

// Plugin registry
class ExportPluginRegistry {
  private exporters: Map<string, ExporterPlugin> = new Map();
  
  register(plugin: ExporterPlugin) { ... }
  getForFormat(format: string): ExporterPlugin | undefined { ... }
}
```

**Implementation:**
1. Create `ExportPluginRegistry` singleton
2. Refactor `ExportService` to use registry
3. Create built-in plugins: `MarpPlugin`, `PandocPlugin`, `MarkdownPlugin`
4. Allow external plugins via Tauri commands or config

**Impact:** Medium - enables third-party exporters without core changes

---

### 2.2 Backend API Extension Points

**Problem:** Adding new API endpoints requires modifying `api/mod.rs`.

**Recommendation - Router Composition:**

```rust
// packages/lexera-backend/src-tauri/src/api/plugin.rs

/// Trait for API plugins
pub trait ApiPlugin: Send + Sync {
    fn name(&self) -> &str;
    fn routes(&self) -> Router<AppState>;
    fn on_load(&self, state: &AppState) -> Result<(), Box<dyn std::error::Error>> { Ok(()) }
}

/// Plugin registry
pub struct ApiPluginRegistry {
    plugins: Vec<Box<dyn ApiPlugin>>,
}

impl ApiPluginRegistry {
    pub fn register(&mut self, plugin: Box<dyn ApiPlugin>) { ... }
    pub fn build_router(&self) -> Router<AppState> {
        let mut router = Router::new();
        for plugin in &self.plugins {
            router = router.merge(plugin.routes());
        }
        router
    }
}
```

**Usage:**
```rust
// Built-in plugins
registry.register(Box::new(BoardApiPlugin::new()));
registry.register(Box::new(MediaApiPlugin::new()));
registry.register(Box::new(SearchApiPlugin::new()));
registry.register(Box::new(CollabApiPlugin::new()));

// Third-party plugin (future)
registry.register(Box::new(CustomIntegrationPlugin::from_config(&config)?));
```

**Impact:** Medium - enables future integrations without core changes

---

### 2.3 Content Renderer Plugins

**Problem:** Markdown rendering has hardcoded handlers for images, links, embeds.

**Current State:** `app.js` has inline rendering logic for mermaid, plantuml, embeds.

**Recommendation - Renderer Plugin Interface:**

```javascript
interface ContentRendererPlugin {
  name: string;
  // Return true if this plugin handles the element
  canRender(element: MarkdownElement): boolean;
  // Render the element to HTML
  render(element: MarkdownElement, context: RenderContext): string | Promise<string>;
  // Priority (higher = checked first)
  priority: number;
}

class RendererRegistry {
  private plugins: ContentRendererPlugin[] = [];
  
  register(plugin: ContentRendererPlugin) { ... }
  async renderElement(element: MarkdownElement): Promise<string> { ... }
}
```

**Built-in Plugins:**
- `ImageRenderer` - standard images
- `LinkRenderer` - standard links, wiki links
- `EmbedRenderer` - iframes, web previews
- `MermaidRenderer` - mermaid diagrams
- `PlantUmlRenderer` - plantuml diagrams
- `CodeRenderer` - syntax highlighted code

**Impact:** Medium - enables custom content types

---

## Priority 3: Data Layer Improvements

### 3.1 Collaboration State Persistence

**Problem:** All collaboration services (auth, invites, public rooms) are in-memory and lost on restart.

**Current State:**
```rust
let auth_service = Arc::new(std::sync::Mutex::new(AuthService::new()));  // Empty on restart
let invite_service = Arc::new(std::sync::Mutex::new(InviteService::new()));
let public_service = Arc::new(std::sync::Mutex::new(PublicRoomService::new()));
```

**Recommendation:**

1. **Create persistence files:**
   - `~/.config/lexera/collab/auth.json` - users, room memberships
   - `~/.config/lexera/collab/invites.json` - pending invites
   - `~/.config/lexera/collab/rooms.json` - public room settings

2. **Load on startup:**
```rust
let auth_service = Arc::new(std::sync::Mutex::new(
    AuthService::load_from_file(&auth_path)
        .unwrap_or_else(|_| AuthService::new())
));
```

3. **Save on changes (debounced):**
```rust
// Periodic save every 60s (already implemented for some services)
// Add save on shutdown via tauri::run_on_main_thread
```

**Impact:** High - enables real multi-user testing

---

### 3.2 Include File Sync

**Problem:** Include files (`!!!include(path)!!!`) are tracked locally but not synced between peers.

**Current State:** `IncludeMap` tracks board→include relationships but WebSocket sync only handles main board CRDT.

**Recommendation:**

1. **Extend WebSocket protocol:**
```rust
enum SyncMessage {
    // Existing
    ClientHello { ... },
    ClientUpdate { updates: Vec<u8> },
    // New
    IncludeUpdate {
        board_id: String,
        include_path: String,
        content: String,  // or CRDT bytes
    },
    IncludeRequest {
        board_id: String,
        include_path: String,
    },
}
```

2. **Hash-based deduplication:**
   - Compute SHA-256 of include content
   - Only sync if hash differs

3. **On-demand pull:**
   - When client sees unknown include path, request it

**Impact:** Medium - complete board sync experience

---

### 3.3 CRDT Metadata Integration

**Problem:** YAML header, footer, and board settings are stored outside CRDT.

**Current State:**
```rust
pub struct CrdtStore {
    doc: LoroDoc,
    undo_mgr: UndoManager,
    // Stored separately, not synced
    yaml_header: Option<String>,
    kanban_footer: Option<String>,
    board_settings: Option<BoardSettings>,
}
```

**Recommendation (Phase 2):**

Move metadata into CRDT document:
```rust
fn from_board(board: &KanbanBoard) -> io::Result<Self> {
    let root = doc.get_map("root");
    root.insert("title", board.title.as_str())?;
    
    // Add metadata
    let meta = root.insert_container("meta", LoroMap::new())?;
    meta.insert("yamlHeader", board.yaml_header.as_deref().unwrap_or(""))?;
    meta.insert("kanbanFooter", board.kanban_footer.as_deref().unwrap_or(""))?;
    // Settings as nested map
    let settings = meta.insert_container("settings", LoroMap::new())?;
    // ... populate settings fields
}
```

**Impact:** Medium - collaborative settings editing

---

## Priority 4: Security Hardening

### 4.1 Authentication System

**Problem:** No authentication - uses `?user=` query parameter for identity.

**Current State:**
```rust
let authorized = match state.auth_service.lock() {
    Ok(auth) => auth.is_member(&board_id, auth_user),  // Just checks membership, not auth
    Err(_) => false,
};
```

**Recommendation:**

1. **JWT-based sessions:**
```rust
// On login/invite acceptance
let token = jwt::encode(&Claims { user_id, exp, ... }, &secret);
// Store token in frontend localStorage
// Send as Authorization: Bearer <token>
```

2. **Token validation middleware:**
```rust
async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let token = req.headers()
        .get(AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));
    
    let claims = validate_token(token)?;
    req.extensions_mut().insert(claims);
    Ok(next.run(req).await)
}
```

**Impact:** High - required for network exposure

---

### 4.2 CORS Restriction

**Problem:** CORS allows any origin.

**Location:** `packages/lexera-backend/src-tauri/src/server.rs:20`

**Current State:**
```rust
.layer(CorsLayer::new().allow_origin(Any))
```

**Recommendation:**
```rust
.layer(CorsLayer::new()
    .allow_origin([
        "http://localhost:*".parse().unwrap(),
        "tauri://localhost".parse().unwrap(),
        format!("http://127.0.0.1:{}", port).parse().unwrap(),
    ])
    .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
    .allow_headers([CONTENT_TYPE, AUTHORIZATION])
)
```

**Impact:** Medium - security baseline

---

### 4.3 Path Traversal Completion

**Problem:** Path traversal check incomplete - misses `./` and URL encoding.

**Location:** `packages/lexera-backend/src-tauri/src/api/mod.rs:1026`

**Current State:**
```rust
fn has_path_traversal(input: &str) -> bool {
    let decoded = percent_decode_str(input).decode_utf8_lossy();
    decoded.contains("..") || decoded.contains('/') || decoded.contains('\\')
}
```

**Issues:**
- `./` prefix not caught
- `/./` in path not caught
- Double URL encoding bypass

**Recommendation:**
```rust
fn has_path_traversal(input: &str) -> bool {
    // Decode repeatedly until stable
    let mut decoded = input.to_string();
    for _ in 0..3 {
        let next = percent_decode_str(&decoded).decode_utf8_lossy().to_string();
        if next == decoded { break; }
        decoded = next;
    }
    
    decoded.contains("..")
        || decoded.contains('/')
        || decoded.contains('\\')
        || decoded.starts_with("./")
        || decoded.contains("/./")
}
```

**Impact:** Medium - security

---

## Priority 5: Performance & UX

### 5.1 Frontend Virtual Scrolling

**Problem:** Large boards (1000+ cards) cause performance issues.

**Current State:** All cards rendered to DOM regardless of viewport.

**Recommendation:**
- Implement virtual scrolling for columns
- Only render visible cards + buffer
- Use `IntersectionObserver` for lazy card content rendering

**Impact:** Medium - enables large boards

---

### 5.2 WebSocket Reconnection Strategy

**Problem:** Fixed 1.5s reconnection interval, no backoff.

**Location:** `packages/lexera-kanban/src/api.js`

**Current State:**
```javascript
setTimeout(connectBackendLogStreamIfReady, 1500);
```

**Recommendation:**
```javascript
var syncReconnectAttempt = 0;

function scheduleSyncReconnect() {
    var delay = Math.min(1000 * Math.pow(2, syncReconnectAttempt), 30000);
    delay += Math.random() * 0.3 * delay;  // Jitter
    syncReconnectAttempt++;
    setTimeout(openSyncSocket, delay);
}

function onOpen() {
    syncReconnectAttempt = 0;  // Reset on success
}
```

**Impact:** Low - smoother reconnection experience

---

### 5.3 Undo/Redo Memory Optimization

**Problem:** Serializes full board state per action (up to 50MB with 100 entries).

**Location:** `packages/lexera-kanban/src/app.js`

**Current State:**
```javascript
undoStack.push(JSON.stringify(fullBoardData));
```

**Recommendation:**
- Use CRDT's built-in undo/redo (already available in `CrdtStore`)
- Or implement delta-based undo: store `{action, before, after}` patches

**Impact:** Low - memory efficiency

---

## Priority 6: Testing Infrastructure

### 6.1 Frontend Test Setup

**Problem:** Zero test coverage in lexera-kanban.

**Recommendation:**
1. Add Jest or Vitest
2. Add happy-dom or jsdom for DOM testing
3. Create test utilities for mocking Tauri APIs
4. Start with unit tests for utility functions

**Target Coverage:**
- `api.js` - 80% (straightforward HTTP mocking)
- `exportService.js` - 70% (mock fetch)
- Utility modules - 80%

**Impact:** Medium - enables safe refactoring

---

### 6.2 Backend Integration Tests

**Problem:** No tests for API endpoints or collaboration flows.

**Recommendation:**
```rust
#[cfg(test)]
mod integration_tests {
    use axum_test::TestServer;
    
    #[tokio::test]
    async fn test_board_crud() {
        let state = create_test_state();
        let server = TestServer::new(api_router().with_state(state)).unwrap();
        
        // Create board
        let response = server.post("/boards")
            .json(&json!({"file": "/tmp/test.md"}))
            .await;
        assert_eq!(response.status_code(), StatusCode::OK);
        
        // Read board
        // Update board
        // Delete board
    }
}
```

**Impact:** Medium - regression prevention

---

## Summary Matrix

| Improvement | Priority | Effort | Impact | Plugin-Ready |
|-------------|----------|--------|--------|--------------|
| CRDT Error Handling | 1 | Medium | High | No |
| iOS Lock Poisoning | 1 | Low | High | No |
| Frontend Modularization | 1 | High | High | Yes (enables plugins) |
| Export Plugins | 2 | Medium | Medium | Yes |
| API Plugins | 2 | Medium | Medium | Yes |
| Renderer Plugins | 2 | Medium | Medium | Yes |
| Collab Persistence | 3 | Medium | High | No |
| Include File Sync | 3 | Medium | Medium | No |
| CRDT Metadata | 3 | Medium | Medium | No |
| Authentication | 4 | High | High | No |
| CORS Fix | 4 | Low | Medium | No |
| Path Traversal | 4 | Low | Medium | No |
| Virtual Scrolling | 5 | Medium | Medium | No |
| WS Reconnection | 5 | Low | Low | No |
| Undo/Redo Memory | 5 | Low | Low | No |
| Frontend Tests | 6 | Medium | Medium | No |
| Backend Tests | 6 | Medium | Medium | No |

---

## Recommended Implementation Order

### Phase 1 (Stability)
1. CRDT error handling
2. iOS lock poisoning fix
3. Collaboration state persistence

### Phase 2 (Extensibility Foundation)
1. Frontend modularization (required for plugin system)
2. Export plugin registry
3. API plugin registry

### Phase 3 (Security)
1. Authentication system
2. CORS restriction
3. Path traversal completion

### Phase 4 (Performance & Quality)
1. Virtual scrolling
2. WebSocket reconnection backoff
3. Test infrastructure

---

## Plugin Architecture Blueprint

For features that should be pluggable:

```
┌───────────────────────────────────────────────────────────────┐
│                     Plugin Registry                            │
│  register() · get() · getAll() · onRegister() · onActivate()  │
└───────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ ExportPlugin  │    │  ApiPlugin    │    │ RendererPlugin│
│ - name        │    │  - name       │    │ - name        │
│ - formats[]   │    │  - routes()   │    │ - canRender() │
│ - export()    │    │  - onLoad()   │    │ - render()    │
│ - preview()   │    │               │    │ - priority    │
└───────────────┘    └───────────────┘    └───────────────┘
```

**Configuration-based discovery (future):**
```json
// ~/.config/lexera/plugins.json
{
  "plugins": [
    { "name": "mermaid-exporter", "path": "./plugins/mermaid", "enabled": true },
    { "name": "jira-sync", "path": "./plugins/jira", "enabled": false }
  ]
}
```

---

---

# Part III: Implementation Roadmap

## Combined Priority Matrix

Based on the v1 vs v2 feature gap and structural improvements analysis:

### Phase 1: Foundation (Weeks 1-4)

| Task | Source | Target | Effort |
|------|--------|--------|--------|
| CRDT error handling | Part II.1.1 | `crdt/bridge.rs` | 2 days |
| iOS lock poisoning | Part II.1.2 | `ios_storage.rs` | 1 day |
| Frontend modularization | Part II.1.3 | `lexera-kanban/src/` | 5 days |
| Collaboration persistence | Part II.3.1 | `lexera-backend/` | 2 days |

### Phase 2: Feature Parity - Core (Weeks 5-8)

| Task | Source | Target | Effort |
|------|--------|--------|--------|
| WYSIWYG Editor | Part I (Missing #2) | `lexera-kanban/src/wysiwyg/` | 10 days |
| Dashboard Scanner | Part I (Missing #3) | `lexera-core/src/dashboard/` | 4 days |
| Gather Query Engine | Part I (Missing #4) | `lexera-core/src/gather.rs` | 3 days |
| Backup Manager | Part I (Missing #12) | `lexera-core/src/storage/` | 2 days |

### Phase 3: Feature Parity - Export & Sync (Weeks 9-12)

| Task | Source | Target | Effort |
|------|--------|--------|--------|
| Marp Engine Plugins | Part I (#23) | `lexera-kanban/src/export/` | 5 days |
| iCal/CalDAV Sync | Part I (#18) | `lexera-core/src/export/ical.rs` | 4 days |
| Handout Generator | Part I (#24) | `lexera-core/src/export/handout.rs` | 3 days |
| WebDAV Bookmark Sync | Part I (#17) | `lexera-backend/src/webdav/` | 5 days |

### Phase 4: Extensibility (Weeks 13-16)

| Task | Source | Target | Effort |
|------|--------|--------|--------|
| Plugin System | Part I (Missing #1) + Part II.2 | Multiple | 5 days |
| Export plugins | Part II.2.1 | `lexera-kanban/src/export/` | 3 days |
| API plugins | Part II.2.2 | `lexera-backend/src/api/` | 3 days |
| Renderer plugins | Part II.2.3 | `lexera-kanban/src/renderers/` | 3 days |
| Link handling | Part I (Missing #11) | `lexera-core/src/links.rs` | 3 days |

### Phase 5: Security & Polish (Weeks 17-20)

| Task | Source | Target | Effort |
|------|--------|--------|--------|
| Authentication | Part II.4.1 | `lexera-backend/src/auth.rs` | 5 days |
| CORS fix | Part II.4.2 | `server.rs` | 0.5 days |
| Path traversal | Part II.4.3 | `api/mod.rs` | 0.5 days |
| Virtual scrolling | Part II.5.1 | `lexera-kanban/` | 3 days |
| Test infrastructure | Part II.6 | Multiple | 4 days |
| PDF/PPTX Export | Part I (#25) | `lexera-core/src/export/` | 4 days |

---

## ludos-sync Integration: Port to Rust

**Decision:** Port ludos-sync features to Rust natively (not as sidecar).

**Rationale:**
- Only ~3,500 LOC TypeScript - manageable porting effort
- Native performance for CalDAV/WebDAV
- Single binary, no Node.js dependency
- Shared types with lexera-core
- Better integration with existing Rust storage layer

**Porting Targets:**

| Feature | V1 Location | V2 Target | Effort |
|---------|-------------|-----------|--------|
| iCal Mapper | `mappers/IcalMapper.ts` | `lexera-core/src/export/ical.rs` | 3 days |
| XBEL Mapper | `mappers/XbelMapper.ts` | `lexera-core/src/export/xbel.rs` | 2 days |
| CalDAV Middleware | `middleware/caldavMiddleware.ts` | `lexera-backend/src/caldav/` | 4 days |
| WebDAV Adapter | `adapters/BookmarkAdapter.ts` | `lexera-backend/src/webdav/` | 3 days |
| Sync Server | `server.ts` | `lexera-backend/src/sync_server.rs` | 2 days |
| Localhost Auth | `auth/LocalhostAuth.ts` | `lexera-backend/src/auth/` (extend existing) | 1 day |

**Total Effort:** ~15 days

**Dependencies:**
- `ical` crate for iCal generation
- `xml-rs` or `quick-xml` for XBEL/DACL parsing
- `tower` or `warp` for CalDAV/WebDAV routing (or extend Axum)

---

## marp-engine Integration: Bundle as Sidecar

**Decision:** Bundle marp-engine with Tauri app, call as subprocess.

**Rationale:**
- ~35,000 LOC JavaScript - too large to port
- Externally maintained - updates available
- All 30+ plugins work immediately
- Handout generator included
- PDF/PPTX export via Python scripts
- Proven, battle-tested code

**Bundle Structure:**
```
lexera-kanban/
├── src/
│   └── export/
│       ├── exportService.js      # Orchestrates export
│       └── marpSidecar.js        # Spawns marp-engine process
├── sidecars/
│   └── marp-engine/              # Bundled from packages/marp-engine
│       ├── engine/
│       │   └── engine.js         # Main engine with all plugins
│       ├── bin/
│       │   └── *.py              # Python export scripts
│       ├── package.json
│       └── node_modules/         # Bundled dependencies (~50MB)
```

**Communication:**
- stdin/stdout for markdown → HTML conversion
- Command line for PDF/PPTX export (Python scripts)
- Environment variables for options (handout mode, theme, etc.)

**Example Integration:**
```javascript
// src/export/marpSidecar.js
const { spawn } = require('child_process');
const path = require('path');

async function exportToHtml(markdown, options = {}) {
  const enginePath = path.join(__dirname, '../../sidecars/marp-engine/engine');
  const child = spawn('node', [enginePath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MARP_THEME: options.theme || 'default',
      MARP_HANDOUT: options.handout ? 'true' : 'false',
    }
  });
  
  child.stdin.write(markdown);
  child.stdin.end();
  
  let html = '';
  for await (const chunk of child.stdout) {
    html += chunk;
  }
  
  return html;
}

async function exportToPdf(markdownPath, outputPath, options = {}) {
  const scriptPath = path.join(__dirname, '../../sidecars/marp-engine/bin/marped2pdf.py');
  const child = spawn('python3', [scriptPath, '--input', markdownPath, '--output', outputPath]);
  
  return new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`PDF export failed with code ${code}`));
    });
  });
}
```

**Tauri Bundle Configuration:**
```json
// tauri.conf.json
{
  "bundle": {
    "resources": [
      "sidecars/marp-engine/**/*"
    ],
    "externalBin": [
      "node",
      "python3"
    ]
  }
}
```

**Note:** Requires Node.js runtime. Options:
1. Bundle Node.js with app (+50MB)
2. Require user to install Node.js
3. Use system Node.js if available

---

## Quick Reference: Feature Gap Summary

```
V1 Features Missing in V2:
├── Critical (Must Port)
│   ├── WYSIWYG Editor ────────────── src/wysiwyg/ → NEW
│   ├── Dashboard Scanner ─────────── src/dashboard/ → lexera-core/src/dashboard/
│   ├── Plugin System ─────────────── src/plugins/ → NEW (with registry)
│   ├── Gather Query Engine ───────── src/board/ → lexera-core/src/gather.rs
│   └── Marp Engine Plugins ───────── packages/marp-engine/ → lexera-kanban/export/
│
├── Important (Should Port)
│   ├── Change State Machine ─────── src/core/ → lexera-backend/src/state_machine.rs
│   ├── Board Registry Service ───── src/services/ → lexera-core/src/storage/
│   ├── Link Handler ─────────────── src/services/ → lexera-core/src/links.rs
│   ├── Clipboard Commands ───────── src/commands/ → lexera-kanban/src/clipboard.js
│   ├── Backup Manager ───────────── src/services/ → lexera-core/src/storage/
│   ├── CalDAV/iCal Sync ─────────── packages/ludos-sync/ → PORT TO RUST
│   ├── WebDAV Bookmark Sync ─────── packages/ludos-sync/ → PORT TO RUST
│   └── Handout Generator ────────── packages/marp-engine/ → BUNDLE AS SIDECAR
│
└── Nice to Have
    ├── Keybinding Service ───────── src/services/ → lexera-kanban/src/keyboard.js
    ├── Diagram Commands ─────────── src/commands/ → via Plugin System
    ├── Archive Commands ─────────── src/commands/ → API + Frontend
    ├── Media Index ──────────────── src/services/ → Optional
    ├── Python Export Scripts ────── packages/marp-engine/bin/ → Optional subprocess
    └── Client Tracker ───────────── packages/ludos-sync/ → Debug only
```

---

## Detailed Feature Count

| Category | V1 Files | V1 LOC | V2 Status |
|----------|----------|--------|-----------|
| **Core Extension (src/)** | | | |
| ├── Board/Card/Column | ~15 | ~4,000 | ✅ Ported |
| ├── Commands | ~15 | ~25,000 | ❌ Missing |
| ├── Core State Machine | ~8 | ~3,500 | ❌ Missing |
| ├── Dashboard | ~5 | ~2,500 | ❌ Missing |
| ├── Files/Storage | ~10 | ~3,000 | ✅ Ported |
| ├── HTML UI | ~10 | ~80,000 | 🔶 Partial |
| ├── Panel/Webview | ~15 | ~5,000 | ✅ Ported |
| ├── Plugins | ~15 | ~4,000 | ❌ Missing |
| ├── Services | ~25 | ~15,000 | 🔶 Partial |
| ├── WYSIWYG | ~15 | ~15,000 | ❌ Missing |
| **packages/ludos-sync** | ~18 | ~3,500 | ❌ Missing |
| **packages/marp-engine** | ~10 | ~35,000 | 🔶 Basic |
| **TOTAL** | ~269 | ~160,000 | ~30% Ported |

---

## Export Format Comparison

| Format | V1 (marp-engine) | V2 (Rust) | Gap |
|--------|------------------|-----------|-----|
| Marp HTML | ✅ Full plugins | ✅ Basic | Missing plugins |
| Marp PDF | ✅ Puppeteer | ❌ | Need export |
| Marp PPTX | ✅ python-pptx | ❌ | Need export |
| Handout PDF | ✅ Full | ❌ | Need transformer |
| iCal | ✅ (ludos-sync) | ❌ | Need IcalMapper |
| XBEL/WebDAV | ✅ (ludos-sync) | ❌ | Need adapter |
| Pandoc | ✅ (via plugin) | ❌ | Need integration |

---

## Conclusion

The lexera v2 codebase has a solid architectural foundation with clear separation between core (Rust), backend (Tauri+Axum), and frontend. Compared to v1:

**Strengths of V2:**
- Native CRDT sync with Loro
- Clean REST API with proper error handling
- Rust core for performance and safety
- Standalone app (no VS Code dependency)
- iOS capture app
- Built-in collaboration (WebSocket sync)

**Key Gaps vs V1:**

| Area | Missing Features | Impact |
|------|------------------|--------|
| **Editor** | WYSIWYG, ProseMirror schema | High |
| **Dashboard** | Scanner, temporal resolution | High |
| **Export** | Marp plugins, PDF/PPTX, handouts | High |
| **Sync** | CalDAV, WebDAV, iCal | Medium |
| **Organization** | Gather queries, plugins | Medium |
| **Commands** | Clipboard, archive, diagram | Medium |

**External Packages to Integrate:**

1. **packages/ludos-sync** (~3,500 LOC TypeScript)
   - CalDAV calendar sync with full protocol support
   - WebDAV bookmark sync with Floccus
   - iCal generation with temporal tag mapping
   - **Recommendation: PORT TO RUST** (native performance, single binary)

2. **packages/marp-engine** (~35,000 LOC JS/Python)
   - Full Marp plugin suite (30+ markdown extensions)
   - Handout generator with multiple layouts
   - PDF/PPTX export scripts
   - **Recommendation: BUNDLE AS SIDECAR** (too large to port, externally maintained)

**Main Areas for Improvement:**

1. **Stability first** - Fix the CRDT unwraps and iOS lock poisoning before adding features
2. **Feature parity** - Port WYSIWYG, Dashboard, Gather, Marp plugins from v1
3. **Modularize frontend** - The 14,700-line app.js is the biggest maintainability risk
4. **Plugin interfaces** - Design for extensibility but implement plugins only when needed
5. **Security basics** - Auth and CORS must be addressed before any network exposure
6. **Export quality** - Integrate marp-engine for professional presentations

**Estimated Total Effort:**
- Phase 1 (Foundation): 10 days
- Phase 2 (Core Features): 19 days
- Phase 3 (Export/Sync): 17 days
- Phase 4 (Extensibility): 17 days
- Phase 5 (Polish): 17 days
- **Total: ~80 days (16 weeks)**

Keep changes minimal and focused. Each improvement should solve a specific problem without introducing unnecessary abstraction layers.

---

# Part IV: Additional V1 HTML Frontend Analysis

## V1 HTML Frontend Components (src/html/)

The V1 HTML frontend is a substantial codebase with specialized modules:

| File | Lines | Purpose |
|------|-------|---------|
| `webview.js` | 6,499 | Main webview orchestration |
| `dragDrop.js` | 6,514 | Drag and drop system |
| `boardRenderer.js` | 3,934 | Board rendering with virtual DOM |
| `menuOperations.js` | 3,989 | Unified menu system |
| `cardEditor.js` | 3,135 | Inline card editing |
| `markdownRenderer.js` | 3,806 | Markdown rendering with plugins |
| `fileManager.js` | 2,313 | File browser and management |
| `exportMarpUI.js` | 2,145 | Export dialog and settings |
| `overlayEditor.js` | 1,045 | Full-screen card editor |
| `clipboardHandler.js` | 645 | Copy/paste operations |
| `navigationHandler.js` | 409 | Keyboard navigation |
| `boardsPanel.js` | 797 | Sidebar board list |
| `templateDialog.js` | 191 | Template selection |
| `foldingStateManager.js` | 131 | Collapse state persistence |
| **Markdown Plugins** | ~2,400 | 20+ browser-adapted plugins |
| **TOTAL** | ~37,700 | |

---

## Additional Missing Features (HTML Frontend)

### 26. Board Renderer
**V1 Location:** `src/html/boardRenderer.js` (~3,934 lines)

**V1 Implementation:**
- Full board rendering with virtual DOM optimization
- Collapse/expand state management (columns, tasks)
- Card initialization with drag handles, edit handlers
- Folding state persistence across renders (`window.collapsedColumns`, `window.collapsedTasks`)
- Template bar state management
- Scroll position preservation
- Active element blur protection (prevents VS Code webview errors)
- Single column/task incremental updates (avoids full re-render)
- `initializeCardElement()` - centralized card setup

**V2 Status:** Basic rendering in `app.js`, no incremental updates.

**Impact:** High - Rendering performance and UX.

**Recommendation:** Port incremental rendering to v2.

---

### 27. Drag & Drop System
**V1 Location:** `src/html/dragDrop.js` (~6,514 lines)

**V1 Implementation:**
- Task drag with visual preview and ghost element
- Column drag and reorder
- Cross-column task moves with position tracking
- External file drops with dialog
  - File size validation (10MB limit)
  - Partial hash calculation for large files (1MB)
  - Apply-all action for batch drops
- Clipboard card drops
- Template drops
- Row/position tracking for multi-row boards
- Drop indicators via `dropIndicatorManager`
- `DragStateManager` for centralized state
- Memory-safe: guard flag prevents duplicate listeners

**V2 Status:** Basic drag/drop, no external file support.

**Impact:** High - Core interaction.

**Recommendation:** Port full drag/drop system.

---

### 28. Markdown Renderer
**V1 Location:** `src/html/markdownRenderer.js` (~3,806 lines)

**V1 Implementation:**
- **Cached markdown-it instance** for performance (~3-5ms per call saved)
- 20+ markdown-it plugins integrated
- Mermaid diagram rendering with lazy loading
- Media error handling:
  - `_handleMediaError()` - unified error handler
  - `createBrokenMediaPlaceholder()` - fallback UI with menu
  - `_handleIframeError()` - X-Frame-Options detection
- Session-level blocked origins cache for iframes
- Wiki link resolution
- Image attribute support (sizing, alignment)
- Loading placeholders for async content

**V2 Status:** Basic markdown rendering, limited plugins.

**Impact:** High - Content display quality.

**Recommendation:** Port markdown-it plugin configuration.

---

### 29. Menu Operations
**V1 Location:** `src/html/menuOperations.js` (~3,989 lines)

**V1 Implementation:**
- Unified menu system for tags, cards, columns
- Tag click menus:
  - Filter by tag
  - Search for tag
  - Rename tag across board
  - Color picker
- Card context menus:
  - Archive/delete
  - Move to column
  - Copy/paste
  - Date picker
- Column menus:
  - Column settings
  - Archive column
  - Delete column
- DOM move operations without full re-render (`moveTaskInDOM()`)
- Scroll-to-element optimization
- Save coordination with debounce

**V2 Status:** Basic menus inline in `app.js`.

**Impact:** Medium - UX consistency.

**Recommendation:** Extract menu module.

---

### 30. Export Marp UI
**V1 Location:** `src/html/exportMarpUI.js` (~2,145 lines)

**V1 Implementation:**
- Export dialog with column tree selection (`exportTreeUI`)
- Folder name generation: `{filename}-{timestamp}-{range}`
- Tag visibility filtering:
  - `all` - Export all tags
  - `allexcludinglayout` - Remove #row, #span, #stack
  - `customonly` - Only custom tags
  - `mentionsonly` - Only @mentions
  - `none` - Strip all tags
- Exclude tags input with normalization
- Auto-export mode with live preview
- Browser mode for instant preview
- Export settings persistence (localStorage)
- Marp theme selection
- PDF/HTML/PPTX format options

**V2 Status:** Basic export UI in `exportUI.js` (~570 lines).

**Impact:** Medium - Export UX.

**Recommendation:** Port full export UI.

---

### 31. Card Editor
**V1 Location:** `src/html/cardEditor.js` (~3,135 lines)

**V1 Implementation:**
- Inline card editing with contentEditable
- Title/description split editing
- Multi-line description support
- Checkbox toggle handling
- Auto-resize textarea
- Blur/enter to save
- Escape to cancel
- Change detection (prevent unnecessary saves)
- Editor state management (`window.taskEditor`)
- Transition state handling (title→description)

**V2 Status:** Basic inline editing.

**Impact:** High - Editing UX.

**Recommendation:** Port card editor.

---

### 32. File Manager
**V1 Location:** `src/html/fileManager.js` (~2,313 lines)

**V1 Implementation:**
- File browser for workspace
- Recent files list
- File type filtering
- Search within files
- Create new board from template
- Board metadata display (column count, card count)
- Keyboard navigation
- File watching for external changes

**V2 Status:** Basic board list in sidebar.

**Impact:** Medium - File management.

**Recommendation:** Port file manager.

---

### 33. Overlay Editor
**V1 Location:** `src/html/overlayEditor.js` (~1,045 lines)

**V1 Implementation:**
- Full-screen card editor overlay
- Markdown preview split view
- Syntax highlighting
- Large content handling
- Save/cancel actions
- Keyboard shortcuts (Ctrl+S, Escape)
- Z-index management

**V2 Status:** Not implemented.

**Impact:** Medium - Large card editing.

**Recommendation:** Add overlay editor.

---

### 34. Clipboard Handler
**V1 Location:** `src/html/clipboardHandler.js` (~645 lines)

**V1 Implementation:**
- Copy card as markdown
- Paste card from clipboard
- Multi-select copy
- Image paste handling (data URL, file reference)
- Text paste with smart formatting
- Clipboard data serialization

**V2 Status:** Basic clipboard.

**Impact:** Medium - Power user feature.

**Recommendation:** Port clipboard handler.

---

### 35. Navigation Handler
**V1 Location:** `src/html/navigationHandler.js` (~409 lines)

**V1 Implementation:**
- Keyboard navigation (arrow keys, tab, home, end)
- Focus management
- Column/task focus cycle
- Quick card search (type to search)
- Go to column shortcut
- Accessibility support

**V2 Status:** Basic keyboard handling.

**Impact:** Low - Accessibility.

**Recommendation:** Port navigation handler.

---

### 36. Media Tracker
**V1 Location:** `src/services/MediaTracker.ts` (~550 lines)

**V1 Implementation:**
- Track modification times of media files
- Persistent cache (`.{kanban}.mediacache.json`)
- Change detection across sessions
- Supported types:
  - Diagrams: .drawio, .dio, .excalidraw
  - Images: .png, .jpg, .gif, .svg, .webp, etc.
  - Audio: .mp3, .wav, .ogg, .m4a, .flac
  - Video: .mp4, .webm, .mov, .avi
  - Documents: .pdf, .xlsx, .epub, .docx, .pptx
- File watchers for real-time updates
- Change callback for diagram refresh

**V2 Status:** Not implemented.

**Impact:** Medium - Diagram freshness.

**Recommendation:** Add media tracking to storage layer.

---

## V1 Markdown-it Browser Plugins

V1 includes 20+ browser-adapted markdown-it plugins in `src/html/`:

| Plugin | Lines | Purpose |
|--------|-------|---------|
| `markdown-it-temporal-tag-browser.js` | 237 | @date/@time highlighting |
| `markdown-it-image-attrs-browser.js` | 212 | Image sizing `{width=100}` |
| `markdown-it-wiki-links-browser.js` | 95 | `[[link]]` syntax |
| `markdown-it-list-split-browser.js` | 169 | List split handling |
| `markdown-it-table-widths-browser.js` | 132 | Column widths |
| `markdown-it-speaker-note-browser.js` | 87 | `;;` speaker notes |
| `markdown-it-html-comment-browser.js` | 138 | HTML comment preservation |
| `markdown-it-tag-browser.js` | 115 | #tag styling |
| `markdown-it-task-checkbox-browser.js` | 85 | Task checkboxes |
| `markdown-it-enhanced-strikethrough-browser.js` | 51 | `~~strikethrough~~` |
| `markdown-it-date-person-tag-browser.js` | 59 | Date/person tags |
| `markdown-it-multicolumn-browser.js` | 139 | Multi-column layout |
| `markdown-it-container-browser.js` | 141 | Custom containers |
| `markdown-it-abbr-browser.js` | 131 | Abbreviations |
| `markdown-it-ins-browser.js` | 111 | `++inserted++` |
| `markdown-it-mark-browser.js` | 109 | `==marked==` |
| `markdown-it-strikethrough-alt-browser.js` | 93 | `--strike--` |
| `markdown-it-sub-browser.js` | 67 | `H~2~O` subscript |
| `markdown-it-sup-browser.js` | 67 | `29^th^` superscript |
| `markdown-it-underline-browser.js` | 31 | `_underline_` |
| **TOTAL** | **~2,400** | |

**V2 Status:** None of these plugins are ported.

**Impact:** High - Content rendering quality.

**Recommendation:** Port plugin configuration or use marp-engine.

---

# Part V: Complete Feature Gap Matrix

## All Missing Features Sorted by Impact

### High Impact (Must Have)

| # | Feature | V1 Location | V1 LOC | V2 Target |
|---|---------|-------------|--------|-----------|
| 1 | WYSIWYG Editor | `src/wysiwyg/` | ~15,000 | `lexera-kanban/src/wysiwyg/` |
| 2 | Dashboard Scanner | `src/dashboard/` | ~2,500 | `lexera-core/src/dashboard/` |
| 3 | Plugin System | `src/plugins/` | ~4,000 | NEW (registry) |
| 4 | Gather Query Engine | `src/board/` | ~400 | `lexera-core/src/gather.rs` |
| 5 | Marp Engine Plugins | `packages/marp-engine/` | ~35,000 | Bundle as subprocess |
| 6 | Board Renderer | `src/html/boardRenderer.js` | ~3,900 | `lexera-kanban/src/render/` |
| 7 | Drag & Drop System | `src/html/dragDrop.js` | ~6,500 | `lexera-kanban/src/dnd/` |
| 8 | Markdown Renderer | `src/html/markdownRenderer.js` | ~3,800 | `lexera-kanban/src/markdown/` |
| 9 | Card Editor | `src/html/cardEditor.js` | ~3,100 | `lexera-kanban/src/editor/` |
| 10 | Markdown-it Plugins | `src/html/markdown-it-*.js` | ~2,400 | Bundle with renderer |
| **Subtotal** | | | **~76,600** | |

### Medium Impact (Should Have)

| # | Feature | V1 Location | V1 LOC | V2 Target |
|---|---------|-------------|--------|-----------|
| 11 | Change State Machine | `src/core/` | ~3,500 | `lexera-backend/src/state_machine.rs` |
| 12 | Board Registry Service | `src/services/` | ~900 | `lexera-core/src/storage/` |
| 13 | Link Handler | `src/services/` | ~1,800 | `lexera-core/src/links.rs` |
| 14 | Clipboard Commands | `src/commands/` | ~1,200 | `lexera-kanban/src/clipboard.js` |
| 15 | Backup Manager | `src/services/` | ~400 | `lexera-core/src/storage/` |
| 16 | CalDAV/iCal Sync | `packages/ludos-sync/` | ~1,500 | PORT TO RUST |
| 17 | WebDAV Bookmark Sync | `packages/ludos-sync/` | ~800 | PORT TO RUST |
| 18 | Handout Generator | `packages/marp-engine/` | ~500 | `lexera-core/src/export/handout.rs` |
| 19 | Menu Operations | `src/html/menuOperations.js` | ~4,000 | `lexera-kanban/src/menus/` |
| 20 | Export Marp UI | `src/html/exportMarpUI.js` | ~2,100 | `lexera-kanban/src/export/` |
| 21 | File Manager | `src/html/fileManager.js` | ~2,300 | `lexera-kanban/src/files/` |
| 22 | Overlay Editor | `src/html/overlayEditor.js` | ~1,000 | `lexera-kanban/src/editor/` |
| 23 | Clipboard Handler | `src/html/clipboardHandler.js` | ~650 | `lexera-kanban/src/clipboard.js` |
| 24 | Media Tracker | `src/services/MediaTracker.ts` | ~550 | `lexera-core/src/media/` |
| **Subtotal** | | | **~22,200** | |

### Low Impact (Nice to Have)

| # | Feature | V1 Location | V1 LOC | V2 Target |
|---|---------|-------------|--------|-----------|
| 25 | Keybinding Service | `src/services/` | ~400 | `lexera-kanban/src/keyboard.js` |
| 26 | Diagram Commands | `src/commands/` | ~1,000 | Via Plugin System |
| 27 | Archive Commands | `src/commands/` | ~300 | API + Frontend |
| 28 | Navigation Handler | `src/html/navigationHandler.js` | ~400 | `lexera-kanban/src/nav.js` |
| 29 | Workspace Media Index | `src/services/` | ~700 | Optional |
| 30 | Python Export Scripts | `packages/marp-engine/bin/` | ~1,500 | Optional subprocess |
| 31 | Client Tracker | `packages/ludos-sync/` | ~200 | Debug only |
| 32 | Boards Panel | `src/html/boardsPanel.js` | ~800 | Already in v2 |
| **Subtotal** | | | **~5,300** | |

---

## Total Feature Gap Summary

| Impact | Features | V1 LOC | Priority |
|--------|----------|--------|----------|
| High | 10 | ~76,600 | Phase 2-3 |
| Medium | 14 | ~22,200 | Phase 3-4 |
| Low | 8 | ~5,300 | Phase 5 |
| **TOTAL** | **32** | **~104,100** | |

**Note:** V1 total is ~160,000 LOC. About ~56,000 LOC (35%) has been ported to v2.
The remaining ~104,000 LOC (65%) represents the feature gap.

---

## Recommended Porting Strategy

### Strategy A: Full Port (High Quality)
Port all features to Rust/JavaScript natively.

**Pros:** Native performance, single binary, shared types
**Cons:** ~80 developer-days effort

### Strategy B: Hybrid (Recommended)
- Port core features to Rust (parser, dashboard, gather, iCal)
- Bundle marp-engine as subprocess (export)
- Run ludos-sync as sidecar (WebDAV/CalDAV)
- Port HTML frontend modules directly (already JavaScript)

**Pros:** Faster implementation, proven code
**Cons:** Multiple processes, Node.js dependency for some features

### Strategy C: Minimal V2
Only port features absolutely necessary for MVP:
- WYSIWYG Editor
- Dashboard Scanner
- Basic Export (Marp HTML only)
- Basic Markdown Plugins (10 most used)

**Pros:** Fastest to market
**Cons:** Feature-poor compared to v1

---

## Final Recommendations

1. **Immediate (Week 1-4):** Fix stability issues (CRDT unwraps, iOS locks)
2. **Short-term (Week 5-8):** Modularize frontend, port WYSIWYG
3. **Medium-term (Week 9-12):** Port dashboard, gather, bundle marp-engine as sidecar
4. **Long-term (Week 13-16):** Port ludos-sync to Rust (CalDAV, WebDAV, iCal)
5. **Ongoing:** Add tests, improve documentation

**Key Success Metrics:**
- Feature parity with v1 for top 10 used features
- < 100ms board load time (1000+ cards)
- Zero data loss from panics
- Test coverage > 50% for core modules

---

# Part VI: Complete Feature Checklist (108 Features)

## Sidecar Architecture Explanation

A **sidecar** is a separate process that runs alongside the main application:

```
┌─────────────────────────────────────────────────────────────┐
│                    Tauri Main Process                        │
│  Rust Backend + JavaScript Frontend                          │
│  (lexera-core + lexera-backend + lexera-kanban)             │
│                                                              │
│  PORTED FROM ludos-sync:                                     │
│  - CalDAV middleware                                         │
│  - WebDAV adapter                                            │
│  - iCal mapper                                               │
│  - XBEL mapper                                               │
└─────────────────────────────┬───────────────────────────────┘
                              │ spawns
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
      ┌───────────────┐               ┌───────────────┐
      │  marp-engine  │               │   Python      │
      │  (Node.js)    │               │   Scripts     │
      │  SIDECAR      │               │   SIDECAR     │
      │               │               │               │
      │  - Export     │               │  - PDF        │
      │  - 30+ plugins│               │  - PPTX       │
      │  - Handouts   │               │  - Batch      │
      └───────────────┘               └───────────────┘
```

**Communication:**
- stdin/stdout for marp-engine (pass markdown, get HTML)
- Command line for Python scripts (file paths)
- CalDAV/WebDAV now native in Rust (no sidecar needed)

---

## Marp Integration: Recommended Approach

**Keep marp-engine as external package, bundle as sidecar:**

1. **Copy to Tauri bundle:**
   ```
   lexera-kanban/
   └── sidecars/
       └── marp-engine/     # Copy from packages/marp-engine
   ```

2. **Call from JavaScript:**
   ```javascript
   // src/export/marpSidecar.js
   const { spawn } = require('child_process');
   
   async function exportToMarp(markdown, format = 'html') {
     const child = spawn('node', [
       'sidecars/marp-engine/engine/cli.js',
       '--format', format
     ], { stdio: ['pipe', 'pipe', 'pipe'] });
     
     child.stdin.write(markdown);
     child.stdin.end();
     
     let output = '';
     for await (const chunk of child.stdout) {
       output += chunk;
     }
     
     return output;
   }
   ```

3. **Benefits:**
   - All 30+ plugins work immediately
   - Handout generator included
   - PDF/PPTX via Python scripts
   - Can upgrade marp-engine independently

---

## All 108 V1 Features

### Core Features (22)

| # | Feature | V1 Location | LOC | V2 Status | Port To |
|---|---------|-------------|-----|-----------|---------|
| 1 | Board Parser | `src/markdownParser.ts` | 800 | ✅ Ported | Rust |
| 2 | Board Types | `src/types.ts` | 400 | ✅ Ported | Rust |
| 3 | Card CRUD | `src/board/` | 500 | ✅ Ported | API |
| 4 | File Storage | `src/files/` | 3000 | ✅ Ported | Rust |
| 5 | YAML Header | `src/markdownParser.ts` | 200 | ✅ Ported | Rust |
| 6 | Board Settings | `src/types.ts` | 300 | ✅ Ported | Rust |
| 7 | Search | `src/services/` | 400 | ✅ Ported | Rust |
| 8 | File Watching | `src/files/` | 500 | ✅ Ported | Rust |
| 9 | WYSIWYG Editor | `src/wysiwyg/` | 15000 | ❌ Missing | JS |
| 10 | Dashboard Scanner | `src/dashboard/` | 2500 | ❌ Missing | Rust |
| 11 | Gather Query Engine | `src/board/` | 400 | ❌ Missing | Rust |
| 12 | Plugin System | `src/plugins/` | 4000 | ❌ Missing | JS |
| 13 | Change State Machine | `src/core/` | 3500 | ❌ Missing | Rust |
| 14 | Board Registry | `src/services/` | 900 | ❌ Missing | Rust |
| 15 | Link Handler | `src/services/` | 1800 | ❌ Missing | Rust |
| 16 | Backup Manager | `src/services/` | 400 | ❌ Missing | Rust |
| 17 | Keybinding Service | `src/services/` | 400 | ❌ Missing | JS |
| 18 | Media Tracker | `src/services/` | 550 | ❌ Missing | Rust |
| 19 | Workspace Media Index | `src/services/` | 700 | ❌ Missing | Rust |
| 20 | Webview Update Service | `src/services/` | 500 | ❌ Missing | JS |
| 21 | Notification Service | `src/services/` | 300 | 🔶 Partial | JS |
| 22 | Path Conversion | `src/services/` | 400 | ✅ Ported | API |

### Commands (14)

| # | Feature | V1 Location | LOC | V2 Status | Port To |
|---|---------|-------------|-----|-----------|---------|
| 23 | Archive Commands | `ArchiveCommands.ts` | 300 | ❌ Missing | API+JS |
| 24 | Card Commands | `CardCommands.ts` | 300 | 🔶 Partial | API+JS |
| 25 | Clipboard Commands | `ClipboardCommands.ts` | 1200 | ❌ Missing | JS |
| 26 | Column Commands | `ColumnCommands.ts` | 500 | 🔶 Partial | API+JS |
| 27 | Debug Commands | `DebugCommands.ts` | 2000 | ❌ Missing | Optional |
| 28 | Diagram Commands | `DiagramCommands.ts` | 1000 | ❌ Missing | Plugin |
| 29 | Edit Mode Commands | `EditModeCommands.ts` | 500 | ❌ Missing | JS |
| 30 | Export Commands | `ExportCommands.ts` | 800 | 🔶 Partial | JS |
| 31 | File Commands | `FileCommands.ts` | 500 | ✅ Ported | API |
| 32 | Include Commands | `IncludeCommands.ts` | 300 | 🔶 Partial | API |
| 33 | Path Commands | `PathCommands.ts` | 1400 | 🔶 Partial | API |
| 34 | Process Commands | `ProcessCommands.ts` | 300 | ❌ Missing | Optional |
| 35 | Template Commands | `TemplateCommands.ts` | 500 | 🔶 Partial | API |
| 36 | UI Commands | `UICommands.ts` | 500 | 🔶 Partial | JS |

### HTML Frontend (14)

| # | Feature | V1 Location | LOC | V2 Status | Port To |
|---|---------|-------------|-----|-----------|---------|
| 37 | Main Webview | `webview.js` | 6500 | 🔶 Partial | JS |
| 38 | Board Renderer | `boardRenderer.js` | 3900 | ❌ Missing | JS |
| 39 | Drag & Drop | `dragDrop.js` | 6500 | ❌ Missing | JS |
| 40 | Menu Operations | `menuOperations.js` | 4000 | ❌ Missing | JS |
| 41 | Markdown Renderer | `markdownRenderer.js` | 3800 | ❌ Missing | JS |
| 42 | Card Editor | `cardEditor.js` | 3100 | ❌ Missing | JS |
| 43 | File Manager | `fileManager.js` | 2300 | ❌ Missing | JS |
| 44 | Export Marp UI | `exportMarpUI.js` | 2100 | ❌ Missing | JS |
| 45 | Overlay Editor | `overlayEditor.js` | 1000 | ❌ Missing | JS |
| 46 | Clipboard Handler | `clipboardHandler.js` | 650 | ❌ Missing | JS |
| 47 | Navigation Handler | `navigationHandler.js` | 400 | ❌ Missing | JS |
| 48 | Boards Panel | `boardsPanel.js` | 800 | ✅ Ported | JS |
| 49 | Template Dialog | `templateDialog.js` | 200 | ✅ Ported | JS |
| 50 | Folding State Manager | `foldingStateManager.js` | 130 | ❌ Missing | JS |

### Markdown Plugins (20)

| # | Plugin | LOC | V2 Status | Priority |
|---|--------|-----|-----------|----------|
| 51 | temporal-tag | 237 | ❌ Missing | HIGH |
| 52 | image-attrs | 212 | ❌ Missing | HIGH |
| 53 | wiki-links | 95 | ❌ Missing | HIGH |
| 54 | list-split | 169 | ❌ Missing | MEDIUM |
| 55 | table-widths | 132 | ❌ Missing | MEDIUM |
| 56 | speaker-note | 87 | ❌ Missing | LOW |
| 57 | html-comment | 138 | ❌ Missing | MEDIUM |
| 58 | tag | 115 | ❌ Missing | HIGH |
| 59 | task-checkbox | 85 | ❌ Missing | HIGH |
| 60 | enhanced-strikethrough | 51 | ❌ Missing | LOW |
| 61 | date-person-tag | 59 | ❌ Missing | MEDIUM |
| 62 | multicolumn | 139 | ❌ Missing | LOW |
| 63 | container | 141 | ❌ Missing | MEDIUM |
| 64 | abbr | 131 | ❌ Missing | LOW |
| 65 | ins | 111 | ❌ Missing | LOW |
| 66 | mark | 109 | ❌ Missing | MEDIUM |
| 67 | strikethrough-alt | 93 | ❌ Missing | LOW |
| 68 | sub | 67 | ❌ Missing | LOW |
| 69 | sup | 67 | ❌ Missing | LOW |
| 70 | underline | 31 | ❌ Missing | LOW |

### Plugin System (16)

| # | Feature | V1 Location | LOC | V2 Status |
|---|---------|-------------|-----|-----------|
| 71 | Plugin Registry | `registry/PluginRegistry.ts` | 500 | ❌ Missing |
| 72 | Diagram Plugin Interface | `interfaces/DiagramPlugin.ts` | 200 | ❌ Missing |
| 73 | Export Plugin Interface | `interfaces/ExportPlugin.ts` | 150 | ❌ Missing |
| 74 | Import Plugin Interface | `interfaces/ImportPlugin.ts` | 100 | ❌ Missing |
| 75 | Embed Plugin Interface | `interfaces/EmbedPlugin.ts` | 100 | ❌ Missing |
| 76 | Mermaid Plugin | `diagram/MermaidPlugin.ts` | 400 | ❌ Missing |
| 77 | PlantUML Plugin | `diagram/PlantUMLPlugin.ts` | 400 | ❌ Missing |
| 78 | DrawIO Plugin | `diagram/DrawIOPlugin.ts` | 300 | ❌ Missing |
| 79 | PDF Plugin | `diagram/PDFPlugin.ts` | 200 | ❌ Missing |
| 80 | EPUB Plugin | `diagram/EPUBPlugin.ts` | 200 | ❌ Missing |
| 81 | XLSX Plugin | `diagram/XLSXPlugin.ts` | 200 | ❌ Missing |
| 82 | Excalidraw Plugin | `diagram/ExcalidrawPlugin.ts` | 300 | ❌ Missing |
| 83 | Document Plugin | `diagram/DocumentPlugin.ts` | 200 | ❌ Missing |
| 84 | Marp Export Plugin | `export/MarpExportPlugin.ts` | 300 | ❌ Missing |
| 85 | Pandoc Export Plugin | `export/PandocExportPlugin.ts` | 300 | ❌ Missing |
| 86 | Column Include Plugin | `import/ColumnIncludePlugin.ts` | 200 | ❌ Missing |

### ludos-sync (10)

| # | Feature | V1 Location | LOC | V2 Status | Port To |
|---|---------|-------------|-----|-----------|---------|
| 87 | Sync Server | `server.ts` | 300 | ❌ Missing | Sidecar |
| 88 | Board File Watcher | `fileWatcher.ts` | 400 | ✅ Similar | Rust |
| 89 | WebDAV Adapter | `adapters/BookmarkAdapter.ts` | 300 | ❌ Missing | PORT TO RUST |
| 90 | XBEL Mapper | `mappers/XbelMapper.ts` | 400 | ❌ Missing | PORT TO RUST |
| 91 | iCal Mapper | `mappers/IcalMapper.ts` | 400 | ❌ Missing | PORT TO RUST |
| 92 | CalDAV Middleware | `middleware/caldavMiddleware.ts` | 700 | ❌ Missing | PORT TO RUST |
| 93 | API Middleware | `middleware/apiMiddleware.ts` | 200 | ✅ Similar | Rust |
| 94 | Localhost Auth | `auth/LocalhostAuth.ts` | 150 | 🔶 Partial | Rust |
| 95 | Client Tracker | `clientTracker.ts` | 150 | ❌ Missing | Optional |
| 96 | Config Manager | `config.ts` | 200 | ✅ Similar | Rust |

### marp-engine (12)

| # | Feature | V1 Location | LOC | V2 Status | Port To |
|---|---------|-------------|-----|-----------|---------|
| 97 | Main Engine | `engine/engine.js` | 30000 | ❌ Missing | BUNDLE SIDECAR |
| 98 | Handout Transformer | (in engine.js) | 500 | ❌ Missing | BUNDLE SIDECAR |
| 99 | YAML Stripping Include | (in engine.js) | 100 | ❌ Missing | BUNDLE SIDECAR |
| 100 | Speaker Note Plugin | (in engine.js) | 50 | ❌ Missing | BUNDLE SIDECAR |
| 101 | Fragment Plugin | (in engine.js) | 100 | ❌ Missing | BUNDLE SIDECAR |
| 102 | Image Caption Plugin | (in engine.js) | 100 | ❌ Missing | BUNDLE SIDECAR |
| 103 | Python CLI | `bin/marped.py` | 500 | ❌ Missing | BUNDLE SIDECAR |
| 104 | HTML Export | `bin/marped2html.py` | 50 | ❌ Missing | BUNDLE SIDECAR |
| 105 | PDF Export | `bin/marped2pdf.py` | 50 | ❌ Missing | BUNDLE SIDECAR |
| 106 | PPTX Export | `bin/marped2pptx.py` | 50 | ❌ Missing | BUNDLE SIDECAR |
| 107 | PDF with Comments | `bin/marped2pdfComments.py` | 50 | ❌ Missing | BUNDLE SIDECAR |
| 108 | Batch Converter | `bin/marpedConverter.py` | 150 | ❌ Missing | BUNDLE SIDECAR |

---

## Summary Statistics

| Category | Total | Ported | Missing | % Complete |
|----------|-------|--------|---------|------------|
| Core Features | 22 | 8 | 14 | 36% |
| Commands | 14 | 3 | 11 | 21% |
| HTML Frontend | 14 | 2 | 12 | 14% |
| Markdown Plugins | 20 | 0 | 20 | 0% |
| Plugin System | 16 | 0 | 16 | 0% |
| ludos-sync | 10 | 3 | 7 | 30% |
| marp-engine | 12 | 0 | 12 | 0% |
| **TOTAL** | **108** | **16** | **92** | **15%** |

**Lines of Code:**
- V1 Total: ~160,000 LOC
- V2 Ported: ~56,000 LOC (35%)
- V2 Missing: ~104,000 LOC (65%)

---

## Implementation Priority

### Phase 1: Foundation (Weeks 1-4)
- Fix CRDT unwraps
- Fix iOS lock poisoning
- Modularize frontend

### Phase 2: Core Features (Weeks 5-8)
- WYSIWYG Editor
- Dashboard Scanner
- Gather Query Engine
- Backup Manager

### Phase 3: Export & Sync (Weeks 9-12)
- Bundle marp-engine as sidecar
- Port iCal Mapper to Rust (`lexera-core/src/export/ical.rs`)
- Port XBEL Mapper to Rust (`lexera-core/src/export/xbel.rs`)
- Port CalDAV middleware to Rust (`lexera-backend/src/caldav/`)
- Port WebDAV adapter to Rust (`lexera-backend/src/webdav/`)

### Phase 4: UX (Weeks 13-16)
- Board Renderer
- Drag & Drop
- Menu Operations
- Card Editor

### Phase 5: Polish (Weeks 17-20)
- Markdown plugins (10 priority)
- Plugin system
- Tests
- Documentation

**Total: ~80 developer-days over 20 weeks**

---

# Part VII: Detailed Implementation Guides

This section provides step-by-step implementation guides with code structures for the most important missing features.

---

## 1. WYSIWYG Editor Implementation Guide

**V1 Reference:** `src/wysiwyg/` (~15,000 LOC across 16 files)
**V2 Target:** `lexera-kanban/src/wysiwyg/`
**Effort:** 8-10 days
**Dependencies:** ProseMirror (already in v1)

### Architecture Overview

The V1 WYSIWYG editor uses a pipeline architecture:

```
Markdown Input
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│                    markdownItFactory                         │
│  Creates markdown-it instance with WYSIWYG plugins          │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│                    markdownItAdapter                         │
│  parseMarkdownToWysiwygDoc() - tokens → WysiwygDoc          │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│                      tokenParser                             │
│  Maps markdown-it tokens to WysiwygNode tree                │
│  Uses tokenMappings from spec.ts                            │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│                   prosemirrorAdapter                         │
│  WysiwygDoc → ProseMirror EditorState                       │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│                    ProseMirror Editor                        │
│  Interactive editing with:                                   │
│  - nodeViews.ts (custom renders for media, diagrams)        │
│  - inputRules.ts (markdown shortcuts)                       │
│  - commands.ts (formatting commands)                        │
│  - normalizer.ts (document cleanup)                         │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│                      serializer                              │
│  WysiwygDoc → Markdown output                               │
└─────────────────────────────────────────────────────────────┘
```

### File Structure to Create

```
lexera-kanban/src/wysiwyg/
├── index.js                  # Public API exports
├── pipeline.js               # markdownToWysiwygDoc, wysiwygDocToMarkdown
├── types.js                  # WysiwygNode, WysiwygDoc, WysiwygMark types
├── spec.js                   # wysiwygSchemaSpec, tokenMappings
├── markdownItFactory.js      # createWysiwygMarkdownIt()
├── markdownItAdapter.js      # parseMarkdownToWysiwygDoc()
├── tokenParser.js            # parseTokensToDoc() - complex token handling
├── schemaBuilder.js          # buildProseMirrorSchema()
├── prosemirrorAdapter.js     # docToEditorState(), editorStateToDoc()
├── prosemirrorSchema.js      # Node types, mark types, keymaps
├── nodeViews.js              # Custom views for media, diagrams, tags
├── inputRules.js             # Markdown shortcuts (*, **, #, etc.)
├── commands.js               # Formatting commands (bold, italic, etc.)
├── normalizer.js             # Document cleanup rules
├── serializer.js             # serializeWysiwygDoc()
├── markdownItPlugins.js      # Custom markdown-it plugins for WYSIWYG
└── utils.js                  # Helper functions
```

### Key Types (port from V1)

```javascript
// types.js
export class WysiwygMark {
    constructor(type, attrs = {}) {
        this.type = type;
        this.attrs = attrs;
    }
}

export class WysiwygNode {
    constructor(type, attrs = {}, content = [], marks = [], text = null) {
        this.type = type;
        this.attrs = attrs;
        this.content = content;
        this.marks = marks;
        this.text = text;
    }
}

export class WysiwygDoc extends WysiwygNode {
    constructor(content = []) {
        super('doc', {}, content);
    }
}
```

### Schema Spec (from V1 spec.ts)

```javascript
// spec.js - Node and mark definitions
export const wysiwygSchemaSpec = {
    nodes: {
        doc: { content: 'block+' },
        paragraph: { group: 'block', content: 'inline*' },
        heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
        blockquote: { group: 'block', content: 'block+' },
        bullet_list: { group: 'block', content: 'list_item+' },
        ordered_list: { group: 'block', content: 'list_item+', attrs: { order: { default: 1 } } },
        list_item: { group: 'block', content: 'block+' },
        task_checkbox: { inline: true, group: 'inline', atom: true, attrs: { checked: { default: false } } },
        code_block: { group: 'block', content: 'text*', code: true, attrs: { params: { default: '' } } },
        horizontal_rule: { group: 'block', atom: true },
        table: { group: 'block', content: 'table_row+' },
        table_row: { content: 'table_cell+' },
        table_cell: { content: 'block+', attrs: { align: { default: null } } },
        multicolumn: { group: 'block', content: 'multicolumn_column+' },
        multicolumn_column: { group: 'block', content: 'block+', attrs: { growth: { default: 1 } } },
        container: { group: 'block', content: 'block+', attrs: { kind: { default: 'note' } } },
        include_block: { group: 'block', atom: true, attrs: { path: '', includeType: 'regular' } },
        speaker_note: { group: 'block', content: 'text*', attrs: { raw: '' } },
        diagram_fence: { group: 'block', content: 'text*', code: true, attrs: { lang: '' } },
        wiki_link: { inline: true, group: 'inline', atom: true, attrs: { document: '', title: '' } },
        tag: { inline: true, group: 'inline', atom: true, attrs: { value: '', flavor: 'tag' } },
        temporal_tag: { inline: true, group: 'inline', atom: true, attrs: { value: '', kind: 'generic' } },
        media_inline: { inline: true, group: 'inline', atom: true, attrs: { src: '', mediaType: 'image', alt: '', title: '' } },
        media_block: { group: 'block', atom: true, attrs: { src: '', mediaType: 'image', alt: '', title: '' } },
        text: { group: 'inline' }
    },
    marks: {
        em: { inclusive: false },
        strong: { inclusive: false },
        code: { inclusive: false },
        strike: { attrs: { style: { default: 'tilde' } }, inclusive: false },
        underline: { inclusive: false },
        mark: { inclusive: false },
        sub: { inclusive: false },
        sup: { inclusive: false },
        ins: { inclusive: false },
        link: { attrs: { href: '', title: '' }, inclusive: false },
        abbr: { attrs: { title: '' }, inclusive: false }
    }
};
```

### Implementation Steps

**Step 1: Copy Core Types (1 day)**
```bash
# Copy type definitions
cp src/wysiwyg/types.ts lexera-kanban/src/wysiwyg/types.js
cp src/wysiwyg/spec.ts lexera-kanban/src/wysiwyg/spec.js
cp src/wysiwyg/schemaBuilder.ts lexera-kanban/src/wysiwyg/schemaBuilder.js
```

**Step 2: Port Pipeline (2 days)**
- Port `pipeline.ts` → `pipeline.js`
- Port `markdownItFactory.ts` → `markdownItFactory.js`
- Port `markdownItAdapter.ts` → `markdownItAdapter.js`
- Ensure markdown-it instance creation works in browser

**Step 3: Port Token Parser (2 days)**
- Port `tokenParser.ts` → `tokenParser.js`
- This is the most complex file (~500 LOC)
- Handles token nesting, marks, and special cases

**Step 4: Port ProseMirror Integration (2 days)**
- Port `prosemirrorAdapter.ts` → `prosemirrorAdapter.js`
- Port `prosemirrorSchema.ts` → `prosemirrorSchema.js`
- Port `nodeViews.ts` → `nodeViews.js`

**Step 5: Port Editor Features (2 days)**
- Port `inputRules.ts` → `inputRules.js`
- Port `commands.ts` → `commands.js`
- Port `normalizer.ts` → `normalizer.js`

**Step 6: Port Serializer (1 day)**
- Port `serializer.ts` → `serializer.js`
- Test round-trip: markdown → doc → markdown

### Testing Checklist

```javascript
// Test file: lexera-kanban/src/wysiwyg/__tests__/pipeline.test.js

import { markdownToWysiwygDoc, wysiwygDocToMarkdown } from '../pipeline';

describe('WYSIWYG Pipeline', () => {
    test('round-trips basic markdown', () => {
        const md = '# Hello\n\nParagraph with **bold**.';
        const doc = markdownToWysiwygDoc(md);
        const out = wysiwygDocToMarkdown(doc);
        expect(out.trim()).toBe(md);
    });

    test('handles task checkboxes', () => {
        const md = '- [x] Done\n- [ ] Todo';
        const doc = markdownToWysiwygDoc(md);
        expect(doc.content[0].content[0].content[0].type).toBe('task_checkbox');
        expect(doc.content[0].content[0].content[0].attrs.checked).toBe(true);
    });

    test('handles temporal tags', () => {
        const md = 'Task @2024-03-15 #work';
        const doc = markdownToWysiwygDoc(md);
        // Should have temporal_tag and tag nodes
    });

    test('handles tables', () => {
        const md = '| A | B |\n|---|---|\n| 1 | 2 |';
        const doc = markdownToWysiwygDoc(md);
        expect(doc.content[0].type).toBe('table');
    });
});
```

---

## 2. Dashboard Scanner Implementation Guide

**V1 Reference:** `src/dashboard/DashboardScanner.ts` (~600 LOC)
**V2 Target:** `lexera-core/src/dashboard/scanner.rs`
**Effort:** 5-6 days
**Dependencies:** `lexera-core/src/types.rs`, temporal parsing from `@ludos/shared`

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    DashboardScanner                          │
│                                                              │
│  scanForUpcomingItems(board, options)                       │
│  ├── filter columns by archive/deleted status               │
│  ├── iterate through tasks                                   │
│  │   ├── resolve temporal tags (inheritance)                │
│  │   ├── classify recurring state (overdue/outdated/etc)    │
│  │   └── check if within timeframe                          │
│  └── return UpcomingItem[]                                  │
│                                                              │
│  scanForTags(board)                                         │
│  ├── extract all #tags from content                         │
│  └── return BoardTagSummary                                 │
└─────────────────────────────────────────────────────────────┘
```

### Rust Implementation

```rust
// lexera-core/src/dashboard/mod.rs
pub mod scanner;
pub mod types;

// lexera-core/src/dashboard/types.rs
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc, Date};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpcomingItem {
    pub board_id: String,
    pub board_title: String,
    pub column_id: String,
    pub column_title: String,
    pub task_id: String,
    pub task_content: String,
    pub effective_date: Date<Utc>,
    pub temporal_tag: String,
    pub is_checked: bool,
    pub recurring_state: Option<RecurringState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RecurringState {
    Overdue,
    Outdated,
    ResetToRepeat,
    Future,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardTagSummary {
    pub board_id: String,
    pub tags: Vec<TagInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagInfo {
    pub name: String,
    pub count: usize,
    pub last_used: Option<Date<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanOptions {
    pub timeframe_days: u32,
    pub include_checked: bool,
    pub include_archived: bool,
}

// lexera-core/src/dashboard/scanner.rs
use crate::types::{KanbanBoard, KanbanColumn, KanbanCard};
use super::types::{UpcomingItem, BoardTagSummary, TagInfo, ScanOptions, RecurringState};
use chrono::{Utc, Duration, Date};

pub struct DashboardScanner {
    options: ScanOptions,
}

impl DashboardScanner {
    pub fn new(options: ScanOptions) -> Self {
        Self { options }
    }

    /// Scan board for upcoming items within timeframe
    pub fn scan_for_upcoming(&self, board: &KanbanBoard) -> Vec<UpcomingItem> {
        let mut items = Vec::new();
        let today = Utc::now().date();
        let future_limit = today + Duration::days(self.options.timeframe_days as i64);

        for column in &board.columns {
            if !self.options.include_archived && is_archived_or_deleted(&column.title) {
                continue;
            }

            for task in &column.cards {
                if task.checked.unwrap_or(false) && !self.options.include_checked {
                    continue;
                }

                // Resolve temporal tags for this task
                let temporals = self.resolve_task_temporals(&task.content, &column.title);
                
                for temporal in temporals {
                    // Check if within timeframe
                    if temporal.effective_date >= today && temporal.effective_date <= future_limit {
                        items.push(UpcomingItem {
                            board_id: board.id.clone(),
                            board_title: board.title.clone(),
                            column_id: column.id.clone(),
                            column_title: column.title.clone(),
                            task_id: task.id.clone(),
                            task_content: task.content.clone().unwrap_or_default(),
                            effective_date: temporal.effective_date,
                            temporal_tag: temporal.raw_tag,
                            is_checked: task.checked.unwrap_or(false),
                            recurring_state: None,
                        });
                    }
                    
                    // Check for overdue recurring items
                    if temporal.effective_date < today {
                        let state = self.classify_recurring_state(
                            temporal.effective_date,
                            task.checked.unwrap_or(false),
                            temporal.is_weekly,
                        );
                        if let Some(state) = state {
                            items.push(UpcomingItem {
                                recurring_state: Some(state),
                                ..// same as above
                            });
                        }
                    }
                }
            }
        }

        items
    }

    /// Extract all unique tags from board
    pub fn scan_for_tags(&self, board: &KanbanBoard) -> BoardTagSummary {
        let mut tag_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        
        for column in &board.columns {
            for task in &column.cards {
                let content = task.content.clone().unwrap_or_default();
                for tag in extract_hash_tags(&content) {
                    *tag_counts.entry(tag).or_insert(0) += 1;
                }
            }
        }

        let tags: Vec<TagInfo> = tag_counts
            .into_iter()
            .map(|(name, count)| TagInfo {
                name,
                count,
                last_used: None, // TODO: track last used
            })
            .collect();

        BoardTagSummary {
            board_id: board.id.clone(),
            tags,
        }
    }

    /// Resolve temporal tags with inheritance (column → task → line)
    fn resolve_task_temporals(&self, content: &str, column_title: &str) -> Vec<ResolvedTemporal> {
        // Port of resolveTaskTemporals from @ludos/shared
        // TODO: Implement full temporal resolution logic
        vec![]
    }

    /// Classify recurring temporal state based on age and checkbox
    fn classify_recurring_state(
        &self,
        effective_date: Date<Utc>,
        is_checked: bool,
        is_weekly: bool,
    ) -> Option<RecurringState> {
        let today = Utc::now().date();
        let age_days = (today - effective_date).num_days();

        if is_weekly {
            // Weekly recurring: 0-2 days overdue, 2-2.5 outdated, 2.5-3 reset
            if age_days < 0 {
                return None; // Future
            } else if age_days <= 2 && !is_checked {
                return Some(RecurringState::Overdue);
            } else if age_days <= 2 && is_checked {
                return Some(RecurringState::ResetToRepeat);
            } else if age_days > 3 {
                return Some(RecurringState::Future);
            }
        } else {
            // Yearly recurring: 0-60 days overdue, 60-75 outdated, 75-90 reset
            if age_days < 0 {
                return None;
            } else if age_days <= 60 && !is_checked {
                return Some(RecurringState::Overdue);
            } else if age_days <= 75 && !is_checked {
                return Some(RecurringState::Outdated);
            } else if age_days <= 90 && is_checked {
                return Some(RecurringState::ResetToRepeat);
            } else if age_days > 90 {
                return Some(RecurringState::Future);
            }
        }
        None
    }
}

fn is_archived_or_deleted(title: &str) -> bool {
    let lower = title.to_lowercase();
    lower.contains("#archive") || lower.contains("#deleted")
}

fn extract_hash_tags(content: &str) -> Vec<String> {
    let re = regex::Regex::new(r#"#([a-zA-Z0-9_-]+)"#).unwrap();
    re.captures_iter(content)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
        .collect()
}
```

### Implementation Steps

**Step 1: Create Module Structure (0.5 day)**
```bash
mkdir -p lexera-core/src/dashboard
touch lexera-core/src/dashboard/mod.rs
touch lexera-core/src/dashboard/types.rs
touch lexera-core/src/dashboard/scanner.rs
touch lexera-core/src/dashboard/temporal.rs
```

**Step 2: Port Types (0.5 day)**
- Define `UpcomingItem`, `BoardTagSummary`, `TagInfo`, `ScanOptions`
- Add to `mod.rs` exports

**Step 3: Port Temporal Resolution (2 days)**
- Port `resolveTaskTemporals` from `@ludos/shared`
- Handle temporal inheritance (column → task → line)
- Handle time-only tags inheriting date

**Step 4: Port Scanner Logic (1.5 days)**
- Implement `scan_for_upcoming()`
- Implement `scan_for_tags()`
- Implement `classify_recurring_state()`

**Step 5: Add API Endpoint (0.5 day)**
```rust
// lexera-backend/src/api/dashboard.rs
use axum::{Json, extract::State};
use lexera_core::dashboard::{DashboardScanner, ScanOptions};

pub async fn scan_dashboard(
    State(state): State<AppState>,
) -> Json<Vec<UpcomingItem>> {
    let options = ScanOptions {
        timeframe_days: 14,
        include_checked: false,
        include_archived: false,
    };
    let scanner = DashboardScanner::new(options);
    
    // Scan all boards in workspace
    let mut all_items = Vec::new();
    for board in state.storage.list_boards().await {
        all_items.extend(scanner.scan_for_upcoming(&board));
    }
    
    Json(all_items)
}
```

---

## 3. Gather Query Engine Implementation Guide

**V1 Reference:** `src/board/GatherQueryEngine.ts` (~400 LOC)
**V2 Target:** `lexera-core/src/gather/mod.rs`
**Effort:** 3-4 days

### Architecture

The Gather Query Engine automatically sorts tasks into columns based on query tags in column titles.

```
Column Title: "This Week ?#work ?@today"
              └─────┬────┘ └──┬──┘ └───┬───┘
                name      tag query  temporal query

Rules:
- ?#tagname  → Match #tagname in task
- ?@temporal → Match temporal (today, day<3, w5, mon)
- #ungathered → Collect unmatched tasks with temporal/person tags
- #sort-bydate → Sort column by date
```

### Rust Implementation

```rust
// lexera-core/src/gather/mod.rs
pub mod engine;
pub mod parser;
pub mod types;

// lexera-core/src/gather/types.rs
use crate::types::{KanbanColumn, KanbanCard};

#[derive(Debug, Clone)]
pub struct GatherRule {
    pub column_id: String,
    pub expression: String,
    pub rule_type: GatherRuleType,
}

#[derive(Debug, Clone)]
pub enum GatherRuleType {
    Tag(String),           // ?#tag
    Temporal(String),      // ?@today, ?@day<3
    Ungathered,            // #ungathered
}

// lexera-core/src/gather/engine.rs
use crate::types::KanbanBoard;
use super::types::{GatherRule, GatherRuleType};

pub struct GatherQueryEngine;

impl GatherQueryEngine {
    /// Perform automatic sort based on gather rules in column titles
    pub fn perform_automatic_sort(&self, board: &mut KanbanBoard) -> bool {
        // 1. Collect all gather rules from column titles
        let rules = self.extract_rules(board);
        
        // 2. Identify sticky tasks (don't move)
        let sticky_tasks = self.find_sticky_tasks(board);
        
        // 3. Match tasks to rules
        let destinations = self.match_tasks_to_rules(board, &rules, &sticky_tasks);
        
        // 4. Move tasks to destination columns
        self.apply_moves(board, destinations);
        
        // 5. Apply sorting to columns with #sort-* tags
        self.apply_column_sorting(board);
        
        true
    }

    fn extract_rules(&self, board: &KanbanBoard) -> Vec<GatherRule> {
        let mut rules = Vec::new();
        
        for column in &board.columns {
            let title = &column.title;
            
            // Extract ?#tag queries
            let tag_re = regex::Regex::new(r"\?#([^\s]+)").unwrap();
            for cap in tag_re.captures_iter(title) {
                rules.push(GatherRule {
                    column_id: column.id.clone(),
                    expression: cap[1].to_string(),
                    rule_type: GatherRuleType::Tag(cap[1].to_string()),
                });
            }
            
            // Extract ?@temporal queries
            let temporal_re = regex::Regex::new(r"\?@([^\s]+)").unwrap();
            for cap in temporal_re.captures_iter(title) {
                rules.push(GatherRule {
                    column_id: column.id.clone(),
                    expression: cap[1].to_string(),
                    rule_type: GatherRuleType::Temporal(cap[1].to_string()),
                });
            }
            
            // Check for #ungathered
            if title.contains("#ungathered") {
                rules.push(GatherRule {
                    column_id: column.id.clone(),
                    expression: "ungathered".to_string(),
                    rule_type: GatherRuleType::Ungathered,
                });
            }
        }
        
        rules
    }

    fn match_tasks_to_rules(
        &self,
        board: &KanbanBoard,
        rules: &[GatherRule],
        sticky_tasks: &[String],
    ) -> std::collections::HashMap<String, String> {
        let mut destinations = std::collections::HashMap::new();
        
        for column in &board.columns {
            for task in &column.cards {
                if sticky_tasks.contains(&task.id) {
                    continue;
                }
                
                let content = task.content.clone().unwrap_or_default();
                
                for rule in rules {
                    if self.matches_rule(&content, rule) {
                        destinations.insert(task.id.clone(), rule.column_id.clone());
                        break; // First match wins
                    }
                }
            }
        }
        
        destinations
    }

    fn matches_rule(&self, content: &str, rule: &GatherRule) -> bool {
        match &rule.rule_type {
            GatherRuleType::Tag(tag) => {
                let re = regex::Regex::new(&format!(r"#{}(\s|$)", tag)).unwrap();
                re.is_match(content)
            }
            GatherRuleType::Temporal(expr) => {
                self.matches_temporal(content, expr)
            }
            GatherRuleType::Ungathered => {
                // Matched if has temporal or person tag but no other rule matched
                false // Handled separately in second pass
            }
        }
    }

    fn matches_temporal(&self, content: &str, expr: &str) -> bool {
        // Parse expression: today, day<3, day=0, w5, mon
        if expr == "today" {
            // Check if content has @today or today's date
            // TODO: Implement
        } else if expr.starts_with("day") {
            // Parse day comparison
            // TODO: Implement
        } else if expr.starts_with('w') || expr.starts_with('W') {
            // Week number
            // TODO: Implement
        }
        false
    }

    fn find_sticky_tasks(&self, board: &KanbanBoard) -> Vec<String> {
        let mut sticky = Vec::new();
        for column in &board.columns {
            for task in &column.cards {
                if let Some(content) = &task.content {
                    if content.contains("#sticky") {
                        sticky.push(task.id.clone());
                    }
                }
            }
        }
        sticky
    }

    fn apply_moves(
        &self,
        board: &mut KanbanBoard,
        destinations: std::collections::HashMap<String, String>,
    ) {
        for (task_id, target_column_id) in destinations {
            // Find and remove task from current column
            let mut task_to_move = None;
            for column in &mut board.columns {
                if let Some(pos) = column.cards.iter().position(|t| t.id == task_id) {
                    task_to_move = Some(column.cards.remove(pos));
                    break;
                }
            }
            
            // Add to target column
            if let Some(task) = task_to_move {
                for column in &mut board.columns {
                    if column.id == target_column_id {
                        column.cards.push(task);
                        break;
                    }
                }
            }
        }
    }

    fn apply_column_sorting(&self, board: &mut KanbanBoard) {
        for column in &mut board.columns {
            if let Some(title) = &column.title {
                if title.contains("#sort-bydate") {
                    column.cards.sort_by(|a, b| {
                        let date_a = extract_date(&a.content.clone().unwrap_or_default());
                        let date_b = extract_date(&b.content.clone().unwrap_or_default());
                        date_a.cmp(&date_b)
                    });
                } else if title.contains("#sort-byname") {
                    column.cards.sort_by(|a, b| {
                        let name_a = a.content.clone().unwrap_or_default();
                        let name_b = b.content.clone().unwrap_or_default();
                        name_a.cmp(&name_b)
                    });
                }
            }
        }
    }
}

fn extract_date(content: &str) -> String {
    // Extract @YYYY-MM-DD or similar temporal tag
    let re = regex::Regex::new(r"@\d{4}-\d{2}-\d{2}").unwrap();
    re.find(content)
        .map(|m| m.as_str().to_string())
        .unwrap_or_default()
}
```

---

## 4. ludos-sync Port to Rust

**V1 Reference:** `packages/ludos-sync/src/` (~3,500 LOC TypeScript)
**V2 Target:** 
- `lexera-core/src/export/ical.rs` (iCal mapper)
- `lexera-backend/src/caldav/` (CalDAV middleware)
- `lexera-backend/src/webdav/` (WebDAV adapter)

**Effort:** 15 days total

### 4.1 iCal Mapper (Rust)

```rust
// lexera-core/src/export/ical.rs
use crate::types::{KanbanColumn, KanbanCard};
use chrono::{DateTime, Utc, Date, Timelike};
use sha2::{Sha256, Digest};

pub struct IcalTask {
    pub uid: String,
    pub summary: String,
    pub dtstart: Option<String>,
    pub dtend: Option<String>,
    pub due: Option<String>,
    pub status: String,
    pub categories: Vec<String>,
}

pub struct IcalMapper;

impl IcalMapper {
    /// Convert columns to iCal tasks
    pub fn columns_to_ical_tasks(
        columns: &[KanbanColumn],
        board_id: &str,
        last_modified: Option<DateTime<Utc>>,
    ) -> Vec<IcalTask> {
        let mut tasks = Vec::new();
        let dtstamp = format_dtstamp(last_modified.unwrap_or_else(Utc::now));
        let mut occurrences: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

        for column in columns {
            if is_archived_or_deleted(&column.title) {
                continue;
            }

            for task in &column.cards {
                let content = task.content.clone().unwrap_or_default();
                if is_archived_or_deleted(&content) {
                    continue;
                }

                let hash_tags = extract_hash_tags(&content);
                let categories = vec![column.title.clone()].into_iter()
                    .chain(hash_tags.into_iter())
                    .collect();
                let checked = task.checked.unwrap_or(false);

                // Resolve temporals for this task
                let temporals = resolve_task_temporals(&content, &column.title);
                
                for temporal in temporals {
                    let occ_key = format!("{}::{}", column.title, temporal.line_content);
                    let occ = occurrences.entry(occ_key).or_insert(0);
                    *occ += 1;
                    
                    let uid = generate_uid(board_id, &column.title, &temporal.line_content, *occ);
                    let summary = clean_summary(&temporal.line_content);
                    
                    if let Some(event) = build_event(
                        uid,
                        summary,
                        temporal.effective_date,
                        temporal.time_slot.as_deref(),
                        checked,
                        categories.clone(),
                        &dtstamp,
                    ) {
                        tasks.push(event);
                    }
                }
            }
        }

        tasks
    }

    /// Generate full VCALENDAR string
    pub fn generate_calendar(tasks: &[IcalTask], calendar_name: &str) -> String {
        let mut lines = vec![
            "BEGIN:VCALENDAR".to_string(),
            "VERSION:2.0".to_string(),
            "PRODID:-//Lexera//Kanban CalDAV//EN".to_string(),
            format!("X-WR-CALNAME:{}", calendar_name),
        ];

        for task in tasks {
            lines.extend(generate_component(task));
        }

        lines.push("END:VCALENDAR".to_string());

        lines.into_iter()
            .map(|l| fold_line(&l))
            .collect::<Vec<_>>()
            .join("\r\n") + "\r\n"
    }
}

fn generate_uid(board_id: &str, column_title: &str, line: &str, occurrence: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{}\0{}\0{}\0{}", board_id, column_title, line, occurrence));
    format!("{:x}", hasher.finalize())
        .chars().take(16).collect()
}

fn format_ical_date(date: Date<Utc>) -> String {
    format!("{}", date.format("%Y%m%d"))
}

fn format_dtstamp(dt: DateTime<Utc>) -> String {
    format!("{}", dt.format("%Y%m%dT%H%M%SZ"))
}

fn fold_line(line: &str) -> String {
    if line.len() <= 75 {
        return line.to_string();
    }
    
    let mut result = String::new();
    let chars: Vec<char> = line.chars().collect();
    let mut pos = 0;
    
    while pos < chars.len() {
        let chunk: String = chars[pos..std::cmp::min(pos + 75, chars.len())].iter().collect();
        if pos > 0 {
            result.push_str(" ");
        }
        result.push_str(&chunk);
        pos += 75;
    }
    
    result
}

fn extract_hash_tags(content: &str) -> Vec<String> {
    let re = regex::Regex::new(r#"#([a-zA-Z0-9_-]+)"#).unwrap();
    re.captures_iter(content)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
        .collect()
}

fn is_archived_or_deleted(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("#archive") || lower.contains("#deleted")
}
```

### 4.2 CalDAV Middleware (Rust)

```rust
// lexera-backend/src/caldav/mod.rs
pub mod handler;
pub mod calendar;

// lexera-backend/src/caldav/handler.rs
use axum::{
    extract::{State, Path, Request},
    response::{Response, IntoResponse},
    body::Body,
    http::{StatusCode, Method, header},
};
use lexera_core::export::ical::{IcalMapper, IcalTask};

pub struct CaldavHandler;

impl CaldavHandler {
    /// Handle CalDAV requests
    pub async fn handle(
        State(state): State<AppState>,
        path: Option<Path<String>>,
        request: Request,
    ) -> Response {
        let method = request.method();
        let path_str = path.map(|p| p.0).unwrap_or_default();

        match method {
            &Method::OPTIONS => self.handle_options(),
            &Method::PROPFIND => self.handle_propfind(&state, &path_str).await,
            &Method::REPORT => self.handle_report(&state, &path_str).await,
            &Method::GET => self.handle_get(&state, &path_str).await,
            _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
        }
    }

    fn handle_options() -> Response {
        Response::builder()
            .status(StatusCode::OK)
            .header("DAV", "1, calendar-access")
            .header("Allow", "OPTIONS, PROPFIND, REPORT, GET")
            .body(Body::empty())
            .unwrap()
    }

    async fn handle_propfind(&self, state: &AppState, path: &str) -> Response {
        // Return calendar properties
        let body = r#"<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/</href>
    <propstat>
      <prop>
        <resourcetype><collection/><C:calendar/></resourcetype>
        <displayname>Lexera Kanban</displayname>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>"#;

        Response::builder()
            .status(StatusCode::MULTI_STATUS)
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(Body::from(body))
            .unwrap()
    }

    async fn handle_report(&self, state: &AppState, path: &str) -> Response {
        // Return all events as calendar-query response
        let columns = state.storage.get_all_columns().await;
        let tasks = IcalMapper::columns_to_ical_tasks(&columns, "lexera", None);
        let calendar = IcalMapper::generate_calendar(&tasks, "Lexera Kanban");

        Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "text/calendar; charset=utf-8")
            .body(Body::from(calendar))
            .unwrap()
    }

    async fn handle_get(&self, state: &AppState, path: &str) -> Response {
        // Return single event or full calendar
        let columns = state.storage.get_all_columns().await;
        let tasks = IcalMapper::columns_to_ical_tasks(&columns, "lexera", None);
        let calendar = IcalMapper::generate_calendar(&tasks, "Lexera Kanban");

        Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "text/calendar; charset=utf-8")
            .body(Body::from(calendar))
            .unwrap()
    }
}
```

### 4.3 WebDAV Adapter (Rust)

```rust
// lexera-backend/src/webdav/mod.rs
pub mod handler;
pub mod xbel;

// lexera-backend/src/webdav/xbel.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct XbelBookmark {
    #[serde(rename = "@href")]
    pub href: String,
    pub title: String,
    #[serde(rename = "desc", skip_serializing_if = "Option::is_none")]
    pub desc: Option<String>,
    #[serde(rename = "info", skip_serializing_if = "Option::is_none")]
    pub info: Option<XbelInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct XbelInfo {
    pub metadata: XbelMetadata,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct XbelMetadata {
    #[serde(rename = "@owner")]
    pub owner: String,
    #[serde(rename = "@lexera-column", skip_serializing_if = "Option::is_none")]
    pub lexera_column: Option<String>,
    #[serde(rename = "@lexera-board", skip_serializing_if = "Option::is_none")]
    pub lexera_board: Option<String>,
}

pub struct XbelMapper;

impl XbelMapper {
    /// Convert Kanban columns to XBEL bookmarks
    pub fn columns_to_xbel(columns: &[KanbanColumn], board_id: &str) -> String {
        let bookmarks: Vec<XbelBookmark> = columns
            .iter()
            .flat_map(|col| {
                col.cards.iter().filter_map(|card| {
                    extract_url_from_content(&card.content.clone().unwrap_or_default())
                        .map(|url| XbelBookmark {
                            href: url,
                            title: card.content.clone().unwrap_or_default()
                                .lines().next().unwrap_or("").to_string(),
                            desc: None,
                            info: Some(XbelInfo {
                                metadata: XbelMetadata {
                                    owner: "lexera".to_string(),
                                    lexera_column: Some(col.title.clone()),
                                    lexera_board: Some(board_id.to_string()),
                                },
                            }),
                        })
                })
            })
            .collect();

        let xbel = XbelDocument {
            version: "1.0",
            bookmarks,
        };

        quick_xml::se::to_string(&xbel).unwrap_or_default()
    }

    /// Convert XBEL bookmarks to Kanban cards
    pub fn xbel_to_cards(xbel: &str) -> Vec<KanbanCard> {
        // Parse XBEL and create cards
        // TODO: Implement
        vec![]
    }
}

fn extract_url_from_content(content: &str) -> Option<String> {
    let re = regex::Regex::new(r#"https?://[^\s<>"]+"#).unwrap();
    re.find(content).map(|m| m.as_str().to_string())
}
```

---

## 5. Plugin System Implementation Guide

**V1 Reference:** `src/plugins/` (~4,000 LOC)
**V2 Target:** `lexera-kanban/src/plugins/`
**Effort:** 5-6 days

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PluginRegistry                            │
│                                                              │
│  registerImportPlugin(plugin)                               │
│  registerExportPlugin(plugin)                               │
│  registerDiagramPlugin(plugin)                              │
│  registerMarkdownPlugin(entry)                              │
│                                                              │
│  findImportPlugin(path, context) → ImportPlugin             │
│  findExportPlugin(formatId) → ExportPlugin                  │
│  findDiagramPluginForCodeBlock(lang) → DiagramPlugin        │
└─────────────────────────────────────────────────────────────┘
```

### Plugin Interfaces (JavaScript)

```javascript
// lexera-kanban/src/plugins/interfaces/ImportPlugin.js

/**
 * @typedef {Object} ImportPluginMetadata
 * @property {string} id - Unique plugin identifier
 * @property {string} name - Display name
 * @property {string} fileType - File type this plugin handles
 * @property {RegExp} includePattern - Regex for detecting includes
 * @property {number} priority - Higher = checked first
 * @property {'any'|'column'|'task'} contextLocation - Where plugin applies
 */

/**
 * @typedef {Object} ImportContext
 * @property {string} boardPath - Path to current board
 * @property {'column'|'task'} location - Where content is being parsed
 * @property {string} [columnTitle] - Column title if in column context
 */

/**
 * @typedef {Object} IncludeMatch
 * @property {string} type - Include type (e.g., 'markdown', 'image')
 * @property {string} path - Resolved path to included file
 * @property {number} startIndex - Start position in content
 * @property {number} endIndex - End position in content
 * @property {Object} [options] - Additional options
 */

/**
 * @interface ImportPlugin
 */
export class ImportPlugin {
    /** @type {ImportPluginMetadata} */
    metadata;

    /**
     * Check if this plugin can handle the given path
     * @param {string} path
     * @param {ImportContext} context
     * @returns {boolean}
     */
    canHandle(path, context) {
        throw new Error('Not implemented');
    }

    /**
     * Detect includes in content
     * @param {string} content
     * @param {ImportContext} context
     * @returns {IncludeMatch[]}
     */
    detectIncludes(content, context) {
        throw new Error('Not implemented');
    }

    /**
     * Create a virtual file for include
     * @param {IncludeMatch} match
     * @param {ImportContext} context
     * @returns {Promise<{content: string, metadata: Object}>}
     */
    async createFile(match, context) {
        throw new Error('Not implemented');
    }

    /**
     * Optional activation hook
     * @param {Object} context
     */
    async activate(context) {}
}

// lexera-kanban/src/plugins/interfaces/ExportPlugin.js

/**
 * @typedef {Object} ExportFormat
 * @property {string} id - Format identifier (e.g., 'html', 'pdf')
 * @property {string} name - Display name
 * @property {string} extension - File extension
 * @property {string} [mimeType] - MIME type
 */

/**
 * @interface ExportPlugin
 */
export class ExportPlugin {
    /** @type {{id: string, name: string, formats: ExportFormat[]}} */
    metadata;

    /**
     * Get supported export formats
     * @returns {ExportFormat[]}
     */
    getSupportedFormats() {
        throw new Error('Not implemented');
    }

    /**
     * Check if this plugin can export the given format
     * @param {string} formatId
     * @param {Object} options
     * @returns {boolean}
     */
    canExport(formatId, options) {
        throw new Error('Not implemented');
    }

    /**
     * Export content to the specified format
     * @param {string} content - Markdown content
     * @param {string} formatId
     * @param {Object} options
     * @returns {Promise<{data: Buffer|string, metadata: Object}>}
     */
    async export(content, formatId, options) {
        throw new Error('Not implemented');
    }
}

// lexera-kanban/src/plugins/interfaces/DiagramPlugin.js

/**
 * @interface DiagramPlugin
 */
export class DiagramPlugin {
    /** @type {{id: string, name: string, supportedCodeBlocks: string[], supportedFileExtensions: string[]}} */
    metadata;

    /**
     * Check if plugin is available (dependencies installed)
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        throw new Error('Not implemented');
    }

    /**
     * Check if can render code block with language
     * @param {string} language
     * @returns {boolean}
     */
    canRenderCodeBlock(language) {
        throw new Error('Not implemented');
    }

    /**
     * Check if can render file at path
     * @param {string} filePath
     * @returns {boolean}
     */
    canRenderFile(filePath) {
        throw new Error('Not implemented');
    }

    /**
     * Render code block to HTML
     * @param {string} code
     * @param {string} language
     * @param {Object} context
     * @returns {Promise<string>} HTML
     */
    async renderCodeBlock(code, language, context) {
        throw new Error('Not implemented');
    }

    /**
     * Render file to HTML
     * @param {string} filePath
     * @param {Object} context
     * @returns {Promise<string>} HTML
     */
    async renderFile(filePath, context) {
        throw new Error('Not implemented');
    }
}
```

### Registry Implementation

```javascript
// lexera-kanban/src/plugins/registry/PluginRegistry.js

import { ImportPlugin } from '../interfaces/ImportPlugin.js';
import { ExportPlugin } from '../interfaces/ExportPlugin.js';
import { DiagramPlugin } from '../interfaces/DiagramPlugin.js';

class PluginRegistry {
    constructor() {
        this._importPlugins = new Map();
        this._exportPlugins = new Map();
        this._diagramPlugins = new Map();
        this._markdownPlugins = new Map();
        this._initialized = false;
    }

    static getInstance() {
        if (!PluginRegistry._instance) {
            PluginRegistry._instance = new PluginRegistry();
        }
        return PluginRegistry._instance;
    }

    // Registration methods
    registerImportPlugin(plugin) {
        this._validateImportPlugin(plugin);
        this._importPlugins.set(plugin.metadata.id, plugin);
    }

    registerExportPlugin(plugin) {
        this._validateExportPlugin(plugin);
        this._exportPlugins.set(plugin.metadata.id, plugin);
    }

    registerDiagramPlugin(plugin) {
        this._validateDiagramPlugin(plugin);
        this._diagramPlugins.set(plugin.metadata.id, plugin);
    }

    registerMarkdownPlugin(entry) {
        this._markdownPlugins.set(entry.id, entry);
    }

    // Discovery methods
    findImportPlugin(path, context) {
        const sorted = this.getImportPluginsByPriority();
        for (const plugin of sorted) {
            if (plugin.canHandle(path, context)) {
                return plugin;
            }
        }
        return null;
    }

    findExportPlugin(formatId) {
        for (const plugin of this._exportPlugins.values()) {
            if (plugin.getSupportedFormats().some(f => f.id === formatId)) {
                return plugin;
            }
        }
        return null;
    }

    findDiagramPluginForCodeBlock(language) {
        for (const plugin of this._diagramPlugins.values()) {
            if (plugin.canRenderCodeBlock(language)) {
                return plugin;
            }
        }
        return null;
    }

    getImportPluginsByPriority() {
        return Array.from(this._importPlugins.values())
            .sort((a, b) => b.metadata.priority - a.metadata.priority);
    }

    getSupportedExportFormats() {
        const formats = [];
        for (const plugin of this._exportPlugins.values()) {
            formats.push(...plugin.getSupportedFormats());
        }
        return formats;
    }

    // Validation
    _validateImportPlugin(plugin) {
        if (!plugin.metadata?.id) throw new Error('Plugin missing metadata.id');
        if (typeof plugin.canHandle !== 'function') throw new Error('Plugin missing canHandle');
        if (typeof plugin.detectIncludes !== 'function') throw new Error('Plugin missing detectIncludes');
    }

    _validateExportPlugin(plugin) {
        if (!plugin.metadata?.id) throw new Error('Plugin missing metadata.id');
        if (typeof plugin.getSupportedFormats !== 'function') throw new Error('Plugin missing getSupportedFormats');
        if (typeof plugin.export !== 'function') throw new Error('Plugin missing export');
    }

    _validateDiagramPlugin(plugin) {
        if (!plugin.metadata?.id) throw new Error('Plugin missing metadata.id');
        if (typeof plugin.isAvailable !== 'function') throw new Error('Plugin missing isAvailable');
    }
}

export const pluginRegistry = PluginRegistry.getInstance();
```

---

## Summary: Implementation Priority

| Feature | Effort | Priority | Dependencies |
|---------|--------|----------|--------------|
| WYSIWYG Editor | 8-10 days | HIGH | ProseMirror |
| Dashboard Scanner | 5-6 days | HIGH | Temporal parsing |
| Gather Query Engine | 3-4 days | HIGH | None |
| Plugin Registry | 5-6 days | MEDIUM | None |
| iCal Mapper (Rust) | 3 days | MEDIUM | chrono, sha2 |
| CalDAV Middleware | 4 days | MEDIUM | Axum |
| WebDAV Adapter | 3 days | LOW | quick-xml |

**Total: ~31-36 days** for core features

---

# Part VIII: Detailed V2 Code Analysis & Refactoring TODOs

## Current V2 `app.js` Structure Analysis

**File:** `packages/lexera-kanban/src/app.js`
**Lines:** 14,935
**Functions:** ~1,018
**Issue:** Single monolithic file containing ALL frontend logic

### Current State Variables (lines 359-454)

The `LexeraDashboard` IIFE contains 95+ state variables:

```javascript
// Board state
let boards = [];
let activeBoardId = null;
let activeBoardData = null;
let fullBoardData = null;

// Editor state
var isEditing = false;
var currentCardEditor = null;
var currentInlineCardEditor = null;
var cardEditorMode = null;

// Drag & Drop state
var ptrDrag = null; // { type, source, startX, startY, started, ghost, el }

// Undo/Redo
var undoStack = [];
var redoStack = [];
var MAX_UNDO = 30;

// Split view state
var splitViewMode = 'single'; // single | vertical | horizontal
var splitPaneBoards = { a: '', b: '' };
var splitRatios = { vertical: 0.5, horizontal: 0.5 };

// Dashboard state
var dashboardState = {
  query: '',
  scope: 'active',
  pinnedQueries: [],
  loading: false,
  results: [],
  deadlines: [],
  overdue: []
};

// Theme state
var THEMES = [ /* 4 themes */ ];
var currentTheme = 'lexera';
```

### Function Categories Found in app.js

| Category | Functions | Lines | Priority to Extract |
|----------|-----------|-------|---------------------|
| Logging | ~25 | ~350 | Low (already isolated) |
| Theme Management | ~15 | ~400 | Medium |
| Board Loading/Saving | ~30 | ~800 | HIGH |
| Card Rendering | ~40 | ~1200 | HIGH |
| Column Rendering | ~20 | ~600 | HIGH |
| Drag & Drop | ~35 | ~1000 | HIGH |
| Inline Editing | ~25 | ~700 | HIGH |
| Overlay Editor | ~15 | ~400 | Medium |
| Search | ~20 | ~500 | Medium |
| Dashboard Scanner | ~30 | ~900 | HIGH |
| Split View | ~25 | ~600 | Low |
| Undo/Redo | ~10 | ~300 | Medium |
| Markdown Rendering | ~20 | ~500 | HIGH |
| Mermaid/PlantUML | ~15 | ~400 | Medium |
| Export | ~10 | ~300 | Medium |
| Live Sync | ~20 | ~500 | Medium |
| Keyboard Shortcuts | ~15 | ~400 | Medium |
| Context Menus | ~20 | ~600 | Medium |
| Tag Filtering | ~15 | ~300 | Medium |

---

## Refactoring Plan: Extract Modules from app.js

### Target Structure

```
packages/lexera-kanban/src/
├── app.js                    # Main entry, initialization (~500 lines)
├── api.js                    # API client (already exists)
├── index.html                # HTML template
├── modules/
│   ├── state.js              # Centralized state management
│   ├── board/
│   │   ├── loader.js         # Board loading/saving
│   │   ├── renderer.js       # Board/column/card rendering
│   │   └── hierarchy.js      # Board tree navigation
│   ├── editor/
│   │   ├── inline.js         # Inline card editor
│   │   ├── overlay.js        # Full-screen editor
│   │   └── autocomplete.js   # Tag/date autocomplete
│   ├── dnd/
│   │   ├── drag.js           # Drag initiation
│   │   ├── drop.js           # Drop handling
│   │   └── ghost.js          # Ghost element management
│   ├── markdown/
│   │   ├── renderer.js       # markdown-it setup
│   │   └── plugins.js        # Plugin configuration
│   ├── dashboard/
│   │   ├── scanner.js        # Scan for upcoming items
│   │   └── query.js          # Query parsing
│   ├── export/
│   │   ├── marp.js           # Marp sidecar integration
│   │   └── ui.js             # Export dialog
│   ├── sync/
│   │   ├── websocket.js      # WebSocket connection
│   │   └── crdt.js           # CRDT operations
│   ├── ui/
│   │   ├── theme.js          # Theme management
│   │   ├── split.js          # Split view
│   │   ├── sidebar.js        # Sidebar
│   │   └── search.js         # Search UI
│   └── utils/
│       ├── undo.js           # Undo/redo stack
│       ├── keyboard.js       # Keyboard shortcuts
│       └── dom.js            # DOM utilities
└── wysiwyg/                  # WYSIWYG editor (port from V1)
    ├── index.js
    ├── pipeline.js
    ├── types.js
    └── ...
```

---

## Detailed TODO: Extract Board Module

### Step 1: Create `modules/state.js`

**Purpose:** Centralize all state variables

```javascript
// modules/state.js
export const AppState = {
  // Board state
  boards: [],
  remoteBoards: [],
  activeBoardId: null,
  activeBoardData: null,
  fullBoardData: null,
  boardHierarchyCache: {},
  
  // Editor state
  editor: {
    isEditing: false,
    currentCardEditor: null,
    currentInlineCardEditor: null,
    cardEditorMode: null,
    cardEditorFontScale: 1
  },
  
  // Drag state
  drag: {
    ptrDrag: null
  },
  
  // Undo/Redo
  undo: {
    stack: [],
    redoStack: [],
    maxItems: 30,
    maxBytes: 10 * 1024 * 1024,
    totalBytes: 0
  },
  
  // Split view
  split: {
    mode: 'single',
    panes: { a: '', b: '' },
    activePane: 'a',
    ratios: { vertical: 0.5, horizontal: 0.5 }
  },
  
  // Dashboard
  dashboard: {
    query: '',
    scope: 'active',
    pinnedQueries: [],
    loading: false,
    results: [],
    deadlines: [],
    overdue: []
  },
  
  // Theme
  theme: {
    current: 'lexera',
    themes: []
  },
  
  // Connection
  connected: false,
  eventSource: null
};

// State update helpers
export function updateBoard(boardId, updates) {
  const board = AppState.boards.find(b => b.id === boardId);
  if (board) Object.assign(board, updates);
}

export function setActiveBoard(boardId, data) {
  AppState.activeBoardId = boardId;
  AppState.activeBoardData = data;
}
```

**TODO Items:**
- [ ] Create `modules/state.js` with all state variables
- [ ] Export `AppState` object
- [ ] Create `updateBoard()`, `setActiveBoard()` helpers
- [ ] Replace all global variable references in `app.js` with `AppState.*`

---

### Step 2: Create `modules/board/loader.js`

**Extract from app.js lines ~2000-2500**

**Functions to extract:**
```javascript
// Current names in app.js (search for these):
loadBoardList()
loadBoard(boardId, options)
saveBoard(boardId, data)
refreshBoard()
handleBoardChange(event)
pollForChanges()
```

**Target implementation:**
```javascript
// modules/board/loader.js
import { LexeraApi } from '../api.js';
import { AppState, setActiveBoard } from '../state.js';

export async function loadBoardList() {
  const list = await LexeraApi.listBoards();
  AppState.boards = list.boards || [];
  return AppState.boards;
}

export async function loadBoard(boardId, options = {}) {
  const seq = ++AppState.boardLoadSeq;
  
  const data = await LexeraApi.getBoard(boardId);
  
  // Check for stale response
  if (seq !== AppState.boardLoadSeq) {
    return null;
  }
  
  setActiveBoard(boardId, data);
  return data;
}

export async function saveBoard(boardId, data) {
  // Debounce logic
  const now = Date.now();
  if (now - AppState.lastSaveTime < AppState.SAVE_DEBOUNCE_MS) {
    AppState.pendingRefresh = true;
    return;
  }
  AppState.lastSaveTime = now;
  
  await LexeraApi.saveBoard(boardId, data);
  AppState.pendingRefresh = false;
}

export function startPolling(intervalMs = 5000) {
  if (AppState.pollInterval) clearInterval(AppState.pollInterval);
  AppState.pollInterval = setInterval(refreshBoard, intervalMs);
}

export function stopPolling() {
  if (AppState.pollInterval) {
    clearInterval(AppState.pollInterval);
    AppState.pollInterval = null;
  }
}
```

**TODO Items:**
- [ ] Find `loadBoardList()` in app.js (search `function loadBoardList`)
- [ ] Find `loadBoard()` function
- [ ] Find `saveBoard()` function
- [ ] Find `refreshBoard()` function
- [ ] Find `handleBoardChange()` function
- [ ] Extract all 5 functions to `modules/board/loader.js`
- [ ] Add imports/exports
- [ ] Update app.js to import from loader.js

---

### Step 3: Create `modules/board/renderer.js`

**Extract from app.js lines ~3000-5000**

**Functions to extract:**
```javascript
renderBoard(board)
renderColumn(column, index)
renderCard(card, columnId)
renderTag(tag, color)
renderCheckbox(checked)
attachCardHandlers(el, card, columnId)
```

**Key V1 differences to port:**
- V1 has incremental updates (`updateTaskInDOM`)
- V1 has folding state persistence
- V1 has virtual DOM optimization

**TODO Items:**
- [ ] Find `renderBoard()` in app.js
- [ ] Find `renderColumn()` function
- [ ] Find `renderCard()` function
- [ ] Extract to `modules/board/renderer.js`
- [ ] Add folding state management (port from V1 `foldingStateManager.js`)
- [ ] Add incremental update functions

---

### Step 4: Create `modules/dnd/drag.js`

**Extract from app.js lines ~6000-7500**

**Current state in app.js:**
```javascript
var ptrDrag = null; // { type, source, startX, startY, started, ghost, el }

// Functions:
onPointerDown(e)
onPointerMove(e)
onPointerUp(e)
createGhost(element)
updateGhostPosition(x, y)
```

**V1 has additional features:**
- External file drops with dialog
- Template drops
- Clipboard drops
- Drop indicator management
- Row/position tracking

**TODO Items:**
- [ ] Find `onPointerDown` in app.js
- [ ] Find `onPointerMove` function
- [ ] Find `onPointerUp` function
- [ ] Extract to `modules/dnd/drag.js`
- [ ] Port external file drop handling from V1 `dragDrop.js`
- [ ] Port template drop handling

---

## Detailed TODO: Port WYSIWYG Editor

### V1 Files to Port

| V1 File | Lines | Purpose | V2 Target |
|---------|-------|---------|-----------|
| `src/wysiwyg/types.ts` | 50 | Type definitions | `wysiwyg/types.js` |
| `src/wysiwyg/spec.ts` | 300 | Schema spec | `wysiwyg/spec.js` |
| `src/wysiwyg/pipeline.ts` | 100 | Main pipeline | `wysiwyg/pipeline.js` |
| `src/wysiwyg/markdownItFactory.ts` | 80 | markdown-it setup | `wysiwyg/markdownItFactory.js` |
| `src/wysiwyg/markdownItAdapter.ts` | 30 | Token adapter | `wysiwyg/markdownItAdapter.js` |
| `src/wysiwyg/tokenParser.ts` | 500 | Token → Doc | `wysiwyg/tokenParser.js` |
| `src/wysiwyg/prosemirrorAdapter.ts` | 80 | PM conversion | `wysiwyg/prosemirrorAdapter.js` |
| `src/wysiwyg/prosemirrorSchema.ts` | 300 | PM schema | `wysiwyg/prosemirrorSchema.js` |
| `src/wysiwyg/nodeViews.ts` | 450 | Custom views | `wysiwyg/nodeViews.js` |
| `src/wysiwyg/inputRules.ts` | 350 | Shortcuts | `wysiwyg/inputRules.js` |
| `src/wysiwyg/commands.ts` | 250 | Formatting | `wysiwyg/commands.js` |
| `src/wysiwyg/normalizer.ts` | 400 | Cleanup | `wysiwyg/normalizer.js` |
| `src/wysiwyg/serializer.ts` | 350 | Doc → MD | `wysiwyg/serializer.js` |
| `src/wysiwyg/markdownItPlugins.ts` | 600 | Plugins | `wysiwyg/markdownItPlugins.js` |

**Total: ~3,800 lines**

### Step-by-Step Port

**Step 1: Core Types (1 day)**
```bash
# Convert TypeScript to JavaScript
cp src/wysiwyg/types.ts lexera-kanban/src/wysiwyg/types.js
# Remove type annotations manually or use tsc --declaration
```

**TODO:**
- [ ] Copy `types.ts` to `wysiwyg/types.js`
- [ ] Remove TypeScript syntax (`: Type`, `interface`, `type`)
- [ ] Export `WysiwygNode`, `WysiwygDoc`, `WysiwygMark`

**Step 2: Schema Spec (1 day)**
- [ ] Copy `spec.ts` to `wysiwyg/spec.js`
- [ ] Convert `wysiwygSchemaSpec` object
- [ ] Convert `tokenMappings` array

**Step 3: Pipeline (2 days)**
- [ ] Copy `pipeline.ts` to `wysiwyg/pipeline.js`
- [ ] Copy `markdownItFactory.ts`
- [ ] Copy `markdownItAdapter.ts`
- [ ] Test: `markdownToWysiwygDoc('test')` returns doc

**Step 4: Token Parser (3 days)**
- [ ] Copy `tokenParser.ts` to `wysiwyg/tokenParser.js`
- [ ] This is the most complex file
- [ ] Test with all token types from spec

**Step 5: ProseMirror Integration (2 days)**
- [ ] Copy `prosemirrorAdapter.ts`
- [ ] Copy `prosemirrorSchema.ts`
- [ ] Copy `nodeViews.ts`
- [ ] Test: Editor renders with content

**Step 6: Editor Features (2 days)**
- [ ] Copy `inputRules.ts`
- [ ] Copy `commands.ts`
- [ ] Copy `normalizer.ts`
- [ ] Test: Shortcuts work (*, **, #)

**Step 7: Serializer (1 day)**
- [ ] Copy `serializer.ts`
- [ ] Test round-trip: MD → Doc → MD

---

## Detailed TODO: Port Dashboard Scanner

### V1 Analysis

**File:** `src/dashboard/DashboardScanner.ts` (557 lines)

**Dependencies:**
- `src/dashboard/DashboardTypes.ts` - Type definitions
- `@ludos/shared` - `extractTemporalInfo`, `resolveTaskTemporals`

**Key Functions:**
```typescript
class DashboardScanner {
  scanForUpcomingItems(board, options): UpcomingItem[]
  scanForTags(board): BoardTagSummary
  isWithinTimeframe(date, days): boolean
  classifyRecurringState(date, checked, isWeekly): RecurringClassification
}

// Helpers
extractTemporalInfo(content): TemporalInfo[]
resolveTaskTemporals(content, columnTitle): ResolvedTemporal[]
```

### V2 Target: Rust

**File:** `lexera-core/src/dashboard/scanner.rs`

**TODO:**

1. **Create module structure (0.5 day)**
   - [ ] `lexera-core/src/dashboard/mod.rs`
   - [ ] `lexera-core/src/dashboard/types.rs`
   - [ ] `lexera-core/src/dashboard/scanner.rs`
   - [ ] `lexera-core/src/dashboard/temporal.rs`

2. **Port types (0.5 day)**
   - [ ] `UpcomingItem` struct
   - [ ] `BoardTagSummary` struct
   - [ ] `TagInfo` struct
   - [ ] `ScanOptions` struct
   - [ ] `RecurringState` enum

3. **Port temporal resolution (2 days)**
   - [ ] Port `extractTemporalInfo()` to Rust
   - [ ] Port `resolveTaskTemporals()` to Rust
   - [ ] Handle temporal inheritance (column → task → line)
   - [ ] Handle time-only tags inheriting date

4. **Port scanner (1.5 days)**
   - [ ] `DashboardScanner::new()`
   - [ ] `scan_for_upcoming()`
   - [ ] `scan_for_tags()`
   - [ ] `classify_recurring_state()`

5. **Add API endpoint (0.5 day)**
   - [ ] `GET /api/dashboard/upcoming`
   - [ ] `GET /api/dashboard/tags`

---

## Detailed TODO: Port Gather Query Engine

### V1 Analysis

**File:** `src/board/GatherQueryEngine.ts` (396 lines)

**Key Functions:**
```typescript
class GatherQueryEngine {
  performAutomaticSort(board): boolean
  _processTemporalQuery(query, column, rules): void
  _parseGatherExpression(expr): TaskEvaluator
  _splitByOperator(expr, op): string[]
  _createComparisonEvaluator(prop, op, value): TaskEvaluator
  _sortColumnByDate(column): void
  _sortColumnByName(column): void
}
```

**Query Syntax:**
- `?#tagname` - Match #tag
- `?@today` - Match today's date
- `?@day<3` - Match within 3 days
- `?@w5` - Match week 5
- `?@mon` - Match Monday
- `#ungathered` - Collect unmatched
- `#sort-bydate` - Sort by date
- `#sort-byname` - Sort by name

### V2 Target: Rust

**File:** `lexera-core/src/gather/mod.rs`

**TODO:**

1. **Create module (0.5 day)**
   - [ ] `lexera-core/src/gather/mod.rs`
   - [ ] `lexera-core/src/gather/types.rs`
   - [ ] `lexera-core/src/gather/engine.rs`
   - [ ] `lexera-core/src/gather/parser.rs`

2. **Port types (0.5 day)**
   - [ ] `GatherRule` struct
   - [ ] `GatherRuleType` enum
   - [ ] `TaskEvaluator` trait

3. **Port rule extraction (1 day)**
   - [ ] Extract `?#` tag queries
   - [ ] Extract `?@` temporal queries
   - [ ] Extract `#ungathered`
   - [ ] Extract `#sort-*`

4. **Port expression parser (1.5 days)**
   - [ ] `_parseGatherExpression()`
   - [ ] Handle AND (`&`), OR (`|`), NOT (`!`)
   - [ ] Handle comparisons (`=`, `!=`, `<`, `>`)
   - [ ] Handle ranges (`0<day<3`)

5. **Port task matching (1 day)**
   - [ ] Match tag rules
   - [ ] Match temporal rules
   - [ ] Handle sticky tasks
   - [ ] Apply moves

6. **Port column sorting (0.5 day)**
   - [ ] `sort_by_date()`
   - [ ] `sort_by_name()`

---

## Detailed TODO: Port ludos-sync to Rust

### iCal Mapper

**V1 File:** `packages/ludos-sync/src/mappers/IcalMapper.ts` (340 lines)

**Key Functions:**
```typescript
class IcalMapper {
  static columnsToIcalTasks(columns, boardId, lastModified): IcalTask[]
  static generateCalendar(tasks, calendarName): string
  static generateSingleIcs(task): string
}

// Helpers
parseTimeRange(timeSlot): { startH, startM, endH, endM }
formatIcalDate(date): string
formatDtstamp(date): string
generateUid(boardId, columnTitle, firstLine, occurrence): string
extractHashTags(content): string[]
foldLine(line): string
escapeIcalText(text): string
```

**V2 Target:** `lexera-core/src/export/ical.rs`

**TODO:**

1. **Create module (0.5 day)**
   - [ ] `lexera-core/src/export/mod.rs`
   - [ ] `lexera-core/src/export/ical.rs`

2. **Add dependencies to Cargo.toml**
   - [ ] `chrono` - Date/time handling
   - [ ] `sha2` - UID generation
   - [ ] `regex` - Tag extraction

3. **Port types (0.5 day)**
   - [ ] `IcalTask` struct
   - [ ] `IcalMapper` struct

4. **Port core functions (2 days)**
   - [ ] `columns_to_ical_tasks()`
   - [ ] `generate_calendar()`
   - [ ] `generate_single_ics()`

5. **Port helpers (1 day)**
   - [ ] `parse_time_range()`
   - [ ] `format_ical_date()`
   - [ ] `generate_uid()`
   - [ ] `fold_line()`
   - [ ] `escape_ical_text()`

---

## Summary: Actionable TODO List

### Immediate (Week 1-2)

1. **Refactor app.js into modules**
   - [ ] Create `modules/state.js`
   - [ ] Extract board loader to `modules/board/loader.js`
   - [ ] Extract board renderer to `modules/board/renderer.js`
   - [ ] Extract DnD to `modules/dnd/`

2. **Fix critical issues**
   - [ ] Fix CRDT unwraps in `lexera-core/src/crdt/bridge.rs`
   - [ ] Fix iOS lock poisoning in `lexera-core/src/storage/local.rs`

### Short-term (Week 3-4)

3. **Port WYSIWYG Editor**
   - [ ] Copy types.js, spec.js
   - [ ] Copy pipeline.js, tokenParser.js
   - [ ] Copy ProseMirror integration
   - [ ] Test round-trip

4. **Port Dashboard Scanner to Rust**
   - [ ] Create dashboard module
   - [ ] Port temporal resolution
   - [ ] Port scanner logic
   - [ ] Add API endpoint

### Medium-term (Week 5-8)

5. **Port Gather Query Engine to Rust**
   - [ ] Create gather module
   - [ ] Port expression parser
   - [ ] Port task matching

6. **Port iCal Mapper to Rust**
   - [ ] Create export module
   - [ ] Port IcalMapper

7. **Bundle marp-engine as sidecar**
   - [ ] Copy marp-engine to sidecars/
   - [ ] Create marpSidecar.js wrapper
   - [ ] Update exportService.js

### Long-term (Week 9-12)

8. **Port CalDAV/WebDAV to Rust**
   - [ ] Create caldav module
   - [ ] Create webdav module
   - [ ] Port XBEL mapper

9. **Plugin System**
   - [ ] Create plugin interfaces
   - [ ] Create PluginRegistry
   - [ ] Migrate existing features to plugins
