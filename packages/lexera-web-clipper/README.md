# Lexera Web Clipper

Cross-browser WebExtension scaffold for clipping links, selections, articles, pages, and images into Lexera boards through the existing backend HTTP API.

## Architecture

- `background.ts`
  - discovers the local Lexera backend on `127.0.0.1`
  - creates context-menu capture actions
  - resolves the clip target from saved extension state or backend `incoming`
  - submits cards through the existing `/boards/{board_id}/columns/{col_index}/cards` API
  - uploads local image payloads through `/boards/{board_id}/media`
- `popup.ts`
  - lets the user choose the board, column, and clip mode
  - previews the active tab context before capture
- `content.ts`
  - collects the current page title, selection, article-ish text, excerpt, and lead image
  - acts as the portable replacement for browser-specific reader mode
- `src/shared/`
  - code shared between popup and background
- `../../shared/src/webClipper.ts`
  - browser-agnostic clip types and markdown formatting helpers

## Recommended System

The right primary system is a browser extension talking directly to the local Lexera backend, not Playwright.

- For logged-in pages, the content script can read the DOM after the user is already authenticated.
- For article capture, use in-page extraction heuristics instead of browser reader mode. Firefox has reader-mode APIs, but they are not portable across Chrome and Safari.
- For files and screenshots, upload into the board media folder and create the card from the resulting markdown path.
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

Example:

```bash
xcrun safari-web-extension-converter dist/chrome
```

## Build

```bash
npm run build
```
