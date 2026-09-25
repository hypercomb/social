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

## First issue to resolve

`development` commit `0ec3c2d15` explicitly removed the landing picture. The
broad saved snapshot auto-merged after that commit and **reintroduced**
`sharing/landing-capture.ts`, capture in `publish-branch.ts`, landing fields in
`hive-pointer.ts`, relay painting in `blossom-worker/worker.js`, related tests,
and cover CSS in `hypercomb-web/src/index.visitor.html`. This is a semantic
regression despite a clean textual rebase and passing worker tests. Remove the
landing picture behavior and its tests while preserving the new signed
offerings, unknown signed index fields, and hashed location behavior. Compare
with `git show 0ec3c2d15` and current `development` before editing.

The broad snapshot also carries legacy theme, tool window, sharing, and
presentation changes alongside the minimal host. Review its net diff against
current `development` before integration so newer performance and visitor
changes are not silently reversed. Keep the original saved branch as recovery.

## Next proof and release work

1. Reconcile the landing removal and review the broad snapshot; run the
   relevant worker, publisher, and visitor tests. Keep changes on this task
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
