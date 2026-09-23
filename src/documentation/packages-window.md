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
(`install.types.ts`, `INSTALL_IOC_KEY`, registered by `acquire.ts`). It docks
as window `hosts-panel` with the `hosts` launcher, so the hosts drone's
`isWindowShowing('hosts-panel')` and its open/close effects drive it. The
Angular hosts panel is gone. `packages:open` (the update notice, `/upgrade`)
lands here.

- **This origin** — the first domain chip — is every package any of your hosts
  carries, one row per path, on or shaded. **A host chip** is the same list
  filtered to what that host carries. Beside each row, how many of your hosts
  carry that SAME signature at that path.
- **Walk in**: a row with parts inside it opens into its children, with the way
  back above the list. A search reaches every depth beneath where you are.
- **A row is a heading**: one opens at a time, showing its description and
  every host carrying it, at which version.
- **Update**: a row the followed publisher moved wears an *update* mark —
  pressing it picks the followed revision of that package alone. *Update all*
  at the top moves the trunk.
- **Revisions**: each row's ↺ replaces the list with that package's revisions,
  newest first (by when each first appeared on a host), gathered by signature
  from the trunk, the picks' roots, the followed head and each host's recent
  roots — marked *running* and *latest*. Choose one and the app restarts back
  at the list you chose it from.
- **A host** carries its own acts above its list: its Creations (a drill of
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
