// the layer — a tile, written down. On the left, what you see: simple and the
// three tiles under it (its real children in the presentation). In the middle,
// what is written: one small document, the name first and then each child by
// its signature, in order (canonical-layer.ts). Signed, it gets one signature.
// Add a child and a second document is written, with a signature of its own;
// the first is kept, untouched. The hex is real: each child stands for the
// empty layer {"name":…}, and each bar is sha256 of the canonical document
// drawn beside it (the fourth child, tour, only in the second).
const { hex, LIT, CELL, GHOST, marker, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

// the tile as you see it
const PX = 150, PY = 92, PR = 44, CR = 30, CY = 212
const KIDS = [['primitive', 70, 'c158a4d9…'], ['act', 150, '95474072…'], ['opening', 230, '5c5c6bb9…']]
// the document
const DOC = { x: 296, y: 40, w: 304, h: 296 }
const ROW = y => DOC.y + 128 + y * 42
// the signature, and the two documents it names
const SX = 660, SY = 188, SR = 38
const BAR = { x: 728, w: 192, h: 48 }
const OLD = 252, NEW = 124

const row = (i, sig, name, attrs = CELL, cls = 'm') =>
  hex(DOC.x + 30, ROW(i), 9, attrs) + text(DOC.x + 50, ROW(i) + 6, sig, cls, 18, 'start') + text(DOC.x + 190, ROW(i) + 6, name, 'f', 18, 'start')
const bar = (cy, label, sig, stroke, cls) =>
  `<rect x="${BAR.x}" y="${cy - BAR.h / 2}" width="${BAR.w}" height="${BAR.h}" rx="3" fill="var(--panel)" stroke="${stroke}" stroke-width="1.5"/>` +
  text(BAR.x + 16, cy + 5, label, 'm f', 16, 'start') + text(BAR.x + BAR.w - 16, cy + 7, sig, cls, 20, 'end')

module.exports = () => svg('simple and its three children, written as one document: the name, then each child by its signature in order; signed, it has one signature; adding a child writes a second document with its own signature, and the first is kept', [
  `<defs>${marker('pl-ah')}</defs>`,
  `<g data-id="tile"><rect x="34" y="40" width="234" height="262" fill="none" stroke="none"/>` +
    KIDS.map(([, x]) => `<path d="M${PX},${PY + PR} L${x},${CY - CR}" stroke="var(--honey-deep)" stroke-width="1.2"/>`).join('') +
    hex(PX, PY, PR, CELL) + text(PX, PY + 6, 'simple', 'k', 18) +
    KIDS.map(([name, x]) => hex(x, CY, CR, CELL) + text(x, CY + CR + 28, name, 'd', 18)).join('') + `</g>`,
  text(151, 336, 'what you see', 'f', 18),
  `<g data-id="doc"><rect x="${DOC.x}" y="${DOC.y}" width="${DOC.w}" height="${DOC.h}" rx="3" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
    text(DOC.x + 22, DOC.y + 40, 'name', 'm d', 18, 'start') + text(DOC.x + 98, DOC.y + 40, 'simple', 'm k', 18, 'start') +
    `<path d="M${DOC.x + 16},${DOC.y + 60} H${DOC.x + DOC.w - 16}" stroke="var(--line)" stroke-width="1"/>` +
    text(DOC.x + 22, DOC.y + 92, 'children', 'm d', 18, 'start') + `</g>`,
  `<g data-id="kids"><rect x="${DOC.x + 12}" y="${ROW(0) - 20}" width="${DOC.w - 24}" height="124" rx="2" fill="none" stroke="none"/>` +
    KIDS.map(([name, , sig], i) => row(i, sig, name)).join('') + `</g>`,
  `<g data-id="added"><rect x="${DOC.x + 12}" y="${ROW(3) - 19}" width="${DOC.w - 24}" height="38" rx="2" fill="var(--honey-tint)" stroke="var(--honey-deep)" stroke-width="1" stroke-dasharray="4 5"/>` +
    row(3, '0cf4e05f…', 'tour', LIT, 'm hy') + `</g>`,
  text(DOC.x + DOC.w / 2, 370, 'what is written', 'f', 18),
  `<g data-id="sign"><path d="M${DOC.x + DOC.w + 4},${SY} H${SX - SR * 0.866 - 4}" stroke="var(--honey-deep)" stroke-width="1.5"/>` +
    hex(SX, SY, SR, LIT) + text(SX, SY + 7, 'sign()', 'm k hy', 18) + `</g>`,
  `<g data-id="old">${bar(OLD, 'kept', '9898158a…', 'var(--line-strong)', 'm k')}` +
    flow(`M${SX + SR * 0.866 + 2},${SY + 12} C${BAR.x - 30},${SY + 22} ${BAR.x - 34},${OLD} ${BAR.x - 6},${OLD}`, 'pl-ah') + `</g>`,
  `<g data-id="new">${bar(NEW, 'new', '792f0b1e…', 'var(--honey)', 'm k hy')}` +
    `<path d="M${SX + SR * 0.866 + 2},${SY - 12} C${BAR.x - 30},${SY - 22} ${BAR.x - 34},${NEW} ${BAR.x - 6},${NEW}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5"/></g>`,
].join('\n'))
