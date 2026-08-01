# Mobile Grand Master Plan — the hive as something you READ

**Status: PLAN + Phase 1 BUILT (2026-07-31).** Sits on top of
`mobile-usable-first-plan.md` (which fixed *can you use it at all*) and
`mobile-experience-plan.md` (the machinery). This plan answers the next
question, Jaime's: *"readability and the size of text… focus on being able to
read and do things rather than making it similar to the other version."*

---

## 1. The thesis

Desktop is a **map you survey**: free zoom, a cursor that hovers, a big canvas
where the whole hive can be small because your eyes can pick out one hex among
fifty. Mobile has been a shrunken copy of that map — same free zoom, same
arbitrary scale, and therefore text at whatever size the last pinch happened to
leave it.

On a phone the hive is not a map. It is **a column you read.**

So mobile keeps the hexagon — it is the identity of the thing, and a phone
screen is a perfectly good place for one big hexagon — but it drops the
free-form canvas posture and adopts a **lane** posture:

> **Lanes are the phone's zoom.** Not a continuous scale, but three rungs of a
> legibility ladder: **3 = scan · 2 = browse · 1 = read.** The lane count fixes
> the hex width to a *known fraction of the viewport*, so text size stops being
> an accident and becomes a **choice**, and the long axis stays free to scroll.

Three lanes was already the right instinct — it gave focus and control. This
plan promotes it from a command (`/lanes`) into **the mobile viewport model**.

## 2. The six pillars

### P1 — The legibility ladder (lanes are the zoom) · **BUILT**
Lane count 3 → 2 → 1, walked by the **lane button in the view row** (the digit
on the button IS the readout), by a **settled pinch** (spread = read, squeeze =
scan), or by `/lanes 1|2|3|off`. Fewer lanes ⇒ wider hexes ⇒ bigger name,
bigger picture, readable notes. The rung persists per participant
(`hc:lane-count`); the arrangement it produces is ordinary tile truth,
committed once per rung — never continuously while a finger moves.

### P1b — Lanes turn with the device · **BUILT**
**Lanes always run across the SHORT axis; the strip scrolls along the LONG
one.** Portrait ⇒ point-top columns, scroll up/down. Landscape ⇒ the same
lanes rotated onto their side: flat-top columns packed into a left→right
strip, scroll sideways. Keeping the portrait packing in landscape produced
very wide tiles that still only moved up and down — the strip pointing the
wrong way. Because only flat-top hexes pack into straight horizontal lanes and
only point-top into vertical ones, **lane mode owns the hex orientation** while
it is active and hands the participant's standing choice back when released.

### P1c — Two rows of five, never six squeezed into one · **BUILT**
The bottom bar is a **fixed five**: back · fit · **CAMERA** · view▲ · mesh,
camera dead centre where the thumb lands. Everything that changes *how you see*
moved one row up into a **pop-up view row** — fullscreen · lanes · rotate ·
arrange · pheromones — opened by the view▲ button and closed by it or by a tap
anywhere on the hive. The row is out of flow, so the bottom five keep their
rhythm; while it is up, floating chrome (the select pill) lifts by
`--hc-mobile-row-lift` so nothing is covered, and drops back when it closes.
In landscape the bar is a left rail, so the view row pops out to its right as a
column — the same relationship, rotated with everything else.

### P2 — One type ramp, derived from the rung
Every mobile text size descends from the rung and one participant **Text size**
preference (S/M/L/XL), published as CSS custom properties on the document and
consumed by the command line, sheets, the tile view and every panel. Nothing on
mobile sets a `font-size` in px on its own again. Canvas labels already scale
with the hex, so the ladder gives them for free — the ramp is for the chrome
around them.

### P3 — The hexagon becomes a card at 1 lane
At the read rung the tile is not a bigger badge; it is a **readable card that is
still a hexagon**: title at heading size, note excerpt in the body, picture
behind a legibility scrim, icon band at thumb scale. This is the fullscreen
tile-view content shown **in place**, so reading stops requiring a takeover and
the fullscreen view becomes the *focused* act rather than the only one.

### P4 — Do things without leaving the lane
The tile at the lane's centre is **focused**. One thumb-height action strip acts
on the focus: open · edit · mark · adopt · share · select. No hover, no hidden
long-press, no "where is that icon". Verbs read the existing
`SelectionService` — selection is the substrate (already doctrine), so a
multi-pick and a single focus drive the same strip.

### P5 — Lane rhythm: scroll settles
Scrolling along the lane axis **snaps a tile to centre**, so a read never ends
half-way between two hexes, and focus follows the settled centre. Viewport and
focus are never history (`viewport-not-in-history`).

### P6 — Behaviours declare the read rung
The platform-capability registry already makes every behaviour declare
`mobile`/`desktop` at birth. Extend it with a **lane-read renderer** hook: a
view that has something to show at 1 lane declares it; anything else falls back
to the card. Data-driven from marks, never a per-feature branch in the shell.

## 3. Deliberate rejections (so they are not re-litigated)

- **Lanes are NOT applied automatically on navigation.** An arrangement moves
  tiles, and moving tiles is *truth* — a viewport preference may never mint
  layers behind the participant's back. Lanes is always an explicit act.
- **Pinch does not zoom continuously in lane mode.** It steps the ladder on a
  cumulative-ratio threshold (1.35×). A jittery finger must never mint a run of
  arrangement commits.
- **No separate mobile UI tree.** Same hexes, same renderer, same drones — a
  different *posture*, expressed through arrangement, scale and chrome. A
  parallel mobile app would fork every future feature.
- **No auto-fullscreen, no flashy transitions.** Per standing convention.

## 4. Phases

| Phase | Delivers | State |
|---|---|---|
| **1 — Ladder** | lanes 1/2/3 turning with the device, view row + digit readout, pinch-steps-ladder, `/lanes n\|off`, rung persistence, `lanes:changed` broadcast | **BUILT 2026-07-31** |
| **2 — Ramp** | `--hc-text-scale` + Text size preference; command line, sheets, tile view, panels consume it | PLAN |
| **3 — Card** | 1-lane read rendering: title/notes/scrim/icon band in the hexagon | PLAN |
| **4 — Focus band** | centre-focus + one thumb action strip; verbs on the focus/selection | PLAN |
| **5 — Rhythm** | scroll snap along the lane axis, focus follows centre | PLAN |
| **6 — Declared reads** | registry hook for per-view 1-lane renderers | PLAN |

Each phase lands with its **mirror pass in the hive** in the same PR (tiles for
the parts, a collection, pheromones from the declared vocabulary, notes) — per
the mirror doctrine.

## 5. Phase 1 — what was built

| File | Change |
|---|---|
| `sequence/arrangements.ts` | `laneCoords(count, lanes, horizontal)` generalises the three-lane packing to 1–3 lanes (vertical: straight columns; horizontal: nested `lanes`/`lanes-1` columns, a single honeycomb row at 1). `LANE_MIN/MAX/DEFAULT`, `clampLanes`, `laneIndexes`. `threeLaneCoords`/`threeLaneIndexes` survive as the 3-lane case. |
| `sequence/lane-viewport-mode.ts` | Holds the rung beside the axis: `getLaneCount`, `setLaneCount`, `stepLaneCount`, `laneCountAtEdge`; persisted in `hc:lane-count`. |
| `sequence/sequence-cycle.drone.ts` | `lanes:set` / `lanes:step` / `lanes:off` effects (mobile-gated); lane direction from the DEVICE (`#landscape`), hex orientation aligned on engage and restored on release (with an echo guard so one act arranges once); `resize`/`orientationchange` re-lay the strip; toast names the rung; `lanes:changed {active, lanes}` published for chrome. |
| `commands/lanes.queen.ts` | `/lanes`, `/lanes 1\|2\|3`, `/lanes off`. |
| `navigation/zoom/pinch-zoom.input.ts` | In lane mode a pinch accumulates its ratio and steps the ladder at 1.35×, instead of being swallowed by the zoom lock. |
| `ui/controls-bar/*` | Bottom five with the camera centred; the pop-up view row (fullscreen · lanes · rotate · arrange · pheromones), its toggle, tap-away close (capture phase — the canvas eats bubbling taps), and `--hc-mobile-row-lift`. Lane tap walks 3→2→1→3; long-press (contextmenu) releases lane mode. |
| `selection/select-mode.drone.ts` | The select pill's `bottom` includes `--hc-mobile-row-lift`, so it rises with the view row. |
| `i18n/*.json` | `controls.lanes`, `controls.view-row`, `controls.rotate`, `controls.arrange` in all 14 catalogs; `arrange.lanes.one/.other` (en + ja, matching the existing `arrange.*` scope). |

**Verified live (dev-main-4258, 9 tiles, no OPFS wipe):** portrait ladder
3 (3·3·3) → 2 (5·4) → 1 (single column of 9); landscape re-lays to a
left→right strip — 1 lane = one honeycomb row of 9, 3 lanes = the 3-2-3 rhythm
four columns wide — and flips the hexes to flat-top, back to point-top on
return; bottom row is exactly five with the camera at x=187 of 375; the view
row sits above it and closes on a canvas tap; the select pill moves
99px ⇄ 173px with the row. `tsc` clean (essentials + dev), lane specs 10/10.
**Not verified:** live rotation through the real event (the Browser pane fires
no `resize` under an emulated viewport — dispatching one exercises the same
handler, and real devices fire both `resize` and `orientationchange`), and no
screenshot (the hidden pane composites no frames).

Ends the ladder honestly: a step past a rung is a no-op that re-publishes the
current rung, never a wrap from read back to scan (the button's own tap wraps —
that is a deliberate one-control affordance, not the ladder wrapping).
