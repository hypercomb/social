//! The read-only deployment server — the app as an oasis.
//!
//! Serves a **published folder** (the xcopy artifact `publish:site`
//! assembles: faces + flat sig pool + `/content` package) over plain
//! HTTP/1.1 on a loopback port, so a Cloudflare tunnel can put a domain on
//! it. Deliberately the dumbest server that honors the contract:
//!
//! - `GET`/`HEAD`/`OPTIONS` only — a read-only deployment never writes.
//! - Directory requests fall to the directory's `index.html`, which is what
//!   every real static host does untouched and what the materialized page
//!   tree relies on.
//! - Sig-named files are immutable by name, so they carry
//!   `Cache-Control: immutable` and the edge does the serving after first
//!   touch. Faces (`.html`) are `no-cache` — they move when the site syncs
//!   to a new signature.
//! - CORS is wide open: the folder is an open oasis; installers on other
//!   origins may drink. The Merkle gate is the security, not the transport.
//!
//! It serves ONLY the picked folder — never the live store. The published
//! folder is the consented public subset; the store holds everything else.
//!
//! Loopback only: the tunnel is the one front door, nothing is exposed to
//! the LAN. No new dependencies — `std::net` and a thread per connection,
//! which is the right scale for a personal oasis behind an edge cache.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

/// A running site server. Dropping it does NOT stop it — call [`SiteServer::stop`].
#[derive(Debug)]
pub struct SiteServer {
    root: PathBuf,
    port: u16,
    running: Arc<AtomicBool>,
    accept_thread: Option<JoinHandle<()>>,
}

impl SiteServer {
    /// Serve `root` on `127.0.0.1:port`. Port 0 picks an ephemeral port —
    /// read the real one back with [`SiteServer::port`].
    pub fn start(root: impl AsRef<Path>, port: u16) -> std::io::Result<Self> {
        let root = root.as_ref().canonicalize()?;
        let listener = TcpListener::bind(("127.0.0.1", port))?;
        let port = listener.local_addr()?.port();
        let running = Arc::new(AtomicBool::new(true));

        let accept_root = root.clone();
        let accept_running = Arc::clone(&running);
        let accept_thread = std::thread::spawn(move || {
            for stream in listener.incoming() {
                if !accept_running.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(stream) = stream else { continue };
                let root = accept_root.clone();
                std::thread::spawn(move || {
                    let _ = handle(stream, &root);
                });
            }
        });

        Ok(Self { root, port, running, accept_thread: Some(accept_thread) })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Stop accepting. In-flight responses finish on their own threads.
    pub fn stop(mut self) {
        self.running.store(false, Ordering::SeqCst);
        // Unblock the accept loop with one throwaway connection.
        let _ = TcpStream::connect(("127.0.0.1", self.port));
        if let Some(handle) = self.accept_thread.take() {
            let _ = handle.join();
        }
    }
}

/// 64 lowercase hex chars — a signature-named file, immutable by definition.
fn is_sig_name(name: &str) -> bool {
    name.len() == 64 && name.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        "md" => "text/markdown; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Minimal %XX decoding — enough for real paths; invalid escapes pass through.
fn percent_decode(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&path[i + 1..i + 3], 16) {
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

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    mime: &str,
    cache: &str,
    body: Option<&[u8]>,
    length: u64,
) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {mime}\r\n\
         Content-Length: {length}\r\n\
         Cache-Control: {cache}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
         Connection: close\r\n\r\n"
    );
    stream.write_all(head.as_bytes())?;
    if let Some(body) = body {
        stream.write_all(body)?;
    }
    Ok(())
}

fn handle(mut stream: TcpStream, root: &Path) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    // Drain headers; nothing in them changes a read-only response.
    let mut header = String::new();
    while reader.read_line(&mut header)? > 2 {
        header.clear();
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let raw_path = parts.next().unwrap_or("/");

    if method == "OPTIONS" {
        return write_response(&mut stream, "204 No Content", "text/plain", "no-cache", None, 0);
    }
    if method != "GET" && method != "HEAD" {
        return write_response(&mut stream, "405 Method Not Allowed", "text/plain", "no-cache", Some(b"read-only"), 9);
    }

    let path = percent_decode(raw_path.split('?').next().unwrap_or("/"));
    let relative = path.trim_start_matches('/');
    let mut file = if relative.is_empty() { root.join("index.html") } else { root.join(relative) };
    if file.is_dir() {
        file = file.join("index.html");
    }

    // Traversal guard: resolve, then verify the result still lives in root.
    let resolved = match file.canonicalize() {
        Ok(resolved) if resolved.starts_with(root) => resolved,
        _ => return write_response(&mut stream, "404 Not Found", "text/plain", "no-cache", Some(b"not found"), 9),
    };
    let Ok(mut opened) = std::fs::File::open(&resolved) else {
        return write_response(&mut stream, "404 Not Found", "text/plain", "no-cache", Some(b"not found"), 9);
    };
    let length = opened.metadata().map(|m| m.len()).unwrap_or(0);

    let name = resolved.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let cache = if is_sig_name(name) {
        "public, max-age=31536000, immutable"
    } else if resolved.extension().and_then(|e| e.to_str()) == Some("html") {
        "no-cache"
    } else {
        "public, max-age=300"
    };

    if method == "HEAD" {
        return write_response(&mut stream, "200 OK", mime_for(&resolved), cache, None, length);
    }
    let mut body = Vec::with_capacity(length as usize);
    opened.read_to_end(&mut body)?;
    write_response(&mut stream, "200 OK", mime_for(&resolved), cache, Some(&body), body.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn request(port: u16, raw: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        stream.write_all(raw.as_bytes()).expect("send");
        let mut response = String::new();
        BufReader::new(stream).read_to_string(&mut response).expect("read");
        response
    }

    fn site() -> (tempfile::TempDir, SiteServer) {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("index.html"), "<h1>root face</h1>").expect("write");
        std::fs::create_dir_all(dir.path().join("branch/child")).expect("mkdir");
        std::fs::write(dir.path().join("branch/child/index.html"), "child face").expect("write");
        let sig = "a".repeat(64);
        std::fs::write(dir.path().join(&sig), b"sig bytes").expect("write");
        let server = SiteServer::start(dir.path(), 0).expect("start");
        (dir, server)
    }

    #[test]
    fn serves_root_and_directory_index() {
        let (_dir, server) = site();
        let root = request(server.port(), "GET / HTTP/1.1\r\n\r\n");
        assert!(root.contains("200 OK") && root.contains("text/html") && root.contains("root face"));
        let child = request(server.port(), "GET /branch/child HTTP/1.1\r\n\r\n");
        assert!(child.contains("200 OK") && child.contains("child face"));
        server.stop();
    }

    #[test]
    fn sig_files_are_immutable_octet_stream() {
        let (_dir, server) = site();
        let response = request(server.port(), &format!("GET /{} HTTP/1.1\r\n\r\n", "a".repeat(64)));
        assert!(response.contains("200 OK"));
        assert!(response.contains("application/octet-stream"));
        assert!(response.contains("immutable"));
        server.stop();
    }

    #[test]
    fn refuses_traversal_and_writes() {
        let (_dir, server) = site();
        let escape = request(server.port(), "GET /../../etc/hosts HTTP/1.1\r\n\r\n");
        assert!(escape.contains("404"));
        let put = request(server.port(), "PUT /x HTTP/1.1\r\n\r\n");
        assert!(put.contains("405"));
        server.stop();
    }

    #[test]
    fn options_preflight_and_head() {
        let (_dir, server) = site();
        let options = request(server.port(), "OPTIONS / HTTP/1.1\r\n\r\n");
        assert!(options.contains("204") && options.contains("Access-Control-Allow-Origin"));
        let head = request(server.port(), "HEAD / HTTP/1.1\r\n\r\n");
        assert!(head.contains("200 OK") && !head.contains("root face"));
        server.stop();
    }
}
