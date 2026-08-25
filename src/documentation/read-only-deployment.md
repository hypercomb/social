# Read-only deployment — creations as published websites

*(design — planned, not built; decided 2026-08-24)*

**This is the canonical way to publish a hive** — how a participant shares
their digital content with consumers. Publish a creation as a **read-only
deployment**: a website on its own domain, running the real runtime and the
creation's beehaviors, that a visitor uses with **zero install**. Nothing
inside that installation is updatable — the installation IS the deployment.
Updating it means republishing to the server; the next page load has the new
head. Consumers can post information back to the publisher — but only what
they choose to, only when they decide to (see Post-back below).

**This is not Hypercomb.** The visitor is looking at a published website —
the creation is the entire identity of the site. No header bar, no controls
bar, no hive chrome, no branding, no management console, no editor, no
install prompt, no DCP. The deployment carries *just enough of the
application to bin-deploy and run the kiosked experience, whatever it is* —
the creation defines the experience; the harness only boots the runtime,
loads the beehaviors, and renders. Title, favicon, and theme come from the
creation, not from the shell. This harness converges with the shim from
[everything-is-a-beehavior.md](everything-is-a-beehavior.md): everything
above hypercomb-core arrives as beehaviors in the signed closure — views,
games, the creation itself — and hosted websites snap into the same shim.

That is the default, not a ceiling. **Nothing stops a creation from
presenting a hexagon interface — or from connecting back to Hypercomb and
leading the visitor into actually being in the hive again.** The spectrum
runs from pure kiosk (no hive visible at all) through hex-rendered sites, up
to a full gateway: the same engine is underneath either way, so a site that
wants to be a door into the hive just declares it. What's stripped is the
management tooling, never the possibility of participation.

The trust boundary sits exactly at that door. **You experience the creation
as a safe website — no trust decision needed**: nothing of yours is stored
on the origin, nothing is written, walking away costs nothing. **Adopting it
— making it run inside hypercomb.io, where your hive lives — is what needs
community trust**: the one real adopt gesture, code consent, signed
dependencies, the domain allowlist. The published site is the
try-before-trust tier; the gate is crossed only when the visitor chooses to
bring the creation home.

And the door only opens from the inside: nothing on a published site can
push itself into a hive — the client pulls a chosen signature and verifies
the bytes. **When you open the door from the inside, you are accepting your
own request** — requester and acceptor are the same person performing the
same act, which is why no external party can ever open it for you. What you
accept is **the layer metadata that resolves the hive from the website you
were just on**: the site carries its own meta layer (head, place, publisher),
and accepting it is the whole handshake — no other format, no other channel.

Adoption from a published site is also a **warm start**: since the website
is there, all the dependencies and resources resolve instantly — the origin
already serves the full closure, so the pull that follows your acceptance is
cache-hits from the very site you were just on, not cold fetches from
somewhere else.

### The handshake

The caller brings the domain with the request and uses it to get resources —
because a domain is only a WHERE, never a WHAT. The protocol (already built
in `sharing/hive-visit.drone.ts` for hive-links; the resolver's `--from` is
the same move from the command line):

1. **The meta layer names everything**: publisher pubkey, place (segments),
   the domains that serve the bytes, and a head hint for when the index is
   cold.
2. **Resolve "now" against the publisher, not the host**: fetch the signed
   hive index from any of the named domains and verify it against the
   pinned pubkey (`hive-pointer.ts`) — no host can substitute a head.
3. **Bring the domain to the broker**: `noteDomainsForSig(head, domains)` —
   the caller teaches its own byte tier where this closure lives. The
   domains ride along with every subsequent request precisely because they
   authenticate nothing.
4. **Pull and prove**: walk the closure from those domains, sha256-gating
   every byte against its name. The signature is the trust; the domain is
   disposable transport — any domain serving the right bytes is
   interchangeable with any other.

There is no step where the host is believed. The handshake is: *you name a
publisher and a place; the publisher's signature names the head; the head
names every byte; the domain merely delivers them.*

**The elegant form: one signature, resolved against where you stand.**
Can a domain be passed along safely? **With the Merkle proof — yes.** A
passed domain has no power over content: every byte must hash to its name
or it is refused, so a lying source achieves nothing and any domain serving
the right bytes is interchangeable with any other. The proof is what
disarms the transport. What remains is only a soft consideration — which
servers your client calls is a privacy courtesy, not a security boundary —
and the elegant default makes even that moot, because the domain usually
doesn't need passing at all. It is already in one of two places:

- **Under your feet.** Adopting from a published site, the byte source is
  `location.origin` — the door you walked through IS the oasis, and you
  chose to walk through it. The meta layer degenerates to a bare signature
  (plus the publisher pubkey for later updates); the where is implicit in
  the being-there.
- **Inside verified bytes you accepted.** For roaming resolution — mirrors,
  R2, a friend's desktop — additional oases are CONTENT of the publisher's
  own sig-verified meta layer (its hosting incidences), pulled from where
  you stand. They inherit the publisher's authorship because they sit
  behind the signature; a link-crafter cannot inject them.

And sharing needs no special link format carrying hosts: **share the
website's URL** — the link IS the domain, and clicking it is the same
deliberate trust act as all web navigation. Every entrance becomes the
standing-there case. One web.

Even the hand-off — "add to hypercomb" walking a visitor from a published
site into hypercomb.io — passes nothing: **the referrer should be enough.**
The origin you arrived from IS the oasis the staged hive resolves from; the
browser already says where you stood. (A publisher who wants their site
adoptable simply keeps a referrer policy that exposes the origin — opting
in by policy, which is exactly where that choice belongs.)

The resolver CLI's `--from` stays honest under this rule: an operator
typing a source at their own terminal is the standing act itself — the
operator chooses their oasis the way a visitor chooses a link. What is
forbidden is a domain arriving inside a message someone else composed.

And the presentation isn't one declared mode — it is **any number of
whatever views you had configured in the publish**. View marks live on the
branches (the default-view cascade: nearest mark wins), so they ride the
closure like everything else: a site plays back its configured views exactly
as they stood at publish time — a website page here, a square-tile deck
there, hexagons where a layer says so. Nothing extra to invent for
presentation; the publish already captured it.

**The server setup is a resolver.** The minimum install for a server is a
tool anybody can use: put in a **signature** and a **domain**, and it
materializes the exact install to disk. The signature is a deterministic
Merkle root — resolving it walks the closure, fetches every referenced sig
(from R2 or any content host), sha256-verifies each byte against its name,
and writes flat sig-named files. Same bytes, every time, on anyone's server:
the signature IS the install.

- **Update = put in the new signature.** Only missing sigs are fetched (the
  delta — unchanged content already sits on disk under the same name), the
  manifest repoints, done. **Rollback = resolve an older signature** — old
  sigs never die.
- **The resolved folder IS the pool.** Same flat layout the engine reads
  natively — the server disk plays exactly the role OPFS plays in the
  client. The site then runs straight from that folder with the same engine,
  just without the tools to manage anything: data changes only by signature,
  only by the owner.
- **Owner sourcing, two ways**: publish the closure to R2 and let the
  resolver pull it down — or skip R2 and upload the flat files straight to
  their own server plus a manifest file naming the head signature (the
  simpler, self-contained option). Both converge on the identical folder.
- Natural home: `hypercomb-cli` — `hypercomb install <sig> --from <url>
  --to <dir>` alongside the existing `build` and `inspect`. That makes
  "anybody can use it" literal: no repo checkout, no bridge, just Node.

**The whole server surface, then, is two things.** A **shim that gets the
signature** — the one mutable pointer, everything else resolves from it —
and **upload by resolution**: there is no file-upload protocol to invent,
because handing the host a new meta layer IS the upload. The host runs the
same walk the resolver runs — pull what the meta layer names, verify each
byte against its name, write the flat pool — whether the bytes come from
R2, another oasis, or a folder the owner copied up. Update, upload, and
install are one operation wearing three hats; the signature is always the
entire interface.

Named plainly: **the server shim is a slim server install that lets the
site sync to a signature, securely.** Its whole life: hold the pin, serve
the folder, and on a new signature run the resolver's walk and repoint —
complete-or-absent, never a half-synced site. "Securely" is two gates that
already exist in the architecture: every byte proves itself against its
name (the Merkle gate), and the pointer move itself is owner-signed — the
same pubkey-signed head the hive index already uses — so a host operator
can sync *for* the owner but can never sync *as* the owner. The resolver
CLI is this shim minus the daemon: `hypercomb install` run by hand is one
sync; the shim is the same verb standing by.

**The xcopy contract** survives as the degenerate path: run the resolver
locally, get the folder, copy it to the server (`xcopy`, FTP, drag-and-drop —
anything) and it just works. Either way, the folder that lands on the server
is the hard acceptance criterion, and it has design teeth:

- Works on ANY server that can serve static files — plain nginx, Apache,
  cPanel hosting. No Azure or Cloudflare assumptions, no server-side build,
  no CI, no rewrite rules, no MIME configuration, no custom headers, no
  service-worker requirement.
- **Deep links ride the hash**, never paths — doctrine already says hash =
  tile selection and no view navigates the document, so a dumb server only
  ever serves `index.html` and the SPA-fallback config becomes a nicety, not
  a requirement.
- **Extensionless sig files are only ever `fetch()`ed**, never ES-imported
  from the server, so whatever MIME type the host guesses is irrelevant.
  Execution happens from the local cache after the sha256 gate — one more
  reason the silent-install-then-run model is right for this.

**Native to self-hosting.** This must be native to the technique already
running jwize.com: a local relay serving flat sig content from the machine's
own pool, fronted by a tunnel that puts a real domain on it. Run the
installer, get the desktop app, host your own domain's website from your own
computer — or point the resolver at a remote server when you'd rather not
(probably preferable for always-on sites). The desktop app already holds the
pool; serving a published site is the same relay surface plus the website
harness at the domain root. That removes ALL the friction from starting: the
files are already there, and there is nothing to verify per-visitor — it's
safe because visitors never store their own data on the site's origin.

**The full circle.** This lands the web back where it started: a
consumer-owned server — central or not, a cloud box or the desktop app on
your own computer — serving your own content on your own domain. From the
outside it is just web serving, one web, plain GETs. The twist is the engine
it runs on: **hypercomb-core, to be exact** — the zero-dependency primitives
(signatures, IoC, EffectBus, the drone base) — so every page is
signature-proven, every folder is a pool, every site is a host, and
everything served can be experienced safely, shared onward, or adopted into
a hive.

This also closes the visitor half of the standing update gap: publisher
republish = every visitor current, because a visitor holds no state that can
go stale.

## Why this is mostly assembly, not invention

| Needed | Already exists |
|---|---|
| Serve sig-addressed content from a static host | Proven by the DCP bundle (flat `<sig>` files + `manifest.json` on Azure SWA) and the R2 worker |
| Walk + verify a creation's closure at publish time | `scripts/publish-content.ts` (seed → BFS → sha256 gate) |
| Resolvable "current head of a branch" pointer | Signed hive index (`sharing/hive-pointer.ts`, `fetchHiveManifestFromAny`) — pubkey-verified, host-independent |
| Render a foreign branch with ZERO writes | `history.seedPreviewHead` + the preview state (`sharing/hive-visit.drone.ts`): session-only virtual head, commits refused, refresh forgets |
| Localize a closure as inert cache, not adoption | `broker.adopt(head, { layersOnly, silent })` |
| Strip UI without forking templates | Shell-surface registry — inclusion IS registration; a surface that never registers never mounts |
| Load signed bees + deps into a running shell | `ensure-install.ts` bundled path (`installFromBundled`), import map, `ScriptPreloader` |
| Self-host a domain from your own computer | The jwize.com stack: local relay serving the flat pool (`hypercomb-relay`), cloudflared tunnel putting the domain on it; the desktop app holds the same pool |

The genuinely new pieces: the **resolver** (`hypercomb install` — the pull
twin of publish-content's push walk), a **website build configuration** of
the shell, a **baked site descriptor**, and a **boot path** that
auto-installs silently from its own origin and enters the preview state
permanently.

## Architecture

### The deployed folder

```
<site>/
├── index.html + harness bundles   # website build: boot runtime + render, nothing else
├── hypercomb-core.runtime.js, vendor/pixi.runtime.js
├── content/
│   ├── manifest.json              # the module package (bees, deps, layers)
│   └── <sig> …                    # module bytes AND the creation's closure, flat
├── site.json                      # the baked descriptor (below)
└── (optional SPA-fallback config per host — the site must also work without one)
```

`site.json` — the one deployment-specific file. The site's identity (title,
favicon, theme) is derived from the creation at publish time and baked into
`index.html`; `site.json` carries only what boot needs:

```json
{
  "head": "<64-hex branch head sig>",
  "segments": ["revolucion"],
  "pubkey": "<publisher pubkey>",
  "title": "Revolución"
}
```

The head is baked at publish time, so the deployment is immutable and
cache-forever except `site.json` + `content/manifest.json` (serve those
no-store). Republish = new sigs land, `site.json` repoints, done.

### Visitor boot

1. Fetch `site.json`. No sentinel, no DCP iframe, no install prompt, no
   packed-store gate, no `hypercomb:start-install` flow.
2. **Silent module install from own origin** — reuse the bundled-install path
   (`fetchBundledPackage` → `installFromBundled`), sha256-gated as always, no
   consent card: visiting the site is consuming the site, exactly like any
   website's JS. OPFS on this origin is pure cache — visitor origins hold no
   user data. Boot compares the origin manifest each load (the inverse of the
   hive's push-only contract, and deliberately so: on a visitor origin the
   domain owner IS the publisher).
3. **Localize + preview** — `noteDomainsForSig(head, [location.origin])`,
   `broker.adopt(head, { layersOnly, silent })`, `seedPreviewHead(segments,
   head)`, navigate to the creation. Permanent preview: no adopt/dismiss
   banner, no exit into an empty hive.
4. Beehaviors run through the one real render path, foreign-script
   verification gates intact.

### Every published site is an open host

Because the deployed folder IS the pool, the bin deploy + harness satisfy
the host requirements automatically — publishing a site makes you a content
host without doing anything extra. Any participant can go to their installer,
add the published domain, and consume from it over plain GET requests: flat
`<sig>` bytes, the manifest, and the **pools of meaning** that shipped with
the deployment. The pools are open oases of knowledge — publicly readable,
signature-addressed, drinkable by anyone's installer for adoption, sync, or
dependency resolution. A published website and a content host are the same
artifact seen from two sides: a visitor's browser renders it; a
participant's installer resolves from it.

Publishing, then, is **the language to publish pools of meaning**: what a
publish names is which pools go out (the creation's branch head plus the
pools its beehaviors read). A deployment is a published set of pools — the
vocabulary of the publish command is meanings, not file paths.

And the communication language is **always layers — meta layers everywhere**.
That is the dialect of the Hypercomb communication protocol, the same way a
single event shape is the dialect of Nostr: one message shape for
everything, with meaning distinguished by content and marks (as Nostr does
with kinds), never by minting a new format. Meta-information about content
travels as layers too — announcing a published head IS broadcasting a meta
layer, just the same as broadcasting a Nostr message. The practical consequence for tooling like the
resolver: it mints NO bespoke side-formats — its output is flat sig files,
and any "what's current" pointer rides the existing layer/sigbag doctrine.

**It is the perfect reciprocal format to achieve sharing and installation.**
One format, two directions: what a publisher shares is byte-for-byte what an
installer consumes — publish pushes the closure out, resolve pulls it in,
and the same signed pool sits at both ends. Every install is shareable as it
stands; every share is installable as it stands. Nothing is converted,
repackaged, or re-verified between the two — the signature already proved it.

This payoff is exactly why the architecture insists, at all cost, on making
everything **atomic and generic** — and on using **pheromones to separate
things where they don't coincide**. Atomic pieces travel in a closure;
generic machinery runs them anywhere; marks, not code, say what each piece
is. A capability like this deployment doesn't have to be built so much as
assembled — the discipline already paid for it.

### Post-back — the one voluntary door out

Read-only means the visitor writes nothing to the site — it does not mean
the site is mute. A consumer can **post information back to the publisher,
but only what they decide to send, only when they decide to send it**: a
message, an order, an answer, feedback. Nothing automatic, nothing ambient,
no tracking, and never stored on the site's origin — the payload travels to
the publisher's channel (the feedback transport routed through the
publisher's host — see [feedback-channel.md](feedback-channel.md) — or a
creation-declared endpoint) and the visitor's browser keeps nothing. The
creation's beehaviors declare whether a post-back door exists at all; a site
with none is a pure kiosk.

That direction of consent is the point: the publisher shares freely, and
consumes content back from consumers **when they're ready** — that is the
natural data flow for responsible sharing.

### Read-only guarantees (belt and suspenders)

- **Structural**: the app lives on a preview head — commits are already
  refused there, nothing reaches lineage.
- **Gate**: a `readonly` shell flag (from `site.json` presence) that
  HistoryService/commit paths check, so a stray write path fails loudly
  instead of minting truth on a visitor origin. Doctrine ratchet candidate.
- **Stripped chrome**: no editor, no toolwindows, no install/upgrade UI, no
  publish surfaces — visitor surface barrel (below).

### Stripping the management console

The barrel (`shell-surfaces.barrel.ts`) is the ONE list, so the website build
swaps in `shell-surfaces.website.barrel.ts` via Angular `fileReplacements`
(this introduces the project's first fileReplacement — currently none exist).
**The website barrel defaults to EMPTY** — this isn't Hypercomb, so no header,
no controls bar, no toolwindows, nothing authoring-shaped. Surfaces mount only
when the creation's own views need them (module-side surfaces already gate
themselves by registration — a bee that doesn't ship never mounts its UI, and
a view that needs a surface registers it). The pixi host and router shell are
structural, not chrome, and stay.

Bee pruning (shipping only render-critical bees + the creation's beehaviors
instead of the full essentials package) is a later optimization — the first
cut ships the full signed package and relies on the surface barrel + readonly
gate. Signatures make the pruning safe to add later without format changes.

## The plan

**Phase 1 — visitor boot mode** (in `hypercomb-web`)
- `main.visitor.ts` + a `visitor` configuration in angular.json
  (fileReplacements for main + the surface barrel; production optimization).
- `site.json` loader; silent own-origin install; permanent preview seed;
  `readonly` flag exposed on the shell.
- Acceptance: `ng build --configuration visitor` + any static file server →
  the creation renders and navigates with NO install prompt, NO writes
  (lineage bags and truth pools untouched — OPFS diff empty outside cache
  pools), and refresh re-resolves identically.

**Phase 2 — read-only hardening**
- The commit-path gate; verify every write door (history, folder-sync,
  clipboard persistence, settings) either no-ops or stays session-local.
- Doctrine ratchet: visitor build may not register authoring surfaces.

**Phase 3 — the resolver + `publish:site`**
- **BUILT (2026-08-25)**: `hypercomb install <sig> --from <url> [--from …]
  --to <dir> [--verify] [--max <n>]` in `hypercomb-cli`
  (`src/commands/install.ts`): the pull twin of publish-content's push walk —
  resolve the Merkle closure from any content host over the one contract
  (`<base>/<sig>`), sha256-gate every byte before it touches disk (staged
  `.part` write + rename, so a crash can't leave a torn file the delta skip
  would trust), mine refs from text payloads, refuse lying sources, report
  holes. Present files are never refetched but ARE mined, so resolving a new
  signature over an existing folder fetches only the delta; an older
  signature is a rollback. Honors the meta-layers dialect: NO bespoke
  side-formats — output is flat sig files only. Six-case contract spec
  (`install.spec.ts`) + verified live: a 9-sig closure resolved from
  content.jwize.com with zero holes, rerun = 9 present / 0 fetched.
- **BUILT (2026-08-25)**: `npm run publish:site -- <headSig|/branch> --out
  <dir> [--from <url>…]` (`scripts/publish-site.ts`). Assembles the xcopy
  folder: the creation's closure flat at the ROOT (materialized by the
  resolver's own `resolveClosure` — publish and install are literally the
  same walk), the module package verbatim at `/content`, and the branch's
  full `visual:website:page` TREE materialized as `<name>/…/index.html` so
  the absolute links pages already carry work on any host that serves a
  directory's index. Face copies only are rewritten for standalone life
  (`resource:<sig>/x.css` → inline style, since `<link>` is MIME-enforced
  and dumb hosts serve sig files as octet-stream; other `resource:` refs →
  `/<sig>`) — the pool bytes stay canonical under their sigs. A bare head
  sig needs no bridge; a `/branch` path resolves its head over ws:2401.
  No pin files, per the meta-layers dialect.
- Acceptance PASSED: revolucion (523-sig closure, zero holes) assembled and
  served by a deliberately dumb static server (no rewrites, octet-stream
  for everything but .html) — root page fully styled, `/revolucion/flavor-
  wheel` opened COLD renders the interactive wheel live, sig files resolve
  at `/<sig>`, and a re-run fetches nothing (delta). Playwright-proven.
- Still owed from this phase: resolving a SECOND head over the same folder
  as the update gesture becomes routine once revolucion republishes.

**Phase 4 — first real domain**
- Ship one creation (revolucion is the natural candidate) to its own domain
  via Azure SWA or Cloudflare Pages; document the recipe here.
- Decide the growth affordance: an optional "open in Hypercomb" door that
  hands the visitor a hive-link (the adopt path already exists) — off by
  default until decided.

**Phase 5 — self-host from the desktop app**
- Fold the resolver + website harness into the jwize.com self-host stack:
  the desktop app (or the relay it runs) serves a published site at the
  domain root from its own pool, tunnel-fronted. Installer → desktop app →
  your domain, no third-party server at all.
- The relay already serves flat `<sig>`; the delta is serving `index.html` +
  harness + manifest per hosted domain, keyed by the same head signature the
  resolver would install.

**Mirror obligation**: the read-only deployment is a creation — when built it
owes its hive mirror (tiles for the parts, collection, pheromones, notes) in
the same pass, or a mirror-queue entry naming what is owed.

## Open decisions

1. **OPFS cache vs no-storage**: recommended (and assumed above) OPFS-as-cache
   with silent refresh — it reuses the entire install path and gives visitors
   warm reloads. The alternative (pure network import) forks ScriptPreloader.
2. **The hive door is per-creation, not policy** — presentation needs NO new
   vocabulary: the site plays back any number of the views configured in the
   publish (view marks ride the closure via the default-view cascade). The
   only declaration left to decide is the participation door — the mark that
   says "this site leads into the hive".
3. **Head indirection** — `site.json` baked head (assumed) vs consulting the
   signed hive index at boot. Baked keeps the deployment self-contained and
   offline-proof; the index can be added later for multi-host serving.
4. **One signature for the whole site** — should the harness itself
   (index.html + runtime bundles) live inside the signed closure, so the
   install signature covers the ENTIRE site, engine included? That is the
   purest form of "put a signature in and that is the exact install" — and
   it makes engine upgrades ride the same resolve. First cut ships the
   harness alongside the closure; folding it in is the ratchet to aim for.

Related: [everything-is-a-beehavior.md](everything-is-a-beehavior.md) ·
[publishing.md](publishing.md) ·
[embedded-sites.md](embedded-sites.md) ·
[install-push-only.md](install-push-only.md) ·
[infrastructure.md](infrastructure.md)
