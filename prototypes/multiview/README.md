# Multi-Webview Prototype

Validates the Stage 1 hypothesis from [TODOs-lexera-multiview.md](../../TODOs-lexera-multiview.md): can we host multiple Tauri 2 child webviews in one window with each running in its own OS process, and can we implement cross-webview drag-drop on top of that?

## What this prototype does

- Spawns 3 child webviews in a single Tauri window arranged horizontally
- Each child webview is a "board" with a few draggable card-shaped elements
- Shell webview hosts dividers between the boards (resize live)
- Drag a card from one board → drop on another board (different OS process)
- Rust drag coordinator handles pointer routing, hit-testing, and drop event delivery
- Ghost element follows the cursor during drag (rendered in shell overlay)

## Status

This is a STAGE 1 PROTOTYPE. Goals:

1. Verify Tauri 2 multi-webview spawning works on macOS / Windows / Linux
2. Verify each child webview gets its own OS process (Activity Monitor / Task Manager)
3. Verify cross-webview drag works end-to-end with a smooth ghost
4. Measure dock-divider drag FPS with synthetic dense board content
5. Decide whether to proceed with the production migration

## Running

```bash
cd prototypes/multiview/src-tauri
cargo tauri dev
```

## Verification checklist

### Functional (validated 2026-04-24)
- [x] App launches with one window containing 3 visible boards
- [x] Drag a card from Board A to Board B: card appears in B
- [x] Drag a card from Board A to Board C: card appears in C
- [x] Cancel mid-drag with Escape: card stays in source
- [x] Source card removed on successful drop (true move semantics)

### Process isolation (verify in Activity Monitor / Task Manager)
- [ ] Activity Monitor shows 4 distinct WebContent processes (1 shell + 3 boards) on macOS
- [ ] Task Manager shows 4 distinct WebView2 processes on Windows
- [ ] System Monitor shows 4 distinct WebKitWebProcess on Linux *(requires per-WebContext configuration)*

### Perf measurement (Stage 1 decision gate)

The prototype seeds 500 cards per board (1500 total). The shell header shows the shell's main-thread FPS; each board header shows its own process's main-thread FPS.

- [ ] Idle FPS: all four counters should stay at the display refresh rate (60 / 120 Hz). Record numbers below.
- [ ] Drag a divider continuously for 5 seconds. Observe:
  - Shell FPS while dragging
  - Each board's FPS while dragging
  - Visible jitter / stutter / lag
- [ ] Drag a card across boards. Observe:
  - Source board FPS during drag
  - Target board FPS during drag-over
  - Drop responsiveness

**Stage 1 decision gate:** drag-divider FPS in shell remains ≥ 50 fps under 1500-card load. If not, the multi-webview architecture isn't paying off and we should reconsider before Stage 2.

### Recorded results (fill in after running)

| Scenario | macOS | Windows | Linux |
|---|---|---|---|
| Idle shell FPS | __ | __ | __ |
| Idle board FPS | __ | __ | __ |
| Shell FPS during divider drag | __ | __ | __ |
| Board FPS during divider drag | __ | __ | __ |
| Source board FPS during card drag | __ | __ | __ |
| Target board FPS during drag-over | __ | __ | __ |
| Number of WebContent / WebView2 processes | __ | __ | __ |
| Per-process RAM (MB) | __ | __ | __ |

### Cross-platform parity
- [ ] macOS: build and run, verify all functional and perf items above
- [ ] Windows: build and run, verify all functional and perf items above
- [ ] Linux: build and run with WebKitGTK per-WebContext configured, verify all functional and perf items above

## Files

- `src-tauri/src/main.rs` — entry point, window setup
- `src-tauri/src/webview_mgr.rs` — child webview lifecycle
- `src-tauri/src/drag_coordinator.rs` — cross-webview drag state machine
- `src-tauri/src/ghost_window.rs` — transparent always-on-top ghost overlay
- `src/shell/index.html` — shell page (chrome + dividers)
- `src/shell/shell.js` — shell logic (geometry, drag overlay positioning)
- `src/shell/shell.css` — shell styling
- `src/board/index.html` — per-board page (loaded by child webviews)
- `src/board/board.js` — board logic (draggable cards, drop targets)
- `src/board/board.css` — board styling
