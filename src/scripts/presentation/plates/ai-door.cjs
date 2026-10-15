// 18 — a door you open: visuals/ai-door.svg
const { f1, hexPts, hex, LIT, CELL, GHOST, STEEL, marker, markerS, flow, ghost, text, svg, note, beeDef, server, check, device } = require('./lib.cjs')

module.exports = () => {
  return svg('an ask typed at the command line passes through one open door in the hive wall; the answer lands as a note pinned to a tile, in history', [
    `<defs>${marker('ai-ah')}</defs>`,
    `<rect x="40" y="168" width="330" height="52" rx="3" fill="var(--panel)" stroke="var(--line)" stroke-width="1.5"/>`,
    text(60, 201, '<tspan class="hy">&gt;</tspan> ask what is this place?', 'm', 19, 'start'),
    `<rect x="348" y="184" width="3" height="20" fill="var(--honey-fill)"/>`,
    [[500, 46], [562, 100], [500, 154], [500, 262], [562, 316]].map(([x, y]) => hex(x, y, 36, 'fill="var(--panel)" stroke="var(--line)" stroke-width="1.5"')).join(''),
    ghost('M370,194 C420,194 470,200 524,206'),
    hex(562, 208, 36, LIT),
    `<path d="M532,190 L546,196 V232 L532,226 Z" fill="var(--honey-fill)" fill-opacity=".6" stroke="var(--honey)" stroke-width="1.2"/>`,
    flow('M596,208 C640,206 680,206 712,206', 'ai-ah'),
    hex(770, 200, 52, LIT), note(740, 178, 60, 44), `<circle cx="770" cy="176" r="4.5" fill="var(--honey-fill)"/>`,
    text(770, 282, 'a note on the tile', 'd', 18),
    text(762, 330, '0000  0001  0002  <tspan class="hy">0003</tspan>', 'm f', 18),
    `<circle cx="884" cy="324" r="4.5" fill="var(--honey)"/>`,
  ].join('\n'))
}
