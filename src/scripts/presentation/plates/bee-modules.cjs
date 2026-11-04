// 9 — the shell is a loader: visuals/bee-modules.svg
const { f1, hexPts, hex, LIT, CELL, GHOST, STEEL, marker, markerS, flow, ghost, text, svg, note, beeDef, server, check, device, part } = require('./lib.cjs')

module.exports = () => {
  return svg('the shell is an empty loader; every feature is a bee in a comb cell; a new signed bee arrives from the community and is held outside the shell until you accept it', [
    `<defs>${marker('be-ah')}${beeDef('be-bee')}</defs>`,
    part('shell', `<rect x="40" y="44" width="600" height="296" rx="3" fill="none" stroke="var(--line)" stroke-width="1.5"/>`,
    text(58, 74, 'SHELL', 'm f', 18, 'start', 'letter-spacing="3"'),
    [[160, 150], [250, 150], [340, 150], [430, 150], [520, 150], [205, 228], [295, 228], [385, 228]].map(([x, y]) => hex(x, y, 52, CELL) + `<use href="#be-bee" x="${x - 2}" y="${y}"/>`).join(''),
    hex(475, 228, 52, 'fill="var(--honey-fill)" fill-opacity=".1" stroke="var(--honey)" stroke-width="1.5" stroke-dasharray="7 6"'),
    hex(565, 228, 52, 'fill="none" stroke="var(--line)" stroke-width="1" stroke-dasharray="7 6"'),
    text(565, 306, 'yours next', 'f', 18)),
    part('held', hex(720, 250, 34, 'fill="none" stroke="var(--honey)" stroke-dasharray="5 5"'), text(720, 306, 'held', 'f', 18),
    check(758, 246), text(770, 252, 'you accept', 'f', 16, 'start'),
    flow('M690,240 C620,236 560,230 500,226', 'be-ah', 1.5)),
    part('signed', flow('M770,134 C744,150 728,180 722,210', 'be-ah'),
    hex(800, 126, 30, LIT), `<use href="#be-bee" x="798" y="126"/>`,
    text(800, 188, 'signed', 'k hy', 22)),
  ].join('\n'))
}
