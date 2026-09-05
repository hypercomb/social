# The sealed runner

> **STATUS 2026-09-04 — DESIGN. NOTHING HERE IS BUILT.**
> This document was written after a twelve-agent grounding pass in which four
> load-bearing claims were each assigned a skeptic told to refute rather than
> check. **All four were refuted.** What follows is the design that survived the
> refutation, not the design that was proposed. The proposal is preserved in
> §1 so the corrections have something to bite on, and each correction names the
> evidence that killed it.
>
> **Fact-checked by a second pass**: every claim below was re-derived from source
> by an independent checker that did not see the reader which produced it.
> **14 of 14 survived; none was refuted; twelve needed a correction**, and those
> corrections are folded in. Two of them changed the substance and are marked
> **[corrected]** where they appear. An overstated hazard is as damaging as a
> missed one.
>
> House style here is annotate-never-delete, as `collapsed-compute.md`
> demonstrates. Nothing below edits an existing document; where this design
> contradicts one, it says so and says which is right.

## 0. The question

A participant wants work done by a machine they do not own. Send it what it
needs, let it run, take the result, destroy the runner.

The attraction is not performance. It is that **a runner holding nothing of
yours needs no authority policy** — there is nothing to be authorized against.
That is capability by construction, and it is strictly better than the
capability-by-policy we shipped in `machine-admission.ts`, because policy has to
be kept correct and structure does not.

That intuition is right. Almost every mechanism proposed to realize it was
wrong.

## 1. The proposal, as stated

1. The runner is **sealed** — no network egress of its own.
2. The participant **pre-computes the closure** of signatures the job needs and
   pushes it in.
3. The result returns **as a signature**, and adopting it is a separate,
   deliberate, local act.
4. Honesty is checked by asking **k runners** and comparing
   `(input, function, output)`.
5. Because the runner holds nothing of the participant's, **no per-verb
   authority policy** is needed inside it.

Point 4 is not new. It is already ratified doctrine in its weak form, and the
weak form is the only one available:

> **Content addressing gives detectable, attributable disagreement. It does not
> give verifiable computation.**
> — `hypercomb-communication-layer.md:1059`

## 2. What was refuted

### 2.1 "Sig-only egress is a negligible channel" — FATALLY WRONG

The proposal's fallback, for jobs that cannot be pre-fed, was a resolver
answering only `GET /<sig>`: to leak X you must already know X's signature, and
you only know a signature if you already had the content.

**The premise is a category error.** The host observes a string. It does not
require the string to be the hash of anything. `GET /<64 hex>` is a **256-bit
attacker-chosen field per request, in plaintext, in the request line, to a party
the threat model already assumes is colluding.** A runner that has seen a
32-byte secret emits it directly as the path. No encoding, no codebook, no
possession.

It is not even a novel abuse. **Hypercomb's own discovery model is "request a
signature you cannot possess the content for"** — `sign(meaning)` is sha256 of a
short human word, and `pools-across-hosts.md:39` states the property outright.
The spec fixture is literally `sha('coffee')`.

Three findings make it worse:

- **A miss is not one GET to one host.** It escalates to a signed, world-readable
  nostr broadcast carrying the 64-hex as a tag. Every relay sees it.
- **The canonical content endpoint serves 200 for an arbitrary trailing path
  segment** after the signature, and the relay strips a query string before
  routing but does not reject it. Both are unbounded attacker-chosen fields that
  land in access logs.
- **The cache policy is inverted with respect to the threat.** Held content is
  `immutable, max-age=31536000` and may never touch the network; the *misses* —
  the exfiltration traffic — are what reliably reach the host.

Even the strongest repair (whitelist only signatures already in the pushed
closure) does not reach negligible: the **order** of N legitimate fetches carries
`log2(N!)` bits.

**Correction: the runner has no socket.** Not a narrow one — none. This costs
nothing, because point 2 already made fetching redundant; the fallback existed
only for jobs point 2 could not serve, and §2.2 gives those a better answer.

### 2.2 "The closure is pre-computable" — WRONG AS STATED

There is no such quantity as "the closure of a signature" in this tree today.
**Eight distinct closure walkers exist with mutually incompatible definitions of
what a record's children are** — blind hex-mining, JSON-only descent, typed edge
fields, structural `cells`-only, key-scanning GC, and two private copies. They
disagree in ratcheted, documented ways: `resource-closure.spec.ts:72` asserts as
*correct* that a 64-hex run inside PNG bytes must not be followed, while
`replication-walker.ts:64` mines every 64-hex run out of any record.

The one honest enumerator, `collectActiveGenome`, produces exactly the artifact a
runner wants — a kind-tagged inventory plus a `complete` bit and a named
`missing` list. But **it re-resolves each child through the local lineage head
map by tile NAME**, preferring the location's latest marker over the carried
child signature, because under leaf-only commit the carried signature is stale by
design. **[corrected]** The carried signature is not bypassed — it is read first
and is load-bearing, because it is the only source of the child's *name*. The
consequence is unchanged and is what matters:

> The closure is a function of **(root sig, local head map, names)** — not of the
> root signature.

And enumeration stops dead at eight hop kinds: binary atoms, oversized records,
sealed atoms, pool-addressed content, molecule/facet heads, name-derived
addresses, participant-local behavior enablement, and bees (which `adopt`
deliberately skips). The `missing` list **under-reports**, because nothing beyond
a hole is ever visited.

Whole job shapes are unservable by pre-feeding at all:

- **Search** does not follow signatures — it derives a location signature per
  candidate path and reads that location.
- **Any job addressed by a name.** `sign(name)` is a global molecule address
  every tenant writes into, resolved across per-author-key bags. The molecule
  model **retires sealing** precisely because names make the graph general.
- **A pool that is a union across community hosts** — the wire contract
  separates `/<sig>` (a file, one closure forever) from `/<sig>/` (a directory,
  open by construction).
- **References are saved rules**, recomputed on demand and deliberately never
  committed, so there is no committed set to enumerate.

**Two corrections.**

**(a) The job's input is a signed inventory, not a root signature.** The
participant enumerates locally, canonicalizes, signs that enumeration, and the
receipt's `inputSignature` is the inventory's signature. This also repairs
point 4, which silently assumed a single input signature exists.

**(b) A miss protocol replaces the fetch capability.** The runner is sealed and
may **halt** and return a demand list of signatures it wanted and did not have.
The participant decides whether to feed them and re-run. This converts an
unbounded egress capability into a **bounded, participant-mediated, auditable
loop** — the runner can still ask, but it can only ask *the participant*, who is
free to say no and can see exactly what was asked and in what order.

The miss protocol is the single best idea to come out of the refutation, and it
exists only because the egress channel was killed first.

**(c) Open-set work stays home.** Search, name resolution, and pool union are the
participant's half. A runner receives a frozen generation and computes over it;
it never resolves a name.

### 2.3 "No per-verb policy is needed inside" — WRONG, AND ALREADY DISPROVEN IN-TREE

**A public runner already exists here, and it already needed a policy.**
`PeerModelsDrone` ships, self-registers on every shell load, and lets a host
answer a stranger's prompt on its own machine — restricted to its **keyless
local** models. **[corrected]** It is governed by *two separate* flags, both
defaulting off and easy to confuse: lending is `hc:llm:peer-offer` on the host
side; `hc:llm:allow-peers` is the *asker's* flag and only blocks an automatic
pick — a pinned or explicitly named peer still routes. That two flags with
opposite subjects were needed for one feature is the point: authority here did
not stay simple, and it did not stay in one place.

Three further failures:

- **Sealing turns a network-scope verb into silent partial execution and a lying
  receipt.** `/hide` declares `reach: 'editing', scope: 'network'`; it writes a
  local list *and* emits a signed mesh event. Sealed, half of it runs and the
  receipt says it succeeded.
- **Disclosure survives sealing entirely.** Reads are the disclosure channel, and
  the participant's closure sits in plaintext on a machine they do not own —
  `content-cipher.ts` is a complete convergent-encryption primitive with **zero
  callers outside its own spec**.
- **Attribution is free to forge.** `NostrSigner.resolveSecretKeyHex`
  (`nostr-signer.ts:123`) mints a fresh `crypto.getRandomValues` 32-byte secret
  on a miss and persists it to `localStorage`; when that write throws it keeps
  the key **in memory instead**, so a refused persist makes an identity cheaper
  still. Only a NIP-07 extension skips the mint. A Hypercomb identity is an
  unattested keypair, so counting distinct pubkeys proves nothing: k-of-n against
  self-minted identities is **k copies of one adversary**. Point 4 needs
  identities that cost something, or it is theatre.

**Correction: the runner executes no Hypercomb grammar.** It is a pure
byte→byte function over the pushed inventory — no behaviour census, no verb
dispatch, no `Store`, no IoC. *That* is what makes "no policy inside" true.
Sealing alone does not, and this also reconciles the design with the standing
boundary at `hypercomb-communication-layer.md:902`: *"No remote execution of
grammar. No host runs a behaviour, holds a session, or accepts a command line."*
The sealed runner does not violate that line. A runner that ran grammar would.

### 2.4 "Adopting the result is one deliberate act" — WRONG, AND IT IS A LIVE HAZARD TODAY

This is the finding with consequences beyond the design.

**`content:wrote` fires by default from `Store.putResource` (`store.ts:836`,
`:902`) and `HistoryService.commitLayer` (`history.service.ts:1141`)** — the emit
predicate inspects nothing but its own suppression flag, and never filters on
kind, provenance or authorship.

**[corrected] `{emit: false}` is a `putResource` option only. `commitLayer` takes
no options object at all**, so a layer commit's emit cannot be suppressed at any
call site on the current tree. The emit is skipped only on a content-address
dedupe hit or the preview guard. This matters below: correction 1 is not a
call-site change, it is an API change.

On the current tree:

| subscriber | gate |
|---|---|
| `PushQueueService` | **no policy gate** — no opt-in, no filter on kind, provenance or authorship. Every `content:wrote` sig gets a full byte copy written to `sign('push')/{sig}.{kind}`; the only short-circuits are a 64-hex shape test, an existing-receipt skip, and a silent no-op before Store has an OPFS root. **[corrected] It is not inert on disk** — that write lands on every commit *today*, and nothing in the tree reads, prunes or GCs the pool, so local content duplicates without bound. Inert only as to the network: `globalThis.__sentinelBridge` is read at nine sites and **assigned at none**. `drain()` is kicked on every enqueue, at load, and again 20 s later, so the backlog goes out the moment a bridge appears. |
| `HostSyncService` | gated overall (`#anyEnabled()` fronts the handler) — but the self-domain target is built `{ publicOnly: false }`, and the drain's only per-sig gate is the public-only one. So with `hc:host-sync:enabled` on and a self-domain set, entries of **every** kind are signed-PUT to the self-domain with no `.public` marker required, and a layer write drags its whole transitive ref closure into the queue. |
| `PassiveReplicationQueue` | enqueues durable intent on every head change regardless of gate, and drains the moment the participant opts in. |
| `FeedbackChannelDrone` | publishes `feedback`/`qa`/`qa-answer` records to a fixed community-wide channel — a **channel id, not a relay URL** — **by default, with no opt-in and no UI showing the role is active**. Gated only on record kind and on not visiting another hive; the sole off switch is an undocumented `hc:feedback-channel:enabled='false'`. |

Plus: swarm auto-publish fires on `cell:added`, which a commit's post-commit
reconcile emits; and **bytes land before the deliberate act, not after it** —
deciding whether a branch carries code first runs an adopt in inspection mode,
which persists the layer closure into OPFS.

> "Publishing is an act, never a side effect" is stated doctrine
> (`vocabulary-claim.md:130`). **The write is the act that arms every downstream
> sender**, and several of those senders fire later, on a gate the participant
> flips for an unrelated reason.

**The narrow claim does survive, and more strongly than it was stated.**
*Adopting a layer cannot transitively load or execute bees.* Three independent
reasons: the byte walk deliberately skips the `bees` slot (`// skip — installed
package content`), and both adopt and sync pass `layersOnly: true` so the
resource phase never runs at all; **no production path anywhere fetches a bee by
signature**; and `ScriptPreloader`, the only thing that imports bees, takes its
roots from the **install manifest**, never from user-content lineage.
`adoptResolvedBranch` does fail closed on an unresolvable code sig — returning
`'uninspectable'`, not `'unavailable'`. This is the one part of the original
design the code already supports.

**Correction — preconditions on adoption, all of which are work that does not
exist yet:**

1. Adoption writes without emitting, and re-marks provenance as foreign. **This
   is an API change, not a call-site one** — `commitLayer` has no suppression
   parameter, so one must be added before an adopted layer can land quietly.
2. `PushQueueService` acquires a gate. It is the only ungated subscriber.
3. Swarm auto-publish ignores `cell:added` originating from an adopt.
4. The runnability gate keys on **provenance, not tree position** —
   `isForeignContent` currently returns false for anything outside a marked
   adopted root.
5. The pre-consent inspection walk does not persist.
6. The result graph is budgeted by a cap **the participant sets for this job**,
   not the ambient `DEEP_RESOURCE_LIMIT` of 50,000 — the runner authored that
   graph and the adopter walks it.

## 3. The design that survives

```
participant                                  runner (no socket)
───────────                                  ──────────────────
enumerate locally  ─────────┐
canonicalize + sign         │
  = inventorySig            │
                            ├── push closure bytes ──▶ [ sealed ]
declare functionSig ────────┘                          pure byte→byte
                                                       no grammar, no Store
                            ◀── halt + demand list ──  (miss protocol)
decide, feed, resume  ──────▶
                            ◀── resultSig + receipt ─
compare across k runners
adopt deliberately, {emit:false}, provenance=foreign, budgeted
```

**Invariants:**

- **No socket.** Not narrow egress. None.
- **No grammar.** The runner has no verb vocabulary, so there is nothing to gate
  and nothing to half-execute.
- **Input is a signed inventory**, not a root signature. The closure is not a
  function of a signature and must not be described as one.
- **Misses halt.** The runner may ask, but only the participant, and the asking
  is visible.
- **Adoption is a single narrow door** — and that door does not exist yet; §2.4
  lists what it costs.
- **Regime declared.** This is the **labor market**, not the memo table.
  Collapsed compute is sound as a memo table and unsound as an oracle. Runner
  results must therefore be **structurally distinguishable** from
  collapsed-compute markers and must never be merged into that pool: a forged
  `authenticity → garbage` marker is byte-indistinguishable from an earned one.
- **Honesty is bounded.** Detection and attribution only. Attribution requires
  identities that cost something; until then, k-of-n is sybil-trivial and must
  not be cited as a safety property. And note that **a runner returning the
  correct output while exfiltrating in parallel passes every k-of-n check** —
  point 4 was never a mitigation for §2.1 and must not be counted as one.

## 4. What this design refuses

- **Verified computation.** Not available from content addressing, at any k.
- **A trust allowlist.** `SignatureStore.isTrusted` has **zero read call sites**
  and its allowlist is write-only: filled at install, persisted, restored
  unvalidated at boot, never read. There is no existing boundary to extend; six
  documents name one, and four of them have not been corrected.
- **Reusing the optimize-phase contract as a safety argument.** Its wording is
  almost exactly the contract that makes a cache record safe to accept from a
  stranger — but the safety comes from clause 3, *never load-bearing*. Adopting a
  result into the hive makes it truth and deletes that property at precisely the
  step this design needs.
- **Running the participant's behaviours remotely.** That is a different feature
  and it is already refused doctrine.

## 5. Adjacent findings that are not this design's problem, but are somebody's

Surfaced by the grounding pass; recorded here because they are load-bearing
elsewhere and nobody is watching them.

1. **`POST /replicate` turns the relay into an SSRF proxy for any authorized
   writer.** **[corrected — materially narrower than first written.]** The
   handler's first act is NIP-98 verification: the caller must hold a key whose
   pubkey the operator listed in `--writers` (unless started with the dev-only
   `--dev-open-writes`, default false, commented *"Never use on a public host"*).
   It is **not** open to the internet. But an authorized writer then supplies a
   root signature plus **1-16 caller-named HTTP(S) origins**, gets a `202`, and
   the relay fetches those origins in the background with **no host allowlist and
   no private-address filter** — a grep for ssrf/allowlist/loopback/169.254/
   private/ProxyAgent finds nothing. So it reaches the operator's internal
   network on behalf of anyone with write access. It is still the closest
   existing thing to a public runner, and still the opposite of sealed.

   **FIXED 2026-09-04 — `hypercomb-relay/address-guard.js`.** The destination,
   not the hostname string, is now screened: loopback, link-local (incl.
   `169.254.169.254`), RFC1918, CGNAT, unique-local IPv6, multicast and the
   unspecified/reserved ranges, plus the IPv4-mapped, IPv4-compatible and NAT64
   spellings of each. The screen runs in two places for two different reasons —
   at request time (`blockedSourcesReason`, so the caller gets a `400` naming the
   address rather than a job that silently returns nothing) and inside the
   socket's own name resolution (`guardedLookup` as the `lookup` passed to
   `http.request`), which is what closes the DNS-rebinding window a
   resolve-then-fetch check leaves open: the address the guard clears IS the
   address the socket connects to. Redirects are no longer followed at all —
   the fetcher moved off `fetch`, which followed a `302` into loopback and
   returned the internal server's body. `--replication-origins` is an optional
   exact-origin allowlist (empty = any origin surviving the screen) and an
   allowlisted origin is exempt from the address screen, because an origin the
   OPERATOR named is not the caller-chose-the-destination threat. Jobs are now
   bounded in three directions, not one: atoms, fetched bytes (2 GiB) and wall
   clock (10 min). `--allow-private-sources` (default off, dev only) is the sole
   way back to the old behaviour. Covered by `address-guard.test.js` and the SSRF
   case in `relay.integration.test.js`, which asserts the internal server is
   never called. **The unverified-`#verifyAndImport` finding (2) is untouched.**
2. **Bee loading executes network-delivered code with zero isolation** — OPFS
   bytes imported into the main realm via blob URL, with `window.ioc`, OPFS,
   `localStorage` (including `hc:nostr:secret-key`), fetch and the EffectBus.
   The one gate is "the bytes hash to their name", stated as sufficient by
   design. `dependency-loader.ts:150` defines `#verifyAndImport`, which strips a
   `.js` suffix, logs twice, runs `await import(alias)`, discards the module and
   returns `sig` unchanged — **nothing in it hashes anything or compares `sig` to
   the bytes it just loaded**. The name asserts a check the function does not
   perform.
3. **`ComputationDrone` ships and is registered**, records a peer's receipt into
   the local computation pool, and emits `computation:verified` on the strength
   of a **self-consistency hash** — while `deterministic-computation.md` says the
   layer is "design — not built".
4. **Nostr kind 29011 is hardcoded by two unrelated subsystems in three
   places** — `computation.drone.ts:62`, `meeting-signaling.ts:11`, and
   `hypercomb-relay/sfu.js:52`, which inlines the number rather than importing
   the meeting constant. There is no kind registry and no cross-reference.
5. **Three documented isolation claims are false in code**: `security.md`'s
   "three layers" of load-time verification; `isTrusted` as the trust boundary;
   and the visitor import-map's "sha256 gates the bytes" comment sitting directly
   above an unverified fetch→blob→import.

## 6. Order of work, if this is ever built

Nothing in §3 is safe to build before §2.4 is paid down, because the adoption
door is the one place a runner's output touches the participant. In order:

1. Gate `PushQueueService` — and separately, decide whether its unbounded,
   never-collected on-disk duplicate of all content is wanted at all. Give
   `commitLayer` a suppression parameter, then make adoption use it.
   Provenance-key the runnability gate. **All of this is worth doing whether or
   not a runner is ever built** — it is the standing "publishing is an act"
   doctrine, unenforced.
2. Settle the closure question: one walker, one definition of a record's
   children, or an explicit statement that closure is defined only over an
   inventory.
3. Give `ComputationReceipt` a signer, or stop calling the property
   "attributable".
4. Only then, a runner.

---

*Grounded against the source tree 2026-09-04 by a twelve-agent pass — eight
readers, four skeptics. Every file:line in this document came from that pass and
should be re-checked before being relied on; the tree moves.*
