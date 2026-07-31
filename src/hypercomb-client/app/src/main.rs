//! Hypercomb for Windows — the native shell.
//!
//! This process owns the hive. The web shell runs inside the window and reaches
//! the store through the commands below and nothing else.
//!
//! # The IPC surface is an allowlist, not a bridge
//!
//! Every operation the shell may perform is a named command with typed
//! arguments, enumerated in `invoke_handler`. There is deliberately no generic
//! "run this" escape hatch. That matters more here than in a typical desktop
//! app: Hypercomb adopts content from strangers, so anything the renderer can
//! reach is something adopted content can eventually reach.
//!
//! Note what is absent — no path is ever accepted from the renderer for reading
//! or writing arbitrary files. `restore` and `export` take paths, and those
//! must be sourced from a native file dialog, never from page script. Until the
//! dialog is wired they are not exposed at all.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

use hypercomb_host::{Head, Host, HostError};
use tauri::{Manager, State};

/// Commands return the host's error type directly so the renderer sees a
/// category it can act on, never an internal path or a raw storage message.
type Result<T> = std::result::Result<T, HostError>;

// ---------------------------------------------------------------------------
// content — resources, layers, optimizations are all one operation
// ---------------------------------------------------------------------------

#[tauri::command]
fn content_put(host: State<'_, Host>, bytes: Vec<u8>) -> Result<String> {
    host.put(&bytes)
}

#[tauri::command]
fn content_get(host: State<'_, Host>, sig: String) -> Result<Option<Vec<u8>>> {
    host.get(&sig)
}

#[tauri::command]
fn content_has(host: State<'_, Host>, sig: String) -> Result<bool> {
    host.has(&sig)
}

// ---------------------------------------------------------------------------
// bags — the renderer passes SEGMENTS; the host derives the address
// ---------------------------------------------------------------------------

#[tauri::command]
fn bag_address(host: State<'_, Host>, segments: Vec<String>) -> String {
    host.bag_address(&segments)
}

#[tauri::command]
fn bag_head(host: State<'_, Host>, segments: Vec<String>) -> Result<Option<Head>> {
    host.head(&segments)
}

#[tauri::command]
fn bag_append(host: State<'_, Host>, segments: Vec<String>, layer: String) -> Result<u32> {
    host.append(&segments, &layer)
}

#[tauri::command]
fn bag_markers(host: State<'_, Host>, segments: Vec<String>) -> Result<Vec<Head>> {
    host.markers(&segments)
}

// ---------------------------------------------------------------------------
// pools — the renderer passes a MEANING; the host derives the address
// ---------------------------------------------------------------------------

#[tauri::command]
fn pool_address(host: State<'_, Host>, meaning: String) -> String {
    host.pool_address(&meaning)
}

#[tauri::command]
fn pool_put(host: State<'_, Host>, meaning: String, key: String, bytes: Vec<u8>) -> Result<()> {
    host.pool_put(&meaning, &key, &bytes)
}

#[tauri::command]
fn pool_get(host: State<'_, Host>, meaning: String, key: String) -> Result<Option<Vec<u8>>> {
    host.pool_get(&meaning, &key)
}

#[tauri::command]
fn pool_list(host: State<'_, Host>, meaning: String) -> Result<Vec<String>> {
    host.pool_list(&meaning)
}

// ---------------------------------------------------------------------------
// RAW ADDRESS SURFACE — for the handle shim only
//
// These take raw 64-hex addresses and so give up the safety of the typed
// surface above. They exist because 44 files in the shell address content by
// hex name through the File System API, and shimming that API is what lets the
// existing shell run unmodified. Parity with the web shell, not a new hazard —
// but new code uses the typed commands.
// ---------------------------------------------------------------------------

#[tauri::command]
fn raw_root_entries(host: State<'_, Host>) -> Result<Vec<hypercomb_host::RawEntry>> {
    host.raw_root_entries()
}

#[tauri::command]
fn raw_dir_entries(host: State<'_, Host>, sig: String) -> Result<Vec<hypercomb_host::RawEntry>> {
    host.raw_dir_entries(&sig)
}

#[tauri::command]
fn raw_dir_get(host: State<'_, Host>, sig: String, name: String) -> Result<Option<Vec<u8>>> {
    host.raw_dir_get(&sig, &name)
}

#[tauri::command]
fn raw_dir_put(host: State<'_, Host>, sig: String, name: String, bytes: Vec<u8>) -> Result<()> {
    host.raw_dir_put(&sig, &name, &bytes)
}

#[tauri::command]
fn raw_dir_remove(host: State<'_, Host>, sig: String, name: String) -> Result<bool> {
    host.raw_dir_remove(&sig, &name)
}

/// Removing content is a no-op — see `Host::raw_remove`.
#[tauri::command]
fn raw_remove(host: State<'_, Host>, sig: String) -> Result<bool> {
    host.raw_remove(&sig)
}

// ---------------------------------------------------------------------------
// collection
// ---------------------------------------------------------------------------

/// Reclaim content no committed layer ever referenced. Never automatic.
#[tauri::command]
fn collect(host: State<'_, Host>) -> Result<hypercomb_store::Collected> {
    host.collect()
}

// ---------------------------------------------------------------------------
// diagnostics
// ---------------------------------------------------------------------------

/// Where the hive lives. Read-only — the renderer cannot set it.
#[tauri::command]
fn hive_root(host: State<'_, Host>) -> String {
    host.root().display().to_string()
}

/// Where renderer diagnostics are appended, alongside the hive.
#[derive(Debug)]
struct DiagnosticLog(std::path::PathBuf);

/// Forward a renderer-side failure to the terminal AND to a file.
///
/// A native window has no devtools you can read from a script, and a blank page
/// tells you nothing — without this, every renderer failure looks identical
/// from outside: the process is up and the window is wrong.
///
/// The file matters as much as the terminal: failures that need a human to
/// click something cannot be reproduced by launching the binary from a script,
/// so the log has to survive a normal double-click launch.
#[tauri::command]
fn renderer_log(log: State<'_, DiagnosticLog>, level: String, message: String) {
    let line = format!("[renderer:{level}] {message}\n");
    eprint!("{line}");
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&log.0) {
        let _ = file.write_all(line.as_bytes());
    }
}

/// Where the diagnostic log lives, so it can be reported rather than hunted for.
#[tauri::command]
fn diagnostic_log_path(log: State<'_, DiagnosticLog>) -> String {
    log.0.display().to_string()
}

/// Installed before any page script runs, so it catches failures during
/// bootstrap — including blocked resources, which are the ones a native shell
/// hits first.
const RENDERER_DIAGNOSTICS: &str = r#"
(() => {
  const send = (level, message) => {
    try { window.__TAURI__.core.invoke('renderer_log', { level, message: String(message).slice(0, 2000) }) }
    catch { /* bridge not up yet */ }
  };
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      send(level, args.map(a => a?.stack ?? a?.message ?? a).join(' '));
    };
  }
  window.addEventListener('error', event => {
    // Capture phase catches RESOURCE failures (css, fonts, scripts), which do
    // not bubble and never reach console.error.
    if (event.target && event.target !== window) {
      const t = event.target;
      send('resource', `${t.tagName}: ${t.src || t.href || t.currentSrc || t.outerHTML?.slice(0,120)}`);
    } else {
      send('error', event.error?.stack ?? event.message);
    }
  }, true);
  window.addEventListener('unhandledrejection', e => send('rejection', e.reason?.stack ?? e.reason));
  // The decisive one for a native shell: a CSP block names the directive it
  // violated and the URI it refused, which a resource error never does.
  document.addEventListener('securitypolicyviolation', e =>
    send('csp', `${e.violatedDirective} blocked ${e.blockedURI}`));
})();
"#;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // The hive lives beside the app's own data, not in a browser
            // sandbox. No quota, no bucket eviction, no OPFS wedge.
            let dir = app
                .path()
                .app_data_dir()
                .expect("an app data directory")
                .join("hive");

            let host = Host::open(&dir).map_err(|e| format!("opening hive at {}: {e}", dir.display()))?;
            app.manage(host);

            // Truncated per launch, so a log always describes ONE run rather
            // than an accumulating pile that hides which failure was current.
            let log_path = dir.join("renderer.log");
            let _ = std::fs::write(&log_path, b"");
            eprintln!("[hypercomb] renderer diagnostics -> {}", log_path.display());
            app.manage(DiagnosticLog(log_path));

            // Built here rather than declared in tauri.conf.json so the
            // diagnostics script can be installed BEFORE any page script runs.
            // A window declared in config is created too early to attach one.
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .title("Hypercomb")
                .inner_size(1280.0, 800.0)
                .min_inner_size(640.0, 480.0)
                .theme(Some(tauri::Theme::Dark))
                .initialization_script(RENDERER_DIAGNOSTICS)
                .build()?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            content_put,
            content_get,
            content_has,
            bag_address,
            bag_head,
            bag_append,
            bag_markers,
            pool_address,
            pool_put,
            pool_get,
            pool_list,
            raw_root_entries,
            raw_dir_entries,
            raw_dir_get,
            raw_dir_put,
            raw_dir_remove,
            raw_remove,
            collect,
            hive_root,
            renderer_log,
            diagnostic_log_path,
        ])
        .run(tauri::generate_context!())
        .expect("running the Hypercomb window");
}
