# hives: an entrance decides which beehaviors are available

> **status: design — not built (2026-10-30).** Written from a read of the
> loader (`hypercomb-runtime/src/script-preloader.ts`, `arrival-plan.ts`,
> `acquire.ts`) and the install port (`hypercomb-core/src/install.types.ts`).
> Nothing here ships yet. jwize's premise: enter through different hive
> entrances, each naming only the build it needs, while the whole source stays
> held so every entrance stays stable.

## related

- [entrances-and-sets.md](entrances-and-sets.md): entrances as chosen SHARE
  roots (publisher side). A hive is the LOAD-side counterpart, a different axis.
- [feature-tuning-garage.md](feature-tuning-garage.md): installer recipes and
  capability tags (design). A hive is a recipe that the loader obeys.
- [optimize-phase.md](optimize-phase.md): derived caches, never truth.
- [pheromones.md](pheromones.md), [intake-filter.md](intake-filter.md): the
  swarm-sharing side.

## the idea

A **hive** is a signed, named selection of beehaviors. It answers one question
at boot: *which bees may run here, and how eagerly?* The package still holds
every bee. A hive narrows what is imported, compiled and run. It never removes
what is held, so any other hive over the same package keeps working.

Entering through a hive gives a precise environment: only the signatures that
build needs are loaded. Creating a hive is how you make such an environment on
purpose.

## what already exists (so the hive is small)

The loader is further along than a first read suggests. A hive composes four
existing mechanisms rather than adding a new one:

| mechanism | where | what it gives a hive |
|---|---|---|
| **Activation record** | `acquire.ts` writes it; `script-preloader.ts` reads it (`readManifestBees`) | "The layers say what EXISTS; the record says what runs." A hive is a named, signed record. |
| **Off units** | `InstallProvider.offUnits / setOffUnits`, `package-units.ts` | Per-path on/off that survives updates. A hive's exclusion set is this, made shareable. |
| **Arrival plan** | `arrival-plan.ts` (`resolveArrival`, `BeeClass`) | Plan by IoC class name, resolved through each bee's declared `deps` transitively. Everything outside it is PASSIVE. |
| **Passive and wake** | `BeeClass.passive / wakesOn / renders`, `loader:activate`, `ARRIVAL_GRACE_MS` | Held, not compiled, woken on demand. A stalled or wrong plan wakes the rest after a grace period, so a sparse hive degrades to the old speed instead of failing. |

Render-critical bees (`criticalBees`) always stay: without them there is no
hive to turn anything back on from. A hive never overrides that.

What is **missing** is only: (1) a hive as a first-class, signed, named object;
(2) choosing one at the entrance; (3) a depth knob; (4) a way to author one;
(5) sharing one.

## the hive object

A hive is a sig-named resource (JSON), content-addressed like every other
layer-adjacent resource. No inline content that can be a signature.

```jsonc
{
  "name": "solomon-only",                 // label; identity is the signature
  "package": "<package root sig>",        // the build it was cut from
  "core": "<core surface sig>",           // the surface it expects (core surface gate)
  "arrival": ["ViewBee", "SolomonGame"],  // IoC class names, never bee sigs (survive rebuilds)
  "off": ["games/arkanoid"],              // package paths turned off
  "tiers": {                              // optional; class name -> 0 | 1 | 2
    "SolomonGame": 0,
    "ChatWindow": 1
  },
  "depth": 1                              // default tier loaded eagerly
}
```

Why class names and paths, not bee signatures: `arrival-plan.ts` already
settled this (a bee sig changes on every rebuild; its IoC key does not). A
hive therefore keeps working across revisions of the same package and only
needs re-cutting when the package's *shape* changes.

A hive lives in a **pool of meaning**, not a typed folder: `sign('hives')` is
derived at runtime via `Store.poolSignature('hives')`, never hardcoded. Members
are hive resource signatures; the label is the member name. (Confirm against
`isReservedPoolWord`; `hives` is not a reserved bare word today, but check the
registry before landing.)

## tiers and depth

Depth is the "tune the initial response" knob. Three tiers, all built from
existing states:

- **Tier 0, arrival.** Loaded before first paint. Equivalent to today's arrival
  plan plus `criticalBees`.
- **Tier 1, idle.** Loaded after the first `synchronize`, in small idle
  batches (the same discipline as `#preheatAtIdle`: the boot IO census showed a
  flood of reads queues behind the renderer).
- **Tier 2, on demand.** PASSIVE: held, not compiled, woken by `wakesOn`,
  a queen's word being used, or a view in `renders` being entered.

`depth` is the highest tier loaded eagerly: `0` is the sparsest and fastest
entry, `1` adds the idle tier, `2` loads everything (today's behaviour). A
face with no tier is tier 0; a bee no face reaches is tier 2; a bee a face needs
takes the earliest tier of any face reaching it. Turning the knob re-cuts nothing; it only
changes the filter at boot, so it can be a URL or settings value.

A sparse hive that guessed wrong costs at most the existing `ARRIVAL_GRACE_MS`
before the wake-all fallback. That fallback stays; it is what makes aggressive
depth safe.

## choosing a hive at the entrance

1. The entrance carries a hive signature (query parameter or pointer; no
   personal data in the URL).
2. Boot reads the hive, checks `package` and `core` against what is held
   (core surface gate: a hive naming a surface the shell lacks is refused
   with the reason, not half-loaded).
3. `ScriptPreloader` filters `walked.bees` by `resolveArrival(hive.arrival)`
   minus `hive.off`, applies tiers, and leaves the rest passive. This is the
   same place the activation-record filter and `#decideArrival` already run.
4. Switching hives is a reload with a different signature. Nothing is wiped:
   OPFS user data and held bees are untouched (see the OPFS rules in
   `CLAUDE.md`). Only the activation record read at boot changes.
5. No hive named means today's behaviour exactly.

Missing bytes are fetched by the existing verified acquisition. A hive adds no
fetch path.

## authoring

- **Cut from observation.** Run a real session, record which bees actually
  activated (the loader already knows: `#beeCache`, wake events), and propose
  that set as the hive. The author trims it.
- **Cut from a sentence.** An authored plan, like the published-branch
  `arrival` plans jwize already uses, resolved and validated against the
  package: `resolveArrival` returns `missing` for any named class the package
  lacks, which the authoring step must surface.
- **Validate before publish.** Walk the closure; flag any bee that reads a
  service no member provides (the implicit-dependency risk), and any `off`
  path that a member needs.
- Publishing a hive is an ordinary revision act (one act that mints), not a
  side effect of a build. Per the publish doctrine, a plain build stamps
  nothing.

## sharing in swarms

A hive is one small signature, so it is the unit that makes behaviours
shareable:

- Peers adopting the same hive signature have the same behaviours available.
  Bee bytes arrive by the normal replication; each peer fetches only what it
  lacks.
- A fork is a new hive signature over the same bees. Nothing is copied.
- **Receiving a hive never activates it.** Adoption is an explicit act on the
  receiver's side, passing the activation authority gate like any package. A
  hive cannot admit a bee its closure does not name, and it cannot widen the
  receiver's trust. Trust stays an allowance the receiver grants, now granted
  once per hive.
- Where it is listed: the `hives` pool, unioned across followed community
  hosts, like every other pool (see pools-across-hosts). A hive from a host is
  a belief about a build, not a copy of third-party bytes.

## risks

1. **Implicit dependencies.** A bee reading a service it does not declare in
   `deps` is missed by the closure. Mitigation: validation at authoring plus
   the existing wake-all fallback.
2. **Shell skew.** A hive built against an older core surface. Mitigation: the
   `core` field and the surface gate.
3. **Tier 2 cold wake.** A woken bee whose bytes are not yet local. Needs a
   defined wait or fallback; today's wake path already fetches, but the hive
   should state the behaviour.
4. **Class-name collisions.** `resolveArrival` already refuses an ambiguous
   case-fold; hives inherit that rule.
5. **Read-only readers.** `features:participant` already silences some bees
   for visitors; a hive composes with it (hive narrows, participant gate
   narrows further). It never widens.

## doctrine check

- No second structure, no mirror pass, no typed folder: a hive is a resource
  plus a pool member.
- No pheromone as classifier: the hive says which bees run, not what anything
  IS.
- Nothing deleted: a hive hides, it never removes (hide first, delete second).
- Derived caches (e.g. a precomputed closure for a hive) belong to the
  optimize phase, keyed by hive signature, never load-bearing.

## phases

| phase | delivers |
|---|---|
| 1 | Hive resource shape + parser + `resolveHive()` (pure, in `arrival-plan.ts` neighbourhood) with specs; no loader change. |
| 2 | Loader filter: one hive selected by URL/pointer, depth 0/2 only; wake-all fallback unchanged. |
| 3 | Tiers 0/1/2, idle batching for tier 1, depth knob in settings. |
| 4 | Authoring: observation cut + validation; publish as a revision into the `hives` pool. |
| 5 | Swarm: list across followed hosts, explicit adoption through the authority gate. |

## open questions for jwize

- Hive pointer form at the entrance: query parameter, subdomain, or a
  signed pointer in the install channel?
- Is `depth` a property of the hive, of the visitor's device, or both
  (the hive default, overridden per device)?
- Should the first prototype target a published-branch door (where arrival
  plans already live) or the participant's own hive?
