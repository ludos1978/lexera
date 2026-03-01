# V1 Specification Progress

## Terminology Note
- **Card** = KanbanCard data type (what users see as "tasks")
- **Task** = V1 code naming (preserved in function names like `addTask()`, `moveTaskInDOM()`)

---

## Completed Specs (5,212 lines total)

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| Types | `shared/types/SPEC.md` | 313 | ✅ Complete |
| Parser | `shared/parser/SPEC.md` | 477 | ✅ Complete |
| Markdown Renderer | `shared/markdown/SPEC.md` | 252 | ✅ Complete |
| Board Renderer | `core/board/SPEC.md` | 449 | ✅ Complete |
| Card Editor | `core/editor/SPEC.md` | 517 | ✅ Complete |
| Drag & Drop | `ux/dragdrop/SPEC.md` | 695 | ✅ Complete |
| Dashboard Scanner | `ux/search/SPEC.md` | 362 | ✅ Complete |
| Menu Operations | `ux/menus/SPEC.md` | 280 | ✅ Complete |
| Export UI | `ux/export/SPEC.md` | 285 | ✅ Complete |
| Gather Query Engine | `core/gather/SPEC.md` | 220 | ✅ Complete |
| Change State Machine | `core/statemachine/SPEC.md` | 260 | ✅ Complete |
| Board Registry Service | `services/boardregistry/SPEC.md` | 280 | ✅ Complete |
| Media Tracker | `services/mediatracker/SPEC.md` | 322 | ✅ Complete |

---

## Spec Summary

### Shared Components
| Spec | Purpose |
|------|---------|
| **Types** | KanbanBoard, KanbanColumn, KanbanCard, BoardSettings |
| **Parser** | State machine, parsing rules, token handling |
| **Markdown** | Caching, plugins, media, diagrams, embeds |

### Core Components
| Spec | Purpose |
|------|---------|
| **Board Renderer** | DOM structure, incremental updates, folding |
| **Card Editor** | CardEditor class, inline editing, WYSIWYG |
| **Gather Engine** | Automatic card sorting via column queries |
| **State Machine** | Unified change handling with event queuing |

### UX Components
| Spec | Purpose |
|------|---------|
| **Drag & Drop** | State machine, hierarchical drop calculation |
| **Search** | Dashboard scanner, temporal resolution |
| **Menus** | Tag menus, card/column context menus |
| **Export** | Dialog, Marp settings, auto-export |

### Services
| Spec | Purpose |
|------|---------|
| **Board Registry** | Singleton board management, config, search |
| **Media Tracker** | File modification tracking, change detection |

---

## Remaining Work (Optional)

| Component | Priority | Complexity |
|-----------|----------|------------|
| WYSIWYG Pipeline | LOW | ~300 lines |
| Keybinding Service | LOW | ~200 lines |
| Notification Service | LOW | ~150 lines |

---

## Directory Structure

```
packages/agent/specs/
├── core/
│   ├── board/SPEC.md
│   ├── editor/SPEC.md
│   ├── gather/SPEC.md
│   └── statemachine/SPEC.md
├── services/
│   ├── boardregistry/SPEC.md
│   └── mediatracker/SPEC.md
├── shared/
│   ├── markdown/SPEC.md
│   ├── parser/SPEC.md
│   └── types/SPEC.md
├── ux/
│   ├── dragdrop/SPEC.md
│   ├── export/SPEC.md
│   ├── menus/SPEC.md
│   └── search/SPEC.md
├── INDEX.md
├── PROGRESS.md
└── README.md
```
