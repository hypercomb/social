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

Everything content-bearing is **signature-keyed** (sig = SHA-256 of the bytes, §11). The OPFS root is the local mirror of the host filesystem layout (§21.9) — the same sig pools, plus participant-local state the host never sees.

```
opfsRoot/                          (navigator.storage.getDirectory())
  __layers__/<sig>                 (canonical layer-bytes pool — layer JSON, sig-keyed, FLAT)
  __layers__/<domain>/             (install manifests — deployment artifacts; <domain> is
                                    non-hex, distinguishing it from 64-hex sig entries)
  __bees__/<sig>                   (compiled bee modules)
  __dependencies__/<sig>           (shared JS bundles)
  __resources__/<sig>              (content blobs — images, text, byte arrays)
  __history__/<lineage>/<NNNN>     (append-only marker records — pointers to layer sigs)
  __manifests__/<parent-sig>       (children manifests — derived; inlines resolved child
                                    layers so cold-load skips per-child sig lookups)
  __optimization__/                (persistent decoration substrate — Q&A, comms; applied
                                    in memory, layer-untouched)
  __threads__/  __computation__/  __clipboard__/   (thread state, receipts, clipboard)
```

**There is no on-disk hierarchy of user content.** Cells — their names, children,
and notes — are stored entirely as signature-addressed layers in `__layers__/<sig>`;
the hierarchy is encoded *inside* layers as child-layer sig references (§12.2), never
as nested folders. The legacy `hypercomb.io/` / `__hive__/` content-folder tree
(pre-layer-as-primitive) is retired; any surviving dirs are orphans, swept by
`/sweep`.

### 12.2 Cells are layer content, not directories

A cell is **not** a directory and its name is **not** a path segment. A cell is content inside a signature-addressed **layer** (`__layers__/<sig>`): the layer JSON holds the cell's fields — name, the sigs of its child layers, notes, and so on. The cell hierarchy is expressed by a layer referencing its child layers **by signature** (a sparse Merkle tree, see the Merkle Layer Model), never by nested folders.

Consequences:
- A cell's **identity is its signature**, not a name. There is no rename op — the atomic unit is immutable; you delete + create, never rename.
- Navigation position (lineage, §4 / §12.3) **computes a signature** that addresses the layer for that location. The signature — not a directory traversal — resolves the content.
- Reading a cell = read `__layers__/<sig>` → resolve its children's sigs from the same flat pool (or the derived `__manifests__/<parent-sig>` inline cache). No directory walking.

> **Retired model.** Cells were once stored as named directories under `hypercomb.io/`, with the directory name as the cell name and nesting as the hierarchy. That model is obsolete — superseded by signature-addressed layers. Any surviving `hypercomb.io/{cell}/…` folders are orphans and are swept; they are not part of the storage model.

### 12.3 Lineage

Lineage is the client's current position in the cell hierarchy, expressed as an ordered path of segments:

```
segments: ["chemistry", "organic"]
label:    "/chemistry/organic"
```

Lineage drives:
- The browser URL path (via `Navigation.goRaw()`).
- The signature computation for mesh subscribe/publish (§4).
- The layer-signature lookup that resolves content (`__layers__/<sig>`) — *not* a cell-directory traversal (§12.2).
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

The operator's HTTP host serves every content-addressed blob at a bare-sig URL, regardless of type (§21.10):

```
https://<domain>/<sig>
```

These are static fetches with no auth. Each candidate's bytes are SHA-256 verified against the requested sig before being returned — bad bytes are dropped and the next candidate is tried. The fetcher already knows the type from the referring context, so it does not need a typed path.

> **Implementation lag:** the shipped content-broker (`#httpPathForType`) and relay HTTP host currently use typed paths with extensions (`/__layers__/<sig>.json`, `/__resources__/<sig>`, `/__dependencies__/<sig>.js`). The bare-sig form (§21.10) is the target; the typed paths remain valid during migration and the relay can serve both while the cutover happens.

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
https://<domain>/<sig>            ← any content-addressed blob (§21.9 universal handler, §21.10)
https://<domain>/__roots__/       ← discovery index (domains served)
https://<domain>/__roots__/<dom>/ ← discovery index (attestation sigs)
wss://<domain>/                   ← WebSocket relay endpoint
```

Build output (`hypercomb-essentials/dist/`) is copied to `hypercomb-relay/content/` by `scripts/copy-to-dcp.ts` on every build, so the operator's own machine is always serving the latest content their build produced. See `memory: project_domain_as_identity.md` for the full "host is a verb" doctrine.

> **Implementation lag:** the shipped relay HTTP host currently serves typed paths with extensions (`/__layers__/<sig>.json`, etc.) and a `manifest.json`. The bare-sig universal handler (§21.9) and the retirement of `manifest.json` in favor of `__roots__/` attestations (§21.9) are the target; the relay can serve both forms during cutover.

### 21.8 Daisy-chain federation (structural property)

The URL shape in Section 21.7 is **identical at every host**, and the signature universe is global. The combination produces a structural federation property: **adoption IS mirroring**.

When `jwize.com` adopts `sigX` from `alice.dev`:

1. HTTPS-GET `https://alice.dev/<sigX>` (flat sig endpoint, §21.10)
2. SHA-256 verify the bytes against `sigX`
3. Write to `jwize.com`'s local pool

From that moment, any peer asking `jwize.com` for `sigX` receives byte-identical content to what `alice.dev` would have served. The daisy chain forms with no integration code, no auth handshake, no registry entry — just the URL shape and the sig universe.

```
       sigX                             sigX                             sigX
alice.dev ────────── HTTPS-GET ──────── jwize.com ──── HTTPS-GET ──── carol.io
       │                                  │                              │
       └─ original capture                └─ adopted from alice           └─ adopted from jwize
                                            mirrors at /<sigX>
                                            serves to her community
```

Implications encoded in this protocol:

- **`hc:community:domains` is dual-purpose** — the same list names (a) hosts the broker trusts for HTTP-direct queries (Section 21.3 binary in-community gate), and (b) hosts the operator can choose to adopt content *from* (turning HTTP-direct query candidates into mirror sources).

- **Network resilience is automatic** — if `alice.dev` goes offline, every host that adopted any of her sigs continues to serve them. The community is a redundancy graph, not hub-and-spoke. The only way a sig becomes globally unavailable is if no operator anywhere has adopted it.

- **The DAG is the protocol** — operators form a directed "I feed from these hosts" graph. There is no central registry of edges; the graph is emergent from each operator's adoption choices. Walking the chain backward from any sig finds who adopted it; walking forward finds who they fed.

- **Overlap is the join** — where two hosts adopt the same sig, they structurally overlap on that sig. The overlap doubles capacity for that content (two parallel HTTPS sources) and connects the two operators' communities through the shared sig.

- **Federation is byte-copy, no protocol** — adding a feed source is just adoption. There is no separate "federate with alice.dev" handshake. The mechanism doesn't distinguish "I authored this" from "I adopted this from alice.dev" — both are "`jwize.com` has these bytes at this URL."

Provenance (who originally captured, who adopted from whom, who endorsed whom) is a separate concern, layered on top via the witness graph and community membership. The content itself is universally addressable; trust is per-operator.

#### 21.8.1 Subscription and co-hosting (upstream propagation)

§21.8 covers *downstream* flow — one-shot adoption, content pulled toward whoever wants it. The complementary direction is *upstream*: a subscriber tracks a producer continuously, so the producer's updates propagate up automatically.

**Subscription is the cross-domain form of lineage-pull.** Within one domain, changing a cell re-signs every ancestor to root (§21.11.2). Across domains it's the same mechanic: a parent domain authors an aggregate layer that references a child domain's root **by sig**, exactly like any child reference. When the child produces a new root, that child-sig changed, so the parent's aggregate must re-point and re-cascade. Subscription is the trigger that carries the child's new root up.

**Mechanism — reuses every primitive already defined:**

```
child.com commits → new root R → backed up + receipted (§21.11)
       ▼
child.com ANNOUNCES "latest root = R" on the mesh         (a layer sig + domain — §21.4 layer-only)
       ▼
parent.com (subscribed to child.com) receives R into a PULL QUEUE
       ▼
parent drains: GET each cascade sig + closure-minus-what-parent-has   (HTTP-direct, §21.11.2)
       ▼
parent verifies child's attestation signature (identity) + each sig (integrity)
       ▼
queue empty → parent now CO-HOSTS child.com up to R
       ▼
parent (if it has parents) announces ITS new root → propagates up
```

**The pull queue is the mirror image of the §21.11 push queue** — same primitive, opposite direction:

| | Push queue (§21.11) | Pull queue (subscription) |
|---|---|---|
| Direction | authoring → your own host | subscribed child → parent |
| Fed by | your commit's cascade sigs | child's announced cascade sigs |
| Drains by | `PUT` each layer | `GET` each + closure delta |
| Per-item confirm | receipt = host serves it | verify = sig matches + stored |
| Loop closes when | queue empty → "backed up" | queue empty → "caught up", now co-hosting |

So the queue is the universal sync unit; **direction is the only difference between backing up your own work (push) and mirroring someone you follow (pull).**

**Subscription = co-hosting.** Once the parent has drained the pull queue, `parent.com/<sig>` and `child.com/<sig>` return byte-identical content. The parent is now a full replica. This produces **replication-follows-interest**: every subscriber is a new origin, so popular content accumulates replicas organically (every aggregator that subscribes becomes a mirror) while niche content is hosted by exactly whoever cares. The subscription graph IS the replication topology — no central replication policy.

**Hosting ≠ attesting.** Co-hosting spreads *bytes*, not *identity*:

| | What it is | Who can do it | Spreads how |
|---|---|---|---|
| **Hosting** | serving bytes at `your.com/<sig>` | anyone | permissionless, replicable |
| **Attesting** | authoring + signing a root | only the domain's key | identity-bound, cryptographic |

A reader pulling alice's content *from jwize.com* still verifies alice's attestation signature — so jwize is a **replica, not an impersonator**. You can't fake being alice by hosting her bytes; you can only relay them, and the signature is checked regardless of relay. Hosting stays cheap and spreadable (resilience); identity stays a signature (trust).

**`__roots__/<domain>/` is the multi-tenancy.** A subscriber grows sibling domain folders:

```
jwize.com/__roots__/
  jwize.com/    ← own attestations
  alice.dev/    ← alice's, mirrored via subscription (co-hosted)
  bob.io/       ← bob's, likewise
```

`GET jwize.com/__roots__/` lists everyone jwize co-hosts — jwize advertising "here's whose content I serve." Readers discover replicas by which domain folders a host carries.

**Other properties:**
- **Deliberate redundancy** — §21.8's resilience was incidental (someone happened to adopt); subscription makes it intentional (a parent commits to mirroring a child, guaranteeing survival if the child goes offline).
- **Address-graph density** — each co-host is another domain that serves the sig, another fallback in the `{ bytes, domains }` cascade (§21.5). Interest → co-hosts → resolution redundancy.
- **Cycle-safe** — mirroring a child's content is *pool growth*, not a root change; it doesn't re-sign the parent's own authored roots. So A↔B mutual subscription converges and goes quiet; only deliberately authoring an aggregate layer creates a new root.
- **Cost is bounded** — opt-in (you chose to subscribe), content-addressed (a sig shared across subscriptions stored once), GC-able (stop subscribing → unreferenced sigs collectable). Serving-what-you-mirror is the default; private backup-only mirroring is an access-control layer on top.

### 21.9 Host filesystem layout

Because signatures are universal addresses *and* every layer transitively references its own children (sub-layers, bees, dependencies, resources), host storage organizes into typed pools — and **the folder path encodes the Content-Type at whatever granularity you want.**

```
content/                                  ← internal STORAGE layout (not the URL — see §21.10)
  __layers__/<sig>                         → application/json
  __bees__/<sig>                           → application/javascript
  __dependencies__/<sig>                   → application/javascript
  __resources__/image/png/<sig>            → image/png        (MIME from subfolder)
  __resources__/image/webp/<sig>           → image/webp
  __resources__/audio/mpeg/<sig>           → audio/mpeg
  __roots__/<domain>/<sig>                 → application/json (attestation)
```

The folder tree IS the type metadata — no sidecar files, no content sniffing, no separate MIME store. The host files content into its type folder at ingest (it knows the type then), and the type is recoverable from the path forever. Resources subdivide by MIME; the same trick can shard by hash-prefix (`…/png/ab/cdef…`) for large pools without changing anything observable.

This is **storage layout, not URL shape**. The read URL is a bare `/<sig>` (§21.10); the pools exist only inside the host. No `manifest.json` with expanded `bees[]`/`layers[]` arrays — those arrays were walk results, not configuration, and every layer already references its own children.

**Resolution: universal handler over an in-memory key index.** The host reads every sig filename into memory at startup — just `readdir` per pool; keys are 64-hex, tiny (~64 B + a pool/type tag each, ~10 MB per 100 K sigs). A request resolves O(1):

```
GET /<sig>  →  index lookup
                hit  → serve bytes from its pool, Content-Type from its folder path
                miss → instant 404  (no filesystem probing — misses were probing's worst case)
```

The in-memory key set is not just a GET cache — it is the **membership oracle the whole system queries**:
- **GET resolution** — is the sig present? what type? (lookup → pool + Content-Type)
- **Push dedup** (§21.11) — "does my host already have this sig?" → skip vs enqueue
- **Pull dedup** (§21.8.1) — "is this in my pool?" → closure-minus-what-I-have
- **Address graph** (§21.5) — "what do I serve?" → the key set itself

It is a pure cache over the filesystem: rebuilt by re-scanning on startup, updated incrementally on PUT/GC, never a source of truth. Probing the pools directly is the cold path (and the rebuild path); the index is the warm path. Filesystem stays truth. (This is the host-side twin of the warmup/preloader pattern — warm the keys, serve instant.)

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
GET /__roots__/                  → list of domains this host serves (mutable)
GET /__roots__/<domain>/         → list of attestation sigs for that domain (mutable)
```

The relay's HTTP host serves directory listings trivially. `__roots__/<domain>/` is the *discovery index* — a mutable listing of attestation sigs. The attestation **bytes** those sigs name resolve through the same universal `/<sig>` handler as everything else (immutable, edge-cached). So the only mutable surface is the listing; everything it points at is immutable content. No `roots.json`, no `index.json`, no manifest-merge logic.

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
GET  /<sig>            → universal handler: ANY content-addressed blob
                         (layer / bee / dep / resource / attestation).
                         Resolved via the in-memory key index; Content-Type
                         from the blob's pool/subfolder. Immutable → cached
                         forever (§21.10). 404 if the sig isn't held.
GET  /__roots__/              → discovery index: domains this host serves (mutable)
GET  /__roots__/<domain>/     → discovery index: attestation sigs for a domain (mutable)
```

Two surfaces, cleanly split: **immutable content at `/<sig>`** (everything — including attestation bytes — cache-forever) and the **mutable discovery index at `/__roots__/`** (revalidated). Sig reads never filter by domain — domain scoping appears only in the discovery index. There are no merge endpoints and no expansion-manifest routes. The `__` prefix on `__roots__` never collides with a 64-hex sig, so routing is unambiguous: match `/<64-hex>` → universal handler; `/__roots__/…` → discovery; else 404.

**Garbage collection is opt-in.** The pool is durable by default; the rule is *never delete from `__layers__/`, `__bees__/`, `__dependencies__/`, `__resources__/` unless an explicit GC phase runs.* A future GC walks every attestation in every `__roots__/<domain>/`, transitively walks the layer trees, marks reachable sigs, then trims unreferenced ones (subject to a configurable retention window). Operator-initiated only; never automatic.

### 21.10 Flat sig URLs and immutable caching

The read endpoint for any content-addressed blob is a **bare signature** — no type prefix, no extension:

```
https://<domain>/<sig>
```

This drops *both* the extension (`.json`/`.js` — build-tooling residue) *and* the type prefix (`__layers__/` etc. — which moves to internal storage, §21.9). The URL commits to nothing but the sig. Content-Type comes from the host's pool/subfolder via the in-memory index (§21.9); the consumer also knows the type from the referring context (a sig in a layer's `bees[]` is a bee), so neither side needs the URL to carry it.

**Why bare-sig URLs are the right address:**

- **The address IS the identity.** Sig is the universal name; prefix and extension were both redundant metadata.
- **Format-agnostic.** If a blob's representation evolves (JSON → CBOR → MessagePack), the URL never moves — the bytes change, so the sig changes, but the *scheme* of the address is stable.
- **ESM still loads.** `import('https://host/<sig>')` evaluates as a module when the host returns `Content-Type: application/javascript` (which it does for bee/dep sigs, resolved by pool). The loader doesn't require a `.js` in the URL.

**Immutable caching — the built-in CDN.** A sig is the SHA-256 of the content, so `<domain>/<sig>` is an **immutable URL by construction**: the bytes there can never change. Serve it with:

```
Cache-Control: public, max-age=31536000, immutable
```

and every cache layer holds it forever with zero invalidation logic — browser cache, service worker (cache-first, no staleness risk), reverse proxy, and the CDN edge. This is the same content-hashed-asset trick the modern web already uses (`app.a3f4b2.js`), applied *universally* because every blob already is its hash.

**This is what makes home-hosting scale.** The weakness of running `jwize.com` off a home machine via Cloudflare Tunnel is residential upload bandwidth. But with immutable `/<sig>` URLs, **Cloudflare's edge caches every blob after the first fetch** — the home machine serves each unique sig once, globally; the edge serves the millions of repeat reads. The home box becomes an origin-of-last-resort, not a bottleneck. The grid doctrine (everyone hosts their own domain) only works at scale *because* the URLs are immutable. It is load-bearing, not cosmetic.

**The only mutable surface** is the discovery index (`/__roots__/`, `/__roots__/<domain>/`) — it must revalidate (new attestations appear). Perfect split: a mutable index pointing at immutable content. There is no `manifest.json` (retired in favor of `__roots__` attestations); the named `__roots__/` routes are the sole non-sig paths.

### 21.11 Host sync — continuous backup, cascade queue, receipts

hypercomb.io is the **authoring** surface; the operator's host is the **backup + serve** surface. Sync is one-way push (browser → host), continuous, and acknowledged by receipts that close the loop back to the authoring surface.

#### 21.11.1 Save / branch / restore model

- **Root (HEAD)** — the live state. Advances on *every* change. Continuously backed up to the host. The latest is always pushed; you never depend on a manual save to avoid loss.
- **Branch** — a *named freeze* of the root at a moment. `save as branch v1` (from DCP or the host domain) writes a named attestation pointing at the current root. Immediately after: root == v1. Keep working: root advances, v1 stays frozen; changes accumulate.
- **Restore** — moving HEAD back to a branch's root. Realized as a **"Make HEAD"** append (see the linear-history model): new ops are appended that bring the live state to equal the branch's root. History stays linear and append-only — restoring is a forward entry, never a truncation or fork.

A "branch" here is a **name on a merkle root**, not a fork in the op-history. The history remains one linear chain; only the *labels* branch. This is consistent with the linear-append-only history model.

**Restore guard.** Restoring moves the active line back. Changes since the last save aren't erased — they remain in the layer pool and the linear history — but if the current root wasn't *named*, it becomes orphaned: retained yet unreachable by label, findable only by scrubbing the timeline. So before restore: either **save current as a new branch** (keep it reachable by name) or **explicitly discard**. "Lost" means lost-from-the-active-line, never physically deleted — the append-only invariant holds.

#### 21.11.2 The sync unit is a cascade chain, not one layer

Layers reference their children by signature, so changing one cell re-signs that cell's layer, which changes its parent's bytes (the parent holds the child's sig), which re-signs the parent — up to the root (lineage-pull). **One user action re-signs every ancestor on the path to root:**

```
edit cell C at depth 4  →  new sigs for [L_C, L_3, L_2, L_1, ROOT]   (5 layers from 1 action)
```

One commit marker per action (the commit is atomic), but the commit yields a *chain* of new layer sigs. All are real intermediate state; all must reach the host.

**The push set = the new root's transitive closure minus what the host already holds.** The discriminator is not "layer vs resource" — it is "does the host already have this sig?":

| Kind | Pushed? | Why |
|---|---|---|
| Cascade layers | **always** | every ancestor re-signs → new sigs by construction → host can't have them yet |
| Newly-authored resource (pasted image, new blob) | **yes** | new bytes → new sig → not yet on host |
| Resource merely *referenced*, not added | **no** | sig already exists on host; content-addressing dedups it |
| Dependencies (bee/namespace bundles) | **no** | package-level, immutable, shipped at install |

So the rule is **push what the host lacks**, and "cascade-layers-plus-any-new-resources" falls out of it automatically. Dedup makes re-use free: reference the same image in ten tiles → push it once; the other nine references resolve to a sig the host already serves. How "new vs already-there" is known: the receipt-maintained known-on-host set. Any sig in the new root's closure not in that set is enqueued (layer or resource); anything already receipted is skipped.

**Channel distinction.** This is the sync/push side — HTTP PUT to *your own* host. It is separate from the mesh, which carries layer sigs only (§21.4); resources travel HTTP-direct on the *pull* side. Pushing a new resource to your host over HTTP does not touch the mesh, so there is no conflict with layer-only-mesh. Backup ≠ broadcast.

#### 21.11.3 Durable local queue + receipts

```
commit → cascade yields [L_C, L_3, L_2, L_1, ROOT]
       ▼
enqueue all sigs to a DURABLE local queue (OPFS-backed; survives offline + restart)
       ▼
drain (bottom-up): PUT each layer to the host
       ▼
RECEIPT per layer = confirmed read-back (host serves the sig, HEAD 200) — NOT "PUT returned 200"
       ▼
clear a queue entry only on its receipt; retry until received
```

**Receipt = confirmed read-back, never a bare PUT 200.** A `PUT` returning success does not mean the bytes are serving — proven by the deploy-pipeline silent-drop (blobs that 404'd after a "successful" upload). The queue entry stays open until the host actually serves the layer. Nothing is fire-and-forget.

**Two granularities:**

- **Per-layer receipts** — the queue's internal completeness tracking.
- **Root receipt** — the user-facing answer to "you got my latest update?" Because a branch attestation is gated on all cascade ancestors being present, a confirmed root sig *implies* the whole chain landed. The root receipt is the single "backed up" signal.

#### 21.11.4 The loop closes at hypercomb.io

The receipt must reach the authoring surface — an open loop is the silent-drop failure mode. The HostSync drone receives the confirmed read-back and `emitEffect('sync:state', { root, status })`; UI components `onEffect` it. EffectBus last-value replay means a panel mounting later still sees the current state.

Two distinct confidence levels surface:

- **Saved locally** — OPFS commit, instant, always true.
- **Backed up** — host receipt confirms it *serves* the latest root.

```
queue draining, root not yet confirmed   → "syncing…"
root receipt received                      → "backed up to <domain>"
queue stuck (offline / no receipt)         → "pending — not yet backed up"
```

#### 21.11.5 Branch-attestation gate

`save as branch` may only attest a root once its *entire closure* is receipted — all cascade layers **and** any newly-authored resources the root transitively references (queue drained for that root). Otherwise the attestation would point at a root whose ancestors or resources aren't fully present on the host. Empty queue is the green light.

The same drain gate governs **announcing to subscribers** (§21.8.1): once the root receipt closes the loop, the operator announces "latest root = R" on the mesh so subscribed parents feed their pull queues. Never announce a root whose closure your own host can't yet serve — backup → receipt → announce, in that order. The push queue (this section) and the subscriber's pull queue (§21.8.1) are the same primitive pointed in opposite directions; the announce is the handoff between them.

#### 21.11.6 Reconciliation on reconnect

"You got my latest update?" is also asked proactively on reconnect/startup:

```
hypercomb.io → host: "latest root you hold for <domain>?"
  host behind  → drain the queue (push the gap)
  host equal   → fully synced
  host ahead   → another device pushed → pull (sync's read side)
```

The same handshake, on a timer/reconnect rather than per-commit. This is what makes multi-device safe: each authoring instance reconciles its latest root against the host, and the receipt is the shared truth.

#### 21.11.7 Offline accumulation policy

Ten rapid offline changes produce ten cascades; early intermediate roots are superseded by reconnect time. Two policies:

- **Push them all** (default) — every committed state recoverable; honors time-travel + append-only; more receipts.
- **Coalesce** (opt-in) — push only layers reachable from states you keep; fewer pushes, loses fine-grained scrub points between offline edits.

Default is push-them-all, matching the durable-pool posture. Coalescing is opt-in compaction, same stance as GC (§21.9).

### 21.12 Write contract and authorization

§21.1–21.11 specify reading, resolving, and the *flow* of pushing. This section pins how content is actually accepted **onto** a host. There are two write paths, with different trust:

```
PUT /<sig>                       → store a content blob (layer/bee/dep/resource)
PUT /__roots__/<domain>/<sig>    → store an attestation
```

**Content PUT is self-verifying.** On `PUT /<sig>`, the host computes `sha256(body)` and **rejects unless it equals the URL sig.** You cannot forge a sig without breaking SHA-256, so the bytes authenticate themselves — the host never has to trust the *content* of a PUT, only check the hash. Idempotent by construction: the same sig is the same bytes, so a re-PUT is a no-op (or an identical overwrite). This is why mirroring/adoption is safe — a host storing bytes pulled from anywhere can verify them locally before serving.

**Attestation PUT is identity-verified.** On `PUT /__roots__/<domain>/<sig>`, the host (a) checks `sha256(body) == sig` like any blob, *and* (b) verifies the attestation's `signature` field against `<domain>`'s authorized key(s) per §21.13. An attestation claiming `domain: "alice.dev"` is rejected unless signed by a key alice.dev has published. This is what enforces **hosting ≠ attesting**: anyone can store alice's *bytes*, but only alice's key can mint alice's *roots*.

**Who may write (storage authorization).** Storing bytes consumes the host's disk, so the *inbound* write path is gated by an **authorized-writer set** — pubkeys the operator permits to PUT, configured on the host:

- **Browser → own host** (the §21.11 backup): the operator's own device keys are authorized writers. Each PUT is signed by (or the session authenticated as) an authorized writer. This is the only path that needs inbound write-auth.
- **Host → own pool** (co-hosting via subscription, §21.8.1): the host *initiated* the pull, so it writes to its own pool with no inbound auth — there is no untrusted writer, just the host fetching what it chose to mirror.

So content-integrity is permissionless (the hash proves the bytes) while disk-write is permissioned (the authorized-writer set proves the *writer*). The two are orthogonal: a bad actor can neither forge bytes (SHA-256) nor fill your disk (writer auth) nor impersonate a domain (§21.13).

**The write isn't done until it serves.** Per §21.11.3, the receipt is confirmed read-back, not a PUT 200. So the write contract is *accepted, stored, and serving* — a host that returns 200 but can't subsequently serve the sig has not fulfilled the write. (This is the deploy silent-drop lesson made part of the contract.)

### 21.13 Domain ↔ key binding (the trust root)

Attestation verification (§21.8.1, §21.12) reduces to one question: *given an attestation claiming `domain: "alice.dev"` signed by key K, how does a verifier know K is legitimately alice.dev's?* The answer uses the web's existing two-factor identity — **a signature proves you hold the key; DNS + TLS proves you control the domain** — and binds them by having the domain publish its keys over its own TLS:

```
GET https://alice.dev/__keys__   → alice.dev's authorized public key(s)   (mutable; revalidated)
```

Because that endpoint is served over TLS *for alice.dev*, the CA + DNS system vouches that "alice.dev asserts these are its keys." No separate PKI is introduced — the binding rides on the same TLS that already authenticates the domain. Verification of an attestation is then:

1. Read the attestation's `domain` (alice.dev) and `signature` (by K).
2. `GET https://alice.dev/__keys__` (TLS-authenticated for alice.dev).
3. Confirm K is in the published set.
4. Verify the attestation signature with K.

Two independent attestations now agree: DNS+TLS says alice.dev endorses K, and K signed the root. Only when both hold is the attestation trusted.

**Properties:**

- **Key rotation** — alice.dev updates its published set. *Old* attestations signed by a retired key stay valid (they're immutable, content-addressed); *new* attestations use the new key. The set may carry validity windows, but the minimal form is just "current authorized keys."
- **Survives key loss** — because the binding is anchored in *domain control* (DNS/registrar), a lost signing key is recoverable: you still control alice.dev, so you publish a new key. This is exactly why domain-as-identity is more durable than pubkey-as-identity — the key can rotate under a stable name.
- **Not immutable-cached** — the key set is mutable (rotation happens), so unlike `/<sig>` content it must revalidate. It joins `__roots__/` as a mutable, named (non-sig) route with a short cache.
- **Composes with community trust** — `hc:community:domains` (§21.3) names the domains a verifier trusts; this binding resolves each trusted *domain* to the *keys* whose attestations it will accept. The trust graph is domain-keyed; the key binding is the domain→key lookup underneath it.

With this, the two verification primitives that the whole protocol rests on are both pinned: **content is verified by hash** (SHA-256, §21.6/§21.12) and **identity is verified by domain-published key over TLS** (§21.13). Everything else — resolution, federation, subscription, co-hosting, sync — is consequence.
