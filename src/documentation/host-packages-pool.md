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

### The wire form is a projection

HTTP has no directory listing, so one enumerable document must still be
served. It is a **projection of the pool** — regenerated, never authored,
never authoritative. If it disagrees with the pool, the pool wins. Same
relationship the mobile rails have to layer order: a rendering, never a
commit.

The projection carries no inventory. Every field it does carry had to earn
its place by being either **display-only** (it cannot decide what installs) or
**underivable** (a client cannot work it out from bytes it has not fetched
yet):

| Field | Why it survives |
|---|---|
| `sig` | the package; everything else hangs off it |
| `label`, `at` | display marks — a picker must name its rows without one round trip per row |
| `layerCount`, `beeCount` | display marks; a count cannot widen or narrow what installs |
| `beesBag`, `dependenciesBag` | **not derivable** — a bag signature is minted from the bag's own entries, so a client cannot know it before fetching the bag it names. Without these the import map has no aliases |

Order replaces `generation`: the list arrives ranked, so there is no counter to
sort on and none to disagree about.

Measured on the real chain (176 packages): **3,566,200 → 67,384 bytes, 53×
smaller**, same head, same order. Every cold client currently downloads 3.5 MB
to learn one head signature.

### Do not serve it at a 64-hex URL

`sign('host:packages')` is a stable address (derived from meaning, not
content), which is exactly what discovery needs — but the relay serves every
`/<sig>` with `Cache-Control: public, max-age=31536000, immutable`
([relay.js:693](../hypercomb-relay/relay.js)). A mutable document at a
sig-shaped path is pinned for a year by any intermediary, and carving an
exception punches a hole in *sig-shaped means immutable*, which is the one
wire invariant worth keeping absolute.

Serve the projection at a non-sig well-known name with `no-store`. Same win,
no hole.
*FIXED 2026-09-01:* the relay used to hand the sig-file header to everything
that resolved, including `manifest.json` — it worked only because Cloudflare
does not cache `.json` by default. The rule is now stated where it belongs:
**immutable means sig-addressed, and nothing else.** A named file is the
domain's mutable voice and is served `no-store`. Readers ask `no-store` too,
so a host still running the old relay is safe either way.

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
4. **Serve the projection.** Non-sig well-known path, `no-store`.
   `listHostPackages` reads it; the inventory fields stop travelling.
   *Status 2026-09-01: **BUILT — ahead of 2 and 3**, because the projection is
   where the win lands and it does not depend on where the truth lives. It is
   rendered from the chained manifest by `projectionOf`
   ([chain-manifest.ts](../hypercomb-essentials/scripts/chain-manifest.ts)) and
   written to every target beside the manifest, inside the same
   after-the-files/before-the-removals window, so a reader landing mid-ship
   resolves whichever document it prefers against bytes already present.
   `listHostPackages` prefers `packages.json` per base and falls back to
   `manifest.json` for hosts that have not shipped since — the fallback is the
   drain window, not a second dialect. `reportDivergence` stays quiet when a
   source asserts nothing, which is the projection's normal condition.
   Strictly additive: deployed clients keep reading the manifest. Specs:
   `host-packages.spec.ts` (7) + `projectionOf` in `chain-manifest.spec.ts` (5).
   Still owed here: steps 2 and 3 replace the manifest as what the projection
   is rendered FROM, and only then can the manifest stop being written.*
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
