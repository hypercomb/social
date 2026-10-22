//! # Putting this hive online — done by the app
//!
//! (jwize 2026-10-18: "make everything automated because we want to be able
//! to walk people through how it's done so they can do it themselves".)
//! Serve This Hive answers on this machine's network. A Cloudflare tunnel puts
//! it on the internet with no port forwarding and no address exposed, and the
//! app does every step of it:
//!
//! - **`cloudflared`**, Cloudflare's tunnel program, is downloaded on first
//!   use from Cloudflare's official release and checked against the digest
//!   pinned below before it is ever run. The installer does not carry it.
//! - **Try it now** — a QUICK tunnel: no account, an address of the form
//!   `https://<words>.trycloudflare.com` within seconds. It changes every
//!   time it restarts, so it is a demonstration, never a home.
//! - **Your own domain** — a NAMED tunnel: the person signs in to their free
//!   Cloudflare account in their browser (cloudflared opens it), the tunnel
//!   is created, the domain is pointed at it, and it runs. A DNS record the
//!   domain already has is never replaced without asking.
//!
//! The tunnel forwards the public hostname as `Host`, so the domain opens
//! the door `serve at <domain>` wrote (hypercomb-serve `resolve_for`).
//!
//! Every act that puts the hive online asks first, in a native dialog the
//! page cannot answer for it: adopted content runs in the page, and nothing
//! it can reach may publish this machine on its own (main.rs module docs).

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The pinned release (published 2026-10-15). Moving it is a reviewed change:
/// a new version, a new set of digests, read from the release's own assets.
pub const VERSION: &str = "2026.10.1";

/// One platform's download: its release asset, the sha256 GitHub records for
/// it, and whether it is a `.tgz` holding the program (macOS).
struct Asset {
    name: &'static str,
    sha256: &'static str,
    archive: bool,
}

fn asset() -> Option<Asset> {
    let (name, sha256, archive) = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => ("cloudflared-windows-amd64.exe", "4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6", false),
        ("linux", "x86_64") => ("cloudflared-linux-amd64", "3bfc539f45d2620c71debb7a86be0efa737ed5ccbad9eb85c787116900e5c586", false),
        ("linux", "aarch64") => ("cloudflared-linux-arm64", "2c65dfabf616c40efc7545d107d7a57ad5e21377e2964b7e88af19a238074a46", false),
        ("macos", "x86_64") => ("cloudflared-darwin-amd64.tgz", "3b0dbaf378337e9d7fb6cd235a76d1d6a7dee434c2d8edf9281164fb6a3837ab", true),
        ("macos", "aarch64") => ("cloudflared-darwin-arm64.tgz", "647615df99d49cd179ea5e13ef760b9bbfb33630f6ae62f87e33dfadda60adcc", true),
        _ => return None,
    };
    Some(Asset { name, sha256, archive })
}

const PROGRAM: &str = if cfg!(windows) { "cloudflared.exe" } else { "cloudflared" };

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `cloudflared`, downloaded once into `dir` and verified. Returns its path.
pub fn ensure_cloudflared(dir: &Path) -> Result<PathBuf, String> {
    let Some(asset) = asset() else {
        return Err(format!(
            "Putting a hive online is not available on {} {} yet.",
            std::env::consts::OS,
            std::env::consts::ARCH
        ));
    };
    let home = dir.join("cloudflared").join(VERSION);
    let program = home.join(PROGRAM);
    if program.is_file() {
        return Ok(program);
    }
    std::fs::create_dir_all(&home).map_err(|e| format!("Could not make {}: {e}", home.display()))?;

    let url = format!("https://github.com/cloudflare/cloudflared/releases/download/{VERSION}/{}", asset.name);
    let response = ureq::get(&url)
        .timeout(Duration::from_secs(300))
        .call()
        .map_err(|e| format!("Could not download Cloudflare's tunnel program: {e}"))?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(200 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("The download of Cloudflare's tunnel program stopped: {e}"))?;
    let digest = hex(&Sha256::digest(&bytes));
    if digest != asset.sha256 {
        return Err(format!(
            "The downloaded tunnel program did not match the one this app expects \
             (sha256 {digest}). Nothing was run."
        ));
    }

    if asset.archive {
        let tgz = home.join(asset.name);
        std::fs::write(&tgz, &bytes).map_err(|e| e.to_string())?;
        let status = Command::new("tar")
            .arg("-xzf")
            .arg(&tgz)
            .arg("-C")
            .arg(&home)
            .status()
            .map_err(|e| format!("Could not unpack the tunnel program: {e}"))?;
        let _ = std::fs::remove_file(&tgz);
        if !status.success() || !program.is_file() {
            return Err("Could not unpack the tunnel program.".into());
        }
    } else {
        let partial = home.join(format!("{PROGRAM}.partial"));
        std::fs::write(&partial, &bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&partial, &program).map_err(|e| e.to_string())?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755));
    }
    Ok(program)
}

/// A command for `cloudflared` that never flashes a console window.
fn command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
}

/// Run `cloudflared` to completion, returning everything it said.
fn run(program: &Path, args: &[&str]) -> Result<String, String> {
    let output = command(program)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Could not run the tunnel program: {e}"))?;
    let said = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    if output.status.success() {
        Ok(said)
    } else {
        Err(said)
    }
}

/// Start a long-running `cloudflared` and wait until a line it prints says
/// it is up; returns the child and what `found` read off that line. Its
/// output keeps draining afterwards, so a full pipe never stalls it.
fn spawn_until(
    program: &Path,
    args: &[&str],
    mut found: impl FnMut(&str) -> Option<String>,
    wait: Duration,
) -> Result<(Child, String), String> {
    let mut child = command(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start the tunnel: {e}"))?;
    let stderr = child.stderr.take().ok_or("The tunnel said nothing.")?;
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = tx.send(line);
        }
    });
    let deadline = std::time::Instant::now() + wait;
    let mut said = Vec::new();
    while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(line) => {
                if let Some(value) = found(&line) {
                    // Keep draining: the reader thread holds the pipe open.
                    std::thread::spawn(move || for _ in rx {});
                    return Ok((child, value));
                }
                said.push(line);
            }
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let tail: Vec<&String> = said.iter().rev().take(6).collect();
    Err(format!(
        "The tunnel did not come up.\n\n{}",
        tail.into_iter().rev().cloned().collect::<Vec<_>>().join("\n")
    ))
}

/// WAIT UNTIL THE NAME EXISTS before handing it out. A lookup that runs
/// before Cloudflare has published the name fails — and the operating system
/// remembers the failure (Windows: up to 15 minutes), so the person's own
/// check, and their first visit, would say "no such site" long after it
/// works. Cloudflare's DNS is asked directly, over HTTPS, so nothing on this
/// machine looks the name up until it resolves. True once it does.
fn wait_resolvable(host: &str, wait: Duration) -> bool {
    let deadline = std::time::Instant::now() + wait;
    let url = format!("https://cloudflare-dns.com/dns-query?name={host}&type=A");
    while std::time::Instant::now() < deadline {
        let answered = ureq::get(&url)
            .set("accept", "application/dns-json")
            .timeout(Duration::from_secs(5))
            .call()
            .ok()
            .and_then(|response| response.into_string().ok())
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .is_some_and(|json| json.get("Answer").and_then(|a| a.as_array()).is_some_and(|a| !a.is_empty()));
        if answered {
            return true;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
    false
}

fn quick_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let rest = &line[start..];
    let end = rest.find(|c: char| c.is_whitespace() || c == '|').unwrap_or(rest.len());
    let url = &rest[..end];
    url.ends_with(".trycloudflare.com").then(|| url.to_string())
}

fn connected(line: &str) -> Option<String> {
    line.contains("Registered tunnel connection").then(String::new)
}

/// Which tunnel is running, and where it answers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelState {
    /// `quick` or `named`.
    pub kind: &'static str,
    /// The hostname the world reaches this hive at.
    pub host: String,
}

struct Running {
    child: Child,
    state: TunnelState,
}

/// The tunnel this app runs, or none. Dropped with the app.
#[derive(Default)]
pub struct Tunnels(Mutex<Option<Running>>);

impl std::fmt::Debug for Tunnels {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Tunnels")
    }
}

impl Tunnels {
    pub fn state(&self) -> Option<TunnelState> {
        self.0.lock().ok()?.as_ref().map(|running| running.state.clone())
    }

    fn hold(&self, child: Child, state: TunnelState) -> TunnelState {
        if let Ok(mut held) = self.0.lock() {
            if let Some(mut previous) = held.take() {
                let _ = previous.child.kill();
            }
            *held = Some(Running { child, state: state.clone() });
        }
        state
    }

    /// Stop the tunnel. Returns whether one was running.
    pub fn stop(&self) -> bool {
        match self.0.lock().ok().and_then(|mut held| held.take()) {
            Some(mut running) => {
                let _ = running.child.kill();
                let _ = running.child.wait();
                true
            }
            None => false,
        }
    }

    /// TRY IT NOW — a quick tunnel to this machine's host on `port`.
    pub fn quick(&self, program: &Path, port: u16) -> Result<TunnelState, String> {
        let local = format!("http://127.0.0.1:{port}");
        // The address is printed BEFORE the tunnel connects. Handing it out
        // then means a visitor's first lookup fails — and the system caches
        // that failure. So: note the address, answer once a connection to
        // Cloudflare is registered.
        // ITS OWN CONFIG, ALWAYS. Without `--config`, cloudflared reads the
        // person's own ~/.cloudflared/config.yml — and a catch-all ingress
        // there (`service: http_status:404`) answers this tunnel's hostname
        // with 404 before it ever reaches this machine. Found on the first
        // live run, on a machine that already runs a tunnel.
        let config = program.with_file_name("quick.yml");
        std::fs::write(&config, "no-autoupdate: true
").map_err(|e| e.to_string())?;
        let config = config.to_string_lossy().to_string();
        let mut address: Option<String> = None;
        let (child, url) = spawn_until(
            program,
            &["tunnel", "--config", &config, "--no-autoupdate", "--url", &local],
            move |line| {
                if address.is_none() {
                    address = quick_url(line);
                }
                connected(line).and(address.clone())
            },
            Duration::from_secs(90),
        )?;
        let host = url.trim_start_matches("https://").to_string();
        let mut child = child;
        if !wait_resolvable(&host, Duration::from_secs(90)) {
            let _ = child.kill();
            return Err(format!("{host} was created but never appeared in Cloudflare's DNS. Try again."));
        }
        Ok(self.hold(child, TunnelState { kind: "quick", host }))
    }

    /// YOUR OWN DOMAIN — run the named tunnel `setup` prepared.
    pub fn named(&self, program: &Path, named: &Named) -> Result<TunnelState, String> {
        let config = named.config.to_string_lossy().to_string();
        let (child, _) = spawn_until(
            program,
            &["tunnel", "--no-autoupdate", "--config", &config, "run", &named.id],
            connected,
            Duration::from_secs(60),
        )?;
        Ok(self.hold(child, TunnelState { kind: "named", host: named.domain.clone() }))
    }
}

impl Drop for Tunnels {
    fn drop(&mut self) {
        self.stop();
    }
}

/// A named tunnel this app set up: kept device-local beside its credentials
/// (a secret — never in a pool, never published), so it can run again.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Named {
    pub domain: String,
    pub id: String,
    pub config: PathBuf,
}

/// Where Cloudflare's login leaves its certificate: `~/.cloudflared/cert.pem`.
fn login_cert() -> Option<PathBuf> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    Some(PathBuf::from(home).join(".cloudflared").join("cert.pem"))
}

/// Sign in to Cloudflare: cloudflared opens the person's browser, they pick
/// the domain's account, and it leaves a certificate. Blocks until then.
pub fn login(program: &Path, dir: &Path) -> Result<PathBuf, String> {
    let kept = dir.join("cloudflared").join("cert.pem");
    if kept.is_file() {
        return Ok(kept);
    }
    if let Some(cert) = login_cert().filter(|cert| cert.is_file()) {
        std::fs::copy(&cert, &kept).map_err(|e| e.to_string())?;
        return Ok(kept);
    }
    run(program, &["tunnel", "login"]).map_err(|said| format!("Signing in to Cloudflare did not finish.\n\n{said}"))?;
    let cert = login_cert().filter(|cert| cert.is_file()).ok_or("Cloudflare's sign-in left no certificate.")?;
    std::fs::copy(&cert, &kept).map_err(|e| e.to_string())?;
    Ok(kept)
}

/// The record a domain already has blocks the route; say so rather than
/// replace it silently.
pub const DNS_TAKEN: &str = "dns-record-exists";

/// Create the named tunnel for `domain`, point the domain at it, and write
/// its config. `overwrite` replaces a DNS record the domain already has —
/// only after the person said so.
pub fn setup(program: &Path, dir: &Path, cert: &Path, domain: &str, port: u16, overwrite: bool) -> Result<Named, String> {
    let home = dir.join("cloudflared");
    let saved = home.join(format!("{domain}.json"));
    let cert = cert.to_string_lossy().to_string();
    let name = format!("hypercomb-{}", domain.replace('.', "-"));

    let previous: Option<Named> = std::fs::read(&saved).ok().and_then(|b| serde_json::from_slice(&b).ok());
    let credentials = home.join(format!("{domain}.credentials.json"));
    let id = match previous {
        Some(named) if credentials.is_file() => named.id,
        _ => {
            let credentials_arg = credentials.to_string_lossy().to_string();
            let created = run(program, &["--origincert", &cert, "tunnel", "create", "--credentials-file", &credentials_arg, &name]);
            let said = match created {
                Ok(said) => said,
                Err(said) if said.contains("already exists") => {
                    // Our own tunnel from an earlier attempt whose credentials
                    // were lost: replace it — its name is this app's.
                    run(program, &["--origincert", &cert, "tunnel", "delete", "-f", &name])?;
                    run(program, &["--origincert", &cert, "tunnel", "create", "--credentials-file", &credentials_arg, &name])?
                }
                Err(said) => return Err(format!("Could not create the tunnel.\n\n{said}")),
            };
            tunnel_id(&said).ok_or_else(|| format!("Cloudflare did not say which tunnel it made.\n\n{said}"))?
        }
    };

    let mut route = vec!["--origincert", cert.as_str(), "tunnel", "route", "dns"];
    if overwrite {
        route.push("--overwrite-dns");
    }
    route.push(id.as_str());
    route.push(domain);
    if let Err(said) = run(program, &route) {
        if said.contains("already exists") || said.contains("already configured") {
            return Err(DNS_TAKEN.to_string());
        }
        return Err(format!("Could not point {domain} at the tunnel.\n\n{said}"));
    }

    let config = home.join(format!("{domain}.yml"));
    let yaml = format!(
        "tunnel: {id}\ncredentials-file: {}\ningress:\n  - hostname: {domain}\n    service: http://127.0.0.1:{port}\n  - service: http_status:404\n",
        credentials.to_string_lossy().replace('\\', "/"),
    );
    std::fs::write(&config, yaml).map_err(|e| e.to_string())?;
    let named = Named { domain: domain.to_string(), id, config };
    std::fs::write(&saved, serde_json::to_vec_pretty(&named).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(named)
}

/// `Created tunnel hypercomb-x with id 6ff4…` → the id.
fn tunnel_id(said: &str) -> Option<String> {
    let at = said.find("with id ")? + "with id ".len();
    let id: String = said[at..].chars().take_while(|c| c.is_ascii_hexdigit() || *c == '-').collect();
    (id.len() == 36).then_some(id)
}

/// A plain hostname, or nothing — the same reading the host gives `Host`.
pub fn domain(raw: &str) -> Option<String> {
    hypercomb_serve::host_name(raw.trim().trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/'))
        .filter(|name| name.contains('.') && !name.ends_with(".localhost"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quick_tunnel_line_gives_its_address() {
        let line = "2026-10-18T10:00:00Z INF |  https://fancy-word-tree-cat.trycloudflare.com                                 |";
        assert_eq!(quick_url(line).as_deref(), Some("https://fancy-word-tree-cat.trycloudflare.com"));
        assert_eq!(quick_url("INF Requesting new quick Tunnel on trycloudflare.com..."), None);
        assert_eq!(quick_url("see https://developers.cloudflare.com/x"), None);
    }

    #[test]
    fn a_created_tunnel_says_its_id() {
        let said = "Tunnel credentials written to C:\\x.json.\nCreated tunnel hypercomb-alice-example-com with id 6ff42ae2-765d-4adf-8112-31c55c1551ef";
        assert_eq!(tunnel_id(said).as_deref(), Some("6ff42ae2-765d-4adf-8112-31c55c1551ef"));
        assert_eq!(tunnel_id("nothing"), None);
    }

    #[test]
    fn a_domain_is_a_real_dotted_name() {
        assert_eq!(domain("https://Alice.Example.com/").as_deref(), Some("alice.example.com"));
        assert_eq!(domain("alice.localhost"), None);
        assert_eq!(domain("localhost"), None);
        assert_eq!(domain("not a domain"), None);
    }

    /// The real download, against the pinned digest. Network; run by hand:
    /// `cargo test -p hypercomb-client tunnel -- --ignored`.
    #[test]
    #[ignore]
    fn the_pinned_release_downloads_and_verifies() {
        let dir = std::env::temp_dir().join("hypercomb-tunnel-test");
        let _ = std::fs::remove_dir_all(&dir);
        let program = ensure_cloudflared(&dir).expect("downloaded and verified");
        let said = run(&program, &["--version"]).expect("it runs");
        assert!(said.contains(VERSION), "{said}");
        // A second call finds it and downloads nothing.
        assert_eq!(ensure_cloudflared(&dir).unwrap(), program);
    }

    /// LIVE: a real quick tunnel to a throwaway server that only echoes the
    /// Host it was asked for — no hive. Proves the address is read off
    /// cloudflared and that the public hostname reaches this machine as
    /// `Host` (what door routing keys on). Puts a page on the internet for a
    /// minute; run by hand: `cargo test -p hypercomb-client
    /// a_quick_tunnel -- --ignored --nocapture`.
    /// A throwaway server that only echoes the Host it was asked for — no
    /// hive. Returns its port.
    fn echo_host_server() -> u16 {
        use std::io::Write;
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut reader = BufReader::new(&stream);
                let mut host = String::new();
                let mut line = String::new();
                while reader.read_line(&mut line).map(|n| n > 0).unwrap_or(false) {
                    if line.trim().is_empty() { break; }
                    if let Some(value) = line.strip_prefix("Host:").or_else(|| line.strip_prefix("host:")) {
                        host = value.trim().to_string();
                    }
                    line.clear();
                }
                let body = format!("echo-host:{host}");
                let mut out = &stream;
                let _ = write!(out, "HTTP/1.1 200 OK
Content-Length: {}
Connection: close

{body}", body.len());
            }
        });
        port
    }

    /// Fetch `https://<host>/`, retrying while a fresh name settles.
    fn fetch_public(host: &str) -> Option<String> {
        for attempt in 0..30 {
            match ureq::get(&format!("https://{host}/")).timeout(Duration::from_secs(10)).call() {
                Ok(response) => return response.into_string().ok(),
                Err(error) => {
                    println!("attempt {attempt}: {error}");
                    std::thread::sleep(Duration::from_secs(2));
                }
            }
        }
        None
    }

    #[test]
    #[ignore]
    fn a_quick_tunnel_reaches_this_machine_with_its_public_host() {
        let port = echo_host_server();

        let dir = std::env::temp_dir().join("hypercomb-tunnel-test");
        let program = ensure_cloudflared(&dir).expect("cloudflared");
        let tunnels = Tunnels::default();
        let state = tunnels.quick(&program, port).expect("a quick tunnel");
        println!("quick tunnel: https://{}", state.host);
        assert!(state.host.ends_with(".trycloudflare.com"), "{}", state.host);

        let answer = fetch_public(&state.host);
        assert!(tunnels.stop(), "the tunnel was running");
        let answer = answer.expect("the public address answered");
        println!("answered: {answer}");
        assert_eq!(answer, format!("echo-host:{}", state.host));
    }

    /// LIVE: the own-domain path on a real Cloudflare account — create the
    /// named tunnel, point the name at it, run it, and fetch it from outside.
    /// Uses the sign-in already on this machine (~/.cloudflared/cert.pem) and
    /// the app's own hosting folder, so the tunnel it makes is the one the
    /// "Use my domain" button reuses. The name must be one with no record yet,
    /// or one this app already pointed. Run by hand:
    /// `HC_TUNNEL_DOMAIN=tunnel-test.example.org cargo test -p hypercomb-client
    /// a_named_tunnel -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn a_named_tunnel_reaches_this_machine_at_its_domain() {
        let domain = domain(&std::env::var("HC_TUNNEL_DOMAIN").expect("HC_TUNNEL_DOMAIN")).expect("a domain");
        let port = echo_host_server();
        let dir = PathBuf::from(std::env::var_os(if cfg!(windows) { "APPDATA" } else { "HOME" }).unwrap())
            .join("io.hypercomb.client")
            .join("hosting");
        std::fs::create_dir_all(&dir).unwrap();
        let program = ensure_cloudflared(&dir).expect("cloudflared");
        let cert = login(&program, &dir).expect("signed in");
        let named = setup(&program, &dir, &cert, &domain, port, false).expect("tunnel created and routed");
        println!("named tunnel {} for {}", named.id, named.domain);
        // Setting up again reuses the tunnel and its record: the button
        // pressed twice changes nothing.
        let again = setup(&program, &dir, &cert, &domain, port, false).expect("set up again");
        assert_eq!(again.id, named.id);

        let tunnels = Tunnels::default();
        let state = tunnels.named(&program, &named).expect("the tunnel runs");
        assert_eq!(state.host, domain);
        let answer = fetch_public(&domain);
        assert!(tunnels.stop(), "the tunnel was running");
        let answer = answer.expect("the domain answered");
        println!("answered: {answer}");
        assert_eq!(answer, format!("echo-host:{domain}"));
    }

    #[test]
    fn every_supported_platform_pins_a_digest() {
        if let Some(asset) = asset() {
            assert_eq!(asset.sha256.len(), 64);
            assert!(asset.name.starts_with("cloudflared-"));
        }
    }
}
