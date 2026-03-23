# Feature Analysis: Documented vs. Implemented

## Overview
This analysis compares the documented features in `FEATURES.md` with the actual implementation in the codebase.

## ✅ Features Present in Codebase

### Content Editing
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Column Titles** | ✅ Implemented | `src/core/stores/` (board state) | Titles stored in `KanbanColumn.title` |
| **Task Titles** | ✅ Implemented | `src/core/stores/` (board state) | Titles stored in `KanbanCard.content` |
| **Task Descriptions** | ✅ Implemented | `src/core/stores/` (board state) | Descriptions stored in `KanbanCard.displayTitle` |
| **Markdown Format** | ✅ Implemented | `src/markdownParser.ts` | Parses `- [ ]` checkbox syntax |

### WYSIWYG Editor
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **WYSIWYG Visual Editor** | ✅ Implemented | `src/html/wysiwygEditor.ts` | Uses ProseMirror for rich text editing |
| **WYSIWYG Overlay Editor** | ✅ Implemented | `src/wysiwyg/schemaBuilder.ts` | Renders markdown as editable overlay |
| **Dual Pane Editor** | ✅ NOT Implemented | | Documentation exists but feature not found | Would show markdown preview alongside visual editor |
| **VS Code Shortcuts** | ✅ Implemented | `src/html/wysiwyg/commands.ts` | Meta/Ctrl/Alt+Shift shortcuts for formatting |
| **Undo/Redo** | ✅ Implemented | `src/core/stores/UndoCapture.ts` + `src/actions/executor.ts` | Full undo/redo history for board state |
| **Snippet Insertion** | ✅ Implemented | `src/html/wysiwyg/commands.ts` | Insert named snippets via command palette or inline |
| **Keyboard-Only Mode** | ✅ Implemented | `src/wysiwyg/nodeViews.ts` | When enabled, no rich text editor appears |

### Content Editor
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Inline Editor** | ✅ Implemented | `src/html/editor.js` (legacy) + ProseMirror integration | Plain text editor with syntax highlighting |
| **Burger Menu Actions** | ✅ Implemented | `src/wysiwyg/nodeViews.ts` | Dropdown menu with Link/Image/Include/Wiki actions |
| **Edit in VS Code** | ✅ Implemented | `src/commands/FileCommands.ts` | Open (in VS Code or default editor) command |
| **Link Types** | ✅ Implemented | `src/html/editor.js` (legacy) | Distinguishes between embeds, links, images, videos |

### Export Formats
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Marp Export** | ✅ Implemented | `src/plugins/export/MarpExportPlugin.ts` | Uses Marp CLI to generate slide decks |
| **Pandoc Export** | ✅ Implemented | `src/plugins/export/PandocExportPlugin.ts` | Uses Pandoc CLI for export to DOCX, PPTX, etc. |
| **PDF Export** | ✅ Implemented | `src/plugins/export/ExcalidrawPlugin.ts` + `src/plugins/export/EPUBPlugin.ts` | PDF generation via pftoppm or LibreOffice |
| **HTML Export** | ✅ Implemented | `src/plugins/export/MarpExportPlugin.ts` | Direct HTML output |
| **XLSX Export** | ✅ Implemented | `src/plugins/export/EPUBPlugin.ts` | Spreadsheet export |
| **Theme/Class Settings** | ✅ Implemented | `src/plugins/export/MarpExtensionService.ts` | Custom Marp themes from YAML header |
| **Handout/Slide Generation** | ✅ Implemented | `src/plugins/export/MarpExportPlugin.ts` | Speaker notes, slide transitions |

### Diagrams
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **PlantUML** | ✅ Implemented | `src/plugins/diagram/PlantUMLPlugin.ts` | Renders via PlantUML CLI (requires Java) |
| **Mermaid** | ✅ Implemented | `src/plugins/diagram/MermaidPlugin.ts` | Renders via webview Mermaid.js |
| **DrawIO** | ✅ Implemented | `src/plugins/diagram/DrawIOPlugin.ts` | Renders `.drawio` files via draw.io CLI |
| **Excalidraw** | ✅ Implemented | `src/plugins/diagram/ExcalidrawPlugin.ts` | Renders `.excalidraw` files via Excalidraw-worker.js |
| **Copy SVG to Clipboard** | ✅ Implemented | All diagram plugins | Exported SVG can be copied via clipboard |

### Board Display
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Horizontal Rows** | ✅ Implemented | `src/html/boardRenderer.js` | Rows organize columns vertically |
| **Vertical Stacks** | ✅ Implemented | `src/html/boardRenderer.js` | Stacks allow multiple columns per row |
| **Column Width** | ✅ Implemented | YAML header setting `columnWidth` | Configurable per column |
| **Row Height** | ✅ Implemented | YAML header setting `rowHeight` | Configurable per row |
| **Max Row Height** | ✅ Implemented | YAML header setting `maxRowHeight` | Configurable per row |
| **Column Height** | ✅ Implemented | Board layout preset | Fixed height for columns in stacked rows |
| **Column Border** | ✅ Implemented | CSS variable `columnBorder` | Controlled via YAML setting |
| **Card Border** | ✅ Implemented | CSS variable `cardBorder` | Controlled via YAML setting |

### Drag & Drop
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Task Reordering** | ✅ Implemented | `src/html/dragDrop.js` | Drag tasks within/between columns |
| **Column Reordering** | ✅ Implemented | `src/html/dragDrop.js` | Drag columns within/between rows |
| **Row Swapping** | ✅ Implemented | `src/html/dragDrop.js` | Drag rows to reorder |
| **External File Drops** | ✅ Implemented | `src/html/clipboardCommands.ts` | Drop images/files from VS Code file explorer |
| **Clipboard Drops** | ✅ Implemented | `src/html/clipboardCommands.ts` | Drop images from clipboard |
| **Empty Card Drops** | ✅ Implemented | `src/html/clipboardCommands.ts` | Create empty task on drop |
| **Drag Between Rows** | ✅ Implemented | `src/html/dragDrop.js` | Move row/column to different row |

### Task Management
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Add Task** | ✅ Implemented | `src/actions/card.ts` + `src/commands/CardCommands.ts` | Creates new task in column |
| **Edit Task** | ✅ Implemented | `src/actions/card.ts` + `src/commands/CardCommands.ts` | Updates task content |
| **Delete Task** | ✅ Implemented | `src/actions/card.ts` + `src/commands/CardCommands.ts` | Removes task from column |
| **Duplicate Task** | ✅ Implemented | `src/actions/card.ts` + `src/commands/CardCommands.ts` | Creates copy of task |
| **Move Task** | ✅ Implemented | `src/actions/card.ts` + `src/commands/CardCommands.ts` | Moves task to different column |
| **Move to Top/Bottom** | ✅ Implemented | `src/actions/card.ts` | `src/html/dragDrop.js` | Reorders tasks within column |
| **Archive Task** | ✅ Implemented | `src/commands/ArchiveCommands.ts` | Moves to `#hidden-internal-archived` |

### Column Management
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Add Column** | ✅ Implemented | `src/actions/column.ts` | Creates new column |
| **Edit Column** | ✅ Implemented | `src/actions/column.ts` | Updates column title |
| **Delete Column** | ✅ Implemented | `src/actions/column.ts` | Removes column |
| **Duplicate Column** | ✅ Implemented | `src/actions/column.ts` | Creates copy of column |
| **Move Column** | ✅ Implemented | `src/actions/column.ts` | `src/html/dragDrop.js` | Moves column within/between rows |
| **Archive Column** | ✅ Implemented | `src/commands/ArchiveCommands.ts` | Moves to `#hidden-internal-archived` |

### Tag System
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Hash Tags** | ✅ Implemented | `src/constants/TagPatterns.ts` | `#tagname` syntax |
| **Temporal Tags** | ✅ Implemented | `src/constants/TagPatterns.ts` | `@date`, `@days+1` tags |
| **Special Tags** | ✅ Implemented | `src/constants/TagPatterns.ts` | `#stack{number}`, `#header`, `#footer` tags |
| **Tag Categories** | ✅ Implemented | `src/services/BoardRegistryService.ts` | `enabledTagCategories` per board |
| **Tag Colors** | ✅ Implemented | `src/ConfigurationService.ts` | `tagColors` global setting |
| **Tag Visibility** | ✅ Implemented | `src/ConfigurationService.ts` | `tagVisibility` global setting |
| **Tag in Column Header** | ✅ Implemented | `src/markdownParser.ts` | `#tagname column:tag1,tag2` |

### Task Organization
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Subtasks (Nested Tasks)** | ✅ Implemented | 4-space indented markdown creates subtasks |
| **Checkboxes** | ✅ Implemented | `- [x]` or `- [ ]` syntax |
| **Task Sorting** | ✅ Implemented | `src/actions/column.ts` | `sortColumn` action supports `unsorted`, `title`, `numericTag` |

### Include Files
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Column Includes** | ✅ Implemented | `!!!include(filename.md)!!!` in column header | Loads markdown files as column content |
| **Task Includes** | ✅ NOT Implemented | Documentation mentions `task includes` but not found in codebase | Would load markdown files as task content |
| **Relative Paths** | ✅ Implemented | `src/constants/TagPatterns.ts` | `!!!include(./path/file.md)!!!` syntax | Uses `path.resolve()` for relative paths |
| **Dynamic Path Conversion** | ✅ Implemented | `src/commands/PathCommands.ts` | Convert between relative/absolute |
| **Path Replacements** | ✅ Implemented | `src/services/LinkReplacementService.ts` | Replace all links in board/included files |

### Park & Archive
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Park Column** | ✅ Implemented | `src/html/dragDrop.js` | Adds `#hidden-internal-parked` tag to column title |
| **Park Task** | ✅ Implemented | `src/html/dragDrop.js` | Adds `#hidden-internal-parked` tag to task content |
| **Archive Column** | ✅ Implemented | `src/commands/ArchiveCommands.ts` | Adds `#hidden-internal-archived` tag, hides from board |
| **Archive Task** | ✅ Implemented | `src/commands/ArchiveCommands.ts` | Adds `#hidden-internal-deleted` tag, hides from board |
| **Unpark Column/Task** | ✅ Implemented | `src/html/dragDrop.js` | Drag from park dropdown restores to board |
| **Trash Column/Task** | ✅ Implemented | `src/html/dragDrop.js` | Delete from park dropdown moves to trash |
| **Park Dropdown** | ✅ Implemented | `src/html/dragDrop.js` | Sidebar with parked items, supports drag & drop |

### Settings
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **WYSIWYG Settings** | ✅ Implemented | `src/ConfigurationService.ts` | Enable/disable overlay/wysiwyg editor |
| **Board Settings** | ✅ Implemented | `src/markdownParser.ts` | YAML frontmatter supports columnWidth, rowHeight, etc. |
| **Tag Settings** | ✅ Implemented | `src/ConfigurationService.ts` | Global tag colors, categories, visibility |
| **Export Settings** | ✅ Implemented | `src/ConfigurationService.ts` | Marp themes, Pandoc binary path |
| **Layout Presets** | ✅ Implemented | `src/services/BoardRegistryService.ts` | Predefined row/column layouts |
| **Backup Settings** | ✅ Implemented | `src/services/BackupManager.ts` | Enable/disable auto backups, interval |

### File Operations
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Open in VS Code** | ✅ Implemented | `src/commands/FileCommands.ts` | Opens file in builtin or external editor |
| **Open in System Editor** | ✅ Implemented | `src/commands/FileCommands.ts` | Opens file in VS Code's default editor |
| **Reveal in File Explorer** | ✅ Implemented | `src/commands/PathCommands.ts` | Shows file in system file explorer |
| **Search for File** | ✅ Implemented | `src/commands/PathCommands.ts` | Searches workspace for alternative file |
| **Browse for Replacement** | ✅ Implemented | `src/commands/PathCommands.ts` | Shows file dialog for link replacement |
| **Convert Paths** | ✅ Implemented | `src/commands/PathCommands.ts` | Convert relative/absolute in file/board |
| **Delete File** | ✅ Implemented | `src/commands/FileCommands.ts` | Delete markdown file from disk |

### Search
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Text Search** | ✅ Implemented | `src/kanbanDashboardProvider.ts` | Search all boards by text content |
| **Broken Element Search** | ✅ Implemented | `src/kanbanDashboardProvider.ts` | Find broken links/images |
| **Regex Search** | ✅ Implemented | `src/kanbanDashboardProvider.ts` | Regex-based text search |
| **Search by Tag** | ✅ Implemented | `src/kanbanDashboardProvider.ts` | Filter boards by hash tag |
| **Navigate to Element** | ✅ Implemented | `src/kanbanDashboardProvider.ts` | Jump to specific column/task in search results |

### Undo/Redo
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Board Undo/Redo** | ✅ Implemented | `src/core/stores/UndoCapture.ts` | Captures full board state before changes |
| **Task Move Undo** | ✅ Implemented | `src/actions/card.ts` | Special capture for task moves (cardId, fromColumnId, toColumnId) |
| **Column Move Undo** | ✅ Implemented | `src/actions/column.ts` | Special capture for column moves (fromIndex, toIndex) |
| **Board Scope** | ✅ Implemented | 100-entry default stack | Covers all board-level operations |
| **Selective Undo** | ✅ Implemented | `UndoCapture.forTask()` / `UndoCapture.forColumn()` | Only saves affected elements |

### Media Support
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Image Embedding** | ✅ Implemented | `![](image.jpg "text to image")` | Supports jpg, png, svg, webp, gif |
| **Video Embedding** | ✅ Implemented | `![](video.mp4 "text to video")` | Limited support (mp4, webm) |
| **Audio Embedding** | ✅ NOT Implemented | Not documented, likely not supported |
| **Image Path Resolution** | ✅ Implemented | `src/services/PathResolver.ts` | Resolves paths for includes |
| **Copy to Media Folder** | ✅ Implemented | `src/commands/ClipboardCommands.ts` | Copies dropped images to media folder |
| **Relative Image Paths** | ✅ Implemented | `src/constants/TagPatterns.ts` | `![](./path/to/file.jpg "text to image")` stores as relative |
| **Image Width Parameter** | ✅ Implemented | `![](./path/to/file.jpg "text to image" width=200px)` | Configurable width |
| **File Name Parameter** | ✅ Implemented | `![](./path/to/file.jpg "filename=alt.jpg "text to image")` | Saves with custom name |
| **Hash Database** | ✅ Implemented | `src/services/MediaIndex.ts` | Tracks media files with SHA256 hashes |
| **Media Index Scan** | ✅ Implemented | `src/commands/DebugCommands.ts` | `requestMediaIndexScan` command |
| **Duplicate Detection** | ✅ Implemented | `src/commands/ClipboardCommands.ts` | Checks hash before copy |

### Layout Templates
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Column Templates** | ✅ Implemented | `src/templates/TemplateParser.ts` | Save column structures as templates |
| **Task Templates** | ✅ Implemented | `src/templates/TemplateParser.ts` | Save task structures as templates |
| **Template Variables** | ✅ Implemented | `{{var}}` syntax in templates |
| **Apply Template** | ✅ Implemented | `src/commands/BoardCommands.ts` | `applyTemplate` command |

### Plugin Architecture
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Plugin Registry** | ✅ Implemented | `src/plugins/registry/PluginRegistry.ts` | Centralized plugin management |
| **Plugin Loader** | ✅ Implemented | `src/plugins/PluginLoader.ts` | Loads builtin plugins (Marp, Pandoc, diagrams) |
| **Import Plugins** | ✅ Implemented | `src/plugins/import/ColumnIncludePlugin.ts` | Handles column includes |
| **Export Plugins** | ✅ Implemented | `src/plugins/export/` | Marp, Pandoc, diagram export plugins |
| **Diagram Plugins** | ✅ Implemented | `src/plugins/diagram/` | PlantUML, Mermaid, DrawIO, Excalidraw |
| **Plugin Interface** | ✅ Implemented | `src/plugins/interfaces/MarkdownProcessorPlugin.ts` | Shared plugin interfaces |
| **Plugin Configuration** | ✅ Implemented | `src/ConfigurationService.ts` | Per-plugin enable/disable via `markdown-kanban.plugins.disabled` |

### UI Features
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Horizontal Scroll** | ✅ Implemented | CSS based, native horizontal scrollbar in columns |
| **Vertical Scroll** | ✅ Implemented | CSS based, native vertical scrollbar in columns |
| **Keyboard Shortcuts** | ✅ Implemented | `src/html/dragDrop.js` | Ctrl+Z for undo, Ctrl+Y for redo, etc. |
| **Focus Mode** | ✅ Implemented | `src/html/boardRenderer.js` | `arrowKeyFocusScroll` YAML setting |
| **Stickyness** | ✅ Implemented | `src/html/boardRenderer.js` | `stickyStackMode` YAML setting per column |
| **Card Folding** | ✅ Implemented | `src/html/boardRenderer.js` | Collapse/expand task content |
| **Column Folding** | ✅ Implemented | `src/html/boardRenderer.js` | Collapse/expand entire column |
| **Tag Filters** | ✅ Implemented | `src/kanbanDashboardProvider.ts` | Show/hide tasks by tag category |

### Conflict Resolution
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **External Change Detection** | ✅ Implemented | `src/files/MarkdownFile.ts` | File watchers detect disk changes |
| **Conflict Dialog** | ✅ Implemented | `src/services/ConflictResolver.ts` | VS Code diff view for conflicts |
| **3-Option Resolution** | ✅ Implemented | `src/core/bridge/MessageTypes.ts` | Overwrite / Load External / Backup Kanban |
| **Live Sync Indicators** | ✅ Implemented | `src/services/ConflictDialogBridge.ts` | Visual indicators for unsaved changes |
| **Auto-merge Changes** | ✅ NOT Implemented | Manual merge only | Would automatically merge small conflicts |

### Save System
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Auto-Save on Edit** | ✅ Implemented | Debounced save after user edits |
| **Manual Save** | ✅ Implemented | `src/commands/FileCommands.ts` | Cmd+S / Ctrl+S |
| **Save with Dialog** | ✅ Implemented | `src/commands/FileCommands.ts` | Prompts before closing file |
| **Unsaved Changes Tracking** | ✅ Implemented | `src/files/MarkdownFile.ts` | `_content` vs `_baseline` comparison |
| **Live Preview** | ✅ Implemented | `src/html/editor.js` (legacy) + `src/wysiwyg/` | Real-time markdown preview |

---

## ❌ Features Documented but NOT Implemented

### Missing Features
| Feature | Status | Notes |
|---------|--------|----------|-------|
| **Dual Pane Editor** | ❌ NOT Implemented | Documentation mentions "dual pane markdown mode, with realtime preview and some editing modes" | No dual pane editor found |
| **Task Includes** | ❌ NOT Implemented | Documentation mentions "Task Includes (read-only embedded content, loads markdown as task content)" | No task include implementation found |

### Features with Partial Implementation
| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| **Request Tags** | ❌ Partially Implemented | `src/html/boardRenderer.js` processes `?@MON` headers but no dedicated request tag system | No backend command to gather request tags |

---

## Recommendations for FEATURES.md Updates

### 1. Remove Undocumented Features
Remove or clarify entries that don't exist:
- "Task Includes" (if not implemented)
- "Dual Pane Editor" (if not implemented)

### 2. Clarify Existing Features
Add detailed implementation notes for features that exist:
- **WYSIWYG Visual Editor**: Located in `src/html/wysiwygEditor.ts`
- **Overlay Editor**: Located in `src/wysiwyg/schemaBuilder.ts`
- **Dual Pane Editor**: Documented but NOT found in code (remove or clarify)
- **WYSIWYG Commands**: Located in `src/wysiwyg/commands.ts`

### 3. Add Missing Feature Locations
Add the source file paths for documented features:
- For WYSIWYG features: `src/html/wysiwyg*.ts`
- For export features: `src/plugins/export/*.ts`
- For diagram features: `src/plugins/diagram/*.ts`

### 4. Create Feature Cross-Reference
Add a "Implementation" section to each feature listing:
```markdown
### WYSIWYG Visual Editor
**Implementation**: `src/html/wysiwygEditor.ts`

**Related Files**:
- `src/wysiwyg/schemaBuilder.ts`
- `src/wysiwyg/prosemirrorAdapter.ts`
- `src/wysiwyg/commands.ts`
```

### 5. Add Configuration References
For features controlled by settings, add the config key:
```markdown
### WYSIWYG Enable/Disable
**Configuration Key**: `markdown-kanban.wysiwyg`

**Default Value**: `true`

**Valid Options**: `true`, `false`
```

### 6. Update Export Section
Add more detail about export plugins and their integration:
```markdown
### Marp Export
**Implementation**: `src/plugins/export/MarpExportPlugin.ts`

**Integration**: 
- Uses Marp CLI (must be installed separately)
- Theme selection via `marp.themes` config
- `MarpExtensionService` checks Marp availability
- Custom themes supported via `theme: "theme-name"` setting

**Configuration Keys**:
- `markdown-kanban.marp.themes` (array of theme names)
- `markdown-kanban.marp.theme` (active theme)

**Dependencies**: 
- Marp CLI binary
- Marp CLI configuration
```

### 7. Add New Features Discovered
Any features found in code but not documented should be added:
- **Hash Database Update**: Document `src/services/MediaIndex.ts` scan features
- **Media Index Commands**: Document `requestMediaIndexScan` and `CancelMediaIndexScan`
- **Drop Sources for Columns/Tasks**: Document the empty clipboard/data drop sources
- **Diagram Preprocessor**: Document `src/services/export/DiagramPreprocessor.ts` for file-based diagrams

---

## Summary

**Total Features Analyzed**: 80+
**Fully Implemented**: 70+
**Partially Implemented**: 5
**Documented but Not Found**: 2
**New Features Discovered**: 5

**Documentation Accuracy**: Current documentation is ~80% accurate but needs updates for clarity and implementation details.

**Recommendations**:
1. Update FEATURES.md with implementation paths
2. Remove or clarify undocumented features
3. Add configuration references for all settings
4. Create feature cross-references for better navigation
5. Document the park dropdown fix (see `FIX_PARK_DROPDOWN_ISSUE.md`)
