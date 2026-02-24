/// Event types emitted by the file watcher.

use std::path::PathBuf;
use serde::{Deserialize, Serialize};

/// SHA-256 fingerprint of file content, used for self-write detection.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ContentFingerprint(pub String);

impl ContentFingerprint {
    /// Compute SHA-256 fingerprint of content with normalized line endings.
    pub fn from_content(content: &str) -> Self {
        use sha2::{Digest, Sha256};
        let normalized = content.replace("\r\n", "\n");
        let mut hasher = Sha256::new();
        hasher.update(normalized.as_bytes());
        Self(hex::encode(hasher.finalize()))
    }
}

/// Events emitted when board or include files change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BoardChangeEvent {
    MainFileChanged {
        board_id: String,
    },
    IncludeFileChanged {
        board_ids: Vec<String>,
        #[serde(serialize_with = "serialize_path", deserialize_with = "deserialize_path")]
        include_path: PathBuf,
    },
    FileDeleted {
        board_id: String,
        #[serde(serialize_with = "serialize_path", deserialize_with = "deserialize_path")]
        path: PathBuf,
    },
    FileCreated {
        board_id: String,
        #[serde(serialize_with = "serialize_path", deserialize_with = "deserialize_path")]
        path: PathBuf,
    },
}

fn serialize_path<S: serde::Serializer>(path: &PathBuf, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&path.to_string_lossy())
}

fn deserialize_path<'de, D: serde::Deserializer<'de>>(d: D) -> Result<PathBuf, D::Error> {
    let s = String::deserialize(d)?;
    Ok(PathBuf::from(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fingerprint_deterministic() {
        let fp1 = ContentFingerprint::from_content("hello world");
        let fp2 = ContentFingerprint::from_content("hello world");
        assert_eq!(fp1, fp2);
    }

    #[test]
    fn test_fingerprint_normalized_line_endings() {
        let fp1 = ContentFingerprint::from_content("line1\nline2");
        let fp2 = ContentFingerprint::from_content("line1\r\nline2");
        assert_eq!(fp1, fp2);
    }

    #[test]
    fn test_fingerprint_different_content() {
        let fp1 = ContentFingerprint::from_content("hello");
        let fp2 = ContentFingerprint::from_content("world");
        assert_ne!(fp1, fp2);
    }
}
