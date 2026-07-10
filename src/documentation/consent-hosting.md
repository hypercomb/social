# Consent Hosting — the mesh handshake for third-party byte hosting

**Status: DESIGN — pinned 2026-07-09. Not built.**

## Problem

The mesh is deliberately thin: it transports **layer sigs only** (tiny JSON
directories, ≤256KB on the broker channel). Resources — images, website pages,
game assets — travel exclusively via HTTP-direct `GET /<sig>` against operator
domains. That doctrine is correct and unchanged by this design.

The consequence: a participant who wants to *share* content must first have a
host serving their bytes. Operators have one (self-domain + host-sync). Casual
participants don't — their meta-layers propagate over the mesh, but every
resource sig 404s for other viewers unless the beta mirrors happen to hold it.
Sharing today therefore requires "go arrange hosting somewhere," which is the
single roughest edge in the sharing UX.

## Design: the consent-hosting handshake

A participant asks the swarm for hosting; a host operator gets a consent
prompt; acceptance unlocks the **existing** signed-PUT pipeline pointed at the
granting host. No new transport. Nostr WS stays the signaling channel, HTTPS
stays the byte channel. (Explicitly rejected: a SignalR/side-channel server —
it duplicates what the relay + HTTP already split correctly.)

Content-addressing makes this safe by construction: a host can store
strangers' blobs without vouching for them, because every byte a host serves
is sha256-gated at the reader (`ContentBroker.#verifyBytes`). A malicious
uploader can waste a host's granted quota — never corrupt a reader.

### Actors

- **Sharer** — participant with content committed locally (OPFS) and no host.
- **Host** — operator running the relay with an HTTP `/<sig>` endpoint
  (jwize.com shape: cloudflared tunnel → local relay, or any equivalent).

### Flow

```
sharer                         mesh                          host
  │  1. kind 20410 request      │                              │
  │ ───────────────────────────▶│─────────────────────────────▶│
  │                             │        2. consent toast      │
  │                             │           (accept/decline,   │
  │                             │            persisted)        │
  │      3. kind 30411 grant    │◀───────────────────────────── │
  │◀─────────────────────────────                               │
  │                             │   3b. relay registers writer │
  │                             │       grant (pubkey, quota,  │
  │                             │       expiry)                │
  │  4. NIP-98 PUT /<sig> ×N  (HTTP, not mesh) ───────────────▶│
  │  5. receipt = read-back GET 200 per sig  ◀─────────────────│
  │  6. domain attribution propagates via existing             │
  │     ['domain'] tags + §21.14 closure attribution           │
```

### Wire shapes (mesh)

Kinds continue the broker's 204xx/304xx neighborhood (in use today:
20400/30401/20402 broker, 30200 visuals, 30205 subscribe-request).

**REQUEST — kind `20410`** (ephemeral, broadcast on `BROADCAST_TAG`)

```
tags:    [['x', 'broker:fetch'], ['t', 'hosting']]
content: { "rootSig":   "<64-hex>",   // closure root being shared
           "files":     37,           // closure size (layers + resources)
           "totalBytes": 4390912,     // sum of byte lengths
           "label":     "my garden hive" }  // human copy for the prompt
```

The sig *list* deliberately does not ride the request (hundreds of sigs won't
fit and don't need to): the grant authorizes **pubkey + byte quota + expiry**,
not per-sig, because the PUT endpoint already enforces
`sha256(body) === url sig` (§21.12) — the quota is the only new thing the
relay must meter.

**GRANT — kind `30411`** (parameterized-replaceable; `d` = requester pubkey,
so a host's latest decision per requester is the one the relay caches)

```
tags:    [['d', <requester pubkey>], ['t', 'hosting'],
          ['p', <requester pubkey>],
          ['domain', 'host.example.com'],
          ['expiration', <secs>]]
content: { "quotaBytes": 8388608, "expiresAt": <epoch secs> }
```

A decline is the same event with `content: { "quotaBytes": 0 }` — persisted
like the subscribe-consent decisions so the host isn't re-prompted.

**No transfer events on the mesh.** Transfer success is proven the host-sync
way: a fresh `GET /<sig>` returning 200 *is* the receipt (never a bare PUT
200 — the deploy-pipeline silent-drop lesson, protocol-spec §21.11/§21.12).

### Transfer (HTTP — all existing machinery)

`HostSyncService` already implements exactly this pipeline against the
operator's own self-domain: `content:wrote` trigger → `sign('host-push')`
queue pool → NIP-98 (kind 27235) signed PUT → `sign('host-receipts')`
read-back receipts, crash-safe and FIFO. The extension is **multi-target**:

- Queue entries gain a target dimension: `sign('host-push')/{sig}.{kind}`
  stays the byte store; a granted-host record (domain + quota + expiry,
  itself a sig-addressed resource) tells the drain loop where to PUT.
- Receipts become per-(sig, host): `sign('host-receipts')/{sig}.{hostHash}`
  — existence = that host confirmed serving it. (Bare `{sig}` remains the
  self-domain receipt; no migration needed.)
- The sharer drains the **layer closure first, resources behind it** — same
  ordering as `adopt()` so the shared branch renders for others immediately
  and images sprout in.

### Relay-side grant enforcement

Today the relay verifies NIP-98 PUTs against a static `--writers` allowlist.
The grant adds a scoped writer class:

- The host's own client (the browser that clicked Accept) registers the
  grant with its relay via the same NIP-98 machinery under the host's own
  key: `PUT /@grant` carrying the 30411 payload. Relay stores
  `{pubkey, quotaBytes, expiresAt}` and decrements quota per accepted PUT.
- Expired or exhausted grants → 403; the sharer's channel goes quiet per
  host-sync's existing writer-auth backoff.
- Revocation is the host's unilateral right: drop the grant, optionally
  delete the bytes. Content addressing means nothing dangles — readers'
  cascades simply stop finding that host and fall back to any other.

### Propagation (zero new read-side code)

Once the granting host serves `/<sig>`:

- The grant's `['domain']` tag is fed to `noteDomainsForSig(rootSig, …)` on
  every observer, so adopt-clicks resolve immediately.
- §21.14 closure attribution does the rest: one layer fetch from the host
  attributes the host to every ref in the layer — the whole branch collapses
  to one known host without per-sig discovery.
- Cloudflare-fronted hosts edge-cache immutable `/<sig>` for free scale
  (see infrastructure.md; requires the extension-less-path cache rule).

### Consent UX

Reuse the subscribe-consent pattern verbatim (mesh event → drone → toast
with Accept / No thanks → persisted decision): a new small
`hosting-consent.drone.ts` bridging `swarm:hosting-request-received` to the
toast surface, with byte/file counts in the copy — *"jay me wants to store
37 files (4.2 MB) on your host — accept?"* Pre-decisions persist per pubkey.

## Relationship to existing designs

- **Generalizes** the beta mirrors: jwize.com/pluginthematrix.io are the
  degenerate "host that consented to everything" case. This is the
  federation ramp that lets any operator play that role deliberately.
- **Absorbs** the pinned swarm-image-consent idea (same primitive, wider
  scope: any bytes, not just images).
- **Blossom alignment**: the nostr ecosystem's blob-hosting spec (BUD-01/02)
  is sha256-addressed `GET /<sha256>` + nostr-signed uploads — nearly
  byte-for-byte our flat `/<sig>` heap + NIP-98 PUT. Where wire choices are
  free (auth event shape, upload endpoint naming), prefer Blossom's so
  existing Blossom servers can act as consenting hosts with zero Hypercomb
  code. Divergences must be deliberate and noted here.

## Build checklist

1. Relay: `/@grant` endpoint + quota-metered writer class (403 on expiry /
   exhaustion).
2. `HostSyncService`: multi-target drain + per-(sig, host) receipts.
3. Broker/swarm: kind 20410 request publish + 30411 grant handling
   (attribution + granted-host record).
4. `hosting-consent.drone.ts`: toast bridge, persisted decisions.
5. Share UX: "ask the swarm to host this" action on the share flow, closure
   size computed from the existing adopt-walk collectors.

Layer-closure-first ordering, sha256 gating, and read-back receipts are
inherited, not new work.
