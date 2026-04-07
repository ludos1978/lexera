# Media Tracker Service Specification

**Status**: ✅ Baseline  
**V2 Target**: `lexera-backend`  
**V1 Reference**: `src/services/MediaTracker.ts` (~555 lines)  
**Dependencies**: File watchers, [Content Plugins](../plugins/content/SPEC.md)

---

## UX Requirements

### Media Change Detection
- Detect when media files referenced in board are modified
- Trigger re-render of diagrams/images
- Persist mtimes across sessions

### Supported Media Types
- Diagrams: .drawio, .dio, .excalidraw
- Images: .png, .jpg, .jpeg, .gif, .svg, .webp, .avif, .bmp, .ico
- Audio: .mp3, .wav, .ogg, .m4a, .flac, .aac
- Video: .mp4, .webm, .mov, .avi, .mkv
- Documents: .pdf, .xlsx, .xls, .ods, .epub, .docx, .doc, .odt, .pptx, .ppt, .odp
- Inline files: .md, .txt, .json, .yaml, code files

### Real-Time Updates
- Watch media files for changes
- Notify webview when changes detected
- Update rendered content

---

## Architecture

### Change Detection Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    MEDIA TRACKER FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Board Load                                                    │
│       │                                                          │
│       ▼                                                          │
│   ┌──────────────────┐                                          │
│   │ scanBoard()      │  Find all media references               │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ detectChanges()  │  Compare mtimes with cache               │
│   └────────┬─────────┘                                          │
│            │                                                     │
│       ┌────┴────┐                                                │
│       │ Changes │ No changes                                     │
│       ▼         ▼                                                │
│   ┌───────┐  ┌───────────────┐                                  │
│   │ Return│  │ Return empty  │                                  │
│   │ list  │  │ list          │                                  │
│   └───────┘  └───────────────┘                                  │
│            │                                                    │
│            ▼                                                    │
│   ┌──────────────────┐                                          │
│   │ setupWatchers()  │  Watch for future changes                │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   File change event                                             │
│       │                                                          │
│       ▼                                                          │
│   _onMediaChanged callback                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Structures

### MediaFileEntry

```typescript
interface MediaFileEntry {
  mtime: number;
  type: 'diagram' | 'image' | 'audio' | 'video' | 'document' | 'inlinefile';
}
```

### MediaCacheData

```typescript
interface MediaCacheData {
  version: number;                    // Cache format version
  kanbanPath: string;                 // Board file path
  lastUpdated: string;                // ISO timestamp
  files: Record<string, MediaFileEntry>;  // path -> entry
}
```

### ChangedMediaFile

```typescript
interface ChangedMediaFile {
  path: string;           // Relative path
  absolutePath: string;   // Absolute path
  type: MediaFileType;
  oldMtime: number | null;
  newMtime: number;
}
```

---

## Functions

### Constructor & Setup

```typescript
class MediaTracker {
  constructor(kanbanPath: string)
  
  // Set change callback
  setOnMediaChanged(callback: (files: ChangedMediaFile[]) => void): void
}
```

### Scanning

```typescript
// Scan board for all media references
scanBoard(content: string, includeFiles?: Map<string, string>): string[]

// Detect changes since last scan
detectChanges(mediaPaths: string[]): ChangedMediaFile[]

// Update cache with current mtimes
updateCache(mediaPaths: string[]): void
```

### File Watching

```typescript
// Setup file watchers for media paths
setupWatchers(mediaPaths: string[]): void

// Dispose all watchers
disposeWatchers(): void
```

### Cache Management

```typescript
// Get current mtime for file
getMtime(filePath: string): number | null

// Check if file exists and get mtime
getFileMtimeIfExists(filePath: string): number | null

// Clear cache
clearCache(): void
```

### Media Detection

```typescript
// Extract media paths from content
extractMediaPaths(content: string): string[]

// Get media type from extension
getMediaType(extension: string): MediaFileType | null
```

---

## Cache Persistence

### Cache File Location

```
Board: /path/to/myboard.kanban.md
Cache: /path/to/.myboard.kanban.md.mediacache.json
```

### Cache File Format

```json
{
  "version": 1,
  "kanbanPath": "/path/to/myboard.kanban.md",
  "lastUpdated": "2024-03-15T14:30:00.000Z",
  "files": {
    "images/diagram.drawio": {
      "mtime": 1710505800000,
      "type": "diagram"
    },
    "assets/photo.png": {
      "mtime": 1710505700000,
      "type": "image"
    }
  }
}
```

---

## Media Type Detection

```typescript
private static readonly MEDIA_EXTENSIONS = {
  // Diagrams
  '.drawio': 'diagram',
  '.dio': 'diagram',
  '.excalidraw': 'diagram',
  
  // Images
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.svg': 'image',
  '.webp': 'image',
  
  // Audio
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  
  // Video
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  
  // Documents
  '.pdf': 'document',
  '.xlsx': 'document',
  '.epub': 'document',
  '.docx': 'document',
  
  // Inline files
  '.md': 'inlinefile',
  '.txt': 'inlinefile',
  '.json': 'inlinefile'
};
```

---

## Regex Patterns

### Markdown Images

```typescript
// ![alt](path)
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(([^)]+)\)/g;
```

### HTML Images

```typescript
// <img src="path">
const HTML_IMAGE = /<img[^>]+src=["']([^"']+)["']/gi;
```

### Video/Audio

```typescript
// <video src="path">
// <audio src="path">
const HTML_VIDEO = /<video[^>]+src=["']([^"']+)["']/gi;
const HTML_AUDIO = /<audio[^>]+src=["']([^"']+)["']/gi;
```

---

## File Watcher Setup

```typescript
setupWatchers(mediaPaths: string[]): void {
  for (const relativePath of mediaPaths) {
    const absolutePath = path.resolve(this._kanbanDir, relativePath);
    
    // Skip if already watching
    if (this._fileWatchers.has(relativePath)) {
      continue;
    }
    
    // Create watcher
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        path.dirname(absolutePath),
        path.basename(absolutePath)
      )
    );
    
    watcher.onDidChange(() => {
      this._handleFileChange(relativePath);
    });
    
    watcher.onDidDelete(() => {
      this._handleFileDelete(relativePath);
    });
    
    this._fileWatchers.set(relativePath, watcher);
  }
}
```

---

## Integration Points

### Called By
- `MarkdownFileRegistry` → on board load
- `KanbanWebviewPanel` → for media refresh

### Calls
- VS Code API → `createFileSystemWatcher()`
- File system → `fs.statSync()` for mtimes
- Callback → `_onMediaChanged()`

---

## Migration Notes for V2

### Keep Same
- Cache format
- Change detection logic
- Media type classification

### Port to Rust
- Create `lexera-core/src/media/tracker.rs`
- Use `notify` crate for file watching
- Persist to JSON

### Improve
- Batch change notifications
- Handle directory moves
- Add checksum for content changes (not just mtime)
