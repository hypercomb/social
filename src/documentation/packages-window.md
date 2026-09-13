# The Packages window — one list, yours first

*2026-09-12. Jaime: "you shouldn't be looking through the domains; look at your
own domain and what's on, and maybe shaded and not on, which is searchable.
Same experience per domain lookup, but you explicitly search in that domain."
And: "if the files are already there, upgrading should always be instant —
you're just changing a head pointer."*

The hosts window offered builds per domain, with the origin pinned first as
"your domain". Every screen read as *pick whose app to run*. That was the wrong
noun. The primitive the code already had — a publisher's signed index carrying
one `install:<channel>` pointer, `hc:install-follow` as the follow, the
activation gate admitting what a followed key signs — was built for a
different question: **which named parts of the tree load here, and has the
publisher I follow moved any of them?**

## The unit

A **package** is a top-level layer of the served tree — `assistant`, `games`,
`sharing`, `presentation`, one per feature directory the build emits. Its
**name** is its identity (the grammar); its **layer signature** is its version.
A build that changes `games` and nothing else changes exactly one unit's
signature, which is what makes a per-package update mark honest.

`hypercomb-runtime/src/package-units.ts` reads them: `packageUnits(root, io)`
walks the root's `cells` one level down and unions each subtree's bees. A
subtree that does not resolve yields no unit — never a unit with a partial bee
list.

## On and off

`hc:install:off-units` holds the NAMES that are off. Activation
(`acquire.ts` → `activate`) writes every bee the root names minus the bees
declared only by off units. Layers, dependencies and the bees themselves stay
held, so:

- turning a unit **on** or **off** is `applyUnits()` — re-read the installed
  root from held layers, write the activation record again, restart. No host
  is asked, no byte is fetched: a head repoint.
- an **update** is `acquire(namedRoot, zones)` — the same gated acquisition
  every install passes, reusing every atom already held. Instant when the
  bytes are here, a delta when they are not.
- the off set is names, so it survives every update.

## The window

`<hc-packages>` (`hypercomb-essentials/src/sharing/packages.view.ts`) — a
framework-free element contributed through the ShellSurfaceRegistry, reaching
runtime through the **install port** core declares (`install.types.ts`,
`INSTALL_IOC_KEY`, registered by `acquire.ts`). It docks on the right like
every tool window. `packages:open` opens it — from the update notice and from
`/upgrade`.

One searchable list:

- **this hive** — every unit of the installed tree. ON rows load; rows that
  are off are shaded (ink one rung down, never opacity). A unit the followed
  publisher has moved wears an *update* mark; a unit the publisher added and
  this tree does not have yet is listed shaded with *not here yet*.
- **a domain** — the same list scoped to what that domain serves, the search
  box searching there. Nothing is managed on a domain; you find things to
  turn on. Turning on something only that domain offers takes its head
  through the activation gate — a refusal is shown in the row's words.
- **Update** — one act for every mark, because they are one signed root.

The origin is a domain like any other. Nothing is called "yours" but the list.

## Boot never moves the head

`ensure-install.ts`: a warm hive whose spot-check finds a missing atom now
**repairs the installed build in place** (`acquire(installedSig, zones)` — a
delta for the same signature) before it will ever wipe and take a cold head.
The old path took whichever host answered first, which re-versioned a warm
hive nobody had asked to move (observed: a reload swapped a followed build
for the bundled one).

## Ratchets

`sharing/packages-view.spec.ts`: element through the port, never a barrel
entry, never a runtime import; the notice and `/upgrade` open it; rows
ordered on-first; marks only where the layer moved; a domain lookup is the
same list scoped. `runtime/src/package-units.spec.ts`: the walk, the off set,
the bee filter, the change set.
