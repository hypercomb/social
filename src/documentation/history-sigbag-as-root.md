# History sigbag as root — store, discovery, self-heal, and integrity

> Status: design-affirmed 2026-06-05 (session conclusions). Not yet built —
> see "Buildables" at the end. This doc unifies and in one place supersedes
> parts of `domain-as-identity` and refines `history-is-the-deploy`,
> `universal-history-plan`, `merkle-layer-model`, and `uniform-paradigm`.

## Thesis in one line

**No organization outside the layer; a dumb `put`/`get` store under it; and
the history sigbag's *max marker* IS the current root.** Discovery,
durability, self-heal, and attestation all *fall out* of that — none is a
separate mechanism.

---

## 1. The minimal substrate

Two operations, content-addressed, no logic, no opinions:

```
put(bytes) -> sig          sig = sha256(bytes)
get(sig)   -> bytes
```

- **The layer carries the organization.** A layer's `children[]` sigs *are*
  the hierarchy — walk from a layer and the tree unfolds. There is no
  external index, no `manifest.json`, no folders-as-meaning. The structure
  lives in the content; `get` resolves it.
- **The only thing outside the layer is the entry pointer** — "start here /
  this is current." And even that is not a separate structure: it is the
  sigbag max (§2). You can't reach zero — something must say where to begin —
  but it is a *value you already store*, not an organization layer.

Everything below is a consequence of these two operations plus
self-organizing layers.

---

## 2. The sigbag IS the root (skip `__roots__`)

Every lineage keeps a linear, append-only **sigbag** — a folder of `000x`
markers. There is **no `__history__` folder** (and no `__roots__`): history is
not a separate place, it *is* what a sigbag is, and the sigbags sit at the
root directly.

```
root/
  <lineage>/0000
  <lineage>/0001
  <lineage>/000x   <- max-x = HEAD = current root
  ...
```

Each marker is a tiny record `{ layer: <sig>, ... }` pointing at the layer
version that was current at that step. **The marker at max-x is the current
root.** The entrance is just "the highest marker in the bag."

So one structure does **three jobs**:

| Job | Served by |
|---|---|
| **History** (undo/redo, time-travel) | the full `0000..000x` sequence |
| **Current root / entrance** | `max(x)` of that sequence |
| **Attestation** ("this is mine, this is current") | the max marker arrived via *your* write-auth (signed PUT) → it *is* your signed assertion |

This is consistent with the linear-append-only history model
(`history-branch-transaction`): scrub-back is view-only, "Make HEAD" appends a
new max — so **max is the current root by construction.** Advancing the
history *is* advancing the pointer; there is nothing separate to keep in sync.

**Consequences:**
- **`__roots__` as a separate attestation/pointer pool is retired** — the
  sigbag already holds the current-root pointer (its max) and the attestation
  (the write-auth'd max marker). See §10 for the reconciliation.
- **No `__history__` folder either** — history is not a separate place or
  feature; it *is* what a sigbag is (the `000x` sequence). The per-lineage
  sigbags at the root carry it intrinsically, so there is nothing extra to
  store, name, or replicate for "history."
- **`manifest.json` for discovery is retired** — the package's entrance is
  *its* sigbag max too, not a hand-maintained list.

---

## 3. Per-lineage roots; fractal; cascade cost = depth

"Root" is not a hive-level concept — **every lineage has its own root** (its
own sigbag, max = its current version). This is the `uniform-paradigm` made
concrete: every node has its own revision keyed by context + position.

A change is a cascade expressed in these terms: edit a node at depth N, and
lineage-pull walks it up — new node version → parent re-references it → new
parent version → … → root. **Each lineage on that spine gets exactly one new
marker — its new max.**

> **markers (new roots) per change = path depth = segment count.**
> One marker *per lineage*; segment-count *lineages*.

This reconciles `one-layer-per-change` with the cascade: it is one marker
*per lineage* (a multi-tile edit at one spot is still one marker *there*, not
one per tile), and the number of lineages that get one is the path depth.

- Edit deep → many segments → many maxes advance. Edit near the root → few.
- **Only the spine** — siblings untouched — so **cost scales with depth, not
  tree size.** A change ripples up its own path to the root and stops.
- The structure is fractal: `{ content pool + sigbag, max = root }` repeats
  identically at every node. The hive root is just the top lineage's max;
  every node beneath has the same shape. "Max is the root" holds at **every**
  level.

---

## 4. The 2D grid: structure × time, bidirectional

History is a **2D grid** you can enter from any cell:

- **Structure axis (down)** — `children[]` sigs, root → sub-node, the Merkle
  walk. Falls out of content-addressing.
- **Time axis (up/across)** — the global time clock, sub-node + T → the root
  current at T. Falls out of timestamping the markers you already keep.

**Why time is the back-link (and a pointer can't be):** content-addressing
*forbids* parent-pointers. A parent's sig is a hash *of* its children, so a
child naming its parent is circular — a sub-node structurally cannot store a
reference to its owner. So "up" cannot be a stored pointer.

**The mechanism:** a change is one atomic cascade — it stamps the sub-node's
new marker *and* the root it cascades to with the **same time T** (one commit,
one stamp). They are joined by a shared timestamp *exactly*, not
approximately. So:

> Rewind a sub-node to a marker, read its time, look up the root marker at
> that time → that's the **owning root**. The up-direction is a *time query*,
> not a stored reference.

**What it unlocks:** cross-hierarchy debugging ("this node was wrong at T —
what did the *entire tree* look like then?" → root at T → walk down),
provenance ("which change introduced this version?" → the root sharing its
stamp), and enter-from-any-cell reconstruction. This is the
`universal-history-plan`'s "global time clock for cross-hierarchy debugging"
realized. It is a pure **read/query over local data** — zero added wire cost.

---

## 5. Two-zone integrity

There are two storage zones with two *different* trust models. Conflating them
is a bug.

### Zone A — content (sig-named pool): safe by hash

- **Contract:** a file exists under `<sig>` only if `sha256(bytes) == sig`.
- **The save contract:** at save time, `sig = sign(the actual bytes being
  written)` — the *same buffer* that goes to the file, never an in-memory
  object or a re-serialized form. This kills the one real content-addressing
  footgun: signing one form and writing another. (`commitLayer` /
  `putResource` do exactly this: encode → sign *those* bytes → write *those*
  bytes.)
- **Where verification lives:** at the **edges only** —
  - *derive at save* (local authoring computes the sig from the bytes), and
  - *verify at ingress* (external bytes that *claim* a sig: the broker's
    `#verifyBytes`/`sha256Hex`, the SW host-fallback `sha256Hex`, the relay
    PUT check).
- **No read-side checks.** Once stored, the bytes are valid by construction.
  Re-hashing on the read/render/expand path is a **redundant bug** — it
  distrusts a store the contract already guarantees, and costs a hash on the
  hot path. **Verify once at the edge; trust the interior forever**
  (immutability makes one check eternal).

> **Audit (2026-06-05):** the client interior is clean. Verification appears
> *only* at save (`store.ts` `SignatureService.sign`) and ingress (broker
> `#verifyBytes`/`sha256Hex`, SW host-fallback `sha256Hex`). `show-cell`, the
> preloader, the store read path, and the SW OPFS-serve path have **zero**
> verify. One cosmetic finding: `dependency-loader#verifyAndImport` does not
> actually verify (it just `import()`s) — rename to `#import` so the name
> stops claiming a check it (correctly) doesn't perform.

### Zone B — metadata (`000x` sigbag, position-named): safe by ownership

- The sigbag markers are **position-named**, not sig-named. Their name is the
  sequence index, not a hash — so there is **nothing to verify against**.
  They are **not sig-verified, by design.**
- **Trust = ownership.** Locally it's just *your own disk* — trusted because
  it's yours. On a host, the gate is **write-authorization** (your signing
  key / the NIP-98 PUT): "only I can write to my `__history__`." Safe because
  it's *mine*, not because a hash matches.
- **The marker is the bridge between the zones:** a positional, owned record
  whose `layer` field points *into* the content-verified pool. The pointer is
  yours-by-authorization; the target is valid-by-hash.

---

## 6. Replication: byte-faithful, all surfaces

The copy is of **bytes**, never of **objects** — because **the shape is what
the sig hashes.** The canonicalizer fixes the exact byte form once at save
(byte-equal content → byte-equal JSON); after that, reshaping by even one byte
(re-serialization, reordered key, different whitespace) yields a *different*
sig and breaks every reference.

- **Rule:** read the stored file, write the identical file — no decode/encode
  round-trip, *nothing re-serialized en route.* "Copy, don't recompute."
- **True for every surface:** `__layers__`, `__bees__`, `__dependencies__`,
  `__resources__` (sig-named, by-hash pools) and the per-lineage sigbags
  (position-named `000x` bags at the root).
- **Two trust gates on ingress:** content verified by hash; sigbags accepted
  by write-auth (no content check — there's no sig name to check).

---

## 7. Discovery and self-heal via entrances

**Root layer sigs are graph entrances**, and the set of entrances = the set of
sigbag maxes (one per lineage). The self-heal flows from them:

```
entrance (sigbag max) -> walk the closure (via children[] sigs)
                      -> for each missing sig, re-fetch (federation / build)
                      -> re-acquired
```

- **The content dump MUST carry the entrances**, or it doesn't solve the
  problem: a bag of sigs without an entrance is *unreachable* — no entry to
  walk from, nothing to heal toward. So the meta to replicate is **the
  sigbags**, and the entrance is `max(sigbag)`.
- **"Heal what it can"** is the honest bound: **heal coverage == entrance
  coverage.** Have a graph's root sig → walk and re-acquire it. Missing it →
  its bytes may sit in the pool but are dead weight (unwalkable).
- The **top lineage's max** walks the *entire current tree* — the cascade
  guarantees it references every current child sig, so walking down (via the
  layers' `children[]`, not the sigbags) resolves the whole closure. The
  per-lineage sigbags below are for **per-node history**, not current-state
  heal.

---

## 8. The host is a disposable replica; publish = dump + advance pointer

**The host content dir is a content-addressed cache, not the source.** Purging
it (e.g. clearing jwize.com) is non-destructive — it re-heals, provided the
content exists somewhere durable:

- **re-dump** — the next build → `copy-to-dcp` re-populates the deltas;
- **re-push** — `HostSync` re-syncs authored content;
- **client fallback** — a client hitting a purged sig has its broker fall back
  to other hosts / community / mesh, re-fetch, and write-through.

The *only* non-healable case is **local-only, never-shared** content — which
is exactly why sharing/replication is the durability story.

**Relay self-heal (today vs. could-be):** `relay.js` is currently a dumb HTTP
file server (404 on miss, no auto-fetch) plus the Nostr transport. The
federation ask-and-resolve flow (broadcast "I need sig X" → peers reply with
`{ bytes, domains }` → HTTP-fetch) lives in the **client broker**
(`ContentBrokerDrone.fetchBySig`), *not* the relay. So today a missing sig is
healed by the *client routing around* the relay's 404 — the relay itself stays
empty. The relay even *carries* those federation asks (it's the transport) but
doesn't ask *for itself*. **Relay self-heal = port the broker's fetch-on-miss
into `relay.js`** — "the host-client handles both," the relay joining the
conversation it currently only relays.

**Publish = dump + advance the pointer; build ≠ publish.**
- **Dump** (wired): `copy-to-dcp` → `hypercomb-relay/content/` (additive,
  deduped — only deltas). Makes bytes *servable*.
- **Advance the pointer** (the gap): push the per-lineage sigbag so its max
  becomes the host's current root. Makes it *discoverable*.
- Build *locally* without dumping; **publish deliberately** as a one-time
  step. Don't auto-dump every dev build into a shared/live root. The root
  accumulates *published versions* (deduped deltas), old versions go dormant;
  reclamation is a deliberate mark-sweep GC over active roots, **never** a
  build-time side effect.

---

## 9. Flood-smart networking

The mesh is a **thin signal layer — tiny sigs only**; everything heavy is
pull-based, on-demand, deduped, and coalesced. (This is the lightweight-mesh
protocol: layer-sigs on the mesh, bytes over HTTP.)

| Risk | Antidote |
|---|---|
| Cascade announces N markers per change | **Announce the root, not the cascade** — one sig per change; subscribers walk down and pull what they lack |
| Rapid edits each broadcast | **Coalesce/debounce** to the latest root after a quiet beat (like `synchronize` coalescing a frame) |
| Pushing content to all peers | **Pull, don't push** — sig on the mesh, bytes over HTTP, only to whoever wants them |
| Re-broadcasting the same need | **Dedupe + cancel + silent-when-stale** — one need, shared responses, cancel when satisfied, only holders reply |
| Eager closure prefetch after a purge | **Heal lazily** — fetch-on-miss, on actual request, not an eager burst |
| Broadcasting to the whole swarm | **Scope to interest** — announce to subscribers; replication follows interest |

**Local cascade-cost ≠ network cost.** A deep change is segment-count *local*
writes but exactly **one** announce on the wire. Holding that gap wide is the
whole game.

---

## 10. Reconciliation with existing doctrine

| Entry | Relationship |
|---|---|
| `domain-as-identity` ("Host filesystem layout: five flat pools + a discovery index", `__roots__/<domain>/<sig>` attestations) | **Superseded in part.** The separate `__roots__` attestation pool collapses into the per-lineage sigbags — there is no `__roots__` *and* no `__history__` folder; a sigbag's max marker *is* the current root + entrance + attestation (write-auth'd). Per-domain **multi-tenancy** and **discovery-by-listing** are just listing the root's sigbags. GC-is-opt-in and the flat by-hash content pools are **unchanged**. |
| `domain-as-identity` §"Trust root: domain↔key binding" (`__keys__`, §21.13) | **Unchanged.** Identity verification (domain-published key over TLS) is orthogonal to content/metadata storage. The write-auth that gates a sigbag PUT *uses* this binding. |
| `history-is-the-deploy` | **Unified.** The history bag IS the sigbag; max seq = HEAD = current root. This doc adds: the max is also the *entrance* and the *attestation*, so there is no separate `__roots__`. |
| `merkle-layer-model`, `uniform-paradigm`, `one-layer-per-change` | **Refined.** Per-lineage roots, fractal; one marker per *affected lineage*; segment-count lineages per change. |
| `universal-history-plan` | **Realized.** The global time clock is the 2D-grid back-link (sub-node + T → owning root). |
| `flat-layer-pool`, `resource-streaming-migration`, `public-navigation-lineage-filter`, `host-sync-receipts` | **Consistent.** Flat sig pools; OPFS-as-cache with host fallback; mesh-is-layer-sigs-only; one-way push with receipts. |

---

## Buildables (none done yet)

1. **Replicate the root's sigbags to the host** — push the entrances so
   durability, discovery, and self-heal actually work. Add the per-lineage
   `000x` sigbags to the replication set (HostSync push and/or `copy-to-dcp`),
   byte-faithful, write-auth-gated. (No `__history__` folder — the sigbags at
   the root *are* the histories.) *This is the keystone.*
2. **Relay fetch-on-miss** — port `ContentBrokerDrone.fetchBySig` into
   `relay.js` so the host pulls missing sigs from the federation on demand.
3. **`dependency-loader#verifyAndImport` → `#import`** — cosmetic rename from
   the integrity audit (it doesn't verify, and correctly shouldn't).
4. **Retire `manifest.json` for discovery** — lean on the sigbag max
   (`copy-to-dcp` still copies the manifest today).
