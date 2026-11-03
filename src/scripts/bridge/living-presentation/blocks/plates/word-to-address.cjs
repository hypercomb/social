// word: a word typed two ways folds to one key, and the key is signed into one
// address. The address shown is the real one, made the way the hive makes it.
const { svg, marker, card, wire, curve, sigOf } = require('./pieces.cjs')

module.exports = () => svg('A word typed two ways folds to one key, which is signed into one address', [
  `<defs>${marker('wd-a')}</defs>`,
  card('typed', 40, 70, 220, 84, 'My Tile', { cls: 'm k', size: 22, sub: 'typed' }),
  card('others', 40, 246, 220, 84, 'my tile!', { cls: 'm k', size: 22, sub: 'typed elsewhere' }),
  wire('typed-key', curve(260, 112, 368, 190), { arrow: 'wd-a' }),
  wire('others-key', curve(260, 288, 368, 210), { arrow: 'wd-a' }),
  card('key', 374, 158, 220, 84, 'my-tile', { cls: 'm k', size: 22, sub: 'folded' }),
  wire('key-address', 'M594,200 H664', { arrow: 'wd-a', label: [628, 186, 'sign'] }),
  card('address', 670, 158, 250, 84, sigOf('my-tile'), { cls: 'm k hy', size: 22, sub: 'its address', lit: true }),
].join('\n'))
