# The intake filter — you choose who, marks choose what

**Status: BUILT 2026-09-04 — and INERT BY DESIGN until a participant expresses
an interest.** Selection was already built; the mark gate, the `InterestRegistry`
behind it and all four call sites now ship. What does not exist yet is a
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

`marksOf(target)`
([pheromone-marks.ts:132](../hypercomb-essentials/src/pheromones/pheromone-marks.ts:132))
had exactly one caller — the file that defines it. It now has a consumer:
`pheromones/intake-filter.ts`, applied at four call sites. At each intake point,
before a record is kept:

1. read the marks the content wears
2. drop if it carries a mark the participant excluded (DROP wins, always)
3. keep if it carries one they enrolled in — or if they have named no KEEP set,
   in which case everything that was not dropped is kept

**The registry must be loaded for any of that to happen**, and nothing else in
the tree loads it. The gate therefore kicks `ensureLoaded()` itself, once per
registry instance: the sync gate starts the load and does not wait (a filter
mid-load must never blank a render), the async commit gate awaits it (or the
first arrival of every session would slip past a filter that was actually set).
Without that kick the sets stay empty for the life of the session and the
filter ships present, tested, and never once refusing anything.

## Where the gate sits — two carriers, two shapes

The intake points do not determine the gate's shape. **The carrier does.**
`marksOf` is a union of two reads with completely different costs:

| Carrier | Read | Cost |
|---|---|---|
| location / label | `tagsForSegments` · `tagsForLabel` ([decoration-kind-index.ts:185](../hypercomb-essentials/src/commands/decoration-kind-index.ts:185)) | **synchronous, O(1)**, in-memory index — *"the badge renderer and show-cell's tag aggregation read this per visible cell"* |
| signature | `sigMarksOf` | **async**, one OPFS read per sig |

Only the sig half is async. That single fact decides everything below, and it
means most of the gate needs no new machinery at all.

Each intake point turns out to have **two** decision moments, and the codebase
has already taken a position on both:

| Site | Moment | Rate | Identity in hand | Gate |
|---|---|---|---|---|
| [published-pools.ts:195](../hypercomb-essentials/src/sharing/published-pools.ts:195) | commit | ≤64 per domain/meaning/session | `sig` | `await marksOf({ sig })` |
| [swarm.drone.ts:1545](../hypercomb-essentials/src/sharing/swarm.drone.ts:1545) tile source | render | every render of the location | `locKey/name`, `peerPubkey` | **sync** `tagsForSegments` |
| [swarm-adopt.drone.ts:708](../hypercomb-essentials/src/sharing/swarm-adopt.drone.ts:708) `wandEligible` | mid-gesture (POINTERDOWN) | per press | `label` | **sync** `tagsForLabel` |
| [swarm-adopt.drone.ts:858](../hypercomb-essentials/src/sharing/swarm-adopt.drone.ts:858) `#adoptPageTile` | commit | per adopt | `segments` + `layerSig` | `await marksOf({ segments, sig })` |

### The rule that falls out

**A sync moment may only ask the location carrier; the async commit asks the
union.** This is not a limitation to work around — it is the same shape as
*hide first, delete second*: the cheap gate suppresses, the authoritative gate
refuses at admission. A mark that only the sig carries will not stop a tile
being drawn, but it will stop it being taken.

Both existing filters at these sites already obey it, which is the precedent to
follow rather than invent:

- the swarm tile source filters with `readHiddenLineages()` and
  `swarmFilterSelection()` — both sync set lookups, and the comment says why:
  *"Path-keyed is sync (no `sign()` needed) and matches the user-visible
  identity of the tile."*
- `wandEligible` is documented as synchronous on purpose, so both callers can
  decide mid-gesture — *"which keeps the whole check off the async layer
  reads."*

Adding `await marksOf({ sig })` inside the tile source would put one OPFS read
per peer tile on every render of the location. That is the one way to get this
wrong.

### What it actually costs

- **published-pools** — a drop-in. The loop is already `async` and already
  per-sig; the check goes between `verifiedMember` and `handler.accept`, with
  no restructuring.
- **swarm tile source** — one more sync `.filter()` beside the two that are
  already there. No new machinery.
- **adopt** — the sync half is one more condition in `wandEligible`; the async
  half sits where `layerSig` is already resolved.
- **sig marks at render time** — the only piece needing anything new: a
  pre-resolved warm set, modelled on `SwarmFilterService` (in-memory,
  session-only, EffectBus change events). Worth deferring until something
  actually needs it, because the location carrier covers the common case.

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

## Owed

- **The gate itself** — four call sites, traced above. Needs nothing new except
  at one of them (sig marks at render time).
- **A surface for editing an interest.** The registry, the gate and the four
  call sites are built; nothing yet lets a participant SAY which marks they
  want. Until something does, every verdict is the empty-set default (allow),
  which is why shipping it changes nothing on its own.
- **A decision on polarity.** An interest is a set you are watching FOR, which
  reads positive: keep what carries an enrolled mark. The one filter shipping
  today is the opposite (empty selection = everyone shows), and a positive
  default shows a fresh participant nothing until they hold an interest. The
  shareable-signature route above makes that survivable, but the default is
  still a call, and it is not the code's to make.
