## Lexera Kanban v2

### Completed
- [x] "Open in system application" on embedded files doesn't open anything
- [x] Add "Show in Finder" option for embedded files
- [x] Board list sidebar: add unfold/expand to list all columns within each board
- [x] Right-clicking on file elements (embeds, links) should show context menu with: open file (same as alt+click), show in Finder

### Open

- [x] The minimal height of all rows combined must be the height of the viewport. Rows should fill the view vertically so there is no dead space below the board.

- [ ] Drag-and-drop must never modify the layout structure. No layout shifts during drag operations. Follow the v1 pattern: dimension-lock containers during drag to prevent flex reflow. Visual-only feedback (opacity, box-shadow). Drop zones: one at the far left, one at the far right, and one between each stack — fixed size, no expanding. No other drop zones.

- [ ] Split view: allow viewing 2 or more boards simultaneously by splitting the view vertically or horizontally. Each split pane is an independent board view with its own board selection.

---

### Backend — Working (local-only)

These features are implemented and functional for single-user local operation:

- [x] Local board storage with atomic writes (tmp → fsync → rename)
- [x] Markdown parsing: legacy (`##` columns) and hierarchical (`#`/`##`/`###` rows/stacks/columns)
- [x] File watcher with 500ms debounce (notify-debouncer-full, macOS FSEvents)
- [x] Self-write suppression via SHA-256 fingerprinting
- [x] 3-way card-level merge (base=cached, theirs=disk, ours=incoming)
- [x] Card identity tracking via `<!-- kid:XXXXXXXX -->` markers
- [x] Conflict backup files (`board.conflict-{timestamp}.md`)
- [x] Include file support (`!!!include(path)!!!`, slide format `---` separator)
- [x] Bidirectional include map (board↔include path tracking)
- [x] REST API: boards, columns, cards, files, search, media upload
- [x] SSE event stream for local file change notifications
- [x] ETag/versioning for conditional requests (304 Not Modified)
- [x] Config loading (`~/.config/lexera/sync.json`)
- [x] Local identity (`~/.config/lexera/identity.json`, auto-generated UUID)
- [x] System tray app (macOS menu bar only)
- [x] Quick capture + clipboard watcher

---

### Backend — Collaboration Scaffolding (in-memory, non-persistent)

These modules exist but are purely in-memory. All data is lost on restart. No network communication exists.

- [~] AuthService: user/role management (Owner/Editor/Viewer), no real auth (user ID via `?user=` query param)
- [~] InviteService: invite link generation with expiry/usage limits, acceptance, revocation
- [~] PublicRoomService: room publicity toggle, member counting, max_users
- [~] Collaboration API endpoints: 12 routes under `/collab/`
- [~] Local user bootstrapped as Owner of all boards on startup
- [~] Hourly cleanup task for expired invites

---

### Plan: Required Features for Working Multi-User Sync

#### Phase 1 — Persistence Layer
Without persistence, collaboration services are useless (data lost on restart).

- [ ] **1.1 — Persist collaboration data to disk**
  - AuthService: users, memberships → JSON file (`~/.config/lexera/collab/auth.json`)
  - InviteService: active invites → JSON file (`~/.config/lexera/collab/invites.json`)
  - PublicRoomService: public room settings → JSON file (`~/.config/lexera/collab/rooms.json`)
  - Write on every mutation, load on startup
  - Keep the current in-memory structures as cache, persist as write-through

- [ ] **1.2 — Config: add collaboration settings to sync.json**
  - `collab.enabled: bool` — master toggle
  - `collab.listen_address: string` — bind address (default `0.0.0.0` for LAN, `127.0.0.1` for local-only)
  - `collab.discovery: "manual" | "mdns"` — how peers find each other
  - `collab.shared_boards: [board_id]` — which boards are shared

#### Phase 2 — Authentication & Security
Currently: no auth at all (user ID passed as query param). Must fix before exposing to network.

- [ ] **2.1 — Token-based authentication**
  - On registration/login: issue a signed JWT or opaque session token
  - All API requests require `Authorization: Bearer <token>` header
  - Remove `?user=` query param authentication
  - Token stored client-side, refreshed on reconnect

- [ ] **2.2 — TLS for HTTP server**
  - Generate self-signed cert on first run (stored in `~/.config/lexera/certs/`)
  - Or accept user-provided cert path in config
  - HTTPS required for all non-localhost connections

- [ ] **2.3 — Invite link security**
  - Invite tokens become one-time-use auth bootstrap tokens
  - Accepting an invite registers the remote user and issues a session token
  - Invite links include server address + port + token

#### Phase 3 — Network Sync Protocol
Currently: file watcher + SSE only works for local clients on same machine. Need actual network sync.

- [ ] **3.1 — Replace SSE with WebSocket for bidirectional communication**
  - SSE is one-way (server→client). WebSocket allows client→server push
  - Endpoint: `ws://host:port/sync`
  - Message types: `board_changed`, `board_update`, `presence`, `cursor_position`
  - Per-board subscription: clients subscribe to specific board IDs
  - Reconnection with version catch-up (client sends last known version)

- [ ] **3.2 — Board sync protocol**
  - **Pull**: client sends `{board_id, last_version}` → server responds with full board or delta if version differs
  - **Push**: client sends `{board_id, content, base_version}` → server does 3-way merge → broadcasts result
  - Leverage existing merge infrastructure (already has 3-way card-level merge)
  - Version vector per board (monotonic counter already exists, extend to per-user vectors for true distributed sync)

- [ ] **3.3 — Conflict resolution over network**
  - Current 3-way merge works for local (disk vs cache vs incoming)
  - Extend: when two remote clients push simultaneously, server merges both against shared base
  - On unresolvable conflict: server picks winner (last-write-wins or owner priority), notifies loser with diff
  - Conflict backup still created on server side

#### Phase 4 — Peer Discovery & Connection Management

- [ ] **4.1 — mDNS/DNS-SD discovery (LAN)**
  - Advertise service via `_lexera._tcp.local` using mdns-sd crate
  - Other Lexera instances auto-discover peers on same network
  - Show discovered peers in UI, user chooses to connect

- [ ] **4.2 — Manual peer connection**
  - User enters `host:port` + invite token to connect to a remote instance
  - Connection persisted in config for auto-reconnect

- [ ] **4.3 — Connection state management**
  - Track connected peers per board: `{user_id, display_name, last_seen, status}`
  - Heartbeat/ping-pong over WebSocket (30s interval)
  - Graceful disconnect notification
  - Reconnection with exponential backoff

#### Phase 5 — Shared File Sync (boards + media + includes)

- [ ] **5.1 — Board file sync**
  - Primary mechanism: exchange parsed board data over WebSocket (not raw file content)
  - Server is authority: receives edits, merges, broadcasts canonical state
  - Clients apply received state to their local file (using existing atomic write)

- [ ] **5.2 — Include file sync**
  - Include files referenced by shared boards must also be synced
  - Leverage existing IncludeMap to identify which includes belong to which boards
  - Same merge strategy (slide-level, using existing slide_parser)

- [ ] **5.3 — Media file sync**
  - Media files (images, attachments) need transfer between peers
  - Content-addressable: hash-based dedup (already using SHA-256)
  - On-demand pull: when client encounters unknown media reference, request from server
  - Upload endpoint already exists (`POST /boards/:id/media`), extend with hash-based check

#### Phase 6 — Presence & Awareness

- [ ] **6.1 — User presence on boards**
  - Broadcast which users are viewing/editing which board
  - Show active users in board header (avatar/initials + name)

- [ ] **6.2 — Card-level editing indicators**
  - When user is editing a card, broadcast card ID + user to peers
  - Show "being edited by X" indicator on card
  - Optional: lock card while being edited (pessimistic) or allow concurrent (optimistic with merge)

---

### Implementation Priority / Suggested Order

1. **Phase 1** (persistence) — prerequisite for everything, small scope
2. **Phase 2** (auth) — must have before exposing to network
3. **Phase 3** (network sync) — core value, builds on existing merge
4. **Phase 4** (discovery) — usability, can start with manual-only
5. **Phase 5** (file sync) — completes the picture for real usage
6. **Phase 6** (presence) — nice-to-have, can defer

### Architecture Decision: Hub-and-Spoke vs Peer-to-Peer

The current codebase is structured as a **server** (Axum HTTP). Two viable paths:

**Option A: Hub-and-Spoke (recommended for v1)**
- One Lexera instance acts as "host", others connect as clients
- Host has the authoritative board files
- Simpler conflict resolution (single merge point)
- Matches existing API structure

**Option B: Peer-to-Peer (future)**
- All instances are equal, sync directly
- Requires CRDT or vector clocks for convergence
- More complex but resilient (no single point of failure)
- Could evolve from Option A by making the merge logic symmetric

## Misc Tasks

- [ ] add a 