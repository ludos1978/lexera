# V2 Base Plan + V1 Reference

`packages/agent/specs` is the planning surface for Lexera v2 packages, with v1 specs kept as reference material.

## Quick Start

1. **New to the project?** Read `BASE_PLAN.md` for the v2 architecture overview
2. **Building something specific?** Use `INDEX.md` to find the relevant specs
3. **Tracking progress?** Check `PROGRESS.md` for implementation status and priorities

## Scope

- V2 targets: `packages/lexera-core`, `packages/lexera-backend`, `packages/lexera-kanban`, `packages/lexera-capture-ios`
- V1 source of truth for behavior: `src/` and `packages/ludos-sync/`
- Shared across v1 and v2: `packages/marp-engine/`

## Spec Categories

| Category | Purpose | Location |
|----------|---------|----------|
| **Core Data** | Board model, parser, markdown | `shared/` |
| **Core Logic** | Gather, state machine | `core/` |
| **Board UX** | Rendering, editing | `core/` |
| **Interaction** | Drag/drop, menus, search, export | `ux/` |
| **Services** | API, registry, keybinding, notification | `services/` |
| **Plugins** | Content system, registry | `plugins/` |
| **Sync** | Sync and collaboration | `sync/` |

## Spec Status

Each spec has a status indicator:

| Status | Meaning |
|--------|---------|
| ✅ Baseline | Spec complete, v1 reference available, ready for implementation |
| 📋 Spec'd | Spec complete, needs implementation |
| 🔜 Planned | Needs spec work before implementation |
| 🚧 In Progress | Currently being implemented |
| ⏸️ Deferred | Post-base-plan |

## Planning Rules

- Port behavior, not VS Code abstractions.
- Prefer `lexera-core` for shared board logic, parsing, storage, search, merge, and export transforms.
- Treat `lexera-backend` as the replacement for extension-side services and `packages/ludos-sync`.
- Treat `lexera-kanban` as the replacement for the v1 board webview UI.
- Treat keybinding and notification behavior as first-class v2 interaction systems.
- Keep `marp-engine` shared instead of duplicating export logic.
- Defer extension-only systems unless a v2 package clearly needs them.

## Directory Layout

```text
specs/
├── BASE_PLAN.md                 # Simplified v2 plan
├── INDEX.md                     # Navigation + package map
├── PROGRESS.md                  # Implementation status + priorities
├── README.md                    # This file
├── shared/                      # Data model + parsing
│   ├── types/SPEC.md
│   ├── parser/SPEC.md
│   └── markdown/SPEC.md
├── core/                        # Core logic
│   ├── gather/SPEC.md
│   ├── board/SPEC.md
│   ├── editor/SPEC.md
│   └── statemachine/SPEC.md
├── ux/                          # User interaction
│   ├── search/SPEC.md
│   ├── dragdrop/SPEC.md
│   ├── menus/SPEC.md
│   └── export/SPEC.md
├── services/                    # Backend services
│   ├── api/SPEC.md              # NEW: Complete API surface
│   ├── boardregistry/SPEC.md
│   ├── keybinding/SPEC.md
│   └── notification/SPEC.md
├── plugins/                     # Plugin architecture
│   ├── content/SPEC.md
│   └── registry/SPEC.md
└── sync/                        # Sync & collaboration
    └── SPEC.md                  # NEW: Sync architecture
```

## Contributing

When adding or updating specs:

1. Follow the existing SPEC.md template (UX Requirements, Architecture, Data Structures, Functions, Integration Points, Migration Notes)
2. Add a status header: `**Status**: Baseline | Spec'd | Planned | In Progress | Deferred`
3. Update `INDEX.md` if adding new specs
4. Update `PROGRESS.md` if changing implementation priorities
5. Cross-reference related specs where appropriate
