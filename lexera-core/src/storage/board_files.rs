use std::collections::HashSet;
use std::fs;
use std::path::Path;

use super::StorageError;
use crate::include::{resolver, syntax};
use crate::parser;
use crate::types::{IncludeSource, KanbanBoard, KanbanColumn};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MainFileWrite {
    Written,
    SkippedUnchanged,
}

#[derive(Debug, Clone)]
pub struct PersistBoardFilesOutcome {
    pub markdown: String,
    pub main_file_write: MainFileWrite,
    pub failed_include_paths: HashSet<String>,
}

fn sync_include_sources_for_render(
    board: &mut KanbanBoard,
    board_dir: &Path,
    failed_include_paths: &HashSet<String>,
) {
    for column in board.all_columns_mut() {
        if let Some(raw_path) = syntax::extract_include_path(&column.title) {
            let resolved_path = resolver::resolve_include_path(&raw_path, board_dir);
            let missing = match column.include_source.as_ref() {
                Some(prior) if prior.raw_path == raw_path => prior.missing,
                _ => false,
            };
            column.include_source = Some(IncludeSource {
                raw_path,
                resolved_path,
                missing,
            });
        }

        if let Some(source) = column.include_source.as_mut() {
            if failed_include_paths.contains(&source.raw_path) {
                source.missing = true;
            }
        }
    }
}

pub fn render_main_markdown_for_path(
    board: &KanbanBoard,
    board_dir: &Path,
    failed_include_paths: &HashSet<String>,
) -> String {
    let mut shadow = board.clone();
    sync_include_sources_for_render(&mut shadow, board_dir, failed_include_paths);
    parser::generate_markdown(&shadow)
}

pub fn render_main_markdown(board: &KanbanBoard, failed_include_paths: &HashSet<String>) -> String {
    render_main_markdown_for_path(board, Path::new("."), failed_include_paths)
}

pub fn text_file_matches(path: &Path, content: &str) -> bool {
    path.exists()
        && fs::read_to_string(path)
            .map(|existing| existing == content)
            .unwrap_or(false)
}

pub fn persist_board_files(
    board_id: &str,
    file_path: &Path,
    board: &KanbanBoard,
    mut write_include_column: impl FnMut(&KanbanColumn) -> Result<(), StorageError>,
    mut write_main_markdown: impl FnMut(&Path, &str) -> Result<(), StorageError>,
    mut register_main_self_write: impl FnMut(&Path, &str),
) -> Result<PersistBoardFilesOutcome, StorageError> {
    let board_dir = file_path.parent().unwrap_or(Path::new("."));
    let mut board_for_persist = board.clone();
    sync_include_sources_for_render(&mut board_for_persist, board_dir, &HashSet::new());

    let mut failed_include_paths = HashSet::new();
    for column in board_for_persist.all_columns() {
        let Some(source) = column.include_source.as_ref() else {
            continue;
        };
        if let Err(error) = write_include_column(column) {
            log::warn!(
                "[lexera.storage.persist] Failed to write include column for board {} ({}): {}; falling back to inline serialization in main markdown",
                board_id,
                source.raw_path,
                error
            );
            failed_include_paths.insert(source.raw_path.clone());
        }
    }

    let markdown =
        render_main_markdown_for_path(&board_for_persist, board_dir, &failed_include_paths);
    if text_file_matches(file_path, &markdown) {
        return Ok(PersistBoardFilesOutcome {
            markdown,
            main_file_write: MainFileWrite::SkippedUnchanged,
            failed_include_paths,
        });
    }

    write_main_markdown(file_path, &markdown)?;
    register_main_self_write(file_path, &markdown);

    Ok(PersistBoardFilesOutcome {
        markdown,
        main_file_write: MainFileWrite::Written,
        failed_include_paths,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};
    use std::path::PathBuf;

    use tempfile::tempdir;

    use super::*;
    use crate::types::{BoardFormat, IncludeSource, KanbanBoard, KanbanCard, KanbanColumn};

    fn board_with_include() -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Board".to_string(),
            columns: vec![KanbanColumn {
                id: "col-1".to_string(),
                title: "Included".to_string(),
                cards: vec![KanbanCard {
                    id: "card-1".to_string(),
                    content: "Inline survivor".to_string(),
                    checked: false,
                    kid: None,
                    params: HashMap::new(),
                }],
                include_source: Some(IncludeSource::new(
                    "./slides.md".to_string(),
                    PathBuf::from("slides.md"),
                )),
                params: HashMap::new(),
            }],
            rows: Vec::new(),
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::Legacy,
        }
    }

    #[test]
    fn render_main_markdown_omits_writable_include_cards_when_include_write_succeeds() {
        let board = board_with_include();
        let failed = HashSet::new();

        let markdown = render_main_markdown(&board, &failed);

        assert!(markdown.contains("## Included"));
        assert!(!markdown.contains("Inline survivor"));
    }

    #[test]
    fn render_main_markdown_inlines_failed_include_cards_without_mutating_board() {
        let board = board_with_include();
        let mut failed = HashSet::new();
        failed.insert("./slides.md".to_string());

        let markdown = render_main_markdown(&board, &failed);

        assert!(markdown.contains("- [ ] Inline survivor"));
        assert!(
            !board.all_columns()[0]
                .include_source
                .as_ref()
                .unwrap()
                .missing
        );
    }

    #[test]
    fn text_file_matches_reports_identical_text_only() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("board.md");
        fs::write(&path, "same").unwrap();

        assert!(text_file_matches(&path, "same"));
        assert!(!text_file_matches(&path, "different"));
        assert!(!text_file_matches(&dir.path().join("missing.md"), "same"));
    }

    #[test]
    fn persist_board_files_writes_main_after_successful_includes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("board.md");
        let board = board_with_include();
        let mut include_writes = Vec::new();
        let mut main_writes = Vec::new();
        let mut self_writes = Vec::new();

        let outcome = persist_board_files(
            "board-1",
            &path,
            &board,
            |column| {
                include_writes.push(column.title.clone());
                Ok(())
            },
            |path, markdown| {
                main_writes.push((path.to_path_buf(), markdown.to_string()));
                Ok(())
            },
            |path, markdown| {
                self_writes.push((path.to_path_buf(), markdown.to_string()));
            },
        )
        .unwrap();

        assert_eq!(outcome.main_file_write, MainFileWrite::Written);
        assert!(outcome.failed_include_paths.is_empty());
        assert_eq!(include_writes, vec!["Included".to_string()]);
        assert_eq!(main_writes.len(), 1);
        assert_eq!(self_writes, main_writes);
        assert!(!outcome.markdown.contains("Inline survivor"));
    }

    #[test]
    fn persist_board_files_restores_include_source_from_title_before_writes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("board.md");
        let mut board = board_with_include();
        board.columns[0].title = "!!!include(./slides.md)!!!".to_string();
        board.columns[0].include_source = None;
        let mut wrote_include = false;

        let outcome = persist_board_files(
            "board-1",
            &path,
            &board,
            |column| {
                let source = column
                    .include_source
                    .as_ref()
                    .expect("include source must be restored before include write");
                assert_eq!(source.raw_path, "./slides.md");
                assert_eq!(source.resolved_path, dir.path().join("slides.md"));
                wrote_include = true;
                Ok(())
            },
            |_path, markdown| {
                assert!(!markdown.contains("Inline survivor"));
                Ok(())
            },
            |_path, _markdown| {},
        )
        .unwrap();

        assert!(wrote_include);
        assert!(outcome.failed_include_paths.is_empty());
        assert!(!outcome.markdown.contains("Inline survivor"));
    }

    #[test]
    fn persist_board_files_inlines_failed_includes_in_main_markdown() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("board.md");
        let board = board_with_include();
        let mut main_markdown = String::new();

        let outcome = persist_board_files(
            "board-1",
            &path,
            &board,
            |_column| Err(StorageError::InvalidBoard("include failure".to_string())),
            |_path, markdown| {
                main_markdown = markdown.to_string();
                Ok(())
            },
            |_path, _markdown| {},
        )
        .unwrap();

        assert_eq!(outcome.main_file_write, MainFileWrite::Written);
        assert!(outcome.failed_include_paths.contains("./slides.md"));
        assert!(main_markdown.contains("- [ ] Inline survivor"));
    }

    #[test]
    fn persist_board_files_skips_unchanged_main_markdown() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("board.md");
        let board = board_with_include();
        let markdown = render_main_markdown(&board, &HashSet::new());
        fs::write(&path, markdown).unwrap();
        let mut main_writes = 0;
        let mut self_writes = 0;

        let outcome = persist_board_files(
            "board-1",
            &path,
            &board,
            |_column| Ok(()),
            |_path, _markdown| {
                main_writes += 1;
                Ok(())
            },
            |_path, _markdown| {
                self_writes += 1;
            },
        )
        .unwrap();

        assert_eq!(outcome.main_file_write, MainFileWrite::SkippedUnchanged);
        assert_eq!(main_writes, 0);
        assert_eq!(self_writes, 0);
    }

    #[test]
    fn persist_board_files_does_not_register_self_write_when_main_write_fails() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("board.md");
        let board = board_with_include();
        let mut include_writes = 0;
        let mut self_writes = 0;

        let result = persist_board_files(
            "board-1",
            &path,
            &board,
            |_column| {
                include_writes += 1;
                Ok(())
            },
            |_path, _markdown| Err(StorageError::InvalidBoard("main write failed".to_string())),
            |_path, _markdown| {
                self_writes += 1;
            },
        );

        assert!(result.is_err());
        assert_eq!(include_writes, 1);
        assert_eq!(self_writes, 0);
    }
}
