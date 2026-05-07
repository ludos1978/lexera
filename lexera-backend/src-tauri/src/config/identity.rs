//! Local user identity persistence.
//!
//! Splits the identity-management surface out of `config.rs` so it can
//! evolve independently from the main sync-config types and loaders.
//! All call sites still reach this through `crate::config::*` via the
//! re-exports in `config.rs`.

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use super::{CONFIG_DIR_NAME, IDENTITY_FILENAME};

/// Load local identity from ~/.config/lexera/identity.json.
/// Creates the file with a new UUID on first run.
pub fn load_or_create_identity() -> crate::auth::User {
    let path = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(CONFIG_DIR_NAME)
        .join(IDENTITY_FILENAME);

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<crate::auth::User>(&content) {
            Ok(user) => {
                log::info!("[identity] Loaded identity: {} ({})", user.name, user.id);
                user
            }
            Err(e) => {
                log::warn!(
                    "[identity] Corrupt identity file at {}: {}",
                    path.display(),
                    e
                );
                backup_corrupt_identity(&path);
                create_and_persist_identity(&path)
            }
        },
        Err(e) => {
            log::info!(
                "[identity] No readable identity at {} ({}), creating one",
                path.display(),
                e
            );
            create_and_persist_identity(&path)
        }
    }
}

fn os_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "Local User".into())
}

fn create_and_persist_identity(path: &PathBuf) -> crate::auth::User {
    let user = crate::auth::User {
        id: Uuid::new_v4().to_string(),
        name: os_username(),
        email: None,
    };
    persist_identity(path, &user);
    log::info!(
        "[identity] Created new identity: {} ({})",
        user.name,
        user.id
    );
    user
}

pub fn persist_identity(path: &PathBuf, user: &crate::auth::User) {
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            log::warn!(
                "[identity] Failed to create directory {}: {}",
                parent.display(),
                e
            );
            return;
        }
    }
    match serde_json::to_string_pretty(user) {
        Ok(json) => {
            if let Err(e) = fs::write(path, &json) {
                log::warn!("[identity] Failed to write {}: {}", path.display(), e);
            }
        }
        Err(e) => {
            log::warn!(
                "[identity] Failed to serialize identity for {}: {}",
                path.display(),
                e
            );
        }
    }
}

fn backup_corrupt_identity(path: &PathBuf) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup = path.with_extension(format!("corrupt-{}.json", ts));
    if let Err(e) = fs::rename(path, &backup) {
        log::warn!(
            "[identity] Failed to backup corrupt identity {} -> {}: {}",
            path.display(),
            backup.display(),
            e
        );
    } else {
        log::warn!(
            "[identity] Backed up corrupt identity to {}",
            backup.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn persist_identity_creates_file_and_preserves_on_reload() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("sub").join("identity.json");

        let user = crate::auth::User {
            id: "test-uuid-1234".to_string(),
            name: "Alice".to_string(),
            email: Some("alice@example.com".to_string()),
        };

        persist_identity(&path.to_path_buf(), &user);
        assert!(path.exists(), "Identity file should have been created");

        let content = fs::read_to_string(&path).unwrap();
        let loaded: crate::auth::User = serde_json::from_str(&content).unwrap();
        assert_eq!(loaded.id, "test-uuid-1234");
        assert_eq!(loaded.name, "Alice");
        assert_eq!(loaded.email, Some("alice@example.com".to_string()));
    }

    #[test]
    fn persist_identity_overwrites_existing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("identity.json");

        let user1 = crate::auth::User {
            id: "id-1".to_string(),
            name: "First".to_string(),
            email: None,
        };
        persist_identity(&path.to_path_buf(), &user1);

        let user2 = crate::auth::User {
            id: "id-2".to_string(),
            name: "Second".to_string(),
            email: Some("second@test.com".to_string()),
        };
        persist_identity(&path.to_path_buf(), &user2);

        let content = fs::read_to_string(&path).unwrap();
        let loaded: crate::auth::User = serde_json::from_str(&content).unwrap();
        assert_eq!(loaded.id, "id-2");
        assert_eq!(loaded.name, "Second");
    }

    #[test]
    fn create_and_persist_identity_generates_uuid() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("identity.json");

        let user = create_and_persist_identity(&path.to_path_buf());

        assert!(
            Uuid::parse_str(&user.id).is_ok(),
            "Identity id should be a valid UUID, got: {}",
            user.id
        );
        assert!(!user.name.is_empty());
        assert!(user.email.is_none());

        let content = fs::read_to_string(&path).unwrap();
        let loaded: crate::auth::User = serde_json::from_str(&content).unwrap();
        assert_eq!(loaded.id, user.id);
    }
}
