//! Keeping a folder and this hive the same thing, continuously.
//!
//! The folder IS the hive, in the portable interchange form
//! (`documentation/one-folder-shape.md`). This module is what makes that true
//! at rest rather than only at the moment somebody clicks a menu item.
//!
//! # Two directions, two costs
//!
//! **Outbound** is eager. Every commit marks what it touched and a debounced
//! worker exports exactly that — [`export_selective`] rather than the full
//! [`export`](hypercomb_store::interchange::export), because a full run stats
//! every signature in the hive and on Windows that is a trip through the
//! on-access antivirus filter per record. The launch backup stays a full
//! export; the two converge on the same folder because both obey the same
//! union rules.
//!
//! **Inbound** is a real watcher, not a poll. This is a process, not a browser
//! tab: it can hold an OS handle on the directory, so it does. The web shell
//! cannot — the File System Access API has no change events — which is exactly
//! why the desktop side is where a watcher belongs.
//!
//! # Nothing overwrites anything
//!
//! Both directions obey the merge rule `interchange.rs` states for restore:
//! content is insert-if-absent (conflict-free by construction, since a name IS
//! the hash of its bytes), bag markers union and refuse an occupied index, and
//! pool members union by name. So the two directions cannot fight: the worst
//! case is that both sides keep what they had.
//!
//! # The echo
//!
//! Our own writes come back as filesystem events. Left alone that is a loop —
//! export wakes the watcher, the watcher restores, the restore commits, the
//! commit exports. Every path this module writes is recorded in `ours` and the
//! watcher claims it back, so only a change somebody ELSE made survives to
//! wake the worker.
//!
//! # Known: deletion does not travel
//!
//! Union merge has no tombstones, so a record deleted here and still present
//! in the folder is RESTORED on the next inbound pass. That was always true of
//! the Restore menu item; making the drain continuous makes it continuous too.
//! Content is unaffected (removing content is already a no-op by design — see
//! `Host::raw_remove`); it reaches markers removed by an explicit revision
//! delete, and pool members. Fixing it needs tombstones in the interchange
//! form, which is a protocol decision and deliberately not made here.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use hypercomb_protocol::{BagAddr, PoolAddr, Sig};
use hypercomb_store::interchange::{export_selective, restore};
use hypercomb_store::RedbStore;

/// How long the worker waits for the hive to go quiet before mirroring.
///
/// A commit is rarely alone — one tile edit writes a layer, a marker, and
/// often a rendition — so flushing on the first change would mirror the same
/// bag three times and beat the disk for no gain.
const QUIET: Duration = Duration::from_millis(400);

/// Above this many remembered paths, stop remembering and accept one spurious
/// inbound pass. A full launch export can write tens of thousands of files;
/// the echo set is a latency optimization, never a correctness requirement.
const OURS_CAP: usize = 100_000;

/// One backup, restore, or mirror flush at a time, process-wide.
///
/// Two exports into one folder would each write temp files for the same paths
/// and each report a count that is not the whole story; a restore racing an
/// export would read a folder being written underneath it. The menu can be
/// clicked twice before the first dialog appears, the launch backup starts on
/// its own, and the mirror now fires on every commit — so the guard is not
/// defensive, it is reachable from three directions.
pub static HIVE_TRANSFER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Releases [`HIVE_TRANSFER_RUNNING`] however the transfer ends — a cancelled
/// picker and an early `return` included. A flag released only on the happy
/// path is a flag that eventually stays set and disables the menu for the rest
/// of the session.
#[derive(Debug)]
pub struct BusyGuard;

impl BusyGuard {
    /// Take the transfer lock, or `None` when somebody else holds it.
    pub fn take() -> Option<Self> {
        if HIVE_TRANSFER_RUNNING.swap(true, Ordering::SeqCst) {
            None
        } else {
            Some(BusyGuard)
        }
    }
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        HIVE_TRANSFER_RUNNING.store(false, Ordering::SeqCst);
    }
}

/// Is this path something that could change what the hive holds?
///
/// The interchange form is signature-named throughout: content is `<sig>` at
/// the root, and everything else is a marker or a pool member INSIDE a
/// signature-named directory. So a README, a backup receipt, a `.hcpart` left
/// by an interrupted write, or whatever the operating system drops into a
/// folder it is syncing can all be ignored — without a list of names that
/// would need keeping up to date.
fn is_interchange_path(target: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(target) else {
        return false;
    };
    let parts: Vec<_> = relative.iter().collect();
    let sig_shaped = |part: &std::ffi::OsStr| {
        part.to_str().is_some_and(|name| {
            name.len() == Sig::HEX_LEN && name.bytes().all(|b| b.is_ascii_hexdigit())
        })
    };
    match parts.len() {
        // `<sig>` — content, or a bag/pool directory itself.
        1 => sig_shaped(parts[0]),
        // `<sig>/<marker or member>` — the member name is user-chosen, so only
        // the directory can be checked. That is the same rule `restore` uses.
        2 => sig_shaped(parts[0]),
        _ => false,
    }
}

/// Work the mirror owes.
#[derive(Default, Debug)]
struct Pending {
    content: HashSet<Sig>,
    bags: HashSet<BagAddr>,
    pools: HashSet<PoolAddr>,
    /// Somebody else changed the folder; drain it.
    inbound: bool,
    stop: bool,
}

impl Pending {
    fn idle(&self) -> bool {
        self.content.is_empty() && self.bags.is_empty() && self.pools.is_empty() && !self.inbound
    }
}

#[derive(Debug)]
struct Shared {
    store: Arc<RedbStore>,
    target: Mutex<Option<PathBuf>>,
    pending: Mutex<Pending>,
    wake: Condvar,
    /// Paths this process wrote, so the watcher can recognize its own echo.
    ours: Mutex<HashSet<PathBuf>>,
}

impl Shared {
    fn target(&self) -> Option<PathBuf> {
        self.target.lock().expect("target lock").clone()
    }

    fn nudge(&self) {
        self.wake.notify_one();
    }

    fn remember_ours(&self, written: Vec<PathBuf>) {
        if written.is_empty() {
            return;
        }
        let mut ours = self.ours.lock().expect("ours lock");
        if ours.len() + written.len() > OURS_CAP {
            ours.clear();
        }
        ours.extend(written);
    }
}

/// The continuous mirror between this hive and its backup folder.
pub struct Mirror {
    shared: Arc<Shared>,
    /// Held only to keep the OS watch alive; dropping it stops the watch.
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

impl std::fmt::Debug for Mirror {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Mirror")
            .field("target", &self.shared.target())
            .finish()
    }
}

impl Mirror {
    /// Create an inert mirror. Nothing happens until a target is armed.
    pub fn new(store: Arc<RedbStore>) -> Self {
        let shared = Arc::new(Shared {
            store,
            target: Mutex::new(None),
            pending: Mutex::new(Pending::default()),
            wake: Condvar::new(),
            ours: Mutex::new(HashSet::new()),
        });
        let worker = Arc::clone(&shared);
        std::thread::Builder::new()
            .name("hypercomb-mirror".into())
            .spawn(move || run(worker))
            .expect("spawn the mirror worker");
        Self {
            shared,
            watcher: Mutex::new(None),
        }
    }

    /// Point the mirror at a folder and start watching it.
    ///
    /// `None` disarms: the worker stays alive and simply has nowhere to write,
    /// which is what "the participant has not chosen a folder" looks like.
    pub fn arm(&self, target: Option<PathBuf>) {
        *self.shared.target.lock().expect("target lock") = target.clone();
        // Dropping the previous watcher releases the old directory handle.
        let mut slot = self.watcher.lock().expect("watcher lock");
        *slot = None;
        self.shared.ours.lock().expect("ours lock").clear();

        let Some(target) = target else { return };
        if !target.is_dir() {
            eprintln!(
                "[hypercomb] mirror target {} is not reachable — not watching",
                target.display()
            );
            return;
        }

        let shared = Arc::clone(&self.shared);
        let watched = target.clone();
        let handler = move |event: notify::Result<notify::Event>| {
            let Ok(event) = event else { return };
            if !external_change(&shared, &watched, &event) {
                return;
            }
            let mut pending = shared.pending.lock().expect("pending lock");
            pending.inbound = true;
            shared.wake.notify_one();
        };

        match notify::recommended_watcher(handler) {
            Ok(mut watcher) => {
                use notify::Watcher as _;
                if let Err(e) = watcher.watch(&target, notify::RecursiveMode::Recursive) {
                    eprintln!("[hypercomb] could not watch {}: {e}", target.display());
                    return;
                }
                eprintln!("[hypercomb] mirror watching {}", target.display());
                *slot = Some(watcher);
                // The folder may have moved on while this hive was closed.
                drop(slot);
                self.shared.pending.lock().expect("pending lock").inbound = true;
                self.shared.nudge();
            }
            Err(e) => eprintln!("[hypercomb] could not create a folder watcher: {e}"),
        }
    }

    /// Note that content was committed.
    pub fn touched_content(&self, sig: Sig) {
        self.mark(|p| {
            p.content.insert(sig);
        });
    }

    /// Note that a bag gained or lost a marker.
    pub fn touched_bag(&self, bag: BagAddr) {
        self.mark(|p| {
            p.bags.insert(bag);
        });
    }

    /// Note that a pool member changed.
    pub fn touched_pool(&self, pool: PoolAddr) {
        self.mark(|p| {
            p.pools.insert(pool);
        });
    }

    fn mark(&self, edit: impl FnOnce(&mut Pending)) {
        // No folder chosen: recording work nobody will ever flush would grow
        // without bound for the life of the process.
        if self.shared.target().is_none() {
            return;
        }
        let mut pending = self.shared.pending.lock().expect("pending lock");
        edit(&mut pending);
        self.shared.wake.notify_one();
    }
}

impl Drop for Mirror {
    fn drop(&mut self) {
        let mut pending = self.shared.pending.lock().expect("pending lock");
        pending.stop = true;
        self.shared.wake.notify_all();
    }
}

/// Did somebody OTHER than this process change the folder?
fn external_change(shared: &Arc<Shared>, target: &Path, event: &notify::Event) -> bool {
    let mut external = false;
    let mut ours = shared.ours.lock().expect("ours lock");
    for path in &event.paths {
        if !is_interchange_path(target, path) {
            continue;
        }
        // Claim it back exactly once: a path we wrote produces one event we
        // must ignore, and any LATER event for the same path is real.
        if !ours.remove(path) {
            external = true;
        }
    }
    external
}

fn run(shared: Arc<Shared>) {
    loop {
        {
            let mut pending = shared.pending.lock().expect("pending lock");
            while pending.idle() && !pending.stop {
                pending = shared.wake.wait(pending).expect("mirror wait");
            }
            if pending.stop {
                return;
            }
        }

        // Let the burst finish before touching the disk.
        std::thread::sleep(QUIET);

        let (content, bags, pools, inbound) = {
            let mut pending = shared.pending.lock().expect("pending lock");
            if pending.stop {
                return;
            }
            (
                pending.content.drain().collect::<Vec<_>>(),
                pending.bags.drain().collect::<Vec<_>>(),
                pending.pools.drain().collect::<Vec<_>>(),
                std::mem::take(&mut pending.inbound),
            )
        };

        let Some(target) = shared.target() else { continue };
        if !target.is_dir() {
            continue;
        }

        let Some(_busy) = BusyGuard::take() else {
            // A menu backup or restore owns the folder. Put the work BACK —
            // dropping it would lose a commit — and try again shortly.
            let mut pending = shared.pending.lock().expect("pending lock");
            pending.content.extend(content);
            pending.bags.extend(bags);
            pending.pools.extend(pools);
            pending.inbound |= inbound;
            drop(pending);
            std::thread::sleep(QUIET);
            shared.nudge();
            continue;
        };

        // Inbound FIRST, for the same reason the web shell drains before it
        // mirrors: whatever the folder gained is then already in hand when the
        // outbound half runs, so a round trip settles in one pass.
        if inbound {
            match restore(&*shared.store, &target) {
                Ok(moved) if moved.changed() => eprintln!(
                    "[hypercomb] mirror in <- {}: {} content, {} markers, {} pool members",
                    target.display(),
                    moved.content,
                    moved.markers,
                    moved.pool_members
                ),
                Ok(_) => {}
                Err(e) => eprintln!("[hypercomb] mirror restore failed: {e}"),
            }
        }

        if content.is_empty() && bags.is_empty() && pools.is_empty() {
            continue;
        }
        let mut written = Vec::new();
        match export_selective(&*shared.store, &target, &content, &bags, &pools, |path| {
            written.push(path.to_path_buf())
        }) {
            Ok(moved) => {
                shared.remember_ours(written);
                if moved.changed() {
                    eprintln!(
                        "[hypercomb] mirror out -> {}: {} content, {} markers, {} pool members",
                        target.display(),
                        moved.content,
                        moved.markers,
                        moved.pool_members
                    );
                }
            }
            Err(e) => {
                eprintln!("[hypercomb] mirror export failed: {e}");
                // A full disk or a folder that went away mid-write. Keep the
                // work so the next pass retries it rather than silently
                // dropping a commit that never reached the folder.
                let mut pending = shared.pending.lock().expect("pending lock");
                pending.content.extend(content);
                pending.bags.extend(bags);
                pending.pools.extend(pools);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig_name(byte: u8) -> String {
        format!("{:02x}", byte).repeat(32)
    }

    #[test]
    fn interchange_paths_are_signature_shaped() {
        let target = Path::new("/backup");
        let sig = sig_name(0xab);

        // Content at the root, and a marker inside a bag.
        assert!(is_interchange_path(target, &Path::new("/backup").join(&sig)));
        assert!(is_interchange_path(
            target,
            &Path::new("/backup").join(&sig).join("00000000")
        ));
        // A pool member's name is user-chosen; the DIRECTORY is what proves it.
        assert!(is_interchange_path(
            target,
            &Path::new("/backup").join(&sig).join("anything at all")
        ));
    }

    #[test]
    fn folder_furniture_is_not_interchange() {
        let target = Path::new("/backup");
        let sig = sig_name(0xab);

        // The receipt, a README, and whatever the OS leaves behind.
        assert!(!is_interchange_path(target, Path::new("/backup/README.txt")));
        assert!(!is_interchange_path(target, Path::new("/backup/desktop.ini")));
        // An interrupted atomic write. Sharing the stem does not make it
        // content — and treating it as content would wake a restore for a file
        // that is about to be renamed away.
        assert!(!is_interchange_path(
            target,
            &Path::new("/backup").join(format!("{sig}.hcpart"))
        ));
        // Too deep to be the interchange form at all.
        assert!(!is_interchange_path(
            target,
            &Path::new("/backup").join(&sig).join(&sig).join("00000000")
        ));
        // Outside the target entirely.
        assert!(!is_interchange_path(target, &Path::new("/elsewhere").join(&sig)));
    }

    #[test]
    fn the_transfer_guard_admits_one_holder() {
        let first = BusyGuard::take().expect("the guard starts free");
        assert!(BusyGuard::take().is_none(), "a second holder must be refused");
        drop(first);
        assert!(
            BusyGuard::take().is_some(),
            "the guard must release however the transfer ended"
        );
    }
}
