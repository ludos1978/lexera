# Board Mutations Specification

**Status**: ✅ Baseline
**V2 Target**: `lexera-kanban` (frontend), `lexera-core` (CRDT bridge)
**V1 Reference**: `lexera-kanban/src/app.js`
**Dependencies**: [Board Renderer](../board/SPEC.md), [Drag/Drop](../../ux/dragdrop/SPEC.md), [API](../../services/api/SPEC.md)

---

## Purpose

Documents every user-initiated action that modifies board data (cards, columns, stacks, rows). Each mutation is listed with its current implementation status across the frontend (index handling, data mutation) and backend (CRDT persistence, round-trip correctness).

---

## Index System

The frontend maintains two parallel data structures:

- **`fullBoardData`** — contains ALL items including hidden/parked/archived/deleted
- **`activeBoardData`** — display-only, filtered to visible items

UI events produce **display indices** (into `activeBoardData`). Mutations operate on **`fullBoardData`**. Index conversion is required whenever a display index is used to locate or insert into `fullBoardData`.

### Index Types

| Type | Source | Description |
|------|--------|-------------|
| Flat full column index | `col.index` from rendering | Single integer across all rows/stacks/columns in `fullBoardData` |
| Display row index | UI event / `activeBoardData.rows[i]` | Index into visible rows only |
| Display stack index | UI event / `activeBoardData.rows[r].stacks[i]` | Index into visible stacks within a display row |
| Display column index | UI event | Index among visible columns within a display stack |
| Visible card index | UI event / `data-card-index` | Index among visible cards in a column |
| Full card index | Resolved via helper | Direct index into `column.cards[]` in `fullBoardData` |

### Conversion Helpers

| Helper | Converts |
|--------|----------|
| `getFullColumn(flatIndex)` | Flat full column index → column object in `fullBoardData` |
| `findColumnContainer(flatIndex)` | Flat full column index → `{ arr, localIdx, row, stack }` |
| `findFullDataRow(displayRowIdx)` | Display row index → row object (by ID match) |
| `findFullDataRowIndex(displayRowIdx)` | Display row index → numeric index in `fullBoardData.rows` |
| `findFullDataStack(displayRowIdx, displayStackIdx)` | Display row+stack → stack object (by ID match) |
| `findFullDataStackIndex(fullRow, displayRowIdx, displayStackIdx)` | Display stack → numeric index in `fullRow.stacks` |
| `findInsertRowIndex(displayInsertAtIdx)` | Display row insertion point → full insertion index |
| `findInsertStackIndexInRow(fullRow, displayRowIdx, displayInsertAtIdx)` | Display stack insertion point → full insertion index |
| `findInsertColumnIndexInStack(stack, displayColIdx, insertBefore)` | Display column insertion point → full insertion index |
| `getFullCardIndex(col, visibleIdx)` | Visible card index → full card index |
| `findFullColumnIndexInStack(stack, displayColIdx)` | Display column-in-stack → full column index |

---

## Persistence Flow

### Explicit save only (Cmd+S)

Mutations NEVER auto-save. The flow is:

```
Frontend mutates fullBoardData (in-place)
        │
        ▼
persistBoardMutation()                  ← synchronous, no network
  ├─ updateDisplayFromFullBoard()
  ├─ renderColumns() / renderMainView()
  └─ markBoardDirty()                   ← shows "Unsaved" indicator
        │
        ▼
   User presses Cmd+S
        │
        ▼
saveFullBoard()
  ├─ Send fullBoardData + __lexeraSaveBase to backend
  ├─ Backend: CRDT apply_board → to_board → persist to disk
  ├─ Response: update __lexeraSaveBase only (NEVER replace fullBoardData)
  └─ clearBoardDirty()
```

### Design Invariants

1. **No auto-save**: `persistBoardMutation()` is synchronous and only refreshes the UI. Saving happens exclusively via `saveFullBoard()` triggered by Cmd+S.

2. **External revisions use backend freshness**: clean boards auto-reload on `MainFileChanged` / `IncludeFileChanged`, dirty boards rebase, and the stale gate is the backend-computed board revision rather than inline markdown `generation`.

3. **fullBoardData is never replaced**: Save and sync responses only update `__lexeraSaveBase`. This applies to all code paths:

| Code path | What it does |
|-----------|-------------|
| `saveFullBoard()` | REST save response → updates `__lexeraSaveBase` only |
| `applyLiveSyncBoardSnapshot()` | Live sync / SSE snapshot → updates `__lexeraSaveBase` only |
| `commitBoardMutations()` | Active board: mark dirty only; other boards: save to backend |

### Save Coalescing

`saveFullBoard()` uses a lock (`_saveInFlight` / `_savePending`) to coalesce rapid Cmd+S presses into fewer network round-trips.

Cross-board mutations (`commitBoardMutations`) save non-active boards immediately (they're not kept in memory) but only mark the active board dirty.

---

## Card Mutations

### addCardToActiveBoard
- **Line**: 8215
- **Action**: Appends a new card with content to a column
- **Index handling**: `colIndex` is flat full → `getFullColumn()`. Appends to end (no card index needed).
- **Frontend**: OK
- **Backend**: OK — CRDT adds card to column's card list

### addEmptyCardToActiveBoard
- **Line**: 8231
- **Action**: Appends a blank card to a column
- **Index handling**: Same as `addCardToActiveBoard`
- **Frontend**: OK
- **Backend**: OK

### insertCardAtIndex
- **Line**: 8272
- **Action**: Inserts a new empty card at a specific position
- **Index handling**: `colIndex` flat full → `getFullColumn()`. `atCardIndex` visible → `getFullCardIndex()` → full index. Splices at full index.
- **Frontend**: OK
- **Backend**: OK — CRDT reorders card list

### submitCard
- **Line**: 8289
- **Action**: Wrapper that calls `addCardToActiveBoard` with error handling
- **Index handling**: Passthrough
- **Frontend**: OK
- **Backend**: OK

### saveCardEdit
- **Line**: 11929
- **Action**: Saves edited card content
- **Index handling**: `colIndex` flat full → `getFullColumn()`. `fullCardIdx` is already a full index (caller resolves).
- **Frontend**: OK
- **Backend**: OK — CRDT detects content diff and updates

### toggleCheckbox
- **Line**: 11954
- **Action**: Toggles a checkbox line within a card's content
- **Index handling**: `colIndex` flat full → `getFullColumn()`. `cardIndex` visible → `getFullCardIndex()` → full index.
- **Frontend**: OK
- **Backend**: OK — content change detected and synced

### duplicateCard
- **Line**: 12104
- **Action**: Deep-clones a card and inserts after original
- **Index handling**: `colIndex` flat full → `getFullColumn()`. `cardIndex` visible → `getFullCardIndex()`. Splices clone at `fullIdx + 1`.
- **Frontend**: OK
- **Backend**: OK — new card with new ID added to CRDT

### tagCard
- **Line**: 12120
- **Action**: Applies a hidden tag (parked/archived/deleted) to card content
- **Index handling**: `colIndex` flat full → `getFullColumn()`. `cardIndex` visible → `getFullCardIndex()`.
- **Frontend**: OK
- **Backend**: OK — content change detected

### deleteCard
- **Line**: 12135
- **Action**: Marks card as deleted (delegates to `tagCard` with `#hidden-internal-deleted`)
- **Index handling**: Passthrough to `tagCard`
- **Frontend**: OK
- **Backend**: OK

### unparkCard
- **Line**: 5110
- **Action**: Removes parked tag from a card
- **Index handling**: `colIndex` flat full → `getFullColumn()`. `fullCardIndex` already full.
- **Frontend**: OK (but **dead code** — no callers; unparking uses `updateHiddenItemTag` instead)
- **Backend**: OK

### moveCard
- **Line**: 10795
- **Action**: Moves a card between columns, supports cross-board
- **Index handling**: Resolves via `resolveColumnRefForCardMutation()` which handles both flat and tree-path indices. Converts visible card indices via `getFullCardIndex()` when `cardIndexMode === 'visible'`. Adjusts insertion index when source is before target in same column.
- **Frontend**: OK
- **Backend**: OK — CRDT handles card removal from source + addition to target. Cross-container moves supported.

---

## Column Mutations

### addColumnToStack
- **Line**: 8172
- **Action**: Adds a new empty column to a stack
- **Index handling**: `rowIdx`/`stackIdx` display → `findFullDataStack()`. `atColIdx` is already a full index within the stack (callers convert via `findInsertColumnIndexInStack`).
- **Frontend**: OK
- **Backend**: OK — CRDT adds column to stack's column list

### addColumn
- **Line**: 12577
- **Action**: Adds a column at a flat position on the board
- **Index handling**: `atIndex` flat full → `findColumnContainer()` returns `{ arr, localIdx }`. Splices at `localIdx`.
- **Frontend**: OK
- **Backend**: OK

### addColumnRelativeToDisplayPosition
- **Line**: 7471
- **Action**: Adds column at a display-relative position within a stack
- **Index handling**: Display row/stack/col → `findFullDataStack()` + `findInsertColumnIndexInStack()` → converted full index passed to `addColumnToStack`.
- **Frontend**: OK
- **Backend**: OK

### addColumnFromContent
- **Line**: 7929
- **Action**: Adds a column with a card containing text to a stack
- **Index handling**: `rowIdx`/`stackIdx` display → `findFullDataStack()`. Appends to end.
- **Frontend**: OK
- **Backend**: OK

### insertTemplateColumns
- **Line**: 7939
- **Action**: Inserts multiple template columns into a stack
- **Index handling**: `rowIdx`/`stackIdx` display → `findFullDataStack()`. Pushes each column to end.
- **Frontend**: OK
- **Backend**: OK

### duplicateColumn
- **Line**: 12657
- **Action**: Deep-clones a column and all its cards, inserts after original
- **Index handling**: `colIndex` flat full → `findColumnContainer()` → splices clone at `localIdx + 1`. Regenerates all IDs, nulls `kid` fields.
- **Frontend**: OK
- **Backend**: OK — new column with new IDs added to CRDT

### deleteColumn
- **Line**: 12635
- **Action**: Marks column as deleted (delegates to `setColumnHiddenTag`)
- **Index handling**: `colIndex` flat full → `getFullColumn()` for validation. Delegates to `setColumnHiddenTag`.
- **Frontend**: OK
- **Backend**: OK

### setColumnHiddenTag
- **Line**: 12435
- **Action**: Applies hidden tag (parked/archived/deleted) to column title
- **Index handling**: `colIndex` flat full → `getFullColumn()`. Modifies `col.title`. Post-save verification checks tag survived CRDT round-trip.
- **Frontend**: OK
- **Backend**: OK — title change detected and synced

### setColumnIncludePath
- **Line**: 12249
- **Action**: Sets include file path for a column
- **Index handling**: `colIndex` flat full → `getFullColumn()`. Modifies `col.title` and `col.includeSource`.
- **Frontend**: OK
- **Backend**: OK

### disableColumnIncludeMode
- **Line**: 12290
- **Action**: Disables include mode on a column
- **Index handling**: `colIndex` flat full → `getFullColumn()`. Strips include syntax from `col.title`, sets `col.includeSource = null`.
- **Frontend**: OK
- **Backend**: OK

### moveColumnWithinBoard
- **Line**: 7210
- **Action**: Moves a column within the same stack or to a different stack
- **Index handling**: All display → `findFullDataRow()`, `findFullDataStack()`, `findFullColumnIndexInStack()`, `findInsertColumnIndexInStack()`. Same-stack adjustment when source before target. Clamps insertion.
- **Frontend**: OK
- **Backend**: OK — CRDT cross-container move or reorder

### moveColumnToExistingStack
- **Line**: 7237
- **Action**: Moves a column to the end of an existing stack in another row
- **Index handling**: All display → `findFullDataRow()`, `findFullDataStack()`, `findFullColumnIndexInStack()`. Pushes to end of target.
- **Frontend**: OK
- **Backend**: OK

### moveColumnToNewStack
- **Line**: 7259
- **Action**: Moves a column to a newly created stack
- **Index handling**: Source display → `findFullDataRow()`, `findFullDataStack()`, `findFullColumnIndexInStack()`. Target stack insertion display → `findInsertStackIndexInRow()`.
- **Frontend**: OK
- **Backend**: OK — CRDT creates new stack + moves column

### moveColumnAcrossBoards
- **Line**: 10340
- **Action**: Moves a column from one board to another
- **Index handling**: Uses `resolveColumnLocationForMutation()` which handles display-to-full conversion for the active board and direct indexing for non-active boards. Supports three target kinds: `new-stack`, `stack`, `column`. Handles rollback on failure.
- **Frontend**: OK
- **Backend**: OK — separate CRDT apply for each board

### moveColumnToStack
- **Line**: 12311
- **Action**: Moves a column to a different stack (from column context menu)
- **Index handling**: `colIndex` flat full → `getFullColumn()` + `findColumnContainer()`. `targetRowIdx`/`targetStackIdx` display → `findFullDataStack()`. Pushes to end of target.
- **Frontend**: OK
- **Backend**: OK
- **Note**: Now async with awaited `persistBoardMutation()`. Save serialization prevents race conditions.

---

## Stack Mutations

### addStackToRow
- **Line**: 8069
- **Action**: Adds a new stack with a default column to a row
- **Index handling**: `rowIdx` display → `findFullDataRow()`. `atStackIdx` display → `findInsertStackIndexInRow()` → full insertion index. Clamps.
- **Frontend**: OK
- **Backend**: OK — CRDT adds stack to row's stack list

### addStackFromContent
- **Line**: 7919
- **Action**: Adds a stack with a card containing text to a row
- **Index handling**: `rowIdx` display → `findFullDataRow()`. Pushes to end.
- **Frontend**: OK
- **Backend**: OK

### insertTemplateStack
- **Line**: 7949
- **Action**: Inserts a template stack into a row
- **Index handling**: `rowIdx` display → `findFullDataRow()`. Pushes to end.
- **Frontend**: OK
- **Backend**: OK

### duplicateStack
- **Line**: 8148
- **Action**: Deep-clones a stack and all columns/cards, inserts after original
- **Index handling**: `rowIdx`/`stackIdx` display → `findFullDataRow()` + `findFullDataStack()`. Full index via `findFullDataStackIndex()`. Splices clone at `fullStackIdx + 1`. Regenerates all IDs, nulls `kid` fields.
- **Frontend**: OK
- **Backend**: OK

### deleteStack
- **Line**: 8126
- **Action**: Marks stack as deleted (delegates to `setStackHiddenTag`)
- **Index handling**: Display → `findFullDataRow()` + `findFullDataStack()` for validation. Delegates to `setStackHiddenTag`.
- **Frontend**: OK
- **Backend**: OK

### setStackHiddenTag
- **Line**: 8115
- **Action**: Applies hidden tag (parked/archived/deleted) to stack title
- **Index handling**: `displayRowIdx`/`displayStackIdx` → `findFullDataStack()`. Modifies `stack.title`.
- **Frontend**: OK
- **Backend**: OK

### moveStack
- **Line**: 7312
- **Action**: Moves a stack within the same row or to a different row
- **Index handling**: All display → `findFullDataRow()` + `findFullDataStackIndex()`. Same-row adjustment when source before target. Adjusts for `insertBefore`. Clamps.
- **Frontend**: OK
- **Backend**: OK — CRDT cross-container move (between rows) or reorder (within row)

### moveStackAcrossBoards
- **Line**: 10271
- **Action**: Moves a stack from one board to another
- **Index handling**: Uses `resolveStackForMutation()` which converts display indices via `findFullDataRow`/`findFullDataStack` for the active board, or uses direct indices for non-active boards. Handles same-row adjustment and rollback.
- **Frontend**: OK
- **Backend**: OK — separate CRDT apply for each board

---

## Row Mutations

### addRow
- **Line**: 7968
- **Action**: Adds a new row with a default stack and column
- **Index handling**: `atIndex` display → `findInsertRowIndex()` → full insertion index. Defaults to append when not a number. Clamps.
- **Frontend**: OK
- **Backend**: OK — CRDT adds row to board's row list

### addRowFromContent
- **Line**: 7904
- **Action**: Adds a row with a card containing text
- **Index handling**: No index parameter. Pushes to end of `fullBoardData.rows`.
- **Frontend**: OK
- **Backend**: OK

### insertTemplateRow
- **Line**: 7957
- **Action**: Inserts a template row into the board
- **Index handling**: `atIndex` treated as a **full index** (not display). Splices directly into `fullBoardData.rows`. Clamps.
- **Frontend**: OK (current callers always pass `fullBoardData.rows.length`)
- **Backend**: OK
- **Note**: Inconsistent API contract — `addRow` treats `atIndex` as display, this function treats it as full. Safe with current callers but could cause issues if called with a mid-range display index in the future.

### duplicateRow
- **Line**: 8045
- **Action**: Deep-clones a row and all stacks/columns/cards, inserts after original
- **Index handling**: `rowIdx` display → `findFullDataRow()` → row object. `fullBoardData.rows.indexOf(row)` → full numeric index. Splices clone at `fullRowIdx + 1`. Regenerates all IDs, nulls `kid` fields.
- **Frontend**: OK
- **Backend**: OK

### deleteRow
- **Line**: 8022
- **Action**: Marks row as deleted (delegates to `setRowHiddenTag`)
- **Index handling**: `rowIdx` display → `findFullDataRow()` for validation. Delegates to `setRowHiddenTag`.
- **Frontend**: OK
- **Backend**: OK

### setRowHiddenTag
- **Line**: 8011
- **Action**: Applies hidden tag (parked/archived/deleted) to row title
- **Index handling**: `displayRowIdx` → `findFullDataRow()`. Modifies `row.title`.
- **Frontend**: OK
- **Backend**: OK

### reorderRows
- **Line**: 7294
- **Action**: Moves a row to a different position via drag-drop
- **Index handling**: `sourceIdx`/`targetIdx` display → `findFullDataRowIndex()` → full numeric indices. Adjusts for splice-remove-then-insert shift. Adjusts for `insertBefore`. Short-circuits on no-op.
- **Frontend**: OK
- **Backend**: OK — CRDT reorders row list

### moveRowAcrossBoards
- **Line**: 10214
- **Action**: Moves a row from one board to another
- **Index handling**: Uses `resolveRowForMutation()` which converts display indices via `findFullDataRow` + `indexOf` for the active board, or uses direct indices for non-active boards. Handles same-board adjustment and rollback.
- **Frontend**: OK
- **Backend**: OK — separate CRDT apply for each board

---

## Cross-Entity Mutations

### toggleTag
- **Line**: 12139
- **Action**: Adds or removes a user-visible tag from any entity
- **Index handling**: Dispatches by `elementType`:
  - `card`: flat full `colIndex` → `getFullColumn()`, visible `cardIndex` → `getFullCardIndex()`. Modifies `card.content`.
  - `column`: flat full `colIndex` → `getFullColumn()`. Modifies `col.title`.
  - `row`: display `rowIdx` → `findFullDataRow()`. Modifies `row.title`.
  - `stack`: display `rowIdx`/`stackIdx` → `findFullDataStack()`. Modifies `stack.title`.
- **Frontend**: OK
- **Backend**: OK — content/title changes detected and synced

### renameRowOrStack
- **Line**: 7655
- **Action**: Inline-renames a row or stack title
- **Index handling**: `rowIdx` display → `findFullDataRow()`. `stackIdx` display → `findFullDataStack()`. Modifies `target.title` in the save closure.
- **Frontend**: OK
- **Backend**: OK
- **Note**: Save closure calls `persistBoardMutation()` without `await` (synchronous event handler context). Save serialization lock prevents race conditions.

### removeEmptyStacksAndRows
- **Line**: 7523
- **Action**: Cleanup — removes rows with no stacks after move operations
- **Index handling**: No index parameters. Iterates `fullBoardData.rows` backwards, removes rows where `stacks.length === 0`.
- **Frontend**: OK — called by move functions, not directly by user
- **Backend**: OK — structural change detected on next persist
- **Note**: Does NOT persist itself; callers are responsible.

---

## Summary

| Category | Count | All OK | Notes |
|----------|-------|--------|-------|
| Cards | 11 | Yes | `unparkCard` is dead code (no callers) |
| Columns | 14 | Yes | `moveColumnToStack` not async (minor style) |
| Stacks | 8 | Yes | — |
| Rows | 8 | Yes | `insertTemplateRow` has inconsistent API contract |
| Cross-Entity | 3 | Yes | `renameRowOrStack` save not awaited (minor style) |
| **Total** | **44** | **Yes** | No display-to-full index bugs remaining |

### Observations

1. **Dead code**: `unparkCard` (line 5110) has no callers. Unparking uses `updateHiddenItemTag` instead.
2. **Inconsistent API**: `insertTemplateRow` treats `atIndex` as a full index while the sibling `addRow` treats it as display. Safe with current callers but fragile.
3. **Remaining non-awaited persists**: `renameRowOrStack` and `enterColumnRename` save closures call `persistBoardMutation()` without `await` (synchronous event handler context). The save serialization lock (`_saveInFlight` / `_savePending`) ensures these are safely coalesced. Other previously non-awaited calls (`moveColumnToStack`, `sortColumnCards`, `applyPtrDragHiddenTag`) are now properly async with `await`.
