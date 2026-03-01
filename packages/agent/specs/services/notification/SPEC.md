# Notification Service Specification

**File**: `src/services/NotificationService.ts`
**Lines**: ~220
**Purpose**: Centralized VS Code notifications
**Dependencies**: VS Code window API

---

## UX Requirements

### Notification Types
- Error messages (red)
- Warning messages (yellow)
- Info messages (blue)
- Modal dialogs

### Common Patterns
- Confirmation dialogs (OK/Cancel)
- Save/Discard/Cancel dialogs
- Custom action buttons

---

## Data Structures

### Result Types

```typescript
type ConfirmResult = 'confirm' | 'cancel';
type SaveDiscardResult = 'save' | 'discard' | 'cancel';
```

---

## Functions

### Singleton

```typescript
class NotificationService {
  static getInstance(): NotificationService
}
```

### Basic Notifications

```typescript
// Show error message
showError(message: string, ...items: string[]): Thenable<string | undefined>

// Show warning message
showWarning(message: string, ...items: string[]): Thenable<string | undefined>

// Show info message
showInfo(message: string, ...items: string[]): Thenable<string | undefined>
```

### Confirmation Dialogs

```typescript
// Simple confirm
async confirm(message: string, confirmLabel?: string): Promise<ConfirmResult>

// Confirm with custom options
async confirmWithOptions(message: string, ...options: string[]): Promise<string | undefined>

// Unsaved changes dialog
async confirmSaveDiscard(fileName: string): Promise<SaveDiscardResult>
```

### Convenience Exports

```typescript
// Module-level functions for easy import
export function showError(message: string, ...items: string[]): Thenable<string | undefined>
export function showWarning(message: string, ...items: string[]): Thenable<string | undefined>
export function showInfo(message: string, ...items: string[]): Thenable<string | undefined>
```

---

## Usage Examples

```typescript
// Simple notification
showInfo('Board saved successfully');

// Error with action
const action = await showError('File not found', 'Open Folder');
if (action === 'Open Folder') {
  // Handle action
}

// Confirmation
const result = await notificationService.confirm('Delete this card?');
if (result === 'confirm') {
  // Delete card
}

// Save/Discard dialog
const result = await notificationService.confirmSaveDiscard('board.md');
switch (result) {
  case 'save': await saveFile(); break;
  case 'discard': discardChanges(); break;
  case 'cancel': return;
}
```

---

## Integration Points

### Called By
- All services and commands that need notifications
- Error handlers throughout the extension

### Calls
- VS Code API → `vscode.window.showErrorMessage()`
- VS Code API → `vscode.window.showWarningMessage()`
- VS Code API → `vscode.window.showInformationMessage()`

---

## Migration Notes for V2

### Replace with Tauri
```rust
// Use tauri-plugin-dialog
use tauri_plugin_dialog::DialogExt;

// Info dialog
app.dialog()
    .message("Board saved successfully")
    .kind(MessageDialogKind::Info)
    .show();

// Confirm dialog
let confirmed = app.dialog()
    .message("Delete this card?")
    .confirm()
    .show()
    .await;
```

### Keep Same
- Result types
- Function signatures (adapted to Rust)
