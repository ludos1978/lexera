//! Bidirectional XBEL XML <-> `KanbanColumn` / `KanbanCard` mapper.
//!
//! XBEL (XML Bookmark Exchange Language) is the format Floccus uses over WebDAV.
//!
//! Mapping rules:
//!   - Each XBEL folder with bookmarks <-> one kanban column titled with its full
//!     " / " folder path.
//!   - Each `<bookmark>` <-> one card as `[Title](url "xbel-id")` (the XBEL ID is
//!     stored inside the markdown link title attribute).
//!   - Consecutive columns that share the two topmost folder segments get a
//!     trailing `#stack` tag for visual grouping in the kanban board.
//!
//! Folders are flattened: "Bookmarks Bar / Shopping / Deals" becomes a column
//! title. Cards without links in a synced column are preserved by the merger but
//! invisible to Floccus.
//!
//! Port of `_ARCHIVE/packages/ludos-sync/src/mappers/XbelMapper.ts`.

use std::collections::HashMap;

use quick_xml::escape::{escape, unescape};
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::reader::Reader;
use quick_xml::writer::Writer;
use regex::Regex;
use std::io::Cursor;
use std::sync::OnceLock;

use crate::types::{is_archived_or_deleted, KanbanCard, KanbanColumn};

// ---------------------------------------------------------------------------
// Data model for the XBEL tree
// ---------------------------------------------------------------------------

/// One `<bookmark>` entry in an XBEL document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct XbelBookmark {
    pub id: String,
    pub title: String,
    pub href: String,
    pub description: Option<String>,
}

/// One `<folder>` entry in an XBEL document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct XbelFolder {
    pub id: String,
    pub title: String,
    pub bookmarks: Vec<XbelBookmark>,
    pub children: Vec<XbelFolder>,
}

/// Root of a parsed XBEL document.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct XbelRoot {
    pub folders: Vec<XbelFolder>,
}

// ---------------------------------------------------------------------------
// Parse errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum XbelError {
    #[error("XML parse error: {0}")]
    Xml(#[from] quick_xml::Error),
    #[error("XML attribute error: {0}")]
    Attr(#[from] quick_xml::events::attributes::AttrError),
    #[error("XML encoding error: {0}")]
    Encoding(#[from] quick_xml::encoding::EncodingError),
    #[error("XML escape error: {0}")]
    Escape(#[from] quick_xml::escape::EscapeError),
    #[error("UTF-8 error: {0}")]
    Utf8(#[from] std::str::Utf8Error),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

// ---------------------------------------------------------------------------
// Link regex — single link per task with optional xbel-id title.
// ---------------------------------------------------------------------------

/// Match `[Title](url "xbel-id")` or `[Title](url)` at the start of a line,
/// allowing trailing content after the closing parenthesis.
fn link_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"^\[([^\]]*)\]\(([^)"]+)(?:\s+"([^"]*)")?\)(.*)$"#)
            .expect("valid xbel link regex")
    })
}

// ---------------------------------------------------------------------------
// Parse XBEL XML → tree
// ---------------------------------------------------------------------------

/// Parse an XBEL XML string into a tree of `XbelFolder` nodes.
///
/// Preserves nested folder hierarchy. Root-level `<bookmark>` elements (direct
/// children of `<xbel>`) are collected into an `Unsorted` folder so they still
/// surface through `xbel_to_columns`.
pub fn parse_xbel(xml: &str) -> Result<XbelRoot, XbelError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    // Walk to the opening `<xbel>` element, then hand off to parse_children.
    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) if e.local_name().as_ref() == b"xbel" => {
                let (root_bookmarks, folders) = parse_children(&mut reader)?;
                let mut result = XbelRoot {
                    folders: Vec::new(),
                };
                if !root_bookmarks.is_empty() {
                    result.folders.push(XbelFolder {
                        id: "root-unsorted".to_string(),
                        title: "Unsorted".to_string(),
                        bookmarks: root_bookmarks,
                        children: Vec::new(),
                    });
                }
                result.folders.extend(folders);
                return Ok(result);
            }
            Event::Eof => return Ok(XbelRoot::default()),
            _ => {}
        }
        buf.clear();
    }
}

/// Parse children of a `<folder>` or `<xbel>` element until its matching end
/// tag. Returns `(bookmarks_in_this_level, child_folders)`.
fn parse_children(
    reader: &mut Reader<&[u8]>,
) -> Result<(Vec<XbelBookmark>, Vec<XbelFolder>), XbelError> {
    let mut bookmarks = Vec::new();
    let mut folders = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) => {
                let name = e.local_name();
                match name.as_ref() {
                    b"folder" => {
                        let id = attribute_value(&e, "id")?;
                        let folder = parse_folder_body(reader, id)?;
                        folders.push(folder);
                    }
                    b"bookmark" => {
                        let id = attribute_value(&e, "id")?;
                        let href = attribute_value(&e, "href")?;
                        let bm = parse_bookmark_body(reader, id, href)?;
                        bookmarks.push(bm);
                    }
                    // Skip unknown elements and their contents.
                    _ => skip_element(reader, e.name().as_ref().to_vec())?,
                }
            }
            Event::End(_) | Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    Ok((bookmarks, folders))
}

/// Parse the body of a `<folder>` element (title, nested folders, bookmarks).
fn parse_folder_body(reader: &mut Reader<&[u8]>, id: String) -> Result<XbelFolder, XbelError> {
    let mut title = String::new();
    let mut bookmarks = Vec::new();
    let mut children = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) => {
                let name = e.local_name();
                match name.as_ref() {
                    b"title" => {
                        title = read_text(reader)?;
                    }
                    b"folder" => {
                        let sub_id = attribute_value(&e, "id")?;
                        let sub = parse_folder_body(reader, sub_id)?;
                        children.push(sub);
                    }
                    b"bookmark" => {
                        let bm_id = attribute_value(&e, "id")?;
                        let bm_href = attribute_value(&e, "href")?;
                        let bm = parse_bookmark_body(reader, bm_id, bm_href)?;
                        bookmarks.push(bm);
                    }
                    _ => skip_element(reader, e.name().as_ref().to_vec())?,
                }
            }
            Event::End(_) | Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    Ok(XbelFolder {
        id,
        title,
        bookmarks,
        children,
    })
}

/// Parse the body of a `<bookmark>` element (title and optional description).
fn parse_bookmark_body(
    reader: &mut Reader<&[u8]>,
    id: String,
    href: String,
) -> Result<XbelBookmark, XbelError> {
    let mut title = String::new();
    let mut description: Option<String> = None;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) => {
                let name = e.local_name();
                match name.as_ref() {
                    b"title" => {
                        title = read_text(reader)?;
                    }
                    b"desc" => {
                        let text = read_text(reader)?;
                        if !text.is_empty() {
                            description = Some(text);
                        }
                    }
                    _ => skip_element(reader, e.name().as_ref().to_vec())?,
                }
            }
            Event::End(_) | Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    Ok(XbelBookmark {
        id,
        title,
        href,
        description,
    })
}

/// Read the concatenated text content until the next end tag.
fn read_text(reader: &mut Reader<&[u8]>) -> Result<String, XbelError> {
    let mut out = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Text(t) => {
                let decoded = t.decode()?;
                let unescaped = unescape(&decoded)?;
                out.push_str(&unescaped);
            }
            Event::CData(t) => {
                out.push_str(std::str::from_utf8(&t.into_inner())?);
            }
            Event::End(_) | Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    Ok(out.trim().to_string())
}

/// Skip the current element and any of its descendants until the matching
/// end tag.
fn skip_element(reader: &mut Reader<&[u8]>, name: Vec<u8>) -> Result<(), XbelError> {
    let mut depth = 1usize;
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) if e.name().as_ref() == name.as_slice() => {
                depth += 1;
            }
            Event::End(e) if e.name().as_ref() == name.as_slice() => {
                depth -= 1;
                if depth == 0 {
                    return Ok(());
                }
            }
            Event::Eof => return Ok(()),
            _ => {}
        }
        buf.clear();
    }
}

/// Extract an attribute value from a `BytesStart` element, returning the empty
/// string if the attribute is missing. Ported from the TS mapper which uses
/// `(bm['@_id'] as string) || ''`.
fn attribute_value(e: &BytesStart<'_>, key: &str) -> Result<String, XbelError> {
    for attr in e.attributes() {
        let attr = attr?;
        if attr.key.as_ref() == key.as_bytes() {
            let decoded = attr.decode_and_unescape_value(Reader::from_str("").decoder())?;
            return Ok(decoded.into_owned());
        }
    }
    Ok(String::new())
}

// ---------------------------------------------------------------------------
// Generate XBEL XML from the tree
// ---------------------------------------------------------------------------

/// Serialise an `XbelRoot` as an XBEL XML document with a standard declaration.
pub fn generate_xbel(root: &XbelRoot) -> Result<String, XbelError> {
    let mut writer = Writer::new_with_indent(Cursor::new(Vec::new()), b' ', 2);
    writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))?;

    let mut xbel_start = BytesStart::new("xbel");
    xbel_start.push_attribute(("version", "1.0"));
    writer.write_event(Event::Start(xbel_start))?;

    for folder in &root.folders {
        write_folder(&mut writer, folder)?;
    }

    writer.write_event(Event::End(BytesEnd::new("xbel")))?;

    let bytes = writer.into_inner().into_inner();
    Ok(String::from_utf8(bytes).expect("quick-xml writer produces valid UTF-8"))
}

fn write_folder(
    writer: &mut Writer<Cursor<Vec<u8>>>,
    folder: &XbelFolder,
) -> Result<(), XbelError> {
    let mut start = BytesStart::new("folder");
    if !folder.id.is_empty() {
        start.push_attribute(("id", folder.id.as_str()));
    }
    writer.write_event(Event::Start(start))?;

    // <title>…</title>
    write_text_element(writer, "title", &folder.title)?;

    for bm in &folder.bookmarks {
        write_bookmark(writer, bm)?;
    }

    for child in &folder.children {
        write_folder(writer, child)?;
    }

    writer.write_event(Event::End(BytesEnd::new("folder")))?;
    Ok(())
}

fn write_bookmark(
    writer: &mut Writer<Cursor<Vec<u8>>>,
    bm: &XbelBookmark,
) -> Result<(), XbelError> {
    let mut start = BytesStart::new("bookmark");
    start.push_attribute(("href", bm.href.as_str()));
    if !bm.id.is_empty() {
        start.push_attribute(("id", bm.id.as_str()));
    }
    writer.write_event(Event::Start(start))?;

    write_text_element(writer, "title", &bm.title)?;
    if let Some(desc) = &bm.description {
        if !desc.is_empty() {
            write_text_element(writer, "desc", desc)?;
        }
    }

    writer.write_event(Event::End(BytesEnd::new("bookmark")))?;
    Ok(())
}

fn write_text_element(
    writer: &mut Writer<Cursor<Vec<u8>>>,
    tag: &str,
    text: &str,
) -> Result<(), XbelError> {
    writer.write_event(Event::Start(BytesStart::new(tag)))?;
    // `escape` handles the XML text escaping for < > & etc.
    writer.write_event(Event::Text(BytesText::from_escaped(escape(text))))?;
    writer.write_event(Event::End(BytesEnd::new(tag)))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// XBEL tree ↔ Kanban columns
// ---------------------------------------------------------------------------

/// Convert an `XbelRoot` into a flat list of `KanbanColumn`.
///
/// Each folder with bookmarks becomes one column titled with its full
/// `" / "` folder path. Consecutive columns that share the two topmost path
/// segments receive a `#stack` trailing tag so the kanban UI groups them.
pub fn xbel_to_columns(root: &XbelRoot) -> Vec<KanbanColumn> {
    let mut flat_entries: Vec<(String, &[XbelBookmark])> = Vec::new();
    for folder in &root.folders {
        flatten_folder_tree(folder, &folder.title, &mut flat_entries);
    }

    let mut columns = Vec::with_capacity(flat_entries.len());
    let mut prev_stack_key = String::new();

    for (i, (path, bookmarks)) in flat_entries.iter().enumerate() {
        let segments: Vec<&str> = path.split(" / ").collect();
        let stack_key = segments
            .iter()
            .take(2)
            .copied()
            .collect::<Vec<_>>()
            .join(" / ");
        let needs_stack = stack_key == prev_stack_key;
        let title = if needs_stack {
            format!("{} #stack", path)
        } else {
            path.clone()
        };

        let cards: Vec<KanbanCard> = bookmarks
            .iter()
            .enumerate()
            .map(|(bm_idx, bm)| KanbanCard {
                id: format!("sync-task-{}-{}", i, bm_idx),
                content: bookmark_to_task_content(bm),
                checked: false,
                kid: None,
                params: HashMap::new(),
            })
            .collect();

        columns.push(KanbanColumn {
            id: format!("sync-col-{}", i),
            title,
            cards,
            include_source: None,
            params: HashMap::new(),
        });

        prev_stack_key = stack_key;
    }

    columns
}

/// Depth-first walk collecting `(full_path, bookmarks)` for every folder that
/// owns direct bookmarks. Matches the TS `flattenFolderTree` behaviour.
fn flatten_folder_tree<'a>(
    folder: &'a XbelFolder,
    current_path: &str,
    out: &mut Vec<(String, &'a [XbelBookmark])>,
) {
    if !folder.bookmarks.is_empty() {
        out.push((current_path.to_string(), &folder.bookmarks));
    }
    for child in &folder.children {
        let next_path = format!("{} / {}", current_path, child.title);
        flatten_folder_tree(child, &next_path, out);
    }
}

/// Format a single bookmark as card content.
fn bookmark_to_task_content(bm: &XbelBookmark) -> String {
    let link = format!("[{}]({} \"{}\")", bm.title, bm.href, bm.id);
    match &bm.description {
        Some(desc) if !desc.is_empty() => format!("{}\n{}", link, desc),
        _ => link,
    }
}

/// Convert kanban columns into an `XbelRoot`. Columns with `" / "` in their
/// titles are grouped by their top-level folder and nested accordingly.
/// Archived/deleted columns and cards are skipped.
pub fn columns_to_xbel(columns: &[KanbanColumn]) -> XbelRoot {
    let mut top_folder_map: HashMap<String, XbelFolder> = HashMap::new();
    let mut top_folder_order: Vec<String> = Vec::new();

    for column in columns {
        if is_archived_or_deleted(&column.title) {
            continue;
        }

        let folder_path = extract_folder_path(&column.title);
        if folder_path.is_empty() {
            continue;
        }

        let segments: Vec<&str> = folder_path.split(" / ").collect();
        let top_name = segments[0].to_string();

        if !top_folder_map.contains_key(&top_name) {
            let slug = top_name.to_lowercase().replace(char::is_whitespace, "-");
            top_folder_map.insert(
                top_name.clone(),
                XbelFolder {
                    id: format!("folder-{}", slug),
                    title: top_name.clone(),
                    bookmarks: Vec::new(),
                    children: Vec::new(),
                },
            );
            top_folder_order.push(top_name.clone());
        }

        // Collect bookmarks for this column.
        let mut bookmarks: Vec<XbelBookmark> = Vec::new();
        let mut counter = 0usize;
        for card in &column.cards {
            if is_archived_or_deleted(&card.content) {
                continue;
            }
            if let Some(bm) = task_content_to_bookmark(&card.content, counter) {
                bookmarks.push(bm);
                counter += 1;
            }
        }

        if bookmarks.is_empty() {
            continue;
        }

        // Insert into the already-existing top folder.
        let top_folder = top_folder_map
            .get_mut(&top_name)
            .expect("top folder just inserted");
        if segments.len() == 1 {
            top_folder.bookmarks.extend(bookmarks);
        } else {
            let rest: Vec<String> = segments[1..].iter().map(|s| s.to_string()).collect();
            insert_bookmarks_at_path(top_folder, &rest, bookmarks);
        }
    }

    let folders = top_folder_order
        .into_iter()
        .map(|name| top_folder_map.remove(&name).expect("ordered name exists"))
        .collect();

    XbelRoot { folders }
}

/// Parse task content as a single bookmark link. Returns `None` when the first
/// line does not match the link pattern.
fn task_content_to_bookmark(content: &str, fallback_idx: usize) -> Option<XbelBookmark> {
    if content.is_empty() {
        return None;
    }
    let first_line = content.lines().next()?.trim();
    let caps = link_regex().captures(first_line)?;
    let title = caps
        .get(1)
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    let href = caps
        .get(2)
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    let id = caps
        .get(3)
        .map(|m| m.as_str().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("bm-auto-{}", fallback_idx));

    // Description = remaining non-empty lines.
    let description_lines: Vec<String> = content
        .lines()
        .skip(1)
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let description = if description_lines.is_empty() {
        None
    } else {
        Some(description_lines.join("\n"))
    };

    Some(XbelBookmark {
        id,
        title,
        href,
        description,
    })
}

/// Walk `root` creating sub-folders as needed and append `bookmarks` at the
/// deepest node. Matches the TS `insertBookmarksAtPath` helper.
fn insert_bookmarks_at_path(
    root: &mut XbelFolder,
    segments: &[String],
    bookmarks: Vec<XbelBookmark>,
) {
    // We need to walk segments iteratively, returning a `&mut` to the
    // leaf child. Using a loop with manual index search keeps the borrow
    // checker happy.
    let mut path_parts: Vec<String> = vec![root.title.clone()];
    let mut current: &mut XbelFolder = root;

    for segment in segments {
        path_parts.push(segment.clone());

        let existing_idx = current.children.iter().position(|c| c.title == *segment);
        match existing_idx {
            Some(idx) => {
                current = &mut current.children[idx];
            }
            None => {
                let slug = path_parts
                    .join("-")
                    .to_lowercase()
                    .replace(char::is_whitespace, "-");
                current.children.push(XbelFolder {
                    id: format!("folder-{}", slug),
                    title: segment.clone(),
                    bookmarks: Vec::new(),
                    children: Vec::new(),
                });
                let last = current.children.len() - 1;
                current = &mut current.children[last];
            }
        }
    }

    current.bookmarks.extend(bookmarks);
}

/// Strip `#tags` from a column title to recover the folder path.
/// `"Bookmarks Bar / Shopping #stack"` → `"Bookmarks Bar / Shopping"`.
pub fn extract_folder_path(title: &str) -> String {
    if title.is_empty() {
        return String::new();
    }
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\s+#\S+").expect("valid tag strip regex"));
    re.replace_all(title, "").trim().to_string()
}

/// Extract the `xbel-id` from a card whose first line is a markdown link with
/// a quoted title. Returns `None` for plain text or links without an id.
pub fn extract_xbel_id(content: &str) -> Option<String> {
    if content.is_empty() {
        return None;
    }
    let first_line = content.lines().next()?.trim();
    let caps = link_regex().captures(first_line)?;
    caps.get(3)
        .map(|m| m.as_str().to_string())
        .filter(|s| !s.is_empty())
}

// ---------------------------------------------------------------------------
// Merge incoming XBEL into an existing set of columns
// ---------------------------------------------------------------------------

/// Merge an incoming `XbelRoot` into an existing set of columns.
///
/// - Columns are matched by folder path (title stripped of `#tags`).
/// - Within matched columns, cards are matched by `xbel-id`; unmatched cards
///   keep their existing kanban id so locally-added notes without links are
///   preserved.
/// - Columns in `existing` that are not mentioned by the incoming data are
///   preserved as-is.
pub fn merge_xbel_into_columns(
    incoming: &XbelRoot,
    existing: &[KanbanColumn],
) -> Vec<KanbanColumn> {
    let mut result: Vec<KanbanColumn> = Vec::new();
    let mut existing_by_path: HashMap<String, KanbanColumn> = HashMap::new();
    let mut existing_order: Vec<String> = Vec::new();

    for col in existing {
        let path = extract_folder_path(&col.title);
        existing_order.push(path.clone());
        existing_by_path.insert(path, col.clone());
    }

    let incoming_columns = xbel_to_columns(incoming);

    for incoming_col in incoming_columns {
        let incoming_path = extract_folder_path(&incoming_col.title);

        if let Some(existing_col) = existing_by_path.remove(&incoming_path) {
            // Build an id index of existing cards that carry an xbel-id.
            let mut existing_by_xbel_id: HashMap<String, KanbanCard> = HashMap::new();
            let mut cards_without_links: Vec<KanbanCard> = Vec::new();

            for card in existing_col.cards {
                if let Some(id) = extract_xbel_id(&card.content) {
                    existing_by_xbel_id.insert(id, card);
                } else {
                    cards_without_links.push(card);
                }
            }

            let mut merged_cards: Vec<KanbanCard> =
                Vec::with_capacity(incoming_col.cards.len() + cards_without_links.len());

            for in_card in incoming_col.cards {
                let xbel_id = extract_xbel_id(&in_card.content);
                let existing = xbel_id
                    .as_ref()
                    .and_then(|id| existing_by_xbel_id.remove(id));
                let id = match existing {
                    Some(c) => c.id,
                    None => in_card.id.clone(),
                };
                merged_cards.push(KanbanCard {
                    id,
                    content: in_card.content,
                    checked: in_card.checked,
                    kid: in_card.kid,
                    params: in_card.params,
                });
            }

            // Preserve cards that don't carry xbel-ids.
            merged_cards.extend(cards_without_links);

            result.push(KanbanColumn {
                id: existing_col.id,
                title: incoming_col.title,
                cards: merged_cards,
                include_source: existing_col.include_source,
                params: existing_col.params,
            });
        } else {
            result.push(incoming_col);
        }
    }

    // Preserve non-synced columns in their original order.
    for path in existing_order {
        if let Some(col) = existing_by_path.remove(&path) {
            result.push(col);
        }
    }

    result
}

// ---------------------------------------------------------------------------
// Tests — ported from XbelMapper.test.ts
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const FLAT_XBEL: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <folder id="folder-1">
    <title>Dev Resources</title>
    <bookmark href="https://github.com" id="bm-1">
      <title>GitHub</title>
      <desc>Code hosting platform</desc>
    </bookmark>
    <bookmark href="https://stackoverflow.com" id="bm-2">
      <title>Stack Overflow</title>
    </bookmark>
  </folder>
  <folder id="folder-2">
    <title>News</title>
    <bookmark href="https://news.ycombinator.com" id="bm-3">
      <title>Hacker News</title>
    </bookmark>
  </folder>
</xbel>"#;

    const NESTED_XBEL: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <folder id="folder-bb">
    <title>Bookmarks Bar</title>
    <folder id="folder-shopping">
      <title>Shopping</title>
      <folder id="folder-deals">
        <title>Deals</title>
        <bookmark href="https://amazon.com" id="bm-1">
          <title>Amazon</title>
        </bookmark>
        <bookmark href="https://ebay.com" id="bm-2">
          <title>eBay</title>
        </bookmark>
      </folder>
      <folder id="folder-stores">
        <title>Stores</title>
        <bookmark href="https://walmart.com" id="bm-3">
          <title>Walmart</title>
        </bookmark>
      </folder>
    </folder>
    <folder id="folder-tech">
      <title>Tech</title>
      <bookmark href="https://github.com" id="bm-4">
        <title>GitHub</title>
      </bookmark>
      <folder id="folder-frontend">
        <title>Frontend</title>
        <bookmark href="https://react.dev" id="bm-5">
          <title>React</title>
        </bookmark>
      </folder>
    </folder>
  </folder>
</xbel>"#;

    fn simple_card(id: &str, content: &str) -> KanbanCard {
        KanbanCard {
            id: id.to_string(),
            content: content.to_string(),
            checked: false,
            kid: None,
            params: HashMap::new(),
        }
    }

    fn simple_column(id: &str, title: &str, cards: Vec<KanbanCard>) -> KanbanColumn {
        KanbanColumn {
            id: id.to_string(),
            title: title.to_string(),
            cards,
            include_source: None,
            params: HashMap::new(),
        }
    }

    // ---- parse_xbel ----

    #[test]
    fn parses_flat_xbel_with_folders_and_bookmarks() {
        let result = parse_xbel(FLAT_XBEL).unwrap();
        assert_eq!(result.folders.len(), 2);

        let f0 = &result.folders[0];
        assert_eq!(f0.id, "folder-1");
        assert_eq!(f0.title, "Dev Resources");
        assert_eq!(f0.bookmarks.len(), 2);
        assert_eq!(f0.children.len(), 0);
        assert_eq!(f0.bookmarks[0].id, "bm-1");
        assert_eq!(f0.bookmarks[0].title, "GitHub");
        assert_eq!(f0.bookmarks[0].href, "https://github.com");
        assert_eq!(
            f0.bookmarks[0].description.as_deref(),
            Some("Code hosting platform")
        );

        assert_eq!(f0.bookmarks[1].id, "bm-2");
        assert!(f0.bookmarks[1].description.is_none());

        assert_eq!(result.folders[1].title, "News");
        assert_eq!(result.folders[1].bookmarks.len(), 1);
    }

    #[test]
    fn preserves_nested_folder_tree_structure() {
        let result = parse_xbel(NESTED_XBEL).unwrap();
        assert_eq!(result.folders.len(), 1);

        let bb = &result.folders[0];
        assert_eq!(bb.id, "folder-bb");
        assert_eq!(bb.title, "Bookmarks Bar");
        assert_eq!(bb.bookmarks.len(), 0);
        assert_eq!(bb.children.len(), 2);

        let shopping = &bb.children[0];
        assert_eq!(shopping.title, "Shopping");
        assert_eq!(shopping.bookmarks.len(), 0);
        assert_eq!(shopping.children.len(), 2);

        let deals = &shopping.children[0];
        assert_eq!(deals.title, "Deals");
        assert_eq!(deals.bookmarks.len(), 2);
        assert_eq!(deals.bookmarks[0].title, "Amazon");
        assert_eq!(deals.bookmarks[1].title, "eBay");

        let stores = &shopping.children[1];
        assert_eq!(stores.title, "Stores");
        assert_eq!(stores.bookmarks.len(), 1);
        assert_eq!(stores.bookmarks[0].title, "Walmart");

        let tech = &bb.children[1];
        assert_eq!(tech.title, "Tech");
        assert_eq!(tech.bookmarks.len(), 1);
        assert_eq!(tech.bookmarks[0].title, "GitHub");
        assert_eq!(tech.children.len(), 1);

        let frontend = &tech.children[0];
        assert_eq!(frontend.title, "Frontend");
        assert_eq!(frontend.bookmarks.len(), 1);
        assert_eq!(frontend.bookmarks[0].title, "React");
    }

    #[test]
    fn root_level_bookmarks_go_to_unsorted_folder() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <bookmark href="https://example.com" id="bm-root">
    <title>Example</title>
  </bookmark>
</xbel>"#;
        let result = parse_xbel(xml).unwrap();
        assert_eq!(result.folders.len(), 1);
        assert_eq!(result.folders[0].title, "Unsorted");
        assert_eq!(result.folders[0].bookmarks.len(), 1);
        assert_eq!(result.folders[0].children.len(), 0);
    }

    // ---- generate_xbel ----

    #[test]
    fn generates_valid_xbel_xml_from_flat_structure() {
        let root = parse_xbel(FLAT_XBEL).unwrap();
        let xml = generate_xbel(&root).unwrap();
        assert!(xml.contains("xbel"));
        assert!(xml.contains("Dev Resources"));
        assert!(xml.contains("https://github.com"));
        assert!(xml.contains("bm-1"));
    }

    #[test]
    fn generates_nested_xbel_xml_from_tree_structure() {
        let root = parse_xbel(NESTED_XBEL).unwrap();
        let xml = generate_xbel(&root).unwrap();
        let reparsed = parse_xbel(&xml).unwrap();

        assert_eq!(reparsed.folders.len(), 1);
        let bb = &reparsed.folders[0];
        assert_eq!(bb.title, "Bookmarks Bar");
        assert_eq!(bb.children.len(), 2);

        let shopping = &bb.children[0];
        assert_eq!(shopping.title, "Shopping");
        assert_eq!(shopping.children.len(), 2);
        assert_eq!(shopping.children[0].title, "Deals");
        assert_eq!(shopping.children[0].bookmarks.len(), 2);
        assert_eq!(shopping.children[1].title, "Stores");
        assert_eq!(shopping.children[1].bookmarks.len(), 1);

        let tech = &bb.children[1];
        assert_eq!(tech.title, "Tech");
        assert_eq!(tech.bookmarks.len(), 1);
        assert_eq!(tech.children.len(), 1);
        assert_eq!(tech.children[0].title, "Frontend");
    }

    // ---- xbel_to_columns ----

    #[test]
    fn creates_one_column_per_flat_folder() {
        let root = parse_xbel(FLAT_XBEL).unwrap();
        let columns = xbel_to_columns(&root);

        assert_eq!(columns.len(), 2);

        assert_eq!(columns[0].title, "Dev Resources");
        assert_eq!(columns[0].cards.len(), 2);
        assert_eq!(
            columns[0].cards[0].content,
            "[GitHub](https://github.com \"bm-1\")\nCode hosting platform"
        );
        assert_eq!(
            columns[0].cards[1].content,
            "[Stack Overflow](https://stackoverflow.com \"bm-2\")"
        );

        assert_eq!(columns[1].title, "News");
        assert_eq!(columns[1].cards.len(), 1);
        assert_eq!(
            columns[1].cards[0].content,
            "[Hacker News](https://news.ycombinator.com \"bm-3\")"
        );
    }

    #[test]
    fn flattens_nested_folders_with_full_paths_and_stack_tags() {
        let root = parse_xbel(NESTED_XBEL).unwrap();
        let columns = xbel_to_columns(&root);

        assert_eq!(columns.len(), 4);

        assert_eq!(columns[0].title, "Bookmarks Bar / Shopping / Deals");
        assert_eq!(columns[0].cards.len(), 2);
        assert_eq!(
            columns[0].cards[0].content,
            "[Amazon](https://amazon.com \"bm-1\")"
        );
        assert_eq!(
            columns[0].cards[1].content,
            "[eBay](https://ebay.com \"bm-2\")"
        );

        assert_eq!(columns[1].title, "Bookmarks Bar / Shopping / Stores #stack");
        assert_eq!(columns[1].cards.len(), 1);
        assert_eq!(
            columns[1].cards[0].content,
            "[Walmart](https://walmart.com \"bm-3\")"
        );

        assert_eq!(columns[2].title, "Bookmarks Bar / Tech");
        assert_eq!(
            columns[2].cards[0].content,
            "[GitHub](https://github.com \"bm-4\")"
        );

        assert_eq!(columns[3].title, "Bookmarks Bar / Tech / Frontend #stack");
        assert_eq!(
            columns[3].cards[0].content,
            "[React](https://react.dev \"bm-5\")"
        );
    }

    #[test]
    fn does_not_add_stack_across_different_top_level_folders() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <folder id="f1"><title>A</title>
    <bookmark href="https://a.com" id="bm-a"><title>A Link</title></bookmark>
  </folder>
  <folder id="f2"><title>B</title>
    <bookmark href="https://b.com" id="bm-b"><title>B Link</title></bookmark>
  </folder>
</xbel>"#;
        let columns = xbel_to_columns(&parse_xbel(xml).unwrap());
        assert_eq!(columns[0].title, "A");
        assert_eq!(columns[1].title, "B");
    }

    #[test]
    fn handles_folder_with_bookmarks_at_root_and_in_children() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <folder id="f1"><title>Parent</title>
    <bookmark href="https://root.com" id="bm-root"><title>Root Bookmark</title></bookmark>
    <folder id="f2"><title>Child</title>
      <bookmark href="https://child.com" id="bm-child"><title>Child Bookmark</title></bookmark>
    </folder>
  </folder>
</xbel>"#;
        let columns = xbel_to_columns(&parse_xbel(xml).unwrap());
        assert_eq!(columns.len(), 2);
        assert_eq!(columns[0].title, "Parent");
        assert_eq!(columns[0].cards.len(), 1);
        assert_eq!(
            columns[0].cards[0].content,
            "[Root Bookmark](https://root.com \"bm-root\")"
        );
        assert_eq!(columns[1].title, "Parent / Child");
        assert_eq!(columns[1].cards.len(), 1);
        assert_eq!(
            columns[1].cards[0].content,
            "[Child Bookmark](https://child.com \"bm-child\")"
        );
    }

    // ---- columns_to_xbel ----

    #[test]
    fn builds_flat_xbel_from_flat_columns() {
        let columns = vec![
            simple_column(
                "col-1",
                "Dev Resources",
                vec![
                    simple_card("t-1", "[GitHub](https://github.com \"bm-1\")"),
                    simple_card(
                        "t-2",
                        "[Stack Overflow](https://stackoverflow.com \"bm-2\")",
                    ),
                ],
            ),
            simple_column(
                "col-2",
                "News",
                vec![simple_card(
                    "t-3",
                    "[Hacker News](https://news.ycombinator.com \"bm-3\")",
                )],
            ),
        ];

        let result = columns_to_xbel(&columns);
        assert_eq!(result.folders.len(), 2);

        assert_eq!(result.folders[0].title, "Dev Resources");
        assert_eq!(result.folders[0].bookmarks.len(), 2);
        assert_eq!(result.folders[0].bookmarks[0].title, "GitHub");
        assert_eq!(result.folders[0].bookmarks[0].href, "https://github.com");
        assert_eq!(result.folders[0].bookmarks[0].id, "bm-1");

        assert_eq!(result.folders[1].title, "News");
        assert_eq!(result.folders[1].bookmarks.len(), 1);
    }

    #[test]
    fn builds_nested_xbel_from_path_columns() {
        let columns = vec![
            simple_column(
                "col-1",
                "Bookmarks Bar / Shopping / Deals",
                vec![
                    simple_card("t-1", "[Amazon](https://amazon.com \"bm-1\")"),
                    simple_card("t-2", "[eBay](https://ebay.com \"bm-2\")"),
                ],
            ),
            simple_column(
                "col-2",
                "Bookmarks Bar / Shopping / Stores #stack",
                vec![simple_card(
                    "t-3",
                    "[Walmart](https://walmart.com \"bm-3\")",
                )],
            ),
            simple_column(
                "col-3",
                "Bookmarks Bar / Tech #stack",
                vec![simple_card("t-4", "[GitHub](https://github.com \"bm-4\")")],
            ),
        ];

        let result = columns_to_xbel(&columns);
        assert_eq!(result.folders.len(), 1);

        let bb = &result.folders[0];
        assert_eq!(bb.title, "Bookmarks Bar");
        assert_eq!(bb.bookmarks.len(), 0);
        assert_eq!(bb.children.len(), 2);

        let shopping = &bb.children[0];
        assert_eq!(shopping.title, "Shopping");
        assert_eq!(shopping.children.len(), 2);

        let deals = &shopping.children[0];
        assert_eq!(deals.title, "Deals");
        assert_eq!(deals.bookmarks.len(), 2);
        assert_eq!(deals.bookmarks[0].title, "Amazon");
        assert_eq!(deals.bookmarks[1].title, "eBay");

        let stores = &shopping.children[1];
        assert_eq!(stores.title, "Stores");
        assert_eq!(stores.bookmarks.len(), 1);
        assert_eq!(stores.bookmarks[0].title, "Walmart");

        let tech = &bb.children[1];
        assert_eq!(tech.title, "Tech");
        assert_eq!(tech.bookmarks.len(), 1);
        assert_eq!(tech.bookmarks[0].title, "GitHub");
    }

    #[test]
    fn skips_tasks_without_links() {
        let columns = vec![simple_column(
            "col-1",
            "Mixed",
            vec![
                simple_card("t-1", "[Link](https://example.com \"id-1\")"),
                simple_card("t-2", "Plain text task without link"),
                simple_card("t-3", "[Another](https://test.com \"id-2\")"),
            ],
        )];

        let result = columns_to_xbel(&columns);
        assert_eq!(result.folders.len(), 1);
        assert_eq!(result.folders[0].bookmarks.len(), 2);
        assert_eq!(result.folders[0].bookmarks[0].href, "https://example.com");
        assert_eq!(result.folders[0].bookmarks[1].href, "https://test.com");
    }

    #[test]
    fn preserves_bookmark_descriptions_through_columns_to_xbel() {
        let columns = vec![simple_column(
            "col-1",
            "Resources",
            vec![simple_card(
                "t-1",
                "[GitHub](https://github.com \"bm-1\")\nCode hosting",
            )],
        )];

        let result = columns_to_xbel(&columns);
        assert_eq!(
            result.folders[0].bookmarks[0].description.as_deref(),
            Some("Code hosting")
        );
    }

    // ---- round trip ----

    #[test]
    fn round_trip_preserves_flat_data() {
        let original = parse_xbel(FLAT_XBEL).unwrap();
        let columns = xbel_to_columns(&original);
        let round_trip = columns_to_xbel(&columns);

        assert_eq!(round_trip.folders.len(), 2);
        assert_eq!(round_trip.folders[0].title, "Dev Resources");
        assert_eq!(round_trip.folders[0].bookmarks.len(), 2);
        assert_eq!(round_trip.folders[0].bookmarks[0].title, "GitHub");
        assert_eq!(
            round_trip.folders[0].bookmarks[0].href,
            "https://github.com"
        );
        assert_eq!(round_trip.folders[0].bookmarks[0].id, "bm-1");
        assert_eq!(
            round_trip.folders[0].bookmarks[0].description.as_deref(),
            Some("Code hosting platform")
        );
        assert_eq!(round_trip.folders[0].bookmarks[1].id, "bm-2");
        assert_eq!(round_trip.folders[1].title, "News");
    }

    #[test]
    fn round_trip_preserves_nested_structure() {
        let original = parse_xbel(NESTED_XBEL).unwrap();
        let columns = xbel_to_columns(&original);
        let round_trip = columns_to_xbel(&columns);

        assert_eq!(round_trip.folders.len(), 1);
        let bb = &round_trip.folders[0];
        assert_eq!(bb.title, "Bookmarks Bar");
        assert_eq!(bb.bookmarks.len(), 0);
        assert_eq!(bb.children.len(), 2);

        let shopping = &bb.children[0];
        assert_eq!(shopping.title, "Shopping");
        assert_eq!(shopping.children.len(), 2);

        let deals = &shopping.children[0];
        assert_eq!(deals.title, "Deals");
        assert_eq!(deals.bookmarks.len(), 2);
        assert_eq!(deals.bookmarks[0].id, "bm-1");
        assert_eq!(deals.bookmarks[0].title, "Amazon");
        assert_eq!(deals.bookmarks[1].id, "bm-2");

        let stores = &shopping.children[1];
        assert_eq!(stores.title, "Stores");
        assert_eq!(stores.bookmarks.len(), 1);
        assert_eq!(stores.bookmarks[0].id, "bm-3");

        let tech = &bb.children[1];
        assert_eq!(tech.title, "Tech");
        assert_eq!(tech.bookmarks.len(), 1);
        assert_eq!(tech.bookmarks[0].id, "bm-4");
        assert_eq!(tech.children.len(), 1);

        let frontend = &tech.children[0];
        assert_eq!(frontend.title, "Frontend");
        assert_eq!(frontend.bookmarks.len(), 1);
        assert_eq!(frontend.bookmarks[0].id, "bm-5");
    }

    #[test]
    fn full_round_trip_xbel_columns_xbel_xml() {
        let original = parse_xbel(NESTED_XBEL).unwrap();
        let columns = xbel_to_columns(&original);
        let xbel_root = columns_to_xbel(&columns);
        let xml = generate_xbel(&xbel_root).unwrap();
        let reparsed = parse_xbel(&xml).unwrap();

        let bb = &reparsed.folders[0];
        assert_eq!(bb.title, "Bookmarks Bar");
        assert_eq!(bb.children.len(), 2);

        let deals = &bb.children[0].children[0];
        assert_eq!(deals.title, "Deals");
        assert_eq!(deals.bookmarks.len(), 2);
        assert_eq!(deals.bookmarks[0].href, "https://amazon.com");
    }

    // ---- extract_folder_path ----

    #[test]
    fn extract_folder_path_strips_stack_tag() {
        assert_eq!(
            extract_folder_path("Bookmarks Bar / Shopping #stack"),
            "Bookmarks Bar / Shopping"
        );
    }

    #[test]
    fn extract_folder_path_strips_multiple_tags() {
        assert_eq!(extract_folder_path("Title #stack #hidden"), "Title");
    }

    #[test]
    fn extract_folder_path_returns_title_as_is_when_no_tags() {
        assert_eq!(extract_folder_path("Dev Resources"), "Dev Resources");
    }

    #[test]
    fn extract_folder_path_returns_empty_for_empty_input() {
        assert_eq!(extract_folder_path(""), "");
    }

    // ---- extract_xbel_id ----

    #[test]
    fn extracts_xbel_id_from_link_title() {
        assert_eq!(
            extract_xbel_id("[Title](https://url \"my-xbel-id\")").as_deref(),
            Some("my-xbel-id")
        );
    }

    #[test]
    fn returns_none_for_links_without_title() {
        assert_eq!(extract_xbel_id("[Title](https://url)"), None);
    }

    #[test]
    fn returns_none_for_plain_text() {
        assert_eq!(extract_xbel_id("Just a plain task"), None);
    }

    #[test]
    fn returns_none_for_empty_content() {
        assert_eq!(extract_xbel_id(""), None);
    }

    #[test]
    fn extracts_id_from_first_line_of_multi_line_task() {
        let content = "[Amazon](https://amazon.com \"bm-1\")\nSome description";
        assert_eq!(extract_xbel_id(content).as_deref(), Some("bm-1"));
    }

    // ---- merge_xbel_into_columns ----

    #[test]
    fn merge_updates_existing_bookmarks_by_xbel_id_match() {
        let existing = vec![simple_column(
            "col-1",
            "Dev Resources",
            vec![simple_card(
                "task-1",
                "[Old Title](https://old-url.com \"bm-1\")",
            )],
        )];

        let incoming = parse_xbel(FLAT_XBEL).unwrap();
        let merged = merge_xbel_into_columns(&incoming, &existing);

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].title, "Dev Resources");
        assert_eq!(merged[0].cards.len(), 2);
        assert_eq!(merged[0].cards[0].id, "task-1");
        assert!(merged[0].cards[0].content.contains("GitHub"));
        assert!(merged[0].cards[0].content.contains("https://github.com"));
    }

    #[test]
    fn merge_preserves_cards_without_links() {
        let existing = vec![simple_column(
            "col-1",
            "Dev Resources",
            vec![
                simple_card("task-1", "[GitHub](https://github.com \"bm-1\")"),
                simple_card("task-2", "My local note without a link"),
            ],
        )];

        let incoming = XbelRoot {
            folders: vec![XbelFolder {
                id: "folder-1".to_string(),
                title: "Dev Resources".to_string(),
                bookmarks: vec![XbelBookmark {
                    id: "bm-1".to_string(),
                    title: "GitHub".to_string(),
                    href: "https://github.com".to_string(),
                    description: None,
                }],
                children: vec![],
            }],
        };

        let merged = merge_xbel_into_columns(&incoming, &existing);
        assert_eq!(merged[0].cards.len(), 2);
        assert_eq!(merged[0].cards[0].id, "task-1");
        assert_eq!(merged[0].cards[1].content, "My local note without a link");
    }

    #[test]
    fn merge_preserves_non_synced_columns() {
        let existing = vec![
            simple_column("col-1", "Dev Resources", vec![]),
            simple_column(
                "col-2",
                "My Private Column",
                vec![simple_card("t-1", "Private")],
            ),
        ];

        let incoming = XbelRoot {
            folders: vec![XbelFolder {
                id: "f-1".to_string(),
                title: "Dev Resources".to_string(),
                bookmarks: vec![],
                children: vec![],
            }],
        };

        let merged = merge_xbel_into_columns(&incoming, &existing);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[1].title, "My Private Column");
        assert_eq!(merged[1].cards[0].content, "Private");
    }

    #[test]
    fn merge_nested_xbel_by_folder_path() {
        let existing = vec![
            simple_column(
                "col-deals",
                "Bookmarks Bar / Shopping / Deals",
                vec![simple_card(
                    "task-old-1",
                    "[Amazon](https://amazon.com \"bm-1\")",
                )],
            ),
            simple_column(
                "col-tech",
                "Bookmarks Bar / Tech #stack",
                vec![simple_card(
                    "task-old-2",
                    "[GitHub](https://github.com \"bm-4\")",
                )],
            ),
            simple_column(
                "col-local",
                "My Notes",
                vec![simple_card("task-local", "My local note")],
            ),
        ];

        let incoming = parse_xbel(NESTED_XBEL).unwrap();
        let merged = merge_xbel_into_columns(&incoming, &existing);

        assert_eq!(merged.len(), 5);

        let deals = merged
            .iter()
            .find(|c| extract_folder_path(&c.title) == "Bookmarks Bar / Shopping / Deals")
            .expect("deals column present");
        assert_eq!(deals.id, "col-deals");
        assert_eq!(deals.cards.len(), 2);
        assert_eq!(deals.cards[0].id, "task-old-1");

        let tech = merged
            .iter()
            .find(|c| extract_folder_path(&c.title) == "Bookmarks Bar / Tech")
            .expect("tech column present");
        assert_eq!(tech.id, "col-tech");
        assert_eq!(tech.cards[0].id, "task-old-2");

        let local = merged
            .iter()
            .find(|c| c.title == "My Notes")
            .expect("local column present");
        assert_eq!(local.cards[0].content, "My local note");
    }

    #[test]
    fn merge_adds_new_columns_for_new_folders() {
        let existing = vec![simple_column(
            "col-1",
            "Bookmarks Bar / Shopping / Deals",
            vec![simple_card(
                "task-1",
                "[Amazon](https://amazon.com \"bm-1\")",
            )],
        )];

        let incoming = parse_xbel(NESTED_XBEL).unwrap();
        let merged = merge_xbel_into_columns(&incoming, &existing);
        assert_eq!(merged.len(), 4);
    }

    // ---- sync cycle stability ----

    #[test]
    fn sync_cycles_do_not_grow_columns() {
        let incoming1 = parse_xbel(NESTED_XBEL).unwrap();
        let merged1 = merge_xbel_into_columns(&incoming1, &[]);
        let col_count = merged1.len();

        let xbel1 = columns_to_xbel(&merged1);
        let xml1 = generate_xbel(&xbel1).unwrap();
        let incoming2 = parse_xbel(&xml1).unwrap();
        let merged2 = merge_xbel_into_columns(&incoming2, &merged1);
        assert_eq!(merged2.len(), col_count);

        let xbel2 = columns_to_xbel(&merged2);
        let xml2 = generate_xbel(&xbel2).unwrap();
        let incoming3 = parse_xbel(&xml2).unwrap();
        let merged3 = merge_xbel_into_columns(&incoming3, &merged2);
        assert_eq!(merged3.len(), col_count);
    }

    #[test]
    fn sync_cycles_stable_with_mixed_synced_and_local_columns() {
        let incoming1 = parse_xbel(NESTED_XBEL).unwrap();
        let existing = vec![simple_column(
            "local-col",
            "My Notes",
            vec![simple_card("local-t", "A plain note")],
        )];
        let mut board = merge_xbel_into_columns(&incoming1, &existing);
        let col_count = board.len();

        for _ in 0..5 {
            let xbel = columns_to_xbel(&board);
            let xml = generate_xbel(&xbel).unwrap();
            let incoming = parse_xbel(&xml).unwrap();
            board = merge_xbel_into_columns(&incoming, &board);
            assert_eq!(board.len(), col_count);
        }
    }

    #[test]
    fn sync_cycles_preserve_task_ids() {
        let incoming1 = parse_xbel(NESTED_XBEL).unwrap();
        let mut board = merge_xbel_into_columns(&incoming1, &[]);

        let initial_ids: Vec<String> = board
            .iter()
            .flat_map(|c| c.cards.iter().map(|t| t.id.clone()))
            .collect();

        for _ in 0..3 {
            let xbel = columns_to_xbel(&board);
            let xml = generate_xbel(&xbel).unwrap();
            let incoming = parse_xbel(&xml).unwrap();
            board = merge_xbel_into_columns(&incoming, &board);
        }

        let final_ids: Vec<String> = board
            .iter()
            .flat_map(|c| c.cards.iter().map(|t| t.id.clone()))
            .collect();

        assert_eq!(final_ids, initial_ids);
    }

    #[test]
    fn sync_cycles_do_not_duplicate_tasks() {
        let incoming1 = parse_xbel(NESTED_XBEL).unwrap();
        let mut board = merge_xbel_into_columns(&incoming1, &[]);
        let initial_counts: Vec<usize> = board.iter().map(|c| c.cards.len()).collect();

        for _ in 0..5 {
            let xbel = columns_to_xbel(&board);
            let xml = generate_xbel(&xbel).unwrap();
            let incoming = parse_xbel(&xml).unwrap();
            board = merge_xbel_into_columns(&incoming, &board);

            let counts: Vec<usize> = board.iter().map(|c| c.cards.len()).collect();
            assert_eq!(counts, initial_counts);
        }
    }
}
