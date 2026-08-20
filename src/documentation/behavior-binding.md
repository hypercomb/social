# Behaviour binding — a behaviour that belongs to one tile

Most behaviours are hive-wide. A gallery is a gallery anywhere; a dropbox is a
dropbox anywhere. Some are not. The post-it that **is** the `/revolucion/meetup`
page has exactly one meaning in the whole hive, and treating it as hive-wide
costs twice:

- every other tile's Beehaviors panel offers a behaviour that can never belong
  there — noise in a list whose whole job is to say what applies here;
- the one tile it *does* belong to says nothing about that. Its row looks the
  same as any other, when in fact the tile and the behaviour are one thing.

**Binding** fixes both ends with one record. Bind a decoration kind to a tile
and the behaviour is awake at that tile (and its subtree) and dormant
everywhere else — and the row that survives, at the tile it belongs to, is
marked as belonging to it.

```
/behavior bind postit meetup          # a tile on the layer you are standing on
/behavior bind postit /revolucion/meetup   # or an absolute path
/behavior bind postit                 # or the tile you are standing on
/behavior where postit                # what does it belong to?
/behavior free postit                 # give it back to the whole hive
```

## The signature is a LOCATION signature

Binding records the tile's **location signature** —
`sha256(lineageKey(segments))`, what `HistoryService.sign` returns, the address
of the tile's lineage sigbag.

This is the whole reason the feature works, and it is worth being explicit
about, because "signature" in this codebase usually means a *content* sig:

| | changes when | good for binding? |
|---|---|---|
| content signature | every edit to the layer | **no** — the binding would break on the author's next keystroke |
| location signature | the tile is renamed or moved | **yes** — it holds for as long as the tile is called what it is called |

"Belongs to that tile" is a claim about the *place*, not about the bytes
currently sitting in it. The location sig is that place, named once, in a form
that is stable, derivable from the name the author typed, and identical to the
value every other site in the codebase uses to name the same bag.

The sig is the record's **identity** — what the panel shows, what an export
would carry. The canonical path rides alongside it as the per-frame match key,
because dormancy is asked per tile per frame and must answer synchronously
while signing is async. The two can never disagree: the sig *is* a pure hash of
the canonical key the path is built from, so matching the path matches the sig.

## Where it sits in the lens

`sharing/behavior-enablement.ts` is the single chokepoint every activation
surface already asks — on-tile icons, view toggles, panel rows, launchers, the
hex takeover claim. Binding is the fifth dormancy source in it:

```
local wake  >  global OFF  |  publisher-withheld  |  BOUND ELSEWHERE  >  per-tile hidden  >  ON
```

Wake still outranks binding. Waking a bound behaviour somewhere else is a
deliberate "I want it here anyway", and every dormancy source in this lens is
overridable the same way — one escape hatch, not one per source.

Two consequences fall out of using the existing chokepoint:

- **Nothing else had to learn about binding.** `isBehaviorDormant` already
  gates the render, the icons, the toggles and the panel; teaching it one more
  source taught all of them at once.
- **A surface that tests bindings on its own must apply the wake itself.**
  `isBehaviorDormant` short-circuits on the wake before it reaches the binding,
  so a caller asking the narrower question wants `isWithdrawnByBinding`, not
  `isBoundElsewhere`. (The Apply picker is the one such caller. Getting this
  wrong lights up an applied row while the offer beside it stays withdrawn.)

## What the panel shows

- **At the bound tile** (or under it): the row carries a `link belongs to
  <tile>` mark, with the location sig on hover. Applied rows and offered rows
  both.
- **Anywhere else**: nothing. Applied rows are dormant, and dormant means gone;
  the offer is withdrawn.
- **In the store**: every binding, named. The store is the census, and a
  behaviour invisible on every tile but one would otherwise look simply
  missing. A bound row is still **on** — binding scopes a behaviour, it never
  switches it off. The footer counts how many belong to a tile.

A kind that nobody here declares is bindable too, and a bound-but-undeclared
kind is listed in the store so the binding can always be undone. Neither
exception can strand itself.

## Storage

`hc:behavior-bound` in localStorage:

```json
{ "visual:postit:note": [
  { "sig": "973773d9…f467", "path": "/revolucion/meetup", "name": "meetup" }
] }
```

Participant-local, like every other lens in `behavior-enablement.ts` — never in
a lineage, never in the swarm. Writes emit `behavior:enablement-changed`, so
every surface repaints at once and cross-tab `storage` invalidates the caches.

A kind may be bound to more than one tile: a behaviour can belong to a few
places without belonging to all of them.

## First instance

`visual:postit:note` bound to `/revolucion/meetup` — the post-it that is that
page. Verified end to end: offered and marked at `/revolucion/meetup` and at
its child `/revolucion/meetup/agenda`, withdrawn at `/revolucion` and at
unrelated tiles, restored anywhere by a wake, and returned to the whole hive by
`/behavior free postit`.

## Known asymmetry (pre-existing)

`presentation/tiles/tile-view.drone.ts` and
`revolucionstyle.com/welcome/welcome-view.drone.ts` gate on `isKindGloballyOff`
rather than `isBehaviorDormant`, so they see the global switch but not wake,
publisher-withheld, or binding. That predates this work and is left as it was;
moving them onto the full answer is its own change, because it would alter
their behaviour for withheld kinds too.

## Websites always bind (2026-08-20)

A website divorced from its tile is just a row in the Behaviors panel — no
meaning. Every website therefore follows the binding protocol automatically:
its ROOT tile (the first ancestor carrying a page — `visual:website:page`
decoration or first-class `website` slot) is what the site belongs to, and
`commands/website-binding.ts` records that as an ordinary binding of
`visual:website:page` to the root's location signature.

The attachment is **derived, never authored**: the root is where the pages
live, so a shared or adopted website re-attaches on the receiving side from
content alone — the binding record itself stays a participant-local lens and
never travels. Discovery paths call `ensureWebsiteBoundAt(root)`:

- the Beehaviors panel's website scope pass (`show-features.drone.ts`) — any
  site the panel ever sees attaches, covering authored, generated, adopted,
  and legacy sites alike;
- `/website here` — the flag names a new root, so the attachment is made at
  intent time, before the first page exists.

**First-binding sweep**: the binding model withdraws a bound kind everywhere
outside its bindings, so the first site bound would silently withdraw every
other site until each was visited. The first attachment of a session that
finds no bindings walks the tree once and binds every existing root
together. Descent stops at a root — a page deeper inside a site is part of
that site, never a second root.

Consequences, all the binding's own: the website row shows anywhere within
the bound branch and is withdrawn everywhere else; and in the panel the
row's control acts at the site's ROOT from wherever you stand
(`features-viewer.component.ts` routes root and inherited rows to the
membership toggle at `scopeSegments`). The one local exception: a child that
carries its own page decoration still turns that page off in place.
