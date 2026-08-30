# Install by Replication — superseding the DCP installer

Plan and doctrine. The installer (`hypercomb-shared/core/layer-installer.ts`
plus the DCP transport role) is superseded by the pull replication protocol
(`hypercomb-relay/replicate.js`,
`hypercomb-essentials/src/diamondcoreprocessor.com/sharing/signature-replication.service.ts`).
There is one question in the system — *"do I hold this signature's closure?"* —
and one verb that answers it: `replicate(root)`.

## Verdict

The installer and the replication protocol are two implementations of the same
machine. `LayerInstaller.install` is: given a signature, fetch the atoms it
enumerates into a flat sig-named heap, skipping what is present, trusting
name = hash. `resolveSignatureClosure` is the same sentence, generalized and
hardened: resolve the reachable closure into a flat heap, sha256-verifying
every atom before write, reusing what is present, so a repeated request is an
idempotent delta repair. The sealed install package is already what the
protocol calls an **inventory** (`resolveSignatureInventory` — one-level exact
enumeration, no recursive mining). Under the minimalism doctrine, two codepaths
for "materialize a signature closure" is one too many.

The installer's entry point — `manifest.json` at a well-known URL — is the last
location-addressed, mutable catalog in the delivery pipeline. A replication
request carries identity, not content: one root signature plus the origins that
may serve it. Discovery collapses to the canonical visitor-deployment shape:
**one sig, resolved where you stand**.

## A version is not a state — it is a root signature

There are **no more updates** as a push pipeline. Install, update, and repair
are the same call:

- **Install** = `replicate(root)` into an empty heap.
- **Update** = `replicate(newRoot)` — merkle reuse means only the changed
  subtree fetches. A 95%-unchanged build costs 5%.
- **Repair** = `replicate(sameRoot)` — idempotent; present atoms are reused,
  holes are refetched.

Old roots stay valid forever. Unreferenced atoms are package GC's concern,
never the update path's. There is no uninstaller and no partial-update state.

## The update model (consumer-requested, icon-surfaced)

Updates are a **request from the consumer**. Three small pieces facilitate it:

1. **Subscription** — following a domain means holding its sigbag under
   `dcp/<domain>/`. First-click-adopts already creates this. Nothing new to
   build; recognize the DCP sigbags as "the domains I subscribe to" rather
   than "the domains I installed."
2. **Currency check** — per subscribed domain, resolve the publisher's
   sentinel to its current root sig and compare against the local max marker.
   One conditional GET per domain (ETag / 304 — the receipts endpoint already
   models this shape). Sig differs → update available → **icon lights up**.
   A dry closure walk can badge *how much* is new (hole count); the sig
   comparison alone is the whole check.
3. **The act** — tapping the icon runs `replicate(newRoot)`, then appends a
   marker to the domain's sigbag. Max marker IS current. Rollback = repoint to
   the previous marker. Pinning = decline to append. Reversible and
   non-destructive by construction.

**Guardrail: demand-driven only.** The replication client is deliberately not
subscribed to content writes or navigation effects, and quiet-landing doctrine
says truth arrives without repainting in place. The icon lights from a
poll-on-visit or interval check — never a live push channel. The consumer asks;
the icon is the answer; the human decides.

## Trust doctrine — verify at admission, never at runtime

DCP was a critical trust piece; its guarantees must survive the supersession
fully accounted for. The rule:

> **The tree is verified before it can run. At runtime it is too late to
> check, and too slow — runtime performs ZERO verification.**

The trust boundary is the **write into the heap**. Three layers, all enforced
at replication time:

1. **Integrity — every atom.** Every fetched atom is sha256-verified against
   its name before write (`replicate.js` refuses mismatches into `refused`;
   the browser walker must do the same). The heap only ever admits bytes whose
   hash IS their name. Anything already present is correct by construction —
   sig-named files cannot drift.
2. **Completeness — every tree.** A root is runnable only when its closure
   resolves with `holes.length === 0`. Complete-or-absent: the boot gate reads
   the closure result, not the individual files. No partially-verified tree
   ever activates.
3. **Authority — every root.** Integrity proves the bytes are what they claim;
   it does not prove *who published them*. The sentinel that maps "current" to
   a root sig must be **signed by the domain's publisher identity** (the same
   Nostr key that NIP-98-authenticates replication writes). A new root is
   accepted into a subscription only when the sentinel signature verifies.
   Forged host, poisoned CDN, or hijacked DNS can serve atoms (harmless — they
   verify or they're refused) but cannot advance your current root.

Because all three checks happen at admission, runtime trusts the heap
unconditionally: loading a bee, resolving an import, inflating a layer — all
are plain reads. This is not an optimization added later; it is the design.
OPFS is origin-private, so post-admission tampering is out of the threat model
(an attacker who can write OPFS owns the origin and no runtime check would
save you).

## A community is a host

Trusted communities are not a construct layered on top of domain hosts — **a
community IS a host**. Hosting a domain's content, holding its publisher key,
and signing its sentinel is the entire definition. There is no membership
table, no community registry, no separate trust object:

- **Joining** a community = subscribing to its host (holding its sigbag).
- **Trusting** a community = accepting roots its key has signed.
- **The community's voice** = the sentinel: one signed sig saying "this is
  what we currently publish."
- **Forking** a community = a new host signing a different sentinel over the
  same atoms — the merkle heap is shared; only authority diverges.

This is why the model stays small: hosts vouch for roots, signatures vouch for
bytes, humans choose which hosts to follow. Nothing else is needed.

## What remains of DCP

DCP the *transport* dies. DCP the *ledger* is promoted:

- `dcp/<domain>/` sigbags — the subscription list driving the currency check.
- Domain identity scopes — which publisher key vouches for which domain.
- The pushed-tiles record — unchanged; it was never installer transport.

## Migration plan

1. **Shell-embedded walker.** Extract a minimal closure/inventory walker into
   the shell bootstrap (mirror of `replicate.js`, ~100 lines, dependency-free,
   no drone imports, no auth — public pulls are anonymous GETs of
   `<origin>/<sig>`). The shell needs a bootstrap client of the protocol, not
   a second protocol.
   *Status 2026-08-30: DONE — `hypercomb-shared/core/replication-walker.ts`
   (`resolveSignatureClosure` + `resolveInventory` + `mineSignatures`, spec
   alongside). The walker is kind- and legacy-free by rule: placement and
   drain-window fallbacks live in the caller's io wiring. meadowverse's
   bootstrap is its first client (sealed package = exact inventory, one
   `resolveInventory` per kind); its relocated `LayerInstaller` copy is
   deleted — the class no longer exists outside the DCP app's own mirror.*
2. **Sentinel as sole discovery.** `manifest.json`'s surviving job — mapping
   "current" to a root sig — shrinks to a signed sentinel pointer (the sigbag
   model sentinel sync already half-implements). Then retire `manifest.json`.
3. **Pool placement moves post-resolution.** The installer routes bees to
   `sign('bees')` and deps to `sign('dependencies')` by which manifest array a
   sig rode in — transport-time classification. Replace with a thin
   post-resolution pass that reads the sealed record and sorts. Placement
   becomes a read of content, not a property of transport.
4. **Boot gate on closure completeness.** `ensureInstall` becomes: resolve
   sentinel → walk inventory → gate on `holes.length === 0`. Same skip-fast
   path when everything is present.
5. **Update icon.** Currency check per subscribed domain + the act
   (replicate → append marker). Demand-driven, per the guardrail above.
6. **Sentinel signing.** Publisher signs the sentinel; subscribers verify
   before advancing a root. This lands with (2), not after it — authority is
   part of discovery, not a follow-up.
7. **Retire `LayerInstaller` and the DCP transport role.** Legacy fallbacks
   (`__layers__/`, `.json` names, legacy typed URLs) stay in the drain code
   and die with the drains — they must NOT migrate into the protocol.
   *Status 2026-08-30: `LayerInstaller` is gone from `hypercomb-shared` —
   the web/dev shells never reached it (ensure-install's
   `applyVerifiedFiles` + sentinel resync own install), and the
   RuntimeMediator's vestigial genesis install is removed. The class was
   relocated into `meadowverse/src/layer-installer.ts`, that shell's own
   bootstrap client until it adopts the walker (step 1). The DCP app's
   mirrored copy and its transport role remain — they retire with steps
   2/5/6.*

## Doctrine rules

- **Never verify at runtime.** Admission is the boundary; the heap is trusted.
- **Never write an unverified byte.** Hash-check before write, everywhere,
  including the shell bootstrap walker.
- **Never activate an incomplete tree.** Complete-or-absent, gated on the
  closure result.
- **Never advance a root without a verified sentinel signature.**
- **Never push updates.** The consumer requests; the icon informs; the human
  decides.
- **Never re-grow a second transport.** One verb: `replicate(root)`.
