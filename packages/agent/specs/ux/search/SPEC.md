# Dashboard Scanner Specification

**Status**: ✅ Baseline  
**V2 Target**: `packages/lexera-core` (scanning), `packages/lexera-kanban` (UI)  
**V1 Reference**: `src/dashboard/DashboardScanner.ts` (~600 lines)  
**Dependencies**: [Types](../shared/types/SPEC.md), DateTime utilities

---

## UX Requirements

### Tracked elements #Reto
- Tasks : lines that start with "- [ ] "
- Deadlines : lines that start with "- [ ] " and contain any date tag @kw23
- Dates : lines with date tags @kw21
- Tagged elements : lines with #tags which are also defined in the dashboard scanner list
- Saved searches: search definitions that have been set to stick

- if it's on the first line of a card, show the card
- if it's on another line of a card, reference and show the line
- if it's on a column title, reference and show the column title
- if it's on a stack title, reference and show the stack title
- if it's on a row title, reference and show the row title

- there is hierarchy of structural elements row-title > stack-title > column-title > card-title (first-line) > card-lines
  - if some timeframe is defined on a higher structural element and another one on a lower structural element they are combined by AND
  - if on the same structural element two types of the same timeframe they are combined with OR
    - stack-title has @kw13 @kw14 and card-line has @fri it tags the line on kw13-friday and kw14-friday

- a calendar week starts on monday and lasts until sunday!
- search results find calendarweeks as timeframe, as do quartals or days etc.
- a time @09:30 is by default a 1 hour timeframe unless specified manually @09:30-09:45 or @09:30 - @10:15

### Kanban Board configures

- Deadlines and Dates
  - are shown without time limit if defined with year
  - if no year its limited within next 9 months and the past 3 months
- Tags that are being shown

### Upcoming Items View
- User sees dashboard with upcoming cards across all boards
- Cards sorted by date within configurable timeframe (default 14 days)
- Shows card title, date, board, column
- Click navigates to card in board view

### Overdue Items
- User sees cards with past dates
- Overdue classification: overdue, outdated, resetToRepeat
- Visual indicators for each state

### Tag Search
- User searches for `#tag` across all boards
- Shows all cards matching tag
- Click navigates to card

### Recurring Detection
- System detects yearless temporal tags (@KW7, @JAN, @Q1)
- Classifies as recurring based on checkbox state and age
- Suggests when to reset for next cycle

---

## Architecture

### Scan Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    DASHBOARD SCAN FLOW                     │
├─────────────────────────────────────────────────────────────────┤
│                                                            │
│   scanForUpcomingItems(board, options)                     │
│            │                                               │
│            ▼                                               │
│   ┌──────────────────┐                                      │
│   │ For each column │  Skip archived/deleted               │
│   └────────┬─────────┘                                      │
│            │                                               │
│            ▼                                               │
│   ┌──────────────────┐                                      │
│   │ For each card   │  Skip checked (if configured)        │
│   └────────┬─────────┘                                      │
│            │                                               │
│            ▼                                               │
│   ┌──────────────────┐                                      │
│   │ Resolve         │  resolveTaskTemporals()              │
│   │ temporals       │  Column → Card → Line inheritance    │
│   └────────┬─────────┘                                      │
│            │                                               │
│            ▼                                               │
│   ┌──────────────────┐                                      │
│   │ For each        │                                      │
│   │ temporal        │                                      │
│   └────────┬─────────┘                                      │
│            │                                               │
│       ┌────┴────────────────┐                                │
│       │ Within timeframe?  │                               │
│       ▼                      ▼                             │
│   ┌───────┐          ┌───────────────┐                       │
│   │ Add   │          │ Past date?   │                      │
│   │ to    │          └───────┬───────┘                      │
│   │ items │                  │                             │
│   └───────┘          ┌───────┴───────┐                       │
│                      │ Recurring?    │                     │
│                      ▼               ▼                     │
│                  ┌───────┐     ┌───────────┐                │
│                  │ Skip │     │ Classify  │                │
│                  │      │     │ recurring │                │
│                  │      │     │ state     │                │
│                  └───────┘     └───────────┘                 │
│                                                            │
│   Return UpcomingItem[]                                    │
│                                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Structures

### UpcomingItem

```typescript
interface UpcomingItem {
  boardId: string;
  boardTitle: string;
  columnId: string;
  columnTitle: string;
  cardId: string;
  cardContent: string;
  effectiveDate: Date;
  temporalTag: string;
  isChecked: boolean;
  recurringState?: RecurringState;
}
```

### RecurringState

```typescript
type RecurringState = 
  | 'overdue'       // Unchecked, recently past
  | 'outdated'      // Unchecked, older past
  | 'resetToRepeat' // Checked, needs reset
  | 'future';       // Should adjust to next occurrence
```

### BoardTagSummary

```typescript
interface BoardTagSummary {
  boardId: string;
  tags: TagInfo[];
}

interface TagInfo {
  name: string;
  count: number;
  lastUsed?: Date;
}
```

### ScanOptions

```typescript
interface ScanOptions {
  timeframeDays: number;      // How far ahead to look (default: 14)
  includeChecked: boolean;    // Include completed cards
  includeArchived: boolean;   // Include archived columns
}
```

---

## Functions

### Main Scanner

```typescript
class DashboardScanner {
  constructor(options: ScanOptions);
  
  // Scan board for upcoming items
  scanForUpcoming(board: KanbanBoard): UpcomingItem[];
  
  // Extract all tags from board
  scanForTags(board: KanbanBoard): BoardTagSummary;
}
```

### Temporal Resolution

```typescript
// Resolve temporal tags with inheritance
function resolveTaskTemporals(
  content: string, 
  columnTitle: string | null
): ResolvedTemporal[];

interface ResolvedTemporal {
  lineContent: string;
  effectiveDate: Date;
  temporal: TemporalInfo;
  effectiveWeek?: number;
  effectiveWeekday?: number;
  isWeekly: boolean;
  rawTag: string;
}
```

### Recurring Classification

```typescript
function classifyRecurringState(
  effectiveDate: Date,
  isChecked: boolean,
  isWeekly: boolean
): RecurringState | null;
```

### Timeframe Check

```typescript
function isWithinTimeframe(
  date: Date, 
  timeframeDays: number, 
  dateEnd?: Date
): boolean;
```

---

## Recurring Classification Logic

### Yearly Recurring (weeks, months, quarters without year)

```
Age < 0 days     → future (show normally)
Age 0-60 days    + unchecked → overdue
Age 60-75 days   + unchecked → outdated
Age 75-90 days   + checked   → resetToRepeat
Age > 90 days    → future (adjust to next year)
```

### Weekly Recurring (weekday without week context)

```
Age < 0 days     → future
Age 0-2 days     + unchecked → overdue
Age 2-2.5 days   + unchecked → outdated  
Age 2.5-3 days   + checked   → resetToRepeat
Age > 3 days     → future (adjust to next week)
```

---

## Temporal Inheritance

```
┌─────────────────────────────────────────────────────────────────┐
│                    TEMPORAL INHERITANCE                    │
├─────────────────────────────────────────────────────────────────┤
│                                                            │
│   Column Title: "Sprint @2024-03-15"                       │
│   │                                                        │
│   ├─ Card: "Task @09:00"                                   │
│   │         └─ Inherits date from column → 2024-03-15 09:00│
│   │                                                        │
│   ├─ Card: "Task @2024-03-20 @10:00"                       │
│   │         └─ Has own date, uses own → 2024-03-20 10:00   │
│   │                                                        │
│   └─ Card: "Multi-line                                     │
│             Line 1 @2024-03-16"                            │
│             Line 2 @14:00"                                 │
│             └─ Line 1: 2024-03-16 (own date)               │
│             └─ Line 2: 2024-03-16 14:00 (inherits from line 1) │
│                                                            │
│   Resolution order:                                        │
│   1. Line-level temporal (highest priority)                │
│   2. Card-level temporal                                   │
│   3. Column-level temporal (lowest priority)               │
│                                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tag Extraction

```typescript
function extractHashTags(content: string): string[] {
  const regex = /#([a-zA-Z0-9_-]+)/g;
  const tags: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    tags.push(match[1]);
  }
  return tags;
}
```

---

## Data Instances

### Input Board

```json
{
  "columns": [
    {
      "id": "col-1",
      "title": "This Week @2024-03-15",
      "cards": [
        {
          "id": "card-1",
          "content": "Meeting @09:00",
          "checked": false
        },
        {
          "id": "card-2",
          "content": "Review @2024-03-20",
          "checked": true
        }
      ]
    }
  ]
}
```

### Output UpcomingItems

```json
[
  {
    "boardId": "board-1",
    "boardTitle": "Project",
    "columnId": "col-1",
    "columnTitle": "This Week",
    "cardId": "card-1",
    "cardContent": "Meeting @09:00",
    "effectiveDate": "2024-03-15T09:00:00Z",
    "temporalTag": "@09:00",
    "isChecked": false
  },
  {
    "boardId": "board-1",
    "boardTitle": "Project",
    "columnId": "col-1",
    "columnTitle": "This Week",
    "cardId": "card-2",
    "cardContent": "Review @2024-03-20",
    "effectiveDate": "2024-03-20T00:00:00Z",
    "temporalTag": "@2024-03-20",
    "isChecked": true
  }
]
```

---

## Integration Points

### Called By
- `KanbanDashboardProvider` → scan all boards for sidebar
- Search API → find cards by tag/date

### Calls
- `@ludos/shared` → `resolveTaskTemporals()`, `extractTemporalInfo()`
- `KanbanTypes` → board/card types

---

## Migration Notes for V2

### Keep Same
- Temporal inheritance logic
- Recurring classification thresholds
- Tag extraction

### Port to Rust
- Create `lexera-core/src/dashboard/scanner.rs`
- Use `chrono` crate for dates
- Port `resolveTaskTemporals` to Rust

### Add API Endpoint
```rust
// GET /api/dashboard/upcoming
// GET /api/dashboard/tags?query=...
```
