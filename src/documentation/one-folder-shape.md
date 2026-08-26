# One folder shape

*The chosen folder IS the hive.* Every surface — the web shell's OPFS, the
native client's store, a backup folder, a published host — speaks the same
tree, so a folder can be handed to somebody else as-is and a Windows client can
be started straight from it.

The shape itself is specified in
[`protocol/conformance.md` §7](protocol/conformance.md) (the *portable
interchange form*). This document is about the **topology**: who holds it, who
drains into whom, and what is still open.

```text
<root>/<sig>              content — layers, resources, dependencies
<root>/<lineageSig>/      lineage bags — 8-digit markers, max = head
<root>/<sign(meaning)>/   pools of meaning
<root>/dcp/<domain>/      adopted domain identities — same grammar, scoped
```

There is no fourth thing. A domain is not a different shape; it is the same
three, scoped by identity one level down.

## Who carries how much of it

| Surface | `<sig>` | bags | pools | Held as |
|---|---|---|---|---|
| Web shell | ✅ | ✅ | ✅ | OPFS |
| Native client | ✅ | ✅ | ✅ | redb B-tree + `blobs/<aa>/<sig>` |
| Backup folder | ✅ | ✅ | ✅ | loose files |
| Server host (R2/CDN) | ✅ | — | — | flat objects |

A read-only host carries **less of the shape, not a different one**. It needs
only the content half, because a layer signature is a complete handshake — a
visitor resolves one signature and walks the closure. `publish-site.ts` says it
directly: *"flat at the root — the one resolution contract `<origin>/<sig>`;
the folder IS the pool."* Your history bags and your clipboard pool are not
theirs to hold.

The native client is the one surface whose **internal representation differs**,
deliberately: 603 bags / 8,006 markers as loose files costs an MFT record, a
directory entry and an on-access antivirus trip *per record* on Windows, which
is most of why the old cold scan took 13.6 s. `hypercomb-client/crates/store`
stores however it likes and round-trips the interchange form losslessly through
`interchange.rs`. **Do not make the loose folder the hot store** — that is the
regression redb exists to prevent. The folder is the live *mirror*.

## The merge rule

`interchange.rs` states it, and it is the same in both directions:

| Thing | Rule | Conflicts |
|---|---|---|
| Content | insert if absent | **none** — sha256-addressed, dedup by construction |
| Bags | union markers, preserve indices | see divergence, below |
| Pools | union by member | by member |

Content is conflict-free *by construction*: the filename is the hash of the
bytes, so two devices writing the same signature write identical bytes. This is
why reversing the flow is cheap — with immutable, content-addressed bytes,
"which side is the source" mostly stops mattering. Restore, the legacy `__x__`
drain, and backup ingest are one code path.

## Always synchronizing

Neither side is the source of truth. Three mechanisms keep them together, and
they are deliberately different because content and structure have different
shapes of cost.

**Outbound — eager, continuous.** Every content and marker write mirrors into
the folder incrementally (`content:wrote`, `history:marker-wrote` → a coalesced
idle drain), and `syncNow()` reconciles the whole tree.

**Inbound, content — lazy.** A signature-named file is *never* polled for. When
the local store misses, `ContentBrokerDrone` asks the folder first, ahead of
every network tier (`#fetchFromFolder` → `FolderSyncService.resolveContent`),
verifies sha256, and writes through to the local store. This is cheap in the
way that matters: nothing is copied until something actually wants it, so an
unchanged folder costs nothing at all. It is also conflict-free — a lookup only
ever fires for bytes this browser does not hold, so there is nothing to
overwrite. A local folder ahead of HTTP is also strictly better than the
network tier it precedes, which matters because `hypercomb.io` answers 200 with
the app shell for every `/<sig>`.

**Inbound, structure — polled.** Bags and pools cannot be lazy: you do not
"miss" a marker by name, you enumerate a bag to find its head. So
`#drainFromFolder` walks the signature-named directories on a cadence
(`DRAIN_INTERVAL_MS`) and unions what it finds. This is affordable precisely
because it excludes content — the whole navigable structure of a hive is a few
megabytes.

It is a **poll** because a browser tab cannot watch a directory: the page must
be open, the handle came from a user gesture, and the File System Access API
emits no change events. The web side is therefore pull-on-open and
push-on-commit.

## The native client: a real watcher

The desktop side is a process, not a tab, so it does not have to poll — and
does not. `hypercomb-client/crates/host/src/mirror.rs` holds both halves:

**Outbound, on commit.** Every mutation through `Host` (`put`, `append`,
`pool_put`, and the shim's `raw_dir_put`, which is how the shell actually
writes) marks what it touched. A debounced worker then exports exactly that
via `export_selective` — never the full `export`, which stats every signature
in the hive and on Windows pays an on-access antivirus trip per record. The
debounce matters: one tile edit writes a layer, a marker and often a rendition,
so flushing on the first change would mirror the same bag three times.

**Inbound, on change.** `notify` watches the target directory and a real
external change drains straight in through `restore`. Both directions take the
same process-wide transfer lock as the menu and the launch backup, so a mirror
flush can never race a backup a person just asked for.

**The echo.** Our own writes come back as filesystem events, and left alone
that is a loop — export wakes the watcher, the watcher restores, the restore
commits, the commit exports. Every path the mirror writes is recorded and the
watcher claims it back exactly once, so only somebody else's change survives to
wake the worker. Events are filtered to signature-shaped paths first, which
also disposes of `.hcpart` temp files, the backup receipt, READMEs and whatever
the operating system drops into a folder it is syncing — with no list of names
to keep up to date.

**Launch still matters.** Arming the mirror does not retroactively export, and
a watcher cannot see what happened while the app was closed. So the launch-time
full export stays, and arming also schedules one inbound pass for the same
reason in the other direction. Between them they close the gap the continuous
path cannot.

## Divergence: detected and quarantined, not resolved

`put_marker_at` refuses an occupied index (`redb_store.rs`), and the inbound
drain never overwrites. So when a hive is edited on web *and* on desktop
between drains, both sides hold different bytes at the same address.

That address is now **counted, reported, and quarantined**: it is excluded from
the outbound mirror as well, so the copy pass cannot undo the drain's refusal
by writing our bytes over theirs. Both sides keep what they have, a toast and
an activity entry say so, and `state().collisions` carries the count. The
quarantine is rebuilt from scratch on every drain, so an address the
participant reconciles stops being held back without anything having to clear
it.

What it does **not** do is pick a winner — that would be picking one at random,
and history deliberately never branches. Two ways to actually close it:

- **Lease the folder** — a lease file names the current writer; the other side
  is read-only until it takes over. Cheap, honest, matches the one-writer rule
  already in force for browser tabs.
- **Rebase on drain** — re-append incoming markers *above* your head instead of
  quarantining them. The layers are immutable content, so this is replaying the
  other side's commits on top of yours — the same compensating-ops move history
  already uses instead of branching. Converges, but both sides must apply an
  identical tie-break or they order them differently and diverge again.

Rebase is correct for multi-device. Lease is correct for one person moving
between web and desktop.

## Migration state

The web shell wrote `hypercomb-backup/devices/<id>/opfs/<tree>` until
2026-08-25. It now writes the hive at the chosen folder itself, with
bookkeeping — device manifests, seals, reports — in a `.hypercomb/` sidecar.
Non-signature names are exactly what the native restore's signature filter
ignores, so bookkeeping can sit beside a hive without ever being mistaken for a
bag or a pool.

The legacy nest is **read-fallback only**: never written again, still imported,
and detected by probing for the `opfs/` directory rather than by recording
which layout was chosen — so a folder caught mid-migration reads correctly from
either side. An existing backup is not migrated in place and is not deleted; it
simply stops being written to.

Note that the closure materialization is what makes a web-written folder safe
as a *native* restore source. Non-signature entries at the OPFS root (the
draining legacy `__x__` directories) copy across but are ignored by `restore`;
the records inside them travel anyway, because hard-copy resolves every
referenced signature and writes it sig-named at the root.

## Known: deletion does not travel

Union merge has no tombstones. A record deleted on one side while the folder
still holds it is **restored** on the next inbound pass. This was always true
of the Restore menu item; making the drain continuous makes the resurrection
continuous too, which is a real change in how often it can bite.

Content is unaffected — removing content is already a no-op by design, since a
layer is atomic and removing a tile appends a new layer rather than deleting an
old one. It reaches markers removed by an explicit revision delete, and pool
members. Fixing it needs tombstones in the interchange form, which is a
protocol decision and deliberately not taken as a side effect of building a
mirror.

Still owed:

1. The 2026-08-20 folder-sync fixes are **source only, not deployed** — the
   live web hive still crashes on every press, so the web half is not reachable
   in production yet.
2. A conflict rule — lease or rebase — to turn quarantine into resolution.
3. Tombstones, if deletion should propagate.
