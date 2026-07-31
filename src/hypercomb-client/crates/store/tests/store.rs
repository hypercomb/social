//! Store behaviour, and the round-trip that is this crate's definition of done.

use hypercomb_protocol::{bag_addr, Layer, Marker, PoolAddr, PoolRegistry};
use hypercomb_store::{
    interchange::{export, restore},
    ContentStore, RedbStore, BLOB_THRESHOLD,
};
use tempfile::TempDir;

fn store() -> (TempDir, RedbStore) {
    let dir = TempDir::new().unwrap();
    let store = RedbStore::open(dir.path().join("hive")).unwrap();
    (dir, store)
}

// ---------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------

#[test]
fn put_is_idempotent_and_content_addressed() {
    let (_dir, store) = store();

    let a = store.put(b"hello").unwrap();
    let b = store.put(b"hello").unwrap();
    assert_eq!(a, b, "identical content must yield an identical signature");
    assert_eq!(store.get(a).unwrap().as_deref(), Some(&b"hello"[..]));
    assert_eq!(store.signatures().unwrap().len(), 1, "stored once, not twice");
}

#[test]
fn absent_content_reads_as_none() {
    let (_dir, store) = store();
    let sig = hypercomb_protocol::sign(b"never stored");
    assert_eq!(store.get(sig).unwrap(), None);
    assert!(!store.has(sig).unwrap());
}

#[test]
fn large_content_goes_loose_and_still_round_trips() {
    let (_dir, store) = store();

    let big = vec![7u8; BLOB_THRESHOLD * 2];
    let sig = store.put(&big).unwrap();

    assert!(store.has(sig).unwrap());
    assert_eq!(store.get(sig).unwrap().unwrap().len(), big.len());
    assert_eq!(store.get(sig).unwrap().unwrap(), big);
}

#[test]
fn the_threshold_boundary_is_handled_both_sides() {
    let (_dir, store) = store();

    let under = vec![1u8; BLOB_THRESHOLD - 1];
    let over = vec![2u8; BLOB_THRESHOLD];

    let a = store.put(&under).unwrap();
    let b = store.put(&over).unwrap();

    // Where they live is an implementation detail; that they read back is not.
    assert_eq!(store.get(a).unwrap().unwrap(), under);
    assert_eq!(store.get(b).unwrap().unwrap(), over);
}

// ---------------------------------------------------------------------------
// bags and markers
// ---------------------------------------------------------------------------

#[test]
fn head_is_the_maximum_marker() {
    let (_dir, store) = store();
    let bag = bag_addr(&["place"]);

    assert_eq!(store.head(bag).unwrap(), None, "an untouched bag has no head");

    for name in ["first", "second", "third"] {
        store.append(bag, &Marker::pointer(Layer::empty(name).sig())).unwrap();
    }

    let (index, head) = store.head(bag).unwrap().unwrap();
    assert_eq!(index, 2);
    assert_eq!(head.layer(), Layer::empty("third").sig());
}

#[test]
fn append_returns_sequential_indices_from_zero() {
    let (_dir, store) = store();
    let bag = bag_addr(&["place"]);
    for expected in 0..5u32 {
        let index = store.append(bag, &Marker::pointer(Layer::empty("x").sig())).unwrap();
        assert_eq!(index, expected);
    }
}

#[test]
fn head_survives_past_the_single_byte_boundary() {
    // Big-endian keying is what makes lexicographic order match numeric order.
    // A naive encoding breaks exactly here, at 255 -> 256.
    let (_dir, store) = store();
    let bag = bag_addr(&["place"]);

    for n in 0..300u32 {
        store
            .put_marker_at(bag, n, &Marker::pointer(Layer::empty(n.to_string()).sig()))
            .unwrap();
    }

    let (index, head) = store.head(bag).unwrap().unwrap();
    assert_eq!(index, 299);
    assert_eq!(head.layer(), Layer::empty("299").sig());
}

#[test]
fn bags_do_not_bleed_into_each_other() {
    let (_dir, store) = store();
    let a = bag_addr(&["a"]);
    let b = bag_addr(&["b"]);

    store.append(a, &Marker::pointer(Layer::empty("in-a").sig())).unwrap();
    store.append(b, &Marker::pointer(Layer::empty("in-b").sig())).unwrap();

    assert_eq!(store.markers(a).unwrap().len(), 1);
    assert_eq!(store.head(a).unwrap().unwrap().1.layer(), Layer::empty("in-a").sig());
    assert_eq!(store.head(b).unwrap().unwrap().1.layer(), Layer::empty("in-b").sig());
    assert_eq!(store.bags().unwrap().len(), 2);
}

#[test]
fn put_marker_at_refuses_to_overwrite() {
    let (_dir, store) = store();
    let bag = bag_addr(&["place"]);

    assert!(store.put_marker_at(bag, 3, &Marker::pointer(Layer::empty("a").sig())).unwrap());
    assert!(!store.put_marker_at(bag, 3, &Marker::pointer(Layer::empty("b").sig())).unwrap());

    assert_eq!(store.head(bag).unwrap().unwrap().1.layer(), Layer::empty("a").sig());
}

#[test]
fn a_legacy_marker_is_stored_as_a_pointer() {
    let (_dir, store) = store();
    let bag = bag_addr(&["place"]);

    let layer = Layer::empty("legacy");
    let legacy = Marker::parse(layer.canonical_json().as_bytes());
    assert!(legacy.is_legacy());

    store.append(bag, &legacy).unwrap();

    let (_, stored) = store.head(bag).unwrap().unwrap();
    assert!(!stored.is_legacy(), "read legacy, write pointer");
    assert_eq!(stored.layer(), layer.sig());
}

// ---------------------------------------------------------------------------
// pools
// ---------------------------------------------------------------------------

#[test]
fn pool_members_round_trip_and_list() {
    let (_dir, store) = store();
    let mut registry = PoolRegistry::new();
    let pool = registry.address("clipboard");

    store.pool_put(pool, "alpha", b"one").unwrap();
    store.pool_put(pool, "beta", b"two").unwrap();

    assert_eq!(store.pool_get(pool, "alpha").unwrap().as_deref(), Some(&b"one"[..]));
    let mut members = store.pool_list(pool).unwrap();
    members.sort();
    assert_eq!(members, vec!["alpha", "beta"]);
}

#[test]
fn pools_do_not_bleed_into_each_other() {
    let (_dir, store) = store();
    let mut registry = PoolRegistry::new();
    let a = registry.address("clipboard");
    let b = registry.address("threads");

    store.pool_put(a, "shared-name", b"from-a").unwrap();
    store.pool_put(b, "shared-name", b"from-b").unwrap();

    assert_eq!(store.pool_get(a, "shared-name").unwrap().as_deref(), Some(&b"from-a"[..]));
    assert_eq!(store.pool_get(b, "shared-name").unwrap().as_deref(), Some(&b"from-b"[..]));
    assert_eq!(store.pool_list(a).unwrap(), vec!["shared-name"]);
}

#[test]
fn a_bare_word_pool_and_its_colliding_bag_coexist() {
    // `bees` the pool and a root tile named "bees" are ONE address. Both must
    // survive in the same store — this is the collision the registry warns
    // about, exercised rather than avoided.
    let (_dir, store) = store();
    let mut registry = PoolRegistry::new();

    let pool = registry.address("bees");
    let bag = bag_addr(&["bees"]);
    assert_eq!(pool.sig(), bag.sig(), "precondition: these collide");

    store.pool_put(pool, "member", b"pool content").unwrap();
    store.append(bag, &Marker::pointer(Layer::empty("bees").sig())).unwrap();

    assert_eq!(store.pool_get(pool, "member").unwrap().as_deref(), Some(&b"pool content"[..]));
    assert_eq!(store.head(bag).unwrap().unwrap().1.layer(), Layer::empty("bees").sig());
}

// ---------------------------------------------------------------------------
// interchange — the definition of done
// ---------------------------------------------------------------------------

/// Build a hive exercising every kind of content the interchange form carries.
fn populate(store: &RedbStore) {
    let mut registry = PoolRegistry::new();

    let mut root = Layer::empty("/");
    let child = Layer::empty("child");
    let child_sig = store.put(child.canonical_json().as_bytes()).unwrap();
    root.set("children", serde_json::json!([child_sig.to_hex()]));

    let root_sig = store.put(root.canonical_json().as_bytes()).unwrap();
    store
        .append(bag_addr::<&str>(&[]), &Marker::pointer(hypercomb_protocol::LayerSig::from_sig(root_sig)))
        .unwrap();
    store
        .append(bag_addr(&["child"]), &Marker::pointer(child.sig()))
        .unwrap();

    // A pool member, a colliding bare-word pool, and a large blob.
    store.pool_put(registry.address("clipboard"), "entry", b"clip").unwrap();
    store.pool_put(registry.address("bees"), "drone", b"bee bytes").unwrap();
    store.put(&vec![9u8; BLOB_THRESHOLD * 2]).unwrap();
}

#[test]
fn export_then_restore_reproduces_the_hive() {
    let (_dir_a, source) = store();
    populate(&source);

    let folder = TempDir::new().unwrap();
    let exported = export(&source, folder.path()).unwrap();
    assert!(exported.changed());

    let (_dir_b, restored) = store();
    let moved = restore(&restored, folder.path()).unwrap();
    assert!(moved.changed());

    // Content
    let mut before = source.signatures().unwrap();
    let mut after = restored.signatures().unwrap();
    before.sort();
    after.sort();
    assert_eq!(before, after, "every signature survives the round trip");

    // Bags, markers and indices
    assert_eq!(source.bags().unwrap(), restored.bags().unwrap());
    for bag in source.bags().unwrap() {
        assert_eq!(
            source.markers(bag).unwrap(),
            restored.markers(bag).unwrap(),
            "markers and their INDICES must survive"
        );
    }

    // Pools
    assert_eq!(source.pools().unwrap(), restored.pools().unwrap());
    for pool in source.pools().unwrap() {
        let mut a = source.pool_list(pool).unwrap();
        let mut b = restored.pool_list(pool).unwrap();
        a.sort();
        b.sort();
        assert_eq!(a, b);
        for member in a {
            assert_eq!(source.pool_get(pool, &member).unwrap(), restored.pool_get(pool, &member).unwrap());
        }
    }
}

#[test]
fn restore_is_idempotent() {
    let (_dir_a, source) = store();
    populate(&source);
    let folder = TempDir::new().unwrap();
    export(&source, folder.path()).unwrap();

    let (_dir_b, target) = store();
    let first = restore(&target, folder.path()).unwrap();
    let second = restore(&target, folder.path()).unwrap();

    assert!(first.changed());
    assert!(!second.changed(), "a second restore must import nothing");
    assert_eq!(second.content, 0);
    assert_eq!(second.markers, 0);
    assert_eq!(second.pool_members, 0);
    assert_eq!(second.content_skipped, first.content);
    assert_eq!(second.markers_skipped, first.markers);
    assert_eq!(second.pool_members_skipped, first.pool_members);
}

#[test]
fn export_is_idempotent() {
    let (_dir, source) = store();
    populate(&source);

    let folder = TempDir::new().unwrap();
    let first = export(&source, folder.path()).unwrap();
    let second = export(&source, folder.path()).unwrap();

    assert!(first.changed());
    assert!(!second.changed(), "a second export must rewrite nothing");
}

#[test]
fn restoring_two_overlapping_hives_merges_rather_than_collides() {
    let (_dir_a, a) = store();
    let (_dir_b, b) = store();

    // Shared content, plus a marker each at DIFFERENT indices in one bag.
    let bag = bag_addr(&["shared"]);
    for store in [&a, &b] {
        store.put(b"common bytes").unwrap();
    }
    a.put_marker_at(bag, 0, &Marker::pointer(Layer::empty("from-a").sig())).unwrap();
    b.put_marker_at(bag, 1, &Marker::pointer(Layer::empty("from-b").sig())).unwrap();

    let folder_a = TempDir::new().unwrap();
    let folder_b = TempDir::new().unwrap();
    export(&a, folder_a.path()).unwrap();
    export(&b, folder_b.path()).unwrap();

    let (_dir_c, merged) = store();
    restore(&merged, folder_a.path()).unwrap();
    restore(&merged, folder_b.path()).unwrap();

    // Shared content deduped to one entry.
    assert_eq!(merged.signatures().unwrap().len(), 1);
    // Both markers present; the highest wins as head.
    assert_eq!(merged.markers(bag).unwrap().len(), 2);
    assert_eq!(merged.head(bag).unwrap().unwrap().1.layer(), Layer::empty("from-b").sig());
}

#[test]
fn restore_ignores_files_that_are_not_hive_content() {
    let (_dir, store) = store();
    let folder = TempDir::new().unwrap();

    std::fs::write(folder.path().join("README.md"), b"not hive content").unwrap();
    std::fs::create_dir(folder.path().join("some-folder")).unwrap();

    // A hive folder may reasonably contain other things; refusing to restore
    // because of a README would be worse than skipping it.
    let moved = restore(&store, folder.path()).unwrap();
    assert!(!moved.changed());
}

#[test]
fn restore_from_a_missing_directory_is_not_an_error() {
    let (_dir, store) = store();
    let moved = restore(&store, "definitely/not/here").unwrap();
    assert!(!moved.changed());
}

#[test]
fn a_reopened_store_sees_everything() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("hive");

    let sig = {
        let store = RedbStore::open(&path).unwrap();
        populate(&store);
        store.put(b"durable").unwrap()
    };

    let reopened = RedbStore::open(&path).unwrap();
    assert_eq!(reopened.get(sig).unwrap().as_deref(), Some(&b"durable"[..]));
    assert!(!reopened.bags().unwrap().is_empty());
    assert!(!reopened.pools().unwrap().is_empty());
}

#[test]
fn exported_marker_filenames_match_the_interchange_form() {
    let (_dir, store) = store();
    let bag = bag_addr(&["place"]);
    store.append(bag, &Marker::pointer(Layer::empty("x").sig())).unwrap();

    let folder = TempDir::new().unwrap();
    export(&store, folder.path()).unwrap();

    let marker = folder.path().join(bag.to_hex()).join("00000000");
    assert!(marker.is_file(), "markers are 8-digit zero-padded filenames");

    // And the bytes are a pointer record the web shell can read.
    let bytes = std::fs::read(marker).unwrap();
    assert!(!Marker::parse(&bytes).is_legacy());
}

#[test]
fn a_pool_address_is_not_treated_as_a_bag_on_restore() {
    // The interchange reader classifies ENTRIES, not directories: an 8-digit
    // name is a marker, anything else is a pool member. So a colliding
    // directory restores correctly as both without needing to guess.
    let (_dir_a, source) = store();
    let mut registry = PoolRegistry::new();
    let pool: PoolAddr = registry.address("bees");
    let bag = bag_addr(&["bees"]);

    source.pool_put(pool, "member", b"pool bytes").unwrap();
    source.append(bag, &Marker::pointer(Layer::empty("bees").sig())).unwrap();

    let folder = TempDir::new().unwrap();
    export(&source, folder.path()).unwrap();

    let (_dir_b, target) = store();
    restore(&target, folder.path()).unwrap();

    assert_eq!(target.pool_get(pool, "member").unwrap().as_deref(), Some(&b"pool bytes"[..]));
    assert_eq!(target.markers(bag).unwrap().len(), 1);
}
