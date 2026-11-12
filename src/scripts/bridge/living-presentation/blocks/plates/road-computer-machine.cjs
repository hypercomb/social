// machine — there is no shared machine (presentation-blueprint.md, "Why this
// does not pay the shared-machine price"). On the left, a blockchain: one
// machine everybody runs, drawn as five nodes that each hold the same program
// and must all agree on one order of events. On the right, here: three
// people, each with their own browser and their own program beside the
// others, none waiting. What they share is one piece of arithmetic, the
// SHA-256 hash of the bytes (SignatureService.sign), which each checks alone;
// e49f is the first four hex of sha256('hypercomb'). A host serves those bytes
// and runs nothing. Each person holds a version of their own. And the honest
// limit, drawn as an empty dashed frame: with nothing agreed globally, there
// is no global ledger.
const { hex, CELL, LIT, GHOST, STEEL, text, svg, server, device, flow, marker, part } = require('../../../../presentation/plates/lib.cjs')

// the blockchain: five nodes on a ring, one order in the middle
const RING = { x: 200, y: 196 }
const NODES = [[200, 92], [300, 166], [262, 284], [138, 284], [100, 166]]
const node = ([x, y]) => `<rect x="${x - 34}" y="${y - 24}" width="68" height="48" rx="3" ${STEEL}/>` + hex(x, y, 14, CELL)

const chain = part('chain',
  text(RING.x, 44, 'a blockchain', 'k st', 20),
  ...NODES.map(node),
  text(RING.x, 364, 'every node repeats every program', 'd', 16))

const order = part('order',
  ...NODES.map(([x, y]) => `<path d="M${x},${y} L${RING.x},${RING.y}" fill="none" stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="4 6"/>`),
  `<rect x="${RING.x - 58}" y="${RING.y - 32}" width="116" height="64" rx="3" fill="var(--bg)" stroke="var(--steel)" stroke-width="1.5"/>`,
  text(RING.x, RING.y - 4, '1  2  3', 'm k', 18),
  text(RING.x, RING.y + 20, 'one order', 'd', 16))

// here: a program in each person's own browser
const PEOPLE = [['you', 470, 'version 2'], ['ann', 640, 'version 1'], ['bo', 810, 'version 2']]
const DEV = { y: 70, w: 110, h: 70 }

const own = part('own',
  text(695, 44, 'here', 'k hy', 20),
  ...PEOPLE.map(([name, x], i) =>
    device(x, DEV.y, DEV.w, DEV.h) + hex(x + DEV.w / 2, DEV.y + DEV.h / 2, 24, i ? CELL : LIT) +
    text(x + DEV.w / 2, DEV.y + DEV.h + 42, name, i ? 'k' : 'k hy', 18)))

const versions = part('versions', ...PEOPLE.map(([, x, v]) => text(x + DEV.w / 2, DEV.y + DEV.h + 64, v, 'm d', 15)))

// the one thing everyone agrees on: the hash of the bytes, checked alone
const PILL = { x: 575, y: 232, w: 240, h: 44 }
const hash = part('hash',
  ...PEOPLE.map(([, x]) => `<path d="M${PILL.x + PILL.w / 2},${PILL.y - 2} L${x + DEV.w / 2},${DEV.y + DEV.h + 72}" fill="none" stroke="var(--honey-deep)" stroke-width="1.5" stroke-dasharray="4 5"/>`),
  `<rect x="${PILL.x}" y="${PILL.y}" width="${PILL.w}" height="${PILL.h}" rx="22" fill="var(--bg)" stroke="var(--honey)" stroke-width="1.5"/>`,
  text(PILL.x + PILL.w / 2, PILL.y + 29, 'sha-256 of the bytes → e49f', 'm k', 15))

// a host: it serves the bytes, and runs nothing
const HOST = { x: 440, y: 294, w: 130 }
const host = part('host',
  server(HOST.x, HOST.y, HOST.w),
  flow(`M${HOST.x + HOST.w + 6},${HOST.y + 6} C${HOST.x + HOST.w + 40},${HOST.y - 14} ${PILL.x + 30},${PILL.y + PILL.h + 30} ${PILL.x + 56},${PILL.y + PILL.h + 6}`, 'machine-arrow', 1.8),
  text(HOST.x + HOST.w + 18, HOST.y + 50, 'a host', 'k st', 18, 'start'),
  text(HOST.x + HOST.w + 18, HOST.y + 72, 'serves bytes,', 'd', 15, 'start'),
  text(HOST.x + HOST.w + 18, HOST.y + 91, 'runs nothing', 'd', 15, 'start'))

// the honest limit: nothing agreed globally, so no global ledger
const LEDGER = { x: 762, y: 300, w: 170, h: 84 }
const ledger = part('ledger',
  `<rect x="${LEDGER.x}" y="${LEDGER.y}" width="${LEDGER.w}" height="${LEDGER.h}" rx="3" ${GHOST} stroke-dasharray="5 5"/>`,
  text(LEDGER.x + LEDGER.w / 2, LEDGER.y + 36, 'no global', 'f', 17),
  text(LEDGER.x + LEDGER.w / 2, LEDGER.y + 58, 'ledger', 'f', 17))

module.exports = () => svg('on the left, a blockchain: five nodes each repeat the same program and agree on one order; on the right, here: you, ann and bo each run a program in their own browser and hold their own version, all agree only on the sha-256 hash of the bytes, a host serves bytes and runs nothing, and there is no global ledger', [
  `<defs>${marker('machine-arrow')}</defs>`,
  `<path d="M400,40 V360" ${GHOST}/>`,
  order, chain, hash, own, versions, host, ledger,
].join('\n'))
