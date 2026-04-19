//! Plugin registry — central store of plugins keyed by `(kind, id)`.

use std::collections::HashMap;
use std::sync::Arc;

/// Discriminator for plugin kinds. Mirrors the frontend `PluginKind` enum in
/// `lexera-kanban/src/plugins/interfaces.js`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PluginKind {
    Export,
    Renderer,
    Importer,
    Transform,
}

impl PluginKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            PluginKind::Export => "export",
            PluginKind::Renderer => "renderer",
            PluginKind::Importer => "importer",
            PluginKind::Transform => "transform",
        }
    }
}

/// Shared metadata attached to every plugin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginMetadata {
    pub id: String,
    pub name: String,
    pub version: String,
    pub priority: i32,
    pub requires: Vec<String>,
}

impl PluginMetadata {
    pub fn new<S: Into<String>>(id: S, name: S, version: S) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            version: version.into(),
            priority: 0,
            requires: Vec::new(),
        }
    }

    pub fn with_priority(mut self, priority: i32) -> Self {
        self.priority = priority;
        self
    }

    pub fn with_requires<I: IntoIterator<Item = String>>(mut self, requires: I) -> Self {
        self.requires = requires.into_iter().collect();
        self
    }
}

/// Base trait every plugin implements.
pub trait Plugin: Send + Sync {
    fn kind(&self) -> PluginKind;
    fn metadata(&self) -> &PluginMetadata;
}

/// Central plugin registry. Holds plugins behind `Arc<dyn Plugin>` so callers can
/// downcast (via `Any`) or look up by metadata id within a kind.
#[derive(Default)]
pub struct PluginRegistry {
    by_kind: HashMap<PluginKind, HashMap<String, Arc<dyn Plugin>>>,
    disabled: std::collections::HashSet<String>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register<P: Plugin + 'static>(&mut self, plugin: P) -> Result<(), PluginRegistryError> {
        let meta = plugin.metadata().clone();
        if meta.id.trim().is_empty() {
            return Err(PluginRegistryError::InvalidMetadata("empty id".into()));
        }
        if meta.version.trim().is_empty() {
            return Err(PluginRegistryError::InvalidMetadata("empty version".into()));
        }
        let kind = plugin.kind();
        let bucket = self.by_kind.entry(kind).or_default();
        bucket.insert(meta.id.clone(), Arc::new(plugin));
        Ok(())
    }

    pub fn unregister(&mut self, kind: PluginKind, id: &str) -> bool {
        self.by_kind
            .get_mut(&kind)
            .and_then(|bucket| bucket.remove(id))
            .is_some()
    }

    pub fn get(&self, kind: PluginKind, id: &str) -> Option<Arc<dyn Plugin>> {
        self.by_kind.get(&kind)?.get(id).cloned()
    }

    pub fn by_kind(&self, kind: PluginKind) -> Vec<Arc<dyn Plugin>> {
        let Some(bucket) = self.by_kind.get(&kind) else {
            return Vec::new();
        };
        let mut list: Vec<Arc<dyn Plugin>> = bucket
            .values()
            .filter(|p| !self.disabled.contains(&p.metadata().id))
            .cloned()
            .collect();
        list.sort_by(|a, b| b.metadata().priority.cmp(&a.metadata().priority));
        list
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) {
        if enabled {
            self.disabled.remove(id);
        } else {
            self.disabled.insert(id.to_string());
        }
    }

    pub fn is_enabled(&self, id: &str) -> bool {
        !self.disabled.contains(id)
    }

    pub fn total(&self) -> usize {
        self.by_kind.values().map(|b| b.len()).sum()
    }

    pub fn count(&self, kind: PluginKind) -> usize {
        self.by_kind.get(&kind).map(|b| b.len()).unwrap_or(0)
    }

    pub fn clear(&mut self) {
        self.by_kind.clear();
        self.disabled.clear();
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PluginRegistryError {
    #[error("invalid plugin metadata: {0}")]
    InvalidMetadata(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestPlugin {
        meta: PluginMetadata,
        kind: PluginKind,
    }

    impl Plugin for TestPlugin {
        fn kind(&self) -> PluginKind {
            self.kind
        }
        fn metadata(&self) -> &PluginMetadata {
            &self.meta
        }
    }

    fn make(id: &str, kind: PluginKind, priority: i32) -> TestPlugin {
        TestPlugin {
            meta: PluginMetadata::new(id, "Test", "1.0.0").with_priority(priority),
            kind,
        }
    }

    #[test]
    fn registers_and_retrieves_plugins() {
        let mut reg = PluginRegistry::new();
        reg.register(make("a", PluginKind::Export, 0)).unwrap();
        reg.register(make("b", PluginKind::Export, 0)).unwrap();
        reg.register(make("r", PluginKind::Renderer, 0)).unwrap();

        assert_eq!(reg.total(), 3);
        assert_eq!(reg.count(PluginKind::Export), 2);
        assert_eq!(reg.count(PluginKind::Renderer), 1);

        assert!(reg.get(PluginKind::Export, "a").is_some());
        assert!(reg.get(PluginKind::Export, "missing").is_none());
    }

    #[test]
    fn rejects_empty_id_or_version() {
        let mut reg = PluginRegistry::new();
        let bad_id = TestPlugin {
            meta: PluginMetadata::new("", "X", "1.0.0"),
            kind: PluginKind::Export,
        };
        let bad_ver = TestPlugin {
            meta: PluginMetadata::new("x", "X", ""),
            kind: PluginKind::Export,
        };
        assert!(reg.register(bad_id).is_err());
        assert!(reg.register(bad_ver).is_err());
        assert_eq!(reg.total(), 0);
    }

    #[test]
    fn by_kind_is_sorted_by_priority_desc() {
        let mut reg = PluginRegistry::new();
        reg.register(make("low", PluginKind::Export, 1)).unwrap();
        reg.register(make("high", PluginKind::Export, 100)).unwrap();
        reg.register(make("mid", PluginKind::Export, 50)).unwrap();
        let ids: Vec<String> = reg
            .by_kind(PluginKind::Export)
            .into_iter()
            .map(|p| p.metadata().id.clone())
            .collect();
        assert_eq!(ids, vec!["high", "mid", "low"]);
    }

    #[test]
    fn disabled_plugins_hidden_from_by_kind() {
        let mut reg = PluginRegistry::new();
        reg.register(make("a", PluginKind::Export, 0)).unwrap();
        reg.register(make("b", PluginKind::Export, 0)).unwrap();
        reg.set_enabled("b", false);
        let ids: Vec<String> = reg
            .by_kind(PluginKind::Export)
            .into_iter()
            .map(|p| p.metadata().id.clone())
            .collect();
        assert_eq!(ids, vec!["a"]);
        assert!(reg.is_enabled("a"));
        assert!(!reg.is_enabled("b"));
    }

    #[test]
    fn unregister_removes_plugin() {
        let mut reg = PluginRegistry::new();
        reg.register(make("x", PluginKind::Export, 0)).unwrap();
        assert!(reg.unregister(PluginKind::Export, "x"));
        assert!(!reg.unregister(PluginKind::Export, "x"));
        assert_eq!(reg.total(), 0);
    }
}
