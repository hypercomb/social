# Minimal host handoff for Claude Code

Updated 2026-09-25. Continue on `task/pure-host-install-rebased`, created from
`task/pure-host-install` and rebased onto local `development` at `18bfea47d`.
The original task branch is retained. Nothing here has been merged into or
pushed to `development`, published to npm, or deployed to the controlled domains.

## The product contract

- The install is a framework-free cold host: core, signature fetcher, runner,
  one pinned ESM host UI, and the minimum device server or installer. Its pure
  build contains no Angular, Pixi, locales, application package, or content.
- Everything people create, including views, themes, and the in-hive command
  line, is a beehavior. Signed files and typed meta live in meaning pools.
  `host:offerings` discovers public creations; a stable hashed location bag
  supplies the latest head. A package label such as `essentials` is transport
  inventory, not a gallery tile or mutable root signature.
- A root domain shows creation tiles. Sources are searched or filtered, not
  presented as a large domain directory. A participant visits the offering
  host, turns tiles on there, returns with signed references, and explicitly
  completes local verification and activation. An update badge belongs on the
  tile or source; there is no page-wide automatic update action. Off is a new
  location layer. Earlier signed bytes remain addressable.
- The visitor UI must not use `sign('host:publications')` as its offering catalog. The
  relay may retain that endpoint for older host/operator contracts. Publisher
  choices and public switch state come from signed index content and pools.
- GitHub is for minimum device builds. Creation source, revisions, and payload
  are published and replicated through hives; the host fetches only the signed
  closure a selected creation needs. A remote click stages a reference and must
  never run or install it locally before the local review click.

## What is implemented on the rebased branch

- `hypercomb-shim/src/bootstrap/host-panel.ts`, `offerings.ts`, and
  `pending-selections.ts`: creation-led gallery, collapsed Sources filter,
  remote selection and return, local revision review, one or batch activation,
  pending failure retention, and local deployment details. `welcome.ts` no
  longer reads the legacy public door list.
- `hypercomb-core/src/core/host-offerings.ts`, `location-marker.ts`, and
  `hypercomb-runtime/src/{host-activation,location-layer,meaning-creations,
  site-references,text-theme-pool}.ts`: pool and location handling, head checks,
  referenced closure acquisition, and append-only local on/off layers.
- `hypercomb-relay/blossom-worker/worker.js`: projection of public offerings
  and location bags from signed publisher indexes. The only textual rebase
  conflict was in `hypercomb-relay/replicate.js`; it now includes
  `host:offerings` in the public pool list while retaining existing entries.
- `hypercomb-client`: a pure Tauri profile sharing the native hive with its
  HTTP host, an optional deep link for pending selection, and a proof script
  for the on/off route. `.github/workflows/build-minimal-host.yml` defines
  build-only installers and npm/static payloads. The workflow has not run.
- `task/pure-host-install` contains the original saved checkpoint and
  `documentation/saved-pure-host-branch-audit.md`, which inventories its
  differences from the older `development` head. The rebased branch is the
  continuation point; the old audit is historical rather than a current diff.

## Verification on this rebased branch

Run from a fresh worktree under the OS temporary directory; do not reuse the
dirty `development` checkout. On 2026-09-25 these checks passed:

- `npm ci` at `src/`.
- `npm run typecheck` at `src/hypercomb-shim/`.
- `npm run build:pure` with `HYPERCOMB_HOST_OUT_DIR` set to an OS temp directory,
  followed by `node host/check-pure.mjs`. The cold origin was 2.0 MiB; `main.js`
  was 267 kB and the pinned bootstrap 247 kB. The checker found no Angular,
  content, locales, or Pixi in the pure build.
- Eight focused Vitest files covering the Shim, core offerings, and runtime:
  **41 tests passed**.
- `npm ci` in `src/hypercomb-relay/blossom-worker/`, then
  `node --test worker.spec.js`: **65 passed**. Install in that subpackage first:
  its lock uses `@noble/curves` 1.9.7, while the root lock uses 2.0.1 and its
  export path is incompatible with this worker test.
- `cargo test -p hypercomb-serve` in `src/hypercomb-client/`, with
  `CARGO_TARGET_DIR` in OS temp: **22 passed**.
- The pure host served on local port 4865 and `host/check-host.mjs` reported
  **13 passed, zero failed**, with two expected warnings for an empty cold host.

The standalone `tsc --noEmit -p hypercomb-essentials/tsconfig.json` still
reports four errors in `navigation/mode-registry.spec.ts` and
`safety/brood.view.spec.ts` after core and runtime builds. Those two files are
identical to `development`; do not attribute those errors to this rebase. A
complete Angular/essentials build, Tauri installer matrix, live native round
trip, visual browser audit, and controlled-domain deployment have not been
verified on this rebased branch.

## Landing picture removal (resolved 2026-09-25)

`development` commit `0ec3c2d15` removed the landing picture; the broad saved
snapshot had reintroduced it. It is removed again on this branch by
re-applying that commit and keeping the snapshot's newer work where the two
touched the same lines:

- `landing-capture.ts`, publish step 2b, `SiteViewDrone.mountedPageSig`, the
  worker's `paintLanding` / `site.json` field, the cover CSS hook and the doc
  section are gone.
- `hive-pointer.ts` keeps the signed-content pass-through (`offerings` and
  unknown fields survive a roots/doors rewrite) but explicitly drops a
  `landing` field an older index still carries, so it does not ride forward
  forever through the pass-through.
- The door check in `worker.js` is back to `anyPublishedRoot`, as on
  `development`; the snapshot had narrowed it to the primary publisher while
  wiring the landing through. `publishedRoot` itself still enforces the
  snapshot's primary-publisher and route-head checks.
- Regression guards: `hive-pointer.spec.ts` asserts a read surfaces no
  `landing` and a write drops it; `worker.spec.js` asserts a signed `landing`
  field is inert in `site.json` and the visitor page.

Verified after the change: worker 63/63 (three landing tests retired, one
guard added), hive-pointer + publish-branch 32/32, the eight Shim/core/runtime
files 41/41, Shim typecheck clean, essentials typecheck shows only the four
known errors, pure build 2.0 MiB with `check-pure` passing, and the served
cold host 13 passed / 0 failed. In a Linux container with npm 10.9, `npm ci`
at `src/` refuses the lock (`@noble/hashes@2.4.0` missing) on `development`
too; `npm install --no-save` was used there instead.

## Snapshot review (2026-09-25)

Nothing newer on `development` is reversed. Of the 103 files `development`
changed after the snapshot's original base (`876029a5`), only 8 are also in
the snapshot's net diff, and each still carries `development`'s change; no
line `development` deleted is added back. Full Vitest on this branch and on
`18bfea47`: no failure here that does not also fail on the base (12 vs 14).

Fixed on this branch: the shim's `host:pending-selections` and
`host:revision-candidates` pools were missing from the seed census (a root
walk could prune them as lineage bags); two game specs stubbed
`@hypercomb/core` without the canonical-layer functions that moved there;
`#ensureEmptyMarker` now tolerates a racing first read instead of throwing
`Location marker 00000000 already exists`; one new sentence of creations
copy broke the "no single home domain" doctrine pin.

The net diff is three sets. Only the first is the minimal host:

- **Host** (~58 files): shim, core offerings/location marker/canonical
  layer/panel-groups text-theme registry, runtime activation and pools,
  relay offering projection, `main.visitor.ts` return-to-hive link, Tauri
  minimal profile, CI workflow.
- **Theme colour-role migration** (~29 files, half of it regenerated
  `test-results/toolwindow-contrast/contrast.json`): `data-hc-theme-mood`
  replaces the bright-theme name list; `theme.service.ts`,
  `_panel-identity.scss` and the three pre-paint snippets must move together.
- **Other legacy UI** (~49 files): docked-panel text-theme picker and
  settings restyle, quick-menu pool, `onHeld` progress in acquire and the
  host directory, history marker refactor, essentials view restyles.

Open findings not fixed here (legacy side unless noted):

- Quick-menu pool seeds shipped menus once, then prefers the pool copy, so
  a later build's menu changes never reach a hive that already booted.
- Docked-panel text-theme picker shows on windows without a reading surface;
  its domain placeholder hardcodes `jwize.com`.
- Pre-paint mood guesses `dark` only for the theme named `dark`; a stored
  community dark theme paints the light mood until ThemeService runs.
- Shim `index.html` adds a render-blocking `theme.css` with no version tag.
- Host: `main.visitor.ts` accepts any `https:` `?home=` origin for its
  fixed top-layer button, and sends an empty lineage for a site with
  segments but no lineage.
- Host: `relay.js` now strips `/content/` even without a shell dir and never
  serves location bags, so `host:offerings` members that need one, and the
  text-theme "on" status, stay pending behind a Node relay.
- Host: `hive-pointer.ts` rejects a whole index whose `offerings` is not an
  object, after which `publishBranch` refuses with `index-unsafe`.
- `folder-sync-drain.spec.ts` flakes under full-suite load on both sides.

## Work that belongs to both the minimal host and the legacy app

These are one protocol or one engine with a host half and a legacy half; a
split must keep them together or give them a shared home.

- **Transfer progress.** `onHeld` in `hypercomb-runtime/src/acquire.ts` and
  `hypercomb-core/src/install.types.ts` is engine; only the legacy host
  directory draws it (`host-directory.view.ts`). The host panel copies an
  offering through its own `replicateSiteClosure` (`shim/bootstrap/offerings.ts`)
  and shows only "Verifying N of M", so the host has no per-offering
  progress yet and there are two transfer paths.
- **Signed offerings.** The host reads `host:offerings`; the legacy app
  writes them (`hive-pointer.ts` signed-content pass-through,
  `publish-branch.ts`, `text-theme-offering.ts` and its `sharing.boot` port)
  and reads them (`static-peers*`, host directory creations). The relay
  projects them (`worker.js`, `replicate.js`).
- **Location layers.** `core/location-marker.ts` and
  `core/canonical-layer.ts` serve the host (`location-layer.ts`,
  `meaning-creations.ts`) and legacy history (`history.service.ts`).
- **Text themes.** Registry in `core/panels/panel-groups.ts`, pool in
  `runtime/text-theme-pool.ts`; the host refreshes it, the legacy docked
  panel picks and shares.
- **Pool registry.** `core/pool-registry.ts` names host and legacy pools.
- **Return to hive.** `hypercomb-web/src/main.visitor.ts` sends a visitor
  back to the host panel's pending review.
- **Theme tokens.** The shim's `theme.css` is built from the shared
  `_material-tokens.scss`; the mood attribute is set by both shells.
- The quick-menu pool rode in the host bundle (3.3 KB) though only the
  legacy app used it; it moved off this branch (see Split).

## Work missed by earlier merges

Compared only across `development`, `main`, `task/pure-host-install` and
this branch; other branches are out of scope.

- `origin/development` `1423a0c2` (quiet host discovery) was missing here;
  merged in `a041d3da`. It also fixed the runtime `host-packages` and
  `root-holder` specs that failed on the base.
- `main` is fully contained in `development`.
- The owner's local `development` has three unpushed commits (`0ec3c2d15`,
  `f08144fc`, `18bfea47`) that this branch is based on, so
  `origin/development` still paints the landing picture until they are
  pushed.
- `task/pure-host-install` itself is only on the owner's machine; its
  audit is `saved-pure-host-branch-audit.md`. Every file that audit lists
  as changed on the task branch is changed here, except the landing files
  removed on purpose, and `side-effects.ts`, which regenerates unchanged.

## Split (2026-09-25)

Rule: a change stays on this branch only if it is a host primitive
(location layers, signed creations, one marker protocol, replication) or
shared engine the hive also uses. Legacy-app features built beside it moved
to `task/legacy-ui-from-snapshot`, stacked on this branch (commit
`b0ac43a5` here, reverted there): the tool-window colour-role migration,
essentials view and settings restyles, and the quick-menu pool.
`menus:quick` stays reserved in the pool registry.

Kept as shared: `onHeld` transfer progress and the host directory that
draws it; text themes as the one worked example of a signed creation.
Next generalization: the host's "turn on a creation" step accepts only
`themes:text`. Making it any meaning needs the pool registry to learn a
meaning at runtime first, or a root walk may prune the new pool.

## Doors: explicit, signed, per domain (decided 2026-09-25)

A branch is a website only on the domains its signed index lists
(`opensOn`), and a route is a location with append-only revisions
(`currentRouteHead`): a stale index cannot roll it back. This is the
layering primitive applied to routes, so it stays. Consequences:

- A publish with no host marks is published (its share link works; a
  visitor reads the signed index directly) but is not a website until the
  publisher opens a door. The public content host is a byte store, not the
  branch's domain, so no door is implied for it.
- Deploy prerequisite: indexes signed before doors existed open nowhere on
  this worker. Republish those branches with their host marks first.
- Only the site's selected publisher serves a routed host, and its route
  marker advances only on that publisher's signed index PUT.
- `publishedRoot(…, host = '')` now always returns null. No caller omits
  the host today; do not add one.

## Next proof and release work

1. Review the rest of the broad snapshot against `development`; run the
   relevant publisher and visitor tests. Keep changes on this task
   branch or a successor task branch. Repository policy reserves direct
   `development` commits, merges, rebases, and pushes for the owner.
2. Exercise the whole two-host browser journey with an actual signed offering:
   domain search, remote tile on, return, revision review, verified closure,
   local on/off, newer head badge, and failure left pending. Inspect the UI at
   desktop and narrow widths. The local seeded offering tool in
   `hypercomb-shim/host/seed-offering.mjs` is for a static proof build.
3. Build and install the pure Tauri profile, then verify its window and native
   HTTP host share one hive using `hypercomb-client/scripts/check-minimal-native.mjs`
   for both `on` and `off`. Test the deep-link pending selection separately.
4. Run the build-only CI matrix and inspect its npm tarball, static payload,
   installers, and headless binaries. Deploy to controlled domains only after
   the signed offering and browser round trip pass. No deployment or npm
   publication is recorded for this branch.

The detailed previous inventory is available with:

    git show task/pure-host-install:src/documentation/saved-pure-host-branch-audit.md
