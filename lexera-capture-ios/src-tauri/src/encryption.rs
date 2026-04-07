/// Transparent AES-256-GCM encryption for board files at rest.
///
/// Key management: a random 256-bit key is generated on first use and stored
/// in a `.key` file inside the boards directory. iOS sandboxes the App Group
/// container, so this adds defense-in-depth rather than being the sole barrier.
///
/// File format: encrypted files start with a 4-byte magic header (`LEXE`),
/// followed by a 12-byte nonce, then the AES-256-GCM ciphertext+tag.
/// Unencrypted (legacy) files are detected by the absence of the magic header
/// and are transparently migrated on first read.
use std::fs;
use std::io::Write;
use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;

/// 4-byte magic header that marks an encrypted board file.
const MAGIC: &[u8; 4] = b"LEXE";

/// AES-256-GCM nonce size in bytes.
const NONCE_LEN: usize = 12;

/// Key file name stored alongside boards.
const KEY_FILENAME: &str = ".lexera.key";

/// AES-256 key length in bytes.
const KEY_LEN: usize = 32;

/// Manages an AES-256-GCM encryption key for a storage directory.
pub struct FileEncryptor {
    cipher: Aes256Gcm,
}

impl FileEncryptor {
    /// Load or generate the encryption key for `dir`.
    ///
    /// If `.lexera.key` exists in `dir`, its contents are used.
    /// Otherwise a fresh random key is generated and written atomically.
    pub fn new(dir: &Path) -> Result<Self, std::io::Error> {
        let key_path = dir.join(KEY_FILENAME);
        let key_bytes = if key_path.exists() {
            let data = fs::read(&key_path)?;
            if data.len() != KEY_LEN {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!(
                        "Encryption key file has wrong length: expected {} bytes, got {}",
                        KEY_LEN,
                        data.len()
                    ),
                ));
            }
            let mut buf = [0u8; KEY_LEN];
            buf.copy_from_slice(&data);
            buf
        } else {
            let mut buf = [0u8; KEY_LEN];
            OsRng.fill_bytes(&mut buf);
            // Atomic write: tmp + rename
            let tmp_path = key_path.with_extension("key.tmp");
            let mut file = fs::File::create(&tmp_path)?;
            file.write_all(&buf)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&tmp_path, &key_path)?;
            buf
        };

        let cipher = Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Failed to create AES cipher: {}", e),
            )
        })?;

        Ok(Self { cipher })
    }

    /// Encrypt plaintext content into the on-disk format:
    /// `MAGIC (4) | nonce (12) | ciphertext+tag`.
    pub fn encrypt(&self, plaintext: &str) -> Result<Vec<u8>, std::io::Error> {
        let mut nonce_bytes = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = self
            .cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| {
                std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("Encryption failed: {}", e),
                )
            })?;

        let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + ciphertext.len());
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    /// Decrypt an on-disk blob back to plaintext.
    ///
    /// Returns `Err` if the data is too short or decryption fails.
    pub fn decrypt(&self, data: &[u8]) -> Result<String, std::io::Error> {
        let min_len = MAGIC.len() + NONCE_LEN + 1; // at least 1 byte of ciphertext
        if data.len() < min_len {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Encrypted data too short",
            ));
        }
        if &data[..MAGIC.len()] != MAGIC {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Missing encryption magic header",
            ));
        }

        let nonce_bytes = &data[MAGIC.len()..MAGIC.len() + NONCE_LEN];
        let nonce = Nonce::from_slice(nonce_bytes);
        let ciphertext = &data[MAGIC.len() + NONCE_LEN..];

        let plaintext = self.cipher.decrypt(nonce, ciphertext).map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Decryption failed: {}", e),
            )
        })?;

        String::from_utf8(plaintext).map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Decrypted content is not valid UTF-8: {}", e),
            )
        })
    }

    /// Return `true` if `data` starts with the encryption magic header.
    pub fn is_encrypted(data: &[u8]) -> bool {
        data.len() >= MAGIC.len() && &data[..MAGIC.len()] == MAGIC
    }

    /// Read a file, detect whether it is encrypted or legacy plaintext,
    /// and return the plaintext content. If the file was unencrypted, it is
    /// re-written as encrypted (migration).
    pub fn read_and_migrate(&self, path: &Path) -> Result<String, std::io::Error> {
        let raw = fs::read(path)?;

        if Self::is_encrypted(&raw) {
            return self.decrypt(&raw);
        }

        // Legacy unencrypted file: read as UTF-8 and encrypt-in-place.
        let plaintext = String::from_utf8(raw).map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Legacy file is not valid UTF-8: {}", e),
            )
        })?;

        // Migrate: encrypt and write back atomically.
        let encrypted = self.encrypt(&plaintext)?;
        let tmp_path = path.with_extension("md.enc.tmp");
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(&encrypted)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp_path, path)?;

        log::info!(
            "[encryption.read_and_migrate] Migrated '{}' to encrypted format",
            path.display()
        );

        Ok(plaintext)
    }

    /// Write content to a file, encrypted.
    /// Uses atomic write (tmp + rename).
    pub fn write_encrypted(&self, path: &Path, content: &str) -> Result<(), std::io::Error> {
        let encrypted = self.encrypt(content)?;
        let tmp_path = path.with_extension("md.tmp");
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(&encrypted)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp_path, path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let enc = FileEncryptor::new(dir.path()).unwrap();

        let plaintext = "---\nkanban-plugin: board\n---\n\n## Column A\n\n- card 1\n- card 2\n";
        let encrypted = enc.encrypt(plaintext).unwrap();
        let decrypted = enc.decrypt(&encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypted_data_is_not_plaintext() {
        let dir = tempfile::tempdir().unwrap();
        let enc = FileEncryptor::new(dir.path()).unwrap();

        let plaintext = "---\nkanban-plugin: board\n---\n\n## Captured\n\n- secret note\n";
        let encrypted = enc.encrypt(plaintext).unwrap();

        // The encrypted blob must not contain the plaintext substring
        let encrypted_str = String::from_utf8_lossy(&encrypted);
        assert!(
            !encrypted_str.contains("secret note"),
            "Encrypted data should not contain plaintext"
        );
        assert!(
            !encrypted_str.contains("kanban-plugin"),
            "Encrypted data should not contain plaintext"
        );

        // And it should start with the magic header
        assert!(FileEncryptor::is_encrypted(&encrypted));
    }

    #[test]
    fn test_is_encrypted_detection() {
        assert!(FileEncryptor::is_encrypted(
            b"LEXE\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00data"
        ));
        assert!(!FileEncryptor::is_encrypted(
            b"---\nkanban-plugin: board\n---"
        ));
        assert!(!FileEncryptor::is_encrypted(b"LEX")); // too short
        assert!(!FileEncryptor::is_encrypted(b""));
    }

    #[test]
    fn test_key_persists_across_instances() {
        let dir = tempfile::tempdir().unwrap();

        let plaintext = "hello encryption";
        let encrypted = {
            let enc = FileEncryptor::new(dir.path()).unwrap();
            enc.encrypt(plaintext).unwrap()
        };

        // New instance loads the same key
        let enc2 = FileEncryptor::new(dir.path()).unwrap();
        let decrypted = enc2.decrypt(&encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_key_file_created_on_first_use() {
        let dir = tempfile::tempdir().unwrap();
        let key_path = dir.path().join(KEY_FILENAME);
        assert!(!key_path.exists());

        let _enc = FileEncryptor::new(dir.path()).unwrap();
        assert!(key_path.exists());

        let key_data = fs::read(&key_path).unwrap();
        assert_eq!(key_data.len(), KEY_LEN);
    }

    #[test]
    fn test_read_and_migrate_legacy_file() {
        let dir = tempfile::tempdir().unwrap();
        let enc = FileEncryptor::new(dir.path()).unwrap();

        let plaintext = "---\nkanban-plugin: board\n---\n\n## Todo\n\n- my task\n";
        let file_path = dir.path().join("board.md");
        fs::write(&file_path, plaintext).unwrap();

        // First read should detect unencrypted, return plaintext, and migrate
        let content = enc.read_and_migrate(&file_path).unwrap();
        assert_eq!(content, plaintext);

        // File on disk should now be encrypted
        let raw = fs::read(&file_path).unwrap();
        assert!(
            FileEncryptor::is_encrypted(&raw),
            "File should be encrypted after migration"
        );
        assert!(
            !String::from_utf8_lossy(&raw).contains("my task"),
            "Migrated file on disk should not contain plaintext"
        );

        // Second read should decrypt normally
        let content2 = enc.read_and_migrate(&file_path).unwrap();
        assert_eq!(content2, plaintext);
    }

    #[test]
    fn test_write_encrypted_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let enc = FileEncryptor::new(dir.path()).unwrap();

        let plaintext = "encrypted board content";
        let file_path = dir.path().join("test.md");
        enc.write_encrypted(&file_path, plaintext).unwrap();

        // Raw file should be encrypted
        let raw = fs::read(&file_path).unwrap();
        assert!(FileEncryptor::is_encrypted(&raw));

        // Read back via read_and_migrate
        let content = enc.read_and_migrate(&file_path).unwrap();
        assert_eq!(content, plaintext);
    }

    #[test]
    fn test_different_keys_cannot_decrypt() {
        let dir1 = tempfile::tempdir().unwrap();
        let dir2 = tempfile::tempdir().unwrap();
        let enc1 = FileEncryptor::new(dir1.path()).unwrap();
        let enc2 = FileEncryptor::new(dir2.path()).unwrap();

        let plaintext = "secret data";
        let encrypted = enc1.encrypt(plaintext).unwrap();

        // Decrypting with a different key should fail
        let result = enc2.decrypt(&encrypted);
        assert!(result.is_err());
    }

    #[test]
    fn test_corrupted_data_fails_gracefully() {
        let dir = tempfile::tempdir().unwrap();
        let enc = FileEncryptor::new(dir.path()).unwrap();

        // Valid magic + nonce but garbled ciphertext
        let mut bad_data = Vec::new();
        bad_data.extend_from_slice(MAGIC);
        bad_data.extend_from_slice(&[0u8; NONCE_LEN]);
        bad_data.extend_from_slice(b"corrupted ciphertext here");

        let result = enc.decrypt(&bad_data);
        assert!(result.is_err());
    }
}
