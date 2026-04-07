# Performance Optimization Spec — Large Board Handling

## Problem Statement

With dozens of boards containing hundreds of cards each, the app suffers from:
- 30+ second startup timeouts (sequential board loading)
- 1.1MB+ API responses (unbounded search/calendar results)
- Full DOM rebuilds on every mutation (3000+ nodes recreated)
- 500KB+ JSON serialization per undo step
- Full board re-fetch on any single-card change

## Phase 1: Paginate & Truncate API Responses

**Goal:** Reduce search/calendar response size from 1.1MB to ~50KB.

### Backend Changes (lexera-core + lexera-backend)

**Search API** — `GET /search?q=...&limit=N&offset=M&truncate=N`
- Add `limit` (default 50, max 200) and `offset` (default 0) query params
- Add `truncate` param (default 200) — max chars of `cardContent` returned
- Return `{ results: [...], total: N, limit: N, offset: N }` so frontend knows if there's more
- Apply limit AFTER sorting (maintain sort order across pages)

**Calendar API** — `GET /calendar/tasks?limit=N&offset=M`
- Same pagination pattern
- Groups (overdue/today/thisWeek/upcoming/later) each get independent counts
- Return `{ groups: { overdue: { items: [...], total: N }, ... } }`
- Default limit per group: 20

**Board List API** — `GET /boards` already lightweight (no card content) — no change needed

### Frontend Changes

- `refreshDashboardData()` — use `limit=30` for each search/calendar call
- Dashboard groups show "N more..." link when `total > items.length`
- Card click navigates to board+card (already works)

### Files to Modify
- `lexera-core/src/storage/local.rs` — `search_with_options()`, `calendar_tasks()`
- `lexera-core/src/types.rs` — `SearchOptions` struct (add limit/offset/truncate)
- `lexera-backend/src-tauri/src/api/search.rs` — parse query params
- `lexera-backend/src-tauri/src/api/calendar.rs` — parse query params
- `lexera-kanban/src/board/orderHelpers.js` — pass limit params
- `lexera-kanban/src/api.js` — update search/calendar signatures

---

## Phase 2: Parallel Board Loading at Startup

**Goal:** Load N boards in parallel instead of sequential — ~Nx speedup.

### Backend Changes

**`init_storage_and_boards`** in lib.rs:
- Use `rayon::par_iter` to parse boards in parallel
- Each thread: read file, resolve includes, parse markdown, create CRDT
- After parallel parse: sequential insert into storage (write lock is brief)
- Alternatively: `tokio::spawn` per board, then `join_all`

### Considerations
- Include resolution reads files — must be thread-safe (already is, uses `fs::read_to_string`)
- CRDT creation is CPU-bound — benefits from parallelism
- Write lock for HashMap insert is <1ms — sequential insert is fine
- File watcher setup must happen AFTER all boards are loaded

### Files to Modify
- `lexera-backend/src-tauri/src/lib.rs` — `init_storage_and_boards()`
- `lexera-core/src/storage/local.rs` — extract `prepare_board_state()` (parse-only, no lock)

---

## Phase 3: Search Index for Tags & Dates

**Goal:** O(1) tag/date lookups instead of full scan.

### Data Structure
```rust
struct SearchIndex {
    by_tag: HashMap<String, Vec<CardRef>>,        // #tag → [board+col+card]
    by_temporal: HashMap<String, Vec<CardRef>>,    // @KW23 → [board+col+card]
    by_due_date: BTreeMap<String, Vec<CardRef>>,   // "2026-03-30" → [...] (sorted)
    open_items: Vec<CardRef>,                       // checked=false
    card_text: HashMap<String, String>,             // cardId → content (for full-text)
}

struct CardRef {
    board_id: String,
    column_index: usize,
    card_index: usize,
}
```

### Update Strategy
- Build index on `add_board()` / `reload_board()`
- Update index on `write_board_internal()` — diff old vs new cards
- Index lives alongside `boards` in LocalStorage
- Search queries: check index first for tag/temporal/date queries, fall back to full scan for free-text

### Files to Modify
- `lexera-core/src/storage/local.rs` — new `SearchIndex` struct + update methods
- `lexera-core/src/storage/search_index.rs` — new file
- `lexera-core/src/types.rs` — `CardRef` struct

---

## Phase 4: Delta Undo (Store Changed Cards Only)

**Goal:** Reduce undo memory from 500KB/step to ~1-5KB/step.

### Strategy
- Instead of `JSON.stringify(fullBoardData)`, store a patch:
  ```js
  { type: 'card-edit', boardId, rowIdx, stackIdx, colIdx, cardIdx,
    before: { content: '...' }, after: { content: '...' } }
  ```
- Undo: apply `before`, Redo: apply `after`
- For structural changes (add/remove/reorder): store the affected subtree only
- Fall back to full snapshot for complex multi-entity operations

### Files to Modify
- `lexera-kanban/src/app.js` — `pushUndoSnapshot()`, `undo()`, `redo()`
- Potentially extract to `lexera-kanban/src/undo/undoSystem.js`

---

## Phase 5: Targeted DOM Updates (Expand Coverage)

**Goal:** Avoid full re-render for single-entity mutations.

### Already Done
- Tag toggle: hide card via CSS, skip render
- Park/archive/delete: remove card element, skip render
- Column tag mutation: targeted `renderTitleInline` update

### Remaining
- Card content edit: replace card element only
- Card reorder (drag within column): move DOM node, no re-render
- Column reorder: move column element
- Card add: insert new card element at position

### Strategy
- `persistBoardMutation({ skipRender: true, targetEl: cardEl })` already exists
- Expand to cover card edit and add operations
- Full re-render only for: board load, board switch, multi-entity operations

### Files to Modify
- `lexera-kanban/src/app.js` — `persistBoardMutation()`, card edit handlers
- `lexera-kanban/src/menu/cardContextMenu.js` — targeted updates
- `lexera-kanban/src/dragdrop/dndMutations.js` — DOM node moves

---

## Phase 6: Virtual Scrolling (500+ Cards)

**Goal:** Render only visible cards, constant render time regardless of board size.

### Strategy
- For boards with >200 cards, enable virtual scrolling per column
- Each column renders only visible cards + buffer (20 above, 20 below)
- IntersectionObserver or scroll event to load/unload cards
- Card height estimation: fixed height or measured once

### Considerations
- Canvas mode already positions stacks absolutely — virtual scrolling less applicable
- Kanban mode: columns scroll vertically — prime candidate
- Search highlighting must work across virtual boundaries
- Drag-drop needs all card positions calculated (not just visible)

### Files to Modify
- `lexera-kanban/src/app.js` — `renderColumns()` virtual path
- `lexera-kanban/src/render/virtualScroll.js` — new module
- `lexera-kanban/src/app.css` — virtual scroll container styles

---

## Phase 7: Delta Sync on Poll

**Goal:** Fetch only changed cards instead of full board on generation change.

### Backend
- `GET /board/{id}/changes?since_generation=N` — returns only changed cards
- Track per-card generation in BoardState
- Return `{ cards: [{ op: 'update'|'add'|'delete', card: {...} }], generation: N }`

### Frontend
- Poll checks generation as before
- If changed: fetch delta instead of full board
- Apply delta to in-memory fullBoardData
- Full fetch as fallback if delta is too large or generation gap too big

### Files to Modify
- `lexera-core/src/storage/local.rs` — per-card generation tracking, delta API
- `lexera-backend/src-tauri/src/api/board.rs` — `/changes` endpoint
- `lexera-kanban/src/sync/pollingService.js` — delta fetch logic
- `lexera-kanban/src/app.js` — delta apply logic

---

## Implementation Order

| Phase | Effort | Impact | Dependencies |
|-------|--------|--------|--------------|
| 1. Paginate API | 2-3 hours | High | None |
| 2. Parallel loading | 1-2 hours | High | None |
| 3. Search index | 4-6 hours | High | None |
| 4. Delta undo | 3-4 hours | Medium | None |
| 5. Targeted DOM | 3-4 hours | Medium | None |
| 6. Virtual scroll | 8-12 hours | High | Phase 5 |
| 7. Delta sync | 6-8 hours | Medium | Phase 3 |
