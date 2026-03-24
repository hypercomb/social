# hypercomb infrastructure

two relay servers. no centralized hosting. everything flows through the mesh.

---

## philosophy

hypercomb is a decentralized platform. there is no place for centralized infrastructure in it — not for hosting, not for APIs, not for user management. a CDN is still a central point of control and failure. it has no validity here.

everything is a signed resource. the app itself, the relay list, user content — all of it is signature-addressed and distributed through the Nostr relay mesh. the only infrastructure is relay servers, and we run exactly two of them.

---

## the only infrastructure: two relay servers

| location | domain | purpose |
|----------|--------|---------|
| **vancouver** | `van.hypercomb.io` | primary relay, north america coverage |
| **japan** | `jp.hypercomb.io` | secondary relay, asia-pacific coverage |

### what runs on each

a Nostr relay. that's it.

- accepts WebSocket connections
- stores and forwards signed events
- fans out subscriptions to connected clients
- serves signed resources (the app, the relay list, user content — all the same)

no web server. no API. no database. no user accounts. no support surface. no relationship with users beyond accepting their WebSocket connection and relaying signed events.

### why these locations

- **vancouver** — close to ops, covers north america
- **japan** — family presence means physical access if hardware needs hands. covers asia-pacific
- together they span the Pacific Rim with low latency to the two largest internet populations

### why only two

we're not in the relay business. we run enough infrastructure to bootstrap the network and guarantee the default experience works. as mashup domains come online, they contribute relay capacity automatically. the network grows without us growing our server count.

---

## how the app gets distributed

the hypercomb.io web app (Angular build output — HTML, JS, CSS) is not hosted on a traditional web server or CDN. it's a set of signed resources distributed through the relay mesh, just like everything else.

1. the app is built as signature-addressed bundles (this already exists — `install.manifest.json`, `__bees__/`, `__dependencies__/`, `__layers__/`)
2. the bundles are published as Nostr events to the relay network
3. a client loading for the first time connects to a bootstrap relay, fetches the app resources by signature, verifies them, and stores them in OPFS
4. subsequent loads are instant — served from local OPFS, with the mesh providing updates when signatures change

the bootstrap problem reduces to: how does the very first page load happen? options:

- a minimal HTML file (< 1KB) with a bootstrap script that connects to a relay and pulls the rest. this tiny file can live anywhere — a GitHub Pages site, a DNS TXT record, an IPFS hash, or even shared peer-to-peer
- the relay servers themselves can serve this bootstrap HTML over plain HTTPS as a fallback
- once any user has loaded the app, they can share it peer-to-peer (the signed bundles are just files)

---

## the relay list: a signed primitive

the list of relay URLs is itself a signed resource — a JSON array stored by its SHA-256 signature:

```json
["wss://van.hypercomb.io", "wss://jp.hypercomb.io"]
```

the signature is the identity. clients look it up by sig and get the array. on first load, a bootstrap signature (the one hardcoded constant) points to the default relay list. after that, the relay list is just another resource flowing through the mesh — updatable, verifiable, not hardcoded.

mashup domain operators publish their own relay list resources. the client merges them: owned relays first, then domain relays, then user-configured.

---

## mashup domains: organic scaling

anyone running a mashup domain (a site built on `hypercomb-core`) is implicitly running a relay node. they host their own thing, and as a side effect, they contribute relay capacity to the network.

- relay coverage scales with adoption, not with our server count
- mashup operators are self-interested — they maintain their nodes because they need them
- the network degrades gracefully — if mashup relays go offline, clients fall back to owned relays

we don't manage them. we don't support them. we don't even know who they are. they're just entries in relay list arrays flowing through the mesh.

---

## scaling the relay servers

| connections | what to do |
|-------------|------------|
| **< 10K** | single small VPS at each location handles it |
| **10K - 100K** | proper hardware or beefy VPS, tuned kernel params (ulimits, ephemeral ports) |
| **100K - 1M** | multiple relay processes behind a load balancer per location |
| **1M+** | the mashup domain network should be absorbing most of this load by now |

### practical starting point

two small VPS instances (4 vCPU, 8GB RAM). a well-tuned Nostr relay handles tens of thousands of concurrent WebSocket connections on modest hardware. upgrade when load demands it.

### relay software

| option | language | notes |
|--------|----------|-------|
| **strfry** | C++ | high performance, designed for scale |
| **nostr-rs-relay** | Rust | solid, widely used |
| **hypercomb relay.js** | Node.js | already in the repo, good for dev and small scale |

for production: `strfry` or `nostr-rs-relay`. for development: `relay.js`.

---

## what we don't run

- no web servers
- no CDN
- no API servers
- no databases (beyond relay event storage)
- no user account systems
- no customer support infrastructure
- no SLA commitments to third parties

if someone connects to our relay, fine. if they disconnect, fine. we have no relationship with them beyond the WebSocket.

---

## summary

```
van.hypercomb.io     →  Vancouver VPS, Nostr relay
jp.hypercomb.io      →  Japan VPS, Nostr relay

the app              →  signed resources distributed through the relay mesh
the relay list       →  signed primitive: sig → ["wss://van.hypercomb.io", "wss://jp.hypercomb.io"]
mashup domains       →  community relay nodes, organic scaling
bootstrap            →  minimal HTML + one known relay endpoint

everything else      →  not our problem
```
