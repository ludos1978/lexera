# Lexera Web Clipper

Cross-browser WebExtension scaffold for clipping links, selections, articles, pages, and images into Lexera boards through the existing backend HTTP API.

## Architecture

- `background.ts`
  - discovers the local Lexera backend on `127.0.0.1`
  - creates context-menu capture actions
  - resolves the clip target from saved extension state or backend `incoming`
  - submits cards through the existing `/boards/{board_id}/columns/{col_index}/cards` API
  - archives referenced page media into `/boards/{board_id}/media` and rewrites captured markdown to local board paths
- `popup.ts`
  - keeps the primary popup focused on target selection, clip mode, content source, and preview
  - moves backend configuration and target persistence into a dedicated settings view
  - previews reader, website, and feed-backed capture sources before save
- `content.ts`
  - collects the current page title, selection, reader-cleaned content, website content, feed candidates, excerpt, lead image, and structured markdown for article/page/selection capture
  - prefers a portable reader-style extraction over the noisier website DOM by default
- `src/shared/`
  - code shared between popup and background
- `@ludos/shared`
  - browser-agnostic clip types, backend discovery helpers, and markdown formatting helpers

## Recommended System

The right primary system is a browser extension talking directly to the local Lexera backend, not Playwright.

- For logged-in pages, the content script can read the DOM after the user is already authenticated.
- Prefer the portable reader-style extraction over raw website capture when both are available.
- Offer feed-backed capture when the current page exposes a valid RSS or Atom alternative.
- For files and screenshots, upload into the board media folder and create the card from the resulting markdown path.
- For page/article capture, archive embedded media and downloadable file links into the board media folder so the saved card keeps local references instead of hotlinking remote assets.
- For private resources that only exist in the live page session, prefer content-script extraction first. Arbitrary browser cache access is not a portable WebExtension feature.

## Next Phase

If you want deeper authenticated capture later, keep the browser extension as the UI layer and add those capabilities behind explicit opt-in:

- optional `cookies` permission for host-scoped background fetches when you need authenticated resource downloads
- `tabs.captureVisibleTab()` for screenshot-based archival when DOM extraction is blocked
- a native companion or Lexera backend helper only if you explicitly want browser-profile inspection beyond what the page session already exposes

## Browser Targets

- Chrome / Chromium: load `dist/chrome`
- Firefox: load `dist/firefox`
- Safari: use Apple's Safari Web Extension converter against `dist/chrome`

## Permissions

The extension requests `<all_urls>` host access so it can archive referenced page assets and upload them into the target board's media folder. Local backend access still goes through `http://127.0.0.1/*` and `http://localhost/*`.

## Popup Settings

- The popup's primary view is intentionally trimmed down to capture state only.
- Use `Settings` to configure the backend URL and whether the clipper should remember the last target.
- Leaving the backend URL empty enables automatic local discovery. The scan starts with `http://127.0.0.1:13080`.
- The primary screen uses the resolved live backend connection. Saving settings does not let normal popup activity rewrite the configured backend URL.

Example:

```bash
xcrun safari-web-extension-converter dist/chrome
```

## Build

```bash
npm run build
```

## Test

```bash
npm test
```
