# Pheromone Protocol

**Pheromones are signals about code, attached to content by signature.** Where [pollination](pollination-protocol.md) moves *matter* between hives, pheromones move *signals* between bees. A pheromone is an ambient, advisory annotation left on a fragment — a file, a cell, a drone, a resource — that other bees can read as a cue about what to do, what to notice, or what to avoid.

## Related Documents

- [pollination-protocol.md](pollination-protocol.md) — How content crosses between domains (matter). Pheromones are the signal counterpart
- [signature-system.md](signature-system.md) — Pheromones reference targets by signature, never by path
- [universal-history-plan.md](universal-history-plan.md) — Pheromones are NOT history ops; they live in a parallel space
- [core-processor-architecture.md](core-processor-architecture.md) — Where pheromones surface inside DCP

---

## Why a Separate Primitive

Pheromones and pollinations are both social signals between domains, but they solve different problems and must not be conflated:

| | Pollination | Pheromone |
|---|---|---|
| **Carries** | Content (files, resources) | Signals (annotations about content) |
| **Changes the module?** | Yes, on graft | No, ever |
| **Needs owner acceptance?** | Yes, explicit graft step | No, ambient |
| **In the merkle tree?** | Yes, after graft | No, parallel space |
| **Lifecycle** | Proposed → grafted or shed | Emitted → decays or is refreshed |
| **Authority required** | Must come from a domain | Must come from a domain |
| **Effect if ignored** | Nothing happens | Nothing happens |

Pollination is an *act*: something crosses a boundary and either takes or doesn't. Pheromones are an *atmosphere*: they accumulate, decay, and bias attention without ever forcing it. A hive can function with zero pheromones. But once they exist, they're how bees coordinate without central instruction.

## Shape of a Pheromone

A pheromone is a signature-addressed JSON resource that references its target by signature and carries a small payload:

```jsonc
{
  "target": "<signature-of-fragment-being-marked>",   // what this pheromone is attached to
  "from": "contributor-domain.com",                   // emitter's domain — their identity
  "kind": "forage" | "ripe" | "off" | "trail" | "queen" | "bloom",
  "payload": "<signature-of-human-readable-body>",    // optional, may be null
  "strength": 0.0,                                    // 0.0–1.0, initial intensity
  "emitted": 1712345678,
  "halfLife": 604800                                  // seconds until strength halves
}
```

The pheromone itself, once canonicalized and hashed, has its own signature. That is the pheromone's identity. Like every other fragment in Hypercomb, pheromones are content-addressed and deduplicated — if two bees emit the exact same pheromone, they collapse to one signature.

### Attachment is by signature, not path

This is the critical property. A pheromone references its target by **signature**, which means:

- **Rename the file: pheromone still attached.** File paths are not part of the target; the content is.
- **Move it in the tree: pheromone still attached.** Tree location is not part of the target.
- **Pollinate it into another domain: pheromone travels with it.** When the receiving hive grafts the fragment, the pheromones that reference its signature are still discoverable, because the reference is to content.
- **Fork the module: pheromones apply to both forks.** Anywhere that signature exists, the pheromone applies.

Pheromones stick to **content, not location.** This is only possible because everything is content-addressed.

## Kinds of Pheromone

The `kind` field is an open set — modules can define their own — but the protocol ships with a small base vocabulary chosen to match real hive behavior:

- **`forage`** — "come look here." A signal pointing other bees toward a fragment worth attention. Accumulates on well-trafficked paths.
- **`ripe`** — "this fragment welcomes change." Emitted by the target domain's owner (or anyone) to indicate that pollinations in this area are welcome. A standing invitation.
- **`off`** — "smells wrong here." A concern signal. Not a rejection, not a vote — just a bee saying "I noticed something." Useful when a contributor isn't ready to do a full pollination but wants to leave a flag.
- **`trail`** — "I pollinated from here." A breadcrumb showing provenance and fork points. Emitted automatically when a contributor bases a pollination on a fragment.
- **`queen`** — "this is authoritative." Emitted by a domain owner to mark fragments as load-bearing, stable, or canonical. Signals to other bees that changes here need extra care.
- **`bloom`** — "fresh content here." A short-lived signal that a fragment is new or recently changed. Decays quickly.

Modules are free to add their own kinds. Because pheromones are ambient and advisory, an unknown kind is simply ignored rather than errored on.

## Emission and Propagation

A bee emits a pheromone by publishing the pheromone resource to its own host and announcing it over the existing Nostr sharing channel. The announcement carries `{ pheromoneSig, target, kind, from }` — enough for any receiving DCP to decide whether it cares.

- **The emitter hosts the pheromone.** Same hosting model as pollination — contributor-owned, signature-verifiable, no central server.
- **Nostr carries the announcement**, not the pheromone itself. Small payload, cheap to broadcast.
- **Receiving hives subscribe by target signature**, not by emitter. If a DCP holds fragment `abc...` in its merkle tree, it watches for pheromones attached to `abc...` regardless of who emits them.
- **Pheromones are not in the module's merkle tree.** They live in a parallel signature-addressed space (`__pheromones__/<sig>` in OPFS), indexed by target signature. Grafting a pollination does not touch pheromones; emitting a pheromone does not touch the module.

## Decay

Every pheromone carries a `halfLife`. Its effective strength at any moment is:

```
effective = strength * 0.5 ^ ((now - emitted) / halfLife)
```

Once `effective` drops below a noise floor (say, 0.05), the pheromone is no longer surfaced by default. It is not deleted — the resource still exists, the signature still resolves — but UIs stop highlighting it. Bees that want to refresh a pheromone simply re-emit it; the new emission gets a fresh timestamp and the sum of two overlapping emissions can exceed either alone, modeling reinforcement.

This gives you the real hive property: **attention is self-pruning.** Old signals fade unless something keeps them alive. Spam pheromones die naturally. Load-bearing signals stay visible as long as someone keeps reinforcing them.

## Identity and Trust

Like pollination, every pheromone must come `from` a domain. Domain ownership is the identity anchor — no keys, no author fields, no self-asserted identity documents. The `from` field is what lets receiving hives apply trust weights: you can configure your DCP to amplify pheromones from domains you trust, dampen pheromones from domains you don't, and ignore pheromones from domains you've blocked.

This is where pheromones diverge most sharply from pollinations. A pollination is binary: you graft it or you don't. A pheromone is weighted: the same signal from different emitters contributes differently to your total picture. Two bees you trust saying "off" outweigh ten bees you don't.

There is no stigma for pheromones. They do not cross a boundary into your module — they stay in the parallel space — so there is nothing for a boundary filter to filter. What *is* pure and deterministic is the **aggregation**: given a set of pheromones attached to a target and a set of trust weights, the resulting "smell" of that fragment is a pure function of its inputs. Same inputs, same smell, forever. That aggregation participates in the signature algebra the same way a stigma verdict does.

## How Pheromones Surface in DCP

When the owner opens a fragment in DCP — a cell, a file, a drone — the UI queries the parallel pheromone space for any pheromones attached to that fragment's signature and renders a summary:

- **A smell** — aggregated signal across all pheromones attached, weighted by emitter trust and decayed by time
- **Top emitters** — which domains are contributing most strongly
- **Recent blooms** — newly emitted pheromones, even if their strength is still low
- **Trails** — where this fragment has been pollinated from and to

None of this changes the fragment. None of it requires acceptance. It is ambient context, shown alongside the content the same way Git might show `blame` alongside a file — except it's social rather than historical.

## What Pheromones Are Not

To keep this primitive narrow, some things are explicitly out of scope:

- **Not comments.** Comments are code annotations that live inside the file and travel with it in the merkle tree. Pheromones live outside and reference by signature.
- **Not reviews.** Reviews are part of an acceptance pipeline. Pheromones have no pipeline — they are ambient. The stigma is the boundary; pheromones do not gate anything.
- **Not votes.** Pheromones are signals, not decisions. There is no count, no threshold, no outcome derived from them. Aggregation is for presentation, not for authority.
- **Not moderation.** A pheromone cannot remove, hide, or block a fragment. It can only say "I notice this." The owner of the receiving DCP decides what to do with that signal, if anything.
- **Not in history.** Pheromones are never history operations. Emitting or decaying a pheromone does not append to any lineage. History is for content; pheromones are for atmosphere.

## Scope: DCP Only

Like pollination, this protocol lives entirely inside Diamond Core Processor. hypercomb.io stores bytes by signature and nothing else — no pheromone endpoints, no aggregation, no smell computation, no trust weighting. Every step — fetch, decay, aggregate, weight, surface — happens on the DCP side where the interactive session lives.

If a design discussion ever proposes adding "just a little" pheromone-awareness to hypercomb.io, that is a signal the wrong layer is being edited. Push it back down into DCP.

## Why This Fits The Architecture

- **No new primitives.** A pheromone is a signature-addressed resource referencing another signature-addressed resource — the universal composition pattern.
- **Attachment survives everything.** Because pheromones reference by signature, they follow content across renames, moves, forks, and pollinations automatically.
- **Self-pruning attention.** Decay gives a natural spam defense without any moderation layer.
- **Orthogonal to pollination.** Neither primitive depends on the other, but together they cover both content flow and signal flow between domains.
- **Aggregation is pure.** The computed "smell" of a fragment is a deterministic function of its pheromones and trust weights — it fits the signature algebra like any other pure function.
