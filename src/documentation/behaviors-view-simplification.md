# Behaviors View Simplification — the store, the light, the badge

Status: **built** (2026-08-06 — panel, drone and i18n reworked; verified on dev.
Still owed: essentials rebuild/deploy for the web shell, and the website
view's revision list).

The Beehaviors panel (`hypercomb-shared/ui/features-viewer/`, ~1,540 lines) tries to
answer three different questions in one window — what do I have, what is enabled,
what is active here — through a three-rung reach ladder, a roster mode, an
available-to-add section, a hidden/carve-out pool, and gate chips. This plan
replaces all of it with two simple surfaces and one state model.

## State model

Three independent facts about a behavior, never conflated:

| Fact | Meaning | Storage |
|---|---|---|
| **Adopted** | You have it. It sits in your bucket. | Existing (behavior present in hive) |
| **Lit** (on) | The global switch. Off = filtered totally: dormant everywhere AND withheld from swarm. One switch, one meaning — unchanged from the enablement roster. | Existing `behavior-enablement` records |
| **In use** | At least one decoration carrying the current revision references it. | **Derived** — counted, never stored |

Adopting is one gesture, no verb needed. The row itself shows state:

- **dim** — off (or not yet adopted)
- **lit** — on, idle
- **lit + badge** — on and in use (the badge is the count of current-revision decorations)

The community-verification gate collapses into the first flip to lit — turning
the light on IS your OK. No "needs your OK" chip, no inline allow override UI.

## Membership is positive — the decorations ARE the website

A composite behavior (a website) is not "the branch under its root, minus
carve-outs." It is exactly the set of tiles carrying its web-part decorations.

- No decoration → never in the site. Nothing to exclude, nothing to hide.
- A freshly adopted Website with no decorated parts shows an empty site — correct.
- **Renders where**: a behavior acts exactly where (a) its decoration sits with
  the current revision AND (b) its light is on. Two conditions, no override ladder.

This deletes the entire subtractive apparatus: hidden pool, off-kept-here
restore rows, per-page carve-out records, site-root master switch, and the
descendant-override reset. None of it has a job when inclusion is opt-in.

## Revisions are the website's history

Every web part is stamped with the revision it belongs to. Therefore:

- **A revision is a snapshot**: the set of decorations sharing that number is a
  complete, self-describing version of the site.
- **Only current-revision parts show as on.** Stale parts from an older build
  drop out naturally — no switching off, no cleanup.
- **The website's view lists its revisions.** Latest renders by default;
  choosing an older entry shows the site exactly as it was, because those
  decorations still exist, still stamped. Jumping between versions = choosing
  which revision the view reads. Non-destructive, same shape as the installer's
  loadable-revisions line.

## The two surfaces

### 1. Store view ("Beehaviors") — no tile subject

One flat searchable list of every behavior the app knows. Per row: icon, name,
description, the light, the in-use badge. Click the row = flip the light.
That's the whole surface. No tabs, no context, no sections beyond
adopted-first ordering.

### 2. Tile view ("On this tile") — standing on a tile

- Rows for the decorations this tile carries — these ARE the applied
  behaviors. Remove = remove the decoration.
- An Apply picker offering only lit behaviors from the store. Applying writes
  the decoration at this tile, stamped with the current revision.
- Openable view behaviors keep their Open action.

## Deleted from the current panel

- The reach ladder tabs (this tile / its context / your hive)
- Roster-as-a-third-mode (the roster becomes the whole store view)
- "Available to add" with its addable/gated/globalOff branching
- The "Off — kept here" hidden-pool section and restore rows
- Origin/scope attribution chips ("part of the website at …")
- Master-switch descendant-override reset
- Gate chip + inline allow override (folds into first flip to lit)

## Survives (mechanism, not UI)

- `behavior-enablement` global on/off + wake records (the light)
- `feature-verified` marking (written by the first flip to lit)
- Decoration add/remove plumbing (`features:enable` path)
- Download pathway stepper (adoption progress) — unchanged
- Hidden-pool records already written remain readable; the rework stops
  minting new ones. Drain plan decided at implementation time.

## Owed when implemented

- Rework of `features-viewer.component.{ts,html,scss}` into the two surfaces
- Revision list in the website's view (jump-between-versions)

## 2026-08-19 — One control: the bulb (opt-in polarity + deposit-and-wait)

Jaime's rule, verbatim: *"the idea is everything is off and then you turn it
on globally. Then back in local (to this layer) beehaviors everything is off
but you can turn them on."* And: *"when you apply that behavior it should be
waiting on objects down the hierarchical tree and then when they meet those
objects they begin to take upon their meaning however context behavior
applies them."* The second sentence is `context-behaviors.md`'s availability
doctrine — turning a feature on deposits its record and nothing else — now
applied to the panel for real.

**The panel is two copies of the same list, one bulb per row, no other
controls.**

- **The pool** (one header button away): every behavior, A→Z, flat — no
  categories, no used-badge, no verbs. Click = flip the ONE global light.
  Off = dormant everywhere and withheld from every swarm.
- **This layer** (the default; the header literally carries the layer's
  name): every globally-lit behavior, same rows, same bulb. Lit = its record
  is deposited here (directly or flowing from an ancestor/scope root); dim =
  not here yet. Click ON = **the deposit** — the record WAITS on the objects
  beneath and the behavior gives them meaning when they meet. Bees whose
  content is authored later (website, tutor) deposit their PENDING marker,
  the same record `/website here` writes, consumed by the next generation
  pass. Click OFF = remove the record here (undoable). Website scope roots
  keep their one meaning: the bulb is membership of the /websites menu.
  Provenance never sits on the row: a bound row's "for {cell} only" and an
  inherited row's "from {cell}" float in as a quiet chip at the row's
  top-right ON HOVER ONLY (Jaime: "you don't specify, you just show that
  item… the label only on hover — this is subtle"). Same for Open on a lit
  view row — hover-only. Nothing else.
- **The pool filter**: anchored (tile-bound) behaviors stay listed in the
  pool — the census — but behind a STICKY anchor-icon filter beside the
  search field (`hc:behaviors-pool-anchored`), so the pool can be read as
  just the hive-wide behaviors. Active = anchored hidden.

**Opt-in polarity.** `hc:behavior-global-on` is the truth once it exists: a
kind it doesn't name is off. It is seeded ONCE (show-features drone, boot +
first roster build) from the census minus the legacy off-list, so no
existing hive goes dark and first-boot in-house behaviors stay lit; from
then on every NEW or foreign kind arrives dark until lit in the pool.
`hc:behavior-global-off` stays as a written mirror because the swarm's
withheld wire (kind 30208) needs an enumerable list. Wake exceptions,
bindings, hidden records: unchanged.

**Deleted from the panel:** the OPEN/×/✓ row buttons, the bind (belongs-here)
button (bindings still display; `features:bind` remains wired drone-side),
the add (+) rows, the applied/available section split, store categories, the
in-use badge, bulk-open.

## 2026-08-19 — one control, and the subject in the title

The panel keeps shedding what isn't the light. Removed in this pass:

- **Paint mode.** The brush (header `format_paint` toggle, paint bar, pick
  rows, `features:paint` → the drone's `#paint` copier, `features:paint-result`,
  the `paintable` row flag) is gone end to end. One control remains in the
  header: the pool switch. Copying a behavior onto other tiles is no longer
  something this panel does.
- **The "BEEHAVIORS OF" crumb row.** The subject was announced twice — once in
  a boxed row under the search field, once in the header title. It now reads
  in the header alone: `Beehaviors / <tile>` for a named subject, and the bare
  app title where there is no name below the app — the pool, and the HIVE ROOT
  (whose label is `/`, so a separator there rendered as `Beehaviors //`). The
  rail switch is still the way back to the loaded layer, so nothing became
  unreachable.

The search field is unchanged — `search beehaviors…`, filtering both lists.
i18n: the 18 dead keys (`features.context.*`, `features.paint.*`,
`features.mode.paint.hint`, `features.mode.manage.hint`,
`features.section.paint`) were removed from all 15 catalogs.

## 2026-08-20 — the icon is the default, and views come home

Jaime, in order: *"When you click the icon on the behavior change the color of
the icon and make that be the default behavior when you go to that layer."* —
*"This only happens in behavior layer view."* — *"obviously they are mutually
exclusive and have to be a view."* — *"The only difference between the view
behavior in the list is that has a different color background."* — *"there
should be an icon for filtering between views and behav and global."* — *"Make
sure it's not cluttered. Don't add anything else."* — *"everything is a
behavior."* — *"we are losing views toolwindow."*

### The row now has three parts, and each says one thing

| Part | Says | Where |
|---|---|---|
| **The bulb** | on/off here — the deposit | unchanged, every row |
| **The icon** | this is what the layer OPENS AS | lit view rows only |
| **The manage tune** | the one thing this row has to decide | rows that have one |

**The background** is the fourth, and it is not a control: a view's row
stands on a cool blue ground (`$view-ground: #a8d8ff`, the same colour a
view's glyph wears on the canvas) instead of the neutral one. That is the
*entire* difference between a view and any other behaviour in the list.
No section, no tab, no window — **everything is a behavior**.

### THE DEFAULT VIEW — `view:default`

A **decoration on the layer**, payload `{ view }`, kind `view:default`
(deliberately not `visual:*`, so show-features never mints a bogus "foreign
behaviour" row for it). Owner: `commands/view-default.ts`.

- **Mutual exclusivity is structural.** The writer is `replaceDecoration`, so
  a layer holds one mark or none; choosing a second view is the same gesture
  as choosing the first, and clicking the lit icon clears it.
- **Only a view, only lit, never inherited.** A behaviour that is not a
  surface has nothing to open as; a default has to be something this layer can
  actually mount; an inherited row is managed where it flows from.
- **It is a fact about the PLACE, not a preference.** So it is undoable, it
  rides the layer commit to the root, it travels when the branch is adopted,
  and a peer who walks into your tile arrives the way you arranged it.

This **replaced `hc:view-defaults`**, a localStorage map that could do none of
those and only tinted an icon. Its three call sites are gone. The mark is
indexed in `decoration-kind-index.ts` (`defaultViewForSegments`) because both
remaining readers are **synchronous**: the tile overlay tints the glyph while
baking icons, and `view.bee` decides the arrival surface inside a recompute
that must not touch OPFS.

### The arrival surface — `view.bee.#openDefaultView`

Walking into a layer that names a default lands on that view instead of on
hexagons. It rides the existing `#recompute`, which already has the layer, the
records and the finished toggle strip in hand, so it costs **no extra read**
and inherits **every gate at once**:

> *is the wanted view in the toggle strip we just built?*

Dormant, hidden, hidden-within, not present here, outside its branch scope, a
navigation behaviour with no controller — all of them already removed it, and
none has to be re-checked here. Three further guards:

1. **The latch** (`#autoOpenedKey`). `#recompute` runs many times at one
   address; without it, pressing Escape back to the hexagons would be undone
   on the next tick. It latches even when the answer is "nothing to open".
   Arriving somewhere else re-arms it; so does `default-view:indexed` **for
   this layer's own mark**, which is what makes choosing a default in the
   panel show you what you chose. A child's mark being indexed by the
   hydration walk must never re-arm it.
2. **One settled paint** (`#painted`, set on the first `render:cell-count`).
   A canvas-hiding surface mounted during boot is the white-screen strand
   `TRANSIENT_MODES` exists to prevent.
3. **A view already up wins.** Never yank the participant out of what they
   opened into what the layer suggests.

### The lens — one icon, four positions

The header's storefront button is now **the lens**, cycling
`all → views → behaviors → global`. `all` is the resting state (mixed list,
backgrounds do the sorting); the two narrow positions are for when the list is
long; `global` is the pool. `features:lens` is the effect, and `/views` emits
it — the command survives its window.

### Retired: the Views toolwindow

`hc-views-viewer` is **deleted** — component, styles, template, shell-surface
registration, barrel entry, `ui/index.ts` export, the `view_quilt` rail button
and its three `command-shell` inputs/outputs, the `views:state` subscription,
and 29 dead `views.*` i18n keys across all 14 catalogs. Everything it did now
lives on the row:

| Views window | Now |
|---|---|
| ON/OFF pill | the bulb |
| Show here / Stop | the hover-only Open |
| Default | **the icon** |
| Current layer / Hierarchy | **the manage strip** |
| all/active/inactive filter | the lens |

The rail is back inside the portrait phone's five-slot budget. The expert
tutorial's lesson 140 follows the surface rather than dying with it: it now
requires `hc-features-viewer` and teaches the lens.

**The manage affordance is generic on purpose.** A row grows the `tune` button
only when it has something to decide — today that is a view's reach
(`sourceScopes` declaring both `layer` and `hierarchy`: brief, evidence-atlas,
knowledge-studio), and the panel asks the owning bee for the change exactly as
it asks for everything else it cannot write itself. Any behaviour could earn
one later without a new surface.

### Owed

- Essentials rebuild + web deploy, as ever.

### One gutter (the same pass)

Jaime: *"formatting problem on the padding and should just be way more
professional."* Measured on a 405px panel, four different left insets were in
play at once:

| part | was | now |
|---|---|---|
| search field | 17px | **17px** |
| row cards / list / footer | 13px | **17px** |
| selection bar content | 1px (full-bleed) | **17px** |
| header title | 17px | **17px** |

`$gutter: 1rem` (`$gutter-phone: 0.7rem`) is now the single horizontal inset
for the header, the search field, the scroll, every strip that slides in above
the list, and the footer. A strip may still paint full-bleed — the selection
bar's band is meant to span the panel — but its CONTENT starts on the gutter
like everything else.

`.feature-desc` is clamped to two lines. Not a space saving: a description free
to run to four lines made every card a different height (135–200px), and a list
of differently-sized cards reads as unfinished however well each one is set.
Rows now settle on two heights, 70 and 81.

### Verified

`scripts/drive-default-view.cjs` — a Playwright harness in the `drive-*` family
(no bridge, no renderer to attach to). Twelve checks on a live dev shell: the
rail has no Views button, view rows stand on different ground from behaviour
rows, the bulb deposits, the icon marks exactly one default and tints it, the
lens cycles four positions, **the layer opens as its default after a reload**,
and escaping back to the hexagons sticks.

    node scripts/drive-default-view.cjs --url http://localhost:4253 --out shots

`--engine chrome` is required: headless chromium cannot initialize Pixi's
shaders and never leaves the splash.
