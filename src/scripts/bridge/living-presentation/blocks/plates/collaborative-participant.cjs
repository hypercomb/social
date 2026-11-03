// the participant — take it whole, or one piece. Three hives, each served from
// its own domain (the same you, ann and bo as the opening's spread). In the
// middle, ann's creation: a tile and the pieces under it. Bo takes it whole
// (acquire with takeAll: every piece, the same signatures, so it runs as she
// made it). You take one piece at one path (acquire.ts pickRevision: "take one
// revision at one path") and seat it among pieces that are yours. The deck
// piece is lit wherever it is held, because it is the same bytes. Then ann
// changes the deck: new bytes, a new signature, a new revision stacked behind
// hers. Bo and you still name the old one; each hive only shows a notice, and
// each chooses for itself (using-a-creation.md: upgrade or skip).
const { hex, LIT, CELL, marker, markerS, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

const RY = 170, PY = 268, RR = 36, PR = 27, PX = 62
const COLS = { bo: 160, ann: 480, you: 800 }

const pill = (cx, label) =>
  `<rect x="${cx - 112}" y="36" width="224" height="48" rx="24" fill="var(--panel)" stroke="var(--steel)" stroke-width="1.5"/>` +
  text(cx, 66, label, 'm st', 18)
// a creation: its tile, three pieces under it; `lit` is the index of the shared piece
const tree = (cx, name, lit, rootStyle = CELL, own = CELL) =>
  [-1, 0, 1].map(k => `<path d="M${cx + k * PX * 0.5},${RY + RR - 2} L${cx + k * PX},${PY - PR + 2}" stroke="var(--line-strong)" stroke-width="1.2"/>`).join('') +
  hex(cx, RY, RR, rootStyle) + text(cx, RY + 6, name, 'k', 18) +
  [-1, 0, 1].map((k, i) => hex(cx + k * PX, PY, PR, i === lit ? LIT : own)).join('')
const badge = (cx) => `<circle cx="${cx + 30}" cy="${RY - 32}" r="11" fill="var(--honey)" stroke="var(--bg)" stroke-width="3"/>`

module.exports = () => svg('ann serves a creation from her own domain; bo takes it whole, you take one piece of it into your own; when ann changes that piece, bo and you each get a notice and choose for yourselves', [
  `<defs>${marker('pa-ah')}${markerS('pa-as')}</defs>`,
  // ann's new revision of the deck, stacked behind the one she first served
  `<g data-id="v2">${hex(COLS.ann + PX + 14, PY - 14, PR, LIT)}</g>`,
  // three hives, each on its own domain
  `<g data-id="ann"><rect x="${COLS.ann - 112}" y="36" width="224" height="300" fill="none" stroke="none"/>` +
    pill(COLS.ann, 'ann.example') + tree(COLS.ann, 'cards', 2) + text(COLS.ann, 346, 'ann made it', 'd', 18) + `</g>`,
  `<g data-id="bo"><rect x="${COLS.bo - 112}" y="36" width="224" height="300" fill="none" stroke="none"/>` +
    pill(COLS.bo, 'bo.example') + tree(COLS.bo, 'cards', 2) + text(COLS.bo, 346, 'taken whole', 'd', 18) + `</g>`,
  `<g data-id="you"><rect x="${COLS.you - 112}" y="36" width="224" height="300" fill="none" stroke="none"/>` +
    pill(COLS.you, 'yourname.com') + tree(COLS.you, 'home', 0) + text(COLS.you, 346, 'one piece taken', 'd', 18) + `</g>`,
  // taking it whole: every piece, the same signatures
  `<g data-id="whole"><path d="M${COLS.ann - RR - 10},${RY} H${COLS.bo + RR + 12}" stroke="var(--steel)" stroke-width="1.5" marker-end="url(#pa-as)"/></g>`,
  // taking one piece: that piece alone, set among your own
  `<g data-id="piece">${flow(`M${COLS.ann + PX + 6},${PY + PR + 6} C${COLS.ann + PX + 50},${PY + 66} ${COLS.you - PX - 60},${PY + 66} ${COLS.you - PX - 10},${PY + PR + 8}`, 'pa-ah')}</g>`,
  // a notice on each hive that holds the old piece
  `<g data-id="notice-bo">${badge(COLS.bo)}</g>`,
  `<g data-id="notice-you">${badge(COLS.you)}</g>`,
].join('\n'))
