// proof — what counts as proof, and what never does (doctrine M1, M2, M3, P6,
// D1 to D3; mathematically-backed-truth-research.md, known-location-pools.md,
// optimize-phase.md). Top left, bytes and the signature anyone recomputes from
// them. Top right, a pool: it holds membership, never truth. Inside it, a
// listing, which is not proof, and the two forms that are: a mark inside the
// member's own bytes, and a signed list of the set. Under the pool, hosts
// joining their lists, adding only. Bottom left, the layers, which are the
// truth, and a cache worked out from them, rebuilt any time.
const { hex, CELL, text, svg, flow, marker, check, part } = require('../../../../presentation/plates/lib.cjs')

const rule = (x, y, w, c = 'var(--line-strong)') => `<path d="M${x},${y} H${x + w}" stroke="${c}" stroke-width="2"/>`

// the bytes
const bytes = part('bytes',
  `<rect x="40" y="56" width="130" height="80" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>`,
  rule(60, 80, 70), rule(60, 97, 90), rule(60, 114, 56),
  text(105, 162, 'the bytes', 'k', 16))

// the signature, recomputed by anyone
const sig = part('sig',
  flow(`M178,96 H256`, 'proof-arrow', 1.8),
  `<rect x="264" y="76" width="150" height="40" rx="20" fill="var(--bg)" stroke="var(--honey)" stroke-width="1.5"/>`,
  text(339, 102, 'a3f9…e1', 'm k', 16),
  text(339, 144, 'its signature', 'k hy', 16),
  check(270, 166), text(284, 171, 'anyone recomputes it', 'd', 14, 'start'))

// a pool: membership, never truth
const POOL = { x: 520, y: 36, w: 400, h: 196 }
const pool = part('pool',
  `<rect x="${POOL.x}" y="${POOL.y}" width="${POOL.w}" height="${POOL.h}" rx="3" fill="none" stroke="var(--line-strong)" stroke-width="1.5" stroke-dasharray="5 5"/>`,
  text(POOL.x + 20, 64, 'a pool', 'k', 18, 'start'),
  text(POOL.x + POOL.w - 20, 63, 'membership, never truth', 'd', 14, 'end'))

// a listing is not proof
const listing = part('listing',
  rule(548, 104, 104, 'var(--steel)'), rule(548, 124, 104, 'var(--steel)'), rule(548, 144, 104, 'var(--steel)'),
  text(600, 182, 'a listing', 'k st', 15),
  text(600, 204, 'not proof', 'm f', 14))

// a mark inside the member's own bytes
const mark = part('mark',
  hex(735, 124, 30, CELL),
  `<circle cx="745" cy="114" r="5" fill="var(--honey-fill)" stroke="var(--honey)" stroke-width="1.5"/>`,
  text(735, 182, 'a mark in its', 'd', 14),
  text(735, 202, 'own bytes', 'd', 14))

// a signed list of the set
const sealed = part('sealed',
  `<rect x="826" y="92" width="64" height="64" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>`,
  rule(838, 108, 40), rule(838, 122, 40), check(858, 142),
  text(858, 182, 'a signed list', 'd', 14),
  text(858, 202, 'of the set', 'd', 14))

// hosts join their lists, adding only
const union = part('union',
  `<rect x="560" y="264" width="70" height="26" rx="3" fill="none" stroke="var(--steel)" stroke-width="1.5"/>`,
  `<rect x="668" y="264" width="70" height="26" rx="3" fill="none" stroke="var(--steel)" stroke-width="1.5"/>`,
  `<path d="M641,277 H657 M649,269 V285" stroke="var(--dim)" stroke-width="1.6"/>`,
  flow(`M746,277 H782`, 'proof-arrow', 1.8),
  `<rect x="790" y="264" width="100" height="26" rx="3" fill="none" stroke="var(--honey)" stroke-width="1.5"/>`,
  text(725, 322, 'hosts join their lists, adding only', 'd', 14))

// the layers: the truth
const layers = part('layers',
  ...[0, 1, 2].map(i => `<rect x="60" y="${246 + i * 30}" width="150" height="22" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>`),
  text(135, 360, 'layers: the truth', 'k hy', 16))

// a cache: worked out from them, rebuilt any time
const cache = part('cache',
  flow(`M218,287 H282`, 'proof-arrow', 1.8),
  `<rect x="290" y="256" width="170" height="62" rx="3" fill="none" stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="5 5"/>`,
  text(375, 282, 'a cache', 'k st', 16),
  text(375, 304, 'rebuilt any time', 'm f', 14))

module.exports = () => svg('anyone holding the bytes recomputes their signature; a pool holds membership, never truth; a listing of a pool is not proof, while a mark inside a member’s own bytes or a signed list of the set is; hosts join their lists, adding only; the layers are the truth, and a cache worked out from them can be rebuilt any time', [
  `<defs>${marker('proof-arrow')}</defs>`,
  bytes, sig, pool, listing, mark, sealed, union, layers, cache,
].join('\n'))
