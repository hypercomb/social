//! Hypercomb — the native shell (Windows and macOS from one source).
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

#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

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

/// Hand a link to the operating system.
///
/// A native window is not a browser: `window.open(url, '_blank')` returns null
/// and does nothing, `target="_blank"` does nothing, and a plain `<a href>`
/// navigates the WHOLE webview off `tauri.localhost` — with no address bar to
/// come back from. So an external link either goes through here or it is dead
/// on the desktop. (All three measured in WebView2, 2026-08-03.)
///
/// The renderer decides WHICH links are external; this decides what may leave
/// the app. Hypercomb adopts content from strangers, so the scheme allowlist is
/// the security boundary, not a formality: it is checked here, against the
/// parsed URL, and no shell interpreter is involved on either platform — the
/// URL is passed as a single argument to a program that expects exactly one.
#[tauri::command]
fn open_external(url: String) -> Result<()> {
    let scheme_ok = ["http://", "https://", "mailto:", "tel:"]
        .iter()
        .any(|prefix| url.len() > prefix.len() && url[..prefix.len()].eq_ignore_ascii_case(prefix));
    // A control character or a newline is how a single argument becomes two.
    let clean = !url.chars().any(|c| c.is_control()) && url.len() <= 4096;
    if !scheme_ok || !clean {
        return Err(HostError::Storage(format!("refusing to open {url:?}")));
    }

    let spawned = if cfg!(target_os = "windows") {
        // NOT `cmd /C start`: that one parses its argument as a command line.
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(&url).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(&url).spawn()
    };
    spawned
        .map(|_| ())
        .map_err(|err| HostError::Storage(format!("could not open {url:?}: {err}")))
}

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
  // JavaScriptCore's error.stack is FRAMES ONLY. V8 leads its stack with
  // "Name: message"; WebKit does not, so forwarding the stack alone is how a
  // boot-killing rejection reached the log as three anonymous frames and a
  // native `register`, with nothing anywhere saying what actually went wrong.
  // Lead with the message when the stack is missing it.
  const describe = value => {
    if (!(value instanceof Error)) return value?.stack ?? value?.message ?? value;
    const stack = value.stack ?? '';
    if (stack.startsWith(value.name)) return stack;
    const head = value.name + ': ' + value.message;
    return stack ? head + '\n' + stack : head;
  };
  // console.log is forwarded FILTERED — install/boot subsystems narrate
  // through it, and those lines are exactly what a silent install stall
  // needs. Unfiltered would drown the log in render chatter.
  {
    const original = console.log.bind(console);
    console.log = (...args) => {
      original(...args);
      const first = String(args[0] ?? '');
      if (/^\[(main|ensure-install|upgrade|install|sentinel|store|layer-install|dcp|script-preloader|atlas|io)/.test(first)) {
        send('log', args.map(describe).join(' '));
      }
    };
  }
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      send(level, args.map(describe).join(' '));
    };
  }
  window.addEventListener('error', event => {
    // Capture phase catches RESOURCE failures (css, fonts, scripts), which do
    // not bubble and never reach console.error.
    if (event.target && event.target !== window) {
      const t = event.target;
      send('resource', `${t.tagName}: ${t.src || t.href || t.currentSrc || t.outerHTML?.slice(0,120)}`);
    } else {
      send('error', event.error ? describe(event.error) : event.message);
    }
  }, true);
  window.addEventListener('unhandledrejection', e => send('rejection', describe(e.reason)));
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

// ---------------------------------------------------------------------------
// backup — the folder this hive can be rebuilt from
//
// Three things separate a backup from an export, and all three live here:
// something has to REMEMBER where it goes, something has to say WHEN it last
// happened, and only one of them may run at a time.
// ---------------------------------------------------------------------------

/// One backup or restore at a time, process-wide.
///
/// Two exports into one folder would each write temp files for the same paths
/// and each report a count that is not the whole story; a restore racing an
/// export would read a folder being written underneath it. The menu can be
/// clicked twice before the first dialog appears, and the launch backup starts
/// on its own — so the guard is not defensive, it is reachable.
static HIVE_TRANSFER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Clears [`HIVE_TRANSFER_RUNNING`] however the transfer ends — a cancelled
/// picker and an early `return` included. A flag released only on the happy
/// path is a flag that eventually stays set and disables the menu for the rest
/// of the session.
struct BusyGuard;

impl Drop for BusyGuard {
    fn drop(&mut self) {
        HIVE_TRANSFER_RUNNING.store(false, Ordering::SeqCst);
    }
}

/// Where the remembered backup folder is written down.
///
/// Beside the hive, not inside it. The store holds the hive's content; this is
/// a fact about THIS MACHINE, and it must survive a restore of someone else's
/// backup without travelling in one. Beside the hive also means a named
/// instance remembers its own folder, which is the only sane answer when two
/// instances back up to two places.
fn backup_target_path(hive_dir: &Path) -> PathBuf {
    hive_dir.join("backup-target.txt")
}

/// The folder this hive backs itself up to, if one has ever been chosen.
fn read_backup_target(hive_dir: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(backup_target_path(hive_dir)).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

fn write_backup_target(hive_dir: &Path, target: &Path) {
    if let Err(e) = std::fs::write(backup_target_path(hive_dir), target.to_string_lossy().as_bytes()) {
        eprintln!("[hypercomb] could not remember the backup folder: {e}");
    }
}

fn forget_backup_target(hive_dir: &Path) {
    let _ = std::fs::remove_file(backup_target_path(hive_dir));
}

/// Is `path` the same place as `root`, or somewhere beneath it?
///
/// Canonicalized first, so a junction, a `..` and a short 8.3 name all answer
/// honestly. A path that cannot be canonicalized (it does not exist yet) is
/// compared as given — the wrong answer there is "not inside", which is the
/// safe direction: it declines to block a folder it cannot prove is a problem.
fn is_inside(path: &Path, root: &Path) -> bool {
    let real = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    real(path).starts_with(real(root))
}

/// Leave a note in the folder saying what it is and when it was last written.
///
/// `restore` ignores every name that is not signature-shaped, so this is inert
/// to the format. It exists for the person who opens the folder a year from now
/// and finds forty thousand hex names with no other clue — and for the question
/// that actually matters in a recovery, which is not "is there a backup" but
/// "how old is it, and did it verify".
fn write_backup_receipt(
    target: &Path,
    instance: &str,
    moved: &hypercomb_store::interchange::Transfer,
    checked: Option<&hypercomb_store::interchange::Verification>,
) {
    let receipt = serde_json::json!({
        "what": "A Hypercomb hive in interchange form. Restore it with Hive ▸ Restore Into Hive… \
                 Content is named by the SHA-256 of its own bytes; directories are lineage sigbags \
                 and pools of meaning. Nothing here is ever deleted by a backup.",
        "format": "hypercomb-interchange/1",
        "written": iso_utc_now(),
        "instance": instance,
        "app_version": env!("CARGO_PKG_VERSION"),
        "last_transfer": moved,
        "verified": checked.map(|v| v.complete()),
        "verification": checked,
    });
    let path = target.join("hypercomb-backup.json");
    match serde_json::to_vec_pretty(&receipt) {
        Ok(bytes) => {
            if let Err(e) = std::fs::write(&path, bytes) {
                eprintln!("[hypercomb] could not write {}: {e}", path.display());
            }
        }
        Err(e) => eprintln!("[hypercomb] could not build the backup receipt: {e}"),
    }
}

/// `YYYY-MM-DDTHH:MM:SSZ` from the system clock.
///
/// Hinnant's civil-from-days, exact for every date the epoch can express. A
/// date library for one timestamp in one file would be a poor trade: this is
/// twenty lines, has no version, and cannot break.
fn iso_utc_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (days, time) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));

    // Shift the epoch to 0000-03-01 so leap day lands at the END of the cycle
    // and every month has a fixed length in the sequence.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_position = (5 * day_of_year + 2) / 153;

    let day = day_of_year - (153 * month_position + 2) / 5 + 1;
    let month = if month_position < 10 { month_position + 3 } else { month_position - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);

    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        time / 3_600,
        (time % 3_600) / 60,
        time % 60
    )
}

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

// ---------------------------------------------------------------------------
// hosting — the hive, served to other machines
//
// A published hive is a static host: a shim build, plus the interchange form of
// the content, behind seven rules that `hypercomb-shim/host/check-host.mjs`
// tests. `hypercomb-serve` answers all of it live out of THIS store, so the
// desktop app can be the origin other nodes replicate from without exporting a
// folder first and without anything running in a cloud.
//
// The renderer cannot reach any of this. Serving is a native menu action, the
// same as backup — page script chooses no port, learns no address, and cannot
// turn the host on. Adopted content runs in that renderer.
// ---------------------------------------------------------------------------

/// The hive, read through the app that owns it.
///
/// The store is one memory-mapped database with a single writer, so the host
/// must NOT open its own — it reads through the `Host` already in app state.
/// An `AppHandle` is `Send + Sync + 'static`, which is exactly what the
/// listener threads need and what a `State` guard could never be.
#[derive(Debug)]
struct AppHive(tauri::AppHandle);

impl hypercomb_serve::HiveSource for AppHive {
    fn content(&self, sig: &str) -> Option<Vec<u8>> {
        self.0.state::<Host>().raw_get(sig).ok().flatten()
    }

    fn entry(&self, sig: &str, name: &str) -> Option<Vec<u8>> {
        self.0.state::<Host>().raw_dir_get(sig, name).ok().flatten()
    }
}

/// The running host, or nothing. Managed state so the menu can stop what the
/// menu started, and so quitting drops the listener with the app.
#[derive(Debug, Default)]
struct Hosting(std::sync::Mutex<Option<hypercomb_serve::Serving>>);

/// Ports tried, in order. A fixed first choice matters — an address someone
/// wrote down should still work tomorrow — but a second instance, or a dev
/// server on the same machine, must not turn "serve" into a dead end.
const HOST_PORTS: std::ops::RangeInclusive<u16> = 4270..=4279;

/// The shell a visitor's browser boots: a built `hypercomb-shim/dist`.
///
/// Bundled as a resource rather than assembled here, because it is not ours to
/// improvise: `/pin` names a bootstrap bundle whose bytes must hash to it, and
/// the shim build is what mints that pair.
fn host_shell(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(path) = app
        .path()
        .resolve("host-shell", tauri::path::BaseDirectory::Resource)
    {
        if path.join("index.html").is_file() && path.join("pin").is_file() {
            return Some(path);
        }
    }
    // Development only: serve the repo's own shim build, so `tauri dev` can
    // host without a staging step. Never compiled into a release binary — a
    // shipped app must not depend on a path from the machine that built it.
    if cfg!(debug_assertions) {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../hypercomb-shim/dist");
        if repo.join("index.html").is_file() {
            return Some(repo);
        }
    }
    None
}

/// Start serving, returning the address to hand out.
fn start_hosting(app: &tauri::AppHandle) -> std::result::Result<String, String> {
    let Some(shell) = host_shell(app) else {
        return Err(
            "This build has no host shell.\n\n\
             Serving needs a built hypercomb-shim (its index.html, /pin and the packages a \
             first-time visitor boots from), staged into the app as `host-shell`. Build one with \
             `npm run build:shim`, then `node hypercomb-client/scripts/stage-host-shell.mjs`."
                .to_string(),
        );
    };

    let hive: std::sync::Arc<dyn hypercomb_serve::HiveSource> =
        std::sync::Arc::new(AppHive(app.clone()));
    let mut last: Option<String> = None;

    for port in HOST_PORTS {
        // Every interface, not loopback: a host nobody else can reach is not a
        // host. What it is reachable BY is the network's business — a LAN, a
        // tunnel, a forwarded port.
        match hypercomb_serve::serve(&shell, hive.clone(), hypercomb_serve::ANY, port) {
            Ok(serving) => {
                let url = serving.lan_url();
                match app.state::<Hosting>().0.lock() {
                    Ok(mut held) => *held = Some(serving),
                    // A poisoned lock means a previous handler panicked while
                    // holding it. Stop the listener we just started rather than
                    // leak one nothing can turn off.
                    Err(_) => {
                        serving.stop();
                        return Err("The hosting state is not usable — restart the app.".into());
                    }
                }
                return Ok(url);
            }
            Err(e) => last = Some(e.to_string()),
        }
    }

    Err(format!(
        "No free port between {} and {}.\n\n{}",
        HOST_PORTS.start(),
        HOST_PORTS.end(),
        last.unwrap_or_default()
    ))
}

/// Stop serving. Returns whether anything was running.
fn stop_hosting(app: &tauri::AppHandle) -> bool {
    let taken = app
        .state::<Hosting>()
        .0
        .lock()
        .ok()
        .and_then(|mut held| held.take());
    match taken {
        Some(serving) => {
            serving.stop();
            true
        }
        None => false,
    }
}

fn main() {
    let instance = instance_name();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            // Not serving until asked. Managed here so the listener is owned by
            // the app and dies with it — a host that outlived its window would
            // keep publishing a hive nobody is looking at.
            app.manage(Hosting::default());

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
                .initialization_script(format!("window.__HC_INSTANCE = '{instance}';"))
                .initialization_script(RENDERER_DIAGNOSTICS)
                .build()?;

            // ── Hive menu: backup and restore ─────────────────────────────
            //
            // File operations live in a NATIVE menu with NATIVE pickers, on
            // purpose: the renderer never supplies a filesystem path (see the
            // module docs — that rule is what keeps adopted content from ever
            // reaching the disk).
            //
            // Backup is the FULL-STORE export, not the root closure. That is
            // the whole difference between an interchange form and a backup:
            // `export_root` walks one root by NAME and deliberately leaves
            // pools behind, so a hive backed up that way came back without its
            // threads, its clipboard, its hidden marks, its collections and
            // its behaviour roster — and without any root the walk could not
            // reach by name. Everything the store holds travels here.
            //
            // Restore is the generalized union (exists → skip, bags merge,
            // idempotent), so restoring a backup twice or restoring another
            // hive's backup over this one is always safe.
            {
                use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};

                let remembered = read_backup_target(&dir);

                let backup = MenuItemBuilder::with_id("hive-backup", "Back Up Hive…").build(app)?;
                let backup_again = MenuItemBuilder::with_id("hive-backup-again", "Back Up Again")
                    .enabled(remembered.is_some())
                    .build(app)?;
                let restore = MenuItemBuilder::with_id("hive-restore", "Restore Into Hive…").build(app)?;
                let forget = MenuItemBuilder::with_id("hive-forget-backup", "Forget Backup Folder")
                    .enabled(remembered.is_some())
                    .build(app)?;
                let serve_item = MenuItemBuilder::with_id("hive-serve", "Serve This Hive…").build(app)?;
                let serve_stop = MenuItemBuilder::with_id("hive-serve-stop", "Stop Serving")
                    .enabled(false)
                    .build(app)?;
                let hive = SubmenuBuilder::new(app, "Hive")
                    .item(&backup)
                    .item(&backup_again)
                    .separator()
                    .item(&restore)
                    .separator()
                    .item(&serve_item)
                    .item(&serve_stop)
                    .separator()
                    .item(&forget)
                    .build()?;

                // On macOS the menu bar is the APPLICATION's, not the window's,
                // and the standard submenus carry key equivalents the system
                // will not supply otherwise: Cmd+Q to quit, and — the one that
                // bites — the Edit menu, which is what makes Cmd+C/V/X/A work
                // inside a WKWebView. A menu built from scratch would leave the
                // hive unable to copy text. So macOS starts from the platform
                // default and APPENDS; Windows, where none of that applies and
                // a menu bar is chrome we would rather not spend, keeps the
                // single Hive menu it already had.
                let menu = if cfg!(target_os = "macos") {
                    let menu = Menu::default(app.handle())?;
                    menu.append(&hive)?;
                    menu
                } else {
                    MenuBuilder::new(app).item(&hive).build()?
                };
                app.set_menu(menu)?;

                // ── The backup that happens without being asked ────────────
                //
                // A menu item is not a backup strategy; it is a thing you
                // remember to click until the day it matters. Once a folder has
                // been chosen ONCE, every launch tops it up. The export is
                // skip-if-exists, so a second run writes only what is new and
                // costs a stat per signature — and because the target is never
                // cleared, the folder is a growing archive rather than a
                // rolling window: content that leaves the hive stays in it.
                //
                // Silent by design. It reports to the launch log; a modal on
                // startup would only teach the user to dismiss backups.
                if let Some(target) = remembered.clone() {
                    let handle = app.handle().clone();
                    let launch_instance = instance.clone();
                    std::thread::spawn(move || {
                        if !target.is_dir() {
                            eprintln!(
                                "[hypercomb] backup folder {} is not reachable — skipping launch backup",
                                target.display()
                            );
                            return;
                        }
                        if HIVE_TRANSFER_RUNNING.swap(true, Ordering::SeqCst) {
                            return;
                        }
                        let _busy = BusyGuard;
                        match handle.state::<Host>().export(&target) {
                            Ok(moved) => {
                                eprintln!(
                                    "[hypercomb] launch backup -> {}: {} new content, {} new markers, {} new pool members",
                                    target.display(),
                                    moved.content,
                                    moved.markers,
                                    moved.pool_members
                                );
                                // Not verified — a full read of the folder on
                                // every launch would be a tax on a machine that
                                // may never need it. The receipt still lands, so
                                // "how old is my backup" has an answer without
                                // one.
                                write_backup_receipt(&target, &launch_instance, &moved, None);
                            }
                            Err(e) => eprintln!("[hypercomb] launch backup failed: {e}"),
                        }
                    });
                }

                let hive_dir = dir.clone();
                let instance_label = instance.clone();
                app.on_menu_event(move |app, event| {
                    let id = event.id().as_ref().to_string();

                    // ── Serving ───────────────────────────────────────────
                    //
                    // Ahead of the backup branch and on its own thread: binding
                    // a socket is fast, but the dialog that reports the address
                    // is modal, and a modal on the menu thread freezes the
                    // window it belongs to.
                    if id == "hive-serve" || id == "hive-serve-stop" {
                        let app = app.clone();
                        let serve_item = serve_item.clone();
                        let serve_stop = serve_stop.clone();
                        std::thread::spawn(move || {
                            use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

                            if id == "hive-serve-stop" {
                                let was_serving = stop_hosting(&app);
                                let _ = serve_item.set_enabled(true);
                                let _ = serve_stop.set_enabled(false);
                                let _ = serve_stop.set_text("Stop Serving");
                                if was_serving {
                                    app.dialog()
                                        .message(
                                            "This hive is no longer served.\n\n\
                                             Nothing was removed. Anyone who already replicated from \
                                             it keeps what they pulled — they verified every byte \
                                             against its own signature when they took it.",
                                        )
                                        .title("Stopped Serving")
                                        .blocking_show();
                                }
                                return;
                            }

                            match start_hosting(&app) {
                                Ok(url) => {
                                    let _ = serve_item.set_enabled(false);
                                    let _ = serve_stop.set_enabled(true);
                                    let _ = serve_stop.set_text(format!(
                                        "Stop Serving ({})",
                                        url.trim_start_matches("http://")
                                    ));
                                    app.dialog()
                                        .message(format!(
                                            "This hive is being served at\n\n    {url}\n\n\
                                             Anyone who can reach that address can open the hive and \
                                             replicate from it. Every byte they take is checked \
                                             against its own signature, so a host can cost them a \
                                             404 but never a wrong answer.\n\n\
                                             It speaks plain HTTP and holds no certificate. To put \
                                             it on the internet, forward the port, or run a tunnel \
                                             or a reverse proxy in front of it.",
                                        ))
                                        .title("Serving This Hive")
                                        .blocking_show();
                                }
                                Err(why) => {
                                    app.dialog()
                                        .message(why)
                                        .kind(MessageDialogKind::Warning)
                                        .title("Could Not Serve")
                                        .blocking_show();
                                }
                            }
                        });
                        return;
                    }

                    if !matches!(
                        id.as_str(),
                        "hive-backup" | "hive-backup-again" | "hive-restore" | "hive-forget-backup"
                    ) {
                        return;
                    }
                    let app = app.clone();
                    let hive_dir = hive_dir.clone();
                    let instance_label = instance_label.clone();
                    let backup_again = backup_again.clone();
                    let forget = forget.clone();
                    // Off the main thread: the folder picker blocks, and the
                    // walk over a large hive is real work.
                    std::thread::spawn(move || {
                        use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

                        if id == "hive-forget-backup" {
                            forget_backup_target(&hive_dir);
                            let _ = backup_again.set_enabled(false);
                            let _ = forget.set_enabled(false);
                            app.dialog()
                                .message(
                                    "This hive will stop backing itself up on launch.\n\n\
                                     The folder and everything already in it is untouched.",
                                )
                                .title("Backup Folder Forgotten")
                                .blocking_show();
                            return;
                        }

                        // Two transfers at once would walk the same paths with
                        // two sets of temp files and report two half-truths.
                        if HIVE_TRANSFER_RUNNING.swap(true, Ordering::SeqCst) {
                            app.dialog()
                                .message("A backup or restore is already running.\n\nWait for it to finish, then try again.")
                                .kind(MessageDialogKind::Warning)
                                .title("Hive")
                                .blocking_show();
                            return;
                        }
                        let _busy = BusyGuard;

                        // "Back Up Again" reuses the remembered folder and asks
                        // nothing; everything else opens the picker.
                        let path = if id == "hive-backup-again" {
                            read_backup_target(&hive_dir)
                        } else {
                            app.dialog()
                                .file()
                                .blocking_pick_folder()
                                .and_then(|folder| folder.into_path().ok())
                        };
                        let Some(path) = path else {
                            return; // user cancelled — not an event
                        };

                        // A backup folder inside the hive folder is a hive that
                        // backs up its own backup: every launch copies what the
                        // last launch wrote, the store's own directory fills
                        // with tens of thousands of hex names, and the copy dies
                        // with the thing it was insurance against. The picker
                        // will happily let you do it, so this will not.
                        if id != "hive-restore" && is_inside(&path, &hive_dir) {
                            app.dialog()
                                .message(format!(
                                    "That folder is inside the hive itself ({}).\n\n\
                                     A backup has to live somewhere the hive does not — another drive, \
                                     another machine, a synced folder. Pick one outside it.",
                                    hive_dir.display()
                                ))
                                .kind(MessageDialogKind::Warning)
                                .title("Backup")
                                .blocking_show();
                            return;
                        }

                        let host = app.state::<Host>();

                        if id == "hive-restore" {
                            let (kind, message, changed) = match host.restore(&path) {
                                Ok(moved) => {
                                    let mut text = format!(
                                        "Restored from {}\n\n\
                                         {} content items ({} already present)\n\
                                         {} history markers ({} already present)\n\
                                         {} pool members ({} already present)",
                                        path.display(),
                                        moved.content,
                                        moved.content_skipped,
                                        moved.markers,
                                        moved.markers_skipped,
                                        moved.pool_members,
                                        moved.pool_members_skipped,
                                    );
                                    if moved.markers_skipped > 0 {
                                        text.push_str(&format!(
                                            "\n\n{} markers were already at those positions and were left alone — \
                                             this hive has its own history there.",
                                            moved.markers_skipped
                                        ));
                                    }
                                    if moved.content_corrupt > 0 {
                                        text.push_str(&format!(
                                            "\n\nWARNING: {} files did not match their own signature and were REFUSED. \
                                             That folder is damaged; whatever those files held is still missing.",
                                            moved.content_corrupt
                                        ));
                                    }
                                    let changed = moved.changed();
                                    if changed {
                                        text.push_str("\n\nThe hive will reload so you can see it.");
                                    }
                                    let kind = if moved.content_corrupt > 0 {
                                        MessageDialogKind::Warning
                                    } else {
                                        MessageDialogKind::Info
                                    };
                                    (kind, text, changed)
                                }
                                Err(e) => (MessageDialogKind::Error, format!("Restore failed: {e}"), false),
                            };
                            app.dialog().message(message).kind(kind).title("Restore").blocking_show();
                            // A restore that changes nothing on screen reads as
                            // a restore that did not happen. The running shell
                            // holds the pre-restore head in memory and would go
                            // on painting it until the next launch.
                            if changed {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.reload();
                                }
                            }
                            return;
                        }

                        // ── Backup ────────────────────────────────────────
                        let (kind, message) = match host.export(&path) {
                            Ok(moved) => {
                                let checked = host.verify_backup(&path);
                                write_backup_target(&hive_dir, &path);
                                let _ = backup_again.set_enabled(true);
                                let _ = forget.set_enabled(true);

                                let mut text = format!(
                                    "Backed up to {}\n\n\
                                     {} content items ({} already there)\n\
                                     {} history markers ({} already there)\n\
                                     {} pool members ({} already there)",
                                    path.display(),
                                    moved.content,
                                    moved.content_skipped,
                                    moved.markers,
                                    moved.markers_skipped,
                                    moved.pool_members,
                                    moved.pool_members_skipped,
                                );

                                let kind = match &checked {
                                    Ok(found) if found.complete() => {
                                        text.push_str(&format!(
                                            "\n\nVerified: all {} content items, {} markers and {} pool members \
                                             are in that folder and hash clean.",
                                            found.content, found.markers, found.pool_members
                                        ));
                                        if found.markers_differ > 0 {
                                            text.push_str(&format!(
                                                "\n\n{} markers in the folder hold different bytes at the same \
                                                 position — another hive was backed up here too. Yours are safe; \
                                                 restoring this folder into an empty hive would give you theirs.",
                                                found.markers_differ
                                            ));
                                        }
                                        MessageDialogKind::Info
                                    }
                                    Ok(found) => {
                                        text.push_str(&format!(
                                            "\n\nVERIFY FAILED — this folder cannot restore this hive on its own:\n\
                                             {} content items missing, {} corrupt\n\
                                             {} markers missing\n\
                                             {} pool members missing\n\n\
                                             Check the drive has room and is not syncing mid-write, then back up \
                                             again — the export skips what is already there, so a second run is \
                                             cheap.",
                                            found.content_missing,
                                            found.content_corrupt,
                                            found.markers_missing,
                                            found.pool_members_missing,
                                        ));
                                        MessageDialogKind::Warning
                                    }
                                    Err(e) => {
                                        text.push_str(&format!("\n\nCould not verify the folder: {e}"));
                                        MessageDialogKind::Warning
                                    }
                                };

                                write_backup_receipt(&path, &instance_label, &moved, checked.as_ref().ok());
                                (kind, text)
                            }
                            Err(e) => (MessageDialogKind::Error, format!("Backup failed: {e}")),
                        };
                        app.dialog().message(message).kind(kind).title("Backup").blocking_show();
                    });
                });
            }

            Ok(())
        })
        // ---------------------------------------------------------------
        // `hive://<sig>` — content off the IPC channel
        //
        // Content bytes are the heaviest thing the shell reads and the only
        // thing it reads in bursts: one per visible tile the moment a view
        // settles. Carrying them over IPC put every picture behind the one
        // channel whose collapse is silent — measured on a real hive, the
        // burst killed the custom protocol ("Failed to fetch"), the in-flight
        // callbacks were dropped ("Couldn't find callback id"), and the
        // promises never settled, so those tiles stayed picture-less for the
        // rest of the session.
        //
        // A scheme handler is the right pipe: the webview's own transport,
        // one request per resource, no callback table to lose. The response is
        // marked `immutable` because that is simply true — content is
        // addressed by the hash of its own bytes, so a signature's answer can
        // never change and the webview may keep it forever.
        //
        // READ-ONLY BY CONSTRUCTION. The handler resolves a 64-hex signature
        // and nothing else: no paths, no writes, no listing. It is not a
        // widening of the IPC allowlist above — it is strictly less.
        // ---------------------------------------------------------------
        .register_uri_scheme_protocol("hive", |ctx, request| {
            use tauri::http::{header, Response, StatusCode};

            let reply = |status: StatusCode, body: Vec<u8>| {
                Response::builder()
                    .status(status)
                    .header(header::CONTENT_TYPE, "application/octet-stream")
                    // The page is served from another origin (tauri.localhost),
                    // so without this the fetch is refused before it is read.
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
                    .body(body)
                    .expect("a well-formed hive:// response")
            };

            let sig = request
                .uri()
                .path()
                .trim_start_matches('/')
                .to_string();

            let Some(host) = ctx.app_handle().try_state::<Host>() else {
                // The window can outlive a failed setup; answering beats hanging.
                return reply(StatusCode::SERVICE_UNAVAILABLE, Vec::new());
            };

            match host.get(&sig) {
                Ok(Some(bytes)) => reply(StatusCode::OK, bytes),
                Ok(None) => reply(StatusCode::NOT_FOUND, Vec::new()),
                Err(_) => reply(StatusCode::INTERNAL_SERVER_ERROR, Vec::new()),
            }
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
            open_external,
        ])
        .run(tauri::generate_context!())
        .expect("running the Hypercomb window");
}
