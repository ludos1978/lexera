//! Export plugin sub-trait.
//!
//! Sketch layer: provides a typed contract for future export plugin
//! implementations. Existing exporters in `lexera-core::export` (ical, xbel,
//! presentation, tag_filter, content_transform) intentionally stay as
//! free-standing modules — their input/output shapes are too heterogeneous
//! to force through a single uniform trait without losing expressiveness.
//!
//! When a new export path fits the shape below, implement [`ExportPlugin`] and
//! register it with [`super::PluginRegistry`].

use super::registry::{Plugin, PluginKind, PluginMetadata};

/// Describes one concrete output format an export plugin can produce.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportFormat {
    pub id: String,
    pub label: String,
    pub extension: String,
    pub mime_type: Option<String>,
}

/// Typed contract for plugins that turn kanban data into a serialized format.
pub trait ExportPlugin: Plugin {
    fn supported_formats(&self) -> Vec<ExportFormat>;

    fn can_export(&self, format_id: &str) -> bool {
        self.supported_formats()
            .iter()
            .any(|f| f.id == format_id)
    }
}

/// Adapter: treat an `ExportPlugin` as a `Plugin` of kind `Export`. Useful in
/// tests and when building concrete impls.
pub fn export_plugin_metadata<S: Into<String>>(id: S, name: S, version: S) -> PluginMetadata {
    PluginMetadata::new(id, name, version)
}

#[allow(dead_code)]
pub const KIND: PluginKind = PluginKind::Export;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::PluginRegistry;

    struct DemoExporter {
        meta: PluginMetadata,
    }

    impl Plugin for DemoExporter {
        fn kind(&self) -> PluginKind {
            PluginKind::Export
        }
        fn metadata(&self) -> &PluginMetadata {
            &self.meta
        }
    }

    impl ExportPlugin for DemoExporter {
        fn supported_formats(&self) -> Vec<ExportFormat> {
            vec![
                ExportFormat {
                    id: "demo-text".into(),
                    label: "Demo text".into(),
                    extension: "txt".into(),
                    mime_type: Some("text/plain".into()),
                },
                ExportFormat {
                    id: "demo-json".into(),
                    label: "Demo JSON".into(),
                    extension: "json".into(),
                    mime_type: Some("application/json".into()),
                },
            ]
        }
    }

    #[test]
    fn export_plugin_reports_supported_formats() {
        let exp = DemoExporter {
            meta: PluginMetadata::new("demo", "Demo Exporter", "1.0.0"),
        };
        assert!(exp.can_export("demo-text"));
        assert!(!exp.can_export("nope"));
    }

    #[test]
    fn export_plugin_can_live_in_the_unified_registry() {
        let mut reg = PluginRegistry::new();
        reg.register(DemoExporter {
            meta: PluginMetadata::new("demo", "Demo Exporter", "1.0.0"),
        })
        .unwrap();
        let found = reg.get(PluginKind::Export, "demo").unwrap();
        assert_eq!(found.metadata().id, "demo");
    }
}
