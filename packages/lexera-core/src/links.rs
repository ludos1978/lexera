/// Wiki link parsing, resolution, and validation.
///
/// Supports `[[target]]` and `[[target|display text]]` syntax.
/// Links are resolved against a base directory and optional search directories,
/// trying exact match, `.md` extension, and case-insensitive variants.
use std::path::{Path, PathBuf};

use regex::Regex;

use crate::types::KanbanBoard;

/// A parsed wiki link extracted from card content.
#[derive(Debug, Clone, PartialEq)]
pub struct WikiLink {
    /// The raw matched text including `[[` and `]]`.
    pub raw: String,
    /// The link target (file name or path).
    pub target: String,
    /// Optional display text (from `[[target|display]]` syntax).
    pub display: Option<String>,
}

/// Reference to a card's location within a board.
#[derive(Debug, Clone, PartialEq)]
pub struct CardRef {
    pub column_index: usize,
    pub column_title: String,
    pub card_index: usize,
    pub card_id: String,
}

/// A wiki link that could not be resolved to an existing file.
#[derive(Debug, Clone, PartialEq)]
pub struct BrokenLink {
    pub card_ref: CardRef,
    pub link: WikiLink,
}

/// Parse all `[[...]]` wiki links from content.
///
/// - `[[target]]` produces a WikiLink with display = None.
/// - `[[target|display text]]` produces a WikiLink with display = Some("display text").
/// - Empty `[[]]` is ignored.
/// - Nested `[[` are not matched (greedy matching stops at first `]]`).
pub fn parse_wiki_links(content: &str) -> Vec<WikiLink> {
    let re = Regex::new(r"\[\[([^\[\]]+?)\]\]").expect("wiki link regex is valid");
    let mut links = Vec::new();

    for cap in re.captures_iter(content) {
        let raw = cap[0].to_string();
        let inner = &cap[1];

        if let Some(pipe_pos) = inner.find('|') {
            let target = inner[..pipe_pos].trim().to_string();
            let display = inner[pipe_pos + 1..].trim().to_string();
            if !target.is_empty() {
                links.push(WikiLink {
                    raw,
                    target,
                    display: Some(display),
                });
            }
        } else {
            let target = inner.trim().to_string();
            if !target.is_empty() {
                links.push(WikiLink {
                    raw,
                    target,
                    display: None,
                });
            }
        }
    }

    links
}

/// Resolve a wiki link target to an actual file path.
///
/// Resolution strategy (first match wins):
/// 1. Exact match in `base_dir`: `base_dir/target`
/// 2. With `.md` extension in `base_dir`: `base_dir/target.md`
/// 3. Case-insensitive match in `base_dir`
/// 4. Repeat steps 1-3 in each directory in `search_dirs`
///
/// Returns `None` if no matching file is found.
pub fn resolve_wiki_link(
    target: &str,
    base_dir: &Path,
    search_dirs: &[PathBuf],
) -> Option<PathBuf> {
    if target.is_empty() {
        return None;
    }

    // Try base_dir first, then each search dir
    let dirs = std::iter::once(base_dir.to_path_buf()).chain(search_dirs.iter().cloned());

    for dir in dirs {
        // 1. Exact match
        let exact = dir.join(target);
        if exact.is_file() {
            return Some(exact);
        }

        // 2. With .md extension (only if target doesn't already end with .md)
        if !target.ends_with(".md") {
            let with_ext = dir.join(format!("{}.md", target));
            if with_ext.is_file() {
                return Some(with_ext);
            }
        }

        // 3. Case-insensitive match in directory
        if let Some(found) = case_insensitive_match(&dir, target) {
            return Some(found);
        }
    }

    None
}

/// Search for a case-insensitive match of `target` in `dir`.
///
/// Tries the target as-is and with `.md` extension appended.
fn case_insensitive_match(dir: &Path, target: &str) -> Option<PathBuf> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return None,
    };

    let target_lower = target.to_lowercase();
    let target_md_lower = if target.ends_with(".md") {
        None
    } else {
        Some(format!("{}.md", target_lower))
    };

    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().to_lowercase();

        if name == target_lower && entry.path().is_file() {
            return Some(entry.path());
        }
        if let Some(ref md) = target_md_lower {
            if name == *md && entry.path().is_file() {
                return Some(entry.path());
            }
        }
    }

    None
}

/// Replace wiki links in content with standard markdown links.
///
/// - `[[target]]` becomes `[target](resolved_path)` if resolved.
/// - `[[target|display]]` becomes `[display](resolved_path)` if resolved.
/// - Unresolved links are left as-is.
pub fn replace_wiki_links(content: &str, base_dir: &Path) -> String {
    let links = parse_wiki_links(content);
    if links.is_empty() {
        return content.to_string();
    }

    let mut result = content.to_string();
    // Process in reverse order to preserve string positions
    for link in links.iter().rev() {
        if let Some(resolved) = resolve_wiki_link(&link.target, base_dir, &[]) {
            let display = link.display.as_deref().unwrap_or(&link.target);
            let md_link = format!("[{}]({})", display, resolved.display());
            result = result.replacen(&link.raw, &md_link, 1);
        }
    }

    result
}

/// Find all wiki links across all cards in a board.
///
/// Returns a list of `(CardRef, WikiLink)` tuples for every wiki link found
/// in every card's content.
pub fn find_all_wiki_links_in_board(board: &KanbanBoard) -> Vec<(CardRef, WikiLink)> {
    let mut results = Vec::new();

    for (col_idx, column) in board.all_columns().iter().enumerate() {
        for (card_idx, card) in column.cards.iter().enumerate() {
            let links = parse_wiki_links(&card.content);
            for link in links {
                let card_ref = CardRef {
                    column_index: col_idx,
                    column_title: column.title.clone(),
                    card_index: card_idx,
                    card_id: card.id.clone(),
                };
                results.push((card_ref, link));
            }
        }
    }

    results
}

/// Validate all wiki links in a board and return broken (unresolvable) ones.
///
/// Each broken link includes its card location and the unresolvable WikiLink.
pub fn validate_wiki_links(board: &KanbanBoard, base_dir: &Path) -> Vec<BrokenLink> {
    let all_links = find_all_wiki_links_in_board(board);
    let mut broken = Vec::new();

    for (card_ref, link) in all_links {
        if resolve_wiki_link(&link.target, base_dir, &[]).is_none() {
            broken.push(BrokenLink { card_ref, link });
        }
    }

    broken
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{KanbanBoard, KanbanCard, KanbanColumn};
    use std::fs;
    use tempfile::tempdir;

    // ── parse_wiki_links tests ───────────────────────────────────────────

    #[test]
    fn test_parse_simple_link() {
        let links = parse_wiki_links("See [[my note]] for details.");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].raw, "[[my note]]");
        assert_eq!(links[0].target, "my note");
        assert_eq!(links[0].display, None);
    }

    #[test]
    fn test_parse_piped_link() {
        let links = parse_wiki_links("Check [[project/readme|the readme]] now.");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].raw, "[[project/readme|the readme]]");
        assert_eq!(links[0].target, "project/readme");
        assert_eq!(links[0].display, Some("the readme".to_string()));
    }

    #[test]
    fn test_parse_multiple_links() {
        let content = "Link to [[foo]] and also [[bar|Bar Page]] here.";
        let links = parse_wiki_links(content);
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target, "foo");
        assert_eq!(links[0].display, None);
        assert_eq!(links[1].target, "bar");
        assert_eq!(links[1].display, Some("Bar Page".to_string()));
    }

    #[test]
    fn test_parse_no_false_positive_regular_link() {
        let links = parse_wiki_links("A [regular](link) is not a wiki link.");
        assert!(links.is_empty());
    }

    #[test]
    fn test_parse_empty_brackets_ignored() {
        let links = parse_wiki_links("Empty [[]] should be ignored.");
        assert!(links.is_empty());
    }

    #[test]
    fn test_parse_whitespace_only_ignored() {
        let links = parse_wiki_links("Whitespace [[   ]] should be ignored.");
        assert!(links.is_empty());
    }

    #[test]
    fn test_parse_nested_brackets_not_matched() {
        // Nested [[ inside should not produce a match because the regex
        // requires no [ or ] inside the capture group
        let links = parse_wiki_links("Nested [[ [[inner]] ]] text.");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "inner");
    }

    #[test]
    fn test_parse_link_with_path() {
        let links = parse_wiki_links("See [[folder/subfolder/note]].");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "folder/subfolder/note");
    }

    #[test]
    fn test_parse_link_with_md_extension() {
        let links = parse_wiki_links("See [[notes.md]].");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "notes.md");
    }

    #[test]
    fn test_parse_link_inline_with_text() {
        let content = "Start [[link1]] middle [[link2|display]] end.";
        let links = parse_wiki_links(content);
        assert_eq!(links.len(), 2);
    }

    // ── resolve_wiki_link tests ──────────────────────────────────────────

    #[test]
    fn test_resolve_exact_match() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("notes.md");
        fs::write(&file_path, "content").unwrap();

        let result = resolve_wiki_link("notes.md", dir.path(), &[]);
        assert_eq!(result, Some(file_path));
    }

    #[test]
    fn test_resolve_with_md_extension() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("notes.md");
        fs::write(&file_path, "content").unwrap();

        let result = resolve_wiki_link("notes", dir.path(), &[]);
        assert_eq!(result, Some(file_path));
    }

    #[test]
    fn test_resolve_case_insensitive() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("MyNotes.md");
        fs::write(&file_path, "content").unwrap();

        let result = resolve_wiki_link("mynotes", dir.path(), &[]);
        assert!(result.is_some());
        // The resolved path should point to the actual file
        let resolved = result.unwrap();
        assert!(resolved.is_file());
    }

    #[test]
    fn test_resolve_case_insensitive_with_extension() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("MyNotes.md");
        fs::write(&file_path, "content").unwrap();

        let result = resolve_wiki_link("MYNOTES.MD", dir.path(), &[]);
        assert!(result.is_some());
    }

    #[test]
    fn test_resolve_in_search_dirs() {
        let base = tempdir().unwrap();
        let search1 = tempdir().unwrap();
        let file_path = search1.path().join("found.md");
        fs::write(&file_path, "content").unwrap();

        let result = resolve_wiki_link("found.md", base.path(), &[search1.path().to_path_buf()]);
        assert_eq!(result, Some(file_path));
    }

    #[test]
    fn test_resolve_base_dir_takes_priority() {
        let base = tempdir().unwrap();
        let search = tempdir().unwrap();
        let base_file = base.path().join("note.md");
        let search_file = search.path().join("note.md");
        fs::write(&base_file, "base").unwrap();
        fs::write(&search_file, "search").unwrap();

        let result = resolve_wiki_link("note.md", base.path(), &[search.path().to_path_buf()]);
        assert_eq!(result, Some(base_file));
    }

    #[test]
    fn test_resolve_first_search_dir_wins() {
        let base = tempdir().unwrap();
        let search1 = tempdir().unwrap();
        let search2 = tempdir().unwrap();
        let file1 = search1.path().join("note.md");
        let file2 = search2.path().join("note.md");
        fs::write(&file1, "first").unwrap();
        fs::write(&file2, "second").unwrap();

        let result = resolve_wiki_link(
            "note.md",
            base.path(),
            &[search1.path().to_path_buf(), search2.path().to_path_buf()],
        );
        assert_eq!(result, Some(file1));
    }

    #[test]
    fn test_resolve_unresolvable_returns_none() {
        let dir = tempdir().unwrap();
        let result = resolve_wiki_link("nonexistent", dir.path(), &[]);
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_empty_target_returns_none() {
        let dir = tempdir().unwrap();
        let result = resolve_wiki_link("", dir.path(), &[]);
        assert!(result.is_none());
    }

    // ── replace_wiki_links tests ─────────────────────────────────────────

    #[test]
    fn test_replace_resolved_simple_link() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("target.md");
        fs::write(&file_path, "content").unwrap();

        let content = "See [[target]] for more.";
        let result = replace_wiki_links(content, dir.path());
        assert!(result.contains("[target]("));
        assert!(result.contains("target.md)"));
        assert!(!result.contains("[["));
    }

    #[test]
    fn test_replace_resolved_piped_link() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("target.md");
        fs::write(&file_path, "content").unwrap();

        let content = "See [[target|my display]] for more.";
        let result = replace_wiki_links(content, dir.path());
        assert!(result.contains("[my display]("));
        assert!(result.contains("target.md)"));
    }

    #[test]
    fn test_replace_preserves_unresolved_links() {
        let dir = tempdir().unwrap();

        let content = "See [[nonexistent]] and [[also-missing|display]].";
        let result = replace_wiki_links(content, dir.path());
        assert_eq!(result, content);
    }

    #[test]
    fn test_replace_mixed_resolved_and_unresolved() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("exists.md");
        fs::write(&file_path, "content").unwrap();

        let content = "Link [[exists]] and [[missing]] here.";
        let result = replace_wiki_links(content, dir.path());
        assert!(result.contains("[exists]("));
        assert!(result.contains("[[missing]]"));
    }

    #[test]
    fn test_replace_no_links_returns_same() {
        let dir = tempdir().unwrap();
        let content = "No wiki links here.";
        let result = replace_wiki_links(content, dir.path());
        assert_eq!(result, content);
    }

    // ── find_all_wiki_links_in_board tests ───────────────────────────────

    fn make_test_board() -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Test Board".to_string(),
            columns: vec![
                KanbanColumn {
                    id: "col-0".to_string(),
                    title: "Todo".to_string(),
                    cards: vec![
                        KanbanCard {
                            id: "card-0".to_string(),
                            content: "Task with [[link1]] inside".to_string(),
                            checked: false,
                            kid: None,
                        },
                        KanbanCard {
                            id: "card-1".to_string(),
                            content: "No links here".to_string(),
                            checked: false,
                            kid: None,
                        },
                    ],
                    include_source: None,
                },
                KanbanColumn {
                    id: "col-1".to_string(),
                    title: "Done".to_string(),
                    cards: vec![KanbanCard {
                        id: "card-2".to_string(),
                        content: "Done with [[link2|Display]] and [[link3]]".to_string(),
                        checked: true,
                        kid: None,
                    }],
                    include_source: None,
                },
            ],
            rows: vec![],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: Default::default(),
        }
    }

    #[test]
    fn test_find_all_links_in_board() {
        let board = make_test_board();
        let results = find_all_wiki_links_in_board(&board);

        assert_eq!(results.len(), 3);

        // First link from card-0 in col-0
        assert_eq!(results[0].0.column_index, 0);
        assert_eq!(results[0].0.card_index, 0);
        assert_eq!(results[0].0.card_id, "card-0");
        assert_eq!(results[0].1.target, "link1");

        // Second and third links from card-2 in col-1
        assert_eq!(results[1].0.column_index, 1);
        assert_eq!(results[1].0.card_index, 0);
        assert_eq!(results[1].0.card_id, "card-2");
        assert_eq!(results[1].1.target, "link2");
        assert_eq!(results[1].1.display, Some("Display".to_string()));

        assert_eq!(results[2].0.column_index, 1);
        assert_eq!(results[2].1.target, "link3");
    }

    #[test]
    fn test_find_links_empty_board() {
        let board = KanbanBoard {
            valid: true,
            title: "Empty".to_string(),
            columns: vec![],
            rows: vec![],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: Default::default(),
        };
        let results = find_all_wiki_links_in_board(&board);
        assert!(results.is_empty());
    }

    #[test]
    fn test_find_links_no_wiki_links_in_cards() {
        let board = KanbanBoard {
            valid: true,
            title: "No Links".to_string(),
            columns: vec![KanbanColumn {
                id: "col-0".to_string(),
                title: "Col".to_string(),
                cards: vec![KanbanCard {
                    id: "card-0".to_string(),
                    content: "Just a regular card".to_string(),
                    checked: false,
                    kid: None,
                }],
                include_source: None,
            }],
            rows: vec![],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: Default::default(),
        };
        let results = find_all_wiki_links_in_board(&board);
        assert!(results.is_empty());
    }

    // ── validate_wiki_links tests ────────────────────────────────────────

    #[test]
    fn test_validate_finds_broken_links() {
        let dir = tempdir().unwrap();
        // Only create link1, leave link2 and link3 missing
        fs::write(dir.path().join("link1.md"), "content").unwrap();

        let board = make_test_board();
        let broken = validate_wiki_links(&board, dir.path());

        // link2 and link3 should be broken
        assert_eq!(broken.len(), 2);
        let targets: Vec<&str> = broken.iter().map(|b| b.link.target.as_str()).collect();
        assert!(targets.contains(&"link2"));
        assert!(targets.contains(&"link3"));
    }

    #[test]
    fn test_validate_no_broken_links() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("link1.md"), "content").unwrap();
        fs::write(dir.path().join("link2.md"), "content").unwrap();
        fs::write(dir.path().join("link3.md"), "content").unwrap();

        let board = make_test_board();
        let broken = validate_wiki_links(&board, dir.path());
        assert!(broken.is_empty());
    }

    #[test]
    fn test_validate_broken_link_has_card_location() {
        let dir = tempdir().unwrap();

        let board = KanbanBoard {
            valid: true,
            title: "Test".to_string(),
            columns: vec![KanbanColumn {
                id: "col-0".to_string(),
                title: "Todo".to_string(),
                cards: vec![KanbanCard {
                    id: "card-99".to_string(),
                    content: "See [[missing-file]]".to_string(),
                    checked: false,
                    kid: None,
                }],
                include_source: None,
            }],
            rows: vec![],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: Default::default(),
        };

        let broken = validate_wiki_links(&board, dir.path());
        assert_eq!(broken.len(), 1);
        assert_eq!(broken[0].card_ref.column_index, 0);
        assert_eq!(broken[0].card_ref.column_title, "Todo");
        assert_eq!(broken[0].card_ref.card_index, 0);
        assert_eq!(broken[0].card_ref.card_id, "card-99");
        assert_eq!(broken[0].link.target, "missing-file");
    }

    // ── Edge case tests ──────────────────────────────────────────────────

    #[test]
    fn test_parse_link_at_start_of_string() {
        let links = parse_wiki_links("[[first]] is at the start.");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "first");
    }

    #[test]
    fn test_parse_link_at_end_of_string() {
        let links = parse_wiki_links("See also [[last]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "last");
    }

    #[test]
    fn test_parse_only_link() {
        let links = parse_wiki_links("[[standalone]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "standalone");
    }

    #[test]
    fn test_parse_multiline_content() {
        let content = "Line 1 with [[link1]]\nLine 2 with [[link2|display]]";
        let links = parse_wiki_links(content);
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target, "link1");
        assert_eq!(links[1].target, "link2");
    }

    #[test]
    fn test_resolve_search_dirs_case_insensitive() {
        let base = tempdir().unwrap();
        let search = tempdir().unwrap();
        let file_path = search.path().join("MyDoc.md");
        fs::write(&file_path, "content").unwrap();

        let result = resolve_wiki_link("mydoc", base.path(), &[search.path().to_path_buf()]);
        assert!(result.is_some());
    }

    #[test]
    fn test_find_links_in_board_with_rows() {
        use crate::types::{KanbanRow, KanbanStack};

        let board = KanbanBoard {
            valid: true,
            title: "Row Board".to_string(),
            columns: vec![],
            rows: vec![KanbanRow {
                id: "row-0".to_string(),
                title: "Row 1".to_string(),
                stacks: vec![KanbanStack {
                    id: "stack-0".to_string(),
                    title: "Stack 1".to_string(),
                    columns: vec![KanbanColumn {
                        id: "col-0".to_string(),
                        title: "Col".to_string(),
                        cards: vec![KanbanCard {
                            id: "card-in-row".to_string(),
                            content: "Has [[nested-link]]".to_string(),
                            checked: false,
                            kid: None,
                        }],
                        include_source: None,
                    }],
                }],
            }],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: Default::default(),
        };

        let results = find_all_wiki_links_in_board(&board);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0.card_id, "card-in-row");
        assert_eq!(results[0].1.target, "nested-link");
    }
}
