# Lexera Backend — Sync Architecture Analysis

**Date**: 2026-02-25

**Scope**: Actual state of the lexera-backend and lexera-core synchronization infrastructure

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  lexera-backend (Tauri desktop app)                          │
│                                                              │
│  lib.rs: Setup, config, watcher, collab services, HTTP       │
│  server.rs: Axum HTTP spawn (127.0.0.1:port)                 │
│  api.rs: REST endpoints (boards, columns, cards, SSE)        │
│  collab_api.rs: Collaboration endpoints (invites, rooms)     │
│  auth.rs: User/role management (in-memory)                   │
│  invite.rs: Invite links (in-memory)                         │
│  public.rs: Public rooms (in-memory)                         │
│  config.rs: Config + identity loading                        │
│  state.rs: AppState shared across handlers                   │
│  capture.rs: Clipboard capture, tray.rs: System tray         │
└──────────────────┬───────────────────────────────────────────┘
                   │ uses
┌──────────────────▼───────────────────────────────────────────┐
│  lexera-core (Rust library)                                  │
│                                                              │
│  types.rs: KanbanBoard, KanbanRow, KanbanStack, KanbanColumn │
│            KanbanCard, BoardSettings, BoardInfo, SearchResult │
│  parser.rs: Markdown ↔ KanbanBoard (legacy + new format)     │
│  storage/local.rs: LocalStorage, BoardState, atomic writes   │
│  storage/mod.rs: BoardStorage trait, StorageError             │
│  merge/merge.rs: 3-way card-level merge                      │
│  merge/diff.rs: CardSnapshot, CardChange, board diffing       │
│  merge/card_identity.rs: kid markers (<!-- kid:XXXXXXXX -->) │
│  watcher/file_watcher.rs: notify-debouncer-full (500ms)      │
│  watcher/self_write.rs: SHA-256 fingerprint suppression       │
│  watcher/types.rs: BoardChangeEvent enum                     │
│  include/resolver.rs: IncludeMap (board ↔ include paths)     │
│  include/syntax.rs: !!!include(path)!!! parsing              │
│  include/slide_parser.rs: --- separated slide format         │
└──────────────────────────────────────────────────────────────┘
```

---

## What Is Implemented and Working

### 1. Local Board Storage (fully working)

- **BoardState**: per-board cache with file_path, parsed KanbanBoard, last_modified, content_hash (SHA-256), version (monotonic u64)
- **Board ID**: SHA-256 of file path, first 12 hex chars
- **Atomic writes**: write to .tmp → fsync → rename → fsync dir
- **Per-board write locks**: Mutex prevents concurrent writes to same board
- **Content hashing**: detects external changes by comparing disk hash to cached hash

### 2. File Watcher (fully working)

- Uses `notify-debouncer-full` with 500ms debounce (macOS FSEvents)
- Watches parent directories of board files (non-recursive)
- Events: MainFileChanged, IncludeFileChanged, FileDeleted, FileCreated
- Broadcast channel (256-slot buffer) for internal event distribution
- Self-write suppression via SHA-256 fingerprints (10s TTL)

### 3. Three-Way Card-Level Merge (fully working)

- Card identity via `<!-- kid:XXXXXXXX -->` markers (8-char hex)
- Merge logic: base (cached) vs theirs (disk) vs ours (incoming)
- Card-level: both changed differently → conflict (defaults to ours); one side changed → accept that side
- Column-level: disk structure as base, new columns from ours appended
- Conflict backups saved as `board.conflict-{timestamp}.md`
- MergeResult returned with board, conflicts list, auto_merged count

### 4. Include File Support (fully working)

- Column headers with `!!!include(path/file.md)!!!` load cards from external files
- Slide format: entries separated by `\n---\n`, each slide = one card
- IncludeMap: bidirectional board ↔ include path tracking
- Watcher tracks include files, propagates changes to affected boards

### 5. REST API (fully working)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /boards | List all boards |
| GET | /boards/:id/columns | Board data + ETag |
| POST | /boards/:id/columns/:idx/cards | Add card |
| PUT | /boards/:id | Write full board (triggers merge) |
| POST | /boards/:id/media | Upload media |
| GET | /boards/:id/media/:file | Serve media |
| GET | /boards/:id/file | Serve file relative to board |
| GET | /boards/:id/file-info | File metadata |
| POST | /boards/:id/find-file | Search files by name |
| POST | /boards/:id/convert-path | Path conversion |
| GET | /search | Search cards across boards |
| GET | /events | SSE stream (30s keep-alive) |
| GET | /status | Health check |

### 6. Markdown Parser (fully working)

- Legacy format: `## Column Title` → flat columns
- New format: `# Row` / `## Stack` / `### Column` → hierarchical rows.stacks.columns
- Auto-detection: scans for h1 headings outside YAML/footer
- Card parsing: `- [x/ ]` checkbox, description lines (2-space indent)
- Kid extraction from HTML comments
- Round-trip stable: parse → generate → parse

---

## What Is Scaffolded But Non-Functional

### Collaboration Services (in-memory only, all data lost on restart)

**AuthService** (`auth.rs`):
- HashMap-based user registry and room memberships
- Roles: Owner, Editor, Viewer with permission checks
- No persistence, no real authentication (user ID via `?user=` query param)

**InviteService** (`invite.rs`):
- UUID token-based invite links with expiry and usage limits
- Accept/revoke/list/cleanup operations
- No persistence (invites gone on restart)

**PublicRoomService** (`public.rs`):
- Room publicity toggle with default_role and max_users
- Member counting
- No persistence

**Collaboration API** (`collab_api.rs`):
- 14 endpoints under `/collab/` for invites, rooms, members, users
- All functional against in-memory services
- No persistence, no network sync, no real auth

### Startup Bootstrap (partially working)
- Local user loaded/created from `~/.config/lexera/identity.json`
- Local user registered as Owner of all configured boards
- Hourly cleanup task for expired invites
- All collaboration state starts empty on each launch

---

## What Is Missing for Multi-User Sync

### Not implemented at all:

1. **Persistence for collaboration data** — auth, invites, rooms all vanish on restart
2. **Real authentication** — no tokens, no encryption, user ID passed as query param
3. **Network sync protocol** — no mechanism for two Lexera instances to exchange data
4. **WebSocket** — SSE is one-way (server→client), no bidirectional communication
5. **Peer discovery** — no way to find other Lexera instances on the network
6. **Board data exchange** — no protocol for pushing/pulling board content between peers
7. **Include/media file sync** — no mechanism to transfer include or media files
8. **Presence/awareness** — no tracking of who is viewing/editing what
9. **TLS** — HTTP only, no encryption for network traffic
10. **Connection management** — no heartbeat, reconnection, or peer tracking

---

## Data Sync Flow (current, local-only)

### Board Save (working)
```
Client sends PUT /boards/:id with KanbanBoard JSON
  → api.rs::write_board()
    → storage.write_board(board_id, board)
      → Acquire per-board write lock
      → Read fresh disk content, compute hash
      → Compare hash to cached hash
      → If match: direct write (no conflict)
      → If mismatch: three_way_merge(base=cached, theirs=disk, ours=incoming)
        → If conflicts: save board.conflict-{timestamp}.md backup
      → Register SHA-256 fingerprint (self-write suppression)
      → Atomic write: .tmp → fsync → rename → fsync dir
      → Update cached BoardState (board, hash, version++)
    → Return MergeResult or success
  → Broadcast BoardChangeEvent via SSE
```

### File Change Detection (working)
```
External tool modifies .md file on disk
  → notify-debouncer-full detects change (500ms debounce)
  → FileWatcher emits BoardChangeEvent::MainFileChanged
  → lib.rs event loop receives event
    → check_self_write(path) → skip if our own write
    → storage.reload_board(board_id) → re-parse from disk
    → Forward event to SSE broadcast channel
  → SSE clients receive { type: "board_changed", boardId }
  → Frontend reloads board data
```

---

## Key Design Decisions in Current Code

1. **File-system as source of truth**: All state lives in markdown files on disk, not in a database
2. **Conservative merge**: When in doubt, keeps user's local changes (ours wins on conflict)
3. **Card-level granularity**: Merges at card boundaries using kid markers, not character-level
4. **Local-first**: No network dependency, works fully offline
5. **Hub model ready**: Server architecture (Axum HTTP) naturally supports hub-and-spoke topology
6. **Markdown round-trip**: Parse → modify → generate maintains file format integrity
