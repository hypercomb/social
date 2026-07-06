# entrances and reference sets (pools of meaning)

> **status: design — not built (as of 2026-07-03).** Captures the agreed model
> from the design session: entrances as chosen share roots, reference sets as
> lineage pools under a reserved `sets/` prefix, the Pools of Meaning board,
> tagging notes, and scope-filtered views. No code ships this yet.

## related

- [glossary.md](glossary.md) — sigbag: "the max marker IS the current root +
  entrance + attestation in one"
- [history-sigbag-as-root.md](history-sigbag-as-root.md) — "root layer sigs are
  graph entrances, and the set of entrances = the set of sigbags"
- [tag-pools.md](tag-pools.md) — the named-signature-pool primitive and the
  deterministic meaning-head formula (deferred index for scoped filters)
- [sign-meaning-pool-migration-plan.md](sign-meaning-pool-migration-plan.md) —
  the marker-bag primitive, two modes: **lineage** (ordered, max = head) and
  **pool of meaning** (unordered membership set)

---

## the idea

Sharing should never mean "here is the root of my hive." A publisher opens
**entrances** — named, chosen roots — and shares from an entrance of their own
choosing. Multiple hives, multiple entrances, one keeper.

Once sharing means "publish from a chosen entrance," privacy stops being a
property you enforce and becomes a property that falls out: **anything not
under a published entrance is unreachable by construction.** That is what makes
**reference sets** possible — collections of references to your own tiles,
rooted outside every published entrance, so you can reference everything
without intrinsically sharing anything.

## entrances

Mechanically nothing is missing. Every lineage already has a sigbag at the
OPFS root (`sha256(segments + room + secret)` → `<lineageSig>/`, `000x` markers,
max = head; legacy `__hive__/` and `__history__/` are read-fallback drains —
highest marker wins across sources), so **every cell is already a valid
entrance**. What's missing is
choice: publishing is hardwired to the publisher's current location
(`#publishMyLayerAt` reads `lineage.explorerSegments()` in
[swarm.drone.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/sharing/swarm.drone.ts)).

An entrance is `{ label, segments }` — mechanically a named
`MeetingInviteBundle`
([meeting-invite.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/sharing/meeting-invite.ts)
already encodes `segments + room + secret → reproducible channel sig`).

- **Publisher-side only.** The adopt side is already root-agnostic: it resolves
  whatever `layerSig` it is handed and treats it as the root. A consumer
  subscribing via an entrance's channel sig sees that subtree *as* the hive.
- **`/entrance <name>`** at a cell opens an entrance there. Registry is
  participant-local (the `adopted-roots.ts` localStorage pattern).
- **The apiary** is the keeper's view of their entrances: list, open/quiet
  toggle, share-as-invite per entrance.

The standing entrance registry of the app:

| entrance | reaches |
|---|---|
| **hive** (default) | the participant's tree — empty segments → the hive root sigbag; where a plain visit lands |
| **dcp/** | the install — its own sigbags per adopted domain (already separate today) |
| **sets/<name>** | one entrance per reference set (new) |

## reference sets are lineage pools

**A pool is just a location.** Not a domain, not a server, not a hosted or
registered thing — a lineage path in the participant's own tree, mechanically
identical to any page in the hive. Nothing to resolve over the network, no
mesh or host involvement, no new identity primitive: the mesh never sees a set
unless an entrance is deliberately opened on it. The references inside are
also just locations (`targetSegments`).

There is no migration and no new pool type. A set rooted at `sets/music` gets
its own sigbag the moment a layer is committed there; that sigbag's max marker
IS the set's root — its entrance. Each set = one lineage pool = one root = one
entrance into your information.

- **Reserved prefix.** The root name is theoretically arbitrary — the lineage
  sig doesn't care — but navigation needs the convention, exactly like `agg-`
  pages are recognised by string prefix. `sets/` is that convention: set
  chrome, reference-aware behaviour, excluded from publish.
- **A reference is a tile.** A reference item is an ordinary cell whose layer
  carries a dedicated `reference` slot: `{ targetSegments }`. Rendering stays
  100% normal (it's a real cell), with an indicator that it is a reference.
  No content is duplicated — the target's content stays where it lives.
- **Live pointer semantics.** `targetSegments` is a path, so a reference always
  resolves to the target lineage's *current* head — "still working with the
  same information." A sig-pinned (frozen) reference is a possible later
  variant, not part of this design.

### the privacy invariant

**A set's root must never appear in any published layer's `children[]`.**
Reachability is what sharing means: an adopter can only walk the closure of the
entrance they were given. Not linked → not walkable → not shared.

Leaf-only commits (the per-page history model — cascade stopped) already
guarantee this can't happen by accident: committing inside `sets/music` never
touches the hive root's children. Belt-and-braces: the publisher refuses to
publish any entrance whose closure covers `sets/` (same class of rule as
"viewport never in history").

## the Pools of Meaning board

The board is just a page — the uniform paradigm, no aggregate machinery:

1. **A "Pools of Meaning" meaning-icon** in the top chrome (peer of websites /
   games / dashboard / help). Clicking it navigates to the `sets/` entrance.
   Aggregate icons are **one-state portals** (2026-07-03): click = bring up
   that aggregate's layer; clicking another replaces it (one at a time);
   clicking the same one again is idempotent. The layer then simply STAYS —
   no toggle-off, no close-watch reset, and no special leave gestures: Escape
   and right-click mean exactly what they mean on any other page, and you
   leave by navigating. Being on a page IS the state.
2. **The `sets/` page shows each set as a tile.** Its children ARE the sets.
3. **Creating a tile there creates a set.** No special dialog — plain tile
   creation at the `sets/` lineage.
4. **Entering a set manages it.** References render as tiles; add, remove,
   reorder, tag with the ordinary tools.
5. **Adding a reference** uses the add flow with a **select operation**: the
   add window gains a picker mode — browse the hive, choose a cell, and the
   chosen cell's segments become the new reference tile's `reference` slot.
6. **Clicking a reference tile is a portal** — navigate into the target
   (precedent: tile-borne `swarm:invite` portals). Shift+click back-nav and
   ctrl+click selection keep their global meanings.

### two faces of a set (terminology bridge)

Per the marker-bag primitive, a set has both identities:

- **WHERE** — its lineage address under `sets/` (ordered `000x` sigbag; layout
  is meaning, tiles have slot order).
- **WHAT** — its membership. The deterministic meaning-head over the member
  references ([tag-pools.md](tag-pools.md) formula:
  `sign(canonicalJSON(sort(dedupe(memberSigs))))`) gives a set a
  content-address *by meaning*. **Deferred** — computed on demand if and when
  scoped filtering needs the index; never materialised eagerly.

That is why the board is named Pools of Meaning: each set is a named pool
whose meaning is its membership.

## tags on notes (everything has the attributes)

Because everything uses the layer framework, everything is taggable once an
interface exists. Notes are already content-addressed layers (`NoteLayer`,
[notes.drone.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/notes/notes.drone.ts)),
so tags ride the existing mechanism unchanged: a note layer carries its own
`decorations` slot holding `kind:'tag'` decoration sigs (the appliesTo-empty
dedup pattern from `decoration-manifest.ts`). No note-specific tag system.

- **Multi-select** in the notes strip (ctrl+click / checkboxes), plus bracket
  syntax reuse: `[note1,note3]:project-x` (`bracket.behavior.ts` already parses
  `[a,b]:[t1,~t2]` for tiles).
- **Sig-churn rule:** editing a note re-signs it (new sig = new id); the edit
  path must carry the `decorations` slot forward to the new sig.

## scoped filters (constancy)

The global filters accept an active **scope**: a set (membership = its
references) or a tag (membership = forward tag edges). With a project's set as
the scope, the whole UI filters to that project — different layouts for
different projects, same information.

Resolution is on-demand and memoized (genome-style walk). No eager materialised
pools — the deterministic meaning-head above is the upgrade path *if* walking
ever gets slow, per the tag-pools decision.

Doc-level metaphor: foragers exhibit *flower constancy* — one flower species
per trip. Setting your filters to one set is the forager committing to a
patch. The UI word stays plain ("scope").

## phases

| phase | delivers | key touchpoints |
|---|---|---|
| 1 | entrances + apiary: `/entrance`, participant-local registry, publish-from-entrance, apiary board, publish-exclusion guard | `swarm.drone.ts` publish path, `meeting-invite.ts`, `adopted-roots.ts` pattern |
| 2 | sets + board: `sets/` prefix recognition, `reference` slot, Pools of Meaning launcher, select-mode picker, portal click | launcher registry (`group-registry.ts`), tile-editor picker mode, show-cell reference indicator |
| 3 | note tagging: decorations slot on note layers, multi-select, bracket syntax, sig-churn carry-forward | `notes.drone.ts`, notes-strip, `bracket.behavior.ts`, `decoration-manifest.ts` |
| 4 | scoped filters: scope = set or tag, memoized on-demand resolution | filter walk, command-line scope function |

## non-goals

- No new storage primitive, no migration — sets are ordinary lineages.
- No eager materialised pools or inverse indexes (deferred, evidence-triggered).
- No sig-pinned (frozen) references in v1 — live path pointers only.
- Entrances do not change the adopt side — publisher-side feature only.

## proposed glossary additions (on implementation)

- **entrance** — a named, chosen root a keeper shares from; mechanically the
  max marker of a lineage's sigbag. Every cell is a valid entrance; opening one
  names it and publishes it deliberately.
- **apiary** — the keeper's collection of entrances/hives: what is shown, what
  each exposes.
- **reference set** (user-facing: **set**, board: **Pools of Meaning**) — a
  lineage pool under `sets/` whose members are reference tiles; referenceable
  by the keeper, never intrinsically shared.
- **reference** — a tile whose layer carries a `reference` slot
  (`{ targetSegments }`); a live pointer to another lineage, rendered normally,
  navigated as a portal.
