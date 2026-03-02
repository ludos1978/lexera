# Notification System Specification

**Status**: Base-plan critical for v2  
**V2 Targets**: `packages/lexera-backend`, `packages/lexera-kanban`  
**V1 Reference**: `src/services/NotificationService.ts`, conflict/unsaved-change flows in `src/services/*`, client feedback patterns in `src/html/*`

---

## Purpose

Define how Lexera v2 communicates feedback, errors, confirmations, and system state to the user.

This is not just a port of the v1 VS Code notification wrapper. In v2, the notification system is a product-level interaction layer spanning the Kanban client and the desktop host.

---

## Product Goals

- Make success, warning, and error feedback immediate and consistent.
- Keep lightweight events lightweight.
- Reserve modal interruption for destructive or ambiguous decisions.
- Surface backend and sync state without forcing constant dialogs.
- Tie notifications to logs and system state where possible.

---

## Ownership Split

### `packages/lexera-kanban`

Owns in-app notification surfaces:

- toast notifications
- confirm dialogs rendered in the client
- merge conflict dialogs
- save/discard prompts inside editor flows
- status bar state
- expandable log panel

### `packages/lexera-backend`

Owns host/native feedback where needed:

- desktop-level confirmations for privileged actions
- startup/tray/runtime error logging
- future OS-native dialogs and notifications
- background-only feedback when no Kanban window is focused

### `packages/lexera-core`

Does not present UI directly. It provides structured errors and state that backend/client surfaces can render.

---

## Current V2 Implementation Baseline

### Client feedback already present

From `packages/lexera-kanban/src/app.js`:

- ephemeral toast notifications via `showNotification(message)`
- merge conflict dialog
- custom confirm dialog replacing `window.confirm`
- status bar message area
- dedicated frontend/backend log panel
- many action-driven notifications:
  - save outcomes
  - rename outcomes
  - invite creation/revoke
  - board add/remove
  - connection and settings actions
  - inspector state

### Backend feedback already present

From `packages/lexera-backend/src-tauri/src/lib.rs` and related modules:

- structured logging for shortcut failures, watcher issues, tray setup failures, setup errors
- background/tray style runtime ownership
- host environment where native dialog integration belongs

### Gaps in current baseline

- no unified notification taxonomy
- toasts are string-only and action-less
- no shared request/response contract between backend and client notification surfaces
- no documented escalation path from toast -> dialog -> native prompt

---

## Notification Surface Model

### 1. Toast

Use for lightweight feedback that does not block work.

Examples:

- saved
- invite copied
- disconnected
- settings saved
- inspector opened

Rules:

- auto-dismiss
- non-blocking
- concise language
- should often be paired with logs when the event is technical

### 2. Modal dialog

Use for decisions that require user confirmation or conflict handling.

Examples:

- destructive confirmation
- merge conflict resolution
- save/discard decisions
- future replace/overwrite flows

Rules:

- blocks local workflow until resolved
- must expose clear actions
- must support Escape and overlay dismissal rules intentionally

### 3. Status bar

Use for persistent lightweight state.

Examples:

- last frontend/backend log line
- warning/error emphasis
- connection health hint

Rules:

- always visible
- not too noisy
- clicking can expose more detail

### 4. Log panel

Use for detailed operational visibility.

Examples:

- frontend errors
- backend logs
- sync/runtime issues

Rules:

- detailed, not interruptive
- searchable/filterable later if needed
- source-aware (`frontend` vs `backend`)

### 5. Native/system dialog

Use for host-level actions that should not depend on the client DOM.

Examples:

- privileged filesystem operations
- actions from tray/background context
- future OS notifications when the window is not focused

Rules:

- owned by backend
- used sparingly
- reserved for cases where the host context matters

---

## Severity Model

```typescript
type NotificationLevel = 'info' | 'success' | 'warn' | 'error';
```

### Suggested meanings

- `info`: neutral state change
- `success`: completed user action
- `warn`: recoverable problem or decision point
- `error`: failed action or system issue

---

## Data Model

### NotificationRequest

```typescript
interface NotificationRequest {
  id: string;
  level: NotificationLevel;
  surface: 'toast' | 'dialog' | 'status' | 'native';
  title?: string;
  message: string;
  actions?: Array<{ id: string; label: string }>;
  timeoutMs?: number;
  source?: 'frontend' | 'backend' | 'sync' | 'capture';
}
```

### ConfirmationRequest

```typescript
interface ConfirmationRequest {
  id: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}
```

### LogEntry

```typescript
interface LogEntry {
  timestampMs: number;
  level: NotificationLevel;
  target: string;
  message: string;
  source: 'frontend' | 'backend';
}
```

---

## Escalation Rules

### Toast only

Use when:

- no user decision is required
- retry is implicit or obvious
- the action succeeded or failed locally without ambiguity

### Dialog

Use when:

- the user must choose between two or more valid paths
- destructive action is about to happen
- merge or overwrite semantics need explicit consent

### Log + toast

Use when:

- the user needs a short summary now
- developers need detailed diagnostics later

### Native prompt

Use when:

- action originates outside the main client window
- host integration makes DOM dialogs unreliable or unavailable
- permission/OS context is important

---

## Event Flow

### Standard client action

```text
User action
  -> client handler
  -> success/failure result
  -> toast and/or status update
  -> optional log entry
```

### Conflict flow

```text
Save attempt
  -> backend merge detects unresolved conflicts
  -> client receives merge result
  -> merge conflict dialog
  -> user picks server version or keeps local version
```

### Runtime issue flow

```text
Backend runtime issue
  -> backend log entry
  -> log stream reaches client
  -> status bar reflects latest significant entry
  -> user can expand log panel for detail
```

### Destructive confirm flow

```text
Delete/remove/overwrite request
  -> confirm dialog
  -> user cancels or confirms
  -> result toast/log if needed
```

---

## Detailed Behavior Requirements

### Success feedback

- successful mutations should usually produce a toast, not a dialog
- repeated success messages should avoid spam where possible
- long-running flows should eventually support progress + completion feedback

### Error feedback

- user-facing errors must be readable and actionable
- technical detail belongs in logs, not raw toast text
- failures from keyboard shortcuts should not silently disappear

### Conflict feedback

- unresolved merges must never appear as silent failures
- auto-merged changes may use a non-blocking notification
- unresolved conflicts require explicit dialog handling

### Confirmation flows

- destructive actions require confirm dialogs
- copy should name the resource being affected when possible
- confirm/cancel labels should reflect the action, not generic yes/no wording

### Status and diagnostics

- status bar should show the most recent important entry
- log panel remains the long-lived diagnostic surface
- frontend and backend logs should stay separated but easy to compare

---

## Integration Points

### Client integrations

- board save pipeline
- merge/save conflict handling
- network management UI
- invite and collaboration flows
- settings forms
- inspector/devtools helpers
- search/dashboard actions

### Backend integrations

- startup/setup failures
- tray/runtime state
- global shortcut failures
- watcher and sync failures
- future native dialog or system notification APIs

---

## Migration From V1

### Keep

- consistent naming for confirm/save-discard patterns
- centralization of common notification behaviors
- lightweight API for callers

### Replace

- VS Code `show*Message()` dependency
- assumption that one host API can cover all notification surfaces

### Add in v2

- toast + dialog + status + log surface model
- frontend/backend source separation
- escalation rules for when each surface is appropriate

---

## Testing Requirements

### Client

- toast renders and auto-dismisses
- confirm dialog resolves correct boolean/action
- merge conflict dialog offers both expected paths
- Escape closes the correct active dialog/editor
- repeated notifications do not break layout or leak DOM nodes
- status bar updates from latest log entry

### Backend

- runtime errors are logged with enough context
- background actions can surface host-level feedback
- future native dialog integration remains non-blocking to the runtime

### Regression checks

- notification spam during repeated saves/sync retries
- dialog stacking conflicts
- stale log/status state after reconnect or panel close

---

## Open Design Work

- add typed notification requests instead of raw string toasts
- add action buttons for some toast classes
- define when progress indicators are required
- decide whether some backend-originated notifications should appear as native OS notifications
- unify confirm dialogs so all destructive paths use the same component
