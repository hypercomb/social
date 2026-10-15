// 5 — the name is the bytes: visuals/signature-name.svg
const { f1, hexPts, hex, LIT, CELL, GHOST, STEEL, marker, markerS, flow, ghost, text, svg, note, beeDef, server, check, device } = require('./lib.cjs')

module.exports = () => {
  const bytes = (x, y, flipped = -1) => { let s = ''; for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) { const i = r * 8 + c; s += `<rect x="${x + 12 + c * 15}" y="${y + 16 + r * 18}" width="11" height="8" rx="1" fill="${i === flipped ? 'var(--steel)' : 'var(--line)'}"${i === flipped ? ' stroke="var(--ink)" stroke-width="1"' : ''}/>` } return s }
  const card = (x, y, flipped) => `<path d="M${x + 3},${y} H${x + 124} L${x + 150},${y + 26} V${y + 77} a3,3 0 0 1 -3,3 H${x + 3} a3,3 0 0 1 -3,-3 V${y + 3} a3,3 0 0 1 3,-3 Z" fill="var(--bg)" stroke="var(--line)" stroke-width="1.5"/><path d="M${x + 124},${y} V${y + 26} H${x + 150}" fill="none" stroke="var(--line)" stroke-width="1.5"/>` + bytes(x, y, flipped)
  return svg('two identical files pass through sign() and get one name; one byte flipped gets a different name', [
    `<defs>${marker('sg-ah')}${markerS('sg-as')}</defs>`,
    card(48, 44), text(48, 142, 'photo.png', 'm d', 18, 'start'),
    card(48, 152),
    card(48, 260, 11), text(48, 357, 'one byte flipped', 'f', 18, 'start'),
    `<path d="M198,84 C262,84 300,150 334,172" fill="none" stroke="var(--honey)" stroke-width="1.5"/>`,
    `<path d="M198,192 C262,192 300,186 334,172" fill="none" stroke="var(--honey)" stroke-width="1.5"/>`,
    `<circle cx="334" cy="172" r="4" fill="var(--honey)"/>`,
    flow('M334,172 C350,178 366,186 380,194', 'sg-ah', 1.5),
    `<path d="M198,300 C262,300 330,250 382,226" fill="none" stroke="var(--steel)" stroke-width="1.5" marker-end="url(#sg-as)"/>`,
    hex(432, 200, 52, LIT),
    text(432, 208, 'sign()', 'm k hy', 24),
    flow('M478,180 C510,170 530,150 556,140', 'sg-ah'),
    `<path d="M478,222 C510,236 530,254 556,266" fill="none" stroke="var(--steel)" stroke-width="1.5" marker-end="url(#sg-as)"/>`,
    `<rect x="562" y="112" width="358" height="56" rx="3" fill="var(--panel)" stroke="var(--honey)" stroke-width="1.5"/>`,
    text(741, 147, 'f789fc997e06…', 'm k hy', 22),
    `<path d="M729,196 H753 M729,208 H753 M747,189 L735,215" stroke="var(--steel)" stroke-width="1.5"/>`,
    `<rect x="562" y="238" width="358" height="56" rx="3" fill="var(--panel)" stroke="var(--line)" stroke-width="1.5"/>`,
    text(741, 273, '0481317c2032…', 'm d', 22),
  ].join('\n'))
}
