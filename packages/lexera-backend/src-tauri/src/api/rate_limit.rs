//! Simple sliding-window rate limiter as an Axum middleware.
//!
//! Tracks request timestamps in a shared `VecDeque` behind `Arc<Mutex<_>>`.
//! When the number of requests in the last 1 second exceeds the configured
//! maximum, responds with 429 Too Many Requests.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};

const WINDOW: Duration = Duration::from_secs(1);

/// Shared state for one rate-limit bucket.
#[derive(Clone)]
pub struct RateLimiter {
    timestamps: Arc<Mutex<VecDeque<Instant>>>,
    max_per_window: usize,
}

impl RateLimiter {
    /// Create a rate limiter allowing `max_per_second` requests per second.
    pub fn new(max_per_second: usize) -> Self {
        Self {
            timestamps: Arc::new(Mutex::new(VecDeque::new())),
            max_per_window: max_per_second,
        }
    }

    /// Check if a request is allowed. Returns true and records the timestamp
    /// if under the limit, false otherwise.
    fn check(&self) -> bool {
        let now = Instant::now();
        let mut timestamps = self.timestamps.lock().unwrap_or_else(|e| e.into_inner());
        let cutoff = now - WINDOW;
        while timestamps.front().is_some_and(|&t| t < cutoff) {
            timestamps.pop_front();
        }
        if timestamps.len() < self.max_per_window {
            timestamps.push_back(now);
            true
        } else {
            false
        }
    }
}

/// Axum middleware function that enforces rate limiting.
pub async fn rate_limit_middleware(
    axum::extract::State(limiter): axum::extract::State<RateLimiter>,
    req: Request,
    next: Next,
) -> Response {
    if limiter.check() {
        next.run(req).await
    } else {
        log::warn!(
            target: "lexera.api.rate_limit",
            "Rate limit exceeded (max {}/s)",
            limiter.max_per_window
        );
        (
            StatusCode::TOO_MANY_REQUESTS,
            [("retry-after", "1")],
            "Too many requests",
        )
            .into_response()
    }
}
