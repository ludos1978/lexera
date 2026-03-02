# Spec Template & Detail Guidelines

This document defines the standard structure and appropriate level of detail for Lexera v2 specifications.

---

## Spec Philosophy

A spec should be **enough to build from, not enough to replace implementation**.

### Good Spec
- ✅ Describes WHAT the system does
- ✅ Defines data structures and interfaces
- ✅ Shows key flows with diagrams
- ✅ Lists public functions/API
- ✅ Explains edge cases and rules
- ✅ Cross-references related specs

### Bad Spec
- ❌ Contains full implementation code
- ❌ Every private function documented
- ❌ Line-by-line behavior description
- ❌ Implementation-specific details
- ❌ Outdated v1-only concerns without v2 context

---

## Standard Spec Structure

```markdown
# [Component Name] Specification

**Status**: Baseline | Spec'd | Planned | In Progress | Deferred
**V2 Target**: `packages/lexera-*`
**V1 Reference**: `src/path/to/file.ts` (if applicable)
**Dependencies**: Other specs this depends on

---

## Purpose

One paragraph explaining what this component does and why it exists.

---

## UX Requirements

### [Feature Area 1]
- User can do X
- System responds with Y
- Edge case: Z behavior

### [Feature Area 2]
- ...

---

## Architecture

### High-Level Flow
[ASCII diagram showing main flow]

### Key Components
[ASCII diagram or list of components]

---

## Data Model

### [MainType]

```typescript
interface MainType {
  // Core fields with comments
  id: string;
  name: string;
  
  // Optional fields
  metadata?: Record<string, unknown>;
}
```

### [SupportingType]

```typescript
type SupportingType = 'option1' | 'option2' | 'option3';
```

---

## Public API

### [mainFunction]

```typescript
function mainFunction(
  param1: string,
  param2?: Options
): Result
```

**Purpose**: One line description

**Parameters**:
- `param1` - Description
- `param2` - Optional, description

**Returns**: Description of result

**Throws**: Error conditions

---

## Key Behaviors

### [Behavior 1]
Description of important behavior, edge cases, rules.

### [Behavior 2]
...

---

## Integration Points

### Called By
- `moduleA` → when/why
- `moduleB` → when/why

### Calls
- `dependencyX` → for what
- `dependencyY` → for what

---

## Migration Notes for V2

### Keep Same
- What behavior to preserve

### Change
- What to do differently

### Add
- New capabilities needed

---

## Open Questions
- Items needing design decisions (optional)
```

---

## Detail Level Guidelines

### UX Requirements: 1-2 sentences per feature

```markdown
### Card Dragging
- User drags card by handle
- Drop indicator shows insertion point
- ESC cancels operation
```

**NOT**:

```markdown
### Card Dragging
- When user mouses down on the drag handle element (CSS class .drag-handle)
- The system checks if the card is currently being edited via window.isEditing
- If editing, the drag is prevented and a toast notification appears
- Otherwise, the dragstart event fires and the system...
```

### Architecture: One diagram, 10-20 lines

Show the **main flow** or **state machine**, not every branch.

### Data Model: Core types only

Include:
- Public interfaces
- Type unions/enums
- Fields that affect behavior

Don't include:
- Private implementation types
- Every field (use `...` for obvious ones)
- Validation logic (describe in behaviors)

### Public API: Function signatures + one-liner

```typescript
function parseBoard(content: string, options?: ParseOptions): ParseResult
```
Parses markdown content into a KanbanBoard structure.

**NOT** full implementation or every helper function.

### Key Behaviors: Rules, edge cases, gotchas

Focus on:
- Non-obvious rules
- Edge cases
- Business logic decisions
- Things that could be implemented wrong

---

## Length Guidelines

| Spec Type | Target Lines | Max Lines |
|-----------|--------------|-----------|
| Small (single purpose) | 150-250 | 350 |
| Medium (multi-feature) | 250-400 | 500 |
| Large (complex system) | 400-600 | 750 |

**Current spec sizes** (lines):
- Smallest: `gather` (247)
- Largest: `api` (778)
- Median: ~400

---

## Diagram Style

Use ASCII box diagrams with standard formatting:

```
┌─────────────────────────────────────────────────────────────────┐
│                    TITLE                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Step 1                                                        │
│       │                                                          │
│       ▼                                                          │
│   ┌──────────────────┐                                          │
│   │ Process          │  Brief note                              │
│   └────────┬─────────┘                                          │
│            │                                                     │
│       ┌────┴────┐                                                │
│       │         │                                                │
│       ▼         ▼                                                │
│   ┌───────┐  ┌───────┐                                          │
│   │ A     │  │ B     │                                          │
│   └───────┘  └───────┘                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

Keep diagrams:
- Under 30 lines
- Focused on ONE flow
- Readable in monospace

---

## Code Examples

### Do: Show interface/contract

```typescript
interface CardOperation {
  type: 'create' | 'update' | 'delete' | 'move';
  cardId?: string;
  data?: Partial<Card>;
}
```

### Don't: Show implementation

```typescript
// TOO DETAILED
function processOperation(op: CardOperation) {
  switch (op.type) {
    case 'create':
      const id = generateId();
      const card = { id, ...op.data };
      this.cards.push(card);
      this.notifyListeners('cardCreated', card);
      break;
    // ... more cases
  }
}
```

---

## Review Checklist

Before submitting a spec:

- [ ] Status header present with correct value
- [ ] Purpose is one clear paragraph
- [ ] UX requirements are user-focused, not implementation-focused
- [ ] Architecture diagram shows main flow only
- [ ] Data model has core types with comments
- [ ] API lists public functions, not private helpers
- [ ] Key behaviors cover edge cases
- [ ] Integration points are accurate
- [ ] Migration notes distinguish keep/change/add
- [ ] Total length under 600 lines (or justified)
- [ ] Cross-references to related specs included

---

## Examples by Spec Type

### Data Model Spec (e.g., `shared/types`)
Focus on: interfaces, type relationships, field meanings
Skip: validation logic, parsing details

### Parser Spec (e.g., `shared/parser`)
Focus on: grammar rules, state machine, edge cases
Skip: regex implementations, character-by-character parsing

### UX Spec (e.g., `ux/dragdrop`)
Focus on: user interactions, visual feedback, edge cases
Skip: DOM manipulation details, event object structure

### Service Spec (e.g., `services/api`)
Focus on: endpoints, request/response schemas, error cases
Skip: server implementation, routing logic

### Architecture Spec (e.g., `plugins/content`)
Focus on: component relationships, contracts, extension points
Skip: specific plugin implementations

---

## Anti-Patterns to Avoid

### 1. Implementation Spec
"I'll write the code in the spec and copy it over"
→ Spec becomes outdated immediately

### 2. Exhaustive Spec
"Every function, every parameter, every return type"
→ Nobody reads it, maintenance burden

### 3. Vague Spec
"Cards can be moved around"
→ Doesn't help implementation

### 4. V1-Only Spec
"Here's how VS Code does it"
→ Without v2 context, misleading

### 5. Design Doc
"Let me explain the philosophy..."
→ Specs are technical, not persuasive

---

## When to Split a Spec

Split if:
- Multiple distinct features in one spec
- Over 600 lines with clear boundaries
- Different v2 packages own different parts

Example: `ux/export` could split into:
- `ux/export/ui` - Export dialog
- `ux/export/pipeline` - Export transform

---

## When to Merge Specs

Merge if:
- Two specs always change together
- One is tiny (< 100 lines) and related to another
- They describe the same concept at different levels
