# Publish Differential — what the world serves, next to what is here

**Status: BUILT.** Code:

```
hypercomb-essentials/src/diamondcoreprocessor.com/sharing/
  publish.queen.ts          ← `/publish` — toggles the surface, nothing else
  publish-status.drone.ts   ← the differential: rows, verdict ladder, actions
  publish-branch.ts         ← publishBranch / unpublishBranch / confirmPublished
  publish-heads.ts          ← the `publish:heads` pool — the publish ledger
  hive-pointer.ts           ← fetchHiveIndex / putHiveManifest (index client)
  host-sync.service.ts      ← probeServed / closureGaps / hasAnyReceipt / ensureReceipt
  host.queen.ts             ← `/host` — the publish GESTURE, same routine
```

Companions: `public-content-endpoint.md` (the CDN tier that serves the bytes
and the index), `known-location-pools.md` (why the pool spelling carries a
colon), `optimize-phase.md` (the litmus that makes this pool truth, not cache),
`shell-surfaces.md` (how the panel must mount).

## What the surface is for

Publishing a branch produces two claims a participant cannot check by looking
at their own hive:

1. **Is it actually online?** The bytes went to a CDN and a signed index was
   PUT to a host. Neither of those acts proves a visitor can resolve the
   branch right now.
2. **Is it still what I have?** Every commit after the publish moves the local
   head. The published head does not move with it.

`/publish` answers exactly those two questions and nothing else. It is the
STATE verb; `/host` is the GESTURE verb ("publish the branch I am standing in,
hand me a link"). They are deliberately separate: a gesture that also reported
status would have to guess at rows it did not act on, and a status surface that
also published would obscure which branch it acted on. Both drive the **same**
routine — `publishBranch()` in `publish-branch.ts` — so the two surfaces cannot
drift into publishing differently.

The drone emits one `publish:render` payload (`PublishRenderPayload`) and
accepts intents back (`publish:run`, `publish:unpublish`, `publish:expand`,
`publish:copy-link`, `publish:refresh`, `publish:view-toggle`,
`publish:close`). It also invalidates on `history:head-changed` and
`share:receipt-revoked`, coalesced through a 750 ms debounce — a commit storm
bumps the tree epoch and invalidates every seal, and restarting the sweep once
per commit would make the panel a stall.

## The three signatures

A row's state is a comparison of three heads. Two are not enough, because two
cannot distinguish *behind* from *cannot see*.

| Name | Where it comes from | What it means |
|---|---|---|
| **live** | `fetchHiveIndex(host, pubkey).manifest.roots[key]` | The head the publisher-signed hive index names — what a visitor resolves right now. |
| **here** | `history.sealSubtree(segments)` | The head publishing would advance to — what is here now. |
| **mine** | `latestByLineageKey(pubkey)` over the `publish:heads` pool | The head *we* put into the index, when, and under which signed index stamp. |

Why `mine` is load-bearing rather than a convenience:

- `live === here` with no `mine` is still ambiguous about *who* published;
  scoping the ledger by pubkey lets the panel say "your key changed, these
  records describe a different hive" (`keyMismatch`) instead of showing every
  branch as gone.
- `live !== here` alone cannot tell "our publish has not propagated yet" from
  "someone else's publish is the authority now". The ledger's timestamp
  decides: a record newer than `RECENT_PUBLISH_MS` (10 minutes) naming a head
  the index does not carry reads `pending`; an older one does not, because at
  that age the index is simply the authority and insisting otherwise would be
  the panel claiming its own memory outranks what the world serves.
- A schnorr-valid index proves authorship, never recency. Only an index stamp
  compared against one **we ourselves signed** can catch a stale edge — and
  that stamp only exists because `mine` wrote it down at publish time.
- The wipe guard needs an independent record of what we published (see below).

`sealSubtree` returning `null` is **cannot-see**, never "different": it means a
child is cold or unresolvable. Collapsing the two would invent drift out of an
unvisited tile.

## The `publish:heads` pool

Owner: `publish-heads.ts`. Address derived at runtime via
`registerPoolMeaning('publish:heads')` — never a hardcoded hex, because
deriving is also what registers the meaning with
`hypercomb-core/src/core/pool-registry.ts` so root walkers can tell this pool
from a lineage sigbag (they share one flat namespace).

### Two member shapes

```
{sealedSig}                     — the PUBLISH RECORD (truth)
{sealedSig}.{hostHash}.seen     — an OBSERVATION (never load-bearing)
```

A record is named by the published head sig and nothing else, so the pool
listing IS the index of everything ever published. `RECORD_RE` is
`/^[a-f0-9]{64}$/`, which the observation sidecar deliberately fails — listing
records can never surface one. `hostHash` is the first 16 hex of
`sha256(lowercased domain)`, the same convention `HostSyncService` uses for
receipt filenames, so the two agree about how a host is named on disk.

`PublishRecord` carries `segments` VERBATIM alongside the derived `lineageKey`.
That is not redundancy: `lineageKey` folds every non-letter/digit to `-`, so it
cannot be inverted — without the raw segments the panel could only show a
mangled name and could not re-seal the branch to compare. It also carries
`host`, `pubkey`, `at` (epoch **ms**, local act), `indexCreatedAt` (epoch
**seconds**, the `created_at` of the event we signed — the unit differs on
purpose so it compares directly against `HiveManifest.createdAt`), and
optionally `bundleSig` (the hive-link resource a visitor actually opens).

Records are written in one write (complete-or-absent), and are idempotent:
re-publishing the same head overwrites with a fresher stamp. Malformed members
are skipped during listing, never thrown on — one bad file must not blind the
panel to the rest.

Observations are rewritten in place each sweep and are disposable. Deleting
every sidecar loses nothing but the "as of" line an offline panel shows.

### Why it is TRUTH, not a derived cache

The optimize-phase litmus (`optimize-phase.md`) asks: *could a cold client
rebuild this from layers alone?* "I advanced the hive index to head X at time
T under key K" is the record of a **remote act**. No walk of local layers
produces it. So it is state: it gets its own pool of meaning, it is never
minted from `optimize()`, and it is never written from the commit path. The
only writers are `writePublishRecord` (called by `publishBranch` after a
successful index PUT) and `writeObservation` (called by the panel sweep).

### Why the spelling carries a colon

Per `known-location-pools.md`, a bare-word pool meaning collides with the
history sigbag of any root tile whose slug equals it, because
`sha256(meaning)` and `sha256(lineageKey(segments))` are the same preimage for
a bare word. `lineageKey` folds every non-letter/digit to `-`, so no location
can ever produce a `:`. `publish:heads` is therefore collision-proof by
construction, and the doctrine ratchet in `doctrine.spec.ts` requires every
NEW meaning to be spelled that way.

## What "online" is proven by

Three independent proofs, each answering a different lie.

### 1. Authenticity — schnorr, against a pinned pubkey

`fetchHiveIndex(host, pubkey)` (in `hive-pointer.ts`) fetches
`GET <scheme>://<host>/hive/<pubkey>` with `cache: 'no-store'` and then
refuses to trust the host: the body must be a kind-`30564` event
(`HIVE_INDEX_EVENT_KIND`), its `pubkey` must equal the one we asked for, and
`verifyEvent` must pass. A wrong pubkey and a bad signature are both
`forged` — both are substitution, not corruption. A host can therefore
*withhold* an index but never *substitute* one.

The failure reasons are the API, not a detail:

| Reason | What it asserts |
|---|---|
| `unreachable` | Network/CORS/DNS. **Nothing** asserted. |
| `http` (+`status`) | The host answered but not with 200. `404` = never published. |
| `malformed` | 200 with unparseable JSON, wrong kind, or bad roots. |
| `forged` | Well-formed event that does not verify against the pinned pubkey. |

`fetchHiveManifest` collapses all four to `null` and is kept only for callers
that genuinely just ask "did I get a verified index?". Anything that must
**act** on why calls `fetchHiveIndex`.

### 2. Freshness — monotonic, against our own signed `created_at`

A schnorr check proves an index IS the publisher's; it never proves it is the
LATEST. An edge holding a superseded-but-authentic index passes every
signature test.

`putHiveManifest` therefore returns `createdAt` read back off the **signed
event** (not off our own clock — a NIP-07 extension signs an event it
composed, and the compare is only meaningful against the value the host will
serve). `publishBranch` stores it as `PublishRecord.indexCreatedAt`.
`highWaterIndexStamp(host, pubkey)` returns the newest stamp we have ever
signed for that host/key, and the sweep sets
`indexStale = read.ok && highWater > 0 && indexCreatedAt < highWater`. That
is the only detectable form of "authentic but wrong", and it renders as its
own row state, `stale-edge`.

### 3. Service — the 404-only probe

`HostSyncService.probeServed(host, sig)` does a `HEAD` on
`<scheme>://<host>/<sig>` with `cache: 'no-store'` and returns a tri-state:

- `served` — 200.
- `absent` — 404. **The only condition that asserts absence.**
- `unknown` — offline, CORS, 5xx, timeout, or the local breaker
  (10 consecutive non-404 failures pause status probes for 5 minutes).

It never throws, never writes receipt state, and never revokes a receipt: an
edge miss is far likelier than a deletion, and letting a read-only panel
destroy receipts would let one bad response re-push an entire branch. It is
deliberately separate machinery from the drain's own `#receiptStillHonored`
audit — that one is keyed by sig alone (single host), marks sigs
audited-for-the-session on any non-404, and feeds the drain's breaker; sharing
it would hand back another host's verdict and let opening a panel silently
disable receipt auditing. The only thing they share is the global 4-way
concurrency semaphore. Verdicts are **not** memoized across calls (in-flight
dedup only), because liveness must be able to recover.

### Why a cached 200 is honest for bytes but not for the index

The byte URL **is** the content hash. An intermediary can only hold an object
under that name because the origin served exactly those bytes, and the client
sha256-gates what it reads anyway (`public-content-endpoint.md`). So a cached
200 on `/<sig>` is a true statement about the world: those bytes are
retrievable under that name.

`/hive/<pubkey>` is the one **mutable** object in the protocol. A cached 200
there says only "some index existed", which is why the index is fetched
`no-store`, verified by signature, and then compared for freshness against our
own stamp. Content-addressing carries the byte tier; the index tier needs the
ledger.

## The index wipe guard

**The bug.** The hive index is REPLACEABLE, not mergeable: every PUT carries
the complete `lineageKey → head` map, so advancing one branch means rewriting
all of them. The original merge read the live index and fell back to `{}` on
failure — and `fetchHiveManifest` returns `null` for *every* failure kind. One
flaky GET (an offline moment, a CORS hiccup, an edge 502) therefore published
an index containing only the branch in hand, silently unpublishing every other
branch the participant had ever shared.

**The rule now.** `publishBranch` accepts a baseline from exactly two sources:

- `read.ok` → merge onto the verified `read.manifest.roots`.
- `read.reason === 'http' && read.status === 404` → `{}`. Nothing is published
  under this pubkey yet, so the empty map is the truth here. **This is the only
  sanctioned path to a `{}` baseline.**

Anything else — `unreachable`, `malformed`, `forged`, any non-404 status —
returns `{ ok: false, failure: 'index-unsafe', reason }` and writes nothing.
Refusing costs the participant a retry; guessing costs them every link they
have shared. `unpublishBranch` applies the identical guard for the identical
reason (a 404 there means "nothing to remove", `{ ok: true, removed: false }`).

The ledger's role here is **evidence, not fallback**. `knownRoots(host,
pubkey)` reconstructs the map we know we published, and `publishBranch`
reports `missingFromIndex` — keys our ledger carries that the live index does
not. It is reported and never silently re-asserted: resurrecting a branch the
participant deliberately unpublished would be its own kind of lie. It is also
a floor, never a ceiling — it cannot know about branches published from
another device, which is exactly why a failed read-back must REFUSE rather
than fall back to it.

`/host` surfaces the same signal as a follow-up toast pointing at `/publish`.

## Row states

One row per candidate branch. Candidates are the union of: every ledger record
(keyed by `lineageKey`, path from the verbatim segments), every locally
marked public branch (`readPublicBranches()`, which yields **paths** and so
must be folded through `lineageKey` to join the other key spaces), and every
key the live index names (which cannot be inverted into a path, so the row
carries the key itself and its `segments` are empty).

The verdict ladder is ordered on purpose: **every rung above `drift` is a
reason the comparison itself cannot be trusted, and must win over it.**

| State | Meaning | What proves it |
|---|---|---|
| `comparing` | The local side is still being computed. | Draft row before `sealSubtree` returns. |
| `unknown` | Nothing could be asserted. | `indexState` is not `ok`/`none`; or no `live` and nothing sealable; or `live` with no local path to seal; or `live === here` but `probeServed` returned `unknown`. |
| `unpublished` | Marked public, never published. | No index entry (`live === null`) and the row is sealable. |
| `stale-edge` | The readable index is OLDER than one we signed — authentic and wrong. | `indexStale`: verified read whose `createdAt` < `highWaterIndexStamp`. |
| `gone` | The host asserted the live head is not there. | `probeServed === 'absent'` — a 404 and nothing else. |
| `pending` | We published a head the index does not name yet. | A ledger record whose `sealed !== live` and whose `at` is within 10 minutes. |
| `cannot-compare` | A child is cold; the local head cannot be computed. | Row is sealable but `sealSubtree` returned `null`. |
| `drift` | Verified index, but the branch has moved on here. | `here !== live`, with a verified index and a served (or at least not-absent) head. |
| `live` | Same head both sides, and the bytes are served. | `here === live` **and** `probeServed === 'served'`. |

`unknown` is the resting place for every unproven condition, and it renders as
the last stored observation with its age rather than as a red light. Note the
last rung: `served === 'unknown'` keeps a matching pair OUT of the green — not
being able to reach the host is not evidence of service.

Two payload-level flags sit above the rows: `index` (`ok` | `none` | one of the
four failure reasons | `checking`) — with `forged` the loud one — and
`gateActive`, the `hc:public-host` opt-in. With the gate off, marking public is
inert and every row would look broken for the wrong reason, so the panel states
the gate instead.

**Expanding a row** calls `HostSyncService.closureGaps(live, 'layer', true, 8)`:
the same walk the availability check performs, but COLLECTING holes instead of
short-circuiting on the first. That is what turns "this branch is not fully
served" into "these three objects are missing", the only form a participant can
act on. It reads local bytes across the closure, so it is opt-in, capped, and
never on a render path — "at least n holes" is enough to refuse a green light.
Expanding is also what fills `seenAt` from the stored observation.

## Publishing, re-publishing, unpublishing

`publishBranch(segments, options)` is the one implementation. In order:

1. Mark the branch public (`setBranchPublic`) and enable the public host.
2. Seal from live heads; on failure heal the subtree bags once and retry;
   still failing → `seal-failed`. A lossy seal is never published.
3. `markPublic(sealed, 'layer', true)` and start a drain.
4. **The availability gate** — poll `isClosureAvailable` until the closure is
   receipt-confirmed, up to 120 s. Past the deadline the routine returns
   `not-available` and the pointer is NOT advanced (the drain keeps retrying
   detached). The index only ever names a served head.
5. Merge + sign + PUT the index, behind the wipe guard above.
6. Mint the hive-link bundle resource, mark it public, and wait up to 12 s for
   its own receipt (`linkReceipted`) — a green branch with a 404 link is still
   a broken share. The URL handed back is `<scheme>://<current host>/<bundleSig>`.
7. Write the ledger record **before** confirming. The PUT already happened; if
   the tab closes during confirmation the act still has to be on record, or the
   next publish loses its freshness baseline and the wipe guard loses its
   evidence.
8. `confirmPublished` — re-read the index (`no-store`) until it names our head,
   then probe that the head bytes are served, up to 20 s. Both halves are
   required: an index naming a head nobody serves is the dead link the
   availability gate exists to prevent, and served bytes nobody is pointed at
   are invisible. Only then is the result `confirmed`. A caller may render
   "published" on `unconfirmed`; it must not render "live".

Failure modes map one-to-one onto something the participant can do:
`services`, `no-branch`, `seal-failed`, `no-signer`, `not-available`,
`index-unsafe`, `index-failed`, `bundle-failed` — each with copy in
`PUBLISH_FAILURE_TEXT` that names what it means for existing links. The
refusal cases especially must read as protection: with `index-unsafe`,
"nothing happened" is the good outcome.

### Unpublishing, and its honest limit

`unpublishBranch(segments)` reads the index behind the same guard, deletes the
row's key, PUTs the remainder, and then clears the local public mark so the two
cannot disagree afterwards. It is the counterpart `setBranchPublic(..., false)`
never was — un-marking a branch locally left its index entry standing, so the
world kept being handed a head the participant thought they had withdrawn.

**It is not deletion, and callers MUST say so.** The closure stays hosted —
content-addressed bytes are never removed — and any link already shared carries
`rootSig` in its bundle as a cold fallback hint, so an old link keeps
resolving. Removing the index entry stops the branch being **advertised** and
stops it **tracking future changes**. It does not un-share what was shared.
The panel states this in the toast every single time.

## Known limits

These are gaps, written down rather than papered over.

- **`lineageKey` is many-to-one.** Each segment folds every non-letter/digit
  run to a single `-`, so `/my-notes` and `/my notes` produce the same index
  key and only one of them can ever be served. `collidingPaths(pubkey)`
  enumerates distinct paths sharing a key and the payload carries them as
  `collisions`; the panel names the collision rather than showing one green row
  for both. There is no resolution mechanism — naming it is the whole remedy
  today.
- **The panel reads one host; a link may prefer another.** Both the sweep and
  `publishBranch` use `PUBLIC_CONTENT_HOSTS[0]`
  (`content.pluginthematrix.com`) as the
  index host, while the link bundle lists `[selfDomain, ...PUBLIC_CONTENT_HOSTS]`
  when host sync is enabled. A self-domain-first visitor can therefore resolve
  bytes from a host the differential never probed, and a row can read `gone`
  or `unknown` for content a visitor is being served. Multi-host status is not
  implemented.
- **`markPublic` short-circuits within a session.** It skips sigs whose walk it
  already completed (`#markedWalk`), so a plain retry after a failure does
  nothing at all. `PublishOptions.forceReDrain` exists for this and the panel
  sets it for `pending`, `gone` and `stale-edge` rows — any state that is not a
  clean forward publish re-verifies and re-stages via `reDrain()`. Callers
  outside these two paths must remember to pass it.
- **Rows published from another device cannot be acted on.** An index key with
  no ledger record and no local mark has empty `segments`; it can be compared
  against the index but not sealed, published, or unpublished. `#run` says so
  explicitly rather than failing oddly; `#unpublish` returns silently.
- **`seenAt` is only populated on expand.** The offline "as of" line is read in
  `#refreshGaps`, so an unexpanded row shows `null` even though the observation
  was written during the sweep.
- **`hasAnyReceipt` has no caller yet.** It is the honest public read — unlike
  `hasReceipt`, which tests only the bare self-domain filename and therefore
  answers false for a CDN-only publisher (which is what `/host` produces by
  default). The differential currently proves service with `probeServed` and
  enumerates holes with `closureGaps`; nothing yet asks the cheap local
  question first.
- **There is no shell surface for `publish:render` yet.** The drone emits the
  payload and consumes the intents, but no component is registered in
  `hypercomb-shared/ui/shell-surfaces/shell-surfaces.barrel.ts`. Per
  `shell-surfaces.md` the panel must self-register (`registerShellSurface`) and
  must **not** be added as an `<hc-*>` tag in either `app.html` — a doctrine
  ratchet fails the suite for that. Until it exists, `/publish` toggles a
  surface nothing paints.
- **Confirmation windows are short by design and can under-report.** 20 s for
  the index round trip and 12 s for the link receipt; an edge that has not
  caught up returns `unconfirmed`/`linkReceipted: false` even though the
  publish succeeded. The row re-checks on its own; the copy says so.
