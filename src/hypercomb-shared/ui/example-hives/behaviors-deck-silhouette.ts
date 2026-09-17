// The behaviors deck, silhouetted — the shape behind the opening page.
//
// The first-boot welcome used to float over a void: a fresh install has an
// empty hive, so there is nothing behind the card and the wash shades
// nothing out. This draws what the FIRST SCREEN of /behaviors actually looks
// like — the nine collections in the honeycomb they sit in — as a dim
// silhouette, so the opening page opens onto a hive rather than a hole.
//
// SHAPES ONLY, no glyphs and no labels: the platform draws tile labels, and
// generated tile art carries no text. What makes it read as real tiles
// rather than decorative hexagons is the anatomy of a card — the halo, the
// body, and the inner ring — mirrored from the card generator
// (scripts/behaviors-theme/gen-behavior-tiles.mjs).
//
// The palette is that generator's CATEGORIES, carried here rather than read
// from TagRegistry ON PURPOSE: the registry holds the PARTICIPANT'S tag
// colors, and on first boot it is empty — the one moment this art is shown.
// If the deck's collections or their colors change, both copies move.

/** Circumradius of one tile, in viewBox units. */
const S = 100
/** Point-top spacing — the platform grid's orientation (a card's ring is cut
 *  the same way, `ROT = 30`), so the silhouette agrees with the real thing. */
const COL = Math.sqrt(3) * S
const ROW = 1.5 * S

/** One collection per hexagon, in the rows the deck arranges them in. Odd
 *  rows sit half a column across — that offset IS the honeycomb. */
const DECK: readonly (readonly (readonly [name: string, color: string])[])[] = [
  [['tool-windows', '#6b7fae'], ['assistant', '#8a63c9'], ['games', '#c05b4d']],
  [['swarm', '#4f9d6e'], ['appearance', '#b06a9e'], ['guidance', '#c98f2f']],
  [['views', '#4d7fae'], ['structure', '#8b909a'], ['input', '#579fa5']],
]

/** Six points at 60° steps starting at 30° — a point-top hexagon. */
function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i + 30)
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
  }).join(' ')
}

export interface SilhouetteTile {
  name: string
  color: string
  /** Centre, in viewBox units — what the triad lights are placed from. */
  cx: number
  cy: number
  /** The soft overspill that makes neighbours touch. */
  halo: string
  /** The tile itself. */
  body: string
  /** The card's inner ring — the detail that says "this is a tile". */
  ring: string
  /** When this tile starts landing, in ms from the comb being revealed. */
  delayMs: number
}

/** The art, before the entrance gives it a schedule. */
const DECK_ART = DECK.flatMap((row, r) =>
  row.map(([name, color], q) => {
    const cx = q * COL + (r % 2 ? COL / 2 : 0)
    const cy = r * ROW
    return {
      name,
      color,
      cx,
      cy,
      halo: hexPoints(cx, cy, S * 1.16),
      body: hexPoints(cx, cy, S),
      ring: hexPoints(cx, cy, S * 0.62),
    }
  }))

// ── the entrance ────────────────────────────────────────────────────
//
// The comb does not appear; it GROWS. The splash converges on a honey dot
// and holds it while it fades (`hypercomb-dev/public/splash.js`), and the
// welcome continues that motion: tiles land in rings around the point the
// dot rested on, each triad's light blooms once all three of its tiles have
// arrived, the wash comes in under them, and the card lands last. It plays
// once and then rests on exactly the composition this file described before
// the entrance existed — same numbers, same look, no loop.
//
// The schedule is DERIVED from the geometry above, not hand-listed per tile:
// a tile's ring is its distance band from the origin, so tiles that are
// equidistant land together, and a light's delay is the latest of its three
// members so a light can never bloom over a tile that has not landed. The
// stylesheet owns the durations (a designer tunes those); the constants here
// exist so the ring math, and the moment the entrance is over, are computed
// in ONE place. Change them together.

/** Where the entrance ripples from, in viewBox units — the comb's own
 *  centre, which is also the composition's optical centre.
 *
 *  The splash's dot converges at viewport `(W/2, H*0.46 − 10)`, roughly 20
 *  viewBox units above this on a 900px-tall viewport — and the offset moves
 *  with the slice scale, so exact coincidence is not expressible as a fixed
 *  viewBox point. It does not need to be: what the eye reads as "growing out
 *  of the dot" is the ORDER (inner bands first), and only a centre on the
 *  comb's own axis of symmetry keeps mirrored tiles equidistant — which is
 *  what makes `b`/`h`, `c`/`i` and `a`/`g` land as pairs. Nudge this and the
 *  bands re-form around the new point; nudge it off `cy: 150` and the pairs
 *  fall out of step, one tile at a time. */
export const DECK_ORIGIN = { cx: 216.5, cy: 150 }

/** Gap between one band and the next. */
export const RING_STEP_MS = 170
/** How long one tile takes to land. */
export const TILE_MS = 520
/** A light waits this long after its last tile before it blooms. */
export const LIGHT_BLOOM_MS = 200
/** How long one triad light takes to bloom. */
export const LIGHT_MS = 760
/** Held back so the splash's dot is still fading into the first tile. */
export const START_DELAY_MS = 120
/** The card waits for the comb to be mostly up before it lands. */
export const CARD_DELAY_MS = 1250
export const CARD_MS = 460
/** The wash is there from the start — it is what shades the comb out. */
export const BACKDROP_MS = 300

/** Distances that are close enough to be the same band. Mirrored tiles come
 *  out exactly equal, so this only has to absorb floating-point noise. */
const BAND_TOLERANCE = 1

/** The distinct distance bands, nearest first — the rings, measured from the
 *  art rather than written down, so the schedule cannot drift from it. */
const RING_BANDS: readonly number[] = (() => {
  const sorted = DECK_ART
    .map(t => Math.hypot(t.cx - DECK_ORIGIN.cx, t.cy - DECK_ORIGIN.cy))
    .sort((a, b) => a - b)
  const bands: number[] = []
  for (const d of sorted) if (!bands.some(b => Math.abs(b - d) < BAND_TOLERANCE)) bands.push(d)
  return bands
})()

/** Which ring a tile at this distance belongs to. */
function ringOf(distance: number): number {
  const i = RING_BANDS.findIndex(b => Math.abs(b - distance) < BAND_TOLERANCE)
  return i < 0 ? RING_BANDS.length : i
}

export const DECK_SILHOUETTE: readonly SilhouetteTile[] = DECK_ART.map(t => ({
  ...t,
  delayMs: START_DELAY_MS + ringOf(Math.hypot(t.cx - DECK_ORIGIN.cx, t.cy - DECK_ORIGIN.cy)) * RING_STEP_MS,
}))

/** The last thing to finish: the outermost triad's light. The component uses
 *  it to latch the entrance off, so `render:cell-count` oscillating (a fresh
 *  dev origin installs bundled content and the count climbs back above zero)
 *  cannot replay the comb mid-session. */
export const ENTRANCE_TOTAL_MS = Math.max(
  START_DELAY_MS + (RING_BANDS.length - 1) * RING_STEP_MS + TILE_MS,
  START_DELAY_MS + (RING_BANDS.length - 1) * RING_STEP_MS + LIGHT_BLOOM_MS + LIGHT_MS,
  CARD_DELAY_MS + CARD_MS,
)

/** Padded so `slice` crops empty space before it crops a tile: the deck
 *  occupies roughly x −87…520, y −100…400 inside this box. */
export const DECK_VIEW_BOX = '-300 -280 1050 860'

// ── a light per triad ───────────────────────────────────────────────
//
// Three mutually-touching hexes meet at ONE shared vertex, and that triad is
// the comb's real unit — the honeycomb is nothing but triads sharing edges.
// So the light is placed per SET OF THREE: one source at each shared vertex.
//
// Every tile belongs to several triads, so it is lit from several angles at
// once and darkest along the runs between them. That is what gives each
// direction its own falloff — depth built from where the tiles ARE, not from
// one global gradient pretending the comb is flat, and no blur or
// drop-shadow anywhere.
//
// Light is painted THROUGH a mask cut to the comb, so it lands on tiles and
// never on the ground between them: the void must stay void.

/** Centre-to-centre distance between touching tiles. */
const PITCH = COL

export interface TriadLight {
  id: string
  cx: string
  cy: string
  /** Reach, in viewBox units — a light dies about two tiles out. */
  r: string
  /** When this light starts blooming — the latest of its three tiles, plus
   *  the bloom's own head start. Nothing here can outrun its tiles. */
  delayMs: number
}

/** Shared vertices of every mutually-adjacent trio, de-duplicated. */
export const DECK_TRIADS: readonly TriadLight[] = (() => {
  const t = DECK_SILHOUETTE
  const touches = (a: SilhouetteTile, b: SilhouetteTile): boolean =>
    Math.hypot(a.cx - b.cx, a.cy - b.cy) < PITCH * 1.1
  const seen = new Set<string>()
  const out: TriadLight[] = []
  for (let i = 0; i < t.length; i++) {
    for (let j = i + 1; j < t.length; j++) {
      if (!touches(t[i], t[j])) continue
      for (let k = j + 1; k < t.length; k++) {
        if (!touches(t[i], t[k]) || !touches(t[j], t[k])) continue
        // The centroid of three mutually-touching centres IS the vertex
        // all three share.
        const cx = (t[i].cx + t[j].cx + t[k].cx) / 3
        const cy = (t[i].cy + t[j].cy + t[k].cy) / 3
        const key = `${cx.toFixed(1)}:${cy.toFixed(1)}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          id: `hc-triad-${out.length}`,
          cx: cx.toFixed(1),
          cy: cy.toFixed(1),
          r: (PITCH * 1.55).toFixed(1),
          delayMs: Math.max(t[i].delayMs, t[j].delayMs, t[k].delayMs) + LIGHT_BLOOM_MS,
        })
      }
    }
  }
  return out
})()
