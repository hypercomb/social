// debugging — four sentences, one place. Each column is one word of the
// module queen (hypercomb-essentials/src/assistant/module.queen.ts) and what
// it does. `module trials` lists the open trials on a zone: whose, what each
// touches (worker serveTrials). `module changes cards` opens one trial file by
// file, before and after (sandbox-change.view.ts, line-diff.ts). `module audit`
// has your own model read it from home, by signature, running none of it
// (module-audit.ts). `module take` makes that trial's layer a pick at its one
// path, held in the brood until `brood accept` (module-review.ts takeTrial).
// `module drop` unpicks the path, so the trunk's layer runs there again
// (runtime module-drafts.ts dropDraft). One path moves; the rest of the comb
// never does.
const { hex, CELL, STEEL, marker, beeDef, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

const COL = [140, 368, 596, 824]
const CHIP_W = 196, CHIP_Y = 40, CHIP_H = 52
const LABEL_Y = 332
const R = 30
const COMB = [[0, 0], [1.732, 0], [0.866, -1.5], [-0.866, -1.5], [-1.732, 0], [-0.866, 1.5], [0.866, 1.5]]
const PICKED = 3                       // the one place the change lands
const CY = 210

const area = cx => `<rect x="${cx - 110}" y="${CHIP_Y - 4}" width="220" height="${LABEL_Y - CHIP_Y + 18}" fill="none" stroke="none"/>`
const chip = (cx, word) => `<rect x="${cx - CHIP_W / 2}" y="${CHIP_Y}" width="${CHIP_W}" height="${CHIP_H}" rx="26" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.5"/>` +
  text(cx, CHIP_Y + 33, `<tspan class="k hy">module</tspan> ${word}`, 'm', 18)
const cell = (cx, i) => [cx + COMB[i][0] * R, CY + COMB[i][1] * R]

// a row of the trial listing
const row = (y, name, lit) => `<rect x="${COL[0] - 98}" y="${y}" width="196" height="44" rx="3" fill="var(--panel)" stroke="${lit ? 'var(--honey)' : 'var(--line)'}" stroke-width="${lit ? 2 : 1.2}"/>` +
  hex(COL[0] - 72, y + 22, 11, lit ? 'fill="var(--honey-fill)" fill-opacity=".55" stroke="var(--honey)" stroke-width="1.5"' : 'fill="none" stroke="var(--honey-deep)" stroke-width="1.2"') +
  text(COL[0] - 50, y + 28, name, lit ? 'm k hy' : 'm d', 20, 'start')

// the change, file by file: six lines, one taken out and one put in
const CARD = { x: COL[1] - 90, y: 118, w: 176, h: 178 }
const LINE_Y = i => CARD.y + 52 + i * 22
const LINE_W = [118, 92, 104, 110, 70, 96]
const bar = (i, fill) => `<rect x="${CARD.x + 34}" y="${LINE_Y(i) - 4}" width="${LINE_W[i]}" height="8" rx="2" fill="${fill}"/>`

module.exports = () => svg('four sentences, left to right: module trials lists the open trials and cards is chosen; module changes shows its file with one line out and one line in, and a bee reads it from home; module take lays that one change into one cell of your hive, held until you accept it; module drop puts that cell back as it ran before; every other cell stays as it was', [
  `<defs>${marker('db-ah')}${beeDef('db-bee')}</defs>`,
  // module trials: every open trial on the zone
  `<g data-id="trials">${area(COL[0])}${chip(COL[0], 'trials')}` +
    row(186, 'dark-theme', false) + row(242, 'faster-zoom', false) +
    text(COL[0], LABEL_Y, 'every open trial', 'd', 20) + `</g>`,
  `<g data-id="pick">${row(130, 'cards', true)}</g>`,
  // module changes: one trial, before and after
  `<g data-id="changes">${area(COL[1])}${chip(COL[1], 'changes')}` +
    `<rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${CARD.h}" rx="3" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.5"/>` +
    text(CARD.x + 16, CARD.y + 30, 'cards.ts', 'm f', 16, 'start') +
    [0, 1, 4, 5].map(i => bar(i, 'var(--line)')).join('') +
    text(COL[1], LABEL_Y, 'before and after', 'd', 20) + `</g>`,
  `<g data-id="diff"><rect x="${CARD.x + 4}" y="${LINE_Y(2) - 14}" width="${CARD.w - 8}" height="48" fill="none" stroke="none"/>` +
    text(CARD.x + 20, LINE_Y(2) + 6, '−', 'm st', 18) + bar(2, 'var(--steel)') +
    `<path d="M${CARD.x + 30},${LINE_Y(2)} H${CARD.x + 34 + LINE_W[2] + 4}" stroke="var(--ink)" stroke-width="1.5"/>` +
    text(CARD.x + 20, LINE_Y(3) + 6, '+', 'm hy', 18) + bar(3, 'var(--honey)') + `</g>`,
  // module audit: your own model reads it, from home, and runs nothing
  `<g data-id="audit"><use href="#db-bee" transform="translate(${CARD.x + CARD.w + 2},${CARD.y + 44}) scale(1.7)"/></g>`,
  // module take: that one change lands in one cell, held until you accept it
  `<g data-id="take">${area(COL[2])}${chip(COL[2], 'take')}` +
    hex(...cell(COL[2], PICKED), R, 'fill="var(--honey-fill)" fill-opacity=".2" stroke="var(--honey)" stroke-width="2" stroke-dasharray="6 5"') +
    text(COL[2], LABEL_Y, 'held until you accept', 'd', 20) +
    flow(`M${CARD.x + 34 + LINE_W[3] + 10},${LINE_Y(3)} C${COL[1] + 120},${LINE_Y(3)} ${COL[2] - 64},${CY - 20} ${cell(COL[2], PICKED)[0] - R * 0.9},${cell(COL[2], PICKED)[1] + 4}`, 'db-ah') + `</g>`,
  // module drop: the same cell runs what it ran before
  `<g data-id="drop">${area(COL[3])}${chip(COL[3], 'drop')}` +
    hex(...cell(COL[3], PICKED), R, STEEL) +
    text(COL[3], LABEL_Y, 'as it ran before', 'd', 20) + `</g>`,
  // every other cell: untouched in both
  `<g data-id="rest">${[2, 3].map(c => COMB.map((_, i) => i === PICKED ? '' : hex(...cell(COL[c], i), R, CELL)).join('')).join('')}</g>`,
].join('\n'))
