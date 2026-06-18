# hypercomb security policy

version: 2.1
last updated: 2026-06-18

---

## philosophy

hypercomb is presence-first. the system is designed so that being present in a
shared space is itself the permission model. there is no user database, no
account system, no credential store — there is no server-side store of you to
breach. *shared* presence is what evaporates: a participant's live presence,
cursor, selection, and clipboard exist while they are present and leave nothing
behind on a relay when they go.

locally, though, everything you author is content-addressed and versioned in
opfs and persists durably by default; nothing crosses the network unless you
publish. so the security posture is two-sided: there is no remote account or
session artifact that can be leaked from a server, while your own durable data
lives in the origin-sandboxed opfs on your device (see the opfs section for its
at-rest properties).

core principles:

- **presence = permission.** participation in a live session is the only
  authorization required. there are no tokens, no login walls, no session
  cookies.
- **no extraction (server-side).** the network must never leave behind
  artifacts that allow a third party to reconstruct a session after the fact.
  no server logs, no analytics payloads, no remote persistent identifiers.
  (this is a *network* property — locally, your authored content is durably
  versioned in opfs by design; see the opfs section.)
- **minimal impact.** a compromised component should not cascade. drones are
  isolated by lifecycle, effects are scoped by name, and the ioc container holds
  only ephemeral references.
- **privacy first.** when a design choice exists between convenience and privacy,
  privacy wins.

---

## scope

this policy covers the following components of the hypercomb system:

### @hypercomb/core (zero runtime dependencies)

- **ioc container** -- `ServiceToken<T>`-based registration and resolution.
  holds ephemeral in-memory references only. no serialization, no persistence.
- **bee base class** -- `Bee` (specialized as `Drone`, `Worker`, or `QueenBee`) with `BeeState` lifecycle
  (`created -> registered -> active -> disposed`). auto-cleanup of effect
  subscriptions on dispose.
- **effectbus** -- typed pub/sub for drone-to-drone communication. in-memory
  only. last-value replay is scoped to the current session and cleared on
  `EffectBus.clear()`.
- **signatureservice** -- content-addressing via `crypto.subtle.digest('SHA-256')`.
  produces hex-encoded content hashes for identity and deduplication. not used
  for authentication or encryption.
- **effect types** -- declared side-effect categories (`filesystem`, `render`,
  `history`, `network`, `memory`, `external`) used for drone metadata.

### hypercomb-essentials

- **nostr mesh drone** (`NostrMeshDrone`) -- cross-device relay communication
  via nostr protocol (nip-01). connects to public relays over websockets.
  manages subscription buckets, ttl-backed caching, deduplication, and
  expiry rules.
- **nostr signer** (`NostrSigner`) -- event signing via nip-07 browser
  extension or fallback key. delegates to `window.nostr.signEvent` when
  available. fallback dev keys must never be used in production.
- **mesh adapter drone** -- bridges the local effectbus to the nostr mesh
  for cross-device effect propagation.
- **pixi drones** -- rendering layer (pixijs 8). receives display state via
  effects. no network access.
- **input drones** (pan, zoom) -- user input handling. local only.

### hypercomb-web

- **angular 21 host application** -- serves as the shell. manages opfs
  (origin private file system) for local storage. no remote database.
- **layer system** -- dynamic loading of drone packages from opfs. import maps
  are resolved at boot from locally stored manifests.

### hypercomb-shared

- **opfs services** -- all persistent storage uses the origin private file
  system. data is sandboxed to the origin. no cookies, no indexeddb for
  sensitive data, no remote sync unless explicitly relayed through the mesh.
- **drone payload resolver** -- resolves and validates drone payloads from
  opfs-stored packages.

---

## cryptography

### current implementation

the system currently uses **sha-256 content addressing** for identity and
deduplication:

```
crypto.subtle.digest('SHA-256', bytes) -> hex string (64 chars)
```

this is implemented in `SignatureService.sign()`. the output is a deterministic
content hash, not a cryptographic signature in the authentication sense. it is
used to:

- generate stable identifiers for content payloads
- deduplicate mesh events across relays
- provide content-addressable references for the effectbus

### nostr layer cryptography

the nostr mesh layer relies on **nostr-tools** for event signing and
verification, which uses:

- **secp256k1** schnorr signatures (nip-01)
- **sha-256** event id derivation
- nip-07 browser extension delegation when available

when a nip-07 extension is present, key management is handled externally and the
application never sees the private key. otherwise the `NostrSigner` resolves a
signing key in this order (as of writing):

1. `window.nostr.signEvent` (nip-07 browser extension -- preferred; key never
   enters the app context)
2. `window.NOSTR_SECRET_KEY` (test / scripted runtime override)
3. `localStorage['hc:nostr:secret-key']` (persisted per-session key)
4. otherwise, **mint a fresh random 32-byte key**, persist it to localstorage
   (or hold it in memory if localstorage is unavailable), and use that

note there is no longer any shared, hardcoded fallback key — earlier builds
shipped a `FALLBACK_DEV_SECRET_KEY` constant, but the signer now mints a unique
per-session identity on a miss so two sessions never collide. a self-minted key
is unattested: it identifies a session but proves nothing about who is behind
it.

### what is not yet implemented

- **end-to-end encryption of mesh payloads.** relay content is currently
  plaintext json. future work should introduce aead encryption
  (e.g., xchacha20-poly1305) with session-derived keys (e.g., hkdf-sha256
  from a shared nonce) before relay transmission.
- **payload signing for local effects.** effectbus payloads are unsigned.
  a compromised drone could emit forged effects within the same session.
- **key rotation.** there is no automated key rotation mechanism for nostr
  identities.

### constraints

- no urls, relay addresses, or identifiers may appear inside encrypted
  payloads (when encryption is implemented). metadata must be separated from
  content.
- content hashes must not be reversible to source material. sha-256
  preimage resistance is assumed.
- the `SignatureService` must remain stateless. it takes bytes in and
  produces a hash. it must not cache inputs, log content, or retain
  references.

---

## ioc container security

the ioc container (`ioc.ts`) is a flat key-value map in memory. security
considerations:

- **no serialization.** the container is never serialized to disk, network,
  or any persistent medium.
- **no remote resolution.** all registrations are local. there is no
  remote service discovery.
- **lifetime scoping.** services registered via `ServiceToken<T>` exist only
  for the duration of the page session. a page reload clears the container.
- **no access control.** any code in the same origin can call `ioc.get()`.
  this is acceptable because the trust boundary is the browser origin, not
  individual modules. if origin isolation is compromised, the ioc container
  is not the primary concern.

---

## drone lifecycle security

drones follow a strict state machine: `created -> registered -> active ->
disposed`. security properties:

- **auto-cleanup.** when `markDisposed()` is called, all effectbus
  subscriptions are automatically unsubscribed. this prevents disposed drones
  from receiving or processing further effects.
- **no resurrection.** a disposed drone cannot transition back to an active
  state. the state machine is forward-only.
- **heartbeat gating.** `pulse()` checks `BeeState` before executing
  `heartbeat()`. a disposed drone is skipped silently.
- **effect metadata.** drones declare `listens` and `emits` arrays for graph
  visibility. these are informational and not enforced at runtime (enforcement
  is a candidate for future hardening).

---

## effectbus security

the effectbus is an in-memory pub/sub channel. it has no network surface.
security considerations:

- **same-origin only.** the effectbus is a singleton within the javascript
  execution context. cross-origin code cannot access it unless the origin is
  compromised.
- **last-value replay.** the bus retains the most recent payload per effect
  name. `EffectBus.clear()` must be called when tearing down a session to
  prevent stale data from leaking into a subsequent session on the same page.
- **no authorization.** any drone or code in the same context can emit or
  subscribe. this is by design (presence = permission). there is no
  per-effect access control.
- **cleanup discipline.** drones must unsubscribe on dispose. the base class
  handles this automatically, but manually created subscriptions outside the
  drone lifecycle are the caller's responsibility.

---

## nostr mesh security

the nostr mesh drone communicates with public relays. this is the primary
network attack surface.

### relay trust

- relays are untrusted by default. the mesh treats all inbound events as
  potentially malicious.
- event deduplication uses a capped ring buffer (`recentCap: 2048`) to
  prevent replay floods.
- subscription ids are randomized per bucket to prevent cross-subscription
  correlation.
- the mesh enforces kind filtering and tag-based routing. events that do not
  match the expected kind or `x` tag are silently dropped.

### data exposure

- the mesh is **currently plaintext json**. all data sent to relays is
  visible to the relay operator and any subscriber on that relay. there is
  no confidentiality on the wire today — aead encryption of event content is
  future work (see *future work* and *what is not yet implemented*). do not
  treat mesh traffic as private.
- `created_at` timestamps are set from the local clock. this leaks
  approximate timing information to relays.
- the `x` tag (content-addressed signature) is visible in plaintext. it is a
  sha-256 **content hash**, used for addressing and deduplication — not an
  authentication signature — so it does not authenticate the sender, but it
  does let relay operators observe which content hashes are being queried
  across sessions.

### connection security

- relay connections use `wss://` (tls). real (deployed) origins seed the live
  bootstrap relay `wss://jwize.com` **by default** (since 2026-06-10); a public
  origin must never dial loopback. local dev origins instead seed
  `ws://localhost:7777`, which is loopback-only and a known dev/prod
  port-collision hazard. plaintext `ws://` connections to loopback addresses
  (`localhost`, `127.0.0.1`, `::1`) are gated behind an explicit opt-in
  (`hc:nostrmesh:allow-loopback` in localstorage); relay selection can be
  overridden with `hc:nostrmesh:use-live-relay` / `hc:nostrmesh:relays`.
- exponential backoff with jitter is applied on connection failures to
  prevent reconnection storms.
- the mesh can be stopped and all sockets torn down via `stop()`.

### signer security

- nip-07 browser extension signing is preferred because the private key
  never enters the application's javascript context.
- without an extension, the signer mints a fresh random per-session key
  (no shared, hardcoded fallback identity remains). this key is
  **unattested** — it gives a session a stable pubkey but proves nothing
  about the human behind it, so a mesh signature is an integrity/origin
  hint, not a vetted identity. treat self-minted-key events accordingly.
- `localStorage['hc:nostr:secret-key']` (and the minted key persisted there)
  is accessible to any code in the same origin. an attacker with same-origin
  code execution can read or impersonate the local identity.

---

## opfs (origin private file system) security

opfs is the only persistent storage mechanism. security properties:

- **origin-sandboxed.** opfs is scoped to the browser origin. cross-origin
  access is not possible.
- **local-first, network opt-in.** opfs data is durable and stays on the
  device by default; nothing crosses the network unless you publish. when you
  do publish, the **primary resource transport is http-direct**: `Store.getResource`
  self-heals a missing resource by fetching `GET /<sig>` from an operator domain
  (via `ContentBroker.#fetchOverHttp`), sha-256-verifies the bytes, and writes
  them through to opfs; `HostSync` pushes local bytes back out with `PUT /<sig>`.
  the nostr mesh itself carries only layer **signatures** plus presence/visual
  metadata, not the heavy content bytes — the one exception is the swarm-preview
  path, which still relays small (`<= 256 KB`) base64 image bytes inline (kind
  30201). layers, dependencies, and bees are opfs-only on the render path and
  heal only via adopt / install / sync; only resources self-heal over http at
  render time.
- **no encryption at rest.** files stored in opfs are not encrypted. any
  code running in the same origin can read them. sensitive data should not
  be stored in opfs without application-level encryption.
- **layer loading.** drone packages are loaded from opfs via dynamic import
  maps. integrity is enforced at three layers: install time
  (`LayerInstaller` verifies downloaded bytes against expected signature),
  bee load time (`ScriptPreloader` re-verifies opfs bytes before import),
  and dependency load time (`DependencyLoader` verifies before import).
  signature mismatch = reject, no fallback. `SignatureStore` caches
  trusted signatures to avoid redundant sha-256 hashing on subsequent loads.

---

## testing guidelines

- use **local or development environments** for all security testing. do not
  test against production relays or other participants' live sessions.
- **respect relay rate limits.** the nostr mesh uses exponential backoff.
  testing tools should do the same.
- **do not attempt deanonymization.** the system is designed to make
  identity correlation difficult. testing must not attempt to reverse this
  property for other participants.
- **dev keys are for dev.** scripted overrides (`window.NOSTR_SECRET_KEY`) and
  any persisted `hc:nostr:secret-key` are for local development only. never use
  a shared or pinned test key to publish to public relays in a context where
  real users might encounter the events.
- **clean up after tests.** call `EffectBus.clear()` and `stop()` on the
  mesh drone to ensure no state leaks between test runs.

---

## vulnerability reporting

if you discover a security vulnerability, please report it through one of the
following channels:

- **email:** jaime@pointblanksolutions.ca (preferred for sensitive issues)
- **github:** open a private security advisory on the repository at
  https://github.com/hypercomb/social

please include:

- a clear description of the vulnerability
- steps to reproduce
- affected components (core, essentials, web, shared)
- potential impact assessment

we will acknowledge receipt within 48 hours and provide an initial assessment
within 7 days.

---

## disclosure policy

we follow **coordinated disclosure**:

1. reporter submits vulnerability through a private channel.
2. we confirm and assess severity.
3. we develop and test a fix.
4. we coordinate a disclosure timeline with the reporter.
5. fix is released and advisory published simultaneously.

we ask reporters to allow a reasonable window (typically 90 days) for a fix
before public disclosure.

---

## safe harbor

security researchers acting in good faith are protected:

- we will not pursue legal action against researchers who follow this policy.
- we will not report researchers to law enforcement for activity conducted
  under this policy.
- good faith includes: testing only against your own instances, not accessing
  other users' data, not disrupting live sessions, and reporting findings
  promptly.

---

## future work

the following security improvements are planned or under consideration:

- **aead encryption for mesh payloads.** encrypt event content before relay
  transmission using xchacha20-poly1305 with session-derived keys.
- **effectbus authorization.** optional per-effect access control to limit
  which drones can emit or subscribe to specific effect names.
- ~~**opfs integrity verification.**~~ **implemented.** three-layer signature
  verification (install, bee load, dep load) with `SignatureStore` caching.
- **drone effect enforcement.** runtime enforcement of declared `listens`
  and `emits` metadata, preventing undeclared effect usage.
- **key rotation for nostr identities.** automated or prompted key rotation
  with continuity proofs.
- **relay pinning.** allow users to pin trusted relays and reject connections
  to unknown relays.
- **content expiry proofs.** cryptographic proof that expired content has been
  purged from local caches.
