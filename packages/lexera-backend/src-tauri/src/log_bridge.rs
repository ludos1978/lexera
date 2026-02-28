use env_logger::Logger;
use log::{Log, Metadata, Record, SetLoggerError};
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex};
use tokio::sync::broadcast;

const MAX_LOG_ENTRIES: usize = 2000;

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
    let (tx, _) = broadcast::channel(512);
    BackendLogHub {
        entries: Mutex::new(VecDeque::with_capacity(MAX_LOG_ENTRIES)),
        tx,
    }
});

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

        self.inner.log(record);

        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        LOG_HUB.push(BackendLogEntry {
            timestamp_ms,
            level: record.level().to_string().to_lowercase(),
            target: record.target().to_string(),
            message: record.args().to_string(),
        });
    }

    fn flush(&self) {
        self.inner.flush();
    }
}

pub fn init() -> Result<(), SetLoggerError> {
    let logger = Box::leak(Box::new(BroadcastLogger {
        inner: env_logger::Builder::from_default_env().build(),
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
