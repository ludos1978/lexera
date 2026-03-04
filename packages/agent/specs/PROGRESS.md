# V2 Planning Status

This file tracks the simplified v2 planning view with implementation priorities and sequencing.

---

## Implementation Phases

### Phase 1: Core Foundation (MVP)
**Goal**: Basic board viewing and editing with local storage

| Component | Status | Priority | Blocked By |
|-----------|--------|----------|------------|
| Board model (`lexera-core`) | ✅ Baseline | P0 | - |
| Markdown parser (`lexera-core`) | ✅ Baseline | P0 | - |
| Storage layer (`lexera-core`) | ✅ Baseline | P0 | - |
| Save coordinator & recovery (`lexera-core` + `lexera-backend` + `lexera-kanban`) | 🚧 In Progress | P0 | Storage layer |
| Backend API - boards (`lexera-backend`) | 📋 Spec'd | P0 | - |
| Backend API - cards (`lexera-backend`) | 📋 Spec'd | P0 | - |
| Kanban board render (`lexera-kanban`) | ✅ Baseline | P0 | - |
| Kanban card editor (`lexera-kanban`) | ✅ Baseline | P0 | - |

### Phase 2: Essential UX
**Goal**: Full board editing experience

| Component | Status | Priority | Blocked By |
|-----------|--------|----------|------------|
| Drag & drop system | ✅ Baseline | P1 | Phase 1 |
| Menu operations | ✅ Baseline | P1 | Phase 1 |
| Search & dashboard | ✅ Baseline | P1 | Phase 1 |
| Keybinding system | ✅ Baseline | P1 | Phase 1 |
| Notification system | ✅ Baseline | P1 | Phase 1 |
| Gather query engine | ✅ Baseline | P2 | Phase 1 |

### Phase 3: Sync & Export
**Goal**: Sync and export capabilities

| Component | Status | Priority | Blocked By |
|-----------|--------|----------|------------|
| Sync state machine | 📋 Spec'd | P1 | Phase 1 |
| WebDAV sync | 📋 Spec'd | P2 | Sync state |
| Export pipeline | ✅ Baseline | P2 | Phase 1 |
| Marp integration | ✅ Baseline | P2 | Export |
| Pandoc integration | ✅ Baseline | P2 | Export |

### Phase 4: Advanced Features
**Goal**: Collaboration and extensibility

| Component | Status | Priority | Blocked By |
|-----------|--------|----------|------------|
| Content plugin system | 📋 Spec'd | P2 | Phase 2 |
| Live sync (WebSocket) | 🔜 Planned | P3 | Phase 3 |
| Save coordinator and recovery | 🚧 In Progress | P0 | Phase 1 |
| Quick capture | ✅ Baseline | P2 | Phase 1 |
| iOS capture client | 🔜 Planned | P3 | Backend API |

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ Baseline | Spec complete, v1 reference available, ready for implementation |
| 📋 Spec'd | Spec complete, needs implementation |
| 🔜 Planned | Needs spec work before implementation |
| 🚧 In Progress | Currently being implemented |
| ⏸️ Deferred | Post-base-plan |

---

## Track Status Overview

| Track | Status | Source of truth | Notes |
|-------|--------|-----------------|-------|
| Board model and markdown I/O | ✅ Baseline | `packages/lexera-core` | Built from v1 parser/types behavior, but owned by Rust in v2 |
| Storage, watcher, merge, and search | ✅ Baseline | `packages/lexera-core` | Replaces extension-side file/state handling with atomic, core-owned logic |
| Backend runtime and API | 📋 Spec'd | `packages/lexera-backend` | API surface defined, ready for implementation |
| Save coordinator and recovery | 🚧 In Progress | `packages/lexera-core` + `packages/lexera-backend` + `packages/lexera-kanban` | Durable drafts, revisioned commit flow, and crashsave fallback |
| Live sync and collaboration | 🔜 Planned | `packages/lexera-backend` + `packages/lexera-core` | Sync spec complete, live-sync needs design |
| Kanban UI | ✅ Baseline | `packages/lexera-kanban` | Port v1 board/editor UX selectively, but keep the client thinner |
| Keybinding system | ✅ Baseline | `packages/lexera-backend` + `packages/lexera-kanban` | Native/global shortcuts in backend, in-app shortcuts in client |
| Notification system | ✅ Baseline | `packages/lexera-backend` + `packages/lexera-kanban` | In-app toasts/dialogs plus native confirmations are part of the base plan |
| Content plugin system | 📋 Spec'd | `packages/lexera-core` + `packages/lexera-kanban` + `packages/lexera-backend` + `packages/marp-engine` | Manifest spec complete, implementation pending |
| Capture flows | ✅ Baseline | `packages/lexera-backend` + `packages/lexera-capture-ios` | Desktop capture ready, iOS client planned |
| Presentation/export | ✅ Baseline | `packages/lexera-core` + `packages/lexera-backend` + `packages/lexera-kanban` + `packages/marp-engine` | Backend handles extract/transform APIs, Kanban desktop shell currently handles runner commands |
| Open third-party plugin ecosystem | ⏸️ Deferred | none | Internal plugin structure first, marketplace behavior later |

---

## Architecture Decisions

### Data Ownership
- `lexera-core` owns board data, markdown parsing, write safety, merge, search, and export transforms.
- `lexera-backend` owns registry, file watching, HTTP/SSE/WS surfaces, discovery, collaboration, and desktop capture.
- `lexera-kanban` owns board UX, editing, drag/drop, menus, dashboard, and connection-state presentation.

### Interaction Systems
- Keybinding is split across backend-native shortcuts and client in-app keyboard behavior.
- Notification is split across client toasts/dialogs and backend/native confirmation surfaces.

### Content & Export
- Content features should be modeled once and adapted separately for Kanban render, WYSIWYG, and export.
- Marp and Pandoc stay target runners; content conversion happens before runner execution.
- Export ownership is currently split: backend for extraction/transform APIs, `lexera-kanban` for export UI and runner commands.

### Legacy References
- `packages/ludos-sync` is a v1 reference, not the v2 runtime boundary.
- `packages/marp-engine` stays shared.

---

## Spec Completeness Matrix

| Spec | Status | Has Data Model | Has API | Has Migration Notes |
|------|--------|----------------|---------|---------------------|
| `shared/types` | ✅ | ✅ | - | ✅ |
| `shared/parser` | ✅ | ✅ | - | ✅ |
| `shared/markdown` | ✅ | ✅ | - | ✅ |
| `core/gather` | ✅ | ✅ | - | ✅ |
| `core/board` | ✅ | ✅ | - | ✅ |
| `core/editor` | ✅ | ✅ | - | ✅ |
| `core/statemachine` | ✅ | ✅ | - | ✅ |
| `ux/search` | ✅ | ✅ | - | ✅ |
| `ux/dragdrop` | ✅ | ✅ | - | ✅ |
| `ux/menus` | ✅ | ✅ | - | ✅ |
| `ux/export` | ✅ | ✅ | - | ✅ |
| `services/keybinding` | ✅ | ✅ | - | ✅ |
| `services/notification` | ✅ | ✅ | - | ✅ |
| `services/boardregistry` | ✅ | ✅ | ✅ | ✅ |
| `services/api` | ✅ | ✅ | ✅ | ✅ |
| `services/save` | 🚧 | ✅ | ✅ | ✅ |
| `plugins/content` | ✅ | ✅ | - | ✅ |
| `plugins/registry` | ✅ | ✅ | - | ✅ |
| `sync` | ✅ | ✅ | ✅ | ✅ |

---

## Next Actions

1. **Finish save coordinator phase 1** - Crashsave fallback, durable-draft contract, and recovery UX
2. **Finish external revision freshness hardening** - watcher/SSE events must use backend-computed revision tokens and include-targeted reload/rebase
3. **Implement Backend API** - Start with board/card CRUD endpoints
4. **Port Core Parser to Rust** - Markdown parsing in `lexera-core`
5. **Wire Kanban to Backend** - Replace direct file access with API calls
6. **Implement Sync State Machine** - Offline queue + conflict detection
