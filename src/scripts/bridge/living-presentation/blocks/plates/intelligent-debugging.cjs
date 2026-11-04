// debugging — five words, said in order, and one place that moves. Each
// column is one word of the module queen
// (hypercomb-essentials/src/assistant/module.queen.ts) and what it does.
// `module trials` lists the open trials on a zone: whose, what each changes.
// `module changes cards` opens one trial file by file, before and after
// (sandbox-change.view.ts). `module audit` has your own model read every
// module it would bring, by signature, set against what it replaces here,
// never written and never run (module-audit.ts). `module take` makes that
// trial's layer a pick at the path it changed, made by hand, its new code held
// in the brood until `brood accept` (module-review.ts takeTrial); take refuses
// a root other than the one the audit read. `module drop` unpicks the path, so
// after a reload the package runs there as it was (runtime module-drafts.ts).
// One path moves; the rest of the comb never does.
const { hex, CELL, STEEL, marker, markerS, beeDef, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

const COL = [112, 296, 480, 664, 848]
const CHIP_W = 172, CHIP_Y = 34, CHIP_H = 50
const LABEL_Y = 340
const R = 26
const COMB = [[0, 0], [1.732, 0], [0.866, -1.5], [-0.866, -1.5], [-1.732, 0], [-0.866, 1.5], [0.866, 1.5]]
const PICKED = 3                       // the one place the change lands
const CY = 214

const chip = (cx, word) => `<rect x="${cx - CHIP_W / 2}" y="${CHIP_Y}" width="${CHIP_W}" height="${CHIP_H}" rx="25" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.5"/>` +
  text(cx, CHIP_Y + 31, `<tspan class="d" font-size="16">module</tspan> <tspan class="k hy">${word}</tspan>`, 'm', 21)
const cell = (cx, i) => [cx + COMB[i][0] * R, CY + COMB[i][1] * R]
const label = (cx, s) => text(cx, LABEL_Y, s, 'd', 19)
// each column's reach, invisible: its label is measured against this
const area = cx => `<rect x="${cx - 90}" y="${CHIP_Y - 4}" width="180" height="${LABEL_Y - CHIP_Y + 18}" fill="none" stroke="none"/>`

// a row of the trial listing
const ROW_W = 160, ROW_H = 42
const row = (y, name, lit) => `<rect x="${COL[0] - ROW_W / 2}" y="${y}" width="${ROW_W}" height="${ROW_H}" rx="3" fill="var(--panel)" stroke="${lit ? 'var(--honey)' : 'var(--line)'}" stroke-width="${lit ? 2 : 1.2}"/>` +
  hex(COL[0] - ROW_W / 2 + 22, y + ROW_H / 2, 10, lit ? 'fill="var(--honey-fill)" fill-opacity=".55" stroke="var(--honey)" stroke-width="1.5"' : 'fill="none" stroke="var(--honey-deep)" stroke-width="1.2"') +
  text(COL[0] - ROW_W / 2 + 42, y + 27, name, lit ? 'm k hy' : 'm d', 18, 'start')

// the change, file by file: six lines, one taken out and one put in
const CARD = { x: COL[1] - 74, y: 112, w: 148, h: 184 }
const LINE_Y = i => CARD.y + 56 + i * 22
const LINE_W = [96, 74, 88, 92, 58, 80]
const bar = (i, fill) => `<rect x="${CARD.x + 30}" y="${LINE_Y(i) - 4}" width="${LINE_W[i]}" height="8" rx="2" fill="${fill}"/>`

const [PX, PY] = cell(COL[3], PICKED)
const [DX, DY] = cell(COL[4], PICKED)
const BEE = { x: COL[2] + 14, y: 150 }

module.exports = () => svg('five sentences, left to right: module trials lists the open trials and cards is chosen; module changes shows its file with one line out and one line in; module audit has your own bee read it without running it; module take lays that one change into one cell of your hive, held until you accept it; module drop puts that cell back as it was; every other cell stays as it was', [
  `<defs>${marker('db-ah')}${markerS('db-as')}${beeDef('db-bee')}</defs>`,
  // module trials: every open trial on the zone
  `<g data-id="trials">${area(COL[0])}${chip(COL[0], 'trials')}` +
    row(172, 'dark-mode', false) + row(226, 'new-menu', false) +
    label(COL[0], 'every open trial') + `</g>`,
  `<g data-id="pick">${row(118, 'cards', true)}</g>`,
  // module changes: one trial, before and after
  `<g data-id="changes">${area(COL[1])}${chip(COL[1], 'changes')}` +
    `<rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${CARD.h}" rx="3" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.5"/>` +
    text(CARD.x + 16, CARD.y + 30, 'cards.ts', 'm f', 16, 'start') +
    [0, 1, 4, 5].map(i => bar(i, 'var(--line)')).join('') +
    label(COL[1], 'before and after') + `</g>`,
  `<g data-id="diff"><rect x="${CARD.x + 4}" y="${LINE_Y(2) - 14}" width="${CARD.w - 8}" height="48" fill="none" stroke="none"/>` +
    text(CARD.x + 17, LINE_Y(2) + 6, '−', 'm st', 18) + bar(2, 'var(--steel)') +
    `<path d="M${CARD.x + 26},${LINE_Y(2)} H${CARD.x + 34 + LINE_W[2]}" stroke="var(--ink)" stroke-width="1.5"/>` +
    text(CARD.x + 17, LINE_Y(3) + 6, '+', 'm hy', 18) + bar(3, 'var(--honey)') + `</g>`,
  // module audit: your own model reads it, from your own hive, and runs nothing
  `<g data-id="audit">${area(COL[2])}${chip(COL[2], 'audit')}` +
    `<path d="M${BEE.x - 30},${BEE.y + 14} L${CARD.x + CARD.w + 8},${LINE_Y(2)} M${BEE.x - 30},${BEE.y + 18} L${CARD.x + CARD.w + 8},${LINE_Y(3) - 6}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5" stroke-dasharray="3 6"/>` +
    `<use href="#db-bee" transform="translate(${BEE.x},${BEE.y}) scale(2.2)"/>` +
    label(COL[2], 'read, never run') + `</g>`,
  // module take: that one change lands in one cell, held until you accept it
  `<g data-id="take">${area(COL[3])}${chip(COL[3], 'take')}` +
    hex(PX, PY, R, 'fill="var(--honey-fill)" fill-opacity=".22" stroke="var(--honey)" stroke-width="2" stroke-dasharray="6 5"') +
    label(COL[3], 'held, not yet run') +
    flow(`M${CARD.x + CARD.w + 8},${LINE_Y(3) + 4} C${COL[2] - 20},${LINE_Y(3) + 70} ${PX - 100},${PY + 40} ${PX - R * 0.95},${PY + 6}`, 'db-ah') + `</g>`,
  // module drop: the same cell runs the package as it was
  `<g data-id="drop">${area(COL[4])}${chip(COL[4], 'drop')}` +
    hex(...cell(COL[4], PICKED), R, STEEL) +
    `<path d="M${DX + 34},${DY - 20} C${DX + 34},${DY - 58} ${DX - 2},${DY - 66} ${DX - 4},${DY - R - 8}" fill="none" stroke="var(--steel)" stroke-width="1.8" marker-end="url(#db-as)"/>` +
    label(COL[4], 'as it was') + `</g>`,
  // every other cell: untouched in both
  `<g data-id="rest">${[3, 4].map(c => COMB.map((_, i) => i === PICKED ? '' : hex(...cell(COL[c], i), R, CELL)).join('')).join('')}</g>`,
].join('\n'))
