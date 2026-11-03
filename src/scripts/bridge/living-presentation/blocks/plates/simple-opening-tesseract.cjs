// move seven — meta and traits add directions; a fourth makes a tesseract.
// The cube of move six stays exactly where it was (its geometry is read from
// that plate). One point opens its meta layer: a card of words, each a trait
// that could divide the points. Three are drawn as the cube's directions; a
// fourth adds a second cube inside the first, every point joined to its twin.
const { hex, LIT, CELL, GHOST, check, text, svg } = require('../../../../presentation/plates/lib.cjs')
const { X0, Y0, SW, SV, DX, DY, R, P, HEIGHT, NEAR } = require('./simple-opening-fill.cjs').cube

const S = 0.44                              // the inner cube, scaled about the centre
const [CX, CY] = P(2.5, 1.5, 1)
const IN = ([x, y]) => [CX + (x - CX) * S, CY + (y - CY) * S]

// the eight corners of the cube's frame (padded), outer and inner
const PAD = R + 10
const FRAME = [[0, 0, 0], [5, 0, 0], [5, 3, 0], [0, 3, 0], [0, 0, 2], [5, 0, 2], [5, 3, 2], [0, 3, 2]]
  .map(([w, v, o]) => { const [x, y] = P(w, v, o); return [x + (w ? PAD : -PAD), y + (v ? -PAD : PAD)] })
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
const box = (pts, attrs) => EDGES.map(([a, b]) => `<path d="M${pts[a][0].toFixed(1)},${pts[a][1].toFixed(1)} L${pts[b][0].toFixed(1)},${pts[b][1].toFixed(1)}" ${attrs}/>`).join('')

// the meta card: the words one point carries, three of them drawn as directions
const CARD = { x: 32, y: 52, w: 176, row: 40 }
const ROWS = ['word', 'version', 'origin', 'locale', 'platform', 'audience']
const rowY = i => CARD.y + 74 + i * CARD.row

module.exports = () => {
  const outer = [], inner = [], joins = []
  for (let o = 2; o >= 0; o--) for (let w = 0; w < 6; w++) for (let v = 0; v < 4; v++) {
    const p = P(w, v, o), q = IN(p)
    const filled = v < HEIGHT[o][w]
    outer.push(hex(p[0], p[1], R, filled ? `${CELL} stroke-opacity="${NEAR[o]}"` : GHOST))
    if (!filled) continue
    inner.push(hex(q[0], q[1], 4.5, `fill="var(--honey-fill)" fill-opacity=".35" stroke="var(--honey)" stroke-width="1" stroke-opacity="${NEAR[o]}"`))
    joins.push(`M${p[0].toFixed(1)},${p[1].toFixed(1)} L${q[0].toFixed(1)},${q[1].toFixed(1)}`)
  }
  const [sx, sy] = P(0, 0, 0)
  const row = (i, cls) => text(CARD.x + 22, rowY(i) + 6, ROWS[i], cls, 18, 'start')
  return svg('the cube from move six, one point opened to a card of traits; three traits are drawn as directions, and a fourth adds a smaller cube inside, each point joined to its twin: a tesseract', [
    // the cube, as move six left it
    `<g data-id="outer">${box(FRAME, 'fill="none" stroke="var(--honey-deep)" stroke-opacity=".6" stroke-width="1" stroke-dasharray="4 6"')}${outer.join('')}</g>`,
    // the fourth direction: every point joined to its twin inside
    `<g data-id="joins"><path d="${joins.join(' ')}" fill="none" stroke="var(--steel)" stroke-width="1" stroke-opacity=".4"/>` +
      FRAME.map((p, i) => { const q = IN(p); return `<path d="M${p[0].toFixed(1)},${p[1].toFixed(1)} L${q[0].toFixed(1)},${q[1].toFixed(1)}" stroke="var(--steel)" stroke-width="1.5"/>` }).join('') + `</g>`,
    `<g data-id="inner">${box(FRAME.map(IN), 'fill="none" stroke="var(--honey)" stroke-width="1.5"')}${inner.join('')}</g>`,
    // one point opens its meta layer
    `<g data-id="point">${hex(sx, sy, R + 3, LIT)}<path d="${`M${sx - R - 6},${sy} C${sx - 50},${sy} ${CARD.x + CARD.w + 30},${CARD.y + 30} ${CARD.x + CARD.w + 4},${CARD.y + 30}`}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5" stroke-dasharray="4 6"/></g>`,
    `<g data-id="card"><rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${74 + ROWS.length * CARD.row - 10}" rx="3" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
      text(CARD.x + 22, CARD.y + 34, 'META', 'm hy', 16, 'start', 'letter-spacing="3"') +
      `<path d="M${CARD.x + 16},${CARD.y + 50} H${CARD.x + CARD.w - 16}" stroke="var(--line)" stroke-width="1"/></g>`,
    `<g data-id="three">${[0, 1, 2].map(i => row(i, 'k') + check(CARD.x + CARD.w - 26, rowY(i))).join('')}</g>`,
    `<g data-id="fourth"><rect x="${CARD.x + 8}" y="${rowY(3) - 17}" width="${CARD.w - 16}" height="34" rx="2" fill="var(--honey-tint)" stroke="none"/>${row(3, 'k hy')}${hex(CARD.x + CARD.w - 26, rowY(3), 8, LIT)}</g>`,
    `<g data-id="traits">${[4, 5].map(i => row(i, 'd')).join('')}</g>`,
    text(X0 + 2.5 * SW, Y0 + R + 34, 'words', 'f', 18),
    text(X0 + 5 * SW + 2 * DX + R + 26, Y0 + 2 * DY + 6, 'origins', 'f', 18, 'start'),
  ].join('\n'))
}
