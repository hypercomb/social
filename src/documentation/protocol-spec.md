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
- The client maintains a configurable relay list. Default: `wss://relay.snort.social`.
- Configuration key: `localStorage['hc:nostrmesh:relays']` (JSON array of `wss://` URLs).

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
  __drones__/                      (compiled drone modules, keyed by SHA-256)
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

State changes fire a DOM `CustomEvent` named `synchronize`:

```typescript
{
  source:   "lineage:explorer" | "lineage:url" | "lineage:fs",
  rev:      number,     // monotonic revision counter
  path:     string,     // e.g. "/chemistry/organic"
  segments: string[]    // e.g. ["chemistry", "organic"]
}
```

All UI and rendering systems listen for this event to refresh.

---

## 13. Drone Lifecycle

Drones are the unit of behavior. The mesh, renderer, and all I/O are implemented as drones.

### 13.1 Lifecycle

```
encounter(grammar)
  └─► sense(grammar) → boolean
       └─► if true: heartbeat(grammar)
```

- `sense()`: Does this drone respond to the current context? Default: `true`.
- `heartbeat()`: Execute behavior. This is where mesh queries, publishes, and renders happen.
- `encounter()`: Framework entrypoint. Chains sense and heartbeat.

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
window.ioc.register('NostrMeshDrone', meshDrone)
window.ioc.register('ShowHoneycomb', new ShowHoneycombDrone())
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
                         Encounter drones per segment.
7. Lineage follows URL   Explorer path syncs to URL.
8. ShowHoneycomb heartbeat  Compute sig, subscribe mesh, render.
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
| `hc:nostrmesh:relays`            | JSON string[] | `["wss://relay.snort.social"]` | Nostr relay endpoints            |
| `hc:nostrmesh:kinds`             | JSON int[]    | `[29010]`                    | Accepted event kinds               |
| `hc:nostrmesh:debug`             | `"0"\|"1"`    | `"0"`                        | Debug logging                      |
| `hc:nostrmesh:allow-loopback`    | `"0"\|"1"`    | `"0"`                        | Allow localhost relay connections   |
| `hc:nostr:secret-key`            | hex string    | (none)                       | Nostr private key (32 bytes hex)   |
| `hc:show-honeycomb:publisher-id` | UUID string   | auto-generated               | Persistent client identity for self-filter |
