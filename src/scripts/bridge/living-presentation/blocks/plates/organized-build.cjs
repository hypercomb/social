// the build — a pass of work sealed under one name. On the left, a branch of
// this presentation: the opening and its seven moves, three of them just
// changed by one pass. `builds seven-moves` seals the whole branch: one
// signature (sealSubtree, the merkle root of every layer under it) and the
// name, kept as one record on the branch (builds-slot.ts). On the right, the
// branch's versions climb as the opening's columns do, each marked with its
// seal; two are named builds. Sealing again with nothing changed adds nothing
// (mintBuildRecord compares seals). `builds revert first-cut` writes the old
// tree back as the newest step (seal-restore.ts): the one movement, forward.
const { hex, LIT, CELL, marker, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

// the branch: the opening above its seven moves
const BX = 150, BY = 100, BR = 50
const MX = i => BX + (i - 3) * 36, MY = 224, MR = 16
const CHANGED = [1, 3, 5]
// the seal
const SX = 380, SY = 204, SR = 46
// the branch's versions, oldest at the bottom
const CX = 708, CR = 28
const VY = [334, 266, 198, 130]
const SEALS = ['7d1e', '2b90', 'a41c', '7d1e']
const TAG_END = 652

const tag = (cy, label, w, dashed = false) =>
  `<rect x="${TAG_END - w}" y="${cy - 16}" width="${w}" height="32" rx="16" fill="var(--bg)" stroke="var(--honey${dashed ? '' : '-deep'})" stroke-width="1.5"${dashed ? ' stroke-dasharray="4 5"' : ''}/>` +
  text(TAG_END - w / 2, cy + 6, label, dashed ? 'm hy' : 'm d', 16)
const box = (i, w) => `<rect x="${TAG_END - w}" y="${VY[i] - CR}" width="${CX + CR - (TAG_END - w)}" height="${2 * CR}" fill="none" stroke="none"/>`
const step = (i, attrs, cls = 'm f') => hex(CX, VY[i], CR, attrs) + text(CX, VY[i] + 6, SEALS[i], cls, 16)

module.exports = () => svg('the opening and its seven moves, three changed by one pass, sealed by builds seven-moves into one signature kept as a named build; the branch’s versions climb on the right, two of them named; builds revert writes first-cut back as the newest step', [
  `<defs>${marker('ob-ah')}</defs>`,
  // the branch
  `<g data-id="branch"><rect x="${MX(0) - MR - 2}" y="${BY - BR}" width="${MX(6) - MX(0) + 2 * MR + 4}" height="${MY + 70 - BY + BR}" fill="none" stroke="none"/>` +
    [0, 1, 2, 3, 4, 5, 6].map(i => `<path d="M${BX},${BY + BR} L${MX(i)},${MY - MR}" stroke="var(--honey-deep)" stroke-width="1.2" stroke-opacity=".7"/>`).join('') +
    hex(BX, BY, BR, CELL) + text(BX, BY + 6, 'opening', 'k', 18) +
    [0, 2, 4, 6].map(i => hex(MX(i), MY, MR, CELL)).join('') +
    text(BX, MY + 60, 'seven moves', 'd', 18) + `</g>`,
  `<g data-id="changed">${CHANGED.map(i => hex(MX(i), MY, MR, 'fill="var(--honey-fill)" fill-opacity=".55" stroke="var(--honey)" stroke-width="2"')).join('')}</g>`,
  // the word, and the seal it makes
  `<g data-id="say"><rect x="${SX - 112}" y="40" width="224" height="44" rx="3" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
    text(SX, 68, 'builds seven-moves', 'm k', 18) +
    `<path d="M${SX},86 V${SY - SR - 4}" stroke="var(--line-strong)" stroke-width="1.2"/></g>`,
  `<g data-id="seal"><path d="M${MX(6) + MR + 8},${MY - 4} C${MX(6) + 50},${MY - 14} ${SX - SR - 30},${SY} ${SX - SR * 0.866 - 4},${SY}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5"/>` +
    hex(SX, SY, SR, LIT) + text(SX, SY + 8, 'seal', 'k hy', 22) +
    text(SX, SY + SR + 30, 'a41c…', 'm hy', 18) +
    `<path d="M${SX + SR * 0.866 + 4},${SY} C${SX + 80},${SY} ${TAG_END - 150},${VY[2]} ${TAG_END - 132},${VY[2]}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5"/></g>`,
  `<g data-id="again"><rect x="${SX - 100}" y="${SY + SR + 48}" width="200" height="74" fill="none" stroke="none"/>` +
    text(SX, SY + SR + 72, 'sealed again: a41c…', 'm f', 16) +
    text(SX, SY + SR + 100, 'nothing added', 'd', 18) + `</g>`,
  // the branch's versions: each step marked by its seal, two of them named
  text(CX - 30, 80, 'versions of opening', 'f', 18),
  `<g data-id="steps">${step(1, CELL)}</g>`,
  `<g data-id="first-cut">${box(0, 112)}${step(0, CELL)}${tag(VY[0], 'first-cut', 112)}</g>`,
  `<g data-id="seven-moves">${box(2, 132)}${step(2, CELL)}${tag(VY[2], 'seven-moves', 132)}</g>`,
  // revert: the old tree, written forward as the newest step
  `<g data-id="revert"><rect x="${TAG_END - 112}" y="${VY[3] - CR - 4}" width="${CX + 160 - (TAG_END - 112)}" height="${VY[0] - VY[3] + 2 * CR + 8}" fill="none" stroke="none"/>` +
    step(3, LIT, 'm hy') + tag(VY[3], 'first-cut', 112, true) +
    flow(`M${CX + CR * 0.866 + 6},${VY[0] - 6} C${CX + 96},${VY[0] - 30} ${CX + 96},${VY[3] + 30} ${CX + CR * 0.866 + 10},${VY[3] + 8}`, 'ob-ah') +
    text(CX + 92, (VY[0] + VY[3]) / 2 + 6, 'revert', 'k hy', 18, 'start') + `</g>`,
].join('\n'))
