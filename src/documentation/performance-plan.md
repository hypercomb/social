# Performance plan — the best experience the principles allow

**Status: PLAN, nothing below is built unless it says so.** Written 2026-10-23 from a six-area audit (published-site arrival, participant boot, hexagon render, network and hosting, bytes and assets, interaction and mobile), every proposal checked by a skeptic against the principles and re-measured, then read by a completeness critic. Numbers are the skeptics' corrected figures, measured 2026-10-22/23 on live doors and local builds. Where a number is an estimate it says so.

jwize, 2026-10-23: *"We're turning this thread into the performance optimization and make sure we have the best possible experiences and whatever is at our disposal that doesn't break the principles of Hypercomb. If we're not there yet give me your plan."*

## Where we are

| Path | Today | Verdict |
|---|---|---|
| Published site with a working arrival plan (revolucion, colony) | page up in 1.1–1.6 s (×1), 2.1–2.8 s (×4 CPU); 117 requests, 0.94 MB | good; the remaining cost is round trips and the shell chain |
| Published site whose plan does not resolve (meetups, jaime-weise) or has none (business-card) | the WHOLE package loads: 569 scripts, ×4 5.6–7 s, Pixi running under the card | **broken** — the plans were stamped lower-case |
| Participant, first visit (install by replication) | **63–67 s** to installed: two host stalls (12 s + 15 s), transfer pack 404, ~1,030 loose fetches in lockstep, 16 s of local admission | **the worst first impression we have** |
| Participant, warm reload | Angular paint 3.0–3.8 s (×1), 10–19 s (×4); 2 s of it re-deriving an import map that is already applied | fixable without new records |
| Hexagon navigation | 4 ms (×1), 20 ms (×4) to tiles; 0 long frames at ×1 | excellent — leave it alone |
| Site page navigation on a door | median 113 ms, p90 ~270 ms | good |
| GPU | the image atlas allocates **~1.25 GiB** (a 4-sample MSAA buffer it does not need) on every device; under software WebGL every picture is silently blank | correctness bug |
| Idle | 120 frames/s on an idle hive; the ticker keeps painting under covering views and on published doors | waste, battery |

Three things are outright wrong, not merely slow: the **double gzip** on R2-held atoms (bytes that no longer hash to their signature at `/content/<sig>`), the **lower-case arrival plans**, and the **blank atlas on software GL**. One is a live principle violation: Cloudflare **Network Error Logging** (`Report-To: a.nel.cloudflare.com`) on every door — browsers report to a host we do not control (P4/P5).

## The minification question, answered

*"Is there a feasible way to compile and minify the Hypercomb libraries without breaking signature verification — a community-verified minification stored in pools of meaning?"* … *"They just need to verify the signed bytes and relate them to the correct pool."*

- **It is built and live for published sites** (2026-10-18, `6a207a974`): the visitor runs a minified DERIVATION of the readable package — leading `//` alias lines kept byte for byte, names kept, every file verified by its own hash, the readable inputs shipped beside it, and `scripts/verify-minified-package.mjs` re-derives it exactly (esbuild 0.27.3).
- **The gain is real but modest**: −28% on the wire, −9% compile. Hosts already compress, and the remaining cost is the request chain. Full name-mangling adds only ~8 points and would break IoC keys — never.
- **Your rule is half built.** Signed bytes are verified everywhere. Relating them to the correct pool is NOT: the minified root points back with two fields (`derivedFrom`, `derivation`); no `sign('derived:<readableRoot>')` member is written; the `attest:<record>` pool exists but nobody has attested the live record and no reader consults it; the in-hive verifier cannot run on hypercomb.io (its esbuild-wasm files are not deployed); esbuild is pinned only by the lockfile. Wave 7 finishes it.
- **The bigger code-byte wins are elsewhere**: pixi (2.36 MB, unminified, *unsigned* — mapped by URL with no integrity) and core (369 KB, same), and brotli. Wave 6.

## The rules every item keeps

P1 every executed or rendered byte verified against its signature · P2 derived things are derivations, complete-or-absent, never load-bearing, related to their source by pool membership · P3 pools of meaning, never typed folders, side files or named routes · P4 no third-party requests · P5 no tracking, only live concurrent counts · P6 install and update only by replication, data never heals · P7 hosts expose head identifiers only · P8 secrets device-local · P9 a published site loads only its branch; the hive arrives on intent; no wait-for-everything barrier · P10 no placeholders — cut the real work · P11 minimal surface, atomic signed modules.

## The plan, in order

Effort: S = a day or less, M = a few days, L = a week or more. "Deploy" names who has to ship it.

### Step 0 — the scoreboard (S, local)

Nothing below is claimed until it moves a number here. Today the reports disagree 2× on the same door, a deploy landed mid-audit, and the cold-load script runs 2 loads in one browser. Because P5 forbids field telemetry, a **local lab scoreboard is the only feedback loop** — so it is a deploy gate in `publish:revision` and the worker checklist, never CI and never anything sent anywhere.

- Extend `scripts/visitor-cold-load.cjs`: a fresh browser per load, ≥5 interleaved runs, stamp the worker version + package sig + door head, two stop signals (covered, and the first settled `render:cell-count` for hexagon doors), requests, bytes, `loader:arrival missing=0`, SRI/console errors, long-frame blocking. Doors: meetups, jaime-weise, colony, hyperdex, business-card, revolucion, arkanoid. JSON to the OS temp dir, diffed against the last run.
- A hexagon first-frame audit on a real GPU (`--use-angle=d3d11 --enable-gpu`), plus a SwiftShader run that probes an atlas pixel (catches the blank atlas).
- Static ratchets, no browser: the eager boot-lane closure (823 KB / 64 modules) may only shrink; no new always-on `ticker.add`; no unhashed fetch→blob path; every live door's plan resolves with 0 missing.

**Built 2026-10-23:** `scripts/scoreboard.cjs` (doors × runs × CPU ×1/×4, a Mann–Whitney gate, a "shown" mark that catches a cover that never lifts), `scripts/hex-first-frame.cjs` (GPU + SwiftShader, atlas pixel probe), and three ratchets in `doctrine.spec.ts` (tickers, executable blob URLs, the boot-lane closure — 63 modules from source). Not yet wired into `publish:revision`; the "every plan resolves" ratchet is still the scoreboard's `plan` column. A gate between sessions sees machine drift: a reliable gate measures live and candidate interleaved in one session.

### Wave 1 — the worker transport bundle (S · one worker deploy)

| Item | Gain (corrected) | Principle |
|---|---|---|
| **Fix the double gzip**: `serveModule` and `originAtom` pass `typeOverride` to `serveBlob`; better, drop the manual `CompressionStream` paths and let workerd encode | correctness: R2-held text atoms ≥1 KB hash to their sig again | restores P1 |
| **Compress the door page** (keep `no-transform`, so no beacon): 72 KB → ~13 KB | −60 KB every visit (the page is `no-store`); −300 to −450 ms at 150 ms RTT; −30 to −60 ms broadband | P4 kept |
| **The 12–15 s host stall**: `heapHoldsPackage` walks the whole package (~72 serial R2 round trips) on a cold isolate memo. Widen the waves now; later persist the "whole" verdict as a pool member keyed by root | removes 26.8 s of the 63–67 s cold install; also unblocks the update scout and the Packages window | P2/P3 |
| `heldIndexRaw`'s cache put → `ctx.waitUntil`; memoize `installPointer` per isolate; overlap the bag read with the index read | −30 to −120 ms on cold door documents | P7 kept (the bag stays the gate) |
| **NEL off** per zone | removes a live P4/P5 violation | P4/P5 — **your act** (zone setting) |

**Built 2026-10-23 (awaiting deploy):**
- The double gzip is fixed by letting workerd encode once (`W/"<sig>.gz"`). A bare `W/"<sig>"` from the hand-gzipped era is never answered 304. That heals only a revalidated copy: a corrupt copy a browser still holds as fresh (immutable, a year) needs the client to drop it — Wave 2 (`?e=1` on `/content/<sig>` reads, or hash-then-reload).
- The whole-package verdict is kept in `sign('host:whole-packages')`, under the forget generation `sign('host:forgotten')` names. It is trusted 6 h, re-earned behind the answer up to 12 h, and walked inline past that. `/forget` moves the generation before and after its deletes, and checks each claim again right before its delete.
- One index read per door page, its edge fill on `waitUntil`; the bundled install pointer is read once per deploy (an answer is kept, a miss is not). No request ever joins another request's work in flight: a promise dies with the request that started it.
- **Compress the door page: dropped.** Under `no-transform` the edge strips the encoding, so the page stays 72 KB. Lifting `no-transform` on the zones whose Web Analytics is confirmed off is decision 9.

### Wave 2 — arrival plans that resolve (S · visitor shell deploy + essentials publish)

| Item | Gain | Principle |
|---|---|---|
| `ArrivalQueenBee` gets `rawArgs`; the reader accepts a case-insensitive match **only when exactly one class folds to it**; stamping refuses a plan with any missing name | meetups ×4 5.7–6.3 → 1.9–2.1 s, ×1 1.88 → 0.90 s; jaime-weise ×4 6.3 → 2.1 s; 569 → 98 scripts; Pixi stops running under the card | P9; P6 (the signed records stay, the reader interprets) |
| **Hash the plan, quiet record and layers pack** before trusting them (`main.visitor.ts` "read, never re-hashed"; layers `trusted:true`) | ~1 ms; closes the gap where data that steers which signed bees run is unverified | P1 |
| Probe the exact `/<sig>` URL with integrity (today `?probe` downloads the first module twice); hash bytes before the blob fallback | −1 request; closes an unhashed-execution path that also opens on worker doors when the probe times out | P1 |
| Two core `modulepreload` links on the visitor page (the participant page already has them); drop the comment-only `env.js`; start the `en` catalog fetch beside the boot lane | −100 to −150 ms broadband, −0.3 to −0.4 s on mobile RTT | P4 |
| Then: preload the plan's closure (integrity = sig) the moment the import map lands | −100 to −200 ms ×4 | P1, P9 |

### Wave 3 — warm participant boot (S–M · shell deploy, then essentials)

| Item | Gain | Principle |
|---|---|---|
| **Import-map short-circuit**: put the deps bag sig + a deriver version into the existing `hc:importmap` entry; on boot, if that bag directory exists, skip the 655 bag reads; share `ensureInstall`'s listing | Angular paint 3.0–3.8 s → ~0.65–1.0 s (×1); 6–10 s off at ×4 | P2 (a check, not a new record) |
| **Import-map integrity entries** for every participant bee and atom | the only load-time hash check participants would have (today P1 rests entirely on admission); makes the 2 s software re-check redundant | P1 strengthened |
| **Stop sweeping all 14 locale catalogs** after paint (load the active one + `en`; others on `locale:changed`) | −3.76 MB to parse per boot, −640 KB on a first visit, −13 revalidations per warm boot | P11 |
| Content-hashed shell chunks `immutable` (today `max-age=30, must-revalidate` → 13+ conditional requests per warm boot); the dev shell overlaps its SW wait like web does | −13 round trips per warm boot | — |

### Wave 4 — the GPU correctness bundle (S · essentials only, can run beside anything)

| Item | Gain | Principle |
|---|---|---|
| Image atlas `antialias:false` | −1.07 GiB GPU on every WebGL2 device; **pictures appear under software GL** (today all blank); no visible change (only axis-aligned rects are drawn into it) | P10 |
| `destroy()` both atlases on renderer swap; **rebuild on WebGL context restore** and reset the readiness memos | pictures come back after sleep/wake or a driver reset instead of staying blank until reload | P2 |
| **Drop the legacy label seed** (it bakes every old bare label at first paint, 8.7–13.9 ms each, unbounded on old hives) | 0 on new hives; potentially seconds on old ones | P10 |
| **Stop the ticker while a view covers the hive** (resolution and bakes keep running, so Escape-to-hexagons stays instant); remove Pixi's `EventsTicker` listener | idle 120 → 0 frames/s under covers and on doors; ~half the idle main thread at ×4 | P9, P10 |
| **Compile the hex shader in parallel** (`KHR_parallel_shader_compile`) at host-ready, from ShowCellDrone | removes 460–640 ms of blocked main thread on a cold browser profile | P10 |
| Then (M): skip SDF glyph bakes the DOM name layer makes invisible | ~9–14 ms per label per first paint / branch entry | P10 |

### Wave 5 — cold install follows the signed root (S–M · shell + worker + publish)

| Item | Gain | Principle |
|---|---|---|
| Stop awaiting every zone's pool head once the signed channel names the root; `acquire` skips re-listing a root the channel named | removes the measured 12 s + 15 s stalls (with Wave 1) | P6 kept: the channel's signature still decides |
| Every host that serves the stamped head also serves its `sign('transfer:packs')/<root>` pointer and pack (hypercomb.com 404s today; 159 pointers sit on the relay) | 1,030 loose GETs → ~10 requests | P2 (the pack is delivery; loose atoms stay the cold path) |
| Sliding-window replication walker (N≈16, not lockstep 6); compute aliases / core-compat / import graph as each atom is admitted instead of re-reading ~958 modules; Cache Storage seeding off the critical path | local phase 16 s → ~3–6 s; loose phase 19 s → ~6–9 s | P1: still one hash per atom |
| **Target**: 63–67 s → ~20–25 s, then ~8–12 s with single-pass admission | | |

### Wave 6 — bytes (M · build + shell)

| Item | Gain | Principle |
|---|---|---|
| **pixi becomes a signed vendor atom** (full export, one alias, one instance; shell change first, keep serving `/vendor/pixi.runtime.js` for old shells) | closes a P1 gap (today trusted by URL); 466–503 KB → 349 KB br as shipped; minified ~200 KB br | P1, P6 |
| Minify the public copies of pixi and core (names kept) | −169 KB gz (pixi), −35 KB gz (core) per cold load | — |
| **Author image variants into site pages**: `srcset` + `sizes` + `loading=lazy` + `width/height` (the variants become content the page names — truth, not a cache) | revolucion: 6.03 MB of tile PNGs → ~0.1–0.2 MB (this art is low-entropy; photos ~5–10×) | P2 respected by making them page content |
| `font-display: swap` on Source Sans Pro Light (blocks visitor text up to ~3 s); pin unused icon-font axes (measure first) | latency, ~−10 KB/visit; icon font −50–75% (unmeasured) | P4 |
| Substrate palettes to WebP in `sign('substrate:<set>')` pools (forward commit; old URLs keep answering) | first use of a palette ~1.4 MB → ~0.2 MB; deploy 46.6 → ~5 MB | P3 (removes `manifest.json` side files) |

### Wave 7 — derivations become the common dialect (M · essentials + worker)

This finishes your minification rule and the render caches with ONE record shape (`documentation/derivations.md`).

- Write the record sig as a member of `sign('derived:<inputSig>')` when deriving (minify first). A reader cross-checks without a minifier: rebuild the derived root from the readable layers + the record's module map (a pure remap) and require it to equal the served root, and require `record.from` to be the root a signed pointer names. **Partly built 2026-10-29:** a layer derived with `minify-transpiler.ts` writes that membership, and `remapMinifiedRoot` is the cross-check. The esbuild visitor package does not write the pool yet. Attestations still do not decide which bytes a visitor runs.
- Attestations decide for participants: prefer minified bytes only when that check passes AND enough followed keys attest "reproduced"; otherwise the readable package, which already ships beside it.
- Pin esbuild exactly (not `^0.27.0`; the live CI deletes the lockfile); `tool` becomes the transform's own signature (step 5 of derivations.md); deploy esbuild-wasm where `derive verify` runs.
- Re-key the render caches (`visual-optimization`, `thumbnails:hex`, `system:manifests`) to the same shape: derived bytes at their OWN hash, verified on read (today they are stored under the input sig and rendered unverified — a P1/P2 gap).
- Brotli: first let workerd's automatic `br` cover worker-served text (free). Precompressed brotli only as ASSETS files named by their own sig, mapped in the install index — never a pool member named `br` (P3).

### Later, each measured on the scoreboard first

- Run the planned arrival inside the boot lane (−0.2 to −0.45 s ×4) — only **after** fixing the hidden barrier: hive-visit waits on `loader:bees-done`, which on a planless door means *every* bee (a P9 violation), and on a fully cached arrival is a fixed 15 s stall.
- A hexagons arrival plan for hexagon doors (business-card) — needs a `guardArrival` contract change.
- True render-on-demand (`invalidate()` + an animating refcount across the 11 ticker consumers).
- Shell surfaces load when their door opens (1.58 MB parse off the post-paint window; closer to L).
- Thin facades for heavy non-render bees (Chat, Llm, Orchestrator, AgentBee, ShareLink, Questions, Publish*, Comfy, the opt-in bridge): −0.56 to −0.9 MB eager. Never the swarm bees (connection first).
- Active-genome census: an own-content record per layer sig + a node budget with a resumable cursor; run on ask or after quiet, not every edit (your hive's 6–12k tiles make today's whole-closure walk ~25–120 s).
- Site navigation: resolve the page once per click (today three times), prefetch in-view links' pages on approach.
- The engine-free card door (recorded 2.4 s vs 11.5 s at ×4) — a Publish-window act.
- Door document `no-store` → `no-cache` + an ETag over the injected body: repeat visits become 304s and bfcache works, while every navigation still revalidates the head (P7 kept).

## Decisions only you can make

1. **NEL off** on every zone (Cloudflare dashboard) — the one live P4/P5 violation.
2. **May a derived record be minted at admission**, or only in the optimize phase? CLAUDE.md says optimize-phase only; derivations.md lists import-map bags computed by every client. This decides whether a per-package boot record is legal (Wave 3 is written to work either way).
3. **The two broken plans**: the reader fold repairs them with no republish; or re-say them with the right case as a forward commit.
4. **pixi's surface**: full export (default, extensible) vs a tree-shaken closed set (−108 KB br more, but community modules importing anything else fail to link).
5. **Hexagon doors** get an arrival plan (changes `guardArrival`'s contract)?
6. **GPU-less machines**: show the list face on desktop when WebGL is unavailable (lifts the list's phone-only rule)?
7. **`HEAD_ONLY`** stays tied to the hosted-tenants §4b flag and its two traps — not flipped for performance.
8. **A phone visitor has no way into the hexagons** on a published page without the exit meta (from today's right-click work). A deliberate touch door, or not?
9. **Lift `no-transform` on door pages** for the zones whose Web Analytics you have confirmed off: −60 KB every visit. The beacon guard then rests on the zone setting alone, so a new zone would inject until you turn it off.

## What we will not do, and why

- **Mangle names** — IoC keys and display names come from class names (P11 breaks).
- **Landing pictures, snapshots, skeleton covers** — P10.
- **Real-user monitoring** — P5; the scoreboard is local.
- **A `br` pool member or a `.br` side file** — P3; workerd's automatic encoding or sig-named ASSETS files instead.
- **A compression layer in swarm byte events** — the meeting point already negotiates permessage-deflate; it would add a protocol layer without a measured gain.
- **Sleep or pace the swarm bees** — connection and reconnect speed come first.
- **WebAssembly for speed** — the costs are round trips, file opens and module evaluation, not compute.
- **One bundle for all bees** — measured not worth it (c38); the request chain is shortened by preloading instead.
