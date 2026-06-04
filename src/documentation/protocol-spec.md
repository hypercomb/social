# Hypercomb Protocol Specification v1

## 1. Overview

Hypercomb is a decentralized, presence-based navigation protocol. There is no central server. Clients connect to one or more Nostr relays to exchange ephemeral cell data. Users do not log in. Identity is visual and ephemeral. The local filesystem (OPFS) is the source of truth. Relays are stateless forwarders.

This document specifies the wire protocol, message formats, addressing, storage model, signing, and lifecycle.

---

## 2. Transport Layer

### 2.1 Relay Connection

Clients connect to Nostr relays over WebSocket (`wss://`).

```
Client ──── wss:// ────► Relay (stateless)
```

- Relays follow the Nostr relay protocol (NIP-01).
- Relays store nothing long-term. They forward frames and serve recent events per standard Nostr behavior.
- The client maintains a configurable relay list. Default: `ws://localhost:7777` (loopback, gated behind `hc:nostrmesh:allow-loopback`). The shared bootstrap relay `wss://jwize.com` is opt-in via `localStorage['hc:nostrmesh:use-live-relay'] = '1'` — without that flag, casual visitors never touch the shared server.
- Configuration key: `localStorage['hc:nostrmesh:relays']` (JSON array of `wss://` URLs) overrides both defaults.

### 2.2 Connection Management

| Parameter       | Value                                      |
|-----------------|--------------------------------------------|
| Backoff base    | 250ms                                      |
| Backoff cap     | 15,000ms                                   |
| Backoff formula | `min(15000, 250 * 2^(attempts-1)) + jitter`|
| Jitter range    | 0-250ms                                    |
| Max attempts    | 10 (then cap holds)                        |
| Loopback relays | Blocked unless `localStorage['hc:nostrmesh:allow-loopback'] === '1'` |

On WebSocket open, all active subscriptions are replayed to the relay. On close, backoff schedule applies and reconnection is automatic.

### 2.3 Deduplication

Events are deduplicated by Nostr event `id` using an LRU ring buffer.

| Parameter  | Value |
|------------|-------|
| LRU capacity | 2048 |

Duplicate event IDs across relays are dropped silently.

---

## 3. Event Format

All messages use the standard Nostr event envelope.

### 3.1 Nostr Event Structure

```typescript
{
  id:         string       // hex, computed by nostr-tools
  pubkey:     string       // hex, 32-byte public key
  created_at: number       // unix seconds
  kind:       number       // event kind
  tags:       string[][]   // array of tag arrays
  content:    string       // payload (JSON or CSV)
  sig:        string       // hex, Schnorr signature
}
```

### 3.2 Hypercomb Event Kind

| Kind  | Purpose                         |
|-------|---------------------------------|
| 29010 | Hypercomb cell exchange         |

Configuration key: `localStorage['hc:nostrmesh:kinds']` (JSON array of integers, or `null` for any kind).

### 3.3 Required Tags

Every hypercomb event MUST include an `x` tag containing the signature (address) of the target location:

```json
["x", "<64-char-hex-signature>"]
```

### 3.4 Optional Tags

| Tag         | Format                        | Purpose                          |
|-------------|-------------------------------|----------------------------------|
| `publisher` | `["publisher", "<client-id>"]`| Self-identification for filtering own events |
| `mode`      | `["mode", "snapshot"\|"delta"]` | Snapshot = full cell list; Delta = single addition |
| `source`    | `["source", "<origin>"]`      | Origin context for the publish   |

---

## 4. Addressing (Signature Derivation)

A signature addresses a specific location in the hierarchy. It is computed deterministically from the lineage path.

### 4.1 Computation

```
key   = "{domain}/{segment_0}/{segment_1}/.../{segment_n}/cell"
bytes = UTF-8(key)
sig   = lowercase(hex(SHA-256(bytes)))
```

- `domain`: The active domain. Default: `hypercomb.io`.
- `segments`: The current OPFS explorer path segments, in order.
- If no segments exist: `key = "{domain}/cell"`.

### 4.2 Example

```
Path:       /chemistry/organic
Domain:     hypercomb.io
Key:        "hypercomb.io/chemistry/organic/cell"
Signature:  SHA-256("hypercomb.io/chemistry/organic/cell") → 64-char hex
```

The resulting signature is used as the `x` tag value in all subscribe/publish operations for that location.

### 4.3 Properties

- Deterministic: same path always produces the same signature.
- No server lookup required. Any client at the same path computes the same address.
- No identity or URL information embedded.

---

## 5. Wire Protocol Messages

Standard Nostr relay protocol. Client-to-relay and relay-to-client frames are JSON arrays.

### 5.1 Client → Relay

**Subscribe:**
```json
["REQ", "<sub-id>", {"#x": ["<signature>"], "kinds": [29010]}]
```

**Publish:**
```json
["EVENT", <signed-nostr-event>]
```

**Unsubscribe:**
```json
["CLOSE", "<sub-id>"]
```

### 5.2 Relay → Client

**Event delivery:**
```json
["EVENT", "<sub-id>", <nostr-event>]
```

**End of stored events:**
```json
["EOSE", "<sub-id>"]
```

**Relay notice:**
```json
["NOTICE", "<message>"]
```

### 5.3 Subscription Multiplexing

One network subscription exists per signature. Multiple consumers share a single bucket. When the last consumer unsubscribes, the `CLOSE` is sent.

Subscription IDs are generated as: `hc-{timestamp_hex}-{random_hex}`.

---

## 6. Payload Formats

The `content` field of a Nostr event carries the cell payload. Three formats are supported.

### 6.1 CSV String (Preferred)

```
"alpha,beta,gamma"
```

Cells are comma-separated. Leading/trailing whitespace per cell is trimmed. Quoted cells (`"name"` or `'name'`) are unquoted.

### 6.2 JSON Object

```json
{"cells": ["alpha", "beta"], "publisherId": "<id>", "mode": "snapshot", "publishedAtMs": 1234567890}
```

Required field: `cells` (string array).
Optional fields: `publisherId`, `mode`, `publishedAtMs`, `cell` (single string).

### 6.3 JSON Array

```json
["alpha", "beta", "gamma"]
```

Direct string array.

### 6.4 Parsing Order

1. If content does not start with `{`, `[`, or `"`: parse as CSV.
2. Attempt `JSON.parse`. If result is string: parse as CSV. If array: iterate. If object: read `.cells` and `.cell`.
3. Fallback: regex extract `cells:[...]` from malformed JSON, then CSV split.
4. If content looks structured but unparseable: discard (do not produce junk tiles).

---

## 7. Publish Protocol

### 7.1 Local Fanout

Every publish is delivered locally first, before network send. This ensures the publishing client sees its own data immediately even if the relay is unavailable.

### 7.2 Snapshot (Initial)

On first encounter with a signature, the client publishes a full snapshot of local cells:

```json
{
  "cells": ["alpha", "beta", "gamma"],
  "publisherId": "<uuid>",
  "mode": "snapshot",
  "publishedAtMs": <unix-ms>
}
```

Tags: `["x", "<sig>"], ["publisher", "<uuid>"], ["mode", "snapshot"]`

### 7.3 Delta (Subsequent)

When new cells appear locally after the initial snapshot, each new cell is published individually:

```
content: "new-cell-name"
```

Tags: `["x", "<sig>"], ["publisher", "<uuid>"], ["mode", "delta"]`

### 7.4 Self-Filtering

Clients filter out their own events by comparing the `publisher` tag against their local `publisherId`. This prevents echo loops.

Publisher ID is a persistent `crypto.randomUUID()` stored at `localStorage['hc:show-honeycomb:publisher-id']`.

---

## 8. Subscribe Protocol

### 8.1 Flow

```
1. Client computes signature from lineage path.
2. Client sends REQ with filter: {"#x": [sig], "kinds": [29010]}.
3. Relay sends matching stored EVENTs.
4. Relay sends EOSE.
5. Relay sends new EVENTs as they arrive.
6. Client caches events with TTL.
7. On lineage change: CLOSE old subscription, open new one.
```

### 8.2 Ready Semantics

`awaitReadyForSig(sig, timeoutMs)` resolves when:
- First matching event arrives, OR
- Relay sends EOSE, OR
- Timeout elapses (default: 900ms, configurable up to 1000ms on signature change).

---

## 9. Cache and Expiry

The mesh maintains a per-signature in-memory cache.

### 9.1 TTL Rules

Rules are evaluated first-match. Each rule can match on:
- `sigPrefix`: signature starts with this string.
- `kind`: event kind equals this value.

Default rule: 120,000ms TTL.

### 9.2 Cache Limits

| Parameter     | Default |
|---------------|---------|
| TTL           | 120s    |
| Per-sig cap   | 128     |
| Eviction      | Oldest by `created_at` first |

### 9.3 Pruning

Expired items are pruned:
- On every drone heartbeat cycle.
- Before every `getNonExpired()` query.

---

## 10. Signing

### 10.1 Priority Order

1. **NIP-07** (`window.nostr.signEvent`) — browser extension.
2. **IOC NostrSigner** — registered signer from `window.ioc.get('NostrSigner')`.
3. **Secret key sources** (in order):
   - `window.NOSTR_SECRET_KEY` (64-char hex)
   - `localStorage['hc:nostr:secret-key']` (64-char hex)
   - Dev fallback key (hardcoded, test use only)

### 10.2 Signing Mechanics

- Library: `nostr-tools` (`finalizeEvent`, `getPublicKey`).
- Key format: 32-byte Schnorr private key (hex-encoded).
- Output: Populated `id`, `pubkey`, `sig` fields on the event.

### 10.3 Unsigned Behavior

If no signer is available:
- Local fanout still occurs (the event is delivered to local consumers).
- Network send is skipped. A `sendSkippedNoSigner` counter is incremented.

---

## 11. Content Addressing (SHA-256)

All content is addressed by its SHA-256 hash.

```typescript
signature = lowercase(hex(SHA-256(bytes)))
```

- 64-character hex string.
- Used for: location signatures, drone module signatures, layer signatures, dependency signatures.
- Implementation: Web Crypto API (`crypto.subtle.digest('SHA-256', arrayBuffer)`).

---

## 12. Local Storage Model (OPFS)

The Origin Private File System is the persistent local store. No server storage exists.

### 12.1 Directory Structure

```
opfsRoot/                          (navigator.storage.getDirectory())
  hypercomb.io/                    (domain root — user cell hierarchy)
    {cell}/                        (directory = cell)
      {child-cell}/                (nested cell)
      ...
  __bees__/                        (compiled bee modules, keyed by SHA-256)
  __dependencies__/                (shared JS libraries, keyed by SHA-256)
  __layers__/                      (layer metadata, per-domain)
    {domain}/
      {signature}.json             (layer definition)
      {signature}-install          (installation manifest)
```

### 12.2 Cells

A cell is a directory under the domain root. The directory name IS the cell name. Cells form a hierarchy:

```
hypercomb.io/
  chemistry/
    organic/
    inorganic/
  music/
    jazz/
```

Hidden directories (`__*__`) and install markers (`*-install`) are excluded from cell listings.

### 12.3 Lineage

Lineage is the client's current position in the cell hierarchy, expressed as an ordered path of segments:

```
segments: ["chemistry", "organic"]
label:    "/chemistry/organic"
```

Lineage drives:
- The browser URL path (via `Navigation.goRaw()`).
- The signature computation for mesh subscribe/publish.
- The OPFS directory handle resolution.
- The visual render of the honeycomb grid.

### 12.4 Synchronization Event

The `synchronize` event is a plain DOM `Event` (not a `CustomEvent`) dispatched solely by the processor (`hypercomb.act()`) in its `finally` block after all bees have pulsed. It carries no detail payload — no source tagging, no revision data, no path segments. Its sole purpose is to coalesce visual updates into a single render pass.

```typescript
window.dispatchEvent(new Event('synchronize'))
```

All UI and rendering systems listen for this event to refresh. Because the processor is the sole dispatcher, no additional coordination or payload is needed — the event is a pure "render now" signal.

---

## 13. Drone Lifecycle

Drones are the unit of behavior. The mesh, renderer, and all I/O are implemented as drones.

### 13.1 Lifecycle

```
pulse(grammar)
  └─► sense(grammar) → boolean
       └─► if true: heartbeat(grammar)
```

- `sense()`: Does this drone respond to the current context? Default: `true`.
- `heartbeat()`: Execute behavior. This is where mesh queries, publishes, and renders happen.
- `pulse()`: Framework entrypoint. Called by the processor (`hypercomb.act()`). Chains sense and heartbeat.

### 13.2 Effects Declaration

Each drone declares its side effects:

| Effect       | Meaning                        |
|--------------|--------------------------------|
| `filesystem` | Reads/writes OPFS              |
| `render`     | Modifies visual output         |
| `history`    | Modifies browser history       |
| `network`    | Opens connections / sends data |
| `memory`     | Modifies in-memory state       |
| `external`   | Interacts with external systems|

### 13.3 Registration

Drones self-register in the global IOC container:

```typescript
window.ioc.register('@diamondcoreprocessor.com/NostrMeshDrone', meshDrone)
window.ioc.register('@diamondcoreprocessor.com/ShowCellDrone', new ShowCellDrone())
```

Lookup is by name: `window.ioc.get<T>('NostrMeshDrone')`.

---

## 14. Cell Exchange Sequence

Complete flow for two clients at the same lineage path.

```
Client A                          Relay                         Client B
   │                                │                              │
   ├─ compute sig from lineage ─────┤                              │
   ├─ REQ [sub-a, {#x:[sig]}] ────►│                              │
   │                                │◄── REQ [sub-b, {#x:[sig]}] ─┤
   │                                │                              ├─ compute sig from lineage
   │                                │                              │
   ├─ EVENT {cells, publisher:A} ──►│──► EVENT [sub-b, evt] ──────►│
   │                                │                              ├─ filter: publisher != B
   │                                │                              ├─ cache event
   │                                │                              ├─ union cells
   │                                │                              │
   │◄── EVENT [sub-a, evt] ────────│◄── EVENT {cells, pub:B} ─────┤
   ├─ filter: publisher != A        │                              │
   ├─ cache event                   │                              │
   ├─ union cells                   │                              │
   │                                │                              │
   ├─ render honeycomb grid         │              render honeycomb─┤
   │  (local + remote cells)        │              (local + remote) │
```

---

## 15. Byte Protocol (Navigation)

Movement between hexagonal cells is encoded in a single byte.

### 15.1 Layout

```
Bit:  7 6   5 4   3   2 1 0
      m m   p p   d   n n n
```

| Field | Bits | Range | Meaning                                            |
|-------|------|-------|----------------------------------------------------|
| `nnn` | 0-2  | 0-5   | Neighbor index within hex ring. 6-7 invalid: drop. |
| `d`   | 3    | 0-1   | 0 = backward (retracing). 1 = forward (exploring). |
| `pp`  | 4-5  | 0-3   | 00 neutral, 01 beacon, 10 avoid, 11 priority.      |
| `mm`  | 6-7  | 0-3   | 00 end, 01 continue, 10 branch, 11 reserved.       |

### 15.2 Encoding

```typescript
byte = ((mm & 0b11) << 6) | ((pp & 0b11) << 4) | ((d & 0b1) << 3) | (nnn & 0b111)
```

### 15.3 Decoding

```typescript
mm  = (byte >> 6) & 0b11
pp  = (byte >> 4) & 0b11
d   = (byte >> 3) & 0b1
nnn = byte & 0b111
```

### 15.4 Error Handling

- `nnn` 6 or 7: drop the step.
- `mm` = 11 (reserved): treat as continue.
- Repeated identical steps with dt near 0: debounce.

---

## 16. DNA (Path Capsule) — Optional Persistence

DNA captures a navigation path for voluntary publication. Live behavior is unaffected by DNA existence.

### 16.1 Binary Format

```
+------------------------------+
| MAGIC (2B): "HC"             |
| VERSION (1B): 0x01           |
| FLAGS (1B): bitfield         |
+------------------------------+
| POLICY (1B)                  |
| START_HASH (32B)             |
| SALT (16B)                   |
+------------------------------+
| INSTR_LEN (4B, LE)           |
| INSTR_BYTES (N * 1B)         |
+------------------------------+
| COMMITMENT (32B)             |
+------------------------------+
| [OPTIONAL] ATTESTATION       |
| [OPTIONAL] ANCHOR            |
+------------------------------+
```

| Field         | Size     | Description                                       |
|---------------|----------|---------------------------------------------------|
| MAGIC         | 2 bytes  | ASCII `"HC"`                                       |
| VERSION       | 1 byte   | `0x01`                                             |
| FLAGS         | 1 byte   | bit 0: anchored, bit 1: attested, bit 2: encrypted (reserved) |
| POLICY        | 1 byte   | 0 = creator, 1 = creator+cohort, 2 = community    |
| START_HASH    | 32 bytes | SHA-256 of start cell                              |
| SALT          | 16 bytes | Random, mitigates rainbow tables on START_HASH     |
| INSTR_LEN     | 4 bytes  | Little-endian, number of instruction bytes         |
| INSTR_BYTES   | N bytes  | 1-byte navigation instructions (section 15)        |
| COMMITMENT    | 32 bytes | SHA-256(header \|\| instr \|\| length)             |
| ATTESTATION   | variable | Signatures over COMMITMENT (policy-dependent)      |
| ANCHOR        | variable | `{chain, txid}` proving on-chain commitment        |

### 16.2 Verification

1. Parse capsule.
2. Recompute COMMITMENT. Compare.
3. If attested: verify signatures against known keys.
4. If anchored: confirm commitment on chain.
5. Resolve START_HASH to a local entry point.
6. Re-execute INSTR_BYTES in a new session.

---

## 17. Session Security

### 17.1 Session Nonce

- Fresh nonce created when a driver starts hosting.
- Distributed only to linked bees.
- Rotates on new joins and at short intervals.
- Old nonces are immediately invalid. Prevents replay.

### 17.2 Transport Encryption

- AEAD: XChaCha20-Poly1305.
- Key derivation: HKDF-SHA256 from session nonce.
- No URLs or IDs in encrypted payloads.

### 17.3 Human Gates

- **Tempo guard**: Step timing + natural jitter analysis. No profiling.
- **Micro-gesture**: Rare, tiny human-presence proof (pointer nudge). Triggered on suspected automation.

---

## 18. Bootstrap Sequence

Client initialization order:

```
1. ensureSwControl()     Register service worker.
2. Store.initialize()    Open OPFS root handles.
3. ensureInstall()       Download layers/drones/deps if needed.
4. attachImportMap()     Build and inject <script type="importmap"> from OPFS.
5. bootstrapApplication  Start Angular.
6. BootstrapHistory.run  Walk URL segments against OPFS tree.
                         Rebuild browser history stack.
                         Pulse drones per segment.
7. Lineage follows URL   Explorer path syncs to URL.
8. ShowCellDrone heartbeat  Compute sig, subscribe mesh, render.
```

---

## 19. IOC Container

Global singleton registry. No dependency injection framework required.

```typescript
window.ioc.register<T>(signature: string, value: T, name?: string): void
window.ioc.get<T>(key: string): T | undefined
window.ioc.has(key: string): boolean
window.ioc.list(): readonly string[]
```

Lookup resolves by exact signature first, then by name alias.

---

## 20. Configuration Reference

| Key                              | Type          | Default                      | Description                        |
|----------------------------------|---------------|------------------------------|------------------------------------|
| `hc:nostrmesh:relays`            | JSON string[] | `["ws://localhost:7777"]` (or `["wss://jwize.com"]` when `use-live-relay`) | Nostr relay endpoints |
| `hc:nostrmesh:use-live-relay`    | `"0"\|"1"`    | `"0"`                        | Use shared bootstrap relay `wss://jwize.com` as the default seed |
| `hc:nostrmesh:kinds`             | JSON int[]    | `[29010]`                    | Accepted event kinds               |
| `hc:nostrmesh:debug`             | `"0"\|"1"`    | `"0"`                        | Debug logging                      |
| `hc:nostrmesh:allow-loopback`    | `"0"\|"1"`    | `"0"`                        | Allow localhost relay connections   |
| `hc:mesh-public`                 | `"true"\|other` | (unset)                    | Master privacy switch. Mesh networking is OFF unless this is `"true"`. |
| `hc:nostr:secret-key`            | hex string    | (none)                       | Nostr private key (32 bytes hex)   |
| `hc:show-honeycomb:publisher-id` | UUID string   | auto-generated               | Persistent client identity for self-filter |
| `hc:nostrmesh:self-domain`       | string        | `""`                         | Operator's own domain (e.g., `wss://jwize.com` or `jwize.com`). When set, the content broker advertises this domain in every response so requesters accumulate it into their HTTP-direct address graph. Empty for non-host clients. |
| `hc:community:domains`           | JSON string[] | `[]`                         | Operator's trusted-community domain list. Drives HTTP-direct fetch ordering: community-trusted domains are tried before mesh-learned ones, even when not witnessed for a given sig. See Section 21. |

---

## 21. Content Broker Protocol

The content broker is the on-demand fetch primitive for sig-addressed content (layers, resources, dependencies). It rides alongside the cell-exchange protocol (Section 14) on the same Nostr relays but uses distinct event kinds and is layered for a different purpose: cell-exchange is location-keyed and pushes presence; the broker is signature-keyed and pulls bytes.

### 21.1 Two transports, one API

The broker exposes a single public method, `fetchBySig(sig, type, timeoutMs?)`. Internally it composes two transports in fallback order:

1. **HTTP-direct** (preferred, all types) — fetch from the operator's own HTTP content endpoint and from learned/community domains. First verified-bytes wins.
2. **Nostr mesh broker** (layer-only fallback) — broadcast a sig request on the Nostr relay; any peer with the bytes can respond.

Per the doctrine in `memory: project_public_navigation_lineage_filter.md`:

> Mesh transports LAYER SIGS ONLY — layers are tiny directories; resources / deps / bees / blobs travel via direct HTTPS fetches to the domains the mesh told you about.

Resources and dependencies have NO mesh fallback. If HTTP-direct can't find them, the call returns `null` and the caller retries on next access (by which point new domains may have been learned via subsequent layer fetches).

### 21.2 HTTP-direct: candidate URLs

For each content type the operator's HTTP host serves:

| Type         | URL path                       |
|--------------|--------------------------------|
| `layer`      | `/__layers__/<sig>.json`       |
| `resource`   | `/__resources__/<sig>`         |
| `dependency` | `/__dependencies__/<sig>.js`   |

These are static `https://<domain><path>` fetches with no auth. Each candidate's bytes are SHA-256 verified against the requested sig before being returned — bad bytes are dropped and the next candidate is tried.

### 21.3 HTTP-direct: candidate ordering (binary in-community trust)

Domains are tried in tiered order:

| Tier  | Source                | Always tried? | Notes |
|-------|-----------------------|---------------|-------|
| 0     | Self-domain           | when set      | `localStorage['hc:nostrmesh:self-domain']` — operator's own machine |
| 1     | Community-trusted     | always        | `localStorage['hc:community:domains']` (JSON array). Tried even without mesh witness for the sig — endorsement carries weight on its own |
| 2     | Mesh-learned          | only if witnessed | Domains observed in prior response `domain` tags for this sig |

Within a tier, insertion order. This bounds the time wasted on adversarial mesh advertisements: a malicious peer flooding fake `domain` tags can only push their host into Tier 2, never ahead of community-trusted hosts. SHA-256 verification of returned bytes remains the absolute backstop.

Future refinements (graph-distance, overlap-count, explicit-endorsement) layer on top by re-ranking inside the community tier without changing the binary in/out gate.

### 21.4 Mesh broker: wire shape (layer-only)

| Kind  | Purpose                                                                 | Tags |
|-------|-------------------------------------------------------------------------|------|
| 20400 | Fetch request                                                           | `[["x", "broker:fetch"], ["d", "<sig>"], ["t", "layer"]]` |
| 30401 | Fetch response (parameterized-replaceable)                              | `[["d", "<sig>"], ["t", "layer"], ["expiration", "<unix-secs>"], ["domain", "<host>"]?]` |
| 20402 | Fetch cancel (cooperative cancellable broadcast)                        | `[["d", "<sig>"], ["expiration", "<unix-secs>"]]` |

- **Request** content is empty; sig + type travel as tags. Broadcast on the well-known `broker:fetch` channel — every participant subscribes there at boot.
- **Response** content is base64 of the bytes. Responder MAY include zero or more `["domain", "<host>"]` tags advertising themselves and other hosts they know serve this sig — receivers accumulate these into the address graph for future HTTP-direct queries.
- **Cancel** is published by the asker once a sig has been resolved with verified bytes. Other peers preparing a response for the same sig abort before committing bandwidth (best-effort coordination).
- **Type tag** retained for forward compatibility but the responder ignores any value other than `"layer"`. Requests with `t=resource` or `t=dependency` are silently dropped — those types are HTTP-direct only.

### 21.5 Response primitive: `{ bytes, domains }`

Every broker response carries both:
- **bytes** — synchronous payload; the requester verifies via SHA-256 and persists to local store
- **domains** — zero or more `domain` tags accumulated into the receiver's address graph

Both halves serve different timescales. `bytes` is for now (verify + hatch the egg); `domains` is for later (accumulate addresses for future direct queries). A host that responds with `bytes` AND advertises itself via a `domain` tag teaches the requester to bypass the mesh next time and go HTTP-direct.

Silent-when-stale: hosts only respond if they have the bytes cached and the request hasn't been cancelled. The act of responding IS the freshness gate.

### 21.6 Content verification

The requester computes SHA-256 of the response bytes and compares to the requested sig:

```
expected = sig
actual   = lowercase(hex(SHA-256(bytes)))
accept   = (actual === expected)
```

Mismatched bytes are discarded silently and the broker keeps waiting (until timeout) for a valid responder. Combined with parameterized-replaceable response storage at the relay, the broker guarantees:

- No fetch ever returns bytes that don't match the requested sig
- No "winner takes all" failure mode — slow honest responders still get a chance
- Cache amplification across the swarm: every verified response becomes the responder's new local copy, so they can serve future requesters for the same sig

### 21.7 Operator domain as HTTP content host

The operator's relay binary (`hypercomb-relay/relay.js`) serves HTTP content alongside the WebSocket relay. Both share the same hostname:

```
https://<domain>/__layers__/<sig>.json     ← static layer manifest
https://<domain>/__resources__/<sig>       ← arbitrary content blob
https://<domain>/__dependencies__/<sig>.js ← signed dependency bundle
https://<domain>/manifest.json             ← the operator's package manifest
wss://<domain>/                            ← WebSocket relay endpoint
```

Build output (`hypercomb-essentials/dist/`) is copied to `hypercomb-relay/content/` by `scripts/copy-to-dcp.ts` on every build, so the operator's own machine is always serving the latest content their build produced. See `memory: project_domain_as_identity.md` for the full "host is a verb" doctrine.

### 21.8 Daisy-chain federation (structural property)

The URL shape in Section 21.7 is **identical at every host**, and the signature universe is global. The combination produces a structural federation property: **adoption IS mirroring**.

When `jwize.com` adopts `sigX` from `alice.dev`:

1. HTTPS-GET `https://alice.dev/__layers__/<sigX>.json`
2. SHA-256 verify the bytes against `sigX`
3. Write to `jwize.com`'s local `__layers__/<sigX>.json`

From that moment, any peer asking `jwize.com` for `sigX` receives byte-identical content to what `alice.dev` would have served. The daisy chain forms with no integration code, no auth handshake, no registry entry — just the URL shape and the sig universe.

```
       sigX                             sigX                             sigX
alice.dev ────────── HTTPS-GET ──────── jwize.com ──── HTTPS-GET ──── carol.io
       │                                  │                              │
       └─ original capture                └─ adopted from alice           └─ adopted from jwize
                                            mirrors at /__layers__/<sigX>
                                            serves to her community
```

Implications encoded in this protocol:

- **`hc:community:domains` is dual-purpose** — the same list names (a) hosts the broker trusts for HTTP-direct queries (Section 21.3 binary in-community gate), and (b) hosts the operator can choose to adopt content *from* (turning HTTP-direct query candidates into mirror sources).

- **Network resilience is automatic** — if `alice.dev` goes offline, every host that adopted any of her sigs continues to serve them. The community is a redundancy graph, not hub-and-spoke. The only way a sig becomes globally unavailable is if no operator anywhere has adopted it.

- **The DAG is the protocol** — operators form a directed "I feed from these hosts" graph. There is no central registry of edges; the graph is emergent from each operator's adoption choices. Walking the chain backward from any sig finds who adopted it; walking forward finds who they fed.

- **Overlap is the join** — where two hosts adopt the same sig, they structurally overlap on that sig. The overlap doubles capacity for that content (two parallel HTTPS sources) and connects the two operators' communities through the shared sig.

- **Federation is byte-copy, no protocol** — adding a feed source is just adoption. There is no separate "federate with alice.dev" handshake. The mechanism doesn't distinguish "I authored this" from "I adopted this from alice.dev" — both are "`jwize.com` has these bytes at this URL."

Provenance (who originally captured, who adopted from whom, who endorsed whom) is a separate concern, layered on top via the witness graph and community membership. The content itself is universally addressable; trust is per-operator.

### 21.9 Host filesystem layout

Because signatures are universal addresses *and* every layer transitively references its own children (sub-layers, bees, dependencies, resources), host storage collapses to **five pools** — four flat and sig-keyed, one shallow and domain-keyed. Nothing else.

```
content/
  __layers__/<sig>                 ← layer (refs to its children via sig arrays)
  __bees__/<sig>                    ← bee
  __dependencies__/<sig>            ← dep
  __resources__/<sig>               ← resource (arbitrary bytes)
  __roots__/<domain>/<sig>          ← attestation, grouped by attester domain
```

That is the entire surface. No `manifest.json` with expanded `bees[]`/`layers[]` arrays — those arrays were walk results, not configuration, and every layer already references its own children. No top-level discovery index file — directory listing IS the discovery surface.

**A root attestation** (one file at `__roots__/<domain>/<sig>`) is a small signed record:

```json
{
  "layer":      "<layer-sig>",     // the entry-point layer this attests
  "domain":     "jwize.com",       // attester's domain identity
  "branch":     "main",            // optional named branch
  "attestedAt": 1234567890,        // unix seconds
  "signature":  "<ed25519-sig>"    // signed by attester's key
}
```

The file is content-addressed: its name is the sha256 of its bytes. Two domains attesting the same layer produce two different attestation files under their respective `__roots__/<domain>/` folders (different content → different sig). One operator re-attesting at different times produces different files within the same domain folder (different `attestedAt` → different content → different sig). Withdrawing an attestation is a delete of one specific `__roots__/<domain>/<sig>` file, with the rest of the pool untouched.

**Discovery is directory listing** — no auxiliary index file:

```
GET /__roots__/                  → list of domains this host serves
GET /__roots__/<domain>/         → list of attestation sigs for that domain
GET /__roots__/<domain>/<sig>    → the attestation file
```

The relay's HTTP host can serve directory listings trivially. No `roots.json`, no `index.json`, no manifest-merge logic. The filesystem listing IS the protocol's discovery surface.

**Data vs scripts is a manifest-layer view, not a storage split.** Both flow through the same sig pool. The distinction is which array within a *layer* a sig appears in (`bees[]`/`dependencies[]` vs sub-`layers[]`). The bytes are interchangeable — `__layers__/<sig>` is just a layer whether it encodes user tiles, notes, or code-package structure.

**Every update = one new attestation file.** User mutations and branch operations all produce exactly one new sig-addressed file in `__roots__/<domain>/`:

| Operation | What changes |
|---|---|
| Add a tile | new layer sig → `__layers__/`. New attestation pointing at it → `__roots__/<self>/<sig>` |
| Remove a tile | new layer (without tile) → `__layers__/`. New attestation → `__roots__/<self>/<sig>` |
| Save as branch `foo` | new attestation with `branch: "foo"` → `__roots__/<self>/<sig>` |
| Switch to branch `foo` | reader scans `__roots__/<self>/` for `branch === "foo"` → walks from its layer |
| Adopt alice.dev | for each attestation in her `__roots__/alice.dev/`, write to your own `__roots__/alice.dev/`. Fan reachable sigs into the pool. |
| Withdraw an attestation | `rm __roots__/<domain>/<sig>` on one specific file. Pool untouched. |

Old layer sigs are NOT deleted. Old attestation files are NOT deleted. Time-travel is intact for free. Multiple attestations of the same `(domain, branch)` coexist; the most recent `attestedAt` is canonically active.

**Active pointer is optional.** Readers can scan `__roots__/<domain>/` and pick the most recent `attestedAt` matching `branch: "main"`. With a few attestations per domain that's instantaneous. If a host accumulates so many attestations that scanning is slow, the operator can ship an `active.json` cache as a pure optimization — but it is not a protocol commitment, and losing it never loses data.

**Three free properties from this collapse:**

- **No "whose bytes are these" ambiguity** — a sig in the layer/bee/dep/resource pools is just bytes. Provenance lives in attestation files. Path encoding (`__roots__/<domain>/...`) is a convenient access pattern; the file content (signed by the attester's key) is the authoritative claim.
- **"Diff" is a set operation on layer walks** — `walk(now.layer) - walk(branch_v3.layer)` answers "what did I add since v3?" without filesystem walking.
- **Atomic per-attestation files** — one file per attestation means partial writes or accidental `rm` target exactly one record. There is no manifest-merge step, so no manifest-merge bug class exists.

**HTTP routes:**

```
GET  /__layers__/<sig>           → universal pool
GET  /__bees__/<sig>              → universal pool
GET  /__dependencies__/<sig>      → universal pool
GET  /__resources__/<sig>         → universal pool
GET  /__roots__/                  → directory listing (domains served)
GET  /__roots__/<domain>/         → directory listing (attestation sigs)
GET  /__roots__/<domain>/<sig>    → the attestation file
```

Sig lookups never filter by domain — they are universal pool reads. Domain scoping appears only in `__roots__/`. There are no merge endpoints and no expansion-manifest routes.

**Garbage collection is opt-in.** The pool is durable by default; the rule is *never delete from `__layers__/`, `__bees__/`, `__dependencies__/`, `__resources__/` unless an explicit GC phase runs.* A future GC walks every attestation in every `__roots__/<domain>/`, transitively walks the layer trees, marks reachable sigs, then trims unreferenced ones (subject to a configurable retention window). Operator-initiated only; never automatic.

### 21.10 Extension-free sig URLs

Sig-addressed paths drop their format extension. The path prefix already encodes the type; the extension is redundant build-tooling residue.

| URL | Content-Type returned by server |
|---|---|
| `/__layers__/<sig>` | `application/json` |
| `/__bees__/<sig>` | `application/javascript` |
| `/__dependencies__/<sig>` | `application/javascript` |
| `/__resources__/<sig>` | per the resource's stored type, or `application/octet-stream` |

**Why this is structurally better:**

- **Format-agnostic URLs.** If the layer manifest format evolves (JSON → CBOR → MessagePack), the URL doesn't move. The bytes change; the address stays.
- **The address IS the identity.** Sig is the universal name; extension was carrying redundant metadata.
- **Matches `__resources__/` which was already extension-free.** No special case for "structured" types.
- **ESM module loading still works.** `import('https://host/__bees__/<sig>')` evaluates as a module when the server returns `Content-Type: application/javascript`. The browser's module loader doesn't require a `.js` extension in the URL.

**The one real cost** is that the server MUST set `Content-Type` by path prefix rather than by file extension. The deploy pipeline's MIME-mapping function and the relay's HTTP host become prefix-keyed rather than extension-keyed. Trivial.

**`manifest.json` keeps its extension.** It is a well-known root entry point (cf. `package.json`, `robots.txt`), not sig-addressed, and the explicit name aids tooling/humans. The rule is specifically: drop the extension on sig-addressed paths.
