# Research: Viewing/Embedding Office Documents (docx, xlsx, pptx) in Tauri/Web

Goal: support `!!!include(file.docx)!!!` syntax in column headers, rendering Office documents inline.

---

## Option 1: OpenXML-Office (DraviaVemal)

- **URL**: https://github.com/DraviaVemal/OpenXML-Office
- **What it does**: Creates and modifies Office documents (xlsx, pptx, docx) programmatically. Rust-native with C#/Python FFI wrappers. TypeScript planned but not available yet.
- **Can it render to HTML?**: NO. This is a document generation/manipulation library, not a viewer or renderer. It cannot convert Office files to HTML or any visual format.
- **Status**: V4 in development, V3 abandoned. "6-8 months" to migrate features. Unstable.
- **License**: AGPL-3.0 (open source) / commercial via sponsorship
- **Verdict**: NOT SUITABLE for viewing. Only useful if we needed to programmatically create Office files.

---

## Option 2: docx-preview (npm)

- **URL**: https://www.npmjs.com/package/docx-preview (source: https://github.com/VolodymyrBaydalka/docxjs)
- **What it does**: Renders .docx files directly to HTML in the browser. Uses `renderAsync(blob, container)` to inject semantic HTML into a DOM element.
- **Works offline?**: YES -- fully client-side, zero server dependencies.
- **Browser-compatible?**: YES -- pure JavaScript, works in any modern browser/WebView.
- **Rendering quality**: GOOD for typical documents. Preserves headers/footers, footnotes, images, embedded fonts, page breaks, styles. Limited by what HTML/CSS can represent (not pixel-perfect like Word). Real-time page breaking not implemented.
- **Dependencies**: JSZip only.
- **License**: Apache-2.0
- **Weekly downloads**: ~282,000
- **Bundle size**: ~150KB minified
- **Verdict**: BEST OPTION for docx viewing. High fidelity, actively maintained, lightweight, permissive license.

---

## Option 3: mammoth.js

- **URL**: https://github.com/mwilliamson/mammoth.js
- **What it does**: Converts .docx to clean semantic HTML. Focuses on content structure (headings, lists, tables, images) rather than visual fidelity.
- **Works offline?**: YES -- fully client-side. Browser build available (`mammoth.browser.js`).
- **Browser-compatible?**: YES.
- **Rendering quality**: MODERATE. Deliberately ignores visual styling (fonts, colors, text size). Converts semantically (Heading 1 -> h1). Table borders ignored. Good for content extraction, poor for faithful document preview.
- **Dependencies**: Minimal (self-contained).
- **License**: BSD-2-Clause
- **Verdict**: Good for content extraction / markdown-like rendering, but NOT suitable for faithful document preview. docx-preview is strictly better for our use case.

---

## Option 4: SheetJS (xlsx)

- **URL**: https://docs.sheetjs.com / https://www.npmjs.com/package/xlsx
- **What it does**: Parses and generates spreadsheet files (xlsx, xls, csv, ods, etc.). Can convert worksheets to HTML tables via `XLSX.utils.sheet_to_html()`.
- **Works offline?**: YES -- fully client-side.
- **Browser-compatible?**: YES -- standalone browser build at `dist/xlsx.full.min.js`.
- **Rendering quality**: DATA-FOCUSED. Renders cell values and basic number formatting into HTML tables. The Community Edition does NOT preserve cell styles, colors, borders, or conditional formatting (that requires SheetJS Pro). For inline column-header preview, a basic HTML table of the data is likely sufficient.
- **Dependencies**: Zero runtime dependencies.
- **License**: Apache-2.0 (Community Edition)
- **Interactive grid option**: Can pair with x-spreadsheet (MIT) for an interactive editable grid UI. SheetJS reads the file, x-spreadsheet renders/edits it.
- **Verdict**: BEST OPTION for xlsx viewing. The Community Edition HTML table output is good enough for inline preview. For richer display, pair with x-spreadsheet or Univer (MIT, successor to Luckysheet).

---

## Option 5: pptx rendering libraries

### 5a: @jvmr/pptx-to-html
- **URL**: https://www.npmjs.com/package/@jvmr/pptx-to-html
- **What it does**: Parses OOXML (pptx) and renders each slide as self-contained HTML with absolutely positioned elements and inlined CSS. Supports text boxes, shapes, tables, charts (column, bar, line, pie, scatter), theme colors.
- **Works offline?**: YES.
- **Browser-compatible?**: YES (also Node via injectable DOM parser).
- **Rendering quality**: MODERATE-GOOD for basic presentations. Complex animations/transitions not supported.
- **License**: MIT
- **Status**: Very new (v1.0.1, published recently). Low adoption so far.

### 5b: pptx2html
- **URL**: https://github.com/g21589/PPTX2HTML
- **What it does**: Converts pptx to HTML using pure JavaScript.
- **License**: MIT
- **Status**: v0.3.4, low maintenance. Less feature-complete than @jvmr/pptx-to-html.

### 5c: LibreOffice conversion (see Option 6)

- **Verdict**: PPTX is the weakest ecosystem. @jvmr/pptx-to-html is the best pure-JS option but is very new. LibreOffice conversion to HTML/PDF may be more reliable for complex presentations.

---

## Option 6: LibreOffice headless conversion

- **Command**: `soffice --headless --convert-to html input.docx --outdir /tmp/`
- **What it does**: Uses the full LibreOffice rendering engine to convert any Office format to HTML (or PDF, PNG, etc.).
- **Works offline?**: YES -- runs locally.
- **Browser-compatible?**: Produces static HTML/PDF that can be loaded into a WebView. Not a JS library -- requires spawning a subprocess from Tauri's Rust backend.
- **Rendering quality**:
  - docx -> HTML: MODERATE. Known issues with image quality reduction, formatting loss, embedded table rendering bugs.
  - docx -> PDF: GOOD. Best fidelity option for docx.
  - xlsx -> HTML: MODERATE. Basic table rendering.
  - pptx -> HTML: POOR. LibreOffice 7.3+ broke pptx-to-HTML conversion. CSS and images often missing.
  - pptx -> PDF: GOOD.
- **Dependencies**: Requires LibreOffice installed (~350MB on macOS, cannot be reduced). Not bundleable inside Tauri -- user must install separately or we detect it at runtime.
- **License**: MPL-2.0 (LibreOffice itself)
- **Performance**: Slow startup (~2-5s per conversion), single-threaded, high memory usage.
- **Verdict**: BEST for PDF output and as a fallback for complex documents. Poor for HTML output of xlsx/pptx. The 350MB dependency and cold-start latency are significant downsides. Good as a "convert once, cache result" strategy.

---

## Comparison Matrix

| Criterion              | docx-preview  | mammoth.js  | SheetJS CE   | @jvmr/pptx-to-html | LibreOffice headless |
|------------------------|---------------|-------------|--------------|---------------------|----------------------|
| **Format**             | docx          | docx        | xlsx (+more) | pptx                | all formats          |
| **Offline**            | yes           | yes         | yes          | yes                 | yes                  |
| **Browser JS**         | yes           | yes         | yes          | yes                 | no (subprocess)      |
| **Rendering fidelity** | good          | low         | data-only    | moderate            | moderate-good (PDF)  |
| **Editable**           | no            | no          | yes (w/ grid)| no                  | no                   |
| **License**            | Apache-2.0    | BSD-2       | Apache-2.0   | MIT                 | MPL-2.0              |
| **Bundle size**        | ~150KB        | ~70KB       | ~350KB       | ~small              | 350MB (external)     |
| **Maturity**           | high          | high        | high         | low                 | very high            |
| **Dependencies**       | JSZip         | none        | none         | none                | LibreOffice install  |

---

## Recommended Approach

### Primary strategy: Pure-JS libraries per format (no external dependencies)

1. **docx**: Use `docx-preview` (Apache-2.0). Best fidelity, most mature, lightweight.
2. **xlsx**: Use `SheetJS CE` (Apache-2.0) with `XLSX.utils.sheet_to_html()` for basic table rendering. Optionally pair with x-spreadsheet (MIT) for interactive grid if editing is desired later.
3. **pptx**: Use `@jvmr/pptx-to-html` (MIT) for slide rendering. Accept that complex presentations may not render perfectly.

### Fallback strategy: LibreOffice headless (optional, for high-fidelity needs)

- If the user has LibreOffice installed, offer a "Convert to PDF" option that uses `soffice --headless --convert-to pdf` for any Office format.
- Detect LibreOffice at runtime (`which soffice` / check common paths).
- Cache converted PDFs alongside the source files.
- This is especially valuable for pptx where the JS ecosystem is weakest.

### "Open in external editor" button

- Always provide an "Open in default app" button using Tauri's `shell.open()` API.
- This covers the editing use case without needing to embed a full editor.

### Implementation sketch for `!!!include(file.docx)!!!`

```
1. Parse column header, detect !!!include(path)!!! pattern
2. Resolve path relative to the board file
3. Based on extension:
   - .docx -> load ArrayBuffer, call docxPreview.renderAsync(buf, container)
   - .xlsx -> load ArrayBuffer, call XLSX.read(buf), then sheet_to_html(), inject into container
   - .pptx -> load ArrayBuffer, call pptxToHtml(buf), inject slides into container
4. Add "Open in Editor" button that calls Tauri shell.open(absolutePath)
5. Watch file for changes (Tauri fs watcher) and re-render on modification
```

### Bundle impact

- docx-preview (~150KB) + SheetJS (~350KB) + pptx-to-html (~small) = under 600KB total
- No native dependencies, no external installs required
- All work offline in WebView2/WKWebView

### Risks

- **pptx rendering**: The JS ecosystem for pptx is immature. Complex slides with animations, SmartArt, or embedded media will not render well. LibreOffice PDF fallback recommended for these cases.
- **xlsx styling**: SheetJS CE only outputs data, not cell formatting. If styled spreadsheets need to look like Excel, consider Univer (MIT, ~2MB) as an alternative grid renderer.
- **docx edge cases**: Very complex documents (tracked changes, embedded OLE objects, advanced page layout) may not render correctly in docx-preview. These are edge cases for column-header includes.
