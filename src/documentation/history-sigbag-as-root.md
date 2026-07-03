# History sigbag as root — store, discovery, self-heal, and integrity

> **status: design — not built (as of 2026-06-18).** The flat-root,
> no-`__history__` sigbag layout described here is the design target;
> durability, discovery, and self-heal "fall out" of it once built.

> Status: design-affirmed 2026-06-05 (session conclusions). Not yet built —
> see "Buildables" at the end. This doc unifies and in one place supersedes
> parts of `domain-as-identity` and refines `history-is-the-deploy`,
> `universal-history-plan`, `merkle-layer-model`, and `uniform-paradigm`.
>
> **What the current build does instead (as of 2026-06-18):** history lives
> in per-lineage bags at `__history__/<lineageSig>/` whose markers (`{ layer:
> <sig> }` pointers) reference layer bytes in a flat `__layers__/<sig>` pool.
> The `00000000` marker is an auto-minted **empty** `{ name }` layer. "What's
> here now" reads the head layer's slots (`currentLayerAt` → `getLayerBySig`,
> children from the `children[]` slot) — **not** op-replay from zero. The
> flat-root collapse below (no `__history__`, sigbags at the root) is the
> direction, not today's on-disk shape. These are **Distributed Network
> Artifacts** (the merkle-versioned, content-addressed assets — layers, deps,
> bees, resources, content; see `dna.md`); the genetic vocabulary in this doc
> is documentation-only and rides the existing `kind` discriminant, never a
> `dna` field or service.

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

## 1a. The DNA ladder (documentation-only framing)

These artifacts are **Distributed Network Artifacts** — the content-addressed,
merkle-versioned assets that compose the hive (layers, dependencies, bees,
resources, content; canonical page: `dna.md`). The substrate above is exactly
the genetic-ladder picture, and this doc is the prime anchor for its rungs:

- **nucleotide = the signature.** The single immutable letter. `sig =
  sha256(bytes)`; the address *is* the content. Every other rung is built only
  from sigs — the signature is the only universal primitive.
- **bond = a `children[]` reference.** A sig sitting in a parent's slot pairs
  parent to child. Following bonds *down* unfolds the structure (§1); the
  bonds, not any external index, *are* the hierarchy.
- **gene = a layer.** A closed unit of bonds — one node's canonical slots
  (`children[]`, `properties`, …). Re-sign a gene's bytes and you get a new
  gene; the old one stays valid forever (immutability).
- **chromosome / heredity = the lineage (sigbag).** The append-only `000x`
  marker chain is the line of descent for one position: each new max is the
  next generation, the prior maxes its ancestry (§2–§3).
- **genome = the recursive merkle root over a subtree** — every gene's sig
  rolled up via the `children[]` cascade (parent = f(child sigs)) so a mutation
  at depth N re-signs its spine to the root (§3). The *concept* is live (the
  cascade is real); the named `GenomeService` / `genome()` hash / `?:`-tag
  query engine are **design-only** (they live in dead `hypercomb-legacy`).
  Tags today live in the cell's `0000` properties file (`tag-registry.ts`).

> **Strictly vocabulary.** There is no `dna` field, no `DnaService`, and no new
> OPFS folder. The genetic ladder is a *reading* of the existing
> signature-and-`kind` substrate, nothing more — DNA rides the existing `kind`
> discriminant. (Not to be confused with the **trail capsule** — the renamed
> 1-byte navigation/route stream, once mislabeled "DNA"; see
> `trail-capsule.md`. That is a route, not an artifact.)

---

## 2. The sigbag IS the root (skip `__roots__`)

Every lineage keeps a linear, append-only **sigbag** — a folder of `000x`
markers. In the **design target**, there is **no `__history__` folder** (and
no `__roots__`): history is not a separate place, it *is* what a sigbag is, and
the sigbags sit at the root directly.

> **Current build vs. target (as of 2026-06-18):** today the bags live under
> `__history__/<lineageSig>/` and the layer bytes a marker points at live in a
> flat `__layers__/<sig>` pool — the marker is a `{ layer: <sig> }` pointer,
> not the layer itself. The flat-root collapse (sigbags at the root, no
> `__history__`) is the direction this doc argues for; the markers'
> position-named, append-only semantics already hold.

```
root/                          # design target (not built)
  <lineage>/0000
  <lineage>/0001
  <lineage>/000x   <- max-x = HEAD = current root
  ...

# current build
__history__/<lineageSig>/00000000   # auto-minted EMPTY { name } layer
__history__/<lineageSig>/000000xx   # { layer: <sig> } pointers
__layers__/<sig>                    # the layer bytes the markers point at
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
    `#verifyBytes`/`sha256Hex` in `content-broker.drone.ts`, the host-fallback
    resolve through `Store.#fetchResourceFromHost` → broker `#fetchOverHttp`
    (sha256-verified, write-through), and the relay PUT check).
- **No read-side checks.** Once stored, the bytes are valid by construction.
  Re-hashing on the read/render/expand path is a **redundant bug** — it
  distrusts a store the contract already guarantees, and costs a hash on the
  hot path. **Verify once at the edge; trust the interior forever**
  (immutability makes one check eternal).

> **Audit (2026-06-05):** the client interior is clean. Verification appears
> *only* at save (`store.ts` `SignatureService.sign`) and ingress — the
> broker's `#verifyBytes`/`sha256Hex` in `content-broker.drone.ts`, reached on
> a cold miss via `Store.#fetchResourceFromHost` → broker `#fetchOverHttp`
> (the HTTP-direct `GET /<sig>` resolve), plus the relay PUT check. `show-cell`,
> the preloader, the store read path, and the OPFS-serve path have **zero**
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

### Strict at the folder level — every folder is signature-addressed; the two kinds are meaning-pool and location-protocol

The rule is **strict and absolute: no folder may exist that isn't
signature-addressed.** No label/underscore folders, no typed dirs, no
exceptions — that's the PERIOD (`sign-meaning-pool-migration-plan`,
`visuals-pool-of-meaning-plan`, `tag-pools`). What is *not* strict is reading
"signature folder" as "dedup pool." A signature folder comes in **two kinds**,
and only one of them is a meaning-pool:

| | **Meaning-pool (WHAT)** | **Location-protocol (WHERE)** |
|---|---|---|
| Folder addressed by | `sign(meaning)` — a hash | `sign(path)` / lineage — a hash |
| Members named by | `sign(content)` — a hash | position / sequence index (`000x`) |
| Zone (§5) | A — content, safe-by-hash | B — sigbag marker, safe-by-ownership |
| Dedup'd? | **Yes** — same bytes, one member | **No** — positions are unique, order is load-bearing |
| Examples | layer bytes, the `tags` target, decorations, resources, bees, deps | the `000x` markers, their order, the entry pointer |
| Role | the instruction / the thing itself | the index that says *where* and *which is current* |

**Both folders are signature folders — strictness holds.** The lineage folder
is `sign(path)`; the meaning pool is `sign(meaning)`. The difference is how the
*members inside* are named (position vs content hash) and whether they dedup —
**not** whether a non-signature folder is allowed. None ever is. A
location-protocol folder is signature-addressed *and* not a dedup pool; those
are not in tension.

Why the location folder must not be collapsed into a dedup pool — two concrete
failure modes:

- **Dedup destroys order.** Two positions with byte-identical marker contents
  are still *different positions*. Collapse them by hash and you lose the
  sequence — exactly the **positional-graveyard** trap `__temporary__` fell
  into before it was rebuilt as a real `sign(MEANING)` pool.
- **Content-addressing forbids the back-pointer.** An entrance/order cannot be
  a content hash, because a parent's sig is a hash *of* its children — a
  position naming its place would be circular (§4). The "where am I / which is
  current" question is structurally un-dedup'able; it lives as a *value you
  already store* (the sigbag max), named by position, not by hash.

**Metadata is "just instructions" — and it is readable, not private.** The
marker is a thin envelope of pointers: a positional, owned record whose every
field is a sig *into* a meaning pool (`layer`, `tags`, decorations, context,
receipts — the open `MarkerRecord` `[field: string]: unknown` shape). It
carries no shareable meaning of its own; it points *at* meaning. But "not a
dedup pool" does **not** mean opaque or local-only: **the mesh reads the
metadata.** The sigbags replicate byte-faithfully (§6), and the entrance-walk
reads them for discovery, history, and self-heal (§7) — the max marker *is* the
published current root. So the metadata travels and is consumed; it is simply
trusted **by ownership** (write-auth, §5 Zone B) and named **by position**,
rather than verified by hash and dedup'd by content.

**The tradeoffs, made explicit:**

- *Meaning-pool* → dedup, instant cache hits (hold the sig, load the blob — no
  query), immutability, free undo/time-travel/share. Cost: cannot express order
  or "current"; needs an external entry pointer; reshaping one byte breaks every
  reference (§6).
- *Location-protocol* → order, identity-by-position, an entrance, and write-auth
  ownership for free; still a signature folder, still mesh-readable and
  replicated. Cost: no dedup (each position stored once regardless of content),
  not verifiable by hash (trust = ownership, §5 Zone B) — you replicate the bag
  byte-faithfully (§6), you don't collapse it.

**Both are okay because they are not the same kind of folder** — one a
meaning-pool, one a location-protocol — but **both are signature folders.** The
sigbag is the index above the pools; an index is not the thing it indexes, yet
it lives under the same strict no-non-signature-folder rule.

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
  (position-named `000x` bags). *Replication* (adopt / install / sync /
  host-push) is byte-faithful across all of them — but **self-heal on the
  render path is not uniform** (see §7's metabolism asymmetry).
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
- **Metabolism asymmetry — surfaces share DNA but not metabolism.** The
  entrance-walk closure is an *adopt / install / sync* operation, not a
  render-time guarantee. **On the render path, only RESOURCES self-heal**:
  `Store.getResource` resolves memory → OPFS → host (via `ContentBroker`),
  sha256-verifies, writes through, and negative-caches a miss for ~60s.
  **`__layers__`, `__dependencies__`, and `__bees__` are OPFS-only on render**
  — a missing layer/dep/bee does *not* stream in mid-render; it heals only via
  the explicit adopt/install/sync closure-walk above. So the same
  content-addressed artifacts (same DNA — see `dna.md`) carry a *different
  metabolism* depending on kind: resources are reflexively self-healing,
  structure (layers/deps/bees) is acquired deliberately.
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

> **Scope of "sigs only" (as of 2026-06-18):** true for the **broker** mesh —
> the federation ask/resolve flow carries layer/resource *sigs*, and bytes are
> pulled over HTTP-direct (`GET /<sig>`). The **swarm-preview** path is the
> exception: it still relays small image bytes inline as base64 (`swarm.drone.ts`
> kind `30201`, capped at `MAX_RESOURCE_BYTES` = 256 KB) so peers can preview a
> tile without a separate fetch. So "sigs only" describes the broker, not every
> wire event. The mesh is also currently **plaintext JSON** (the x-tag sig is
> visible); AEAD/confidentiality is future work.

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
| `domain-as-identity` §"Trust root: domain↔key binding" (§21.13) | **Carrier changed, binding unchanged.** Identity verification (domain-published key over TLS) still underpins the write-auth that gates a sigbag marker append — but the named `/__keys__` endpoint is retired along with `__roots__`: key material lives IN the identity scope's sigbag (marker `0000` introduces the authorized keys; a later marker rotates them). No named meta routes survive. |
| `history-is-the-deploy` | **Unified.** The history bag IS the sigbag; max seq = HEAD = current root. This doc adds: the max is also the *entrance* and the *attestation*, so there is no separate `__roots__`. |
| `merkle-layer-model`, `uniform-paradigm`, `one-layer-per-change` | **Refined.** Per-lineage roots, fractal; one marker per *affected lineage*; segment-count lineages per change. |
| `universal-history-plan` | **Realized.** The global time clock is the 2D-grid back-link (sub-node + T → owning root). |
| `flat-layer-pool`, `resource-streaming-migration`, `public-navigation-lineage-filter`, `host-sync-receipts` | **Consistent.** Flat sig pools; OPFS-as-cache with host fallback (resources only — layers/deps/bees are OPFS-only on render); broker mesh is layer-sigs-only (the swarm-preview path still relays ≤256 KB image bytes, kind `30201`); one-way push with receipts. |

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
