// 22 — junctions compute: visuals/hive-computer.svg
const { f1, hexPts, hex, LIT, CELL, GHOST, STEEL, marker, markerS, flow, ghost, text, svg, note, beeDef, server, check, device, part } = require('./lib.cjs')

module.exports = () => {
  return svg('script and input cells meet at a junction that computes a signed result; others ask for it by its signature instead of computing it again', [
    `<defs>${marker('cp-ah')}${markerS('cp-as')}</defs>`,
    hex(195, 130, 78, GHOST), hex(465, 130, 78, GHOST), hex(532.5, 247, 78, GHOST),
    // the parts keep the drawing's own order: a part may appear twice
    part('inputs', hex(330, 130, 78, CELL), hex(262.5, 247, 78, CELL)),
    part('result', hex(397.5, 247, 78, LIT)),
    part('inputs', text(330, 100, 'script<tspan class="m f" x="330" dy="22">3f2a…</tspan>', 'd', 18),
    text(250, 262, 'input<tspan class="m f" x="250" dy="22">c9d0…</tspan>', 'd', 18)),
    part('result', text(412, 262, 'result<tspan class="m" x="412" dy="24" font-size="18" font-weight="400">7be1…</tspan>', 'k hy', 22)),
    part('inputs', flow('M330,150 V194', 'cp-ah', 1.5), flow('M284,230 L316,214', 'cp-ah', 1.5), flow('M340,216 L372,232', 'cp-ah', 1.5),
    `<circle cx="330" cy="208" r="12" fill="var(--bg)" stroke="var(--honey)" stroke-width="1.5"/><circle cx="330" cy="208" r="5" fill="var(--honey-fill)"/>`),
    part('asked', `<g stroke="var(--steel)" stroke-width="1" stroke-dasharray="3 6" fill="none"><path d="M626,158 C590,170 540,200 470,234" marker-end="url(#cp-as)"/><path d="M684,247 C620,247 560,247 470,247" marker-end="url(#cp-as)"/><path d="M626,336 C590,324 540,294 470,260" marker-end="url(#cp-as)"/></g>`,
    [[642, 150], [700, 247], [642, 344]].map(([x, y]) => hex(x, y, 16, STEEL) + check(x, y, 'var(--honey)')).join(''),
    text(790, 244, 'asked for<tspan x="790" dy="22">not recomputed</tspan>', 'st', 18, 'start')),
  ].join('\n'))
}
