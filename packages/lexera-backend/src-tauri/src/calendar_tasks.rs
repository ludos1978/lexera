use lexera_core::types::KanbanBoard;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const NODE_TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CalendarTaskBridgePayload {
    boards: Vec<CalendarTaskBoardInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CalendarTaskBoardInput {
    board_id: String,
    board_title: String,
    file_path: String,
    columns: Vec<CalendarTaskColumnInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CalendarTaskColumnInput {
    title: String,
    column_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    row_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stack_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    col_local_index: Option<usize>,
    cards: Vec<CalendarTaskCardInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CalendarTaskCardInput {
    id: String,
    content: String,
    checked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarTaskResult {
    pub board_id: String,
    pub board_title: String,
    #[serde(default)]
    pub file_path: String,
    pub column_title: String,
    pub column_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col_local_index: Option<usize>,
    pub card_id: String,
    pub card_content: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub checked: bool,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub line_content: String,
    #[serde(default)]
    pub temporal_tag: String,
    #[serde(default)]
    pub effective_date: String,
    #[serde(default)]
    pub due_date: String,
    #[serde(default)]
    pub dtstart: String,
    #[serde(default)]
    pub dtend: String,
    #[serde(default)]
    pub time_slot: String,
    #[serde(default)]
    pub display_date: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_overdue: bool,
}

#[derive(Debug, Deserialize)]
struct CalendarTaskBridgeResponse {
    results: Vec<CalendarTaskResult>,
}

#[derive(Debug, Clone)]
pub struct CalendarTaskBoardSource {
    pub board_id: String,
    pub board_title: String,
    pub file_path: String,
    pub board: KanbanBoard,
}

fn helper_script_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../scripts")
        .join("resolve_calendar_tasks.cjs")
}

fn flatten_columns(board: &KanbanBoard) -> Vec<CalendarTaskColumnInput> {
    let mut columns = Vec::new();

    if !board.rows.is_empty() {
        let mut column_index = 0usize;
        for (row_index, row) in board.rows.iter().enumerate() {
            for (stack_index, stack) in row.stacks.iter().enumerate() {
                for (col_local_index, column) in stack.columns.iter().enumerate() {
                    columns.push(CalendarTaskColumnInput {
                        title: column.title.clone(),
                        column_index,
                        row_index: Some(row_index),
                        stack_index: Some(stack_index),
                        col_local_index: Some(col_local_index),
                        cards: column
                            .cards
                            .iter()
                            .map(|card| CalendarTaskCardInput {
                                id: card.id.clone(),
                                content: card.content.clone(),
                                checked: card.checked,
                            })
                            .collect(),
                    });
                    column_index += 1;
                }
            }
        }
        return columns;
    }

    for (column_index, column) in board.columns.iter().enumerate() {
        columns.push(CalendarTaskColumnInput {
            title: column.title.clone(),
            column_index,
            row_index: None,
            stack_index: None,
            col_local_index: None,
            cards: column
                .cards
                .iter()
                .map(|card| CalendarTaskCardInput {
                    id: card.id.clone(),
                    content: card.content.clone(),
                    checked: card.checked,
                })
                .collect(),
        });
    }

    columns
}

pub async fn resolve_calendar_tasks(
    boards: Vec<CalendarTaskBoardSource>,
) -> Result<Vec<CalendarTaskResult>, String> {
    let payload = CalendarTaskBridgePayload {
        boards: boards
            .into_iter()
            .map(|board| CalendarTaskBoardInput {
                board_id: board.board_id,
                board_title: board.board_title,
                file_path: board.file_path,
                columns: flatten_columns(&board.board),
            })
            .collect(),
    };

    let script_path = helper_script_path();
    if !script_path.is_file() {
        return Err(format!(
            "Calendar task bridge script not found at {}",
            script_path.display()
        ));
    }

    let input =
        serde_json::to_vec(&payload).map_err(|e| format!("Failed to serialize payload: {}", e))?;

    let mut child = Command::new("node")
        .arg(&script_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn node bridge: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(&input)
            .await
            .map_err(|e| format!("Failed to write bridge input: {}", e))?;
    }

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(NODE_TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| {
        format!(
            "Calendar task bridge timed out after {}s",
            NODE_TIMEOUT_SECS
        )
    })?
    .map_err(|e| format!("Calendar task bridge failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!(
                "Calendar task bridge exited with status {}",
                output.status
            )
        } else {
            stderr
        });
    }

    let response: CalendarTaskBridgeResponse = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse bridge response: {}", e))?;

    Ok(response.results)
}

#[cfg(test)]
mod tests {
    use super::{resolve_calendar_tasks, CalendarTaskBoardSource};
    use lexera_core::parser::parse_markdown;

    #[tokio::test]
    async fn resolve_calendar_tasks_matches_shared_hierarchy_resolution() {
        let markdown = "\
---
kanban-plugin: board
---

## Todo
- [ ] Planning parent !2026-03-20
  - Prepare slides !09:00-10:00
- [ ] Review release !2000-01-01
";
        let board = parse_markdown(markdown);
        let results = resolve_calendar_tasks(vec![CalendarTaskBoardSource {
            board_id: "board-a".to_string(),
            board_title: board.title.clone(),
            file_path: "/tmp/board-a.md".to_string(),
            board,
        }])
        .await
        .expect("calendar task resolution should succeed");

        assert_eq!(results.len(), 3);

        let timed = results
            .iter()
            .find(|item| item.summary == "Prepare slides")
            .expect("timed child task should be present");
        assert_eq!(timed.board_id, "board-a");
        assert_eq!(timed.due_date, "2026-03-20");
        assert_eq!(timed.time_slot, "@09:00-10:00");

        let overdue = results
            .iter()
            .find(|item| item.summary == "Review release")
            .expect("overdue task should be present");
        assert_eq!(overdue.due_date, "2000-01-01");
        assert!(overdue.is_overdue);
    }
}
