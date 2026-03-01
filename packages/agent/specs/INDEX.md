# V2 Base Plan Index

## V2 Package Map

| Workstream | V2 target | Main v1 base | Shared dependency | Notes |
|------------|-----------|--------------|-------------------|-------|
| Board model, parser, includes, search, merge, storage | `packages/lexera-core` | `src/`, mainly parser/types/state/search logic | `packages/marp-engine` for presentation/export pipeline | Rust is the source of truth in v2 |
| Desktop runtime, board registry, watcher, sync, collaboration, capture | `packages/lexera-backend` | `src/services/*`, `src/files/*`, `src/core/*`, `packages/ludos-sync/` | `packages/lexera-core` | Replaces extension host + standalone sync server |
| Board UI, editor, drag/drop, menus, dashboard | `packages/lexera-kanban` | `src/html/*`, `src/kanbanWebviewPanel.ts`, board/editor UX | `packages/lexera-core`, backend API | Replaces the v1 webview client |
| Mobile capture | `packages/lexera-capture-ios` | no direct v1 package equivalent | `packages/lexera-core` concepts | New in v2 |
| Presentation and export | `packages/lexera-core` + `packages/lexera-backend` | `src/services/export/*`, `src/html/exportMarpUI.js` | `packages/marp-engine` | Shared engine stays shared |

## V1 Reference Specs By V2 Area

### Core logic feeding `lexera-core`

- `shared/types/SPEC.md`: board, column, card, and settings model
- `shared/parser/SPEC.md`: markdown parsing and generation rules
- `shared/markdown/SPEC.md`: rich markdown rendering behaviors worth preserving
- `core/gather/SPEC.md`: automatic sorting and board query behavior
- `ux/search/SPEC.md`: card search and temporal resolution behavior
- `core/statemachine/SPEC.md`: useful reference for change sequencing, but not a direct port

### Backend/runtime feeding `lexera-backend`

- `services/boardregistry/SPEC.md`: central board registry responsibilities
- `services/mediatracker/SPEC.md`: file/media tracking responsibilities
- `core/statemachine/SPEC.md`: coordination patterns for save/change handling
- v1 runtime outside this folder: `packages/ludos-sync/`

### Client UX feeding `lexera-kanban`

- `core/board/SPEC.md`: board rendering and structure
- `core/editor/SPEC.md`: card editing behavior
- `ux/dragdrop/SPEC.md`: drag/drop interaction model
- `ux/menus/SPEC.md`: context menu behavior
- `ux/search/SPEC.md`: dashboard/search UX
- `ux/export/SPEC.md`: export UI behaviors worth keeping
- `shared/markdown/SPEC.md`: client-side rendering details

### Shared/export layer feeding `lexera-core` and `lexera-backend`

- `ux/export/SPEC.md`: export flow and settings
- `shared/markdown/SPEC.md`: markdown plugin behavior
- shared code outside this folder: `packages/marp-engine/`

## Deferred Or V1-Only Reference Specs

These are still useful references, but they are not shaping the initial v2 package split:

- `plugins/registry/SPEC.md`: plugin-system ideas, not a base-plan requirement
- `services/keybinding/SPEC.md`: VS Code-specific service, likely replaced by host-native shortcuts
- `services/notification/SPEC.md`: VS Code-specific service, likely replaced by Tauri/UI-native dialogs

## Reading Order

1. `BASE_PLAN.md`
2. This file
3. The relevant v1 `SPEC.md` files for the workstream you are changing
