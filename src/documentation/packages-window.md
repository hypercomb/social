# The host directory — packages, on or off, at every depth

*2026-09-12. Jaime: "you shouldn't be looking through the domains; look at your
own domain and what's on, and maybe shaded and not on, which is searchable.
Same experience per domain lookup, but you explicitly search in that domain."
And: "if the files are already there, upgrading should always be instant —
you're just changing a head pointer."*

*2026-09-13. Jaime: "There should only be no tabs — items on or off under
localhost 4250. This is all of the packages… then if you switch to jwize.com
you see the subset and a number of how many overlaps for this signature." And:
"just a list and then a revisions icon… a drill down to revisions and then
select and then you're back." And: "you should just have to explicitly walk
your way down the tree where there's changes."*

The hosts window used to offer builds per domain, with the origin pinned first
as "your domain". Every screen read as *pick whose app to run*. That was the
wrong noun. The question is **which parts of the tree run here, and has the
publisher I follow moved any of them?** — and it is answered in ONE window,
the host directory.

## The unit: a package is a branch

A **package** is a named layer of the served tree, at ANY depth — `games`,
`games/arkanoid`, `games/arkanoid/themes`. Its **name path** is its identity
(the grammar); its **layer signature** is its version. A layer's signature
covers its whole subtree, so a change deep in the tree moves exactly the layers
on the way down to it: an update mark on `games` means "something inside games
moved", and walking in shows what.

`hypercomb-runtime/src/package-tree.ts` reads them: `walkTree(root, io, picks)`
names every package by path with only the bees its own layer declares, and
reports `complete` — a walk with a layer it could not read never becomes an
activation. (`package-units.ts` still reads the top level for older callers.)

Composing a new package — files off, a folder taken from another signature, a
trait left open, including an upgrade of the AI package — is minted on the
host's file view and tried on a mission door
([build-debug-isolation.md](build-debug-isolation.md)). This window is where a
composed root is taken into what runs.

## What runs: the trunk, and picks over it

What runs is the **trunk** — the root you installed — with **picks** laid over
it by path (`hc:install:picks`, `{ path: { layer, root, hides, at } }`). A pick
says "at this path, this layer, from a root that carries it". It is decoupled
from where it was found: a revision is a signature, and every root carrying it
is a source for the same revision. Taking an older revision is applying
something from an earlier date — nothing is moved or deleted, and dropping the
pick puts the trunk's layer back.

`acquire.ts`:

- **`pickRevision(path, { layer, root, roots }, zones, { hides })`** — the
  pairing is never taken on trust: a candidate root must name that layer at
  that path (`layerAt`). The root must be one this shell already trusts (it ran
  or was admitted here) or one the activation gate admits — so an older
  revision is pickable exactly when a publisher you follow once named a root
  carrying it. Only what the pick needs is admitted: the branch's layers and
  bees, and the root's namespace bundles under the path.
- **`applySelection(trunk, admitted, picks)`** — composes and activates. Each
  pick's namespace dependencies come from its own root (a queen, view or
  service builds into its namespace's bundle, which only the root lists); a
  namespace under two picks belongs to the deeper; the trunk supplies the
  rest. Every gate an install passes is passed again over the composed set:
  complete, runnable by this shell's core, and — **the sideways check** — no
  picked module importing a namespace the selection does not carry, refused by
  name. The picks are written only once all of that holds. A pick from the
  trunk itself is pruned.
- **`installPackage`** composes the picks over a new trunk, so what you took at
  a path stays taken across a trunk move — boot repair and the floor never
  touch a pick.
- **Update all takes every update** (*2026-09-23*, jwize: "you have to choose
  what you want updated" — Update all is choosing all of it). The install
  port's `acquire` passes `takeAll`, and `releasedByTakeAll` releases each pick
  the new root moves past, so the new root's layer runs there. Kept: a path the
  new root does not name, a downgrade confirmed with **Take it anyway**
  (`hides`), and a trial taken by hand (`byHand`). Nothing is deleted — the
  bytes stay held and the revisions list takes any of them back. Found live: a
  pick taken before `assistant` was split into atoms kept the old chat
  organizer, with no rate-limit back-off, running after every Update all.
- The brood holds the new trunk's bees on this path too: a pick used to skip
  `holdArrivals` entirely.

## On and off

`hc:install:off-units` holds the PATHS that are off. A path off takes everything
beneath it; a leaf off leaves its parent on (`enabledBees`). Layers and bytes
stay held, so turning something on or off is `applyUnits()` — the selection
composed from held bytes and the activation record written again. No host
asked, no byte fetched. A part inside a branch that is off names that branch:
turn it on first.

**On and off take effect while the hive runs** (*2026-11-10*, jwize: "shouldn't
we be able to add and remove features in realtime from the hosts window?").
Once the record is written the window asks the shell's preloader to
`recompose()` (`hypercomb-runtime/src/script-preloader.ts`): one processor pass
walks the new record, loads and pulses what came on, and disposes what went off
— out of the registry, its bus subscriptions cut, its word gone from the
command line. What a bee's module registered beside it (its queen, its
services — the bee wires) goes with it: the preloader keeps each module's own
run of registrations as the bee's *company*, and a company it cannot tell from
another bee's leaves the switch to a restart. A queen asleep goes with her
package and comes back asleep. The
activity log says *games is on* / *games is off*, and the list repaints where
it stands.

Live is not yet instant. Measured on a web shell with a 45-package trunk
(2026-11-10): the switch itself — the processor pass — takes about 5 ms; the
wait is `applyUnits()` composing the selection from held bytes, about 5 s, plus
about 4 s more the first time a selection is seen, while its minified
registration is derived (`reminify.ts`). The row stays busy for that long.

A restart is kept wherever it is the only honest way, and `recompose()` answers
false there having changed nothing:

- **a running bee with no `dispose()`** is going off. `markDisposed()` cuts
  what went through the bus; a DOM listener, a timer or a surface wired by hand
  would outlive the bee, and "off" would be half true. `dispose()` is the bee
  saying it can let go while the hive runs — give a bee one and its package
  switches off live. A bee that never loaded (asleep, passive) has nothing to
  let go of;
- **the record names other namespace bundles** — the import map is bound when
  the page loads;
- **a package only a host carries** is picked in (`pick`), and a **revision**
  or **Update all** changes which code runs at a path: still a restart;
- a shell from before `recompose`, a read-only reader, and a door that serves
  modules by a stable address when a bee evicted earlier would come back (the
  browser hands back the module it already ran).

## The window

`<hc-host-directory>` (`hypercomb-essentials/src/sharing/host-directory.view.ts`)
— a framework-free element contributed through the ShellSurfaceRegistry,
reaching runtime through the **install port** core declares
(`install.types.ts`, `INSTALL_IOC_KEY`, registered by `acquire.ts`). It is
window `hosts-panel` with the `hosts` launcher, so the hosts drone's
`isWindowShowing('hosts-panel')` and its open/close effects drive it. The
Angular hosts panel is gone. `packages:open` (the update notice, `/upgrade`)
lands here.

**A full-screen desk** (jwize, 2026-11-04: "the host window needs to be full
screen"). Docked narrow on the right it was a drill-down squeezed into 280–560px;
it now takes the page the way the editor, keyboard and comfy desks do
(`data-hc-sheet="full"`, the `view:active` and `view:keeps-controls` modes, the
input gate, the back gesture):

- **A rail of hosts down the left**: this origin, every host you carry (a dot
  for *update waiting* or *behind*, the name, how many packages it lists), and
  **Your host** below them, where your own host is set. The arrow keys walk it
  and the pane follows. The search and the add field sit in the rail.
- **The chosen host's pane in the middle**: its name, its acts as a quiet row
  and the update bar over **the columns** (below). A search finishes into lines here.
- **Revisions open in a drawer** on the right and the columns stay where they were.
  Under about 1100px the drawer lies over them instead of squeezing them.
- **Hosts are what comes in; Publish is what goes out.** They stay two windows.
  A host's pane has one link, *Publish ›*, which closes the desk and opens
  Publish. This origin is no destination, so it has no link, and the desk holds
  none of Publish's acts. Beside the link, **how many branches that host names
  as live**: *2 published here*, or *Nothing published here yet*. It is read
  from your own signed index on that one host (`publishedCount` in the view) —
  one verified read when the host's pane first opens, kept until the desk
  closes — and not from Publish's sweep, which seals and probes every branch.
  A branch counts when the index names a head for it and its entry lists no
  doors or lists this host, the rule Publish's rows use; `plan:…` and
  `install:…` pointers are not branches. A host that did not answer, a device
  with no key (looking never mints one) and an index that does not verify show
  **no number** — an unreachable host is not an empty one. A host that answers
  404 holds no index of yours, which is the plain *nothing*.
- **Escape** unwinds one level (search, question, warning, drawer, the code
  being read, the deepest column's pick) and with nothing picked does what it does
  everywhere: one press puts every window away, and a press at once brings them
  back. The hosts icon also brings a window the sweep parked back in one press.
  Escape goes by the focus, so the desk keeps it: a repaint never drops the row
  that held it, and focus is never left on the page behind.

## Two ways to look — simple, and the four panes

(jwize, 2026-11-05: "we need to up the participant experience — this is advanced mode;
the other should just be the hosts list large in the middle with a drill down to the
code. Nothing fancy, the same things but single drill in, maybe the items can be toggled
as a multiselect." Then: "no I think we need both", "just do a simple version", "this
four pane view is beautiful", and "no select, just advanced there — select can be ctrl
click or toggle".)

**Simple is how the desk opens.** There is no rail and no strip of columns — one
large list in the middle and a step in at a time:

1. **The hosts** — this origin, every host you carry (a dot saying whether an update
   waits, how many packages it lists), your own host, and the field to add one.
2. **A host's packages** — the host's name, its door to Publish and what it carries on
   top, then the packages as large rows with everything the four panes' rows have (the
   light, the update mark, the manage menu). A click goes into the package: the parts
   inside it are listed, and under them the files it declares.
3. **The code** — a file clicked is read, full width, in the code theme, with the ✎ to
   describe it.

Above every page is **Back** and a trail of where you are (*Hosts › try.localhost ›
assistant › anatomy*); **Escape** goes the same one step back, and the list of hosts is
the last stop before the desk closes. It is the same state the four panes read (`#stack`,
`#cols`, `#files`), shown one step at a time, so nothing a pane could do is out of reach
and the two views agree about where you are.

**The drill has no multiple select** — nothing fancy (jwize, 2026-11-05: "no select, just
advanced there"). Going into several hosts, packages or files at once is the four panes' job.

**Advanced** (top right, beside ×) is the four panes, exactly as they were: hosts in the
rail, then packages, files and code, side by side. Its switch says *Simple view* to come
back. **Selecting several lives here, two ways** ("select can be ctrl click or toggle"):
**Ctrl/Cmd-click** toggles a row in or out and **Shift-click** extends, as in the Finder;
or turn on **Select** (beside the switch, shown only in the four panes), which makes every
plain click a toggle and puts a check box on the package and file rows. Hosts picked in the
rail are stacked into one list, packages picked in a column open their parts together, and
files picked are read side by side in the code pane. Escape lets go of Select first, and
switching to the drill puts it off.

**Both are remembered.** One current record in the pool `hosts:desk`
(`{ mode, panes }`, `sharing/host-directory.drill.ts`), written only by a press or a drag —
never by the desk's own initiative — and read without minting the pool; a switch or a
drag made before it was read is newer than it. Simple is the answer to "not set".

**The panes are dragged.** In the four panes the edge of the rail, of the package
columns and of the files is a separator: drag it to set the width you prefer (the code
takes what is left), nudge it with the arrow keys, double-click it to give it back. The
widths are custom properties on the desk (`--hd-rail-w`, `--hd-pkg-w`, `--hd-files-w`) with
the stylesheet's own as fallbacks, held between 11 and 30–32 rem, and kept when the
drag is let go.

**Finished updates go last.** While *Update all* runs, the list is what is changing,
each row filling as its changed files arrive. A package whose update has landed (every
changed file of it is in) drops to the bottom of the list with a **completed** look —
dimmed, a ✓ before its name — so what is still moving stays in view. The order is
`finishedLast` (stable inside each group); the look is the `completed` class.

## The columns — the Finder's column view, over code and files

*jwize, 2026-11-04:* "let's make this like the mac finder of code and files with
multiple select on all columns then you can look at code files in the matrix" …
"multiple layers (I guess four columns) but you should be able to include stacked
domains or hives to the searching and views."

The pane under a host's acts is a column browser. The rail is its first column,
each package level is the next, then the code files, then the matrix. The strip
scrolls sideways when it runs deeper than fits, and a new column scrolls into view.

**Four panes, always.** *jwize, 2026-11-04:* "split the screen in to four panes and
show a nice default view." The desk is **Hosts | Packages | Files | Code**, each
captioned the same way, and **all four are drawn from the first paint** — the Files
pane and the Code pane are there before there is anything to put in them, and say what
they wait for (*Pick a package to see the code it declares.* · *This package declares
no code of its own.* · *Pick a file to read its code here.*), so the screen never
reshuffles itself around a pick. A package with sub-packages adds its own column inside
the Packages pane, as it always did. The widths are chosen so the four fit a 1280px
desk without a sideways scroll — the rail at most 18rem, a column 16rem (giving down to
12.5rem before the strip scrolls) and the code pane 24rem or whatever is left — and a
spec adds them up.

**The default view.** A desk nobody has picked in opens on a good first view, not an
empty list: the first package, in the order the first column lists them, that declares
code of its own **and has no sub-packages** is picked (a package with some opens a
column of its own, and four panes would be five; failing that, the first that declares
code at all, then the first found going down the branches in listed order —
`defaultTrail`), its files open the Files pane, and **once the files'
names are in** the first of them by name is picked, so the Code pane is reading a real
file. It waits for what it needs (the list; then each declaring layer's `docs`, so the
first is the one the column shows first rather than the first by signature) and gives
up quietly when everything is read and nothing declares code. It is a courtesy and it
is the participant's to end: **any pick of their own, and any Escape that lets one go,
ends it for good** — the desk never puts back what was chosen away. A new opening, a
different host (or stack of hosts) in the rail, and *back to the start* each get a
default view of their own; a restart that returns to a path keeps the path.

**Picking is the Finder's, in every column**, the rail included: a click takes one
line, ctrl/cmd-click adds or takes one away, shift-click extends from where the
last pick was, ctrl/cmd-A takes the column. Arrow keys walk a column and the pick
follows (shift extends), right opens the next column on its first line, left goes
back. A pick in a column drops whatever was picked deeper.

**Stacking.** Several hosts picked in the rail are *stacked*: their packages are
one list in every column, a package several of them carry is one line, and one
whose signature they disagree on says *differs*. The pane says *N hosts stacked*
and draws no act of any one host. The search covers the hosts stacked — one line
per package, saying which carry it — and choosing a line opens the columns down
to it. (This origin is already the union of every host's list, so stacking it
with others adds nothing.)

**Packages.** Each column lists the parts of whatever the one before picked — the
union across everything picked, across every stacked host. A row is its light, its
name, its marks (update, picked, not here yet, differs), how many of your hosts carry
the same signature, and its manage icon (below).
Parts inside a package are the next column; the old drill-down, its breadcrumbs
and the row that expanded into a description are gone (a row's description is its
tooltip).

**The light and the manage menu.** *jwize, 2026-11-04:* "it should be on but dim if
there is a newer version and a spectrum based on how old. The update brings to newest
or you click the manage icon turn it off or pick revisions and look at code in the
finder view." The bulb on a row tells — and, since *2026-11-10* (jwize: "Yes,
bulb switches"), a press on it is the on/off switch again, the same act as the
menu's first item under the same rule (`#switchable`): disabled, with the reason
as its tooltip, wherever the menu's item is. What it tells:

- **lit** — on, and current;
- **lit and dim** — on, and a newer version exists. The dimmer the older the version
  running: from 0.85 for one first seen today to 0.30 at six months and beyond,
  logarithmic so the first days count for more than the months, and 0.55 when its age
  could not be told. The age is when the running layer first appeared on a host,
  read from that path's revisions — only for rows that are on and behind, two at a
  time, once each, and the row says the date in its tooltip;
- **outline** — off.

The *update* mark brings the package to the newest. The **manage icon** (⋯) opens a
menu over the desk beside the row: **Turn off** or **Turn on** (with the reason it
cannot, as a tooltip — this shell runs from source, a part inside a branch that is off,
a host that is behind), **Update to the newest** (only when there is one),
**Pick a revision…** (the drawer) and **Look at the code**, which picks the package so
its files are the column that opens and puts the focus on the first of them. Escape
closes the menu before anything else, and so does a click anywhere but the menu.

**Files.** After the deepest picked package, a column lists the code files — the
bees — those packages declare, each once, at the package that declares it. A file
is listed by **what it is, not what it hashes to** (jwize, 2026-11-04: "this should
have the logical locations right not just the signatures?"): its name on the first
line, and under it the kind, the package that declares it and the start of its
signature — `drone · assistant · b928e94a`. The column is sorted by that name, and
the order the column shows is the order a shift-range walks. The name is the file's
**meta layer** (below); with none of it, the file is named by its first line, which the
build writes as a comment (`// src/assistant/organize.drone.ts`, `// @scope/name`), and
only last by its signature.

**What a file is — its meta layer.** The primitive is a word, its signature, its layer
and a **meta layer**: the small layer that describes a thing rather than holding it,
versioned like everything else, replaceable without touching the value
(`living-presentation.md`, `uniform-decoration.md` "Meta resources"). A code file is a
signature, so who it is — its logical name, what it is for — is its meta layer, and
it has two voices, the participant's winning:

- **Published** — the build writes what every bee is (class name, kind, description,
  what it listens to and emits, its command and aliases) into the layer that declares
  it, `docs.bees[<sig>]` (`build-module.ts`). It sits inside the signed layer: no host
  can alter it and reading it costs nothing beyond the layer, which the desk reads once
  per layer (what is held here, else a host — a layer is small and immutable). It is the
  file's **own** version and is never rewritten.
- **Yours** — one document per file signature in the pool `meta:bees`
  (`{ "v": 1, "name"?, "description"? }`, `sharing/bee-meta.ts`). It overrides the
  published words **field by field** — a name of your own with the published
  description, or the other way round. A person chose it, so it is written as a human
  save: **every earlier version is kept**. It lives in this hive and changes nothing
  else — not the bytes, not the layer that declares them, not one signature. The
  published words stay the default and are shown as the placeholders, so an empty field
  reads as "as published". A read never mints the pool (`openPool`), a record of another
  version or a damaged one is no words at all, and a name is one line and bounded
  (80 characters, a description 600).

Every code panel has a **✎** beside its close: it opens a small editor in the panel —
*Name*, *What it does*, *Save*, *Use the published words* (only when you have given
some; it writes an empty version, so the history stays) and *Cancel*. Enter saves,
Escape lets go of the field and then closes the editor, and what is typed survives a
repaint. A file wearing your words shows a ✎ after its name and an accent on its
description.

Not built: the **authored** version of the same words — an envelope that travels with
the tile and is offered to the hosts you follow. This is the personal-annotation
carrier (the sig pool: no graph churn); the travelling one is the other carrier of the
same doctrine, and a package-level description override is the same shape one level up.

**The matrix.** Pick files and each opens in a panel of its own, side by side, as
many across as there is room for (six at most, the rest said). A panel's head is the
file's name and its place — kind, where its first line says it came from, the package
that declares it, the start of its signature and its size — and under it, what it
does. It shows the file's first 300 lines with line numbers drawn by CSS, so copying
takes the code and not the gutter; *Show the other N lines* opens the rest, and a file
over 400 KB is read from its start only, and says so. Code is read through the Store:
from what is held here to name the files, and **from a host only for a file that is
picked** — a bundle can be a megabyte and nobody asked for it. A signature is
immutable, so what was read is kept.

**The code theme.** Source is read in the DCP installer's one syntax map
(`dcp-installer-visual-spec.md` §1.5, "one map for viewing and editing"):
`sharing/code-theme.ts` holds the palette — background, gutter, selection, active line,
plain ink and the hues for keyword, string, number, function, type, comment and
punctuation — each as a dark and a light value under `light-dark()`, which the
**theme's own `--md-color-scheme`** picks between: there is no second dark switch
here. A small, forgiving tokenizer (JavaScript, JSON, plain; no dependency — highlight.js
is a lazy import in the shared chat, and a module may import nothing from shared) reads
each line once, carries what a block comment or a template literal leaves open, never
throws, gives every line back exactly, and paints a minified line (over 4,000
characters) as plain rather than as a thousand spans. It returns tokens, and the view
builds text nodes and classed spans: source is never parsed as markup. The gutter and
the head wear the palette too, and the line under the pointer takes the active-line tint.

The **chat window's code blocks wear the same map** (jwize, 2026-11-04: "yes, do it"):
`hypercomb-shared/ui/_code-theme.scss` spells the palette for Sass (`code.surface`
for the ground, ink and selection, `code.hljs` for highlight.js's token classes onto
the same `--code-*` tokens), and `chat-markdown.scss` includes both on `.chat-code`
in place of the palette it kept of its own. A stylesheet cannot import TypeScript and
shared may not import a module, so the values are written twice and
`shared/ui/code-theme-parity.spec.ts` is what keeps them one theme: every value of
`CODE_PALETTE` is in the SCSS, every class of the installer's own map lands on the same
token, and a comment is not italic on either surface (the installer's map says normal).

Not built: a search inside the code, picking several versions of one file to compare,
and a bulb or update that acts on the whole pick at once (each still acts on its own
row).

- **This origin** — the first rail entry — is every package any of your hosts
  carries, one row per path, on or shaded. **A host** is the same list
  filtered to what that host carries. Beside each row, how many of your hosts
  carry that SAME signature at that path.
- **Update**: a row the followed publisher moved wears an *update* mark —
  pressing it picks the followed revision of that package alone. *Update all*
  at the top moves the trunk.
- **Revisions**: *Pick a revision…* in a row's manage menu opens that package's revisions in the drawer,
  newest first (by when each first appeared on a host), gathered by signature
  from the trunk, the picks' roots, the followed head and each host's recent
  roots — marked *running* and *latest*. Choose one and the app restarts back
  at the list you chose it from.
- **A host** carries its own acts above the columns: its Creations (a pane of
  their own), Visit (never drawn on this origin — a second tab on your own hive
  is a second writer on one store), and removing it.
- A shell with no installed package (the dev shell imports modules from source)
  lists what your hosts carry and leaves every act to a hive. A package whose
  folder is in the shell's own source reads **on** and wears *from source*
  instead of *not here yet* (jwize, 2026-11-11: "everything in host for
  hypercomb.com says not here yet"): it runs whatever a record says, no update
  is offered for it, and its switch stays greyed with the reason. The shell's
  source catalog names the folders (`sourcePackagePaths`); a package the source
  does not carry is still not here.
- **A launcher goes with its package.** The rail's launchers are shell chrome, so
  a package turned off used to leave its button behind (jwize, 2026-11-11: "I
  removed comfy refreshed and still it was showing"). A launcher that names a
  word is hidden while the off list names a package of that name
  (`packageIsOff`), only on that positive evidence, and never on a shell that
  runs from source. A live switch says `packages:changed` so the rail repaints.
- **The list you are in goes first.** Opening the window paints what runs here
  before any host is asked, and holds the preloader's foreground
  (`ScriptPreloader.foreground`) until the followed publisher's list has
  painted: the idle hive, the resource preheat and the passive preload lanes
  wait, then carry on. Entering a view or saying a word holds it the same way
  and warms that view's own resources first. The other hosts fill in after, so
  a slow host never stalls the rest.

## Languages

Every string the desk draws is called with an English fallback, so a key missing
from a catalog never shows as a raw key — it shows as English to someone who chose
another language. English is the source and Japanese is the one other catalog kept
whole, so both carry every key the desk asks for, with the same `{tokens}` (a token
dropped from a translation shows as a blank, one invented as a literal). The other
twelve catalogs are brought up to date in their own sweeps and fall back to English
here. Until 2026-11-04 the whole window was English in Japanese: 66 strings that had
never been translated, plus the desk's own 32 new ones. A count that needs a
singular in English has a `.one` and an `.other` (*Show the other line* / *Show the
other {count} lines*); Japanese has no plural and one plain key carries the number.

Keys the column browser retired — `hosts.walk-in`, `hosts.up`, `hosts.path`,
`hosts.revisions.open`, `packages.same` — are left in the catalogs, as deprecated
keys are: the other twelve languages carry them too, and removing them is a separate
sweep.

## Downgrades are explicit, and hide rather than delete

Choosing a revision OLDER than the running one, when it would replace newer
parts inside it (or picks made there), asks first: it names those parts and
offers **Configure them one by one** — which walks into the package — or
**Take it anyway**. Taken anyway, the pick *hides*: the picks beneath it are
kept but stop applying, and the parts it replaced are hidden, not deleted,
until the package is on a revision that does not hide. The row says how many
newer parts it hides.

## Boot never moves the head

`ensure-install.ts`: a warm hive whose spot-check finds a missing atom
**repairs the installed build in place** before it will ever wipe and take a
cold head. A bundled install composes the off paths and picks over the tree it
just admitted.

## The origin is the shell

*Jaime: "only have imports from our own host servers and never from
hypercomb.io… the hosts are your proxy." And: "this makes your host your own
sandbox before you bring them into hypercomb.io."*

- **Bytes come only from the hosts you carry** — plus the one seed host
  (`DEFAULT_HOST_ZONES`) on a cold boot. `originAmong(zones)` admits this origin
  as a byte source only when it is itself one of the domains asked.
- **Only the followed channel announces updates.**
- **First-run Start acquires from hosts** (`installFromHosts`). The bundled
  install remains only where the origin IS the host: a published visitor door,
  and the native shell's bundle.
- **The web deploy publishes no package pool** — each web workflow strips
  `content/` before upload.

## Ratchets

- `runtime/src/script-preloader.recompose.spec.ts` — on and off while the hive
  runs: what goes off is disposed and unregistered, what comes on is pulsed in
  the same pass, a sleeping queen goes with her package, and every case that
  needs the restart answers false with nothing moved.
- `runtime/src/package-tree.spec.ts` — paths at every depth, a pick replacing
  one branch, a package joining under its parent, hiding and un-hiding, off by
  path, namespace ownership, the sideways check, revision order, the records.
- `essentials/src/sharing/host-directory-view.spec.ts` — the list as data
  (union, per-signature counts, walking in, off above, marks), the downgrade
  decision, and the shape: one element through the port as window
  `hosts-panel`, no Angular window, the drill returning to the list, the gate
  before admission, the sideways check before the picks are written.
- `essentials/src/sharing/community-hosts-panel.spec.ts` — the pool's one
  writer, creations on demand, no builds and no switch, no orphan strings.
- `shared/i18n/host-directory-keys-parity.spec.ts` — every string the desk draws is
  in `en.json` and `ja.json`, translated and not copied, with exactly the tokens the
  English has, and the English fallback in the code says what the catalog says.
- `essentials/src/sharing/bee-meta.spec.ts` — the two voices of a file and the
  participant's winning field by field; the document one per signature, every version
  kept, an empty version handing the published words back, a read that never mints
  the pool, and a record of another version or a damaged one read as no words.
- `essentials/src/sharing/code-theme.spec.ts` — the tokenizer (every line given back
  exactly, whatever it holds; a regular expression told from a division; block
  comments and `${ }` templates carried across lines; never throws, fuzzed) and the
  palette — the DCP installer's values, dark and light, scoped to its surface, no
  second dark switch, no import.
- `essentials/src/sharing/host-directory-files.spec.ts` — the files by what they are
  (named by class and kind, sorted by name, the signature last) and the desk wearing
  them: the layer's docs and each file's words read as files come in, the editor, what
  is typed surviving a repaint, Escape's rung, and source drawn as text nodes under
  the one palette.
- `essentials/src/sharing/host-directory-panes.spec.ts` — the default view as data
  (`defaultTrail`: the first package that declares code, then down the branches in
  listed order, empty when none, a guard against a tree that never ends) and as shape:
  the default picked at the top of the columns, the first file chosen only once the
  names are in, every pick and every letting go ending it, a fresh one for every
  opening, start and stack, the Files and Code panes always drawn with their
  placeholders, and the four widths adding up to a 1280px desk.
- `pool-registry.ts` seeds `meta:bees` and `hosts:desk`, so the doctrine ratchet that
  every derived pool meaning is in the census holds.
- `essentials/src/sharing/host-directory.drill.spec.ts` — which page a state is, the
  list a packages page shows, the trail, the kept record (simple unless advanced, widths
  held inside their limits, the same choices the same bytes), and finished work last.
- `essentials/src/sharing/host-directory-simple.spec.ts` — the shape the view keeps: simple
  by default and the four panes one switch away and drawn as before, a click going in with
  no select in the drill, Select (and Ctrl/Cmd-click) in the four panes only, Escape's steps in order, the drag
  setting a custom property live and keeping it on release, the record written only by a
  press or a drag and read without minting the pool, and a landed update dropping last.
