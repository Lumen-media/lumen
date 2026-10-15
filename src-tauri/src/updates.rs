//! Auto-update for the desktop app, orchestrated entirely on the Rust side.
//!
//! The Tauri updater plugin exposes `download() -> Vec<u8>` and
//! `install(&[u8])`, which is what makes the "remind me later" flow possible:
//! a verified artifact can be written to disk, survive a process restart and
//! be installed on the next launch without asking the endpoint again.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// File, inside the updates directory, that tracks the deferred artifact and
/// the dismissed version.
const STATE_FILE: &str = "updater.json";
/// Tauri event emitted to the frontend whenever the update state advances.
const PROGRESS_EVENT: &str = "app-update-progress";
/// The endpoint is a third party and the splash screen waits on this, so never
/// let the request outlive a short window.
const CHECK_TIMEOUT_SECS: u64 = 8;

/// Current step of the update lifecycle, mirrored to the frontend under the
/// `app-update-progress` event.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    /// Lifecycle state: one of `idle`, `checking`, `up-to-date`, `available`,
    /// `downloading`, `ready`, `deferred`, `installing` or `error`.
    pub state: String,
    /// Version the state refers to, when known.
    pub version: Option<String>,
    /// Bytes downloaded so far during `downloading`/`ready`.
    pub downloaded: u64,
    /// Total artifact size in bytes, once the server reports it.
    pub total: Option<u64>,
    /// Error message when `state` is `error`.
    pub error: Option<String>,
}

impl UpdateProgress {
    fn of(state: &str, version: Option<String>) -> Self {
        Self {
            state: state.to_string(),
            version,
            ..Default::default()
        }
    }
}

/// Description of an available update, shown in the update dialog.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// Version string of the available release.
    pub version: String,
    /// Release notes (changelog body), when the manifest provides them.
    pub notes: Option<String>,
    /// Publish date as unix seconds so the frontend can localize it.
    pub date: Option<i64>,
}

/// Result of [`app_update_boot`], telling the splash screen whether it must
/// keep waiting for a restart.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BootUpdateState {
    /// True while a previously deferred artifact is being applied. The splash
    /// screen must hold itself open until the process restarts.
    pub applying: bool,
    /// Version being applied, when `applying` is true.
    pub version: Option<String>,
}

impl BootUpdateState {
    fn idle() -> Self {
        Self {
            applying: false,
            version: None,
        }
    }
}

/// A verified update artifact that was downloaded and stashed on disk so it
/// can be installed on a later launch.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PendingArtifact {
    /// Version the artifact belongs to.
    version: String,
    /// Updater target triple the artifact was built for.
    target: String,
    /// File name of the artifact inside the updates directory.
    artifact: String,
    /// BLAKE3 digest of the artifact, re-checked before installing.
    digest: String,
    /// Set immediately before handing the bytes to the platform installer.
    /// If we come back with this still set, the previous attempt died.
    installing: bool,
}

/// On-disk updater bookkeeping, serialized as `updater.json`.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct UpdaterState {
    /// Version the user explicitly postponed, so we stop nagging about it.
    dismissed_version: Option<String>,
    /// Artifact downloaded for a later launch, if any.
    pending: Option<PendingArtifact>,
}

/// Tauri-managed state tracking the update currently offered to the user and
/// the latest progress snapshot.
pub struct UpdateState {
    /// Update handle produced by a successful check and consumed by install or
    /// defer; `None` when no update is on offer.
    offered: Mutex<Option<Update>>,
    /// Most recent progress value, served synchronously to late frontend
    /// subscribers.
    progress: Mutex<UpdateProgress>,
}

impl Default for UpdateState {
    fn default() -> Self {
        Self {
            offered: Mutex::new(None),
            progress: Mutex::new(UpdateProgress::of("idle", None)),
        }
    }
}

/// Directory that holds the updater state file and deferred artifacts.
fn updates_dir() -> Result<PathBuf, String> {
    Ok(crate::paths::app_base_dir()?.join("updates"))
}

/// Reads [`UpdaterState`] from disk, falling back to defaults when it is
/// missing or unreadable.
fn read_state() -> UpdaterState {
    let Ok(path) = updates_dir().map(|dir| dir.join(STATE_FILE)) else {
        return UpdaterState::default();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Writes [`UpdaterState`] to disk as pretty-printed JSON, creating the
/// updates directory if needed.
fn write_state(state: &UpdaterState) -> Result<(), String> {
    let dir = updates_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(dir.join(STATE_FILE), raw).map_err(|e| e.to_string())
}

/// Clears both the dismissed version and the pending artifact.
fn forget_pending() -> Result<(), String> {
    let mut state = read_state();
    state.dismissed_version = None;
    state.pending = None;
    write_state(&state)
}

/// Flags the pending artifact as (not) being installed, so an interrupted
/// attempt can be detected on the next launch.
fn set_installing(installing: bool) -> Result<(), String> {
    let mut state = read_state();
    if let Some(pending) = state.pending.as_mut() {
        pending.installing = installing;
    }
    write_state(&state)
}

/// Stores `next` as the current progress (when the state is managed) and
/// emits it to the frontend.
fn emit_progress(app: &AppHandle, next: UpdateProgress) {
    if let Some(state) = app.try_state::<UpdateState>() {
        if let Ok(mut guard) = state.progress.lock() {
            *guard = next.clone();
        }
    }
    let _ = app.emit(PROGRESS_EVENT, next);
}

/// `check()` talks to a remote endpoint and has no timeout of its own. Wrap it
/// so a slow or hanging endpoint cannot stall the caller forever.
async fn check_with_timeout(app: &AppHandle) -> Result<Option<Update>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match tokio::time::timeout(
        std::time::Duration::from_secs(CHECK_TIMEOUT_SECS),
        updater.check(),
    )
    .await
    {
        Ok(result) => result.map_err(|e| e.to_string()),
        Err(_) => Err(format!("update check timed out after {CHECK_TIMEOUT_SECS}s")),
    }
}

/// Downloads the artifact for `update`, emitting `downloading` progress
/// frames as bytes arrive, and returns the full payload.
async fn download_with_progress(app: &AppHandle, update: &Update) -> Result<Vec<u8>, String> {
    let version = update.version.clone();
    let mut downloaded = 0u64;
    let mut total: Option<u64> = None;

    emit_progress(
        app,
        UpdateProgress {
            state: "downloading".to_string(),
            version: Some(version.clone()),
            downloaded: 0,
            total: None,
            error: None,
        },
    );

    let bytes = update
        .download(
            |chunk, content_length| {
                downloaded += chunk as u64;
                if total.is_none() {
                    total = content_length;
                }
                emit_progress(
                    app,
                    UpdateProgress {
                        state: "downloading".to_string(),
                        version: Some(version.clone()),
                        downloaded,
                        total,
                        error: None,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(bytes)
}

/// Stash a verified artifact on disk so the next launch can install it.
async fn defer_to_disk(app: &AppHandle, update: &Update) -> Result<(), String> {
    let bytes = download_with_progress(app, update).await?;

    let version = update.version.clone();
    let target = update.target.clone();
    let dir = updates_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let artifact = format!("{version}-{target}.bin");
    fs::write(dir.join(&artifact), &bytes).map_err(|e| e.to_string())?;

    let digest = blake3::hash(&bytes).to_hex().to_string();
    let mut state = read_state();
    state.dismissed_version = Some(version.clone());
    state.pending = Some(PendingArtifact {
        version: version.clone(),
        target,
        artifact,
        digest,
        installing: false,
    });
    write_state(&state)?;

    let mut progress = UpdateProgress::of("ready", Some(version));
    progress.downloaded = bytes.len() as u64;
    progress.total = Some(bytes.len() as u64);
    emit_progress(app, progress);
    Ok(())
}

/// Hand the bytes to the platform installer. On Windows the plugin launches
/// the installer and terminates the process, so nothing after this runs.
fn install_bytes(app: &AppHandle, update: &Update, bytes: &[u8]) -> Result<(), String> {
    update.install(bytes).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    app.restart();
    #[cfg(target_os = "windows")]
    let _ = app;
    Ok(())
}

/// Best-effort deletion of a stashed artifact file.
fn discard_artifact(pending: &PendingArtifact) {
    if let Ok(dir) = updates_dir() {
        let _ = fs::remove_file(dir.join(&pending.artifact));
    }
}

/// Returns the latest update-progress snapshot.
///
/// Frontend API: invoke `app_update_progress_state` with no arguments;
/// resolves with an [`UpdateProgress`]. Used by surfaces that mount after a
/// progress event has already been emitted.
#[tauri::command]
pub fn app_update_progress_state(state: State<'_, UpdateState>) -> UpdateProgress {
    state
        .progress
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

/// Checks the update endpoint for a newer release.
///
/// Frontend API: invoke `check_app_update` with an optional `force` flag;
/// resolves with an [`UpdateInfo`] when an update is available, or `null`
/// otherwise. A version the user previously dismissed is skipped unless
/// `force` is true. On success the update handle is stored in [`UpdateState`]
/// for [`install_app_update`]/[`defer_app_update`], and progress frames are
/// emitted throughout.
///
/// # Errors
///
/// Returns an error string when the updater is unavailable, the request times
/// out, or the endpoint reports a failure.
#[tauri::command]
pub async fn check_app_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
    force: Option<bool>,
) -> Result<Option<UpdateInfo>, String> {
    emit_progress(&app, UpdateProgress::of("checking", None));

    let found = check_with_timeout(&app).await?;

    let Some(update) = found else {
        emit_progress(&app, UpdateProgress::of("up-to-date", None));
        return Ok(None);
    };

    if !force.unwrap_or(false) && read_state().dismissed_version.as_deref() == Some(&update.version) {
        emit_progress(&app, UpdateProgress::of("idle", None));
        return Ok(None);
    }

    let info = UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|d| d.unix_timestamp()),
    };

    if let Ok(mut guard) = state.offered.lock() {
        *guard = Some(update);
    }
    emit_progress(
        &app,
        UpdateProgress::of("available", Some(info.version.clone())),
    );

    Ok(Some(info))
}

/// Downloads the offered update and installs it immediately.
///
/// Frontend API: invoke `install_app_update` with no arguments. The update
/// handle stored by [`check_app_update`] is consumed; progress frames track
/// the download and the `installing` step. On Windows this terminates the
/// process as the installer launches.
///
/// # Errors
///
/// Returns an error string when no update is currently offered or the
/// download/installation fails; an `error` progress frame is emitted too.
#[tauri::command]
pub async fn install_app_update(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    let update = state
        .offered
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "no update is currently offered".to_string())?;

    let version = update.version.clone();
    let bytes = match download_with_progress(&app, &update).await {
        Ok(bytes) => bytes,
        Err(e) => {
            emit_progress(
                &app,
                UpdateProgress {
                    state: "error".to_string(),
                    version: Some(version),
                    downloaded: 0,
                    total: None,
                    error: Some(e.clone()),
                },
            );
            return Err(e);
        }
    };

    emit_progress(
        &app,
        UpdateProgress::of("installing", Some(version.clone())),
    );
    install_bytes(&app, &update, &bytes)
}

/// Downloads the offered update in the background and stashes it for the next
/// launch ("remind me later" flow).
///
/// Frontend API: invoke `defer_app_update` with no arguments. The call
/// resolves as soon as the download is scheduled; a `deferred` frame is
/// emitted immediately while the artifact is fetched asynchronously, then a
/// `ready` or `error` frame follows. The version is remembered so the user is
/// not nagged about it again.
///
/// # Errors
///
/// Returns an error string when no update is currently offered; download
/// failures are reported through progress frames instead.
#[tauri::command]
pub async fn defer_app_update(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    let update = state
        .offered
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "no update is currently offered".to_string())?;

    let version = update.version.clone();
    let task_version = version.clone();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = defer_to_disk(&handle, &update).await {
            emit_progress(
                &handle,
                UpdateProgress {
                    state: "error".to_string(),
                    version: Some(task_version),
                    downloaded: 0,
                    total: None,
                    error: Some(e),
                },
            );
        }
    });

    emit_progress(&app, UpdateProgress::of("deferred", Some(version)));
    Ok(())
}

/// Applied once by the splash screen to install a previously deferred
/// artifact before the main window is allowed to appear.
///
/// Frontend API: invoke `app_update_boot` with no arguments; resolves with a
/// [`BootUpdateState`]. When `applying` is true the splash screen must stay
/// open until the process restarts. Stale or corrupted artifacts (interrupted
/// installs, digest mismatches, superseded versions) are discarded and an
/// idle state is returned so the app can boot normally.
///
/// # Errors
///
/// Returns an error string when the update handle check or the state
/// bookkeeping fails; a missing or invalid artifact is not an error and
/// simply yields an idle state.
#[tauri::command]
pub async fn app_update_boot(app: AppHandle) -> Result<BootUpdateState, String> {
    let Some(pending) = read_state().pending else {
        return Ok(BootUpdateState::idle());
    };

    // An attempt that never finished: drop it rather than risk a boot loop.
    if pending.installing {
        eprintln!("updater: discarding artifact from an interrupted install attempt");
        discard_artifact(&pending);
        forget_pending()?;
        return Ok(BootUpdateState::idle());
    }

    let path = match updates_dir() {
        Ok(dir) => dir.join(&pending.artifact),
        Err(e) => return Err(e),
    };

    let Ok(bytes) = fs::read(&path) else {
        eprintln!("updater: pending artifact is missing on disk");
        discard_artifact(&pending);
        forget_pending()?;
        return Ok(BootUpdateState::idle());
    };

    if blake3::hash(&bytes).to_hex().to_string() != pending.digest {
        eprintln!("updater: pending artifact failed the integrity check");
        discard_artifact(&pending);
        forget_pending()?;
        return Ok(BootUpdateState::idle());
    }

    // `install` needs a live update handle, and it must describe the exact
    // artifact we already downloaded.
    let found = check_with_timeout(&app).await;

    let update = match found {
        Ok(Some(update)) if update.version == pending.version => update,
        Ok(_) => {
            eprintln!("updater: deferred artifact is superseded, discarding it");
            discard_artifact(&pending);
            forget_pending()?;
            return Ok(BootUpdateState::idle());
        }
        Err(e) => {
            eprintln!("updater: deferred install deferred to a later launch: {e}");
            return Ok(BootUpdateState::idle());
        }
    };
    set_installing(true)?;
    emit_progress(
        &app,
        UpdateProgress::of("installing", Some(pending.version.clone())),
    );

    let version = pending.version.clone();
    let task_version = version.clone();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = install_bytes(&handle, &update, &bytes) {
            eprintln!("updater: failed to install {task_version}: {e}");
            emit_progress(
                &handle,
                UpdateProgress {
                    state: "error".to_string(),
                    version: Some(task_version),
                    downloaded: 0,
                    total: None,
                    error: Some(e),
                },
            );
            // Allow a retry on the next launch.
            let _ = set_installing(false);
            return;
        }

        // On Windows the process is already gone by now; the next launch sees
        // the `installing` flag and cleans up the stale artifact.
        #[cfg(not(target_os = "windows"))]
        {
            let _ = forget_pending();
        }
    });

    Ok(BootUpdateState {
        applying: true,
        version: Some(version),
    })
}
