# Duplicate Code Consolidation Opportunities

## Overview
Analysis of the `src` directory identified several patterns of code duplication that could be consolidated for better maintainability.

## 1. Command Handler Message Type Pattern

### Current Pattern (Repeated in Multiple Files)
```typescript
protected handlers: Record<string, MessageHandler> = {
    'messageType': (msg, ctx) => {
        const m = msg as any;  // Type unsafe
        await this.handleSomeOperation(m.property1, m.property2, ctx);
        return this.success();
    },
    // ... more handlers
};
```

### Files Using This Pattern
- `src/commands/EditModeCommands.ts` - ✅ Fixed
- `src/commands/DebugCommands.ts` - ✅ Fixed
- `src/commands/ExportCommands.ts` - ✅ Fixed
- `src/commands/ClipboardCommands.ts` - 10 instances to fix
- `src/commands/FileCommands.ts` - May have similar patterns
- `src/commands/IncludeCommands.ts` - May have similar patterns

### Suggested Refactor
Create a generic handler wrapper that automatically type-checks:

```typescript
// src/commands/handlerUtils.ts
export type TypedHandler<TMessage, TResult = void> = (
    message: TMessage,
    context: CommandContext
) => Promise<CommandResult | TResult>;

export function createTypedHandler<TMessage extends BaseMessage>(
    messageType: string,
    handler: TypedHandler<TMessage>
): MessageHandler {
    return async (msg: IncomingMessage, ctx: CommandContext) => {
        try {
            const result = await handler(msg as TMessage, ctx);
            if (typeof result === 'object' && 'success' in result) {
                return result as CommandResult;
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: getErrorMessage(error) };
        }
    };
}
```

### Usage
```typescript
protected handlers: Record<string, MessageHandler> = {
    'saveClipboardImage': createTypedHandler<SaveClipboardImageMessage>(
        'saveClipboardImage',
        async (msg, ctx) => {
            await this.handleSaveClipboardImage(
                msg.imageData,
                msg.imagePath,
                msg.mediaFolderPath,
                msg.dropPosition,
                ctx
            );
            return { success: true };
        }
    )
};
```

## 2. File Registry Pattern

### Current Pattern (Duplicated in Multiple Services)
```typescript
const fileRegistry = context.getFileRegistry();
if (!fileRegistry) {
    return this.failure('File registry not available');
}
const mainFile = fileRegistry.getMainFile();
if (!mainFile) {
    return this.failure('Main file not found');
}
```

### Files Using This Pattern
- `src/commands/CardCommands.ts` (multiple times)
- `src/commands/ColumnCommands.ts` (multiple times)
- `src/commands/FileCommands.ts` (multiple times)
- `src/commands/ClipboardCommands.ts`
- `src/services/*` (various services)

### Suggested Refactor
Extract to a helper in BaseMessageCommand:

```typescript
// Already exists in src/commands/interfaces/MessageCommand.ts
protected getMainFileOrFail(): { fileRegistry: MarkdownFileRegistry; mainFile: ReturnType<MarkdownFileRegistry['getMainFile']> } | CommandResult {
    const fileRegistry = this.getFileRegistry();
    if (!fileRegistry) {
        return this.failure('File registry not available');
    }
    const mainFile = fileRegistry.getMainFile();
    if (!mainFile) {
        return this.failure('Main file not found');
    }
    return { fileRegistry, mainFile };
}
```

### Usage
```typescript
private async handleSomeOperation(_msg: IncomingMessage, context: CommandContext): Promise<CommandResult> {
    const fileResult = this.getMainFileOrFail();
    if ('success' in fileResult) {
        return fileResult;  // Early return on failure
    }
    const { fileRegistry, mainFile } = fileResult;
    // Use fileRegistry and mainFile
}
```

## 3. Board State Management Pattern

### Current Pattern (Undo/Redo)
```typescript
// Save undo state before operation
const undoEntry = UndoCapture.inferred(board, 'operation');
// Perform operation
action(board);
// Save to stack
context.boardStore.saveUndoEntry(undoEntry);
context.emitBoardChanged(board, 'edit');
await context.onBoardUpdate();
```

### Files Using This Pattern
- `src/actions/executor.ts` - Centralized ✅
- `src/commands/CardCommands.ts`
- `src/commands/ColumnCommands.ts`
- `src/commands/BoardCommands.ts`

### Suggested Refactor
Use ActionExecutor for all board mutations:

```typescript
// Already exists in src/actions/executor.ts
protected async executeAction<T>(
    context: CommandContext,
    action: BoardAction<T>,
    options?: ExecuteOptions
): Promise<ActionResult<T>>
```

### Usage
```typescript
private async handleAddCard(message: AddCardMessage, context: CommandContext): Promise<CommandResult> {
    const action = addCard(
        message.columnId,
        { content: message.cardData?.content || '' },
        message.cardData?.index
    );
    const result = await this.executeAction(context, action);
    return result.success
        ? this.success(result.data)
        : this.failure(result.error || 'Failed to add card');
}
```

## 4. Path Normalization Pattern

### Current Pattern
```typescript
// Multiple places normalize paths
path.normalize(filePath).replace(/\\/g, '/')
path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath)
```

### Files Using This Pattern
- `src/utils/stringUtils.ts` - Has helper functions ✅
- `src/files/MarkdownFile.ts`
- `src/services/PathResolver.ts`
- `src/services/LinkHandler.ts`

### Suggested Refactor
Ensure all path operations go through centralized utils:

```typescript
// Already in src/utils/stringUtils.ts
export function toForwardSlashes(filePath: string): string
export function normalizePathForLookup(filePath: string): string
export function isSamePath(path1: string, path2: string): boolean
```

### Usage
Replace all manual path normalization with:
```typescript
import { toForwardSlashes, normalizePathForLookup, isSamePath } from '../utils/stringUtils';

const normalized = toForwardSlashes(filePath);
const lookupKey = normalizePathForLookup(relativePath);
if (isSamePath(path1, path2)) { /* ... */ }
```

## 5. Error Handling Pattern

### Current Pattern
```typescript
try {
    await someOperation();
    return this.success();
} catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('[ClassName.method] Error:', error);
    return this.failure(errorMessage);
}
```

### Files Using This Pattern
- Nearly all command handlers
- Most service methods

### Suggested Refactor
Create a wrapper for async operations:

```typescript
// src/utils/errorHandling.ts
export async function withErrorHandling<T>(
    errorPrefix: string,
    operation: () => Promise<T>
): Promise<{ success: true; data: T } | { success: false; error: string }> {
    try {
        const data = await operation();
        return { success: true, data };
    } catch (error) {
        const errorMessage = getErrorMessage(error);
        logger.error(`${errorPrefix}:`, error);
        return { success: false, error: errorMessage };
    }
}
```

### Usage
```typescript
private async handleSomeOperation(): Promise<CommandResult> {
    const result = await withErrorHandling('[MyCommand.handleSomeOperation]', async () => {
        await someOperation();
        return undefined;
    });

    return result.success ? this.success() : this.failure(result.error);
}
```

## 6. Message Validation Pattern

### Current Pattern
```typescript
if (!message.someProperty) {
    return this.failure('Missing required property: someProperty');
}
```

### Suggested Refactor
Create a generic validator:

```typescript
// src/commands/validation.ts
export function validateMessage<T extends BaseMessage>(
    message: T,
    requiredProperties: (keyof T)[]
): { valid: true } | { valid: false; error: string } {
    for (const prop of requiredProperties) {
        if (!message[prop]) {
            return { valid: false, error: `Missing required property: ${String(prop)}` };
        }
    }
    return { valid: true };
}
```

### Usage
```typescript
private async handleSomeOperation(message: SomeMessage, context: CommandContext): Promise<CommandResult> {
    const validation = validateMessage(message, ['requiredProp1', 'requiredProp2']);
    if (!validation.valid) {
        return this.failure(validation.error);
    }
    // Process message
}
```

## 7. File Watcher Pattern

### Current Pattern
```typescript
private _fileWatcher?: vscode.FileSystemWatcher;
private _watcherDisposable?: vscode.Disposable;
private _isWatching: boolean = false;

private startWatching(): void {
    if (this._isWatching) return;
    this._fileWatcher = vscode.workspace.createFileSystemWatcher(filePath);
    this._watcherDisposable = this._fileWatcher.onDidChange(() => { /* ... */ });
    this._isWatching = true;
}

private stopWatching(): void {
    if (!this._isWatching) return;
    this._watcherDisposable?.dispose();
    this._fileWatcher?.dispose();
    this._isWatching = false;
}
```

### Files Using This Pattern
- `src/files/MarkdownFile.ts` - Has centralized watcher management ✅
- `src/panel/WebviewManager.ts`

### Suggested Refactor
Use the centralized WatcherCoordinator (already exists):

```typescript
// Already in src/files/WatcherCoordinator.ts
protected static get _watcherCoordinator(): WatcherCoordinator {
    return WatcherCoordinator.getInstance();
}
```

## 8. Service Dependency Access Pattern

### Current Pattern
```typescript
const boardStore = (fileService as any)?._deps?.boardStore;
const panel = (this as any)._panel;
```

### Files Using This Pattern
- `src/commands/DebugCommands.ts:719` - `(fileService as any)?._deps?.boardStore`
- `src/panel/PanelContext.ts:228` - `(this as any)[`_${name}`]`
- `src/kanbanBoardsProvider.ts:393` - `(this._registry as any)._context`

### Suggested Refactor
Create proper accessor methods:

```typescript
// For DebugCommands - add proper method to file service
class KanbanFileService {
    getBoardStore(): BoardStore | undefined {
        return this._deps.boardStore;
    }
}

// For PanelContext - use proper getter/setter
class PanelContext {
    private _context: Map<string, any> = new Map();
    
    public setContext<T>(name: string, value: T): void {
        this._context.set(name, value);
    }
    
    public getContext<T>(name: string): T | undefined {
        return this._context.get(name);
    }
}

// For kanbanBoardsProvider - expose context properly
class KanbanBoardsProvider {
    private _registry: BoardRegistryService;
    
    public getRegistryContext(): RegistryContext | undefined {
        return this._registry.getContext();
    }
}
```

## Priority Recommendations

### High Priority (Biggest Impact)
1. **Fix remaining ClipboardCommands type casts** - 10 casts to fix
2. **Consolidate file registry access** - Used in 10+ places
3. **Use ActionExecutor consistently** - Already centralized, just needs adoption

### Medium Priority (Code Quality)
4. **Create typed handler wrapper** - Reduces boilerplate in all commands
5. **Add message validation helpers** - Consistent error messages
6. **Consolidate error handling** - Reduces try/catch boilerplate

### Low Priority (Nice to Have)
7. **Fix remaining `as any` casts** - Window API access, internal properties
8. **Extract service accessors** - Better encapsulation
9. **Standardize path operations** - Already has helpers, just needs consistent use

## Estimated Effort

| Task | Effort | Impact |
|------|---------|--------|
| Fix ClipboardCommands type casts | 1-2 hours | High |
| Consolidate file registry access | 2-3 hours | High |
| Use ActionExecutor consistently | 4-6 hours | High |
| Create typed handler wrapper | 3-4 hours | Medium |
| Add message validation helpers | 2-3 hours | Medium |
| Consolidate error handling | 3-4 hours | Medium |
| Fix remaining `as any` casts | 2-3 hours | Low |
| Extract service accessors | 2-3 hours | Low |
| Standardize path operations | 1-2 hours | Low |

**Total Estimated Effort**: 20-30 hours

## Benefits of Consolidation

1. **Reduced Code Duplication**: Eliminate 500+ lines of repeated patterns
2. **Type Safety**: Consistent typing across all handlers
3. **Error Consistency**: Uniform error messages and handling
4. **Easier Testing**: Centralized logic easier to mock/test
5. **Faster Development**: Less boilerplate to write for new commands
6. **Better Maintainability**: Fix bugs in one place, not many
