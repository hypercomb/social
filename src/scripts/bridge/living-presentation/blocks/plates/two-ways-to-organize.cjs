// organization: the same pieces read by a layout of words and by a saved
// question at once; neither owns a piece, and nothing moves.
const { svg, cell, card, wire, drop, glyph, note, text } = require('./pieces.cjs')

const PIECES = [['p1', 130, 'photo', (x) => glyph('resource', x, 92, 40)], ['p2', 390, 'slide', (x) => glyph('content', x, 92, 40)], ['p3', 650, 'note', (x) => note(x - 26, 72, 52, 40)]]

module.exports = () => svg('Three pieces, organized by a website and by a saved question at the same time', [
  wire('site-p1', drop(270, 232, 220, 152)),
  wire('site-p2', drop(330, 232, 480, 152)),
  wire('ask-p2', drop(630, 232, 480, 152), { steel: true }),
  wire('ask-p3', drop(690, 232, 740, 152), { steel: true }),
  ...PIECES.map(([id, x, word, draw]) => card(id, x, 40, 180, 112, '', { inner: draw(x + 90) + text(x + 90, 138, word, 'k', 17) })),
  cell('site', 300, 290, 58, 'a website', { size: 17, under: 'a layout of words', underCls: 'm f', underSize: 13 }),
  cell('ask', 660, 290, 58, 'a question', { size: 17, under: 'and · or · not', underCls: 'm f', underSize: 13, style: 'fill="var(--panel)" stroke="var(--steel)" stroke-width="1.5"' }),
].join('\n'))
