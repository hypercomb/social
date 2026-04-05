# Pollination Protocol

**Pollination is how contributions cross between domains in Hypercomb.** A contributor carries content from their own domain to another domain's module, hosts it themselves, and announces it. The receiving hive decides whether it grafts.

## Related Documents

- [pheromone-protocol.md](pheromone-protocol.md) — The signal counterpart: ambient annotations attached to content by signature
- [signature-expansion-doctrine.md](signature-expansion-doctrine.md) — Every artifact in a pollen packet is a signature-addressed fragment
- [dependency-signing.md](dependency-signing.md) — Bundles are signature-addressed modules; the same rules apply to pollen manifests
- [core-processor-architecture.md](core-processor-architecture.md) — How markers and domains are structured inside DCP
- [universal-history-plan.md](universal-history-plan.md) — Grafted pollen lands as history operations, not opaque merges

---

## The Problem

Today, external contributions to a DCP module require out-of-band coordination: someone zips files, sends them over, the owner opens them, reads them, decides. This does not scale, does not compose with the signature-addressed architecture, and gives no useful review leverage.

What is needed is a contribution primitive that:

1. Lets anyone outside the system offer content to a specific `(marker, domain)`
2. Requires no central hosting — the contributor hosts their own files
3. Is verifiable end-to-end via signatures, so the host cannot lie about content
4. Is filtered at the boundary before it is ever surfaced to the owner
5. Lets the owner graft it into their package on their own terms

## Shape of a Pollen Packet

A **pollen packet** is a manifest — a signature-addressed JSON resource — that ties a set of files together into one reviewable unit. The manifest signature IS the pollination's identity.

```jsonc
{
  "from": "contributor-domain.com",        // contributor's domain — their identity
  "target": {
    "marker": "<marker-signature>",
    "domain": "revolucionstyle.com"        // owner's domain being pollinated
  },
  "base": "<parent-manifest-signature>",   // the state the pollination was authored against
  "files": [
    { "path": "wheel/flavor-wheel.drone.ts", "sig": "a1b2..." },
    { "path": "wheel/taxonomy.json",          "sig": "c3d4..." }
  ],
  "intent": "<signature-of-human-readable-description>",
  "timestamp": 1712345678
}
```

Every field that could be content is a signature. The manifest itself, once canonicalized and hashed, has its own signature — that is what gets shared.

### Identity is domain ownership

A pollination must come `from` a domain. That domain IS the contributor's identity — there is no separate author field, no keys to manage, no self-asserted identity documents. Whoever controls the namespace controls the provenance, and the `(from → target.domain)` pair is what the owner sees as "who is pollinating this module."

This is strict by default: no domain, no pollination. Owners who want to accept anonymous or domainless contributions can opt into a relaxed mode on their own DCP instance — "accept any merkle" — but that is an explicit override, not the default path.

### What the contributor hosts

The contributor stands up any HTTP-reachable location (personal server, static host, IPFS gateway, GitHub Pages, blob storage — doesn't matter) laid out as:

```
<host>/manifest.json                 ← the pollen manifest (see above)
<host>/__resources__/<sig>           ← every file referenced in files[]
<host>/__resources__/<intent-sig>    ← the human-readable description
```

Because every file is addressed by its signature, the host cannot serve tampered content without breaking the hash check. If the host disappears after the pollination is grafted, the owner has already mirrored the resources into their own OPFS — the host is not load-bearing after adoption.

### How a pollination is announced

The manifest URL is announced over the existing Nostr sharing channel used by [diamondcoreprocessor.com/sharing/](../hypercomb-essentials/src/diamondcoreprocessor.com/sharing/). Nostr carries the pointer (`{ manifestUrl, manifestSig, target }`); the actual content stays on the contributor's host. This keeps the protocol a thin layer on top of what already works for sharing.

## The Stigma — Boundary Filter

When a DCP instance receives a pollination announcement for a `(marker, domain)` it cares about, it does not immediately show it to the owner. Every pollination has to cross a **stigma** — the receptive boundary of the receiving hive.

The stigma is a **pure admission predicate**: a deterministic function `(pollen-manifest-sig, current-state-sig) → {admit, reject, reason}`. It is not a judge. It does not weigh, evaluate, or form opinions. Same inputs produce the same verdict, forever — and that is what makes the verdict itself signature-addressable. A verdict is a fact about the inputs, not a decision about them.

The pipeline:

1. **Fetch** the manifest and every referenced resource from the contributor's host
2. **Verify** each resource's content against its declared signature — any mismatch, reject outright
3. **Diff** against the current state of that `(marker, domain)`. Because everything is signature-addressed, unchanged files share signatures — the diff reduces to the set-symmetric difference of file lists plus the pairs where `path` matches but `sig` differs
4. **Apply the stigma predicate**: a fixed set of rules — path-escape checks, IoC key collision checks, size bounds, structural validation, whatever the target domain specifies
5. **Gate visibility** — only pollinations that are admitted are surfaced to the owner for that marker+domain. Shed pollinations are recorded with a rejection reason but not shown by default

The stigma gates **visibility**, not auto-graft. The owner is never bypassed. The stigma is there to prevent the owner's view from becoming a spam funnel and to catch obvious structural problems at the boundary, before any human attention is required.

> **This entire pipeline runs on the DCP side, never on hypercomb.io.** hypercomb.io is the dumb storage/hosting layer — it serves bytes by signature and carries no pollination logic. All fetching, verification, diffing, filtering, and gating happens inside the owner's Diamond Core Processor instance. hypercomb.io must stay free of pollination-aware code.

### Why purity matters

The stigma is pure — deterministic, no hidden inputs, no model state, no wall-clock dependencies — because purity is what makes it fit the rest of the architecture:

- **Verdicts are content-addressable.** `(stigma-drone-sig, manifest-sig, base-sig) → verdict-sig` is a memoizable triple. Anyone with those three signatures can verify the verdict without re-running the stigma.
- **Every input is explicit.** The stigma reads only the manifest, its resources, and the current module state. Nothing external. No API calls, no weights, no clocks.
- **It is auditable as code.** Every rejection has a line number. Every rule is readable. There is no post-hoc rationalization of a forward pass.
- **It is reimplementable.** A second implementation in a different language will produce identical verdicts on identical inputs. No consensus drift across platforms.
- **It composes with the signature algebra.** The stigma is itself a signature-addressed fragment that produces signature-addressed verdicts. It slots into history, memoization, and sharing like any other fragment.

This purity is also why the stigma is **not a judge**. A judge has discretion — it weighs cases, forms opinions, decides gray areas. A stigma does none of that. It applies a fixed predicate. The word "judge" was a category error carried over from the AI scaffolding phase, where discretion was the mechanism. Pure rules do not judge; they decide as a property of their inputs.

### Stigma drone ships with the module

The target domain's module may ship a **stigma drone** under a conventional IoC key (e.g., `@<domain>/PollinationStigma`). If present, DCP loads it and uses it to filter incoming pollinations for that domain. If absent, DCP falls back to a built-in default stigma that performs signature verification, path-escape checks, IoC key collision checks, and basic structural validation.

This means the owner of a domain defines what "receptive" means for their own module, and contributors can fetch the stigma drone and run it locally *before* pollinating — so they know in advance whether their pollen will take. The stigma itself is a signature-addressed, community-forkable drone like any other.

> **The v0 stigma is scaffolding.** The initial implementation — including the built-in default — is an AI-driven placeholder, deliberately temporary. It exists to bootstrap the protocol so pollinations can flow end-to-end before the real rule code is written. The long-term stigma is **hand-written human code**: deterministic rule checks, structural validation, explicit policy. AI review is a stopgap for v0, not the design target — an AI is not pure, its "verdicts" are samples from a distribution, and it cannot participate in the signature algebra the way real stigmas must. Any work on the stigma should assume it will be replaced, keep the interface narrow, and avoid baking AI-specific assumptions into the rest of the protocol.

## Grafting

When the owner next connects DCP and opens the affected `(marker, domain)`, they see any pending pollinations that the stigma admitted. For each:

- The stigma's verdict and the rules that fired
- The file-level diff (signature-addressed, so "unchanged" is cheap and certain)
- The contributor's intent description
- A single action: **Graft**

Grafting pulls the resources out of the contributor's host and into the owner's OPFS under `__resources__/`, then appends a history operation to the module's lineage that references the pollen manifest signature. That history entry is the permanent record of the graft — auditable, reversible, shareable.

Shedding the pollination simply drops it. Because it was never merged into the owner's tree, nothing needs cleanup.

### Trim before grafting

Before grafting, the owner can **drop files** from a pollen packet — trimming its scope to a subset of what was offered. They cannot modify file contents; that would put words in the contributor's mouth. If the owner wants different content, they graft the trimmed subset and then edit using normal history operations afterward. This gives practical cherry-pick power without inventing a parallel review-comment system.

## Wilting (Withdrawal)

A contributor who discovers a flaw in their own pollination can publish a **wilt announcement** over Nostr, referencing the original manifest signature with a reason (itself a signature-addressed resource).

- If the owner has **not yet grafted** the pollination, DCP removes it from the pending view silently.
- If the pollination has **already been grafted**, DCP surfaces a notification on the affected marker+domain. The owner decides whether to append a revert history op. History is immutable — wilting is advisory, never destructive.

## Why This Fits The Architecture

- **No new primitives.** A pollen packet is a manifest, which is a signature-addressed resource, which is already the universal composition mechanism
- **No central storage.** The contributor hosts; the owner mirrors on graft; Nostr carries the announcement
- **No trust in the host.** Signature verification makes tampering detectable
- **The stigma is part of the signature algebra.** A pure predicate over signatures produces signature-addressable verdicts; nothing sits outside the merkle tree
- **Composes with history.** A grafted pollination is just another history operation pointing at a manifest signature — it participates in undo, time-travel, and sharing like any other op
- **Deduplication falls out for free.** If a pollen packet contains files identical to what the owner already has, the signatures match and nothing is downloaded twice

## Scope: DCP Only

This protocol lives entirely inside Diamond Core Processor. hypercomb.io has no role in it beyond storage — it serves signature-addressed bytes and nothing else. There are no pollination endpoints on hypercomb.io, no pending queues, no stigma invocations, no view state. Every step — fetch, verify, diff, filter, surface, trim, graft, revert — happens on the DCP side where the stigma drone and the owner's interactive session live.

If a design discussion ever proposes adding "just a little" pollination-awareness to hypercomb.io, that is a signal the wrong layer is being edited. Push it back down into DCP.
