# Plugin Registry Specification

**Status**: ✅ Baseline  
**V2 Target**: `packages/lexera-core` (manifests), `packages/lexera-kanban` (runtime)  
**V1 Reference**: `src/plugins/registry/PluginRegistry.ts` (~500 lines)  
**Dependencies**: [Content Plugins](../plugins/content/SPEC.md)

---

## UX Requirements

### Import Plugins
- System detects `!!!include()!!!` syntax in content
- Correct plugin handles include based on file type
- Plugins have priority (higher priority checked first)

### Export Plugins
- User selects export format (HTML, PDF, PPTX)
- Correct plugin handles export
- Multiple formats per plugin supported

### Diagram Plugins
- User writes code fence with language (mermaid, plantuml)
- Correct plugin renders diagram
- File-based diagrams also supported

### Markdown Plugins
- Plugins extend markdown-it with custom syntax
- Loaded in priority order
- Scoped to frontend, export, or both

---

## Architecture

### Singleton Pattern

```javascript
class PluginRegistry {
  private static instance: PluginRegistry | undefined;
  
  public static getInstance(): PluginRegistry {
    if (!PluginRegistry.instance) {
      PluginRegistry.instance = new PluginRegistry();
    }
    return PluginRegistry.instance;
  }
  
  private constructor() {
    // Singleton - use getInstance()
  }
}
```

### Plugin Maps

```javascript
class PluginRegistry {
  private _importPlugins: Map<string, ImportPlugin> = new Map();
  private _exportPlugins: Map<string, ExportPlugin> = new Map();
  private _diagramPlugins: Map<string, DiagramPlugin> = new Map();
  private _markdownPlugins: Map<string, MarkdownPluginEntry> = new Map();
  private _embedPlugin: EmbedPluginInterface | null = null;
  private _initialized: boolean = false;
}
```

---

## Plugin Interfaces

### ImportPlugin

```typescript
interface ImportPlugin {
  metadata: {
    id: string;
    name: string;
    fileType: string;
    includePattern: RegExp;
    priority: number;
    contextLocation: 'any' | 'column' | 'task';
  };
  
  // Check if plugin can handle path
  canHandle(path: string, context: ImportContext): boolean;
  
  // Detect includes in content
  detectIncludes(content: string, context: ImportContext): IncludeMatch[];
  
  // Create virtual file for include
  createFile(match: IncludeMatch, context: ImportContext): Promise<{content: string, metadata: object}>;
  
  // Optional activation hook
  activate?(context: PluginContext): Promise<void>;
}

interface ImportContext {
  boardPath: string;
  location: 'column' | 'task';
  columnTitle?: string;
}

interface IncludeMatch {
  type: string;
  filePath: string;
  startIndex: number;
  endIndex: number;
  options?: object;
}
```

### ExportPlugin

```typescript
interface ExportPlugin {
  metadata: {
    id: string;
    name: string;
    formats: ExportFormat[];
  };
  
  // Get supported formats
  getSupportedFormats(): ExportFormat[];
  
  // Check if can export format
  canExport(formatId: string, options: object): boolean;
  
  // Export content
  export(board: KanbanBoard, formatId: string, options: object): Promise<ExportResult>;
}

interface ExportFormat {
  id: string;
  name: string;
  extension: string;
  mimeType?: string;
}

interface ExportResult {
  data: Buffer | string;
  metadata: object;
}
```

### DiagramPlugin

```typescript
interface DiagramPlugin {
  metadata: {
    id: string;
    name: string;
    supportedCodeBlocks: string[];
    supportedFileExtensions: string[];
  };
  
  // Check if available (dependencies installed)
  isAvailable(): Promise<boolean>;
  
  // Check if can render code block
  canRenderCodeBlock(language: string): boolean;
  
  // Check if can render file
  canRenderFile(filePath: string): boolean;
  
  // Render code block to HTML
  renderCodeBlock(code: string, language: string, context: DiagramContext): Promise<string>;
  
  // Render file to HTML
  renderFile(filePath: string, context: DiagramContext): Promise<string>;
  
  // Optional activation hook
  activate?(context: DiagramPluginContext): Promise<void>;
}
```

### MarkdownPluginEntry

```typescript
interface MarkdownPluginEntry {
  id: string;
  name: string;
  priority: number;
  scope: 'frontend' | 'export' | 'both';
  factory: (md: MarkdownIt) => void;
}
```

---

## Functions

### Registration

```javascript
class PluginRegistry {
  // Register plugins
  registerImportPlugin(plugin: ImportPlugin): void;
  registerExportPlugin(plugin: ExportPlugin): void;
  registerDiagramPlugin(plugin: DiagramPlugin): void;
  registerMarkdownPlugin(entry: MarkdownPluginEntry): void;
  registerEmbedPlugin(plugin: EmbedPluginInterface): void;
}
```

### Discovery

```javascript
class PluginRegistry {
  // Find import plugin for path
  findImportPlugin(path: string, context: ImportContext): ImportPlugin | null;
  
  // Find import plugin by file type
  findImportPluginByFileType(fileType: string): ImportPlugin | null;
  
  // Find export plugin for format
  findExportPlugin(formatId: string): ExportPlugin | null;
  
  // Find diagram plugin for code block
  findDiagramPluginForCodeBlock(language: string): DiagramPlugin | null;
  
  // Find diagram plugin for file
  findDiagramPluginForFile(filePath: string): DiagramPlugin | null;
  
  // Get diagram plugin by ID
  getDiagramPluginById(id: string): DiagramPlugin | undefined;
  
  // Get export plugin by ID
  getExportPluginById(id: string): ExportPlugin | undefined;
}
```

### Listing

```javascript
class PluginRegistry {
  // Get all plugins
  getAllImportPlugins(): ImportPlugin[];
  getAllExportPlugins(): ExportPlugin[];
  getAllDiagramPlugins(): DiagramPlugin[];
  
  // Get import plugins sorted by priority
  getImportPluginsByPriority(): ImportPlugin[];
  
  // Get markdown plugins by scope
  getMarkdownPlugins(scope?: 'frontend' | 'export' | 'both'): MarkdownPluginEntry[];
  
  // Get supported export formats
  getSupportedExportFormats(): ExportFormat[];
}
```

### Detection

```javascript
class PluginRegistry {
  // Detect all includes in content
  detectIncludes(content: string, context: ImportContext): IncludeMatch[];
}
```

### Activation

```javascript
class PluginRegistry {
  // Initialize registry with context
  initialize(context: PluginContext): Promise<void>;
  
  // Activate diagram plugins
  activateDiagramPlugins(context: DiagramPluginContext): Promise<void>;
  
  // Check if initialized
  isInitialized(): boolean;
}
```

### Validation

```javascript
class PluginRegistry {
  // Validate import plugin
  private _validateImportPlugin(plugin: ImportPlugin): ValidationResult;
  
  // Validate export plugin
  private _validateExportPlugin(plugin: ExportPlugin): ValidationResult;
  
  // Validate diagram plugin
  private _validateDiagramPlugin(plugin: DiagramPlugin): ValidationResult;
}
```

---

## Validation Rules

### ImportPlugin Validation

```javascript
_validateImportPlugin(plugin: ImportPlugin): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Required metadata
  if (!plugin.metadata?.id) errors.push('Missing plugin ID');
  if (!plugin.metadata?.includePattern) errors.push('Missing include pattern');
  if (typeof plugin.metadata?.priority !== 'number') errors.push('Missing priority');
  
  // Required methods
  if (typeof plugin.canHandle !== 'function') errors.push('Missing canHandle method');
  if (typeof plugin.detectIncludes !== 'function') errors.push('Missing detectIncludes method');
  if (typeof plugin.createFile !== 'function') errors.push('Missing createFile method');
  
  // Check for conflicts
  for (const existing of this._importPlugins.values()) {
    if (existing.metadata.includePattern.source === plugin.metadata.includePattern.source) {
      warnings.push(`Pattern conflict with: ${existing.metadata.id}`);
    }
  }
  
  return { valid: errors.length === 0, errors, warnings };
}
```

### DiagramPlugin Validation

```javascript
_validateDiagramPlugin(plugin: DiagramPlugin): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Required metadata
  if (!plugin.metadata?.id) errors.push('Missing plugin ID');
  
  // Must implement at least one render method
  if (typeof plugin.renderCodeBlock !== 'function' && 
      typeof plugin.renderFile !== 'function') {
    errors.push('Must implement renderCodeBlock or renderFile');
  }
  
  // Required methods
  if (typeof plugin.isAvailable !== 'function') errors.push('Missing isAvailable method');
  if (typeof plugin.canRenderCodeBlock !== 'function') errors.push('Missing canRenderCodeBlock');
  if (typeof plugin.canRenderFile !== 'function') errors.push('Missing canRenderFile');
  
  // Check for conflicts
  if (plugin.metadata.supportedCodeBlocks) {
    for (const existing of this._diagramPlugins.values()) {
      const overlap = plugin.metadata.supportedCodeBlocks.filter(
        cb => existing.metadata.supportedCodeBlocks.includes(cb)
      );
      if (overlap.length > 0) {
        warnings.push(`Code block conflict with ${existing.metadata.id}: ${overlap.join(', ')}`);
      }
    }
  }
  
  return { valid: errors.length === 0, errors, warnings };
}
```

---

## Include Detection Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    INCLUDE DETECTION FLOW                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   detectIncludes(content, context)                              │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Get plugins      │  getImportPluginsByPriority()            │
│   │ by priority      │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ For each plugin  │                                          │
│   │                  │                                          │
│   │ if context match │  Skip if wrong context location          │
│   │   detectIncludes│                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │ Deduplicate      │  Remove overlapping matches              │
│   │ by position      │  (first match wins due to priority)      │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            ▼                                                     │
│   IncludeMatch[]                                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Built-in Plugins

### Import Plugins

| Plugin ID | File Type | Pattern | Priority |
|-----------|-----------|---------|----------|
| `markdown-include` | `.md` | `!!!include()!!!` | 100 |
| `column-include` | `.md` | `!!!include()!!!` in column | 100 |
| `image-include` | images | `![]()` | 90 |

### Export Plugins

| Plugin ID | Formats |
|-----------|---------|
| `marp` | HTML, PDF, PPTX |
| `pandoc` | DOCX, PDF, HTML |

### Diagram Plugins

| Plugin ID | Code Blocks | File Extensions |
|-----------|-------------|-----------------|
| `mermaid` | `mermaid` | `.mmd` |
| `plantuml` | `plantuml`, `puml` | `.puml`, `.plantuml` |
| `drawio` | `drawio` | `.drawio`, `.dio` |
| `pdf` | - | `.pdf` |
| `xlsx` | - | `.xlsx` |
| `epub` | - | `.epub` |
| `docx` | - | `.docx` |

---

## Usage Examples

### Register Plugin

```javascript
const registry = PluginRegistry.getInstance();

// Register import plugin
registry.registerImportPlugin({
  metadata: {
    id: 'markdown-include',
    name: 'Markdown Include',
    fileType: 'markdown',
    includePattern: /!!!include\(([^)]+)\)!!!/g,
    priority: 100,
    contextLocation: 'any'
  },
  canHandle(path, context) {
    return path.endsWith('.md');
  },
  detectIncludes(content, context) {
    const matches = [];
    const regex = /!!!include\(([^)]+)\)!!!/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      matches.push({
        type: 'markdown',
        filePath: match[1],
        startIndex: match.index,
        endIndex: match.index + match[0].length
      });
    }
    return matches;
  },
  async createFile(match, context) {
    const content = await fs.readFile(match.filePath, 'utf-8');
    return { content, metadata: {} };
  }
});
```

### Find Plugin

```javascript
// Find import plugin for path
const plugin = registry.findImportPlugin('/path/to/file.md', {
  boardPath: '/board.md',
  location: 'column'
});

// Detect includes
const includes = registry.detectIncludes(content, context);

// Find export plugin
const exportPlugin = registry.findExportPlugin('html');

// Find diagram plugin
const diagramPlugin = registry.findDiagramPluginForCodeBlock('mermaid');
```

---

## Integration Points

### Called By
- `extension.ts` → `PluginLoader.loadBuiltinPlugins()` at startup
- `markdownParser.ts` → `detectIncludes()` for include processing
- Export commands → find export plugin

### Calls
- Plugin interfaces → registered plugins

---

## Migration Notes for V2

### Keep Same
- Singleton pattern
- Interface structure
- Priority-based discovery
- Validation logic

### Port to JavaScript
```javascript
// Convert TypeScript interfaces to JSDoc
/**
 * @typedef {Object} ImportPlugin
 * @property {Object} metadata
 * @property {string} metadata.id
 * @property {string} metadata.name
 * @property {string} metadata.fileType
 * @property {RegExp} metadata.includePattern
 * @property {number} metadata.priority
 * @property {'any'|'column'|'task'} metadata.contextLocation
 * @property {function(string, ImportContext): boolean} canHandle
 * @property {function(string, ImportContext): IncludeMatch[]} detectIncludes
 * @property {function(IncludeMatch, ImportContext): Promise<{content: string, metadata: object}>} createFile
 */
```

### Add
- Plugin hot-reload
- Plugin configuration persistence
- Plugin dependency management
