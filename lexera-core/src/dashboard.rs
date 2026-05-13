//! Dashboard board scanner.
//!
//! Scans a `KanbanBoard` for:
//! - **Upcoming items** — cards/sub-tasks with a temporal tag within `timeframe_days`.
//! - **Calendar events** — temporal lines with no checkbox (no `- [ ]` / `- [x]`).
//! - **Overdue items** — unchecked tasks whose date has already passed.
//! - **Recurring items** — yearless tags (`@KW14`, `@jan`, `@mon`) with rolling classification:
//!   `overdue` / `outdated` / `resetToRepeat` / adjusted to next occurrence.
//! - **Undated sub-tasks** — `- [ ]` lines in card content that carry no temporal tag.
//! - **Tag summary** — all `#tag` and `@temporal` tags, counted and sorted.

use chrono::{Datelike, Duration, Local, NaiveDate};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

use crate::search::{extract_hash_tags, extract_temporal_tags, parse_temporal_to_date};
use crate::types::{is_archived_or_deleted, KanbanBoard};

// ── Public result types ───────────────────────────────────────────────────

/// Classification for a recurring (yearless) temporal tag.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecurringState {
    /// Unchecked and within the overdue window (recently past).
    Overdue,
    /// Unchecked, older past — will be discarded soon.
    Outdated,
    /// Checked and within the "reset" window — needs unchecking for next cycle.
    ResetToRepeat,
}

/// A card or sub-task with a resolved temporal tag.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingItem {
    pub column_index: usize,
    pub column_title: String,
    pub card_index: usize,
    pub card_id: String,
    /// First non-empty line of the card content.
    pub card_title: String,
    /// The `@xxx` tag that produced this item.
    pub temporal_tag: String,
    /// Resolved start date (adjusted to next occurrence for recurring items).
    pub date: NaiveDate,
    /// End of date range (ISO weeks, months, quarters).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_end: Option<NaiveDate>,
    pub is_overdue: bool,
    /// Whether the original tag contained an explicit 4-digit year.
    pub has_explicit_year: bool,
    /// Set only for yearless recurring items in the overdue/outdated/reset window.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurring_state: Option<RecurringState>,
}

/// A `- [ ]` sub-task line in a card that has no temporal tag.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndatedTask {
    pub column_title: String,
    pub card_title: String,
    /// Trimmed content of the sub-task line (after the `- [ ] ` prefix).
    pub task_summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TagType {
    Hash,
    Temporal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    pub count: usize,
    pub tag_type: TagType,
}

/// Result of scanning a single board.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardScanResult {
    pub upcoming_items: Vec<UpcomingItem>,
    pub calendar_events: Vec<UpcomingItem>,
    pub undated_tasks: Vec<UndatedTask>,
    /// All tags sorted by count descending.
    pub tags: Vec<TagInfo>,
    pub total_cards: usize,
    pub temporal_cards: usize,
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn ymd_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\d{4}[./-]").expect("valid ymd regex"))
}

fn dmy_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\d{1,2}[./-]\d{1,2}[./-]\d{4}$").expect("valid dmy regex"))
}

fn year_prefix_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // Matches "YYYY" or "YYYY-" or "YYYY " at the start (year prefix for weeks, months, quarters)
    RE.get_or_init(|| Regex::new(r"^\d{4}[-_ /]").expect("valid year prefix regex"))
}

/// True when the temporal tag does NOT carry an explicit 4-digit year.
///
/// Examples:
/// - `@KW14`     → yearless (true)
/// - `@jan`      → yearless (true)
/// - `@mon`      → yearless (true, weekly recurring)
/// - `@2026-04-01` → not yearless (false)
/// - `@2026-KW14`  → not yearless (false)
/// - `@today`    → false (resolves to a specific day, not recurring)
pub fn is_yearless_temporal(tag: &str) -> bool {
    let t = tag.trim().trim_start_matches('@').to_ascii_lowercase();
    if t.is_empty() {
        return false;
    }
    // Relative anchors resolve to a specific day — not yearless / recurring
    if matches!(
        t.as_str(),
        "today" | "tomorrow" | "yesterday" | "heute" | "morgen" | "gestern"
    ) {
        return false;
    }
    // Explicit YYYY-MM-DD  or  DD.MM.YYYY
    if ymd_regex().is_match(&t) || dmy_regex().is_match(&t) {
        return false;
    }
    // Explicit year prefix for week/month/quarter tags ("2026-KW14", "2026-jan", "2026-Q1")
    if year_prefix_regex().is_match(&t) {
        return false;
    }
    // Also: pure "YYYY" 4-digit string (unlikely but safe)
    if t.len() == 4 && t.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    true
}

/// True when the tag is a pure weekday name (no week/month/quarter context).
/// These recur weekly rather than yearly.
fn is_weekly_recurring_tag(tag: &str) -> bool {
    let t = tag.trim().trim_start_matches('@').to_ascii_lowercase();
    matches!(
        t.as_str(),
        "mon"
            | "monday"
            | "mo"
            | "montag"
            | "tue"
            | "tues"
            | "tuesday"
            | "tu"
            | "di"
            | "dienstag"
            | "wed"
            | "wednesday"
            | "we"
            | "mi"
            | "mittwoch"
            | "thu"
            | "thur"
            | "thursday"
            | "th"
            | "do"
            | "donnerstag"
            | "fri"
            | "friday"
            | "fr"
            | "freitag"
            | "sat"
            | "saturday"
            | "sa"
            | "samstag"
            | "sun"
            | "sunday"
            | "su"
            | "so"
            | "sonntag"
    )
}

/// Classify a yearless recurring temporal tag by how old it is.
///
/// Returns `None` when the item should be skipped (outside all windows).
fn classify_recurring(
    effective_date: NaiveDate,
    is_checked: bool,
    is_weekly: bool,
    today: NaiveDate,
) -> Option<RecurringClassification> {
    let age_days = (today - effective_date).num_days() as f64;

    if is_weekly {
        if age_days < 0.0 {
            return Some(RecurringClassification::Future);
        }
        if age_days <= 2.0 && !is_checked {
            return Some(RecurringClassification::State(RecurringState::Overdue));
        }
        if age_days <= 2.5 && !is_checked {
            return Some(RecurringClassification::State(RecurringState::Outdated));
        }
        if age_days <= 3.0 && is_checked {
            return Some(RecurringClassification::State(
                RecurringState::ResetToRepeat,
            ));
        }
        if age_days > 3.0 {
            return Some(RecurringClassification::Future);
        }
        None // gap between 2.5 and 3.0 when unchecked
    } else {
        // Yearly recurring
        if age_days < 0.0 {
            return Some(RecurringClassification::Future);
        }
        if age_days <= 60.0 && !is_checked {
            return Some(RecurringClassification::State(RecurringState::Overdue));
        }
        if age_days <= 75.0 && !is_checked {
            return Some(RecurringClassification::State(RecurringState::Outdated));
        }
        if age_days <= 90.0 && is_checked {
            return Some(RecurringClassification::State(
                RecurringState::ResetToRepeat,
            ));
        }
        if age_days > 90.0 {
            return Some(RecurringClassification::Future);
        }
        None // gap between 75 and 90 when unchecked
    }
}

enum RecurringClassification {
    Future,
    State(RecurringState),
}

/// Advance a yearless date to its next occurrence.
fn next_occurrence(date: NaiveDate, is_weekly: bool) -> NaiveDate {
    if is_weekly {
        date + Duration::days(7)
    } else {
        // Yearly: advance one year
        NaiveDate::from_ymd_opt(date.year() + 1, date.month(), date.day())
            .unwrap_or(date + Duration::days(365))
    }
}

static UNDATED_TASK_RE: OnceLock<Regex> = OnceLock::new();

fn undated_task_regex() -> &'static Regex {
    UNDATED_TASK_RE.get_or_init(|| Regex::new(r"^- \[ \]\s").expect("valid undated task regex"))
}

static HAS_TEMPORAL_RE: OnceLock<Regex> = OnceLock::new();

fn has_temporal_regex() -> &'static Regex {
    HAS_TEMPORAL_RE.get_or_init(|| Regex::new(r"(?:^|\s)@\S").expect("valid has-temporal regex"))
}

// ── Main scan function ────────────────────────────────────────────────────

/// Scan a board and return upcoming items, undated tasks, and tag summary.
///
/// `timeframe_days` controls how far into the future to collect upcoming items.
/// Use `0` to collect only today's items; `30` to collect the next 30 days.
/// Overdue items (unchecked, past their date) are always included.
pub fn scan_board(board: &KanbanBoard, timeframe_days: i64, today: NaiveDate) -> BoardScanResult {
    let future_limit = today + Duration::days(timeframe_days);

    let mut upcoming_items: Vec<UpcomingItem> = Vec::new();
    let mut calendar_events: Vec<UpcomingItem> = Vec::new();
    let mut undated_tasks: Vec<UndatedTask> = Vec::new();
    let mut tag_counts: HashMap<String, (usize, TagType)> = HashMap::new();
    let mut total_cards: usize = 0;
    let mut temporal_cards: usize = 0;

    let columns = board.all_columns();

    for (col_idx, col) in columns.iter().enumerate() {
        let col_title = &col.title;

        if is_archived_or_deleted(col_title) {
            continue;
        }

        // Column gating: if the column title has a temporal tag that is outside
        // the timeframe window, skip all cards in this column.
        let col_tags = extract_temporal_tags(col_title);
        let col_outside_timeframe = col_tags.iter().any(|t| {
            if let Some(d) = parse_temporal_to_date(t, today) {
                // Skip the column only when the column's date is strictly in the past
                // beyond the timeframe (not today or upcoming)
                d < today
            } else {
                false
            }
        });
        if col_outside_timeframe {
            continue;
        }

        for (card_idx, card) in col.cards.iter().enumerate() {
            let content = &card.content;
            if is_archived_or_deleted(content) {
                continue;
            }

            total_cards += 1;

            let lines: Vec<&str> = content.lines().collect();
            let card_title = lines
                .iter()
                .find(|l| !l.trim().is_empty())
                .map(|l| l.trim())
                .unwrap_or("")
                .to_string();

            // Collect hash tags
            for tag in extract_hash_tags(content) {
                tag_counts.entry(tag).or_insert((0, TagType::Hash)).0 += 1;
            }

            // Process temporal tags
            let temporal_tags = extract_temporal_tags(content);
            if !temporal_tags.is_empty() {
                temporal_cards += 1;
            }

            for tag in &temporal_tags {
                tag_counts
                    .entry(tag.clone())
                    .or_insert((0, TagType::Temporal))
                    .0 += 1;

                let yearless = is_yearless_temporal(tag);
                let is_weekly = is_weekly_recurring_tag(tag);

                if let Some(date) = parse_temporal_to_date(tag, today) {
                    // In V2 every card is a checkbox-style item: the `- [ ]` or `- [x]`
                    // prefix is stripped from the content; `card.checked` records the state.
                    // `- [ ]` in the content only appears on *sub-task* lines.
                    // All top-level temporal tags therefore belong to task-style upcoming items.
                    // The `calendar_events` collection is kept for API compatibility but is only
                    // populated when the card has no checkbox state at all (plain `- text` items
                    // where the parser sets checked = false and there's no sub-task checkbox either).
                    // In practice, V2 boards always use checkbox cards, so is_calendar_event = false.
                    let is_calendar_event = false;

                    if yearless {
                        // Calendar events: treat as never-checked for recurring classification
                        let effective_checked = if is_calendar_event {
                            false
                        } else {
                            card.checked
                        };
                        let classification =
                            classify_recurring(date, effective_checked, is_weekly, today);
                        match classification {
                            None => {} // skip
                            Some(RecurringClassification::State(state)) => {
                                let is_overdue = matches!(
                                    state,
                                    RecurringState::Overdue | RecurringState::Outdated
                                );
                                let target = if is_calendar_event {
                                    &mut calendar_events
                                } else {
                                    &mut upcoming_items
                                };
                                target.push(UpcomingItem {
                                    column_index: col_idx,
                                    column_title: col_title.clone(),
                                    card_index: card_idx,
                                    card_id: card.id.clone(),
                                    card_title: card_title.clone(),
                                    temporal_tag: tag.clone(),
                                    date,
                                    date_end: None,
                                    is_overdue,
                                    has_explicit_year: false,
                                    recurring_state: Some(state),
                                });
                            }
                            Some(RecurringClassification::Future) => {
                                let adj_date = if date < today {
                                    next_occurrence(date, is_weekly)
                                } else {
                                    date
                                };
                                if adj_date <= future_limit {
                                    let target = if is_calendar_event {
                                        &mut calendar_events
                                    } else {
                                        &mut upcoming_items
                                    };
                                    target.push(UpcomingItem {
                                        column_index: col_idx,
                                        column_title: col_title.clone(),
                                        card_index: card_idx,
                                        card_id: card.id.clone(),
                                        card_title: card_title.clone(),
                                        temporal_tag: tag.clone(),
                                        date: adj_date,
                                        date_end: None,
                                        is_overdue: false,
                                        has_explicit_year: false,
                                        recurring_state: None,
                                    });
                                }
                            }
                        }
                    } else {
                        // Explicit year (non-recurring)
                        // Skip checked tasks that are done (calendar events always show)
                        if !is_calendar_event && card.checked {
                            continue;
                        }

                        let is_overdue = !is_calendar_event && !card.checked && date < today;

                        if is_overdue || (date >= today && date <= future_limit) {
                            let target = if is_calendar_event {
                                &mut calendar_events
                            } else {
                                &mut upcoming_items
                            };
                            target.push(UpcomingItem {
                                column_index: col_idx,
                                column_title: col_title.clone(),
                                card_index: card_idx,
                                card_id: card.id.clone(),
                                card_title: card_title.clone(),
                                temporal_tag: tag.clone(),
                                date,
                                date_end: None,
                                is_overdue,
                                has_explicit_year: true,
                                recurring_state: None,
                            });
                        }
                    }
                }
            }

            // Undated sub-tasks: `- [ ]` lines (after line 0) with no temporal tag
            if lines.len() > 1 {
                let temporal_line_texts: std::collections::HashSet<&str> = temporal_tags
                    .iter()
                    .flat_map(|_| lines.iter().filter(|l| has_temporal_regex().is_match(l)))
                    .copied()
                    .collect();

                for line in lines.iter().skip(1) {
                    let trimmed = line.trim();
                    if !undated_task_regex().is_match(trimmed) {
                        continue;
                    }
                    if temporal_line_texts.contains(trimmed) {
                        continue;
                    }
                    if has_temporal_regex().is_match(trimmed) {
                        continue;
                    }
                    let task_summary = trimmed[6..].trim().to_string(); // strip "- [ ] "
                    if !task_summary.is_empty() {
                        undated_tasks.push(UndatedTask {
                            column_title: col_title.clone(),
                            card_title: card_title.clone(),
                            task_summary,
                        });
                    }
                }
            }
        }
    }

    // Build sorted tag list
    let mut tags: Vec<TagInfo> = tag_counts
        .into_iter()
        .map(|(name, (count, tag_type))| TagInfo {
            name,
            count,
            tag_type,
        })
        .collect();
    tags.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));

    BoardScanResult {
        upcoming_items,
        calendar_events,
        undated_tasks,
        tags,
        total_cards,
        temporal_cards,
    }
}

/// Scan a board using today's local date.
pub fn scan_board_today(board: &KanbanBoard, timeframe_days: i64) -> BoardScanResult {
    scan_board(board, timeframe_days, Local::now().date_naive())
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BoardFormat, KanbanBoard, KanbanCard, KanbanColumn};

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 4, 1).unwrap()
    }

    fn card(id: &str, content: &str, checked: bool) -> KanbanCard {
        KanbanCard {
            id: id.to_string(),
            content: content.to_string(),
            checked,
            kid: None,
            params: Default::default(),
        }
    }

    fn col(title: &str, cards: Vec<KanbanCard>) -> KanbanColumn {
        KanbanColumn {
            id: title.to_string(),
            title: title.to_string(),
            cards,
            include_source: None,
            params: Default::default(),
        }
    }

    fn board(columns: Vec<KanbanColumn>) -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Test".to_string(),
            columns,
            rows: Vec::new(),
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::Legacy,
        }
    }

    // ── is_yearless_temporal ─────────────────────────────────────────────

    #[test]
    fn yearless_detects_kw_tag() {
        assert!(is_yearless_temporal("@KW14"));
        assert!(is_yearless_temporal("@kw7"));
        assert!(is_yearless_temporal("@W14"));
    }

    #[test]
    fn yearless_detects_month_tag() {
        assert!(is_yearless_temporal("@jan"));
        assert!(is_yearless_temporal("@december"));
    }

    #[test]
    fn yearless_detects_weekday_tag() {
        assert!(is_yearless_temporal("@mon"));
        assert!(is_yearless_temporal("@friday"));
    }

    #[test]
    fn not_yearless_for_explicit_date() {
        assert!(!is_yearless_temporal("@2026-04-01"));
        assert!(!is_yearless_temporal("@01.04.2026"));
    }

    #[test]
    fn not_yearless_for_today() {
        assert!(!is_yearless_temporal("@today"));
        assert!(!is_yearless_temporal("@tomorrow"));
    }

    #[test]
    fn not_yearless_when_year_prefix() {
        assert!(!is_yearless_temporal("@2026-KW14"));
        assert!(!is_yearless_temporal("@2026-jan"));
        assert!(!is_yearless_temporal("@2026-Q1"));
    }

    // ── upcoming items ───────────────────────────────────────────────────

    #[test]
    fn scan_collects_upcoming_task() {
        // Date in the future within 30 days
        let c = card("c1", "task @2026-04-10", false);
        let b = board(vec![col("Todo", vec![c])]);
        let result = scan_board(&b, 30, today());
        assert_eq!(result.upcoming_items.len(), 1);
        assert_eq!(result.upcoming_items[0].temporal_tag, "@2026-04-10");
        assert!(!result.upcoming_items[0].is_overdue);
    }

    #[test]
    fn scan_excludes_far_future() {
        let c = card("c1", "task @2026-12-01", false);
        let b = board(vec![col("Todo", vec![c])]);
        let result = scan_board(&b, 30, today());
        assert_eq!(result.upcoming_items.len(), 0);
    }

    #[test]
    fn scan_marks_overdue() {
        // Past date, unchecked
        let c = card("c1", "task @2026-03-01", false);
        let b = board(vec![col("Todo", vec![c])]);
        let result = scan_board(&b, 30, today());
        assert_eq!(result.upcoming_items.len(), 1);
        assert!(result.upcoming_items[0].is_overdue);
    }

    #[test]
    fn scan_skips_checked_non_recurring() {
        let c = card("c1", "task @2026-03-15", true); // checked + past
        let b = board(vec![col("Done", vec![c])]);
        let result = scan_board(&b, 30, today());
        assert_eq!(result.upcoming_items.len(), 0);
    }

    #[test]
    fn scan_skips_archived_column() {
        let c = card("c1", "task @2026-04-05", false);
        let b = board(vec![col("Done #hidden-internal-archived", vec![c])]);
        let result = scan_board(&b, 30, today());
        assert_eq!(result.upcoming_items.len(), 0);
    }

    // ── recurring (yearless) ─────────────────────────────────────────────

    #[test]
    fn recurring_overdue_within_window() {
        // @KW14 = 2026-03-30 (week 14), today = 2026-04-01 → 2 days ago, unchecked
        let c = card("c1", "weekly task @KW14", false);
        let b = board(vec![col("Todo", vec![c])]);
        let result = scan_board(&b, 30, today());
        // Should appear as overdue recurring
        assert!(!result.upcoming_items.is_empty());
        let item = &result.upcoming_items[0];
        assert!(!item.has_explicit_year);
        assert!(item.is_overdue || item.recurring_state.is_some());
    }

    #[test]
    fn weekly_recurring_future_advances_one_week() {
        // @mon from today=2026-04-01 (Wednesday) → next Monday = 2026-04-06
        // which is within 30 days
        let c = card("c1", "weekly @mon", false);
        let b = board(vec![col("Todo", vec![c])]);
        let result = scan_board(&b, 30, today());
        // Either upcoming or calendar event — should appear
        let all: Vec<_> = result
            .upcoming_items
            .iter()
            .chain(result.calendar_events.iter())
            .collect();
        // today is Wednesday, @mon resolves to next Monday (2026-04-06) - within 30 days
        assert!(!all.is_empty(), "weekly recurring item should appear");
    }

    // ── undated tasks ────────────────────────────────────────────────────

    #[test]
    fn scan_collects_undated_subtask() {
        let content = "Card title\n- [ ] buy milk\n- [ ] send email";
        let c = card("c1", content, false);
        let b = board(vec![col("Todo", vec![c])]);
        let result = scan_board(&b, 30, today());
        assert_eq!(result.undated_tasks.len(), 2);
        assert_eq!(result.undated_tasks[0].task_summary, "buy milk");
        assert_eq!(result.undated_tasks[1].task_summary, "send email");
    }

    #[test]
    fn undated_task_with_temporal_is_excluded() {
        let content = "Card\n- [ ] meeting @2026-04-05";
        let c = card("c1", content, false);
        let b = board(vec![col("Todo", vec![c])]);
        let result = scan_board(&b, 30, today());
        assert_eq!(result.undated_tasks.len(), 0);
    }

    #[test]
    fn first_line_is_never_an_undated_task() {
        let content = "- [ ] card as task";
        let c = card("c1", content, false);
        let b = board(vec![col("Todo", vec![c])]);
        let result = scan_board(&b, 30, today());
        assert_eq!(result.undated_tasks.len(), 0);
    }

    // ── tag summary ──────────────────────────────────────────────────────

    #[test]
    fn scan_counts_hash_tags() {
        let c1 = card("c1", "task #work #urgent", false);
        let c2 = card("c2", "other #work", false);
        let b = board(vec![col("Todo", vec![c1, c2])]);
        let result = scan_board(&b, 30, today());
        let work = result.tags.iter().find(|t| t.name == "#work").unwrap();
        assert_eq!(work.count, 2);
        let urgent = result.tags.iter().find(|t| t.name == "#urgent").unwrap();
        assert_eq!(urgent.count, 1);
    }

    #[test]
    fn scan_counts_total_and_temporal_cards() {
        let c1 = card("c1", "task @2026-04-05", false);
        let c2 = card("c2", "no date here", false);
        let b = board(vec![col("Todo", vec![c1, c2])]);
        let result = scan_board(&b, 30, today());
        assert_eq!(result.total_cards, 2);
        assert_eq!(result.temporal_cards, 1);
    }
}
