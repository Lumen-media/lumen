use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::remote;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeUrl {
    pub video_id: String,
    pub canonical_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlMediaMetadata {
    pub original_url: String,
    pub canonical_url: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_path: Option<String>,
}

#[derive(Deserialize)]
struct OEmbedResponse {
    title: Option<String>,
    author_name: Option<String>,
    thumbnail_url: Option<String>,
}

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

fn is_valid_video_id(id: &str) -> bool {
    id.len() >= 6
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn canonicalize_youtube_url(value: &str) -> String {
    parse_youtube_url(value)
        .map(|parsed| parsed.canonical_url)
        .unwrap_or_else(|| value.to_string())
}

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