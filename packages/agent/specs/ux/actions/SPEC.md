# Action Dispatch Registry Specification

**Status**: Planned
**V2 Target**: `packages/lexera-kanban`
**V1 Reference**: `packages/lexera-kanban/src/app.js` (lines 9187-9596, 18596-18650, 19171-19250, 12820-12860, 12861-12900)
**Dependencies**: [Menus](../menus/SPEC.md)

---

## Purpose

Replace the five 20-60 branch if/else action dispatch chains (`handleBoardAction`, `handleCardMenuAction`, `handleColumnAction`, `handleRowAction`, `handleStackAction`) with a single action registry. Actions are registered with a scope and pattern; dispatch becomes a registry lookup.

---

## UX Requirements

### Action Dispatch
- Menu selections, keyboard shortcuts, and native menu events all produce action strings
- The registry routes each action string to the correct handler
- Scoped actions (card, column, row, stack, board) are dispatched with context

### Extensibility
- Adding a new action = one `ActionRegistry.register()` call
- No changes needed in dispatch functions
- Action families (format settings, marp directives, tag operations) can be registered as groups

---

## Architecture

### Dispatch Flow

```
Menu selection / keyboard shortcut / native menu event
    |
    v
action string (e.g. "set-font-size:1.25" or "park")
    |
    v
ActionRegistry.dispatch(scope, action, context)
    |
    v
Find matching handler by scope + pattern
    |
    +-- found --> handler(action, context)
    +-- not found --> warn unhandled action
```

---

## Data Model

### ActionHandler

```typescript
interface ActionHandler {
  scope: 'board' | 'card' | 'column' | 'row' | 'stack';
  pattern: string;           // exact match or 'prefix:*' wildcard
  handler(action: string, context: ActionContext): void | Promise<void>;
}

interface ActionContext {
  colIndex?: number;
  cardIndex?: number;
  rowIdx?: number;
  stackIdx?: number;
  element?: HTMLElement;
}
```

---

## Public API

```javascript
var ActionRegistry = {
  register: function(handler)                               // register a single handler
  registerGroup: function(scope, handlers)                  // register multiple handlers for a scope
  dispatch: function(scope, action, context)                // find and execute handler
  find: function(scope, action)                             // find handler without executing
};
```

---

## Action Families

### Board-Scope Families

| Family | Pattern | Count | Example Actions |
|--------|---------|------:|-----------------|
| Format settings | `set-column-width:*`, `set-card-height:*`, `set-font-size:*`, ... | 18 | `set-font-size:1.25` |
| Feature toggles | `toggle-*` | 10 | `toggle-overlay-editor` |
| Marp directives | `file-marp-*` | 12 | `file-marp-toggle-enabled` |
| Pandoc actions | `file-pandoc-*` | 4 | `file-pandoc-set-format:docx` |
| Navigation | `recent:*`, `next-*`, `prev-*` | 5 | `recent:board-123` |
| View management | `split-*`, `pin-*`, `unpin-*` | 6 | `split-enable` |
| Save/export | `save-*`, `export-*` | 4 | `save-now` |

### Element-Scope Families (card, column, row, stack)

| Family | Pattern | Scopes | Example |
|--------|---------|--------|---------|
| Visibility | `park`, `archive`, `delete` | all 4 | `park` |
| Tag operations | `tag-*` | all 4 | `tag-add:priority` |
| Marp directives | `marp-*` | all 4 | `marp-set-class:invert` |
| Sorting | `sort-*` | column, row, stack | `sort-title` |
| Copy/export | `copy-markdown`, `export-*` | all 4 | `copy-markdown` |

---

## Key Behaviors

### Pattern Matching
- Exact match: `"save-now"` matches only `"save-now"`
- Wildcard suffix: `"set-font-size:*"` matches `"set-font-size:1.25"`, `"set-font-size:2"`
- First registered match wins (no priority needed — patterns should be non-overlapping)

### Delegation
- Current code delegates marp/pandoc/tag actions to sub-handlers; these become registrations in their own action family
- Each family registers its own handlers, eliminating the delegation chain

### Context Passing
- Board actions receive empty context `{}`
- Card actions receive `{ colIndex, cardIndex }`
- Column actions receive `{ colIndex }`
- Row actions receive `{ rowIdx }`
- Stack actions receive `{ rowIdx, stackIdx }`

---

## Integration Points

### Called By
- `handleBoardAction()` → becomes `ActionRegistry.dispatch('board', action, {})`
- `handleCardMenuAction()` → becomes `ActionRegistry.dispatch('card', action, ctx)`
- `handleColumnAction()` → becomes `ActionRegistry.dispatch('column', action, ctx)`
- `handleRowAction()` → becomes `ActionRegistry.dispatch('row', action, ctx)`
- `handleStackAction()` → becomes `ActionRegistry.dispatch('stack', action, ctx)`
- Native menu events → via `menu-action` Tauri event
- Keyboard shortcuts → via keybinding system

### Calls
- Board mutation functions (addRow, deleteColumn, moveCard, etc.)
- Board settings functions (setBoardSettingValue, etc.)
- UI toggle functions (toggle overlay editor, etc.)

---

## Migration Notes

### Keep Same
- Action string format (`"verb-noun:parameter"`)
- Context values passed to handlers
- Individual handler function bodies

### Change
- Replace five if/else dispatch functions with `ActionRegistry.dispatch()` calls
- Register each action family as a group
- Marp/pandoc/tag sub-dispatchers become direct registrations

### Remove
- `handleBoardAction()` body (~400 lines of if/else) → 1-line dispatch call + ~200 lines of registrations
- `handleCardMenuAction()` body → dispatch call + registrations
- `handleColumnAction()` body → dispatch call + registrations
- `handleRowAction()` body → dispatch call + registrations
- `handleStackAction()` body → dispatch call + registrations

### Estimated Change
- Remove ~600 lines of if/else chains from app.js
- Add ~250 lines (50 registry + 200 registration calls)
