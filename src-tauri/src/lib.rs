use serde::Serialize;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[cfg(target_os = "macos")]
use objc2::AllocAnyThread;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplication, NSImage};
#[cfg(target_os = "macos")]
use objc2_foundation::{MainThreadMarker, NSData};

const CODEX_RPC_MESSAGE_EVENT: &str = "codex-rpc:message";
const CODEX_RPC_STATUS_EVENT: &str = "codex-rpc:status";
const APP_UPDATE_EVENT: &str = "app-update:event";
const APP_UPDATE_ENDPOINT: &str =
    "https://github.com/bradleygibsongit/nucleus-desktop/releases/latest/download/latest.json";
const APP_UPDATE_PUBLIC_KEY: &str = include_str!("../updater-public-key.txt");

struct CodexServer {
    state: Mutex<CodexServerState>,
}

struct CodexServerState {
    process: Option<Child>,
    stdin: Option<ChildStdin>,
}

struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillSummary {
    id: String,
    name: String,
    description: String,
    directory_path: String,
    entry_path: String,
    body: String,
    has_frontmatter: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsSyncResponse {
    managed_root_path: String,
    skills: Vec<SkillSummary>,
}

struct ParsedSkillDocument {
    name: Option<String>,
    description: Option<String>,
    body: String,
    has_frontmatter: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateMetadata {
    version: String,
    current_version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    target: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateDownloadEvent {
    event: &'static str,
    chunk_length: Option<usize>,
    downloaded: Option<usize>,
    content_length: Option<u64>,
}

#[tauri::command]
async fn ensure_codex_server(
    app: AppHandle,
    state: State<'_, CodexServer>,
) -> Result<String, String> {
    let mut server_state = state.state.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut child) = server_state.process {
        match child.try_wait() {
            Ok(Some(_)) => {
                server_state.process = None;
                server_state.stdin = None;
            }
            Ok(None) => {
                return Ok("Codex App Server already running".to_string());
            }
            Err(e) => {
                log::warn!("Error checking Codex App Server status: {}", e);
                server_state.process = None;
                server_state.stdin = None;
            }
        }
    }

    let mut child = Command::new("codex")
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Codex App Server: {}", e))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture Codex App Server stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture Codex App Server stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture Codex App Server stderr".to_string())?;

    spawn_codex_stdout_pump(app.clone(), stdout);
    spawn_codex_stderr_pump(stderr);

    server_state.process = Some(child);
    server_state.stdin = Some(stdin);
    Ok("Codex App Server started".to_string())
}

#[tauri::command]
async fn stop_codex_server(state: State<'_, CodexServer>) -> Result<String, String> {
    let mut server_state = state.state.lock().map_err(|e| e.to_string())?;

    if let Some(mut child) = server_state.process.take() {
        server_state.stdin = None;
        child
            .kill()
            .map_err(|e| format!("Failed to stop Codex App Server: {}", e))?;
        child
            .wait()
            .map_err(|e| format!("Failed waiting for Codex App Server shutdown: {}", e))?;
        Ok("Codex App Server stopped".to_string())
    } else {
        Ok("Codex App Server was not running".to_string())
    }
}

#[tauri::command]
async fn codex_rpc_send(state: State<'_, CodexServer>, message: String) -> Result<(), String> {
    let mut server_state = state.state.lock().map_err(|e| e.to_string())?;

    let stdin = server_state
        .stdin
        .as_mut()
        .ok_or_else(|| "Codex App Server is not connected".to_string())?;

    stdin
        .write_all(message.as_bytes())
        .map_err(|e| format!("Failed to write to Codex App Server stdin: {}", e))?;
    stdin
        .write_all(b"\n")
        .map_err(|e| format!("Failed to terminate Codex App Server message: {}", e))?;
    stdin
        .flush()
        .map_err(|e| format!("Failed to flush Codex App Server stdin: {}", e))?;

    Ok(())
}

fn spawn_codex_stdout_pump(app: AppHandle, stdout: ChildStdout) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            match line {
                Ok(payload) => {
                    if payload.trim().is_empty() {
                        continue;
                    }

                    if let Err(error) = app.emit(CODEX_RPC_MESSAGE_EVENT, payload) {
                        log::warn!("Failed to emit Codex App Server message event: {}", error);
                    }
                }
                Err(error) => {
                    log::warn!("Failed reading Codex App Server stdout: {}", error);
                    break;
                }
            }
        }

        let _ = app.emit(CODEX_RPC_STATUS_EVENT, "closed");
    });
}

fn spawn_codex_stderr_pump(stderr: ChildStderr) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);

        for line in reader.lines() {
            match line {
                Ok(message) if !message.trim().is_empty() => {
                    log::warn!("Codex App Server stderr: {}", message);
                }
                Ok(_) => {}
                Err(error) => {
                    log::warn!("Failed reading Codex App Server stderr: {}", error);
                    break;
                }
            }
        }
    });
}

#[tauri::command]
async fn list_skills() -> Result<SkillsSyncResponse, String> {
    let managed_root = resolve_managed_skills_root()?;
    let managed_root_string = managed_root.display().to_string();

    if !managed_root.exists() {
        return Ok(SkillsSyncResponse {
            managed_root_path: managed_root_string,
            skills: Vec::new(),
        });
    }

    let entries = fs::read_dir(&managed_root)
        .map_err(|e| format!("Failed to read managed skills directory: {}", e))?;
    let mut skills = Vec::new();

    for entry_result in entries {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(error) => {
                log::warn!("Failed to read a skill directory entry: {}", error);
                continue;
            }
        };

        let directory_path = entry.path();
        if !directory_path.is_dir() {
            continue;
        }

        let entry_path = directory_path.join("SKILL.md");
        if !entry_path.exists() {
            continue;
        }

        let content = match fs::read_to_string(&entry_path) {
            Ok(content) => content,
            Err(error) => {
                log::warn!(
                    "Failed to read skill file {}: {}",
                    entry_path.display(),
                    error
                );
                continue;
            }
        };

        let parsed = parse_skill_document(&content);
        let skill_id = entry.file_name().to_string_lossy().to_string();
        let skill_name = parsed
            .name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| fallback_skill_name(&skill_id, &parsed.body));
        let skill_description = parsed
            .description
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| fallback_skill_description(&parsed.body));

        skills.push(SkillSummary {
            id: skill_id,
            name: skill_name,
            description: skill_description,
            directory_path: directory_path.display().to_string(),
            entry_path: entry_path.display().to_string(),
            body: parsed.body,
            has_frontmatter: parsed.has_frontmatter,
        });
    }

    skills.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));

    Ok(SkillsSyncResponse {
        managed_root_path: managed_root_string,
        skills,
    })
}

#[tauri::command]
async fn check_for_app_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<Option<AppUpdateMetadata>, String> {
    let update_endpoint = APP_UPDATE_ENDPOINT
        .parse()
        .map_err(|error| format!("Failed to parse app update endpoint: {}", error))?;

    let update = app
        .updater_builder()
        .pubkey(APP_UPDATE_PUBLIC_KEY.trim())
        .endpoints(vec![update_endpoint])
        .map_err(|error| format!("Failed to configure updater endpoints: {}", error))?
        .build()
        .map_err(|error| format!("Failed to build updater client: {}", error))?
        .check()
        .await
        .map_err(|error| format!("Failed to check for updates: {}", error))?;

    let metadata = update.as_ref().map(|update| AppUpdateMetadata {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        pub_date: update.date.map(|date| date.to_string()),
        target: update.target.clone(),
    });

    *pending_update
        .0
        .lock()
        .map_err(|error| format!("Failed to lock pending update state: {}", error))? = update;

    Ok(metadata)
}

#[tauri::command]
async fn install_app_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending_update
        .0
        .lock()
        .map_err(|error| format!("Failed to lock pending update state: {}", error))?
        .take()
        .ok_or_else(|| "There is no pending app update to install.".to_string())?;

    let mut has_started = false;
    let mut downloaded = 0usize;
    let app_handle = app.clone();

    update
        .download_and_install(
            move |chunk_length, content_length| {
                if !has_started {
                    let _ = app_handle.emit(
                        APP_UPDATE_EVENT,
                        AppUpdateDownloadEvent {
                            event: "started",
                            chunk_length: None,
                            downloaded: Some(0),
                            content_length,
                        },
                    );
                    has_started = true;
                }

                downloaded += chunk_length;
                let _ = app_handle.emit(
                    APP_UPDATE_EVENT,
                    AppUpdateDownloadEvent {
                        event: "progress",
                        chunk_length: Some(chunk_length),
                        downloaded: Some(downloaded),
                        content_length,
                    },
                );
            },
            {
                let app_handle = app.clone();
                move || {
                    let _ = app_handle.emit(
                        APP_UPDATE_EVENT,
                        AppUpdateDownloadEvent {
                            event: "finished",
                            chunk_length: None,
                            downloaded: None,
                            content_length: None,
                        },
                    );
                }
            },
        )
        .await
        .map_err(|error| format!("Failed to install app update: {}", error))?;

    #[cfg(target_os = "windows")]
    {
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    app.restart()
}

fn resolve_managed_skills_root() -> Result<PathBuf, String> {
    resolve_home_directory()
        .map(|home| home.join(".agents").join("skills"))
        .ok_or_else(|| {
            "Unable to resolve the user's home directory for managed skills.".to_string()
        })
}

fn resolve_home_directory() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(
            || match (env::var_os("HOMEDRIVE"), env::var_os("HOMEPATH")) {
                (Some(drive), Some(path)) => {
                    let mut combined = PathBuf::from(drive);
                    combined.push(path);
                    Some(combined)
                }
                _ => None,
            },
        )
}

fn parse_skill_document(content: &str) -> ParsedSkillDocument {
    let normalized = content.replace("\r\n", "\n");
    if !normalized.starts_with("---\n") && normalized.trim() != "---" {
        return ParsedSkillDocument {
            name: None,
            description: None,
            body: normalized.trim().to_string(),
            has_frontmatter: false,
        };
    }

    let rest = &normalized[4..];
    if let Some(frontmatter_end) = rest.find("\n---\n") {
        let frontmatter = &rest[..frontmatter_end];
        let body = rest[(frontmatter_end + 5)..].trim().to_string();
        let mut name = None;
        let mut description = None;

        for line in frontmatter.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            let Some((raw_key, raw_value)) = trimmed.split_once(':') else {
                continue;
            };

            let key = raw_key.trim();
            let value = raw_value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();

            match key {
                "name" if !value.is_empty() => name = Some(value),
                "description" if !value.is_empty() => description = Some(value),
                _ => {}
            }
        }

        return ParsedSkillDocument {
            name,
            description,
            body,
            has_frontmatter: true,
        };
    }

    ParsedSkillDocument {
        name: None,
        description: None,
        body: normalized.trim().to_string(),
        has_frontmatter: false,
    }
}

fn fallback_skill_name(skill_id: &str, body: &str) -> String {
    first_markdown_heading(body).unwrap_or_else(|| skill_id.replace('-', " "))
}

fn fallback_skill_description(body: &str) -> String {
    first_content_paragraph(body).unwrap_or_else(|| "No description found in SKILL.md".to_string())
}

fn first_markdown_heading(body: &str) -> Option<String> {
    body.lines()
        .map(str::trim)
        .find(|line| line.starts_with("# "))
        .map(|line| line.trim_start_matches("# ").trim().to_string())
}

fn first_content_paragraph(body: &str) -> Option<String> {
    let mut in_code_block = false;
    let mut paragraph_lines: Vec<String> = Vec::new();

    for raw_line in body.lines() {
        let line = raw_line.trim();

        if line.starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }

        if in_code_block {
            continue;
        }

        if line.is_empty() {
            if !paragraph_lines.is_empty() {
                break;
            }
            continue;
        }

        if line.starts_with('#') || line.starts_with('-') || line.starts_with('*') {
            if paragraph_lines.is_empty() {
                continue;
            }
            break;
        }

        paragraph_lines.push(line.to_string());
    }

    if paragraph_lines.is_empty() {
        None
    } else {
        Some(paragraph_lines.join(" "))
    }
}

fn current_window_icon() -> tauri::Result<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).map(|icon| icon.to_owned())
}

#[cfg(target_os = "macos")]
fn apply_macos_app_icon() {
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let app = NSApplication::sharedApplication(mtm);
    let data = NSData::with_bytes(include_bytes!("../icons/icon.icns"));
    let app_icon = NSImage::initWithData(NSImage::alloc(), &data).expect("creating icon");
    unsafe { app.setApplicationIconImage(Some(&app_icon)) };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(APP_UPDATE_PUBLIC_KEY.trim())
                .build(),
        )
        .manage(CodexServer {
            state: Mutex::new(CodexServerState {
                process: None,
                stdin: None,
            }),
        })
        .manage(PendingUpdate(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            ensure_codex_server,
            codex_rpc_send,
            stop_codex_server,
            list_skills,
            check_for_app_update,
            install_app_update,
        ])
        .setup(|app| {
            let icon = current_window_icon()?;
            for window in app.webview_windows().values() {
                let _ = window.set_icon(icon.clone());
            }

            #[cfg(target_os = "macos")]
            apply_macos_app_icon();

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state: State<CodexServer> = window.state();
                let mut server_state = match state.state.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };

                if let Some(mut child) = server_state.process.take() {
                    server_state.stdin = None;
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        })
        .run({
            let mut context = tauri::generate_context!();
            context.set_default_window_icon(Some(
                current_window_icon().expect("failed to load the app icon"),
            ));
            context
        })
        .expect("error while running tauri application");
}
