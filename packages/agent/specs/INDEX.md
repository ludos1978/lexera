# V2 Base Plan Index

## Quick Navigation

| Category | Specs |
|----------|-------|
| **Core Data** | [Types](shared/types/SPEC.md), [Parser](shared/parser/SPEC.md), [Markdown](shared/markdown/SPEC.md) |
| **Core Logic** | [Gather](core/gather/SPEC.md), [State Machine](core/statemachine/SPEC.md), [Mutations](core/mutations/SPEC.md) |
| **Board UX** | [Board Renderer](core/board/SPEC.md), [Editor](core/editor/SPEC.md) |
| **Interaction** | [Drag/Drop](ux/dragdrop/SPEC.md), [Menus](ux/menus/SPEC.md), [Search](ux/search/SPEC.md), [Export](ux/export/SPEC.md), [Actions](ux/actions/SPEC.md), [Menu Contributors](ux/menu-contributors/SPEC.md), [Board Settings](ux/board-settings/SPEC.md) |
| **Services** | [API](services/api/SPEC.md), [Save & Recovery](services/save/SPEC.md), [Board Registry](services/boardregistry/SPEC.md), [Keybinding](services/keybinding/SPEC.md), [Notification](services/notification/SPEC.md), [Media Tracker](services/mediatracker/SPEC.md) |
| **Plugins** | [Content System](plugins/content/SPEC.md), [Registry](plugins/registry/SPEC.md), [Diagram Registry](plugins/diagram/SPEC.md), [Enhancer Pipeline](plugins/enhancer/SPEC.md) |
| **Sync** | [Sync & Collaboration](sync/SPEC.md) |
| **Meta** | [Template & Guidelines](TEMPLATE.md) |

---

## V2 Package Map

| Workstream | V2 target | Main v1 base | Shared dependency | Specs |
|------------|-----------|--------------|-------------------|-------|
| Board model, parser, includes, search, merge, storage | `packages/lexera-core` | `src/`, mainly parser/types/state/search logic | `packages/marp-engine` for presentation/export pipeline | [Types](shared/types/SPEC.md), [Parser](shared/parser/SPEC.md), [Gather](core/gather/SPEC.md), [State Machine](core/statemachine/SPEC.md), [Save & Recovery](services/save/SPEC.md) |
| Desktop runtime, board registry, watcher, sync, collaboration, capture | `packages/lexera-backend` | `src/services/*`, `src/files/*`, `src/core/*`, `packages/ludos-sync/` | `packages/lexera-core` | [API](services/api/SPEC.md), [Save & Recovery](services/save/SPEC.md), [Board Registry](services/boardregistry/SPEC.md), [Keybinding](services/keybinding/SPEC.md), [Notification](services/notification/SPEC.md), [Sync](sync/SPEC.md) |
| Board UI, editor, drag/drop, menus, dashboard | `packages/lexera-kanban` | `src/html/*`, `src/kanbanWebviewPanel.ts`, board/editor UX | `packages/lexera-core`, backend API | [Board Renderer](core/board/SPEC.md), [Editor](core/editor/SPEC.md), [Drag/Drop](ux/dragdrop/SPEC.md), [Menus](ux/menus/SPEC.md), [Search](ux/search/SPEC.md), [Export](ux/export/SPEC.md), [Save & Recovery](services/save/SPEC.md) |
| Mobile capture | `packages/lexera-capture-ios` | no direct v1 package equivalent | `packages/lexera-core` concepts | (planned) |
| Presentation and export | `packages/lexera-core` + `packages/lexera-backend` + `packages/lexera-kanban` | `src/services/export/*`, `src/html/exportMarpUI.js` | `packages/marp-engine` | [Export](ux/export/SPEC.md), [Content Plugins](plugins/content/SPEC.md) |

---

## Interaction Systems

These systems span multiple packages:

| System | Backend Role | Client Role | Spec |
|--------|--------------|-------------|------|
| Keybinding | Global/native shortcuts, quick capture | In-app shortcuts, editor bindings | [Keybinding](services/keybinding/SPEC.md) |
| Notification | Native dialogs, background errors | Toasts, confirm dialogs, status bar | [Notification](services/notification/SPEC.md) |
| Content Plugins | Export transforms, target conversion | Kanban render, WYSIWYG editing | [Content System](plugins/content/SPEC.md) |

---

## V1 Reference Specs By V2 Area

### Core logic feeding `lexera-core`

- `shared/types/SPEC.md`: board, column, card, and settings model
- `shared/parser/SPEC.md`: markdown parsing and generation rules
- `shared/markdown/SPEC.md`: rich markdown rendering behaviors worth preserving
- `core/gather/SPEC.md`: automatic sorting and board query behavior
- `ux/search/SPEC.md`: card search and temporal resolution behavior
- `core/statemachine/SPEC.md`: useful reference for change sequencing, but not a direct port

### Backend/runtime feeding `lexera-backend`

- `services/api/SPEC.md`: **NEW** - Complete API surface definition
- `services/save/SPEC.md`: durable save, rebase, and crash-recovery contract
- `services/boardregistry/SPEC.md`: central board registry responsibilities
- `services/keybinding/SPEC.md`: host/native shortcut ownership and normalization reference
- `services/notification/SPEC.md`: native confirmation/progress flow reference
- `services/save/SPEC.md`: canonical save coordination and crashsave policy
- `sync/SPEC.md`: **NEW** - Sync and collaboration architecture
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
- `services/keybinding/SPEC.md`: in-app shortcut expectations and command mapping reference
- `services/notification/SPEC.md`: toasts, dialogs, confirmations, and save/discard reference
- `services/save/SPEC.md`: save guarantees, external rebase handling, and recovery UX

### Content plugin system feeding all content surfaces

- `plugins/content/SPEC.md`: v2 content-plugin architecture across Kanban, WYSIWYG, and export
- `plugins/registry/SPEC.md`: v1 registry and interface reference
- `shared/markdown/SPEC.md`: current markdown renderer complexity to modularize
- `core/editor/SPEC.md`: current editor behavior to preserve through plugin adapters
- `ux/export/SPEC.md`: export conversion and target behavior reference

### Shared/export layer feeding `lexera-core` and `lexera-backend`

- `ux/export/SPEC.md`: export flow and settings
- `shared/markdown/SPEC.md`: markdown plugin behavior
- shared code outside this folder: `packages/marp-engine/`

---

## Reading Order

### For Backend Developers
1. `BASE_PLAN.md` - Overall architecture
2. `services/api/SPEC.md` - API surface to implement
3. `services/save/SPEC.md` - Save coordinator and crash-recovery contract
4. `sync/SPEC.md` - Sync architecture
5. `shared/parser/SPEC.md` - Markdown format to support
6. `core/statemachine/SPEC.md` - Change coordination patterns

### For Frontend Developers
1. `BASE_PLAN.md` - Overall architecture
2. `services/api/SPEC.md` - Available API endpoints
3. `services/save/SPEC.md` - Save, rebase, and recovery behavior
4. `core/board/SPEC.md` - Board rendering
5. `core/editor/SPEC.md` - Card editing
6. `ux/dragdrop/SPEC.md` - Drag/drop interactions
7. `services/keybinding/SPEC.md` - Keyboard handling

### For Plugin/Content Developers
1. `plugins/content/SPEC.md` - Content plugin architecture
2. `plugins/registry/SPEC.md` - V1 registry reference
3. `shared/markdown/SPEC.md` - Markdown rendering
4. `ux/export/SPEC.md` - Export pipeline

---

## Deferred Or V1-Only Reference Specs

These are still useful references, but they are not shaping the initial v2 package split:

- fully open third-party plugin marketplace behavior
