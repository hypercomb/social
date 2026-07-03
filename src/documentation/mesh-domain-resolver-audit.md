# Mesh / Domain-Resolver Audit — thin mesh, thick domains

**Date**: 2026-07-03
**Method**: 5 parallel exploration passes (mesh payloads, domain resolution, install/sync,
meta formats, performance) followed by 12 independent adversarial verifications of every
load-bearing claim against working-tree code. Only verified findings appear here; where a
first-pass claim was corrected, the corrected form is stated.

**Target architecture**: the mesh (Nostr relays) is *thin* — it carries signatures,
announcements, and presence, never content. Domains are *thick* — they resolve signatures
to bytes over HTTPS and publish small meta descriptors (`layer: sig`) that let a client
discover roots, detect updates in O(1), and resolve whole closures without probing.

---

## 1. Verdict

The system is **~80% of the way to thin-mesh** and **~50% of the way to thick-domains**.

- The mesh is already sig-only for its core traffic: kind 30200 layer events inline child
  properties and `imageSig` references, never bytes (swarm.drone.ts:2233-2243). The only
  live byte-carrying channel is kind 30401 broker responses (layers + visuals, ≤256 KB);
  kind 30201 resource publishing is **dormant dead code** — nothing calls it
  (swarm.drone.ts:2242-2243, 2555).
- Domains already serve sig-addressed bytes at `https://<host>/<sig>` with an immutable
  edge-cache front (pluginthematrix.io rewrite + CORS). The audit found a half-shipped
  `__roots__/<domain>/<sig>` attestation probe in the relay (no client fetched it, no
  listing, no `/__keys__`, no domain-key check on writes) — **removed 2026-07-03** along
  with every `__roots__`/`__keys__` reference in protocol-spec.md, superseded by the
  sigbag-serving protocol (§6). The `layer:sig` meta file now has exactly one design:
  the sigbag itself.
- The single biggest correctness+trust gap found in passing: the web shell's
  `LayerInstaller` downloads layers/bees/deps **without verifying signatures**
  (layer-installer.ts:259-272 — only `res.ok` + SPA-fallback guard; presence of a
  sig-named file is assumed to imply correctness). The DCP installer does verify
  (dcp-installer.service.ts:164-169). Bees are executable code; this should be closed
  regardless of the resolver work.

---

## 2. What travels over the mesh today (verified)

| Kind | Purpose | Payload | Size | Cadence |
|------|---------|---------|------|---------|
| 30200 | Peer layer visuals per lineage node | `{label?, visuals:[{name, ...props, imageSig?}]}` — sig-only, never bytes | 1–10 KB, **uncapped** | changed OR ≥45 s elapsed, checked on 30 s tick → steady-state ~60 s/node |
| 30201 | Resource bytes (base64) | **dormant** — publish path has no proactive callers; passive 256 KB-capped receive handler remains | ≤256 KB | never (currently) |
| 30202 | Hide filter | `{hidden:[names]}` | ≤ few KB | heartbeat |
| 30203/30204/30205/30206 | Interest / presence / subscribe-request / lifecycle | small JSON | ~100 B–1 KB | heartbeat / event |
| 30210–30213 | Feedback consent + items | JSON | small | on action |
| 20400/20402 | Broker fetch request / cancel | empty, sig in tag | ~100 B | on miss |
| 30401 | Broker fetch **response** | base64 bytes — **layers** (HTTP-miss-gated) and **visuals** (mesh-first, no HTTP precondition) | ≤256 KB | on request |

Publisher bounds: depth ≤3, ≤200 nodes per publish burst; never-published empty
descendants skipped (was 78% of a captured burst — swarm.drone.ts:2205-2213). NIP-40
expiration 90 s (layers), 1 day (30401). `LAYER_REFRESH_MS = TTL/2 = 45 s`
(swarm.drone.ts:164,170,181, 2221-2228).

**Thin-mesh violations remaining**: (a) 30401 layer-byte fallback — legitimate today only
because domain resolution is unreliable for foreign sigs; (b) 30401 `visuals` bundles —
mesh-first by design (live swarm state, location-addressed; acceptable to keep on mesh);
(c) steady-state re-transmission of identical 30200 payloads every ~60 s per node solely
to refresh NIP-40 expiration — a relay-side keepalive (we own relay.js) would remove
almost all of this wire traffic; (d) 30200 events have **no size cap** (unlike 30201/30401).

## 3. What domains resolve today (verified)

- **Canonical byte endpoint**: `GET https://<host>/<sig>` (flat heap), legacy typed
  fallback (`/__resources__/<sig>` etc.). Broker cascade: self-domain →
  `hc:community:domains` → per-sig mesh-learned (`#knownDomainsBySig`) + session hosts →
  beta mirrors `jwize.com`, `pluginthematrix.io` (content-broker.drone.ts:696-792).
  3 s timeout **per probe**, two URL paths per host → up to ~6 s per dead host.
- **Resources & dependencies are HTTPS-only** (no mesh) — content-broker.drone.ts:915-918, 1486.
- **Service worker** (`/@resource/<sig>`): Cache Storage → `__hive__/<sig>` →
  `__resources__/<sig>` → host fetch with sha256 verify + fire-and-forget OPFS
  write-through + `cache-control: immutable` cachePut (hypercomb.worker.js:194-244,
  491-530). Cold miss re-fetch on next load is already prevented by Cache Storage even
  when OPFS write-through fails.
- **Meta files a domain serves**: `manifest.json` (package install descriptor —
  `{version, packages: {<rootSig>: {layers[], bees[], dependencies[], beeDeps, label, at,
  previous}}}`) is the **only client-consumed meta file**. The Azure mirror deliberately
  excludes sigbag markers and manifest.json (mirror-content-to-azure.ps1:38-39,133-141).
- **Durable attribution**: only the flat host list `hc:known-domains` (24, MRU) survives
  reload; the per-sig map `#knownDomainsBySig` is session-only. Mitigations: a verified
  layer fetch attributes its serving host to the layer's **entire closure**
  (`#attributeClosure`, content-broker.drone.ts:598,774) and miss-backoff suppresses
  repeat cascade walks. Worst-case cold-reload for a sig held only by the last-ranked
  host: ~(1 + community + 23) × 6 s ≈ **2.5 minutes** of probing.

## 4. The `layer:sig` meta file — current state

| Piece | Status | Where |
|-------|--------|-------|
| Per-lineage root pointer (`{layer: sig}` marker records, max `000x` = current root) | **live, local-only** | `__history__/<lineageSig>/NNNN`, DCP `__lineages__/<name>/NNNN` |
| Domain-served root descriptor | **superseded → sigbag serving (§6)**; the half-shipped relay `__roots__` probe was removed 2026-07-03 (no client ever fetched it) | relay.js resolveFlatSig |
| `__roots__` / `/__keys__` named meta routes | **eliminated** from code + spec 2026-07-03; roots live in a disconnected reference pool at `sign(domain)`, keys ride its marker 0000 (rotated by later markers) | protocol-spec.md §21.7, §21.12, §21.13 |
| Domain-key-verified marker append (§21.13) | design target — relay's generic sig-addressed PUT accepts any authorized NIP-98 writer; marker append-auth unbuilt | relay.js:756-802 |
| Sigbag replication to host | design-only (buildable #1) | history-sigbag-as-root.md §8 |
| Verifiability | **sound** — signing is byte-faithful raw SHA-256, no canonicalization; any served meta file verifies by re-hashing exact bytes | signature.service.ts; signature-system.md:29-35 |

**Update detection** is already the right shape where it exists: boot never fetches
manifest.json (push-only; spot-check failure wipes install cache and surfaces
`install-needed`, it does not auto-reinstall); DCP resync sends `syncSig` (short-circuit)
+ `have[]` (delta streaming); `upgradeFromBundled` is the second, user-initiated path
(ensure-install.ts:72-131, 165-222, 241-272, 503-650; sentinel-handler.ts:233-291). The
domain root descriptor generalizes exactly this `syncSig`-compare across participants.

## 5. Performance findings (ranked, all verified)

1. **Adopt/closure walk is fully serial** — content-broker.drone.ts:1044-1073: resources,
   decoration descent, and child-layer recursion each `await` one at a time; zero
   `Promise.all` in the file. A 50-layer/200-resource adopt ≈ 250 back-to-back fetch
   cascades. Fix: bounded fan-out (~8–16) per layer for resources + parallel child
   recursion. Note `#pendingFetches` coalescing only wraps the **mesh** leg
   (lines 924-931) — extend it to the HTTP path (line 903) so concurrent callers coalesce.
2. **Cold-reload sig→host probing** (see §3, ~2.5 min worst case). Best fix is not more
   localStorage — it is the domain root descriptor (§6): one meta fetch seeds attribution
   for a whole closure, and the SW gets sig→host hints instead of probing 24 hosts.
3. **`no-store` on immutable sig-addressed GETs** defeats the HTTP cache:
   content-broker.drone.ts:758, both service workers (:502, :118, :380),
   host-sync.service.ts:508, ensure-install.ts:349. file-transit.md Phase 1 already
   removed it from layer-installer.ts:261 and dev-layer.source.ts:25 with the explicit
   rationale "sig-addressed bytes are immutable; trust the server's immutable cache
   header" — finish the sweep. (Keep no-store on manifest.json — it is mutable.)
4. **One REQ per sig** — nostr-mesh.drone.ts:911-922; N sigs = N REQ frames per socket.
   NIP-01 allows `'#x': [sig1..sigN]` in one filter, but three couplings must be
   refactored first: inbound routing keys off `bucket.sig` not the event's `x` tag
   (816-852 — use the existing `readX()` helper), EOSE resolves only `bucket.sig`
   (798-806), and CLOSE tears down the whole subId (1029-1044). Micro-task batching of
   pending subscribes into one filter is the shape.
5. **Web-shell LayerInstaller: serial AND unverified** — layer-installer.ts:100-199
   (plain for-loops), :259-272 (no sha256 of downloaded bytes). Parallelize with a cap
   *and* verify — DCP installer (dcp-installer.service.ts:72-89, 164-169) is the model,
   except it is **unbounded** `Promise.all` per phase — give both a shared cap (~8).
6. **Host-sync receipt verification** — one HEAD per sig, cap 4 enforced by a 50 ms
   polling busy-wait (host-sync.service.ts:382-389,407); walks can surface hundreds of
   sigs per burst. Raise the cap, replace the busy-wait with a real semaphore; long-term
   the root-descriptor compare makes per-sig HEADs unnecessary (compare one root, trust
   the closure).
7. **Heartbeat re-transmission** — up to 200 identical 30200 events per ~60 s per
   stationary publisher purely to refresh expiration. We own relay.js: add a relay-side
   expiration-refresh (tiny keepalive referencing the replaceable event) or lengthen TTL
   + explicit tombstones. Also add a size cap on 30200 payloads.
8. **Dead code**: `#publishResource`/`#pullResourcesFromLayer` (30201) have no callers —
   keep only if the request-driven ship path is planned; otherwise delete.

Already good (leave alone): SW Cache Storage + OPFS write-through; relay-as-cache via
NIP-33 replaceable events; EOSE-driven ready-waiters (no polling); miss-window backoff;
empty-descendant publish skip; sentinel `have[]` delta; boot's push-only no-network path;
`visited`-set dedup in adopt.

## 6. Recommended protocol: the domain serves its sigbag

> Correction (2026-07-03): an earlier draft proposed `GET /__roots__/<domain>/` returning
> a `name → rootSig` map. Rejected — it introduces a name-keyed folder and a mutable map
> file into an architecture whose invariant is that the ONLY structure is sigbag markers
> inside signature-named scopes. No maps, no names: paths sign to lineage sigs, the max
> marker IS the root. The relay's `__roots__` probe and every `__roots__`/`__keys__`
> reference in protocol-spec.md were removed/rewritten 2026-07-03 — the sigbag is the
> only design.

The wire layout is signature-named pools all the way down — the domain's roots live in a
**disconnected reference signature pool** whose scope is `sign(domain)` (computable by
anyone from the domain string; identical address on the domain's own host and on every
mirror; disconnected from the host's own tree):

```
https://<host>/<sig>                    immutable sig-addressed content       (shipped)
https://<host>/<sign(domain)>/000x      the domain's root markers (ref pool)  (new)
https://<host>/<lineageSig>/000x        per-lineage sigbags                   (new)
```

Marker names (zero-padded decimal) and sig names (64-hex) never collide. Markers are
append-only: once written, a marker's content is immutable, so **everything the domain
serves is cacheable forever** — the only mutable surface is a 404 that eventually becomes
a 200. The one place `no-store`/short-TTL belongs is the next-marker probe.

- **O(1) update check**: remember the last max marker index N per domain; `HEAD /000(N+1)`
  → 404 = unchanged, 200 = new root (walk forward). Cold discovery = exponential probe +
  binary search on marker existence, O(log n) HEADs. This retires manifest.json for
  discovery (already a listed buildable) — manifest stays only as install context.
- **Deep resolution without maps**: leaf-only commit means a parent's `children[]` is a
  stale hint; the truth for any page is its own bag head. A client walking the tree knows
  the path, computes `sign(path)` = lineageSig, and probes `/<lineageSig>/000x`.
  Deterministic — no directory listing, no index file. (If per-lineage bags are ever
  co-hosted on a multi-domain mirror where bare `sign(path)` could collide across
  domains, the same pattern applies: a disconnected pool keyed by the qualified meaning,
  `sign(domain + path)` — pools solve every "where does this class of metadata live"
  question the same way.)
- **Tagged markers — show-by-tag**: markers can carry sidecar tags
  (`{ layer: <sig>, tags?: ["stable", "v1", ...] }`). Tags are marker metadata, never
  layer content — the layer's sig is untouched (layer purity holds) — and they're inside
  the signed marker bytes, so a tag assertion is attested by the domain key like the root
  advance itself. Selection: default view = max marker (HEAD); a consumer pinned to tag T
  shows the highest-indexed marker carrying T. Because the bag is append-only, *moving* a
  tag = appending a new marker with that tag pointing wherever — including an **older**
  layer sig. That gives rollback/promote/channels (stable vs beta), named versions,
  demo/presentation views, and deploy walk-back as free consequences, with the audit
  trail built in and update detection unchanged (same next-marker probe; re-evaluate
  "latest with T" when a marker appears). Fractal like everything else: the same
  mechanics work in per-lineage bags to pin a particular historical layer of one page.
  (Marker tags select *which root to show*; distinct from tile-level tags — the
  decoration kind — which live inside content.)
- **Trust**: on the publisher's own domain, TLS is the attestation (domain-as-identity).
  For third-party mirrors/relays, marker CONTENT carries a domain-key signature; the key
  is introduced in the root pool's marker `0000` (learned over TLS from the domain, TOFU)
  and rotated by later markers. Relay append-auth = only that key may append markers to
  the domain's pool. This replaces both the `__roots__` attestation design and
  `/__keys__` — key material is content in the bag like everything else.

**Build order** (steps 0 are independent of the protocol and worth doing first):

0. Fix `LayerInstaller` verification (§7.1) and parallelize the adopt walk (§5.1).
1. **Publish**: extend host-sync to push marker files alongside sig files; relay accepts
   marker PUT under scope paths; mirror script includes markers (they are immutable —
   the current exclusion at mirror-content-to-azure.ps1:133-141 predates this design).
2. **Consume**: ContentBroker resolves domain → root via bag head; persists per-domain
   marker index (replaces the volatile per-sig map problem — with domain→root plus
   `#attributeClosure`, sig→host maps become derived state); SW gets domain→root hints;
   adopted-domain boot = one HEAD per domain.
3. **Sign markers** for mirror trust; gate marker appends on the domain key (the
   `__roots__` probe is already gone).
4. **Mesh diet**: 30200 keeps sig-only visuals + `['domain', host]` tag; 30401 layer
   fallback becomes the rare path (publisher offline); visuals bundles stay mesh-native.
   Add relay-side expiration keepalive (§5.7) so unchanged payloads stop re-transmitting.

## 7. Security notes (found in passing)

1. **LayerInstaller does not verify downloaded bytes** (layer-installer.ts:259-272) —
   includes bee code. Fix with §5.5.
2. **Marker/root writes lack domain-identity verification** — the relay's generic
   sig-addressed PUT (relay.js:756-802) gates on the authorized-writer set only; the
   §21.13 domain-key check for root advances is unbuilt. (The `__roots__` read probe
   itself was removed 2026-07-03.)
3. 30401 `visuals` responses are location-keyed trust, served without content
   verification (by design — they are not content-addressed); keep them out of any
   content-resolution path.
