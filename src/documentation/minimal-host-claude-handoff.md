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
- The visitor UI must not use `publications.json` as its offering catalog. The
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

## Behaviour changes to confirm before integration

The snapshot changes door semantics relative to `development`, independent
of the landing: `opensOn` now closes a branch with no `doors` entry (it was
open everywhere), and `publishedRoot` serves a host only for its site's
primary publisher and only when the route's location bag agrees with the
signed head. These are deliberate hardening for signed offerings, but they
will close existing published sites whose indexes predate doors.

The broad snapshot also carries legacy theme, tool window, sharing, and
presentation changes alongside the minimal host. Review its net diff against
current `development` before integration so newer performance and visitor
changes are not silently reversed. Keep the original saved branch as recovery.

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
