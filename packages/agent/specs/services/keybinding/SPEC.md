# Keybinding Service Specification

**File**: `src/services/KeybindingService.ts`
**Lines**: ~340
**Purpose**: VS Code keybinding discovery and management
**Dependencies**: VS Code extension API

---

## UX Requirements

### Shortcut Discovery
- Load user keybindings from VS Code
- Load extension shortcuts
- Merge with proper priority
- Cache for performance

### Snippet Support
- Resolve snippets by name
- Cache snippet definitions
- Support VS Code snippet syntax

### Webview Integration
- Send shortcuts to webview on focus
- Handle shortcut execution from webview
- Normalize key formats

---

## Data Structures

### VSCodeKeybinding

```typescript
interface VSCodeKeybinding {
  key: string;        // e.g., "ctrl+shift+a"
  command: string;    // e.g., "markdown-kanban.card.add"
  when?: string;      // Context condition
  args?: unknown;     // Optional command arguments
}
```

### ShortcutEntry

```typescript
interface ShortcutEntry {
  command: string;
  args?: unknown;
}
```

---

## Functions

### Singleton

```typescript
class KeybindingService {
  static getInstance(): KeybindingService
}
```

### Shortcut Loading

```typescript
// Get all shortcuts as map (shortcut -> command)
async getAllShortcuts(): Promise<Record<string, ShortcutEntry>>

// Load user keybindings from VS Code
async loadVSCodeKeybindings(): Promise<VSCodeKeybinding[]>

// Get extension-defined shortcuts
async getExtensionShortcuts(): Promise<Record<string, ShortcutEntry>>
```

### Snippet Handling

```typescript
// Resolve snippet by name
async resolveSnippetByName(name: string): Promise<string | null>

// Load VS Code snippets
private async _loadVSCodeSnippets(): Promise<Map<string, string>>
```

### Key Normalization

```typescript
// Normalize key format for consistent lookup
private _normalizeKeybinding(key: string): string
```

---

## Shortcut Priority

```
1. Extension shortcuts (highest)
   └── Defined in package.json contributes.keybindings

2. User keybindings (lowest)
   └── Defined in user's keybindings.json
```

---

## Cache Strategy

| Cache | TTL | Purpose |
|-------|-----|---------|
| Commands | 5 min | Available VS Code commands |
| Snippets | 5 min | Snippet definitions |

---

## Integration Points

### Called By
- `MessageHandler` → shortcut requests from webview
- `KanbanWebviewPanel` → on focus gain

### Calls
- VS Code API → `vscode.commands.getCommands()`
- File system → read keybindings.json

---

## Migration Notes for V2

### Keep Same
- Key normalization logic
- Priority system

### Port to Rust
- Not needed - Tauri has native keybinding support
- Use `tauri-plugin-global-shortcut`

### Replace
- Use Tauri's accelerator system
- Define shortcuts in `tauri.conf.json`
