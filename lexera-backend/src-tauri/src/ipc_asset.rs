//! Streaming asset handler for `AssetRequest` frames.
//!
//! Reuses the HTTP-side path validation (`api::resolve_board_file`) so
//! traversal and board-boundary checks are identical across transports.
//! Reads the file with a seek + bounded-chunk loop so multi-GB media does
//! not buffer in memory.

use crate::state::AppState;
use axum::http::StatusCode;
use lexera_core::media::content_type_for_ext;
use lexera_local_ipc::frame::{
    write_frame, AssetKind, AssetRequestPayload, AssetResponseHeadPayload, ServerFrame,
    ASSET_CHUNK_SIZE, ClientFrame,
};
use lexera_local_ipc::transport::Stream;
use lexera_local_ipc::IpcError;
use std::path::PathBuf;
use tokio::io::{AsyncReadExt, AsyncSeekExt, WriteHalf};
use tokio::sync::mpsc;
use uuid::Uuid;

/// Byte range resolved against a known file length.
#[derive(Debug, Clone, Copy)]
struct ByteRange {
    start: u64,
    /// Inclusive.
    end: u64,
}

impl ByteRange {
    fn len(&self) -> u64 {
        self.end - self.start + 1
    }
}

#[derive(Debug)]
enum RangeParse {
    /// No Range header — serve the whole file.
    Full,
    /// Valid Range — serve only this subrange.
    Partial(ByteRange),
    /// Syntactically or semantically invalid (e.g. end < start, range beyond
    /// file size); callers respond with 416 Range Not Satisfiable.
    Unsatisfiable,
}

/// Parse a `Range: bytes=...` value against a known file length.
fn parse_range(header_value: Option<&str>, file_len: u64) -> RangeParse {
    let Some(raw) = header_value else {
        return RangeParse::Full;
    };
    let raw = raw.trim();
    let Some(rest) = raw.strip_prefix("bytes=") else {
        return RangeParse::Unsatisfiable;
    };
    let rest = rest.trim();
    if rest.contains(',') {
        return RangeParse::Unsatisfiable;
    }
    if file_len == 0 {
        return RangeParse::Unsatisfiable;
    }
    let (start_str, end_str) = match rest.split_once('-') {
        Some(pair) => pair,
        None => return RangeParse::Unsatisfiable,
    };
    let (start, end) = if start_str.is_empty() {
        let Ok(suffix): Result<u64, _> = end_str.parse() else {
            return RangeParse::Unsatisfiable;
        };
        if suffix == 0 {
            return RangeParse::Unsatisfiable;
        }
        let start = file_len.saturating_sub(suffix);
        (start, file_len - 1)
    } else {
        let Ok(start): Result<u64, _> = start_str.parse() else {
            return RangeParse::Unsatisfiable;
        };
        let end = if end_str.is_empty() {
            file_len - 1
        } else {
            match end_str.parse::<u64>() {
                Ok(v) => v,
                Err(_) => return RangeParse::Unsatisfiable,
            }
        };
        (start, end)
    };
    if start > end || end >= file_len {
        return RangeParse::Unsatisfiable;
    }
    RangeParse::Partial(ByteRange { start, end })
}

/// Top-level entry point invoked by `ipc_server` for an `AssetRequest` frame.
pub async fn handle_asset_request(
    write_half: &mut WriteHalf<Stream>,
    control_rx: &mut mpsc::Receiver<ClientFrame>,
    state: &AppState,
    correlation_id: Uuid,
    req: AssetRequestPayload,
) -> Result<(), IpcError> {
    let relative_path = match resolve_relative_path(state, &req.board_id, &req.kind) {
        Ok(p) => p,
        Err(msg) => {
            return write_frame(
                write_half,
                &ServerFrame::Error {
                    correlation_id: Some(correlation_id),
                    code: "not_found".into(),
                    message: msg,
                },
            )
            .await;
        }
    };
    let resolved = match crate::api::resolve_board_file(state, &req.board_id, &relative_path) {
        Ok(p) => p,
        Err((status, _body)) => {
            let code = if status == StatusCode::FORBIDDEN {
                "forbidden"
            } else {
                "not_found"
            };
            return write_frame(
                write_half,
                &ServerFrame::Error {
                    correlation_id: Some(correlation_id),
                    code: code.into(),
                    message: format!("{} {}: {}", status.as_u16(), status.as_str(), relative_path),
                },
            )
            .await;
        }
    };
    stream_file(
        write_half,
        control_rx,
        &resolved,
        correlation_id,
        req.range.as_deref(),
        req.if_none_match.as_deref(),
    )
    .await
}

fn resolve_relative_path(
    state: &AppState,
    board_id: &str,
    kind: &AssetKind,
) -> Result<String, String> {
    match kind {
        AssetKind::Media { filename } => {
            let board_path = state
                .storage
                .get_board_path(board_id)
                .ok_or_else(|| format!("Board not found: {}", board_id))?;
            let stem = board_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("board");
            Ok(format!("{}-Media/{}", stem, filename))
        }
        AssetKind::File { path } => Ok(path.clone()),
    }
}

async fn stream_file(
    write_half: &mut WriteHalf<Stream>,
    control_rx: &mut mpsc::Receiver<ClientFrame>,
    path: &PathBuf,
    correlation_id: Uuid,
    range_header: Option<&str>,
    if_none_match: Option<&str>,
) -> Result<(), IpcError> {
    let meta = match tokio::fs::metadata(path).await {
        Ok(m) => m,
        Err(_) => {
            return write_frame(
                write_half,
                &ServerFrame::Error {
                    correlation_id: Some(correlation_id),
                    code: "not_found".into(),
                    message: format!("{}", path.display()),
                },
            )
            .await;
        }
    };
    if !meta.is_file() {
        return write_frame(
            write_half,
            &ServerFrame::Error {
                correlation_id: Some(correlation_id),
                code: "not_a_file".into(),
                message: format!("{}", path.display()),
            },
        )
        .await;
    }

    let etag = etag_for(&meta);

    if let Some(inm) = if_none_match {
        if inm == etag || inm == format!("W/{}", etag) || format!("W/{}", inm) == etag {
            write_frame(
                write_half,
                &ServerFrame::AssetResponseHead {
                    correlation_id,
                    head: AssetResponseHeadPayload {
                        status: 304,
                        headers: vec![("etag".into(), etag.into_bytes())],
                        content_length: Some(0),
                    },
                },
            )
            .await?;
            return write_frame(
                write_half,
                &ServerFrame::AssetEnd {
                    correlation_id,
                    error: None,
                },
            )
            .await;
        }
    }

    let total_len = meta.len();

    let (status, range) = match parse_range(range_header, total_len) {
        RangeParse::Full => (200u16, None),
        RangeParse::Partial(r) => (206u16, Some(r)),
        RangeParse::Unsatisfiable => {
            return write_frame(
                write_half,
                &ServerFrame::Error {
                    correlation_id: Some(correlation_id),
                    code: "range_unsatisfiable".into(),
                    message: format!(
                        "range {:?} not satisfiable for {} bytes",
                        range_header, total_len
                    ),
                },
            )
            .await;
        }
    };

    let content_length = range.map(|r| r.len()).unwrap_or(total_len);
    let content_type = content_type_for_ext(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase())
            .as_deref(),
    )
    .to_string();

    let mut headers: Vec<(String, Vec<u8>)> = vec![
        ("content-type".into(), content_type.into_bytes()),
        (
            "content-length".into(),
            content_length.to_string().into_bytes(),
        ),
        ("accept-ranges".into(), b"bytes".to_vec()),
        ("etag".into(), etag.into_bytes()),
        ("cache-control".into(), b"private, max-age=3600".to_vec()),
    ];
    if let Some(r) = range {
        headers.push((
            "content-range".into(),
            format!("bytes {}-{}/{}", r.start, r.end, total_len).into_bytes(),
        ));
    }

    write_frame(
        write_half,
        &ServerFrame::AssetResponseHead {
            correlation_id,
            head: AssetResponseHeadPayload {
                status,
                headers,
                content_length: Some(content_length),
            },
        },
    )
    .await?;

    let mut file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(e) => {
            return write_frame(
                write_half,
                &ServerFrame::AssetEnd {
                    correlation_id,
                    error: Some(format!("open failed: {}", e)),
                },
            )
            .await;
        }
    };
    if let Some(r) = range {
        if let Err(e) = file.seek(std::io::SeekFrom::Start(r.start)).await {
            return write_frame(
                write_half,
                &ServerFrame::AssetEnd {
                    correlation_id,
                    error: Some(format!("seek failed: {}", e)),
                },
            )
            .await;
        }
    }

    let mut remaining = content_length;
    let mut buf = vec![0u8; ASSET_CHUNK_SIZE];

    while remaining > 0 {
        let to_read = std::cmp::min(remaining, buf.len() as u64) as usize;

        tokio::select! {
            read_res = file.read(&mut buf[..to_read]) => {
                match read_res {
                    Ok(0) => {
                        let _ = write_frame(write_half, &ServerFrame::AssetEnd {
                            correlation_id,
                            error: Some("unexpected EOF mid-stream".into()),
                        }).await;
                        break;
                    }
                    Ok(n) => {
                        if let Err(e) = write_frame(write_half, &ServerFrame::AssetChunk {
                            correlation_id,
                            bytes: buf[..n].to_vec(),
                        }).await {
                            return Err(e);
                        }
                        remaining -= n as u64;
                    }
                    Err(e) => {
                        let _ = write_frame(write_half, &ServerFrame::AssetEnd {
                            correlation_id,
                            error: Some(format!("read failed: {}", e)),
                        }).await;
                        break;
                    }
                }
            }
            msg = control_rx.recv() => {
                match msg {
                    Some(ClientFrame::Cancel { correlation_id: cancel_id }) if cancel_id == correlation_id => {
                        log::info!(target: "lexera.ipc", "Asset stream {} canceled by client", correlation_id);
                        // Send AssetEnd with error: None to signal clean stop.
                        let _ = write_frame(write_half, &ServerFrame::AssetEnd {
                            correlation_id,
                            error: None,
                        }).await;
                        return Ok(());
                    }
                    Some(ClientFrame::Ping) => {
                        let _ = write_frame(write_half, &ServerFrame::Pong).await;
                    }
                    None => return Ok(()),
                    _ => {}
                }
            }
        }
    }

    if remaining == 0 {
        let _ = write_frame(
            write_half,
            &ServerFrame::AssetEnd {
                correlation_id,
                error: None,
            },
        )
        .await;
    }

    Ok(())
}

fn etag_for(meta: &std::fs::Metadata) -> String {
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("W/\"{:x}-{:x}\"", size, mtime)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_range_no_header_is_full() {
        assert!(matches!(parse_range(None, 1000), RangeParse::Full));
    }

    #[test]
    fn parse_range_valid_explicit() {
        match parse_range(Some("bytes=0-499"), 1000) {
            RangeParse::Partial(r) => {
                assert_eq!(r.start, 0);
                assert_eq!(r.end, 499);
                assert_eq!(r.len(), 500);
            }
            other => panic!("expected Partial, got {:?}", other),
        }
    }

    #[test]
    fn parse_range_valid_open_ended() {
        match parse_range(Some("bytes=500-"), 1000) {
            RangeParse::Partial(r) => {
                assert_eq!(r.start, 500);
                assert_eq!(r.end, 999);
            }
            other => panic!("expected Partial, got {:?}", other),
        }
    }

    #[test]
    fn parse_range_suffix_form() {
        match parse_range(Some("bytes=-100"), 1000) {
            RangeParse::Partial(r) => {
                assert_eq!(r.start, 900);
                assert_eq!(r.end, 999);
                assert_eq!(r.len(), 100);
            }
            other => panic!("expected Partial, got {:?}", other),
        }
    }

    #[test]
    fn parse_range_end_beyond_file_is_unsatisfiable() {
        assert!(matches!(
            parse_range(Some("bytes=0-9999"), 1000),
            RangeParse::Unsatisfiable
        ));
    }

    #[test]
    fn parse_range_reversed_is_unsatisfiable() {
        assert!(matches!(
            parse_range(Some("bytes=500-100"), 1000),
            RangeParse::Unsatisfiable
        ));
    }

    #[test]
    fn parse_range_multi_range_rejected() {
        assert!(matches!(
            parse_range(Some("bytes=0-99,200-299"), 1000),
            RangeParse::Unsatisfiable
        ));
    }

    #[test]
    fn parse_range_missing_prefix_rejected() {
        assert!(matches!(
            parse_range(Some("pages=0-99"), 1000),
            RangeParse::Unsatisfiable
        ));
    }

    #[test]
    fn parse_range_zero_length_file_any_range_unsatisfiable() {
        assert!(matches!(
            parse_range(Some("bytes=0-0"), 0),
            RangeParse::Unsatisfiable
        ));
    }
}

#[cfg(test)]
mod e2e {
    use super::*;
    use crate::test_helpers;
    use lexera_local_ipc::frame::{read_frame, write_frame, ClientFrame, ServerFrame};
    use lexera_local_ipc::{Client, Descriptor, Server};

    async fn drive_handler(
        server: Server,
        app_state: crate::state::AppState,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut stream = server.accept().await.expect("accept failed");
            let frame = read_frame::<_, ClientFrame>(&mut stream)
                .await
                .expect("read request")
                .expect("request frame");
            if let ClientFrame::AssetRequest {
                correlation_id,
                request,
            } = frame
            {
                let (mut read_half, mut write_half) = tokio::io::split(stream);
                let (tx, mut rx) = mpsc::channel(4);
                let _reader_task = tokio::spawn(async move {
                    while let Ok(Some(f)) = read_frame::<_, ClientFrame>(&mut read_half).await {
                        let _ = tx.send(f).await;
                    }
                });
                super::handle_asset_request(&mut write_half, &mut rx, &app_state, correlation_id, request)
                    .await
                    .expect("handler io error");
            } else {
                panic!("expected AssetRequest frame");
            }
        })
    }

    fn test_descriptor(dir: &tempfile::TempDir) -> Descriptor {
        Descriptor::new(dir.path().join("ipc.sock").to_string_lossy().into_owned())
    }

    async fn client_request(desc: &Descriptor, req: AssetRequestPayload) -> Vec<ServerFrame> {
        let mut client = Client::connect_with_descriptor(desc)
            .await
            .expect("client connect");
        let correlation_id = Uuid::new_v4();
        write_frame(
            client.stream(),
            &ClientFrame::AssetRequest {
                correlation_id,
                request: req,
            },
        )
        .await
        .unwrap();

        let mut out = Vec::new();
        loop {
            let frame = read_frame::<_, ServerFrame>(client.stream()).await.unwrap();
            match frame {
                Some(f) => {
                    let terminal =
                        matches!(f, ServerFrame::Error { .. } | ServerFrame::AssetEnd { .. });
                    out.push(f);
                    if terminal {
                        break;
                    }
                }
                None => break,
            }
        }
        out
    }

    fn write_media_fixture(
        board_path: &std::path::Path,
        filename: &str,
        bytes: &[u8],
    ) -> std::path::PathBuf {
        let stem = board_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("board");
        let media_dir = board_path.parent().unwrap().join(format!("{}-Media", stem));
        std::fs::create_dir_all(&media_dir).unwrap();
        let full = media_dir.join(filename);
        std::fs::write(&full, bytes).unwrap();
        full
    }

    #[tokio::test]
    async fn full_media_read_returns_bytes_and_mime() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = test_helpers::setup_board(tmp.path());
        let board_path = state.storage.get_board_path(&board_id).unwrap();
        let content = b"PNG-ish-body-bytes-0123456789".repeat(100);
        write_media_fixture(&board_path, "photo.png", &content);

        let desc = test_descriptor(&tmp);
        let server = Server::bind_with_descriptor(&desc).await.unwrap();
        let handle = drive_handler(server, state).await;

        let frames = client_request(
            &desc,
            AssetRequestPayload {
                board_id,
                kind: AssetKind::Media {
                    filename: "photo.png".into(),
                },
                range: None,
                if_none_match: None,
            },
        )
        .await;

        let head = match &frames[0] {
            ServerFrame::AssetResponseHead { head, .. } => head.clone(),
            other => panic!("expected head, got {:?}", other),
        };
        assert_eq!(head.status, 200);
        let mut got = Vec::new();
        for f in &frames[1..] {
            match f {
                ServerFrame::AssetChunk { bytes, .. } => got.extend_from_slice(bytes),
                ServerFrame::AssetEnd { error: None, .. } => {}
                other => panic!("unexpected frame: {:?}", other),
            }
        }
        assert_eq!(got, content);
        handle.await.unwrap();
    }

    #[tokio::test]
    async fn etag_304_short_circuit() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = test_helpers::setup_board(tmp.path());
        let board_path = state.storage.get_board_path(&board_id).unwrap();
        write_media_fixture(&board_path, "cacheable.png", b"some-content");

        let desc = test_descriptor(&tmp);
        let server = Server::bind_with_descriptor(&desc).await.unwrap();
        let handle = drive_handler(server, state.clone()).await;

        let frames = client_request(
            &desc,
            AssetRequestPayload {
                board_id: board_id.clone(),
                kind: AssetKind::Media {
                    filename: "cacheable.png".into(),
                },
                range: None,
                if_none_match: None,
            },
        )
        .await;
        let etag = match &frames[0] {
            ServerFrame::AssetResponseHead { head, .. } => {
                let (_, v) = head.headers.iter().find(|(k, _)| k == "etag").unwrap();
                String::from_utf8(v.clone()).unwrap()
            }
            _ => panic!("expected head"),
        };
        handle.await.unwrap();

        let server = Server::bind_with_descriptor(&desc).await.unwrap();
        let handle = drive_handler(server, state).await;
        let frames = client_request(
            &desc,
            AssetRequestPayload {
                board_id,
                kind: AssetKind::Media {
                    filename: "cacheable.png".into(),
                },
                range: None,
                if_none_match: Some(etag),
            },
        )
        .await;

        assert_eq!(frames.len(), 2);
        match &frames[0] {
            ServerFrame::AssetResponseHead { head, .. } => {
                assert_eq!(head.status, 304);
            }
            _ => panic!("expected 304 head"),
        }
        handle.await.unwrap();
    }

    #[tokio::test]
    async fn request_cancellation_stops_stream() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = test_helpers::setup_board(tmp.path());
        let board_path = state.storage.get_board_path(&board_id).unwrap();
        let content = vec![0u8; 1024 * 1024];
        write_media_fixture(&board_path, "large.bin", &content);

        let desc = test_descriptor(&tmp);
        let server = Server::bind_with_descriptor(&desc).await.unwrap();
        let handle = drive_handler(server, state).await;

        let mut client = Client::connect_with_descriptor(&desc).await.unwrap();
        let correlation_id = Uuid::new_v4();
        write_frame(
            client.stream(),
            &ClientFrame::AssetRequest {
                correlation_id,
                request: AssetRequestPayload {
                    board_id,
                    kind: AssetKind::Media {
                        filename: "large.bin".into(),
                    },
                    range: None,
                    if_none_match: None,
                },
            },
        )
        .await
        .unwrap();

        let _head = read_frame::<_, ServerFrame>(client.stream()).await.unwrap().unwrap();
        let _chunk = read_frame::<_, ServerFrame>(client.stream()).await.unwrap().unwrap();

        write_frame(client.stream(), &ClientFrame::Cancel { correlation_id }).await.unwrap();

        loop {
            match read_frame::<_, ServerFrame>(client.stream()).await {
                Ok(Some(ServerFrame::AssetEnd { .. })) => break,
                Ok(Some(ServerFrame::Error { .. })) => break,
                Ok(Some(_)) => continue,
                Ok(None) => break,
                Err(_) => break,
            }
        }
        handle.await.unwrap();
    }
}
