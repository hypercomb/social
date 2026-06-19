# Paired-Channel Sync — Design Spec

> **status: design — not built (as of 2026-06-18).** A receiver-centric, single-event sync protocol for sharing branches of a hypercomb tree; the §Status section below still admits "substrate implementation pending."

> **What actually ships today:** the swarm transport in `sharing/swarm.drone.ts` uses the multi-kind `3020x` model — `30200` layer slots, `30201` resource bytes (≤256 KB base64, `MAX_RESOURCE_BYTES`), `30202` hide, `30203` interest, `30204` presence, `30205` subscribe-request. The single kind `29010` used throughout this spec is the **legacy** paired-channel/show-cell kind (the swarm code's own comments call it "legacy 29010"); it survives only in the mesh allowlist for back-compat. This document's one-kind/verb-vocabulary design has not replaced that shipped model.

> A swarm-shaped sync protocol for sharing branches of a hypercomb tree across browsers and devices. One event kind, one verb vocabulary, receiver-centric trust, beehive metaphor end-to-end.

## TL;DR

- **Two participants pair a channel** by agreeing on a `(location, secret)`. The channel id is `hash(location || secret)`. Without the secret, you can't subscribe.
- **Every signal is one Nostr-shaped event** (kind `29010`) with a `type` tag and channel scoping. The protocol is a verb vocabulary, not a stack of kinds.
- **A host curates** (approves members, approves shares, sets bandwidth caps, builds nodes). Anyone — including the host — must request to share; the host approves.
- **A node is a curated bundle** of approved shares. Nodes enter `brood` state on publish: only structural facade is materialized on receivers, no body content yet.
- **Audit is receiver-centric.** The receiver decides which communities they trust. Audit events are pheromones — broadcast, aggregated, decayed. When enough distinct trusted communities have approved the layer, the receiver's facade emerges.
- **Audit happens at swarm speed.** Humans and AI auditors are pubkeys like anyone else, both members of trusted communities. Parallel scans, real-time emergence or danger-tagging.
- **Pheromones decay** (NIP-40 expiration). Stale audits don't accumulate forever; communities re-emit to keep their endorsement live.

---

## Roles

All roles are pubkeys. There is no enforced hierarchy in the protocol — only conventions about who emits which verbs.

| Role | What they do |
|---|---|
| **Host** | First to enable share for a `(location, secret)`. Curates membership, approves share-requests, sets caps, builds nodes. |
| **Member** | Joined a channel via host approval. Can request shares of their own branches; can pull approved shares. |
| **Auditor** | Any pubkey in a community trusted by some receiver. Emits approve/reject events for layer signatures. Humans and AI alike. |
| **Receiver** | Anyone resolving brood/active/revoked state for themselves. Computes verdicts using their own trusted-community set — no global verdict. |

A single pubkey routinely plays several roles in different channels.

---

## The single event

Every signal in the protocol is one event:

```
{
  kind: 29010,
  tags: [
    ['t', channelId],          // every event scoped to a channel
    ['type', verb],            // the verb vocabulary (see below)
    // optional, depending on verb:
    ['p', pubkey],             // addressee or subject
    ['e', refEventId],         // referenced event
    ['layer', layerSig],       // referenced layer signature
    ['danger', category],      // for type=reject
    ['expiration', unixTs]     // NIP-40 decay
  ],
  content: <JSON, schema defined by the verb>,
  pubkey, sig, created_at, id  // standard Nostr
}
```

Receivers do one thing: subscribe to events tagged with channels they care about, branch on the `type` tag, dispatch behavior. Unknown types are ignored — forward compatible by default.

### Verb vocabulary (v1)

| Verb (`type` tag) | Sender | Pheromone analog | Purpose |
|---|---|---|---|
| `announce` | host | Nasonov (orientation) | "the hive is here" — declares this channel exists, names the host pubkey, ships default audit policy |
| `join` | member → host | recruit | "I'd like to enter" |
| `admit` | host | acceptance | "yes, you're in" — `p=joinerPubkey` |
| `revoke` | host | repulse | "you're out" — `p=memberPubkey` |
| `share-request` | member → host | scout dance | "I'd like to share /location/branch — N tiles, M bytes" |
| `share` | host | recruit-trail | "approved — this branch is now offered to the channel; cap = X" — `e=shareRequestId, layer=branchSig` |
| `share-revoked` | host | trail-dispel | "this share is closed — cap met or pulled" — `e=shareEventId` |
| `pulled` | downloading member | footprint | "I downloaded this share" — `e=shareEventId`. Decrements cap. |
| `layer` | requesting member | substance | actual layer payload bytes for an approved share |
| `node` | host | brood pheromone | curated bundle: list of share event ids + name + description; published in `brood` state |
| `audit-needed` | host | scout call | "this layer needs eyes" — `layer=layerSig`, broadcast to subscribed auditors |
| `approve` | auditor | all-clear | "this layer looks good" — `layer=layerSig` |
| `reject` | auditor | alarm | "danger" — `layer=layerSig, danger=<category>`, content = explanation |
| `auditors` | host | identity-mark | publishes/updates host's suggested trustedSet for the channel |

New verbs are added by extending this vocabulary. They cost nothing — no kind allocation, no breaking change.

---

## Channel pairing

```
location = lineage path, e.g. "/howard"
secret   = arbitrary string, shared between participants out-of-band
channelId = sha256(location || ":" || secret)
```

Both ends compute the same channelId independently. Subscribing to `t=channelId` on the relay yields the channel's events. Without the secret, the id is unguessable; the relay never sees the secret.

**Encryption (optional, recommended for non-allowlisted relays).** Derive a symmetric key from `(location, secret)` and encrypt event content. The relay sees only opaque blobs. Kept out of v1 — local-relay scenarios don't need it. Add when the relay is shared.

---

## Membership

```
1. host enables paired-channel mode for (location, secret)
   → publishes {type: announce, pubkey: hostPubkey, content: {auditPolicy: ...}}

2. member enables same (location, secret)
   → reads existing announce, publishes {type: join, p: hostPubkey}

3. host approves
   → publishes {type: admit, p: joinerPubkey}

4. host can revoke at any time
   → publishes {type: revoke, p: memberPubkey}
```

A pubkey is a member iff there's a matching `admit` from the host AND no later `revoke` from the host. Each participant computes their own `members[channelId]` from observed events.

The first toggler becomes host automatically — see role determination logic in §Implementation.

---

## Sharing

```
1. anyone (including host) toggles share on a tile
   → publishes {type: share-request, layer: branchSig,
                content: {name, tileCount, byteEstimate, preview}}

2. host sees an approval modal: name, size, structure preview
   approves with optional cap (max downloads, expiration)
   → publishes {type: share, e: shareRequestId, layer: branchSig,
                tags: [['expiration', ts]],
                content: {cap: {maxDownloads}}}

3. requesting member's app fires publishSubtree
   → publishes {type: layer, layer: <eachLayerSig>, content: <bytes>}
   → also publishes resource events for non-layer blobs

4. all channel members see the share icon on the offer
5. members click to pull
   → app calls commitAsChild(branchSig) — one undoable layer commit
   → existing show-cell sync-request fills the bytes from relay
   → publishes {type: pulled, e: shareEventId}

6. host's app counts pulled events
   → when count ≥ cap, publishes {type: share-revoked, e: shareEventId}
   → icon hides on all members
```

**Symmetric** — host follows the same flow for their own shares. Self-approval is one click in the modal; the event pair (request + share) is still emitted, so the audit trail is uniform.

**Branch = layer signature is the DNA anchor.** A share is keyed by its `branchSig` — the merkle root of the shared subtree's layer tree — and replicates as `layer` events keyed by each layer's own signature (steps 1–3 above). This is deliberate and load-bearing: layers, dependencies, bees, and resources are the hive's [Distributed Network Artifacts](./dna.md) — content-addressed, immutable, composing upward so a parent signature is a function of its child sigs. Because identity *is* the signature, the same branch deduplicates across receivers and any peer can verify a pulled layer against the sig it asked for. The mesh distributes layer *sigs*; bytes follow by signature (today via the swarm `30200`/`30201` path, per the banner above). The route/navigation stream is a separate concern — see the [trail capsule](./trail-capsule.md).

---

## Nodes (curated bundles)

A node is a manifest referencing one or more approved share events:

```
{
  type: 'node',
  layer: nodeManifestSig,
  content: {
    name, description,
    state: 'brood',
    shares: [
      {shareEventId, name, layer},
      ...
    ]
  }
}
```

Members see a node as a single tile. Pulling the node = pulling each contained share, each respecting its own cap.

A node enters `brood` state on publish. See §Audit & Brood for emergence semantics.

---

## Audit & Brood

### Brood lifecycle

```
publish (state=brood)
   ├── facade tiles materialized on receivers (names, hierarchy)
   ├── no layer payloads pulled — body content stays gated
   └── visual: capped-cell overlay, dim colors, "pending audit" pip

receiver's threshold met (across distinct trusted communities)
   ▼
emergence (state=active for that receiver)
   ├── facade flag dropped
   ├── layer payloads stream in (via existing sync-request)
   └── tiles "hatch" — visual transition, content fills

receiver sees danger threshold met
   ▼
revoked (for that receiver)
   ├── facade hidden or replaced with warning overlay
   └── content stays gated; categories from danger tags surface in UI
```

### Receiver-centric verification

Trust is at the edge. There is no global "verified" verdict. Each receiver computes:

```
function verdict(layerSig, receiverPolicy):
  approvals := events where type='approve' and layer=layerSig and not expired
  rejections := events where type='reject' and layer=layerSig and not expired

  trustedCommunities := receiverPolicy.trustedCommunities  // list of channelIds
  for each event in approvals + rejections:
    auditor := event.pubkey
    eventCommunities := communities where auditor is a member
    intersect with trustedCommunities → counted communities for this event

  approveCommunityCount := distinct communities across approvals
  rejectCommunityCount := distinct communities across rejections

  if rejectCommunityCount ≥ receiverPolicy.dangerThreshold: return 'revoked'
  if approveCommunityCount ≥ receiverPolicy.approveThreshold: return 'active'
  return 'brood'
```

**Same layer can be `active` for Alice and `brood` for Bob** because they trust different communities.

### Communities are channels

A community is just another paired-channel. Its `members[]` set is its membership list. No new primitive — the channel mechanism doubles as the trust group mechanism.

### Receiver policy (settings)

```
auditPolicy: {
  trustedCommunities: [channelId, channelId, ...],
  approveThreshold: 1,        // distinct communities, not raw audits
  dangerThreshold: 1,         // distinct communities flagging
  selfTrust: true,            // do my own approvals count?
  inheritedFromHost: true     // start from host's suggested auditors, then customise
}
```

### Audit events as pheromones

| Property | Behavior |
|---|---|
| Broadcast | Events have no addressee — go to the relay, anyone subscribed senses them. |
| Aggregated | Multiple bees emit the same signal; receiver's threshold is sufficient density. |
| Categorized | `danger=<category>` tag mirrors distinct alarm chemistries (malicious, csam, spam, broken, etc.) |
| Decayed | NIP-40 `expiration` tag — stale audits drop out of the count automatically. Auditors re-emit to keep an endorsement alive. |

### Decay defaults

| Verb | Default expiration |
|---|---|
| `approve` | 30 days |
| `reject` | 7 days |
| `audit-needed` | 24 hours |
| `share` | matches cap policy (e.g. 30 days or until cap) |
| `node` (brood) | 7 days; re-publish to keep brood alive |
| `announce`, `admit`, `revoke`, `auditors` | no expiration (membership state) |
| `pulled`, `share-revoked` | 90 days (audit trail) |

### Swarm-speed audit

Auditors don't have to be human. AI auditors hold Nostr keypairs; they're members of trusted communities like anyone else; they emit approve/reject events. Each kind of community can specialize:

- `code-audit-bots` — AI static analysis, CVE scanners, malicious-pattern detection. Emit verdicts in seconds.
- `content-moderation` — humans + classifying AIs. Tag csam/spam/abuse.
- `editorial` — human curators for prose quality.

A receiver's `trustedCommunities` mixes them. With `approveThreshold = 2` over distinct communities, you might require *both* a code-audit-bot community AND an editorial community to weigh in before emerging a hive.

---

## Receiver facade behavior

When a receiver materializes a `brood` node:

1. Walks the manifest's `shares[]` recursively to build a tile tree.
2. For each tile in the tree, writes `0000` with `{facade: true, name, ...skeleton}`.
3. Does **not** subscribe to `layer` events for these tiles' sigs yet — only structural metadata is stored.
4. Subscribes to `approve` / `reject` events for the manifest's `nodeManifestSig` and each contained `branchSig`.
5. Continuously runs `verdict()` against current trust policy. When status flips:
   - `brood → active`: drops `facade: true`, starts pulling layer events, tiles hatch in UI.
   - `* → revoked`: surfaces danger overlay, blocks navigation into subtree.

`facade: true` is a *proposed* bootstrap-skeleton field. **Not built as of 2026-06-18** — neither [tile-properties.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/editor/tile-properties.ts) nor [show-cell.drone.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/show-cell.drone.ts) currently carries or reads a `facade` flag (the only `facade` occurrences in essentials live in the build `scripts/prepare.ts`). The intent is that the property store grow a skeleton flag and the renderer apply the capped-cell overlay when it is set; both still need to be wired.

---

## Implementation surface

### Substrate (~one file)
```
sharing/paired-channel.service.ts
  - channelIdFor(location, secret)
  - publishEvent(channelId, type, payload, extraTags?)
  - subscribeChannel(channelId) → AsyncIterable<event>
  - membersOf(channelId) — derived from admit/revoke events
  - verdictFor(layerSig, policy) — receiver-side trust evaluation
```

### Verifier dispatch (~one file)
```
sharing/verb-dispatch.drone.ts
  - subscribes to channels in user's joined-list
  - branches on type tag, calls handler
  - handlers are tiny: each is a few lines of state update or UI emit
```

### UX surfaces
```
share-icon (provider via IconProviderRegistry — when paired-channel mode on)
share-request-modal (host's approval prompt, preview + cap)
join-prompt-modal (host's join approval)
node-tile-overlay (brood: capped-cell visual, audit progress pip)
download-icon (on offered tiles)
trusted-communities-settings (manage auditor list)
```

### Settings additions
```
paired-channel: {
  enabled: false,
  channels: [
    { location, secret, channelId, role: 'host' | 'member' }
  ]
}
auditPolicy: {
  trustedCommunities, approveThreshold, dangerThreshold, selfTrust
}
```

### Role determination

When a participant toggles share on `(location, secret)`:

```
existing := events where t=channelId, type='announce'
if no existing:
  → I am host. Publish announce.
else if existing.pubkey == myPubkey:
  → I am rejoining as host (different device).
else:
  → I am joiner. Send join to existing.pubkey.
```

No manual role picker.

---

## Open questions / v2

- **Relay-side cap enforcement.** Cooperative-cap (client-published `pulled` events) is honest for local relays. Public relays may want server-side enforcement: relay refuses to serve a `layer` event whose `share` event has been revoked.
- **NIP-26 delegation.** Allow CLI or scheduled jobs to sign on behalf of a user without exposing the master key.
- **Member-to-member shares without host.** v1 routes everything through the host; v2 could allow direct peer shares within a channel, with the host informed but not required to approve.
- **Federated communities.** Importing another channel's member list directly: "I trust whoever the relational-intelligence channel admits."
- **Encrypted content layer.** Add encryption derived from `(location, secret)` so even relay operators can't read events.
- **Multi-relay routing.** Connect hives across relays so pheromones diffuse further.

---

## Glossary

| Term | Meaning |
|---|---|
| **channel** | A paired sync context, identified by `hash(location || secret)`. |
| **community** | A channel whose members are trusted to audit. Communities are channels — no separate primitive. |
| **hive** | A subtree of cells being shared through a channel. |
| **branch** | A specific subtree, identified by a layer signature. |
| **share** | An approved offer of a branch to a channel's members. Has a cap. |
| **node** | A curated bundle of shares, named, optionally with description. Enters brood on publish. |
| **brood** | State of a published-but-unaudited node. Receivers see facade only. |
| **facade** | The structural skeleton (names, hierarchy) of a brood node, materialized without body content. |
| **emergence** | Transition from brood to active when a receiver's audit threshold is met. |
| **pheromone** | A type-tagged event (approve, reject, scout-call). Broadcast, aggregates, decays. |
| **danger tag** | The `danger=<category>` tag on a `reject` pheromone. |
| **cap** | Bandwidth/usage limit on a share. Cooperative in v1. |
| **trustedCommunities** | Receiver's personal list of channelIds whose member audits count toward emergence. |

---

## Status

This is the design spec. Substrate implementation pending.

Pheromone metaphor isn't decoration — it's the protocol. One molecule (kind 29010), many shapes (verb vocabulary), broadcast diffusion, density-triggered swarm response, decay over time. Bees don't have specialized message kinds; they have signals that compose. Neither do we.
