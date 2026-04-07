# Export UI Specification

**Status**: ✅ Baseline  
**V2 Target**: `lexera-kanban` (UI), `lexera-backend` (pipeline)  
**V1 Reference**: `src/html/exportMarpUI.js` (~2,147 lines)  
**Dependencies**: [Content Plugins](../plugins/content/SPEC.md), Marp engine, Pandoc

---

## UX Requirements

### Export Dialog #Reto
- User opens export dialog using export from board main menu or from rows, stacks, columns (which then selects them directly)
- dropdown - "export presets"
  - marp presentation
  - marp pdf
  - share content
  - custom settings
- dropdown - "export format"
  - keep original format
  - convert to kanban format
  - convert to marp format
  - convert to document format
- dropdown - "tag visibility"
  - all tags
  - all excluding layout
  - custom tags only 
  - @tags only
  - no tags
- checkbox - "to exclude content with tags"
  - a list of defineable tags, default is #exclude
- checkbox - "auto-export on save (re-export on saving until stopped)"
- checkbox - "merge includes into main file"
- dropdown - "marp notes (;;)"
  - keep style (;;)
  - comment (<!-- -->)
  - remove
- dropdown - "html comments"
  - keep (<!-- -->)
  - remove
- dropdown - "html content"
  - keep (<>)
  - remove
- dropdown - "embeds (iframes)"
  - show url link
  - use fallback image
  - remove
- checkbox - "use marp"
  - dropdown - "output format"
    - pdf
    - html
    - powerpoint
  - dropdown - *marp theme*
    - default
    - gaia
    - roboto-light
  - dropdown - "Browser"
    - chrome
    - edge
    - firefox
    - auto-detect
  - checkbox - "live preview (--preview)" : only available when html output format is selected
  - checkbox - "Editable (--pptx-editable)" : only available when powerpoint output format is selected
  - checkbox - "Handout PDF (slides + notes)" : only available when pdf output format is selected
- checkbox - "Use Pandoc (requires document format)"
  - Dropdown - "output format"
    - "Word document"
    - "open document"
    - "Epub"
  - Dropdown - "Page Breaks"
    - Continuous
    - Page per Task
    - Page per Column
- "Select Content to Export:"
  - Tree view structure to select the elements (Full-Board, Rows, Stacks, Columns) to export 
- string - "Export Folder:" : with "Browse" button
- Dropdown - "Link & Asset Handling:"
  - "Rewrite Relative Links"
  - "Pack Embedded and Linked Files"
    - Checkbox - Included files
    - Checkbox - Images
    - Checkbox - Videos
    - Checkbox - Other Media
    - Checkbox - Documents
    - Number - "File Size Limit (MB):" : default 100 mb
  - "Dont Modify Links"
- Button - Export : starts export

### Export Formats
- **Markdown**: Plain markdown output
- **HTML**: Rendered HTML with styling
- **PDF**: Via Marp or Pandoc
- **PPTX**: PowerPoint via Marp
- **DOCX**: Word via Pandoc

### Marp Integration
- User configures Marp directives (theme, paginate, header)
- Marp classes for elements (lead, invert, blue)
- Theme selection from available Marp themes
- Handout generation options

### Auto-Export
- User enables auto-export for live preview
- System exports on every change
- Browser mode for opening output folder

### Tag Filtering
- User controls which tags appear in export
- Options: all, allexcludinglayout, customonly, mentionsonly, none
- Custom exclude tags list

---

## Architecture

### Export Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXPORT FLOW                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   showExportDialog() / showExportDialogWithSelection()          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Initialize       │  Export tree, load settings              │
│   │ dialog           │  Check Marp/Pandoc status                │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ User configures  │  Format, folder, options                 │
│   │ options          │  Marp directives, tag filtering          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Execute export   │  executeUnifiedExport()                  │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Build request    │  Selected items, settings                │
│   │                  │  Filter tags, resolve paths              │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Send to backend  │  vscode.postMessage()                    │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   handleExportResult(result)                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Functions

### Dialog Management

```javascript
// Show export dialog
function showExportDialog()
function showExportDialogWithSelection(scope, index, id)

// Close dialog
function closeExportModal()

// Initialize export tree
function initializeExportTree(preSelectNodeId)
```

### Export Execution

```javascript
// Main export function
function executeUnifiedExport()

// Handle result
function handleExportResult(result)

// Quick export (no dialog)
function executeQuickExport()

// Export single column
function exportColumn(columnId)

// Column include click handler
function handleColumnIncludeClick(event, filePath)
```

### Folder Management

```javascript
// Generate folder name
function generateExportFolderName(selectedLabels)

// Update folder input
function updateExportFolderName()

// Select folder dialog
function selectExportFolder()

// Set selected folder
function setSelectedExportFolder(folderPath)

// Get workspace path
function getWorkspacePath()
```

### Tag Filtering

```javascript
// Filter tags based on visibility setting
function filterTagsForExport(text, tagVisibility)

// Parse exclude tags input
function parseExcludeTags(input)
```

### Format Handling

```javascript
// Handle format change
function handleFormatChange()

// Handle Marp toggle
function handleUseMarpChange()

// Handle Pandoc toggle
function handleUsePandocChange()

// Handle Marp output format
function handleMarpOutputFormatChange()

// Handle handout options
function handleMarpHandoutChange()
function handleMarpHandoutPresetChange()
```

### Presets

```javascript
// Apply preset
function applyExportPreset()

// Built-in presets
function applyPresetMarpPresentation()
function applyPresetMarpPdf()
function applyPresetShareContent()

// Reset to custom
function resetPresetToCustom()
```

### Settings Persistence

```javascript
// Save/load settings
function saveLastExportSettings()

// Setup storage-linked select
function setupStorageLinkedSelect(elementId, storageKey)
```

### Status Checks

```javascript
// Check tool availability
function checkMarpStatus()
function checkPandocStatus()

// Handle status responses
function handleMarpStatus(status)
function handlePandocStatus(status)

// Handle available classes
function handleMarpAvailableClasses(classes)

// Load themes
function loadMarpThemes()
function handleMarpThemesAvailable(themes, error)
```

### Marp Directives

```javascript
// Get/set directives
function getMarpClassesForElement(scope, id, columnId)
function isMarpDirectiveActive(scope, id, columnId, directiveName)
function setMarpDirective(scope, id, columnId, directiveName, value, directiveScope)
function toggleMarpDirective(scope, id, columnId, directiveName, defaultValue, directiveScope)

// Refresh submenu
function refreshMarpDirectivesSubmenu(scope, id, type, columnId)

// Toggle class
function toggleMarpClass(scope, id, columnId, className, classScope)
```

### Auto-Export

```javascript
// Toggle auto-export
function toggleAutoExport()

// Update button state
function updateAutoExportButton()
```

### Global Marp Menu

```javascript
// Toggle global menu
function toggleMarpGlobalMenu(event, button)

// Populate menu
function populateMarpGlobalMenu()

// Update settings
function updateMarpGlobalSetting(key, value)
function updateYamlHeaderString(key, value)

// Refresh preview
function refreshYamlPreview()
```

---

## Data Structures

### Export Settings

```javascript
const exportSettings = {
  format: 'markdown' | 'html' | 'pdf' | 'pptx' | 'docx',
  outputFolder: string,
  useMarp: boolean,
  usePandoc: boolean,
  marpTheme: string,
  marpOutputFormat: 'pdf' | 'pptx' | 'html',
  marpHandout: boolean,
  marpHandoutPreset: string,
  tagVisibility: 'all' | 'allexcludinglayout' | 'customonly' | 'mentionsonly' | 'none',
  excludeTags: string[],
  preserveLinks: boolean,
  flattenIncludes: boolean
};
```

### Export Tree

```javascript
const exportTreeUI = {
  tree: {
    root: TreeNode,
    selected: Set<string>,
    expanded: Set<string>
  }
};
```

### Marp Directives

```javascript
const marpDirectives = {
  theme: string,
  paginate: boolean,
  header: string,
  footer: string,
  size: string,
  class: string[]
};
```

---

## Export Folder Naming

```
Format: {shortfilename}-{timestamp}-{export-range}

Examples:
  project-20240315-1430-FULL
  project-20240315-1430-TODO_INPROGRESS
  mykanban-20240315-1430-SELECTED

Limits:
  shortfilename: 16 chars max
  export-range: 32 chars max
```

---

## Tag Visibility Options

| Option | Behavior |
|--------|----------|
| `all` | Export all tags |
| `allexcludinglayout` | Remove #row, #span, #stack |
| `customonly` | Remove layout tags |
| `mentionsonly` | Keep only @ mentions |
| `none` | Remove all tags |

---

## Presets

| Preset | Settings |
|--------|----------|
| Marp Presentation | useMarp=true, format=pptx, theme=default |
| Marp PDF | useMarp=true, format=pdf, paginate=true |
| Share Content | format=markdown, tagVisibility=allexcludinglayout |

---

## Integration Points

### Called By
- `menuOperations.js` → export menu items
- `boardRenderer.js` → column include clicks
- VS Code commands → quick export

### Calls
- `exportService.js` → export functions
- VS Code API → `vscode.postMessage()` for backend
- Marp/Pandoc → via backend

---

## Migration Notes for V2

### Keep Same
- Export flow
- Tag filtering options
- Preset system

### Port to Rust
- Create `lexera-core/src/export/ui.rs`
- Handle export settings in backend
- Return results via API

### Improve
- Progress indicator for large exports
- Cancel export mid-process
- Export history with recent folders
