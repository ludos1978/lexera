# Gather Query Engine Specification

**Status**: ✅ Baseline  
**V2 Target**: `packages/lexera-core`  
**V1 Reference**: `src/board/GatherQueryEngine.ts` (~400 lines)  
**Dependencies**: [Types](../shared/types/SPEC.md), DateTime utilities

---

## UX Requirements

### Gather Rules in Column Titles
- User adds query tags to column titles
- System automatically matches cards to columns
- First matching rule wins (order matters)

### Query Syntax
- `?#tagname` - Match hash tag (includes people)
- `?@temporal` - Match temporal (dates, times, weeks)
- `?.today`, `?.day>0` - Legacy temporal syntax

### Ungathered Collection
- `#ungathered` column collects unmatched cards
- Only cards with temporal or person tags

### Sticky Cards
- Cards with `#sticky` tag don't move
- Preserve manual ordering

---

## Architecture

### Gather Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    GATHER FLOW                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   performAutomaticSort(board)                                   │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Identify sticky  │  Cards with #sticky tag                  │
│   │ cards            │  Skip these from gather                  │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Collect rules    │  Parse column titles                     │
│   │ from columns     │  Separate gather vs ungathered           │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ FIRST PASS       │  Match cards against rules               │
│   │ Process cards    │  First match wins                        │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ SECOND PASS      │  Unmatched cards with tags               │
│   │ Ungathered       │  → #ungathered column                    │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Move cards       │  Update column arrays                    │
│   │ to destinations  │  Preserve non-sticky order               │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   Return true if any moves                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Query Syntax

### Tag Queries (`?#`)

| Query | Matches |
|-------|---------|
| `?#work` | Cards with `#work` tag |
| `?#john` | Cards with `#john` (person) |
| `?#urgent` | Cards with `#urgent` tag |

### Temporal Queries (`?@` or `?.`)

| Query | Matches |
|-------|---------|
| `?@today` | Cards with today's date |
| `?.today` | Same as above (legacy) |
| `?.day>0` | Cards with date in future |
| `?.day<7` | Cards within 7 days |
| `?.week=10` | Cards in week 10 |
| `?@KW10` | Cards in week 10 (German) |

---

## Data Structures

### GatherRule

```typescript
interface GatherRule {
  column: KanbanColumn;
  expression: string;  // e.g., "tag_work", "temporal_today"
}
```

### UngatheredRule

```typescript
interface UngatheredRule {
  column: KanbanColumn;
}
```

### TaskEvaluator

```typescript
type TaskEvaluator = (
  taskText: string, 
  taskDate: string | null, 
  personNames: string[]
) => boolean;
```

---

## Functions

### Main Entry

```typescript
class GatherQueryEngine {
  // Perform automatic sort
  public performAutomaticSort(board: KanbanBoard): boolean
}
```

### Expression Parsing

```typescript
// Parse gather expression to evaluator function
private _parseGatherExpression(expression: string): TaskEvaluator

// Process temporal query
private _processTemporalQuery(
  queryContent: string, 
  column: KanbanColumn, 
  gatherRules: GatherRule[]
)
```

### Comparison

```typescript
// Compare numbers with operator
function compareNumbers(a: number, b: number, operator: string): boolean
// Operators: '=', '!=', '<', '>'
```

---

## Expression Types

| Expression | Evaluator |
|------------|-----------|
| `tag_work` | Checks for `#work` in text |
| `temporal_today` | Date equals today |
| `temporal_day>0` | Date in future |
| `temporal_day<7` | Date within 7 days |
| `temporal_week=10` | Week number equals 10 |

---

## Rule Processing Order

```
1. Parse all column titles for query tags
2. Separate into gather rules and ungathered rules
3. For each card (skip sticky):
   a. Check against gather rules in order
   b. First match → destination column
   c. No match + has tags + ungathered exists → ungathered column
4. Move cards to destinations
```

---

## Example Column Setup

```
Column: "Today ?@today"
  → Gathers cards with today's date

Column: "This Week ?@day<7"
  → Gathers cards due within 7 days

Column: "Work Items ?#work"
  → Gathers cards tagged #work

Column: "Unsorted #ungathered"
  → Gathers unmatched cards with dates/people
```

---

## Integration Points

### Called By
- `BoardManager` → after board load
- `ChangeStateMachine` → after card edits
- VS Code command → manual gather trigger

### Calls
- `DateTimeUtils` → `extractDate()`, `extractPersonNames()`, `hasSticky()`

---

## Migration Notes for V2

### Keep Same
- Query syntax
- First-match-wins logic
- Sticky card handling

### Port to Rust
- Create `lexera-core/src/gather/engine.rs`
- Use regex crate for parsing
- Return move operations as Vec

### Add API
```rust
// POST /api/board/{id}/gather
// Returns: list of card moves
```

### Improve
- Gather preview (show where cards will move)
- Undo gather operation
- Gather rules in board settings (not just column titles)
