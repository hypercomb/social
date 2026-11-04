// localized: the community's catalogs fill in only the words a hive is
// missing, and your language is one more direction you choose.
const { svg, marker, group, cell, card, wire, curve, hex, text, LIT, CELL } = require('./pieces.cjs')

const CATALOGS = [['ja', 'from a translator’s host'], ['es', 'from another host'], ['fr', 'from your own']]
const SPOKEN = ['English', '日本語', 'Español']

module.exports = () => svg('Translators\' catalogs filling in a hive\'s missing words, and the locale chosen as one more direction', [
  `<defs>${marker('lh-a')}</defs>`,
  group('translating', text(155, 48, 'the community', 'm f', 13) +
    CATALOGS.map(([locale, sub], i) => card(null, 40, 66 + i * 96, 230, 72, `i18n:${locale}`, { cls: 'm k', size: 18, sub })).join('')),
  wire('localized-translating', curve(270, 200, 402, 200), { arrow: 'lh-a', label: [336, 226, 'missing words'] }),
  cell('localized', 480, 200, 72, 'your hive', { style: LIT, size: 19, sub: 'localized' }),
  wire('localized-locale', 'M556,200 H690', { arrow: 'lh-a', label: [623, 186, 'you choose'] }),
  group('locale', hex(790, 200, 74, CELL) + SPOKEN.map((s, i) => text(790, 178 + i * 24, s, i ? 'd' : 'k hy', 16)).join('') +
    text(790, 304, 'locale', 'k', 17) + text(790, 324, 'one more direction', 'm f', 13)),
].join('\n'))
