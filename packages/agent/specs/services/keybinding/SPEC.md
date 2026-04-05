# Keybinding System Specification

**Status**: Base-plan critical for v2  
**V2 Targets**: `packages/lexera-backend`, `packages/lexera-kanban`  
**V1 Reference**: `src/services/KeybindingService.ts`, `src/html/*`

---

## Purpose

Define the v2 keyboard interaction system across host-level shortcuts and in-app shortcuts.

This is not a direct port of the v1 VS Code keybinding service. In v2, Lexera owns shortcut behavior explicitly.

---

## Product Goals

- Preserve keyboard-first workflows from v1.
- Make shortcuts predictable across desktop app and embedded editing modes.
- Separate global host shortcuts from board-local shortcuts.
- Avoid relying on editor-host discovery logic like VS Code `keybindings.json`.
- Keep shortcut behavior testable and visible in code.

---

## Ownership Split

### `packages/lexera-backend`

Owns host-level and system-level shortcuts:

- App-global accelerators
- Quick capture launch/focus
- Desktop-only actions that must work even when the board window is unfocused
- Platform registration through Tauri

### `packages/lexera-kanban`

Owns in-app shortcuts:

- Board navigation
- Save, undo, redo
- Search and dashboard interactions
- Log/inspector toggles
- Editor-mode switching
- Modal and overlay shortcut behavior

### Not owned by the system anymore

- Discovery of shortcuts from VS Code user settings
- VS Code command probing
- VS Code snippet-command indirection

---

## Current V2 Implementation Baseline

### Backend shortcuts already present

From `packages/lexera-backend/src-tauri/src/lib.rs`:

- `CmdOrCtrl+Shift+C`: capture selection and open quick capture
- `CmdOrCtrl+B`: focus capture popup

### Client shortcuts already present

From `packages/lexera-kanban/src/app.js`:

- `CmdOrCtrl+Shift+L`: toggle log panel
- `CmdOrCtrl+F`: expand/focus board search
- `CmdOrCtrl+Shift+H`: search and replace
- `CmdOrCtrl+Z`: undo
- `CmdOrCtrl+Y`
- `CmdOrCtrl+Shift+Z`: redo
- `CmdOrCtrl+S`: save board
- `CmdOrCtrl+=`, `CmdOrCtrl+-`, `CmdOrCtrl+0`: UI zoom in/out/reset
- `?`: shortcut help overlay
- `F12`, `CmdOrCtrl+Shift+I`, `Alt+I`: inspector toggle variants
- `Alt+Enter`: close transient UI helper path
- `CmdOrCtrl+W`: close active workspace tab
- `CmdOrCtrl+Shift+]`, `CmdOrCtrl+PageDown`: next workspace tab
- `CmdOrCtrl+Shift+[`, `CmdOrCtrl+PageUp`: previous workspace tab
- `CmdOrCtrl+B`: toggle hierarchy/sidebar panel
- `CmdOrCtrl+Shift+D`: toggle dashboard panel
- `CmdOrCtrl+Shift+E`: toggle files panel
- Overlay editor:
  - `CmdOrCtrl+Enter`: save
  - `CmdOrCtrl+S`: save
  - `Escape`: cancel
  - `CmdOrCtrl+1/2/3/4`: switch editor mode

### Audited board-navigation shortcuts already present

Also from `packages/lexera-kanban/src/app.js`, `keyboard/keyboardNavigation.js`, and the shortcut help overlay:

- Card focus navigation:
  - `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`
  - `Home`, `End`
  - `1-9`: jump to column by position
- Focused-card actions:
  - `Enter`: edit focused card
  - `Escape`: unfocus card / close local interaction
  - `Alt+ArrowUp`, `Alt+ArrowDown`: move card within column
  - `Alt+ArrowLeft`, `Alt+ArrowRight`: move card across adjacent columns
  - `CmdOrCtrl+D`: duplicate focused card
  - `R`: reveal/collapse card content
  - `I`: insert card after focused card
  - `C`: copy card as markdown
  - `E`: edit card
  - `P`: park focused card
  - `Space`: open card context menu
  - `Delete`: delete focused card
  - `N`: create card when no card is focused
- Editor formatting:
  - `CmdOrCtrl+B`, `CmdOrCtrl+I`, `CmdOrCtrl+U`
  - `CmdOrCtrl+K`, `CmdOrCtrl+H`, `CmdOrCtrl+\``

### Suggested keyboard-first coverage

This is the current recommended gap list after the 2026-04-05 audit. These are not all implemented yet.

- Entity-level operations outside cards:
  - open row/stack/column context menu from keyboard
  - rename focused row/stack/column
  - create row/stack/column without mouse
- Structural navigation:
  - focus columns directly, not only cards
  - board back/forward history
  - command palette for action discovery
- Search and selection:
  - simple board text search separate from search/replace
  - multi-select and batch operations
- Discoverability:
  - derive the help overlay from a single shortcut registry instead of a hand-maintained list
  - keep shell, board, editor, and modal scopes explicit in one source of truth

### Gaps in the current baseline

- No centralized declarative registry for client shortcuts
- No unified conflict-resolution policy when multiple UI layers are active
- No documented scope model for global vs board vs editor shortcuts
- Shortcut help overlay exists, but it is not generated from an authoritative registry

---

## Required Shortcut Categories

### 1. Host-global shortcuts

Used when the app is unfocused or when the action is outside board editing.

Examples:

- quick capture
- focus capture window
- future system-wide capture or board launch commands

Rules:

- Registered only by `lexera-backend`
- Must remain minimal
- Must avoid colliding with common OS shortcuts where possible
- Must degrade safely if registration fails

### 2. App-shell shortcuts

Used at the main `lexera-kanban` shell level.

Examples:

- toggle logs
- open search
- open inspector
- open management/network panes

Rules:

- Work only when the Kanban client is focused
- Must not override text-entry behavior unless intentional
- Should be disabled or re-routed while modal dialogs own focus

### 3. Board-operation shortcuts

Used for active board state changes.

Examples:

- save board
- undo
- redo
- future archive/park/move commands

Rules:

- Operate on `activeBoardId`
- Must no-op safely when no board is open
- Must preserve save-base and merge semantics

### 4. Editor shortcuts

Used inside inline or overlay card editing flows.

Examples:

- save editor
- cancel editor
- switch editor mode
- formatting shortcuts

Rules:

- Highest priority inside editor scope
- Must not leak to shell-level handlers
- Must preserve user text input expectations

### 5. Modal and transient-UI shortcuts

Used when dialogs, menus, or drag states are active.

Examples:

- `Escape` to cancel dialog/editor/drag
- future arrow/enter navigation in menus and search results

Rules:

- Modal scope wins over board scope
- Escape handling must unwind the most local active interaction first
- Drag cancellation must clean up state and cross-view bridges

---

## Scope Model

Shortcut dispatch should resolve through explicit scopes in this order:

1. Native host/global
2. Modal/dialog
3. Overlay editor
4. Inline editor
5. Board interaction
6. App shell

If a higher scope handles the event, lower scopes must not run.

---

## Data Model

### ShortcutScope

```typescript
type ShortcutScope =
  | 'global'
  | 'app'
  | 'board'
  | 'inline-editor'
  | 'overlay-editor'
  | 'modal';
```

### ShortcutDefinition

```typescript
interface ShortcutDefinition {
  id: string;
  combo: string;
  scope: ShortcutScope;
  description: string;
  enabledWhen?: string;
  preventDefault?: boolean;
}
```

### ShortcutDispatchContext

```typescript
interface ShortcutDispatchContext {
  hasActiveBoard: boolean;
  hasInlineEditor: boolean;
  hasOverlayEditor: boolean;
  hasModal: boolean;
  hasDragOperation: boolean;
  platform: 'mac' | 'windows' | 'linux';
}
```

### Backend shortcut config

```rust
struct GlobalShortcutDefinition {
    id: String,
    accelerator: String,
    action: String,
}
```

---

## Normalization Rules

- Normalize `Cmd` and `Ctrl` into a platform-aware `CmdOrCtrl` model in docs and registry definitions.
- Compare physical combinations consistently regardless of key capitalization.
- Use symbolic ownership, not ad-hoc event checks spread across the UI.
- Prefer stable action IDs over anonymous inline handlers.

---

## Event Flow

### Host-global shortcut flow

```text
OS shortcut
  -> Tauri global shortcut plugin
  -> backend action handler
  -> quick capture / focus / system action
  -> optional event or notification to client
```

### Client shortcut flow

```text
DOM keydown
  -> resolve active scope
  -> match shortcut definition
  -> prevent default if configured
  -> execute action
  -> trigger save / navigation / dialog / toast / log as needed
```

### Escape flow

```text
Escape
  -> modal?
  -> overlay editor?
  -> inline editor?
  -> drag operation?
  -> shell fallback?
```

---

## Detailed Behavior Requirements

### Save

- `CmdOrCtrl+S` saves the active board.
- If save fails, client reload behavior must stay defensive.
- Save shortcut must respect merge/live-sync state instead of bypassing it.

### Undo / Redo

- `CmdOrCtrl+Z` and redo equivalents operate on the board delta stack.
- Undo/redo must preserve board save-base metadata.
- Undo/redo must be disabled safely when no active board data exists.

### Search

- `CmdOrCtrl+F` opens and focuses the header search UI.
- Search shortcut should not break text editing inside dedicated textareas.
- Search result navigation should eventually have its own keyboard layer.

### Inspector / diagnostics

- Inspector shortcut must remain developer-only behavior.
- Failure to open the inspector should surface a user-facing notification.
- Log panel toggle should stay separate from inspector toggle.

### Editor mode switching

- `CmdOrCtrl+1/2/3/4` switches between markdown, dual, preview, and wysiwyg modes.
- Switching modes must not discard unsaved editor state.
- Mode switching is only valid in editor scope.

---

## Integration Points

### Backend integrations

- `tauri-plugin-global-shortcut`
- quick capture
- tray/background app lifecycle
- possible future native menu bindings

### Client integrations

- board save pipeline
- undo/redo state
- search UI
- log panel
- card editor overlay
- inline editor
- drag/drop cancellation

---

## Migration From V1

### Keep

- Keyboard-first interaction philosophy
- Key normalization discipline
- Command-oriented behavior naming

### Replace

- VS Code shortcut discovery
- VS Code command availability probing
- snippet lookup as a keybinding concern

### Add in v2

- explicit scope model
- backend/global vs client/local split
- shortcut registry that can power help/docs/tests

---

## Testing Requirements

### Backend

- global shortcuts register successfully on supported platforms
- registration failure is logged cleanly
- quick capture shortcut routes to the correct action

### Client

- shell shortcuts do not fire while editor scopes own the event
- editor save/cancel shortcuts work in overlay and inline modes
- Escape unwinds the correct active interaction
- save/undo/redo shortcuts no-op safely without an active board
- search shortcut focuses the correct control

### Regression checks

- shortcut collisions between shell and editor scopes
- browser default behavior leakage where preventDefault is required
- platform-specific modifier mismatches

---

## Open Design Work

- create a declarative client shortcut registry instead of scattered listeners
- add discoverability UI for available shortcuts
- decide whether user-customizable shortcuts are a v2 goal or a post-base-plan feature
- define which shortcuts are disabled in embedded/mobile contexts
