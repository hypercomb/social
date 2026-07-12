# Aggregation-Layer Model — menus are layers, not bespoke pools

**Status: DESIGN — 2026-07-12. Supersedes the `sign('websites:menu')` pool
as the membership store.**

## The principle

The layer is *the* primitive. Anything built on it inherits undo/redo, the
optimize phase, and sharing **for free**, because those are properties of
layers. The moment a feature keeps its truth in a store *beside* the layer
model — its own markers, its own enable/disable API, its own history — it has
forfeited all of that and is reimplementing by hand what a layer would have
given it. That is the litmus for "doing it wrong": **if it needs its own
undo, it should have been a layer.**

Applied to curated aggregations (the Websites menu, and any menu like it):
a menu is **a layer whose children are its members.** Enabling a site is one
commit that adds a child; disabling is one commit that removes one. Undo/redo
is the location's normal history. The launcher render is a derived read of
that layer. Nothing bespoke.

## Reconciling the old rationale (local ≠ non-layer)

`websites-pool.ts` chose a pool deliberately, and its reasoning was half
right: menu membership is **extrinsic and participant-local** — it is *about*
cells, it differs per participant, and it must **not travel with adoption**
(copying a page-stamped subtree must not pollute the copier's menu). The
error was equating "local" with "not a layer."

A layer can be **local**. The launcher pages already are: each group's page
(`/websites`, `/games`) is a **leaf-only lineage bag** — a committed layer at
its own single-segment root that is *never linked into the hive tree*, never
in the syncable closure, and never rides the mesh (see `mixed-group-bag.ts`).
So a menu can be a layer **and** stay local at the same time:

- **layer** → undo/redo, the optimize phase, time-travel, all free;
- **disconnected + unsynced** → extrinsic, per-participant, doesn't travel
  with adoption — exactly the pool's original intent.

That is the whole reconciliation. The pool bought locality by giving up the
layer; the disconnected page-layer keeps both.

## The model

A curated group `g` owns the page location `[g]` (e.g. `['websites']`). Its
layer's `children` **are** the membership. Each child is a **launcher cell**:
a child location `[g, <label>]` whose layer carries a single `launch:target`
decoration whose payload references the member:

```
{ kind: 'launch:target',
  payload: { segments: [...siteRoot], label, icon, shape, key } }
```

`segments` is a **reference** to the member's real root in the hive tree — a
signature-style pointer, never a copy. The site's content lives in the main
tree and folds/shares on its own; the menu only points at it.

| Operation | Was (pool) | Now (layer) |
|---|---|---|
| enable(segments, meta) | write a `sign('websites:menu')` record | commit a launcher child into `[g]`'s children |
| disable(segments) | remove the pool record | commit `[g]`'s children minus that child |
| list() | read the pool | read `[g]`'s layer children |
| undo / redo | *impossible* | the `[g]` location's normal history |
| optimize | *n/a* | derived caches keyed off `[g]`'s head sig |

Because enable/disable are ordinary commits at `[g]`, standing on `/websites`
and pressing undo removes the last menu change and redo restores it — the
same linear, append-only history every location has (per-page history is
already shipped). No new undo path, no bespoke markers.

`MixedGroupBag.#reconcile` already commits `[g]`'s launcher children; this
model simply makes those children the **source of truth** instead of a
projection of the pool. Reconcile keeps its arrangement role (order, collision
labels), but membership no longer round-trips through a second store.

## Curated vs derived — pick the store by what the data *is*

Not every aggregation is curated truth:

- **Curated** (Websites) — the participant adds/removes members; the set is
  undoable truth → **a layer** (this model).
- **Derived** (Games) — membership *is* "every registered `genotype:'game'`
  bee," a pure read-time derivation with nothing to undo → **not a layer and
  not a pool**; a read-time list, or an optimize-phase cache keyed off the
  registry. Never a bespoke truth store.

The rule is per the optimize-phase litmus — *"could a cold client rebuild
this from layers alone?"* Curated truth: no → layer. Pure derivation: yes →
cache/read. A bespoke pool is the wrong answer for either.

## The undo/redo opt-out flag (`resourceScope`)

A behavior may declare where its resources live, on its descriptor next to
`adoptScope`:

```
resourceScope?: 'layer' | 'derived'   // default 'layer'
```

- `'layer'` (default) — the behavior's resources are truth and ride the
  layers: undoable, shareable, optimizable, and they **fold as a group** with
  the tiles (see below). Websites are `'layer'`.
- `'derived'` — the resources are transient or purely derived; they ride a
  pool-of-meaning or an optimize-phase cache instead, and are **not** in the
  undo timeline.

The flag is not a tracking toggle — it picks the **storage target**. A layer
*is* the history, so "on the layer but hidden from undo" is not a state.
Opting out therefore also opts out of folding-with-the-group and
sharing-as-truth; that is correct, and it is just the truth-vs-cache line
drawn once, per behavior. Reserve `'derived'` for data you genuinely would
not want in undo.

## Where behavior resources live (the storage-care point)

The parent-vs-tile duality of a website is **signature composition, not a
conflict**:

- The site **root** holds its pages *by signature* (its `website` slot /
  children sigs) — the **group handle**: its closure is the whole site.
- Each **page tile's own layer** holds *its* page decoration —
  `{ kind: 'visual:website:page', payload: { htmlSig } }` — in its
  `decorations` slot: the **individual tie**.

Both hold at once. "Accept the website" is therefore just the layer fold
(`adoptScope: 'hierarchy'`): because the page decoration and its `htmlSig`
live *in each tile's layer*, folding the root's subtree carries every page's
decoration and every resource along — content-addressed, deduped, tile by
tile. Each tile "gets decorated" not by a second pass but because its layer
already carried the decoration through the fold. The group moves together and
each tile keeps its own tied resource, and it is all undoable/shareable
because it is all layers. This is the default (`resourceScope: 'layer'`) and
needs no change — only documenting.

## Activation — dormant until turned on

The same layer-vs-flag reasoning answers *"what does adopt do, and what runs
after it."*

**Adopt folds the whole subtree — structure now, bytes lazy.** Accepting a
hive folds its entire tile tree in one gesture: every child signature enters
your hive immediately (the structure is complete — nothing truncated), and
the bytes resolve lazily behind the readiness shade (cold tiles brighten in
place as they arrive). Complete-or-defer moves from *bytes* to *structure*:
the structure is always complete; the bytes fill in. You prune what you don't
want with the ordinary tile-delete — there is no special adopt-undo and no
"tiles" surface in the Beehaviors window.

**Behaviors arrive dormant — present but ignored.** A folded behavior
decoration sits in its tile's layer, but *presence no longer means running*.
The default for anything you didn't author is **ignored**: the render/behavior
gate skips it until it is activated. This flips the old opt-out model
(presence = active; write a `sign('hidden')` flag per behavior you turn OFF)
to **opt-in** (presence = ignored; write one activation flag per behavior you
turn ON).

**Opt-in is fewer flags, not more.** You need exactly one bit of activation
state either way — only the default differs. Adopt a 200-tile hive and light
up three websites → three activation records. The dormant default costs
**zero** flags: at rest, with no extra state at all, everything folded is
quietly ignored. The opt-out model would have you writing a hidden-flag for
almost everything you *didn't* want. Fewer writes, and it matches the intent —
you got the whole thing; you light up what you want.

**The one rule the flip forces.** Presence ≠ active, so authored content needs
a default, or you'd have to hand-activate every tile you make. One line:

> **active = authored-by-you OR explicitly-activated.**
> Adopted-and-not-yet-activated = present but ignored.

That composes with what already exists — `isLocallyAuthored` / the
verification gate already say adopted foreign things don't auto-run. This
generalizes it: the switch defaults **off** for anything you didn't author,
and for a gated behavior "activate" *is* "allow" (honest-switch's
here / allowed / **running** — the activation flag is the *running* bit).

**Where the activation set lives.** It is curated truth you set and would want
to undo, so — by the doctrine at the top of this document — it is
**layer-committed** (undoable), not a bespoke pool: the same move as menu
membership. One opt-in flag, written rarely, on a layer, replacing the
two-store (hidden pool + menu pool) machinery with one consistent primitive.

## Migration — SHIPPED (development, `e92a2638`)

Websites converged onto this model:

1. `listWebsites()` reads `['websites']`'s layer children — `listAggregation`
   decodes each launcher cell's `launch:target` payload.
2. The Beehaviors website-row switch, the `website:build` hook, and the seed
   walk all call `enableAggregation`; the landing's `×` calls
   `disableAggregation` — every mutation an ordinary commit at `['websites']`.
   Launcher cells live at `['websites', <label>]`, so two same-named sites are
   disambiguated by label (they'd otherwise collide on one child location).
3. `websites-pool.ts` is demoted to **only the seed sentinel**. There is *no
   drain*: the interim marker-chain membership format never shipped to the
   wild, so nothing out there ever wrote it — there is nothing to fold in.
4. Games stay derived; `resourceScope: 'layer' | 'derived'` landed on the
   visual-bee descriptor.

Known follow-up (an **adapter** concern, not a data concern): the `/websites`
landing renders the layer *head*, not the history *cursor* — so data-level
undo works (spec-proven) but the visible menu doesn't step back on undo yet.
Fixing it is a cursor-aware read in the landing adapter plus dropping
`MixedGroupBag`'s reconcile/`jumpToLatest` snap for curated groups — the same
cursor-aware read the compose-from-root site renderer needs.

The activation model above (dormant-until-activated, one opt-in layer flag) is
**designed, not yet built** — it lands with the Beehaviors-window redesign
(adopt-folds-the-subtree, behaviors-only window, row-toggle + elegant
checkbox).
