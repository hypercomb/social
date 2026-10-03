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
const SIG_C: &str = "5f1b0e7c1f0e4ad3b52a1e4a3c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d";

/// A pool's address: sign(meaning), the derivation every client makes.
fn pool(meaning: &str) -> String {
    hypercomb_protocol::sign_str(meaning).to_hex()
}

/// A marker record naming `sig`, the shape every document head carries.
fn marker(sig: &str) -> Vec<u8> {
    format!("{{\"layer\":\"{sig}\"}}").into_bytes()
}

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
    fn entries(&self, sig: &str) -> Option<Vec<String>> {
        let mut names: Vec<String> = self
            .entries
            .keys()
            .filter(|(held, _)| held == sig)
            .map(|(_, name)| name.clone())
            .collect();
        if names.is_empty() {
            return None;
        }
        names.sort();
        Some(names)
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
fn a_door_is_read_by_signature_never_by_a_named_route() {
    // There is no `/site.json`: a host name is read as its bag,
    // sign(<hostname>), whose newest marker names the activation layer —
    // every step a signature (jwize 2026-09-25).
    let (_dir, root) = shell();
    let hive_dir = tempfile::tempdir().expect("a temp dir");
    let hive = hypercomb_host::Host::open(hive_dir.path()).expect("a hive");
    let head = hive.put(b"creation").expect("root");
    let layer = serde_json::to_vec(&serde_json::json!({
        "name": "host:activation", "enabled": true,
        "pubkey": SIG_A, "lineage": "garden", "sourceRoute": "https://garden.jwize.com/",
        "localRoute": "garden.localhost", "head": head, "source": "jwize.com",
    })).unwrap();
    let layer_sig = hive.put(&layer).expect("layer");
    let bag = hypercomb_protocol::sign_str("garden.localhost").to_hex();
    hive.raw_dir_put(&bag, "00000000", &serde_json::to_vec(&serde_json::json!({ "layer": layer_sig })).unwrap())
        .expect("marker");

    let marker = resolve(&root, &hive, "GET", &format!("/{bag}/00000000"));
    assert_eq!(marker.status, 200);
    let named: serde_json::Value = serde_json::from_slice(&body_of(&marker)).unwrap();
    assert_eq!(named["layer"], layer_sig);
    let activation = resolve(&root, &hive, "GET", &format!("/{layer_sig}"));
    assert_eq!(activation.status, 200);
    let door: serde_json::Value = serde_json::from_slice(&body_of(&activation)).unwrap();
    assert_eq!(door["head"], head);
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
        marker(SIG_A),
    );
    let hosts = pool("community:hosts");
    hive.entries
        .insert((hosts.clone(), "my note".to_string()), b"pool bytes".to_vec());

    // A bag's HEAD marker is the one entry any directory gives up.
    let head = resolve(&root, &hive, "GET", &format!("/{SIG_B}/00000007"));
    assert_eq!(head.status, 200);
    assert!(String::from_utf8_lossy(&body_of(&head)).contains(SIG_A));
    assert_eq!(
        head.header("cache-control"),
        Some("no-cache, must-revalidate"),
        "history compaction can renumber a bag — a marker is not immutable",
    );

    // A user-chosen name arrives percent-encoded and must be decoded before it
    // reaches the pool — a FLOOR pool, the only kind whose members are served.
    let member = resolve(&root, &hive, "GET", &format!("/{hosts}/my%20note"));
    assert_eq!(member.status, 200);
    assert_eq!(body_of(&member), b"pool bytes");

    // `/content` is the canonical namespace used by static hosts. A machine
    // host accepts it too, so a discovered base works without host-specific
    // branching in the reader.
    let canonical = resolve(&root, &hive, "GET", &format!("/content/{hosts}/my%20note"));
    assert_eq!(canonical.status, 200);
    assert_eq!(body_of(&canonical), b"pool bytes");
}

#[test]
fn a_signature_directory_lists_its_members_at_both_bases() {
    let (_dir, root) = shell();
    let mut hive = Stub::default();
    // A floor `set` pool — the only directories a host lists.
    let packages = pool("host:packages");
    hive.entries.insert(
        (packages.clone(), "00000001".to_string()),
        SIG_A.as_bytes().to_vec(),
    );
    hive.entries.insert(
        (packages.clone(), "00000000".to_string()),
        SIG_A.as_bytes().to_vec(),
    );

    for path in [format!("/{packages}/"), format!("/content/{packages}/")] {
        let reply = resolve(&root, &hive, "GET", &path);
        assert_eq!(reply.status, 200, "{path}");
        assert_eq!(
            reply.header("content-type"),
            Some("text/plain; charset=utf-8")
        );
        assert_eq!(reply.header("cache-control"), Some("no-store"));
        assert_eq!(reply.header("access-control-allow-origin"), Some("*"));
        assert_eq!(body_of(&reply), b"00000000\n00000001");
    }
}

#[test]
fn staged_and_live_pool_entries_are_one_listing_and_live_bytes_win() {
    let (_dir, root) = shell();
    // What a shim build stages: the `host:packages` floor pool.
    let packages = pool("host:packages");
    let staged_pool = root.join("content").join(&packages);
    std::fs::create_dir_all(&staged_pool).unwrap();
    std::fs::write(staged_pool.join("index.html"), b"00000000\n00000002").unwrap();
    std::fs::write(staged_pool.join("listing.txt"), b"00000000\n00000002").unwrap();
    std::fs::write(staged_pool.join("00000000"), b"staged old bytes").unwrap();
    std::fs::write(staged_pool.join("00000002"), b"staged package").unwrap();

    let mut hive = Stub::default();
    hive.entries.insert(
        (packages.clone(), "00000000".to_string()),
        b"live current bytes".to_vec(),
    );

    let listing = resolve(&root, &hive, "GET", &format!("/content/{packages}/"));
    assert_eq!(body_of(&listing), b"00000000\n00000002");

    let live = resolve(&root, &hive, "GET", &format!("/content/{packages}/00000000"));
    assert_eq!(body_of(&live), b"live current bytes");

    let staged = resolve(&root, &hive, "GET", &format!("/content/{packages}/00000002"));
    assert_eq!(body_of(&staged), b"staged package");
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

    let canonical = resolve(
        &root,
        &hive,
        "GET",
        &format!("/content/{SIG_B}/clipboard-entry"),
    );
    assert_eq!(canonical.status, 404);
    assert!(body_of(&canonical).is_empty());

    assert_eq!(
        resolve(&root, &hive, "GET", &format!("/content/{SIG_B}/")).status,
        404,
    );
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

// ── only the genome leaves (layer-pattern-audit.md, rule 6) ─────────────────

/// The floor this host lists is the relay's file, parsed — not a second copy.
#[test]
fn the_floor_is_the_shared_file() {
    let floor = floor();
    assert_eq!(floor.len(), 4, "{floor:?}");
    for meaning in ["host:packages", "host:offerings", "community:hosts"] {
        assert_eq!(floor_policy(&pool(meaning)), Some(Policy::Set), "{meaning}");
    }
    assert_eq!(floor_policy(&pool("community:offers")), Some(Policy::Document));
    assert_eq!(floor_policy(&pool("journal:entries")), None);
}

#[test]
fn an_unlisted_directory_answers_exactly_like_an_absent_one() {
    let (_dir, root) = shell();
    let mut hive = Stub::default();
    // A participant document pool with history, and a tile's bag.
    let journal = pool("journal:entries");
    hive.entries.insert((journal.clone(), SIG_A.to_string()), b"old entry".to_vec());
    hive.entries.insert((journal.clone(), SIG_B.to_string()), b"current entry".to_vec());
    hive.entries.insert((journal.clone(), "00000000".to_string()), marker(SIG_A));
    hive.entries.insert((journal.clone(), "00000001".to_string()), marker(SIG_B));
    hive.entries.insert((SIG_C.to_string(), "00000000".to_string()), marker(SIG_A));

    let absent = resolve(&root, &hive, "GET", &format!("/{}/", pool("never:held")));
    assert_eq!(absent.status, 404);
    assert_eq!(body_of(&absent), b"pool not held");

    let genome = pool("computed:genome");
    for dir in [journal.as_str(), SIG_C, genome.as_str()] {
        for path in [format!("/{dir}/"), format!("/content/{dir}/")] {
            let reply = resolve(&root, &hive, "GET", &path);
            assert_eq!(reply.status, absent.status, "{path}");
            assert_eq!(reply.headers, absent.headers, "{path}");
            assert_eq!(body_of(&reply), body_of(&absent), "{path} — a refusal must not differ from a miss");
        }
    }
}

#[test]
fn a_floor_set_pool_lists_every_member() {
    let (_dir, root) = shell();
    let mut hive = Stub::default();
    let hosts = pool("community:hosts");
    hive.entries.insert((hosts.clone(), SIG_A.to_string()), b"a host".to_vec());
    hive.entries.insert((hosts.clone(), SIG_B.to_string()), b"another host".to_vec());

    let listing = resolve(&root, &hive, "GET", &format!("/{hosts}/"));
    assert_eq!(listing.status, 200);
    assert_eq!(body_of(&listing), format!("{SIG_B}\n{SIG_A}").into_bytes());
    for member in [SIG_A, SIG_B] {
        assert_eq!(resolve(&root, &hive, "GET", &format!("/{hosts}/{member}")).status, 200, "{member}");
    }
}

#[test]
fn a_floor_document_pool_lists_and_serves_only_its_current_version() {
    let (_dir, root) = shell();
    let mut hive = Stub::default();
    let offers = pool("community:offers");
    // Three versions; the max marker (00000002) names SIG_B.
    for (atom, bytes) in [(SIG_A, "v0"), (SIG_C, "v1"), (SIG_B, "v2")] {
        hive.entries.insert((offers.clone(), atom.to_string()), bytes.as_bytes().to_vec());
    }
    hive.entries.insert((offers.clone(), "00000000".to_string()), marker(SIG_A));
    hive.entries.insert((offers.clone(), "00000001".to_string()), marker(SIG_C));
    hive.entries.insert((offers.clone(), "00000002".to_string()), marker(SIG_B));

    for base in ["", "/content"] {
        let listing = resolve(&root, &hive, "GET", &format!("{base}/{offers}/"));
        assert_eq!(listing.status, 200, "{base}");
        assert_eq!(body_of(&listing), format!("00000002\n{SIG_B}").into_bytes(), "{base}");

        let head = resolve(&root, &hive, "GET", &format!("{base}/{offers}/00000002"));
        assert_eq!(head.status, 200, "{base}");
        assert_eq!(body_of(&head), marker(SIG_B));
        let current = resolve(&root, &hive, "GET", &format!("{base}/{offers}/{SIG_B}"));
        assert_eq!(body_of(&current), b"v2");

        // Every earlier marker and every earlier version: as if never held.
        for old in ["00000000", "00000001", SIG_A, SIG_C] {
            let reply = resolve(&root, &hive, "GET", &format!("{base}/{offers}/{old}"));
            assert_eq!(reply.status, 404, "{base} {old}");
            assert!(body_of(&reply).is_empty(), "{base} {old}");
        }
    }
}

#[test]
fn an_unlisted_bag_gives_up_its_head_marker_and_nothing_older() {
    let (_dir, root) = shell();
    let mut hive = Stub::default();
    for (index, layer) in [("00000000", SIG_A), ("00000001", SIG_C), ("00000002", SIG_B)] {
        hive.entries.insert((SIG_C.to_string(), index.to_string()), marker(layer));
    }

    for base in ["", "/content"] {
        let head = resolve(&root, &hive, "GET", &format!("{base}/{SIG_C}/00000002"));
        assert_eq!(head.status, 200, "{base}");
        assert_eq!(body_of(&head), marker(SIG_B), "{base}");
        for old in ["00000000", "00000001"] {
            let reply = resolve(&root, &hive, "GET", &format!("{base}/{SIG_C}/{old}"));
            assert_eq!(reply.status, 404, "{base} {old} — history never leaves");
            assert!(body_of(&reply).is_empty());
        }
    }
}

#[test]
fn a_member_of_an_unlisted_directory_is_never_served() {
    let (_dir, root) = shell();
    let mut hive = Stub::default();
    let journal = pool("journal:entries");
    hive.entries.insert((journal.clone(), SIG_A.to_string()), b"personal".to_vec());
    hive.entries.insert((journal.clone(), "a named member".to_string()), b"personal".to_vec());
    hive.entries.insert((journal.clone(), "00000000".to_string()), marker(SIG_A));

    for entry in [SIG_A, "a%20named%20member"] {
        for path in [format!("/{journal}/{entry}"), format!("/content/{journal}/{entry}")] {
            let reply = resolve(&root, &hive, "GET", &path);
            assert_eq!(reply.status, 404, "{path}");
            assert!(body_of(&reply).is_empty(), "{path}");
        }
    }
}

#[test]
fn content_by_signature_is_untouched_by_the_gate() {
    let (_dir, root) = shell();
    let mut hive = Stub::default();
    // The same address held as bytes AND as a directory: the bytes are content
    // (immutable, verified by the reader); the directory is not listed.
    hive.content.insert(SIG_C.to_string(), b"atom bytes".to_vec());
    hive.entries.insert((SIG_C.to_string(), "00000000".to_string()), marker(SIG_A));
    hive.entries.insert((SIG_C.to_string(), "00000001".to_string()), marker(SIG_B));

    for base in ["", "/content"] {
        let bytes = resolve(&root, &hive, "GET", &format!("{base}/{SIG_C}"));
        assert_eq!(bytes.status, 200, "{base}");
        assert_eq!(body_of(&bytes), b"atom bytes");
        assert_eq!(resolve(&root, &hive, "GET", &format!("{base}/{SIG_C}/")).status, 404, "{base}");
    }
}

/// The staged shell is the published build: a real file in a non-floor
/// directory still wins (a transfer pack, say), but the directory is never
/// listed.
#[test]
fn a_staged_file_is_served_but_its_directory_is_not_listed() {
    let (_dir, root) = shell();
    let packs = pool("transfer:packs");
    let staged = root.join("content").join(&packs);
    std::fs::create_dir_all(&staged).unwrap();
    std::fs::write(staged.join(SIG_A), SIG_B.as_bytes()).unwrap();
    let hive = Stub::default();

    let member = resolve(&root, &hive, "GET", &format!("/content/{packs}/{SIG_A}"));
    assert_eq!(member.status, 200);
    assert_eq!(body_of(&member), SIG_B.as_bytes());
    assert_eq!(resolve(&root, &hive, "GET", &format!("/content/{packs}/")).status, 404);
}

/// The same gate over the real store the desktop app and `hypercomb-serve`
/// read through.
#[test]
fn a_real_hive_lists_no_bag_and_serves_only_its_head() {
    let (_dir, root) = shell();
    let hive_dir = tempfile::tempdir().expect("a temp dir");
    let host = hypercomb_host::Host::open(hive_dir.path()).expect("a hive");
    let first = host.put(b"first revision").expect("put");
    let second = host.put(b"second revision").expect("put");
    let bag = hypercomb_protocol::sign_str("garden").to_hex();
    host.raw_dir_put(&bag, "00000000", &marker(&first)).expect("marker");
    host.raw_dir_put(&bag, "00000001", &marker(&second)).expect("marker");

    assert_eq!(resolve(&root, &host, "GET", &format!("/{bag}/")).status, 404);
    assert_eq!(resolve(&root, &host, "GET", &format!("/{bag}/00000000")).status, 404);
    let head = resolve(&root, &host, "GET", &format!("/{bag}/00000001"));
    assert_eq!(head.status, 200);
    let named: serde_json::Value = serde_json::from_slice(&body_of(&head)).unwrap();
    assert_eq!(named["layer"], second);
    // Every revision's bytes are content, and content is served by signature.
    assert_eq!(resolve(&root, &host, "GET", &format!("/{first}")).status, 200);
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
