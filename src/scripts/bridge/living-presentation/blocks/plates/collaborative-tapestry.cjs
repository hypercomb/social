// the tapestry — hives joined by the signatures they share. Four hives, the
// same comb each (you, ann and bo from the opening's spread, and cy). Where
// two hold the same piece, the same bytes carry the same signature (I1), so
// the same cell appears in both, lit, wearing the same name. That match is
// the thread: nobody stores a link; the names already agree. From your hive
// outward the threads join every hive to the next, one picture nobody owns.
// The labels are the first four hex of sha256 of the package words in the
// living-presentation plan (cards, theme, journal, chat, core) — short, real
// digests standing in for each piece's signature.
const { hex, CELL, LIT, GHOST, ghost, text, svg } = require('../../../../presentation/plates/lib.cjs')

const R = 28
const AT = [[0, 0], [1.732, 0], [0.866, -1.5], [-0.866, -1.5], [-1.732, 0], [-0.866, 1.5], [0.866, 1.5]]
const HIVES = {
  you: { x: 146, y: 198, name: 'your hive', lx: 146, ly: 312, anchor: 'middle' },
  ann: { x: 396, y: 118, name: 'ann', lx: 318, ly: 62, anchor: 'end' },
  bo: { x: 572, y: 270, name: 'bo', lx: 478, ly: 352, anchor: 'end' },
  cy: { x: 806, y: 168, name: 'cy', lx: 806, ly: 280, anchor: 'middle' },
}
const cell = (h, i) => [HIVES[h].x + AT[i][0] * R, HIVES[h].y + AT[i][1] * R]
// each thread: two hives, the cell each holds the shared piece in, and its name
const THREADS = [
  { id: 't1', a: ['you', 2], b: ['ann', 5], sig: '6ac9' },
  { id: 't2', a: ['ann', 6], b: ['bo', 3], sig: '3cb8' },
  { id: 't3', a: ['bo', 1], b: ['cy', 5], sig: '81dd' },
  { id: 't4', a: ['ann', 1], b: ['cy', 3], sig: '31e0' },
  { id: 't5', a: ['you', 6], b: ['bo', 4], sig: '0d45' },
]
const shared = new Map(THREADS.flatMap(t => [[`${t.a[0]}:${t.a[1]}`, t], [`${t.b[0]}:${t.b[1]}`, t]]))

const comb = (h) => {
  const { x, y, name, lx, ly, anchor } = HIVES[h]
  const left = Math.min(x - 2.6 * R, anchor === 'end' ? lx - 60 : lx - 60)
  const right = Math.max(x + 2.6 * R, anchor === 'end' ? lx : lx + 60)
  return `<g data-id="${h}"><rect x="${left}" y="${Math.min(y - 2.6 * R, ly - 24)}" width="${right - left}" height="${Math.max(y + 2.6 * R, ly + 8) - Math.min(y - 2.6 * R, ly - 24)}" fill="none" stroke="none"/>` +
    AT.map((_, i) => shared.has(`${h}:${i}`) ? '' : hex(...cell(h, i), R, CELL)).join('') +
    text(lx, ly, name, h === 'you' ? 'k hy' : 'k', 20, anchor) + `</g>`
}
const piece = (t) => {
  const [ax, ay] = cell(...t.a), [bx, by] = cell(...t.b)
  const one = (x, y) => hex(x, y, R, LIT) + text(x, y + 6, t.sig, 'm k', 16)
  const x0 = Math.min(ax, bx) - R, x1 = Math.max(ax, bx) + R
  return `<g data-id="s${t.id.slice(1)}"><rect x="${x0}" y="${Math.min(ay, by) - R}" width="${x1 - x0}" height="${Math.abs(ay - by) + 2 * R}" fill="none" stroke="none"/>${one(ax, ay)}${one(bx, by)}</g>`
}
const thread = (t) => {
  const [ax, ay] = cell(...t.a), [bx, by] = cell(...t.b)
  const d = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / d, uy = (by - ay) / d, k = R * 0.95
  return `<g data-id="${t.id}"><path d="M${(ax + ux * k).toFixed(1)},${(ay + uy * k).toFixed(1)} L${(bx - ux * k).toFixed(1)},${(by - uy * k).toFixed(1)}" stroke="var(--honey)" stroke-width="2"/></g>`
}

// the picture keeps going: hives further out, reached the same way
const FAR = [{ x: 640, y: 60, r: 13, from: ['ann', 2] }, { x: 896, y: 330, r: 14, from: ['cy', 6] }, { x: 62, y: 338, r: 13, from: ['you', 5] }]
const far = () => `<g data-id="more"><rect x="48" y="36" width="872" height="328" fill="none" stroke="none"/>` +
  FAR.map(({ x, y, r, from }) => {
    const [fx, fy] = cell(...from)
    const w = r * 1.732
    return ghost(`M${fx.toFixed(1)},${fy.toFixed(1)} L${x},${y}`) +
      [[0, 0], [w, 0], [-w, 0], [w / 2, r * 1.5], [-w / 2, r * 1.5], [w / 2, -r * 1.5], [-w / 2, -r * 1.5]].map(([dx, dy]) => hex(x + dx, y + dy, r - 1, GHOST)).join('')
  }).join('') + `</g>`

module.exports = () => svg('four hives, your hive, ann, bo and cy; wherever two hold the same piece by the same signature, the same lit cell appears in both and a thread joins them, weaving one picture nobody owns', [
  far(),
  ...THREADS.map(thread),
  ...Object.keys(HIVES).map(comb),
  ...THREADS.map(piece),
].join('\n'))
