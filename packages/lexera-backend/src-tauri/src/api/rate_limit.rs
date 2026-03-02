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

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn allows_requests_within_limit() {
        let limiter = RateLimiter::new(3);
        assert!(limiter.check(), "1st request should be allowed");
        assert!(limiter.check(), "2nd request should be allowed");
        assert!(limiter.check(), "3rd request should be allowed");
    }

    #[test]
    fn blocks_request_exceeding_limit() {
        let limiter = RateLimiter::new(2);
        assert!(limiter.check(), "1st request should be allowed");
        assert!(limiter.check(), "2nd request should be allowed");
        assert!(
            !limiter.check(),
            "3rd request should be blocked (limit is 2)"
        );
        assert!(!limiter.check(), "4th request should also be blocked");
    }

    #[test]
    fn window_purges_old_entries_and_allows_again() {
        let limiter = RateLimiter::new(1);
        assert!(limiter.check(), "1st request should be allowed");
        assert!(
            !limiter.check(),
            "2nd request should be blocked immediately"
        );

        // Wait for the window to expire (1 second + small buffer)
        thread::sleep(Duration::from_millis(1100));

        assert!(
            limiter.check(),
            "After window expires, request should be allowed again"
        );
    }

    #[test]
    fn independent_limiters_do_not_interfere() {
        let limiter_a = RateLimiter::new(1);
        let limiter_b = RateLimiter::new(1);

        assert!(limiter_a.check(), "limiter_a 1st request should be allowed");
        assert!(
            !limiter_a.check(),
            "limiter_a 2nd request should be blocked"
        );

        // limiter_b should be unaffected by limiter_a being exhausted
        assert!(
            limiter_b.check(),
            "limiter_b 1st request should be allowed (independent)"
        );
    }

    #[test]
    fn cloned_limiter_shares_state() {
        let limiter = RateLimiter::new(2);
        let clone = limiter.clone();

        assert!(limiter.check(), "original 1st request allowed");
        assert!(clone.check(), "clone 2nd request allowed (shared state)");
        assert!(
            !limiter.check(),
            "original 3rd request blocked (shared limit of 2)"
        );
        assert!(
            !clone.check(),
            "clone 4th request also blocked (shared limit of 2)"
        );
    }

    #[test]
    fn rapid_sequential_calls_respect_limit() {
        let limiter = RateLimiter::new(5);
        let mut allowed = 0;
        let mut blocked = 0;

        for _ in 0..10 {
            if limiter.check() {
                allowed += 1;
            } else {
                blocked += 1;
            }
        }

        assert_eq!(
            allowed, 5,
            "exactly max_per_window requests should be allowed"
        );
        assert_eq!(blocked, 5, "remaining requests should be blocked");
    }

    #[test]
    fn limit_of_zero_blocks_everything() {
        let limiter = RateLimiter::new(0);
        assert!(
            !limiter.check(),
            "with max_per_window=0, every request should be blocked"
        );
    }
}
