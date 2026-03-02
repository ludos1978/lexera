# Board Registry Service Specification

**Status**: ✅ Baseline  
**V2 Target**: `packages/lexera-backend`  
**V1 Reference**: `src/services/BoardRegistryService.ts` (~995 lines)  
**Dependencies**: [API](../services/api/SPEC.md), VS Code workspace state (v1)

---

## UX Requirements

### Board List Management
- Central registry of all known boards
- Custom ordering with drag-drop support
- Lock state to prevent automatic reordering
- Validation of board existence

### Dashboard Configuration
- Per-board timeframe settings
- Per-board tag filters
- Calendar sharing options
- Default config inheritance

### Search Entries
- Recent searches (limited to 3 unpinned)
- Pinned searches (unlimited)
- Search scope and regex options

### Event-Driven Updates
- Boards Panel subscribes to changes
- Dashboard Panel subscribes to changes
- File watchers for board deletion detection

---

## Architecture

### Singleton Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                    BOARD REGISTRY SERVICE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   BoardRegistryService.getInstance()                             │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  Singleton Instance                                       │  │
│   │                                                            │  │
│   │  _boards: Map<filePath, RegisteredBoard>                 │  │
│   │  _customOrder: string[]                                   │  │
│   │  _locked: boolean                                         │  │
│   │  _recentSearches: SearchEntry[]                           │  │
│   │  _sortMode: DashboardSortMode                             │  │
│   │                                                            │  │
│   │  Events:                                                   │  │
│   │  - onBoardsChanged                                         │  │
│   │  - onSearchesChanged                                       │  │
│   │  - onSortModeChanged                                       │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│   Subscribers:                                                   │
│   - KanbanBoardsProvider (sidebar)                              │
│   - KanbanDashboardProvider (dashboard)                         │
│   - KanbanWebviewPanel (active board)                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Structures

### RegisteredBoard

```typescript
interface RegisteredBoard {
  uri: string;              // VS Code URI
  filePath: string;         // Absolute file path
  config: DashboardBoardConfig;
}
```

### DashboardBoardConfig

```typescript
interface DashboardBoardConfig {
  enabled: boolean;
  timeframe: TimeframeWithDefault;
  tagFilters: string[];
  calendarSharing: CalendarSharingMode;
}
```

### SearchEntry

```typescript
interface SearchEntry {
  query: string;
  pinned: boolean;
  useRegex?: boolean;
  scope?: 'active' | 'listed' | 'open';
}
```

### TimeframeDays

```typescript
type TimeframeDays = 1 | 2 | 3 | 7 | 14 | 30 | 60 | 90 | 180 | 365;

type TimeframeWithDefault = TimeframeDays | 'default';
```

### CalendarSharingMode

```typescript
type CalendarSharingMode = 'disabled' | 'global' | 'perBoard';
```

### DashboardSortMode

```typescript
type DashboardSortMode = 'boardFirst' | 'merged';
```

---

## Functions

### Singleton Management

```typescript
// Initialize singleton
static initialize(context: ExtensionContext): BoardRegistryService

// Get singleton instance
static getInstance(): BoardRegistryService

// Dispose
dispose(): void
```

### Board CRUD

```typescript
// Get all registered boards
getBoards(): RegisteredBoard[]

// Get board by path
getBoard(filePath: string): RegisteredBoard | undefined

// Register new board
registerBoard(uri: string, filePath: string): void

// Unregister board
unregisterBoard(filePath: string): void

// Check if board is registered
hasBoard(filePath: string): boolean
```

### Board Order

```typescript
// Get custom order
getCustomOrder(): string[]

// Set custom order
setCustomOrder(order: string[]): void

// Move board in order
moveBoardOrder(fromIndex: number, toIndex: number): void

// Get lock state
isLocked(): boolean

// Set lock state
setLocked(locked: boolean): void
```

### Board Config

```typescript
// Get board config
getBoardConfig(filePath: string): DashboardBoardConfig

// Update board config
updateBoardConfig(filePath: string, config: Partial<DashboardBoardConfig>): void

// Get default config
getDefaultConfig(): DashboardBoardConfig

// Get effective config (merged with defaults)
getEffectiveConfig(filePath: string): DashboardBoardConfig
```

### Search Entries

```typescript
// Get recent searches
getRecentSearches(): SearchEntry[]

// Add search entry
addSearchEntry(query: string, useRegex?: boolean, scope?: string): void

// Pin/unpin search
pinSearch(query: string): void
unpinSearch(query: string): void

// Remove search entry
removeSearchEntry(query: string): void

// Clear all unpinned searches
clearUnpinnedSearches(): void
```

### Sort Mode

```typescript
// Get sort mode
getSortMode(): DashboardSortMode

// Set sort mode
setSortMode(mode: DashboardSortMode): void
```

### Validation

```typescript
// Validate board exists
validateBoard(filePath: string): boolean

// Validate all boards
validateAllBoards(): void

// Get scan status
hasScanned(): boolean
setHasScanned(scanned: boolean): void
```

### Events

```typescript
// Fire boards changed
triggerBoardsChanged(): void

// Event emitters
onBoardsChanged: Event<void>
onSearchesChanged: Event<void>
onSortModeChanged: Event<DashboardSortMode>
```

---

## Persistence

### Workspace State Keys

| Key | Type | Purpose |
|-----|------|---------|
| `markdown-kanban.boards` | `string[]` | Ordered list of file paths |
| `markdown-kanban.boardOrderLocked` | `boolean` | Lock state |
| `markdown-kanban.recentSearches` | `SearchEntry[]` | Search entries |
| `markdown-kanban.sortMode` | `DashboardSortMode` | Sort mode |
| `markdown-kanban.hasScanned` | `boolean` | Scan status |

### VS Code Settings

```json
{
  "markdown-kanban.dashboard.defaultTimeframe": 7,
  "markdown-kanban.dashboard.defaultTagFilters": [],
  "markdown-kanban.dashboard.defaultCalendarSharing": "disabled",
  "markdown-kanban.dashboard.boards": {
    "/path/to/board.md": {
      "enabled": true,
      "timeframe": "default",
      "tagFilters": [],
      "calendarSharing": "disabled"
    }
  }
}
```

---

## File Watching

```
┌─────────────────────────────────────────────────────────────────┐
│                    FILE WATCHING                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   For each registered board:                                    │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │ FileSystemWatcher                                         │  │
│   │                                                            │  │
│   │  onDidDelete → unregisterBoard()                          │  │
│   │  onDidChange → validateAndRefresh()                       │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│   Debounced refresh (500ms):                                    │
│   - Prevents rapid fire on multi-file changes                   │
│   - Single validation pass                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Validation Cache

```typescript
// Cache entry
interface ValidationCacheEntry {
  isValid: boolean;
  timestamp: number;
}

// TTL: 24 hours
static readonly CACHE_TTL = 24 * 60 * 60 * 1000;

// Check cached validation
private _isValidationCached(filePath: string): boolean

// Skip recently validated boards
private _getCachedValidation(filePath: string): boolean | null
```

---

## Integration Points

### Called By
- `KanbanBoardsProvider` → board tree view
- `KanbanDashboardProvider` → dashboard panel
- `KanbanWebviewPanel` → active board tracking
- VS Code commands → board registration

### Calls
- VS Code API → `workspace.getConfiguration()`
- VS Code API → `workspace.createFileSystemWatcher()`
- File system → `fs.existsSync()`

---

## Migration Notes for V2

### Keep Same
- Singleton pattern
- Event-driven architecture
- Persistence strategy

### Port to Rust
- Create `lexera-core/src/registry/board.rs`
- Use `dashmap` for concurrent access
- Persist to JSON file

### Add API
```rust
// GET /api/boards
// POST /api/boards/register
// DELETE /api/boards/{path}
// GET /api/boards/{path}/config
// PUT /api/boards/{path}/config
```

### Improve
- Board groups/folders
- Board templates
- Board sharing settings
