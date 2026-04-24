# Stage 1 Prototype Results

Empty until measured. Fill in after running `cargo tauri dev` from `src-tauri/` and observing the FPS counters.

## Hardware

- Machine model:
- CPU:
- RAM:
- Display refresh rate (Hz):
- OS version:

## Process isolation

- Webview backend: (WKWebView / WebView2 / WebKitGTK)
- Number of WebContent processes observed:
- Per-process RAM (MB):

## FPS measurements

### Idle (no interaction)

| Webview | FPS |
|---|---|
| Shell | |
| board-a | |
| board-b | |
| board-c | |

### During divider drag (continuous, 5 seconds)

| Webview | Min FPS | Avg FPS |
|---|---|---|
| Shell | | |
| board-a | | |
| board-b | | |
| board-c | | |

### During cross-webview card drag

| Webview | Min FPS during drag |
|---|---|
| Source board | |
| Target board (during drag-over) | |
| Other board (idle bystander) | |
| Shell | |

### Card density

- Cards per board:
- Total cards across all boards:
- Override via URL: `board/index.html?cards=NNN`

## Decision

Stage 1 decision gate: shell FPS ≥ 50 during divider drag with ≥1500 total cards loaded.

- [ ] Pass — proceed to Stage 2 (Rust webview manager promotion)
- [ ] Fail — investigate before any production refactor

## Notes / observations

(visible jitter, surprises, things that worked better or worse than expected)
