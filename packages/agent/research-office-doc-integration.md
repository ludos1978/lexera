# Office Document Viewer Integration Research

Research for vendoring JS libraries to render .docx, .xlsx, and .pptx in a Tauri desktop app (vanilla JS, no bundler, `<script>` tags only).

---

## 1. docx-preview (renders .docx to HTML)

**npm:** `docx-preview` (v0.3.7)
**GitHub:** https://github.com/VolodymyrBaydalka/docxjs
**License:** MIT

### Standalone Browser Bundle

Yes -- UMD bundle available.

**Files to vendor:**
- `docx-preview.min.js` (72.6 KB) -- the library itself
- `jszip.min.js` (~100 KB) -- **required external dependency, NOT bundled**

**CDN download URLs:**
```
https://cdn.jsdelivr.net/npm/docx-preview@0.3.7/dist/docx-preview.min.js
https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
```

### Global Variable

`docx` (on `window`)

### JSZip Dependency

JSZip is **NOT bundled** inside docx-preview. The UMD header checks for `require("jszip")` (CJS), `define(["exports","jszip"], ...)` (AMD), or `window.JSZip` (browser global). **You must load JSZip before docx-preview.**

### CSS

No separate CSS file needed. Styles are generated inline and injected into the `styleContainer` element.

### API

```js
// Signature:
docx.renderAsync(
  document,       // Blob | ArrayBuffer | Uint8Array
  bodyContainer,  // HTMLElement -- where rendered HTML goes
  styleContainer, // HTMLElement -- where generated <style> tags go (can be same as body or null)
  options         // optional config object
) // Returns Promise<WordDocument>
```

### Script Tags and Minimal Example

```html
<script src="vendor/jszip.min.js"></script>
<script src="vendor/docx-preview.min.js"></script>

<div id="docx-body"></div>
<style id="docx-styles"></style>

<script>
async function renderDocx(arrayBuffer) {
  const bodyEl = document.getElementById('docx-body');
  const styleEl = document.getElementById('docx-styles');
  await docx.renderAsync(arrayBuffer, bodyEl, styleEl, {
    className: 'docx',          // CSS class prefix (default: "docx")
    inWrapper: true,            // wrap in page-like container
    ignoreWidth: false,         // respect page width
    ignoreHeight: false,        // respect page height
    ignoreFonts: false,         // render fonts
    breakPages: true,           // page breaks
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
  });
}
</script>
```

### Key Options

| Option | Default | Description |
|--------|---------|-------------|
| `className` | `"docx"` | CSS class prefix |
| `inWrapper` | `true` | Wraps content in page-like container |
| `ignoreWidth` | `false` | Ignore page width (fill container) |
| `ignoreHeight` | `false` | Ignore page height |
| `ignoreFonts` | `false` | Skip font rendering |
| `breakPages` | `true` | Render page breaks |
| `renderHeaders` | `true` | Render headers |
| `renderFooters` | `true` | Render footers |
| `renderFootnotes` | `true` | Render footnotes |
| `renderEndnotes` | `true` | Render endnotes |
| `renderComments` | `false` | Experimental: render comments |
| `debug` | `false` | Enable debug logging |

---

## 2. SheetJS CE (renders .xlsx to HTML tables)

**npm:** `xlsx` (v0.20.3)
**Docs:** https://docs.sheetjs.com/
**License:** Apache-2.0

### Standalone Browser Bundle

Yes -- standalone script, no dependencies.

**File to vendor:**
- `xlsx.full.min.js` (861 KB) -- full build with all codepages and features
- Alternative: `xlsx.mini.min.js` (245 KB) -- lighter, fewer features

**CDN download URL:**
```
https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
```

Note: SheetJS recommends their own CDN (`cdn.sheetjs.com`) over jsdelivr/unpkg.

### Global Variable

`XLSX` (on `window`)

### CSS

No CSS needed. The `sheet_to_html` utility generates a plain HTML `<table>` with data attributes. Style it yourself.

### API

```js
// Read workbook from ArrayBuffer
const workbook = XLSX.read(arrayBuffer);

// Get sheet names
const sheetNames = workbook.SheetNames; // ["Sheet1", "Sheet2", ...]

// Get a worksheet
const ws = workbook.Sheets[sheetNames[0]];

// Convert worksheet to HTML table string
const htmlTable = XLSX.utils.sheet_to_html(ws, {
  id: 'xlsx-table',    // optional: TABLE element id
  editable: false,     // optional: make cells contenteditable
});

// Or convert to array of arrays for custom rendering
const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
```

### Script Tags and Minimal Example

```html
<script src="vendor/xlsx.full.min.js"></script>

<div id="xlsx-container"></div>

<script>
async function renderXlsx(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer);
  const container = document.getElementById('xlsx-container');

  // Render each sheet as a tab/table
  wb.SheetNames.forEach((name, i) => {
    const ws = wb.Sheets[name];
    const html = XLSX.utils.sheet_to_html(ws, { id: 'sheet-' + i });
    const div = document.createElement('div');
    div.innerHTML = '<h3>' + name + '</h3>' + html;
    container.appendChild(div);
  });
}
</script>
```

### Key Utility Functions

| Function | Description |
|----------|-------------|
| `XLSX.read(data, opts)` | Parse workbook from ArrayBuffer, Uint8Array, or binary string |
| `XLSX.utils.sheet_to_html(ws, opts)` | Convert worksheet to HTML table string |
| `XLSX.utils.sheet_to_json(ws, opts)` | Convert worksheet to array of objects |
| `XLSX.utils.sheet_to_csv(ws, opts)` | Convert worksheet to CSV string |
| `XLSX.utils.decode_range(ws['!ref'])` | Get sheet dimensions |

---

## 3. @jvmr/pptx-to-html (renders .pptx slides)

**npm:** `@jvmr/pptx-to-html` (v1.0.1)
**License:** MIT

### Standalone Browser Bundle

**No UMD/IIFE bundle exists.** The package is ESM-only (`"type": "module"` in package.json). The dist contains ES module files with `import`/`export` syntax.

It depends on `jszip ^3.10.1` (same JSZip used by docx-preview).

### Vendoring Strategy

Since this is a Tauri app with a modern Chromium-based webview, there are two viable approaches:

#### Option A: `<script type="module">` with Import Map (recommended)

Tauri's webview supports ES modules and import maps natively. Download the ESM files and use an import map to resolve bare specifiers.

**Files to vendor (download from jsdelivr):**
```
https://cdn.jsdelivr.net/npm/@jvmr/pptx-to-html@1.0.1/dist/index.js
https://cdn.jsdelivr.net/npm/@jvmr/pptx-to-html@1.0.1/dist/chunk-KAPAPPOM.js
https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
```

Problem: `index.js` uses `import JSZip from "jszip"` (bare specifier), so you need an import map OR you must rewrite the import line in the vendored file to point to the local jszip path.

```html
<script type="importmap">
{
  "imports": {
    "jszip": "./vendor/jszip.esm.min.js",
    "@jvmr/pptx-to-html": "./vendor/pptx-to-html/index.js"
  }
}
</script>
<script type="module">
  import { pptxToHtml } from '@jvmr/pptx-to-html';
  // ... use it
</script>
```

Note: JSZip's dist only has UMD, not ESM. You would need the ESM version from `https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm` or build one.

#### Option B: Build a Self-Contained IIFE with esbuild (more reliable)

Use esbuild to bundle everything into one self-contained file with a global variable:

```bash
# One-time build step
npm install --save-dev esbuild @jvmr/pptx-to-html
npx esbuild --bundle --format=iife --global-name=PptxToHtml \
  --outfile=vendor/pptx-to-html.bundle.js \
  --define:process.env.NODE_ENV='"production"' \
  node_modules/@jvmr/pptx-to-html/dist/index.js
```

This produces a single `pptx-to-html.bundle.js` that includes JSZip and exposes `window.PptxToHtml.pptxToHtml()`.

#### Option C: Use esm.sh Pre-Built Bundle (for prototyping)

esm.sh can produce a self-contained ESM bundle with all deps inlined. Download and vendor it:
```
https://esm.sh/@jvmr/pptx-to-html@1.0.1?bundle
```
This is an ESM file (needs `type="module"`), but it bundles JSZip internally. The downside: it imports Node.js polyfills from esm.sh CDN, so it is not fully offline-capable without additional work.

### CSS

**None needed.** Styles are inlined in the generated HTML. The README states: "Zero-runtime CSS required; styles are inlined."

### API

```js
// Signature:
pptxToHtml(
  buffer,   // ArrayBuffer
  config?   // optional config object
) // Returns Promise<string[]> -- one HTML string per slide
```

### Minimal Example (assuming Option B -- IIFE bundle)

```html
<script src="vendor/pptx-to-html.bundle.js"></script>

<div id="slides-container"></div>

<script>
async function renderPptx(arrayBuffer) {
  const slidesHtml = await PptxToHtml.pptxToHtml(arrayBuffer, {
    width: 960,
    height: 540,
    scaleToFit: true,
    letterbox: true,
  });

  const container = document.getElementById('slides-container');
  slidesHtml.forEach((slideHtml, i) => {
    const div = document.createElement('div');
    div.className = 'slide';
    div.innerHTML = slideHtml;
    container.appendChild(div);
  });
}
</script>
```

### Config Options

| Option | Default | Description |
|--------|---------|-------------|
| `width` | (none) | Output width in pixels |
| `height` | (none) | Output height in pixels |
| `scaleToFit` | `false` | Scale slides to fit width/height |
| `letterbox` | `false` | Add letterboxing to maintain aspect ratio |
| `domParserFactory` | (auto) | Custom DOMParser factory (browser has native DOMParser, so not needed) |

---

## Summary Comparison

| Feature | docx-preview | SheetJS CE | @jvmr/pptx-to-html |
|---------|-------------|-----------|-------------------|
| **Format** | .docx | .xlsx, .xls, .csv, ... | .pptx |
| **Bundle type** | UMD (script tag) | Standalone (script tag) | ESM-only (needs build) |
| **Global variable** | `docx` | `XLSX` | N/A (must build IIFE) |
| **External deps** | JSZip (separate load) | None | JSZip (bundled if using esbuild) |
| **CSS needed** | No (inline) | No (plain table) | No (inline styles) |
| **Bundle size** | ~73 KB + JSZip ~100 KB | ~861 KB (full) | ~87 KB + JSZip ~100 KB |
| **Render output** | DOM (mutates container) | HTML string | HTML string[] (per slide) |
| **Vendoring difficulty** | Easy | Easy | Medium (needs esbuild step) |

## Files to Vendor

Minimum set of files for the `vendor/` directory:

```
vendor/
  jszip.min.js              # shared by docx-preview (and pptx if Option A)
  docx-preview.min.js       # docx renderer
  xlsx.full.min.js          # xlsx renderer (self-contained)
  pptx-to-html.bundle.js   # pptx renderer (built with esbuild, includes JSZip)
```

Total estimated size: ~1.1 MB

## Recommended Integration Order

1. **SheetJS** -- easiest, zero deps, just one script tag
2. **docx-preview** -- easy, just needs JSZip loaded first
3. **pptx-to-html** -- requires one-time esbuild step to create IIFE bundle

## Build Script for PPTX Vendor Bundle

```bash
#!/bin/bash
# Run once to create the vendored pptx-to-html bundle
# Requires: npm install --save-dev esbuild @jvmr/pptx-to-html

ENTRY="node_modules/@jvmr/pptx-to-html/dist/index.js"
OUTPUT="src/vendor/pptx-to-html.bundle.js"

npx esbuild "$ENTRY" \
  --bundle \
  --format=iife \
  --global-name=PptxToHtml \
  --outfile="$OUTPUT" \
  --minify \
  --define:process.env.NODE_ENV='"production"'

echo "Built $OUTPUT ($(wc -c < "$OUTPUT") bytes)"
```

## Alternative PPTX Libraries Considered

| Library | Verdict |
|---------|---------|
| **PPTXjs** (jQuery plugin) | Requires jQuery + JSZip v2 + D3.js + 4 more scripts. Too many deps. Last updated 2022. |
| **PPTX2HTML** | Pure JS, but beta (v0.2.7), unmaintained, limited feature support. |
| **@jvmr/pptx-to-html** | Best option: modern, zero-CSS, good API, active. ESM-only is solvable with esbuild. |
