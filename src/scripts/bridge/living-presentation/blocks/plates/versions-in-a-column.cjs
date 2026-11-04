// column: one tile's versions stacked into a column, the newest on top; the
// top of the column is the heart.
const { svg, marker, cell, card, wire, curve, text, LIT } = require('./pieces.cjs')

const VERSIONS = [['v0', 290, '00000000', 'first'], ['v1', 210, '00000001', ''], ['v2', 130, '00000002', 'newest']]

module.exports = () => svg('One tile\'s versions stacked into a column, the newest on top and the heart beside it', [
  `<defs>${marker('vc-a')}</defs>`,
  card(null, 390, 50, 240, 58, 'the next change', { cls: 'm f', size: 15, dashed: true, fill: 'none' }),
  ...VERSIONS.map(([id, y]) => wire(`tile-${id}`, curve(198, 214, 384, y + 29), { arrow: 'vc-a' })),
  cell('tile', 140, 214, 64, 'primitive', { size: 18 }),
  ...VERSIONS.map(([id, y, label, sub]) => card(id, 390, y, 240, 58, label, { cls: id === 'v2' ? 'm k hy' : 'm d', size: 19, sub: sub || undefined, lit: id === 'v2' })),
  wire('v2-heart', 'M630,159 H718', { arrow: 'vc-a' }),
  cell('heart', 790, 159, 66, 'heart', { style: LIT, size: 22 }),
  text(790, 256, 'what answers now:', 'k', 16),
  text(790, 280, 'a read lands here,', 'm f', 13),
  text(790, 300, 'a publish points here', 'm f', 13),
].join('\n'))
