// hexagon: hypercomb alone, opening into its four parts. Nothing else is ever
// introduced.
const { svg, cell, wire, between, glyph, LIT } = require('./pieces.cjs')

const C = [480, 200, 74]
const PARTS = [
  ['word', 210, 92, 'its name', 'content'],
  ['signature', 750, 92, 'its bytes', 'format'],
  ['layer', 210, 308, 'its children', 'layers'],
  ['meta', 750, 308, 'its meaning', 'resource'],
]

module.exports = () => svg('One hexagon named hypercomb, opening into word, signature, layer and meta', [
  ...PARTS.map(([id, x, y]) => wire(`hypercomb-${id}`, between(C[0], C[1], C[2] * 0.95, x, y, 56))),
  cell('hypercomb', ...C, 'hypercomb', { style: LIT, size: 21 }),
  ...PARTS.map(([id, x, y, sub, icon]) => cell(id, x, y, 60, '', { inner: glyph(icon, x, y - 18, 24) + `<text class="k" x="${x}" y="${y + 12}" font-size="18" text-anchor="middle">${id}</text><text class="m f" x="${x}" y="${y + 32}" font-size="12" text-anchor="middle">${sub}</text>` })),
].join('\n'))
