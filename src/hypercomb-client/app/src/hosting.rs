//! Hosting — the executable makes anybody a host.
//!
//! Point and click: pick the published folder, the app serves it on a
//! loopback port ([`hypercomb_host::serve::SiteServer`]), and cloudflared
//! puts the owner's domain on it. The visitor chain is
//! `domain → Cloudflare edge → tunnel → this app` — the tunnel is a dumb
//! pipe, so whatever the app serves simply IS the domain. Nothing is
//! uploaded anywhere; there is exactly one copy of everything, in here.
//!
//! Doctrine carried over from the rest of this file's world:
//! - The renderer never supplies a filesystem path — the folder comes from
//!   the native picker, same as backup/restore.
//! - Settings live in one small JSON beside the hive (`hosting.json`),
//!   per-instance, never inside the store — the `backup-target.txt` rule.
//! - cloudflared is orchestrated with per-run flags (`tunnel run --url …`),
//!   NEVER by writing `~/.cloudflared/config.yml` — an operator may already
//!   have a hand-built config there (jwize.com does); touching it is how a
//!   hosting feature breaks a host.
//!
//! The tunnel child is retained and killed on go-offline and on app exit.
//! `cloudflared tunnel login` opens the owner's browser for the one act
//! that must be theirs: attaching their Cloudflare account.

use std::io::Write as _;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use hypercomb_host::serve::SiteServer;
use serde::{Deserialize, Serialize};
use tauri::State;

/// What `hosting.json` remembers between launches.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HostingConfig {
    pub folder: Option<String>,
    /// Preferred port; serving falls back to an ephemeral port when taken,
    /// and the tunnel always targets the port actually serving.
    pub port: Option<u16>,
    pub domain: Option<String>,
    pub tunnel: Option<String>,
}

const DEFAULT_PORT: u16 = 8737;

/// Managed hosting state: the running server, the running tunnel, and where
/// the config lives.
#[derive(Debug)]
pub struct Hosting {
    hive_dir: PathBuf,
    server: Mutex<Option<SiteServer>>,
    tunnel: Mutex<Option<Child>>,
}

impl Hosting {
    pub fn new(hive_dir: PathBuf) -> Self {
        Self { hive_dir, server: Mutex::new(None), tunnel: Mutex::new(None) }
    }

    fn config_path(&self) -> PathBuf {
        self.hive_dir.join("hosting.json")
    }

    fn load(&self) -> HostingConfig {
        std::fs::read_to_string(self.config_path())
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn save(&self, config: &HostingConfig) {
        if let Ok(text) = serde_json::to_string_pretty(config) {
            let _ = std::fs::write(self.config_path(), text);
        }
    }

    fn log_path(&self) -> PathBuf {
        self.hive_dir.join("hosting.log")
    }

    /// Kill whatever is running. Called on go-offline and app exit.
    pub fn shutdown(&self) {
        if let Ok(mut tunnel) = self.tunnel.lock() {
            if let Some(mut child) = tunnel.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        if let Ok(mut server) = self.server.lock() {
            if let Some(server) = server.take() {
                server.stop();
            }
        }
    }
}

/// What the renderer sees. No filesystem internals beyond the folder the
/// owner themselves picked.
#[derive(Debug, Serialize)]
pub struct HostingStatus {
    pub folder: Option<String>,
    pub serving: bool,
    pub port: Option<u16>,
    pub domain: Option<String>,
    pub tunnel_running: bool,
    pub cloudflared: bool,
}

/// A `cloudflared` invocation that never flashes a console window.
fn cloudflared(args: &[&str]) -> Command {
    let mut command = Command::new("cloudflared");
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn cloudflared_available() -> bool {
    cloudflared(&["--version"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Run a short cloudflared step; `tolerate` marks stderr fragments that mean
/// "already done" rather than failure (create/route are idempotent acts).
fn cloudflared_step(args: &[&str], tolerate: &[&str]) -> Result<(), String> {
    let output = cloudflared(args)
        .output()
        .map_err(|_| "cloudflared is not installed (or not on PATH)".to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if tolerate.iter().any(|fragment| stderr.contains(fragment)) {
        return Ok(());
    }
    Err(stderr.lines().last().unwrap_or("cloudflared failed").to_string())
}

fn sanitize_tunnel_name(domain: &str) -> String {
    let name: String = domain
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    format!("hypercomb-{}", name.trim_matches('-'))
}

fn valid_domain(domain: &str) -> bool {
    !domain.is_empty()
        && domain.len() < 254
        && domain.contains('.')
        && domain
            .bytes()
            .all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-'))
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn hosting_status(hosting: State<'_, Hosting>) -> HostingStatus {
    let config = hosting.load();
    let port = hosting
        .server
        .lock()
        .ok()
        .and_then(|server| server.as_ref().map(|s| s.port()));
    let tunnel_running = hosting
        .tunnel
        .lock()
        .ok()
        .map(|mut tunnel| match tunnel.as_mut() {
            // try_wait: Some(_) = exited; None = still running.
            Some(child) => child.try_wait().map(|done| done.is_none()).unwrap_or(false),
            None => false,
        })
        .unwrap_or(false);
    HostingStatus {
        folder: config.folder,
        serving: port.is_some(),
        port,
        domain: config.domain,
        tunnel_running,
        cloudflared: cloudflared_available(),
    }
}

/// Native picker — the ONLY way a folder reaches this feature.
#[tauri::command]
pub fn hosting_pick_folder(
    app: tauri::AppHandle,
    hosting: State<'_, Hosting>,
) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|folder| folder.into_path().ok())?;
    let mut config = hosting.load();
    config.folder = Some(path.display().to_string());
    hosting.save(&config);
    Some(path.display().to_string())
}

#[tauri::command]
pub fn hosting_serve_start(hosting: State<'_, Hosting>) -> Result<u16, String> {
    let config = hosting.load();
    let folder = config.folder.clone().ok_or("pick a published folder first")?;
    let mut server = hosting.server.lock().map_err(|_| "hosting state poisoned")?;
    if let Some(running) = server.as_ref() {
        return Ok(running.port());
    }
    let preferred = config.port.unwrap_or(DEFAULT_PORT);
    let started = SiteServer::start(&folder, preferred)
        .or_else(|_| SiteServer::start(&folder, 0))
        .map_err(|e| format!("could not serve {folder}: {e}"))?;
    let port = started.port();
    *server = Some(started);
    Ok(port)
}

#[tauri::command]
pub fn hosting_serve_stop(hosting: State<'_, Hosting>) -> Result<(), String> {
    let mut server = hosting.server.lock().map_err(|_| "hosting state poisoned")?;
    if let Some(running) = server.take() {
        running.stop();
    }
    Ok(())
}

/// Opens the owner's browser on Cloudflare's consent page — the one act
/// that must be theirs. Detached on purpose; login completes out-of-band.
#[tauri::command]
pub fn hosting_tunnel_login() -> Result<(), String> {
    if !cloudflared_available() {
        return Err("cloudflared is not installed — install it, then try again".into());
    }
    cloudflared(&["tunnel", "login"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not start cloudflared login: {e}"))
}

/// Create-if-needed, route DNS, run. Idempotent per step, so "go live"
/// after a crash or a domain change just converges.
#[tauri::command]
pub fn hosting_go_live(hosting: State<'_, Hosting>, domain: String) -> Result<String, String> {
    let domain = domain.trim().to_lowercase();
    if !valid_domain(&domain) {
        return Err("that does not look like a domain (expected e.g. site.example.com)".into());
    }

    // Serving must be up first — the tunnel targets the live port.
    let port = hosting_serve_start(hosting.clone())?;

    let tunnel_name = sanitize_tunnel_name(&domain);
    cloudflared_step(&["tunnel", "create", &tunnel_name], &["already exists"])?;
    cloudflared_step(
        &["tunnel", "route", "dns", &tunnel_name, &domain],
        &["already exists", "already configured", "An A, AAAA, or CNAME record"],
    )?;

    let mut tunnel = hosting.tunnel.lock().map_err(|_| "hosting state poisoned")?;
    if let Some(mut previous) = tunnel.take() {
        let _ = previous.kill();
        let _ = previous.wait();
    }

    // One log per run, truncated like renderer.log — the answer to "why is
    // my domain dark" lives here.
    let log = std::fs::File::create(hosting.log_path())
        .map_err(|e| format!("could not open hosting.log: {e}"))?;
    let mut log_clone = log.try_clone().map_err(|e| e.to_string())?;
    let _ = writeln!(log_clone, "[hosting] tunnel {tunnel_name} -> http://127.0.0.1:{port} for {domain}");

    let url = format!("http://127.0.0.1:{port}");
    let child = cloudflared(&["tunnel", "run", "--url", &url, &tunnel_name])
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .spawn()
        .map_err(|e| format!("could not run the tunnel: {e}"))?;
    *tunnel = Some(child);

    let mut config = hosting.load();
    config.domain = Some(domain.clone());
    config.tunnel = Some(tunnel_name);
    config.port = Some(port);
    hosting.save(&config);

    Ok(format!("https://{domain}"))
}

#[tauri::command]
pub fn hosting_go_offline(hosting: State<'_, Hosting>) -> Result<(), String> {
    let mut tunnel = hosting.tunnel.lock().map_err(|_| "hosting state poisoned")?;
    if let Some(mut child) = tunnel.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
