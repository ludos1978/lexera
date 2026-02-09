# TODOs - File Manager & Saving System

**Last verified: 2026-02-09**
**Data duplication check: 2026-02-09**
**Confidence Level: 95%**

---

## STATUS: PRODUCTION-READY

The saving system is robust with all critical safety mechanisms in place:

| Mechanism | Status |
|-----------|--------|
| Atomic writes (temp + fsync + rename) | ✅ 6 retries |
| Post-write verification | ✅ 5 retries, 120ms delays |
| Round-trip validation | ✅ `_validateGeneratedMarkdownRoundTrip()` |
| Global file mutex | ✅ `FileSaveService._globalSaveLocks` |
| Board validation & snapshot | ✅ `_assertBoardSnapshotIsSaveable()` + `_cloneBoardForSave()` |
| Include path re-resolution | ✅ `_ensureAbsolutePathCurrent()` |
| Self-save marker TTL | ✅ 10 seconds |
| Emergency backups | ✅ Managed → temp fallback |

---

## REMAINING ITEMS

### P1: IncludeFile applyEditToBaseline Inconsistency
**Location:** `IncludeFile.ts:286-288`
**Issue:** Sets BOTH `_content` AND `_baseline` to same value
**Comparison:** `MainKanbanFile.ts:167` only updates `_content` (correct pattern)
**Impact:** Include file edits immediately appear "saved" - `hasUnsavedChanges()` returns false
**Note:** May be intentional for conflict resolution workflow - needs review

### P2: Frontend Board State Triplication
**Location:** `webview.js`
**Copies:**
- `window.cachedBoard` - current state
- `window.savedBoardState` - for unsaved detection
- `window.currentBoard` - alias getter
**Issue:** Pending column changes only sync to `cachedBoard`, not `savedBoardState`
**Impact:** Inconsistent unsaved change detection

### P3: Permission Error Semantics
**Location:** `IncludeFile.ts:148-157`
**Issue:** `_exists` flag only updates for ENOENT
**Mitigation:** Errors tracked via `_lastAccessErrorCode`

### P3: Configuration Edge Cases
- Backup location not validated at config time
- Temp directory could be read-only

---

## REFACTORING OPPORTUNITIES

### 1. Remove Legacy Alias Getters
`PanelContext.ts` has 3 getters for the same `_documentUri`:
```typescript
get lastDocumentUri()
get trackedDocumentUri()
get documentUri()
```
**Action:** Consolidate to single `documentUri` getter.

### 2. File Registry Triple Index
`MarkdownFileRegistry.ts` has 3 indexes for same files:
```typescript
_files: Map<string, MarkdownFile>           // by absolute path
_filesByRelativePath: Map<string, MarkdownFile>  // by relative path
_registrationCache: Set<string>             // for fast lookup
```
**Risk:** File moves may not update all indexes
**Mitigation:** `getConsistencyReport()` exists for validation

### 3. Frontend savedBoardState Sync
`webview.js` has separate `cachedBoard` and `savedBoardState`
**Action:** Consider merging or ensuring all mutations sync both

---

## KEY FILES

| File | Purpose |
|------|---------|
| `MarkdownFile.ts` | Base class: atomic saves, verification, self-save markers |
| `MainKanbanFile.ts` | Round-trip validation, board snapshot, validation |
| `IncludeFile.ts` | Dynamic path resolution, error recording |
| `FileSaveService.ts` | Global file mutex |
| `atomicWrite.ts` | Atomic write with 6 retries |

---

## VERIFICATION SUMMARY

All originally reported P0 issues were **already fixed** in the codebase:
- ✅ Round-trip markdown validation exists
- ✅ Global file mutex exists
- ✅ Board validated before save
- ✅ Include paths re-resolved dynamically
- ✅ Self-save TTL is 10s (not 5s)
- ✅ No problematic error swallowing patterns

**No critical refactoring required.** The system is well-architected.
