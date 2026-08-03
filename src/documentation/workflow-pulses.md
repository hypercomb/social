# Workflow Pulses — triggered tree audits (PLAN)

Status: **PLAN — not built.** Extends the existing `workflow/` module
(workflow-slot, workflow-step, workflow-runner, workflow-ask). Nothing here
replaces the manual `workflow:run` path; pulses are a second way the same
workflows start.

## The idea

A workflow is already "a little script made of tiles". A **pulse** is that
workflow waking *by itself* when a touch point it declared an interest in
changes — descending its scope, auditing what it finds, and depositing
`ask` requests where the hive has drifted from what the workflow checks
for. The platform incrementally audits and matures itself; the participant
stays the one who commits.

The whole feature is three small pieces on top of what exists:

1. a **trigger record** on the workflow cell (what wakes it),
2. a **trigger index** (derived cache, minted in the optimize phase),
3. a **pulse dispatcher** (matches touches against the index, then starts
   an ordinary run *outside* the phase).

Everything downstream — steps, `ask` deposits, the feedback window, the
run panel — is untouched and already built.

## 1. The trigger record

A decoration on the workflow cell, same shape discipline as
`visual:workflow:step`: kind `workflow:trigger`, payload `{ triggerSig }`
pointing at a resource:

```jsonc
{
  "v": 1,
  // what kind of touch wakes this workflow
  "on": "change",              // 'change' (truth committed) | 'mark' (pheromone applied)
  // WHERE it listens — exactly one of:
  "scope": ["websites", "menu"],   // subtree: any commit at/under this location
  "mark": "jwize.com:navigation",  // OR: any tile carrying/receiving this pheromone
  // throttle: never pulse the same head twice, plus a quiet period
  "cooldownMs": 60000
}
```

- Decoration not slot: a trigger is *classification* ("this workflow
  watches that"), the exact job pheromones/decorations do. The workflow
  record slot stays what it is — name + description.
- `mark` triggers are the data-driven half of the doctrine: adding an
  audit to a new part of the hive is applying a pheromone, not editing
  the workflow.
- Interests use the declared vocabulary — never mint mark keywords on the
  fly.

Authoring surface: the existing workflow designer gains a trigger section;
`/workflow trigger <scope|@mark>` as the command-line form.

## 2. The trigger index (derived cache)

Scanning every workflow cell on every touch is a walk we must not do.
Instead a bee's `optimize()` mints the index — the phase is exactly for
this (optimize-phase.md):

- Pool: `sign('workflow:triggers')` (colon meaning, per
  known-location-pools.md — registered via `Store.poolSignature`).
- Record: keyed by the trigger *resource* sig; body is the resolved match
  data — the scope's location sig (from `lineageKey`), or the mark string,
  plus the workflow cell's segments.
- Pure derivation of sig-addressed inputs, complete-or-absent, never
  load-bearing: a cold client rebuilds it from layers alone, and the
  dispatcher falls back to a direct walk when the index is absent
  (slower, never wrong).

## 3. The pulse dispatcher

A drone that:

1. Collects touch points during normal operation — the `content:wrote`
   effect (kind `layer`) already carries the committed location; pheromone
   applies already emit. Touches accumulate in a session-local set.
2. During its `optimize()`, matches the accumulated touches against the
   trigger index. **Detection only** — the phase mints no truth, starts
   nothing.
3. After the phase, schedules matched workflows as ordinary runs through
   the existing `WorkflowRunnerDrone` (`workflow:run` with the workflow's
   segments). One at a time — the runner already refuses concurrent runs;
   the dispatcher holds a FIFO of pending pulses.

### Convergence guards (the part that makes this safe)

- **Head-sig idempotence.** Before running, resolve the watched scope's
  current head sig. A pool record in `sign('workflow:pulses')` keyed by
  `sha256(triggerSig + headSig)` marks "this workflow already pulsed this
  state". Same head → skip. This is derive-on-miss applied to *work*:
  changed subtree = new head sig = pulse; unchanged = silence. (Receipt is
  recomputable-in-principle and never load-bearing → pool record, written
  by the dispatcher AFTER the run, outside the phase.)
- **No self-retrigger.** While a pulsed run executes, the dispatcher
  ignores touches; and a workflow's own cell subtree is always excluded
  from its scope match. A pulse chain (A's asks answered → commit → B
  pulses) is fine — each hop passes through the head-sig gate and,
  for truth changes, through a human answer.
- **Asks, not writes.** A pulsed workflow that would change truth ends in
  `ask` steps (workflow-ask.ts). The pulse *finds* drift; the participant
  *commits* the correction. Pulsed runs pass `viaWorkflow` provenance so
  feedback-window questions say which pulse raised them. Steps that only
  mint derived caches or notes may complete without a person.
- **Cooldown + coalescing.** The optimize phase is already coalesced; the
  per-trigger `cooldownMs` keeps a hot subtree from queueing the same
  audit repeatedly.

## What is deliberately NOT in this plan

- **No cron/scheduler.** Pulses are reactive — a touch is the clock. Time-
  based sweeps stay with the existing feedback-loop routine.
- **No new run machinery.** A pulse IS `workflow:run`. Step-through, stop,
  run panel, `asked` halting — all inherited.
- **No persistent run log.** Same rule as the runner: live state on
  `workflow:run-state`, durable record = what the steps did (plus the
  pulse receipt above).
- **No pulse-authored truth.** Doctrine ratchets stay tight: nothing in
  the optimize phase writes layers, markers, or lineage; the dispatcher's
  runs go through the same commit paths a hand-run does.

## Build order

1. `workflow-trigger.ts` — record shape, read/write, `workflow:trigger`
   decoration kind (mirror of workflow-step.ts).
2. Trigger-index optimizer bee — mints `sign('workflow:triggers')`
   records in the phase.
3. `workflow-pulse.drone.ts` — touch accumulation, phase-time matching,
   post-phase FIFO dispatch, head-sig receipts in
   `sign('workflow:pulses')`.
4. Designer + `/workflow trigger` authoring surface.
5. **Mirror in the hive, same pass**: tiles for the three parts under the
   workflow collection, `part` pheromones, notes carrying this doctrine;
   a card in the behaviors deck for the pulse behaviour.

## Litmus recap

| Artifact | Truth or derived? | Home |
|---|---|---|
| trigger record + decoration | truth (travels on adoption) | resource + decoration on the workflow cell |
| trigger index | derived (rebuildable from layers) | `sign('workflow:triggers')`, minted in phase |
| pulse receipt (head-sig gate) | derived accelerator | `sign('workflow:pulses')`, written post-run |
| the audit's corrections | truth | committed only through answered asks |
