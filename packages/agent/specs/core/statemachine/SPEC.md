# Change State Machine Specification

**File**: `src/core/ChangeStateMachine.ts`
**Lines**: ~730
**Purpose**: Unified entry point for all file changes with state machine flow
**Dependencies**: `FileSaveService`, `IncludeLoadingProcessor`, `MarkdownFileRegistry`

---

## UX Requirements

### Unified Change Handling
- All file changes route through single entry point
- Prevents race conditions between file watcher and user edits
- Queues events during processing

### Change Types Supported
- File system changes (external edits)
- User edits (webview operations)
- Save events (explicit save)
- Include switch operations

### State Visibility
- Track current state for debugging
- Queue status for pending events
- Error handling with recovery

---

## Architecture

### State Machine Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    STATE MACHINE FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   IDLE ──────────────► VALIDATE ───────► LOAD ───────► UPDATE   │
│     ▲                      │               │              │      │
│     │                      ▼               ▼              ▼      │
│     │               CANCELLED ◄─────────────────────► COMPLETE  │
│     │                      │                                  │  │
│     │                      ▼                                  │  │
│     └──────────────── ERROR ◄─────────────────────────────────┘  │
│                                                                  │
│   States:                                                        │
│   - IDLE: Waiting for events                                    │
│   - VALIDATE: Check event validity                              │
│   - LOAD: Load file/include content                             │
│   - UPDATE: Apply changes to board                              │
│   - COMPLETE: Success, notify webview                           │
│   - CANCELLED: No-op (file unchanged)                           │
│   - ERROR: Error occurred, cleanup                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Event Queuing

```
processChange(event)
       │
       ├─ _isProcessing = true?
       │     └─ Yes → Queue event, return Promise
       │
       ├─ Create context
       │
       ├─ Transition to VALIDATE
       │
       └─ State machine runs to completion

After completion:
       │
       ├─ _isProcessing = false
       │
       └─ Process next queued event
```

---

## States

| State | Purpose | Next States |
|-------|---------|-------------|
| IDLE | Waiting for events | VALIDATE |
| VALIDATE | Check event validity | LOAD, CANCELLED |
| LOAD | Load file content | UPDATE, ERROR |
| UPDATE | Apply changes | COMPLETE, ERROR |
| COMPLETE | Success, notify | IDLE |
| CANCELLED | No-op | IDLE |
| ERROR | Error cleanup | IDLE |

---

## Data Structures

### ChangeEvent (Union Type)

```typescript
type ChangeEvent = 
  | FileSystemChangeEvent
  | UserEditEvent
  | SaveEvent
  | IncludeSwitchEvent;
```

### FileSystemChangeEvent

```typescript
interface FileSystemChangeEvent {
  type: 'file_system_change';
  filePath: string;
  changeType: 'created' | 'changed' | 'deleted';
}
```

### UserEditEvent

```typescript
interface UserEditEvent {
  type: 'user_edit';
  operation: 'add' | 'update' | 'delete' | 'move';
  cardId?: string;
  columnId?: string;
  content?: string;
}
```

### SaveEvent

```typescript
interface SaveEvent {
  type: 'save';
  filePath: string;
  content: string;
}
```

### IncludeSwitchEvent

```typescript
interface IncludeSwitchEvent {
  type: 'include_switch';
  includeFilePath: string;
  previousIncludePath?: string;
}
```

### ChangeContext

```typescript
interface ChangeContext {
  event: ChangeEvent;
  startTime: number;
  result: ChangeResult;
  fileContent?: string;
  board?: KanbanBoard;
  includeContent?: Map<string, string>;
}
```

### ChangeResult

```typescript
interface ChangeResult {
  success: boolean;
  error?: Error;
  context: ChangeContext;
  duration: number;
}
```

---

## Functions

### Main Entry

```typescript
class ChangeStateMachine {
  // Single entry point for all changes
  public async processChange(event: ChangeEvent): Promise<ChangeResult>
}
```

### State Transitions

```typescript
// Transition to next state
private async _transitionTo(state: ChangeState, context: ChangeContext)

// Enter state handler
private async _enterState(state: ChangeState, context: ChangeContext): Promise<ChangeState | null>
```

### State Handlers

```typescript
// VALIDATE state
private async _handleValidate(context: ChangeContext): Promise<ChangeState>

// LOAD state
private async _handleLoad(context: ChangeContext): Promise<ChangeState>

// UPDATE state
private async _handleUpdate(context: ChangeContext): Promise<ChangeState>

// COMPLETE state
private async _handleComplete(context: ChangeContext): Promise<ChangeState>

// ERROR state
private async _handleError(context: ChangeContext): Promise<ChangeState>
```

### Context Creation

```typescript
// Create initial context for event
private _createInitialContext(event: ChangeEvent): ChangeContext
```

---

## State Handler Logic

### VALIDATE

```
1. Check event type
2. Verify file path exists
3. For user_edit: validate operation params
4. For save: check for in-progress flag
5. Return LOAD or CANCELLED
```

### LOAD

```
1. Load main file content
2. Parse board
3. Load includes if needed
4. Resolve include paths
5. Return UPDATE or ERROR
```

### UPDATE

```
1. Apply changes to board
2. For file_system_change: re-parse and refresh
3. For user_edit: modify board structure
4. For save: write to disk
5. For include_switch: swap include content
6. Return COMPLETE or ERROR
```

### COMPLETE

```
1. Notify webview of changes
2. Update cached board
3. Clear processing flags
4. Return IDLE
```

### ERROR

```
1. Log error details
2. Clear include switch flag
3. Notify webview of error
4. Return IDLE
```

---

## Event Queuing

```typescript
// Queue structure
private _eventQueue: Array<{
  event: ChangeEvent;
  resolve: (result: ChangeResult) => void;
  reject: (error: Error) => void;
}> = [];

// When processing busy:
if (this._isProcessing) {
  return new Promise<ChangeResult>((resolve, reject) => {
    this._eventQueue.push({ event, resolve, reject });
  });
}

// After completion:
if (this._eventQueue.length > 0) {
  const next = this._eventQueue.shift();
  this.processChange(next.event).then(next.resolve).catch(next.reject);
}
```

---

## Per-Panel Instance

```
┌─────────────────────────────────────────────────────────────────┐
│                    PER-PANEL ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Panel 1 (board-a.md)                                          │
│   └── ChangeStateMachine instance 1                             │
│       └── Own event queue                                       │
│       └── Own state tracking                                    │
│                                                                  │
│   Panel 2 (board-b.md)                                          │
│   └── ChangeStateMachine instance 2                             │
│       └── Own event queue                                       │
│       └── Own state tracking                                    │
│                                                                  │
│   NOT a singleton - prevents cross-panel contamination          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Integration Points

### Called By
- `MarkdownFileRegistry` → file system changes
- `KanbanWebviewPanel` → user edits, saves
- `IncludeLoadingProcessor` → include switches

### Calls
- `FileSaveService` → save operations
- `IncludeLoadingProcessor` → include loading
- `MarkdownFileRegistry` → file content access
- Webview → `postMessage()` for notifications

---

## Migration Notes for V2

### Keep Same
- State machine pattern
- Event queuing
- Per-panel instances

### Port to Rust
- Create `lexera-core/src/state_machine/mod.rs`
- Use async state machine pattern
- Return state transitions via API

### Improve
- Add state persistence for crash recovery
- Add rollback capability for failed updates
- Add metrics for state duration
