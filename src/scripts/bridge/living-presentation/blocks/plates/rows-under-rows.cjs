// stack: each value opens into a row of its own, so the plane becomes a stack
// of planes, and a path from the top reads aloud.
const { svg, cell, wire, drop, ghost, text, LIT } = require('./pieces.cjs')

const TOPS = [['a', 200, 'simple', 19], ['b', 480, 'organized', 17], ['c', 760, 'collaborative', 13]]
const KIDS = [['a1', 130, 'primitive', 14], ['a2', 270, 'act', 18], ['b1', 410, 'heart', 18], ['b2', 550, 'history', 17], ['c1', 690, 'domain', 17], ['c2', 830, 'sharing', 17]]

module.exports = () => svg('Three values, each with a row of its own beneath it: a stack of planes', [
  ghost('M40,92 H920'), ghost('M40,284 H920'),
  text(40, 40, 'a layer', 'm f', 13, 'start'),
  text(40, 362, 'a layer under each word', 'm f', 13, 'start'),
  ...KIDS.map(([id, x]) => { const top = TOPS.find(t => t[0] === id[0]); return wire(`${id[0]}-${id}`, drop(top[1] + (x < top[1] ? -24 : 24), 140, x, 236)) }),
  ...TOPS.map(([id, x, word, size]) => cell(id, x, 92, 56, word, { size, style: LIT })),
  ...KIDS.map(([id, x, word, size]) => cell(id, x, 284, 50, word, { size })),
].join('\n'))
