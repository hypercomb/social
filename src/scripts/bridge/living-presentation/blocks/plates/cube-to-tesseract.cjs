// tesseract: traits are more directions, exactly as origin is; three of them
// draw a cube, and a fourth makes a cube inside a cube.
const { svg, marker, group, card, wire, curve, iso, cubeEdges, text } = require('./pieces.cjs')

const TRAITS = ['locale', 'platform', 'audience', 'reviews']
const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]]
const centred = (cx, cy, s) => { const p = iso(cx, cy, s); return (x, y, z) => p(x - 0.5, y - 0.5, z - 0.5) }

const tesseract = (cx, cy) => {
  const outer = centred(cx, cy, 104), inner = centred(cx, cy, 46)
  return cubeEdges(outer, 1, 'stroke="var(--honey)" stroke-width="1.5"') +
    cubeEdges(inner, 1, 'stroke="var(--honey-deep)" stroke-width="1.5"') +
    CORNERS.map(v => { const [x1, y1] = outer(...v), [x2, y2] = inner(...v); return `<path d="M${x1},${y1} L${x2},${y2}" stroke="var(--honey-deep)" stroke-width="1" stroke-opacity=".7"/>` }).join('')
}

module.exports = () => svg('Four traits as directions: three draw a cube, and a fourth makes it a tesseract', [
  `<defs>${marker('ct-a')}</defs>`,
  ...TRAITS.map((t, i) => wire(`${t}-cube`, curve(210, 67 + i * 88, 318, 200), { arrow: 'ct-a' })),
  ...TRAITS.map((t, i) => card(t, 40, 40 + i * 88, 170, 54, t, { size: 17 })),
  group('cube', cubeEdges(centred(400, 192, 58), 1, 'stroke="var(--honey)" stroke-width="1.6"') + text(400, 290, 'cube', 'k', 18) + text(400, 310, 'three traits', 'm f', 13)),
  wire('cube-tess', 'M470,192 H596', { arrow: 'ct-a', label: [533, 178, 'a fourth'] }),
  group('tess', tesseract(730, 192) + text(730, 340, 'tesseract', 'k', 18) + text(730, 360, 'a cube inside a cube', 'm f', 13)),
].join('\n'))
