//! Permission-checked HTTP proxy for modules.
//!
//! Modules cannot reach the network directly; they issue requests through the
//! [`module_net_request`] Tauri command, which enforces a layered policy
//! before any connection is opened:
//!
//! 1. only `https` URLs are accepted;
//! 2. private, loopback, link-local, multicast and `.local`/`.localhost` hosts
//!    are always blocked (see [`is_private_host`]);
//! 3. when the manifest declares `permissions.network`, the URL must match one
//!    of the patterns (see [`match_url_pattern`]);
//! 4. hop-by-hop and security-sensitive request headers are rejected, request
//!    bodies are limited to methods that allow them, and the response body is
//!    capped by `max_bytes`.
//!
//! Responses are returned as a [`ModuleNetResponse`]; all failures use the
//! stable, machine-readable [`ModuleNetError`] shape.

use std::collections::HashMap;
use std::sync::PoisonError;
use std::time::Duration;

use base64::Engine as _;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use url::Url;

use super::manifest::ModuleManifest;
use super::ModuleRuntime;

// ── Types ─────────────────────────────────────────────────────────

/// HTTP method requested by a module.
///
/// Deserialized case-insensitively from an uppercase string (e.g. `"GET"`).
/// When a request omits the method, [`module_net_request`] infers `POST` if a
/// body is present and `GET` otherwise.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "UPPERCASE")]
pub enum NetMethod {
    /// `GET`
    Get,
    /// `POST`
    Post,
    /// `PUT`
    Put,
    /// `PATCH`
    Patch,
    /// `DELETE`
    Delete,
    /// `HEAD`
    Head,
}

impl NetMethod {
    fn as_str(&self) -> &'static str {
        match self {
            NetMethod::Get => "GET",
            NetMethod::Post => "POST",
            NetMethod::Put => "PUT",
            NetMethod::Patch => "PATCH",
            NetMethod::Delete => "DELETE",
            NetMethod::Head => "HEAD",
        }
    }

    fn allows_body(&self) -> bool {
        matches!(self, NetMethod::Post | NetMethod::Put | NetMethod::Patch)
    }
}

/// How the response body should be decoded before being returned to the module.
///
/// Deserialized from a snake_case string; defaults to [`NetResponseType::Json`]
/// when omitted.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum NetResponseType {
    /// Parse the body as JSON; falls back to the raw text string on parse error.
    Json,
    /// Return the body verbatim as a string.
    Text,
    /// Return the body as a base64-encoded string.
    Bytes,
    /// Discard the body; `data` is `null`.
    None,
}

/// Request body variants for a module HTTP request.
///
/// Externally tagged by a `type` field, e.g. `{ "type": "json", "value": {...} }`.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ModuleNetRequestBody {
    /// JSON body, serialized with the `application/json` content type.
    #[serde(rename = "json")]
    Json { value: serde_json::Value },
    /// Raw text body with an optional explicit content type.
    #[serde(rename = "text")]
    Text { value: String, #[serde(default)] content_type: Option<String> },
    /// Binary body supplied as base64, with an optional explicit content type.
    #[serde(rename = "bytes")]
    Bytes { value_base64: String, #[serde(default)] content_type: Option<String> },
    /// `application/x-www-form-urlencoded` body built from key/value pairs.
    #[serde(rename = "form")]
    Form { value: HashMap<String, String> },
    /// `multipart/form-data` body. Reserved: currently rejected by
    /// [`module_net_request`] as unsupported.
    #[serde(rename = "multipart")]
    Multipart { parts: Vec<MultipartPart> },
}

/// One part of a [`ModuleNetRequestBody::Multipart`] body.
///
/// Reserved for future multipart support; the fields describe a single form
/// field or file attachment.
#[derive(Debug, Deserialize)]
pub struct MultipartPart {
    /// Form field name.
    pub name: String,
    /// Part kind, e.g. `"text"` or `"file"`.
    #[serde(rename = "type")]
    pub part_type: String,
    /// Plain-text value for text parts.
    pub value: Option<String>,
    /// Base64-encoded value for binary parts.
    pub value_base64: Option<String>,
    /// File name to advertise for file parts.
    #[serde(default)]
    pub filename: Option<String>,
    /// Explicit content type for the part.
    #[serde(default)]
    pub content_type: Option<String>,
}

/// A network request issued by a module through [`module_net_request`].
///
/// Unknown fields are ignored and every field except `url` is optional.
#[derive(Debug, Deserialize)]
pub struct ModuleNetRequest {
    /// Absolute target URL. Must be `https` and satisfy the module's
    /// network permissions.
    pub url: String,
    /// HTTP method; inferred (`POST` with a body, otherwise `GET`) when absent.
    #[serde(default)]
    pub method: Option<NetMethod>,
    /// Query parameters appended to `url`, each key allowing multiple values.
    #[serde(default)]
    pub query: Option<HashMap<String, Vec<String>>>,
    /// Additional request headers. Hop-by-hop and `sec-*`/`proxy-*` headers are
    /// rejected.
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    /// Optional request body.
    #[serde(default)]
    pub body: Option<ModuleNetRequestBody>,
    /// Desired response decoding; defaults to JSON.
    #[serde(rename = "responseType", default)]
    pub response_type: Option<NetResponseType>,
    /// Per-request timeout in milliseconds, clamped to 60_000; default 15_000.
    #[serde(rename = "timeoutMs", default)]
    pub timeout_ms: Option<u64>,
    /// Maximum response-body size in bytes, clamped to 50_000_000; default
    /// 10_000_000. Exceeding it yields a `response_too_large` error.
    #[serde(rename = "maxBytes", default)]
    pub max_bytes: Option<u64>,
    /// Whether to follow redirects. Currently informational: the shared HTTP
    /// client follows up to 5 redirects regardless.
    #[serde(rename = "followRedirects", default)]
    pub follow_redirects: Option<bool>,
}

/// Successful (transport-level) result of a module HTTP request.
///
/// A non-2xx status is still a success here; inspect [`ModuleNetResponse::ok`]
/// or [`ModuleNetResponse::status`].
#[derive(Debug, Serialize, Clone)]
pub struct ModuleNetResponse {
    /// `true` when the status code is in the 2xx range.
    pub ok: bool,
    /// Numeric HTTP status code.
    pub status: u16,
    /// Canonical status reason phrase (`"Unknown"` if unavailable).
    #[serde(rename = "statusText")]
    pub status_text: String,
    /// Response headers, with hop-by-hop/proxy headers filtered out.
    pub headers: HashMap<String, String>,
    /// Final URL after redirects.
    pub url: String,
    /// `true` when the final URL differs from the requested URL.
    pub redirected: bool,
    /// Decoded body according to the requested [`NetResponseType`]: a JSON
    /// value, a string, a base64 string, or `null`.
    pub data: serde_json::Value,
}

/// Error returned by [`module_net_request`].
///
/// Serialized to the frontend where `code` is intended to be switched on.
/// Common codes: `invalid_url`, `blocked_url`, `permission_denied`,
/// `unsupported_body`, `timeout`, `network_error`, `invalid_response`,
/// `response_too_large`.
#[derive(Debug, Serialize, Clone)]
pub struct ModuleNetError {
    /// Stable machine-readable error code.
    pub code: String,
    /// Human-readable description.
    pub message: String,
    /// HTTP status when the error originated from a response.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    /// Related request/response URL, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

impl std::fmt::Display for ModuleNetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

// ── Permission matching ───────────────────────────────────────────

/// Returns `true` for hosts that must never be reachable by a module.
///
/// Covers `localhost`, `127.0.0.1`, `::1`, `.local`/`.localhost` names, and
/// loopback/private/link-local/unspecified/multicast IP literals (SSRF guard).
fn is_private_host(host: &str) -> bool {
    if host == "localhost" || host == "127.0.0.1" || host == "::1" {
        return true;
    }
    if host.ends_with(".local") || host.ends_with(".localhost") {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        match ip {
            std::net::IpAddr::V4(v4) => {
                return v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_unspecified()
                    || v4.is_multicast();
            }
            std::net::IpAddr::V6(v6) => {
                return v6.is_loopback() || v6.is_unspecified() || v6.is_multicast();
            }
        }
    }
    false
}

/// Matches `url_str` against a manifest network pattern.
///
/// Schemes and hosts must match; a `*.example.com` pattern matches any
/// subdomain but not the bare domain. A pattern path ending in `*` acts as a
/// prefix match, otherwise paths must be equal. Unparseable inputs never match.
fn match_url_pattern(url_str: &str, pattern: &str) -> bool {
    fn inner(url_str: &str, pattern: &str) -> Option<bool> {
        let url = Url::parse(url_str).ok()?;
        let pattern_url = Url::parse(pattern).ok()?;

        if url.scheme() != pattern_url.scheme() {
            return Some(false);
        }

        let url_host = url.host_str().unwrap_or("");
        let pattern_host = pattern_url.host_str().unwrap_or("");

        if pattern_host.starts_with("*.") {
            let suffix = &pattern_host[1..];
            if !url_host.ends_with(suffix) {
                return Some(false);
            }
            if url_host == &suffix[1..] {
                return Some(false);
            }
        } else if url_host != pattern_host {
            return Some(false);
        }

        let url_path = url.path();
        let pattern_path = pattern_url.path();

        if pattern_path.ends_with('*') {
            let prefix = &pattern_path[..pattern_path.len() - 1];
            if !url_path.starts_with(prefix) {
                return Some(false);
            }
        } else if url_path != pattern_path {
            return Some(false);
        }

        Some(true)
    }
    inner(url_str, pattern).unwrap_or(false)
}

/// Enforces the URL policy for `url_str` against `manifest`.
///
/// Rejects non-`https` URLs, private/loopback hosts, and URLs that fail to
/// match a non-empty `permissions.network` allow-list. When the manifest
/// declares no network permissions, any public HTTPS host is permitted.
///
/// # Errors
///
/// Returns a [`ModuleNetError`] with code `invalid_url`, `blocked_url` or
/// `permission_denied` depending on the violated rule. Also used by the themes
/// module before downloading remote images.
pub(crate) fn check_url_allowed(
    url_str: &str,
    manifest: &ModuleManifest,
) -> Result<(), ModuleNetError> {
    let url = Url::parse(url_str).map_err(|_| ModuleNetError {
        code: "invalid_url".into(),
        message: format!("invalid URL: {url_str}"),
        status: None,
        url: Some(url_str.into()),
    })?;

    if url.scheme() != "https" {
        return Err(ModuleNetError {
            code: "blocked_url".into(),
            message: "only https URLs are allowed".into(),
            status: None,
            url: Some(url_str.into()),
        });
    }

    if let Some(host) = url.host_str() {
        if is_private_host(host) {
            return Err(ModuleNetError {
                code: "blocked_url".into(),
                message: format!("private network host blocked: {host}"),
                status: None,
                url: Some(url_str.into()),
            });
        }
    }

    if let Some(permissions) = &manifest.permissions {
        if !permissions.network.is_empty() {
            let allowed = permissions
                .network
                .iter()
                .any(|p| match_url_pattern(url_str, p));
            if !allowed {
                return Err(ModuleNetError {
                    code: "permission_denied".into(),
                    message: format!("URL not allowed by module permissions: {url_str}"),
                    status: None,
                    url: Some(url_str.into()),
                });
            }
        }
    }

    Ok(())
}

// ── Request building ──────────────────────────────────────────────

/// Appends `query` parameters onto `base_url` and returns the resulting URL.
fn build_url(mut base_url: Url, query: Option<HashMap<String, Vec<String>>>) -> Url {
    if let Some(query_params) = query {
        {
            let mut pairs = base_url.query_pairs_mut();
            for (key, values) in query_params {
                for value in values {
                    pairs.append_pair(&key, &value);
                }
            }
        }
    }
    base_url
}

/// Translates a [`ModuleNetRequest`] into a configured [`reqwest::RequestBuilder`].
///
/// Resolves the method, applies query parameters, validates and attaches
/// headers (rejecting forbidden ones), encodes the body according to its
/// variant, and sets the (clamped) timeout.
///
/// # Errors
///
/// Returns a [`ModuleNetError`] for invalid methods/URLs/headers, forbidden
/// headers, a body on a method that does not allow one, or unsupported body
/// kinds (multipart).
fn build_request(
    client: &Client,
    input: &ModuleNetRequest,
) -> Result<reqwest::RequestBuilder, ModuleNetError> {
    let method_str = match &input.method {
        Some(m) => m.as_str(),
        None => {
            if input.body.is_some() {
                "POST"
            } else {
                "GET"
            }
        }
    };

    let method: reqwest::Method = method_str.parse().map_err(|_| ModuleNetError {
        code: "network_error".into(),
        message: format!("invalid HTTP method: {method_str}"),
        status: None,
        url: Some(input.url.clone()),
    })?;

    let allows_body = input
        .method
        .as_ref()
        .map(|m| m.allows_body())
        .unwrap_or(input.body.is_some());

    let mut url = Url::parse(&input.url).map_err(|_| ModuleNetError {
        code: "invalid_url".into(),
        message: format!("invalid URL: {}", input.url),
        status: None,
        url: Some(input.url.clone()),
    })?;

    url = build_url(url, input.query.clone());

    let mut req = client.request(method, url.clone());

    if let Some(headers) = &input.headers {
        let mut header_map = reqwest::header::HeaderMap::new();
        for (key, value) in headers {
            let lower = key.to_lowercase();
            if matches!(
                lower.as_str(),
                "host" | "content-length" | "connection" | "transfer-encoding" | "upgrade"
            ) || lower.starts_with("proxy-")
                || lower.starts_with("sec-")
            {
                return Err(ModuleNetError {
                    code: "permission_denied".into(),
                    message: format!("header not allowed: {key}"),
                    status: None,
                    url: Some(url.to_string()),
                });
            }

            let header_name = key.parse::<reqwest::header::HeaderName>().map_err(|_| {
                ModuleNetError {
                    code: "network_error".into(),
                    message: format!("invalid header name: {key}"),
                    status: None,
                    url: Some(url.to_string()),
                }
            })?;

            if let Ok(header_value) = value.parse::<reqwest::header::HeaderValue>() {
                header_map.insert(header_name, header_value);
            }
        }
        req = req.headers(header_map);
    }

    if let Some(body) = &input.body {
        if !allows_body {
            return Err(ModuleNetError {
                code: "unsupported_body".into(),
                message: format!("request body not allowed for {} requests", method_str),
                status: None,
                url: Some(url.to_string()),
            });
        }

        match body {
            ModuleNetRequestBody::Json { value } => {
                req = req.json(value);
            }
            ModuleNetRequestBody::Text {
                value,
                content_type,
            } => {
                req = req.body(value.clone());
                if let Some(ct) = content_type {
                    req = req.header(reqwest::header::CONTENT_TYPE, ct.clone());
                }
            }
            ModuleNetRequestBody::Bytes {
                value_base64,
                content_type,
            } => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(value_base64)
                    .map_err(|_| ModuleNetError {
                        code: "unsupported_body".into(),
                        message: "invalid base64 in request body".into(),
                        status: None,
                        url: Some(url.to_string()),
                    })?;
                req = req.body(bytes);
                if let Some(ct) = content_type {
                    req = req.header(reqwest::header::CONTENT_TYPE, ct.clone());
                }
            }
            ModuleNetRequestBody::Form { value } => {
                let pairs: Vec<(String, String)> = value.clone().into_iter().collect();
                req = req.form(&pairs);
            }
            ModuleNetRequestBody::Multipart { parts: _ } => {
                return Err(ModuleNetError {
                    code: "unsupported_body".into(),
                    message: "multipart body not yet supported".into(),
                    status: None,
                    url: Some(url.to_string()),
                });
            }
        };
    }

    let timeout_ms = input.timeout_ms.unwrap_or(15_000).min(60_000);
    req = req.timeout(Duration::from_millis(timeout_ms));

    Ok(req)
}

// ── Tauri command ─────────────────────────────────────────────────

/// Tauri command: performs a permission-checked HTTP request for a module.
///
/// # Frontend API
///
/// ```text
/// invoke("module_net_request", { moduleId, input })
/// ```
///
/// `module_id` must be a registered, loadable module; its manifest
/// `permissions.network` patterns gate the target URL. The request is executed
/// with the shared [`crate::module_runtime::ModuleRuntime`] HTTP client and the
/// decoded result is returned as a [`ModuleNetResponse`].
///
/// # Errors
///
/// Returns a [`ModuleNetError`] when the module is unknown, its manifest cannot
/// be loaded, the URL fails `check_url_allowed`, the request cannot be built,
/// the transport fails/times out, or the body exceeds `max_bytes`.
#[tauri::command]
pub async fn module_net_request(
    app: AppHandle,
    module_id: String,
    input: ModuleNetRequest,
) -> Result<ModuleNetResponse, ModuleNetError> {
    let runtime = app.state::<ModuleRuntime>();

    let entry = {
        let reg = runtime.registry.lock().map_err(|e: PoisonError<_>| ModuleNetError {
            code: "network_error".into(),
            message: e.to_string(),
            status: None,
            url: Some(input.url.clone()),
        })?;

        reg.get(&module_id)
            .map_err(|e: rusqlite::Error| ModuleNetError {
                code: "network_error".into(),
                message: e.to_string(),
                status: None,
                url: Some(input.url.clone()),
            })?
            .ok_or_else(|| ModuleNetError {
                code: "permission_denied".into(),
                message: format!("module not found: {module_id}"),
                status: None,
                url: Some(input.url.clone()),
            })?
    };

    let manifest = super::manifest::load_manifest(&entry.path).map_err(|e| ModuleNetError {
        code: "network_error".into(),
        message: format!("failed to load module manifest: {e}"),
        status: None,
        url: Some(input.url.clone()),
    })?;

    check_url_allowed(&input.url, &manifest)?;

    let client = &runtime.http_client;
    let max_bytes = input.max_bytes.unwrap_or(10_000_000).min(50_000_000);
    let response_type = input.response_type.clone().unwrap_or(NetResponseType::Json);

    let request_builder = build_request(client, &input)?;
    let response = request_builder.send().await.map_err(|e| {
        if e.is_timeout() {
            ModuleNetError {
                code: "timeout".into(),
                message: "request timed out".into(),
                status: None,
                url: None,
            }
        } else if e.is_connect() {
            ModuleNetError {
                code: "network_error".into(),
                message: format!("connection failed: {e}"),
                status: None,
                url: None,
            }
        } else {
            ModuleNetError {
                code: "network_error".into(),
                message: format!("request failed: {e}"),
                status: None,
                url: None,
            }
        }
    })?;

    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("Unknown").to_string();
    let response_url = response.url().to_string();
    let redirected = response.url().as_str() != input.url;

    let headers: HashMap<String, String> = response
        .headers()
        .iter()
        .filter(|(k, _)| {
            let lower = k.as_str().to_lowercase();
            !matches!(
                lower.as_str(),
                "transfer-encoding"
                    | "connection"
                    | "keep-alive"
                    | "proxy-authenticate"
                    | "proxy-authorization"
                    | "te"
                    | "trailer"
                    | "upgrade"
            ) && !lower.starts_with("proxy-")
        })
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let data = read_response_body(response, &response_type, max_bytes, &response_url).await?;

    Ok(ModuleNetResponse {
        ok: status.is_success(),
        status: status.as_u16(),
        status_text,
        headers,
        url: response_url,
        redirected,
        data,
    })
}

/// Reads and decodes a response body according to `response_type`.
///
/// Enforces the `max_bytes` cap before returning; binary bodies are returned as
/// base64 strings. JSON parse failures fall back to the raw text.
///
/// # Errors
///
/// Returns a [`ModuleNetError`] with code `invalid_response` when the body
/// cannot be read, or `response_too_large` when it exceeds `max_bytes`.
async fn read_response_body(
    response: reqwest::Response,
    response_type: &NetResponseType,
    max_bytes: u64,
    response_url: &str,
) -> Result<serde_json::Value, ModuleNetError> {
    match response_type {
        NetResponseType::Json | NetResponseType::Text => {
            let text = response.text().await.map_err(|e| ModuleNetError {
                code: "invalid_response".into(),
                message: format!("failed to read response body: {e}"),
                status: None,
                url: Some(response_url.into()),
            })?;

            if text.len() > max_bytes as usize {
                return Err(ModuleNetError {
                    code: "response_too_large".into(),
                    message: format!("response exceeds {} byte limit", max_bytes),
                    status: None,
                    url: Some(response_url.into()),
                });
            }

            match response_type {
                NetResponseType::Json => {
                    Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text)))
                }
                NetResponseType::Text => Ok(serde_json::Value::String(text)),
                _ => unreachable!(),
            }
        }
        NetResponseType::Bytes => {
            let bytes = response.bytes().await.map_err(|e| ModuleNetError {
                code: "invalid_response".into(),
                message: format!("failed to read response body: {e}"),
                status: None,
                url: Some(response_url.into()),
            })?;

            if bytes.len() as u64 > max_bytes {
                return Err(ModuleNetError {
                    code: "response_too_large".into(),
                    message: format!("response exceeds {} byte limit", max_bytes),
                    status: None,
                    url: Some(response_url.into()),
                });
            }

            Ok(serde_json::Value::String(
                base64::engine::general_purpose::STANDARD.encode(&bytes),
            ))
        }
        NetResponseType::None => Ok(serde_json::Value::Null),
    }
}
