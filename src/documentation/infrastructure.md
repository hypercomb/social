# hypercomb infrastructure

bytes fetch HTTP-direct from operator domains at `GET /<sig>`. the mesh carries only layer sigs and presence. no central byte chokepoint.

---

## philosophy

hypercomb is a decentralized platform. there is no place for a central byte chokepoint in it — no single host every client must reach, no Azure default fallback, no API tier that owns user data. content is signature-addressed, so any host that holds the bytes for a `<sig>` serves byte-identical content, and a reader verifies sha256 before trusting it. the host is interchangeable; the signature is the identity.

this is *not* "no CDN ever." immutable `/<sig>` URLs are exactly what edge caches are good at — Cloudflare caching of `/<sig>` is **embraced** as a scale primitive, because a cache hit on an immutable content-addressed URL can never serve the wrong bytes (the sig gates them). what we reject is a *central* chokepoint: a single origin every client must funnel through, or a hard-coded fallback that turns one provider's outage into a network outage. as of writing, `ContentBroker.#getFallbackDomains` returns an empty list — there is **no** default Azure CDN fallback. fetch candidates come from the operator's own domain, community-trusted domains, and mesh-learned domains, tried in trust order; first verified-bytes wins.

two transports, by content type:

| transport | carries | how |
|-----------|---------|-----|
| **HTTP-direct** (primary) | layers, resources, dependencies, bees | `GET /<sig>` against operator domains (`ContentBroker.#fetchOverHttp`, `Store` host fallback, `HostSync` PUT for backup) |
| **mesh broker** (fallback) | **layer sigs only** | broadcast a sig request on the Nostr mesh; any peer with the bytes responds (kind 20400 request / 30401 response) |

resources, dependencies, and bees are heavy bytes — they travel via direct HTTPS, never the mesh. the mesh broker exists only so an adopter can recover a *layer* (a tiny signature directory) from any peer when the original publisher has left or never re-walked it. see `project_public_navigation_lineage_filter.md`: "mesh transports LAYER SIGS ONLY — layers are tiny directories; resources / deps / bees / blobs travel via direct HTTPS fetches to the domains the mesh told you about."

> one narrow exception: the **swarm-preview** path (`swarm.drone.ts`, kind 30201) relays inline image bytes as base64, capped at `MAX_RESOURCE_BYTES = 256 KB`, so a peer can preview a tile's visual before adopting it. this is a bounded preview channel, not the general byte transport.

---

## the bootstrap relay: jwize.com

the running bootstrap relay is `wss://jwize.com`, fronted by a Cloudflare Tunnel terminating on the host machine. it shipped 2026-05-29, and since **2026-06-10 it is default-ON for real hosts**: a deployed origin seeds `wss://jwize.com` automatically.

local origins (dev) seed the loopback relay `ws://localhost:7777` instead — a deployed origin must never dial loopback (nothing listens on a visitor's machine, and a public origin touching localhost trips Chrome's Local Network Access prompt). note that `localhost:7777` is loopback-only and a known dev/prod port-collision hazard — the production relay squatting that port causes ghost replay and silent rate-limiting.

overrides (localStorage):

| key | effect |
|-----|--------|
| `hc:nostrmesh:use-live-relay` = `'1'` | force `wss://jwize.com` on any origin |
| `hc:nostrmesh:use-live-relay` = `'0'` | opt out — a real host idles, no loopback dial |
| `hc:nostrmesh:relays` = `'[…]'` | manual relay-list override, wins over everything |

the relay policy lives in exactly one runtime branch — the seed expression in `nostr-mesh.drone.ts` `loadRelays()` — so it stays auditable in one place.

### what the relay does

a Nostr relay, and nothing more:

- accepts WebSocket connections
- stores and forwards signed events (presence, layer-sig broadcasts, swarm previews)
- fans out subscriptions to connected clients

no web server, no API, no database beyond relay event storage, no user accounts, no support surface. the relay carries **sigs and presence** — it does not carry the heavy bytes. those move over HTTP-direct.

---

## how bytes actually move

a content-addressed fetch resolves in tiers, cheapest first:

1. **memory** — in-process cache.
2. **OPFS** — the local pools (`__layers__/`, `__resources__/`, `__dependencies__/`, `__bees__/`). this is where everything you've authored, adopted, or pulled already lives. on the render path, layers / dependencies / bees are **OPFS-only** — they heal only via adopt / install / sync, never on render.
3. **host (HTTP-direct)** — a cold miss on a *resource* falls back to `GET /<sig>` against the operator domains via `ContentBroker.#fetchOverHttp`, then write-through into OPFS. `Store.getResource` is `memory → OPFS → host`, sha256-verified, with a 60s negative cache (`HOST_MISS_TTL_MS`) so a missing sig doesn't re-hammer the network.
4. **mesh broker (layers only)** — if a layer sig can't be resolved any other way, broadcast it on the mesh and accept the first peer response whose bytes hash to the requested sig.

the flat `/<sig>` heap is the canonical address — `#fetchOverHttp` tries `/${sig}` first, then a typed legacy path (`/__layers__/<sig>.json`, `/__resources__/<sig>`, `/__dependencies__/<sig>.js`) for static layouts that can't resolve flat. sha256 gates every byte regardless of which host or path served it, so a malicious or corrupted response is discarded silently.

### operator domains are the hosts

anyone running an operator host (e.g. `jwize.com`, `alice.dev`) serves their content over HTTP at `/<sig>` *and* runs a relay node. adoption is byte-copy: a host `GET`s a sig from another host, verifies sha256, and writes it to its own pool — from that moment any peer asking it for that sig gets byte-identical content. there is no "federate with X" handshake; federation *is* adoption. the relay mesh announces *which* domains hold *which* sigs; the bytes come over HTTP.

`HostSync` pushes a participant's own content up to their host with confirmed-read-back receipts — a one-way backup, not a live byte transport.

---

## persistence: local-and-durable by default

hypercomb is **not** ephemeral. everything you author persists durably and locally in OPFS by default:

- `__history__/<lineageSig>/` — per-lineage marker chains (every undo/redo entry you've ever made)
- `__layers__/`, `__resources__/`, `__bees__/`, `__dependencies__/`, `__optimization__/` — the signature-addressed content pools
- the `hypercomb.io/` tree — your content (tiles, folders, body resources)

only the **network** is opt-in. nothing crosses the wire unless you publish. and a small set of values stay **participant-local on purpose** — presence, cursor, clipboard, selection, and viewport are kept *out* of the signed layer so they never skew the lineage signature across peers.

---

## package identity and update detection

a package's identity is its **`rootLayerSig`** — the merkle root of its layer tree, where `cells[]` holds child layer sigs. `label`, `previous`, and `at` are **sidecar metadata**: they change the bytes of `manifest.json` but **not** the signature. the discovery file is `manifest.json`, keyed by `rootLayerSig` (not a flat file-path→hash `install.manifest.json`, not a separate "release" sig).

update detection is an **O(1) root-sig compare** — `installedSig === rootSig` — not an HTTP `304`. if the roots match, you're current; if they differ, there's a new version to fold. consent is required only for a genuinely **new** adoption, never for an update to something already adopted.

---

## scaling

| connections | what to do |
|-------------|------------|
| **< 10K** | a single small VPS / tunnel-fronted host runs the bootstrap relay |
| **10K – 100K** | tuned kernel params (ulimits, ephemeral ports); Cloudflare edge absorbs `/<sig>` reads |
| **100K – 1M** | multiple relay processes behind a load balancer; immutable `/<sig>` caching at the edge does the byte-serving heavy lifting |
| **1M+** | operator-domain hosts should be absorbing most byte traffic — every adopter that becomes a host adds capacity |

relay capacity scales with adoption, not with our server count. each operator domain is implicitly a relay node *and* an HTTP byte host; as domains come online they contribute both. byte reads ride immutable `/<sig>` URLs that any edge cache can serve.

### relay software

| option | language | notes |
|--------|----------|-------|
| **strfry** | C++ | high performance, designed for scale |
| **nostr-rs-relay** | Rust | solid, widely used |
| **hypercomb relay.js** | Node.js | already in the repo, good for dev and small scale |

for production: `strfry` or `nostr-rs-relay`. for development: `relay.js` on `ws://localhost:7777`.

---

## a note on confidentiality

the mesh is currently **plaintext JSON** — the sig in the `x` tag is visible to the relay and to any subscriber on the broadcast channel. AEAD / encrypted mesh transport is future work. do not assume confidentiality the build doesn't yet provide: anything you publish to the mesh is observable. local OPFS content, by contrast, never leaves your machine until you explicitly publish.

---

## what we don't run

- no central byte chokepoint — no single origin every client must reach
- no default Azure CDN fallback (`#getFallbackDomains` is empty)
- no API servers
- no databases (beyond relay event storage)
- no user account systems
- no customer support infrastructure
- no SLA commitments to third parties

if someone connects to the relay, fine. if they disconnect, fine. the bytes live at `/<sig>` on whatever host holds them, and the signature proves they're the right bytes.

---

## summary

```
jwize.com            →  bootstrap relay (wss://, Cloudflare Tunnel), default-ON for real hosts since 2026-06-10
                        + HTTP byte host serving GET /<sig>
operator domains     →  each is a relay node + an HTTP /<sig> byte host; adoption = byte-copy

bytes                →  HTTP-direct GET /<sig> (memory → OPFS → host), sha256-verified, edge-cacheable
mesh                 →  layer sigs + presence only (+ bounded 256KB swarm-preview images, kind 30201)
persistence          →  durable & local by default (OPFS pools + history chains); only the network is opt-in
identity             →  rootLayerSig is the package sig; label/previous/at are sidecar metadata
updates              →  O(1) root-sig compare (installedSig === rootSig)

everything else      →  not our problem
```
