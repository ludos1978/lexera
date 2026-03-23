/// Media file helpers shared between desktop backend and iOS app.
use std::path::{Path, PathBuf};

/// Generate a unique filename by appending a counter if the file already exists.
pub fn dedup_filename(dir: &Path, filename: &str) -> PathBuf {
    let path = dir.join(filename);
    if !path.exists() {
        return path;
    }

    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let ext = Path::new(filename)
        .extension()
        .and_then(|s| s.to_str());

    for i in 1..1000 {
        let new_name = match ext {
            Some(e) => format!("{}-{}.{}", stem, i, e),
            None => format!("{}-{}", stem, i),
        };
        let new_path = dir.join(&new_name);
        if !new_path.exists() {
            return new_path;
        }
    }

    // Fallback: timestamp-based
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let new_name = match ext {
        Some(e) => format!("{}-{}.{}", stem, ts, e),
        None => format!("{}-{}", stem, ts),
    };
    dir.join(&new_name)
}

/// Map a file extension to its MIME content type.
pub fn content_type_for_ext(ext: Option<&str>) -> &'static str {
    match ext {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("pdf") => "application/pdf",
        Some("json") => "application/json",
        Some("csv") => "text/csv",
        Some("txt") | Some("md") | Some("log") => "text/plain",
        _ => "application/octet-stream",
    }
}

/// Categorize a file by extension: image, video, audio, document, or unknown.
pub fn media_category(ext: Option<&str>) -> &'static str {
    match ext {
        Some("png") | Some("jpg") | Some("jpeg") | Some("gif") | Some("webp") | Some("svg")
        | Some("bmp") | Some("ico") | Some("tiff") | Some("tif") => "image",
        Some("mp4") | Some("webm") | Some("mov") | Some("avi") | Some("mkv") => "video",
        Some("mp3") | Some("wav") | Some("ogg") | Some("flac") | Some("aac") | Some("m4a") => {
            "audio"
        }
        Some("pdf") | Some("doc") | Some("docx") | Some("xls") | Some("xlsx") | Some("ppt")
        | Some("pptx") | Some("txt") | Some("md") | Some("csv") | Some("json") => "document",
        _ => "unknown",
    }
}

/// Whether the file type can be previewed in a browser/webview.
pub fn is_previewable(ext: Option<&str>) -> bool {
    matches!(
        ext,
        Some("png")
            | Some("jpg")
            | Some("jpeg")
            | Some("gif")
            | Some("webp")
            | Some("svg")
            | Some("bmp")
            | Some("mp4")
            | Some("webm")
            | Some("mov")
            | Some("mp3")
            | Some("wav")
            | Some("ogg")
            | Some("pdf")
    )
}

/// Compute the media folder path for a board file: `{stem}-Media/` in the same directory.
pub fn media_folder_for_board(board_path: &Path) -> PathBuf {
    let dir = board_path
        .parent()
        .unwrap_or_else(|| Path::new("."));
    let stem = board_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("board");
    dir.join(format!("{}-Media", stem))
}
