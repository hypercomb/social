# Beehaviors and packages — what runs, and what it offers

*2026-11-14. Proposal; point 4 (the way back) built the same day. jwize:
"describe the differences between the beehaviors that show up in the
beehaviors panel vs the hosts packages of code and can we make good sense of
the separation?" And, reading it: "so basically you don't update behaviors you
update packages and the behaviors reflect."*

There are two windows with an on/off switch on every row, and from the outside
they look like two switches for the same thing. They are not. This document
names what each one switches, says where the two meet, and proposes the few
pieces that would make the meeting readable. It changes neither window's
model.

## One sentence

**A package is code you hold and run. A beehavior is something that code
offers you, and where it acts.**

The hosts desk is about supply: which bytes are here, which revision runs at
each path, what the publisher you follow has moved. The Beehaviors window is
about meaning: which of the things the running code can do are lit, and which
tiles wear them. A package is like an installed package, and a beehavior is
like one feature of the app it installed, with a setting attached.

**You never update a beehavior. You update packages, and the beehaviors
reflect.** A beehavior has no version of its own: the Beehaviors list is read
from what the code that runs now registers, so a revision, a pick or *Update
all* on the hosts desk is the only way a beehavior changes. A light says
whether you want what the code offers, never which code. The one revision on
the Beehaviors side, the website revision stamped on a decoration, is a
revision of your content, not of code.

## The two windows, side by side

| | Packages (hosts desk) | Beehaviors |
|---|---|---|
| **The unit** | A layer of the served tree at any depth: `games`, `games/arkanoid`. Its name path is its identity, its layer signature is its version ([packages-window.md](packages-window.md)). | A view bee's decoration kind, a capability, a game, a command-line word, or a kind with a record and no module ("foreign"). Built in `show-features.drone.ts` `#emitRoster`. |
| **Where the list comes from** | The root you installed, walked by `walkTree` (`hypercomb-runtime/src/package-tree.ts`), with picks laid over it. | What the loaded code registered: `VisualBeeRegistry`, `CAPABILITIES`, `gameCensus()`, `SlashBehaviourDrone.wordCensus()`, plus leftover records. |
| **What off means** | The bees under that path are not loaded, or are disposed (`recompose()`), and often a restart is needed. Bytes stay held. | The code stays loaded. The door refuses it, autocomplete and the palette leave it out, its desk closes, its buttons leave, the swarm withholds it ([behaviors-view-simplification.md](behaviors-view-simplification.md)). |
| **Record** | `hc:install:off-units`, `hc:install:picks` | `behavior-enablement` on/off lists, `word:<word>` kinds |
| **Cost of a switch** | About 5–9 s on a 45-package trunk, or a restart | Instant |
| **Scope** | This origin's install, by path | Everywhere (one light), and Here (the decorations a tile wears) |
| **Versions** | Revisions per path, picks, Update all | The revision stamped on each decoration; no code versions |
| **How it travels** | By replication, from a host; *Save as a package* mints a new root | Lights and decorations travel with tiles; words travel with nothing |

## They do not map one to one

- **One package, many beehaviors.** `commands` brings dozens of words and
  several views. `games` brings every game row.
- **One beehavior, many packages.** A website needs `presentation/tiles`,
  `website` and `sharing`. That is the atomic direction: one behaviour, many
  dependencies.
- **Packages follow the source tree.** A package is a folder of
  `hypercomb-essentials/src`, so the finest thing the hosts desk can turn off is
  a folder. A beehavior follows what a participant does. The two cut the same
  code along different lines, and neither cut is wrong.

So the right relation is a derived join, never a parent: a beehavior is
*brought by* one or more package paths, and a package *brings* a set of
beehaviors. Neither holds the other.

## Where it stops making sense today

1. **Neither window knows the other exists.** A beehavior row names its module
   only when it is a word from outside our build. A package row lists bees by
   signature, never what they offer. Nothing in either window points across.
2. **A package off looks like something broke.** Turning `games` off in hosts
   leaves each game's light record behind with no code under it, so the row
   comes back in Beehaviors as *foreign* (`deployed_code_alert`, "waiting on its
   module"). A word simply vanishes, because a word record with no word is
   skipped. Neither says *you turned this package off*.
3. **The way back is protected on one side only.** Six words cannot go dark in
   Beehaviors: `beehaviors`, `behavior`, `help`, `create`, `undo`, `redo`
   (`ALWAYS_LIT_WORDS`, `commands/word-enablement.ts`). The hosts desk's
   `#toggle` (`sharing/host-directory.view.ts`) has no such rule, so switching
   off the package that carries them removes the window that would turn it
   back on. The same holds for `hosts` itself: the desk's own package can be
   switched off from the desk. (Read from the code, not tried live. Closed
   2026-11-14, point 4.)
4. **Saving a package ignores the lights.** *Save as a package* folds in
   off-units and picks only. Turning a word dark makes your hive quieter but
   never makes the package you share smaller. That is probably right, but no
   rule says so, so it reads as an oversight.

## Proposal

### 1. The join, derived

Each package path names the bees its own layer declares (`PackageNode.bees`).
The preloader already keeps what each bee's module registered beside it (its
*company*, `script-preloader.ts`). Join the two and every beehavior row can be
answered: *which package paths brought you?*

- **What is owed:** the visual-bee registry, the capability list, the game
  census and the word census each record which module run added an entry, so
  an entry can be traced to a bee signature. A hand-written provider or an
  entry nobody can trace says *built in*.
- **Never stored.** The join is read from the activation record and the
  registry every time. No pool, no index, no record to keep in agreement.

### 2. Each window shows the other's side, read-only

- **A Beehaviors row** says the package it came from (`from commands`), in
  the same place a foreign row names its module. A press opens the hosts desk
  at that path.
- **A package row** on the hosts desk lists what it brings, in words: *brings
  mail, the mail desk, 1 view*. A press opens Beehaviors / Everywhere searching
  for it.
- Neither window gets the other's switch. Two places to flip one thing is the
  confusion this document is meant to remove.

### 3. Name the cause

A kind or word whose package is off says so: **package off — `games`**, with
the press to the hosts desk, instead of reading as foreign. *Foreign* stays for
what it means: a record whose code no package here has ever named.

### 4. The way back is a package rule too — BUILT 2026-11-14

A package path that carries a bee bringing one of `ALWAYS_LIT_WORDS`, or the
`hosts` word, cannot be switched off whole. Its row says *carries the way back*
and does not switch, the way an always-on beehavior row does. A leaf beneath it
that does not carry one switches as before.

How it is built:

- **The words** are `PACKAGE_WAY_BACK_WORDS` in `commands/word-enablement.ts`,
  made from `ALWAYS_LIT_WORDS` plus `hosts`, beside the switch. No second list.
- **No join was needed for this.** Each layer's signed `docs.bees` already names
  every bee's `command` and `aliases` (the build writes them). `wayBackBeneath`
  (`sharing/host-directory.view.ts`) reads the docs of the path's own layer and
  of every layer beneath it, since a path switched off takes everything under it.
- **Both doors ask it**: `#switchable` (the bulb and the menu's first item,
  with the reason *{name} carries the way back (…), so it stays on*), and
  `#toggle` itself. A layer whose docs are not read yet keeps the row from
  switching (*Reading what {name} carries…*) until they arrive, which is a
  few milliseconds for a held layer.
- Turning a package **on** is never refused.
- Spec: `sharing/host-way-back.spec.ts`. Strings: `hosts.way-back`,
  `hosts.way-back-reading` (English and Japanese, the desk's two catalogs).

What the guard does not see, honestly:

- **A word that is not a queen's.** `help` is a provider inside
  `SlashBehaviourDrone`, and `redo` shares `undo.queen.ts` with undo, so the
  docs name neither. Both sit in packages the guard already keeps on
  (`commands` and `history`), so they are covered by being there, not by
  name. A build that moved them would leave them unguarded.
- **What a way-back queen reaches by an effect.** `/beehaviors` opens the
  window through `features:roster-open`, and the drone that builds the list
  (`ShowFeaturesDrone`) lives in `presentation/tiles`. That package can still
  be switched off, though doing so takes the tiles' own rendering with it.
- **A layer with no docs** (an older package) names no words, so it is not
  guarded. A layer that could not be read at all counts as read and empty.

Verified live 2026-11-14 on a web shell running a fresh build of this change
(root `94f5ed03…`, taken from its own origin, in a throwaway worktree): of 46
top-level packages, exactly three refused, each saying why: `commands`
(beehaviors, behavior, create), `history` (undo) and `sharing` (hosts). A press
on the `commands` bulb left `hc:install:off-units` empty. `didyouknow` still
went off (through a restart), came back off, and turned on again.

### 5. The rule, written down

- **Lights are personal meaning and travel with tiles. Packages are supply and
  travel by replication.**
- **Saving a package never reads lights.** To leave code out of a package,
  switch its path off on the hosts desk. A dark word stays in the package
  because another hive may want it lit.
- **Off on the hosts desk is stronger than dark.** It takes the code away; dark
  keeps the code and refuses it. When both apply, the row says the stronger one.

Once built, these go into `doctrine.codex` as rules. Until then this document
is the argument and the codex is unchanged.

## Not proposed

- **Merging the two windows.** The switches really differ in cost, scope and
  how they travel. One window would have to hide that difference, and a light
  that sometimes restarts the hive is worse than two clear windows.
- **One package per beehavior.** Packages getting finer is welcome and makes
  the join tighter, but a beehavior with many dependencies will always span
  several paths. The join is the answer, not reshaping the tree around it.

## Open for jwize

1. Should a participant ever see packages at all, or is the hosts desk only
   for publishers composing a root? If only publishers, the press from a
   Beehaviors row to hosts could hide on a reader's hive.
2. A dark word stays in a saved package (rule 5). Should *Save as a package*
   at least offer to leave out the paths whose every beehavior is dark?
3. Point 4 makes `commands` unswitchable as a whole. Is that acceptable, or
   should the way back move into its own small package so `commands` can go?

## Order of work

1. ~~The way back on the hosts desk (point 4).~~ Built 2026-11-14.
2. The registry and censuses record their module run (the join).
3. *Package off* in place of *foreign* (point 3).
4. The cross-window lines (point 2).
5. The rules into the codex.
