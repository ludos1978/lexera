# Backend API Surface Specification

**Status**: Base-plan critical for v2  
**V2 Target**: `packages/lexera-backend`  
**Related**: `sync/SPEC.md`, `boardregistry/SPEC.md`, `keybinding/SPEC.md`, `notification/SPEC.md`

---

## Purpose

Define the complete API surface that `lexera-backend` exposes for `lexera-kanban` and future clients to consume.

---

## Design Principles

1. **RESTful where appropriate** - Standard HTTP methods and status codes
2. **WebSocket for real-time** - Live updates, sync notifications
3. **Typed contracts** - All requests/responses have explicit schemas
4. **Versioned endpoints** - `/api/v1/` prefix for stability
5. **Error consistency** - Uniform error response format

---

## API Categories

### 1. Board Operations
### 2. Card Operations
### 3. Search & Discovery
### 4. Sync & Collaboration
### 5. Export & Transform
### 6. System & Diagnostics

---

## Base URL & Versioning

```
Base URL: http://localhost:{port}/api/v1

All endpoints return:
- 200 OK on success
- 400 Bad Request for invalid input
- 404 Not Found for missing resources
- 409 Conflict for state conflicts
- 500 Internal Server Error for failures
```

---

## Error Response Format

```typescript
interface ApiError {
  code: string;           // e.g., "BOARD_NOT_FOUND"
  message: string;        // Human-readable message
  details?: unknown;      // Additional context
  requestId: string;      // For log correlation
}
```

---

## 1. Board Operations

### List Boards

```
GET /api/boards

Query Parameters:
  - includeArchived: boolean (default: false)
  - sortBy: "name" | "modified" | "created" (default: "modified")

Response 200:
{
  "boards": [
    {
      "id": "string",
      "path": "string",
      "title": "string",
      "columnCount": number,
      "cardCount": number,
      "modifiedAt": "ISO-8601",
      "syncState": "synced" | "pending" | "conflict"
    }
  ],
  "total": number
}
```

### Get Board

```
GET /api/boards/{id}

Response 200:
{
  "id": "string",
  "path": "string",
  "title": "string",
  "columns": Column[],
  "settings": BoardSettings,
  "yamlHeader": "string | null",
  "footer": "string | null",
  "metadata": {
    "createdAt": "ISO-8601",
    "modifiedAt": "ISO-8601",
    "version": number
  },
  "syncState": SyncState
}
```

### Create Board

```
POST /api/boards

Request:
{
  "path": "string",           // Target file path
  "title": "string",
  "columns"?: string[],       // Column titles
  "settings"?: BoardSettings
}

Response 201:
{
  "id": "string",
  "path": "string",
  ...
}
```

### Update Board

```
PUT /api/boards/{id}

Request:
{
  "columns": Column[],
  "settings"?: BoardSettings,
  "expectedVersion": number   // For optimistic locking
}

Response 200:
{
  "id": "string",
  "version": number,
  ...
}

Response 409 (Conflict):
{
  "code": "VERSION_CONFLICT",
  "message": "Board was modified by another client",
  "currentVersion": number,
  "yourVersion": number
}
```

### Delete Board

```
DELETE /api/boards/{id}

Query Parameters:
  - deleteFile: boolean (default: false) - Also delete the file

Response 204: No Content
```

### Save Board

```
POST /api/boards/{id}/save

Request:
{
  "content": "string",        // Full markdown content
  "expectedVersion": number
}

Response 200:
{
  "version": number,
  "savedAt": "ISO-8601"
}
```

---

## 2. Card Operations

### Create Card

```
POST /api/boards/{boardId}/columns/{columnId}/cards

Request:
{
  "content": "string",
  "checked": boolean,
  "index"?: number            // Insert position (default: append)
}

Response 201:
{
  "id": "string",
  "content": "string",
  "checked": boolean,
  "createdAt": "ISO-8601"
}
```

### Update Card

```
PATCH /api/boards/{boardId}/cards/{cardId}

Request:
{
  "content"?: "string",
  "checked"?: boolean
}

Response 200:
{
  "id": "string",
  "content": "string",
  "checked": boolean,
  "modifiedAt": "ISO-8601"
}
```

### Move Card

```
POST /api/boards/{boardId}/cards/{cardId}/move

Request:
{
  "toColumnId": "string",
  "toIndex": number
}

Response 200:
{
  "cardId": "string",
  "fromColumnId": "string",
  "toColumnId": "string",
  "newIndex": number
}
```

### Delete Card

```
DELETE /api/boards/{boardId}/cards/{cardId}

Response 204: No Content
```

### Batch Card Operations

```
POST /api/boards/{boardId}/cards/batch

Request:
{
  "operations": [
    { "type": "create", "columnId": "string", "content": "string" },
    { "type": "update", "cardId": "string", "content": "string" },
    { "type": "move", "cardId": "string", "toColumnId": "string", "toIndex": number },
    { "type": "delete", "cardId": "string" }
  ]
}

Response 200:
{
  "results": [
    { "type": "create", "cardId": "string", "success": true },
    { "type": "update", "cardId": "string", "success": true },
    ...
  ],
  "version": number
}
```

---

## 3. Search & Discovery

### Search Cards

```
GET /api/search

Query Parameters:
  - q: string (required) - Search query
  - scope: "active" | "listed" | "all" (default: "listed")
  - tags: string[] - Filter by tags
  - dateFrom: "ISO-8601"
  - dateTo: "ISO-8601"
  - includeChecked: boolean (default: false)
  - limit: number (default: 50)

Response 200:
{
  "results": [
    {
      "boardId": "string",
      "boardTitle": "string",
      "columnId": "string",
      "columnTitle": "string",
      "cardId": "string",
      "cardContent": "string",
      "relevance": number,
      "highlights": string[]
    }
  ],
  "total": number,
  "query": "string"
}
```

### Get Dashboard Items

```
GET /api/dashboard/upcoming

Query Parameters:
  - timeframeDays: number (default: 14)
  - includeChecked: boolean (default: false)
  - boardIds: string[] (optional - limit to specific boards)

Response 200:
{
  "items": [
    {
      "boardId": "string",
      "boardTitle": "string",
      "columnId": "string",
      "columnTitle": "string",
      "cardId": "string",
      "cardContent": "string",
      "effectiveDate": "ISO-8601",
      "temporalTag": "string",
      "isChecked": boolean,
      "recurringState": "overdue" | "outdated" | "resetToRepeat" | null
    }
  ],
  "generatedAt": "ISO-8601"
}
```

### Get Tags

```
GET /api/tags

Query Parameters:
  - boardIds: string[] (optional - limit to specific boards)

Response 200:
{
  "tags": [
    {
      "name": "string",
      "count": number,
      "boards": string[],
      "lastUsed": "ISO-8601"
    }
  ]
}
```

---

## 4. Sync & Collaboration

### Get Sync Status

```
GET /api/sync/status

Response 200:
{
  "status": "synced" | "syncing" | "offline" | "error",
  "lastSyncAt": "ISO-8601" | null,
  "pendingOperations": number,
  "errors": [
    {
      "boardId": "string",
      "error": "string",
      "timestamp": "ISO-8601"
    }
  ]
}
```

### Trigger Sync

```
POST /api/sync/sync-now

Request:
{
  "boardIds"?: string[]   // Optional - limit to specific boards
}

Response 200:
{
  "synced": string[],
  "conflicts": string[],
  "errors": { [boardId: string]: string }
}
```

### Get Board Sync State

```
GET /api/boards/{id}/sync-state

Response 200:
{
  "boardId": "string",
  "localVersion": number,
  "remoteVersion": number | null,
  "lastSyncAt": "ISO-8601" | null,
  "pendingDeltas": number,
  "conflictState": "none" | "auto_resolved" | "manual_required"
}
```

### Resolve Conflict

```
POST /api/boards/{id}/resolve-conflict

Request:
{
  "strategy": "keep_local" | "keep_remote" | "merge",
  "resolutions"?: [
    {
      "cardId": "string",
      "keepLocal": boolean
    }
  ]
}

Response 200:
{
  "resolved": boolean,
  "version": number
}
```

### WebSocket Connection

```
WS /api/ws

Client -> Server Messages:
{
  "type": "subscribe_board",
  "boardId": "string"
}
{
  "type": "unsubscribe_board",
  "boardId": "string"
}

Server -> Client Messages:
{
  "type": "board_changed",
  "boardId": "string",
  "delta": ChangeDelta
}
{
  "type": "sync_complete",
  "boardId": "string",
  "result": "success" | "conflict" | "error"
}
{
  "type": "conflict_detected",
  "boardId": "string",
  "conflict": ConflictInfo
}
```

---

## 5. Export & Transform

### Export Board

```
POST /api/export

Request:
{
  "boardId": "string",
  "format": "markdown" | "html" | "pdf" | "pptx" | "docx",
  "options": {
    "selection": {
      "type": "full" | "partial",
      "nodeIds"?: string[]   // For partial export
    },
    "tagVisibility": "all" | "allexcludinglayout" | "customonly" | "none",
    "excludeTags"?: string[],
    "flattenIncludes": boolean,
    "useMarp"?: boolean,
    "marpTheme"?: string,
    "usePandoc"?: boolean,
    "outputPath": "string"
  }
}

Response 200:
{
  "outputPath": "string",
  "format": "string",
  "size": number,
  "warnings": string[]
}
```

### Get Export Preview

```
POST /api/export/preview

Request: Same as export

Response 200:
{
  "content": "string",      // Preview content
  "warnings": string[],
  "stats": {
    "cardsIncluded": number,
    "cardsExcluded": number,
    "includesResolved": number
  }
}
```

### Check Tool Availability

```
GET /api/export/tools

Response 200:
{
  "marp": {
    "available": boolean,
    "version": "string" | null,
    "themes": string[]
  },
  "pandoc": {
    "available": boolean,
    "version": "string" | null
  }
}
```

---

## 6. System & Diagnostics

### Health Check

```
GET /api/health

Response 200:
{
  "status": "healthy" | "degraded" | "unhealthy",
  "version": "string",
  "uptimeMs": number,
  "checks": {
    "filesystem": "ok" | "error",
    "sync": "ok" | "error" | "offline"
  }
}
```

### Get Logs

```
GET /api/logs

Query Parameters:
  - source: "frontend" | "backend" | "all" (default: "all")
  - level: "info" | "warn" | "error" | "all" (default: "all")
  - limit: number (default: 100)
  - since: "ISO-8601"

Response 200:
{
  "logs": [
    {
      "timestamp": "ISO-8601",
      "level": "info" | "warn" | "error",
      "source": "frontend" | "backend",
      "message": "string",
      "context"?: object
    }
  ]
}
```

### Get Configuration

```
GET /api/config

Response 200:
{
  "sync": {
    "enabled": boolean,
    "target": "local" | "webdav",
    "webdavUrl"?: "string"
  },
  "export": {
    "defaultOutputPath": "string",
    "defaultMarpTheme": "string"
  },
  "dashboard": {
    "defaultTimeframeDays": number,
    "defaultTagFilters": string[]
  }
}
```

### Update Configuration

```
PATCH /api/config

Request: Partial configuration object

Response 200:
{
  "config": { ... }
}
```

---

## Type Definitions

### BoardSettings

```typescript
interface BoardSettings {
  columnWidth?: string;
  layoutRows?: number;
  maxRowHeight?: string;
  rowHeight?: string;
  layoutPreset?: string;
  stickyStackMode?: string;
  tagVisibility?: string;
  cardMinHeight?: string;
  fontSize?: string;
  fontFamily?: string;
  whitespace?: string;
  htmlCommentRenderMode?: string;
  htmlContentRenderMode?: string;
  arrowKeyFocusScroll?: string;
  boardColor?: string;
  boardColorDark?: string;
  boardColorLight?: string;
}
```

### Column

```typescript
interface Column {
  id: string;
  title: string;
  cards: Card[];
  includeMode?: boolean;
  includeFiles?: string[];
}
```

### Card

```typescript
interface Card {
  id: string;
  content: string;
  checked?: boolean;
  includeMode?: boolean;
  includeFiles?: string[];
  includeContext?: IncludeContext;
}

interface IncludeContext {
  includeFilePath: string;
  includeDir: string;
  mainFilePath: string;
  mainDir: string;
}
```

### ChangeDelta

```typescript
interface ChangeDelta {
  deltaId: string;
  boardId: string;
  timestampMs: number;
  operations: ChangeOperation[];
  checksum: string;
}

type ChangeOperation =
  | { type: 'card_created'; card: Card }
  | { type: 'card_updated'; cardId: string; changes: Partial<Card> }
  | { type: 'card_deleted'; cardId: string }
  | { type: 'card_moved'; cardId: string; fromColumn: string; toColumn: string; newIndex: number }
  | { type: 'column_created'; column: Column }
  | { type: 'column_updated'; columnId: string; changes: Partial<Column> }
  | { type: 'column_deleted'; columnId: string }
  | { type: 'column_moved'; columnId: string; newIndex: number };
```

---

## Integration Points

### Used By
- `lexera-kanban` -> all board operations
- `lexera-capture-ios` -> card creation, search
- Future clients

### Implemented By
- `lexera-backend` Tauri app
- HTTP server (Axum/Actix)
- WebSocket server

---

## Testing Requirements

### Unit Tests
- Request validation
- Response serialization
- Error formatting

### Integration Tests
- Full request/response cycle for each endpoint
- WebSocket connection lifecycle
- Error scenarios

### Contract Tests
- API schema stability
- Breaking change detection
- Client compatibility

---

## Migration Notes

### From V1
- VS Code message passing replaced by HTTP/WebSocket
- Extension state replaced by backend state
- File operations go through backend API

### For V2
- Implement core endpoints first (boards, cards, search)
- Add sync endpoints when live-sync is ready
- Add export endpoints when pipeline is stable
