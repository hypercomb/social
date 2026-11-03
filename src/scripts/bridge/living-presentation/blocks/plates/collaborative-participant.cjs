// the participant — take it whole, or one piece. Three hives, each served from
// its own domain (the same you, ann and bo as the opening's spread). In the
// middle, ann's creation, cards: a tile and the pieces under it, each piece at
// its own path. Bo takes it whole (acquire with takeAll: every piece, the same
// signatures, so it runs as she made it). You run your own build of cards
// (steel: your pieces) and take ONE piece of hers (acquire.ts pickRevision:
// "take one revision at one path"); it lands at the same path in your build,
// and every other piece of yours stays put. Colour is origin: honey is ann's
// work wherever it is held, steel is yours. Then you commit (module-drafts.ts
// commitSelection): the trunk with the pick laid in is re-minted to a new
// root, its own signature, and the change record names which path came from
// which root (`taken`) — the seal on your build.
const { hex, LIT, CELL, STEEL, marker, markerS, flow, text, svg, check } = require('../../../../presentation/plates/lib.cjs')

const PY0 = 28                               // the domain pills
const RY = 150, PY = 248, RR = 36, PR = 27, PX = 62
const COLS = { bo: 160, ann: 480, you: 800 }

const pill = (cx, label, cls) =>
  `<rect x="${cx - 112}" y="${PY0}" width="224" height="48" rx="24" fill="var(--panel)" stroke="var(--steel)" stroke-width="1.5"/>` +
  text(cx, PY0 + 31, label, `m ${cls}`, 20)
const at = (cx, k) => [cx + k * PX, PY]
const stems = (cx) => [-1, 0, 1].map(k => `<path d="M${cx + k * PX * 0.5},${RY + RR - 2} L${cx + k * PX},${PY - PR + 2}" stroke="var(--line-strong)" stroke-width="1.2"/>`).join('')
// a build of cards: its tile and the pieces under it; `styles` per piece, null leaves the slot to another group
const tree = (cx, root, styles) =>
  stems(cx) + hex(cx, RY, RR, root) + text(cx, RY + 7, 'cards', 'k', 20) +
  styles.map((s, k) => s ? hex(...at(cx, k - 1), PR, s) : '').join('')

const [LX, LY] = at(COLS.you, 1)             // the path the piece lands at, in your build
const [AX, AY] = at(COLS.ann, 1)             // the same path in ann's

module.exports = () => svg('ann serves cards from her own domain; bo takes it whole, every piece hers; you keep your own build of cards and take one piece of hers, which lands at the same place while your other pieces stay; committing seals your mix as a build of its own', [
  `<defs>${marker('pa-ah')}${markerS('pa-as')}</defs>`,
  // three hives, each on its own domain
  `<g data-id="ann">${pill(COLS.ann, 'ann.example', 'st')}${tree(COLS.ann, CELL, [CELL, CELL, LIT])}${text(COLS.ann, 356, 'ann made it', 'd', 20)}</g>`,
  `<g data-id="bo">${pill(COLS.bo, 'bo.example', 'st')}${tree(COLS.bo, CELL, [CELL, CELL, LIT])}${text(COLS.bo, 356, 'taken whole', 'd', 20)}</g>`,
  `<g data-id="you">${pill(COLS.you, 'yourname.com', 'hy')}${tree(COLS.you, STEEL, [STEEL, STEEL, null])}${text(COLS.you, 356, 'your own build', 'd', 20)}</g>`,
  // taking it whole: every piece, the same signatures
  `<g data-id="whole"><path d="M${COLS.ann - RR - 10},${RY} H${COLS.bo + RR + 14}" stroke="var(--steel)" stroke-width="1.5" marker-end="url(#pa-as)"/></g>`,
  // taking one piece: that piece alone, carried to the same place in your build
  `<g data-id="piece">${flow(`M${AX + 8},${AY + PR + 4} C${AX + 70},${AY + 74} ${LX - 70},${LY + 74} ${LX - 10},${LY + PR + 6}`, 'pa-ah')}</g>`,
  // where it lands: ann's piece, at its own path, among yours
  `<g data-id="landed">${hex(LX, LY, PR, LIT)}</g>`,
  // commit: your mix becomes a build of its own, sealed with its own signature
  `<g data-id="commit"><rect x="${COLS.you - 118}" y="${RY - RR - 14}" width="236" height="${PY + PR - RY + RR + 28}" rx="18" fill="none" stroke="var(--honey)" stroke-width="1.8" stroke-dasharray="6 6"/>` +
    hex(COLS.you + 118, RY - RR - 14, 17, LIT) + check(COLS.you + 117, RY - RR - 14) + `</g>`,
].join('\n'))
