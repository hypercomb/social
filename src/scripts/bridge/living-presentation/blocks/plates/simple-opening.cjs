// the opening — the seven moves as one strip, each frame a miniature of its
// move's plate, so the hexagon is seen growing: one hexagon over an empty
// layer; the layer filled as a row; the row tilted into a stack of planes;
// versions rising into columns; columns from other hands behind; the points
// filling a cube no one drew; a cube inside a cube. Under each frame, the part
// of the primitive that move takes its direction from: the word, the layer
// (twice), the signature, the origin it wears, nothing new for the cube, and
// its meta, whatever that says. The frame and its part light together.
const { f1, hex, LIT, text, svg } = require('../../../../presentation/plates/lib.cjs')

const W = 112, GAP = 16, TOP = 56, H = 252
const CX = i => 40 + i * (W + GAP) + W / 2
const SMALL = 'fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.2"'
const LINE = 'fill="none" stroke="var(--line-strong)" stroke-width="1.2"'
const flat = (cx, cy, r, a) => `<polygon points="${[[0, -1], [0.866, -0.5], [0.866, 0.5], [0, 1], [-0.866, 0.5], [-0.866, -0.5]]
  .map(([x, y]) => `${f1(cx + x * r)},${f1(cy + y * r * 0.42)}`).join(' ')}" ${a}/>`
const column = (x, base, n, r = 7, step = 15) => Array.from({ length: n }, (_, l) => hex(x, base - l * step, r, l === n - 1 ? LIT : SMALL)).join('')
const cube = (x, y, s, d, a = 'fill="none" stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="3 4"') =>
  `<path d="M${x},${y} h${s} v${s} h${-s} Z M${x + d},${y - d * 0.7} h${s} v${s} h${-s} Z M${x},${y} l${d},${-d * 0.7} M${x + s},${y} l${d},${-d * 0.7} M${x + s},${y + s} l${d},${-d * 0.7} M${x},${y + s} l${d},${-d * 0.7}" ${a}/>`

// what each move takes from the primitive (frame six adds nothing)
const PARTS = ['word', 'layer', 'layer', 'signature', 'origin', 'nothing new', 'meta']

const MOVES = [
  ['hexagon', cx => hex(cx, 168, 30, LIT) +
    `<rect x="${cx - 42}" y="222" width="84" height="34" rx="3" fill="none" stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="4 5"/>` +
    `<path d="M${cx},198 V222" ${LINE}/>`],
  ['row', cx => hex(cx, 150, 22, LIT) + `<path d="M${cx},172 V214" ${LINE}/>` +
    `<rect x="${cx - 46}" y="214" width="92" height="42" rx="3" ${LINE}/>` +
    [0, 1, 2, 3, 4, 5].map(k => hex(cx - 35 + k * 14, 235, 6, SMALL)).join('')],
  ['stack', cx => hex(cx, 128, 18, LIT) + `<path d="M${cx},146 V168" ${LINE}/>` +
    [168, 202, 236].map((y, j) => `<path d="M${cx - 48},${y + 18} H${cx + 36} L${cx + 48},${y} H${cx - 36} Z" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
      Array.from({ length: [4, 6, 8][j] }, (_, k) => flat(cx - 30 + k * (60 / ([4, 6, 8][j] - 1)), y + 9, [9, 6, 5][j], k === 0 ? LIT : SMALL)).join('')).join('')],
  ['column', cx => [[-33, 4], [-11, 2], [11, 3], [33, 1]].map(([dx, n]) => column(cx + dx, 246, n)).join('')],
  ['spread', cx => column(cx + 22, 222, 2) + column(cx, 234, 3) + column(cx - 22, 246, 4)],
  ['fill', cx => cube(cx - 34, 182, 54, 24) +
    [0, 1, 2].flatMap(a => [0, 1, 2].map(b => hex(cx - 34 + a * 27, 182 + b * 27, 4, a === 0 && b === 2 ? LIT : SMALL))).join('') +
    [0, 1, 2].flatMap(a => [0, 1, 2].map(b => hex(cx - 10 + a * 27, 165 + b * 27, 3.5, SMALL))).join('')],
  ['tesseract', cx => cube(cx - 38, 180, 60, 26) + cube(cx - 20, 198, 24, 10, 'fill="none" stroke="var(--honey)" stroke-width="1.2"') +
    `<path d="M${cx - 38},180 L${cx - 20},198 M${cx + 22},180 L${cx + 4},198 M${cx + 22},240 L${cx + 4},222 M${cx - 38},240 L${cx - 20},222" fill="none" stroke="var(--honey-deep)" stroke-width="1"/>`],
]

module.exports = () => svg('seven frames in a row, each over the part of the primitive it comes from: one hexagon, its word; a row and a stack of planes, its layer; columns of versions, its signature; columns from other hands, their origin; points filling a cube, nothing new; a cube inside a cube, its meta', [
  MOVES.map(([name, draw], i) => {
    const cx = CX(i), x = cx - W / 2
    return `<g data-id="m${i + 1}"><rect x="${x}" y="${TOP}" width="${W}" height="${H}" rx="3" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
      text(x + 12, TOP + 24, String(i + 1), 'm f', 16, 'start') + draw(cx) + text(cx, TOP + H - 18, name, 'k', 18) +
      `<path d="M${x + 14},${TOP + H + 14} H${x + W - 14}" stroke="${i === 5 ? 'var(--line)' : 'var(--honey-deep)'}" stroke-width="1.5"/>` +
      text(cx, TOP + H + 42, PARTS[i], i === 5 ? 'f' : 'hy', 18) + `</g>`
  }).join('\n'),
].join('\n'))
