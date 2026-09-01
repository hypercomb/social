# Streamlining the ask transport

*Measured against the live bridge, 2026-08-20. Every number below is from a
real probe on the running broker + renderer, not an estimate.*

## The short answer

Your instinct is right, and the situation is better than you framed it: **the
sig-keyed layer-metadata API you are proposing already exists and is already
the fastest thing on the bridge. Nothing in the ask path uses it.**

The win is not caching. The win is that the ask path is built out of the three
slowest ops while the fast lane sits unused.

## 1. `get-resource <sig>` IS the layer-metadata request

A layer is ONE canonical JSON blob, one sig-named file at the OPFS root:

```json
{ "name": "dolphin",
  "children":    ["<sig>", ...],
  "properties":  ["<sig>"],
  "decorations": ["<sig>", ...],
  "builds":      ["<sig>"] }
```

`name` is the only intrinsic; every other slot is an array of sig pointers
(`layer-slot-registry.ts`). So one read by sig gives you the whole node and
pointers to everything hanging off it.

Measured on the live bridge, same data both ways:

| request | latency |
|---|---|
| `get-resource <layerSig>` | **5 ms** |
| `layer-at segments:[]` (path walk) | 39 ms |
| `list-at` | **hangs — no reply in 9 s** |
| `inflate` | **hangs — no reply in 9 s** |

A path costs a sigbag directory enumeration plus ~2 file reads *per segment*,
and degrades to `O(depth × fanout)` when a segment has no bag of its own
(`history/layer-placement.ts:262-289`). A sig costs one read, or zero warm.

## 2. The real bottleneck is the socket, not the store

Five ask-path clients (`watch-asks`, `_ask-drain`, `_ask`, `bridge-cli`,
`_chat-reply`) open a **brand-new WebSocket per request** and resolve on the
first frame back. That is one TCP connect + one HTTP Upgrade + one close per
logical op — and via `bridge-cli` also one `node` process each.

This is a client convention, **not a protocol constraint**. The broker already
routes by `id` (`run-bridge.cjs:95,107`), and **several scripts in the same
directory already multiplex** many concurrent ops over one socket
(`_moose-paint.cjs`, `_welcome-decorate.cjs`, …).

Measured, resolving the 16 root tiles to names:

| approach | total | per tile |
|---|---|---|
| socket-per-request, sequential (today) | 49 ms | 3 ms |
| one socket, pipelined | **5 ms** | **0.3 ms** |

**9.8× — with no protocol change.** Just a shared client module.

## 3. So should we hold the hive in memory? Yes — and it barely matters

Whole `behaviors` subtree, one pooled socket, sig-addressed:

> **97 tiles, depth 3, 22 ms, 19 KB of layer JSON.**

At 19 KB the caching question answers itself — hold it all. But note how small
the prize is next to the 9.8×: **pipelining beats caching.** Do both, in that
order.

Two hard rules on what may be cached:

* **Cache sig → bytes forever.** Content-addressed, so an entry can never be
  stale, only present or absent (`store.ts:1616,1656`). The HTTP tier already
  serves these `immutable, max-age=31536000`.
* **NEVER cache path → sig.** Under leaf-only commit a parent's `children`
  sigs are frozen at the parent's last commit, so a descendant added since is
  invisible through the chain (`history.service.ts:2288-2299`). Also: a null
  is not authoritative — `stats.cold` distinguishes "no layer" from "bytes not
  here yet", and the bridge surfaces that flag on no op at all.

## 4. The N+1 is already solved — and unreachable

`sign('manifests')` holds a record **keyed by parent layer sig**, containing
per child: `{ sig, layer (full, inlined), props, visual (≤512px webp) }`.
That is names + props + thumbnails for every child in **one read**. Its own
source comment states the target: *"a location paints from exactly TWO reads —
the layer, and this array"*, against a measured 213 reads to repaint a 10-tile
page (`manifest-optimizer.drone.ts:34-36`).

**No bridge op can read it.** `get-resource` resolves only the flat content
root, never a pool dir. One new op — `pool-get meaning=<m> key=<sig>` — turns
a subtree walk into one read per level.

## 5. Instant feedback: use the watcher, not a fast model

You are right that the ack should come first, and right again that it should be
simple and generic. It should not be a model at all.

`agent-progress` is **already write-free** — pure `EffectBus.emit`, no layer,
no commit, no history (`claude-bridge.worker.ts:402-414`), with
`pending|working|done|failed`. It is the ack primitive, already built.

The move: **fire it from `watch-asks.cjs`, in the same tick that sees the ask** —
before the model is woken at all. The watcher has the sig; the model does not
yet. Zero model cost, zero latency, and an ack that cannot be wrong because it
claims nothing.

```
tick sees ask  →  agent-progress <sig> "picked up" status:working   (~2 ms)
               →  print the line, wake the session
session        →  agent-progress <sig> "reading the tiles"
               →  … answer …
```

**Then kill the poll.** There is no push channel anywhere in the broker — no
subscriber set, no fanout, no topic; a renderer message with an unknown `id` is
silently dropped (`run-bridge.cjs:106-113`). Adding renderer→client fanout is
~20 lines and takes ask latency from 0–6 s to ~0.

## 6. Bugs found while measuring

1. **`payload.context` is destroyed on the wire.** The queen packs up to 64
   content sigs — the branches you deliberately attached — then *both* drain
   scripts overwrite that key with the follow-up prompt strings
   (`watch-asks.cjs:161`, `_ask-drain.cjs:95`). The bridge-listen skill tells
   the session to read those sigs first. They never arrive. Two meanings on one
   key; the minted sigs lose. **Rename one.**
2. **`creationId` is not projected by `watch-asks.cjs`.** The skill says "no
   `creationId` means stamp nothing" — so a parked session stamps nothing on
   *every* break-apart and expand. That is exactly the failure that stranded eight
   unidentifiable empty groups at `ai-inside`. Also unprojected:
   `contextTruncated`, `scopePath`, `count`, `focus`, `groupsMin/Max`.
3. **`list`, `list-at`, `inflate` hang.** `list-at` walks named OPFS
   directories that doctrine eradicated (`worker.ts:982-991`); `inflate`
   recurses the entire DAG with no depth or scope limit. A shallow
   `inflateLayer(sig)` already exists in `inflate.ts:187-210` and is imported
   by nothing.
4. **Broker leaks `pending` entries.** An op the renderer never answers keeps
   its Map entry forever — `ws.on('close')` clears only `renderer`
   (`run-bridge.cjs:116-121`). Bugs 3 and 4 compound.
5. **Hive:** root lists `pheromone-workflow` **three times, identical sig
   `b65c876c`** — one tile, three entries in root's children array.

## Recommended order

| # | change | cost | effect |
|---|---|---|---|
| 1 | shared pooled-socket client for the 5 ask scripts | small | 9.8× |
| 2 | ack from the watcher via `agent-progress` | ~5 lines | instant feedback |
| 3 | rename the colliding `context` key; project `creationId` | small | fixes 2 real defects |
| 4 | `pool-get` op → children manifest | small | N+1 → 1 |
| 5 | renderer→client push; retire the poll | ~20 lines | 0–6 s → ~0 |
| 6 | shallow `inflateLayer` behind a `layer-by-sig` op; fix/retire `list-at` | small | removes the hangs |

1–3 are the ones that pay immediately. 5 is what makes the tier feel live.

