// move one — one hexagon, named hypercomb, and its four parts. The word is the
// name on the hexagon. Beside it, its signature (worked out from its layer,
// here the bytes {"name":"hypercomb"} and nothing else) and its meta, empty.
// Below it, its layer: the place the words under it will go, empty for now.
// The geometry is the opening's: hypercomb at (480, 90); the layer below spans
// the row that move two fills (values at x = 130 + 140i, y = 296).
const { hex, LIT, GHOST, text, svg } = require('../../../../presentation/plates/lib.cjs')

const HX = 480, HY = 90, R = 64
const card = (id, cx, title, value, from, to) =>
  `<g data-id="${id}"><path d="M${from},${HY} H${to}" stroke="var(--line-strong)" stroke-width="1.2"/>` +
  `<rect x="${cx - 88}" y="${HY - 32}" width="176" height="64" rx="3" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
  text(cx, HY - 6, title, 'k', 18) + text(cx, HY + 20, value, 'm f', 16) + `</g>`

module.exports = () => svg('one hexagon named hypercomb, with its signature and its meta beside it and its layer below it, empty', [
  card('meta', 270, 'meta', 'empty', HX - R * 0.866, 358),
  card('signature', 690, 'signature', '92020378…', HX + R * 0.866, 602),
  `<g data-id="layer"><path d="M${HX},${HY + R} V236" stroke="var(--line-strong)" stroke-width="1.2"/>` +
    text(HX + 14, 202, 'layer', 'k', 18, 'start') +
    `<rect x="60" y="236" width="840" height="138" rx="6" fill="none" stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="5 7"/>` +
    text(HX, 311, 'empty', 'f', 18) + `</g>`,
  `<g data-id="hypercomb">${hex(HX, HY, R, LIT)}${text(HX, HY - 14, 'word', 'm f', 16)}${text(HX, HY + 16, 'hypercomb', 'k', 18)}</g>`,
].join('\n'))
