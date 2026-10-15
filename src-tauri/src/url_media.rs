//! YouTube links as media items.
//!
//! The frontend accepts any pasted YouTube URL; this module reduces it to a
//! canonical `watch?v=` link, pulls title, channel and thumbnail from
//! YouTube's oEmbed endpoint, and caches the thumbnail on disk so playback
//! does not depend on the network.

use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::remote;

/// A parsed YouTube link reduced to its stable parts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeUrl {
    /// The video identifier taken from the URL.
    pub video_id: String,
    /// Normalized `https://www.youtube.com/watch?v=<id>` link.
    pub canonical_url: String,
}

/// Metadata describing a URL-backed media item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlMediaMetadata {
    /// URL exactly as the user pasted it.
    pub original_url: String,
    /// Normalized watch URL, used for playback and deduplication.
    pub canonical_url: String,
    /// Video title, or a generated placeholder when oEmbed did not answer.
    pub title: String,
    /// Channel name reported by oEmbed, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    /// Thumbnail URL hosted by YouTube.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_thumbnail_url: Option<String>,
    /// Local path of the cached thumbnail, when it could be downloaded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_path: Option<String>,
}

/// Subset of the oEmbed payload that Lumen cares about.
#[derive(Deserialize)]
struct OEmbedResponse {
    /// Video title.
    title: Option<String>,
    /// Channel or uploader name.
    author_name: Option<String>,
    /// URL of the provider-supplied thumbnail.
    thumbnail_url: Option<String>,
}

/// Extracts a video id and a canonical URL from a YouTube link.
///
/// Supported forms: `youtu.be/<id>`, `/watch?v=<id>`, `/shorts/<id>` and
/// `/embed/<id>` on the `youtube.com`, `m.youtube.com` and
/// `music.youtube.com` hosts, with or without a `www.` prefix.
///
/// # Examples
///
/// ```rust
/// let parsed = parse_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42").unwrap();
/// assert_eq!(parsed.video_id, "dQw4w9WgXcQ");
/// assert_eq!(parsed.canonical_url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
///
/// let short = parse_youtube_url("https://youtu.be/dQw4w9WgXcQ").unwrap();
/// assert_eq!(short.canonical_url, parsed.canonical_url);
///
/// assert!(parse_youtube_url("https://vimeo.com/123456").is_none());
/// ```
///
/// Returns `None` for other hosts, malformed URLs and ids that do not look
/// like a real YouTube id.
pub fn parse_youtube_url(value: &str) -> Option<YouTubeUrl> {
    let url = url::Url::parse(value.trim()).ok()?;
    let host = url.host_str()?.trim_start_matches("www.").to_lowercase();

    let video_id: Option<String> = match host.as_str() {
        "youtu.be" => url
            .path_segments()?
            .next()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
        "youtube.com" | "m.youtube.com" | "music.youtube.com" => {
            let path = url.path();
            if path == "/watch" {
                url.query_pairs()
                    .find(|(key, _)| key == "v")
                    .map(|(_, value)| value.to_string())
            } else if path.starts_with("/shorts/") {
                url.path_segments()?.nth(1).map(|s| s.to_string())
            } else if path.starts_with("/embed/") {
                url.path_segments()?.nth(1).map(|s| s.to_string())
            } else {
                None
            }
        }
        _ => return None,
    };

    let video_id = video_id?;
    if !is_valid_video_id(&video_id) {
        return None;
    }

    Some(YouTubeUrl {
        video_id: video_id.clone(),
        canonical_url: format!("https://www.youtube.com/watch?v={video_id}"),
    })
}

/// A video id is accepted when it is at least six characters long and made
/// only of ASCII alphanumerics, hyphens and underscores.
fn is_valid_video_id(id: &str) -> bool {
    id.len() >= 6
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Normalizes a YouTube link to its canonical form, passing anything that
/// does not parse through unchanged.
///
/// # Examples
///
/// ```rust
/// assert_eq!(
///     canonicalize_youtube_url("https://m.youtube.com/watch?v=dQw4w9WgXcQ"),
///     "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
/// );
/// assert_eq!(
///     canonicalize_youtube_url("https://example.com/video"),
///     "https://example.com/video"
/// );
/// ```
pub fn canonicalize_youtube_url(value: &str) -> String {
    parse_youtube_url(value)
        .map(|parsed| parsed.canonical_url)
        .unwrap_or_else(|| value.to_string())
}

/// Fetches title, channel and thumbnail from YouTube's oEmbed endpoint.
///
/// Returns `None` on any transport or decode failure: metadata is optional
/// and must never break URL media resolution.
async fn fetch_oembed(canonical_url: &str) -> Option<OEmbedResponse> {
    let encoded: String =
        url::form_urlencoded::Serializer::new(String::new())
            .append_pair("url", canonical_url)
            .append_pair("format", "json")
            .finish();
    let request_url = format!("https://www.youtube.com/oembed?{encoded}");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    let response = client.get(&request_url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<OEmbedResponse>().await.ok()
}

/// Downloads a thumbnail into the shared thumbnail cache and returns the
/// local path; a file already on disk is reused as is.
///
/// # Errors
///
/// Returns an error when the cache directory cannot be prepared, the download
/// fails, or the file cannot be written.
async fn cache_youtube_thumbnail(video_id: &str, thumbnail_url: &str) -> Result<String, String> {
    let dir = remote::remote_thumbs_dir()?;
    let dest = dir.join(format!("youtube_{video_id}.jpg"));
    if dest.exists() {
        return Ok(dest.to_string_lossy().to_string());
    }

    let bytes = remote::fetch_bytes(thumbnail_url).await?;
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

/// Resolves a pasted YouTube URL into a media item for the frontend.
///
/// The link is canonicalized first, then oEmbed supplies the title, channel
/// and thumbnail. The thumbnail is downloaded into the local cache when
/// possible; a failed download only leaves `thumbnail_path` empty.
///
/// # Errors
///
/// Returns an error when `url` is not a supported YouTube link. Network
/// failures are not surfaced as errors: they fall back to a generated title
/// and no thumbnail.
#[tauri::command]
pub async fn resolve_youtube(url: String) -> Result<UrlMediaMetadata, String> {
    let parsed = parse_youtube_url(&url)
        .ok_or_else(|| "Only YouTube URLs are supported".to_string())?;
    let canonical_url = parsed.canonical_url.clone();
    let fallback_title = format!("YouTube video {}", parsed.video_id);

    let oembed = fetch_oembed(&canonical_url).await;

    let remote_thumbnail_url = oembed
        .as_ref()
        .and_then(|metadata| metadata.thumbnail_url.clone())
        .filter(|u| !u.trim().is_empty());

    let thumbnail_path = match &remote_thumbnail_url {
        Some(thumb_url) => cache_youtube_thumbnail(&parsed.video_id, thumb_url).await.ok(),
        None => None,
    };

    Ok(UrlMediaMetadata {
        original_url: url,
        canonical_url,
        title: oembed
            .as_ref()
            .and_then(|metadata| metadata.title.clone())
            .map(|title| title.trim().to_string())
            .filter(|title| !title.is_empty())
            .unwrap_or(fallback_title),
        artist: oembed
            .as_ref()
            .and_then(|metadata| metadata.author_name.clone())
            .map(|artist| artist.trim().to_string())
            .filter(|artist| !artist.is_empty()),
        remote_thumbnail_url,
        thumbnail_path,
    })
}