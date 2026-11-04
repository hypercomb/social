# Single Paint — rendering never repeats

A cell is painted when its signature changes, once, and nothing else on the
page is touched. In a swarm this is the difference between a hive that gets
faster as participants join and one that slows them all down: a peer's change
must cost every other participant **O(changed cells)**, never O(page), and the
bytes it moves must be the atoms they lack, never the atoms they hold.

Codex tier: **Paint** (`V1`–`V7`, scope `[code]`). This document carries the
argument; the codex carries the rule.

## The rule, in one line

> Same signature, same pixels. A slot is rewritten only under a new paint key,
> and a repaint under an unchanged key is a **defect**, not a cost.

This is the signature algebra (`I1`, `D1`) applied to the screen. A cell's
pixels are a pure function of its **paint key**:

```
paintKey(cell) = {
  face: <small image sig | null>,   // what the hexagon shows
  marks: <tag / pheromone state>,   // border colour, lights
  substrate: <sig | null>,
  label: <display text>,
  slot: <axial index>,
  state: hover | selected | dive | flower
}
```

Everything in the key is either a signature or a small enum. Two cells with
the same key are the same pixels. A cell whose key did not change between two
passes is not repainted — not "cheaply repainted", **not repainted**.

## What exists today (2026-11-04)

The machinery is already in `show-cell.drone.ts`; it is being bypassed.

| Mechanism | Where | State |
|---|---|---|
| Converged-key fast path: a full pass returns early when `buildCellsKey(cells)` equals `renderedCellsKey` and the atlas generations match | `show-cell.drone.ts` ~5335–5353 | works |
| Synchronous incremental add/remove through the slot machine, no OPFS | `#queueIncremental` ~2828, `#runIncrementalSync` ~2849 | works for `cell:added` / removed |
| Async incremental pass for `added / removed / changedContent / changedTags` | `renderIncremental` ~3015 | used by `tags:changed` only |
| Microtask coalescing + a rendering lock + one trailing re-run | `requestRender` ~2398–2442 | works, but every pass it runs is a **full** pass |

What defeats it: about **forty handlers write `renderedCellsKey = ''`**, most
also `#forceNextRender = true`, before calling `requestRender()`. The reason is
recorded at ~6200–6206 (`tile:saved`):

> "The incremental and in-place fast paths both raced with concurrent
> synchronize renders, leaving the tile blank. requestRender is serialized via
> the rendering lock and rebuilds from OPFS."

So the root defect is not a missing dirty set. **More than one owner writes
geometry**, the cheap paths are therefore unsafe, and every author who was
bitten reached for the one serialized, expensive path. The pattern then spread
to handlers that were never racing.

The swarm multiplier is one handler. `swarm:resource-arrived` (~7418–7430)
already loops `cellImageCache` to find exactly the cells holding the arriving
signature — and then wipes the page key anyway. Arrivals recurse per nested
signature (`swarm.drone.ts` ~5708–5729: a layer's picture, meta and tags each
arrive on their own), so **one peer saving one tile = several full passes on
every participant**. That is how participants slow the swarm.

Other named offenders, all the same shape:

- `title:indexed` / `reference:indexed` (~6380–6401): the label is invalidated
  per name in the atlas — correctly — and then the page key is wiped. Hydration
  emits one per titled cell, so a page of N titles rebuilds N times.
- `tile:hover` in `tile-name.drone.ts:268` calls `#refreshAll` → `#placeAll`
  (every name) although `#placeHovered` (~606) exists and repaints one.
- Heat fades write one slice and then push the whole `aHeat` buffer, once per
  fading cell per frame (~12300).
- The Pixi ticker has no idle or dirty gate (`pixi-host.worker.ts` ~256), so
  every repaint runs at display rate until something stops it.

The wire side is already right in principle: a received resource is hash-checked
before it is written (`swarm.drone.ts` ~5690–5698, `S3`), `putResource` dedups
by signature, and only **missing** nested signatures open a one-shot
subscription (~5719–5725). Bits are not the first problem; **paint per bit** is.

## The mechanism

### One render owner (`V3`)

```
dirty: Set<label>          // what changed since the last drain
full:  boolean             // location or layout-mode changed → everything
drain(): once per frame / synchronize
  cells = full ? all : dirty
  for each cell: key' = paintKey(cell); if key' === painted.get(cell) skip
                 else write slot(cell), painted.set(cell, key')
  push buffers once
  dirty.clear(); full = false
```

- `requestRender()` becomes `#dirty(label | iterable)` plus `#dirtyAll(reason)`.
  `#dirtyAll` is legal in **two** places: a location change and a layout-mode
  change (framed / pivot / flat). A doctrine ratchet keeps it that way (`V7`).
- Nothing writes geometry outside `drain()`. The race that justified the
  full-pass fallback cannot occur, because there is no second writer. The
  incremental path stops being a fast path and becomes **the** path.
- A full pass is not a different algorithm. It is `drain()` with `full = true`.
  Cells whose key is unchanged are still skipped — navigation back to a page
  whose cells are already baked costs the diff, not the bake.

### Per-slot buffers, one push (`V4`)

Attribute buffers (`aHeat`, UV rects, border colour) are written per slot from
`drain()`, and uploaded once at the end of it. A per-cell animation (a fade, a
heat decay) writes its slice into the buffer and marks the buffer dirty; the
next drain pushes. Never `buffer.update()` from inside a per-cell loop.

### Arrivals are data (`V5`)

`swarm:resource-arrived { sig }`, `content:arrived { sig }`,
`title:indexed { label }`, `reference:indexed { label }`, `tile:saved { cell }`
and `tags:changed { updates }` all name what changed. Each handler does three
things and nothing else:

1. drop the per-cell caches for the named cell(s) (the code already does this);
2. `#dirty(labels holding that sig)` — for an arrival, the loop at ~7420 is the
   lookup;
3. return. The drain runs when the frame runs.

Arrivals within one frame — a layer, its picture, its meta, its tags — coalesce
into **one** drain that writes the slots they touched. A participant whose page
holds none of the arriving signatures writes nothing and pushes nothing.

### Signatures first, bytes on miss (`V6`)

What travels between participants is the head signature and, on request, the
atoms a receiver lacks (`T1`, `T2`). The receiver:

1. reads the new head's layer, diffs its child signatures against what the
   store holds (`A6`: same content is one signature, stored once);
2. requests only the missing atoms, **once per signature across every drone**
   — a store-level in-flight map, not a per-drone subscription set;
3. paints what it has now (substrate, name) and the picture when its bytes land
   — one more **cell** paint, never a page;
4. fetches visible dirty cells before off-screen ones; off-screen stays lazy.

Paint never blocks on a fetch, and a fetch never triggers a page.

## The swarm cost model

Let a page hold `n` cells, the swarm `k` participants, and a peer change touch
`c` cells with `a` arriving atoms.

| | today | under Single Paint |
|---|---|---|
| slots written per participant | `a × n` (one full pass per arrival) | `c` |
| buffer pushes per participant | `a` (plus per-cell heat pushes) | 1 |
| requests per participant | up to `a` + whatever a full pass re-asks (`visual:wanted`, `content:missing`) | exactly the atoms it lacks, ≤ `a` |
| swarm-wide paint work | `k × a × n` | `k × c` |

The last row is the point. Today the cost of one change grows with page size
and with every participant who joins. Under the rule it grows only with what
changed.

**Hypothesis to measure, not yet verified:** a full pass re-emits
`visual:wanted` / `content:missing` for cells whose bytes are still in flight,
so the repaint multiplier may also be a **request** multiplier. Count requests
per peer change on a two-participant harness before and after; if the count
drops with the paint fix, the bits problem was the paint problem.

## Rigor — how it stays true (`V7`)

Doctrine is a rule the build can refuse, or it is a wish.

1. **Ratchet the wipes.** Freeze per-file counts of `renderedCellsKey = ''`
   and `#forceNextRender = true` the way `doctrine.storage-writes.json`
   freezes raw storage writes: never raise a count, delete the entry when it
   reaches zero. Fixing a handler clicks the ratchet tight behind it.
2. **Count unchanged-key repaints as defects.** Under `hc:verbose=1` the drain
   warns, once per label per session, when a slot is rewritten with a key equal
   to the one already painted. A dashboard number is not enough: a warning
   names the handler that caused it.
3. **Specs with exact numbers.**
   - one tile change on a 50-cell page → **1** slot written, **1** buffer push;
   - one peer arrival of one picture → **1** slot on the receiver whose page
     shows it, **0** on a peer whose page does not;
   - a back-navigation to an already-baked page → **0** slots rewritten;
   - hover moving from A to B → names A and B re-placed, no others.
4. **One owner, by construction.** Geometry writes outside `drain()` are a
   ratchet of their own: the allowlist is `drain` and nothing else.

## Order of work

1. Introduce `#dirty` / `#dirtyAll` and `drain()` beside the current pass;
   route `requestRender()` through `#dirtyAll` so behaviour is unchanged and
   the ratchet baseline can be frozen.
2. Move `tile:hover` to two names (`#placeHovered` for previous and next).
   Smallest, clearest, visible on every pointer move.
3. Re-route `title:indexed`, `reference:indexed`, `tags:changed`, `tile:saved`
   to `#dirty(label)`. Hydration becomes one drain.
4. Re-route `swarm:resource-arrived` and `content:arrived` to the cells that
   hold the signature. Measure on the two-participant harness.
5. Per-slot buffer writes; one push per drain; the ticker gate.
6. The store-level in-flight map for fetches (shared with the Derived tier's
   image-decode record).

Single-flight `act()` and one first-pulse owner (the Runtime findings of the
same audit) come **before** step 4 is measured, or the render count is still
inflated by duplicate pulses and the numbers lie.

## Non-goals

- Not a new renderer, not a scene graph, not a framework. The slot machine,
  the atlases and the SDF shader stay; only who may write to them changes.
- Not a cache of pixels across sessions. The atlas is already the derived
  cache (`D1`); the paint key is in memory and is rebuilt for free on boot.
- Not a throttle. Coalescing by frame is not dropping work; every dirty cell
  is painted, exactly once, in the next drain.

## Related

- `optimize-phase.md` — derived records keyed by source signature (`D1`–`D5`);
  the image-size record that stops `optimizeVisual` re-decoding every session
  lives there.
- `signature-algebra.md` — why same signature means same thing, everywhere.
- `install-by-replication.md`, `pools-across-hosts.md` — what travels and how
  it is verified at admission.
