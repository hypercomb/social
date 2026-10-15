// 1 — where your work lives: visuals/where-your-work-lives.svg
const { f1, hexPts, hex, LIT, CELL, GHOST, STEEL, marker, markerS, flow, ghost, text, svg, note, beeDef, server, check, device } = require('./lib.cjs')

module.exports = () => {
  return svg('two answers: behind someone else’s login on someone else’s computer, or in one lit cell on your own device', [
    text(240, 58, 'MOST SOFTWARE', 'm f', 18, 'middle', 'letter-spacing="3"'),
    server(96, 100, 170),
    `<rect x="300" y="100" width="128" height="94" rx="3" fill="none" stroke="var(--steel)" stroke-width="1.5"/>`,
    `<rect x="348" y="146" width="32" height="24" rx="2" fill="none" stroke="var(--steel)" stroke-width="1.5"/><path d="M354,146 v-8 a10,10 0 0 1 20,0 v8" fill="none" stroke="var(--steel)" stroke-width="1.5"/>`,
    `<path d="M318,120 h92" stroke="var(--line)" stroke-width="2"/>`,
    text(262, 236, 'someone else’s computer', 'st', 18),
    `<path d="M480,40 V340" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 7"/>`,
    text(730, 58, 'HYPERCOMB', 'm hy', 18, 'middle', 'letter-spacing="3"'),
    `<clipPath id="wl-clip"><rect x="562" y="86" width="336" height="206"/></clipPath>`,
    device(560, 84, 340, 210),
    `<g clip-path="url(#wl-clip)">` + [[640, 190], [820, 190], [685, 112], [775, 112], [685, 268], [775, 268], [595, 112], [865, 112], [595, 268], [865, 268]].map(([x, y]) => hex(x, y, 52, GHOST)).join('') + `</g>`,
    hex(730, 190, 52, LIT), note(708, 173, 44, 34),
    text(730, 330, 'your device', 'd', 18),
  ].join('\n'))
}
