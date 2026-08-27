# Publishing — the current state

How things actually ship today. Three different things get published, on three
different rails, and they drift independently — a green deploy on one rail says
nothing about the other two.

| What | Rail | Command / trigger |
|---|---|---|
| **Content** (a branch, a site, an example hive) | Bridge → relay → R2 CDN | `npm run publish:content -- /branch --r2` |
| **Modules** (essentials packages — bees, deps, layers) | Build → DCP/web/relay (+ Azure blob on deploy) | `npm run deploy:essentials` |
| **Apps** (web shell, DCP, presentation) | GitHub Actions → Azure Static Web Apps | push to `main` / `development` |

---

## 1. Publishing content

`scripts/publish-content.ts` is the whole publish for hive content:

```bash
npm run publish:content -- /revolucion --r2
```

Needs the bridge (broker on `ws://localhost:2401`) with a live renderer.
Flags: `--r2` also backfills the public CDN (`content.jwize.com`, R2 bucket
`hypercomb-content`); `--no-relink` skips step 0 (documented in the file
header only — the usage string omits it).

What it does, in order:

0. **Re-link the chain** — bridge `update` on the branch and every ancestor up
   to the root, same child names in the same order. Moves pointers, never
   membership. Skipping this is the classic trap: the closure walk reports
   "zero holes" over a subtree that predates the build.
1. **Seed** from the live layer plus ALL lineage-bag markers, so old
   generations a consumer still holds keep resolving.
2. **Closure BFS** — every referenced sig, bytes from the relay dir
   (`hypercomb-relay/content/`) or bridge `get-resource`, sha256-verified
   against the sig before writing. Mismatches are refused, not written.
3. **R2 push** (`--r2`) — HEAD the CDN per sig, `wrangler r2 object put` on
   404. Invokes `wrangler.js` directly (Node 24 blocks `npx.cmd` spawn).
4. **Head proof** — resolves the branch head (what the PARENT points at — the
   sig a consumer folds), pushes it directly if it lost the race, and verifies
   it live on the CDN. `NOT resolvable … consumers will 404` means exactly that.
5. **Prints the consumer sync line** — paste-ready `noteDomainsForSig` +
   `syncResolvedBranch`, plus the page-sig equality check.

Gotchas: Git Bash mangles a leading `/branch` arg (MSYS path conversion) —
pass the segment bare or use PowerShell. Idempotent; run it after every site
build. Website pages themselves are minted first (e.g. `npm run
revolucion:deploy`, or the `website-build` skill) as `visual:website:page`
decorations — see [embedded-sites.md](embedded-sites.md).

**What this does not do:** update anyone. Consumer installs hold their own
folded generation; the head still travels by hand (the printed sync line) or
via the static-follow boot poll for hives adopted from a hive-link
(`sharing/hive-visit.drone.ts`).

## 2. Publishing modules

`hypercomb-essentials/scripts/build-module.ts` builds signature-addressed
bundles; `chain-manifest.ts` mints the revision (fresh→v1, changed→v(max+1),
identical re-deploy adopts the existing version); `copy-to-dcp.ts` additively
fills the local browser heaps, and its explicit `--publish` mode also fills the
operator heap served by `jwize.com`:

1. `diamond-core-processor/public/` (additive local heap)
2. `hypercomb-web/public/content/` (additive bundled heap)
3. `--publish`: `CONTENT_DIR`, `--host-heap`, or the primary checkout's
   `hypercomb-relay/content/` (the additive live heap)

Every signature-addressed leaf and sigbag is copied before `manifest.json` and
the signed bootstrap pin advance. No build or publish pass removes a previous
signature. A linked worktree therefore publishes into the primary checkout's
real relay heap rather than its private relay copy; `CONTENT_DIR` remains the
explicit override for another host folder.

The live heap is a **public exposure boundary**, not a general local backup.
Package artifacts are public by definition. Hive content enters only through
an explicitly public root and its verified reachable closure. OPFS and a full
Folder Sync export may contain private signatures and must use a separate,
non-served vault. Content addressing proves integrity; it does not provide
confidentiality to a signature stored behind public `GET /<sig>`.

| Command | Effect |
|---|---|
| `npm run build:essentials` | Build + additive copy to the two local browser heaps; does not publish |
| `npm run deploy:essentials` | Build + local copy + additive fill of the real host heap |
| `npm run mirror:content` | Flat sig blobs → Azure `content` container (broker fallback host) |

No git commit is ever required — the build reads the working tree; the
signature chain IS the version control.

## 3. Publishing the apps

All ride `Azure/static-web-apps-deploy@v1` from `.github/workflows/`:

| Workflow | Branch | Deploys | Notes |
|---|---|---|---|
| `deploy-live-application.yml` | `main` | web shell → hypercomb.io | ALSO publishes essentials to Azure blob and hard-verifies its manifest |
| `deploy-devevelopment-application.yml` | `development` | web shell (dev env) | no essentials blob publish |
| `deploy-playground-application.yml` | `playground-*` | web shell | calls `ng build` directly — **skips `prebuild:web`**, ships committed `public/content/` as-is |
| `deploy-dcp-application.yml` | both | DCP installer | flat sig-file count + manifest key verify |
| `deploy-inspired-by-humans-application.yml` | both | static site | path-filtered |

Check a "live doesn't have my change" complaint with `gh run list
--workflow="deploy-live-application.yml"` FIRST — a failed verify step blocks
the upload and live stays frozen at the last success.

## 4. A deploy is not an update

The web shell is push-only (`ensure-install.ts`): boot reads OPFS only and
never compares against `/content/manifest.json`. A green deploy changes the
SERVER; every returning client keeps its installed bees. New bytes reach a
profile only via DCP sentinel push, `window.upgradeHypercomb()` /
`?upgrade=1`, or a fresh (incognito) client.

## 5. Visiting without adopting

The nearest thing to a visitor experience today is the hive-link preview
(`sharing/hive-visit.drone.ts`): a signed hive index resolves the publisher's
current head, the closure is localized as inert cache, and the branch renders
from a session-only preview head — zero lineage writes, refresh forgets.
But it runs INSIDE an installed shell: the visitor must already have
Hypercomb. Removing that requirement is the read-only deployment —
see [read-only-deployment.md](read-only-deployment.md).

## 6. Known drift (as of 2026-08-24)

- [file-transit.md](file-transit.md) declares Azure retired, yet the LIVE
  workflow still publishes and hard-verifies the Azure blob manifest — one of
  the two is stale.
- Playground deploys skip `prebuild:web` (stale bundled content risk).
- `--no-relink` missing from the publish-content usage string.
- `environment.prod.ts` is unreachable (no `fileReplacements` in either
  angular.json) — shipped builds always carry `production:false`.
- `hypercomb-web/builders/builders.json` declares a signature-cache builder
  that angular.json never references.
