# Layout templates

**A layout is a generic piece. A container opts into one. Nothing is a parent.**

A layout is a named arrangement of holes. It depends on nothing and holds
nobody; it only nests other layouts. A container reads through one by wearing a
mark, and what eventually fills the holes is a separate question, asked later,
by somebody else.

This is the placement half of the website-artifact paradigm
([website-artifact-paradigm.md](website-artifact-paradigm.md), rules 10 and
11). Breaking a tile apart already gives the whole an **anonymous** frame — how
many holes, how they flow — minted for that one whole
([visual-division.ts](../hypercomb-essentials/src/presentation/tiles/visual-division.ts)).
That is enough to break something apart and not enough to design with: two
wholes that should read the same have two unrelated frames, and changing the
design means editing both.

A template is the same frame, **named and shared**.

## The pieces

| Piece | What it is | Where |
|---|---|---|
| **Layout template** | `{ kind:'layout-template', name, flow, holes[], vars }` — a generic arrangement | `presentation/tiles/layout-template.ts` |
| **Layout piece** | `{ kind:'layout-piece', template, vars, holes: { key → ref }, refs }` — one level of a design | `presentation/tiles/layout-piece.ts` |
| **Target** | `layout:template` — the mark a container wears, holding the ROOT piece signature | `presentation/tiles/template-target.ts` |
| **Author** | the one reader and writer | `presentation/tiles/template-author.drone.ts` |
| **Designer** | a docked tool window: layouts on the left, a resizable pane in the middle | `hypercomb-shared/ui/layout-designer/` |

Commands live in `commands/template.queen.ts`:

```
/template                     open or close the designer window
/template rail                plug THIS container into the rail layout
/template off                 unplug it
/template list                the layouts this hive can reach
/template rotate              turn this container a quarter
/template set rail 14rem      change one variable at the root
/template save my-shell       save the current shape under a name
```

## Nesting is a signature, never an inlined tree

A piece holds, for each hole, the **signature** of the piece nested there. Not
the piece. A signature. That single choice is what makes an arrangement atomic
rather than a blob:

- two containers that end up with the same arrangement mint the **same
  signature** and share one record, so the first to load it serves every other;
- a piece can be lifted out and dropped anywhere, because it names nothing
  above it and depends on nothing but the pieces it nests;
- editing one level re-mints that level and the chain above it, exactly as a
  merkle tree does — everything else keeps the signature it had.

Inlining the tree into one record would have looked simpler and would have
broken all three, as well as the standing rule that a field referencing content
holds a signature and never the content (CLAUDE.md, *"Signatures are the
composition mechanism"*).

### Every reference is a typed hop

The Life Primitive (`hypercomb-core/src/core/life-primitive.ts`): *every
artifact reference is the signature of a meta envelope, and the envelope
declares exactly one typed payload hop.* A field never holds the bytes' own
signature — that is an untyped hop, and there are none.

So `template` and each entry of `holes` hold **envelope** signatures:

```json
{ "meta": 1, "resource": "<the layout template's bytes>", "relation": "layout" }
{ "meta": 1, "resource": "<the nested piece's bytes>",    "relation": "hole" }
```

`relation` names the **role**, never the hole key. Keying it by hole would mint
a different envelope for the same nested arrangement in a different slot, which
destroys exactly the dedup the signature is there for.

Reads go **through** the hop (`fetchThroughContentHop`). `Store.getResource`
does not follow it, so fetching a reference directly hands back the envelope's
own JSON — which parses as no template at all, and the arrangement silently
vanishes.

### And the arrangement has to travel

`refs` on every piece is the flat set of every signature that level reaches,
envelopes included; `commitArrangement` puts the **whole tree's** closure on the
`layout:template` decoration.

This is not tidiness. The push walk enqueues a resource's declared refs and does
**not** recurse into what it enqueues, and the default adopt stops at depth one.
The mark carries only the root. Without the declared closure an adopter receives
the mark, one orphan record, and a page that has quietly lost its layout —
`resolveTree` returns null and nothing says why.

**Nesting needs nothing in the hole first.** A layout dropped into an empty
hole nests there. A hole is a place a shape can go and a shape is a thing that
has holes, which is the whole of why the nesting is unbounded — and it is what
lets a page be designed before there is anything to put in it. Depth is capped
at `MAX_NESTING` (12), which is a guard against a damaged record spinning a
walker, not a design limit anyone meets.

## Opting into a layout is not acquiring a parent

The binding is a mark the container wears, pointing at the root piece by
signature. A tile is never *inside* a layout; it *wears* one. That is the whole
difference between this and a component tree, and it is why a container can be
moved, shared or adopted alone and still look like itself.

Content comes from the other side. Whatever is seated into a leaf hole carries
its own position (`{ sig, meaning, order }` —
[enrollment.ts](../hypercomb-essentials/src/pheromones/enrollment.ts)),
and the designer never touches it. Nothing in a layout names a part; nothing in
a part names a layout.

## A hole is an interface

A hole states a **name** and a **share of the axis**, and says nothing about
who fills it. It never states the cross axis — a hole that fixes both axes
accepts almost nothing, and a part that fits only one whole is a part that can
live in only one whole.

```ts
{ key: 'rail', fill: 'fixed' }              // sized by --hc-layout-rail
{ key: 'body', fill: 'fluid', self: true }  // takes the remainder
{ key: 'head', fill: 'fixed', band: true }  // breaks the line, full width
```

A **self hole** is where the container's own page goes. It carries no seating
position, so member positions never shift because a template does or does not
have one — and only the ROOT has one, because there is one page here.

**Leaves are the seating positions.** A hole with a layout nested in it is not
a seat; its own leaves are, numbered in document order across the finished
arrangement. That is the only numbering that survives somebody nesting three
levels down, because it describes the thing content is actually seated into.

### A hole may say what belongs in it

A hole can carry a **conventional name** — `site:masthead`, `article:byline` —
and that name is how two people who never met agree on what fills it. Both
derive the same address from the same word. There is no registry to consult and
no message to exchange.

```ts
{ key: 'top', fill: 'fixed', band: true, meaning: 'site:masthead' }
```

The composer writes the derived address onto the element as `data-hc-target`,
beside the name itself as `data-hc-meaning`. An artifact answers by wearing the
ordinary enrolment mark for that same name; nothing new is introduced on either
side.

**The name is always `scope:name`.** `sanitizeMeaning` rejects a bare word
outright rather than folding it, and this is not tidiness. A signature derived
from a bare word lands in the same flat namespace as a lineage bag, whose
address is `sha256(lineageKey(segments))` — so `sign('websites')` *is* the
`/websites` launcher's bag. A colon can never come out of `lineageKey`, which
folds every non-letter to `-`, so a qualified name is the one spelling that
cannot collide with somebody's tile. The pool registry enforces the same rule
for the same reason; hole meanings simply never had a chance to acquire the
debt.

**The address is a group signature, not a pool signature** —
`sha256('group:' + meaning)`, from `groupSignature` in core. The distinction
matters enough to state:

| | A pool | A group |
|---|---|---|
| what it is | a **place** — `getPool` opens a directory `{ create: true }` | a **name** — a declared referent with no bytes behind it |
| deriving one | `Store.poolSignature` **registers** the address, permanently telling prune and purge to leave that 64-hex alone | derives a hash and nothing else |
| for a peer | the registry is compile-time code; it classifies nothing beyond the machine that derived it | the same word gives the same address anywhere |

"Pool of meaning" is the right instinct — a conventional word, agreed on rather
than assigned — and the wrong primitive. Seeding the pool registry with markers
that will never hold a record degrades the one guard it provides, which exists
to stop `/flatten` destroying a real pool's contents. `group:` puts hole targets
in a namespace disjoint from every pool address *and* every lineage bag, and it
travels with the artifact, because it rides a decoration rather than a table.

`meaning-target.ts` resolves every name an arrangement mentions in one pass up
front, so the composer stays synchronous — which is what lets the same function
draw a container at publish time, in the browser, and in a test.

### The library — six primitives, drawn one way

| Holes | | |
|---|---|---|
| **one** | `single` | the page, in a box of its own |
| **two** | `split` | two even shares |
| | `rail` | a measured strip, and the rest |
| **three** | `thirds` | three even shares |
| | `bookends` | a measured strip at each end, the rest between |
| | `measure` | a measured strip in the middle, the rest at each end |

There were twenty. Sixteen of them were another one turned, mirrored, or
counted higher — `rows-two` was `split` on its side, `right-rail` was
`left-rail` seen from the other end, `rows-four` was two `split`s. A palette of
twenty is a wall you read; a palette of six is a set of parts you build out of,
and building is what this window is for.

**Three holes is the ceiling, and nesting is why.** Four even shares is `split`
with a `split` in each hole; a six-cell gallery is `thirds` with a turned
`split` in each. Drag the result back onto the shelf and it is one asset with a
name — so the arrangements that were chips are now *yours*, and the library is
only the parts nothing else can be made of.

What nesting cannot reach is a hole's own KIND. Fluid or fixed is a fact about
the template, not a measurement, which is exactly why `rail`, `bookends` and
`measure` are primitives and `two-thirds` is not: a proportion is a
measurement, and the slider already moves it.

Each is named for the arrangement it makes — not for the CSS property it uses,
not for the proportions it starts with, and **not for a side**. All three stop
being true the moment somebody moves a variable or turns the container. `head`
and `tail` are ends of the main axis; `left` and `right` were not.

**Every one is one-dimensional, and that is the whole design.** A flexbox
container has a single axis; a page that needs two is a container with another
container nested in one of its holes.

So there is no `shell` in the library. A masthead over two rails over a footer
is a turned `bookends` with a `bookends` in its middle — correct at every size,
and the gesture the designer exists for. And there is no `wrap` either: **a
wrapping row cannot give the remainder to one line**, because `align-content:
stretch` divides leftover space *equally* among lines, so the body always draws
at the height of its own content while the bands sit at their measure. It looks
finished at exactly one size. `wrap` remains a flow a stored template may
declare; nothing built in asks for it.

### Rotation is the other half of "drawn one way"

**Turning a layout is a quarter-turn of its main axis, and nothing else.**
`flex-direction` already spells the four quarters — `row` is the way it was
drawn and each value after it is one more quarter clockwise — so `QUARTER_TURNS`
*is* the direction vocabulary rather than a second copy of it. A turn writes one
variable on one level, minted like any other edit, inheriting nothing and
cascading nowhere.

**Nothing about a hole is rewritten on the way round.** A hole never states its
cross axis, so a fixed hole's `flex-basis` is a *width* in a row and a *height*
in a column from the same bytes; `gap` and `padding` are axis-agnostic already;
`min-width: 0` and `min-height: 0` are both always present. The turned
container is laid out exactly as it would have been if it had been drawn that
way to begin with. That is not luck — it is the pay-off of the rule that a hole
may not state its cross axis, and it is what lets one drawing serve four
shapes. Measured in the browser: `rail` at 14rem is 226×519 as a row and
503×226 as a column, from one template.

The two things that *do* change meaning are `justify` and `align`, and they
change it because that is what they mean: they name the main and cross axes,
and the axes have swapped.

So `left-rail`, `right-rail`, `header-body` and `body-footer` are one template
now, and `stack` is `bookends` turned.

| Where | How |
|---|---|
| Designer | the turn button on the selected level, or **R** while the pane has focus |
| Command line | `/template rotate` — the root level |
| Flex editor | the `direction` axis, which is the same variable spelled out |

The shelf does **not** turn. A piece is drawn one way; only the design turns —
otherwise a chip would stop being a stable picture of the part it offers.

### A hole always fits the space it is allotted

A fixed hole holds its measure **until the measure does not fit**, and then it
gives way — `flex-shrink: 1`, not `0`. Zero is the obvious reading of "fixed"
and it is wrong at every scale but one: two 10rem rails in a 34-pixel chip
overflow by 286px, silently, because flex overflow does not clip. Shrinking is
proportional to the basis, so equal rails give way equally.

A band is the same rule on the other axis, clamped by `max-height: 100%` — and
where the container has no definite size on that axis, the clamp resolves to
nothing, which is right: there is no allotted space to exceed.

**The palette miniature is not a special case.** It is the same layout given
measurements suited to its space: a rail declared at 10rem is three times a
34-pixel chip, so the chip asks for the rail as a share (`miniatureVars`).
There is no compensating CSS — there used to be, a rule that string-matched the
generator's own style attribute, and it hid this defect rather than fixing it.
If a layout does not read correctly in a chip it is not finished, because the
chip is the smallest honest test of "fits the space it is allotted".

## The variables are the design, and they inherit

This is the part that is easy to get wrong, so it is a rule rather than a
detail.

The instinct is to give each layout its own variable namespace —
`--split-space`, `--rail-space`, `--bookends-space` — and alias it to a local
`--space` inside the component. It reads as tidy and it destroys the one
property that makes nesting worth having: **a re-declared alias stops
inheriting.** Set the gutter on the outer container and the inner one, having
re-aliased its own, ignores you. Every level then has to be dressed by hand,
which is not a layout system — it is four stylesheets that resemble each other.

So there is **one vocabulary**, unprefixed by layout type, declared where it is
overridden and nowhere else:

| Variable | Means |
|---|---|
| `--hc-layout-space` | gap between holes |
| `--hc-layout-padding` | inset around the whole set |
| `--hc-layout-<hole>` | the fixed extent of one hole |

Only the **root** merges the template's defaults in. A nested level declares
just its own changes, so everything it does not mention keeps falling through
from the level above — nest a `split` inside the body of a turned `rail` and it is
already dressed; give the inner one `--hc-layout-space: 2rem` and only it and
its descendants move.

Two consequences worth stating:

- **No margins, and no margin resets.** `gap` spaces holes without putting
  space outside the set — the entire job a `margin-reset-vertical` /
  `margin-reset-horizontal` pair does by hand, per layout, per edge. `padding`
  then means what it says, and the two compose under nesting instead of
  fighting.
- **No `nth-child` anywhere.** A layout whose sizing lives in
  `> div:nth-child(2)` has its arity welded into a stylesheet: five holes need
  five rules and a six-hole variant is a new file. Every hole carries its own
  `flex` inline, derived from its own declaration, so **arity is data**. An
  eleven-hole layout needs no code at all.

Where the binding does **not** cascade: `layout:frame` cascades because being
framed is a fact about a *place*, and every descendant of a framed branch is in
that place. A layout is not that — a container has holes, and what goes *in*
the holes is not itself a container unless somebody says so. Cascading the
binding would make every page in a branch a container full of empty boxes. So
the binding is node-local — you set the targets, one per container. The
**variables** cascade, in the one place a cascade belongs: CSS.

## Where it plugs into rendering

`containerFor()`
([division-assembly.ts](../hypercomb-essentials/src/presentation/tiles/division-assembly.ts))
takes three sources, in order:

1. **The whole's own page, when it declares holes.** A designer who wrote
   `data-hc-slot` said where content goes, and nothing may overrule that.
2. **A bound arrangement.** The container is composed from the piece tree, and
   the whole's own page is seated into its self hole — so binding a layout
   never costs the page.
3. **The frame's derived container**, so parts have somewhere to sit before
   anyone has designed anything.

A page *without* holes used to end the search at (1) and silently compose
nothing, which is why every whole that wanted a designed layout had to
hand-author slot divs. That is the gap this fills.

Everything else about composition is unchanged
([division-render.ts](../hypercomb-essentials/src/presentation/tiles/division-render.ts)):
parts are seated by index, each in a declarative shadow root so it carries its
own styling into any whole, and an absent part is never an error. A container
with a layout bound and no parts yet still composes — its holes are simply all
empty, which rule 11 says is a finished state.

## The designer

`/template` opens a **docked tool window**, not a takeover — it sits on the
left, the way the chat window and the workflow designer do, so the control bar
and the hive stay on screen beside it.

**The window is two halves and does not scroll.** The top holds the layouts and
is the one thing that scrolls; the properties sit below at their natural height
and never move, so they are never carried off the bottom of the screen exactly
when you reach for them. Its chrome comes from `_toolwindow.scss` — the shell,
the header band, the close button, the accent identity — the same partial
nineteen other windows include. How many layouts sit across the shelf is a
setting of the **tool window**, in its own gear: auto, or a pinned count.

Three things, and only one of them is the window:

- **The workspace** — flush to whatever the docked panels have left. Its edges
  *are* `--hc-inset-left` and `--hc-inset-right`, the widths those panels
  reserved through `hcDockInset`, so nothing can overlap and everything inside
  centres in the space actually available. Centring on the viewport instead
  would put the middle of the design underneath the palette — and the same
  argument decides the other edge, which is why the flex editor reserves too
  rather than floating over the canvas.
- **The pane** — the target container you are designing. A rectangle centred in
  the workspace, resizable from every corner and every edge. It is chrome, not
  design: nothing about its size is stored in the hive.
- **The layouts** — the palette. The only draggable thing here. Drop one on the
  workspace to start a design, or on any hole to nest it there, as deep as you
  like.

A reservation must not wait for a frame. `DockInsetDirective` used to publish
every measurement from inside a `requestAnimationFrame` callback, while
publishing every *clear* synchronously — and a document that is not rendering
runs no frame callbacks and delivers no `ResizeObserver` callbacks either, both
being rendering steps. So a panel opened in a backgrounded or occluded window
reserved nothing at all while sitting on top of the content it is meant to sit
beside, and nothing recovered it: a panel's size never changes after it opens,
so the observer had nothing to report when rendering resumed. Measured here,
with both windows mounted and correctly laid out: both variables read `0px`,
the workspace ran the full width, and the design pane lay 153px underneath the
right-hand panel. The directive now races the frame against a short timer and
takes whichever arrives first — `getBoundingClientRect` forces layout whatever
the visibility, so the timer's measurement is just as good, and in a rendering
document the frame still wins so the working path is untouched.

A panel can also MOVE without resizing, and nothing above notices that either.
A docked panel is placed with a `calc()` over `--hc-controls-<side>`, so
re-docking or resizing the control bar slides every panel sideways at exactly
the same size — no `ResizeObserver` callback, no `window.resize`, and a
reservation that is measured from a POSITION (`innerWidth - left`, for a
right-docked panel) goes quietly stale. Widening the rail from 54px to 140px
moved a left-docked panel's edge from 375px to 481px while its reservation sat
at 375, and it covered 106px of the surface it was meant to sit beside. The bar
is the only thing that knows it has moved, so the bar now says so
(`viewport:controls-edge`) and every panel measures again.

Content is not designed here and this window never touches it.

The palette you drag *from* sits to the left of the thing you drag *into*,
which is the only arrangement in which the gesture reads as one motion. An
empty pane is where a design starts, not an error, so the pane is always there.

### Which container am I in

Each container carries a hairline dashed rule at rest — enough to read the
separation, not enough to compete with the holes — and the one under the
pointer states itself: a solid accent rule and its own name at the corner.

Only the innermost. `:hover` matches every ancestor of the pointer, which would
light the whole chain and answer the question with "all of them";
`:not(:has([data-hc-container]:hover))` keeps the deepest. The badge reads
`attr(data-hc-container)`, so nothing has to remember to write a class.

### One container is selected, and you can see which

Selection is the context for everything else: the properties below the palette,
and the flex editor opposite, are both pointed at whatever is selected. So it is
stated rather than hinted — a solid accent ring **around the outside** of the
division, its name standing at the corner, and every other container dimmed.

Outside, not inset. A ring drawn within the box shares a line with the box's own
wall and with whatever is nested one level in, so at a glance it can read as
belonging to the child. Around it, it can only mean the division as a whole,
which is the question being asked. A hole clips its content, so while a
selection is anywhere inside one, that hole stops clipping — no layout moves,
and the ring is visible at every depth. Safe precisely because a container
always fits its hole: there is nothing else that could spill.

### A point is over a stack, so the gestures walk it

Point anywhere in a nested design and you are over several containers at once —
the whole, the region inside it, the region inside that. A gesture that had to
CHOOSE one would be wrong for somebody every time: the outermost ignores the
nesting you built, the innermost makes the outer regions unreachable by pointing
at them.

So the pointer gestures do not choose, they ADVANCE along that stack.

- **Click again to go one layer in.** The first click lands on the outermost
  container over the point, each one after it steps deeper, and at the bottom it
  returns to the top. A click has only one direction, so coming round is the
  only way back — and someone who overshoots by one click fixes it with one
  more.
- **The wheel goes in and out, and stops at both ends.** Down goes in, up comes
  back out, and nothing has to be selected first: the wheel enters the stack
  from whichever end it is heading away from, so scrolling down starts at the
  whole and works inward, and scrolling up starts at the innermost and works
  back out. It does NOT wrap, because with two directions a wrap would mean one
  notch too far dropped you from the whole design into its deepest corner.
  Clamped, the ends are ends.

One turn of the wheel is at most one layer, however hard it was turned, so a
trackpad flick cannot fall through a nesting. The wheel is always consumed, at
the ends too — this is also the hive's zoom gesture, and letting a spent scroll
through would zoom the world out from under a design you were only inspecting.

The stack is read off the ELEMENTS rather than the arrangement, because a hole
holds a container only sometimes and the DOM is where that is already settled.
It takes whatever the pointer was actually on, so one reader serves a click
bound to a hole and a wheel that landed on a label inside one.

**Tab and the arrows move it.** Only while the pane has focus, only for those
six keys, and never for a press that started inside a control — the resize grips
are buttons, and someone on one of those is aiming at the pane's size.

- **Tab** — document order, wrapping. It reaches every container eventually,
  which is what makes it the honest fallback: whatever the arrangement, Tab gets
  you there. Taking Tab from the browser is deliberate; on a surface whose whole
  content is one arrangement, "the next thing" *is* the next container.
- **The arrows** — geometry, because you are pointing at a picture. Nearest
  centre genuinely past yours on the asked axis, scored by distance along it
  plus *twice* the drift across it, so of two boxes equally far right the one
  nearly level with you wins.

Deriving the arrow move from the tree instead — first child, next sibling —
looked simpler and is wrong the moment a layout is a column: Right would walk
*down* the screen. The shape of the arrangement is data and changes under you;
where the boxes actually are does not.

**An ancestor is never a candidate.** The container you are in is around you,
not over there, and its centre is past yours on some axis almost always — left
in, the root wins nearly every press and the arrows do nothing but climb out.
Ancestors are what Shift+Tab is for. Containers you are *inside of* stay in, so
pressing Down on a container split top and bottom lands in its lower half. One
consequence falls out rather than being arranged: moving toward a nest lands on
the **region** first, and a second press steps into it — the reading order a
person already uses on a page.

An arrow with nowhere to go does nothing. A wrap on a spatial move reads as the
selection teleporting.

### The picture is the label

A layout is drawn, not described, so the chips carry no text: twenty names
under twenty drawings compete with the drawings, and the drawing wins. The name
waits for the pointer. The walls legend works the same way — four specimens of
the actual border, each naming itself on hover.

### The walls say what a hole does

Every hole is drawn with a border that states its behaviour, because *"what
will this do when the page gets wider"* is the question you are actually asking
while you design:

| Wall | Means |
|---|---|
| dashed | takes the remainder — it grows and shrinks |
| solid | holds its measure — a fixed rail |
| double | breaks the line and spans the full width — a band |
| filled | where this container's own page goes |

The walls are read off `data-hc-fill` / `data-hc-band`, which the composer
writes onto the elements themselves — so the border and the flex can never
disagree about the same hole.

### The pane is centred, and only its size is yours

**One handle, bottom right.** Dragging it outward grows the pane in **all four
directions**, because it stays in the middle — a handle that moved one edge
would make the pane wander off-centre, and then "make it bigger" and "put it
back" become two chores instead of one.

Eight handles was a reflex from window chrome, and window chrome moves edges.
This pane does not: every handle did the same thing, so seven of them were one
control drawn seven more times around the edges of the thing being looked at.
`resizeCentred` still understands all eight, because the arithmetic is the same
either way and an edge-only drag may yet earn its place.

Resizing never closes or rebuilds the arrangement: the same elements are still
standing there and the holes simply have more room. The size is a fraction of
the **workspace**, kept per participant, and the pane may fill it completely —
the handles sit inside the border for exactly that reason. `canvas-box.ts` holds
the arithmetic, and it is pure so it can be argued with in a test.

### The drag has to be invisible to the hive

`LinkDropWorker` listens on `document` and claims **any** drag whose types
include `text/plain`. It then arms the landing ring and the ghost tile — so
dragging a layout chip made the hive offer to make a tile out of it, right
through the designer.

The opt-out is type-based and already established here: carry a **private MIME**
(`application/x-hypercomb-layout`) and never set `text/plain`. Every other
document-level listener gates on `Files` or on its own custom type, so one
non-matching type silences all of them at once. `stopPropagation` is added too,
but it is not sufficient on its own — the latch is set by the first `dragover`
that reaches `document`.

### The hive is not underneath, but the header stays

A design surface with hex tiles showing through it is unreadable, and the tiles
are not what is being designed. But the header — and the command line inside it
— stays above: this is a place you work, not a place you are trapped.

So the canvas is **covered**, not suppressed. `ModeRegistry`'s `view:active`
would hide it and take the header with it, and there is no "keeps-header" mode.
The workspace already sits above the reparented canvas (the surface host is at
z-index 100002, the canvas at 59989), so an opaque ground is all it takes.

That is not the thing `_canvas-suppress.scss` forbids, which is a per-widget
`#pixi-host` rule: nothing here touches the canvas at all, it simply is not on
top. The workspace top is the same header anchor the panel uses, so the two
line up exactly and the workspace nests in what is left.

### The flex editor is the other side of the pane

Select a container and a second window opens on the **right**, opposite the
palette: the palette is what a container could *be*, this is how the one you
picked *behaves*.

Five properties decide how a flexbox container arranges what is in it, and each
is a row of an accordion. **Shut**, the row says what the axis does and what
this container is set to — so the panel reads as a summary of the configuration
without being opened at all. **Open**, it shows you: a live preview of *your*
container wearing each value. One at a time, because five axes of previews at
once asks you to compare twenty-four pictures when the question in front of you
concerns four.

Choosing between `space-around` and `space-evenly` is a matter of looking at
them — it always was. So every picture is both the illustration of a value and
the control that chooses it, and there is no separate list of names. One preview
per **value**, never per combination: each holds the other axes at what this
container already says, so walking down the panel is walking through the
configuration one decision at a time. Every preview is `templateContainer`
output, the same pure builder that draws the container on the page, so a preview
cannot advertise an arrangement the layout does not make.

It is a **companion**, not a window of its own. The shell parks every other tool
window when one opens — one window at a time, because a tool window is the thing
you are doing. This is not that: it cannot exist without the designer, it shows
the container the designer has selected, and every press in it edits that
selection. Put the two side by side or neither is any use. `window-rule.ts`
states the exception without naming ids, so exactly this case declares itself
into it; on a phone the exception is spent, and the rule decides that alone.

It emits `template:set-var` — the same intent the designer's own sliders use, so
a variable has one write path however it was moved.

### It reads nothing itself

Shell UI must not import essentials, and a second reader of an arrangement
would drift from the renderer's. `TemplateAuthorDrone` is the one reader: it
publishes `template:state` and takes four intents back — `template:target`,
`template:nest`, `template:unnest`, `template:set-var`. Every one of them is a
merkle update, not a mutation.

The container markup is mounted with `innerHTML` on the native element
deliberately: it carries inline custom properties, and an Angular `[innerHTML]`
binding sanitises the style attribute away — the layout would arrive with none
of its own measurements. The hover highlight is likewise painted imperatively:
making it reactive would rebuild the pane mid-drag, destroying the element
between `dragenter` and `drop`.

## Extending a layout is data, not fields

A layout is extended by adding a **variable** or a **mark** — never a new field
and never a new code path.

**Per-hole variables.** A hole carries its own `vars` bag, same shape and same
sanitiser as the template's, scoped to the hole: `{ align: 'center' }` is
emitted as `--hc-layout-<key>-align: center`. Two names are resolved here —

| Variable | Emitted as |
|---|---|
| `--hc-layout-<hole>-align` | `align-self`, defaulting to `auto` |
| `--hc-layout-<hole>-overflow` | `overflow`, defaulting to `visible` |

— and **every other name is simply declared**. Whatever is seated in the hole
can read it: custom properties cross a declarative shadow boundary, so a part
styles itself from the hole it is sitting in without the hole knowing anything
about the part.

It is `align`, not `anchor`: `anchor` already means the Pixi sprite origin and
the lineage anchor, and a third meaning in the layout vocabulary is the kind of
collision the pool-meaning doctrine exists to prevent.

**Marks.** An open classification, as one attribute value:
`data-hc-mark="full-bleed quiet"`. A token set, folded, deduped, sorted and
capped — the same shape pheromone marks use, and the same shape a signature can
be minted from twice without diverging.

**Attribute names are never author-supplied.** The emitted set is nine
constants in one file, and the only variable parts are values, each through
`attr()` or `cssLength()`. That is the whole safety argument, and it is why
there is no deny-list of `on*` handlers: a record cannot name an attribute, so
it cannot name that one. If a name-bearing bag is ever genuinely needed, the
only allow-rule is `^data-hc-[a-z0-9-]{1,32}$` — which structurally excludes
`on*`, `style`, `class`, `href`, `src` and every namespaced attribute.

## The hive root is a container

There is no empty-segments guard on any write path. The root has children, it
has a page, it has a location signature, and it is the most likely thing anyone
designs first.

It was refused for no better reason than having no name — and the refusal was
**silent**: standing at the root, every click and every drop did nothing and
said nothing, which reads as a broken window rather than as a rule.

## Invariants

- A layout names no part, and a part names no layout.
- A hole never states its cross axis. This is what makes a turn free: the same
  declaration is a width on one axis and a height on the other.
- A layout is drawn ONE way; the other three quarters are turns, and a turn is
  one variable on one level. The library therefore holds no mirror of anything
  it already holds, and no name in it may state a side.
- No built-in goes past three holes. The fourth is a nesting, and a nesting the
  participant keeps is a creation.
- Nesting is a signature, through a typed envelope; nothing is ever inlined.
- Every level declares its closure, and the mark declares the whole tree's —
  an arrangement that cannot travel is an arrangement that does not exist.
- Data never names an attribute.
- A hole fits the space it is allotted, at every scale. Nothing has
  `flex-shrink: 0`; the container bounds itself; a band exists only where the
  line can break.
- Only the root merges defaults; every nested level declares only its changes.
- A variable name that is not already a slug is **dropped**, never folded —
  `bad;key` becoming `badkey` would be a variable nobody wrote, sizing a hole
  nobody named.
- The same arrangement mints the same signature, so N targets are N references.
- A hole meaning is always `scope:name`, and its address is a **group**
  signature — never a pool signature, which would register a place.
- The selection is ringed on the outside, and the keyboard never climbs into
  the container it is already in.
- A pointer gesture walks the stack under it rather than choosing a layer: a
  click comes round at the bottom, the wheel stops at both ends.

Covered by `presentation/tiles/layout-template.spec.ts` (77 tests),
`presentation/tiles/layout-creations.spec.ts` (5 tests),
`presentation/tiles/layout-piece.spec.ts` (11 tests),
`hypercomb-shared/ui/layout-designer/canvas-box.spec.ts` (14 tests) and
`hypercomb-shared/ui/layout-designer/select-walk.spec.ts` (35 tests).
