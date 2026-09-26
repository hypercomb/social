//! The smallest HTTP/1.1 a host needs, and nothing else.
//!
//! No framework, no async runtime, no dependency. That is not minimalism for
//! its own sake: this crate links into the desktop app, and a host that drags
//! an async runtime into a Tauri process is a host nobody turns on.
//!
//! The surface is deliberately tiny — a host answers `GET` and `HEAD`, has no
//! request body to read, no session to keep, and no answer that depends on who
//! is asking. Everything else is a 405.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;

/// Longest request line + headers accepted. A host reads no body, so anything
/// past this is either a mistake or an attempt to make us allocate.
const MAX_HEAD: usize = 8 * 1024;

/// What a reply carries. Bytes come from the store; files are streamed off
/// disk so a large blob in the shell never has to be resident.
#[derive(Debug)]
pub enum Body {
    Empty,
    Bytes(Vec<u8>),
    File(PathBuf),
}

/// A complete answer, independent of the socket — which is what makes the
/// router testable without binding a port.
#[derive(Debug)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Body,
}

impl Reply {
    pub fn new(status: u16) -> Self {
        Self { status, headers: Vec::new(), body: Body::Empty }
    }

    pub fn with(mut self, name: &str, value: impl Into<String>) -> Self {
        self.headers.push((name.to_string(), value.into()));
        self
    }

    pub fn body(mut self, body: Body) -> Self {
        self.body = body;
        self
    }

    /// Read a header back — for tests and for the CLI's logging.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// One parsed request. `target` is the raw request target, still percent-encoded
/// and still carrying any query — decoding belongs to the router.
#[derive(Debug)]
pub struct Request {
    pub method: String,
    pub target: String,
    pub keep_alive: bool,
}

/// Read one request, or `None` when the peer closed cleanly.
pub fn read_request(reader: &mut BufReader<&TcpStream>) -> io::Result<Option<Request>> {
    let mut line = String::new();
    let mut read = 0usize;

    // A keep-alive connection sits here between requests, so EOF is the normal
    // ending rather than an error.
    if reader.read_line(&mut line)? == 0 {
        return Ok(None);
    }
    read += line.len();

    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let target = parts.next().unwrap_or_default().to_string();
    let version = parts.next().unwrap_or("HTTP/1.1").to_string();
    if method.is_empty() || target.is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "malformed request line"));
    }

    // HTTP/1.0 defaults to close; 1.1 defaults to keep-alive. `Connection` may
    // override either way.
    let mut keep_alive = !version.starts_with("HTTP/1.0");
    let mut has_body = false;

    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        read += line.len();
        if read > MAX_HEAD {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "request head too large"));
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        let Some((name, value)) = trimmed.split_once(':') else { continue };
        let value = value.trim();
        if name.eq_ignore_ascii_case("connection") {
            keep_alive = !value.eq_ignore_ascii_case("close");
        } else if name.eq_ignore_ascii_case("content-length") {
            has_body = value.trim() != "0";
        } else if name.eq_ignore_ascii_case("transfer-encoding") {
            has_body = true;
        }
    }

    // A GET with a body is not something a host serves. Rather than parse it,
    // answer and close — reusing the connection would misframe the next request.
    if has_body {
        keep_alive = false;
    }

    Ok(Some(Request { method, target, keep_alive }))
}

fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        304 => "Not Modified",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        503 => "Service Unavailable",
        _ => "Internal Server Error",
    }
}

/// Write a reply. `send_body` is false for `HEAD`, which still reports the
/// length it would have sent.
pub fn write_reply(stream: &mut TcpStream, reply: &Reply, send_body: bool, keep_alive: bool) -> io::Result<()> {
    let length = match &reply.body {
        Body::Empty => 0,
        Body::Bytes(bytes) => bytes.len() as u64,
        Body::File(path) => std::fs::metadata(path).map(|held| held.len()).unwrap_or(0),
    };

    let mut head = format!("HTTP/1.1 {} {}\r\n", reply.status, status_text(reply.status));
    for (name, value) in &reply.headers {
        head.push_str(name);
        head.push_str(": ");
        head.push_str(value);
        head.push_str("\r\n");
    }
    head.push_str(&format!("content-length: {length}\r\n"));
    head.push_str(if keep_alive { "connection: keep-alive\r\n" } else { "connection: close\r\n" });
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;

    if !send_body || length == 0 {
        return stream.flush();
    }

    match &reply.body {
        Body::Empty => {}
        Body::Bytes(bytes) => stream.write_all(bytes)?,
        Body::File(path) => {
            let mut file = std::fs::File::open(path)?;
            let mut buffer = vec![0u8; 64 * 1024];
            loop {
                let read = file.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                stream.write_all(&buffer[..read])?;
            }
        }
    }
    stream.flush()
}
