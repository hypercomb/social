//! Kill-durability: a commit survives a process that dies with no shutdown.
//!
//! The probe process writes layer bytes + a marker and calls
//! `std::process::abort()` — no destructors, no flush. This process then
//! reopens the hive cold and asserts everything is there. If this test ever
//! fails, nothing else about the client matters until it passes again.

use hypercomb_protocol::{bag_addr, Layer};
use hypercomb_store::{ContentStore, RedbStore};
use tempfile::TempDir;

#[test]
fn a_commit_survives_process_abort() {
    let dir = TempDir::new().unwrap();
    let hive = dir.path().join("hive");

    let output = std::process::Command::new(env!("CARGO_BIN_EXE_abort-probe"))
        .arg(&hive)
        .output()
        .expect("run abort-probe");

    // The probe DIES on purpose — succeeding would mean it didn't abort.
    assert!(!output.status.success(), "probe must abort, not exit cleanly");
    let expected_sig = String::from_utf8_lossy(&output.stdout).trim().to_string();
    assert_eq!(expected_sig.len(), 64, "probe printed the layer sig before dying");

    // Cold reopen in THIS process: the commit must be fully present.
    let store = RedbStore::open(&hive).unwrap();
    let (index, marker) = store
        .head(bag_addr(&["durability"]))
        .unwrap()
        .expect("the aborted process's marker survived");
    assert_eq!(index, 0);
    assert_eq!(marker.layer().to_hex(), expected_sig);

    let bytes = store
        .get(marker.layer().sig())
        .unwrap()
        .expect("the layer bytes survived");
    assert_eq!(
        String::from_utf8_lossy(&bytes),
        Layer::empty("durability").canonical_json(),
        "bytes are exact, not just present"
    );
}
