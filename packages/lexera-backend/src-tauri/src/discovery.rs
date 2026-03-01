/// UDP broadcast discovery for finding other Lexera backends on the LAN.
///
/// Each backend periodically broadcasts a JSON beacon on UDP port 41820.
/// Other backends listening on the same port discover peers automatically.
use lexera_core::watcher::types::BoardChangeEvent;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::net::UdpSocket;
use tokio::sync::broadcast;

const DISCOVERY_PORT: u16 = 41820;
const ANNOUNCE_INTERVAL_SECS: u64 = 5;
const PEER_TTL_SECS: u64 = 20;
/// Maximum size of a single UDP beacon packet (bytes).
const UDP_RECV_BUFFER_SIZE: usize = 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Beacon {
    app: String,
    user_id: String,
    user_name: String,
    port: u16,
    version: u32,
}

#[derive(Debug, Clone)]
pub struct DiscoveredPeer {
    pub address: String,
    pub port: u16,
    pub user_id: String,
    pub user_name: String,
    pub last_seen: Instant,
}

pub struct DiscoveryService {
    peers: Arc<std::sync::Mutex<HashMap<String, DiscoveredPeer>>>,
    shutdown: Option<tokio::sync::watch::Sender<bool>>,
}

impl DiscoveryService {
    pub fn new() -> Self {
        Self {
            peers: Arc::new(std::sync::Mutex::new(HashMap::new())),
            shutdown: None,
        }
    }

    /// Start the discovery announcer and listener.
    /// Must be called from a tokio runtime context.
    pub fn start(&mut self, http_port: u16, user_id: String, user_name: String, event_tx: broadcast::Sender<BoardChangeEvent>) {
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        self.shutdown = Some(shutdown_tx);

        let peers = self.peers.clone();

        // Spawn announcer
        let announce_user_id = user_id.clone();
        let announce_user_name = user_name.clone();
        let mut announce_shutdown = shutdown_rx.clone();
        tokio::spawn(async move {
            let beacon = Beacon {
                app: "lexera".to_string(),
                user_id: announce_user_id,
                user_name: announce_user_name,
                port: http_port,
                version: 1,
            };
            let payload = match serde_json::to_vec(&beacon) {
                Ok(p) => p,
                Err(e) => {
                    log::error!("[discovery] Failed to serialize beacon: {}", e);
                    return;
                }
            };

            let socket = match UdpSocket::bind("0.0.0.0:0").await {
                Ok(s) => s,
                Err(e) => {
                    log::error!("[discovery] Failed to bind announcer socket: {}", e);
                    return;
                }
            };
            if let Err(e) = socket.set_broadcast(true) {
                log::error!("[discovery] Failed to set SO_BROADCAST: {}", e);
                return;
            }

            let broadcast_addr = format!("255.255.255.255:{}", DISCOVERY_PORT);
            log::info!(
                "[discovery] Announcer started, broadcasting to {} every {}s",
                broadcast_addr,
                ANNOUNCE_INTERVAL_SECS
            );

            let mut interval =
                tokio::time::interval(tokio::time::Duration::from_secs(ANNOUNCE_INTERVAL_SECS));
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        if let Err(e) = socket.send_to(&payload, &broadcast_addr).await {
                            log::warn!("[discovery] Broadcast send failed: {}", e);
                        }
                    }
                    _ = announce_shutdown.changed() => {
                        log::info!("[discovery] Announcer shutting down");
                        break;
                    }
                }
            }
        });

        // Spawn listener
        let listen_user_id = user_id;
        let mut listen_shutdown = shutdown_rx;
        let listen_event_tx = event_tx;
        tokio::spawn(async move {
            let socket = match UdpSocket::bind(format!("0.0.0.0:{}", DISCOVERY_PORT)).await {
                Ok(s) => s,
                Err(e) => {
                    log::error!(
                        "[discovery] Failed to bind listener on port {}: {}",
                        DISCOVERY_PORT,
                        e
                    );
                    return;
                }
            };

            log::info!(
                "[discovery] Listener started on port {}",
                DISCOVERY_PORT
            );

            let mut buf = [0u8; UDP_RECV_BUFFER_SIZE];
            loop {
                tokio::select! {
                    result = socket.recv_from(&mut buf) => {
                        match result {
                            Ok((len, src_addr)) => {
                                if let Ok(beacon) = serde_json::from_slice::<Beacon>(&buf[..len]) {
                                    // Ignore our own broadcasts
                                    if beacon.app != "lexera" || beacon.user_id == listen_user_id {
                                        continue;
                                    }

                                    let peer = DiscoveredPeer {
                                        address: src_addr.ip().to_string(),
                                        port: beacon.port,
                                        user_id: beacon.user_id.clone(),
                                        user_name: beacon.user_name.clone(),
                                        last_seen: Instant::now(),
                                    };

                                    if let Ok(mut map) = peers.lock() {
                                        let is_new = !map.contains_key(&beacon.user_id);
                                        map.insert(beacon.user_id.clone(), peer);
                                        if is_new {
                                            log::info!(
                                                "[discovery] Found peer: {} ({}) at {}:{}",
                                                beacon.user_name,
                                                beacon.user_id,
                                                src_addr.ip(),
                                                beacon.port
                                            );
                                            let _ = listen_event_tx.send(BoardChangeEvent::PeerDiscoveryChanged);
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                log::warn!("[discovery] Recv error: {}", e);
                            }
                        }
                    }
                    _ = listen_shutdown.changed() => {
                        log::info!("[discovery] Listener shutting down");
                        break;
                    }
                }
            }
        });
    }

    /// Stop the discovery service.
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(true);
        }
    }

    /// Return peers seen within the TTL window, pruning stale entries.
    pub fn list_peers(&self) -> Vec<DiscoveredPeer> {
        let mut result = Vec::new();
        if let Ok(mut map) = self.peers.lock() {
            let cutoff = Instant::now() - std::time::Duration::from_secs(PEER_TTL_SECS);
            map.retain(|_, peer| peer.last_seen > cutoff);
            for peer in map.values() {
                result.push(peer.clone());
            }
        }
        result
    }
}

impl Drop for DiscoveryService {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    // --- Beacon serialization / deserialization ---

    #[test]
    fn beacon_serializes_to_json() {
        let beacon = Beacon {
            app: "lexera".to_string(),
            user_id: "u-123".to_string(),
            user_name: "Alice".to_string(),
            port: 13080,
            version: 1,
        };
        let json = serde_json::to_string(&beacon).unwrap();
        assert!(json.contains("\"app\":\"lexera\""));
        assert!(json.contains("\"user_id\":\"u-123\""));
        assert!(json.contains("\"user_name\":\"Alice\""));
        assert!(json.contains("\"port\":13080"));
        assert!(json.contains("\"version\":1"));
    }

    #[test]
    fn beacon_deserializes_from_json() {
        let json = r#"{
            "app": "lexera",
            "user_id": "u-456",
            "user_name": "Bob",
            "port": 9999,
            "version": 2
        }"#;
        let beacon: Beacon = serde_json::from_str(json).unwrap();
        assert_eq!(beacon.app, "lexera");
        assert_eq!(beacon.user_id, "u-456");
        assert_eq!(beacon.user_name, "Bob");
        assert_eq!(beacon.port, 9999);
        assert_eq!(beacon.version, 2);
    }

    #[test]
    fn beacon_round_trip() {
        let original = Beacon {
            app: "lexera".to_string(),
            user_id: "round-trip-id".to_string(),
            user_name: "Charlie".to_string(),
            port: 41820,
            version: 1,
        };
        let bytes = serde_json::to_vec(&original).unwrap();
        let decoded: Beacon = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded.app, original.app);
        assert_eq!(decoded.user_id, original.user_id);
        assert_eq!(decoded.user_name, original.user_name);
        assert_eq!(decoded.port, original.port);
        assert_eq!(decoded.version, original.version);
    }

    // --- DiscoveryService::new() ---

    #[test]
    fn new_starts_with_empty_peers() {
        let svc = DiscoveryService::new();
        let peers = svc.list_peers();
        assert!(peers.is_empty(), "New service should have no peers");
    }

    #[test]
    fn new_has_no_shutdown_sender() {
        let svc = DiscoveryService::new();
        assert!(
            svc.shutdown.is_none(),
            "New service should not have a shutdown sender"
        );
    }

    // --- stop() ---

    #[test]
    fn stop_without_start_does_not_panic() {
        let mut svc = DiscoveryService::new();
        // Must not panic even though start() was never called
        svc.stop();
        assert!(svc.shutdown.is_none());
    }

    #[test]
    fn stop_clears_shutdown_sender() {
        let mut svc = DiscoveryService::new();
        // Manually set a shutdown sender to simulate post-start state
        let (tx, _rx) = tokio::sync::watch::channel(false);
        svc.shutdown = Some(tx);

        svc.stop();
        assert!(
            svc.shutdown.is_none(),
            "stop() should take the shutdown sender"
        );
    }

    // --- list_peers() filters stale entries beyond TTL ---

    #[test]
    fn list_peers_returns_fresh_peer() {
        let svc = DiscoveryService::new();

        // Manually insert a fresh peer
        {
            let mut map = svc.peers.lock().unwrap();
            map.insert(
                "peer-1".to_string(),
                DiscoveredPeer {
                    address: "192.168.1.10".to_string(),
                    port: 13080,
                    user_id: "peer-1".to_string(),
                    user_name: "Fresh Peer".to_string(),
                    last_seen: Instant::now(),
                },
            );
        }

        let peers = svc.list_peers();
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].user_id, "peer-1");
        assert_eq!(peers[0].user_name, "Fresh Peer");
    }

    #[test]
    fn list_peers_prunes_stale_entries() {
        let svc = DiscoveryService::new();

        // Insert a peer whose last_seen is well beyond the TTL (PEER_TTL_SECS = 20)
        {
            let mut map = svc.peers.lock().unwrap();
            map.insert(
                "stale-peer".to_string(),
                DiscoveredPeer {
                    address: "10.0.0.1".to_string(),
                    port: 13080,
                    user_id: "stale-peer".to_string(),
                    user_name: "Old Peer".to_string(),
                    last_seen: Instant::now() - Duration::from_secs(PEER_TTL_SECS + 5),
                },
            );
        }

        let peers = svc.list_peers();
        assert!(
            peers.is_empty(),
            "Stale peer should have been pruned, but got {} peers",
            peers.len()
        );

        // The internal map should also have been cleaned
        let map = svc.peers.lock().unwrap();
        assert!(map.is_empty(), "Internal map should be empty after pruning");
    }

    #[test]
    fn list_peers_keeps_fresh_and_prunes_stale() {
        let svc = DiscoveryService::new();

        {
            let mut map = svc.peers.lock().unwrap();
            // Fresh peer
            map.insert(
                "fresh".to_string(),
                DiscoveredPeer {
                    address: "10.0.0.2".to_string(),
                    port: 13080,
                    user_id: "fresh".to_string(),
                    user_name: "Fresh".to_string(),
                    last_seen: Instant::now(),
                },
            );
            // Stale peer
            map.insert(
                "stale".to_string(),
                DiscoveredPeer {
                    address: "10.0.0.3".to_string(),
                    port: 13080,
                    user_id: "stale".to_string(),
                    user_name: "Stale".to_string(),
                    last_seen: Instant::now() - Duration::from_secs(PEER_TTL_SECS + 10),
                },
            );
        }

        let peers = svc.list_peers();
        assert_eq!(peers.len(), 1, "Only the fresh peer should remain");
        assert_eq!(peers[0].user_id, "fresh");
    }

    // --- Self-discovery prevention ---
    // The listener ignores beacons where beacon.user_id == own user_id.
    // We test this logic by simulating what the listener does with the peers map.

    #[test]
    fn self_discovery_prevention_logic() {
        let own_user_id = "my-own-id";

        // Simulate beacon processing logic from the listener
        let beacon = Beacon {
            app: "lexera".to_string(),
            user_id: own_user_id.to_string(),
            user_name: "Me".to_string(),
            port: 13080,
            version: 1,
        };

        let svc = DiscoveryService::new();

        // Replicate the listener's filtering condition
        let should_ignore = beacon.app != "lexera" || beacon.user_id == own_user_id;
        assert!(
            should_ignore,
            "Own beacons must be ignored by the listener"
        );

        // Verify no peer was added
        let peers = svc.list_peers();
        assert!(peers.is_empty());
    }

    #[test]
    fn other_user_beacon_is_not_ignored() {
        let own_user_id = "my-own-id";

        let beacon = Beacon {
            app: "lexera".to_string(),
            user_id: "other-user".to_string(),
            user_name: "Other".to_string(),
            port: 13080,
            version: 1,
        };

        // Replicate the listener's filtering condition
        let should_ignore = beacon.app != "lexera" || beacon.user_id == own_user_id;
        assert!(
            !should_ignore,
            "Beacons from other users must NOT be ignored"
        );
    }

    // --- Peer deduplication ---

    #[test]
    fn repeated_beacon_updates_last_seen_no_duplicate() {
        let svc = DiscoveryService::new();

        let early = Instant::now() - Duration::from_secs(10);

        // Insert the first beacon
        {
            let mut map = svc.peers.lock().unwrap();
            map.insert(
                "peer-dup".to_string(),
                DiscoveredPeer {
                    address: "10.0.0.5".to_string(),
                    port: 13080,
                    user_id: "peer-dup".to_string(),
                    user_name: "Dup Peer".to_string(),
                    last_seen: early,
                },
            );
        }

        // Simulate receiving a second beacon from the same peer (updates last_seen)
        let updated_time = Instant::now();
        {
            let mut map = svc.peers.lock().unwrap();
            map.insert(
                "peer-dup".to_string(),
                DiscoveredPeer {
                    address: "10.0.0.5".to_string(),
                    port: 13080,
                    user_id: "peer-dup".to_string(),
                    user_name: "Dup Peer".to_string(),
                    last_seen: updated_time,
                },
            );
        }

        let peers = svc.list_peers();
        assert_eq!(peers.len(), 1, "Duplicate beacon must not create a second entry");
        assert_eq!(peers[0].user_id, "peer-dup");

        // The last_seen should be the more recent time
        let map = svc.peers.lock().unwrap();
        let peer = map.get("peer-dup").unwrap();
        assert!(
            peer.last_seen >= updated_time,
            "last_seen should have been updated to the newer timestamp"
        );
    }

    #[test]
    fn different_peers_create_separate_entries() {
        let svc = DiscoveryService::new();

        {
            let mut map = svc.peers.lock().unwrap();
            map.insert(
                "peer-a".to_string(),
                DiscoveredPeer {
                    address: "10.0.0.1".to_string(),
                    port: 13080,
                    user_id: "peer-a".to_string(),
                    user_name: "Peer A".to_string(),
                    last_seen: Instant::now(),
                },
            );
            map.insert(
                "peer-b".to_string(),
                DiscoveredPeer {
                    address: "10.0.0.2".to_string(),
                    port: 13081,
                    user_id: "peer-b".to_string(),
                    user_name: "Peer B".to_string(),
                    last_seen: Instant::now(),
                },
            );
        }

        let peers = svc.list_peers();
        assert_eq!(peers.len(), 2);
        let ids: Vec<&str> = peers.iter().map(|p| p.user_id.as_str()).collect();
        assert!(ids.contains(&"peer-a"));
        assert!(ids.contains(&"peer-b"));
    }
}
