# Build Revisions — every multi-file creation is revision-safe

How a build that emits MANY files (a website with shared layout + styles,
a game, an application, a study deck) stays undoable/redoable as ONE
step, using nothing but primitives the platform already had. Doctrine
for every producer — current and future.

## The problem

A single page is already fully revisioned: its sig lands in the cell's
`website` slot, and the chain of distinct page sigs down the lineage IS
the version history — read, not recorded (`websites.source.ts`). But a
build PASS often writes many things at once: several cells' pages, plus
shared resources they all reference (chrome.css, layout, art, engine
files). Before this doctrine, undoing "the build" meant N separate
undos across N locations with no record that they belonged together —
the July 2026 audit confirmed no grouping record existed anywhere in
the hive (the only one in the system was DCP's published package
rootSig, which is the install pipeline's twin of this doctrine).

## The rejected shape: a revision code

The obvious fix — stamp every file written by one build with a shared
revision code (random, but identical across the pass) — is strictly
worse than what the architecture already gives us:

- A random code is not content-derived: two identical builds get
  different codes, so no dedup, no integrity, no O(1) "nothing changed"
  detection.
- The code needs a side-channel to live in plus a code → files mapping —
  two new bookkeeping structures.
- Nothing else speaks "code": the local version chain and the DCP
  deploy chain are both already **sig-keyed**.

**The revision code is a signature.** Specifically: the sig of a build
record whose `seal` is the subtree's merkle root.

## The standard

### R1 — every file is a standalone sig-named resource

Every file a build emits — pages AND shared/global files — is written
content-addressed to the content root (`Store.putResource` / bridge
`put-resource`). Same bytes → same sig → stored once. Audit verdict:
**already true of every producer.**

### R2a — content references are sig-only

A built file references OTHER CONTENT only by signature:
`resource:<sig>`, bare 64-hex on `src`/`href`/`data-src`,
`url(resource:<sig>)`, `resource:<sig>/chrome.css`, `payload.htmlSig`.
Never by mutable name, alias, or "latest" pointer. This makes pinning
*transitive*: a page sig pins the exact chrome it shipped with; nothing
drifts underneath a restored page. Audit verdict: **every producer's
asset refs conform.**

### R2b — page-to-page links are TREE references, by design

Links between pages stay **name/path-based** (`/dolphin/about`,
`../team/`). This is not a violation of R2a — it is the
lineage-is-the-route model (`embedded-sites.md`): a link is a
*navigation instruction* (go to the cell at this name), not a content
reference, and the target cell mounts whatever ITS current page is.
Pinning page sigs inside hrefs would resurrect the retired bundle
model, fight hierarchy-aware navigation, and make any one-page edit
fan out through every page that links to it.

The cost is real and named: a page graph is only version-coherent if
its cells move through versions **together**. That is exactly what R3
provides — name links are revision-safe *because* a build restores as
a unit, so they always land on same-generation pages.

### R3 — one build record per pass; a build is a SCOPED SNAPSHOT

A pass that writes more than one anchor (multiple cells, or a cell +
shared resources) ends with ONE build record — the snapshot record
shape, one scope narrower:

```json
{ "seal": "<sealSubtree(buildRoot)>", "label": "dolphin site build", "at": 1784500000000 }
```

- `seal` is the subtree's merkle-coherent root taken right after the
  pass. It transitively names everything: every cell's page (slots are
  inside the layer sigs the seal folds) and every shared asset (pinned
  sig-only from page bytes, per R2a).
- The record rides the resource pool; its sig is appended to the
  **`builds` slot on the build root's layer** (`builds-slot.ts`) — the
  same shape as `website` and `snapshots`: flat sig array, newest last,
  chain read down the lineage, travels on adoption, sits inside the
  merkle.
- **Idempotent rebuild = no-op.** `mintBuildRecord` compares the fresh
  seal against the head record's and declines to mint when equal —
  "did anything change" is one compare. (This is why the record carries
  no parent pointer: ordering lives in history, and an intrinsic chain
  would break the no-op.)
- **Restore is forward-only** via the shared seal-restore walk
  (`seal-restore.ts`, also now the engine of `/restore`): every
  differing location gets one appended head marker; nothing rewinds,
  nothing is deleted. The `builds` index is carried forward on restore
  — the monotonic-index rule — so going back never erases the way
  forward.

When R3 does NOT apply: a pass that writes a single anchor needs no
record — by R2a the page sig already pins its whole closure, and the
slot chain is the history. The record earns its place only where
grouping is otherwise unrecoverable (cross-cell membership is truth,
not cache — so it is a slot, never an optimize-phase record).

## Surfaces

- **Producers** (bridge clients): end every multi-anchor pass with
  `{ op: 'build-record', segments: [<buildRoot>], label }` — the
  bridge op behind which `mintBuildRecord` does seal → compare → mint
  → `commitSlotAppend`.
- **Participants**: `/builds` lists the current cell's revisions,
  `/builds record <name>` seals by hand (same mint), `/builds restore
  <name>` brings one back — after auto-recording the current state
  first (free when unchanged), same safety as `/restore`.
- **Whole hive**: `/snapshot` + `/restore` are the `segments: []` case
  of the same primitive and predate it; `build-record` deliberately
  refuses empty segments and points at `/snapshot`.

## Conformance (audited 2026-07-27, wired same day)

| Producer | R1 | R2a | R3 |
|---|---|---|---|
| `scripts/bridge/_dolphin-revision.cjs` | ✓ | ✓ | wired (`dolphin`, `dashboard`) |
| `scripts/bridge/humanity-site/stamp.cjs` | ✓ | ✓ | wired |
| `scripts/bridge/_susan-build.cjs` | ✓ | ✓ (chrome inlined per page — legal, dedup-poor) | wired |
| `scripts/bridge/_howard-pages.cjs` | ✓ | ✓ | wired |
| `scripts/ai-inside/build-website.cjs` | ✓ | ✓ | wired |
| `scripts/intel-build-revolucion-site.ts` | ✓ | ✓ | wired |
| `scripts/bridge/_put-diagrams.cjs` | ✓ | ✓ | wired |
| website-build skill | ✓ | ✓ | step 8 of the skill |
| Tutor decks (`_tutor-deck.cjs`, per-cell `tutor` slot) | ✓ | ✓ | per-cell atomic already; subtree passes should end with one `build-record` at the scope root |
| `/present` slides | ✓ | ✓ | n/a — one resource per gesture |
| `/website save`/`load` archive | ✓ | ✓ | n/a — transport; import is one `importTree` |
| Games (5-file overlay) | n/a — source-code convention; games persist nothing to OPFS | — | — |
| DCP deploy revisions | ✓ | ✓ | already sig-keyed (`useRevision(domain, rootSig)`) — the published twin |

Known dead hook, deliberately NOT revived: `HistoryOp.groupId`
(`history.service.ts`) — declared and documented (`revision-mode.md`)
but written by nothing and read by nothing, and it rides the dormant
op-log the July audit marked for deletion. Build-level restore makes
per-marker grouping unnecessary for builds; if mid-build Ctrl+Z
granularity ever matters, that is a separate decision.

## Files

- `hypercomb-essentials/.../history/builds-slot.ts` — `BUILDS_SLOT`,
  `BuildRecord`, `readBuildsAt`, `mintBuildRecord`, passive slot
  registration.
- `hypercomb-essentials/.../history/seal-restore.ts` — `applySealAt`,
  the one restore walk shared by `/restore` and `/builds restore`.
- `hypercomb-essentials/.../commands/builds.queen.ts` — `/builds`
  list · record · restore.
- `hypercomb-essentials/.../assistant/claude-bridge.worker.ts` —
  `build-record` op.
- `hypercomb-essentials/.../history/snapshots-slot.ts`,
  `commands/snapshot.queen.ts`, `commands/restore.queen.ts` — the
  whole-hive case and the monotonic-index doctrine this generalizes.
- `hypercomb-shared/ui/aggregate-index/sources/websites.source.ts` —
  per-cell version chains read from the lineage; the reasoning R3
  scales up.

## Related

- `documentation/signature-primitive-audit-2026-07.md` — the platform
  conformance audit this extends with the build-grouping rule.
- `documentation/embedded-sites.md` — per-cell pages, sig ref forms
  (R2a's ground truth), lineage-is-the-route (R2b's ground truth).
- `documentation/dna.md`, `signature-algebra.md`, `signature-system.md`
  — the content-addressed model underneath.
