// row: hypercomb's layer laid out as a row, the six values side by side, each
// holding the same four parts again.
const { svg, cell, wire, drop, ghost, hex, text, f1, LIT, CELL } = require('./pieces.cjs')

const VALUES = ['simple', 'organized', 'collaborative', 'intelligent', 'accessible', 'localized']
const xs = VALUES.map((_, i) => f1(480 + (i - 2.5) * 146))
const four = (x, y) => [[-12, -11], [12, -11], [-12, 11], [12, 11]].map(([dx, dy]) => hex(x + dx, y + dy, 9, CELL)).join('')

module.exports = () => svg('Hypercomb with its six values in a row beneath it, each holding the same four parts', [
  ghost(`M${xs[0]},364 H${xs[5]}`),
  text(480, 388, 'the word direction', 'm f', 13),
  ...xs.map((x, i) => wire(`top-v${i + 1}`, drop(480, 150, x, 198))),
  cell('top', 480, 90, 60, 'hypercomb', { style: LIT, size: 17 }),
  ...xs.map((x, i) => cell(`v${i + 1}`, x, 250, 50, '', { inner: four(x, 250), under: VALUES[i], underSize: 16 })),
].join('\n'))
