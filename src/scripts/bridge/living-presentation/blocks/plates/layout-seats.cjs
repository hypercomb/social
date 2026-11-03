// layout: a list of words seats the children it names, in order; a child it
// does not name is left out, untouched, never deleted.
const { svg, cell, card, wire, drop, group, hex, text } = require('./pieces.cjs')

const SEATS = [['a', 160, 'primitive', 16], ['b', 360, 'act', 19], ['c', 560, 'opening', 17]]

module.exports = () => svg('A layout naming three children in order, and a fourth child left out', [
  ...SEATS.map(([id, x], i) => wire(`layout-${id}`, drop(400 + i * 80, 100, x, 206))),
  card('layout', 290, 28, 380, 72, 'primitive · act · opening', { cls: 'm k', size: 18, sub: 'the layout: a list of words', lit: true }),
  ...SEATS.map(([id, x, word, size], i) => cell(id, x, 262, 56, word, { size, under: `seat ${i}`, underCls: 'm f', underSize: 13 })),
  group('x', hex(800, 262, 56, 'fill="none" stroke="var(--line-strong)" stroke-width="1.5" stroke-dasharray="5 6"') +
    text(800, 268, 'extra', 'k f', 18) + text(800, 344, 'left out, untouched', 'm f', 13)),
].join('\n'))
