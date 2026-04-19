//! Unified plugin infrastructure for lexera-core.
//!
//! Mirrors the frontend `LexeraPluginRegistry` (`lexera-kanban/src/plugins/`): one
//! central registry holds plugins of any kind. Each kind is addressed by
//! [`PluginKind`], each plugin carries [`PluginMetadata`] (id / name / version /
//! requires), and concrete plugins live behind typed sub-traits (see
//! [`export::ExportPlugin`]).
//!
//! Phase 5 intentionally keeps this additive — existing modules in
//! `lexera-core::export` keep their current free-function shape. New plugins
//! can register with [`PluginRegistry`]; future work can migrate the existing
//! modules on their own schedule.

pub mod export;
pub mod registry;

pub use registry::{Plugin, PluginKind, PluginMetadata, PluginRegistry};
