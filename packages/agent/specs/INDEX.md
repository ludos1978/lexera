# V1 Implementation Specs - Master Index

**Version**: V1 (VS Code Extension)
**Last Updated**: 2026-03-01
**Total Specs**: 13 files, 5,212 lines
**Purpose**: Document V1 architecture for V2 implementation reference

---

## Quick Reference

| Category | Specs | Total Lines |
|----------|-------|-------------|
| Shared | Types, Parser, Markdown | 1,042 |
| Core | Board, Editor, Gather, StateMachine | 1,446 |
| UX | DragDrop, Search, Menus, Export | 1,622 |
| Services | BoardRegistry, MediaTracker | 602 |

---

## Application Overview

### What is V1?

V1 is a VS Code extension that provides Kanban board functionality for markdown files. It renders `.md` files with specific YAML frontmatter as interactive Kanban boards.

### Application Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        VS CODE EXTENSION HOST                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│  │ extension.ts│───►│ Commands    │───►│ Services     │                │
│  │ (entry)     │    │ (actions)   │    │ (state)     │                 │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
│         │                   │                   │                       │
│         ▼                   ▼                   ▼                       │  
│  ┌──────────────────────────────────────────────────────────────────┐        │
│  │                    BoardRegistryService                     │        │
│  │                    (Central State Manager)                  │        │
│  └──────────────────────────────────────────────────────────────────┘        │
│         │                                                               │
│         ├──────────────────────┬──────────────────────┐                    │
│         ▼                    ▼                    ▼                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │ Sidebar     │    │Dashboard    │    │Webview      │                   │
│  │ (Board Tree)│    │(Scanner)    │    │(Board View) │                   │
│  │             │    │             │    │             │                   │
│  │ kanbanBoards│    │kanbanDash   │    │kanbanWebview│                   │
│  │ Provider.ts │    │boardProvider│    │Panel.ts     │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│                                                 │                        │
│                                                 ▼                        │
│                                    ┌────────────────────────┐              │
│                                    │ HTML Webview         │              │
│                                    │ (src/html/*.js)      │              │
│                                    │                      │              │
│                                    │ - webview.js         │              │
│                                    │ - boardRenderer.js   │              │
│                                    │ - dragDrop.js        │              │
│                                    │ - cardEditor.js      │              │
│                                    │ - markdownRenderer.js│              │
│                                    └────────────────────────┘              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| **Entry Point** | `extension.ts` | Extension activation, command registration |
| **State Manager** | `BoardRegistryService.ts` | Central board state, workspace scanning |
| **Board View** | `kanbanWebviewPanel.ts` | Webview panel management, message passing |
| **HTML Frontend** | `src/html/webview.js` | Board rendering, user interactions |
| **Sidebar** | `kanbanBoardsProvider.ts` | Board tree in VS Code sidebar |
| **Dashboard** | `kanbanDashboardProvider.ts` | Upcoming items, tag search |
| **Parser** | `markdownParser.ts` | Markdown → Kanban board parsing |
| **Sync Server** | `packages/ludos-sync/` | CalDAV/WebDAV sync |

---

## Design Patterns Used

### 1. Singleton Pattern
Used for services that need global state:
- `BoardRegistryService.getInstance()`
- `PluginRegistry.getInstance()`
- `WorkspaceMediaIndex.getInstance()`

### 2. Provider Pattern
VS Code integration for UI components:
- `KanbanBoardsProvider` (TreeDataProvider)
- `KanbanDashboardProvider` (WebviewViewProvider)
- `KanbanWebviewPanel` (WebviewPanel)

### 3. Event-Driven Architecture
Communication between components via events:
- `vscode.EventEmitter` for VS Code events
- `postMessage()` for webview communication
- Custom `SaveEventDispatcher` for file watching

### 4. Plugin System
Extensible import/export/diagram handlers:
- `PluginRegistry` manages plugin lifecycle
- Interface-based plugins (`ImportPlugin`, `ExportPlugin`, `DiagramPlugin`)
- Built-in plugins loaded at startup

### 5. Command Pattern
All user actions are VS Code commands:
- `markdown-kanban.board.addCard`
- `markdown-kanban.card.toggleCheckbox`
- Commands registered in `extension.ts`

### 6. Message Handler Pattern
Webview ↔ Extension communication:
- Request/response pattern with message types
- `messageHandler.ts` routes messages to handlers
- Type-safe message definitions

### 7. Repository Pattern
Data access abstraction:
- `KanbanFileService` handles file I/O
- Storage adapters for different backends

### 8. Observer Pattern
File watching and change notification:
- `UnifiedChangeHandler` watches file changes
- Notifies all open panels of changes

---

## Feature Index

### Shared Components

| Feature | Spec File | Source | Lines |
|---------|-----------|--------|-------|
| [Types](shared/types/SPEC.md) | KanbanBoard, KanbanColumn, KanbanCard | `src/types.ts` | 313 |
| [Parser](shared/parser/SPEC.md) | State machine, parsing rules | `src/markdownParser.ts` | 477 |
| [Markdown](shared/markdown/SPEC.md) | Plugins, media, diagrams | `src/html/markdownRenderer.js` | 252 |

### Core Components

| Feature | Spec File | Source | Lines |
|---------|-----------|--------|-------|
| [Board](core/board/SPEC.md) | DOM structure, folding | `src/html/boardRenderer.js` | 449 |
| [Editor](core/editor/SPEC.md) | Inline editing, WYSIWYG | `src/html/cardEditor.js` | 517 |
| [Gather](core/gather/SPEC.md) | Automatic sorting | `src/board/GatherQueryEngine.ts` | 220 |
| [StateMachine](core/statemachine/SPEC.md) | Change handling | `src/core/ChangeStateMachine.ts` | 260 |

### UX Components

| Feature | Spec File | Source | Lines |
|---------|-----------|--------|-------|
| [DragDrop](ux/dragdrop/SPEC.md) | Drag state machine | `src/html/dragDrop.js` | 695 |
| [Search](ux/search/SPEC.md) | Dashboard scanner | `src/dashboard/DashboardScanner.ts` | 362 |
| [Menus](ux/menus/SPEC.md) | Context menus | `src/html/menuOperations.js` | 280 |
| [Export](ux/export/SPEC.md) | Dialog, Marp | `src/html/exportMarpUI.js` | 285 |

### Services

| Feature | Spec File | Source | Lines |
|---------|-----------|--------|-------|
| [BoardRegistry](services/boardregistry/SPEC.md) | Singleton manager | `src/services/BoardRegistryService.ts` | 280 |
| [MediaTracker](services/mediatracker/SPEC.md) | File change detection | `src/services/MediaTracker.ts` | 322 |

---

## Key Files to Understand V1

1. **`src/extension.ts`** - Entry point, command registration
2. **`src/services/BoardRegistryService.ts`** - Central state
3. **`src/kanbanWebviewPanel.ts`** - Webview management
4. **`src/html/webview.js`** - Frontend entry point
5. **`src/html/boardRenderer.js`** - Board rendering
6. **`src/html/dragDrop.js`** - Drag & drop
7. **`src/markdownParser.ts`** - Parsing logic
8. **`src/types.ts`** - Type definitions

---

## Documentation Progress

All 13 specs complete (5,212 lines):

| Category | Specs | Status |
|----------|-------|--------|
| Shared | Types, Parser, Markdown | ✅ |
| Core | Board, Editor, Gather, StateMachine | ✅ |
| UX | DragDrop, Search, Menus, Export | ✅ |
| Services | BoardRegistry, MediaTracker | ✅ |
