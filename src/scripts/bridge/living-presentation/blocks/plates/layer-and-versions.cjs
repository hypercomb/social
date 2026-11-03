// layer: one name and its children in order, and the layer's versions kept in
// a column beside it, the newest one the heart.
const { svg, cell, card, wire, drop, group, ghost, text, LIT } = require('./pieces.cjs')

module.exports = () => svg('A layer: a name and its three children in order, kept in versions with the newest as the heart', [
  cell('name', 300, 96, 62, 'simple', { sub: 'a name', style: LIT, size: 20 }),
  wire('name-c1', drop(262, 140, 140, 232)),
  wire('name-c2', 'M300,158 V232'),
  wire('name-c3', drop(338, 140, 460, 232)),
  cell('c1', 140, 284, 56, 'primitive', { size: 16, under: '1', underCls: 'm f', underSize: 13 }),
  cell('c2', 300, 284, 56, 'act', { under: '2', underCls: 'm f', underSize: 13 }),
  cell('c3', 460, 284, 56, 'opening', { size: 16, under: '3', underCls: 'm f', underSize: 13 }),
  ghost('M362,96 C480,96 520,144 604,144'),
  group('v', [
    text(760, 56, 'its versions', 'm f', 13),
    card(null, 610, 268, 300, 56, '00000000', { cls: 'm d', size: 18 }),
    card(null, 610, 192, 300, 56, '00000001', { cls: 'm d', size: 18 }),
    card(null, 610, 116, 300, 56, '00000002', { cls: 'm k hy', size: 18, sub: 'the heart', lit: true }),
  ].join('')),
].join('\n'))
