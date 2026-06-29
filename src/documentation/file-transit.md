# File Transit — Moving Signature-Addressed Content Across the Wire

> Status: design + phased plan. Phases 1–3 are low-risk wins that harvest what the
> content-addressed model already earns us; Phase 4 is a genuine protocol addition.
> Recon of the current serving headers (relay / Azure SWA / service worker) is folded
> into Phase 1.

## The thesis

Hypercomb is a content-addressed merkle system: every file is the SHA-256 of its own
canonical content (see [signature-system.md](signature-system.md)). That single fact
**reorders the entire transit-optimization hierarchy**. In a path-named, mutable system
the first question is "how do I send these bytes faster?" and gzip is a reasonable
answer. Here it is the *last* answer, because the model hands us bigger wins for free:

1. **Don't re-send what the peer already has.** A sig is a hash of its bytes — the
   content behind `<sig>` can never change. That makes it perfectly cacheable, forever.
2. **Negotiate before transferring.** Compare root signatures (O(1)) to learn whether
   anything changed at all, before moving a single content byte.
3. **Pack the closure.** Ship the transitive set of missing sigs as one delta-compressed
   response instead of a manifest plus N fetches.
4. **Stream-compress.** gzip/brotli the bytes that survive steps 1–3 — mostly free at the
   CDN edge.

The git smart protocol is the exact precedent: git is the same shape (immutable
content-addressed objects, merkle DAG, "I have tip A, you have tip B"), and its transit
is *not* "gzip the repo" — it is negotiate haves/wants, then send a delta-compressed
packfile of the missing closure.

## Current state (baseline)

Every transport is **per-signature, sequential, uncompressed, and un-cached**.

| Path | Current behavior | Cost | Source |
|---|---|---|---|
| Install/sync | `manifest.json` + N separate `GET /<sig>` | N+1 round-trips | `hypercomb-shared/core/layer-installer.ts:49-272` |
| Resource streaming | one HTTP fetch per resource, on demand (memory→OPFS→host) | 1 RT/resource | `hypercomb-shared/core/store.ts:507-579` |
| Mesh (nostr) | layers as **base64 in-event**, uncompressed, 256KB cap; resources HTTP-only | +33% base64 tax, hits ceiling | `…/sharing/content-broker.drone.ts` |
| Closure walk | one level deep, each sig fetched individually | N RTs | `…/sharing/decoration-closure.ts` |
| Caching (relay) | **already** `public, max-age=31536000, immutable` | correct | `hypercomb-relay/relay.js:695` |
| Caching (client) | ~~`cache: 'no-store'` defeated the relay header~~ → fixed | re-fetches eliminated | `layer-installer.ts:261` |
| Compression | none at the relay (Node `http`) | full bytes on every cold fetch | — |

> **The relay is the serving surface. Azure is retired.** The old Azure Static Web App /
> blob deploy path (`scripts/deploy-azure.ps1`, the SWA CDN) is no longer used — content
> is served by `hypercomb-relay` (Node `http`). Anything below about Azure CDN defaults is
> historical; that free text-gzip no longer applies, which makes relay-side compression
> the *only* place text compression can happen.

The architecture is correct, and the **relay already serves immutable cache headers**.
With the client `no-store` override removed (below), the caching story is done; the one
remaining transport gap is that the relay does no compression at all.

## Target state

Implement transit layers 1–4 above. Concretely: immutable caching at the edge + browser,
mesh compression, CDN text compression, and a closure-pack endpoint gated on root-sig
negotiation with a per-sig fallback for old peers.

---

## Phase 1 — Immutable caching ✅ COMPLETE

**Recon verdict:** the relay (`relay.js:695`) **already** sends
`Cache-Control: public, max-age=31536000, immutable` on all sig-addressed content, and
the production `domain-layer` source uses a plain `fetch(url)` that respects it. With
Azure retired, the relay is the only serving surface — so the only remaining fix was
the client override, now shipped (Gap A). There is no Gap B anymore.

**Gap A — the client defeats the cache. ✅ DONE.** `LayerInstaller` fetched
sig-addressed content with `cache: 'no-store'`, overriding the relay's immutable header.
Dropped `no-store` on all three sig-addressed (immutable) paths so the cache header does
the work:
- `layer-installer.ts:261` `#fetchBytes` → plain `fetch(url)`.
- `dev-layer.source.ts:25` `tryFetchLayer` → plain `fetch(url)` (sig-addressed even in
  dev — the sig changes when content changes, so caching is always correct).
- `store.ts` `jsImmutableHeaders` (was `jsNoStoreHeaders`) → the cached bee Response now
  carries `public, max-age=31536000, immutable` instead of `no-store`.

**Deliberately kept `no-store`:** `manifest.json` fetches and HEAD liveness probes
(`ensure-install.ts`, `sentinel-handler.ts`, `tree-resolver.service.ts`,
`dcp-installer.service.ts`, `host-sync.service.ts`, `content-broker.drone.ts`). The
manifest is the one *mutable* discovery doc — caching it would stop prod from detecting
updates. These lose `no-store` only when Phase 4 makes discovery root-sig-addressed.

**Result:** re-fetches of unchanged content → 0 bytes on the relay path. No protocol
change. Phase 1 is done.

**Cleanup (Azure retirement):** `scripts/deploy-azure.ps1` and any Azure SWA / CDN
config (`staticwebapp.config.json` cache rules) are now dead code — the Azure blob path
that the earlier "Gap B" referred to no longer ships content. Safe to delete in a
separate housekeeping pass.

## Phase 2 — Compress the mesh path (low effort; unblocks the 256KB cap)

**Gap:** mesh layers are uncompressed JSON, then base64-encoded (+33%), against a hard
256KB ceiling.

**Do:** `gzip → base64` on send and `base64 → gunzip` on receive in
`content-broker.drone.ts`, using browser-native `CompressionStream` /
`DecompressionStream` (no dependency). Version the content tag so old and new peers
interoperate.

**Result:** ~70% smaller events; larger layers fit under 256KB; less relay bandwidth.
This is the one place where compression in our own code (not the CDN) clearly earns its
keep.

## Phase 3 — Relay compression for cold HTTP text (low effort)

**Gap:** cold fetches of bees/deps/JSON ship full bytes. With Azure retired, the relay
(`hypercomb-relay`, Node `http`) is the *only* serving surface — and it does no
compression, so this is no longer a "free CDN default," it's a real gap we own.

**Recon notes:** bare sig files (no extension) are served as
`application/octet-stream` (`relay.js:581`). The MIME fix (URL tail authoritative for
content-type; see `project_adopted_css_octet_stream_mime` in memory) lives in the
service worker `hypercomb.worker.js`.

**Do:**
- **Ship the MIME fix to prod** if it isn't already (it was done in dev). Compression
  negotiation and caching both hinge on a correct `Content-Type`, so this rides first.
- Add gzip/brotli to the relay — either a compression middleware, an explicit
  `gzipSync` of text responses with `Content-Encoding: gzip` in `relay.js`, or front the
  relay with a compressing reverse proxy (e.g. nginx/Caddy). Compress text content-types
  only (`application/javascript`, `application/json`, `text/css`).
- Leave images and byte-array resources alone — already compressed; double-compression
  wastes CPU.

**Result:** ~70–80% on the first fetch of text content. Transparent, zero client code.

## Phase 4 — Closure-pack + root-sig negotiation (the real architecture gap)

**Gap:** install is manifest + N sequential fetches; there is no O(1) "anything changed"
gate; the closure walk descends only one level.

**Do:**
- **Negotiate:** make discovery a root-sig compare — the client sends the root sig it
  holds; the server answers "unchanged" (0 bytes) or "here is what's new." This is git's
  have/want; the sigbag-root model already provides the O(1) compare primitive
  (`project_update_detection_o1_root_compare`, `project_sigbag_root_model`).
- **Pack:** a `closure-pack` endpoint — "give me the transitive closure of root X minus
  the sigs I already hold" → one framed response (sig→bytes), delta-compressible
  server-side. Extend `decoration-closure.ts` to descend fully rather than one level; it
  is already the skeleton of a closure walker.

**Result:** N+1 round-trips → ~2; cross-object delta; lower first-paint latency.

**Risk:** this is a wire-protocol addition. Keep the per-sig fallback so old hosts and
peers still work, and gate the pack path behind capability detection.

---

## Sequencing rationale

Phases 1–3 are independent, low-risk, and shippable immediately — they harvest wins the
content-addressed model already earned. Phase 4 is the genuinely new architecture and
warrants its own review before building, since it touches the wire protocol and
federation interop.

**Where gzip lands:** Phases 2 and 3. Real, but the *last* lever. The wins that actually
move the needle are Phase 1 (cache what is immutable) and Phase 4 (don't send it at all).

## Phase 1 recon (findings)

What each serving surface sets today:

| Surface | Content-Type | Cache-Control | Compression | Source |
|---|---|---|---|---|
| **Relay** (`http`) | extension lookup; bare sig → `octet-stream` | `public, max-age=31536000, immutable` ✅ | none | `hypercomb-relay/relay.js:565-582, 691-697` |
| **Azure blob / SWA** | `--content-type` per file; bare sig → `octet-stream` | **none on upload** → CDN defaults | CDN gzips text by default | `…/scripts/deploy-azure.ps1:400-438` |
| **Service worker** | URL tail authoritative (MIME fix) | mirrors host | passes host encoding through | `hypercomb-web/public/hypercomb.worker.js` |
| **Client — domain-layer (prod)** | n/a | plain `fetch(url)` → respects relay header ✅ | n/a | `…/layer-install-sources/domain-layer.source.ts:32` |
| **Client — LayerInstaller** | n/a | `cache: 'no-store'` → **defeats immutable** ❌ | n/a | `layer-installer.ts:261` |
| **Client — dev-layer** | n/a | `cache: 'no-store'` (intentional) | n/a | `…/layer-install-sources/dev-layer.source.ts:25` |

**Net scope:** immutable caching is **already live** on the relay; Phase 1 is just (A)
drop `no-store` in `LayerInstaller` and (B) add cache-control to the Azure upload — two
small edits. gzip is a CDN/proxy decision (Azure covers SWA; the relay needs a
compression middleware). The MIME fix is done in dev and only needs to reach prod.
