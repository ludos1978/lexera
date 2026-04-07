# Workspace Shell Panels Specification

**Status**: In Progress
**V2 Target**: `lexera-kanban`
**Dependencies**: [Board Settings](../board-settings/SPEC.md), [Actions](../actions/SPEC.md), [Menus](../menus/SPEC.md)

---

## Purpose

The workspace shell organizes all non-board content into **panel views** — modular, dockable containers that can be placed in left, right, or bottom docks. Each panel kind has a dedicated factory, can be duplicated across docks, and is toggled via the View menu or keyboard shortcuts.

---

## Panel Kinds

| Kind | Title | Default Dock | Tabs | Description |
|------|-------|-------------|------|-------------|
| `hierarchy` | Workspaces | left | — | Workspace selector + board tree |
| `dashboard` | Dashboard | left | — | Search, pinned queries, deadlines |
| `logs` | Logs | bottom | Backend / Frontend / Stats | Log viewer with tabs |
| `backendSettings` | Backend Settings | right | Network, Configuration, Logs | Server config, connections, peers |
| `frontendSettings` | Frontend Settings | right | — | Theme, editor toggles, diagnostics |
| `files` | Files | right | **Workspaces, Boards** | Workspace and board management |

All panel kinds are duplicable and support the integrated header style.

---

## Files Panel

The Files panel provides workspace and board management, extracted from the former Backend Settings "Sharing" tab.

### Tabs

The Files panel has exactly **2 tabs**:

1. **Workspaces** — Workspace CRUD, sync defaults, appearance settings
   - Create / rename / delete workspaces
   - Set default workspace
   - Configure per-workspace sync defaults (remote URL, token, calendar name)
   - Configure per-workspace appearance (layout preset)

2. **Boards** — Board listing and per-board settings
   - "My Boards" list showing all boards grouped by workspace
   - Per-board settings (sync enabled, remote URL, token, calendar, layout)
   - Board CRUD operations (add, remove)

### Architecture

The Files panel reuses the shared `ManagementUI` module (`lexera-shared/management.js`) via its multi-mount architecture:

```
┌──────────────────────────────────────────────┐
│                ManagementUI                   │
│  (shared module, multi-mount capable)         │
├──────────────────────────────────────────────┤
│                                               │
│   Mount: 'default'          Mount: 'files'    │
│   ┌─────────────────┐     ┌──────────────┐   │
│   │ Backend Settings │     │ Files Panel  │   │
│   │ tabs: [network]  │     │ tabs:        │   │
│   │                  │     │  workspaces  │   │
│   │                  │     │  boards      │   │
│   └─────────────────┘     └──────────────┘   │
│                                               │
│   Shared state: api, cachedWorkspaces,        │
│   cachedBoards, me, currentConfig             │
└──────────────────────────────────────────────┘
```

Each mount has its own container, UI options (which tabs to show), and event delegation. Data (workspaces, boards, config) is shared at the module level and loaded on demand based on which tabs are active across all mounts.

### Initialization

The Files panel element is created by `LexeraSharedPanels.createPanelElement('files', instanceId)`, which fires a `lexera-shared-panel-created` CustomEvent. The app.js handler mounts ManagementUI into the panel's container with `topTabs: ['workspaces', 'boards']`.

### Menu Integration

- **View > Panels > Files** menu item reveals the Files panel
- Action: `reveal-panel:files`
- `openManagementPanel({ section: 'workspaces' })` and `openManagementPanel({ section: 'boards' })` route to the Files panel

---

## Panel Lifecycle

### Creation

Panels are created lazily via `LexeraSharedPanels.createPanelElement(kind, instanceId)`:

1. Factory function builds the DOM element
2. Instance is registered in the shared panel registry
3. `lexera-shared-panel-created` CustomEvent fires synchronously
4. App.js event handler initializes panel-specific content

### Visibility

- `revealPanel(panelId)` — shows and activates the panel in its dock
- `collapsePanel(panelId)` — hides the panel
- Panels remember visibility state across sessions via `localStorage`

### Duplication

Any panel kind can be duplicated into a different dock. Duplicate instances get unique IDs (e.g., `files_2`) and their own factory-created DOM element.

---

## Integration Points

### Called By
- `WorkspaceShell.handleBoardAction()` — routes `reveal-panel:*` actions
- `openManagementPanel()` — routes workspace/board sections to Files panel
- View menu items — via Tauri `app_menu.rs` action mapping

### Calls
- `ManagementUI.mount()` / `ManagementUI.unmount()` — for Files panel content
- `LexeraSharedPanels` — panel element factory and registry
- Backend API — workspace and board CRUD via shared `mgmtApiAdapter`
