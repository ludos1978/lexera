# Frontend Settings Architecture Spec

## Overview

Settings are organized into three tiers with clear ownership and override hierarchy:

```
Frontend Settings (global, localStorage)
    |
    v  overrides per-board
Board Settings (per-board, YAML header in .md file)
    |
    v  quick access subset
Board Header Menu (top-right burger, transient UI)
```

## Tier 1: Frontend Settings Panel

Global defaults that apply to all boards. Stored in `localStorage`. Shown in the dedicated Frontend Settings panel (workspace shell panel or standalone).

### Sections

#### Appearance
| Setting | Key | Default | Options |
|---------|-----|---------|---------|
| Visual Theme | `lexera-visual-theme` | `sleek-uniform` | classic, sleek, sleek-uniform, gap, lines |
| Color Theme | `lexera-theme` | `lexera` | lexera, mono, warm, nord (x light/dark) |
| UI Scale | `lexera-ui-scale` | `0.95` | 0.8 - 1.2 |

#### Interaction
| Setting | Key | Default | Options |
|---------|-----|---------|---------|
| Scroll Speed | `lexera-scroll-speed` | `1` | 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x |
| Zoom Speed | `lexera-zoom-speed` | `0.06` | fine, normal, fast |
| Arrow Key Focus Scroll | `lexera-arrow-focus-scroll` | `nearest` | disabled, nearest, center |

#### Editor Defaults
| Setting | Key | Default | Options |
|---------|-----|---------|---------|
| Column Width | `lexera-default-column-width` | `200px` | 140-260px |
| Card Height | `lexera-default-card-height` | `auto` | auto, 60-120px |
| Font Size | `lexera-default-font-size` | `13px` | 9.75-19.5px |
| Font Family | `lexera-default-font-family` | `monospace` | system, monospace, serif, sans |
| Whitespace | `lexera-default-whitespace` | `16px` | 8-32px |
| Tag Visibility | `lexera-default-tag-visibility` | `allexcludinglayout` | all, allexcludinglayout, customonly, mentionsonly, dim, none |
| HTML Comments | `lexera-default-html-comments` | `hidden` | hidden, text, dim |
| HTML Content | `lexera-default-html-content` | `html` | html, text |
| Show Special Characters | `lexera-show-special-chars` | `false` | true/false |
| Enable Overlay Editor | `lexera-overlay-editor` | `true` | true/false |
| Enable WYSIWYG Editor | `lexera-wysiwyg-editor` | `false` | true/false |

#### Tag Groups
Configuration for which tag categories appear in entity context menus.

| Setting | Key | Default |
|---------|-----|---------|
| Row menu tag groups | `lexera-tag-groups-row` | `['status', 'priority']` |
| Stack menu tag groups | `lexera-tag-groups-stack` | `['status', 'priority']` |
| Column menu tag groups | `lexera-tag-groups-column` | `['status', 'priority', 'type']` |
| Card menu tag groups | `lexera-tag-groups-card` | `['status', 'priority', 'type', 'scope', 'effort']` |

Tag groups are the categories defined in `tagColors.js` (status, priority, type, scope, effort, version, custom, etc.). Each entity type shows only the groups enabled for it in context menus.

#### Sidebar
| Setting | Key | Default |
|---------|-----|---------|
| Show Card Counts | `lexera-sidebar-counts` | `true` |
| Show Presence Badges | `lexera-sidebar-presence` | `true` |
| Show Drag Grips | `lexera-sidebar-grips` | `true` |
| Realtime Sync | `lexera-sidebar-sync` | `true` |

These must persist across page reloads (currently session-only).

---

## Tier 2: Board Settings (per-board YAML header)

Per-board overrides stored in `fullBoardData.boardSettings`. When a board has a value set, it overrides the frontend default. Shown in the board filename burger menu.

### Resolution logic
```
function getEffectiveSetting(key, fallback) {
  var boardValue = getBoardSettingValue(key);
  if (boardValue !== undefined && boardValue !== null) return boardValue;
  var frontendValue = localStorage.getItem('lexera-default-' + key);
  if (frontendValue !== null) return frontendValue;
  return fallback;
}
```

### Board filename burger menu items
These are settings that can be added to the board's YAML header and override frontend defaults:
- Column Width, Card Height, Font Size, Font Family, Whitespace
- Board Layout (kanban/canvas), Canvas Grid
- Layout Rows, Row Height, Layout Preset
- Tag Visibility, Tag Style Preset
- HTML Comments, HTML Content
- Pinned Header Mode
- Marp settings (theme, format, section class, handout direction)
- Pandoc settings (format, page breaks)

---

## Tier 3: Board Header Menu (top-right burger)

Quick-access menu for frequently used actions. Does NOT contain settings that belong in Frontend Settings. Items:

### Actions (always shown)
- Export
- Search & Replace
- Undo / Redo
- Reload Board

### Quick Settings (read/write, synced with Frontend Settings panel in realtime)
- Column Width (submenu, reads effective value)
- Zoom (canvas mode only)
- Tag Visibility (submenu)
- HTML Comment Rendering (submenu)
- HTML Content Rendering (submenu)
- Show Special Characters (toggle)
- Enable Overlay Editor (toggle)
- Enable WYSIWYG Editor (toggle)

### Removed from top-right burger (moved to Frontend Settings panel)
- Visual Theme
- Color Theme
- Scroll Speed
- Zoom Speed
- Sidebar Hierarchy display options
- UI Scale
- Arrow Key Focus Scroll

### Removed from top-right burger (moved to board filename burger)
- Board Layout (kanban/canvas)
- Canvas Grid
- Font Size, Font Family
- Card Height, Whitespace
- Layout Rows, Row Height, Layout Preset
- Pinned Header Mode
- Tag Style Preset

---

## Realtime Synchronization

When a setting is changed in ANY location (Frontend Settings panel, board header menu, board filename menu), all other UI reflecting that setting must update immediately:

1. **Frontend Settings panel <-> Board header menu**: Both read from the same source. When the board header menu changes tag visibility, the Frontend Settings panel updates instantly (and vice versa).

2. **Frontend Settings panel <-> Board filename menu**: Board-level overrides take precedence. The Frontend Settings panel shows the effective value with an indicator when a board override is active.

3. **Cross-tab sync**: `window.addEventListener('storage', ...)` already syncs localStorage changes across tabs. Board settings sync via the existing live-sync/SSE infrastructure.

### Implementation

Use `LexeraRuntime` for synchronization:

```js
// When any setting changes, emit an event
LexeraRuntime.emit('setting:changed', { key: 'tagVisibility', value: 'none', source: 'boardMenu' });

// All UI that displays settings subscribes
LexeraRuntime.on('setting:changed', function(e) {
  if (e.key === 'tagVisibility') updateTagVisibilityUI(e.value);
});
```

---

## Workspace Sidebar Menu

The workspace sidebar (hierarchy panel) has its own burger menu. This is the ONLY place where sidebar hierarchy settings appear:

- Toggle Card Counts
- Toggle Presence Badges
- Toggle Drag Grips
- Toggle Realtime Sync
- Tree expand/collapse all

These are NOT shown in the board header menu or the board filename menu.
