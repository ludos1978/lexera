# Event Listener Lifecycle Audit — Board-Switch Leak Analysis

Audited: all `addEventListener` calls in `lexera-kanban/src/` (excluding `vendor/`).
Focus: listeners that may leak or reference stale state across board switches.

## Active Leaks Found: 0

The current codebase does NOT have active event listener leaks on board switch. The `innerHTML = ''` pattern in `renderColumns()` effectively garbage-collects all board-content listeners. Document/window-level listeners either have proper guards or are intentionally permanent.

## How Board Switches Work

1. `loadBoard(boardId)` fetches new board data, calls `renderColumns()`.
2. `renderColumns()` calls `getElColumnsContainer().innerHTML = ''`, which destroys the entire board DOM subtree.
3. `renderBoardHeader()` calls `boardHeaderEl.innerHTML = html`, replacing the header DOM.
4. Sidebar board list uses fingerprint diffing and rebuilds via innerHTML when changed.

**Key principle:** innerHTML replacement automatically garbage-collects listeners on the replaced elements.

## Medium Risk (code smell, not active bugs)

- `orderHelpers.js:1059` — document keydown for Ctrl+F (no double-call guard)
- `orderHelpers.js:2861-2918` — dashboard controls listeners (no double-call guard)
- `orderHelpers.js:765-768` — embedded pane activation listeners (never removed)
- `exportUI.js:803` — document keydown for Escape (protected by `eventsBound` + singleton)

## Design Debt

- **16 anonymous document/window listeners** prevent future cleanup via `removeEventListener`. Not a problem today (all called once). Would matter if pane-level teardown is added.
- **No centralized listener registry** — relies on innerHTML-based DOM destruction, singleton guards, single init() invocation.

## Summary

| Category | Count | Risk |
|----------|-------|------|
| Safe: long-lived global listeners | ~30 | None |
| Safe: ephemeral dialog listeners | ~60 | None |
| Safe: board-content DOM (die with innerHTML) | ~40 | None |
| Safe: properly guarded re-bindable | ~8 | None |
| Medium risk: no double-call guard but called once | ~4 | Low |
| Design debt: anonymous document/window listeners | ~16 | Future maintenance |
