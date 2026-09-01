//! # `hypercomb-serve`
//!
//! **A hive, served.** This crate turns a machine that HOLDS a hive into a
//! machine that HOSTS one — the same contract Cloudflare Pages satisfies for a
//! published folder, answered live out of the store instead.
//!
//! ```text
//!   GET /                     the shell            (shim dist/)
//!   GET /pin                  the bootstrap pin    (shim dist/)
//!   GET /<sig>                content bytes        (THE STORE)
//!   GET /<bagSig>/00000007    a revision marker    (THE STORE)
//!   GET /<poolSig>/<member>   a pool member        (THE STORE)
//!   GET /a/deep/hive/location the shell, 200       (a location is not a file)
//! ```
//!
//! ## Why live, and not an exported folder
//!
//! The store can already write the interchange form — flat sig-named content,
//! sigbags, pools — and any static server could serve that. But a copy is a
//! copy: it is stale from the moment the next layer commits, it doubles the
//! disk, and "did I remember to re-export" becomes something a host operator
//! has to know. Reading through to the store makes the question unaskable. The
//! interchange form is still exactly what this serves — it is just derived per
//! request rather than materialized.
//!
//! ## The contract is not ours to invent
//!
//! Every rule below is one `hypercomb-shim/host/check-host.mjs` tests, and that
//! checker is the acceptance test for this crate. Two of the rules are
//! load-bearing in a way that is invisible until they are broken:
//!
//! - **A real file wins before any rewrite.** Signature-named files have no
//!   extension, and every off-the-shelf SPA server rewrites extension-less
//!   paths to `index.html`. The origin then serves its own heap as HTML, `/pin`
//!   answers `<!doctype`, atoms fail their hash, and the host looks *corrupt*
//!   rather than misconfigured.
//! - **A miss inside a signature is a real 404, never the shell.** This is the
//!   sharper edge of the same rule, and it is why the fallback here is narrower
//!   than the folder host's: a replicating node fetches `/<bagSig>/00000007`
//!   and writes back whatever bytes it gets. Markers are NOT content-addressed,
//!   so nothing downstream would catch an `index.html` answer — the node would
//!   write HTML into its own lineage bag. Anything under a sig-named directory
//!   therefore 404s when absent.
//!
//! ## What it is not
//!
//! There is no write path. A host publishes; it does not accept. Adoption,
//! replication and publishing all move bytes by having the READER pull and
//! verify them, so an origin that accepted a PUT would be adding the one
//! surface the design does not need and cannot make safe.

#![forbid(unsafe_code)]
#![warn(missing_debug_implementations)]

mod http;

pub use http::{Body, Reply};

use std::io::BufReader;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

/// Where a host reads a hive from.
///
/// Two operations, because the interchange form has exactly two shapes: bytes
/// at a signature, and a named entry inside a signature-named directory. A
/// `None` is "not here" and must become a 404 — never an empty 200, which a
/// reader would admit as real content.
pub trait HiveSource: Send + Sync + 'static {
    /// Content bytes at a signature.
    fn content(&self, sig: &str) -> Option<Vec<u8>>;

    /// One entry inside a signature-named directory: an 8-digit name is a
    /// lineage marker, anything else is a pool member. The address may be both
    /// a bag and a pool — for a bare-word meaning the two are byte-identical —
    /// so the ENTRY decides, never the directory.
    fn entry(&self, sig: &str, name: &str) -> Option<Vec<u8>>;
}

impl HiveSource for hypercomb_host::Host {
    fn content(&self, sig: &str) -> Option<Vec<u8>> {
        // A storage error and an absence are both "no bytes to serve". The
        // distinction matters to an operator reading a log, not to the wire,
        // where inventing a 500 would only turn a missing atom into an outage.
        self.raw_get(sig).ok().flatten()
    }

    fn entry(&self, sig: &str, name: &str) -> Option<Vec<u8>> {
        self.raw_dir_get(sig, name).ok().flatten()
    }
}

const SIG_LEN: usize = 64;

/// Is this a signature-shaped name? Lowercase hex only — the same rule the
/// shim, the checker and the store apply, so a host cannot admit an address
/// spelling that a reader would then miss.
fn is_sig(name: &str) -> bool {
    name.len() == SIG_LEN
        && name
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Percent-decoding, for pool member names — the one place a URL path segment
/// carries a user-chosen string rather than a signature.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
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

const TYPES: &[(&str, &str)] = &[
    ("html", "text/html; charset=utf-8"),
    ("js", "text/javascript; charset=utf-8"),
    ("mjs", "text/javascript; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("json", "application/json; charset=utf-8"),
    ("webmanifest", "application/manifest+json"),
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
    ("ico", "image/x-icon"),
    ("woff2", "font/woff2"),
    ("map", "application/json; charset=utf-8"),
    ("txt", "text/plain; charset=utf-8"),
];

/// Content type by extension. **No extension is deliberately opaque**: the
/// client hashes those bytes and decides what they are, and the service worker
/// — not the host — gives a module its JavaScript type.
fn type_for(name: &str) -> &'static str {
    let Some((_, extension)) = name.rsplit_once('.') else {
        return "application/octet-stream";
    };
    let extension = extension.to_ascii_lowercase();
    TYPES
        .iter()
        .find(|(known, _)| *known == extension)
        .map(|(_, mime)| *mime)
        .unwrap_or("application/octet-stream")
}

/// Cache posture. A signature path may be cached forever, because the name IS
/// the hash. The pin and the code channel must never cache hard: a stale pin
/// cannot be repointed, and a stale service worker strands a client on an old
/// runtime with no way back.
fn cache_for(path: &str, name: &str) -> &'static str {
    if is_sig(name) {
        return "public, max-age=31536000, immutable";
    }
    if path == "/pin" || matches!(name, "hypercomb.worker.js" | "main.js" | "env.js") {
        return "no-cache, no-store, must-revalidate";
    }
    "public, max-age=0, must-revalidate"
}

/// A path segment safe to look up on disk.
///
/// An allowlist rather than a traversal check. `..` is the obvious attack but
/// not the only one: a NUL truncates a path in some syscalls, a backslash is a
/// separator on Windows, and a trailing dot or space there names a different
/// file than it reads as. Nothing the shim build emits needs anything outside
/// this set, so nothing outside it reaches the filesystem.
fn safe_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && !segment.ends_with('.')
        && !segment.ends_with(' ')
        && segment.bytes().all(|b| {
            b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b'@' | b'+' | b'~')
        })
}

/// The file the shell would serve for these segments, if it holds one.
fn shell_file(shell: &Path, segments: &[String]) -> Option<PathBuf> {
    let mut path = shell.to_path_buf();
    for segment in segments {
        if !safe_segment(segment) {
            return None;
        }
        path.push(segment);
    }
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

fn cors(reply: Reply) -> Reply {
    reply
        .with("access-control-allow-origin", "*")
        .with("x-content-type-options", "nosniff")
        .with("referrer-policy", "no-referrer")
}

/// Answer one request.
///
/// Pure in the way that matters: it touches the shell directory and the hive,
/// and nothing else. That is what lets the whole contract be asserted without
/// binding a port.
pub fn resolve(shell: &Path, hive: &dyn HiveSource, method: &str, target: &str) -> Reply {
    // CORS is not decoration. Without it every cross-origin replication dies as
    // an opaque "Failed to fetch" — no status, no diagnosis — and the host
    // looks exactly like one that publishes nothing. `*` is correct rather than
    // lax: the bytes are public, immutable, content-addressed and verified by
    // the reader, so there is no request whose ORIGIN changes the answer.
    if method == "OPTIONS" {
        return cors(Reply::new(204).with("access-control-allow-methods", "GET, HEAD, OPTIONS"));
    }
    if method != "GET" && method != "HEAD" {
        // A host publishes; it does not accept. See the module docs.
        return cors(Reply::new(405).with("allow", "GET, HEAD, OPTIONS"));
    }

    let path = target.split(['?', '#']).next().unwrap_or("/");
    let segments: Vec<String> = path
        .split('/')
        .filter(|s| !s.is_empty())
        .map(percent_decode)
        .collect();

    if segments.iter().any(|s| s == "." || s == ".." || s.contains('\0')) {
        return cors(Reply::new(403));
    }

    let name = segments.last().cloned().unwrap_or_default();
    let first = segments.first().cloned().unwrap_or_default();

    // (1) A real file wins, always — before any rewrite is considered.
    if let Some(file) = shell_file(shell, &segments) {
        let mut reply = cors(Reply::new(200))
            .with("content-type", type_for(&name))
            .with("cache-control", cache_for(path, &name))
            .body(Body::File(file));
        if is_sig(&name) {
            reply = reply.with("etag", format!("\"{name}\""));
        }
        return reply;
    }

    // (2) The hive itself. `/content/<sig>` as well as `/<sig>`, because the
    // shim's fetcher tries both bases and a host that answers only one of them
    // is a host half its readers cannot install from.
    let content_sig = match segments.as_slice() {
        [only] if is_sig(only) => Some(only.clone()),
        [base, sig] if base == "content" && is_sig(sig) => Some(sig.clone()),
        _ => None,
    };
    if let Some(sig) = content_sig {
        return match hive.content(&sig) {
            Some(bytes) => cors(Reply::new(200))
                .with("content-type", "application/octet-stream")
                .with("cache-control", "public, max-age=31536000, immutable")
                .with("etag", format!("\"{sig}\""))
                .body(Body::Bytes(bytes)),
            None => cors(Reply::new(404)),
        };
    }

    // (3) Inside a signature-named directory: a marker or a pool member.
    //
    // Never immutable. A marker index is stable in ordinary use, but history
    // compaction genuinely removes revisions, and a pool member is mutable by
    // definition — a client that cached either forever would hold a hive that
    // can never move.
    if let [dir, entry] = segments.as_slice() {
        if is_sig(dir) {
            return match hive.entry(dir, entry) {
                Some(bytes) => cors(Reply::new(200))
                    .with("content-type", "application/octet-stream")
                    .with("cache-control", "no-cache, must-revalidate")
                    .body(Body::Bytes(bytes)),
                None => cors(Reply::new(404)),
            };
        }
    }

    // (4) A miss. A hive LOCATION is not a file, so an ordinary deep link gets
    // the shell — but a miss at or under a signature is a real 404. See the
    // module docs: answering those with HTML is how an origin poisons the nodes
    // replicating from it.
    if is_sig(&name) || is_sig(&first) {
        return cors(Reply::new(404));
    }

    let index = shell.join("index.html");
    if index.is_file() {
        return cors(Reply::new(200))
            .with("content-type", "text/html; charset=utf-8")
            .with("cache-control", "no-cache")
            .body(Body::File(index));
    }
    cors(Reply::new(404))
}

/// How many connections may be in flight before the host sheds load.
///
/// A thread per connection is the right shape for a host whose work is a B-tree
/// read or a file stream — but only with a ceiling, or one client opening
/// sockets in a loop takes the desktop app down with it.
const MAX_CONNECTIONS: usize = 64;

/// A running host. Dropping it stops the listener.
#[derive(Debug)]
pub struct Serving {
    addr: SocketAddr,
    shutdown: Arc<AtomicBool>,
    accepting: Option<JoinHandle<()>>,
}

impl Serving {
    /// Where it is listening — the resolved address, so a port of 0 reports the
    /// one the OS actually chose.
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// The address to hand someone else on this network.
    ///
    /// A host bound to every interface is reachable at an address it never
    /// mentions, and `0.0.0.0` in a dialog is not something anyone can type
    /// into a browser. Resolved by asking the routing table which local address
    /// would be used to reach the outside — a connectionless UDP socket, so no
    /// packet is ever sent and nothing needs to be reachable for it to answer.
    pub fn lan_url(&self) -> String {
        let port = self.addr.port();
        if !self.addr.ip().is_unspecified() {
            return format!("http://{}:{port}", self.addr.ip());
        }
        match UdpSocket::bind("0.0.0.0:0").and_then(|socket| {
            socket.connect("203.0.113.1:80")?;
            socket.local_addr()
        }) {
            Ok(local) => format!("http://{}:{port}", local.ip()),
            Err(_) => format!("http://localhost:{port}"),
        }
    }

    /// Stop accepting, and wait for the listener thread to end. In-flight
    /// responses finish; they hold no lock the shutdown waits on.
    pub fn stop(mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(handle) = self.accepting.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for Serving {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }
}

/// Start serving `hive` behind `shell` on `bind:port`.
///
/// Returns as soon as the socket is bound, so a caller can report the real
/// address — and so a port already in use is an error the operator sees rather
/// than a host that silently never came up.
pub fn serve(
    shell: impl Into<PathBuf>,
    hive: Arc<dyn HiveSource>,
    bind: IpAddr,
    port: u16,
) -> std::io::Result<Serving> {
    let shell = shell.into();
    let listener = TcpListener::bind(SocketAddr::new(bind, port))?;
    let addr = listener.local_addr()?;
    listener.set_nonblocking(true)?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let live = Arc::new(AtomicUsize::new(0));

    let accepting = {
        let shutdown = shutdown.clone();
        std::thread::Builder::new()
            .name("hypercomb-host".into())
            .spawn(move || {
                while !shutdown.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            // The listener is non-blocking so shutdown can
                            // interrupt it — but on macOS/BSD and on Windows an
                            // accepted socket INHERITS that flag (Linux does
                            // not), and a non-blocking connection is a broken
                            // host in two directions at once. A read whose
                            // bytes have not landed yet answers WouldBlock,
                            // which reads here as a malformed request: a 400 on
                            // a connection that did nothing wrong. And a write
                            // larger than the socket buffer stops at the first
                            // WouldBlock — `write_all` does not retry it — so a
                            // body over ~128 kB arrives truncated and the peer
                            // sees the socket close mid-response. Clearing it
                            // here restores the blocking reads and writes the
                            // timeouts below are written for, and covers the
                            // shed path as well as the served one.
                            let _ = stream.set_nonblocking(false);
                            if live.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
                                shed(stream);
                                continue;
                            }
                            live.fetch_add(1, Ordering::SeqCst);
                            let shell = shell.clone();
                            let hive = hive.clone();
                            let done = live.clone();
                            let spawned = std::thread::Builder::new()
                                .name("hypercomb-host-conn".into())
                                .spawn(move || {
                                    handle(stream, &shell, hive.as_ref());
                                    done.fetch_sub(1, Ordering::SeqCst);
                                });
                            if spawned.is_err() {
                                live.fetch_sub(1, Ordering::SeqCst);
                            }
                        }
                        // Non-blocking accept is how a blocking listener becomes
                        // interruptible without a platform-specific wakeup.
                        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(25));
                        }
                        Err(_) => std::thread::sleep(Duration::from_millis(25)),
                    }
                }
            })?
    };

    Ok(Serving { addr, shutdown, accepting: Some(accepting) })
}

/// Answer over the ceiling rather than dropping the socket. A refused
/// connection reads as "the host is down"; a 503 reads as what it is.
fn shed(mut stream: TcpStream) {
    let reply = cors(Reply::new(503).with("retry-after", "1"));
    let _ = http::write_reply(&mut stream, &reply, true, false);
}

fn handle(stream: TcpStream, shell: &Path, hive: &dyn HiveSource) {
    // A connection that opens and says nothing must not hold a thread forever.
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    let _ = stream.set_nodelay(true);

    // Reader and writer are separate handles onto the same socket, because the
    // reader must OUTLIVE the loop: a pipelined client sends its next request
    // in the same packet as the first, so those bytes are already in the
    // buffer. Rebuilding the reader per request drops them and the second
    // request arrives truncated — which is a 400 on a connection that did
    // nothing wrong.
    let Ok(mut writer) = stream.try_clone() else { return };
    let mut reader = BufReader::new(&stream);

    loop {
        let request = match http::read_request(&mut reader) {
            Ok(Some(request)) => request,
            Ok(None) => return,
            Err(_) => {
                let reply = cors(Reply::new(400));
                let _ = http::write_reply(&mut writer, &reply, true, false);
                return;
            }
        };
        let reply = resolve(shell, hive, &request.method, &request.target);
        let keep_alive = request.keep_alive;
        let sent = http::write_reply(&mut writer, &reply, request.method != "HEAD", keep_alive);
        if sent.is_err() || !keep_alive {
            return;
        }
    }
}

/// The loopback address, for a host meant only for this machine.
pub const LOOPBACK: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);

/// Every interface, for a host meant to be reached.
pub const ANY: IpAddr = IpAddr::V4(Ipv4Addr::UNSPECIFIED);

#[cfg(test)]
mod tests;
