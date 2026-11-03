// trait: a tile leaves places open; a child fills one, a choice fills another,
// and the third waits as a silhouette.
const { svg, cell, wire, drop, group, hex, text, LIT, CELL } = require('./pieces.cjs')

const Y = 270
const portrait = (x) => `<circle cx="${x}" cy="${Y - 14}" r="13" fill="var(--honey-tint)" stroke="var(--honey)" stroke-width="1.5"/>` +
  `<path d="M${x - 24},${Y + 26} C${x - 22},${Y + 6} ${x + 22},${Y + 6} ${x + 24},${Y + 26}" fill="var(--honey-tint)" stroke="var(--honey)" stroke-width="1.5"/>`
const tagline = (x) => `<path d="M${x - 28},${Y - 10} H${x + 28}" stroke="var(--honey-fill)" stroke-width="2.5"/><path d="M${x - 28},${Y + 4} H${x + 18} M${x - 28},${Y + 18} H${x + 24}" stroke="var(--line-strong)" stroke-width="2.5"/>`
const waiting = (x) => `<path d="M${x},${Y + 16} V${Y - 14} M${x - 10},${Y - 4} L${x},${Y - 14} L${x + 10},${Y - 4}" fill="none" stroke="var(--faint)" stroke-width="1.6"/><path d="M${x - 20},${Y + 4} V${Y + 22} H${x + 20} V${Y + 4}" fill="none" stroke="var(--faint)" stroke-width="1.6"/>`
const named = (x, word, sub, cls = 'k') => text(x, Y + 92, word, cls, 17) + text(x, Y + 112, sub, 'm f', 13)

module.exports = () => svg('A tile with three open traits: one filled by a child, one by a choice, one waiting as a silhouette', [
  wire('tile-portrait', drop(440, 128, 220, 206)),
  wire('tile-tagline', 'M480,146 V206'),
  wire('tile-contact', drop(520, 128, 740, 206), { dashed: true }),
  cell('tile', 480, 86, 60, 'card', { style: LIT, size: 21, sub: 'a creation' }),
  group('portrait', hex(220, Y, 62, CELL) + portrait(220) + named(220, 'portrait', 'a child fills it')),
  group('tagline', hex(480, Y, 62, CELL) + tagline(480) + named(480, 'tagline', 'your choice wins')),
  group('contact', hex(740, Y, 62, 'fill="none" stroke="var(--line-strong)" stroke-width="1.5" stroke-dasharray="5 6"') + waiting(740) + named(740, 'contact', 'waiting', 'k f')),
].join('\n'))
