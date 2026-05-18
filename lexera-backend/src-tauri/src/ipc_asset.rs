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
    write_frame, AssetKind, AssetRequestPayload, AssetResponseHeadPayload, ClientFrame,
    ServerFrame, ASSET_CHUNK_SIZE,
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
    /// Valid Range(s) — serve only these subranges.
    Partial(Vec<ByteRange>),
    /// Syntactically or semantically invalid (e.g. end < start, range beyond
    /// file size); callers respond with 416 Range Not Satisfiable.
    Unsatisfiable,
}

/// Parse a `Range: bytes=...` value against a known file length.
///
/// Supports:
/// - `bytes=<start>-<end>` — explicit range
/// - `bytes=<start>-` — open-ended (to end of file)
/// - `bytes=-<suffix>` — last N bytes
/// - `bytes=r1,r2,r3` — multiple comma-separated ranges
fn parse_range(header_value: Option<&str>, file_len: u64) -> RangeParse {
    let Some(raw) = header_value else {
        return RangeParse::Full;
    };
    let raw = raw.trim();
    let Some(rest) = raw.strip_prefix("bytes=") else {
        return RangeParse::Unsatisfiable;
    };
    if file_len == 0 {
        return RangeParse::Unsatisfiable;
    }

    let mut ranges = Vec::new();
    for part in rest.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (start_str, end_str) = match part.split_once('-') {
            Some(pair) => pair,
            None => return RangeParse::Unsatisfiable,
        };
        let (start, end) = if start_str.is_empty() {
            // Suffix form: last N bytes.
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
        ranges.push(ByteRange { start, end });
    }

    if ranges.is_empty() {
        RangeParse::Unsatisfiable
    } else {
        RangeParse::Partial(ranges)
    }
}

/// Top-level entry point invoked by `ipc_server` for an `AssetRequest` frame.
/// Writes the head + chunks + end frames to `stream`. Returns an `Err` only
/// if the underlying IPC write fails; logical errors (not found, forbidden,
/// 416) are surfaced as `ServerFrame::Error` frames.
pub async fn handle_asset_request(
    write_half: &mut WriteHalf<Stream>,
    control_rx: &mut mpsc::Receiver<ClientFrame>,
    state: &AppState,
    correlation_id: Uuid,
    req: AssetRequestPayload,
) -> Result<(), IpcError> {
    let relative_path = match resolve_relative_path(state, &req.board_id, &req.kind) {
        Ok(p) => p,
        Err(err) => {
            return write_frame(
                write_half,
                &ServerFrame::Error {
                    correlation_id: Some(correlation_id),
                    code: "not_found".into(),
                    message: err.to_string(),
                },
            )
            .await;
        }
    };
    // `resolve_board_file` does the authoritative traversal/board-boundary
    // check. Errors are surfaced as `forbidden` / `not_found` ServerFrames.
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

/// Typed error for `resolve_relative_path`. Display impl preserves the
/// prior `format!("Board not found: {}", board_id)` wire shape so the
/// client-facing `ServerFrame::Error.message` reads identical text.
#[derive(Debug, thiserror::Error)]
pub(super) enum ResolveRelativePathError {
    #[error("Board not found: {0}")]
    BoardNotFound(String),
}

/// Translate an [`AssetKind`] into the path string accepted by
/// `resolve_board_file`. `Media` looks up the board's filename stem and
/// prefixes it; `File` passes the path through unchanged.
fn resolve_relative_path(
    state: &AppState,
    board_id: &str,
    kind: &AssetKind,
) -> Result<String, ResolveRelativePathError> {
    match kind {
        AssetKind::Media { filename } => {
            let board_path = state
                .storage
                .get_board_path(board_id)
                .ok_or_else(|| ResolveRelativePathError::BoardNotFound(board_id.to_string()))?;
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

    // Build a stable, mtime-based ETag so the webview can cache across reloads.
    let etag = etag_for(&meta);

    // Phase 7.5 gap #2: ETag-based 304 short-circuiting.
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

    let (status, ranges) = match parse_range(range_header, total_len) {
        RangeParse::Full => (200u16, None),
        RangeParse::Partial(rs) => (206u16, Some(rs)),
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

    let content_type = content_type_for_ext(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase())
            .as_deref(),
    )
    .to_string();

    let mut headers: Vec<(String, Vec<u8>)> = vec![
        ("accept-ranges".into(), b"bytes".to_vec()),
        ("etag".into(), etag.into_bytes()),
        ("cache-control".into(), b"private, max-age=3600".to_vec()),
    ];

    let mut boundary = None;
    let mut actual_content_length = None;

    match ranges.as_deref() {
        None => {
            headers.push(("content-type".into(), content_type.clone().into_bytes()));
            headers.push(("content-length".into(), total_len.to_string().into_bytes()));
            actual_content_length = Some(total_len);
        }
        Some([r]) => {
            headers.push(("content-type".into(), content_type.clone().into_bytes()));
            headers.push(("content-length".into(), r.len().to_string().into_bytes()));
            headers.push((
                "content-range".into(),
                format!("bytes {}-{}/{}", r.start, r.end, total_len).into_bytes(),
            ));
            actual_content_length = Some(r.len());
        }
        Some(_) => {
            let b = Uuid::new_v4().simple().to_string();
            headers.push((
                "content-type".into(),
                format!("multipart/byteranges; boundary={}", b).into_bytes(),
            ));
            // For multiple ranges, the content length is the sum of parts + boundaries.
            // We omit it from the head and let the stream finish naturally.
            boundary = Some(b);
        }
    }

    write_frame(
        write_half,
        &ServerFrame::AssetResponseHead {
            correlation_id,
            head: AssetResponseHeadPayload {
                status,
                headers,
                content_length: actual_content_length,
            },
        },
    )
    .await?;

    // Stream the file in bounded chunks.
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

    let rs = ranges.unwrap_or_else(|| {
        vec![ByteRange {
            start: 0,
            end: total_len - 1,
        }]
    });

    for (i, r) in rs.iter().enumerate() {
        if let Some(ref b) = boundary {
            let part_header = format!(
                "\r\n--{}\r\ncontent-type: {}\r\ncontent-range: bytes {}-{}/{}\r\n\r\n",
                b, content_type, r.start, r.end, total_len
            );
            write_frame(
                write_half,
                &ServerFrame::AssetChunk {
                    correlation_id,
                    bytes: part_header.into_bytes(),
                },
            )
            .await?;
        }

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

        let mut remaining = r.len();
        let mut buf = vec![0u8; ASSET_CHUNK_SIZE];
        while remaining > 0 {
            let to_read = std::cmp::min(remaining, buf.len() as u64) as usize;

            // Phase 7.5 gap #8: multiplex between file I/O and ClientFrame::Cancel.
            tokio::select! {
                // Read next chunk from file
                read_res = file.read(&mut buf[..to_read]) => {
                    match read_res {
                        Ok(0) => {
                            let _ = write_frame(write_half, &ServerFrame::AssetEnd {
                                correlation_id,
                                error: Some("unexpected EOF mid-stream".into()),
                            }).await;
                            return Ok(());
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
                            return Ok(());
                        }
                    }
                }
                // Check for cancellation or pings from client via channel
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
                        None => return Ok(()), // Connection closed
                        _ => {} // Ignore other frames during asset push
                    }
                }
            }
        }

        if i == rs.len() - 1 {
            if let Some(ref b) = boundary {
                let final_boundary = format!("\r\n--{}--\r\n", b);
                write_frame(
                    write_half,
                    &ServerFrame::AssetChunk {
                        correlation_id,
                        bytes: final_boundary.into_bytes(),
                    },
                )
                .await?;
            }
        }
    }

    write_frame(
        write_half,
        &ServerFrame::AssetEnd {
            correlation_id,
            error: None,
        },
    )
    .await?;

    Ok(())
}

fn etag_for(meta: &std::fs::Metadata) -> String {
    // Weak ETag built from size + mtime. Avoids hashing every byte on each
    // request; mtime changes when the file changes, and size guards against
    // unlucky mtime collisions.
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
    fn resolve_relative_path_error_display_preserves_string_format() {
        // ServerFrame::Error.message used to receive `format!("Board not found: {}", board_id)`
        // directly. The typed-error Display must produce the EXACT same string so any
        // client UI that pattern-matches on the wire message keeps working.
        let err = ResolveRelativePathError::BoardNotFound("board-abc-123".into());
        assert_eq!(err.to_string(), "Board not found: board-abc-123");
    }

    #[test]
    fn parse_range_no_header_is_full() {
        assert!(matches!(parse_range(None, 1000), RangeParse::Full));
    }

    #[test]
    fn parse_range_valid_explicit() {
        match parse_range(Some("bytes=0-499"), 1000) {
            RangeParse::Partial(rs) => {
                assert_eq!(rs.len(), 1);
                assert_eq!(rs[0].start, 0);
                assert_eq!(rs[0].end, 499);
                assert_eq!(rs[0].len(), 500);
            }
            other => panic!("expected Partial, got {:?}", other),
        }
    }

    #[test]
    fn parse_range_multiple_ranges() {
        match parse_range(Some("bytes=0-499, 600-999"), 1000) {
            RangeParse::Partial(rs) => {
                assert_eq!(rs.len(), 2);
                assert_eq!(rs[0].start, 0);
                assert_eq!(rs[0].end, 499);
                assert_eq!(rs[1].start, 600);
                assert_eq!(rs[1].end, 999);
            }
            other => panic!("expected Partial(2), got {:?}", other),
        }
    }

    #[test]
    fn parse_range_valid_open_ended() {
        match parse_range(Some("bytes=500-"), 1000) {
            RangeParse::Partial(rs) => {
                assert_eq!(rs[0].start, 500);
                assert_eq!(rs[0].end, 999);
            }
            other => panic!("expected Partial, got {:?}", other),
        }
    }

    #[test]
    fn parse_range_suffix_form() {
        match parse_range(Some("bytes=-100"), 1000) {
            RangeParse::Partial(rs) => {
                assert_eq!(rs[0].start, 900);
                assert_eq!(rs[0].end, 999);
                assert_eq!(rs[0].len(), 100);
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
    fn parse_range_zero_length_file_any_range_unsatisfiable() {
        assert!(matches!(
            parse_range(Some("bytes=0-0"), 0),
            RangeParse::Unsatisfiable
        ));
    }
}

/// End-to-end asset tests. Spins up a real UDS listener using the
/// `lexera-local-ipc` server/client helpers, writes a media file on disk,
/// and exercises the full `AssetRequest` → `AssetResponseHead` → `AssetChunk`
/// → `AssetEnd` pipeline.
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
            // One request per connection for these tests.
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
                super::handle_asset_request(
                    &mut write_half,
                    &mut rx,
                    &app_state,
                    correlation_id,
                    request,
                )
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

        // Read frames until we see AssetEnd or an Error.
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

    /// Write a fixture media file under the board's `<stem>-Media/` directory.
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
        let content = b"PNG-ish-body-bytes-0123456789".repeat(100); // 2900 bytes
        write_media_fixture(&board_path, "photo.png", &content);

        let desc = test_descriptor(&tmp);
        let server = Server::bind_with_descriptor(&desc).await.unwrap();
        let _handle = drive_handler(server, state).await;

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

        // First frame: head with 200 + content-type
        let head = match &frames[0] {
            ServerFrame::AssetResponseHead { head, .. } => head.clone(),
            other => panic!("expected head, got {:?}", other),
        };
        assert_eq!(head.status, 200);
        let ct = head
            .headers
            .iter()
            .find(|(k, _)| k == "content-type")
            .expect("content-type present");
        assert_eq!(ct.1, b"image/png");
        assert_eq!(head.content_length, Some(content.len() as u64));

        // Middle frames: concatenated chunks match the file bytes; end is clean.
        let mut got = Vec::new();
        for f in &frames[1..] {
            match f {
                ServerFrame::AssetChunk { bytes, .. } => got.extend_from_slice(bytes),
                ServerFrame::AssetEnd { error: None, .. } => {}
                other => panic!("unexpected frame: {:?}", other),
            }
        }
        assert_eq!(got, content);
    }

    #[tokio::test]
    async fn etag_304_short_circuit() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = test_helpers::setup_board(tmp.path());
        let board_path = state.storage.get_board_path(&board_id).unwrap();
        write_media_fixture(&board_path, "cacheable.png", b"some-content");

        let desc = test_descriptor(&tmp);
        let server = Server::bind_with_descriptor(&desc).await.unwrap();
        let _handle = drive_handler(server, state.clone()).await;

        // 1. Get the ETag first
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

        // 2. Request with If-None-Match
        let server = Server::bind_with_descriptor(&desc).await.unwrap();
        let _handle = drive_handler(server, state).await;
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
        assert!(matches!(frames[1], ServerFrame::AssetEnd { .. }));
    }

    #[tokio::test]
    async fn request_cancellation_stops_stream() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = test_helpers::setup_board(tmp.path());
        let board_path = state.storage.get_board_path(&board_id).unwrap();
        // Large file to ensure we can cancel mid-stream
        let content = vec![0u8; 1024 * 1024]; // 1MB
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

        // Read the head
        let head = read_frame::<_, ServerFrame>(client.stream())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(head, ServerFrame::AssetResponseHead { .. }));

        // Read one chunk
        let chunk = read_frame::<_, ServerFrame>(client.stream())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(chunk, ServerFrame::AssetChunk { .. }));

        // Send Cancel
        write_frame(client.stream(), &ClientFrame::Cancel { correlation_id })
            .await
            .unwrap();

        // Drain until close
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

    #[tokio::test]
    async fn multi_range_request_returns_206_multipart() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = test_helpers::setup_board(tmp.path());
        let board_path = state.storage.get_board_path(&board_id).unwrap();
        let content: Vec<u8> = (0u8..=255u8).cycle().take(1000).collect();
        write_media_fixture(&board_path, "multi.bin", &content);

        let desc = test_descriptor(&tmp);
        let server = Server::bind_with_descriptor(&desc).await.unwrap();
        let _server_handle = drive_handler(server, state).await;

        let frames = client_request(
            &desc,
            AssetRequestPayload {
                board_id,
                kind: AssetKind::Media {
                    filename: "multi.bin".into(),
                },
                range: Some("bytes=0-49, 900-949".into()),
                if_none_match: None,
            },
        )
        .await;

        let head = match &frames[0] {
            ServerFrame::AssetResponseHead { head, .. } => head.clone(),
            other => panic!("expected head, got {:?}", other),
        };
        assert_eq!(head.status, 206);
        let ct = head
            .headers
            .iter()
            .find(|(k, _)| k == "content-type")
            .unwrap();
        assert!(String::from_utf8_lossy(&ct.1).contains("multipart/byteranges"));

        let mut got_body = Vec::new();
        for f in &frames[1..] {
            if let ServerFrame::AssetChunk { bytes, .. } = f {
                got_body.extend_from_slice(bytes);
            }
        }
        let body_str = String::from_utf8_lossy(&got_body);
        assert!(body_str.contains("content-range: bytes 0-49/1000"));
        assert!(body_str.contains("content-range: bytes 900-949/1000"));
    }

    #[tokio::test]
    async fn range_beyond_eof_yields_range_unsatisfiable_error() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = test_helpers::setup_board(tmp.path());
        let board_path = state.storage.get_board_path(&board_id).unwrap();
        write_media_fixture(&board_path, "small.bin", &[0u8; 100]);

        let desc = test_descriptor(&tmp);
        let server = Server::bind_with_descriptor(&desc).await.unwrap();
        let _handle = drive_handler(server, state).await;

        let frames = client_request(
            &desc,
            AssetRequestPayload {
                board_id,
                kind: AssetKind::Media {
                    filename: "small.bin".into(),
                },
                range: Some("bytes=0-9999".into()),
                if_none_match: None,
            },
        )
        .await;
        assert_eq!(frames.len(), 1);
        match &frames[0] {
            ServerFrame::Error { code, .. } => {
                assert_eq!(code, "range_unsatisfiable");
            }
            other => panic!("expected range_unsatisfiable, got {:?}", other),
        }
    }
}
