// trial: a change opens at its own trial address, on its own origin with no
// writes and no keys; promoting it is one pointer move.
const { svg, marker, cell, card, wire, text, LIT } = require('./pieces.cjs')

module.exports = () => svg('A change tried at its own trial address, then promoted to the live name by one pointer move', [
  `<defs>${marker('tr-a')}</defs>`,
  '<rect x="330" y="62" width="300" height="276" rx="3" fill="none" stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="5 6"/>',
  text(480, 90, 'its own origin', 'm f', 13),
  text(480, 322, 'no writes · no keys', 'm f', 13),
  wire('change-trial', 'M260,200 H398', { arrow: 'tr-a' }),
  wire('trial-live', 'M562,200 H694', { arrow: 'tr-a', label: [628, 186, 'promote'] }),
  card('change', 40, 160, 220, 80, 'a change', { sub: 'in your hive' }),
  cell('trial', 480, 200, 74, 'try-name', { style: LIT, cls: 'm k hy', size: 19, sub: 'its own address' }),
  card('live', 700, 160, 220, 80, 'the live name', { sub: 'one pointer move' }),
].join('\n'))
