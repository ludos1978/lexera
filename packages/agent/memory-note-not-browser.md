---
name: tauri-not-browser
description: Lexera uses Tauri WKWebView, not a regular browser — can configure connection limits, enable h2c, etc.
type: feedback
---

The Lexera frontend runs in a Tauri WKWebView, NOT a regular browser. This means we control both client and server and can configure networking parameters that browsers don't expose. Don't assume browser limitations apply.

**Why:** User corrected assumption that the 6-connection-per-origin browser limit was immutable.

**How to apply:** When encountering network/connection limitations, consider server-side protocol changes (HTTP/2, WebSocket multiplexing) or client-side configuration rather than working around fixed browser constraints.
