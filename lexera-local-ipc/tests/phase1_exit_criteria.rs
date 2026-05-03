//! Phase 1 exit criteria from IPC-Migration-Plan.md:
//!
//! - Wrong secret rejected.
//! - Stale pid rejected.
//! - Wrong protocol version rejected.
//! - Cross-user endpoint attempts rejected. (Same-uid sanity; cross-uid
//!   requires spawning as another user and is covered by inspection.)
//! - Happy path: descriptor + bind + connect + handshake + frame exchange.

use lexera_local_ipc::frame::{read_frame, write_frame, ClientFrame, ServerFrame};
use lexera_local_ipc::{
    Client, Descriptor, IpcError, Server, PROTOCOL_VERSION,
};
use tempfile::tempdir;

#[cfg(unix)]
fn temp_endpoint(dir: &tempfile::TempDir) -> String {
    dir.path().join("ipc.sock").to_string_lossy().into_owned()
}

#[cfg(windows)]
fn temp_endpoint(_dir: &tempfile::TempDir) -> String {
    // Named pipes live in a global namespace; uniqueify by pid + nanos.
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!(
        r"\\.\pipe\lexera-ipc-test-{}-{}",
        std::process::id(),
        nanos
    )
}

#[tokio::test]
async fn happy_path_ping_roundtrip() {
    let dir = tempdir().unwrap();
    let desc = make_descriptor(&dir);

    let server = Server::bind_with_descriptor(&desc).await.unwrap();

    let server_task = tokio::spawn(async move {
        let mut stream = server.accept().await.unwrap();
        match read_frame::<_, ClientFrame>(&mut stream).await.unwrap() {
            Some(ClientFrame::Ping) => {
                write_frame(&mut stream, &ServerFrame::Pong).await.unwrap();
            }
            other => panic!("expected Ping, got {:?}", other),
        }
    });

    let mut client = Client::connect_with_descriptor(&desc).await.unwrap();
    write_frame(client.stream(), &ClientFrame::Ping).await.unwrap();
    let reply: Option<ServerFrame> = read_frame(client.stream()).await.unwrap();
    assert_eq!(reply, Some(ServerFrame::Pong));

    server_task.await.unwrap();
}

#[tokio::test]
async fn wrong_secret_rejected() {
    let dir = tempdir().unwrap();
    let server_desc = make_descriptor(&dir);

    // Client descriptor carries a different secret.
    let mut client_desc = server_desc.clone();
    client_desc.secret = fresh_secret();

    let server = Server::bind_with_descriptor(&server_desc).await.unwrap();

    let server_task = tokio::spawn(async move {
        let err = server.accept().await.unwrap_err();
        assert!(matches!(err, IpcError::SecretMismatch));
    });

    let err = Client::connect_with_descriptor(&client_desc)
        .await
        .unwrap_err();
    assert!(matches!(err, IpcError::SecretMismatch));

    server_task.await.unwrap();
}

#[tokio::test]
async fn wrong_protocol_version_rejected() {
    let dir = tempdir().unwrap();
    let server_desc = make_descriptor(&dir);

    let mut client_desc = server_desc.clone();
    client_desc.protocol = "lexera-local-ipc/v999".into();

    // `Client::connect_with_descriptor` fails before touching the network
    // because it short-circuits on the protocol-version check.
    let err = Client::connect_with_descriptor(&client_desc)
        .await
        .unwrap_err();
    assert!(matches!(err, IpcError::ProtocolMismatch { .. }));

    // And if a malicious client bypasses the short-circuit by speaking the
    // wrong version on the wire, the server still rejects.
    let server = Server::bind_with_descriptor(&server_desc).await.unwrap();

    let endpoint = server_desc.endpoint.clone();
    let good_secret = server_desc.secret.clone();

    let server_task = tokio::spawn(async move {
        let err = server.accept().await.unwrap_err();
        assert!(matches!(err, IpcError::ProtocolMismatch { .. }));
    });

    // Speak the protocol directly with a wrong version.
    #[cfg(unix)]
    let mut raw = lexera_local_ipc::transport::connect(std::path::Path::new(&endpoint))
        .await
        .unwrap();
    #[cfg(windows)]
    let mut raw = lexera_local_ipc::transport::connect(&endpoint)
        .await
        .unwrap();

    let bad = ClientFrame::Handshake {
        protocol: "lexera-local-ipc/v999".into(),
        secret: good_secret,
    };
    write_frame(&mut raw, &bad).await.unwrap();
    // Read the rejection frame.
    match read_frame::<_, ServerFrame>(&mut raw).await.unwrap() {
        Some(ServerFrame::HandshakeRejected { .. }) => {}
        other => panic!("expected rejection, got {:?}", other),
    }
    drop(raw);

    server_task.await.unwrap();
}

#[tokio::test]
async fn stale_pid_rejected_client_side() {
    // Construct a descriptor with a pid that is definitely not running, then
    // try to connect. The client must reject before touching the endpoint.
    let dir = tempdir().unwrap();
    let mut desc = make_descriptor(&dir);
    desc.pid = u32::MAX; // definitively not alive

    let err = Client::connect_with_descriptor(&desc).await.unwrap_err();
    assert!(matches!(err, IpcError::StalePid(p) if p == u32::MAX));
}

#[tokio::test]
async fn missing_descriptor_yields_backend_unavailable() {
    let dir = tempdir().unwrap();
    let missing = dir.path().join("nope.json");
    let err = Descriptor::read_from(&missing).unwrap_err();
    assert!(matches!(err, IpcError::BackendUnavailable));
}

#[tokio::test]
#[cfg(unix)]
async fn descriptor_file_permissions_are_0600() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir().unwrap();
    let path = dir.path().join("ipc.json");
    Descriptor::new("/tmp/whatever").write_to(&path).unwrap();
    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
}

#[tokio::test]
async fn protocol_version_is_pinned_to_v1() {
    assert_eq!(PROTOCOL_VERSION, "lexera-local-ipc/v1");
}

#[tokio::test]
async fn client_ping_helper_succeeds_against_pong_server() {
    use std::time::Duration;
    let dir = tempdir().unwrap();
    let desc = make_descriptor(&dir);

    let server = Server::bind_with_descriptor(&desc).await.unwrap();
    let server_task = tokio::spawn(async move {
        let mut stream = server.accept().await.unwrap();
        match read_frame::<_, ClientFrame>(&mut stream).await.unwrap() {
            Some(ClientFrame::Ping) => {
                write_frame(&mut stream, &ServerFrame::Pong).await.unwrap();
            }
            other => panic!("expected Ping, got {:?}", other),
        }
    });

    let mut client = Client::connect_with_descriptor(&desc).await.unwrap();
    client.ping(Duration::from_secs(2)).await.unwrap();
    server_task.await.unwrap();
}

#[tokio::test]
async fn client_ping_times_out_when_server_silent() {
    use std::time::Duration;
    let dir = tempdir().unwrap();
    let desc = make_descriptor(&dir);

    let server = Server::bind_with_descriptor(&desc).await.unwrap();
    let server_task = tokio::spawn(async move {
        // Accept and then sit silent — never reply to the Ping.
        let mut stream = server.accept().await.unwrap();
        let _ = read_frame::<_, ClientFrame>(&mut stream).await;
        // Hold the stream so the connection stays open until the test
        // finishes; otherwise the client would observe an EOF instead of
        // the expected timeout.
        tokio::time::sleep(Duration::from_secs(1)).await;
    });

    let mut client = Client::connect_with_descriptor(&desc).await.unwrap();
    let err = client
        .ping(Duration::from_millis(150))
        .await
        .expect_err("expected timeout");
    assert!(matches!(err, IpcError::Timeout), "unexpected error: {:?}", err);
    server_task.await.unwrap();
}

fn make_descriptor(dir: &tempfile::TempDir) -> Descriptor {
    Descriptor {
        protocol: PROTOCOL_VERSION.to_string(),
        endpoint: temp_endpoint(dir),
        pid: std::process::id(),
        secret: fresh_secret(),
        started_at: "1970-01-01T00:00:00Z".into(),
    }
}

fn fresh_secret() -> String {
    use base64::Engine;
    use rand::RngCore;
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::STANDARD.encode(buf)
}
