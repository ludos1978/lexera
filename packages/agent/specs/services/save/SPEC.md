# Save & Recovery System Specification

**Status**: 🚧 In Progress  
**V2 Targets**: `packages/lexera-core`, `packages/lexera-backend`, `packages/lexera-kanban`  
**Dependencies**: [API](../api/SPEC.md), [Sync](../../sync/SPEC.md), [State Machine](../../core/statemachine/SPEC.md), [Mutations](../../core/mutations/SPEC.md), [Notification](../notification/SPEC.md)

---

## Purpose

Define the save architecture that makes user changes durable across local UI edits, filesystem edits, and network edits. The core guarantee is that a user must never end a save attempt with only in-memory state: the save either commits to the canonical board or produces a durable recovery artifact.

---

## Product Guarantees

### Durable Save Contract
- User edits are not allowed to live only in memory.
- `Save` must always end in one of these durable outcomes:
  - canonical board committed
  - canonical board rebased and committed
  - crashsave written successfully
- A save path must never stop at "blocked" without preserving the user draft somewhere durable.

### No Silent Loss
- Local, filesystem, and network changes are all treated as board revisions from different writers.
- The system must never silently discard one party's changes.
- If convergence is not safe, the system preserves the draft and surfaces recovery UI instead of guessing.

### Crash Recovery
- Every unrecoverable save path must attempt to write a markdown crashsave named `{filename}-crashsave-{YYYYMMDD-HHmmss}.md`.
- Crashsaves are written next to the source board file, not inside rotating backup storage.
- Crashsaves contain a full board snapshot that can be reopened manually.

### Trust Boundary For External Edits
- Metadata stored inside editable markdown, including `generation`, `contentHash`, `resolvedHash`, and `writerId`, is advisory only.
- The backend must never trust those fields as authority for freshness or safety decisions.
- The authoritative external-change token is recomputed by the backend from the loaded effective board state after parsing and include resolution.

---

## UX Requirements

### Saving From Kanban
- User edits update the visible board immediately.
- User can press `Cmd/Ctrl+S` at any time.
- If the canonical board can be updated safely, the app reports a normal save.
- If the canonical board cannot be updated safely, the app still reports that the draft was preserved as a crashsave.

### External File Changes
- Main board file changes and include-file changes are treated as remote revisions.
- Clean boards adopt external changes automatically.
- Dirty boards rebase against external changes before the user continues editing.
- If that rebase cannot be trusted, the user draft is crashsaved and the board enters recovery mode.
- Missing or tampered inline revision metadata must still be detected as external edits when the effective board state changes.

### Network Changes
- Live-sync and remote sync updates are treated as remote revisions of the same board.
- Dirty local drafts must be rebased or queued, never overwritten.
- Live-sync session corruption or identity drift must not make the board unsaveable.

### Recovery UX
- Recovery state must explain whether the board was committed, rebased, or crashsaved.
- If a crashsave is created, the app shows the filename or path and keeps the draft available for retry.
- Recovery messaging is not optional on failed canonical commits.

---

## Architecture

### High-Level Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                     SAVE & RECOVERY FLOW                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  UI mutation / FS change / network change                        │
│                  │                                               │
│                  ▼                                               │
│         Working draft in client state                            │
│                  │                                               │
│                  ▼                                               │
│        Durable draft journal written first                       │
│                  │                                               │
│                  ▼                                               │
│             SaveCoordinator decides                              │
│                  │                                               │
│      ┌───────────┴───────────┐                                   │
│      │                       │                                   │
│      ▼                       ▼                                   │
│ CRDT convergence        Unsafe / unrecoverable                   │
│ against canonical       save state detected                      │
│ board revision                │                                  │
│      │                       │                                   │
│      ▼                       ▼                                   │
│ commit markdown +       write crashsave markdown                 │
│ .md.crdt + revision     keep durable draft journal               │
│ metadata                     │                                   │
│      │                       │                                   │
│      ▼                       ▼                                   │
│ clear journal /        recovery UI with retry +                  │
│ publish revision       crashsave reference                       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Package | Responsibility |
|-----------|---------|----------------|
| `Working draft` | `packages/lexera-kanban` | User-visible board state and dirty tracking |
| `Durable draft journal` | `packages/lexera-kanban` + backend persistence | Survives reloads and crashes until canonical commit succeeds |
| `SaveCoordinator` | `packages/lexera-core` + `packages/lexera-backend` | Centralizes save, rebase, and recovery decisions |
| `Canonical CRDT store` | `packages/lexera-core` | Converges local/network/filesystem revisions |
| `CrashsaveManager` | `packages/lexera-core` | Writes recovery snapshots with stable naming |
| `Recovery UI` | `packages/lexera-kanban` | Explains crashsaves, retries, and conflicts |

---

## Data Model

### BoardRevision

```typescript
interface BoardRevision {
  generation: number;
  mainFileHash: string;
  dependencyHash?: string;
  resolvedHash: string;
  writerId: string;
  revisionToken: string;
}
```

Represents the persisted revision of the canonical board. This is the freshness token for load, save, rebase, SSE, and live-sync session reseeding.

Important: this persisted structure may be written into editable markdown, so clients must treat it as transport metadata, not as trust authority. The backend recomputes the effective revision token from the loaded board state.

### DurableDraft

```typescript
interface DurableDraft {
  boardId: string;
  sourcePath: string;
  baseRevision: string | null;
  board: KanbanBoard;
  savedAt: string;
  lastFailureReason?: string;
}
```

Represents the latest durable client draft. This is separate from CRDT so user edits remain recoverable even if the active session is damaged.

### SaveOutcome

```typescript
interface SaveOutcome {
  kind: 'committed' | 'rebased' | 'crashsaved';
  board?: KanbanBoard;
  revision?: BoardRevision;
  crashsave?: CrashsaveInfo;
  autoMerged?: number;
  conflicts?: CardConflict[];
}
```

### CrashsaveInfo

```typescript
interface CrashsaveInfo {
  path: string;
  filename: string;
  createdAt: string;
  reason: string;
}
```

---

## Public API

### Save / Rebase Endpoints

```typescript
PUT  /boards/{boardId}
POST /boards/{boardId}/sync-save
POST /boards/{boardId}/rebase
```

These remain the canonical save and preview-rebase surfaces. They must operate on persisted board revisions and use CRDT for convergence.

### Crashsave Endpoint

```typescript
POST /boards/{boardId}/crashsave
```

Request:

```typescript
interface CrashsaveRequest {
  board: KanbanBoard;
  reason?: string;
}
```

Response:

```typescript
interface CrashsaveResponse {
  success: true;
  path: string;
  filename: string;
  savedAt: string;
}
```

**Purpose**: guarantees that the current draft can be written as a recovery artifact when canonical save cannot complete safely.

---

## Key Behaviors

### Save Means "Durable First"
- Client `Save` first ensures the working draft is durable.
- Canonical commit is a second step, not the only success condition.
- If canonical commit fails, the crashsave path must still succeed whenever local disk is writable.

### External Revision Detection Uses Backend-Recomputed State
- File watcher events must carry a backend-computed revision token after reload, not only `generation`.
- Frontend freshness checks must compare against that backend-computed revision token.
- If external markdown metadata is missing or altered, the backend still reparses the file and recomputes the effective revision.

### CRDT Is The Convergence Engine
- CRDT is the authority for integrating revisions from multiple parties.
- Markdown files are a projection of the resolved CRDT-backed board.
- Three-way merge is not part of the steady-state save design.
- With the current card model, CRDT auto-merges structural and non-overlapping card changes, but same-card same-field text edits still require an explicit resolution choice such as overwrite, keep disk, or future per-conflict manual merge UI.

### Filesystem And Network Changes Are Both Remote Revisions
- Main-file edits, include-file edits, live-sync updates, and remote sync updates all enter the same coordinator model as external revisions.
- The coordinator decides whether to auto-adopt, rebase, or crashsave.

### Identity Drift Is Recoverable
- Card identity mismatch is treated as a recovery condition, not a final hard-stop state.
- The system preserves the draft, reseeds the live-sync session or canonical base, and retries from durable state.
- Users should never be told only to reload and hope.

### Crashsave Naming And Placement
- Crashsave filename format is `{filename}-crashsave-{YYYYMMDD-HHmmss}.md`.
- `filename` means the source board file stem, preserving user recognition.
- Crashsaves are siblings of the board file so recovery is obvious and independent of rotating backup retention.

---

## Integration Points

### Called By
- `packages/lexera-kanban` save actions and dirty-draft handling
- `packages/lexera-backend` board save and rebase endpoints
- file watcher / SSE handlers when external revisions arrive
- live-sync and remote sync import paths

### Calls
- `packages/lexera-core` CRDT store for convergence
- `packages/lexera-core` parser and markdown writer for canonical and crashsave output
- `packages/lexera-kanban` notification and recovery UI

---

## Migration Notes For V2

### Keep Same
- CRDT remains the merge/convergence engine.
- Markdown files remain the user-facing canonical document format.
- File watching and sync updates continue to feed the same board model.

### Change
- Remove three-way merge as a save authority.
- Stop treating live-sync session corruption or identity drift as a terminal save block.
- Stop allowing save failure paths that preserve data only in memory.

### Add
- durable draft journal
- SaveCoordinator across save/rebase/import paths
- crashsave manager and crashsave API
- recovery UI state with retry/open/diff actions

---

## Acceptance Criteria

1. A failed canonical save writes a crashsave or reports why local disk is unavailable.
2. A backend restart cannot make the client reload stale content as fresh.
3. Include-file edits change the effective board revision and enter the same rebase path as main-file edits.
4. Live-sync identity drift never leaves the user with unsaveable work.
5. Concurrent edits preserve all structural IDs unless the user explicitly deletes them.

---

## Open Questions

- Whether the durable draft journal should live only in client storage or also be mirrored by the backend for desktop-only recovery.
- Whether crashsave files should contain extra metadata comments or remain plain board markdown only.
