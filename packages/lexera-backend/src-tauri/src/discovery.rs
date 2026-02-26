/// UDP broadcast discovery for finding other Lexera backends on the LAN.
///
/// Each backend periodically broadcasts a JSON beacon on UDP port 41820.
/// Other backends listening on the same port discover peers automatically.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::net::UdpSocket;

const DISCOVERY_PORT: u16 = 41820;
const ANNOUNCE_INTERVAL_SECS: u64 = 5;
const PEER_TTL_SECS: u64 = 20;

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
    pub fn start(&mut self, http_port: u16, user_id: String, user_name: String) {
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

            let mut buf = [0u8; 1024];
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
