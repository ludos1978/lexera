# WebDAV Feature — Bookmark & Calendar Sync for Ludos Kanban

> Plan created: 2026-02-14
> Status: Architecture decided, ready for implementation

---

## 1. Goal

Bidirectional sync between browser bookmarks (Firefox, Chrome, Vivaldi) and Ludos kanban markdown files — and later calendar apps — using standard protocols. No proprietary formats, no cloud dependency, no manual import/export.

**User story:** I add a bookmark in Firefox → it appears as a kanban card in Ludos. I create a card with a URL in Ludos → it appears in my browser bookmarks. Same for calendar events with deadlines.

---

## 2. Architecture Overview

Ludos runs a local protocol server that speaks WebDAV (and later CalDAV). External applications connect to it using their native sync capabilities — no custom plugins, no forks, no modifications to third-party software.

```
┌─────────────────┐         ┌──────────────────────────────────────────┐
│  Firefox         │         │  Ludos (VS Code Extension)               │
│  Chrome/Vivaldi  │◄─Floccus─►  Nephele WebDAV Server (localhost)     │
│  (+ Floccus ext) │  XBEL   │       │                                 │
└─────────────────┘         │       ▼                                 │
                            │  Ludos Adapter                          │
┌─────────────────┐         │  (XBEL ↔ Kanban Markdown)              │
│  Thunderbird     │         │       │                                 │
│  Apple Calendar  │◄─CalDAV──►      │  (iCal ↔ Kanban Markdown)      │
│  GNOME Calendar  │  iCal   │       │                                 │
└─────────────────┘         │       ▼                                 │
                            │  Kanban .md files                       │
┌─────────────────┐         │       │                                 │
│  Contacts apps?  │◄─CardDAV─►     │  (Future)                       │
└─────────────────┘         └──────────────────────────────────────────┘
```

**Key insight:** WebDAV, CalDAV, and CardDAV are all HTTP-based extensions of the same protocol. Building the WebDAV foundation enables incremental CalDAV/CardDAV addition later. Ludos becomes a **local protocol hub** speaking standard formats.

---

## 3. Why This Architecture

### 3.1 Alternatives Considered & Rejected

| Approach | Why rejected |
|----------|-------------|
| **buku** (CLI bookmark manager) | Manual import/export only, browsers must be closed, no live sync |
| **GoSuki** (real-time bookmark monitor) | Limited Windows support (WSL2 only), no native markdown export |
| **Floccus + Git + XBEL→md converter** | Too many conversion steps, fragile pipeline |
| **Custom minimal browser extension** | Rebuilds years of solved problems (tree diffing, folder structures, edge cases) |
| **Native Messaging** | Requires OS-specific manifest files + registry entries (Windows), often flagged by antivirus, installation complexity across 3 browsers × 3 OSes |
| **Shared file (browser ext writes .md)** | Browser extensions cannot write arbitrary filesystem paths (only `browser.storage.local` internal DB). Dead end without Native Messaging |
| **Direct browser file manipulation** | Chrome/Vivaldi JSON writable while running, but Firefox places.sqlite has WAL locks. Would still need a tiny extension for Firefox |

### 3.2 Why Floccus + Local WebDAV Wins

- **Floccus** is a battle-tested browser extension (7.5k GitHub stars, actively maintained Jan 2026) that already handles all browser bookmark API complexity, tree diffing, conflict resolution, folder structures, and edge cases across Firefox/Chrome/Edge/Vivaldi/Brave.
- **Floccus already speaks WebDAV** natively — it's one of its built-in sync backends.
- **LoFloccus** (github.com/TCB13/LoFloccus) is a companion app that proves Floccus + local WebDAV works in practice. It's a self-contained WebDAV server restricting access to `*.xbel` and `*.html` files.
- Ludos doesn't modify or fork Floccus at all. Users install Floccus from the browser extension store and point it at `localhost:<port>`. Zero coupling.

---

## 4. Core Library: Nephele

**Nephele** (github.com/sciactive/nephele) is a pluggable WebDAV, CardDAV, and CalDAV server for Node.js and Express.

- **License:** Apache 2.0 (fully permissive, no copyleft)
- **Architecture:** Adapter pattern — Nephele handles all DAV protocol complexity (PROPFIND, PROPPATCH, LOCK, REPORT, ETags, etc.), you write an adapter that maps resources to your storage backend.
- **Built on Express** — same ecosystem as VS Code extensions, rock-solid HTTP foundation.
- **CalDAV/CardDAV on roadmap** — future expansion path built into the same library.
- **Strict RFC compliance** — follows all MUST/SHOULD/RECOMMENDED behaviors from RFC4918.

### 4.1 What Nephele gives us for free

- All DAV protocol handling (HTTP methods: PROPFIND, PROPPATCH, MKCOL, LOCK, UNLOCK, COPY, MOVE, REPORT)
- ETag-based conflict detection (prevents overwriting concurrent changes)
- Collection management (folders ↔ kanban columns)
- Proper HTTP compliance that Floccus and calendar apps expect
- Pluggable authenticator system (we just accept localhost)

### 4.2 What we build

A **Nephele adapter** (~200–300 lines) that maps WebDAV resources to kanban markdown content instead of a filesystem.

---

## 5. Data Format Mappings

### 5.1 Bookmarks: XBEL ↔ Kanban Markdown

XBEL (XML Bookmark Exchange Language) is what Floccus uses over WebDAV.

**XBEL structure:**
```xml
<xbel version="1.0">
  <folder>
    <title>Column Name</title>
    <bookmark href="https://example.com">
      <title>Task Title</title>
    </bookmark>
    <bookmark href="https://other.com">
      <title>Another Task</title>
    </bookmark>
  </folder>
</xbel>
```

**Kanban markdown equivalent:**
```markdown
## Column Name
- [ ] [Task Title](https://example.com)
- [ ] [Another Task](https://other.com)
```

**Mapping rules:**
- `<folder>` ↔ `## Column Title` (kanban column)
- `<bookmark href="url"><title>text</title></bookmark>` ↔ `- [ ] [text](url)` (kanban task)
- Nested `<folder>` elements → tasks with indented sub-items or separate columns (configurable)
- XBEL `<desc>` element → task description lines below the `- [ ]` line

**Translation layer:** ~50–80 lines using `fast-xml-parser` (MIT license) for XBEL parsing.

### 5.2 Calendar: iCal ↔ Kanban Markdown (Phase 2)

Kanban tasks with temporal tags map to iCal events/todos:

**Kanban task:**
```markdown
- [ ] Submit quarterly report !15.03.2026 !09:00-10:00 #deadline
```

**iCal equivalent:**
```
BEGIN:VCALENDAR
BEGIN:VTODO
SUMMARY:Submit quarterly report
DTSTART:20260315T090000
DUE:20260315T100000
CATEGORIES:deadline
STATUS:NEEDS-ACTION
END:VTODO
END:VCALENDAR
```

**Mapping rules:**
- `- [ ] title` → `VTODO` with `STATUS:NEEDS-ACTION`
- `- [x] title` → `VTODO` with `STATUS:COMPLETED`
- `!DD.MM.YYYY` / `!YYYY-MM-DD` → `DTSTART` (respects `markdown-kanban.dateLocale` setting)
- `!HH:MM-HH:MM` → `DTSTART` time + `DUE` time
- `!WNN` (week number) → calculated date range for `DTSTART`/`DTEND`
- `#tag` → `CATEGORIES:tag`
- Task description → `DESCRIPTION` field

**Library:** `node-ical` (MIT) for iCal parsing/generation.

---

## 6. Component Design

### 6.1 New Files

```
src/
  sync/
    SyncServer.ts              # Starts/stops Nephele Express server
    SyncConfig.ts              # Port, enabled protocols, column mapping config
    adapters/
      BookmarkAdapter.ts       # Nephele adapter: XBEL ↔ KanbanBoard
      CalendarAdapter.ts       # Nephele adapter: iCal ↔ KanbanBoard (Phase 2)
    mappers/
      XbelMapper.ts            # XBEL XML ↔ KanbanTask/KanbanColumn translation
      ICalMapper.ts            # iCal ↔ KanbanTask translation (Phase 2)
    auth/
      LocalhostAuth.ts         # Accept all connections from 127.0.0.1, reject others
```

### 6.2 Integration with Existing Architecture

The sync server integrates through the existing event bus:

```
SyncServer
    │
    ├── On incoming WebDAV PUT/DELETE → emits 'board:changed' with trigger 'sync'
    │     (goes through BoardStore → FileCoordinator → saves .md)
    │
    └── Listens to 'board:changed' → updates internal XBEL/iCal cache
          (so next Floccus PROPFIND sees the latest state)
```

**New BoardChangeTrigger value:** `'sync'` added to `EventTypes.ts`

**New event type (optional):** `'sync:connected'` / `'sync:disconnected'` for status bar indicator.

### 6.3 VS Code Settings (in `package.json` contributes.configuration)

```jsonc
{
  "markdown-kanban.sync.enabled": {
    "type": "boolean",
    "default": false,
    "description": "Enable local WebDAV/CalDAV sync server"
  },
  "markdown-kanban.sync.port": {
    "type": "number",
    "default": 0,
    "description": "Port for sync server (0 = auto-select available port)"
  },
  "markdown-kanban.sync.bookmarkColumn": {
    "type": "string",
    "default": "Bookmarks",
    "description": "Column title to sync bookmarks into. Created if missing."
  },
  "markdown-kanban.sync.calendarColumns": {
    "type": "array",
    "default": [],
    "description": "Columns containing calendar-synced tasks (empty = all columns with temporal tags)"
  }
}
```

### 6.4 SyncServer Lifecycle

```
Extension activates
    │
    ▼
Check markdown-kanban.sync.enabled
    │ (false → do nothing)
    │ (true ↓)
    ▼
Start Nephele on localhost:<port>
    │
    ├── Register BookmarkAdapter at /bookmarks/
    ├── Register CalendarAdapter at /calendars/ (Phase 2)
    └── Show status bar item: "📌 Sync: localhost:PORT"
    │
    ▼
Serve until extension deactivates or user disables
```

**Port selection:** Default `0` means auto-select. The chosen port is stored in workspace state and displayed in the status bar so the user can configure Floccus to connect to it.

**No admin/root required:** Ports > 1024 need no special permissions on any OS.

---

## 7. License Analysis

All dependencies are license-clean for any Ludos license:

| Component | License | Obligation |
|-----------|---------|------------|
| **Nephele** | Apache 2.0 | Permissive, include notice |
| **Floccus** | MPL-2.0 | None (used as separate unmodified extension from store) |
| **fast-xml-parser** | MIT | Permissive |
| **node-ical** | MIT | Permissive |
| **caldav-adapter** (fallback) | MIT | Permissive |

**Floccus detail:** MPL-2.0 with "Incompatible With Secondary Licenses" header. This only matters if you modify and redistribute Floccus source files — it prevents relicensing those files under GPL/LGPL/AGPL. Since Ludos uses Floccus as a completely separate, unmodified browser extension installed from the store, there are zero license obligations. This is analogous to shipping a tool that works with Firefox (also MPL-2.0) — using a program is not the same as incorporating its code.

---

## 8. Implementation Phases

### Phase 1: WebDAV Bookmark Sync (MVP)
**Effort:** ~3–4 sessions (~12 hours)
**Dependencies:** `nephele`, `fast-xml-parser`

- [ ] **1.1** `SyncServer.ts` — Start/stop Nephele Express server on extension activate/deactivate
- [ ] **1.2** `LocalhostAuth.ts` — Accept connections from 127.0.0.1 only
- [ ] **1.3** `XbelMapper.ts` — Bidirectional XBEL ↔ KanbanTask/KanbanColumn translation
- [ ] **1.4** `BookmarkAdapter.ts` — Nephele adapter that reads/writes via XbelMapper to the board
- [ ] **1.5** `SyncConfig.ts` — VS Code settings integration (port, enabled, bookmark column)
- [ ] **1.6** Status bar indicator showing sync server state and port
- [ ] **1.7** Event bus integration: incoming WebDAV changes → `board:changed` with `trigger: 'sync'`
- [ ] **1.8** Event bus integration: `board:changed` from UI → update XBEL cache for next Floccus poll
- [ ] **1.9** Test with Floccus: create bookmark in browser → appears in kanban → edit in kanban → appears in browser

**Definition of done:** Round-trip bookmark sync working with Floccus in Firefox and Chrome.

### Phase 2: CalDAV Calendar Sync
**Effort:** ~3–4 sessions (~12 hours)
**Dependencies:** `node-ical` (or Nephele's built-in CalDAV when ready)

- [ ] **2.1** `ICalMapper.ts` — Bidirectional iCal ↔ KanbanTask translation (respecting `dateLocale` setting)
- [ ] **2.2** `CalendarAdapter.ts` — Nephele adapter for CalDAV resources
- [ ] **2.3** Register CalDAV endpoint at `/calendars/` on same server
- [ ] **2.4** Map existing temporal tags (`!DD.MM.YYYY`, `!HH:MM-HH:MM`, `!WNN`) to VEVENT/VTODO
- [ ] **2.5** Map `- [ ]` / `- [x]` checkbox state to VTODO STATUS
- [ ] **2.6** Map `#tag` to CATEGORIES
- [ ] **2.7** Test with Thunderbird, Apple Calendar, GNOME Calendar

**Definition of done:** Calendar app shows kanban tasks with temporal tags. Creating an event in the calendar app creates a task in the kanban.

### Phase 3: Polish & Edge Cases
**Effort:** ~2 sessions (~8 hours)

- [ ] **3.1** Conflict resolution: what happens when Floccus and UI edit the same bookmark simultaneously?
- [ ] **3.2** Folder-to-column mapping configuration (which XBEL folders map to which kanban columns)
- [ ] **3.3** Bookmark metadata preservation (favicons, descriptions, tags)
- [ ] **3.4** Auto-start option: start sync server when workspace opens
- [ ] **3.5** Documentation: setup guide for Floccus configuration, calendar app configuration
- [ ] **3.6** Handle included columns/tasks correctly (don't sync include-mode items)

### Phase 4: CardDAV Contacts (Future/Optional)
**Effort:** TBD

- [ ] **4.1** Evaluate use case: contacts as kanban cards with metadata
- [ ] **4.2** VCard ↔ KanbanTask mapping

---

## 9. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Nephele CalDAV not production-ready yet | Medium | Use `caldav-adapter` (MIT, Koa-based) as fallback, or implement minimal CalDAV on raw Nephele WebDAV |
| Nephele adapter API changes before 1.0 | Medium | Pin version, adapter code is small (~200–300 lines) and easy to update |
| Floccus sync interval too slow for real-time feel | Low | Floccus supports manual sync trigger + configurable intervals (down to 1 min). Document recommended settings. |
| Port conflicts on localhost | Low | Auto-select port (default `0`), store in workspace state, display in status bar |
| Corporate firewalls blocking localhost listeners | Low | Localhost WebSocket/HTTP is least likely to be blocked. Windows Firewall may show dialog on first run — document this. |
| Chrome Manifest V3 service worker lifecycle | Low | Floccus handles this already. Chrome 116+ supports keepalive for WebSocket in service workers (send message every 20s). Firefox never had this limitation. |

---

## 10. npm Dependencies to Add

```jsonc
// package.json dependencies
{
  "nephele": "^1.0.0-alpha",       // WebDAV/CalDAV server engine (Apache 2.0)
  "@nephele/adapter-virtual": "...", // Reference adapter for custom implementation
  "fast-xml-parser": "^4.0.0",      // XBEL parsing (MIT)
  "node-ical": "^0.22.0"            // iCal parsing/generation (MIT) — Phase 2
}
```

**Bundle size impact:** Nephele is built on Express which is lightweight. The XML parser and iCal library are small. Total addition estimated at ~500KB bundled.

---

## 11. User Setup Guide (Draft)

### Bookmark Sync

1. **Enable sync** in VS Code settings: `Ludos Markdown Kanban > Sync > Enabled: true`
2. **Note the port** shown in the status bar (e.g., "📌 Sync: localhost:36419")
3. **Install Floccus** in your browser(s) from the extension store
4. **Configure Floccus:**
   - Sync method: **WebDAV**
   - URL: `http://localhost:36419/bookmarks/`
   - No username/password needed (localhost only)
   - Sync interval: 5 minutes (or as desired)
5. Bookmarks now sync bidirectionally with your kanban board

### Calendar Sync (Phase 2)

1. Same server, different endpoint: `http://localhost:36419/calendars/`
2. In Thunderbird/Apple Calendar/GNOME Calendar: Add CalDAV account pointing to that URL
3. Tasks with temporal tags appear as calendar events, and vice versa

---

## 12. Relationship to Existing Ludos Architecture

This feature touches minimal existing code:

- **EventTypes.ts**: Add `'sync'` to `BoardChangeTrigger` union type
- **package.json**: Add configuration properties + npm dependencies
- **Extension activation**: Call `SyncServer.start()` if enabled
- **Extension deactivation**: Call `SyncServer.stop()`

Everything else is new code in the `src/sync/` directory. The adapter reads/writes through the existing `BoardStore` and `BoardCrudOperations`, so all undo/redo, file saving, and webview updates work automatically.

---

## 13. Open Questions

1. **Column mapping strategy:** Should all XBEL folders map to one "Bookmarks" column, or should each folder become its own column? (Configurable — default: single column)
2. **Task identity:** How to reliably match a bookmark to an existing task after edits? XBEL has no stable ID across syncs. Options: match by URL (most reliable for bookmarks), match by title+URL combo, or store XBEL ID as a hidden tag.
3. **Include files:** Should bookmarks synced into an include-mode column write to the include file or the main file? (Recommendation: skip include-mode columns for sync)
4. **Multiple boards:** If multiple kanban boards are open, which one receives synced bookmarks? (Recommendation: configurable per-board, off by default, user explicitly enables per board)
