# Bubble Bobble DOS all-100 parity checklist

This is a release ledger for the supplied 1989 NovaLogic/Taito DOS release.
It uses only the repository's static reconstruction evidence—principally
`DOS-REFERENCE.md`, `DOS-EVIDENCE.md`, the decoded TypeScript tables, and their
tests. It is not an arcade-memory checklist, and it does not authorize running
the DOS material.

## Terms and evidence rule

- **Verified** means an identified static source and a bounded implementation
  or deterministic check support the statement.
- **Partial** means a data format, constant, or routine entry is known, but the
  complete state machine or interaction is not proved.
- **Unknown** means the current static evidence does not support a release
  claim.

No green browser, unit, or finite-run test upgrades a status by itself. A
behavior becomes verified only with an offset/decoded-data reference, a stated
mapping into TypeScript, and deterministic coverage of the relevant transition.

## Current original-release ledger

| Required release behavior | Status | Current evidence and boundary |
| --- | --- | --- |
| Resource identity and safe static-only handling | Verified | `DOS-REFERENCE.md` records hashes, compression and the no-execution boundary. |
| 100 terrain records, 100 enemy lists, 575 descriptors, native cells and airflow/collision patches | Verified for decoded campaign data | `DOS-DATA-AUDIT.md` statically compares the checked-in tables to the supplied compressed resource bytes; `dos-*-data.ts`, `levels.ts`, and tests cover the reconstruction. This does not prove gameplay parity on those maps. |
| Cave coordinates, work columns, collision neighborhoods, directional predicates and 8.8 arithmetic | Verified/partial | The data shape and core primitives are traced in `DOS-REFERENCE.md`; every caller and interaction is not yet proved. |
| General-clock calibration, native speed conversion and deterministic LFSR | Verified for documented primitives | Static evidence identifies the fractional `011E` clock and speed conversion; `dos-mechanics.spec.ts` covers the primitives. The engine's one-pass fixed-60 model is an adaptation, not a selected or exact hardware-timing contract; display/work catch-up and interrupt phase remain partial. |
| Player entrance, ground turn/jump/fire timing, support and bubble bounce | Partial | Documented constants and several transitions are tested; complete contact ordering, simultaneous cases and all death/respawn branches remain unproved. |
| Fired/floating/captured bubbles, airflow, lifetimes, cap and direct trapped pop | Partial | Documented phases and limits have tests; dynamic multi-contact and all ordering edge cases remain unproved. |
| Zen-Chan descriptor/entrance/activation/D1C5 initializer | Partial | `DOS-EVIDENCE.md` directly traces loader, gates, unsigned comparator and initializer. Native entrance/deadline/D1C5 mappings are implemented with focused tests; D204 branches remain partial. |
| Mighta, Hidegonsu, Drunk, Banebou, Pulpul, Monsta and Invader | Partial/unknown | Dispatch entries, headings and selected topology/constants are documented in `DOS-REFERENCE.md`; full per-kind AI, projectile branches, RNG consumption and angry/release behavior are not fully traced. |
| Pop-score chain and defeated-enemy timed flight | Partial | Constants and isolated transitions are documented/tested; the fixed-60 engine adaptation preserves the bounded timed-flight path, while native actor-pass cadence remains distinct from hardware timing. |
| Ordinary collectible movement, expiry and collection | Partial | The normal `CL=1` chain now has a native-only, clock-explicit bounded implementation with direct occupancy probes, selector-1 work duration, expiry, pickup, and score display. Special routes, selector meanings outside that path, exact hardware scheduling, bonuses, lives and terminal rules remain unresolved. |
| Campaign progression through all 100 rounds | Partial | Native ordinary clear now has an offset-backed 600 eligible control-actor-pass countdown over a tracked enemy set, represented by a fixed-60 adapter. `campaign-progression.spec.ts` structurally hydrates and transitions rounds 1–100 with synthetic pop fixtures, but is not solvability or a golden playthrough. The record-100 `won` view remains a browser adaptation; terminal UI/input, external guards, hardware cadence, alternate routes and a reproducible all-round completion trace are not proved. |
| Two-player rules | Unknown | No claim of parity is supported by current evidence. |
| Original graphics, music, sound and presentation | Unknown/out of scope | Renderer uses pinned upstream GPL sprite sheets and synthesized audio, not DOS assets. |

## Required all-100 gates

Every round must pass each applicable gate. A later gate never substitutes for
an earlier one.

1. **Decoded-data gate.** For rounds 1–100, verify exact terrain record,
   expanded 32x25 visible bytes plus eight work columns, airflow settings and
   patches, ordered descriptors, screen coordinates, delay, heading and variant
   retention. The aggregate invariants are 100 rounds and 575 descriptors; add
   round-indexed failure output so one malformed record is identifiable.
2. **Installation gate.** Hydrate each decoded round into a fresh native engine
   and, separately, into the campaign → round → 800-cell living surface. Check
   exactly one player marker, 800 distinct cells, ordered enemy descriptors and
   native metadata. This is content installation, not playability.
3. **Finite-simulation gate.** Run a fixed, declared input schedule for a
   bounded *adaptation-step* budget at both `1/60` and split `1/120 + 1/120`
   cadence. Require no throw, NaN/infinite actor state, duplicate/removal
   corruption or cadence divergence. This only shows the engine remains finite;
   it neither clears a round nor proves DOS behavior or hardware timing.
4. **Solvability gate.** A deterministic controller or recorded input trace
   must clear each original round under declared rules and bounded retries.
   It must record input, RNG seed, tick count, score/lives and terminal state.
   A manual clear or a finite simulation is not a solvability proof. No such
   all-100 controller/trace is currently evidenced.
5. **Parity-trace gate.** For each implemented state machine, compare an
   offset-backed expected transition trace: position/velocity in 8.8 terms,
   state/procedure boundary, RNG draws, collision result, score/item and tick.
   Mark a round blocked if it depends on an unknown behavior; do not fill gaps
   with an arcade-derived expectation.
6. **Progression gate.** Verify native-backed round clear, next-round install,
   final-round terminal behavior, life/game-over handling, and any required
   two-player branch across an all-100 sequence. The structural hydration/pop
   regression is useful coverage, but does not satisfy terminal, life,
   two-player, solvability, or original-input requirements for this gate.

## Living-hive baseline is separate

The DOS release has no Hypercomb history. For a faithful *original* baseline,
all gates above run from decoded seed data with no authored changes. Living
behavior is a separate integration contract:

- first entry may seed campaign, round and 800 cell layers once;
- reopening resolves current authored cell heads; authored content wins and is
  never silently reseeded over;
- simulation ticks, scores and movement never write history;
- test the pristine decoded baseline and an authored-edit baseline separately.

The current integration/history coverage exercises selected hydration, cold-cell
and authored-head cases. Before release it still needs a controlled real-hive,
real-OPFS launch/edit/close/reopen/round-boundary check. That result must not be
reported as DOS parity.

## Release reporting template

Report results without collapsing categories:

| Metric | Required report |
| --- | --- |
| Data installation | `rounds passed / 100`, descriptor total and round IDs failing |
| Finite simulation | schedule, tick budget, cadence, `rounds passed / 100` |
| Solvability | controller/trace version, seed, retries, `rounds cleared / 100` |
| Parity traces | verified state machines, blocked round IDs and exact evidence gaps |
| Progression | last completed round, terminal/lives/two-player coverage |
| Living baseline | pristine and authored scenarios separately; real-OPFS result separately |

Do not call the release "all-100 original parity" until all required gates are
complete and the unknown ledger entries that affect those gates are resolved or
explicitly removed from the claimed scope.
