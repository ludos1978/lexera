/// Shared utility for extracting human-readable messages from panic payloads.
///
/// Used by CRDT bridge, storage, and backend panic handlers to avoid
/// duplicating the same downcast chain.
use std::any::Any;

/// Extract a human-readable message from a `catch_unwind` panic payload.
///
/// Handles the two standard payload types (`&str` and `String`) and falls
/// back to a generic message for anything else.
pub fn panic_payload_to_string(payload: &(dyn Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        s.to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic payload".to_string()
    }
}
