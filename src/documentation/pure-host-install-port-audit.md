# Pure host install → development: port audit

2026-09-25. Branch `task/pure-host-install-port`: `task/pure-host-install-rebased`
(through `a041d3da`) with `origin/development` (`d35537cc`) merged in, plus the
fixes below. Companion to `minimal-host-claude-handoff.md`, which records the
Minimal Build session's own snapshot review; this file records what that review
did not cover and why this branch exists.

## Why

The Update all progress bar in the Hosts window had never reached
`development`. It lives in `hypercomb-essentials/src/sharing/host-directory.view.ts`
(`hd-progress`, fed by `acquire(..., { onHeld })`) and arrived only in
`6f0730e9` ("preserve remaining local work") on the pure host branch.

## What `development` was missing

Nothing from the pure host branch was ever merged. `task/pure-host-install-rebased`
was rebased onto a **local** `development` at `18bfea47`; `origin/development`
had moved on without it (`1423a0c2`, `d35537cc`). So three commits that were
meant to be on `development` exist only on the branch:

| Commit | What |
| --- | --- |
| `0ec3c2d1` | revert(publish): remove the landing picture entirely |
| `f08144fc` | perf(install): hash once, at the first store |
| `18bfea47` | test(visitor): bee usage / trim / CPU profile scripts |

and the branch's own work: `cd8b1694` (pure creation gallery and activation),
`6f0730e9` (remaining local work, including the Hosts window progress bar and
runtime `onHeld`), `24c83109` / `30d13a45` (docs), `86ef79d8` (landing removal
re-applied), `e0071249` (review regressions). `origin/development` merges into
it without conflict.

## Method

For every line the branch deletes relative to its merge base (`09928863`),
`git blame` at the base names the commit that wrote it. Lines written by the
squashed root (`076c59e8`) are older code the snapshot changed on purpose;
lines written by any later `development` commit are candidates for a silent
reversal. Each candidate was read.

| Removed lines from | Where | Verdict |
| --- | --- | --- |
| `a87046bb` (#31), `b67e4e54` | landing capture, publish step 2b, hive index `landing`, worker `paintLanding`, visitor cover | Intended: owner removed the landing picture (`0ec3c2d1`) |
| `10f400da` | `relay/replicate.js` public pools | Fine: `host:offerings` added, `hypercomb:windows` kept |
| `2a47bf33` | `scripts/visitor-profile.cjs` | Fine: widened log filter, `VERBOSE` flag |
| `08a1a9cb` | shim `package.json`, `check-pure.mjs` | Fine: stricter pure checks, `prepack` builds first |
| `595bf951`, `6e5941da`, `c03440b4` | shim `README.md` | Fine: rewritten for the gallery |
| **`6e5941da`, `c03440b4`** | **shim `host-panel.ts`** | **Regression — fixed here** |

## Regression fixed: the minimal host lost package replication

`development`'s host card could replicate a package: the selected revision,
this host's latest offer, each carried host's latest offer with its
publication history, a known signature, and Replicate / Repair (`acquire` /
`installPackage`, then one reload). The gallery rewrite (`cd8b1694`) dropped
all of it; `index.ts` still exported the functions but nothing on the card
called them, so a cold pure host had no way from its own page to take a
package. The handoff did not record the removal as a decision.

Restored in `host-panel.ts` as a **Package replication** section after the
gallery (not as tiles — a package is transport inventory, not a creation):

- the selected revision, and this host's latest offer asked eagerly;
- other carried hosts and the by-signature form behind a disclosure, asked
  only when opened (the gallery already reads those domains for creations);
- publication history per host, paged 25 at a time, as on `development`.

## Progress bars on the minimal host

Replication on the minimal host now shows the same kind of bar as the Hosts
window:

- **Package replication** — `installPackage` / `acquire` get `onHeld`; each
  held file is counted once (bare signature) and the bar paints at most every
  100 ms. A row that states its atoms gives the bar an end ("187 of 412 files
  held"); one that does not (admission derives the inventory) moves as a
  count with an indeterminate bar. Failure removes the bar and restores the
  button; success fills it before the one reload.
- **Offering activation** — `replicateSiteClosure` reports `{ done, total }`
  after each batch; `addOffering` passes it through; the review tile being
  turned on (singly or in "Turn on all") shows the bar. The total grows as
  layers name what they use, so the bar can step back; it never claims an end
  it has not seen. Text-theme creations are two files and get none.

This closes the gap the handoff's "Work that belongs to both" section names
under **Transfer progress**: the host panel now draws per-offering progress.
It still copies an offering through its own `replicateSiteClosure`, so there
are still two transfer paths; they now report progress the same way.

## Missed work outside this branch

The handoff's "Work missed by earlier merges" lists branches that never
reached `development` and are not part of the pure host work. They are kept
out of this branch deliberately, one change per merge:

- the command-line word-arrival fix, now on `task/command-word-arrival`
  (based on current `development`);
- atomic branch adopt and swarm image fixes (`fix/swarm-images-atomic-branch-adopt`);
- the launch kit and support copy (`task/exposure-launch`).

## Still open (not changed here)

These are recorded in `minimal-host-claude-handoff.md` and need an owner
decision before `development` takes the branch:

- **Door semantics.** `opensOn` now closes a branch with no `doors` entry and
  `publishedRoot` serves only a site's primary publisher. Existing published
  sites whose indexes predate doors will close, and an ordinary publish with
  no host marks produces a site that 404s everywhere.
- The legacy UI, theme colour-role and relay findings listed under "Open
  findings" in the handoff.

Minor, left for the Minimal Build session (it owns the file):
`host-directory.view.ts` `bareSig` uses `/.(?:js|json)$/` with an unescaped
dot. Harmless on hex signatures.

## Verification

In a temporary worktree (`npm install --no-save` at `src/`; `npm ci` refuses
the lock, as the handoff notes):

- `npm run typecheck` in `hypercomb-shim`: clean.
- Shim, core offerings and runtime activation Vitest files: 8 files,
  **43 passed** (41 before; +2 host-panel tests for package and offering
  progress; the activation test now asserts the progress sequence).
- `npm run build:pure` + `host/check-pure.mjs`: pure install verified, origin
  2.0 MiB, `main.js` 267 kB, framework-free.
- The served cold host renders the section at 1280 and 390 px with no
  horizontal scroll.

## Coordination

The Minimal Build session is still working on `task/pure-host-install-rebased`
and owns it and `minimal-host-claude-handoff.md`. This branch does not push to
either; it merges their tip instead. Merge their later commits into this
branch, or this branch into theirs, before `development` takes it.
