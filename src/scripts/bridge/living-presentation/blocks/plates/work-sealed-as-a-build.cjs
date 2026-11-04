// build: a pass of many small changes sealed as one named build, which can be
// made live again later as a new step.
const { svg, marker, group, cell, card, wire, curve, note, text, LIT } = require('./pieces.cjs')

const NOTES = [[48, 104], [138, 92], [92, 160], [182, 168], [56, 226], [146, 238]]

module.exports = () => svg('Many small changes sealed as one named build, which can be made live again', [
  `<defs>${marker('bs-a')}</defs>`,
  group('work', NOTES.map(([x, y]) => note(x, y, 74, 54)).join('') + text(150, 330, 'a pass of work', 'k', 18) + text(150, 350, 'many small changes', 'm f', 13)),
  wire('work-build', curve(272, 200, 350, 200), { arrow: 'bs-a' }),
  cell('build', 420, 200, 64, 'builds', { style: LIT, cls: 'm k hy', size: 19, sub: 'one name' }),
  wire('build-named', curve(478, 172, 574, 129), { arrow: 'bs-a' }),
  card('named', 580, 92, 320, 74, 'opening-v2', { cls: 'm k hy', size: 20, sub: 'sealed as one build', lit: true }),
  wire('named-revert', 'M740,166 V244', { arrow: 'bs-a', label: [776, 210, 'later'] }),
  card('revert', 580, 250, 320, 74, 'builds revert', { cls: 'm k', size: 20, sub: 'live again, as a new step' }),
].join('\n'))
