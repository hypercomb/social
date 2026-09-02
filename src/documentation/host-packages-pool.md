# Retiring `manifest.json` — a host's packages as a living primitive

*Chip. Completes step 2 of [install-by-replication.md](install-by-replication.md),
which ends "**Then retire `manifest.json`**" and leaves the shape open.*

`manifest.json` is the last location-addressed, mutable catalog in the delivery
pipeline — and the last unsigned document with authority over what runs. This
chip removes it in favour of the primitive the community-hosts pool already
is: **members named by the hash of their own bytes, marks carrying order, no
roster document to keep in agreement with the set.**

The case is not aesthetic. Every inventory field the manifest publishes was
measured to be derivable from content that is already sha256-verified — so the
document is a *copy*, and the copy is the part nothing checks.

## The measurement

Taken 2026-09-01 against live `jwize.com`, head package `8747453970b3…`,
generation 176. `manifest.json` = 3,566,200 bytes across 176 package entries.

| Field | Manifest publishes | Derived from signed content | Method |
|---|---|---|---|
| `layers` | 58 | **58**, 0 unreadable | walk `root.cells` recursively |
| `bees` | 127 | **127** | union of each layer's own `bees` |
| `dependencies` | 55 | **55** | `root.dependencies` (stores `<sig>.js`; manifest stores the bare sig) |
| `beeDeps` | 13 | **13 exact** | `deps = {…}` in each bee's bytes → class name → the dep bundle declaring that class |

Zero drift on any field. The `beeDeps` derivation indexed 280 classes across
55 dependency bundles and read 127/127 bees with no misses — it is the same
two regexes the build uses ([build-module.ts](../hypercomb-essentials/scripts/build-module.ts),
lines 904 and 1041), run over bytes instead of over build state.

Note the shape of the bee answer: the package root record declares
`bees: []`. All 127 live in child layers. The set is reachable by walking, but
it is **stated** only in the manifest.

## Why the copy is the dangerous half

`validateSealedPackage` ([sealed-package.ts:28](../hypercomb-runtime/src/sealed-package.ts))
validates the manifest's arrays **against themselves**. It checks that every
entry is a well-formed signature, that there are no duplicates, and that
`beeDeps` closes over the declared sets. The only tie to the package signature
is `layers.has(packageSignature)` — the root must appear in its own layer list.

Nothing compares any declared set to signed content. So:

- Every fetched atom is sha256-verified and a host can never serve wrong bytes.
- But the **set** is the host's to choose, and the bee set is what
  `activate()` writes to `INSTALL_MANIFEST_KEY` for `ScriptPreloader` to
  import. An unsigned document decides which 127 modules execute.

`acquire.ts`'s header already states the general form of this ("it CAN offer
you a different tree and call it current"). The measurement sharpens it: the
tree is not merely unsigned, it is unchecked against the signed tree sitting
next to it. Deriving the inventory from the sealed root closes the hole by
construction — there is no unsigned set left to trust.

## The shape: a pool, not a `children` document

The obvious move is a document — `{children: [packageSignatures]}` at a
derived address. It is the wrong primitive, for the reason
[host-zones.ts:98](../hypercomb-runtime/src/host-zones.ts) already gives
about hosts:

> The pool IS the set — there is no roster document to keep in agreement with
> it, so a half-written add can only ever mean one host missing, never a list
> that disagrees.

So `host:packages` takes the same living-primitive shape as `community:hosts`:

- **A package is a member artifact**, named by `sign()` of its own canonical
  record — sorted keys, no wall clock. Publishing the same package twice is a
  no-op; unpublishing needs no index.
- **Ordering rides marks, not fields.** `generation` / `previous` / `at` are
  per-host bookkeeping that `chain-manifest.ts` already documents as sidecar —
  they never affect a package's `rootLayerSig`. As marks they stop
  impersonating a version history: the pool answers *what this host holds*,
  the signed sentinel answers *which is current*. Those are different
  questions, and the manifest conflates them today.
- **`label` is a mark too**, not a field of identity.

### The wire form is the pool itself

There is no document. A client works out WHERE to ask the same way it works
out every other pool address — `sign('host:packages')` — so nothing is
published saying where to look, and there is no filename two parties had to
agree on. A host that holds nothing answers 404.

The pool holds **one package signature per entry**, at an 8-digit index,
appended in ship order. **The max index is the head**, the same rule a lineage
sigbag already uses. No counter to sort by, no `previous` to chase, no
catalogue to corrupt: an interrupted ship costs one entry, never the list.

And a head signature is all a client needs, because everything else derives
from it — the table above, plus the import-map bag, which is each dependency's
own first line paired with its file name.

**A CORRECTION, kept here because the wrong turn is instructive.** This section
first described a *projection*: a small `packages.json` rendered from the
chain, carrying a signature plus a few display marks. It shipped, it was 53×
smaller than the manifest, and it was still a manifest — a document stating
what content already says, at a filename someone had to know. The fields it
kept were justified by calling the import-map bags "not derivable", which
measurement then disproved: a bag entry is `@alias
<sig>`, and both halves are
in the dependency's own bytes. Nothing survived the check. The document was
withdrawn from the live host the same day.

### Probing, not an index the host renders

HTTP cannot list a directory, so reading a pool is a walk. Two ways, and the
choice is already settled by the host contract: serving `/<pool>/00000007` is
serving a file, which a bucket, a Pages deployment and a relay all do
identically, while an index a host RENDERS makes the host a program and
excludes every static host from being one.

So: double until the probe misses, then bisect — `~2·log2(n)` requests.
**Measured live against `jwize.com`: 18 requests, 926 ms, over a pool of 179
entries**, agreeing with the manifest's newest.

Entries are append-only, which is what makes the bisect sound (`has(i)` is
monotonic, so the boundary IS the head) and what lets them be served
`immutable` — entry *i* is the same bytes forever. The named documents are the
only mutable things on the wire, and they are the ones being retired.

## `beeDeps` is published by nobody

It is derivable (13/13), but it should be neither published nor derived on the
wire:

1. The derivation is a regex over **bundler emit**. Fine as a build step you
   re-run; as a runtime contract it degrades silently the day esbuild changes
   its output — fewer deps matched, no error.
2. It is not truth. [dependency-loader.ts:37](../hypercomb-runtime/src/dependency-loader.ts):
   present → deps claimed by a bee are deferred to lazy load; **absent →
   everything eagerly loads and the hive is still correct**, only slower.

That is precisely a derived cache: a pure derivation of sig-addressed inputs,
keyed by the package signature, recomputable, wipe-safe, never load-bearing,
complete-or-absent. It passes the litmus test — a cold client rebuilds it from
atoms alone — and the brittleness stops mattering, because a missed match
costs eager loading rather than a wrong install.

**Derived at ADMISSION, not in the optimize phase.** This chip first said the
optimize phase, on the reasoning that a derived cache belongs in the idle pass
that mints derived caches. Building it showed a better moment: at admission
every bee and dependency is already in hand and already verified, so the
derivation is one pass over local bytes and the answer is ready for the FIRST
boot. Deferring it to an idle pass would have bought nothing and cost the
participant one heavy boot per install — measured at 0.96 MB across 11 of 55
dependencies on the live chain. The doctrine is unchanged (derived, never
published); only the moment moved.

## Work

1. **Derive the inventory at admission.** `installPackage` stops reading
   `pkg.layers` / `pkg.bees` / `pkg.dependencies` and walks the sealed root
   instead: fetch `<sig>`, verify, walk `cells` for the layer closure, union
   each layer's `bees`, take `dependencies` (normalizing the `.js` suffix).
   `validateSealedPackage` then checks a set derived from content rather than
   a set the host asserted.
   *Status 2026-09-01: **BUILT.** `deriveInventory` in
   [acquire.ts](../hypercomb-runtime/src/acquire.ts) walks the closure with a
   `children` selector added to `resolveSignatureClosure` — the walker stays
   kind-blind, the caller owns the frontier, so `cells` is followed and a bee
   whose bytes happen to parse as JSON is a leaf. The derived sets feed the
   seal check, both `resolveInventory` calls, `writeBags`' bag arity and the
   `INSTALL_MANIFEST_KEY` record; the host's arrays now reach nothing but
   `reportDivergence`, which warns and moves on. Specs:
   `acquire-inventory.spec.ts` (8) + a selector test in
   `replication-walker.spec.ts`. Verified against the full published chain:
   176/176 packages derive exactly.
   Cost: the layer walk no longer runs in parallel with the bee and dep
   fetches — it cannot, since the bee set is not known until the layers are
   read — and each held layer is re-read once from the local heap to union
   its declarations.*
   *WEB PATH 2026-09-01: **BUILT.** `installFromBundled` in
   [ensure-install.ts](../hypercomb-web/src/setup/ensure-install.ts) — the
   shell's own `/content/` package — derives through the same
   `deriveInventory`, seals against the derived sets, and feeds them to the
   bag arity, the cached manifest record and `sigStore.trustAll`. The host
   path there already went through `acquire`, so both of the web shell's
   admission routes now read the signed tree.
   One consequence worth its own line: `checkForUpdate` compared the cached
   arrays against the bundled manifest's assertion, and those are no longer
   the same kind of thing — an asserted set that drifted from the tree would
   have raised a phantom upgrade pill every boot. It now short-circuits on
   package SIGNATURE equality first, which is the only comparison that
   actually answers "is this the same tree". Two specs pin it.*
2. **Mint the pool.** `host:packages` members in the community-hosts shape;
   `registerPoolMeaning` derives the address (the meaning carries a colon, so
   it cannot collide with a lineage bag).
3. **Move ordering onto marks.** `generation` / `previous` / `at` / `label`
   become marks on the member; `chain-manifest.ts`'s per-host counter retires
   with the document it chains.

   *A FORK FOUND WHILE STARTING 2 (2026-09-01), stated before it is built. The
   community-hosts primitive this chip points at is not portable as written:
   an artifact is a record in an OPFS pool and a mark is an ENROLLMENT worn by
   a cell (`wearEnrollment` / `enrollmentsIn`, over Store and the lineage). All
   of that presumes a hive. A publishing host has two quite different shapes:*

   - *A **store-backed host** — the desktop client, `hypercomb-serve` — has a
     hive, so `host:packages` is the primitive verbatim: members in the pool,
     marks carrying order, projection rendered by enumerating them. This is
     where step 2 belongs, and its crates are not in the main checkout.*
   - *A **static host** — a content directory behind a relay, Pages, a bucket
     — has no store and never will. Its honest form of "the pool IS the set"
     is the DIRECTORY as the set: one member file per package under
     `sign('host:packages')/`, minted by the ship. That still buys what the
     roster cannot — adding twice is a no-op, un-publishing is removing one
     file, and an interrupted ship costs one member instead of corrupting the
     whole catalog, which is exactly the failure a single merged
     `manifest.json` invites today.*

   *Both render the SAME projection, which is why step 4 could land first and
   why it will not need revisiting. What must not happen is a Node-side
   reimplementation of enrollments to make the build script look like the app:
   that is the second dialect the walker's squeaky-clean rule exists to
   prevent.*
4. **Publish the pool.** `sign('host:packages')`, one signature per index,
   append-only; the client derives the address and bisects for the head.
   *Status 2026-09-02: **BUILT AND LIVE.** The ship appends entries
   ([copy-content.ts](../hypercomb-essentials/scripts/copy-content.ts)); the
   client walks them ([host-pool.ts](../hypercomb-runtime/src/host-pool.ts))
   and `headPackage` is what cold boot now asks
   ([ensure-install.ts](../hypercomb-web/src/setup/ensure-install.ts)).
   Verified against `jwize.com`: head found in 18 requests / 926 ms over 179
   entries, agreeing with the manifest's newest.
   Two things this changed that are worth naming. The pool's address is a
   64-hex root name, so the ship's stale-removal — which deletes unadvertised
   64-hex entries RECURSIVELY — would have destroyed the whole of discovery on
   the next run; it is now held in the retention set explicitly. And cold boot
   no longer ranks offers ACROSS hosts by `generation`: a counter is per-host
   bookkeeping and comparing two hosts by it was always a fiction. The first
   carried domain that answers wins, and ranking across hosts is the signed
   sentinel's job. Nothing is risked — every answer is content-addressed.
   Specs: `host-pool.spec.ts` (11), `host-packages.spec.ts` (11),
   `orderedPackageSigs` in `chain-manifest.spec.ts` (5).
   Still read from the manifest: the BROWSE list, because a name is a mark and
   the static-host form of marks is steps 2-3.*
5. **`beeDeps` derived, not published.** Drop it from the published record and
   from `HostPackage`.
   *Status 2026-09-01: **BUILT.** `deriveBeeDeps`
   ([bee-deps.ts](../hypercomb-runtime/src/bee-deps.ts)) runs at admission in
   both install paths, over the bytes just verified, and its result is what
   reaches `INSTALL_MANIFEST_KEY` and `__hypercombBeeDeps`. Verified against
   the five most recent published packages: 5/5 derive their map exactly.
   The host's assertion is gone from the wire AND from the types —
   `HostPackageInfo` (core), `HostPackage` (runtime) and `BundledPackage` (web)
   no longer carry it, so there is no path by which a domain's claim about a
   bee's dependencies can reach a client. It is also no longer part of the
   seal: the seal is about the sets that are ABOUT to resolve, and a hint
   cannot seal anything. Specs: `bee-deps.spec.ts` (7), every one of them
   about degrading rather than failing.*
6. **Retire `manifest.json`.** Read-fallback while hosts drain, exactly as the
   legacy typed URLs are handled — never migrated into the protocol.

## Doctrine rules

- **The pool is the set.** No roster document; a half-written add means one
  package missing, never a list that disagrees.
- **Never let an unsigned document choose what executes.** The inventory is
  derived from the sealed root or it is not an inventory.
- **A served list is a projection.** Regenerated, never authored; the pool
  wins any disagreement.
- **Sig-shaped URLs are immutable.** Mutable pointers live at names, not
  signatures.
- **Derived caches are never published.** If a cold client can rebuild it from
  atoms, no host should ship it.

## Reproducing the measurement

Against any content directory holding a package and its closure (e.g.
`hypercomb-relay/content/`): read `manifest.json`, take the highest-generation
entry, then (a) walk the root record's `cells` for layers, (b) union each
layer's `bees`, (c) read the root's `dependencies` modulo the `.js` suffix,
(d) build class → dep-sig by scanning dependency bundles for
`var X = class` / `class X`, and match each bee's `deps = {…}` block against
it. Compare each against the manifest's arrays; all four matched exactly on
2026-09-01.
