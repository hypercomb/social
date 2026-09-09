# The reference designer — on empty hexes AND on tiles

> **Status: BUILT** (steps 1–6 of section 5 and the memo fence of section 8,
> 2026-09-06; the four re-points of section 6, 2026-09-06; the derived "group"
> line of section 7, 2026-09-09). Nothing owed.

The Portals panel lets you drag a portal onto an empty hex, name the tile, and
pick which of the portal's items it gathers. That is the designer. This doc
settles what the same drag means when it lands on an EXISTING tile, what the
name step means there, whether a tile may carry many references, and why four
people showed up on the root hive uninvited.

Shipped path, for orientation:

| step | where |
|---|---|
| drag source, `emptyOnly: true` | `hypercomb-shared/ui/aggregate-index/aggregate-index.component.ts` `#onRowPointerDown` |
| occupied hex refused (toast + red X) | same file `#applyDrop`; `tile-overlay.drone.ts` `#setDropRefusal` |
| name + pick | `hypercomb-shared/ui/references-window/references-window.component.ts` |
| write door | `hypercomb-essentials/src/commands/canonical-reference.service.ts` `place()` / `ensureRoot()` |
| the mark | a `reference` decoration on the child layer, `appliesTo: []` |

---

## 1. Two landings, one designer

**Empty hex — MINT.** A new tile is born at that slot. The name step is live
because the tile has no name yet. The chosen items become its children, each
child a reference tile. Built.

**Existing tile — GATHER.** The tile under the pointer becomes the holder. The
same window opens; the same items are picked; the chosen items are appended to
THAT tile's children as reference tiles. Nothing else about the tile changes:
same address, same face, same existing children. Owed.

The two are one gesture with one difference: whether a holder has to be minted
first. Dropping on `dolphin` is exactly "enter dolphin, drop on an empty hex",
minus the navigation.

## 2. The name step over a tile

The tile's NAME is its ADDRESS. There is no rename primitive; `/title` writes a
decoration and never re-addresses (`commands/title.queen.ts`). So over an
existing tile the designer shows the tile's name and does not offer to change
it.

This is the "glitch" you felt, named. In the mint gesture the name field means
"the address of a new tile". Over an existing tile the same field could only
mean one of two things, and both are wrong:

- **re-address the tile** — forbidden; it strands the history bag, viewport,
  marks, usage, every inbound reference.
- **mint a second tile with the new name** — then "drop on dolphin" silently
  produced a tile that is not dolphin, and dolphin got nothing.

So: a different name IS a different tile, and a different tile is the
empty-hex gesture. Under the molecule model this reads cleanly — the name is
the molecule, `sign(fold(canon(name)))`; changing it would mean a new molecule,
and a new molecule is minted by placing a new tile, never by editing an old one.
"Changing the name creates a new pool and leaves the old one alone" is right,
and the way to do it is to drop on an empty hex.

If a display-name change is wanted at the same moment, that is `/title` on the
holder afterwards. The designer does not fold two acts into one.

## 3. Holder, never pointer

"Any tile can have multiple references" is true in exactly one sense: a tile
may HOLD many reference children, one per target, alongside ordinary children.
A tile is never itself a pointer to several targets.

- a reference tile = one hop to one target. `referenceTargetByKey` is one
  target per cell and stays that way. `website-artifact-paradigm.md`: every
  reference is a META envelope carrying exactly one typed payload hop.
- the drop target is never turned into a reference. Reference-ness lands on the
  children the designer mints, not on the tile it landed on. A tile that
  pointed at two places would have no answer to "what does clicking it do".
- many holders may point at one target — that is the whole point of a pool of
  meaning (`reference.queen.ts`, `entrances-and-sets.md`).

So the second glitch dissolves the same way as the first: the gesture adds
pointers INSIDE the tile; it never makes the tile a pointer.

## 4. The root is a store, not a collection (the live bug)

You dropped a portal, named the holder `associates`, chose four people, and
`dylan`, `ilana`, `betz`, `paulo` appeared on the ROOT hive.

Cause — `canonical-reference.service.ts` `ensureRoot()`. Its premise, in its
own words, is *"Root membership is authoritative."* For every chosen item it:

1. flattens the item's subtree and `importTree`s a COPY at `/[name]`,
2. appends that copy to the root hive's children (`commitChildrenDeltas([], …)`),
3. re-appends it if it is ever found detached (the "re-link" branch),
4. points the new reference at `lineageKey([name])` — the path-keyed bag of a
   root child.

Every one of these conflates two different things:

| | what it is | who owns it |
|---|---|---|
| the OPFS root | where every atom is STORED, flat, sig-named | the store |
| the root hive | the `[]` lineage's children slot — one hive among hives | the participant |

Everything is atomized and lives at the OPFS root. Nothing about that makes it a
MEMBER of the root hive. Each hive is its own meaning; the root hive does not
take up everything, it is simply where everything is kept. Visibility is
membership, and membership is a mark the participant made — never a side effect
of being referenced somewhere.

**BUILT (2026-09-06): the home page draws from the `root-entries` molecule.**
Everything is on the root — every molecule and bag lives there, that is the
nature of the hive — and the home page shows ONE chosen pool of them: the
molecule `root-entries`, whose bag the empty path now signs. "On the root"
and "shown on the home page" are two different facts. A molecule not in that
pool is not hidden; it is in its own group, reachable at its address. Full
mechanism, dual pointer and costs: `documentation/root-entries.md`.

The service is the pre-molecule answer to a real problem ("two appearances of
one named item drifted apart, so give the name ONE canonical home"). The
molecule model answers it without moving anything: identity IS `sign(name)`,
a bag at the OPFS root that no hive has to list. `moleculeAddress()` exists in
core (`hypercomb-core/src/core/molecule-address.ts`); the write path does not
(`hypergraph-molecule-lineage.md`, *Execution order* step 3). The reference
designer is its natural first consumer.

It also violates SHARE RESOURCES, NEVER COPY: step 1 duplicates the subtree,
so the reference under `associates` points at a copy of `dylan`, not at dylan.

## 5. The path

1. **Identity = molecule, not root child.** `targetSig` becomes
   `moleculeAddress(name)`. `targetSegments` keeps the SOURCE route (where the
   item was discovered) as the dual-read fallback — `sign(name)` first, path
   second, per the doctrine's step 2. `canonicalReferenceName` stops being a
   second canon: the fold in `moleculeAddress` is the one canon.
2. **Delete the promotion.** `ensureRoot()` goes. No `importTree` copy, no
   `commitChildrenDeltas([], …)`, no re-link branch. `place()` writes the
   reference child under the holder and nothing anywhere else. The
   `canonical:variants` retain stays — it is a record inside a colon pool, not
   a membership. This is a deletion, the ratchet-friendly kind.
3. **Lift `emptyOnly`.** The drag announces `emptyOnly: false`; the overlay
   drops the refusal for occupied hexes; `#applyDrop` routes an occupied target
   to `references:compose` with `createTile: false` and the holder's segments.
   The trailing-click swallow stays.
4. **Designer over a tile.** With `createTile: false` the window shows the
   holder's name read-only, skips the ghost draft, and `save()` skips the
   `importTree` of a holder — it only runs the per-item `dropReferenceTile`
   loop against the holder. `finish()` returns to the origin and emits
   `reference:branch-ready` for the holder if it had no children before.
5. **Remove the dead limbs.** `referencePick` and its template block, and
   `dropContextOnTile` (zero callers) — the two earlier occupied-drop
   behaviours that were gutted and left in place. Gesture, window, write door:
   one path.
6. **Doctrine ratchet.** No file outside the committer may call
   `commitChildrenDeltas([], …)` — the root hive's membership is only ever
   written by an act the participant made on the root hive.

## 6. Repairing your hive

Probed over the bridge, 2026-09-06, while the hive sat on `/dolphin`:

| fact | observed |
|---|---|
| holder | `/dolphin/associates`, head carries 4 children + properties |
| the four | `/dylan`, `/ilana`, `/betz`, `/paulo` EXIST as root-level bags (copies of `/people/*`, which still exist, 11 children under `people`) |
| the references | each child under `associates` wears `reference → targetSegments ["dylan"]`, `targetSig` = the path-keyed bag of the ROOT COPY, not `/people/dylan` |
| root head via bridge | 15 children, the four NOT listed — the screen showed them, so either the root's membership advanced and was since rewound, or the surface painted them from the in-memory add. Not settled from outside the tab. |

Nothing was destroyed. HIDE FIRST: `/hide` any of the four still on the root
and they leave the surface; after step 2 lands nothing will ever re-link them.
The forward commit that drops any remaining root markers and re-points the four
references at `/people/<name>` (or at the molecule once step 1 lands) is one
small migration written with the fix — forward commit, nothing deleted, the
root-level copies stay as bags nobody lists.

## 7. Same people from either end — a category is a molecule

The thing that settles all of the above: a reference points at the SAME
person no matter how you arrived at it. `dylan` chosen through the `people`
portal, `dylan` reached at `/people/dylan`, `dylan` gathered under `associates`
— one identity, `sign('dylan')`. That is why a reference must never point at a
copy (section 4), and why the route of discovery is not part of what it points
at.

`people` is a category, and a category is a molecule: `sign('people')` plus the
members gathered under it. Membership is a mark a member WEARS, never a list a
parent holds. So the gesture works in both directions and both are ONE act,
enrollment:

| drag | act | what is minted |
|---|---|---|
| portal → surface (the designer) | "show these members here" | appearances: a holder plus a reference tile per member, each pointing at the member's molecule |
| tile → portal row (`portal-carry.drone.ts`) | "this tile is a member" | membership: the tile wears the mark; the portal, which READS the pool, now lists it |

Drag `susan` from the root onto the `people` row and susan is one of the
people — she does not move, nothing is copied, no child is appended anywhere.
Today that reverse drop runs `collections.source.ts` `add(into)` →
`dropReferenceTile` → the same write door as the designer, so it carries the
same root-promotion bug and writes a reference CHILD under the collection tile
instead of a mark on susan. Same fix, same door.

"Creating a molecule out of multiple items" is the designer on an empty hex
with a new name: the holder `associates` IS the new molecule, and the four
chosen people are enrolled in it as well as shown by it. In the near path
(section 5) the holder still commits its reference children; in the direction
(`reference-rule.ts`: the rule is truth, the result is derived) the holder
reads `sign('associates')` and the children are the members, recomputed, never
committed.

**The way back to the group — never a field on the holder.** You will want to
add more people from `people` to `associates` later, and to add a person to
`people` so they are there to be chosen. Both are the gestures above, again:
drop the `people` portal on `associates` (GATHER appends to what is there), and
drag a tile onto the `people` row (ENROLL) or create inside `people`. Nothing
records "gathered from people" on the holder's layer — a back-pointer there
would move the holder's signature every time its members changed and ruin the
merkle tree. The group is DERIVED: the common parent of the routes the
reference children already carry. BUILT 2026-09-09: over a holder the window
derives it (`references-window/gathered-from.ts`, most common parent of the
children's routes, ties to the first seen) and shows "Already gathered from
{group}" with one door, "Choose more from {group}", which makes the group the
picker's source and lands the choices under the same holder. Nothing is
written; the line is absent while the holder gathers nothing, and while the
group is the very portal in hand.

**Showing who a holder references — the facet, not a pair-word.** A pool named
`associates:people` was considered and set aside: two user words around a
colon is refused by the address gate (`address-syntax.md` rule 3), and nobody
could type it as a word, so it is not discoverable. The grammar already has
the shape: the FACET `sign('references:' + sign('people'))` — a collection
about one subject, derivable from the subject alone. Standing on `people` the
surface asks "which facets exist about me" over the closed vocabulary and
answers "referenced from associates" without a listing. It is a derived index
over the `reference` marks the members already wear; nothing new is spelled.

One consequence to say out loud rather than discover: the `people` tile on the
root and the `people` portal under `sets/` are today two tiles with one name.
Under the molecule they are one grammar — the same-name collapse the lineage
doc requires to be announced, never silent. Here it is the feature: there is
one `people`, and every door onto it shows the same members.

## 8. The holder does not click through (live bug)

Clicking `associates` opens the editor; only the hold enters it. Confirmed from
the renderer's own `render:cell-count` for `/dolphin`: `associates` is absent
from `branchLabels` while its head carries four children. The overlay routes a
click to enter only for `branchLabels` members or reference tiles
(`tile-overlay.drone.ts` `#onClick`); a holder is neither, so it gets `open`.

Why the branch set is stale, in the order the designer writes:

1. the holder is minted → the parent (`dolphin`) re-commits, its memo
   `#completeChildNamesByParentSig` is rebuilt under the NEW parent sig with
   `associates` as a leaf — correct at that moment.
2. the picker navigates away; the four children are appended to `associates`.
   Per-page history commits the leaf only, so the parent's sig does not move
   and its memo still says leaf. `cell:added` invalidates the ancestor memo —
   but a neighbourhood prepare that was already in flight (started while the
   picker was on `/people`) writes its pre-add answer back AFTER the
   invalidation. The memo is then authoritative for that sig until the parent
   re-commits or the tab reloads.
3. `reference:branch-ready` is a render-only flip on return; the next slow
   render re-reads the stale memo and paints the leaf again.

The designer's arrival signal is a patch over a race in the memo. Fix the memo:

- **Fence the memo write with a generation.** Bump a counter on every
  `cell:added` / `cell:removed`; a prepare pass captures it at start and
  discards its result if the counter moved. A pre-add answer can then never
  land after the invalidation. This also retires the case-by-case flips that
  `show-cell.drone.ts` has accumulated for "can't click into the branch until
  I refresh".
- **The holder's own head is truth.** `readFreshBranches` already reads it on a
  miss; the fence guarantees the miss.
- With the on-tile gesture the holder is already mounted, so no ghost, no
  arrival wait — the same fence covers it.
