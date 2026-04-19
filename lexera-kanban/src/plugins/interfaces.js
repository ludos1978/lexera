/**
 * Plugin interface contracts (JSDoc-only, no runtime code).
 *
 * This file exists to give editors type hints for plugin authors and to
 * document the shape that LexeraPluginRegistry.validate() enforces.
 *
 * Every plugin has a `kind` discriminator and a `metadata` block. Per-kind
 * contracts add the methods that specific plugin kinds must implement.
 *
 * @typedef {'fileFormat'|'diagram'|'export'|'contentEnhancer'|'menuContributor'|'embed'} PluginKind
 *
 * @typedef PluginMetadata
 * @property {string} id — unique within kind, e.g. 'drawio'
 * @property {string} name — human-readable display name
 * @property {string} version — semver string
 * @property {number} [priority] — higher runs/matches first (default 0)
 * @property {string[]} [requires] — plugin ids or external tool ids this depends on
 * @property {string[]} [contributes] — extra kinds this plugin also contributes to
 *
 * @typedef PluginLifecycleContext
 * @property {object} [api] — reference to LexeraApi if the plugin needs backend calls
 * @property {object} [runtime] — reference to moduleRuntime event bus / state
 * @property {object} [settings] — user settings snapshot at activation time
 *
 * @typedef Plugin
 * @property {PluginKind} kind
 * @property {PluginMetadata} metadata
 * @property {(ctx: PluginLifecycleContext) => (void|Promise<void>)} [activate]
 * @property {() => (void|Promise<void>)} [deactivate]
 * @property {() => Promise<boolean>} [isAvailable] — gates the plugin at runtime (e.g. external tool check)
 */

/**
 * File format plugin — describes how a file type is previewed, exported, and edited.
 *
 * @typedef FileFormatPreviewConfig
 * @property {string} kind — preview renderer kind, e.g. 'diagram'|'spreadsheet'|'document'|'table'|'text'|'pdf'|'epub'
 * @property {string} [cacheFolderName]
 * @property {string} [outputExtension]
 * @property {string} [outputFormat]
 * @property {boolean} [supportsRuntimeRender]
 * @property {(pageNumber?: number) => string} [buildSuffix]
 *
 * @typedef FileFormatExportConfig
 * @property {string} outputExtension
 * @property {string} outputFormat
 * @property {boolean} [supportsRuntimeRender]
 * @property {(pageNumber?: number) => string} [buildSuffix]
 *
 * @typedef {Plugin & {
 *   kind: 'fileFormat',
 *   label: string,
 *   emoji?: string,
 *   assetType?: string,
 *   editorKind?: string,
 *   previewPlaceholder?: string,
 *   preview?: FileFormatPreviewConfig,
 *   export?: FileFormatExportConfig,
 *   rendererRequirements?: Array<{id:string, label?:string, available?:boolean}>,
 *   matches: (normalizedPath: string, originalPath?: string) => boolean
 * }} FileFormatPlugin
 */

/**
 * Diagram plugin — renders a fenced code block (mermaid, plantuml, …) into SVG/PNG.
 *
 * @typedef {Plugin & {
 *   kind: 'diagram',
 *   languages: string[],
 *   canRenderCodeBlock: (language: string) => boolean,
 *   renderCodeBlock: (elementId: string, code: string, boardId?: string) => Promise<string>,
 *   isReady?: () => boolean,
 *   init?: () => Promise<void>
 * }} DiagramPlugin
 */

/**
 * Export plugin — turns kanban data into a target format (Marp, Pandoc, filter, …).
 *
 * @typedef ExportFormat
 * @property {string} id — e.g. 'pdf', 'pptx', 'docx', 'ical'
 * @property {string} label
 * @property {string} extension
 * @property {string} [mimeType]
 *
 * @typedef {Plugin & {
 *   kind: 'export',
 *   getSupportedFormats: () => ExportFormat[],
 *   canExport: (formatId: string) => boolean,
 *   export: (data: object, opts?: object) => Promise<{path?: string, bytes?: Uint8Array}>
 * }} ExportPlugin
 */

/**
 * Content enhancer — post-processes rendered DOM, optionally lazily.
 *
 * @typedef {Plugin & {
 *   kind: 'contentEnhancer',
 *   selector: string,
 *   lazy?: boolean,
 *   enhance: (element: Element, ctx: object) => void
 * }} ContentEnhancerPlugin
 */

/**
 * Menu contributor — adds items to context / burger / hotkey menus, scoped by surface.
 *
 * @typedef MenuItem
 * @property {string} id
 * @property {string} label
 * @property {string} [action]
 * @property {object} [args]
 * @property {string} [section]
 *
 * @typedef {Plugin & {
 *   kind: 'menuContributor',
 *   scopes: string[],
 *   section?: string,
 *   build: (scope: string, ctx: object) => MenuItem[]
 * }} MenuContributorPlugin
 */

/**
 * Embed plugin — handles iframe/embed URL rewriting for live view and export.
 *
 * @typedef {Plugin & {
 *   kind: 'embed',
 *   transformForExport?: (html: string, ctx: object) => string,
 *   getIframeConfig?: (url: string) => object
 * }} EmbedPlugin
 */
