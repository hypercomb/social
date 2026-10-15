// 22 — junctions compute: visuals/hive-computer.svg
const { f1, hexPts, hex, LIT, CELL, GHOST, STEEL, marker, markerS, flow, ghost, text, svg, note, beeDef, server, check, device } = require('./lib.cjs')

module.exports = () => {
  return svg('script and input cells meet at a junction that computes a signed result; the result is cached for the whole network', [
    `<defs>${marker('cp-ah')}</defs>`,
    hex(195, 130, 78, GHOST), hex(465, 130, 78, GHOST), hex(532.5, 247, 78, GHOST),
    hex(330, 130, 78, CELL), hex(262.5, 247, 78, CELL), hex(397.5, 247, 78, LIT),
    text(330, 100, 'script<tspan class="m f" x="330" dy="22">3f2a…</tspan>', 'd', 18),
    text(250, 262, 'input<tspan class="m f" x="250" dy="22">c9d0…</tspan>', 'd', 18),
    text(412, 262, 'result<tspan class="m" x="412" dy="24" font-size="18" font-weight="400">7be1…</tspan>', 'k hy', 22),
    flow('M330,150 V194', 'cp-ah', 1.5), flow('M284,230 L316,214', 'cp-ah', 1.5), flow('M340,216 L372,232', 'cp-ah', 1.5),
    `<circle cx="330" cy="208" r="12" fill="var(--bg)" stroke="var(--honey)" stroke-width="1.5"/><circle cx="330" cy="208" r="5" fill="var(--honey-fill)"/>`,
    `<g stroke="var(--steel)" stroke-width="1" stroke-dasharray="3 6" fill="none"><path d="M466,236 C540,200 590,170 626,158"/><path d="M466,247 C560,247 620,247 684,247"/><path d="M466,258 C540,294 590,324 626,336"/></g>`,
    [[642, 150], [700, 247], [642, 344]].map(([x, y]) => hex(x, y, 16, STEEL) + check(x, y, 'var(--honey)')).join(''),
    text(790, 254, 'cached', 'st', 18, 'start'),
  ].join('\n'))
}
