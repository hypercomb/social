//! # `hypercomb-store`
//!
//! Content-addressed storage for a hive.
//!
//! ## Why not one file per record
//!
//! Content addressing produces enormous numbers of tiny records. Measured on
//! the existing tree: **603 bags, 8,006 markers**, a marker being ~77 bytes.
//!
//! One file per record costs, per record, an open/close syscall pair, an MFT
//! record, a directory entry, and — on Windows — a trip through the on-access
//! antivirus filter. That last is frequently the dominant cost and is invisible
//! to an application profiler. It is a large part of why the existing cold scan
//! takes 13.6 seconds. The bytes are trivial; the *file operations* are not.
//!
//! Meanwhile the total volume is tiny: 8,006 markers ≈ 600 KB, and even 10,000
//! layers at ~1 KB is ~10 MB. **The entire navigable structure of a hive is a
//! few megabytes**, so it should simply be resident. Images are the only
//! genuinely large content, and they are exactly what should not be.
//!
//! ## The split
//!
//! | Content | Storage |
//! |---|---|
//! | Markers, layers, pool records, small resources | one memory-mapped B-tree ([`redb`]) |
//! | Blobs over [`BLOB_THRESHOLD`] | loose files, `blobs/<aa>/<sig>` |
//!
//! A memory-mapped file *is* memory — the kernel's page cache does the work.
//! No load step, no deserialization, no separate cache to invalidate, no
//! doubled RAM. "Keep everything in memory" is achieved by mapping, not by
//! writing a cache.
//!
//! ## Head lookup is a range query
//!
//! Markers are keyed `bag ++ big-endian index`, so *"the maximum marker is the
//! head"* is one B-tree range scan — O(log n), no directory enumeration.
//!
//! This **deletes** a workaround rather than optimizing one: the persisted
//! `localStorage` head index in the TypeScript shell exists purely to avoid a
//! multi-second bag enumeration. There is nothing to cache when the lookup was
//! never expensive. Do not port it.
//!
//! ## Internal representation is not the protocol
//!
//! `documentation/protocol/conformance.md` §7 defines a *portable interchange
//! form*, not an on-disk mandate. This crate stores however it likes and
//! round-trips that form losslessly — see [`interchange`].

#![forbid(unsafe_code)]
#![warn(missing_debug_implementations)]

pub mod interchange;
mod redb_store;

pub use redb_store::RedbStore;

use hypercomb_protocol::{BagAddr, Marker, PoolAddr, Sig};

/// Content at or above this size goes to a loose file rather than the B-tree.
///
/// A starting value, not a measured one — it should be tuned against a real
/// hive. Small enough that layers, markers and pool records always land in the
/// tree; large enough that images always land loose.
pub const BLOB_THRESHOLD: usize = 64 * 1024;

/// A member name within a pool of meaning.
///
/// Pools are the one place user-chosen names live *inside* a signature-named
/// directory, so this is a string rather than a signature.
pub type PoolKey = String;

/// Storage failures.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("database: {0}")]
    Database(String),
    /// Content was found in the index but its bytes are gone — a torn write or
    /// external deletion. Surfaced rather than silently treated as absent,
    /// because "we have it" and "we don't" are very different answers.
    #[error("content {0} is indexed but its blob is missing")]
    MissingBlob(Sig),
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// Content-addressed storage.
///
/// One trait, two implementations intended: the native [`RedbStore`] now, and
/// an OPFS-backed one if the web shell adopts the wasm protocol core. The
/// shell's `Store` is already an interface behind IoC, so that swap lands on a
/// seam that already exists.
///
/// Returns owned `Vec<u8>` rather than borrowed bytes. A zero-copy read would
/// have to borrow from the read transaction, which leaks the storage engine
/// into the signature and makes the OPFS implementation impossible. Hot paths
/// that genuinely need zero-copy can use [`RedbStore`] directly.
pub trait ContentStore {
    /// Store bytes, returning their signature.
    ///
    /// Idempotent by construction: identical content yields an identical
    /// signature and identical bytes, so re-putting is a no-op and there is
    /// never anything to merge.
    fn put(&self, bytes: &[u8]) -> Result<Sig>;

    /// Retrieve content by signature.
    fn get(&self, sig: Sig) -> Result<Option<Vec<u8>>>;

    /// Is this content present, without reading it?
    fn has(&self, sig: Sig) -> Result<bool>;

    /// The current head of a bag — its maximum marker — with that marker's
    /// index.
    fn head(&self, bag: BagAddr) -> Result<Option<(u32, Marker)>>;

    /// Append a marker, returning its index.
    ///
    /// Always writes a pointer record, including for a marker parsed from the
    /// legacy inline shape. Legacy markers are read, never written.
    fn append(&self, bag: BagAddr, marker: &Marker) -> Result<u32>;

    /// Every marker in a bag, in index order.
    fn markers(&self, bag: BagAddr) -> Result<Vec<(u32, Marker)>>;

    /// Write a marker at a specific index.
    ///
    /// For restore, which must preserve indices rather than renumber. Refuses
    /// to overwrite an occupied index — see [`ContentStore::append`] for the
    /// normal path.
    fn put_marker_at(&self, bag: BagAddr, index: u32, marker: &Marker) -> Result<bool>;

    /// Remove a marker from a bag.
    ///
    /// A **real** delete. History compaction (`/collapse-history`,
    /// `/consolidate-history`) genuinely removes revisions; that is a different
    /// operation from removing a tile, which appends a new layer with one less
    /// child and deletes nothing.
    ///
    /// Returns whether a marker was there to remove.
    fn remove_marker(&self, bag: BagAddr, index: u32) -> Result<bool>;

    /// Store a pool member.
    fn pool_put(&self, pool: PoolAddr, key: &str, bytes: &[u8]) -> Result<()>;

    /// Remove a pool member.
    ///
    /// A **real** delete. Pool members are not layers and are not in the
    /// history graph — a cleared clipboard entry is gone, and derived caches
    /// are wipe-safe by design.
    fn pool_remove(&self, pool: PoolAddr, key: &str) -> Result<bool>;

    /// Read a pool member.
    fn pool_get(&self, pool: PoolAddr, key: &str) -> Result<Option<Vec<u8>>>;

    /// Every member name in a pool.
    fn pool_list(&self, pool: PoolAddr) -> Result<Vec<PoolKey>>;

    /// Every bag that holds at least one marker.
    fn bags(&self) -> Result<Vec<BagAddr>>;

    /// Every pool that holds at least one member.
    fn pools(&self) -> Result<Vec<PoolAddr>>;

    /// Every content signature held.
    fn signatures(&self) -> Result<Vec<Sig>>;

    /// Permanently drop content.
    ///
    /// **Only the garbage collector may call this.** Content is immutable and
    /// shared by signature; removing a tile appends a new layer with one less
    /// child and deletes nothing. See [`gc`].
    fn sweep(&self, sig: Sig) -> Result<bool>;
}

/// What a collection reclaimed.
#[derive(Debug, Default, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Collected {
    /// Content reachable from some marker, and therefore kept.
    pub reachable: usize,
    /// Orphans swept.
    pub swept: usize,
    /// Bytes freed, as far as the store could measure.
    pub bytes: u64,
}

/// Reclaim orphaned content.
///
/// # What this does and does not touch
///
/// Reachability starts from **every marker in every bag** — not from the heads.
/// So every layer that any revision ever pointed at stays, and undo, time
/// travel, and old revisions are all fully preserved. The history graph is
/// complete by construction.
///
/// What it reclaims is content that **no committed layer ever referenced**:
/// bytes written to obtain a signature and then abandoned. Paste an image, hit
/// escape — those bytes are in the store, reachable from nothing. They are not
/// history, they are litter from an abandoned gesture, and they are typically
/// the large ones.
///
/// # Safety posture
///
/// The scan over-approximates: any 64-hex string found anywhere in any layer,
/// at any depth, in a key or a value, counts as a reference. A false *keep*
/// wastes disk. A false *sweep* destroys a user's data. Only one of those is
/// recoverable, so the bias is deliberate and should stay.
///
/// Never call this on a write path. It is a manual or idle-time operation.
pub fn gc(store: &impl ContentStore) -> Result<Collected> {
    use std::collections::BTreeSet;

    // Roots: everything every marker points at, plus any signature carried in a
    // marker's extra fields (decorations, receipts, future kinds).
    let mut worklist: Vec<Sig> = Vec::new();
    for bag in store.bags()? {
        for (_, marker) in store.markers(bag)? {
            worklist.push(marker.layer().sig());
            worklist.extend(
                hypercomb_protocol::sig::collect_signatures_in(&marker.to_bytes()),
            );
        }
    }

    // Pool members are not layers, but they may REFERENCE content — a clipboard
    // entry naming a copied image, for one. Their referents must survive.
    for pool in store.pools()? {
        for member in store.pool_list(pool)? {
            if let Some(bytes) = store.pool_get(pool, &member)? {
                worklist.extend(
                    hypercomb_protocol::sig::collect_signatures_in(&bytes),
                );
            }
        }
    }

    // Transitive closure. A layer's children are layers; those layers reference
    // more content; and so on to the leaves.
    let mut reachable: BTreeSet<Sig> = BTreeSet::new();
    while let Some(sig) = worklist.pop() {
        if !reachable.insert(sig) {
            continue;
        }
        if let Some(bytes) = store.get(sig)? {
            worklist.extend(hypercomb_protocol::sig::collect_signatures_in(&bytes));
        }
    }

    let mut collected = Collected {
        reachable: reachable.len(),
        ..Default::default()
    };

    for sig in store.signatures()? {
        if reachable.contains(&sig) {
            continue;
        }
        let size = store.get(sig)?.map(|b| b.len() as u64).unwrap_or(0);
        if store.sweep(sig)? {
            collected.swept += 1;
            collected.bytes += size;
        }
    }

    Ok(collected)
}
