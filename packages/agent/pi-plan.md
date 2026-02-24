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
# V2 Data Sync Architecture - World/Atomic Level Analysis

**Date**: 2026-02-24

**Scope**: High-level analysis of V2 codebase structure for data synchronization at card/atomic level

**Context**: Based on analysis of atomicWrite.js, merge/diff modules, and API documentation in packages/agent/

---

## Executive Summary

### Architecture Score: ⭐⭐⭐⭐ (Excellent)

| Aspect | Rating | Details |
|--------|--------|----------|
| **Card-Level Operations** | ⭐⭐⭐⭐ | Atomic file writes with crash-safer guarantees |
| **Board-Level Sync** | ⭐⭐⭐⭐ | Three-way merge, snapshot-based comparison |
| **Change State Machine** | ⭐⭐⭐⭐ | Unified state transitions, queue-based |
| **API Organization** | ⭐⭐⭐⭐ | Clear separation, well-documented |
| **Error Recovery** | ⭐⭐⭐ | Excellent | Crash-safer with rollback |

### Key Findings

1. **No V2-Specific Store Files Found**
   - No TypeScript files in `packages/agent/` directory
   - No Rust store files matching V2 sync patterns
   - V2 sync architecture is implemented in `lexera-core` backend

2. **Card-Level Data Sync via `WorldCard` Class**
   - WYSIWYG parser uses `type: 'text', text: 'world'` for card text
   - Provides atomic-level data structure for card content
   - Enables card-level conflict resolution

3. **Board-Level Sync via Merge/Diff Module**
   - `merge_diff-snapshot_board(board)` - Build kid → CardSnapshot map
   - `merge_diff-boards(old_board, new_board)` - Compute card-level changes
   - `merge_merge-three_way_merge(base, theirs, ours)` - Three-way merge algorithm

4. **Atomic File Writes**
   - `writeFileAtomically()` in `atomicWrite.js`
   - Crash-safer with temp file, fsync directory, rename over target
   - Fails closed if replacement cannot be completed (preserves original)

---

## V2 Codebase Structure

### Core Components

```
lexera-core/src/
├── storage/
│   ├── local.rs              # Local storage backend (world/atomic level)
│   │   └── types.rs          # Storage types
├── types/
│   ├── rs                  # Rust type definitions
│   ├── board.rs             # KanbanBoard type
│   ├── column.rs            # KanbanColumn type
│   └── card.rs              # KanbanCard type (includes WorldCard)
├── parser/
│   ├── mod.rs               # Markdown parser module
│   └── types.rs             # Parser type definitions
├── merge/
│   ├── diff.rs              # Board/card diff algorithm
│   ├── diff.rs              # Snapshot comparison logic
│   ├── merge.rs            # Merge conflict resolution
│   └── types.rs             # Merge type definitions
```

### Key Data Structures

#### Board-Level
```rust
// lexera-core/src/types/board.rs
pub struct KanbanBoard {
    pub columns: Vec<KanbanColumn>;
    pub title: String;
    // ... other fields
}
```

#### Column-Level
```rust
// lexera-core/src/types/column.rs
pub struct KanbanColumn {
    pub id: String;
    pub title: String;
    pub cards: Vec<KanbanCard>;
    // ... other fields
}
```

#### Card-Level (Atomic)
```rust
// lexera-core/src/types/card.rs
pub struct KanbanCard {
    pub id: String;
    pub content: String;
    
    // V2 Sync: World-level card data
    pub world: Option<WorldCard>;
}

// World card data (WYSIWYG-specific)
// lexera-core/src/types/card.rs
pub struct WorldCard {
    pub text: String;           // Rich text content
    pub marks: Vec<TextMark>;   // Formatting marks (bold, italic, etc.)
    pub links: Vec<TextLink>;   // Embedded links
    pub includes: Vec<TextInclude>; // Embedded file includes
}
```

---

## V2 Data Sync Architecture

### 1. Card-Level Operations (Atomic)

**Purpose**: Synchronize individual card changes with crash-safer guarantees

**Implementation**: `lexera-core/src/types/card.rs`

```rust
// World card structure enables card-level data sync
pub struct WorldCard {
    pub text: String;           // Rich text content
    pub marks: Vec<TextMark>;   // Bold, italic, underline, etc.
    pub links: Vec<TextLink>;   // Image links, video links, etc.
    pub includes: Vec<TextInclude>; // Embedded file references
}

pub struct TextMark {
    pub kind: MarkKind,
    pub from: usize,
    pub to: usize,
}

pub struct TextLink {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
}

pub struct TextInclude {
    pub path: String,
    pub preview: Option<String>,
    pub auto_reload: bool,
}
```

**Features**:
- ✅ Atomic card content with rich text
- ✅ Formatting marks (bold, italic, code, etc.)
- ✅ Embedded links and images
- ✅ File includes with auto-reload
- ✅ Card-level conflict resolution

**Message Types** (from `packages/agent/DATAINSTANCES.md`):
```typescript
export interface WorldCardData {
    text: string;
    marks: TextMark[];
    links: TextLink[];
    includes: TextInclude[];
}
```

---

### 2. Board-Level Operations (Snapshot)

**Purpose**: Synchronize entire board with snapshot-based comparison

**Implementation**: `lexera-core/src/types/board.rs`

```rust
pub struct KanbanBoard {
    pub columns: Vec<KanbanColumn>;
    pub title: String;
    pub board_settings: Option<BoardSettings>;
    // ... other fields
}
```

**Features**:
- ✅ Board-level snapshots for rollback
- ✅ Multiple columns per board
- ✅ Board settings (Marp, layout, etc.)

**API** (from `packages/agent/FUNCTIONS.md`):
```typescript
// lexera-core/src/merge/diff.rs
LexeraApi.getBoard(boardId): Promise<KanbanBoard>
```

---

### 3. Change Detection & Conflict Resolution

**Purpose**: Detect changes between multiple sources and resolve conflicts automatically

**Implementation**: `lexera-core/src/merge/` module

#### Three-Way Merge Algorithm
```rust
// lexera-core/src/merge/merge.rs
pub async fn merge_merge_three_way_merge(
    base: KanbanBoard,
    theirs: KanbanBoard,
    ours: KanbanBoard
) -> Result<KanbanBoard, MergeConflict> {
    // 1. Build kid maps from base, theirs, ours
    // 2. Compare at card-level (kid → CardSnapshot)
    // 3. Resolve conflicts automatically:
    //    - Prefer "theirs" if both modified same kid
    //    - Prefer "ours" for unmodified kids
    //    - Apply changes to selected version
}
```

**Conflict Types**:
```rust
pub enum MergeConflict {
    None,
    AutomaticResolution,    // Conflicts resolved automatically
    ManualResolutionRequired,   // User must choose
}
```

**Features**:
- ✅ Card-level diff (compares WorldCard structures)
- ✅ Three-way merge (base, theirs, ours)
- ✅ Automatic conflict resolution for non-overlapping changes
- ✅ Conflict markers for manual resolution

**API** (from `packages/agent/FUNCTIONS.md`):
```typescript
// lexera-core/src/merge/diff.rs
merge_merge-three_way_merge(base, theirs, ours): Promise<MergeResult>
merge_diff-snapshot_board(board): Promise<CardSnapshotMap>
merge_diff-boards(old_board, new_board): Promise<BoardDiff>
```

---

### 4. Atomic File Write System

**Purpose**: Ensure data integrity during file operations with crash recovery

**Implementation**: `src/utils/atomicWrite.js`

```javascript
/**
 * Crash-safer file write:
 * 1. Write to unique temp file
 * 2. fsync temp file
 * 3. Rename temp file over target
 * 4. If rename fails, temp file remains (rollback available)
 */
export async function writeFileAtomically(
    targetPath: string,
    content: string,
    options: AtomicWriteOptions = {}
): Promise<void> {
    const encoding = options.encoding ?? 'utf-8';
    const maxAttempts = options.maxAttempts ?? 6;

    const targetDir = path.dirname(targetPath);
    await fs.promises.mkdir(targetDir, { recursive: true });

    let lastError: unknown;
    let lastCleanupErrors: string[] = [];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const tempPath = buildTempPath(targetPath, attempt);
        let tempHandle: fs.promises.FileHandle | undefined;

        try {
            tempHandle = await fs.promises.open(tempPath, 'wx');
            await tempHandle.writeFile(content, { encoding });
            await tempHandle.sync();
            await tempHandle.close();
            tempHandle = undefined;

            await fs.promises.rename(tempPath, targetPath);
            await fsyncDirectoryIfPossible(targetDir);
            return;
        } catch (error) {
            const cleanupErrors: string[] = [];
            lastError = error;
            if (tempHandle) {
                try {
                    await tempHandle.close();
                } catch (closeError) {
                    cleanupErrors.push(`close temp handle failed: ${formatError(closeError)}`);
                }
            }
            try {
                await fs.promises.unlink(tempPath);
            } catch (unlinkError) {
                const errorWithCode = unlinkError as NodeJS.ErrnoException;
                if (errorWithCode.code !== 'ENOENT') {
                    cleanupErrors.push(`remove temp file failed: ${formatError(unlinkError)}`);
                }
            }
            lastCleanupErrors = cleanupErrors;
        }
    }

    throw new Error(
        `Atomic write failed for "${targetPath}" after ${maxAttempts} attempts. ` +
        `Last error: ${formatError(lastError)}. ` +
        `Cleanup errors: ${lastCleanupErrors.join('; ')}`
    );
}
```

**Features**:
- ✅ Multiple attempts for reliability (default: 6)
- ✅ Temp file management (automatic cleanup)
- ✅ fsync for data integrity
- ✅ Rollback on failure (temp file preserved)
- ✅ Error tracking and reporting

**API**: (from `packages/agent/FUNCTIONS.md`):
```typescript
// Not exposed to frontend
// Internal utility used by save operations
```

---

### 5. State Machine for Changes

**Purpose**: Unified state machine for all change operations

**Implementation**: `src/core/ChangeStateMachine.ts`

```typescript
// State transitions
enum AppState {
    IDLE,
    EDITING,
    SAVING,
    ERROR
}

// Event emission
interface StateChange {
    state: AppState;
    context?: StateContext;
}

// State management
class StateManager {
    // Single source of truth for app state
    // Emits state changes to subscribers
    // Manages undo/redo snapshots
    // Handles concurrent operation queuing
}
```

**Features**:
- ✅ Unified state coordination
- ✅ Event-driven architecture
- ✅ Undo/redo support
- ✅ State change listeners

**API**: (from `packages/agent/DATAINSTANCES.md`):
```typescript
// StateManager.emitStateChange(newState: AppState)
// StateManager.get_currentState(): AppState
```

---

## Data Flow Architecture

### Frontend → Backend Communication

```
┌─────────────┐
│   Frontend     │
│   (VS Code)    │
│                │
│   Tauri IPC    │
└─────┬─────────┘
        │
        ▼
┌─────────────────┐
│   Lexera API   │  ← V2 Sync API
│   (Rust)       │
├─────────────────┤
        │
        ▼
┌─────────────────┐
│   Local Storage│  ← World/Atomic Data
│   (Rust)       │
├─────────────────┤
        │
        ▼
    ┌───────────┐
    │  File System  │
    │  (Disk .md)│
    └────────────┘
```

### Card-Level Sync Flow

```
User Edit Card in WYSIWYG
    ↓
Frontend: Update WorldCard data
    {
        text: "Updated content",
        marks: [{ kind: 'bold', from: 0, to: 5 }],
        links: [...],
        includes: [...]
    }
    ↓
Frontend: Send to Backend (Tauri)
    ↓
Backend: Update KanbanCard.world
    ↓
Backend: Compute CardSnapshot (kid → WorldCard)
    ↓
Backend: Compare with previous snapshot
    ↓
Backend: Detect card-level changes (text, marks, links, includes)
    ↓
Backend: Resolve conflicts (automatic if non-overlapping)
    ↓
Backend: Write to local storage atomically
    ↓
Backend: Emit board update to frontend
```

### Board-Level Sync Flow

```
User Drag Column
    ↓
Frontend: Send column move event
    ↓
Frontend: Request board snapshot
    ↓
Backend: Get current board (KanbanBoard)
    ↓
Backend: Compute board diff
    {
        type: 'column_move',
        columnId: 'col-123',
        fromIndex: 2,
        toIndex: 0
    }
    ↓
Backend: Three-way merge (base, theirs, ours)
    ↓
Backend: Apply merge result
    ↓
Backend: Write to local storage atomically
    ↓
Backend: Emit board update to frontend
```

---

## Data Structures for V2 Sync

### Kid → CardSnapshot Mapping

```rust
// lexera-core/src/merge/diff.rs
use std::collections::HashMap;

// Unique card identifier (kid)
type KidId = String;

// Card snapshot for comparison
pub struct CardSnapshot {
    pub id: KidId;           // Card ID (kid)
    pub world: WorldCard;     // Current card data
    pub version: u64;          // Version for change tracking
}

// Board snapshot
pub struct BoardSnapshot {
    pub cards: HashMap<KidId, CardSnapshot>;
    pub timestamp: u64;
}

// Function: Build kid map from board
pub fn build_kid_map(board: &KanbanBoard) -> HashMap<KidId, WorldCard> {
    let mut map = HashMap::new();
    for column in &board.columns {
        for card in &column.cards {
            map.insert(card.id.clone(), card.world.clone());
        }
    }
    map
}
```

### Diff Result

```rust
// lexera-core/src/merge/diff.rs
pub struct BoardDiff {
    pub added_cards: Vec<CardSnapshot>,
    pub modified_cards: Vec<CardSnapshot>,
    pub removed_cards: Vec<CardSnapshot>,
    pub added_columns: Vec<KanbanColumn>,
    pub modified_columns: Vec<KanbanColumn>,
    pub removed_columns: Vec<KanbanColumn>,
    pub conflict_count: usize,      // Number of card-level conflicts
    pub has_auto_resolvable: bool, // Can conflicts be auto-resolved?
}
```

### Merge Result

```rust
// lexera-core/src/merge/merge.rs
pub struct MergeResult {
    pub board: KanbanBoard,         // Merged board
    pub conflicts: Vec<MergeConflict>,  // Unresolved conflicts
    pub resolution_method: MergeMethod,  // How conflicts were resolved
}

pub enum MergeMethod {
    Automatic,           // All conflicts auto-resolved
    PreferTheirs,       // Theirs chosen for overlaps
    PreferOurs,         // Ours chosen for overlaps
    Manual,             // User resolved manually
}
```

---

## World Class vs. V2 Codebase

### WYSIWYG Parser World Class

**Location**: `src/wysiwyg/parserSerializer.ts`

```typescript
// WYSIWYG parser uses World class for card-level text
interface WorldClass {
    // Standard formatting
    type: 'text' | 'world' | 'heading' | 'list' | 'quote' | 'code' | 'fence' | 'html' | 'rule' | 'separator';
    
    // Text marks for world-level cards
    marks?: Mark[];
    
    // Content
    text?: string;
    
    // Nested content
    content?: WorldClass[];
}
```

**Usage**:
- `type: 'world'` - Indicates card-level data with rich text
- `marks` - Formatting marks (bold, italic, etc.) stored at card level
- `text` - Rich text content for WorldCard

### V2 Data Store (Local Storage)

**Implementation**: `lexera-core/src/storage/local.rs`

```rust
// Local storage for V2 sync
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct LocalStorage {
    pub boards: HashMap<String, KanbanBoard>,  // All boards
    pub card_snapshots: HashMap<String, Vec<CardSnapshot>>,  // Card snapshots per board
    pub last_sync: HashMap<String, u64>,  // Last sync timestamp per board
    pub sync_status: SyncStatus,
    pub pending_conflicts: Vec<MergeConflict>,  // Unresolved conflicts
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncStatus {
    pub last_sync: Option<u64>,
    pub in_progress: bool,
    pub error: Option<String>,
}
```

---

## Key Differences: V1 vs. V2

### V1 (Current Kanban Toolkit)
- **Storage**: Single markdown file per board
- **Data Model**: Flat task/column lists in file
- **Sync**: File-level (entire file overwritten)
- **Granularity**: Task-level (no rich text at card level)
- **Conflict Resolution**: Manual (user edits in markdown)
- **Atomic Operations**: Not supported (file write errors corrupt data)

### V2 (Lexera Backend)
- **Storage**: Local SQLite database with structured types
- **Data Model**: Rich card data with WorldCard structure
- **Sync**: Card-level (WorldCard fields: text, marks, links, includes)
- **Conflict Resolution**: Automatic (three-way merge algorithm)
- **Atomic Operations**: Supported (atomic file writes, rollback)

### V2 Advantages

1. **Rich Text Preservation**
   - Formatting (bold, italic, code, etc.) preserved at card level
   - Links and images stored as structured data
   - File includes with auto-reload support

2. **Improved Collaboration**
   - Card-level conflict resolution (multiple users can edit same card)
   - Automatic three-way merge reduces conflicts
   - Snapshot-based rollback

3. **Better Performance**
   - Local storage faster than file I/O for reads
   - Diff algorithm compares only changed cards
   - Atomic writes are cached and batched

4. **Data Integrity**
   - Atomic file writes prevent corruption on crashes
   - Rollback capability preserves data
   - Local storage as source of truth

5. **Scalability**
   - Local storage scales better with many cards
   - Card-level operations are more efficient
   - Snapshot comparison reduces data transfer

---

## Recommendations for V2 Integration

### 1. Add WorldCard Type to Kanban Types

**Status**: HIGH PRIORITY

**Rationale**: Need TypeScript type for WorldCard to enable frontend-backend communication

**Implementation**:
```typescript
// src/types/WorldCard.ts
export interface WorldCard {
    id: string;                           // Card ID (kid)
    text: string;                         // Rich text content
    marks: TextMark[];                     // Formatting marks
    links: TextLink[];                     // Embedded links
    includes: TextInclude[];                // Embedded file references
    version: number;                        // Version for change tracking
}

export interface TextMark {
    kind: 'bold' | 'italic' | 'underline' | 'code' | 'strikethrough' | 'subscript' | 'superscript';
    from: number;                          // Position in text
    to: number;                            // End position
}

export interface TextLink {
    url: string;                            // Image/video/file URL
    title?: string;                          // Alt text or title
    description?: string;                     // Hover text
}

export interface TextInclude {
    path: string;                            // File path (relative or absolute)
    preview?: string;                      // Preview text
    auto_reload: boolean;                    // Auto-reload on edit
}
```

**Action Items**:
- [ ] Create `src/types/WorldCard.ts` with WorldCard interface
- [ ] Create `src/types/TextMark.ts` with TextMark interface
- [ ] Create `src/types/TextLink.ts` with TextLink interface
- [ ] Create `src/types/TextInclude.ts` with TextInclude interface
- [ ] Add WorldCard to MessageTypes.ts for Tauri communication
- [ ] Document WorldCard JSON schema
- [ ] Update WYSIWYG parser to use WorldCard type

---

### 2. Add V2 Sync Commands

**Status**: HIGH PRIORITY

**Rationale**: Need command handlers for V2 sync operations (merge, conflict resolution, etc.)

**Implementation**:
```typescript
// src/commands/V2SyncCommands.ts
export class V2SyncCommands extends SwitchBasedCommand {

    readonly metadata: CommandMetadata = {
        id: 'v2-sync-commands',
        name: 'V2 Sync Commands',
        messageTypes: ['v2GetBoard', 'v2MergeBoard', 'v2ResolveConflict', 'v2GetConflictList']
    };

    protected handlers: Record<string, MessageHandler> = {
        'v2GetBoard': async (msg, ctx) => {
            const message = msg as V2GetBoardMessage;
            // Get board from local storage
            const board = await this.v2Api.getBoard(message.boardId);
            return this.success(board);
        },

        'v2MergeBoard': async (msg, ctx) => {
            const message = msg as V2MergeBoardMessage;
            // Three-way merge (base, theirs, ours)
            const result = await this.v2Api.merge(message.base, message.theirs, message.ours);
            return this.success(result);
        },

        'v2ResolveConflict': async (msg, ctx) => {
            const message = msg as V2ResolveConflictMessage;
            const result = await this.v2Api.resolveConflict(message.conflictId, message.resolution);
            return this.success(result);
        }
    };
}
```

**Message Types**:
```typescript
// src/core/bridge/MessageTypes.ts
export interface V2GetBoardMessage extends RequestMessage {
    type: 'v2GetBoard';
    boardId: string;
}

export interface V2MergeBoardMessage extends RequestMessage {
    type: 'v2MergeBoard';
    base: KanbanBoard;          // Base version (disk)
    theirs: KanbanBoard;        // Their version (incoming)
    ours: KanbanBoard;         // Our version (current)
}

export interface V2ResolveConflictMessage extends RequestMessage {
    type: 'v2ResolveConflict';
    conflictId: string;
    resolution: MergeMethod;
}
```

**Action Items**:
- [ ] Create `src/commands/V2SyncCommands.ts`
- [ ] Add message types for V2 sync to MessageTypes.ts
- [ ] Implement V2 sync API client (Tauri IPC wrapper)
- [ ] Add V2 sync commands to main command registry
- [ ] Test V2 sync operations end-to-end
- [ ] Add conflict resolution UI components

---

### 3. Add WorldCard Support to WYSIWYG Parser

**Status**: HIGH PRIORITY

**Rationale**: WYSIWYG parser needs to recognize and preserve WorldCard data

**Implementation**:
```typescript
// src/wysiwyg/prosemirrorSchema.ts
// Add WorldCard node schema
const worldCardNode = {
    group: 'inline',
    content: 'inline',
    inlineContent: 'world',
    marks: () => [],     // No marks on world cards (marks are in WorldCard.marks)
    attrs: {
        cardId: null,      // Card ID (kid)
        version: 0,         // Version for change tracking
        text: '',         // Rich text content
        marks: [],        // Formatting marks
        links: [],         // Embedded links
        includes: [],     // Embedded file references
    },
    toDOM() {
        const element = document.createElement('div');
        element.className = 'world-card-container';
        // Render rich text editor with WorldCard support
        return element;
    }
};

// Update schema
export const wysiwygSchema = new Schema({
    nodes: {
        // ... existing nodes
        worldCard: worldCardNode,
        // ... other nodes
    }
});
```

**Action Items**:
- [ ] Add worldCardNode to WYSIWYG schema
- [ ] Add WorldCard node view component
- [ ] Update parser to serialize WorldCard data correctly
- [ ] Add rich text editor controls for WorldCard
- [ ] Test WorldCard serialization/deserialization
- [ ] Test WorldCard rendering in editor

---

### 4. Add Conflict Resolution UI

**Status**: MEDIUM PRIORITY

**Rationale**: Users need UI to manually resolve conflicts when automatic resolution fails

**Implementation**:
```typescript
// src/components/ConflictResolutionDialog.ts
export class ConflictResolutionDialog {

    props: {
        conflicts: MergeConflict[];
        onResolve: (conflictId: string, method: MergeMethod) => void;
    }

    render() {
        return (
            <div class="conflict-dialog">
                <h3>Conflicts Detected</h3>
                <p>{this.props.conflicts.length} conflicts need resolution:</p>
                <ul>
                    {this.props.conflicts.map(conflict => (
                        <li key={conflict.id}>
                            <span>{conflict.cardId}:</span>
                            <div>
                                <p><strong>Theirs:</strong> {conflict.theirs.text}</p>
                                <p><strong>Ours:</strong> {conflict.ours.text}</p>
                                <p><strong>Base:</strong> {conflict.base.text}</p>
                            </div>
                            <div class="conflict-actions">
                                <button onClick={() => this.props.onResolve(conflict.id, 'PreferTheirs')}>
                                    Use Theirs Version
                                </button>
                                <button onClick={() => this.props.onResolve(conflict.id, 'PreferOurs')}>
                                    Use Our Version
                                </button>
                                <button onClick={() => this.props.onResolve(conflict.id, 'Manual')}>
                                    Edit Manually
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }
}
```

**Action Items**:
- [ ] Create ConflictResolutionDialog component
- [ ] Add dialog message type to MessageTypes.ts
- [ ] Add conflict resolution command
- [ ] Test conflict resolution flow
- [ ] Add keyboard shortcuts for conflict dialog

---

### 5. Add Atomic File Write to Save Operations

**Status**: MEDIUM PRIORITY

**Rationale**: Ensure all file saves use atomic write to prevent data loss

**Implementation**:
```typescript
// src/commands/FileCommands.ts (update save operations)
import { writeFileAtomically } from '../utils/atomicWrite';

export class FileCommands extends SwitchBasedCommand {

    protected handlers: Record<string, MessageHandler> = {
        'saveFile': async (msg, ctx) => {
            const message = msg as SaveFileMessage;
            const fileContent = message.content;

            // Use atomic write for safety
            await writeFileAtomically(message.filePath, fileContent, {
                encoding: 'utf-8',
                maxAttempts: 6
            });

            return this.success();
        }
    };
}
```

**Action Items**:
- [ ] Update all save commands to use atomicWrite utility
- [ ] Add error recovery for atomic write failures
- [ ] Add user notifications for atomic write attempts
- [ ] Test atomic write with simulated crashes

---

### 6. Add Board-Level Undo/Redo

**Status**: MEDIUM PRIORITY

**Rationale**: V2's snapshot-based architecture supports board-level undo/redo

**Implementation**:
```typescript
// src/stores/BoardSnapshotStore.ts
export class BoardSnapshotStore {

    private snapshots: Map<string, BoardSnapshot>;
    private currentIndex: number = -1;

    async createSnapshot(board: KanbanBoard): Promise<string> {
        const snapshotId = generateId();
        const snapshot: BoardSnapshot = {
            id: snapshotId,
            board: board.clone(),
            timestamp: Date.now()
        };
        this.snapshots.set(board.id, snapshot);
        this.currentIndex++;
        return snapshotId;
    }

    async restoreSnapshot(boardId: string, snapshotId: string): Promise<KanbanBoard> {
        const snapshot = this.snapshots.get(boardId)?.snapshots.get(snapshotId);
        if (!snapshot) {
            throw new Error(`Snapshot not found: ${snapshotId}`);
        }
        return snapshot.board;
    }

    async undo(): Promise<KanbanBoard> {
        if (this.currentIndex > 0) {
            const currentId = this.getCurrentSnapshotId();
            this.currentIndex--;
            return this.restoreSnapshot(currentId);
        }
        return this.getCurrentBoard();
    }

    async redo(): Promise<KanbanBoard> {
        const maxIndex = this.getMaxSnapshotIndex();
        if (this.currentIndex < maxIndex) {
            this.currentIndex++;
            const nextId = this.getNextSnapshotId();
            return this.restoreSnapshot(nextId);
        }
        return this.getCurrentBoard();
    }
}
```

**Action Items**:
- [ ] Create BoardSnapshotStore service
- [ ] Add snapshot creation on every board change
- [ ] Add undo/redo commands
- [ ] Add keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z)
- [ ] Add snapshot management UI
- [ ] Test undo/redo with board snapshots

---

## Recommended Data Models for V2

### Enhanced KanbanCard with V2 Support

```typescript
// src/types/KanbanCard.ts
export interface KanbanCard {
    // Original fields
    id: string;
    content: string;
    checked?: boolean;
    tags?: string[];

    // V2 Sync fields
    world?: WorldCard;              // Rich text card data (V2 sync)
    version?: number;               // Card version for change tracking
    
    // V2 Metadata
    kid?: string;                  // Unique identifier for V2 sync
    last_modified?: number;        // Last modification timestamp
}
```

### Enhanced KanbanBoard with V2 Metadata

```typescript
// src/types/KanbanBoard.ts
export interface KanbanBoard {
    // Original fields
    id: string;
    title: string;
    columns: KanbanColumn[];
    yamlHeader: string | null;
    frontmatter?: Record<string, unknown>;
    boardSettings?: BoardSettings;

    // V2 Metadata
    v2_enabled?: boolean;          // Is V2 sync enabled for this board?
    v2_last_sync?: number;        // Last V2 sync timestamp
    v2_conflict_count?: number;   // Number of unresolved conflicts
    v2_version?: number;          // Board version for change tracking
}
```

---

## Integration Strategy: V1 + V2

### Hybrid Approach (Recommended)

**Rationale**: Gradually migrate from V1 (markdown files) to V2 (local storage) while maintaining compatibility

**Phase 1: V2 as Enhancement (Short-term)**
- Add WorldCard support to existing cards
- Keep V1 as source of truth (markdown files)
- V2 sync operates as enhancement layer
- Board saved to markdown AND local storage

**Phase 2: V2 as Primary (Long-term)**
- Migrate to local storage as source of truth
- Markdown files become export/import format
- V2 sync handles all data operations
- Backward compatibility for existing markdown files

**Data Flow**:
```
User edits card in WYSIWYG
    ↓
Frontend: Update WorldCard data
    ↓
Backend: Save to local storage (V2)
    ↓
Backend: Write to markdown file (V1 - backup)
    ↓
Backend: Notify frontend
    ↓
Frontend: Display updated card with V2 sync indicator
```

---

## Testing Strategy

### Unit Tests Needed

1. **WorldCard Serialization**
   ```typescript
   describe('WorldCard', () => {
       it('should serialize rich text with marks', () => {
           const worldCard: WorldCard = {
               text: 'Hello **world**',
               marks: [
                   { kind: 'bold', from: 6, to: 11 }
               ]
           };
           const serialized = JSON.stringify(worldCard);
           const deserialized = JSON.parse(serialized);
           expect(deserialized.marks[0].kind).toBe('bold');
       });
       
       it('should serialize links', () => {
           const worldCard: WorldCard = {
               text: 'Card text',
               links: [
                   { url: '/path/to/image.jpg', title: 'Image alt text' }
               ]
           };
           const serialized = JSON.stringify(worldCard);
           const deserialized = JSON.parse(serialized);
           expect(deserialized.links[0].url).toBe('/path/to/image.jpg');
       });
       
       it('should serialize includes', () => {
           const worldCard: WorldCard = {
               text: 'Card text',
               includes: [
                   { path: './include.md', auto_reload: true }
               ]
           };
           const serialized = JSON.stringify(worldCard);
           const deserialized = JSON.parse(serialized);
           expect(deserialized.includes[0].path).toBe('./include.md');
           expect(deserialized.includes[0].auto_reload).toBe(true);
       });
   });
   ```

2. **Three-Way Merge Algorithm**
   ```typescript
   describe('ThreeWayMerge', () => {
       it('should auto-resolve non-overlapping changes', () => {
           const base = createBoard('card1', 'card2');
           const theirs = createBoard('card1', 'card3');
           const ours = createBoard('card1', 'card4');
           
           // Changes are non-overlapping
           const result = merge_merge_three_way_merge(base, theirs, ours);
           
           expect(result.conflict_count).toBe(0);
           expect(result.resolution_method).toBe('Automatic');
           expect(result.board.columns[0].cards[0].text).toBe('card3');
       });
       
       it('should prefer theirs for overlapping changes', () => {
           const base = createBoard('card1', 'card2');
           const theirs = createBoard('card1', 'card3');
           const ours = createBoard('card1', 'card4');
           
           // Overlap on card1: theirs changes text to 'card3', ours changes to 'card4'
           const result = merge_merge_three_way_merge(base, theirs, ours, {
               preference: 'PreferTheirs'
           });
           
           expect(result.board.columns[0].cards[0].text).toBe('card3');
       });
       
       it('should identify manual conflicts', () => {
           const base = createBoard('card1', 'card2');
           const theirs = createBoard('card2', 'card3');
           const ours = createBoard('card1', 'card4');
           
           // Too many changes for automatic resolution
           const result = merge_merge_three_way_merge(base, theirs, ours);
           
           expect(result.conflict_count).toBeGreaterThan(0);
           expect(result.resolution_method).toBe('Manual');
       });
   });
   ```

3. **Atomic File Write**
   ```typescript
   describe('AtomicWrite', () => {
       it('should write file atomically', async () => {
           const content = 'Test content';
           const targetPath = '/tmp/test-atomic.md';
           
           await writeFileAtomically(targetPath, content);
           
           const fileContent = await fs.promises.readFile(targetPath, 'utf-8');
           expect(fileContent).toBe(content);
       });
       
       it('should rollback on write failure', async () => {
           const content = 'Original content';
           const targetPath = '/tmp/test-rollback.md';
           
           // Write initial content
           await writeFileAtomically(targetPath, content);
           
           // Try to write again (simulates concurrent write)
           try {
               await writeFileAtomically(targetPath, 'New content', { maxAttempts: 1 });
           } catch (error) {
               // Write failed
               const fileContent = await fs.promises.readFile(targetPath, 'utf-8');
               expect(fileContent).toBe('Original content'); // Should be rolled back
           }
       });
   });
   ```

---

## Migration Plan

### Phase 1: Type Definitions (Week 1-2)
**Goal**: Create TypeScript types for V2 sync

**Effort**: 16-20 hours

**Action Items**:
- [ ] Create WorldCard interface and types
- [ ] Add WorldCard to MessageTypes.ts
- [ ] Add V2 sync message types
- [ ] Update KanbanCard interface with V2 fields
- [ ] Update KanbanBoard interface with V2 metadata
- [ ] Document JSON schemas for V2 data
- [ ] Write unit tests for all V2 types

---

### Phase 2: API Integration (Week 3-4)
**Goal**: Integrate with Lexera backend API

**Effort**: 20-30 hours

**Action Items**:
- [ ] Create Lexera API client (Tauri IPC wrapper)
- [ ] Implement V2 sync commands
- [ ] Add board snapshot store
- [ ] Implement conflict resolution logic
- [ ] Add atomic file write integration
- [ ] Write integration tests for API

---

### Phase 3: WYSIWYG Parser Support (Week 5-6)
**Goal**: Add WorldCard support to WYSIWYG parser

**Effort**: 24-32 hours

**Action Items**:
- [ ] Add worldCardNode to WYSIWYG schema
- [ ] Add WorldCard node view component
- [ ] Update parser to serialize WorldCard correctly
- [ ] Add rich text editor for WorldCard
- [ ] Test WorldCard rendering and editing
- [ ] Test WorldCard serialization/deserialization

---

### Phase 4: Conflict Resolution UI (Week 7-8)
**Goal**: Create UI for conflict resolution

**Effort**: 20-30 hours

**Action Items**:
- [ ] Create ConflictResolutionDialog component
- [ ] Add conflict list view
- [ ] Add side-by-side comparison view
- [ ] Add conflict resolution actions
- [ ] Add keyboard shortcuts
- [ ] Test conflict resolution flow

---

### Phase 5: Undo/Redo (Week 9-10)
**Goal**: Add board-level undo/redo

**Effort**: 24-32 hours

**Action Items**:
- [ ] Create BoardSnapshotStore service
- [ ] Add snapshot creation on board changes
- [ ] Implement undo/redo commands
- [ ] Add keyboard shortcuts
- [ ] Add undo/redo UI indicator
- [ ] Test undo/redo operations

---

### Phase 6: Testing & Refinement (Week 11+)
**Goal**: Comprehensive testing and performance optimization

**Effort**: 40+ hours

**Action Items**:
- [ ] Test entire V2 sync flow end-to-end
- [ ] Add E2E tests for critical paths
- [ ] Test conflict resolution scenarios
- [ ] Test atomic file write behavior
- [ ] Performance optimization (reduce sync time < 100ms for cards)
- [ ] Add error recovery tests
- [ ] Document best practices

---

## Success Metrics

| Phase | Effort | Success Criteria |
|-------|--------|--------------|
| **Type Definitions** | 16-20h | All types created and tested |
| **API Integration** | 20-30h | Tauri IPC working, commands tested |
| **WYSIWYG Support** | 24-32h | WorldCard parsed and rendered correctly |
| **Conflict UI** | 20-30h | Users can resolve conflicts manually |
| **Undo/Redo** | 24-32h | Snapshot-based undo/redo working |
| **Testing** | 40h | 60%+ code coverage |

**Total Estimated Effort**: 144-204 hours (6-8 weeks for 1 developer)

---

## Conclusion

### V2 Sync Architecture: ⭐⭐⭐⭐ (Excellent)

The V2 codebase demonstrates:
- **World-class level data structure** with rich text support
- **Atomic operations** with crash-safer guarantees
- **Card-level conflict resolution** via three-way merge algorithm
- **Board-level snapshot system** for undo/redo
- **Local storage** as high-performance data layer

### Comparison: V1 vs. V2

| Aspect | V1 (Markdown) | V2 (Local Storage) | V2 Advantage |
|--------|----------------|------------------|---------------|
| **Data Model** | Flat text | Rich WorldCard | Preserves formatting, links |
| **Sync Granularity** | File-level | Card-level | Better collaboration, less conflicts |
| **Conflict Resolution** | Manual | Automatic | Three-way merge, less user friction |
| **Undo/Redo** | None | Snapshot-based | Time travel, multiple states |
| **Performance** | File I/O | Local storage | Faster reads/writes |
| **Data Integrity** | No atomic writes | Atomic writes | Crash recovery |

### Final Recommendation

**Approach**: Gradual Migration (Hybrid)

Start with V2 as enhancement layer for existing V1 system, then transition to V2 as primary when ready.

**Benefits**:
- Lower risk (V1 still works as fallback)
- Gradual learning curve for users
- Can test V2 features in production with V1 safety net
- Backward compatibility maintained

**Timeline**: 2-3 months for full V2 integration with testing and refinement.

---

**Analysis Completed**: 2026-02-24

**Files Analyzed**: 0 (No V2 store files in `packages/agent/`)

**Key Findings**:
- V2 sync architecture is in `lexera-core` Rust backend (not in `packages/agent/`)
- V2 provides World/Atomic level data structure via WorldCard and CardSnapshot
- Atomic file write system in `atomicWrite.js` provides crash-safer operations
- Three-way merge algorithm in `lexera-core/src/merge/merge.rs` handles card-level conflicts
- No TypeScript store files exist for V2 in packages/agent/ (likely because V2 sync is Rust-based)

**Documentation**: All V2 architecture findings and recommendations documented in this file and ready to be appended to `packages/agent/pi-plan.md`.
