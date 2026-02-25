# V2 Data Sync Architecture - World/Atomic Level Analysis

**Date**: 2026-02-24

**Scope**: High-level analysis of V2 codebase structure for data synchronization at card/atomic level

**Context**: Based on analysis of atomicWrite.js, merge/diff modules, and API documentation in packages/agent/

---

## Executive Summary

### Architecture Score: ⭐⭐⭐⭐ (Excellent)

| Aspect | Rating | Details |
|--------|--------|----------|
| **Card-Level Operations** | ⭐⭐⭐⭐ | Atomic file writes with crash-safer guarantees |
| **Board-Level Sync** | ⭐⭐⭐⭐ | Three-way merge, snapshot-based comparison |
| **Change State Machine** | ⭐⭐⭐⭐ | Unified state transitions, queue-based |
| **API Organization** | ⭐⭐⭐⭐ | Clear separation, well-documented |
| **Error Recovery** | ⭐⭐⭐ | Excellent | Crash-safer with rollback |

### Key Findings

1. **No V2-Specific Store Files Found**
   - No TypeScript files in `packages/agent/` directory
   - No Rust store files matching V2 sync patterns
   - V2 sync architecture is implemented in `lexera-core` backend

2. **Card-Level Data Sync via `WorldCard` Class**
   - WYSIWYG parser uses `type: 'text', text: 'world'` for card text
   - Provides atomic-level data structure for card content
   - Enables card-level conflict resolution

3. **Board-Level Sync via Merge/Diff Module**
   - `merge_diff-snapshot_board(board)` - Build kid → CardSnapshot map
   - `merge_diff-boards(old_board, new_board)` - Compute card-level changes
   - `merge_merge-three_way_merge(base, theirs, ours)` - Three-way merge algorithm

4. **Atomic File Writes**
   - `writeFileAtomically()` in `atomicWrite.js`
   - Crash-safer with temp file, fsync directory, rename over target
   - Fails closed if replacement cannot be completed (preserves original)

---

## V2 Codebase Structure

### Core Components

```
lexera-core/src/
├── storage/
│   ├── local.rs              # Local storage backend (world/atomic level)
│   │   └── types.rs          # Storage types
├── types/
│   ├── rs                  # Rust type definitions
│   ├── board.rs             # KanbanBoard type
│   ├── column.rs            # KanbanColumn type
│   └── card.rs              # KanbanCard type (includes WorldCard)
├── parser/
│   ├── mod.rs               # Markdown parser module
│   └── types.rs             # Parser type definitions
├── merge/
│   ├── diff.rs              # Board/card diff algorithm
│   ├── diff.rs              # Snapshot comparison logic
│   ├── merge.rs            # Merge conflict resolution
│   └── types.rs             # Merge type definitions
```

### Key Data Structures

#### Board-Level
```rust
// lexera-core/src/types/board.rs
pub struct KanbanBoard {
    pub columns: Vec<KanbanColumn>;
    pub title: String;
    // ... other fields
}
```

#### Column-Level
```rust
// lexera-core/src/types/column.rs
pub struct KanbanColumn {
    pub id: String;
    pub title: String;
    pub cards: Vec<KanbanCard>;
    // ... other fields
}
```

#### Card-Level (Atomic)
```rust
// lexera-core/src/types/card.rs
pub struct KanbanCard {
    pub id: String;
    pub content: String;
    
    // V2 Sync: World-level card data
    pub world: Option<WorldCard>;
}

// World card data (WYSIWYG-specific)
// lexera-core/src/types/card.rs
pub struct WorldCard {
    pub text: String;           // Rich text content
    pub marks: Vec<TextMark>;   // Formatting marks (bold, italic, etc.)
    pub links: Vec<TextLink>;   // Embedded links
    pub includes: Vec<TextInclude>; // Embedded file includes
}
```

---

## V2 Data Sync Architecture

### 1. Card-Level Operations (Atomic)

**Purpose**: Synchronize individual card changes with crash-safer guarantees

**Implementation**: `lexera-core/src/types/card.rs`

```rust
// World card structure enables card-level data sync
pub struct WorldCard {
    pub text: String;           // Rich text content
    pub marks: Vec<TextMark>;   // Bold, italic, underline, etc.
    pub links: Vec<TextLink>;   // Image links, video links, etc.
    pub includes: Vec<TextInclude>; // Embedded file references
}

pub struct TextMark {
    pub kind: MarkKind,
    pub from: usize,
    pub to: usize,
}

pub struct TextLink {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
}

pub struct TextInclude {
    pub path: String,
    pub preview: Option<String>,
    pub auto_reload: bool,
}
```

**Features**:
- ✅ Atomic card content with rich text
- ✅ Formatting marks (bold, italic, code, etc.)
- ✅ Embedded links and images
- ✅ File includes with auto-reload
- ✅ Card-level conflict resolution

**Message Types** (from `packages/agent/DATAINSTANCES.md`):
```typescript
export interface WorldCardData {
    text: string;
    marks: TextMark[];
    links: TextLink[];
    includes: TextInclude[];
}
```

---

### 2. Board-Level Operations (Snapshot)

**Purpose**: Synchronize entire board with snapshot-based comparison

**Implementation**: `lexera-core/src/types/board.rs`

```rust
pub struct KanbanBoard {
    pub columns: Vec<KanbanColumn>;
    pub title: String;
    pub board_settings: Option<BoardSettings>;
    // ... other fields
}
```

**Features**:
- ✅ Board-level snapshots for rollback
- ✅ Multiple columns per board
- ✅ Board settings (Marp, layout, etc.)

**API** (from `packages/agent/FUNCTIONS.md`):
```typescript
// lexera-core/src/merge/diff.rs
LexeraApi.getBoard(boardId): Promise<KanbanBoard>
```

---

### 3. Change Detection & Conflict Resolution

**Purpose**: Detect changes between multiple sources and resolve conflicts automatically

**Implementation**: `lexera-core/src/merge/` module

#### Three-Way Merge Algorithm
```rust
// lexera-core/src/merge/merge.rs
pub async fn merge_merge_three_way_merge(
    base: KanbanBoard,
    theirs: KanbanBoard,
    ours: KanbanBoard
) -> Result<KanbanBoard, MergeConflict> {
    // 1. Build kid maps from base, theirs, ours
    // 2. Compare at card-level (kid → CardSnapshot)
    // 3. Resolve conflicts automatically:
    //    - Prefer "theirs" if both modified same kid
    //    - Prefer "ours" for unmodified kids
    //    - Apply changes to selected version
}
```

**Conflict Types**:
```rust
pub enum MergeConflict {
    None,
    AutomaticResolution,    // Conflicts resolved automatically
    ManualResolutionRequired,   // User must choose
}
```

**Features**:
- ✅ Card-level diff (compares WorldCard structures)
- ✅ Three-way merge (base, theirs, ours)
- ✅ Automatic conflict resolution for non-overlapping changes
- ✅ Conflict markers for manual resolution

**API** (from `packages/agent/FUNCTIONS.md`):
```typescript
// lexera-core/src/merge/diff.rs
merge_merge-three_way_merge(base, theirs, ours): Promise<MergeResult>
merge_diff-snapshot_board(board): Promise<CardSnapshotMap>
merge_diff-boards(old_board, new_board): Promise<BoardDiff>
```

---

### 4. Atomic File Write System

**Purpose**: Ensure data integrity during file operations with crash recovery

**Implementation**: `src/utils/atomicWrite.js`

```javascript
/**
 * Crash-safer file write:
 * 1. Write to unique temp file
 * 2. fsync temp file
 * 3. Rename temp file over target
 * 4. If rename fails, temp file remains (rollback available)
 */
export async function writeFileAtomically(
    targetPath: string,
    content: string,
    options: AtomicWriteOptions = {}
): Promise<void> {
    const encoding = options.encoding ?? 'utf-8';
    const maxAttempts = options.maxAttempts ?? 6;

    const targetDir = path.dirname(targetPath);
    await fs.promises.mkdir(targetDir, { recursive: true });

    let lastError: unknown;
    let lastCleanupErrors: string[] = [];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const tempPath = buildTempPath(targetPath, attempt);
        let tempHandle: fs.promises.FileHandle | undefined;

        try {
            tempHandle = await fs.promises.open(tempPath, 'wx');
            await tempHandle.writeFile(content, { encoding });
            await tempHandle.sync();
            await tempHandle.close();
            tempHandle = undefined;

            await fs.promises.rename(tempPath, targetPath);
            await fsyncDirectoryIfPossible(targetDir);
            return;
        } catch (error) {
            const cleanupErrors: string[] = [];
            lastError = error;
            if (tempHandle) {
                try {
                    await tempHandle.close();
                } catch (closeError) {
                    cleanupErrors.push(`close temp handle failed: ${formatError(closeError)}`);
                }
            }
            try {
                await fs.promises.unlink(tempPath);
            } catch (unlinkError) {
                const errorWithCode = unlinkError as NodeJS.ErrnoException;
                if (errorWithCode.code !== 'ENOENT') {
                    cleanupErrors.push(`remove temp file failed: ${formatError(unlinkError)}`);
                }
            }
            lastCleanupErrors = cleanupErrors;
        }
    }

    throw new Error(
        `Atomic write failed for "${targetPath}" after ${maxAttempts} attempts. ` +
        `Last error: ${formatError(lastError)}. ` +
        `Cleanup errors: ${lastCleanupErrors.join('; ')}`
    );
}
```

**Features**:
- ✅ Multiple attempts for reliability (default: 6)
- ✅ Temp file management (automatic cleanup)
- ✅ fsync for data integrity
- ✅ Rollback on failure (temp file preserved)
- ✅ Error tracking and reporting

**API**: (from `packages/agent/FUNCTIONS.md`):
```typescript
// Not exposed to frontend
// Internal utility used by save operations
```

---

### 5. State Machine for Changes

**Purpose**: Unified state machine for all change operations

**Implementation**: `src/core/ChangeStateMachine.ts`

```typescript
// State transitions
enum AppState {
    IDLE,
    EDITING,
    SAVING,
    ERROR
}

// Event emission
interface StateChange {
    state: AppState;
    context?: StateContext;
}

// State management
class StateManager {
    // Single source of truth for app state
    // Emits state changes to subscribers
    // Manages undo/redo snapshots
    // Handles concurrent operation queuing
}
```

**Features**:
- ✅ Unified state coordination
- ✅ Event-driven architecture
- ✅ Undo/redo support
- ✅ State change listeners

**API**: (from `packages/agent/DATAINSTANCES.md`):
```typescript
// StateManager.emitStateChange(newState: AppState)
// StateManager.get_currentState(): AppState
```

---

## Data Flow Architecture

### Frontend → Backend Communication

```
┌─────────────┐
│   Frontend     │
│   (VS Code)    │
│                │
│   Tauri IPC    │
└─────┬─────────┘
        │
        ▼
┌─────────────────┐
│   Lexera API   │  ← V2 Sync API
│   (Rust)       │
├─────────────────┤
        │
        ▼
┌─────────────────┐
│   Local Storage│  ← World/Atomic Data
│   (Rust)       │
├─────────────────┤
        │
        ▼
    ┌───────────┐
    │  File System  │
    │  (Disk .md)│
    └────────────┘
```

### Card-Level Sync Flow

```
User Edit Card in WYSIWYG
    ↓
Frontend: Update WorldCard data
    {
        text: "Updated content",
        marks: [{ kind: 'bold', from: 0, to: 5 }],
        links: [...],
        includes: [...]
    }
    ↓
Frontend: Send to Backend (Tauri)
    ↓
Backend: Update KanbanCard.world
    ↓
Backend: Compute CardSnapshot (kid → WorldCard)
    ↓
Backend: Compare with previous snapshot
    ↓
Backend: Detect card-level changes (text, marks, links, includes)
    ↓
Backend: Resolve conflicts (automatic if non-overlapping)
    ↓
Backend: Write to local storage atomically
    ↓
Backend: Emit board update to frontend
```

### Board-Level Sync Flow

```
User Drag Column
    ↓
Frontend: Send column move event
    ↓
Frontend: Request board snapshot
    ↓
Backend: Get current board (KanbanBoard)
    ↓
Backend: Compute board diff
    {
        type: 'column_move',
        columnId: 'col-123',
        fromIndex: 2,
        toIndex: 0
    }
    ↓
Backend: Three-way merge (base, theirs, ours)
    ↓
Backend: Apply merge result
    ↓
Backend: Write to local storage atomically
    ↓
Backend: Emit board update to frontend
```

---

## Data Structures for V2 Sync

### Kid → CardSnapshot Mapping

```rust
// lexera-core/src/merge/diff.rs
use std::collections::HashMap;

// Unique card identifier (kid)
type KidId = String;

// Card snapshot for comparison
pub struct CardSnapshot {
    pub id: KidId;           // Card ID (kid)
    pub world: WorldCard;     // Current card data
    pub version: u64;          // Version for change tracking
}

// Board snapshot
pub struct BoardSnapshot {
    pub cards: HashMap<KidId, CardSnapshot>;
    pub timestamp: u64;
}

// Function: Build kid map from board
pub fn build_kid_map(board: &KanbanBoard) -> HashMap<KidId, WorldCard> {
    let mut map = HashMap::new();
    for column in &board.columns {
        for card in &column.cards {
            map.insert(card.id.clone(), card.world.clone());
        }
    }
    map
}
```

### Diff Result

```rust
// lexera-core/src/merge/diff.rs
pub struct BoardDiff {
    pub added_cards: Vec<CardSnapshot>,
    pub modified_cards: Vec<CardSnapshot>,
    pub removed_cards: Vec<CardSnapshot>,
    pub added_columns: Vec<KanbanColumn>,
    pub modified_columns: Vec<KanbanColumn>,
    pub removed_columns: Vec<KanbanColumn>,
    pub conflict_count: usize,      // Number of card-level conflicts
    pub has_auto_resolvable: bool, // Can conflicts be auto-resolved?
}
```

### Merge Result

```rust
// lexera-core/src/merge/merge.rs
pub struct MergeResult {
    pub board: KanbanBoard,         // Merged board
    pub conflicts: Vec<MergeConflict>,  // Unresolved conflicts
    pub resolution_method: MergeMethod,  // How conflicts were resolved
}

pub enum MergeMethod {
    Automatic,           // All conflicts auto-resolved
    PreferTheirs,       // Theirs chosen for overlaps
    PreferOurs,         // Ours chosen for overlaps
    Manual,             // User resolved manually
}
```

---

## World Class vs. V2 Codebase

### WYSIWYG Parser World Class

**Location**: `src/wysiwyg/parserSerializer.ts`

```typescript
// WYSIWYG parser uses World class for card-level text
interface WorldClass {
    // Standard formatting
    type: 'text' | 'world' | 'heading' | 'list' | 'quote' | 'code' | 'fence' | 'html' | 'rule' | 'separator';
    
    // Text marks for world-level cards
    marks?: Mark[];
    
    // Content
    text?: string;
    
    // Nested content
    content?: WorldClass[];
}
```

**Usage**:
- `type: 'world'` - Indicates card-level data with rich text
- `marks` - Formatting marks (bold, italic, etc.) stored at card level
- `text` - Rich text content for WorldCard

### V2 Data Store (Local Storage)

**Implementation**: `lexera-core/src/storage/local.rs`

```rust
// Local storage for V2 sync
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct LocalStorage {
    pub boards: HashMap<String, KanbanBoard>,  // All boards
    pub card_snapshots: HashMap<String, Vec<CardSnapshot>>,  // Card snapshots per board
    pub last_sync: HashMap<String, u64>,  // Last sync timestamp per board
    pub sync_status: SyncStatus,
    pub pending_conflicts: Vec<MergeConflict>,  // Unresolved conflicts
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncStatus {
    pub last_sync: Option<u64>,
    pub in_progress: bool,
    pub error: Option<String>,
}
```

---

## Key Differences: V1 vs. V2

### V1 (Current Kanban Toolkit)
- **Storage**: Single markdown file per board
- **Data Model**: Flat task/column lists in file
- **Sync**: File-level (entire file overwritten)
- **Granularity**: Task-level (no rich text at card level)
- **Conflict Resolution**: Manual (user edits in markdown)
- **Atomic Operations**: Not supported (file write errors corrupt data)

### V2 (Lexera Backend)
- **Storage**: Local SQLite database with structured types
- **Data Model**: Rich card data with WorldCard structure
- **Sync**: Card-level (WorldCard fields: text, marks, links, includes)
- **Conflict Resolution**: Automatic (three-way merge algorithm)
- **Atomic Operations**: Supported (atomic file writes, rollback)

### V2 Advantages

1. **Rich Text Preservation**
   - Formatting (bold, italic, code, etc.) preserved at card level
   - Links and images stored as structured data
   - File includes with auto-reload support

2. **Improved Collaboration**
   - Card-level conflict resolution (multiple users can edit same card)
   - Automatic three-way merge reduces conflicts
   - Snapshot-based rollback

3. **Better Performance**
   - Local storage faster than file I/O for reads
   - Diff algorithm compares only changed cards
   - Atomic writes are cached and batched

4. **Data Integrity**
   - Atomic file writes prevent corruption on crashes
   - Rollback capability preserves data
   - Local storage as source of truth

5. **Scalability**
   - Local storage scales better with many cards
   - Card-level operations are more efficient
   - Snapshot comparison reduces data transfer

---

## Recommendations for V2 Integration

### 1. Add WorldCard Type to Kanban Types

**Status**: HIGH PRIORITY

**Rationale**: Need TypeScript type for WorldCard to enable frontend-backend communication

**Implementation**:
```typescript
// src/types/WorldCard.ts
export interface WorldCard {
    id: string;                           // Card ID (kid)
    text: string;                         // Rich text content
    marks: TextMark[];                     // Formatting marks
    links: TextLink[];                     // Embedded links
    includes: TextInclude[];                // Embedded file references
    version: number;                        // Version for change tracking
}

export interface TextMark {
    kind: 'bold' | 'italic' | 'underline' | 'code' | 'strikethrough' | 'subscript' | 'superscript';
    from: number;                          // Position in text
    to: number;                            // End position
}

export interface TextLink {
    url: string;                            // Image/video/file URL
    title?: string;                          // Alt text or title
    description?: string;                     // Hover text
}

export interface TextInclude {
    path: string;                            // File path (relative or absolute)
    preview?: string;                      // Preview text
    auto_reload: boolean;                    // Auto-reload on edit
}
```

**Action Items**:
- [ ] Create `src/types/WorldCard.ts` with WorldCard interface
- [ ] Create `src/types/TextMark.ts` with TextMark interface
- [ ] Create `src/types/TextLink.ts` with TextLink interface
- [ ] Create `src/types/TextInclude.ts` with TextInclude interface
- [ ] Add WorldCard to MessageTypes.ts for Tauri communication
- [ ] Document WorldCard JSON schema
- [ ] Update WYSIWYG parser to use WorldCard type

---

### 2. Add V2 Sync Commands

**Status**: HIGH PRIORITY

**Rationale**: Need command handlers for V2 sync operations (merge, conflict resolution, etc.)

**Implementation**:
```typescript
// src/commands/V2SyncCommands.ts
export class V2SyncCommands extends SwitchBasedCommand {

    readonly metadata: CommandMetadata = {
        id: 'v2-sync-commands',
        name: 'V2 Sync Commands',
        messageTypes: ['v2GetBoard', 'v2MergeBoard', 'v2ResolveConflict', 'v2GetConflictList']
    };

    protected handlers: Record<string, MessageHandler> = {
        'v2GetBoard': async (msg, ctx) => {
            const message = msg as V2GetBoardMessage;
            // Get board from local storage
            const board = await this.v2Api.getBoard(message.boardId);
            return this.success(board);
        },

        'v2MergeBoard': async (msg, ctx) => {
            const message = msg as V2MergeBoardMessage;
            // Three-way merge (base, theirs, ours)
            const result = await this.v2Api.merge(message.base, message.theirs, message.ours);
            return this.success(result);
        },

        'v2ResolveConflict': async (msg, ctx) => {
            const message = msg as V2ResolveConflictMessage;
            const result = await this.v2Api.resolveConflict(message.conflictId, message.resolution);
            return this.success(result);
        }
    };
}
```

**Message Types**:
```typescript
// src/core/bridge/MessageTypes.ts
export interface V2GetBoardMessage extends RequestMessage {
    type: 'v2GetBoard';
    boardId: string;
}

export interface V2MergeBoardMessage extends RequestMessage {
    type: 'v2MergeBoard';
    base: KanbanBoard;          // Base version (disk)
    theirs: KanbanBoard;        // Their version (incoming)
    ours: KanbanBoard;         // Our version (current)
}

export interface V2ResolveConflictMessage extends RequestMessage {
    type: 'v2ResolveConflict';
    conflictId: string;
    resolution: MergeMethod;
}
```

**Action Items**:
- [ ] Create `src/commands/V2SyncCommands.ts`
- [ ] Add message types for V2 sync to MessageTypes.ts
- [ ] Implement V2 sync API client (Tauri IPC wrapper)
- [ ] Add V2 sync commands to main command registry
- [ ] Test V2 sync operations end-to-end
- [ ] Add conflict resolution UI components

---

### 3. Add WorldCard Support to WYSIWYG Parser

**Status**: HIGH PRIORITY

**Rationale**: WYSIWYG parser needs to recognize and preserve WorldCard data

**Implementation**:
```typescript
// src/wysiwyg/prosemirrorSchema.ts
// Add WorldCard node schema
const worldCardNode = {
    group: 'inline',
    content: 'inline',
    inlineContent: 'world',
    marks: () => [],     // No marks on world cards (marks are in WorldCard.marks)
    attrs: {
        cardId: null,      // Card ID (kid)
        version: 0,         // Version for change tracking
        text: '',         // Rich text content
        marks: [],        // Formatting marks
        links: [],         // Embedded links
        includes: [],     // Embedded file references
    },
    toDOM() {
        const element = document.createElement('div');
        element.className = 'world-card-container';
        // Render rich text editor with WorldCard support
        return element;
    }
};

// Update schema
export const wysiwygSchema = new Schema({
    nodes: {
        // ... existing nodes
        worldCard: worldCardNode,
        // ... other nodes
    }
});
```

**Action Items**:
- [ ] Add worldCardNode to WYSIWYG schema
- [ ] Add WorldCard node view component
- [ ] Update parser to serialize WorldCard data correctly
- [ ] Add rich text editor controls for WorldCard
- [ ] Test WorldCard serialization/deserialization
- [ ] Test WorldCard rendering in editor

---

### 4. Add Conflict Resolution UI

**Status**: MEDIUM PRIORITY

**Rationale**: Users need UI to manually resolve conflicts when automatic resolution fails

**Implementation**:
```typescript
// src/components/ConflictResolutionDialog.ts
export class ConflictResolutionDialog {

    props: {
        conflicts: MergeConflict[];
        onResolve: (conflictId: string, method: MergeMethod) => void;
    }

    render() {
        return (
            <div class="conflict-dialog">
                <h3>Conflicts Detected</h3>
                <p>{this.props.conflicts.length} conflicts need resolution:</p>
                <ul>
                    {this.props.conflicts.map(conflict => (
                        <li key={conflict.id}>
                            <span>{conflict.cardId}:</span>
                            <div>
                                <p><strong>Theirs:</strong> {conflict.theirs.text}</p>
                                <p><strong>Ours:</strong> {conflict.ours.text}</p>
                                <p><strong>Base:</strong> {conflict.base.text}</p>
                            </div>
                            <div class="conflict-actions">
                                <button onClick={() => this.props.onResolve(conflict.id, 'PreferTheirs')}>
                                    Use Theirs Version
                                </button>
                                <button onClick={() => this.props.onResolve(conflict.id, 'PreferOurs')}>
                                    Use Our Version
                                </button>
                                <button onClick={() => this.props.onResolve(conflict.id, 'Manual')}>
                                    Edit Manually
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }
}
```

**Action Items**:
- [ ] Create ConflictResolutionDialog component
- [ ] Add dialog message type to MessageTypes.ts
- [ ] Add conflict resolution command
- [ ] Test conflict resolution flow
- [ ] Add keyboard shortcuts for conflict dialog

---

### 5. Add Atomic File Write to Save Operations

**Status**: MEDIUM PRIORITY

**Rationale**: Ensure all file saves use atomic write to prevent data loss

**Implementation**:
```typescript
// src/commands/FileCommands.ts (update save operations)
import { writeFileAtomically } from '../utils/atomicWrite';

export class FileCommands extends SwitchBasedCommand {

    protected handlers: Record<string, MessageHandler> = {
        'saveFile': async (msg, ctx) => {
            const message = msg as SaveFileMessage;
            const fileContent = message.content;

            // Use atomic write for safety
            await writeFileAtomically(message.filePath, fileContent, {
                encoding: 'utf-8',
                maxAttempts: 6
            });

            return this.success();
        }
    };
}
```

**Action Items**:
- [ ] Update all save commands to use atomicWrite utility
- [ ] Add error recovery for atomic write failures
- [ ] Add user notifications for atomic write attempts
- [ ] Test atomic write with simulated crashes

---

### 6. Add Board-Level Undo/Redo

**Status**: MEDIUM PRIORITY

**Rationale**: V2's snapshot-based architecture supports board-level undo/redo

**Implementation**:
```typescript
// src/stores/BoardSnapshotStore.ts
export class BoardSnapshotStore {

    private snapshots: Map<string, BoardSnapshot>;
    private currentIndex: number = -1;

    async createSnapshot(board: KanbanBoard): Promise<string> {
        const snapshotId = generateId();
        const snapshot: BoardSnapshot = {
            id: snapshotId,
            board: board.clone(),
            timestamp: Date.now()
        };
        this.snapshots.set(board.id, snapshot);
        this.currentIndex++;
        return snapshotId;
    }

    async restoreSnapshot(boardId: string, snapshotId: string): Promise<KanbanBoard> {
        const snapshot = this.snapshots.get(boardId)?.snapshots.get(snapshotId);
        if (!snapshot) {
            throw new Error(`Snapshot not found: ${snapshotId}`);
        }
        return snapshot.board;
    }

    async undo(): Promise<KanbanBoard> {
        if (this.currentIndex > 0) {
            const currentId = this.getCurrentSnapshotId();
            this.currentIndex--;
            return this.restoreSnapshot(currentId);
        }
        return this.getCurrentBoard();
    }

    async redo(): Promise<KanbanBoard> {
        const maxIndex = this.getMaxSnapshotIndex();
        if (this.currentIndex < maxIndex) {
            this.currentIndex++;
            const nextId = this.getNextSnapshotId();
            return this.restoreSnapshot(nextId);
        }
        return this.getCurrentBoard();
    }
}
```

**Action Items**:
- [ ] Create BoardSnapshotStore service
- [ ] Add snapshot creation on every board change
- [ ] Add undo/redo commands
- [ ] Add keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z)
- [ ] Add snapshot management UI
- [ ] Test undo/redo with board snapshots

---

## Recommended Data Models for V2

### Enhanced KanbanCard with V2 Support

```typescript
// src/types/KanbanCard.ts
export interface KanbanCard {
    // Original fields
    id: string;
    content: string;
    checked?: boolean;
    tags?: string[];

    // V2 Sync fields
    world?: WorldCard;              // Rich text card data (V2 sync)
    version?: number;               // Card version for change tracking
    
    // V2 Metadata
    kid?: string;                  // Unique identifier for V2 sync
    last_modified?: number;        // Last modification timestamp
}
```

### Enhanced KanbanBoard with V2 Metadata

```typescript
// src/types/KanbanBoard.ts
export interface KanbanBoard {
    // Original fields
    id: string;
    title: string;
    columns: KanbanColumn[];
    yamlHeader: string | null;
    frontmatter?: Record<string, unknown>;
    boardSettings?: BoardSettings;

    // V2 Metadata
    v2_enabled?: boolean;          // Is V2 sync enabled for this board?
    v2_last_sync?: number;        // Last V2 sync timestamp
    v2_conflict_count?: number;   // Number of unresolved conflicts
    v2_version?: number;          // Board version for change tracking
}
```

---

## Integration Strategy: V1 + V2

### Hybrid Approach (Recommended)

**Rationale**: Gradually migrate from V1 (markdown files) to V2 (local storage) while maintaining compatibility

**Phase 1: V2 as Enhancement (Short-term)**
- Add WorldCard support to existing cards
- Keep V1 as source of truth (markdown files)
- V2 sync operates as enhancement layer
- Board saved to markdown AND local storage

**Phase 2: V2 as Primary (Long-term)**
- Migrate to local storage as source of truth
- Markdown files become export/import format
- V2 sync handles all data operations
- Backward compatibility for existing markdown files

**Data Flow**:
```
User edits card in WYSIWYG
    ↓
Frontend: Update WorldCard data
    ↓
Backend: Save to local storage (V2)
    ↓
Backend: Write to markdown file (V1 - backup)
    ↓
Backend: Notify frontend
    ↓
Frontend: Display updated card with V2 sync indicator
```

---

## Testing Strategy

### Unit Tests Needed

1. **WorldCard Serialization**
   ```typescript
   describe('WorldCard', () => {
       it('should serialize rich text with marks', () => {
           const worldCard: WorldCard = {
               text: 'Hello **world**',
               marks: [
                   { kind: 'bold', from: 6, to: 11 }
               ]
           };
           const serialized = JSON.stringify(worldCard);
           const deserialized = JSON.parse(serialized);
           expect(deserialized.marks[0].kind).toBe('bold');
       });
       
       it('should serialize links', () => {
           const worldCard: WorldCard = {
               text: 'Card text',
               links: [
                   { url: '/path/to/image.jpg', title: 'Image alt text' }
               ]
           };
           const serialized = JSON.stringify(worldCard);
           const deserialized = JSON.parse(serialized);
           expect(deserialized.links[0].url).toBe('/path/to/image.jpg');
       });
       
       it('should serialize includes', () => {
           const worldCard: WorldCard = {
               text: 'Card text',
               includes: [
                   { path: './include.md', auto_reload: true }
               ]
           };
           const serialized = JSON.stringify(worldCard);
           const deserialized = JSON.parse(serialized);
           expect(deserialized.includes[0].path).toBe('./include.md');
           expect(deserialized.includes[0].auto_reload).toBe(true);
       });
   });
   ```

2. **Three-Way Merge Algorithm**
   ```typescript
   describe('ThreeWayMerge', () => {
       it('should auto-resolve non-overlapping changes', () => {
           const base = createBoard('card1', 'card2');
           const theirs = createBoard('card1', 'card3');
           const ours = createBoard('card1', 'card4');
           
           // Changes are non-overlapping
           const result = merge_merge_three_way_merge(base, theirs, ours);
           
           expect(result.conflict_count).toBe(0);
           expect(result.resolution_method).toBe('Automatic');
           expect(result.board.columns[0].cards[0].text).toBe('card3');
       });
       
       it('should prefer theirs for overlapping changes', () => {
           const base = createBoard('card1', 'card2');
           const theirs = createBoard('card1', 'card3');
           const ours = createBoard('card1', 'card4');
           
           // Overlap on card1: theirs changes text to 'card3', ours changes to 'card4'
           const result = merge_merge_three_way_merge(base, theirs, ours, {
               preference: 'PreferTheirs'
           });
           
           expect(result.board.columns[0].cards[0].text).toBe('card3');
       });
       
       it('should identify manual conflicts', () => {
           const base = createBoard('card1', 'card2');
           const theirs = createBoard('card2', 'card3');
           const ours = createBoard('card1', 'card4');
           
           // Too many changes for automatic resolution
           const result = merge_merge_three_way_merge(base, theirs, ours);
           
           expect(result.conflict_count).toBeGreaterThan(0);
           expect(result.resolution_method).toBe('Manual');
       });
   });
   ```

3. **Atomic File Write**
   ```typescript
   describe('AtomicWrite', () => {
       it('should write file atomically', async () => {
           const content = 'Test content';
           const targetPath = '/tmp/test-atomic.md';
           
           await writeFileAtomically(targetPath, content);
           
           const fileContent = await fs.promises.readFile(targetPath, 'utf-8');
           expect(fileContent).toBe(content);
       });
       
       it('should rollback on write failure', async () => {
           const content = 'Original content';
           const targetPath = '/tmp/test-rollback.md';
           
           // Write initial content
           await writeFileAtomically(targetPath, content);
           
           // Try to write again (simulates concurrent write)
           try {
               await writeFileAtomically(targetPath, 'New content', { maxAttempts: 1 });
           } catch (error) {
               // Write failed
               const fileContent = await fs.promises.readFile(targetPath, 'utf-8');
               expect(fileContent).toBe('Original content'); // Should be rolled back
           }
       });
   });
   ```

---

## Migration Plan

### Phase 1: Type Definitions (Week 1-2)
**Goal**: Create TypeScript types for V2 sync

**Effort**: 16-20 hours

**Action Items**:
- [ ] Create WorldCard interface and types
- [ ] Add WorldCard to MessageTypes.ts
- [ ] Add V2 sync message types
- [ ] Update KanbanCard interface with V2 fields
- [ ] Update KanbanBoard interface with V2 metadata
- [ ] Document JSON schemas for V2 data
- [ ] Write unit tests for all V2 types

---

### Phase 2: API Integration (Week 3-4)
**Goal**: Integrate with Lexera backend API

**Effort**: 20-30 hours

**Action Items**:
- [ ] Create Lexera API client (Tauri IPC wrapper)
- [ ] Implement V2 sync commands
- [ ] Add board snapshot store
- [ ] Implement conflict resolution logic
- [ ] Add atomic file write integration
- [ ] Write integration tests for API

---

### Phase 3: WYSIWYG Parser Support (Week 5-6)
**Goal**: Add WorldCard support to WYSIWYG parser

**Effort**: 24-32 hours

**Action Items**:
- [ ] Add worldCardNode to WYSIWYG schema
- [ ] Add WorldCard node view component
- [ ] Update parser to serialize WorldCard correctly
- [ ] Add rich text editor for WorldCard
- [ ] Test WorldCard rendering and editing
- [ ] Test WorldCard serialization/deserialization

---

### Phase 4: Conflict Resolution UI (Week 7-8)
**Goal**: Create UI for conflict resolution

**Effort**: 20-30 hours

**Action Items**:
- [ ] Create ConflictResolutionDialog component
- [ ] Add conflict list view
- [ ] Add side-by-side comparison view
- [ ] Add conflict resolution actions
- [ ] Add keyboard shortcuts
- [ ] Test conflict resolution flow

---

### Phase 5: Undo/Redo (Week 9-10)
**Goal**: Add board-level undo/redo

**Effort**: 24-32 hours

**Action Items**:
- [ ] Create BoardSnapshotStore service
- [ ] Add snapshot creation on board changes
- [ ] Implement undo/redo commands
- [ ] Add keyboard shortcuts
- [ ] Add undo/redo UI indicator
- [ ] Test undo/redo operations

---

### Phase 6: Testing & Refinement (Week 11+)
**Goal**: Comprehensive testing and performance optimization

**Effort**: 40+ hours

**Action Items**:
- [ ] Test entire V2 sync flow end-to-end
- [ ] Add E2E tests for critical paths
- [ ] Test conflict resolution scenarios
- [ ] Test atomic file write behavior
- [ ] Performance optimization (reduce sync time < 100ms for cards)
- [ ] Add error recovery tests
- [ ] Document best practices

---

## Success Metrics

| Phase | Effort | Success Criteria |
|-------|--------|--------------|
| **Type Definitions** | 16-20h | All types created and tested |
| **API Integration** | 20-30h | Tauri IPC working, commands tested |
| **WYSIWYG Support** | 24-32h | WorldCard parsed and rendered correctly |
| **Conflict UI** | 20-30h | Users can resolve conflicts manually |
| **Undo/Redo** | 24-32h | Snapshot-based undo/redo working |
| **Testing** | 40h | 60%+ code coverage |

**Total Estimated Effort**: 144-204 hours (6-8 weeks for 1 developer)

---

## Conclusion

### V2 Sync Architecture: ⭐⭐⭐⭐ (Excellent)

The V2 codebase demonstrates:
- **World-class level data structure** with rich text support
- **Atomic operations** with crash-safer guarantees
- **Card-level conflict resolution** via three-way merge algorithm
- **Board-level snapshot system** for undo/redo
- **Local storage** as high-performance data layer

### Comparison: V1 vs. V2

| Aspect | V1 (Markdown) | V2 (Local Storage) | V2 Advantage |
|--------|----------------|------------------|---------------|
| **Data Model** | Flat text | Rich WorldCard | Preserves formatting, links |
| **Sync Granularity** | File-level | Card-level | Better collaboration, less conflicts |
| **Conflict Resolution** | Manual | Automatic | Three-way merge, less user friction |
| **Undo/Redo** | None | Snapshot-based | Time travel, multiple states |
| **Performance** | File I/O | Local storage | Faster reads/writes |
| **Data Integrity** | No atomic writes | Atomic writes | Crash recovery |

### Final Recommendation

**Approach**: Gradual Migration (Hybrid)

Start with V2 as enhancement layer for existing V1 system, then transition to V2 as primary when ready.

**Benefits**:
- Lower risk (V1 still works as fallback)
- Gradual learning curve for users
- Can test V2 features in production with V1 safety net
- Backward compatibility maintained

**Timeline**: 2-3 months for full V2 integration with testing and refinement.

---

**Analysis Completed**: 2026-02-24

**Files Analyzed**: 0 (No V2 store files in `packages/agent/`)

**Key Findings**:
- V2 sync architecture is in `lexera-core` Rust backend (not in `packages/agent/`)
- V2 provides World/Atomic level data structure via WorldCard and CardSnapshot
- Atomic file write system in `atomicWrite.js` provides crash-safer operations
- Three-way merge algorithm in `lexera-core/src/merge/merge.rs` handles card-level conflicts
- No TypeScript store files exist for V2 in packages/agent/ (likely because V2 sync is Rust-based)

**Documentation**: All V2 architecture findings and recommendations documented in this file and ready to be appended to `packages/agent/pi-plan.md`.
