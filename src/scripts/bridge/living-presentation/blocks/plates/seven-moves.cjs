// opening: the seven moves in order, each drawn as what it adds: one hexagon,
// a row, rows under rows, a column of versions, many origins, points that fill
// a cube, and a cube inside a cube.
const { svg, marker, group, hex, text, iso, f1, LIT, CELL, STEEL, GHOST } = require('./pieces.cjs')

const Y = 196
const xs = [0, 1, 2, 3, 4, 5, 6].map(i => f1(80 + i * 133.3))
const twig = (x1, y1, x2, y2) => `<path d="M${x1},${y1} L${x2},${y2}" stroke="var(--honey-deep)" stroke-width="1.2"/>`

const glyphs = [
  // 1 one hexagon
  (x) => hex(x, Y, 40, LIT),
  // 2 a row under one word
  (x) => [-30, 0, 30].map(d => twig(x, Y - 22, x + d, Y + 6)).join('') + hex(x, Y - 30, 14, LIT) + [-30, 0, 30].map(d => hex(x + d, Y + 18, 14, CELL)).join(''),
  // 3 rows under rows
  (x) => hex(x, Y - 40, 11, LIT) + [-26, 0, 26].map(d => twig(x, Y - 32, x + d, Y - 14) + hex(x + d, Y - 8, 11, CELL)).join('') +
    [0, 1, 2, 3, 4, 5].map(i => hex(x - 36 + i * 14.4, Y + 26, 7, CELL)).join(''),
  // 4 versions in a column, the newest on top
  (x) => [3, 2, 1, 0].map(i => `<rect x="${x - 34}" y="${Y + 26 - i * 19}" width="68" height="13" rx="2" fill="${i === 3 ? 'var(--honey-tint)' : 'var(--panel)'}" stroke="${i === 3 ? 'var(--honey)' : 'var(--line-strong)'}" stroke-width="1.4"/>`).join(''),
  // 5 one word from many hands
  (x) => [-30, 0, 30].map(d => twig(x, Y - 18, x + d, Y + 6)).join('') + hex(x, Y - 26, 14, LIT) +
    hex(x - 30, Y + 18, 13, CELL) + hex(x, Y + 18, 13, STEEL) + hex(x + 30, Y + 18, 13, GHOST),
  // 6 points that fill a cube nobody drew
  (x) => { const p = iso(x, Y, 15), out = []; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) { const [px, py] = p(a, b, c); out.push(`<circle cx="${px}" cy="${py}" r="2.8" fill="var(--honey-fill)"/>`) } return out.join('') },
  // 7 a cube inside a cube
  (x) => `<rect x="${x - 36}" y="${Y - 36}" width="72" height="72" fill="none" stroke="var(--honey)" stroke-width="1.5"/><rect x="${x - 16}" y="${Y - 16}" width="32" height="32" fill="none" stroke="var(--honey-deep)" stroke-width="1.5"/>` +
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => `<path d="M${x + a * 36},${Y + b * 36} L${x + a * 16},${Y + b * 16}" stroke="var(--honey-deep)" stroke-width="1.2"/>`).join(''),
]
const NAMES = ['hexagon', 'row', 'stack', 'column', 'spread', 'fill', 'tesseract']

module.exports = () => svg('The seven moves of the opening, from one hexagon to a cube inside a cube', [
  `<defs>${marker('sv-a')}</defs>`,
  ...xs.slice(1).map((x, i) => group(`m${i + 1}-m${i + 2}`, `<path d="M${f1(xs[i] + 50)},${Y} H${f1(x - 54)}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5" marker-end="url(#sv-a)"/>`)),
  ...xs.map((x, i) => group(`m${i + 1}`, text(x, 100, String(i + 1).padStart(2, '0'), 'm f', 13) + glyphs[i](x) + text(x, 298, NAMES[i], 'k', 17))),
].join('\n'))
