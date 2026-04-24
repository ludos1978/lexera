// Ghost window for drag preview.
//
// In production this is a transparent always-on-top borderless window
// rendered above all webviews, showing the dragged content following
// the cursor.
//
// For Stage 1 prototype we keep this as a stub: cross-webview drag is
// validated via the Rust drag coordinator + IPC contract, and target
// webviews render their own drop indicators. The ghost-window
// production implementation is added in Stage 7.
//
// Per-platform notes for the future implementation:
//   macOS: NSWindow with setOpaque(false), level above main window
//   Windows: Layered window with WS_EX_TRANSPARENT + WS_EX_TOPMOST
//   Linux X11: override-redirect transparent toplevel
//   Linux Wayland: wlr-layer-shell or popup window

#[allow(dead_code)]
pub fn ghost_stub() {
    // Placeholder so the module imports cleanly.
}
