//! Gather Query Engine
//!
//! Automatically sorts cards into columns based on query tags in column titles.
//!
//! ## Query syntax (in column titles)
//! - `?#tagname`        — match cards with `#tagname`
//! - `?@today` / `?.today` — match cards with today's date
//! - `?@day<7` / `?.day<7` — match cards due within 7 days
//! - `?@week=10`        — match cards in ISO week 10
//! - `?@KW10`           — same, German notation
//! - `?@mon` / `?@tue`  — match cards due on a specific weekday
//!
//! ## Special column tags
//! - `#ungathered`  — collects unmatched cards that have any date or person tag
//! - `#sort-bydate` — sort column cards by due date after gathering
//! - `#sort-byname` — sort column cards alphabetically after gathering

use chrono::{Datelike, Local, NaiveDate};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

use crate::search::{extract_hash_tags, extract_temporal_tags, parse_temporal_to_date};
use crate::types::{KanbanBoard, KanbanCard};

// ── Public types ──────────────────────────────────────────────────────────

/// A single card movement computed by the gather engine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardMove {
    pub card_id: String,
    pub source_col_id: String,
    pub target_col_id: String,
}

// ── Internal types ─────────────────────────────────────────────────────────

struct GatherRule {
    target_col_id: String,
    expr: GatherExpr,
}

#[derive(Clone)]
enum GatherExpr {
    Tag(String),             // ?#tagname — match #tag in content
    DayOffset(CompOp, i64),  // day <=> N — days offset from today
    WeekNum(CompOp, u32),    // week <=> N — ISO week number
    WeekDay(CompOp, String), // weekday <=> "mon" — named weekday
    WeekDayNum(CompOp, i32), // weekdaynum <=> N — Mon=1, Sun=7
    MonthNum(CompOp, u32),   // monthnum <=> N — 1..12
    Or(Vec<GatherExpr>),
    And(Vec<GatherExpr>),
    Not(Box<GatherExpr>),
    Never,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum CompOp {
    Eq,
    Ne,
    Lt,
    Gt,
}

// ── Regexes ───────────────────────────────────────────────────────────────

fn query_tag_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\?([.@#])([^\s]+)").expect("valid gather query regex"))
}

fn sort_tag_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"#sort-([a-zA-Z]+)").expect("valid sort tag regex"))
}

fn comparison_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^([a-zA-Z0-9_-]+)(!=|[<>=])(.+)$").expect("valid comparison regex")
    })
}

fn reverse_range_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(-?\d+)([<>])([a-zA-Z]+)$").expect("valid range regex"))
}

// ── Parsing helpers ───────────────────────────────────────────────────────

fn parse_comp_op(s: &str) -> Option<CompOp> {
    match s {
        "=" => Some(CompOp::Eq),
        "!=" => Some(CompOp::Ne),
        "<" => Some(CompOp::Lt),
        ">" => Some(CompOp::Gt),
        _ => None,
    }
}

fn compare_i64(a: i64, b: i64, op: CompOp) -> bool {
    match op {
        CompOp::Eq => a == b,
        CompOp::Ne => a != b,
        CompOp::Lt => a < b,
        CompOp::Gt => a > b,
    }
}

/// Split `expr` by `operator` at parenthesis depth 0.
fn split_by_op(expr: &str, operator: char) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0usize;
    let mut depth = 0usize;
    for (i, ch) in expr.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            c if c == operator && depth == 0 => {
                let part = expr[start..i].trim();
                if !part.is_empty() {
                    parts.push(part);
                }
                start = i + 1;
            }
            _ => {}
        }
    }
    let last = expr[start..].trim();
    if !last.is_empty() {
        parts.push(last);
    }
    parts
}

fn build_prop_expr(prop: &str, op_str: &str, value_str: &str) -> GatherExpr {
    let op = match parse_comp_op(op_str) {
        Some(o) => o,
        None => return GatherExpr::Never,
    };
    match prop.to_ascii_lowercase().as_str() {
        "day" | "dayoffset" => value_str
            .parse::<i64>()
            .map(|n| GatherExpr::DayOffset(op, n))
            .unwrap_or(GatherExpr::Never),
        "week" | "weeknum" => value_str
            .parse::<u32>()
            .map(|n| GatherExpr::WeekNum(op, n))
            .unwrap_or(GatherExpr::Never),
        "weekday" => GatherExpr::WeekDay(op, value_str.to_ascii_lowercase()),
        "weekdaynum" => value_str
            .parse::<i32>()
            .map(|n| GatherExpr::WeekDayNum(op, n))
            .unwrap_or(GatherExpr::Never),
        "month" => {
            const MONTHS: [&str; 12] = [
                "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
            ];
            let lv = value_str.to_ascii_lowercase();
            if let Some(idx) = MONTHS.iter().position(|&m| m == lv) {
                GatherExpr::MonthNum(op, (idx + 1) as u32)
            } else {
                value_str
                    .parse::<u32>()
                    .map(|n| GatherExpr::MonthNum(op, n))
                    .unwrap_or(GatherExpr::Never)
            }
        }
        "monthnum" => value_str
            .parse::<u32>()
            .map(|n| GatherExpr::MonthNum(op, n))
            .unwrap_or(GatherExpr::Never),
        _ => GatherExpr::Never,
    }
}

/// Parse a comparison-style expression: "day<7", "week=10", "day!=0",
/// or a reversed range "0<day".
fn parse_comparison_expr(expr: &str) -> GatherExpr {
    // Reversed range: "0<day", "7>day"
    if let Some(cap) = reverse_range_regex().captures(expr) {
        let value_str = &cap[1];
        let op_str = &cap[2];
        let prop = &cap[3];
        let flipped = if op_str == "<" { ">" } else { "<" };
        return build_prop_expr(prop, flipped, value_str);
    }

    // Standard: "day<7", "week=10", "day!=3"
    if let Some(cap) = comparison_regex().captures(expr) {
        return build_prop_expr(&cap[1], &cap[2], &cap[3]);
    }

    GatherExpr::Never
}

/// Parse a temporal query content string (the part after `?.` or `?@`).
fn parse_temporal_query(query_content: &str) -> GatherExpr {
    let lc = query_content.to_ascii_lowercase();

    if lc == "today" {
        return GatherExpr::DayOffset(CompOp::Eq, 0);
    }

    // KWnn — German ISO week notation
    if let Some(rest) = lc.strip_prefix("kw") {
        if let Ok(n) = rest.parse::<u32>() {
            return GatherExpr::WeekNum(CompOp::Eq, n);
        }
    }

    // wnn — short week notation
    if lc.starts_with('w')
        && lc.len() > 1
        && lc[1..].chars().next().is_some_and(|c| c.is_ascii_digit())
    {
        if let Ok(n) = lc[1..].parse::<u32>() {
            return GatherExpr::WeekNum(CompOp::Eq, n);
        }
    }

    // Named weekday prefix: mon, tue, wed, thu, fri, sat, sun
    const WEEKDAYS: [&str; 7] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    if lc.len() >= 3 {
        if let Some(&wd) = WEEKDAYS.iter().find(|&&d| lc.starts_with(d)) {
            return GatherExpr::WeekDay(CompOp::Eq, wd.to_string());
        }
    }

    // Compound expressions with AND/OR
    parse_gather_expression(&lc)
}

/// Parse a full gather expression string, supporting AND (`&`), OR (`|`), NOT (`!`).
fn parse_gather_expression(expr: &str) -> GatherExpr {
    let expr = expr.trim();

    // OR (lowest precedence)
    let or_parts = split_by_op(expr, '|');
    if or_parts.len() > 1 {
        return GatherExpr::Or(
            or_parts
                .iter()
                .map(|p| parse_gather_expression(p))
                .collect(),
        );
    }

    // AND
    let and_parts = split_by_op(expr, '&');
    if and_parts.len() > 1 {
        return GatherExpr::And(
            and_parts
                .iter()
                .map(|p| parse_gather_expression(p))
                .collect(),
        );
    }

    // NOT
    if let Some(rest) = expr.strip_prefix('!') {
        return GatherExpr::Not(Box::new(parse_gather_expression(rest)));
    }

    // Explicit tag expression (from ?# processing)
    if let Some(tag) = expr.strip_prefix("tag_") {
        return GatherExpr::Tag(tag.to_ascii_lowercase());
    }

    // Pure word with no operators → treat as tag or person name
    if !expr.contains(|c: char| "<>=!".contains(c)) {
        return GatherExpr::Tag(expr.to_ascii_lowercase());
    }

    parse_comparison_expr(expr)
}

/// Extract gather rules from a column title.
fn parse_column_rules(title: &str) -> Vec<GatherExpr> {
    let mut exprs = Vec::new();
    for cap in query_tag_regex().captures_iter(title) {
        let type_prefix = &cap[1];
        let query_content = &cap[2];
        let expr = match type_prefix {
            "." | "@" => parse_temporal_query(query_content),
            "#" => GatherExpr::Tag(query_content.to_ascii_lowercase()),
            _ => continue,
        };
        exprs.push(expr);
    }
    exprs
}

// ── Evaluation ────────────────────────────────────────────────────────────

fn iso_week_num(date: NaiveDate) -> u32 {
    date.iso_week().week()
}

fn weekday_name(date: NaiveDate) -> &'static str {
    match date.weekday() {
        chrono::Weekday::Mon => "mon",
        chrono::Weekday::Tue => "tue",
        chrono::Weekday::Wed => "wed",
        chrono::Weekday::Thu => "thu",
        chrono::Weekday::Fri => "fri",
        chrono::Weekday::Sat => "sat",
        chrono::Weekday::Sun => "sun",
    }
}

/// Mon=1 .. Sun=7
fn weekday_num(date: NaiveDate) -> i32 {
    match date.weekday() {
        chrono::Weekday::Mon => 1,
        chrono::Weekday::Tue => 2,
        chrono::Weekday::Wed => 3,
        chrono::Weekday::Thu => 4,
        chrono::Weekday::Fri => 5,
        chrono::Weekday::Sat => 6,
        chrono::Weekday::Sun => 7,
    }
}

fn eval_expr(
    expr: &GatherExpr,
    content: &str,
    card_date: Option<NaiveDate>,
    hash_tags: &[String],
    today: NaiveDate,
) -> bool {
    match expr {
        GatherExpr::Tag(tag_name) => {
            // extract_hash_tags returns tags WITH "#" prefix (lowercased)
            let expected = format!("#{}", tag_name);
            hash_tags.contains(&expected)
        }
        GatherExpr::DayOffset(op, value) => card_date
            .map(|d| compare_i64((d - today).num_days(), *value, *op))
            .unwrap_or(false),
        GatherExpr::WeekNum(op, value) => card_date
            .map(|d| compare_i64(iso_week_num(d) as i64, *value as i64, *op))
            .unwrap_or(false),
        GatherExpr::WeekDay(op, value) => card_date
            .map(|d| {
                let day = weekday_name(d);
                match op {
                    CompOp::Eq => day == value.as_str(),
                    CompOp::Ne => day != value.as_str(),
                    _ => false,
                }
            })
            .unwrap_or(false),
        GatherExpr::WeekDayNum(op, value) => card_date
            .map(|d| compare_i64(weekday_num(d) as i64, *value as i64, *op))
            .unwrap_or(false),
        GatherExpr::MonthNum(op, value) => card_date
            .map(|d| compare_i64(d.month() as i64, *value as i64, *op))
            .unwrap_or(false),
        GatherExpr::Or(exprs) => exprs
            .iter()
            .any(|e| eval_expr(e, content, card_date, hash_tags, today)),
        GatherExpr::And(exprs) => exprs
            .iter()
            .all(|e| eval_expr(e, content, card_date, hash_tags, today)),
        GatherExpr::Not(e) => !eval_expr(e, content, card_date, hash_tags, today),
        GatherExpr::Never => false,
    }
}

// ── Utility ───────────────────────────────────────────────────────────────

/// True if the card content has a `#sticky` tag (word-boundary aware).
fn has_sticky(content: &str) -> bool {
    if let Some(idx) = content.find("#sticky") {
        let after = &content[idx + "#sticky".len()..];
        after.is_empty() || after.starts_with(|c: char| c.is_whitespace())
    } else {
        false
    }
}

fn get_card_due_date(content: &str, today: NaiveDate) -> Option<NaiveDate> {
    let temporal_tags = extract_temporal_tags(content);
    temporal_tags
        .iter()
        .filter_map(|t| parse_temporal_to_date(t, today))
        .min()
}

/// Returns hash tags that look like person names or custom tags (excludes layout tags).
fn has_person_or_custom_tags(hash_tags: &[String]) -> bool {
    static LAYOUT_PREFIXES: &[&str] = &[
        "#row",
        "#span",
        "#stack",
        "#sticky",
        "#fold",
        "#archive",
        "#hidden",
        "#sort-",
        "#ungathered",
        "#gather_",
    ];
    hash_tags
        .iter()
        .any(|tag| !LAYOUT_PREFIXES.iter().any(|prefix| tag.starts_with(prefix)))
}

fn sort_column_by_date(cards: &mut [KanbanCard], today: NaiveDate) {
    cards.sort_by(|a, b| {
        let da = get_card_due_date(&a.content, today);
        let db = get_card_due_date(&b.content, today);
        match (da, db) {
            (None, None) => std::cmp::Ordering::Equal,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (Some(_), None) => std::cmp::Ordering::Less,
            (Some(a), Some(b)) => a.cmp(&b),
        }
    });
}

fn sort_column_by_name(cards: &mut [KanbanCard]) {
    cards.sort_by(|a, b| {
        let ta = a
            .content
            .lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("");
        let tb = b
            .content
            .lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("");
        ta.cmp(tb)
    });
}

fn apply_sort_tags(board: &mut KanbanBoard, today: NaiveDate) {
    let re = sort_tag_regex();
    // Collect (col_id, sort_type) pairs first to avoid borrow issues
    let sort_ops: Vec<(String, String)> = board
        .all_columns()
        .iter()
        .flat_map(|col| {
            re.captures_iter(&col.title)
                .map(|cap| (col.id.clone(), cap[1].to_string()))
                .collect::<Vec<_>>()
        })
        .collect();

    for (col_id, sort_type) in sort_ops {
        let cols = board.all_columns_mut();
        if let Some(col) = cols.into_iter().find(|c| c.id == col_id) {
            match sort_type.as_str() {
                "bydate" => sort_column_by_date(&mut col.cards, today),
                "byname" => sort_column_by_name(&mut col.cards),
                _ => {}
            }
        }
    }
}

// ── Public API ────────────────────────────────────────────────────────────

/// Compute gather moves for a board without mutating it.
///
/// Returns the list of card moves that would be applied by [`apply_gather`].
/// Cards with `#sticky` are skipped. First-match-wins across gather rules.
pub fn compute_gather_moves(board: &KanbanBoard, today: NaiveDate) -> Vec<CardMove> {
    // Step 1: identify sticky cards
    let mut sticky_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for col in board.all_columns() {
        for card in &col.cards {
            if has_sticky(&card.content) {
                sticky_ids.insert(card.id.clone());
            }
        }
    }

    // Step 2: collect gather rules and the #ungathered column id
    let mut gather_rules: Vec<GatherRule> = Vec::new();
    let mut ungathered_col_id: Option<String> = None;

    for col in board.all_columns() {
        if col.title.contains("#ungathered") {
            ungathered_col_id = Some(col.id.clone());
        }
        for expr in parse_column_rules(&col.title) {
            gather_rules.push(GatherRule {
                target_col_id: col.id.clone(),
                expr,
            });
        }
    }

    let mut moves: Vec<CardMove> = Vec::new();
    let mut matched_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Step 3: first pass — apply gather rules (first match wins)
    for col in board.all_columns() {
        for card in &col.cards {
            if sticky_ids.contains(&card.id) {
                continue;
            }
            let card_date = get_card_due_date(&card.content, today);
            let hash_tags = extract_hash_tags(&card.content);

            for rule in &gather_rules {
                if eval_expr(&rule.expr, &card.content, card_date, &hash_tags, today) {
                    matched_ids.insert(card.id.clone());
                    if rule.target_col_id != col.id {
                        moves.push(CardMove {
                            card_id: card.id.clone(),
                            source_col_id: col.id.clone(),
                            target_col_id: rule.target_col_id.clone(),
                        });
                    }
                    break;
                }
            }
        }
    }

    // Step 4: second pass — ungathered column collects tagged-but-unmatched cards
    if let Some(ref ungathered_id) = ungathered_col_id {
        for col in board.all_columns() {
            for card in &col.cards {
                if sticky_ids.contains(&card.id) || matched_ids.contains(&card.id) {
                    continue;
                }
                let card_date = get_card_due_date(&card.content, today);
                let hash_tags = extract_hash_tags(&card.content);
                let has_relevant = card_date.is_some() || has_person_or_custom_tags(&hash_tags);

                if has_relevant && col.id != *ungathered_id {
                    moves.push(CardMove {
                        card_id: card.id.clone(),
                        source_col_id: col.id.clone(),
                        target_col_id: ungathered_id.clone(),
                    });
                }
            }
        }
    }

    moves
}

/// Apply gather to a mutable board and return the moves that were applied.
///
/// This mutates `board` in-place: cards are moved between columns and
/// columns with `#sort-bydate` / `#sort-byname` tags are sorted.
pub fn apply_gather(board: &mut KanbanBoard, today: NaiveDate) -> Vec<CardMove> {
    let moves = compute_gather_moves(board, today);

    // Phase 1: remove cards from source columns, collect them
    let mut cards_to_move: Vec<(KanbanCard, String)> = Vec::new();
    for mv in &moves {
        let cols = board.all_columns_mut();
        if let Some(src_col) = cols.into_iter().find(|c| c.id == mv.source_col_id) {
            if let Some(idx) = src_col.cards.iter().position(|c| c.id == mv.card_id) {
                let card = src_col.cards.remove(idx);
                cards_to_move.push((card, mv.target_col_id.clone()));
            }
        }
    }

    // Phase 2: push cards into target columns
    for (card, target_col_id) in cards_to_move {
        let cols = board.all_columns_mut();
        if let Some(tgt_col) = cols.into_iter().find(|c| c.id == target_col_id) {
            tgt_col.cards.push(card);
        }
    }

    // Phase 3: apply sort tags
    apply_sort_tags(board, today);

    moves
}

/// Apply gather using today's local date.
pub fn apply_gather_today(board: &mut KanbanBoard) -> Vec<CardMove> {
    apply_gather(board, Local::now().date_naive())
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{
        BoardFormat, KanbanBoard, KanbanCard, KanbanColumn, KanbanRow, KanbanStack,
    };
    use chrono::NaiveDate;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 4, 1).unwrap()
    }

    fn card(id: &str, content: &str) -> KanbanCard {
        KanbanCard {
            id: id.to_string(),
            content: content.to_string(),
            checked: false,
            kid: None,
            params: Default::default(),
        }
    }

    fn col(id: &str, title: &str, cards: Vec<KanbanCard>) -> KanbanColumn {
        KanbanColumn {
            id: id.to_string(),
            title: title.to_string(),
            cards,
            include_source: None,
            params: Default::default(),
        }
    }

    fn flat_board(columns: Vec<KanbanColumn>) -> KanbanBoard {
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

    fn hierarchical_board(rows: Vec<KanbanRow>) -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Test".to_string(),
            columns: Vec::new(),
            rows,
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::New,
        }
    }

    #[test]
    fn tag_rule_moves_matching_card() {
        let c1 = card("c1", "do work #work");
        let c2 = card("c2", "personal task #home");
        let board = flat_board(vec![
            col("inbox", "Inbox", vec![c1, c2]),
            col("work", "Work ?#work", vec![]),
        ]);
        let moves = compute_gather_moves(&board, today());
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].card_id, "c1");
        assert_eq!(moves[0].target_col_id, "work");
    }

    #[test]
    fn today_rule_matches_todays_date() {
        // today() = 2026-04-01
        let c_today = card("ct", "task @2026-04-01");
        let c_other = card("co", "task @2026-04-05");
        let board = flat_board(vec![
            col("all", "All Tasks", vec![c_today, c_other]),
            col("today", "Today ?.today", vec![]),
        ]);
        let moves = compute_gather_moves(&board, today());
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].card_id, "ct");
    }

    #[test]
    fn day_offset_future_rule() {
        // day > 0 → future cards
        let c_past = card("cp", "past @2026-03-30");
        let c_today = card("ct", "today @2026-04-01");
        let c_future = card("cf", "future @2026-04-05");
        let board = flat_board(vec![
            col("all", "All", vec![c_past, c_today, c_future]),
            col("future", "Future ?.day>0", vec![]),
        ]);
        let moves = compute_gather_moves(&board, today());
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].card_id, "cf");
    }

    #[test]
    fn sticky_card_is_not_moved() {
        let c_sticky = card("cs", "important #sticky #work");
        let c_normal = card("cn", "normal #work");
        let board = flat_board(vec![
            col("inbox", "Inbox", vec![c_sticky, c_normal]),
            col("work", "Work ?#work", vec![]),
        ]);
        let moves = compute_gather_moves(&board, today());
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].card_id, "cn");
    }

    #[test]
    fn first_match_wins() {
        let c1 = card("c1", "task #work #urgent");
        let board = flat_board(vec![
            col("inbox", "Inbox", vec![c1]),
            col("urgent", "Urgent ?#urgent", vec![]),
            col("work", "Work ?#work", vec![]),
        ]);
        let moves = compute_gather_moves(&board, today());
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].target_col_id, "urgent");
    }

    #[test]
    fn apply_gather_mutates_board() {
        let c1 = card("c1", "task #work");
        let mut board = flat_board(vec![
            col("inbox", "Inbox", vec![c1]),
            col("work", "Work ?#work", vec![]),
        ]);
        let moves = apply_gather(&mut board, today());
        assert_eq!(moves.len(), 1);
        assert_eq!(board.columns[0].cards.len(), 0);
        assert_eq!(board.columns[1].cards.len(), 1);
        assert_eq!(board.columns[1].cards[0].id, "c1");
    }

    #[test]
    fn ungathered_column_collects_tagged_unmatched() {
        let c_tagged = card("ct", "meeting @2026-04-10");
        let c_untagged = card("cu", "plain task");
        let board = flat_board(vec![
            col("inbox", "Inbox", vec![c_tagged, c_untagged]),
            col("today", "Today ?.today", vec![]),
            col("ungathered", "Later #ungathered", vec![]),
        ]);
        let moves = compute_gather_moves(&board, today());
        // c_tagged has a date but doesn't match ?.today → goes to ungathered
        // c_untagged has no tags → stays
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].card_id, "ct");
        assert_eq!(moves[0].target_col_id, "ungathered");
    }

    #[test]
    fn hierarchical_board_gather_works() {
        let c1 = card("c1", "work item #work");
        let row = KanbanRow {
            id: "r1".to_string(),
            title: "Row".to_string(),
            stacks: vec![KanbanStack {
                id: "s1".to_string(),
                title: "Stack".to_string(),
                columns: vec![
                    col("inbox", "Inbox", vec![c1]),
                    col("work", "Work ?#work", vec![]),
                ],
                params: Default::default(),
            }],
            params: Default::default(),
        };
        let mut board = hierarchical_board(vec![row]);
        let moves = apply_gather(&mut board, today());
        assert_eq!(moves.len(), 1);
        assert_eq!(board.rows[0].stacks[0].columns[0].cards.len(), 0);
        assert_eq!(board.rows[0].stacks[0].columns[1].cards[0].id, "c1");
    }

    #[test]
    fn iso_week_rule() {
        // 2026-04-01 is in ISO week 14
        let c_w14 = card("c14", "this week @2026-04-01");
        let c_w15 = card("c15", "next week @2026-04-07");
        let board = flat_board(vec![
            col("all", "All", vec![c_w14, c_w15]),
            col("w14", "Week 14 ?@week=14", vec![]),
        ]);
        let moves = compute_gather_moves(&board, today());
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].card_id, "c14");
    }
}
