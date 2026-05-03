# hypercomb security policy

version: 2.0
last updated: 2026-03-02

---

## philosophy

hypercomb is presence-first. the system is designed so that being present in a
shared space is itself the permission model. there is no user database, no
account system, no credential store. data exists while participants are present
and expires when they leave. the security posture follows directly from this
constraint: what is never stored cannot be leaked.

core principles:

- **presence = permission.** participation in a live session is the only
  authorization required. there are no tokens, no login walls, no session
  cookies.
- **no extraction.** the system must never produce artifacts that allow
  reconstruction of a session after the fact. no server logs, no analytics
  payloads, no persistent identifiers.
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

key management is handled externally. the system does not generate, store, or
rotate private keys itself. the `NostrSigner` resolves keys in this order:

1. `window.nostr.signEvent` (nip-07 browser extension -- preferred)
2. `window.NOSTR_SECRET_KEY` (runtime injection)
3. `localStorage['hc:nostr:secret-key']` (developer override)
4. hardcoded dev test key (development only -- must not ship to production)

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

- all data sent to relays is visible to the relay operator and any
  subscriber on that relay. there is currently no encryption of event
  content.
- `created_at` timestamps are set from the local clock. this leaks
  approximate timing information to relays.
- the `x` tag (content-addressed signature) is visible in plaintext. this
  allows relay operators to observe which content hashes are being queried
  across sessions.

### connection security

- relay connections use `wss://` (tls). plaintext `ws://` connections to
  loopback addresses (`localhost`, `127.0.0.1`, `::1`) are gated behind an
  explicit opt-in (`hc:nostrmesh:allow-loopback` in localstorage).
- exponential backoff with jitter is applied on connection failures to
  prevent reconnection storms.
- the mesh can be stopped and all sockets torn down via `stop()`.

### signer security

- nip-07 browser extension signing is preferred because the private key
  never enters the application's javascript context.
- the fallback dev key (`FALLBACK_DEV_SECRET_KEY`) is a hardcoded test
  identity. it must be removed or disabled in production builds. any event
  signed with this key is trivially attributable.
- `localStorage['hc:nostr:secret-key']` is accessible to any code in the
  same origin. this is a convenience for development and must not be used
  for real identities.

---

## opfs (origin private file system) security

opfs is the only persistent storage mechanism. security properties:

- **origin-sandboxed.** opfs is scoped to the browser origin. cross-origin
  access is not possible.
- **no remote sync.** opfs data stays local unless explicitly published
  through the nostr mesh.
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
- **dev keys are for dev.** the fallback nostr signing key is for local
  development only. never use it to publish to public relays in a testing
  context where real users might encounter the events.
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
