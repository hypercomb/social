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
}

export const DECK_SILHOUETTE: readonly SilhouetteTile[] = DECK.flatMap((row, r) =>
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
        })
      }
    }
  }
  return out
})()
