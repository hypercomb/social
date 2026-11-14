# Package components — composing an operating experience on the hosts desk

**Status: proposed 2026-11-11 (jwize). Built so far (2026-11-13): Save as a named
package and Use as a host's root, on the desk (packages-window.md, "A package of your
own"). The target pane, the package viewer and components are not built.** It extends
[packages-window.md](packages-window.md) (the hosts desk) and
[build-debug-isolation.md](build-debug-isolation.md) (the mint). Where it
names a rule, the rule is a proposal until this status line says otherwise.
It does not change the doctrine codex yet.

*jwize, 2026-11-11:* "do you think we should have a double pane view on the
hosts when synchronizing them to show the signature root and tree that the root
has so in a sense it is showing the target package when you sync. That way you
can look at the install. I think this will be especially useful when you create
our own package from existing ones like minimal and give them revision name.
That way we can share and communicate about them as named packages. Then we can
turn on items from the left side and then saving the host will change the root
signature and serve the package as is to wherever you post it."

And: "This is really the view you get to see the code so it might also be good
to see a package viewer to see the system as it expands out its tree and
workpaths."

And: "Then we need to be able to wrap and group packages as components (ie
group related things) so we can quick compile and create new package operating
experiences."

And: "following means that you have a snapshot now which can't go out of date
but you get notifications on update."

## The gap this closes

What runs here is the trunk, with picks laid over it and some paths turned off
(`hc:install:picks`, `hc:install:off-units`). Those are local records. The
composition they describe has **no signature**, so it cannot be named, posted,
followed or talked about. Only a root can be shared, because only a root is
something two people can agree on.

The mint ([build-debug-isolation.md](build-debug-isolation.md)) does make a
root from a composition, but it lives on the shim's file view, apart from the
desk where you choose what runs.

This page brings the two together: the desk shows the root your choices make,
lets you group packages into components, and saves the result as a named
package.

## Two panes: what you draw from, and what you are making

When you sync a host, the desk shows two panes side by side.

- **Left — sources.** The packages the chosen host offers, and above them the
  components you hold (below). A switch on each row turns it on or off. This is
  the four panes' package list, nothing new.
- **Right — the target.** The root your choices make, and the package viewer
  under it.

The right pane answers "what is the thing I am making?" while the left answers
"what is this host offering?". Both drill down to the code the same way.

### The package viewer

The target as a tree, expanding by path (`assistant › anatomy › …`):

- **The root signature at the top, recomputed as you switch.** A folder nobody
  touched keeps its signature, so only the layers on the way up from a change
  get new ones. The pane marks each of them. Watching the root move is the
  plainest way to see the merkle tree work.
- **Every layer with its signature,** and a mark where it differs from its
  source: new, moved, or turned off and scrubbed.
- **The component that brought each layer in,** in that component's colour,
  so you can see at a glance where the parts of the system come from.
- **Down to the files and their code,** read the way the columns read them.
- **What it needs.** The namespace bundles the root still names, and every
  refusal the selection would meet (below), shown before Save is offered.

## Components: related packages, grouped

A component is a named set of packages that belong together, such as "chat",
"hosting" or "the card". Turning a component on turns on its members.

**A component is a set its members belong to, never a wrapper around them.**
A new parent layer holding the packages would break the artifact doctrine
([website-artifact-paradigm.md](website-artifact-paradigm.md): relations are
marks the members wear, never a parent). It would also re-mint every package
it wrapped, because a layer's signature covers its subtree. Wrapping would
change the very things you meant to share.

So a component takes the shape publish groups already have
([publish-groups.md](publish-groups.md)):

| | What it is |
|---|---|
| **identity** | a meaning, scoped (`component:chat`); its signature derived by `groupSignature(meaning)` ([group-signatures.md](group-signatures.md)) |
| **appearance** | name, icon, colour; changing them changes no member |
| **a snapshot** | the member list as one canonical record, `{ meaning, members }`, named by its own signature |
| **a member** | `{ path, layer, root }`: this layer at this path, from a root that carries it |

A member is the same shape as a pick (`{ layer, root }` at a path) and as the
mint's `choices` (`{ path, sig, source }`). **A component snapshot is a pick
set with a name.** Nothing about choosing a layer changes; the set is just
given a name and a signature.

A package can belong to several components (`assistant` in both "chat" and
"full hive"). Its bytes are held once.

## Following is a snapshot, with a notice

There is no live mode. **Following a component means you hold a snapshot that
cannot go out of date, and you are told when there is a newer one** — the
held-item rule of [using-a-creation.md](using-a-creation.md), applied to
components.

- **A snapshot never moves under you.** Its members are signatures, and the
  bytes are never deleted, so it keeps working for as long as you hold it.
- **A newer layer is a notice.** When a member's path has a newer layer in the
  root the publisher you follow names now, the component says so: *chat: 2
  members have newer layers*.
- **Upgrade, skip or leave it.** Upgrading writes a new snapshot with the new
  layers, under the same meaning. Skipping keeps the newer snapshot as the next
  entry under the current one. The old snapshot stays valid, so an experience
  built from it still compiles to the same root.
- **A component someone else authored** follows the same way: their newer
  snapshot under the same meaning is the notice.

## An operating experience: components over a trunk, compiled to a root

```
experience = trunk + component snapshots + off paths  →  mint  →  root
```

- **Compiling is the mint,** run over the composition: each member is a
  choice, each path turned off is an `offPaths` entry
  (`mintBranch(branch, edits)`, `hypercomb-shim/src/bootstrap/branch-files.ts`).
- **It is deterministic.** The same choices on the same trunk are the same
  root. A combination compiled before is already held and costs nothing; a new
  one rewrites only the layers on the way up from what changed. That is the
  quick compile, and it needs no cache of its own.
- **"Minimal" is a recipe, not a fork.** For example, the trunk with "card",
  "hosting" and "replication" on and everything else off. The full hive is the
  same recipe with more components. Builds are phased up from the minimal one,
  never forked from it ([using-a-creation.md](using-a-creation.md), "The minimal
  build").

## Saving: a named package, served as it is

**Save** on the target pane:

1. mints the root, if it is not already held;
2. appends it to your host's `sign('host:packages')` pool as
   `<rootSig>\n<name>`. The second line is the name, and the member file's date
   is the revision's date ([publishing-a-revision.md](publishing-a-revision.md)).
   The revisions drawer already groups by name (`revisionGroups`), so
   *minimal* gets its own heading with its revisions under it;
3. records which component snapshots and off paths composed it, so a revision
   can always say what it is made of.

**Save adds; it never overwrites.** The pool only grows. The previous root
stays valid and stays in the list.

**Announcing is its own act.** A host serving the bytes is not the same as
followers being told. Advancing the signed `install:<name>` pointer stays a
separate, deliberate step, taken only once the host holds every file of the
root — the order publishing already keeps, so nobody is offered a root the
host cannot serve.

**Hosts bring things in; Publish sends things out.** The desk keeps that line
([packages-window.md](packages-window.md), "The window"). Save writes to your
own host's pool; announcing goes through the publish act, not a second copy of
it inside the desk.

## Rules the composition keeps

- **Every gate is checked before Save.** The same checks `applySelection` runs
  (`hypercomb-runtime/src/acquire.ts`): the walk is complete, the code is
  runnable by this core, and the sideways check — a picked module that imports
  a namespace the selection does not carry is refused, by name. The viewer shows
  each refusal where it applies; Save is not offered while one stands.
- **What a component needs is derived, never written down.** The sideways
  check already knows what a selection lacks, so the viewer says *chat needs:
  i18n, core-ui*. A hand-written dependency list would be a second truth that
  drifts.
- **Two components claiming one path is refused and asked,** never resolved
  silently. Namespace bundles keep their existing rule: a namespace under two
  picks belongs to the deeper one.
- **Component snapshots live in a pool of meaning,** so they replicate and can
  be offered from a host like anything else. A host could then offer components
  as well as finished roots, and others build their own experiences from your
  parts. The pool's meaning is open (below).

## What has to move or grow

- **The mint moves down into runtime.** It lives in the shim today; the desk is
  an essentials view reaching runtime through the install port, so it cannot
  call the shim.
- **A choice can only replace a folder the trunk already has.** `mintBranch`
  refuses a choice whose path is not in the tree (*No folder … to choose*).
  A component that adds a package the trunk lacks needs the mint to graft a new
  path.
- **A chosen folder's namespace bundles stay behind.** The mint copies each
  node's own `dependencies`; a namespace bundle a chosen folder needs from its
  source root is not brought along. `applySelection` already solves this for
  picks (`composeDependencies`); the mint must do the same, or the root it makes
  fails the sideways check it is meant to pass.
- **Live switching keeps its limits.** Turning a component on or off here is
  the same `recompose()` as any switch, with the same cases that still need a
  restart ([packages-window.md](packages-window.md), "On and off").

## Order of work

1. **The target pane, read-only.** The root recomputed as you switch, the
   package viewer, the change marks, the refusals. No component, no save.
2. **Components.** Meaning, appearance, snapshots, the update notice, the rows
   on the left pane.
3. **Name and Save.** The mint in runtime, the grafted path and carried bundles,
   the pool member with its name, the composition record.
4. **Announce.** Through the publish act, after the host holds the root.

## Open for jwize

- **The pool's meaning** for component snapshots: `packages:components` is the
  working name.
- **Whether a component may carry off paths** of its own (a "no AI" component
  that turns things off), or only members that turn things on.
- **Whether switching on the left changes what runs here,** or only the target.
  With the try door retired ("change at home, publish names a root"), the
  default would be that they are the same: what runs here is what you save.

## Ledger

| | Status |
|---|---|
| Two panes on the hosts desk: sources and the target root | proposed |
| The package viewer: tree by path, layer signatures, change marks, code | proposed |
| Components as named, signed sets of `{ path, layer, root }` | proposed |
| Following = a pinned snapshot plus an update notice | decided 2026-11-11 (jwize) |
| Compiling an experience through the mint | the mint is built in the shim; not reachable from the desk |
| Save as a named member of your host's `host:packages` pool | built 2026-11-13: *Save as a package…* on this origin's pane (`sharing/host-package.ts`), through the runtime's commit; it does not yet record which components composed it |
| Announcing a named package as `install:<name>` | built 2026-11-13 as its own press, *Use as the root of <Home Domain>*: every file first, then the signed pointer |
