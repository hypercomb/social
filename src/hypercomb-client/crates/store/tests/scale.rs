//! Scale check at the measured size of the existing tree.
//!
//! The design claim is that cold open performs **no scan** — it maps one file,
//! and every head is then a range query away. The TypeScript shell's equivalent
//! walk over this same shape was measured at **13.6 seconds** across 603 bags
//! and 8,006 markers, which is what forced the persisted head-index cache.
//!
//! This asserts the claim rather than believing it. The budget is deliberately
//! loose — it is a regression guard against accidentally reintroducing a scan,
//! not a benchmark.

use std::time::Instant;

use hypercomb_protocol::{bag_addr, Layer, Marker};
use hypercomb_store::{ContentStore, RedbStore};
use tempfile::TempDir;

/// Matches the measured shape of the live tree.
const BAGS: usize = 603;
const MARKERS: usize = 8_006;

#[test]
fn cold_open_and_head_lookup_at_real_scale() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("hive");

    // Build a hive of the measured shape.
    {
        let store = RedbStore::open(&path).unwrap();
        let per_bag = MARKERS / BAGS;
        for b in 0..BAGS {
            let bag = bag_addr(&[format!("place-{b}")]);
            for m in 0..per_bag {
                store
                    .append(bag, &Marker::pointer(Layer::empty(format!("{b}-{m}")).sig()))
                    .unwrap();
            }
        }
    }

    // Cold open: this must map one file, not enumerate anything.
    let opened = Instant::now();
    let store = RedbStore::open(&path).unwrap();
    let open_ms = opened.elapsed().as_secs_f64() * 1000.0;

    // Every head, resolved by range query.
    let heads = Instant::now();
    let mut found = 0;
    for b in 0..BAGS {
        if store.head(bag_addr(&[format!("place-{b}")])).unwrap().is_some() {
            found += 1;
        }
    }
    let heads_ms = heads.elapsed().as_secs_f64() * 1000.0;

    println!("cold open        {open_ms:.1} ms");
    println!("all {found} heads   {heads_ms:.1} ms");
    println!("total            {:.1} ms", open_ms + heads_ms);

    assert_eq!(found, BAGS);
    assert!(
        open_ms < 200.0,
        "cold open took {open_ms:.1} ms — a scan has crept back in"
    );
    assert!(
        open_ms + heads_ms < 1000.0,
        "open + all heads took {:.1} ms — well short of the 13.6 s this replaces, but a regression",
        open_ms + heads_ms
    );
}
