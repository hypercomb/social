# Visuals Across Lineages — Design

> **status: DESIGN (2026-08-14).** Supersedes the storage sections of
> `visuals-pool-of-meaning-plan.md` (already self-marked SUPERSEDED — its
> per-lineage-sigbag "Index" predates catch-all + `sign(meaning)` resolution;
> only its render-hook detail and field projection survive). This doc is the
> current answer to "one visuals set wipes the previous lineage's image."
> Doctrine anchors: `superimposition.md`, `optimize-phase.md`,
> `signature-system.md`, `known-location-pools.md`.

## The problem

Two lineages occupy the same address — the superimposition doctrine *requires*
this (platform twins, ports, translations, a peer's version of your tile all
share coordinates; the pheromone/publisher is the only discriminator). But the
moment a second lineage lands at an address, its image displaces the first
lineage's image everywhere the renderer looks. One visuals set, last writer
wins.

The instinctive fix — split the pools per lineage (per-lineage pictures,
per-lineage optimizations, per-lineage collections) — is the wrong cut, for
reasons below. The wipe is not in the pools. It is in the **location-keyed
indexes**, and the cure is the law the optimize phase already states:

> **Never key derived visual data by name, path, or position — only by source
> signature.** A location-keyed slot can be overwritten; a signature-keyed
> record cannot even collide.

## Where imagery lives — three tiers

### Tier 1 — truth (collision-proof, leave alone)

A tile's picture is a sig in the layer's `properties` slot; the bytes are a
sig-named file in the flat content pool. Two lineages holding "the same" tile
are two different layers → two different props sigs → two images that both
exist forever. The sig-keyed derived pools inherit the same immunity:

| Surface | Key | Collision possible? |
|---|---|---|
| content pool (flat root sig files) | content sig | no — same bytes dedupe, different bytes differ |
| `sign('manifests')` children packs | **parent layer sig** (`manifest-optimizer.drone.ts`) | no — a different lineage's parent is a different layer sig |
| `sign('visual-optimization')` resized forms | **source image sig** (`store.ts` `VISUAL_OPTIMIZATION_MEANING`) | no |

Nothing at this tier needs splitting, and splitting it would cost the dedup
that is the whole point of the flat pool.

### Tier 2 — the head (single by design)

A location's lineage sigbag holds one max marker = one current layer. Adopt
in `sync` mode flips the head — the address now *resolves* to the newcomer,
image included. That is the intended "adopt means get the latest" semantic.
The design question at this tier is not "how do we stop the flip" but "how
does an address hold **several heads at once**" — see the stack section.

### Tier 3 — the location-keyed indexes (the actual wipe)

- **`hc:tile-props-index`** (localStorage): a flat map `locationSig →
  propsSig`. Show-cell's render path AND the substrate's blank-detection read
  **only this index** (`swarm-adopt.drone.ts` §"Seed the participant-local
  props index"). One slot per address. Adopt-sync overwrites it so "the
  publisher's refreshed image wins"; fold fills-if-empty; the substrate writes
  its own picks into it. The entire fill-if-empty / sync-overwrite /
  skip-occupied dance in `#doCommitBranch` exists *because* the index has one
  slot — including the historical "image recycled to a random one on adopt"
  bug it defends against.
- **Per-label render caches** (`cellImageCache`, `cellBorderColorCache`,
  `cellLinkCache`, `cellHideTextCache`, `cellSubstrateCache`,
  `registryImageByLabel` in show-cell): keyed by label. The same single-slot
  shape. The participant stack already hit this once — `tile-source-registry`
  unioned peer entries by `(kind, name)` and threw the second publisher away;
  the fix was to key on the publisher too. That fix must generalize.

**Every wipe surface is location/label-keyed. No sig-keyed surface has ever
wiped anything.** That symmetry is the entire diagnosis.

## The design

Four moves. Pools stay singular and shared throughout.

### 1. Re-key the props index by layer sig

`hc:tile-props-index` becomes `layerSig → propsSig` — a pure derived cache of
`layer.properties[0]`, keyed by its source. Properties of this shape:

- **Wipe-proof.** Two lineages at one address are two layer sigs — two
  entries, zero contention. The adopt seed-dance collapses to an
  unconditional write (idempotent: same layer, same entry).
- **Auto-invalidating.** An edited tile is a new layer sig with no entry; the
  stale entry is simply never consulted again. No update path, only
  derive-on-miss — the manifest pool's exact contract.
- **Doctrine-conformant.** Satisfies the optimize-phase key law; the
  location-keyed index was a pre-law survivor.

Read path: the renderer already resolves location → current layer (sigbag
max) before painting; it looks up props by that layer's sig instead of by the
location. One extra hop that the resolution already performs.

Migration: additive. New writes land layer-keyed; reads try layer-key first,
fall back to the legacy location-key, and re-mint the layer-keyed entry on a
legacy hit (self-draining, same pattern as every legacy `__x__` drain). No
flag day.

### 2. The address holds a stack, not a slot

The participant stack (`tile-stack.ts`, `Map<label, StackVariant[]>`) already
proves the model in memory: one hexagon with depth, your head at index 0,
variants keyed by publisher, wheel rolls layers, spotlight surfaces a whole
participant layer at once. What is missing is the same shape at the
**resolution** level:

- An address resolves to a **set of heads** — yours plus one per
  superimposed lineage — not to one layer.
- **Which head paints is a view decision** (spotlight / roll / pheromone
  filter / participant filter), never a storage overwrite.
- An incoming lineage lands as **another head at the address**. It replaces
  *your* head only on the explicit sync gesture ("adopt means get the
  latest" keeps its meaning as an act, not as a side effect of arrival).

With move 1 in place, each head carries its own visuals for free: head →
layer sig → props sig → image. "Separate pictures per lineage" is not a new
storage system — it is what the lineage sigbags already encode, read through
instead of around.

### 3. Per-label caches key on (label, lineage)

`cellImageCache` and siblings adopt the participant-stack fix: composite key
`(label, publisher-or-lineage)`, your own lineage as the empty discriminator
so the single-lineage path pays nothing. This is a mechanical re-key, not a
redesign.

### 4. Substrate picks become decorations, not index writes

The substrate today "heals" a blank tile by writing a random pool image
**into the props index** — which is how it once permanently displaced a
publisher's real image. Under this design the substrate must not write the
index at all: its pick lands as a decoration/property on **your** layer (a
normal commit, content-addressed, undoable, shared like any slot value), and
peer/witnessed heads are simply outside its jurisdiction. The index is then
written by exactly one kind of author: the derive-on-miss read path.

## The image-pool idea (multiple candidate images)

The historical idea — a tile choosing its image from a pool of candidates —
needs **no separate byte store** under this design. Candidate layers live in
the fixed-name hybrid root pool as `canonical:variant` records; every image
inside them remains an ordinary content signature. An optional materialized
list on a selected layer is only a projection/cache of that truth:

```
properties → { image: <chosenSig>, imagePool: [<sig>, <sig>, …] }
```

- Candidate membership rides the fixed-name root pool (merkle-shared and
  content-addressed). Choosing = a normal root property edit = a new layer sig,
  so the participant's choice history is the root lineage itself.
- The background-themes rule generalizes: a *theme* is a group of pictures; a
  forced pick never touches custom images. Same shape here — the substrate
  may propose from `imagePool`, never overwrite an explicit `image`.
- Because visuals resolve per layer sig (move 1), every lineage in a stack
  can hold a different chosen image from the *same shared candidate pool* —
  the candidates dedupe in the content pool; only the choice differs.

What is **not** needed: a per-lineage picture pool, a second candidates
registry, or any new pool of meaning. The fixed name is already the candidate
pool home; the flat content pool remains the home of the bytes.

## Why not per-lineage pools

- **Dedup dies.** The same image adopted in two lineages would store twice;
  the flat content pool exists to prevent exactly that.
- **Unbounded pool minting.** Pools of meaning are a small, colon-named,
  registry-known vocabulary. One pool per lineage keys pools by *identity*,
  reopening the census problem the pool registry closed.
- **Wrong tier.** It partitions storage to fix a collision that only exists
  in mutable location-keyed slots. Content-addressed records cannot collide,
  so there is nothing in the pools to protect.

The sound half of the instinct — "lineages already live in their own
signature pools, so they can have their own visuals" — is real, and it is
satisfied by reading through the lineage's own layers (moves 1–2) rather
than by copying storage per lineage.

## Where pheromones sit

No behaviour attaches *by* pheromone today: view behaviours bind by
decoration kind (`visual:*`, via `VisualBeeRegistry`), and behaviour-to-tile
ownership is signature-based. Pheromones gate and discriminate — the
`/requires = @name` bouquet gate, the web/windows platform filter, bouquet
visibility. This division is load-bearing for the stack: **the pheromone
picks which lineage's layer surfaces at an address; everything downstream
(image, decoration kinds, attached behaviours) resolves from that layer's
sigs.** One discriminator at the top, content-addressing below it, no
per-lineage copies of anything.

## Build order

- **Phase A — re-key the props index** (move 1, with the legacy-fallback
  drain). Smallest change, removes the wipe for the single-lineage +
  adopt-sync case. **Built 2026-08-14**: `warmHeadSigFor` (HistoryService,
  warm-cache-only head-sig accessor), `seedLayerKeyedTileProps` +
  central seed in `writeTilePropertiesAt` (tile-properties.ts),
  layer-first `propsSigForLabel` + canonical re-mint in show-cell,
  unconditional layer seeds in swarm-adopt and format-painter (the one
  index-only writer). The location-keyed seed-dance is NOT yet deleted —
  the substrate still reads location keys, so its fill-if-empty/sync
  cases stay until Phase B moves the substrate off the index; only then
  can the location seeds go.
- **Phase B — substrate write-path move** (move 4). Closes the last
  non-derive author of the index. **Built 2026-08-15**: every substrate
  pick is a CANONICAL COMMIT (`#commitDefault`; `#rollOne` is the shared
  reroll/restyle skeleton; clears strip the layer), gated on canonical
  ownership with cold ⇒ conservative; format-painter commits its diff
  canonically (paints are now undoable and survive heals); show-cell is
  fully derive-on-miss (a total miss asks canonical post-batch, seeds the
  layer key, repaints — `#propslessHeads` memoises concluded absence by
  head sig); the adopt seed-dance IS deleted (layer seeds only). The
  index's remaining writers are all one kind — derivations of canonical
  (central seed, paint derive, reconciler heal) — plus deletions as
  drain. Location entries persist only as read-fallback for the
  reconciler-pending legacy population; the scattered location writers
  left (clipboard, move, website-archive, youtube, resource-attach,
  tile-editor, image-choice — all canonical-paired or new-head) sweep in
  Phase C.
- **Phase C — stack heads at resolution** (move 2) + cache re-key (move 3).
  The superimposition payoff: several lineages coexist at an address, each
  with its own visuals, filter/roll/spotlight choosing what paints.
  **Built 2026-08-16.** Move 2's substance already existed (the
  participant stack + fold-vs-sync semantics: an arriving lineage stacks,
  only the explicit sync gesture replaces your head); what Phase C added:
  (a) the WRITER SWEEP — all eight remaining location writers (tile-editor,
  resource-attach, image-choice, youtube queue, bridge stamp, clipboard
  paste, move, website-archive) now ride the central seed or seed
  layer-keyed directly (`seedLayerKeyedEntries` — subtree walkers hold the
  head sigs in hand, so `index[sig] = properties[0]` needs no location
  signing at all); NO code path writes a location-keyed entry anymore —
  the legacy population is read-fallback only, drained by the reconciler
  and the deletion sites. (b) Move 3 as PROVENANCE, not composite keys:
  the render's per-label caches keep their label keys but every
  lineage-source transition is guarded — the peer path was already
  source-guarded (`peerImageSourceByLabel`), and the one unguarded
  transition (a label LEAVING the variant set: spotlight dismissed,
  publisher departed, filter changed) now drops its image derivation at
  the single recompute all paths funnel through. Composite keys stay
  available as the escalation if a future surface needs simultaneous
  multi-lineage paint of one label.
- **Phase D — candidate pools. Partially built 2026-08-26.** The canonical
  reference service retains every imported same-name layer as a
  `canonical:variant` member of the fixed-name root pool. The Image Hive probes
  peer variants at the canonical root (not the current lineage), shows distinct
  images with publisher provenance, and writes an explicit pick to the
  participant root default. A materialized `imagePool` array remains optional;
  it is not the source of truth.

## Guardrails

- No new pool of meaning is minted by this design. The already-required
  fixed-name root is a deliberate hybrid bag/pool: history markers choose its
  head and signature-keyed candidate members retain its alternatives.
- No derived record keyed by name/path/position — layer sig or content sig
  only. The legacy location-keyed index is a read-fallback that drains; no
  new writes target it.
- The stack never re-indexes your slot (participant-stack law: peerIndex is
  not adopted for a name you also hold).
- Adopt stays complete-or-defer; nothing here weakens the truncated-commit
  and cold-sibling guards in `#doCommitBranch`.
- The substrate never writes the props index and never touches a peer or
  witnessed head.
