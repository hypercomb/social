// move two — the layer lays out as a row. Move one stands as it was (hypercomb,
// its meta and signature beside it, its layer below); the layer now holds the
// six values side by side, in their order. The row is the row move four
// raises its columns from: x = 130 + 140i, y = 296, names beneath.
// The signature changed with the layer: same name, new bytes.
const { hex, LIT, CELL, marker, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

const HX = 480, HY = 90, R = 64
const WORDS = ['simple', 'organized', 'collaborative', 'intelligent', 'accessible', 'localized']
const X = i => 130 + i * 140, Y = 296, r = 29
const card = (id, cx, title, value, from, to) =>
  `<g data-id="${id}"><path d="M${from},${HY} H${to}" stroke="var(--line-strong)" stroke-width="1.2"/>` +
  `<rect x="${cx - 88}" y="${HY - 32}" width="176" height="64" rx="3" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
  text(cx, HY - 6, title, 'k', 18) + text(cx, HY + 20, value, 'm f', 16) + `</g>`

module.exports = () => svg('hypercomb above its layer, which now holds six words in a row: simple, organized, collaborative, intelligent, accessible, localized', [
  card('meta', 270, 'meta', 'empty', HX - R * 0.866, 358),
  card('signature', 690, 'signature', '1a843151…', HX + R * 0.866, 602),
  `<g data-id="layer"><path d="M${HX},${HY + R} V236" stroke="var(--line-strong)" stroke-width="1.2"/>` +
    text(HX + 14, 202, 'layer', 'k', 18, 'start') +
    `<rect x="60" y="236" width="840" height="138" rx="6" fill="none" stroke="var(--line-strong)" stroke-width="1.2"/></g>`,
  // read across: words beside words, in the layer's own order, first to last
  `<defs>${marker('or-ah')}</defs>`,
  `<g data-id="across">${flow(`M${X(0) - 10},251 H${X(5) + 12}`, 'or-ah', 1.5)}</g>`,
  WORDS.map((w, i) => `<g data-id="${w}">${hex(X(i), Y, r, CELL)}</g>`).join('\n'),
  WORDS.map((w, i) => text(X(i), Y + r + 30, w, 'd', 18)).join(''),
  `<g data-id="hypercomb">${hex(HX, HY, R, LIT)}${text(HX, HY - 14, 'word', 'm f', 16)}${text(HX, HY + 16, 'hypercomb', 'k', 18)}</g>`,
].join('\n'))
