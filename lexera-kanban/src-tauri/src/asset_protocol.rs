//! `lexera-asset://` custom URI scheme handler.
//!
//! URL shape: `lexera-asset://localhost/?b=<board_id>&p=<percent-encoded-path>`
//!
//! For every webview fetch (image, media, PDF, diagram preview), opens a
//! fresh IPC connection, sends an `AssetRequest`, accumulates the streamed
//! chunks, and hands the completed `http::Response<Vec<u8>>` back to the
//! Tauri responder. Parallel asset loads use parallel IPC connections;
//! this protocol does not demux on a single channel.

use lexera_local_ipc::frame::{
    read_frame, write_frame, AssetKind, AssetRequestPayload, ClientFrame, ServerFrame,
};
use lexera_local_ipc::Client;
use tauri::http::{Request, Response, StatusCode};
use uuid::Uuid;

/// URL scheme name. Must match both the Tauri builder registration and the
/// `backend_asset_url` command's output.
pub const SCHEME: &str = "lexera-asset";

/// URL-kind discriminator values used in the `k=` query param.
///
/// URL shape: `lexera-asset://localhost/?b=<id>&k=m|f&v=<value>` where
/// `v` is the filename (Media) or the file path (File). `b` and `v` are
/// percent-encoded so paths with `&`, `?`, `#`, or spaces round-trip.
///
/// The URL is built inline in `api.js` for synchronous callers (e.g.
/// `<img src=...>`); an explicit `backend_asset_url` command exists for
/// opacity-sensitive callers and tests.
pub const KIND_MEDIA: &str = "m";
pub const KIND_FILE: &str = "f";

/// URL-component encoder: RFC 3986 unreserved set passes through;
/// everything else becomes `%HH`. Mirror of the encoding in api.js'
/// `buildAssetUrl` so server-built URLs match frontend-built ones byte
/// for byte.
fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.as_bytes() {
        let unreserved = matches!(
            *b,
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~'
        );
        if unreserved {
            out.push(*b as char);
        } else {
            out.push('%');
            out.push_str(&format!("{:02X}", b));
        }
    }
    out
}

/// Public URL builder used by the `backend_asset_url` command. Returns an
/// opaque webview-loadable URL for `(board_id, kind, value)`.
pub fn build_url(board_id: &str, kind: &str, value: &str) -> Result<String, String> {
    if kind != KIND_MEDIA && kind != KIND_FILE {
        return Err(format!("unknown kind '{}'; expected 'm' or 'f'", kind));
    }
    if board_id.is_empty() || value.is_empty() {
        return Err("board_id and value must be non-empty".into());
    }
    Ok(format!(
        "{}://localhost/?b={}&k={}&v={}",
        SCHEME,
        urlencode(board_id),
        kind,
        urlencode(value)
    ))
}

/// Minimal URL-component decoder. Bytes after `%` are treated as hex pairs;
/// malformed escapes are passed through as-is.
fn urldecode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push(((h << 4) | l) as u8);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[derive(Debug)]
struct ParsedAssetUrl {
    board_id: String,
    kind: AssetKind,
}

fn parse_asset_url(uri: &str) -> Result<ParsedAssetUrl, String> {
    let query = uri
        .split_once('?')
        .map(|(_, q)| q)
        .ok_or("missing query string")?;
    let mut board_id: Option<String> = None;
    let mut kind_tag: Option<String> = None;
    let mut value: Option<String> = None;
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        match k {
            "b" => board_id = Some(urldecode(v)),
            "k" => kind_tag = Some(urldecode(v)),
            "v" => value = Some(urldecode(v)),
            _ => {}
        }
    }
    let board_id = board_id.ok_or("missing 'b' param")?;
    let kind_tag = kind_tag.ok_or("missing 'k' param")?;
    let value = value.ok_or("missing 'v' param")?;
    if board_id.is_empty() || value.is_empty() {
        return Err("empty board_id or value".into());
    }
    let kind = match kind_tag.as_str() {
        KIND_MEDIA => AssetKind::Media { filename: value },
        KIND_FILE => AssetKind::File { path: value },
        other => return Err(format!("unknown kind '{}'", other)),
    };
    Ok(ParsedAssetUrl { board_id, kind })
}

/// Top-level protocol handler. Converts the webview `Request` into an
/// `AssetRequest`, streams the IPC response into a buffer, and builds an
/// HTTP response with the correct status, headers, and body.
///
/// Accepts `Request<Vec<u8>>` but ignores the request body — asset fetches
/// are always GET.
pub async fn handle(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri_str = request.uri().to_string();
    let parsed = match parse_asset_url(&uri_str) {
        Ok(p) => p,
        Err(e) => return error_response(StatusCode::BAD_REQUEST, &e),
    };

    let range_header = request
        .headers()
        .get("range")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let if_none_match = request
        .headers()
        .get("if-none-match")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let log_hint = kind_log_hint(&parsed.kind);
    match fetch_asset(parsed.board_id, parsed.kind, range_header, if_none_match).await {
        Ok(resp) => resp,
        Err(e) => {
            log::warn!(target: "lexera.kanban.asset", "fetch failed for {}: {}", log_hint, e);
            error_response(StatusCode::BAD_GATEWAY, &e)
        }
    }
}

fn kind_log_hint(kind: &AssetKind) -> String {
    match kind {
        AssetKind::Media { filename } => format!("media:{}", filename),
        AssetKind::File { path } => format!("file:{}", path),
    }
}

async fn fetch_asset(
    board_id: String,
    kind: AssetKind,
    range: Option<String>,
    if_none_match: Option<String>,
) -> Result<Response<Vec<u8>>, String> {
    let mut client = Client::connect()
        .await
        .map_err(|e| format!("ipc connect: {}", e))?;
    let stream = client.stream();

    let correlation_id = Uuid::new_v4();
    let req = ClientFrame::AssetRequest {
        correlation_id,
        request: AssetRequestPayload {
            board_id,
            kind,
            range,
            if_none_match,
        },
    };
    write_frame(stream, &req)
        .await
        .map_err(|e| format!("ipc write: {}", e))?;

    // Head: exactly one AssetResponseHead, Error, or protocol error.
    let head = match read_frame::<_, ServerFrame>(stream)
        .await
        .map_err(|e| format!("ipc read: {}", e))?
    {
        Some(ServerFrame::AssetResponseHead {
            correlation_id: cid,
            head,
        }) if cid == correlation_id => head,
        Some(ServerFrame::Error {
            code, message, ..
        }) => {
            let status = match code.as_str() {
                "not_found" | "not_a_file" => StatusCode::NOT_FOUND,
                "forbidden" => StatusCode::FORBIDDEN,
                "range_unsatisfiable" => StatusCode::RANGE_NOT_SATISFIABLE,
                _ => StatusCode::BAD_GATEWAY,
            };
            log::warn!(
                target: "lexera.kanban.asset",
                "backend rejected asset request (status={} code={}): {}",
                status.as_u16(), code, message
            );
            return Ok(error_response(status, &message));
        }
        other => return Err(format!("unexpected head frame: {:?}", other)),
    };

    // Body: AssetChunk* then AssetEnd.
    let expected = head.content_length.unwrap_or(0) as usize;
    let mut body = Vec::with_capacity(expected.min(16 * 1024 * 1024));
    loop {
        let frame = read_frame::<_, ServerFrame>(stream)
            .await
            .map_err(|e| format!("ipc read: {}", e))?;
        match frame {
            Some(ServerFrame::AssetChunk {
                correlation_id: cid,
                bytes,
            }) if cid == correlation_id => {
                body.extend_from_slice(&bytes);
            }
            Some(ServerFrame::AssetEnd {
                correlation_id: cid,
                error,
            }) if cid == correlation_id => {
                if let Some(msg) = error {
                    return Err(format!("stream aborted: {}", msg));
                }
                break;
            }
            other => return Err(format!("unexpected body frame: {:?}", other)),
        }
    }

    build_response(head.status, head.headers, body)
}

fn build_response(
    status: u16,
    headers: Vec<(String, Vec<u8>)>,
    body: Vec<u8>,
) -> Result<Response<Vec<u8>>, String> {
    let mut builder = Response::builder().status(
        StatusCode::from_u16(status).map_err(|e| format!("invalid status: {}", e))?,
    );
    for (name, value) in &headers {
        builder = builder.header(name.as_str(), value.as_slice());
    }
    builder
        .body(body)
        .map_err(|e| format!("response build: {}", e))
}

fn error_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_url_roundtrip() {
        let p = parse_asset_url("lexera-asset://localhost/?b=board-1&k=m&v=photo.png").unwrap();
        assert_eq!(p.board_id, "board-1");
        assert!(matches!(p.kind, AssetKind::Media { filename } if filename == "photo.png"));
    }

    #[test]
    fn file_url_roundtrip() {
        let p = parse_asset_url("lexera-asset://localhost/?b=board-1&k=f&v=sub%2Fa.md").unwrap();
        assert_eq!(p.board_id, "board-1");
        assert!(matches!(p.kind, AssetKind::File { path } if path == "sub/a.md"));
    }

    #[test]
    fn url_roundtrip_with_special_chars() {
        let p =
            parse_asset_url("lexera-asset://localhost/?b=board%201&k=f&v=a%26b%3Fc%2Fd%20e.png")
                .unwrap();
        assert_eq!(p.board_id, "board 1");
        assert!(matches!(p.kind, AssetKind::File { path } if path == "a&b?c/d e.png"));
    }

    #[test]
    fn url_unicode_roundtrip() {
        let p = parse_asset_url(
            "lexera-asset://localhost/?b=b1&k=m&v=bild-%C3%BCberblick.jpg",
        )
        .unwrap();
        assert!(
            matches!(p.kind, AssetKind::Media { filename } if filename == "bild-überblick.jpg")
        );
    }

    #[test]
    fn url_missing_query_rejected() {
        assert!(parse_asset_url("lexera-asset://localhost/foo").is_err());
    }

    #[test]
    fn url_missing_params_rejected() {
        assert!(parse_asset_url("lexera-asset://localhost/?b=x&k=m").is_err());
        assert!(parse_asset_url("lexera-asset://localhost/?b=x&v=x").is_err());
        assert!(parse_asset_url("lexera-asset://localhost/?k=m&v=x").is_err());
    }

    #[test]
    fn url_unknown_kind_rejected() {
        assert!(parse_asset_url("lexera-asset://localhost/?b=x&k=z&v=y").is_err());
    }

    #[test]
    fn url_empty_values_rejected() {
        assert!(parse_asset_url("lexera-asset://localhost/?b=&k=m&v=x").is_err());
        assert!(parse_asset_url("lexera-asset://localhost/?b=x&k=m&v=").is_err());
    }
}
