# Signed site bindings — bringing the directory under the primitives

Two plans against the same seam: `/publications.json` is honest about what it
reports, but half of what it reports comes from a place the primitives cannot
see, and the half that IS signed is reported at only one of the addresses it
answers on.

- **Plan A — the allowlist becomes content.** `SITE_BINDINGS` is operator
  config in a wrangler var. Fold it into signed, content-addressed data and
  reconcile it with the `community:hosts` living primitive.
- **Plan B — every door.** The ledger reports one host per creation. Report all
  of them, and delete the re-derivation that fills the gap today.

Plan B is small and independent. Plan A is the structural one. Do B first: it
pays for itself immediately and it is not blocked on A.

---

## Where things stand

`/publications.json` is a **live view**, not a stored artifact. Nothing caches
it (`Cache-Control: no-store`); the worker recomputes it per request from two
inputs of very different character:

```
env.SITE_BINDINGS ─────────────────┐
  operator config (wrangler var)   │
  host → {title, lineage,          │
          publishers:[pubkey…]}    ├──► servePublications()  ──►  /publications.json
                                   │      resolveSite()             [{host, url, title,
env.HIVES[pubkey] ─────────────────┘      ledgerEntry()               lineage, publishers:
  one schnorr-signed nostr event                                      [{pubkey, head, …}]}]
  content = {v, roots:{lineageKey → sig}}
  re-verified on EVERY read (verifiedIndex)
```

The `head` values are lineage head signatures — layer sigs, verified before
they are believed. That half is sound. `publishedRoot` refuses anything that is
not 64 hex, and `verifiedIndex` re-checks the schnorr signature on every read
rather than trusting what KV holds.

The other half is not content at all:

| Fact | Where it lives | Verifiable? | Replicable? |
|---|---|---|---|
| lineage head (`head`) | publisher's signed index | **yes** — schnorr, per read | yes |
| which pubkeys may publish to a zone | `SITE_BINDINGS` wrangler var | no | no |
| the zone's title for a lineage | `SITE_BINDINGS` wrangler var | no | no |
| the hosts a participant carries | `community:hosts` pool (client) | content-addressed | yes |
| where a branch publishes | `host:<zone>` marks on the branch | content-addressed | yes |

Apply the optimize-phase litmus — *could a cold client rebuild this from layers
alone?* — and the answer splits: **the heads yes, the allowlist no.**

### The duplication

`community:hosts` already models "a host" exactly as the doctrine wants
(`sharing/community-hosts.ts`, and the same pool by address in
`hypercomb-runtime/src/host-zones.ts`):

- a host is an **artifact** — `{kind:'visual:host:artifact', meaning:'host:<zone>',
  payload:{zone}}`, named by the signature of its own bytes, so adding twice is
  a no-op and removing needs no index;
- **where a branch publishes** is a **mark the branch wears** — `host:<zone>`,
  with `order` on the mark, so position 0 is the primary door;
- nothing holds a list; deleting a host leaves every branch intact.

`SITE_BINDINGS` is the same kind of fact — *this zone, that publisher, that
lineage* — written as a flat JSON blob in deploy config. Two models of hosting
exist side by side and know nothing about each other. That is the seam.

### The symptom Plan B fixes

`servePublications` emits **one entry per creation, first bound zone wins**:

```js
if (named.has(lineage) || lineage.includes('/')) continue
const host = `${lineage}.${zone}`
```

`SITE_BINDINGS` iterates `pluginthematrix.com` first, so `dylan` is reported as
`dylan.pluginthematrix.com` and never as `dylan.hypercomb.com` — even though
both answer, and both are equally real. The ledger's `host` is **a** door, not
**the** doors.

`scripts/presentation/hosts.cjs` had to work around exactly this: it re-derives
`<lineage>.<zone>` for the zone it cares about and then probes `/site.json` on
each candidate to find out what the ledger already knew. That is duplicated
worker logic living in a build script, and a network round-trip per candidate
to answer a question the worker could have answered once.

---

## Plan B — every door

> **BUILT 2026-09-01.** `hostsOfLineage` in `worker.js`, `hosts[]` on every
> ledger entry, `doorsOf` + membership exclusion in `publications-ledger.ts`,
> and `hosts.cjs` collapsed onto the reported doors. 13 worker cases, 247 in
> `sharing/`. **Not deployed** — `npm run deploy:pluginthematrix` from
> `hypercomb-relay/blossom-worker/` still owes.
>
> Two things the plan did not foresee, both found by building it:
>
> - **`routed` / `wildcard` on a binding.** A binding whose route is commented
>   out resolves in the worker and is never reached from outside, and Cloudflare
>   does not hand a script its own routes. Without these the ledger would have
>   advertised `dylan.realones.online` (route disabled) and the `hypercomb.com`
>   apex (still `A → Azure`). Both default true. They gate what is
>   *advertised*, never what is *served*.
> - **`resolveSite` accepted labels DNS never will.** `install:essentials` is a
>   real creation and not a hostname, and it had a live plate at
>   `install:essentials.pluginthematrix.com`. The label check moved into
>   `resolveSite`, the one place that decides what an implicit name is.

**Goal.** The ledger reports every address a published creation answers on, so
nobody has to re-derive them.

### Shape

`ledgerEntry` gains `hosts` — every address the router would serve this lineage
at, primary first — and keeps `host`/`url` as the primary, unchanged, so no
consumer breaks on the day the field lands.

```jsonc
{
  "host":  "dylan.pluginthematrix.com",     // unchanged: the primary door
  "url":   "https://dylan.pluginthematrix.com/",
  "hosts": [                                 // new
    { "host": "dylan.pluginthematrix.com", "url": "…", "primary": true,  "implicit": true },
    { "host": "dylan.hypercomb.com",       "url": "…", "primary": false, "implicit": true }
  ],
  "title": "dylan", "lineage": "dylan", "publishers": [ … ]
}
```

`implicit` distinguishes a name the wildcard rule brought to life from one an
operator bound by hand — the two differ in what it takes to move them.

### Steps

1. **`hostsOfLineage(env, lineage)`** in `worker.js`, next to `wildcardZones`.
   Returns every host that resolves to this lineage: each explicit
   `SITE_BINDINGS` key whose lineage matches, plus `<lineage>.<zone>` for every
   wildcard zone where the label is a valid DNS label and `resolveSite` agrees
   it resolves back to this lineage. **Every candidate goes back through
   `resolveSite`** — the existing rule that the ledger may never advertise an
   address the router would refuse.
2. **Nested lineages stay explicit-only.** `revolucion/meetup` answers at
   `meetup.pluginthematrix.com` and nowhere else; the wildcard maps one label,
   never a path. The helper must not invent `meetup.hypercomb.com`.
3. **One entry per creation, N hosts.** `servePublications` keeps the `named`
   set (a creation earns one plate) but the plate now carries the full host
   list. Primary = the explicit binding if one exists, else the first wildcard
   zone in `SITE_BINDINGS` order — which reproduces today's `host` exactly.
4. **Zone anchors are excluded.** `realones.online` binds lineage
   `"realones.online"` deliberately — `lineageKey` folds dots to `-`, so no hive
   location can mint it and it can never steal a real hive's plate. The helper
   must keep that property: an anchor contributes a *zone*, never a door.
5. **Reader.** `shapePublications` (`sharing/publications-ledger.ts`) carries
   `hosts` onto `PublicationCard`, and **self-exclusion tests membership**:
   today `site.host === exclude.host` misses a directory reached through its
   second name. Change to `hosts.some(h => h.host === exclude.host)`, with the
   `host` field as the fallback when `hosts` is absent (an older worker).
6. **View.** The publications plate may show alternates — a second line, or
   nothing at first. The data landing is the point; the plate can stay as it is.
7. **`hosts.cjs` collapses.** Filter `hosts` for the zone and drop
   `doorsFrom`'s wildcard re-derivation *and* the `/site.json` probe: the
   ledger's answer is already `resolveSite`-validated, which is strictly better
   evidence than a status code. Keep the probe behind a `--verify` flag for the
   pre-cutover period, then delete it.

### Tests

`worker.spec.js` already has the right fixtures. Add:

- a creation live on two wildcard zones reports both, primary first;
- a nested lineage reports exactly its bound host;
- a zone anchor contributes no door;
- `shapePublications` excludes the directory reached by its **second** name.

### Cost and risk

Half a day. Additive fields only, so a stale reader keeps working. The one real
risk is `hostsOfLineage` disagreeing with `resolveSite`; routing every candidate
back through `resolveSite` is what makes that impossible rather than unlikely.

---

## Plan A — the allowlist becomes content

**Goal.** Everything the ledger gates on is verifiable and replicable, and there
is one model of hosting instead of two.

The end state: a zone's bindings are an **artifact in a pool of meaning**, found
the way everything in a pool is found — by deriving its address from the meaning
— and made authoritative by the operator's already-signed index. The wrangler var
stops being the source and survives only as the bootstrap for a zone that has not
published a set yet.

### Discovery is the pool, not a pointer

**A pool of meaning is the discovery protocol.** `sign('community:hosts')` is
computable by anyone who knows the string; nobody is told where the hosts are,
and there is nothing to configure, hand over, or keep in agreement. Any new
store — a KV namespace, a config var, a side file — is a second place that has
to be pointed at, and a pointer is exactly the thing the convention exists to
delete. So the bindings go **in the pool that already holds hosts**, as a second
artifact family, and nothing new is minted to hold them.

```
sign('community:hosts')        ← derived, never stored, never handed over
  ├── <sig-of-bytes>  {kind:'visual:host:artifact',    meaning:'host:hypercomb.com',    payload:{zone}}
  └── <sig-of-bytes>  {kind:'visual:binding:artifact', meaning:'binding:hypercomb.com', payload:{…}}
```

Same pool, same naming rule (member name IS the signature of its own bytes),
same idempotence (canonical record → adding twice is a no-op). A reader who
wants a zone's bindings derives the pool address, enumerates it, and keeps the
members whose `meaning` names the zone — precisely what `listCommunityHosts`
already does for the host family.

### The binding artifact

```jsonc
{
  "kind": "visual:binding:artifact",
  "meaning": "binding:hypercomb.com",
  "payload": {
    "publishers": [ { "pubkey": "<64-hex>", "label": "Jaime", "primary": true } ],
    "bindings": [
      { "host": "replication.hypercomb.com",
        "lineage": "hypercomb/architecture/replication-by-signature",
        "title": "Replication by Signature" }
    ],
    "wildcard": true
  }
}
```

Canonical the way `hostArtifactRecord` is canonical — **sorted keys, no wall
clock** — so the same bindings always mint the same signature and re-publishing
an unchanged set is a no-op rather than a new address.

Note what is *absent*: no per-name configuration for wildcard sites. Publishing
stays the naming step. The record says who may publish here and which nested
lineages have hand-bound doors; every other name is still the rule.

### Authority rides the index that already exists

Discovery is by convention, so anyone can mint a plausible-looking binding
artifact. What makes one **authoritative** is not where it sits — it is whose
signed index names it:

```
GET /hive/<operator-pubkey>   → nostr event, schnorr-verified per read (verifiedIndex)
   content.roots['binding:hypercomb.com'] = <sig>
                              ↓
GET /<sig>                    → the binding artifact, hash-verified on arrival
                              ↓
                             siteBindings(env)
```

No new signed-write path, no second verification routine, no new namespace. The
index is already signed, already rollback-guarded by `created_at`, and already
re-verified on every read. A binding artifact nobody's index names is bytes in a
pool and nothing more — which is the correct amount of authority for content
anybody can mint.

`lineageKey` folds non-alphanumerics to `-`, so a colon-bearing root key can
never collide with a real hive location — the same property that makes
colon-scoped pool meanings safe, used for the same reason.

### Reconciling with `community:hosts`

Both directions of the same relation, kept apart the way the living primitive
keeps them apart:

| | Participant side (exists) | Zone side (this plan) |
|---|---|---|
| the thing | `visual:host:artifact`, `meaning:'host:<zone>'` | `visual:binding:artifact`, `meaning:'binding:<zone>'` |
| where | `community:hosts` pool | the same pool |
| the relation | `host:<zone>` mark on the branch, `order` = primary | `publishers[]` inside the record |
| says | "I carry this host and publish this branch there" | "these keys may publish here" |

They are complementary claims and **both must hold** for a site to be served:
the participant says where they publish, the operator says who may. Neither is
derived from the other and neither holds a list of the other — that is the
mistake the claim-union pick-list made, and the reason a typo'd hostname was
once permanent.

### Steps

1. **Canonical encoder + ratchet, beside the host family.**
   `bindingArtifactRecord(zone, …)` and `bindingArtifactSig` in
   `sharing/community-hosts.ts`, mirroring `hostArtifactRecord` exactly. A spec
   pins the byte shape: two shells minting different bytes for the same zone is
   a pool they disagree about — the failure `hostZone` parity already had to be
   fixed for once.
2. **Reads before writes.** `listZoneBindings()` beside `listCommunityHosts` —
   same enumeration, filtered to the binding family. Nothing consumes it yet;
   landing the reader first means step 4 has something to test against.
3. **The operator publishes one.** Writing the artifact into the pool is
   `addCommunityHost`'s shape. Naming it from the index is the existing publish
   path with a colon-scoped root key — no new envelope.
4. **`siteBindings(env)` reads the pool.** Today it parses a var. It becomes:
   derive `sign('community:hosts')` → read the operator's verified index → resolve
   the named binding artifacts → parse → memoize per request (the `indexReader`
   pattern, for the same reason). **The var stays as the fallback** for the whole
   migration and as the cold-start answer for a zone with nothing published.
5. **Migrate one zone at a time, reversibly.** Publish `pluginthematrix.com`'s
   record, confirm `/publications.json` is byte-identical to what the var
   produced, then drop that zone's key from the var. The two never both win: the
   pool is consulted only when the index verifies and the bytes hash.
6. **A conformance vector.** A fixed binding artifact and the exact ledger it must
   produce, executable against the worker — what makes a second implementation
   possible, which is the point of the exercise.
7. **`hostsOfLineage` (Plan B) reads the same interface**, so B needs no rework:
   it already goes through `siteBindings`.

### The one thing that needs solving first

**The worker must derive pool addresses.** `sign(meaning)` is SHA-256 of the
UTF-8 meaning string — a few lines against WebCrypto, which the worker already
uses for schnorr. But it must be the **same** derivation as
`Store.poolSignature`, and a worker that computes a different address than the
client is a pool the two disagree about, silently. Pin it with a shared vector
(meaning → hex) asserted from both sides, the way `hostZone` parity is pinned.

Everything else in this plan reuses code that exists.

### What this buys

- A cold client can **verify** who is allowed to publish at a zone instead of
  trusting the worker's word. The ledger stops mixing verified and unverified
  facts in one shape.
- The bindings **replicate** like everything else — a second host serves the same
  zone's directory by pulling content, not by being handed a config file.
- **Nobody is told where to look.** The address is derived from a string, so a
  new implementation needs the convention and nothing else.
- Deploy stops being an authoring surface. Adding a bound site is a publish, not
  `wrangler deploy` — which today ships the whole working tree and has taken every
  hostname down for one dormant zone.
- One model of hosting instead of two.

### What it does not buy, and the open questions

- **DNS and routing stay operator config, permanently.** A pool cannot make
  `*.hypercomb.com` resolve; the `routes` in the wrangler toml are still the act
  that puts a zone on the worker. This plan makes the *allowlist* content, not
  the *plumbing*.
- **Key rotation is unsolved.** A zone whose operator key is lost is a zone with
  no path forward. Decide before step 3: a `previous` field, an N-of-M publisher
  set, or an explicit accepted answer that rotation means re-deploying the var
  once.
- **Revocation timing.** A record removing a publisher must take effect quickly,
  which argues against caching beyond a request — the index read is already
  `no-store` for exactly this reason.
- **Two operators, one zone.** Two indexes naming different binding artifacts for
  the same zone is a conflict the pool cannot resolve, because a pool is a set and
  takes no position. Today the zone has one operator; decide the rule before it
  has two.
- **`publishedAt` is still the index event's `created_at`**, so every plate shares
  one timestamp and "newest first" cannot order them. A protocol change to the
  hive index, not to bindings — separate, but worth doing while the envelope is
  open.

### Cost and risk

Several days, and it touches the trust boundary — so sequencing matters more than
speed. The var-as-fallback and the per-zone migration make every step individually
reversible, and a record that fails to verify is simply not believed, which fails
closed to today's behavior.

## Order

1. **Plan B**, whole. Independent, small, deletes code.
2. **The pool-address parity vector** — worker `sign(meaning)` proven identical to
   `Store.poolSignature`. Everything in Plan A rests on it and it is an afternoon.
3. **Plan A steps 1–2** (canonical record + reader) — cheap, and they pin the
   shape before anything depends on it.
4. Decide **key rotation**. Do not build step 3 before this has an answer.
5. **Plan A steps 3–7**, one zone at a time, `pluginthematrix.com` first.

Related: `website-artifact-paradigm.md` (artifact + marks, never a parent),
`publishing.md`, `known-location-pools.md` (why every new pool meaning carries a
colon), `optimize-phase.md` (the derived-vs-truth litmus this document applies),
`hosting-from-a-machine.md`.
