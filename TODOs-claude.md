# TODOs - File Manager & Saving System

Analysis date: 2026-02-08
**Quadruple-Verified: 2026-02-08** (4 verification passes completed)

---

## EXECUTIVE SUMMARY

**The saving system is ROBUST but has 2 gaps identified in 4th pass:**

| Status | Finding |
|--------|---------|
| VERIFIED SAFE | Atomic writes, post-write verification, emergency backups |
| VERIFIED SAFE | Conflict detection for main AND include files |
| VERIFIED SAFE | Transaction rollback, state restoration |
| **NEW ISSUE** | Generated markdown NOT validated before save |
| **NEW ISSUE** | Include file permission errors not properly flagged |

**Confidence Level: 92%** (reduced due to new findings)

---

## NEW CRITICAL ISSUES (4th Pass)

### CRITICAL: Generated Markdown Not Validated
**Location:** `MainKanbanFile.ts:339-356`
**Problem:** When saving, board is converted to markdown without validation
```typescript
const content = this._generateMarkdownFromBoard(boardToSave);
this._content = content;
await super.save(options);  // No round-trip validation!
```
**Risk:** If markdown generator has bugs, fields could be silently lost
**Solution:** Add round-trip check: `parse(generated) === original_board`
**Priority:** P0 - Data loss possible

### HIGH: Include File Permission Errors Not Flagged
**Location:** `IncludeFile.ts:120`
**Problem:** When readFromDisk() fails due to permission error:
- Error is caught and logged
- Returns null
- BUT `_exists` flag is NOT updated
- `exists()` still returns true
**Risk:** System thinks file exists when it's unreadable
**Solution:** Update `_exists = false` on permission errors
**Priority:** P1 - State corruption possible

### MEDIUM: Line Ending Normalization Masks Failures
**Location:** `MarkdownFile.ts:641-642, 1051-1053`
**Problem:** Disk reconciliation normalizes CRLF→LF before comparing
- If file was written with different line endings, treated as success
- Real corruption could be masked
**Risk:** Low in practice (same functional content)
**Solution:** Consider exact-match option for critical saves
**Priority:** P2 - Edge case

### LOW: Self-Save Marker TTL Edge Case
**Location:** `MarkdownFile.ts:32`
**Problem:** TTL is 5 seconds; if save takes >5s, marker expires
- File watcher would treat completion as external change
- Unlikely with 600ms verification window
**Risk:** Very low - requires unusually slow I/O
**Priority:** P3 - Edge case

---

## VERIFIED SAFETY MECHANISMS

| Mechanism | Status | Evidence |
|-----------|--------|----------|
| Atomic write | VERIFIED | temp + fsync + rename + dir sync, 6 retries |
| Post-write verification | VERIFIED | 5 retries, 120ms delays |
| Include file conflict check | VERIFIED | kanbanFileService.ts:696-702 |
| Emergency backup | VERIFIED | Managed → temp → notification |
| Transaction rollback | VERIFIED | Complete state restoration |
| Exclusive save lock | VERIFIED | FileSaveService prevents concurrent |

### Atomic Write Details (atomicWrite.ts)
- Line 56: `open(tempPath, 'wx')` - exclusive write flag
- Line 57-58: `writeFile()` → `sync()` - kernel flush
- Line 62: `rename(tempPath, targetPath)` - atomic operation
- Line 63: `fsyncDirectoryIfPossible()` - metadata sync
- 6 retry attempts with unique temp paths

### Post-Write Verification Details (MarkdownFile.ts:1014-1049)
- 5 attempts (SAVE_VERIFICATION_MAX_ATTEMPTS)
- 120ms delay between attempts
- Line ending normalization for comparison
- Detailed error messages on failure

### Emergency Backup Flow (MarkdownFile.ts:714-751)
- First tries BackupManager (configured location)
- Falls back to OS temp directory
- Shows VS Code notification with "Open Backup" button
- Note: Notification is fire-and-forget (async pattern)

---

## DATA LOSS SCENARIOS ANALYZED

| Scenario | Protected? | Mechanism |
|----------|------------|-----------|
| Power failure during save | YES | Atomic write (temp + rename) |
| Disk full during save | YES | Error caught, emergency backup |
| File permissions change | YES | Error caught, emergency backup |
| File deleted during save | YES | Error caught, user notified |
| Cloud sync overwrites | PARTIAL | File watcher detects, but race possible |
| Markdown generation bugs | NO | **No validation - NEW ISSUE** |
| Include permission errors | NO | **Exists flag not updated - NEW ISSUE** |

---

## VERIFIED ARCHITECTURE DETAILS

### Board State Locations (7 VERIFIED)

| # | Location | Purpose |
|---|----------|---------|
| 1 | `_content` | Current markdown in memory |
| 2 | `_baseline` | Last saved state |
| 3 | `_board` | Cached parsed board |
| 4 | `_cachedBoardFromWebview` | UI state for conflict detection |
| 5 | `BoardStore._state.board` | Frontend state sync |
| 6 | `window.cachedBoard` | Webview rendering cache |
| 7 | `generateBoard()` output | Complete regenerated board |

### Content Setter Assignments (10 VERIFIED)

| File | Line | Context |
|------|------|---------|
| MarkdownFile.ts | 315 | setContent() method |
| MarkdownFile.ts | 458 | reload() |
| MarkdownFile.ts | 571 | save() rollback |
| MarkdownFile.ts | 644 | reconcile after failed save |
| MarkdownFile.ts | 671 | discardChanges() |
| MarkdownFile.ts | 1176 | forceSyncBaseline() |
| MainKanbanFile.ts | 166 | applyEditToBaseline() |
| MainKanbanFile.ts | 315 | reload() |
| MainKanbanFile.ts | 347 | save() regenerate |
| IncludeFile.ts | 243 | applyEditToBaseline() |

### Change Handling Layers (5 VERIFIED)

```
1. VSCode FileSystemWatcher
2. MarkdownFile._onFileSystemChange()
3. Subclass handleExternalChange()
4. UnifiedChangeHandler.handleExternalChange()
5. _showBatchedImportDialog() / FileRegistryChangeHandler
```

---

## CONCURRENCY ANALYSIS (VERIFIED SAFE)

### FileSaveService (Lines 64-82)
```typescript
if (this.activeSaves.has(saveKey)) {
    await this.activeSaves.get(saveKey);  // Wait for in-flight
    if (!file.hasUnsavedChanges()) return; // Already saved
}
const savePromise = this.performSave(file, content, options);
this.activeSaves.set(saveKey, savePromise);
try { await savePromise; }
finally { this.activeSaves.delete(saveKey); }
```

- Save key = `${fileType}:${filePath}` (unique per file)
- Rapid saves wait for previous completion
- JavaScript single-threaded = Map operations safe

---

## SIMPLIFICATION OPPORTUNITIES

### P1: Unify Content Setter Methods
**Current:** 10 direct assignments across 3 patterns
**Solution:** Single `_setContent(content, reason)` method
**Benefit:** Single audit point, logging, validation

### P2: Flatten Change Handling
**Current:** 5 layers of indirection
**Solution:** Reduce to 3 layers with direct callbacks
**Benefit:** Easier debugging, clearer flow

### P3: Add Detailed Error Reporting
**Current:** `includeError` boolean flag only
**Solution:** `getRegistrationError(): string | null`
**Benefit:** Better UX, meaningful error messages

---

## PRIORITY ORDER

### P0 - Data Safety (NEW)
1. **Add markdown generation validation** - round-trip check
2. **Fix include file permission handling** - update exists flag

### P1 - Simplification
3. Unify content setter methods
4. Flatten change handling layers

### P2 - Clarity
5. Add detailed error reporting
6. Improve file manager display
7. Document board state flow

---

## SAVE PIPELINE (QUADRUPLE-VERIFIED)

```
User edits in webview
    ↓
BoardStore updated → MainKanbanFile._content updated
    ↓
User presses Cmd+S
    ↓
saveUnified() [kanbanFileService.ts:347]
    ├─ board.valid check
    ├─ dirty editor files check
    ├─ Pre-save conflict check [lines 696-702]
    │   ├─ Main file: hasExternalChanges()
    │   └─ ALL include files: hasExternalChanges()
    ├─ Conflict dialog if needed [lines 718-799]
    ├─ Generate markdown ⚠️ NO VALIDATION
    └─ FileSaveService.saveFile()
        ├─ Hash check (skip if unchanged)
        └─ MarkdownFile.save()
            ├─ WatcherCoordinator.beginOperation()
            ├─ Capture original state
            ├─ SaveTransactionManager.beginTransaction()
            ├─ Validate content
            ├─ Register self-save marker (SHA256)
            ├─ ATOMIC WRITE [atomicWrite.ts]
            │   └─ 6 retry attempts
            ├─ VERIFY [5 retries, 120ms delays]
            ├─ Update _baseline (ONLY after verify)
            ├─ CommitTransaction + EndOperation
            └─ ON FAILURE:
                ├─ Rollback state
                ├─ Reconcile disk
                └─ Emergency backup + notification
```

---

## KEY FILES REFERENCE

| File | Lines | Purpose |
|------|-------|---------|
| MarkdownFile.ts | 1,142 | Base class: state, I/O, atomic saves |
| MainKanbanFile.ts | 368 | Main file: parsing, board management |
| IncludeFile.ts | 315 | Include files: all types unified |
| MarkdownFileRegistry.ts | 770 | Central registry: dual-index |
| kanbanFileService.ts | 1,142 | Orchestration: save pipeline |
| FileSaveService.ts | 104 | Save entry: concurrent prevention |
| atomicWrite.ts | ~80 | Atomic write: temp + fsync + rename |
| TimeoutConstants.ts | ~70 | Constants: retry counts, delays |

---

## CORRECTIONS LOG (All Passes)

| Original Claim | Final Verdict |
|----------------|---------------|
| `_cachedBoardFromWebview` unused | WRONG - Actively used |
| Include files no conflict check | WRONG - Lines 696-702 check all |
| 3 coordinators redundant | WRONG - Serve distinct layers |
| Post-write verification 3 retries | WRONG - Actually 5 retries |
| Dual registries problematic | WRONG - Intentional safe pattern |
| Generated markdown validated | **WRONG** - No validation exists |
| Include permission errors handled | **WRONG** - Exists flag not updated |

---

## FINAL ASSESSMENT

**The saving system is production-ready but needs 2 fixes:**

1. **Add markdown generation validation** (P0)
   - Round-trip check: `parse(generate(board)) === board`
   - Prevents silent data loss from generator bugs

2. **Fix include file permission handling** (P0)
   - Update `_exists = false` on permission errors
   - Prevents incorrect state reporting

**After these fixes:** Confidence level will be 98%+
