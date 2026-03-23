/// Self-write tracker using SHA-256 fingerprints.
///
/// Before every atomic write: compute SHA-256 of normalized content, register fingerprint.
/// On watcher event: read file, compute SHA-256, check against pending fingerprints.
/// Match found → consume fingerprint, suppress event (our own write).
/// No match → external change, propagate event.
/// TTL (10s) is cleanup only — fingerprints consumed on match regardless.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use super::types::ContentFingerprint;

const FINGERPRINT_TTL: Duration = Duration::from_secs(10);

struct PendingFingerprint {
    fingerprint: ContentFingerprint,
    registered_at: Instant,
}

/// Tracks SHA-256 fingerprints of our own writes for self-write detection.
pub struct SelfWriteTracker {
    /// path -> list of pending fingerprints (multiple writes possible before watcher fires)
    pending: HashMap<PathBuf, Vec<PendingFingerprint>>,
}

impl SelfWriteTracker {
    pub fn new() -> Self {
        Self {
            pending: HashMap::new(),
        }
    }

    /// Register a fingerprint for a file path (called before writing).
    pub fn register(&mut self, path: &Path, content: &str) {
        let fingerprint = ContentFingerprint::from_content(content);
        let entry = self.pending.entry(path.to_path_buf()).or_default();
        entry.push(PendingFingerprint {
            fingerprint,
            registered_at: Instant::now(),
        });
    }

    /// Check if a file change matches a pending self-write.
    /// If matched, consumes the fingerprint and returns true (suppress the event).
    /// If no match, returns false (external change, propagate).
    pub fn check_and_consume(&mut self, path: &Path, current_content: &str) -> bool {
        let fingerprint = ContentFingerprint::from_content(current_content);

        if let Some(entries) = self.pending.get_mut(path) {
            if let Some(pos) = entries.iter().position(|e| e.fingerprint == fingerprint) {
                entries.remove(pos);
                if entries.is_empty() {
                    self.pending.remove(path);
                }
                return true;
            }
        }
        false
    }

    /// Remove expired fingerprints (cleanup, not functional).
    pub fn cleanup_expired(&mut self) {
        let now = Instant::now();
        self.pending.retain(|_, entries| {
            entries.retain(|e| now.duration_since(e.registered_at) < FINGERPRINT_TTL);
            !entries.is_empty()
        });
    }

    /// Check if there are any pending fingerprints for a path.
    pub fn has_pending(&self, path: &Path) -> bool {
        self.pending.get(path).map_or(false, |e| !e.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_and_match() {
        let mut tracker = SelfWriteTracker::new();
        let path = Path::new("/tmp/test.md");
        let content = "# Hello\n\n- [ ] Task 1\n";

        tracker.register(path, content);
        assert!(tracker.has_pending(path));

        // Same content → match → consume
        assert!(tracker.check_and_consume(path, content));
        assert!(!tracker.has_pending(path));
    }

    #[test]
    fn test_no_match_different_content() {
        let mut tracker = SelfWriteTracker::new();
        let path = Path::new("/tmp/test.md");

        tracker.register(path, "original content");
        // Different content → no match
        assert!(!tracker.check_and_consume(path, "different content"));
        // Original fingerprint still pending
        assert!(tracker.has_pending(path));
    }

    #[test]
    fn test_multiple_writes_same_path() {
        let mut tracker = SelfWriteTracker::new();
        let path = Path::new("/tmp/test.md");

        tracker.register(path, "content v1");
        tracker.register(path, "content v2");

        // Both should be matchable
        assert!(tracker.check_and_consume(path, "content v1"));
        assert!(tracker.has_pending(path));
        assert!(tracker.check_and_consume(path, "content v2"));
        assert!(!tracker.has_pending(path));
    }

    #[test]
    fn test_normalized_line_endings() {
        let mut tracker = SelfWriteTracker::new();
        let path = Path::new("/tmp/test.md");

        tracker.register(path, "line1\nline2");
        // CRLF on disk should still match
        assert!(tracker.check_and_consume(path, "line1\r\nline2"));
    }

    #[test]
    fn test_cleanup_expired() {
        let mut tracker = SelfWriteTracker::new();
        let path = Path::new("/tmp/test.md");

        tracker.register(path, "content");
        // Manually expire by replacing the entry
        if let Some(entries) = tracker.pending.get_mut(path) {
            entries[0].registered_at = Instant::now() - Duration::from_secs(15);
        }

        tracker.cleanup_expired();
        assert!(!tracker.has_pending(path));
    }
}
