// move three — rows under rows. Hypercomb stands where it stood, with its meta
// and signature; its layer, the row of six, tilts into a plane, and every word
// on it opens a row of its own on the plane below, and so on: a stack of
// planes. The rows are this presentation's own (presentation/tree.cjs): simple
// holds primitive, act and opening; organized six; collaborative eight;
// intelligent five; accessible four; localized two. On the third plane only
// primitive (word, signature, layer, meta) and opening (its seven moves) hold
// rows. One path is lit and read down the left: hypercomb, simple, primitive,
// word.
const { f1, hex, LIT, CELL, marker, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

const HX = 480, HY = 90, R = 64
const card = (id, cx, title, value, from, to) =>
  `<g data-id="${id}"><path d="M${from},${HY} H${to}" stroke="var(--line-strong)" stroke-width="1.2"/>` +
  `<rect x="${cx - 88}" y="${HY - 32}" width="176" height="64" rx="3" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
  text(cx, HY - 6, title, 'k', 18) + text(cx, HY + 20, value, 'm f', 16) + `</g>`

// a plane seen at an angle, and a cell lying flat on it
const SKEW = 60, DEPTH = 30, LEFT = 140, RIGHT = 860
const plane = yb => `<path d="M${LEFT},${yb + DEPTH} L${RIGHT},${yb + DEPTH} L${RIGHT + SKEW},${yb} L${LEFT + SKEW},${yb} Z" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.2"/>`
const flat = (cx, cy, r, a) => `<polygon points="${[[0, -1], [0.866, -0.5], [0.866, 0.5], [0, 1], [-0.866, 0.5], [-0.866, -0.5]]
  .map(([x, y]) => `${f1(cx + x * r)},${f1(cy + y * r * 0.42)}`).join(' ')}" ${a}/>`
const P1 = 172, P2 = 238, P3 = 304            // the back edge of each plane
const MID = yb => yb + DEPTH / 2
const PATH = 200                              // the lit path runs down this line

const VALUES = ['simple', 'organized', 'collaborative', 'intelligent', 'accessible', 'localized']
const VX = i => 200 + i * 126
const KIDS = [3, 6, 8, 5, 4, 2]               // each value's own row
const PITCH = 18, r2 = 10
// simple's row starts under simple, so the path runs straight; the others centre under their word
const runStart = i => i === 0 ? VX(0) : VX(i) - (KIDS[i] - 1) * PITCH / 2
const SMALL = 'fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.2"'

module.exports = () => {
  const rows = [], deeper = []
  VALUES.forEach((w, i) => {
    for (let k = 0; k < KIDS[i]; k++) if (!(i === 0 && k === 0)) rows.push(flat(runStart(i) + k * PITCH, MID(P2), r2, SMALL))
  })
  // primitive's row (word first) and opening's row of seven, after it
  for (let k = 1; k < 4; k++) deeper.push(flat(PATH + k * PITCH, MID(P3), r2, SMALL))
  for (let k = 0; k < 7; k++) deeper.push(flat(PATH + 90 + k * PITCH, MID(P3), r2, SMALL))
  return svg('hypercomb over a stack of planes: its six words on the first, each word\'s own row on the second, and rows under those on the third; one path lit from simple to primitive to word', [
    `<defs>${marker('st-ah')}</defs>`,
    card('meta', 270, 'meta', 'empty', HX - R * 0.866, 358),
    card('signature', 690, 'signature', '1a843151…', HX + R * 0.866, 602),
    `<g data-id="layer"><path d="M${HX},${HY + R} V${P1}" stroke="var(--line-strong)" stroke-width="1.2"/>${plane(P1)}</g>`,
    `<g data-id="values">${VALUES.slice(1).map((w, i) => flat(VX(i + 1), MID(P1), 29, CELL)).join('')}</g>`,
    `<g data-id="names">${VALUES.slice(1).map((w, i) => text(VX(i + 1), P1 + DEPTH + 22, w, 'd', 18)).join('')}</g>`,
    `<g data-id="simple">${flat(VX(0), MID(P1), 29, LIT)}</g>`,
    `<g data-id="rows">${plane(P2)}${rows.join('')}</g>`,
    `<g data-id="primitive">${flat(PATH, MID(P2), r2, LIT)}</g>`,
    `<g data-id="deeper">${plane(P3)}${deeper.join('')}</g>`,
    `<g data-id="word">${flat(PATH, MID(P3), r2, LIT)}</g>`,
    `<g data-id="path">${flow(`M${PATH},${MID(P1) + 10} V${MID(P3) - 7}`, 'st-ah', 1.5)}</g>`,
    `<g data-id="name-simple">${text(LEFT + 4, MID(P1) + 6, 'simple', 'k hy', 18, 'end')}</g>`,
    `<g data-id="name-primitive">${text(LEFT + 4, MID(P2) + 6, 'primitive', 'k hy', 18, 'end')}</g>`,
    `<g data-id="name-word">${text(LEFT + 4, MID(P3) + 6, 'word', 'k hy', 18, 'end')}</g>`,
    `<g data-id="hypercomb">${hex(HX, HY, R, LIT)}${text(HX, HY + 6, 'hypercomb', 'k', 18)}</g>`,
  ].join('\n'))
}
