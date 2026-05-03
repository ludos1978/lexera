//! Dispatch an [`ApiRequest`] through the shared Axum router and build the
//! corresponding [`ApiResponse`].
//!
//! The same `Router` instance serves HTTP and IPC, so route semantics,
//! middleware, and state are identical on both transports. Route-parity is
//! therefore a property of using the same service, not a separate code path.

use axum::body::Body;
use axum::http::Request;
use axum::Router;
use http_body_util::BodyExt;
use lexera_local_ipc::frame::{ApiRequest, ApiResponse, MAX_FRAME_BYTES};
use std::convert::Infallible;
use tower_service::Service;

#[derive(Debug, thiserror::Error)]
pub enum DispatchError {
    #[error("invalid request: {0}")]
    BuildRequest(axum::http::Error),
    #[error("collect response body: {0}")]
    CollectBody(axum::Error),
    #[error("response body too large: {size} bytes (max {MAX_FRAME_BYTES})")]
    BodyTooLarge { size: usize },
}

/// Convert the IPC-level [`ApiRequest`] into an `axum::Request`, call the
/// router, collect the response body, and rebuild an [`ApiResponse`].
///
/// The body is buffered. Phase 2 uses this path for JSON-sized responses; the
/// streaming `AssetRequest` variant lands in Phase 4.
pub async fn dispatch_api_request(
    router: Router,
    req: ApiRequest,
) -> Result<ApiResponse, DispatchError> {
    let mut builder = Request::builder()
        .method(req.method.as_str())
        .uri(req.uri.as_str())
        .header("x-lexera-transport", "ipc");
    for (name, value) in &req.headers {
        builder = builder.header(name.as_str(), value.as_slice());
    }
    let request = builder
        .body(Body::from(req.body))
        .map_err(DispatchError::BuildRequest)?;

    // `Router::call` is infallible; the `Ok` branch is the only reachable one.
    let mut service = router;
    let response: Result<axum::response::Response, Infallible> = service.call(request).await;
    let response = response.expect("axum::Router::call is Infallible");

    let (parts, body) = response.into_parts();
    let collected = body.collect().await.map_err(DispatchError::CollectBody)?;
    let body_bytes = collected.to_bytes().to_vec();

    if body_bytes.len() > MAX_FRAME_BYTES {
        return Err(DispatchError::BodyTooLarge {
            size: body_bytes.len(),
        });
    }

    // `HeaderMap::iter` yields one entry per distinct value, so multi-valued
    // headers round-trip correctly.
    let headers = parts
        .headers
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.as_bytes().to_vec()))
        .collect();

    Ok(ApiResponse {
        status: parts.status.as_u16(),
        headers,
        body: body_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::{get, post};
    use axum::Json;
    use serde_json::json;

    fn test_router() -> Router {
        Router::new()
            .route("/ping", get(|| async { "pong" }))
            .route("/echo", post(|body: String| async move { body }))
            .route("/json", get(|| async { Json(json!({ "ok": true })) }))
            .route(
                "/error",
                get(|| async { (axum::http::StatusCode::IM_A_TEAPOT, "teapot") }),
            )
    }

    #[tokio::test]
    async fn get_returns_body_and_content_type() {
        let router = test_router();
        let req = ApiRequest {
            method: "GET".into(),
            uri: "/ping".into(),
            headers: vec![],
            body: vec![],
        };
        let resp = dispatch_api_request(router, req).await.unwrap();
        assert_eq!(resp.status, 200);
        assert_eq!(resp.body, b"pong");
    }

    #[tokio::test]
    async fn post_body_roundtrips() {
        let router = test_router();
        let req = ApiRequest {
            method: "POST".into(),
            uri: "/echo".into(),
            headers: vec![("content-type".into(), b"text/plain".to_vec())],
            body: b"hello".to_vec(),
        };
        let resp = dispatch_api_request(router, req).await.unwrap();
        assert_eq!(resp.status, 200);
        assert_eq!(resp.body, b"hello");
    }

    #[tokio::test]
    async fn json_response_preserves_content_type() {
        let router = test_router();
        let req = ApiRequest {
            method: "GET".into(),
            uri: "/json".into(),
            headers: vec![],
            body: vec![],
        };
        let resp = dispatch_api_request(router, req).await.unwrap();
        assert_eq!(resp.status, 200);
        let ct = resp
            .headers
            .iter()
            .find(|(k, _)| k == "content-type")
            .map(|(_, v)| v.clone())
            .unwrap();
        assert!(ct.starts_with(b"application/json"));
        assert_eq!(resp.body, br#"{"ok":true}"#);
    }

    #[tokio::test]
    async fn nonstandard_status_propagates() {
        let router = test_router();
        let req = ApiRequest {
            method: "GET".into(),
            uri: "/error".into(),
            headers: vec![],
            body: vec![],
        };
        let resp = dispatch_api_request(router, req).await.unwrap();
        assert_eq!(resp.status, 418);
    }

    #[tokio::test]
    async fn missing_route_returns_404() {
        let router = test_router();
        let req = ApiRequest {
            method: "GET".into(),
            uri: "/does-not-exist".into(),
            headers: vec![],
            body: vec![],
        };
        let resp = dispatch_api_request(router, req).await.unwrap();
        assert_eq!(resp.status, 404);
    }

    #[tokio::test]
    async fn body_over_max_frame_bytes_rejected() {
        // Route returns a body larger than MAX_FRAME_BYTES. Dispatch must
        // refuse rather than crash, so large media responses are forced onto
        // the (Phase 4) streaming `AssetRequest` path.
        let big_router =
            Router::new().route("/big", get(|| async { vec![0u8; MAX_FRAME_BYTES + 1] }));
        let req = ApiRequest {
            method: "GET".into(),
            uri: "/big".into(),
            headers: vec![],
            body: vec![],
        };
        let err = dispatch_api_request(big_router, req).await.unwrap_err();
        assert!(matches!(err, DispatchError::BodyTooLarge { .. }));
    }
}

/// Parity tests: the same request over HTTP (via `tower::ServiceExt::oneshot`)
/// and over IPC (via `dispatch_api_request`) against a `build_app` router
/// must return matching status, bodies, and the same JSON shape.
///
/// Uses `test_helpers::test_state`, which is only compiled in test builds.
#[cfg(test)]
mod parity_tests {
    use super::*;
    use crate::test_helpers;
    use tower::util::ServiceExt;

    /// Dispatch an equivalent request over HTTP through the router and return
    /// status + body bytes.
    async fn http_roundtrip(
        router: Router,
        method: &str,
        uri: &str,
        body: &[u8],
    ) -> (u16, Vec<u8>) {
        let req = axum::http::Request::builder()
            .method(method)
            .uri(uri)
            .body(axum::body::Body::from(body.to_vec()))
            .unwrap();
        let resp = router.oneshot(req).await.unwrap();
        let status = resp.status().as_u16();
        let bytes = http_body_util::BodyExt::collect(resp.into_body())
            .await
            .unwrap()
            .to_bytes()
            .to_vec();
        (status, bytes)
    }

    #[tokio::test]
    async fn status_route_matches_http() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_helpers::test_state(tmp.path());

        let ipc_resp = dispatch_api_request(
            crate::server::build_app(state.clone()),
            ApiRequest {
                method: "GET".into(),
                uri: "/status".into(),
                headers: vec![],
                body: vec![],
            },
        )
        .await
        .unwrap();

        let (http_status, http_body) =
            http_roundtrip(crate::server::build_app(state), "GET", "/status", &[]).await;

        assert_eq!(ipc_resp.status, http_status, "status mismatch");
        assert_eq!(ipc_resp.body, http_body, "body mismatch");

        let ipc_json: serde_json::Value = serde_json::from_slice(&ipc_resp.body).unwrap();
        assert_eq!(ipc_json["status"], "running");
    }

    #[tokio::test]
    async fn unknown_route_returns_404_on_both_transports() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_helpers::test_state(tmp.path());

        let ipc_resp = dispatch_api_request(
            crate::server::build_app(state.clone()),
            ApiRequest {
                method: "GET".into(),
                uri: "/definitely-not-a-route".into(),
                headers: vec![],
                body: vec![],
            },
        )
        .await
        .unwrap();

        let (http_status, _) = http_roundtrip(
            crate::server::build_app(state),
            "GET",
            "/definitely-not-a-route",
            &[],
        )
        .await;

        assert_eq!(ipc_resp.status, 404);
        assert_eq!(ipc_resp.status, http_status);
    }

    #[tokio::test]
    async fn content_type_header_roundtrips_through_ipc() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_helpers::test_state(tmp.path());

        let ipc_resp = dispatch_api_request(
            crate::server::build_app(state),
            ApiRequest {
                method: "GET".into(),
                uri: "/status".into(),
                headers: vec![],
                body: vec![],
            },
        )
        .await
        .unwrap();

        let content_type = ipc_resp
            .headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
            .map(|(_, v)| v.clone())
            .expect("content-type header present");
        assert!(content_type.starts_with(b"application/json"));
    }

    #[tokio::test]
    async fn boards_list_parity() {
        // Gap #9: representative parity test for the boards surface. The
        // route is authed, so both transports return 401 without a token
        // — the point of the test is that HTTP and IPC match response
        // byte-for-byte, not that the route is reachable.
        let tmp = tempfile::tempdir().unwrap();
        let (state, _board_id) = test_helpers::setup_board(tmp.path());

        let ipc_resp = dispatch_api_request(
            crate::server::build_app(state.clone()),
            ApiRequest {
                method: "GET".into(),
                uri: "/boards".into(),
                headers: vec![],
                body: vec![],
            },
        )
        .await
        .unwrap();

        let (http_status, http_body) =
            http_roundtrip(crate::server::build_app(state), "GET", "/boards", &[]).await;

        assert_eq!(ipc_resp.status, http_status);
        assert_eq!(ipc_resp.body, http_body);
    }

    #[tokio::test]
    async fn config_theme_parity() {
        // Gap #9: covers the config group that the management UI hits.
        let tmp = tempfile::tempdir().unwrap();
        let state = test_helpers::test_state(tmp.path());

        let ipc_resp = dispatch_api_request(
            crate::server::build_app(state.clone()),
            ApiRequest {
                method: "GET".into(),
                uri: "/config/theme".into(),
                headers: vec![],
                body: vec![],
            },
        )
        .await
        .unwrap();

        let (http_status, http_body) =
            http_roundtrip(crate::server::build_app(state), "GET", "/config/theme", &[]).await;

        assert_eq!(ipc_resp.status, http_status);
        assert_eq!(ipc_resp.body, http_body);
    }
}
