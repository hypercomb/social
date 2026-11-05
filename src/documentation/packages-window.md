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
composed from held bytes and the activation record written again, then a
restart. No host asked, no byte fetched. A part inside a branch that is off
names that branch: turn it on first.

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

## The columns — the Finder's column view, over code and files

*jwize, 2026-11-04:* "let's make this like the mac finder of code and files with
multiple select on all columns then you can look at code files in the matrix" …
"multiple layers (I guess four columns) but you should be able to include stacked
domains or hives to the searching and views."

The pane under a host's acts is a column browser. The rail is its first column,
each package level is the next, then the code files, then the matrix. The strip
scrolls sideways when it runs deeper than fits, and a new column scrolls into view.

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
finder view." The bulb on a row no longer switches anything; it tells:

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
is named by its first line, which the build writes as a comment
(`// src/assistant/organize.drone.ts`, `// @scope/name`); until it is read the
file is its signature.

**The matrix.** Pick files and each opens in a panel of its own, side by side, as
many across as there is room for (six at most, the rest said). A panel shows the
file's first 300 lines with line numbers drawn by CSS, so copying takes the code and
not the gutter; *Show the other N lines* opens the rest, and a file over 400 KB
is read from its start only, and says so. Code is read through the Store: from what
is held here to name the files, and **from a host only for a file that is picked**
— a bundle can be a megabyte and nobody asked for it. A signature is immutable, so
what was read is kept.

Not built: syntax colour, a search inside the code, picking several versions of
one file to compare, and a bulb or update that acts on the whole pick at once (each
still acts on its own row).

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
  lists what your hosts carry and leaves every act to a hive.

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
