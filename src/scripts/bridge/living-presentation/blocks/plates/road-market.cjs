// market — an open exchange of ideas (presentation-blueprint.md, "The
// marketplace of ideas"). On the left, a maker's own domain, and two ways a
// creation leaves it: free, for anyone who follows them, and sealed, closed
// until a key opens it (sealed-audiences.md; built as parts). In the middle, a
// word; its line runs to every host you follow alike, and each host's list
// is drawn the same size at the same height, because nobody's list is ranked
// above another's (pools-across-hosts.md). Below, the key that opens a sealed
// branch, handed to the people the maker chooses. And outside all of it, a
// dashed empty frame: payment. Nothing in the hive moves money.
const { hex, CELL, LIT, GHOST, text, svg, server, flow, marker, markerS, part } = require('../../../../presentation/plates/lib.cjs')

const R = 22
const AT = [[0, 0], [1.732, 0], [0.866, -1.5], [-0.866, -1.5], [-1.732, 0], [-0.866, 1.5], [0.866, 1.5]]
const comb = (x, y) => AT.map(([dx, dy], i) => hex(x + dx * R, y + dy * R, R - 1, i ? CELL : LIT)).join('')

const DOMAIN = { x: 112, y: 166 }
const maker = part('maker', comb(DOMAIN.x, DOMAIN.y), text(DOMAIN.x, DOMAIN.y + 88, 'your domain', 'k hy', 20))

// free: a creation anyone who follows you can take
const FREE = { x: 262, y: 118 }
const free = part('free',
  flow(`M${DOMAIN.x + 62},${DOMAIN.y - 22} C${DOMAIN.x + 92},${DOMAIN.y - 40} ${FREE.x - 54},${FREE.y} ${FREE.x - 26},${FREE.y}`, 'market-arrow', 1.8),
  hex(FREE.x, FREE.y, 20, LIT),
  text(FREE.x, FREE.y - 30, 'free', 'k hy', 18))

// sealed: closed until a key opens it
const SEALED = { x: 262, y: 222 }
const sealed = part('sealed',
  `<path d="M${DOMAIN.x + 62},${DOMAIN.y + 22} C${DOMAIN.x + 92},${DOMAIN.y + 44} ${SEALED.x - 54},${SEALED.y} ${SEALED.x - 26},${SEALED.y}" fill="none" stroke="var(--steel)" stroke-width="1.5" marker-end="url(#market-steel)"/>`,
  hex(SEALED.x, SEALED.y, 20, CELL),
  `<rect x="${SEALED.x - 8}" y="${SEALED.y - 2}" width="16" height="12" rx="2" fill="none" stroke="var(--steel)" stroke-width="1.6"/>`,
  `<path d="M${SEALED.x - 5},${SEALED.y - 2} V${SEALED.y - 6} C${SEALED.x - 5},${SEALED.y - 13} ${SEALED.x + 5},${SEALED.y - 13} ${SEALED.x + 5},${SEALED.y - 6} V${SEALED.y - 2}" fill="none" stroke="var(--steel)" stroke-width="1.6"/>`,
  text(SEALED.x, SEALED.y + 46, 'sealed', 'k st', 18))

// a word, asked of every host you follow alike
const WORD = { x: 348, y: 96, w: 140, h: 44 }
const HOSTS = [556, 686, 816]
const HOST = { y: 62, w: 104 }
const BUS = 168
const word = part('word',
  `<rect x="${WORD.x}" y="${WORD.y}" width="${WORD.w}" height="${WORD.h}" rx="22" fill="var(--bg)" stroke="var(--honey)" stroke-width="1.5"/>`,
  text(WORD.x + WORD.w / 2, WORD.y + 29, 'garden', 'm k', 20),
  `<path d="M${WORD.x + WORD.w + 4},${WORD.y + WORD.h / 2} H522 V${BUS} H${HOSTS[2] + HOST.w / 2} ` +
    HOSTS.map(x => `M${x + HOST.w / 2},${BUS} V${BUS - 8}`).join(' ') + `" fill="none" stroke="var(--honey-deep)" stroke-width="1.5" stroke-dasharray="4 5"/>`)

// each host's list, drawn alike: none ranked above another
const list = (x) => [0, 1, 2].map(i => `<path d="M${x + 12},${BUS + 24 + i * 16} H${x + HOST.w - 12}" stroke="var(--line-strong)" stroke-width="2"/>`).join('')
const hosts = part('hosts',
  text(HOSTS[1] + HOST.w / 2, 40, 'the hosts you follow', 'k', 18),
  ...HOSTS.map(x => server(x, HOST.y, HOST.w) + list(x)),
  text(HOSTS[1] + HOST.w / 2, BUS + 84, 'no list ranked first', 'd', 16))

// the key that opens a sealed branch, and the people the maker chooses
const KEY = { x: 392, y: 318 }
const person = (x, y) => `<circle cx="${x}" cy="${y - 10}" r="8" fill="none" stroke="var(--dim)" stroke-width="1.5"/>` +
  `<path d="M${x - 14},${y + 16} C${x - 14},${y - 2} ${x + 14},${y - 2} ${x + 14},${y + 16}" fill="none" stroke="var(--dim)" stroke-width="1.5"/>`
const key = part('key',
  `<path d="M${SEALED.x + 24},${SEALED.y + 14} C${SEALED.x + 70},${SEALED.y + 40} ${KEY.x - 60},${KEY.y} ${KEY.x - 16},${KEY.y}" fill="none" stroke="var(--line-strong)" stroke-width="1.5" stroke-dasharray="4 6"/>`,
  `<circle cx="${KEY.x}" cy="${KEY.y}" r="10" fill="none" stroke="var(--honey)" stroke-width="2"/>`,
  `<path d="M${KEY.x + 10},${KEY.y} H${KEY.x + 46} M${KEY.x + 34},${KEY.y} V${KEY.y + 9} M${KEY.x + 43},${KEY.y} V${KEY.y + 7}" fill="none" stroke="var(--honey)" stroke-width="2"/>`,
  text(KEY.x + 18, KEY.y + 40, 'a key', 'k', 18),
  flow(`M${KEY.x + 58},${KEY.y} H${KEY.x + 118}`, 'market-arrow', 1.8),
  ...[0, 1, 2].map(i => person(KEY.x + 150 + i * 40, KEY.y)),
  text(KEY.x + 190, KEY.y + 46, 'the people you choose', 'd', 16))

// payment: outside the hive
const PAY = { x: 730, y: 290, w: 200, h: 84 }
const money = part('money',
  `<rect x="${PAY.x}" y="${PAY.y}" width="${PAY.w}" height="${PAY.h}" rx="3" ${GHOST} stroke-dasharray="5 5"/>`,
  text(PAY.x + PAY.w / 2, PAY.y + 36, 'payment', 'f', 18),
  text(PAY.x + PAY.w / 2, PAY.y + 60, 'outside the hive', 'f', 16))

module.exports = () => svg('a maker’s own domain offers a creation free, or sealed until a key opens it; a word is asked of every host you follow, and each host’s list is drawn alike with none ranked first; a key goes to the people the maker chooses; payment sits outside the hive', [
  `<defs>${marker('market-arrow')}${markerS('market-steel')}</defs>`,
  maker, free, sealed, word, hosts, key, money,
].join('\n'))
