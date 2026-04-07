use chrono::{Datelike, Duration, Local, NaiveDate, Weekday};
use regex::Regex;
use std::sync::OnceLock;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, Copy, Default)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub use_regex: bool,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub truncate: Option<usize>,
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
    pub links: Vec<String>,
    pub due_date: Option<NaiveDate>,
    pub is_overdue: bool,
}

impl SearchCardMeta {
    pub fn from_card(content: &str, checked: bool) -> Self {
        let hash_tags = extract_hash_tags(content);
        let temporal_tags = extract_temporal_tags(content);
        let links = extract_links(content);
        let today = Local::now().date_naive();
        let due_date = derive_due_date(&temporal_tags, today);
        let is_overdue = due_date.map(|d| d < today && !checked).unwrap_or(false);
        Self {
            hash_tags,
            temporal_tags,
            links,
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
    Link(String),
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

#[derive(Debug, Clone)]
pub struct SearchPrefilter {
    pub required_tags: Vec<String>,
    pub required_temporals: Vec<String>,
    pub required_checked: Option<bool>,
    pub required_due: Option<DueFilter>,
    pub required_due_date: Option<NaiveDate>,
    pub impossible: bool,
    pub today: NaiveDate,
    pub week_start: NaiveDate,
    pub week_end: NaiveDate,
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

    pub fn prefilter(&self) -> SearchPrefilter {
        let mut filter = SearchPrefilter {
            required_tags: Vec::new(),
            required_temporals: Vec::new(),
            required_checked: None,
            required_due: None,
            required_due_date: None,
            impossible: self.regex_invalid,
            today: self.today,
            week_start: self.week_start,
            week_end: self.week_end,
        };

        if self.regex_mode.is_some() || filter.impossible {
            return filter;
        }

        for parsed in &self.terms {
            if parsed.negate {
                continue;
            }
            match &parsed.term {
                SearchTerm::Tag(value) => {
                    if !filter.required_tags.iter().any(|tag| tag == value) {
                        filter.required_tags.push(value.clone());
                    }
                }
                SearchTerm::Temporal(value) => {
                    if !filter.required_temporals.iter().any(|tag| tag == value) {
                        filter.required_temporals.push(value.clone());
                    }
                }
                SearchTerm::IsChecked(value) => match filter.required_checked {
                    Some(existing) if existing != *value => {
                        filter.impossible = true;
                        return filter;
                    }
                    None => filter.required_checked = Some(*value),
                    _ => {}
                },
                SearchTerm::Due(mode) => {
                    if !combine_due_filter(&mut filter, Some(*mode), None) {
                        filter.impossible = true;
                        return filter;
                    }
                }
                SearchTerm::DueDate(date) => {
                    if !combine_due_filter(&mut filter, None, Some(*date)) {
                        filter.impossible = true;
                        return filter;
                    }
                }
                _ => {}
            }
        }

        if filter.required_due == Some(DueFilter::Overdue) && filter.required_checked == Some(true)
        {
            filter.impossible = true;
        }

        filter
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
            SearchTerm::Link(value) => doc
                .meta
                .links
                .iter()
                .any(|link| contains_text(link, value, self.case_sensitive)),
            SearchTerm::IsChecked(checked) => doc.checked == *checked,
            SearchTerm::Due(mode) => self.matches_due(*mode, doc),
            SearchTerm::DueDate(target) => doc.meta.due_date == Some(*target),
            SearchTerm::Regex(regex) => regex.is_match(doc.card_content),
        }
    }

    fn matches_due(&self, mode: DueFilter, doc: &SearchDocument<'_>) -> bool {
        match mode {
            DueFilter::Any => doc.meta.due_date.is_some(),
            DueFilter::Overdue => doc
                .meta
                .due_date
                .map(|d| d < self.today && !doc.checked)
                .unwrap_or(false),
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

fn combine_due_filter(
    filter: &mut SearchPrefilter,
    due_mode: Option<DueFilter>,
    due_date: Option<NaiveDate>,
) -> bool {
    if let Some(date) = due_date {
        if let Some(existing) = filter.required_due_date {
            if existing != date {
                return false;
            }
        }
        if let Some(mode) = filter.required_due {
            if !date_matches_due_filter(
                date,
                mode,
                filter.today,
                filter.week_start,
                filter.week_end,
            ) {
                return false;
            }
        }
        filter.required_due_date = Some(date);
        return true;
    }

    let Some(mode) = due_mode else {
        return true;
    };

    if let Some(date) = filter.required_due_date {
        return date_matches_due_filter(
            date,
            mode,
            filter.today,
            filter.week_start,
            filter.week_end,
        );
    }

    match filter.required_due {
        None => {
            filter.required_due = Some(mode);
            true
        }
        Some(existing) if existing == mode => true,
        Some(DueFilter::Any) => {
            filter.required_due = Some(mode);
            true
        }
        Some(existing) if mode == DueFilter::Any => {
            filter.required_due = Some(existing);
            true
        }
        _ => false,
    }
}

fn date_matches_due_filter(
    date: NaiveDate,
    mode: DueFilter,
    today: NaiveDate,
    week_start: NaiveDate,
    week_end: NaiveDate,
) -> bool {
    match mode {
        DueFilter::Any => true,
        DueFilter::Overdue => date < today,
        DueFilter::Today => date == today,
        DueFilter::Week => date >= week_start && date <= week_end,
        DueFilter::Future => date > today,
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
            "l" | "link" => Some(SearchTerm::Link(normalize_case(value, case_sensitive))),
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

pub fn extract_hash_tags(content: &str) -> Vec<String> {
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

pub fn extract_temporal_tags(content: &str) -> Vec<String> {
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

fn markdown_link_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[([^\]]*)\]\(([^)]+)\)").expect("valid markdown link regex"))
}

fn wiki_link_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\[([^\[\]]+?)\]\]").expect("valid wiki link regex"))
}

fn bare_url_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?:^|\s)(https?://[^\s>)\]]+)").expect("valid bare url regex"))
}

/// Extract all links from card content: markdown links `[text](url)`,
/// wiki links `[[target]]`, and bare URLs `https://...`.
pub fn extract_links(content: &str) -> Vec<String> {
    let mut links = Vec::new();

    // Markdown links: [text](url "optional title")
    for cap in markdown_link_regex().captures_iter(content) {
        let url = cap[2]
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_matches('"');
        if !url.is_empty() && !links.iter().any(|l: &String| l == url) {
            links.push(url.to_string());
        }
    }

    // Wiki links: [[target]] or [[target|display]]
    for cap in wiki_link_regex().captures_iter(content) {
        let inner = &cap[1];
        let target = if let Some(pipe) = inner.find('|') {
            inner[..pipe].trim()
        } else {
            inner.trim()
        };
        if !target.is_empty() && !links.iter().any(|l: &String| l == target) {
            links.push(target.to_string());
        }
    }

    // Bare URLs: https://example.com
    for cap in bare_url_regex().captures_iter(content) {
        let url = &cap[1];
        if !links.iter().any(|l: &String| l == url) {
            links.push(url.to_string());
        }
    }

    links
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

pub fn parse_temporal_to_date(raw_value: &str, today: NaiveDate) -> Option<NaiveDate> {
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
            links: vec![],
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
    fn test_search_prefilter_extracts_indexable_terms() {
        let engine = SearchEngine::compile(
            "#finance @2026w09 is:open due:week",
            SearchOptions::default(),
        );
        let filter = engine.prefilter();
        assert!(!filter.impossible);
        assert_eq!(filter.required_tags, vec!["#finance".to_string()]);
        assert_eq!(filter.required_temporals, vec!["@2026w09".to_string()]);
        assert_eq!(filter.required_checked, Some(false));
        assert_eq!(filter.required_due, Some(DueFilter::Week));
        assert_eq!(filter.required_due_date, None);
    }

    #[test]
    fn test_search_prefilter_marks_checked_overdue_as_impossible() {
        let engine = SearchEngine::compile("is:done due:overdue", SearchOptions::default());
        assert!(engine.prefilter().impossible);
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

    // ---------------------------------------------------------------
    // Unicode / accent normalization
    // ---------------------------------------------------------------

    #[test]
    fn test_unicode_normalization_cafe() {
        // "café" (with accent) should match a search for "cafe" (without accent)
        let engine = SearchEngine::compile("cafe", SearchOptions::default());
        let meta = SearchCardMeta::from_card("Visit the café", false);
        let doc = SearchDocument {
            board_title: "Board",
            column_title: "Col",
            card_content: "Visit the café",
            checked: false,
            meta: &meta,
        };
        assert!(engine.matches(&doc));
    }

    #[test]
    fn test_unicode_normalization_resume() {
        // "résumé" should match "resume"
        let engine = SearchEngine::compile("resume", SearchOptions::default());
        let meta = SearchCardMeta::from_card("Send résumé", false);
        let doc = SearchDocument {
            board_title: "Board",
            column_title: "Col",
            card_content: "Send résumé",
            checked: false,
            meta: &meta,
        };
        assert!(engine.matches(&doc));
    }

    #[test]
    fn test_unicode_normalization_tag() {
        // Tag with accent should match normalized search
        let engine = SearchEngine::compile("#résumé", SearchOptions::default());
        let meta = SearchCardMeta::from_card("Apply #resume", false);
        let doc = SearchDocument {
            board_title: "Board",
            column_title: "Col",
            card_content: "Apply #resume",
            checked: false,
            meta: &meta,
        };
        assert!(engine.matches(&doc));
    }

    #[test]
    fn test_case_sensitive_skips_normalization() {
        let opts = SearchOptions {
            case_sensitive: true,
            use_regex: false,
            ..Default::default()
        };
        let engine = SearchEngine::compile("cafe", opts);
        let meta = SearchCardMeta::from_card("Visit the café", false);
        let doc = SearchDocument {
            board_title: "Board",
            column_title: "Col",
            card_content: "Visit the café",
            checked: false,
            meta: &meta,
        };
        // case_sensitive mode does not strip accents, so "cafe" != "café"
        assert!(!engine.matches(&doc));
    }

    // ---------------------------------------------------------------
    // Regex mode edge cases
    // ---------------------------------------------------------------

    #[test]
    fn test_regex_mode_invalid_regex() {
        let opts = SearchOptions {
            case_sensitive: false,
            use_regex: true,
            ..Default::default()
        };
        let engine = SearchEngine::compile("[invalid(", opts);
        // Invalid regex => regex_invalid = true, is_empty is false
        assert!(!engine.is_empty());

        let meta = SearchCardMeta::from_card("anything", false);
        let doc = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "anything",
            checked: false,
            meta: &meta,
        };
        // Invalid regex should match nothing
        assert!(!engine.matches(&doc));
    }

    #[test]
    fn test_regex_mode_special_characters() {
        let opts = SearchOptions {
            case_sensitive: false,
            use_regex: true,
            ..Default::default()
        };
        let engine = SearchEngine::compile(r"task\s+\d+", opts);
        let meta = SearchCardMeta::from_card("task 42", false);
        let doc = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "task 42",
            checked: false,
            meta: &meta,
        };
        assert!(engine.matches(&doc));

        let meta2 = SearchCardMeta::from_card("taskABC", false);
        let doc2 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "taskABC",
            checked: false,
            meta: &meta2,
        };
        assert!(!engine.matches(&doc2));
    }

    #[test]
    fn test_regex_mode_empty_query() {
        let opts = SearchOptions {
            case_sensitive: false,
            use_regex: true,
            ..Default::default()
        };
        let engine = SearchEngine::compile("", opts);
        assert!(engine.is_empty());
    }

    #[test]
    fn test_inline_regex_term() {
        // /pattern/ syntax inside a normal (non-regex-mode) query.
        // Note: split_query_tokens treats backslash as escape, so we use a
        // regex pattern that avoids backslashes (e.g. character class [0-9]).
        let engine = SearchEngine::compile("/[0-9]{3}/", SearchOptions::default());
        let meta = SearchCardMeta::from_card("code 456", false);
        let doc = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "code 456",
            checked: false,
            meta: &meta,
        };
        assert!(engine.matches(&doc));

        let meta2 = SearchCardMeta::from_card("code AB", false);
        let doc2 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "code AB",
            checked: false,
            meta: &meta2,
        };
        assert!(!engine.matches(&doc2));
    }

    // ---------------------------------------------------------------
    // Multiple negation terms
    // ---------------------------------------------------------------

    #[test]
    fn test_multiple_negation_tags() {
        let engine = SearchEngine::compile("plan -#done -#waiting", SearchOptions::default());

        // Card with neither excluded tag => matches
        let meta1 = SearchCardMeta::from_card("plan #active", false);
        let doc1 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "plan #active",
            checked: false,
            meta: &meta1,
        };
        assert!(engine.matches(&doc1));

        // Card with #done => excluded
        let meta2 = SearchCardMeta::from_card("plan #done", false);
        let doc2 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "plan #done",
            checked: false,
            meta: &meta2,
        };
        assert!(!engine.matches(&doc2));

        // Card with #waiting => excluded
        let meta3 = SearchCardMeta::from_card("plan #waiting", false);
        let doc3 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "plan #waiting",
            checked: false,
            meta: &meta3,
        };
        assert!(!engine.matches(&doc3));

        // Card with both #done and #waiting => excluded
        let meta4 = SearchCardMeta::from_card("plan #done #waiting", false);
        let doc4 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "plan #done #waiting",
            checked: false,
            meta: &meta4,
        };
        assert!(!engine.matches(&doc4));
    }

    #[test]
    fn test_negation_text_term() {
        // Negate a plain text term
        let engine = SearchEngine::compile("task -urgent", SearchOptions::default());

        let meta1 = SearchCardMeta::from_card("task normal priority", false);
        let doc1 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "task normal priority",
            checked: false,
            meta: &meta1,
        };
        assert!(engine.matches(&doc1));

        let meta2 = SearchCardMeta::from_card("task urgent priority", false);
        let doc2 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "task urgent priority",
            checked: false,
            meta: &meta2,
        };
        assert!(!engine.matches(&doc2));
    }

    // ---------------------------------------------------------------
    // DueFilter matching
    // ---------------------------------------------------------------

    #[test]
    fn test_due_filter_overdue() {
        let engine = SearchEngine::compile("due:overdue", SearchOptions::default());

        // Card with past due date, not checked => overdue
        let meta1 = SearchCardMeta {
            hash_tags: vec![],
            temporal_tags: vec!["@2000-01-01".into()],
            links: vec![],
            due_date: NaiveDate::from_ymd_opt(2000, 1, 1),
            is_overdue: true,
        };
        let doc1 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "old task @2000-01-01",
            checked: false,
            meta: &meta1,
        };
        assert!(engine.matches(&doc1));

        // Same card but checked => not overdue
        let meta2 = SearchCardMeta {
            hash_tags: vec![],
            temporal_tags: vec!["@2000-01-01".into()],
            links: vec![],
            due_date: NaiveDate::from_ymd_opt(2000, 1, 1),
            is_overdue: false, // checked cards are not overdue
        };
        let doc2 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "old task @2000-01-01",
            checked: true,
            meta: &meta2,
        };
        assert!(!engine.matches(&doc2));
    }

    #[test]
    fn test_due_filter_any() {
        let engine = SearchEngine::compile("due:any", SearchOptions::default());

        let meta1 = SearchCardMeta {
            hash_tags: vec![],
            temporal_tags: vec!["@2030-06-01".into()],
            links: vec![],
            due_date: NaiveDate::from_ymd_opt(2030, 6, 1),
            is_overdue: false,
        };
        let doc1 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "task @2030-06-01",
            checked: false,
            meta: &meta1,
        };
        assert!(engine.matches(&doc1));

        let meta2 = SearchCardMeta {
            hash_tags: vec![],
            temporal_tags: vec![],
            links: vec![],
            due_date: None,
            is_overdue: false,
        };
        let doc2 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "task with no date",
            checked: false,
            meta: &meta2,
        };
        assert!(!engine.matches(&doc2));
    }

    #[test]
    fn test_due_filter_week_boundaries() {
        // Build an engine - week boundaries are computed from Local::now()
        // We test by constructing meta with specific due_dates and checking
        // the engine's week_start / week_end logic.
        let engine = SearchEngine::compile("due:week", SearchOptions::default());

        // A card due within this week should match
        let meta_this_week = SearchCardMeta {
            hash_tags: vec![],
            temporal_tags: vec![],
            links: vec![],
            due_date: Some(engine.week_start),
            is_overdue: false,
        };
        let doc_this_week = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "task",
            checked: false,
            meta: &meta_this_week,
        };
        assert!(engine.matches(&doc_this_week));

        // A card due at the end of the week should also match
        let meta_end_week = SearchCardMeta {
            hash_tags: vec![],
            temporal_tags: vec![],
            links: vec![],
            due_date: Some(engine.week_end),
            is_overdue: false,
        };
        let doc_end_week = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "task",
            checked: false,
            meta: &meta_end_week,
        };
        assert!(engine.matches(&doc_end_week));

        // A card due the day after the week ends should NOT match
        let meta_next_week = SearchCardMeta {
            hash_tags: vec![],
            temporal_tags: vec![],
            links: vec![],
            due_date: Some(engine.week_end + Duration::days(1)),
            is_overdue: false,
        };
        let doc_next_week = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "task",
            checked: false,
            meta: &meta_next_week,
        };
        assert!(!engine.matches(&doc_next_week));

        // A card due the day before the week starts should NOT match
        let meta_prev_week = SearchCardMeta {
            hash_tags: vec![],
            temporal_tags: vec![],
            links: vec![],
            due_date: Some(engine.week_start - Duration::days(1)),
            is_overdue: false,
        };
        let doc_prev_week = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "task",
            checked: false,
            meta: &meta_prev_week,
        };
        assert!(!engine.matches(&doc_prev_week));
    }

    #[test]
    fn test_due_filter_future() {
        let engine = SearchEngine::compile("due:future", SearchOptions::default());

        let meta1 = SearchCardMeta {
            hash_tags: vec![],
            temporal_tags: vec![],
            links: vec![],
            due_date: Some(engine.today + Duration::days(30)),
            is_overdue: false,
        };
        let doc1 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "future task",
            checked: false,
            meta: &meta1,
        };
        assert!(engine.matches(&doc1));

        // Today is NOT future
        let meta2 = SearchCardMeta {
            hash_tags: vec![],
            temporal_tags: vec![],
            links: vec![],
            due_date: Some(engine.today),
            is_overdue: false,
        };
        let doc2 = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "today task",
            checked: false,
            meta: &meta2,
        };
        assert!(!engine.matches(&doc2));
    }

    // ---------------------------------------------------------------
    // Temporal tag parsing edge cases
    // ---------------------------------------------------------------

    #[test]
    fn test_temporal_quarter_parsing() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        assert_eq!(
            parse_temporal_to_date("@q1", today),
            NaiveDate::from_ymd_opt(2026, 1, 1)
        );
        assert_eq!(
            parse_temporal_to_date("@q2", today),
            NaiveDate::from_ymd_opt(2026, 4, 1)
        );
        assert_eq!(
            parse_temporal_to_date("@q3", today),
            NaiveDate::from_ymd_opt(2026, 7, 1)
        );
        assert_eq!(
            parse_temporal_to_date("@q4", today),
            NaiveDate::from_ymd_opt(2026, 10, 1)
        );
    }

    #[test]
    fn test_temporal_quarter_with_year() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        assert_eq!(
            parse_temporal_to_date("@2025q1", today),
            NaiveDate::from_ymd_opt(2025, 1, 1)
        );
        assert_eq!(
            parse_temporal_to_date("@2027q3", today),
            NaiveDate::from_ymd_opt(2027, 7, 1)
        );
    }

    #[test]
    fn test_temporal_invalid_quarter_out_of_range() {
        // q0 and q5 should not match the quarter regex (it only allows [1-4])
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        assert_eq!(parse_temporal_to_date("@q0", today), None);
        assert_eq!(parse_temporal_to_date("@q5", today), None);
    }

    #[test]
    fn test_temporal_month_boundaries() {
        let today = NaiveDate::from_ymd_opt(2026, 6, 15).unwrap();
        // Month names produce the 1st of that month in the current year
        assert_eq!(
            parse_temporal_to_date("@jan", today),
            NaiveDate::from_ymd_opt(2026, 1, 1)
        );
        assert_eq!(
            parse_temporal_to_date("@december", today),
            NaiveDate::from_ymd_opt(2026, 12, 1)
        );
        // German month names
        assert_eq!(
            parse_temporal_to_date("@maerz", today),
            NaiveDate::from_ymd_opt(2026, 3, 1)
        );
        assert_eq!(
            parse_temporal_to_date("@okt", today),
            NaiveDate::from_ymd_opt(2026, 10, 1)
        );
    }

    #[test]
    fn test_temporal_month_with_year() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        assert_eq!(
            parse_temporal_to_date("@2025jan", today),
            NaiveDate::from_ymd_opt(2025, 1, 1)
        );
        assert_eq!(
            parse_temporal_to_date("@2027december", today),
            NaiveDate::from_ymd_opt(2027, 12, 1)
        );
    }

    #[test]
    fn test_temporal_invalid_month_name() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        // Nonsense month name should return None
        assert_eq!(parse_temporal_to_date("@notamonth", today), None);
    }

    #[test]
    fn test_temporal_today_and_tomorrow() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        assert_eq!(parse_temporal_to_date("@today", today), Some(today));
        assert_eq!(
            parse_temporal_to_date("@tomorrow", today),
            Some(today + Duration::days(1))
        );
        // German variants
        assert_eq!(parse_temporal_to_date("@heute", today), Some(today));
        assert_eq!(
            parse_temporal_to_date("@morgen", today),
            Some(today + Duration::days(1))
        );
    }

    #[test]
    fn test_temporal_explicit_date_ymd() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        assert_eq!(
            parse_temporal_to_date("@2026-06-15", today),
            NaiveDate::from_ymd_opt(2026, 6, 15)
        );
        assert_eq!(
            parse_temporal_to_date("@2026/06/15", today),
            NaiveDate::from_ymd_opt(2026, 6, 15)
        );
        assert_eq!(
            parse_temporal_to_date("@2026.06.15", today),
            NaiveDate::from_ymd_opt(2026, 6, 15)
        );
    }

    #[test]
    fn test_temporal_explicit_date_dmy() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        assert_eq!(
            parse_temporal_to_date("@15.06.2026", today),
            NaiveDate::from_ymd_opt(2026, 6, 15)
        );
        assert_eq!(
            parse_temporal_to_date("@1/3/2026", today),
            NaiveDate::from_ymd_opt(2026, 3, 1)
        );
    }

    #[test]
    fn test_temporal_invalid_date() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        // February 30 does not exist
        assert_eq!(parse_temporal_to_date("@2026-02-30", today), None);
        // Month 13 does not exist
        assert_eq!(parse_temporal_to_date("@2026-13-01", today), None);
    }

    #[test]
    fn test_temporal_empty_and_bare_at() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        assert_eq!(parse_temporal_to_date("@", today), None);
        assert_eq!(parse_temporal_to_date("", today), None);
    }

    #[test]
    fn test_temporal_iso_week() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        // ISO week: 2026-W01 starts on Monday 2025-12-29
        assert_eq!(
            parse_temporal_to_date("@2026-w01", today),
            NaiveDate::from_isoywd_opt(2026, 1, Weekday::Mon)
        );
    }

    #[test]
    fn test_temporal_kw_week() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        // German-style week: kw10
        assert_eq!(
            parse_temporal_to_date("@kw10", today),
            NaiveDate::from_isoywd_opt(2026, 10, Weekday::Mon)
        );
        assert_eq!(
            parse_temporal_to_date("@2025kw01", today),
            NaiveDate::from_isoywd_opt(2025, 1, Weekday::Mon)
        );
    }

    #[test]
    fn test_derive_due_date_picks_earliest() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let tags = vec!["@2026-06-15".to_string(), "@2026-01-10".to_string()];
        let due = derive_due_date(&tags, today);
        assert_eq!(due, NaiveDate::from_ymd_opt(2026, 1, 10));
    }

    // ---------------------------------------------------------------
    // Misc query parsing edge cases
    // ---------------------------------------------------------------

    #[test]
    fn test_board_and_column_filters() {
        let engine =
            SearchEngine::compile("board:planning col:todo task", SearchOptions::default());
        let meta = SearchCardMeta::from_card("task description", false);

        // Matching board+col+content
        let doc1 = SearchDocument {
            board_title: "Project Planning",
            column_title: "Todo List",
            card_content: "task description",
            checked: false,
            meta: &meta,
        };
        assert!(engine.matches(&doc1));

        // Wrong board
        let doc2 = SearchDocument {
            board_title: "Other",
            column_title: "Todo",
            card_content: "task description",
            checked: false,
            meta: &meta,
        };
        assert!(!engine.matches(&doc2));
    }

    #[test]
    fn test_is_checked_filter() {
        let engine = SearchEngine::compile("is:done", SearchOptions::default());
        let meta = SearchCardMeta::from_card("task", false);

        let doc_checked = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "task",
            checked: true,
            meta: &meta,
        };
        assert!(engine.matches(&doc_checked));

        let doc_unchecked = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "task",
            checked: false,
            meta: &meta,
        };
        assert!(!engine.matches(&doc_unchecked));
    }

    #[test]
    fn test_empty_query_is_empty() {
        let engine = SearchEngine::compile("", SearchOptions::default());
        assert!(engine.is_empty());
    }

    #[test]
    fn test_split_query_tokens_escaped_quote() {
        let tokens = split_query_tokens(r#"hello \"world"#);
        // The backslash escapes the quote, so it's part of the token
        assert!(tokens.iter().any(|t| t.contains('"')));
    }

    // ---------------------------------------------------------------
    // Link extraction
    // ---------------------------------------------------------------

    #[test]
    fn test_extract_links_markdown() {
        let links = extract_links("Check [Google](https://google.com) and [Docs](./readme.md)");
        assert_eq!(links.len(), 2);
        assert!(links.contains(&"https://google.com".to_string()));
        assert!(links.contains(&"./readme.md".to_string()));
    }

    #[test]
    fn test_extract_links_wiki() {
        let links = extract_links("See [[ProjectPlan]] and [[notes|My Notes]]");
        assert_eq!(links.len(), 2);
        assert!(links.contains(&"ProjectPlan".to_string()));
        assert!(links.contains(&"notes".to_string()));
    }

    #[test]
    fn test_extract_links_bare_url() {
        let links = extract_links("Visit https://example.com/page?q=1 for details");
        assert_eq!(links.len(), 1);
        assert!(links.contains(&"https://example.com/page?q=1".to_string()));
    }

    #[test]
    fn test_extract_links_dedup() {
        let links = extract_links("[a](https://x.com) and https://x.com again");
        assert_eq!(links.len(), 1);
    }

    #[test]
    fn test_extract_links_empty() {
        let links = extract_links("No links here, just text");
        assert!(links.is_empty());
    }

    // ---------------------------------------------------------------
    // Link search prefix
    // ---------------------------------------------------------------

    #[test]
    fn test_link_search_matches() {
        let engine = SearchEngine::compile("l:github.com", SearchOptions::default());
        let meta = SearchCardMeta::from_card(
            "Check [repo](https://github.com/user/repo) for updates",
            false,
        );
        let doc = SearchDocument {
            board_title: "Dev",
            column_title: "Todo",
            card_content: "Check [repo](https://github.com/user/repo) for updates",
            checked: false,
            meta: &meta,
        };
        assert!(engine.matches(&doc));
    }

    #[test]
    fn test_link_search_no_match() {
        let engine = SearchEngine::compile("l:gitlab.com", SearchOptions::default());
        let meta = SearchCardMeta::from_card("Check [repo](https://github.com/user/repo)", false);
        let doc = SearchDocument {
            board_title: "Dev",
            column_title: "Todo",
            card_content: "Check [repo](https://github.com/user/repo)",
            checked: false,
            meta: &meta,
        };
        assert!(!engine.matches(&doc));
    }

    #[test]
    fn test_link_search_wiki_link() {
        let engine = SearchEngine::compile("link:ProjectPlan", SearchOptions::default());
        let meta = SearchCardMeta::from_card("See [[ProjectPlan]] for details", false);
        let doc = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "See [[ProjectPlan]] for details",
            checked: false,
            meta: &meta,
        };
        assert!(engine.matches(&doc));
    }

    #[test]
    fn test_link_search_negation() {
        let engine = SearchEngine::compile("task -l:github.com", SearchOptions::default());
        let meta = SearchCardMeta::from_card("task with [link](https://github.com/repo)", false);
        let doc = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "task with [link](https://github.com/repo)",
            checked: false,
            meta: &meta,
        };
        assert!(!engine.matches(&doc));
    }

    #[test]
    fn test_link_search_bare_url() {
        let engine = SearchEngine::compile("l:example.com", SearchOptions::default());
        let meta = SearchCardMeta::from_card("Visit https://example.com/page", false);
        let doc = SearchDocument {
            board_title: "A",
            column_title: "B",
            card_content: "Visit https://example.com/page",
            checked: false,
            meta: &meta,
        };
        assert!(engine.matches(&doc));
    }
}
