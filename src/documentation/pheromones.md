# Pheromones — living signals over dead labels

**Status: DESIGN — pinned 2026-07-09 (Jaime). Not built.**
Companions: `public-content-endpoint.md` (the shelf this curates),
`optimize-phase.md` (where fields are minted).

## The idea, verbatim

Tags are what an author says once. Pheromones are what the swarm keeps
saying: signed deposits on a sig, with **depositor, intensity, and decay**.
The community's refinements accumulate into each participant's filters —
curation without moderators, exactly how a colony does it (stigmergy).

## Why this answers pollution

The public shelf is storage-neutral (quota + expiry + revocation handle
abuse of *bytes*). Pollution is a **discovery** problem: what gets
surfaced, followed, recommended. Pheromones solve it economically, not
administratively:

- **Evaporation is the cleaner.** A trail nobody reinforces fades from
  every filter on its own. Junk doesn't need takedowns — it needs to be
  ignored. Spam must re-deposit continuously, spending quota and burning
  an identity that filters learn to discount.
- **Negative pheromones are the same primitive** — "spam", "tampered",
  "nsfw" marks. A BUD-09 report IS a negative deposit. One mechanism,
  both directions.

## Storage model (Jaime, 2026-07-09): histories in `sign('pheromones')`

Pheromones are NOT a new storage primitive. They are **histories** — the
same append-only sigbag lineages as everything else — living in the
`sign('pheromones')` pool of meaning:

```
<opfs root>/<sign('pheromones')>/<lineage-per-target>/0000, 0001, …
```

- One lineage per target; each **deposit appends one marker** referencing
  a sig-addressed deposit record (signed event bytes at the content root
  — signature-reference doctrine, never inline).
- The trail IS the history. Intensity and decay are **read-time
  evaluations** over the deposit chain — evaporation never rewrites or
  deletes markers; append-only stays sacred, the trail fades by
  evaluation.
- Time-travel free: "what did the swarm think of this last month" is
  just reading the history at a cursor, like any lineage.
- Sharing/merging free: histories are already the merkle-shareable
  primitive — peers exchange pheromone lineages like any other, merged
  under the existing marks+merge model.
- Aggregated per-sig fields remain derived caches (optimize phase),
  keyed by the history HEAD sig — changed history = new head = automatic
  invalidation.

**Canonical meaning string: `'pheromones'`** — fix the spelling once and
forever. `sign()` of a typo mints a different pool address for eternity;
derive at runtime via `Store.poolSignature('pheromones')`, never
hardcode the hex.

## Mapping onto existing primitives (nothing new invented)

| Pheromone piece | Existing primitive |
|---|---|
| Deposit | signed event/decoration referencing the target sig — publisher sig authoritative, every deposit attributable |
| Kind | the tag taxonomy (tags = decoration kind 'tag') gains intensity + decay; a classic tag ≡ author's pheromone with no decay |
| Evaporation | the grant/expiry lease pattern applied to signals |
| Field (aggregated intensities per sig) | **derived cache** — pure derivation of deposits, keyed by input sigs, minted in the optimize phase, wipe-safe, NEVER truth (litmus: cold client rebuilds from deposits alone → optimization-class) |
| Filter | participant-local blend: which kinds count, whose deposits count, thresholds — never global, never in history |
| Trails feeding layout | meaning-curved geometry + proximity warming can read intensity later |

## Sybil discipline (the one hard rule)

Raw deposit-count is spammable for free. Intensity must be weighted by
relationship, not volume: vouches, adopted-from lineage, domain
reputation, and each participant's own trust blend. A thousand fresh
pubkeys shouting = one stranger whispering.

## Not now

Build after the public write path + share UX land. First slice when it
comes: deposit event shape + per-sig field in a derived-cache pool + one
filter consumer (discovery surface), negative-kind included from day one.
