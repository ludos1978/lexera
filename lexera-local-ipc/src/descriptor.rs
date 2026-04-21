//! Descriptor file. Advertises the running backend's IPC endpoint to clients.
//!
//! Located next to the existing `sync.json` and `identity.json` under
//! `dirs::config_dir()/lexera/ipc.json`. Contents are regenerated on every
//! backend start; the `secret` never persists across restarts.

use crate::error::IpcError;
use crate::PROTOCOL_VERSION;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Filename for the descriptor; matches the backend config constant.
pub const DESCRIPTOR_FILENAME: &str = "ipc.json";
/// Parent directory name inside `dirs::config_dir()`. Matches `CONFIG_DIR_NAME`
/// in `lexera-backend`.
pub const CONFIG_DIR_NAME: &str = "lexera";

/// Resolved descriptor path for the current user.
pub fn descriptor_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(CONFIG_DIR_NAME)
        .join(DESCRIPTOR_FILENAME)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Descriptor {
    pub protocol: String,
    pub endpoint: String,
    pub pid: u32,
    pub secret: String,
    pub started_at: String,
}

impl Descriptor {
    /// Build a descriptor with a freshly generated 32-byte base64 secret and
    /// the current process id.
    pub fn new(endpoint: impl Into<String>) -> Self {
        let mut secret_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut secret_bytes);
        let secret = base64::engine::general_purpose::STANDARD.encode(secret_bytes);
        Self {
            protocol: PROTOCOL_VERSION.to_string(),
            endpoint: endpoint.into(),
            pid: std::process::id(),
            secret,
            started_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    /// Atomically write the descriptor to the canonical path.
    pub fn write(&self) -> Result<PathBuf, IpcError> {
        let path = descriptor_path();
        self.write_to(&path)?;
        Ok(path)
    }

    /// Atomically write the descriptor to a specific path.
    ///
    /// Creates the parent directory if missing, writes to a sibling temp file,
    /// fsyncs, then renames over the target. Sets `0600` on Unix.
    pub fn write_to(&self, path: &Path) -> Result<(), IpcError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp_path = tmp_path_for(path);
        let body = serde_json::to_vec_pretty(self)?;
        write_file_restricted(&tmp_path, &body)?;
        std::fs::rename(&tmp_path, path)?;
        Ok(())
    }

    /// Read and parse the descriptor from the canonical path.
    pub fn read() -> Result<Self, IpcError> {
        Self::read_from(&descriptor_path())
    }

    /// Read and parse the descriptor from a specific path.
    pub fn read_from(path: &Path) -> Result<Self, IpcError> {
        let bytes = std::fs::read(path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => IpcError::BackendUnavailable,
            _ => IpcError::Io(e),
        })?;
        let desc: Descriptor = serde_json::from_slice(&bytes)?;
        Ok(desc)
    }

    /// Remove the descriptor file. Not-found is not an error.
    pub fn remove_at(path: &Path) -> Result<(), IpcError> {
        match std::fs::remove_file(path) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(IpcError::Io(e)),
        }
    }

    /// True if the descriptor's protocol version matches this crate.
    pub fn protocol_matches(&self) -> bool {
        self.protocol == PROTOCOL_VERSION
    }

    /// True if the pid in the descriptor refers to a running process.
    pub fn pid_alive(&self) -> bool {
        pid_alive(self.pid)
    }
}

fn tmp_path_for(target: &Path) -> PathBuf {
    let mut file_name = target
        .file_name()
        .map(|s| s.to_os_string())
        .unwrap_or_default();
    file_name.push(".tmp");
    target.with_file_name(file_name)
}

#[cfg(unix)]
fn write_file_restricted(path: &Path, body: &[u8]) -> Result<(), IpcError> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(body)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(windows)]
fn write_file_restricted(path: &Path, body: &[u8]) -> Result<(), IpcError> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)?;
    file.write_all(body)?;
    file.sync_all()?;
    drop(file);
    // Gap #3: restrict the tempfile's DACL to the current user before the
    // atomic rename. On failure, log and continue — the default inherited
    // ACL from the parent directory is still restrictive for per-user
    // config paths, and the secret handshake remains the hard gate.
    if let Err(e) = crate::windows_security::restrict_file_to_current_user(path) {
        log::warn!(
            target: "lexera.ipc.descriptor",
            "restrict_file_to_current_user({}) failed: {}",
            path.display(),
            e
        );
    }
    Ok(())
}

#[cfg(unix)]
pub fn pid_alive(pid: u32) -> bool {
    // `kill(0 | -1 | <-1, 0)` all trigger broadcast/group semantics rather than
    // a liveness check, so reject any value that would map to a non-positive
    // `pid_t`. Valid pids fit in the positive half of `i32`.
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    unsafe {
        if libc::kill(pid as libc::pid_t, 0) == 0 {
            true
        } else {
            // EPERM means the process exists but we cannot signal it; still alive.
            std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
        }
    }
}

#[cfg(windows)]
pub fn pid_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, FALSE, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    if pid == 0 {
        return false;
    }
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if handle == 0 {
            return false;
        }
        let mut code: u32 = 0;
        let ok = GetExitCodeProcess(handle, &mut code);
        CloseHandle(handle);
        ok != 0 && code == STILL_ACTIVE as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn roundtrip_write_and_read() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("ipc.json");
        let desc = Descriptor::new("/tmp/sock");
        desc.write_to(&path).unwrap();

        let parsed = Descriptor::read_from(&path).unwrap();
        assert_eq!(parsed.protocol, PROTOCOL_VERSION);
        assert_eq!(parsed.endpoint, "/tmp/sock");
        assert_eq!(parsed.secret, desc.secret);
        assert_eq!(parsed.pid, std::process::id());
    }

    #[test]
    fn secrets_are_unique_per_instance() {
        let a = Descriptor::new("/tmp/a");
        let b = Descriptor::new("/tmp/b");
        assert_ne!(a.secret, b.secret);
    }

    #[test]
    fn pid_alive_for_current_process() {
        let desc = Descriptor::new("/tmp/x");
        assert!(desc.pid_alive());
    }

    #[test]
    fn pid_not_alive_for_invalid_pid() {
        assert!(!pid_alive(0));
        assert!(!pid_alive(u32::MAX));
    }

    #[test]
    fn protocol_matches_current_version() {
        let desc = Descriptor::new("/tmp/a");
        assert!(desc.protocol_matches());
    }

    #[test]
    fn protocol_mismatch_detected() {
        let mut desc = Descriptor::new("/tmp/a");
        desc.protocol = "lexera-local-ipc/v0".to_string();
        assert!(!desc.protocol_matches());
    }

    #[test]
    fn read_missing_returns_backend_unavailable() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("missing.json");
        let err = Descriptor::read_from(&path).unwrap_err();
        assert!(matches!(err, IpcError::BackendUnavailable));
    }

    #[test]
    fn atomic_write_does_not_leak_tmp_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("ipc.json");
        Descriptor::new("/tmp/a").write_to(&path).unwrap();
        let tmp = tmp_path_for(&path);
        assert!(!tmp.exists());
    }

    #[test]
    #[cfg(unix)]
    fn descriptor_file_is_0600_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let path = dir.path().join("ipc.json");
        Descriptor::new("/tmp/a").write_to(&path).unwrap();
        let meta = std::fs::metadata(&path).unwrap();
        let mode = meta.permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "descriptor must be 0600, got {:o}", mode);
    }
}
