# The intake filter — you choose who, marks choose what

**Status: BUILT 2026-09-04 — and INERT BY DESIGN until a participant expresses
an interest.** Selection was already built; the mark gate, the `InterestRegistry`
behind it and all three gate sites now ship. What does not exist yet is a
surface for SAYING which marks you want, so every verdict today is the
empty-set default: allow. That is deliberate — a filter that started dropping
content on upgrade would be the worst version of this feature.
**Stated by Jaime, 2026-09-03:**

> You don't query unexpected items from other people — you decide if you want
> external, and which external participants you want to get from. There'll be
> all sorts of pheromones and other things, and you filter down to what relates
> to you. Of course people can put malicious content in there, but people tag
> it and you filter that out too. And because of that you can break apart the
> pheromones into more precise details that some participants may have, or
> enroll in.

Companions: `pools-across-hosts.md` (how a pool is discovered across hosts),
`pheromones.md` (the deposit half — making content FOUND),
`uniform-decoration.md` (one decoration design for everything),
`swarm-participant-filter.md` (the render-time pubkey filter, built),
`trust-boundary-and-the-extension-question.md` (the separate gate on running code),
`known-location-pools.md` (the root vocabulary).

**The one sentence:** nothing here is a crawl — you take from participants you
chose, what arrives is filtered by the marks it wears, and marks break apart
into finer marks you enroll in, so the filter sharpens without a release.

## Three gates, and conflating them is the mistake

Everything below is about the first two. The third is a different document, and
the two lists behind them are not the same list.

| Gate | Question | Where | Status |
|---|---|---|---|
| **Selection** | who do I take from? | `community:hosts` pool, mesh consent, swarm filter | BUILT |
| **Intake** | what do I keep of what arrives? | marks on the content | **BUILT** (inert until an interest is set) |
| **Activation** | what may execute? | `hc:community:domains` + TrustService | BUILT |

Selection and activation are already known to disagree — see **Open**.

## Selection: you never query everybody

The probe is deliberately not a crawl. From
[published-pools.ts:39](../hypercomb-essentials/src/sharing/published-pools.ts:39):

> Probing is once per (origin, meaning) per session, and **only for domains this
> participant already learned** — the broker's `domain:learned` effect, which
> fires for the self domain, community domains, and any host the mesh or an
> adopt handoff taught us.

And the ask each chosen domain gets is bounded on purpose:

- `MAX_MEMBERS = 64` — *"a curated list, not a database dump; past this
  something is wrong and we would be spending the participant's bandwidth
  finding out."*
- `MAX_MEMBER_BYTES = 256 KB` — *"stops a hostile index from turning a probe
  into a download."*
- **Every member is verified.** A domain names a sig; bytes that do not hash to
  it are dropped. A domain can only ever offer content whose identity it cannot
  forge.
- **The origin rides along.** Handlers are told which domain offered a record,
  so provenance is showable and a record asking for something sensitive can be
  held until the participant says yes.

Peers are selected the same way, one layer down: mesh subscribes are
consent-gated (kind-30205 → Accept / No thanks, decisions persist across
reloads, [subscribe-consent.drone.ts](../hypercomb-essentials/src/sharing/subscribe-consent.drone.ts)),
and the swarm canvas takes a multi-select of pubkeys
([swarm-filter.service.ts](../hypercomb-essentials/src/sharing/swarm-filter.service.ts)).

### What verification buys, and what it does not

Per-member hashing buys **integrity, not currency**. A host you carry cannot
serve you bytes that are not what they claim to be. It can still withhold, or
serve you an honest but stale head, and no hash will tell you. Selection is
therefore not made redundant by verification — choosing who you ask is the part
that addresses what hashing cannot.

## Intake: the mark gate

`sigMarksOf(sig)`
([pheromone-marks.ts](../hypercomb-essentials/src/pheromones/pheromone-marks.ts))
reads the marks a participant has put on exact BYTES. It has a second consumer
in `pheromones/intake-filter.ts`, applied at three gate sites. At each intake
point, before a record is kept:

1. read the marks the content wears
2. drop if it carries a mark the participant excluded (DROP wins, always)
3. keep if it carries one they enrolled in — or if they have named no KEEP set,
   in which case everything that was not dropped is kept

**UNKNOWN IS NOT ABSENT, and this is the difference between a filter and a
blackout.** The carrier is participant-LOCAL: `sigMarksOf` reads this
participant's own `pheromones:content` pool. Content that has just arrived from
somebody else has no record there, so it presents **zero marks** — not "no marks
I want", but "no marks I have heard of yet".

So a KEEP set may only ever exclude something that CARRIES marks and carries
none of yours. Judged the other way, naming a single interest would refuse every
peer tile in the swarm, every member a domain publishes, and every branch
anybody offers. An adversarial review raised exactly that as a blocker; its own
verification stage refuted it three votes to nil, and it was right the first
time.

The consequence worth stating plainly: **until marks travel WITH content, a KEEP
set can only narrow things you already hold.** DROP has the same limit — it
cannot fire on a mark nobody local has recorded. That is the ceiling on this
gate, and it is a property of where marks live, not of the gate.

**The registry must be loaded for any of that to happen**, and nothing else in
the tree loads it. The gate therefore kicks `ensureLoaded()` itself, once per
registry instance: the sync gate starts the load and does not wait (a filter
mid-load must never blank a render), the async commit gate awaits it (or the
first arrival of every session would slip past a filter that was actually set).
Without that kick the sets stay empty for the life of the session and the
filter ships present, tested, and never once refusing anything.

## Where the gate sits — one carrier, two shapes

**The address of an offering is its SIGNATURE, never its path.**

The gate read the location carrier as well, for one release, and that was a
false-evidence bug rather than a missing feature. A location is where a
stranger's offering would LAND; it is not a description of it. Two things
followed, and both were live:

> A peer publishing a tile named `notes` into a page where you already hold a
> `notes` tile was judged **by your own tile's marks**. Mark yours `private`
> with `private` in your DROP set and their unrelated tile vanished from the
> swarm; mark yours `cigars` with a KEEP set and theirs was admitted having
> satisfied nothing.

Co-located same-name is not exotic. It is the ordinary case the tile source's
own `kind:name` dedup exists to resolve, and a REFERENCE tile is named after its
target by construction — *"a reference and its target ALWAYS share a name"*
([decoration-kind-index.ts](../hypercomb-essentials/src/commands/decoration-kind-index.ts)).
The index itself was made location-aware for that exact reason; the gate then
used the location as if it were an identity, which is the same mistake one level
up.

A signature cannot collide that way. It names the bytes themselves, so a mark
keyed by one is about the thing being offered no matter whose hive it came from
or where it would sit. It is the only carrier that survives crossing a hive
boundary, and therefore the only one admissible at intake. `IntakeTarget` is a
signature and nothing else, and a ratchet in `intake-filter.spec.ts` holds the
gate's import list against the location carrier returning — nothing about
`tagsForSegments([...loc.segments, name])` *looks* wrong at a call site, so the
import is the thing to hold.

### Two gates over the one carrier

| Gate | Read | Cost |
|---|---|---|
| `allowsHere` | `sigMarksKnown` — the in-memory record cache | **synchronous, O(1)**; `undefined` for a signature never read |
| `allows` | `await sigMarksOf` | **async**, one OPFS read per sig, cached thereafter |

Where each sits:

| Site | Moment | Rate | Identity in hand | Gate |
|---|---|---|---|---|
| [published-pools.ts](../hypercomb-essentials/src/sharing/published-pools.ts) | commit | at most 64 per domain/meaning/session | `sig` | `await allows({ sig })` |
| [swarm.drone.ts](../hypercomb-essentials/src/sharing/swarm.drone.ts) tile source | render | every render of the location | peer entry's `layerSig` | **sync** `allowsHere({ sig })` |
| [swarm-adopt.drone.ts](../hypercomb-essentials/src/sharing/swarm-adopt.drone.ts) `#foldPageTile` | commit | per take, every path | `layerSig` | `await allows({ sig })` |

**The commit gate is on the PRIMITIVE, not on a caller.** `#foldPageTile` is the
single acquisition function, and four paths reach it: the wand (the only take a
finger can perform), the adopt panel, the retry, and the child fold of an
adopted branch. The gate first sat on `#adoptPageTile` — one of those four — so
a mark refused a take through the panel and admitted the same bytes through a
click. It also sits BELOW that function's own held-here return, because a tile
already in the hive is not arriving and re-judging it would refuse a sync of the
participant's own content.

`wandEligible` deliberately carries NO gate. It briefly did, and that was a
mistake: it has three consumers — pointerdown selection, the entry choke point,
and the *takeable shade* — so filtering there changed navigation and how tiles
look, well beyond deciding what enters the hive.

### The rule that falls out

**A sync moment may only ask what is already in memory; the async commit awaits
the read.** This is not a limitation to work around — it is the same shape as
*hide first, delete second*: the cheap gate suppresses what it already knows
about, the authoritative gate refuses at admission.

The sync gate is not therefore blind. On a miss it KICKS the read (once per
signature, ever) and answers `true` for that pass; peer content re-renders on
every relay arrival and every `synchronize`, so a marked signature is suppressed
within a frame or two of first sight. That is what *hide first* can honestly
promise while the evidence lives on disk. Adding an `await` inside the tile
source instead would put one OPFS read per peer tile on every render of the
location — the one way to get this wrong.

Both existing filters at that site already obey the shape, which is the
precedent followed rather than invented: `readHiddenLineages()` and
`swarmFilterSelection()` are both sync set lookups.

### Inert, and inert ON DISK

*"Changes nothing until a participant expresses an interest"* is two claims. The
verdict half was always true. The storage half was not.

Reaching the registry opened `sign('registry:interests')` — and
`sign('registry')` behind it, for the legacy fallback that was always going to
miss — with a **creating** handle, and the mark read opened
`sign('pheromones:content')`. So a participant who had never named an interest
grew three pool directories the first time a peer tile arrived. Empty
directories are not harmless in this root: it is an untagged union that walkers,
the collector and `/flatten` all enumerate, and a pool nobody wrote is noise in
every one of those passes. A pool directory is a claim that the participant uses
a feature, and a read must not make that claim on their behalf.

Two changes, and the seam spec fails without either:

- **`Store.openPool(meaning)`** — the read-only open, `create: false`, null when
  the pool does not exist. `registry-document.ts` prefers it on every read path,
  which fixes all four registries at once (bouquets, names, tags, interests);
  `pheromone-marks.ts` prefers it in `readRecord`. Writes still use `getPool`,
  which is what a writer wants.
- **`InterestRegistry.filters()`** — false until a KEEP or DROP role names a
  non-empty interest. The gate short-circuits on it, so a participant with no
  interest performs no mark read at all: there is no verdict a read could
  change. A registry too old to report is asked anyway — paying for a read beats
  skipping a refusal.

## Granularity is data, not code

This is the part that makes the filter worth building rather than a blocklist.
A mark is `family:name` —
[`relationMeaning(family, name)`](../hypercomb-essentials/src/pheromones/enrollment.ts:125) —
and `enrollmentsIn(cell, family)` reads at the family level. So:

- a coarse mark is broken apart by **minting finer ones**, exactly the way a
  creation is broken apart into parts that each stand alone
- a participant enrolls at whichever rung suits them: the whole family, or one
  precise name under it
- neither move is a code change, because classification is data

The filter therefore sharpens over time without a release, which is the general
rule in this codebase applied to marks rather than tiles: *if a change would
require editing code to change how something is classified, that classification
belongs on a tile as a pheromone instead.*

`/enroll` is already the verb. Nothing new is needed to express the granularity
— only something that reads it at intake.

## The set you are watching for is an INTEREST — and it already has a home

The gate needs to read the participant's own answer to *"which marks do I
want"*. That set does not need inventing, and it does not need a new pool. The
distinction is already drawn, precisely, in
[bouquet-registry.ts:8](../hypercomb-shared/core/bouquet-registry.ts:8):

> A bouquet is the set you PUT ON things together — `part` + `page` + `website`
> in one gesture. It is deliberately NOT the other thing a "group of
> pheromones" could mean: **a set you are WATCHING for is a filter over marks,
> derived at read time, and keeps its own word (`interest`)**. This registry
> holds only the first kind, because only the first kind is truth.

So the intake filter reads an **interest**, and an interest is the mirror of a
bouquet — same species, same storage pattern, opposite direction:

| | Bouquet | Interest |
|---|---|---|
| What it is | the marks you APPLY together | the marks you WATCH for |
| Direction | outbound — you scent things with it | inbound — it decides what you keep |
| Storage | current document of `sign('registry:bouquets')` | current document of `sign('registry:interests')` |
| Identity | sig of the sorted marks resource | the same |

The registries each own a **meaning of their own** — `registry:bouquets`,
`registry:names`, `registry:tags`, `registry:interests` — read and written
through `registry-document.ts`. The master record IS the pool's current
document: one meaning, one current member, one writer, and no pointer file to
dangle. `registry:interests` is seeded in `pool-registry.ts` and declared
`document` in `pool-kinds.ts`, exactly like its three siblings.

> An earlier revision of this document said *"no new pool of meaning is
> minted — `interests-master` is the fourth master record in
> `sign('registry')`."* That was true of the pattern it was written against and
> is now wrong: the shared `sign('registry')` directory gave four writers one
> directory plus an indirection, and the registries were moved onto their own
> document pools. The claim is corrected rather than deleted because the reason
> it changed is the useful part.

### Why this also answers the cold start

Bouquet marks are **sorted before signing**, so *"two participants who assemble
the same bouquet independently hold one resource, and a bouquet can be shared as
a signature the day sharing wants it."* An interest inherits that exactly.

That is the cold-start answer, and it is better than shipping a default
blocklist: a newcomer does not need one, because **an interest is a signature
someone can hand them.** Adopting a filter becomes the same act as adopting
anything else in this system — and because it is content-addressed, adopting it
does not bind you to its author. You hold a copy, you edit it, it becomes a
different signature, and nothing anywhere needs to be told.

## Marks about marks

A "this is malicious" tag is itself federated content, so it inherits the rule
above: **you only see tags from participants you chose.** There is no global
moderation authority, and there should not be one — a single arbiter of what is
malicious is exactly the shape this architecture exists to avoid.

The honest consequence: your defence is only as good as your chosen set, and a
brand-new participant's set is empty. That is the same cold-start shape
`community:hosts` has — the pool that would tell you who to trust ships inside
the content you are trying to evaluate — and it wants the same answer: a small
default set that opens the cycle and that the participant can replace entirely.

## Open

- **The swarm filter is default-everyone.** *"By default the render composites
  everyone. […] Empty selection = no filter = everyone shows."* Defensible where it
  sits — those are peers already accepted through consent — but the polarity is
  opt-out, and the doctrine above is opt-in.
- **Two lists both called "community", which never consult each other.**
  `community:hosts` (OPFS pool: where to fetch from, read by the hosts panel,
  publish targets and `ensureInstall`) and `hc:community:domains` (localStorage:
  whose code may run, read by TrustService and the content broker's byte
  cascade). Adding a host in the hosts panel does not add it to the broker's
  cascade. Already logged in `hypercomb-communication-layer.md`.
- **`/block-peer` is dev-only** — its own comment says a production version
  needs a signed nonce verified against a configured host pubkey. It is also
  one-way, with no unblock short of restarting the relay.
- **"Interest" already means something else in the mesh.**
  `SWARM_INTEREST_KIND` (30203, `sharing/swarm.drone.ts`) announces interest in
  a LOCATION — a subscription signal, not a filter over marks. Two meanings of
  one word, in the same subsystem. The same shape as the two lists both called
  "community" above, and worth settling before the word spreads further.

## Authored deposits — the ceiling partly lifted (BUILT 2026-09-13)

`pheromones/pheromone-deposits.ts` adds a SECOND signature-keyed carrier
alongside `sigMarksOf`: `depositKindsOf` / `depositKindsKnown`, verified marks
somebody else — a person, or an agent that read the content — authored on
exact bytes via a signed nostr event (`PHEROMONE_DEPOSIT_KIND`). Storage is
`sign('pheromones:deposits')/<targetSig>/<depositorPubkey>/<marker>`, one
bucket per (target, author) so independent depositors never collide, unioned
at read time (documentation/pheromones.md has the full storage rationale).
Both gates (`allowsHere`, `allows`) now merge `sigMarksOf ∪ depositKindsOf`
before asking the registry anything — an authored deposit judges exactly like
an own mark, and neither carrier can veto the other's evidence. Proven end to
end in `intake-filter-seam.spec.ts`'s "deposits authored by somebody else"
suite, including a stranger's independently-keyed signature and a tamper
check.

What this does NOT yet do: carry a deposit ALONGSIDE the content it marks
when that content crosses a hive boundary (the mesh/publish half — see
documentation/pheromones.md "Not now"). `mintDeposit` mints locally and
`depositKindsOf` reads whatever is already in this participant's own pool —
which today means their own deposits, or a peer's deposits that arrived by
some other path already union-merged into the same pool by the general
lineage-bag replication this participant's OPFS already does for any pool.
Nothing yet REACHES OUT to fetch a specific domain's deposits for a specific
signature the way `published-pools.ts` fetches other content.

## The declared vocabulary, and `/interest` (BUILT 2026-09-13)

Jaime, 2026-09-13, refining the direction after the deposit build landed:
*"we'll just get the part where we read pheromones and if they match
whatever we have in our pheromone collection then they show up... we need to
see the pheromone offerings from the sites... so if we want to turn on
pheromones that might be available but that we don't have them on we should
be able to select from"* — then, on how that offering list should be
modeled: *"Or maybe rather a pool of meaning."*

That is exactly `documentation/pools-across-hosts.md`'s `family:names`
pattern, reused rather than reinvented: `pheromones/pheromone-deposits.ts`
gained a second pool, `sign('pheromones:names')`, holding one tiny
content-addressed record per distinct kind this participant has minted or
received a deposit for (`knownPheromoneKinds()`). It answers a browsing
question — *what kinds exist to pick from* — kept structurally separate from
`pheromones:deposits`, which answers an intake question — *what does this
target carry*. `mintDeposit` registers its kind into the vocabulary
idempotently, awaited (not fire-and-forget: a caller listing
`knownPheromoneKinds()` right after minting must see it).

`commands/interest.queen.ts` is the editing surface this document's own
"Owed" list named as missing:

```
/interest                — list what you watch for, never want, and what's
                            available to add (known kinds not yet in either)
/interest cigars          — watch for "cigars" (KEEP)
/interest cigars, travel  — several at once
/interest ~cigars         — stop filtering on "cigars", wherever it sits
/interest !malicious      — never want "malicious" (DROP)
```

"Available to add" is `knownPheromoneKinds()` minus whatever is already in
KEEP or DROP — still anchor-first, still a LOCAL projection over what this
participant already holds, never a network enumeration (pheromones.md's
receptor-relative-meaning rule is unchanged: there is still no "list every
kind that exists" endpoint — this lists only what already reached you).

## Owed

- **Deposits published and probed like any other pool.** A domain that wants
  its deposits discoverable needs a `pheromones:deposits`-scoped
  `published-pools.ts` handler (the `set` pool kind already `replicates`, so
  `registerPublishedPool` will accept the meaning) so a probe can fetch a
  specific author's marks for a specific signature rather than waiting for
  them to already be present locally.
- **A surface for authoring a deposit deliberately.** `/deposit <mark>` /
  `/deposit <cell> = <mark>` (`commands/deposit.queen.ts`, BUILT 2026-09-13)
  is the command-line door — usable by a person typing it, or by an agent
  speaking the command line the same way (documentation/hive-read-fence.md).
  Deliberately NOT wired into the mouse-click scent gesture in
  tile-overlay.drone.ts, which resolves tiles by LABEL only and has no
  content signature in hand at click time; that gesture stays a location
  mark (`/keyword`'s territory) until the categorization migration below
  gives it a real home.
- **An agent that actually calls `/deposit` autonomously.** The door is open
  and tested (`deposit.queen.spec.ts`) — a person or an assistant driving
  the command line can use it today — but no routine in the tree calls it
  on its own yet. That is a decision about WHEN an agent should judge
  content worth marking, which still needs a trigger design, not just a
  door.
- ~~A surface for editing an interest.~~ **BUILT 2026-09-13:**
  `/interest` (`commands/interest.queen.ts`, above) — a participant can now
  say which marks they watch for or never want, and every verdict stops
  being the empty-set default the moment they do.
- **The vocabulary reaching further than "what I already hold."** Today
  `knownPheromoneKinds()` is a purely local projection — it lists kinds
  already in this participant's own `pheromones:names` pool, never a
  specific host's offerings fetched on demand. Turning `pheromones:names`
  into a `family:names` pool a specific host can be ASKED for
  (`documentation/pools-across-hosts.md`'s `GET /<sign(meaning)>/`) is the
  same missing piece as the "deposits published and probed" item above,
  applied to the vocabulary instead of the deposits themselves.
- **A decision on polarity.** An interest is a set you are watching FOR, which
  reads positive: keep what carries an enrolled mark. The one filter shipping
  today is the opposite (empty selection = everyone shows), and a positive
  default shows a fresh participant nothing until they hold an interest. The
  shareable-signature route above makes that survivable, but the default is
  still a call, and it is not the code's to make.
