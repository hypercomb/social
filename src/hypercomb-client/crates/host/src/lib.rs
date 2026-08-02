//! # `hypercomb-host`
//!
//! The surface the shell talks to. Everything the web shell's `Store` does
//! against OPFS, it does here against the native store instead.
//!
//! ## The boundary speaks in meanings and segments, never addresses
//!
//! This is the single most important design decision in the crate.
//!
//! Pools are addressed by **meaning** (`"clipboard"`, `"websites:menu"`) and
//! bags by **path segments** (`["a", "b"]`) — never by a raw 64-hex address.
//! The host derives every address itself.
//!
//! Consequences, all of them the point:
//!
//! - The shell **cannot** mint a wrong address. Lineage canonicalization — NFC,
//!   separator folding, the symbol-only guard — happens in exactly one place.
//! - The shell **cannot** confuse a pool with a bag, because it never handles
//!   an address that could be either. The untagged-root hazard is unreachable
//!   from the other side of the boundary.
//! - The pool registry self-extends host-side, so a pool minted by a module
//!   this binary has never heard of still registers on first use.
//! - "Never hardcode a pool address" stops being a rule people have to
//!   remember and becomes something the API makes impossible.
//!
//! ## Resources, layers and optimizations are one operation
//!
//! The web shell has `getResource`, `getLayerBytes`, `getOptimization` and
//! `getOptimizedBytes` as separate methods. They are separate only because
//! typed folders and pools forced them apart in OPFS. Underneath, all four are
//! *"content by signature"*. Here they collapse into [`Host::get`] and
//! [`Host::put`], which is what they always were.
//!
//! ## Security
//!
//! The IPC surface is a narrow, explicit allowlist of operations — never a
//! general "run this" bridge. Every command is a named method with typed
//! arguments. Getting this boundary right in the first pass is the one real
//! security cost of hosting a web shell natively.

#![forbid(unsafe_code)]
#![warn(missing_debug_implementations)]

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use hypercomb_protocol::{bag_addr, LayerSig, Marker, PoolRegistry, Sig};
use hypercomb_store::{
    gc,
    interchange::{export, restore, Transfer},
    Collected, ContentStore, RedbStore,
};
use serde::{Deserialize, Serialize};

/// One entry in a shimmed directory listing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RawEntry {
    pub name: String,
    /// Directories are sig-named and hold markers and/or pool members.
    pub directory: bool,
}

/// Failures crossing the boundary.
///
/// Deliberately coarse. Detail useful to a developer goes to the log; the shell
/// gets a category it can act on, not an internal path it could leak into a
/// rendered error.
#[derive(Debug, thiserror::Error, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", content = "message")]
pub enum HostError {
    #[error("storage: {0}")]
    Storage(String),
    #[error("bad signature: {0}")]
    BadSignature(String),
    #[error("not found")]
    NotFound,
}

impl From<hypercomb_store::StoreError> for HostError {
    fn from(error: hypercomb_store::StoreError) -> Self {
        Self::Storage(error.to_string())
    }
}

pub type Result<T> = std::result::Result<T, HostError>;

fn parse_sig(hex: &str) -> Result<Sig> {
    hex.parse()
        .map_err(|_| HostError::BadSignature(hex.to_string()))
}

/// The head of a bag, as the shell sees it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Head {
    /// The marker's index. The maximum index in a bag IS the head.
    pub index: u32,
    /// The layer this revision points at, as hex.
    pub layer: String,
    /// Was this read from a legacy inline marker? Such markers are migrated to
    /// pointer records on the next write.
    pub legacy: bool,
}

/// A hive, and the operations the shell may perform on it.
///
/// The store is behind a [`Mutex`] because Tauri commands run concurrently.
/// `redb` handles its own transaction isolation, so this guards the registry
/// (which mutates on derive) more than the store.
#[derive(Debug)]
pub struct Host {
    store: RedbStore,
    registry: Mutex<PoolRegistry>,
    root: PathBuf,
}

impl Host {
    /// Open (or create) a hive rooted at `dir`.
    ///
    /// Performs no scan — see `hypercomb_store`. Boot maps one file.
    pub fn open(dir: impl AsRef<Path>) -> Result<Self> {
        let root = dir.as_ref().to_path_buf();
        Ok(Self {
            store: RedbStore::open(&root)?,
            registry: Mutex::new(PoolRegistry::new()),
            root,
        })
    }

    /// Where this hive lives.
    pub fn root(&self) -> &Path {
        &self.root
    }

    // -----------------------------------------------------------------
    // content — resources, layers, optimizations. One operation.
    // -----------------------------------------------------------------

    /// Store bytes, returning their signature as hex.
    ///
    /// Idempotent: identical content yields an identical signature, so a
    /// re-put is free and there is never anything to merge.
    pub fn put(&self, bytes: &[u8]) -> Result<String> {
        Ok(self.store.put(bytes)?.to_hex())
    }

    /// Read content by signature.
    pub fn get(&self, sig: &str) -> Result<Option<Vec<u8>>> {
        Ok(self.store.get(parse_sig(sig)?)?)
    }

    /// Is this content present, without reading it?
    pub fn has(&self, sig: &str) -> Result<bool> {
        Ok(self.store.has(parse_sig(sig)?)?)
    }

    // -----------------------------------------------------------------
    // bags — addressed by SEGMENTS, never by a raw address
    // -----------------------------------------------------------------

    /// The bag address for a path, as hex.
    ///
    /// Exposed for diagnostics and for the shell to key its own caches. It is
    /// deliberately *derived here*: the shell passes segments, so it can never
    /// compute a key that disagrees with the host's canonicalization.
    pub fn bag_address(&self, segments: &[String]) -> String {
        bag_addr(segments).to_hex()
    }

    /// The current head of a location.
    pub fn head(&self, segments: &[String]) -> Result<Option<Head>> {
        Ok(self.store.head(bag_addr(segments))?.map(|(index, marker)| Head {
            index,
            layer: marker.layer().to_hex(),
            legacy: marker.is_legacy(),
        }))
    }

    /// Append a revision pointing at `layer`, returning its index.
    ///
    /// Always writes a pointer record — legacy inline markers are read, never
    /// written.
    pub fn append(&self, segments: &[String], layer: &str) -> Result<u32> {
        let layer = LayerSig::from_sig(parse_sig(layer)?);
        Ok(self.store.append(bag_addr(segments), &Marker::pointer(layer))?)
    }

    /// Every revision at a location, oldest first.
    pub fn markers(&self, segments: &[String]) -> Result<Vec<Head>> {
        Ok(self
            .store
            .markers(bag_addr(segments))?
            .into_iter()
            .map(|(index, marker)| Head {
                index,
                layer: marker.layer().to_hex(),
                legacy: marker.is_legacy(),
            })
            .collect())
    }

    // -----------------------------------------------------------------
    // pools — addressed by MEANING, never by a raw address
    // -----------------------------------------------------------------

    /// The address of a meaning, as hex. Deriving registers it.
    pub fn pool_address(&self, meaning: &str) -> String {
        self.registry
            .lock()
            .expect("registry lock")
            .address(meaning)
            .to_hex()
    }

    pub fn pool_put(&self, meaning: &str, key: &str, bytes: &[u8]) -> Result<()> {
        let pool = self.registry.lock().expect("registry lock").address(meaning);
        Ok(self.store.pool_put(pool, key, bytes)?)
    }

    pub fn pool_get(&self, meaning: &str, key: &str) -> Result<Option<Vec<u8>>> {
        let pool = self.registry.lock().expect("registry lock").address(meaning);
        Ok(self.store.pool_get(pool, key)?)
    }

    pub fn pool_list(&self, meaning: &str) -> Result<Vec<String>> {
        let pool = self.registry.lock().expect("registry lock").address(meaning);
        Ok(self.store.pool_list(pool)?)
    }

    // -----------------------------------------------------------------
    // RAW ADDRESS SURFACE — for the handle shim ONLY
    //
    // Everything above addresses pools by meaning and bags by segments, so the
    // shell cannot mint a wrong address or confuse a pool with a bag. These
    // methods deliberately give that up: they take raw 64-hex addresses.
    //
    // WHY THEY EXIST. 44 files in the shell hold `hypercombRoot` and address
    // content by hex name through the File System API. Shimming that API is
    // what lets the existing shell run unmodified, and a shim cannot be built
    // on an interface that refuses raw addresses.
    //
    // This is PARITY, not a regression — the web shell works exactly this way
    // today. But it is a strictly worse interface, so:
    //
    //   - it is namespaced `raw_` so no one reaches for it by accident;
    //   - NEW code uses the typed surface above;
    //   - as call sites migrate off raw handles, this surface shrinks.
    //
    // Note `raw_dir_entries` returns markers AND pool members together, because
    // a sig-named directory may genuinely be both — for a bare-word meaning the
    // pool and a same-named tile's bag are one address. Returning the union is
    // the only correct answer.
    // -----------------------------------------------------------------

    /// Content at a raw address.
    pub fn raw_get(&self, sig: &str) -> Result<Option<Vec<u8>>> {
        self.get(sig)
    }

    /// Every top-level name: content signatures, plus bag and pool addresses.
    pub fn raw_root_entries(&self) -> Result<Vec<RawEntry>> {
        let mut out = Vec::new();
        for sig in self.store.signatures()? {
            out.push(RawEntry { name: sig.to_hex(), directory: false });
        }
        // A colliding address is one directory, so de-duplicate across the two.
        let mut dirs: Vec<String> = self
            .store
            .bags()?
            .into_iter()
            .map(|b| b.to_hex())
            .chain(self.store.pools()?.into_iter().map(|p| p.to_hex()))
            .collect();
        dirs.sort();
        dirs.dedup();
        out.extend(dirs.into_iter().map(|name| RawEntry { name, directory: true }));
        Ok(out)
    }

    /// Everything inside a sig-named directory — markers and pool members
    /// together, since the address may be both a bag and a pool.
    pub fn raw_dir_entries(&self, sig: &str) -> Result<Vec<RawEntry>> {
        let parsed = parse_sig(sig)?;
        let mut out: Vec<RawEntry> = self
            .store
            .markers(hypercomb_protocol::BagAddr::from_sig(parsed))?
            .into_iter()
            .map(|(index, _)| RawEntry {
                name: hypercomb_protocol::marker_filename(index),
                directory: false,
            })
            .collect();
        out.extend(
            self.store
                .pool_list(hypercomb_protocol::PoolAddr::from_sig(parsed))?
                .into_iter()
                .map(|name| RawEntry { name, directory: false }),
        );
        Ok(out)
    }

    /// Read one entry inside a sig-named directory.
    pub fn raw_dir_get(&self, sig: &str, name: &str) -> Result<Option<Vec<u8>>> {
        let parsed = parse_sig(sig)?;
        if let Some(index) = hypercomb_protocol::marker_index(name) {
            let bag = hypercomb_protocol::BagAddr::from_sig(parsed);
            if let Some((_, marker)) = self
                .store
                .markers(bag)?
                .into_iter()
                .find(|(at, _)| *at == index)
            {
                return Ok(Some(marker.to_bytes()));
            }
            return Ok(None);
        }
        Ok(self
            .store
            .pool_get(hypercomb_protocol::PoolAddr::from_sig(parsed), name)?)
    }

    /// Write one entry inside a sig-named directory.
    pub fn raw_dir_put(&self, sig: &str, name: &str, bytes: &[u8]) -> Result<()> {
        let parsed = parse_sig(sig)?;
        match hypercomb_protocol::marker_index(name) {
            Some(index) => {
                let bag = hypercomb_protocol::BagAddr::from_sig(parsed);
                let marker = Marker::parse(bytes);
                // Markers ADVANCE — truth is never overwritten in place. The
                // shim picks the filename, so an occupied index is one of two
                // things and they must not be conflated:
                //
                //   same marker  → the same revision arriving twice. Idempotent,
                //                  so accept it and write nothing.
                //   different    → a genuine conflict. Refuse. Writing would
                //                  destroy a revision, and this was the ONLY
                //                  path in the store that could.
                //
                // Deleting a revision stays possible, but only as the explicit
                // operation that says so (`raw_dir_remove`) — never as a silent
                // side effect of a write. The occupied lookup is O(bag) but is
                // paid only on collision; the ordinary write is one insert.
                if self.store.put_marker_at(bag, index, &marker)? {
                    return Ok(());
                }
                let occupant = self
                    .store
                    .markers(bag)?
                    .into_iter()
                    .find(|(at, _)| *at == index)
                    .map(|(_, existing)| existing);
                match occupant {
                    Some(existing) if existing == marker => Ok(()),
                    _ => Err(HostError::Storage(format!(
                        "marker {index} in bag {sig} is already written to a different revision; \
                         remove it explicitly to replace it"
                    ))),
                }
            }
            None => Ok(self.store.pool_put(
                hypercomb_protocol::PoolAddr::from_sig(parsed),
                name,
                bytes,
            )?),
        }
    }

    /// Remove one entry inside a sig-named directory.
    ///
    /// Markers and pool members are real deletes. See [`Host::raw_remove`] for
    /// why removing *content* is not.
    pub fn raw_dir_remove(&self, sig: &str, name: &str) -> Result<bool> {
        let parsed = parse_sig(sig)?;
        match hypercomb_protocol::marker_index(name) {
            Some(index) => Ok(self
                .store
                .remove_marker(hypercomb_protocol::BagAddr::from_sig(parsed), index)?),
            None => Ok(self
                .store
                .pool_remove(hypercomb_protocol::PoolAddr::from_sig(parsed), name)?),
        }
    }

    /// Remove a top-level entry.
    ///
    /// **Removing content is a no-op**, and that is the model, not a
    /// limitation: every layer is atomic and complete, so removing a tile
    /// appends a new layer with one less child. The old layer is still history
    /// and is still referenced by its own marker. Content is reclaimed only by
    /// [`Host::collect`], and only when no committed layer ever referenced it.
    ///
    /// Returns whether anything was actually removed, so a caller that checks
    /// gets an honest answer rather than a false confirmation.
    pub fn raw_remove(&self, _sig: &str) -> Result<bool> {
        Ok(false)
    }

    // -----------------------------------------------------------------
    // collection
    // -----------------------------------------------------------------

    /// Reclaim orphaned content — bytes no committed layer ever referenced.
    ///
    /// Never automatic. This is a manual or idle-time operation.
    pub fn collect(&self) -> Result<Collected> {
        Ok(gc(&self.store)?)
    }

    // -----------------------------------------------------------------
    // interchange
    // -----------------------------------------------------------------

    /// Back up ONE root's closure to a folder — the drain, one item at a time.
    ///
    /// Layer out of the history, every referenced resource expanded onto disk,
    /// children's history followed by name, skip-if-exists throughout. Pools
    /// stay home (clipboard and caches are device-local by design).
    pub fn export_root(&self, segments: &[String], target: impl AsRef<Path>) -> Result<Transfer> {
        Ok(hypercomb_store::interchange::export_root(&self.store, segments, target)?)
    }

    /// Restore a hive from a folder in the interchange form.
    ///
    /// Unions rather than replaces: content is deduped by signature, bag
    /// markers merge with the highest winning, pool members merge by name.
    /// Idempotent — restoring the same folder twice imports nothing.
    pub fn restore(&self, source: impl AsRef<Path>) -> Result<Transfer> {
        Ok(restore(&self.store, source)?)
    }

    /// Export this hive to a folder in the interchange form. Writes into the
    /// target; never deletes.
    pub fn export(&self, target: impl AsRef<Path>) -> Result<Transfer> {
        Ok(export(&self.store, target)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hypercomb_protocol::Layer;
    use tempfile::TempDir;

    fn host() -> (TempDir, Host) {
        let dir = TempDir::new().unwrap();
        let host = Host::open(dir.path().join("hive")).unwrap();
        (dir, host)
    }

    #[test]
    fn content_round_trips_by_signature() {
        let (_dir, host) = host();
        let sig = host.put(b"hello").unwrap();
        assert_eq!(sig.len(), 64);
        assert_eq!(host.get(&sig).unwrap().as_deref(), Some(&b"hello"[..]));
        assert!(host.has(&sig).unwrap());
    }

    #[test]
    fn a_malformed_signature_is_rejected_not_treated_as_absent() {
        let (_dir, host) = host();
        // "not found" and "you sent nonsense" are different answers and the
        // shell should be able to tell them apart.
        assert_eq!(host.get("nonsense"), Err(HostError::BadSignature("nonsense".into())));
        assert_eq!(host.get(&"a".repeat(64)).unwrap(), None);
    }

    #[test]
    fn head_tracks_the_latest_append() {
        let (_dir, host) = host();
        let here = vec!["place".to_string()];

        assert_eq!(host.head(&here).unwrap(), None);

        let first = Layer::empty("first").sig().to_hex();
        let second = Layer::empty("second").sig().to_hex();
        assert_eq!(host.append(&here, &first).unwrap(), 0);
        assert_eq!(host.append(&here, &second).unwrap(), 1);

        let head = host.head(&here).unwrap().unwrap();
        assert_eq!(head.index, 1);
        assert_eq!(head.layer, second);
        assert!(!head.legacy);
        assert_eq!(host.markers(&here).unwrap().len(), 2);
    }

    #[test]
    fn a_shim_write_never_destroys_an_occupied_marker() {
        // `raw_dir_put` was the one write path in the whole store that could
        // overwrite a revision in place (it removed the marker, then wrote).
        // Markers advance; replacing one is an explicit remove, never a silent
        // side effect of a write.
        let (_dir, host) = host();
        let here = vec!["place".to_string()];
        let elsewhere = vec!["other".to_string()];

        host.append(&here, &Layer::empty("first").sig().to_hex()).unwrap();
        host.append(&elsewhere, &Layer::empty("second").sig().to_hex()).unwrap();

        let bag = host.bag_address(&here);
        let occupant = host.raw_dir_get(&bag, "00000000").unwrap().unwrap();

        // The same revision arriving twice is idempotent, not a conflict.
        host.raw_dir_put(&bag, "00000000", &occupant).unwrap();
        assert_eq!(host.raw_dir_get(&bag, "00000000").unwrap().unwrap(), occupant);

        // A DIFFERENT revision at an occupied index is refused...
        let rival = host
            .raw_dir_get(&host.bag_address(&elsewhere), "00000000")
            .unwrap()
            .unwrap();
        assert!(host.raw_dir_put(&bag, "00000000", &rival).is_err());

        // ...and the revision that was there is untouched.
        assert_eq!(host.raw_dir_get(&bag, "00000000").unwrap().unwrap(), occupant);
        assert_eq!(host.head(&here).unwrap().unwrap().index, 0);

        // Removing it explicitly still works — that is the sanctioned path.
        assert!(host.raw_dir_remove(&bag, "00000000").unwrap());
        host.raw_dir_put(&bag, "00000000", &rival).unwrap();
        assert_eq!(host.raw_dir_get(&bag, "00000000").unwrap().unwrap(), rival);
    }

    #[test]
    fn segments_are_canonicalized_by_the_host_not_the_caller() {
        // The shell passes raw display names; equivalent names must land on
        // ONE bag. This is why the boundary takes segments, not addresses.
        let (_dir, host) = host();

        let spaced = vec!["Chapter 1".to_string()];
        let hyphened = vec!["Chapter-1".to_string()];
        assert_eq!(host.bag_address(&spaced), host.bag_address(&hyphened));

        let layer = Layer::empty("x").sig().to_hex();
        host.append(&spaced, &layer).unwrap();
        assert!(host.head(&hyphened).unwrap().is_some(), "same place, one bag");
    }

    #[test]
    fn a_symbol_only_name_does_not_collapse_into_the_root() {
        let (_dir, host) = host();
        let root: Vec<String> = vec![];
        assert_ne!(host.bag_address(&["🐝".to_string()]), host.bag_address(&root));
    }

    #[test]
    fn pools_are_addressed_by_meaning() {
        let (_dir, host) = host();
        host.pool_put("clipboard", "entry", b"clip").unwrap();
        assert_eq!(host.pool_get("clipboard", "entry").unwrap().as_deref(), Some(&b"clip"[..]));
        assert_eq!(host.pool_list("clipboard").unwrap(), vec!["entry"]);
    }

    #[test]
    fn an_unknown_meaning_registers_on_first_use() {
        let (_dir, host) = host();
        let address = host.pool_address("module:invented");
        assert_eq!(address.len(), 64);
        host.pool_put("module:invented", "k", b"v").unwrap();
        assert_eq!(host.pool_list("module:invented").unwrap(), vec!["k"]);
    }

    #[test]
    fn a_colliding_pool_and_bag_remain_separate_through_the_boundary() {
        // `bees` the pool and a tile named "bees" share ONE address. Because
        // the shell addresses them by meaning and by segments respectively, it
        // cannot conflate them even though the underlying address is identical.
        let (_dir, host) = host();
        assert_eq!(host.pool_address("bees"), host.bag_address(&["bees".to_string()]));

        host.pool_put("bees", "member", b"pool bytes").unwrap();
        host.append(&["bees".to_string()], &Layer::empty("bees").sig().to_hex()).unwrap();

        assert_eq!(host.pool_get("bees", "member").unwrap().as_deref(), Some(&b"pool bytes"[..]));
        assert!(host.head(&["bees".to_string()]).unwrap().is_some());
    }

    #[test]
    fn export_then_restore_moves_a_hive_between_hosts() {
        let (_a, source) = host();
        source.put(b"content").unwrap();
        source
            .append(&["place".to_string()], &Layer::empty("x").sig().to_hex())
            .unwrap();
        source.pool_put("clipboard", "entry", b"clip").unwrap();

        let folder = TempDir::new().unwrap();
        assert!(source.export(folder.path()).unwrap().changed());

        let (_b, target) = host();
        assert!(target.restore(folder.path()).unwrap().changed());
        assert!(
            !target.restore(folder.path()).unwrap().changed(),
            "restore is idempotent"
        );

        assert_eq!(target.pool_get("clipboard", "entry").unwrap().as_deref(), Some(&b"clip"[..]));
        assert!(target.head(&["place".to_string()]).unwrap().is_some());
    }
}
