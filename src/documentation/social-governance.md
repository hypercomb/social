# social governance -- how we stay human (live-only)

hypercomb is built on presence, consent, and recognition. there are no feeds or profiles; governance is social and local by design.

---

## principles

- **presence = permission** -- only bees here now receive steps. in the architecture, drones must be in the `Active` state to participate; disposed drones lose all effect subscriptions immediately (see [core-processor-architecture.md](core-processor-architecture.md)).
- **consent to link** -- you choose who can follow you. linking is always mutual and revocable.
- **recognition over accounts** -- unique avatars, not login reputations. identity is content-addressed via `SignatureService` (sha-256 hashes), not usernames or credentials.
- **no network by default** -- nothing crosses the network unless you explicitly publish. locally, everything you author is content-addressed and durably versioned in opfs (per-lineage sigbags and sig-named content files at the opfs root; legacy `__x__` dirs only drain). the effect bus is stateless (last-value replay, stores nothing permanently). the nostr mesh relays plaintext json frames (the `x`-tag sig is visible; aead encryption is future work) and keeps nothing locally beyond a ttl cache.
- **local first** -- safety actions are local to you; communities add rules by policy. opfs (origin private file system) keeps your meadow log on your device and never crosses the network without your explicit action.

---

## roles in a session

- **driver** -- emits 1-byte steps; chooses who can link. the driver is a drone in the `Active` state whose `heartbeat()` produces navigation effects on the effect bus.
- **linked bees** -- co-navigate by consent; can unlink any time. unlinking calls `markDisposed()` on the linking drone, which transitions it to `Disposed` and triggers effect bus auto-cleanup -- no ghost signals persist.
- **witnesses (optional)** -- additional bees who co-sign a published path. witness attestation is specified in the trail capsule format (see [trail-capsule.md](./trail-capsule.md)).

---

## pheromones (soft signals, not scores)

pheromones are ephemeral hints carried in the `pp` bits of each instruction byte, not stored rankings. the effect bus delivers them as typed effects to present drones only.

| pheromone | bits | meaning |
|-----------|------|---------|
| neutral   | `00` | no signal |
| happy / beacon | `01` | positive hint |
| caution / avoid | `10` | warning |
| treasure / priority | `11` | something worth attention |

when a drone disposes, its pheromone effects are cleaned up automatically by the effect bus. pheromones never accumulate into scores or reputations.

---

## safety tools (local + tiny)

all safety actions are local to you. they do not require consensus, moderation queues, or server round-trips.

- **unlink** -- severs the link. in the architecture, this is `markDisposed()` on the relevant drone, which transitions its state to `Disposed` and removes all effect subscriptions. the unlinked bee simply ceases to receive your steps.
- **mute** -- stop rendering a bee's pheromone effects locally. the muted bee is unaware.
- **ignore (local blocklist)** -- content-addressed signatures let you maintain a local ignore list without accounts. a sha-256 hash identifies the source; your client drops matching effects before they reach your drones.
- **micro-gesture check** -- rare, tiny human-presence proof (e.g., small pointer nudge) when behavior looks automated. no captcha, no profile, no stored result.
- **tempo guard** -- edge checks on step timing and jitter to deter bots. drones execute on a heartbeat cadence; unreasonable timing is naturally filtered by the sense/heartbeat cycle without profiling anyone.

---

## publishing a route (optional trail capsule)

by default, hypercomb keeps everything local -- your authored content is content-addressed and versioned in opfs, but nothing crosses the network. a trail capsule (bee synonym: waggle capsule) is the opt-in exception: a tiny path capsule that makes a route publicly reproducible.

- **trail capsules** with pluggable policy:
  - `0` -- creator opt-in (default)
  - `1` -- creator + cohort (n-of-m co-signatures from linked participants)
  - `2` -- community threshold (community verifiers co-sign per local rules)
- capsules are content-addressed via sha-256. `SignatureService.sign` is the one hash primitive hypercomb signs everything with; `PayloadCanonical` is a bee-payload-only helper (`structuredClone` + `JSON.stringify`, no key sorting) and is **not** the module-artifact path.
- distribution over the nostr mesh routing on the capsule's commitment hash as the subscription key is **aspirational -- not built as of writing**. the current broker mesh carries layer **sigs only**; bytes are fetched on demand over http-direct from operator hosts. mesh events are ttl-backed and auto-expire.
- publication is a gift, not an obligation. opfs logs remain local unless you explicitly publish.

for the full capsule format and verification flow, see [trail-capsule.md](./trail-capsule.md). for the content-addressed artifacts that compose the hive (layers, deps, bees, resources), see [dna.md](./dna.md).

---

## norms of the road

- ask to link
- move with care
- signal honestly
- no scraping
- leave kindly

these are social norms, not enforced rules. the architecture makes them easy to follow: consent is structural (you must be present and linked), scraping is defeated by ephemeral effects and session-scoped presence, and leaving is always one `markDisposed()` away.

---

## community policy knobs

communities can tighten governance without changing the protocol. these are local configuration choices, not global settings.

- **invite-only join** -- restrict who can enter the hive session.
- **stricter tempo guard** -- lower jitter thresholds for bot deterrence.
- **attestation thresholds** -- require more co-signatures before trail capsule publication (policy `1` or `2`).
- **encryption-on by default** -- reserved in the trail capsule flags; communities could mandate encrypted instruction bytes for all published paths. (the mesh relays plaintext json today; aead encryption is future work.)

---

## incident playbook (no logs)

there are no moderation logs, no report queues, no admin panels. every response is local and immediate.

| situation | response | how the architecture helps |
|-----------|----------|--------------------------|
| unwanted follower | unlink / ignore | `markDisposed()` severs the link; ignore list uses content-addressed signatures |
| disruptive driver | unlink; session dissolves socially | disposing the driver drone removes all its effect subscriptions; linked bees naturally disperse |
| bot-like behavior | micro-gesture check | heartbeat cadence and tempo guard filter unreasonable timing without profiling |
| replay attempt | mesh dedup + replaceable-slot guards defeat it | the mesh dedupes repeated event ids via a ring buffer (cap 2048), prefers newer events by `created_at` per replaceable slot, and prunes stale items by ttl -- replayed frames are dropped or expire |
| harmful route | leave, do not co-sign the trail capsule | refusing attestation means the capsule cannot meet its publication policy; your local opfs is untouched |

---

## drone lifecycle and governance

the drone lifecycle directly enforces governance principles. the four states map to social standing in the hive:

```
Created --> Registered --> Active --> Disposed
```

- **created** -- constructed but not yet known. no effects, no presence.
- **registered** -- placed in the ioc container. visible but not yet participating.
- **active** -- has processed at least one heartbeat. fully present, emitting and receiving effects.
- **disposed** -- cleaned up. all effect subscriptions removed. this is the architecture's enforcement of unlink: `markDisposed()` is not a request, it is an immediate state transition.

a disposed drone cannot emit or receive effects. there is no "shadow presence" -- the effect bus auto-cleanup guarantees that ghost signals do not persist after disposal.

for the full lifecycle and communication model, see [core-processor-architecture.md](core-processor-architecture.md).

---

## identity without accounts

identity in hypercomb is content-addressed, not credential-based.

- `SignatureService` computes sha-256 hashes of content. the hash is both identity and proof. same content, same identity. different content, different identity.
- recognition is visual and social: unique avatars, movement patterns, pheromone habits. you know a bee by how it moves, not by a login name.
- nostr event signing (via nip-07 browser extension or fallback signer) provides authenticity for mesh communication without creating accounts.

there are no usernames, passwords, profiles, follower counts, or reputation scores.

for the full identity model, see [network-architecture.md](network-architecture.md) and [glossary.md](./glossary.md).

---

## summary

hypercomb governance is not a moderation system bolted onto a platform. it is a set of social principles enforced by architecture:

- presence gates access (drone lifecycle)
- consent gates linking (`markDisposed()` = unlink)
- ephemerality prevents accumulation (effect bus auto-cleanup, ttl-backed mesh)
- content addressing replaces accounts (`SignatureService`)
- local agency replaces central authority (all safety tools are local)

no feeds. no profiles. no scores. no admins. just bees, here, now.
