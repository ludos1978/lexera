#[cfg(feature = "crdt")]
pub mod bridge;

#[cfg(not(feature = "crdt"))]
#[path = "bridge_stub.rs"]
pub mod bridge;
