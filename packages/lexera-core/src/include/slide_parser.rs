/// Slide-format parser for include files.
///
/// Include files use a slide format where entries are separated by `\n---\n`
/// (with surrounding blank lines). Each slide becomes one KanbanCard.
///
/// Slide format example:
/// ```text
/// # slide 1 title
///
/// slide 1 content
///
/// ---
///
/// # slide 2 title
///
/// slide 2 content
/// ```
use crate::parser::generate_id;
use crate::types::KanbanCard;

/// Parse slide-format content into cards.
/// Each slide separated by `\n---\n` (with optional surrounding blank lines) becomes one card.
pub fn parse_slides(content: &str) -> Vec<KanbanCard> {
    let content = content.replace("\r\n", "\n").replace('\r', "\n");

    if content.trim().is_empty() {
        return Vec::new();
    }

    // Split on slide separator: blank line + --- + blank line
    // Also handle: ---\n at start, or \n--- at end
    let slides = split_slides(&content);

    slides
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .map(|slide_content| {
            let trimmed = slide_content.trim().to_string();
            KanbanCard {
                id: generate_id("slide"),
                content: trimmed,
                checked: false,
                kid: None,
            }
        })
        .collect()
}

/// Split content by slide separator `---` on its own line with surrounding blank lines.
fn split_slides(content: &str) -> Vec<String> {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut slides = Vec::new();
    let mut current_lines: Vec<&str> = Vec::new();

    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim();
        if trimmed == "---" {
            // Check if this is a slide separator (preceded and/or followed by blank line)
            let prev_blank = if current_lines.is_empty() {
                true
            } else {
                current_lines.last().map_or(true, |l| l.trim().is_empty())
            };
            let next_blank = if i + 1 >= lines.len() {
                true
            } else {
                lines[i + 1].trim().is_empty()
            };

            if prev_blank || next_blank {
                // This is a slide separator
                // Remove trailing blank line from current slide
                while current_lines.last().map_or(false, |l| l.trim().is_empty()) {
                    current_lines.pop();
                }
                slides.push(current_lines.join("\n"));
                current_lines.clear();

                // Skip blank line after separator
                if i + 1 < lines.len() && lines[i + 1].trim().is_empty() {
                    i += 1;
                }
                i += 1;
                continue;
            }
        }

        current_lines.push(lines[i]);
        i += 1;
    }

    // Final slide
    while current_lines.last().map_or(false, |l| l.trim().is_empty()) {
        current_lines.pop();
    }
    if !current_lines.is_empty() {
        slides.push(current_lines.join("\n"));
    }

    slides
}

/// Generate slide-format content from cards.
pub fn generate_slides(cards: &[KanbanCard]) -> String {
    if cards.is_empty() {
        return String::new();
    }

    let mut output = String::new();
    for (i, card) in cards.iter().enumerate() {
        output.push_str(&card.content);
        if i < cards.len() - 1 {
            output.push_str("\n\n---\n\n");
        }
    }
    output.push('\n');
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_single_slide() {
        let content = "# slide 1 title\n\nslide 1 content\n";
        let cards = parse_slides(content);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].content, "# slide 1 title\n\nslide 1 content");
    }

    #[test]
    fn test_parse_two_slides() {
        let content =
            "# slide 1 title\n\nslide 1 content\n\n---\n\n# slide 2 title\n\nslide 2 content\n";
        let cards = parse_slides(content);
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].content, "# slide 1 title\n\nslide 1 content");
        assert_eq!(cards[1].content, "# slide 2 title\n\nslide 2 content");
    }

    #[test]
    fn test_parse_real_include_file() {
        // Matches root-include-1.md format from test files
        let content = "# include in ./root/root-include-1.md\n\n./root/root-include-1.md\n\nModify this line A\n\n---\n\n# second slide\n\n;; note\n";
        let cards = parse_slides(content);
        assert_eq!(cards.len(), 2);
        assert_eq!(
            cards[0].content,
            "# include in ./root/root-include-1.md\n\n./root/root-include-1.md\n\nModify this line A"
        );
        assert_eq!(cards[1].content, "# second slide\n\n;; note");
    }

    #[test]
    fn test_parse_empty_content() {
        assert!(parse_slides("").is_empty());
        assert!(parse_slides("   \n  \n").is_empty());
    }

    #[test]
    fn test_generate_slides() {
        let cards = vec![
            KanbanCard {
                id: "1".to_string(),
                content: "# Slide 1\n\ncontent 1".to_string(),
                checked: false,
                kid: None,
            },
            KanbanCard {
                id: "2".to_string(),
                content: "# Slide 2\n\ncontent 2".to_string(),
                checked: false,
                kid: None,
            },
        ];
        let output = generate_slides(&cards);
        assert_eq!(
            output,
            "# Slide 1\n\ncontent 1\n\n---\n\n# Slide 2\n\ncontent 2\n"
        );
    }

    #[test]
    fn test_roundtrip() {
        let content = "# Slide 1\n\ncontent 1\n\n---\n\n# Slide 2\n\ncontent 2\n";
        let cards = parse_slides(content);
        let regenerated = generate_slides(&cards);
        let reparsed = parse_slides(&regenerated);
        assert_eq!(cards.len(), reparsed.len());
        for (a, b) in cards.iter().zip(reparsed.iter()) {
            assert_eq!(a.content, b.content);
        }
    }

    #[test]
    fn test_generate_empty() {
        assert_eq!(generate_slides(&[]), "");
    }
}
