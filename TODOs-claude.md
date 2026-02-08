# TODOs - File Manager Refactoring

Analysis date: 2026-02-08

## Quick Wins (Low Risk)

### 1. Consolidate Dual Registries
**Files:** `src/files/MarkdownFileRegistry.ts`
**Current:** Two Maps - `_files` (absolute path) + `_filesByRelativePath` (normalized)
**Problem:** Both must stay in sync, doubling maintenance burden, potential sync bugs
**Solution:** Keep only normalized-path registry, add `getAbsolutePath(normalizedPath)` method
**Impact:** ~150 lines removed, eliminates sync bugs

### 2. Merge Operation Coordinators
**Files:** `src/files/WatcherCoordinator.ts`, `src/files/SaveTransactionManager.ts`, `src/core/FileSaveService.ts`
**Current:** Three separate systems for coordinating concurrent operations
**Problem:** Redundant coordination logic scattered across files
**Solution:** Merge into single `OperationCoordinator` class
**Impact:** ~50 lines removed, clearer concurrency model

### 3. Unify Edit Mode Capture
**Files:** `src/files/MarkdownFile.ts`
**Current:** Multiple conditional branches in `_onFileSystemChange()`
**Solution:** Single path: `requestStopEditing()` → capture → apply to baseline
**Impact:** Simpler change handling, fewer edge cases

---

## Medium Complexity

### 4. Single Board Source of Truth
**Files:** `src/files/MainKanbanFile.ts`, `src/core/stores/BoardStore.ts`
**Current:** Board cached in 3 places:
  - `_board` in MainKanbanFile
  - `_cachedBoardFromWebview` for conflict detection
  - `board` in BoardStore (panel context)
**Problem:** Three sources of truth, potential sync issues
**Solution:** Store board only in `BoardStore`, MainKanbanFile generates on demand from content
**Impact:** Eliminates `_cachedBoardFromWebview`, clearer data flow

### 5. Simplify Include File Registration
**Files:** `src/files/MarkdownFileRegistry.ts`, `src/panel/IncludeFileCoordinator.ts`
**Current:**
  - `ensureIncludeRegistered()`: 63 lines with multiple lookups
  - `ensureIncludeFileRegistered()`: Separate lazy method
  - Two different lazy registration approaches
**Problem:** High cognitive load, multiple lookup strategies
**Solution:** Single method: `ensureIncludeFile(relativePath, fileType, mainFile)`
  - Always check disk first (handles new files)
  - Clear contract, single entry point
**Impact:** Reduced complexity, easier to understand

### 6. Add Detailed Error Reporting
**Files:** `src/files/IncludeFile.ts`, `src/files/MarkdownFileRegistry.ts`
**Current:** `includeError` boolean flag with no details
**Problem:** User sees generic "error" badge with no context
**Solution:**
  - Add `getRegistrationError(): string | null` to IncludeFile
  - Store error details instead of just boolean flag
  - Frontend shows meaningful error messages
**Impact:** Better UX, easier debugging

---

## High Impact (Larger Refactors)

### 7. Unified Conflict Detection
**Files:** `src/files/MarkdownFile.ts`, `src/kanbanFileService.ts`
**Current:**
  - `hasConflict()` in MarkdownFile
  - `_handlePresaveConflictCheck()` in KanbanFileService
  - Separate "external change" vs "unsaved changes" tracking
**Problem:** Multiple paths to conflict detection, duplicated logic
**Solution:** Single `checkForConflict()` returning detailed reason enum
  - Used by both edit-mode and pre-save paths
  - Eliminates branching logic
**Impact:** Single conflict detection source of truth

### 8. Reduce Change Handling Indirection
**Files:** Multiple (change handling flow)
**Current:** 5 layers of indirection:
  File watchers → `_onFileSystemChange()` → `UnifiedChangeHandler.handleExternalChange()` → `requestStopEditing()` → `MarkdownFileRegistry.requestStopEditing()` → MessageHandler
**Problem:** Hard to trace execution, difficult to debug
**Solution:** Direct callbacks for common paths, remove MessageHandler interface
**Impact:** Reduced indirection from 5 layers to 2

---

## Potential Issues to Address

### Race Conditions (Medium Risk)
1. **Board generation during include registration** - `kanbanFileService.ts:269-341`
   - Board set, then includes registered, then update sent
   - Include registration may modify board between steps
   - Risk: Frontend receives stale board data

2. **Edit mode capture race** - `MarkdownFile.ts`
   - Async window where file might change again before capture completes

### Error Handling Gaps
1. **Lazy registration errors swallowed** - `MarkdownFileRegistry.ts`
   - `setTimeout` with no error reporting
   - Errors caught but not surfaced to user

2. **Pre-save conflict dialog failure** - `kanbanFileService.ts:854-895`
   - If `ConflictDialogBridge` fails, whole save aborts
   - No fallback to simple save without dialog

### Data Loss Vulnerabilities (Low Risk)
1. **Orphan include cleanup** - `MarkdownFileRegistry.ts`
   - `unregisterOrphanedIncludes()` removes files no longer in board
   - Risk: File temporarily hidden but user expects it available

2. **Emergency backup in temp dir** - `MarkdownFile.ts:685-695`
   - Falls back to OS temp directory if managed backup fails
   - Risk: Temp files might be cleaned up by OS

---

## Key Files Reference

| File | Lines | Purpose |
|------|-------|---------|
| `src/files/MarkdownFile.ts` | 1,142 | Base file class |
| `src/files/MainKanbanFile.ts` | 368 | Main kanban file |
| `src/files/IncludeFile.ts` | 315 | Include file implementation |
| `src/files/MarkdownFileRegistry.ts` | 770 | Central registry |
| `src/files/FileFactory.ts` | 153 | File creation |
| `src/files/WatcherCoordinator.ts` | 122 | Operation queueing |
| `src/files/SaveTransactionManager.ts` | 110 | Transaction tracking |
| `src/kanbanFileService.ts` | 1,142 | High-level orchestration |
| `src/core/FileSaveService.ts` | 104 | Unified save entry |
| `src/panel/IncludeFileCoordinator.ts` | 458 | Include lifecycle |
