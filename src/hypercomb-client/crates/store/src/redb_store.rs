//! The native store: one memory-mapped B-tree plus loose blob files.

use std::path::{Path, PathBuf};

use hypercomb_protocol::{sign, BagAddr, Marker, PoolAddr, Sig};
use redb::{Database, ReadableTable, TableDefinition};

use crate::{ContentStore, PoolKey, Result, StoreError, BLOB_THRESHOLD};

/// Small content, keyed by the 32 signature bytes.
const CONTENT: TableDefinition<&[u8], &[u8]> = TableDefinition::new("content");

/// Large content: signature -> byte length. The path is derived from the
/// signature, so only presence and size need recording.
const BLOBS: TableDefinition<&[u8], u64> = TableDefinition::new("blobs");

/// Markers, keyed `bag(32) ++ index(4, big-endian)`.
///
/// Big-endian is the load-bearing detail: it makes the B-tree's lexicographic
/// order identical to numeric order, so the head is simply the last entry in
/// the bag's range. This mirrors why marker *filenames* are zero-padded.
const MARKERS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("markers");

/// Pool members, keyed `pool(32) ++ member name bytes`.
const POOLS: TableDefinition<&[u8], &[u8]> = TableDefinition::new("pools");

fn db_err(error: impl std::fmt::Display) -> StoreError {
    StoreError::Database(error.to_string())
}

/// Key for a marker within a bag.
fn marker_key(bag: BagAddr, index: u32) -> [u8; 36] {
    let mut key = [0u8; 36];
    key[..32].copy_from_slice(bag.sig().as_bytes());
    key[32..].copy_from_slice(&index.to_be_bytes());
    key
}

/// The half-open key range covering every marker in a bag.
fn bag_range(bag: BagAddr) -> ([u8; 36], [u8; 36]) {
    (marker_key(bag, 0), marker_key(bag, u32::MAX))
}

fn pool_key(pool: PoolAddr, member: &str) -> Vec<u8> {
    let mut key = Vec::with_capacity(32 + member.len());
    key.extend_from_slice(pool.sig().as_bytes());
    key.extend_from_slice(member.as_bytes());
    key
}

fn sig_from_key(key: &[u8]) -> Option<Sig> {
    let bytes: [u8; 32] = key.get(..32)?.try_into().ok()?;
    Some(Sig::from_bytes(bytes))
}

/// A hive on disk.
#[derive(Debug)]
pub struct RedbStore {
    db: Database,
    blobs_dir: PathBuf,
}

impl RedbStore {
    /// Open (or create) a hive rooted at `dir`.
    ///
    /// Boot performs **no scan**: this maps one file. Every head is then a
    /// range query away.
    pub fn open(dir: impl AsRef<Path>) -> Result<Self> {
        let dir = dir.as_ref();
        std::fs::create_dir_all(dir)?;
        let blobs_dir = dir.join("blobs");
        std::fs::create_dir_all(&blobs_dir)?;

        let db = Database::create(dir.join("hive.redb")).map_err(db_err)?;

        // Create the tables up front so read transactions never fault on a
        // missing table.
        let txn = db.begin_write().map_err(db_err)?;
        {
            txn.open_table(CONTENT).map_err(db_err)?;
            txn.open_table(BLOBS).map_err(db_err)?;
            txn.open_table(MARKERS).map_err(db_err)?;
            txn.open_table(POOLS).map_err(db_err)?;
        }
        txn.commit().map_err(db_err)?;

        Ok(Self { db, blobs_dir })
    }

    /// Where a blob's bytes live. Fanned out by the first byte so no directory
    /// grows unbounded.
    fn blob_path(&self, sig: Sig) -> PathBuf {
        let hex = sig.to_hex();
        self.blobs_dir.join(&hex[..2]).join(&hex)
    }
}

impl ContentStore for RedbStore {
    fn put(&self, bytes: &[u8]) -> Result<Sig> {
        let sig = sign(bytes);

        // Content-addressed: if we already hold it, the bytes are by definition
        // identical and there is nothing to do.
        if self.has(sig)? {
            return Ok(sig);
        }

        if bytes.len() < BLOB_THRESHOLD {
            let txn = self.db.begin_write().map_err(db_err)?;
            {
                let mut table = txn.open_table(CONTENT).map_err(db_err)?;
                table.insert(sig.as_bytes().as_slice(), bytes).map_err(db_err)?;
            }
            txn.commit().map_err(db_err)?;
        } else {
            // Write the bytes BEFORE indexing them, so a crash between the two
            // leaves an unreferenced file rather than an index entry pointing
            // at nothing. Garbage is recoverable; a dangling reference is not.
            let path = self.blob_path(sig);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&path, bytes)?;

            let txn = self.db.begin_write().map_err(db_err)?;
            {
                let mut table = txn.open_table(BLOBS).map_err(db_err)?;
                table
                    .insert(sig.as_bytes().as_slice(), bytes.len() as u64)
                    .map_err(db_err)?;
            }
            txn.commit().map_err(db_err)?;
        }

        Ok(sig)
    }

    fn get(&self, sig: Sig) -> Result<Option<Vec<u8>>> {
        let txn = self.db.begin_read().map_err(db_err)?;

        let content = txn.open_table(CONTENT).map_err(db_err)?;
        if let Some(found) = content.get(sig.as_bytes().as_slice()).map_err(db_err)? {
            return Ok(Some(found.value().to_vec()));
        }

        let blobs = txn.open_table(BLOBS).map_err(db_err)?;
        if blobs.get(sig.as_bytes().as_slice()).map_err(db_err)?.is_some() {
            let path = self.blob_path(sig);
            return match std::fs::read(&path) {
                Ok(bytes) => Ok(Some(bytes)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    Err(StoreError::MissingBlob(sig))
                }
                Err(e) => Err(e.into()),
            };
        }

        Ok(None)
    }

    fn has(&self, sig: Sig) -> Result<bool> {
        let txn = self.db.begin_read().map_err(db_err)?;
        let key = sig.as_bytes().as_slice();
        let content = txn.open_table(CONTENT).map_err(db_err)?;
        if content.get(key).map_err(db_err)?.is_some() {
            return Ok(true);
        }
        let blobs = txn.open_table(BLOBS).map_err(db_err)?;
        Ok(blobs.get(key).map_err(db_err)?.is_some())
    }

    fn head(&self, bag: BagAddr) -> Result<Option<(u32, Marker)>> {
        let txn = self.db.begin_read().map_err(db_err)?;
        let table = txn.open_table(MARKERS).map_err(db_err)?;
        let (low, high) = bag_range(bag);

        // THE head lookup: last entry in the bag's range. O(log n), no
        // enumeration. This is why there is no head index to maintain.
        let mut range = table
            .range(low.as_slice()..=high.as_slice())
            .map_err(db_err)?;

        match range.next_back() {
            Some(entry) => {
                let (key, value) = entry.map_err(db_err)?;
                let index = u32::from_be_bytes(key.value()[32..].try_into().expect("36-byte key"));
                Ok(Some((index, Marker::parse(value.value()))))
            }
            None => Ok(None),
        }
    }

    fn append(&self, bag: BagAddr, marker: &Marker) -> Result<u32> {
        let next = match self.head(bag)? {
            Some((index, _)) => index + 1,
            None => 0,
        };
        let txn = self.db.begin_write().map_err(db_err)?;
        {
            let mut table = txn.open_table(MARKERS).map_err(db_err)?;
            table
                .insert(marker_key(bag, next).as_slice(), marker.to_bytes().as_slice())
                .map_err(db_err)?;
        }
        txn.commit().map_err(db_err)?;
        Ok(next)
    }

    fn put_marker_at(&self, bag: BagAddr, index: u32, marker: &Marker) -> Result<bool> {
        let key = marker_key(bag, index);
        let txn = self.db.begin_write().map_err(db_err)?;
        let inserted = {
            let mut table = txn.open_table(MARKERS).map_err(db_err)?;
            if table.get(key.as_slice()).map_err(db_err)?.is_some() {
                false
            } else {
                table
                    .insert(key.as_slice(), marker.to_bytes().as_slice())
                    .map_err(db_err)?;
                true
            }
        };
        txn.commit().map_err(db_err)?;
        Ok(inserted)
    }

    fn markers(&self, bag: BagAddr) -> Result<Vec<(u32, Marker)>> {
        let txn = self.db.begin_read().map_err(db_err)?;
        let table = txn.open_table(MARKERS).map_err(db_err)?;
        let (low, high) = bag_range(bag);

        let mut out = Vec::new();
        for entry in table
            .range(low.as_slice()..=high.as_slice())
            .map_err(db_err)?
        {
            let (key, value) = entry.map_err(db_err)?;
            let index = u32::from_be_bytes(key.value()[32..].try_into().expect("36-byte key"));
            out.push((index, Marker::parse(value.value())));
        }
        Ok(out)
    }

    fn remove_marker(&self, bag: BagAddr, index: u32) -> Result<bool> {
        let txn = self.db.begin_write().map_err(db_err)?;
        let removed = {
            let mut table = txn.open_table(MARKERS).map_err(db_err)?;
            // Bind the guard so it drops before `table` does — `remove` hands
            // back a value borrowing the table.
            let previous = table.remove(marker_key(bag, index).as_slice()).map_err(db_err)?;
            let existed = previous.is_some();
            drop(previous);
            existed
        };
        txn.commit().map_err(db_err)?;
        Ok(removed)
    }

    fn pool_remove(&self, pool: PoolAddr, key: &str) -> Result<bool> {
        let txn = self.db.begin_write().map_err(db_err)?;
        let removed = {
            let mut table = txn.open_table(POOLS).map_err(db_err)?;
            let previous = table.remove(pool_key(pool, key).as_slice()).map_err(db_err)?;
            let existed = previous.is_some();
            drop(previous);
            existed
        };
        txn.commit().map_err(db_err)?;
        Ok(removed)
    }

    fn sweep(&self, sig: Sig) -> Result<bool> {
        let txn = self.db.begin_write().map_err(db_err)?;
        let (removed_small, was_blob) = {
            let mut content = txn.open_table(CONTENT).map_err(db_err)?;
            let mut blobs = txn.open_table(BLOBS).map_err(db_err)?;
            let small = content.remove(sig.as_bytes().as_slice()).map_err(db_err)?.is_some();
            let blob = blobs.remove(sig.as_bytes().as_slice()).map_err(db_err)?.is_some();
            (small, blob)
        };
        txn.commit().map_err(db_err)?;

        // Unindex before unlinking, mirroring put's write-then-index order. A
        // crash between the two leaves an unreferenced file, which the next
        // collection reclaims — never an index entry pointing at nothing.
        if was_blob {
            let path = self.blob_path(sig);
            if let Err(e) = std::fs::remove_file(&path) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    return Err(e.into());
                }
            }
        }

        Ok(removed_small || was_blob)
    }

    fn pool_put(&self, pool: PoolAddr, key: &str, bytes: &[u8]) -> Result<()> {
        let txn = self.db.begin_write().map_err(db_err)?;
        {
            let mut table = txn.open_table(POOLS).map_err(db_err)?;
            table
                .insert(pool_key(pool, key).as_slice(), bytes)
                .map_err(db_err)?;
        }
        txn.commit().map_err(db_err)?;
        Ok(())
    }

    fn pool_get(&self, pool: PoolAddr, key: &str) -> Result<Option<Vec<u8>>> {
        let txn = self.db.begin_read().map_err(db_err)?;
        let table = txn.open_table(POOLS).map_err(db_err)?;
        Ok(table
            .get(pool_key(pool, key).as_slice())
            .map_err(db_err)?
            .map(|found| found.value().to_vec()))
    }

    fn pool_list(&self, pool: PoolAddr) -> Result<Vec<PoolKey>> {
        let txn = self.db.begin_read().map_err(db_err)?;
        let table = txn.open_table(POOLS).map_err(db_err)?;

        let low = pool_key(pool, "");
        let mut high = pool.sig().as_bytes().to_vec();
        // One past the pool's prefix: increment the last non-0xff byte.
        for byte in high.iter_mut().rev() {
            if *byte == u8::MAX {
                *byte = 0;
            } else {
                *byte += 1;
                break;
            }
        }

        let mut out = Vec::new();
        for entry in table.range(low.as_slice()..high.as_slice()).map_err(db_err)? {
            let (key, _) = entry.map_err(db_err)?;
            if let Ok(name) = std::str::from_utf8(&key.value()[32..]) {
                out.push(name.to_string());
            }
        }
        Ok(out)
    }

    fn bags(&self) -> Result<Vec<BagAddr>> {
        let txn = self.db.begin_read().map_err(db_err)?;
        let table = txn.open_table(MARKERS).map_err(db_err)?;

        let mut out: Vec<BagAddr> = Vec::new();
        for entry in table.iter().map_err(db_err)? {
            let (key, _) = entry.map_err(db_err)?;
            if let Some(sig) = sig_from_key(key.value()) {
                let bag = BagAddr::from_sig(sig);
                // Keys are ordered, so a bag's markers are contiguous.
                if out.last() != Some(&bag) {
                    out.push(bag);
                }
            }
        }
        Ok(out)
    }

    fn pools(&self) -> Result<Vec<PoolAddr>> {
        let txn = self.db.begin_read().map_err(db_err)?;
        let table = txn.open_table(POOLS).map_err(db_err)?;

        let mut out: Vec<PoolAddr> = Vec::new();
        for entry in table.iter().map_err(db_err)? {
            let (key, _) = entry.map_err(db_err)?;
            if let Some(sig) = sig_from_key(key.value()) {
                let pool = PoolAddr::from_sig(sig);
                if out.last() != Some(&pool) {
                    out.push(pool);
                }
            }
        }
        Ok(out)
    }

    fn signatures(&self) -> Result<Vec<Sig>> {
        let txn = self.db.begin_read().map_err(db_err)?;
        let mut out = Vec::new();

        let content = txn.open_table(CONTENT).map_err(db_err)?;
        for entry in content.iter().map_err(db_err)? {
            let (key, _) = entry.map_err(db_err)?;
            if let Some(sig) = sig_from_key(key.value()) {
                out.push(sig);
            }
        }

        let blobs = txn.open_table(BLOBS).map_err(db_err)?;
        for entry in blobs.iter().map_err(db_err)? {
            let (key, _) = entry.map_err(db_err)?;
            if let Some(sig) = sig_from_key(key.value()) {
                out.push(sig);
            }
        }

        Ok(out)
    }
}
