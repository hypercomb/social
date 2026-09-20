# Bubble Bobble completion plan

Audit date: 2026-09-20. Branch: `task/bubble-dos-living-primitive`.

## Original objective and safety boundary

Replace the hive's prior Bubble Bobble implementation with a TypeScript
reconstruction of the supplied DOS release, using campaign -> round -> cell
living primitives. Authored hive content wins over bundled seed data. Keep
simulation session-local; never write history at the simulation tick rate.

Never execute downloaded DOS files. Use static inspection of the hash-verified
unpacked image only. Do not ship executable bytes or an emulator. Preserve
unrelated work, particularly Solomon's Key. A clean historical hash or antivirus
scan is not permission to execute the download on the host.

## Audited baseline

- Campaign seed/decoders contain 100 rounds, 575 enemy records, airflow and
  collision patches. `DOS-DATA-AUDIT.md` now statically verifies the checked-in
  table bytes against the supplied compressed campaign resources; this is
  source-data transcription evidence, not a gameplay or scheduler claim.
- Living-round seeding, cell-head hydration and overlay load gates exist. The
  earlier multi-round/cold-head harness defect is resolved by scoped contract
  coverage; real-hive/real-OPFS recovery remains a release-validation gap.
- The AA4A facing-flip correction and Zen-Chan D1C5 initializer separation are
  present in the working tree. The native entrance gate and unsigned activation
  deadline recorded in `DOS-EVIDENCE.md` are implemented and reviewed; deeper
  Zen-Chan D204 branches remain partial parity work.
- Fresh baseline results already recorded below supersede the historical
  3,405-pass/one-failure handoff result. They demonstrate regression health,
  not original-release parity.
- Native constants and partial behavior are implemented, not complete DOS parity.
  Four ground archetypes share movement; three share a simplified firing gate.
  Native ordinary-pop fruit now has a bounded evidence-backed state path, while
  legacy custom fruit keeps its generic fall/ten-second expiry. Special items,
  remaining item routes, and complete per-archetype behavior still need
  evidence; do not describe this as eight complete native state machines.
- `DOS-SCHEDULER-EVIDENCE.md` verifies distinct display-event (`DS:0124`),
  fractional general-tick (`DS:011E`), and pre-batch work (`DS:001C`) clocks,
  plus the remaining-pass counter (`DS:003A`). The engine's one actor pass per
  fixed 60 Hz browser step deliberately aliases those domains. It is a
  fixed-60 adaptation, not a verified hardware scheduler or interrupt phase.
  Its split-cadence and isolated tick tests remain useful adaptation regression
  checks, but cannot establish exact DOS elapsed timing or within-batch order.
- `DOS-ENDING-EVIDENCE.md` traces the record-100 helper's UI/wait route and
  its `DS:0018` transition, but external drawing calls, the source and meaning
  of input/state byte `047E`, score/table-entry callback behavior, and the
  full ending presentation remain unresolved. A browser `won` state is an
  adaptation, not a DOS-ending parity claim.
- Presentation still uses upstream sprites and synthesized audio. Simultaneous
  two-player behavior, special items and bonus rules remain incomplete.
- `_diag.spec.ts` and `zz-probe.tmp.spec.ts` are tracked files, not current
  task residue. The former emits a recovery trace and the latter ends in
  `expect(true).toBe(true)`; neither is parity evidence. A future scoped change
  must either promote their assertions or deliberately remove them—do not use
  their passing status as a release gate.

For the all-100 original-release objective, see
[`DOS-PARITY-CHECKLIST.md`](DOS-PARITY-CHECKLIST.md). It distinguishes decoded
campaign completeness, finite simulation, solvability, trace parity, campaign
progression, and the separately authored living-hive baseline.

## Ordered work packages and acceptance gates

Integration diagnosis: real multi-round seeding succeeds. The failing harness
deletes every non-root location head, leaving only the immutable root snapshot
from the first import; later rounds are not reachable from that snapshot. Its
mock then mints a bare campaign layer on an attempted import. Do not "fix" this
by rewriting ancestors or overwriting production content. A bounded Terra task
is correcting the contract tests: multiple rounds with campaign/round heads
retained and cell heads absent, plus a separate single-round all-heads-absent
case. This diagnosis supersedes the earlier claim that ordinary multi-round
import itself loses metadata. Production cold/remote recovery still requires
real-hive validation before release.

Completed in this audit: Terra implemented the scoped integration correction;
the parent reviewed the resulting test code. No production persistence code
changed. Fresh validation results are recorded below.

## Package 1 validation (2026-09-20)

- `tile-surface.integration.spec.ts` now covers initial seeding with an
  unrelated sibling, three-round reopen with cell heads absent, preservation of
  an authored cell location head across reopening three independently imported
  rounds, and first-round recovery with every non-root head absent. It passed
  4/4 in 1.99s from `social/src`.
- `tile-surface.spec.ts` passed 8/8 in 26.38s. The fresh full essentials suite
  passed 300 files / 3,407 tests in 58.13s. The app typecheck from
  `social/src/hypercomb-dev` passed with
  `node ../node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit --incremental false`.
- The strongest automated persistence harness remains
  `tile-surface.history.spec.ts`: it uses the actual `HistoryService` and
  `LayerCommitter` with in-memory OPFS handles. It is not a browser-real-hive
  launch. No configured modern browser E2E harness was found (the dev README's
  `ng e2e` section says Angular provides none by default). Before release, a
  controlled real-hive/real-OPFS check must launch Bubble Bobble, edit a cell,
  close and reopen the game, then cross a round boundary and reopen again.
  This audit did not launch or mutate a live hive.

## Package 2: Zen-Chan activation evidence (2026-09-20)

- `DOS-EVIDENCE.md` now records static, hash-verified evidence for descriptor
  loading, the entrance/ready gates, the unsigned deadline comparison, and
  Zen-Chan's `D1C5` initializer. It corrects the earlier variant claim: byte-2
  bit 6 is masked from the behavior dispatch at `A85C`, while retained only for
  a later lookup whose role remains unproven.
- Native Zen-Chan now has an internal, one-tick initializer separation after
  activation. It is gated to native levels, preserves the public enemy state,
  and is cancelled on capture, defeat, and release so a stale initializer never
  runs while trapped or replays after release. The native entrance gate is
  persistent after the player reaches y=`20h`, resets per loaded round, and
  delays y=`-1` enemy entrance until open. Native activation now uses A974's
  raw unsigned `u16(now) >= u16(deadline)` comparison; legacy custom levels
  retain their prior signed compatibility path.
- Focused `engine.spec.ts` plus `dos-mechanics.spec.ts` passed 53/53. Coverage
  includes both initial headings, no motion during `D1C5`, next-tick walking,
  60 Hz versus split 120 Hz cadence, legacy custom-level compatibility,
  capture-on-activation, first entrance tick, persistent/restarted/next-round
  latch behavior, descriptor delays 0/1/63, and a wrapped raw-comparator trace.

## Current validation after entrance/deadline package (2026-09-20)

- Focused engine/mechanics validation from `social/src/hypercomb-essentials`
  passed 2 files / 53 tests, exit 0.
- Full essentials validation from `social/src` passed 300 files / 3,418 tests,
  exit 0. The jsdom `HTMLCanvasElement.getContext()` notices did not fail a
  test. These results are regression health only; they do not prove solvability
  or original-release parity across 100 rounds.
- The app typecheck from `social/src/hypercomb-dev` passed, exit 0, with
  `node ../node_modules/typescript/bin/tsc -p tsconfig.app.json
  --noEmit --incremental false`.

## Current validation after native defeated-flight timing (2026-09-20)

- Reviewed scope: the native collision-mask path now retains the static
  `+/-120` defeated-flight speed, moves and reflects before each raw unsigned
  deadline comparison, reverses vertical velocity at `u16(now + 0x3c)`, and
  converts only after the next `u16(now + 0x41)` deadline leaves velocity
  negative. Legacy flight remains separate. This is not a claim that fruit
  movement, expiry, collection, special-item behavior, or the entire BC41 path
  are exact.
- Focused validation from `social/src` passed 3 files / 62 tests, 0 failures,
  exit 0: Bubble engine, DOS mechanics, and static-inspector coverage.
- Full essentials validation from `social/src` passed 301 files / 3,427 tests,
  0 failures, exit 0. The jsdom canvas notices remained non-failing environment
  warnings.
- App typecheck from `social/src/hypercomb-dev` passed, 0 errors, exit 0:
  `node ../node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit --incremental false`.

## Scheduler and terminal evidence boundary (2026-09-20)

- Static analysis verifies that `011E` is produced by fractional PIT carry,
  `0124` by successful video-path interrupt events, and `001C` advances by
  the selected work quantum before its following dispatcher-pass batch. It
  does not establish physical interrupt phase, hardware-specific display
  cadence, or a one-general-tick/one-actor-pass correspondence. Do not call
  the engine's fixed 60 Hz accumulator an exact DOS scheduler.
- No scheduler runtime rewrite is authorized. No reference timing target has
  been selected: before one is proposed, the user must decide whether the
  exactness target is explicit clock-and-dispatch event traces, a declared
  fixed-60 adaptation, or another safe evidence source. Engine tests alone
  cannot settle that decision.
- The normal collectible's `011E` flight deadlines and `001C` expiry deadlines
  are now explicitly separate in the bounded ordinary-item implementation.
  Its fixed-60 work-pass adapter does not resolve hardware batching, phase, or
  the reference timing target.
- Record 100 (`DA=63h`) takes `ED6A` rather than an ordinary next-record load.
  Its UI/wait loop can reach conditional mode/session handoff, but external
  draw/input services and the `E9DA` callback remain open. Do not replace that
  route with a guessed timer or call the current immutable `won` exact.

## Ordinary fruit and native projectile-speed package (2026-09-20)

- Native ordinary-pop items now use an explicit `generalTick`/`workTick`
  helper for the bounded `BC41 -> BC6B -> BCAA -> BD0F/BD3F -> BD72` path.
  It uses direct raw occupancy footprints, normal-chain IDs only, selector-1
  `0258h` work deadlines, pickup-before-expiry priority, six-work-tick expiry
  display steps, and a one-time score display. The engine supplies one work
  increment per fixed-60 browser pass as an adaptation only; it does not claim
  native display batching or hardware interrupt phase. Custom-level fruit is
  deliberately unchanged.
- Native Mighta/Hidegonsu/Drunk horizontal projectiles now use the statically
  traced speed-table values 120/135/150 px/s. Legacy custom levels retain
  240/270/300 px/s. This corrects launch speed only: eligibility, later actor
  lifecycle, pool behavior, and projectile semantics beyond the first clear
  movement pass remain separately bounded evidence work.
- Focused engine, fruit-mechanics, and DOS-mechanics validation passed 3 files
  / 78 tests, exit 0. The sequential full essentials run completed exit 0 with
  no test failures, and the app typecheck completed exit 0. The full-suite
  capture contained repeated non-failing jsdom canvas notices; neither result
  upgrades scheduler, all-100, or original-release parity claims.

## Ordinary native round-clear package (2026-09-20)

- `DOS-ENDING-EVIDENCE.md` now establishes the ordinary `DS:0018` clear
  counter: setup stores `0x258`, a reached control-actor callback decrements
  it only while the tracked `DS:4D64` enemy count is zero, and the countdown
  saturates at zero. This is a cumulative 600 eligible actor-pass condition,
  paused rather than reset by tracked enemy additions—not a three-second,
  display-frame, or hardware-tick rule.
- Native levels now model that bounded condition with a tracked allocation set:
  entering and trapped enemies remain counted; a popped defeated enemy is
  removed; clear occurs only after the zero-count pass budget. Until then the
  game remains active and retains shots/input. The fixed-60 browser pass is an
  explicit adapter, not a claim of original control-actor slot timing. Custom
  levels retain their legacy immediate clear plus three-second transition.
- At the final installed record, `won` remains explicitly labelled a browser
  terminal adaptation. No `ED6A`, `0x384`, ending presentation, or original
  terminal rule has been implemented from this package.
- Focused engine plus static-inspector validation passed 2 files / 68 tests,
  exit 0. The requested full essentials command and app `tsconfig.app.json`
  typecheck completed exit 0; full-suite capture again contained repeated
  non-failing jsdom canvas notices rather than a retained final count. These
  are regression results, not all-100 or original-release parity evidence.

## All-100 structural progression regression (2026-09-20)

- `campaign-progression.spec.ts` passes one deterministic structural test over
  all 100 decoded round objects. It hydrates one living round at a time, uses
  public synthetic captured-bubble fixtures through the real pop/update path,
  exercises each ordinary native clear boundary from rounds 1–99, verifies the
  missing-successor wait and exactly-once resume, and preserves a distinct
  authored hydrated round object. It stops on first entry to ROUND 100.
- This is not solvability, a golden DOS playthrough, an original ending test,
  or a substitute for the all-100 parity gates. It does not establish exact
  gameplay inputs, scores, lives, timing, or final presentation.
- **Current parent validation checkpoint:** the combined full essentials suite
  passed 303 files / 3,456 tests in 53.89 seconds, exit 0; the app
  `tsconfig.app.json` typecheck passed exit 0; and `git diff --check` passed.
  Its temporary log directory was cleaned in `finally`. These are regression
  health results only and do not alter the parity boundaries above.

1. **Living-round reliability.** Reproduce and locate the failing integration
   phase. Distinguish the fake history service's contract from production behavior.
   Fix the narrow cause without ancestor rewrites, silent reseeding, a parallel
   persistence store, or weakened assertions. Cover multiple rounds, current
   authored heads, cold descendants, unrelated siblings and missing content.
2. **Evidence ledger.** Map each claimed mechanic to unpacked-image offsets,
   state transitions, TypeScript and deterministic tests. Reject the old scratch
   helper that disassembles a slice of the packed file. Recheck address conventions
   and uncertain descriptor variant claims. Label verified, partial and unknown
   separately. Check in a safe reproducible analysis tool if evidence otherwise
   depends solely on disposable files; never check in the program image.
3. **Enemy mechanics, one machine at a time.** Start with Zen-Chan activation,
   gravity, jump selection, ascent/descent, contact and reversal. Then Mighta,
   Hidegonsu, Drunk and their projectile phases; Banebou; Monsta/Pulpul; Invader.
   Include native RNG consumption order, initialization ticks and angry/release
   paths. Each change requires offsets, a state description, tests and review.
4. **Player/bubble/contact fidelity.** Audit collision ordering, support and
   bounce, capture/pop/release, simultaneous contacts, death/respawn and wrap
   boundaries. Add multi-actor frame traces rather than only constant checks.
5. **Campaign rules.** Reconstruct collectible movement/expiry/collection,
   special items, bonus scoring, lives, round transitions and terminal rules.
   Account explicitly for two-player support; do not silently narrow the DOS
   objective to single-player. Keep unresolved rules on the ledger.
6. **Presentation and release verification.** Establish remaining sprite/audio
   fidelity and asset provenance constraints. Test the real hive launch, edits,
   close/reopen and round boundaries; measure simulation/render cost under load.
   Run all game tests, the full essentials suite from `src`, and app typecheck.
   Preserve unrelated dirty changes. Review and checkpoint only scoped files.

"Playable living replacement" and "full DOS fidelity" are separate milestones.
Neither a green unit suite nor all 100 decoded maps proves the latter. Do not
claim completion while the evidence ledger has unexplained required behaviors.

## Delegation and spending discipline

Use one bounded economical worker for reproducible integration fixes, test
coverage and implementation against an approved state-machine specification.
Terra is available for this; do not assume a live DeepSeek session or credentials.
Use Astra for ambiguous disassembly, shared-architecture decisions and review of
risky changes. Notify the user before an extended Astra analysis run. Escalate
on a concrete evidence gap, not merely because a worker is quiet. No automatic
model upgrades or uncontrolled parallel agents.

Each handoff must name its files, evidence, acceptance tests and stop conditions.
Review the diff and test result before accepting the package. Update this plan
with actual outcomes; do not repeatedly require the user to prompt each step.

## Verification commands

From `social/src` (the full suite's source-inspection tests require this cwd):

```powershell
node node_modules/vitest/vitest.mjs run hypercomb-essentials/src/games/bubble --config vitest.config.ts --no-cache
node node_modules/vitest/vitest.mjs run hypercomb-essentials --config vitest.config.ts --no-cache
```

From `social/src/hypercomb-dev`:

```powershell
node ../node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit --incremental false
```
