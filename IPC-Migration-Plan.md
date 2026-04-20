# Lexera Local IPC and Asset Protocol Migration

## Purpose

Move desktop-local communication away from loopback HTTP while keeping `lexera-backend` as the independent, long-running authority process.

The backend must continue running when the Kanban frontend exits. It also remains responsible for mobile sync, browser clipper access, bookmark sync, calendar feeds, LAN discovery, public invite URLs, and any service that intentionally needs HTTP or WebSocket access.

This migration only changes the desktop-local path between the Tauri UI and the local backend.

## Core Architecture Decision

Use three transport layers, each for the job it is good at:

- **Tauri commands/events/channels** between the Kanban webview and the Kanban Rust process.
- **Local OS IPC** between the Kanban Rust process and the independent backend process.
- **A Lexera asset protocol** for webview-loadable bytes: images, media, PDFs, rendered diagrams, Draw.io, Excalidraw, PlantUML, Mermaid, and cached preview artifacts.

Do not use the asset protocol as a general JSON API. Structured requests, mutations, subscriptions, logs, and sync messages should use commands/events over the local IPC bridge. Asset protocol URLs should be opaque, read-only resource URLs.

Target shape:

```text
Kanban WebView
  -> Tauri commands/events/channels
  -> lexera-asset URLs for renderable resources
Kanban Rust Bridge
  -> local OS IPC, never TCP
lexera-backend
  -> existing storage, watchers, sync, feeds, HTTP/WS server

Remote/browser/mobile clients
  -> existing HTTP/WS server
```

References:

- Tauri IPC: https://v2.tauri.app/concept/inter-process-communication/
- Tauri asset URLs: https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc
- Tauri asset protocol config: https://v2.tauri.app/reference/config/#assetprotocolconfig

## Scope

### In Scope

- Replace desktop-local `fetch`, `EventSource`, and `WebSocket` calls from the Kanban webview to `127.0.0.1` or `localhost`.
- Preserve the existing `LexeraApi` shape and move transport selection underneath it.
- Add a local process IPC bridge between `lexera-kanban` Rust and `lexera-backend`.
- Serve files, media, and rendered preview artifacts through a Lexera-owned asset protocol.
- Move backend-owned Tauri windows, such as connection settings and quick capture, to direct backend Tauri commands/events.
- Keep the current REST route semantics as the compatibility contract while the transport changes.

### Out of Scope

- Removing the backend HTTP/WS server.
- Changing mobile sync, browser clipper, CalDAV/iCal, XBEL/bookmark sync, LAN discovery, public invite URLs, or backend-to-backend sync.
- Refactoring all backend handlers into new service APIs before the transport migration works.
- Making Kanban launch or own the backend lifecycle. The backend remains independent.

## Plan Quality Review

The current plan is architecturally strong because it separates responsibilities cleanly:

- Tauri IPC handles webview-to-Rust control flow.
- Local OS IPC handles process-to-process communication while preserving an independent backend.
- The asset protocol handles browser-loadable bytes instead of being stretched into a general API transport.
- Remote/browser/mobile integrations remain on the existing HTTP/WS boundary.

Quality level: **high architecture quality, medium implementation certainty**. The main architecture is sound, but implementation quality depends on resolving platform IPC details, stream backpressure, descriptor security, and the temporary HTTP rollout flag.

The main quality gap was that the plan stated the preferred architecture without showing the alternatives. The decision matrix below makes the tradeoffs explicit and chooses one approach per feature area.

## Architecture Alternatives and Decisions

Each feature area has three plausible plans. The selected plan is the one that best satisfies these constraints:

- No desktop-local loopback HTTP/WS for the Tauri UI.
- `lexera-backend` stays independent and keeps serving external clients.
- Rendering and preview URLs work naturally in the webview.
- Existing REST semantics remain the compatibility contract during migration.
- The final architecture is simple enough to operate and test.

### Feature 1: Local API Transport

| Plan | Approach | Strengths | Weaknesses | Decision |
| --- | --- | --- | --- | --- |
| A | Keep loopback HTTP but tighten CORS/auth | Smallest code change; keeps current route stack unchanged | Fails the primary goal; keeps port discovery, CORS, and localhost failure modes | Reject |
| B | Embed backend runtime into Kanban | Pure Tauri IPC from webview to backend logic; no process bridge | Violates the independent-backend requirement; duplicates lifecycle and background services | Reject |
| C | Kanban Tauri commands to Kanban Rust, then local OS IPC to `lexera-backend` | Removes desktop loopback; preserves backend independence; keeps external HTTP/WS services | Requires a new IPC crate and descriptor lifecycle | **Choose** |

Best plan: **C**. It is the only option that satisfies both the no-loopback goal and the independent backend requirement.

### Feature 2: Assets, Media, and Rendered Previews

| Plan | Approach | Strengths | Weaknesses | Decision |
| --- | --- | --- | --- | --- |
| A | Keep HTTP `fileUrl()` / `mediaUrl()` with bearer query tokens | Minimal frontend churn; current behavior is known | Keeps localhost and token-bearing URLs; preserves current CORS/render failure class | Reject |
| B | Use generic Tauri asset URLs over scoped filesystem paths | Simple for static local files; native webview loading | Hard to scope dynamic board roots safely; bypasses backend board/path authorization | Reject |
| C | Use `lexera-asset` URLs backed by authenticated backend IPC `AssetRequest` frames | Natural webview resource loading; backend remains path authority; no URL tokens | Requires protocol handler and streaming/range support | **Choose** |

Best plan: **C**. It keeps asset URLs webview-native while preserving backend validation and avoiding raw filesystem exposure.

### Feature 3: Events, Logs, and Local Sync

| Plan | Approach | Strengths | Weaknesses | Decision |
| --- | --- | --- | --- | --- |
| A | Keep local SSE and WebSocket endpoints | Current behavior stays mostly unchanged | Keeps loopback WS/SSE in desktop mode; violates migration goal | Reject |
| B | Replace streams with periodic command polling | Very simple transport; easier to debug | Worse latency; wasteful; poor fit for sync/presence/log tails | Reject |
| C | Backend IPC streams bridged to Tauri events/channels | Preserves streaming semantics without localhost; fits logs/events/sync | Needs backpressure, cancellation, and reconnect handling | **Choose** |

Best plan: **C**. It preserves event-driven behavior and removes desktop-local network sockets.

### Feature 4: Auth and Trust Boundary

| Plan | Approach | Strengths | Weaknesses | Decision |
| --- | --- | --- | --- | --- |
| A | Reuse HTTP bearer tokens inside IPC and asset URLs | Maximum compatibility with current middleware | Carries HTTP auth concepts into local IPC; keeps token leakage risk in URLs | Reject |
| B | Trust filesystem permissions only | Simple descriptor model | Too weak as the only control; stale descriptors and same-user confusion are harder to reason about | Reject |
| C | Three independent gates: descriptor `0600`/ACL filesystem permission, per-start secret in handshake, OS peer credentials (`SO_PEERCRED` / `getpeereid` / pipe ownership) | Clear local trust boundary; no bearer tokens in desktop URLs; any single gate failure still blocks | Slightly more platform work, peer-cred approximation on Windows | **Choose** |

Best plan: **C**. It separates remote HTTP auth from local desktop IPC auth and gives true defense in depth: all three gates must pass, and each defeats a different attacker model (other-user read, stale secret, unauthorized process under the same uid).

### Feature 5: Backend-Owned Tauri Windows

| Plan | Approach | Strengths | Weaknesses | Decision |
| --- | --- | --- | --- | --- |
| A | Keep injecting `?backend=http://HOST:PORT` and fetch locally | Minimal code change | Leaves backend-owned windows dependent on local HTTP | Reject |
| B | Route backend-owned windows through Kanban's IPC bridge | Reuses one frontend adapter | Wrong ownership direction; creates unnecessary coupling to Kanban | Reject |
| C | Use direct backend Tauri commands/events | Simplest ownership model; no HTTP; no Kanban dependency | Requires small window adapter changes | **Choose** |

Best plan: **C**. These windows already belong to the backend process, so direct Tauri IPC is the clean architecture.

### Feature 6: Backend Lifecycle and Absence

| Plan | Approach | Strengths | Weaknesses | Decision |
| --- | --- | --- | --- | --- |
| A | Kanban launches backend on demand | Convenient single-app feel | Conflicts with independent backend ownership; adds launcher and upgrade edge cases | Reject |
| B | If IPC fails, silently fall back to localhost HTTP | Reduces visible failures during rollout | Masks migration regressions; reintroduces forbidden desktop-local path | Reject |
| C | Explicit waiting/reconnecting states with descriptor watch | Honest operational model; preserves backend independence; easy to test | Requires a small UX state in Kanban | **Choose** |

Best plan: **C**. It matches the chosen process model and avoids hidden fallback behavior.

### Feature 7: Rollout Strategy

| Plan | Approach | Strengths | Weaknesses | Decision |
| --- | --- | --- | --- | --- |
| A | Big-bang replacement | Fastest on paper | High regression risk across API, assets, streams, and renderers | Reject |
| B | Permanent dual desktop transports | Easy rollback forever | Permanent complexity; every desktop feature must support two local paths | Reject as default |
| C | Phased rollout with a temporary flag, then remove desktop HTTP mode | Controlled migration; measurable parity; clean final state | Requires discipline to remove the flag | **Choose** |

Best plan: **C**. Keep HTTP as a temporary rollout and triage tool only. It is removed from desktop builds at the end of Phase 7. A deliberate remote-backend-from-desktop product mode, if ever needed, is a separate future feature, not part of this migration.

### Feature 8: Remote Service Boundary

| Plan | Approach | Strengths | Weaknesses | Decision |
| --- | --- | --- | --- | --- |
| A | Move every feature to IPC | Pure local architecture | Impossible for browser, mobile, feeds, LAN discovery, and external services | Reject |
| B | Split desktop-local IPC from intentional network services | Preserves product features; clear boundary | Requires documentation and tests to prevent accidental coupling | **Choose** |
| C | Create a separate public-service process distinct from `lexera-backend` | Strong isolation for external services | Major extra lifecycle and deployment complexity; not required for this migration | Reject |

Best plan: **B**. The migration should remove only accidental local desktop networking, not intentional service networking.

### Recommended Composite Plan

The selected architecture is:

- Local API transport: **Tauri commands plus local OS IPC**.
- Asset delivery: **Lexera custom asset protocol backed by backend IPC**.
- Streams/logs/sync: **IPC streams bridged into Tauri events/channels**.
- Auth: **descriptor secret plus same-user local endpoint checks**.
- Backend-owned windows: **direct backend Tauri commands/events**.
- Lifecycle: **explicit waiting/reconnect state, no silent HTTP fallback**.
- Rollout: **phased migration with temporary flag, clean desktop IPC default at the end**.
- Remote services: **keep existing configurable HTTP/WS server**.

## Components

### Local IPC Crate

Add a shared workspace crate, `lexera-local-ipc`, used by both Tauri apps.

Responsibilities:

- Unix domain sockets on macOS/Linux.
- Windows named pipes on Windows.
- Length-prefixed frames with `request_id`, `frame_type`, and protocol version.
- Typed request/response frames for API calls, asset reads, uploads, streams, logs, and local sync.
- Bounded chunk streaming for large assets and uploads.

Frame encoding:

- Codec: **postcard**. Chosen for format-stability guarantees over bincode and smaller dep/footprint than MessagePack; both ends are Rust so cross-language support is not needed.
- Control/stream/asset/upload frames use typed Rust enums. Additive enum variants evolve the protocol without breaking older readers that reject unknown variants.
- `ApiRequest` / `ApiResponse` **byte-tunnel** serialized `http::Request` / `http::Response` (including headers and body) rather than translating into a custom struct. The backend feeds the received request into the same Axum router it serves over TCP, so route-parity is free.
- Every frame carries a `correlation_id` (UUID v4) generated by the webview caller and propagated through Kanban Rust to the backend. Logs on all three layers tag with this id.
- Cancellation is explicit: a `Cancel { correlation_id }` control frame from client to server aborts an in-flight request or stream. The server must release any pending work for that id. Channel close is a transport fault, not a cancel signal.

Protocol version: `lexera-local-ipc/v1`. Version mismatches are rejected; they are not negotiated.

### Backend IPC Server

`lexera-backend` starts a local IPC listener alongside the HTTP server.

Responsibilities:

- Publish a per-user descriptor in Lexera's existing config directory.
- Authenticate local clients through a random per-start secret in that descriptor.
- Route `ApiRequest` frames through the existing backend route semantics without using TCP.
- Route `AssetRequest` frames through backend path validation and media/file access rules.
- Bridge backend events, logs, and local sync updates into IPC streams.

Descriptor file:

- Lives next to the existing `sync.json` and `identity.json` in the same `lexera` config directory resolved through `dirs::config_dir()` (the helper the backend already uses). Concrete paths:
  - macOS: `~/Library/Preferences/lexera/ipc.json`
  - Windows: `%APPDATA%\lexera\ipc.json`
  - Linux: `~/.config/lexera/ipc.json` (or `$XDG_CONFIG_HOME/lexera/ipc.json` if set)
- Filename constant lives in `lexera-local-ipc` as `descriptor::DESCRIPTOR_FILENAME = "ipc.json"` (single source of truth, reused by both ends rather than duplicated into the backend's `config.rs`).
- Write is atomic: write a sibling temp file in the same directory, `fsync`, then `rename` over the target.
- Mode `0600` on Unix. On Windows, ACL restricts to the current user.
- Contents: `{ "protocol": "lexera-local-ipc/v1", "endpoint": "<path>", "pid": <u32>, "secret": "<base64 32 bytes>", "started_at": "<rfc3339>" }`.
- Secret is regenerated on every backend start and never persisted across restarts.
- Graceful shutdown best-effort removes the descriptor. Crash leaves it; pid-liveness plus secret mismatch handle that case.

The backend HTTP/WS server remains the network boundary for external clients.

### Kanban Rust Bridge

`lexera-kanban` adds Tauri commands that talk to the backend IPC server.

Required command surface:

- `backend_ipc_status`
- `backend_ipc_request`
- `backend_ipc_upload`
- `backend_ipc_stream_open`
- `backend_ipc_stream_close`
- `backend_asset_url`

The command layer owns backend discovery, reconnects, correlation IDs, and error normalization. The webview should not know whether a request is carried by IPC or HTTP.

`backend_ipc_upload` streams the request body in chunks (same policy as asset streaming, target 64–256 KiB per chunk) so large imports do not require a full in-memory buffer on either side.

Per-stream backpressure defaults to oldest-drop with a bounded buffer. Streams that require different semantics (for example, presence updates where only the latest state matters) may override per subscription, but the override is explicit and documented at the subscription site.

### Frontend Transport

Add a transport abstraction behind `LexeraApi`.

Modes, selected by the `LEXERA_TRANSPORT` setting (env var, with config file override):

- `local-ipc`: Tauri desktop mode. No localhost HTTP fallback.
- `http`: browser, web clipper, remote, and development fallback mode.
- `auto` (default): startup selection only. Resolves to `local-ipc` inside the Tauri desktop runtime and to `http` outside it. It resolves once and does not silently switch mid-session.

The `http` override on desktop exists only for triage and early-phase rollout. Phase 7 removes it from desktop builds; a future remote-backend-from-desktop mode, if ever needed, is a separate feature.

In Tauri desktop mode:

- `LexeraApi.request()` uses Tauri commands.
- `LexeraApi.fileUrl()` returns opaque `lexera-asset` URLs.
- `LexeraApi.mediaUrl()` returns opaque `lexera-asset` URLs.
- `connectSSE`, `connectLogStream`, and `connectSync` become event/channel-backed adapters with the same frontend-facing behavior.

### Lexera Asset Protocol

Register a Kanban-side custom scheme, `lexera-asset`, for renderable local resources.

Rules:

- URLs are opaque to JavaScript. The frontend obtains them through `backend_asset_url`.
- Platform-specific URL forms are hidden behind that helper.
- URLs do not contain bearer tokens or raw filesystem paths.
- The Kanban protocol handler forwards asset requests to the backend over authenticated local IPC.
- The backend remains the authority for board lookup, path resolution, MIME type, ETag, cache headers, Range requests, and traversal protection.
- Large assets stream in chunks instead of loading fully into memory. Target chunk size 64–256 KiB. Chunks are bounded by a per-stream buffer with oldest-drop policy matching current SSE behavior.
- When the webview aborts a request or navigates away, the Kanban Rust handler cancels the correlation id; the backend drops the pending stream immediately.
- CSP for the Kanban window must list `lexera-asset:` in `img-src`, `media-src`, `object-src`, and `frame-src` so images, audio/video, PDFs, and diagram previews load without CSP violations.

This protocol replaces localhost URLs for:

- Images and attachments.
- Audio/video previews.
- PDF/document previews.
- Draw.io render output.
- Excalidraw render output.
- PlantUML render output.
- Mermaid runtime assets and rendered previews.
- Other diagram/cache artifacts under board media/cache directories.

## Security Model

- HTTP bearer auth remains unchanged for remote/browser clients.
- Desktop-local IPC does not use HTTP bearer tokens.
- The backend descriptor contains endpoint, pid, protocol version, and a random per-start secret.
- Descriptor writes are atomic and restricted to the current OS user: mode `0600` on Unix, per-user ACL on Windows.
- Three independent gates authenticate the IPC channel (defense in depth):
  1. Filesystem permissions on the descriptor prevent other users from reading the secret.
  2. The descriptor secret, sent in the handshake frame, binds the connection to this backend start.
  3. OS peer credentials on the accept side (`SO_PEERCRED` / `getpeereid` on Unix, equivalent pipe ownership check on Windows) verify the connecting process runs as the same user.
- A stale descriptor is rejected by pid liveness and secret mismatch.
- Asset URLs carry no query-string auth token. Authority comes from the authenticated IPC channel behind the Kanban asset handler.
- No broad generic filesystem asset scope should expose arbitrary user paths to the webview. Backend validation stays authoritative.
- New Kanban Tauri commands are granted only to trusted Kanban windows through Tauri capabilities.

## Backend Lifecycle and Failure Behavior

The frontend must tolerate the backend being absent, restarting, or upgrading.

- If the descriptor is missing, Kanban shows a backend-unavailable state and waits for the descriptor to appear. Discovery uses an OS filesystem watcher (FSEvents / inotify / ReadDirectoryChangesW) plus a single sanity read on startup to cover the race where the file already existed before the watcher was registered. No polling timers.
- Kanban Rust emits a single Tauri event, `backend-status`, with payload `{ state: "connected" | "waiting" | "reconnecting" | "unavailable", reason?: string }`. The webview renders the waiting state from this event; no other source of connection state exists.
- If the backend restarts, existing IPC requests fail with a typed `BackendUnavailable` error.
- Kanban re-reads the descriptor, reconnects, and re-subscribes to events/logs/sync streams.
- Board state reconciliation uses the existing storage and CRDT paths, not IPC replay.
- Tauri desktop mode must not silently fall back to localhost HTTP, because that would hide migration regressions.

## Rendering and Diagram Impact

Rendering is the most important validation area for this migration.

- Draw.io and Excalidraw can keep using the existing Kanban Rust render commands, but the resulting previews must be addressed through `lexera-asset`.
- `requestFileInfo`, `convert-path`, media manifests, file preview reads, and cache freshness checks move through IPC.
- The `-Media` cache nesting bug cited in earlier drafts is already fixed in `lexera-kanban/src/export/exportService.js` `buildDiagramCacheDir()` (~L930): when `sourceDirBase` ends in `-Media` the cache folder is reused rather than nested. No additional change needed in Phase 4.
- Mermaid assets are bundled inside `lexera-kanban` and loaded through `lexera-asset`. Desktop rendering does not depend on a CDN. Serving Mermaid from the backend was considered and rejected because the extra IPC hop per render yields no benefit when only the kanban frontend consumes it.
- Preview code should not assemble backend URLs manually. It should use `LexeraApi.fileUrl()`, `LexeraApi.mediaUrl()`, or an explicit asset helper.

## Migration Phases

### Phase 1: IPC Foundation

- Add `lexera-local-ipc`.
- Implement descriptor read/write, handshake, frame encoding, and basic request/response tests.
- Backend writes the descriptor on startup, but no frontend code consumes it yet.

Exit criteria:

- Wrong secret, stale pid, wrong protocol version, and cross-user endpoint attempts are rejected.
- Existing HTTP behavior is unchanged.

### Phase 2: Backend IPC Adapter

- Add backend IPC listener.
- Route representative API requests through the existing backend route semantics without TCP.
- Add asset request frames for validated file/media reads.

Exit criteria:

- IPC and HTTP return matching status/body/headers for selected route parity tests.
- Asset tests cover MIME, ETag, Range, not-found, forbidden, and traversal cases.

### Phase 3: Kanban Transport Layer

- Add Kanban IPC commands.
- Add `local-ipc` transport behind `LexeraApi`.
- Keep HTTP mode available for browser/dev/remote contexts.
- Gate desktop IPC behind a feature/config flag until parity is proven.

Exit criteria:

- In IPC mode, `LexeraApi.request()`, `fileUrl()`, and `mediaUrl()` do not produce localhost URLs.
- Feature modules no longer call raw backend `fetch` outside the approved transport layer.

### Phase 4: Asset Protocol and Render Previews

- Register `lexera-asset`.
- Migrate file/media URLs and preview render outputs.
- Fix the diagram cache media-directory nesting bug.
- Vendor or locally serve Mermaid assets.

Exit criteria:

- Draw.io, Excalidraw, PlantUML, Mermaid, image, audio/video, and PDF previews render without localhost requests.
- Large media seek behavior works through Range requests.

### Phase 5: Streams and Local Sync

- Replace `/events` SSE, `/logs/stream`, and local board WebSocket usage with IPC stream adapters.
- Preserve remote WebSocket sync for mobile, LAN, and backend-to-backend peers.

Exit criteria:

- Event, log, and sync behavior matches the current UI contract.
- Backend restart reconnects streams without switching to HTTP.

### Phase 6: Backend-Owned Windows

- Move connection settings and quick capture off localhost fetches.
- Use direct Tauri commands/events because these windows already belong to the backend process.

Exit criteria:

- Backend-owned windows work even when the desktop UI is not allowed to use HTTP.

### Phase 7: Flip Desktop Default

- Make `local-ipc` the default Tauri desktop transport.
- Keep HTTP mode only for browser/dev/remote clients.
- Delete `backendDiscovery.js` from the desktop runtime bundle (keep it only on code paths that target browser/dev). The port-range probe must not be reachable from the desktop app.
- Remove the `http` override from desktop builds.
- Enforce regression guards in two layers:
  - ESLint rule banning `fetch`, `new EventSource`, and `new WebSocket` outside approved transport modules. Fails locally on save.
  - CI grep check against the same patterns as a backstop for bypasses (`eslint-disable`, dynamic construction).

Exit criteria:

- Starting Kanban and loading boards, media, diagrams, logs, and sync produces no desktop-local `localhost` or `127.0.0.1` requests.
- Quitting Kanban leaves `lexera-backend` running and serving configured external clients.

## Test Plan

- Rust IPC tests for handshake, framing, descriptor lifecycle, stale descriptors, auth failures, stream cancellation, and chunked transfer.
- Backend parity tests comparing IPC and HTTP behavior for boards, media, file info, config, dashboard, export, events, and logs.
- Asset protocol tests for board boundary enforcement, MIME detection, ETag/304, Range/206, cache headers, and traversal rejection.
- Frontend tests for transport selection, URL generation, stream adapters, upload behavior, and no raw desktop-local network calls outside the transport layer.
- Rendering regression tests for Draw.io, Excalidraw, PlantUML, Mermaid, images, PDF, audio, and video.
- End-to-end tests verifying no local desktop HTTP traffic while remote/browser/mobile services still work over HTTP/WS.

## Acceptance Criteria

- `lexera-backend` remains independent and continues running after Kanban exits.
- Desktop Kanban no longer uses loopback HTTP/WS for backend API calls, assets, logs, events, or local sync.
- Remote/browser/mobile integrations continue using the existing configurable HTTP/WS server.
- Diagram and Excalidraw previews render through asset-protocol URLs with no CORS failure path.
- HTTP bearer auth remains unchanged for remote clients.
- Desktop asset URLs do not expose bearer tokens or raw absolute file paths.
- The migration preserves existing REST semantics before any deeper backend service refactor.

## Open Decisions

All originally-open decisions are now resolved.

### Resolved

- **Descriptor directory** — reuse the existing `dirs::config_dir()/lexera/` directory (same parent as `sync.json` and `identity.json`). No new convention introduced.
- **`/collab/me` in local mode** — return a sentinel local identity with the token field set to `null`. Response keeps `{id, name, email, token}` shape so shared UI code does not branch.
- **Post-Phase-7 `http` override on desktop** — removed. A future remote-backend-from-desktop product mode, if ever requested, ships as a separate feature rather than by preserving migration scaffolding.
- **Mermaid delivery** — bundled inside `lexera-kanban` and loaded via `lexera-asset`. Backend-served Mermaid was rejected: no second consumer, extra IPC hop per render.
- **Backend absence UX** — confirmed: wait state, no on-demand launch. Kanban does not own backend lifecycle.
