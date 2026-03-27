# Dashboard Spec

## Current State

The dashboard already has:
- Full-text search with 10+ query syntax features (tags, temporal, links, board/column filters, regex)
- Pinned search queries (persisted in localStorage)
- Deadline tracking (tasks with `@date` temporal tags, grouped by board)
- Overdue detection (past due + unchecked)
- Quick filter chips (overdue, today, this week, parked)
- Scope selector (active board / all boards)
- Tree-view rendering with click-to-navigate to results
- Calendar tasks API on backend (`GET /calendar/tasks`)
- Shared panel factory for multi-instance dashboards

## What Needs to Be Added

### 1. Calendar View Section

A visual calendar showing upcoming and past events.

**Display:**
- Calendar weeks with day columns
- Last 7 days + next 4 weeks visible by default
- Each day cell shows count badge + clickable to expand
- Expanded day shows task titles with board labels
- Calendar week numbers on the left

**Data source:** Existing `GET /calendar/tasks` API + frontend temporal tag extraction.

**Implementation:**
- New dashboard group between "Results" and "Tasks with Deadlines"
- Pure HTML/CSS calendar grid (no library)
- Renders from the same `calendarTasks` data that deadlines use
- Click on task navigates to it (same as deadline items)

### 2. Upcoming Events Section

Replace/enhance the current "Tasks with Deadlines" group.

**Sub-groups:**
- **Overdue** (already exists) — past due + unchecked, sorted oldest first
- **Today** — tasks due today
- **This Week** — tasks due within the current calendar week (Mon-Sun)
- **Next 2 Weeks** — tasks due in the next 14 days
- **Later** — tasks due beyond 2 weeks

**Repeat handling:**
- Tasks with yearly temporal tags (e.g., `@2026-03-15` that repeats) show a "Reset" action
- Reset unchecks the task and bumps the date to next occurrence
- Requires: backend endpoint or frontend mutation to update the temporal tag

### 3. Tagged Items Section

A section showing items matching user-defined tag queries.

**Configuration:**
- Board YAML header can define `dashboard-tags: ["#important", "#blocked", "#review"]`
- Frontend Settings can also define global dashboard tags
- Each tag gets its own collapsible group in the dashboard

**Data source:** Existing search API with `#tag` query syntax.

**Implementation:**
- For each configured tag, run `search("#tagname")` scoped to active/all boards
- Render as collapsible groups with count badges
- Results show card title + board/column path
- Click navigates to card

### 4. Broken Elements Section

Detect and list broken embeds, missing includes, dead links, failed images.

**Categories:**
- **Broken Links** — markdown links that point to missing files or unreachable URLs
- **Broken Images** — `![]()` embeds where the image file is missing
- **Broken Diagrams** — draw.io/excalidraw embeds that failed to render
- **Broken Includes** — `![[include]]` directives where the file doesn't exist

**Data source:** New backend endpoint `GET /boards/{id}/broken-elements` that:
- Parses each card for links, images, includes
- Checks local file existence for file:// refs
- Reports embed containers marked as broken during last render

**Alternative (frontend-only):**
- After board load, scan rendered DOM for `.embed-broken`, `.include-broken`
- Collect broken elements from rendered state
- Report in dashboard without backend changes

**Implementation:**
- New dashboard group at the bottom
- Collapsible sub-groups by category
- Each item shows: element type, file path or URL, containing card title, board name
- Click navigates to the containing card

### 5. Todo Entries Section

Show all unchecked task items (`- [ ]`) across boards.

**Data source:** Existing search API with `is:open` query.

**Display:**
- Grouped by board
- Shows first line of card content
- Checkbox inline to toggle completion from dashboard
- Click navigates to card

**Implementation:**
- Quick chip already exists: use `is:open` search
- Add as a dedicated dashboard group (always visible, not just when searched)

---

## Dashboard Layout

```
[Search Input] [Scope: Active Board ▾] [Quick Chips: Overdue | Today | Week | Parked]

── Pinned Searches ──
  [pinned query 1] (N results)
  [pinned query 2] (N results)

── Search Results ──
  Board A
    Card title 1
    Card title 2
  Board B
    Card title 3

── Calendar ──
  CW13  Mon  Tue  Wed  Thu  Fri  Sat  Sun
         1    2    ●3   4    5    6    7
  CW14  8    9    10   ●11  12   13   14

── Upcoming ──
  Overdue (3)
    ● Card due 2026-03-10 — Board A / Column 1
  Today (1)
    ● Meeting prep — Board B / Inbox
  This Week (5)
    ...

── Tagged Items ──
  #blocked (2)
    Card title — Board A
  #review (4)
    ...

── Broken Elements ──
  Missing Images (1)
    logo.png — Card "Header" — Board A
  Broken Links (3)
    ...
```

## Implementation Priority

1. **Upcoming Events sub-groups** (Today/This Week/Next 2 Weeks/Later) — enhances existing deadline data
2. **Todo Entries section** — uses existing search API, minimal new code
3. **Tagged Items section** — uses existing search API, needs config in settings
4. **Calendar view** — pure frontend from existing data, medium effort
5. **Broken Elements** — needs new detection logic, highest effort
