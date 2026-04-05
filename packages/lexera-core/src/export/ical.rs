use chrono::{DateTime, Duration, Local, NaiveDate, Utc};
use log::warn;
use sha2::{Digest, Sha256};

use crate::search::{extract_hash_tags, extract_temporal_tags, parse_temporal_to_date};
use crate::types::{KanbanBoard, KanbanCard};

// ---------------------------------------------------------------------------
// Date parsing from temporal tags
// ---------------------------------------------------------------------------

/// A parsed date or date range from a temporal tag.
#[derive(Debug, Clone, PartialEq)]
enum DateInfo {
    /// Single date (all-day event: DTSTART = date, DTEND = date + 1 day).
    Single(NaiveDate),
    /// Date range (DTSTART = start, DTEND = end + 1 day for all-day semantics).
    Range(NaiveDate, NaiveDate),
}

/// Try to parse a temporal tag as a date range (`@YYYY-MM-DD..YYYY-MM-DD`)
/// or fall back to a single date.
fn parse_date_info(tag: &str, today: NaiveDate) -> Option<DateInfo> {
    // Strip leading `@` for processing.
    let raw = tag.strip_prefix('@').unwrap_or(tag);

    // Check for range notation: `date..date`
    if let Some((left, right)) = raw.split_once("..") {
        let start_tag = if left.starts_with('@') {
            left.to_string()
        } else {
            format!("@{}", left)
        };
        let end_tag = if right.starts_with('@') {
            right.to_string()
        } else {
            format!("@{}", right)
        };

        let start = parse_temporal_to_date(&start_tag, today)?;
        let end = parse_temporal_to_date(&end_tag, today)?;

        if end >= start {
            return Some(DateInfo::Range(start, end));
        } else {
            warn!(
                "[export.ical] date range end ({}) is before start ({}), skipping",
                end, start
            );
            return None;
        }
    }

    // Single date.
    parse_temporal_to_date(tag, today).map(DateInfo::Single)
}

// ---------------------------------------------------------------------------
// iCal line folding (RFC 5545 Section 3.1)
// ---------------------------------------------------------------------------

/// Maximum octets per content line per RFC 5545 §3.1.
///
/// Quote: "Lines of text SHOULD NOT be longer than 75 octets, excluding the
/// line break. Long content lines SHOULD be split into a multiple line
/// representations using a line 'folding' technique."
const ICAL_LINE_OCTET_LIMIT: usize = 75;

/// Fold a single content line at 75-octet boundaries per RFC 5545 §3.1.
///
/// Folded lines are joined with `CRLF + SPACE`. The octet budget applies to
/// the UTF-8 byte length, not the character count, and a fold must never land
/// inside a multi-byte codepoint (RFC 5545 §3.1 clarifies this for UTF-8).
///
/// Returns the line unchanged when it already fits in the limit.
fn fold_ical_line(line: &str) -> String {
    let bytes = line.as_bytes();
    if bytes.len() <= ICAL_LINE_OCTET_LIMIT {
        return line.to_string();
    }

    // Pre-allocate: original length plus CRLF+SPACE (3 bytes) per fold.
    let fold_count = bytes.len() / ICAL_LINE_OCTET_LIMIT;
    let mut out = String::with_capacity(bytes.len() + fold_count * 3);

    // First chunk has the full 75-octet budget; each continuation chunk
    // starts with a leading SPACE so the continuation itself has 74 octets
    // of payload (75 total with the SPACE prefix). Readers strip the
    // `CRLF + single-whitespace` sequence to "unfold" on receive.
    let mut start = 0usize;
    let total = bytes.len();
    let mut first = true;

    while start < total {
        let budget = if first {
            ICAL_LINE_OCTET_LIMIT
        } else {
            ICAL_LINE_OCTET_LIMIT - 1 // account for the SPACE continuation prefix
        };
        let remaining = total - start;
        let take = remaining.min(budget);
        let mut end = start + take;

        // Never split mid-codepoint: walk back to a valid UTF-8 boundary.
        while end < total && !is_char_boundary(bytes, end) {
            end -= 1;
        }

        if !first {
            out.push_str("\r\n ");
        }
        // SAFETY: `end` is always on a UTF-8 codepoint boundary by the
        // walk-back above.
        out.push_str(&line[start..end]);

        start = end;
        first = false;
    }

    out
}

/// Check if `idx` is a valid UTF-8 codepoint boundary within `bytes`.
/// Mirrors `str::is_char_boundary` without requiring a `&str`.
fn is_char_boundary(bytes: &[u8], idx: usize) -> bool {
    if idx == 0 || idx == bytes.len() {
        return true;
    }
    // Continuation bytes have the top two bits set to `10xxxxxx`.
    // A boundary is any byte that is NOT a continuation byte.
    (bytes[idx] & 0b1100_0000) != 0b1000_0000
}

// ---------------------------------------------------------------------------
// iCal content escaping (RFC 5545 Section 3.3.11)
// ---------------------------------------------------------------------------

/// Escape text for iCal property values per RFC 5545.
/// Backslashes, semicolons, commas, and newlines must be escaped.
fn ical_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 16);
    for ch in text.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            '\r' => {} // Skip carriage returns; newlines handled above.
            _ => out.push(ch),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// UID generation
// ---------------------------------------------------------------------------

/// Generate a deterministic UID from board_id and card kid using SHA-256.
fn generate_uid(board_id: &str, card_kid: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(board_id.as_bytes());
    hasher.update(b":");
    hasher.update(card_kid.as_bytes());
    let hash = hasher.finalize();
    let hex_hash = hex::encode(hash);
    format!("{}@lexera", hex_hash)
}

// ---------------------------------------------------------------------------
// Card title extraction
// ---------------------------------------------------------------------------

/// Extract the title from card content: first non-empty line, stripped of
/// leading list markers and checkboxes.
fn extract_title(content: &str) -> String {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Strip list markers: `- `, `* `, `+ `, `1. `, `1) `
        let stripped = strip_list_marker(trimmed);
        // Strip checkbox markers: `[ ] `, `[x] `, `[X] `
        let stripped = strip_checkbox(stripped);
        let stripped = stripped.trim();
        if !stripped.is_empty() {
            // Truncate to a reasonable length for SUMMARY
            if stripped.len() > 200 {
                return format!("{}...", &stripped[..197]);
            }
            return stripped.to_string();
        }
    }
    // Fallback: use the full content, truncated.
    let fallback = content.trim();
    if fallback.len() > 200 {
        format!("{}...", &fallback[..197])
    } else {
        fallback.to_string()
    }
}

fn strip_list_marker(line: &str) -> &str {
    // `- `, `* `, `+ `
    if (line.starts_with("- ") || line.starts_with("* ") || line.starts_with("+ "))
        && line.len() > 2
    {
        return &line[2..];
    }
    // `N. ` or `N) `
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i > 0 && i < bytes.len() && (bytes[i] == b'.' || bytes[i] == b')') {
        let after = i + 1;
        if after < bytes.len() && bytes[after] == b' ' {
            return &line[after + 1..];
        }
    }
    line
}

fn strip_checkbox(line: &str) -> &str {
    if line.starts_with("[ ] ") || line.starts_with("[x] ") || line.starts_with("[X] ") {
        &line[4..]
    } else {
        line
    }
}

// ---------------------------------------------------------------------------
// Temporal tag stripping
// ---------------------------------------------------------------------------

/// Remove temporal tags (@...) from content for the DESCRIPTION field.
fn strip_temporal_tags(content: &str) -> String {
    // We use the same regex approach as search.rs but replace matches with empty.
    use regex::Regex;
    use std::sync::OnceLock;

    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?:^|\s)(@[^\s]+)").expect("valid temporal tag regex"));

    // We need to be careful: the regex captures a possible leading space.
    // Replace the whole match region but keep content around it clean.
    let result = re.replace_all(content, |caps: &regex::Captures| {
        let full = caps.get(0).unwrap().as_str();
        // If the match starts with whitespace, that means there was a leading space.
        if full.starts_with(char::is_whitespace) {
            // Keep one space to not merge adjacent words.
            " ".to_string()
        } else {
            String::new()
        }
    });

    // Clean up any resulting double-spaces or trailing whitespace per line.
    result
        .lines()
        .map(|line| {
            // Collapse multiple spaces into single.
            let mut prev_space = false;
            let collapsed: String = line
                .chars()
                .filter(|&c| {
                    if c == ' ' {
                        if prev_space {
                            return false;
                        }
                        prev_space = true;
                    } else {
                        prev_space = false;
                    }
                    true
                })
                .collect();
            collapsed.trim_end().to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

// ---------------------------------------------------------------------------
// Checkbox / status detection
// ---------------------------------------------------------------------------

/// Determine iCal STATUS based on the card's checked state and content.
/// - Card.checked == true => COMPLETED
/// - Content contains `[x]` or `[X]` (any line) => COMPLETED
/// - Otherwise => NEEDS-ACTION
fn determine_status(card: &KanbanCard) -> &'static str {
    if card.checked {
        return "COMPLETED";
    }
    // Scan for checked checkboxes in content.
    for line in card.content.lines() {
        let trimmed = line.trim();
        let stripped = strip_list_marker(trimmed);
        if stripped.starts_with("[x] ") || stripped.starts_with("[X] ") {
            return "COMPLETED";
        }
    }
    "NEEDS-ACTION"
}

// ---------------------------------------------------------------------------
// VEVENT generation
// ---------------------------------------------------------------------------

/// Format a NaiveDate as an iCal DATE value: YYYYMMDD.
fn format_ical_date(date: NaiveDate) -> String {
    format!("{}", date.format("%Y%m%d"))
}

/// Format a UTC instant as an iCal DATE-TIME UTC value: YYYYMMDDTHHMMSSZ
/// (RFC 5545 §3.3.5 "Form #2: Date with UTC Time").
fn format_ical_utc(ts: DateTime<Utc>) -> String {
    ts.format("%Y%m%dT%H%M%SZ").to_string()
}

/// Information about a single VEVENT to be generated.
struct VEventInfo {
    uid: String,
    /// Creation/build timestamp of this VEVENT as a UTC instant. Required by
    /// RFC 5545 §3.8.7.2 — `DTSTAMP` is a mandatory property on every VEVENT.
    dtstamp: DateTime<Utc>,
    dtstart: NaiveDate,
    dtend: NaiveDate,
    summary: String,
    description: String,
    categories: Vec<String>,
    status: &'static str,
}

/// Try to build VEVENT info from a card. Returns None if the card has no
/// temporal tags that resolve to dates.
///
/// `now` is used as the `DTSTAMP` value for the resulting VEVENT. Callers in
/// production pass `Utc::now()`; tests pass a fixed instant so assertions are
/// deterministic.
fn build_vevent_info(
    card: &KanbanCard,
    board_id: &str,
    today: NaiveDate,
    now: DateTime<Utc>,
) -> Option<VEventInfo> {
    let temporal_tags = extract_temporal_tags(&card.content);

    if temporal_tags.is_empty() {
        return None;
    }

    // Find the first temporal tag that resolves to a date (or date range).
    let mut date_info: Option<DateInfo> = None;
    for tag in &temporal_tags {
        if let Some(info) = parse_date_info(tag, today) {
            date_info = Some(info);
            break;
        }
    }

    let date_info = match date_info {
        Some(di) => di,
        None => {
            warn!(
                "[export.ical] card {:?} has temporal tags but none resolve to dates, skipping",
                card.kid
            );
            return None;
        }
    };

    let (dtstart, dtend) = match date_info {
        DateInfo::Single(date) => {
            // All-day event: DTEND is the next day (exclusive).
            (date, date + Duration::days(1))
        }
        DateInfo::Range(start, end) => {
            // All-day range: DTEND is end + 1 day (exclusive).
            (start, end + Duration::days(1))
        }
    };

    // Use kid if available, otherwise fall back to card.id.
    let card_identity = card.kid.as_deref().unwrap_or(&card.id);
    let uid = generate_uid(board_id, card_identity);

    let summary = extract_title(&card.content);
    let description = strip_temporal_tags(&card.content);

    // Extract #tags for CATEGORIES (strip the leading `#`).
    let hash_tags = extract_hash_tags(&card.content);
    let categories: Vec<String> = hash_tags
        .iter()
        .map(|t| t.trim_start_matches('#').to_string())
        .filter(|t| !t.is_empty())
        .collect();

    let status = determine_status(card);

    Some(VEventInfo {
        uid,
        dtstamp: now,
        dtstart,
        dtend,
        summary,
        description,
        categories,
        status,
    })
}

/// Render a single VEVENT block as a string.
fn render_vevent(info: &VEventInfo) -> String {
    let mut lines = Vec::with_capacity(11);
    lines.push("BEGIN:VEVENT".to_string());
    lines.push(format!("UID:{}", info.uid));
    // DTSTAMP is REQUIRED by RFC 5545 §3.8.7.2 and must be a UTC date-time.
    lines.push(format!("DTSTAMP:{}", format_ical_utc(info.dtstamp)));
    lines.push(format!(
        "DTSTART;VALUE=DATE:{}",
        format_ical_date(info.dtstart)
    ));
    lines.push(format!("DTEND;VALUE=DATE:{}", format_ical_date(info.dtend)));
    lines.push(format!("SUMMARY:{}", ical_escape(&info.summary)));
    lines.push(format!("DESCRIPTION:{}", ical_escape(&info.description)));

    if !info.categories.is_empty() {
        let cats: Vec<String> = info.categories.iter().map(|c| ical_escape(c)).collect();
        lines.push(format!("CATEGORIES:{}", cats.join(",")));
    }

    lines.push(format!("STATUS:{}", info.status));
    lines.push("END:VEVENT".to_string());

    lines.join("\r\n")
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Export an entire kanban board to iCal format.
///
/// Only cards that contain temporal tags resolvable to dates are included.
/// Cards without temporal tags or with unparseable dates are silently skipped.
pub fn export_board_to_ical(board: &KanbanBoard, board_id: &str) -> String {
    let all_columns = board.all_columns();
    let cards: Vec<&KanbanCard> = all_columns
        .iter()
        .flat_map(|col| col.cards.iter())
        .collect();

    let card_refs: Vec<&KanbanCard> = cards.into_iter().collect();
    export_cards_to_ical(&card_refs, board_id)
}

/// Export specific cards to iCal format.
///
/// Only cards that contain temporal tags resolvable to dates are included.
/// Cards without temporal tags or with unparseable dates are silently skipped.
pub fn export_cards_to_ical(cards: &[&KanbanCard], board_id: &str) -> String {
    export_cards_to_ical_with_now(cards, board_id, Utc::now())
}

/// Internal helper used by the public export functions and by tests. Accepts
/// an explicit `now` instant that is used as `DTSTAMP` on every VEVENT so
/// callers can produce deterministic output in tests.
fn export_cards_to_ical_with_now(
    cards: &[&KanbanCard],
    board_id: &str,
    now: DateTime<Utc>,
) -> String {
    let today = Local::now().date_naive();

    let mut vevents = Vec::new();
    for card in cards {
        if let Some(info) = build_vevent_info(card, board_id, today, now) {
            vevents.push(render_vevent(&info));
        }
    }

    // Assemble all content lines. Each VEVENT block is already a multi-line
    // string joined by CRLF, so we split it back into individual logical
    // lines here and rejoin everything through the folding pipeline below.
    let mut lines: Vec<String> = Vec::with_capacity(6 + vevents.len() * 10);
    lines.push("BEGIN:VCALENDAR".to_string());
    lines.push("VERSION:2.0".to_string());
    lines.push("PRODID:-//Lexera//Kanban//EN".to_string());
    // CALSCALE:GREGORIAN — RFC 5545 §3.7.1. Optional but commonly required by
    // strict CalDAV clients that refuse calendars without an explicit scale.
    lines.push("CALSCALE:GREGORIAN".to_string());
    // METHOD:PUBLISH — RFC 5545 §3.7.2. Marks this as a published feed
    // (vs. an iTIP request/reply); needed for subscription-based clients.
    lines.push("METHOD:PUBLISH".to_string());

    for vevent in vevents {
        for line in vevent.split("\r\n") {
            lines.push(line.to_string());
        }
    }

    lines.push("END:VCALENDAR".to_string());

    // Apply RFC 5545 §3.1 line folding to every content line.
    lines
        .iter()
        .map(|l| fold_ical_line(l))
        .collect::<Vec<_>>()
        .join("\r\n")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BoardFormat, KanbanCard};
    use chrono::TimeZone;
    use std::collections::HashMap;

    /// Helper: build a simple card.
    fn make_card(content: &str, checked: bool, kid: Option<&str>) -> KanbanCard {
        KanbanCard {
            id: "card-1".to_string(),
            content: content.to_string(),
            checked,
            kid: kid.map(|s| s.to_string()),
            params: HashMap::new(),
        }
    }

    /// Fixed DTSTAMP value so test assertions on the rendered output are
    /// deterministic. 2026-03-01T10:30:00Z matches the `today` used elsewhere
    /// in these tests.
    fn fixed_now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 3, 1, 10, 30, 0).unwrap()
    }

    // -------------------------------------------------------------------
    // Date parsing
    // -------------------------------------------------------------------

    #[test]
    fn parse_single_date() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = parse_date_info("@2026-03-15", today);
        assert_eq!(
            info,
            Some(DateInfo::Single(
                NaiveDate::from_ymd_opt(2026, 3, 15).unwrap()
            ))
        );
    }

    #[test]
    fn parse_date_range() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = parse_date_info("@2026-03-15..2026-03-20", today);
        assert_eq!(
            info,
            Some(DateInfo::Range(
                NaiveDate::from_ymd_opt(2026, 3, 15).unwrap(),
                NaiveDate::from_ymd_opt(2026, 3, 20).unwrap(),
            ))
        );
    }

    #[test]
    fn parse_date_range_invalid_order() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = parse_date_info("@2026-03-20..2026-03-15", today);
        assert_eq!(info, None);
    }

    #[test]
    fn parse_relative_date_today() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = parse_date_info("@today", today);
        assert_eq!(info, Some(DateInfo::Single(today)));
    }

    #[test]
    fn parse_relative_date_tomorrow() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = parse_date_info("@tomorrow", today);
        assert_eq!(info, Some(DateInfo::Single(today + Duration::days(1))));
    }

    // -------------------------------------------------------------------
    // VEVENT generation from card with @date
    // -------------------------------------------------------------------

    #[test]
    fn card_with_date_generates_vevent() {
        let card = make_card("Meeting with team @2026-03-15 #work", false, Some("abc123"));
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = build_vevent_info(&card, "board-1", today, fixed_now());
        assert!(info.is_some());
        let info = info.unwrap();
        assert_eq!(info.dtstart, NaiveDate::from_ymd_opt(2026, 3, 15).unwrap());
        assert_eq!(info.dtend, NaiveDate::from_ymd_opt(2026, 3, 16).unwrap());
        assert!(info.summary.contains("Meeting with team"));
        assert_eq!(info.status, "NEEDS-ACTION");
    }

    #[test]
    fn card_with_date_range_generates_correct_dtstart_dtend() {
        let card = make_card(
            "Conference @2026-03-15..2026-03-20 #event",
            false,
            Some("def456"),
        );
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = build_vevent_info(&card, "board-1", today, fixed_now()).unwrap();
        assert_eq!(info.dtstart, NaiveDate::from_ymd_opt(2026, 3, 15).unwrap());
        // DTEND for all-day events is exclusive: end date + 1
        assert_eq!(info.dtend, NaiveDate::from_ymd_opt(2026, 3, 21).unwrap());
    }

    #[test]
    fn card_with_checkbox_completed_has_status_completed() {
        let card = make_card("- [x] Done task @2026-04-01", true, Some("done1"));
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = build_vevent_info(&card, "board-1", today, fixed_now()).unwrap();
        assert_eq!(info.status, "COMPLETED");
    }

    #[test]
    fn card_with_unchecked_checkbox_has_needs_action() {
        let card = make_card("- [ ] Pending task @2026-04-01", false, Some("pend1"));
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = build_vevent_info(&card, "board-1", today, fixed_now()).unwrap();
        assert_eq!(info.status, "NEEDS-ACTION");
    }

    #[test]
    fn card_with_checked_content_not_card_flag() {
        // Card.checked is false, but content has [x] — should still be COMPLETED.
        let card = make_card("[x] Finished @2026-04-01", false, Some("chk1"));
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = build_vevent_info(&card, "board-1", today, fixed_now()).unwrap();
        assert_eq!(info.status, "COMPLETED");
    }

    // -------------------------------------------------------------------
    // Cards without temporal tags are skipped
    // -------------------------------------------------------------------

    #[test]
    fn card_without_temporal_tag_is_skipped() {
        let card = make_card("Just a regular card #todo", false, Some("no-date"));
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = build_vevent_info(&card, "board-1", today, fixed_now());
        assert!(info.is_none());
    }

    // -------------------------------------------------------------------
    // Hash tags extracted to CATEGORIES
    // -------------------------------------------------------------------

    #[test]
    fn hash_tags_extracted_to_categories() {
        let card = make_card(
            "Review code #review #urgent @2026-05-01",
            false,
            Some("tags1"),
        );
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = build_vevent_info(&card, "board-1", today, fixed_now()).unwrap();
        assert!(info.categories.contains(&"review".to_string()));
        assert!(info.categories.contains(&"urgent".to_string()));
    }

    #[test]
    fn no_hash_tags_means_no_categories_line() {
        let card = make_card("Simple task @2026-05-01", false, Some("notags"));
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = build_vevent_info(&card, "board-1", today, fixed_now()).unwrap();
        assert!(info.categories.is_empty());

        let vevent = render_vevent(&info);
        assert!(!vevent.contains("CATEGORIES:"));
    }

    // -------------------------------------------------------------------
    // UID is deterministic
    // -------------------------------------------------------------------

    #[test]
    fn uid_is_deterministic() {
        let uid1 = generate_uid("board-1", "card-abc");
        let uid2 = generate_uid("board-1", "card-abc");
        assert_eq!(uid1, uid2);
        assert!(uid1.ends_with("@lexera"));
    }

    #[test]
    fn uid_differs_for_different_cards() {
        let uid1 = generate_uid("board-1", "card-abc");
        let uid2 = generate_uid("board-1", "card-xyz");
        assert_ne!(uid1, uid2);
    }

    #[test]
    fn uid_differs_for_different_boards() {
        let uid1 = generate_uid("board-1", "card-abc");
        let uid2 = generate_uid("board-2", "card-abc");
        assert_ne!(uid1, uid2);
    }

    // -------------------------------------------------------------------
    // Special character escaping
    // -------------------------------------------------------------------

    #[test]
    fn special_characters_escaped() {
        assert_eq!(ical_escape("hello\nworld"), "hello\\nworld");
        assert_eq!(ical_escape("a;b"), "a\\;b");
        assert_eq!(ical_escape("a,b"), "a\\,b");
        assert_eq!(ical_escape("a\\b"), "a\\\\b");
    }

    #[test]
    fn carriage_returns_stripped() {
        assert_eq!(ical_escape("hello\r\nworld"), "hello\\nworld");
    }

    #[test]
    fn newlines_in_card_content_escaped_in_vevent() {
        let card = make_card("Line1\nLine2\nLine3 @2026-06-01", false, Some("nl1"));
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = build_vevent_info(&card, "board-1", today, fixed_now()).unwrap();
        let vevent = render_vevent(&info);
        // The DESCRIPTION should have escaped newlines.
        assert!(vevent.contains("\\n"));
        // But should NOT contain literal newlines inside a property value.
        for line in vevent.split("\r\n") {
            if line.starts_with("DESCRIPTION:") {
                assert!(!line[12..].contains('\n'));
            }
        }
    }

    // -------------------------------------------------------------------
    // Full board export
    // -------------------------------------------------------------------

    #[test]
    fn full_board_export_with_multiple_cards() {
        use crate::types::KanbanColumn;

        let board = KanbanBoard {
            valid: true,
            title: "Test Board".to_string(),
            columns: vec![KanbanColumn {
                id: "col-1".to_string(),
                title: "Todo".to_string(),
                cards: vec![
                    make_card("Task A @2026-03-15 #work", false, Some("kid-a")),
                    make_card("No date card #info", false, Some("kid-b")),
                    make_card("- [x] Done task @2026-04-01 #done", true, Some("kid-c")),
                ],
                include_source: None,
                params: HashMap::new(),
            }],
            rows: vec![],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::Legacy,
        };

        let ical = export_board_to_ical(&board, "test-board-id");

        // Should contain calendar header.
        assert!(ical.contains("BEGIN:VCALENDAR"));
        assert!(ical.contains("VERSION:2.0"));
        assert!(ical.contains("PRODID:-//Lexera//Kanban//EN"));
        assert!(ical.contains("END:VCALENDAR"));

        // Should contain VEVENTs for cards with dates.
        assert!(ical.contains("BEGIN:VEVENT"));
        assert!(ical.contains("END:VEVENT"));

        // Card A: has date, should be present.
        assert!(ical.contains("SUMMARY:Task A"));
        assert!(ical.contains("DTSTART;VALUE=DATE:20260315"));

        // Card B: no date, should NOT be present.
        assert!(!ical.contains("No date card"));

        // Card C: checked, should have COMPLETED status.
        assert!(ical.contains("STATUS:COMPLETED"));
        assert!(ical.contains("DTSTART;VALUE=DATE:20260401"));
    }

    #[test]
    fn export_specific_cards() {
        let card1 = make_card("Meeting @2026-05-10 #meeting", false, Some("m1"));
        let card2 = make_card("Deadline @2026-06-01", false, Some("d1"));
        let card3 = make_card("No date here", false, Some("n1"));

        let cards: Vec<&KanbanCard> = vec![&card1, &card2, &card3];
        let ical = export_cards_to_ical(&cards, "board-x");

        // Two VEVENTs expected (card3 has no date).
        let vevent_count = ical.matches("BEGIN:VEVENT").count();
        assert_eq!(vevent_count, 2);
    }

    #[test]
    fn export_empty_board_produces_valid_calendar() {
        let board = KanbanBoard {
            valid: true,
            title: "Empty Board".to_string(),
            columns: vec![],
            rows: vec![],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::Legacy,
        };

        let ical = export_board_to_ical(&board, "empty-board");
        assert!(ical.contains("BEGIN:VCALENDAR"));
        assert!(ical.contains("END:VCALENDAR"));
        assert!(!ical.contains("BEGIN:VEVENT"));
    }

    // -------------------------------------------------------------------
    // Temporal tag stripping
    // -------------------------------------------------------------------

    #[test]
    fn temporal_tags_stripped_from_description() {
        let input = "Meeting with team @2026-03-15 about project";
        let result = strip_temporal_tags(input);
        assert!(!result.contains("@2026-03-15"));
        assert!(result.contains("Meeting with team"));
        assert!(result.contains("about project"));
    }

    #[test]
    fn multiple_temporal_tags_stripped() {
        let input = "Task @2026-03-15 and @2026-04-01 deadlines";
        let result = strip_temporal_tags(input);
        assert!(!result.contains("@2026"));
        assert!(result.contains("Task"));
        assert!(result.contains("deadlines"));
    }

    // -------------------------------------------------------------------
    // Title extraction
    // -------------------------------------------------------------------

    #[test]
    fn title_from_first_line() {
        let title = extract_title("My important task\nWith more details");
        assert_eq!(title, "My important task");
    }

    #[test]
    fn title_strips_list_marker() {
        assert_eq!(extract_title("- Task item"), "Task item");
        assert_eq!(extract_title("* Star item"), "Star item");
        assert_eq!(extract_title("1. Numbered item"), "Numbered item");
    }

    #[test]
    fn title_strips_checkbox() {
        assert_eq!(extract_title("- [ ] Unchecked task"), "Unchecked task");
        assert_eq!(extract_title("- [x] Checked task"), "Checked task");
    }

    #[test]
    fn title_skips_empty_lines() {
        let title = extract_title("\n\nActual title\nDetails");
        assert_eq!(title, "Actual title");
    }

    // -------------------------------------------------------------------
    // iCal date formatting
    // -------------------------------------------------------------------

    #[test]
    fn ical_date_format() {
        let date = NaiveDate::from_ymd_opt(2026, 3, 15).unwrap();
        assert_eq!(format_ical_date(date), "20260315");
    }

    #[test]
    fn ical_date_format_single_digit_month() {
        let date = NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
        assert_eq!(format_ical_date(date), "20260105");
    }

    #[test]
    fn ical_utc_format_matches_rfc5545_form2() {
        let ts = Utc.with_ymd_and_hms(2026, 3, 1, 10, 30, 0).unwrap();
        assert_eq!(format_ical_utc(ts), "20260301T103000Z");
    }

    #[test]
    fn ical_utc_format_pads_single_digits() {
        let ts = Utc.with_ymd_and_hms(2026, 1, 5, 9, 7, 3).unwrap();
        assert_eq!(format_ical_utc(ts), "20260105T090703Z");
    }

    // -------------------------------------------------------------------
    // DTSTAMP is required by RFC 5545 §3.8.7.2 on every VEVENT
    // -------------------------------------------------------------------

    #[test]
    fn vevent_emits_dtstamp_property() {
        let card = make_card("Meeting @2026-04-15", false, Some("stamp1"));
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = build_vevent_info(&card, "board-1", today, fixed_now()).unwrap();
        let vevent = render_vevent(&info);
        assert!(
            vevent.contains("DTSTAMP:20260301T103000Z"),
            "VEVENT must contain a DTSTAMP UTC property (RFC 5545 §3.8.7.2), got:\n{}",
            vevent
        );
    }

    #[test]
    fn export_cards_to_ical_stamps_every_vevent() {
        let card_a = make_card("Task A @2026-05-01", false, Some("a"));
        let card_b = make_card("Task B @2026-06-01", false, Some("b"));
        let cards: Vec<&KanbanCard> = vec![&card_a, &card_b];

        let ical = export_cards_to_ical_with_now(&cards, "board-x", fixed_now());

        // Each VEVENT block must carry the same fixed DTSTAMP.
        let dtstamp_count = ical.matches("DTSTAMP:20260301T103000Z").count();
        assert_eq!(
            dtstamp_count, 2,
            "expected DTSTAMP on each of the 2 VEVENTs, got {} matches in:\n{}",
            dtstamp_count, ical
        );
    }

    #[test]
    fn export_cards_to_ical_dtstamp_is_utc_form() {
        // The public wrapper uses `Utc::now()`, so we only assert format.
        let card = make_card("Any task @2026-07-15", false, Some("fmt"));
        let cards: Vec<&KanbanCard> = vec![&card];
        let ical = export_cards_to_ical(&cards, "board-fmt");

        // Extract the DTSTAMP value and verify it matches YYYYMMDDTHHMMSSZ.
        let line = ical
            .lines()
            .find(|l| l.starts_with("DTSTAMP:"))
            .expect("DTSTAMP line must be present");
        let value = line.strip_prefix("DTSTAMP:").unwrap();
        assert_eq!(value.len(), 16, "DTSTAMP value should be 16 chars: {}", value);
        assert!(
            value.ends_with('Z'),
            "DTSTAMP value should end with Z (UTC marker): {}",
            value
        );
        // First 8 chars = date, 9th = 'T', next 6 digits, then 'Z'.
        assert!(value[..8].chars().all(|c| c.is_ascii_digit()));
        assert_eq!(&value[8..9], "T");
        assert!(value[9..15].chars().all(|c| c.is_ascii_digit()));
    }

    // -------------------------------------------------------------------
    // RFC 5545 §3.1 line folding (75-octet limit)
    // -------------------------------------------------------------------

    #[test]
    fn fold_leaves_short_lines_unchanged() {
        let line = "SUMMARY:Short summary";
        assert_eq!(fold_ical_line(line), line);
    }

    #[test]
    fn fold_keeps_exactly_75_octet_lines_unchanged() {
        // 75 'a' characters prefixed by "X:" is 77 octets; back off to 73.
        let line: String = "X:".to_string() + &"a".repeat(73);
        assert_eq!(line.len(), 75);
        assert_eq!(fold_ical_line(&line), line);
    }

    #[test]
    fn fold_splits_line_longer_than_75_octets() {
        // 200-char SUMMARY triggers folding. Each continuation starts with
        // "\r\n " (CRLF + single SPACE) per RFC 5545 §3.1.
        let long = "a".repeat(200);
        let line = format!("SUMMARY:{}", long); // 208 octets total
        let folded = fold_ical_line(&line);

        // Every "physical" line must be ≤ 75 octets (excluding the CRLF).
        for physical in folded.split("\r\n") {
            assert!(
                physical.len() <= ICAL_LINE_OCTET_LIMIT,
                "physical line exceeds {} octets: {:?} ({} bytes)",
                ICAL_LINE_OCTET_LIMIT,
                physical,
                physical.len()
            );
        }

        // Continuation lines must begin with a SPACE so a reader knows to
        // fold-join them with the prior line.
        let pieces: Vec<&str> = folded.split("\r\n").collect();
        assert!(pieces.len() >= 2, "expected multiple folded pieces");
        for piece in &pieces[1..] {
            assert!(
                piece.starts_with(' '),
                "continuation line must start with SPACE: {:?}",
                piece
            );
        }

        // Unfolding (strip CRLF + leading SPACE on continuations) must
        // reproduce the original line exactly.
        let mut unfolded = String::new();
        for (i, piece) in pieces.iter().enumerate() {
            if i == 0 {
                unfolded.push_str(piece);
            } else {
                // Strip exactly one leading whitespace character per RFC 5545.
                unfolded.push_str(&piece[1..]);
            }
        }
        assert_eq!(unfolded, line);
    }

    #[test]
    fn fold_does_not_split_utf8_codepoint() {
        // Build a line whose 75th byte lands in the middle of a multi-byte
        // codepoint. "é" is 2 bytes in UTF-8, so 37 × "aé" = 111 bytes and
        // places an "é" starting at byte 74–75.
        let mut payload = String::new();
        for _ in 0..37 {
            payload.push('a');
            payload.push('é');
        }
        let line = format!("X:{}", payload); // 2 + 111 = 113 octets
        let folded = fold_ical_line(&line);

        // Every physical line must be valid UTF-8 (guaranteed by `String`)
        // AND must not exceed the octet limit.
        for physical in folded.split("\r\n") {
            assert!(
                physical.len() <= ICAL_LINE_OCTET_LIMIT,
                "physical line exceeds limit: {} octets",
                physical.len()
            );
        }

        // Round-trip unfolding must recover the original string.
        let pieces: Vec<&str> = folded.split("\r\n").collect();
        let mut unfolded = String::new();
        for (i, piece) in pieces.iter().enumerate() {
            if i == 0 {
                unfolded.push_str(piece);
            } else {
                unfolded.push_str(&piece[1..]);
            }
        }
        assert_eq!(unfolded, line);
    }

    #[test]
    fn fold_handles_many_fold_boundaries() {
        // A 1000-byte line must fold into roughly 1000/74 ≈ 14 pieces.
        let line = format!("LONG:{}", "x".repeat(1000));
        let folded = fold_ical_line(&line);
        let pieces: Vec<&str> = folded.split("\r\n").collect();
        assert!(
            pieces.len() >= 13,
            "expected many fold boundaries, got {}",
            pieces.len()
        );
        for physical in &pieces {
            assert!(physical.len() <= ICAL_LINE_OCTET_LIMIT);
        }
    }

    #[test]
    fn is_char_boundary_matches_std_str() {
        // Cross-check our byte-level helper against `str::is_char_boundary`
        // for a string with ASCII and multi-byte sequences.
        let s = "aé🌍bc";
        let bytes = s.as_bytes();
        for idx in 0..=bytes.len() {
            assert_eq!(
                is_char_boundary(bytes, idx),
                s.is_char_boundary(idx),
                "mismatch at byte {}",
                idx
            );
        }
    }

    #[test]
    fn export_output_folds_long_summary() {
        // A card whose summary pushes the SUMMARY line well past 75 octets
        // must still produce an output where every physical line fits.
        let long_title = "x".repeat(200);
        let content = format!("{} @2026-05-01", long_title);
        let card = make_card(&content, false, Some("longsum"));
        let cards: Vec<&KanbanCard> = vec![&card];

        let ical = export_cards_to_ical_with_now(&cards, "board-fold", fixed_now());

        for physical in ical.split("\r\n") {
            assert!(
                physical.len() <= ICAL_LINE_OCTET_LIMIT,
                "output contains physical line > 75 octets: {:?}",
                physical
            );
        }
    }

    // -------------------------------------------------------------------
    // VCALENDAR header completeness (CALSCALE, METHOD)
    // -------------------------------------------------------------------

    #[test]
    fn output_contains_calscale_gregorian() {
        let card = make_card("Task @2026-05-01", false, Some("cs"));
        let cards: Vec<&KanbanCard> = vec![&card];
        let ical = export_cards_to_ical_with_now(&cards, "board-cs", fixed_now());
        assert!(
            ical.contains("CALSCALE:GREGORIAN"),
            "output must declare CALSCALE:GREGORIAN (RFC 5545 §3.7.1)"
        );
    }

    #[test]
    fn output_contains_method_publish() {
        let card = make_card("Task @2026-05-01", false, Some("mp"));
        let cards: Vec<&KanbanCard> = vec![&card];
        let ical = export_cards_to_ical_with_now(&cards, "board-mp", fixed_now());
        assert!(
            ical.contains("METHOD:PUBLISH"),
            "output must declare METHOD:PUBLISH (RFC 5545 §3.7.2) for subscription feeds"
        );
    }

    #[test]
    fn vcalendar_header_order_is_stable() {
        // BEGIN:VCALENDAR → VERSION → PRODID → CALSCALE → METHOD → …
        // Some strict clients refuse calendars where VERSION is not the
        // first property after BEGIN:VCALENDAR, so lock the order in.
        let card = make_card("Task @2026-05-01", false, Some("order"));
        let cards: Vec<&KanbanCard> = vec![&card];
        let ical = export_cards_to_ical_with_now(&cards, "board-order", fixed_now());

        let version_idx = ical.find("VERSION:2.0").unwrap();
        let prodid_idx = ical.find("PRODID:").unwrap();
        let calscale_idx = ical.find("CALSCALE:").unwrap();
        let method_idx = ical.find("METHOD:").unwrap();
        let begin_idx = ical.find("BEGIN:VCALENDAR").unwrap();

        assert!(begin_idx < version_idx);
        assert!(version_idx < prodid_idx);
        assert!(prodid_idx < calscale_idx);
        assert!(calscale_idx < method_idx);
    }

    // -------------------------------------------------------------------
    // VEVENT rendering details
    // -------------------------------------------------------------------

    #[test]
    fn vevent_contains_all_required_fields() {
        let info = VEventInfo {
            uid: "test-uid@lexera".to_string(),
            dtstamp: fixed_now(),
            dtstart: NaiveDate::from_ymd_opt(2026, 3, 15).unwrap(),
            dtend: NaiveDate::from_ymd_opt(2026, 3, 16).unwrap(),
            summary: "Test Event".to_string(),
            description: "Event description".to_string(),
            categories: vec!["work".to_string(), "urgent".to_string()],
            status: "NEEDS-ACTION",
        };

        let vevent = render_vevent(&info);
        assert!(vevent.contains("BEGIN:VEVENT"));
        assert!(vevent.contains("END:VEVENT"));
        assert!(vevent.contains("UID:test-uid@lexera"));
        assert!(vevent.contains("DTSTAMP:20260301T103000Z"));
        assert!(vevent.contains("DTSTART;VALUE=DATE:20260315"));
        assert!(vevent.contains("DTEND;VALUE=DATE:20260316"));
        assert!(vevent.contains("SUMMARY:Test Event"));
        assert!(vevent.contains("DESCRIPTION:Event description"));
        assert!(vevent.contains("CATEGORIES:work,urgent"));
        assert!(vevent.contains("STATUS:NEEDS-ACTION"));
    }

    // -------------------------------------------------------------------
    // Edge case: card with kid=None falls back to card.id
    // -------------------------------------------------------------------

    #[test]
    fn card_without_kid_uses_id_for_uid() {
        let card = make_card("Task @2026-07-01", false, None);
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = build_vevent_info(&card, "board-1", today, fixed_now()).unwrap();
        // UID should be based on card.id ("card-1") since kid is None.
        let expected_uid = generate_uid("board-1", "card-1");
        assert_eq!(info.uid, expected_uid);
    }

    // -------------------------------------------------------------------
    // Edge case: card with temporal tag that doesn't resolve to a date
    // -------------------------------------------------------------------

    #[test]
    fn card_with_unparseable_temporal_tag_skipped() {
        // @next-week is not a recognized temporal pattern in parse_temporal_to_date
        let card = make_card("Task @notadate", false, Some("bad1"));
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let info = build_vevent_info(&card, "board-1", today, fixed_now());
        assert!(info.is_none());
    }

    // -------------------------------------------------------------------
    // CRLF line endings in output
    // -------------------------------------------------------------------

    #[test]
    fn output_uses_crlf_line_endings() {
        let card = make_card("Task @2026-08-01", false, Some("crlf1"));
        let cards: Vec<&KanbanCard> = vec![&card];
        let ical = export_cards_to_ical(&cards, "board-crlf");
        // iCal RFC 5545 requires CRLF line endings.
        assert!(ical.contains("\r\n"));
        // Should not have bare LF (except within CRLF).
        let bare_lf_count = ical
            .chars()
            .zip(ical.chars().skip(1))
            .filter(|&(prev, curr)| curr == '\n' && prev != '\r')
            .count();
        assert_eq!(bare_lf_count, 0, "Found bare LF without preceding CR");
    }

    // -------------------------------------------------------------------
    // Board with rows (new format) exports correctly
    // -------------------------------------------------------------------

    #[test]
    fn board_with_rows_format_exports_cards() {
        use crate::types::{KanbanColumn, KanbanRow, KanbanStack};

        let board = KanbanBoard {
            valid: true,
            title: "Row Board".to_string(),
            columns: vec![],
            rows: vec![KanbanRow {
                id: "row-1".to_string(),
                title: "Row 1".to_string(),
                stacks: vec![KanbanStack {
                    id: "stack-1".to_string(),
                    title: "Stack 1".to_string(),
                    columns: vec![KanbanColumn {
                        id: "col-1".to_string(),
                        title: "Col 1".to_string(),
                        cards: vec![make_card(
                            "Nested card @2026-09-01 #nested",
                            false,
                            Some("nest1"),
                        )],
                        include_source: None,
                        params: HashMap::new(),
                    }],
                    params: HashMap::new(),
                }],
                params: HashMap::new(),
            }],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::New,
        };

        let ical = export_board_to_ical(&board, "row-board");
        assert!(ical.contains("SUMMARY:Nested card"));
        assert!(ical.contains("DTSTART;VALUE=DATE:20260901"));
        assert!(ical.contains("CATEGORIES:nested"));
    }

    // -------------------------------------------------------------------
    // Commas and semicolons in categories are escaped
    // -------------------------------------------------------------------

    #[test]
    fn categories_with_special_chars_escaped() {
        // hash tags won't normally contain commas/semicolons, but test the
        // escaping layer anyway.
        let escaped = ical_escape("tag;with,special");
        assert_eq!(escaped, "tag\\;with\\,special");
    }

    // -------------------------------------------------------------------
    // Date range in VEVENT output
    // -------------------------------------------------------------------

    #[test]
    fn date_range_vevent_output() {
        let card = make_card(
            "Sprint @2026-03-15..2026-03-20 #sprint",
            false,
            Some("range1"),
        );
        let cards: Vec<&KanbanCard> = vec![&card];
        let ical = export_cards_to_ical(&cards, "board-range");
        assert!(ical.contains("DTSTART;VALUE=DATE:20260315"));
        // DTEND should be 2026-03-21 (exclusive end for all-day events).
        assert!(ical.contains("DTEND;VALUE=DATE:20260321"));
    }
}
