# Lexera V2 Base Plan

## Goal

Use the proven behavior from v1 as the baseline, but organize v2 around the actual Lexera package split:

- `packages/lexera-core` = shared board model and data operations
- `packages/lexera-backend` = desktop host, API surface, sync, discovery, collaboration
- `packages/lexera-kanban` = Kanban client UI
- `packages/lexera-capture-ios` = mobile capture client
- `packages/marp-engine` = shared export/presentation engine

V1 references come from:

- `src/`
- `packages/ludos-sync/`

## Base Architecture

### 1. Shared board core: `packages/lexera-core`

Base from v1:

- `shared/types`
- `shared/parser`
- `shared/markdown`
- `core/gather`
- `ux/search`
- parts of `services/boardregistry`
- parts of `core/statemachine`

Keep:

- Markdown board format
- Board settings in YAML
- Includes and embedded board content
- Search semantics for cards, tags, and temporal fields
- Board/card concepts and round-trip file generation

Change for v2:

- Rust becomes the source of truth for parsing and write logic
- Card identity moves to internal `kid` metadata instead of relying on inline markers
- Storage owns atomic writes, watcher integration, and self-write suppression
- Merge happens at card level
- CRDT/live-sync support is part of the core direction
- Rows/stacks/columns are first-class, not an afterthought

### 2. Desktop backend: `packages/lexera-backend`

Base from v1:

- `packages/ludos-sync`
- `services/boardregistry`
- `services/mediatracker`
- `core/statemachine`
- `files/*`
- extension-side service coordination from `src/services/*`

Keep:

- Central board registry responsibilities
- File watching and change propagation
- Search, media, file, and board operations behind a stable surface
- Sync ownership outside the UI

Change for v2:

- Tauri app replaces the VS Code extension host
- Rust backend replaces the Node/WebDAV sync server as the primary runtime
- HTTP, SSE, and WebSocket/live-sync APIs replace extension message plumbing
- Tray, clipboard capture, peer discovery, and collaboration become first-class backend features
- Persistence and sync orchestration live beside the board store, not in a separate extension layer

### 3. Kanban client: `packages/lexera-kanban`

Base from v1:

- `core/board`
- `core/editor`
- `ux/dragdrop`
- `ux/menus`
- `ux/search`
- `ux/export`
- `shared/markdown`

Keep:

- Board rendering
- Card editing, including dual-mode editing where it still fits
- Drag and drop
- Menus and inline board interactions
- Dashboard/search-driven navigation
- Rich markdown and embedded content rendering

Change for v2:

- Standalone app UI, not a VS Code webview
- API-driven client that depends on backend/core instead of directly owning persistence logic
- Logs, connection management, split panes, and sync state are client concerns
- UI should stay thinner than v1 by pushing storage and merge logic down into the backend/core

### 4. Interaction systems: keybinding + notification

Base from v1:

- `services/keybinding`
- `services/notification`
- client-side keyboard and toast/dialog behavior in `src/html/*`

Keep:

- Keyboard-driven workflows as a core product feature
- Normalized shortcut handling across editing modes
- Clear confirmation flows for destructive actions
- Lightweight notifications for success, warning, and error states
- Modal flows for conflict resolution, unsaved changes, and privileged actions

Change for v2:

- `lexera-backend` owns host/native shortcuts such as global accelerators and desktop-level actions
- `lexera-kanban` owns in-app keyboard handling, mode-aware shortcuts, toasts, dialogs, status bar, and log surfaces
- Notification design splits between in-app feedback and native/system dialogs instead of a single VS Code API wrapper
- Shortcut behavior should be explicit and testable instead of inferred from host editor settings

Detailed baseline:

- global shortcuts already exist for quick capture and popup focus in `lexera-backend`
- `lexera-kanban` already handles save, undo, redo, search, log toggle, inspector toggle, editor save/cancel, and editor mode switching
- `lexera-kanban` already has toast notifications, confirm dialogs, merge conflict dialogs, status bar state, and an expandable log panel

Base-plan implementation goals:

- introduce an explicit shortcut scope model: host, app shell, board, editor, modal
- replace scattered client key listeners with a documented registry over time
- define notification surfaces formally: toast, dialog, status bar, log panel, native/system prompt
- ensure every destructive or ambiguous workflow has an explicit confirmation path
- tie user-facing notifications to structured logs where the event is operationally important

### 5. Capture clients: `packages/lexera-backend` and `packages/lexera-capture-ios`

Base from v1:

- Minimal direct equivalent in v1

Keep:

- Fast capture into existing boards/cards as a product goal

Change for v2:

- Capture is its own surface, not a side-effect of the editor
- Desktop backend owns quick-capture window and clipboard flows
- iOS client can create/edit/search boards directly against shared Lexera concepts

### 6. Shared export/presentation: `packages/lexera-core` + `packages/marp-engine`

Base from v1:

- `ux/export`
- `shared/markdown`
- `packages/marp-engine`

Keep:

- Shared markdown/presentation pipeline
- Reusable export transforms
- Marp-based presentation generation

Change for v2:

- Core owns export-ready transformations
- Backend exposes extraction and transform APIs
- `lexera-kanban` currently owns export UI and desktop runner commands
- `marp-engine` stays shared instead of being folded into one app

### 7. Content plugin system: `lexera-core` + `lexera-kanban` + `lexera-backend` + `marp-engine`

Base from v1:

- `plugins/registry`
- `shared/markdown`
- `core/editor`
- `ux/export`
- `src/services/export/*`

Keep:

- plugin-driven markdown extensions
- diagram/media/embed specialization
- Marp and Pandoc as separate export runners

Change for v2:

- move from a runtime-specific plugin registry to a content-plugin architecture with one manifest and multiple adapters
- define plugin capabilities across Kanban display, WYSIWYG editing, and export conversion
- normalize plugin-owned content before it reaches UI or export targets
- let export plugins convert content before final Marp/Pandoc execution instead of embedding ad-hoc rewrite logic everywhere
- keep current export split explicit: backend for content extraction/transform, desktop shell for current CLI runner execution

Base-plan implementation goals:

- one content plugin ID per feature
- one normalized content shape per feature
- one Kanban renderer adapter per feature when needed
- one WYSIWYG adapter per feature when needed
- one export transform adapter per feature when the target cannot consume raw syntax directly
- separate content transformation from Marp/Pandoc CLI runner concerns

## Base-Plan Priorities

1. Lock the data model and markdown I/O in `lexera-core`.
2. Keep registry, watcher, sync, and collaboration ownership in `lexera-backend`.
3. Keep `lexera-kanban` focused on board UX rather than persistence internals.
4. Treat keybinding and notification systems as core UX infrastructure, not optional polish.
5. Treat capture as a real v2 workstream, not an optional add-on.
6. Build a content plugin system that spans Kanban display, WYSIWYG, and export conversion.
7. Reuse `marp-engine` instead of rebuilding export logic.

## Explicitly Deferred From The Base Plan

- VS Code provider abstractions
- VS Code command wiring
- fully open third-party plugin marketplace behavior

Those may return later, but they should not shape the initial v2 package layout.
