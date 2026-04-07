# Menu Contributor Registry Specification

**Status**: Planned
**V2 Target**: `lexera-kanban`
**V1 Reference**: `lexera-kanban/src/app.js` (lines 18517-18594, 18945-19038, 12726-12818)
**Dependencies**: [Action Registry](../actions/SPEC.md), [Menus](../menus/SPEC.md)

---

## Purpose

Replace the four independently-built context menu constructors (card, column, row, stack — each 25-40 inline menu items with deep nesting) with a contributor registry. Each menu section (edit, layout, visibility, tags, marp, sort, move, export) registers once and declares which scopes it contributes to. Menu assembly becomes a loop over contributors.

---

## UX Requirements

### Context Menu Display
- User right-clicks or clicks burger menu on any element
- Registry assembles menu items from all contributors for that scope
- Contributors are ordered by priority with separator insertion between sections
- Menu displayed via `showNativeMenu()`

### Shared Sections
- Visibility (park, archive, delete) appears in all four element menus — defined once
- Tag operations appear in all four — defined once
- Marp directives appear in all four — defined once
- Sort options appear in column, row, stack — defined once

### Extensibility
- Adding a new menu section = one `MenuContributorRegistry.register()` call
- New section appears in all declared scopes automatically

---

## Architecture

### Menu Assembly Flow

```
User triggers context menu for element
    |
    v
showElementContextMenu(scope, x, y, context)
    |
    v
MenuContributorRegistry.getForScope(scope)
    |
    v
For each contributor (sorted by priority):
    contributor.build(scope, context)
        |
        +-- returns items --> append to menu (with separator between sections)
        +-- returns null --> skip
    |
    v
showNativeMenu(assembled items, x, y)
    |
    v
ActionRegistry.dispatch(scope, selectedAction, context)
```

---

## Data Model

### MenuContributor

```typescript
interface MenuContributor {
  id: string;                                    // unique identifier
  scopes: ('card' | 'column' | 'row' | 'stack')[];  // which menus to contribute to
  priority: number;                              // ordering within menu (lower = higher)
  section: string;                               // logical group for separator insertion

  build(scope: string, context: MenuContext): NativeMenuItem[] | null;
                                                 // return menu items or null to skip
}

interface MenuContext {
  colIndex?: number;
  cardIndex?: number;
  rowIdx?: number;
  stackIdx?: number;
  elementText: string;                           // header text of the element
  boardData: object;                             // current board data
  columns: object[];                             // all columns (for move-to submenus)
}
```

---

## Public API

```javascript
var MenuContributorRegistry = {
  register: function(contributor)                // register a contributor
  getForScope: function(scope)                   // all contributors for a scope, sorted by priority
  remove: function(id)                           // unregister by ID
};

function showElementContextMenu(scope, x, y, context)
                                                 // assemble and show menu for scope
```

---

## Built-in Contributors

| ID | Scopes | Section | Priority | Current Source |
|----|--------|---------|----------|---------------|
| `core-edit` | card | edit | 10 | inline in `showCardContextMenu` |
| `core-rename` | column, row, stack | edit | 10 | inline in each `show*ContextMenu` |
| `core-add` | card, column, row, stack | add | 20 | inline, 4x duplicated |
| `core-layout` | column | layout | 30 | inline in `showColumnContextMenu` |
| `core-sort` | column, row, stack | sort | 40 | inline, 3x duplicated |
| `core-move-to` | card, column | move | 50 | inline, 2x duplicated |
| `core-visibility` | card, column, row, stack | visibility | 60 | inline, 4x duplicated |
| `marp-directives` | card, column, row, stack | format | 70 | `buildMarpMenuItems()`, 4x duplicated |
| `tag-operations` | card, column, row, stack | tags | 80 | inline, 4x duplicated |
| `copy-export` | card, column, row, stack | export | 90 | inline, 4x duplicated |

---

## Key Behaviors

### Section Separators
- Separators inserted between groups with different `section` values
- No separator before first group or after last group
- Groups returning `null` or empty arrays don't produce separators

### Scope-Aware Building
- Contributors can adapt their output based on scope
- Example: `core-add` produces "Add Card" for card scope, "Add Column" for row scope
- Contributors can return `null` to skip a scope (e.g. `core-sort` skips card scope)

### Connection to ActionRegistry
- Menu items use action IDs as their `id` field
- After `showNativeMenu()` resolves, the selected ID is dispatched through `ActionRegistry`
- This separates menu construction from action handling

---

## Integration Points

### Called By
- Card burger menu button click
- Column burger menu button click
- Row burger menu button click
- Stack burger menu button click
- Right-click context menu on any element

### Calls
- `showNativeMenu()` → native context menu display
- `ActionRegistry.dispatch()` → action handling
- Board state → for building dynamic submenus (columns list, tag list, etc.)

---

## Migration Notes

### Keep Same
- Native menu item format (`{ id, label, separator, disabled, items }`)
- `showNativeMenu()` as the display mechanism
- Dynamic submenu building for move-to, tag categories, marp classes

### Change
- Replace four `show*ContextMenu()` functions with one `showElementContextMenu(scope, ...)`
- Each shared menu section (visibility, tags, marp, sort, export) defined once as a contributor
- Scope-specific sections (edit, layout, add) also contributors but scoped narrowly

### Remove
- `showCardContextMenu()` → `showElementContextMenu('card', ...)`
- `showColumnContextMenu()` → `showElementContextMenu('column', ...)`
- `showRowContextMenu()` → `showElementContextMenu('row', ...)`
- `showStackContextMenu()` → `showElementContextMenu('stack', ...)`

### Estimated Change
- Remove ~800 lines of duplicated menu construction from app.js
- Add ~360 lines (60 registry + 300 contributor registrations)
