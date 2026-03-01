use chrono::{Datelike, Duration, Local, NaiveDate, Weekday};
use regex::Regex;
use std::sync::OnceLock;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, Copy, Default)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub use_regex: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DueFilter {
    Any,
    Overdue,
    Today,
    Week,
    Future,
}

#[derive(Debug, Clone)]
pub struct SearchCardMeta {
    pub hash_tags: Vec<String>,
    pub temporal_tags: Vec<String>,
    pub due_date: Option<NaiveDate>,
    pub is_overdue: bool,
}

impl SearchCardMeta {
    pub fn from_card(content: &str, checked: bool) -> Self {
        let hash_tags = extract_hash_tags(content);
        let temporal_tags = extract_temporal_tags(content);
        let today = Local::now().date_naive();
        let due_date = derive_due_date(&temporal_tags, today);
        let is_overdue = due_date.map(|d| d < today && !checked).unwrap_or(false);
        Self {
            hash_tags,
            temporal_tags,
            due_date,
            is_overdue,
        }
    }
}

pub struct SearchDocument<'a> {
    pub board_title: &'a str,
    pub column_title: &'a str,
    pub card_content: &'a str,
    pub checked: bool,
    pub meta: &'a SearchCardMeta,
}

#[derive(Debug)]
enum SearchTerm {
    Text(String),
    Tag(String),
    Temporal(String),
    Board(String),
    Column(String),
    IsChecked(bool),
    Due(DueFilter),
    DueDate(NaiveDate),
    Regex(Regex),
}

#[derive(Debug)]
struct ParsedTerm {
    negate: bool,
    term: SearchTerm,
}

pub struct SearchEngine {
    terms: Vec<ParsedTerm>,
    regex_mode: Option<Regex>,
    regex_invalid: bool,
    case_sensitive: bool,
    today: NaiveDate,
    week_start: NaiveDate,
    week_end: NaiveDate,
}

impl SearchEngine {
    pub fn compile(raw_query: &str, options: SearchOptions) -> Self {
        let query = raw_query.trim();
        let today = Local::now().date_naive();
        let week_start = today - Duration::days(today.weekday().num_days_from_monday() as i64);
        let week_end = week_start + Duration::days(6);

        if query.is_empty() {
            return Self {
                terms: Vec::new(),
                regex_mode: None,
                regex_invalid: false,
                case_sensitive: options.case_sensitive,
                today,
                week_start,
                week_end,
            };
        }

        if options.use_regex {
            let (regex_mode, regex_invalid) = match Regex::new(query) {
                Ok(regex) => (Some(regex), false),
                Err(_) => (None, true),
            };
            return Self {
                terms: Vec::new(),
                regex_mode,
                regex_invalid,
                case_sensitive: options.case_sensitive,
                today,
                week_start,
                week_end,
            };
        }

        let mut terms = Vec::new();
        for raw_token in split_query_tokens(query) {
            if let Some(parsed) = parse_token(raw_token, options.case_sensitive, today) {
                terms.push(parsed);
            }
        }

        Self {
            terms,
            regex_mode: None,
            regex_invalid: false,
            case_sensitive: options.case_sensitive,
            today,
            week_start,
            week_end,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.terms.is_empty() && self.regex_mode.is_none() && !self.regex_invalid
    }

    pub fn matches(&self, doc: &SearchDocument<'_>) -> bool {
        if self.regex_invalid {
            return false;
        }

        if let Some(regex) = &self.regex_mode {
            return regex.is_match(doc.card_content);
        }

        for parsed in &self.terms {
            let matched = self.matches_term(&parsed.term, doc);
            if parsed.negate {
                if matched {
                    return false;
                }
            } else if !matched {
                return false;
            }
        }
        true
    }

    fn matches_term(&self, term: &SearchTerm, doc: &SearchDocument<'_>) -> bool {
        match term {
            SearchTerm::Text(value) => contains_text(doc.card_content, value, self.case_sensitive),
            SearchTerm::Tag(value) => doc
                .meta
                .hash_tags
                .iter()
                .any(|tag| equals_text(tag, value, self.case_sensitive)),
            SearchTerm::Temporal(value) => doc.meta.temporal_tags.iter().any(|tag| {
                equals_text(tag, value, self.case_sensitive)
                    || contains_text(tag, value, self.case_sensitive)
            }),
            SearchTerm::Board(value) => contains_text(doc.board_title, value, self.case_sensitive),
            SearchTerm::Column(value) => {
                contains_text(doc.column_title, value, self.case_sensitive)
            }
            SearchTerm::IsChecked(checked) => doc.checked == *checked,
            SearchTerm::Due(mode) => self.matches_due(*mode, doc),
            SearchTerm::DueDate(target) => doc.meta.due_date == Some(*target),
            SearchTerm::Regex(regex) => regex.is_match(doc.card_content),
        }
    }

    fn matches_due(&self, mode: DueFilter, doc: &SearchDocument<'_>) -> bool {
        match mode {
            DueFilter::Any => doc.meta.due_date.is_some(),
            DueFilter::Overdue => doc.meta.is_overdue,
            DueFilter::Today => doc.meta.due_date == Some(self.today),
            DueFilter::Week => doc
                .meta
                .due_date
                .map(|d| d >= self.week_start && d <= self.week_end)
                .unwrap_or(false),
            DueFilter::Future => doc.meta.due_date.map(|d| d > self.today).unwrap_or(false),
        }
    }
}

fn split_query_tokens(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut escaped = false;

    for ch in input.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' {
            in_quotes = !in_quotes;
            if !in_quotes && !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
            continue;
        }
        if ch.is_whitespace() && !in_quotes {
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
            continue;
        }
        current.push(ch);
    }

    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn parse_token(raw_token: String, case_sensitive: bool, today: NaiveDate) -> Option<ParsedTerm> {
    let token = raw_token.trim();
    if token.is_empty() {
        return None;
    }

    let (negate, token) = if token.starts_with('-') && token.len() > 1 {
        (true, &token[1..])
    } else {
        (false, token)
    };

    if token.is_empty() {
        return None;
    }

    if token.starts_with('#') {
        return Some(ParsedTerm {
            negate,
            term: SearchTerm::Tag(normalize_hash_tag(token)),
        });
    }

    if token.starts_with('@') {
        return Some(ParsedTerm {
            negate,
            term: SearchTerm::Temporal(normalize_temporal_tag(token)),
        });
    }

    if token.starts_with('/') && token.ends_with('/') && token.len() > 2 {
        if let Ok(regex) = Regex::new(&token[1..token.len() - 1]) {
            return Some(ParsedTerm {
                negate,
                term: SearchTerm::Regex(regex),
            });
        }
    }

    if let Some((key_raw, value_raw)) = token.split_once(':') {
        let key = key_raw.to_ascii_lowercase();
        let value = value_raw.trim();
        if value.is_empty() {
            return None;
        }
        let term = match key.as_str() {
            "is" => parse_is_term(value),
            "due" => parse_due_term(value, today),
            "board" => Some(SearchTerm::Board(normalize_case(value, case_sensitive))),
            "col" | "column" => Some(SearchTerm::Column(normalize_case(value, case_sensitive))),
            "tag" => Some(SearchTerm::Tag(normalize_hash_tag(value))),
            "date" | "temporal" => Some(SearchTerm::Temporal(normalize_temporal_tag(value))),
            "re" | "regex" => Regex::new(value).ok().map(SearchTerm::Regex),
            _ => None,
        };
        if let Some(term) = term {
            return Some(ParsedTerm { negate, term });
        }
    }

    Some(ParsedTerm {
        negate,
        term: SearchTerm::Text(normalize_case(token, case_sensitive)),
    })
}

fn parse_is_term(value: &str) -> Option<SearchTerm> {
    match value.to_ascii_lowercase().as_str() {
        "open" | "todo" | "unchecked" => Some(SearchTerm::IsChecked(false)),
        "done" | "checked" | "closed" => Some(SearchTerm::IsChecked(true)),
        _ => None,
    }
}

fn parse_due_term(value: &str, today: NaiveDate) -> Option<SearchTerm> {
    let lowered = value.to_ascii_lowercase();
    match lowered.as_str() {
        "any" => Some(SearchTerm::Due(DueFilter::Any)),
        "overdue" => Some(SearchTerm::Due(DueFilter::Overdue)),
        "today" => Some(SearchTerm::Due(DueFilter::Today)),
        "week" | "thisweek" => Some(SearchTerm::Due(DueFilter::Week)),
        "future" | "upcoming" => Some(SearchTerm::Due(DueFilter::Future)),
        _ => parse_temporal_to_date(value, today).map(SearchTerm::DueDate),
    }
}

/// Unicode-aware normalization for search: lowercases, NFD-decomposes, and
/// strips combining marks (accents). This lets "resume" match "resume" etc.
fn normalize_for_search(value: &str) -> String {
    value
        .to_lowercase()
        .nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .collect()
}

fn normalize_case(value: &str, case_sensitive: bool) -> String {
    if case_sensitive {
        value.to_string()
    } else {
        normalize_for_search(value)
    }
}

fn normalize_hash_tag(value: &str) -> String {
    let mut tag = normalize_for_search(value.trim().trim_matches('"'));
    if !tag.starts_with('#') {
        tag.insert(0, '#');
    }
    tag
}

fn normalize_temporal_tag(value: &str) -> String {
    let mut tag = normalize_for_search(value.trim().trim_matches('"'));
    if !tag.starts_with('@') {
        tag.insert(0, '@');
    }
    tag
}

fn equals_text(left: &str, right: &str, case_sensitive: bool) -> bool {
    if case_sensitive {
        left == right
    } else {
        normalize_for_search(left) == normalize_for_search(right)
    }
}

fn contains_text(haystack: &str, needle: &str, case_sensitive: bool) -> bool {
    if case_sensitive {
        haystack.contains(needle)
    } else {
        normalize_for_search(haystack).contains(&normalize_for_search(needle))
    }
}

fn hash_tag_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)(?:^|\s)(#[^\s#@]+)").expect("valid hash tag regex"))
}

fn temporal_tag_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)(?:^|\s)(@[^\s]+)").expect("valid temporal tag regex"))
}

fn extract_hash_tags(content: &str) -> Vec<String> {
    let mut tags = Vec::new();
    for captures in hash_tag_regex().captures_iter(content) {
        if let Some(raw) = captures.get(1).map(|m| m.as_str()) {
            let normalized = normalize_hash_tag(raw.trim_end_matches(|c: char| ",.;)".contains(c)));
            if !tags.iter().any(|t| t == &normalized) {
                tags.push(normalized);
            }
        }
    }
    tags
}

fn extract_temporal_tags(content: &str) -> Vec<String> {
    let mut tags = Vec::new();
    for captures in temporal_tag_regex().captures_iter(content) {
        if let Some(raw) = captures.get(1).map(|m| m.as_str()) {
            let normalized =
                normalize_temporal_tag(raw.trim_end_matches(|c: char| ",.;)".contains(c)));
            if !tags.iter().any(|t| t == &normalized) {
                tags.push(normalized);
            }
        }
    }
    tags
}

fn derive_due_date(temporal_tags: &[String], today: NaiveDate) -> Option<NaiveDate> {
    temporal_tags
        .iter()
        .filter_map(|tag| parse_temporal_to_date(tag, today))
        .min()
}

fn explicit_date_regex_ymd() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$").expect("valid ymd regex")
    })
}

fn explicit_date_regex_dmy() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$").expect("valid dmy regex")
    })
}

fn week_regex_with_year() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(?:(\d{4})[-_/ ]?)?(?:kw|w|week)(\d{1,2})$").expect("valid week regex")
    })
}

fn iso_week_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(\d{4})[-_/ ]w(\d{1,2})$").expect("valid iso week regex"))
}

fn quarter_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(?:(\d{4})[-_/ ]?)?q([1-4])$").expect("valid quarter regex"))
}

fn month_with_optional_year_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(?:(\d{4})[-_/ ]?)?([a-z]{3,9})$").expect("valid month regex"))
}

fn parse_temporal_to_date(raw_value: &str, today: NaiveDate) -> Option<NaiveDate> {
    let mut token = raw_value.trim().trim_matches('"').to_ascii_lowercase();
    if token.starts_with('@') {
        token = token[1..].to_string();
    }
    if token.is_empty() {
        return None;
    }

    match token.as_str() {
        "today" | "heute" => return Some(today),
        "tomorrow" | "morgen" => return Some(today + Duration::days(1)),
        _ => {}
    }

    if let Some(caps) = explicit_date_regex_ymd().captures(&token) {
        let year = caps.get(1)?.as_str().parse::<i32>().ok()?;
        let month = caps.get(2)?.as_str().parse::<u32>().ok()?;
        let day = caps.get(3)?.as_str().parse::<u32>().ok()?;
        return NaiveDate::from_ymd_opt(year, month, day);
    }

    if let Some(caps) = explicit_date_regex_dmy().captures(&token) {
        let day = caps.get(1)?.as_str().parse::<u32>().ok()?;
        let month = caps.get(2)?.as_str().parse::<u32>().ok()?;
        let year = caps.get(3)?.as_str().parse::<i32>().ok()?;
        return NaiveDate::from_ymd_opt(year, month, day);
    }

    if let Some(caps) = iso_week_regex().captures(&token) {
        let year = caps.get(1)?.as_str().parse::<i32>().ok()?;
        let week = caps.get(2)?.as_str().parse::<u32>().ok()?;
        return NaiveDate::from_isoywd_opt(year, week, Weekday::Mon);
    }

    if let Some(caps) = week_regex_with_year().captures(&token) {
        let year = caps
            .get(1)
            .and_then(|m| m.as_str().parse::<i32>().ok())
            .unwrap_or(today.year());
        let week = caps.get(2)?.as_str().parse::<u32>().ok()?;
        return NaiveDate::from_isoywd_opt(year, week, Weekday::Mon);
    }

    if let Some(caps) = quarter_regex().captures(&token) {
        let year = caps
            .get(1)
            .and_then(|m| m.as_str().parse::<i32>().ok())
            .unwrap_or(today.year());
        let quarter = caps.get(2)?.as_str().parse::<u32>().ok()?;
        let month = (quarter - 1) * 3 + 1;
        return NaiveDate::from_ymd_opt(year, month, 1);
    }

    if let Some(caps) = month_with_optional_year_regex().captures(&token) {
        let year = caps
            .get(1)
            .and_then(|m| m.as_str().parse::<i32>().ok())
            .unwrap_or(today.year());
        let name = caps.get(2)?.as_str();
        if let Some(month) = month_from_name(name) {
            return NaiveDate::from_ymd_opt(year, month, 1);
        }
    }

    parse_weekday(&token).map(|weekday| next_weekday(today, weekday))
}

fn month_from_name(name: &str) -> Option<u32> {
    match name {
        "jan" | "january" => Some(1),
        "feb" | "february" => Some(2),
        "mar" | "march" | "mae" | "maerz" => Some(3),
        "apr" | "april" => Some(4),
        "may" | "mai" => Some(5),
        "jun" | "june" => Some(6),
        "jul" | "july" => Some(7),
        "aug" | "august" => Some(8),
        "sep" | "sept" | "september" => Some(9),
        "oct" | "okt" | "october" => Some(10),
        "nov" | "november" => Some(11),
        "dec" | "dez" | "december" => Some(12),
        _ => None,
    }
}

fn parse_weekday(token: &str) -> Option<Weekday> {
    match token {
        "mon" | "monday" | "mo" | "montag" => Some(Weekday::Mon),
        "tue" | "tues" | "tuesday" | "tu" | "di" | "dienstag" => Some(Weekday::Tue),
        "wed" | "wednesday" | "we" | "mi" | "mittwoch" => Some(Weekday::Wed),
        "thu" | "thur" | "thursday" | "th" | "do" | "donnerstag" => Some(Weekday::Thu),
        "fri" | "friday" | "fr" | "freitag" => Some(Weekday::Fri),
        "sat" | "saturday" | "sa" | "samstag" => Some(Weekday::Sat),
        "sun" | "sunday" | "su" | "so" | "sonntag" => Some(Weekday::Sun),
        _ => None,
    }
}

fn next_weekday(today: NaiveDate, target: Weekday) -> NaiveDate {
    let today_idx = today.weekday().num_days_from_monday() as i64;
    let target_idx = target.num_days_from_monday() as i64;
    let mut days = target_idx - today_idx;
    if days < 0 {
        days += 7;
    }
    today + Duration::days(days)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_query_tokens_quotes() {
        let tokens = split_query_tokens("board:planning \"exact phrase\" -#done");
        assert_eq!(tokens, vec!["board:planning", "exact phrase", "-#done"]);
    }

    #[test]
    fn test_extract_tags() {
        let meta = SearchCardMeta::from_card("Plan #Roadmap #Q1 @2024-12-01", false);
        assert!(meta.hash_tags.contains(&"#roadmap".to_string()));
        assert!(meta.hash_tags.contains(&"#q1".to_string()));
        assert!(meta.temporal_tags.contains(&"@2024-12-01".to_string()));
        assert_eq!(meta.due_date, NaiveDate::from_ymd_opt(2024, 12, 1));
    }

    #[test]
    fn test_temporal_week_parsing() {
        let today = NaiveDate::from_ymd_opt(2026, 2, 26).unwrap();
        let d = parse_temporal_to_date("@2026w09", today).unwrap();
        assert_eq!(d, NaiveDate::from_ymd_opt(2026, 2, 23).unwrap());
    }

    #[test]
    fn test_search_engine_terms() {
        let options = SearchOptions::default();
        let engine = SearchEngine::compile("#finance is:open due:overdue", options);
        let meta = SearchCardMeta {
            hash_tags: vec!["#finance".into()],
            temporal_tags: vec!["@2000-01-01".into()],
            due_date: NaiveDate::from_ymd_opt(2000, 1, 1),
            is_overdue: true,
        };
        let doc = SearchDocument {
            board_title: "Budget",
            column_title: "Todo",
            card_content: "File taxes #finance @2000-01-01",
            checked: false,
            meta: &meta,
        };
        assert!(engine.matches(&doc));
    }

    #[test]
    fn test_search_engine_negation() {
        let engine = SearchEngine::compile("plan -#done", SearchOptions::default());
        let meta = SearchCardMeta::from_card("plan #done", false);
        let doc = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "plan #done",
            checked: false,
            meta: &meta,
        };
        assert!(!engine.matches(&doc));
    }
}
