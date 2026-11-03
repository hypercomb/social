// locale — one name, many readings; your language is the direction you choose.
// A tile's name is its address and never changes; what is drawn is that name
// READ in the current locale (show-cell.drone.ts, displayNameFor): the tile's
// own title for the locale first (`/title`, a per-locale decoration on the
// tile — title.queen.ts), else the shared catalogs' `cell.<name>` (the shipped
// ja and es catalogs really read music as 音楽 and música, home as ホーム and
// inicio), else the name itself (no catalog knows meadow). `/language ja`
// sets the locale; `locale:changed` flushes the label atlas and every tile is
// drawn again in one pass. Names run across, as the opening's word direction
// does; languages run down, one more direction like any trait.
const { hex, LIT, CELL, marker, flow, text, svg } = require('../../../../presentation/plates/lib.cjs')

const COL = [100, 254, 408], CW = 144, CH = 58   // music, home, meadow
const cx = i => COL[i] + CW / 2
const ROW = { en: 126, ja: 208, es: 290 }
const FRAME = { x: 30, w: 536 }
// your hive: three tiles, drawn in the reading chosen
const HIVE = [[782, 164], [882, 164], [832, 251]], HR = 57

// an unseen bound, first in a group of several parts, so the group has one extent
const bound = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="none"/>`
const reading = (i, y, word, cls = 'k', attrs = CELL) =>
  `<rect x="${COL[i]}" y="${y - CH / 2}" width="${CW}" height="${CH}" rx="3" ${attrs}/>` + text(cx(i), y + 9, word, cls, 24)
const bare = (i, y) => reading(i, y, 'meadow', 'f', 'fill="none" stroke="var(--dim)" stroke-width="1.2" stroke-dasharray="5 6"')
const row = (id, y, words) => `<g data-id="${id}">${bound(FRAME.x, y - CH / 2, FRAME.w, CH)}${text(44, y + 8, id, 'm d', 24, 'start')}` +
  words.map((w, i) => reading(i, y, w)).join('') + `</g>`

module.exports = () => svg('three tiles, music, home and meadow, each read in English, Japanese and Spanish; one tile has its own Japanese words, one has no reading and shows its name; language ja chooses the Japanese row and your hive draws it', [
  `<defs>${marker('ll-ah')}</defs>`,
  // the names: the addresses, the same in every language
  `<g data-id="names">${['music', 'home', 'meadow'].map((n, i) => text(cx(i), 62, n, 'm hy', 20)).join('')}</g>`,
  // the chosen direction
  `<g data-id="pick">${bound(FRAME.x, ROW.ja - 70, HIVE[0][0] - FRAME.x, 110)}<rect x="${FRAME.x}" y="${ROW.ja - CH / 2 - 10}" width="${FRAME.w}" height="${CH + 20}" rx="4" fill="var(--honey-tint)" stroke="var(--honey)" stroke-width="1.5"/>` +
    flow(`M${FRAME.x + FRAME.w + 6},${ROW.ja} C${FRAME.x + FRAME.w + 50},${ROW.ja} ${HIVE[0][0] - 110},${HIVE[0][1] + 40} ${HIVE[0][0] - HR * 0.866 - 8},${HIVE[0][1] + 22}`, 'll-ah') +
    text(FRAME.x + FRAME.w + 82, ROW.ja - 24, 'language ja', 'm hy', 18) + `</g>`,
  // the readings, one row per language
  row('en', ROW.en, ['music', 'home']),
  row('ja', ROW.ja, ['音楽']),
  row('es', ROW.es, ['música', 'inicio']),
  // a tile's own words for one language come first
  `<g data-id="own">${reading(1, ROW.ja, 'わたしの家', 'k hy', 'fill="var(--panel)" stroke="var(--honey)" stroke-width="2"')}</g>`,
  // no reading anywhere: the name shows through
  `<g data-id="meadow">${bare(2, ROW.en)}${bare(2, ROW.ja)}${bare(2, ROW.es)}</g>`,
  // your hive, drawn in the chosen reading
  `<g data-id="hive">${bound(HIVE[0][0] - HR, HIVE[0][1] - HR, HIVE[1][0] - HIVE[0][0] + 2 * HR, 370 - HIVE[0][1] + HR)}${hex(...HIVE[0], HR, CELL)}${text(HIVE[0][0], HIVE[0][1] + 9, '音楽', 'k', 24)}` +
    hex(...HIVE[1], HR, LIT) + text(HIVE[1][0], HIVE[1][1] + 7, 'わたしの家', 'k', 18) +
    hex(...HIVE[2], HR, CELL) + text(HIVE[2][0], HIVE[2][1] + 7, 'meadow', 'k', 18) +
    text(HIVE[2][0], 352, 'your hive', 'k hy', 22) + `</g>`,
].join('\n'))
