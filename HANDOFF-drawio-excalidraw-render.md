# Handoff: Draw.io / Excalidraw cards stuck on placeholder

## Symptom
In the Lexera kanban (`lexera-kanban` Tauri app), cards containing markdown image embeds for `.drawio` and `.excalidraw` files display only the placeholder text (e.g. *"Excalidraw preview is rendered through the integrated export worker when available."*) instead of the rendered diagram, even though all the prerequisites for rendering succeed in isolation.

Affected board for reproduction: `tests/kanban-GAMEDESIGN-LECTURE/_Game-Design_Presentation_Kanban.md` (board id `630a7420c558`).
Two affected cards:
- `_Game-Design_Presentation_Kanban-Media/diagram-1776638151184.excalidraw`
- `_Game-Design_Presentation_Kanban-Media/diagram-1776638145941.drawio`

## What is confirmed working in isolation

1. **drawio CLI** (`/opt/homebrew/bin/drawio`) renders the `.drawio` source file to PNG/SVG. Verified with `drawio --export --format png --output ...`.
2. **Excalidraw worker** at [lexera-kanban/src-tauri/scripts/excalidraw-worker.cjs](lexera-kanban/src-tauri/scripts/excalidraw-worker.cjs) renders the `.excalidraw` source file to SVG. Verified by running `node lexera-kanban/src-tauri/scripts/excalidraw-worker.cjs <source> <target> /Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/lexera-standalone` — produces a 1.5 KB SVG.
3. **`playwright`** added to root `package.json` and `npm install`-ed. The worker's `require('playwright')` succeeds. `chromium.executablePath()` resolves to a cached Chrome for Testing.
4. **Cache files exist on disk** in the (oddly double-nested) folder:
   - `tests/kanban-GAMEDESIGN-LECTURE/_Game-Design_Presentation_Kanban-Media/_Game-Design_Presentation_Kanban-Media-Media/excalidraw-cache/diagram-1776638151184-L1VzZXJz-1776638326377.svg` (1546 bytes)
   - `tests/kanban-GAMEDESIGN-LECTURE/_Game-Design_Presentation_Kanban-Media/_Game-Design_Presentation_Kanban-Media-Media/drawio-cache/diagram-1776638145941-L1VzZXJz-1776638344603.svg` (1045 bytes)
5. **The cache URL serves successfully** from the running backend:
   `http://127.0.0.1:13080/boards/630a7420c558/file?path=...&auth_token=...` returns `status: 200, ok: true` from a `fetch()` in DevTools.
6. **Source file `file-info` API works**: returns `{ exists: true, lastModified: 1776638326, lastModifiedMs: 1776638326377, ... }`. The `lastModifiedMs` value (1776638326377) matches the cache filename exactly.
7. **Manual call to the render funnel succeeded**: `LexeraEmbedMenu.renderCachedSpecialPreview(document.createElement('div'), '630a7420c558', '_Game-Design_Presentation_Kanban-Media/diagram-1776638151184.excalidraw', 'diagram')` returned `Promise → result: true` and emitted only the entry log (no warn). That means `resolveCachedSpecialPreviewAsset` returned a non-null asset and the function set the `<img>` on the (detached) div passed in.

## What is broken in the actual board view

When the board renders the cards into the DOM, the markdown engine produces `<span class="embed-container" data-file-path="..." data-board-id="630a7420c558" data-embed-enhanced="1">` (verified via `outerHTML` dump). Inside, the `.embed-preview` div contains the `embed-diagram-file` placeholder block instead of an `<img>`.

`data-embed-enhanced="1"` is set, meaning [`enhanceSingleEmbedContainer`](lexera-kanban/src/menu/embedMenu.js) ran on the container at some point. Render must have returned `false`, so the placeholder fallback at [line 2444](lexera-kanban/src/menu/embedMenu.js#L2444) executed.

When the test snippet below was run from DevTools (forcing re-enhancement on the existing container with `forceRerender: false`), all 7 affected cards reported `(no img)` afterwards:

```js
(async () => {
  const cards = document.querySelectorAll('.embed-container[data-file-path*=".excalidraw"], .embed-container[data-file-path*=".drawio"]');
  for (const el of cards) {
    el.removeAttribute('data-embed-enhanced');
    el.querySelector('.embed-preview')?.remove();
    await LexeraEmbedMenu.enhanceSingleEmbedContainer(el);
    const img = el.querySelector('.embed-preview img');
    console.log(el.getAttribute('data-file-path'), img ? { src: img.src.slice(0, 100), naturalWidth: img.naturalWidth } : '(no img)');
  }
})()
```

So the auto-enhancement render path returns `false` even though my manual `renderCachedSpecialPreview` call returned `true` for the same card (same board id, same file path).

## Leading hypothesis

`resolveCachedSpecialPreviewAsset` ([embedMenu.js:1192](lexera-kanban/src/menu/embedMenu.js#L1192)) is failing at one of its early-exit checks during the auto-enhance flow. The inspector logs from the page load showed many failed `convert-path` and `file-info` requests:

```
Fetch API cannot load http://127.0.0.1:13080/boards/630a7420c558/convert-path due to access control checks.
Failed to load resource: The network connection was lost.
```

These are from WKWebView cancelling concurrent fetches. If `requestFileInfo` for the source file or `resolveBoardPath` for the absolute path fails, `resolveCachedSpecialPreviewAsset` returns `null` → render returns `false` → placeholder shown.

The `resolveBoardPath` helper at [embedMenu.js:2466](lexera-kanban/src/menu/embedMenu.js#L2466) has a `.catch` that **logs a warning but returns `undefined`** — which makes `absoluteSourcePath` undefined, fails `isAbsoluteFilePath`, and returns `null`. This swallowed-error path is a likely contributor.

## What was added during debugging (in [lexera-kanban/src/menu/embedMenu.js](lexera-kanban/src/menu/embedMenu.js))

- Entry/exit log markers at `renderCachedSpecialPreview` ([line ~1273](lexera-kanban/src/menu/embedMenu.js#L1273)) — area `embed.preview.entry`.
- Error surfacing in `resolveCachedSpecialPreviewAsset` for each early-exit (`Source file not found`, `no valid mtime`, `Could not resolve absolute path`) — area `embed.preview.resolve`.
- Explicit log + cached error in `requestRenderedSpecialPreviewAsset` when the Tauri command returns `success: false` — area `embed.preview.render`.
- Auto-clear of `data-embed-enhanced` flag on render failure so virtual-scroll remounts can retry.

## What I never got from the user

**The in-app Log panel entries (not DevTools console) for an actual auto-enhance run.** Those entries are emitted by my `logFrontendIssue` instrumentation and would name the exact failing step (`Source file not found: ...`, `Could not resolve absolute path for: ...`, `Excalidraw worker did not create ...`, etc). The user kept pasting browser console output but did not paste the in-app Log panel entries with `embed.preview.*` / `path.resolve` categories. Without them I'm guessing which step inside `resolveCachedSpecialPreviewAsset` is the cause.

A diagnostic that captures `logFrontendIssue` calls into the browser console (avoiding the need to look at the in-app panel) was provided but not run:

```js
(async () => {
  const captured = [];
  const orig = window.logFrontendIssue;
  window.logFrontendIssue = function(level, area, msg, err) {
    captured.push({ level, area, msg, err: err && (err.message || String(err)) });
    return orig.apply(this, arguments);
  };
  try {
    const card = document.querySelector('.embed-container[data-file-path*="diagram-1776638151184"]');
    card.removeAttribute('data-embed-enhanced');
    card.querySelector('.embed-preview')?.remove();
    await LexeraEmbedMenu.enhanceSingleEmbedContainer(card);
    console.log('=== captured logs ==='); captured.forEach((c, i) => console.log(i, c.level, '[' + c.area + ']', c.msg, c.err || ''));
    const img = card.querySelector('.embed-preview img');
    console.log('=== final img:', img ? { src: img.src.slice(0, 100), naturalWidth: img.naturalWidth } : '(no img)');
  } finally { window.logFrontendIssue = orig; }
})()
```

This would print the exact instrumentation log chain and the post-enhance img state in one block.

## Suspected secondary issue

The cache directory is **doubly nested**: `..._Game-Design_Presentation_Kanban-Media/_Game-Design_Presentation_Kanban-Media-Media/excalidraw-cache/...`. This is built by `buildDiagramCacheDir` at [embedMenu.js:1121](lexera-kanban/src/menu/embedMenu.js#L1121) when the source file is already inside a `-Media` folder — it appends another `-Media` instead of reusing the existing one. Worth fixing for cleanliness but doesn't appear to be the immediate render bug (the cache file lookup uses the same buggy path so the cache hit *would* work if it got that far).

## Files touched

- [lexera-kanban/src/menu/rowStackMenu.js](lexera-kanban/src/menu/rowStackMenu.js) — diagram template content now matches the working `functional_test_drawio` fixture.
- [lexera-kanban/src-tauri/src/export_commands.rs](lexera-kanban/src-tauri/src/export_commands.rs) — added a shape to the `functional_test_drawio` fixture so `Test Run` passes.
- [lexera-kanban/src-tauri/scripts/excalidraw-worker.cjs](lexera-kanban/src-tauri/scripts/excalidraw-worker.cjs) — `resolveFromRepo()` falls back to direct `node_modules` lookup for React 18 UMD subpaths.
- [package.json](package.json) — added `playwright` dependency.
- [lexera-kanban/src/menu/embedMenu.js](lexera-kanban/src/menu/embedMenu.js) — instrumentation logs, error surfacing, retry-on-failure flag clearing.

## Next steps for whoever picks this up

1. **Get the captured-log output** from the diagnostic snippet above, run against a real GAMEDESIGN board card. That will name the exact failing step.
2. If the failing step is `Could not resolve absolute path` → fix `resolveBoardPath` ([embedMenu.js:2466](lexera-kanban/src/menu/embedMenu.js#L2466)) so its `.catch` returns the original `filePath` (not `undefined`), and add a retry on `convert-path` to handle the WKWebView "network connection was lost" cancellations.
3. If the failing step is `Source file not found` → same fix for `requestFileInfo` retry.
4. If the failing step is something inside `requestRenderedSpecialPreviewAsset` → look at the Rust `render_embedded_file` error string returned to the frontend.
5. Consider deduplicating the `-Media-Media` nesting in `buildDiagramCacheDir`.
