// move seven — meta and marks add directions; a fourth makes a tesseract.
// The cube of move six stays exactly where it was (its geometry is read from
// that plate). One point opens its meta layer: a card of words, each a mark
// that could divide the points. Three are drawn as the cube's directions; a
// fourth adds a second cube inside the first, every point joined to its twin.
// The eight corner joins are drawn strong, the rest faint, so the shape reads
// before the lines do.
const { hex, LIT, CELL, check, text, svg } = require('../../../../presentation/plates/lib.cjs')
const { X0, Y0, SW, R, RS, P, HEIGHT, NEAR, FRAME, EDGES } = require('./simple-opening-fill.cjs').cube

const S = 0.42                              // the inner cube, scaled about the centre
const [CX, CY] = P(2.5, 1.5, 1)
const IN = ([x, y]) => [CX + (x - CX) * S, CY + (y - CY) * S]
const f = n => n.toFixed(1)
const box = (pts, attrs) => EDGES.map(([a, b]) => `<path d="M${f(pts[a][0])},${f(pts[a][1])} L${f(pts[b][0])},${f(pts[b][1])}" ${attrs}/>`).join('')

// the meta card: the words one point carries, three of them drawn as directions
const CARD = { x: 28, y: 44, w: 160, row: 42 }
const ROWS = ['word', 'version', 'origin', 'locale', 'platform', 'audience']
const rowY = i => CARD.y + 76 + i * CARD.row
const CARD_H = 76 + ROWS.length * CARD.row - 12

module.exports = () => {
  const outer = [], inner = [], joins = []
  for (let o = 2; o >= 0; o--) for (let w = 0; w < 6; w++) for (let v = 0; v < HEIGHT[o][w]; v++) {
    const p = P(w, v, o), q = IN(p)
    if (!(o === 0 && w === 0 && v === 0)) outer.push(hex(p[0], p[1], RS[o], `${CELL} stroke-opacity="${NEAR[o]}"`))
    inner.push(hex(q[0], q[1], 4.5, `fill="var(--honey-fill)" fill-opacity=".4" stroke="var(--honey)" stroke-width="1" stroke-opacity="${NEAR[o]}"`))
    joins.push(`M${f(p[0])},${f(p[1])} L${f(q[0])},${f(q[1])}`)
  }
  const [sx, sy] = P(0, 0, 0)
  const row = (i, cls) => text(CARD.x + 20, rowY(i) + 6, ROWS[i], cls, 18, 'start')
  return svg('the cube from move six, one point opened to a card of its words; three are drawn as directions, and a fourth adds a smaller cube inside, each point joined to its twin: a tesseract', [
    // the cube, as move six left it
    `<g data-id="outer">${box(FRAME, 'fill="none" stroke="var(--honey-deep)" stroke-opacity=".7" stroke-width="1" stroke-dasharray="4 6"')}${outer.join('')}</g>`,
    // the fourth direction: every point joined to its twin inside
    `<g data-id="joins"><path d="${joins.join(' ')}" fill="none" stroke="var(--steel)" stroke-width="1" stroke-opacity=".28"/>` +
      FRAME.map(p => { const q = IN(p); return `<path d="M${f(p[0])},${f(p[1])} L${f(q[0])},${f(q[1])}" stroke="var(--steel)" stroke-width="1.6"/>` }).join('') + `</g>`,
    `<g data-id="inner">${box(FRAME.map(IN), 'fill="none" stroke="var(--honey)" stroke-width="1.6"')}${inner.join('')}</g>`,
    // one point opens its meta layer
    `<g data-id="point">${hex(sx, sy, R + 3, LIT)}<path d="M${sx - R - 6},${sy} C${sx - 40},${sy} ${CARD.x + CARD.w + 26},${CARD.y + 30} ${CARD.x + CARD.w + 4},${CARD.y + 30}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5" stroke-dasharray="4 6"/></g>`,
    `<g data-id="card"><rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${CARD_H}" rx="3" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
      text(CARD.x + 20, CARD.y + 36, 'META', 'm hy', 16, 'start', 'letter-spacing="3"') +
      `<path d="M${CARD.x + 14},${CARD.y + 52} H${CARD.x + CARD.w - 14}" stroke="var(--line)" stroke-width="1"/></g>`,
    `<g data-id="three">${[0, 1, 2].map(i => row(i, 'k') + check(CARD.x + CARD.w - 24, rowY(i))).join('')}</g>`,
    `<g data-id="fourth"><rect x="${CARD.x + 8}" y="${rowY(3) - 18}" width="${CARD.w - 16}" height="36" rx="2" fill="var(--honey-tint)" stroke="none"/>${row(3, 'k hy')}${hex(CARD.x + CARD.w - 24, rowY(3), 8, LIT)}</g>`,
    `<g data-id="traits">${[4, 5].map(i => row(i, 'd')).join('')}</g>`,
    text(X0 + 2.5 * SW, Y0 + R + 36, 'words', 'f', 18),
    text(FRAME[5][0] + 16, FRAME[5][1] + 6, 'origins', 'f', 18, 'start'),
  ].join('\n'))
}
