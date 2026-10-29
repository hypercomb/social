# Build and debug isolation — package management, one package at a time

**Status: decided 2026-10-29. The point is package management, and an AI upgrade is one of those packages. The mint, the one-label mission door, the on-demand AI frame, and the same-device public face are built in the local shim and were shown the same day against the live jwize.com essentials root. A nested depth is decided and not built. The host page is local. The root minted that day was not published, and it did not move what runs.**

jwize, 2026-10-29: "The whole point here is package management (including ai upgrades)."

The same day: "This really separates the developer experience to a single focus and task. I also think we break it down to multiple depths of subdomains so each party can work in isolation and our interfaces are only our traits. This build and debug isolation must be documented. This allows incredible parallel programming possibilities and is now critical to the platform."

Isolation is how that package work stays one task. The hive chat organizes tiles. A package is composed on the host's file view and tried on a subdomain, and that subdomain is the testing and the debugger.

## The package

A package is a branch at any depth. Its path is its name and its layer signature is its version ([packages-window.md](packages-window.md)). Managing it, on the host card, is the whole act:

1. Open any signature and read the branch as folders. Each reminted file carries `{ path, sig }`, so the folders rebuild from the history.
2. See the files this install loads. Turn a folder or a file off. The bytes stay held.
3. Lay another host's version beside it and choose that signature for one folder.
4. Write a trait on a folder: the open requirement that package still has.
5. Mint. A changed identifier rewrites that layer and every ancestor. Untouched folders keep their signatures. The new root is the new package.
6. Pack the new layers. Try that root on the mission door.

When the bytes are already held, pointing what runs at a revision you already have is a head move ([packages-window.md](packages-window.md): upgrading is instant once the files are here). Composing a new set is the other half. The composition has new identifiers, so the merkle tree changes, and the head that later names it names the new root.

Opening, pruning, choosing, writing a trait, and packing leave the running trunk where it is. What runs here changes when a person takes the package through the host directory's pick, or a publisher moves the channel ([module-sandbox.md](module-sandbox.md), [publishing.md](publishing.md)).

## An AI upgrade is that package

The AI module is a package in the tree. On the live essentials root that package is the `assistant` folder. Upgrading it is the same six steps: a new signature at that path, every ancestor rewritten, the rest of the tree untouched, then a trial on the mission door.

The AI stays dormant until the mission loads it. Once that subdomain is added, later opens load the AI harness from the door on demand, and they keep loading it from there. The harness is the signed loop ([agent-harness.md](agent-harness.md)). It runs at `try-<mission>.<zone>`, and a save lands in that origin's store. The door is where the upgraded package is tried. The reader's hive takes it only by the same pick any other package uses.

The 2026-10-29 probe wrote the trait `soundtrack` on `assistant` and left that folder's signature in place. That was a requirement on the AI package. An upgrade is the case where the `assistant` signature itself changes.

## Visitors

jwize, 2026-10-29: "we need the shared resource heap and a compiled minified runtime version that plugs early into the pipeline for normal (non debugging) requests. This way we can get max performance for our visitors."

A normal request is a published door. Its first module is a compiled runtime: core, bundled and minified, named by the hash of those bytes, a member of the shared content heap at `/content/<sig>`. The visitor page writes that mapping before the readable import map, so the minified module is the one the shell and the bees share. The heap is the sig-named content root. A resource another page names by signature is the same member, on every door of the deploy.

A debug request keeps the readable runtime, `/hypercomb-core.runtime.js`. `hc:verbose` is that request on a published door. A `try-` door is the readable shell, and it does not serve this page. A build with `VISITOR_MINIFY=0`, or a build that could not stamp the pin, keeps the readable runtime too.

The visitor package was already a minified derivation (`prepare-visitor-assets.mjs`). The early runtime is the core that derivation runs against, plugged at the start of the page rather than after the shell has loaded the readable file.

A folder on the host file view can be minified on its own. The transpiler is the program in `hypercomb-core/src/core/minify-transpiler.ts`, and the derivation names that program by its signature. The record is a member of `derived:<that layer>`. The dialect record is a member of `derivation:dialects`. Ancestors of the folder stay as they were until a mint chooses the minified signature, which rewrites the layers above it. The pack from that view is the minified bytes. A published head moves when a publisher names the new root. This page does not move one.

## The harness asks a word

jwize, 2026-10-29: "So the subdomains, if added, on demand load the AI harness from then on. We don't need to explore the hive in the way you think we need to do our cross server, also cross available builds, for lookup. Basically the AI will think, oh I need to find something about this word, and it'll get returned all sorts of information across servers. Maybe meta at first, and then it can decide, hey do I need some code from this domain, puts a code task, and it can explore and give you back a recommendation for your AI harness to move forward."

Lookup is that word, asked of the servers the participant follows and of the builds those servers hold. The first answer is meta: the path, the description, the signature, which host, which build, and an honest absence where a server has nothing for the word. `searchVocabulary` already asks a molecule address of every publisher in its horizon and keeps an unknown distinct from an absence (`hypercomb-essentials/src/molecule/vocabulary-search.ts`). A layer's `docs.description` and a host's package listing are the meta a build already carries. The harness does not ask them yet.

The page-and-link walk in [agent-harness.md](agent-harness.md) stays its own act. Finding a package across servers is the word.

jwize, 2026-10-29: "This is perfect because it segregates itself into its own subdomain. However it's OK to conventionally look up other slices of data, the skewer, through every word in every shared domain, or filtered to specialty groups of domains."

## The skewer

The mission stays on its door. A skewer is a conventional lookup the harness on that door may make. It is one slice of data, run through every word, across a horizon of domains. Two horizons are enough:

- **Every shared domain.** A shared domain is one that publishes its vocabulary. The default skewer asks all of them the participant can reach.
- **A specialty group.** The same skewer with the horizon cut to a group of domains the reader already holds. The group is a filter on that read. It is not a new store and not a new door.

A slice is one kind of meta. The membership slice is the one `searchVocabulary` already returns for a single word: declared, absent, or unknown, one row per publisher, the row kept when the host does not answer. A publisher's vocabulary body is already the list of every word-address that claim shares (`documentation/vocabulary-claim.md`). Those addresses carry no display spelling. The package slice is the other kind a build already carries: the folder path, `docs.description`, the layer signature, which host, which build. Folder names come from the signed layer, so that slice may show them.

The row set is fixed before the read, the same way the one-word search fixes its horizon. A domain that does not answer stays unknown. An empty slice is never read as "nobody has it."

The skewer does not open code, does not mint, and does not write the door's store. When a row names a domain the harness still wants code from, that is the code task below. The package on the door takes a signature when a person chooses it.

When that meta names a domain, the harness puts a code task. The task is one package on one door. It reads the code that domain holds for the word and comes back with a recommendation: which signature to lay beside the open package, which folder to choose. The harness moves forward on that recommendation. Taking the signature into what runs stays the person's pick.

## One package in front of you

One package is open, and it has one origin. The origin is a door on a host the participant already uses: `try-<mission>.<zone>`.

## A depth is another door

Each party manages one depth of the package. A depth is a door under the mission's door, and that door is its own origin. Its store is the browser's origin-private file system for that origin. On the host, storage stays the flat signature files and the pools of meaning in [swarm-pools.md](swarm-pools.md): a subdomain resolves to a package and a pool. It does not become a folder of someone else's work.

A party keeps three things on their door: their source, their saves, and their hive. What leaves the door is a trait, and later the signature of a filler that answers that trait.

**The certificate covers one label.** A free wildcard is `*.<zone>`. The door predicate (`isSandboxLabel` / `sandboxDoorOf` in `hypercomb-core/src/core/sandbox-door.ts`) accepts one DNS label: `try-` plus 1–57 characters, alphanumeric at both ends. [module-sandbox.md](module-sandbox.md) records the 2026-09-22 decision that a sandbox and a site share that one label space, so a nested label is refused. This page leaves that predicate as the one rule. There is no second regex.

A name with two labels, `try-<party>.try-<mission>.<zone>`, waits until the parent door carries its own wildcard. Until that certificate exists, a party still works alone on another one-label door of the same zone: `try-<mission>-<party>.<zone>`. The label rule already accepts the hyphens. That name is one origin, with its own store, on a door the platform can open today.

## The interface is a trait

A trait is one word, written on a folder. It speaks an open requirement: a place where help or a contribution is wanted. The word is the interface between parties.

[traits.md](traits.md) holds the earlier line, from 2026-10-07: a trait is not a subdomain, and a route is never an address. That line stands. The question that day was whether a trait needed its own subdomain. It does not. Publishing a filler is naming a tile and publishing it from the contributor's own domain. The signature is what travels.

The question on 2026-10-29 is the workplace. The door is where a party works. The trait is the word they answer. The door's name is not the trait, and the trait is not where the work is stored. The word and a filler signature are what cross.

On a minted root the traits sit in the root layer's `edits`, each `{ path, word }`. The word is one path segment. The public face of the build is the list of file signatures the new root still names. Broadcasting that list uses `BroadcastChannel` `hc:public-face`, message `{ face: string[] }`, on this device. Telling participants across the network — a host publish, a pheromone, an ask — is still open.

## Parallel work is one mint

Parties work on the same trunk at the same time because a folder nobody touches keeps its signature. Bringing the work together is a choice: for each folder, one signature. The mint then rewrites every ancestor of a changed folder. A new identifier is a new layer, and every layer that names it is new too. Untouched siblings stay the bytes they were. The same choices on the same trunk are the same root.

The new layer bytes carry each file as `{ path, sig }`, so a later reader rebuilds the folders from the history. Slots the mint does not rewrite — `criticalBees`, `bootBees`, the rest of `docs`, any other key — are copied, and a file that was turned off is scrubbed out of them.

A choice names a folder already in the tree and a signature, and it keeps that signature's own bytes. An incomplete branch, a trait that is not one word, or a choice that is not a folder in the tree does not mint.

The local build is a gzip transfer pack of those new layer bytes only (`packMint`). Bees that stayed are the verified files already held. The pack is a download. Running that build is the mission door serving that root. Installing and starting it stay with that door and with the publisher's gate.

**Shown on 2026-10-29** against the live essentials root on jwize.com, `5fcf250d4036862a203816008ade52e4cb56c317adbab20e1a55bcdaa6a30e70` (package pool head `00000390`, label `essentials`). The walk was complete: 69 folders, 1094 files. Turning the `contact` folder off and writing the trait `soundtrack` on `assistant` rewrote only the root. `assistant` stayed `f7c504ab7fccf3de91bbe735232b5e1825d9fb8f695225de39ec99517dd44164`. The new root `8c427b015b4562cd7e1b78e24b57c3023f5bd800288dbb9873220ee829f68f99` kept 703 dependencies, 3 critical bees, and 6 boot bees, and its face listed 1090 signatures. That root was a probe. It was not published. The host page that does this lives in the local shim. jwize.com serves it once that shim is deployed.

## Where it lives

| Piece | Where |
|---|---|
| The mint, the mission origin, the AI frame, the face | `hypercomb-shim/src/bootstrap/branch-files.ts` |
| The folders, the checkboxes, the trait word, the choice, the pack | `hypercomb-shim/src/bootstrap/branch-view.ts`, opened from the host card |
| The one door predicate | `hypercomb-core/src/core/sandbox-door.ts` |
| What already runs: the trunk, picks, on and off | [packages-window.md](packages-window.md) |
| The trial door on the same label rule | [module-sandbox.md](module-sandbox.md) |
| A trait, and why the word is not itself a door | [traits.md](traits.md) |
| A word asked of hosts, with honest absence | `hypercomb-essentials/src/molecule/vocabulary-search.ts` |
| The harness a door loads | [agent-harness.md](agent-harness.md) |
| The early runtime a normal request runs | `hypercomb-runtime/src/early-runtime.ts`, stamped by `hypercomb-web/scripts/prepare-visitor-assets.mjs` |
| A layer minified on its own, and the transpiler that does it | `hypercomb-core/src/core/derivation.ts`, `hypercomb-core/src/core/minify-transpiler.ts`, the host file view |
| A door resolves; storage stays flat | [swarm-pools.md](swarm-pools.md) |

## Ledger

| | Status |
|---|---|
| The point is package management. An AI upgrade is a new signature for that package, tried on the mission door. | Decided 2026-10-29. The mint composes the package. What runs here still changes through the host directory's pick. |
| One package, one origin. The hive chat organizes tiles. A mission is where the package is tried. | Decided 2026-10-29. One door is what `missionOrigin` opens. |
| Mint: a turned-off file, a trait, or a chosen folder rewrites that layer and every ancestor. Untouched folders keep their signatures. | Built in the local shim. Shown on the live jwize essentials root, 2026-10-29. The page is not deployed. The root was not published. |
| A trait is the only interface between parties. | Decided. The word is stored on the minted root. A network notice to participants is open. |
| Door `try-<mission>.<zone>`. Once added, the door loads the AI harness on demand from then on, and a save lands in that origin's store. | The origin and the frame are built locally. The frame stays empty until Load AI, and it does not yet fetch the signed harness. The mission page that would write that store is not deployed. |
| A normal request runs a minified runtime from the shared content heap, before the readable map. A debug request keeps the readable runtime. | The page slot and the visitor-build stamp are in place. A published door serves them once that build is deployed. `hc:verbose` and a `try-` door stay on the readable runtime. |
| A folder can be minified on its own. The record is a member of `derived:<that layer>`. The transpiler's signature is the tool. | Built locally. The host file view does it. It does not move a published head. The esbuild visitor package still records its derivation on the root and does not write the pool. |
| Lookup is a word across servers and across the builds they hold. Meta first. A code task on one domain returns a recommendation to the harness. | Decided 2026-10-29. `searchVocabulary` asks the word. The harness does not call it yet, and the code task is not built. The recommendation does not install. |
| A skewer is one slice through every word. The horizon is every shared domain, or a specialty group of them. The mission stays on its own subdomain. | Decided 2026-10-29. One word against a horizon is built. The every-word slice, the package slice across that list, and the specialty-group filter are not built. Unknown stays a row. The slice does not install. |
| A party door while certificates are one label deep: `try-<mission>-<party>.<zone>`. | The label rule already accepts it. |
| A depth under a depth: `try-<party>.try-<mission>.<zone>`. | Decided. Not built. It waits on the parent door's own wildcard. |
| Public face `hc:public-face`. | Built locally. Same device. |
| Local pack of the new layers. | Built locally, as a download. Running it is the mission door serving that root. |
