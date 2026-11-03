// translating — the community's loop, by its three words
// (hypercomb-essentials/src/commands/language.queen.ts). Ann, a translator,
// wrote the word the shipped Japanese catalog lacks (`i18n-override`, as on the
// localized plate: sync → 同期). `language offer ja @host` puts her own words as
// one catalog, ships it, and names it in her signed index as i18n:ja
// (community-translations.ts, publishCatalog). The host lists every catalog for
// the locale at sign('i18n:ja'), re-reading each index before it shows one
// (worker serveTranslations). `language sync` reads the hosts you follow,
// believes a catalog only when its bytes hash to its name (readCatalog), and
// fills only the keys your locale lacks (healTranslations) — the one movement,
// in honey. `language missing @host` says, under your key, what is still
// lacking, and the host lists it where a translator sees the demand.
const { hex, LIT, STEEL, marker, markerS, flow, check, text, svg, server } = require('../../../../presentation/plates/lib.cjs')

const ANN = [150, 160], YOU = [810, 160], R = 64
const HOST = { x: 420, y: 112, w: 120 }     // three rows: the catalogs it lists
const HX = HOST.x + HOST.w / 2

// a catalog: a card of words, its seal a small honey hexagon
const catalog = (x, y) => `<rect x="${x}" y="${y}" width="46" height="36" rx="3" fill="var(--bg)" stroke="var(--line-strong)" stroke-width="1.2"/>` +
  `<path d="M${x + 9},${y + 12} H${x + 31} M${x + 9},${y + 20} H${x + 36} M${x + 9},${y + 28} H${x + 26}" stroke="var(--line-strong)" stroke-width="2"/>` +
  hex(x + 44, y + 34, 9, LIT)

module.exports = () => svg('a translator offers her own words as a signed catalog on a host; the host lists the catalogs it has checked; your hive syncs from it and fills only the words it lacks, and tells the host which words are still missing', [
  `<defs>${marker('lt-ah')}${markerS('lt-as')}</defs>`,
  // the translator's hive, with the word she wrote
  `<g data-id="ann">${hex(...ANN, R, STEEL)}${text(ANN[0], ANN[1] + 10, '同期', 'k', 28)}` +
    text(ANN[0], ANN[1] + R + 38, 'ann', 'k st', 22) + text(ANN[0], ANN[1] + R + 64, 'a translator', 'd', 20) + `</g>`,
  // offer: her words, one signed catalog, to the host she names
  `<g data-id="offer"><rect x="${ANN[0] + R}" y="44" width="${HOST.x - ANN[0] - R - 6}" height="${ANN[1] - 44}" fill="none" stroke="none"/><path d="M${ANN[0] + R * 0.866 + 8},${ANN[1] - 12} C${ANN[0] + 140},${ANN[1] - 44} ${HOST.x - 80},${ANN[1] - 44} ${HOST.x - 10},${ANN[1] - 18}" fill="none" stroke="var(--steel)" stroke-width="1.5" marker-end="url(#lt-as)"/>` +
    catalog(266, 92) + text(292, 70, 'language offer', 'm', 20) + `</g>`,
  // the host: the catalogs it lists for the language, each checked
  `<g data-id="host">${server(HOST.x, HOST.y, HOST.w)}` +
    [0, 1, 2].map(i => check(HOST.x + HOST.w - 22, HOST.y + i * 34 + 13)).join('') +
    text(HX, HOST.y - 20, 'i18n:ja', 'm hy', 20) + text(HX, HOST.y + 126, 'host', 'st', 22) + `</g>`,
  // sync: the one movement — checked words into the gap
  `<g data-id="sync">${flow(`M${HOST.x + HOST.w + 10},${ANN[1] - 18} C${HOST.x + HOST.w + 80},${ANN[1] - 44} ${YOU[0] - 140},${YOU[1] - 44} ${YOU[0] - R * 0.866 - 10},${YOU[1] - 12}`, 'lt-ah')}` +
    text(668, 70, 'language sync', 'm hy', 20) + `</g>`,
  // your hive: the gap filled
  `<g data-id="you">${hex(...YOU, R, LIT)}${text(YOU[0], YOU[1] + 10, '同期', 'k', 28)}` +
    text(YOU[0], YOU[1] + R + 38, 'your hive', 'k hy', 22) + text(YOU[0], YOU[1] + R + 64, 'a gap filled', 'd', 20) + `</g>`,
  // missing: what you still lack, told to the host, where translators see it
  `<g data-id="missing"><path d="M${YOU[0] - 40},${YOU[1] + R + 82} C${YOU[0] - 120},${370} ${HX + 90},${370} ${HX + 34},${HOST.y + 134}" fill="none" stroke="var(--steel)" stroke-width="1.5" stroke-dasharray="5 6" marker-end="url(#lt-as)"/>` +
    `<path d="M${HX - 34},${HOST.y + 134} C${HX - 90},${370} ${ANN[0] + 120},${370} ${ANN[0] + 40},${ANN[1] + R + 82}" fill="none" stroke="var(--steel)" stroke-width="1.5" stroke-dasharray="5 6" marker-end="url(#lt-as)"/>` +
    text(HX, 372, 'language missing', 'm', 20) + `</g>`,
].join('\n'))
