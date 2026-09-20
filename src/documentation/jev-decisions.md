# Jev decisions in the hive

Implemented 2026-09-20. The participant selected OpenRouter's rolling
`~typesafe/jev-latest` alias. No model snapshot is substituted.

## The working loop

An OpenRouter worker reads compact hive context using the existing read fence.
For a consequential choice it emits one closed `hypercomb-propose` fence:

```json
{"proposals":[{"id":"a","label":"Reuse the existing notes","plan":"Group the existing notes without copying them."},{"id":"b","label":"Link the existing notes","plan":"Add references between the existing notes."}]}
```

Two or three alternatives, each with a short label and a concrete plan. Simple
work continues to use `hypercomb-do` directly; no manufactured alternatives.
The decision service batches three independent Noul questions per proposal:
requirement fit, doctrine compatibility, and evidence sufficiency. Multiple
proposals also get a Choice including `none`. Code applies the gates; scores
are never averaged to compensate for a rule conflict.

A selected direction goes back to the worker for implementation. A tie,
insufficient evidence, invalid provider response, timeout, exhausted budget,
or unavailable service produces participant choice. The choices and plans are
ordinary persisted conversation text, so a subsequent worker can continue from
the participant's answer after reload.

Existing Hypercomb primitives and participant values guide proposal generation.
A rules score <= .05 marks a clear doctrine conflict: a rejected selected plan,
or all plans rejected, goes back to the worker for revision. Rejected alternatives
are excluded from participant choices. This is a model assessment, not proof.

Each actual do block is also evaluated. An uncertain action enters Execution
with `forceReview`; automatic execution settings cannot release it. A person
can Run or Skip the exact parsed commands. A positive Jev decision does not
grant permission: the existing execution policy, live vocabulary validation,
serialized execution lane, and snapshot checks still apply.

Intermediate worker prose is held while Jev mode is active. The final prose or
participant question is shown, with the hive's own execution receipt. Workers
are instructed to read back affected content before concluding; if no read
followed the last change, the UI explicitly reports that verification is missing.
Readback is evidence, not a mechanical proof of semantic correctness.

## Context and authority

The service is installed by essentials and reached through IoC. It is a decision
service, not a chat model. Its endpoint is
`https://openrouter.ai/api/alpha/decisions`, using the existing OpenRouter key
and provider-routing preferences. There is no extra SDK dependency.

Jev mode requires Jev Latest to be added and enabled in the provider picker,
an enabled OpenRouter account and worker, and the OpenRouter hive read grant.
The picker resolves Jev's per-model metadata when the general catalogue omits
it. Jev is decision-only and cannot be selected as a chat worker. Its Test
action sends a small synthetic fixture and displays returned tokens and cost.
It does not forward a local, bridge, peer,
or other vendor's conversation. Every request/evidence/plan field must already
occur in the current OpenRouter exchange; doctrine must be a verbatim part of
its system instructions. The service neither walks the hive nor resolves sigs.
Disabling access during a call discards its result.

The judge receives the request, the verbatim doctrine section of the anatomy,
the read receipts accumulated since the last write, and the proposals. It does
not receive the full conversation or all hive context. After a successful or
partial write, old evidence is dropped and the worker reads the new state.
Snapshots are checked before and after decisions and immediately before action.

## Budgets and provenance

- At most three network decisions per worker turn, within the existing ten-round
  worker limit. There are no automatic retries or hidden fallback model calls.
- Twenty-second request timeout; cancellation follows the worker turn.
- At most 24,000 characters of state per call; cumulative decision-state
  characters per turn are bounded by the OpenRouter read budget (24,000 by
  default). These are character/disclosure bounds, not exact token counts.
- Reusable request, doctrine, evidence, proposal content, reasons and answers
  are separate immutable resources referenced by signature in manifests.
  Inline context exists only in the transient API packet. The result references the
  packet signature; its own signature is recorded in the turn's existing read
  provenance. Provider usage, returned model and cost enter the attempt ledger.
- Exact packets can reuse a successful evaluation within the same turn, keyed
  by their source signature including requested model and rubric version, after
  checking current access and snapshots. No completed decision survives as a
  reusable cache across turns: the latest alias can move.
- Hive projections keep their existing signature/version invalidation rules.
  Nothing here mints an optimization-phase cache or changes hive truth.
- Each completed Jev turn reports worker and Jev input/output tokens separately.
  Missing provider measurements are unavailable or partial, never guessed.

Initial automatic gates: fit >= .90, rules >= .95, evidence >= .90. For multiple
options, Choice confidence >= .85, winning probability >= .85, and margin over
the runner-up >= .20. These are conservative starting rules, NOT measured hive
success probabilities. Evaluate participant corrections and outcomes before
adjusting them; model updates behind the latest alias can change behavior.

## Scope and validation

This integrates direct OpenRouter chat work. Bridge agents and other providers
retain their existing flow. It does not silently grant new data access, deploy
the application, or claim that an API call was tested with a live account.

Regression tests cover typed-response validation, unknown options, missing
evidence, confidence gates, source boundaries, access revocation, cancellation,
proposal parsing and participant questions, and force-review persistence.

Official protocol references (checked 2026-09-20):

- [OpenRouter Jev latest](https://openrouter.ai/~typesafe/jev-latest)
- [OpenRouter evaluation transport](https://github.com/OpenRouterTeam/ai-sdk-provider/blob/main/src/evaluation/index.ts)
- [TypeSafe primitives](https://docs.typesafe.ai/primitives)
- [Confidence](https://docs.typesafe.ai/confidence)
- [Known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
