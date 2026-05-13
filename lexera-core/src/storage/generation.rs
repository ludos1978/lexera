use crate::include::slide_parser;
use crate::parser;
use crate::types::{GenerationMeta, KanbanBoard};

pub fn normalized_content_hash(content: &str) -> String {
    use sha2::Digest;

    let mut hasher = sha2::Sha256::new();
    hasher.update(content.replace("\r\n", "\n").as_bytes());
    hex::encode(hasher.finalize())
}

pub fn board_without_generation_meta(board: &KanbanBoard) -> KanbanBoard {
    let mut normalized = board.clone();
    normalized.generation_meta = None;
    normalized
}

pub fn resolved_hash(board: &KanbanBoard) -> String {
    let board = board_without_generation_meta(board);
    let serialized =
        serde_json::to_string(&board).unwrap_or_else(|_| parser::generate_markdown(&board));
    normalized_content_hash(&serialized)
}

pub fn dependency_hash(board: &KanbanBoard) -> Option<String> {
    let mut fingerprint_parts = Vec::new();
    for column in board.all_columns() {
        let Some(include_source) = column.include_source.as_ref() else {
            continue;
        };
        fingerprint_parts.push(include_source.raw_path.clone());
        fingerprint_parts.push(slide_parser::generate_slides(&column.cards));
    }
    if fingerprint_parts.is_empty() {
        None
    } else {
        Some(normalized_content_hash(
            &fingerprint_parts.join("\n--lexera-include--\n"),
        ))
    }
}

pub fn next_generation_meta(
    current_generation: u64,
    writer_id: &str,
    board: &KanbanBoard,
) -> GenerationMeta {
    let preview_markdown = parser::generate_markdown(board);
    GenerationMeta {
        generation: Some(current_generation + 1),
        content_hash: Some(parser::body_hash(&preview_markdown)),
        dependency_hash: dependency_hash(board),
        resolved_hash: Some(resolved_hash(board)),
        writer_id: Some(writer_id.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;

    use super::*;
    use crate::types::{BoardFormat, IncludeSource, KanbanBoard, KanbanCard, KanbanColumn};

    fn board_with_card(content: &str) -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Board".to_string(),
            columns: vec![KanbanColumn {
                id: "col-1".to_string(),
                title: "Todo".to_string(),
                cards: vec![KanbanCard {
                    id: "card-1".to_string(),
                    content: content.to_string(),
                    checked: false,
                    kid: None,
                    params: HashMap::new(),
                }],
                include_source: None,
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
    fn normalized_content_hash_ignores_crlf_differences() {
        assert_eq!(
            normalized_content_hash("a\r\nb\r\n"),
            normalized_content_hash("a\nb\n")
        );
    }

    #[test]
    fn resolved_hash_ignores_generation_meta() {
        let mut first = board_with_card("Task");
        first.generation_meta = Some(GenerationMeta {
            generation: Some(1),
            content_hash: Some("a".to_string()),
            dependency_hash: Some("b".to_string()),
            resolved_hash: Some("c".to_string()),
            writer_id: Some("writer-a".to_string()),
        });
        let mut second = first.clone();
        second.generation_meta = Some(GenerationMeta {
            generation: Some(2),
            content_hash: Some("x".to_string()),
            dependency_hash: Some("y".to_string()),
            resolved_hash: Some("z".to_string()),
            writer_id: Some("writer-b".to_string()),
        });

        assert_eq!(resolved_hash(&first), resolved_hash(&second));
    }

    #[test]
    fn dependency_hash_tracks_include_content() {
        let mut board = board_with_card("Slide");
        board.columns[0].include_source = Some(IncludeSource::new(
            "./slides.md".to_string(),
            PathBuf::from("slides.md"),
        ));

        let with_slide = dependency_hash(&board).unwrap();
        board.columns[0].cards[0].content = "Changed".to_string();

        assert_ne!(with_slide, dependency_hash(&board).unwrap());
    }

    #[test]
    fn next_generation_meta_increments_and_sets_writer() {
        let board = board_with_card("Task");

        let meta = next_generation_meta(41, "writer", &board);

        assert_eq!(meta.generation, Some(42));
        assert_eq!(meta.writer_id.as_deref(), Some("writer"));
        assert!(meta.content_hash.is_some());
        assert!(meta.resolved_hash.is_some());
    }
}
