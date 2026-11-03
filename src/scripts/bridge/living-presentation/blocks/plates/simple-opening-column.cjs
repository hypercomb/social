// move four — versions stack into a column: the row of six values from move
// two, each word now carrying its own history upward. The newest layer is the
// heart (honey); everything beneath it is kept. Columns differ in height,
// because versions belong to each tile; the dashed line at the second step
// lines them up for the eye only.
const { hex, LIT, CELL, marker, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

const WORDS = ['simple', 'organized', 'collaborative', 'intelligent', 'accessible', 'localized']
const HEIGHT = [4, 2, 3, 1, 3, 2]          // each word's own number of versions
const R = 29, STEP = 64, BASE = 296
const X = i => 130 + i * 140
const Y = level => BASE - level * STEP

module.exports = () => {
  const old = [], tops = []
  WORDS.forEach((w, i) => {
    if (i === 0) return
    for (let l = 0; l < HEIGHT[i] - 1; l++) old.push(hex(X(i), Y(l), R, CELL))
    tops.push(hex(X(i), Y(HEIGHT[i] - 1), R, LIT))
  })
  return svg('six words in a row, each with a column of versions above it; the newest on top of each column is lit as its heart', [
    `<defs>${marker('oc-ah')}</defs>`,
    // the second step, lined up across the columns for the eye only
    `<g data-id="level"><path d="M96,${Y(1)} H866" stroke="var(--steel)" stroke-width="1.5" stroke-dasharray="3 7"/>` +
      text(880, Y(1) + 6, '0001', 'm st', 16, 'start') + `</g>`,
    // simple: three kept layers, then the new one on top
    `<g data-id="simple-old">${[0, 1, 2].map(l => hex(X(0), Y(l), R, CELL)).join('')}</g>`,
    `<g data-id="simple-new">${hex(X(0), Y(3), R, LIT)}${text(X(0), Y(3) - R - 14, 'heart', 'k hy', 18)}</g>`,
    [0, 1, 2].map(l => text(86, Y(l) + 6, `000${l}`, 'm f', 16, 'end')).join(''),
    text(86, Y(3) + 6, '0003', 'm hy', 16, 'end'),
    `<g data-id="move">${flow(`M${X(0) + 38},${Y(2) - 4} C${X(0) + 64},${Y(2) - 24} ${X(0) + 64},${Y(3) + 24} ${X(0) + 40},${Y(3) + 6}`, 'oc-ah')}</g>`,
    // every other word: its kept layers, and its heart
    `<g data-id="cols">${old.join('')}</g>`,
    `<g data-id="hearts">${tops.join('')}</g>`,
    WORDS.map((w, i) => text(X(i), BASE + R + 30, w, i === 0 ? 'k' : 'd', 18)).join(''),
  ].join('\n'))
}
