use crate::config::{save_config, SyncConfig};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

/// Service that wraps the raw `RwLock<SyncConfig>` and provides typed
/// read/mutate/save operations so handlers don't deal with lock+save boilerplate.
#[derive(Clone)]
pub struct ConfigService {
    config: Arc<RwLock<SyncConfig>>,
    config_path: PathBuf,
}

impl ConfigService {
    pub fn new(config: Arc<RwLock<SyncConfig>>, config_path: PathBuf) -> Self {
        Self {
            config,
            config_path,
        }
    }

    /// Read the config without modifying it.
    pub fn read<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&SyncConfig) -> R,
    {
        let cfg = self.config.read().expect("config lock poisoned");
        f(&cfg)
    }

    /// Mutate the config and save to disk.
    /// Returns the value produced by the closure, or an I/O error if save fails.
    pub fn mutate_and_save<F, R>(&self, f: F) -> Result<R, std::io::Error>
    where
        F: FnOnce(&mut SyncConfig) -> R,
    {
        let mut cfg = self.config.write().expect("config lock poisoned");
        let result = f(&mut cfg);
        save_config(&self.config_path, &cfg)?;
        Ok(result)
    }
}
