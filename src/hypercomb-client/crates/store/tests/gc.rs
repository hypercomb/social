//! Garbage collection.
//!
//! The governing rule, from the model: **every layer is atomic and complete.**
//! Removing a tile appends a new layer with one less child; the old layer still
//! exists and is still pointed at by its own marker. Nothing is deleted.
//!
//! So collection reclaims exactly one thing — content that no committed layer
//! ever referenced. These tests exist to prove it cannot reach anything else,
//! because the failure mode is destroying a user's history.

use hypercomb_protocol::{bag_addr, Layer, LayerSig, Marker, PoolRegistry};
use hypercomb_store::{gc, ContentStore, RedbStore, BLOB_THRESHOLD};
use serde_json::json;
use tempfile::TempDir;

fn store() -> (TempDir, RedbStore) {
    let dir = TempDir::new().unwrap();
    let store = RedbStore::open(dir.path().join("hive")).unwrap();
    (dir, store)
}

/// Commit a layer at a location and return its signature.
fn commit(store: &RedbStore, segments: &[&str], layer: &Layer) -> LayerSig {
    let sig = store.put(layer.canonical_json().as_bytes()).unwrap();
    let layer_sig = LayerSig::from_sig(sig);
    let owned: Vec<String> = segments.iter().map(|s| s.to_string()).collect();
    store
        .append(bag_addr(&owned), &Marker::pointer(layer_sig))
        .unwrap();
    layer_sig
}

#[test]
fn an_abandoned_paste_is_reclaimed() {
    let (_dir, store) = store();

    // A committed layer, and a large image written but never committed —
    // exactly the "paste then escape" case.
    commit(&store, &["place"], &Layer::empty("place"));
    let orphan = store.put(&vec![3u8; BLOB_THRESHOLD * 2]).unwrap();

    let collected = gc(&store).unwrap();

    assert_eq!(collected.swept, 1);
    assert!(collected.bytes >= (BLOB_THRESHOLD * 2) as u64);
    assert_eq!(store.get(orphan).unwrap(), None, "the orphan is gone");
}

#[test]
fn removing_a_tile_keeps_the_old_layer_forever() {
    // THE case. Remove a child, commit a layer with one less. The previous
    // layer and the removed child must both survive collection — they are
    // history, reachable from their markers.
    let (_dir, store) = store();

    let child = Layer::empty("child");
    let child_sig = store.put(child.canonical_json().as_bytes()).unwrap();

    let mut before = Layer::empty("parent");
    before.set("children", json!([child_sig.to_hex()]));
    let before_sig = commit(&store, &["parent"], &before);

    // "Remove the tile": a new layer with one less child.
    let after = Layer::empty("parent");
    let after_sig = commit(&store, &["parent"], &after);
    assert_ne!(before_sig, after_sig);

    let collected = gc(&store).unwrap();

    assert_eq!(collected.swept, 0, "history must never be collected");
    assert!(store.has(child_sig).unwrap(), "the removed child's layer survives");
    assert!(store.has(before_sig.sig()).unwrap(), "the previous parent layer survives");
    assert!(store.has(after_sig.sig()).unwrap());
}

#[test]
fn collection_starts_from_every_marker_not_just_the_head() {
    // Undo and time travel depend on non-head revisions staying alive.
    let (_dir, store) = store();

    let first = commit(&store, &["place"], &Layer::empty("first"));
    let second = commit(&store, &["place"], &Layer::empty("second"));

    let head = store.head(bag_addr(&["place"])).unwrap().unwrap();
    assert_eq!(head.1.layer(), second, "precondition: second is the head");

    gc(&store).unwrap();

    assert!(store.has(first.sig()).unwrap(), "a superseded revision is still history");
    assert!(store.has(second.sig()).unwrap());
}

#[test]
fn nested_and_deeply_referenced_content_survives() {
    let (_dir, store) = store();

    let image = store.put(&vec![9u8; BLOB_THRESHOLD * 2]).unwrap();
    let grandchild = store.put(Layer::empty("grandchild").canonical_json().as_bytes()).unwrap();

    let mut child = Layer::empty("child");
    child.set("children", json!([grandchild.to_hex()]));
    // A signature buried in an arbitrary slot at depth, not in `children`.
    child.set("visual", json!({ "cover": { "image": image.to_hex() } }));
    let child_sig = store.put(child.canonical_json().as_bytes()).unwrap();

    let mut parent = Layer::empty("parent");
    parent.set("children", json!([child_sig.to_hex()]));
    commit(&store, &["parent"], &parent);

    let collected = gc(&store).unwrap();

    assert_eq!(collected.swept, 0);
    for sig in [image, grandchild, child_sig] {
        assert!(store.has(sig).unwrap(), "reachable content was swept");
    }
}

#[test]
fn content_referenced_only_by_a_pool_member_survives() {
    // A clipboard entry naming a copied image is not a layer, but its referent
    // must not be collected out from under it.
    let (_dir, store) = store();
    let mut registry = PoolRegistry::new();

    let image = store.put(&[5u8; 128]).unwrap();
    let entry = json!({ "image": image.to_hex() });
    store
        .pool_put(registry.address("clipboard"), "entry", entry.to_string().as_bytes())
        .unwrap();

    gc(&store).unwrap();

    assert!(store.has(image).unwrap(), "a clipboard referent was collected");
}

#[test]
fn a_signature_in_a_marker_field_keeps_its_content() {
    // Markers may carry extra sig fields — decorations, receipts, future kinds.
    let (_dir, store) = store();

    let decoration = store.put(br#"{"kind":"decoration"}"#).unwrap();
    let layer = store.put(Layer::empty("place").canonical_json().as_bytes()).unwrap();

    let mut fields = serde_json::Map::new();
    fields.insert("decorations".into(), json!(decoration.to_hex()));
    store
        .append(
            bag_addr(&["place"]),
            &Marker::Pointer { layer: LayerSig::from_sig(layer), fields },
        )
        .unwrap();

    gc(&store).unwrap();

    assert!(store.has(decoration).unwrap(), "a marker field referent was collected");
}

#[test]
fn collection_is_idempotent() {
    let (_dir, store) = store();
    commit(&store, &["place"], &Layer::empty("place"));
    store.put(b"orphan").unwrap();

    let first = gc(&store).unwrap();
    let second = gc(&store).unwrap();

    assert_eq!(first.swept, 1);
    assert_eq!(second.swept, 0, "a second pass has nothing left to reclaim");
    assert_eq!(first.reachable, second.reachable);
}

#[test]
fn an_empty_hive_collects_nothing_and_does_not_error() {
    let (_dir, store) = store();
    assert_eq!(gc(&store).unwrap().swept, 0);
}

#[test]
fn a_swept_blob_leaves_no_file_behind() {
    let (_dir, store) = store();
    let orphan = store.put(&vec![1u8; BLOB_THRESHOLD * 2]).unwrap();
    gc(&store).unwrap();

    // Reading must report absence, not a dangling index entry.
    assert_eq!(store.get(orphan).unwrap(), None);
    assert!(!store.has(orphan).unwrap());
}

// ---------------------------------------------------------------------------
// real deletes — markers and pool members are NOT layers
// ---------------------------------------------------------------------------

#[test]
fn history_compaction_really_removes_a_marker() {
    let (_dir, store) = store();
    let bag = bag_addr(&["place"]);

    commit(&store, &["place"], &Layer::empty("a"));
    commit(&store, &["place"], &Layer::empty("b"));
    assert_eq!(store.markers(bag).unwrap().len(), 2);

    assert!(store.remove_marker(bag, 0).unwrap());
    assert!(!store.remove_marker(bag, 0).unwrap(), "already gone");

    assert_eq!(store.markers(bag).unwrap().len(), 1);
    assert_eq!(store.head(bag).unwrap().unwrap().0, 1, "the head is unchanged");
}

#[test]
fn a_compacted_revisions_layer_becomes_collectable() {
    // Consequence of the two rules together: once a revision is genuinely
    // removed by compaction, the layer it pointed at is no longer history and
    // becomes an orphan. That is correct — but it means compaction is the one
    // operation that can lead to content loss, so it should be deliberate.
    let (_dir, store) = store();
    let bag = bag_addr(&["place"]);

    let doomed = commit(&store, &["place"], &Layer::empty("a"));
    commit(&store, &["place"], &Layer::empty("b"));

    assert_eq!(gc(&store).unwrap().swept, 0, "both revisions are still history");

    store.remove_marker(bag, 0).unwrap();
    assert_eq!(gc(&store).unwrap().swept, 1);
    assert!(!store.has(doomed.sig()).unwrap());
}

#[test]
fn pool_members_really_delete() {
    let (_dir, store) = store();
    let mut registry = PoolRegistry::new();
    let pool = registry.address("clipboard");

    store.pool_put(pool, "entry", b"clip").unwrap();
    assert!(store.pool_remove(pool, "entry").unwrap());
    assert!(!store.pool_remove(pool, "entry").unwrap(), "already gone");

    assert_eq!(store.pool_get(pool, "entry").unwrap(), None);
    assert!(store.pool_list(pool).unwrap().is_empty());
}
