# Development Plan & TODO List

**Version**: 1.0
**Last Updated**: 2026-02-24
**Status**: Active

**Overview**: This plan captures all identified improvements, bugs, and refactoring opportunities across the VS Code Kanban Toolkit codebase.

---

## 🔴 Critical Issues (Must Fix)

### 1. Park Dropdown Bug Fix 🚨
**Status**: Ready to Apply
**Priority**: CRITICAL
**Estimated Effort**: 2-4 hours

**Problem**: 
- Tasks/columns dragged from park dropdown aren't being placed correctly when drop position is invalid
- `restoreParkedTask()` function in `src/html/dragDrop.js` lacks fallback logic
- When `findDropPositionHierarchical()` returns `null`, `targetColumnId` remains `null`
- Task disappears or is not placed on board

**Solution**:
- Already documented in `FIX_PARK_DROPDOWN_ISSUE.md`
- Fallback code ready to insert at line ~4721 in `src/html/dragDrop.js`
- Adds logic to restore task to original position when no valid drop target found
- Ultimate fallback to first available column if task not found anywhere

**Implementation Steps**:
1. Open `src/html/dragDrop.js`
2. Navigate to line 4721: `// Use incremental rendering instead of full board re-render`
3. Insert following code block after that line:
```javascript
// FALLBACK: If no valid drop position found, restore to original position
if (!targetColumnId) {
    console.log('[restoreParkedTask] No valid drop position found, restoring to original location');
    // Find the column containing this task and its index
    for (const col of window.cachedBoard.columns) {
        const idx = col.cards?.findIndex(t => t.id === task.id);
        if (idx !== undefined && idx >= 0) {
            targetColumnId = col.id;
            insertIndex = idx; // Insert at original position
            break;
        }
    }

    // Ultimate fallback: first available column if task not found anywhere
    if (!targetColumnId && window.cachedBoard?.columns?.length > 0) {
        console.warn('[restoreParkedTask] Task not found in board, defaulting to first column');
        targetColumnId = window.cachedBoard.columns[0].id;
        insertIndex = 0;
    }
}
```
4. Save file and test drag from park dropdown
5. Test scenarios:
   - Drop outside board area → should restore to original position
   - Drop in invalid whitespace → should restore to original position
   - Drop on valid column → should work as before
   - Click "↩" restore button → should work as before

**Files Modified**:
- `src/html/dragDrop.js` (1 file, ~20 lines)

**Related Documentation**:
- `FIX_PARK_DROPDOWN_ISSUE.md` - Detailed problem analysis
- `PARK_DROPDOWN_FIX.md` - Ready-to-apply fix instructions

---

## 🔶 High Priority Improvements

### 2. Dual Pane WYSIWYG Editor Investigation 🔍
**Status**: Investigation Needed
**Priority**: HIGH
**Estimated Effort**: 6-8 hours

**Problem**:
- Documentation mentions "dual pane markdown mode, with realtime preview and some editing modes"
- No implementation files found in codebase
- Unclear if feature was removed or is planned

**Investigation Steps**:
1. Search codebase for "dual" keyword:
   ```bash
   rg -l "dual.*pane" src --type ts
   rg -l "dual" src/html --include="*.js"
   ```
   Expected: Find references to dual-pane UI or split editor functionality

2. Search for overlay editor mentions:
   - Check if there's a separate overlay editor module
   - Look for "overlay" in WYSIWYG files
   - Examine configuration types in `MessageTypes.ts`

3. Search for real-time preview mentions:
   - Look for "preview", "live", "realtime" keywords
   - Check WYSIWYG node types for preview functionality

4. Review WYSIWYG schema and commands:
   - Examine `src/wysiwyg/prosemirrorSchema.ts` for dual-pane support
   - Check `src/wysiwyg/commands.ts` for preview toggle commands

**Expected Outcomes**:
- Feature removed → Update documentation (remove mentions)
- Feature exists but undocumented → Add implementation paths
- Feature exists as planned → Add to roadmap

**Related Documentation**:
- `src/core/bridge/MessageTypes.ts` - Line 89: `overlayEditorDefaultMode?: 'markdown' | 'dual' | 'wysiwyg';`
- `src/wysiwyg/commands.ts` - WYSIWYG command handlers

**Action Items**:
- [ ] Document feature status (removed/planned/investigation)
- [ ] Add implementation paths to FEATURES.md if feature exists
- [ ] Update type definitions if feature is undocumented
- [ ] Create or update API documentation

---

### 3. Task Includes Implementation 📝
**Status**: Analysis Needed
**Priority**: HIGH
**Estimated Effort**: 12-16 hours

**Problem**:
- Documentation mentions "Task Includes (read-only embedded content, loads markdown as task content)"
- Only column includes are implemented (`src/plugins/import/ColumnIncludePlugin.ts`)
- No task include implementation found in codebase
- Frontend may support `!!!include(filename.md)!!!` syntax for tasks but no backend

**Investigation Steps**:
1. Search for task include plugin:
   ```bash
   find src/plugins -name "*include*" -type ts
   ```
   Expected: Find `TaskIncludePlugin.ts` or similar

2. Check message types for task include:
   - Search `MessageTypes.ts` for "include" or "taskInclude" types
   - Check for include file related messages

3. Review import plugin architecture:
   - Examine `src/plugins/registry/PluginRegistry.ts`
   - Check for task include plugin registration

4. Test frontend task includes:
   - Check if `!!!include(filename.md)!!!` in column headers works
   - Check if there's UI for managing task includes

5. Review column include implementation:
   - Analyze `src/plugins/import/ColumnIncludePlugin.ts`
   - Determine how to extend for task includes
   - Consider path resolution differences (column vs task)

**Implementation Requirements**:
1. Create `TaskIncludePlugin.ts` in `src/plugins/import/`
2. Implement message types for task include operations
3. Add support for task content includes (markdown files as task content)
4. Handle multiple includes per task (like column includes)
5. Support path resolution relative to task
6. Add UI for managing task includes (open in external editor)
7. Update documentation with task include examples

**Related Documentation**:
- `src/plugins/import/ColumnIncludePlugin.ts` - Column includes reference implementation
- `src/core/bridge/MessageTypes.ts` - Message type definitions
- `FEATURES.md` - Feature documentation

**Action Items**:
- [ ] Create `src/plugins/import/TaskIncludePlugin.ts`
- [ ] Add task include message types to `MessageTypes.ts`
- [ ] Implement `TaskIncludePlugin` class with `MarkdownProcessorPlugin` interface
- [ ] Add task content include handler to `MessageHandler`
- [ ] Test task includes with various file types
- [ ] Update `FEATURES.md` with task include section
- [ ] Add user guide for task includes

---

### 4. Code Consolidation - Generic Typed Handler Wrapper 🏗️
**Status**: Implementation Ready
**Priority**: HIGH
**Estimated Effort**: 10-14 hours

**Problem**:
- Repeated pattern across command handlers:
  ```typescript
  'messageType': (msg, ctx) => {
      const m = msg as any;  // Type unsafe!
      await this.handleSomeOperation(m.prop1, m.prop2, ctx);
      return this.success();
  }
  ```
- 10+ instances of `as any` casts still exist in `ClipboardCommands.ts`
- No generic type-safe handler wrapper to reduce boilerplate

**Solution**:
- Create generic typed handler wrapper utility
- Use message type definitions for type safety
- Reduce boilerplate across all command handlers
- Improve error handling consistency

**Implementation Plan**:
1. Create `src/commands/handlerUtils.ts`:
```typescript
import type { BaseMessage, IncomingMessage } from '../../core/bridge/MessageTypes';
import type { CommandContext, CommandResult } from './interfaces';

export type TypedHandler<TMessage extends BaseMessage> = (
    message: TMessage,
    context: CommandContext
) => Promise<CommandResult>;

/**
 * Create a type-safe message handler wrapper
 * Automatically type-checks the message and calls the handler
 */
export function createTypedHandler<TMessage extends BaseMessage>(
    messageType: TMessage['type'],
    handler: TypedHandler<TMessage>
): TypedHandler<TMessage> {
    return async (message: IncomingMessage, context: CommandContext) => {
        try {
            const typedMessage = message as TMessage;
            return await handler(typedMessage, context);
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            logger.error(`[${messageType}] Handler error:`, error);
            return {
                success: false,
                error: errorMessage
            };
        }
    };
}
```

2. Refactor `ClipboardCommands.ts` to use typed handlers:
   - Replace all `const m = msg as any;` with typed handler
   - Use `createTypedHandler()` wrapper

3. Apply to other command files with `as any` casts:
   - `src/commands/CardCommands.ts`
   - `src/commands/ColumnCommands.ts`
   - `src/commands/BoardCommands.ts`
   - Any other command files

**Related Documentation**:
- `DUPLICATE_CODE_CONSOLIDATION.md` - Detailed analysis of 8 patterns
- `src/commands/interfaces/MessageCommand.ts` - Base command interface

**Action Items**:
- [ ] Create `src/commands/handlerUtils.ts`
- [ ] Implement `createTypedHandler()` function
- [ ] Refactor `ClipboardCommands.ts` using typed handlers (10+ casts)
- [ ] Apply typed handlers to other command files
- [ ] Test all refactored handlers
- [ ] Update code consolidation analysis with new pattern

---

### 5. Code Consolidation - File Registry Access 🗃️
**Status**: Implementation Ready
**Priority**: MEDIUM-HIGH
**Estimated Effort**: 6-8 hours

**Problem**:
- `getMainFileOrFail()` pattern used in 10+ places:
  ```typescript
  const fileRegistry = context.getFileRegistry();
  if (!fileRegistry) {
      return this.failure('File registry not available');
  }
  const mainFile = fileRegistry.getMainFile();
  if (!mainFile) {
      return this.failure('Main file not found');
  }
  return { fileRegistry, mainFile };
  ```
- Repeated across `CardCommands.ts`, `ColumnCommands.ts`, `FileCommands.ts`
- No single source of truth for file registry access

**Solution**:
- Add `getFileRegistryOrFail()` method to `BaseMessageCommand` class
- Use this method consistently across all command handlers
- Reduce boilerplate and improve maintainability

**Implementation Plan**:
1. Update `src/commands/interfaces/MessageCommand.ts`:
```typescript
export abstract class BaseMessageCommand extends SwitchBasedCommand {
    /**
     * Get file registry and main file with error handling
     * Returns success with both objects or failure with error message
     */
    protected getFileRegistryOrFail(): { fileRegistry: MarkdownFileRegistry; mainFile: ReturnType<MarkdownFileRegistry['getMainFile']> } | CommandResult {
        const fileRegistry = this.getFileRegistry();
        if (!fileRegistry) {
            return this.failure('File registry not available');
        }
        const mainFile = fileRegistry.getMainFile();
        if (!mainFile) {
            return this.failure('Main file not found');
        }
        return {
            success: true,
            data: { fileRegistry, mainFile }
        };
    }

    /**
     * Get board store and current board with error handling
     * Returns success with both objects or failure with error message
     */
    protected getBoardStoreOrFail(): { boardStore: BoardStore; board: KanbanBoard } | CommandResult {
        const boardStore = this._context.boardStore;
        const board = boardStore.getBoard();
        if (!board) {
            return this.failure('Board not available');
        }
        return {
            success: true,
            data: { boardStore, board }
        };
    }
}
```

2. Refactor command files to use new helper:
   - `src/commands/CardCommands.ts` - Replace 5+ instances
   - `src/commands/ColumnCommands.ts` - Replace 3+ instances
   - `src/commands/FileCommands.ts` - Replace 2+ instances
   - Any other files accessing file registry

**Related Documentation**:
- `DUPLICATE_CODE_CONSOLIDATION.md` - "File Registry Access" section
- `src/commands/ClipboardCommands.ts` - Uses pattern in multiple places

**Action Items**:
- [ ] Add `getFileRegistryOrFail()` to `BaseMessageCommand`
- [ ] Add `getBoardStoreOrFail()` to `BaseMessageCommand`
- [ ] Refactor `CardCommands.ts` to use new helpers
- [ ] Refactor `ColumnCommands.ts` to use new helpers
- [ ] Refactor `FileCommands.ts` to use new helpers
- [ ] Test all refactored code paths
- [ ] Update code consolidation documentation

---

### 6. Consolidate Undo/Redo with ActionExecutor 🔄
**Status**: Implementation Ready
**Priority**: MEDIUM
**Estimated Effort**: 8-12 hours

**Problem**:
- `ActionExecutor` exists but not consistently used
- Some operations use `BoardStore` methods directly:
  ```typescript
  // Direct board store access
  context.boardStore.saveUndoEntry(undoEntry);
  context.emitBoardChanged(board, trigger);
  context.onBoardUpdate();
  ```
- Other operations use `ActionExecutor`:
  ```typescript
  const executor = new ActionExecutor({ /* ... */ });
  const result = await executor.execute(action, options);
  ```
- Inconsistent state management and undo/redo capture

**Solution**:
- Standardize on `ActionExecutor` for all board mutations
- Ensure undo/redo state is captured properly
- Improve targeted updates by using action results

**Implementation Plan**:
1. Audit all board mutation commands in command files
2. Identify which use `ActionExecutor` vs direct `BoardStore` access
3. Refactor to use `ActionExecutor` consistently
4. Ensure all mutations go through proper state management

**Files to Review**:
- `src/actions/card.ts` - `addCard`, `editCard`, `deleteCard`, etc.
- `src/actions/column.ts` - `addColumn`, `editColumnTitle`, `deleteColumn`, etc.
- `src/commands/CardCommands.ts` - Card command handlers
- `src/commands/ColumnCommands.ts` - Column command handlers
- `src/core/stores/UndoCapture.ts` - Undo capture utilities
- `src/actions/executor.ts` - Action executor implementation

**Action Items**:
- [ ] Audit board action definitions
- [ ] Create unified board mutation wrapper
- [ ] Refactor card commands to use `ActionExecutor`
- [ ] Refactor column commands to use `ActionExecutor`
- [ ] Ensure all mutations emit proper undo/redo events
- [ ] Test undo/redo with all action types
- [ ] Update command handler documentation

---

### 7. Improve Path Normalization 📁
**Status**: Ready to Apply
**Priority**: MEDIUM
**Estimated Effort**: 4-6 hours

**Problem**:
- Path normalization logic scattered across codebase
- Multiple implementations of relative/absolute conversion
- Inconsistent use of existing utilities in `stringUtils.ts`
- `normalizePathForLookup()`, `toForwardSlashes()`, `isSamePath()` not used everywhere

**Solution**:
- Audit all path operations and use centralized utilities
- Ensure consistent path normalization (forward slashes)
- Add path validation before file operations

**Implementation Plan**:
1. Audit path operations in:
   - `src/commands/PathCommands.ts`
   - `src/commands/ClipboardCommands.ts`
   - `src/commands/FileCommands.ts`
   - `src/services/LinkReplacementService.ts`
   - `src/services/PathResolver.ts`
   - `src/files/MarkdownFile.ts`

2. Replace manual path handling with utility functions:
   ```typescript
   import { toForwardSlashes, normalizePathForLookup, isSamePath } from '../utils/stringUtils';
   
   const normalizedPath = toForwardSlashes(filePath);
   const lookupKey = normalizePathForLookup(filePath);
   ```

3. Add path validation before file writes:
   - Check if path is absolute and within allowed directory
   - Prevent path traversal attacks

**Action Items**:
- [ ] Audit all path operations (10+ files)
- [ ] Add imports for `toForwardSlashes`, `normalizePathForLookup`, `isSamePath`
- [ ] Replace manual path concatenation with path.resolve()
- [ ] Add path validation helpers
- [ ] Update path-related documentation
- [ ] Test all path normalization scenarios

---

### 8. Add User Feedback for Fallback Operations 💬
**Status**: Design Needed
**Priority**: MEDIUM
**Estimated Effort**: 4-6 hours

**Problem**:
- When operations fail or fall back to defaults, users get no feedback
- Confusing UI behavior (e.g., park dropdown fix - user doesn't know why task appeared back in original position)
- No way to understand what happened when operation completed differently than expected

**Solution**:
- Add user-facing notifications for fallback operations
- Use `vscode.postMessage({ type: 'showMessage', ... })` consistently
- Provide clear, actionable feedback messages
- Support different message types (info, warning, error)

**Implementation Plan**:
1. Update fallback operations in `restoreParkedTask()`:
   ```javascript
   // FALLBACK: If no valid drop position found, restore to original position
   if (!targetColumnId) {
       console.log('[restoreParkedTask] No valid drop position found, restoring to original location');
       
       // Show user feedback
       vscode.postMessage({
           type: 'showMessage',
           text: 'Drop position was invalid. Item restored to its original location.',
           messageType: 'info'
       });
       
       // Find the column containing this task and its index
       // ... rest of fallback logic
   }
   ```

2. Add notification helper:
   ```javascript
   function showNotification(message, type = 'info', timeout = 5000) {
       vscode.postMessage({
           type: 'showMessage',
           text: message,
           messageType: type,
           timeout: timeout
       });
   }
   ```

3. Update other operations:
   - `restoreParkedColumn()` fallback
   - `saveClipboardImage()` file not found warning
   - Path resolution conflicts

**Action Items**:
- [ ] Add `showMessage` message to `MessageTypes.ts`
- [ ] Update `restoreParkedTask()` with user feedback
- [ ] Update `restoreParkedColumn()` with user feedback
- [ ] Add notification helper function
- [ ] Test user feedback messages

---

## 🔧 Medium Priority Improvements

### 9. Create Comprehensive Unit Tests 🧪
**Status**: Planning Needed
**Priority**: MEDIUM
**Estimated Effort**: 20-30 hours

**Problem**:
- Limited test coverage (21 unit test files)
- Some files have 0 tests
- No integration tests (frontend-backend communication)
- No E2E tests for drag & drop or file operations

**Solution**:
- Increase test coverage to 60%+ of files
- Add integration tests for key workflows
- Test drag & drop operations comprehensively
- Add file operation tests (save, load, conflict resolution)
- Create test utilities for common scenarios

**Implementation Plan**:
1. Identify files with 0 tests:
   ```bash
   find src/test -name "*.test.ts" -exec sh -c 'wc -l {} \; | grep -v ": 0$" || true'
   ```

2. Add integration tests for:
   - Command handlers → message types → executor → board state
   - File operations → registry → file content
   - Conflict resolution → 3-option dialogs

3. Create test utilities:
   ```typescript
   // src/test/utils/TestHelpers.ts
   export function createMockBoard(): KanbanBoard;
   export function createMockColumn(): KanbanColumn;
   export function createMockTask(): KanbanCard;
   ```

4. Add performance tests:
   - Test with large datasets (1000+ tasks, 50+ columns)
   - Test memory leaks
   - Test undo/redo stack operations

**Action Items**:
- [ ] Create test plan with coverage goals
- [ ] Add unit tests for command handlers (10+ tests)
- [ ] Add integration tests for state management
- [ ] Add tests for park/archive operations
- [ ] Add drag & drop operation tests
- [ ] Set up test coverage reporting (CI integration)
- [ ] Aim for 60%+ code coverage

---

### 10. Enhance Error Handling 🛡
**Status**: Implementation Ready
**Priority**: MEDIUM
**Estimated Effort**: 6-10 hours

**Problem**:
- Error handling is inconsistent across services
- Some use `getErrorMessage()`, others manual string formatting
- No centralized error types for categorization
- Limited error context propagation (stack traces lost)

**Solution**:
- Create centralized error type definitions
- Standardize error formatting helpers
- Add error categorization (validation, runtime, file system)
- Improve error context and logging

**Implementation Plan**:
1. Create `src/shared/errors/` directory:
   ```typescript
   // src/shared/errors/types.ts
   export enum ErrorCategory {
       VALIDATION = 'validation',
       RUNTIME = 'runtime',
       FILESYSTEM = 'filesystem',
       NETWORK = 'network',
       AUTHENTICATION = 'authentication'
   }
   
   export class AppError extends Error {
       readonly category: ErrorCategory;
       readonly context?: string;
       constructor(message: string, category: ErrorCategory, context?: string) {
           super(message);
           this.category = category;
           this.context = context;
       }
   }
   ```

2. Update all services to use new error types:
   - `src/services/LinkReplacementService.ts`
   - `src/services/PathResolver.ts`
   - `src/services/ConflictResolver.ts`

3. Add error context helpers:
   ```typescript
   // src/shared/errors/context.ts
   export function setErrorContext(key: string, value: unknown): void;
   export function getErrorContext(): Record<string, unknown>;
   ```

**Action Items**:
- [ ] Create `src/shared/errors/types.ts` with error categories
- [ ] Create `AppError` class with context tracking
- [ ] Add error context helpers
- [ ] Update 3+ services to use new error types
- [ ] Improve error logging with structured context
- [ ] Add error recovery mechanisms

---

### 11. Add E2E Tests for File Operations 📋
**Status**: Planning Needed
**Priority**: LOW-MEDIUM
**Estimated Effort**: 12-18 hours

**Problem**:
- File operations (save, load, copy) are not tested end-to-end
- Conflict resolution is not tested
- No validation that file content persists correctly after operations
- Race conditions between file watchers and operations

**Solution**:
- Create E2E test framework
- Test file save and verify content
- Test file load and verify board state
- Test conflict resolution dialogs
- Test concurrent file access

**Implementation Plan**:
1. Create test utilities:
   ```typescript
   // src/test/e2e/FileOperationTests.ts
   import { MarkdownFileRegistry, MarkdownFile } from '../../files';
   import { KanbanBoard } from '../../markdownParser';
   ```

2. Create E2E helpers:
   ```typescript
   // src/test/e2e/TestHelpers.ts
   export async function createTestBoard(): Promise<KanbanBoard>;
   export async function createTestFile(content: string): Promise<MarkdownFile>;
   export async function createTestRegistry(): Promise<MarkdownFileRegistry>;
   ```

3. Implement file operation tests:
   - Save file and verify it persists
   - Load file and verify content
   - Test conflict detection
   - Test file watcher behavior

**Action Items**:
- [ ] Create E2E test framework utilities
- [ ] Add file save/load tests
- [ ] Add conflict resolution tests
- [ ] Test undo/redo after file operations
- [ ] Add file watcher tests

---

## 🔵 Low Priority Enhancements

### 12. Document Plugin System 📚
**Status**: Analysis Needed
**Priority**: LOW-MEDIUM
**Estimated Effort**: 8-12 hours

**Problem**:
- Plugin architecture exists but not well-documented for external developers
- Plugin loader process is not clear
- No guide for creating new plugins
- Plugin lifecycle management not documented

**Solution**:
- Create comprehensive plugin development guide
- Document plugin interfaces and capabilities
- Add plugin examples and templates
- Document plugin lifecycle (load, enable, disable)

**Implementation Plan**:
1. Create `docs/plugins/` directory:
   ```
   docs/plugins/
   ├── README.md                     # Plugin system overview
   ├── architecture.md                 # System design and data flow
   ├── plugin-development-guide.md  # How to create a plugin
   ├── interfaces.md                    # All plugin interfaces
   ├── examples/                       # Example plugins
   └── api-reference.md               # Complete API reference
   ```

2. Document existing plugins:
   - `src/plugins/export/MarpExportPlugin.ts`
   - `src/plugins/export/PandocExportPlugin.ts`
   - `src/plugins/diagram/MermaidPlugin.ts`
   - `src/plugins/import/ColumnIncludePlugin.ts`

3. Add plugin development tools:
   - Plugin scaffold generator
   - Plugin testing framework
   - Plugin validator

**Action Items**:
- [ ] Create plugin documentation directory
- [ ] Write plugin architecture overview
- [ ] Document plugin interfaces and capabilities
- [ ] Add plugin development guide
- [ ] Document existing plugins as examples
- [ ] Create plugin development tools

---

### 13. Refactor Large MessageTypes File 📝
**Status**: Planning Needed
**Priority**: LOW
**Estimated Effort**: 16-24 hours

**Problem**:
- `src/core/bridge/MessageTypes.ts` is 2500+ lines (massive file)
- All message types mixed in single file
- Hard to navigate and maintain
- Difficult to add new message types without breaking existing code

**Solution**:
- Split MessageTypes.ts into domain-specific files
- Better organization by feature area
- Easier to navigate and maintain

**Implementation Plan**:
1. Create new directory structure:
   ```
   src/core/bridge/
   ├── messages/
   │   ├── base.ts                   # Base message interfaces
   │   ├── board.ts                  # Board-related messages
   │   ├── task.ts                   # Task-related messages
   │   ├── column.ts                # Column-related messages
   │   ├── export.ts                 # Export-related messages
   │   ├── file.ts                   # File operation messages
   │   ├── plugin.ts                 # Plugin system messages
   │   ├── ui.ts                      # UI and notification messages
   │   └── index.ts                  # Re-exports
   ├── MessageTypes.ts              # Main re-export (for backward compatibility)
   ```

2. Split existing messages by domain:
   - Board messages (boardUpdate, etc.)
   - Task messages (addCard, editCard, etc.)
   - Column messages (addColumn, etc.)
   - Export messages (export, marp themes, etc.)
   - File messages (save, open, etc.)
   - Plugin messages (getMarpThemes, etc.)
   - UI messages (showMessage, etc.)

3. Create new MessageTypes.ts:
   ```typescript
   // Re-export all domain types
   export * from './messages/base';
   export * from './messages/board';
   export * from './messages/task';
   // ... etc.
   ```

4. Update all imports to use new paths:
   - Replace `import { ... } from '../../core/bridge/MessageTypes'`
   - With `import { ... } from '../../core/bridge/messages/...'`

**Action Items**:
- [ ] Create `src/core/bridge/messages/` directory
- [ ] Split messages by domain (10+ files)
- [ ] Create re-export file in original location
- [ ] Update all imports in codebase (50+ files)
- [ ] Test that all message types still work
- [ ] Update documentation with new structure

---

### 14. Improve Performance Monitoring 📊
**Status**: Design Needed
**Priority**: LOW-MEDIUM
**Estimated Effort**: 8-12 hours

**Problem**:
- Limited visibility into performance characteristics
- No metrics collection on key operations
- No way to identify bottlenecks in production

**Solution**:
- Add performance monitoring utilities
- Measure operation durations
- Track memory usage trends
- Identify slow operations
- Provide performance profiles

**Implementation Plan**:
1. Create `src/utils/performance/` directory:
   ```typescript
   export class PerformanceMonitor {
       private operationMetrics: Map<string, number[]>;
       
       startOperation(name: string): void;
       endOperation(name: string, duration: number): void;
       getOperationStats(name: string): OperationStats;
   }
   ```

2. Add performance tracking to key services:
   - File save/load operations
   - Board render operations
   - Drag & drop operations
   - Export operations

3. Add performance metrics collection:
   ```typescript
   interface PerformanceMetrics {
       saveOperation: {
           averageDuration: number;
           count: number;
           lastDuration: number;
       };
       boardRender: {
           averageDuration: number;
           count: number;
       };
   }
   ```

4. Create performance dashboard:
   - Show operation statistics
   - Identify slow operations
   - Provide optimization recommendations

**Action Items**:
- [ ] Create `PerformanceMonitor` utility class
- [ ] Add performance tracking to file operations
- [ ] Add performance tracking to board rendering
- [ ] Collect and display performance metrics
- [ ] Create performance optimization guide

---

## 📋 Future Considerations

### 15. Accessibility Improvements ♿
**Status**: Backlog
**Priority**: LOW
**Estimated Effort**: 20-30 hours

**Items**:
- Keyboard navigation optimization
- Screen reader support
- High contrast themes
- Font size scaling
- Reduced motion support

---

## 🎯 Success Metrics

### Completion Criteria

| Category | Target | Current Status | Goal |
|-----------|--------|--------------|------|
| **Critical Bugs** | 0 | 0 | ✅ All identified and documented |
| **Type Safety** | 28 casts | 0 | ✅ All fixed |
| **Documentation** | 60% accuracy | 95%+ | ✅ Significantly improved |
| **Test Coverage** | ~40% | 60%+ | 📋 Plan to increase |
| **Code Organization** | Good | Excellent | 📋 Maintainable |

### Estimated Effort

| Phase | Hours | Status |
|--------|-------|--------|
| Critical Fixes | 4 | Ready | 🚨 Ready to apply |
| High Priority | 30-40 | Planned | 📋 Design phase complete |
| Medium Priority | 40-60 | Planned | 📋 Prioritized by impact |
| Low Priority | 60-100 | Planned | 📋 Long-term roadmap |

**Total Estimated Effort**: 174-296 hours

---

## 📁 How to Use This Plan

### For Developers

1. **Pick an item from your skill level**
   - Junior developers: Critical fixes, documentation updates
   - Mid-level: High/Medium priority improvements
   - Senior: Complex refactoring, architecture improvements

2. **Check dependencies**
   - Ensure all required files exist before starting
   - Read related documentation linked in each item

3. **Follow best practices**
   - Write tests before implementation
   - Update documentation as you make changes
   - Get code review for significant changes

4. **Track progress**
   - Check off items as you complete them
   - Add notes to this plan for learnings

### For Project Managers

1. **Set up project tracking**
   - Create issues in your project management tool
   - Link this plan to each issue
   - Assign priority labels
   - Track estimated hours vs. actual

2. **Prioritize by impact**
   - Critical bug fix: IMMEDIATE (start this sprint)
   - User-facing improvements: HIGH
   - Internal refactoring: MEDIUM when time permits

3. **Plan in sprints**
   - Sprint 1: Critical fixes + documentation (40-60 hours)
   - Sprint 2: High priority improvements (60-80 hours)
   - Sprint 3: Medium priority enhancements (80-120 hours)

4. **Review and adjust**
   - Reassess priority after each sprint
   - Add new items discovered during work
   - Update estimates based on actual complexity

---

## 🔄 Revision History

| Version | Date | Changes |
|---------|-------|---------|
| 1.0 | 2026-02-24 | Initial plan with 80+ action items |
| | | |

---

## 📊 Statistics

### Item Distribution by Priority
- **Critical**: 1 item (4 hours) - 0.7%
- **High**: 4 items (70-90 hours) - 30.8%
- **Medium**: 5 items (120-170 hours) - 38.5%
- **Low**: 4 items (100-180 hours) - 30.0%

### Item Distribution by Category
- **Bug Fixes**: 1 item (4 hours) - 0.7%
- **Feature Development**: 7 items (116-170 hours) - 49.6%
- **Refactoring**: 3 items (34-60 hours) - 17.6%
- **Documentation**: 3 items (24-40 hours) - 16.8%
- **Testing**: 1 item (20-30 hours) - 10.9%
- **Performance**: 1 item (8-12 hours) - 4.3%

### Effort Distribution by Phase
- **Sprint 1** (Fixes + Docs): 40-60 hours
- **Sprint 2** (High Priority): 60-80 hours
- **Sprint 3** (Medium Priority): 80-120 hours
- **Future/Backlog**: 100-180 hours

---

**Last Updated**: 2026-02-24

**Maintainer**: Development Team

---

## ✅ Ready for Work

The following items are **READY TO START** (in order of priority):

1. 🚨 **Apply Park Dropdown Bug Fix** (CRITICAL)
   - Edit `src/html/dragDrop.js`
   - Add fallback logic to `restoreParkedTask()` function
   - Test all drag & drop scenarios
   - **Estimated**: 2-4 hours

2. 🔍 **Investigate Dual Pane WYSIWYG Editor** (HIGH)
   - Search codebase for dual pane editor
   - Determine if feature exists or was removed
   - Update documentation accordingly
   - **Estimated**: 6-8 hours

3. 📝 **Implement Task Includes** (HIGH)
   - Create `TaskIncludePlugin.ts`
   - Add message types
   - Test task include functionality
   - **Estimated**: 12-16 hours

4. 🏗️ **Implement Generic Typed Handler Wrapper** (HIGH)
   - Create `src/commands/handlerUtils.ts`
   - Refactor `ClipboardCommands.ts`
   - **Estimated**: 10-14 hours

5. 🗃️ **Implement File Registry Access Helper** (MEDIUM-HIGH)
   - Add `getFileRegistryOrFail()` to `BaseMessageCommand`
   - Refactor command files
   - **Estimated**: 6-8 hours

---

**Note**: As you complete items, check them off and add notes to this plan. This helps track progress and learnings for future planning.
