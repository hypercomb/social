// move five — the same word from many hands: simple's column from move four
// (same place, same scale) with two more columns behind it, receding along the
// third direction. Each column is the word answered by another hand, keeps its
// own history and its own heart, and wears a tag naming its origin. One copy
// came through a chain: its thread runs back through ann's hive to bo's.
const { hex, LIT, CELL, marker, flow, ghost, text, svg } = require('../../../../presentation/plates/lib.cjs')

const R = 29, STEP = 64, BASE = 296
const DX = 150, DY = -54                    // one step back along the origins
const col = (k, n) => {
  const x = 130 + k * DX, b = BASE + k * DY
  return Array.from({ length: n }, (_, l) => hex(x, b - l * STEP, R, l === n - 1 ? LIT : CELL)).join('')
}
const tag = (id, k, label, w) => {
  const x = 130 + k * DX + 40, y = BASE + k * DY - 14
  return `<g data-id="${id}"><rect x="${x}" y="${y}" width="${w}" height="28" rx="14" fill="var(--bg)" stroke="var(--honey-deep)" stroke-width="1.5"/>` +
    text(x + w / 2, y + 19, label, 'm d', 16) + `</g>`
}
// a hive seen from afar: a small comb
const comb = (cx, cy) => {
  const r = 13, w = r * 1.732
  return [[0, 0], [w, 0], [-w, 0], [w / 2, r * 1.5], [-w / 2, r * 1.5], [w / 2, -r * 1.5], [-w / 2, -r * 1.5]]
    .map(([dx, dy]) => hex(cx + dx, cy + dy, r - 1.5, 'fill="var(--panel)" stroke="var(--steel)" stroke-width="1.3"')).join('')
}

module.exports = () => svg('the word simple answered by three columns, one behind another: yours, ann’s, and bo’s that came through ann; each wears a tag naming its origin, and a thread runs back to the hives it came from', [
  `<defs>${marker('os-ah')}</defs>`,
  // the third direction: the floor the columns stand on
  ghost(`M${130 - 40},${BASE + 15} L556,${BASE + 15 - (556 - 90) * 0.36}`),
  text(568, BASE + 21 - (556 - 90) * 0.36, 'origins', 'f', 18, 'start'),
  // back to front, so the nearer column stands in front
  `<g data-id="bo">${col(2, 2)}</g>`,
  `<g data-id="ann">${col(1, 3)}</g>`,
  `<g data-id="you">${col(0, 4)}</g>`,
  tag('tag-bo', 2, 'bo, via ann', 120),
  tag('tag-ann', 1, 'ann', 64),
  tag('tag-you', 0, 'you', 64),
  text(130, BASE + R + 30, 'simple', 'k', 18),
  // where the copies came from: other hives, and the chain back through them
  `<g data-id="hive-ann">${comb(720, 110)}</g>`,
  text(720, 166, 'ann’s hive', 'd', 18),
  `<g data-id="hive-bo">${comb(860, 262)}</g>`,
  text(860, 318, 'bo’s hive', 'd', 18),
  `<g data-id="thread">${flow(`M846,246 C812,196 770,150 734,124 C694,94 572,98 ${130 + 2 * DX + 38},${BASE + 2 * DY - STEP - 6}`, 'os-ah')}</g>`,
].join('\n'))
