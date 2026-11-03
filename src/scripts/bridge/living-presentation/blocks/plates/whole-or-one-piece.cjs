// participant: three participants, each serving their own domain; you take a
// creation whole, or just one piece of it.
const { svg, marker, cell, card, wire, drop } = require('./pieces.cjs')

const PEOPLE = [['ann', 200], ['bo', 480], ['cy', 760]]

module.exports = () => svg('Three participants on their own domains; a creation taken whole, and one piece taken on its own', [
  `<defs>${marker('wp-a')}</defs>`,
  wire('ann-whole', drop(200, 156, 250, 270), { arrow: 'wp-a' }),
  wire('bo-piece', drop(480, 156, 660, 270), { arrow: 'wp-a' }),
  wire('cy-piece', drop(760, 156, 760, 270), { arrow: 'wp-a', dashed: true }),
  ...PEOPLE.map(([id, x]) => cell(id, x, 96, 58, id, { size: 21, sub: 'own domain' })),
  card('whole', 100, 276, 300, 76, 'take it whole', { sub: 'it runs as its publisher made it' }),
  card('piece', 560, 276, 300, 76, 'take one piece', { sub: 'use it in your own' }),
].join('\n'))
