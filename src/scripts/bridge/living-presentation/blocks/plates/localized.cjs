// localized — every word the hive shows is looked up, in layers. Three words of
// the hive's own controls (save, share, sync), read in Japanese. The
// runtime resolves each key top-down (hypercomb-runtime/src/i18n.service.ts,
// #resolve): your own override first (`i18n-override`), then the catalogs —
// the shipped one, and the community's words healed in only where it had a
// gap (healTranslations). The shipped Japanese catalog really lacks
// `controls.sync`, so English shows through until the community fills it.
// Read down each column: the first word found is the one you see.
const { LIT, CELL, STEEL, text, svg } = require('../../../../presentation/plates/lib.cjs')

const COL = [240, 470, 700]                // left edge of each word's column
const CW = 210, CH = 56
const SHEET = { x: 222, w: 706 }
const cx = i => COL[i] + CW / 2
const ROW = { yours: 58, community: 136, shipped: 214, seen: 326 }
const RULE = 268

const cell = (i, y, attrs, word, cls, h = CH) =>
  `<rect x="${COL[i]}" y="${y - h / 2}" width="${CW}" height="${h}" rx="3" ${attrs}/>` + text(cx(i), y + 10, word, cls, 30)
// a layer: a clear sheet the width of the line; where it holds no word, you see through it
const sheet = y => `<rect x="30" y="${y - CH / 2 - 9}" width="${SHEET.x + SHEET.w - 30}" height="${CH + 18}" fill="none" stroke="none"/>` +
  `<rect x="${SHEET.x}" y="${y - CH / 2 - 9}" width="${SHEET.w}" height="${CH + 18}" rx="4" fill="none" stroke="var(--line)" stroke-width="1"/>`
const label = (y, s, cls) => text(36, y + 8, s, cls, 24, 'start')
const SHIPPED = 'fill="var(--panel)" stroke="var(--line-strong)" stroke-width="1.5"'

module.exports = () => svg('three of the hive’s words read in Japanese, in three layers: your own word on top, the community’s words filling a gap, the shipped words beneath; read down each column, the first word found is the one you see', [
  // the layers, top to bottom in the order they are asked
  `<g data-id="yours">${sheet(ROW.yours)}${label(ROW.yours, 'yours', 'k hy')}${cell(0, ROW.yours, CELL, '保存する', 'k')}</g>`,
  `<g data-id="community">${sheet(ROW.community)}${label(ROW.community, 'community', 'k st')}${cell(2, ROW.community, STEEL, '同期', 'k')}</g>`,
  `<g data-id="shipped">${sheet(ROW.shipped)}${label(ROW.shipped, 'shipped', 'k d')}` +
    cell(0, ROW.shipped, SHIPPED, '保存', 'd') + cell(1, ROW.shipped, SHIPPED, '共有', 'd') +
    `<rect x="${COL[2]}" y="${ROW.shipped - CH / 2}" width="${CW}" height="${CH}" rx="3" fill="none" stroke="var(--dim)" stroke-width="1.2" stroke-dasharray="5 6"/>` +
    text(cx(2), ROW.shipped + 9, 'sync', 'm f', 26) + `</g>`,
  // the sum: what you see
  `<path d="M${SHEET.x},${RULE} H${SHEET.x + SHEET.w}" stroke="var(--line-strong)" stroke-width="1.5"/>`,
  `<g data-id="seen"><rect x="30" y="${ROW.seen - 40}" width="${SHEET.x + SHEET.w - 30}" height="80" fill="none" stroke="none"/>${label(ROW.seen, 'you see', 'k hy')}` +
    [['保存する', 0], ['共有', 1], ['同期', 2]].map(([w, i]) => cell(i, ROW.seen, LIT, w, 'k', 66)).join('') + `</g>`,
].join('\n'))
