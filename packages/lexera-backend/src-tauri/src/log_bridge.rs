use env_logger::{Logger, Target};
use log::{Log, Metadata, Record, SetLoggerError};
use serde::Serialize;
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use tokio::sync::broadcast;

/// Maximum number of log entries to keep in the in-memory ring buffer.
const MAX_LOG_ENTRIES: usize = 2000;
/// Capacity of the log broadcast channel for live log streaming.
const LOG_BROADCAST_CAPACITY: usize = 512;
/// Maximum log file size before rotation (10 MB).
const MAX_LOG_FILE_SIZE: u64 = 10 * 1024 * 1024;
/// Maximum number of rotated log files to keep (backend.log.1, .2).
const MAX_ROTATED_FILES: usize = 2;
/// Flush the buffered writer every N lines.
const FLUSH_INTERVAL_LINES: u64 = 100;
/// Flush the buffered writer every N seconds.
const FLUSH_INTERVAL_SECS: u64 = 2;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendLogEntry {
    pub timestamp_ms: u64,
    pub level: String,
    pub target: String,
    pub message: String,
}

struct BackendLogHub {
    entries: Mutex<VecDeque<BackendLogEntry>>,
    tx: broadcast::Sender<BackendLogEntry>,
}

impl BackendLogHub {
    fn push(&self, entry: BackendLogEntry) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.push_back(entry.clone());
            while entries.len() > MAX_LOG_ENTRIES {
                entries.pop_front();
            }
        }
        let _ = self.tx.send(entry);
    }

    fn recent_entries(&self) -> Vec<BackendLogEntry> {
        self.entries
            .lock()
            .map(|entries| entries.iter().cloned().collect())
            .unwrap_or_default()
    }
}

static LOG_HUB: LazyLock<BackendLogHub> = LazyLock::new(|| {
    let (tx, _) = broadcast::channel(LOG_BROADCAST_CAPACITY);
    BackendLogHub {
        entries: Mutex::new(VecDeque::with_capacity(MAX_LOG_ENTRIES)),
        tx,
    }
});

struct BackendLogFile {
    path: PathBuf,
    writer: Mutex<Option<BufWriter<File>>>,
    /// Lines written since last flush.
    lines_since_flush: AtomicU64,
    /// Current file size estimate (bytes written since open/rotation).
    current_size: AtomicU64,
}

impl BackendLogFile {
    fn new() -> Self {
        let path = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(crate::config::CONFIG_DIR_NAME)
            .join("logs")
            .join("backend.log");

        // Rotate on startup if the existing file is too large.
        Self::rotate_if_needed_at_path(&path);

        let (writer, size) = match Self::open(&path) {
            Ok(file) => {
                let size = file.metadata().map(|m| m.len()).unwrap_or(0);
                (Some(BufWriter::new(file)), size)
            }
            Err(_) => (None, 0),
        };

        Self {
            path,
            writer: Mutex::new(writer),
            lines_since_flush: AtomicU64::new(0),
            current_size: AtomicU64::new(size),
        }
    }

    fn open(path: &Path) -> io::Result<File> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        OpenOptions::new().create(true).append(true).open(path)
    }

    /// Rotate log files at the given path if the current file exceeds the size limit.
    fn rotate_if_needed_at_path(path: &Path) {
        let size = match fs::metadata(path) {
            Ok(m) => m.len(),
            Err(_) => return,
        };
        if size <= MAX_LOG_FILE_SIZE {
            return;
        }
        Self::do_rotate(path);
    }

    /// Perform the actual rotation: shift .1 -> .2, current -> .1, etc.
    /// Deletes files beyond MAX_ROTATED_FILES.
    fn do_rotate(base_path: &Path) {
        let base = base_path.to_string_lossy().to_string();

        // Delete the oldest if it exists (e.g. backend.log.2).
        let oldest = format!("{}.{}", base, MAX_ROTATED_FILES);
        let _ = fs::remove_file(&oldest);

        // Shift existing rotated files up by one.
        for i in (1..MAX_ROTATED_FILES).rev() {
            let from = format!("{}.{}", base, i);
            let to = format!("{}.{}", base, i + 1);
            let _ = fs::rename(&from, &to);
        }

        // Rotate current -> .1.
        let _ = fs::rename(base_path, format!("{}.1", base));
    }

    /// Check size and rotate if necessary. Called with lock held; reopens the file.
    fn maybe_rotate(&self, guard: &mut Option<BufWriter<File>>) {
        let size = self.current_size.load(Ordering::Relaxed);
        if size <= MAX_LOG_FILE_SIZE {
            return;
        }

        // Drop the current writer so the file handle is closed before rename.
        *guard = None;

        Self::do_rotate(&self.path);

        // Reopen a fresh file.
        if let Ok(file) = Self::open(&self.path) {
            *guard = Some(BufWriter::new(file));
        }
        self.current_size.store(0, Ordering::Relaxed);
        self.lines_since_flush.store(0, Ordering::Relaxed);
    }

    fn append_entry(&self, entry: &BackendLogEntry) {
        let mut guard = match self.writer.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if guard.is_none() {
            if let Ok(file) = Self::open(&self.path) {
                let size = file.metadata().map(|m| m.len()).unwrap_or(0);
                self.current_size.store(size, Ordering::Relaxed);
                *guard = Some(BufWriter::new(file));
            } else {
                return;
            }
        }

        // Check for rotation before writing.
        self.maybe_rotate(&mut guard);

        if let Some(writer) = guard.as_mut() {
            let line = format_log_line(entry);
            let bytes = line.as_bytes();
            let _ = writer.write_all(bytes);
            let _ = writer.write_all(b"\n");

            self.current_size
                .fetch_add(bytes.len() as u64 + 1, Ordering::Relaxed);

            let lines = self.lines_since_flush.fetch_add(1, Ordering::Relaxed) + 1;
            if lines >= FLUSH_INTERVAL_LINES {
                let _ = writer.flush();
                self.lines_since_flush.store(0, Ordering::Relaxed);
            }
        }
    }

    /// Explicitly flush the buffered writer. Called by the periodic flush task.
    fn flush(&self) {
        if let Ok(mut guard) = self.writer.lock() {
            if let Some(writer) = guard.as_mut() {
                let _ = writer.flush();
                self.lines_since_flush.store(0, Ordering::Relaxed);
            }
        }
    }
}

static LOG_FILE: LazyLock<BackendLogFile> = LazyLock::new(BackendLogFile::new);

fn format_log_line(entry: &BackendLogEntry) -> String {
    format!(
        "{} [{}] [{}] {}",
        entry.timestamp_ms,
        entry.level.to_uppercase(),
        entry.target,
        entry.message.replace('\n', "\\n")
    )
}

struct BroadcastLogger {
    inner: Logger,
}

impl Log for BroadcastLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        self.inner.enabled(metadata)
    }

    fn log(&self, record: &Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let entry = BackendLogEntry {
            timestamp_ms,
            level: record.level().to_string().to_lowercase(),
            target: record.target().to_string(),
            message: record.args().to_string(),
        };

        LOG_HUB.push(entry.clone());
        LOG_FILE.append_entry(&entry);
    }

    fn flush(&self) {
        self.inner.flush();
    }
}

/// Spawn a background task that flushes the log file every FLUSH_INTERVAL_SECS seconds.
fn spawn_periodic_flush() {
    std::thread::Builder::new()
        .name("log-flush".into())
        .spawn(|| loop {
            std::thread::sleep(std::time::Duration::from_secs(FLUSH_INTERVAL_SECS));
            LOG_FILE.flush();
        })
        .ok();
}

pub fn init() -> Result<(), SetLoggerError> {
    let _ = &*LOG_FILE;

    let filter = "info,\
        tracing::span=warn,\
        loro_internal=warn,\
        lexera_core::storage::local=warn";

    let mut builder =
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(filter));
    builder.target(Target::Pipe(Box::new(io::sink())));
    let logger = Box::leak(Box::new(BroadcastLogger {
        inner: builder.build(),
    }));
    log::set_logger(logger)?;
    log::set_max_level(log::LevelFilter::Trace);

    spawn_periodic_flush();

    log::info!(
        target: "lexera.log_bridge",
        "Backend logger initialized (buffer_capacity={}, broadcast_capacity={}, file={}, max_file_size={}MB, max_rotated={})",
        MAX_LOG_ENTRIES,
        LOG_BROADCAST_CAPACITY,
        log_file_path(),
        MAX_LOG_FILE_SIZE / (1024 * 1024),
        MAX_ROTATED_FILES
    );
    Ok(())
}

pub fn recent_entries() -> Vec<BackendLogEntry> {
    LOG_HUB.recent_entries()
}

pub fn subscribe() -> broadcast::Receiver<BackendLogEntry> {
    LOG_HUB.tx.subscribe()
}

#[allow(dead_code)]
pub fn push_external_entry(
    level: impl Into<String>,
    target: impl Into<String>,
    message: impl Into<String>,
) {
    let entry = BackendLogEntry {
        timestamp_ms: std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        level: level.into(),
        target: target.into(),
        message: message.into(),
    };
    LOG_HUB.push(entry.clone());
    LOG_FILE.append_entry(&entry);
}

pub fn log_file_path() -> String {
    LOG_FILE.path.display().to_string()
}

/// Write a crash report to a dedicated crash log file next to backend.log.
/// Called from the panic hook — uses only infallible file I/O (no locks that
/// might already be poisoned from the panic).
pub fn write_crash_report(report: &str) {
    let crash_path = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(crate::config::CONFIG_DIR_NAME)
        .join("logs")
        .join("crash.log");

    if let Some(parent) = crash_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&crash_path)
    {
        let _ = file.write_all(report.as_bytes());
        let _ = file.write_all(b"\n");
        let _ = file.flush();
        let _ = file.sync_all();
    }

    // Also try the regular backend.log (best-effort, lock may be poisoned)
    LOG_FILE.append_entry(&BackendLogEntry {
        timestamp_ms: std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        level: "error".to_string(),
        target: "lexera.crash".to_string(),
        message: report.replace('\n', "\\n"),
    });
}

pub fn write_fallback_line(message: &str) {
    let entry = BackendLogEntry {
        timestamp_ms: std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        level: "error".to_string(),
        target: "lexera.log_bridge".to_string(),
        message: message.to_string(),
    };
    LOG_HUB.push(entry.clone());
    LOG_FILE.append_entry(&entry);
}
