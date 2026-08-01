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
// RAW-BYTE TRANSPORT — the four commands that actually carry content
//
// invoke()'s default JSON serialization turns a byte array into an array of
// NUMBERS — a 500 KB bee becomes ~3 MB of JSON, and a first install pushes a
// hundred of those concurrently. Measured result: WebView2's IPC transport
// failed outright ("IPC custom protocol failed ... Failed to fetch") and the
// bundled install wrote 0/107 bees. These commands use Tauri's raw-body
// channel instead: bytes travel as bytes, metadata rides in headers.
// ---------------------------------------------------------------------------

/// Store content. Body IS the content; returns its signature.
#[tauri::command]
fn content_put_raw(host: State<'_, Host>, request: tauri::ipc::Request<'_>) -> Result<String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(HostError::Storage("content_put_raw expects a raw body".into()));
    };
    host.put(bytes)
}

/// Read content. Returns the bytes raw; absence is the NotFound error, which
/// the shim maps back to null.
#[tauri::command]
fn content_get_raw(host: State<'_, Host>, sig: String) -> Result<tauri::ipc::Response> {
    match host.get(&sig)? {
        Some(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        None => Err(HostError::NotFound),
    }
}

/// Write a marker or pool member. Body is the content; the directory address
/// and member name ride in headers (the name percent-encoded, since header
/// values are ASCII and pool members carry user-chosen names).
#[tauri::command]
fn dir_put_raw(host: State<'_, Host>, request: tauri::ipc::Request<'_>) -> Result<()> {
    let header = |key: &str| -> Result<String> {
        request
            .headers()
            .get(key)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .ok_or_else(|| HostError::Storage(format!("dir_put_raw: missing {key} header")))
    };
    let sig = header("x-hc-sig")?;
    let name = percent_decode(&header("x-hc-name")?);
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(HostError::Storage("dir_put_raw expects a raw body".into()));
    };
    host.raw_dir_put(&sig, &name, bytes)
}

/// Read a marker or pool member, raw.
#[tauri::command]
fn dir_get_raw(host: State<'_, Host>, sig: String, name: String) -> Result<tauri::ipc::Response> {
    match host.raw_dir_get(&sig, &name)? {
        Some(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        None => Err(HostError::NotFound),
    }
}

/// Minimal percent-decoding for the `x-hc-name` header (encodeURIComponent on
/// the JS side). Only %XX escapes; '+' is NOT a space in this scheme.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
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
  // console.log is forwarded FILTERED — install/boot subsystems narrate
  // through it, and those lines are exactly what a silent install stall
  // needs. Unfiltered would drown the log in render chatter.
  {
    const original = console.log.bind(console);
    console.log = (...args) => {
      original(...args);
      const first = String(args[0] ?? '');
      if (/^\[(main|ensure-install|upgrade|install|sentinel|store|layer-install|dcp)/.test(first)) {
        send('log', args.map(a => a?.stack ?? a?.message ?? a).join(' '));
      }
    };
  }
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
  // Boot milestone trace. The shell calls window.__hcBoot('<milestone>') at
  // each step of bootstrap; forwarding it shows exactly WHERE a silent boot
  // stalls — the difference between "stuck before ensureInstall" and "stuck
  // in attachImportMap" without adding a single line to the shell.
  // main.ts ASSIGNS its own __hcBoot during module evaluation, which would
  // erase a plain wrapper installed here. A property setter intercepts that
  // assignment and wraps whatever the shell installs, so the trace survives.
  let bootStep = 0;
  let inner;
  Object.defineProperty(window, '__hcBoot', {
    configurable: true,
    get: () => (label, extra) => {
      try { if (typeof inner === 'function') inner(label, extra) } catch {}
      send('boot', `#${++bootStep} ${label}${extra ? ' ' + extra : ''}`);
    },
    set: fn => { inner = fn; },
  });
  // The decisive one for a native shell: a CSP block names the directive it
  // violated and the URI it refused, which a resource error never does.
  document.addEventListener('securitypolicyviolation', e =>
    send('csp', `${e.violatedDirective} blocked ${e.blockedURI}`));
})();
"#;

/// The instance name from `--instance <name>`, sanitized to [a-z0-9-] so it
/// is always a safe directory suffix. Absent flag = "default". Each named
/// instance is a fully separate client install (own hive, own identity) —
/// how one machine runs several clients side by side from one binary.
fn instance_name() -> String {
    let mut args = std::env::args();
    while let Some(arg) = args.next() {
        if arg == "--instance" {
            if let Some(raw) = args.next() {
                let name: String = raw
                    .to_lowercase()
                    .chars()
                    .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                    .collect();
                let name = name.trim_matches('-').to_string();
                if !name.is_empty() {
                    return name;
                }
            }
        }
    }
    "default".to_string()
}

fn main() {
    let instance = instance_name();
    tauri::Builder::default()
        .setup(move |app| {
            // The hive lives beside the app's own data, not in a browser
            // sandbox. No quota, no bucket eviction, no OPFS wedge. The
            // default instance keeps the bare "hive" dir (pre-flag installs
            // are the default instance); named instances get their own.
            let dir = app
                .path()
                .app_data_dir()
                .expect("an app data directory")
                .join(if instance == "default" {
                    "hive".to_string()
                } else {
                    format!("hive-{instance}")
                });

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
            // The instance name reaches the frontend as `window.__HC_INSTANCE`
            // so client-identity names this install after it. Sanitized to
            // [a-z0-9-] above, so it embeds safely in a JS string literal.
            let title = if instance == "default" {
                "Hypercomb".to_string()
            } else {
                format!("Hypercomb - {instance}")
            };
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .title(title)
                .inner_size(1280.0, 800.0)
                .min_inner_size(640.0, 480.0)
                .theme(Some(tauri::Theme::Dark))
                .initialization_script(&format!("window.__HC_INSTANCE = '{instance}';"))
                .initialization_script(RENDERER_DIAGNOSTICS)
                .build()?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            content_put,
            content_put_raw,
            content_get_raw,
            dir_put_raw,
            dir_get_raw,
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
