# IPC Migration — End-to-End Smoke Test Checklist

Closes gap #11 from `IPC-Migration-Plan.md`. Unit and integration tests
verify each layer in isolation; this checklist is for empirical
end-to-end verification on a real desktop install.

Run this the first time after the migration lands, and any time the
transport layer (api.js transport selector, `lexera-local-ipc` frames,
`ipc_server`, asset protocol handler) changes.

## Preconditions

- Fresh build on the target OS (macOS, Linux, or Windows).
- A workspace with at least one board containing media (an image, a PDF,
  and a draw.io or excalidraw diagram) and at least one `!include` link.
- DevTools open in the Kanban webview (macOS/Linux: Cmd/Ctrl+Alt+I;
  Windows: Ctrl+Shift+I).

## Per-platform check

| # | Check | Expected | Notes |
|---|---|---|---|
| 1 | Launch `lexera-backend`; confirm logs show `IPC server listening on <endpoint> (pid=<n>)`. | Backend listens on both HTTP (127.0.0.1:13080 or fallback) and the IPC endpoint printed to the log. | — |
| 2 | Inspect descriptor file: macOS `~/Library/Preferences/lexera/ipc.json`, Linux `~/.config/lexera/ipc.json`, Windows `%APPDATA%\lexera\ipc.json`. | JSON with `protocol: "lexera-local-ipc/v1"`, live `pid`, 32-byte base64 `secret`, RFC3339 `started_at`. | — |
| 3 | Unix: `stat -c '%a %U' <descriptor>`. Windows: `icacls <descriptor>`. | Unix: `600 <you>`. Windows: current user full control, no broader ACE. | Gap #3 (Windows) may show default ACL if `SetFileSecurityW` failed silently — check the backend logs for the `restrict_file_to_current_user` warning. |
| 4 | Launch `lexera-kanban`; open the main window. | Boards load. Media previews and diagrams render. | — |
| 5 | DevTools Network tab: filter for `localhost`, `127.0.0.1`, `ws://`. | **Zero entries.** | If any appear, locate the caller and route it through LexeraApi; consult `check-transport-discipline.sh`. |
| 6 | DevTools Network tab: filter for `lexera-asset://` (or `http://lexera-asset.localhost` on Windows). | Entries per image, diagram, and PDF on the visible board. | Windows rewrites the scheme to `lexera-asset.localhost`; same handler, different string. |
| 7 | Drag-drop or paste an image. | Upload succeeds. Card shows the new image. | Gap #1 path: uses `backend_ipc_upload`. Check backend log for any `upload_in_progress` / `upload_not_started` warnings. |
| 8 | Seek in a multi-second video to a mid-point. | Video plays from the seek point without reloading the whole file. | Range requests. Check DevTools Network → the `lexera-asset://` request for the video carries a `Range: bytes=<N>-` header. |
| 9 | Edit a card in one Kanban window; open a second instance or leave the same window open and watch another peer join via sync. | Edits propagate within ~1s. Presence indicators update. | Phase 5b sync. The ClientUpdate / ServerUpdate flow must work over IPC. |
| 10 | Kill `lexera-backend` (Cmd-Q its tray icon or `kill <pid>`). | Kanban logs `backend-status: unavailable`. New API calls fail visibly. | Gap #4. Webview should observe the `backend-status` Tauri event. |
| 11 | Restart `lexera-backend`. | Within 30s, Kanban logs `backend-status: connected` and resumes serving requests; events and log streams re-subscribe automatically; sync re-handshakes. | Gap #5. Events/logs streams should reconnect with exponential backoff; sync attempts a reconnect with the backoff schedule. |
| 12 | With Kanban still running, open the **Management** window (connection settings). | Lists boards, config, logs. | Phase 6. These requests go through `backend_local_api`, not loopback HTTP. |
| 13 | Quit Kanban. `curl http://127.0.0.1:13080/status` (or the fallback port). | Backend keeps responding; mobile / browser clipper clients unaffected. | Plan acceptance criterion. |
| 14 | Tail `~/Library/Preferences/lexera/` (or equivalent) while the backend is running. | `ipc.json` present; no leftover `ipc.json.tmp`. | Descriptor cleanup. |
| 15 | `./check-transport-discipline.sh` from repo root. | `Transport discipline check: clean.` | ESLint rule + CI grep guard. |

## Regression triggers

Re-run this checklist when any of the following change:

- `lexera-local-ipc/src/frame.rs` — wire protocol evolution.
- `lexera-backend/src-tauri/src/ipc_*.rs` — backend dispatch/streaming
  paths.
- `lexera-kanban/src-tauri/src/{ipc_client, ipc_streams, asset_protocol,
  backend_status}.rs` — client-side transport.
- `lexera-kanban/src/api.js` — frontend transport selector.
- `lexera-kanban/src-tauri/tauri.conf.json` CSP — asset protocol surface.

## Recording results

Track results per platform in the PR or release notes. A failing row
points at a specific gap (see the "Post-Implementation Gaps" section in
`IPC-Migration-Plan.md`).
