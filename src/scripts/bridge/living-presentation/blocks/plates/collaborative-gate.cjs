// gate — three gates between someone else's work and your hive (doctrine T5,
// T2, T3; intake-filter.md "Three gates, and conflating them is the mistake").
// Left, their work. Then the gates, one after another, each asking its own
// question: whom you take from (selection), what you keep (intake), what may
// run (activation). Right, your hive. Under each gate, what is built: the
// first two are built (intake keeps everything until an interest is named),
// the third partly (install-by-replication.md "Activation authority" is built;
// code-admission.md lists the paths still open). Below: a kept piece that is
// not running, a piece picked by hand and held until accepted, and the rules
// screen, which is planned.
const { hex, CELL, LIT, STEEL, text, svg, flow, marker, check, part } = require('../../../../presentation/plates/lib.cjs')

const Y = 110, W = 190, H = 140, MID = Y + H / 2
const GATES = [
  { id: 'selection', x: 160, n: 'gate one', title: 'whom you take from', q: 'only those you chose', from: 112 },
  { id: 'intake', x: 390, n: 'gate two', title: 'what you keep', q: 'by the marks it wears', from: 354 },
  { id: 'activation', x: 620, n: 'gate three', title: 'what may run', q: 'signed, or accepted', from: 584 },
]

const theirs = part('theirs',
  hex(70, MID, 34, CELL),
  text(70, MID + 70, 'their work', 'd', 16))

const gate = (g) => part(g.id,
  flow(`M${g.from},${MID} H${g.x - 8}`, 'gate-arrow', 1.8),
  `<rect x="${g.x}" y="${Y}" width="${W}" height="${H}" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>`,
  text(g.x + W / 2, Y + 30, g.n, 'm f', 14),
  text(g.x + W / 2, Y + 68, g.title, 'k', 18),
  text(g.x + W / 2, Y + 100, g.q, 'f', 14))

const yours = part('yours',
  flow(`M814,${MID} H848`, 'gate-arrow', 1.8),
  hex(896, MID, 34, LIT),
  text(896, MID + 70, 'your hive', 'k hy', 16))

// what is built, gate by gate
const status = part('status',
  check(220, 274), text(232, 279, 'built', 'm', 14, 'start'),
  check(450, 274), text(462, 279, 'built', 'm', 14, 'start'),
  text(715, 279, 'partly built', 'm st', 14))

// the rules screen: designed, not built
const planned = part('planned',
  `<rect x="150" y="312" width="210" height="52" rx="3" fill="none" stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="5 5"/>`,
  text(255, 334, 'a rules screen', 'k st', 15),
  text(255, 354, 'planned', 'm f', 14))

// holding is not running
const kept = part('kept',
  hex(430, 338, 18, CELL),
  text(458, 343, 'kept is not running', 'd', 15, 'start'))

// picked by hand: held until you accept it
const hand = part('hand',
  hex(672, 338, 18, STEEL),
  text(700, 343, 'held until you accept', 'st', 15, 'start'))

module.exports = () => svg('someone else’s work passes three gates before it reaches your hive: whom you take from, what you keep, and what may run; the first two are built and the third is partly built; a kept piece is not running, a piece picked by hand is held until you accept it, and a rules screen is planned', [
  `<defs>${marker('gate-arrow')}</defs>`,
  theirs, ...GATES.map(gate), yours, status, planned, kept, hand,
].join('\n'))
