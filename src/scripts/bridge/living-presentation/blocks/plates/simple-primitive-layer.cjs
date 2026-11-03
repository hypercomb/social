// the layer — a tile, written down. On the left, what you see: simple and the
// three tiles under it (its real children in the presentation). In the middle,
// what is written: one small document, its own signature at the head, the
// name first and then each child by a signature, never the child itself
// (canonical-layer.ts: name first, every other field in one order, empty
// fields left out). On the right, one step deeper: following primitive's
// signature opens the next small document, primitive's own layer, with its
// four children. Nothing deeper is read until you follow it.
// The hex is real. Each child entry is the signature of the envelope the write
// boundary mints, {"meta":1,"layer":<child layer>,"relation":"children"}; the
// leaves stand for the empty layer {"name":…}; the head is sha256 of simple's
// canonical document as drawn.
const { hex, CELL, marker, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

// the tile as you see it
const PX = 150, PY = 92, PR = 44, CR = 30, CY = 212
const KIDS = [['primitive', 70, 'd2d55453…'], ['act', 150, '826f767d…'], ['opening', 230, '22c81e79…']]
// the document, and the one a step deeper
const DOC = { x: 296, y: 40, w: 304, h: 296 }
const DEEP = { x: 656, y: 40, w: 264, h: 296 }
const DEEP_KIDS = [['word', '56b93de1…'], ['signature', '87059c35…'], ['layer', 'd4cbac9f…'], ['meta', '373a6ded…']]
const ROW = i => DOC.y + 168 + i * 40
const DROW = i => DEEP.y + 160 + i * 36

const row = (d, y, sig, name) =>
  hex(d.x + 26, y, 8, CELL) + text(d.x + 44, y + 6, sig, 'm', 18, 'start') + text(d.x + 156, y + 6, name, 'f', 18, 'start')
const band = (d, y) => `<rect x="${d.x + 10}" y="${y - 18}" width="${d.w - 20}" height="36" rx="2" fill="none" stroke="none"/>`
// a document's frame: the head, the name, the children label
const frame = (d, name) =>
  `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="3" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
  text(d.x + 22, d.y + 36, 'LAYER', 'm hy', 16, 'start', 'letter-spacing="3"') +
  `<path d="M${d.x + 16},${d.y + 52} H${d.x + d.w - 16}" stroke="var(--line)" stroke-width="1"/>` +
  text(d.x + 22, d.y + 90, 'name', 'm d', 18, 'start') + text(d.x + 98, d.y + 90, name, 'm k', 18, 'start') +
  text(d.x + 22, d.y + 128, 'children', 'm d', 18, 'start')

module.exports = () => svg('simple and its three children, written as one small document with its own signature: the name, then each child by a signature; following primitive’s signature opens the next small document, primitive’s own layer', [
  `<defs>${marker('pl-ah')}</defs>`,
  `<g data-id="tile"><rect x="34" y="40" width="234" height="262" fill="none" stroke="none"/>` +
    KIDS.map(([, x]) => `<path d="M${PX},${PY + PR} L${x},${CY - CR}" stroke="var(--honey-deep)" stroke-width="1.2"/>`).join('') +
    hex(PX, PY, PR, CELL) + text(PX, PY + 6, 'simple', 'k', 18) +
    KIDS.map(([name, x]) => hex(x, CY, CR, CELL) + text(x, CY + CR + 28, name, 'd', 18)).join('') + `</g>`,
  text(151, 336, 'what you see', 'f', 18),
  `<g data-id="doc">${frame(DOC, 'simple')}</g>`,
  `<g data-id="sig"><rect x="${DOC.x + 150}" y="${DOC.y + 16}" width="${DOC.w - 166}" height="28" fill="none" stroke="none"/>` +
    text(DOC.x + DOC.w - 22, DOC.y + 36, '861dca16…', 'm k hy', 18, 'end') + `</g>`,
  `<g data-id="prim">${band(DOC, ROW(0))}${row(DOC, ROW(0), KIDS[0][2], KIDS[0][0])}</g>`,
  `<g data-id="kids"><rect x="${DOC.x + 10}" y="${ROW(1) - 18}" width="${DOC.w - 20}" height="76" fill="none" stroke="none"/>` +
    KIDS.slice(1).map(([name, , sig], i) => row(DOC, ROW(i + 1), sig, name)).join('') + `</g>`,
  text(DOC.x + DOC.w / 2, 372, 'what is written', 'f', 18),
  `<g data-id="deeper">${frame(DEEP, 'primitive')}` +
    DEEP_KIDS.map(([name, sig], i) => row(DEEP, DROW(i), sig, name)).join('') +
    flow(`M${DOC.x + DOC.w + 4},${ROW(0)} C${DOC.x + DOC.w + 30},${ROW(0)} ${DEEP.x - 30},${DEEP.y + 84} ${DEEP.x - 6},${DEEP.y + 84}`, 'pl-ah') +
    text(DEEP.x + DEEP.w / 2, 372, 'one step deeper', 'f', 18) + `</g>`,
].join('\n'))
