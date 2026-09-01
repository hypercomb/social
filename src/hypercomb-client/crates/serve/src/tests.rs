//! The host contract, asserted.
//!
//! These mirror `hypercomb-shim/host/check-host.mjs` rule for rule. The checker
//! is the acceptance test and runs against a live URL; these run in
//! milliseconds and fail on the line that broke.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;
use std::path::PathBuf;
use std::sync::Arc;

use super::*;

const SIG_A: &str = "ac63c4816532b044965f15d734b18fe4b68a567d63655141c06dbe5755384f1c";
const SIG_B: &str = "0306efe8336a5887faab3aca7a275eb8b0d6e129c0eea5041ab23133c51fb54d";

/// A hive with known contents, so a test asserts the ROUTER rather than a
/// store. The store's own behaviour is covered by `hypercomb-store`; what is
/// interesting here is what the wire does with a hit and a miss.
#[derive(Debug, Default)]
struct Stub {
    content: BTreeMap<String, Vec<u8>>,
    entries: BTreeMap<(String, String), Vec<u8>>,
}

impl HiveSource for Stub {
    fn content(&self, sig: &str) -> Option<Vec<u8>> {
        self.content.get(sig).cloned()
    }
    fn entry(&self, sig: &str, name: &str) -> Option<Vec<u8>> {
        self.entries.get(&(sig.to_string(), name.to_string())).cloned()
    }
}

/// A shell directory shaped like a shim build.
fn shell() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("a temp dir");
    let root = dir.path().to_path_buf();
    std::fs::write(root.join("index.html"), b"<!doctype html><script src=\"./main.js\">").unwrap();
    std::fs::write(root.join("main.js"), b"// shell").unwrap();
    std::fs::write(root.join("hypercomb.worker.js"), b"// worker").unwrap();
    std::fs::write(root.join("pin"), SIG_A.as_bytes()).unwrap();
    std::fs::write(root.join(SIG_A), b"bootstrap bundle").unwrap();
    std::fs::create_dir_all(root.join("content")).unwrap();
    std::fs::write(root.join("content").join("manifest.json"), b"{\"packages\":{}}").unwrap();
    (dir, root)
}

fn body_of(reply: &Reply) -> Vec<u8> {
    match &reply.body {
        Body::Bytes(bytes) => bytes.clone(),
        Body::File(path) => std::fs::read(path).expect("the file the reply names"),
        Body::Empty => Vec::new(),
    }
}

#[test]
fn a_real_file_wins_before_any_rewrite() {
    let (_dir, root) = shell();
    let hive = Stub::default();

    // The rule every off-the-shelf SPA server gets wrong: these have no
    // extension, so a "no extension means a route" heuristic hands back HTML.
    for path in ["/pin", &format!("/{SIG_A}")] {
        let reply = resolve(&root, &hive, "GET", path);
        assert_eq!(reply.status, 200, "{path}");
        assert_ne!(
            reply.header("content-type"),
            Some("text/html; charset=utf-8"),
            "{path} was swallowed by the SPA fallback",
        );
    }
    assert_eq!(body_of(&resolve(&root, &hive, "GET", "/pin")), SIG_A.as_bytes());
}

#[test]
fn content_is_served_from_the_store_at_both_bases() {
    let (_dir, root) = shell();
    let mut hive = Stub::default();
    hive.content.insert(SIG_B.to_string(), b"atom bytes".to_vec());

    for path in [format!("/{SIG_B}"), format!("/content/{SIG_B}")] {
        let reply = resolve(&root, &hive, "GET", &path);
        assert_eq!(reply.status, 200, "{path}");
        assert_eq!(body_of(&reply), b"atom bytes", "{path}");
        assert_eq!(
            reply.header("cache-control"),
            Some("public, max-age=31536000, immutable"),
            "a signature path is immutable — the name IS the hash",
        );
        assert_eq!(reply.header("etag"), Some(format!("\"{SIG_B}\"").as_str()));
    }
}

#[test]
fn markers_and_pool_members_come_out_of_the_directory() {
    let (_dir, root) = shell();
    let mut hive = Stub::default();
    hive.entries.insert(
        (SIG_B.to_string(), "00000007".to_string()),
        format!("{{\"layer\":\"{SIG_A}\"}}").into_bytes(),
    );
    hive.entries
        .insert((SIG_B.to_string(), "my note".to_string()), b"pool bytes".to_vec());

    let marker = resolve(&root, &hive, "GET", &format!("/{SIG_B}/00000007"));
    assert_eq!(marker.status, 200);
    assert!(String::from_utf8_lossy(&body_of(&marker)).contains(SIG_A));
    assert_eq!(
        marker.header("cache-control"),
        Some("no-cache, must-revalidate"),
        "history compaction can renumber a bag — a marker is not immutable",
    );

    // A user-chosen name arrives percent-encoded and must be decoded before it
    // reaches the pool.
    let member = resolve(&root, &hive, "GET", &format!("/{SIG_B}/my%20note"));
    assert_eq!(member.status, 200);
    assert_eq!(body_of(&member), b"pool bytes");
}

#[test]
fn a_miss_at_a_signature_is_a_real_404() {
    let (_dir, root) = shell();
    let hive = Stub::default();
    assert_eq!(resolve(&root, &hive, "GET", &format!("/{SIG_B}")).status, 404);
    assert_eq!(resolve(&root, &hive, "GET", &format!("/content/{SIG_B}")).status, 404);
}

#[test]
fn a_miss_inside_a_signature_never_answers_with_the_shell() {
    let (_dir, root) = shell();
    let hive = Stub::default();

    // THE ONE THAT POISONS A NODE. A replicator writes whatever bytes come back
    // into its own lineage bag, and a marker is not content-addressed, so
    // nothing downstream would notice it had written HTML.
    let reply = resolve(&root, &hive, "GET", &format!("/{SIG_B}/00000000"));
    assert_eq!(reply.status, 404);
    assert!(body_of(&reply).is_empty());

    let member = resolve(&root, &hive, "GET", &format!("/{SIG_B}/clipboard-entry"));
    assert_eq!(member.status, 404);
}

#[test]
fn deep_links_reach_the_shell() {
    let (_dir, root) = shell();
    let hive = Stub::default();
    let reply = resolve(&root, &hive, "GET", "/a/deep/hive/location");
    assert_eq!(reply.status, 200);
    assert_eq!(reply.header("content-type"), Some("text/html; charset=utf-8"));
    assert!(String::from_utf8_lossy(&body_of(&reply)).contains("main.js"));
}

#[test]
fn the_code_channel_never_caches_hard() {
    let (_dir, root) = shell();
    let hive = Stub::default();
    for path in ["/pin", "/main.js", "/hypercomb.worker.js"] {
        let cache = resolve(&root, &hive, "GET", path)
            .header("cache-control")
            .unwrap_or_default()
            .to_string();
        assert!(
            cache.contains("no-store") || cache.contains("no-cache") || cache.contains("max-age=0"),
            "{path} answered {cache} — a stale pin cannot be repointed and a stale worker strands clients",
        );
    }
}

#[test]
fn content_is_readable_cross_origin() {
    let (_dir, root) = shell();
    let hive = Stub::default();
    for path in ["/", "/content/manifest.json", "/nothing/here"] {
        assert_eq!(
            resolve(&root, &hive, "GET", path).header("access-control-allow-origin"),
            Some("*"),
            "{path} — a host exists to be pulled FROM",
        );
    }
}

#[test]
fn traversal_is_refused_however_it_is_spelled() {
    let (_dir, root) = shell();
    let hive = Stub::default();
    for path in ["/../secret", "/content/../../secret", "/%2e%2e/secret"] {
        assert_eq!(resolve(&root, &hive, "GET", path).status, 403, "{path}");
    }
}

#[test]
fn a_host_publishes_and_does_not_accept() {
    let (_dir, root) = shell();
    let hive = Stub::default();
    for method in ["PUT", "POST", "DELETE"] {
        assert_eq!(resolve(&root, &hive, method, &format!("/{SIG_A}")).status, 405, "{method}");
    }
    assert_eq!(resolve(&root, &hive, "OPTIONS", "/").status, 204);
}

#[test]
fn a_query_string_does_not_change_the_answer() {
    let (_dir, root) = shell();
    let hive = Stub::default();
    let reply = resolve(&root, &hive, "GET", "/pin?cachebust=1");
    assert_eq!(reply.status, 200);
    assert_eq!(body_of(&reply), SIG_A.as_bytes());
}

/// The store behind the trait — proving the wiring, not the storage.
#[test]
fn a_real_hive_serves_its_own_bytes() {
    let (_dir, root) = shell();
    let hive_dir = tempfile::tempdir().expect("a temp dir");
    let host = hypercomb_host::Host::open(hive_dir.path()).expect("a hive");
    let sig = host.put(b"a resource in the store").expect("put");

    let reply = resolve(&root, &host, "GET", &format!("/{sig}"));
    assert_eq!(reply.status, 200);
    assert_eq!(body_of(&reply), b"a resource in the store");
}

// ── the wire ────────────────────────────────────────────────────────────────

fn fetch(addr: std::net::SocketAddr, request: &str) -> String {
    let mut stream = TcpStream::connect(addr).expect("connect");
    stream.write_all(request.as_bytes()).expect("write");
    let mut out = String::new();
    stream.read_to_string(&mut out).expect("read");
    out
}

#[test]
fn it_answers_on_a_socket() {
    let (_dir, root) = shell();
    let mut stub = Stub::default();
    stub.content.insert(SIG_B.to_string(), b"atom bytes".to_vec());

    // Port 0: the OS picks, so a busy machine never fails this test.
    let serving = serve(root, Arc::new(stub), LOOPBACK, 0).expect("bind");
    let addr = serving.addr();

    let response = fetch(addr, "GET /pin HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
    assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
    assert!(response.contains("access-control-allow-origin: *"), "{response}");
    assert!(response.ends_with(SIG_A), "{response}");

    let atom = fetch(
        addr,
        &format!("GET /{SIG_B} HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n"),
    );
    assert!(atom.ends_with("atom bytes"), "{atom}");

    // HEAD reports the length it would have sent, and sends nothing.
    let head = fetch(addr, "HEAD /main.js HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
    assert!(head.contains("content-length: 8"), "{head}");
    assert!(head.ends_with("\r\n\r\n"), "{head}");

    let missing = fetch(
        addr,
        &format!("GET /{SIG_A}/00000003 HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n"),
    );
    assert!(missing.starts_with("HTTP/1.1 404"), "{missing}");

    serving.stop();
    assert!(
        TcpStream::connect(addr).and_then(|mut s| s.write_all(b"GET / HTTP/1.0\r\n\r\n")).is_err()
            || TcpStream::connect(addr).is_err(),
        "the listener should be gone after stop()",
    );
}

#[test]
fn one_connection_serves_many_requests() {
    let (_dir, root) = shell();
    let serving = serve(root, Arc::new(Stub::default()), LOOPBACK, 0).expect("bind");

    let mut stream = TcpStream::connect(serving.addr()).expect("connect");
    stream
        .write_all(b"GET /pin HTTP/1.1\r\nHost: h\r\n\r\nGET /main.js HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n")
        .expect("write");
    let mut out = String::new();
    stream.read_to_string(&mut out).expect("read");

    assert_eq!(out.matches("HTTP/1.1 200 OK").count(), 2, "{out}");
    serving.stop();
}

/// A body larger than any socket send buffer arrives WHOLE.
///
/// The listener is non-blocking so shutdown can interrupt it, and on macOS/BSD
/// and Windows an accepted socket inherits that flag. `write_all` treats the
/// resulting WouldBlock as a failure rather than a wait, so the host used to
/// stop at the first full send buffer — a 164 kB locale catalog reached its
/// reader as 128 kB and a dropped socket. Small replies never noticed, which is
/// why every other test here passed. Anything over the buffer notices.
#[test]
fn a_body_larger_than_the_socket_buffer_arrives_whole() {
    const SIZE: usize = 2 * 1024 * 1024;
    let (_dir, root) = shell();
    let mut stub = Stub::default();
    stub.content.insert(SIG_B.to_string(), vec![b'x'; SIZE]);

    let serving = serve(root, Arc::new(stub), LOOPBACK, 0).expect("bind");
    let response = fetch(
        serving.addr(),
        &format!("GET /{SIG_B} HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n"),
    );

    let (head, body) = response.split_once("\r\n\r\n").expect("a header block");
    assert!(head.contains(&format!("content-length: {SIZE}")), "{head}");
    assert_eq!(body.len(), SIZE, "body truncated at {} of {SIZE} bytes", body.len());
    serving.stop();
}

/// A request that arrives AFTER the accept is answered, not rejected.
///
/// The other half of the inherited non-blocking flag: a read whose bytes have
/// not landed yet answered WouldBlock, which reads as a malformed request line
/// and became a 400 on a connection that did nothing wrong. Every client that
/// opens a socket before it knows what to ask for hits this window; the sleep
/// just makes the window certain instead of a race.
#[test]
fn a_request_that_arrives_after_the_accept_is_answered() {
    let (_dir, root) = shell();
    let serving = serve(root, Arc::new(Stub::default()), LOOPBACK, 0).expect("bind");

    let mut stream = TcpStream::connect(serving.addr()).expect("connect");
    std::thread::sleep(Duration::from_millis(250));
    stream
        .write_all(b"GET /pin HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n")
        .expect("write");
    let mut out = String::new();
    stream.read_to_string(&mut out).expect("read");

    assert!(out.starts_with("HTTP/1.1 200 OK"), "{out}");
    serving.stop();
}
