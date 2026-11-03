// reading calls one host. On the left, the host whose address you opened. In
// the middle, the reader's screen, and on it a page holding its four kinds of
// piece: its words, its typefaces, its voice and its pictures (page.cjs:
// everything is inside the page or named `resource:<sig>`, answered by that
// same host). The one honey line is that answer arriving. On the right, the
// hosts an ordinary page would also call (a font service, a script library, a
// visitor counter), drawn as silhouettes. Two guards keep them out: the
// reader's door, which refuses to fetch from any origin but its own
// (hypercomb-web/src/setup/readonly-network.ts), drawn as the struck lines;
// and the presentation's own check, which fails a page that names another
// host for any part (blocks/check.cjs; doctrine T7).
const { hex, CELL, GHOST, STEEL, marker, flow, text, svg, server, device, check } = require('../../../../presentation/plates/lib.cjs')

const P = { x: 348, y: 74, w: 136, h: 94, gx: 12, gy: 12 }   // the page's four pieces, two by two
const at = (c, r) => [P.x + c * (P.w + P.gx), P.y + r * (P.h + P.gy)]
const piece = (c, r, label, glyph) => {
  const [x, y] = at(c, r)
  return `<rect x="${x}" y="${y}" width="${P.w}" height="${P.h}" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>` +
    glyph(x + P.w / 2, y + 34) + text(x + P.w / 2, y + 78, label, 'k', 22)
}
const words = (cx, cy) => `<path d="M${cx - 30},${cy - 10} H${cx + 30} M${cx - 30},${cy} H${cx + 22} M${cx - 30},${cy + 10} H${cx + 12}" stroke="var(--dim)" stroke-width="2"/>`
const faces = (cx, cy) => text(cx, cy + 12, 'Aa', 'k hy', 34)
const voice = (cx, cy) => `<path d="M${cx - 22},${cy - 6} h8 l10,-9 v30 l-10,-9 h-8 Z" fill="none" stroke="var(--dim)" stroke-width="1.8"/>` +
  `<path d="M${cx + 4},${cy - 6} q6,6 0,12 M${cx + 11},${cy - 12} q12,12 0,24" fill="none" stroke="var(--honey)" stroke-width="1.8"/>`
const picture = (cx, cy) => hex(cx, cy, 20, CELL)

// the hosts an ordinary page would also call, and the reader's door between
const O = { x: 726, w: 206, h: 56, ys: [62, 140, 218] }
const DOOR = 692

module.exports = () => svg('the host you opened answers the page on your screen with its words, typefaces, voice and pictures; the font service, script library and visitor counter an ordinary page would call are refused at the reader’s door, and the presentation’s check fails any page that names another host', [
  `<defs>${marker('rd-ah')}</defs>`,
  // the one host
  `<g data-id="host">${server(48, 124, 180)}${text(138, 104, 'one host', 'st', 24)}</g>`,
  flow('M240,171 C270,171 290,171 318,171', 'rd-ah', 2.5),
  // the reader's screen
  `<g data-id="reader">${device(330, 56, 320, 230)}${text(490, 346, 'your screen', 'd', 24)}</g>`,
  // the page, and what it carries
  `<g data-id="page"><rect x="342" y="68" width="296" height="212" fill="none" stroke="none"/>` +
    piece(0, 0, 'words', words) + piece(1, 0, 'typefaces', faces) +
    piece(0, 1, 'voice', voice) + piece(1, 1, 'pictures', picture) + `</g>`,
  // the hosts an ordinary page would also call
  `<g data-id="others"><rect x="664" y="${O.ys[0]}" width="${O.x + O.w - 664}" height="${O.ys[2] + O.h - O.ys[0]}" fill="none" stroke="none"/>` +
    O.ys.map(y =>
      `<path d="M664,${y + O.h / 2} H${O.x - 6}" fill="none" stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="4 6"/>` +
      `<rect x="${O.x}" y="${y}" width="${O.w}" height="${O.h}" rx="3" ${GHOST} stroke-dasharray="5 5"/>`).join('') +
    [['font service', 0], ['script library', 1], ['visitor counter', 2]].map(([name, i]) => text(O.x + O.w / 2, O.ys[i] + O.h / 2 + 8, name, 'f', 22)).join('') + `</g>`,
  // the reader's door: every call to another host refused
  `<g data-id="door"><rect x="${DOOR - 14}" y="${O.ys[0] - 4}" width="28" height="${O.ys[2] + O.h - O.ys[0] + 8}" fill="none" stroke="none"/>` +
    `<path d="M${DOOR},${O.ys[0] - 2} V${O.ys[2] + O.h + 2}" stroke="var(--danger)" stroke-width="1.5" stroke-opacity=".5"/>` +
    O.ys.map(y => `<path d="M${DOOR - 8},${y + O.h / 2 - 13} L${DOOR + 8},${y + O.h / 2 + 13}" stroke="var(--danger)" stroke-width="2.5"/>`).join('') + `</g>`,
  // the presentation's own check: no page names another host
  `<g data-id="check"><rect x="${O.x}" y="304" width="${O.w}" height="56" rx="3" ${STEEL}/>` +
    `<g transform="translate(${O.x + 34},332) scale(2)">${check(0, 0, 'var(--honey)')}</g>` +
    text(O.x + 62, 340, 'the check', 'k', 22, 'start') + `</g>`,
].join('\n'))
