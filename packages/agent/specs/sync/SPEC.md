# Sync & Collaboration System Specification

**Status**: Active v2 workstream  
**V2 Targets**: `packages/lexera-backend`, `packages/lexera-core`  
**V1 Reference**: `packages/ludos-sync/`

---

## Purpose

Define the v2 sync and collaboration architecture that replaces the v1 Node/WebDAV sync server with a Rust-based backend integrated into `lexera-backend`.

---

## Product Goals

- Real-time board synchronization across multiple clients
- Offline-first with automatic conflict resolution
- Support for both local filesystem and remote sync targets
- Foundation for future collaboration features

---

## Ownership Split

### `packages/lexera-core`

Owns sync-compatible data structures:

- CRDT-ready card/board models
- Change delta generation
- Merge semantics at card level
- Conflict detection logic

### `packages/lexera-backend`

Owns sync orchestration:

- File watching and change detection
- Sync target management (local, WebDAV, future cloud)
- WebSocket/SSE for live updates
- Conflict resolution coordination
- Offline queue management

The backend is also the trust boundary for external file edits. Editable markdown metadata is not authoritative; backend recomputation after parse/reload is authoritative.

---

## Sync Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    SYNC ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│   │ lexera-      │     │ lexera-      │     │ lexera-      │   │
│   │ kanban       │────▶│ backend      │────▶│ core         │   │
│   │ (client)     │     │ (sync host)  │     │ (merge)      │   │
│   └──────────────┘     └──────────────┘     └──────────────┘   │
│         │                    │                    │             │
│         │                    │                    │             │
│         ▼                    ▼                    ▼             │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│   │ Board UI     │     │ File Watcher │     │ CRDT Deltas  │   │
│   │ Local State  │     │ Sync Queue   │     │ Merge Logic  │   │
│   └──────────────┘     │ WS/SSE API   │     │ Conflict Det │   │
│                        └──────────────┘     └──────────────┘   │
│                               │                                 │
│                               ▼                                 │
│                        ┌──────────────┐                        │
│                        │ Sync Targets │                        │
│                        │              │                        │
│                        │ - Local FS   │                        │
│                        │ - WebDAV     │                        │
│                        │ - Future:    │                        │
│                        │   Cloud      │                        │
│                        └──────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Sync Targets

### 1. Local Filesystem (Baseline)

- Primary storage for single-user mode
- Atomic writes with temp file + rename
- Self-write suppression for watcher
- External file changes are detected from backend-recomputed board revisions, not from inline markdown metadata alone
- `MainFileChanged` SSE notifications carry that backend-computed revision so clients can distinguish real external changes from stale events

### 2. WebDAV (v1 Parity)

- Remote storage via WebDAV protocol
- Username/password authentication
- Conflict detection via ETags
- Delta sync where possible

### 3. Future: Lexera Cloud

- Native sync service
- Real-time collaboration
- User/account management
- End-to-end encryption option

---

## Data Model

### SyncState

```rust
struct SyncState {
    board_id: String,
    local_version: u64,
    remote_version: Option<u64>,
    last_sync_timestamp: Option<i64>,
    pending_deltas: Vec<ChangeDelta>,
    conflict_state: Option<ConflictState>,
}
```

### ChangeDelta

```rust
struct ChangeDelta {
    delta_id: String,
    board_id: String,
    timestamp_ms: i64,
    operations: Vec<ChangeOperation>,
    checksum: String,
}

enum ChangeOperation {
    CardCreated { card: CardData },
    CardUpdated { card_id: String, changes: CardChanges },
    CardDeleted { card_id: String },
    CardMoved { card_id: String, from_column: String, to_column: String, new_index: usize },
    ColumnCreated { column: ColumnData },
    ColumnUpdated { column_id: String, changes: ColumnChanges },
    ColumnDeleted { column_id: String },
    ColumnMoved { column_id: String, new_index: usize },
}
```

### ConflictState

```rust
enum ConflictState {
    None,
    AutoResolved { strategy: String },
    RequiresManualResolution {
        local_changes: Vec<ChangeOperation>,
        remote_changes: Vec<ChangeOperation>,
        affected_cards: Vec<String>,
    },
}
```

---

## Sync Flow

### Normal Sync Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    NORMAL SYNC FLOW                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. Local Change Detected                                      │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Generate delta   │  lexera-core: computeChangeDelta()       │
│   │ from changes     │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Queue for sync   │  Add to pending_deltas                   │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Push to remote   │  WebDAV PUT / future cloud API           │
│   │ (if online)      │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Update versions  │  local_version++, remote_version++       │
│   └──────────────────┘                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Conflict Resolution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONFLICT RESOLUTION FLOW                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. Pull remote changes                                        │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Detect conflict  │  Compare local_version vs remote         │
│   └────────┬─────────┘                                          │
│            │                                                     │
│       ┌────┴────────┐                                            │
│       │ Conflict?   │                                            │
│       ▼             ▼                                            │
│   ┌───────┐   ┌───────────────┐                                 │
│   │ No    │   │ Try auto      │                                 │
│   │ Apply │   │ merge         │                                 │
│   └───────┘   └───────┬───────┘                                 │
│                       │                                          │
│               ┌───────┴───────┐                                  │
│               │ Success?      │                                  │
│               ▼               ▼                                  │
│           ┌───────┐     ┌───────────────┐                       │
│           │ Apply │     │ Notify client │                       │
│           │ merge │     │ for manual    │                       │
│           └───────┘     │ resolution    │                       │
│                         └───────────────┘                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Surface

### Backend Sync API

```rust
// Sync management
GET  /api/sync/status                    -> SyncStatus
POST /api/sync/sync-now                  -> SyncResult
POST /api/sync/pause
POST /api/sync/resume

// Board sync
GET  /api/boards/{id}/sync-state         -> SyncState
POST /api/boards/{id}/push               -> PushResult
POST /api/boards/{id}/pull               -> PullResult

// Conflict resolution
GET  /api/boards/{id}/conflicts          -> Vec<Conflict>
POST /api/boards/{id}/resolve-conflict   -> ResolveResult

// Real-time updates
WS   /api/ws                             -> WebSocket stream
SSE  /api/events                         -> SSE stream
```

### Client Messages

```typescript
// Client -> Backend
type ClientMessage =
  | { type: 'board_changed'; boardId: string; delta: ChangeDelta }
  | { type: 'request_sync'; boardId: string }
  | { type: 'resolve_conflict'; boardId: string; resolution: ConflictResolution }

// Backend -> Client
type BackendMessage =
  | { type: 'sync_complete'; boardId: string; result: SyncResult }
  | { type: 'sync_error'; boardId: string; error: string }
  | { type: 'conflict_detected'; boardId: string; conflict: Conflict }
  | { type: 'remote_update'; boardId: string; delta: ChangeDelta }
```

---

## Offline Support

### Offline Queue

```rust
struct OfflineQueue {
    pending_operations: Vec<QueuedOperation>,
    max_queue_size: usize,
    retry_policy: RetryPolicy,
}

struct QueuedOperation {
    id: String,
    timestamp_ms: i64,
    operation: ChangeOperation,
    retry_count: u32,
    last_error: Option<String>,
}
```

### Sync-on-Reconnect

1. On network restore, process offline queue
2. Push all pending operations
3. Pull any remote changes
4. Resolve conflicts if any
5. Notify client of sync state

---

## Live Sync (Future)

### Real-time Collaboration

```rust
struct LiveSyncSession {
    session_id: String,
    board_id: String,
    participants: Vec<Participant>,
    cursor_positions: HashMap<String, CursorPosition>,
    active_editors: HashMap<String, String>, // card_id -> user_id
}
```

### Operational Transformation

For future multi-user editing:
- Transform operations from other clients
- Maintain intention preservation
- Ensure convergence

---

## Integration Points

### Called By
- `lexera-kanban` -> board save, manual sync trigger
- File watcher -> change detection

### Calls
- `lexera-core` -> delta generation, merge logic
- WebDAV client -> remote storage operations
- WebSocket/SSE -> real-time notifications

---

## Migration From V1

### Keep
- WebDAV support as primary remote target
- Conflict detection via version comparison
- Offline queue concept

### Replace
- Node.js sync server with Rust in-process
- Separate sync service with integrated backend

### Add
- Real-time sync notifications
- Structured delta format
- Explicit conflict resolution UI contract

---

## Testing Requirements

### Unit Tests
- Delta generation from changes
- Merge logic for common scenarios
- Conflict detection accuracy

### Integration Tests
- Local filesystem sync round-trip
- WebDAV sync with mock server
- Offline queue processing
- Conflict resolution flow

### Stress Tests
- High-frequency change bursts
- Large board synchronization
- Concurrent client updates

---

## Open Design Work

- CRDT implementation for offline-first merge
- Encryption at rest for remote storage
- Selective sync (per-board sync targets)
- Sync sharing between users
