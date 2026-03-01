# V2 Planning Status

This file now tracks the simplified v2 planning view instead of line counts for v1 analysis.

## Current Status

| Track | Status | Source of truth | Notes |
|-------|--------|-----------------|-------|
| Board model and markdown I/O | Baseline | `packages/lexera-core` | Built from v1 parser/types behavior, but owned by Rust in v2 |
| Storage, watcher, merge, and search | Baseline | `packages/lexera-core` | Replaces extension-side file/state handling with atomic, core-owned logic |
| Backend runtime and API | Baseline | `packages/lexera-backend` | Replaces extension host responsibilities and most of `packages/ludos-sync` |
| Live sync and collaboration | Active v2 workstream | `packages/lexera-backend` + `packages/lexera-core` | Newer than v1 and not limited by old extension structure |
| Kanban UI | Baseline | `packages/lexera-kanban` | Port v1 board/editor UX selectively, but keep the client thinner |
| Capture flows | Baseline | `packages/lexera-backend` + `packages/lexera-capture-ios` | New v2 capability |
| Presentation/export | Shared baseline | `packages/lexera-core` + `packages/marp-engine` | Shared engine remains part of the plan |
| Plugin registry parity | Deferred | none | Reference only, not required for the base plan |
| Shared keybinding service | Deferred | host-native APIs | V1 service is reference-only |
| Shared notification service | Deferred | host-native APIs | V1 service is reference-only |

## Current Planning Decisions

- `lexera-core` owns board data, markdown parsing, write safety, merge, search, and export transforms.
- `lexera-backend` owns registry, file watching, HTTP/SSE/WS surfaces, discovery, collaboration, and desktop capture.
- `lexera-kanban` owns board UX, editing, drag/drop, menus, dashboard, and connection-state presentation.
- `packages/ludos-sync` is a v1 reference, not the v2 runtime boundary.
- `packages/marp-engine` stays shared.

## Cleanup Result

- Top-level docs are now organized around the real v2 package split.
- Detailed `SPEC.md` files remain available as v1 behavior references.
- Old bookkeeping such as line counts and faux completeness metrics has been removed from the top-level view.
