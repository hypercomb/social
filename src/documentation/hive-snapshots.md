# Hive Snapshots — named restore points for tiles *and* behaviours

> **Status: BUILT (essentials + DCP storage). The cross-origin
> `save-branch` wire is typechecked on both sides but not yet exercised
> end-to-end.** See §Verification.

`/snapshot <name>` freezes the whole hive under a name. `/restore <name>`
makes it live again. Both tiles and behaviours travel, because they are
the same object.

## The thesis in one line

**A snapshot is one signature and a name.**

```json
{ "seal": "<64-hex>", "label": "before the redesign", "at": 1784844187161 }
```

`seal` is `sealSubtree([])` — a merkle-coherent root re-derived from live
location heads. It already names everything the participant owns:

| Thing | How it is in the seal |
|---|---|
| Tiles | the `children` walk |
| Behaviours | `decorations` is an ordinary layer slot — inside the layer signature, no metadata escape hatch |
| Notes, properties, website pages, tutor decks | ordinary slots, same story |

So there is nothing to "also capture." One walk, one sig.

## Why the seal, and not the root bag's head

The eager leaf→root cascade is **retired** (`layer-committer.drone.ts`):
commits are per-page, and a parent's stored child sig is only a *hint*.
There is therefore **no standing hive root sig anywhere** — adding a tile
three levels down does not advance the root marker.

`sealSubtree` is what turns the current tree into one signature: it
recurses **by location**, resolves each child's own live bag head,
re-signs bottom-up, and pool-writes the internal nodes. It refuses
(`null`) rather than seal lossily when a child is cold — a snapshot that
cannot dereference is worse than no snapshot, so `/snapshot` heals once,
retries, then fails loud. This is the same discipline `/host` uses.

## Three things deliberately NOT in a snapshot

### 1. The installed module set (`syncSig`)

DCP's sentinel computes `syncSig` over the whole enabled bee set, and it
is tempting to record it as a "code root" beside the content root. Don't.
That is the participant's **local install state**, not a property of
their hive — folding it in couples a snapshot to one machine.

Behaviours reach the Beehaviors window regardless; the installer is the
**sandboxed delivery channel** for the code that implements them, not a
state axis. When a restored snapshot names a behaviour whose bee is
absent, the sentinel fetches it by signature, sha256-gated, exactly as
adopt already does.

Corroborating: the hive deliberately does *not* react to a DCP toggle —
`bridge.onToggleChanged` is left unset on purpose (`main.ts`), because
"toggling a feature in DCP must NOT pull or run anything in the live
session."

### 2. Feature on/off (the hidden pool)

The Beehaviors OFF switch writes a `kind:'hidden'` record into a
participant-local pool and **never removes the decoration**
(`features-viewer/feature-hidden.ts`). Hiding is a visibility **lens** —
it exists so a swarm view can be cleared of features you do not own.
Moving it into the layer would mean writing to layers that are not yours.

It belongs with viewport and clipboard: local, never in history, never in
a snapshot.

### 3. Per-tile "enabled" flags

There are none, and there should be none. **A tile is enabled iff it is
reachable from the current seal.** Restoring drops unreferenced tiles out
of the tree while their bags, markers and bytes all survive — which is
precisely what makes going back work. A parallel enable flag would be a
second source of truth that drifts from the root.

DCP already works this way: `removeTile` appends a new root that omits
the tile and retains history.

## Why a layer slot, not a pool

Undo ⇒ layer + lineage bag. A pool is where things go to be *excluded*
from history — `putPoolDoc` deletes every prior member on write, and no
pool anywhere carries a cursor. Snapshots must be undoable, must travel
on adoption, and must sit inside the merkle. That is a slot.

(A `sign('snapshots')` pool would additionally need a colon in its
meaning to avoid colliding with a root tile named `snapshots`.)

The slot lives on the **root layer** — the list is a property of the
hive, not of any tile. Appending is a normal commit, so one gesture is
one marker.

**Benign recursion:** appending snapshot N changes the root layer, so
snapshot N+1's seal covers snapshot N. That is correct — the chain of
snapshots is itself history.

## The index is monotonic

One asymmetry, deliberate:

- **Undo** of a snapshot commit drops it from the list. It is an ordinary
  marker; of course it does.
- **Restore** carries the live `snapshots` slot *forward* instead of
  reverting it to whatever the seal held.

Without this, restoring to an early point would erase every later restore
point and make restore a one-way door. The list is your map of history;
history must not eat the map.

## Restore

`promoteToHead` → `commitLayer` at every location in the sealed tree,
recursing **by location** (the same addressing the seal used on the way
out). Locations whose head already matches cost nothing — `commitLayer`
dedups byte-identical content without writing a marker.

Two safeties:

1. **A restore point is taken first, automatically.** Restore appends
   markers at many locations, so per-location undo is a poor way back.
   Snapshotting first makes the way back the same gesture.
2. **Nothing is deleted.** History stays linear and append-only.

## The backup leg

Continuous, and already existed before this feature:

```
commitLayer / putResource
  → EffectBus 'content:wrote'
  → PushQueueService  (sign('push') queue, crash-safe on OPFS)
  → SentinelBridge.intake
  → DCP #handleIntake  (sha256 re-verify)
  → sign('from-hypercomb')/sign(kind)/  + index.jsonl
  → receipt in sign('receipts')
```

`/snapshot` adds two things:

- **Closure push.** The seal's re-signed *internal* nodes are pool-writes
  with no `content:wrote` echo, so they would dangle in the backup. The
  queen walks the sealed closure and enqueues them explicitly, then waits
  (bounded) for receipts. Enqueue happens whether or not an installer is
  reachable — the queue is on OPFS, so an offline snapshot uploads itself
  later. Only the *wait* is skipped when no bridge exists.
- **A named pointer.** `save-branch` with a `sealSig` records the seal in
  DCP's own `hive` lineage — deliberately NOT `home`, which freezes the
  logical *install* root. Two different kinds of "current"; conflating
  them would make "restore" ambiguous. Pointer only; the bytes came up
  through the queue.

## Verification

Exercised on the dev shell against a real hive:

- seal dereferences into the full nested tree; bytes present in the pool
- adding a decoration on a nested tile **changes the hive seal** (the
  tiles-and-behaviours claim, measured not asserted)
- one root marker per snapshot; prior markers hold one fewer
- restore reverts tiles *and* behaviours; dropped tiles keep their bags
- restore round-trips: restoring the auto restore point brings both back
- the snapshot index grows across restores, never shrinks

`hive-snapshot-lineage.spec.ts` freezes the DCP storage contract: hive
snapshots stay out of the install history, a snapshot is a pointer (no
closure required), auto-naming, non-signature seals refused, idempotent
re-snapshot.

**Not yet verified:** the cross-origin round trip
(`bridge.saveBranch(label, seal)` → sentinel iframe → `saveHiveSnapshot`).
It needs the web shell and DCP running together with a built essentials,
which the dev shell cannot exercise.

## Files

| File | Role |
|---|---|
| `hypercomb-essentials/src/diamondcoreprocessor.com/history/snapshots-slot.ts` | slot registration, `SnapshotRecord`, `readSnapshots`, `findSnapshot` |
| `hypercomb-essentials/src/diamondcoreprocessor.com/commands/snapshot.queen.ts` | `/snapshot` — seal, push closure, record, commit, name in DCP |
| `hypercomb-essentials/src/diamondcoreprocessor.com/commands/restore.queen.ts` | `/restore` — confirm, auto restore point, apply seal, repaint |
| `diamond-core-processor/src/app/core/dcp-domain-storage.service.ts` | `HIVE_LINEAGE`, `saveHiveSnapshot`, `loadHiveSnapshots` |
| `diamond-core-processor/src/app/sentinel/sentinel-handler.ts` | `save-branch` routes on `sealSig` |
| `hypercomb-web/src/setup/sentinel-bridge.ts` | `saveBranch(name, sealSig?)` |
