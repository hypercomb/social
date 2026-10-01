# @hypercomb/host

**A Hypercomb node.** Core, the signature fetcher, and the runner — nothing
else. `dist/` **is** the host: serve that directory and it is one.

```bash
npx @hypercomb/host serve                        # run it
npx @hypercomb/host deploy --project my-hive     # put it on Cloudflare Pages
npx @hypercomb/host check https://my-hive.pages.dev
```

In the monorepo the same commands are `npm run build:shim`, `npm run start:shim`
and `npm run host:check -- <url>`. The folder is still called `hypercomb-shim`,
because that is what it is: Phase 5 of
[everything-is-a-beehavior](../documentation/everything-is-a-beehavior.md),
stood up first so the lean shell could be grown into rather than arrived at.
The legacy platform and this host share [the primitive](../documentation/life-primitive.md):
signature-named bytes, typed meta, a stable hashed location, and a meaning
pool that discovers that location. Both implementations must follow its
publication and local on/off rules.

The published package serves a prebuilt origin. Its build scripts are for the
source checkout; an installed host does not need the monorepo or npm runtime
dependencies. It serves bytes that were signed elsewhere.

## Pure install

**A generic release names its own seed hosts.** Nothing in the minimal host
depends on GitHub or on any one domain: a fresh copy fetches what it does not
hold, by signature, from its own origin first and then from its seed hosts,
and replication (hosts, devices, a disk: `builds.mjs push`, `pull`,
`backup`) is the backup strategy. The seed hosts are one build setting,
baked into the kernel and the host bundle like the host package is:

```bash
node build.mjs --pure --hosts hive.example.org,mirror.example.net
HYPERCOMB_SEED_HOSTS=hive.example.org node build.mjs --pure   # the same
```

A build that names none seeds from `hypercomb.com` and `jwize.com`. The
operator tools read the same `HYPERCOMB_SEED_HOSTS` (and `HYPERCOMB_R2_BUCKET`,
`HYPERCOMB_R2_VIA` for `push --r2`). The welcome card's footer links are
defaults an operator replaces by staging their own.

`npm run build:pure` (or `npm run build:shim:pure` from `src/`) builds the cold
harness: core, the signature fetcher, the runner, and one pinned ESM host UI.
The root shows square creation tiles from the `host:offerings` meaning pool;
each member names a stable hashed host location. A reader takes the newest
marker from the serving host's location bag and checks the head against the
publisher's signed hive index. A missing or mismatched bag is refused. The
root leads with creation cards. The domain list stays inside the collapsed
**Sources** filter, where a visitor can show, remove, or visit a root domain.
When none are offered, two labelled open slots show where real cards will appear;
they are presentation only, and the first opens Sources.
Search matches creation names in the shown sources; typing a known domain also
reads that source on demand without opening a long directory. Click a domain name
there to visit its root portal with this hive as the return address. There,
**Turn on** selects site or text-theme creation tiles without running them;
**Return to my hive** carries only their signed references back and opens a
revision review list. A new head is marked on its creation tile; there is no
pagewide update check. The review can turn on one selected revision or all
available selections from that source. Each action rechecks the current signed
head and verifies its referenced closure before a local activation layer is
appended; a failed selection stays pending. Text themes install their signed
data layer through the same review step. The collapsed deployment details show
only routes actually on here and their known revision heads.
No `publications.json` catalog is read.

The pure build carries no application package, locale catalog, Pixi renderer,
or Angular. An empty `/content` and no `host:offerings` pool are valid.

**The install is a kernel and the processor.** Two small files run by
themselves; everything else is resolved.

- `main.js` is `src/kernel.ts`, a classic script. It knows two signatures,
  baked in by the build (no signature lives in source): the host bundle and
  the core library. For each it tries this device, then this origin, then the
  default hosts (hypercomb.com, jwize.com), refuses bytes that do not hash to
  the signature, and keeps what it verified: in OPFS, and in the service
  worker's `hypercomb-sig-v1` cache. That is the one hash: bytes are hashed
  once, when they first arrive, and a held copy never again. Warm boots
  import both from `/@sig/<sig>`, which the worker answers from that cache,
  so nothing is read before the host starts and the browser reuses its
  compiled code. A cached copy that fails to run is evicted and the boot
  reloads once from the device copy. The kernel then declares the page's
  one import map and runs the host. `/pin` still names the host bundle.
- **Offline.** The worker answers the page itself, the kernel, the processor,
  the theme and the host faces network-first and keeps each good answer
  (`hypercomb-shell-v1`); when the network fails, the kept copy answers. With
  the atoms in `hypercomb-sig-v1` and the packages in OPFS, an installed hive
  starts and renders with the network cut.
- `hypercomb-core.runtime.js` is the processor (`hypercomb-core/src/processor.ts`):
  `act()` and its optimize pass, bee/drone/queen/worker, IoC, the effect bus
  and signing. It is the core a host cannot run without.
- The core library (`hypercomb-core/src/library.ts`) is everything else core
  exports. It imports the processor as `@hypercomb/core/processor`, so there
  is one IoC and one bee lifecycle. The kernel maps `@hypercomb/core` to a
  two-line module that re-exports both, so packages and the host import one
  surface, unchanged. The full shells still ship core as one file.

- The host console is a beehavior. It is the one bee of the **host package**:
  a root layer and the bee it carries (`src/bootstrap/host-console.drone.ts`).
  The host is the root of wherever you stand, so its beehaviors sit on the
  root layer itself, not on a tile below it. The build bakes the host
  package's root signature into the host bundle; on boot the host holds that package
  (device, then this origin, then the default hosts, each file hashed once on
  arrival), runs its boot bees, and shows the console the bee registers. The
  host package is never "the installed package": it runs beside whatever a
  person installs. Its bee installs through the host's one installer, offered
  under `@hypercomb.social/HostAcquire`, so there is never a second one.
- **The app's landing spots** (`src/spots.ts`), on the living primitive
  ([life-primitive.md](../documentation/life-primitive.md)). The host root
  names its spots as cells, meta envelopes `{ meta: 1, layer: { name }, root }`.
  A spot's beehaviors are the members of the pool of meaning
  `<spot>:beehaviors`, each `{ meta: 1, layer: <behaviour>, relation:
  'beehavior' }`; a behaviour carries what it needs, its bee and its source
  as children (`{ name, bee: M(bee), children: [M(layer → { name: <path>,
  content: M(resource) })] }`), so the hive can be drilled from a spot down to
  the code (`@hypercomb.social/Spots`: `spots()`, `source(spot, behaviour)`).
  The first spot is `lineage`: the lineage, navigation and movement, three
  pure behaviours built from `hypercomb-shared/core`. Tile rendering reads
  the layer you stand in through them, so before this spot the pure host
  drew no tile at all. Spots resolve beside the package's dependencies and
  boot bees, and are held before the runtime starts; warm boots are
  unchanged (12 alternating: first frame 557 vs 554 ms, console 159 vs 150 ms).

  The second spot is `tiles`: what draws them, the Pixi host, show-cell and
  the background. The package already carries these, so the build names the
  package's own bees by class, read from the package as it describes itself
  (layer docs name each bee's class, each dependency's first line its
  specifier, esbuild's `// src/…` lines its source; a source edited since the
  package was built is refused). A behaviour here also names `dependencies`,
  the whole closure its bee reaches through the import map, and runs only
  when every one is live in the session; otherwise it waits and the package's
  flavour runs. **One flavour per class**: a spot's bee of a class the
  package also carries runs instead of the package's (ScriptPreloader's
  flavour rule), so no IoC key is registered twice. The same bytes are the
  same flavour, and a bee the installed package already runs stays in the
  package's render-critical lane, where it is fastest. Warm boots, 3 × 12
  alternating: first frame +16/−44/+17 ms, bees +8/−60/+33 ms (noise ≈ 40 ms).

**The porting gate.** Moving code from the Angular build here must not cost
performance. `node scripts/bench-minimal-host.mjs --pure <url> --web <url>
--root <sig>` (from `src/`) runs both hosts on the same package and fails when
the minimal host is worse. On 2026-09-26, package `dfdf6eca9eab`, warm boots:

| | minimal | Angular |
|---|---|---|
| first frame | 587 ms (4× CPU: 1594) | 1184 ms (4× CPU: 3349) |
| all bees loaded | 1377 ms | 2022 ms |
| boot blocking | 73 ms | 164 ms |
| drag frame p95, janky | 16.7 ms, 0% | 66.7 ms, 9.5% |
| JS heap | 37–85 MB | 59–126 MB |

Every change that could move loading or running adds a row to
[PERFORMANCE.md](PERFORMANCE.md), the running record.

`check-pure` fails if the kernel grows past 4 kB, the processor past 8 kB, a
signed file does not hash to its name, a signed file is neither known to the
kernel nor part of the host package, or the host bundle carries the console.

**Work is told as stories** (`host/builds.mjs`), kept in the
`sign('host:builds')` pool under `~/.hypercomb/` (override with
`HYPERCOMB_POOLS_DIR`). A story is a named layer of work with a description,
told within a larger story, so each layer holds its part of the bigger
picture: `{ name: 'story', label, description, within, at }`. A retelling is a
new record; the newest is the story.

A story's **revisions** are signed records
`{ name: 'build', label, version, parent, install, host, library, hostPackage, atoms, tree, conversations? }`.
`install` is a layer naming, by path and signature, every file of the origin;
`atoms` are its signed files. `tree` is its source as tiles
(`host/source-tree.mjs`): a tile per unit the build compiled (kernel,
processor, core library, host bundle, console bee, each spot), naming what
it produced, with the files that unit read beneath it, and under a spot its
beehaviors, which carry their own. All of it is kept in the pool, so any
revision can be written out, its source written back (`source`), and
published again, exactly. (Earlier revisions carry a flat `source` layer;
both are read.)

**A package revision carries its source as its tiles** too:
`{ name: 'build', label, version, parent, package, tree, atoms }`. The source
is never a side list of paths. `tree` is the package drawn on the living
primitive:

- a tile per folder, naming the cell layer the package runs there;
- under each tile, every bee as a beehavior (the spots' own shape: its bee,
  its dependencies) and every compiled dependency as an atom;
- under each of those, the files it was built from, with the spec that tests
  it.

Every file is placed exactly once, and a file record is the same record a
spot draws its code from. A source edited after the package was built is
refused, never kept as the code that runs. `atoms` are every file of the
package itself, so the pool alone can run it, write its source back out and
build it again: no forge, no checkout. `node build.mjs --pure` stages the
package beside the host build whenever the package is built.

```bash
node host/builds.mjs package                               # stage hypercomb-essentials as last built
node host/builds.mjs promote hypercomb-essentials
node host/builds.mjs source hypercomb-essentials ~/essentials   # its source, from the pool alone
node host/builds.mjs show hypercomb-essentials             # what changed, file by file
```

**Stage, then promote.** A build stages: it replaces its story's one staged
revision, local and unsigned, so work in progress never piles up in the
lineage. `promote` is the one act that appends: the stage becomes the
story's next version (year.month.day.n, UTC), chained to the last promoted
build, signed by its author when a key is at hand, and carried to every
subscribed host. What only a replaced stage named is collected; nothing
promoted is ever removed, and staged work never leaves the device. The
conversations that did the work ride with it: `attach` keeps a transcript in
the pool and the promotion names it (attached files are published). The
origin names its revision in `/build`, as `/pin` names the host bundle, and
`check-pure` fails unless the revision names exactly the files the origin
holds.

```bash
node build.mjs --pure --story offline               # stage the build in "offline"
node host/builds.mjs story offline "An installed hive starts offline" --within minimal-host
node host/builds.mjs attach offline ~/chat.jsonl    # the conversation behind it
node host/builds.mjs promote offline                # the next version, signed, synced
node host/builds.mjs                                # stories, their stage and revisions
node host/builds.mjs show 2026.9.27.1               # what it changed, who signed it
node host/builds.mjs publish 2026.9.27.1 -- --project my-hive   # any revision, again
```

**No change is lost.** `subscribe <dir|r2[:bucket]>` names a host that every
promotion reaches by itself (the jwize.com relay's content directory, the R2
bucket behind the worker). Each subscription remembers the head it last
received; the listing warns when one is behind, and `sync` carries what did
not arrive.

**The drill proves it.** The code lives only through replication, so a
follower must be able to stand in for the origin entirely. `node
host/drill.mjs` tests exactly that, end to end: an origin builds and
promotes (signed), a subscribed follower receives, the origin is wiped, and
a fresh device restores from the follower alone. It checks that the follower
holds everything the origin served, byte for byte; that the history pulls
verified; that the host restores and passes `check-pure`; that host and
package source restore byte-identical; that signatures travel and verify;
that unsigned work never reaches a follower; that a cold visitor to the
follower can discover the package; and that a restored copy can author the
next revision. It exits non-zero until every requirement holds — a failing
line is replication work still owed. `--keep` leaves its folders.

`publish` writes the revision into a temporary directory with the version
pools, runs `check-pure` on it and deploys that directory (`--azure` for Azure).

**Participants sign revisions** with the nostr key their hive already signs
with (secp256k1 Schnorr, the key `NostrSigner` holds), read from
`HYPERCOMB_SIGNER_KEY` or the file `HYPERCOMB_SIGNER_KEY_FILE`. A signature is a
kind-30567 nostr event over `hc:build:v1 / buildSig / version / role`, kept in
the `sign('host:build-signatures')` pool under the signature of its own bytes;
the record never carries its own signatures. An origin written out carries the
revision's signatures, and `check-pure` refuses one that does not verify.

```bash
node host/builds.mjs sign 2026.9.26.1 --as author     # or reviewer
node host/builds.mjs take /path/to/origin             # another participant's revision
node host/builds.mjs sign 2026.9.26.1 --as witness    # only after reproducing it
```

A witness signs only a revision they reproduced: a revision of their own, built
here, with the same install, atoms, host bundle, core library and host package.
`take` hashes every file once, as it arrives, and refuses an origin whose files
are not the ones its revision names.

**Publishing carries the atoms too.** A pure install whose origin lacks its
host bundle, core library or host package asks the default hosts for them at
`/<sig>` (hypercomb.com, content.hypercomb.com, jwize.com, content.jwize.com).
`push`, `push --r2` and the hypercomb.com deploy put every revision's atoms
there, flat, so a kernel baked by any build still finds its host in the wild.
An origin holding nothing but the kernel boots from them (measured with the
default hosts answered from a pushed directory: host bundle and core library
from hypercomb.com, the host package from jwize.com, then install and a warm
render with no failures).

**The pools are published to hosts** as any pool is: `/<sign(meaning)>/` lists
the members (names, one per line, never cached) and `/<sign(meaning)>/<sig>` is
one. Every member is signature-named, so a host cannot alter one unnoticed, and
nothing is ever removed.

- **hypercomb.com** (`npm run deploy:hypercomb.com`): `deploy-azure` carries
  both pools this machine holds into the staged site (`--no-version-pools`
  leaves them out), checks the stage, and uploads it.
- **jwize.com** (the machine relay): `node host/builds.mjs push` carries them
  into `hypercomb-relay/content`, which the relay serves at once. A relay lists
  a pool only when its operator declares it, so declare both once, in the
  hive: `hosts list host:builds @jwize.com` and
  `hosts list host:build-signatures @jwize.com`.

- **The subdomains** (`*.jwize.com`, `*.hypercomb.com`, content.jwize.com —
  the blossom worker over R2 `hypercomb-content`):
  `node host/builds.mjs push --r2` puts both pools into the bucket at
  `<pool>/<member>` with the operator's wrangler login, skipping what
  content.jwize.com already lists (`--dry-run` counts first). The worker
  serves a listed pool's members from there, so declare the pools for those
  zones too.

```bash
node host/builds.mjs push [host dir]    # default: hypercomb-relay/content
node host/builds.mjs push --r2          # the R2 bucket behind the worker
node host/builds.mjs pull               # jwize.com, hypercomb.com (or name hosts)
npm run host:check -- https://hypercomb.com    # reports the version pools
```

`pull` brings in every revision and signature the hosts hold, each file hashed
once as it arrives; a file that does not hash to its name is refused. A device
that pulls into an empty pool continues from the newest revision it took.

**The offline copy.** Only the minimal build lives on GitHub; everything
else is a versioned, signature-named file in these pools, so the pools are
the history and need a copy no host controls. `backup` mirrors every pool on
this device, promoted and staged work, stories, signatures and the
conversations, plus the local stage and subscriptions, into a folder on a disk
you own. Every file is verified against its name on the way out and back; a
second backup into the same folder copies only what is new. `restore` brings
it back and never overwrites newer local state. The signing key is never
copied.

```bash
node host/builds.mjs backup /media/you/hive-backup
node host/builds.mjs restore /media/you/hive-backup
```

The host bundle is always minified and carries no copy of core; the build
inlines the ioc install ahead of every script so core's module-scope
registrations find `window.ioc`. It ships only the faces the host renders
(Inter and upright Source Serif 4); icon and italic faces belong to the
packages that render them. On 2026-09-25: kernel 3.1 kB, processor 4.1 kB,
resolved by signature: host bundle 129 kB, core library 142 kB, host
package (console bee) 116 kB. A local
completion click verifies and holds the selected branch's typed child, executable, and
resource closure before adding an on/off layer at the local route. A selected
public text theme keeps the publisher's exact meta head in
the local `themes:text` pool and can be switched off with a later layer.
The optional [pure native profile](../hypercomb-client/MINIMAL-PROFILE.md)
uses the same native hive for the shim and route resolver. It accepts a remote
visitor's single or batch deep link as a pending selection only; a local click
performs the activation. A live installed native round trip remains to be
verified.
Updates remain candidates until clicked.

For a local proof of concept, build into a fresh temporary directory and seed
one verified public subdomain into that output's meaning pool:

```bash
HYPERCOMB_HOST_OUT_DIR=/tmp/hypercomb-host-proof npm run build:pure
node host/seed-offering.mjs /tmp/hypercomb-host-proof https://revolucion.jwize.com/
node host/serve.mjs /tmp/hypercomb-host-proof 4850
```

`seed-offering.mjs` reads the target's signed index and root before writing a
stable location member into the pool. It is a local proof tool for a static
build. The Cloudflare content worker projects its domain's active locations
from verified publisher hive indexes at the same pool address. A new root
keeps the location member's name; withdrawing the offering removes its tile
on the next read.

The package's `prepack` hook builds pure and refuses application content or a
renderer. Packing the npm host and building the
[desktop installer](../hypercomb-client/MINIMAL-PROFILE.md) run the same pure
builder. The desktop profile embeds that output in its window and bundles it
again as the host resource, so a hosted visitor sees the same shell.
The existing `npm run build` remains the content-bearing host build for
development and deployments that intentionally publish a package.
`hypercomb-host serve` serves the packaged static directory. A live machine
hive is served by the native `hypercomb-serve` component used by the desktop
app; the browser's OPFS is not the Node server's hive.

## What it is

`hypercomb-web/src/main.ts` already *is* this boot. Every step here is the same
call in the same order; the difference is the last line — that one ends in
`bootstrapApplication()`, this one ends in `mountSurfaces()`. The boot sequence
did not have to be invented, only unfused from Angular.

```
ioc.web  →  packed-store gate  →  SW control  →  import map
         →  verified ESM host UI  →  DependencyLoader  →  initializeRuntime
         →  mountSurfaces  →  first pulse
```

No Angular, no Vite, no `ng` builder — one `esbuild` call. If the boot needs a
framework to build, it is not a shim. The build **fails loudly** if
`@angular/*` ever reaches the bundle, because that is not a size problem: the
directives use standard field decorators, and without the Angular AOT compiler
they throw `"not supported in JIT mode"` at module evaluation. A framework
import here does not bloat the shim, it stops it booting.

The runtime it needs is `@hypercomb/runtime`; application content stays on
hosts and is reached by signature.

## The three pieces

| | where | what |
|---|---|---|
| **core** | `public/core/dist/` + `public/hypercomb-core.runtime.js` | the runtime ABI. `@hypercomb/core` resolves here (the pure build ships the processor here and resolves the library by signature). |
| **fetcher** | `src/replicate.ts` + `public/hypercomb.worker.js` | acquisition by signature, and the service worker that resolves `/@resource/<sig>` and `/opfs/<pool>/<sig>` out of the flat root. |
| **runner** | `src/main.ts` + `src/surfaces.ts` | boots, pulses the processor, mounts whatever registered. |

Everything else in `dist/` is content: `content/<sig>`, flat and sig-named,
copied from `hypercomb-essentials/dist` — the module build that mints it.

## The shim knows exactly one signature

Acquisition is not part of the shell. It is built separately, hashed, written
to the origin under its own signature, and named by `/pin` — and the shim
fetches it the same way it fetches everything else: by signature, verified
before it runs.

```
/pin  →  OPFS <sig>  (or <origin>/<sig>, written back)
      →  VERIFY the bytes hash to the pin
      →  import  →  boot()
```

That resolves the chicken-and-egg (acquisition cannot come from OPFS when OPFS
is empty) with one address rather than a privileged code path, and it makes the
installer forkable: **updating the bootstrap is repinning one signature.**

The verify runs on the OPFS path too, not only the network one. OPFS is
origin-private so local tampering is out of the threat model — but "the file
named `<sig>` does not hash to `<sig>`" is also what a truncated write or an
interrupted eviction looks like, and running those is worse than refetching.

The shim keeps exactly three things: **service-worker control**, the
**packed-store one-way-door gate**, and the **pinned-sig fetch path**.
Everything else it does is runtime — ioc, the store, the module graph, the
processor pulse — which cannot be content, because it is what content runs on.

`src/bootstrap/` is compiled into that bundle and is NOT part of `main.js`.
It may import only `window.ioc` and `@hypercomb/core` (external, resolved
through the import map). Nothing stateful from shared may be bundled in: a
second `Store` module would run a second
`register('@hypercomb.social/Store', new Store())` over the same OPFS. **The
build fails if `shared/core/store.ts` reaches the bundle.** The two pure
modules it does carry — the replication walker and the sealed-package
validator — are stateless functions over bytes, which is why duplicating them
is safe.

## Install is cache-warming, not a precondition

The service worker's module route gains a network fallback: OPFS miss →
`<origin>/<sig>` (then known hosts) → **sha256-verify against the requested
signature** → write into the pool → serve. A heap with a hole in it repairs
that hole when something asks for it, instead of failing the import.

The verification is what makes the fallback admissible: it is the same
admission boundary replication uses, so a forged host, a poisoned CDN, or an
SPA-fallback page can only ever cost a 404.

> This copy of `hypercomb.worker.js` is deliberately **diverged** from
> `hypercomb-web/public/hypercomb.worker.js`, which stays frozen for the live
> deploy. Do not resync them — the shim is the survivor.

## Root portal and diagnostic console

The root portal reads `sign('host:offerings')` from this host and domains the
participant has added. Site tiles represent a publisher and hive path; a
selected text theme is also a creation tile at its own location. A site's
routes open its implementation. A local tile can expose its signed root and
link back to the offering host; new activation goes through the host's tile
switch and the local domain update icon.
The transport inventory remains in `host:packages`; labels such as
`essentials` do not become visitor tiles. See
[everything-is-a-beehavior.md](../documentation/everything-is-a-beehavior.md).

The collapsed details show active local deployment tiles and known revisions;
raw package publication history is not visitor UI. The card remains reachable at `/hosts` after
imported views take over. The in-hive command line, like every other view,
arrives as a beehavior; `host/` scripts are device setup tools.

```
add a domain  →  visit its root  →  turn on tiles there  →  return with references
              →  domain update icon  →  inspect signed head and closure
              →  verify selected bytes  →  append local on/off layer
```

`src/hosts.ts` is the domains — the same `community:hosts` pool essentials
writes, shared by ADDRESS (`sign('community:hosts')`) and never by import,
because essentials is the thing being acquired. A host added in the full app is
already there when the shim boots cold.

`src/replicate.ts` is the acquisition, and it is deliberately thin: the walk
itself is `resolveInventory` from shared, which is kind-blind by design. Only
the io wiring — which pool, which suffix, which URL — lives here.

Install is the same call as update and as repair. Present atoms are reused, so
a second run of a complete install fetches nothing (`Held 226 atoms
(0 fetched)`), and a partial one repairs its delta rather than starting over.

**A host must serve its content cross-origin.** `Access-Control-Allow-Origin: *`
is in `public/_headers` and `--cors` is on the local server, because a host
exists to be pulled FROM. Without it every cross-origin replication dies as an
opaque `Failed to fetch` and the host looks exactly like one that publishes
nothing. `*` is correct rather than lax: every byte is public, immutable,
content-addressed and verified by the reader, so there is no request whose
origin changes the answer.

**Not yet signed.** The manifest a domain serves carries no publisher
signature. Every atom is verified, so a hostile host cannot serve wrong bytes —
but it can offer a different tree and call it current. Binding "current" to a
publisher identity is the signed sentinel, and it is the next chip. Until then,
adding a domain is exactly as much trust as visiting one.

## Standalone

The shim reads **nothing** from `hypercomb-web`. Its static root is its own
`public/`; its content comes from the essentials build directly; it carries its
own copy of the import-map resolver (`src/import-map.ts`, short-lived — Phase 4
deletes it). `build.mjs` prints `✓ standalone` when no `hypercomb-web` module
reaches the bundle, next to the `✓ framework-free` check.

Two pieces of `public/` are generated and gitignored — `core/dist` and
`vendor/pixi.runtime.js`, both from `scripts/build-vendor.mjs` (`npm run
build:vendor`). Run it after a `build:core` or a pixi bump.

```bash
node build.mjs                 # minimal — core + fetcher + runner + content
node build.mjs --no-content    # cold host; boots to 0 surfaces, correct
node build.mjs --assets        # + shared-public substrate art (~47 MB)
node build.mjs --minify        # production bytes
```

## What it deliberately does not carry

- **The install MACHINE.** No sentinel resync, no drift enforcement, no
  bundled-package upgrade path, no cold-install welcome flow. The bootstrap
  bundle carries the replication PROTOCOL, not a second copy of
  `ensure-install`. See
  [install-by-replication.md](../documentation/install-by-replication.md).
- **Sig-stamped module imports.** Bee bundles still import their dependencies
  by ALIAS, which is the only reason the import map still exists — so
  `src/import-map.ts` and `dependency-loader` cannot retire yet. Stamping dep
  signatures into the specifiers at build time is a change to
  `hypercomb-essentials/scripts/build-module.ts` that recomputes every bee
  signature (a merkle cascade — plan doc, hard knot 7) and therefore
  invalidates deployed content. It is a deploy decision, not a code one.
- **The visitor path**, upgrade orchestration, drift enforcement.
- **The reload-once import-map dance.** A shim that reloads itself is much
  harder to reason about while it is being built. `index.html`'s synchronous
  replay covers the second boot onward; Phase 4 retires the map entirely.

## The scoreboard

Every boot prints:

```
[shim] surfaces — 1 element-shaped mounted · 47 barrel entries still Angular-shaped, unreachable from the shim
```

The second number is the one that measures Phase 2/3, and it **cannot be
observed at runtime**. Shared's Angular panels register themselves by being
imported from `shell-surfaces.barrel.ts`, and the shim never imports that
barrel — so the count of Angular-shaped registrations that actually reach the
registry is always 0 here. Reporting *that* read as "migration complete" when
it meant "none reached me".

So `build.mjs` counts the barrel's entries at build time and injects the
number. It tracks the barrel as it shrinks and can never quietly disagree with
it; when the barrel is empty the line says so instead of printing a zero that
means nothing. `window.__hcSurfaces()` returns the same live.

Nothing loads Angular here — not statically, not dynamically, and it could not:
the directives use standard field decorators, so without the AOT compiler they
throw `"not supported in JIT mode"` at module evaluation. The behaviours do not
need it either — `@angular` appears in **0 files** across `hypercomb-essentials`.
The 47 are components in `hypercomb-shared/ui` that have not become drones yet.

## Deploy safety

`build.mjs` writes only into `hypercomb-shim/dist`. The shim is not under
`hypercomb-web/src` (so `ng build` cannot type-check it), not under
`hypercomb-web/public` (so it cannot enter the deploy artifact), and named by
no `angular.json` configuration or GitHub workflow.

The live artifact is still `hypercomb-web/dist/hypercomb-web/browser`, built by
a push to `main`. Nothing here can reach it.

Phase 5 of [everything-is-a-beehavior](../documentation/everything-is-a-beehavior.md),
stood up **first** so the lean shell can be grown into rather than arrived at.
