/// Shared capture types used by both desktop backend and iOS app.
use serde::{Deserialize, Serialize};

/// A single captured content entry (clipboard history item or share sheet capture).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CaptureEntry {
    pub id: u64,
    pub text: Option<String>,
    pub image_data: Option<String>,
    pub image_filename: Option<String>,
    pub timestamp: u64,
}

/// A pending item from the iOS Share Sheet extension (or similar external source).
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PendingItem {
    #[serde(rename = "text")]
    Text { text: String, timestamp: f64 },
    #[serde(rename = "url")]
    Url {
        url: String,
        title: Option<String>,
        timestamp: f64,
    },
    #[serde(rename = "image")]
    Image {
        data: String,
        filename: String,
        timestamp: f64,
    },
}

/// Format a pending item as markdown card content.
pub fn format_capture_as_markdown(item: &PendingItem) -> String {
    match item {
        PendingItem::Text { text, .. } => text.clone(),
        PendingItem::Url { url, title, .. } => {
            let display = title.as_deref().unwrap_or(url);
            format!("[{}]({})", display, url)
        }
        PendingItem::Image { filename, .. } => {
            // Caller is responsible for saving the image file and providing the relative path.
            // This returns a placeholder; use `format_image_card` for the final content.
            format!("![{}]()", filename)
        }
    }
}

/// Format an image card with the actual saved path.
pub fn format_image_card(filename: &str, relative_path: &str) -> String {
    format!("![{}]({})", filename, relative_path)
}

/// Generate a millisecond timestamp from the current system time.
pub fn timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
