// 9 — the shell is a loader: visuals/bee-modules.svg
const { f1, hexPts, hex, LIT, CELL, GHOST, STEEL, marker, markerS, flow, ghost, text, svg, note, beeDef, server, check, device } = require('./lib.cjs')

module.exports = () => {
  return svg('the shell is an empty loader; every feature is a bee in a comb cell; a new signed bee arrives from the community', [
    `<defs>${marker('be-ah')}${beeDef('be-bee')}</defs>`,
    `<rect x="40" y="44" width="600" height="296" rx="3" fill="none" stroke="var(--line)" stroke-width="1.5"/>`,
    text(58, 74, 'SHELL', 'm f', 18, 'start', 'letter-spacing="3"'),
    [[160, 150], [250, 150], [340, 150], [430, 150], [520, 150], [205, 228], [295, 228], [385, 228]].map(([x, y]) => hex(x, y, 52, CELL) + `<use href="#be-bee" x="${x - 2}" y="${y}"/>`).join(''),
    hex(475, 228, 52, 'fill="var(--honey-fill)" fill-opacity=".1" stroke="var(--honey)" stroke-width="1.5" stroke-dasharray="7 6"'),
    hex(565, 228, 52, 'fill="none" stroke="var(--line)" stroke-width="1" stroke-dasharray="7 6"'),
    text(565, 306, 'yours next', 'f', 18),
    flow('M772,138 C700,160 600,180 500,214', 'be-ah'),
    hex(800, 126, 30, LIT), `<use href="#be-bee" x="798" y="126"/>`,
    text(800, 188, 'signed', 'k hy', 22),
  ].join('\n'))
}
