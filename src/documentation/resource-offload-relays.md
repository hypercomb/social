# Resource Offload — Public Relays as Content-Addressed Edge Cache

Design for offloading resource bytes to public Nostr infrastructure with the
host transaction as the durable anchor. Status: DESIGN — prerequisite is the
`authored-sigs` gate (see below).

## Principle

Content addressing makes storage location irrelevant to integrity. Every
byte-ingest path already recomputes sha256 and discards mismatches
(ContentBroker `#acceptResponseBytes`, sentinel intake, swarm resource
ingest). A public relay therefore adds **zero trust risk** — a hostile or
flaky relay can only fail to answer, never lie. The two real constraints are
**privacy** (offload = irreversible publication) and **durability** (relays
prune; they are gossip, not storage).

Framing: the host is not the fallback — it is the **anchor**. Relays are a
breathing edge cache.

## Resolution chain

One new rung in the existing broker chain, same sha256 gate, never on the
render path (render-never-awaits-network holds):

```
memory → OPFS → live peers (swarm) → relay / blob server → host transaction
```

## Transport mapping

| Payload | Transport |
|---|---|
| Small hot resources (≤ 64 KB) | existing kind 30201 events — d-tag = resource sig, base64 content (33% inflation; current hard cap 256 KB) |
| Everything else (images, HTML, layer bytes) | Blossom-style blob servers: sha256-addressed HTTP, `GET /<sig>` — identical to our flat `<root>/<sig>` URL layout, so it slots into the fetchers' existing flat-URL attempt as an additional origin |

Relay/blob origin set rides the existing `use-live-relay` steering
(one flag, mesh + bytes together).

## Eligibility — authored ∧ public

Offload eligibility is COMPUTED, never assumed:

- **authored**: only content this participant minted. Requires landing the
  `authored-sigs` producers (currently a stub — `isLocallyAuthored` is not
  yet consulted anywhere). Never offload adopted/foreign content — the
  publisher's sig is authoritative and the publisher decides replication.
- **public**: only sigs inside the public lineage closure — the same
  closure `decoration-closure.ts` walks for push (payload sigs, htmlSig,
  nested refs). Excluded categorically: reference decorations, hidden
  records, participant-local pools (viewport, clipboard, threads,
  optimization/derived caches), private-world tiles.

Pheromone alignment: tags mark what is discoverable; the offload set is the
tagged-public closure. Guards act at identification/activation — reads of
sig-addressed bytes need no verification beyond the hash itself.

## Bookkeeping — pools, not localStorage

Mirror the push-queue pattern exactly (`sign('push')` / `sign('receipts')`):

- `sign('offload')` — queue: one record per (sig, destination-class),
  content-addressed member, survives reload, retries until acked.
- `sign('offload-receipts')` — receipt per confirmed publication, keyed by
  target sig (empty-file marker, same as host receipts; skip hash-verify on
  this pool, it is a ledger, not content).

Division of labour with the optimize phase (doctrine holds):

- Computing *which* sigs are eligible-but-unoffloaded is a pure derivation →
  MAY run in the optimize phase, producing queue records.
- The network push is an external side effect → belongs in the queue worker
  (like PushQueueService), never inside `optimize()`.

## Consent and irreversibility

First offload requires a one-time explicit consent moment: publication to a
public relay is forever — content-addressed bytes are enumerable by anyone
and practically un-deletable once mirrored (NIP-09 deletion is advisory).
Off by default; the existing swarm-consent posture applies.

## Attribution (optional hardening)

sha256 covers payload integrity end-to-end. Schnorr verification of inbound
relay events matters only for *attribution* (who published) — the audit's
open item on inbound `verifyEvent` applies here unchanged and is not a
blocker for byte transport.

## Hashing note

SHA-256 stays. Measured (WebCrypto, this machine): ~430 MB/s sustained on
large payloads, ~57µs fixed per-call overhead on tiny ones — noise next to
a single OPFS read. Switching (e.g. BLAKE3-WASM) would fork the identity
space, break dedup with every existing hive, and lose drop-in compatibility
with Nostr event ids and Blossom addressing, which are sha256 by spec. If
hashing ever shows up in a profile, the fix is hashing *less* (memoization —
already the pattern), not faster.

## Phases

1. Land `authored-sigs` producers + one-time lineage bootstrap (also closes
   the audit's path-keyed-trust item). — LANDED.
2. Add the relay/blob rung to ContentBroker behind `use-live-relay`, sha256
   gate unchanged; Blossom origin(s) configurable.
3. Offload queue + receipts pools; eligibility derivation (optimize phase)
   + queue worker (push). Consent gate in front. — **REALIZED via
   host-sync, not a new pool pair**: the `sign('host-push')` queue +
   `sign('host-receipts')` receipts (HostSyncService) already implement
   the queue/receipt ledger for both the self-domain and the public CDN
   (Blossom/R2 worker) targets, with `.public` markers as the eligibility
   gate. Building a parallel `sign('offload')`/`sign('offload-receipts')`
   pair would duplicate that machinery — the meanings stay reserved for a
   future relay-event (kind 30201) offload channel if one materializes.
4. Community mirroring: adopters who hold bytes announce as peer sources —
   free replication with integrity guaranteed by the primitive.

## Availability gate (share doctrine — BUILT)

"To share something in a swarm it already has to be available." Receipts
are the proof surface; the gate is their read side (all in
`host-sync.service.ts` + `swarm.drone.ts` + `invite.queen.ts`):

- `HostSyncService.isClosureAvailable(sig, kind, closure)` — a closure is
  available once EVERY sig in it (markPublic's exact traversal, read-only)
  holds a confirmed read-back receipt on at least one enabled host.
  Confirmed closures memoize permanently (bytes immutable, receipts
  accrue); misses re-check only when a new receipt bumps the epoch.
- Both announce surfaces (the kind-30200 publish walk AND the personal
  subscribe channel) HOLD BACK public children whose closure isn't
  available — and retract previously-announced slots — whenever a durable
  host is configured. With no host configured, mesh-only live sharing
  stays ungated (dev/test: two browsers over a relay, sharer online).
  `host:receipt` re-triggers the walk so held content announces the
  moment it turns durable.
- `/invite` refuses without hosting ("sharing requires hosting") and
  waits for the bundle's receipt (`ensureReceipt`) before declaring the
  link live.
- Receiver half: a fold whose layer closure fetched incomplete
  (`broker.adopt` failed>0) is never committed — deferred + retried
  (complete-or-defer, `swarm-adopt.drone.ts`), because `flattenLayerTree`
  would silently drop the unfetched branches from the committed copy.
