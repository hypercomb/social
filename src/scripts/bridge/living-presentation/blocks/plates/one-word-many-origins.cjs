// spread: one word answered by tiles from different hands; an origin is a mark
// the tile wears, and a chain of origins is a thread.
const { svg, cell, card, wire, drop, hex, LIT, CELL, STEEL } = require('./pieces.cjs')

const CHAINED = 'fill="none" stroke="var(--honey-deep)" stroke-width="1.5" stroke-dasharray="3 4"'

const HANDS = [['mine', 60, 'yours', 'origin: you', CELL], ['ann', 370, 'from ann', 'origin: ann', STEEL], ['bo', 680, 'from bo', 'origin: bo, via ann', CHAINED]]

module.exports = () => svg('One word answered by tiles from three origins, one of them a chain of copies', [
  wire('word-mine', drop(440, 118, 170, 176)),
  wire('word-ann', 'M480,134 V176'),
  wire('word-bo', drop(520, 118, 790, 176)),
  wire('ann-thread', drop(480, 246, 600, 304), { dashed: true }),
  wire('bo-thread', drop(790, 246, 740, 304), { dashed: true }),
  cell('word', 480, 78, 56, 'simple', { style: LIT, size: 20, sub: 'one word' }),
  ...HANDS.map(([id, x, label, sub, mark]) => card(id, x, 176, 220, 70, '', {
    inner: hex(x + 30, 211, 11, mark) + `<text class="k" x="${x + 52}" y="208" font-size="19">${label}</text><text class="m f" x="${x + 52}" y="228" font-size="13">${sub}</text>`,
  })),
  card('thread', 520, 304, 300, 64, 'bo → ann → you', { cls: 'm k', size: 17, sub: 'a thread through other hives' }),
].join('\n'))
