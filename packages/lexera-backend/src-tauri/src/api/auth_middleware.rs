//! Bearer token authentication middleware for the board/API routes.
//!
//! Validates the `Authorization: Bearer <token>` header against the AuthService.
//! Returns 401 Unauthorized if no valid credentials are found.

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::state::AppState;

/// Extract bearer token from Authorization header.
fn extract_bearer_token(req: &Request) -> Option<String> {
    let value = req.headers().get("authorization")?.to_str().ok()?;
    let token = value.strip_prefix("Bearer ")?;
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

/// Axum middleware that requires a valid bearer token.
/// Uses `State<AppState>` — must be applied via `from_fn_with_state(state, ...)`.
pub async fn require_auth_middleware(
    axum::extract::State(state): axum::extract::State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    // Try bearer token first
    if let Some(token) = extract_bearer_token(&req) {
        let valid = state
            .auth_service
            .lock()
            .ok()
            .and_then(|auth| auth.validate_token(&token).map(|_| ()))
            .is_some();
        if valid {
            return next.run(req).await;
        }
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(super::ErrorResponse {
                error: "Invalid token".to_string(),
            }),
        )
            .into_response();
    }

    (
        StatusCode::UNAUTHORIZED,
        axum::Json(super::ErrorResponse {
            error: "Unauthorized".to_string(),
        }),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::Request as HttpRequest;

    #[test]
    fn extract_bearer_token_valid() {
        let req = HttpRequest::builder()
            .header("authorization", "Bearer abc-123")
            .body(Body::empty())
            .unwrap();
        assert_eq!(super::extract_bearer_token(&req), Some("abc-123".into()));
    }

    #[test]
    fn extract_bearer_token_missing() {
        let req = HttpRequest::builder().body(Body::empty()).unwrap();
        assert_eq!(super::extract_bearer_token(&req), None);
    }

    #[test]
    fn extract_bearer_token_empty() {
        let req = HttpRequest::builder()
            .header("authorization", "Bearer ")
            .body(Body::empty())
            .unwrap();
        assert_eq!(super::extract_bearer_token(&req), None);
    }

    #[test]
    fn extract_bearer_token_wrong_scheme() {
        let req = HttpRequest::builder()
            .header("authorization", "Basic abc-123")
            .body(Body::empty())
            .unwrap();
        assert_eq!(super::extract_bearer_token(&req), None);
    }

}
