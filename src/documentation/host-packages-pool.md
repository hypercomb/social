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

The projection carries *signatures only*. No inventories: ~176 × 65 bytes
≈ 11 KB, against 3.5 MB today. Every cold client currently downloads 3.5 MB
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
no hole. (`manifest.json` is served immutable today for exactly this reason —
it falls through the typed-path branch and inherits the sig-file header. It
works only because Cloudflare does not cache `.json` by default.)

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
complete-or-absent. It belongs in the optimize phase
([optimize-phase.md](optimize-phase.md)), minted on the client. It passes the
litmus test — a cold client rebuilds it from atoms alone — and the
brittleness stops mattering, because a missed match costs eager loading rather
than a wrong install.

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
2. **Mint the pool.** `host:packages` members in the community-hosts shape;
   `registerPoolMeaning` derives the address (the meaning carries a colon, so
   it cannot collide with a lineage bag).
3. **Move ordering onto marks.** `generation` / `previous` / `at` / `label`
   become marks on the member; `chain-manifest.ts`'s per-host counter retires
   with the document it chains.
4. **Serve the projection.** Signatures only, non-sig well-known path,
   `no-store`. `listHostPackages` reads it and returns `{zone, base,
   packageSig}` — the inventory fields leave `HostPackage`.
5. **`beeDeps` to the optimize phase.** Derived cache keyed by package sig;
   drop it from the published record and from `HostPackage`.
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
