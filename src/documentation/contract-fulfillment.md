# Contract Fulfillment — asks from anywhere, answers as layers

**Status: DESIGN (Jaime + Claude, 2026-08-03). Not built.**
Companions: `meaning-loop.md` (the `ai:request` record this extends),
`sync-paired-channel.md` (the verb vocabulary and brood/audit model this
borrows), `host-ai.md` (the immediate tier this deliberately is NOT),
`signature-system.md` (expansion doctrine), `feedback-channel.md` (the
ask-gate).

## The goal, verbatim

> "You might ask a request from anywhere that's not the host and the host
> can field those requests if I allow them. That way we can make changes
> and I can send a new layer to resolve and post the changes. … like you
> have a contract and you send out the request, Claude Code does it, they
> send back the JSON results that fit the contract."

Three tiers now, deliberately different animals:

| | **Host AI** (`/ask`) | **Bridge** (`/opus` …) | **Contract fulfillment** (this doc) |
|---|---|---|---|
| Where the work runs | Operator's worker | Home Claude Code, loopback | Home Claude Code, reached by **polling** |
| Ask from anywhere? | Yes | No — localhost tab only | **Yes** |
| Can it write the hive? | No — read-only | Yes, directly | Yes — but only as a **proposal** |
| Result shape | Prose stream | Notes / tiles | **Contract-validated JSON + a brood layer** |
| Latency | Sub-second | Agent turn | Async — minutes, or whenever the session wakes |

The bridge stays the loopback fast path. This tier exists for every ask
that starts where the bridge can't reach: a phone, hypercomb.io, another
machine, another person you've allowlisted.

## Why not a socket (measured, 2026-08-03)

The obvious transport — let the production tab dial `ws://localhost:2401`
— was tested from live hypercomb.io in Edge and **hangs by design**: TCP
connects, then Private Network Access silently refuses the upgrade and the
WebSocket sits in `CONNECTING` forever. No error, no close. The localhost
gate in `claude-bridge.worker.ts` (`#isEnabled`) is not caution; it
short-circuits a hang. Loosening it is not on the table.

The inversion that works: **the request is content, so it travels as
content.** Mint a sig-addressed record, push it to the host, and let the
home session poll the host. Neither end ever dials the other — so a phone
on mobile data needs no inbound reachability, and neither does the session
behind your NAT. Same shape as everything else in the system: append a
record, someone who cares drains it.

## The records (all signature-addressed)

### 1. `contract` — a first-class hive object

The contract is NOT a convention inside a prompt. It is a resource,
stored once, referenced by sig, publishable, forkable, adoptable:

```jsonc
// put-resource → contractSig
{
  "v": 1,
  "name": "journal-entry-extraction",
  "describe": "…one paragraph of prose intent — read by the fulfiller…",
  "result": { /* JSON Schema for the result body */ },
  "delivery": "layer" | "json" | "both",   // what fulfillment produces
  "limits": { "maxTiles": 50, "maxBytes": 262144 }   // proposal ceilings
}
```

Same contract → same sig → same meaning everywhere. "Did this validate
against `c9d0…`?" is a real question with a real answer. A community can
converge on shared contracts the way it converges on shared modules.

### 2. `ask` — the request, extended

The remote ask is the existing ask/`ai:request` shape (meaning-loop.md
§3) with two additions and one hard rule:

```jsonc
// put to the host heap → askSig; announced on the channel
{
  "v": 1,
  "kind": "ask",
  "target": "revolucion/journal",       // where the answer belongs
  "prompt": "…the request…",
  "contractSig": "<sig>",               // REQUIRED on the remote path
  "contextSigs": ["<sig>", "…"],        // context rides as sigs, never inline
  "model": "opus",                      // advisory hint, as today
  "status": "pending",                  // pending → claimed → fulfilled | declined
  "askedAt": 1789338000000,
  "asker": "<pubkey>"                   // who signed it (NIP-98 envelope)
}
```

**`contractSig` is mandatory off-device.** On the loopback bridge a bare
conversational ask is fine — you are at the machine, you see what
happens. A request arriving from anywhere is untrusted input *even when
it is nominally yours*: the executing session treats the prompt as data
describing what to fulfill, never as instructions to obey. A typed
result surface is a far narrower attack surface than "do what this
says." Asks without a resolvable contract are declined, not improvised.

### 3. `fulfillment` — the answer

```jsonc
// put to the host heap → fulfillmentSig
{
  "v": 1,
  "kind": "fulfillment",
  "askSig": "<sig>",
  "contractSig": "<sig>",               // what the result was validated against
  "result": { /* body conforming to contract.result */ },
  "proposalLayerSig": "<sig> | null",   // when delivery includes "layer"
  "validated": true,                    // schema pass/fail — see Safeguards
  "note": "…anything the fulfiller must say in prose…",
  "fulfilledAt": 1789339000000,
  "fulfiller": "<pubkey>"
}
```

### 4. The proposal layer — resolve is not apply

"Send a new layer to resolve and post the changes" is two verbs, and the
safety lives in the gap between them. The returned layer arrives in
**brood state** (sync-paired-channel.md): bytes present, facade only,
**nothing materialized**. Applying it is a user act — an explicit adopt
that commits through the normal path (`commitLayer`, one layer per
change), so the proposal lands with full history, undo, and provenance.
Decline discards bytes and nothing else; the hive never moved.

The inbound ask is just a question — low stakes. The outbound layer
mutates your hive — that is where "if I allow them" actually applies.

## Transport

What ships today: the blossom-worker heap (NIP-98-signed PUTs, GRANTS
quota) and the swarm relay transport (`sharing/swarm.drone.ts`, `3020x`
kinds). Build on those; add nothing structural:

- **Bytes** (contract, ask, context, fulfillment, proposal layer) go to
  the host heap as ordinary sig-named content. Context is signatures,
  never inline bytes — the doctrine already holds on `/ai/ask` and holds
  here.
- **Announcements** ride the relay as two new verbs in the
  paired-channel vocabulary — `ask` (`layer`-tag = askSig) and `fulfil`
  (`e`-tag = ask event, `layer`-tag = fulfillmentSig). Events carry sigs
  only; unknown verbs are ignored by everyone else, forward-compatible
  by default.
- **The fulfiller polls.** The home Claude Code session (the
  `bridge-listen` / `watch-asks.cjs` posture, grown a remote ear)
  subscribes to the channel, sees an `ask`, pulls the sigs from the
  heap, works, pushes the fulfillment, announces `fulfil`. When the
  session is asleep, asks queue — async is the contract, not a failure
  mode.
- **The asker polls the same way.** Any surface that can reach the host
  can render "pending → fulfilled" — the phone shows the pill exactly
  like the command line does today off `ask:queued`.

## Safeguards

- **Allowlist first.** The host accepts `ask` records only from pubkeys
  the operator has admitted (the `AI_WRITERS` pattern, and the
  paired-channel `admit`/`revoke` verbs when channels land). "If I allow
  them" is a list you edit, not a mood.
- **Identity is the NIP-98 envelope** already used for byte writes —
  schnorr-verified, method+URL+freshness bound, no secret on the wire.
- **Schema-valid is not correct.** Validation proves the *shape*; a
  confidently wrong answer validates as cleanly as a right one.
  `validated: true` is gate one. The brood adopt — your eyes, or
  auditor pheromones when the audit vocabulary ships — is gate two.
  Neither substitutes for the other.
- **Prompt text is data.** The fulfilling session executes the
  contract, not the prose. Anything in an ask that reads as an
  instruction to the session ("also run…", "ignore the contract…") is
  quoted back in the fulfillment `note` and otherwise ignored.
- **Ceilings everywhere.** Contract `limits` cap the proposal; heap
  quota caps bytes; per-pubkey daily ask counts cap spend of the
  fulfiller's attention. Same anti-abuse doctrine as the byte quota.
- **Append-only stays sacred.** Status transitions re-mint and replace
  (`replaceKind`); every prior state stays reachable through markers.

## Where it degrades (named on purpose)

Contract fulfillment is excellent for closed-form asks — fill these
fields, classify these tiles, extract this structure, produce this
manifest. It gets thin for open-ended authoring, where the valuable part
of the answer is precisely what you couldn't specify in advance. Those
asks stay conversational: loopback bridge when you're home, ask-gate
questions when you're not. Do not force a schema onto work that doesn't
have one; do not let schemaless work onto the remote path.

## Rollout

1. **Contract + fulfillment records** — shapes above, minted and
   validated by the fulfiller side first (`scripts/bridge/` drain grows
   a `contractSig` branch). Loopback only; proves the validation gate.
2. **Heap lane** — asks/fulfillments as host-heap content, polled by
   both ends. First remote ask from a phone lands here.
3. **Brood proposals** — `delivery: "layer"`, the adopt/decline surface
   in the app (the share-availability gate pattern already fits).
4. **Channel verbs** — fold `ask`/`fulfil` into the paired-channel
   vocabulary when that spec builds, inheriting `admit`/`revoke`/audit
   for free.

Each stage is useful alone; none blocks the previous.
