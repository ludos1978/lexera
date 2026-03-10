# Board Settings Descriptor Registry Specification

**Status**: Planned
**V2 Target**: `packages/lexera-kanban`, `packages/lexera-kanban/src-tauri`
**V1 Reference**: `packages/lexera-kanban/src/app.js` (lines 8937-9076, 9187-9596), `packages/lexera-kanban/src-tauri/src/app_menu.rs` (lines 4-275, 289-435)
**Dependencies**: [Action Registry](../actions/SPEC.md)

---

## Purpose

Replace the scattered board format/display settings (defined independently in Rust menu builder, Rust action mapper, JS action dispatcher, JS setter function, and CSS variable application) with a single settings descriptor registry. Each setting is defined once with its options, default, persistence, and CSS application — eliminating five-way duplication when adding a new setting.

---

## UX Requirements

### Settings Application
- User selects a format setting from the native menu or burger menu
- Setting applied immediately to the board (CSS variable update)
- Setting persisted to localStorage
- Native menu checkmark updated for the active value

### Single Source of Truth
- Adding a new setting (e.g. "card gap") requires one `BoardSettingRegistry.register()` call
- The native Format menu, action dispatcher, and burger menu all read from the registry
- No manual synchronization between Rust menu definitions and JS handlers

---

## Architecture

### Settings Flow

```
BoardSettingRegistry.register({ id, label, type, options, apply, persist, load })
    |
    v
On app init:
    registry.loadAll()  -->  each setting.load() --> setting.apply(value)
    |
    v
On menu selection:
    ActionRegistry handler calls registry.set(id, value)
        |
        +-- setting.apply(value)    --> CSS variable update
        +-- setting.persist(value)  --> localStorage write
        +-- syncMenuCheckState()    --> native menu checkmark update
```

---

## Data Model

### BoardSettingDescriptor

```typescript
interface BoardSettingDescriptor {
  id: string;                              // unique key (e.g. 'fontSizeScale')
  label: string;                           // display name (e.g. 'Font Size')
  category: string;                        // grouping (e.g. 'format', 'layout', 'display')
  type: 'enum' | 'toggle' | 'range';      // setting type

  // For enum type
  options?: Array<{
    value: string;
    label: string;
  }>;

  // For toggle type (no options needed)

  // For range type
  min?: number;
  max?: number;
  step?: number;

  defaultValue: string;

  apply(value: string): void;              // apply to DOM (CSS variable, class, etc.)
  persist(value: string): void;            // save to localStorage
  load(): string;                          // read from localStorage or return default
}
```

---

## Public API

```javascript
var BoardSettingRegistry = {
  register: function(descriptor)           // register a setting
  get: function(id)                        // retrieve descriptor by ID
  getAll: function()                       // all settings
  getByCategory: function(category)        // settings in a category
  set: function(id, value)                 // apply + persist a value
  loadAll: function()                      // load and apply all settings on init
  getCurrentValue: function(id)            // get current persisted value
};
```

---

## Built-in Settings

### Format Category

| ID | Label | Type | Options (abbreviated) |
|----|-------|------|-----------------------|
| `columnWidth` | Column Width | enum | 250px, 300px, 350px, 400px, 450px, 500px, 550px, 600px, 650px |
| `cardHeight` | Card Height | enum | auto, 80px, 120px, 160px, 200px, 250px, 300px, 400px |
| `whitespace` | Whitespace | enum | normal, spacious, compact |
| `fontSizeScale` | Font Size | enum | 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x |
| `fontFamily` | Font Family | enum | 14 font options |
| `layoutRows` | Layout Rows | enum | 1, 2, 3, 4, 5, 6 |
| `rowHeight` | Row Height | enum | auto, 200px, 300px, 400px, 500px, 600px, 800px, 1000px |

### Display Category

| ID | Label | Type |
|----|-------|------|
| `boardTheme` | Visual Style | enum (bordered, gap-highlight) |
| `tagStylePreset` | Tag Style | enum (default, minimal, full, badges) |
| `layoutPreset` | Layout Preset | enum (normal, spacious) |

---

## Key Behaviors

### Native Menu Generation
- The registry can export its descriptors as a data structure
- The Rust menu builder can consume this (passed from frontend on init) or use a shared JSON manifest
- For the initial migration: the Rust side continues to build the menu manually, but the JS action handler uses the registry — eliminating half the duplication

### Checkmark Sync
- For `enum` settings: the native menu shows a checkmark on the active option
- After `set()`, call `tauriInvoke('set_menu_check_state', { id: menuItemId, checked: true })` for the selected option and `checked: false` for others in the same group

### Burger Menu
- Burger menu display settings also read from the registry
- Rendered as radio groups or toggles matching the setting type

---

## Integration Points

### Called By
- `ActionRegistry` → format action handlers call `BoardSettingRegistry.set()`
- App init → `BoardSettingRegistry.loadAll()`
- Burger menu → reads `BoardSettingRegistry.getByCategory('format')`

### Calls
- `document.documentElement.style.setProperty()` → CSS variable updates
- `localStorage` → persistence
- `tauriInvoke('set_menu_check_state')` → native menu sync

---

## Migration Notes

### Keep Same
- CSS variable names and values
- localStorage keys
- Visual effect of each setting

### Change
- `setBoardSettingValue()` multi-branch function → `BoardSettingRegistry.set(id, value)`
- `handleBoardAction()` format branches → action registrations that call `BoardSettingRegistry.set()`
- Burger menu settings rendering → reads from registry

### Future Change (Phase 2)
- Rust `app_menu.rs` Format menu → generated from a shared manifest or passed from frontend
- `menu_id_to_action()` format entries → eliminated (menu ID = action string directly)

### Estimated Change
- Remove ~200 lines of setBoardSettingValue + format branches from app.js
- Remove ~200 lines of manual menu building + match arms from app_menu.rs (phase 2)
- Add ~260 lines (60 registry + 200 setting registrations)
