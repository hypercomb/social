// 4 — presence is permission: visuals/presence-permission.svg
const { f1, hexPts, hex, LIT, CELL, GHOST, STEEL, marker, markerS, flow, ghost, text, svg, note, beeDef, server, check, device } = require('./lib.cjs')

module.exports = () => {
  return svg('your hive inside the browser on your own device; one explicit gate, publish, lets content out to open relays', [
    `<defs>${marker('pr-ah')}</defs>`,
    text(275, 50, 'your device', 'd', 18),
    device(40, 62, 470, 250),
    `<rect x="68" y="86" width="414" height="202" rx="3" fill="none" stroke="var(--line)" stroke-width="1"/><path d="M68,112 H482" stroke="var(--line)" stroke-width="1"/>`,
    `<circle cx="86" cy="99" r="3" fill="var(--line)"/><circle cx="100" cy="99" r="3" fill="var(--line)"/><circle cx="114" cy="99" r="3" fill="var(--line)"/>`,
    text(134, 104, 'hypercomb.com', 'm f', 18, 'start'),
    [[327, 200], [223, 200], [301, 155], [249, 155], [301, 245], [249, 245]].map(([x, y]) => hex(x, y, 30, CELL)).join(''),
    hex(275, 200, 30, LIT),
    `<path d="M560,40 V340" stroke="var(--dim)" stroke-width="1" stroke-dasharray="6 7"/>`,
    ghost('M305,200 C400,200 460,196 536,196'),
    `<rect x="540" y="176" width="40" height="40" rx="3" fill="var(--bg)" stroke="var(--honey)" stroke-width="2"/>`, hex(560, 196, 12, 'fill="var(--honey-fill)"'),
    text(560, 246, 'publish', 'k hy', 22),
    flow('M580,194 C620,190 650,160 686,130', 'pr-ah'),
    flow('M580,196 C620,196 690,198 742,200', 'pr-ah'),
    flow('M580,198 C620,202 650,240 686,270', 'pr-ah'),
    `<path d="M712,136 L748,184 M748,216 L712,264" stroke="var(--steel)" stroke-width="1" stroke-dasharray="3 5"/>`,
    hex(700, 120, 16, STEEL), hex(760, 200, 16, STEEL), hex(700, 280, 16, STEEL),
    text(730, 334, 'open relays', 'st', 18),
  ].join('\n'))
}
