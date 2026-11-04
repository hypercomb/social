// sharing: parts name only the words they need, never each other; a theme is a
// layer that answers the words.
const { svg, cell, card, wire, curve, text, LIT } = require('./pieces.cjs')

module.exports = () => svg('Two parts naming the words ink and accent, a theme answering them, and no part naming another', [
  '<path d="M160,144 V256" fill="none" stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="4 6"/>',
  '<path d="M152,192 L168,208 M168,192 L152,208" stroke="var(--steel)" stroke-width="1.8"/>',
  text(180, 205, 'never each other', 'm f', 13, 'start'),
  wire('card-ink', curve(260, 96, 426, 100)),
  wire('card-accent', curve(260, 112, 426, 292)),
  wire('menu-accent', curve(260, 300, 426, 300)),
  wire('theme-ink', curve(700, 186, 534, 100), { steel: true }),
  wire('theme-accent', curve(700, 214, 534, 300), { steel: true }),
  card('card', 60, 64, 200, 80, 'card', { sub: 'a part' }),
  card('menu', 60, 256, 200, 80, 'menu', { sub: 'a part' }),
  cell('ink', 480, 100, 54, 'ink', { size: 20, sub: 'a word', style: LIT }),
  cell('accent', 480, 300, 54, 'accent', { size: 18, sub: 'a word', style: LIT }),
  card('theme', 700, 160, 220, 80, 'a theme', { sub: 'answers the words' }),
].join('\n'))
