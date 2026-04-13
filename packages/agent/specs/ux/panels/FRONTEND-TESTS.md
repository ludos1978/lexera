# Frontend Test Infrastructure Specification

**Status**: Active
**V2 Target**: `lexera-kanban`
**Files**: `lexera-kanban/src/test/frontendTests.js`, `lexera-kanban/src/test/autoRunBootstrap.js`

---

## Purpose

The frontend test suite runs **inside the live Tauri WebView** against the real loaded board. Tests exercise production code paths (moveCard, addRow, undo, etc.) and verify real DOM state. This is NOT a unit test suite — it's an integration test harness that runs in the actual application.

---

## Running Tests

### Manual (primary method)

1. Open Lexera Kanban
2. Open the test panel: **View > Panels > Frontend Tests**
3. Select a board from the dropdown (needs at least 2 columns with cards)
4. Click **Run All** (or type a filter and run a subset)
5. Copy results via the **Copy** button

### Automated (CLI)

The `run-lexera-tests.sh` script starts backend + kanban with `--run-tests` flags:

```bash
./run-lexera-tests.sh --board=<board-id> --delay=10000 --no-capture
```

**CLI flags** (parsed in `lexera-kanban/src-tauri/src/main.rs`):

| Flag | Default | Effect |
|---|---|---|
| `--run-tests` | — | Enable auto-run mode |
| `--run-tests-delay=<ms>` | 10000 | Wait before starting tests |
| `--run-tests-board=<id>` | — | Pre-seed board selection in localStorage |
| `--run-tests-output=<path>` | — | Write formatted results to file on completion |
| `--quit-after-tests` | — | Exit process after results are written |

**How auto-run works:**

1. Rust `main()` parses CLI args, writes `src/auto-run-config.json` with board/output/quit/delay
2. Also writes a startup marker to the output file for progress verification
3. `autoRunBootstrap.js` (loaded as separate `<script>` after `frontendTests.js`) polls for `/auto-run-config.json` via XHR
4. When found, seeds localStorage board selection, waits for `LexeraFrontendTests` to appear (checks iframes for workspace-shell mode), then calls `runAllWithUI()`
5. Polls `_runState.active` until tests finish, formats results via `buildCopiedResultsText('all')`, posts output to backend `POST /test-results` with `X-Output-Path`, optionally calls `quit_app`

**Output delivery:** Auto-run writes results through the backend `POST /test-results` endpoint so it works from the workspace-shell parent frame and the board iframe. Tauri `write_text_file` remains a fallback when the backend cannot be discovered.

**Result format:** Same as the test panel's Copy button output (scope: 'all'). Includes per-test pass/fail, duration breakdown (setup/body/teardown), mutation profile with render counts, and optional error logs.

---

## Test Patterns

### `register(name, fn)` — basic test
```js
register('test name', async function () {
  await setup();     // snapshots board state, unfolds all, stores _snapshot
  try {
    // ... mutations and assertions ...
  } finally {
    await teardown(); // restores _snapshot via setTestBoard, re-renders
  }
});
```

### `registerDoUndo(name, spec)` — mutation + undo test
```js
registerDoUndo('test name', {
  setup: function () { return ctx; },       // resolve indices, ids
  capture: function (ctx) { return before; }, // snapshot DOM state
  do: async function (ctx, before) { ... },  // run mutation
  checkDo: function (ctx, before) { ... },   // assert post-mutation
  checkUndo: function (ctx, before) { ... }, // assert post-undo (optional)
  skipUndo: false                            // skip undo phase (optional)
});
```

The runner: setup → capture → do → checkDo → undo → checkUndo.
If checkDo fails, a fail-safe undo runs in the finally block.
`flushHierarchyRefresh()` runs before `cancelAllDeferredWork()` to prevent leaked timers.

---

## Test Infrastructure Features

### Filter
- Text input in panel header, substring match on test name
- Button shows "Run N/total" when filtered
- Filtered-out tests show as "skipped" with `–` indicator

### Board selection
- Dropdown populated from available boards
- Stored in `localStorage('lexera-frontend-tests-board')`
- `ensureSelectedBoardLoaded()` switches to selected board before first test

### Self-sufficient preconditions
- `findTwoColumnsWithCards()` auto-injects test cards/columns if the board doesn't have 2 visible columns with cards
- Tests can run on any board, even an empty one

### Conflict dialog auto-dismiss
- `dismissConflictDialogs()` auto-clicks "Load Disk Version" on external-changes or merge-conflict dialogs
- Called in `setup()` and before each test in `runAllUI()`

### Mutation profiling
- `window.__lexeraProfileMutations = true` enables per-mutation timing
- `window.__lexeraMutationProfile = []` collects samples
- Reset between tests, summarized in results

---

## Key Functions

| Function | Location | Purpose |
|---|---|---|
| `setup()` | frontendTests.js | Snapshot board, unfold, prepare for test |
| `teardown()` | frontendTests.js | Restore snapshot, flush hierarchy, cancel timers |
| `registerDoUndo()` | frontendTests.js | Test pattern: do + check + undo + check |
| `findTwoColumnsWithCards()` | frontendTests.js | Find/create 2 columns with cards |
| `dismissConflictDialogs()` | frontendTests.js | Auto-dismiss external-change dialogs |
| `buildCopiedResultsText()` | frontendTests.js | Format results for copy/file output |
| `runAllUI()` | frontendTests.js | Run all (or filtered) tests with UI updates |
| `startAutoRunFromConfig()` | frontendTests.js | Handle auto-run config from CLI |
| `get_test_runner_config` | main.rs (Tauri cmd) | Return CLI flags as JSON to frontend |

---

## Files

| File | Role |
|---|---|
| `lexera-kanban/src/test/frontendTests.js` | Test harness, all tests, UI panel logic |
| `lexera-kanban/src/test/autoRunBootstrap.js` | CLI auto-run: polls for config, starts tests |
| `lexera-kanban/src/workspace/sharedPanels.js` | Panel HTML template (filter input, buttons) |
| `lexera-kanban/src-tauri/src/main.rs` | CLI flag parsing, config file write, Tauri command |
| `run-lexera-tests.sh` | Shell script: backend + kanban orchestration |
| `run-lexera.sh` | Dev script with `--run-tests` passthrough |
