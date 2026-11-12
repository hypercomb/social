// meeting — start one where you are, and people follow you (meeting-lobby.md,
// status: built). On the left, the one word that starts or joins it, and what
// you send on joining: your voice only, the camera off. In the middle, your
// swarm, drawn as a dashed room because the meeting is the swarm's and never a
// tile's: the leader is the middle hexagon, the others sit around them in seat
// order, and what the leader does goes out to each as a short arrow, a
// direction walked in that person's own hive, never code. On the right, the
// room's words, each one allowed or disallowed by the person themselves, and
// the invite link that brings someone into the swarm.
const { hex, CELL, LIT, text, svg, flow, marker, check, part } = require('../../../../presentation/plates/lib.cjs')

const MID = { x: 445, y: 204 }
const RING = 104
const SEATS = [0, 60, 120, 240, 300].map(a => [Math.round(MID.x + RING * Math.cos(a * Math.PI / 180)), Math.round(MID.y + RING * Math.sin(a * Math.PI / 180))])
const YOU = [MID.x - RING, MID.y]

// the word that starts a meeting, or joins the one already going
const say = part('say',
  `<rect x="40" y="40" width="150" height="44" rx="22" fill="var(--bg)" stroke="var(--honey)" stroke-width="1.5"/>`,
  text(115, 69, 'meeting', 'm k', 20),
  text(115, 110, 'start, or join', 'd', 16),
  flow('M194,62 H244', 'meeting-arrow', 1.8))

// the swarm: the meeting is the swarm's, never a tile's
const swarm = part('swarm',
  `<rect x="252" y="30" width="386" height="344" rx="12" fill="none" stroke="var(--line-strong)" stroke-width="1.5" stroke-dasharray="6 6"/>`,
  text(MID.x, 58, 'your swarm', 'k', 18))

const leader = part('leader', hex(MID.x, MID.y, 40, LIT), text(MID.x, MID.y + 6, 'leads', 'k hy', 17))
const followers = part('followers', ...SEATS.map(([x, y]) => hex(x, y, 30, CELL)))

// you: one seat in the ring, sending your voice only
const you = part('you',
  hex(YOU[0], YOU[1], 30, CELL),
  text(YOU[0], YOU[1] + 6, 'you', 'k', 16),
  `<rect x="40" y="160" width="170" height="88" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>`,
  text(125, 196, 'voice only', 'k hy', 18),
  text(125, 226, 'camera off', 'f', 16),
  `<path d="M210,${YOU[1]} H${YOU[0] - 34}" fill="none" stroke="var(--line-strong)" stroke-width="1.5" stroke-dasharray="4 5"/>`)

// directions: a short arrow from the leader to every seat
const toward = ([x, y]) => {
  const dx = (x - MID.x) / RING, dy = (y - MID.y) / RING
  return flow(`M${Math.round(MID.x + dx * 46)},${Math.round(MID.y + dy * 46)} L${Math.round(MID.x + dx * 68)},${Math.round(MID.y + dy * 68)}`, 'meeting-arrow', 1.8)
}
const path = part('path',
  ...[...SEATS, YOU].map(toward),
  text(MID.x, 356, 'directions, never code', 'd', 16))

// the room's words, each allowed or disallowed by the person
const WORDS = { x: 690, y: 96, w: 230, h: 170 }
const cross = (x, y) => `<path d="M${x - 5},${y - 5} L${x + 5},${y + 5} M${x + 5},${y - 5} L${x - 5},${y + 5}" fill="none" stroke="var(--steel)" stroke-width="1.8"/>`
const words = part('words',
  `<rect x="${WORDS.x}" y="${WORDS.y}" width="${WORDS.w}" height="${WORDS.h}" rx="3" fill="var(--panel)" stroke="var(--honey-deep)" stroke-width="1.5"/>`,
  text(WORDS.x + WORDS.w / 2, WORDS.y + 34, 'the room’s words', 'd', 16),
  text(WORDS.x + 60, WORDS.y + 78, 'go', 'm k', 19, 'start'), check(WORDS.x + 170, WORDS.y + 72),
  text(WORDS.x + 60, WORDS.y + 114, 'create', 'm k', 19, 'start'), cross(WORDS.x + 170, WORDS.y + 108),
  text(WORDS.x + WORDS.w / 2, WORDS.y + 150, 'you allow each one', 'f', 15))

// the invite link: it brings someone into the swarm
const link = part('link',
  `<rect x="712" y="306" width="186" height="44" rx="22" fill="var(--bg)" stroke="var(--honey)" stroke-width="1.5"/>`,
  text(805, 334, 'invite link', 'k', 18),
  flow('M706,328 H646', 'meeting-arrow', 1.8))

module.exports = () => svg('the word meeting starts or joins a meeting; it belongs to your swarm, where the leader sits in the middle and the others around them; you join with your voice only and the camera off; the leader’s moves reach each seat as directions, never code; each person allows or disallows the room’s words; an invite link brings someone into the swarm', [
  `<defs>${marker('meeting-arrow')}</defs>`,
  say, swarm, followers, you, path, leader, words, link,
].join('\n'))
