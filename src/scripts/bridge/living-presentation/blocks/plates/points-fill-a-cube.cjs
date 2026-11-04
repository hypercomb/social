// fill: every tile is a point (a word, at a version, from an origin), and the
// points fill a cube. Only the points are drawn; the cube is what they make.
const { svg, marker, group, card, wire, curve, iso, text } = require('./pieces.cjs')

const N = 3
const p = iso(480, 214, 40)

const points = () => {
  const out = []
  for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) for (let z = 0; z <= N; z++) {
    const [px, py] = p(x, y, z)
    const near = (x + z + y) / (3 * N)
    out.push(`<circle cx="${px}" cy="${py}" r="4" fill="var(--honey-fill)" fill-opacity="${(0.35 + 0.65 * near).toFixed(2)}"/>`)
  }
  return out.join('')
}

module.exports = () => svg('Points for words, versions and origins filling a cube that is never drawn', [
  `<defs>${marker('fc-a')}</defs>`,
  wire('versions-cube', curve(488, 86, 672, 70), { arrow: 'fc-a' }),
  wire('words-cube', curve(592, 282, 694, 330), { arrow: 'fc-a' }),
  wire('origins-cube', curve(368, 282, 266, 330), { arrow: 'fc-a' }),
  group('cube', points() + text(480, 376, 'never drawn', 'm f', 13)),
  card('versions', 680, 40, 220, 64, 'versions', { sub: 'the signature' }),
  card('words', 700, 300, 200, 64, 'words', { sub: 'the layer' }),
  card('origins', 60, 300, 200, 64, 'origins', { sub: 'where from' }),
].join('\n'))
