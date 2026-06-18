# Hypercomb Network Architecture

The canonical reference for how participants, hosts, installers, and content
flow through the hypercomb network. Captures the model agreed during the
2026-06 architecture conversation.

License: CC BY-SA 4.0.

---

## TL;DR

The network is **four orthogonal roles** any domain can play:

| Role | What it does | Trust level |
|---|---|---|
| **Installer** | Serves the DCP Angular app (the installer UI) | Single canonical build; many possible mirrors; sig-verified |
| **Mesh** | Runs a WSS relay for swarm meetings; passes layer-sig meta plus a bounded ≤256 KB image-preview channel | Per-operator; signed events; sha256 gates every preview byte, so it can't forge durable content |
| **Storage** | Serves `/<sig>` byte content over HTTP | Single-tenant per host; sha256 makes tampering impossible |
| **Identity** | DNS + pubkey attestation; community-graph vertex | Per-domain; community-vouched |

Domains pick whichever subset of roles they want. **Storage and mesh are
operator-controlled. Installer is canonical (or a sig-verified mirror).
Identity is the operator's domain itself.**

**The trust path is short:** content integrity by sha256, location by
operator domain, code integrity by build-sig comparison against canonical.
No central byte chokepoint; no single point of failure beyond the project's
canonical build signature.

---

## The four roles, in detail

### Installer (code)

The DCP Angular app — the UI participants use to review and finalize
adoption of content (tiles, bees, dependencies, resources).

- **One canonical build** at a time, signed by the project. The buildSig
  is published at `/.well-known/hypercomb-installer.json` on canonical
  and any mirror.
- **Many possible servers.** Canonical
  (`diamondcoreprocessor.com`) is the default. Any operator who wants to
  mirror can run `npm run serve:dist` from `diamond-core-processor/` —
  the script serves byte-equal dist with the same manifest. Participants
  verify the served buildSig matches canonical's published buildSig.
- **Trust attaches to the build's signature, not to the server.** A
  mirror serving the byte-equal dist is structurally indistinguishable
  from canonical. A mirror serving DIFFERENT bytes shows up as a
  buildSig mismatch in the manifest — surfaceable to the participant.

**Why this matters:** the installer's code runs in the participant's
browser with access to whatever OPFS that origin holds. A malicious
installer = total compromise of everything at that origin. Narrowing
trust to a single signed build (regardless of mirror count) bounds the
attack surface to one auditable codebase.

### Mesh (relay)

A WSS endpoint hosting swarm meetings. Passes signed Nostr events
between participants in the same swarm.

- **Per-operator.** Each operator runs their own relay at their domain.
- **Almost no bytes flow through here — meta plus the swarm-preview
  exception.** Tile visuals, presence signals, layer-sig announcements,
  peer pubkeys. The byte content of any signature is fetched separately
  via HTTP to the storage host (`GET /<sig>`). The one genuine byte path
  is the swarm-preview companion event (Nostr `kind:30201`): so a peer
  can *see* an image before adopting, image bytes ride inline as base64,
  capped at 256 KB (`MAX_RESOURCE_BYTES` in `swarm.drone.ts`). Anything
  over the cap, and all non-image content, stays sig-only and is pulled
  HTTP-direct from a host. So the mesh is layer-sigs-only by doctrine,
  with this one bounded image-preview channel.
- **Mesh hosts don't gatekeep adoption.** Anyone in the swarm sees the
  same visuals; adoption is the participant's choice based on what they
  see + which publisher-domain the visual identifies.

**Why this matters:** keeping the mesh layer-sigs-only (modulo the
bounded ≤256 KB image preview above) means the relay is cheap to operate
(small messages, no disk pressure) and the mesh host can't tamper with
durable content — sha256 still gates every preview byte on the receive
side, and the authoritative copy is always pulled HTTP-direct from a
host, never trusted from the relay.

### Storage (bytes)

HTTP endpoints serving signature-addressed content: `GET /<sig>` returns
the bytes whose sha256 is `<sig>`. This is the **DNA identity anchor** of
the whole network: the signature *is* the address. Every artifact the
hive composes from — layers, dependencies, bees, resources, content — is
a Distributed Network Artifact named by the sha256 of its bytes,
immutable, and deduplicated by that address. `GET /<sig>` is the wire
form of that identity. (See `dna.md` for the artifact taxonomy and why
content-addressing makes these artifacts "DNA".)

`GET /<sig>` is the **primary, default** resource transport — HTTP-direct
to operator domains (`ContentBroker.#fetchOverHttp`, with a `Store` host
fallback and `HostSync` `PUT` for writes). There is no hard-coded central
CDN default any more: `#getFallbackDomains` is empty unless an operator
deliberately adds mirrors via `hc:fallback-domains`.

- **Single-tenant per host.** The operator's own authored content lives
  at the operator's host. **Other peoples' bytes do not live at your
  host.** A peer who wants their content durably available needs their
  own storage host (typically their own domain).
- **Sha256 makes integrity unforgeable.** A storage host can deny you
  bytes (DoS) but cannot poison them — modified bytes have a different
  sig, so they wouldn't match what was requested.
- **Cloudflare-edge cacheable — embraced as a scale primitive.**
  `/<sig>` is content-addressed and immutable; `Cache-Control: immutable`
  headers let Cloudflare's edge hold every byte globally on first fetch.
  Because the address *is* the hash, an edge cache can never serve the
  wrong bytes — caching immutable `/<sig>` is free scale, not a trust
  hole.

**Why this matters:** restricting storage to single-tenant maintains a
clean trust attribution — "alice.com bytes = alice authored them." A
multi-tenant host (where strangers can push bytes through alice's
infrastructure) dilutes that attribution. The operator's domain is a
community-trust vertex; it should mean what it says.

### Identity (domain)

A domain (`alice.com`) with DNS and a TLS certificate. Optionally
attests to a Nostr pubkey via a well-known endpoint or signed event.

- **Domain-as-identity** is the protocol's trust primitive. Speakable
  names. DNS provides independent attestation. Survives key rotation.
- **Community trust graph** edges go domain → domain (or domain →
  pubkey-via-attestation). Operators endorse each other; participants
  resolve trust by graph traversal.

**Why this matters:** identity is what makes "alice.com bytes" mean
anything — a community-vouched domain has a reputation that signed
content inherits.

---

## The three trust tiers

Trust in this architecture is not a single primitive — it's a stack of
three independent layers that compose. Each layer is enforceable on its
own; combined, they let trust decisions be cheap, scalable, and
auditable.

```
LAYER             ENFORCED BY            WORKS WITHOUT       SCALES BY
───────────────   ─────────────────────  ──────────────────  ─────────────
Tier 1            math (sha256)          any human attention universal
  Cryptographic                                              (everyone gets it)

Tier 2            you (DCP toggle)       community           individual care
  Per-domain                                                  (per-participant)

Tier 3            community curation     manual approval     subscription
  Pheromones                                                  (one-to-many)
```

### Tier 1 — Cryptographic (math)

Every byte fetch ends with `sha256(bytes) === expected_sig`. If they
don't match, the bytes are rejected. **Tampering by any party in the
fetch path is mathematically impossible** because the participant is
verifying directly against the address.

- Costs zero ongoing attention
- Works regardless of trust state at the other layers
- Universal: applies to every participant on every fetch

The same sha256 that secures a single byte fetch also secures
*versioning*: artifacts compose upward, so a parent layer's signature is
a function of its children's signatures, and that cascade runs all the
way to a `rootLayerSig` (see `genome-primitive.md`,
`history-sigbag-as-root.md`). Trust-by-hash and version-by-merkle-root
are the same DNA primitive seen from two angles — verifying one byte and
verifying an entire tree are mechanically identical operations.

### Tier 2 — Per-domain (local)

What ships today is a single **binary trust list**: the `TrustService`
(`hypercomb-shared/core/trust-service.ts`) reads a localStorage key
`hc:community:domains` — a flat array of trusted source domains. When a
participant tries to enable an item whose source domain isn't on that
list, the UI prompts; an `allow-always` decision appends the domain to
`hc:community:domains` so the prompt doesn't fire again for that source.
A second, lower-priority localStorage key `hc:fallback-domains` (read by
`ContentBroker.#getFallbackDomains`, **empty by default**) lets an
operator add extra last-resort byte mirrors; sha256 still gates every
fetched byte regardless of which list a domain came from.

- Per-participant — each person's localStorage trust list is their own
- Manual approval — requires the participant's attention per source
- Foundation: even without communities, individual trust still works

> **Design note (not built as of 2026-06-18):** the richer
> `__domains__/<domain>/` registry described in earlier drafts — per-
> feature toggle state stored as an OPFS directory tree, with attestation
> feeds under `__communities__/` — is design-only. The shipped gate is
> the flat `hc:community:domains` allow-list above. Treat any reference
> to `__domains__/`/`__communities__` directories below as the target
> design, not current behavior.

### Tier 3 — Pheromones (social)

Communities of curators publish signed attestations vouching for
signatures. Subscribers' DCPs pull these attestation feeds and consult
them during trust evaluation. In the bee metaphor: **trail pheromones
marking verified paths through the sig space.**

Hostable: an attestation feed lives at a community's domain
(`alice-vouches.com/attestations.json`). Pull-based: subscribers fetch
periodically — no central broker, no push notifications. Composable:
multiple communities can attest to the same sig from different angles
("safe-for-design", "reviewed-for-perf"), and the participant
aggregates the perspectives.

Attestation shape:
```json
{
  "sig": "abc123...",
  "kind": "bee",
  "author-domain": "bob-the-author.com",
  "purpose": "tile rendering for journal",
  "reviewed-at": "2026-06-01",
  "outcome": "verified-safe",
  "reviewer": "alice-vouches.com",
  "signature": "<community's signed attestation>"
}
```

Other pheromone types in the design (not yet implemented):
- **Trail** (above) — "verified path to this sig"
- **Alarm** — "known-bad — avoid"
- **Queen** — "this is canonical authority"
- **Brood** — "fresh content needs attention"

### How the three layers cascade at trust-evaluation time

The cascade below is the **target shape**. Today only steps 1 and 2 are
wired, and step 2 is the flat `hc:community:domains` allow-list (not a
per-node toggle tree). Step 3 (`__communities__/` attestation feeds) is
design-only as of 2026-06-18.

```
1. Sig integrity: sha256(bytes) === sig?           ← Tier 1, always (built)
   if no → reject. Done.

2. Per-domain trust: source domain in the trust
   list (today: hc:community:domains)?             ← Tier 2 (built)
   if yes → use it.

3. Community attestation: any subscribed community
   in __communities__/ has attested?               ← Tier 3 (design-only)
   if yes → surface community's vouch + skip the
            manual prompt (the community already
            did the work).
   if no  → manual trust prompt (Tier 2 fallback).
```

### Verify and document — the social trust primitive

A community's job is two things in pair:

- **Verify** — actually look at the code; assert it does what it claims
- **Document** — record what it claims to do, who made it, history

Without documentation, "trusted" is opaque (alice says trust it — for
what?). Without verification, "documented" is unsourced (anyone could
claim anything). The pair together is the actual social trust primitive:
*someone you trust looked at it AND explained what they found.* This is
how Debian package signing works, how Mozilla extension review works,
how every healthy curation community works — applied to signature
granularity in this protocol.

---

## How adoption flows

The complete trip from "click adopt on a peer's tile in a swarm" to
"content rendered in the installer."

```
1. PARTICIPANT  is browsing at hypercomb.io  (consumer surface)
   ─ their browser at hypercomb.io origin runs the hive UI
   ─ subscribed to one or more swarm relays
   ─ swarm visuals stream in via WSS from each subscribed mesh host

2. MESH delivers a visual carrying:
       { tile-name, branchSig, publisher-domain }
   The participant SEES the peer's tile rendered at their current
   navigation location (witness view; union with own tiles).

3. PARTICIPANT clicks adopt on the peer's tile.
   ↓
   SwarmAdoptDrone reads peerEntry.layerSig + publisher-domain
   ↓
   window.dispatchEvent('portal:open', { branchSig, at, publisher-domain })

4. PORTAL OVERLAY opens an iframe to the canonical installer
   URL: https://diamondcoreprocessor.com/#branch=<sig>&at=<path>&from=<domain>
   ─ canonical = the project's published installer
   ─ buildSig verifiable via /.well-known/hypercomb-installer.json

5. INSTALLER  (DCP, running at diamondcoreprocessor.com origin)
   reads URL hash → fires synthetic adopt:meta
   ↓
   ContentBrokerDrone.adopt(branchSig)
   ↓
   fetches /<sig> from publisher-domain (NOT from canonical, NOT from
   the swarm host — directly from wherever the publisher's bytes live)

6. BYTES arrive
   ─ verified by sha256
   ─ written to OPFS at diamondcoreprocessor.com origin
   ─ branch section renders in the installer
   ─ participant reviews, toggles features, commits adoption
```

**Three different origins, three different roles, zero conflation:**

```
hypercomb.io               (consumer surface — outer frame)
diamondcoreprocessor.com   (installer — inner frame, code-trusted)
publisher's domain         (storage — byte source per visual hint)
                           e.g. alice.com / jwize.com / wherever
```

---

## What kinds of bytes live where

```
PUBLISHER (whoever authored a piece of content)
   │
   │ runs HostSync from their browser
   │ pushes signed PUT to their own storage host
   ▼
PUBLISHER's STORAGE HOST  ─── /<sig> bytes live here
   │
   │ on adopt, broker.adopt at canonical installer
   │ fetches /<sig> directly from this host
   ▼
ADOPTER's BROWSER OPFS  ─── verified bytes cached here
   (at the canonical installer's origin —
    diamondcoreprocessor.com's OPFS partition)
```

**Durable bytes never traverse the swarm host or the consumer surface or
the canonical installer.** They go straight from publisher's domain to
adopter's browser via HTTP (`GET /<sig>`), with the mesh visual telling
the broker where to look. The single exception is the swarm *preview*:
small (≤256 KB) image bytes ride the mesh inline (Nostr `kind:30201`) so
a peer can see a tile before adopting — but the authoritative copy is
still pulled HTTP-direct from the host on adopt, sha256-verified, and the
preview bytes are never the durable source of truth.

---

## What if a publisher has no domain?

Their content is **ephemeral by design**. They can broadcast visuals
(small metadata) through the mesh while they're online, but the bytes
have nowhere durable to live. The friction is intentional — it forces
commitment to identity for any durable contribution to the network.

Three softer options exist for the future, none implemented yet:
- **Peer-mirror:** an adopter with a domain opts in to mirror a
  domainless publisher's bytes (attribution preserved in sig metadata).
- **WebRTC byte transfer:** peers swap bytes directly browser-to-browser
  with the mesh relay coordinating handshakes.
- **Dedicated multi-tenant hosting service:** a *separate role* (not
  conflated with storage) for operators who explicitly want to be hosts
  for others. Different domain, different trust contract.

For now: own a domain → publish durably. Don't own a domain → share
ephemerally.

---

## Slim host: what a storage+mesh operator deploys

The canonical playbook for running an operator host (e.g. `jwize.com`,
`alice.dev`):

```
┌──────────────────────────────────────────────────────────┐
│ Cloudflare Tunnel                                         │
│ DNS: alice.dev A-record → Cloudflare                      │
│ TLS: Cloudflare-issued cert; IP cloaked                   │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│ hypercomb-relay  (Node, local port 7777 behind tunnel)   │
│   • GET /<sig>       serves alice's authored bytes        │
│   • PUT /<sig>       alice's HostSync pushes here         │
│                      (NIP-98 auth — alice's pubkey only)  │
│   • wss://           mesh relay for swarms alice hosts    │
│   • GET /            small "storage host" landing page    │
│                      directing visitors to canonical      │
│                      installer for the actual UI          │
└──────────────────────────────────────────────────────────┘
```

That's it. No installer. No multi-tenant write zone. No SPA. The relay
is intentionally narrow.

**Relay default + the port-7777 hazard.** On a real deployed origin the
mesh resolves to the public default relay — `wss://jwize.com`, seeded by
default since 2026-06-10 (`DEV_DEFAULT_HOST = 'jwize.com'` in
`runtime-initializer.ts`; the `nostr-mesh.drone` loopback default lands
on the same host). The local port **7777** is purely the loopback bind
*behind* the Cloudflare Tunnel — public traffic arrives over `wss://`
443, never `:7777` directly. Treat `:7777` as a known dev/prod collision
hazard: a production relay squatting that port shadows the local dev
relay, producing ghost replay, silent rate-limits, and dev events
landing in the prod store. Loopback `:7777` is for the operator's own
box only; never advertise it as the public endpoint.

**To deploy:** follow `hypercomb-relay/migrate-relay-to-7777.bat`
(Windows + NSSM) or equivalent for your OS. The recipe is the same
$0/mo home-machine playbook documented in
`domain-as-identity.md`.

---

## The canonical-mirror model

Trust in the installer code anchors to **one canonical build signature**
published by the project — NOT to any one server. Many operators can
serve the same byte-equal dist; participants verify the served buildSig
matches the canonical published buildSig.

```
                    ONE CANONICAL BUILD
                    (signed by project, published with build sig)
                    │
        ┌───────────┼───────────┬──────────────┐
        ▼           ▼           ▼              ▼
   diamondcore...  jwize.com   alice.dev   acmecorp.com
   (project)       (operator)  (operator)  (operator)

   All serve the same dist → byte-equal → same trust level

   Participants verify by comparing the served buildSig against the
   canonical published sig via /.well-known/hypercomb-installer.json.
```

**Trust attaches to the build's signature, not to the server.** A
mirror serving the byte-equal dist is structurally indistinguishable
from canonical. A mirror serving DIFFERENT bytes shows up as a
buildSig mismatch — surfaceable to the participant.

This decouples installer authority (one project, one signing key) from
installer serving (any number of mirrors). Network resilient to any
one operator going offline. Compatible with both self-host and
server-host operational profiles. **The single-point trust is on the
build's signature, not on the serving infrastructure.**

## Becoming an installer mirror (optional advanced role)

Any operator can mirror the canonical installer by serving the
byte-equal dist. The script `diamond-core-processor/scripts/serve-dist.js`
makes this trivial:

```bash
cd diamond-core-processor
npm run build                  # produces dist/diamond-core-processor/browser/
npm run serve:dist             # serves on localhost:2400 by default
```

What it does:
- Static file serving of the production dist (with SPA fallback for
  Angular routing)
- Computes a deterministic `buildSig` (sha256 of dist contents in
  canonical order)
- Exposes `/.well-known/hypercomb-installer.json` with the buildSig
- Sets `X-Hypercomb-Build-Sig` header on every response
- Permissions-Policy, nosniff, immutable-cache headers as appropriate

**To verify your mirror serves canonical-equivalent code:**

```bash
curl https://diamondcoreprocessor.com/.well-known/hypercomb-installer.json
curl https://your-mirror.dev/.well-known/hypercomb-installer.json
# Compare buildSig fields — if equal, your mirror is byte-equal canonical.
```

If buildSigs match, participants visiting your mirror get the same
trust guarantee as visiting canonical. If they don't match, your mirror
has diverged (perhaps an older version or a custom build) and
participants should treat it as an independent installer with its own
trust evaluation.

---

## What CAN'T change silently

Each layer's tamper-resistance:

| Layer | Tamper-resistance |
|---|---|
| Content bytes (`/<sig>` responses) | Sha256 verification on every fetch — bytes that don't hash to the requested sig are rejected. Tampering is mathematically impossible. |
| Adoption attribution (which publisher's domain) | Mesh visuals carry the publisher-domain hint signed by the publisher's pubkey (Nostr event). Forgery requires the publisher's private key. |
| Installer code | NOT inherently tamper-resistant — same problem every web SPA has. Mitigated by: canonical build signature (project authority), `/.well-known/hypercomb-installer.json` (per-mirror attestation), participant-side pin + change-detection (future). |
| Operator identity | DNS + TLS + community-graph vouching. Survives key rotation. Hard to forge without compromising both DNS and TLS issuance. |

The structural floor: bytes by hash, locations by federation, trust by
community-vouched sig convergence. **The installer code is the one
layer where ongoing operator-trust is required**, and that's why it's
narrowed to a single canonical build with mirror-verification semantics.

---

## What got rejected during the design conversation

For future readers wondering why certain shapes weren't chosen:

1. **Operator's own host serving installer code.** Rejected: the host's
   operator can swap installer code silently between visits; participants
   visiting that host trust the latest version blindly. Narrows the
   trust surface unnecessarily. Replaced by canonical-only installer with
   optional sig-verified mirrors.

2. **Multi-tenant storage (swarm-temp pool where strangers push bytes
   to an operator's host).** Considered, then questioned: dilutes the
   "alice.com bytes = alice authored" trust attribution because random
   pubkeys are writing to alice's infrastructure. Under the principle
   "you shouldn't host on your storage," multi-tenant write zones don't
   belong on a slim storage host. Open question whether to keep as
   opt-in advanced flag for operators who knowingly accept the
   trade-off, or remove entirely. As of 2026-06: the swarm-temp code
   exists in relay.js but the operator's principle ruled it inconsistent
   with the slim-host model.

3. **`HYPERCOMB_DEV_HOST` controlling installer URL.** Was useful when
   we conflated operator-domain with installer-source. Removed from
   `portal-overlay.resolveDcpUrl` after the full-split: env var still
   controls "where bytes come from for the participant's mesh attribution"
   (broker tier 0) but no longer controls "where installer code comes
   from" (always canonical).

4. **Single monolithic operator host running everything.** Was the
   initial model (jwize.com = installer + storage + mesh + identity).
   Rejected when the trust analysis showed code-host's operator can
   change code silently. Replaced by role-decoupled hosts: same operator
   can wear multiple hats, but the installer-code hat is special and
   defaults to canonical.

---

## Cross-references

- `domain-as-identity.md` — domain ownership, Cloudflare Tunnel
  playbook, federation graph
- `host-sync-receipts.md` — HostSync push protocol (operator → own
  host)
- `signature-system.md` — content-addressing semantics and resolution
  doctrine
- `dna.md` — Distributed Network Artifacts: the content-addressed,
  merkle-versioned artifacts (layers, deps, bees, resources, content)
  this network moves. The trust tiers above gate *who* you accept
  artifacts from; `dna.md` describes *what* those artifacts are
- `history-sigbag-as-root.md` — sigbag layout and the single-bucket
  content model on hosts; how a lineage's `000x` sigbag's max marker
  names the current root. The same merkle identity that gives Tier 1 its
  sha256 guarantee gives versioning its append-only root chain
- `genome-primitive.md` — the recursive merkle root over a subtree
  (parent = f(child sigs), cascading to root). This is *why* a single
  `rootLayerSig` can stand in for an entire tree's integrity; trust by
  sha256 (Tier 1) and versioning by merkle cascade are the same primitive
  viewed two ways
- `trail-capsule.md` — the 1-byte navigation/route stream (formerly
  called the "DNA"/path capsule, now the trail/waggle capsule); distinct
  from the DNA *artifacts* above
- `protocol-spec.md` — full wire protocol reference

---

## Glossary

- **Adopter** — participant who clicks the adopt button on a peer's
  tile
- **Branch sig** — the layerSig of a peer's published layer at any
  position in their tree; the unit of adoption
- **Build sig** — sha256-derived hash of the canonical installer
  build, published via `/.well-known/hypercomb-installer.json`
- **Canonical installer** — the project-published DCP build at
  `diamondcoreprocessor.com` (and any byte-equal mirror)
- **Consumer surface** — the participant-facing browsing UI; runs the
  hive (tile grid + navigation); deployed at `hypercomb.io`
- **Mesh** — the WSS-relay layer carrying signed Nostr events between
  swarm participants
- **Operator** — a person running an instance of `hypercomb-relay` at
  their domain
- **Publisher** — a participant who authors content; whichever domain
  serves their bytes is their *storage host*
- **Slim host** — a relay running storage + mesh roles only (no
  installer, no multi-tenant write)
- **Storage host** — a domain serving `GET /<sig>` for content the
  operator authored
- **Swarm** — a meeting on a mesh relay; identified by (room, secret)
- **Witness view** — visible-tile union at a navigation location =
  (your own tiles at that location) + (every present peer's broadcast
  tiles); ephemeral, adoption-bound
