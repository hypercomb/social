// a reader asks one host — the page carries what reading needs. On the left,
// the one host that serves the presentation. In the middle, the reader's
// screen, and on it a page holding its four kinds of piece: its words, its
// typefaces, its voice and its pictures (page.cjs: everything is inside the
// page or named `resource:<sig>`, served by the same host). The one honey
// line is the only request the page makes. On the right, the hosts an
// ordinary page would also call — a font service, a script library, a visitor
// counter — drawn as silhouettes, each line to them cut (doctrine T7;
// check.cjs fails a page that names another host).
const { hex, CELL, GHOST, marker, flow, text, svg, server, device } = require('../../../../presentation/plates/lib.cjs')

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

const ELSEWHERE = [['font service', 70], ['script library', 160], ['visitor counter', 250]]

module.exports = () => svg('one host serves the presentation; the page on your screen carries its words, typefaces, voice and pictures; the font service, script library and visitor counter an ordinary page would call are never asked', [
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
  // the hosts an ordinary page would also call: never asked
  `<g data-id="others"><rect x="668" y="${ELSEWHERE[0][1] - 4}" width="268" height="${ELSEWHERE[2][1] - ELSEWHERE[0][1] + 64}" fill="none" stroke="none"/>` +
    ELSEWHERE.map(([name, y]) =>
      `<path d="M666,${y + 30} H716" fill="none" stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="4 6"/>` +
      `<path d="M684,${y + 17} L698,${y + 43}" stroke="var(--danger)" stroke-width="2"/>` +
      `<rect x="720" y="${y}" width="212" height="60" rx="3" ${GHOST} stroke-dasharray="5 5"/>` +
      text(826, y + 38, name, 'f', 22)).join('') + `</g>`,
].join('\n'))
