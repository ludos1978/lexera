use axum::{extract::Query, http::StatusCode, response::Json};
use reqwest::header::HeaderMap;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::{err_bad_request, err_internal, ErrorResponse};

const EXTERNAL_EMBED_CACHE_FILENAME: &str = "external-embed-cache.json";
const EXTERNAL_EMBED_CACHE_TTL_SECS: u64 = 24 * 60 * 60;
const PROBE_TIMEOUT_SECS: u64 = 10;
const MAX_URL_LENGTH: usize = 4096;

static EXTERNAL_EMBED_CACHE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static EXTERNAL_EMBED_HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
        .user_agent("Lexera External Embed Probe/1.0")
        .build()
        .expect("external embed probe HTTP client")
});

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeExternalEmbedQuery {
    pub url: String,
    #[serde(default, alias = "parentOrigin")]
    pub parent_origin: Option<String>,
    #[serde(default, alias = "forceRefresh")]
    pub force_refresh: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExternalEmbedCacheEntry {
    url: String,
    parent_origin: Option<String>,
    final_url: Option<String>,
    embeddable: bool,
    action: String,
    reason: String,
    checked_at: u64,
    status_code: Option<u16>,
    x_frame_options: Option<String>,
    frame_ancestors: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ExternalEmbedCacheFile {
    #[serde(default)]
    entries: HashMap<String, ExternalEmbedCacheEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeExternalEmbedResponse {
    url: String,
    parent_origin: Option<String>,
    final_url: Option<String>,
    embeddable: bool,
    action: String,
    reason: String,
    checked_at: u64,
    from_cache: bool,
    status_code: Option<u16>,
    x_frame_options: Option<String>,
    frame_ancestors: Option<String>,
}

#[derive(Debug)]
struct ProbeResult {
    final_url: Option<String>,
    embeddable: bool,
    reason: String,
    status_code: Option<u16>,
    x_frame_options: Option<String>,
    frame_ancestors: Option<String>,
}

/// GET /external-embeds/probe?url=...&parentOrigin=... -- inspect remote page headers and
/// decide whether it is safe to offer an in-app iframe open action.
pub async fn probe_external_embed(
    Query(query): Query<ProbeExternalEmbedQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let normalized_url = normalize_external_embed_url(&query.url)?;
    let parent_origin = normalize_parent_origin(query.parent_origin.as_deref());
    let cache_key = external_embed_cache_key(&normalized_url, parent_origin.as_deref());
    let now = unix_timestamp_secs();

    {
        let _guard = EXTERNAL_EMBED_CACHE_LOCK
            .lock()
            .map_err(|_| err_internal("External embed cache lock poisoned"))?;
        let mut cache = load_external_embed_cache();
        if !query.force_refresh {
            prune_expired_cache_entries(&mut cache, now);
            if let Some(entry) = cache.entries.get(&cache_key) {
                log::info!(
                    target: "lexera.external_embed.probe",
                    "cache_hit url={} parent_origin={:?} action={} embeddable={} checked_at={}",
                    entry.url,
                    entry.parent_origin,
                    entry.action,
                    entry.embeddable,
                    entry.checked_at
                );
                return Ok(Json(
                    serde_json::to_value(ProbeExternalEmbedResponse {
                        url: entry.url.clone(),
                        parent_origin: entry.parent_origin.clone(),
                        final_url: entry.final_url.clone(),
                        embeddable: entry.embeddable,
                        action: entry.action.clone(),
                        reason: entry.reason.clone(),
                        checked_at: entry.checked_at,
                        from_cache: true,
                        status_code: entry.status_code,
                        x_frame_options: entry.x_frame_options.clone(),
                        frame_ancestors: entry.frame_ancestors.clone(),
                    })
                    .unwrap_or_else(|_| serde_json::json!({})),
                ));
            }
            save_external_embed_cache(&cache);
        }
    }

    let probe = run_external_embed_probe(&normalized_url, parent_origin.as_deref()).await;
    let checked_at = unix_timestamp_secs();
    let entry = ExternalEmbedCacheEntry {
        url: normalized_url.clone(),
        parent_origin: parent_origin.clone(),
        final_url: probe.final_url.clone(),
        embeddable: probe.embeddable,
        action: if probe.embeddable {
            "open_page".to_string()
        } else {
            "open_in_browser".to_string()
        },
        reason: probe.reason.clone(),
        checked_at,
        status_code: probe.status_code,
        x_frame_options: probe.x_frame_options.clone(),
        frame_ancestors: probe.frame_ancestors.clone(),
    };

    {
        let _guard = EXTERNAL_EMBED_CACHE_LOCK
            .lock()
            .map_err(|_| err_internal("External embed cache lock poisoned"))?;
        let mut cache = load_external_embed_cache();
        prune_expired_cache_entries(&mut cache, checked_at);
        cache.entries.insert(cache_key, entry.clone());
        save_external_embed_cache(&cache);
    }

    log::info!(
        target: "lexera.external_embed.probe",
        "probed url={} parent_origin={:?} final_url={:?} action={} embeddable={} status_code={:?} x_frame_options={:?} frame_ancestors={:?} reason={}",
        entry.url,
        entry.parent_origin,
        entry.final_url,
        entry.action,
        entry.embeddable,
        entry.status_code,
        entry.x_frame_options,
        entry.frame_ancestors,
        entry.reason
    );

    Ok(Json(
        serde_json::to_value(ProbeExternalEmbedResponse {
            url: entry.url,
            parent_origin: entry.parent_origin,
            final_url: entry.final_url,
            embeddable: entry.embeddable,
            action: entry.action,
            reason: entry.reason,
            checked_at: entry.checked_at,
            from_cache: false,
            status_code: entry.status_code,
            x_frame_options: entry.x_frame_options,
            frame_ancestors: entry.frame_ancestors,
        })
        .unwrap_or_else(|_| serde_json::json!({})),
    ))
}

fn normalize_external_embed_url(raw: &str) -> Result<String, (StatusCode, Json<ErrorResponse>)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(err_bad_request("URL must not be empty"));
    }
    if trimmed.len() > MAX_URL_LENGTH {
        return Err(err_bad_request("URL is too long"));
    }
    let mut url = Url::parse(trimmed).map_err(|_| err_bad_request("Invalid external embed URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(err_bad_request(
            "Only http:// and https:// embeds are supported",
        ));
    }
    url.set_fragment(None);
    Ok(url.to_string())
}

fn normalize_parent_origin(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    if value.is_empty() {
        return None;
    }
    match Url::parse(value) {
        Ok(url) => Some(origin_string(&url)),
        Err(_) => Some(value.trim_end_matches('/').to_ascii_lowercase()),
    }
}

fn external_embed_cache_key(url: &str, parent_origin: Option<&str>) -> String {
    format!("{}::{}", parent_origin.unwrap_or(""), url)
}

fn external_embed_cache_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(crate::config::CONFIG_DIR_NAME)
        .join(EXTERNAL_EMBED_CACHE_FILENAME)
}

fn load_external_embed_cache() -> ExternalEmbedCacheFile {
    let path = external_embed_cache_path();
    match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => ExternalEmbedCacheFile::default(),
    }
}

fn save_external_embed_cache(cache: &ExternalEmbedCacheFile) {
    let path = external_embed_cache_path();
    if let Some(parent) = path.parent() {
        if let Err(err) = std::fs::create_dir_all(parent) {
            log::warn!(
                target: "lexera.external_embed.cache",
                "Failed to create cache directory {:?}: {}",
                parent,
                err
            );
            return;
        }
    }
    match serde_json::to_string_pretty(cache) {
        Ok(json) => {
            if let Err(err) = std::fs::write(&path, json) {
                log::warn!(
                    target: "lexera.external_embed.cache",
                    "Failed to save external embed cache {:?}: {}",
                    path,
                    err
                );
            }
        }
        Err(err) => {
            log::warn!(
                target: "lexera.external_embed.cache",
                "Failed to serialize external embed cache: {}",
                err
            );
        }
    }
}

fn prune_expired_cache_entries(cache: &mut ExternalEmbedCacheFile, now: u64) {
    cache.entries.retain(|_, entry| {
        entry
            .checked_at
            .saturating_add(EXTERNAL_EMBED_CACHE_TTL_SECS)
            > now
    });
}

async fn run_external_embed_probe(url: &str, parent_origin: Option<&str>) -> ProbeResult {
    let response = match probe_headers(url).await {
        Ok(response) => response,
        Err(err) => {
            return ProbeResult {
                final_url: None,
                embeddable: false,
                reason: format!("Header probe failed: {}", err),
                status_code: None,
                x_frame_options: None,
                frame_ancestors: None,
            };
        }
    };

    let status_code = Some(response.status().as_u16());
    let final_url = Some(response.url().to_string());
    let x_frame_options = header_values(response.headers(), "x-frame-options");
    let frame_ancestors = extract_frame_ancestors(response.headers());

    let decision = evaluate_embed_policy(
        x_frame_options.as_deref(),
        frame_ancestors.as_deref(),
        parent_origin,
    );

    if !response.status().is_success() && decision.embeddable {
        return ProbeResult {
            final_url,
            embeddable: false,
            reason: format!("Page responded with HTTP {}", response.status().as_u16()),
            status_code,
            x_frame_options,
            frame_ancestors,
        };
    }

    ProbeResult {
        final_url,
        embeddable: decision.embeddable,
        reason: decision.reason,
        status_code,
        x_frame_options,
        frame_ancestors,
    }
}

// Returns the underlying `reqwest::Error` directly. The sole caller
// formats it into the user-facing reason via `format!("Header probe
// failed: {}", err)` — `reqwest::Error: Display` produces the same
// string the old `.to_string()` stringification did, so behaviour is
// preserved while the typed error stays visible to future callers
// (slice 2 of the `Result<_, String>` paydown — TODO line 84).
async fn probe_headers(url: &str) -> Result<reqwest::Response, reqwest::Error> {
    match EXTERNAL_EMBED_HTTP_CLIENT.head(url).send().await {
        Ok(response) => {
            if needs_get_fallback(response.status()) {
                EXTERNAL_EMBED_HTTP_CLIENT.get(url).send().await
            } else {
                Ok(response)
            }
        }
        Err(_) => EXTERNAL_EMBED_HTTP_CLIENT.get(url).send().await,
    }
}

fn needs_get_fallback(status: reqwest::StatusCode) -> bool {
    matches!(
        status,
        reqwest::StatusCode::METHOD_NOT_ALLOWED | reqwest::StatusCode::NOT_IMPLEMENTED
    )
}

fn header_values(headers: &HeaderMap, name: &str) -> Option<String> {
    let values: Vec<String> = headers
        .get_all(name)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    if values.is_empty() {
        None
    } else {
        Some(values.join(", "))
    }
}

fn extract_frame_ancestors(headers: &HeaderMap) -> Option<String> {
    for header_name in [
        "content-security-policy",
        "x-content-security-policy",
        "x-webkit-csp",
    ] {
        for value in headers.get_all(header_name).iter() {
            let Ok(text) = value.to_str() else {
                continue;
            };
            for directive in text.split(';') {
                let trimmed = directive.trim();
                if trimmed.len() < "frame-ancestors".len() {
                    continue;
                }
                let lower = trimmed.to_ascii_lowercase();
                if let Some(rest) = lower.strip_prefix("frame-ancestors") {
                    let original_rest = &trimmed[trimmed.len() - rest.len()..];
                    let value = original_rest.trim();
                    if !value.is_empty() {
                        return Some(value.to_string());
                    }
                }
            }
        }
    }
    None
}

#[derive(Debug)]
struct EmbedDecision {
    embeddable: bool,
    reason: String,
}

fn evaluate_embed_policy(
    x_frame_options: Option<&str>,
    frame_ancestors: Option<&str>,
    parent_origin: Option<&str>,
) -> EmbedDecision {
    if let Some(xfo) = x_frame_options {
        let lower = xfo.to_ascii_lowercase();
        if lower.contains("deny") {
            return EmbedDecision {
                embeddable: false,
                reason: "Blocked by X-Frame-Options: DENY".to_string(),
            };
        }
        if lower.contains("sameorigin") {
            return EmbedDecision {
                embeddable: false,
                reason: "Blocked by X-Frame-Options: SAMEORIGIN".to_string(),
            };
        }
        if let Some(allowed_origin) = lower.split("allow-from").nth(1) {
            let allowed_origin = allowed_origin.trim();
            if !allowed_origin.is_empty() && parent_origin != Some(allowed_origin) {
                return EmbedDecision {
                    embeddable: false,
                    reason: format!("Blocked by X-Frame-Options: ALLOW-FROM {}", allowed_origin),
                };
            }
        }
    }

    if let Some(frame_ancestors_value) = frame_ancestors {
        let Some(parent) = parent_origin else {
            return EmbedDecision {
                embeddable: false,
                reason: format!(
                    "Blocked by Content-Security-Policy frame-ancestors: {}",
                    frame_ancestors_value
                ),
            };
        };
        let tokens: Vec<&str> = frame_ancestors_value
            .split_whitespace()
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .collect();
        if tokens.is_empty() {
            return EmbedDecision {
                embeddable: true,
                reason: "Embeddable: frame-ancestors directive is empty".to_string(),
            };
        }
        if tokens
            .iter()
            .any(|token| token.eq_ignore_ascii_case("'none'"))
        {
            return EmbedDecision {
                embeddable: false,
                reason: "Blocked by Content-Security-Policy frame-ancestors 'none'".to_string(),
            };
        }
        if tokens.iter().any(|token| token.eq_ignore_ascii_case("*")) {
            return EmbedDecision {
                embeddable: true,
                reason: "Embeddable: frame-ancestors allows any origin".to_string(),
            };
        }
        if tokens
            .iter()
            .any(|token| frame_ancestor_allows_parent(token, parent))
        {
            return EmbedDecision {
                embeddable: true,
                reason: "Embeddable: parent origin allowed by frame-ancestors".to_string(),
            };
        }
        return EmbedDecision {
            embeddable: false,
            reason: format!(
                "Blocked by Content-Security-Policy frame-ancestors: {}",
                frame_ancestors_value
            ),
        };
    }

    EmbedDecision {
        embeddable: true,
        reason: "Embeddable: no iframe-blocking headers detected".to_string(),
    }
}

fn frame_ancestor_allows_parent(token: &str, parent_origin: &str) -> bool {
    let normalized_parent = parent_origin.trim_end_matches('/').to_ascii_lowercase();
    let lower = token.trim().trim_end_matches('/').to_ascii_lowercase();
    if lower == "'self'" || lower == "'none'" {
        return false;
    }
    if lower == normalized_parent {
        return true;
    }
    if lower.ends_with(':') && !lower.contains("://") {
        return normalized_parent.starts_with(&lower);
    }
    if lower.contains('*') {
        return wildcard_origin_match(&lower, &normalized_parent);
    }
    false
}

fn wildcard_origin_match(pattern: &str, parent_origin: &str) -> bool {
    let Some((pattern_scheme, pattern_host, pattern_port)) = split_origin_pattern(pattern) else {
        return false;
    };
    let Ok(parent_url) = Url::parse(parent_origin) else {
        return false;
    };
    let Some(parent_host) = parent_url.host_str() else {
        return false;
    };
    if parent_url.scheme().to_ascii_lowercase() != pattern_scheme {
        return false;
    }
    let host_matches = if let Some(suffix) = pattern_host.strip_prefix("*.") {
        let parent_host = parent_host.to_ascii_lowercase();
        parent_host == suffix || parent_host.ends_with(&format!(".{}", suffix))
    } else {
        parent_host.eq_ignore_ascii_case(&pattern_host)
    };
    if !host_matches {
        return false;
    }
    match pattern_port.as_deref() {
        Some("*") => true,
        Some(port) => {
            parent_url
                .port_or_known_default()
                .map(|value| value.to_string())
                == Some(port.to_string())
        }
        None => parent_url.port().is_none(),
    }
}

fn split_origin_pattern(pattern: &str) -> Option<(String, String, Option<String>)> {
    let (scheme, rest) = pattern.split_once("://")?;
    let (host, port) = match rest.rsplit_once(':') {
        Some((host, port))
            if !port.is_empty() && port.chars().all(|ch| ch == '*' || ch.is_ascii_digit()) =>
        {
            (host.to_ascii_lowercase(), Some(port.to_ascii_lowercase()))
        }
        _ => (rest.to_ascii_lowercase(), None),
    };
    Some((scheme.to_ascii_lowercase(), host, port))
}

fn origin_string(url: &Url) -> String {
    let Some(host) = url.host_str() else {
        return url.as_str().trim_end_matches('/').to_ascii_lowercase();
    };
    match url.port() {
        Some(port) => format!("{}://{}:{}", url.scheme(), host, port).to_ascii_lowercase(),
        None => format!("{}://{}", url.scheme(), host).to_ascii_lowercase(),
    }
}

fn unix_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluate_embed_policy_blocks_x_frame_options_sameorigin() {
        let result = evaluate_embed_policy(Some("SAMEORIGIN"), None, Some("http://127.0.0.1:1431"));
        assert!(!result.embeddable);
        assert!(result.reason.contains("SAMEORIGIN"));
    }

    #[test]
    fn evaluate_embed_policy_blocks_frame_ancestors_none() {
        let result = evaluate_embed_policy(None, Some("'none'"), Some("http://127.0.0.1:1431"));
        assert!(!result.embeddable);
        assert!(result.reason.contains("frame-ancestors"));
    }

    #[test]
    fn evaluate_embed_policy_allows_matching_parent_origin() {
        let result = evaluate_embed_policy(
            None,
            Some("http://127.0.0.1:1431 http://localhost:*"),
            Some("http://127.0.0.1:1431"),
        );
        assert!(result.embeddable);
    }

    #[test]
    fn normalize_external_embed_url_strips_fragment() {
        let normalized = normalize_external_embed_url("https://example.com/path#fragment").unwrap();
        assert_eq!(normalized, "https://example.com/path");
    }
}
