// 17 — hive to hive: visuals/no-middleman.svg
const { f1, hexPts, hex, LIT, CELL, GHOST, STEEL, marker, markerS, flow, ghost, text, svg, note, beeDef, server, check, device } = require('./lib.cjs')

module.exports = () => {
  const comb7 = (cx, cy, r, a, lit, litAt) => [[0, 0], [1.732, 0], [0.866, -1.5], [-0.866, -1.5], [-1.732, 0], [-0.866, 1.5], [0.866, 1.5]]
    .map(([x, y], i) => hex(cx + x * r, cy + y * r, r, i === litAt ? lit : a)).join('')
  return svg('two hives exchange signed layers directly, by signature, through hosts; the platform in the middle is crossed out', [
    `<defs>${marker('nm-ah')}</defs>`,
    comb7(170, 218, 30, CELL, LIT, 0), text(170, 322, 'your hive', 'hy', 18),
    comb7(790, 218, 30, STEEL, 'fill="var(--honey-fill)" fill-opacity=".16" stroke="var(--honey)" stroke-width="2"', 5), text(790, 322, 'their hive', 'st', 18),
    server(420, 60, 120, 'var(--line)'),
    ghost('M224,176 C300,120 360,104 414,96'), ghost('M736,176 C660,120 600,104 546,96'),
    `<path d="M402,48 L558,166" stroke="var(--danger)" stroke-width="2"/>`,
    flow('M222,258 Q480,372 738,258', 'nm-ah'),
    hex(365, 300, 16, STEEL), hex(480, 316, 16, STEEL), hex(595, 300, 16, STEEL),
    text(480, 354, 'hosts', 'st', 18),
    hex(292, 276, 10, 'fill="var(--honey-fill)"'), text(292, 258, '3f2a…', 'm hy', 13),
    hex(668, 276, 10, 'fill="var(--honey-fill)"'), text(668, 258, 'c9d0…', 'm hy', 13),
  ].join('\n'))
}
