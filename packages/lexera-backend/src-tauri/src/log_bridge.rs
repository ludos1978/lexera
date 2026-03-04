use env_logger::{Logger, Target};
use log::{Log, Metadata, Record, SetLoggerError};
use serde::Serialize;
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use tokio::sync::broadcast;

/// Maximum number of log entries to keep in the in-memory ring buffer.
const MAX_LOG_ENTRIES: usize = 2000;
/// Capacity of the log broadcast channel for live log streaming.
const LOG_BROADCAST_CAPACITY: usize = 512;

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
    file: Mutex<Option<File>>,
}

impl BackendLogFile {
    fn new() -> Self {
        let path = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(crate::config::CONFIG_DIR_NAME)
            .join("logs")
            .join("backend.log");
        let file = Self::open(&path).ok();
        Self {
            path,
            file: Mutex::new(file),
        }
    }

    fn open(path: &Path) -> io::Result<File> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        OpenOptions::new().create(true).append(true).open(path)
    }

    fn append_entry(&self, entry: &BackendLogEntry) {
        let mut guard = match self.file.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if guard.is_none() {
            if let Ok(file) = Self::open(&self.path) {
                *guard = Some(file);
            } else {
                return;
            }
        }
        if let Some(file) = guard.as_mut() {
            let line = format_log_line(entry);
            let _ = file.write_all(line.as_bytes());
            let _ = file.write_all(b"\n");
            let _ = file.flush();
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

pub fn init() -> Result<(), SetLoggerError> {
    let _ = &*LOG_FILE;
    let mut builder =
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn"));
    builder.target(Target::Pipe(Box::new(io::sink())));
    let logger = Box::leak(Box::new(BroadcastLogger {
        inner: builder.build(),
    }));
    log::set_logger(logger)?;
    log::set_max_level(log::LevelFilter::Trace);
    Ok(())
}

pub fn recent_entries() -> Vec<BackendLogEntry> {
    LOG_HUB.recent_entries()
}

pub fn subscribe() -> broadcast::Receiver<BackendLogEntry> {
    LOG_HUB.tx.subscribe()
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
