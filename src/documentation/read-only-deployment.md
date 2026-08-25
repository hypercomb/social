# Read-only deployment — creations as published websites

*(design — planned, not built; decided 2026-08-24)*

**This is the canonical way to publish a hive** — how a participant shares
their digital content with consumers. Publish a creation as a **read-only
deployment**: a website on its own domain, running the real runtime and the
creation's behaviours, that a visitor uses with **zero install**. Nothing
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
loads the behaviours, and renders. Title, favicon, and theme come from the
creation, not from the shell.

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
4. Behaviours run through the one real render path, foreign-script
   verification gates intact.

### Post-back — the one voluntary door out

Read-only means the visitor writes nothing to the site — it does not mean
the site is mute. A consumer can **post information back to the publisher,
but only what they decide to send, only when they decide to send it**: a
message, an order, an answer, feedback. Nothing automatic, nothing ambient,
no tracking, and never stored on the site's origin — the payload travels to
the publisher's channel (the feedback transport routed through the
publisher's host — see [feedback-channel.md](feedback-channel.md) — or a
creation-declared endpoint) and the visitor's browser keeps nothing. The
creation's behaviours declare whether a post-back door exists at all; a site
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

Bee pruning (shipping only render-critical bees + the creation's behaviours
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
- `hypercomb install <sig> --from <url> --to <dir>` in `hypercomb-cli`: the
  pull twin of publish-content's push walk — resolve the Merkle closure from
  any content host, sha256-gate every byte, write the flat pool + manifest.
  Idempotent and delta-only: re-running with a new signature fetches only
  what's missing; an older signature is a rollback.
- `scripts/publish-site.ts`: assemble the full deployable folder locally —
  website harness build + resolver output + baked `site.json`. One command,
  no git required. `npm run publish:site -- /revolucion --out
  ../deploy/revolucion`.
- Acceptance = the xcopy contract: publish (or resolve) → serve the folder
  with the dumbest static server available (defaults, zero config) →
  Playwright pass (`npm run shot`) proves render + navigation + a behaviour
  firing, including a hash deep link opened cold. Then: resolve a SECOND
  signature over the same folder and prove the delta property (only new sigs
  written, site now serves the new head).

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
2. **Adopt door on visitor sites** — growth loop vs pure kiosk. Default: off.
3. **Head indirection** — `site.json` baked head (assumed) vs consulting the
   signed hive index at boot. Baked keeps the deployment self-contained and
   offline-proof; the index can be added later for multi-host serving.
4. **One signature for the whole site** — should the harness itself
   (index.html + runtime bundles) live inside the signed closure, so the
   install signature covers the ENTIRE site, engine included? That is the
   purest form of "put a signature in and that is the exact install" — and
   it makes engine upgrades ride the same resolve. First cut ships the
   harness alongside the closure; folding it in is the ratchet to aim for.

Related: [publishing.md](publishing.md) ·
[embedded-sites.md](embedded-sites.md) ·
[install-push-only.md](install-push-only.md) ·
[infrastructure.md](infrastructure.md)
