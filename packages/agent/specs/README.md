# V2 Base Plan + V1 Reference

`packages/agent/specs` is now a planning surface for the Lexera v2 packages, with the old v1 specs kept as reference material.

## Scope

- V2 targets: `packages/lexera-core`, `packages/lexera-backend`, `packages/lexera-kanban`, `packages/lexera-capture-ios`
- V1 source of truth for behavior: `src/` and `packages/ludos-sync/`
- Shared across v1 and v2: `packages/marp-engine/`

## How To Use This Folder

1. Start with `BASE_PLAN.md` for the simplified v2 plan.
2. Use `INDEX.md` to map a v2 workstream back to the relevant v1 reference specs.
3. Use `PROGRESS.md` to see what is baseline, adapted, deferred, or v1-only.

## Planning Rules

- Port behavior, not VS Code abstractions.
- Prefer `lexera-core` for shared board logic, parsing, storage, search, merge, and export transforms.
- Treat `lexera-backend` as the replacement for extension-side services and `packages/ludos-sync`.
- Treat `lexera-kanban` as the replacement for the v1 board webview UI.
- Keep `marp-engine` shared instead of duplicating export logic.
- Defer extension-only systems unless a v2 package clearly needs them.

## Directory Layout

```text
specs/
├── BASE_PLAN.md                 # Simplified v2 plan
├── INDEX.md                     # V2 package map + v1 reference map
├── PROGRESS.md                  # Current planning status
├── shared/                      # V1 reference specs
├── core/                        # V1 reference specs
├── ux/                          # V1 reference specs
├── services/                    # V1 reference specs
└── plugins/                     # V1 reference specs
```

The `SPEC.md` files are still mostly v1-oriented snapshots. They are inputs for v2 planning, not a one-to-one definition of the v2 package structure.
