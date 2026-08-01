//! Durability probe: commit a layer, then die WITHOUT any shutdown path.
//!
//! `abort-probe <hive dir>` opens the store, writes layer bytes + a marker at
//! the location `durability`, prints the layer sig on one line, and calls
//! [`std::process::abort`] — no destructors, no flush-on-exit, nothing. The
//! `kill_durability` test then reopens the hive in ITS process and asserts the
//! commit is fully there.
//!
//! This exists because "the store is durable" was proven by hand once (commit
//! from the live app → taskkill → reopen) after a user reported losing data.
//! A property that important is guarded by CI, not by one afternoon's proof.

use hypercomb_protocol::{bag_addr, Layer, Marker};
use hypercomb_store::{ContentStore, RedbStore};

fn main() {
    let dir = std::env::args().nth(1).expect("usage: abort-probe <hive dir>");
    let store = RedbStore::open(&dir).expect("open hive");

    let layer = Layer::empty("durability");
    let sig = store
        .put(layer.canonical_json().as_bytes())
        .expect("write layer bytes");
    store
        .append(
            bag_addr(&["durability"]),
            &Marker::pointer(hypercomb_protocol::LayerSig::from_sig(sig)),
        )
        .expect("append marker");

    // Hand the expected sig to the test, then die as rudely as possible.
    println!("{}", sig.to_hex());
    std::process::abort();
}
