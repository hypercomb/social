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
    /// Content files whose bytes did NOT hash to their own filename, and were
    /// therefore refused rather than imported. See [`restore`] for why this
    /// count exists at all.
    #[serde(default)]
    pub content_corrupt: usize,
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
///
/// # Picking the wrong folder is not a failure
///
/// The interchange form is a folder FULL of hex names, so it is routinely kept
/// one level down (`Backups\hypercomb`) and the picker lands on the parent.
/// A source with no interchange entries of its own, holding exactly one
/// subdirectory that has them, restores from that subdirectory. One level, and
/// only when there is no ambiguity about which folder was meant — two
/// candidates restore nothing rather than guess.
pub fn restore(store: &impl ContentStore, source: impl AsRef<Path>) -> Result<Transfer> {
    let source = source.as_ref();
    if !holds_interchange_entries(source) {
        if let Some(nested) = sole_interchange_child(source) {
            return restore_dir(store, &nested);
        }
    }
    restore_dir(store, source)
}

/// Does this directory hold anything the interchange form recognizes?
fn holds_interchange_entries(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else { return false };
    entries
        .flatten()
        .any(|e| as_sig(&e.file_name().to_string_lossy()).is_some())
}

/// The one immediate subdirectory that looks like a hive, if there is exactly
/// one. Two candidates is an ambiguity, and guessing at a restore source is
/// the kind of helpfulness that restores the wrong hive.
fn sole_interchange_child(dir: &Path) -> Option<std::path::PathBuf> {
    let mut found: Option<std::path::PathBuf> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if !path.is_dir() || !holds_interchange_entries(&path) {
            continue;
        }
        if found.is_some() {
            return None;
        }
        found = Some(path);
    }
    found
}

fn restore_dir(store: &impl ContentStore, source: &Path) -> Result<Transfer> {
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
                continue;
            }
            let bytes = std::fs::read(&path)?;
            // The FILENAME is a claim about the bytes; this is the only place
            // that ever checks it. `put` re-signs what it is handed, so a
            // truncated or half-written file would land under a DIFFERENT
            // signature: the content the hive actually asks for stays missing,
            // the restore counts it as imported, and the damage surfaces later
            // as a tile with no picture and no explanation. Refuse it here and
            // say so.
            if hypercomb_protocol::sign(&bytes) != sig {
                moved.content_corrupt += 1;
                continue;
            }
            store.put(&bytes)?;
            moved.content += 1;
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
            // A partial write this export never finished. It is not a member
            // and it is not a marker — importing one would mint a pool member
            // named after our own temp suffix.
            if member_name.ends_with(PART_SUFFIX) {
                continue;
            }
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
            if write_marker_union(&bag_dir.join(marker_filename(*index)), &marker.to_bytes())? {
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
                    write_atomic(&path, &bytes)?;
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
            write_atomic(&path, &bytes)?;
            moved.content += 1;
        }
    }

    for bag in store.bags()? {
        let dir = target.join(bag.to_hex());
        std::fs::create_dir_all(&dir)?;
        for (index, marker) in store.markers(bag)? {
            if write_marker_union(&dir.join(marker_filename(index)), &marker.to_bytes())? {
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

/// What a verification found in a backup folder.
///
/// Every field is a count of items **this hive holds**, measured against what
/// the folder actually contains. It is deliberately not a boolean: "3 markers
/// differ" after backing two hives into one folder is expected and harmless,
/// while "3 content items missing" is a backup you cannot restore from.
#[derive(Debug, Default, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Verification {
    /// Content files found and confirmed to hash to their own name.
    pub content: usize,
    /// Signatures this hive holds that the folder does not have at all.
    pub content_missing: usize,
    /// Content files present but whose bytes no longer hash to their name.
    pub content_corrupt: usize,
    /// Markers found byte-for-byte.
    pub markers: usize,
    /// Markers this hive holds that the folder is missing.
    pub markers_missing: usize,
    /// Markers present at that bag and index but holding other bytes — what a
    /// second, diverged hive backed into the same folder looks like.
    pub markers_differ: usize,
    /// Pool members found byte-for-byte.
    pub pool_members: usize,
    /// Pool members this hive holds that the folder is missing.
    pub pool_members_missing: usize,
    /// Pool members present with different bytes.
    pub pool_members_differ: usize,
}

impl Verification {
    /// Can this hive be restored from that folder in full?
    pub fn complete(&self) -> bool {
        self.content_missing == 0
            && self.content_corrupt == 0
            && self.markers_missing == 0
            && self.pool_members_missing == 0
    }

    /// Everything that did not check out, differing markers included.
    pub fn faults(&self) -> usize {
        self.content_missing
            + self.content_corrupt
            + self.markers_missing
            + self.markers_differ
            + self.pool_members_missing
            + self.pool_members_differ
    }
}

/// Read a backup folder back and confirm it holds this hive.
///
/// A backup nobody has read is a hope, not a backup. [`export`] can only report
/// what it believed it wrote; this reads the DESTINATION and answers the three
/// questions the export cannot:
///
///   1. is every signature this hive holds present in the folder?
///   2. does each of those files still hash to its own name? The filename is a
///      claim, and this is the only thing that ever checks it — it catches a
///      truncated write, a full disk, and bit rot on the destination drive.
///   3. is every marker and every pool member there, byte for byte?
///
/// Content is verified by hashing the file **on disk**, so the expensive half —
/// pulling every blob back out of redb — is never paid. Markers and pool
/// members are byte-compared instead: they carry no self-check, and reading
/// them out of the store is cheap.
///
/// Cost is therefore one pass over the backup folder. That is the price of
/// knowing, and it is worth paying at the end of a backup rather than at the
/// start of a recovery.
pub fn verify(store: &impl ContentStore, target: impl AsRef<Path>) -> Result<Verification> {
    let target = target.as_ref();
    let mut found = Verification::default();

    for sig in store.signatures()? {
        match std::fs::read(target.join(sig.to_hex())) {
            Ok(bytes) if hypercomb_protocol::sign(&bytes) == sig => found.content += 1,
            Ok(_) => found.content_corrupt += 1,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => found.content_missing += 1,
            Err(e) => return Err(e.into()),
        }
    }

    for bag in store.bags()? {
        let dir = target.join(bag.to_hex());
        for (index, marker) in store.markers(bag)? {
            match std::fs::read(dir.join(marker_filename(index))) {
                Ok(bytes) if bytes == marker.to_bytes() => found.markers += 1,
                Ok(_) => found.markers_differ += 1,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => found.markers_missing += 1,
                Err(e) => return Err(e.into()),
            }
        }
    }

    for pool in store.pools()? {
        let dir = target.join(pool.to_hex());
        for member in store.pool_list(pool)? {
            let Some(expected) = store.pool_get(pool, &member)? else { continue };
            match std::fs::read(dir.join(&member)) {
                Ok(bytes) if bytes == expected => found.pool_members += 1,
                Ok(_) => found.pool_members_differ += 1,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => found.pool_members_missing += 1,
                Err(e) => return Err(e.into()),
            }
        }
    }

    Ok(found)
}

/// Suffix for a write that has not landed yet. Restore skips these, so an
/// export killed mid-flight leaves litter rather than a fake member.
const PART_SUFFIX: &str = ".hcpart";

/// Write bytes so that a reader never sees a half-written file.
///
/// A backup is read back by machines that trust what they find. Content files
/// carry their own hash in their name and [`restore`] checks it, but markers
/// and pool members do not and cannot — a truncated one restores as truth. So
/// every write in this module lands in a sibling temp file first and is then
/// renamed, which is atomic within a directory on NTFS and APFS alike: a file
/// present under its real name is a file that was written whole.
///
/// The temp name APPENDS rather than replacing an extension, because pool
/// member names are user-facing strings that may already contain a dot, and
/// `en.json` and `en.txt` must not race each other through one temp path.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut tmp = path.as_os_str().to_os_string();
    tmp.push(PART_SUFFIX);
    let tmp = std::path::PathBuf::from(tmp);
    std::fs::write(&tmp, bytes)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// Write only when the target differs. Keeps [`Transfer::changed`] a truthful
/// answer, so exporting twice into the same folder reports no second change.
fn write_if_different(path: &Path, bytes: &[u8]) -> Result<bool> {
    if let Ok(existing) = std::fs::read(path) {
        if existing == bytes {
            return Ok(false);
        }
    }
    write_atomic(path, bytes)?;
    Ok(true)
}

/// Write a marker into the export target, never over an occupied index.
///
/// Markers are NOT pool members. A pool member is a mutable record and the
/// last writer wins; a marker is a revision, and overwriting index `n` with a
/// different revision destroys history. Export unions into its target the same
/// way `restore` unions into the store — and `restore` uses `put_marker_at`,
/// which refuses an occupied index. This is that same rule on the filesystem
/// side, so the two directions stay symmetric: first writer wins, and a second
/// root disagreeing at the same bag+index is counted as skipped rather than
/// silently overwriting what is already there.
fn write_marker_union(path: &Path, bytes: &[u8]) -> Result<bool> {
    if path.exists() {
        return Ok(false);
    }
    write_atomic(path, bytes)?;
    Ok(true)
}
