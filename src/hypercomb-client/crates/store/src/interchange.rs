//! Restore and export — the portable interchange form.
//!
//! ```text
//! <root>/<sig>            content bytes — layers, resources (flat, sig-named)
//! <root>/<lineageSig>/    lineage sigbags (NNNNNNNN markers, max = head)
//! <root>/<sign(meaning)>/ pools of meaning
//! ```
//!
//! This is what makes an internal representation legal (see the crate docs), so
//! it is a v1 feature rather than a convenience. It is also the backup format,
//! and it is exactly what the web shell writes — so a hive exported here can be
//! read there and vice versa.
//!
//! # Restore is the drain, generalized
//!
//! The legacy `__x__` drain and a restore-from-folder are the same operation
//! with a different source directory:
//!
//! - **Content** — insert if absent. Signature-addressed, so this is dedup by
//!   construction and re-importing costs nothing.
//! - **Bags** — union the markers; the highest wins.
//! - **Pools** — union by member.
//!
//! Idempotent: a second run imports nothing. Overlapping hives merge rather
//! than collide. One code path serves restore, legacy drain, and backup ingest.
//!
//! # The untagged root
//!
//! A sig-named directory may be a lineage bag, a pool of meaning, **or both** —
//! for a bare-word meaning the two addresses are byte-identical, and 21 of 27
//! registered meanings are bare words.
//!
//! So this module does not try to classify directories. It classifies
//! *entries*: an 8-digit filename is a marker, anything else is a pool member.
//! A colliding directory therefore restores correctly as both, without needing
//! to know which it "is". That is strictly more robust than consulting the
//! registry, and it is why a `/flatten`-style bug cannot arise here.

use std::path::Path;

use hypercomb_protocol::{marker_filename, marker_index, BagAddr, Marker, PoolAddr, Sig};

use crate::{ContentStore, Result};

/// What a restore or export moved.
#[derive(Debug, Default, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Transfer {
    /// Content entries written (absent before).
    pub content: usize,
    /// Content entries already present and therefore skipped.
    pub content_skipped: usize,
    /// Markers written.
    pub markers: usize,
    /// Markers already present at that index and therefore skipped.
    pub markers_skipped: usize,
    /// Pool members written.
    pub pool_members: usize,
    /// Pool members already present with identical bytes, and therefore
    /// skipped.
    pub pool_members_skipped: usize,
}

impl Transfer {
    /// Did this transfer change anything? A second restore of the same source
    /// must report `false`.
    pub fn changed(&self) -> bool {
        self.content > 0 || self.markers > 0 || self.pool_members > 0
    }
}

/// Is this filename a signature-shaped name?
fn as_sig(name: &str) -> Option<Sig> {
    if name.len() == Sig::HEX_LEN && name.bytes().all(|b| b.is_ascii_hexdigit()) {
        name.parse().ok()
    } else {
        None
    }
}

/// Restore a hive from a directory in the interchange form.
///
/// Unrecognized files and directories are ignored rather than treated as
/// errors — a hive folder may reasonably contain a README, and refusing to
/// restore because of one would be worse than skipping it.
pub fn restore(store: &impl ContentStore, source: impl AsRef<Path>) -> Result<Transfer> {
    let source = source.as_ref();
    let mut moved = Transfer::default();

    let entries = match std::fs::read_dir(source) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(moved),
        Err(e) => return Err(e.into()),
    };

    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(sig) = as_sig(&name) else { continue };
        let path = entry.path();

        if path.is_file() {
            // Flat sig-named content.
            if store.has(sig)? {
                moved.content_skipped += 1;
            } else {
                let bytes = std::fs::read(&path)?;
                store.put(&bytes)?;
                moved.content += 1;
            }
            continue;
        }

        if !path.is_dir() {
            continue;
        }

        // A sig-named directory. Classify its ENTRIES, not the directory —
        // it may be a bag, a pool, or both.
        let bag = BagAddr::from_sig(sig);
        let pool = PoolAddr::from_sig(sig);

        for member in std::fs::read_dir(&path)? {
            let member = member?;
            if !member.path().is_file() {
                continue;
            }
            let member_name = member.file_name().to_string_lossy().to_string();
            let bytes = std::fs::read(member.path())?;

            match marker_index(&member_name) {
                Some(index) => {
                    // A marker. Preserve its index; do not renumber.
                    if store.put_marker_at(bag, index, &Marker::parse(&bytes))? {
                        moved.markers += 1;
                    } else {
                        moved.markers_skipped += 1;
                    }
                }
                None => {
                    // Union by member. A member already present with identical
                    // bytes is a no-op — writing it again would be harmless but
                    // would report a change, and "did this restore alter
                    // anything?" has to stay a truthful answer.
                    if store.pool_get(pool, &member_name)?.as_deref() == Some(bytes.as_slice()) {
                        moved.pool_members_skipped += 1;
                    } else {
                        store.pool_put(pool, &member_name, &bytes)?;
                        moved.pool_members += 1;
                    }
                }
            }
        }
    }

    Ok(moved)
}

/// Export ONE root's closure to a directory in the interchange form.
///
/// The drain model, as specified: take each layer out of the history, expand
/// every resource and component it references onto disk, one item at a time,
/// skip-if-exists. Scoped to a root rather than dumping the whole store, so a
/// backup can never carry unreachable junk — and a restore of it can never
/// import any.
///
/// The walk: for the root path and every descendant reached by name —
///   1. write the path's bag (every marker, indices preserved);
///   2. for every marker: write the layer bytes, then every signature the
///      layer references at any depth (resources, images, slot payloads);
///   3. read each child's layer to learn its NAME, and recurse into
///      `parent-path + name` — child bags are addressed by lineage, so names
///      are the only way from a parent to its children's history.
///
/// Pools are deliberately NOT exported here: clipboard, caches and device
/// state are local by design. Content another device needs travels inside
/// the closure; the full-store [`export`] remains for whole-hive backups.
pub fn export_root(
    store: &impl ContentStore,
    root_segments: &[String],
    target: impl AsRef<Path>,
) -> Result<Transfer> {
    let target = target.as_ref();
    std::fs::create_dir_all(target)?;
    let mut moved = Transfer::default();

    let mut content_done: std::collections::BTreeSet<Sig> = std::collections::BTreeSet::new();
    let mut queue: Vec<Vec<String>> = vec![root_segments.to_vec()];
    let mut visited_bags: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();

    while let Some(segments) = queue.pop() {
        let bag = hypercomb_protocol::bag_addr(&segments);
        if !visited_bags.insert(bag.to_hex()) {
            continue; // two names canonicalizing to one bag — already walked
        }

        let markers = store.markers(bag)?;
        if markers.is_empty() {
            continue;
        }

        let bag_dir = target.join(bag.to_hex());
        std::fs::create_dir_all(&bag_dir)?;

        for (index, marker) in &markers {
            if write_if_different(&bag_dir.join(marker_filename(*index)), &marker.to_bytes())? {
                moved.markers += 1;
            } else {
                moved.markers_skipped += 1;
            }

            // The layer, then its whole reference closure — resources at any
            // depth, marker side-fields included. One item at a time.
            let mut worklist: Vec<Sig> = vec![marker.layer().sig()];
            worklist.extend(hypercomb_protocol::sig::collect_signatures_in(&marker.to_bytes()));

            while let Some(sig) = worklist.pop() {
                if !content_done.insert(sig) {
                    continue;
                }
                let Some(bytes) = store.get(sig)? else { continue };
                worklist.extend(hypercomb_protocol::sig::collect_signatures_in(&bytes));

                let path = target.join(sig.to_hex());
                if path.exists() {
                    moved.content_skipped += 1;
                } else {
                    std::fs::write(&path, &bytes)?;
                    moved.content += 1;
                }
            }

            // Children's HISTORY lives in their own bags, addressed by name.
            if let Some(layer_bytes) = store.get(marker.layer().sig())? {
                if let Ok(layer) = hypercomb_protocol::Layer::from_json(&layer_bytes) {
                    for child_sig in layer.children() {
                        let Ok(parsed) = child_sig.parse::<Sig>() else { continue };
                        let Some(child_bytes) = store.get(parsed)? else { continue };
                        let Ok(child) = hypercomb_protocol::Layer::from_json(&child_bytes) else { continue };
                        if child.name.is_empty() {
                            continue;
                        }
                        let mut child_path = segments.clone();
                        child_path.push(child.name.clone());
                        queue.push(child_path);
                    }
                }
            }
        }
    }

    Ok(moved)
}

/// Export a hive to a directory in the interchange form.
///
/// The target is written into, not cleared — exporting into a directory that
/// already holds a hive unions the two, the same way restore does. Nothing is
/// ever deleted here.
pub fn export(store: &impl ContentStore, target: impl AsRef<Path>) -> Result<Transfer> {
    let target = target.as_ref();
    std::fs::create_dir_all(target)?;
    let mut moved = Transfer::default();

    for sig in store.signatures()? {
        let path = target.join(sig.to_hex());
        if path.exists() {
            moved.content_skipped += 1;
            continue;
        }
        if let Some(bytes) = store.get(sig)? {
            std::fs::write(&path, bytes)?;
            moved.content += 1;
        }
    }

    for bag in store.bags()? {
        let dir = target.join(bag.to_hex());
        std::fs::create_dir_all(&dir)?;
        for (index, marker) in store.markers(bag)? {
            if write_if_different(&dir.join(marker_filename(index)), &marker.to_bytes())? {
                moved.markers += 1;
            } else {
                moved.markers_skipped += 1;
            }
        }
    }

    for pool in store.pools()? {
        let dir = target.join(pool.to_hex());
        std::fs::create_dir_all(&dir)?;
        for member in store.pool_list(pool)? {
            if let Some(bytes) = store.pool_get(pool, &member)? {
                if write_if_different(&dir.join(&member), &bytes)? {
                    moved.pool_members += 1;
                } else {
                    moved.pool_members_skipped += 1;
                }
            }
        }
    }

    Ok(moved)
}

/// Write only when the target differs. Keeps [`Transfer::changed`] a truthful
/// answer, so exporting twice into the same folder reports no second change.
fn write_if_different(path: &Path, bytes: &[u8]) -> Result<bool> {
    if let Ok(existing) = std::fs::read(path) {
        if existing == bytes {
            return Ok(false);
        }
    }
    std::fs::write(path, bytes)?;
    Ok(true)
}
