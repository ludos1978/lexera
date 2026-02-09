# TODOs - File Manager & Saving System

**Last verified: 2026-02-09**
**Confidence Level: 98%**

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

## REMAINING ITEMS (Low Priority)

### P1: Permission Error Semantics
**Location:** `IncludeFile.ts:148-157`
**Issue:** `_exists` flag only updates for ENOENT, not EACCES/EPERM
**Mitigation:** Errors ARE tracked via `_lastAccessErrorCode`
**Optional:** Add `_accessible` flag for semantic clarity

### P3: Configuration Edge Cases
- Backup location not validated at config time
- Temp directory could be read-only (no fallback)

---

## REFACTORING OPPORTUNITIES

### 1. Simplify Board State (7 → fewer locations)
Current board state exists in 7 locations:
```
Backend: _content, _baseline, _board, _cachedBoardFromWebview
Frontend: BoardStore._state.board, window.cachedBoard
Transient: generateBoard() output
```
**Consideration:** The duplication is intentional (backend/frontend sync) and now validated at boundaries. No action needed unless complexity causes issues.

### 2. Remove Legacy Alias Getters
`PanelContext.ts` has 3 getters for the same `_documentUri`:
```typescript
get lastDocumentUri()
get trackedDocumentUri()
get documentUri()
```
**Action:** Could consolidate to single `documentUri` getter and update call sites.

### 3. Consolidate TimeoutConstants
All timeouts are already centralized in `src/constants/TimeoutConstants.ts`. Well organized.

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
